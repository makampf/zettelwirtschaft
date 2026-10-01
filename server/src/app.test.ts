import { createHash } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { erstelleApp } from './app.js';
import { Datenbank } from './db.js';

// Integrationstests gegen eine echte Postgres-Datenbank (wird dabei geleert!)
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Server-API', () => {
  let pool: pg.Pool;
  let db: Datenbank;
  const H = { 'x-zettelwirtschaft': '1', 'content-type': 'application/json' };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = new Datenbank(pool);
    // Immer mit leerer Datenbank beginnen, damit auch das Anlegen des Schemas geprüft wird
    await pool.query('drop table if exists meta, people, invoices, submissions, files, inbox');
    await db.schemaAnlegen();
    await db.schemaAnlegen(); // mehrfacher Start darf nicht scheitern
  });
  beforeEach(async () => {
    await pool.query('truncate meta, people, invoices, submissions, files, inbox');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('meldet sich als Server und liefert ohne Daten null', async () => {
    const app = erstelleApp(db);
    expect(await (await app.request('/api/status')).json()).toEqual({ server: true, auth: false, version: null, import: false });
    expect(await (await erstelleApp(db, { version: '1.2.3' }).request('/api/status')).json()).toMatchObject({ version: '1.2.3' });
    expect(await (await app.request('/api/state')).json()).toEqual({ state: null });
  });

  it('speichert, ändert und löscht Datensätze', async () => {
    const app = erstelleApp(db);
    const post = (body: unknown) => app.request('/api/changes', { method: 'POST', headers: H, body: JSON.stringify(body) });
    expect((await post({ version: 1, upsert: { people: [{ id: 'p1', name: 'Oma' }], invoices: [{ id: 'r1', personId: 'p1', betrag: 100 }] } })).status).toBe(200);
    expect((await post({ upsert: { invoices: [{ id: 'r1', personId: 'p1', betrag: 250 }] } })).status).toBe(200);
    let s = (await (await app.request('/api/state')).json()).state;
    expect(s.version).toBe(1);
    expect(s.people).toEqual([{ id: 'p1', name: 'Oma' }]);
    expect(s.invoices).toEqual([{ id: 'r1', personId: 'p1', betrag: 250 }]);

    await post({ delete: { invoices: ['r1'] } });
    s = (await (await app.request('/api/state')).json()).state;
    expect(s.invoices).toEqual([]);
    // per SQL abfragbar
    await post({ upsert: { invoices: [{ id: 'r2', personId: 'p1', betrag: 7 }] } });
    const r = await pool.query("select id from invoices where data->>'personId' = 'p1'");
    expect(r.rows).toEqual([{ id: 'r2' }]);
  });

  it('behält die Reihenfolge der Datensätze', async () => {
    const app = erstelleApp(db);
    const ids = ['zz', 'aa', 'mm'];
    await app.request('/api/changes', { method: 'POST', headers: H, body: JSON.stringify({ version: 1, upsert: { people: ids.map((id) => ({ id })) } }) });
    await app.request('/api/changes', { method: 'POST', headers: H, body: JSON.stringify({ upsert: { people: [{ id: 'aa', name: 'geändert' }] } }) });
    const s = (await (await app.request('/api/state')).json()).state;
    expect(s.people.map((p: { id: string }) => p.id)).toEqual(ids);
    await app.request('/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ version: 1, people: [{ id: 'b' }, { id: 'a' }], invoices: [], submissions: [] }) });
    const t = (await (await app.request('/api/state')).json()).state;
    expect(t.people.map((p: { id: string }) => p.id)).toEqual(['b', 'a']);
  });

  it('lehnt ungültige Daten ab und bleibt atomar', async () => {
    const app = erstelleApp(db);
    const post = (body: unknown) => app.request('/api/changes', { method: 'POST', headers: H, body: JSON.stringify(body) });
    expect((await post({ upsert: { hacker: [{ id: 'x' }] } })).status).toBe(400);
    expect((await post({ upsert: { people: [{ name: 'ohne id' }] } })).status).toBe(400);
    expect((await post({ version: 'x' })).status).toBe(400);
  });

  it('ersetzt den kompletten Bestand', async () => {
    const app = erstelleApp(db);
    await app.request('/api/changes', { method: 'POST', headers: H, body: JSON.stringify({ version: 3, upsert: { people: [{ id: 'alt' }] } }) });
    const neu = { version: 1, people: [{ id: 'neu' }], invoices: [], submissions: [{ id: 'e1', personIds: ['neu'] }] };
    expect((await app.request('/api/state', { method: 'PUT', headers: H, body: JSON.stringify(neu) })).status).toBe(200);
    const s = (await (await app.request('/api/state')).json()).state;
    expect(s).toEqual({ ...neu, files: [] });
  });

  it('speichert Belege binär und liefert sie wieder aus', async () => {
    const app = erstelleApp(db, { maxUploadBytes: 1000 });
    const inhalt = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 255]);
    const res = await app.request('/api/files/d1', {
      method: 'PUT',
      headers: { 'x-zettelwirtschaft': '1', 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('Rechnung Ärztin.pdf') },
      body: inhalt,
    });
    expect(res.status).toBe(200);
    const s = (await (await app.request('/api/state')).json()).state;
    expect(s).toBeNull(); // Dateien allein legen noch keinen Bestand an
    const d = await app.request('/api/files/d1');
    expect(d.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await d.arrayBuffer())).toEqual(inhalt);
    await app.request('/api/changes', { method: 'POST', headers: H, body: JSON.stringify({ version: 1 }) });
    const hash = createHash('sha256').update(inhalt).digest('hex');
    expect((await (await app.request('/api/state')).json()).state.files).toEqual([{ id: 'd1', name: 'Rechnung Ärztin.pdf', type: 'application/pdf', size: 6, hash }]);
    // Ältere Dateien ohne Prüfsumme werden beim Start nachberechnet
    await pool.query('update files set hash = null');
    await db.schemaAnlegen();
    expect((await (await app.request('/api/state')).json()).state.files[0].hash).toBe(hash);

    const gross = await app.request('/api/files/d2', { method: 'PUT', headers: { 'x-zettelwirtschaft': '1' }, body: new Uint8Array(2000) });
    expect(gross.status).toBe(413);
    await app.request('/api/files/d1', { method: 'DELETE', headers: H });
    expect((await app.request('/api/files/d1')).status).toBe(404);
  });

  it('liefert die Dateien für die Texterkennung aus', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const dir = mkdtempSync(join(tmpdir(), 'ocr-'));
    mkdirSync(join(dir, 'core'));
    mkdirSync(join(dir, 'lang'));
    writeFileSync(join(dir, 'worker.min.js'), '//');
    writeFileSync(join(dir, 'core', 'tesseract-core-simd-lstm.wasm.js'), '//');
    writeFileSync(join(dir, 'lang', 'deu.traineddata.gz'), 'x');
    writeFileSync(join(dir, 'geheim.txt'), 'x');
    const app = erstelleApp(db, { ocrVerzeichnis: dir });
    const worker = await app.request('/ocr/worker.min.js');
    expect(worker.status).toBe(200);
    expect(worker.headers.get('cache-control')).toContain('max-age');
    const kern = await app.request('/ocr/core/tesseract-core-simd-lstm.wasm.js');
    expect(kern.headers.get('content-type')).toBe('text/javascript');
    const lang = await app.request('/ocr/lang/deu.traineddata.gz');
    expect(lang.status).toBe(200);
    expect(lang.headers.get('content-encoding')).toBeNull();
    expect((await app.request('/ocr/core/../../package.json')).status).toBe(404);
    expect((await app.request('/ocr/lang/eng.traineddata.gz')).status).toBe(404);
    expect((await app.request('/ocr/geheim.txt')).status).toBe(404);
  });

  it('verlangt den CSRF-Header für Änderungen', async () => {
    const app = erstelleApp(db);
    const res = await app.request('/api/changes', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"version":1}' });
    expect(res.status).toBe(403);
  });

  it('schützt alles per Passwort, außer dem Gesundheitscheck', async () => {
    const app = erstelleApp(db, { benutzer: 'familie', passwort: 'geheim', indexHtml: '<html></html>' });
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/')).status).toBe(401);
    expect((await app.request('/api/state')).status).toBe(401);
    const falsch = { authorization: `Basic ${btoa('familie:falsch')}` };
    expect((await app.request('/api/state', { headers: falsch })).status).toBe(401);
    const richtig = { authorization: `Basic ${btoa('familie:geheim')}` };
    expect((await app.request('/api/state', { headers: richtig })).status).toBe(200);
    expect(await (await app.request('/', { headers: richtig })).text()).toBe('<html></html>');
  });
  describe('Import (z. B. Paperless-ngx)', () => {
    const TOKEN = 'test-token-0123456789';
    const pdf = (text: string) => new File([`%PDF-1.4 ${text}`], 'Rechnung Muster', { type: 'application/pdf' });
    const senden = (app: ReturnType<typeof erstelleApp>, form: FormData, kopf: Record<string, string> = { authorization: `Bearer ${TOKEN}` }) =>
      app.request('/api/import', { method: 'POST', headers: kopf, body: form });

    it('ist ohne IMPORT_TOKEN abgeschaltet und verlangt den Schlüssel', async () => {
      const form = () => {
        const f = new FormData();
        f.append('file', pdf('a'));
        return f;
      };
      expect((await senden(erstelleApp(db), form())).status).toBe(404);
      const app = erstelleApp(db, { importToken: TOKEN });
      expect((await senden(app, form(), {})).status).toBe(401);
      expect((await senden(app, form(), { authorization: 'Bearer falsch' })).status).toBe(401);
      expect((await senden(app, form(), { 'x-import-token': TOKEN })).status).toBe(201);
      expect(await (await app.request('/api/status')).json()).toMatchObject({ import: true });
    });

    it('nimmt Dokumente per Multipart an, auch hinter dem Passwortschutz, und erkennt Duplikate', async () => {
      const app = erstelleApp(db, { importToken: TOKEN, benutzer: 'familie', passwort: 'geheim' });
      const f = new FormData();
      f.append('file', pdf('eins'));
      f.append('title', 'Rechnung Muster');
      f.append('document_type', 'Arztrechnung');
      f.append('correspondent', 'Dr. Max Mustermann');
      f.append('unbekannt', 'wird ignoriert');
      const res = await senden(app, f);
      expect(res.status).toBe(201);
      const { id, duplicate } = await res.json();
      expect(duplicate).toBe(false);

      // Gleicher Inhalt noch einmal (z. B. Workflow erneut ausgelöst): nicht doppelt ablegen
      const g = new FormData();
      g.append('file', pdf('eins'));
      const zweit = await senden(app, g);
      expect(zweit.status).toBe(200);
      expect(await zweit.json()).toMatchObject({ id, duplicate: true });

      const anmeldung = { authorization: `Basic ${btoa('familie:geheim')}` };
      expect((await app.request('/api/inbox')).status).toBe(401);
      const { entries } = await (await app.request('/api/inbox', { headers: anmeldung })).json();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        id,
        name: 'Rechnung Muster.pdf',
        type: 'application/pdf',
        status: 'new',
        data: { title: 'Rechnung Muster', document_type: 'Arztrechnung', correspondent: 'Dr. Max Mustermann' },
      });
      expect(entries[0].data.unbekannt).toBeUndefined();
      const datei = await app.request(`/api/inbox/${id}/file`, { headers: anmeldung });
      expect(await datei.text()).toBe('%PDF-1.4 eins');

      // Schon als Beleg gespeichert → Duplikat
      await db.dateiSpeichern({ id: 'f1', name: 'x.pdf', type: 'application/pdf', size: 0 }, Buffer.from('%PDF-1.4 zwei'));
      const h = new FormData();
      h.append('file', pdf('zwei'));
      expect(await (await senden(app, h)).json()).toMatchObject({ id: 'f1', duplicate: true });
    });

    it('nimmt Dokumente auch direkt als Inhalt an und lehnt andere Dateitypen ab', async () => {
      const app = erstelleApp(db, { importToken: TOKEN });
      const kopf = { authorization: `Bearer ${TOKEN}` };
      const res = await app.request('/api/import?kind=statement&title=Abrechnung', {
        method: 'POST',
        headers: { ...kopf, 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent('Abrechnung März.pdf') },
        body: '%PDF-1.4 drei',
      });
      expect(res.status).toBe(201);
      const { entries } = await (await app.request('/api/inbox')).json();
      expect(entries[0]).toMatchObject({ name: 'Abrechnung März.pdf', data: { kind: 'statement', title: 'Abrechnung' } });

      const f = new FormData();
      f.append('file', new File(['hallo'], 'notiz.txt', { type: 'text/plain' }));
      expect((await senden(app, f)).status).toBe(415);
      expect((await senden(app, new FormData())).status).toBe(400);
      expect((await erstelleApp(db, { importToken: TOKEN, maxUploadBytes: 5 }).request('/api/import', {
        method: 'POST',
        headers: { ...kopf, 'content-type': 'application/pdf' },
        body: '%PDF-1.4 zu groß',
      })).status).toBe(413);
    });

    it('verwaltet den Eingang: übernehmen, zur Prüfung markieren, löschen', async () => {
      const app = erstelleApp(db, { importToken: TOKEN });
      const f = new FormData();
      f.append('file', pdf('vier'));
      const { id } = await (await senden(app, f)).json();
      const post = (pfad: string, init: RequestInit = {}) => app.request(pfad, { method: 'POST', headers: H, ...init });

      expect((await post(`/api/inbox/${id}/claim`)).status).toBe(200);
      expect((await post(`/api/inbox/${id}/claim`)).status).toBe(409); // zweites Fenster
      expect((await app.request(`/api/inbox/${id}/claim`, { method: 'POST' })).status).toBe(403); // CSRF
      // Hängengebliebene Bearbeitung wird nach einiger Zeit wieder frei
      await pool.query("update inbox set claimed_at = now() - interval '1 hour'");
      expect((await (await app.request('/api/inbox')).json()).entries[0].status).toBe('new');
      expect((await post(`/api/inbox/${id}/claim`)).status).toBe(200);

      const patch = (body: unknown) => app.request(`/api/inbox/${id}`, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
      expect((await patch({ status: 'erledigt' })).status).toBe(400);
      expect((await patch({ status: 'review', note: 'Betrag nicht erkannt' })).status).toBe(200);
      expect((await (await app.request('/api/inbox')).json()).entries[0]).toMatchObject({ status: 'review', note: 'Betrag nicht erkannt' });
      expect((await post(`/api/inbox/${id}/claim`)).status).toBe(409);

      expect((await app.request(`/api/inbox/${id}`, { method: 'DELETE', headers: H })).status).toBe(200);
      expect((await (await app.request('/api/inbox')).json()).entries).toEqual([]);
      expect((await app.request(`/api/inbox/${id}/file`)).status).toBe(404);
    });
  });
});

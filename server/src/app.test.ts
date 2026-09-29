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
    await pool.query('drop table if exists meta, people, invoices, submissions, files');
    await db.schemaAnlegen();
    await db.schemaAnlegen(); // mehrfacher Start darf nicht scheitern
  });
  beforeEach(async () => {
    await pool.query('truncate meta, people, invoices, submissions, files');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('meldet sich als Server und liefert ohne Daten null', async () => {
    const app = erstelleApp(db);
    expect(await (await app.request('/api/status')).json()).toEqual({ server: true, auth: false, version: null });
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
    expect((await (await app.request('/api/state')).json()).state.files).toEqual([{ id: 'd1', name: 'Rechnung Ärztin.pdf', type: 'application/pdf', size: 6 }]);

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
});

import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { erstelleApp } from './app.js';
import { Datenbank } from './db.js';

// Integrationstests gegen eine echte Postgres-Datenbank (wird dabei geleert!)
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Server-API', () => {
  let pool: pg.Pool;
  let db: Datenbank;
  const H = { 'x-rechnungsmanager': '1', 'content-type': 'application/json' };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    db = new Datenbank(pool);
    // Immer mit leerer Datenbank beginnen, damit auch das Anlegen des Schemas geprüft wird
    await pool.query('drop table if exists meta, personen, rechnungen, einreichungen, dateien');
    await db.schemaAnlegen();
    await db.schemaAnlegen(); // mehrfacher Start darf nicht scheitern
  });
  beforeEach(async () => {
    await pool.query('truncate meta, personen, rechnungen, einreichungen, dateien');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('meldet sich als Server und liefert ohne Daten null', async () => {
    const app = erstelleApp(db);
    expect(await (await app.request('/api/status')).json()).toEqual({ server: true, anmeldung: false });
    expect(await (await app.request('/api/state')).json()).toEqual({ state: null });
  });

  it('speichert, ändert und löscht Datensätze', async () => {
    const app = erstelleApp(db);
    const post = (body: unknown) => app.request('/api/aenderungen', { method: 'POST', headers: H, body: JSON.stringify(body) });
    expect((await post({ version: 4, speichern: { personen: [{ id: 'p1', name: 'Oma' }], rechnungen: [{ id: 'r1', personId: 'p1', betrag: 100 }] } })).status).toBe(200);
    expect((await post({ speichern: { rechnungen: [{ id: 'r1', personId: 'p1', betrag: 250 }] } })).status).toBe(200);
    let s = (await (await app.request('/api/state')).json()).state;
    expect(s.version).toBe(4);
    expect(s.personen).toEqual([{ id: 'p1', name: 'Oma' }]);
    expect(s.rechnungen).toEqual([{ id: 'r1', personId: 'p1', betrag: 250 }]);

    await post({ loeschen: { rechnungen: ['r1'] } });
    s = (await (await app.request('/api/state')).json()).state;
    expect(s.rechnungen).toEqual([]);
    // per SQL abfragbar
    await post({ speichern: { rechnungen: [{ id: 'r2', personId: 'p1', betrag: 7 }] } });
    const r = await pool.query("select id from rechnungen where daten->>'personId' = 'p1'");
    expect(r.rows).toEqual([{ id: 'r2' }]);
  });

  it('behält die Reihenfolge der Datensätze', async () => {
    const app = erstelleApp(db);
    const ids = ['zz', 'aa', 'mm'];
    await app.request('/api/aenderungen', { method: 'POST', headers: H, body: JSON.stringify({ version: 4, speichern: { personen: ids.map((id) => ({ id })) } }) });
    await app.request('/api/aenderungen', { method: 'POST', headers: H, body: JSON.stringify({ speichern: { personen: [{ id: 'aa', name: 'geändert' }] } }) });
    const s = (await (await app.request('/api/state')).json()).state;
    expect(s.personen.map((p: { id: string }) => p.id)).toEqual(ids);
    await app.request('/api/state', { method: 'PUT', headers: H, body: JSON.stringify({ version: 4, personen: [{ id: 'b' }, { id: 'a' }], rechnungen: [], einreichungen: [] }) });
    const t = (await (await app.request('/api/state')).json()).state;
    expect(t.personen.map((p: { id: string }) => p.id)).toEqual(['b', 'a']);
  });

  it('lehnt ungültige Daten ab und bleibt atomar', async () => {
    const app = erstelleApp(db);
    const post = (body: unknown) => app.request('/api/aenderungen', { method: 'POST', headers: H, body: JSON.stringify(body) });
    expect((await post({ speichern: { hacker: [{ id: 'x' }] } })).status).toBe(400);
    expect((await post({ speichern: { personen: [{ name: 'ohne id' }] } })).status).toBe(400);
    expect((await post({ version: 'x' })).status).toBe(400);
  });

  it('ersetzt den kompletten Bestand', async () => {
    const app = erstelleApp(db);
    await app.request('/api/aenderungen', { method: 'POST', headers: H, body: JSON.stringify({ version: 3, speichern: { personen: [{ id: 'alt' }] } }) });
    const neu = { version: 4, personen: [{ id: 'neu' }], rechnungen: [], einreichungen: [{ id: 'e1', personIds: ['neu'] }] };
    expect((await app.request('/api/state', { method: 'PUT', headers: H, body: JSON.stringify(neu) })).status).toBe(200);
    const s = (await (await app.request('/api/state')).json()).state;
    expect(s).toEqual({ ...neu, dateien: [] });
  });

  it('speichert Belege binär und liefert sie wieder aus', async () => {
    const app = erstelleApp(db, { maxUploadBytes: 1000 });
    const inhalt = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 255]);
    const res = await app.request('/api/dateien/d1', {
      method: 'PUT',
      headers: { 'x-rechnungsmanager': '1', 'content-type': 'application/pdf', 'x-dateiname': encodeURIComponent('Rechnung Ärztin.pdf') },
      body: inhalt,
    });
    expect(res.status).toBe(200);
    const s = (await (await app.request('/api/state')).json()).state;
    expect(s).toBeNull(); // Dateien allein legen noch keinen Bestand an
    const d = await app.request('/api/dateien/d1');
    expect(d.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await d.arrayBuffer())).toEqual(inhalt);
    await app.request('/api/aenderungen', { method: 'POST', headers: H, body: JSON.stringify({ version: 4 }) });
    expect((await (await app.request('/api/state')).json()).state.dateien).toEqual([{ id: 'd1', name: 'Rechnung Ärztin.pdf', typ: 'application/pdf', groesse: 6 }]);

    const gross = await app.request('/api/dateien/d2', { method: 'PUT', headers: { 'x-rechnungsmanager': '1' }, body: new Uint8Array(2000) });
    expect(gross.status).toBe(413);
    await app.request('/api/dateien/d1', { method: 'DELETE', headers: H });
    expect((await app.request('/api/dateien/d1')).status).toBe(404);
  });

  it('verlangt den CSRF-Header für Änderungen', async () => {
    const app = erstelleApp(db);
    const res = await app.request('/api/aenderungen', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"version":1}' });
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

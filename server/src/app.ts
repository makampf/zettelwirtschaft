import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { SAMMLUNGEN, type Aenderungen, type Datenbank, type Datensatz, type Sammlung, type Zustand } from './db.js';

export interface Optionen {
  /** Inhalt der ausgelieferten App (dist/index.html); ohne Angabe nur API. */
  indexHtml?: string;
  /** Verzeichnis mit den Dateien für die Texterkennung (dist/ocr). */
  ocrVerzeichnis?: string;
  /** Wenn gesetzt, ist die gesamte App per HTTP Basic Auth geschützt. */
  benutzer?: string;
  passwort?: string;
  maxUploadBytes?: number;
}

const OCR_TYPEN: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.gz': 'application/octet-stream' };

/** Pflicht-Header für ändernde Anfragen: erzwingt einen CORS-Preflight und verhindert so CSRF von fremden Seiten. */
export const CSRF_HEADER = 'x-rechnungsmanager';

function gleich(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function istDatensatz(d: unknown): d is Datensatz {
  return typeof d === 'object' && d !== null && !Array.isArray(d) && typeof (d as Datensatz).id === 'string' && (d as Datensatz).id.length > 0;
}

function pruefeSammlungen(obj: unknown, pruefe: (x: unknown) => boolean): boolean {
  if (obj == null) return true;
  if (typeof obj !== 'object') return false;
  return Object.entries(obj).every(([k, v]) => (SAMMLUNGEN as readonly string[]).includes(k) && Array.isArray(v) && v.every(pruefe));
}

export function erstelleApp(db: Datenbank, opt: Optionen = {}): Hono {
  const app = new Hono();
  const maxUpload = opt.maxUploadBytes ?? 25 * 1024 * 1024;

  // Gesundheitscheck für Docker – ohne Anmeldung, ohne Daten
  app.get('/api/health', async (c) => {
    await db.pool.query('select 1');
    return c.json({ ok: true });
  });

  // Anmeldung
  if (opt.passwort) {
    const erwartet = `${opt.benutzer ?? ''}:${opt.passwort}`;
    app.use('*', async (c, next) => {
      const kopf = c.req.header('authorization') ?? '';
      const [art, wert] = kopf.split(' ');
      const ok = art === 'Basic' && wert && gleich(Buffer.from(wert, 'base64').toString(), erwartet);
      if (!ok) return c.text('Anmeldung erforderlich', 401, { 'WWW-Authenticate': 'Basic realm="Rechnungsmanager", charset="UTF-8"' });
      await next();
    });
  }

  // Komprimierung (die App-Datei ist ~2 MB, komprimiert ~0,6 MB)
  app.use('*', compress());

  // Sicherheits-Header und CSRF-Schutz
  app.use('*', async (c, next) => {
    if (!['GET', 'HEAD'].includes(c.req.method) && c.req.header(CSRF_HEADER) !== '1') {
      return c.json({ fehler: 'Fehlender Header' }, 403);
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  app.get('/api/status', (c) => c.json({ server: true, anmeldung: !!opt.passwort }));

  app.get('/api/state', async (c) => c.json({ state: await db.laden() }));

  app.post('/api/aenderungen', async (c) => {
    const a = await c.req.json<Aenderungen>().catch(() => null);
    if (!a || (a.version != null && typeof a.version !== 'number') || !pruefeSammlungen(a.speichern, istDatensatz) || !pruefeSammlungen(a.loeschen, (x) => typeof x === 'string')) {
      return c.json({ fehler: 'Ungültige Änderungen' }, 400);
    }
    await db.aendern(a);
    return c.json({ ok: true });
  });

  app.put('/api/state', async (c) => {
    const z = await c.req.json<Omit<Zustand, 'dateien'>>().catch(() => null);
    if (!z || typeof z.version !== 'number' || !SAMMLUNGEN.every((s: Sammlung) => Array.isArray(z[s]) && z[s].every(istDatensatz))) {
      return c.json({ fehler: 'Ungültiger Datenbestand' }, 400);
    }
    await db.ersetzen(z);
    return c.json({ ok: true });
  });

  app.put('/api/dateien/:id', async (c) => {
    const id = c.req.param('id');
    const laenge = Number(c.req.header('content-length') ?? 0);
    if (laenge > maxUpload) return c.json({ fehler: 'Datei zu groß' }, 413);
    const inhalt = Buffer.from(await c.req.arrayBuffer());
    if (inhalt.length > maxUpload) return c.json({ fehler: 'Datei zu groß' }, 413);
    const name = decodeURIComponent(c.req.header('x-dateiname') ?? 'datei');
    const typ = c.req.header('content-type') || 'application/octet-stream';
    await db.dateiSpeichern({ id, name, typ, groesse: inhalt.length }, inhalt);
    return c.json({ ok: true });
  });

  app.get('/api/dateien/:id', async (c) => {
    const d = await db.dateiLaden(c.req.param('id'));
    if (!d) return c.json({ fehler: 'Nicht gefunden' }, 404);
    return c.body(new Uint8Array(d.inhalt), 200, {
      'Content-Type': d.typ,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(d.name)}`,
    });
  });

  app.delete('/api/dateien/:id', async (c) => {
    await db.dateiLoeschen(c.req.param('id'));
    return c.json({ ok: true });
  });

  app.delete('/api/dateien', async (c) => {
    await db.alleDateienLoeschen();
    return c.json({ ok: true });
  });

  app.all('/api/*', (c) => c.json({ fehler: 'Unbekannter Pfad' }, 404));

  // Texterkennung: Worker, WebAssembly-Kern und deutsche Sprachdaten (beim Build nach dist/ocr kopiert)
  app.get('/ocr/*', async (c) => {
    if (!opt.ocrVerzeichnis) return c.text('Nicht verfügbar', 404);
    const pfad = c.req.path.slice('/ocr/'.length);
    // Nur bekannte Dateinamen – kein Zugriff außerhalb des Verzeichnisses
    if (!/^(worker\.min\.js|core\/tesseract-core[\w-]*\.wasm\.js|lang\/deu\.traineddata\.gz)$/.test(pfad)) return c.text('Nicht gefunden', 404);
    const datei = join(opt.ocrVerzeichnis, pfad);
    const inhalt = await readFile(datei).catch(() => null);
    if (!inhalt) return c.text('Nicht gefunden', 404);
    const endung = /\.(wasm|js|gz)$/.exec(datei)?.[0] ?? '';
    // Kein Content-Encoding: die Sprachdaten entpackt tesseract.js selbst
    return c.body(new Uint8Array(inhalt), 200, { 'Content-Type': OCR_TYPEN[endung] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=604800' });
  });

  // Die App selbst ist eine einzige HTML-Datei
  app.get('*', (c) => (opt.indexHtml ? c.html(opt.indexHtml) : c.text('Nur API', 404)));

  app.onError((e, c) => {
    console.error(e);
    return c.json({ fehler: 'Serverfehler' }, 500);
  });

  return app;
}

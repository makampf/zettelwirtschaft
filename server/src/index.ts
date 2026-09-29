import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import pg from 'pg';
import { erstelleApp } from './app.js';
import { Datenbank } from './db.js';

const env = process.env;
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL fehlt, z. B. postgres://benutzer:passwort@host:5432/rechnungen');
  process.exit(1);
}
if (!env.APP_PASSWORD) {
  console.warn('Warnung: APP_PASSWORD ist nicht gesetzt – die App ist ohne Anmeldung erreichbar.');
}

const hier = dirname(fileURLToPath(import.meta.url));
const indexPfad = env.STATIC_INDEX ?? resolve(hier, '../../dist/index.html');

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = new Datenbank(pool);

async function start() {
  // Beim Start ist die Datenbank ggf. noch nicht bereit (docker compose)
  for (let versuch = 1; ; versuch++) {
    try {
      await db.schemaAnlegen();
      break;
    } catch (e) {
      if (versuch >= 30) throw e;
      console.log(`Warte auf Datenbank … (${versuch}: ${e instanceof Error ? e.message : e})`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const app = erstelleApp(db, {
    indexHtml: readFileSync(indexPfad, 'utf8'),
    benutzer: env.APP_USER ?? '',
    passwort: env.APP_PASSWORD,
    maxUploadBytes: Number(env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024,
  });
  const port = Number(env.PORT ?? 8080);
  serve({ fetch: app.fetch, port }, () => console.log(`Rechnungsmanager läuft auf Port ${port}`));
}

start().catch((e) => {
  console.error(e);
  process.exit(1);
});

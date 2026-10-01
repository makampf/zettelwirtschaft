import { createHash } from 'node:crypto';
import pg from 'pg';

/** Tabellen mit je einem JSON-Datensatz pro Zeile (Namen entsprechen den Schlüsseln des App-Zustands). */
export const COLLECTIONS = ['people', 'invoices', 'submissions'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export type DataRecord = { id: string } & { [key: string]: unknown };

export interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
  /** SHA-256 des Inhalts (hex) – zum Erkennen doppelter Belege. */
  hash?: string;
}

export interface State {
  version: number;
  people: DataRecord[];
  invoices: DataRecord[];
  submissions: DataRecord[];
  files: FileMeta[];
}

export interface Changes {
  version?: number;
  upsert?: Partial<{ [K in Collection]: DataRecord[] }>;
  delete?: Partial<{ [K in Collection]: string[] }>;
}

const SCHEMA = `
create table if not exists meta (
  key text primary key,
  value jsonb not null
);
create table if not exists people (
  id text primary key,
  seq bigserial,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists invoices (
  id text primary key,
  seq bigserial,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists invoices_person on invoices ((data->>'personId'));
create table if not exists submissions (
  id text primary key,
  seq bigserial,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists files (
  id text primary key,
  name text not null,
  type text not null,
  size integer not null,
  content bytea not null,
  created_at timestamptz not null default now()
);
alter table files add column if not exists hash text;
update files set hash = encode(sha256(content), 'hex') where hash is null;
create table if not exists inbox (
  id text primary key,
  name text not null,
  type text not null,
  size integer not null,
  content bytea not null,
  hash text not null,
  data jsonb not null default '{}',
  status text not null default 'new',
  note text,
  received_at timestamptz not null default now(),
  claimed_at timestamptz
);
`;

/** Dokument im Eingang (z. B. von Paperless-ngx), das die App noch erfassen muss. */
export interface InboxEntry {
  id: string;
  name: string;
  type: string;
  size: number;
  hash: string;
  /** Angaben des Absenders: Titel, Dokumenttyp, Korrespondent, Link … */
  data: Record<string, string>;
  /** new = noch nicht verarbeitet, processing = wird gerade erfasst, review = braucht Prüfung von Hand */
  status: 'new' | 'processing' | 'review';
  /** Grund, warum das Dokument nicht automatisch erfasst werden konnte. */
  note?: string;
  receivedAt: string;
}

/** So lange gilt ein Dokument als „in Bearbeitung“, danach darf es erneut übernommen werden. */
const BEARBEITUNG_MINUTEN = 10;

export class Datenbank {
  constructor(readonly pool: pg.Pool) {}

  async schemaAnlegen(): Promise<void> {
    await this.pool.query(SCHEMA);
  }

  private async transaktion<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('begin');
      const ergebnis = await fn(c);
      await c.query('commit');
      return ergebnis;
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  }

  /** Liefert den gesamten Datenbestand; `null`, wenn noch nie gespeichert wurde. */
  async laden(): Promise<State | null> {
    const version = await this.pool.query<{ value: number }>("select value from meta where key = 'version'");
    if (!version.rowCount) return null;
    // Sortiert nach laufender Nummer: Datensätze behalten ihre Reihenfolge (Upserts ändern sie nicht)
    const lese = async (s: Collection) =>
      (await this.pool.query<{ data: DataRecord }>(`select data from ${s} order by seq`)).rows.map((r) => r.data);
    const files = await this.pool.query<FileMeta>('select id, name, type, size, hash from files order by created_at, id');
    return {
      version: version.rows[0].value,
      people: await lese('people'),
      invoices: await lese('invoices'),
      submissions: await lese('submissions'),
      files: files.rows.map(({ hash, ...m }) => (hash ? { ...m, hash } : m)),
    };
  }

  /** Speichert und löscht einzelne Datensätze in einer Transaktion. */
  async aendern(a: Changes): Promise<void> {
    await this.transaktion(async (c) => {
      if (a.version != null) await setzeVersion(c, a.version);
      for (const s of COLLECTIONS) {
        for (const d of a.upsert?.[s] ?? []) {
          await c.query(
            `insert into ${s} (id, data) values ($1, $2) on conflict (id) do update set data = excluded.data, updated_at = now()`,
            [d.id, JSON.stringify(d)],
          );
        }
        const ids = a.delete?.[s] ?? [];
        if (ids.length) await c.query(`delete from ${s} where id = any($1)`, [ids]);
      }
    });
  }

  /** Ersetzt den kompletten Bestand (Import einer Sicherung, Zurücksetzen). Dateien werden separat verwaltet. */
  async ersetzen(z: Omit<State, 'files'>): Promise<void> {
    await this.transaktion(async (c) => {
      for (const s of COLLECTIONS) await c.query(`delete from ${s}`);
      await setzeVersion(c, z.version);
      for (const s of COLLECTIONS) {
        for (const d of z[s]) await c.query(`insert into ${s} (id, data) values ($1, $2)`, [d.id, JSON.stringify(d)]);
      }
    });
  }

  async dateiSpeichern(meta: FileMeta, content: Buffer): Promise<void> {
    await this.pool.query(
      `insert into files (id, name, type, size, content, hash) values ($1, $2, $3, $4, $5, $6)
       on conflict (id) do update set name = excluded.name, type = excluded.type, size = excluded.size, content = excluded.content, hash = excluded.hash`,
      [meta.id, meta.name, meta.type, content.length, content, createHash('sha256').update(content).digest('hex')],
    );
  }

  async dateiLaden(id: string): Promise<(FileMeta & { content: Buffer }) | null> {
    const r = await this.pool.query<FileMeta & { content: Buffer }>('select id, name, type, size, content from files where id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async dateiLoeschen(id: string): Promise<void> {
    await this.pool.query('delete from files where id = $1', [id]);
  }

  async alleDateienLoeschen(): Promise<void> {
    await this.pool.query('delete from files');
  }

  /** Legt ein Dokument im Eingang ab. Ist derselbe Inhalt schon vorhanden (Eingang oder Belege), wird nichts gespeichert. */
  async eingangAblegen(
    e: Pick<InboxEntry, 'id' | 'name' | 'type' | 'data'>,
    content: Buffer,
  ): Promise<{ id: string; duplicate: boolean }> {
    const hash = createHash('sha256').update(content).digest('hex');
    const vorhanden = await this.pool.query<{ id: string }>(
      'select id from inbox where hash = $1 union all select id from files where hash = $1 limit 1',
      [hash],
    );
    if (vorhanden.rowCount) return { id: vorhanden.rows[0].id, duplicate: true };
    await this.pool.query('insert into inbox (id, name, type, size, content, hash, data) values ($1, $2, $3, $4, $5, $6, $7)', [
      e.id,
      e.name,
      e.type,
      content.length,
      content,
      hash,
      JSON.stringify(e.data),
    ]);
    return { id: e.id, duplicate: false };
  }

  async eingang(): Promise<InboxEntry[]> {
    const r = await this.pool.query<InboxEntry & { receivedAt: Date; note: string | null }>(
      `select id, name, type, size, hash, data, note, received_at as "receivedAt",
              case when status = 'processing' and claimed_at < now() - interval '${BEARBEITUNG_MINUTEN} minutes' then 'new' else status end as status
       from inbox order by received_at, id`,
    );
    return r.rows.map(({ note, receivedAt, ...e }) => ({ ...e, ...(note ? { note } : {}), receivedAt: receivedAt.toISOString() }));
  }

  /** Übernimmt ein neues Dokument zur Verarbeitung; `false`, wenn es schon jemand anderes bearbeitet (z. B. zweites Fenster). */
  async eingangUebernehmen(id: string): Promise<boolean> {
    const r = await this.pool.query(
      `update inbox set status = 'processing', claimed_at = now()
       where id = $1 and (status = 'new' or (status = 'processing' and claimed_at < now() - interval '${BEARBEITUNG_MINUTEN} minutes'))`,
      [id],
    );
    return r.rowCount === 1;
  }

  /** Markiert ein Dokument als „von Hand prüfen“ (mit Grund) oder gibt es wieder zur automatischen Verarbeitung frei. */
  async eingangStatus(id: string, status: 'new' | 'review', note?: string): Promise<boolean> {
    const r = await this.pool.query('update inbox set status = $2, note = $3, claimed_at = null where id = $1', [id, status, note ?? null]);
    return r.rowCount === 1;
  }

  async eingangDatei(id: string): Promise<(Pick<InboxEntry, 'name' | 'type'> & { content: Buffer }) | null> {
    const r = await this.pool.query<{ name: string; type: string; content: Buffer }>('select name, type, content from inbox where id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async eingangLoeschen(id: string): Promise<void> {
    await this.pool.query('delete from inbox where id = $1', [id]);
  }
}

async function setzeVersion(c: pg.PoolClient, version: number): Promise<void> {
  await c.query("insert into meta (key, value) values ('version', $1) on conflict (key) do update set value = excluded.value", [
    JSON.stringify(version),
  ]);
}

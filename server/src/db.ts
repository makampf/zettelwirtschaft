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
`;

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
    const files = await this.pool.query<FileMeta>('select id, name, type, size from files order by created_at, id');
    return {
      version: version.rows[0].value,
      people: await lese('people'),
      invoices: await lese('invoices'),
      submissions: await lese('submissions'),
      files: files.rows,
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
      `insert into files (id, name, type, size, content) values ($1, $2, $3, $4, $5)
       on conflict (id) do update set name = excluded.name, type = excluded.type, size = excluded.size, content = excluded.content`,
      [meta.id, meta.name, meta.type, content.length, content],
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
}

async function setzeVersion(c: pg.PoolClient, version: number): Promise<void> {
  await c.query("insert into meta (key, value) values ('version', $1) on conflict (key) do update set value = excluded.value", [
    JSON.stringify(version),
  ]);
}

import pg from 'pg';

/** Tabellen mit je einem JSON-Datensatz pro Zeile. */
export const SAMMLUNGEN = ['personen', 'rechnungen', 'einreichungen'] as const;
export type Sammlung = (typeof SAMMLUNGEN)[number];

export type Datensatz = { id: string } & Record<string, unknown>;

export interface DateiMeta {
  id: string;
  name: string;
  typ: string;
  groesse: number;
}

export interface Zustand {
  version: number;
  personen: Datensatz[];
  rechnungen: Datensatz[];
  einreichungen: Datensatz[];
  dateien: DateiMeta[];
}

export interface Aenderungen {
  version?: number;
  speichern?: Partial<Record<Sammlung, Datensatz[]>>;
  loeschen?: Partial<Record<Sammlung, string[]>>;
}

const SCHEMA = `
create table if not exists meta (
  schluessel text primary key,
  wert jsonb not null
);
create table if not exists personen (
  id text primary key,
  daten jsonb not null,
  geaendert timestamptz not null default now()
);
create table if not exists rechnungen (
  id text primary key,
  daten jsonb not null,
  geaendert timestamptz not null default now()
);
create index if not exists rechnungen_person on rechnungen ((daten->>'personId'));
create table if not exists einreichungen (
  id text primary key,
  daten jsonb not null,
  geaendert timestamptz not null default now()
);
create table if not exists dateien (
  id text primary key,
  name text not null,
  typ text not null,
  groesse integer not null,
  inhalt bytea not null,
  erstellt timestamptz not null default now()
);
-- Laufende Nummer: Datensätze behalten ihre Reihenfolge (Upserts ändern sie nicht)
alter table personen add column if not exists nr bigserial;
alter table rechnungen add column if not exists nr bigserial;
alter table einreichungen add column if not exists nr bigserial;
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
  async laden(): Promise<Zustand | null> {
    const version = await this.pool.query<{ wert: number }>("select wert from meta where schluessel = 'version'");
    if (!version.rowCount) return null;
    const lese = async (s: Sammlung) => (await this.pool.query<{ daten: Datensatz }>(`select daten from ${s} order by nr`)).rows.map((r) => r.daten);
    const dateien = await this.pool.query<DateiMeta>('select id, name, typ, groesse from dateien order by erstellt, id');
    return {
      version: version.rows[0].wert,
      personen: await lese('personen'),
      rechnungen: await lese('rechnungen'),
      einreichungen: await lese('einreichungen'),
      dateien: dateien.rows,
    };
  }

  /** Speichert und löscht einzelne Datensätze in einer Transaktion. */
  async aendern(a: Aenderungen): Promise<void> {
    await this.transaktion(async (c) => {
      if (a.version != null) await setzeVersion(c, a.version);
      for (const s of SAMMLUNGEN) {
        for (const d of a.speichern?.[s] ?? []) {
          await c.query(
            `insert into ${s} (id, daten) values ($1, $2) on conflict (id) do update set daten = excluded.daten, geaendert = now()`,
            [d.id, JSON.stringify(d)],
          );
        }
        const ids = a.loeschen?.[s] ?? [];
        if (ids.length) await c.query(`delete from ${s} where id = any($1)`, [ids]);
      }
    });
  }

  /** Ersetzt den kompletten Bestand (Import einer Sicherung, Zurücksetzen). Dateien werden separat verwaltet. */
  async ersetzen(z: Omit<Zustand, 'dateien'>): Promise<void> {
    await this.transaktion(async (c) => {
      for (const s of SAMMLUNGEN) await c.query(`delete from ${s}`);
      await setzeVersion(c, z.version);
      for (const s of SAMMLUNGEN) {
        for (const d of z[s]) await c.query(`insert into ${s} (id, daten) values ($1, $2)`, [d.id, JSON.stringify(d)]);
      }
    });
  }

  async dateiSpeichern(meta: DateiMeta, inhalt: Buffer): Promise<void> {
    await this.pool.query(
      `insert into dateien (id, name, typ, groesse, inhalt) values ($1, $2, $3, $4, $5)
       on conflict (id) do update set name = excluded.name, typ = excluded.typ, groesse = excluded.groesse, inhalt = excluded.inhalt`,
      [meta.id, meta.name, meta.typ, inhalt.length, inhalt],
    );
  }

  async dateiLaden(id: string): Promise<(DateiMeta & { inhalt: Buffer }) | null> {
    const r = await this.pool.query<DateiMeta & { inhalt: Buffer }>('select id, name, typ, groesse, inhalt from dateien where id = $1', [id]);
    return r.rows[0] ?? null;
  }

  async dateiLoeschen(id: string): Promise<void> {
    await this.pool.query('delete from dateien where id = $1', [id]);
  }

  async alleDateienLoeschen(): Promise<void> {
    await this.pool.query('delete from dateien');
  }
}

async function setzeVersion(c: pg.PoolClient, version: number): Promise<void> {
  await c.query(
    "insert into meta (schluessel, wert) values ('version', $1) on conflict (schluessel) do update set wert = excluded.wert",
    [JSON.stringify(version)],
  );
}

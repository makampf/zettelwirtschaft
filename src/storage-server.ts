import type { Speicher } from './storage';
import type { AppState, FileMeta } from './types';

// Speicherung in der Postgres-Datenbank des Servers (siehe server/).
const SAMMLUNGEN = ['people', 'invoices', 'submissions'] as const;
type Sammlung = (typeof SAMMLUNGEN)[number];
type Stand = { version: number; daten: Record<Sammlung, Map<string, string>> };

/** Pflicht-Header für ändernde Anfragen (CSRF-Schutz, siehe server/src/app.ts). */
const KOPF = { 'X-Zettelwirtschaft': '1' };

async function api<T>(methode: string, pfad: string, body?: BodyInit, kopf: Record<string, string> = {}): Promise<T> {
  const res = await fetch(pfad, { method: methode, body, headers: { ...KOPF, ...kopf }, credentials: 'same-origin' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Server antwortet mit ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return res.json() as Promise<T>;
}

function standVon(s: { version: number } & Record<Sammlung, { id: string }[]>): Stand {
  const daten = {} as Stand['daten'];
  for (const k of SAMMLUNGEN) daten[k] = new Map(s[k].map((d) => [d.id, JSON.stringify(d)]));
  return { version: s.version, daten };
}

export function serverSpeicher(): Speicher {
  // Zuletzt erfolgreich gespeicherter Stand – Grundlage für das Übertragen nur geänderter Datensätze
  let stand: Stand | null = null;
  let kette: Promise<void> = Promise.resolve();

  async function sende(state: AppState): Promise<void> {
    const upsert: Partial<Record<Sammlung, { id: string }[]>> = {};
    const remove: Partial<Record<Sammlung, string[]>> = {};
    let geaendert = !stand || stand.version !== state.version;
    for (const k of SAMMLUNGEN) {
      const alt = stand?.daten[k] ?? new Map<string, string>();
      const neu = state[k].filter((d) => alt.get(d.id) !== JSON.stringify(d));
      const weg = [...alt.keys()].filter((id) => !state[k].some((d) => d.id === id));
      if (neu.length) upsert[k] = neu;
      if (weg.length) remove[k] = weg;
      geaendert ||= neu.length > 0 || weg.length > 0;
    }
    if (!geaendert) return;
    await api('POST', 'api/changes', JSON.stringify({ version: state.version, upsert, delete: remove }), { 'Content-Type': 'application/json' });
    stand = standVon(state);
  }

  return {
    art: 'server',
    async lade() {
      const { state } = await api<{ state: AppState | null }>('GET', 'api/state');
      return state ?? undefined;
    },
    uebernommen(roh) {
      stand = roh ? standVon(roh as AppState) : null;
    },
    warte: () => kette.catch(() => undefined),
    speichere(state) {
      // Nacheinander senden; nach einem Fehler überträgt der nächste Aufruf die offenen Änderungen erneut.
      kette = kette.catch(() => undefined).then(() => sende(state));
      return kette;
    },
    async speichereDatei(meta: FileMeta, blob: Blob) {
      await api('PUT', `api/files/${encodeURIComponent(meta.id)}`, blob, {
        'Content-Type': meta.type || 'application/octet-stream',
        'X-File-Name': encodeURIComponent(meta.name),
      });
    },
    async ladeDatei(id: string) {
      const res = await fetch(`api/files/${encodeURIComponent(id)}`, { credentials: 'same-origin' });
      return res.ok ? res.blob() : undefined;
    },
    dateiUrl: (id: string) => `api/files/${encodeURIComponent(id)}`,
    async loescheDatei(id: string) {
      await api('DELETE', `api/files/${encodeURIComponent(id)}`);
    },
    async ersetzeAlles(state: AppState, dateien: Map<string, Blob>) {
      await kette.catch(() => undefined);
      await api('DELETE', 'api/files');
      for (const d of state.files) {
        const blob = dateien.get(d.id);
        if (blob) await this.speichereDatei(d, blob);
      }
      const { files: _ohne, ...rest } = state;
      await api('PUT', 'api/state', JSON.stringify(rest), { 'Content-Type': 'application/json' });
      stand = standVon(state);
    },
  };
}

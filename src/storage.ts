import { browserSpeicher } from './storage-browser';
import { serverSpeicher } from './storage-server';
import type { EingangsEintrag } from './eingang';
import type { AppState, FileMeta } from './types';

/** Dokumente, die von außen an den Server geschickt wurden (nur Server, wenn IMPORT_TOKEN gesetzt ist). */
export interface EingangApi {
  liste(): Promise<EingangsEintrag[]>;
  /** Zur Verarbeitung übernehmen; `false`, wenn ein anderes Fenster es schon bearbeitet. */
  uebernehmen(id: string): Promise<boolean>;
  /** Zur Prüfung von Hand markieren (mit Grund) bzw. zur erneuten automatischen Verarbeitung freigeben. */
  status(id: string, status: 'new' | 'review', note?: string): Promise<void>;
  datei(id: string): Promise<File | undefined>;
  dateiUrl(id: string): string;
  loeschen(id: string): Promise<void>;
}

/** Wo die Daten liegen: lokal im Browser oder in der Datenbank des Servers. */
export interface Speicher {
  art: 'browser' | 'server';
  /** Rohdaten laden (ggf. ältere Version – Migration erfolgt im Store). */
  lade(): Promise<unknown>;
  /** Die geladenen Rohdaten werden angezeigt und sind ab jetzt Vergleichsbasis für Änderungen (nur Server). */
  uebernommen?(roh: unknown): void;
  /** Wartet, bis laufende Speichervorgänge abgeschlossen sind. */
  warte?(): Promise<void>;
  speichere(state: AppState): Promise<void>;
  speichereDatei(meta: FileMeta, blob: Blob): Promise<void>;
  ladeDatei(id: string): Promise<Blob | undefined>;
  /** Direkt aufrufbare Adresse einer Datei (nur Server). */
  dateiUrl?(id: string): string;
  loescheDatei(id: string): Promise<void>;
  ersetzeAlles(state: AppState, dateien: Map<string, Blob>): Promise<void>;
  eingang?: EingangApi;
}

let aktiv: Speicher = browserSpeicher;

export function speicher(): Speicher {
  return aktiv;
}

/** Wird die App von unserem Server ausgeliefert, speichert sie in dessen Datenbank, sonst im Browser. */
export async function speicherErmitteln(): Promise<Speicher> {
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch('api/status', { signal: ctrl.signal, credentials: 'same-origin' });
      clearTimeout(timer);
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const status = (await res.json()) as { server?: boolean; import?: boolean };
        if (status.server) aktiv = serverSpeicher(!!status.import);
      }
    } catch {
      // kein Server erreichbar → Browser-Speicher
    }
  }
  return aktiv;
}

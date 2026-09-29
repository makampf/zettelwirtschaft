import type { Speicher } from './speicher';
import type { AppState, DateiMeta } from './types';

// Speicherung lokal im Browser (IndexedDB) – für die GitHub-Pages-Version und die Datei-Version.
// Name aus der Zeit vor der Umbenennung – bleibt, damit bereits gespeicherte Daten erhalten bleiben
const DB_NAME = 'rechnungsmanager';
const STATE_KEY = 'state';

let dbPromise: Promise<IDBDatabase> | undefined;

function oeffnen(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('dateien');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(store: string, modus: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await oeffnen();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, modus);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen, wenn Speicher knapp wird. */
async function dauerhaftSpeichern(): Promise<void> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return;
    await navigator.storage?.persist?.();
  } catch {
    // egal – nur eine Bitte an den Browser
  }
}

export const browserSpeicher: Speicher = {
  art: 'browser',
  async lade() {
    void dauerhaftSpeichern();
    return tx<unknown>('kv', 'readonly', (s) => s.get(STATE_KEY));
  },
  async speichere(state: AppState) {
    await tx('kv', 'readwrite', (s) => s.put(state, STATE_KEY));
  },
  async speichereDatei(meta: DateiMeta, blob: Blob) {
    await tx('dateien', 'readwrite', (s) => s.put(blob, meta.id));
  },
  async ladeDatei(id: string) {
    return tx<Blob | undefined>('dateien', 'readonly', (s) => s.get(id));
  },
  async loescheDatei(id: string) {
    await tx('dateien', 'readwrite', (s) => s.delete(id));
  },
  async ersetzeAlles(state: AppState, dateien: Map<string, Blob>) {
    await tx('dateien', 'readwrite', (s) => s.clear());
    for (const d of state.dateien) {
      const blob = dateien.get(d.id);
      if (blob) await this.speichereDatei(d, blob);
    }
    await this.speichere(state);
  },
};

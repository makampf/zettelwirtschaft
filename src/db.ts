import { migriere } from './migration';
import type { AppState } from './types';

// Alle Daten bleiben lokal im Browser (IndexedDB). Es gibt keinen Server.
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

export async function ladeState(): Promise<AppState | undefined> {
  const s = await tx<AppState | undefined>('kv', 'readonly', (st) => st.get(STATE_KEY));
  return s && migriere(s);
}

export async function speichereState(state: AppState): Promise<void> {
  await tx('kv', 'readwrite', (s) => s.put(state, STATE_KEY));
}

export async function speichereDatei(id: string, blob: Blob): Promise<void> {
  await tx('dateien', 'readwrite', (s) => s.put(blob, id));
}

export async function ladeDatei(id: string): Promise<Blob | undefined> {
  return tx<Blob | undefined>('dateien', 'readonly', (s) => s.get(id));
}

export async function loescheDatei(id: string): Promise<void> {
  await tx('dateien', 'readwrite', (s) => s.delete(id));
}

export async function loescheAlleDateien(): Promise<void> {
  await tx('dateien', 'readwrite', (s) => s.clear());
}

/** Bittet den Browser, die Daten nicht automatisch zu löschen, wenn Speicher knapp wird. */
export async function dauerhaftSpeichern(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

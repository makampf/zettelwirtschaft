import type { AppState } from './types';

/** Aktuelle Version des Datenmodells. */
export const DATA_VERSION = 1;

/**
 * Bringt gespeicherte Daten älterer Versionen auf den aktuellen Stand.
 * Für künftige Änderungen am Datenmodell: hier je Version einen Schritt ergänzen.
 */
export function migriere(roh: unknown): AppState {
  const s = roh as AppState;
  if (s?.version !== DATA_VERSION) {
    throw new Error(`Unbekannte Datenversion ${String(s?.version)} – erwartet wird Version ${DATA_VERSION}.`);
  }
  return s;
}

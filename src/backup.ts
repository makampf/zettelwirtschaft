import { speicher } from './storage';
import { migriere } from './migration';
import type { AppState } from './types';

export const BACKUP_FORMAT = 'zettelwirtschaft-backup';

interface Backup {
  format: string;
  erstelltAm: string;
  state: AppState;
  /** Dateiinhalte als Base64, Schlüssel = Datei-ID. */
  dateien: Record<string, string>;
}

function zuBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function vonBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

export async function backupErstellen(state: AppState): Promise<Blob> {
  const dateien: Record<string, string> = {};
  for (const d of state.dateien) {
    const blob = await speicher().ladeDatei(d.id);
    if (blob) dateien[d.id] = zuBase64(await blob.arrayBuffer());
  }
  const backup: Backup = { format: BACKUP_FORMAT, erstelltAm: new Date().toISOString(), state, dateien };
  return new Blob([JSON.stringify(backup)], { type: 'application/json' });
}

export async function backupLesen(datei: Blob): Promise<{ state: AppState; dateien: Map<string, Blob> }> {
  const b = JSON.parse(await datei.text()) as Backup;
  if (b?.format !== BACKUP_FORMAT || !b.state || !Array.isArray(b.state.personen)) {
    throw new Error('Die Datei ist keine gültige Sicherung der Zettelwirtschaft.');
  }
  const dateien = new Map<string, Blob>();
  for (const d of b.state.dateien ?? []) {
    const inhalt = b.dateien?.[d.id];
    if (inhalt) dateien.set(d.id, new Blob([vonBase64(inhalt)], { type: d.typ }));
  }
  const state = migriere(b.state);
  return { state: { ...state, dateien: (state.dateien ?? []).filter((d) => dateien.has(d.id)) }, dateien };
}

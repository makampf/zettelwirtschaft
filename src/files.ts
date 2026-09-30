import { datum } from './format';
import { KT_KURZ, type AppState, type FileMeta } from './types';

/** SHA-256 des Inhalts (hex) – erkennt denselben Beleg auch unter anderem Dateinamen. */
export async function dateiHash(blob: Blob): Promise<string | undefined> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined; // z. B. ohne sicheren Kontext – dann nur Vergleich über Name und Größe
  }
}

/** Gleiche Datei? Über den Inhalt, ersatzweise (ältere Dateien ohne Prüfsumme) über Name und Größe. */
export function gleicheDatei(meta: FileMeta, datei: { name: string; size: number }, hash: string | undefined): boolean {
  if (meta.hash && hash) return meta.hash === hash;
  return meta.name === datei.name && meta.size === datei.size;
}

/** Wo ist eine gespeicherte Datei angehängt? Z. B. „Rechnung Dr. Beispiel vom 12.03.2026 (Oma)“. */
export function dateiVerwendung(state: Pick<AppState, 'invoices' | 'submissions' | 'people'>, fileId: string): string | undefined {
  const r = state.invoices.find((x) => x.fileIds.includes(fileId));
  if (r) {
    const person = state.people.find((p) => p.id === r.personId)?.name;
    return `Rechnung ${r.provider || ''} vom ${datum(r.date)}${person ? ` (${person})` : ''}`.replace(/\s+/g, ' ');
  }
  const e = state.submissions.find((x) => x.fileIds.includes(fileId));
  if (e) return `Einreichung ${KT_KURZ[e.payer]} vom ${datum(e.submittedDate)}`;
  return undefined;
}

const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

/** Formatiert einen Cent-Betrag als Euro-Betrag, z. B. 12345 → "123,45 €". */
export function euro(cent: number): string {
  return euroFormat.format(cent / 100);
}

/**
 * Liest einen Euro-Betrag aus einer Benutzereingabe und liefert Cent.
 * Akzeptiert "1.234,56", "1234,56", "1234.56", "12,5 €". Liefert null bei ungültiger Eingabe.
 */
export function parseEuro(eingabe: string): number | null {
  let t = eingabe.trim().replace(/[\s€]/g, '');
  if (!t) return null;
  if (t.includes(',')) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) {
    // "1.234" ist im Deutschen ein Tausenderpunkt
    t = t.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

/** Cent-Betrag als Eingabetext, z. B. 12345 → "123,45". */
export function centAlsEingabe(cent: number | undefined): string {
  if (cent == null) return '';
  return (cent / 100).toFixed(2).replace('.', ',');
}

/** ISO-Datum (YYYY-MM-DD) im deutschen Format. */
export function datum(iso?: string): string {
  if (!iso) return '–';
  const [j, m, t] = iso.split('-');
  return `${t}.${m}.${j}`;
}

function iso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const t = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${t}`;
}

function parseIso(s: string): Date {
  const [j, m, t] = s.split('-').map(Number);
  return new Date(j, m - 1, t);
}

export function heute(): string {
  return iso(new Date());
}

/** Addiert Monate auf ein ISO-Datum; am Monatsende wird auf den letzten Tag gekürzt. */
export function plusMonate(s: string, monate: number): string {
  const d = parseIso(s);
  const tag = d.getDate();
  const ziel = new Date(d.getFullYear(), d.getMonth() + monate, 1);
  const letzterTag = new Date(ziel.getFullYear(), ziel.getMonth() + 1, 0).getDate();
  ziel.setDate(Math.min(tag, letzterTag));
  return iso(ziel);
}

export function plusTage(s: string, tage: number): string {
  const d = parseIso(s);
  d.setDate(d.getDate() + tage);
  return iso(d);
}

/** Anzahl Tage von `von` bis `bis` (negativ, wenn `bis` in der Vergangenheit liegt). */
export function tageZwischen(von: string, bis: string): number {
  return Math.round((parseIso(bis).getTime() - parseIso(von).getTime()) / 86_400_000);
}

export function neueId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function dateigroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

import type { Invoice, Payer, SubmissionItem } from '../types';
import { tageZwischen } from '../format';
import { betraegeIn, datenIn } from './parser';

/** Eine Zeile einer Leistungsabrechnung bzw. eines Beihilfebescheids mit Datum und Beträgen. */
export interface AbrechnungsZeile {
  /** Datum der Rechnung (bzw. erstes Datum der Zeile). */
  date: string;
  /** Alle Beträge der Zeile in Cent, in Leserichtung. */
  amounts: number[];
  /** Beleg ist in dieser Abrechnung noch nicht berücksichtigt („noch offen“). */
  pending: boolean;
  text: string;
}

export interface Abrechnung {
  /** Datum der Abrechnung / des Bescheids. */
  date?: string;
  /** Gesamter Auszahlungsbetrag in Cent. */
  total?: number;
  /** Vermutete Stelle (nur Beihilfe lässt sich sicher erkennen). */
  payer?: Payer;
  zeilen: AbrechnungsZeile[];
}

const OFFEN = /noch\s+o[fT]{0,2}en|nicht\s+berücksichtigt|in\s+bearbeitung|zurückgestellt/i;
const KEINE_POSITION = /gesamt|summe|überwiesen|iban|konto|seite\s+\d|abrechnung\s+vom|bescheid\s+vom|geb(\.|oren|urtsdatum)/i;
/** Hinweise auf den Gesamtbetrag, nach Verlässlichkeit geordnet. */
const GESAMT: RegExp[] = [
  /überwiesene\s+beihilfe|gesamtsumme|gesamtbetrag|auszahlungsbetrag|erstattungsbetrag|beihilfebetrag|betrag\s+über|summe\s+der\s+erstattung/i,
  /in\s+höhe\s+von|festgesetzt/i,
  /^summen?\b/i,
];
/** Leistungszeitraum („01.04.2026 - 30.04.2026“) – Detailzeile, keine Rechnung. */
const ZEITRAUM = /\d{1,2}\.\d{1,2}\.\d{2,4}\s*[-–]\s*\d{1,2}\.\d{1,2}\.\d{2,4}/;

/** Liest Datum, Gesamtsumme und die abgerechneten Positionen aus dem Text einer Abrechnung. */
export function abrechnungAuslesen(roh: string): Abrechnung {
  const zeilen = roh.replace(/ /g, ' ').split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  const a: Abrechnung = { zeilen: [] };

  for (const z of zeilen) {
    const m = /(?:abrechnung|bescheid|schreiben|leistungsabrechnung)\s+vom\s*:?\s*(.*)$/i.exec(z);
    const d = m && datenIn(m[1])[0];
    if (d) {
      a.date = d;
      break;
    }
  }
  gesamt: for (const re of GESAMT) {
    for (const z of zeilen) {
      const b = re.test(z) ? betraegeIn(z) : [];
      if (b.length) {
        a.total = b[b.length - 1];
        break gesamt;
      }
    }
  }
  if (/beihilfe/i.test(zeilen.slice(0, 30).join(' ')) && /bescheid|festsetzung/i.test(roh)) a.payer = 'beihilfe';

  for (const z of zeilen) {
    if (KEINE_POSITION.test(z) || ZEITRAUM.test(z)) continue;
    const daten = datenIn(z);
    const amounts = betraegeIn(z);
    if (!daten.length || !amounts.length) continue;
    a.zeilen.push({ date: daten[0], amounts, pending: OFFEN.test(z), text: z });
  }
  return a;
}

export interface Zuordnung {
  invoiceId: string;
  /** Erstattung laut Abrechnung; fehlt bei „noch offen“ oder wenn keine Auszahlung erkennbar ist. */
  reimbursed?: number;
  pending: boolean;
  /** Nur über den Betrag zugeordnet (Datum weicht ab) – sollte geprüft werden. */
  unsicher?: boolean;
  zeile: AbrechnungsZeile;
}

/** Größter Abstand zwischen Datum in der Abrechnung und Rechnungsdatum, wenn nur der Betrag übereinstimmt. */
export const MAX_TAGE_ABWEICHUNG = 60;

/**
 * Ordnet die Zeilen einer Abrechnung Rechnungen zu – über Rechnungsdatum und Betrag, ersatzweise über den Betrag bei
 * nahem Datum. Die Erstattung ist der letzte Betrag der Zeile hinter dem Rechnungsbetrag.
 * `positionen` sind die bisherigen Positionen der Einreichung: schon abgerechnete Rechnungen werden nur erneut
 * zugeordnet, wenn dieselbe Abrechnung noch einmal eingelesen wird (gleiche Erstattung) – so bekommt bei zwei
 * Rechnungen mit gleichem Betrag nicht dieselbe Rechnung beide Erstattungen.
 */
export function abrechnungZuordnen(
  a: Abrechnung,
  rechnungen: Invoice[],
  positionen: SubmissionItem[] = [],
): { zuordnungen: Zuordnung[]; offen: AbrechnungsZeile[] } {
  const frei = new Set(rechnungen.map((r) => r.id));
  const zuordnungen: Zuordnung[] = [];
  const offen: AbrechnungsZeile[] = [];
  const erledigt = new Map(positionen.filter(abgerechnet).map((p) => [p.invoiceId, p]));
  const erstattung = (zeile: AbrechnungsZeile, r: Invoice) => {
    const danach = zeile.amounts.slice(zeile.amounts.indexOf(r.amount) + 1);
    return zeile.pending || !danach.length ? undefined : danach[danach.length - 1];
  };
  const zuordnen = (zeile: AbrechnungsZeile, r: Invoice, unsicher = false) => {
    frei.delete(r.id);
    zuordnungen.push({ invoiceId: r.id, pending: zeile.pending, reimbursed: erstattung(zeile, r), zeile, ...(unsicher && { unsicher }) });
  };

  // 1. Datum und Betrag stimmen überein – offene Rechnungen zuerst, erledigte nur bei gleicher Erstattung
  const rest: AbrechnungsZeile[] = [];
  for (const zeile of a.zeilen) {
    const passend = rechnungen.filter((x) => frei.has(x.id) && x.date === zeile.date && zeile.amounts.includes(x.amount));
    const r =
      passend.find((x) => !erledigt.has(x.id)) ??
      passend.find((x) => !zeile.pending && erledigt.get(x.id)?.reimbursed === erstattung(zeile, x));
    if (r) zuordnen(zeile, r);
    else rest.push(zeile);
  }
  // 2. Nur der Betrag (manche Abrechnungen nennen das Behandlungs- statt Rechnungsdatum): offene Rechnung mit dem
  //    nächstliegenden Datum, höchstens MAX_TAGE_ABWEICHUNG Tage entfernt und eindeutig
  for (const zeile of rest) {
    const kandidaten = rechnungen
      .filter((x) => frei.has(x.id) && !erledigt.has(x.id) && zeile.amounts[0] === x.amount)
      .map((x) => ({ x, tage: Math.abs(tageZwischen(zeile.date, x.date)) }))
      .filter((k) => k.tage <= MAX_TAGE_ABWEICHUNG)
      .sort((p, q) => p.tage - q.tage);
    if (kandidaten.length && (kandidaten.length === 1 || kandidaten[0].tage < kandidaten[1].tage)) zuordnen(zeile, kandidaten[0].x, true);
    else offen.push(zeile);
  }
  return { zuordnungen, offen };
}

/** Wurde die Position schon abgerechnet (Erstattung eingetragen oder mit Bescheiddatum gespeichert, nicht „noch offen“)? */
export function abgerechnet(p: SubmissionItem): boolean {
  return !p.pending && (p.reimbursed != null || p.decisionDate != null);
}

/**
 * Überträgt eine Zuordnung auf die Positionen einer Einreichung. Rechnungen, die in der Abrechnung nicht vorkommen,
 * sind darin noch nicht abgerechnet und werden als „noch offen“ markiert – außer sie wurden schon mit einer früheren
 * Abrechnung erledigt (eine Einreichung kann in mehreren Abrechnungen beschieden werden).
 */
export function positionenAusAbrechnung(items: SubmissionItem[], zuordnungen: Zuordnung[], datum?: string): SubmissionItem[] {
  return items.map((p) => {
    const z = zuordnungen.find((x) => x.invoiceId === p.invoiceId);
    if (!z) return abgerechnet(p) ? p : { ...p, pending: true, reimbursed: undefined, decisionDate: undefined, fileId: undefined };
    if (z.pending) return { ...p, pending: true, reimbursed: undefined, decisionDate: undefined, fileId: undefined };
    return { ...p, pending: undefined, reimbursed: z.reimbursed ?? p.reimbursed, decisionDate: datum ?? p.decisionDate };
  });
}

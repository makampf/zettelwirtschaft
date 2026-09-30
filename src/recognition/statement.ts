import type { Invoice, Payer, SubmissionItem } from '../types';
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
  zeile: AbrechnungsZeile;
}

/**
 * Ordnet die Zeilen einer Abrechnung Rechnungen zu – über Rechnungsdatum und Betrag, ersatzweise nur über einen
 * eindeutigen Betrag. Die Erstattung ist der letzte Betrag der Zeile hinter dem Rechnungsbetrag.
 */
export function abrechnungZuordnen(a: Abrechnung, rechnungen: Invoice[]): { zuordnungen: Zuordnung[]; offen: AbrechnungsZeile[] } {
  const frei = new Set(rechnungen.map((r) => r.id));
  const zuordnungen: Zuordnung[] = [];
  const offen: AbrechnungsZeile[] = [];
  const zuordnen = (zeile: AbrechnungsZeile, r: Invoice) => {
    frei.delete(r.id);
    const danach = zeile.amounts.slice(zeile.amounts.indexOf(r.amount) + 1);
    zuordnungen.push({
      invoiceId: r.id,
      pending: zeile.pending,
      reimbursed: zeile.pending || !danach.length ? undefined : danach[danach.length - 1],
      zeile,
    });
  };

  // 1. Datum und Betrag stimmen überein
  const rest: AbrechnungsZeile[] = [];
  for (const zeile of a.zeilen) {
    const r = rechnungen.find((x) => frei.has(x.id) && x.date === zeile.date && zeile.amounts.includes(x.amount));
    if (r) zuordnen(zeile, r);
    else rest.push(zeile);
  }
  // 2. Nur der Betrag – wenn eindeutig (manche Abrechnungen nennen das Behandlungs- statt Rechnungsdatum)
  for (const zeile of rest) {
    const passend = rechnungen.filter((x) => frei.has(x.id) && zeile.amounts[0] === x.amount);
    if (passend.length === 1) zuordnen(zeile, passend[0]);
    else offen.push(zeile);
  }
  return { zuordnungen, offen };
}

/**
 * Überträgt eine Zuordnung auf die Positionen einer Einreichung. Rechnungen, die in der Abrechnung nicht vorkommen,
 * sind darin noch nicht abgerechnet und werden als „noch offen“ markiert.
 */
export function positionenAusAbrechnung(items: SubmissionItem[], zuordnungen: Zuordnung[]): SubmissionItem[] {
  return items.map((p) => {
    const z = zuordnungen.find((x) => x.invoiceId === p.invoiceId);
    if (!z) return { ...p, pending: true, reimbursed: undefined };
    return z.pending ? { ...p, pending: true, reimbursed: undefined } : { ...p, pending: undefined, reimbursed: z.reimbursed ?? p.reimbursed };
  });
}

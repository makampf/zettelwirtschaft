import { moeglicheDuplikate, standardZurueckhalten, versicherungFuer } from './calc';
import { leereRechnung } from './defaults';
import { datum, euro, heute } from './format';
import { erbringerListe } from './providers';
import { rechnungAuslesen } from './recognition/parser';
import { abgerechnet, abrechnungAuslesen, abrechnungZuordnen, positionenAusAbrechnung, type Abrechnung, type Zuordnung } from './recognition/statement';
import type { AppState, Invoice, Submission } from './types';

// Eingang: Dokumente, die von außen (z. B. per Webhook aus Paperless-ngx) an den Server geschickt wurden.
// Die App liest sie wie einen hochgeladenen Beleg aus und erfasst sie – aber nur, wenn das Ergebnis eindeutig ist.
// Alles andere bleibt im Eingang und wird von Hand erfasst.

export interface EingangsEintrag {
  id: string;
  name: string;
  type: string;
  size: number;
  hash: string;
  /** Angaben des Absenders, z. B. title, document_type, correspondent, doc_url, kind. */
  data: Record<string, string>;
  status: 'new' | 'processing' | 'review';
  /** Warum das Dokument nicht automatisch erfasst wurde. */
  note?: string;
  receivedAt: string;
}

export type BelegArt = 'invoice' | 'statement';

/** Hinweis im Dokumenttyp/Titel auf eine Abrechnung („Abrechnungsstelle“ ist dagegen ein Rechnungssteller). */
const ABRECHNUNG_NAME = /statement|abrechnung(?!s?stelle)|bescheid|erstattung/i;
const RECHNUNG_NAME = /invoice|rechnung|liquidation/i;
/** Formulierungen, die nur in Leistungsabrechnungen und Beihilfebescheiden vorkommen. */
const ABRECHNUNG_TEXT =
  /leistungsabrechnung|beihilfebescheid|bescheid\s+über\s+(die\s+)?(gewährung\s+(einer|von)\s+)?beihilfe|festsetzung\s+der\s+beihilfe|überwiesene\s+beihilfe|erstattungsbetrag|wir\s+erstatten|ihre\s+erstattung/i;

/** Rechnung oder Abrechnung? Ausdrückliche Angabe des Absenders vor Dokumenttyp/Titel vor dem Text. */
export function belegArt(text: string, data: Record<string, string> = {}): BelegArt {
  const kind = (data.kind ?? '').trim().toLowerCase();
  if (/^(invoice|rechnung)$/.test(kind)) return 'invoice';
  if (/^(statement|abrechnung|bescheid)$/.test(kind)) return 'statement';
  const name = [data.document_type, data.title].filter(Boolean).join(' ');
  if (ABRECHNUNG_NAME.test(name)) return 'statement';
  if (RECHNUNG_NAME.test(name)) return 'invoice';
  return ABRECHNUNG_TEXT.test(text) ? 'statement' : 'invoice';
}

export type Ergebnis<T> = { ok: T } | { grund: string };

/** Erkennt eine Rechnung vollständig genug, um sie ohne Rückfrage anzulegen (ohne Belege – die hängt der Aufrufer an). */
export function rechnungAusText(text: string, data: Record<string, string>, state: AppState): Ergebnis<Invoice> {
  const e = rechnungAuslesen(text, {
    personen: state.people,
    bekannteErbringer: erbringerListe(state.invoices).map((x) => x.name),
    bekannteVerrechnungsstellen: [...new Set(state.invoices.map((x) => x.billingOffice?.trim()).filter((x): x is string => !!x))],
    heute: heute(),
  });
  const personId = e.personId ?? (state.people.length === 1 ? state.people[0].id : undefined);
  const person = state.people.find((p) => p.id === personId);
  const provider = e.provider ?? data.correspondent?.trim();
  const fehlt = [e.amount == null && 'Betrag', !e.date && 'Rechnungsdatum', !person && 'Person', !provider && 'Leistungserbringer'].filter(Boolean);
  if (fehlt.length || e.amount == null || !e.date || !person || !provider) return { grund: `Nicht erkannt: ${fehlt.join(', ')}` };

  const r: Invoice = {
    ...leereRechnung(person.id, e.kind ?? 'illness'),
    date: e.date,
    amount: e.amount,
    provider,
    billingOffice: e.billingOffice,
    invoiceNumber: e.invoiceNumber ?? '',
    dueDate: e.dueDate,
    preventive: !!e.preventive,
    note: data.doc_url ? `Aus Paperless: ${data.doc_url}` : 'Automatisch aus dem Eingang erfasst',
    toReview: true,
  };
  if (standardZurueckhalten(r, person, state)) r.heldBack = [versicherungFuer(r.kind, person)];
  const doppelt = moeglicheDuplikate(r, state.invoices);
  if (doppelt.length) {
    const x = doppelt[0];
    return { grund: `Möglicherweise schon erfasst: ${x.provider || 'Rechnung'} vom ${datum(x.date)} über ${euro(x.amount)}` };
  }
  return { ok: r };
}

/** Von welcher Art Stelle stammt die Abrechnung? Für die automatische Zuordnung muss das feststehen. */
export function abrechnungsStelle(a: Abrechnung, text: string): 'beihilfe' | 'versicherung' | undefined {
  if (a.payer === 'beihilfe' || /beihilfe(stelle|bescheid|festsetzung)|festsetzungsstelle|bemessungssatz/i.test(text)) return 'beihilfe';
  if (/versicherung|leistungsabrechnung|tarif/i.test(text)) return 'versicherung';
  return undefined;
}

export interface AbrechnungsTreffer {
  e: Submission;
  zuordnungen: Zuordnung[];
  punkte: number;
}

/** Einreichungen, deren Rechnungen in der Abrechnung vorkommen – die wahrscheinlichste zuerst. */
export function einreichungenFuerAbrechnung(a: Abrechnung, state: Pick<AppState, 'invoices' | 'submissions'>, stelle?: 'beihilfe' | 'versicherung'): AbrechnungsTreffer[] {
  const rechnungen = new Map(state.invoices.map((r) => [r.id, r]));
  const treffer: AbrechnungsTreffer[] = [];
  for (const e of state.submissions) {
    if (stelle && (e.payer === 'beihilfe') !== (stelle === 'beihilfe')) continue;
    const rs = e.items.map((p) => rechnungen.get(p.invoiceId)).filter((r): r is Invoice => !!r);
    const zuordnungen = abrechnungZuordnen(a, rs, e.items).zuordnungen;
    if (!zuordnungen.length) continue;
    // Sichere Treffer (Datum + Betrag) zählen mehr; offene Einreichungen und passende Stelle bevorzugen
    const offene = e.items.some((p) => !abgerechnet(p));
    const punkte = zuordnungen.reduce((s, x) => s + (x.unsicher ? 3 : 10), 0) + (offene ? 5 : 0) + (a.payer && a.payer === e.payer ? 3 : 0);
    treffer.push({ e, zuordnungen, punkte });
  }
  return treffer.sort((x, y) => y.punkte - x.punkte);
}

/**
 * Überträgt eine Abrechnung ohne Rückfrage auf die passenden Einreichungen – nur wenn alles eindeutig ist:
 * Stelle erkannt, alle Treffer über Datum und Betrag, und die Gesamtsumme stimmt (bzw. ohne erkannte Summe: keine
 * Position bleibt übrig). Eine Abrechnung kann Rechnungen mehrerer Einreichungen enthalten.
 */
export function abrechnungAutomatisch(text: string, state: AppState, fileId: string): Ergebnis<Submission[]> {
  const a = abrechnungAuslesen(text);
  const stelle = abrechnungsStelle(a, text);
  if (!stelle) return { grund: 'Nicht erkannt, ob die Abrechnung von der Beihilfe oder der Versicherung stammt' };
  if (!a.zeilen.length) return { grund: 'Keine Positionen in der Abrechnung erkannt' };

  let rest = a.zeilen;
  const gewaehlt: AbrechnungsTreffer[] = [];
  for (;;) {
    const kandidaten = einreichungenFuerAbrechnung({ ...a, zeilen: rest }, state, stelle).filter(
      (t) => !gewaehlt.some((g) => g.e.id === t.e.id) && t.zuordnungen.some((z) => !abgerechnet(t.e.items.find((p) => p.invoiceId === z.invoiceId)!)),
    );
    const t = kandidaten[0];
    if (!t) break;
    if (t.zuordnungen.some((z) => z.unsicher)) return { grund: 'Einige Rechnungen passen nur über den Betrag (Datum weicht ab) – bitte prüfen' };
    if (t.zuordnungen.some((z) => !z.pending && z.reimbursed == null)) return { grund: 'Erstattung nicht bei allen Positionen erkannt' };
    gewaehlt.push(t);
    const benutzt = new Set(t.zuordnungen.map((z) => z.zeile));
    rest = rest.filter((z) => !benutzt.has(z));
  }
  if (!gewaehlt.length) return { grund: 'Keine Einreichung enthält Rechnungen aus dieser Abrechnung (Rechnungsdatum und Betrag müssen passen)' };

  const erstattet = gewaehlt.flatMap((t) => t.zuordnungen).reduce((s, z) => s + (z.reimbursed ?? 0), 0);
  if (a.total != null && a.total !== erstattet) {
    return { grund: `Gesamtsumme laut Abrechnung ${euro(a.total)}, zugeordnet ${euro(erstattet)} – bitte prüfen` };
  }
  const uebrig = rest.filter((z) => !z.pending).length;
  if (a.total == null && uebrig) return { grund: `${uebrig} Position(en) der Abrechnung passen zu keiner Rechnung – bitte prüfen` };

  const bescheid = a.date ?? heute();
  return {
    ok: gewaehlt.map(({ e, zuordnungen }) => {
      const sicher = new Set(zuordnungen.filter((z) => !z.pending).map((z) => z.invoiceId));
      const items = positionenAusAbrechnung(e.items, zuordnungen, bescheid).map((p) => (sicher.has(p.invoiceId) ? { ...p, fileId } : p));
      return {
        ...e,
        items,
        status: 'decided',
        decisionDate: e.decisionDate && e.decisionDate > bescheid ? e.decisionDate : bescheid,
        fileIds: [...e.fileIds, fileId],
        toReview: true,
      };
    }),
  };
}

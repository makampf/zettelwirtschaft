import { heute, plusMonate, tageZwischen } from './format';
import { ktKurz, type AppState, type Submission, type Payer, type ServiceKind, type Person, type Invoice } from './types';

/** Datenbasis für Berechnungen, die andere Rechnungen oder Einreichungen berücksichtigen. */
export type Kontext = Pick<AppState, 'invoices' | 'submissions'>;

/** Sparte der privaten Versicherung nach Leistungsart (für Auswertungen): Krankheit → PKV, Pflege → PPV. */
export function sparte(art: ServiceKind): 'pkv' | 'ppv' {
  return art === 'illness' ? 'pkv' : 'ppv';
}

/** Private Versicherung, bei der eine Rechnung eingereicht wird – bei gemeinsamem Vertrag (KV + PV) immer die PKV. */
export function versicherungFuer(art: ServiceKind, person: Person): 'pkv' | 'ppv' {
  return art === 'illness' || person.pkv.includesCare ? 'pkv' : 'ppv';
}

/** Welche Stellen sind für eine Leistungsart bei dieser Person zuständig? */
export function traegerFuer(art: ServiceKind, person: Person): Payer[] {
  const versicherung = versicherungFuer(art, person);
  return person.beihilfe.eligible ? ['beihilfe', versicherung] : [versicherung];
}

/** Erstattungsquote in Prozent für Person, Leistungsart und Kostenträger. */
export function quote(person: Person, art: ServiceKind, kt: Payer): number {
  if (kt === 'beihilfe') {
    if (!person.beihilfe.eligible) return 0;
    return art === 'illness' ? person.beihilfe.rateIllness : person.beihilfe.rateCare;
  }
  // Pflege: eigene Quote, auch wenn die Pflegeversicherung Teil des PKV-Vertrags ist
  return art === 'care' ? person.ppv.rate : person.pkv.rate;
}

/** Erstattung der privaten Versicherung vor Selbstbehalt. */
function versicherungBrutto(r: Invoice, person: Person): number {
  return Math.round((r.amount * quote(person, r.kind, versicherungFuer(r.kind, person))) / 100);
}

/** Betrifft der Tarif (Selbstbehalt/BRE) diese Leistungsart? Pflege nur, wenn KV und PV ein gemeinsamer Vertrag sind. */
function tarifBetrifft(r: Invoice, person: Person): boolean {
  return !r.preventive && (r.kind === 'illness' || person.pkv.includesCare);
}

/** Unterliegt die Rechnung dem Selbstbehalt? (keine Vorsorge, Tarif mit Selbstbehalt) */
function selbstbehaltPflichtig(r: Invoice, person: Person): boolean {
  return person.pkv.deductiblePercent > 0 && tarifBetrifft(r, person);
}

/**
 * Verteilt den jährlichen Selbstbehalt in Reihenfolge der Rechnungsdaten auf die Rechnungen.
 * Liefert je Rechnungs-ID den Selbstbehalt in Cent.
 */
function selbstbehaltVerteilen(liste: Invoice[], person: Person): Map<string, number> {
  const ergebnis = new Map<string, number>();
  const sortiert = [...liste].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  let verbraucht = 0;
  for (const r of sortiert) {
    const sb = Math.min(Math.round((versicherungBrutto(r, person) * person.pkv.deductiblePercent) / 100), Math.max(0, person.pkv.deductibleMax - verbraucht));
    ergebnis.set(r.id, sb);
    verbraucht += sb;
  }
  return ergebnis;
}

/**
 * Selbstbehalt, der voraussichtlich von der Versicherungserstattung (PKV bzw. PPV) dieser Rechnung abgezogen wird.
 * Berücksichtigt alle früheren Rechnungen desselben Jahres, die bei der Versicherung eingereicht werden.
 * `r` darf ein noch ungespeicherter Entwurf sein.
 */
export function selbstbehalt(r: Invoice, person: Person, rechnungen: Invoice[]): number {
  if (!selbstbehaltPflichtig(r, person)) return 0;
  const jahr = r.date.slice(0, 4);
  const liste = [...rechnungen.filter((x) => x.id !== r.id), r].filter(
    (x) => x.personId === r.personId && x.date.startsWith(jahr) && selbstbehaltPflichtig(x, person) && !x.heldBack.includes(versicherungFuer(x.kind, person)),
  );
  if (!liste.includes(r)) liste.push(r);
  return selbstbehaltVerteilen(liste, person).get(r.id) ?? 0;
}

/** Erwartete Erstattung in Cent (manueller Wert hat Vorrang vor Quote und Selbstbehalt). */
export function erwartet(r: Invoice, person: Person, kt: Payer, rechnungen: Invoice[]): number {
  const manuell = r.expectedOverride[kt];
  if (manuell != null) return manuell;
  if (kt === versicherungFuer(r.kind, person)) return versicherungBrutto(r, person) - selbstbehalt(r, person, rechnungen);
  return Math.round((r.amount * quote(person, r.kind, kt)) / 100);
}

/** Erwartete Erstattung einer Rechnung; die Person wird aus dem Zustand ermittelt. */
export function erwartetFuerRechnung(state: Pick<AppState, 'people' | 'invoices'>, r: Invoice, kt: Payer): number {
  const person = state.people.find((p) => p.id === r.personId);
  return person ? erwartet(r, person, kt, state.invoices) : 0;
}

export type TraegerStatus = 'offen' | 'nicht_einreichen' | 'eingereicht' | 'erstattet' | 'abgelehnt';

export const STATUS_NAME: Record<TraegerStatus, string> = {
  offen: 'noch einreichen',
  nicht_einreichen: 'zurückgehalten',
  eingereicht: 'eingereicht',
  erstattet: 'erstattet',
  abgelehnt: 'abgelehnt',
};

export interface TraegerInfo {
  kt: Payer;
  status: TraegerStatus;
  erwartet: number;
  erstattet?: number;
  einreichung?: Submission;
}

/** Jüngste Einreichung einer Rechnung bei einem Kostenträger. */
function letzteEinreichung(r: Invoice, kt: Payer, einreichungen: Submission[]): Submission | undefined {
  let letzte: Submission | undefined;
  for (const e of einreichungen) {
    if (e.payer !== kt || !e.items.some((p) => p.invoiceId === r.id)) continue;
    if (!letzte || e.submittedDate >= letzte.submittedDate) letzte = e;
  }
  return letzte;
}

/** Status einer Rechnung bei einem Kostenträger – maßgeblich ist die jüngste Einreichung. */
export function traegerInfo(r: Invoice, person: Person, kt: Payer, ctx: Kontext): TraegerInfo {
  const erw = erwartet(r, person, kt, ctx.invoices);
  const letzte = letzteEinreichung(r, kt, ctx.submissions);
  if (!letzte) {
    return { kt, status: r.heldBack.includes(kt) ? 'nicht_einreichen' : 'offen', erwartet: erw };
  }
  if (letzte.status === 'submitted') return { kt, status: 'eingereicht', erwartet: erw, einreichung: letzte };
  const pos = letzte.items.find((p) => p.invoiceId === r.id);
  if (pos?.pending) return { kt, status: 'eingereicht', erwartet: erw, einreichung: letzte };
  const erst = pos?.reimbursed ?? 0;
  return { kt, status: erst > 0 ? 'erstattet' : 'abgelehnt', erwartet: erw, erstattet: erst, einreichung: letzte };
}

export interface RechnungUebersicht {
  infos: TraegerInfo[];
  /** Tatsächlich erstattete Summe laut Bescheiden. */
  erstattet: number;
  /** Noch ausstehende (erwartete) Erstattungen für eingereichte und noch einzureichende Positionen. */
  ausstehend: number;
  /** Voraussichtlicher Eigenanteil (Betrag − erstattet − ausstehend). */
  eigenanteil: number;
  /** Alle Kostenträger sind erledigt (erstattet, abgelehnt oder bewusst zurückgehalten). */
  abgeschlossen: boolean;
}

export function rechnungUebersicht(r: Invoice, person: Person, ctx: Kontext): RechnungUebersicht {
  const infos = traegerFuer(r.kind, person).map((kt) => traegerInfo(r, person, kt, ctx));
  let erstattet = 0;
  let ausstehend = 0;
  for (const i of infos) {
    if (i.status === 'erstattet') erstattet += i.erstattet ?? 0;
    if (i.status === 'offen' || i.status === 'eingereicht') ausstehend += i.erwartet;
  }
  return {
    infos,
    erstattet,
    ausstehend,
    eigenanteil: r.amount - erstattet - ausstehend,
    abgeschlossen: infos.every((i) => i.status !== 'offen' && i.status !== 'eingereicht'),
  };
}

/** Ende der Beihilfe-Antragsfrist für eine Rechnung. */
export function beihilfeFristEnde(r: Invoice, person: Person): string {
  return plusMonate(r.date, person.beihilfe.deadlineMonths);
}

/** Rechnungen, die bei einem Kostenträger (erneut) eingereicht werden können. */
export function einreichbareRechnungen(state: AppState, personId: string, kt: Payer, ausserEinreichung?: string): Invoice[] {
  const person = state.people.find((p) => p.id === personId);
  if (!person) return [];
  const ctx: Kontext = { invoices: state.invoices, submissions: state.submissions.filter((e) => e.id !== ausserEinreichung) };
  return state.invoices
    .filter((r) => r.personId === personId && traegerFuer(r.kind, person).includes(kt))
    .filter((r) => {
      const s = traegerInfo(r, person, kt, ctx).status;
      return s === 'offen' || s === 'abgelehnt';
    })
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Mögliche Duplikate einer (ggf. noch ungespeicherten) Rechnung derselben Person:
 * gleiche Rechnungsnummer oder gleiches Datum mit gleichem Betrag.
 */
export function moeglicheDuplikate(r: Pick<Invoice, 'id' | 'personId' | 'date' | 'amount' | 'invoiceNumber'>, rechnungen: Invoice[]): Invoice[] {
  const nr = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const eigene = nr(r.invoiceNumber);
  return rechnungen.filter(
    (x) =>
      x.id !== r.id &&
      x.personId === r.personId &&
      ((eigene.length >= 4 && nr(x.invoiceNumber) === eigene) || (!!r.date && x.date === r.date && r.amount > 0 && x.amount === r.amount)),
  );
}

/** Rechnungen, die bei einem Kostenträger bewusst zurückgehalten werden (z. B. für die BRE) und noch nicht eingereicht sind. */
export function zurueckgehalteneRechnungen(state: AppState, personId: string, kt: Payer, ausserEinreichung?: string): Invoice[] {
  const person = state.people.find((p) => p.id === personId);
  if (!person) return [];
  const ctx: Kontext = { invoices: state.invoices, submissions: state.submissions.filter((e) => e.id !== ausserEinreichung) };
  return state.invoices
    .filter((r) => r.personId === personId && traegerFuer(r.kind, person).includes(kt) && traegerInfo(r, person, kt, ctx).status === 'nicht_einreichen')
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Stellen, bei denen für diese Personen überhaupt eingereicht werden kann (Beihilfe nur bei Berechtigung). */
export function zustaendigeStellen(personen: Person[]): Payer[] {
  const stellen = new Set(personen.flatMap((p) => [...traegerFuer('illness', p), ...traegerFuer('care', p)]));
  return (['beihilfe', 'pkv', 'ppv'] as Payer[]).filter((k) => stellen.has(k));
}

// ---------------------------------------------------------------------------
// Beitragsrückerstattung (BRE)

export interface BreCheck {
  personId: string;
  jahr: number;
  /** BRE bei Leistungsfreiheit in Cent (0 = Betrag unbekannt). */
  bre: number;
  /** BRE-relevante Rechnungen des Jahres (ohne Vorsorge; Pflege nur bei gemeinsamem Tarif). */
  rechnungen: Invoice[];
  betrag: number;
  /** Versicherungserstattung (nach Selbstbehalt), wenn alle diese Rechnungen eingereicht würden. */
  erstattungBeiEinreichung: number;
  /** Bereits bei der Versicherung eingereicht → BRE für dieses Jahr entfällt. */
  eingereicht: Invoice[];
  /** Noch nicht eingereicht und nicht zurückgehalten. */
  offen: Invoice[];
  /** Bewusst zurückgehalten. */
  zurueckgehalten: Invoice[];
  /** Ohne bekannten BRE-Betrag ist keine Empfehlung möglich. */
  empfehlung: 'zurueckhalten' | 'einreichen' | 'unbekannt';
  /** Finanzieller Vorteil der Empfehlung gegenüber der Alternative in Cent. */
  vorteil: number;
}

/** BRE-relevant: Rechnung ohne Vorsorge, die (anteilig) an die private Versicherung des Tarifs gehen würde. */
export function breRelevant(r: Invoice, person: Person): boolean {
  return person.pkv.premiumRefundEnabled && tarifBetrifft(r, person) && quote(person, r.kind, versicherungFuer(r.kind, person)) > 0;
}

/** Vergleicht für ein Jahr: alles bei der Versicherung einreichen oder zurückhalten und BRE erhalten? */
export function breCheck(ctx: Kontext, person: Person, jahr: number): BreCheck | null {
  if (!person.pkv.premiumRefundEnabled) return null;
  const liste = ctx.invoices.filter((r) => r.personId === person.id && r.date.startsWith(`${jahr}-`) && breRelevant(r, person));
  const sb = selbstbehaltVerteilen(liste.filter((r) => selbstbehaltPflichtig(r, person)), person);
  let erstattung = 0;
  const eingereicht: Invoice[] = [];
  const offen: Invoice[] = [];
  const zurueckgehalten: Invoice[] = [];
  for (const r of liste) {
    const kt = versicherungFuer(r.kind, person);
    erstattung += r.expectedOverride[kt] ?? versicherungBrutto(r, person) - (sb.get(r.id) ?? 0);
    const e = letzteEinreichung(r, kt, ctx.submissions);
    if (e) eingereicht.push(r);
    else if (r.heldBack.includes(kt)) zurueckgehalten.push(r);
    else offen.push(r);
  }
  const unbekannt = !person.pkv.premiumRefund;
  const einreichen = erstattung > person.pkv.premiumRefund;
  return {
    personId: person.id,
    jahr,
    bre: person.pkv.premiumRefund,
    rechnungen: liste,
    betrag: liste.reduce((s, r) => s + r.amount, 0),
    erstattungBeiEinreichung: erstattung,
    eingereicht,
    offen,
    zurueckgehalten,
    empfehlung: unbekannt ? 'unbekannt' : einreichen ? 'einreichen' : 'zurueckhalten',
    vorteil: unbekannt ? 0 : Math.abs(erstattung - person.pkv.premiumRefund),
  };
}

/** Soll eine neue Rechnung standardmäßig für die BRE zurückgehalten werden? */
export function standardZurueckhalten(r: Invoice, person: Person, ctx: Kontext): boolean {
  if (!breRelevant(r, person)) return false;
  const check = breCheck(ctx, person, Number(r.date.slice(0, 4)));
  // Wurde in diesem Jahr schon eingereicht, ist die BRE ohnehin verloren.
  return !check || check.eingereicht.length === 0;
}

// ---------------------------------------------------------------------------
// Hinweise

export interface Hinweis {
  stufe: 'kritisch' | 'warnung' | 'info';
  personId: string;
  text: string;
  rechnungId?: string;
  einreichungId?: string;
  /** Hinweis betrifft die Personen-Einstellungen. */
  personenSeite?: boolean;
}

export const WARNUNG_FRIST_TAGE = 60;
export const WARNUNG_ZAHLUNG_TAGE = 7;
export const NACHFRAGEN_NACH_TAGEN = 42;

const euroKurz = (c: number) => `${Math.round(c / 100).toLocaleString('de-DE')} €`;

/** Sammelt Fristen und Erinnerungen, nach Dringlichkeit sortiert. */
export function hinweise(state: AppState, stichtag = heute()): Hinweis[] {
  const liste: Hinweis[] = [];
  const personen = new Map(state.people.map((p) => [p.id, p]));

  for (const r of state.invoices) {
    const person = personen.get(r.personId);
    if (!person) continue;
    const titel = `${r.provider || 'Rechnung'} vom ${r.date.split('-').reverse().join('.')}`;

    if (!r.paidDate && r.dueDate) {
      const tage = tageZwischen(stichtag, r.dueDate);
      if (tage < 0) {
        liste.push({ stufe: 'kritisch', personId: person.id, rechnungId: r.id, text: `${titel}: Zahlung seit ${-tage} Tag(en) überfällig` });
      } else if (tage <= WARNUNG_ZAHLUNG_TAGE) {
        liste.push({ stufe: 'warnung', personId: person.id, rechnungId: r.id, text: `${titel}: Zahlung fällig in ${tage} Tag(en)` });
      }
    }

    if (traegerFuer(r.kind, person).includes('beihilfe') && traegerInfo(r, person, 'beihilfe', state).status === 'offen') {
      const tage = tageZwischen(stichtag, beihilfeFristEnde(r, person));
      if (tage < 0) {
        liste.push({ stufe: 'kritisch', personId: person.id, rechnungId: r.id, text: `${titel}: Beihilfe-Antragsfrist seit ${-tage} Tag(en) abgelaufen` });
      } else if (tage <= WARNUNG_FRIST_TAGE) {
        liste.push({ stufe: 'warnung', personId: person.id, rechnungId: r.id, text: `${titel}: Beihilfe-Antragsfrist endet in ${tage} Tag(en)` });
      }
    }
  }

  // Abgelaufene Jahre mit zurückgehaltenen Rechnungen: BRE-Entscheidung treffen
  const aktuellesJahr = Number(stichtag.slice(0, 4));
  for (const person of state.people) {
    if (person.pkv.premiumRefundEnabled && !person.pkv.premiumRefund) {
      liste.push({ stufe: 'info', personId: person.id, personenSeite: true, text: 'Betrag der Beitragsrückerstattung fehlt – bitte unter Personen eintragen' });
    }
    const jahre = new Set(state.invoices.filter((r) => r.personId === person.id).map((r) => Number(r.date.slice(0, 4))));
    for (const jahr of jahre) {
      if (jahr >= aktuellesJahr) continue;
      const c = breCheck(state, person, jahr);
      if (!c || c.zurueckgehalten.length === 0 || c.eingereicht.length > 0) continue;
      if (c.empfehlung === 'unbekannt') continue;
      liste.push({
        stufe: c.empfehlung === 'einreichen' ? 'warnung' : 'info',
        personId: person.id,
        text:
          c.empfehlung === 'einreichen'
            ? `BRE ${jahr}: Einreichen lohnt sich – ${euroKurz(c.erstattungBeiEinreichung)} Erstattung statt ${euroKurz(c.bre)} BRE`
            : `BRE ${jahr}: Zurückhalten lohnt sich – ${euroKurz(c.bre)} BRE statt ${euroKurz(c.erstattungBeiEinreichung)} Erstattung`,
      });
    }
  }

  for (const e of state.submissions) {
    // Auch teilweise beschiedene Einreichungen mit noch offenen Rechnungen
    if (e.status !== 'submitted' && !e.items.some((p) => p.pending)) continue;
    const tage = tageZwischen(e.submittedDate, stichtag);
    if (tage >= NACHFRAGEN_NACH_TAGEN) {
      const name = ktKurz(e.payer, personen.get(e.personIds[0]));
      liste.push({
        stufe: 'info',
        personId: e.personIds[0],
        einreichungId: e.id,
        text: `${name}-Einreichung vom ${e.submittedDate.split('-').reverse().join('.')} seit ${Math.floor(tage / 7)} Wochen ohne Bescheid – ggf. nachfragen`,
      });
    }
  }

  const rang = { kritisch: 0, warnung: 1, info: 2 };
  return liste.sort((a, b) => rang[a.stufe] - rang[b.stufe]);
}

// ---------------------------------------------------------------------------
// Auswertung

export interface Jahreswerte {
  anzahl: number;
  betrag: number;
  erstattet: Record<Payer, number>;
  ausstehend: number;
  eigenanteil: number;
}

/** Summen je Person und Jahr (nach Rechnungsdatum), optional nur für eine Leistungsart. */
export function jahreswerte(state: AppState, personId: string, jahr: number, art?: ServiceKind): Jahreswerte {
  const person = state.people.find((p) => p.id === personId);
  const w: Jahreswerte = { anzahl: 0, betrag: 0, erstattet: { beihilfe: 0, pkv: 0, ppv: 0 }, ausstehend: 0, eigenanteil: 0 };
  if (!person) return w;
  for (const r of state.invoices) {
    if (r.personId !== personId || !r.date.startsWith(`${jahr}-`) || (art && r.kind !== art)) continue;
    const u = rechnungUebersicht(r, person, state);
    w.anzahl++;
    w.betrag += r.amount;
    // Versicherungserstattungen nach Sparte der Rechnung (Pflege → PPV), auch bei gemeinsamem Vertrag
    for (const i of u.infos) if (i.status === 'erstattet') w.erstattet[i.kt === 'beihilfe' ? 'beihilfe' : sparte(r.kind)] += i.erstattet ?? 0;
    w.ausstehend += u.ausstehend;
    w.eigenanteil += u.eigenanteil;
  }
  return w;
}

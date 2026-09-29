import { heute, plusMonate, tageZwischen } from './format';
import type { AppState, Einreichung, Kostentraeger, Leistungsart, Person, Rechnung } from './types';

/** Datenbasis für Berechnungen, die andere Rechnungen oder Einreichungen berücksichtigen. */
export type Kontext = Pick<AppState, 'rechnungen' | 'einreichungen'>;

/** Welche Stellen sind für eine Leistungsart bei dieser Person zuständig? */
export function traegerFuer(art: Leistungsart, person: Person): Kostentraeger[] {
  const versicherung: Kostentraeger = art === 'krankheit' ? 'pkv' : 'ppv';
  return person.beihilfe.berechtigt ? ['beihilfe', versicherung] : [versicherung];
}

/** Erstattungsquote in Prozent für Person, Leistungsart und Kostenträger. */
export function quote(person: Person, art: Leistungsart, kt: Kostentraeger): number {
  if (kt === 'beihilfe') {
    if (!person.beihilfe.berechtigt) return 0;
    return art === 'krankheit' ? person.beihilfe.satzKrankheit : person.beihilfe.satzPflege;
  }
  if (kt === 'pkv') return person.pkv.quote;
  return person.ppv.quote;
}

function pkvBrutto(r: Rechnung, person: Person): number {
  return Math.round((r.betrag * quote(person, r.art, 'pkv')) / 100);
}

/** Unterliegt die Rechnung dem PKV-Selbstbehalt? (Krankheit, keine Vorsorge, Tarif mit Selbstbehalt) */
function selbstbehaltPflichtig(r: Rechnung, person: Person): boolean {
  return r.art === 'krankheit' && !r.vorsorge && person.pkv.selbstbehaltProzent > 0;
}

/**
 * Verteilt den jährlichen Selbstbehalt in Reihenfolge der Rechnungsdaten auf die Rechnungen.
 * Liefert je Rechnungs-ID den Selbstbehalt in Cent.
 */
function selbstbehaltVerteilen(liste: Rechnung[], person: Person): Map<string, number> {
  const ergebnis = new Map<string, number>();
  const sortiert = [...liste].sort((a, b) => a.datum.localeCompare(b.datum) || a.id.localeCompare(b.id));
  let verbraucht = 0;
  for (const r of sortiert) {
    const sb = Math.min(Math.round((pkvBrutto(r, person) * person.pkv.selbstbehaltProzent) / 100), Math.max(0, person.pkv.selbstbehaltMax - verbraucht));
    ergebnis.set(r.id, sb);
    verbraucht += sb;
  }
  return ergebnis;
}

/**
 * Selbstbehalt, der voraussichtlich von der PKV-Erstattung dieser Rechnung abgezogen wird.
 * Berücksichtigt alle früheren Rechnungen desselben Jahres, die bei der PKV eingereicht werden.
 * `r` darf ein noch ungespeicherter Entwurf sein.
 */
export function selbstbehalt(r: Rechnung, person: Person, rechnungen: Rechnung[]): number {
  if (!selbstbehaltPflichtig(r, person)) return 0;
  const jahr = r.datum.slice(0, 4);
  const liste = [...rechnungen.filter((x) => x.id !== r.id), r].filter(
    (x) => x.personId === r.personId && x.datum.startsWith(jahr) && selbstbehaltPflichtig(x, person) && !x.nichtEinreichen.includes('pkv'),
  );
  if (!liste.includes(r)) liste.push(r);
  return selbstbehaltVerteilen(liste, person).get(r.id) ?? 0;
}

/** Erwartete Erstattung in Cent (manueller Wert hat Vorrang vor Quote und Selbstbehalt). */
export function erwartet(r: Rechnung, person: Person, kt: Kostentraeger, rechnungen: Rechnung[]): number {
  const manuell = r.erwartetManuell[kt];
  if (manuell != null) return manuell;
  if (kt === 'pkv') return pkvBrutto(r, person) - selbstbehalt(r, person, rechnungen);
  return Math.round((r.betrag * quote(person, r.art, kt)) / 100);
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
  kt: Kostentraeger;
  status: TraegerStatus;
  erwartet: number;
  erstattet?: number;
  einreichung?: Einreichung;
}

/** Jüngste Einreichung einer Rechnung bei einem Kostenträger. */
function letzteEinreichung(r: Rechnung, kt: Kostentraeger, einreichungen: Einreichung[]): Einreichung | undefined {
  let letzte: Einreichung | undefined;
  for (const e of einreichungen) {
    if (e.kostentraeger !== kt || !e.positionen.some((p) => p.rechnungId === r.id)) continue;
    if (!letzte || e.eingereichtAm >= letzte.eingereichtAm) letzte = e;
  }
  return letzte;
}

/** Status einer Rechnung bei einem Kostenträger – maßgeblich ist die jüngste Einreichung. */
export function traegerInfo(r: Rechnung, person: Person, kt: Kostentraeger, ctx: Kontext): TraegerInfo {
  const erw = erwartet(r, person, kt, ctx.rechnungen);
  const letzte = letzteEinreichung(r, kt, ctx.einreichungen);
  if (!letzte) {
    return { kt, status: r.nichtEinreichen.includes(kt) ? 'nicht_einreichen' : 'offen', erwartet: erw };
  }
  if (letzte.status === 'eingereicht') return { kt, status: 'eingereicht', erwartet: erw, einreichung: letzte };
  const erst = letzte.positionen.find((p) => p.rechnungId === r.id)?.erstattet ?? 0;
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

export function rechnungUebersicht(r: Rechnung, person: Person, ctx: Kontext): RechnungUebersicht {
  const infos = traegerFuer(r.art, person).map((kt) => traegerInfo(r, person, kt, ctx));
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
    eigenanteil: r.betrag - erstattet - ausstehend,
    abgeschlossen: infos.every((i) => i.status !== 'offen' && i.status !== 'eingereicht'),
  };
}

/** Ende der Beihilfe-Antragsfrist für eine Rechnung. */
export function beihilfeFristEnde(r: Rechnung, person: Person): string {
  return plusMonate(r.datum, person.beihilfe.fristMonate);
}

/** Rechnungen, die bei einem Kostenträger (erneut) eingereicht werden können. */
export function einreichbareRechnungen(state: AppState, personId: string, kt: Kostentraeger, ausserEinreichung?: string): Rechnung[] {
  const person = state.personen.find((p) => p.id === personId);
  if (!person) return [];
  const ctx: Kontext = { rechnungen: state.rechnungen, einreichungen: state.einreichungen.filter((e) => e.id !== ausserEinreichung) };
  return state.rechnungen
    .filter((r) => r.personId === personId && traegerFuer(r.art, person).includes(kt))
    .filter((r) => {
      const s = traegerInfo(r, person, kt, ctx).status;
      return s === 'offen' || s === 'abgelehnt';
    })
    .sort((a, b) => a.datum.localeCompare(b.datum));
}

// ---------------------------------------------------------------------------
// Beitragsrückerstattung (BRE)

export interface BreCheck {
  personId: string;
  jahr: number;
  /** BRE bei Leistungsfreiheit in Cent. */
  bre: number;
  /** Nicht-Vorsorge-Krankheitsrechnungen des Jahres. */
  rechnungen: Rechnung[];
  betrag: number;
  /** PKV-Erstattung (nach Selbstbehalt), wenn alle diese Rechnungen eingereicht würden. */
  erstattungBeiEinreichung: number;
  /** Bereits bei der PKV eingereicht → BRE für dieses Jahr entfällt. */
  eingereicht: Rechnung[];
  /** Noch nicht eingereicht und nicht zurückgehalten. */
  offen: Rechnung[];
  /** Bewusst zurückgehalten. */
  zurueckgehalten: Rechnung[];
  empfehlung: 'zurueckhalten' | 'einreichen';
  /** Finanzieller Vorteil der Empfehlung gegenüber der Alternative in Cent. */
  vorteil: number;
}

/** BRE-relevant: Krankheitsrechnung ohne Vorsorge, die (anteilig) an die PKV gehen würde. */
function breRelevant(r: Rechnung, person: Person): boolean {
  return r.art === 'krankheit' && !r.vorsorge && quote(person, 'krankheit', 'pkv') > 0;
}

/** Vergleicht für ein Jahr: alles bei der PKV einreichen oder zurückhalten und BRE erhalten? */
export function breCheck(ctx: Kontext, person: Person, jahr: number): BreCheck | null {
  if (!person.pkv.bre) return null;
  const liste = ctx.rechnungen.filter((r) => r.personId === person.id && r.datum.startsWith(`${jahr}-`) && breRelevant(r, person));
  const sb = selbstbehaltVerteilen(liste.filter((r) => selbstbehaltPflichtig(r, person)), person);
  let erstattung = 0;
  const eingereicht: Rechnung[] = [];
  const offen: Rechnung[] = [];
  const zurueckgehalten: Rechnung[] = [];
  for (const r of liste) {
    erstattung += r.erwartetManuell.pkv ?? pkvBrutto(r, person) - (sb.get(r.id) ?? 0);
    const e = letzteEinreichung(r, 'pkv', ctx.einreichungen);
    if (e) eingereicht.push(r);
    else if (r.nichtEinreichen.includes('pkv')) zurueckgehalten.push(r);
    else offen.push(r);
  }
  const einreichen = erstattung > person.pkv.bre;
  return {
    personId: person.id,
    jahr,
    bre: person.pkv.bre,
    rechnungen: liste,
    betrag: liste.reduce((s, r) => s + r.betrag, 0),
    erstattungBeiEinreichung: erstattung,
    eingereicht,
    offen,
    zurueckgehalten,
    empfehlung: einreichen ? 'einreichen' : 'zurueckhalten',
    vorteil: Math.abs(erstattung - person.pkv.bre),
  };
}

/** Soll eine neue Rechnung standardmäßig für die BRE zurückgehalten werden? */
export function standardZurueckhalten(r: Rechnung, person: Person, ctx: Kontext): boolean {
  if (!person.pkv.bre || !breRelevant(r, person)) return false;
  const check = breCheck(ctx, person, Number(r.datum.slice(0, 4)));
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
}

export const WARNUNG_FRIST_TAGE = 60;
export const WARNUNG_ZAHLUNG_TAGE = 7;
export const NACHFRAGEN_NACH_TAGEN = 42;

const euroKurz = (c: number) => `${Math.round(c / 100).toLocaleString('de-DE')} €`;

/** Sammelt Fristen und Erinnerungen, nach Dringlichkeit sortiert. */
export function hinweise(state: AppState, stichtag = heute()): Hinweis[] {
  const liste: Hinweis[] = [];
  const personen = new Map(state.personen.map((p) => [p.id, p]));

  for (const r of state.rechnungen) {
    const person = personen.get(r.personId);
    if (!person) continue;
    const titel = `${r.leistungserbringer || 'Rechnung'} vom ${r.datum.split('-').reverse().join('.')}`;

    if (!r.bezahltAm && r.faelligAm) {
      const tage = tageZwischen(stichtag, r.faelligAm);
      if (tage < 0) {
        liste.push({ stufe: 'kritisch', personId: person.id, rechnungId: r.id, text: `${titel}: Zahlung seit ${-tage} Tag(en) überfällig` });
      } else if (tage <= WARNUNG_ZAHLUNG_TAGE) {
        liste.push({ stufe: 'warnung', personId: person.id, rechnungId: r.id, text: `${titel}: Zahlung fällig in ${tage} Tag(en)` });
      }
    }

    if (traegerFuer(r.art, person).includes('beihilfe') && traegerInfo(r, person, 'beihilfe', state).status === 'offen') {
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
  for (const person of state.personen) {
    const jahre = new Set(state.rechnungen.filter((r) => r.personId === person.id).map((r) => Number(r.datum.slice(0, 4))));
    for (const jahr of jahre) {
      if (jahr >= aktuellesJahr) continue;
      const c = breCheck(state, person, jahr);
      if (!c || c.zurueckgehalten.length === 0 || c.eingereicht.length > 0) continue;
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

  for (const e of state.einreichungen) {
    if (e.status !== 'eingereicht') continue;
    const tage = tageZwischen(e.eingereichtAm, stichtag);
    if (tage >= NACHFRAGEN_NACH_TAGEN) {
      const name = { beihilfe: 'Beihilfe', pkv: 'PKV', ppv: 'PPV' }[e.kostentraeger];
      liste.push({
        stufe: 'info',
        personId: e.personId,
        einreichungId: e.id,
        text: `${name}-Einreichung vom ${e.eingereichtAm.split('-').reverse().join('.')} seit ${Math.floor(tage / 7)} Wochen ohne Bescheid – ggf. nachfragen`,
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
  erstattet: Record<Kostentraeger, number>;
  ausstehend: number;
  eigenanteil: number;
}

/** Summen je Person und Jahr (nach Rechnungsdatum), optional nur für eine Leistungsart. */
export function jahreswerte(state: AppState, personId: string, jahr: number, art?: Leistungsart): Jahreswerte {
  const person = state.personen.find((p) => p.id === personId);
  const w: Jahreswerte = { anzahl: 0, betrag: 0, erstattet: { beihilfe: 0, pkv: 0, ppv: 0 }, ausstehend: 0, eigenanteil: 0 };
  if (!person) return w;
  for (const r of state.rechnungen) {
    if (r.personId !== personId || !r.datum.startsWith(`${jahr}-`) || (art && r.art !== art)) continue;
    const u = rechnungUebersicht(r, person, state);
    w.anzahl++;
    w.betrag += r.betrag;
    for (const i of u.infos) if (i.status === 'erstattet') w.erstattet[i.kt] += i.erstattet ?? 0;
    w.ausstehend += u.ausstehend;
    w.eigenanteil += u.eigenanteil;
  }
  return w;
}

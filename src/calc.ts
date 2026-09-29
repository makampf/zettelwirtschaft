import { heute, plusMonate, tageZwischen } from './format';
import type { AppState, Einreichung, Kostentraeger, Leistungsart, Person, Rechnung } from './types';

/** Datenbasis für Berechnungen, die andere Rechnungen oder Einreichungen berücksichtigen. */
export type Kontext = Pick<AppState, 'rechnungen' | 'einreichungen'>;

/** Private Versicherung für eine Leistungsart: Krankheit → PKV, Pflege → PPV. */
export function versicherungFuer(art: Leistungsart): 'pkv' | 'ppv' {
  return art === 'krankheit' ? 'pkv' : 'ppv';
}

/** Welche Stellen sind für eine Leistungsart bei dieser Person zuständig? */
export function traegerFuer(art: Leistungsart, person: Person): Kostentraeger[] {
  const versicherung = versicherungFuer(art);
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

/** Erstattung der privaten Versicherung vor Selbstbehalt. */
function versicherungBrutto(r: Rechnung, person: Person): number {
  return Math.round((r.betrag * quote(person, r.art, versicherungFuer(r.art))) / 100);
}

/** Betrifft der Tarif (Selbstbehalt/BRE) diese Leistungsart? Pflege nur, wenn KV und PV gemeinsam zählen. */
function tarifBetrifft(r: Rechnung, person: Person): boolean {
  return !r.vorsorge && (r.art === 'krankheit' || person.pkv.mitPflege);
}

/** Unterliegt die Rechnung dem Selbstbehalt? (keine Vorsorge, Tarif mit Selbstbehalt) */
function selbstbehaltPflichtig(r: Rechnung, person: Person): boolean {
  return person.pkv.selbstbehaltProzent > 0 && tarifBetrifft(r, person);
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
    const sb = Math.min(Math.round((versicherungBrutto(r, person) * person.pkv.selbstbehaltProzent) / 100), Math.max(0, person.pkv.selbstbehaltMax - verbraucht));
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
export function selbstbehalt(r: Rechnung, person: Person, rechnungen: Rechnung[]): number {
  if (!selbstbehaltPflichtig(r, person)) return 0;
  const jahr = r.datum.slice(0, 4);
  const liste = [...rechnungen.filter((x) => x.id !== r.id), r].filter(
    (x) => x.personId === r.personId && x.datum.startsWith(jahr) && selbstbehaltPflichtig(x, person) && !x.nichtEinreichen.includes(versicherungFuer(x.art)),
  );
  if (!liste.includes(r)) liste.push(r);
  return selbstbehaltVerteilen(liste, person).get(r.id) ?? 0;
}

/** Erwartete Erstattung in Cent (manueller Wert hat Vorrang vor Quote und Selbstbehalt). */
export function erwartet(r: Rechnung, person: Person, kt: Kostentraeger, rechnungen: Rechnung[]): number {
  const manuell = r.erwartetManuell[kt];
  if (manuell != null) return manuell;
  if (kt === versicherungFuer(r.art)) return versicherungBrutto(r, person) - selbstbehalt(r, person, rechnungen);
  return Math.round((r.betrag * quote(person, r.art, kt)) / 100);
}

/** Erwartete Erstattung einer Rechnung; die Person wird aus dem Zustand ermittelt. */
export function erwartetFuerRechnung(state: Pick<AppState, 'personen' | 'rechnungen'>, r: Rechnung, kt: Kostentraeger): number {
  const person = state.personen.find((p) => p.id === r.personId);
  return person ? erwartet(r, person, kt, state.rechnungen) : 0;
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
  /** BRE bei Leistungsfreiheit in Cent (0 = Betrag unbekannt). */
  bre: number;
  /** BRE-relevante Rechnungen des Jahres (ohne Vorsorge; Pflege nur bei gemeinsamem Tarif). */
  rechnungen: Rechnung[];
  betrag: number;
  /** Versicherungserstattung (nach Selbstbehalt), wenn alle diese Rechnungen eingereicht würden. */
  erstattungBeiEinreichung: number;
  /** Bereits bei der Versicherung eingereicht → BRE für dieses Jahr entfällt. */
  eingereicht: Rechnung[];
  /** Noch nicht eingereicht und nicht zurückgehalten. */
  offen: Rechnung[];
  /** Bewusst zurückgehalten. */
  zurueckgehalten: Rechnung[];
  /** Ohne bekannten BRE-Betrag ist keine Empfehlung möglich. */
  empfehlung: 'zurueckhalten' | 'einreichen' | 'unbekannt';
  /** Finanzieller Vorteil der Empfehlung gegenüber der Alternative in Cent. */
  vorteil: number;
}

/** BRE-relevant: Rechnung ohne Vorsorge, die (anteilig) an die private Versicherung des Tarifs gehen würde. */
export function breRelevant(r: Rechnung, person: Person): boolean {
  return person.pkv.breAktiv && tarifBetrifft(r, person) && quote(person, r.art, versicherungFuer(r.art)) > 0;
}

/** Vergleicht für ein Jahr: alles bei der Versicherung einreichen oder zurückhalten und BRE erhalten? */
export function breCheck(ctx: Kontext, person: Person, jahr: number): BreCheck | null {
  if (!person.pkv.breAktiv) return null;
  const liste = ctx.rechnungen.filter((r) => r.personId === person.id && r.datum.startsWith(`${jahr}-`) && breRelevant(r, person));
  const sb = selbstbehaltVerteilen(liste.filter((r) => selbstbehaltPflichtig(r, person)), person);
  let erstattung = 0;
  const eingereicht: Rechnung[] = [];
  const offen: Rechnung[] = [];
  const zurueckgehalten: Rechnung[] = [];
  for (const r of liste) {
    const kt = versicherungFuer(r.art);
    erstattung += r.erwartetManuell[kt] ?? versicherungBrutto(r, person) - (sb.get(r.id) ?? 0);
    const e = letzteEinreichung(r, kt, ctx.einreichungen);
    if (e) eingereicht.push(r);
    else if (r.nichtEinreichen.includes(kt)) zurueckgehalten.push(r);
    else offen.push(r);
  }
  const unbekannt = !person.pkv.bre;
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
    empfehlung: unbekannt ? 'unbekannt' : einreichen ? 'einreichen' : 'zurueckhalten',
    vorteil: unbekannt ? 0 : Math.abs(erstattung - person.pkv.bre),
  };
}

/** Soll eine neue Rechnung standardmäßig für die BRE zurückgehalten werden? */
export function standardZurueckhalten(r: Rechnung, person: Person, ctx: Kontext): boolean {
  if (!breRelevant(r, person)) return false;
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
    if (person.pkv.breAktiv && !person.pkv.bre) {
      liste.push({ stufe: 'info', personId: person.id, personenSeite: true, text: 'Betrag der Beitragsrückerstattung fehlt – bitte unter Personen eintragen' });
    }
    const jahre = new Set(state.rechnungen.filter((r) => r.personId === person.id).map((r) => Number(r.datum.slice(0, 4))));
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

  for (const e of state.einreichungen) {
    if (e.status !== 'eingereicht') continue;
    const tage = tageZwischen(e.eingereichtAm, stichtag);
    if (tage >= NACHFRAGEN_NACH_TAGEN) {
      const name = { beihilfe: 'Beihilfe', pkv: 'PKV', ppv: 'PPV' }[e.kostentraeger];
      liste.push({
        stufe: 'info',
        personId: e.personIds[0],
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

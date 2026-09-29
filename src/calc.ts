import { heute, plusMonate, tageZwischen } from './format';
import type { AppState, Einreichung, Kostentraeger, Leistungsart, Person, Rechnung } from './types';

/** Welche Stellen sind für eine Leistungsart zuständig? */
export function traegerFuer(art: Leistungsart): Kostentraeger[] {
  return art === 'krankheit' ? ['beihilfe', 'pkv'] : ['beihilfe', 'ppv'];
}

/** Erstattungsquote in Prozent für Person, Leistungsart und Kostenträger. */
export function quote(person: Person, art: Leistungsart, kt: Kostentraeger): number {
  if (kt === 'beihilfe') return art === 'krankheit' ? person.beihilfe.satzKrankheit : person.beihilfe.satzPflege;
  if (kt === 'pkv') return person.pkv.quote;
  return person.ppv.quote;
}

/** Erwartete Erstattung in Cent (manueller Wert hat Vorrang vor der Quote). */
export function erwartet(r: Rechnung, person: Person, kt: Kostentraeger): number {
  const manuell = r.erwartetManuell[kt];
  if (manuell != null) return manuell;
  return Math.round((r.betrag * quote(person, r.art, kt)) / 100);
}

export type TraegerStatus = 'offen' | 'nicht_einreichen' | 'eingereicht' | 'erstattet' | 'abgelehnt';

export const STATUS_NAME: Record<TraegerStatus, string> = {
  offen: 'noch einreichen',
  nicht_einreichen: 'wird nicht eingereicht',
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

/** Status einer Rechnung bei einem Kostenträger – maßgeblich ist die jüngste Einreichung. */
export function traegerInfo(
  r: Rechnung,
  person: Person,
  kt: Kostentraeger,
  einreichungen: Einreichung[],
): TraegerInfo {
  const erw = erwartet(r, person, kt);
  let letzte: Einreichung | undefined;
  for (const e of einreichungen) {
    if (e.kostentraeger !== kt || !e.positionen.some((p) => p.rechnungId === r.id)) continue;
    if (!letzte || e.eingereichtAm >= letzte.eingereichtAm) letzte = e;
  }
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
  /** Alle Kostenträger sind erledigt (erstattet, abgelehnt oder bewusst nicht eingereicht). */
  abgeschlossen: boolean;
}

export function rechnungUebersicht(r: Rechnung, person: Person, einreichungen: Einreichung[]): RechnungUebersicht {
  const infos = traegerFuer(r.art).map((kt) => traegerInfo(r, person, kt, einreichungen));
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
export function einreichbareRechnungen(
  state: AppState,
  personId: string,
  kt: Kostentraeger,
  ausserEinreichung?: string,
): Rechnung[] {
  const person = state.personen.find((p) => p.id === personId);
  if (!person) return [];
  const andere = state.einreichungen.filter((e) => e.id !== ausserEinreichung);
  return state.rechnungen
    .filter((r) => r.personId === personId && traegerFuer(r.art).includes(kt))
    .filter((r) => {
      const s = traegerInfo(r, person, kt, andere).status;
      return s === 'offen' || s === 'abgelehnt';
    })
    .sort((a, b) => a.datum.localeCompare(b.datum));
}

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

    if (traegerFuer(r.art).includes('beihilfe') && traegerInfo(r, person, 'beihilfe', state.einreichungen).status === 'offen') {
      const tage = tageZwischen(stichtag, beihilfeFristEnde(r, person));
      if (tage < 0) {
        liste.push({ stufe: 'kritisch', personId: person.id, rechnungId: r.id, text: `${titel}: Beihilfe-Antragsfrist seit ${-tage} Tag(en) abgelaufen` });
      } else if (tage <= WARNUNG_FRIST_TAGE) {
        liste.push({ stufe: 'warnung', personId: person.id, rechnungId: r.id, text: `${titel}: Beihilfe-Antragsfrist endet in ${tage} Tag(en)` });
      }
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
    const u = rechnungUebersicht(r, person, state.einreichungen);
    w.anzahl++;
    w.betrag += r.betrag;
    for (const i of u.infos) if (i.status === 'erstattet') w.erstattet[i.kt] += i.erstattet ?? 0;
    w.ausstehend += u.ausstehend;
    w.eigenanteil += u.eigenanteil;
  }
  return w;
}

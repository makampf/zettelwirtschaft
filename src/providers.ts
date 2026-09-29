import type { ServiceKind, Invoice } from './types';

/** Zusammenfassung eines Leistungserbringers aus den bisherigen Rechnungen. */
export interface ErbringerInfo {
  name: string;
  anzahl: number;
  /** Datum der letzten Rechnung (ISO). */
  zuletzt: string;
  /** Häufigste Leistungsart. */
  art: ServiceKind;
  /** Person, falls alle Rechnungen dieses Erbringers dieselbe Person betreffen. */
  personId?: string;
}

/** Vereinheitlicht Text für Vergleiche: klein, ohne Akzente, ß → ss, Satzzeichen weg. */
export function normalisiere(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Alle bisherigen Leistungserbringer, zuletzt verwendete zuerst. */
export function erbringerListe(rechnungen: Invoice[]): ErbringerInfo[] {
  const map = new Map<string, { name: string; anzahl: number; zuletzt: string; arten: Record<ServiceKind, number>; personen: Set<string> }>();
  for (const r of rechnungen) {
    const name = r.provider.trim();
    if (!name) continue;
    const key = normalisiere(name);
    let e = map.get(key);
    if (!e) map.set(key, (e = { name, anzahl: 0, zuletzt: '', arten: { illness: 0, care: 0 }, personen: new Set() }));
    e.anzahl++;
    e.arten[r.kind]++;
    e.personen.add(r.personId);
    // Schreibweise der jüngsten Rechnung verwenden
    if (r.date >= e.zuletzt) {
      e.zuletzt = r.date;
      e.name = name;
    }
  }
  return [...map.values()]
    .map((e) => ({
      name: e.name,
      anzahl: e.anzahl,
      zuletzt: e.zuletzt,
      art: (e.arten.care > e.arten.illness ? 'care' : 'illness') as ServiceKind,
      personId: e.personen.size === 1 ? [...e.personen][0] : undefined,
    }))
    .sort((a, b) => b.zuletzt.localeCompare(a.zuletzt) || b.anzahl - a.anzahl || a.name.localeCompare(b.name));
}

/** Vorschläge passend zur Eingabe: ohne Eingabe die zuletzt genutzten, sonst gefiltert (Wortanfänge zuerst). */
export function erbringerVorschlaege(liste: ErbringerInfo[], eingabe: string, max = 8): ErbringerInfo[] {
  const e = normalisiere(eingabe);
  if (!e) return liste.slice(0, max);
  const suchWoerter = e.split(' ');
  const treffer = liste
    .map((info) => {
      const n = normalisiere(info.name);
      if (n === e) return null; // bereits vollständig eingegeben
      const woerter = n.split(' ');
      // Jedes eingegebene Wort muss Anfang eines Wortes im Namen sein
      if (!suchWoerter.every((s) => woerter.some((w) => w.startsWith(s)))) return n.includes(e) ? { info, rang: 2 } : null;
      return { info, rang: n.startsWith(e) ? 0 : 1 };
    })
    .filter((x) => x != null);
  return treffer
    .sort((a, b) => a.rang - b.rang || b.info.anzahl - a.info.anzahl || b.info.zuletzt.localeCompare(a.info.zuletzt))
    .slice(0, max)
    .map((x) => x.info);
}

/** Allgemeine Wörter, die keinen Erbringer unterscheiden. */
const ALLGEMEIN = new Set(
  (
    'dr med dent prof praxis gemeinschaftspraxis apotheke klinik klinikum krankenhaus hausarzt hausarztin hausarztpraxis zahnarzt zahnarztin zahnarztpraxis facharzt facharztin fur und der die das den am im an gmbh ggmbh mvz labor innere medizin allgemeinmedizin pflegedienst pflegeheim seniorenzentrum physiotherapie therapie herr frau ' +
    // Fachrichtungen unterscheiden keine Praxis (normalisiert, ohne Umlaute)
    'psychotherapie ergotherapie logopadie krankengymnastik radiologie ' +
    'orthopadie dermatologie gynakologie kardiologie urologie neurologie psychiatrie augenheilkunde augenarzt hno zahnheilkunde ' +
    'kieferorthopadie chirurgie sozialstation tagespflege'
  ).split(' '),
);

/** Kennzeichnende Wörter eines Namens (ohne allgemeine wie „Praxis“, „Dr.“, „für“). */
export function kennwoerter(name: string): string[] {
  return normalisiere(name)
    .split(' ')
    .filter((w) => w.length >= 3 && !ALLGEMEIN.has(w));
}

/**
 * Findet einen bekannten Erbringer im Belegtext, auch bei abweichender Schreibweise:
 * alle kennzeichnenden Wörter des Namens (z. B. Nachname, Ortsteil) müssen als ganze Wörter vorkommen.
 */
export function bekannterErbringerImText(text: string, namen: string[]): string | undefined {
  const woerter = new Set(normalisiere(text).split(' '));
  let bester: { name: string; punkte: number } | undefined;
  for (const name of namen) {
    const kenn = kennwoerter(name);
    if (!kenn.length || !kenn.every((w) => woerter.has(w))) continue;
    const punkte = kenn.length * 100 + name.length;
    if (!bester || punkte > bester.punkte) bester = { name, punkte };
  }
  return bester?.name;
}

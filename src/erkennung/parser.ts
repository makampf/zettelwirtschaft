import { bekannterErbringerImText } from '../erbringer';
import { plusTage } from '../format';
import type { Leistungsart, Person } from '../types';

/** Aus einem Rechnungstext erkannte Angaben. Alles optional – nur was sicher genug gefunden wurde. */
export interface Erkennung {
  /** Betrag in Cent. */
  betrag?: number;
  datum?: string;
  faelligAm?: string;
  rechnungsnummer?: string;
  leistungserbringer?: string;
  art?: Leistungsart;
  vorsorge?: boolean;
  personId?: string;
}

export interface ParserKontext {
  personen: Pick<Person, 'id' | 'namenAufRechnung'>[];
  /** Bereits verwendete Leistungserbringer – werden bevorzugt wiedererkannt. */
  bekannteErbringer: string[];
  /** Heutiges Datum (ISO) für Plausibilitätsprüfungen. */
  heute: string;
}

// ---------------------------------------------------------------------------
// Beträge

const BETRAG = /(?<![\d,.])(\d{1,3}(?:[.\s]\d{3})+|\d+),(\d{2})(?![\d])|(?<![\d,.])(\d+)\.(\d{2})(?=\s*(?:€|EUR))/g;

function betraegeIn(zeile: string): number[] {
  const liste: number[] = [];
  for (const m of zeile.matchAll(BETRAG)) {
    const euro = (m[1] ?? m[3]).replace(/[.\s]/g, '');
    const cent = m[2] ?? m[4];
    liste.push(Number(euro) * 100 + Number(cent));
  }
  return liste;
}

/** Schlüsselwörter für den Rechnungsbetrag, nach Verlässlichkeit geordnet. */
const BETRAG_SCHLUESSEL: RegExp[] = [
  /zu\s*zahlen|zahlbetrag|zahlungsbetrag|noch\s+offen|offener\s+betrag|forderungsbetrag/i,
  /rechnungsbetrag|endbetrag|gesamtbetrag|rechnungssumme|rechnungsendbetrag|gesamtforderung/i,
  /gesamtsumme|\bsumme\b|\bgesamt\b|\btotal\b/i,
];
const KEIN_ENDBETRAG = /zwischensumme|teilsumme|übertrag|netto|mwst|ust\.|umsatzsteuer|anzahlung|bereits\s+gezahlt|erstattet|kassenanteil|zuzahlung\s+gesetzlich/i;

function findeBetrag(zeilen: string[]): number | undefined {
  for (const schluessel of BETRAG_SCHLUESSEL) {
    let treffer: number | undefined;
    zeilen.forEach((z, i) => {
      if (!schluessel.test(z) || KEIN_ENDBETRAG.test(z)) return;
      // Betrag in derselben Zeile, sonst in den nächsten beiden
      const kandidaten = [z, zeilen[i + 1] ?? '', zeilen[i + 2] ?? ''];
      for (const k of kandidaten) {
        const b = betraegeIn(k);
        if (b.length) {
          treffer = b[b.length - 1];
          break;
        }
      }
    });
    if (treffer) return treffer;
  }
  // Rückfall: größter Betrag mit Euro-Zeichen, sonst größter Betrag überhaupt
  const mitEuro = zeilen.filter((z) => /€|EUR/.test(z) && !KEIN_ENDBETRAG.test(z)).flatMap(betraegeIn);
  const alle = mitEuro.length ? mitEuro : zeilen.flatMap(betraegeIn);
  return alle.length ? Math.max(...alle) : undefined;
}

// ---------------------------------------------------------------------------
// Datum

const MONATE: Record<string, number> = {
  jan: 1, januar: 1, feb: 2, februar: 2, mär: 3, märz: 3, maerz: 3, mrz: 3, apr: 4, april: 4, mai: 5, jun: 6, juni: 6,
  jul: 7, juli: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, okt: 10, oktober: 10, nov: 11, november: 11, dez: 12, dezember: 12,
};
const DATUM_ZAHL = /(?<!\d)(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4}|\d{2})(?!\d)/g;
const DATUM_TEXT = /(?<!\d)(\d{1,2})\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|mrz|apr|jun|jul|aug|sept|sep|okt|nov|dez)\.?\s+(\d{4})/gi;

function iso(t: number, m: number, j: number): string | undefined {
  if (j < 100) j += 2000;
  if (m < 1 || m > 12 || t < 1 || t > 31 || j < 1990 || j > 2100) return undefined;
  const d = new Date(j, m - 1, t);
  if (d.getMonth() !== m - 1) return undefined;
  return `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
}

function datenIn(zeile: string): string[] {
  const liste: { pos: number; d: string }[] = [];
  for (const m of zeile.matchAll(DATUM_ZAHL)) {
    const d = iso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (d) liste.push({ pos: m.index ?? 0, d });
  }
  for (const m of zeile.matchAll(DATUM_TEXT)) {
    const d = iso(Number(m[1]), MONATE[m[2].toLowerCase()], Number(m[3]));
    if (d) liste.push({ pos: m.index ?? 0, d });
  }
  return liste.sort((a, b) => a.pos - b.pos).map((x) => x.d);
}

function datumNachSchluessel(zeilen: string[], schluessel: RegExp): string | undefined {
  for (let i = 0; i < zeilen.length; i++) {
    const m = schluessel.exec(zeilen[i]);
    if (!m) continue;
    // Datum hinter dem Schlüsselwort, sonst in der nächsten Zeile
    const danach = datenIn(zeilen[i].slice(m.index));
    if (danach.length) return danach[0];
    const naechste = datenIn(zeilen[i + 1] ?? '');
    if (naechste.length) return naechste[0];
  }
  return undefined;
}

const KEIN_RECHNUNGSDATUM = /geb(\.|urt)|fällig|zahlbar|bis\s+zum|zahlungsziel|leistungszeitraum|behandlung|aufnahme|entlassung/i;

function findeDatum(zeilen: string[], heute: string): string | undefined {
  const perSchluessel = datumNachSchluessel(zeilen, /rechnungsdatum|datum\s+der\s+rechnung|rechnung\s+vom|ausgestellt\s+am|belegdatum|rg\.?-?datum|re\.?-?datum/i);
  if (perSchluessel) return perSchluessel;
  const datumszeile = datumNachSchluessel(
    zeilen.map((z) => (KEIN_RECHNUNGSDATUM.test(z) ? '' : z)),
    /(^|\s)datum\s*:?/i,
  );
  if (datumszeile) return datumszeile;
  // Rückfall: spätestes plausibles Datum (Rechnungen liegen nach den Behandlungsdaten)
  const grenze = plusTage(heute, 7);
  const kandidaten = zeilen
    .filter((z) => !KEIN_RECHNUNGSDATUM.test(z))
    .flatMap(datenIn)
    .filter((d) => d <= grenze && d >= plusTage(heute, -3 * 366));
  return kandidaten.sort().pop();
}

function findeFaellig(zeilen: string[], datum: string | undefined): string | undefined {
  const d = datumNachSchluessel(zeilen, /zahlbar\s+bis|fällig\s+(am|bis)|zahlungsziel|spätestens\s+(am|bis)|bis\s+zum|zahlen\s+sie\s+bis|bitte\s+bis|fälligkeit/i);
  if (d) return d;
  const text = zeilen.join(' ');
  const frist = /(?:innerhalb|binnen)\s+(?:von\s+)?(\d{1,3})\s+tagen/i.exec(text);
  if (frist && datum) return plusTage(datum, Number(frist[1]));
  if (/zahlbar\s+sofort|sofort\s+fällig/i.test(text) && datum) return datum;
  return undefined;
}

// ---------------------------------------------------------------------------
// Rechnungsnummer, Leistungserbringer, Art, Person

/** Bezeichnungen der Rechnungsnummer mit Gewicht. Wortgrenzen verhindern Treffer in „Ihre Nr.“ / „Unsere Nr.“. */
const NR_SCHLUESSEL: [RegExp, number][] = [
  [/\brechnungs[-\s]?(?:nummer|nr|no)\b\.?/gi, 3],
  [/\brechnung\s+(?:nr|no)\b\.?/gi, 3],
  [/\b(?:rg|re)\.?[-\s]?nr\b\.?/gi, 2],
  [/\binvoice\s*(?:no|nr|number)\b\.?/gi, 2],
  [/\bbeleg[-\s]?(?:nummer|nr)\b\.?/gi, 1],
];
const NR_WERT = /^([A-Za-z0-9][A-Za-z0-9\-/.]{1,30})/;
const SPALTEN = /\s{3,}/;

/** Prüft einen möglichen Wert und liefert Zusatzpunkte – oder null, wenn er keine Rechnungsnummer sein kann. */
function nrBewertung(wert: string): number | null {
  if (!/\d/.test(wert)) return null; // Beschriftung statt Wert
  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(wert)) return null; // Datum
  let punkte = 0;
  if (/^20\d{2}(0[1-9]|1[0-2])$/.test(wert)) punkte -= 1; // sieht aus wie Jahr+Monat
  if (/\d{5,}/.test(wert)) punkte += 0.5;
  return punkte;
}

function findeRechnungsnummer(zeilen: string[]): string | undefined {
  let bester: { wert: string; punkte: number } | undefined;
  const pruefe = (roh: string | undefined, punkte: number) => {
    const wert = roh?.trim().match(NR_WERT)?.[1].replace(/[.]$/, '');
    const zusatz = wert ? nrBewertung(wert) : null;
    if (wert && zusatz != null && (!bester || punkte + zusatz > bester.punkte)) bester = { wert, punkte: punkte + zusatz };
  };

  zeilen.forEach((zeile, i) => {
    for (const [re, gewicht] of NR_SCHLUESSEL) {
      for (const m of zeile.matchAll(re)) {
        const ende = (m.index ?? 0) + m[0].length;
        const rest = zeile.slice(ende);
        // 1. Wert direkt dahinter („Rechnungsnummer: 987654321“)
        if (!SPALTEN.test(rest.match(/^\s*[:#]?\s*/)?.[0] ?? '') || /^\s*[:#]/.test(rest)) {
          pruefe(rest.replace(/^\s*[:#]?\s*/, ''), gewicht);
        }
        // 2. Tabellenkopf: Wert in derselben Spalte der nächsten Zeile
        const naechste = zeilen[i + 1];
        if (!naechste) continue;
        const kopf = zeile.split(SPALTEN);
        const spalte = kopf.findIndex((zelle) => new RegExp(re.source, 'i').test(zelle));
        const werte = naechste.split(SPALTEN);
        if (kopf.length >= 2 && spalte >= 0 && werte.length === kopf.length) pruefe(werte[spalte], gewicht - 0.25);
        // 3. Beschriftung allein am Zeilenende, Wert darunter
        else if (!rest.trim().replace(/^[:#]/, '').trim()) pruefe(werte[0], gewicht - 0.5);
      }
    }
  });
  return bester?.wert;
}

const ERBRINGER = /\b(dr\.?\s*(?:med\.?\s*)?(?:dent\.?\s*)?[a-zäöüß]|praxis|gemeinschaftspraxis|apotheke|klinik|klinikum|krankenhaus|mvz|zahnarzt|zahnärzt|labor|pflegedienst|pflegeheim|seniorenheim|seniorenzentrum|seniorenresidenz|altenheim|sozialstation|diakonie|caritas|physiotherapie|krankengymnastik|ergotherapie|logopädie|optik|augenoptik|sanitätshaus|hörgeräte|orthopädie|radiologie|facharzt|heilpraktiker|tagespflege)/i;
const KEIN_ERBRINGER = /patient|versicherte|herrn?\b|frau\b|bewohner|leistungsempfänger|rechnungsempfänger|bankverbindung|iban|bic|steuer|telefon|tel\.|fax|e-?mail|www\.|seite\s+\d/i;

function findeErbringer(zeilen: string[], text: string, bekannte: string[]): string | undefined {
  // 1. Bereits bekannte Leistungserbringer wiedererkennen (längster Treffer)
  const klein = text.toLowerCase().replace(/\s+/g, ' ');
  const bekannt = bekannte.filter((b) => b.length >= 4 && klein.includes(b.toLowerCase().replace(/\s+/g, ' '))).sort((a, b) => b.length - a.length);
  if (bekannt.length) return bekannt[0];
  // 1b. Unscharf: kennzeichnende Wörter (z. B. Nachname) im Briefkopf
  const aehnlich = bekannterErbringerImText(zeilen.slice(0, 25).join('\n'), bekannte);
  if (aehnlich) return aehnlich;
  // 2. Briefkopf: erste passende Zeile im oberen Teil
  for (const z of zeilen.slice(0, 20)) {
    if (KEIN_ERBRINGER.test(z)) continue;
    const teil = z.split(/\s[·|•–-]\s|\s{3,}|,\s(?=\d{5}\s)/).find((t) => ERBRINGER.test(t));
    if (teil) {
      const sauber = teil.replace(/^[\s·|•–-]+|[\s·|•–,-]+$/g, '').trim();
      if (sauber.length >= 4 && sauber.length <= 70) return sauber;
    }
  }
  // 3. Firmenzeile im Briefkopf
  const firma = zeilen.slice(0, 10).find((z) => /\b(gmbh|ggmbh|e\.\s?v\.|ag|kg|ohg)\b/i.test(z) && !KEIN_ERBRINGER.test(z));
  return firma?.trim().slice(0, 70);
}

const PFLEGE = /pflegegrad|pflegeleistung|pflegesachleistung|pflegedienst|pflegeheim|pflegeeinrichtung|stationäre\s+pflege|kurzzeitpflege|verhinderungspflege|tagespflege|entlastungsbetrag|sgb\s*xi|investitionskosten|unterkunft\s+und\s+verpflegung|heimentgelt|pflegesatz/i;
const VORSORGE = /vorsorgeuntersuchung|vorsorge\b|früherkennung|check-?\s?up|gesundheitsuntersuchung|krebsvorsorge/i;

function findePerson(zeilen: string[], personen: ParserKontext['personen']): string | undefined {
  const varianten = personen.flatMap((p) =>
    (p.namenAufRechnung ?? '')
      .split(',')
      .map((n) => n.trim().toLowerCase().replace(/\s+/g, ' '))
      .filter((n) => n.length >= 3)
      .map((n) => ({ id: p.id, n })),
  );
  if (!varianten.length) return undefined;
  const norm = (z: string) => z.toLowerCase().replace(/\s+/g, ' ');
  // Bevorzugt die Zeile, die den Patienten nennt (Empfänger kann ein Angehöriger sein)
  const patientZeilen = zeilen.flatMap((z, i) => (/patient|versicherte|behandelte|leistungsempfänger|bewohner|für\s*:/i.test(z) ? [z, zeilen[i + 1] ?? ''] : []));
  for (const quelle of [patientZeilen, zeilen]) {
    const treffer = new Set(varianten.filter((v) => quelle.some((z) => norm(z).includes(v.n))).map((v) => v.id));
    if (treffer.size === 1) return [...treffer][0];
  }
  return undefined;
}

/** Liest die wichtigsten Angaben aus dem Text einer Rechnung. */
export function rechnungAuslesen(roh: string, k: ParserKontext): Erkennung {
  // Leerzeichen vereinheitlichen, breite Spaltenabstände (≥ 3) aber erhalten – sie trennen Tabellenspalten
  const text = roh
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, '   ')
    .replace(/ {3,}/g, '   ')
    .replace(/(?<! ) {2}(?! )/g, ' ');
  const zeilen = text.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  const e: Erkennung = {};
  e.betrag = findeBetrag(zeilen);
  e.datum = findeDatum(zeilen, k.heute);
  e.faelligAm = findeFaellig(zeilen, e.datum);
  if (e.faelligAm && e.datum && e.faelligAm < e.datum) e.faelligAm = undefined;
  e.rechnungsnummer = findeRechnungsnummer(zeilen);
  e.leistungserbringer = findeErbringer(zeilen, text, k.bekannteErbringer);
  e.art = PFLEGE.test(text) ? 'pflege' : 'krankheit';
  if (e.art === 'krankheit' && VORSORGE.test(text)) e.vorsorge = true;
  e.personId = findePerson(zeilen, k.personen);
  for (const key of Object.keys(e) as (keyof Erkennung)[]) if (e[key] == null) delete e[key];
  return e;
}

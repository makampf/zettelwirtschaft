import { bekannterErbringerImText, kennwoerter, normalisiere } from '../providers';
import { plusTage } from '../format';
import type { ServiceKind, Person } from '../types';

/** Aus einem Rechnungstext erkannte Angaben. Alles optional – nur was sicher genug gefunden wurde. */
export interface Recognition {
  /** Betrag in Cent. */
  amount?: number;
  date?: string;
  dueDate?: string;
  invoiceNumber?: string;
  provider?: string;
  /** Verrechnungsstelle, die im Auftrag des Leistungserbringers abrechnet. */
  billingOffice?: string;
  kind?: ServiceKind;
  preventive?: boolean;
  personId?: string;
}

export interface ParserKontext {
  personen: Pick<Person, 'id' | 'invoiceNames'>[];
  /** Bereits verwendete Leistungserbringer – werden bevorzugt wiedererkannt. */
  bekannteErbringer: string[];
  /** Bereits verwendete Verrechnungsstellen – deren Schreibweise wird übernommen. */
  bekannteVerrechnungsstellen?: string[];
  /** Heutiges Datum (ISO) für Plausibilitätsprüfungen. */
  heute: string;
}

// ---------------------------------------------------------------------------
// Beträge

const BETRAG = /(?<![\d,.])(\d{1,3}(?:[.\s]\d{3})+|\d+),(\d{2})(?![\d])|(?<![\d,.])(\d+)\.(\d{2})(?=\s*(?:€|EUR))/g;

export function betraegeIn(zeile: string): number[] {
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
const DATUM_ZAHL = /(?<!\d)(\d{1,2})\.\s{0,3}(\d{1,2})\.\s{0,3}(\d{4}|\d{2})(?![\d,])/g;
const DATUM_TEXT = /(?<!\d)(\d{1,2})\.?\s+(januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember|jan|feb|mär|mrz|apr|jun|jul|aug|sept|sep|okt|nov|dez)\.?\s+(\d{4})/gi;

function iso(t: number, m: number, j: number): string | undefined {
  if (j < 100) j += 2000;
  if (m < 1 || m > 12 || t < 1 || t > 31 || j < 1990 || j > 2100) return undefined;
  const d = new Date(j, m - 1, t);
  if (d.getMonth() !== m - 1) return undefined;
  return `${j}-${String(m).padStart(2, '0')}-${String(t).padStart(2, '0')}`;
}

export function datenIn(zeile: string): string[] {
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
/** Tabellenkopf der Leistungsaufstellung („Datum  Ziffer  Bezeichnung …“) – die Daten darunter sind Behandlungstage. */
const TABELLENKOPF = /^datum\s+(ziffer|nr|gop|go[äa]|bezeichnung|leistung|anz)/i;

function findeDatum(zeilen: string[], heute: string): string | undefined {
  const perSchluessel = datumNachSchluessel(zeilen, /rechnungsdatum|datum\s+der\s+rechnung|rechnung\s+vom|liquidation\s+vom|ausgestellt\s+am|belegdatum|rg\.?-?datum|re\.?-?datum/i);
  if (perSchluessel) return perSchluessel;
  const datumszeile = datumNachSchluessel(
    zeilen.map((z) => (KEIN_RECHNUNGSDATUM.test(z) || TABELLENKOPF.test(z) ? '' : z)),
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

const ZAHLWOERTER: Record<string, number> = {
  drei: 3, fünf: 5, sieben: 7, acht: 8, zehn: 10, vierzehn: 14, fünfzehn: 15, zwanzig: 20, einundzwanzig: 21, dreißig: 30, dreissig: 30, sechzig: 60,
};

function findeFaellig(zeilen: string[], datum: string | undefined): string | undefined {
  const d = datumNachSchluessel(zeilen, /zahlbar\s+bis|fällig\s+(am|bis)|zahlungsziel|spätestens(?:\s+jedoch)?\s+(am|bis)|bis\s+zum|zahlen\s+sie\s+bis|bitte\s+bis|fälligkeit/i);
  if (d) return d;
  const text = zeilen.join(' ');
  const frist = /(?:innerhalb|binnen)\s+(?:von\s+)?(\d{1,3}|[a-zäöüß]+)\s+tagen/i.exec(text);
  const tage = frist && (Number(frist[1]) || ZAHLWOERTER[frist[1].toLowerCase()]);
  if (tage && datum) return plusTage(datum, tage);
  if (/zahlbar\s+sofort|sofort\s+fällig/i.test(text) && datum) return datum;
  return undefined;
}

// ---------------------------------------------------------------------------
// Rechnungsnummer, Leistungserbringer, Art, Person

/** Bezeichnungen der Rechnungsnummer mit Gewicht. Wortgrenzen verhindern Treffer in „Ihre Nr.“ / „Unsere Nr.“. */
const NR_SCHLUESSEL: [RegExp, number][] = [
  [/\brechnungs?[-\s]?(?:nummer|nr|no)\b\.?/gi, 3],
  [/\brechnung\s+(?:nr|no)\b\.?/gi, 3],
  [/\b(?:rg|re)\.?[-\s]?nr\b\.?/gi, 2],
  [/\binvoice\s*(?:no|nr|number)\b\.?/gi, 2],
  [/\bbeleg[-\s]?(?:nummer|nr)\b\.?/gi, 1],
];
// Wert, ggf. mit Leerzeichen gedruckt („123456 789“) – Folgegruppen nur aus Ziffern und danach Leerraum/Ende,
// damit Beträge („12,50“) oder Daten („01.02.2026“) nicht angehängt werden
const NR_WERT = /^([A-Za-z0-9][A-Za-z0-9\-/.]{1,30}(?: \d{2,}(?=\s|$))*)/;
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
    const wert = roh?.trim().match(NR_WERT)?.[1].replace(/[.]$/, '').replace(/ /g, '');
    const zusatz = wert ? nrBewertung(wert) : null;
    if (wert && zusatz != null && (!bester || punkte + zusatz > bester.punkte)) bester = { wert, punkte: punkte + zusatz };
  };

  zeilen.forEach((zeile, i) => {
    for (const [re, gewicht] of NR_SCHLUESSEL) {
      for (const m of zeile.matchAll(re)) {
        const ende = (m.index ?? 0) + m[0].length;
        const rest = zeile.slice(ende);
        // 1. Wert direkt dahinter („Rechnungsnummer: 4711“)
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

// ---------------------------------------------------------------------------
// Verrechnungsstellen: rechnen im Auftrag eines Arztes ab, ihr Name steht im Briefkopf

const VERRECHNUNG = /verrechnungsstelle|abrechnungsstelle|abrechnungszentrum|abrechnungsgesellschaft|privatärztliche\s+verrechnung|\bpvs\b/i;
/** Hinweise auf den eigentlichen Leistungserbringer im Beleg einer Verrechnungsstelle. */
const AUFTRAGGEBER = /liquidation\s+(?:vom\s+\S+\s+)?für|im\s+auftrag\s+(?:von|des|der)|abrechnung\s+für|behandelnde[rn]?\s+(?:arzt|ärztin)|leistungserbringer\s*:/i;
const ARZTNAME = /\bDr\.?\s*(?:med\.?\s*)?(?:dent\.?\s*)?(?:univ\.?\s*)?(?:[A-ZÄÖÜ][a-zäöüß]+-?)+(?:\s+(?:[A-ZÄÖÜ][a-zäöüß]+-?)+)?/g;
const TEILE = /\s[·|•–-]\s|\s{3,}/;

/** Name der Verrechnungsstelle, wenn der Beleg von einer stammt. */
function findeVerrechnungsstelle(zeilen: string[]): string | undefined {
  for (const [i, z] of zeilen.entries()) {
    const teil = z.split(TEILE)[0].replace(/[\s!.:,]+$/, '').trim();
    if (!VERRECHNUNG.test(teil) || /\b(bitte|sie|ihr|wir|uns)\b/i.test(teil)) continue;
    // Stichwort allein in der Zeile: Name steht in der Zeile darüber („Muster & Partner“ / „Verrechnungsstelle“)
    if (!kennwoerter(teil).length && i > 0) {
      const davor = zeilen[i - 1].split(TEILE)[0].trim();
      if (davor && !VERRECHNUNG.test(davor) && davor.length <= 50) return `${davor} ${teil}`;
    }
    if (teil.length >= 4 && teil.length <= 70) return teil;
  }
  return undefined;
}

/** Behandelnder Arzt im Beleg einer Verrechnungsstelle (nicht die Verrechnungsstelle selbst). */
function findeAuftraggeber(zeilen: string[], stelle: string): string | undefined {
  const fremd = new Set(kennwoerter(stelle));
  const namen = (z: string) =>
    [...z.matchAll(ARZTNAME)]
      .map((m) => m[0].trim())
      .filter((n) => kennwoerter(n).length && !kennwoerter(n).some((w) => fremd.has(w)));
  // Bevorzugt hinter einem Hinweis wie „Liquidation für“, „im Auftrag von“ (Name oft in den Folgezeilen)
  const i = zeilen.findIndex((z) => AUFTRAGGEBER.test(z));
  const bereiche = i >= 0 ? [zeilen.slice(i, i + 5), zeilen.slice(0, 25)] : [zeilen.slice(0, 25)];
  for (const b of bereiche) {
    const liste = b.filter((z) => !/patient|versicherte|geb(\.|urt)/i.test(z)).flatMap(namen);
    // Ausführlichster Name („Dr. med. Erika Beispiel“ statt „Dr. Beispiel“)
    if (liste.length) return liste.sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length || b.length - a.length)[0];
  }
  return undefined;
}

/** Passt ein Name nur zur Verrechnungsstelle (alle kennzeichnenden Wörter stammen aus deren Namen)? */
function nurVerrechnungsstelle(name: string, stelle: string | undefined): boolean {
  if (!stelle) return false;
  const eigen = new Set(kennwoerter(stelle));
  const kenn = kennwoerter(name);
  return VERRECHNUNG.test(name) || (kenn.length > 0 && kenn.every((w) => eigen.has(w)));
}

function findeErbringer(zeilen: string[], text: string, bekannteAlle: string[], stelle?: string): string | undefined {
  // Bekannte Namen, die nur die Verrechnungsstelle bezeichnen, zählen nicht als Leistungserbringer
  const bekannte = bekannteAlle.filter((b) => !nurVerrechnungsstelle(b, stelle));
  // 1. Bereits bekannte Leistungserbringer wiedererkennen (längster Treffer)
  const klein = text.toLowerCase().replace(/\s+/g, ' ');
  const bekannt = bekannte.filter((b) => b.length >= 4 && klein.includes(b.toLowerCase().replace(/\s+/g, ' '))).sort((a, b) => b.length - a.length);
  if (bekannt.length) return bekannt[0];
  // 1b. Unscharf: kennzeichnende Wörter (z. B. Nachname) im Briefkopf
  const aehnlich = bekannterErbringerImText(zeilen.slice(0, 25).join('\n'), bekannte);
  if (aehnlich) return aehnlich;
  // 1c. Beleg einer Verrechnungsstelle: behandelnden Arzt suchen
  if (stelle) {
    const arzt = findeAuftraggeber(zeilen, stelle);
    // Bekannter Erbringer mit demselben Nachnamen (z. B. selbst umbenannt in „Praxis Dr. Beispiel“) hat Vorrang
    const nachname = arzt && kennwoerter(arzt).pop();
    const gleich = nachname && bekannte.find((b) => kennwoerter(b).includes(nachname));
    if (gleich || arzt) return gleich || arzt;
  }
  // 2. Briefkopf: erste passende Zeile im oberen Teil
  for (const z of zeilen.slice(0, 20)) {
    if (KEIN_ERBRINGER.test(z) || (stelle && VERRECHNUNG.test(z))) continue;
    const teil = z.split(/\s[·|•–-]\s|\s{3,}|,\s(?=\d{5}\s)/).find((t) => ERBRINGER.test(t));
    if (teil && !nurVerrechnungsstelle(teil, stelle)) {
      let sauber = teil.replace(/^[\s·|•–-]+|[\s·|•–,-]+$/g, '').trim();
      // Nur allgemeine Wörter („Praxis für Ergotherapie“)? Dann den Ort aus derselben Zeile ergänzen.
      const ort = /\b\d{5}\s+([A-ZÄÖÜ][A-Za-zäöüß-]+)/.exec(z)?.[1];
      if (!kennwoerter(sauber).length && ort) sauber = `${sauber} ${ort}`;
      if (sauber.length >= 4 && sauber.length <= 70) return sauber;
    }
  }
  // 3. Firmenzeile im Briefkopf
  const firma = zeilen.slice(0, 10).find((z) => !(stelle && VERRECHNUNG.test(z)) && /\b(gmbh|ggmbh|e\.\s?v\.|ag|kg|ohg)\b/i.test(z) && !KEIN_ERBRINGER.test(z));
  return firma?.trim().slice(0, 70);
}

const PFLEGE = /pflegegrad|pflegeleistung|pflegesachleistung|pflegedienst|pflegeheim|pflegeeinrichtung|stationäre\s+pflege|kurzzeitpflege|verhinderungspflege|tagespflege|entlastungsbetrag|sgb\s*xi|investitionskosten|unterkunft\s+und\s+verpflegung|heimentgelt|pflegesatz/i;
const VORSORGE = /vorsorgeuntersuchung|vorsorge\b|früherkennung|check-?\s?up|gesundheitsuntersuchung|krebsvorsorge/i;

function findePerson(zeilen: string[], personen: ParserKontext['personen']): string | undefined {
  // Namen als Wortmengen: passt auch bei „Mustermann, Erika“, anderer Reihenfolge oder fehlenden Umlauten (OCR)
  const varianten = personen.flatMap((p) =>
    (p.invoiceNames ?? '')
      .split(',')
      .map((n) => normalisiere(n).split(' ').filter((w) => w.length >= 2))
      .filter((w) => w.join('').length >= 3)
      .map((woerter) => ({ id: p.id, woerter })),
  );
  if (!varianten.length) return undefined;
  const woerterJeZeile = zeilen.map((z) => new Set(normalisiere(z).split(' ')));
  const treffer = (idx: number[]) =>
    new Set(varianten.filter((v) => idx.some((i) => v.woerter.every((w) => woerterJeZeile[i].has(w)))).map((v) => v.id));
  const eindeutig = (s: Set<string>) => (s.size === 1 ? [...s][0] : undefined);
  const alle = zeilen.map((_, i) => i);
  // 1. Zeilen, die den Patienten nennen (Empfänger kann ein Angehöriger oder Bevollmächtigter sein)
  const patient = alle.filter((i) => PATIENT.test(zeilen[i]) || (i > 0 && PATIENT_DAVOR.test(zeilen[i - 1])));
  const ausPatient = eindeutig(treffer(patient));
  if (ausPatient) return ausPatient;
  // 2. Ganzer Beleg
  const ueberall = treffer(alle);
  if (ueberall.size <= 1) return eindeutig(ueberall);
  // 3. Mehrdeutig: wer nur im Anschriftenfeld steht (z. B. „c/o“, Bevollmächtigte), ist vermutlich nicht der Patient
  const anschrift = alle.slice(0, 15).filter((i) => ANSCHRIFT.test(zeilen[i]) || (i > 0 && ANSCHRIFT.test(zeilen[i - 1])));
  const nurAnschrift = treffer(anschrift);
  const rest = treffer(alle.filter((i) => !anschrift.includes(i)));
  return eindeutig(new Set([...ueberall].filter((id) => rest.has(id) || !nurAnschrift.has(id))));
}

const PATIENT = /patient|versicherte|behandelte|leistungsempfänger|bewohner|für\s*:|geb(\.|oren|urtsdatum)|\*\s?\d{1,2}\.\d{1,2}\.\d{2,4}/i;
const PATIENT_DAVOR = /patient(in)?\s*:?\s*$|leistungsempfänger\s*:?\s*$|behandelte\s+person\s*:?\s*$/i;
const ANSCHRIFT = /c\/o|z\.\s?hd|bevollmächtigt|betreuer|herrn?\b|frau\b/i;

/** Liest die wichtigsten Angaben aus dem Text einer Rechnung. */
export function rechnungAuslesen(roh: string, k: ParserKontext): Recognition {
  // Leerzeichen vereinheitlichen, breite Spaltenabstände (≥ 3) aber erhalten – sie trennen Tabellenspalten
  const text = roh
    .replace(/\u00a0/g, ' ')
    .replace(/\t/g, '   ')
    .replace(/ {3,}/g, '   ')
    .replace(/(?<! ) {2}(?! )/g, ' ');
  const zeilen = text.split(/\r?\n/).map((z) => z.trim()).filter(Boolean);
  const e: Recognition = {};
  e.amount = findeBetrag(zeilen);
  e.date = findeDatum(zeilen, k.heute);
  e.dueDate = findeFaellig(zeilen, e.date);
  if (e.dueDate && e.date && e.dueDate < e.date) e.dueDate = undefined;
  e.invoiceNumber = findeRechnungsnummer(zeilen);
  const stelle = findeVerrechnungsstelle(zeilen);
  e.billingOffice = stelle && (bekannterErbringerImText(stelle, k.bekannteVerrechnungsstellen ?? []) ?? stelle);
  e.provider = findeErbringer(zeilen, text, k.bekannteErbringer, stelle);
  e.kind = PFLEGE.test(text) ? 'care' : 'illness';
  if (e.kind === 'illness' && VORSORGE.test(text)) e.preventive = true;
  e.personId = findePerson(zeilen, k.personen);
  for (const key of Object.keys(e) as (keyof Recognition)[]) if (e[key] == null) delete e[key];
  return e;
}

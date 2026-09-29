import { describe, expect, it } from 'vitest';
import { rechnungAuslesen, type ParserKontext } from './parser';

const kontext: ParserKontext = {
  heute: '2026-09-29',
  bekannteErbringer: ['Apotheke am Markt'],
  personen: [
    { id: 'ich', invoiceNames: 'Max Mustermann' },
    { id: 'oma', invoiceNames: 'Erika Mustermann, Erika Muster-Mann' },
    { id: 'opa', invoiceNames: 'Hans Mustermann' },
  ],
};

const GOAE = `
Dr. med. Anna Weiß · Fachärztin für Innere Medizin · Hauptstraße 5 · 80331 München
Herrn
Hans Mustermann
Lindenweg 3
80999 München

Privatliquidation                                  Rechnungsdatum: 14.09.2026
Rechnungs-Nr.: 2026-0815
Patientin: Erika Mustermann, geb. 01.02.1941

Datum        GOÄ   Leistung                               Faktor   Betrag
02.09.2026   1     Beratung                               2,3      10,72 €
02.09.2026   5     Symptombezogene Untersuchung           2,3      10,72 €
09.09.2026   250   Blutentnahme                           1,8       4,20 €
                                          Zwischensumme            25,64 €
                                          Rechnungsbetrag          25,64 €

Bitte überweisen Sie den Betrag innerhalb von 30 Tagen.
IBAN DE12 3456 7890 1234 5678 90 · Steuernummer 123/456/789
`;

const APOTHEKE = `
Apotheke am Markt
Marktplatz 1, 80331 München
Quittung / Beleg-Nr. 44718
Datum: 03.08.2026
Ibuprofen 400 20 St.        5,49
Pantoprazol 20mg 30 St.    18,90
Gesamt EUR                 24,39
Kunde: Max Mustermann
`;

const PFLEGEHEIM = `
Seniorenzentrum Sonnenhof gGmbH
Am Park 12 · 80999 München
Rechnung Nr. SZ/2026/09-117                    München, 1. September 2026
Bewohnerin: Erika Mustermann   Pflegegrad 3
Leistungszeitraum 01.09.2026 – 30.09.2026
Pflegesatz stationäre Pflege (30 Tage)        2.851,20 €
Unterkunft und Verpflegung                      1.024,50 €
Investitionskosten                                612,00 €
Gesamtbetrag                                    4.487,70 €
abzüglich Leistung Pflegekasse                 -1.262,00 €
Zu zahlender Betrag                             3.225,70 €
zahlbar bis 15.09.2026
`;

const ZAHNARZT = `
Zahnarztpraxis Dr. dent. Karl Zahn
Rechnung vom 12.03.2026    Rechnungsnummer: Z-3321
Patient: Max Mustermann
Vorsorgeuntersuchung (Ä1, 0010)
Endbetrag: 64,37 EUR
`;

// Typischer OCR-Text eines Fotos: verrutschte Leerzeichen, fehlende Zeilen
const OCR = `
Physiotherapie Bewegung & Mehr
Krankengymnastik 6x
Rechnungsdatum 22. Juli 2026
Rg-Nr 7781
Summe 1 3 6,80 €
Gesamtbetrag EUR 136,80
Patient Hans  Mustermann
`;

describe('Rechnung auslesen', () => {
  it('Arztrechnung nach GOÄ', () => {
    expect(rechnungAuslesen(GOAE, kontext)).toEqual({
      amount: 2564,
      date: '2026-09-14',
      dueDate: '2026-10-14',
      invoiceNumber: '2026-0815',
      provider: 'Dr. med. Anna Weiß',
      kind: 'illness',
      personId: 'oma', // Patientin, nicht der Rechnungsempfänger
    });
  });

  it('Apothekenbeleg mit bekanntem Leistungserbringer', () => {
    expect(rechnungAuslesen(APOTHEKE, kontext)).toEqual({
      amount: 2439,
      date: '2026-08-03',
      invoiceNumber: '44718',
      provider: 'Apotheke am Markt',
      kind: 'illness',
      personId: 'ich',
    });
  });

  it('Pflegeheim: Zahlbetrag nach Abzug, Pflege erkannt', () => {
    const e = rechnungAuslesen(PFLEGEHEIM, kontext);
    expect(e).toMatchObject({
      amount: 322570,
      date: '2026-09-01',
      dueDate: '2026-09-15',
      invoiceNumber: 'SZ/2026/09-117',
      provider: 'Seniorenzentrum Sonnenhof gGmbH',
      kind: 'care',
      personId: 'oma',
    });
  });

  it('Zahnarzt-Vorsorge', () => {
    expect(rechnungAuslesen(ZAHNARZT, kontext)).toEqual({
      amount: 6437,
      date: '2026-03-12',
      invoiceNumber: 'Z-3321',
      provider: 'Zahnarztpraxis Dr. dent. Karl Zahn',
      kind: 'illness',
      preventive: true,
      personId: 'ich',
    });
  });

  it('unsauberer OCR-Text', () => {
    expect(rechnungAuslesen(OCR, kontext)).toEqual({
      amount: 13680,
      date: '2026-07-22',
      invoiceNumber: '7781',
      provider: 'Physiotherapie Bewegung & Mehr',
      kind: 'illness',
      personId: 'opa',
    });
  });

  // Nachbildungen typischer Praxisrechnungen (Aufbau wie von pdf.js gelesen)
  const PRAXIS_1 = `www.beispiel.de
Praxis für Ergotherapie   | Musterweg 8   | 90000 Musterstadt   Praxis für   Musterweg 8
Herr   Ergo- und Handtherapie   90000 Musterstadt
Max Mustermann
Telefax: 09999 1234567
Datum:   01.08.2026
Rechnung
Therapeut:   Paul Beispiel,   LANR:   987654321
Rechnung-Nr.:202608471
Datum   Ziffer   Anzahl   Faktor   Betrag   Leistungstext
BSNR: 999999900
Steuernr.: 123/456/78901
Rechnungsnummer: 202608 471
Nettobetrag:   502,74 €
Gesamtbetrag:   502,74 €
Bitte überweisen Sie den Gesamtbetrag bis zum 23.08.2026 auf eines der nebenstehenden
Konten unter Angabe der Rechnungsnummer.`;

  const PRAXIS_2 = `Praxis für Ergotherapie   | Musterweg 8   | 90000 Musterstadt   Praxis   Musterweg 8
Datum:   31.08.2026
Rechnung-Nr: 202608 158
LANR: 987654321
Rechnungsnummer: 202608 158
Gesamtbetrag: 670,32 €
Bitte überweisen Sie den Gesamtbetrag unter Angabe der Rechnungsnummer
innerhalb von fünf Tagen ab Rechnungsdatum auf eines meiner Konten.`;

  it('Praxisrechnung 1: „Rechnung-Nr.“ ohne s, LANR ist keine Rechnungsnummer', () => {
    expect(rechnungAuslesen(PRAXIS_1, kontext)).toEqual({
      amount: 50274,
      date: '2026-08-01',
      dueDate: '2026-08-23',
      invoiceNumber: '202608471',
      provider: 'Praxis für Ergotherapie Musterstadt',
      kind: 'illness',
      personId: 'ich',
    });
  });

  it('Praxisrechnung 2: Nummer mit Leerzeichen, Frist als Zahlwort', () => {
    expect(rechnungAuslesen(PRAXIS_2, kontext)).toMatchObject({
      amount: 67032,
      date: '2026-08-31',
      dueDate: '2026-09-05',
      invoiceNumber: '202608158',
    });
  });

  describe('Rechnungsnummer', () => {
    const nr = (text: string) => rechnungAuslesen(text, kontext).invoiceNumber;

    it('verwechselt „Ihre Nr.“ / „Unsere Nr.“ nicht mit der Rechnungsnummer', () => {
      expect(nr('Ihre Nr. 202608   Rechnungsnummer 987654321')).toBe('987654321');
      expect(nr('Unsere Nr.: 202608\nRechnungsnummer: 987654321')).toBe('987654321');
      expect(nr('Ihre Nr. 202608')).toBeUndefined();
    });

    it('liest Tabellenköpfe mit dem Wert in der Zeile darunter', () => {
      const text = 'Kundennummer   Rechnungsnummer   Rechnungsdatum\n202608   987654321   14.08.2026';
      expect(nr(text)).toBe('987654321');
    });

    it('nimmt nicht das Rechnungsdatum als Nummer', () => {
      expect(nr('Rechnungs-Nr. / Datum: 14.08.2026\nRechnungs-Nr.: 987654321')).toBe('987654321');
    });

    it('setzt mit Leerzeichen gedruckte Nummern zusammen, aber nicht mit Beträgen oder Daten', () => {
      expect(nr('Rechnungsnummer: 202608 158')).toBe('202608158');
      expect(nr('Rechnungsnr. 4711 12,50 €')).toBe('4711');
      expect(nr('Rechnungsnummer 4711 vom 01.02.2026')).toBe('4711');
    });

    it('bevorzugt „Rechnungsnummer“ gegenüber schwächeren Bezeichnungen', () => {
      expect(nr('Beleg-Nr. 7712\nRechnungsnummer 987654321')).toBe('987654321');
      expect(nr('Rg.-Nr. 7781')).toBe('7781');
      expect(nr('Rechnung Nr. SZ/2026/09-117')).toBe('SZ/2026/09-117');
    });
  });

  it('liefert bei unbrauchbarem Text nur wenig', () => {
    expect(rechnungAuslesen('Hallo Welt', kontext)).toEqual({ kind: 'illness' });
  });

  it('ordnet mehrdeutige Namen keiner Person zu', () => {
    const e = rechnungAuslesen('Erika Mustermann und Hans Mustermann\nSumme 10,00 €', kontext);
    expect(e.personId).toBeUndefined();
  });

  it('Rückfall: größter Euro-Betrag und spätestes Datum', () => {
    const e = rechnungAuslesen('Praxis Nord\nBehandlung am 01.06.2026 12,00 €\nam 15.06.2026 30,00 €\nMünchen, 20.06.2026', kontext);
    expect(e.amount).toBe(3000);
    expect(e.date).toBe('2026-06-20');
  });
  describe('Verrechnungsstelle', () => {
    // Frei erfundener Beleg: Verrechnungsstelle rechnet im Auftrag einer Praxis ab, rechte Spalte in die Adresse gemischt
    const VST = `
Muster & Partner
Verrechnungsstelle
Muster & Partner - Musterplatz 1 - 90000 Musterstadt   Liquidation vom 14.09.2026 für
Herrn   Praxis Dr. Beispiel u. Partner Fachärzte
Max Mustermann   Dr. med. Paul Beispiel
Musterweg 1   Facharzt für Allgemeinmedizin
90000 Musterstadt
Rechnungsnummer: 2026-4711
Bitte wenden Sie sich bei allen Fragen an die Muster & Partner Verrechnungsstelle!
Patient Mustermann, Max geb. 01.01.1980
Datum Ziffer Bezeichnung Faktor Betrag
02.08.26 1 Beratung 2,3 10,72
Rechnungsbetrag: 10,72 €
Die Rechnung ist sofort zur Zahlung fällig, spätestens jedoch am: 14.10.2026
Bitte gleichen Sie die Rechnung binnen 30 Tagen aus.
Muster & Partner Verrechnungsstelle GmbH - Musterplatz 1 - 90000 Musterstadt
`;
    const lies = (bekannteErbringer: string[] = [], bekannteVerrechnungsstellen: string[] = []) =>
      rechnungAuslesen(VST, { ...kontext, bekannteErbringer, bekannteVerrechnungsstellen });

    it('erkennt Verrechnungsstelle, behandelnden Arzt, Liquidationsdatum und Zahlungsziel', () => {
      expect(lies()).toMatchObject({
        billingOffice: 'Muster & Partner Verrechnungsstelle',
        provider: 'Dr. med. Paul Beispiel',
        date: '2026-09-14',
        dueDate: '2026-10-14',
        amount: 1072,
        invoiceNumber: '2026-4711',
        personId: 'ich',
      });
    });

    it('nimmt nicht die als Erbringer bekannte Verrechnungsstelle, sondern den Arzt', () => {
      expect(lies(['Muster & Partner']).provider).toBe('Dr. med. Paul Beispiel');
      expect(lies(['Muster & Partner Verrechnungsstelle']).provider).toBe('Dr. med. Paul Beispiel');
    });

    it('erkennt einen einmal korrigierten Erbringer beim nächsten Beleg wieder', () => {
      expect(lies(['Muster & Partner', 'Praxis Dr. Beispiel']).provider).toBe('Praxis Dr. Beispiel');
      // auch mit eigenen Zusätzen, die nicht im Beleg stehen
      expect(lies(['Muster & Partner', 'Praxis Beispiel am Park']).provider).toBe('Praxis Beispiel am Park');
    });

    it('übernimmt die Schreibweise einer bekannten Verrechnungsstelle', () => {
      expect(lies([], ['Muster und Partner']).billingOffice).toBe('Muster und Partner');
    });

    it('setzt ohne Verrechnungsstelle kein billingOffice', () => {
      expect(rechnungAuslesen(GOAE, kontext).billingOffice).toBeUndefined();
    });
  });
});

import { describe, expect, it } from 'vitest';
import { rechnungAuslesen, type ParserKontext } from './parser';

const kontext: ParserKontext = {
  heute: '2026-09-29',
  bekannteErbringer: ['Apotheke am Markt'],
  personen: [
    { id: 'ich', namenAufRechnung: 'Max Mustermann' },
    { id: 'oma', namenAufRechnung: 'Erika Mustermann, Erika Muster-Mann' },
    { id: 'opa', namenAufRechnung: 'Hans Mustermann' },
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
      betrag: 2564,
      datum: '2026-09-14',
      faelligAm: '2026-10-14',
      rechnungsnummer: '2026-0815',
      leistungserbringer: 'Dr. med. Anna Weiß',
      art: 'krankheit',
      personId: 'oma', // Patientin, nicht der Rechnungsempfänger
    });
  });

  it('Apothekenbeleg mit bekanntem Leistungserbringer', () => {
    expect(rechnungAuslesen(APOTHEKE, kontext)).toEqual({
      betrag: 2439,
      datum: '2026-08-03',
      rechnungsnummer: '44718',
      leistungserbringer: 'Apotheke am Markt',
      art: 'krankheit',
      personId: 'ich',
    });
  });

  it('Pflegeheim: Zahlbetrag nach Abzug, Pflege erkannt', () => {
    const e = rechnungAuslesen(PFLEGEHEIM, kontext);
    expect(e).toMatchObject({
      betrag: 322570,
      datum: '2026-09-01',
      faelligAm: '2026-09-15',
      rechnungsnummer: 'SZ/2026/09-117',
      leistungserbringer: 'Seniorenzentrum Sonnenhof gGmbH',
      art: 'pflege',
      personId: 'oma',
    });
  });

  it('Zahnarzt-Vorsorge', () => {
    expect(rechnungAuslesen(ZAHNARZT, kontext)).toEqual({
      betrag: 6437,
      datum: '2026-03-12',
      rechnungsnummer: 'Z-3321',
      leistungserbringer: 'Zahnarztpraxis Dr. dent. Karl Zahn',
      art: 'krankheit',
      vorsorge: true,
      personId: 'ich',
    });
  });

  it('unsauberer OCR-Text', () => {
    expect(rechnungAuslesen(OCR, kontext)).toEqual({
      betrag: 13680,
      datum: '2026-07-22',
      rechnungsnummer: '7781',
      leistungserbringer: 'Physiotherapie Bewegung & Mehr',
      art: 'krankheit',
      personId: 'opa',
    });
  });

  it('liefert bei unbrauchbarem Text nur wenig', () => {
    expect(rechnungAuslesen('Hallo Welt', kontext)).toEqual({ art: 'krankheit' });
  });

  it('ordnet mehrdeutige Namen keiner Person zu', () => {
    const e = rechnungAuslesen('Erika Mustermann und Hans Mustermann\nSumme 10,00 €', kontext);
    expect(e.personId).toBeUndefined();
  });

  it('Rückfall: größter Euro-Betrag und spätestes Datum', () => {
    const e = rechnungAuslesen('Praxis Nord\nBehandlung am 01.06.2026 12,00 €\nam 15.06.2026 30,00 €\nMünchen, 20.06.2026', kontext);
    expect(e.betrag).toBe(3000);
    expect(e.datum).toBe('2026-06-20');
  });
});

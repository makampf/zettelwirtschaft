import { describe, expect, it } from 'vitest';
import { bekannterErbringerImText, erbringerListe, erbringerVorschlaege, normalisiere } from './providers';
import { rechnungAuslesen } from './recognition/parser';
import type { ServiceKind, Invoice } from './types';

let n = 0;
const r = (leistungserbringer: string, datum: string, personId = 'oma', art: ServiceKind = 'illness'): Invoice => ({
  id: `r${++n}`,
  personId,
  kind: art,
  date: datum,
  provider: leistungserbringer,
  invoiceNumber: '',
  description: '',
  amount: 100,
  preventive: false,
  heldBack: [],
  expectedOverride: {},
  fileIds: [],
  note: '',
});

const rechnungen = [
  r('Hausarzt Dr. Weiß', '2026-01-10', 'oma'),
  r('Hausarzt Dr. Weiß', '2026-05-10', 'opa'),
  r('hausarzt dr. weiß', '2026-06-01', 'oma'), // andere Schreibweise, gleicher Erbringer
  r('Apotheke am Markt', '2026-09-01', 'ich'),
  r('Apotheke am Markt', '2026-02-01', 'ich'),
  r('Seniorenzentrum Sonnenhof', '2026-08-01', 'oma', 'care'),
  r('Zahnarztpraxis Dr. Zahn', '2025-03-01', 'ich'),
];

describe('Leistungserbringer', () => {
  const liste = erbringerListe(rechnungen);

  it('fasst Schreibweisen zusammen und sortiert nach letzter Nutzung', () => {
    expect(liste.map((e) => [e.name, e.anzahl])).toEqual([
      ['Apotheke am Markt', 2],
      ['Seniorenzentrum Sonnenhof', 1],
      ['hausarzt dr. weiß', 3],
      ['Zahnarztpraxis Dr. Zahn', 1],
    ]);
  });

  it('merkt sich Art und – falls eindeutig – die Person', () => {
    const info = Object.fromEntries(liste.map((e) => [e.name, e]));
    expect(info['Seniorenzentrum Sonnenhof']).toMatchObject({ art: 'care', personId: 'oma' });
    expect(info['Apotheke am Markt'].personId).toBe('ich');
    expect(info['hausarzt dr. weiß'].personId).toBeUndefined(); // Oma und Opa
  });

  it('schlägt ohne Eingabe die zuletzt genutzten vor', () => {
    expect(erbringerVorschlaege(liste, '', 2).map((e) => e.name)).toEqual(['Apotheke am Markt', 'Seniorenzentrum Sonnenhof']);
  });

  it('filtert nach Wortanfängen, unabhängig von Groß-/Kleinschreibung und Umlauten', () => {
    expect(erbringerVorschlaege(liste, 'weiss').map((e) => e.name)).toEqual(['hausarzt dr. weiß']);
    expect(erbringerVorschlaege(liste, 'dr').map((e) => e.name)).toEqual(['hausarzt dr. weiß', 'Zahnarztpraxis Dr. Zahn']);
    expect(erbringerVorschlaege(liste, 'sonn').map((e) => e.name)).toEqual(['Seniorenzentrum Sonnenhof']);
    expect(erbringerVorschlaege(liste, 'xyz')).toEqual([]);
  });

  it('blendet einen vollständig eingegebenen Namen aus', () => {
    expect(erbringerVorschlaege(liste, 'Apotheke am Markt')).toEqual([]);
  });

  it('normalisiert Text', () => {
    expect(normalisiere('Dr. med. Jürgen Weiß-Müller')).toBe('dr med jurgen weiss muller');
  });

  it('erkennt bekannte Erbringer im Belegtext trotz anderer Schreibweise', () => {
    const namen = liste.map((e) => e.name);
    expect(bekannterErbringerImText('Dr. med. Anna Weiß · Fachärztin für Innere Medizin', namen)).toBe('hausarzt dr. weiß');
    expect(bekannterErbringerImText('Sonnenhof Pflege gGmbH', namen)).toBe('Seniorenzentrum Sonnenhof');
    expect(bekannterErbringerImText('Praxis Dr. Müller', namen)).toBeUndefined();
    // Nur allgemeine Wörter („Apotheke“) reichen nicht
    expect(bekannterErbringerImText('Stadt-Apotheke', ['Apotheke'])).toBeUndefined();
  });

  it('der Parser nutzt die Wiedererkennung beim Auslesen', () => {
    const e = rechnungAuslesen('Dr. med. Anna Weiß · Innere Medizin\nRechnungsbetrag 25,64 €', {
      heute: '2026-09-29',
      personen: [],
      bekannteErbringer: liste.map((x) => x.name),
    });
    expect(e.provider).toBe('hausarzt dr. weiß');
  });
});

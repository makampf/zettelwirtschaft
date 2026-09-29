import { describe, expect, it } from 'vitest';
import { startState } from './beispiel';
import {
  breCheck,
  einreichbareRechnungen,
  erwartet,
  hinweise,
  jahreswerte,
  rechnungUebersicht,
  selbstbehalt,
  standardZurueckhalten,
  traegerFuer,
  traegerInfo,
} from './calc';
import { parseEuro, plusMonate, tageZwischen } from './format';
import { migriere } from './migration';
import type { AppState, Einreichung, Rechnung } from './types';

let zaehler = 0;
function rechnung(teil: Partial<Rechnung> & { personId: string }): Rechnung {
  return {
    id: `r${String(++zaehler).padStart(3, '0')}`,
    art: 'krankheit',
    datum: '2026-03-01',
    leistungserbringer: 'Dr. Müller',
    rechnungsnummer: '',
    beschreibung: '',
    betrag: 10000,
    vorsorge: false,
    nichtEinreichen: [],
    erwartetManuell: {},
    dateiIds: [],
    notiz: '',
    ...teil,
  };
}

function einreichung(teil: Partial<Einreichung> & { personId: string } & Pick<Einreichung, 'kostentraeger' | 'positionen'>): Einreichung {
  const { personId, ...rest } = teil;
  return { id: Math.random().toString(36).slice(2), personIds: [personId], eingereichtAm: '2026-03-10', weg: 'app', referenz: '', status: 'eingereicht', dateiIds: [], notiz: '', ...rest };
}

/** Standarddaten: „Ich“ ohne Beihilfe (100 % PKV/PPV, 20 % SB bis 400 € für KV + PV, BRE 1.000 €), Oma/Opa mit 70 % Beihilfe und BRE. */
function setup() {
  const state: AppState = startState();
  const [ich, oma, opa] = state.personen;
  return { state, ich, oma, opa };
}

describe('parseEuro', () => {
  it.each([
    ['123,45', 12345],
    ['1.234,56', 123456],
    ['1234.56', 123456],
    ['1.234', 123400],
    ['12,5 €', 1250],
    ['0', 0],
  ])('%s → %d', (ein, aus) => expect(parseEuro(ein)).toBe(aus));

  it('lehnt Unsinn ab', () => {
    expect(parseEuro('abc')).toBeNull();
    expect(parseEuro('')).toBeNull();
    expect(parseEuro('1,234,5')).toBeNull();
  });
});

describe('Datum', () => {
  it('addiert Monate und kürzt am Monatsende', () => {
    expect(plusMonate('2026-01-31', 1)).toBe('2026-02-28');
    expect(plusMonate('2026-03-15', 12)).toBe('2027-03-15');
  });
  it('zählt Tage', () => {
    expect(tageZwischen('2026-01-01', '2026-01-31')).toBe(30);
    expect(tageZwischen('2026-03-28', '2026-03-30')).toBe(2); // über Zeitumstellung
  });
});

describe('Kostenträger', () => {
  it('ohne Beihilfeberechtigung nur PKV bzw. PPV', () => {
    const { ich, oma } = setup();
    expect(traegerFuer('krankheit', ich)).toEqual(['pkv']);
    expect(traegerFuer('pflege', ich)).toEqual(['ppv']);
    expect(traegerFuer('krankheit', oma)).toEqual(['beihilfe', 'pkv']);
    expect(traegerFuer('pflege', oma)).toEqual(['beihilfe', 'ppv']);
  });
});

describe('Erstattung mit Beihilfe', () => {
  it('berechnet erwartete Erstattung aus den Sätzen der Person', () => {
    const { oma } = setup();
    const r = rechnung({ personId: oma.id, betrag: 12345 });
    expect(erwartet(r, oma, 'beihilfe', [r])).toBe(8642); // 70 %
    expect(erwartet(r, oma, 'pkv', [r])).toBe(3704); // 30 %
    expect(erwartet({ ...r, erwartetManuell: { pkv: 1000 } }, oma, 'pkv', [r])).toBe(1000);
  });

  it('verfolgt den Status über Einreichung und Bescheid', () => {
    const { state, oma } = setup();
    const r = rechnung({ personId: oma.id, betrag: 20000 });
    state.rechnungen.push(r);
    expect(traegerInfo(r, oma, 'beihilfe', state).status).toBe('offen');

    const e = einreichung({ personId: oma.id, kostentraeger: 'beihilfe', positionen: [{ rechnungId: r.id }] });
    state.einreichungen.push(e);
    expect(traegerInfo(r, oma, 'beihilfe', state).status).toBe('eingereicht');
    expect(traegerInfo(r, oma, 'pkv', state).status).toBe('offen');

    state.einreichungen[0] = { ...e, status: 'beschieden', positionen: [{ rechnungId: r.id, erstattet: 13000 }] };
    const u = rechnungUebersicht(r, oma, state);
    expect(u.erstattet).toBe(13000);
    expect(u.ausstehend).toBe(6000); // PKV 30 % noch offen
    expect(u.eigenanteil).toBe(1000);
    expect(u.abgeschlossen).toBe(false);
  });

  it('behandelt 0 € als abgelehnt und erlaubt erneute Einreichung', () => {
    const { state, oma } = setup();
    const r = rechnung({ personId: oma.id });
    state.rechnungen.push(r);
    state.einreichungen.push(einreichung({ personId: oma.id, kostentraeger: 'pkv', status: 'beschieden', positionen: [{ rechnungId: r.id, erstattet: 0 }] }));
    expect(traegerInfo(r, oma, 'pkv', state).status).toBe('abgelehnt');
    expect(einreichbareRechnungen(state, oma.id, 'pkv').map((x) => x.id)).toEqual([r.id]);
  });

  it('Pflegerechnungen gehen an Beihilfe und PPV, nicht an PKV', () => {
    const { state, oma } = setup();
    state.rechnungen.push(rechnung({ personId: oma.id, art: 'pflege' }));
    expect(einreichbareRechnungen(state, oma.id, 'ppv')).toHaveLength(1);
    expect(einreichbareRechnungen(state, oma.id, 'pkv')).toHaveLength(0);
  });

  it('zurückgehaltene Positionen zählen zum Eigenanteil', () => {
    const { oma } = setup();
    const r = rechnung({ personId: oma.id, betrag: 5000, nichtEinreichen: ['pkv'] });
    const u = rechnungUebersicht(r, oma, { rechnungen: [r], einreichungen: [] });
    expect(u.ausstehend).toBe(3500);
    expect(u.eigenanteil).toBe(1500);
  });
});

describe('Selbstbehalt', () => {
  it('zieht 20 % ab, bis 400 € im Jahr erreicht sind', () => {
    const { ich } = setup();
    const r1 = rechnung({ personId: ich.id, datum: '2026-01-10', betrag: 100000 }); // SB 200 €
    const r2 = rechnung({ personId: ich.id, datum: '2026-02-10', betrag: 150000 }); // SB 200 € (Rest, statt 300 €)
    const r3 = rechnung({ personId: ich.id, datum: '2026-03-10', betrag: 50000 }); // SB 0 €
    const alle = [r3, r1, r2];
    expect(selbstbehalt(r1, ich, alle)).toBe(20000);
    expect(selbstbehalt(r2, ich, alle)).toBe(20000);
    expect(selbstbehalt(r3, ich, alle)).toBe(0);
    expect(erwartet(r2, ich, 'pkv', alle)).toBe(130000);
    expect(erwartet(r3, ich, 'pkv', alle)).toBe(50000);
  });

  it('beginnt jedes Kalenderjahr neu', () => {
    const { ich } = setup();
    const r1 = rechnung({ personId: ich.id, datum: '2025-12-10', betrag: 300000 });
    const r2 = rechnung({ personId: ich.id, datum: '2026-01-10', betrag: 10000 });
    expect(selbstbehalt(r2, ich, [r1, r2])).toBe(2000);
  });

  it('gilt nicht für Vorsorge und nicht für zurückgehaltene Rechnungen', () => {
    const { ich } = setup();
    const vorsorge = rechnung({ personId: ich.id, datum: '2026-01-01', betrag: 300000, vorsorge: true });
    const gehalten = rechnung({ personId: ich.id, datum: '2026-01-02', betrag: 300000, nichtEinreichen: ['pkv'] });
    const r = rechnung({ personId: ich.id, datum: '2026-02-01', betrag: 10000 });
    const alle = [vorsorge, gehalten, r];
    expect(erwartet(vorsorge, ich, 'pkv', alle)).toBe(300000);
    expect(selbstbehalt(r, ich, alle)).toBe(2000);
  });

  it('Kranken- und Pflegerechnungen teilen sich den Selbstbehalt', () => {
    const { ich } = setup();
    const pflege = rechnung({ personId: ich.id, art: 'pflege', datum: '2026-01-10', betrag: 150000 }); // SB 300 €
    const kv = rechnung({ personId: ich.id, datum: '2026-02-10', betrag: 100000 }); // SB nur noch 100 €
    const alle = [pflege, kv];
    expect(erwartet(pflege, ich, 'ppv', alle)).toBe(120000);
    expect(selbstbehalt(kv, ich, alle)).toBe(10000);
    expect(erwartet(kv, ich, 'pkv', alle)).toBe(90000);
  });

  it('Pflege ohne gemeinsamen Tarif bleibt ohne Selbstbehalt', () => {
    const { ich } = setup();
    const getrennt = { ...ich, pkv: { ...ich.pkv, mitPflege: false } };
    const pflege = rechnung({ personId: ich.id, art: 'pflege', betrag: 100000 });
    expect(erwartet(pflege, getrennt, 'ppv', [pflege])).toBe(100000);
  });

  it('gilt nicht, wenn der Tarif keinen Selbstbehalt hat', () => {
    const { oma } = setup();
    const r = rechnung({ personId: oma.id, betrag: 10000 });
    expect(selbstbehalt(r, oma, [r])).toBe(0);
  });
});

describe('Beitragsrückerstattung', () => {
  it('empfiehlt Zurückhalten, solange die Erstattung unter der BRE liegt', () => {
    const { state, ich } = setup();
    state.rechnungen.push(
      rechnung({ personId: ich.id, datum: '2026-02-01', betrag: 60000 }), // 600 € → 480 € nach SB
      rechnung({ personId: ich.id, datum: '2026-03-01', betrag: 20000, vorsorge: true }), // zählt nicht
    );
    const c = breCheck(state, ich, 2026)!;
    expect(c.rechnungen).toHaveLength(1);
    expect(c.erstattungBeiEinreichung).toBe(48000);
    expect(c.empfehlung).toBe('zurueckhalten');
    expect(c.vorteil).toBe(52000);
  });

  it('empfiehlt Einreichen, wenn die Erstattung (nach Selbstbehalt) größer ist', () => {
    const { state, ich } = setup();
    state.rechnungen.push(rechnung({ personId: ich.id, datum: '2026-02-01', betrag: 150000, nichtEinreichen: ['pkv'] }));
    const c = breCheck(state, ich, 2026)!;
    expect(c.erstattungBeiEinreichung).toBe(120000); // 1.500 € − 300 € SB (20 %)
    expect(c.empfehlung).toBe('einreichen');
    expect(c.zurueckgehalten).toHaveLength(1);
  });

  it('erkennt, dass die BRE nach einer Einreichung verloren ist', () => {
    const { state, ich } = setup();
    const r = rechnung({ personId: ich.id, datum: '2026-02-01' });
    state.rechnungen.push(r);
    expect(standardZurueckhalten(rechnung({ personId: ich.id, datum: '2026-05-01' }), ich, state)).toBe(true);
    state.einreichungen.push(einreichung({ personId: ich.id, kostentraeger: 'pkv', positionen: [{ rechnungId: r.id }] }));
    expect(breCheck(state, ich, 2026)!.eingereicht).toHaveLength(1);
    expect(standardZurueckhalten(rechnung({ personId: ich.id, datum: '2026-05-01' }), ich, state)).toBe(false);
  });

  it('berücksichtigt Pflegerechnungen bei gemeinsamem Tarif', () => {
    const { state, ich } = setup();
    state.rechnungen.push(
      rechnung({ personId: ich.id, art: 'pflege', datum: '2026-02-01', betrag: 50000 }), // 500 € − 100 € SB = 400 €
      rechnung({ personId: ich.id, datum: '2026-03-01', betrag: 80000 }), // 800 € − 160 € SB = 640 €
    );
    const c = breCheck(state, ich, 2026)!;
    expect(c.rechnungen).toHaveLength(2);
    expect(c.erstattungBeiEinreichung).toBe(104000);
    expect(c.empfehlung).toBe('einreichen');
    expect(standardZurueckhalten(rechnung({ personId: ich.id, art: 'pflege' }), ich, state)).toBe(true);
  });

  it('hält Vorsorge und Personen ohne BRE nicht zurück', () => {
    const { state, ich, oma } = setup();
    const ohneBre = { ...oma, pkv: { ...oma.pkv, breAktiv: false } };
    expect(standardZurueckhalten(rechnung({ personId: ich.id, vorsorge: true }), ich, state)).toBe(false);
    expect(standardZurueckhalten(rechnung({ personId: oma.id }), ohneBre, state)).toBe(false);
    expect(breCheck(state, ohneBre, 2026)).toBeNull();
  });

  it('Beihilfe + Versicherung: hält nur den Versicherungsanteil zurück, auch bei unbekanntem BRE-Betrag', () => {
    const { state, oma } = setup();
    expect(oma.pkv).toMatchObject({ breAktiv: true, bre: 0 });
    const r = rechnung({ personId: oma.id, betrag: 10000 });
    state.rechnungen.push(r);
    expect(standardZurueckhalten(r, oma, state)).toBe(true);
    const c = breCheck(state, oma, 2026)!;
    expect(c.empfehlung).toBe('unbekannt');
    expect(c.erstattungBeiEinreichung).toBe(3000); // 30 % Versicherung, Beihilfe zählt nicht
    const h = hinweise(state, '2026-09-29').filter((x) => x.personenSeite);
    expect(h.map((x) => x.personId)).toEqual([oma.id, state.personen[2].id]);
  });

  it('empfiehlt, sobald der BRE-Betrag bekannt ist', () => {
    const { state, oma } = setup();
    const mitBetrag = { ...oma, pkv: { ...oma.pkv, bre: 50000 } };
    state.rechnungen.push(rechnung({ personId: oma.id, betrag: 100000 }));
    const c = breCheck(state, mitBetrag, 2026)!;
    expect(c.empfehlung).toBe('zurueckhalten'); // 300 € Erstattung < 500 € BRE
    expect(c.vorteil).toBe(20000);
  });

  it('erinnert an die BRE-Entscheidung für das Vorjahr', () => {
    const { state, ich } = setup();
    state.rechnungen.push(rechnung({ personId: ich.id, datum: '2025-06-01', betrag: 200000, nichtEinreichen: ['pkv'], bezahltAm: '2025-06-02' }));
    const h = hinweise(state, '2026-01-15').filter((x) => !x.personenSeite);
    expect(h).toHaveLength(1);
    expect(h[0].text).toContain('BRE 2025: Einreichen lohnt sich');
  });
});

describe('Hinweise', () => {
  it('warnt vor ablaufender Beihilfefrist und überfälliger Zahlung', () => {
    const { state, oma } = setup();
    state.rechnungen.push(rechnung({ personId: oma.id, datum: '2025-10-15', faelligAm: '2026-09-01' }));
    const h = hinweise(state, '2026-09-29').filter((x) => !x.personenSeite);
    expect(h.map((x) => x.stufe)).toEqual(['kritisch', 'warnung']);
    expect(h[0].text).toContain('überfällig');
    expect(h[1].text).toContain('Beihilfe-Antragsfrist endet in 16');
  });

  it('keine Beihilfefrist ohne Beihilfeberechtigung', () => {
    const { state, ich } = setup();
    state.rechnungen.push(rechnung({ personId: ich.id, datum: '2025-10-15', bezahltAm: '2025-10-20', nichtEinreichen: [] }));
    expect(hinweise(state, '2026-09-29').filter((h) => h.text.includes('Beihilfe'))).toHaveLength(0);
  });

  it('erinnert an Einreichungen ohne Bescheid', () => {
    const { state, oma } = setup();
    const r = rechnung({ personId: oma.id, bezahltAm: '2026-01-01' });
    state.rechnungen.push(r);
    state.einreichungen.push(einreichung({ personId: oma.id, kostentraeger: 'beihilfe', eingereichtAm: '2026-01-01', positionen: [{ rechnungId: r.id }] }));
    expect(hinweise(state, '2026-03-01').some((h) => h.stufe === 'info')).toBe(true);
  });
});

describe('Jahreswerte', () => {
  it('summiert je Person und Jahr', () => {
    const { state, oma } = setup();
    const r1 = rechnung({ personId: oma.id, datum: '2026-02-01', betrag: 10000 });
    const r2 = rechnung({ personId: oma.id, datum: '2025-12-31', betrag: 99999 });
    state.rechnungen.push(r1, r2);
    state.einreichungen.push(einreichung({ personId: oma.id, kostentraeger: 'beihilfe', status: 'beschieden', positionen: [{ rechnungId: r1.id, erstattet: 7000 }] }));
    const w = jahreswerte(state, oma.id, 2026);
    expect(w.anzahl).toBe(1);
    expect(w.betrag).toBe(10000);
    expect(w.erstattet.beihilfe).toBe(7000);
    expect(w.ausstehend).toBe(3000);
    expect(w.eigenanteil).toBe(0);
  });
});

describe('Migration', () => {
  function v1() {
    const p = (name: string, satz: number, stelle = '') => ({
      id: name,
      name,
      farbe: '#000',
      beihilfe: { stelle, aktenzeichen: '', satzKrankheit: satz, satzPflege: satz, fristMonate: 12 },
      pkv: { name: '', nummer: '', quote: 100 - satz },
      ppv: { name: '', nummer: '', quote: 100 - satz },
      notiz: '',
    });
    return {
      version: 1,
      personen: [p('Ich', 50), p('Oma', 70), p('Opa', 70)],
      rechnungen: [{ id: 'x', personId: 'Oma', art: 'krankheit', datum: '2026-01-01', betrag: 100, nichtEinreichen: [], erwartetManuell: {}, dateiIds: [] }],
      einreichungen: [{ id: 'e', personId: 'Oma', kostentraeger: 'beihilfe', eingereichtAm: '2026-01-02', weg: 'app', referenz: '', status: 'eingereicht', positionen: [{ rechnungId: 'x' }], dateiIds: [], notiz: '' }],
      dateien: [],
    };
  }

  it('bringt Version 1 auf den aktuellen Stand', () => {
    const s = migriere(v1());
    expect(s.version).toBe(4);
    const [ich, oma, opa] = s.personen;
    expect(ich.beihilfe.berechtigt).toBe(false);
    expect(ich.pkv).toMatchObject({ quote: 100, selbstbehaltProzent: 20, selbstbehaltMax: 40000, bre: 100000, mitPflege: true });
    expect(oma.beihilfe.berechtigt).toBe(true);
    expect(oma.pkv).toMatchObject({ quote: 30, selbstbehaltProzent: 0, breAktiv: true, bre: 0, mitPflege: false });
    expect(ich.pkv.breAktiv).toBe(true);
    expect(oma.partnerId).toBe(opa.id);
    expect(opa.partnerId).toBe(oma.id);
    expect(s.rechnungen[0].vorsorge).toBe(false);
    expect(s.einreichungen[0].personIds).toEqual(['Oma']);
    expect('personId' in s.einreichungen[0]).toBe(false);
  });

  it('lässt angepasste Daten unverändert', () => {
    const alt = v1();
    alt.personen[0].beihilfe.stelle = 'Bundesverwaltungsamt';
    alt.personen[1].pkv.name = 'Andere Versicherung';
    const s = migriere(alt);
    expect(s.personen[0].beihilfe.berechtigt).toBe(true);
    expect(s.personen[0].pkv.tarif).toBe('');
    expect(s.personen[1].pkv.name).toBe('Andere Versicherung');
  });

  it('übernimmt Version 2 mit angepasstem „Ich“', () => {
    const v2 = migriere(v1()) as unknown as Record<string, unknown>;
    // Stand wie nach dem letzten Update: v2 ohne Tarif/Partner, Einreichungen mit personId
    const alt = JSON.parse(JSON.stringify(v2));
    alt.version = 2;
    for (const p of alt.personen) { delete p.pkv.tarif; delete p.pkv.mitPflege; delete p.pkv.breAktiv; delete p.ppv.tarif; delete p.partnerId; p.pkv.name = ''; }
    for (const e of alt.einreichungen) { e.personId = e.personIds[0]; delete e.personIds; }
    const s = migriere(alt);
    expect(s.personen[0].pkv.mitPflege).toBe(true);
    expect(s.personen[0].pkv.breAktiv).toBe(true);
    expect(s.personen[1].partnerId).toBe(s.personen[2].id);
    expect(s.einreichungen[0].personIds).toEqual(['Oma']);
  });

  it('Startdaten verknüpfen Oma und Opa', () => {
    const { oma, opa } = setup();
    expect(oma.partnerId).toBe(opa.id);
    expect(opa.partnerId).toBe(oma.id);
  });
});

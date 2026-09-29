import { describe, expect, it } from 'vitest';
import { startState } from './beispiel';
import { einreichbareRechnungen, erwartet, hinweise, jahreswerte, rechnungUebersicht, traegerInfo } from './calc';
import { parseEuro, plusMonate, tageZwischen } from './format';
import type { AppState, Einreichung, Rechnung } from './types';

function rechnung(teil: Partial<Rechnung> & { personId: string }): Rechnung {
  return {
    id: Math.random().toString(36).slice(2),
    art: 'krankheit',
    datum: '2026-03-01',
    leistungserbringer: 'Dr. Müller',
    rechnungsnummer: '',
    beschreibung: '',
    betrag: 10000,
    nichtEinreichen: [],
    erwartetManuell: {},
    dateiIds: [],
    notiz: '',
    ...teil,
  };
}

function einreichung(teil: Partial<Einreichung> & Pick<Einreichung, 'personId' | 'kostentraeger' | 'positionen'>): Einreichung {
  return { id: Math.random().toString(36).slice(2), eingereichtAm: '2026-03-10', weg: 'app', referenz: '', status: 'eingereicht', dateiIds: [], notiz: '', ...teil };
}

function setup(): { state: AppState; ich: string; oma: string } {
  const state = startState();
  return { state, ich: state.personen[0].id, oma: state.personen[1].id };
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

describe('Erstattung', () => {
  it('berechnet erwartete Erstattung aus den Sätzen der Person', () => {
    const { state, oma } = setup();
    const person = state.personen.find((p) => p.id === oma)!;
    const r = rechnung({ personId: oma, betrag: 12345 });
    expect(erwartet(r, person, 'beihilfe')).toBe(8642); // 70 %
    expect(erwartet(r, person, 'pkv')).toBe(3704); // 30 %
    expect(erwartet({ ...r, erwartetManuell: { pkv: 1000 } }, person, 'pkv')).toBe(1000);
  });

  it('verfolgt den Status über Einreichung und Bescheid', () => {
    const { state, ich } = setup();
    const person = state.personen[0];
    const r = rechnung({ personId: ich, betrag: 20000 });
    expect(traegerInfo(r, person, 'beihilfe', []).status).toBe('offen');

    const e = einreichung({ personId: ich, kostentraeger: 'beihilfe', positionen: [{ rechnungId: r.id }] });
    expect(traegerInfo(r, person, 'beihilfe', [e]).status).toBe('eingereicht');
    expect(traegerInfo(r, person, 'pkv', [e]).status).toBe('offen');

    const beschieden = { ...e, status: 'beschieden' as const, positionen: [{ rechnungId: r.id, erstattet: 9000 }] };
    const u = rechnungUebersicht(r, person, [beschieden]);
    expect(u.erstattet).toBe(9000);
    expect(u.ausstehend).toBe(10000); // PKV 50 % noch offen
    expect(u.eigenanteil).toBe(1000);
    expect(u.abgeschlossen).toBe(false);
  });

  it('behandelt 0 € als abgelehnt und erlaubt erneute Einreichung', () => {
    const { state, ich } = setup();
    const r = rechnung({ personId: ich });
    state.rechnungen.push(r);
    state.einreichungen.push(
      einreichung({ personId: ich, kostentraeger: 'pkv', status: 'beschieden', positionen: [{ rechnungId: r.id, erstattet: 0 }] }),
    );
    expect(traegerInfo(r, state.personen[0], 'pkv', state.einreichungen).status).toBe('abgelehnt');
    expect(einreichbareRechnungen(state, ich, 'pkv').map((x) => x.id)).toEqual([r.id]);
  });

  it('Pflegerechnungen gehen an Beihilfe und PPV, nicht an PKV', () => {
    const { state, oma } = setup();
    const r = rechnung({ personId: oma, art: 'pflege' });
    state.rechnungen.push(r);
    expect(einreichbareRechnungen(state, oma, 'ppv')).toHaveLength(1);
    expect(einreichbareRechnungen(state, oma, 'pkv')).toHaveLength(0);
  });

  it('bewusst nicht eingereichte Positionen zählen zum Eigenanteil', () => {
    const { state, ich } = setup();
    const r = rechnung({ personId: ich, betrag: 5000, nichtEinreichen: ['pkv'] });
    const u = rechnungUebersicht(r, state.personen[0], []);
    expect(u.ausstehend).toBe(2500);
    expect(u.eigenanteil).toBe(2500);
  });
});

describe('Hinweise', () => {
  it('warnt vor ablaufender Beihilfefrist und überfälliger Zahlung', () => {
    const { state, ich } = setup();
    state.rechnungen.push(rechnung({ personId: ich, datum: '2025-10-15', faelligAm: '2026-09-01' }));
    const h = hinweise(state, '2026-09-29');
    expect(h.map((x) => x.stufe)).toEqual(['kritisch', 'warnung']);
    expect(h[0].text).toContain('überfällig');
    expect(h[1].text).toContain('Beihilfe-Antragsfrist endet in 16');
  });

  it('erinnert an Einreichungen ohne Bescheid', () => {
    const { state, ich } = setup();
    const r = rechnung({ personId: ich, bezahltAm: '2026-01-01' });
    state.rechnungen.push(r);
    state.einreichungen.push(einreichung({ personId: ich, kostentraeger: 'beihilfe', eingereichtAm: '2026-01-01', positionen: [{ rechnungId: r.id }] }));
    expect(hinweise(state, '2026-03-01').some((h) => h.stufe === 'info')).toBe(true);
  });
});

describe('Jahreswerte', () => {
  it('summiert je Person und Jahr', () => {
    const { state, oma } = setup();
    const r1 = rechnung({ personId: oma, datum: '2026-02-01', betrag: 10000 });
    const r2 = rechnung({ personId: oma, datum: '2025-12-31', betrag: 99999 });
    state.rechnungen.push(r1, r2);
    state.einreichungen.push(
      einreichung({ personId: oma, kostentraeger: 'beihilfe', status: 'beschieden', positionen: [{ rechnungId: r1.id, erstattet: 7000 }] }),
    );
    const w = jahreswerte(state, oma, 2026);
    expect(w.anzahl).toBe(1);
    expect(w.betrag).toBe(10000);
    expect(w.erstattet.beihilfe).toBe(7000);
    expect(w.ausstehend).toBe(3000);
    expect(w.eigenanteil).toBe(0);
  });
});

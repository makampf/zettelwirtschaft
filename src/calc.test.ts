import { describe, expect, it } from 'vitest';
import { startState } from './defaults';
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
import { ktKurz, ktName, type AppState, type Person, type Submission, type Invoice } from './types';

let zaehler = 0;
function rechnung(teil: Partial<Invoice> & { personId: string }): Invoice {
  return {
    id: `r${String(++zaehler).padStart(3, '0')}`,
    kind: 'illness',
    date: '2026-03-01',
    provider: 'Dr. Müller',
    invoiceNumber: '',
    description: '',
    amount: 10000,
    preventive: false,
    heldBack: [],
    expectedOverride: {},
    fileIds: [],
    note: '',
    ...teil,
  };
}

function einreichung(teil: Partial<Submission> & { personId: string } & Pick<Submission, 'payer' | 'items'>): Submission {
  const { personId, ...rest } = teil;
  return { id: Math.random().toString(36).slice(2), personIds: [personId], submittedDate: '2026-03-10', channel: 'app', reference: '', status: 'submitted', fileIds: [], note: '', ...rest };
}

/** Standarddaten: „Ich“ ohne Beihilfe (100 % PKV/PPV, 20 % SB bis 400 € für KV + PV, BRE 1.000 €), Oma/Opa mit 70 % Beihilfe und BRE. */
function setup() {
  const state: AppState = startState();
  const [ich, oma, opa] = state.people;
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
  it('gemeinsamer Vertrag: Kranken- und Pflegerechnungen gehen an die PKV', () => {
    const { ich, oma } = setup();
    expect(traegerFuer('illness', ich)).toEqual(['pkv']);
    expect(traegerFuer('care', ich)).toEqual(['pkv']);
    expect(traegerFuer('illness', oma)).toEqual(['beihilfe', 'pkv']);
    expect(traegerFuer('care', oma)).toEqual(['beihilfe', 'pkv']);
    expect(ktName('pkv', ich)).toBe('Private Kranken- und Pflegeversicherung');
    expect(ktKurz('pkv', ich)).toBe('PKV/PPV');
  });

  it('getrennte Pflegeversicherung: Pflegerechnungen gehen an die PPV', () => {
    const { ich, oma } = setup();
    const getrennt = (p: Person) => ({ ...p, pkv: { ...p.pkv, includesCare: false } });
    expect(traegerFuer('care', getrennt(ich))).toEqual(['ppv']);
    expect(traegerFuer('care', getrennt(oma))).toEqual(['beihilfe', 'ppv']);
    expect(ktName('pkv', getrennt(ich))).toBe('Private Krankenversicherung');
  });
});

describe('Erstattung mit Beihilfe', () => {
  it('berechnet erwartete Erstattung aus den Sätzen der Person', () => {
    const { oma } = setup();
    const r = rechnung({ personId: oma.id, amount: 12345 });
    expect(erwartet(r, oma, 'beihilfe', [r])).toBe(8642); // 70 %
    expect(erwartet(r, oma, 'pkv', [r])).toBe(3704); // 30 %
    expect(erwartet({ ...r, expectedOverride: { pkv: 1000 } }, oma, 'pkv', [r])).toBe(1000);
  });

  it('verfolgt den Status über Einreichung und Bescheid', () => {
    const { state, oma } = setup();
    const r = rechnung({ personId: oma.id, amount: 20000 });
    state.invoices.push(r);
    expect(traegerInfo(r, oma, 'beihilfe', state).status).toBe('offen');

    const e = einreichung({ personId: oma.id, payer: 'beihilfe', items: [{ invoiceId: r.id }] });
    state.submissions.push(e);
    expect(traegerInfo(r, oma, 'beihilfe', state).status).toBe('eingereicht');
    expect(traegerInfo(r, oma, 'pkv', state).status).toBe('offen');

    state.submissions[0] = { ...e, status: 'decided', items: [{ invoiceId: r.id, reimbursed: 13000 }] };
    const u = rechnungUebersicht(r, oma, state);
    expect(u.erstattet).toBe(13000);
    expect(u.ausstehend).toBe(6000); // PKV 30 % noch offen
    expect(u.eigenanteil).toBe(1000);
    expect(u.abgeschlossen).toBe(false);
  });

  it('behandelt 0 € als abgelehnt und erlaubt erneute Einreichung', () => {
    const { state, oma } = setup();
    const r = rechnung({ personId: oma.id });
    state.invoices.push(r);
    state.submissions.push(einreichung({ personId: oma.id, payer: 'pkv', status: 'decided', items: [{ invoiceId: r.id, reimbursed: 0 }] }));
    expect(traegerInfo(r, oma, 'pkv', state).status).toBe('abgelehnt');
    expect(einreichbareRechnungen(state, oma.id, 'pkv').map((x) => x.id)).toEqual([r.id]);
  });

  it('Pflegerechnungen gehen bei getrennter PPV an Beihilfe und PPV, nicht an PKV', () => {
    const { state, oma } = setup();
    state.people[1] = { ...oma, pkv: { ...oma.pkv, includesCare: false } };
    state.invoices.push(rechnung({ personId: oma.id, kind: 'care' }));
    expect(einreichbareRechnungen(state, oma.id, 'ppv')).toHaveLength(1);
    expect(einreichbareRechnungen(state, oma.id, 'pkv')).toHaveLength(0);
  });

  it('gemeinsamer Vertrag: Pflegerechnung mit PKV einreichen, Quote Pflege, Auswertung als PPV', () => {
    const { state, oma } = setup();
    const krank = rechnung({ personId: oma.id, amount: 10000 });
    const pflege = rechnung({ personId: oma.id, kind: 'care', amount: 20000 });
    state.invoices.push(krank, pflege);
    state.people[1] = oma;
    oma.ppv.rate = 50;
    expect(einreichbareRechnungen(state, oma.id, 'pkv')).toHaveLength(2);
    expect(einreichbareRechnungen(state, oma.id, 'ppv')).toHaveLength(0);
    expect(erwartet(pflege, oma, 'pkv', state.invoices)).toBe(10000); // 50 % Pflege statt 30 %
    state.submissions.push(
      einreichung({ personId: oma.id, payer: 'pkv', status: 'decided', items: [{ invoiceId: krank.id, reimbursed: 3000 }, { invoiceId: pflege.id, reimbursed: 10000 }] }),
    );
    const w = jahreswerte(state, oma.id, 2026);
    expect(w.erstattet).toEqual({ beihilfe: 0, pkv: 3000, ppv: 10000 });
  });

  it('zurückgehaltene Positionen zählen zum Eigenanteil', () => {
    const { oma } = setup();
    const r = rechnung({ personId: oma.id, amount: 5000, heldBack: ['pkv'] });
    const u = rechnungUebersicht(r, oma, { invoices: [r], submissions: [] });
    expect(u.ausstehend).toBe(3500);
    expect(u.eigenanteil).toBe(1500);
  });
});

describe('Selbstbehalt', () => {
  it('zieht 20 % ab, bis 400 € im Jahr erreicht sind', () => {
    const { ich } = setup();
    const r1 = rechnung({ personId: ich.id, date: '2026-01-10', amount: 100000 }); // SB 200 €
    const r2 = rechnung({ personId: ich.id, date: '2026-02-10', amount: 150000 }); // SB 200 € (Rest, statt 300 €)
    const r3 = rechnung({ personId: ich.id, date: '2026-03-10', amount: 50000 }); // SB 0 €
    const alle = [r3, r1, r2];
    expect(selbstbehalt(r1, ich, alle)).toBe(20000);
    expect(selbstbehalt(r2, ich, alle)).toBe(20000);
    expect(selbstbehalt(r3, ich, alle)).toBe(0);
    expect(erwartet(r2, ich, 'pkv', alle)).toBe(130000);
    expect(erwartet(r3, ich, 'pkv', alle)).toBe(50000);
  });

  it('beginnt jedes Kalenderjahr neu', () => {
    const { ich } = setup();
    const r1 = rechnung({ personId: ich.id, date: '2025-12-10', amount: 300000 });
    const r2 = rechnung({ personId: ich.id, date: '2026-01-10', amount: 10000 });
    expect(selbstbehalt(r2, ich, [r1, r2])).toBe(2000);
  });

  it('gilt nicht für Vorsorge und nicht für zurückgehaltene Rechnungen', () => {
    const { ich } = setup();
    const vorsorge = rechnung({ personId: ich.id, date: '2026-01-01', amount: 300000, preventive: true });
    const gehalten = rechnung({ personId: ich.id, date: '2026-01-02', amount: 300000, heldBack: ['pkv'] });
    const r = rechnung({ personId: ich.id, date: '2026-02-01', amount: 10000 });
    const alle = [vorsorge, gehalten, r];
    expect(erwartet(vorsorge, ich, 'pkv', alle)).toBe(300000);
    expect(selbstbehalt(r, ich, alle)).toBe(2000);
  });

  it('Kranken- und Pflegerechnungen teilen sich den Selbstbehalt', () => {
    const { ich } = setup();
    const pflege = rechnung({ personId: ich.id, kind: 'care', date: '2026-01-10', amount: 150000 }); // SB 300 €
    const kv = rechnung({ personId: ich.id, date: '2026-02-10', amount: 100000 }); // SB nur noch 100 €
    const alle = [pflege, kv];
    expect(erwartet(pflege, ich, 'pkv', alle)).toBe(120000);
    expect(selbstbehalt(kv, ich, alle)).toBe(10000);
    expect(erwartet(kv, ich, 'pkv', alle)).toBe(90000);
  });

  it('Pflege ohne gemeinsamen Tarif bleibt ohne Selbstbehalt', () => {
    const { ich } = setup();
    const getrennt = { ...ich, pkv: { ...ich.pkv, includesCare: false } };
    const pflege = rechnung({ personId: ich.id, kind: 'care', amount: 100000 });
    expect(erwartet(pflege, getrennt, 'ppv', [pflege])).toBe(100000);
  });

  it('gilt nicht, wenn der Tarif keinen Selbstbehalt hat', () => {
    const { oma } = setup();
    const r = rechnung({ personId: oma.id, amount: 10000 });
    expect(selbstbehalt(r, oma, [r])).toBe(0);
  });
});

describe('Beitragsrückerstattung', () => {
  it('empfiehlt Zurückhalten, solange die Erstattung unter der BRE liegt', () => {
    const { state, ich } = setup();
    state.invoices.push(
      rechnung({ personId: ich.id, date: '2026-02-01', amount: 60000 }), // 600 € → 480 € nach SB
      rechnung({ personId: ich.id, date: '2026-03-01', amount: 20000, preventive: true }), // zählt nicht
    );
    const c = breCheck(state, ich, 2026)!;
    expect(c.rechnungen).toHaveLength(1);
    expect(c.erstattungBeiEinreichung).toBe(48000);
    expect(c.empfehlung).toBe('zurueckhalten');
    expect(c.vorteil).toBe(52000);
  });

  it('empfiehlt Einreichen, wenn die Erstattung (nach Selbstbehalt) größer ist', () => {
    const { state, ich } = setup();
    state.invoices.push(rechnung({ personId: ich.id, date: '2026-02-01', amount: 150000, heldBack: ['pkv'] }));
    const c = breCheck(state, ich, 2026)!;
    expect(c.erstattungBeiEinreichung).toBe(120000); // 1.500 € − 300 € SB (20 %)
    expect(c.empfehlung).toBe('einreichen');
    expect(c.zurueckgehalten).toHaveLength(1);
  });

  it('erkennt, dass die BRE nach einer Einreichung verloren ist', () => {
    const { state, ich } = setup();
    const r = rechnung({ personId: ich.id, date: '2026-02-01' });
    state.invoices.push(r);
    expect(standardZurueckhalten(rechnung({ personId: ich.id, date: '2026-05-01' }), ich, state)).toBe(true);
    state.submissions.push(einreichung({ personId: ich.id, payer: 'pkv', items: [{ invoiceId: r.id }] }));
    expect(breCheck(state, ich, 2026)!.eingereicht).toHaveLength(1);
    expect(standardZurueckhalten(rechnung({ personId: ich.id, date: '2026-05-01' }), ich, state)).toBe(false);
  });

  it('berücksichtigt Pflegerechnungen bei gemeinsamem Tarif', () => {
    const { state, ich } = setup();
    state.invoices.push(
      rechnung({ personId: ich.id, kind: 'care', date: '2026-02-01', amount: 50000 }), // 500 € − 100 € SB = 400 €
      rechnung({ personId: ich.id, date: '2026-03-01', amount: 80000 }), // 800 € − 160 € SB = 640 €
    );
    const c = breCheck(state, ich, 2026)!;
    expect(c.rechnungen).toHaveLength(2);
    expect(c.erstattungBeiEinreichung).toBe(104000);
    expect(c.empfehlung).toBe('einreichen');
    expect(standardZurueckhalten(rechnung({ personId: ich.id, kind: 'care' }), ich, state)).toBe(true);
  });

  it('hält Vorsorge und Personen ohne BRE nicht zurück', () => {
    const { state, ich, oma } = setup();
    const ohneBre = { ...oma, pkv: { ...oma.pkv, premiumRefundEnabled: false } };
    expect(standardZurueckhalten(rechnung({ personId: ich.id, preventive: true }), ich, state)).toBe(false);
    expect(standardZurueckhalten(rechnung({ personId: oma.id }), ohneBre, state)).toBe(false);
    expect(breCheck(state, ohneBre, 2026)).toBeNull();
  });

  it('Beihilfe + Versicherung: hält nur den Versicherungsanteil zurück, auch bei unbekanntem BRE-Betrag', () => {
    const { state, oma } = setup();
    expect(oma.pkv).toMatchObject({ premiumRefundEnabled: true, premiumRefund: 0 });
    const r = rechnung({ personId: oma.id, amount: 10000 });
    state.invoices.push(r);
    expect(standardZurueckhalten(r, oma, state)).toBe(true);
    const c = breCheck(state, oma, 2026)!;
    expect(c.empfehlung).toBe('unbekannt');
    expect(c.erstattungBeiEinreichung).toBe(3000); // 30 % Versicherung, Beihilfe zählt nicht
    const h = hinweise(state, '2026-09-29').filter((x) => x.personenSeite);
    expect(h.map((x) => x.personId)).toEqual([oma.id, state.people[2].id]);
  });

  it('empfiehlt, sobald der BRE-Betrag bekannt ist', () => {
    const { state, oma } = setup();
    const mitBetrag = { ...oma, pkv: { ...oma.pkv, premiumRefund: 50000 } };
    state.invoices.push(rechnung({ personId: oma.id, amount: 100000 }));
    const c = breCheck(state, mitBetrag, 2026)!;
    expect(c.empfehlung).toBe('zurueckhalten'); // 300 € Erstattung < 500 € BRE
    expect(c.vorteil).toBe(20000);
  });

  it('erinnert an die BRE-Entscheidung für das Vorjahr', () => {
    const { state, ich } = setup();
    state.invoices.push(rechnung({ personId: ich.id, date: '2025-06-01', amount: 200000, heldBack: ['pkv'], paidDate: '2025-06-02' }));
    const h = hinweise(state, '2026-01-15').filter((x) => !x.personenSeite);
    expect(h).toHaveLength(1);
    expect(h[0].text).toContain('BRE 2025: Einreichen lohnt sich');
  });
});

describe('Hinweise', () => {
  it('warnt vor ablaufender Beihilfefrist und überfälliger Zahlung', () => {
    const { state, oma } = setup();
    state.invoices.push(rechnung({ personId: oma.id, date: '2025-10-15', dueDate: '2026-09-01' }));
    const h = hinweise(state, '2026-09-29').filter((x) => !x.personenSeite);
    expect(h.map((x) => x.stufe)).toEqual(['kritisch', 'warnung']);
    expect(h[0].text).toContain('überfällig');
    expect(h[1].text).toContain('Beihilfe-Antragsfrist endet in 16');
  });

  it('keine Beihilfefrist ohne Beihilfeberechtigung', () => {
    const { state, ich } = setup();
    state.invoices.push(rechnung({ personId: ich.id, date: '2025-10-15', paidDate: '2025-10-20', heldBack: [] }));
    expect(hinweise(state, '2026-09-29').filter((h) => h.text.includes('Beihilfe'))).toHaveLength(0);
  });

  it('erinnert an Einreichungen ohne Bescheid', () => {
    const { state, oma } = setup();
    const r = rechnung({ personId: oma.id, paidDate: '2026-01-01' });
    state.invoices.push(r);
    state.submissions.push(einreichung({ personId: oma.id, payer: 'beihilfe', submittedDate: '2026-01-01', items: [{ invoiceId: r.id }] }));
    expect(hinweise(state, '2026-03-01').some((h) => h.stufe === 'info')).toBe(true);
  });
});

describe('Jahreswerte', () => {
  it('summiert je Person und Jahr', () => {
    const { state, oma } = setup();
    const r1 = rechnung({ personId: oma.id, date: '2026-02-01', amount: 10000 });
    const r2 = rechnung({ personId: oma.id, date: '2025-12-31', amount: 99999 });
    state.invoices.push(r1, r2);
    state.submissions.push(einreichung({ personId: oma.id, payer: 'beihilfe', status: 'decided', items: [{ invoiceId: r1.id, reimbursed: 7000 }] }));
    const w = jahreswerte(state, oma.id, 2026);
    expect(w.anzahl).toBe(1);
    expect(w.betrag).toBe(10000);
    expect(w.erstattet.beihilfe).toBe(7000);
    expect(w.ausstehend).toBe(3000);
    expect(w.eigenanteil).toBe(0);
  });
});

describe('Migration', () => {
  it('übernimmt Daten der aktuellen Version', () => {
    const s = startState();
    expect(migriere(s)).toBe(s);
  });

  it('lehnt unbekannte Versionen ab', () => {
    expect(() => migriere({ ...startState(), version: 99 })).toThrow('Unbekannte Datenversion 99');
  });

  it('Startdaten verknüpfen Oma und Opa', () => {
    const { oma, opa } = setup();
    expect(oma.partnerId).toBe(opa.id);
    expect(opa.partnerId).toBe(oma.id);
  });
});

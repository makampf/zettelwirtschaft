import { describe, expect, it } from 'vitest';
import { neuePerson } from './defaults';
import { abrechnungAutomatisch, belegArt, rechnungAusText } from './eingang';
import type { AppState, Invoice, Submission } from './types';

// Frei erfundene Belege und Personen
const ich = { ...neuePerson('Ich', '#000', null), id: 'ich', invoiceNames: 'Max Mustermann' };
const oma = { ...neuePerson('Oma', '#111', 70), id: 'oma', invoiceNames: 'Erika Mustermann' };

const RECHNUNG = `
Dr. med. Beispiel · Musterweg 9 · 90000 Musterstadt
Frau
Erika Mustermann
Musterweg 1
90000 Musterstadt
Privatliquidation                       Rechnungsdatum: 14.09.2026
Rechnungs-Nr.: 2026-4711
Datum        GOÄ   Leistung              Faktor   Betrag
02.09.2026   1     Beratung              2,3      10,72 €
                                  Rechnungsbetrag 10,72 €
`;

const ABRECHNUNG = `
Muster Krankenversicherung AG · 90000 Musterstadt
Leistungsabrechnung vom 25.09.2026
Tarif B30
Beleg vom 21.07.2026   400,00   120,00
Beleg vom 15.07.2026   60,00   18,00
Beleg vom 14.07.2026   1.500,00   noch offen
Auszahlungsbetrag: 138,00 €
`;

function rechnung(id: string, date: string, amount: number, personId = 'oma'): Invoice {
  return { id, personId, kind: 'illness', date, provider: 'Dr. Beispiel', invoiceNumber: '', description: '', amount, preventive: false, heldBack: [], expectedOverride: {}, fileIds: [], note: '' };
}

function einreichung(id: string, payer: Submission['payer'], invoiceIds: string[]): Submission {
  return { id, personIds: ['oma'], payer, submittedDate: '2026-08-01', channel: 'app', reference: '', status: 'submitted', items: invoiceIds.map((invoiceId) => ({ invoiceId })), fileIds: [], note: '' };
}

/** Grund ohne geschützte Leerzeichen (Eurobeträge). */
const grund = (e: object) => ('grund' in e ? String(e.grund).replace(/\u00a0/g, ' ') : undefined);

const zustand = (invoices: Invoice[] = [], submissions: Submission[] = []): AppState => ({ version: 1, people: [ich, oma], invoices, submissions, files: [] });

describe('Eingang', () => {
  it('unterscheidet Rechnung und Abrechnung – Angabe des Absenders vor Dokumenttyp vor Text', () => {
    expect(belegArt(RECHNUNG)).toBe('invoice');
    expect(belegArt(ABRECHNUNG)).toBe('statement');
    expect(belegArt('Beihilfebescheid vom 01.10.2026')).toBe('statement');
    expect(belegArt(ABRECHNUNG, { kind: 'invoice' })).toBe('invoice');
    expect(belegArt(RECHNUNG, { kind: 'Abrechnung' })).toBe('statement');
    expect(belegArt(RECHNUNG, { document_type: 'Leistungsabrechnung' })).toBe('statement');
    expect(belegArt(ABRECHNUNG, { document_type: 'Arztrechnung' })).toBe('invoice');
    // Eine Abrechnungsstelle stellt Rechnungen aus
    expect(belegArt(RECHNUNG, { title: 'Privatärztliche Abrechnungsstelle' })).toBe('invoice');
  });

  it('legt eine vollständig erkannte Rechnung an, markiert zur Prüfung', () => {
    const e = rechnungAusText(RECHNUNG, { doc_url: 'https://paperless.example/documents/7/' }, zustand());
    expect('ok' in e && e.ok).toMatchObject({
      personId: 'oma',
      date: '2026-09-14',
      amount: 1072,
      invoiceNumber: '2026-4711',
      toReview: true,
      fileIds: [],
      note: 'Aus Paperless: https://paperless.example/documents/7/',
    });
  });

  it('nimmt den Korrespondenten als Leistungserbringer, wenn keiner erkannt wird', () => {
    const text = 'Erika Mustermann\nRechnung vom 03.08.2026\nGesamtbetrag 25,00 €';
    expect(rechnungAusText(text, {}, zustand())).toEqual({ grund: 'Nicht erkannt: Leistungserbringer' });
    const e = rechnungAusText(text, { correspondent: 'Sanitätshaus Muster' }, zustand());
    expect('ok' in e && e.ok.provider).toBe('Sanitätshaus Muster');
  });

  it('lässt unvollständige oder doppelte Rechnungen im Eingang', () => {
    expect(rechnungAusText('Irgendein Schreiben ohne Angaben', {}, zustand())).toEqual({
      grund: 'Nicht erkannt: Betrag, Rechnungsdatum, Person, Leistungserbringer',
    });
    const vorhanden = rechnung('r0', '2026-09-14', 1072);
    expect(grund(rechnungAusText(RECHNUNG, {}, zustand([vorhanden])))).toBe('Möglicherweise schon erfasst: Dr. Beispiel vom 14.09.2026 über 10,72 €');
  });

  it('überträgt eine eindeutige Abrechnung auf die Einreichung der Versicherung, nicht auf die der Beihilfe', () => {
    const rs = [rechnung('a', '2026-07-21', 40000), rechnung('b', '2026-07-15', 6000), rechnung('c', '2026-07-14', 150000)];
    const beihilfe = einreichung('e-bh', 'beihilfe', ['a', 'b', 'c']);
    const pkv = einreichung('e-pkv', 'pkv', ['a', 'b', 'c']);
    const e = abrechnungAutomatisch(ABRECHNUNG, zustand(rs, [beihilfe, pkv]), 'datei1');
    expect('ok' in e).toBe(true);
    if (!('ok' in e)) return;
    expect(e.ok).toHaveLength(1);
    expect(e.ok[0]).toMatchObject({ id: 'e-pkv', status: 'decided', decisionDate: '2026-09-25', fileIds: ['datei1'], toReview: true });
    expect(e.ok[0].items).toEqual([
      { invoiceId: 'a', reimbursed: 12000, decisionDate: '2026-09-25', fileId: 'datei1' },
      { invoiceId: 'b', reimbursed: 1800, decisionDate: '2026-09-25', fileId: 'datei1' },
      { invoiceId: 'c', pending: true, reimbursed: undefined, decisionDate: undefined, fileId: undefined },
    ]);
  });

  it('verteilt eine Abrechnung auf mehrere Einreichungen', () => {
    const rs = [rechnung('a', '2026-07-21', 40000), rechnung('b', '2026-07-15', 6000), rechnung('c', '2026-07-14', 150000)];
    const e = abrechnungAutomatisch(ABRECHNUNG, zustand(rs, [einreichung('e1', 'pkv', ['a']), einreichung('e2', 'pkv', ['b', 'c'])]), 'd');
    expect('ok' in e && e.ok.map((x) => [x.id, x.items.map((p) => p.reimbursed ?? (p.pending ? 'offen' : '–'))])).toEqual([
      ['e2', [1800, 'offen']],
      ['e1', [12000]],
    ]);
  });

  it('überlässt unklare Abrechnungen der Prüfung von Hand', () => {
    const rs = [rechnung('a', '2026-07-21', 40000), rechnung('b', '2026-07-15', 6000)];
    // Summe passt nicht (eine Position fehlt in den Einreichungen)
    expect(grund(abrechnungAutomatisch(ABRECHNUNG, zustand(rs, [einreichung('e', 'pkv', ['a'])]), 'd'))).toBe(
      'Gesamtsumme laut Abrechnung 138,00 €, zugeordnet 120,00 € – bitte prüfen',
    );
    // Stelle nicht erkennbar
    expect(abrechnungAutomatisch('Schreiben vom 25.09.2026\nBeleg vom 21.07.2026 400,00 120,00', zustand(rs, [einreichung('e', 'pkv', ['a'])]), 'd')).toMatchObject({
      grund: expect.stringContaining('Beihilfe oder der Versicherung'),
    });
    // Datum weicht ab → nur über den Betrag zuordenbar
    const spaeter = [rechnung('a', '2026-07-01', 40000), rechnung('b', '2026-07-15', 6000)];
    expect(abrechnungAutomatisch(ABRECHNUNG, zustand(spaeter, [einreichung('e', 'pkv', ['a', 'b'])]), 'd')).toMatchObject({
      grund: expect.stringContaining('nur über den Betrag'),
    });
    // Keine passende Einreichung
    expect(abrechnungAutomatisch(ABRECHNUNG, zustand(rs, []), 'd')).toMatchObject({ grund: expect.stringContaining('Keine Einreichung') });
  });
});

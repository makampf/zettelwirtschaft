import { describe, expect, it } from 'vitest';
import type { Invoice } from '../types';
import { abrechnungAuslesen, abrechnungZuordnen, positionenAusAbrechnung } from './statement';

// Frei erfundene Abrechnungen
const VERSICHERUNG = `
Muster Krankenversicherung AG · 90000 Musterstadt
Herrn
Hans Mustermann
c/o Max Mustermann
Musterweg 1
90000 Musterstadt
Versicherungsnummer: KV-0000-0000
Leistungsabrechnung vom 25.09.2026
Rechnung/Beleg   Rechnungsbetrag   Erstattungsfähig   Satz   Auszahlung
Erika Mustermann geb. 01.02.1941
Arztrechnung
Beleg vom 21.07.2026   400,00   120,00
ambulante Behandlung   400,00   400,00   30   120,00
Laborrechnung
Beleg vom 15.07.2026   60,00   18,00
Krankenhausrechnung
Beleg vom 14.07.2026   1.500,00   noch offen
Summe der Positionen   138,00 €
Auszahlungsbetrag: 138,00 € · IBAN DE00 0000 0000 0000 0000 00
`;

const BEIHILFE = `
Landesamt für Musterverwaltung – Beihilfestelle
Beihilfebescheid vom 30.09.2026
Nr.  Rechnungsdatum  Leistungserbringer  Betrag  beihilfefähig  Satz  Beihilfe
1    21.07.2026      Dr. Beispiel         400,00  400,00         70    280,00
2    15.07.2026      Labor Muster          60,00   50,00         70     35,00
Beihilfebetrag insgesamt: 315,00 €
`;

let n = 0;
const rechnung = (date: string, amount: number): Invoice =>
  ({ id: `r${++n}`, date, amount }) as Invoice;

describe('Leistungsabrechnung', () => {
  it('liest Datum, Gesamtsumme und Positionen einer Versicherungsabrechnung', () => {
    const a = abrechnungAuslesen(VERSICHERUNG);
    expect(a.date).toBe('2026-09-25');
    expect(a.total).toBe(13800);
    expect(a.zeilen.map((z) => [z.date, z.amounts, z.pending])).toEqual([
      ['2026-07-21', [40000, 12000], false],
      ['2026-07-15', [6000, 1800], false],
      ['2026-07-14', [150000], true],
    ]);
  });

  it('ordnet Positionen über Datum und Betrag zu, „noch offen“ bleibt ohne Erstattung', () => {
    const arzt = rechnung('2026-07-21', 40000);
    const labor = rechnung('2026-07-15', 6000);
    const klinik = rechnung('2026-07-14', 150000);
    const fremd = rechnung('2026-07-21', 9900);
    const { zuordnungen, offen } = abrechnungZuordnen(abrechnungAuslesen(VERSICHERUNG), [fremd, arzt, labor, klinik]);
    expect(offen).toEqual([]);
    expect(zuordnungen.map((z) => [z.invoiceId, z.reimbursed, z.pending])).toEqual([
      [arzt.id, 12000, false],
      [labor.id, 1800, false],
      [klinik.id, undefined, true],
    ]);
    const items = positionenAusAbrechnung([{ invoiceId: arzt.id }, { invoiceId: klinik.id, reimbursed: 5 }, { invoiceId: fremd.id }], zuordnungen);
    expect(items).toEqual([{ invoiceId: arzt.id, reimbursed: 12000 }, { invoiceId: klinik.id, pending: true, reimbursed: undefined }, { invoiceId: fremd.id }]);
  });

  it('liest einen Beihilfebescheid mit Tabellenzeilen', () => {
    const a = abrechnungAuslesen(BEIHILFE);
    expect(a).toMatchObject({ date: '2026-09-30', total: 31500, payer: 'beihilfe' });
    const arzt = rechnung('2026-07-21', 40000);
    const labor = rechnung('2026-07-15', 6000);
    const { zuordnungen } = abrechnungZuordnen(a, [arzt, labor]);
    expect(zuordnungen.map((z) => z.reimbursed)).toEqual([28000, 3500]);
  });

  it('Beihilfebescheid mit Versicherungsspalte, Gesamtbetrag im Text und Detailanlage', () => {
    const text = `Beihilfestelle Musterstadt
Festsetzung der Beihilfe
Zu den geltend gemachten Aufwendungen wird eine Beihilfe in Höhe von 245,00
Euro festgesetzt.
Antrag vom 01.06.2026; Bescheid vom 20.06.2026
Rechnungs-  Rechnungs-  Versicherungs-  beihilfefähige  Satz  Beihilfe  Hinweis
datum       betrag      erstattung      Aufwendungen
10.05.2026   200,00   60,00   200,00   70   140,00 | 1234
10.05.2026   150,00   45,00   150,00   70   105,00
Summen   350,00   105,00   245,00
Anlage: Pflegedienst | 01.04.2026 - 30.04.2026   200,00   70   140,00`;
    const a = abrechnungAuslesen(text);
    expect(a).toMatchObject({ date: '2026-06-20', total: 24500, payer: 'beihilfe' });
    expect(a.zeilen).toHaveLength(2); // Zeile mit Leistungszeitraum ist keine Position
    const r1 = rechnung('2026-05-10', 20000);
    const r2 = rechnung('2026-05-10', 15000);
    const { zuordnungen, offen } = abrechnungZuordnen(a, [r1, r2]);
    expect(zuordnungen.map((z) => [z.invoiceId, z.reimbursed])).toEqual([[r1.id, 14000], [r2.id, 10500]]);
    expect(offen).toEqual([]);
  });

  it('ordnet bei abweichendem Datum nur über einen eindeutigen Betrag zu', () => {
    const a = abrechnungAuslesen('Behandlung 03.07.2026   80,00   24,00\nBehandlung 04.07.2026   50,00   15,00');
    const eindeutig = rechnung('2026-07-10', 8000);
    const doppelt = [rechnung('2026-07-11', 5000), rechnung('2026-07-12', 5000)];
    const { zuordnungen, offen } = abrechnungZuordnen(a, [eindeutig, ...doppelt]);
    expect(zuordnungen.map((z) => [z.invoiceId, z.reimbursed])).toEqual([[eindeutig.id, 2400]]);
    expect(offen.map((z) => z.date)).toEqual(['2026-07-04']);
  });
});

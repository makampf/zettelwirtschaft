import { describe, expect, it } from 'vitest';
import { zeilenAusPdf, type TextTeil } from './pdfLines';

const t = (str: string, x: number, y: number, width: number, groesse = 10): TextTeil => ({ str, transform: [groesse, 0, 0, groesse, x, y], width });

describe('PDF-Zeilen', () => {
  it('trennt Wörter mit einem Leerzeichen und Spalten mit drei', () => {
    const text = zeilenAusPdf([
      t('für', 32, 700, 12),
      t('Praxis', 0, 700, 30),
      t('Ergotherapie', 47, 700, 70),
      t('Musterstadt', 300, 700, 50),
      t('Rechnung', 0, 680, 40),
    ]);
    expect(text).toBe('Praxis für Ergotherapie   Musterstadt\nRechnung');
  });

  it('setzt in Stücke geteilte Wörter wieder zusammen', () => {
    expect(zeilenAusPdf([t('Rech', 0, 100, 20), t('nung', 20.5, 100, 20)])).toBe('Rechnung');
  });

  it('fasst leicht versetzte Stücke zu einer Zeile zusammen und ignoriert Leerstücke', () => {
    expect(zeilenAusPdf([t('Datum:', 0, 500, 30), t(' ', 31, 500, 2), t('01.08.2026', 60, 501.5, 50)])).toBe('Datum:   01.08.2026');
  });
});

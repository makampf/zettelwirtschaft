/** Ein Textstück aus pdf.js (`getTextContent().items`). */
export interface TextTeil {
  str: string;
  /** Transformationsmatrix: [a, b, c, d, x, y]; |a| ≈ Schriftgröße. */
  transform: number[];
  width: number;
  height?: number;
}

/** Abstand ab dem (in Schriftgrößen) zwei Textstücke als getrennte Spalten gelten. */
const SPALTEN_ABSTAND = 1.2;

/**
 * Setzt die Textstücke einer PDF-Seite wieder zu Zeilen zusammen.
 * Normale Wortabstände werden zu einem Leerzeichen, große Lücken (Tabellenspalten) zu drei Leerzeichen –
 * daran erkennt der Parser Spalten.
 */
export function zeilenAusPdf(teile: TextTeil[]): string {
  const zeilen: { y: number; teile: TextTeil[] }[] = [];
  for (const t of teile) {
    if (!t.str.trim()) continue;
    const y = t.transform[5];
    let zeile = zeilen.find((z) => Math.abs(z.y - y) < 3);
    if (!zeile) zeilen.push((zeile = { y, teile: [] }));
    zeile.teile.push(t);
  }
  return zeilen
    .sort((a, b) => b.y - a.y)
    .map((z) => {
      const sortiert = z.teile.sort((a, b) => a.transform[4] - b.transform[4]);
      let text = '';
      let ende: number | undefined;
      for (const t of sortiert) {
        const x = t.transform[4];
        const groesse = Math.abs(t.transform[0]) || t.height || 10;
        if (ende !== undefined) {
          const luecke = x - ende;
          if (luecke > groesse * SPALTEN_ABSTAND) text += '   ';
          else if (luecke > groesse * 0.1) text += ' ';
          // sonst direkt anschließen (ein Wort wurde in mehrere Stücke geteilt)
        }
        text += t.str.trim();
        ende = x + t.width;
      }
      return text;
    })
    .join('\n');
}

import { useMemo, useState } from 'react';
import { jahreswerte, rechnungUebersicht, sparte } from '../calc';
import { Leer, PersonChip } from '../components/ui';
import { datum, euro } from '../format';
import { useNav } from '../nav';
import { useStore } from '../store';
import { ART_NAME, KT_KURZ, type Payer, type ServiceKind } from '../types';

export default function Reports() {
  const { state, personById } = useStore();
  const nav = useNav();
  const jahre = useMemo(() => {
    const s = new Set(state.invoices.map((r) => Number(r.date.slice(0, 4))));
    s.add(new Date().getFullYear());
    return [...s].sort((a, b) => b - a);
  }, [state.invoices]);
  const [jahr, setJahr] = useState(jahre[0]);
  const [art, setArt] = useState<ServiceKind | ''>('');
  const personen = state.people.filter((p) => !nav.personFilter || p.id === nav.personFilter);
  const zeilen = personen.map((p) => ({ p, w: jahreswerte(state, p.id, jahr, art || undefined) }));
  const kts: Payer[] = art === 'illness' ? ['beihilfe', 'pkv'] : art === 'care' ? ['beihilfe', 'ppv'] : ['beihilfe', 'pkv', 'ppv'];

  function csvExport() {
    const kopf = ['Person', 'Rechnungsdatum', 'Art', 'Leistungserbringer', 'Verrechnungsstelle', 'Rechnungsnummer', 'Beschreibung', 'Betrag', 'Bezahlt am', 'Erstattet Beihilfe', 'Erstattet PKV', 'Erstattet PPV', 'Ausstehend', 'Eigenanteil'];
    const zahl = (c: number) => (c / 100).toFixed(2).replace('.', ',');
    const text = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = state.invoices
      .filter((r) => r.date.startsWith(`${jahr}-`) && (!art || r.kind === art) && personen.some((p) => p.id === r.personId))
      .sort((a, b) => a.personId.localeCompare(b.personId) || a.date.localeCompare(b.date))
      .map((r) => {
        const p = personById(r.personId)!;
        const u = rechnungUebersicht(r, p, state);
        // Versicherungserstattung nach Sparte der Rechnung (Pflege → PPV), auch bei gemeinsamem Vertrag
        const erst = (spalte: Payer) =>
          u.infos.find((i) => (i.kt === 'beihilfe' ? 'beihilfe' : sparte(r.kind)) === spalte && i.status === 'erstattet')?.erstattet ?? 0;
        return [text(p.name), datum(r.date), ART_NAME[r.kind], text(r.provider), text(r.billingOffice ?? ''), text(r.invoiceNumber), text(r.description), zahl(r.amount), datum(r.paidDate).replace('–', ''), zahl(erst('beihilfe')), zahl(erst('pkv')), zahl(erst('ppv')), zahl(u.ausstehend), zahl(u.eigenanteil)].join(';');
      });
    const blob = new Blob(['﻿' + [kopf.join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zettelwirtschaft-invoices-${jahr}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const gesamt = zeilen.reduce(
    (s, { w }) => ({
      anzahl: s.anzahl + w.anzahl,
      betrag: s.betrag + w.betrag,
      beihilfe: s.beihilfe + w.erstattet.beihilfe,
      pkv: s.pkv + w.erstattet.pkv,
      ppv: s.ppv + w.erstattet.ppv,
      ausstehend: s.ausstehend + w.ausstehend,
      eigenanteil: s.eigenanteil + w.eigenanteil,
    }),
    { anzahl: 0, betrag: 0, beihilfe: 0, pkv: 0, ppv: 0, ausstehend: 0, eigenanteil: 0 },
  );

  return (
    <section>
      <div className="seitenkopf">
        <h1>Auswertung</h1>
        <button onClick={csvExport}>CSV exportieren</button>
      </div>
      <div className="filterleiste">
        <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))} aria-label="Jahr">
          {jahre.map((j) => <option key={j} value={j}>{j}</option>)}
        </select>
        <div className="segmente">
          <button className={art === '' ? 'aktiv' : ''} onClick={() => setArt('')}>Alles</button>
          <button className={art === 'illness' ? 'aktiv' : ''} onClick={() => setArt('illness')}>Krankheit</button>
          <button className={art === 'care' ? 'aktiv' : ''} onClick={() => setArt('care')}>Pflege</button>
        </div>
      </div>

      {gesamt.anzahl === 0 ? (
        <Leer>Keine Rechnungen mit Rechnungsdatum in {jahr}.</Leer>
      ) : (
        <div className="tabelle-wrap">
          <table className="tabelle">
            <thead>
              <tr>
                <th>Person</th>
                <th className="zahl">Rechnungen</th>
                <th className="zahl">Summe</th>
                {kts.map((kt) => <th key={kt} className="zahl">Erstattet {KT_KURZ[kt]}</th>)}
                <th className="zahl">Noch ausstehend</th>
                <th className="zahl">Eigenanteil</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map(({ p, w }) => (
                <tr key={p.id}>
                  <td><PersonChip person={p} /></td>
                  <td className="zahl">{w.anzahl}</td>
                  <td className="zahl">{euro(w.betrag)}</td>
                  {kts.map((kt) => <td key={kt} className="zahl">{euro(w.erstattet[kt])}</td>)}
                  <td className="zahl">{euro(w.ausstehend)}</td>
                  <td className="zahl"><strong>{euro(w.eigenanteil)}</strong></td>
                </tr>
              ))}
            </tbody>
            {zeilen.length > 1 && (
              <tfoot>
                <tr>
                  <td>Gesamt</td>
                  <td className="zahl">{gesamt.anzahl}</td>
                  <td className="zahl">{euro(gesamt.betrag)}</td>
                  {kts.map((kt) => <td key={kt} className="zahl">{euro(gesamt[kt])}</td>)}
                  <td className="zahl">{euro(gesamt.ausstehend)}</td>
                  <td className="zahl">{euro(gesamt.eigenanteil)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      <p className="grau">
        Grundlage ist das Rechnungsdatum. Der Eigenanteil enthält für noch nicht beschiedene Positionen die erwartete Erstattung und ist daher vorläufig.
        Selbst getragene Krankheits- und Pflegekosten können ggf. als außergewöhnliche Belastungen in der Steuererklärung angesetzt werden – die CSV-Datei hilft bei der Aufstellung.
      </p>
    </section>
  );
}

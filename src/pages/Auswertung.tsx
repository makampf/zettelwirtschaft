import { useMemo, useState } from 'react';
import { jahreswerte, rechnungUebersicht } from '../calc';
import { Leer, PersonChip } from '../components/ui';
import { datum, euro } from '../format';
import { useNav } from '../nav';
import { useStore } from '../store';
import { ART_NAME, KT_KURZ, type Kostentraeger, type Leistungsart } from '../types';

export default function Auswertung() {
  const { state, personById } = useStore();
  const nav = useNav();
  const jahre = useMemo(() => {
    const s = new Set(state.rechnungen.map((r) => Number(r.datum.slice(0, 4))));
    s.add(new Date().getFullYear());
    return [...s].sort((a, b) => b - a);
  }, [state.rechnungen]);
  const [jahr, setJahr] = useState(jahre[0]);
  const [art, setArt] = useState<Leistungsart | ''>('');
  const personen = state.personen.filter((p) => !nav.personFilter || p.id === nav.personFilter);
  const zeilen = personen.map((p) => ({ p, w: jahreswerte(state, p.id, jahr, art || undefined) }));
  const kts: Kostentraeger[] = art === 'krankheit' ? ['beihilfe', 'pkv'] : art === 'pflege' ? ['beihilfe', 'ppv'] : ['beihilfe', 'pkv', 'ppv'];

  function csvExport() {
    const kopf = ['Person', 'Rechnungsdatum', 'Art', 'Leistungserbringer', 'Rechnungsnummer', 'Beschreibung', 'Betrag', 'Bezahlt am', 'Erstattet Beihilfe', 'Erstattet PKV', 'Erstattet PPV', 'Ausstehend', 'Eigenanteil'];
    const zahl = (c: number) => (c / 100).toFixed(2).replace('.', ',');
    const text = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const rows = state.rechnungen
      .filter((r) => r.datum.startsWith(`${jahr}-`) && (!art || r.art === art) && personen.some((p) => p.id === r.personId))
      .sort((a, b) => a.personId.localeCompare(b.personId) || a.datum.localeCompare(b.datum))
      .map((r) => {
        const p = personById(r.personId)!;
        const u = rechnungUebersicht(r, p, state);
        const erst = (kt: Kostentraeger) => u.infos.find((i) => i.kt === kt && i.status === 'erstattet')?.erstattet ?? 0;
        return [text(p.name), datum(r.datum), ART_NAME[r.art], text(r.leistungserbringer), text(r.rechnungsnummer), text(r.beschreibung), zahl(r.betrag), datum(r.bezahltAm).replace('–', ''), zahl(erst('beihilfe')), zahl(erst('pkv')), zahl(erst('ppv')), zahl(u.ausstehend), zahl(u.eigenanteil)].join(';');
      });
    const blob = new Blob(['﻿' + [kopf.join(';'), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Rechnungen_${jahr}.csv`;
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
          <button className={art === 'krankheit' ? 'aktiv' : ''} onClick={() => setArt('krankheit')}>Krankheit</button>
          <button className={art === 'pflege' ? 'aktiv' : ''} onClick={() => setArt('pflege')}>Pflege</button>
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

import { useState } from 'react';
import { Feld, Modal } from '../components/ui';
import { neueId } from '../format';
import { useStore } from '../store';
import type { Person } from '../types';

const FARBEN = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626'];

export default function Personen() {
  const { state } = useStore();
  const [bearbeiten, setBearbeiten] = useState<Person | 'neu' | null>(null);
  return (
    <section>
      <div className="seitenkopf">
        <h1>Personen</h1>
        <button className="primaer" onClick={() => setBearbeiten('neu')}>+ Person</button>
      </div>
      <div className="karten">
        {state.personen.map((p) => (
          <article key={p.id} className="karte" style={{ '--farbe': p.farbe } as React.CSSProperties}>
            <h2>{p.name}</h2>
            <dl className="daten-liste">
              <dt>Beihilfe</dt>
              <dd>
                {p.beihilfe.stelle || <span className="grau">Beihilfestelle nicht angegeben</span>}
                <br />
                {p.beihilfe.satzKrankheit} % Krankheit · {p.beihilfe.satzPflege} % Pflege · Frist {p.beihilfe.fristMonate} Monate
                {p.beihilfe.aktenzeichen && <><br />Az. {p.beihilfe.aktenzeichen}</>}
              </dd>
              <dt>Krankenversicherung</dt>
              <dd>{p.pkv.name || <span className="grau">nicht angegeben</span>} · {p.pkv.quote} %{p.pkv.nummer && <><br />Nr. {p.pkv.nummer}</>}</dd>
              <dt>Pflegeversicherung</dt>
              <dd>{p.ppv.name || <span className="grau">nicht angegeben</span>} · {p.ppv.quote} %{p.ppv.nummer && <><br />Nr. {p.ppv.nummer}</>}</dd>
              {p.notiz && <><dt>Notiz</dt><dd>{p.notiz}</dd></>}
            </dl>
            <button onClick={() => setBearbeiten(p)}>Bearbeiten</button>
          </article>
        ))}
      </div>
      {bearbeiten && <PersonFormular person={bearbeiten === 'neu' ? undefined : bearbeiten} onClose={() => setBearbeiten(null)} />}
    </section>
  );
}

function PersonFormular({ person, onClose }: { person?: Person; onClose: () => void }) {
  const { state, speicherePerson, loeschePerson } = useStore();
  const [p, setP] = useState<Person>(
    person ?? {
      id: neueId(),
      name: '',
      farbe: FARBEN[state.personen.length % FARBEN.length],
      beihilfe: { stelle: '', aktenzeichen: '', satzKrankheit: 70, satzPflege: 70, fristMonate: 12 },
      pkv: { name: '', nummer: '', quote: 30 },
      ppv: { name: '', nummer: '', quote: 30 },
      notiz: '',
    },
  );
  const bh = (teil: Partial<Person['beihilfe']>) => setP((x) => ({ ...x, beihilfe: { ...x.beihilfe, ...teil } }));
  const pkv = (teil: Partial<Person['pkv']>) => setP((x) => ({ ...x, pkv: { ...x.pkv, ...teil } }));
  const ppv = (teil: Partial<Person['ppv']>) => setP((x) => ({ ...x, ppv: { ...x.ppv, ...teil } }));
  const prozent = (v: string) => Math.max(0, Math.min(100, Number(v) || 0));
  const hatRechnungen = person && state.rechnungen.some((r) => r.personId === person.id);

  return (
    <Modal titel={person ? `${person.name} bearbeiten` : 'Neue Person'} onClose={onClose} breit>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          speicherePerson(p);
          onClose();
        }}
      >
        <div className="raster">
          <Feld label="Name">
            <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} required autoFocus />
          </Feld>
          <Feld label="Farbe" gruppe>
            <div className="farben">
              {FARBEN.map((f) => (
                <button type="button" key={f} className={`farbe ${p.farbe === f ? 'aktiv' : ''}`} style={{ background: f }} onClick={() => setP({ ...p, farbe: f })} aria-label={f} />
              ))}
            </div>
          </Feld>
        </div>

        <fieldset>
          <legend>Beihilfe</legend>
          <div className="raster">
            <Feld label="Beihilfestelle">
              <input value={p.beihilfe.stelle} placeholder="z. B. Landesamt für Besoldung" onChange={(e) => bh({ stelle: e.target.value })} />
            </Feld>
            <Feld label="Aktenzeichen / Personalnummer">
              <input value={p.beihilfe.aktenzeichen} onChange={(e) => bh({ aktenzeichen: e.target.value })} />
            </Feld>
            <Feld label="Bemessungssatz Krankheit (%)" hinweis="Aktive meist 50 %, Versorgungsempfänger meist 70 %">
              <input type="number" min={0} max={100} value={p.beihilfe.satzKrankheit} onChange={(e) => bh({ satzKrankheit: prozent(e.target.value) })} />
            </Feld>
            <Feld label="Bemessungssatz Pflege (%)">
              <input type="number" min={0} max={100} value={p.beihilfe.satzPflege} onChange={(e) => bh({ satzPflege: prozent(e.target.value) })} />
            </Feld>
            <Feld label="Antragsfrist (Monate ab Rechnungsdatum)" hinweis="Je nach Bundesland/Bund unterschiedlich – bitte prüfen">
              <input type="number" min={1} max={60} value={p.beihilfe.fristMonate} onChange={(e) => bh({ fristMonate: Math.max(1, Number(e.target.value) || 12) })} />
            </Feld>
          </div>
        </fieldset>

        <fieldset>
          <legend>Private Krankenversicherung</legend>
          <div className="raster">
            <Feld label="Versicherer">
              <input value={p.pkv.name} onChange={(e) => pkv({ name: e.target.value })} />
            </Feld>
            <Feld label="Versicherungsnummer">
              <input value={p.pkv.nummer} onChange={(e) => pkv({ nummer: e.target.value })} />
            </Feld>
            <Feld label="Erstattung (%)" hinweis="Meist 100 % minus Beihilfesatz">
              <input type="number" min={0} max={100} value={p.pkv.quote} onChange={(e) => pkv({ quote: prozent(e.target.value) })} />
            </Feld>
          </div>
        </fieldset>

        <fieldset>
          <legend>Private Pflegeversicherung</legend>
          <div className="raster">
            <Feld label="Versicherer">
              <input value={p.ppv.name} onChange={(e) => ppv({ name: e.target.value })} />
            </Feld>
            <Feld label="Versicherungsnummer">
              <input value={p.ppv.nummer} onChange={(e) => ppv({ nummer: e.target.value })} />
            </Feld>
            <Feld label="Erstattung (%)" hinweis="Leistungen sind je nach Pflegegrad gedeckelt – ggf. pro Rechnung anpassen">
              <input type="number" min={0} max={100} value={p.ppv.quote} onChange={(e) => ppv({ quote: prozent(e.target.value) })} />
            </Feld>
          </div>
        </fieldset>

        <Feld label="Notiz" breit>
          <textarea rows={2} value={p.notiz} placeholder="z. B. Pflegegrad, Vollmacht, Ansprechpartner" onChange={(e) => setP({ ...p, notiz: e.target.value })} />
        </Feld>

        <div className="aktionen">
          {person && (
            <button
              type="button"
              className="gefahr"
              disabled={hatRechnungen}
              title={hatRechnungen ? 'Person hat noch Rechnungen' : undefined}
              onClick={() => {
                if (confirm(`${person.name} löschen?`)) {
                  loeschePerson(person.id);
                  onClose();
                }
              }}
            >
              Löschen
            </button>
          )}
          <span className="abstand" />
          <button type="button" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="primaer">Speichern</button>
        </div>
      </form>
    </Modal>
  );
}

import { useMemo, useState } from 'react';
import { hinweise } from './calc';
import { NavCtx, type Nav, type Seite } from './nav';
import Auswertung from './pages/Auswertung';
import Daten from './pages/Daten';
import Einreichungen from './pages/Einreichungen';
import Personen from './pages/Personen';
import Rechnungen from './pages/Rechnungen';
import Uebersicht from './pages/Uebersicht';
import { useStore } from './store';

const SEITEN: { id: Seite; titel: string; icon: string }[] = [
  { id: 'uebersicht', titel: 'Übersicht', icon: '🏠' },
  { id: 'rechnungen', titel: 'Rechnungen', icon: '🧾' },
  { id: 'einreichungen', titel: 'Einreichungen', icon: '📨' },
  { id: 'auswertung', titel: 'Auswertung', icon: '📊' },
  { id: 'personen', titel: 'Personen', icon: '👥' },
  { id: 'daten', titel: 'Daten', icon: '💾' },
];

export default function App() {
  const { state, speicherArt } = useStore();
  const [seite, setSeite] = useState<Seite>('uebersicht');
  const [personFilter, setPersonFilter] = useState('');
  const [ziel, setZiel] = useState<Nav['ziel']>();

  const nav = useMemo<Nav>(
    () => ({
      seite,
      personFilter,
      setPersonFilter,
      gehe: (s, z) => {
        setSeite(s);
        setZiel(z);
        window.scrollTo(0, 0);
      },
      ziel,
      zielErledigt: () => setZiel(undefined),
    }),
    [seite, personFilter, ziel],
  );

  const kritisch = hinweise(state).filter((h) => h.stufe !== 'info' && (!personFilter || h.personId === personFilter)).length;

  return (
    <NavCtx.Provider value={nav}>
      <header className="kopf">
        <div className="marke">
          🧾 Rechnungsmanager{' '}
          <span className="speicherort" title={speicherArt === 'server' ? 'Daten liegen in der Server-Datenbank' : 'Daten liegen nur in diesem Browser'}>
            {speicherArt === 'server' ? '· Server' : '· Browser'}
          </span>
        </div>
        <nav>
          {SEITEN.map((s) => (
            <button key={s.id} className={seite === s.id ? 'aktiv' : ''} onClick={() => nav.gehe(s.id)} aria-label={s.titel} title={s.titel}>
              <span aria-hidden>{s.icon}</span> <span className="nav-text">{s.titel}</span>
              {s.id === 'uebersicht' && kritisch > 0 && <span className="zaehler">{kritisch}</span>}
            </button>
          ))}
        </nav>
        <select value={personFilter} onChange={(e) => setPersonFilter(e.target.value)} aria-label="Person filtern">
          <option value="">Alle Personen</option>
          {state.personen.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </header>
      <main>
        {seite === 'uebersicht' && <Uebersicht />}
        {seite === 'rechnungen' && <Rechnungen />}
        {seite === 'einreichungen' && <Einreichungen />}
        {seite === 'auswertung' && <Auswertung />}
        {seite === 'personen' && <Personen />}
        {seite === 'daten' && <Daten />}
      </main>
    </NavCtx.Provider>
  );
}

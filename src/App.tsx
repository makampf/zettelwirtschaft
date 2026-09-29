import { useMemo, useState } from 'react';
import { hinweise } from './calc';
import { NavCtx, type Nav, type Seite } from './nav';
import Data from './pages/Data';
import Invoices from './pages/Invoices';
import Overview from './pages/Overview';
import People from './pages/People';
import Reports from './pages/Reports';
import Submissions from './pages/Submissions';
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
          🧾 Zettelwirtschaft{' '}
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
          {state.people.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </header>
      <main>
        {seite === 'uebersicht' && <Overview />}
        {seite === 'rechnungen' && <Invoices />}
        {seite === 'einreichungen' && <Submissions />}
        {seite === 'auswertung' && <Reports />}
        {seite === 'personen' && <People />}
        {seite === 'daten' && <Data />}
      </main>
      <footer className="app-fuss">
        <a href="https://github.com/makampf/zettelwirtschaft/releases" target="_blank" rel="noreferrer">
          Zettelwirtschaft v{__APP_VERSION__}
        </a>
        <span aria-hidden> · </span>
        <span>Mit ❤️ von Marvin</span>
        <span aria-hidden> · </span>
        <a href="https://github.com/makampf/zettelwirtschaft" target="_blank" rel="noreferrer">Quellcode (AGPL-3.0)</a>
        <span aria-hidden> · </span>
        <a href="THIRD-PARTY-LICENSES.txt" target="_blank" rel="noreferrer">Lizenzen</a>
      </footer>
    </NavCtx.Provider>
  );
}

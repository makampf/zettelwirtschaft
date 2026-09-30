import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { startState } from './defaults';
import { neueId } from './format';
import { migriere } from './migration';
import { speicherErmitteln, type Speicher } from './storage';
import { browserDatenLoeschen } from './storage-browser';
import type { AppState, FileMeta, Submission, Person, Invoice } from './types';

interface Store {
  state: AppState;
  speicherArt: Speicher['art'];
  personById: (id: string) => Person | undefined;
  speicherePerson: (p: Person) => void;
  loeschePerson: (id: string) => void;
  speichereRechnung: (r: Invoice) => void;
  /** Speichert mehrere Rechnungen in einem Schritt (Massenbearbeitung). */
  speichereRechnungen: (rs: Invoice[]) => void;
  loescheRechnung: (id: string) => Promise<void>;
  speichereEinreichung: (e: Submission) => void;
  loescheEinreichung: (id: string) => Promise<void>;
  dateienHinzufuegen: (files: File[]) => Promise<FileMeta[]>;
  dateienEntfernen: (ids: string[]) => Promise<void>;
  dateiOeffnen: (id: string) => Promise<void>;
  dateiLaden: (id: string) => Promise<Blob | undefined>;
  allesErsetzen: (state: AppState, dateien: Map<string, Blob>) => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider fehlt');
  return s;
}

function upsert<T extends { id: string }>(liste: T[], el: T): T[] {
  return liste.some((x) => x.id === el.id) ? liste.map((x) => (x.id === el.id ? el : x)) : [...liste, el];
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [fehler, setFehler] = useState<{ text: string; art?: Speicher['art']; roh?: unknown } | null>(null);
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null);
  const [sp, setSp] = useState<Speicher | null>(null);
  // Zählt lokale Änderungen, damit ein Neuladen vom Server keine frischen Eingaben überschreibt
  const aenderungen = useRef(0);

  useEffect(() => {
    let art: Speicher['art'] | undefined;
    let roh: unknown;
    (async () => {
      const gefunden = await speicherErmitteln();
      art = gefunden.art;
      roh = await gefunden.lade();
      gefunden.uebernommen?.(roh);
      setSp(gefunden);
      setState(roh ? migriere(roh) : startState());
    })().catch((e) => setFehler({ text: String(e), art, roh }));
  }, []);

  const speichern = useCallback(
    (s: AppState) => {
      sp?.speichere(s).then(
        () => setSpeicherFehler(null),
        (e) => setSpeicherFehler(e instanceof Error ? e.message : String(e)),
      );
    },
    [sp],
  );

  useEffect(() => {
    if (state) speichern(state);
  }, [state, speichern]);

  // Server: beim Zurückkehren zur App den aktuellen Stand holen (Änderungen von anderen Geräten)
  useEffect(() => {
    if (sp?.art !== 'server') return;
    const neuLaden = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        await sp.warte?.();
        const vorher = aenderungen.current;
        const roh = await sp.lade();
        // Nur übernehmen, wenn zwischenzeitlich nichts lokal geändert wurde
        if (!roh || aenderungen.current !== vorher) return;
        sp.uebernommen?.(roh);
        setState(migriere(roh));
      } catch {
        // offline o. Ä. – beim nächsten Mal
      }
    };
    document.addEventListener('visibilitychange', neuLaden);
    return () => document.removeEventListener('visibilitychange', neuLaden);
  }, [sp]);

  const aendern = useCallback((fn: (s: AppState) => AppState) => {
    aenderungen.current++;
    setState((s) => (s ? fn(s) : s));
  }, []);

  const dateienEntfernen = useCallback(
    async (ids: string[]) => {
      if (!ids.length || !sp) return;
      await Promise.all(ids.map((id) => sp.loescheDatei(id)));
      aendern((s) => ({ ...s, files: s.files.filter((d) => !ids.includes(d.id)) }));
    },
    [aendern, sp],
  );

  const store = useMemo<Store | null>(() => {
    if (!state || !sp) return null;
    return {
      state,
      speicherArt: sp.art,
      personById: (id) => state.people.find((p) => p.id === id),
      speicherePerson: (p) =>
        aendern((s) => ({
          ...s,
          // Partnerschaft beidseitig pflegen
          people: upsert(s.people, p).map((x) => {
            if (x.id === p.id) return x;
            if (x.id === p.partnerId) return { ...x, partnerId: p.id };
            if (x.partnerId === p.id) return { ...x, partnerId: undefined };
            return x;
          }),
        })),
      loeschePerson: (id) =>
        aendern((s) => ({
          ...s,
          people: s.people.filter((p) => p.id !== id).map((p) => (p.partnerId === id ? { ...p, partnerId: undefined } : p)),
          submissions: s.submissions
            .map((e) => ({ ...e, personIds: e.personIds.filter((x) => x !== id) }))
            .filter((e) => e.personIds.length > 0),
        })),
      speichereRechnung: (r) => aendern((s) => ({ ...s, invoices: upsert(s.invoices, r) })),
      speichereRechnungen: (rs) => aendern((s) => ({ ...s, invoices: rs.reduce(upsert, s.invoices) })),
      loescheRechnung: async (id) => {
        const r = state.invoices.find((x) => x.id === id);
        if (r) await dateienEntfernen(r.fileIds);
        aendern((s) => ({
          ...s,
          invoices: s.invoices.filter((x) => x.id !== id),
          submissions: s.submissions.map((e) => ({ ...e, items: e.items.filter((p) => p.invoiceId !== id) })),
        }));
      },
      speichereEinreichung: (e) => aendern((s) => ({ ...s, submissions: upsert(s.submissions, e) })),
      loescheEinreichung: async (id) => {
        const e = state.submissions.find((x) => x.id === id);
        if (e) await dateienEntfernen(e.fileIds);
        aendern((s) => ({ ...s, submissions: s.submissions.filter((x) => x.id !== id) }));
      },
      dateienHinzufuegen: async (files) => {
        const metas: FileMeta[] = [];
        for (const f of files) {
          const meta = { id: neueId(), name: f.name, type: f.type || 'application/octet-stream', size: f.size };
          await sp.speichereDatei(meta, f);
          metas.push(meta);
        }
        aendern((s) => ({ ...s, files: [...s.files, ...metas] }));
        return metas;
      },
      dateienEntfernen,
      dateiLaden: (id) => sp.ladeDatei(id),
      dateiOeffnen: async (id) => {
        if (sp.dateiUrl) {
          window.open(sp.dateiUrl(id), '_blank');
          return;
        }
        // Fenster sofort öffnen, damit Popup-Blocker nicht eingreifen
        const fenster = window.open('', '_blank');
        const blob = await sp.ladeDatei(id);
        if (!blob) {
          fenster?.close();
          return alert('Datei nicht gefunden.');
        }
        const url = URL.createObjectURL(blob);
        if (fenster) fenster.location.href = url;
        else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      allesErsetzen: async (neu, dateien) => {
        aenderungen.current++;
        await sp.ersetzeAlles(neu, dateien);
        setState(neu);
      },
    };
  }, [state, sp, aendern, dateienEntfernen]);

  if (fehler) return <LadeFehler {...fehler} />;
  if (!store) return <div className="laden">Lade Daten …</div>;
  return (
    <Ctx.Provider value={store}>
      {speicherFehler && (
        <div className="speicherfehler" role="alert">
          <span>⚠️ Speichern fehlgeschlagen ({speicherFehler}). Deine Änderungen sind noch nicht gesichert.</span>
          <button className="klein" onClick={() => speichern(store.state)}>Erneut versuchen</button>
        </div>
      )}
      {children}
    </Ctx.Provider>
  );
}

/** Daten lassen sich nicht laden (z. B. Stand einer älteren App-Version): im Browser-Speicher Neustart anbieten. */
function LadeFehler({ text, art, roh }: { text: string; art?: Speicher['art']; roh?: unknown }) {
  const [loeschFehler, setLoeschFehler] = useState<string | null>(null);
  const herunterladen = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(roh, null, 2)], { type: 'application/json' }));
    a.download = `zettelwirtschaft-alte-daten-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const neuBeginnen = async () => {
    if (!confirm('Alle in diesem Browser gespeicherten Rechnungen, Einreichungen und Belege werden gelöscht. Fortfahren?')) return;
    try {
      await browserDatenLoeschen();
      location.reload();
    } catch (e) {
      setLoeschFehler(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="laden fehler">
      <p>Fehler beim Laden: {text}</p>
      {art === 'browser' && (
        <>
          <p className="grau">Die im Browser gespeicherten Daten stammen vermutlich von einer älteren Version der App.</p>
          <div className="zeile" style={{ justifyContent: 'center' }}>
            {roh != null && <button onClick={herunterladen}>Alte Daten herunterladen</button>}
            <button className="primaer" onClick={() => void neuBeginnen()}>Browserdaten löschen und neu beginnen</button>
          </div>
          {loeschFehler && <p>{loeschFehler}</p>}
        </>
      )}
    </div>
  );
}

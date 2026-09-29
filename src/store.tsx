import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { startState } from './beispiel';
import { dauerhaftSpeichern, ladeDatei, ladeState, loescheAlleDateien, loescheDatei, speichereDatei, speichereState } from './db';
import { neueId } from './format';
import type { AppState, DateiMeta, Einreichung, Person, Rechnung } from './types';

interface Store {
  state: AppState;
  personById: (id: string) => Person | undefined;
  speicherePerson: (p: Person) => void;
  loeschePerson: (id: string) => void;
  speichereRechnung: (r: Rechnung) => void;
  loescheRechnung: (id: string) => Promise<void>;
  speichereEinreichung: (e: Einreichung) => void;
  loescheEinreichung: (id: string) => Promise<void>;
  dateienHinzufuegen: (files: File[]) => Promise<DateiMeta[]>;
  dateienEntfernen: (ids: string[]) => Promise<void>;
  dateiOeffnen: (id: string) => Promise<void>;
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
  const [fehler, setFehler] = useState<string | null>(null);
  const geladen = useRef(false);

  useEffect(() => {
    ladeState()
      .then((s) => {
        setState(s ?? startState());
        geladen.current = true;
        void dauerhaftSpeichern();
      })
      .catch((e) => setFehler(String(e)));
  }, []);

  useEffect(() => {
    if (state && geladen.current) speichereState(state).catch((e) => setFehler(`Speichern fehlgeschlagen: ${e}`));
  }, [state]);

  const aendern = useCallback((fn: (s: AppState) => AppState) => setState((s) => (s ? fn(s) : s)), []);

  const dateienEntfernen = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return;
      await Promise.all(ids.map(loescheDatei));
      aendern((s) => ({ ...s, dateien: s.dateien.filter((d) => !ids.includes(d.id)) }));
    },
    [aendern],
  );

  const store = useMemo<Store | null>(() => {
    if (!state) return null;
    return {
      state,
      personById: (id) => state.personen.find((p) => p.id === id),
      speicherePerson: (p) =>
        aendern((s) => ({
          ...s,
          // Partnerschaft beidseitig pflegen
          personen: upsert(s.personen, p).map((x) => {
            if (x.id === p.id) return x;
            if (x.id === p.partnerId) return { ...x, partnerId: p.id };
            if (x.partnerId === p.id) return { ...x, partnerId: undefined };
            return x;
          }),
        })),
      loeschePerson: (id) =>
        aendern((s) => ({
          ...s,
          personen: s.personen.filter((p) => p.id !== id).map((p) => (p.partnerId === id ? { ...p, partnerId: undefined } : p)),
          einreichungen: s.einreichungen
            .map((e) => ({ ...e, personIds: e.personIds.filter((x) => x !== id) }))
            .filter((e) => e.personIds.length > 0),
        })),
      speichereRechnung: (r) => aendern((s) => ({ ...s, rechnungen: upsert(s.rechnungen, r) })),
      loescheRechnung: async (id) => {
        const r = state.rechnungen.find((x) => x.id === id);
        if (r) await dateienEntfernen(r.dateiIds);
        aendern((s) => ({
          ...s,
          rechnungen: s.rechnungen.filter((x) => x.id !== id),
          einreichungen: s.einreichungen.map((e) => ({ ...e, positionen: e.positionen.filter((p) => p.rechnungId !== id) })),
        }));
      },
      speichereEinreichung: (e) => aendern((s) => ({ ...s, einreichungen: upsert(s.einreichungen, e) })),
      loescheEinreichung: async (id) => {
        const e = state.einreichungen.find((x) => x.id === id);
        if (e) await dateienEntfernen(e.dateiIds);
        aendern((s) => ({ ...s, einreichungen: s.einreichungen.filter((x) => x.id !== id) }));
      },
      dateienHinzufuegen: async (files) => {
        const metas: DateiMeta[] = [];
        for (const f of files) {
          const meta = { id: neueId(), name: f.name, typ: f.type || 'application/octet-stream', groesse: f.size };
          await speichereDatei(meta.id, f);
          metas.push(meta);
        }
        aendern((s) => ({ ...s, dateien: [...s.dateien, ...metas] }));
        return metas;
      },
      dateienEntfernen,
      dateiOeffnen: async (id) => {
        const blob = await ladeDatei(id);
        if (!blob) return alert('Datei nicht gefunden.');
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },
      allesErsetzen: async (neu, dateien) => {
        await loescheAlleDateien();
        for (const [id, blob] of dateien) await speichereDatei(id, blob);
        setState(neu);
      },
    };
  }, [state, aendern, dateienEntfernen]);

  if (fehler) return <div className="laden fehler">Fehler: {fehler}</div>;
  if (!store) return <div className="laden">Lade Daten …</div>;
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

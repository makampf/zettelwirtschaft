import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { STATUS_NAME, type TraegerInfo } from '../calc';
import { centAlsEingabe, dateigroesse, euro, parseEuro } from '../format';
import { dateiHash, dateiVerwendung, gleicheDatei } from '../files';
import { useStore } from '../store';
import { KT_KURZ, type Person } from '../types';

/**
 * Dialog. Mit `geaendert` fragt ein Schließen per Klick daneben, Esc oder ✕ nach, bevor Eingaben verloren gehen
 * („Abbrechen“-Knöpfe im Formular rufen `onClose` direkt auf).
 */
export function Modal({ titel, onClose, children, breit, geaendert }: { titel: string; onClose: () => void; children: ReactNode; breit?: boolean; geaendert?: boolean }) {
  const aktuell = useRef({ onClose, geaendert });
  aktuell.current = { onClose, geaendert };
  const schliessen = useCallback(() => {
    if (aktuell.current.geaendert && !confirm('Ungespeicherte Änderungen verwerfen?')) return;
    aktuell.current.onClose();
  }, []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && schliessen();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [schliessen]);
  return (
    <div className="modal-hintergrund" onMouseDown={(e) => e.target === e.currentTarget && schliessen()}>
      <div className={`modal ${breit ? 'breit' : ''}`} role="dialog" aria-modal="true" aria-label={titel}>
        <div className="modal-kopf">
          <h2>{titel}</h2>
          <button type="button" className="icon" onClick={schliessen} aria-label="Schließen">✕</button>
        </div>
        <div className="modal-inhalt">{children}</div>
      </div>
    </div>
  );
}

/**
 * Beschriftetes Formularfeld. Mit `gruppe` wird statt eines <label> eine Gruppe gerendert –
 * nötig, wenn der Inhalt mehrere Buttons enthält (ein <label> würde sonst den ersten Button benennen).
 */
export function Feld({
  label,
  children,
  hinweis,
  breit,
  gruppe,
  erkannt,
}: {
  label: string;
  children: ReactNode;
  hinweis?: string;
  breit?: boolean;
  gruppe?: boolean;
  /** Wert wurde aus einem Beleg übernommen und sollte geprüft werden. */
  erkannt?: boolean;
}) {
  const inhalt = (
    <>
      <span>
        {label}
        {erkannt && <em className="erkannt-marke" title="Aus dem Beleg übernommen – bitte prüfen"> aus Beleg</em>}
      </span>
      {children}
      {hinweis && <small>{hinweis}</small>}
    </>
  );
  const klasse = `feld ${breit ? 'breit' : ''} ${erkannt ? 'erkannt' : ''}`;
  return gruppe ? (
    <div className={klasse} role="group" aria-label={label}>{inhalt}</div>
  ) : (
    <label className={klasse}>{inhalt}</label>
  );
}

/** Eingabefeld für Euro-Beträge; `wert` in Cent, `undefined` bei leerer Eingabe. */
export function BetragFeld({
  wert,
  onChange,
  pflicht,
  placeholder,
}: {
  wert: number | undefined;
  onChange: (cent: number | undefined) => void;
  pflicht?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(centAlsEingabe(wert));
  useEffect(() => {
    if (parseEuro(text) !== (wert ?? null)) setText(centAlsEingabe(wert));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wert]);
  const ungueltig = text.trim() !== '' && parseEuro(text) == null;
  return (
    <div className="betrag-feld">
      <input
        inputMode="decimal"
        value={text}
        required={pflicht}
        placeholder={placeholder ?? '0,00'}
        aria-invalid={ungueltig}
        onChange={(e) => {
          setText(e.target.value);
          const c = parseEuro(e.target.value);
          onChange(c ?? undefined);
        }}
        onBlur={() => {
          const c = parseEuro(text);
          if (c != null) setText(centAlsEingabe(c));
        }}
      />
      <span>€</span>
    </div>
  );
}

export function PersonChip({ person }: { person?: Person }) {
  if (!person) return <span className="chip">?</span>;
  return (
    <span className="chip" style={{ '--farbe': person.color } as React.CSSProperties}>
      {person.name}
    </span>
  );
}

export function StatusBadge({ info, mitBetrag }: { info: TraegerInfo; mitBetrag?: boolean }) {
  const betrag = info.status === 'erstattet' ? info.erstattet : info.status === 'offen' || info.status === 'eingereicht' ? info.erwartet : undefined;
  return (
    <span className={`badge status-${info.status}`} title={`${KT_KURZ[info.kt]}: ${STATUS_NAME[info.status]}`}>
      <b>{KT_KURZ[info.kt]}</b> {STATUS_NAME[info.status]}
      {mitBetrag && betrag != null && <> · {euro(betrag)}</>}
    </span>
  );
}

export function Leer({ children }: { children: ReactNode }) {
  return <div className="leer">{children}</div>;
}

/** Anhänge verwalten: bestehende (gespeicherte) Dateien und neu ausgewählte, noch nicht gespeicherte. */
export function DateiFeld({
  vorhandene,
  onVorhandene,
  neue,
  onNeue,
}: {
  vorhandene: string[];
  onVorhandene: (ids: string[]) => void;
  neue: File[];
  onNeue: (files: File[]) => void;
}) {
  const { state, dateiOeffnen } = useStore();
  const metas = vorhandene.map((id) => state.files.find((d) => d.id === id)).filter((d) => d != null);
  const [hashes, setHashes] = useState(() => new Map<File, string | undefined>());
  const [hinweis, setHinweis] = useState<string | null>(null);

  // Prüfsummen neuer Dateien berechnen
  useEffect(() => {
    const fehlend = neue.filter((f) => !hashes.has(f));
    if (!fehlend.length) return;
    let aktiv = true;
    void Promise.all(fehlend.map(async (f) => [f, await dateiHash(f)] as const)).then((liste) => {
      if (aktiv) setHashes((h) => new Map([...h, ...liste]));
    });
    return () => { aktiv = false; };
  }, [neue, hashes]);

  // Dieselbe Datei nicht zweimal an denselben Eintrag hängen
  useEffect(() => {
    const i = neue.findIndex((f, i) => {
      if (!hashes.has(f)) return false;
      const h = hashes.get(f);
      return neue.slice(0, i).some((g) => hashes.has(g) && (h ? hashes.get(g) === h : g.name === f.name && g.size === f.size)) || metas.some((m) => gleicheDatei(m, f, h));
    });
    if (i < 0) return;
    setHinweis(`„${neue[i].name}“ ist bereits angehängt und wurde nicht doppelt hinzugefügt.`);
    onNeue(neue.filter((_, j) => j !== i));
  }, [neue, hashes, metas, onNeue]);

  /** Schon an einem anderen Eintrag gespeichert? */
  const woanders = (f: File) => {
    if (!hashes.has(f)) return undefined;
    const m = state.files.find((d) => !vorhandene.includes(d.id) && gleicheDatei(d, f, hashes.get(f)));
    return m && { id: m.id, wo: dateiVerwendung(state, m.id) ?? 'einem anderen Eintrag' };
  };
  return (
    <div className="dateien">
      {metas.map((d) => (
        <div key={d.id} className="datei">
          <button type="button" className="link" onClick={() => dateiOeffnen(d.id)}>📎 {d.name}</button>
          <small>{dateigroesse(d.size)}</small>
          <button type="button" className="icon" aria-label="Entfernen" onClick={() => onVorhandene(vorhandene.filter((x) => x !== d.id))}>✕</button>
        </div>
      ))}
      {neue.map((f, i) => {
        const doppelt = woanders(f);
        return (
          <div key={`${f.name}-${i}`} className="datei neu">
            <span>📎 {f.name}</span>
            <small>{dateigroesse(f.size)} · neu</small>
            <button type="button" className="icon" aria-label="Entfernen" onClick={() => onNeue(neue.filter((_, j) => j !== i))}>✕</button>
            {doppelt && (
              <small className="doppelt" role="status">
                ⚠️ Derselbe Beleg ist bereits bei {doppelt.wo} hinterlegt ·{' '}
                <button type="button" className="link" onClick={() => dateiOeffnen(doppelt.id)}>ansehen</button>
              </small>
            )}
          </div>
        );
      })}
      {hinweis && <small className="grau" role="status">{hinweis}</small>}
      <label className="button klein">
        + Datei / Foto hinzufügen
        <input
          type="file"
          multiple
          accept="application/pdf,image/*"
          hidden
          onChange={(e) => {
            onNeue([...neue, ...Array.from(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />
      </label>
    </div>
  );
}

/** Speichert neue Dateien und entfernt abgewählte; liefert die finale Liste der Datei-IDs. */
export function useDateienSpeichern() {
  const { dateienHinzufuegen, dateienEntfernen } = useStore();
  return async (urspruenglich: string[], vorhandene: string[], neue: File[]): Promise<string[]> => {
    const hinzu = await dateienHinzufuegen(neue);
    await dateienEntfernen(urspruenglich.filter((id) => !vorhandene.includes(id)));
    return [...vorhandene, ...hinzu.map((d) => d.id)];
  };
}

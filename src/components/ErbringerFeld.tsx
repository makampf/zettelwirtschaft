import { useId, useMemo, useState } from 'react';
import { erbringerVorschlaege, type ErbringerInfo } from '../erbringer';
import { datum } from '../format';
import { ART_NAME } from '../types';

/** Eingabe für den Leistungserbringer mit Vorschlägen aus bisherigen Rechnungen. */
export function ErbringerFeld({
  wert,
  liste,
  onChange,
  onAuswahl,
  pflicht,
}: {
  wert: string;
  liste: ErbringerInfo[];
  onChange: (name: string) => void;
  /** Ein Vorschlag wurde ausgewählt. */
  onAuswahl: (info: ErbringerInfo) => void;
  pflicht?: boolean;
}) {
  const id = useId();
  const [offen, setOffen] = useState(false);
  const [aktiv, setAktiv] = useState(-1);
  const vorschlaege = useMemo(() => erbringerVorschlaege(liste, wert), [liste, wert]);
  const sichtbar = offen && vorschlaege.length > 0;

  function waehle(info: ErbringerInfo) {
    onChange(info.name);
    onAuswahl(info);
    setOffen(false);
    setAktiv(-1);
  }

  return (
    <div className="combobox">
      <input
        role="combobox"
        aria-expanded={sichtbar}
        aria-controls={`${id}-liste`}
        aria-autocomplete="list"
        aria-activedescendant={sichtbar && aktiv >= 0 ? `${id}-${aktiv}` : undefined}
        autoComplete="off"
        value={wert}
        required={pflicht}
        onFocus={() => setOffen(true)}
        onBlur={() => setOffen(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setOffen(true);
          setAktiv(-1);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOffen(true);
            setAktiv((a) => Math.min(a + 1, vorschlaege.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setAktiv((a) => Math.max(a - 1, 0));
          } else if (e.key === 'Enter' && sichtbar && aktiv >= 0) {
            e.preventDefault();
            waehle(vorschlaege[aktiv]);
          } else if (e.key === 'Escape' && sichtbar) {
            e.stopPropagation(); // nicht gleich das ganze Formular schließen
            setOffen(false);
          }
        }}
      />
      {sichtbar && (
        <ul id={`${id}-liste`} role="listbox" className="vorschlaege">
          {!wert && <li className="vorschlaege-titel" aria-hidden>Zuletzt verwendet</li>}
          {vorschlaege.map((v, i) => (
            <li
              key={v.name}
              id={`${id}-${i}`}
              role="option"
              aria-selected={i === aktiv}
              // mousedown statt click, damit das Eingabefeld den Fokus nicht vorher verliert
              onMouseDown={(e) => {
                e.preventDefault();
                waehle(v);
              }}
              onMouseEnter={() => setAktiv(i)}
            >
              <span>{v.name}</span>
              <small>
                {v.anzahl}× · zuletzt {datum(v.zuletzt)} · {ART_NAME[v.art]}
              </small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

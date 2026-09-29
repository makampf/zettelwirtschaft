import { useEffect, useMemo, useState } from 'react';
import { beihilfeFristEnde, erwartet, quote, rechnungUebersicht, traegerFuer, traegerInfo } from '../calc';
import { BetragFeld, DateiFeld, Feld, Leer, Modal, PersonChip, StatusBadge, useDateienSpeichern } from '../components/ui';
import { datum, euro, heute, neueId } from '../format';
import { useNav } from '../nav';
import { useStore } from '../store';
import { ART_NAME, KT_KURZ, KT_NAME, WEG_NAME, type Kostentraeger, type Leistungsart, type Rechnung } from '../types';

type Filter = 'alle' | 'einreichen' | 'ausstehend' | 'unbezahlt' | 'abgeschlossen';

const FILTER_NAME: Record<Filter, string> = {
  alle: 'Alle',
  einreichen: 'Noch einzureichen',
  ausstehend: 'Erstattung ausstehend',
  unbezahlt: 'Noch nicht bezahlt',
  abgeschlossen: 'Abgeschlossen',
};

export default function Rechnungen() {
  const { state, personById } = useStore();
  const nav = useNav();
  const [filter, setFilter] = useState<Filter>('alle');
  const [art, setArt] = useState<Leistungsart | ''>('');
  const [jahr, setJahr] = useState('');
  const [suche, setSuche] = useState('');
  // `n` erzwingt ein frisches Formular bei „Speichern & nächste“
  const [bearbeiten, setBearbeiten] = useState<{ r?: Rechnung; n: number; personId?: string } | null>(null);

  useEffect(() => {
    if (!nav.ziel) return;
    if (nav.ziel.neu) setBearbeiten({ n: 0, personId: nav.ziel.personId });
    const r = state.rechnungen.find((x) => x.id === nav.ziel?.rechnungId);
    if (r) setBearbeiten({ r, n: 0 });
    nav.zielErledigt();
  }, [nav, state.rechnungen]);

  const jahre = useMemo(() => [...new Set(state.rechnungen.map((r) => r.datum.slice(0, 4)))].sort().reverse(), [state.rechnungen]);

  const zeilen = useMemo(() => {
    const s = suche.trim().toLowerCase();
    return state.rechnungen
      .filter((r) => !nav.personFilter || r.personId === nav.personFilter)
      .filter((r) => !art || r.art === art)
      .filter((r) => !jahr || r.datum.startsWith(jahr))
      .filter((r) => !s || [r.leistungserbringer, r.rechnungsnummer, r.beschreibung, r.notiz].some((t) => t.toLowerCase().includes(s)))
      .map((r) => ({ r, person: personById(r.personId)! }))
      .filter((z) => z.person)
      .map((z) => ({ ...z, u: rechnungUebersicht(z.r, z.person, state.einreichungen) }))
      .filter(({ r, u }) => {
        switch (filter) {
          case 'einreichen': return u.infos.some((i) => i.status === 'offen');
          case 'ausstehend': return u.infos.some((i) => i.status === 'eingereicht');
          case 'unbezahlt': return !r.bezahltAm;
          case 'abgeschlossen': return u.abgeschlossen;
          default: return true;
        }
      })
      .sort((a, b) => b.r.datum.localeCompare(a.r.datum));
  }, [state, nav.personFilter, art, jahr, suche, filter, personById]);

  const summe = zeilen.reduce((s, z) => s + z.r.betrag, 0);
  const eigen = zeilen.reduce((s, z) => s + z.u.eigenanteil, 0);

  return (
    <section>
      <div className="seitenkopf">
        <h1>Rechnungen</h1>
        <button className="primaer" onClick={() => setBearbeiten({ n: 0 })}>+ Neue Rechnung</button>
      </div>

      <div className="filterleiste">
        <div className="segmente">
          {(Object.keys(FILTER_NAME) as Filter[]).map((f) => (
            <button key={f} className={filter === f ? 'aktiv' : ''} onClick={() => setFilter(f)}>{FILTER_NAME[f]}</button>
          ))}
        </div>
        <select value={art} onChange={(e) => setArt(e.target.value as Leistungsart | '')} aria-label="Art">
          <option value="">Krankheit &amp; Pflege</option>
          <option value="krankheit">Krankheit</option>
          <option value="pflege">Pflege</option>
        </select>
        <select value={jahr} onChange={(e) => setJahr(e.target.value)} aria-label="Jahr">
          <option value="">Alle Jahre</option>
          {jahre.map((j) => <option key={j}>{j}</option>)}
        </select>
        <input type="search" placeholder="Suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
      </div>

      {zeilen.length === 0 ? (
        <Leer>Keine Rechnungen gefunden.</Leer>
      ) : (
        <div className="tabelle-wrap">
          <table className="tabelle klickbar">
            <thead>
              <tr>
                <th>Datum</th>
                <th>Person</th>
                <th>Leistungserbringer</th>
                <th>Art</th>
                <th className="zahl">Betrag</th>
                <th>Bezahlt</th>
                <th>Erstattung</th>
                <th className="zahl" title="Voraussichtlicher Eigenanteil">Eigenanteil</th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map(({ r, person, u }) => (
                <tr key={r.id} onClick={() => setBearbeiten({ r, n: 0 })}>
                  <td>{datum(r.datum)}</td>
                  <td><PersonChip person={person} /></td>
                  <td>
                    <div>{r.leistungserbringer || '–'}{r.dateiIds.length > 0 && ' 📎'}</div>
                    {(r.beschreibung || r.rechnungsnummer) && <small className="grau">{[r.rechnungsnummer && `Nr. ${r.rechnungsnummer}`, r.beschreibung].filter(Boolean).join(' · ')}</small>}
                  </td>
                  <td>{ART_NAME[r.art]}</td>
                  <td className="zahl">{euro(r.betrag)}</td>
                  <td>{r.bezahltAm ? <span className="ok">✓ {datum(r.bezahltAm)}</span> : r.faelligAm ? <span className={r.faelligAm < heute() ? 'rot' : ''}>fällig {datum(r.faelligAm)}</span> : <span className="grau">offen</span>}</td>
                  <td><div className="badges">{u.infos.map((i) => <StatusBadge key={i.kt} info={i} />)}</div></td>
                  <td className="zahl">{euro(u.eigenanteil)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>{zeilen.length} Rechnung(en)</td>
                <td className="zahl">{euro(summe)}</td>
                <td colSpan={2}></td>
                <td className="zahl">{euro(eigen)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {bearbeiten && (
        <RechnungFormular
          key={bearbeiten.r?.id ?? `neu-${bearbeiten.n}`}
          rechnung={bearbeiten.r}
          personId={bearbeiten.personId}
          onClose={() => setBearbeiten(null)}
          onNeu={(personId) => setBearbeiten({ n: bearbeiten.n + 1, personId })}
        />
      )}
    </section>
  );
}

function leereRechnung(personId: string, art: Leistungsart = 'krankheit'): Rechnung {
  return {
    id: neueId(),
    personId,
    art,
    datum: heute(),
    leistungserbringer: '',
    rechnungsnummer: '',
    beschreibung: '',
    betrag: 0,
    nichtEinreichen: [],
    erwartetManuell: {},
    dateiIds: [],
    notiz: '',
  };
}

export function RechnungFormular({
  rechnung,
  personId,
  onClose,
  onNeu,
}: {
  rechnung?: Rechnung;
  personId?: string;
  onClose: () => void;
  onNeu?: (personId: string) => void;
}) {
  const { state, personById, speichereRechnung, loescheRechnung } = useStore();
  const nav = useNav();
  const dateienSpeichern = useDateienSpeichern();
  const [r, setR] = useState<Rechnung>(() => rechnung ?? leereRechnung(personId || nav.personFilter || state.personen[0]?.id || ''));
  const [betrag, setBetrag] = useState<number | undefined>(rechnung?.betrag);
  const [dateiIds, setDateiIds] = useState(r.dateiIds);
  const [neueDateien, setNeueDateien] = useState<File[]>([]);
  const [speichert, setSpeichert] = useState(false);

  const person = personById(r.personId);
  const set = <K extends keyof Rechnung>(k: K, v: Rechnung[K]) => setR((x) => ({ ...x, [k]: v }));
  const vorschau = { ...r, betrag: betrag ?? 0 };

  // Leistungserbringer-Vorschläge aus bisherigen Rechnungen
  const erbringer = useMemo(() => [...new Set(state.rechnungen.map((x) => x.leistungserbringer).filter(Boolean))].sort(), [state.rechnungen]);

  async function speichern(undNeu: boolean) {
    if (betrag == null || !person) return;
    setSpeichert(true);
    try {
      const ids = await dateienSpeichern(rechnung?.dateiIds ?? [], dateiIds, neueDateien);
      speichereRechnung({ ...r, betrag, dateiIds: ids });
      if (undNeu && onNeu) onNeu(r.personId);
      else onClose();
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <Modal titel={rechnung ? 'Rechnung bearbeiten' : 'Neue Rechnung'} onClose={onClose} breit>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void speichern(false);
        }}
      >
        <div className="raster">
          <Feld label="Person">
            <select value={r.personId} onChange={(e) => set('personId', e.target.value)} required>
              {state.personen.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Feld>
          <Feld label="Art" gruppe>
            <div className="segmente">
              {(['krankheit', 'pflege'] as Leistungsart[]).map((a) => (
                <button type="button" key={a} className={r.art === a ? 'aktiv' : ''} onClick={() => set('art', a)}>{ART_NAME[a]}</button>
              ))}
            </div>
          </Feld>
          <Feld label="Rechnungsdatum">
            <input type="date" value={r.datum} onChange={(e) => set('datum', e.target.value)} required />
          </Feld>
          <Feld label="Betrag">
            <BetragFeld wert={betrag} onChange={setBetrag} pflicht />
          </Feld>
          <Feld label="Leistungserbringer" hinweis="Arzt, Apotheke, Pflegedienst, Heim …">
            <input list="erbringer" value={r.leistungserbringer} onChange={(e) => set('leistungserbringer', e.target.value)} required />
            <datalist id="erbringer">{erbringer.map((e) => <option key={e} value={e} />)}</datalist>
          </Feld>
          <Feld label="Rechnungsnummer">
            <input value={r.rechnungsnummer} onChange={(e) => set('rechnungsnummer', e.target.value)} />
          </Feld>
          <Feld label="Beschreibung" breit>
            <input value={r.beschreibung} placeholder="z. B. Behandlung 03/2026, Heimkosten September" onChange={(e) => set('beschreibung', e.target.value)} />
          </Feld>
          <Feld label="Zahlbar bis">
            <input type="date" value={r.faelligAm ?? ''} onChange={(e) => set('faelligAm', e.target.value || undefined)} />
          </Feld>
          <Feld label="Bezahlt am" gruppe>
            <div className="zeile">
              <input type="date" value={r.bezahltAm ?? ''} onChange={(e) => set('bezahltAm', e.target.value || undefined)} />
              {!r.bezahltAm && <button type="button" className="klein" onClick={() => set('bezahltAm', heute())}>Heute</button>}
            </div>
          </Feld>
        </div>

        {person && (
          <fieldset>
            <legend>Einreichung &amp; Erstattung</legend>
            <div className="traeger-liste">
              {traegerFuer(r.art).map((kt) => (
                <TraegerZeile
                  key={kt}
                  kt={kt}
                  rechnung={vorschau}
                  quoteProzent={quote(person, r.art, kt)}
                  berechnet={erwartet({ ...vorschau, erwartetManuell: {} }, person, kt)}
                  onChange={(teil) => setR((x) => ({ ...x, ...teil }))}
                  status={rechnung ? traegerInfo(vorschau, person, kt, state.einreichungen) : undefined}
                  onEinreichung={(id) => nav.gehe('einreichungen', { einreichungId: id })}
                />
              ))}
            </div>
            {traegerFuer(r.art).includes('beihilfe') && r.datum && (
              <small className="grau">Beihilfe-Antragsfrist ({person.beihilfe.fristMonate} Monate): bis {datum(beihilfeFristEnde(r, person))}</small>
            )}
          </fieldset>
        )}

        <Feld label="Belege" gruppe breit>
          <DateiFeld vorhandene={dateiIds} onVorhandene={setDateiIds} neue={neueDateien} onNeue={setNeueDateien} />
        </Feld>
        <Feld label="Notiz" breit>
          <textarea rows={2} value={r.notiz} onChange={(e) => set('notiz', e.target.value)} />
        </Feld>

        <div className="aktionen">
          {rechnung && (
            <button
              type="button"
              className="gefahr"
              onClick={async () => {
                if (confirm('Rechnung inklusive Belegen löschen? Sie wird auch aus Einreichungen entfernt.')) {
                  await loescheRechnung(rechnung.id);
                  onClose();
                }
              }}
            >
              Löschen
            </button>
          )}
          <span className="abstand" />
          <button type="button" onClick={onClose}>Abbrechen</button>
          {!rechnung && onNeu && (
            <button type="button" disabled={speichert || betrag == null} onClick={() => void speichern(true)}>Speichern &amp; nächste</button>
          )}
          <button type="submit" className="primaer" disabled={speichert || betrag == null}>Speichern</button>
        </div>
      </form>
    </Modal>
  );
}

function TraegerZeile({
  kt,
  rechnung,
  quoteProzent,
  berechnet,
  status,
  onChange,
  onEinreichung,
}: {
  kt: Kostentraeger;
  rechnung: Rechnung;
  quoteProzent: number;
  berechnet: number;
  status?: ReturnType<typeof traegerInfo>;
  onChange: (teil: Partial<Rechnung>) => void;
  onEinreichung: (id: string) => void;
}) {
  const nicht = rechnung.nichtEinreichen.includes(kt);
  const manuell = rechnung.erwartetManuell[kt];
  const e = status?.einreichung;
  return (
    <div className="traeger">
      <div className="traeger-kopf">
        <strong>{KT_NAME[kt]}</strong>
        {status && <StatusBadge info={status} mitBetrag />}
      </div>
      {e && (
        <small>
          <button type="button" className="link" onClick={() => onEinreichung(e.id)}>
            Eingereicht am {datum(e.eingereichtAm)} per {WEG_NAME[e.weg]}{e.referenz && ` (${e.referenz})`}
          </button>
          {e.bescheidAm && ` · Bescheid vom ${datum(e.bescheidAm)}`}
        </small>
      )}
      {!e && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={nicht}
            onChange={(ev) =>
              onChange({ nichtEinreichen: ev.target.checked ? [...rechnung.nichtEinreichen, kt] : rechnung.nichtEinreichen.filter((x) => x !== kt) })
            }
          />
          Nicht bei {KT_KURZ[kt]} einreichen {kt === 'pkv' && <small className="grau">(z. B. wegen Beitragsrückerstattung)</small>}
        </label>
      )}
      {!nicht && (
        <div className="zeile">
          <span className="grau">Erwartete Erstattung:</span>
          <BetragFeld
            wert={manuell}
            placeholder={`${(berechnet / 100).toFixed(2).replace('.', ',')}`}
            onChange={(c) => {
              const neu = { ...rechnung.erwartetManuell };
              if (c == null) delete neu[kt];
              else neu[kt] = c;
              onChange({ erwartetManuell: neu });
            }}
          />
          <small className="grau">{manuell == null ? `${quoteProzent} % laut Person` : 'manuell'}</small>
        </div>
      )}
    </div>
  );
}


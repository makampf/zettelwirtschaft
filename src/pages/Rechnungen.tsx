import { useEffect, useMemo, useRef, useState } from 'react';
import { beihilfeFristEnde, breRelevant, erwartet, quote, rechnungUebersicht, selbstbehalt, standardZurueckhalten, traegerFuer, traegerInfo, versicherungFuer } from '../calc';
import { ErbringerFeld } from '../components/ErbringerFeld';
import { BetragFeld, DateiFeld, Feld, Leer, Modal, PersonChip, StatusBadge, useDateienSpeichern } from '../components/ui';
import { erbringerListe, type ErbringerInfo } from '../erbringer';
import { rechnungAuslesen, type Erkennung } from '../erkennung/parser';
import { istLesbar, textAusDatei } from '../erkennung/text';
import { datum, euro, heute, neueId } from '../format';
import { useNav } from '../nav';
import { useStore } from '../store';
import { ART_NAME, KT_KURZ, KT_NAME, WEG_NAME, type Kostentraeger, type Leistungsart, type Rechnung } from '../types';

/** Felder, die aus einem Beleg vorausgefüllt werden können. */
type ErkanntesFeld = keyof Erkennung;

const FELD_NAME: Record<ErkanntesFeld, string> = {
  betrag: 'Betrag',
  datum: 'Rechnungsdatum',
  faelligAm: 'Zahlungsziel',
  rechnungsnummer: 'Rechnungsnummer',
  leistungserbringer: 'Leistungserbringer',
  art: 'Art',
  vorsorge: 'Vorsorge',
  personId: 'Person',
};

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
  const [bearbeiten, setBearbeiten] = useState<{ r?: Rechnung; n: number; personId?: string; belege?: File[] } | null>(null);

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
      .map((z) => ({ ...z, u: rechnungUebersicht(z.r, z.person, state) }))
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
        <div className="zeile">
          <label className="button" title="PDF oder Foto einer Rechnung – die Angaben werden automatisch ausgelesen">
            📄 Aus Beleg erfassen
            <input
              type="file"
              accept="application/pdf,image/*"
              hidden
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = '';
                if (files.length) setBearbeiten({ n: (bearbeiten?.n ?? 0) + 1, belege: files });
              }}
            />
          </label>
          <button className="primaer" onClick={() => setBearbeiten({ n: 0 })}>+ Neue Rechnung</button>
        </div>
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
                    <div>{r.leistungserbringer || '–'}{r.dateiIds.length > 0 && ' 📎'}{r.vorsorge && <span className="badge tag">Vorsorge</span>}</div>
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
          belege={bearbeiten.belege}
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
    vorsorge: false,
    nichtEinreichen: [],
    erwartetManuell: {},
    dateiIds: [],
    notiz: '',
  };
}

export function RechnungFormular({
  rechnung,
  personId,
  belege,
  onClose,
  onNeu,
}: {
  rechnung?: Rechnung;
  personId?: string;
  /** Beim Öffnen schon ausgewählte Belege – werden sofort ausgelesen. */
  belege?: File[];
  onClose: () => void;
  onNeu?: (personId: string) => void;
}) {
  const { state, personById, speichereRechnung, loescheRechnung, dateiLaden } = useStore();
  const nav = useNav();
  const dateienSpeichern = useDateienSpeichern();
  const [r, setR] = useState<Rechnung>(() => rechnung ?? leereRechnung(personId || nav.personFilter || state.personen[0]?.id || ''));
  const [betrag, setBetrag] = useState<number | undefined>(rechnung?.betrag);
  const [dateiIds, setDateiIds] = useState(r.dateiIds);
  const [neueDateien, setNeueDateien] = useState<File[]>(belege ?? []);
  const [speichert, setSpeichert] = useState(false);
  // Auslesen von Belegen: welche Felder wurden übernommen, was hat der Nutzer selbst eingegeben?
  const [erkannt, setErkannt] = useState<Set<ErkanntesFeld>>(new Set());
  const [leseStatus, setLeseStatus] = useState<{ art: 'laeuft' | 'ok' | 'leer' | 'fehler'; text: string } | null>(null);
  const beruehrt = useRef(new Set<string>());
  const [leseText, setLeseText] = useState<string | null>(null);
  // Bei neuen Rechnungen wird „Zurückhalten (BRE)“ vorbelegt, bis die Checkbox von Hand geändert wird.
  const [pkvManuell, setPkvManuell] = useState(!!rechnung);

  const person = personById(r.personId);

  useEffect(() => {
    if (pkvManuell || !person) return;
    const halten = standardZurueckhalten(r, person, state);
    setR((x) => {
      const kt = versicherungFuer(x.art);
      const ohne = x.nichtEinreichen.filter((k) => k !== 'pkv' && k !== 'ppv');
      const neu = halten ? [...ohne, kt] : ohne;
      return neu.join() === x.nichtEinreichen.join() ? x : { ...x, nichtEinreichen: neu };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.personId, r.art, r.vorsorge, r.datum, pkvManuell, person, state]);
  const set = <K extends keyof Rechnung>(k: K, v: Rechnung[K]) => {
    beruehrt.current.add(k);
    setErkannt((e) => (e.has(k as ErkanntesFeld) ? new Set([...e].filter((x) => x !== k)) : e));
    setR((x) => ({ ...x, [k]: v }));
  };
  const setzeBetrag = (c: number | undefined) => {
    beruehrt.current.add('betrag');
    setErkannt((e) => new Set([...e].filter((x) => x !== 'betrag')));
    setBetrag(c);
  };

  /** Liest einen Beleg aus und füllt nur Felder, die noch leer sind bzw. nicht selbst bearbeitet wurden. */
  async function auslesen(datei: File) {
    setLeseStatus({ art: 'laeuft', text: 'Beleg wird ausgelesen …' });
    try {
      const text = await textAusDatei(datei, (t) => setLeseStatus({ art: 'laeuft', text: t }));
      setLeseText(text);
      const e = rechnungAuslesen(text, { personen: state.personen, bekannteErbringer: erbringer, heute: heute() });
      const frei = (k: string, leer: boolean) => !beruehrt.current.has(k) && (!rechnung || leer);
      const uebernommen = new Set<ErkanntesFeld>();
      const teil: Partial<Rechnung> = {};
      if (e.betrag != null && frei('betrag', !betrag)) {
        setBetrag(e.betrag);
        uebernommen.add('betrag');
      }
      if (e.datum && frei('datum', false)) (teil.datum = e.datum), uebernommen.add('datum');
      if (e.faelligAm && frei('faelligAm', !r.faelligAm)) (teil.faelligAm = e.faelligAm), uebernommen.add('faelligAm');
      if (e.rechnungsnummer && frei('rechnungsnummer', !r.rechnungsnummer)) (teil.rechnungsnummer = e.rechnungsnummer), uebernommen.add('rechnungsnummer');
      if (e.leistungserbringer && frei('leistungserbringer', !r.leistungserbringer)) (teil.leistungserbringer = e.leistungserbringer), uebernommen.add('leistungserbringer');
      if (e.art && e.art !== r.art && frei('art', false)) (teil.art = e.art), uebernommen.add('art');
      if (e.vorsorge && frei('vorsorge', false)) (teil.vorsorge = true), uebernommen.add('vorsorge');
      if (e.personId && e.personId !== r.personId && frei('personId', false)) (teil.personId = e.personId), uebernommen.add('personId');
      setR((x) => ({ ...x, ...teil }));
      setErkannt(uebernommen);
      setLeseStatus(
        uebernommen.size
          ? { art: 'ok', text: `Aus dem Beleg übernommen: ${[...uebernommen].map((k) => FELD_NAME[k]).join(', ')} – bitte prüfen.` }
          : { art: 'leer', text: 'Im Beleg wurden keine (neuen) Angaben erkannt. Bitte von Hand ausfüllen.' },
      );
    } catch (err) {
      setLeseStatus({ art: 'fehler', text: `Beleg konnte nicht ausgelesen werden: ${err instanceof Error ? err.message : err}` });
    }
  }

  // Beim Öffnen mit Beleg sofort auslesen
  useEffect(() => {
    const erster = belege?.find(istLesbar);
    if (erster) void auslesen(erster);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function neueBelege(files: File[]) {
    const hinzu = files.filter((f) => !neueDateien.includes(f));
    setNeueDateien(files);
    // Neue Rechnung: den ersten neu hinzugefügten lesbaren Beleg automatisch auslesen
    const lesbar = hinzu.find(istLesbar);
    if (!rechnung && lesbar && leseStatus?.art !== 'laeuft') void auslesen(lesbar);
  }

  async function vorhandenenBelegAuslesen() {
    const neu = [...neueDateien].reverse().find(istLesbar);
    if (neu) return auslesen(neu);
    for (const id of [...dateiIds].reverse()) {
      const meta = state.dateien.find((d) => d.id === id);
      if (!meta) continue;
      const blob = await dateiLaden(id);
      if (!blob) continue;
      const datei = new File([blob], meta.name, { type: meta.typ });
      if (istLesbar(datei)) return auslesen(datei);
    }
    setLeseStatus({ art: 'leer', text: 'Kein lesbarer Beleg (PDF oder Bild) vorhanden.' });
  }
  const vorschau = { ...r, betrag: betrag ?? 0 };

  // Leistungserbringer-Vorschläge aus bisherigen Rechnungen (ohne die gerade bearbeitete)
  const erbringerInfos = useMemo(() => erbringerListe(state.rechnungen.filter((x) => x.id !== r.id)), [state.rechnungen, r.id]);
  const erbringer = useMemo(() => erbringerInfos.map((e) => e.name), [erbringerInfos]);
  const [vorlageHinweis, setVorlageHinweis] = useState<string | null>(null);

  /** Bekannter Erbringer gewählt: Art und (eindeutige) Person wie bei den bisherigen Rechnungen übernehmen. */
  function erbringerGewaehlt(info: ErbringerInfo) {
    const teil: Partial<Rechnung> = {};
    const uebernommen: string[] = [];
    if (!beruehrt.current.has('art') && !erkannt.has('art') && info.art !== r.art) {
      teil.art = info.art;
      uebernommen.push(ART_NAME[info.art]);
    }
    if (!rechnung && info.personId && info.personId !== r.personId && !beruehrt.current.has('personId') && !erkannt.has('personId')) {
      teil.personId = info.personId;
      uebernommen.push(personById(info.personId)?.name ?? '');
    }
    if (uebernommen.length) {
      setR((x) => ({ ...x, ...teil }));
      setVorlageHinweis(`Wie bei den bisherigen Rechnungen: ${uebernommen.join(', ')}`);
    }
  }
  const hatLesbarenBeleg = neueDateien.some(istLesbar) || dateiIds.some((id) => /pdf|image/.test(state.dateien.find((d) => d.id === id)?.typ ?? ''));

  const belegFeld = (
    <Feld label="Belege" gruppe breit hinweis={!rechnung ? 'PDF oder Foto hinzufügen – die Angaben werden automatisch ausgelesen' : undefined}>
      <DateiFeld vorhandene={dateiIds} onVorhandene={setDateiIds} neue={neueDateien} onNeue={neueBelege} />
      {hatLesbarenBeleg && leseStatus?.art !== 'laeuft' && (rechnung || leseStatus) && (
        <button type="button" className="klein" onClick={() => void vorhandenenBelegAuslesen()}>🔍 Angaben aus Beleg übernehmen</button>
      )}
      {leseStatus && <div className={`lesestatus ${leseStatus.art}`} role="status">{leseStatus.art === 'laeuft' ? '⏳ ' : leseStatus.art === 'ok' ? '✓ ' : leseStatus.art === 'fehler' ? '⚠️ ' : 'ℹ️ '}{leseStatus.text}</div>}
      {leseText && leseStatus?.art !== 'laeuft' && (
        <details className="lesetext">
          <summary>Gelesenen Text anzeigen</summary>
          <pre>{leseText.trim() || '(kein Text erkannt)'}</pre>
        </details>
      )}
    </Feld>
  );

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
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          // Beleg per Drag & Drop auf das Formular ziehen
          const files = Array.from(e.dataTransfer.files);
          if (!files.length) return;
          e.preventDefault();
          neueBelege([...neueDateien, ...files]);
        }}
      >
        {!rechnung && <div className="beleg-oben">{belegFeld}</div>}
        <div className="raster">
          <Feld label="Person" erkannt={erkannt.has('personId')}>
            <select value={r.personId} onChange={(e) => set('personId', e.target.value)} required>
              {state.personen.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Feld>
          <Feld label="Art" gruppe erkannt={erkannt.has('art')}>
            <div className="segmente">
              {(['krankheit', 'pflege'] as Leistungsart[]).map((a) => (
                <button type="button" key={a} className={r.art === a ? 'aktiv' : ''} onClick={() => set('art', a)}>{ART_NAME[a]}</button>
              ))}
            </div>
          </Feld>
          <Feld label="Rechnungsdatum" erkannt={erkannt.has('datum')}>
            <input type="date" value={r.datum} onChange={(e) => set('datum', e.target.value)} required />
          </Feld>
          <Feld label="Betrag" erkannt={erkannt.has('betrag')}>
            <BetragFeld wert={betrag} onChange={setzeBetrag} pflicht />
          </Feld>
          <Feld label="Leistungserbringer" hinweis="Arzt, Apotheke, Pflegedienst, Heim …" erkannt={erkannt.has('leistungserbringer')}>
            <ErbringerFeld
              wert={r.leistungserbringer}
              liste={erbringerInfos}
              onChange={(name) => {
                setVorlageHinweis(null);
                set('leistungserbringer', name);
              }}
              onAuswahl={erbringerGewaehlt}
              pflicht
            />
            {vorlageHinweis && <small className="ok">{vorlageHinweis}</small>}
          </Feld>
          <Feld label="Rechnungsnummer" erkannt={erkannt.has('rechnungsnummer')}>
            <input value={r.rechnungsnummer} onChange={(e) => set('rechnungsnummer', e.target.value)} />
          </Feld>
          <Feld label="Beschreibung" breit>
            <input value={r.beschreibung} placeholder="z. B. Behandlung 03/2026, Heimkosten September" onChange={(e) => set('beschreibung', e.target.value)} />
          </Feld>
          {r.art === 'krankheit' && (
            <Feld label="Vorsorge" hinweis="Ohne Selbstbehalt, gefährdet die Beitragsrückerstattung nicht" erkannt={erkannt.has('vorsorge')}>
              <label className="checkbox">
                <input type="checkbox" checked={r.vorsorge} onChange={(e) => set('vorsorge', e.target.checked)} />
                Vorsorgeuntersuchung
              </label>
            </Feld>
          )}
          <Feld label="Zahlbar bis" erkannt={erkannt.has('faelligAm')}>
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
              {traegerFuer(r.art, person).map((kt) => (
                <TraegerZeile
                  key={kt}
                  kt={kt}
                  rechnung={vorschau}
                  quoteProzent={quote(person, r.art, kt)}
                  berechnet={erwartet({ ...vorschau, erwartetManuell: {} }, person, kt, state.rechnungen)}
                  selbstbehalt={kt === versicherungFuer(r.art) ? selbstbehalt(vorschau, person, state.rechnungen) : 0}
                  bre={kt === versicherungFuer(r.art) && breRelevant(vorschau, person)}
                  onChange={(teil) => {
                    if (teil.nichtEinreichen) setPkvManuell(true);
                    setR((x) => ({ ...x, ...teil }));
                  }}
                  status={rechnung ? traegerInfo(vorschau, person, kt, state) : undefined}
                  onEinreichung={(id) => nav.gehe('einreichungen', { einreichungId: id })}
                />
              ))}
            </div>
            {traegerFuer(r.art, person).includes('beihilfe') && r.datum && (
              <small className="grau">Beihilfe-Antragsfrist ({person.beihilfe.fristMonate} Monate): bis {datum(beihilfeFristEnde(r, person))}</small>
            )}
          </fieldset>
        )}

        {rechnung && belegFeld}
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
  selbstbehalt,
  bre,
  status,
  onChange,
  onEinreichung,
}: {
  kt: Kostentraeger;
  rechnung: Rechnung;
  quoteProzent: number;
  berechnet: number;
  selbstbehalt: number;
  bre: boolean;
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
          {bre ? 'Zurückhalten für Beitragsrückerstattung' : `Nicht bei ${KT_KURZ[kt]} einreichen`}
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
      {!nicht && manuell == null && selbstbehalt > 0 && <small className="grau">abzüglich {euro(selbstbehalt)} Selbstbehalt</small>}
      {nicht && bre && <small className="grau">Wird bei der Entscheidung zur Beitragsrückerstattung berücksichtigt (siehe Übersicht).</small>}
    </div>
  );
}


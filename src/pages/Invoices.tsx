import { useEffect, useMemo, useRef, useState } from 'react';
import { beihilfeFristEnde, breRelevant, erwartet, moeglicheDuplikate, quote, rechnungUebersicht, selbstbehalt, standardZurueckhalten, traegerFuer, traegerInfo, versicherungFuer } from '../calc';
import { ProviderField } from '../components/ProviderField';
import { BetragFeld, DateiFeld, Feld, Leer, Modal, PersonChip, StatusBadge, useDateienSpeichern } from '../components/ui';
import { erbringerListe, type ErbringerInfo } from '../providers';
import { rechnungAuslesen, type Recognition } from '../recognition/parser';
import { istLesbar, textAusDatei } from '../recognition/text';
import { datum, euro, heute, neueId } from '../format';
import { useNav } from '../nav';
import { useStore } from '../store';
import { ART_NAME, ktKurz, ktName, WEG_NAME, type Payer, type Person, type ServiceKind, type Invoice } from '../types';

/** Felder, die aus einem Beleg vorausgefüllt werden können. */
type ErkanntesFeld = keyof Recognition;

const FELD_NAME: Record<ErkanntesFeld, string> = {
  amount: 'Betrag',
  date: 'Rechnungsdatum',
  dueDate: 'Zahlungsziel',
  invoiceNumber: 'Rechnungsnummer',
  provider: 'Leistungserbringer',
  billingOffice: 'Verrechnungsstelle',
  kind: 'Art',
  preventive: 'Vorsorge',
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

export default function Invoices() {
  const { state, personById } = useStore();
  const nav = useNav();
  const [filter, setFilter] = useState<Filter>('alle');
  const [art, setArt] = useState<ServiceKind | ''>('');
  const [jahr, setJahr] = useState('');
  const [suche, setSuche] = useState('');
  // `n` erzwingt ein frisches Formular bei „Speichern & nächste“
  const [bearbeiten, setBearbeiten] = useState<{ r?: Invoice; n: number; personId?: string; belege?: File[] } | null>(null);

  useEffect(() => {
    if (!nav.ziel) return;
    if (nav.ziel.neu) setBearbeiten({ n: 0, personId: nav.ziel.personId });
    const r = state.invoices.find((x) => x.id === nav.ziel?.rechnungId);
    if (r) setBearbeiten({ r, n: 0 });
    nav.zielErledigt();
  }, [nav, state.invoices]);

  const jahre = useMemo(() => [...new Set(state.invoices.map((r) => r.date.slice(0, 4)))].sort().reverse(), [state.invoices]);

  const zeilen = useMemo(() => {
    const s = suche.trim().toLowerCase();
    return state.invoices
      .filter((r) => !nav.personFilter || r.personId === nav.personFilter)
      .filter((r) => !art || r.kind === art)
      .filter((r) => !jahr || r.date.startsWith(jahr))
      .filter((r) => !s || [r.provider, r.billingOffice ?? '', r.invoiceNumber, r.description, r.note].some((t) => t.toLowerCase().includes(s)))
      .map((r) => ({ r, person: personById(r.personId)! }))
      .filter((z) => z.person)
      .map((z) => ({ ...z, u: rechnungUebersicht(z.r, z.person, state) }))
      .filter(({ r, u }) => {
        switch (filter) {
          case 'einreichen': return u.infos.some((i) => i.status === 'offen');
          case 'ausstehend': return u.infos.some((i) => i.status === 'eingereicht');
          case 'unbezahlt': return !r.paidDate;
          case 'abgeschlossen': return u.abgeschlossen;
          default: return true;
        }
      })
      .sort((a, b) => b.r.date.localeCompare(a.r.date));
  }, [state, nav.personFilter, art, jahr, suche, filter, personById]);

  const summe = zeilen.reduce((s, z) => s + z.r.amount, 0);
  const eigen = zeilen.reduce((s, z) => s + z.u.eigenanteil, 0);

  // Mehrfachauswahl für die Massenbearbeitung – nur sichtbare Rechnungen zählen
  const [markiert, setMarkiert] = useState<Set<string>>(new Set());
  const auswahl = zeilen.filter((z) => markiert.has(z.r.id)).map((z) => z.r);
  const alleMarkiert = zeilen.length > 0 && auswahl.length === zeilen.length;
  const markieren = (id: string) => setMarkiert((m) => { const n = new Set(m); if (!n.delete(id)) n.add(id); return n; });

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
        <select value={art} onChange={(e) => setArt(e.target.value as ServiceKind | '')} aria-label="Art">
          <option value="">Krankheit &amp; Pflege</option>
          <option value="illness">Krankheit</option>
          <option value="care">Pflege</option>
        </select>
        <select value={jahr} onChange={(e) => setJahr(e.target.value)} aria-label="Jahr">
          <option value="">Alle Jahre</option>
          {jahre.map((j) => <option key={j}>{j}</option>)}
        </select>
        <input type="search" placeholder="Suchen …" value={suche} onChange={(e) => setSuche(e.target.value)} />
      </div>

      {auswahl.length > 0 && <MassenLeiste auswahl={auswahl} onFertig={() => setMarkiert(new Set())} />}

      {zeilen.length === 0 ? (
        <Leer>Keine Rechnungen gefunden.</Leer>
      ) : (
        <div className="tabelle-wrap">
          <table className="tabelle klickbar">
            <thead>
              <tr>
                <th className="auswahl">
                  <input
                    type="checkbox"
                    aria-label="Alle auswählen"
                    checked={alleMarkiert}
                    onChange={() => setMarkiert(alleMarkiert ? new Set() : new Set(zeilen.map((z) => z.r.id)))}
                  />
                </th>
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
                <tr key={r.id} onClick={() => setBearbeiten({ r, n: 0 })} className={markiert.has(r.id) ? 'markiert' : ''}>
                  <td className="auswahl" onClick={(ev) => { ev.stopPropagation(); markieren(r.id); }}>
                    <input type="checkbox" aria-label="Auswählen" checked={markiert.has(r.id)} onChange={() => markieren(r.id)} onClick={(ev) => ev.stopPropagation()} />
                  </td>
                  <td>{datum(r.date)}</td>
                  <td><PersonChip person={person} /></td>
                  <td>
                    <div>{r.provider || '–'}{r.fileIds.length > 0 && ' 📎'}{r.preventive && <span className="badge tag">Vorsorge</span>}</div>
                    {(r.description || r.invoiceNumber || r.billingOffice) && <small className="grau">{[r.billingOffice && `über ${r.billingOffice}`, r.invoiceNumber && `Nr. ${r.invoiceNumber}`, r.description].filter(Boolean).join(' · ')}</small>}
                  </td>
                  <td>{ART_NAME[r.kind]}</td>
                  <td className="zahl">{euro(r.amount)}</td>
                  <td>{r.paidDate ? <span className="ok">✓ {datum(r.paidDate)}</span> : r.dueDate ? <span className={r.dueDate < heute() ? 'rot' : ''}>fällig {datum(r.dueDate)}</span> : <span className="grau">offen</span>}</td>
                  <td><div className="badges">{u.infos.map((i) => <StatusBadge key={i.kt} info={i} />)}</div></td>
                  <td className="zahl">{euro(u.eigenanteil)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={5}>{zeilen.length} Rechnung(en)</td>
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

function leereRechnung(personId: string, art: ServiceKind = 'illness'): Invoice {
  return {
    id: neueId(),
    personId,
    kind: art,
    date: heute(),
    provider: '',
    invoiceNumber: '',
    description: '',
    amount: 0,
    preventive: false,
    heldBack: [],
    expectedOverride: {},
    fileIds: [],
    note: '',
  };
}

/** Aktionsleiste für mehrere ausgewählte Rechnungen. */
function MassenLeiste({ auswahl, onFertig }: { auswahl: Invoice[]; onFertig: () => void }) {
  const { state, personById, speichereRechnungen, loescheRechnung } = useStore();
  const [bezahltAm, setBezahltAm] = useState(heute());
  const summe = auswahl.reduce((s, r) => s + r.amount, 0);
  const aendern = (fn: (r: Invoice) => Invoice) => speichereRechnungen(auswahl.map(fn));
  // Zurückhalten betrifft die private Versicherung der jeweiligen Person (PKV bzw. PPV)
  const halten = (ja: boolean) =>
    aendern((r) => {
      const p = personById(r.personId);
      if (!p) return r;
      const kt = versicherungFuer(r.kind, p);
      const ohne = r.heldBack.filter((k) => k !== kt);
      return { ...r, heldBack: ja ? [...ohne, kt] : ohne };
    });

  return (
    <div className="massen" role="toolbar" aria-label="Massenbearbeitung">
      <strong>{auswahl.length} ausgewählt · {euro(summe)}</strong>
      <div className="massen-gruppe">
        <input type="date" value={bezahltAm} onChange={(e) => setBezahltAm(e.target.value)} aria-label="Bezahlt am" />
        <button className="klein" disabled={!bezahltAm} onClick={() => aendern((r) => ({ ...r, paidDate: bezahltAm }))}>Als bezahlt markieren</button>
        <button className="klein" onClick={() => aendern((r) => ({ ...r, paidDate: undefined }))}>Unbezahlt</button>
      </div>
      <div className="massen-gruppe">
        <button className="klein" onClick={() => halten(true)} title="Bei der Versicherung zurückhalten (Beitragsrückerstattung)">Zurückhalten</button>
        <button className="klein" onClick={() => halten(false)} title="Zur Einreichung bei der Versicherung freigeben">Freigeben</button>
      </div>
      <div className="massen-gruppe">
        <select
          value=""
          aria-label="Ändern"
          onChange={(e) => {
            const [feld, wert] = e.target.value.split(':');
            if (feld === 'kind') aendern((r) => ({ ...r, kind: wert as ServiceKind, preventive: wert === 'care' ? false : r.preventive }));
            if (feld === 'preventive') aendern((r) => ({ ...r, preventive: r.kind === 'illness' && wert === 'ja' }));
            if (feld === 'person') aendern((r) => ({ ...r, personId: wert }));
          }}
        >
          <option value="">Ändern …</option>
          <optgroup label="Art">
            <option value="kind:illness">Krankheit</option>
            <option value="kind:care">Pflege</option>
          </optgroup>
          <optgroup label="Vorsorge">
            <option value="preventive:ja">Vorsorgeuntersuchung</option>
            <option value="preventive:nein">keine Vorsorge</option>
          </optgroup>
          <optgroup label="Person">
            {state.people.map((p) => <option key={p.id} value={`person:${p.id}`}>{p.name}</option>)}
          </optgroup>
        </select>
      </div>
      <span className="abstand" />
      <button
        className="klein gefahr"
        onClick={async () => {
          if (!confirm(`${auswahl.length} Rechnung(en) mit ihren Belegen löschen?`)) return;
          for (const r of auswahl) await loescheRechnung(r.id);
          onFertig();
        }}
      >
        Löschen
      </button>
      <button className="klein" onClick={onFertig}>Auswahl aufheben</button>
    </div>
  );
}

export function RechnungFormular({
  rechnung,
  personId,
  belege,
  onClose,
  onNeu,
}: {
  rechnung?: Invoice;
  personId?: string;
  /** Beim Öffnen schon ausgewählte Belege – werden sofort ausgelesen. */
  belege?: File[];
  onClose: () => void;
  onNeu?: (personId: string) => void;
}) {
  const { state, personById, speichereRechnung, loescheRechnung, dateiLaden } = useStore();
  const nav = useNav();
  const dateienSpeichern = useDateienSpeichern();
  const [r, setR] = useState<Invoice>(() => rechnung ?? leereRechnung(personId || nav.personFilter || state.people[0]?.id || ''));
  const [betrag, setBetrag] = useState<number | undefined>(rechnung?.amount);
  const [dateiIds, setDateiIds] = useState(r.fileIds);
  const [neueDateien, setNeueDateien] = useState<File[]>(belege ?? []);
  const [speichert, setSpeichert] = useState(false);
  // Auslesen von Belegen: welche Felder wurden übernommen, was hat der Nutzer selbst eingegeben?
  const [erkannt, setErkannt] = useState<Set<ErkanntesFeld>>(new Set());
  const [leseStatus, setLeseStatus] = useState<{ art: 'laeuft' | 'ok' | 'leer' | 'fehler'; text: string } | null>(null);
  const beruehrt = useRef(new Set<keyof Invoice>());
  const [leseText, setLeseText] = useState<string | null>(null);
  // Für die Rückfrage beim Schließen: wurde etwas eingegeben, ausgelesen oder ein Beleg hinzugefügt?
  const [angefasst, setAngefasst] = useState(false);
  const geaendert = angefasst || erkannt.size > 0 || neueDateien.length > 0 || dateiIds.join() !== (rechnung?.fileIds ?? []).join();
  // Bei neuen Rechnungen wird „Zurückhalten (BRE)“ vorbelegt, bis die Checkbox von Hand geändert wird.
  const [pkvManuell, setPkvManuell] = useState(!!rechnung);

  const person = personById(r.personId);

  useEffect(() => {
    if (pkvManuell || !person) return;
    const halten = standardZurueckhalten(r, person, state);
    setR((x) => {
      const kt = versicherungFuer(x.kind, person);
      const ohne = x.heldBack.filter((k) => k !== 'pkv' && k !== 'ppv');
      const neu = halten ? [...ohne, kt] : ohne;
      return neu.join() === x.heldBack.join() ? x : { ...x, heldBack: neu };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.personId, r.kind, r.preventive, r.date, pkvManuell, person, state]);
  const set = <K extends keyof Invoice>(k: K, v: Invoice[K]) => {
    beruehrt.current.add(k);
    setErkannt((e) => (e.has(k as ErkanntesFeld) ? new Set([...e].filter((x) => x !== k)) : e));
    setR((x) => ({ ...x, [k]: v }));
  };
  const setzeBetrag = (c: number | undefined) => {
    beruehrt.current.add('amount');
    setErkannt((e) => new Set([...e].filter((x) => x !== 'amount')));
    setBetrag(c);
  };

  /** Liest einen Beleg aus und füllt nur Felder, die noch leer sind bzw. nicht selbst bearbeitet wurden. */
  async function auslesen(datei: File) {
    setLeseStatus({ art: 'laeuft', text: 'Beleg wird ausgelesen …' });
    try {
      const text = await textAusDatei(datei, (t) => setLeseStatus({ art: 'laeuft', text: t }));
      setLeseText(text);
      const e = rechnungAuslesen(text, { personen: state.people, bekannteErbringer: erbringer, bekannteVerrechnungsstellen: verrechnungsstellen, heute: heute() });
      const frei = (k: keyof Invoice, leer: boolean) => !beruehrt.current.has(k) && (!rechnung || leer);
      const uebernommen = new Set<ErkanntesFeld>();
      const teil: Partial<Invoice> = {};
      if (e.amount != null && frei('amount', !betrag)) {
        setBetrag(e.amount);
        uebernommen.add('amount');
      }
      if (e.date && frei('date', false)) (teil.date = e.date), uebernommen.add('date');
      if (e.dueDate && frei('dueDate', !r.dueDate)) (teil.dueDate = e.dueDate), uebernommen.add('dueDate');
      if (e.invoiceNumber && frei('invoiceNumber', !r.invoiceNumber)) (teil.invoiceNumber = e.invoiceNumber), uebernommen.add('invoiceNumber');
      if (e.provider && frei('provider', !r.provider)) (teil.provider = e.provider), uebernommen.add('provider');
      if (e.billingOffice && frei('billingOffice', !r.billingOffice)) (teil.billingOffice = e.billingOffice), uebernommen.add('billingOffice');
      if (e.kind && e.kind !== r.kind && frei('kind', false)) (teil.kind = e.kind), uebernommen.add('kind');
      if (e.preventive && frei('preventive', false)) (teil.preventive = true), uebernommen.add('preventive');
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
      const meta = state.files.find((d) => d.id === id);
      if (!meta) continue;
      const blob = await dateiLaden(id);
      if (!blob) continue;
      const datei = new File([blob], meta.name, { type: meta.type });
      if (istLesbar(datei)) return auslesen(datei);
    }
    setLeseStatus({ art: 'leer', text: 'Kein lesbarer Beleg (PDF oder Bild) vorhanden.' });
  }
  const vorschau = { ...r, amount: betrag ?? 0 };
  const duplikate = moeglicheDuplikate(vorschau, state.invoices);
  const dupText = (x: Invoice) => `${x.provider || 'Rechnung'} vom ${datum(x.date)}, ${euro(x.amount)}${x.invoiceNumber ? `, Nr. ${x.invoiceNumber}` : ''}`;

  // Leistungserbringer-Vorschläge aus bisherigen Rechnungen (ohne die gerade bearbeitete)
  const erbringerInfos = useMemo(() => erbringerListe(state.invoices.filter((x) => x.id !== r.id)), [state.invoices, r.id]);
  const erbringer = useMemo(() => erbringerInfos.map((e) => e.name), [erbringerInfos]);
  const verrechnungsstellen = useMemo(
    () => [...new Set(state.invoices.map((x) => x.billingOffice?.trim()).filter((x): x is string => !!x))].sort(),
    [state.invoices],
  );
  const [vorlageHinweis, setVorlageHinweis] = useState<string | null>(null);

  /** Bekannter Erbringer gewählt: Art und (eindeutige) Person wie bei den bisherigen Rechnungen übernehmen. */
  function erbringerGewaehlt(info: ErbringerInfo) {
    const teil: Partial<Invoice> = {};
    const uebernommen: string[] = [];
    if (!beruehrt.current.has('kind') && !erkannt.has('kind') && info.art !== r.kind) {
      teil.kind = info.art;
      uebernommen.push(ART_NAME[info.art]);
    }
    if (info.billingOffice && !r.billingOffice && !beruehrt.current.has('billingOffice')) {
      teil.billingOffice = info.billingOffice;
      uebernommen.push(`über ${info.billingOffice}`);
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
  const hatLesbarenBeleg = neueDateien.some(istLesbar) || dateiIds.some((id) => /pdf|image/.test(state.files.find((d) => d.id === id)?.type ?? ''));

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
    if (!rechnung && duplikate.length && !confirm(`Diese Rechnung ist möglicherweise schon erfasst (${duplikate.map(dupText).join('; ')}). Trotzdem speichern?`)) return;
    setSpeichert(true);
    try {
      const ids = await dateienSpeichern(rechnung?.fileIds ?? [], dateiIds, neueDateien);
      speichereRechnung({ ...r, amount: betrag, fileIds: ids });
      if (undNeu && onNeu) onNeu(r.personId);
      else onClose();
    } finally {
      setSpeichert(false);
    }
  }

  return (
    <Modal titel={rechnung ? 'Rechnung bearbeiten' : 'Neue Rechnung'} onClose={onClose} breit geaendert={geaendert}>
      <form
        onChangeCapture={() => setAngefasst(true)}
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
              {state.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Feld>
          <Feld label="Art" gruppe erkannt={erkannt.has('kind')}>
            <div className="segmente">
              {(['illness', 'care'] as ServiceKind[]).map((a) => (
                <button type="button" key={a} className={r.kind === a ? 'aktiv' : ''} onClick={() => set('kind', a)}>{ART_NAME[a]}</button>
              ))}
            </div>
          </Feld>
          <Feld label="Rechnungsdatum" erkannt={erkannt.has('date')}>
            <input type="date" value={r.date} onChange={(e) => set('date', e.target.value)} required />
          </Feld>
          <Feld label="Betrag" erkannt={erkannt.has('amount')}>
            <BetragFeld wert={betrag} onChange={setzeBetrag} pflicht />
          </Feld>
          <Feld label="Leistungserbringer" hinweis="Arzt, Apotheke, Pflegedienst, Heim …" erkannt={erkannt.has('provider')}>
            <ProviderField
              wert={r.provider}
              liste={erbringerInfos}
              onChange={(name) => {
                setVorlageHinweis(null);
                set('provider', name);
              }}
              onAuswahl={erbringerGewaehlt}
              pflicht
            />
            {vorlageHinweis && <small className="ok">{vorlageHinweis}</small>}
          </Feld>
          <Feld label="Abgerechnet über" hinweis="Nur bei Verrechnungsstellen – sonst leer lassen" erkannt={erkannt.has('billingOffice')}>
            <input
              list="verrechnungsstellen"
              value={r.billingOffice ?? ''}
              placeholder="z. B. Verrechnungsstelle"
              onChange={(e) => set('billingOffice', e.target.value || undefined)}
            />
            <datalist id="verrechnungsstellen">
              {verrechnungsstellen.map((v) => <option key={v} value={v} />)}
            </datalist>
          </Feld>
          <Feld label="Rechnungsnummer" erkannt={erkannt.has('invoiceNumber')}>
            <input value={r.invoiceNumber} onChange={(e) => set('invoiceNumber', e.target.value)} />
          </Feld>
          {duplikate.length > 0 && (
            <div className="hinweis warnung breit" role="status">
              ⚠️ Möglicherweise schon erfasst:{' '}
              {duplikate.map((x, i) => (
                <span key={x.id}>
                  {i > 0 && '; '}
                  {dupText(x)}
                </span>
              ))}
            </div>
          )}
          <Feld label="Beschreibung" breit>
            <input value={r.description} placeholder="z. B. Behandlung 03/2026, Heimkosten September" onChange={(e) => set('description', e.target.value)} />
          </Feld>
          {r.kind === 'illness' && (
            <Feld label="Vorsorge" hinweis="Ohne Selbstbehalt, gefährdet die Beitragsrückerstattung nicht" erkannt={erkannt.has('preventive')}>
              <label className="checkbox">
                <input type="checkbox" checked={r.preventive} onChange={(e) => set('preventive', e.target.checked)} />
                Vorsorgeuntersuchung
              </label>
            </Feld>
          )}
          <Feld label="Zahlbar bis" erkannt={erkannt.has('dueDate')}>
            <input type="date" value={r.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || undefined)} />
          </Feld>
          <Feld label="Bezahlt am" gruppe>
            <div className="zeile">
              <input type="date" value={r.paidDate ?? ''} onChange={(e) => set('paidDate', e.target.value || undefined)} />
              {!r.paidDate && <button type="button" className="klein" onClick={() => set('paidDate', heute())}>Heute</button>}
            </div>
          </Feld>
        </div>

        {person && (
          <fieldset>
            <legend>Einreichung &amp; Erstattung</legend>
            <div className="traeger-liste">
              {traegerFuer(r.kind, person).map((kt) => (
                <TraegerZeile
                  key={kt}
                  kt={kt}
                  person={person}
                  rechnung={vorschau}
                  quoteProzent={quote(person, r.kind, kt)}
                  berechnet={erwartet({ ...vorschau, expectedOverride: {} }, person, kt, state.invoices)}
                  selbstbehalt={kt === versicherungFuer(r.kind, person) ? selbstbehalt(vorschau, person, state.invoices) : 0}
                  bre={kt === versicherungFuer(r.kind, person) && breRelevant(vorschau, person)}
                  onChange={(teil) => {
                    if (teil.heldBack) setPkvManuell(true);
                    setR((x) => ({ ...x, ...teil }));
                  }}
                  status={rechnung ? traegerInfo(vorschau, person, kt, state) : undefined}
                  onEinreichung={(id) => nav.gehe('einreichungen', { einreichungId: id })}
                />
              ))}
            </div>
            {traegerFuer(r.kind, person).includes('beihilfe') && r.date && (
              <small className="grau">Beihilfe-Antragsfrist ({person.beihilfe.deadlineMonths} Monate): bis {datum(beihilfeFristEnde(r, person))}</small>
            )}
          </fieldset>
        )}

        {rechnung && belegFeld}
        <Feld label="Notiz" breit>
          <textarea rows={2} value={r.note} onChange={(e) => set('note', e.target.value)} />
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
  person,
  rechnung,
  quoteProzent,
  berechnet,
  selbstbehalt,
  bre,
  status,
  onChange,
  onEinreichung,
}: {
  kt: Payer;
  person: Person;
  rechnung: Invoice;
  quoteProzent: number;
  berechnet: number;
  selbstbehalt: number;
  bre: boolean;
  status?: ReturnType<typeof traegerInfo>;
  onChange: (teil: Partial<Invoice>) => void;
  onEinreichung: (id: string) => void;
}) {
  const nicht = rechnung.heldBack.includes(kt);
  const manuell = rechnung.expectedOverride[kt];
  const e = status?.einreichung;
  const pos = e?.items.find((p) => p.invoiceId === rechnung.id);
  const { dateiOeffnen } = useStore();
  const bescheidVom = pos && !pos.pending && e?.status === 'decided' ? (pos.decisionDate ?? e.decisionDate) : undefined;
  return (
    <div className="traeger">
      <div className="traeger-kopf">
        <strong>{ktName(kt, person)}</strong>
        {status && <StatusBadge info={status} mitBetrag />}
      </div>
      {e && (
        <small>
          <button type="button" className="link" onClick={() => onEinreichung(e.id)}>
            Eingereicht am {datum(e.submittedDate)} per {WEG_NAME[e.channel]}{e.reference && ` (${e.reference})`}
          </button>
          {bescheidVom && ` · Bescheid vom ${datum(bescheidVom)}`}
          {bescheidVom && pos?.fileId && (
            <> <button type="button" className="link" title="Abrechnung öffnen" onClick={() => dateiOeffnen(pos.fileId!)}>📎</button></>
          )}
          {pos?.pending && ' · im Bescheid noch offen'}
        </small>
      )}
      {!e && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={nicht}
            onChange={(ev) =>
              onChange({ heldBack: ev.target.checked ? [...rechnung.heldBack, kt] : rechnung.heldBack.filter((x) => x !== kt) })
            }
          />
          {bre ? 'Zurückhalten für Beitragsrückerstattung' : `Nicht bei ${ktKurz(kt, person)} einreichen`}
        </label>
      )}
      {!nicht && (
        <div className="zeile">
          <span className="grau">Erwartete Erstattung:</span>
          <BetragFeld
            wert={manuell}
            placeholder={`${(berechnet / 100).toFixed(2).replace('.', ',')}`}
            onChange={(c) => {
              const neu = { ...rechnung.expectedOverride };
              if (c == null) delete neu[kt];
              else neu[kt] = c;
              onChange({ expectedOverride: neu });
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


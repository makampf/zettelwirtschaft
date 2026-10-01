import { useEffect, useMemo, useState } from 'react';
import { breCheck, breRelevant, einreichbareRechnungen, erwartetFuerRechnung, traegerFuer, versicherungFuer, zurueckgehalteneRechnungen, zustaendigeStellen } from '../calc';
import { BetragFeld, DateiFeld, Feld, Leer, Modal, PersonChip, useDateienSpeichern } from '../components/ui';
import { datum, euro, heute, neueId } from '../format';
import { einreichungenFuerAbrechnung } from '../eingang';
import { useNav } from '../nav';
import { abgerechnet, abrechnungAuslesen, abrechnungZuordnen, positionenAusAbrechnung, type AbrechnungsZeile } from '../recognition/statement';
import { textAusDatei } from '../recognition/text';
import { useStore } from '../store';
import {
  ART_NAME,
  KOSTENTRAEGER,
  KT_NAME,
  ktKurz,
  ktName,
  WEG_NAME,
  type Submission,
  type SubmissionChannel,
  type SubmissionItem,
  type Payer,
  type Person,
  type Invoice,
} from '../types';

type Ansicht =
  | { typ: 'bearbeiten'; e?: Submission; personId?: string; kt?: Payer }
  | { typ: 'bescheid'; e: Submission; beleg?: File; text?: string }
  | { typ: 'druck'; e: Submission };

export default function Submissions() {
  const { state, personById } = useStore();
  const nav = useNav();
  const [statusFilter, setStatusFilter] = useState<'' | 'submitted' | 'decided'>('');
  const [ktFilter, setKtFilter] = useState<Payer | ''>('');
  const [ansicht, setAnsicht] = useState<Ansicht | null>(null);
  const [einlesen, setEinlesen] = useState<{ art: 'laeuft' | 'leer' | 'fehler'; text: string } | null>(null);

  /** Leistungsabrechnung/Bescheid einlesen und die passende Einreichung (meiste Treffer) zum Erfassen öffnen. */
  async function abrechnungEinlesen(datei: File) {
    setEinlesen({ art: 'laeuft', text: 'Abrechnung wird ausgelesen …' });
    try {
      const text = await textAusDatei(datei, (t) => setEinlesen({ art: 'laeuft', text: t }));
      const beste = einreichungenFuerAbrechnung(abrechnungAuslesen(text), state)[0];
      if (!beste) {
        setEinlesen({ art: 'leer', text: 'Keine Einreichung enthält Rechnungen aus dieser Abrechnung (Rechnungsdatum und Betrag müssen passen).' });
        return;
      }
      setEinlesen(null);
      setAnsicht({ typ: 'bescheid', e: beste.e, beleg: datei, text });
    } catch (err) {
      setEinlesen({ art: 'fehler', text: `Abrechnung konnte nicht ausgelesen werden: ${err instanceof Error ? err.message : err}` });
    }
  }

  useEffect(() => {
    const z = nav.ziel;
    if (!z) return;
    if (z.neu) setAnsicht({ typ: 'bearbeiten', personId: z.personId, kt: z.kt });
    const e = state.submissions.find((x) => x.id === z.einreichungId);
    // Automatisch übernommene Bescheide direkt zum Prüfen öffnen
    if (e) setAnsicht(e.toReview ? { typ: 'bescheid', e } : { typ: 'bearbeiten', e });
    nav.zielErledigt();
  }, [nav, state.submissions]);

  const rechnungen = useMemo(() => new Map(state.invoices.map((r) => [r.id, r])), [state.invoices]);

  const zeilen = state.submissions
    .filter((e) => !nav.personFilter || e.personIds.includes(nav.personFilter))
    .filter((e) => !statusFilter || e.status === statusFilter)
    .filter((e) => !ktFilter || e.payer === ktFilter)
    .sort((a, b) => b.submittedDate.localeCompare(a.submittedDate))
    .map((e) => {
      const personen = e.personIds.map(personById).filter((p): p is Person => !!p);
      let summe = 0;
      let erw = 0;
      let erst = 0;
      for (const p of e.items) {
        const r = rechnungen.get(p.invoiceId);
        if (!r) continue;
        summe += r.amount;
        erw += erwartetFuerRechnung(state, r, e.payer);
        erst += p.reimbursed ?? 0;
      }
      return { e, personen, summe, erw, erst };
    });

  return (
    <section>
      <div className="seitenkopf">
        <h1>Einreichungen</h1>
        <div className="zeile">
          <label className="button" title="PDF oder Foto einer Leistungsabrechnung bzw. eines Bescheids – Erstattungen werden der passenden Einreichung zugeordnet">
            📄 Abrechnung einlesen
            <input
              type="file"
              accept="application/pdf,image/*"
              hidden
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = '';
                if (f) void abrechnungEinlesen(f);
              }}
            />
          </label>
          <button className="primaer" onClick={() => setAnsicht({ typ: 'bearbeiten', personId: nav.personFilter || undefined })}>+ Neue Einreichung</button>
        </div>
      </div>
      {einlesen && (
        <div className={`lesestatus ${einlesen.art}`} role="status">
          {einlesen.art === 'laeuft' ? '⏳ ' : einlesen.art === 'fehler' ? '⚠️ ' : 'ℹ️ '}{einlesen.text}
        </div>
      )}
      <div className="filterleiste">
        <div className="segmente">
          <button className={statusFilter === '' ? 'aktiv' : ''} onClick={() => setStatusFilter('')}>Alle</button>
          <button className={statusFilter === 'submitted' ? 'aktiv' : ''} onClick={() => setStatusFilter('submitted')}>Warten auf Bescheid</button>
          <button className={statusFilter === 'decided' ? 'aktiv' : ''} onClick={() => setStatusFilter('decided')}>Beschieden</button>
        </div>
        <select value={ktFilter} onChange={(e) => setKtFilter(e.target.value as Payer | '')} aria-label="Kostenträger">
          <option value="">Alle Stellen</option>
          {KOSTENTRAEGER.map((k) => <option key={k} value={k}>{KT_NAME[k]}</option>)}
        </select>
      </div>

      {zeilen.length === 0 ? (
        <Leer>Noch keine Einreichungen. Lege eine an, sobald du Rechnungen an Beihilfe oder Versicherung geschickt hast.</Leer>
      ) : (
        <div className="tabelle-wrap">
          <table className="tabelle">
            <thead>
              <tr>
                <th>Eingereicht</th>
                <th>Person</th>
                <th>Stelle</th>
                <th>Referenz</th>
                <th className="zahl">Belege</th>
                <th className="zahl">Rechnungssumme</th>
                <th className="zahl">Erwartet</th>
                <th className="zahl">Erstattet</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {zeilen.map(({ e, personen, summe, erw, erst }) => (
                <tr key={e.id}>
                  <td>{datum(e.submittedDate)}<br /><small className="grau">{WEG_NAME[e.channel]}</small></td>
                  <td><div className="chips">{personen.map((p) => <PersonChip key={p.id} person={p} />)}</div></td>
                  <td>{ktKurz(e.payer, personen[0])}</td>
                  <td>{e.reference || '–'}{e.fileIds.length > 0 && ' 📎'}</td>
                  <td className="zahl">{e.items.length}</td>
                  <td className="zahl">{euro(summe)}</td>
                  <td className="zahl">{euro(erw)}</td>
                  <td className="zahl">
                    {e.status === 'decided' ? (
                      <>
                        {euro(erst)}
                        {erst !== erw && <><br /><small className={erst < erw ? 'rot' : 'ok'}>{erst < erw ? '−' : '+'}{euro(Math.abs(erst - erw))}</small></>}
                      </>
                    ) : '–'}
                  </td>
                  <td>
                    {e.status === 'decided' && e.items.some((p) => p.pending) ? (
                      <span className="badge status-eingereicht" title={`Letzter Bescheid ${datum(e.decisionDate)}`}>
                        teilweise beschieden · {e.items.filter((p) => p.pending).length} offen
                      </span>
                    ) : e.status === 'decided' ? (
                      <span className="badge status-erstattet">Bescheid {datum(e.decisionDate)}</span>
                    ) : (
                      <span className="badge status-eingereicht">wartet seit {Math.max(0, Math.round((Date.now() - new Date(e.submittedDate).getTime()) / 86_400_000))} Tagen</span>
                    )}
                  </td>
                  <td className="knoepfe">
                    <button className="klein" onClick={() => setAnsicht({ typ: 'bearbeiten', e })}>Bearbeiten</button>
                    <button className="klein primaer" onClick={() => setAnsicht({ typ: 'bescheid', e })}>{e.status === 'decided' ? 'Bescheid' : 'Bescheid erfassen'}</button>
                    <button className="klein" onClick={() => setAnsicht({ typ: 'druck', e })} title="Belegliste drucken">🖨</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ansicht?.typ === 'bearbeiten' && (
        <EinreichungFormular einreichung={ansicht.e} personId={ansicht.personId} kt={ansicht.kt} onClose={() => setAnsicht(null)} />
      )}
      {ansicht?.typ === 'bescheid' && <BescheidFormular einreichung={ansicht.e} beleg={ansicht.beleg} text={ansicht.text} onClose={() => setAnsicht(null)} />}
      {ansicht?.typ === 'druck' && <Belegliste einreichung={ansicht.e} onClose={() => setAnsicht(null)} />}
    </section>
  );
}

function EinreichungFormular({ einreichung, personId, kt, onClose }: { einreichung?: Submission; personId?: string; kt?: Payer; onClose: () => void }) {
  const { state, personById, speichereEinreichung, speichereRechnung, loescheEinreichung } = useStore();
  const dateienSpeichern = useDateienSpeichern();
  const [e, setE] = useState<Submission>(() => {
    if (einreichung) return einreichung;
    const personIds = startPersonen(state.people, personId);
    const stellen = zustaendigeStellen(personIds.map(personById).filter((p): p is Person => !!p));
    // Vorauswahl: gewünschte Stelle, sonst die erste zuständige mit offenen Rechnungen
    const mitOffenen = stellen.find((k) => personIds.some((id) => einreichbareRechnungen(state, id, k).length > 0));
    return {
        id: neueId(),
        personIds,
        payer: kt && stellen.includes(kt) ? kt : (mitOffenen ?? stellen[0] ?? 'pkv'),
        submittedDate: heute(),
        channel: 'app',
        reference: '',
        status: 'submitted',
        items: [],
        fileIds: [],
        note: '',
    };
  });
  const [dateiIds, setDateiIds] = useState(e.fileIds);
  const [neueDateien, setNeueDateien] = useState<File[]>([]);
  const set = <K extends keyof Submission>(k: K, v: Submission[K]) => setE((x) => ({ ...x, [k]: v }));
  const person = personById(e.personIds[0]);

  const personen = e.personIds.map(personById).filter((p): p is Person => !!p);
  const stellen = zustaendigeStellen(personen);
  // Offene und – zum Freigeben – zurückgehaltene Rechnungen (z. B. wenn sich die BRE nicht mehr lohnt)
  const zurueckgehalten = useMemo(
    () => new Set(e.personIds.flatMap((id) => zurueckgehalteneRechnungen(state, id, e.payer, e.id)).map((r) => r.id)),
    [state, e.personIds, e.payer, e.id],
  );
  const kandidaten = useMemo(
    () =>
      e.personIds
        .flatMap((id) => [...einreichbareRechnungen(state, id, e.payer, e.id), ...zurueckgehalteneRechnungen(state, id, e.payer, e.id)])
        .sort((a, b) => a.date.localeCompare(b.date)),
    [state, e.personIds, e.payer, e.id],
  );
  const offene = kandidaten.filter((r) => !zurueckgehalten.has(r.id));
  // Personen geändert: nicht zuständige Stelle (z. B. Beihilfe ohne Berechtigung) ersetzen
  useEffect(() => {
    if (!einreichung && stellen.length && !stellen.includes(e.payer)) setE((x) => ({ ...x, payer: stellen[0] }));
  }, [einreichung, stellen, e.payer]);
  const mehrerePersonen = e.personIds.length > 1;
  const gewaehlt = new Set(e.items.map((p) => p.invoiceId));

  // Neue Einreichung: standardmäßig alle offenen Rechnungen auswählen
  const [vorbelegt, setVorbelegt] = useState(!!einreichung);
  useEffect(() => {
    if (vorbelegt) return;
    setE((x) => ({ ...x, items: offene.map((r) => ({ invoiceId: r.id })) }));
    setVorbelegt(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kandidaten, vorbelegt]);

  // Für die Rückfrage beim Schließen
  const [angefasst, setAngefasst] = useState(false);
  const geaendert = angefasst || neueDateien.length > 0 || dateiIds.join() !== (einreichung?.fileIds ?? []).join();

  function umschalten(id: string) {
    setAngefasst(true);
    setE((x) => ({
      ...x,
      items: gewaehlt.has(id) ? x.items.filter((p) => p.invoiceId !== id) : [...x.items, { invoiceId: id }],
    }));
  }

  // Welche Jahre verlieren durch diese PKV-Einreichung ihre Beitragsrückerstattung?
  const breVerlust = useMemo(() => {
    if (e.payer === 'beihilfe') return [];
    const ohneDiese = { invoices: state.invoices, submissions: state.submissions.filter((x) => x.id !== e.id) };
    const betroffen = new Map<string, Person>();
    for (const r of kandidaten) {
      const p = personById(r.personId);
      if (!p || !gewaehlt.has(r.id) || versicherungFuer(r.kind, p) !== e.payer || !breRelevant(r, p)) continue;
      betroffen.set(`${p.id}|${r.date.slice(0, 4)}`, p);
    }
    return [...betroffen]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, p]) => breCheck(ohneDiese, p, Number(k.split('|')[1])))
      .filter((c) => c != null && c.eingereicht.length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.payer, e.id, e.items, person, state, kandidaten]);

  const summe = kandidaten.filter((r) => gewaehlt.has(r.id)).reduce((s, r) => s + r.amount, 0);
  const erw = kandidaten.filter((r) => gewaehlt.has(r.id)).reduce((s, r) => s + erwartetFuerRechnung(state, r, e.payer), 0);

  return (
    <Modal titel={einreichung ? 'Einreichung bearbeiten' : 'Neue Einreichung'} onClose={onClose} breit geaendert={geaendert}>
      <form
        onChangeCapture={() => setAngefasst(true)}
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (!e.items.length) return alert('Bitte mindestens eine Rechnung auswählen.');
          const ids = await dateienSpeichern(einreichung?.fileIds ?? [], dateiIds, neueDateien);
          // Ausgewählte zurückgehaltene Rechnungen werden damit freigegeben
          for (const r of kandidaten) {
            if (gewaehlt.has(r.id) && zurueckgehalten.has(r.id)) speichereRechnung({ ...r, heldBack: r.heldBack.filter((k) => k !== e.payer) });
          }
          speichereEinreichung({ ...e, fileIds: ids });
          onClose();
        }}
      >
        <div className="raster">
          <Feld label="Personen" gruppe hinweis="Gemeinsam Versicherte können zusammen eingereicht werden">
            <div className="zeile">
              {state.people.map((p) => (
                <label key={p.id} className="checkbox">
                  <input
                    type="checkbox"
                    checked={e.personIds.includes(p.id)}
                    onChange={(ev) => {
                      const ids = ev.target.checked ? [...e.personIds, p.id] : e.personIds.filter((x) => x !== p.id);
                      if (!ids.length) return;
                      setE((x) => ({
                        ...x,
                        personIds: ids,
                        items: x.items.filter((pos) => ids.includes(state.invoices.find((r) => r.id === pos.invoiceId)?.personId ?? '')),
                      }));
                      if (!einreichung) setVorbelegt(false);
                    }}
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </Feld>
          <Feld label="Eingereicht bei">
            <select value={e.payer} disabled={!!einreichung} onChange={(ev) => { set('payer', ev.target.value as Payer); setVorbelegt(false); }}>
              {KOSTENTRAEGER.filter((k) => k === e.payer || stellen.includes(k)).map((k) => (
                <option key={k} value={k}>{ktName(k, person)}{person && traegerName(person, k)}</option>
              ))}
            </select>
          </Feld>
          <Feld label="Eingereicht am">
            <input type="date" value={e.submittedDate} onChange={(ev) => set('submittedDate', ev.target.value)} required />
          </Feld>
          <Feld label="Weg">
            <select value={e.channel} onChange={(ev) => set('channel', ev.target.value as SubmissionChannel)}>
              {(Object.keys(WEG_NAME) as SubmissionChannel[]).map((w) => <option key={w} value={w}>{WEG_NAME[w]}</option>)}
            </select>
          </Feld>
          <Feld label="Antrags-/Vorgangsnummer" breit>
            <input value={e.reference} onChange={(ev) => set('reference', ev.target.value)} />
          </Feld>
        </div>

        <fieldset>
          <legend>Enthaltene Rechnungen</legend>
          {kandidaten.length === 0 ? (
            <Leer>Keine offenen Rechnungen für {e.personIds.map((id) => personById(id)?.name).join(' und ')} bei {ktKurz(e.payer, person)}.</Leer>
          ) : (
            <div className="tabelle-wrap">
              <table className="tabelle kompakt">
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Alle auswählen"
                        checked={offene.length > 0 && offene.every((r) => gewaehlt.has(r.id))}
                        onChange={(ev) => setE((x) => ({ ...x, items: ev.target.checked ? offene.map((r) => x.items.find((p) => p.invoiceId === r.id) ?? { invoiceId: r.id }) : [] }))}
                      />
                    </th>
                    <th>Datum</th>
                    {mehrerePersonen && <th>Person</th>}
                    <th>Leistungserbringer</th>
                    <th>Art</th>
                    <th className="zahl">Betrag</th>
                    <th className="zahl">Erwartet</th>
                  </tr>
                </thead>
                <tbody>
                  {kandidaten.map((r) => (
                    <tr key={r.id} onClick={() => umschalten(r.id)} className="klickbar-zeile">
                      <td><input type="checkbox" checked={gewaehlt.has(r.id)} onChange={() => umschalten(r.id)} onClick={(ev) => ev.stopPropagation()} /></td>
                      <td>{datum(r.date)}</td>
                      {mehrerePersonen && <td><PersonChip person={personById(r.personId)} /></td>}
                      <td>
                        {r.provider}{r.description && <small className="grau"> · {r.description}</small>}
                        {zurueckgehalten.has(r.id) && <> <span className="badge status-nicht_einreichen">zurückgehalten</span></>}
                      </td>
                      <td>{ART_NAME[r.kind]}</td>
                      <td className="zahl">{euro(r.amount)}</td>
                      <td className="zahl">{euro(erwartetFuerRechnung(state, r, e.payer))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={mehrerePersonen ? 5 : 4}>{e.items.length} ausgewählt</td>
                    <td className="zahl">{euro(summe)}</td>
                    <td className="zahl">{euro(erw)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {zurueckgehalten.size > 0 && (
            <small className="grau">Zurückgehaltene Rechnungen (z. B. für die Beitragsrückerstattung) werden durch Auswählen freigegeben und mit eingereicht.</small>
          )}
          {e.status === 'decided' && <small className="grau">Hinweis: Für diese Einreichung ist bereits ein Bescheid erfasst.</small>}
          {breVerlust.map((c) => c && (
            <div key={c.jahr} className="hinweis warnung">
              ⚠️ Damit entfällt die Beitragsrückerstattung {c.jahr} für {personById(c.personId)?.name} ({c.bre ? euro(c.bre) : 'Betrag unbekannt'}).
              {c.empfehlung === 'zurueckhalten' && ` Erwartete Erstattung aller Rechnungen ${c.jahr}: nur ${euro(c.erstattungBeiEinreichung)}.`}
            </div>
          ))}
        </fieldset>

        <Feld label="Antrag / Kopien" gruppe breit>
          <DateiFeld vorhandene={dateiIds} onVorhandene={setDateiIds} neue={neueDateien} onNeue={setNeueDateien} />
        </Feld>
        <Feld label="Notiz" breit>
          <textarea rows={2} value={e.note} onChange={(ev) => set('note', ev.target.value)} />
        </Feld>

        <div className="aktionen">
          {einreichung && (
            <button
              type="button"
              className="gefahr"
              onClick={async () => {
                if (confirm('Einreichung löschen? Die Rechnungen bleiben erhalten und gelten wieder als „noch einzureichen“.')) {
                  await loescheEinreichung(einreichung.id);
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

/** Vorauswahl der Personen einer neuen Einreichung: gewählte Person plus gemeinsam versicherter Partner. */
function startPersonen(personen: Person[], personId?: string): string[] {
  const p = personen.find((x) => x.id === personId) ?? personen[0];
  if (!p) return [];
  return p.partnerId && personen.some((x) => x.id === p.partnerId) ? [p.id, p.partnerId] : [p.id];
}

function nummerBei(p: Person, kt: Payer): string {
  return kt === 'beihilfe' ? p.beihilfe.reference : kt === 'pkv' ? p.pkv.number : p.ppv.number;
}

function namen(personen: (Person | undefined)[]): string {
  return personen.filter(Boolean).map((p) => p!.name).join(' und ');
}

function traegerName(p: Person, kt: Payer): string {
  const n = kt === 'beihilfe' ? p.beihilfe.office : kt === 'pkv' ? [p.pkv.name, p.pkv.tariff].filter(Boolean).join(', ') : [p.ppv.name, p.ppv.tariff].filter(Boolean).join(', ');
  return n ? ` (${n})` : '';
}

export function BescheidFormular({
  einreichung,
  beleg,
  text,
  onClose,
  onGespeichert,
}: {
  einreichung: Submission;
  beleg?: File;
  text?: string;
  onClose: () => void;
  onGespeichert?: () => void;
}) {
  const { state, personById, speichereEinreichung, dateiOeffnen } = useStore();
  const dateienSpeichern = useDateienSpeichern();
  const personen = einreichung.personIds.map(personById);
  const [e, setE] = useState(einreichung);
  const [dateiIds, setDateiIds] = useState(e.fileIds);
  const [neueDateien, setNeueDateien] = useState<File[]>(beleg ? [beleg] : []);
  const rechnungen = e.items.map((p) => ({ p, r: state.invoices.find((r) => r.id === p.invoiceId) })).filter((x): x is { p: typeof x.p; r: Invoice } => !!x.r);
  const [leseStatus, setLeseStatus] = useState<{ art: 'laeuft' | 'ok' | 'leer' | 'fehler'; text: string; offen?: AbrechnungsZeile[] } | null>(null);
  const [aus, setAus] = useState<Set<string>>(new Set());
  const [unsicher, setUnsicher] = useState<Set<string>>(new Set());
  // Aus welcher (neu hinzugefügten) Abrechnung stammt die Erstattung einer Rechnung?
  const [quelle, setQuelle] = useState<Map<string, File>>(new Map());
  // Für die Rückfrage beim Schließen
  const [angefasst, setAngefasst] = useState(false);
  const geaendert = angefasst || neueDateien.length > 0 || dateiIds.join() !== einreichung.fileIds.join();

  const setPos = (id: string, teil: Partial<SubmissionItem>) => {
    setAus((a) => { const n = new Set(a); n.delete(id); return n; });
    setUnsicher((a) => { const n = new Set(a); n.delete(id); return n; });
    setE((x) => ({ ...x, items: x.items.map((p) => (p.invoiceId === id ? { ...p, ...teil } : p)) }));
  };

  /** Liest eine Leistungsabrechnung / einen Bescheid und füllt Erstattungen und Datum vor. */
  async function auslesen(datei: File, gelesen?: string) {
    setLeseStatus({ art: 'laeuft', text: 'Abrechnung wird ausgelesen …' });
    try {
      const a = abrechnungAuslesen(gelesen ?? (await textAusDatei(datei, (t) => setLeseStatus({ art: 'laeuft', text: t }))));
      const { zuordnungen, offen } = abrechnungZuordnen(a, rechnungen.map((x) => x.r), e.items);
      const unsicher = zuordnungen.filter((z) => z.unsicher).length;
      setE((x) => ({
        ...x,
        // Bescheiddatum der Einreichung = jüngste Abrechnung
        decisionDate: a.date && (!x.decisionDate || a.date > x.decisionDate) ? a.date : x.decisionDate,
        items: positionenAusAbrechnung(x.items, zuordnungen, a.date),
      }));
      setAus(new Set(zuordnungen.map((z) => z.invoiceId)));
      setUnsicher(new Set(zuordnungen.filter((z) => z.unsicher).map((z) => z.invoiceId)));
      setQuelle((q) => {
        const n = new Map(q);
        for (const z of zuordnungen) if (!z.pending) n.set(z.invoiceId, datei);
        return n;
      });
      if (!neueDateien.includes(datei)) setNeueDateien((n) => [...n, datei]);
      const pending = zuordnungen.filter((z) => z.pending).length;
      const zugeordnet = new Set(zuordnungen.map((z) => z.invoiceId));
      const fehlend = e.items.filter((p) => !zugeordnet.has(p.invoiceId) && !abgerechnet(p)).length;
      const frueher = e.items.filter((p) => !zugeordnet.has(p.invoiceId) && abgerechnet(p)).length;
      const erstattet = zuordnungen.reduce((s, z) => s + (z.reimbursed ?? 0), 0);
      const teile = [
        `${zuordnungen.length} von ${rechnungen.length} Rechnung(en) zugeordnet`,
        pending && `${pending} noch offen`,
        unsicher && `${unsicher} nur über den Betrag zugeordnet (Datum weicht ab) – bitte prüfen`,
        fehlend > 0 && `${fehlend} nicht in der Abrechnung – als „noch offen“ markiert`,
        frueher > 0 && `${frueher} bereits früher abgerechnet – unverändert`,
        a.total != null && (a.total === erstattet ? `Gesamtsumme ${euro(a.total)} stimmt überein` : `Gesamtsumme laut Abrechnung ${euro(a.total)}, zugeordnet ${euro(erstattet)} – bitte prüfen`),
      ].filter(Boolean);
      setLeseStatus(
        zuordnungen.length
          ? { art: 'ok', text: `${teile.join(' · ')}.`, offen }
          : { art: 'leer', text: 'Keine Position der Abrechnung passt zu den Rechnungen dieser Einreichung.', offen },
      );
    } catch (err) {
      setLeseStatus({ art: 'fehler', text: `Abrechnung konnte nicht ausgelesen werden: ${err instanceof Error ? err.message : err}` });
    }
  }

  // Mit Beleg geöffnet (z. B. über „Abrechnung einlesen“): sofort auslesen
  useEffect(() => {
    if (beleg) void auslesen(beleg, text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summe = e.items.reduce((s, p) => s + (p.reimbursed ?? 0), 0);
  // Noch offene Positionen zählen nicht zur erwarteten Summe dieses Bescheids
  const erw = rechnungen.filter(({ p }) => !p.pending).reduce((s, { r }) => s + erwartetFuerRechnung(state, r, e.payer), 0);

  return (
    <Modal titel={`Bescheid – ${ktName(e.payer, personen[0])} – ${namen(personen)}`} onClose={onClose} breit geaendert={geaendert}>
      <form
        onChangeCapture={() => setAngefasst(true)}
        onSubmit={async (ev) => {
          ev.preventDefault();
          const ids = await dateienSpeichern(einreichung.fileIds, dateiIds, neueDateien);
          const neuIds = ids.slice(ids.length - neueDateien.length);
          const datum = e.decisionDate || heute();
          const items = e.items.map((p) => {
            const f = quelle.get(p.invoiceId);
            const fileId = f && neueDateien.includes(f) ? neuIds[neueDateien.indexOf(f)] : p.fileId && ids.includes(p.fileId) ? p.fileId : undefined;
            // Abgerechnete Positionen behalten ihr eigenes Bescheiddatum; neu erfasste bekommen das des Formulars
            return p.pending ? { ...p, decisionDate: undefined, fileId: undefined } : { ...p, decisionDate: p.decisionDate ?? datum, fileId };
          });
          speichereEinreichung({ ...e, items, status: 'decided', decisionDate: datum, fileIds: ids, toReview: undefined });
          onGespeichert?.();
          onClose();
        }}
      >
        <div className="raster">
          <Feld label="Bescheid vom" hinweis="Jüngster Bescheid – je Rechnung siehe Tabelle">
            <input type="date" value={e.decisionDate ?? heute()} onChange={(ev) => setE({ ...e, decisionDate: ev.target.value })} required />
          </Feld>
          <Feld label="Gutschrift auf Konto am">
            <input type="date" value={e.paymentDate ?? ''} onChange={(ev) => setE({ ...e, paymentDate: ev.target.value || undefined })} />
          </Feld>
        </div>

        <div className="zeile rechts">
          <label className="button klein" title="PDF oder Foto der Leistungsabrechnung bzw. des Bescheids – Erstattungen werden den Rechnungen zugeordnet">
            📄 Abrechnung auslesen
            <input
              type="file"
              accept="application/pdf,image/*"
              hidden
              onChange={(ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = '';
                if (f) void auslesen(f);
              }}
            />
          </label>
          <button
            type="button"
            className="klein"
            title="Leere Beträge mit der erwarteten Erstattung füllen – eingetragene Beträge und „noch offen“ bleiben unverändert"
            onClick={() => {
              setAngefasst(true);
              setE((x) => ({
                ...x,
                items: x.items.map((p) => {
                  const r = rechnungen.find((y) => y.r.id === p.invoiceId)?.r;
                  return r && p.reimbursed == null && !p.pending ? { ...p, reimbursed: erwartetFuerRechnung(state, r, x.payer) } : p;
                }),
              }));
            }}
          >
            Leere wie erwartet ausfüllen
          </button>
        </div>

        {leseStatus && (
          <div className={`lesestatus ${leseStatus.art}`} role="status">
            {leseStatus.art === 'laeuft' ? '⏳ ' : leseStatus.art === 'ok' ? '✓ ' : leseStatus.art === 'fehler' ? '⚠️ ' : 'ℹ️ '}
            {leseStatus.text}
            {!!leseStatus.offen?.length && (
              <details>
                <summary>{leseStatus.offen.length} Position(en) der Abrechnung ohne passende Rechnung</summary>
                <ul>{leseStatus.offen.map((z, i) => <li key={i}>{datum(z.date)} · {z.amounts.map(euro).join(' / ')}{z.pending && ' · noch offen'}</li>)}</ul>
              </details>
            )}
          </div>
        )}

        <div className="tabelle-wrap">
          <table className="tabelle kompakt">
            <thead>
              <tr>
                <th>Rechnung</th>
                <th className="zahl">Betrag</th>
                <th className="zahl">Erwartet</th>
                <th>Erstattet</th>
                <th title="Im Bescheid noch nicht abgerechnet">Noch offen</th>
                <th>Bescheid vom</th>
                <th>Bemerkung (z. B. Kürzungsgrund)</th>
              </tr>
            </thead>
            <tbody>
              {rechnungen.map(({ p, r }) => (
                <tr key={r.id} className={aus.has(r.id) ? 'erkannt' : ''}>
                  <td>
                    {datum(r.date)} · {r.provider}{personen.length > 1 && <> · {personById(r.personId)?.name}</>}
                    {unsicher.has(r.id) && <><br /><small className="rot">⚠️ nur über den Betrag zugeordnet – bitte prüfen</small></>}
                  </td>
                  <td className="zahl">{euro(r.amount)}</td>
                  <td className="zahl">{euro(erwartetFuerRechnung(state, r, e.payer))}</td>
                  <td>{!p.pending && <BetragFeld wert={p.reimbursed} onChange={(c) => setPos(r.id, { reimbursed: c })} />}</td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label="Noch offen"
                      checked={!!p.pending}
                      onChange={(ev) => setPos(r.id, { pending: ev.target.checked || undefined, reimbursed: ev.target.checked ? undefined : p.reimbursed })}
                    />
                  </td>
                  <td className="nowrap">
                    {p.pending ? '–' : datum(p.decisionDate ?? e.decisionDate)}
                    {!p.pending && p.fileId && !quelle.has(r.id) && (
                      <> <button type="button" className="link" title="Abrechnung öffnen" onClick={() => dateiOeffnen(p.fileId!)}>📎</button></>
                    )}
                  </td>
                  <td><input value={p.remark ?? ''} onChange={(ev) => setPos(r.id, { remark: ev.target.value })} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Summe</td>
                <td className="zahl">{euro(rechnungen.reduce((s, { r }) => s + r.amount, 0))}</td>
                <td className="zahl">{euro(erw)}</td>
                <td className="zahl">{euro(summe)}</td>
                <td></td>
                <td></td>
                <td>{summe !== erw && <span className={summe < erw ? 'rot' : 'ok'}>Abweichung {euro(summe - erw)}</span>}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <small className="grau">
          Leere Beträge gelten als 0 € (abgelehnt) und können erneut eingereicht werden. „Noch offen“: im Bescheid noch nicht abgerechnet – die Rechnung bleibt eingereicht.
        </small>

        <Feld label="Bescheid (PDF / Foto)" gruppe breit>
          <DateiFeld vorhandene={dateiIds} onVorhandene={setDateiIds} neue={neueDateien} onNeue={setNeueDateien} />
        </Feld>

        <div className="aktionen">
          {einreichung.status === 'decided' && (
            <button
              type="button"
              onClick={() => {
                speichereEinreichung({ ...einreichung, status: 'submitted', decisionDate: undefined, paymentDate: undefined, items: einreichung.items.map((p) => ({ invoiceId: p.invoiceId })) });
                onClose();
              }}
            >
              Bescheid zurücksetzen
            </button>
          )}
          <span className="abstand" />
          <button type="button" onClick={onClose}>Abbrechen</button>
          <button type="submit" className="primaer">Bescheid speichern</button>
        </div>
      </form>
    </Modal>
  );
}

function Belegliste({ einreichung: e, onClose }: { einreichung: Submission; onClose: () => void }) {
  const { state, personById } = useStore();
  const personen = e.personIds.map(personById).filter((p): p is Person => !!p);
  const mehrere = personen.length > 1;
  const rs = e.items.map((p) => state.invoices.find((r) => r.id === p.invoiceId)).filter((r): r is Invoice => !!r).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Modal titel="Belegliste" onClose={onClose} breit>
      <div className="druck">
        <h2>Belegaufstellung – {ktName(e.payer, personen[0])}</h2>
        <p>
          {personen.map((p) => (
            <span key={p.id}>
              <strong>{p.name}</strong>
              {traegerName(p, e.payer)}
              {nummerBei(p, e.payer) && <> · {e.payer === 'beihilfe' ? 'Aktenzeichen' : 'Versicherungsnummer'} {nummerBei(p, e.payer)}</>}
              <br />
            </span>
          ))}
          Eingereicht am {datum(e.submittedDate)}{e.reference && ` · Vorgang ${e.reference}`}
        </p>
        <table className="tabelle kompakt">
          <thead>
            <tr>
              <th>Nr.</th>
              <th>Rechnungsdatum</th>
              {mehrere && <th>Person</th>}
              <th>Leistungserbringer</th>
              <th>Rechnungs-Nr.</th>
              <th>Art</th>
              <th className="zahl">Betrag</th>
            </tr>
          </thead>
          <tbody>
            {rs.map((r, i) => (
              <tr key={r.id}>
                <td>{i + 1}</td>
                <td>{datum(r.date)}</td>
                {mehrere && <td>{personById(r.personId)?.name}</td>}
                <td>{r.provider}{r.description && ` – ${r.description}`}</td>
                <td>{r.invoiceNumber}</td>
                <td>{ART_NAME[r.kind]}</td>
                <td className="zahl">{euro(r.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={mehrere ? 6 : 5}>Summe ({rs.length} Belege)</td>
              <td className="zahl">{euro(rs.reduce((s, r) => s + r.amount, 0))}</td>
            </tr>
          </tfoot>
        </table>
        {rs.some((r) => { const p = personById(r.personId); return !p || !traegerFuer(r.kind, p).includes(e.payer); }) && <p className="rot">Achtung: enthält Rechnungen, die nicht zu diesem Kostenträger passen.</p>}
      </div>
      <div className="aktionen">
        <span className="abstand" />
        <button type="button" onClick={onClose}>Schließen</button>
        <button type="button" className="primaer" onClick={() => window.print()}>Drucken</button>
      </div>
    </Modal>
  );
}

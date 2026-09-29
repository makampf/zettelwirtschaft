import { useEffect, useMemo, useState } from 'react';
import { breCheck, breRelevant, einreichbareRechnungen, erwartetFuerRechnung, traegerFuer, versicherungFuer } from '../calc';
import { BetragFeld, DateiFeld, Feld, Leer, Modal, PersonChip, useDateienSpeichern } from '../components/ui';
import { datum, euro, heute, neueId } from '../format';
import { useNav } from '../nav';
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
  type Payer,
  type Person,
  type Invoice,
} from '../types';

type Ansicht = { typ: 'bearbeiten'; e?: Submission; personId?: string; kt?: Payer } | { typ: 'bescheid'; e: Submission } | { typ: 'druck'; e: Submission };

export default function Submissions() {
  const { state, personById } = useStore();
  const nav = useNav();
  const [statusFilter, setStatusFilter] = useState<'' | 'submitted' | 'decided'>('');
  const [ktFilter, setKtFilter] = useState<Payer | ''>('');
  const [ansicht, setAnsicht] = useState<Ansicht | null>(null);

  useEffect(() => {
    const z = nav.ziel;
    if (!z) return;
    if (z.neu) setAnsicht({ typ: 'bearbeiten', personId: z.personId, kt: z.kt });
    const e = state.submissions.find((x) => x.id === z.einreichungId);
    if (e) setAnsicht({ typ: 'bearbeiten', e });
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
        <button className="primaer" onClick={() => setAnsicht({ typ: 'bearbeiten', personId: nav.personFilter || undefined })}>+ Neue Einreichung</button>
      </div>
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
                    {e.status === 'decided' ? (
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
      {ansicht?.typ === 'bescheid' && <BescheidFormular einreichung={ansicht.e} onClose={() => setAnsicht(null)} />}
      {ansicht?.typ === 'druck' && <Belegliste einreichung={ansicht.e} onClose={() => setAnsicht(null)} />}
    </section>
  );
}

function EinreichungFormular({ einreichung, personId, kt, onClose }: { einreichung?: Submission; personId?: string; kt?: Payer; onClose: () => void }) {
  const { state, personById, speichereEinreichung, loescheEinreichung } = useStore();
  const dateienSpeichern = useDateienSpeichern();
  const [e, setE] = useState<Submission>(
    () =>
      einreichung ?? {
        id: neueId(),
        personIds: startPersonen(state.people, personId),
        payer: kt ?? 'beihilfe',
        submittedDate: heute(),
        channel: 'app',
        reference: '',
        status: 'submitted',
        items: [],
        fileIds: [],
        note: '',
      },
  );
  const [dateiIds, setDateiIds] = useState(e.fileIds);
  const [neueDateien, setNeueDateien] = useState<File[]>([]);
  const set = <K extends keyof Submission>(k: K, v: Submission[K]) => setE((x) => ({ ...x, [k]: v }));
  const person = personById(e.personIds[0]);

  const kandidaten = useMemo(
    () => e.personIds.flatMap((id) => einreichbareRechnungen(state, id, e.payer, e.id)).sort((a, b) => a.date.localeCompare(b.date)),
    [state, e.personIds, e.payer, e.id],
  );
  const mehrerePersonen = e.personIds.length > 1;
  const gewaehlt = new Set(e.items.map((p) => p.invoiceId));

  // Neue Einreichung: standardmäßig alle offenen Rechnungen auswählen
  const [vorbelegt, setVorbelegt] = useState(!!einreichung);
  useEffect(() => {
    if (vorbelegt) return;
    setE((x) => ({ ...x, items: kandidaten.map((r) => ({ invoiceId: r.id })) }));
    setVorbelegt(true);
  }, [kandidaten, vorbelegt]);

  function umschalten(id: string) {
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
    <Modal titel={einreichung ? 'Einreichung bearbeiten' : 'Neue Einreichung'} onClose={onClose} breit>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (!e.items.length) return alert('Bitte mindestens eine Rechnung auswählen.');
          const ids = await dateienSpeichern(einreichung?.fileIds ?? [], dateiIds, neueDateien);
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
              {KOSTENTRAEGER.filter((k) => k === e.payer || k !== 'ppv' || !person?.pkv.includesCare).map((k) => (
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
                        checked={kandidaten.every((r) => gewaehlt.has(r.id))}
                        onChange={(ev) => setE((x) => ({ ...x, items: ev.target.checked ? kandidaten.map((r) => x.items.find((p) => p.invoiceId === r.id) ?? { invoiceId: r.id }) : [] }))}
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
                      <td>{r.provider}{r.description && <small className="grau"> · {r.description}</small>}</td>
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

function BescheidFormular({ einreichung, onClose }: { einreichung: Submission; onClose: () => void }) {
  const { state, personById, speichereEinreichung } = useStore();
  const dateienSpeichern = useDateienSpeichern();
  const personen = einreichung.personIds.map(personById);
  const [e, setE] = useState(einreichung);
  const [dateiIds, setDateiIds] = useState(e.fileIds);
  const [neueDateien, setNeueDateien] = useState<File[]>([]);
  const rechnungen = e.items.map((p) => ({ p, r: state.invoices.find((r) => r.id === p.invoiceId) })).filter((x): x is { p: typeof x.p; r: Invoice } => !!x.r);

  const setPos = (id: string, teil: { erstattet?: number; bemerkung?: string }) =>
    setE((x) => ({ ...x, items: x.items.map((p) => (p.invoiceId === id ? { ...p, ...teil } : p)) }));

  const summe = e.items.reduce((s, p) => s + (p.reimbursed ?? 0), 0);
  const erw = rechnungen.reduce((s, { r }) => s + erwartetFuerRechnung(state, r, e.payer), 0);

  return (
    <Modal titel={`Bescheid – ${ktName(e.payer, personen[0])} – ${namen(personen)}`} onClose={onClose} breit>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          const ids = await dateienSpeichern(einreichung.fileIds, dateiIds, neueDateien);
          speichereEinreichung({ ...e, status: 'decided', decisionDate: e.decisionDate || heute(), fileIds: ids });
          onClose();
        }}
      >
        <div className="raster">
          <Feld label="Bescheid vom">
            <input type="date" value={e.decisionDate ?? heute()} onChange={(ev) => setE({ ...e, decisionDate: ev.target.value })} required />
          </Feld>
          <Feld label="Gutschrift auf Konto am">
            <input type="date" value={e.paymentDate ?? ''} onChange={(ev) => setE({ ...e, paymentDate: ev.target.value || undefined })} />
          </Feld>
        </div>

        <div className="zeile rechts">
          <button
            type="button"
            className="klein"
            onClick={() => setE((x) => ({ ...x, items: x.items.map((p) => {
              const r = rechnungen.find((y) => y.r.id === p.invoiceId)?.r;
              return r ? { ...p, reimbursed: erwartetFuerRechnung(state, r, x.payer) } : p;
            }) }))}
          >
            Alle wie erwartet übernehmen
          </button>
        </div>

        <div className="tabelle-wrap">
          <table className="tabelle kompakt">
            <thead>
              <tr>
                <th>Rechnung</th>
                <th className="zahl">Betrag</th>
                <th className="zahl">Erwartet</th>
                <th>Erstattet</th>
                <th>Bemerkung (z. B. Kürzungsgrund)</th>
              </tr>
            </thead>
            <tbody>
              {rechnungen.map(({ p, r }) => (
                <tr key={r.id}>
                  <td>{datum(r.date)} · {r.provider}{personen.length > 1 && <> · {personById(r.personId)?.name}</>}</td>
                  <td className="zahl">{euro(r.amount)}</td>
                  <td className="zahl">{euro(erwartetFuerRechnung(state, r, e.payer))}</td>
                  <td><BetragFeld wert={p.reimbursed} onChange={(c) => setPos(r.id, { erstattet: c })} /></td>
                  <td><input value={p.remark ?? ''} onChange={(ev) => setPos(r.id, { bemerkung: ev.target.value })} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Summe</td>
                <td className="zahl">{euro(rechnungen.reduce((s, { r }) => s + r.amount, 0))}</td>
                <td className="zahl">{euro(erw)}</td>
                <td className="zahl">{euro(summe)}</td>
                <td>{summe !== erw && <span className={summe < erw ? 'rot' : 'ok'}>Abweichung {euro(summe - erw)}</span>}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <small className="grau">Leere Beträge gelten als 0 € (abgelehnt). Abgelehnte Rechnungen können später erneut eingereicht werden.</small>

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

import { useEffect, useMemo, useState } from 'react';
import { breCheck, breRelevant, einreichbareRechnungen, erwartetFuerRechnung, traegerFuer, versicherungFuer } from '../calc';
import { BetragFeld, DateiFeld, Feld, Leer, Modal, PersonChip, useDateienSpeichern } from '../components/ui';
import { datum, euro, heute, neueId } from '../format';
import { useNav } from '../nav';
import { useStore } from '../store';
import {
  ART_NAME,
  KOSTENTRAEGER,
  KT_KURZ,
  KT_NAME,
  WEG_NAME,
  type Einreichung,
  type Einreichungsweg,
  type Kostentraeger,
  type Person,
  type Rechnung,
} from '../types';

type Ansicht = { typ: 'bearbeiten'; e?: Einreichung; personId?: string; kt?: Kostentraeger } | { typ: 'bescheid'; e: Einreichung } | { typ: 'druck'; e: Einreichung };

export default function Einreichungen() {
  const { state, personById } = useStore();
  const nav = useNav();
  const [statusFilter, setStatusFilter] = useState<'' | 'eingereicht' | 'beschieden'>('');
  const [ktFilter, setKtFilter] = useState<Kostentraeger | ''>('');
  const [ansicht, setAnsicht] = useState<Ansicht | null>(null);

  useEffect(() => {
    const z = nav.ziel;
    if (!z) return;
    if (z.neu) setAnsicht({ typ: 'bearbeiten', personId: z.personId, kt: z.kt });
    const e = state.einreichungen.find((x) => x.id === z.einreichungId);
    if (e) setAnsicht({ typ: 'bearbeiten', e });
    nav.zielErledigt();
  }, [nav, state.einreichungen]);

  const rechnungen = useMemo(() => new Map(state.rechnungen.map((r) => [r.id, r])), [state.rechnungen]);

  const zeilen = state.einreichungen
    .filter((e) => !nav.personFilter || e.personIds.includes(nav.personFilter))
    .filter((e) => !statusFilter || e.status === statusFilter)
    .filter((e) => !ktFilter || e.kostentraeger === ktFilter)
    .sort((a, b) => b.eingereichtAm.localeCompare(a.eingereichtAm))
    .map((e) => {
      const personen = e.personIds.map(personById).filter((p): p is Person => !!p);
      let summe = 0;
      let erw = 0;
      let erst = 0;
      for (const p of e.positionen) {
        const r = rechnungen.get(p.rechnungId);
        if (!r) continue;
        summe += r.betrag;
        erw += erwartetFuerRechnung(state, r, e.kostentraeger);
        erst += p.erstattet ?? 0;
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
          <button className={statusFilter === 'eingereicht' ? 'aktiv' : ''} onClick={() => setStatusFilter('eingereicht')}>Warten auf Bescheid</button>
          <button className={statusFilter === 'beschieden' ? 'aktiv' : ''} onClick={() => setStatusFilter('beschieden')}>Beschieden</button>
        </div>
        <select value={ktFilter} onChange={(e) => setKtFilter(e.target.value as Kostentraeger | '')} aria-label="Kostenträger">
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
                  <td>{datum(e.eingereichtAm)}<br /><small className="grau">{WEG_NAME[e.weg]}</small></td>
                  <td><div className="chips">{personen.map((p) => <PersonChip key={p.id} person={p} />)}</div></td>
                  <td>{KT_KURZ[e.kostentraeger]}</td>
                  <td>{e.referenz || '–'}{e.dateiIds.length > 0 && ' 📎'}</td>
                  <td className="zahl">{e.positionen.length}</td>
                  <td className="zahl">{euro(summe)}</td>
                  <td className="zahl">{euro(erw)}</td>
                  <td className="zahl">
                    {e.status === 'beschieden' ? (
                      <>
                        {euro(erst)}
                        {erst !== erw && <><br /><small className={erst < erw ? 'rot' : 'ok'}>{erst < erw ? '−' : '+'}{euro(Math.abs(erst - erw))}</small></>}
                      </>
                    ) : '–'}
                  </td>
                  <td>
                    {e.status === 'beschieden' ? (
                      <span className="badge status-erstattet">Bescheid {datum(e.bescheidAm)}</span>
                    ) : (
                      <span className="badge status-eingereicht">wartet seit {Math.max(0, Math.round((Date.now() - new Date(e.eingereichtAm).getTime()) / 86_400_000))} Tagen</span>
                    )}
                  </td>
                  <td className="knoepfe">
                    <button className="klein" onClick={() => setAnsicht({ typ: 'bearbeiten', e })}>Bearbeiten</button>
                    <button className="klein primaer" onClick={() => setAnsicht({ typ: 'bescheid', e })}>{e.status === 'beschieden' ? 'Bescheid' : 'Bescheid erfassen'}</button>
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

function EinreichungFormular({ einreichung, personId, kt, onClose }: { einreichung?: Einreichung; personId?: string; kt?: Kostentraeger; onClose: () => void }) {
  const { state, personById, speichereEinreichung, loescheEinreichung } = useStore();
  const dateienSpeichern = useDateienSpeichern();
  const [e, setE] = useState<Einreichung>(
    () =>
      einreichung ?? {
        id: neueId(),
        personIds: startPersonen(state.personen, personId),
        kostentraeger: kt ?? 'beihilfe',
        eingereichtAm: heute(),
        weg: 'app',
        referenz: '',
        status: 'eingereicht',
        positionen: [],
        dateiIds: [],
        notiz: '',
      },
  );
  const [dateiIds, setDateiIds] = useState(e.dateiIds);
  const [neueDateien, setNeueDateien] = useState<File[]>([]);
  const set = <K extends keyof Einreichung>(k: K, v: Einreichung[K]) => setE((x) => ({ ...x, [k]: v }));
  const person = personById(e.personIds[0]);

  const kandidaten = useMemo(
    () => e.personIds.flatMap((id) => einreichbareRechnungen(state, id, e.kostentraeger, e.id)).sort((a, b) => a.datum.localeCompare(b.datum)),
    [state, e.personIds, e.kostentraeger, e.id],
  );
  const mehrerePersonen = e.personIds.length > 1;
  const gewaehlt = new Set(e.positionen.map((p) => p.rechnungId));

  // Neue Einreichung: standardmäßig alle offenen Rechnungen auswählen
  const [vorbelegt, setVorbelegt] = useState(!!einreichung);
  useEffect(() => {
    if (vorbelegt) return;
    setE((x) => ({ ...x, positionen: kandidaten.map((r) => ({ rechnungId: r.id })) }));
    setVorbelegt(true);
  }, [kandidaten, vorbelegt]);

  function umschalten(id: string) {
    setE((x) => ({
      ...x,
      positionen: gewaehlt.has(id) ? x.positionen.filter((p) => p.rechnungId !== id) : [...x.positionen, { rechnungId: id }],
    }));
  }

  // Welche Jahre verlieren durch diese PKV-Einreichung ihre Beitragsrückerstattung?
  const breVerlust = useMemo(() => {
    if (e.kostentraeger === 'beihilfe') return [];
    const ohneDiese = { rechnungen: state.rechnungen, einreichungen: state.einreichungen.filter((x) => x.id !== e.id) };
    const betroffen = new Map<string, Person>();
    for (const r of kandidaten) {
      const p = personById(r.personId);
      if (!p || !gewaehlt.has(r.id) || versicherungFuer(r.art) !== e.kostentraeger || !breRelevant(r, p)) continue;
      betroffen.set(`${p.id}|${r.datum.slice(0, 4)}`, p);
    }
    return [...betroffen]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, p]) => breCheck(ohneDiese, p, Number(k.split('|')[1])))
      .filter((c) => c != null && c.eingereicht.length === 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.kostentraeger, e.id, e.positionen, person, state, kandidaten]);

  const summe = kandidaten.filter((r) => gewaehlt.has(r.id)).reduce((s, r) => s + r.betrag, 0);
  const erw = kandidaten.filter((r) => gewaehlt.has(r.id)).reduce((s, r) => s + erwartetFuerRechnung(state, r, e.kostentraeger), 0);

  return (
    <Modal titel={einreichung ? 'Einreichung bearbeiten' : 'Neue Einreichung'} onClose={onClose} breit>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (!e.positionen.length) return alert('Bitte mindestens eine Rechnung auswählen.');
          const ids = await dateienSpeichern(einreichung?.dateiIds ?? [], dateiIds, neueDateien);
          speichereEinreichung({ ...e, dateiIds: ids });
          onClose();
        }}
      >
        <div className="raster">
          <Feld label="Personen" gruppe hinweis="Gemeinsam Versicherte können zusammen eingereicht werden">
            <div className="zeile">
              {state.personen.map((p) => (
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
                        positionen: x.positionen.filter((pos) => ids.includes(state.rechnungen.find((r) => r.id === pos.rechnungId)?.personId ?? '')),
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
            <select value={e.kostentraeger} disabled={!!einreichung} onChange={(ev) => { set('kostentraeger', ev.target.value as Kostentraeger); setVorbelegt(false); }}>
              {KOSTENTRAEGER.map((k) => <option key={k} value={k}>{KT_NAME[k]}{person && traegerName(person, k)}</option>)}
            </select>
          </Feld>
          <Feld label="Eingereicht am">
            <input type="date" value={e.eingereichtAm} onChange={(ev) => set('eingereichtAm', ev.target.value)} required />
          </Feld>
          <Feld label="Weg">
            <select value={e.weg} onChange={(ev) => set('weg', ev.target.value as Einreichungsweg)}>
              {(Object.keys(WEG_NAME) as Einreichungsweg[]).map((w) => <option key={w} value={w}>{WEG_NAME[w]}</option>)}
            </select>
          </Feld>
          <Feld label="Antrags-/Vorgangsnummer" breit>
            <input value={e.referenz} onChange={(ev) => set('referenz', ev.target.value)} />
          </Feld>
        </div>

        <fieldset>
          <legend>Enthaltene Rechnungen</legend>
          {kandidaten.length === 0 ? (
            <Leer>Keine offenen Rechnungen für {e.personIds.map((id) => personById(id)?.name).join(' und ')} bei {KT_KURZ[e.kostentraeger]}.</Leer>
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
                        onChange={(ev) => setE((x) => ({ ...x, positionen: ev.target.checked ? kandidaten.map((r) => x.positionen.find((p) => p.rechnungId === r.id) ?? { rechnungId: r.id }) : [] }))}
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
                      <td>{datum(r.datum)}</td>
                      {mehrerePersonen && <td><PersonChip person={personById(r.personId)} /></td>}
                      <td>{r.leistungserbringer}{r.beschreibung && <small className="grau"> · {r.beschreibung}</small>}</td>
                      <td>{ART_NAME[r.art]}</td>
                      <td className="zahl">{euro(r.betrag)}</td>
                      <td className="zahl">{euro(erwartetFuerRechnung(state, r, e.kostentraeger))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={mehrerePersonen ? 5 : 4}>{e.positionen.length} ausgewählt</td>
                    <td className="zahl">{euro(summe)}</td>
                    <td className="zahl">{euro(erw)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {e.status === 'beschieden' && <small className="grau">Hinweis: Für diese Einreichung ist bereits ein Bescheid erfasst.</small>}
          {breVerlust.map((c) => c && (
            <div key={c.jahr} className="hinweis warnung">
              ⚠️ Damit entfällt die Beitragsrückerstattung {c.jahr} ({euro(c.bre)}).
              {c.empfehlung === 'zurueckhalten' && ` Erwartete Erstattung aller Rechnungen ${c.jahr}: nur ${euro(c.erstattungBeiEinreichung)}.`}
            </div>
          ))}
        </fieldset>

        <Feld label="Antrag / Kopien" gruppe breit>
          <DateiFeld vorhandene={dateiIds} onVorhandene={setDateiIds} neue={neueDateien} onNeue={setNeueDateien} />
        </Feld>
        <Feld label="Notiz" breit>
          <textarea rows={2} value={e.notiz} onChange={(ev) => set('notiz', ev.target.value)} />
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

function nummerBei(p: Person, kt: Kostentraeger): string {
  return kt === 'beihilfe' ? p.beihilfe.aktenzeichen : kt === 'pkv' ? p.pkv.nummer : p.ppv.nummer;
}

function namen(personen: (Person | undefined)[]): string {
  return personen.filter(Boolean).map((p) => p!.name).join(' und ');
}

function traegerName(p: Person, kt: Kostentraeger): string {
  const n = kt === 'beihilfe' ? p.beihilfe.stelle : kt === 'pkv' ? [p.pkv.name, p.pkv.tarif].filter(Boolean).join(', ') : [p.ppv.name, p.ppv.tarif].filter(Boolean).join(', ');
  return n ? ` (${n})` : '';
}

function BescheidFormular({ einreichung, onClose }: { einreichung: Einreichung; onClose: () => void }) {
  const { state, personById, speichereEinreichung } = useStore();
  const dateienSpeichern = useDateienSpeichern();
  const personen = einreichung.personIds.map(personById);
  const [e, setE] = useState(einreichung);
  const [dateiIds, setDateiIds] = useState(e.dateiIds);
  const [neueDateien, setNeueDateien] = useState<File[]>([]);
  const rechnungen = e.positionen.map((p) => ({ p, r: state.rechnungen.find((r) => r.id === p.rechnungId) })).filter((x): x is { p: typeof x.p; r: Rechnung } => !!x.r);

  const setPos = (id: string, teil: { erstattet?: number; bemerkung?: string }) =>
    setE((x) => ({ ...x, positionen: x.positionen.map((p) => (p.rechnungId === id ? { ...p, ...teil } : p)) }));

  const summe = e.positionen.reduce((s, p) => s + (p.erstattet ?? 0), 0);
  const erw = rechnungen.reduce((s, { r }) => s + erwartetFuerRechnung(state, r, e.kostentraeger), 0);

  return (
    <Modal titel={`Bescheid – ${KT_NAME[e.kostentraeger]} – ${namen(personen)}`} onClose={onClose} breit>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          const ids = await dateienSpeichern(einreichung.dateiIds, dateiIds, neueDateien);
          speichereEinreichung({ ...e, status: 'beschieden', bescheidAm: e.bescheidAm || heute(), dateiIds: ids });
          onClose();
        }}
      >
        <div className="raster">
          <Feld label="Bescheid vom">
            <input type="date" value={e.bescheidAm ?? heute()} onChange={(ev) => setE({ ...e, bescheidAm: ev.target.value })} required />
          </Feld>
          <Feld label="Gutschrift auf Konto am">
            <input type="date" value={e.gutschriftAm ?? ''} onChange={(ev) => setE({ ...e, gutschriftAm: ev.target.value || undefined })} />
          </Feld>
        </div>

        <div className="zeile rechts">
          <button
            type="button"
            className="klein"
            onClick={() => setE((x) => ({ ...x, positionen: x.positionen.map((p) => {
              const r = rechnungen.find((y) => y.r.id === p.rechnungId)?.r;
              return r ? { ...p, erstattet: erwartetFuerRechnung(state, r, x.kostentraeger) } : p;
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
                  <td>{datum(r.datum)} · {r.leistungserbringer}{personen.length > 1 && <> · {personById(r.personId)?.name}</>}</td>
                  <td className="zahl">{euro(r.betrag)}</td>
                  <td className="zahl">{euro(erwartetFuerRechnung(state, r, e.kostentraeger))}</td>
                  <td><BetragFeld wert={p.erstattet} onChange={(c) => setPos(r.id, { erstattet: c })} /></td>
                  <td><input value={p.bemerkung ?? ''} onChange={(ev) => setPos(r.id, { bemerkung: ev.target.value })} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Summe</td>
                <td className="zahl">{euro(rechnungen.reduce((s, { r }) => s + r.betrag, 0))}</td>
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
          {einreichung.status === 'beschieden' && (
            <button
              type="button"
              onClick={() => {
                speichereEinreichung({ ...einreichung, status: 'eingereicht', bescheidAm: undefined, gutschriftAm: undefined, positionen: einreichung.positionen.map((p) => ({ rechnungId: p.rechnungId })) });
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

function Belegliste({ einreichung: e, onClose }: { einreichung: Einreichung; onClose: () => void }) {
  const { state, personById } = useStore();
  const personen = e.personIds.map(personById).filter((p): p is Person => !!p);
  const mehrere = personen.length > 1;
  const rs = e.positionen.map((p) => state.rechnungen.find((r) => r.id === p.rechnungId)).filter((r): r is Rechnung => !!r).sort((a, b) => a.datum.localeCompare(b.datum));
  return (
    <Modal titel="Belegliste" onClose={onClose} breit>
      <div className="druck">
        <h2>Belegaufstellung – {KT_NAME[e.kostentraeger]}</h2>
        <p>
          {personen.map((p) => (
            <span key={p.id}>
              <strong>{p.name}</strong>
              {traegerName(p, e.kostentraeger)}
              {nummerBei(p, e.kostentraeger) && <> · {e.kostentraeger === 'beihilfe' ? 'Aktenzeichen' : 'Versicherungsnummer'} {nummerBei(p, e.kostentraeger)}</>}
              <br />
            </span>
          ))}
          Eingereicht am {datum(e.eingereichtAm)}{e.referenz && ` · Vorgang ${e.referenz}`}
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
                <td>{datum(r.datum)}</td>
                {mehrere && <td>{personById(r.personId)?.name}</td>}
                <td>{r.leistungserbringer}{r.beschreibung && ` – ${r.beschreibung}`}</td>
                <td>{r.rechnungsnummer}</td>
                <td>{ART_NAME[r.art]}</td>
                <td className="zahl">{euro(r.betrag)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={mehrere ? 6 : 5}>Summe ({rs.length} Belege)</td>
              <td className="zahl">{euro(rs.reduce((s, r) => s + r.betrag, 0))}</td>
            </tr>
          </tfoot>
        </table>
        {rs.some((r) => { const p = personById(r.personId); return !p || !traegerFuer(r.art, p).includes(e.kostentraeger); }) && <p className="rot">Achtung: enthält Rechnungen, die nicht zu diesem Kostenträger passen.</p>}
      </div>
      <div className="aktionen">
        <span className="abstand" />
        <button type="button" onClick={onClose}>Schließen</button>
        <button type="button" className="primaer" onClick={() => window.print()}>Drucken</button>
      </div>
    </Modal>
  );
}

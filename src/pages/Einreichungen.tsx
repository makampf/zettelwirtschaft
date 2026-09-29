import { useEffect, useMemo, useState } from 'react';
import { einreichbareRechnungen, erwartet, traegerFuer } from '../calc';
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
    .filter((e) => !nav.personFilter || e.personId === nav.personFilter)
    .filter((e) => !statusFilter || e.status === statusFilter)
    .filter((e) => !ktFilter || e.kostentraeger === ktFilter)
    .sort((a, b) => b.eingereichtAm.localeCompare(a.eingereichtAm))
    .map((e) => {
      const person = personById(e.personId);
      let summe = 0;
      let erw = 0;
      let erst = 0;
      for (const p of e.positionen) {
        const r = rechnungen.get(p.rechnungId);
        if (!r || !person) continue;
        summe += r.betrag;
        erw += erwartet(r, person, e.kostentraeger);
        erst += p.erstattet ?? 0;
      }
      return { e, person, summe, erw, erst };
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
              {zeilen.map(({ e, person, summe, erw, erst }) => (
                <tr key={e.id}>
                  <td>{datum(e.eingereichtAm)}<br /><small className="grau">{WEG_NAME[e.weg]}</small></td>
                  <td><PersonChip person={person} /></td>
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
        personId: personId || state.personen[0]?.id || '',
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
  const person = personById(e.personId);

  const kandidaten = useMemo(() => einreichbareRechnungen(state, e.personId, e.kostentraeger, e.id), [state, e.personId, e.kostentraeger, e.id]);
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

  const summe = kandidaten.filter((r) => gewaehlt.has(r.id)).reduce((s, r) => s + r.betrag, 0);
  const erw = person ? kandidaten.filter((r) => gewaehlt.has(r.id)).reduce((s, r) => s + erwartet(r, person, e.kostentraeger), 0) : 0;

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
          <Feld label="Person">
            <select value={e.personId} disabled={!!einreichung} onChange={(ev) => { set('personId', ev.target.value); setVorbelegt(false); }}>
              {state.personen.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
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
            <Leer>Keine offenen Rechnungen für {person?.name} bei {KT_KURZ[e.kostentraeger]}.</Leer>
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
                      <td>{r.leistungserbringer}{r.beschreibung && <small className="grau"> · {r.beschreibung}</small>}</td>
                      <td>{ART_NAME[r.art]}</td>
                      <td className="zahl">{euro(r.betrag)}</td>
                      <td className="zahl">{person && euro(erwartet(r, person, e.kostentraeger))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>{e.positionen.length} ausgewählt</td>
                    <td className="zahl">{euro(summe)}</td>
                    <td className="zahl">{euro(erw)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {e.status === 'beschieden' && <small className="grau">Hinweis: Für diese Einreichung ist bereits ein Bescheid erfasst.</small>}
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

function traegerName(p: Person, kt: Kostentraeger): string {
  const n = kt === 'beihilfe' ? p.beihilfe.stelle : kt === 'pkv' ? p.pkv.name : p.ppv.name;
  return n ? ` (${n})` : '';
}

function BescheidFormular({ einreichung, onClose }: { einreichung: Einreichung; onClose: () => void }) {
  const { state, personById, speichereEinreichung } = useStore();
  const dateienSpeichern = useDateienSpeichern();
  const person = personById(einreichung.personId);
  const [e, setE] = useState(einreichung);
  const [dateiIds, setDateiIds] = useState(e.dateiIds);
  const [neueDateien, setNeueDateien] = useState<File[]>([]);
  const rechnungen = e.positionen.map((p) => ({ p, r: state.rechnungen.find((r) => r.id === p.rechnungId) })).filter((x): x is { p: typeof x.p; r: Rechnung } => !!x.r);

  const setPos = (id: string, teil: { erstattet?: number; bemerkung?: string }) =>
    setE((x) => ({ ...x, positionen: x.positionen.map((p) => (p.rechnungId === id ? { ...p, ...teil } : p)) }));

  const summe = e.positionen.reduce((s, p) => s + (p.erstattet ?? 0), 0);
  const erw = person ? rechnungen.reduce((s, { r }) => s + erwartet(r, person, e.kostentraeger), 0) : 0;

  return (
    <Modal titel={`Bescheid – ${KT_NAME[e.kostentraeger]} – ${person?.name ?? ''}`} onClose={onClose} breit>
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
            onClick={() => person && setE((x) => ({ ...x, positionen: x.positionen.map((p) => {
              const r = rechnungen.find((y) => y.r.id === p.rechnungId)?.r;
              return r ? { ...p, erstattet: erwartet(r, person, x.kostentraeger) } : p;
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
                  <td>{datum(r.datum)} · {r.leistungserbringer}</td>
                  <td className="zahl">{euro(r.betrag)}</td>
                  <td className="zahl">{person && euro(erwartet(r, person, e.kostentraeger))}</td>
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
  const person = personById(e.personId);
  const rs = e.positionen.map((p) => state.rechnungen.find((r) => r.id === p.rechnungId)).filter((r): r is Rechnung => !!r).sort((a, b) => a.datum.localeCompare(b.datum));
  const nummer = person && (e.kostentraeger === 'beihilfe' ? person.beihilfe.aktenzeichen : e.kostentraeger === 'pkv' ? person.pkv.nummer : person.ppv.nummer);
  return (
    <Modal titel="Belegliste" onClose={onClose} breit>
      <div className="druck">
        <h2>Belegaufstellung – {KT_NAME[e.kostentraeger]}</h2>
        <p>
          <strong>{person?.name}</strong>
          {person && traegerName(person, e.kostentraeger)}
          {nummer && <> · {e.kostentraeger === 'beihilfe' ? 'Aktenzeichen' : 'Versicherungsnummer'} {nummer}</>}
          <br />
          Eingereicht am {datum(e.eingereichtAm)}{e.referenz && ` · Vorgang ${e.referenz}`}
        </p>
        <table className="tabelle kompakt">
          <thead>
            <tr>
              <th>Nr.</th>
              <th>Rechnungsdatum</th>
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
                <td>{r.leistungserbringer}{r.beschreibung && ` – ${r.beschreibung}`}</td>
                <td>{r.rechnungsnummer}</td>
                <td>{ART_NAME[r.art]}</td>
                <td className="zahl">{euro(r.betrag)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Summe ({rs.length} Belege)</td>
              <td className="zahl">{euro(rs.reduce((s, r) => s + r.betrag, 0))}</td>
            </tr>
          </tfoot>
        </table>
        {rs.some((r) => !traegerFuer(r.art).includes(e.kostentraeger)) && <p className="rot">Achtung: enthält Rechnungen, die nicht zu diesem Kostenträger passen.</p>}
      </div>
      <div className="aktionen">
        <span className="abstand" />
        <button type="button" onClick={onClose}>Schließen</button>
        <button type="button" className="primaer" onClick={() => window.print()}>Drucken</button>
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { neuePerson } from '../defaults';
import { BetragFeld, Feld, Modal } from '../components/ui';
import { euro } from '../format';
import { useStore } from '../store';
import type { Person } from '../types';

const FARBEN = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626'];

export default function People() {
  const { state } = useStore();
  const [bearbeiten, setBearbeiten] = useState<Person | 'neu' | null>(null);
  return (
    <section>
      <div className="seitenkopf">
        <h1>Personen</h1>
        <button className="primaer" onClick={() => setBearbeiten('neu')}>+ Person</button>
      </div>
      <div className="karten">
        {state.people.map((p) => (
          <article key={p.id} className="karte" style={{ '--farbe': p.color } as React.CSSProperties}>
            <h2>{p.name}</h2>
            <dl className="daten-liste">
              <dt>Beihilfe</dt>
              {p.beihilfe.eligible ? (
                <dd>
                  {p.beihilfe.office || <span className="grau">Beihilfestelle nicht angegeben</span>}
                  <br />
                  {p.beihilfe.rateIllness} % Krankheit · {p.beihilfe.rateCare} % Pflege · Frist {p.beihilfe.deadlineMonths} Monate
                  {p.beihilfe.reference && <><br />Az. {p.beihilfe.reference}</>}
                </dd>
              ) : (
                <dd className="grau">nicht beihilfeberechtigt</dd>
              )}
              <dt>{p.pkv.includesCare ? 'Kranken- und Pflegeversicherung' : 'Krankenversicherung'}</dt>
              <dd>
                {p.pkv.name || <span className="grau">nicht angegeben</span>}{p.pkv.tariff && <>, Tarif {p.pkv.tariff}</>}
                {' · '}{p.pkv.includesCare ? `${p.pkv.rate} % Krankheit · ${p.ppv.rate} % Pflege` : `${p.pkv.rate} %`}
                {p.pkv.number && <><br />Nr. {p.pkv.number}</>}
                {p.pkv.deductiblePercent > 0 && <><br />Selbstbehalt {p.pkv.deductiblePercent} %, max. {euro(p.pkv.deductibleMax)}/Jahr</>}
                {p.pkv.premiumRefundEnabled && <><br />Beitragsrückerstattung {p.pkv.premiumRefund ? `ca. ${euro(p.pkv.premiumRefund)}/Jahr` : '– Betrag noch eintragen'}</>}
              </dd>
              {!p.pkv.includesCare && (
                <>
                  <dt>Pflegeversicherung</dt>
                  <dd>{p.ppv.name || <span className="grau">nicht angegeben</span>}{p.ppv.tariff && <>, Tarif {p.ppv.tariff}</>} · {p.ppv.rate} %{p.ppv.number && <><br />Nr. {p.ppv.number}</>}</dd>
                </>
              )}
              {p.partnerId && <><dt>Gemeinsam versichert</dt><dd>mit {state.people.find((x) => x.id === p.partnerId)?.name}</dd></>}
              {p.note && <><dt>Notiz</dt><dd>{p.note}</dd></>}
            </dl>
            <button onClick={() => setBearbeiten(p)}>Bearbeiten</button>
          </article>
        ))}
      </div>
      {bearbeiten && <PersonFormular person={bearbeiten === 'neu' ? undefined : bearbeiten} onClose={() => setBearbeiten(null)} />}
    </section>
  );
}

function PersonFormular({ person, onClose }: { person?: Person; onClose: () => void }) {
  const { state, speicherePerson, loeschePerson } = useStore();
  const [p, setP] = useState<Person>(() => person ?? neuePerson('', FARBEN[state.people.length % FARBEN.length], 70));
  const bh = (teil: Partial<Person['beihilfe']>) => setP((x) => ({ ...x, beihilfe: { ...x.beihilfe, ...teil } }));
  const pkv = (teil: Partial<Person['pkv']>) => setP((x) => ({ ...x, pkv: { ...x.pkv, ...teil } }));
  const ppv = (teil: Partial<Person['ppv']>) => setP((x) => ({ ...x, ppv: { ...x.ppv, ...teil } }));
  const prozent = (v: string) => Math.max(0, Math.min(100, Number(v) || 0));
  const hatRechnungen = person && state.invoices.some((r) => r.personId === person.id);
  const partner = state.people.find((x) => x.id === p.partnerId && x.id !== p.id);

  return (
    <Modal titel={person ? `${person.name} bearbeiten` : 'Neue Person'} onClose={onClose} breit>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          speicherePerson(p);
          onClose();
        }}
      >
        <div className="raster">
          <Feld label="Name">
            <input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} required autoFocus />
          </Feld>
          <Feld label="Name auf Rechnungen" hinweis="Vollständiger Name, z. B. „Erika Mustermann“ – damit Belege automatisch der Person zugeordnet werden. Mehrere Schreibweisen mit Komma trennen.">
            <input value={p.invoiceNames ?? ''} onChange={(e) => setP({ ...p, invoiceNames: e.target.value || undefined })} />
          </Feld>
          <Feld
            label="Gemeinsam versichert mit"
            hinweis="Z. B. beim Ehepartner mitversichert. Wird bei beiden automatisch eingetragen – Einreichungen und Belegliste enthalten dann die Rechnungen beider."
          >
            <select value={p.partnerId ?? ''} onChange={(e) => setP({ ...p, partnerId: e.target.value || undefined })}>
              <option value="">– niemand –</option>
              {state.people.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            {partner && (
              <button type="button" className="klein" onClick={() => setP(versicherungUebernehmen(p, partner))}>
                Versicherungsdaten von {partner.name} übernehmen
              </button>
            )}
          </Feld>
          <Feld label="Farbe" gruppe>
            <div className="farben">
              {FARBEN.map((f) => (
                <button type="button" key={f} className={`farbe ${p.color === f ? 'aktiv' : ''}`} style={{ background: f }} onClick={() => setP({ ...p, color: f })} aria-label={f} />
              ))}
            </div>
          </Feld>
        </div>

        <fieldset>
          <legend>Beihilfe</legend>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={p.beihilfe.eligible}
              onChange={(e) => {
                const berechtigt = e.target.checked;
                const satz = berechtigt ? 70 : 0;
                // Versicherungsquoten sinnvoll mitziehen: ohne Beihilfe 100 %, sonst Restquote
                setP((x) => ({
                  ...x,
                  beihilfe: { ...x.beihilfe, eligible: berechtigt, rateIllness: satz, rateCare: satz },
                  pkv: { ...x.pkv, rate: 100 - satz },
                  ppv: { ...x.ppv, rate: 100 - satz },
                }));
              }}
            />
            beihilfeberechtigt
          </label>
          {p.beihilfe.eligible && <div className="raster">
            <Feld label="Beihilfestelle">
              <input value={p.beihilfe.office} placeholder="z. B. Landesamt für Besoldung" onChange={(e) => bh({ office: e.target.value })} />
            </Feld>
            <Feld label="Aktenzeichen / Personalnummer">
              <input value={p.beihilfe.reference} onChange={(e) => bh({ reference: e.target.value })} />
            </Feld>
            <Feld label="Bemessungssatz Krankheit (%)" hinweis="Aktive meist 50 %, Versorgungsempfänger meist 70 %">
              <input type="number" min={0} max={100} value={p.beihilfe.rateIllness} onChange={(e) => bh({ rateIllness: prozent(e.target.value) })} />
            </Feld>
            <Feld label="Bemessungssatz Pflege (%)">
              <input type="number" min={0} max={100} value={p.beihilfe.rateCare} onChange={(e) => bh({ rateCare: prozent(e.target.value) })} />
            </Feld>
            <Feld label="Antragsfrist (Monate ab Rechnungsdatum)" hinweis="Je nach Bundesland/Bund unterschiedlich – bitte prüfen">
              <input type="number" min={1} max={60} value={p.beihilfe.deadlineMonths} onChange={(e) => bh({ deadlineMonths: Math.max(1, Number(e.target.value) || 12) })} />
            </Feld>
          </div>}
        </fieldset>

        <fieldset>
          <legend>{p.pkv.includesCare ? 'Private Kranken- und Pflegeversicherung' : 'Private Krankenversicherung'}</legend>
          <div className="raster">
            <Feld label="Pflegeversicherung" breit hinweis={p.pkv.includesCare
              ? 'Gleicher Versicherer, Tarif und Versicherungsnummer – gemeinsame Einreichung, Selbstbehalt und Beitragsrückerstattung'
              : 'Eigene Angaben für die Pflegeversicherung, ohne Selbstbehalt und Beitragsrückerstattung'}>
              <label className="checkbox">
                <input type="checkbox" checked={p.pkv.includesCare} onChange={(e) => pkv({ includesCare: e.target.checked })} />
                Im selben Vertrag wie die Krankenversicherung
              </label>
            </Feld>
            <Feld label="Versicherer">
              <input value={p.pkv.name} onChange={(e) => pkv({ name: e.target.value })} />
            </Feld>
            <Feld label="Tarif">
              <input value={p.pkv.tariff} onChange={(e) => pkv({ tariff: e.target.value })} />
            </Feld>
            <Feld label="Versicherungsnummer">
              <input value={p.pkv.number} onChange={(e) => pkv({ number: e.target.value })} />
            </Feld>
            <Feld label={p.pkv.includesCare ? 'Erstattung Krankheit (%)' : 'Erstattung (%)'} hinweis={p.beihilfe.eligible ? 'Meist 100 % minus Beihilfesatz' : 'Ohne Beihilfe meist 100 %'}>
              <input type="number" min={0} max={100} value={p.pkv.rate} onChange={(e) => pkv({ rate: prozent(e.target.value) })} />
            </Feld>
            {p.pkv.includesCare && (
              <Feld label="Erstattung Pflege (%)" hinweis="Leistungen sind je nach Pflegegrad gedeckelt – ggf. pro Rechnung anpassen">
                <input type="number" min={0} max={100} value={p.ppv.rate} onChange={(e) => ppv({ rate: prozent(e.target.value) })} />
              </Feld>
            )}
            <Feld label="Selbstbehalt (% der Erstattung)" hinweis="Vorsorgeuntersuchungen sind ausgenommen. 0 = kein Selbstbehalt">
              <input type="number" min={0} max={100} value={p.pkv.deductiblePercent} onChange={(e) => pkv({ deductiblePercent: prozent(e.target.value) })} />
            </Feld>
            {p.pkv.deductiblePercent > 0 && (
              <Feld label="Selbstbehalt höchstens pro Jahr">
                <BetragFeld wert={p.pkv.deductibleMax} onChange={(c) => pkv({ deductibleMax: c ?? 0 })} />
              </Feld>
            )}
            <Feld label="Beitragsrückerstattung" hinweis="Bei Leistungsfreiheit (außer Vorsorge)">
              <label className="checkbox">
                <input type="checkbox" checked={p.pkv.premiumRefundEnabled} onChange={(e) => pkv({ premiumRefundEnabled: e.target.checked })} />
                Tarif hat Beitragsrückerstattung
              </label>
            </Feld>
            {p.pkv.premiumRefundEnabled && (
              <Feld label="Rückerstattung pro Jahr" hinweis="Leer lassen, wenn noch unbekannt">
                <BetragFeld wert={p.pkv.premiumRefund || undefined} onChange={(c) => pkv({ premiumRefund: c ?? 0 })} />
              </Feld>
            )}
          </div>
        </fieldset>

        {!p.pkv.includesCare && <fieldset>
          <legend>Private Pflegeversicherung</legend>
          <div className="raster">
            <Feld label="Versicherer">
              <input value={p.ppv.name} onChange={(e) => ppv({ name: e.target.value })} />
            </Feld>
            <Feld label="Tarif">
              <input value={p.ppv.tariff} onChange={(e) => ppv({ tariff: e.target.value })} />
            </Feld>
            <Feld label="Versicherungsnummer">
              <input value={p.ppv.number} onChange={(e) => ppv({ number: e.target.value })} />
            </Feld>
            <Feld label="Erstattung (%)" hinweis="Leistungen sind je nach Pflegegrad gedeckelt – ggf. pro Rechnung anpassen">
              <input type="number" min={0} max={100} value={p.ppv.rate} onChange={(e) => ppv({ rate: prozent(e.target.value) })} />
            </Feld>
          </div>
        </fieldset>}

        <Feld label="Notiz" breit>
          <textarea rows={2} value={p.note} placeholder="z. B. Pflegegrad, Vollmacht, Ansprechpartner" onChange={(e) => setP({ ...p, note: e.target.value })} />
        </Feld>

        <div className="aktionen">
          {person && (
            <button
              type="button"
              className="gefahr"
              disabled={hatRechnungen}
              title={hatRechnungen ? 'Person hat noch Rechnungen' : undefined}
              onClick={() => {
                if (confirm(`${person.name} löschen?`)) {
                  loeschePerson(person.id);
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

/**
 * Übernimmt Beihilfe- und Versicherungsangaben des Partners (gleicher Vertrag, gleiche Nummern).
 * Die Beitragsrückerstattung bleibt persönlich – ihr Betrag unterscheidet sich meist je Person.
 */
function versicherungUebernehmen(p: Person, von: Person): Person {
  return {
    ...p,
    beihilfe: { ...von.beihilfe },
    pkv: { ...von.pkv, premiumRefundEnabled: p.pkv.premiumRefundEnabled, premiumRefund: p.pkv.premiumRefund },
    ppv: { ...von.ppv },
  };
}

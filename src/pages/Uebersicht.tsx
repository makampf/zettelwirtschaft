import { breCheck, hinweise, rechnungUebersicht, traegerFuer, type BreCheck } from '../calc';
import { Leer, PersonChip } from '../components/ui';
import { euro } from '../format';
import { useNav } from '../nav';
import { useStore } from '../store';
import { KOSTENTRAEGER, KT_NAME, type Kostentraeger, type Person, type Rechnung } from '../types';

export default function Uebersicht() {
  const { state, personById } = useStore();
  const nav = useNav();
  const personen = state.personen.filter((p) => !nav.personFilter || p.id === nav.personFilter);
  const liste = hinweise(state).filter((h) => !nav.personFilter || h.personId === nav.personFilter);

  return (
    <section>
      <div className="seitenkopf">
        <h1>Übersicht</h1>
        <div className="zeile">
          <button onClick={() => nav.gehe('einreichungen', { neu: true, personId: nav.personFilter || undefined })}>+ Einreichung</button>
          <button className="primaer" onClick={() => nav.gehe('rechnungen', { neu: true })}>+ Rechnung erfassen</button>
        </div>
      </div>

      {liste.length > 0 && (
        <div className="hinweise">
          {liste.map((h, i) => (
            <button
              key={i}
              className={`hinweis ${h.stufe}`}
              onClick={() => (h.rechnungId ? nav.gehe('rechnungen', { rechnungId: h.rechnungId }) : nav.gehe('einreichungen', { einreichungId: h.einreichungId }))}
            >
              <span aria-hidden>{h.stufe === 'kritisch' ? '⛔' : h.stufe === 'warnung' ? '⚠️' : 'ℹ️'}</span>
              <PersonChip person={personById(h.personId)} />
              <span>{h.text}</span>
            </button>
          ))}
        </div>
      )}

      {state.rechnungen.length === 0 && (
        <Leer>
          Willkommen! Prüfe zuerst unter <button className="link" onClick={() => nav.gehe('personen')}>Personen</button> die Beihilfe-Bemessungssätze und
          Versicherungen für dich und deine Großeltern. Danach kannst du Rechnungen erfassen und Einreichungen verfolgen.
        </Leer>
      )}

      <div className="karten">
        {personen.map((p) => <PersonKarte key={p.id} person={p} />)}
      </div>
    </section>
  );
}

function PersonKarte({ person }: { person: Person }) {
  const { state } = useStore();
  const nav = useNav();
  const rechnungen = state.rechnungen.filter((r) => r.personId === person.id);

  const unbezahlt = rechnungen.filter((r) => !r.bezahltAm);
  const einreichen: Record<Kostentraeger, { n: number; betrag: number; erwartet: number }> = {
    beihilfe: { n: 0, betrag: 0, erwartet: 0 },
    pkv: { n: 0, betrag: 0, erwartet: 0 },
    ppv: { n: 0, betrag: 0, erwartet: 0 },
  };
  const ausstehend: Record<Kostentraeger, { n: number; erwartet: number }> = {
    beihilfe: { n: 0, erwartet: 0 },
    pkv: { n: 0, erwartet: 0 },
    ppv: { n: 0, erwartet: 0 },
  };
  const jahr = String(new Date().getFullYear());
  let eigenJahr = 0;
  let summeJahr = 0;
  for (const r of rechnungen) {
    const u = rechnungUebersicht(r, person, state);
    for (const i of u.infos) {
      if (i.status === 'offen') {
        einreichen[i.kt].n++;
        einreichen[i.kt].betrag += r.betrag;
        einreichen[i.kt].erwartet += i.erwartet;
      }
      if (i.status === 'eingereicht') {
        ausstehend[i.kt].n++;
        ausstehend[i.kt].erwartet += i.erwartet;
      }
    }
    if (r.datum.startsWith(jahr)) {
      eigenJahr += u.eigenanteil;
      summeJahr += r.betrag;
    }
  }
  const relevant = KOSTENTRAEGER.filter(
    (kt) => traegerFuer('krankheit', person).includes(kt) || rechnungen.some((r) => traegerFuer(r.art, person).includes(kt)),
  );
  // BRE: laufendes Jahr und Vorjahr, solange dort noch nicht eingereicht wurde
  const breChecks = [Number(jahr), Number(jahr) - 1]
    .map((j) => breCheck(state, person, j))
    .filter((c): c is BreCheck => !!c && (c.jahr === Number(jahr) || (c.eingereicht.length === 0 && c.rechnungen.length > 0)));

  return (
    <article className="karte" style={{ '--farbe': person.farbe } as React.CSSProperties}>
      <h2>{person.name}</h2>

      <div className="kennzahl" onClick={() => { nav.setPersonFilter(person.id); nav.gehe('rechnungen'); }}>
        <span>Noch zu bezahlen</span>
        <strong className={unbezahlt.length ? '' : 'grau'}>{euro(unbezahlt.reduce((s, r) => s + r.betrag, 0))}</strong>
        <small>{unbezahlt.length} Rechnung(en)</small>
      </div>

      <h3>Noch einzureichen</h3>
      <ul className="kt-liste">
        {relevant.map((kt) => (
          <li key={kt}>
            <span>{KT_NAME[kt]}</span>
            {einreichen[kt].n > 0 ? (
              <button className="klein" onClick={() => nav.gehe('einreichungen', { neu: true, personId: person.id, kt })} title="Jetzt Einreichung anlegen">
                {einreichen[kt].n}× · {euro(einreichen[kt].betrag)} →
              </button>
            ) : (
              <span className="ok">✓</span>
            )}
          </li>
        ))}
      </ul>

      <h3>Erstattung ausstehend</h3>
      <ul className="kt-liste">
        {relevant.map((kt) => (
          <li key={kt}>
            <span>{KT_NAME[kt]}</span>
            {ausstehend[kt].n > 0 ? <strong>{euro(ausstehend[kt].erwartet)}</strong> : <span className="grau">–</span>}
          </li>
        ))}
      </ul>

      {breChecks.map((c) => <BreBox key={c.jahr} check={c} laufend={c.jahr === Number(jahr)} />)}

      <div className="fuss">
        <span>{jahr}: Rechnungen {euro(summeJahr)}</span>
        <span>Eigenanteil ≈ <strong>{euro(eigenJahr)}</strong></span>
      </div>
    </article>
  );
}

function BreBox({ check: c, laufend }: { check: BreCheck; laufend: boolean }) {
  const { speichereRechnung } = useStore();
  const setzen = (liste: Rechnung[], halten: boolean) => {
    for (const r of liste) {
      const ohne = r.nichtEinreichen.filter((k) => k !== 'pkv');
      speichereRechnung({ ...r, nichtEinreichen: halten ? [...ohne, 'pkv'] : ohne });
    }
  };

  if (c.eingereicht.length > 0) {
    return (
      <div className="bre">
        <h3>Beitragsrückerstattung {c.jahr}</h3>
        <p className="grau">Entfällt – bereits {c.eingereicht.length} Rechnung(en) bei der PKV eingereicht.</p>
      </div>
    );
  }

  return (
    <div className={`bre ${c.empfehlung}`}>
      <h3>Beitragsrückerstattung {c.jahr}{laufend && ' (laufend)'}</h3>
      <ul className="kt-liste">
        <li><span>Rechnungen ohne Vorsorge</span><span>{c.rechnungen.length}× · {euro(c.betrag)}</span></li>
        <li><span>Erstattung bei Einreichung</span><span>{euro(c.erstattungBeiEinreichung)}</span></li>
        <li><span>Beitragsrückerstattung</span><span>{euro(c.bre)}</span></li>
      </ul>
      <p className="empfehlung">
        {c.empfehlung === 'zurueckhalten'
          ? <>Empfehlung: <strong>zurückhalten</strong> – {euro(c.vorteil)} mehr als bei Einreichung.</>
          : <>Empfehlung: <strong>einreichen</strong> – {euro(c.vorteil)} mehr als die Rückerstattung.</>}
      </p>
      {laufend && c.empfehlung === 'zurueckhalten' && c.rechnungen.length > 0 && (
        <small className="grau">Das Jahr läuft noch – mit weiteren Rechnungen kann sich die Empfehlung ändern. Zurückgehaltene Rechnungen können nach Jahresende noch eingereicht werden.</small>
      )}
      <div className="zeile">
        {c.empfehlung === 'zurueckhalten' && c.offen.length > 0 && (
          <button className="klein primaer" onClick={() => setzen(c.offen, true)}>{c.offen.length} Rechnung(en) zurückhalten</button>
        )}
        {c.empfehlung === 'einreichen' && c.zurueckgehalten.length > 0 && (
          <button className="klein primaer" onClick={() => setzen(c.zurueckgehalten, false)}>{c.zurueckgehalten.length} Rechnung(en) zur Einreichung freigeben</button>
        )}
        {c.empfehlung === 'zurueckhalten' && c.zurueckgehalten.length > 0 && (
          <button className="klein" onClick={() => setzen(c.zurueckgehalten, false)}>Trotzdem freigeben</button>
        )}
      </div>
    </div>
  );
}

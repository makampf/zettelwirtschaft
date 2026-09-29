import { hinweise, rechnungUebersicht, traegerFuer } from '../calc';
import { Leer, PersonChip } from '../components/ui';
import { euro } from '../format';
import { useNav } from '../nav';
import { useStore } from '../store';
import { KOSTENTRAEGER, KT_NAME, type Kostentraeger, type Person } from '../types';

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
    const u = rechnungUebersicht(r, person, state.einreichungen);
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
  const relevant = KOSTENTRAEGER.filter((kt) => rechnungen.some((r) => traegerFuer(r.art).includes(kt)) || kt !== 'ppv');

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

      <div className="fuss">
        <span>{jahr}: Rechnungen {euro(summeJahr)}</span>
        <span>Eigenanteil ≈ <strong>{euro(eigenJahr)}</strong></span>
      </div>
    </article>
  );
}

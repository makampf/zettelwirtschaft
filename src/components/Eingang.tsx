import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { abrechnungAutomatisch, belegArt, einreichungenFuerAbrechnung, rechnungAusText, type EingangsEintrag } from '../eingang';
import { datum, euro } from '../format';
import { useNav, type Seite, type Ziel } from '../nav';
import { BescheidFormular } from '../pages/Submissions';
import { RechnungFormular } from '../pages/Invoices';
import { abrechnungAuslesen } from '../recognition/statement';
import { istLesbar, textAusDatei } from '../recognition/text';
import { useStore } from '../store';
import { ktKurz, type AppState, type Invoice, type Submission } from '../types';

// Eingang: holt Dokumente ab, die z. B. Paperless-ngx an /api/import geschickt hat, und erfasst sie automatisch.
// Was nicht eindeutig erkannt wird, bleibt im Eingang und wird auf der Übersicht zum Erfassen von Hand angeboten.

/** So oft wird nachgesehen, solange die App sichtbar ist. */
const ABRUF_MS = 2 * 60_000;

interface Protokoll {
  id: string;
  text: string;
  seite?: Seite;
  ziel?: Ziel;
}

interface EingangKontext {
  aktiv: boolean;
  eintraege: EingangsEintrag[];
  /** Was gerade verarbeitet wird. */
  laeuft: string | null;
  /** Automatisch erfasste Dokumente dieser Sitzung. */
  protokoll: Protokoll[];
  protokollLeeren: () => void;
  abrufen: () => Promise<void>;
}

const Ctx = createContext<EingangKontext | null>(null);

export function useEingang(): EingangKontext {
  const c = useContext(Ctx);
  if (!c) throw new Error('EingangProvider fehlt');
  return c;
}

function titelVon(e: EingangsEintrag): string {
  return e.data.title || e.name;
}

/** Überlagert den Zustand mit Änderungen dieses Durchlaufs (React übernimmt sie erst beim nächsten Rendern). */
function mitLokal(s: AppState, lokal: { invoices: Map<string, Invoice>; submissions: Map<string, Submission> }): AppState {
  const mische = <T extends { id: string }>(liste: T[], neu: Map<string, T>) => [...liste.filter((x) => !neu.has(x.id)), ...neu.values()];
  return { ...s, invoices: mische(s.invoices, lokal.invoices), submissions: mische(s.submissions, lokal.submissions) };
}

export function EingangProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const aktuell = useRef(store);
  aktuell.current = store;
  const api = store.eingang;
  const [eintraege, setEintraege] = useState<EingangsEintrag[]>([]);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [protokoll, setProtokoll] = useState<Protokoll[]>([]);
  const beschaeftigt = useRef(false);

  const abrufen = useCallback(async () => {
    if (!api || beschaeftigt.current) return;
    beschaeftigt.current = true;
    const lokal = { invoices: new Map<string, Invoice>(), submissions: new Map<string, Submission>() };
    const melde = (p: Protokoll) => setProtokoll((x) => [...x, p]);
    try {
      const liste = await api.liste();
      setEintraege(liste);
      for (const e of liste.filter((x) => x.status === 'new')) {
        if (!(await api.uebernehmen(e.id))) continue;
        const titel = titelVon(e);
        setLaeuft(`${titel} wird erfasst …`);
        try {
          const s = aktuell.current;
          if (s.state.files.some((f) => f.hash && f.hash === e.hash)) {
            await api.loeschen(e.id);
            melde({ id: e.id, text: `${titel}: als Beleg bereits vorhanden – aus dem Eingang entfernt` });
            continue;
          }
          const datei = await api.datei(e.id);
          if (!datei || !istLesbar(datei)) {
            await api.status(e.id, 'review', 'Kein lesbares PDF oder Bild');
            continue;
          }
          const text = await textAusDatei(datei, (t) => setLaeuft(`${titel}: ${t}`));
          const zustand = mitLokal(aktuell.current.state, lokal);

          if (belegArt(text, e.data) === 'invoice') {
            const erg = rechnungAusText(text, e.data, zustand);
            if ('grund' in erg) {
              await api.status(e.id, 'review', `Rechnung – ${erg.grund}`);
              continue;
            }
            const [meta] = await aktuell.current.dateienHinzufuegen([datei]);
            const r = { ...erg.ok, fileIds: [meta.id] };
            aktuell.current.speichereRechnung(r);
            lokal.invoices.set(r.id, r);
            await api.loeschen(e.id);
            const person = zustand.people.find((p) => p.id === r.personId);
            melde({
              id: e.id,
              text: `Rechnung ${r.provider} vom ${datum(r.date)} über ${euro(r.amount)} für ${person?.name ?? '?'} erfasst`,
              seite: 'rechnungen',
              ziel: { rechnungId: r.id },
            });
          } else {
            const PLATZHALTER = '\u0000beleg';
            const erg = abrechnungAutomatisch(text, zustand, PLATZHALTER);
            if ('grund' in erg) {
              await api.status(e.id, 'review', `Abrechnung – ${erg.grund}`);
              continue;
            }
            const [meta] = await aktuell.current.dateienHinzufuegen([datei]);
            const ersetze = (id: string) => (id === PLATZHALTER ? meta.id : id);
            for (const x of erg.ok) {
              const sub: Submission = {
                ...x,
                fileIds: x.fileIds.map(ersetze),
                items: x.items.map((p) => (p.fileId ? { ...p, fileId: ersetze(p.fileId) } : p)),
              };
              aktuell.current.speichereEinreichung(sub);
              lokal.submissions.set(sub.id, sub);
              const erstattet = sub.items.filter((p) => p.fileId === meta.id).reduce((sum, p) => sum + (p.reimbursed ?? 0), 0);
              const person = zustand.people.find((p) => p.id === sub.personIds[0]);
              melde({
                id: `${e.id}-${sub.id}`,
                text: `Abrechnung vom ${datum(sub.decisionDate)} der ${ktKurz(sub.payer, person)}-Einreichung vom ${datum(sub.submittedDate)} zugeordnet: ${euro(erstattet)} erstattet`,
                seite: 'einreichungen',
                ziel: { einreichungId: sub.id },
              });
            }
            await api.loeschen(e.id);
          }
        } catch (err) {
          await api.status(e.id, 'review', `Fehler beim Auslesen: ${err instanceof Error ? err.message : err}`).catch(() => undefined);
        }
      }
      setEintraege(await api.liste());
    } catch {
      // Server nicht erreichbar o. Ä. – beim nächsten Abruf erneut
    } finally {
      beschaeftigt.current = false;
      setLaeuft(null);
    }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    void abrufen();
    const sichtbar = () => {
      if (document.visibilityState === 'visible') void abrufen();
    };
    const timer = setInterval(sichtbar, ABRUF_MS);
    document.addEventListener('visibilitychange', sichtbar);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', sichtbar);
    };
  }, [api, abrufen]);

  return (
    <Ctx.Provider value={{ aktiv: !!api, eintraege, laeuft, protokoll, protokollLeeren: () => setProtokoll([]), abrufen }}>
      {children}
    </Ctx.Provider>
  );
}

type Formular = { typ: 'rechnung'; e: EingangsEintrag; datei: File } | { typ: 'bescheid'; e: EingangsEintrag; datei: File; text: string; einreichung: Submission };

/** Eingang auf der Übersicht: laufende Verarbeitung, automatisch Erfasstes und Dokumente zum Erfassen von Hand. */
export function EingangPanel() {
  const { state, eingang: api } = useStore();
  const { aktiv, eintraege, laeuft, protokoll, protokollLeeren, abrufen } = useEingang();
  const nav = useNav();
  const [formular, setFormular] = useState<Formular | null>(null);
  const [meldung, setMeldung] = useState<{ id: string; text: string } | null>(null);
  const [beschaeftigt, setBeschaeftigt] = useState<string | null>(null);
  const pruefen = eintraege.filter((e) => e.status === 'review');
  if (!aktiv || !api || (!pruefen.length && !protokoll.length && !laeuft)) return null;

  async function laden(e: EingangsEintrag): Promise<File | undefined> {
    const datei = await api!.datei(e.id);
    if (!datei) setMeldung({ id: e.id, text: 'Dokument nicht mehr vorhanden.' });
    return datei;
  }

  async function alsAbrechnung(e: EingangsEintrag) {
    setBeschaeftigt(e.id);
    setMeldung(null);
    try {
      const datei = await laden(e);
      if (!datei) return;
      const text = await textAusDatei(datei, (t) => setMeldung({ id: e.id, text: t }));
      const beste = einreichungenFuerAbrechnung(abrechnungAuslesen(text), state)[0];
      if (!beste) {
        setMeldung({ id: e.id, text: 'Keine Einreichung enthält Rechnungen aus dieser Abrechnung (Rechnungsdatum und Betrag müssen passen).' });
        return;
      }
      setMeldung(null);
      setFormular({ typ: 'bescheid', e, datei, text, einreichung: beste.e });
    } catch (err) {
      setMeldung({ id: e.id, text: `Konnte nicht ausgelesen werden: ${err instanceof Error ? err.message : err}` });
    } finally {
      setBeschaeftigt(null);
    }
  }

  const erledigt = (e: EingangsEintrag) => () => void api.loeschen(e.id).then(abrufen);

  return (
    <div className="karte eingang">
      <div className="eingang-kopf">
        <h2>📥 Eingang</h2>
        <button className="klein" onClick={() => void abrufen()} disabled={!!laeuft}>Jetzt abrufen</button>
      </div>
      {laeuft && <div className="lesestatus laeuft" role="status">⏳ {laeuft}</div>}

      {protokoll.length > 0 && (
        <>
          <ul className="eingang-liste">
            {protokoll.map((p) => (
              <li key={p.id}>
                <span>✓ {p.text}</span>
                {p.seite && <button className="klein" onClick={() => nav.gehe(p.seite!, p.ziel)}>Prüfen</button>}
              </li>
            ))}
          </ul>
          <button className="link klein" onClick={protokollLeeren}>Ausblenden</button>
        </>
      )}

      {pruefen.length > 0 && (
        <>
          <p className="grau">Diese Dokumente konnten nicht automatisch erfasst werden:</p>
          <ul className="eingang-liste">
            {pruefen.map((e) => (
              <li key={e.id}>
                <div>
                  <a href={api.dateiUrl(e.id)} target="_blank" rel="noreferrer">{titelVon(e)}</a>
                  <small className="grau">
                    {' '}· eingegangen {datum(e.receivedAt.slice(0, 10))}
                    {e.data.correspondent && ` · ${e.data.correspondent}`}
                    {e.data.doc_url && <> · <a href={e.data.doc_url} target="_blank" rel="noreferrer">in Paperless</a></>}
                  </small>
                  {e.note && <div className="grau"><small>{e.note}</small></div>}
                  {meldung?.id === e.id && <div className="lesestatus">{meldung.text}</div>}
                </div>
                <div className="knoepfe">
                  <button
                    className="klein primaer"
                    disabled={beschaeftigt === e.id}
                    onClick={async () => {
                      const datei = await laden(e);
                      if (datei) setFormular({ typ: 'rechnung', e, datei });
                    }}
                  >
                    Als Rechnung erfassen
                  </button>
                  <button className="klein" disabled={beschaeftigt === e.id} onClick={() => void alsAbrechnung(e)}>Als Abrechnung erfassen</button>
                  <button className="klein" title="Erneut automatisch auslesen" onClick={() => void api.status(e.id, 'new').then(abrufen)}>↻</button>
                  <button
                    className="klein"
                    title="Aus dem Eingang löschen"
                    onClick={() => {
                      if (confirm(`„${titelVon(e)}“ aus dem Eingang löschen? Das Dokument wird nicht erfasst.`)) erledigt(e)();
                    }}
                  >
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {formular?.typ === 'rechnung' && (
        <RechnungFormular belege={[formular.datei]} onClose={() => setFormular(null)} onGespeichert={erledigt(formular.e)} />
      )}
      {formular?.typ === 'bescheid' && (
        <BescheidFormular
          einreichung={formular.einreichung}
          beleg={formular.datei}
          text={formular.text}
          onClose={() => setFormular(null)}
          onGespeichert={erledigt(formular.e)}
        />
      )}
    </div>
  );
}

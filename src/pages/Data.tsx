import { useState } from 'react';
import { startState } from '../defaults';
import { backupErstellen, backupLesen } from '../backup';
import { dateigroesse, heute } from '../format';
import { useStore } from '../store';

export default function Data() {
  const { state, speicherArt, allesErsetzen } = useStore();
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const speicher = state.files.reduce((s, d) => s + d.size, 0);

  async function sichern() {
    setLaeuft(true);
    try {
      const blob = await backupErstellen(state);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `zettelwirtschaft-backup-${heute()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      setMeldung('Sicherung wurde heruntergeladen.');
    } catch (e) {
      setMeldung(`Fehler: ${e}`);
    } finally {
      setLaeuft(false);
    }
  }

  async function wiederherstellen(datei: File) {
    if (!confirm('Alle aktuellen Daten werden durch die Sicherung ersetzt. Fortfahren?')) return;
    setLaeuft(true);
    try {
      const { state: neu, dateien } = await backupLesen(datei);
      await allesErsetzen(neu, dateien);
      setMeldung(`Sicherung eingespielt: ${neu.invoices.length} Rechnungen, ${neu.submissions.length} Einreichungen, ${dateien.size} Dateien.`);
    } catch (e) {
      setMeldung(e instanceof Error ? e.message : String(e));
    } finally {
      setLaeuft(false);
    }
  }

  return (
    <section>
      <div className="seitenkopf">
        <h1>Daten &amp; Sicherung</h1>
      </div>
      {meldung && <div className="hinweis info">{meldung}</div>}

      <div className="karten">
        <article className="karte">
          <h2>Wo liegen meine Daten?</h2>
          {speicherArt === 'server' ? (
            <p>
              Alle Rechnungen, Einreichungen und Belege liegen in der <strong>Datenbank deines Servers</strong> (Postgres). Alle Geräte, die die App
              über diesen Server öffnen, sehen denselben Stand.
            </p>
          ) : (
            <p>
              Alle Rechnungen, Einreichungen und Belege werden <strong>nur lokal in diesem Browser</strong> gespeichert. Es wird nichts an einen Server
              übertragen.
            </p>
          )}
          <p className="grau">
            Aktuell: {state.people.length} Personen, {state.invoices.length} Rechnungen, {state.submissions.length} Einreichungen, {state.files.length} Belege (
            {dateigroesse(speicher)}).
          </p>
          {speicherArt === 'server' ? (
            <p className="grau">Sichere die Datenbank regelmäßig (z. B. mit pg_dump). Eine Sicherungsdatei kannst du zusätzlich hier herunterladen.</p>
          ) : (
            <>
              <p className="grau">Werden die Browserdaten gelöscht, sind auch diese Daten weg. Lege deshalb regelmäßig eine Sicherung an.</p>
              <p className="grau">
                Umzug auf den eigenen Server: hier „Sicherung herunterladen“, die App über den Server öffnen und dort „Sicherung einspielen“.
              </p>
            </>
          )}
        </article>

        <article className="karte">
          <h2>Sicherung</h2>
          <p>Exportiert alles inklusive Belegen in eine Datei. Diese kann auf einem anderen Gerät oder Browser wieder eingespielt werden.</p>
          <p className="grau">Die Datei enthält Gesundheitsdaten – bitte sicher aufbewahren.</p>
          <div className="zeile">
            <button className="primaer" disabled={laeuft} onClick={sichern}>Sicherung herunterladen</button>
            <label className="button">
              Sicherung einspielen …
              <input type="file" accept="application/json,.json" hidden disabled={laeuft} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void wiederherstellen(f); }} />
            </label>
          </div>
        </article>

        <article className="karte">
          <h2>Zurücksetzen</h2>
          <p>Löscht alle Daten und Belege unwiderruflich und beginnt mit den Standardpersonen neu.</p>
          <button
            className="gefahr"
            disabled={laeuft}
            onClick={async () => {
              if (confirm('Wirklich ALLE Daten löschen?') && confirm('Sicher? Das kann nicht rückgängig gemacht werden.')) {
                await allesErsetzen(startState(), new Map());
                setMeldung('Alle Daten wurden gelöscht.');
              }
            }}
          >
            Alle Daten löschen
          </button>
        </article>
      </div>
    </section>
  );
}

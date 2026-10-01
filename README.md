# 🧾 Zettelwirtschaft

[![Release](https://img.shields.io/github/v/release/makampf/zettelwirtschaft)](https://github.com/makampf/zettelwirtschaft/releases)
[![Lizenz: AGPL-3.0](https://img.shields.io/badge/Lizenz-AGPL--3.0-blue)](LICENSE)

Web-App zur Verwaltung von Arzt-, Apotheken- und Pflegerechnungen und deren Einreichung bei
**Beihilfe**, **privater Krankenversicherung (PKV)** und **privater Pflegeversicherung (PPV)** –
für mehrere Personen (voreingestellt: ich, Oma, Opa).

Die Daten liegen entweder in einer **Postgres-Datenbank auf dem eigenen Server** (empfohlen, für mehrere Geräte – siehe unten)
oder, in der GitHub-Pages- bzw. Datei-Version, **nur lokal im Browser** (IndexedDB). Es werden keine Daten an Dritte übertragen.

## Funktionen

- **Personen** mit oder ohne Beihilfeberechtigung (Beihilfestelle, Bemessungssätze getrennt für Krankheit/Pflege, Antragsfrist)
  sowie PKV/PPV mit Versicherer, Tarif und Erstattungsquote, **Selbstbehalt** (z. B. 20 % der Erstattung, max. 400 €/Jahr)
  und **Beitragsrückerstattung**. Kranken- und Pflegeversicherung sind standardmäßig **ein gemeinsamer Vertrag** (gleiche
  Nummer, eine Einreichung, gemeinsamer Selbstbehalt und BRE, eigene Quote für Pflege); bei Bedarf lässt sich die PPV abtrennen
- **Gemeinsam versicherte Personen** (z. B. Großeltern): Einreichungen und Belegliste enthalten die Rechnungen beider
  (die Verknüpfung wird bei beiden eingetragen; Versicherungsdaten lassen sich vom Partner übernehmen)
- **Rechnungen** erfassen (Krankheit oder Pflege) inkl. Belegen als PDF/Foto, Zahlungsziel und Bezahlt-Datum
  - **Duplikate:** Warnung bei gleicher Rechnungsnummer bzw. gleichem Datum und Betrag; derselbe Beleg (erkannt am Inhalt)
    wird nicht doppelt angehängt, und ein Hinweis zeigt, wo er schon hinterlegt ist
  - **Massenbearbeitung:** mehrere Rechnungen auswählen und gemeinsam als bezahlt markieren, zurückhalten/freigeben,
    Art, Vorsorge oder Person ändern oder löschen
  - **Aus Beleg erfassen:** PDF oder Foto hochladen (am Handy direkt mit der Kamera) – Betrag, Rechnungsdatum, Zahlungsziel,
    Rechnungsnummer, Leistungserbringer, Krankheit/Pflege, Vorsorge und die Person werden automatisch vorausgefüllt und
    zur Prüfung markiert. Das Auslesen läuft vollständig auf dem eigenen Gerät (PDF-Text bzw. Texterkennung im Browser);
    der Beleg wird an keinen fremden Dienst geschickt. Damit die Person erkannt wird, unter *Personen* den
    „Namen auf Rechnungen“ eintragen.
  - erwartete Erstattung wird aus den Quoten berechnet und kann pro Rechnung überschrieben werden (z. B. bei Pflege-Höchstbeträgen)
  - **Leistungserbringer-Vorschläge:** beim Antippen die zuletzt genutzten, beim Tippen gefiltert (auch ohne Umlaute/
    Groß-/Kleinschreibung). Die Auswahl übernimmt Art und – falls eindeutig – die Person der bisherigen Rechnungen.
  - **Verrechnungsstellen:** Rechnet eine Verrechnungsstelle im Auftrag eines Arztes ab, wird sie als „Abgerechnet über“
    erkannt und der behandelnde Arzt als Leistungserbringer übernommen. Einmal umbenannte Erbringer (z. B. „Praxis Dr. Beispiel“)
    werden beim nächsten Beleg wiedererkannt.
  - **Vorsorgeuntersuchungen** markieren: ohne Selbstbehalt und unschädlich für die Beitragsrückerstattung
  - Selbstbehalt wird je Kalenderjahr in Reihenfolge der Rechnungsdaten angerechnet, bis der Höchstbetrag erreicht ist
- **Beitragsrückerstattung (BRE)**: Neue Rechnungen werden bei der PKV zunächst zurückgehalten. Die Übersicht vergleicht je Jahr
  die mögliche Erstattung (nach Selbstbehalt) mit der BRE und empfiehlt *einreichen* oder *zurückhalten* – mit einem Klick umsetzbar.
  Beim Anlegen einer PKV-Einreichung warnt die App, wenn dadurch die BRE eines Jahres entfällt.
- **Einreichungen**: offene Rechnungen je Stelle bündeln – auch für mehrere Personen gemeinsam – Antragsnummer und Weg (App, Post …) festhalten,
  Belegliste zum Beilegen drucken. Zurückgehaltene Rechnungen (BRE) erscheinen dort ebenfalls und werden durch Auswählen freigegeben;
  angeboten werden nur Stellen, die für die Person zuständig sind (Beihilfe nur bei Berechtigung)
- **Bescheide** erfassen: tatsächlich erstattete Beträge und Kürzungsgründe je Rechnung; abgelehnte Rechnungen können erneut eingereicht werden
  - **Abrechnung einlesen:** PDF oder Foto einer Leistungsabrechnung bzw. eines Beihilfebescheids hochladen – die Positionen
    werden über Rechnungsdatum und Betrag den Rechnungen der passenden Einreichung zugeordnet, Erstattungen, Datum und
    „noch offen“ vorausgefüllt und mit der Gesamtsumme abgeglichen. Rechnungen, die in der Abrechnung fehlen, gelten als noch offen;
    wird eine Einreichung in mehreren Abrechnungen beschieden, behält jede Rechnung ihr eigenes Bescheiddatum und ihren Beleg.
- **Eingang für Paperless-ngx** (nur Server): Dokumente werden per Webhook automatisch angeliefert, ausgelesen und als
  Rechnung erfasst bzw. als Abrechnung der passenden Einreichung zugeordnet – siehe [Paperless-ngx anbinden](#paperless-ngx-anbinden)
- **Übersicht** je Person: was ist noch zu bezahlen, was noch einzureichen, welche Erstattungen stehen aus, Eigenanteil im Jahr
- **Hinweise** auf überfällige Zahlungen, ablaufende Beihilfe-Antragsfristen und Einreichungen, die seit über 6 Wochen ohne Bescheid sind
- **Auswertung** je Jahr und Person mit CSV-Export (hilfreich für außergewöhnliche Belastungen in der Steuererklärung)
- **Sicherung**: kompletter Export/Import inkl. Belegen als JSON-Datei

Statuslogik je Rechnung und Stelle: *noch einreichen* → *eingereicht* → *erstattet* / *abgelehnt* (oder *wird nicht eingereicht*).
Krankheitsrechnungen gehen an Beihilfe + PKV, Pflegerechnungen an Beihilfe + PKV (gemeinsamer Vertrag) bzw. Beihilfe + PPV
(getrennte Pflegeversicherung); ohne Beihilfeberechtigung nur an die Versicherung. Die Auswertung trennt weiterhin nach
Krankheit und Pflege.

## Benutzung

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.

```bash
npm install
npm run dev      # Entwicklungsserver, z. B. http://localhost:5173
npm run build    # erzeugt dist/index.html
npm test         # Unit-Tests der Berechnungslogik
```

`npm run build` erzeugt eine **einzige Datei** `dist/index.html`, die sich ohne Server per Doppelklick im Browser öffnen lässt.
Die Daten hängen am Browser (und bei `file://` am Speicherort) – bitte immer denselben Browser verwenden und regelmäßig
unter **Daten → Sicherung herunterladen** sichern.

## Auf dem Homeserver betreiben (Postgres)

Wird die App über den mitgelieferten Server geöffnet, speichert sie alles – inklusive Belegen – in einer **Postgres-Datenbank**.
Alle Geräte (PC, Handy, Tablet) sehen dann denselben Stand. Oben neben dem Namen steht „· Server“ bzw. „· Browser“, damit klar ist,
wo gerade gespeichert wird.

### Variante A: mit eigener Postgres (am einfachsten)

```bash
git clone https://github.com/makampf/zettelwirtschaft.git && cd zettelwirtschaft
cp .env.example .env        # Passwörter in .env anpassen!
docker compose up -d        # oder: docker compose up -d --build  (Image selbst bauen)
```

Danach ist die App unter `http://<homeserver>:8080` erreichbar (Anmeldung mit `APP_USER` / `APP_PASSWORD` aus der `.env`).

Das fertige Image `ghcr.io/makampf/zettelwirtschaft` baut GitHub Actions bei jedem Release (Tags `latest` und die Versionsnummer, z. B. `1.2.0`). Ist das Paket auf GitHub privat,
vorher `docker login ghcr.io` ausführen oder das Paket unter *GitHub → Packages → Package settings* öffentlich schalten –
alternativ mit `docker compose up -d --build` lokal bauen.

### Variante B: vorhandene Postgres-Instanz nutzen

In der vorhandenen Datenbank einen Benutzer und eine Datenbank anlegen:

```sql
CREATE USER zettelwirtschaft WITH PASSWORD 'geheim';
CREATE DATABASE zettelwirtschaft OWNER zettelwirtschaft;
```

Dann nur den App-Container starten (Tabellen legt die App beim ersten Start selbst an):

```bash
docker run -d --name zettelwirtschaft --restart unless-stopped -p 8080:8080 \
  -e DATABASE_URL=postgres://zettelwirtschaft:geheim@<postgres-host>:5432/zettelwirtschaft \
  -e APP_USER=familie -e APP_PASSWORD=bitte-aendern \
  ghcr.io/makampf/zettelwirtschaft:latest
```

Läuft die vorhandene Postgres selbst in Docker, den Container in dasselbe Docker-Netzwerk hängen (`--network <netz>`) und als
Host den Dienstnamen der Datenbank verwenden.

### Einstellungen

| Variable | Bedeutung |
|---|---|
| `DATABASE_URL` | Verbindung zur Postgres-Datenbank (Pflicht) |
| `APP_USER`, `APP_PASSWORD` | Anmeldung für die App (dringend empfohlen – ohne Passwort ist die App offen) |
| `PORT` | Port des Servers, Standard `8080` |
| `MAX_UPLOAD_MB` | Maximale Größe eines Belegs, Standard `25` |
| `IMPORT_TOKEN` | Zugangsschlüssel für den Import von Dokumenten (z. B. aus Paperless-ngx), mind. 16 Zeichen; ohne Angabe ist der Import abgeschaltet |

### Paperless-ngx anbinden

Rechnungen und Abrechnungen, die in [Paperless-ngx](https://docs.paperless-ngx.com/) landen, kann die App automatisch übernehmen.

1. Einen zufälligen Schlüssel erzeugen (`openssl rand -hex 24`) und als `IMPORT_TOKEN` in die `.env` eintragen,
   dann `docker compose up -d`.
2. In Paperless unter *Workflows* einen Workflow anlegen:
   - **Auslöser:** *Dokument hinzugefügt*, gefiltert z. B. auf einen Tag „Zettelwirtschaft“ oder die Dokumenttypen
     für Arztrechnungen und Abrechnungen
   - **Aktion:** *Webhook*
     - URL: `http://<homeserver>:8080/api/import`
     - *Dokument einschließen* aktivieren und *Parameter für den Webhook-Body verwenden* einschalten (nicht *als JSON senden*)
     - Parameter (alle optional): `title` = `{{ doc_title }}`, `document_type` = `{{ document_type }}`,
       `correspondent` = `{{ correspondent }}`, `doc_url` = `{{ doc_url }}`
       (ältere Paperless-Versionen schreiben Platzhalter mit einfachen Klammern: `{doc_title}`)
     - Header: `Authorization` = `Bearer <IMPORT_TOKEN>`
3. Falls Paperless Webhooks einschränkt (`PAPERLESS_WEBHOOKS_ALLOWED_PORTS`, `PAPERLESS_WEBHOOKS_ALLOW_INTERNAL_REQUESTS`),
   Port und Adresse der App dort freigeben.

Ablauf: Der Server legt jedes Dokument im **Eingang** ab (doppelte Dokumente – gleicher Inhalt – werden ignoriert). Die App
holt den Eingang ab, sobald sie geöffnet ist (danach alle 2 Minuten), und liest jedes Dokument wie einen hochgeladenen Beleg
auf dem eigenen Gerät aus:

- **Rechnung oder Abrechnung?** Ein Dokumenttyp bzw. Titel mit „Abrechnung“, „Bescheid“ oder „Erstattung“ steht für eine Abrechnung,
  einer mit „Rechnung“ für eine Rechnung; sonst entscheidet der Text. Eindeutig festlegen lässt es sich mit dem Parameter
  `kind` = `invoice` bzw. `statement` (z. B. ein Workflow je Dokumenttyp).
- **Rechnungen** werden angelegt, wenn Betrag, Rechnungsdatum, Person und Leistungserbringer erkannt werden (ersatzweise der
  Korrespondent aus Paperless) und kein mögliches Duplikat existiert. Sie sind mit „prüfen“ markiert, bis sie einmal im
  Formular gespeichert wurden.
- **Abrechnungen** werden übernommen, wenn die Stelle (Beihilfe oder Versicherung) erkennbar ist, alle Positionen über
  Rechnungsdatum und Betrag passen und die Gesamtsumme aufgeht – auch verteilt auf mehrere Einreichungen.
- Alles andere bleibt im Eingang auf der **Übersicht** mit dem Grund und lässt sich dort mit einem Klick als Rechnung bzw.
  Abrechnung erfassen, erneut auslesen oder löschen.

Ohne Paperless lässt sich der Import auch per Skript nutzen:

```sh
curl -H "Authorization: Bearer $IMPORT_TOKEN" -F file=@rechnung.pdf -F kind=invoice http://<homeserver>:8080/api/import
```

Antwort: `201` (im Eingang abgelegt), `200` mit `"duplicate": true` (schon vorhanden), `401` (falscher Schlüssel),
`413` (zu groß), `415` (kein PDF/Bild). Der Import-Pfad braucht keine App-Anmeldung, nur den Schlüssel.

### Sicherheit

Die App enthält Gesundheitsdaten. Bitte nur im Heimnetz oder über VPN (z. B. WireGuard, Tailscale) erreichbar machen, oder
– falls aus dem Internet – ausschließlich per HTTPS hinter einem Reverse Proxy (z. B. Caddy, Traefik, nginx).
Die Anmeldung erfolgt per HTTP Basic Auth und ist ohne HTTPS nicht abhörsicher.

### Daten übernehmen und sichern

- **Umzug aus der Browser-Version:** in der bisherigen Version *Daten → Sicherung herunterladen*, dann die App über den Server
  öffnen und dort *Daten → Sicherung einspielen*.
- **Backup der Datenbank:** `docker compose exec db pg_dump -U zettelwirtschaft zettelwirtschaft > zettelwirtschaft-$(date +%F).sql`
  (enthält auch alle Belege).
- Die Daten stehen als JSON (Spalte `data`) in den Tabellen `people`, `invoices`, `submissions`; Belege in `files`,
  noch nicht erfasste Dokumente aus dem Import in `inbox`.
  Beispiel: `SELECT data->>'provider', (data->>'amount')::int / 100.0 FROM invoices;`

## Online-Version

Die App wird bei jedem Push automatisch über GitHub Pages veröffentlicht:
**https://makampf.github.io/zettelwirtschaft/**

Veröffentlicht wird nur das Programm – die eingegebenen Daten bleiben weiterhin ausschließlich im Browser des jeweiligen Geräts.
Daten zwischen Geräten (z. B. PC und Handy) lassen sich über **Daten → Sicherung** übertragen.

## Hinweise

- Bemessungssätze (üblich: 50 % aktiv, 70 % Versorgungsempfänger) und Antragsfristen unterscheiden sich zwischen Bund und Ländern –
  bitte unter **Personen** an die eigenen Bescheide anpassen.
- Die erwarteten Beträge sind Schätzungen; maßgeblich sind die Bescheide.

## Technik

- App: React + TypeScript + Vite, gebaut als eine einzige HTML-Datei. Berechnungslogik in `src/calc.ts`.
- Belege auslesen (`src/recognition/`): pdf.js für PDFs mit Textebene, tesseract.js (deutsche Sprachdaten) für Fotos und Scans,
  danach Heuristiken für deutsche Rechnungen (`parser.ts`). Die OCR-Dateien werden beim Build nach `dist/ocr/` kopiert
  und von GitHub Pages bzw. dem eigenen Server ausgeliefert; nur die per Doppelklick geöffnete Datei-Version lädt sie vom CDN.
- Speicherung (`src/storage.ts`): Server-Datenbank, wenn die App vom Server kommt, sonst IndexedDB im Browser.
  Der Server-Speicher überträgt nur geänderte Datensätze.
- Server (`server/`): Node.js + Hono + Postgres; liefert die App aus und stellt eine kleine REST-API bereit.
- Tests mit Vitest; die Server-Tests laufen gegen eine echte Postgres, wenn `TEST_DATABASE_URL` gesetzt ist:

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/test npm test   # Achtung: leert diese Datenbank
DATABASE_URL=postgres://… npm run server:dev                         # Server im Entwicklungsmodus
```

## Versionen und Releases

Die Versionsnummer steht unten in der App. Releases entstehen automatisch nach [Semantic Versioning](https://semver.org/lang/de/):
Bei jedem Push auf `main` wertet [semantic-release](https://semantic-release.gitbook.io/) die Commit-Nachrichten aus
([Conventional Commits](https://www.conventionalcommits.org/de/)), erhöht die Version, schreibt das [CHANGELOG](CHANGELOG.md),
legt ein GitHub-Release an und veröffentlicht danach GitHub Pages und das Docker-Image.

| Commit | Wirkung |
|---|---|
| `fix: …` | Patch-Release, z. B. 1.2.0 → 1.2.1 |
| `feat: …` | Minor-Release, z. B. 1.2.0 → 1.3.0 |
| `feat!: …` oder `BREAKING CHANGE:` im Text | Major-Release, z. B. 1.2.0 → 2.0.0 |
| `docs:`, `chore:`, `ci:`, `test:`, `refactor:` … | kein Release |

Commit-Nachrichten werden auf Englisch geschrieben; ein Git-Hook prüft das Format (aktiviert durch `npm install`).

## Lizenz

[GNU Affero General Public License v3.0](LICENSE). Mitgelieferte Bibliotheken stehen unter eigenen Lizenzen, siehe [NOTICE](NOTICE).

# 🧾 Rechnungsmanager

Web-App zur Verwaltung von Arzt-, Apotheken- und Pflegerechnungen und deren Einreichung bei
**Beihilfe**, **privater Krankenversicherung (PKV)** und **privater Pflegeversicherung (PPV)** –
für mehrere Personen (voreingestellt: ich, Oma, Opa).

Die Daten liegen entweder in einer **Postgres-Datenbank auf dem eigenen Server** (empfohlen, für mehrere Geräte – siehe unten)
oder, in der GitHub-Pages- bzw. Datei-Version, **nur lokal im Browser** (IndexedDB). Es werden keine Daten an Dritte übertragen.

## Funktionen

- **Personen** mit oder ohne Beihilfeberechtigung (Beihilfestelle, Bemessungssätze getrennt für Krankheit/Pflege, Antragsfrist)
  sowie PKV/PPV mit Versicherer, Tarif und Erstattungsquote, **Selbstbehalt** (z. B. 20 % der Erstattung, max. 400 €/Jahr –
  wahlweise gemeinsam für Kranken- und Pflegeversicherung) und **Beitragsrückerstattung**
- **Gemeinsam versicherte Personen** (z. B. Großeltern): Einreichungen und Belegliste enthalten die Rechnungen beider
- **Rechnungen** erfassen (Krankheit oder Pflege) inkl. Belegen als PDF/Foto, Zahlungsziel und Bezahlt-Datum
  - erwartete Erstattung wird aus den Quoten berechnet und kann pro Rechnung überschrieben werden (z. B. bei Pflege-Höchstbeträgen)
  - **Vorsorgeuntersuchungen** markieren: ohne Selbstbehalt und unschädlich für die Beitragsrückerstattung
  - Selbstbehalt wird je Kalenderjahr in Reihenfolge der Rechnungsdaten angerechnet, bis der Höchstbetrag erreicht ist
- **Beitragsrückerstattung (BRE)**: Neue Rechnungen werden bei der PKV zunächst zurückgehalten. Die Übersicht vergleicht je Jahr
  die mögliche Erstattung (nach Selbstbehalt) mit der BRE und empfiehlt *einreichen* oder *zurückhalten* – mit einem Klick umsetzbar.
  Beim Anlegen einer PKV-Einreichung warnt die App, wenn dadurch die BRE eines Jahres entfällt.
- **Einreichungen**: offene Rechnungen je Stelle bündeln – auch für mehrere Personen gemeinsam – Antragsnummer und Weg (App, Post …) festhalten,
  Belegliste zum Beilegen drucken
- **Bescheide** erfassen: tatsächlich erstattete Beträge und Kürzungsgründe je Rechnung; abgelehnte Rechnungen können erneut eingereicht werden
- **Übersicht** je Person: was ist noch zu bezahlen, was noch einzureichen, welche Erstattungen stehen aus, Eigenanteil im Jahr
- **Hinweise** auf überfällige Zahlungen, ablaufende Beihilfe-Antragsfristen und Einreichungen, die seit über 6 Wochen ohne Bescheid sind
- **Auswertung** je Jahr und Person mit CSV-Export (hilfreich für außergewöhnliche Belastungen in der Steuererklärung)
- **Sicherung**: kompletter Export/Import inkl. Belegen als JSON-Datei

Statuslogik je Rechnung und Stelle: *noch einreichen* → *eingereicht* → *erstattet* / *abgelehnt* (oder *wird nicht eingereicht*).
Krankheitsrechnungen gehen an Beihilfe + PKV, Pflegerechnungen an Beihilfe + PPV (ohne Beihilfeberechtigung nur an PKV bzw. PPV).

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
git clone https://github.com/makampf/claudetest.git rechnungsmanager && cd rechnungsmanager
cp .env.example .env        # Passwörter in .env anpassen!
docker compose up -d        # oder: docker compose up -d --build  (Image selbst bauen)
```

Danach ist die App unter `http://<homeserver>:8080` erreichbar (Anmeldung mit `APP_USER` / `APP_PASSWORD` aus der `.env`).

Das fertige Image `ghcr.io/makampf/claudetest:latest` baut GitHub Actions bei jedem Push. Ist das Paket auf GitHub privat,
vorher `docker login ghcr.io` ausführen oder das Paket unter *GitHub → Packages → Package settings* öffentlich schalten –
alternativ mit `docker compose up -d --build` lokal bauen.

### Variante B: vorhandene Postgres-Instanz nutzen

In der vorhandenen Datenbank einen Benutzer und eine Datenbank anlegen:

```sql
CREATE USER rechnungen WITH PASSWORD 'geheim';
CREATE DATABASE rechnungen OWNER rechnungen;
```

Dann nur den App-Container starten (Tabellen legt die App beim ersten Start selbst an):

```bash
docker run -d --name rechnungsmanager --restart unless-stopped -p 8080:8080 \
  -e DATABASE_URL=postgres://rechnungen:geheim@<postgres-host>:5432/rechnungen \
  -e APP_USER=familie -e APP_PASSWORD=bitte-aendern \
  ghcr.io/makampf/claudetest:latest
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

### Sicherheit

Die App enthält Gesundheitsdaten. Bitte nur im Heimnetz oder über VPN (z. B. WireGuard, Tailscale) erreichbar machen, oder
– falls aus dem Internet – ausschließlich per HTTPS hinter einem Reverse Proxy (z. B. Caddy, Traefik, nginx).
Die Anmeldung erfolgt per HTTP Basic Auth und ist ohne HTTPS nicht abhörsicher.

### Daten übernehmen und sichern

- **Umzug aus der Browser-Version:** in der bisherigen Version *Daten → Sicherung herunterladen*, dann die App über den Server
  öffnen und dort *Daten → Sicherung einspielen*.
- **Backup der Datenbank:** `docker compose exec db pg_dump -U rechnungen rechnungen > rechnungen-$(date +%F).sql`
  (enthält auch alle Belege).
- Die Daten stehen als JSON in den Tabellen `personen`, `rechnungen`, `einreichungen`; Belege in `dateien`.
  Beispiel: `SELECT daten->>'leistungserbringer', (daten->>'betrag')::int / 100.0 FROM rechnungen;`

## Online-Version

Die App wird bei jedem Push automatisch über GitHub Pages veröffentlicht:
**https://makampf.github.io/claudetest/**

Veröffentlicht wird nur das Programm – die eingegebenen Daten bleiben weiterhin ausschließlich im Browser des jeweiligen Geräts.
Daten zwischen Geräten (z. B. PC und Handy) lassen sich über **Daten → Sicherung** übertragen.

## Hinweise

- Bemessungssätze (üblich: 50 % aktiv, 70 % Versorgungsempfänger) und Antragsfristen unterscheiden sich zwischen Bund und Ländern –
  bitte unter **Personen** an die eigenen Bescheide anpassen.
- Die erwarteten Beträge sind Schätzungen; maßgeblich sind die Bescheide.

## Technik

- App: React + TypeScript + Vite, gebaut als eine einzige HTML-Datei. Berechnungslogik in `src/calc.ts`.
- Speicherung (`src/speicher.ts`): Server-Datenbank, wenn die App vom Server kommt, sonst IndexedDB im Browser.
  Der Server-Speicher überträgt nur geänderte Datensätze.
- Server (`server/`): Node.js + Hono + Postgres; liefert die App aus und stellt eine kleine REST-API bereit.
- Tests mit Vitest; die Server-Tests laufen gegen eine echte Postgres, wenn `TEST_DATABASE_URL` gesetzt ist:

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5432/test npm test   # Achtung: leert diese Datenbank
DATABASE_URL=postgres://… npm run server:dev                         # Server im Entwicklungsmodus
```

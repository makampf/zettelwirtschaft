# Hinweise für die Arbeit an diesem Repository

## Datenschutz – verbindlich

Dieses Repository ist **öffentlich**. Die App verwaltet Gesundheitsdaten. Deshalb gilt ausnahmslos:

1. **Niemals echte Daten committen** – weder als Datei noch als Text:
   - keine Rechnungen, Belege, Bescheide, Fotos, Screenshots, Sicherungsdateien (`*.json`-Exporte), Datenbank-Dumps
   - keine echten Angaben in Code, Tests, Kommentaren, Commit-Nachrichten, PR-Texten oder Issues:
     Namen, Adressen, Geburtsdaten, Rechnungs-/Kunden-/Versicherungsnummern, LANR, BSNR, Steuernummern, IBAN,
     Beträge und Daten aus echten Belegen, Fachrichtungen/Diagnosen, Namen oder Orte von Praxen und Leistungserbringern.
2. **Testdaten sind frei erfunden**: Max/Erika/Hans Mustermann, Musterweg, 90000 Musterstadt, erfundene Nummern.
   Nicht als „Nachbildung echter Belege“ bezeichnen und keine Details echter Belege übernehmen (auch nicht Fachrichtung,
   Ort oder Layout-Besonderheiten, die auf eine konkrete Praxis schließen lassen).
3. **Echte Belege, die zur Fehlersuche geteilt werden, nur außerhalb des Repositorys auswerten** (Scratchpad/Temp),
   nie ins Arbeitsverzeichnis kopieren. Erkenntnisse in anonymisierte, allgemeine Testfälle übertragen.
4. **Vor jedem Commit** `git diff --cached` auf echte Daten prüfen. `scripts/privacy-check.sh` läuft als
   Git-Hook (`.githooks/pre-commit`, aktiviert durch `npm install`) und in CI – sie ersetzt die eigene Prüfung nicht.
5. **Wird doch etwas gefunden:** sofort den Nutzer informieren und die Historie bereinigen (nach Rücksprache).

## Commits, Versionen und Releases

- **Commit-Nachrichten auf Englisch nach [Conventional Commits](https://www.conventionalcommits.org/)**:
  `feat: …`, `fix: …`, `perf: …`, `refactor: …`, `docs: …`, `test: …`, `build: …`, `ci: …`, `chore: …`;
  Breaking Changes mit `!` oder `BREAKING CHANGE:`. Der Hook `.githooks/commit-msg` prüft das Format.
- Releases entstehen automatisch: Der Workflow `.github/workflows/release.yml` führt bei jedem Push auf `main`
  semantic-release aus (Version in `package.json`, `CHANGELOG.md`, Git-Tag, GitHub-Release) und veröffentlicht
  danach GitHub Pages und das Docker-Image. Version und `CHANGELOG.md` nie von Hand ändern.
- Die Version erscheint im Footer der App (`__APP_VERSION__`, siehe `vite.config.ts`).

## Entwicklung

- `npm install`, `npm run dev`, `npm test`, `npm run build`
- Server-Tests brauchen Postgres: `TEST_DATABASE_URL=postgres://… npm test` (leert diese Datenbank)
- Oberfläche, Code-Kommentare und Doku auf Deutsch; Commit-Nachrichten auf Englisch
- Lizenz: AGPL-3.0; Drittlizenzen in `NOTICE` und `dist/THIRD-PARTY-LICENSES.txt` (`scripts/third-party-licenses.mjs`)

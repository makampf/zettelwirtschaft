# 🧾 Rechnungsmanager

Web-App zur Verwaltung von Arzt-, Apotheken- und Pflegerechnungen und deren Einreichung bei
**Beihilfe**, **privater Krankenversicherung (PKV)** und **privater Pflegeversicherung (PPV)** –
für mehrere Personen (voreingestellt: ich, Oma, Opa).

Alle Daten bleiben **lokal im Browser** (IndexedDB). Es gibt keinen Server, kein Konto und keine Übertragung von Gesundheitsdaten.

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

React + TypeScript + Vite, Speicherung in IndexedDB, Tests mit Vitest. Die Berechnungslogik liegt in `src/calc.ts`.

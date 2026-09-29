#!/usr/bin/env bash
# Verhindert, dass Belege, Fotos, Sicherungen oder Datenbank-Dumps ins (öffentliche) Repository gelangen.
# Aufruf ohne Argumente: prüft alle versionierten Dateien. Mit Argumenten: prüft nur diese Dateien.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ "$#" -gt 0 ]; then dateien=("$@"); else mapfile -t dateien < <(git ls-files); fi

verboten='\.(pdf|jpe?g|png|gif|webp|heic|heif|tiff?|bmp|sql|dump|backup|bak)$|sicherung[^/]*\.json$|rechnungsmanager-sicherung'
fund=0
for f in "${dateien[@]}"; do
  if printf '%s\n' "$f" | grep -qiE "$verboten"; then
    echo "✗ Nicht erlaubt (mögliche echte Daten): $f"
    fund=1
  fi
done

if [ "$fund" -ne 0 ]; then
  echo
  echo "Belege, Bilder, Sicherungen und Dumps gehören nicht ins Repository (siehe CLAUDE.md, Abschnitt Datenschutz)."
  exit 1
fi
echo "✓ Datenschutz-Prüfung: keine verbotenen Dateien"

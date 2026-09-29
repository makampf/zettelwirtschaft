import { eigeneStandardwerte } from './beispiel';
import type { AppState, Person, Rechnung } from './types';

/**
 * Bringt gespeicherte Daten älterer Versionen auf den aktuellen Stand.
 * Version 1 kannte weder Beihilfeberechtigung, Selbstbehalt, BRE noch Vorsorge.
 */
export function migriere(alt: unknown): AppState {
  const s = alt as AppState & { version: number };
  if (s.version >= 2) return s;

  const personen = s.personen.map((p) => {
    const alt = p as Person;
    const neu: Person = {
      ...alt,
      beihilfe: { ...alt.beihilfe, berechtigt: alt.beihilfe.berechtigt ?? true },
      pkv: {
        ...alt.pkv,
        selbstbehaltProzent: alt.pkv.selbstbehaltProzent ?? 0,
        selbstbehaltMax: alt.pkv.selbstbehaltMax ?? 0,
        bre: alt.pkv.bre ?? 0,
      },
    };
    // „Ich“ mit unveränderten Standardwerten der Version 1 → jetzt: nicht beihilfeberechtigt, 100 % PKV
    const unveraendert = !alt.beihilfe.stelle && alt.beihilfe.satzKrankheit === 50 && alt.pkv.quote === 50;
    return alt.name === 'Ich' && unveraendert ? eigeneStandardwerte(neu) : neu;
  });
  const rechnungen = s.rechnungen.map((r) => ({ ...r, vorsorge: (r as Rechnung).vorsorge ?? false }));
  return { ...s, version: 2, personen, rechnungen };
}

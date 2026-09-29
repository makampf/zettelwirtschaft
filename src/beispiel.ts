import { neueId } from './format';
import type { AppState, Person } from './types';

export function neuePerson(name: string, farbe: string, beihilfeSatz: number | null): Person {
  const satz = beihilfeSatz ?? 0;
  return {
    id: neueId(),
    name,
    farbe,
    beihilfe: { berechtigt: beihilfeSatz != null, stelle: '', aktenzeichen: '', satzKrankheit: satz, satzPflege: satz, fristMonate: 12 },
    pkv: { name: '', nummer: '', quote: 100 - satz, selbstbehaltProzent: 0, selbstbehaltMax: 0, bre: 0 },
    ppv: { name: '', nummer: '', quote: 100 - satz },
    notiz: '',
  };
}

/** Standardwerte für mich: nicht beihilfeberechtigt, 100 % PKV mit 20 % Selbstbehalt (max. 400 €/Jahr) und BRE. */
export function eigeneStandardwerte(p: Person): Person {
  return {
    ...p,
    beihilfe: { ...p.beihilfe, berechtigt: false, satzKrankheit: 0, satzPflege: 0 },
    pkv: { ...p.pkv, quote: 100, selbstbehaltProzent: 20, selbstbehaltMax: 40000, bre: 100000 },
    ppv: { ...p.ppv, quote: 100 },
  };
}

/** Startzustand: ich selbst (nur PKV) und die Großeltern als Versorgungsempfänger (70 % Beihilfe). */
export function startState(): AppState {
  return {
    version: 2,
    personen: [eigeneStandardwerte(neuePerson('Ich', '#2563eb', null)), neuePerson('Oma', '#db2777', 70), neuePerson('Opa', '#059669', 70)],
    rechnungen: [],
    einreichungen: [],
    dateien: [],
  };
}

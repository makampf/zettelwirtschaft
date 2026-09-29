import { neueId } from './format';
import type { AppState, Person } from './types';

function person(name: string, farbe: string, satz: number): Person {
  return {
    id: neueId(),
    name,
    farbe,
    beihilfe: { stelle: '', aktenzeichen: '', satzKrankheit: satz, satzPflege: satz, fristMonate: 12 },
    pkv: { name: '', nummer: '', quote: 100 - satz },
    ppv: { name: '', nummer: '', quote: 100 - satz },
    notiz: '',
  };
}

/** Startzustand: ich selbst (50 % Beihilfe) und die Großeltern als Versorgungsempfänger (70 %). */
export function startState(): AppState {
  return {
    version: 1,
    personen: [person('Ich', '#2563eb', 50), person('Oma', '#db2777', 70), person('Opa', '#059669', 70)],
    rechnungen: [],
    einreichungen: [],
    dateien: [],
  };
}

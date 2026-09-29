import { neueId } from './format';
import type { AppState, Person } from './types';

export function neuePerson(name: string, farbe: string, beihilfeSatz: number | null): Person {
  const satz = beihilfeSatz ?? 0;
  return {
    id: neueId(),
    name,
    farbe,
    beihilfe: { berechtigt: beihilfeSatz != null, stelle: '', aktenzeichen: '', satzKrankheit: satz, satzPflege: satz, fristMonate: 12 },
    pkv: { name: '', tarif: '', nummer: '', quote: 100 - satz, selbstbehaltProzent: 0, selbstbehaltMax: 0, breAktiv: false, bre: 0, mitPflege: false },
    ppv: { name: '', tarif: '', nummer: '', quote: 100 - satz },
    notiz: '',
  };
}

/** Standardwerte für „Ich“: nicht beihilfeberechtigt, 100 % Versicherung mit 20 % Selbstbehalt (max. 400 €/Jahr für KV + PV) und BRE. */
export function eigeneStandardwerte(p: Person): Person {
  return {
    ...p,
    beihilfe: { ...p.beihilfe, berechtigt: false, satzKrankheit: 0, satzPflege: 0 },
    pkv: {
      ...p.pkv,
      quote: 100,
      selbstbehaltProzent: 20,
      selbstbehaltMax: 40000,
      breAktiv: true,
      bre: 100000,
      mitPflege: true,
    },
    ppv: { ...p.ppv, quote: 100 },
  };
}

/** Standardwerte für die Großeltern: Beihilfe (70 %) plus Versicherung mit Beitragsrückerstattung (Betrag noch offen). */
export function grosselternStandardwerte(p: Person): Person {
  return { ...p, pkv: { ...p.pkv, breAktiv: true } };
}

/** Startzustand: ich selbst (nur Versicherung) und die gemeinsam versicherten Großeltern (70 % Beihilfe). */
export function startState(): AppState {
  const oma = grosselternStandardwerte(neuePerson('Oma', '#db2777', 70));
  const opa = grosselternStandardwerte(neuePerson('Opa', '#059669', 70));
  oma.partnerId = opa.id;
  opa.partnerId = oma.id;
  return {
    version: 4,
    personen: [eigeneStandardwerte(neuePerson('Ich', '#2563eb', null)), oma, opa],
    rechnungen: [],
    einreichungen: [],
    dateien: [],
  };
}

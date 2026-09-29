import { eigeneStandardwerte, grosselternStandardwerte } from './defaults';
import type { AppState, Einreichung, Person, Rechnung } from './types';

type Beliebig = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Bringt gespeicherte Daten älterer Versionen schrittweise auf den aktuellen Stand.
 * v1 → v2: Beihilfeberechtigung, Selbstbehalt, BRE, Vorsorge.
 * v2 → v3: Tarifnamen, gemeinsamer Selbstbehalt KV + PV, gemeinsam versicherte Personen,
 *          Einreichungen für mehrere Personen.
 * v3 → v4: BRE auch mit (noch) unbekanntem Betrag.
 */
export function migriere(alt: unknown): AppState {
  let s = alt as Beliebig;
  if (s.version < 2) s = v1zuV2(s);
  if (s.version < 3) s = v2zuV3(s);
  if (s.version < 4) s = v3zuV4(s);
  return s as AppState;
}

function v1zuV2(s: Beliebig): Beliebig {
  const personen = s.personen.map((p: Beliebig) => {
    const neu = {
      ...p,
      beihilfe: { ...p.beihilfe, berechtigt: p.beihilfe.berechtigt ?? true },
      pkv: { ...p.pkv, selbstbehaltProzent: p.pkv.selbstbehaltProzent ?? 0, selbstbehaltMax: p.pkv.selbstbehaltMax ?? 0, bre: p.pkv.bre ?? 0 },
    };
    // „Ich“ mit unveränderten Standardwerten der Version 1 → nicht beihilfeberechtigt, 100 % PKV
    const unveraendert = !p.beihilfe.stelle && p.beihilfe.satzKrankheit === 50 && p.pkv.quote === 50;
    return p.name === 'Ich' && unveraendert ? { ...neu, beihilfe: { ...neu.beihilfe, berechtigt: false }, pkv: { ...neu.pkv, quote: 100, selbstbehaltProzent: 20, selbstbehaltMax: 40000, bre: 100000 }, ppv: { ...p.ppv, quote: 100 } } : neu;
  });
  const rechnungen = s.rechnungen.map((r: Beliebig) => ({ ...r, vorsorge: r.vorsorge ?? false }));
  return { ...s, version: 2, personen, rechnungen };
}

function v3zuV4(s: Beliebig): Beliebig {
  const personen = s.personen.map((p: Beliebig) => ({
    ...p,
    pkv: { ...p.pkv, breAktiv: p.pkv.breAktiv ?? p.pkv.bre > 0 },
  }));
  return { ...s, version: 4, personen };
}

function v2zuV3(s: Beliebig): Beliebig {
  let personen: Person[] = s.personen.map((p: Beliebig) => {
    const neu: Person = {
      ...p,
      pkv: { ...p.pkv, tarif: p.pkv.tarif ?? '', mitPflege: p.pkv.mitPflege ?? false },
      ppv: { ...p.ppv, tarif: p.ppv.tarif ?? '' },
    } as Person;
    // Bekannte Tarife ergänzen, soweit noch nichts eingetragen ist
    if (neu.name === 'Ich' && !neu.beihilfe.berechtigt && neu.pkv.selbstbehaltProzent > 0) return eigeneStandardwerte(neu);
    if (neu.name === 'Oma' || neu.name === 'Opa') return grosselternStandardwerte(neu);
    return neu;
  });
  // Oma und Opa sind gemeinsam versichert
  const oma = personen.find((p) => p.name === 'Oma');
  const opa = personen.find((p) => p.name === 'Opa');
  if (oma && opa && !oma.partnerId && !opa.partnerId) {
    personen = personen.map((p) => (p === oma ? { ...p, partnerId: opa.id } : p === opa ? { ...p, partnerId: oma.id } : p));
  }
  const einreichungen: Einreichung[] = s.einreichungen.map((e: Beliebig) => {
    const { personId, ...rest } = e;
    return { ...rest, personIds: e.personIds ?? [personId] };
  });
  return { ...s, version: 3, personen, einreichungen, rechnungen: s.rechnungen as Rechnung[] };
}

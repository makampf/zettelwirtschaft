import { heute, neueId } from './format';
import type { AppState, Invoice, Person, ServiceKind } from './types';

export function neuePerson(name: string, farbe: string, beihilfeSatz: number | null): Person {
  const satz = beihilfeSatz ?? 0;
  return {
    id: neueId(),
    name,
    color: farbe,
    beihilfe: { eligible: beihilfeSatz != null, office: '', reference: '', rateIllness: satz, rateCare: satz, deadlineMonths: 12 },
    pkv: { name: '', tariff: '', number: '', rate: 100 - satz, deductiblePercent: 0, deductibleMax: 0, premiumRefundEnabled: false, premiumRefund: 0, includesCare: true },
    ppv: { name: '', tariff: '', number: '', rate: 100 - satz },
    note: '',
  };
}

/** Standardwerte für „Ich“: nicht beihilfeberechtigt, 100 % Versicherung mit 20 % Selbstbehalt (max. 400 €/Jahr für KV + PV) und BRE. */
export function eigeneStandardwerte(p: Person): Person {
  return {
    ...p,
    beihilfe: { ...p.beihilfe, eligible: false, rateIllness: 0, rateCare: 0 },
    pkv: {
      ...p.pkv,
      rate: 100,
      deductiblePercent: 20,
      deductibleMax: 40000,
      premiumRefundEnabled: true,
      premiumRefund: 100000,
      includesCare: true,
    },
    ppv: { ...p.ppv, rate: 100 },
  };
}

/** Standardwerte für die Großeltern: Beihilfe (70 %) plus Versicherung mit Beitragsrückerstattung (Betrag noch offen). */
export function grosselternStandardwerte(p: Person): Person {
  return { ...p, pkv: { ...p.pkv, premiumRefundEnabled: true } };
}

/** Startzustand: ich selbst (nur Versicherung) und die gemeinsam versicherten Großeltern (70 % Beihilfe). */
export function startState(): AppState {
  const oma = grosselternStandardwerte(neuePerson('Oma', '#db2777', 70));
  const opa = grosselternStandardwerte(neuePerson('Opa', '#059669', 70));
  oma.partnerId = opa.id;
  opa.partnerId = oma.id;
  return {
    version: 1,
    people: [eigeneStandardwerte(neuePerson('Ich', '#2563eb', null)), oma, opa],
    invoices: [],
    submissions: [],
    files: [],
  };
}

/** Leere Rechnung als Vorlage für das Formular bzw. den automatischen Import. */
export function leereRechnung(personId: string, art: ServiceKind = 'illness'): Invoice {
  return {
    id: neueId(),
    personId,
    kind: art,
    date: heute(),
    provider: '',
    invoiceNumber: '',
    description: '',
    amount: 0,
    preventive: false,
    heldBack: [],
    expectedOverride: {},
    fileIds: [],
    note: '',
  };
}

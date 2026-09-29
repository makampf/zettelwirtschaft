/** Art der Leistung: Krankheitskosten oder Pflegekosten. */
export type Leistungsart = 'krankheit' | 'pflege';

/** Stellen, bei denen eine Rechnung eingereicht werden kann. */
export type Kostentraeger = 'beihilfe' | 'pkv' | 'ppv';

export const KOSTENTRAEGER: Kostentraeger[] = ['beihilfe', 'pkv', 'ppv'];

export const KT_NAME: Record<Kostentraeger, string> = {
  beihilfe: 'Beihilfe',
  pkv: 'Private Krankenversicherung',
  ppv: 'Private Pflegeversicherung',
};

export const KT_KURZ: Record<Kostentraeger, string> = {
  beihilfe: 'Beihilfe',
  pkv: 'PKV',
  ppv: 'PPV',
};

export const ART_NAME: Record<Leistungsart, string> = {
  krankheit: 'Krankheit',
  pflege: 'Pflege',
};

export type Einreichungsweg = 'post' | 'app' | 'online' | 'fax' | 'sonstig';

export const WEG_NAME: Record<Einreichungsweg, string> = {
  post: 'Post',
  app: 'App',
  online: 'Online-Portal',
  fax: 'Fax',
  sonstig: 'Sonstiges',
};

export interface Person {
  id: string;
  name: string;
  farbe: string;
  beihilfe: {
    /** Ohne Beihilfeberechtigung gehen Rechnungen nur an PKV bzw. PPV. */
    berechtigt: boolean;
    stelle: string;
    aktenzeichen: string;
    /** Bemessungssatz in Prozent für Krankheitskosten. */
    satzKrankheit: number;
    /** Bemessungssatz in Prozent für Pflegekosten. */
    satzPflege: number;
    /** Antragsfrist in Monaten ab Rechnungsdatum. */
    fristMonate: number;
  };
  pkv: {
    name: string;
    nummer: string;
    /** Erstattungsquote in Prozent. */
    quote: number;
    /** Selbstbehalt in Prozent der Erstattung (Vorsorge ausgenommen). */
    selbstbehaltProzent: number;
    /** Höchstbetrag des Selbstbehalts pro Kalenderjahr in Cent. */
    selbstbehaltMax: number;
    /** Beitragsrückerstattung pro leistungsfreiem Jahr in Cent (0 = keine). */
    bre: number;
  };
  ppv: { name: string; nummer: string; /** Erstattungsquote in Prozent. */ quote: number };
  notiz: string;
}

export interface DateiMeta {
  id: string;
  name: string;
  typ: string;
  groesse: number;
}

export interface Rechnung {
  id: string;
  personId: string;
  art: Leistungsart;
  /** Rechnungsdatum (YYYY-MM-DD). */
  datum: string;
  leistungserbringer: string;
  rechnungsnummer: string;
  beschreibung: string;
  /** Rechnungsbetrag in Cent. */
  betrag: number;
  /** Vorsorgeuntersuchung: kein Selbstbehalt und BRE-unschädlich. */
  vorsorge: boolean;
  faelligAm?: string;
  bezahltAm?: string;
  /** Kostenträger, bei denen bewusst nicht eingereicht wird (z. B. wegen Beitragsrückerstattung). */
  nichtEinreichen: Kostentraeger[];
  /** Manuell festgelegte erwartete Erstattung in Cent (überschreibt die Berechnung aus den Quoten). */
  erwartetManuell: Partial<Record<Kostentraeger, number>>;
  dateiIds: string[];
  notiz: string;
}

export interface Position {
  rechnungId: string;
  /** Erstatteter Betrag laut Bescheid in Cent. */
  erstattet?: number;
  bemerkung?: string;
}

export type EinreichungStatus = 'eingereicht' | 'beschieden';

export interface Einreichung {
  id: string;
  personId: string;
  kostentraeger: Kostentraeger;
  eingereichtAm: string;
  weg: Einreichungsweg;
  /** Antrags-/Vorgangsnummer. */
  referenz: string;
  status: EinreichungStatus;
  bescheidAm?: string;
  /** Datum des Geldeingangs auf dem Konto. */
  gutschriftAm?: string;
  positionen: Position[];
  dateiIds: string[];
  notiz: string;
}

export interface AppState {
  version: 2;
  personen: Person[];
  rechnungen: Rechnung[];
  einreichungen: Einreichung[];
  dateien: DateiMeta[];
}

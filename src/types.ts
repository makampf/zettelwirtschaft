/** Art der Leistung: Krankheitskosten oder Pflegekosten. */
export type ServiceKind = 'illness' | 'care';

/** Stellen, bei denen eine Rechnung eingereicht werden kann. */
export type Payer = 'beihilfe' | 'pkv' | 'ppv';

export const KOSTENTRAEGER: Payer[] = ['beihilfe', 'pkv', 'ppv'];

export const KT_NAME: Record<Payer, string> = {
  beihilfe: 'Beihilfe',
  pkv: 'Private Krankenversicherung',
  ppv: 'Private Pflegeversicherung',
};

export const KT_KURZ: Record<Payer, string> = {
  beihilfe: 'Beihilfe',
  pkv: 'PKV',
  ppv: 'PPV',
};

export const ART_NAME: Record<ServiceKind, string> = {
  illness: 'Krankheit',
  care: 'Pflege',
};

export type SubmissionChannel = 'mail' | 'app' | 'online' | 'fax' | 'other';

export const WEG_NAME: Record<SubmissionChannel, string> = {
  mail: 'Post',
  app: 'App',
  online: 'Online-Portal',
  fax: 'Fax',
  other: 'Sonstiges',
};

export interface Person {
  id: string;
  name: string;
  color: string;
  /** Gemeinsam versicherte Person (z. B. Ehepartner): Einreichungen enthalten standardmäßig beide. */
  partnerId?: string;
  /** Name(n), unter denen die Person auf Rechnungen steht (kommagetrennt) – für das Auslesen von Belegen. */
  invoiceNames?: string;
  beihilfe: {
    /** Ohne Beihilfeberechtigung gehen Rechnungen nur an PKV bzw. PPV. */
    eligible: boolean;
    office: string;
    reference: string;
    /** Bemessungssatz in Prozent für Krankheitskosten. */
    rateIllness: number;
    /** Bemessungssatz in Prozent für Pflegekosten. */
    rateCare: number;
    /** Antragsfrist in Monaten ab Rechnungsdatum. */
    deadlineMonths: number;
  };
  pkv: {
    name: string;
    tariff: string;
    number: string;
    /** Erstattungsquote in Prozent. */
    rate: number;
    /** Selbstbehalt in Prozent der Erstattung (Vorsorge ausgenommen). */
    deductiblePercent: number;
    /** Höchstbetrag des Selbstbehalts pro Kalenderjahr in Cent. */
    deductibleMax: number;
    /** Tarif hat eine Beitragsrückerstattung (Betrag ggf. noch unbekannt). */
    premiumRefundEnabled: boolean;
    /** Beitragsrückerstattung pro leistungsfreiem Jahr in Cent (0 = Betrag unbekannt). */
    premiumRefund: number;
    /** Selbstbehalt und BRE gelten gemeinsam für Kranken- und Pflegeversicherung. */
    includesCare: boolean;
  };
  ppv: { name: string; tariff: string; number: string; /** Erstattungsquote in Prozent. */ rate: number };
  note: string;
}

export interface FileMeta {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface Invoice {
  id: string;
  personId: string;
  kind: ServiceKind;
  /** Rechnungsdatum (YYYY-MM-DD). */
  date: string;
  provider: string;
  invoiceNumber: string;
  description: string;
  /** Rechnungsbetrag in Cent. */
  amount: number;
  /** Vorsorgeuntersuchung: kein Selbstbehalt und BRE-unschädlich. */
  preventive: boolean;
  dueDate?: string;
  paidDate?: string;
  /** Kostenträger, bei denen bewusst nicht eingereicht wird (z. B. wegen Beitragsrückerstattung). */
  heldBack: Payer[];
  /** Manuell festgelegte erwartete Erstattung in Cent (überschreibt die Berechnung aus den Quoten). */
  expectedOverride: Partial<Record<Payer, number>>;
  fileIds: string[];
  note: string;
}

export interface SubmissionItem {
  invoiceId: string;
  /** Erstatteter Betrag laut Bescheid in Cent. */
  reimbursed?: number;
  remark?: string;
}

export type SubmissionStatus = 'submitted' | 'decided';

export interface Submission {
  id: string;
  /** Personen, deren Rechnungen enthalten sind (bei gemeinsamer Versicherung mehrere). */
  personIds: string[];
  payer: Payer;
  submittedDate: string;
  channel: SubmissionChannel;
  /** Antrags-/Vorgangsnummer. */
  reference: string;
  status: SubmissionStatus;
  decisionDate?: string;
  /** Datum des Geldeingangs auf dem Konto. */
  paymentDate?: string;
  items: SubmissionItem[];
  fileIds: string[];
  note: string;
}

export interface AppState {
  version: 1;
  people: Person[];
  invoices: Invoice[];
  submissions: Submission[];
  files: FileMeta[];
}

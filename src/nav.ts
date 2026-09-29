import type { Kostentraeger } from './types';
import { createContext, useContext } from 'react';

export type Seite = 'uebersicht' | 'rechnungen' | 'einreichungen' | 'auswertung' | 'personen' | 'daten';

export interface Ziel {
  rechnungId?: string;
  einreichungId?: string;
  /** Neues Element anlegen, optional vorbelegt mit Person und Kostenträger. */
  neu?: boolean;
  personId?: string;
  kt?: Kostentraeger;
}

export interface Nav {
  seite: Seite;
  /** Gewählte Person oder '' für alle. */
  personFilter: string;
  setPersonFilter: (id: string) => void;
  gehe: (seite: Seite, ziel?: Ziel) => void;
  /** Einmaliges Sprungziel, das die Zielseite beim Öffnen auswertet. */
  ziel?: Ziel;
  zielErledigt: () => void;
}

export const NavCtx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const n = useContext(NavCtx);
  if (!n) throw new Error('NavCtx fehlt');
  return n;
}

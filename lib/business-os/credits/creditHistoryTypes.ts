/**
 * The owner's credit history payload (credit deduction slice 7a, workplan
 * §4.6; FR-26, FR-28, SA SQ-38).
 *
 * CLIENT-SAFE, and imports NOTHING at all (a source guard pins it). In
 * particular it does not name the entitlements `Labels` type: the label is
 * the local `CreditHistoryLabel` below (SA C-S7-1), so this file is not an
 * importer of that module.
 *
 * What is deliberately NOT here: no account id, no action id, no group id, no
 * raw service or action type, no credit value version, no reason code, no
 * tokens, no dollars, no cost, no model and no fallback flag. The client gets
 * an area code and a label, never the raw identifiers. The payload test holds
 * the exact key set and scans every key and value.
 *
 * @module lib/business-os/credits/creditHistoryTypes
 */

/** A label in the three platform languages; the panel picks the reader's. */
export interface CreditHistoryLabel {
  en: string;
  he: string;
  es: string;
}

/** One line of the history: one charged action, or one correction. */
export interface CreditHistoryLine {
  /** The ledger row id: the line's identity for the client, nothing more. */
  id: string;
  /** When it happened: a millisecond ISO instant, display only. */
  at: string;
  /** An area code (the panel names it from its dictionary), or null when the action declares none. */
  area: string | null;
  /** The plain-language label, or null — shown as "Other activity", still counted. */
  label: CreditHistoryLabel | null;
  /** "You" or "Automatic"; null for a correction whose charge cannot be found. */
  who: 'you' | 'automatic' | null;
  /** The action failed; its credits are still shown and counted (FR-8). */
  didNotComplete: boolean;
  /** A correction to an earlier charge: its own signed line. */
  isCorrection: boolean;
  /** Exact (6 dp); the panel rounds for display (D-m). */
  credits: number;
}

export type CreditHistoryPeriodKind = 'monthly' | 'trial_total' | 'calendar_month';

/** The first page's summary: the window and its figures — the card's own. */
export interface CreditHistorySummary {
  period: {
    kind: CreditHistoryPeriodKind;
    /** When the window began (the period start, or the trial anchor), millisecond ISO, display only. */
    startsOn: string;
    /** When the next period starts, only when the card shows a reset date (the same value). */
    endsBefore: string | null;
  };
  /** Exact, 6 dp: the card's figure, from the totals row(s) — never a page sum. */
  used: number;
  usedByOwner: number;
  usedAutomatic: number;
}

/** One page. The window changed since the cursor was made: start again from page one. */
export interface CreditHistoryRestart {
  restart: true;
}

export interface CreditHistoryPage {
  /** On the first page only. */
  summary?: CreditHistorySummary;
  lines: CreditHistoryLine[];
  /** Opaque; sent back byte for byte for the next page. Null on the last page. */
  nextCursor: string | null;
}

export type OwnerCreditHistoryPage = CreditHistoryRestart | CreditHistoryPage;

/**
 * The operator cost report's payload (credit deduction slice 4a, FR-33).
 *
 * Server side. The admin page re-declares this shape in
 * `app/admin/business-os-llm/costTypes.ts`, because its source guard forbids
 * any `@/lib/` import (V-19); `__tests__/creditReport.wireTypes.test.ts` pins
 * that the two stay assignable (checked by `tsc`, not by Jest — ts-jest emits
 * no type diagnostics here).
 *
 * Money: `costUsd` is USD, the AI provider's measured cost; `credits` are
 * credits. Never combined with a business's own currency.
 *
 * @module lib/business-os/credits/creditReportTypes
 */

/** Why the report may be incomplete. Each is a read that stopped at its ceiling. */
export type CreditReportIncompleteReason = 'totals_ceiling' | 'rows_ceiling' | 'originals_ceiling';

/** A section's read state. `skipped`: a read it depends on failed first. */
export type CreditReportSectionStatus = 'ok' | 'failed' | 'skipped';

/** The figures of one account period, by the TOTALS ROW's own rules (SA S-7). */
export interface CreditPeriodFigures {
  creditsTotal: number;
  creditsOwner: number;
  creditsScheduled: number;
  creditsExternal: number;
  /** Signed. Adjustment rows only; never inside owner / scheduled / external. */
  creditsAdjustment: number;
  costUsd: number;
  /** Charge rows only; adjustments are not counted. */
  charges: number;
  fallbackPriced: number;
}

export interface CreditPeriodLine {
  accountId: string;
  companyName: string | null;
  periodStart: string;
  /** The stored totals row. NULL only for rows whose period has no totals row (an invariant break). */
  stored: CreditPeriodFigures | null;
  /** The same figures rebuilt from the period's rows. NULL when the rows could not be read. */
  fromRows: CreditPeriodFigures | null;
  /**
   * `true` equal, `false` a mismatch (both figures shown, never hidden), `null`
   * not checked: the rows were not read, or the read stopped at its ceiling.
   */
  matches: boolean | null;
}

/**
 * One line of a breakdown. NET, INCLUDING CORRECTIONS: an adjustment is counted
 * under the charge it corrects (N-10, Q-5), so these lines are not the totals
 * row's owner / scheduled / external split.
 */
export interface CreditBreakdownLine {
  /** The effective value; NULL for "not declared" (area) or an unresolved correction. */
  key: string | null;
  /** True on the one line holding corrections whose charge could not be found. */
  unresolved: boolean;
  charges: number;
  failedCharges: number;
  corrections: number;
  /** Net: charges plus corrections. */
  credits: number;
  costUsd: number;
  /** The corrections' share of `credits` / `costUsd` (signed). */
  correctionCredits: number;
  correctionCostUsd: number;
}

export interface CreditBreakdowns {
  byActionType: CreditBreakdownLine[];
  byArea: CreditBreakdownLine[];
  byService: CreditBreakdownLine[];
  byTrigger: CreditBreakdownLine[];
}

export interface CreditFallbackItem {
  accountId: string;
  companyName: string | null;
  createdAt: string;
  actionType: string | null;
  groupId: string | null;
  actionId: string | null;
  credits: number;
  costUsd: number;
  /** A `fallback_price_reconciled` correction of this charge exists (part 4c). */
  reconciled: boolean;
}

export interface CreditSpreadFigures {
  p50: number | null;
  p90: number | null;
}

/** p50 / p90 over SUCCEEDED, non-fallback charges of one action type (SA S-6). */
export interface CreditSpreadLine {
  service: string | null;
  actionType: string | null;
  area: string | null;
  /** How many succeeded charges the figures are computed over. */
  examples: number;
  /** Shown beside the figures; not inside them. */
  failed: number;
  /** Fallback-priced charges left out (a deliberate over-estimate). */
  fallbackExcluded: number;
  fewExamples: boolean;
  costUsd: CreditSpreadFigures;
  credits: CreditSpreadFigures;
}

export interface CreditReportAccount {
  accountId: string;
  companyName: string | null;
}

export interface CreditReport {
  generatedAt: string;
  window: {
    /** Inclusive UTC dates, as asked. */
    from: string;
    to: string;
    /** The instants: [start, end). */
    start: string;
    end: string;
  };
  /** The account the report was narrowed to, or NULL for all accounts. */
  accountFilter: string | null;
  /**
   * Which periods are shown: every totals row whose period started on or
   * before the window's last day and at most this many days before its first
   * day (a billing period is never longer).
   */
  periodLookbackDays: number;
  incomplete: boolean;
  incompleteReasons: CreditReportIncompleteReason[];
  limits: {
    totalsCeiling: number;
    rowsCeiling: number;
    originalsMax: number;
    fallbackListMax: number;
    fewExamplesBelow: number;
  };
  sections: {
    totals: CreditReportSectionStatus;
    rows: CreditReportSectionStatus;
    names: CreditReportSectionStatus;
    originals: CreditReportSectionStatus;
  };
  /** Ledger rows (charges and corrections) the figures were rebuilt from; NULL when not read. */
  rowsRead: number | null;
  /** Every account with a period in the window, for the account filter. */
  accounts: CreditReportAccount[];
  periods: CreditPeriodLine[];
  /** Sums over `periods`: stored, and rebuilt from rows (NULL when rows were not read). */
  grandTotal: { stored: CreditPeriodFigures; fromRows: CreditPeriodFigures | null };
  /** Periods whose check found a mismatch. */
  mismatchedPeriods: number;
  /** NULL when the rows were not read. */
  breakdowns: CreditBreakdowns | null;
  unresolvedCorrections: { count: number; credits: number; costUsd: number };
  fallback: { count: number; reconciled: number; items: CreditFallbackItem[] };
  spreads: CreditSpreadLine[];
  /** Ledger amounts that could not be read as numbers (counted as 0). Expected 0. */
  unreadableAmounts: number;
}

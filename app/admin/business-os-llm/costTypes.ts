/**
 * The wire shape of `GET /api/admin/business-os/credits/report`, as the CLIENT
 * sees it (credit deduction slice 4a).
 *
 * ── Why these are re-declared instead of imported ─────────────────────────
 * The server declares this shape in `lib/business-os/credits/creditReportTypes.ts`,
 * and this page's source guard forbids any `@/lib/` import (the same reason
 * `types.ts` re-declares the settings payload). The duplication is PINNED by
 * `lib/business-os/credits/__tests__/creditReport.wireTypes.test.ts`, evaluated
 * by `npm run typecheck:bos-llm` (not by Jest, which checks no types here).
 * Run the gate after editing either side.
 */

export type CostSectionStatus = 'ok' | 'failed' | 'skipped';

export type CostIncompleteReason = 'totals_ceiling' | 'rows_ceiling' | 'originals_ceiling';

export interface CostPeriodFigures {
  creditsTotal: number;
  creditsOwner: number;
  creditsScheduled: number;
  creditsExternal: number;
  creditsAdjustment: number;
  costUsd: number;
  charges: number;
  fallbackPriced: number;
}

export interface CostPeriodLine {
  accountId: string;
  companyName: string | null;
  periodStart: string;
  stored: CostPeriodFigures | null;
  fromRows: CostPeriodFigures | null;
  matches: boolean | null;
}

export interface CostBreakdownLine {
  key: string | null;
  unresolved: boolean;
  charges: number;
  failedCharges: number;
  corrections: number;
  credits: number;
  costUsd: number;
  correctionCredits: number;
  correctionCostUsd: number;
}

export interface CostBreakdowns {
  byActionType: CostBreakdownLine[];
  byArea: CostBreakdownLine[];
  byService: CostBreakdownLine[];
  byTrigger: CostBreakdownLine[];
}

export interface CostFallbackItem {
  accountId: string;
  companyName: string | null;
  createdAt: string;
  actionType: string | null;
  groupId: string | null;
  actionId: string | null;
  credits: number;
  costUsd: number;
  reconciled: boolean;
}

export interface CostSpreadLine {
  service: string | null;
  actionType: string | null;
  area: string | null;
  examples: number;
  failed: number;
  fallbackExcluded: number;
  fewExamples: boolean;
  costUsd: { p50: number | null; p90: number | null };
  credits: { p50: number | null; p90: number | null };
}

export interface CostReportPayload {
  generatedAt: string;
  window: { from: string; to: string; start: string; end: string };
  accountFilter: string | null;
  periodLookbackDays: number;
  incomplete: boolean;
  incompleteReasons: CostIncompleteReason[];
  limits: {
    totalsCeiling: number;
    rowsCeiling: number;
    originalsMax: number;
    fallbackListMax: number;
    fewExamplesBelow: number;
  };
  sections: {
    totals: CostSectionStatus;
    rows: CostSectionStatus;
    names: CostSectionStatus;
    originals: CostSectionStatus;
  };
  rowsRead: number | null;
  accounts: { accountId: string; companyName: string | null }[];
  periods: CostPeriodLine[];
  grandTotal: { stored: CostPeriodFigures; fromRows: CostPeriodFigures | null };
  mismatchedPeriods: number;
  breakdowns: CostBreakdowns | null;
  unresolvedCorrections: { count: number; credits: number; costUsd: number };
  fallback: { count: number; reconciled: number; items: CostFallbackItem[] };
  spreads: CostSpreadLine[];
  unreadableAmounts: number;
}

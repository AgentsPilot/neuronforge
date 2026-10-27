/**
 * The Summary & checks tab's bar values (Admin Layout Standard L-9a, workplan
 * §2.4; Money MK-2 and MK-3). Pure: no React, no fetch, no `'use client'`.
 *
 * Money MK-3b (SA-CR-MK3B F-2): the tab's own URL spec (`COSTS_FILTER_SPEC`)
 * and request builder (`costsRouteSearch`) are retired. The AI cost page owns
 * ONE spec for both tabs and builds the report request itself
 * (`app/admin/ai-cost/aiCostFilters.ts`: `AI_COST_FILTER_SPEC`, `reportSearch`).
 * What stays here is what the bar (`CostsFilterBar`) shows: the shape of the
 * window and the business it edits, its default (This month, Finance's, since
 * MK-2) and the extra window it offers after Custom (90 days). Both equal the
 * page spec's (pinned by `__tests__/costsFilters.test.ts`).
 */

import type { AdminWindowExtra, AdminWindowValue } from '@/app/admin/components/layout/adminWindow';

export interface CostsFilters {
  /** The page's window (default This month). */
  window: AdminWindowValue;
  /** One business; the report's `accountId`. '' = every business. */
  account: string;
}

export const COSTS_DEFAULT_WINDOW: AdminWindowValue = { kind: 'preset', preset: 'this_month' };

/** The window this tab offered beyond the standard five (D-2 (b)), after Custom. */
export const COSTS_WINDOW_EXTRAS: readonly AdminWindowExtra[] = ['90d'];

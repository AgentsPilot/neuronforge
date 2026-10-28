/**
 * The `my-plan` payload, as the route sends it — client-side, types only.
 *
 * Moved out of `PlanSection.tsx` (upgrade modal UM-1a) so the drawer, the
 * checkout / upgrade flow (`usePlanFlow`) and the plan comparison modal read
 * ONE description of what they receive. `PlanSection.tsx` re-exports
 * `PlanPayload`, so every existing importer resolves unchanged.
 *
 * Mirrored rather than imported: `customerPlanView` is `server-only`. The shape
 * is held honest by `payload.contract.test.tsx`, which renders this component
 * against a recorded body and fails when the two drift.
 *
 * No import from `lib/business-os/entitlements/` here, type-only included
 * (upgrade modal C-6): `enforcementPoints.test.ts` refuses a UI file that
 * reaches into the module.
 */

import type { PlanPurchaseWire } from '@/lib/business-os/billing/planPurchaseTypes';

import type { PlanChoice } from './PlanPurchase';

export interface PlanFeature {
  capability: string;
  label: string;
  value: string;
}

/**
 * One row: a category and the features in it, already joined server-side.
 *
 * The component prints `summary`; it does not build it. Twenty-eight flat lines
 * became nine rows (2026-09-27), and AI chat's ten entries are deliberately one
 * long line rather than a "+N more" expander — an expander is a new interaction
 * on a read-only screen, and hiding most of what a plan includes is the opposite
 * of what this section is for.
 */
/**
 * A sentence the server named but did not write: a dictionary key, and an ISO
 * date where the sentence mentions a day.
 *
 * Declared here rather than imported from `customerPlanView`, for the reason
 * every other payload shape in this file is: the component describes what it
 * receives over HTTP, and importing the server's type would make a UI file
 * reach into the entitlements module — which `enforcementPoints.test.ts`
 * refuses, and was right to refuse when this first tried it.
 */
export interface PlanSentence {
  key: string;
  date?: string | null;
  /** P-6a.2: the `{count}` slot (`plan.payment_failed_on`'s attempts so far). */
  count?: number | null;
}

export interface PlanCategory {
  category: string;
  /** A dictionary key, so the heading is read in the viewer's language. */
  labelKey: string;
  /**
   * A dictionary key for the sentence under the row, or `null` (credit deduction
   * slice 6, D-h). The server chooses it — monthly or one-off by the allowance's
   * shape — and this component only renders it.
   */
  noteKey: string | null;
  features: PlanFeature[];
  summary: string;
}

export interface PlanChange {
  capability: string;
  label: string;
  from: string;
  to: string;
}

/**
 * The plan above (`nextPlanUp`). Named `PlanUpgradeView` here so it does not
 * shadow the `PlanUpgrade` component (UM-1a workplan §4.1); the shape is
 * unchanged.
 */
export interface PlanUpgradeView {
  planId: string;
  name: string;
  monthlyPriceUsd: number;
  availableToBuy: boolean;
  actionUnavailableBecause: PlanSentence | null;
  adds: PlanCategory[];
  improves: PlanChange[];
  /** Different there, but not rankable — shown as a change, never as a gain. */
  changes: PlanChange[];
}

export interface PlanPayload {
  status: 'ok' | 'no_plan_record' | 'unavailable';
  planId: string | null;
  name: string | null;
  kind: 'tier' | 'cohort' | null;
  monthlyPriceUsd: number | null;
  free: boolean;
  state: string | null;
  accessEndsAt: string | null;
  endsWhen: PlanSentence | null;
  whenThisChanges: PlanSentence | null;
  included: PlanCategory[];
  nextPlanUp: PlanUpgradeView | null;
  /**
   * Every plan shown to customers (P-4.2). Optional, like `purchase`: an older
   * payload, or the builder's own output in a test, has neither and renders as
   * the read-only section did.
   */
  plans?: PlanChoice[];
  /** What may be bought, and what our billing record says (P-4.2). `null` when unknown. */
  purchase?: PlanPurchaseWire | null;
  /**
   * The plans shown to customers, side by side (upgrade modal UM-0, UM-D1).
   * Optional (SA Q-13): an older payload, or the builder's own output in a
   * test, has none, and reads as "no comparison" — the UI never builds one.
   * `null` on every non-`ok` answer.
   */
  comparison?: PlanComparison | null;
  /**
   * SX-2 (D3): what changes when the paid plan ends, for the Cancel drawer's
   * "What changes" step (`planEndingView`). Set only where Cancel is offered:
   * from the period end when our billing record says renewing, or from today
   * when a renewal payment is failing (P-7a.4 ends the plan now; D3 T-13);
   * `null` otherwise or when it could not be built. Optional: an older payload
   * has none.
   */
  ending?: PlanEndingWire | null;
  problem: PlanSentence | null;
}

/*
 * The server's `PlanEndingView`, mirrored by hand (C-6: no import from the
 * entitlements module, type-only included). Plan names and the lost rows are
 * already in the reader's language; dates are ISO.
 */
export type PlanEndingWire =
  /** The account's own free plan (a Founding Partner, an unexpired trial) outlives the paid plan. */
  | { kind: 'back_to_plan'; endsAt: string; planName: string; until: string | null; loses: string[] }
  /** User BQ-20: the free plan until `until`, then read-only for `thenReadOnlyDays`, then paused. */
  | {
      kind: 'free_plan';
      endsAt: string;
      planName: string;
      until: string;
      /** The free plan's one-off credit total (from its config), or `null`; the UI formats it. */
      credits: number | null;
      loses: string[];
      thenReadOnlyDays: number | null;
      thenPausedFrom: string | null;
    }
  /** The server could not work out what changes. */
  | { kind: 'unknown'; endsAt: string };

/*
 * The comparison table's data, mirrored field by field from the server's
 * `CustomerPlanComparison` (UM-0 workplan §5) — written by hand, not imported
 * (C-6). Plan names and prices are NOT here: they are in `plans`, joined by
 * `planId`. No capability id, no list of what a plan lacks, no sentence: the
 * client has nothing to branch on (C-21).
 */
export interface PlanComparison {
  /** The columns: exactly `plans.map(p => p.planId)`, same order. */
  planIds: string[];
  /**
   * Live-test fix LF-2: the account's own plan when it is not a shown tier (a
   * trial, a Founding Partner), shown as its own first column marked "Your
   * plan"; its cells are each row's `current`. `null` for a tier account.
   * Optional: an older payload has none and renders the tier columns only.
   */
  current?: { planId: string } | null;
  /** Non-empty sections only, in the server's order. */
  sections: PlanComparisonSection[];
}

export interface PlanComparisonSection {
  /** A config id, never shown. */
  section: string;
  /** Dictionary key for the heading, e.g. `plan.comparison.section.run_business`. */
  labelKey: string;
  rows: PlanComparisonRow[];
}

export interface PlanComparisonRow {
  /** The config row id. Never shown. */
  row: string;
  /** In the reader's language, from the server. */
  label: string;
  /** One per `planIds` entry, same order. */
  cells: PlanComparisonCell[];
  /** LF-2: the own plan's cell, from the account's resolved plan, when `comparison.current` is set. */
  current?: PlanComparisonCell | null;
}

export interface PlanComparisonCell {
  planId: string;
  /** Every visible member of the row is granted by this plan as defined. */
  included: boolean;
  /** Server-formatted amount when included; `null` for feature rows and for ✕. */
  value: string | null;
  /** Strictly greater than every other column; the server decides, the UI only styles it. */
  highlight: boolean;
}

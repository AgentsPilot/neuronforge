/**
 * The admin per-account credit view's payload (credit deduction slice 11c,
 * workplan "11c — Admin per-account credit view" §11c.3.3).
 *
 *   GET /api/admin/business-os/credits/accounts/<uuid>  →  `data`
 *
 * Types only. Imports nothing, from the entitlements module or anywhere else
 * (SA W11c-4): the deciding layer is declared literally here, and
 * `__tests__/adminCreditPosition.wireTypes.test.ts` asserts in both directions
 * that it equals the resolver's `TraceEntry['layer']`, so a new resolver layer
 * fails the type gate there and never silently on screen. The admin screen
 * re-declares this payload in `app/admin/users/types.ts` (its source guard
 * forbids `@/lib/business-os` imports); the same test pins the two together.
 *
 * Credits only: no USD, cost, token, model or idempotency key, and no combined
 * "remaining" figure of plan and extra credits (SA S11-CR-3; that is slice 9's).
 *
 * @module lib/business-os/credits/adminCreditPositionTypes
 */

/** The resolver layer that decided the credit allowance (the Plan & entitlements vocabulary, SA OP-31). */
export type AdminCreditAllowanceLayer = 'basis' | 'lifecycle_gate' | 'grandfather' | 'addon' | 'cohort_values' | 'override';

/** One credit taken back out of a lot, as an admin sees it. */
export interface AdminCreditTakeBack {
  id: string;
  credits: number;
  /** The admin's own internal reason (S11-D-4 A): never shown to owners. */
  reason: string | null;
  actorAdminId: string | null;
  createdAt: string;
}

/** One lot, as an admin sees it. Built field by field, never a spread of a repository row. */
export interface AdminCreditLot {
  id: string;
  source: 'admin_grant' | 'boost_purchase';
  credits: number;
  /** From the lot positions of `creditLots.ts`; for a lot they do not list yet (clock skew, SA W11c-11), its granted credits. */
  remaining: number;
  expired: boolean;
  /**
   * False only for a lot created after the read's `now` (clock skew between the
   * server and the database, SA W11c-11): listed, not counted, no Take back.
   */
  counted: boolean;
  expiresAt: string | null;
  reason: string | null;
  actorKind: 'admin' | 'stripe_webhook';
  actorAdminId: string | null;
  createdAt: string;
  takeBacks: AdminCreditTakeBack[];
}

/** The plan side: the same window and figures as the owner's card. */
export type AdminCreditUsageBlock =
  | { status: 'error' }
  | {
      status: 'ok';
      period: { kind: 'monthly' | 'trial_total' | 'calendar_month'; key: string; resetsOn: string | null };
      allowanceStatus: 'ok' | 'unavailable';
      allowance: { amount: number; per: 'month' | 'total' } | null;
      allowanceLayer: AdminCreditAllowanceLayer | null;
      used: number;
      usedByOwner: number;
      usedAutomatic: number;
      /** max(0, allowance − used); null without an allowance. */
      planLeft: number | null;
      /** max(0, used − allowance); null without an allowance. Shown only when > 0. */
      overPlan: number | null;
    };

/** The extra credits side: the one definition in `creditLots.ts` (S11-SQ-4). */
export type AdminCreditExtraBlock =
  | { status: 'error' }
  | {
      status: 'ok';
      extraCredits: number;
      hasInconsistentLot: boolean;
      /** Newest first, for display. */
      lots: AdminCreditLot[];
    };

export interface AdminCreditPosition {
  accountId: string;
  /** The admin is looking at their own account: the forms hide; the server still refuses (OP-28). */
  isOwnAccount: boolean;
  /** Sent from the server constants, never copied into the client (OP-27, SA W11c-6). */
  limits: { grantCeiling: number; reasonMin: number; reasonMax: number };
  usage: AdminCreditUsageBlock;
  extra: AdminCreditExtraBlock;
}

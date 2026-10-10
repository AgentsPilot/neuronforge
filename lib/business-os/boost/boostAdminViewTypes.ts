/**
 * The admin "Credit top-ups" payload (credits boost slice 6a; requirement
 * FR-22, FR-38, R-12; workplan §3.1).
 *
 * Served by `GET /api/admin/business-os/credits/accounts/[accountId]/boost`
 * and read by `app/admin/users/components/BoostBlock.tsx`. Types only, safe in
 * a client bundle. Every key is pinned by the route test: no email, no secret,
 * no client secret; Stripe references are ids only.
 *
 * @module lib/business-os/boost/boostAdminViewTypes
 */

export type AdminBoostStripeMode = 'test' | 'live';

export interface AdminBoostPurchaseRow {
  id: string;
  livemode: boolean;
  status: string;
  packageId: string;
  packageVersion: number;
  priceMinor: number;
  currency: string;
  creditsTotal: number;
  amountTotalMinor: number | null;
  amountTaxMinor: number | null;
  amountRefundedMinor: number;
  flagReason: string | null;
  lotId: string | null;
  stripe: {
    paymentIntentId: string | null;
    chargeId: string | null;
    disputeId: string | null;
    checkoutSessionId: string | null;
  };
  createdAt: string;
  paidAt: string | null;
  statusChangedAt: string;
  checkoutExpiresAt: string;
}

export interface AdminBoostCapChange {
  id: string;
  amountMinor: number;
  currency: string;
  reason: string;
  actorAdminId: string;
  createdAt: string;
  endedAt: string | null;
  endedByAdminId: string | null;
  endedReason: string | null;
}

export type AdminBoostPurchasesBlock =
  | { status: 'ok'; rows: AdminBoostPurchaseRow[]; truncated: { test: boolean; live: boolean } }
  | { status: 'error' };

export type AdminBoostCapBlock =
  | {
      status: 'ok';
      default: { amountMinor: number; currency: string; windowDays: number };
      active: { id: string; amountMinor: number; currency: string; reason: string; actorAdminId: string; createdAt: string } | null;
      history: AdminBoostCapChange[];
    }
  | { status: 'error' };

export interface AdminBoostView {
  accountId: string;
  isOwnAccount: boolean;
  /** The server key's mode; null when it cannot be told. Display only: links use each row's own mode (SA C-4). */
  serverMode: AdminBoostStripeMode | null;
  purchases: AdminBoostPurchasesBlock;
  cap: AdminBoostCapBlock;
}

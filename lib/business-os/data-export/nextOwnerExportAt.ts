// lib/business-os/data-export/nextOwnerExportAt.ts
//
// Module export MX-4b (workplan BUSINESS_OS_EXPORT_MX4_WORKPLAN.md §5.2 N-1;
// SA workplan review Q-11 with C-5): "you can export again at {time}" when the
// drawer opens, before any click.
//
// The start function of migration 20261095 is the ONLY authority for the
// owner's daily limit (K-8): it counts the owner-origin requests of the last
// 24 hours that have at least one job not in MODULE_JOB_NOT_COUNTED, newest
// first, and answers `daily_limit` with the row at OFFSET (limit - 1) plus
// 24 hours. The request repository's `findOwnerLimitAnchor` reads that same
// row; this file holds the arithmetic around it. The answer is a hint only:
// the POST still decides, with the database's own `retryAt`.
//
// supabase/migrations/__tests__/business-os-export-requests.migration.test.ts
// pins the SQL predicate and the OFFSET this file mirrors (SA C-5).
//
// PURE: no I/O, no clock of its own (the caller passes `now`).

import { MODULE_EXPORT_POLICY } from '@/lib/business-os/data-export/moduleExportPolicy';

/** The two numbers of the owner's limit (plain numbers, so a test can pass other values than the `as const` literals). */
export type OwnerLimitPolicy = { readonly OWNER_DAILY_LIMIT: number; readonly DAILY_WINDOW_HOURS: number };

const HOUR_MS = 3_600_000;

/** The start function's `OFFSET (v_limit - 1)` for an owner request. */
export function ownerLimitAnchorOffset(policy: OwnerLimitPolicy = MODULE_EXPORT_POLICY): number {
  return policy.OWNER_DAILY_LIMIT - 1;
}

/** The admin's limit per owner (MX-5): a plain number, as `OwnerLimitPolicy`. */
export type AdminLimitPolicy = { readonly ADMIN_DAILY_LIMIT_PER_OWNER: number };

/**
 * The start function's `OFFSET (v_limit - 1)` for an admin request (MX-5,
 * workplan §4.3). The SQL counts `req.origin = p_origin`, so the admin's sends
 * to one owner are anchored apart from the owner's own (BQ-30a).
 */
export function adminLimitAnchorOffset(policy: AdminLimitPolicy = MODULE_EXPORT_POLICY): number {
  return policy.ADMIN_DAILY_LIMIT_PER_OWNER - 1;
}

/** The start function's `now() - interval '24 hours'`, as an ISO string, from the caller's clock. */
export function ownerLimitWindowStart(nowMs: number, policy: OwnerLimitPolicy = MODULE_EXPORT_POLICY): string {
  return new Date(nowMs - policy.DAILY_WINDOW_HOURS * HOUR_MS).toISOString();
}

/**
 * When the owner may start an export again: the anchor's `requested_at` plus
 * the window, or null when there is no anchor (under the limit) or it does not
 * parse. The database keeps microseconds and `Date` does not, so a fraction
 * finer than a millisecond rounds UP: the hint is never earlier than the time
 * the start function would answer.
 */
export function nextOwnerExportAt(anchor: string | null, policy: OwnerLimitPolicy = MODULE_EXPORT_POLICY): string | null {
  if (anchor === null) return null;
  const parsed = Date.parse(anchor);
  if (!Number.isFinite(parsed)) return null;
  const fraction = /[.]([0-9]+)/.exec(anchor)?.[1] ?? '';
  const subMillisecond = fraction.length > 3 && /[1-9]/.test(fraction.slice(3)) ? 1 : 0;
  return new Date(parsed + subMillisecond + policy.DAILY_WINDOW_HOURS * HOUR_MS).toISOString();
}

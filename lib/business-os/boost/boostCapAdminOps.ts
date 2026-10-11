/**
 * Admin cap override for one account's credit top-ups (credits boost slice 6b;
 * requirement FR-22, R-12; workplan §3.3; SA C-1, C-2, C-3, Q-1, Q-2).
 *
 * Two admin operations, composed into the entitlement admin op union by the
 * entitlements module's `adminOps.ts` and dispatched from its `executeAdminOp`,
 * exactly as credit deduction 11b's `creditAdminOps.ts` is (SA Q-1 (a)):
 *
 *   set_boost_cap   set this account's spending limit (whole dollars, within the
 *                   configured bounds) with a reason; replaces any active one
 *   end_boost_cap   return this account to the default limit, with a reason
 *
 * `adminOps.ts` runs the shared checks first: body (Zod) → own account 403 →
 * platform account 409 (C-1, through `refuseBoostCapOpForPlatformAccount`) →
 * tenant 404 → plan row 409. Then `executeBoostCapAdminOp`:
 *   set:  read the active override (500 if it cannot be read) → the SAME amount
 *         already active → `{ unchanged: true }`, no write, no audit (C-2) →
 *         `setCapOverride` (2a's function; its `no_plan_row` → 409)
 *   end:  read the active override (for the audit's "before") → `endCapOverride`
 *         (`none_active` → 409 `no_active_cap_override`, which also answers a
 *         repeated end)
 *
 * ── WHAT THIS FILE MAY IMPORT ───────────────────────────────────────────────
 * `zod`, `isPlatformAccount`, the credits module's reason bounds and the boost
 * repository's TYPES. Nothing from the entitlements module, type-only imports
 * included: the dependency points one way, entitlements → boost (the 11b rule).
 * The bounds and the default are therefore passed in by `adminOps.ts`. A source
 * guard in the test pins it.
 *
 * Every write goes through 2a's functions (per-account cap lock, reason and
 * currency checks in SQL). Takes no logger and logs nothing: it returns codes,
 * and the repository logs its own failures with ids and SQLSTATE only.
 *
 * @module lib/business-os/boost/boostCapAdminOps
 */

import { z } from 'zod';
import { isPlatformAccount } from '@/lib/business-os/llm/callCatalog';
import { CREDIT_REASON_MAX, CREDIT_REASON_MIN } from '@/lib/business-os/credits/creditAdminOps';
import type { BusinessOsBoostPurchaseRepository } from '@/lib/repositories/BusinessOsBoostPurchaseRepository';

/** The op names this file owns. `adminOps.ts` uses it for the platform check and the dispatch. */
export const BOOST_CAP_ADMIN_OP_NAMES = ['set_boost_cap', 'end_boost_cap'] as const;
export type BoostCapAdminOpName = (typeof BOOST_CAP_ADMIN_OP_NAMES)[number];

/** The bounds of an override, from configuration (`BOOST_PURCHASE_CAP_OVERRIDE_BOUNDS`). */
export interface BoostCapBounds {
  minMinor: number;
  maxMinor: number;
  stepMinor: number;
  currency: 'USD';
}

/** The default limit, from configuration (`BOOST_PURCHASE_CAP_DEFAULT`), for the audit's "before" / "after". */
export interface BoostCapDefault {
  amountMinor: number;
  currency: 'USD';
  windowDays: number;
}

/**
 * QA6b-L1: the length is counted in code points, as 2a's SQL counts it
 * (`char_length(btrim(reason))`), so two emoji are 2, not 4: a reason the
 * database would refuse is refused here first. (11b's credit reasons still
 * count UTF-16 units; a follow-up in the workplan §9.)
 */
export function reasonLength(value: string): number {
  return [...value].length;
}

const reason = z
  .string()
  .trim()
  .refine((value) => reasonLength(value) >= CREDIT_REASON_MIN && reasonLength(value) <= CREDIT_REASON_MAX, {
    message: `a reason of ${CREDIT_REASON_MIN} to ${CREDIT_REASON_MAX} characters is required`,
  });

/** SA C-3: an integer number of minor units, whole dollars, within the configured bounds. */
export function setBoostCapSchema(bounds: BoostCapBounds) {
  return z
    .object({
      op: z.literal('set_boost_cap'),
      amountMinor: z
        .number()
        .int()
        .min(bounds.minMinor)
        .max(bounds.maxMinor)
        .refine((value) => value % bounds.stepMinor === 0, { message: 'must be a whole number of dollars' }),
      reason,
    })
    .strict();
}

export const endBoostCapSchema = z
  .object({
    op: z.literal('end_boost_cap'),
    reason,
  })
  .strict();

export type SetBoostCapOp = z.infer<ReturnType<typeof setBoostCapSchema>>;
export type EndBoostCapOp = z.infer<typeof endBoostCapSchema>;
export type BoostCapAdminOp = SetBoostCapOp | EndBoostCapOp;

export function isBoostCapAdminOp(op: { op: string }): op is BoostCapAdminOp {
  return (BOOST_CAP_ADMIN_OP_NAMES as readonly string[]).includes(op.op);
}

/** Replaces the plan-row defaults in the route's audit entry: the account's limit, before and after. */
export interface BoostCapAudit {
  /** Operator-only (BD-26): the owner never reads the admin's reason. */
  entityType: 'business_os_account_plan';
  entityId: string;
  changes: Record<string, unknown>;
  details: Record<string, unknown>;
}

export type BoostCapAdminOpOutcome =
  | {
      ok: true;
      action: 'BOS_BOOST_CAP_OVERRIDE_SET' | 'BOS_BOOST_CAP_OVERRIDE_ENDED';
      data: Record<string, unknown>;
      /** Absent when nothing changed (C-2): no audit entry. */
      audit?: BoostCapAudit;
      /** C-2: the same amount was already active; nothing was written. */
      unchanged?: true;
    }
  | { ok: false; status: 409 | 500; error: string };

export interface BoostCapAdminOpContext {
  accountId: string;
  adminId: string;
  bounds: BoostCapBounds;
  defaultCap: BoostCapDefault;
  repository: Pick<BusinessOsBoostPurchaseRepository, 'findActiveCapOverride' | 'setCapOverride' | 'endCapOverride'>;
}

/** C-1: the platform account's rows are not one business's. */
export function refuseBoostCapOpForPlatformAccount(accountId: string): { ok: false; status: 409; error: string } | null {
  return isPlatformAccount(accountId) ? { ok: false, status: 409, error: 'platform_account' } : null;
}

type Limit = { capMinor: number; source: 'default' | 'override' };

export async function executeBoostCapAdminOp(op: BoostCapAdminOp, ctx: BoostCapAdminOpContext): Promise<BoostCapAdminOpOutcome> {
  const active = await ctx.repository.findActiveCapOverride(ctx.accountId);
  if (active.error) return { ok: false, status: 500, error: 'cap_override_read_failed' };
  const before: Limit = active.data ? { capMinor: active.data.capMinor, source: 'override' } : { capMinor: ctx.defaultCap.amountMinor, source: 'default' };
  const window = { window_days: ctx.defaultCap.windowDays, currency: ctx.bounds.currency, default_cap_minor: ctx.defaultCap.amountMinor };

  if (op.op === 'set_boost_cap') {
    // C-2: a repeated submit of the same figure writes nothing and audits nothing.
    if (active.data && active.data.capMinor === op.amountMinor) {
      return { ok: true, action: 'BOS_BOOST_CAP_OVERRIDE_SET', unchanged: true, data: { unchanged: true, amountMinor: op.amountMinor, overrideId: active.data.id } };
    }
    const result = await ctx.repository.setCapOverride({
      accountId: ctx.accountId,
      capMinor: op.amountMinor,
      currency: ctx.bounds.currency,
      reason: op.reason,
      actorAdminId: ctx.adminId,
    });
    if (result.error || !result.data) return { ok: false, status: 500, error: 'cap_override_write_failed' };
    if (result.data.outcome === 'no_plan_row') return { ok: false, status: 409, error: 'plan_row_missing' };
    const after: Limit = { capMinor: op.amountMinor, source: 'override' };
    return {
      ok: true,
      action: 'BOS_BOOST_CAP_OVERRIDE_SET',
      data: { overrideId: result.data.overrideId, previousOverrideId: result.data.previousOverrideId, amountMinor: op.amountMinor },
      audit: {
        entityType: 'business_os_account_plan',
        entityId: ctx.accountId,
        changes: { before, after },
        details: { ...window, override_id: result.data.overrideId, previous_override_id: result.data.previousOverrideId },
      },
    };
  }

  const ended = await ctx.repository.endCapOverride({ accountId: ctx.accountId, actorAdminId: ctx.adminId, reason: op.reason });
  if (ended.error || !ended.data) return { ok: false, status: 500, error: 'cap_override_write_failed' };
  if (ended.data.outcome === 'none_active') return { ok: false, status: 409, error: 'no_active_cap_override' };
  const after: Limit = { capMinor: ctx.defaultCap.amountMinor, source: 'default' };
  return {
    ok: true,
    action: 'BOS_BOOST_CAP_OVERRIDE_ENDED',
    data: { overrideId: ended.data.overrideId },
    audit: {
      entityType: 'business_os_account_plan',
      entityId: ctx.accountId,
      changes: { before, after },
      details: { ...window, override_id: ended.data.overrideId },
    },
  };
}

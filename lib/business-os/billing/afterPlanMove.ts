/**
 * THE AFTER-PLAN MOVE: when an owner-started cancel ends a paid plan, move the
 * account to the configured free cohort for its free period (account-deletion
 * lifecycle SX-2b, user decision BQ-20 2026-10-27; workplan
 * docs/workplans/BUSINESS_OS_D3_1_FREE_COHORT_AFTER_CANCEL_WORKPLAN.md §6.2;
 * SA S-6, S-7, S-10, DR-4 to DR-10; user U-1, U-2, U-3, U-5).
 *
 * DELETE-owned. Reached from ONE place: the plan subscription mirror's
 * `customer.subscription.deleted` branch, after the money history row, ALSO on
 * a replayed event, through the mirror's `afterPlanMove` port (wired in
 * `planBillingHandler.ts` from `afterPlanMoveDeps.ts`). It decides everything
 * itself; the mirror only hands it the facts below.
 *
 *   1  reason    Stripe's `cancellation_details.reason` is `cancellation_requested`
 *                (an owner's cancel, a P-7a.4 "Ends now" during a failed payment
 *                too (U-5), a Stripe-dashboard cancel (U-2), a later deletion
 *                request). `payment_failed`, `payment_disputed` and none keep
 *                today's grace → paused path: nothing is read or written
 *   2  end date  `endedAt` (Stripe's `ended_at` from the mirror's fresh read) parses
 *   3  config    the after-plan cohort is grantable (GR-1); else alert, no retry
 *   4  read      the plan row + its move count, FRESH (never the entitlement cache)
 *   5  once      the row's last move came from this subscription → done
 *   6  rule      `afterPlanAccount` (the ONE rule the Cancel drawer also shows),
 *                with the stored count: a surviving own cohort or a row paid
 *                through after the end moves nothing and counts nothing
 *   7  write     one compare-and-set UPDATE (`updated_at` + the count): cohort,
 *                trial pins, a stale grace pin cleared, `period_anchor` (the
 *                fresh credit total, S-5), count + 1, this subscription id
 *   8  audit     `BOS_PLAN_FREE_PERIOD_AFTER_CANCEL` through `recordPlanChange`
 *                (system actor, cache invalidated). An audit failure NEVER
 *                throws (DR-6): the move is already written
 *
 * ── THROW MEANS RETRY (SA S-7) ──────────────────────────────────────────────
 * It throws only on a read or write failure, or a stale write. The webhook
 * route then releases its claim and Stripe redelivers; the mirror re-runs
 * (idempotent), the money history row is a duplicate (returns early), and this
 * runs again: either it applies now, or step 5 sees it already did. A thrown
 * read or write is logged `error` + `alert: true`, because Stripe stops after
 * about 3 days and the account would then fall silently to grace.
 *
 * ── TENANCY ─────────────────────────────────────────────────────────────────
 * The account id is OUR billing row's (the mirror's `resolveAccountId`), never
 * Stripe metadata; the mirror has already refused a metadata claim for another
 * account. Nothing here reads `metadata` (the guard test pins it).
 *
 * Logs carry ids and codes only (DR-10): account id, subscription id, event
 * id, livemode, prior moves, days, skip, Stripe's reason. No email, no name.
 *
 * No cohort id and no tier name in this file: the cohort is `AFTER_PLAN.cohort`.
 *
 * @module lib/business-os/billing/afterPlanMove
 */

import type { Logger } from '@/lib/logger';
import { fromPlanRow } from '@/lib/business-os/entitlements/account';
import { afterPlanAccount, type AfterPlanSkip } from '@/lib/business-os/entitlements/afterPlan';
import { AFTER_PLAN, type AfterPlanConfig } from '@/lib/business-os/entitlements/config/afterPlan';
import { isGrantableCohort } from '@/lib/business-os/entitlements/grantRules';
import type { LifecycleInputs } from '@/lib/business-os/entitlements/lifecycle';
import type { RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';

/** The plan row, typed through the account seam so this file names no repository (RC-15). */
type PlanRow = Parameters<typeof fromPlanRow>[0];

/** What the mirror hands over. Every field comes from the event or our own billing row. */
export interface AfterPlanMoveInput {
  /** From OUR billing row (`resolveAccountId`), never from Stripe metadata. */
  accountId: string;
  /** The subscription that ended, the one our billing row still holds (`mirrored: true`). */
  subscriptionId: string;
  livemode: boolean;
  stripeEventId: string;
  /** Stripe's `ended_at` from the mirror's fresh read, as ISO; `null` when Stripe gave none. */
  endedAt: string | null;
  /** `cancellation_details.reason` from the event payload (SA S-10), verbatim or `null`. */
  cancellationReason: string | null;
}

/** The port the mirror calls. One line in `planBillingHandler.ts` wires the production one. */
export type AfterPlanMovePort = (input: AfterPlanMoveInput, log: Logger) => Promise<void>;

/** A repository-shaped answer, structurally (the deps file passes the real methods). */
interface PortResult<T> {
  data: T | null;
  error: Error | null;
}

/** What the fresh read returns. */
export interface AfterPlanMoveRead {
  plan: PlanRow;
  moves: number;
  lastSubscriptionId: string | null;
}

/** What the write takes: named fields only, never the row (tenant-isolation-guard §3). */
export interface AfterPlanMoveWrite {
  accountId: string;
  expected: { updatedAt: string; moves: number };
  cohort: string;
  trialStartedAt: string;
  trialEndsAt: string;
  clearGraceEndsAt: boolean;
  periodAnchor: string;
  subscriptionId: string;
}

export type AfterPlanMoveWriteResult = { outcome: 'applied'; moves: number } | { outcome: 'stale' };

export interface AfterPlanMoveDeps {
  /** The plan row + move state, fresh. `data: null` with no error = no plan row. */
  readMoveInputs: (accountId: string) => Promise<PortResult<AfterPlanMoveRead>>;
  /** The conditional system write. */
  writeMove: (input: AfterPlanMoveWrite) => Promise<PortResult<AfterPlanMoveWriteResult>>;
  config: () => EntitlementConfig;
  /** Default `AFTER_PLAN`; injectable for fixtures. */
  afterPlan?: AfterPlanConfig;
  recordPlanChange: (input: RecordPlanChangeInput) => Promise<void>;
  now: () => Date;
}

/** The one reason that gives the free period (requirement §3.2, BQ-20). */
const OWNER_END_REASON = 'cancellation_requested';

/** The audit key (SA S-8), registered in `lib/audit/events.ts`. */
export const AFTER_PLAN_MOVE_AUDIT_ACTION = 'BOS_PLAN_FREE_PERIOD_AFTER_CANCEL';

/** Every `skip` this module logs (DR-10, a closed list). */
export type AfterPlanMoveSkip = 'not_owner_end' | 'no_end_date' | 'no_plan_row' | 'already_applied' | AfterPlanSkip;

function lifecycleInputsOf(config: EntitlementConfig): LifecycleInputs {
  return {
    cohorts: config.cohorts,
    tierOrder: config.tierOrder,
    subscriptionGraceHistory: config.lifecycle.subscriptionGraceHistory,
    renewalSettlementMarginHistory: config.lifecycle.renewalSettlementMarginHistory,
  };
}

/** SX-2b: move the account to the free cohort when an owner-started cancel ended its paid plan. */
export async function moveToFreeCohortAfterPlan(input: AfterPlanMoveInput, log: Logger, deps: AfterPlanMoveDeps): Promise<void> {
  const afterPlan = deps.afterPlan ?? AFTER_PLAN;
  const moveLog = log.child({ module: 'BusinessOsAfterPlanMove' });
  const ids = {
    accountId: input.accountId,
    subscriptionId: input.subscriptionId,
    livemode: input.livemode,
    stripeEventId: input.stripeEventId,
  };
  const skipped = (level: 'info' | 'warn' | 'error', skip: AfterPlanMoveSkip, extra: Record<string, unknown> = {}) => {
    const fields = { event: 'bos_plan_after_plan_skipped', skip, ...ids, ...extra };
    if (level === 'error') moveLog.error({ ...fields, alert: true }, 'After-plan move skipped: needs an operator');
    else if (level === 'warn') moveLog.warn(fields, 'After-plan move skipped');
    else moveLog.info(fields, 'After-plan move skipped');
  };

  // 1. Only an owner-started end gives the free period.
  const cancellationReason = typeof input.cancellationReason === 'string' ? input.cancellationReason : null;
  if (cancellationReason !== OWNER_END_REASON) {
    skipped('info', 'not_owner_end', { cancellationReason });
    return;
  }

  // 2. The end date.
  const endedAtMs = input.endedAt === null ? NaN : Date.parse(input.endedAt);
  if (!Number.isFinite(endedAtMs)) {
    skipped('warn', 'no_end_date', { cancellationReason });
    return;
  }
  const endedAt = new Date(endedAtMs).toISOString();

  // 3. The config can give a move (GR-1). A retry cannot fix config, so no throw.
  const config = deps.config();
  if (!isGrantableCohort(config, afterPlan.cohort)) {
    skipped('error', 'after_plan_misconfigured', { cancellationReason });
    return;
  }

  // 4. The plan row and its move count, fresh.
  const read = await deps.readMoveInputs(input.accountId);
  if (read.error) {
    moveLog.error({ err: read.error, event: 'bos_plan_after_plan_read_failed', ...ids, alert: true }, 'After-plan move: the plan row could not be read');
    throw read.error;
  }
  if (!read.data) {
    skipped('warn', 'no_plan_row', { cancellationReason });
    return;
  }
  const { plan, moves, lastSubscriptionId } = read.data;
  if (plan.user_id !== input.accountId) {
    // The repository filters by user_id, so this is unreachable; refusing is the safe reading.
    const err = new Error('After-plan move: the plan row read belongs to another account');
    moveLog.error({ err, event: 'bos_plan_after_plan_read_failed', ...ids, alert: true }, 'After-plan move: the plan row read does not match the account');
    throw err;
  }

  // 5. Once per subscription.
  if (lastSubscriptionId === input.subscriptionId) {
    skipped('info', 'already_applied', { priorMoves: moves });
    return;
  }

  // 6. The one rule, with the stored count.
  const before = fromPlanRow(plan);
  const result = afterPlanAccount(before, endedAt, lifecycleInputsOf(config), { priorMoves: moves }, afterPlan);
  if (!result.moved || result.days === null) {
    const skip: AfterPlanSkip = result.skip ?? 'after_plan_misconfigured';
    const level = skip === 'own_cohort_survives' ? 'info' : skip === 'no_end_date' ? 'warn' : 'error';
    skipped(level, skip, { priorMoves: moves });
    return;
  }

  // 7. The write. The anchor is the end, never in the future (a test clock), S-5.
  const nowMs = deps.now().getTime();
  const periodAnchor = new Date(Math.min(endedAtMs, nowMs)).toISOString();
  const after = result.account;
  const clearGraceEndsAt = before.graceEndsAt !== null && after.graceEndsAt === null;
  const written = await deps.writeMove({
    accountId: input.accountId,
    expected: { updatedAt: plan.updated_at, moves },
    cohort: after.cohort as string,
    trialStartedAt: after.trialStartedAt as string,
    trialEndsAt: after.trialEndsAt as string,
    clearGraceEndsAt,
    periodAnchor,
    subscriptionId: input.subscriptionId,
  });
  if (written.error || !written.data) {
    const err = written.error ?? new Error('After-plan move: the write returned no answer');
    moveLog.error({ err, event: 'bos_plan_after_plan_write_failed', ...ids, alert: true }, 'After-plan move: the plan row could not be written');
    throw err;
  }
  if (written.data.outcome === 'stale') {
    moveLog.warn({ event: 'bos_plan_after_plan_stale', ...ids, priorMoves: moves }, 'After-plan move: the plan row changed since it was read; retrying');
    throw new Error('After-plan move: the plan row changed since it was read');
  }

  // 8. The audit. Never throws, whatever the port does (DR-6).
  try {
    await deps.recordPlanChange({
      accountId: input.accountId,
      action: AFTER_PLAN_MOVE_AUDIT_ACTION,
      actor: { kind: 'system', source: 'stripe_webhook' },
      entityType: 'business_os_account_plan',
      entityId: input.accountId,
      changes: {
        before: {
          cohort: before.cohort,
          trial_started_at: before.trialStartedAt,
          trial_ends_at: before.trialEndsAt,
          tier_expires_at: before.tierExpiresAt,
          grace_ends_at: before.graceEndsAt,
          period_anchor: plan.period_anchor,
          after_plan_moves: moves,
        },
        after: {
          cohort: after.cohort,
          trial_started_at: after.trialStartedAt,
          trial_ends_at: after.trialEndsAt,
          tier_expires_at: after.tierExpiresAt,
          grace_ends_at: after.graceEndsAt,
          period_anchor: periodAnchor,
          after_plan_moves: written.data.moves,
        },
      },
      details: {
        automatic: true,
        trigger: 'owner_end',
        cancellationReason,
        subscriptionId: input.subscriptionId,
        endedAt,
        days: result.days,
        priorMoves: moves,
        cohort: afterPlan.cohort,
        livemode: input.livemode,
        stripeEventId: input.stripeEventId,
      },
      severity: 'info',
      invalidatesEntitlements: true,
      log: moveLog,
    });
  } catch (err) {
    moveLog.error({ err, event: 'bos_plan_after_plan_audit_failed', ...ids }, 'After-plan move written; its audit entry failed');
  }

  // 9. Done.
  moveLog.info(
    { event: 'bos_plan_after_plan_moved', ...ids, cancellationReason, priorMoves: moves, days: result.days },
    'Account moved to the free cohort after its paid plan ended'
  );
}

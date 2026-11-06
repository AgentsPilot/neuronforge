/**
 * KEEP MY ACCOUNT, stages A to C (account deletion lifecycle DL-1b / D6;
 * requirement §3.4, XC-2, XC-4; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §5; BQ-33; SA W-8, Q-13).
 *
 * ROW FIRST (XC-2): the closure row is moved to `kept` by compare-and-set, and
 * only then is Stripe asked to renew, and only when renewal was on before the
 * request (BQ-33). So the mirror that runs on the resulting Stripe event finds
 * the row already `kept` and does nothing, and a failed renew never leaves a
 * request open: the account IS kept, and the plan card shows the honest "Ends
 * on {date} [Keep my plan]" (Q-13: 200 with `renewal: 'failed'`).
 *
 *   K-2  the open row          error → try_again; none → nothing_to_keep;
 *                              `requesting` → request_in_progress; `locked` → locked
 *   K-3  from → kept            (`pending` or `grace`), `kept_source: 'owner'`;
 *                              error → try_again; not moved → state_changed (re-read)
 *   K-5  from `pending` with `renewal_was_on`: the engine, `reactivate`,
 *        `origin: 'deletion_keep'` (set HERE, after K-3, never from a request: W-8)
 *
 * Not behind the request switch (XC-4, D-11). Pure orchestration over ports;
 * the production ports are `closureKeepDeps.ts`. Ids are the SESSION's.
 *
 * @module lib/business-os/account-deletion/closureKeep
 */

import type { PlanManageAuditFacts, PlanManageInput, PlanManageResult } from '@/lib/business-os/billing/planSubscriptionManage';
import type { ClosureStatus } from './closureLifecycle';
import type { KeepRenewalOutcome } from './schemas';

type Result<T> = { data: T | null; error: Error | null };

export interface KeepClosureRow {
  id: string;
  status: ClosureStatus;
  renewal_was_on: boolean;
  plan_ends_at: string | null;
}

export interface ClosureKeepStore {
  findOpenForUser: (userId: string) => Promise<Result<KeepClosureRow>>;
  findById: (id: string, userId: string) => Promise<Result<KeepClosureRow>>;
  transition: (
    id: string,
    userId: string,
    from: ClosureStatus,
    to: ClosureStatus,
    patch: Record<string, string | boolean | null>
  ) => Promise<Result<boolean>>;
}

export interface ClosureKeepLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface ClosureKeepDeps {
  closures: ClosureKeepStore;
  /** `managePlanSubscription`, with its logger bound. */
  manage: (input: PlanManageInput) => Promise<PlanManageResult>;
  now: () => Date;
  logger: ClosureKeepLogger;
}

export interface ClosureKeepInput {
  /** The session user. */
  subject: string;
  /** `resolveAccountId(subject)`. */
  accountId: string;
}

export type ClosureKeepRefusalCode = 'nothing_to_keep' | 'request_in_progress' | 'locked' | 'state_changed' | 'try_again';

export const CLOSURE_KEEP_REFUSAL_STATUS: Readonly<Record<ClosureKeepRefusalCode, number>> = {
  nothing_to_keep: 409,
  request_in_progress: 409,
  locked: 409,
  state_changed: 409,
  try_again: 503,
};

export type ClosureKeepOutcome =
  | {
      ok: true;
      closureId: string;
      from: 'pending' | 'grace';
      renewal: KeepRenewalOutcome;
      /** `renewal: 'failed'`: the engine's refusal code. */
      code?: string;
      /** `renewal: 'failed'`: when the plan ends instead. */
      planEndsOn?: string | null;
      /** Set when the engine reached the Stripe write (BOS_BILLING_SUBSCRIPTION_REACTIVATED). */
      engineAudit: PlanManageAuditFacts | null;
    }
  | { ok: false; error: ClosureKeepRefusalCode; closureStatus?: ClosureStatus | null };

export async function runClosureKeep(input: ClosureKeepInput, deps: ClosureKeepDeps): Promise<ClosureKeepOutcome> {
  const { subject } = input;
  const log = deps.logger;

  // K-2. The open request.
  const open = await deps.closures.findOpenForUser(subject);
  if (open.error) return { ok: false, error: 'try_again' };
  const row = open.data;
  if (!row) return { ok: false, error: 'nothing_to_keep' };
  if (row.status === 'requesting') return { ok: false, error: 'request_in_progress', closureStatus: row.status };
  if (row.status === 'locked') return { ok: false, error: 'locked', closureStatus: row.status };
  if (row.status !== 'pending' && row.status !== 'grace') return { ok: false, error: 'state_changed', closureStatus: row.status };
  const from = row.status;
  const ids = { userId: subject, closureId: row.id, from };

  // K-3. Row first (XC-2).
  const moved = await deps.closures.transition(row.id, subject, from, 'kept', { kept_at: deps.now().toISOString(), kept_source: 'owner' });
  if (moved.error) return { ok: false, error: 'try_again' };
  if (moved.data !== true) {
    // A second tab, the mirror or DL-3 moved it first.
    const again = await deps.closures.findById(row.id, subject);
    log.warn({ ...ids, outcome: 'state_changed', now: again.data?.status ?? null }, 'Keep: the request had already moved');
    return { ok: false, error: 'state_changed', closureStatus: again.data?.status ?? null };
  }

  // K-5. Renewal back on only when it was on before the request (BQ-33).
  if (from === 'grace') {
    log.info({ ...ids, outcome: 'kept', renewal: 'not_needed' }, 'Account kept by its owner');
    return { ok: true, closureId: row.id, from, renewal: 'not_needed', engineAudit: null };
  }
  if (!row.renewal_was_on) {
    log.info({ ...ids, outcome: 'kept', renewal: 'not_restored_by_choice' }, 'Account kept by its owner');
    return { ok: true, closureId: row.id, from, renewal: 'not_restored_by_choice', engineAudit: null };
  }

  let result: PlanManageResult;
  try {
    result = await deps.manage({ action: 'reactivate', userId: subject, accountId: input.accountId, origin: 'deletion_keep' });
  } catch {
    log.error({ ...ids, outcome: 'kept', renewal: 'unknown', reason: 'engine_threw', alert: true }, 'Account kept, but the renewal could not be confirmed');
    return { ok: true, closureId: row.id, from, renewal: 'unknown', engineAudit: null };
  }

  if (result.ok && (result.outcome === 'reactivated' || (result.outcome === 'unchanged' && result.state === 'renewing'))) {
    const engineAudit = result.outcome === 'reactivated' ? result.audit : null;
    log.info({ ...ids, outcome: 'kept', renewal: 'restored' }, 'Account kept by its owner; the plan renews again');
    return { ok: true, closureId: row.id, from, renewal: 'restored', engineAudit };
  }
  if (!result.ok && result.outcomeUnknown) {
    log.error({ ...ids, outcome: 'kept', renewal: 'unknown', alert: true }, 'Account kept, but the Stripe answer was lost');
    return { ok: true, closureId: row.id, from, renewal: 'unknown', engineAudit: result.audit ?? null };
  }
  const code = result.ok ? `unexpected_${result.outcome}` : result.code;
  log.warn({ ...ids, outcome: 'kept', renewal: 'failed', code }, 'Account kept, but the plan could not be renewed');
  return { ok: true, closureId: row.id, from, renewal: 'failed', code, planEndsOn: row.plan_ends_at, engineAudit: null };
}

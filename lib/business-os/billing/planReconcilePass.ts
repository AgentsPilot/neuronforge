/**
 * The PLAN pass of the nightly `bos-billing-reconcile` cron (plan payments
 * P-8b.2; requirement PF-5, AM-5, SR-4, SA-P4 part 2; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md §4.2, SA rulings 2,
 * 3, 4, 8, 10, 12, 13, 14).
 *
 * It runs after the boost pass, on what is left of the run's shared deadline,
 * and touches only events the webhook dispatcher classifies as `plan`.
 *
 * STEP A, REPLAY (closes PF-5's H-1 and H-2 for plan events). Stripe's own
 * events of the plan handler's full type set (`PLAN_HANDLER_EVENT_TYPES`,
 * handed in by the wiring; SA ruling 3) are listed for a window anchored on
 * the last run whose plan pass finished all its work (SA ruling 8), and each
 * one our claim table does not show as completed is replayed OLDEST FIRST
 * through the SAME claim table and the SAME plan handler the webhook uses
 * (SR-3, SR-4). An event from the other Stripe mode (PF-15), or whose own
 * (api_version, type) is not a pair in `PLAN_HANDLER_VERIFIED_EVENT_SHAPES`
 * (SA API-version ruling, option (b)), is skipped and counted, with one summary
 * warn per run naming the unverified pairs.
 *
 * KNOWN LIMITATION (SA re-review, accepted): a `failed` run records no counts,
 * so if every run in the 30-day history was recorded `failed`, the window falls
 * back to the 3-day first-night window; each such run is red on the Jobs page.
 *
 * A DRAIN WITH NO NEW RPC (SA ruling 2). `processed_webhook_events` is the
 * lease: the unique insert and the two CONDITIONAL updates
 * (`reclaimFailedIfStillFailed`, `reclaimStale`) decide which one actor holds
 * an event, and the 15-minute stale reclaim is the reaper. This pass never
 * calls the route's unconditional `reclaimFailed` (a nightly actor must not
 * race Stripe's own retry), runs the handler only on a WON claim, and settles
 * that claim (complete, or fail on a throw) through `settleClaim` alone. A
 * source guard (`__tests__/planReconcilePass.guard.test.ts`) pins all three.
 *
 * STEP C, a paid plan invoice with no assignment (AM-5): a `completed`
 * `invoice.paid` plan event whose event left no money history row, and whose
 * invoice holds no `invoice_paid` row, is a finding. Never replayed: the
 * handler already decided, and a completed claim keeps its meaning.
 * A Step C read failure counts `checkIncomplete` (amber) but does not hold
 * the window back: those invoices are not re-checked next night. Acceptable
 * for a flag-only check (SA P-8b.2 review, non-blocking note).
 *
 * STEP B, Stripe vs our records (AM-5). Every non-cancelled subscription on a
 * plan price is compared with our billing record (status, the cancel flag, the
 * end, the tier bought, the period end) and, for a paying row, with the plan
 * row (tier, paid-through date). A plan-price subscription no billing row
 * holds is an orphan. FLAG ONLY (SA ruling 4; business question B-1): Step B
 * never writes. A list that stopped at its page cap produces no orphan.
 *
 * Every finding is one `error` line `bos_plan_reconcile_finding` with the
 * finding kind and Stripe / billing-row ids only: no money, no email, no name.
 * The run record keeps counts only.
 *
 * TENANT ISOLATION (SR-8). No account id is taken from any input. Every write
 * is the handler's, which resolves the account from our own billing record by
 * Stripe id; the pass itself writes only claim rows, which hold no business
 * data.
 *
 * Pure given its ports: no I/O of its own, no database or Stripe import. The
 * production wiring is `planReconcileDeps.ts`.
 *
 * @module lib/business-os/billing/planReconcilePass
 */

import type Stripe from 'stripe';

import type { ReconcileLogger, ReconcilePass, ReconcilePassContext, ReconcilePassCounts } from '@/lib/business-os/billing/reconcilePassRunner';

// ── Ports ────────────────────────────────────────────────────────────────────

export type PlanClaimStatus = 'processing' | 'completed' | 'failed';

interface PortError {
  code?: string;
  message?: string;
}

/** The claim table, as `ProcessedWebhookEventRepository` offers it. `reclaimFailed` is deliberately absent. */
export interface PlanReconcileClaimPort {
  findClaim(eventId: string): Promise<{ data: { event_id: string; status: PlanClaimStatus } | null; error: PortError | null }>;
  insertClaim(row: {
    event_id: string;
    event_type: string;
    status: 'processing';
    processed_at: string;
    metadata: { created: number; livemode: boolean };
  }): Promise<{ error: PortError | null }>;
  reclaimStale(eventId: string, cutoffIso: string): Promise<{ data: { won: boolean } | null; error: PortError | null }>;
  reclaimFailedIfStillFailed(eventId: string): Promise<{ data: { won: boolean } | null; error: PortError | null }>;
  complete(eventId: string): Promise<{ error: PortError | null }>;
  markFailed(eventId: string, failureMessage: string): Promise<{ error: PortError | null }>;
}

export interface PlanReconcileSubscriptionItem {
  priceId: string | null;
  currentPeriodStart: number | null;
  currentPeriodEnd: number | null;
}

export interface PlanReconcileSubscription {
  id: string;
  status: string;
  livemode: boolean;
  cancelAtPeriodEnd: boolean;
  endedAt: number | null;
  items: PlanReconcileSubscriptionItem[];
}

export interface PlanReconcileStripePort {
  listBusinessOsPlanEvents(params: { createdGte: number; types: readonly string[] }): Promise<{ items: Stripe.Event[]; complete: boolean }>;
  listBusinessOsSubscriptionsByPrice(priceId: string): Promise<{ items: PlanReconcileSubscription[]; complete: boolean }>;
}

export interface PlanReconcileRun {
  started_at: string;
  counts: Record<string, unknown> | null;
}

export interface PlanReconcileBillingRow {
  id: string;
  user_id: string | null;
  stripe_subscription_id: string;
  subscription_status: string | null;
  bought_tier: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  ended_at: string | null;
}

export interface PlanReconcilePlanFacts {
  tier: string | null;
  tierExpiresAt: string | null;
}

/** What the dispatcher decided, reduced to what the pass needs. */
export type PlanReconcileDispatch = { kind: 'plan' } | { kind: 'other' };

interface PortResult<T> {
  data: T | null;
  error: unknown;
}

export interface PlanReconcileDeps {
  /** The plan handler's own type set (`PLAN_HANDLER_EVENT_TYPES`), never a second list. */
  eventTypes: readonly string[];
  /**
   * The (API version → event types) pairs the handler is verified against
   * (`PLAN_HANDLER_VERIFIED_EVENT_SHAPES`; SA API-version ruling, option (b)).
   * An event is replayed only when its own `api_version` and type are a pair here.
   */
  verifiedShapes: Readonly<Record<string, readonly string[]>>;
  /** The webhook's own stale-claim age (`STALE_CLAIM_AGE_MS`): one figure for both actors. */
  staleClaimAgeMs: number;
  /** The mode of this server's Stripe key, or null when it cannot be read. */
  keyLivemode: () => boolean | null;
  /** The Stripe reads, or null when no client can be built. */
  stripe: () => PlanReconcileStripePort | null;
  claims: PlanReconcileClaimPort;
  /** The webhook's own dispatcher. Throws = could not tell. */
  dispatch: (event: Stripe.Event, log: ReconcileLogger) => Promise<PlanReconcileDispatch>;
  /** The webhook's own plan handler. Returns = done; throws = release for retry. */
  handle: (event: Stripe.Event, log: ReconcileLogger) => Promise<void>;
  /** The job's finished runs since `sinceIso`, newest first. */
  recentRuns: (sinceIso: string) => Promise<PortResult<PlanReconcileRun[]>>;
  /** Every billing row of one mode holding a subscription (ended or not). */
  billingRows: (livemode: boolean) => Promise<PortResult<PlanReconcileBillingRow[]>>;
  /** For some accounts, their plan row's tier and paid-through date. */
  planFacts: (accountIds: readonly string[]) => Promise<PortResult<Record<string, PlanReconcilePlanFacts>>>;
  /** Which events / invoices already left a money history row, in one mode. */
  recordedPayments: (
    livemode: boolean,
    ids: { eventIds: readonly string[]; invoiceIds: readonly string[] }
  ) => Promise<PortResult<{ eventIds: string[]; invoiceIds: string[] }>>;
  /** Plan price id → the tier it sells (current and retired). Empty while plan prices are switched off. */
  planPrices: () => Promise<ReadonlyMap<string, string>>;
  clock: () => number;
}

// ── Limits (workplan §4.2, §5; SA C-4 of boost; SA ruling 8) ─────────────────

export const PLAN_RECONCILE_LIMITS = {
  /** At most this many events reach the dispatcher in one run. */
  BATCH: 100,
  /** No new event is started this close to the shared deadline. */
  MARGIN_MS: 15 * 1000,
  /** Overlap before the anchoring run's start. */
  OVERLAP_MS: 60 * 60 * 1000,
  /** Never further back than this (Stripe keeps events 30 days). */
  MAX_WINDOW_MS: 7 * 24 * 60 * 60 * 1000,
  /**
   * How far back the run history is read (Stripe's event retention; SA fix 3),
   * so "no plan-pass run" means none in 30 days, not "none in the last 7".
   */
  RUN_HISTORY_MS: 30 * 24 * 60 * 60 * 1000,
  /** When no run of the plan pass exists at all yet. */
  FIRST_WINDOW_MS: 3 * 24 * 60 * 60 * 1000,
  /** A renewal younger than this may still be waiting for its paid invoice: no period finding. */
  RENEWAL_SETTLE_MS: 24 * 60 * 60 * 1000,
  /** The billing panel's own tolerance for "the same instant". */
  SAME_INSTANT_MS: 1000,
  /** The claim's failure message is cut to the route's own length. */
  FAILURE_MESSAGE_CHARS: 500,
} as const;

/**
 * The run-record counts that must all be 0 for a run to anchor the next
 * window (SA ruling 8: `planIncomplete`, `planDeadlineHit`, `passesFailed`;
 * plus `planReplayFailed`, so an event whose replay failed is listed again —
 * workplan Implementation Notes P-8b.2, D-3, for SA).
 */
export const PLAN_WINDOW_BLOCKING_COUNTS = ['planIncomplete', 'planDeadlineHit', 'planReplayFailed', 'passesFailed'] as const;

/** Present in every run in which the plan pass ran (its first counter). */
const PLAN_PASS_MARKER = 'planEventsSeen';

export type PlanReconcileFindingKind =
  | 'status_differs'
  | 'cancel_flag_differs'
  | 'ended_differs'
  | 'tier_differs'
  | 'period_differs'
  | 'subscription_not_listed'
  | 'plan_tier_differs'
  | 'plan_paid_through_differs'
  | 'orphan'
  | 'paid_invoice_unassigned';

/**
 * The pass's counters, flattened as `plan<Key>` in the run record. Kept few on
 * purpose: the run record's `counts` must stay within 1,024 bytes (the
 * `bos_cron_runs_counts_numbers_only` CHECK), and the boost pass shares it.
 *
 *   eventsSeen         events Stripe listed in the window
 *   replayed           events replayed to completion on a won claim
 *   replayFailed       a replay that threw, or a claim / dispatch step that failed
 *   skippedNotPlan     not a plan event (dispatcher), or from the other Stripe mode
 *   apiVersionSkipped  rendered at an unverified (api_version, type) pair (SA ruling 3,
 *                      API-version ruling (b)); one summary warn per run names the pairs
 *   staleReclaimed     replays that took back a stuck `processing` claim
 *   mismatch           Step B findings on a billing row
 *   orphan             Step B: a plan-price subscription no billing row holds
 *   unassigned         Step C: a paid plan invoice with no plan assignment
 *   incomplete         1 = an event was left for the next run (list or batch cap,
 *                      an event in flight, no usable Stripe key or event list)
 *   deadlineHit        1 = Step A or C stopped at the shared deadline
 *   windowClipped      1 = the window was cut at 7 days (SA ruling 8)
 *   checkIncomplete    1 = Step B or C, or the run history, could not be read in full
 */
const COUNT_KEYS = [
  'eventsSeen',
  'replayed',
  'replayFailed',
  'skippedNotPlan',
  'apiVersionSkipped',
  'staleReclaimed',
  'mismatch',
  'orphan',
  'unassigned',
  'incomplete',
  'deadlineHit',
  'windowClipped',
  'checkIncomplete',
] as const;

export type PlanReconcileCountKey = (typeof COUNT_KEYS)[number];
export const PLAN_RECONCILE_COUNT_KEYS: readonly PlanReconcileCountKey[] = COUNT_KEYS;

type Counts = Record<PlanReconcileCountKey, number>;

function zeroCounts(): Counts {
  const counts = {} as Counts;
  for (const key of COUNT_KEYS) counts[key] = 0;
  return counts;
}

// ── The window (SA ruling 8) ─────────────────────────────────────────────────

export interface PlanReconcileWindow {
  /** Unix seconds: list events created at or after this. */
  createdGte: number;
  clipped: boolean;
  /** Where the start came from, for the run's info line. */
  basis: 'anchored' | 'first_run' | 'no_clean_run' | 'runs_unreadable';
}

function isZero(counts: Record<string, unknown>, key: string): boolean {
  return counts[key] === 0;
}

/** Did this run's plan pass finish all its work? Only such a run may anchor the window. */
export function runFinishedPlanWork(counts: Record<string, unknown> | null): boolean {
  if (counts === null || typeof counts !== 'object') return false;
  if (typeof counts[PLAN_PASS_MARKER] !== 'number') return false;
  return PLAN_WINDOW_BLOCKING_COUNTS.every((key) => isZero(counts, key));
}

/**
 * The replay window. The last run whose plan pass finished all its work
 * anchors it (its start, minus an hour of overlap); never more than 7 days
 * back, and the cut is counted (`windowClipped`). Runs of the plan pass exist
 * but none finished → 7 days, clipped: a capped or timed-out run must never
 * move the window past events it did not process. A clean anchor older than 7
 * days (the history is read over 30 days, SA fix 3) → 7 days, clipped. No run
 * of the plan pass in those 30 days (its first night) → 3 days. Runs
 * unreadable → 7 days, the widest safe answer (replays are idempotent).
 */
export function planReconcileWindow(nowMs: number, runs: PortResult<PlanReconcileRun[]>): PlanReconcileWindow {
  const earliest = nowMs - PLAN_RECONCILE_LIMITS.MAX_WINDOW_MS;
  const seconds = (ms: number) => Math.floor(ms / 1000);
  if (runs.error || runs.data === null) {
    return { createdGte: seconds(earliest), clipped: false, basis: 'runs_unreadable' };
  }
  const anchor = runs.data.find((run) => runFinishedPlanWork(run.counts));
  if (anchor) {
    const startedAt = new Date(anchor.started_at).getTime();
    if (Number.isFinite(startedAt)) {
      const start = startedAt - PLAN_RECONCILE_LIMITS.OVERLAP_MS;
      if (start < earliest) return { createdGte: seconds(earliest), clipped: true, basis: 'anchored' };
      return { createdGte: seconds(start), clipped: false, basis: 'anchored' };
    }
  }
  const planRuns = runs.data.filter((run) => run.counts !== null && typeof run.counts[PLAN_PASS_MARKER] === 'number');
  if (planRuns.length > 0) return { createdGte: seconds(earliest), clipped: true, basis: 'no_clean_run' };
  return { createdGte: seconds(nowMs - PLAN_RECONCILE_LIMITS.FIRST_WINDOW_MS), clipped: false, basis: 'first_run' };
}

// ── The pass ─────────────────────────────────────────────────────────────────

/** Proof that this run holds the claim of one event. Only `takeClaim` makes one. */
interface WonClaim {
  readonly eventId: string;
  readonly how: 'inserted' | 'failed_reclaimed' | 'stale_reclaimed';
}

type ClaimAttempt = { won: WonClaim } | { lost: 'raced' | 'in_flight' } | { failed: true };

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

function failureMessageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, PLAN_RECONCILE_LIMITS.FAILURE_MESSAGE_CHARS);
}

function invoiceIdOf(event: Stripe.Event): string | null {
  const object = event.data?.object as { id?: unknown } | undefined;
  return typeof object?.id === 'string' && object.id.startsWith('in_') ? object.id : null;
}

function isoToMs(value: string | null): number | null {
  if (value === null) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function sameInstant(aMs: number | null, bMs: number | null): boolean {
  if (aMs === null || bMs === null) return aMs === bMs;
  return Math.abs(aMs - bMs) <= PLAN_RECONCILE_LIMITS.SAME_INSTANT_MS;
}

/** Is this event's own (api_version, type) a pair the handler is verified against? */
export function isVerifiedShape(shapes: Readonly<Record<string, readonly string[]>>, event: Pick<Stripe.Event, 'api_version' | 'type'>): boolean {
  const version = event.api_version;
  if (typeof version !== 'string' || !Object.prototype.hasOwnProperty.call(shapes, version)) return false;
  return shapes[version].includes(event.type);
}

const PAYING_STATUSES: ReadonlySet<string> = new Set(['active', 'past_due']);
/** Statuses that do not make a subscription without a billing row an orphan (a checkout still settling, or over). */
const NOT_ORPHAN_STATUSES: ReadonlySet<string> = new Set(['incomplete', 'incomplete_expired', 'canceled']);

export function createPlanReconcilePass(deps: PlanReconcileDeps): ReconcilePass {
  async function takeClaim(event: Stripe.Event, status: PlanClaimStatus | null, nowMs: number, log: ReconcileLogger): Promise<ClaimAttempt> {
    const ids = { stripeEventId: event.id, eventType: event.type };
    if (status === null) {
      const inserted = await deps.claims.insertClaim({
        event_id: event.id,
        event_type: event.type,
        status: 'processing',
        processed_at: new Date(nowMs).toISOString(),
        metadata: { created: event.created, livemode: event.livemode },
      });
      if (inserted.error) {
        // 23505: a live delivery claimed it between our read and this insert. Theirs wins.
        if (inserted.error.code === '23505') return { lost: 'raced' };
        log.error({ event: 'bos_plan_reconcile_claim_failed', step: 'insert', ...ids }, 'Plan reconcile could not claim an event');
        return { failed: true };
      }
      return { won: { eventId: event.id, how: 'inserted' } };
    }
    if (status === 'failed') {
      const reclaimed = await deps.claims.reclaimFailedIfStillFailed(event.id);
      if (reclaimed.error) {
        log.error({ event: 'bos_plan_reconcile_claim_failed', step: 'reclaim_failed', ...ids }, 'Plan reconcile could not claim an event');
        return { failed: true };
      }
      return reclaimed.data?.won ? { won: { eventId: event.id, how: 'failed_reclaimed' } } : { lost: 'raced' };
    }
    if (status === 'processing') {
      const cutoffIso = new Date(nowMs - deps.staleClaimAgeMs).toISOString();
      const reclaimed = await deps.claims.reclaimStale(event.id, cutoffIso);
      if (reclaimed.error) {
        log.error({ event: 'bos_plan_reconcile_claim_failed', step: 'reclaim_stale', ...ids }, 'Plan reconcile could not claim an event');
        return { failed: true };
      }
      return reclaimed.data?.won ? { won: { eventId: event.id, how: 'stale_reclaimed' } } : { lost: 'in_flight' };
    }
    // A completed claim is never taken (Step C reads it instead).
    return { lost: 'raced' };
  }

  /**
   * THE one place a claim this pass holds is settled: completed, or failed so a
   * later attempt may retry. Returns whether the write landed (SA P-8b.2 fix 2):
   * an unsettled claim stays `processing`, so the run must not move the window.
   */
  async function settleClaim(claim: WonClaim, outcome: { ok: true } | { ok: false; message: string }, log: ReconcileLogger): Promise<boolean> {
    const ids = { stripeEventId: claim.eventId };
    const written = outcome.ok
      ? await deps.claims.complete(claim.eventId)
      : await deps.claims.markFailed(claim.eventId, outcome.message);
    if (written.error) {
      // The row stays `processing`; the stale reclaim takes it back after 15 minutes.
      log.error({ event: 'bos_plan_reconcile_claim_not_settled', ok: outcome.ok, ...ids, alert: true }, 'Plan reconcile could not settle a claim');
      return false;
    }
    return true;
  }

  /** Runs the handler ONLY on a won claim, then settles it. Returns whether the handler returned and whether the claim was settled. */
  async function runOnWonClaim(event: Stripe.Event, claim: WonClaim, log: ReconcileLogger): Promise<{ handled: boolean; settled: boolean }> {
    try {
      await deps.handle(event, log);
    } catch (error) {
      log.error(
        { event: 'bos_plan_reconcile_replay_failed', stripeEventId: event.id, eventType: event.type, errorName: errorName(error), alert: true },
        'Plan reconcile replay failed; the claim is released for a later attempt'
      );
      const settled = await settleClaim(claim, { ok: false, message: failureMessageOf(error) }, log);
      return { handled: false, settled };
    }
    const settled = await settleClaim(claim, { ok: true }, log);
    return { handled: true, settled };
  }

  function finding(log: ReconcileLogger, kind: PlanReconcileFindingKind, ids: Record<string, string | null>): void {
    log.error({ event: 'bos_plan_reconcile_finding', kind, ...ids, alert: true }, 'Plan reconcile finding: a person should look');
  }

  async function stepA(
    events: Stripe.Event[],
    serverLivemode: boolean,
    counts: Counts,
    context: ReconcilePassContext,
    stopAt: number
  ): Promise<Stripe.Event[]> {
    const log = context.log;
    const toCheck: Stripe.Event[] = [];
    // Unverified (api_version, type) pairs seen this run, with counts: one summary line, no ids.
    const unverified = new Map<string, number>();
    let handled = 0;
    for (const event of events) {
      if (deps.clock() >= stopAt) {
        counts.deadlineHit = 1;
        break;
      }
      if (handled >= PLAN_RECONCILE_LIMITS.BATCH) {
        counts.incomplete = 1;
        break;
      }
      if (event.livemode !== serverLivemode) {
        // PF-15: never act on the other mode's event (the handler would refuse it too).
        counts.skippedNotPlan += 1;
        continue;
      }
      if (!isVerifiedShape(deps.verifiedShapes, event)) {
        counts.apiVersionSkipped += 1;
        const pair = `${event.api_version ?? 'none'} ${event.type}`;
        unverified.set(pair, (unverified.get(pair) ?? 0) + 1);
        continue;
      }
      if (!deps.eventTypes.includes(event.type)) {
        counts.skippedNotPlan += 1;
        continue;
      }

      const found = await deps.claims.findClaim(event.id);
      if (found.error) {
        counts.replayFailed += 1;
        log.error({ event: 'bos_plan_reconcile_claim_failed', step: 'read', stripeEventId: event.id }, 'Plan reconcile could not read a claim');
        continue;
      }
      const status = found.data?.status ?? null;
      // Only a completed `invoice.paid` needs a second look (Step C).
      if (status === 'completed' && event.type !== 'invoice.paid') continue;

      handled += 1;
      let decided: PlanReconcileDispatch;
      try {
        decided = await deps.dispatch(event, log);
      } catch (error) {
        // Ruling 13: counted and skipped; the pass never stops on it.
        counts.replayFailed += 1;
        log.warn(
          { event: 'bos_plan_reconcile_dispatch_failed', stripeEventId: event.id, eventType: event.type, errorName: errorName(error) },
          'Plan reconcile could not classify an event'
        );
        continue;
      }
      if (decided.kind !== 'plan') {
        counts.skippedNotPlan += 1;
        continue;
      }
      if (status === 'completed') {
        toCheck.push(event);
        continue;
      }

      const attempt = await takeClaim(event, status, deps.clock(), log);
      if ('failed' in attempt) {
        counts.replayFailed += 1;
        continue;
      }
      if ('lost' in attempt) {
        // Another actor holds it in flight (a live delivery, a manual run, an
        // overlapping run) and may still fail, so the window must not move past
        // it: every lost claim, raced or in flight, is incomplete (SA fix 1).
        counts.incomplete = 1;
        continue;
      }
      if (attempt.won.how === 'stale_reclaimed') counts.staleReclaimed += 1;
      const outcome = await runOnWonClaim(event, attempt.won, log);
      // A claim that could not be settled stays `processing`: relist it next run (SA fix 2).
      if (!outcome.settled) counts.incomplete = 1;
      const done = outcome.handled;
      if (done) {
        counts.replayed += 1;
        log.info(
          { event: 'bos_plan_reconcile_replayed', stripeEventId: event.id, eventType: event.type, claim: attempt.won.how },
          'Plan reconcile replayed an event the webhook had not finished'
        );
      } else {
        counts.replayFailed += 1;
      }
    }
    if (unverified.size > 0) {
      const pairs = [...unverified.entries()].map(([pair, count]) => {
        const [apiVersion, eventType] = pair.split(' ');
        return { apiVersion, eventType, count };
      });
      log.warn(
        { event: 'bos_plan_reconcile_unverified_shapes', pairs },
        'Plan reconcile skipped events at an unverified Stripe API version or shape'
      );
    }
    return toCheck;
  }

  async function stepC(paid: Stripe.Event[], serverLivemode: boolean, counts: Counts, log: ReconcileLogger): Promise<void> {
    if (paid.length === 0) return;
    const eventIds = paid.map((event) => event.id);
    const invoiceIds = paid.map(invoiceIdOf).filter((id): id is string => id !== null);
    const recorded = await deps.recordedPayments(serverLivemode, { eventIds, invoiceIds });
    if (recorded.error || recorded.data === null) {
      counts.checkIncomplete = 1;
      log.error({ event: 'bos_plan_reconcile_check_failed', step: 'paid_invoices' }, 'Plan reconcile could not read the money history');
      return;
    }
    const events = new Set(recorded.data.eventIds);
    const invoices = new Set(recorded.data.invoiceIds);
    for (const event of paid) {
      const invoiceId = invoiceIdOf(event);
      if (events.has(event.id) || (invoiceId !== null && invoices.has(invoiceId))) continue;
      counts.unassigned += 1;
      finding(log, 'paid_invoice_unassigned', { stripeEventId: event.id, stripeInvoiceId: invoiceId });
    }
  }

  async function stepB(stripe: PlanReconcileStripePort, serverLivemode: boolean, counts: Counts, context: ReconcilePassContext, stopAt: number): Promise<void> {
    const log = context.log;
    const nowMs = deps.clock();
    let prices: ReadonlyMap<string, string>;
    try {
      prices = await deps.planPrices();
    } catch (error) {
      counts.checkIncomplete = 1;
      log.error({ event: 'bos_plan_reconcile_stripe_unavailable', step: 'prices', errorName: errorName(error) }, 'Plan reconcile could not load the plan prices');
      return;
    }
    // Plan prices switched off: nothing is a plan subscription yet.
    if (prices.size === 0) return;

    const subscriptions = new Map<string, PlanReconcileSubscription>();
    let listsComplete = true;
    for (const priceId of prices.keys()) {
      if (deps.clock() >= stopAt) {
        listsComplete = false;
        break;
      }
      try {
        const listed = await stripe.listBusinessOsSubscriptionsByPrice(priceId);
        if (!listed.complete) listsComplete = false;
        for (const subscription of listed.items) {
          if (subscription.livemode === serverLivemode) subscriptions.set(subscription.id, subscription);
        }
      } catch (error) {
        listsComplete = false;
        log.error({ event: 'bos_plan_reconcile_stripe_unavailable', step: 'subscriptions', errorName: errorName(error) }, 'Plan reconcile could not list subscriptions');
        break;
      }
    }
    if (!listsComplete) counts.checkIncomplete = 1;

    const rows = await deps.billingRows(serverLivemode);
    if (rows.error || rows.data === null) {
      counts.checkIncomplete = 1;
      log.error({ event: 'bos_plan_reconcile_check_failed', step: 'billing_rows' }, 'Plan reconcile could not read the billing records');
      return;
    }

    const tierOf = (subscription: PlanReconcileSubscription): string | null => {
      const tiers = new Set<string>();
      for (const item of subscription.items) {
        const tier = item.priceId === null ? undefined : prices.get(item.priceId);
        if (tier !== undefined) tiers.add(tier);
      }
      return tiers.size === 1 ? [...tiers][0] : null;
    };
    const periodOf = (subscription: PlanReconcileSubscription): { startMs: number | null; endMs: number | null } => {
      let start: number | null = null;
      let end: number | null = null;
      for (const item of subscription.items) {
        if (item.currentPeriodEnd !== null && (end === null || item.currentPeriodEnd > end)) end = item.currentPeriodEnd;
        if (item.currentPeriodStart !== null && (start === null || item.currentPeriodStart > start)) start = item.currentPeriodStart;
      }
      return { startMs: start === null ? null : start * 1000, endMs: end === null ? null : end * 1000 };
    };

    const open = rows.data.filter((row) => row.ended_at === null);
    const payingAccounts = open
      .filter((row) => row.user_id !== null && row.subscription_status !== null && PAYING_STATUSES.has(row.subscription_status))
      .map((row) => row.user_id as string);
    let plans: Record<string, PlanReconcilePlanFacts> | null = null;
    if (payingAccounts.length > 0) {
      const read = await deps.planFacts(payingAccounts);
      if (read.error || read.data === null) {
        counts.checkIncomplete = 1;
        log.error({ event: 'bos_plan_reconcile_check_failed', step: 'plan_rows' }, 'Plan reconcile could not read the plan rows');
      } else {
        plans = read.data;
      }
    }

    for (const row of open) {
      const ids = { billingAccountId: row.id, stripeSubscriptionId: row.stripe_subscription_id };
      const subscription = subscriptions.get(row.stripe_subscription_id);
      if (!subscription) {
        // Only a complete list can say "Stripe does not hold it open".
        if (listsComplete) {
          counts.mismatch += 1;
          finding(log, 'subscription_not_listed', ids);
        }
        continue;
      }
      const found: PlanReconcileFindingKind[] = [];
      if (row.subscription_status !== subscription.status) found.push('status_differs');
      if (row.cancel_at_period_end !== subscription.cancelAtPeriodEnd) found.push('cancel_flag_differs');
      if (subscription.endedAt !== null) found.push('ended_differs');
      const stripeTier = tierOf(subscription);

      // The period and the plan row are compared only while Stripe and our
      // record both say "paying" (past_due excluded: a failed renewal moves
      // Stripe's period ahead of the paid one, by design).
      const paying = subscription.status === 'active' && row.subscription_status !== null && PAYING_STATUSES.has(row.subscription_status);
      const period = periodOf(subscription);

      if (stripeTier !== null && row.bought_tier !== null && row.bought_tier !== stripeTier) found.push('tier_differs');
      // FU-P8b-6 (SA P3-SA-2 item 6, P3-SA-10): a paying row whose mirror holds
      // NO tier, while Stripe's resolves, is the same root difference. Only once
      // the period is known to have started at least a day ago: inside a day,
      // or with no known start, a null is a checkout still settling. A separate
      // predicate on purpose: `settled` below treats an unknown start as settled.
      const nullTierSettled =
        paying && period.startMs !== null && nowMs - period.startMs >= PLAN_RECONCILE_LIMITS.RENEWAL_SETTLE_MS;
      if (stripeTier !== null && row.bought_tier === null && nullTierSettled) found.push('tier_differs');

      // A renewal younger than a day may still be waiting for its paid invoice.
      const settled = period.startMs === null || nowMs - period.startMs >= PLAN_RECONCILE_LIMITS.RENEWAL_SETTLE_MS;
      const periodComparable = paying && settled && period.endMs !== null;
      if (periodComparable) {
        const ours = isoToMs(row.current_period_end);
        if (ours !== null && !sameInstant(ours, period.endMs)) found.push('period_differs');
      }
      // The plan row against Stripe, ONE finding per root difference: when our
      // mirror already differs from Stripe on the same fact, that finding says it.
      if (paying && plans !== null && row.user_id !== null) {
        const plan = plans[row.user_id] ?? null;
        const tierOnPlan = plan?.tier ?? null;
        if (!found.includes('tier_differs') && (tierOnPlan === null || (stripeTier !== null && tierOnPlan !== stripeTier))) {
          found.push('plan_tier_differs');
        } else if (
          periodComparable &&
          !found.includes('period_differs') &&
          !found.includes('tier_differs') &&
          !sameInstant(isoToMs(plan?.tierExpiresAt ?? null), period.endMs)
        ) {
          found.push('plan_paid_through_differs');
        }
      }
      for (const kind of found) {
        counts.mismatch += 1;
        finding(log, kind, ids);
      }
    }

    // Orphans: never from a list that stopped short (SA ruling 14).
    if (!listsComplete) return;
    const held = new Set(rows.data.map((row) => row.stripe_subscription_id));
    for (const subscription of subscriptions.values()) {
      if (held.has(subscription.id) || NOT_ORPHAN_STATUSES.has(subscription.status)) continue;
      counts.orphan += 1;
      finding(log, 'orphan', { billingAccountId: null, stripeSubscriptionId: subscription.id });
    }
  }

  return {
    name: 'plan',
    async run(context: ReconcilePassContext): Promise<ReconcilePassCounts> {
      const counts = zeroCounts();
      const log = context.log;
      const stopAt = context.deadlineAt - PLAN_RECONCILE_LIMITS.MARGIN_MS;
      const nowMs = context.now.getTime();

      const serverLivemode = deps.keyLivemode();
      const stripe = serverLivemode === null ? null : deps.stripe();
      if (serverLivemode === null || stripe === null) {
        counts.incomplete = 1;
        log.error({ event: 'bos_plan_reconcile_stripe_unavailable', step: 'key', alert: true }, 'Plan reconcile has no usable Stripe key; nothing done');
        return counts;
      }

      // Step A: the window, then Stripe's own events, oldest first.
      const window = planReconcileWindow(nowMs, await deps.recentRuns(new Date(nowMs - PLAN_RECONCILE_LIMITS.RUN_HISTORY_MS).toISOString()));
      if (window.basis === 'runs_unreadable') counts.checkIncomplete = 1;
      if (window.clipped) counts.windowClipped = 1;

      let events: Stripe.Event[] = [];
      try {
        const listed = await stripe.listBusinessOsPlanEvents({ createdGte: window.createdGte, types: deps.eventTypes });
        if (!listed.complete) counts.incomplete = 1;
        events = [...listed.items].sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      } catch (error) {
        counts.incomplete = 1;
        log.error({ event: 'bos_plan_reconcile_stripe_unavailable', step: 'events', errorName: errorName(error), alert: true }, 'Plan reconcile could not list Stripe events');
      }
      counts.eventsSeen = events.length;

      const paid = await stepA(events, serverLivemode, counts, context, stopAt);
      await stepC(paid, serverLivemode, counts, log);
      if (deps.clock() >= stopAt) {
        counts.checkIncomplete = 1;
      } else {
        await stepB(stripe, serverLivemode, counts, context, stopAt);
      }

      log.info(
        { event: 'bos_plan_reconcile_done', trigger: context.trigger, windowBasis: window.basis, ...counts },
        'Plan reconcile pass finished'
      );
      return counts;
    },
  };
}

/**
 * Each Business OS account's credit position in its current period, for two
 * admin readers (credit deduction slice 8a; FR-48, AC-43; SA SQ-41 to SQ-43;
 * finance & business health slice 1b, SA-Q7).
 *
 * ── WHAT IT ANSWERS: ONE CORE, TWO PROJECTIONS (SA-Q7) ───────────────────────
 * The pass computes each account's position ONCE (allowance, used, trial), and
 * each reader projects it:
 *   - `readAdminCreditsLeft` (the admin Businesses list): the same percentage
 *     and band the owner's Credits card shows (`creditBands.ts`), or "no
 *     allowance", or "unknown". Never a credit count, a token, a cost or a
 *     dollar: `AdminCreditsLeft` has no room for one (AC-43);
 *   - `readAdminCreditPositions` (the admin finance page's credits section):
 *     the allowance and the credits used, in credits, for the over-allowance
 *     counts. Credits are units, never money.
 *
 * ── ONE BATCHED PASS, NO N+1 (SQ-42) ─────────────────────────────────────────
 *   1. allowances: `getEntitlementService().getSnapshots(ids)` — one read per
 *      100 accounts, read-through (no cache), in parallel with
 *   2. plan anchors: `findPeriodAnchorsBatch` — one read per 100 accounts;
 *   3. totals: `listTotalsForAccountsInRange` — one read per 200 accounts, over
 *      a bounded day range, `user_id, period_start, credits_total` only.
 * The current period's row is SELECTED among the rows read by EXACT KEY:
 * `isCurrentPeriodRow` keeps only the row whose `period_start` equals, to the
 * millisecond, `currentPeriodStartMs(anchor, now)` — a TS mirror of the
 * database's `business_os_credit_period_start`, pinned to its SQL body, and the
 * key the owner card reads. It is computed once per account, never by one
 * period-function call per account. Not a range: after a re-anchor (a plan
 * payment or an admin tier change) the old anchor's rows must not count. An
 * unreadable monthly anchor is "unknown". A trial sums its rows from the
 * anchor. The window rule is the owner card's (`creditWindowRule.ts`).
 *
 * ── FAILURE ISOLATION ────────────────────────────────────────────────────────
 * Never throws. The whole pass runs under a fixed budget (2 s): on a timeout,
 * a failed anchor or totals read, or a totals read that reached its ceiling,
 * EVERY account is "unknown" and one warning is logged — the list still
 * answers. A failed entitlement chunk, or one unreadable figure, makes only
 * those accounts "unknown". A timed-out pass's late results change nothing.
 *
 * ── THIS FILE AND THE ENTITLEMENTS MODULE ────────────────────────────────────
 * Imports `getEntitlementService` (`getSnapshots`, never `check()` /
 * `decide()`), `resolveAccountId` (the account seam) and
 * `creditAllowanceForDisplay`. Registered as a non-gate importer: display
 * only, it refuses nothing.
 *
 * ── TENANT ISOLATION ─────────────────────────────────────────────────────────
 * Service role (cross-account, admin display), wired in
 * `adminCreditPercentDeps.ts`. Both callers sit behind `requireAdmin`, and the
 * ids never come from raw request input:
 *   - `GET /api/admin/users`: the route's own profile list;
 *   - `GET /api/admin/business-os/finance`: the route's own plan walk, or the
 *     one picked business, which the route validated as a UUID and the builder
 *     checked against the plan table before any read (SEC-3).
 *
 * Scale trigger (SA SQ-42): above 1,000 Business OS accounts, or a pass p95
 * above 1 s in the `info` line, move this to a separate visible-rows route.
 *
 * @module lib/business-os/credits/adminCreditPercent
 */

import 'server-only';

import { getEntitlementService } from '@/lib/business-os/entitlements/EntitlementService';
import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { creditAllowanceForDisplay } from '@/lib/business-os/entitlements/creditAllowanceView';
import { roundToLedger } from './creditBalance';
import { creditPercentLeft } from './creditBands';
import { currentPeriodStartMs, isAtOrAfter, isCurrentPeriodRow, utcDayFloor } from './creditPeriod';
import { creditWindowRule, parseLedgerFigure } from './creditWindowRule';

type Result<T> = { data: T | null; error: Error | null };

/** One account's figure on the admin list. No count, cost or token by construction. */
export type AdminCreditsLeft =
  | { kind: 'percent'; value: number; trial: boolean }
  | { kind: 'less_than_one'; trial: boolean }
  | { kind: 'no_allowance' }
  | { kind: 'unknown' };

export interface AdminCreditsPass {
  outcome: 'ok' | 'failed' | 'timeout';
  /** Keyed by the LIST's user id. */
  byUserId: Map<string, AdminCreditsLeft>;
}

/**
 * One account's credit position in its current period (SA-Q7). Counts, in
 * credits: the finance route only; the Businesses list never receives one.
 * `used` is at the ledger's 6 decimal places.
 */
export type AdminCreditPosition =
  | { kind: 'position'; allowance: number; used: number; trial: boolean }
  | { kind: 'no_allowance' }
  | { kind: 'unknown' };

export interface AdminCreditPositionsPass {
  outcome: 'ok' | 'failed' | 'timeout';
  /** Keyed by the CALLER's id. On 'failed' / 'timeout' every id is `unknown`. */
  byUserId: Map<string, AdminCreditPosition>;
}

/** A totals row as the pass reads it (structural: the repository's own type is not imported here). */
export interface AdminTotalsRow {
  user_id: string;
  period_start: string;
  credits_total: number | string;
}

/** The reads the pass needs. Production: `adminCreditPercentDeps()`. */
export interface AdminCreditPercentDeps {
  findPeriodAnchorsBatch: (accountIds: readonly string[]) => Promise<Result<Record<string, string>>>;
  listTotalsForAccountsInRange: (
    accountIds: readonly string[],
    range: { from: Date; to: Date },
    opts: { pageSize: number; ceiling: number }
  ) => Promise<Result<{ rows: AdminTotalsRow[]; reachedCeiling: boolean }>>;
  /** Tests only. Production reads `getEntitlementService().getSnapshots`. */
  getSnapshots?: ReturnType<typeof getEntitlementService>['getSnapshots'];
}

export interface AdminCreditPercentLogger {
  info: (ctx: Record<string, unknown>, msg: string) => void;
  warn: (ctx: Record<string, unknown>, msg: string) => void;
}

/** 2 s (SA SQ-42). Written as seconds × 1000: the credit-figure guard reads a bare 2,000 as the trial allowance. */
export const ADMIN_CREDITS_BUDGET_MS = 2 * 1000;

/** Ids per anchor read: the plan repository's batch limit. */
const ANCHOR_CHUNK = 100;
/** Ids per totals read: the ledger read repository's `.in()` limit. */
const TOTALS_CHUNK = 200;
const TOTALS_PAGING = { pageSize: 1_000, ceiling: 5_000 } as const;

const DAY_MS = 24 * 60 * 60 * 1000;
/** A monthly period is at most 31 days; the range reaches back one more. */
const MONTHLY_LOOKBACK_DAYS = 32;
/** A trial anchor older than this is an anomaly: "unknown", and it does not widen the range (SA Q-5). */
const TRIAL_ANCHOR_MAX_AGE_DAYS = 92;

const UNKNOWN: AdminCreditsLeft = { kind: 'unknown' };
const UNKNOWN_POSITION: AdminCreditPosition = { kind: 'unknown' };

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface Position {
  anchor: string;
  allowance: number;
  trial: boolean;
}

/** The pass itself (the one core, SA-Q7). Never throws; an `error` makes every account unknown. */
async function computePositions(
  accountIds: readonly string[],
  deps: AdminCreditPercentDeps,
  now: Date
): Promise<{ byAccount: Map<string, AdminCreditPosition>; error: Error | null }> {
  const byAccount = new Map<string, AdminCreditPosition>();
  try {
    const getSnapshots = deps.getSnapshots ?? ((ids) => getEntitlementService().getSnapshots(ids));

    const readAnchors = async (): Promise<Result<Record<string, string>>> => {
      const anchors: Record<string, string> = {};
      for (const chunk of chunksOf(accountIds, ANCHOR_CHUNK)) {
        const read = await deps.findPeriodAnchorsBatch(chunk);
        if (read.error || !read.data) return { data: null, error: read.error ?? new Error('No anchors returned') };
        Object.assign(anchors, read.data);
      }
      return { data: anchors, error: null };
    };

    const [snapshots, anchorsRead] = await Promise.all([getSnapshots([...accountIds]), readAnchors()]);
    if (anchorsRead.error || !anchorsRead.data) {
      return { byAccount, error: anchorsRead.error ?? new Error('No anchors returned') };
    }
    const anchors = anchorsRead.data;

    const trialCutoffIso = new Date(now.getTime() - TRIAL_ANCHOR_MAX_AGE_DAYS * DAY_MS).toISOString();
    const positions = new Map<string, Position>();
    for (const accountId of accountIds) {
      const snapshot = snapshots.get(accountId);
      // A failed read is not "no allowance" (SA Q-4): that must stay a fact.
      if (!snapshot || snapshot.unavailable) {
        byAccount.set(accountId, UNKNOWN_POSITION);
        continue;
      }
      const rule = creditWindowRule({ anchor: anchors[accountId] ?? null, allowance: creditAllowanceForDisplay(snapshot) });
      const anchor = anchors[accountId];
      if (rule.allowance === null || anchor === undefined) {
        byAccount.set(accountId, { kind: 'no_allowance' });
        continue;
      }
      const trial = rule.mode === 'trial_total';
      // `isAtOrAfter` is the trial row-selector; reused here only as an exact
      // instant comparison (anchor vs the 92-day cutoff, SA Q-5) — same semantics.
      if (trial && !isAtOrAfter(anchor, trialCutoffIso)) {
        byAccount.set(accountId, UNKNOWN_POSITION);
        continue;
      }
      positions.set(accountId, { anchor, allowance: rule.allowance.amount, trial });
    }

    if (positions.size === 0) return { byAccount, error: null };

    // Whole-day range bounds (the ledger read's half-open rule): back far
    // enough for the current monthly period and every in-bound trial anchor.
    let from = utcDayFloor(new Date(now.getTime() - MONTHLY_LOOKBACK_DAYS * DAY_MS).toISOString());
    for (const position of positions.values()) {
      if (!position.trial) continue;
      const floor = utcDayFloor(position.anchor);
      if (floor === null) return { byAccount, error: new Error('Unreadable trial anchor') };
      if (from === null || floor.getTime() < from.getTime()) from = floor;
    }
    const today = utcDayFloor(now.toISOString());
    if (from === null || today === null) return { byAccount, error: new Error('Unreadable range bound') };
    const range = { from, to: new Date(today.getTime() + DAY_MS) };

    const rowsByAccount = new Map<string, AdminTotalsRow[]>();
    for (const chunk of chunksOf([...positions.keys()], TOTALS_CHUNK)) {
      const read = await deps.listTotalsForAccountsInRange(chunk, range, TOTALS_PAGING);
      if (read.error || !read.data) return { byAccount, error: read.error ?? new Error('No totals returned') };
      // Never a partial sum.
      if (read.data.reachedCeiling) return { byAccount, error: new Error('Credit totals reached the read ceiling') };
      for (const row of read.data.rows) {
        const list = rowsByAccount.get(row.user_id) ?? [];
        list.push(row);
        rowsByAccount.set(row.user_id, list);
      }
    }

    for (const [accountId, position] of positions) {
      // Once per account, not per row: the key the database would give now.
      const expectedStartMs = position.trial ? null : currentPeriodStartMs(position.anchor, now);
      // An unreadable monthly anchor is unknown, never "nothing used" (SA W-5),
      // as the trial branch already refuses an unreadable anchor.
      if (!position.trial && expectedStartMs === null) {
        byAccount.set(accountId, UNKNOWN_POSITION);
        continue;
      }
      const rows = (rowsByAccount.get(accountId) ?? []).filter((row) =>
        position.trial
          ? isAtOrAfter(row.period_start, position.anchor)
          : isCurrentPeriodRow(position.anchor, row.period_start, now, expectedStartMs)
      );
      let used = 0;
      let readable = true;
      for (const row of rows) {
        const credits = parseLedgerFigure(row.credits_total);
        if (credits === null) {
          readable = false;
          break;
        }
        used += credits;
      }
      // No row: nothing charged this period. Each reader projects the position.
      byAccount.set(
        accountId,
        readable ? { kind: 'position', allowance: position.allowance, used: roundToLedger(used), trial: position.trial } : UNKNOWN_POSITION
      );
    }

    return { byAccount, error: null };
  } catch (error) {
    return { byAccount, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Projection 1, the Businesses list: today's kinds, through the card's own percentage (SA-Q7). */
function toCreditsLeft(position: AdminCreditPosition): AdminCreditsLeft {
  if (position.kind !== 'position') return position;
  // `used` is already at 6 dp (`roundToLedger` in the core); the percentage is the one the list always showed.
  const percent = creditPercentLeft(position.used, position.allowance);
  if (percent === null) return UNKNOWN;
  if (percent.shown.kind === 'less_than_one') return { kind: 'less_than_one', trial: position.trial };
  return { kind: 'percent', value: percent.shown.value, trial: position.trial };
}

/** Each reader's own log messages. */
interface PassMessages {
  timeout: string;
  failed: string;
  served: string;
}

/**
 * The shared budget runner (SA-Q7): the account seam, ONE clock, the 2 s race
 * with an unref'd timer, and the timeout / failed / ok branching. Never
 * throws. Each reader passes its own messages and its projection; the info
 * line carries counts by kind and timing only, never a figure per account.
 */
async function runWithinBudget<T extends { kind: string }>(
  userIds: readonly string[],
  deps: AdminCreditPercentDeps,
  log: AdminCreditPercentLogger,
  options: { now?: Date; budgetMs?: number },
  messages: PassMessages,
  project: (position: AdminCreditPosition) => T,
  emptyCounts: () => Record<T['kind'], number>
): Promise<{ outcome: 'ok' | 'failed' | 'timeout'; byUserId: Map<string, T> }> {
  // ONE clock for the whole pass: the period selector and the range (SA C-W3).
  const now = options.now ?? new Date();
  const budgetMs = options.budgetMs ?? ADMIN_CREDITS_BUDGET_MS;
  const started = Date.now();

  const accountOf = new Map<string, string>();
  for (const userId of userIds) accountOf.set(userId, resolveAccountId(userId));
  const accountIds = [...new Set(accountOf.values())];

  const everyone = (value: T) => new Map([...accountOf.keys()].map((userId) => [userId, value]));
  if (accountIds.length === 0) return { outcome: 'ok', byUserId: new Map() };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), budgetMs);
    // Never keeps a serverless instance alive on its own.
    if (typeof timer === 'object' && timer && 'unref' in timer) timer.unref();
  });

  try {
    const outcome = await Promise.race([computePositions(accountIds, deps, now), timeout]);
    const ms = Date.now() - started;

    if (outcome === 'timeout') {
      log.warn({ outcome: 'timeout', accounts: accountIds.length, ms }, messages.timeout);
      return { outcome: 'timeout', byUserId: everyone(project(UNKNOWN_POSITION)) };
    }
    if (outcome.error) {
      log.warn({ outcome: 'failed', accounts: accountIds.length, ms, err: outcome.error }, messages.failed);
      return { outcome: 'failed', byUserId: everyone(project(UNKNOWN_POSITION)) };
    }

    const byUserId = new Map<string, T>();
    const counts = emptyCounts();
    for (const [userId, accountId] of accountOf) {
      const value = project(outcome.byAccount.get(accountId) ?? UNKNOWN_POSITION);
      byUserId.set(userId, value);
      counts[value.kind as T['kind']] += 1;
    }
    // Counts and timing only — never a figure per account.
    log.info({ outcome: 'ok', accounts: accountIds.length, ms, ...counts }, messages.served);
    return { outcome: 'ok', byUserId };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Credits left for the listed users. Never throws. `userIds` are the list's
 * rows that HAVE a Business OS business, built by the admin route.
 */
export async function readAdminCreditsLeft(
  userIds: readonly string[],
  deps: AdminCreditPercentDeps,
  log: AdminCreditPercentLogger,
  options: { now?: Date; budgetMs?: number } = {}
): Promise<AdminCreditsPass> {
  return runWithinBudget(
    userIds,
    deps,
    log,
    options,
    {
      timeout: 'Admin credits-left pass timed out; every row shows unknown',
      failed: 'Admin credits-left pass failed; every row shows unknown',
      served: 'Admin credits-left pass served',
    },
    toCreditsLeft,
    (): Record<AdminCreditsLeft['kind'], number> => ({ percent: 0, less_than_one: 0, no_allowance: 0, unknown: 0 })
  );
}

/**
 * Projection 2 (SA-Q7): each account's position, for the admin finance page's
 * credits section. Never throws. `userIds` are the finance route's own plan
 * rows, or its one picked business (see TENANT ISOLATION above). The same
 * reads, budget and failure rules as the list.
 */
export async function readAdminCreditPositions(
  userIds: readonly string[],
  deps: AdminCreditPercentDeps,
  log: AdminCreditPercentLogger,
  options: { now?: Date; budgetMs?: number } = {}
): Promise<AdminCreditPositionsPass> {
  return runWithinBudget(
    userIds,
    deps,
    log,
    options,
    {
      timeout: 'Admin credit positions pass timed out; every row shows unknown',
      failed: 'Admin credit positions pass failed; every row shows unknown',
      served: 'Admin credit positions pass served',
    },
    (position: AdminCreditPosition) => position,
    (): Record<AdminCreditPosition['kind'], number> => ({ position: 0, no_allowance: 0, unknown: 0 })
  );
}

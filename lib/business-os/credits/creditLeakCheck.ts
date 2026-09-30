/**
 * The credit leak check — was every Business OS AI call in `token_usage`
 * billed? (credit deduction slice 4b; requirement SA-S9, FR-16 detection,
 * FR-33, AC-31; workplan §5).
 *
 * READ-ONLY. No write, no LLM call, no audit entry, no results table. It reads
 * `token_usage` (through `TokenUsageRepository.listCallsInWindow`, per account)
 * and the credit ledger (through the 4a read repository, per account), matches
 * them per `(account, group id)` ↔ `(account, session_id)`, and reports.
 *
 * TWO DOORS, ONE FUNCTION (§5.4): the admin "Run leak check" route and the
 * nightly cron both call `runCreditLeakCheck`. The dependencies are injected;
 * `creditLeakCheckDeps.ts` wires the real repositories.
 *
 * NOT A QUEUE DRAIN (skill `durable-queue-drain`): nothing is claimed, no effect
 * runs, and two overlapping runs are harmless.
 *
 * TENANT SCOPE: every read names the one account being checked, except the two
 * deliberate, named cross-account reads used to LIST accounts (the plan pages
 * and the all-accounts totals read) and the platform-account count.
 *
 * NEVER GROUPS ON THE RAW `service` COLUMN (N-10): rows are matched on their
 * EFFECTIVE service through `resolveEffectiveFields`; the source guard
 * `serviceColumn.guard.test.ts` scans this file.
 *
 * LOGS carry ids, counts and one USD figure (`unchargedCostUsd`), never owner
 * text (bos-llm-call-standards Standard 5). Business names are added by the
 * admin route for display and never logged.
 *
 * @module lib/business-os/credits/creditLeakCheck
 */

import { createLogger, type Logger } from '@/lib/logger';
import { AI_CHARGE_SERVICE } from '@/lib/business-os/llm/aiChargeRecorder';
import {
  BOS_KNOWN_NON_CATALOG_COMPONENTS,
  BOS_LEGACY_HELPER_LABEL,
  bosFeature,
  bosRowFilter,
  isPlatformAccount,
  isPlatformAccountEnvIgnored,
  platformAccountIds,
} from '@/lib/business-os/llm/callCatalog';
import type {
  LedgerCallRow,
  TokenUsageFeatureFilter,
  TokenUsageMatch,
  TokenUsageWindow,
} from '@/lib/repositories/TokenUsageRepository';
import type {
  CreditLedgerPagedResult,
  CreditLedgerPageOptions,
  CreditLedgerRow,
  CreditPeriodStartRange,
  CreditTotalsRow,
} from '@/lib/repositories/BusinessOsCreditLedgerReadRepository';
import { resolveEffectiveFields, type EffectiveFieldsInput } from './effectiveFields';
import type {
  CreditLeakCheckResult,
  LeakAccountCounts,
  LeakAccountFinding,
  LeakAccountStatus,
  LeakAccountUsd,
  LeakBlindSpot,
  LeakGroupCase,
  LeakGroupExample,
  LeakKnownPath,
} from './creditLeakCheckTypes';

const defaultLogger = createLogger({ module: 'BosCreditLeakCheck' });

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const LEAK_CHECK_LIMITS = {
  /** Slack on both reads, so an action straddling an edge is matched (§5.2). */
  SLACK_MS: HOUR_MS,
  /** The longest an action can run (`maxDuration` 300 s): the usage read starts this much earlier (B-1). */
  LONGEST_ACTION_MS: 5 * MINUTE_MS,
  /** An on-demand end later than now minus this is pulled back: an action may still be running. */
  SETTLE_MS: 6 * MINUTE_MS,
  PAGE_SIZE: 1000,
  /** Per account, per read. `TokenUsageRepository` allows at most 5,000. */
  USAGE_CEILING: 5000,
  LEDGER_CEILING: 5000,
  PLAN_PAGE_SIZE: 500,
  /** A safety stop for the plan walk (500 × 200 = 100,000 accounts). */
  MAX_PLAN_PAGES: 200,
  TOTALS_CEILING: 2000,
  /** A billing period is at most 31 days (the 4a report's rule). */
  PERIOD_LOOKBACK_DAYS: 31,
  EXAMPLES_PER_CASE: 20,
  /** SA N-5. */
  MAX_ON_DEMAND_DAYS: 7,
  /** Both doors stop STARTING accounts after this long (route `maxDuration` 60). */
  RUN_DEADLINE_MS: 45_000,
  /** SA S-2: one micro-dollar per call, whether token_usage rounds or truncates. */
  TOLERANCE_PER_CALL_USD: 0.000001,
  TOLERANCE_BASE_USD: 1e-9,
} as const;

/** Every result states these (§5.2). */
export const LEAK_BLIND_SPOTS: readonly LeakBlindSpot[] = [
  'no_plan_no_charge_account',
  'sub_microdollar_reused_group',
  'never_reached_token_usage',
  'outside_business_os_filter',
  'edge_of_window',
  'fallback_masks_undercharge',
];

/** SA S-2. */
export function leakTolerance(calls: number): number {
  return calls * LEAK_CHECK_LIMITS.TOLERANCE_PER_CALL_USD + LEAK_CHECK_LIMITS.TOLERANCE_BASE_USD;
}

// ─────────────────────────────────────────────────────────────────────────────
// The billing period (S-4): the RPC's own rule, in TypeScript
// ─────────────────────────────────────────────────────────────────────────────

/** `anchor + months`, day clamped to the target month's last day (Postgres `+ interval 'n months'`). */
function addMonthsUtc(anchor: Date, months: number): number {
  const total = anchor.getUTCMonth() + months;
  const year = anchor.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(
    year,
    month,
    Math.min(anchor.getUTCDate(), lastDay),
    anchor.getUTCHours(),
    anchor.getUTCMinutes(),
    anchor.getUTCSeconds(),
    anchor.getUTCMilliseconds()
  );
}

/**
 * The period a charge written at `atMs` would get: `business_os_credit_period_start`
 * (migration 20261015) for an account with a plan anchor, else the UTC calendar
 * month (the RPC's `calendar_month` branch). Null when the anchor is unreadable.
 *
 * A label, at millisecond precision: an anchor's microseconds are not kept.
 */
export function creditPeriodStartAt(anchorIso: string | null, atMs: number): string | null {
  if (!Number.isFinite(atMs)) return null;
  const at = new Date(atMs);
  if (anchorIso === null) {
    return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
  }
  const anchorMs = Date.parse(anchorIso);
  if (Number.isNaN(anchorMs)) return null;
  const anchor = new Date(anchorMs);
  let months = (at.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (at.getUTCMonth() - anchor.getUTCMonth());
  let candidate = addMonthsUtc(anchor, months);
  if (candidate > atMs) {
    months -= 1;
    candidate = addMonthsUtc(anchor, months);
  }
  return new Date(candidate).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// The pure classifier (§5.2)
// ─────────────────────────────────────────────────────────────────────────────

/** `feature|component` of every known path exempt from needing a group id (S-3). */
const KNOWN_PATH_KEYS: ReadonlySet<string> = new Set(
  Object.values(BOS_KNOWN_NON_CATALOG_COMPONENTS)
    .filter((entry) => (entry.exemptFrom as readonly string[]).includes('missing_group_id'))
    .map((entry) => `${bosFeature(entry.area)}|${entry.component}`)
);

export function isKnownUnchargedPath(feature: string | null, component: string | null): boolean {
  return KNOWN_PATH_KEYS.has(`${feature ?? ''}|${component ?? ''}`);
}

export interface LeakWindowMs {
  startMs: number;
  /** Exclusive. */
  endMs: number;
}

export interface ClassifyLeakInput {
  accountId: string;
  usageRows: readonly LedgerCallRow[];
  ledgerRows: readonly CreditLedgerRow[];
  window: LeakWindowMs;
  /** The period of an uncharged call at this instant (S-4); null when it cannot be told. */
  periodOf: (atMs: number) => string | null;
}

export interface LeakClassification {
  counts: LeakAccountCounts;
  usd: LeakAccountUsd;
  examples: LeakAccountFinding['examples'];
  knownPaths: LeakKnownPath[];
  /** Distinct periods of the leak findings, oldest first. */
  leakPeriodStarts: string[];
  /** The earliest leak finding's period. */
  leakPeriodStart: string | null;
  /** The first examined group's period, for an account with findings but no leak. */
  firstPeriodStart: string | null;
  /** Each examined group's case, keyed by group id (tests and drill-down). */
  cases: Map<string, LeakGroupCase>;
}

interface Amount {
  value: number;
  ok: boolean;
}

/** A numeric column as read; null means nothing was recorded (0). NaN is unreadable, never silent. */
function amountOf(raw: number | string | null | undefined): Amount {
  if (raw === null || raw === undefined) return { value: 0, ok: true };
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? { value, ok: true } : { value: 0, ok: false };
}

const round10 = (value: number) => Math.round(value * 1e10) / 1e10;

interface UsagePoint {
  t: number;
  at: string;
  cost: number;
  tokens: number;
}

interface LedgerPoint {
  t: number;
  cost: number;
  isCharge: boolean;
  isFallback: boolean;
  periodStart: string;
}

interface Group {
  usage: UsagePoint[];
  ledger: LedgerPoint[];
}

function emptyCounts(): LeakAccountCounts {
  return {
    groupsExamined: 0,
    matched: 0,
    uncharged: 0,
    undercharged: 0,
    ungroupedCalls: 0,
    noSpend: 0,
    pendingReconciliation: 0,
    pendingUndercharged: 0,
    chargedAboveUsage: 0,
    knownPathCalls: 0,
    unresolvedCorrections: 0,
    unreadableAmounts: 0,
  };
}

function emptyUsd(): LeakAccountUsd {
  return { uncharged: 0, undercharged: 0, ungrouped: 0, totalUncharged: 0, knownPath: 0 };
}

/**
 * Classify one account's groups. PURE: no read, no log, no clock.
 *
 * B-1: a group is examined when ANY of its usage rows or ANY of its charge-side
 * rows falls inside `[start, end)`; the rows outside (the slack) only help it
 * match.
 */
export function classifyLeakGroups(input: ClassifyLeakInput): LeakClassification {
  const { startMs, endMs } = input.window;
  const inWindow = (t: number) => t >= startMs && t < endMs;

  const counts = emptyCounts();
  const usd = emptyUsd();
  const examples: LeakAccountFinding['examples'] = {
    uncharged: [],
    undercharged: [],
    pendingReconciliation: [],
    chargedAboveUsage: [],
  };
  const known = new Map<string, LeakKnownPath>();
  const leakPeriods: Array<{ t: number; period: string | null }> = [];
  const cases = new Map<string, LeakGroupCase>();
  const groups = new Map<string, Group>();
  const groupOf = (id: string): Group => {
    let group = groups.get(id);
    if (!group) {
      group = { usage: [], ledger: [] };
      groups.set(id, group);
    }
    return group;
  };

  // ── Usage side ──────────────────────────────────────────────────────────
  let firstUngrouped: number | null = null;
  for (const row of input.usageRows) {
    const t = Date.parse(row.created_at);
    if (Number.isNaN(t)) {
      counts.unreadableAmounts += 1;
      continue;
    }
    const cost = amountOf(row.cost_usd);
    if (!cost.ok) counts.unreadableAmounts += 1;
    const tokens = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    const hasSpend = tokens > 0 || cost.value > 0;

    // S-3: a known uncharged path is accepted spend, in its own bucket.
    if (isKnownUnchargedPath(row.feature, row.component)) {
      if (!inWindow(t)) continue;
      const key = `${row.feature}|${row.component}`;
      const entry = known.get(key) ?? { feature: row.feature ?? '', component: row.component ?? '', calls: 0, usageUsd: 0 };
      entry.calls += 1;
      entry.usageUsd += cost.value;
      known.set(key, entry);
      counts.knownPathCalls += 1;
      usd.knownPath += cost.value;
      continue;
    }

    if (row.session_id === null || row.session_id === '') {
      // S-3: counted separately. Nothing without a grouping id can be charged.
      if (!inWindow(t) || !hasSpend) continue;
      counts.ungroupedCalls += 1;
      usd.ungrouped += cost.value;
      if (firstUngrouped === null || t < firstUngrouped) firstUngrouped = t;
      continue;
    }

    groupOf(row.session_id).usage.push({ t, at: row.created_at, cost: cost.value, tokens });
  }
  if (firstUngrouped !== null) {
    leakPeriods.push({ t: firstUngrouped, period: input.periodOf(firstUngrouped) });
  }

  // ── Charge side (effective service only, N-10) ──────────────────────────
  const chargesByActionId = new Map<string, EffectiveFieldsInput>();
  const groupByActionId = new Map<string, string | null>();
  for (const row of input.ledgerRows) {
    if (row.kind === 'charge' && row.action_id) {
      chargesByActionId.set(row.action_id, row);
      groupByActionId.set(row.action_id, row.group_id);
    }
  }
  for (const row of input.ledgerRows) {
    // The read is scoped to the account; a row of another account is never matched.
    if (row.user_id !== input.accountId) continue;
    const t = Date.parse(row.created_at);
    const cost = amountOf(row.cost_usd);
    if (!cost.ok || Number.isNaN(t)) {
      counts.unreadableAmounts += 1;
      if (Number.isNaN(t)) continue;
    }
    const fields = resolveEffectiveFields(row, chargesByActionId);
    if (!fields.resolved) {
      if (inWindow(t)) counts.unresolvedCorrections += 1;
      continue;
    }
    if (fields.effectiveService !== AI_CHARGE_SERVICE) continue;
    const groupId =
      row.group_id ?? (row.kind === 'adjustment' && row.adjusts_action_id ? groupByActionId.get(row.adjusts_action_id) ?? null : null);
    if (groupId === null) continue;
    groupOf(groupId).ledger.push({
      t,
      cost: cost.value,
      isCharge: row.kind === 'charge',
      isFallback: row.kind === 'charge' && row.is_fallback_priced === true,
      periodStart: row.period_start,
    });
  }

  // ── Classify every examined group ───────────────────────────────────────
  let firstExamined: { t: number; period: string | null } | null = null;
  for (const [groupId, group] of groups) {
    const examined = group.usage.some((u) => inWindow(u.t)) || group.ledger.some((l) => inWindow(l.t));
    if (!examined) continue;
    counts.groupsExamined += 1;

    const calls = group.usage.length;
    const usageUsd = group.usage.reduce((sum, u) => sum + u.cost, 0);
    const usageTokens = group.usage.reduce((sum, u) => sum + u.tokens, 0);
    const chargedUsd = group.ledger.reduce((sum, l) => sum + l.cost, 0);
    const charges = group.ledger.filter((l) => l.isCharge);
    const hasFallback = charges.some((l) => l.isFallback);
    const times = group.usage.map((u) => u.t).sort((a, b) => a - b);
    const firstInWindow = group.usage.filter((u) => inWindow(u.t)).map((u) => u.t).sort((a, b) => a - b)[0];
    const anchorT = firstInWindow ?? times[0] ?? group.ledger.map((l) => l.t).sort((a, b) => a - b)[0];

    // S-4: a charged group takes its charge's stored period; else the RPC's rule.
    const newestCharge = [...charges].sort((a, b) => b.t - a.t)[0];
    const periodStart = newestCharge ? newestCharge.periodStart : input.periodOf(anchorT);

    const diff = usageUsd - chargedUsd;
    const tolerance = leakTolerance(calls);
    let kase: LeakGroupCase;
    let direction: 'over' | 'under' | null = null;
    if (charges.length === 0) {
      kase = usageTokens > 0 || usageUsd > 0 ? 'uncharged' : 'no_spend';
    } else if (Math.abs(diff) <= tolerance) {
      kase = 'matched';
    } else if (hasFallback) {
      kase = 'pending_reconciliation';
      direction = diff > 0 ? 'under' : 'over';
    } else {
      kase = diff > 0 ? 'undercharged' : 'charged_above_usage';
    }
    cases.set(groupId, kase);
    if (firstExamined === null || anchorT < firstExamined.t) firstExamined = { t: anchorT, period: periodStart };

    const example: LeakGroupExample = {
      groupId,
      periodStart,
      calls,
      usageUsd: round10(usageUsd),
      chargedUsd: round10(chargedUsd),
      firstCallAt: times.length ? group.usage.find((u) => u.t === times[0])!.at : null,
      lastCallAt: times.length ? group.usage.find((u) => u.t === times[times.length - 1])!.at : null,
      direction,
    };
    const keep = (list: LeakGroupExample[]) => {
      if (list.length < LEAK_CHECK_LIMITS.EXAMPLES_PER_CASE) list.push(example);
    };

    switch (kase) {
      case 'matched':
        counts.matched += 1;
        break;
      case 'no_spend':
        counts.noSpend += 1;
        break;
      case 'uncharged':
        counts.uncharged += 1;
        usd.uncharged += usageUsd;
        keep(examples.uncharged);
        leakPeriods.push({ t: anchorT, period: periodStart });
        break;
      case 'undercharged':
        counts.undercharged += 1;
        usd.undercharged += diff;
        keep(examples.undercharged);
        leakPeriods.push({ t: anchorT, period: periodStart });
        break;
      case 'pending_reconciliation':
        counts.pendingReconciliation += 1;
        if (direction === 'under') counts.pendingUndercharged += 1;
        keep(examples.pendingReconciliation);
        break;
      case 'charged_above_usage':
        counts.chargedAboveUsage += 1;
        keep(examples.chargedAboveUsage);
        break;
    }
  }

  usd.uncharged = round10(usd.uncharged);
  usd.undercharged = round10(usd.undercharged);
  usd.ungrouped = round10(usd.ungrouped);
  usd.knownPath = round10(usd.knownPath);
  usd.totalUncharged = round10(usd.uncharged + usd.undercharged + usd.ungrouped);

  leakPeriods.sort((a, b) => a.t - b.t);
  const seenPeriods = new Map<number, string>();
  for (const { period } of leakPeriods) {
    if (period === null) continue;
    const key = Date.parse(period);
    if (!seenPeriods.has(key)) seenPeriods.set(key, period);
  }
  const leakPeriodStarts = [...seenPeriods.entries()].sort((a, b) => a[0] - b[0]).map(([, p]) => p);

  return {
    counts,
    usd,
    examples,
    knownPaths: [...known.values()].map((k) => ({ ...k, usageUsd: round10(k.usageUsd) })),
    leakPeriodStarts,
    leakPeriodStart: leakPeriods.find((p) => p.period !== null)?.period ?? null,
    firstPeriodStart: firstExamined?.period ?? null,
    cases,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The runner (§5.3)
// ─────────────────────────────────────────────────────────────────────────────

type Result<T> = { data: T | null; error: Error | null };

/** What the runner reads through. Wired to the real repositories in `creditLeakCheckDeps.ts`. */
export interface CreditLeakCheckDeps {
  /** One page of plan rows (keyset by user id). Only the id and the anchor are used. */
  pagePlanAnchors(afterUserId: string | null, limit: number): Promise<Result<Array<{ user_id: string; period_anchor: string | null }>>>;
  /** One account's plan anchor; `found: false` when it has no plan row. */
  findPlanAnchor(accountId: string): Promise<Result<{ found: boolean; periodAnchor: string | null }>>;
  listTotalsForPeriodsInRange(
    range: CreditPeriodStartRange,
    opts: CreditLedgerPageOptions
  ): Promise<Result<CreditLedgerPagedResult<CreditTotalsRow>>>;
  listLedgerRowsForAccount(
    userId: string,
    range: CreditPeriodStartRange,
    opts: CreditLedgerPageOptions
  ): Promise<Result<CreditLedgerPagedResult<CreditLedgerRow>>>;
  listUsageCallsForAccount(
    userId: string,
    window: TokenUsageWindow,
    filter: TokenUsageFeatureFilter,
    opts: { pageSize: number; ceiling: number }
  ): Promise<Result<{ rows: LedgerCallRow[]; reachedCeiling: boolean }>>;
  countPlatformCalls(userIds: readonly string[], window: TokenUsageWindow, match: TokenUsageMatch): Promise<Result<number>>;
  now(): Date;
}

export interface CreditLeakCheckInput {
  /** `[start, end)`; whole UTC days from both doors. */
  window: { start: Date; end: Date };
  /** One account, or null for every Business OS account (S-1). */
  accountId: string | null;
  /** Epoch ms after which no new account is started. */
  deadlineAt: number;
  trigger: 'on_demand' | 'nightly';
}

interface AccountToCheck {
  accountId: string;
  /** undefined = the anchor could not be read (period unknown for uncharged groups). */
  anchor: string | null | undefined;
}

const STATUS_ORDER: Record<LeakAccountStatus, number> = { leak: 0, could_not_check: 1, incomplete: 2, clean: 3 };

async function settled<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await work();
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/** Lists the accounts to walk: plan accounts ∪ accounts with a totals row in the window (S-1). */
async function listAccounts(
  input: CreditLeakCheckInput,
  window: LeakWindowMs,
  deps: CreditLeakCheckDeps
): Promise<{ accounts: AccountToCheck[]; listing: CreditLeakCheckResult['listing'] }> {
  const listing: CreditLeakCheckResult['listing'] = { planAccounts: 0, chargedWithoutPlan: 0, plans: 'ok', totals: 'ok' };

  if (input.accountId !== null) {
    const { data, error } = await settled(() => deps.findPlanAnchor(input.accountId!));
    if (error || !data) listing.plans = 'failed';
    else if (data.found) listing.planAccounts = 1;
    const anchor = error || !data ? undefined : data.found ? data.periodAnchor : null;
    return { accounts: [{ accountId: input.accountId, anchor }], listing };
  }

  const anchors = new Map<string, string | null>();
  let after: string | null = null;
  for (let page = 0; page < LEAK_CHECK_LIMITS.MAX_PLAN_PAGES; page += 1) {
    const { data, error } = await settled(() => deps.pagePlanAnchors(after, LEAK_CHECK_LIMITS.PLAN_PAGE_SIZE));
    if (error || !data) {
      listing.plans = 'failed';
      break;
    }
    for (const row of data) anchors.set(row.user_id, row.period_anchor ?? null);
    if (data.length < LEAK_CHECK_LIMITS.PLAN_PAGE_SIZE) break;
    after = data[data.length - 1].user_id;
    if (page === LEAK_CHECK_LIMITS.MAX_PLAN_PAGES - 1) listing.plans = 'failed';
  }
  listing.planAccounts = anchors.size;

  // Totals rows whose period overlaps the window: an account charged without a
  // plan row (the RPC's calendar-month branch) is walked too.
  const range: CreditPeriodStartRange = {
    from: new Date(window.startMs - LEAK_CHECK_LIMITS.PERIOD_LOOKBACK_DAYS * DAY_MS),
    to: new Date(Math.max(window.endMs, window.startMs + 1)),
  };
  const totals = await settled(() =>
    deps.listTotalsForPeriodsInRange(range, { pageSize: LEAK_CHECK_LIMITS.PAGE_SIZE, ceiling: LEAK_CHECK_LIMITS.TOTALS_CEILING })
  );
  const noPlan = new Set<string>();
  if (totals.error || !totals.data) {
    listing.totals = 'failed';
  } else {
    if (totals.data.reachedCeiling) listing.totals = 'ceiling';
    for (const row of totals.data.rows) {
      if (row.user_id && !anchors.has(row.user_id)) noPlan.add(row.user_id);
    }
  }
  listing.chargedWithoutPlan = noPlan.size;

  const accounts: AccountToCheck[] = [
    ...[...anchors.entries()].map(([accountId, anchor]) => ({ accountId, anchor })),
    // No plan row: the RPC charged it in the UTC calendar month.
    ...[...noPlan].map((accountId) => ({ accountId, anchor: null })),
  ]
    .filter((a) => !isPlatformAccount(a.accountId))
    .sort((a, b) => (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0));

  return { accounts, listing };
}

async function checkAccount(
  account: AccountToCheck,
  window: LeakWindowMs,
  settleEndMs: number,
  deps: CreditLeakCheckDeps
): Promise<LeakAccountFinding> {
  const { SLACK_MS, LONGEST_ACTION_MS, PAGE_SIZE, USAGE_CEILING, LEDGER_CEILING } = LEAK_CHECK_LIMITS;
  const usageWindow: TokenUsageWindow = {
    start: new Date(window.startMs - SLACK_MS - LONGEST_ACTION_MS),
    // N-3: `listCallsInWindow` is inclusive at the end. CR4b-S1: the upper slack
    // never reaches past now − SETTLE_MS either. A reused group examined for
    // in-window activity would otherwise sum the calls of an action still
    // running (calls written, charge not yet) and report a phantom under-charge.
    // The charge read keeps its full slack: a call read here started before
    // now − 6 min, so its charge exists unless it really was lost.
    end: new Date(Math.min(window.endMs + SLACK_MS - 1, settleEndMs)),
  };
  const ledgerRange: CreditPeriodStartRange = {
    from: new Date(window.startMs - SLACK_MS),
    to: new Date(window.endMs + SLACK_MS + LONGEST_ACTION_MS),
  };

  const [usage, ledger] = await Promise.all([
    settled(() =>
      deps.listUsageCallsForAccount(account.accountId, usageWindow, bosRowFilter(), { pageSize: PAGE_SIZE, ceiling: USAGE_CEILING })
    ),
    settled(() => deps.listLedgerRowsForAccount(account.accountId, ledgerRange, { pageSize: PAGE_SIZE, ceiling: LEDGER_CEILING })),
  ]);

  const base: LeakAccountFinding = {
    accountId: account.accountId,
    companyName: null,
    status: 'clean',
    periodStart: null,
    periodStarts: [],
    counts: emptyCounts(),
    usd: emptyUsd(),
    examples: { uncharged: [], undercharged: [], pendingReconciliation: [], chargedAboveUsage: [] },
    knownPaths: [],
    reasons: [],
  };

  if (usage.error || !usage.data || ledger.error || !ledger.data) {
    if (usage.error || !usage.data) base.reasons.push('usage_read_failed');
    if (ledger.error || !ledger.data) base.reasons.push('ledger_read_failed');
    return { ...base, status: 'could_not_check' };
  }

  const anchor = account.anchor;
  const classification = classifyLeakGroups({
    accountId: account.accountId,
    usageRows: usage.data.rows,
    ledgerRows: ledger.data.rows,
    window,
    periodOf: (atMs) => (anchor === undefined ? null : creditPeriodStartAt(anchor, atMs)),
  });

  if (usage.data.reachedCeiling) base.reasons.push('usage_ceiling');
  if (ledger.data.reachedCeiling) base.reasons.push('ledger_ceiling');

  const leaks = classification.counts.uncharged + classification.counts.undercharged + classification.counts.ungroupedCalls;
  // A read cut at its ceiling can manufacture a phantom leak (a missing charge)
  // or hide one: the account is "incomplete", never "clean" and never a leak.
  const status: LeakAccountStatus = base.reasons.length > 0 ? 'incomplete' : leaks > 0 ? 'leak' : 'clean';

  return {
    ...base,
    status,
    periodStart: leaks > 0 ? classification.leakPeriodStart : classification.firstPeriodStart,
    periodStarts: leaks > 0 ? classification.leakPeriodStarts : classification.firstPeriodStart ? [classification.firstPeriodStart] : [],
    counts: classification.counts,
    usd: classification.usd,
    examples: classification.examples,
    knownPaths: classification.knownPaths,
  };
}

function hasFinding(finding: LeakAccountFinding): boolean {
  const c = finding.counts;
  return (
    finding.status !== 'clean' ||
    c.knownPathCalls > 0 ||
    c.pendingReconciliation > 0 ||
    c.chargedAboveUsage > 0 ||
    c.unresolvedCorrections > 0 ||
    c.unreadableAmounts > 0
  );
}

/**
 * Run the leak check. NEVER throws: a failed read makes its account "could not
 * check", a failed listing sets `listingFailed`, and the deadline leaves
 * `accountsRemaining`.
 */
export async function runCreditLeakCheck(
  input: CreditLeakCheckInput,
  deps: CreditLeakCheckDeps,
  logger: Logger = defaultLogger
): Promise<CreditLeakCheckResult> {
  const now = deps.now();
  const requestedEndMs = input.window.end.getTime();
  const startMs = input.window.start.getTime();
  // An action may still be running near "now": its calls are written, its
  // charge is not yet. Pull the end back so it is not reported as uncharged.
  const settleEndMs = now.getTime() - LEAK_CHECK_LIMITS.SETTLE_MS;
  const endMs = Math.max(startMs, Math.min(requestedEndMs, settleEndMs));
  const window: LeakWindowMs = { startMs, endMs };
  const windowIso = { start: new Date(startMs).toISOString(), end: new Date(endMs).toISOString() };

  const { accounts, listing } = await listAccounts(input, window, deps);

  // Platform-account information (§5.1, Q-9): counts only, all-accounts mode only.
  const platform: CreditLeakCheckResult['platform'] = {
    businessOsCalls: null,
    helperLabelCalls: null,
    envIgnored: isPlatformAccountEnvIgnored(),
  };
  if (input.accountId === null && endMs > startMs) {
    const platformWindow: TokenUsageWindow = { start: new Date(startMs), end: new Date(endMs - 1) };
    const ids = platformAccountIds();
    const [bos, helper] = await Promise.all([
      settled(() => deps.countPlatformCalls(ids, platformWindow, { kind: 'row_filter', filter: bosRowFilter() })),
      settled(() =>
        deps.countPlatformCalls(ids, platformWindow, {
          kind: 'label',
          feature: BOS_LEGACY_HELPER_LABEL.feature,
          component: BOS_LEGACY_HELPER_LABEL.component,
        })
      ),
    ]);
    platform.businessOsCalls = bos.error ? null : bos.data;
    platform.helperLabelCalls = helper.error ? null : helper.data;
  } else if (input.accountId === null) {
    platform.businessOsCalls = 0;
    platform.helperLabelCalls = 0;
  }

  const findings: LeakAccountFinding[] = [];
  let accountsChecked = 0;
  let accountsRemaining = 0;
  let deadlineReached = false;
  const totals: CreditLeakCheckResult['totals'] = {
    unchargedGroups: 0,
    ungroupedCalls: 0,
    underchargedGroups: 0,
    pendingReconciliation: 0,
    knownPathCalls: 0,
    matchedGroups: 0,
    noSpendGroups: 0,
    chargedAboveUsage: 0,
    unchargedUsd: 0,
  };
  const knownPaths = new Map<string, { feature: string; component: string; calls: number; accounts: number }>();

  for (let i = 0; i < accounts.length; i += 1) {
    if (deps.now().getTime() >= input.deadlineAt) {
      accountsRemaining = accounts.length - i;
      deadlineReached = true;
      break;
    }
    const finding = await checkAccount(accounts[i], window, settleEndMs, deps);
    accountsChecked += 1;

    const c = finding.counts;
    totals.unchargedGroups += c.uncharged;
    totals.ungroupedCalls += c.ungroupedCalls;
    totals.underchargedGroups += c.undercharged;
    totals.pendingReconciliation += c.pendingReconciliation;
    totals.knownPathCalls += c.knownPathCalls;
    totals.matchedGroups += c.matched;
    totals.noSpendGroups += c.noSpend;
    totals.chargedAboveUsage += c.chargedAboveUsage;
    if (finding.status === 'leak') totals.unchargedUsd += finding.usd.totalUncharged;
    for (const path of finding.knownPaths) {
      const key = `${path.feature}|${path.component}`;
      const entry = knownPaths.get(key) ?? { feature: path.feature, component: path.component, calls: 0, accounts: 0 };
      entry.calls += path.calls;
      entry.accounts += 1;
      knownPaths.set(key, entry);
    }

    if (finding.status === 'leak') {
      // BQ-2: the log IS the alert. Ids and numbers only.
      logger.error(
        {
          event: 'bos_credit_leak_found',
          trigger: input.trigger,
          accountId: finding.accountId,
          periodStart: finding.periodStart,
          periodStarts: finding.periodStarts,
          windowStart: windowIso.start,
          windowEnd: windowIso.end,
          unchargedGroups: c.uncharged,
          ungroupedCalls: c.ungroupedCalls,
          underchargedGroups: c.undercharged,
          unchargedCostUsd: finding.usd.totalUncharged,
          groupIds: [...finding.examples.uncharged, ...finding.examples.undercharged]
            .map((e) => e.groupId)
            .slice(0, LEAK_CHECK_LIMITS.EXAMPLES_PER_CASE),
        },
        'Business OS AI spend found that was not charged'
      );
    } else if (finding.status === 'could_not_check' || finding.status === 'incomplete') {
      logger.warn(
        {
          event: 'bos_credit_leak_account_not_checked',
          trigger: input.trigger,
          accountId: finding.accountId,
          status: finding.status,
          reasons: finding.reasons,
          windowStart: windowIso.start,
          windowEnd: windowIso.end,
        },
        'Leak check could not fully check an account'
      );
    }

    if (hasFinding(finding)) findings.push(finding);
  }

  if (knownPaths.size > 0) {
    // S-3: accepted, known uncharged spend. warn once per run, never error.
    logger.warn(
      {
        event: 'bos_credit_leak_known_path',
        trigger: input.trigger,
        windowStart: windowIso.start,
        windowEnd: windowIso.end,
        knownPathCalls: totals.knownPathCalls,
        paths: [...knownPaths.values()],
      },
      'Known uncharged Business OS AI paths were used'
    );
  }

  findings.sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0)
  );

  const accountsWithLeak = findings.filter((f) => f.status === 'leak').length;
  const accountsIncomplete = findings.filter((f) => f.status === 'incomplete').length;
  const accountsNotChecked = findings.filter((f) => f.status === 'could_not_check').length;
  const listingFailed = listing.plans === 'failed' || listing.totals !== 'ok';
  totals.unchargedUsd = round10(totals.unchargedUsd);

  const result: CreditLeakCheckResult = {
    trigger: input.trigger,
    window: windowIso,
    endClamped: endMs !== requestedEndMs,
    accountId: input.accountId,
    generatedAt: now.toISOString(),
    accountsChecked,
    accountsWithLeak,
    accountsIncomplete,
    accountsNotChecked,
    accountsRemaining,
    deadlineReached,
    listingFailed,
    listing,
    totals,
    platform,
    accounts: findings,
    blindSpots: [...LEAK_BLIND_SPOTS],
  };

  logger.info(
    {
      event: 'bos_credit_leak_check_completed',
      trigger: input.trigger,
      accountId: input.accountId,
      windowStart: windowIso.start,
      windowEnd: windowIso.end,
      endClamped: result.endClamped,
      accountsChecked,
      accountsWithLeak,
      accountsIncomplete,
      accountsNotChecked,
      accountsRemaining,
      listingFailed,
      unchargedGroups: totals.unchargedGroups,
      ungroupedCalls: totals.ungroupedCalls,
      underchargedGroups: totals.underchargedGroups,
      pendingReconciliation: totals.pendingReconciliation,
      knownPathCalls: totals.knownPathCalls,
      platformBusinessOsCalls: platform.businessOsCalls,
      platformHelperLabelCalls: platform.helperLabelCalls,
    },
    'Business OS credit leak check completed'
  );

  return result;
}

/** The previous whole UTC day, `[yesterday 00:00, today 00:00)`: the nightly window. */
export function previousUtcDay(now: Date): { start: Date; end: Date } {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(end - DAY_MS), end: new Date(end) };
}

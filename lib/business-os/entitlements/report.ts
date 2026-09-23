// lib/business-os/entitlements/report.ts
//
// THE SHADOW REPORT — the evidence the first price list is built from.
//
// Workplan §4.10 (FR-22, AC-7, RC-6, RC-12, RC-16, A-1, S1-T11a, S1-T15).
//
// Four sections, each answering a question somebody is actually going to ask:
//
//   static    Who is on what, and **who is getting the product for free with no
//             end date** — the question A-1 exists to make answerable.
//   observed  What accounts actually used, per capability and surface, under
//             both readings of the chat read rule (Q-B1).
//   asTier    "If this account were on tier X, what would it lose?" — the replay
//             that turns usage into a pricing decision (AC-7).
//   setupAi   What a real setup costs in AI actions, which is the number the
//             trial allowance has to be bigger than (B-12, S1-T15).
//
// ── WHAT IT MUST NEVER CONTAIN (RC-16) ──────────────────────────────────────
// Account ids and aggregates. **No business names, no email addresses, no
// override `reason` or `ended_reason` text, no admin ids.** A report that is
// safe to paste into a ticket is a report people will actually read; reason text
// is written by admins about customers and belongs only in the per-account
// inspect response (component 5). A test asserts the shape of every row.
//
// ── WHY IT DOES NOT USE THE CACHE (S-6 / RC-13) ─────────────────────────────
// It walks every account. Populating a 5,000-entry LRU with a report's working
// set would evict everything live requests need, to serve a page nobody is
// waiting on. Every read here is a `pagePlans` walk or a `findEntitlementInputs`
// batch — both cache-neutral by construction.

import { createLogger } from '@/lib/logger';
import {
  businessOsAccountPlanRepository,
  type BusinessOsAccountPlan,
  type BusinessOsAccountPlanRepository,
} from '@/lib/repositories/BusinessOsAccountPlanRepository';
import {
  businessOsEntitlementShadowRepository,
  type BusinessOsEntitlementShadowRepository,
  type BusinessOsShadowEvent,
} from '@/lib/repositories/BusinessOsEntitlementShadowRepository';
import { tokenUsageRepository, type TokenUsageRepository } from '@/lib/repositories/TokenUsageRepository';
import { fromPlanRow } from './account';
import { deriveLifecycle } from './lifecycle';
import { resolveEntitlements, satisfies } from './resolver';
import { getEntitlementConfig, type EntitlementConfig } from './source';
import type { CatalogLike } from './schema';
import type { CapabilityValue, ChatReadRule, LifecycleState } from './types';

const logger = createLogger({ module: 'BusinessOsEntitlementsReport' });

/**
 * The qualifiers a reader would not supply for themselves (SA's caveat, QA D-1).
 *
 * In the output rather than in a doc, because the person pricing a plan reads
 * the JSON. Both of these change what a number MEANS, and neither is guessable
 * from the number.
 */
const LIMITATIONS: ReportLimitations = {
  hookedSurfaces:
    'Chat (chat-v4 planning) is the ONLY surface recorded in Slice 1. Sends, crons, public ' +
    'pages and the website are not hooked until Slice 2.',
  absentCapabilities:
    'A capability missing from `observed` means "not used THROUGH CHAT in this window" — NOT ' +
    '"not used". Pricing it as unused would be reading silence as evidence.',
  countingUnit:
    'Counts are REQUESTS, not intents: a retried or double-submitted turn counts twice, and one ' +
    'question that plans several steps counts once per step. Treat totals as an upper bound on ' +
    'intent and a fair measure of load.',
};

/** How many plan rows one page reads. */
const PAGE_SIZE = 500;

/** A ceiling on the whole walk, so a report is a bounded amount of work. */
const MAX_ACCOUNTS = 20000;

/** How many accounts the setup-AI measurement samples. */
const SETUP_AI_SAMPLE = 200;

/** The areas whose AI calls count as "setting up" (B-12). */
const SETUP_AREAS = ['business-os-onboarding', 'business-os-website', 'business-os-intake'] as const;

/** One account with access that has no end date (A-1). */
export interface NoEndDateRow {
  accountId: string;
  /** Which kind of open-ended access this is. An account can have both. */
  kind: 'cohort' | 'tier';
  /** `champion`, or the tier name. */
  name: string;
  /** When it started — the plan row's creation, which is the account's own start. */
  since: string;
  /** How it came to exist: `backfill`, a trigger, or an admin operation. */
  origin: string;
  /**
   * S1-T11a: did this account ever create a business profile?
   *
   * The backfill deliberately treated "a profile OR any onboarding message" as a
   * tenant, so accounts that opened onboarding once and never came back are
   * open-ended champions too. They are the set to trim before enforcement, and
   * flagging them here is what makes trimming a deliberate act rather than a
   * discovery.
   */
  hasBusinessProfile: boolean;
}

export interface StaticSection {
  accountsScanned: number;
  truncated: boolean;
  byState: Record<string, number>;
  byCohort: Record<string, number>;
  byTier: Record<string, number>;
  /** Every account whose access has no end date, of either kind (A-1). */
  noEndDate: NoEndDateRow[];
  /**
   * Distinct **accounts** in the list above (QA B-4).
   *
   * One account can appear twice — an open-ended cohort AND an open-ended tier
   * — so the row count is not the account count, and the account count is what
   * "how many people are getting this free?" means.
   */
  noEndDateAccountCount: number;
  /**
   * Distinct **accounts** with no end date that never created a business
   * profile (S1-T11a). The trim list, counted in the unit someone will act on.
   */
  noEndDateAccountsWithoutProfile: number;
  anomalies: Array<{ accountId: string; anomaly: string }>;
  tenantsWithoutPlanRow: { checked: number; count: number; sample: string[]; truncated: boolean; scope: string };
}

export interface ObservedRow {
  capability: string;
  surface: string;
  outcome: string;
  rule: string;
  accounts: number;
  hits: number;
  /** Sum of the fan-out CAPS observed — an upper bound, not rows processed. */
  plannedItemsTotal: number;
  /** The largest single fan-out cap seen. */
  plannedItemsMax: number;
}

export interface ObservedSection {
  from: string;
  to: string;
  rows: ObservedRow[];
  /** Rows read, so a caller can tell a complete window from a truncated one. */
  eventsRead: number;
  truncated: boolean;
}

/** What one capability would cost on the replayed tier. */
export interface AsTierLoss {
  capability: string;
  surface: string;
  /** Accounts that used it and would not have it on this tier. */
  accounts: number;
  /** Times they used it in the window. */
  hits: number;
  /** What the tier gives instead. */
  tierValue: CapabilityValue | null;
}

export interface AsTierSection {
  tier: string;
  /**
   * Which reading of the chat read rule this replay assumed (SA R4-1).
   *
   * Every look-up is recorded TWICE — once per reading of Q-B1 — so that the
   * question can be settled with data. Only one reading is ever configured, so
   * replaying both at once describes a world that cannot exist: the same
   * look-up would appear as two separate losses and an account would be counted
   * as affected if it lost under *either*. The replay therefore picks one.
   */
  reading: ChatReadRule;
  /**
   * The window this replay saw was capped (QA B-3).
   *
   * `findWindow` stops at 20,000 rows ordered by day DESCENDING, so a truncated
   * window is biased toward recent days — and the replay is the number a price
   * list gets built from. Its sibling `ObservedSection` carries the same flag;
   * carrying it here too is the difference between "Basic costs two accounts
   * nothing" and "Basic costs two accounts nothing, in the part of the window
   * we could see".
   */
  windowTruncated: boolean;
  /** Capabilities that were used and would be refused. Worst first. */
  wouldLose: AsTierLoss[];
  /** **Accounts** that would lose at least one capability they used. */
  accountsAffectedCount: number;
  /**
   * **Capability/surface pairs** the tier covers — a different unit from the
   * number above, and named so the two cannot be read as a matched pair
   * (SA R4-3). It is the control that stops "everything is a loss" reading as a
   * valid answer, not a count of happy accounts.
   */
  keptCapabilitySurfaceCount: number;
}

export interface SetupAiSection {
  /** Distinct Layer-1 action groups in the account's first N days. */
  days: number;
  sampleSize: number;
  median: number;
  p90: number;
  max: number;
  /** Accounts sampled that recorded no setup AI at all. */
  withNoSetupAi: number;
  areas: readonly string[];
  /** What the sample IS, in words, so nobody has to infer it (QA B-1). */
  sampleBasis: string;
  /** The onboarding dates the sample spans, so "recent" is a fact not a claim. */
  sampleOnboardedBetween: { earliest: string | null; latest: string | null } | null;
  /**
   * Accounts whose ledger read hit its ceiling (QA B-2).
   *
   * `TokenUsageRepository` says a caller must not report a ceiling-capped count
   * as proven, and it is right: those accounts' numbers are **lower bounds**, so
   * a non-zero figure here means the percentiles below are floors.
   */
  accountsAtReadCeiling: number;
  /** Accounts whose ledger read failed outright and were left out. */
  accountsUnread: number;
  note: string;
}

/**
 * What the report cannot tell you (QA D-1, SA's "never exercised" caveat).
 *
 * Carried **in the output**, not only in a doc: the person pricing a plan reads
 * the JSON, and the two qualifiers below are exactly the ones they would not
 * supply for themselves.
 */
export interface ReportLimitations {
  /** Which surfaces are recorded at all. */
  hookedSurfaces: string;
  /** Why absence is not evidence of non-use. */
  absentCapabilities: string;
  /** Requests, not intents. */
  countingUnit: string;
}

export interface ShadowReport {
  generatedAt: string;
  tiersConfigured: readonly string[];
  /** Read this before pricing anything from the numbers below. */
  limitations: ReportLimitations;
  static: StaticSection;
  observed?: ObservedSection;
  asTier?: AsTierSection;
  asTierError?: 'no_tiers_configured' | 'unknown_tier';
  setupAi?: SetupAiSection;
}

export interface ShadowReportOptions {
  /** Observed window. Omit both to skip the observed and replay sections. */
  from?: string;
  to?: string;
  /** Replay usage as if every account were on this tier (AC-7). */
  asTier?: string;
  /**
   * Which reading of the chat read rule the replay assumes (SA R4-1).
   *
   * Defaults to the configured one, which is the world we would actually be in.
   * Selectable because the comparison — "what would each reading cost?" — is
   * the reason both are recorded, and it must not need a config change to run.
   */
  asTierReadRule?: ChatReadRule;
  /** Include the setup-AI measurement (S1-T15). Off by default: it is the slow one. */
  includeSetupAi?: boolean;
  /** Injected in tests. */
  config?: EntitlementConfig;
  planRepository?: Pick<BusinessOsAccountPlanRepository, 'pagePlans' | 'findTenantsMissingPlanRow' | 'findRecentOnboardedPlans'>;
  shadowRepository?: Pick<BusinessOsEntitlementShadowRepository, 'findWindow'>;
  usageRepository?: Pick<TokenUsageRepository, 'listCallsInWindow'>;
  now?: () => Date;
}

/**
 * Build the report.
 *
 * Never throws for a data problem: a section that cannot be read is omitted and
 * logged, because a report that fails as a whole because one query timed out is
 * a report nobody gets.
 */
export async function buildShadowReport(options: ShadowReportOptions = {}): Promise<ShadowReport> {
  const config = options.config ?? getEntitlementConfig();
  const planRepository = options.planRepository ?? businessOsAccountPlanRepository;
  const shadowRepository = options.shadowRepository ?? businessOsEntitlementShadowRepository;
  const now = options.now ?? (() => new Date());

  const report: ShadowReport = {
    generatedAt: now().toISOString(),
    tiersConfigured: config.tierOrder,
    limitations: LIMITATIONS,
    static: await buildStatic(config, planRepository, now()),
  };

  if (options.from && options.to) {
    const events = await readEvents(shadowRepository, options.from, options.to);
    report.observed = summariseObserved(events, options.from, options.to);

    if (options.asTier) {
      if (config.tierOrder.length === 0) {
        report.asTierError = 'no_tiers_configured';
      } else if (!config.tierOrder.includes(options.asTier)) {
        report.asTierError = 'unknown_tier';
      } else {
        report.asTier = replayAsTier(
          config,
          options.asTier,
          events,
          options.asTierReadRule ?? config.chatActionMap.readRule
        );
      }
    }
  }

  if (options.includeSetupAi) {
    const setupAi = await measureSetupAi(config, planRepository, options.usageRepository ?? tokenUsageRepository, now());
    if (setupAi) report.setupAi = setupAi;
  }

  return report;
}

// ── 1. Static ───────────────────────────────────────────────────────────────

async function buildStatic(
  config: EntitlementConfig,
  repository: Pick<BusinessOsAccountPlanRepository, 'pagePlans' | 'findTenantsMissingPlanRow'>,
  now: Date
): Promise<StaticSection> {
  const byState: Record<string, number> = {};
  const byCohort: Record<string, number> = {};
  const byTier: Record<string, number> = {};
  const noEndDate: NoEndDateRow[] = [];
  const anomalies: Array<{ accountId: string; anomaly: string }> = [];

  let scanned = 0;
  let truncated = false;
  let after: string | null = null;

  // Keyset paging (RC-12): an offset walk silently skips or repeats rows when
  // something is inserted mid-walk, and this walk is the basis of a count.
  for (;;) {
    const page = await repository.pagePlans({ afterUserId: after, limit: PAGE_SIZE });

    if (page.error || !page.data) {
      logger.error({ err: page.error, after }, 'Report: plan page failed; static section is partial');
      truncated = true;
      break;
    }

    if (page.data.length === 0) break;

    for (const row of page.data) {
      scanned += 1;
      tally(byState, stateFor(config, row, now));
      if (row.cohort) tally(byCohort, row.cohort);
      if (row.tier) tally(byTier, row.tier);

      const lifecycle = deriveLifecycle(fromPlanRow(row), lifecycleInputs(config), now);
      if (lifecycle.anomaly) anomalies.push({ accountId: row.user_id, anomaly: lifecycle.anomaly });

      // A-1: BOTH kinds of open-ended access, in one list, each saying which it
      // is. This is the answer to "who is not paying and has nothing stopping
      // them", and it is the reason tier_expires_at exists at all.
      if (row.cohort && row.cohort_expires_at === null) {
        noEndDate.push(noEndDateRow(row, 'cohort', row.cohort));
      }
      if (row.tier && row.tier_expires_at === null) {
        noEndDate.push(noEndDateRow(row, 'tier', row.tier));
      }
    }

    after = page.data[page.data.length - 1].user_id;

    if (page.data.length < PAGE_SIZE) break;
    if (scanned >= MAX_ACCOUNTS) {
      truncated = true;
      break;
    }
  }

  const missing = await repository.findTenantsMissingPlanRow({ maxAccounts: 2000 });

  return {
    accountsScanned: scanned,
    truncated,
    byState,
    byCohort,
    byTier,
    noEndDate,
    noEndDateAccountCount: new Set(noEndDate.map((row) => row.accountId)).size,
    noEndDateAccountsWithoutProfile: new Set(
      noEndDate.filter((row) => !row.hasBusinessProfile).map((row) => row.accountId)
    ).size,
    anomalies,
    tenantsWithoutPlanRow: missing.data
      ? {
          checked: missing.data.checked,
          count: missing.data.missing.length,
          // A sample, not the list: the count is the signal, and 2,000 ids in a
          // report is not a report.
          sample: missing.data.missing.slice(0, 20),
          truncated: missing.data.truncated,
          scope: 'accounts with a business profile (see findTenantsMissingPlanRow)',
        }
      : { checked: 0, count: 0, sample: [], truncated: true, scope: 'unavailable — the read failed' },
  };
}

function noEndDateRow(row: BusinessOsAccountPlan, kind: 'cohort' | 'tier', name: string): NoEndDateRow {
  return {
    accountId: row.user_id,
    kind,
    name,
    since: row.created_at,
    origin: row.origin,
    // S1-T11a. The plan row records the fact, so this needs no extra read.
    hasBusinessProfile: row.profile_created_at !== null,
  };
}

function stateFor(config: EntitlementConfig, row: BusinessOsAccountPlan, now: Date): LifecycleState {
  return deriveLifecycle(fromPlanRow(row), lifecycleInputs(config), now).state;
}

function lifecycleInputs(config: EntitlementConfig) {
  return {
    cohorts: config.cohorts,
    tierOrder: config.tierOrder,
    subscriptionGraceHistory: config.lifecycle.subscriptionGraceHistory,
  };
}

function tally(counter: Record<string, number>, key: string): void {
  counter[key] = (counter[key] ?? 0) + 1;
}

// ── 2. Observed ─────────────────────────────────────────────────────────────

async function readEvents(
  repository: Pick<BusinessOsEntitlementShadowRepository, 'findWindow'>,
  from: string,
  to: string
): Promise<{ rows: BusinessOsShadowEvent[]; truncated: boolean }> {
  const limit = 20000;
  const result = await repository.findWindow({ from, to, limit });

  if (result.error || !result.data) {
    logger.error({ err: result.error, from, to }, 'Report: shadow events unreadable');
    return { rows: [], truncated: true };
  }

  return { rows: result.data, truncated: result.data.length >= limit };
}

function summariseObserved(
  events: { rows: BusinessOsShadowEvent[]; truncated: boolean },
  from: string,
  to: string
): ObservedSection {
  const grouped = new Map<string, ObservedRow & { accountIds: Set<string> }>();

  for (const event of events.rows) {
    const key = `${event.capability}|${event.surface}|${event.outcome}|${event.rule}`;
    let row = grouped.get(key);

    if (!row) {
      row = {
        capability: event.capability,
        surface: event.surface,
        outcome: event.outcome,
        rule: event.rule,
        accounts: 0,
        hits: 0,
        plannedItemsTotal: 0,
        plannedItemsMax: 0,
        accountIds: new Set<string>(),
      };
      grouped.set(key, row);
    }

    row.accountIds.add(event.user_id);
    row.hits += event.hits;
    row.plannedItemsTotal += event.items_total;
    row.plannedItemsMax = Math.max(row.plannedItemsMax, event.items_max);
  }

  const rows = [...grouped.values()]
    .map(({ accountIds, ...row }) => ({ ...row, accounts: accountIds.size }))
    .sort((a, b) => b.hits - a.hits);

  return { from, to, rows, eventsRead: events.rows.length, truncated: events.truncated };
}

// ── 3. asTier replay (AC-7) ─────────────────────────────────────────────────

/**
 * "If every account had been on tier X, what would they have lost?"
 *
 * The replay is over RECORDED USAGE, not over a hypothetical: each observation
 * says an account really did ask for that capability on that surface. So the
 * answer is not "tier X excludes chat.search" — which anyone can read off the
 * matrix — but "**37 accounts used chat.search 412 times last month and tier X
 * does not include it**", which is what makes a price a decision instead of a
 * guess.
 *
 * Only `allowed` observations are replayed. An observation that was already
 * refused (an anomaly, a `not_built` capability) says nothing about the tier.
 */
function replayAsTier(
  config: EntitlementConfig,
  tier: string,
  events: { rows: BusinessOsShadowEvent[]; truncated: boolean },
  reading: ChatReadRule
): AsTierSection {
  const row = (config.matrix.tiers as Record<string, Record<string, CapabilityValue>>)[tier] ?? {};
  const catalog = config.catalog as CatalogLike;

  const losses = new Map<string, AsTierLoss & { accountIds: Set<string> }>();
  const affected = new Set<string>();
  const kept = new Set<string>();

  for (const event of events.rows) {
    if (event.outcome !== 'allowed') continue;

    // SA R4-1. `both` means the mapping is the same under either reading; the
    // other two are the SAME look-up recorded twice, and replaying both would
    // count one action as two losses and one account as affected under a
    // reading that is not configured.
    if (event.rule !== 'both' && event.rule !== reading) continue;

    const definition = catalog[event.capability];
    if (!definition) continue;

    const tierValue = row[event.capability];
    const covered = tierValue !== undefined && definition.lifecycle !== 'not_built' && satisfies(definition, tierValue);

    if (covered) {
      kept.add(`${event.capability}|${event.surface}`);
      continue;
    }

    const key = `${event.capability}|${event.surface}`;
    let loss = losses.get(key);

    if (!loss) {
      loss = {
        capability: event.capability,
        surface: event.surface,
        accounts: 0,
        hits: 0,
        tierValue: tierValue ?? null,
        accountIds: new Set<string>(),
      };
      losses.set(key, loss);
    }

    loss.accountIds.add(event.user_id);
    loss.hits += event.hits;
    affected.add(event.user_id);
  }

  const wouldLose = [...losses.values()]
    .map(({ accountIds, ...loss }) => ({ ...loss, accounts: accountIds.size }))
    // Accounts first, then volume: a capability three accounts cannot live
    // without matters more than one that one account used a thousand times.
    .sort((a, b) => b.accounts - a.accounts || b.hits - a.hits);

  return {
    tier,
    reading,
    windowTruncated: events.truncated,
    wouldLose,
    accountsAffectedCount: affected.size,
    keptCapabilitySurfaceCount: kept.size,
  };
}

// ── 4. Setup AI cost (S1-T15 / B-12) ────────────────────────────────────────

/**
 * What does setting up actually cost in AI actions?
 *
 * The trial allowance is a one-off TOTAL, and setup AI counts against it
 * (B-12). Too small a number ends a customer's trial on their first day, so it
 * has to be bigger than a real setup with headroom — and nobody has measured a
 * real setup. This measures it: distinct Layer-1 **action groups** (one group =
 * one user-visible AI action) in the onboarding, website and intake areas,
 * within each account's first `days` days.
 *
 * Sampled, not exhaustive: this is a per-account ledger read, and a number from
 * 200 accounts is enough to size an allowance. The sample is the most recent
 * accounts, because they used the current product.
 */
async function measureSetupAi(
  config: EntitlementConfig,
  planRepository: Pick<BusinessOsAccountPlanRepository, 'findRecentOnboardedPlans'>,
  usageRepository: Pick<TokenUsageRepository, 'listCallsInWindow'>,
  now: Date
): Promise<SetupAiSection | null> {
  const days = config.cohorts.trial.durationHistory?.[0]?.days ?? 14;

  // QA B-1. This used to be `pagePlans({ limit: 500 })` — ordered by **uuid** —
  // then `.slice(-200)`, which was neither recent nor random, and on a database
  // with more than 500 plan rows most accounts could never be sampled at all.
  // Now the repository does the ordering, by the account's own start date.
  const page = await planRepository.findRecentOnboardedPlans({ limit: SETUP_AI_SAMPLE });
  if (page.error || !page.data) {
    logger.error({ err: page.error }, 'Report: setup-AI sample could not be read');
    return null;
  }

  const sample = page.data;
  if (sample.length === 0) return null;

  const counts: number[] = [];
  let accountsAtReadCeiling = 0;
  let accountsUnread = 0;

  for (const row of sample) {
    const start = new Date(row.onboarding_started_at as string);
    const end = new Date(Math.min(start.getTime() + days * 86400000, now.getTime()));

    const calls = await usageRepository.listCallsInWindow(
      row.user_id,
      { start, end },
      // QA B-2. The filter is pushed DOWN to the query. It used to read every
      // Business OS call newest-first under a 1,000-row ceiling and filter the
      // three setup areas in JS — so a chat-heavy account's setup calls, which
      // sit at the START of the window, fell off the end and the account
      // reported 0. That biases the trial allowance DOWNWARDS, which is the one
      // direction B-12 exists to prevent: too small a number ends a customer's
      // trial on their first day.
      //
      // `featurePrefix` matches `business-os-onboarding` exactly (and nothing
      // else begins with it); the other two are named in `features`. The JS
      // check below stays as a belt-and-braces exact match.
      { featurePrefix: SETUP_AREAS[0], features: [SETUP_AREAS[1], SETUP_AREAS[2]] },
      { pageSize: 200, ceiling: 1000 }
    );

    if (calls.error || !calls.data) {
      logger.warn({ err: calls.error, accountId: row.user_id }, 'Report: setup-AI read failed for one account');
      accountsUnread += 1;
      continue;
    }

    // The repository's own doc says a caller must not report a ceiling-capped
    // count as proven. So it is counted and surfaced rather than ignored.
    if (calls.data.reachedCeiling) accountsAtReadCeiling += 1;

    // Distinct GROUPS, not calls: one user-visible action can be several model
    // calls, and the allowance is denominated in actions (D-12).
    const groups = new Set<string>();
    for (const call of calls.data.rows) {
      if (!call.feature || !(SETUP_AREAS as readonly string[]).includes(call.feature)) continue;
      groups.add(call.session_id ?? `ungrouped:${call.id}`);
    }

    counts.push(groups.size);
  }

  if (counts.length === 0) return null;

  const sorted = [...counts].sort((a, b) => a - b);
  const onboardingDates = sample
    .map((row) => row.onboarding_started_at as string)
    .sort();

  return {
    days,
    sampleSize: sorted.length,
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    max: sorted[sorted.length - 1],
    withNoSetupAi: sorted.filter((n) => n === 0).length,
    areas: SETUP_AREAS,
    sampleBasis:
      `the ${sorted.length} most recently onboarded accounts (by onboarding_started_at), ` +
      `out of at most ${SETUP_AI_SAMPLE} requested`,
    sampleOnboardedBetween: { earliest: onboardingDates[0] ?? null, latest: onboardingDates[onboardingDates.length - 1] ?? null },
    accountsAtReadCeiling,
    accountsUnread,
    note:
      'Distinct Layer-1 action groups in the setup areas, within each account\'s first ' +
      days +
      ' days. The trial total (cohorts.ts, PLACEHOLDER) must exceed p90 with headroom — B-12.' +
      (accountsAtReadCeiling > 0
        ? ` ⚠️ ${accountsAtReadCeiling} account(s) hit the ledger read ceiling, so their counts — and therefore these percentiles — are LOWER BOUNDS.`
        : '') +
      (accountsUnread > 0 ? ` ${accountsUnread} account(s) could not be read and are excluded.` : ''),
  };
}

/** Nearest-rank percentile over a sorted array. */
function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.max(1, Math.ceil(fraction * sorted.length));
  return sorted[rank - 1];
}

/**
 * Every capability an account currently holds — for the per-account inspect
 * view component 5 will add. Exported here because it is the same resolution
 * the report does, and duplicating it there is how the two would drift.
 */
export function resolveForReport(config: EntitlementConfig, row: BusinessOsAccountPlan, now: Date) {
  return resolveEntitlements({ config, account: fromPlanRow(row), overrides: [], addons: [], now });
}

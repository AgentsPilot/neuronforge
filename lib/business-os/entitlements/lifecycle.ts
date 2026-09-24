// lib/business-os/entitlements/lifecycle.ts
//
// WHAT STATE IS THIS ACCOUNT IN, AND WHAT DOES IT RESOLVE FROM?
//
// Workplan §4.8 (FR-9, RC-4, RC-11, S-7, A-1). Pure: `now` is a parameter, and
// nothing here reads a clock, the environment or the database.
//
// ── THE TWO QUESTIONS ARE ONE FUNCTION ON PURPOSE ───────────────────────────
// "Which state is the account in?" and "which config row does it resolve from?"
// have the same answer and must never disagree. Computing them separately is how
// you get an account whose banner says `trial` while its capabilities come from
// a tier that lapsed a month ago. So `deriveLifecycle` returns both, together
// with the dates it used, and the resolver takes the basis from here rather than
// re-deciding it.
//
// ── PRECEDENCE (RC-11 + A-1) ────────────────────────────────────────────────
// A tier in force beats everything: a champion who starts paying resolves from
// the tier they bought, and their cohort is ignored until the tier lapses.
// **When it lapses, the cohort comes back** — it was never deleted. That is the
// whole of A-1: a champion who paid for three months and stopped is a champion
// again, not an account that falls off a cliff.
//
// ── WHY DURATIONS ARE HISTORIES (S-7) ───────────────────────────────────────
// `historyAt` picks the entry in force at a moment. A trial uses the entry in
// force when it STARTED, so shortening the trial in config changes the deal for
// new signups and cannot shorten a trial somebody is three days into. Editing
// the number instead of appending an entry is what the snapshot test blocks.

import type { CohortConfig } from './config/cohorts';
import type { EntitlementAccount } from './account';
import type { HistoryEntry, LifecycleState, TrialClockStart } from './types';

/** What went wrong, when the account's own record does not add up. */
export type EntitlementAnomaly =
  /** No plan row at all. Never read as "full access" (S-8). */
  | 'no_plan_row'
  /** Neither a tier nor a cohort. R2-3 makes this unreachable through admin ops. */
  | 'no_assignment'
  /** A tier name the configured matrix does not have. */
  | 'unknown_tier'
  /** A cohort name the config does not have. */
  | 'unknown_cohort'
  /** A trial whose clock never started: the fact the cohort measures from is missing. */
  | 'trial_without_start';

/** Where the capability values come from. */
export type EntitlementBasis =
  | { kind: 'tier'; tier: string }
  | { kind: 'cohort'; cohort: string }
  /** Anomalies only. Nothing is granted. */
  | { kind: 'none' };

export interface LifecycleResult {
  state: LifecycleState;
  basis: EntitlementBasis;
  /** When entitled access ended (or would end). `null` while it has no end. */
  accessEndsAt: string | null;
  /** When grace ends. `null` when access has not ended. */
  graceEndsAt: string | null;
  /** A short token naming the branch taken, for the trace and for shadow events. */
  reason: string;
  anomaly?: EntitlementAnomaly;
  /** Trial only: the dates actually used, after pins and histories. */
  trial?: { startedAt: string | null; endsAt: string | null };
}

/** Everything `deriveLifecycle` needs from config, so tests can vary one piece. */
export interface LifecycleInputs {
  cohorts: Readonly<Record<string, CohortConfig>>;
  tierOrder: readonly string[];
  subscriptionGraceHistory: readonly HistoryEntry[];
}

/**
 * The history entry in force at `at`.
 *
 * "In force" means the latest entry whose `effectiveFrom` is at or before the
 * moment. If the moment predates every entry — a trial that started before this
 * module shipped — the EARLIEST entry is used: the alternative is no answer at
 * all, and the earliest entry is the closest thing to what was promised.
 */
export function historyAt(history: readonly HistoryEntry[], at: Date): HistoryEntry | null {
  if (history.length === 0) return null;

  let chosen: HistoryEntry | null = null;
  let earliest: HistoryEntry = history[0];

  for (const entry of history) {
    const from = new Date(entry.effectiveFrom).getTime();
    if (from < new Date(earliest.effectiveFrom).getTime()) earliest = entry;
    if (from <= at.getTime()) {
      if (!chosen || from > new Date(chosen.effectiveFrom).getTime()) chosen = entry;
    }
  }

  return chosen ?? earliest;
}

/** `days` after `from`, as an ISO string. */
function addDays(from: string, days: number): string {
  return new Date(new Date(from).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isBefore(now: Date, iso: string): boolean {
  return now.getTime() < new Date(iso).getTime();
}

/** The later of two dates, either of which may be absent. */
function later(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

/** The lifecycle state a cohort id names, when it names one. */
function stateForCohort(cohortId: string): LifecycleState {
  return cohortId === 'trial' || cohortId === 'champion' ? cohortId : 'active';
}

/** The recorded fact a trial clock is measured from (Q-B3). */
function factFor(account: EntitlementAccount, start: TrialClockStart | undefined): string | null {
  if (start === 'profile_created') return account.profileCreatedAt;
  return account.onboardingStartedAt;
}

/**
 * The state, the basis, and the dates behind both.
 *
 * Reading order matches the workplan's pseudo-code deliberately, so the two can
 * be diffed by eye.
 */
export function deriveLifecycle(
  account: EntitlementAccount | null,
  inputs: LifecycleInputs,
  now: Date
): LifecycleResult {
  if (!account) {
    return {
      state: 'unknown',
      basis: { kind: 'none' },
      accessEndsAt: null,
      graceEndsAt: null,
      reason: 'no_plan_row',
      anomaly: 'no_plan_row',
    };
  }

  const hasTier = account.tier !== null && account.tier !== '';
  const hasCohort = account.cohort !== null && account.cohort !== '';

  if (!hasTier && !hasCohort) {
    return {
      state: 'unknown',
      basis: { kind: 'none' },
      accessEndsAt: null,
      graceEndsAt: null,
      reason: 'no_assignment',
      anomaly: 'no_assignment',
    };
  }

  if (hasTier && !inputs.tierOrder.includes(account.tier as string)) {
    // A tier the config has never heard of. Denying is the only safe reading:
    // the alternative is inventing what the customer bought.
    return {
      state: 'unknown',
      basis: { kind: 'none' },
      accessEndsAt: null,
      graceEndsAt: null,
      reason: 'unknown_tier',
      anomaly: 'unknown_tier',
    };
  }

  if (hasCohort && !inputs.cohorts[account.cohort as string]) {
    return {
      state: 'unknown',
      basis: { kind: 'none' },
      accessEndsAt: null,
      graceEndsAt: null,
      reason: 'unknown_cohort',
      anomaly: 'unknown_cohort',
    };
  }

  // ── A tier in force wins outright (RC-11) ─────────────────────────────────
  if (hasTier && (account.tierExpiresAt === null || isBefore(now, account.tierExpiresAt))) {
    return {
      state: 'active',
      basis: { kind: 'tier', tier: account.tier as string },
      accessEndsAt: account.tierExpiresAt,
      graceEndsAt: null,
      // `past_due` is Slice 4: it needs a billing event nothing emits yet.
      reason: account.tierExpiresAt === null ? 'tier_in_force_no_end_date' : 'tier_in_force',
    };
  }

  // ── A-1: the tier has expired. What does the account fall back to? ────────
  if (hasTier) {
    const cohortState = hasCohort ? cohortStatus(account, inputs, now) : null;

    if (cohortState && cohortState.live) {
      // The cohort was never deleted, so it simply resumes. No grandfathering:
      // layer 1a is a tier-account rule, and this account no longer has a tier
      // in force.
      return { ...cohortState.result, reason: `tier_expired_${cohortState.result.reason}` };
    }

    // Both ended, or there is no cohort. Three separate decisions, and they do
    // not come from the same place (§4.8's A-1 table states all three after QA
    // C-2 found only two of them written down):
    //
    //   basis        the TIER row — see the comment below
    //   access end   the LATER of the two end dates, so an account upgraded
    //                mid-trial is not pushed into grace by a trial end date that
    //                passed while they were paying
    //   grace length the COHORT's, when there is one. An account that was also a
    //                lapsed champion keeps the champion's 30 days instead of the
    //                shorter subscription grace. Deliberate: it only applies to
    //                someone who was both, and the alternative would mean that
    //                having been a champion made their lapse worse.
    const cohortEnd = cohortState?.accessEndsAt ?? null;
    const accessEndsAt = (later(account.tierExpiresAt, cohortEnd) ?? account.tierExpiresAt) as string;
    const graceHistory = cohortState
      ? inputs.cohorts[account.cohort as string].graceHistory
      : inputs.subscriptionGraceHistory;

    return settle({
      account,
      // The basis stays the TIER, even when a cohort is recorded. The account's
      // last live entitlement is what it paid for, and grace means "look at what
      // you had", not "have everything". Falling back to the cohort here would
      // hand a lapsed Basic subscriber the champion/trial `{ all: true }` base —
      // more capability in grace than they ever had while paying.
      basis: { kind: 'tier', tier: account.tier as string },
      accessEndsAt,
      graceHistory,
      reason: cohortState ? 'tier_and_cohort_ended' : 'tier_expired_no_cohort',
      now,
    });
  }

  // ── Tierless: the cohort is the basis ─────────────────────────────────────
  const cohortState = cohortStatus(account, inputs, now);
  if (cohortState.live) return cohortState.result;

  if (cohortState.result.anomaly) return cohortState.result;

  return settle({
    account,
    basis: { kind: 'cohort', cohort: account.cohort as string },
    accessEndsAt: cohortState.accessEndsAt as string,
    graceHistory: inputs.cohorts[account.cohort as string].graceHistory,
    reason: cohortState.result.reason,
    now,
    trial: cohortState.result.trial,
  });
}

/**
 * Is the cohort still live, and if not, when did it end?
 *
 * Split out because A-1 needs the same answer from two places: once when the
 * account is tierless, and once when a tier has expired and the cohort is what
 * is left.
 */
function cohortStatus(
  account: EntitlementAccount,
  inputs: LifecycleInputs,
  now: Date
): { live: boolean; accessEndsAt: string | null; result: LifecycleResult } {
  const cohortId = account.cohort as string;
  const cohort = inputs.cohorts[cohortId];
  const basis: EntitlementBasis = { kind: 'cohort', cohort: cohortId };

  // A cohort with no duration — a champion — ends only when an admin says so.
  if (!cohort.durationHistory) {
    const live = account.cohortExpiresAt === null || isBefore(now, account.cohortExpiresAt);
    return {
      live,
      accessEndsAt: account.cohortExpiresAt,
      result: {
        // The state is named after the cohort: `champion` is a state in §9, not
        // a label on top of one. A cohort that is NOT also a state resolves to
        // `active` — the states are a fixed list (§9) and inventing one would
        // break every overlay lookup downstream.
        state: live ? stateForCohort(cohortId) : 'grace',
        basis,
        accessEndsAt: account.cohortExpiresAt,
        graceEndsAt: null,
        // RC-4: no end date is the normal case for a champion, not an anomaly.
        reason: account.cohortExpiresAt === null ? `${cohortId}_open_ended` : `${cohortId}_dated`,
      },
    };
  }

  // A trial. The clock starts at the pinned date, or at the recorded fact the
  // cohort measures from (Q-B3).
  const startedAt = account.trialStartedAt ?? factFor(account, cohort.clockStartsAt);

  if (!startedAt) {
    // The fact the clock is measured from has not happened yet — e.g. a cohort
    // that starts at `profile_created` for an account that has only sent
    // onboarding messages. Setup is still in progress: the account is in its
    // trial, with no end date yet. `ensurePlanRow` is what fixes the genuinely
    // broken version of this.
    return {
      live: true,
      accessEndsAt: null,
      result: {
        state: 'trial',
        basis,
        accessEndsAt: null,
        graceEndsAt: null,
        reason: 'trial_not_started',
        trial: { startedAt: null, endsAt: null },
      },
    };
  }

  const duration = historyAt(cohort.durationHistory, new Date(startedAt));
  const endsAt = account.trialEndsAt ?? (duration ? addDays(startedAt, duration.days) : null);

  if (!endsAt) {
    // A trial cohort with an empty duration history. The config schema forbids
    // it; this branch exists so that a config that slipped through denies rather
    // than granting an endless trial.
    return {
      live: false,
      accessEndsAt: null,
      result: {
        state: 'unknown',
        basis: { kind: 'none' },
        accessEndsAt: null,
        graceEndsAt: null,
        reason: 'trial_without_start',
        anomaly: 'trial_without_start',
      },
    };
  }

  const live = isBefore(now, endsAt);
  return {
    live,
    accessEndsAt: endsAt,
    result: {
      state: live ? 'trial' : 'grace',
      basis,
      accessEndsAt: endsAt,
      graceEndsAt: null,
      reason: live ? 'trial_live' : 'trial_ended',
      trial: { startedAt, endsAt },
    },
  };
}

/** Grace, then paused — the tail every ended state shares. */
function settle(args: {
  account: EntitlementAccount;
  basis: EntitlementBasis;
  accessEndsAt: string;
  graceHistory: readonly HistoryEntry[];
  reason: string;
  now: Date;
  trial?: { startedAt: string | null; endsAt: string | null };
}): LifecycleResult {
  const { account, basis, accessEndsAt, graceHistory, reason, now, trial } = args;

  const grace = historyAt(graceHistory, new Date(accessEndsAt));
  // An admin's pin wins over the derived date; a missing history means no grace
  // rather than infinite grace.
  const graceEndsAt = account.graceEndsAt ?? (grace ? addDays(accessEndsAt, grace.days) : accessEndsAt);

  return {
    state: isBefore(now, graceEndsAt) ? 'grace' : 'paused',
    basis,
    accessEndsAt,
    graceEndsAt,
    reason,
    trial,
  };
}

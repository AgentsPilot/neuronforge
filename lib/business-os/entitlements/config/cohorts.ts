// lib/business-os/entitlements/config/cohorts.ts
//
// THE COHORTS — trial and champion.
//
// A cohort is not a tier. It is a per-account label that says what someone gets
// while they are not paying: a new signup finding out whether the product is for
// them, or a design partner who was here before there was anything to pay for.
//
// Requirement §6.4 / D-2 / D-4 / B-14, workplan §4.6.
//
// ── WHY BOTH GRANT EVERYTHING TODAY ─────────────────────────────────────────
// `base: { all: true }` — every capability at its highest value.
//
// For champions that is the user's decision (B-14): design partners get the
// whole product. For trials it is the consequence of shipping no tiers (B-13):
// a trial is defined as "what you would get on plan X", and there is no plan X
// yet. Pointing the trial at a real tier later is a ONE-LINE change here:
//
//     base: { tier: 'growth' },
//
// ── WHY THE DURATIONS ARE HISTORIES, NOT NUMBERS ────────────────────────────
// A trial uses the entry in force when it STARTED (SA S-7). Shortening the trial
// from 14 days to 7 must not retroactively end the trials of people who are
// three days in — they were promised 14. Appending a new entry changes the deal
// for new signups only, which is what AC-14 asks for.

import type { CohortConfigShape, HistoryEntry } from '../types';
import type { CohortExplicitValues } from './catalog';

export interface CohortConfig extends CohortConfigShape<CohortExplicitValues> {}

/**
 * Quantities, allowances and ceilings for an account that gets "everything".
 *
 * These cannot be derived: "the highest boolean" is `true` and "the highest
 * variant" is the last one, but there is no highest number. Every quantity,
 * metered and fair-use capability must appear here, and the type makes that a
 * compile error rather than a discovery — so adding a new metered capability to
 * the catalog fails the build until someone decides what champions get.
 *
 * All numbers are placeholders until the trial allowance is sized from real
 * setup-cost data (B-12, task S1-T15).
 */
const CHAMPION_VALUES: CohortExplicitValues = {
  // Champions who run out ask an admin for more; they never buy boosts (D-7).
  'ai.actions': { perMonth: 3000 },
  'sms.messages': { perMonth: 0 },
  'email.volume': { ceilingPerMonth: 10000 },
  'team.seats': { included: 1, purchasable: false },
  'business.locations': { included: 1, purchasable: false },
};

const TRIAL_VALUES: CohortExplicitValues = {
  // A one-off TOTAL, not a monthly rate: using it up ends the trial (D-2,
  // FR-27). It must cover a full setup with headroom, because setup AI counts
  // against it (B-12) — the number comes from the S1-T15 measurement.
  'ai.actions': { total: 150 },
  'sms.messages': { perMonth: 0 },
  'email.volume': { ceilingPerMonth: 2000 },
  'team.seats': { included: 1, purchasable: false },
  'business.locations': { included: 1, purchasable: false },
};

/** The first entry of every history: the day this module shipped. */
const SHIPPED = '2026-09-22T00:00:00.000Z';

const fourteenDays: readonly HistoryEntry[] = [{ effectiveFrom: SHIPPED, days: 14 }];
const sevenDays: readonly HistoryEntry[] = [{ effectiveFrom: SHIPPED, days: 7 }];
const thirtyDays: readonly HistoryEntry[] = [{ effectiveFrom: SHIPPED, days: 30 }];

export const COHORTS = {
  trial: {
    // P-1 (pending the user's confirmation): everything, like a champion.
    base: { all: true },
    // Beta capabilities are included, on the same reading of "everything".
    // Setting this to [] keeps beta for champions only — one value, no code.
    includeLifecycle: ['beta'],
    values: TRIAL_VALUES,
    durationHistory: fourteenDays,
    graceHistory: sevenDays,
    // Q-B3: the clock starts when someone starts SETTING UP, not when setup
    // finishes — which is what makes setup AI fall inside the trial (B-12).
    // The alternative is 'profile_created'.
    clockStartsAt: 'first_onboarding_message',
  },
  champion: {
    // B-14: design partners get every capability at its highest level.
    base: { all: true },
    includeLifecycle: ['beta'],
    values: CHAMPION_VALUES,
    // D-4: a longer runway than a trial, because a champion who lapses is a
    // relationship, not a funnel step.
    graceHistory: thirtyDays,
    // No durationHistory: a champion's end date is set per account by an admin,
    // and NULL means open-ended (UD-4). There is deliberately no default length
    // — one would expire every migrated account on the same day.
  },
} as const satisfies Record<'trial' | 'champion', CohortConfig>;

export type CohortId = keyof typeof COHORTS;

export const COHORT_IDS = Object.keys(COHORTS) as CohortId[];

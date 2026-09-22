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
 * ⚠️ **EVERY NUMBER BELOW IS A PLACEHOLDER THAT NOBODY HAS CHOSEN.**
 *
 * The 14 / 7 / 30-day durations further down ARE the user's decisions (D-2,
 * D-4). The allowances and ceilings are not: they were invented to make the
 * config valid, and they are marked here so they cannot quietly become policy
 * by sitting in a file long enough.
 *
 * They are harmless today — nothing meters anything until Slice 3, and no
 * account is blocked by a number that nothing counts. **Slice 3 sets them from
 * evidence**: the shadow report's setup-AI measurement (task S1-T15) gives the
 * trial total the size a real setup needs with headroom (B-12), and observed
 * usage gives the champion rate. Until then, treat every `PLACEHOLDER` below as
 * "we have not decided", not as "the current policy".
 */
const CHAMPION_VALUES: CohortExplicitValues = {
  // PLACEHOLDER (not chosen by anyone). Champions who run out ask an admin for
  // more; they never buy boosts (D-7), so this number's only job today is to be
  // large enough not to matter.
  'ai.actions': { perMonth: 3000 },
  // Zero because SMS is `not_built`. This one is NOT a placeholder: a feature
  // that does not exist cannot be allocated, and the loader enforces it.
  'sms.messages': { perMonth: 0 },
  // PLACEHOLDER. A fair-use ceiling only ever alerts the platform team (B-7), so
  // the number is an abuse threshold, not a product promise — but it is still a
  // number nobody has chosen.
  'email.volume': { ceilingPerMonth: 10000 },
  // NOT a placeholder: one owner seat and one location is what exists. Invites
  // and multi-location are unbuilt (§18), so these cannot be raised yet.
  'team.seats': { included: 1, purchasable: false },
  'business.locations': { included: 1, purchasable: false },
};

const TRIAL_VALUES: CohortExplicitValues = {
  // PLACEHOLDER — and the one that matters most. A one-off TOTAL, not a monthly
  // rate: using it up ENDS THE TRIAL (D-2, FR-27). Setup AI counts against it
  // (B-12), so too small a number ends a customer's trial on their first day.
  // Slice 3 sets it from the S1-T15 measurement of what a real setup costs.
  'ai.actions': { total: 150 },
  'sms.messages': { perMonth: 0 }, // not_built, as above
  'email.volume': { ceilingPerMonth: 2000 }, // PLACEHOLDER
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

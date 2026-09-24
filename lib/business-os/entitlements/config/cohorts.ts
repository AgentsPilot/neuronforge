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
// ── BOTH POINT AT A TIER (user decision, 2026-09-23) ────────────────────────
// `base: { tier: 'basic' }` — both cohorts resolve from the Essentials row.
//
// They used to be `{ all: true }`, because there were no tiers to point at. Now
// there are, and pointing at one is strictly better: a cohort that enumerated
// its own capabilities would drift from the plan it is supposed to preview, and
// the drift would be invisible until a customer noticed.
//
// So a trial shows you exactly what Essentials is — including NO CHAT, which is
// the point of a trial. And a champion gets Essentials until chat is ready for
// design partners, at which point `champion.base` becomes `{ tier: 'pro' }` and
// every champion has chat on the next resolve. One line, no migration.
//
// ── WHY THE DURATIONS ARE HISTORIES, NOT NUMBERS ────────────────────────────
// A trial uses the entry in force when it STARTED (SA S-7). Shortening the trial
// from 14 days to 7 must not retroactively end the trials of people who are
// three days in — they were promised 14. Appending a new entry changes the deal
// for new signups only, which is what AC-14 asks for.

import type { CohortConfigShape, HistoryEntry } from '../types';
import type { CohortExplicitValues } from './catalog';

/**
 * A cohort's configuration, with the explicit values this catalog demands.
 *
 * A type alias rather than an empty `interface … extends`: the interface form
 * declared no members of its own, which is what `@typescript-eslint/no-empty-
 * object-type` objects to, and nothing merges into this name.
 */
export type CohortConfig = CohortConfigShape<CohortExplicitValues>;

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
  // FIRST PASS (user decision, 2026-09-23): 1,000 AI actions a month, twice
  // Essentials. To be reset from shadow data like every other number here —
  // decided, but not yet measured. Champions who run out ask an admin for more;
  // they never buy boosts (D-7).
  'ai.actions': { perMonth: 1000 },
  // Zero because SMS is `not_built`. This one is NOT a placeholder: a feature
  // that does not exist cannot be allocated, and the loader enforces it.
  'sms.messages': { perMonth: 0 },
  // FIRST PASS. A fair-use ceiling only ever alerts the platform team (B-7), so
  // the number is an abuse threshold rather than a product promise — and it
  // matches the tier, because email volume is not one of the two things the
  // plans differ by.
  'email.volume': { ceilingPerMonth: 10000 },
  // NOT a placeholder: one owner seat and one location is what exists. Invites
  // and multi-location are unbuilt (§18), so these cannot be raised yet.
  'team.seats': { included: 1, purchasable: false },
  'business.locations': { included: 1, purchasable: false },
};

const TRIAL_VALUES: CohortExplicitValues = {
  // FIRST PASS (user decision, 2026-09-23): 250 actions, and it is the number
  // that matters most here. A one-off TOTAL, not a monthly rate — using it up
  // ENDS THE TRIAL (D-2, FR-27), which is the second of the two ways Test
  // Flight can end.
  //
  // Setup AI counts against it (B-12), so too small a number ends a trial on
  // the customer's first day. **Slice 3 resets this from the S1-T15 measurement
  // of what a real setup actually costs** — that is the whole reason the shadow
  // report measures it, and 250 is a starting point rather than an answer.
  'ai.actions': { total: 250 },
  'sms.messages': { perMonth: 0 }, // not_built, as above
  'email.volume': { ceilingPerMonth: 2000 }, // FIRST PASS
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
    /**
     * Test Flight is BASIC, for fourteen days (user decision, 2026-09-23).
     *
     * Pointing at a tier rather than at `{ all: true }` is what stops the trial
     * drifting: when Essentials changes, the trial changes with it, and nobody
     * has to remember that two files describe the same product.
     *
     * A trial therefore has NO CHAT, exactly like the plan it previews. That is
     * the point of a trial — it shows what you would be buying.
     */
    base: { tier: 'basic' },
    // The plan NAMES are deliberately untranslated for now: all three locales
    // carry the English string, and the user will supply Hebrew and Spanish.
    // Present rather than optional so a missing translation shows up as a
    // visible duplicate on a pricing page instead of an `undefined`.
    labels: { en: 'Test Flight', he: 'Test Flight', es: 'Test Flight' },
    // Beta capabilities are included on top of the tier row. Setting this to []
    // keeps beta for champions only — one value, no code.
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
    /**
     * Founding Partner is BASIC today, and becomes AUTOPILOT the day chat is
     * ready for design partners — **which is this one line**:
     *
     *     base: { tier: 'pro' },
     *
     * That is the whole change. No code, no migration, no per-account admin
     * operation: every champion resolves from the tier row this points at, so
     * the next resolve after the deploy gives them chat.
     */
    base: { tier: 'basic' },
    labels: { en: 'Founding Partner', he: 'Founding Partner', es: 'Founding Partner' },
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

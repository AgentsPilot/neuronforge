/**
 * What a customer is told about their own plan.
 *
 * ── Why these assertions and not others ─────────────────────────────────────
 * The risk on this surface is not a crash. It is **a true-looking sentence that
 * is wrong**, in the one place somebody goes to find out what they are paying
 * for. So the tests are about claims:
 *
 *   - that "everything included" is only said when it is true, and is derived
 *     rather than written down;
 *   - that a plan is never offered as an upgrade when it would take something
 *     away (the defect this suite caught);
 *   - that "we could not read your plan" and "you have no plan" never render
 *     the same — the S-0 lesson, one product away;
 *   - that nothing not-built is ever named, in either direction.
 *
 * The four plan states are all resolved for real, through `resolveEntitlements`
 * against the REAL config. Three of them nobody is on yet, which is exactly why
 * they are here: the first customer on Essentials must not be the test.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md §6.5 WS-2
 */

import {
  buildCustomerPlanView,
  buildPlanComparison,
  comparableAmount,
  groupByCategory,
  isHiddenFromCustomer,
  SECTION_PRESENTATION,
  type CustomerPlanComparison,
} from '@/lib/business-os/entitlements/customerPlanView';
import { PLAN_COMPARISON_ROWS } from '@/lib/business-os/entitlements/config/planComparison';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { CapabilityValue } from '@/lib/business-os/entitlements/types';
import { planBadgeFor } from '@/lib/business-os/entitlements/planBadge';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { fixtureConfig } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';

/**
 * The capability ids in a grouped list.
 *
 * `included` and `adds` became `CustomerPlanCategory[]` when the list was grouped
 * (2026-09-27). Tests ask "which capabilities are named", which is now a question
 * about the features inside the rows — one helper rather than eleven inline
 * `flatMap`s, so the next shape change is one edit.
 */
function capabilityIdsOf(rows: readonly { features: readonly { capability: string }[] }[] = []): string[] {
  return rows.flatMap((row) => row.features.map((feature) => feature.capability));
}

const NOW = new Date('2026-09-27T00:00:00.000Z');
const config = readCodeConfig();
const catalog = config.catalog as Record<string, CapabilityDef>;

/** The view for an account genuinely on this plan. No hand-built payloads. */
function viewFor(planId: string) {
  const resolution = resolveEntitlements({
    config,
    account: previewAccountFor(config, planId, NOW),
    overrides: [],
    addons: [],
    now: NOW,
  });

  return buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config });
}

describe('a Founding Partner (champion)', () => {
  const view = viewFor('champion');

  it('is told the name, that it is free, and that it has no end date', () => {
    // The user's own words for this state: "Founding Partner — free, no end
    // date, everything included".
    expect(view.name).toBe('Founding Partner');
    expect(view.free).toBe(true);
    expect(view.monthlyPriceUsd).toBe(0);
    expect(view.accessEndsAt).toBeNull();
  });

  it('really does get everything the surface can show — the claim is derived, not asserted', () => {
    // "Everything included" has to be TRUE, not a slogan. A champion resolves
    // through the AUTOPILOT row since 2026-09-27, so once the unbuilt
    // capabilities are out of the picture there should be nothing left withheld.
    // If a future matrix withholds something real from Autopilot, this fails in
    // CI rather than in front of a customer.
    const resolution = resolveEntitlements({
      config,
      account: previewAccountFor(config, 'champion', NOW),
      overrides: [],
      addons: [],
      now: NOW,
    });

    const visibleCapabilities = Object.keys(resolution.values).filter(
      (capability) => !isHiddenFromCustomer(capability, catalog[capability])
    );

    // Flattened: `included` is grouped by category now, so the count that matters
    // is the capabilities inside the rows, not the number of rows.
    expect(capabilityIdsOf(view.included)).toHaveLength(visibleCapabilities.length);
    expect(visibleCapabilities.length).toBeGreaterThan(10);
    // And they really are grouped — fewer rows than capabilities, which is the
    // whole point of the change.
    expect(view.included.length).toBeLessThan(visibleCapabilities.length);
  });

  it('is offered NOTHING above it, because it already has the top plan in full', () => {
    // This assertion inverted with parity (user decision, 2026-09-27). It briefly
    // read "is offered Autopilot for the ONE thing it adds": champions inherited
    // Autopilot's features but `CHAMPION_VALUES` pinned the allowance (then `ai.actions`) at 1,000
    // against the tier's 2,000, so the screen offered a design partner an upgrade
    // on exactly the axis where they were behind.
    //
    // With the allowance inherited there is no delta at all, so the section is
    // **absent** — the same "nothing above this plan for this customer" path the
    // anti-downgrade rule reaches, arrived at from the other direction.
    expect(view.nextPlanUp).toBeNull();
  });

  it('and the absence is an absence, not an empty box', () => {
    // The thing a null-vs-empty mistake would produce: a headed section with no
    // rows and a price beside it. `nextPlanUp` is the only field the component
    // renders that from, so `null` is what makes the section disappear.
    expect(view.nextPlanUp).toBeNull();
    expect(Object.keys(view)).toContain('nextPlanUp');
  });

  it('is never offered a plan that would take something away', () => {
    // The property the earlier defect broke, kept as a property rather than as
    // the old assertion about a specific plan. Before ranking was added, the
    // champion was offered Essentials at $79 with the headline "1,000 per month
    // becomes 500 per month" — a downgrade presented as the next step up, on the
    // screen whose whole job is to make the transition not a shock.
    for (const entry of view.nextPlanUp?.improves ?? []) {
      const from = Number(entry.from.replace(/[^0-9.]/g, ''));
      const to = Number(entry.to.replace(/[^0-9.]/g, ''));
      expect(to).toBeGreaterThan(from);
    }
  });

  it('is still told what happens if the free arrangement ever changes', () => {
    // With no plan above them, `whenThisChanges` is the only thing preparing a
    // champion for a future conversation — which makes it load-bearing rather
    // than decorative.
    expect(view.whenThisChanges?.key).toBe('plan.changes.no_end_date');
  });

  it('is told what a paid plan is, so the day it changes is not the first they hear of it', () => {
    expect(view.whenThisChanges?.key).toBe('plan.changes.no_end_date');
    expect(view.whenThisChanges?.key).toBe('plan.changes.no_end_date');
    // And that nothing happens without them.
    expect(view.whenThisChanges?.key).toBe('plan.changes.no_end_date');
  });
});

describe('a Founding Partner whose access has been given an end date', () => {
  // The state an admin creates the day a free account starts being wound down —
  // which is precisely the moment the user asked not to be a shock. It is
  // reachable today through the audited `set_expiry` op, and the trim list in
  // the shadow report proposes exactly this operation.
  const resolution = resolveEntitlements({
    config,
    account: {
      ...previewAccountFor(config, 'champion', NOW),
      cohortExpiresAt: '2026-12-01T00:00:00.000Z',
    },
    overrides: [],
    addons: [],
    now: NOW,
  });
  const view = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config });

  it('stops saying "no end date" the moment there is one', () => {
    expect(view.accessEndsAt).not.toBeNull();
    expect(view.whenThisChanges?.key).not.toBe('plan.changes.no_end_date');
  });

  it('says what happens next, and that nothing is charged without a choice', () => {
    expect(view.whenThisChanges?.key).toBe('plan.changes.on_end');
    expect(view.whenThisChanges?.key).toBe('plan.changes.on_end');
  });

  it('is still free until then, and still has everything', () => {
    expect(view.free).toBe(true);
    expect(view.monthlyPriceUsd).toBe(0);
    expect(capabilityIdsOf(view.included).length).toBeGreaterThan(10);
  });
});

describe('a trial (Test Flight)', () => {
  const view = viewFor('trial');

  it('is told the DATE it ends, and why it might end sooner', () => {
    expect(view.name).toBe('Test Flight');
    expect(view.free).toBe(true);
    expect(view.accessEndsAt).not.toBeNull();

    // The date, which is what `accessEndsAt` holds and what nothing rendered
    // before (SA R3-1). It leads, because a date needs no arithmetic.
    expect(view.endsWhen?.key).toBe('plan.ends_on_or_credits');
    expect(view.endsWhen?.date).toBeTruthy();
    // And the reason it can end sooner, which the date alone cannot carry — read
    // off config, so shortening the trial changes what the customer is told.
    expect(view.endsWhen?.key).toBe('plan.ends_on_or_credits');
  });

  it('is shown the paid plan and what it would actually add', () => {
    expect(view.nextPlanUp?.name).toBe('Essentials');
    expect(view.nextPlanUp?.monthlyPriceUsd).toBeGreaterThan(0);
    // No `nothingToShow` to check any more (QA-2): the presence of `nextPlanUp`
    // IS the signal that there is something to show, so a second field saying so
    // was unreachable.

    const improved = view.nextPlanUp?.improves.map((entry) => entry.capability) ?? [];
    expect(improved).toContain('email.volume');
  });

  it('IS told the credit allowance changes, as a change rather than an improvement', () => {
    // User decision 4. The trial has a one-off `{ total }` and Essentials a
    // `{ perMonth }` rate — different quantities with no honest exchange rate. So
    // it is neither claimed as an improvement nor suppressed: it is stated, with
    // both numbers, and the customer judges.
    const changed = view.nextPlanUp?.changes ?? [];

    expect(changed.map((entry) => entry.capability)).toContain('credits.allowance');

    const creditChange = changed.find((entry) => entry.capability === 'credits.allowance')!;
    // Since the 2026-10-25 re-size (D4): 1,000 in total → 2,000 per month.
    expect(creditChange.from).toBe('1,000 in total');
    expect(creditChange.to).toBe('2,000 per month');

    // And NOT in `improves`, which is the list that asserts a direction.
    expect(view.nextPlanUp?.improves.map((entry) => entry.capability) ?? []).not.toContain('credits.allowance');
  });

  it('is NOT told the credit allowance IMPROVES — the units do not match (SA P-2)', () => {
    // ⚠️ A product-visible consequence of P-2, recorded here rather than left to
    // be noticed. The trial gives `{ total: 250 }` and Essentials gives
    // `{ perMonth: 500 }`. Those are different quantities with no honest
    // exchange rate, so the rule is silent about them — which means a trial
    // customer is shown only the email-volume increase, and not the thing that
    // is arguably the main difference.
    //
    // Silence in `improves` is the point: the direction is not claimed. The line
    // itself is not lost — it moved to `changes` (the test above), which is user
    // decision 4 and also removes the hazard that whether a trial saw a paid plan
    // at all depended on one same-unit capability happening to exist.
    const improved = view.nextPlanUp?.improves.map((entry) => entry.capability) ?? [];

    expect(improved).not.toContain('credits.allowance');
  });

  it('is promised nothing is charged before they choose', () => {
    expect(view.whenThisChanges?.key).toBe('plan.changes.on_end');
  });
});

describe('Essentials and Autopilot — the two nobody is on yet', () => {
  it('Essentials shows its price and what Autopilot adds — including chat', () => {
    const view = viewFor('basic');

    expect(view.name).toBe('Essentials');
    expect(view.free).toBe(false);
    expect(view.monthlyPriceUsd).toBeGreaterThan(0);
    // No end date sentence for a paid plan: it runs while it is paid for.
    expect(view.whenThisChanges).toBeNull();

    expect(view.nextPlanUp?.name).toBe('Autopilot');
    // The two paid tiers differ in exactly two things, and the customer is told
    // about both: the chat capabilities Autopilot adds, and the larger credit
    // allowance.
    expect(view.nextPlanUp?.improves.map((entry) => entry.capability)).toEqual(['credits.allowance']);
    const credits = view.nextPlanUp!.improves[0];
    expect(`${credits.from} → ${credits.to}`).toBe('2,000 per month → 5,000 per month');
    expect(capabilityIdsOf(view.nextPlanUp?.adds)).toContain('chat.access');
    expect(capabilityIdsOf(view.nextPlanUp?.adds).length).toBeGreaterThanOrEqual(9);
    // And the nine arrive as ONE row, which is the point of grouping them.
    expect(view.nextPlanUp?.adds).toHaveLength(1);
    expect(view.nextPlanUp?.adds[0].labelKey).toBe('plan.category.ai_chat');
  });

  it('Essentials is offered Autopilot as available to buy (availableToBuy on since 2026-10-13, for testing)', () => {
    const view = viewFor('basic');

    // The shipped config marks Autopilot buyable (user decision, 2026-10-13;
    // requirement §9.5 re-checks it at go-live), so the payload carries no
    // unavailability sentence. The real-config path of the `true` branch; the
    // fixture block below covers both branches with one flag varied.
    expect(view.nextPlanUp?.availableToBuy).toBe(true);
    expect(view.nextPlanUp?.actionUnavailableBecause).toBeNull();
  });

  it('Autopilot is told there is nothing above it, rather than shown an empty offer', () => {
    const view = viewFor('pro');

    expect(view.name).toBe('Autopilot');
    expect(view.nextPlanUp).toBeNull();
  });

  it('never compares a one-off total against a monthly rate (SA P-2)', () => {
    // When this was written, the trial gave `{ total: 250 }` AI actions and
    // Essentials `{ perMonth: 500 }` (slice 5 later made them 2,000 and 19,750 credits). Those are different quantities with no honest
    // exchange rate, so the first version compared 250 against 500 and got the
    // right answer by luck. Invert them and it would have announced a reduction
    // as a step up — the defect one level deeper.
    //
    // Asserted through a fixture whose numbers are the wrong way round: a
    // 2,000-action one-off trial against a 500-a-month plan. The rule must stay
    // SILENT about `credits.allowance` rather than claim either direction.
    const invertedTrial = {
      ...config,
      matrix: {
        ...config.matrix,
        tiers: {
          ...config.matrix.tiers,
          basic: { ...config.matrix.tiers.basic, 'credits.allowance': { perMonth: 500 } },
        },
      },
      cohorts: {
        ...config.cohorts,
        // `values`, not `overlay`. The first version of this fixture wrote a
        // field that does not exist on `CohortConfig`, so the inversion never
        // happened and this test passed for the wrong reason — which is why the
        // two assertions below the fixture now come AFTER proving it took.
        trial: {
          ...config.cohorts.trial,
          values: { ...config.cohorts.trial.values, 'credits.allowance': { total: 2000 } },
        },
      },
    } as typeof config;

    const resolution = resolveEntitlements({
      config: invertedTrial,
      account: previewAccountFor(invertedTrial, 'trial', NOW),
      overrides: [],
      addons: [],
      now: NOW,
    });

    // The fixture really is inverted: MORE one-off actions than the monthly plan
    // gives. Without this, silence proves nothing.
    expect(resolution.values['credits.allowance'].value).toEqual({ total: 2000 });

    const view = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config: invertedTrial });

    // Silence about the one capability whose units do not match, rather than a
    // confident wrong claim in either direction.
    expect(view.nextPlanUp?.improves.map((entry) => entry.capability) ?? []).not.toContain('credits.allowance');
    expect(capabilityIdsOf(view.nextPlanUp?.adds)).not.toContain('credits.allowance');

    // And the comparison is not simply broken: a capability whose units DO match
    // is still ranked in the same view.
    expect(view.nextPlanUp?.improves.map((entry) => entry.capability) ?? []).toContain('email.volume');
  });

  it('every improvement shown is an INCREASE, on every plan', () => {
    // The general form of the champion defect. Any pair whose numbers go the
    // wrong way is an upgrade offer that reads as a punishment.
    //
    // QA-4: `if (!upgrade) continue` plus an inner loop means a regression that
    // nulled every `nextPlanUp` would leave this passing on zero pairs. So the
    // pairs are collected first and counted, and the same family of mistake I
    // confessed to in the render suite cannot happen here.
    const pairs: Array<{ planId: string; from: number; to: number }> = [];

    for (const planId of ['champion', 'trial', 'basic', 'pro']) {
      const upgrade = viewFor(planId).nextPlanUp;
      if (!upgrade) continue;

      for (const entry of upgrade.improves) {
        pairs.push({
          planId,
          from: Number(entry.from.replace(/[^0-9.]/g, '')),
          to: Number(entry.to.replace(/[^0-9.]/g, '')),
        });
      }
    }

    // Trial → Essentials and Essentials → Autopilot each contribute at least
    // one. A run with none means the comparison stopped producing anything, not
    // that it produced nothing wrong.
    expect(pairs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(pairs.map((pair) => pair.planId)).size).toBeGreaterThanOrEqual(2);

    for (const pair of pairs) {
      expect(pair.to).toBeGreaterThan(pair.from);
    }
  });

  describe('the two conservative clauses (QA-3)', () => {
    // Neither was pinned, and one was safe only by accident: a mutant returning
    // `0` instead of `null` for something unrankable is inert because `0 <= 0`
    // stays silent. Invisible from outside, so the function is exported and
    // tested directly — the `previewAccountFor` precedent.

    it('returns null, not 0, for a value with no arithmetic', () => {
      // A variant is a NAME, not an amount. Returning `0` would make any
      // number-bearing value on the other side look like an increase over it.
      expect(comparableAmount('branded' as never)).toBeNull();
      expect(comparableAmount('unbranded' as never)).toBeNull();
      expect(comparableAmount('priority' as never)).toBeNull();
      expect(comparableAmount(undefined)).toBeNull();
      expect(comparableAmount({ nothing: 'numeric' } as never)).toBeNull();
    });

    it('a null side can never be ranked against a number — which is what `0` would break', () => {
      // The behavioural consequence, stated so the assertion above is not just
      // about a return value. With `null` there is nothing to compare; with `0`
      // there would be, and `5 > 0` would announce an improvement in a variant.
      const variant = comparableAmount('unbranded' as never);
      const number = comparableAmount({ perMonth: 5 });

      expect(variant).toBeNull();
      expect(number).toEqual({ unit: 'perMonth', amount: 5 });
      // The guard in `buildUpgrade` is `mine === null || next === null` — so a
      // pair like this is skipped rather than ranked.
      expect(variant === null || number === null).toBe(true);
    });

    it('carries the UNIT, so unlike quantities are never compared', () => {
      expect(comparableAmount({ total: 250 })).toEqual({ unit: 'total', amount: 250 });
      expect(comparableAmount({ perMonth: 500 })).toEqual({ unit: 'perMonth', amount: 500 });
      // Same numbers, different quantities: the units differ, so the comparison
      // is skipped rather than resolved in either direction.
      expect(comparableAmount({ total: 500 })!.unit).not.toBe(comparableAmount({ perMonth: 500 })!.unit);
    });

    it('is `<=`, not `<`: an equal amount is not an improvement', () => {
      // Pinned BEHAVIOURALLY, through `buildUpgrade`. Asserting `a <= b` on two
      // return values would say nothing at all about the operator inside it.
      //
      // The reachable case exists because display and amount are different
      // things: `{ included: 1 }` and `{ included: 1, purchasable: true }` render
      // as "1 seat" and "1 seat, more purchasable" — different strings, so the
      // earlier display check does not skip them — while the AMOUNT is identical.
      // With `<=` that is silent. Mutated to `<`, it is announced as "1 seat
      // becomes 1 seat, more purchasable": a claim about a number that did not
      // change.
      const seatsPurchasableOnPro = {
        ...config,
        matrix: {
          ...config.matrix,
          tiers: {
            ...config.matrix.tiers,
            pro: {
              ...config.matrix.tiers.pro,
              'team.seats': { included: 1, purchasable: true },
              // The positive control below: an amount that genuinely increases.
              // (Kept on `email.volume` after slice 6 restored the credit number:
              // a control that depends on no display rule is the better control.)
              'email.volume': { ceilingPerMonth: 20000 },
            },
          },
        },
      } as typeof config;

      const resolution = resolveEntitlements({
        config: seatsPurchasableOnPro,
        account: previewAccountFor(seatsPurchasableOnPro, 'basic', NOW),
        overrides: [],
        addons: [],
        now: NOW,
      });
      const view = buildCustomerPlanView({
        resolution,
        unavailable: false,
        now: NOW,
        config: seatsPurchasableOnPro,
      });

      // The fixture took: the two plans really do render this capability
      // differently now, which is what makes the case reachable at all.
      const proResolution = resolveEntitlements({
        config: seatsPurchasableOnPro,
        account: previewAccountFor(seatsPurchasableOnPro, 'pro', NOW),
        overrides: [],
        addons: [],
        now: NOW,
      });
      expect(proResolution.values['team.seats'].value).toEqual({ included: 1, purchasable: true });
      expect(resolution.values['team.seats'].value).toEqual({ included: 1, purchasable: false });

      // And it is NOT offered as an improvement, because the amount is equal.
      expect(view.nextPlanUp?.improves.map((entry) => entry.capability) ?? []).not.toContain('team.seats');
      // While a capability whose amount genuinely increases still is — so the
      // silence above is about equality, not about the comparison being broken.
      expect(view.nextPlanUp?.improves.map((entry) => entry.capability) ?? []).toContain('email.volume');
    });

    it('booleans rank, so a capability gained is still an addition', () => {
      // Not a hole: `adds` handles granted-vs-withheld before this is consulted.
      // Pinned so a future edit does not quietly make every boolean unrankable.
      expect(comparableAmount(true)).toEqual({ unit: 'boolean', amount: 1 });
      expect(comparableAmount(false)).toEqual({ unit: 'boolean', amount: 0 });
    });
  });
});

/**
 * The two commercial flags, exercised (QA-6).
 *
 * Neither branch had any coverage: deleting the `shownToCustomers` gate entirely
 * passed 63 tests, and `availableToBuy: true` was never reached. The reason is
 * that the flags only VARY in the fixture matrix — every other test in this file
 * builds config with `readCodeConfig()`, where both tiers happen to be
 * shown-and-not-buyable (shown-AND-buyable since 2026-10-13), so both branches
 * were invisible.
 *
 * The fixture is the right shape for this: `basic` shown+buyable, `growth`
 * shown-only, and `pro` hidden AND last in `tierOrder` — which is exactly the
 * case that matters, because a hidden plan that is last is the one a
 * "next plan up" walk would otherwise hand a customer.
 */
describe('the two commercial flags decide what a customer is offered', () => {
  /**
   * A fixture config with ONE presentation flag changed, cloned.
   *
   * `fixtureConfig()` hands back a structure that shares `FIXTURE_TIER_MATRIX`, so
   * writing a flag through it leaks into every later test in the file — which is
   * exactly what happened on the first run of this block: the `availableToBuy`
   * I set in one test made the next one fail. Cloning the entry keeps the shared
   * fixture shared and the variation local.
   */
  function fixtureWith(tier: 'basic' | 'growth' | 'pro', flags: Record<string, boolean>) {
    const config = fixtureConfig();
    const presentation = config.matrix.presentation as Record<string, Record<string, unknown>>;

    return {
      ...config,
      matrix: {
        ...config.matrix,
        presentation: { ...presentation, [tier]: { ...presentation[tier], ...flags } },
      },
    } as typeof config;
  }

  function fixtureViewFor(planId: string, config = fixtureConfig()) {
    const resolution = resolveEntitlements({
      config,
      account: previewAccountFor(config, planId, NOW),
      overrides: [],
      addons: [],
      now: NOW,
    });

    return buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config });
  }

  it('a plan marked NOT shown is never offered as the plan above somebody', () => {
    // The fixture's `pro` is hidden and last in the order, so the plan above
    // `growth` exists, resolves, and must still not be named. Deleting the gate
    // makes this the only failing test — which is the coverage QA found missing.
    const view = fixtureViewFor('growth');

    expect(view.nextPlanUp).toBeNull();
  });

  it('but the same walk DOES offer a plan that is shown — so the gate is what decided it', () => {
    // Non-vacuity, and the pair that makes the assertion above mean something:
    // same fixture, same mechanism, one flag different.
    expect(fixtureViewFor('growth', fixtureWith('pro', { shownToCustomers: true })).nextPlanUp?.planId).toBe('pro');
  });

  it('a buyable plan says so, and carries no unavailability sentence', () => {
    // The `availableToBuy: true` branch, which nothing reached before. Set on the
    // fixture's middle tier so the plan ABOVE `basic` is the buyable one — the flag
    // is reported about the next plan, not the current one.
    const view = fixtureViewFor('basic', fixtureWith('growth', { availableToBuy: true }));

    expect(view.nextPlanUp?.planId).toBe('growth');
    expect(view.nextPlanUp?.availableToBuy).toBe(true);
    expect(view.nextPlanUp?.actionUnavailableBecause).toBeNull();
  });

  it('and a plan that is not buyable carries the reason instead', () => {
    // The other side of the same branch, on the unmodified fixture.
    const view = fixtureViewFor('basic');

    expect(view.nextPlanUp?.planId).toBe('growth');
    expect(view.nextPlanUp?.availableToBuy).toBe(false);
    expect(view.nextPlanUp?.actionUnavailableBecause?.key).toBe('plan.move_before_then');
  });
});

/**
 * The ending sentence, and the duplicate that was removed (refinement 1).
 */
describe('a plan is not told when it ends twice', () => {
  it('an open-ended free plan gets the long note ONLY', () => {
    // A champion saw "No end date unless an admin sets one" and, a row later,
    // "Your access has no end date… we will tell you first". The second says it
    // better and completely. Suppressed in the payload rather than skipped in the
    // component: a field the page must know to ignore is a field the next page
    // will forget to ignore.
    const view = viewFor('champion');

    expect(view.endsWhen).toBeNull();
    expect(view.whenThisChanges?.key).toBe('plan.changes.no_end_date');
  });

  it('a TRIAL keeps its deadline — the two are not duplicates', () => {
    // The first pass suppressed `endsWhen` whenever a note existed, which cost the
    // trial the only line that says WHEN it ends. Its note says what happens
    // NEXT; the two carry different information and both survive.
    const view = viewFor('trial');

    expect(view.endsWhen?.date).toBeTruthy();
    expect(view.whenThisChanges?.key).toBe('plan.changes.on_end');
  });

  it('a paid plan keeps its line, because nothing else says it', () => {
    const view = viewFor('basic');

    expect(view.endsWhen?.key).toBe('plan.ends.while_paid');
    expect(view.whenThisChanges).toBeNull();
  });

  it('NOTHING claims "no end date" when there IS one — on any surface (SA R3-1/R3-4)', () => {
    // This replaced a test that restated the implementation's own boolean
    // (`suppressed === (note !== null && accessEndsAt === null)`), which is why the
    // suite stayed green while a champion with an expiry was told, in two adjacent
    // lines, that their access had no end date and that it would end. A test that
    // asserts the condition can only ever agree with the code.
    //
    // So this asserts the CUSTOMER-VISIBLE property, over every string the surface
    // can produce — including the pill's tooltip, which is on the chrome of every
    // screen — and includes the state the original describe block never built: a
    // champion with a date.
    const datedChampion = resolveEntitlements({
      config,
      account: { ...previewAccountFor(config, 'champion', NOW), cohortExpiresAt: '2026-12-01T00:00:00.000Z' },
      overrides: [],
      addons: [],
      now: NOW,
    });

    const cases = [
      ...['champion', 'trial', 'basic', 'pro'].map((planId) => ({
        what: planId,
        view: viewFor(planId),
        resolution: resolveEntitlements({
          config,
          account: previewAccountFor(config, planId, NOW),
          overrides: [],
          addons: [],
          now: NOW,
        }),
      })),
      {
        what: 'champion with an end date',
        view: buildCustomerPlanView({ resolution: datedChampion, unavailable: false, now: NOW, config }),
        resolution: datedChampion,
      },
    ];

    /*
     * These surfaces name a dictionary KEY now; they no longer write the
     * sentence. `endsWhen` and `whenThisChanges` are `PlanSentence` objects and
     * the pill carries `titleKey`, so the old version of this loop — which
     * kept only values that were `typeof === 'string'` and read `.title` —
     * collected NOTHING and joined it into an empty string. Matching
     * /no end date/ against '' passes every time, so this test went on
     * reporting success while asserting nothing at all: the exact failure its
     * own comment above was written about, arriving by a different route.
     *
     * So: compare keys, and match on `no_end`, which is the shared stem of both
     * claims a surface can make — `plan.badge.no_end` and
     * `plan.changes.no_end_date`.
     */
    for (const { what, view, resolution } of cases) {
      const claims = [
        view.endsWhen?.key,
        view.whenThisChanges?.key,
        planBadgeFor(resolution, config)?.titleKey,
      ]
        .filter((key): key is string => typeof key === 'string')
        .join(' | ');

      if (view.accessEndsAt !== null) {
        // An empty `claims` is how this test went blind. Fail on it directly,
        // so a future rename cannot quietly empty the list again.
        expect({ what, saidSomething: claims !== '' }).toEqual({ what, saidSomething: true });
        expect({ what, claims }).toEqual({ what, claims: expect.not.stringMatching(/no_end/i) });
      }
    }
  });

  it('an unusable end date produces NO sentence, not "NaN undefined NaN" (SA R4-6)', () => {
    // The one surface whose entire rule is that a failure must not look like a
    // fact. A date `Date` cannot parse now yields nothing, and the note below
    // still tells the customer what happens when their plan ends — so the page
    // reads as less specific rather than as broken.
    // Reached by handing this layer a resolution with a bad date, not by putting
    // one on the account: the LIFECYCLE layer throws `RangeError: Invalid time
    // value` on `toISOString` long before the formatter sees it, which is
    // reassuring and also means the account route cannot exercise this guard.
    // What can reach it is a plan row whose column is malformed, which is exactly
    // this shape.
    const sound = resolveEntitlements({
      config,
      account: previewAccountFor(config, 'champion', NOW),
      overrides: [],
      addons: [],
      now: NOW,
    });
    const broken = {
      ...sound,
      lifecycle: { ...sound.lifecycle, accessEndsAt: 'not-a-date' },
    } as typeof sound;

    const view = buildCustomerPlanView({ resolution: broken, unavailable: false, now: NOW, config });

    // No sentence at all, rather than a sentence containing rubbish.
    expect(view.endsWhen).toBeNull();
    // And nothing anywhere in the payload carries the rubbish either.
    expect(JSON.stringify(view)).not.toMatch(/NaN/);
    // The note still explains what happens when the plan ends, so the page reads
    // as less specific rather than as broken.
    expect(view.whenThisChanges).toBeTruthy();
  });

  it('the second-way-of-ending clause is decided STRUCTURALLY (SA R4-5)', () => {
    // It was recovered by regex-matching another module's English
    // (`/whichever comes first/i`), so a copy-edit there would silently drop the
    // run-out warning here. The real predicate is the shape of the allowance: a
    // one-off `{ total: n }` can run out, a `{ perMonth: n }` resets (FR-27).
    const trial = viewFor('trial');
    const champion = buildCustomerPlanView({
      resolution: resolveEntitlements({
        config,
        account: { ...previewAccountFor(config, 'champion', NOW), cohortExpiresAt: '2026-12-01T00:00:00.000Z' },
        overrides: [],
        addons: [],
        now: NOW,
      }),
      unavailable: false,
      now: NOW,
      config,
    });

    // The trial's allowance is a one-off total, so it says both ways it can end.
    expect(trial.endsWhen?.key).toBe('plan.ends_on_or_credits');
    // The champion's is monthly, so there is only the date.
    expect(champion.endsWhen?.key).not.toBe('plan.ends_on_or_credits');
    expect(champion.endsWhen?.key).toBe('plan.ends_on');
  });

  it('a champion WITH an end date is told the date, on both surfaces', () => {
    // The state that was wrong on screen. Built here because the original dated
    // champion describe asserted only on `whenThisChanges` — one of the three
    // fields that can carry the claim.
    const datedChampion = resolveEntitlements({
      config,
      account: { ...previewAccountFor(config, 'champion', NOW), cohortExpiresAt: '2026-12-01T00:00:00.000Z' },
      overrides: [],
      addons: [],
      now: NOW,
    });
    const view = buildCustomerPlanView({ resolution: datedChampion, unavailable: false, now: NOW, config });

    // The KEY and the raw date; the component formats the day in the reader's
    // locale, so the English sentence is no longer built here.
    expect(view.endsWhen).toEqual({ key: 'plan.ends_on', date: '2026-12-01T00:00:00.000Z' });
    expect(view.whenThisChanges?.key).toBe('plan.changes.on_end');
    // And the pill, which asserted the opposite as a constant.
    expect(planBadgeFor(datedChampion, config)?.titleKey).toBe('plan.badge.ends');
    expect(planBadgeFor(datedChampion, config)?.titleKey).toBe('plan.badge.ends');
  });

  it('every plan is told SOMETHING about its ending — never neither', () => {
    // The failure mode of suppressing by construction: both null, and a customer
    // with no idea whether their plan runs out.
    for (const planId of ['champion', 'trial', 'basic', 'pro']) {
      const view = viewFor(planId);

      expect(view.endsWhen ?? view.whenThisChanges).toBeTruthy();
    }
  });
});

/**
 * The grouped list (refinement 3).
 */
describe('the included list is grouped by category', () => {
  it('a champion reads ten rows rather than twenty-eight lines', () => {
    const view = viewFor('champion');

    expect(capabilityIdsOf(view.included).length).toBeGreaterThan(20);
    // Nine categories, plus the credits row slice 6 put first (D-g).
    expect(view.included.length).toBeLessThanOrEqual(10);
  });

  it('AI chat is ONE long row, not an expander', () => {
    // The user's 3–4-per-row rule of thumb, explicitly broken here: nine entries
    // on one line beats hiding five of them behind "+N more", which would be a new
    // interaction on a read-only screen. (Ten until slice 6 moved the credit
    // allowance to its own row, D-g.)
    const row = viewFor('champion').included.find((entry) => entry.category === 'ai_chat')!;

    expect(row.features.length).toBeGreaterThanOrEqual(9);
    expect(row.features.map((feature) => feature.capability)).not.toContain('credits.allowance');
    expect(row.labelKey).toBe('plan.category.ai_chat');
    // One string, joined server-side — the component prints it and composes
    // nothing.
    expect(row.summary.split(', ').length).toBe(row.features.length);
  });

  it('a value worth printing is appended to its own name, and `yes` never is', () => {
    const rows = viewFor('basic').included;
    const summaries = rows.map((row) => row.summary).join(' | ');

    expect(summaries).toMatch(/Credits \(2,000 per month\)/);
    expect(summaries).not.toMatch(/\(yes\)/);
    // And a value that already carries brackets is not wrapped in more of them:
    // "Email volume (10,000 per month (alerts, never blocks))" was the first thing
    // to look wrong when these lines were joined.
    expect(summaries).toMatch(/Email volume 10,000 per month \(alerts, never blocks\)/);
    expect(summaries).not.toMatch(/\(\d[\d,]* per month \(/);
  });

  it('the order is the one a business meets them in, and it is stable', () => {
    // Not alphabetical (which opens on Add-ons) and not catalog order (which also
    // opens on add-ons). Clients first because that is why the product exists.
    const order = viewFor('champion').included.map((row) => row.category);

    // Credits first (slice 6, D-g / SQ-25), then the clients.
    expect(order[0]).toBe('credits');
    expect(viewFor('champion').included[0].labelKey).toBe('plan.category.credits');
    expect(order[1]).toBe('crm');
    // The plain word AND the acronym (user decision, 2026-09-27) — pinned because
    // it is a wording choice somebody made, not a default.
    expect(viewFor('champion').included[1].labelKey).toBe('plan.category.crm');
    expect(order.indexOf('website_intake')).toBeLessThan(order.indexOf('payments'));
    expect(order.indexOf('payments')).toBeLessThan(order.indexOf('ai_chat'));
    expect(order.indexOf('insights')).toBeLessThan(order.indexOf('support'));
    expect(order[order.length - 1]).toBe('addon');
    // Twice, same answer: nothing here depends on object iteration order.
    expect(viewFor('champion').included.map((row) => row.category)).toEqual(order);
  });

  it('every category in the CATALOG has a customer-facing name', () => {
    // A new catalog category renders with its raw id, which is ugly on purpose —
    // and this fails, so it gets named rather than silently shipped.
    const named = new Set(
      [...new Set(Object.values(catalog).map((definition) => definition.category))].filter((category) => {
        const row = groupByCategory(
          [{ capability: Object.keys(catalog).find((id) => catalog[id].category === category)!, label: 'x', value: 'yes' }],
          catalog
        )[0];
        return row.labelKey !== category;
      })
    );

    const all = new Set(Object.values(catalog).map((definition) => definition.category));
    expect([...all].filter((category) => !named.has(category))).toEqual([]);
  });

  it('the upgrade list is grouped too — nine chat rows became one', () => {
    const adds = viewFor('basic').nextPlanUp!.adds;

    expect(adds).toHaveLength(1);
    expect(adds[0].labelKey).toBe('plan.category.ai_chat');
    expect(adds[0].features.length).toBeGreaterThanOrEqual(9);
  });
});

describe('when there is no answer', () => {
  it('a failed read is NOT "you have no plan"', () => {
    // The S-0 lesson, one product away: "we could not check" and "there is
    // nothing" must never look the same. Here it matters because the second one
    // would frighten a paying customer.
    const view = buildCustomerPlanView({ resolution: null, unavailable: true, now: NOW, config });

    expect(view.status).toBe('unavailable');
    expect(view.problem?.key).toBe('plan.problem.unavailable');
    expect(view.problem?.key).toBe('plan.problem.unavailable');
    expect(view.included).toEqual([]);
    expect(view.name).toBeNull();
  });

  it('a missing plan record says so, and says the product still works', () => {
    const view = buildCustomerPlanView({ resolution: null, unavailable: false, now: NOW, config });

    expect(view.status).toBe('no_plan_record');
    expect(view.problem?.key).toBe('plan.problem.no_record');
    expect(view.problem?.key).toBe('plan.problem.no_record');
  });

  it('an account the resolver granted nothing is a missing record, not an empty plan', () => {
    // `basis.kind === 'none'` is an anomaly. Rendering "your plan includes
    // nothing" to somebody whose product is working would be both alarming and
    // false.
    const resolution = resolveEntitlements({
      config,
      account: null,
      overrides: [],
      addons: [],
      now: NOW,
    });

    const view = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config });

    expect(resolution.basis.kind).toBe('none');
    expect(view.status).toBe('no_plan_record');
    expect(view.included).toEqual([]);
  });

  it('the three statuses are distinguishable by a machine, not by their wording', () => {
    // Non-vacuity on the above: if `status` ever collapsed to one value, every
    // assertion here would still pass on the prose.
    const ok = viewFor('basic').status;
    const unavailable = buildCustomerPlanView({ resolution: null, unavailable: true, config }).status;
    const missing = buildCustomerPlanView({ resolution: null, unavailable: false, config }).status;

    expect(new Set([ok, unavailable, missing]).size).toBe(3);
  });
});

describe('what is never named', () => {
  it('nothing that does not exist is listed as included', () => {
    // A `not_built` capability is an absence, not a feature. Listing it invites
    // "so how do I get it?", and the answer is "from no plan, at any price".
    for (const planId of ['champion', 'trial', 'basic', 'pro']) {
      const view = viewFor(planId);
      const named = [
        ...capabilityIdsOf(view.included),
        ...capabilityIdsOf(view.nextPlanUp?.adds),
        ...(view.nextPlanUp?.improves ?? []).map((entry) => entry.capability),
      ];

      for (const capability of named) {
        expect(catalog[capability].lifecycle).not.toBe('not_built');
      }
    }
  });

  it('there IS something not-built to leave out, so the check above is not vacuous', () => {
    const notBuilt = Object.values(catalog).filter((definition) => definition.lifecycle === 'not_built');
    expect(notBuilt.length).toBeGreaterThan(0);
  });

  /**
   * The EXACT key set, both paths (SA R2-2).
   *
   * This replaced `not.toContain('withholds')` and `not.toContain('excluded')`.
   * A denylist of two names cannot answer the question the slice is built on —
   * "could this payload ever carry an exclusion list?" — because it only rules out
   * the two names somebody thought of, and it takes a diagnosis to tell a real
   * leak from anything else.
   *
   * An allow-list answers it in one line: the function returns two object
   * literals with fixed keys, and any extra key of any name fails here and names
   * itself in the diff.
   *
   * —— The R2-2 diagnosis, kept beside the fix ——
   * SA saw this assertion fail with `"excluded"` in the key list, between
   * `"included"` and `"nextPlanUp"`. **Position was the whole answer.** Key order
   * in a JS object literal follows the order the properties are WRITTEN, so a key
   * appearing at a specific position in a literal that does not contain it cannot
   * come from a module singleton, `process.env`, `jest.isolateModules` or a shared
   * config — only from source that declares `excluded:` on the line after
   * `included:`. The suite was reading a mutated file: a parallel QA mutation run
   * was editing this tree, and this assertion caught exactly the mutant it exists
   * for. "Passes alone, fails in company" was a longer run overlapping a live
   * edit, not an ordering effect.
   *
   * **The production payload cannot carry that key.** The key set is fixed by two
   * literals in one function; there is no computed key, no `Object.assign`, and no
   * spread of anything a caller supplies (the only spreads are of a local
   * `empty`). Verified by inspection and pinned below.
   */
  const OK_PATH_KEYS = [
    'status',
    'planId',
    'name',
    'kind',
    'monthlyPriceUsd',
    'free',
    'state',
    'accessEndsAt',
    'endsWhen',
    'whenThisChanges',
    'included',
    'nextPlanUp',
    // P-4.2 (T5): every plan shown to customers, each with exactly
    // `PLAN_CHOICE_KEYS` below, so it cannot carry an exclusion either.
    'plans',
    // UM-0 (UM-D1): the plans side by side; its own key sets are pinned level by
    // level in `customerPlanView.noExclusions.test.ts` (C-18).
    'comparison',
    'problem',
  ];

  it('produces EXACTLY these keys, so no exclusion field can appear under any name', () => {
    expect(Object.keys(viewFor('basic')).sort()).toEqual([...OK_PATH_KEYS].sort());
  });

  it('the failure paths carry the same key set — no extra field when there is no plan', () => {
    for (const unavailable of [true, false]) {
      const view = buildCustomerPlanView({ resolution: null, unavailable, now: NOW, config });
      expect(Object.keys(view).sort()).toEqual([...OK_PATH_KEYS].sort());
    }
  });

  it('the upgrade object carries exactly its own keys too', () => {
    // The other object a page renders, and the one that gained a field this
    // round. Same reasoning: an allow-list, not two names.
    const upgrade = viewFor('basic').nextPlanUp!;

    expect(Object.keys(upgrade).sort()).toEqual(
      [
        'planId',
        'name',
        'monthlyPriceUsd',
        'availableToBuy',
        'actionUnavailableBecause',
        'adds',
        'improves',
        'changes',
      ].sort()
    );
  });
});

describe('plans: every plan shown to customers (plan payments P-4.2, T5, M-5)', () => {
  const shownTiers = config.tierOrder.filter(
    (planId) => (config.matrix.presentation as Record<string, { shownToCustomers: boolean }>)[planId]?.shownToCustomers
  );

  it('lists every shown tier, in tier order, with its name, price and availableToBuy', () => {
    const presentation = config.matrix.presentation as Record<
      string,
      { shownToCustomers: boolean; availableToBuy: boolean; monthlyPriceUsd: number; labels: { en: string } }
    >;
    // Non-vacuity: more than one plan is shown, so order is a real claim.
    expect(shownTiers.length).toBeGreaterThan(1);
    expect(viewFor('basic').plans).toEqual(
      shownTiers.map((planId) => ({
        planId,
        name: presentation[planId].labels.en,
        monthlyPriceUsd: presentation[planId].monthlyPriceUsd,
        availableToBuy: presentation[planId].availableToBuy,
      }))
    );
  });

  it('is the same list whatever the account is on: a tier, a trial or a Founding Partner', () => {
    const expected = viewFor('basic').plans;
    for (const planId of ['pro', 'trial', 'champion']) {
      expect(viewFor(planId).plans).toEqual(expected);
    }
  });

  it('a PAUSED or EXPIRED tier account lists its OWN plan (it may buy it again)', () => {
    for (const tier of shownTiers) {
      const lapsed = resolveEntitlements({
        config,
        account: { ...previewAccountFor(config, tier, NOW), tierExpiresAt: '2026-01-01T00:00:00.000Z' },
        overrides: [],
        addons: [],
        now: NOW,
      });
      // The resolver keeps the tier as the basis (A-1), so `nextPlanUp` would
      // offer only the plan ABOVE it. `plans` is what lets it re-buy its own.
      expect(lapsed.basis).toEqual({ kind: 'tier', tier });
      const view = buildCustomerPlanView({ resolution: lapsed, unavailable: false, now: NOW, config });
      expect(view.plans.map((choice) => choice.planId)).toContain(tier);
    }
  });

  it('names a plan in the reader\'s language', () => {
    const resolution = resolveEntitlements({ config, account: previewAccountFor(config, 'basic', NOW), overrides: [], addons: [], now: NOW });
    const hebrew = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config, locale: 'he' }).plans;
    const presentation = config.matrix.presentation as Record<string, { labels: { he: string } }>;
    expect(hebrew.map((choice) => choice.name)).toEqual(shownTiers.map((planId) => presentation[planId].labels.he));
  });

  it('a plan with shownToCustomers off is not listed (the flag, not the tier, decides)', () => {
    const presentation = config.matrix.presentation as Record<string, { shownToCustomers: boolean; availableToBuy: boolean }>;
    const hidden = shownTiers[shownTiers.length - 1];
    const saved = { ...presentation[hidden] };
    presentation[hidden].shownToCustomers = false;
    presentation[hidden].availableToBuy = false;
    try {
      expect(viewFor('basic').plans.map((choice) => choice.planId)).toEqual(shownTiers.filter((planId) => planId !== hidden));
    } finally {
      Object.assign(presentation[hidden], saved);
    }
  });

  it('never lists a cohort: a cohort is not a product', () => {
    const cohortIds = Object.keys(config.cohorts);
    expect(cohortIds.length).toBeGreaterThan(0);
    for (const choice of viewFor('champion').plans) expect(cohortIds).not.toContain(choice.planId);
  });

  it('is empty on the failure paths: a plan that cannot be read offers nothing', () => {
    for (const unavailable of [true, false]) {
      expect(buildCustomerPlanView({ resolution: null, unavailable, now: NOW, config }).plans).toEqual([]);
    }
  });
});

/**
 * The plan comparison (upgrade modal UM-0, C-19; UM-D2 grouped rows).
 *
 * The claim it makes is "these are the plans, side by side" — so the tests are
 * about which plans are columns, that every viewer sees the same table, that a
 * ✓ never overstates a plan, and that a highlight is only ever a true "more".
 */
describe('comparison: the plans side by side (upgrade modal UM-0, C-19)', () => {
  const shownTiers = config.tierOrder.filter(
    (planId) => (config.matrix.presentation as Record<string, { shownToCustomers: boolean }>)[planId]?.shownToCustomers
  );

  function rowsOf(comparison: CustomerPlanComparison | null) {
    return (comparison?.sections ?? []).flatMap((section) => section.rows.map((row) => ({ ...row, section: section.section })));
  }

  function rowIn(comparison: CustomerPlanComparison | null, id: string) {
    const row = rowsOf(comparison).find((candidate) => candidate.row === id);
    if (!row) throw new Error(`no comparison row ${id}`);
    return row;
  }

  function cellOf(comparison: CustomerPlanComparison | null, id: string, planId: string) {
    const cell = rowIn(comparison, id).cells.find((candidate) => candidate.planId === planId);
    if (!cell) throw new Error(`no ${planId} cell in ${id}`);
    return cell;
  }

  /** A config with some tiers' values replaced, cloned so nothing leaks between tests. */
  function withTierValues(base: EntitlementConfig, values: Record<string, Record<string, CapabilityValue>>): EntitlementConfig {
    const tiers = base.matrix.tiers as unknown as Record<string, Record<string, CapabilityValue>>;
    const next: Record<string, Record<string, CapabilityValue>> = { ...tiers };
    for (const [tier, row] of Object.entries(values)) next[tier] = { ...tiers[tier], ...row };
    return { ...base, matrix: { ...base.matrix, tiers: next } } as unknown as EntitlementConfig;
  }

  function withShown(base: EntitlementConfig, tier: string): EntitlementConfig {
    const presentation = base.matrix.presentation as Record<string, Record<string, unknown>>;
    return {
      ...base,
      matrix: { ...base.matrix, presentation: { ...presentation, [tier]: { ...presentation[tier], shownToCustomers: true } } },
    } as unknown as EntitlementConfig;
  }

  const [lowTier, highTier] = shownTiers;

  it('columns are exactly the shown plans, in tier order, and match `plans`', () => {
    expect(shownTiers.length).toBeGreaterThan(1);
    const view = viewFor('basic');
    expect(view.comparison!.planIds).toEqual(view.plans.map((choice) => choice.planId));
    expect(view.comparison!.planIds).toEqual(shownTiers);
    for (const row of rowsOf(view.comparison)) {
      expect(row.cells.map((cell) => cell.planId)).toEqual(shownTiers);
    }
  });

  it('a tier with shownToCustomers off has no column and no cell', () => {
    // The fixture's `pro` is hidden: two columns, never three.
    const fixture = fixtureConfig();
    const comparison = buildPlanComparison({ config: fixture, locale: 'en', now: NOW });
    expect(comparison.planIds).toEqual(['basic', 'growth']);
    for (const row of rowsOf(comparison)) {
      expect(row.cells.map((cell) => cell.planId)).toEqual(['basic', 'growth']);
    }
  });

  it('is the same table for every account: trial, Founding Partner (open and dated), and each tier', () => {
    // One fixed `now` for every view (SA optimisation note), so no clock edge can
    // flip a preview.
    const expected = viewFor('basic').comparison;
    const dated = buildCustomerPlanView({
      resolution: resolveEntitlements({
        config,
        account: { ...previewAccountFor(config, 'champion', NOW), cohortExpiresAt: '2026-12-01T00:00:00.000Z' },
        overrides: [],
        addons: [],
        now: NOW,
      }),
      unavailable: false,
      now: NOW,
      config,
    });
    expect(expected).not.toBeNull();
    // LF-2: the TIER columns are the same for every account; a cohort account's
    // own column (`current`, `row.current`) is the one addition, and is its own.
    const tiersOnly = (comparison: CustomerPlanComparison | null) =>
      comparison && {
        planIds: comparison.planIds,
        sections: comparison.sections.map((section) => ({ ...section, rows: section.rows.map(({ current: _own, ...row }) => row) })),
      };
    for (const view of [viewFor('trial'), viewFor('champion'), dated, viewFor('pro')]) {
      expect(tiersOnly(view.comparison)).toEqual(tiersOnly(expected));
    }
    expect(viewFor('pro').comparison).toEqual(expected);
  });

  describe("LF-2 (2026-10-20): a cohort account's own plan is its own first column", () => {
    const cohortViews = () => [
      ['trial', viewFor('trial')],
      ['champion', viewFor('champion')],
    ] as const;

    it('a tier account gets no own column: its plan is already one of planIds', () => {
      for (const tier of shownTiers) {
        const comparison = viewFor(tier).comparison!;
        expect(comparison.current).toBeNull();
        for (const row of rowsOf(comparison)) expect(row.current).toBeNull();
      }
    });

    it('a cohort account gets `current` = its plan id, and a cell on EVERY row', () => {
      for (const [cohort, view] of cohortViews()) {
        expect(view.kind).toBe('cohort');
        expect(view.comparison!.current).toEqual({ planId: cohort });
        // The own plan never enters the tier columns.
        expect(view.comparison!.planIds).not.toContain(cohort);
        for (const row of rowsOf(view.comparison)) {
          expect(row.current).not.toBeNull();
          expect(row.current!.planId).toBe(cohort);
          expect(row.current!.highlight).toBe(false);
        }
      }
    });

    it("the own cells come from the ACCOUNT's resolution, not from a tier", () => {
      // The trial previews the lower tier but has its own (one-off) credits; the
      // Founding Partner has chat, which the lower tier lacks.
      const trial = viewFor('trial').comparison;
      expect(rowIn(trial, 'credits').current!.value).not.toBe(cellOf(trial, 'credits', lowTier).value);
      const champion = viewFor('champion').comparison;
      expect(rowIn(champion, 'chat').current!.included).toBe(true);
      expect(cellOf(champion, 'chat', lowTier).included).toBe(false);
    });

    it('a dated Founding Partner gets the same own column as an open-ended one', () => {
      const dated = buildCustomerPlanView({
        resolution: resolveEntitlements({
          config,
          account: { ...previewAccountFor(config, 'champion', NOW), cohortExpiresAt: '2026-12-01T00:00:00.000Z' },
          overrides: [],
          addons: [],
          now: NOW,
        }),
        unavailable: false,
        now: NOW,
        config,
      });
      expect(dated.comparison).toEqual(viewFor('champion').comparison);
    });

    it('buildPlanComparison with no `current` is unchanged (own column null everywhere)', () => {
      const comparison = buildPlanComparison({ config, locale: 'en', now: NOW });
      expect(comparison.current).toBeNull();
      expect(comparison).toEqual(viewFor('basic').comparison);
    });
  });

  it('shows the plans AS DEFINED: an override on the account does not change its column', () => {
    // An Essentials account an admin granted chat to. Its own resolution has chat;
    // the Essentials column must still show ✕ — the table describes the plan.
    const resolution = resolveEntitlements({
      config,
      account: previewAccountFor(config, lowTier, NOW),
      overrides: [
        {
          id: 'override-1',
          capability: 'chat.access',
          op: 'set',
          value: true,
          expiresAt: null,
          endedAt: null,
          createdAt: NOW.toISOString(),
        },
      ],
      addons: [],
      now: NOW,
    });
    // Non-vacuity: the override really did grant it on the account.
    expect(resolution.values['chat.access'].value).toBe(true);

    const view = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config });
    expect(cellOf(view.comparison, 'chat', lowTier).included).toBe(false);
    expect(view.comparison).toEqual(viewFor('basic').comparison);
  });

  it('is null on every non-ok path: unavailable, no record, and a basis of none', () => {
    for (const unavailable of [true, false]) {
      expect(buildCustomerPlanView({ resolution: null, unavailable, now: NOW, config }).comparison).toBeNull();
    }
    const none = resolveEntitlements({ config, account: null, overrides: [], addons: [], now: NOW });
    expect(none.basis.kind).toBe('none');
    expect(buildCustomerPlanView({ resolution: none, unavailable: false, now: NOW, config }).comparison).toBeNull();
  });

  describe('grouped rows (UM-D2)', () => {
    const labels = { en: 'Planted', he: 'נטוע', es: 'Plantado' };

    it('a row is ✓ only where the plan grants EVERY member', () => {
      const comparison = buildPlanComparison({
        config,
        locale: 'en',
        now: NOW,
        rows: [{ id: 'mixed', labels, capabilities: ['crm.core', 'chat.access'] }],
      });
      // The lower tier grants the CRM but not chat: the row is ✕ there, not ✓.
      expect(cellOf(comparison, 'mixed', lowTier).included).toBe(false);
      expect(cellOf(comparison, 'mixed', highTier).included).toBe(true);
    });

    it('a not_built member is dropped from the row; a row of only not_built members does not appear', () => {
      const comparison = buildPlanComparison({
        config,
        locale: 'en',
        now: NOW,
        rows: [
          { id: 'with_unbuilt', labels, capabilities: ['crm.core', 'marketing.mass_email'] },
          { id: 'only_unbuilt', labels, capabilities: ['marketing.posts', 'addon.mobile'] },
        ],
      });
      expect(cellOf(comparison, 'with_unbuilt', lowTier).included).toBe(true);
      expect(rowsOf(comparison).map((row) => row.row)).not.toContain('only_unbuilt');
    });

    it('a row no shown plan grants any member of does not appear (no all-cross row)', () => {
      // The fixture's two shown tiers both withhold multi-currency, a real
      // (available) capability: the row must be dropped, not shown as all cross.
      const fixture = fixtureConfig();
      const comparison = buildPlanComparison({
        config: fixture,
        locale: 'en',
        now: NOW,
        rows: [
          { id: 'nobody_has_it', labels, capabilities: ['payments.multi_currency'] },
          { id: 'everybody_has_it', labels, capabilities: ['crm.core'] },
        ],
      });
      const ids = rowsOf(comparison).map((row) => row.row);
      expect(ids).toContain('everybody_has_it');
      expect(ids).not.toContain('nobody_has_it');
      // Nor does it come back as a fallback row: it is placed, just granted by nobody.
      expect(ids).not.toContain('payments.multi_currency');
    });

    it('every visible, granted capability in no row becomes its own row, labelled from the catalog, at the end of its section', () => {
      /*
       * The dropped `leads` row carries TWO capabilities since 2026-10-25, when
       * the mailbox lead channel joined `marketing.lead_response` there. Both
       * are granted and visible, so dropping the row must produce TWO fallback
       * rows — and the assertion is on the set at the tail rather than on which
       * of them happens to be last, because their order between themselves is
       * incidental to the behaviour being covered.
       */
      const unplaced = PLAN_COMPARISON_ROWS.find((row) => row.id === 'leads')!.capabilities;
      expect(unplaced.length).toBeGreaterThan(1);

      const rows = PLAN_COMPARISON_ROWS.filter((row) => row.id !== 'leads');
      const comparison = buildPlanComparison({ config, locale: 'en', now: NOW, rows });
      const section = comparison.sections.find((candidate) => candidate.section === 'run_business')!;

      const tail = section.rows.slice(-unplaced.length);
      expect(tail.map((row) => row.row).sort()).toEqual([...unplaced].sort());
      for (const row of tail) {
        expect(row.label).toBe(catalog[row.row as keyof typeof catalog].labels.en);
      }

      // And the production config places them, so no fallback reaches a customer.
      const shipped = rowsOf(viewFor('basic').comparison).map((row) => row.row);
      for (const capability of unplaced) expect(shipped).not.toContain(capability);
    });
  });

  describe('values and the highlight', () => {
    it('production: credits highlights the larger plan only; emails (equal) and team (two members) highlight nothing', () => {
      const comparison = viewFor('basic').comparison;
      expect(cellOf(comparison, 'credits', highTier).highlight).toBe(true);
      expect(cellOf(comparison, 'credits', lowTier).highlight).toBe(false);
      for (const id of ['emails', 'team']) {
        expect(rowIn(comparison, id).cells.every((cell) => !cell.highlight)).toBe(true);
      }
      // Feature rows never highlight.
      expect(rowIn(comparison, 'chat').cells.every((cell) => !cell.highlight)).toBe(true);
    });

    it('amount cells carry the bare figure in the reader\'s grouping; feature cells carry none', () => {
      const amount = (locale: 'en' | 'he' | 'es', planId: string) => {
        const resolution = resolveEntitlements({ config, account: previewAccountFor(config, 'basic', NOW), overrides: [], addons: [], now: NOW });
        return cellOf(buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config, locale }).comparison, 'credits', planId).value;
      };
      const perMonth = (planId: string) =>
        (resolveEntitlements({ config, account: previewAccountFor(config, planId, NOW), overrides: [], addons: [], now: NOW })
          .values['credits.allowance'].value as { perMonth: number }).perMonth;

      for (const planId of shownTiers) {
        expect(amount('en', planId)).toBe(new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(perMonth(planId)));
        expect(amount('es', planId)).toBe(new Intl.NumberFormat('es', { maximumFractionDigits: 0 }).format(perMonth(planId)));
        expect(amount('he', planId)).toBe(new Intl.NumberFormat('he', { maximumFractionDigits: 0 }).format(perMonth(planId)));
        // A bare figure: no "per month" wording in a cell.
        expect(amount('en', planId)).toMatch(/^[\d,]+$/);
      }
      // Two members: both figures, in config order.
      expect(cellOf(viewFor('basic').comparison, 'team', lowTier).value).toBe('1 · 1');
      // Feature rows: ✓ / ✕ only.
      for (const row of rowsOf(viewFor('basic').comparison).filter((candidate) => candidate.section !== 'included')) {
        expect(row.cells.every((cell) => cell.value === null)).toBe(true);
      }
    });

    it('a one-off total keeps its full wording, and unlike units highlight nothing', () => {
      const mixed = withTierValues(config, { [lowTier]: { 'credits.allowance': { total: 99999 } } });
      const comparison = buildPlanComparison({ config: mixed, locale: 'en', now: NOW });
      expect(cellOf(comparison, 'credits', lowTier).value).toMatch(/in total/);
      expect(rowIn(comparison, 'credits').cells.every((cell) => !cell.highlight)).toBe(true);
    });

    it('a ✕ amount cell carries no value and no highlight', () => {
      const none = withTierValues(config, { [lowTier]: { 'credits.allowance': { perMonth: 0 } } });
      const cell = cellOf(buildPlanComparison({ config: none, locale: 'en', now: NOW }), 'credits', lowTier);
      expect(cell).toEqual({ planId: lowTier, included: false, value: null, highlight: false });
    });

    it('three columns: the strict top is highlighted; a tie at the top highlights nothing', () => {
      const three = withShown(fixtureConfig(), 'pro');
      const top = buildPlanComparison({ config: three, locale: 'en', now: NOW });
      expect(top.planIds).toEqual(['basic', 'growth', 'pro']);
      expect(rowIn(top, 'credits').cells.map((cell) => cell.highlight)).toEqual([false, false, true]);

      const tie = withTierValues(three, { growth: { 'credits.allowance': { perMonth: 2000 } } });
      expect(rowIn(buildPlanComparison({ config: tie, locale: 'en', now: NOW }), 'credits').cells.every((cell) => !cell.highlight)).toBe(
        true
      );
    });
  });

  describe('labels and sections', () => {
    it('row labels are the config labels in each of the three languages', () => {
      for (const locale of ['en', 'he', 'es'] as const) {
        const resolution = resolveEntitlements({ config, account: previewAccountFor(config, 'basic', NOW), overrides: [], addons: [], now: NOW });
        const comparison = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config, locale }).comparison;
        const rendered = rowsOf(comparison);
        expect(rendered.length).toBe(PLAN_COMPARISON_ROWS.length);
        for (const row of rendered) {
          expect(row.label).toBe(PLAN_COMPARISON_ROWS.find((candidate) => candidate.id === row.row)!.labels[locale]);
        }
      }
    });

    it('production: three sections in order, keyed by plan.comparison.section.*', () => {
      const sections = viewFor('basic').comparison!.sections;
      expect(sections.map((section) => section.section)).toEqual(SECTION_PRESENTATION.map((entry) => entry.section));
      for (const section of sections) expect(section.labelKey).toMatch(/^plan\.comparison\.section\./);
    });

    it('amount rows sit only under "included", chat rows only under "ai_assistant" (derived from shape and category)', () => {
      const rendered = rowsOf(viewFor('basic').comparison);
      const membersOf = (id: string) => PLAN_COMPARISON_ROWS.find((row) => row.id === id)!.capabilities;
      for (const row of rendered) {
        const members = membersOf(row.row);
        const isAmount = members.every((capability) => ['metered', 'fair_use', 'quantity'].includes(catalog[capability].shape.kind));
        if (isAmount) expect(row.section).toBe('included');
        else expect(row.section).not.toBe('included');
        if (members.every((capability) => catalog[capability].category === 'ai_chat')) expect(row.section).toBe('ai_assistant');
      }
      expect(rendered.filter((row) => row.section === 'included').map((row) => row.row)).toEqual(['credits', 'emails', 'team']);
    });
  });
});

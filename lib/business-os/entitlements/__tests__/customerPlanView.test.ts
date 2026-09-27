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
  comparableAmount,
  isHiddenFromCustomer,
} from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { fixtureConfig } from '@/lib/business-os/entitlements/__fixtures__/fixtureSource';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';

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

    expect(view.included).toHaveLength(visibleCapabilities.length);
    expect(visibleCapabilities.length).toBeGreaterThan(10);
  });

  it('is offered NOTHING above it, because it already has the top plan in full', () => {
    // This assertion inverted with parity (user decision, 2026-09-27). It briefly
    // read "is offered Autopilot for the ONE thing it adds": champions inherited
    // Autopilot's features but `CHAMPION_VALUES` pinned `ai.actions` at 1,000
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
    expect(view.whenThisChanges).toMatch(/paid monthly plan/i);
  });

  it('is told what a paid plan is, so the day it changes is not the first they hear of it', () => {
    expect(view.whenThisChanges).toMatch(/no end date/i);
    expect(view.whenThisChanges).toMatch(/paid monthly plan/i);
    // And that nothing happens without them.
    expect(view.whenThisChanges).toMatch(/tell you first/i);
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
    expect(view.whenThisChanges).not.toMatch(/no end date/i);
  });

  it('says what happens next, and that nothing is charged without a choice', () => {
    expect(view.whenThisChanges).toMatch(/choose a paid monthly plan/i);
    expect(view.whenThisChanges).toMatch(/Nothing is charged before you choose/i);
  });

  it('is still free until then, and still has everything', () => {
    expect(view.free).toBe(true);
    expect(view.monthlyPriceUsd).toBe(0);
    expect(view.included.length).toBeGreaterThan(10);
  });
});

describe('a trial (Test Flight)', () => {
  const view = viewFor('trial');

  it('is told when it ends, in days read off the configuration', () => {
    expect(view.name).toBe('Test Flight');
    expect(view.free).toBe(true);
    expect(view.accessEndsAt).not.toBeNull();
    // Not a hard-coded 14: the sentence is read off `durationHistory`, so
    // shortening the trial in config changes what the customer is told.
    expect(view.endsWhen).toMatch(/\d+ days from/);
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

  it('IS told the AI allowance changes, as a change rather than an improvement', () => {
    // User decision 4. The trial has `{ total: 250 }` and Essentials
    // `{ perMonth: 500 }` — different quantities with no honest exchange rate. So
    // it is neither claimed as an improvement nor suppressed: it is stated, with
    // both numbers, and the customer judges.
    const changed = view.nextPlanUp?.changes ?? [];

    expect(changed.map((entry) => entry.capability)).toContain('ai.actions');

    const aiChange = changed.find((entry) => entry.capability === 'ai.actions')!;
    expect(aiChange.from).toContain('in total');
    expect(aiChange.to).toContain('per month');

    // And NOT in `improves`, which is the list that asserts a direction.
    expect(view.nextPlanUp?.improves.map((entry) => entry.capability) ?? []).not.toContain('ai.actions');
  });

  it('is NOT told the AI allowance IMPROVES — the units do not match (SA P-2)', () => {
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

    expect(improved).not.toContain('ai.actions');
  });

  it('is promised nothing is charged before they choose', () => {
    expect(view.whenThisChanges).toMatch(/Nothing is charged before you choose/i);
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
    // The two paid tiers differ in exactly two things, and since 2026-09-27 the
    // customer is told about both: the chat capabilities Autopilot adds, and the
    // larger AI allowance.
    expect(view.nextPlanUp?.improves.map((entry) => entry.capability)).toEqual(['ai.actions']);
    expect(view.nextPlanUp?.adds.map((feature) => feature.capability)).toContain('chat.access');
    expect(view.nextPlanUp?.adds.length).toBeGreaterThanOrEqual(9);
  });

  it('Essentials cannot be left by pressing anything yet', () => {
    const view = viewFor('basic');

    expect(view.nextPlanUp?.availableToBuy).toBe(false);
    // The 'Coming soon' wording lives in the badge the component renders; the
    // payload carries the invitation, so the two are not the same string twice.
    expect(view.nextPlanUp?.actionUnavailableBecause).toMatch(/get in touch/i);
  });

  it('Autopilot is told there is nothing above it, rather than shown an empty offer', () => {
    const view = viewFor('pro');

    expect(view.name).toBe('Autopilot');
    expect(view.nextPlanUp).toBeNull();
  });

  it('never compares a one-off total against a monthly rate (SA P-2)', () => {
    // The trial gives `{ total: 250 }` AI actions and Essentials gives
    // `{ perMonth: 500 }`. Those are different quantities with no honest
    // exchange rate, so the first version compared 250 against 500 and got the
    // right answer by luck. Invert them and it would have announced a reduction
    // as a step up — the defect one level deeper.
    //
    // Asserted through a fixture whose numbers are the wrong way round: a
    // 2,000-action one-off trial against a 500-a-month plan. The rule must stay
    // SILENT about `ai.actions` rather than claim either direction.
    const invertedTrial = {
      ...config,
      matrix: {
        ...config.matrix,
        tiers: {
          ...config.matrix.tiers,
          basic: { ...config.matrix.tiers.basic, 'ai.actions': { perMonth: 500 } },
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
          values: { ...config.cohorts.trial.values, 'ai.actions': { total: 2000 } },
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
    expect(resolution.values['ai.actions'].value).toEqual({ total: 2000 });

    const view = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config: invertedTrial });

    // Silence about the one capability whose units do not match, rather than a
    // confident wrong claim in either direction.
    expect(view.nextPlanUp?.improves.map((entry) => entry.capability) ?? []).not.toContain('ai.actions');
    expect(view.nextPlanUp?.adds.map((feature) => feature.capability) ?? []).not.toContain('ai.actions');

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
            pro: { ...config.matrix.tiers.pro, 'team.seats': { included: 1, purchasable: true } },
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
      expect(view.nextPlanUp?.improves.map((entry) => entry.capability) ?? []).toContain('ai.actions');
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
 * shown-and-not-buyable, so both branches were invisible.
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
    expect(view.nextPlanUp?.actionUnavailableBecause).toMatch(/get in touch/i);
  });
});

describe('when there is no answer', () => {
  it('a failed read is NOT "you have no plan"', () => {
    // The S-0 lesson, one product away: "we could not check" and "there is
    // nothing" must never look the same. Here it matters because the second one
    // would frighten a paying customer.
    const view = buildCustomerPlanView({ resolution: null, unavailable: true, now: NOW, config });

    expect(view.status).toBe('unavailable');
    expect(view.problem).toMatch(/could not load/i);
    expect(view.problem).toMatch(/Nothing has changed/i);
    expect(view.included).toEqual([]);
    expect(view.name).toBeNull();
  });

  it('a missing plan record says so, and says the product still works', () => {
    const view = buildCustomerPlanView({ resolution: null, unavailable: false, now: NOW, config });

    expect(view.status).toBe('no_plan_record');
    expect(view.problem).toMatch(/do not have a plan record/i);
    expect(view.problem).toMatch(/keeps working/i);
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
        ...view.included.map((feature) => feature.capability),
        ...(view.nextPlanUp?.adds ?? []).map((feature) => feature.capability),
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

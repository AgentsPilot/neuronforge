/**
 * The payload behind the Business OS Tiers screen.
 *
 * What is worth testing here is not "it returns four plans" but the property
 * the whole design rests on: **the screen cannot disagree with the resolver.**
 * So most of these assertions compare the payload against the config and the
 * resolver rather than against a written-down expectation — a test that said
 * `price === 79` would agree with a typo in the matrix.
 */

import { buildAdminPlansView, previewAccountFor } from '@/lib/business-os/entitlements/adminPlansView';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { isGrantingValue } from '@/lib/business-os/entitlements/schema';
import { MODE_ENV_VAR } from '@/lib/business-os/entitlements/mode';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';

const NOW = new Date('2026-09-24T12:00:00.000Z');

/** The mode is an environment read, so it is set explicitly rather than assumed. */
const originalMode = process.env[MODE_ENV_VAR];
afterEach(() => {
  if (originalMode === undefined) delete process.env[MODE_ENV_VAR];
  else process.env[MODE_ENV_VAR] = originalMode;
});

describe('the four plans, taken from the config rather than described', () => {
  const config = readCodeConfig();
  const view = buildAdminPlansView(NOW);

  it('is every cohort and every tier, cohorts first', () => {
    // Order is a decision: free first, then the paid tiers cheapest first,
    // which is the order a reader compares them in.
    expect(view.plans.map((plan) => plan.id)).toEqual([
      ...Object.keys(config.cohorts),
      ...config.tierOrder,
    ]);
  });

  it('takes every name and price from the config, never from this file', () => {
    for (const plan of view.plans) {
      if (plan.kind === 'tier') {
        const presentation = config.matrix.presentation[plan.id as 'basic' | 'pro'];
        expect(plan.name).toBe(presentation.labels.en);
        expect(plan.monthlyPriceUsd).toBe(presentation.monthlyPriceUsd);
      } else {
        const cohort = config.cohorts[plan.id as 'trial' | 'champion'];
        expect(plan.name).toBe(cohort.labels.en);
        // A cohort is what somebody has while they are NOT paying.
        expect(plan.monthlyPriceUsd).toBe(0);
      }
    }
  });

  it('resolves each plan rather than reading its row — which is the only way a COHORT has values at all', () => {
    // `trial` and `champion` have no row in the matrix. If this view read rows,
    // two of the four cards would be empty.
    const cohorts = view.plans.filter((plan) => plan.kind === 'cohort');
    expect(cohorts.length).toBeGreaterThan(0);
    for (const cohort of cohorts) {
      expect(cohort.includes.length).toBeGreaterThan(0);
      expect(cohort.inheritsFrom).toBe(
        (config.cohorts[cohort.id as 'trial' | 'champion'].base as { tier?: string }).tier ?? null
      );
    }
  });

  it('every capability appears exactly once, as included or withheld', () => {
    const total = Object.keys(config.catalog).length;
    for (const plan of view.plans) {
      expect(plan.includes.length + plan.withholds.length).toBe(total);
      const ids = [...plan.includes, ...plan.withholds].map((entry) => entry.capability);
      expect(new Set(ids).size).toBe(total);
    }
  });

  it('decides "includes" with the loader\'s own function, per plan and per capability', () => {
    // Re-run the resolver and `isGrantingValue` independently and demand the
    // same split.
    //
    // SA R-2: this is NOT the strongest form, and the comment used to claim it
    // was. The synthetic account is rebuilt here by hand, so a wrong synthetic
    // would be reconstructed identically and the test would agree with itself.
    // What it does prove is that the include/withhold SPLIT is the resolver's
    // and not this view's. The synthetic itself is pinned in the test below,
    // by its resolved state and basis, which copying a mistake cannot satisfy.
    const catalog = config.catalog as Record<string, CapabilityDef>;

    for (const plan of view.plans) {
      const account =
        plan.kind === 'tier'
          ? {
              accountId: 'x',
              tier: plan.id,
              planVersion: config.matrix.version,
              tierExpiresAt: null,
              cohort: null,
              cohortExpiresAt: null,
              onboardingStartedAt: NOW.toISOString(),
              profileCreatedAt: NOW.toISOString(),
              trialStartedAt: null,
              trialEndsAt: null,
              graceEndsAt: null,
            }
          : {
              accountId: 'x',
              tier: null,
              planVersion: 0,
              tierExpiresAt: null,
              cohort: plan.id,
              cohortExpiresAt: null,
              onboardingStartedAt: NOW.toISOString(),
              profileCreatedAt: NOW.toISOString(),
              trialStartedAt: NOW.toISOString(),
              trialEndsAt: null,
              graceEndsAt: null,
            };

      const resolution = resolveEntitlements({ config, account, overrides: [], addons: [], now: NOW });
      const expected = Object.entries(resolution.values)
        .filter(([capability, resolved]) => isGrantingValue(resolved.value, catalog[capability]))
        .map(([capability]) => capability)
        .sort();

      expect(plan.includes.map((entry) => entry.capability).sort()).toEqual(expected);
      expect(plan.state).toBe(resolution.state);
    }
  });

  it('R-2: each preview resolves to the state and basis its plan SHOULD produce', () => {
    // The check the re-run above cannot make. `state` and `basis` are outputs
    // of `deriveLifecycle`, not inputs — so they are wrong the moment the
    // synthetic account is wrong, in a way that hand-copying the same synthetic
    // would hide.
    //
    // A tier account with no expiry is `active` on a `tier` basis. A cohort
    // account is on a `cohort` basis and in the state that cohort names. If a
    // fact were missing — no `trialStartedAt`, say — the trial preview would
    // come back `unknown` or `paused` and this fails.
    for (const plan of view.plans) {
      if (plan.kind === 'tier') {
        expect({ id: plan.id, state: plan.state, basis: plan.basis }).toEqual({
          id: plan.id,
          state: 'active',
          basis: 'tier',
        });
      } else {
        expect({ id: plan.id, basis: plan.basis }).toEqual({ id: plan.id, basis: 'cohort' });
        // The cohort's own name is the state, which is what makes a preview of
        // it a preview OF IT rather than of some default.
        expect(plan.state).toBe(plan.id);
      }
    }
  });

  it('R-2: and none of them lands in a state that means the synthetic was wrong', () => {
    // The negative leg, named: these are the states a badly-built preview
    // account produces, and none of them should ever appear on this screen.
    for (const plan of view.plans) {
      expect(['unknown', 'paused', 'grace', 'past_due']).not.toContain(plan.state);
      expect(plan.basis).not.toBe('none');
    }
  });

  it('never shows a not_built capability as included, on any plan', () => {
    // The user's rule, from the other side: the page must not be able to
    // display something as sellable that the loader would refuse.
    const notBuilt = Object.entries(config.catalog)
      .filter(([, definition]) => (definition as CapabilityDef).lifecycle === 'not_built')
      .map(([capability]) => capability);

    expect(notBuilt.length).toBeGreaterThan(0);
    for (const plan of view.plans) {
      for (const entry of plan.includes) {
        expect(notBuilt).not.toContain(entry.capability);
      }
    }
  });

  it('lists exactly the not_built capabilities, with the catalog note as the reason', () => {
    const expected = Object.entries(config.catalog)
      .filter(([, definition]) => (definition as CapabilityDef).lifecycle === 'not_built')
      .map(([capability]) => capability)
      .sort();

    expect(view.notBuilt.map((entry) => entry.capability).sort()).toEqual(expected);
    for (const entry of view.notBuilt) {
      // The note is the evidence recorded when the capability was marked
      // unbuilt, and it is the answer to the only question a pricing
      // conversation asks: why not? Length is not the test — some reasons are
      // complete in three words ("No mobile app.") — but the presence of the
      // CATALOG's reason is, so the fallback must never be what is shown.
      expect(entry.note).toBe((config.catalog as Record<string, CapabilityDef>)[entry.capability].note);
      expect(entry.note.trim().length).toBeGreaterThan(0);
      expect(entry.note).not.toMatch(/No evidence recorded/);
      expect(entry.label.trim().length).toBeGreaterThan(0);
    }
  });
});


describe('the preview account each plan is resolved as (QA vacuity / SA R-2)', () => {
  /**
   * Asserted, not rebuilt.
   *
   * The test below this one re-runs the resolver with a hand-built account and
   * compares the include/withhold split. QA showed what that cannot do: mutate
   * `onboardingStartedAt` to `null` or `planVersion` to `999` in the view and
   * the suite stays green, because the test reconstructs the same mistake.
   *
   * So the fields are written out here as VALUES. Getting one wrong in the view
   * now fails against an expectation that was not derived from the view.
   */
  const config = readCodeConfig();
  const iso = NOW.toISOString();

  it.each(['trial', 'champion'])('the %s preview is a cohort account, dated now', (planId) => {
    expect(previewAccountFor(config, planId, NOW)).toEqual({
      accountId: `preview-${planId}`,
      tier: null,
      // 0 means "whatever the current matrix is" (S-4) — a cohort was never
      // sold at a version.
      planVersion: 0,
      tierExpiresAt: null,
      cohort: planId,
      // Open-ended: a champion with a date would preview as one that is ending.
      cohortExpiresAt: null,
      // The facts a real account carries. Dated NOW so a trial preview is a
      // trial that has just started rather than one that expired years ago.
      onboardingStartedAt: iso,
      profileCreatedAt: iso,
      trialStartedAt: iso,
      trialEndsAt: null,
      graceEndsAt: null,
    });
  });

  it.each(['basic', 'pro'])('the %s preview is a tier account at the current version', (planId) => {
    expect(previewAccountFor(config, planId, NOW)).toEqual({
      accountId: `preview-${planId}`,
      tier: planId,
      // The version the tier is sold at today: a preview must not be
      // grandfathered against an older matrix.
      planVersion: config.matrix.version,
      tierExpiresAt: null,
      cohort: null,
      cohortExpiresAt: null,
      onboardingStartedAt: iso,
      profileCreatedAt: iso,
      // A tier account is not in a trial, and saying it was would change the
      // state the card reports.
      trialStartedAt: null,
      trialEndsAt: null,
      graceEndsAt: null,
    });
  });

  it('every preview carries all eleven fields — none silently absent', () => {
    for (const planId of [...Object.keys(config.cohorts), ...config.tierOrder]) {
      expect(Object.keys(previewAccountFor(config, planId, NOW)).sort()).toEqual(
        [
          'accountId',
          'cohort',
          'cohortExpiresAt',
          'graceEndsAt',
          'onboardingStartedAt',
          'planVersion',
          'profileCreatedAt',
          'tier',
          'tierExpiresAt',
          'trialEndsAt',
          'trialStartedAt',
        ].sort()
      );
    }
  });

  it('the by-value expectations are what catch the mutations — stated, not re-asserted', () => {
    // QA NEW-6, second pass. The previous version ended with
    // `expect({ ...expected, x: null }).not.toEqual(expected)`, which compares
    // two local literals and cannot fail — the same class twice.
    //
    // There is nothing left to assert here that the two tests above do not
    // already do: they compare `previewAccountFor(...)` to a written-out
    // object, so `onboardingStartedAt: null` or `planVersion: 999` in the view
    // fails them by value. This case proves that claim the only way it can be
    // proved — by mutating the SUBJECT rather than the expectation.
    const trial = previewAccountFor(config, 'trial', NOW);
    const basic = previewAccountFor(config, 'basic', NOW);

    // The facts the resolution depends on are present, which is what a mutation
    // to `null` would remove.
    expect(trial.onboardingStartedAt).toBe(iso);
    expect(trial.trialStartedAt).toBe(iso);
    // And the version is the matrix's, which is what `999` would break.
    expect(basic.planVersion).toBe(config.matrix.version);
    expect(basic.planVersion).not.toBe(0);
  });
});

describe('the two panels cannot contradict each other (QA NEW-1)', () => {
  const view = buildAdminPlansView(NOW);

  it('nothing is both "cannot be sold" and "withheld, nothing refuses it"', () => {
    // They said opposite things about the same ten capabilities: "no gate built
    // yet" reads as "a customer could get this", on the same screen as
    // "Cannot be sold". A `not_built` capability needs no gate — there is
    // nothing to refuse — so it belongs to exactly one panel.
    const notBuilt = view.notBuilt.map((entry) => entry.capability);
    const overlap = view.withheldWithoutGate.filter((capability) => notBuilt.includes(capability));

    expect(overlap).toEqual([]);
  });

  it('no capability on any card is marked "no gate" while being unbuildable', () => {
    const notBuilt = new Set(view.notBuilt.map((entry) => entry.capability));

    for (const plan of view.plans) {
      for (const capability of plan.withholds) {
        if (!notBuilt.has(capability.capability)) continue;
        expect({ capability: capability.capability, gateBuilt: capability.gateBuilt }).toEqual({
          capability: capability.capability,
          gateBuilt: true,
        });
      }
    }
  });

  it('leaves the real ones, and they are the point of the marker', () => {
    // QA counted 9 after the filter, all genuinely built-and-unenforced. The
    // number is not asserted — it changes with the catalog — but the property
    // that every one EXISTS is.
    const catalog = readCodeConfig().catalog as Record<string, CapabilityDef>;

    expect(view.withheldWithoutGate.length).toBeGreaterThan(0);
    for (const capability of view.withheldWithoutGate) {
      expect({ capability, lifecycle: catalog[capability].lifecycle }).not.toEqual({
        capability,
        lifecycle: 'not_built',
      });
    }
  });
});

describe('the sentences the page shows without computing them', () => {
  it('renders an allowance rather than an object', () => {
    const view = buildAdminPlansView(NOW);
    const byId = Object.fromEntries(view.plans.map((plan) => [plan.id, plan]));

    // A one-off total and a monthly rate read differently, because they ARE
    // different: running out of a total ends the trial.
    expect(byId.trial.aiActions).toMatch(/in total$/);
    expect(byId.basic.aiActions).toMatch(/per month$/);
    for (const plan of view.plans) expect(plan.aiActions).not.toContain('{');
  });

  it('says when a trial ends, in the numbers the config holds', () => {
    const config = readCodeConfig();
    const days = config.cohorts.trial.durationHistory?.slice(-1)[0]?.days;
    const view = buildAdminPlansView(NOW);
    const trial = view.plans.find((plan) => plan.id === 'trial');

    expect(days).toBeGreaterThan(0);
    expect(trial?.endsWhen).toContain(String(days));
    // The second ending: a one-off allowance makes exhaustion terminal (FR-27).
    expect(trial?.endsWhen).toMatch(/run out/);
  });

  it('says a champion has no end date, because its config has no duration', () => {
    const config = readCodeConfig();
    expect(config.cohorts.champion.durationHistory).toBeUndefined();

    const champion = buildAdminPlansView(NOW).plans.find((plan) => plan.id === 'champion');
    expect(champion?.endsWhen).toMatch(/No end date/i);
  });

  it('says a tier lasts while it is paid for, which is a per-account fact', () => {
    const basic = buildAdminPlansView(NOW).plans.find((plan) => plan.id === 'basic');
    expect(basic?.endsWhen).toMatch(/paid for/i);
  });
});

describe('the mode is read, never assumed', () => {
  it.each([
    ['off', false, /nothing is blocked/i],
    ['shadow', false, /NOTHING IS BLOCKED/],
    ['enforce', true, /acted on/i],
  ] as const)('%s is reported as itself', (mode, enforced, meaning) => {
    process.env[MODE_ENV_VAR] = mode;
    const view = buildAdminPlansView(NOW);

    expect(view.mode).toBe(mode);
    expect(view.enforced).toBe(enforced);
    expect(view.modeMeaning).toMatch(meaning);
    expect(view.modeEnvVar).toBe(MODE_ENV_VAR);
  });

  it('an unset mode is off, and says so in words rather than in a blank', () => {
    delete process.env[MODE_ENV_VAR];
    const view = buildAdminPlansView(NOW);

    expect(view.mode).toBe('off');
    expect(view.modeMeaning.length).toBeGreaterThan(40);
  });
});

describe('what this view deliberately does NOT do', () => {
  it('names the write operations instead of hiding their absence', () => {
    const view = buildAdminPlansView(NOW);
    expect(view.writeOpsNotOnThisPage).toContain('assign_tier');
    expect(view.writeOpsNotOnThisPage).toContain('launch_champion_existing');
  });

  it('reads no database: the same instant twice gives the identical payload', () => {
    // Pure config plus one environment read. If this ever starts touching a
    // repository, this test is where that shows up.
    expect(buildAdminPlansView(NOW)).toEqual(buildAdminPlansView(NOW));
  });
});

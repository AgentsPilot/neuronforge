/**
 * The customer surface never asserts what their CURRENT plan excludes.
 *
 * ── What replaced the chat suppression, and why this is the better rule ──────
 * There was a broader rule here: say nothing about chat at all. It existed
 * because the plans withheld chat while **nothing enforced it**, so naming it
 * would have advertised a restriction that did not exist. Chat is now available
 * to everyone and in testing, which removed that reason, and
 * `customerPlanView.chat.test.ts` was deleted in the same commit as the change —
 * per that file's own instruction.
 *
 * This is the narrower rule that was kept, and it is the sharper one:
 *
 *   **the surface lists what a plan INCLUDES, and never renders a list of what
 *   the customer does not have.**
 *
 * Three reasons it outlives the other:
 *
 *   1. A withheld capability is "no" for incompatible reasons — the plan says
 *      no, or nobody built it — and the customer cannot tell which. "Excluded"
 *      that means "does not exist" is a support ticket; "excluded" that means
 *      "we have not written the gate" is worse.
 *   2. It survives enforcement landing. When FR-46 ships, "your plan excludes
 *      chat" becomes TRUE — and still a worse way to describe a plan than a list
 *      of what it includes.
 *   3. It costs nothing. There is no field to render an exclusion list from, so
 *      the rule is structural rather than a habit.
 *
 * ── What it deliberately does NOT forbid ────────────────────────────────────
 * `nextPlanUp.adds` names capabilities the current plan lacks — "Autopilot would
 * add chat". That is a statement about the plan above, true in both directions,
 * and the whole point of showing it. The rule is about a bare "you do not have
 * X" presented as a property of the customer's own plan.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md §6.5 WS-2
 */

import { buildCustomerPlanView, isHiddenFromCustomer } from '@/lib/business-os/entitlements/customerPlanView';
import { previewAccountFor } from '@/lib/business-os/entitlements/planPresentation';
import { resolveEntitlements } from '@/lib/business-os/entitlements/resolver';
import { readCodeConfig } from '@/lib/business-os/entitlements/source';
import type { CapabilityDef } from '@/lib/business-os/entitlements/types';

const NOW = new Date('2026-09-27T00:00:00.000Z');
const config = readCodeConfig();
const catalog = config.catalog as Record<string, CapabilityDef>;

const PLAN_IDS = ['champion', 'trial', 'basic', 'pro'];

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

describe('no plan is described by what it withholds', () => {
  it('there ARE withheld capabilities to stay quiet about', () => {
    // Non-vacuity first. On a matrix where every plan granted everything, every
    // assertion below would pass for the wrong reason.
    const essentials = resolveEntitlements({
      config,
      account: previewAccountFor(config, 'basic', NOW),
      overrides: [],
      addons: [],
      now: NOW,
    });

    const withheldAndReal = Object.entries(essentials.values).filter(
      ([capability, resolved]) =>
        resolved.value === false && catalog[capability].lifecycle !== 'not_built'
    );

    // Chat, on Essentials: real, withheld, and NOT enforced today.
    expect(withheldAndReal.length).toBeGreaterThan(0);
  });

  /**
   * The keys each object may have (QA-7).
   *
   * This was a six-name denylist, and QA defeated it by adding
   * `youDoNotHave: ['chat.access']` to the payload — all 54 tests passed. The
   * header claims the rule is STRUCTURAL, "there is no field to render an
   * exclusion list from", and a denylist cannot support that claim: it rules out
   * the names somebody thought of, and an exclusion field can be called anything.
   *
   * Reproduced before fixing: with `youDoNotHave` present, every denylist here
   * stayed green and only an exact-key-set assertion failed.
   *
   * Third time a denylist has been defeated in this slice's lineage — the
   * chat-v4 exemption, the no-write method check, and now this. Allow-lists by
   * default.
   */
  const VIEW_KEYS = [
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
  ].sort();

  const UPGRADE_KEYS = [
    'planId',
    'name',
    'monthlyPriceUsd',
    'availableToBuy',
    'actionUnavailableBecause',
    'adds',
    'improves',
    'changes',
  ].sort();

  it('carries no field that could hold an exclusion list, WHATEVER it is called', () => {
    for (const planId of PLAN_IDS) {
      const view = viewFor(planId);

      expect(Object.keys(view).sort()).toEqual(VIEW_KEYS);

      // The other object a page renders — and the one that gained a field this
      // round, which is exactly when an allow-list earns its keep.
      if (view.nextPlanUp) {
        expect(Object.keys(view.nextPlanUp).sort()).toEqual(UPGRADE_KEYS);
      }
    }
  });

  it('the allow-list rejects a field a denylist would have missed', () => {
    // The negative control, and the QA-7 finding in one line: an exclusion field
    // under a name nobody enumerated.
    const withExtra = { ...viewFor('basic'), youDoNotHave: ['chat.access'] };

    expect(Object.keys(withExtra).sort()).not.toEqual(VIEW_KEYS);
  });

  /**
   * Prose that tells a customer what they LACK (QA-8).
   *
   * Narrowed and widened in the same edit, because either alone makes this worse.
   *
   * The pattern was a bare list of phrases including `do not have`, and the loop
   * only covered the four real plans — where `problem` is always `null`. The
   * sentence list named `view.problem`, so it looked as though the failure states
   * were covered when they were not; and the obvious extension fails immediately
   * on *"We do not have a plan record for this account yet"*, which is good copy
   * about OUR records rather than a claim about the customer's plan. The next
   * person to widen the loop would have hit that false positive and weakened the
   * regex — the worst of the three outcomes.
   *
   * So the pattern now requires a second-person claim ABOUT A PLAN: "your plan
   * does not include", "you do not have", "not included in your plan". "We do not
   * have a plan record" does not match, and should not.
   */
  const planExclusionPhrasing = new RegExp(
    [
      // "your plan does not include X" / "your plan excludes X"
      String.raw`your plan (does not|doesn't|will not|won't) (include|cover|have)`,
      String.raw`your plan excludes`,
      // "you do not have X" / "you don't get X" / "you lack X"
      String.raw`\byou (do not|don't) (have|get)\b`,
      String.raw`\byou lack\b`,
      // "X is not included in your plan" / "not available on your plan"
      String.raw`not (included|available) (in|on) your`,
      String.raw`missing from your (plan|account)`,
    ].join('|'),
    'i'
  );

  it('says nothing that reads as a claim about what the customer lacks', () => {
    // Every sentence this module writes, across the four real plans AND the three
    // no-plan states — which is where `problem` is actually set.
    const sentencesOf = (view: ReturnType<typeof viewFor>) =>
      [view.endsWhen, view.whenThisChanges, view.problem, view.nextPlanUp?.actionUnavailableBecause]
        .filter((sentence): sentence is string => typeof sentence === 'string')
        .join(' | ');

    const views = [
      ...PLAN_IDS.map((planId) => viewFor(planId)),
      buildCustomerPlanView({ resolution: null, unavailable: true, now: NOW, config }),
      buildCustomerPlanView({ resolution: null, unavailable: false, now: NOW, config }),
    ];

    for (const view of views) {
      expect(sentencesOf(view)).not.toMatch(planExclusionPhrasing);
    }

    // Non-vacuity: the failure states really were included, and really do write a
    // sentence. Without this the two extra views could contribute nothing.
    expect(sentencesOf(views[views.length - 1])).toMatch(/plan record/i);
  });

  it('the phrasing rule catches plan claims and leaves honest copy alone', () => {
    // A negative control, and the QA-8 finding pinned: the first pattern would
    // have failed the third line here, which is a statement about OUR records.
    for (const claim of [
      'Your plan does not include chat',
      'AI chat assistant is not included in your plan',
      'You do not have the chat assistant',
      'Marketing analytics is missing from your plan',
    ]) {
      expect(claim).toMatch(planExclusionPhrasing);
    }

    for (const honest of [
      'We do not have a plan record for this account yet.',
      'Free — no end date',
      'Get in touch if you would like to move plan before then.',
      'We could not load your plan just now.',
    ]) {
      expect(honest).not.toMatch(planExclusionPhrasing);
    }
  });

  it('every capability it DOES name is one the plan grants', () => {
    // The positive form of the same rule: the included list is inclusions only,
    // so nothing withheld can arrive there and be read as a limitation.
    for (const planId of PLAN_IDS) {
      const resolution = resolveEntitlements({
        config,
        account: previewAccountFor(config, planId, NOW),
        overrides: [],
        addons: [],
        now: NOW,
      });
      const view = buildCustomerPlanView({ resolution, unavailable: false, now: NOW, config });

      for (const feature of view.included) {
        expect(resolution.values[feature.capability].value).not.toBe(false);
      }
    }
  });

  it('a capability that does not exist is named in neither direction', () => {
    // The second rule that survived: `not_built` is an absence, not a
    // restriction. It may not appear as included, nor as something the plan above
    // would add.
    for (const planId of PLAN_IDS) {
      const view = viewFor(planId);
      const named = [
        ...view.included.map((feature) => feature.capability),
        ...(view.nextPlanUp?.adds ?? []).map((feature) => feature.capability),
        ...(view.nextPlanUp?.improves ?? []).map((entry) => entry.capability),
        ...(view.nextPlanUp?.changes ?? []).map((entry) => entry.capability),
      ];

      for (const capability of named) {
        expect(isHiddenFromCustomer(capability, catalog[capability])).toBe(false);
        expect(catalog[capability].lifecycle).not.toBe('not_built');
      }
    }
  });

  it('chat IS named now — the suppression is gone, deliberately', () => {
    // Recorded here so the reversal is visible in the suite that replaced the
    // one enforcing it. Autopilot grants chat and says so; Essentials is told
    // what Autopilot would add.
    expect(viewFor('pro').included.map((feature) => feature.capability)).toContain('chat.access');
    expect(viewFor('basic').nextPlanUp?.adds.map((feature) => feature.capability)).toContain('chat.access');

    // ⚠️ And the accepted inaccuracy, asserted so nobody has to take it on
    // trust: an Essentials customer is shown chat under Autopilot and may infer
    // they do not have it. That is FALSE today — nothing enforces `chat.access`
    // — and becomes true when FR-46 ships. The user accepted it explicitly.
    expect(catalog['chat.access'].lifecycle).toBe('available');
  });
});

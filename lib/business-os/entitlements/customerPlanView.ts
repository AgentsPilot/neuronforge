import 'server-only';

/**
 * What a customer sees about their own plan, in their own settings.
 *
 * S-4a step 1: **read-only**. No buying, no upgrade button, no Stripe — those
 * are steps 2 to 4, and a section that offers a button it cannot honour is worse
 * than one that offers nothing.
 *
 * ── It resolves; it does not describe ───────────────────────────────────────
 * The current plan comes from `EntitlementService.getSnapshot` — the resolution
 * of the account's REAL row, through the same resolver the product calls. The
 * next plan up is a synthetic preview through `previewAccountFor`, the same way
 * the admin screen previews all four. Neither is a reading of the tier matrix:
 * a description of config is a second copy of it, and the copy is what goes
 * stale.
 *
 * ── TWO THINGS THIS MUST NOT SAY ────────────────────────────────────────────
 *
 * **1. What the customer's CURRENT plan excludes.** The rule that matters, and
 * the only structural one: the surface lists what a plan **includes** and never
 * renders a withheld list. There is no field to render one from.
 *
 * Why it is the sharp end: a withheld capability is "no" for two completely
 * different reasons — the plan says no, or nobody has built it — and for some of
 * them the plan says no while **nothing enforces it**, so the customer has it
 * anyway. "Excluded (but not really)" is not a sentence to put in front of
 * somebody's billing, and annotating it would mean explaining our roadmap on a
 * settings page. Listing only inclusions removes the whole class.
 *
 * It survives enforcement landing, which is why it is the rule that was kept:
 * however complete the gating becomes, a list of what you do not have is a worse
 * way to describe a plan than a list of what you do.
 *
 * (`nextPlanUp.adds` does name things the current plan lacks. That is a
 * statement about the plan above — "Autopilot would add X" — which is true in
 * both directions and is the point of showing it. Different from a bare "you do
 * not have X".)
 *
 * **2. Anything about a capability that does not exist.** A `not_built`
 * capability is not a feature the plan withholds; it is a feature nobody has.
 * Naming it invites "so how do I get it?", and the answer is "you cannot, from
 * any plan, at any price".
 *
 * ── Chat IS named, since 2026-09-27 ─────────────────────────────────────────
 * It used to be suppressed entirely, because the plans withheld it and nothing
 * enforced it — so naming it would have advertised a restriction that did not
 * exist. **Chat is now available to everyone and in testing**, which removes that
 * reason: the capability is real, the customer has it, and the only thing not yet
 * real is BUYING a plan. So it appears in the contents like anything else, and
 * the dedicated suppression — and `customerPlanView.chat.test.ts`, per that
 * file's own instruction — is gone in the same commit.
 *
 * ⚠️ The accepted consequence, recorded because it is a live inaccuracy: a trial
 * or Essentials customer now sees chat listed under Autopilot and may infer they
 * do not have it. **That is false today and becomes true when FR-46 ships.** The
 * user accepted it explicitly, on the grounds that chat is in testing.
 *
 * ── What a Founding Partner sees ────────────────────────────────────────────
 * "Founding Partner — free, no end date, everything included" (the user's
 * words). Honest, and provably so rather than by assertion: a champion resolves
 * through the **Autopilot** row since 2026-09-27, so once the unbuilt
 * capabilities are out of the picture there is nothing real left withheld. A test
 * holds that, so a future matrix that withheld something real would fail in CI
 * rather than in front of a customer.
 *
 * Their AI allowance is the one thing Autopilot has more of — 1,000 a month
 * against 2,000 — because `CHAMPION_VALUES` sets it explicitly and an explicit
 * cohort value wins over the tier row. So Autopilot is shown to them as the plan
 * above, honestly, with that single difference.
 *
 * The transition is written in now rather than later (`whenThisChanges`): a
 * champion is told their access has no end date **and** that a paid plan is what
 * a Business OS subscription normally is, so the day it changes is a conversation
 * and not a surprise.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md §6.5 WS-2
 */

import {
  describePlanCapabilities,
  describePlanEnding,
  planCommercialFlags,
  planLabel,
  planMonthlyPriceUsd,
  previewAccountFor,
  type PlanCapabilityRow,
} from './planPresentation';
import { resolveEntitlements } from './resolver';
import type { EntitlementResolution } from './resolver';
import { getEntitlementConfig, type EntitlementConfig } from './source';
import type { CapabilityDef, CapabilityValue } from './types';

/**
 * The capabilities this surface will not mention, as a predicate.
 *
 * One rule now: **a capability that does not exist is not mentioned**, in either
 * direction. It is an absence, not a restriction — nothing to buy and nothing to
 * ask about.
 *
 * The chat clause is gone (2026-09-27). Chat is available to everyone and in
 * testing, so naming it is honest; suppressing it was only ever right while the
 * plans withheld something nothing enforced.
 *
 * Exported so the test asserts the RULE rather than re-implementing it — a test
 * with its own copy of the filter passes when the filter is deleted.
 */
export function isHiddenFromCustomer(_capability: string, definition: CapabilityDef): boolean {
  return definition.lifecycle === 'not_built';
}

/**
 * A value as an amount **and the unit it is an amount of**.
 *
 * Used only to decide whether the plan above is actually BETTER at something.
 * `null` when there is nothing to rank — a variant like `unbranded` vs
 * `branded` has no arithmetic, and guessing a direction is how a customer is
 * told a plan improves something it does not.
 *
 * ── Why the unit travels with the number (SA P-2) ─────────────────────
 * The first version returned the first numeric key it found, so `{ total: 250 }`
 * and `{ perMonth: 500 }` were compared as 250 against 500. That happens to
 * read correctly for today's trial → Essentials step, by luck. Invert the
 * numbers — a 2,000-action one-off trial against a 500-a-month plan — and it
 * either suppresses a real upgrade or announces a reduction as a step up, which
 * is the defect this comparison was added to prevent, one level deeper.
 *
 * A one-off total and a monthly rate are not the same quantity and there is no
 * honest exchange rate between them, so unlike units produce **silence**.
 *
 * Presentation is not consulted: two values can render the same string, and two
 * different strings can be the same amount.
 *
 * Exported for its test (QA-3). Both conservative clauses — returning `null`
 * rather than `0` for something unrankable, and `<=` rather than `<` at the
 * comparison — are invisible from outside: a mutant returning `0` is inert
 * because `0 <= 0` is still silent, so it was safe **by accident** rather than by
 * test. This follows the precedent of `previewAccountFor`, which was exported for
 * the same reason after QA mutated it and nothing went red.
 */
export function comparableAmount(value: CapabilityValue | undefined): { unit: string; amount: number } | null {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return { unit: 'boolean', amount: value ? 1 : 0 };
  if (typeof value === 'number') return { unit: 'number', amount: value };

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of ['perMonth', 'total', 'ceilingPerMonth', 'included'] as const) {
      if (typeof record[key] === 'number') return { unit: key, amount: record[key] as number };
    }
  }

  return null;
}

/** One line in "what you have". */
export interface CustomerPlanFeature {
  capability: string;
  label: string;
  /** Already formatted server-side; the component renders the string. */
  value: string;
}

/** What moving up a plan would change, derived by resolving both. */
export interface CustomerPlanUpgrade {
  planId: string;
  name: string;
  monthlyPriceUsd: number;
  /**
   * May the customer act on this, and what to say when they cannot.
   *
   * Read from `presentation.availableToBuy` — the single switch. `false` means the
   * plan is presented with its action **visibly unavailable** and a reason, never
   * a dead button and never silence beside a price. WS-2 step 3 flips the flag;
   * nothing here changes with it.
   */
  availableToBuy: boolean;
  /** Plain words for why there is nothing to press. `null` when there is. */
  actionUnavailableBecause: string | null;
  /** Granted there, not here. */
  adds: CustomerPlanFeature[];
  /** Granted in both, worth more there — `from` → `to`. */
  improves: Array<{ capability: string; label: string; from: string; to: string }>;
  /**
   * Granted in both, DIFFERENT there, and not rankable — stated as a change.
   *
   * The trial's AI allowance is `{ total: 250 }` and Essentials' is
   * `{ perMonth: 500 }`. Those are different quantities with no honest exchange
   * rate, so calling it an improvement would be a claim we cannot support and
   * suppressing it hides the most important line on the page. It is reported as
   * a **change** — "250 in total becomes 500 per month" — which is exactly what
   * is true, and lets the customer judge.
   *
   * It also removes a hazard: whether a trial customer sees a paid plan at all
   * used to depend on at least one same-unit improvement happening to exist.
   */
  changes: Array<{ capability: string; label: string; from: string; to: string }>;
}

/**
 * ⚠️ There is deliberately no "nothing to show" sentence here (QA-2).
 *
 * There was one, and it was **unreachable**: it was set exactly when `adds` and
 * `improves` were both empty, and the caller keeps this object exactly when one
 * of them is non-empty. Two complements, so the field and the `<p>` rendering it
 * could never both exist — while its comment promised it distinguished "this
 * plan adds nothing" from "we could not work it out".
 *
 * The second of those never existed: `buildUpgrade` has no failure path. Rather
 * than invent a case to make a sentence reachable, the field is gone and the
 * signal is the one that was already true: **`nextPlanUp` is `null` when there is
 * nothing above this plan for this customer**, and for a free plan
 * `whenThisChanges` says what a paid plan is.
 *
 * ⚠️ One consequence, recorded rather than fixed here: whether a TRIAL customer
 * sees Essentials at all depends on at least one same-unit improvement existing
 * between the two (today, `email.volume`). If the only differences were
 * unlike-unit ones, P-2's silence would hide the paid plan from the customer who
 * most needs to see it. That is the same root cause as the P-2 thinness note in
 * `customerPlanView.test.ts`, and the same answer: a third, explicitly non-ranked
 * "what changes" list, which is a new customer-facing claim and therefore a
 * decision for SA and the user in step 2/3.
 */

export interface CustomerPlanView {
  /** `unavailable` is its own state: never rendered as "you have no plan". */
  status: 'ok' | 'no_plan_record' | 'unavailable';
  planId: string | null;
  name: string | null;
  kind: 'tier' | 'cohort' | null;
  monthlyPriceUsd: number | null;
  /** `true` for the cohorts: free is a fact about the plan, not a missing price. */
  free: boolean;
  /** The resolver's own word for the account's state. */
  state: string | null;
  /** ISO, or `null` when access has no end date. */
  accessEndsAt: string | null;
  /** When this plan ends, in a sentence, read off config. */
  endsWhen: string | null;
  /** Written for the cohorts: what happens when free access is not free. */
  whenThisChanges: string | null;
  included: CustomerPlanFeature[];
  /** `null` when there is nothing above this plan. */
  nextPlanUp: CustomerPlanUpgrade | null;
  /** Plain words for the customer when we cannot answer. `null` when we can. */
  problem: string | null;
}

/** Granting, visible capabilities as the customer's feature list. */
function featuresFrom(rows: PlanCapabilityRow[], catalog: Record<string, CapabilityDef>): CustomerPlanFeature[] {
  return rows
    .filter((row) => row.granting && !isHiddenFromCustomer(row.capability, catalog[row.capability]))
    .map((row) => ({ capability: row.capability, label: row.label, value: row.display }));
}

/**
 * The plan above this one, or `null`.
 *
 * Read off `tierOrder` rather than written down, so adding a tier does not need
 * an edit here. A cohort is "below" the tier it resolves through, which is why
 * a trial's next step is that tier and not the one above it.
 */
function nextPlanIdFor(config: EntitlementConfig, resolution: EntitlementResolution): string | null {
  const basis = resolution.basis;

  if (basis.kind === 'cohort') {
    const base = config.cohorts[basis.cohort as keyof typeof config.cohorts]?.base as { tier?: string } | undefined;
    return base?.tier ?? config.tierOrder[0] ?? null;
  }

  if (basis.kind === 'tier') {
    const index = config.tierOrder.indexOf(basis.tier);
    return index >= 0 ? config.tierOrder[index + 1] ?? null : null;
  }

  return null;
}

function buildUpgrade(
  config: EntitlementConfig,
  catalog: Record<string, CapabilityDef>,
  currentResolution: EntitlementResolution,
  current: PlanCapabilityRow[],
  nextPlanId: string,
  now: Date
): CustomerPlanUpgrade {
  const nextResolution = resolveEntitlements({
    config,
    account: previewAccountFor(config, nextPlanId, now),
    overrides: [],
    addons: [],
    now,
  });

  const nextRows = describePlanCapabilities(nextResolution, catalog).filter(
    (row) => !isHiddenFromCustomer(row.capability, catalog[row.capability])
  );
  const currentById = new Map(current.map((row) => [row.capability, row]));

  const adds: CustomerPlanFeature[] = [];
  const improves: CustomerPlanUpgrade['improves'] = [];
  const changes: CustomerPlanUpgrade['changes'] = [];

  for (const row of nextRows) {
    const mine = currentById.get(row.capability);
    if (!row.granting) continue;

    if (!mine || !mine.granting) {
      adds.push({ capability: row.capability, label: row.label, value: row.display });
      continue;
    }

    if (mine.display === row.display) continue;

    // Granted on both and written differently — which is NOT the same as
    // better. A Founding Partner gets a larger AI allowance than Essentials
    // does, so comparing the rendered strings alone offered them a $79 plan
    // whose headline was "1,000 per month becomes 500 per month". Rank the
    // amounts, and say nothing when there is nothing to rank.
    // Read off the resolutions, not off a field on the row: the shared row is
    // what the admin screen renders too, and a customer-side comparison is no
    // reason to change that payload.
    const mine_ = comparableAmount(currentResolution.values[row.capability]?.value);
    const next_ = comparableAmount(nextResolution.values[row.capability]?.value);

    // Nothing to rank at all — a variant like `branded` vs `unbranded` has no
    // arithmetic, and no wording that is honest without knowing which is better.
    if (mine_ === null || next_ === null) continue;

    // Different quantities: a CHANGE, not an improvement. Neither direction can
    // be claimed, and both numbers are shown so the customer can judge.
    if (mine_.unit !== next_.unit) {
      changes.push({ capability: row.capability, label: row.label, from: mine.display, to: row.display });
      continue;
    }

    // Same quantity and genuinely more.
    if (next_.amount <= mine_.amount) continue;

    improves.push({ capability: row.capability, label: row.label, from: mine.display, to: row.display });
  }

  const flags = planCommercialFlags(config, nextPlanId);

  return {
    planId: nextPlanId,
    name: planLabel(config, nextPlanId),
    monthlyPriceUsd: planMonthlyPriceUsd(config, nextPlanId),
    availableToBuy: flags.availableToBuy,
    actionUnavailableBecause: flags.availableToBuy
      ? null
      // Deliberately does NOT repeat "Coming soon": the surface renders that as a
      // badge, and a sentence restating it is noise — it also made the two
      // indistinguishable to a reader looking for either.
      : 'Get in touch if you would like to move plan before then.',
    adds,
    improves,
    changes,
  };
}

/**
 * The whole payload for one account.
 *
 * Takes an already-resolved snapshot rather than an account id: resolving is the
 * route's job, because the route is the thing that knows WHOSE account it may
 * resolve. Keeping that decision out of here means this module has no way to
 * read the wrong tenant's data even by mistake.
 */
export function buildCustomerPlanView(input: {
  resolution: EntitlementResolution | null;
  unavailable: boolean;
  now?: Date;
  config?: EntitlementConfig;
}): CustomerPlanView {
  const now = input.now ?? new Date();
  const config = input.config ?? getEntitlementConfig();
  const catalog = config.catalog as Record<string, CapabilityDef>;

  const empty = {
    planId: null,
    name: null,
    kind: null,
    monthlyPriceUsd: null,
    free: false,
    state: null,
    accessEndsAt: null,
    endsWhen: null,
    whenThisChanges: null,
    included: [],
    nextPlanUp: null,
  };

  // A read that failed is not a customer without a plan (the S-0 lesson, one
  // product away): the two must never render the same.
  if (input.unavailable || !input.resolution) {
    return {
      ...empty,
      status: input.unavailable ? 'unavailable' : 'no_plan_record',
      problem: input.unavailable
        ? 'We could not load your plan just now. Nothing has changed about your account — please try again shortly.'
        : 'We do not have a plan record for this account yet. Everything keeps working; get in touch if this stays here.',
    };
  }

  const resolution = input.resolution;
  const basis = resolution.basis;

  // No tier and no cohort means the resolver granted nothing, which is an
  // anomaly rather than a plan. Saying "your plan includes nothing" to somebody
  // whose product is working would be both alarming and false.
  if (basis.kind === 'none') {
    return {
      ...empty,
      status: 'no_plan_record',
      state: resolution.state,
      problem:
        'We do not have a plan record for this account yet. Everything keeps working; get in touch if this stays here.',
    };
  }

  const planId = basis.kind === 'tier' ? basis.tier : basis.cohort;
  const isTier = basis.kind === 'tier';
  const rows = describePlanCapabilities(resolution, catalog);
  const included = featuresFrom(rows, catalog);
  const nextPlanId = nextPlanIdFor(config, resolution);
  const visibleRows = rows.filter((row) => !isHiddenFromCustomer(row.capability, catalog[row.capability]));
  // A plan marked `shownToCustomers: false` is never named as the plan above
  // somebody — hiding it from the list and then advertising it as the next step
  // would be the same plan leaking through the other door.
  const nextIsShown = nextPlanId !== null && planCommercialFlags(config, nextPlanId).shownToCustomers;

  const upgrade =
    nextPlanId === null || nextPlanId === planId || !nextIsShown
      ? null
      : buildUpgrade(config, catalog, resolution, visibleRows, nextPlanId, now);

  return {
    status: 'ok',
    planId,
    name: planLabel(config, planId),
    kind: basis.kind,
    monthlyPriceUsd: planMonthlyPriceUsd(config, planId),
    free: !isTier,
    state: resolution.state,
    accessEndsAt: resolution.lifecycle.accessEndsAt,
    endsWhen: describePlanEnding(config, planId, resolution.values['ai.actions']?.value),
    // Only for the free plans, and only as information. It says what a paid plan
    // IS, not that a decision has been made — so the eventual change is already
    // something the customer has read once.
    whenThisChanges: isTier
      ? null
      : resolution.lifecycle.accessEndsAt === null
        ? 'Your access has no end date. Business OS is normally a paid monthly plan, so if that ever changes for your account we will tell you first and you will be able to choose a plan.'
        : 'When this ends you will be able to choose a paid monthly plan. Nothing is charged before you choose one.',
    included,
    // Shown only when the plan above genuinely gives this customer something.
    //
    // A Founding Partner already has more than Essentials, so for them the
    // answer is "nothing above you" — and the paid plans are introduced by
    // `whenThisChanges` instead, as what a subscription is rather than as an
    // offer that takes things away. Decided by comparing resolutions, not by
    // naming the cohort, so a future plan shape gets the same treatment.
    nextPlanUp:
      upgrade && (upgrade.adds.length > 0 || upgrade.improves.length > 0 || upgrade.changes.length > 0)
        ? upgrade
        : null,
    problem: null,
  };
}

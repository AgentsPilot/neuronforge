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
 * Their credit allowance is Autopilot's too: `CHAMPION_VALUES` READS Autopilot's
 * tier row (2026-09-27), so there is no plan above them with more of anything, and no
 * "next plan up" is shown.
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
  planCommercialFlags,
  planLabel,
  planMonthlyPriceUsd,
  previewAccountFor,
  type PlanCapabilityRow,
} from './planPresentation';
import { resolveEntitlements } from './resolver';
import type { EntitlementResolution } from './resolver';
import { getEntitlementConfig, type EntitlementConfig } from './source';
import { defaultLocale, type Locale } from '@/lib/i18n/config';
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

/** One capability, as the customer reads it. */
export interface CustomerPlanFeature {
  capability: string;
  label: string;
  /** Already formatted server-side; the component renders the string. */
  value: string;
}

/**
 * One row of the list: a category, and the features in it.
 *
 * ── Why grouped (user decision, 2026-09-27) ──────────────────────────
 * A Founding Partner saw 28 flat lines, which is a list nobody reads to the end
 * of. Grouping uses the `category` every capability already carries, so there is
 * no second taxonomy to maintain and no mapping to drift.
 *
 * The usual 3–4-per-row guidance is deliberately broken for AI chat's ten
 * entries: they go on one longer line rather than behind a "+N more" expander,
 * because an expander is a new interaction on a read-only screen, and hiding six
 * of the ten things a plan includes is the opposite of what this section is for.
 *
 * `summary` is built HERE rather than joined in the component — same rule as
 * every other string on this surface: the page renders, it does not compose.
 */
export interface CustomerPlanCategory {
  /** The catalog's own category id. Stable, and what the order is keyed on. */
  category: string;
  /**
   * The dictionary key for what the category is called to a customer.
   *
   * A key, not a word: the heading is read in the viewer's language. An
   * unrecognised category falls back to its raw id, which is ugly on purpose —
   * see `groupByCategory`.
   */
  labelKey: string;
  /**
   * A dictionary key for a sentence shown under the row, or `null`.
   *
   * Category-level and capability-agnostic (SA Q-9): a presentation entry may
   * carry a note, and its variant follows the SHAPE of the category's metered
   * value — `{ perMonth }` → the monthly sentence, `{ total }` → the one-off
   * one. It changes no value and names no capability, so it is not a display
   * exception of the kind slice 6 removed. Today only `credits` has one: the
   * sentence explaining what a credit is (D-h), the same keys the dashboard
   * card's tooltip reads, so the wording exists once.
   */
  noteKey: string | null;
  features: CustomerPlanFeature[];
  /** The feature names, joined — the one string a row prints. */
  summary: string;
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
  /** Why the button is not offered, as a key for the component to render. */
  actionUnavailableBecause: PlanSentence | null;
  /**
   * Granted there, not here — grouped, for the same reason the included list is.
   *
   * `basic → pro` is nine chat capabilities, which read as nine near-identical
   * lines and now read as one.
   */
  adds: CustomerPlanCategory[];
  /** Granted in both, worth more there — `from` → `to`. */
  improves: Array<{ capability: string; label: string; from: string; to: string }>;
  /**
   * Granted in both, DIFFERENT there, and not rankable — stated as a change.
   *
   * The trial's credit allowance is a one-off `{ total }` and Essentials' a
   * `{ perMonth }` rate. Those are different quantities with no honest exchange
   * rate, so calling it an improvement would be a claim we cannot support and
   * suppressing it hides the most important line on the page. It is reported as
   * a **change** — "2,000 in total becomes 19,750 per month" — which is exactly
   * what is true, and lets the customer judge.
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

/**
 * A sentence the CLIENT renders, so it speaks the viewer's language.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is WS-2 step 1b, which `readableDate` below already described: the server
 * sends a KEY and, where the sentence names a day, an ISO date — and the
 * component renders both through the platform dictionary every other screen
 * uses.
 *
 * Composing the prose here was right while there was one language. It cannot be
 * right in three: the copy would have to live in a second dictionary beside this
 * module, and the date would be formatted in English regardless of who was
 * reading. The reason the sentences moved server-side still holds — the
 * component must not INVENT a claim — and a key satisfies it: the component
 * chooses no wording, only the language it is read in.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface PlanSentence {
  /** A key in the platform dictionary (`plan.*`). */
  key: string;
  /**
   * The day the sentence names, ISO, for the component to format in the
   * viewer's locale. Absent for sentences with no date in them.
   */
  date?: string | null;
}

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
  /**
   * When this plan ends, in a sentence.
   *
   * **`null` only for a free plan with no end date**, where `whenThisChanges` says
   * exactly that at more length. Keyed on `lifecycle.accessEndsAt` — the same
   * field the note and the chrome pill read (SA R3-1).
   *
   * The two said the same thing to a free account: "No end date unless an admin
   * sets one", and a row below, "Your access has no end date… we will tell you
   * first and you will be able to choose a plan." The second says it better and
   * completely.
   *
   * Suppressed HERE rather than hidden in the component, the way `nothingToShow`
   * was: a field the page must know to skip is a field the next page will forget
   * to skip. The component renders whichever is present and decides nothing.
   *
   * **The condition is narrow on purpose:** a note AND no end date. It survives
   * wherever it carries information of its own — a paid plan's "While the plan is
   * paid for", and a TRIAL's "14 days from the first onboarding message, or when
   * the credits run out", which is the only place that deadline appears. A
   * first pass dropped it whenever the note existed and silently cost the trial
   * its countdown.
   */
  endsWhen: PlanSentence | null;
  /**
   * Written for the cohorts: what happens when free access is not free.
   *
   * When this is set it is the ONLY ending sentence — see `endsWhen`.
   */
  whenThisChanges: PlanSentence | null;
  /**
   * Every capability the plan grants, grouped by category.
   *
   * Grouped rather than flat since 2026-09-27: 28 lines is a list nobody
   * finishes. The flat features are still inside each row, so a consumer that
   * wants them has them without a second field to keep in step.
   */
  included: CustomerPlanCategory[];
  /** `null` when there is nothing above this plan. */
  nextPlanUp: CustomerPlanUpgrade | null;
  /** Plain words for the customer when we cannot answer. `null` when we can. */
  problem: PlanSentence | null;
}

/**
 * What each catalog category is called, and the order rows appear in.
 *
 * ── The order, and why it is this one ───────────────────────────────
 * Not alphabetical (which would open on "Add-ons") and not catalog order (which
 * is grouped for the people who maintain the catalog, and opens on add-ons too).
 * It follows **the order a business meets these things**, which is also roughly
 * how much they care — after one row that frames everything below it:
 *
 *   0. Credits            — the one allowance every chargeable action draws on
 *                           (credit deduction slice 6, D-g / SQ-25). First,
 *                           because it is the number a plan is sized by, and it
 *                           carries the sentence saying what a credit is.
 *   1. CRM                — the clients. The reason the product exists.
 *   2. Website & intake    — how those clients arrive.
 *   3. Payments            — getting paid by them.
 *   4. AI chat             — the assistant that does the work above.
 *   5. Marketing           — bringing more of them in.
 *   6. Insights            — what the numbers say once all that is running.
 *   7. Support             — what we owe the owner.
 *   8. Platform            — plumbing they should rarely think about.
 *   9. Add-ons             — extras, last by definition.
 *
 * A category absent from this map still renders: it falls to the end with its
 * raw id as the label, which is ugly on purpose. A new catalog category should
 * be noticed and named, not silently swallowed — and `categoryOrder.test`
 * asserts every category in the catalog is named here.
 */
/**
 * The category order, and the dictionary key for each heading.
 *
 * Keys rather than words, for the reason `PlanSentence` gives: the heading is
 * read in the viewer's language. The plain word AND the familiar acronym stay
 * paired in the copy itself (user decision, 2026-09-27) — "Clients" is what it
 * is, "CRM" is what somebody has been calling it for twenty years.
 */
/**
 * `note` (SA Q-9): the sentence under a category, as a key per allowance shape.
 * Reuses the dashboard card's `usage.explain.*` keys, so the plan screen, the
 * invite page and the card cannot say different things about what a credit is.
 */
interface CategoryPresentation {
  category: string;
  labelKey: string;
  note?: { monthly: string; total: string };
}

const CATEGORY_PRESENTATION: ReadonlyArray<CategoryPresentation> = [
  {
    category: 'credits',
    labelKey: 'plan.category.credits',
    note: { monthly: 'usage.explain.monthly', total: 'usage.explain.trial' },
  },
  { category: 'crm', labelKey: 'plan.category.crm' },
  { category: 'website_intake', labelKey: 'plan.category.website_intake' },
  { category: 'payments', labelKey: 'plan.category.payments' },
  { category: 'ai_chat', labelKey: 'plan.category.ai_chat' },
  { category: 'marketing', labelKey: 'plan.category.marketing' },
  { category: 'insights', labelKey: 'plan.category.insights' },
  { category: 'support', labelKey: 'plan.category.support' },
  { category: 'platform', labelKey: 'plan.category.platform' },
  { category: 'addon', labelKey: 'plan.category.addon' },
];

/**
 * Which note variant a category takes, from the shape of its metered value.
 *
 * Generic (SA Q-9): the first feature in the row whose catalog shape is
 * `metered` decides — a one-off `{ total }` reads the `total` sentence, anything
 * else the monthly one. No capability id and no plan name is consulted; the
 * trial is recognised by its `{ total }` value, as everywhere else. With no
 * metered value in the row (or no value lookup) there is no note: a sentence
 * about an allowance must not appear beside something that is not one.
 */
function noteKeyFor(
  note: CategoryPresentation['note'],
  features: readonly CustomerPlanFeature[],
  catalog: Record<string, CapabilityDef>,
  valueOf: ((capability: string) => CapabilityValue | undefined) | undefined
): string | null {
  if (!note || !valueOf) return null;

  for (const feature of features) {
    if (catalog[feature.capability]?.shape.kind !== 'metered') continue;
    const value = valueOf(feature.capability);
    if (!value || typeof value !== 'object') continue;
    return 'total' in (value as object) ? note.total : note.monthly;
  }

  return null;
}

/**
 * Features grouped into rows, in the order above. Empty categories are dropped.
 *
 * `valueOf` reads a capability's resolved value, for the category note only
 * (`noteKeyFor`). Optional, so a caller with no resolution gets rows without
 * notes rather than a guess.
 */
export function groupByCategory(
  features: readonly CustomerPlanFeature[],
  catalog: Record<string, CapabilityDef>,
  valueOf?: (capability: string) => CapabilityValue | undefined
): CustomerPlanCategory[] {
  const known = new Map(CATEGORY_PRESENTATION.map((entry, index) => [entry.category, { ...entry, index }]));
  const buckets = new Map<string, CustomerPlanFeature[]>();

  for (const feature of features) {
    const category = catalog[feature.capability].category;
    const bucket = buckets.get(category);
    if (bucket) bucket.push(feature);
    else buckets.set(category, [feature]);
  }

  return [...buckets.entries()]
    .map(([category, bucketFeatures]) => {
      const presentation = known.get(category);

      return {
        category,
        // An unnamed category shows its raw id rather than disappearing. It is
        // not a key, so the component prints it as-is — which is the point.
        labelKey: presentation?.labelKey ?? category,
        // Only for a row that renders at least one line — every row here does,
        // since an empty category never gets a bucket (SA Q-9).
        noteKey: noteKeyFor(presentation?.note, bucketFeatures, catalog, valueOf),
        index: presentation?.index ?? CATEGORY_PRESENTATION.length,
        features: bucketFeatures,
        // Joined here, not in the component. A value worth printing is appended
        // to its own name, so "Email volume (10,000 per month)" reads as one item.
        //
        // `yes` is dropped: "Client documents (yes)" in a list of what you HAVE is
        // noise. And a value that already carries brackets is not wrapped in more
        // of them — "Email volume (10,000 per month (alerts, never blocks))" was
        // the first thing to look wrong when these lines were joined.
        summary: bucketFeatures
          .map((feature) => {
            if (feature.value === 'yes') return feature.label;
            return feature.value.includes('(')
              ? `${feature.label} ${feature.value}`
              : `${feature.label} (${feature.value})`;
          })
          .join(', '),
      };
    })
    .sort((left, right) => left.index - right.index || left.category.localeCompare(right.category))
    // `index` was a sort key, not part of the payload: the exact key-set
    // allow-list over each object would (rightly) fail on it.
    .map((row) => ({
      category: row.category,
      labelKey: row.labelKey,
      noteKey: row.noteKey,
      features: row.features,
      summary: row.summary,
    }));
}

/**
 * A date a customer can read, without `Intl`.
 *
 * Built from an explicit month list rather than `toLocaleDateString`: the format
 * has to be identical in a test, on Vercel, and in whatever ICU build a container
 * happens to ship. "1 December 2026" either way.
 *
 * ── UTC, deliberately (SA R4-6) ──────────────────────────────────
 * Read with `getUTC*`, against the standing rule that `user_preferences.timezone`
 * is the authority for any hour shown to a client. That rule is about **clock
 * times** — an appointment at 09:00 must be the client's 09:00. This is a
 * calendar date on an entitlement boundary that was itself set in UTC, and
 * rendering it in a business's local zone would move it a day either side of
 * midnight for no benefit. Stating it because silence here would look like the
 * oversight the rule exists to catch.
 *
 * ── An unusable date must not become a sentence ──────────────────────
 * `null` on anything `Date` cannot parse. Without it, "NaN undefined NaN" reaches
 * a customer on the one surface whose entire rule is that a failure must never
 * look like a fact — and the caller then omits the claim rather than printing
 * nonsense.
 *
 * DONE (WS-2 step 1b): the server now sends the ISO date and a key, and the
 * component formats the date in the viewer's own locale — which is why the
 * English month list that used to live here is gone.
 */

/**
 * The ending sentence for a FREE plan, from the account's own end date.
 *
 * ── The defect this replaces (SA R3-1) ────────────────────────────
 * A champion with an admin-set expiry was told, in two adjacent lines, that their
 * access had **no end date** and that it **would end**. Three things on this
 * surface make a claim about an ending — the short line, the longer note, and the
 * pill's tooltip on the chrome of every screen — and they were deciding
 * independently.
 *
 * `describePlanEnding` was not the bug: it describes the **plan** from config, and
 * a champion cohort genuinely has no configured duration. An end date is a
 * per-ACCOUNT fact, so a sentence about the plan cannot answer it. The customer
 * layer holds the resolution, so the rule belongs here — keyed on
 * `lifecycle.accessEndsAt`, the resolver's own answer, which every consumer now
 * reads.
 *
 * It also puts the DATE on screen. `accessEndsAt` was in the payload and rendered
 * nowhere, which is how "your access ends" managed to be vaguer than the config
 * sentence contradicting it.
 */
function describeFreePlanEnding(
  config: EntitlementConfig,
  planId: string,
  resolution: EntitlementResolution
): PlanSentence | null {
  const endsAt = resolution.lifecycle.accessEndsAt;

  // No end date: the note says exactly that, at more length. One claim, one
  // place — which is what removed the original duplicate.
  if (endsAt === null) return null;

  // An unusable date is not a sentence (R4-6). Saying nothing is correct here: the
  // note below still tells the customer what happens when their plan ends, so the
  // page reads as slightly less specific rather than as broken. Still checked
  // here, even though the component formats it: a key with an unparseable date
  // would render "Ends on Invalid Date" in three languages instead of one.
  if (Number.isNaN(new Date(endsAt).getTime())) return null;

  // Does this plan have a SECOND way of ending, besides the date?
  //
  // Structural, not a regex over another module's prose (SA R4-5). A one-off
  // total — `{ total: n }` rather than `{ perMonth: n }` — is what makes running
  // out an ending (FR-27), and that is the same fact `describePlanEnding` reads to
  // decide its own wording. Matching its English coupled this sentence to
  // somebody else's copy-editing.
  const allowance = resolution.values['credits.allowance']?.value;
  const runsOut = !!allowance && typeof allowance === 'object' && 'total' in (allowance as object);

  return runsOut
    ? { key: 'plan.ends_on_or_credits', date: endsAt }
    : { key: 'plan.ends_on', date: endsAt };
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
  now: Date,
  locale: Locale
): CustomerPlanUpgrade {
  const nextResolution = resolveEntitlements({
    config,
    account: previewAccountFor(config, nextPlanId, now),
    overrides: [],
    addons: [],
    now,
  });

  const nextRows = describePlanCapabilities(nextResolution, catalog, locale).filter(
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
    // better. A Founding Partner gets a larger credit allowance than Essentials
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
    name: planLabel(config, nextPlanId, locale),
    monthlyPriceUsd: planMonthlyPriceUsd(config, nextPlanId),
    availableToBuy: flags.availableToBuy,
    actionUnavailableBecause: flags.availableToBuy
      ? null
      // Deliberately does NOT repeat "Coming soon": the surface renders that as a
      // badge, and a sentence restating it is noise — it also made the two
      // indistinguishable to a reader looking for either.
      : { key: 'plan.move_before_then' },
    adds: groupByCategory(adds, catalog, (capability) => nextResolution.values[capability]?.value),
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
  /**
   * The language to read the CONFIG's labels in — plan names and feature names,
   * which are data rather than copy and so are resolved here.
   *
   * The sentences are not: they travel as keys for the component to render. See
   * `PlanSentence`.
   */
  locale?: Locale;
}): CustomerPlanView {
  const now = input.now ?? new Date();
  const locale = input.locale ?? defaultLocale;
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
        ? { key: 'plan.problem.unavailable' }
        : { key: 'plan.problem.no_record' },
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
        { key: 'plan.problem.no_record' },
    };
  }

  const planId = basis.kind === 'tier' ? basis.tier : basis.cohort;
  const isTier = basis.kind === 'tier';
  const rows = describePlanCapabilities(resolution, catalog, locale);
  const included = featuresFrom(rows, catalog);
  // Only for the free plans, and only as information: it says what a paid plan IS,
  // not that a decision has been made, so the eventual change is something the
  // customer has already read once.
  //
  // Branches on the SAME field as `endsWhen` and the pill (SA R3-1). Three
  // consumers, one fact — previously they decided separately and a dated champion
  // was told both that their access had no end date and that it would end.
  const whenThisChanges = isTier
    ? null
    : resolution.lifecycle.accessEndsAt === null
      ? { key: 'plan.changes.no_end_date' }
      : { key: 'plan.changes.on_end' };

  const nextPlanId = nextPlanIdFor(config, resolution);
  const visibleRows = rows.filter((row) => !isHiddenFromCustomer(row.capability, catalog[row.capability]));
  // A plan marked `shownToCustomers: false` is never named as the plan above
  // somebody — hiding it from the list and then advertising it as the next step
  // would be the same plan leaking through the other door.
  const nextIsShown = nextPlanId !== null && planCommercialFlags(config, nextPlanId).shownToCustomers;

  const upgrade =
    nextPlanId === null || nextPlanId === planId || !nextIsShown
      ? null
      : buildUpgrade(config, catalog, resolution, visibleRows, nextPlanId, now, locale);

  return {
    status: 'ok',
    planId,
    name: planLabel(config, planId, locale),
    kind: basis.kind,
    monthlyPriceUsd: planMonthlyPriceUsd(config, planId),
    free: !isTier,
    state: resolution.state,
    accessEndsAt: resolution.lifecycle.accessEndsAt,
    // `null` only when the note below ALREADY SAYS IT.
    //
    // First pass suppressed it whenever the note existed, and that was too broad:
    // a trial's line ("14 days from the first onboarding message, or when the
    // credits run out") and its note ("when this ends you will be able to choose a
    // paid plan") are not duplicates — one says WHEN, the other says WHAT NEXT.
    // Dropping the first lost the only place the 14 days appears.
    //
    // The redundancy is specific to open-ended access, where the line says "no end
    // date" and the note opens with "your access has no end date". So: suppress
    // when there is a note AND there is no end date to state.
    // A paid plan runs while it is paid for; a free one is described by its own
    // end date (SA R3-1) — one rule, keyed on `lifecycle.accessEndsAt`.
    endsWhen: isTier
      ? /*
         * The key, not `describePlanEnding`.
         *
         * That function serves the ADMIN view too, which reads English prose, and
         * its tier branch returns one constant sentence regardless of the AI
         * allowance — so naming the key here is exactly equivalent for a customer
         * and leaves the admin path untouched. Its other branches describe cohort
         * durations and are only ever reached by admin.
         */
        { key: 'plan.ends.while_paid' }
      : describeFreePlanEnding(config, planId, resolution),
    whenThisChanges,
    included: groupByCategory(included, catalog, (capability) => resolution.values[capability]?.value),
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

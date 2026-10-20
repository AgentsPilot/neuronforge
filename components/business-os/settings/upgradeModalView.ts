/**
 * What the plan comparison modal shows, from the `my-plan` payload alone
 * (upgrade modal UM-1a, workplan §5.2a).
 *
 * ── IT DOES NOT DECIDE THE TABLE ────────────────────────────────────────────
 * Rows, labels, ✓ / ✕, values, highlights, section headings and their order
 * are the server's (`comparison`, UM-0). `sections` is returned BY IDENTITY:
 * nothing here sorts, filters, reverses or rebuilds it (C-21; pinned by
 * `upgradeModal.guard` (h) and a `toBe` unit test).
 *
 * What it does derive is only what joins the columns to this account, and every
 * input is server data compared by id — never a plan name or tier id written
 * here (C-7):
 *   - current column: the payload's own plan, and only when it is a tier (C-22);
 *   - which plans the server offers this account (`offer.tiers` ∪ `upgrade.tiers`);
 *   - the recommended column (UM-SA4 as amended by user decision UM-BQ4): the
 *     LAST shown plan (server order) that the server offers and that is not the
 *     current tier; none when nothing qualifies (C-10). `nextPlanUp` does not
 *     pick it (it still drives the drawer's B9 and the coming-soon reason);
 *   - the headline, and the per-column action (UM-1b: which button, if any).
 *
 * ── THE CONTEXT (UM-2, workplan §6) ─────────────────────────────────────────
 * Why the window was opened changes the headline, the subheading and which
 * column is highlighted, and NOTHING ELSE (UM-FR8): every column's action,
 * chip and note, `somethingOffered`, `hasActions` and `sections` are computed
 * before the context is looked at.
 *   - `locked_feature`: the caller's plan is highlighted, offered or not (UM-BQ4's
 *     locked-action clause, "the plan that unlocks it"); amended UM-SA4 / C-10
 *     still governs `settings` and `founding_partner`. An id that is the current
 *     tier or not in the table falls back to the `settings` copy.
 *   - `founding_partner`: only when the server says buying ends free access and
 *     offers a plan (UM-FR9); otherwise the `settings` copy. Never a cohort id or
 *     name compared here (UM-FR7).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PlanComparisonSection, PlanPayload, PlanSentence } from './planPayloadTypes';
import { SETTINGS_CONTEXT, type UpgradeModalContext } from './upgradeModalContext';

export interface PlanColumnView {
  /** From `comparison.planIds`, never compared to a literal. */
  planId: string;
  /** Joined from `plans[]` by `planId`. */
  name: string;
  monthlyPriceUsd: number;
  /** `plan.kind === 'tier' && planId === plan.planId` (C-22). */
  isCurrent: boolean;
  /**
   * Amended UM-SA4 (UM-BQ4) + C-10: the last shown plan that is offered and not
   * current. False on every column while a `locked_feature` highlight applies.
   */
  isRecommended: boolean;
  /**
   * UM-2: why this column is marked (tint, top border, badge, primary button):
   * the Recommended rule, or the plan a locked action needs. At most one column.
   */
  highlightReason: PlanHighlightReason | null;
  /**
   * "Coming soon" (UM-1a Q-1, widened by UM-1b SA Q-1): `!availableToBuy`, or —
   * while CHOOSING (`offer.kind === 'choose'`) — a shown plan the server offers
   * neither to choose nor to upgrade to, as the Choose list said (UM-FR3). Never
   * on the current column, and never beside a button.
   */
  comingSoon: boolean;
  /** The server's reason, on the `nextPlanUp` column only, when it cannot be bought (SA Q-1). */
  unavailableBecause: PlanSentence | null;
  /**
   * What sits under the price and in the footer row (C-22; UM-1b §4). Precedence
   * (SA Q-1 / Q-3): upgrade > pay_for > choose > current_label > none.
   *  'upgrade'       the plan is in `purchase.upgrade.tiers`: "Upgrade to {plan}"
   *  'pay_for'       offered to choose, and it is the tier this account is on
   *                  (admin-assigned, no billing, plan payments Q-5): "Pay for {plan}"
   *  'choose'        offered to choose: "Choose {plan}"
   *  'current_label' the current column with nothing offered for it: the
   *                  non-interactive "Current plan"
   *  'none'          everything else (a Coming soon chip may show)
   */
  action: PlanColumnAction;
  /**
   * The server's own-plan note belongs to this column's button (plan payments
   * Q-5 / Q-7): `pay_for`, or `upgrade` on the current column. The modal shows
   * the matching sentence in its footer.
   */
  ownPlanNote: 'choose' | 'upgrade' | null;
}

export type PlanColumnAction = 'upgrade' | 'pay_for' | 'choose' | 'current_label' | 'none';

/** The actions that are a button: the server offers this plan to this account. */
export const BUTTON_ACTIONS: readonly PlanColumnAction[] = ['upgrade', 'pay_for', 'choose'];

export type UpgradeModalHeadline = 'choose' | 'top_plan' | 'compare' | 'locked_feature' | 'founding_partner';

/** UM-2: the copy actually used, after the fallbacks (workplan §6.1). */
export type UpgradeModalVariant = UpgradeModalContext['kind'];

export type PlanHighlightReason = 'recommended' | 'locked_feature';

export type UpgradeModalSubheading = 'default' | 'upgrade' | 'locked_feature' | 'founding_partner';

export interface UpgradeModalView {
  /** `comparison` present, `planIds` non-empty, every id found in `plans` (§5.2a). */
  available: boolean;
  /** `comparison.planIds` order, untouched. Empty when not `available`. */
  columns: PlanColumnView[];
  /** `=== plan.comparison.sections` (identity, C-21). Empty when not `available`. */
  sections: PlanComparisonSection[];
  headline: UpgradeModalHeadline;
  /** Anything offered OTHER than the current tier's own plan (W-1). */
  somethingOffered: boolean;
  /**
   * UM-1b §8.2: any column carries a button (its own plan's "Pay for" included),
   * so the drawer's button reads "See plans" rather than "Compare plans".
   */
  hasActions: boolean;
  /** UM-2: the variant shown; `settings` whenever a context's condition is not met. */
  variant: UpgradeModalVariant;
  /**
   * UM-2: `default` is the UM-1a subheading. UM-3 (CV-5, SA Q-2): `upgrade` in the
   * `settings` variant when some column's action is the server's `upgrade` offer.
   */
  subheading: UpgradeModalSubheading;
  /** UM-2: the plan a locked action needs, joined from the payload; set only in the `locked_feature` variant. */
  lockedPlan: { planId: string; name: string; offered: boolean } | null;
}

const NOTHING: PlanComparisonSection[] = [];

/** The plan ids the server offers this account to choose, and to upgrade to. */
function offers(plan: PlanPayload): { choose: Set<string>; upgrade: Set<string>; all: Set<string>; choosing: boolean } {
  const choose = new Set<string>();
  const upgrade = new Set<string>();
  const purchase = plan.purchase;
  const choosing = purchase?.offer.kind === 'choose';
  if (purchase && purchase.offer.kind === 'choose') {
    for (const tier of purchase.offer.tiers) choose.add(tier);
  }
  for (const tier of purchase?.upgrade?.tiers ?? []) upgrade.add(tier);
  return { choose, upgrade, all: new Set([...Array.from(choose), ...Array.from(upgrade)]), choosing };
}

export function upgradeModalView(plan: PlanPayload, context: UpgradeModalContext = SETTINGS_CONTEXT): UpgradeModalView {
  const plans = plan.plans ?? [];
  const comparison = plan.comparison ?? null;
  const currentId = plan.kind === 'tier' ? plan.planId : null;
  const { choose, upgrade, all: offered, choosing } = offers(plan);

  // W-1: an admin-assigned tier whose own plan is offered ("Pay for") has
  // nothing to CHOOSE here, so it must not read "Choose the plan that fits".
  let somethingOffered = false;
  offered.forEach((tier) => {
    if (tier !== currentId) somethingOffered = true;
  });

  const lastPlanId = plans.length > 0 ? plans[plans.length - 1].planId : null;
  // UM-BQ4: walk the server's order from the top; the highest plan this account
  // may choose is recommended. Position only, never a plan id written here (C-7).
  let recommendedId: string | null = null;
  for (let index = plans.length - 1; index >= 0 && recommendedId === null; index -= 1) {
    const planId = plans[index].planId;
    if (offered.has(planId) && planId !== currentId) recommendedId = planId;
  }

  // SA Q-2: positional, the same server-order reliance UM-SA4 accepted.
  const settingsHeadline: UpgradeModalHeadline = somethingOffered
    ? 'choose'
    : currentId !== null && currentId === lastPlanId
      ? 'top_plan'
      : 'compare';

  const byId = new Map(plans.map((choice) => [choice.planId, choice] as const));
  const planIds = comparison?.planIds ?? [];
  const available = comparison !== null && planIds.length > 0 && planIds.every((id) => byId.has(id));

  // UM-2 §6.2: the locked plan, from the payload only; the current tier or an id outside the table falls back.
  const lockedId =
    context.kind === 'locked_feature' && available && planIds.includes(context.planId) && context.planId !== currentId ? context.planId : null;
  // UM-2 §6.3 / UM-FR9: the server's own signal, never the cohort.
  const foundingPartner = context.kind === 'founding_partner' && plan.purchase?.endsFreeAccessOnPurchase === 'free_access' && somethingOffered;
  const variant: UpgradeModalVariant = lockedId !== null ? 'locked_feature' : foundingPartner ? 'founding_partner' : 'settings';
  const headline: UpgradeModalHeadline = variant === 'settings' ? settingsHeadline : variant;
  const lockedPlan = lockedId !== null ? { planId: lockedId, name: byId.get(lockedId)!.name, offered: offered.has(lockedId) } : null;
  const contextual = { variant, lockedPlan } as const;

  if (!available || comparison === null) {
    const subheading: UpgradeModalSubheading = variant === 'settings' ? 'default' : variant;
    return { available: false, columns: [], sections: NOTHING, headline, somethingOffered, hasActions: false, subheading, ...contextual };
  }

  const columns = planIds.map((planId): PlanColumnView => {
    // `available` proved every id is in `plans`.
    const choice = byId.get(planId)!;
    const isCurrent = currentId !== null && planId === currentId;
    const isNext = plan.nextPlanUp?.planId === planId;
    // SA Q-1 / Q-3 precedence, server data only.
    const action: PlanColumnAction = upgrade.has(planId)
      ? 'upgrade'
      : choose.has(planId)
        ? isCurrent
          ? 'pay_for'
          : 'choose'
        : isCurrent
          ? 'current_label'
          : 'none';
    const notOfferedWhileChoosing = choosing && !offered.has(planId);
    // O-1 (UM-BQ4's locked-action clause): the locked plan replaces the Recommended rule, in that variant only.
    const highlightReason: PlanHighlightReason | null =
      lockedId !== null ? (planId === lockedId ? 'locked_feature' : null) : planId === recommendedId ? 'recommended' : null;
    return {
      planId,
      name: choice.name,
      monthlyPriceUsd: choice.monthlyPriceUsd,
      isCurrent,
      isRecommended: highlightReason === 'recommended',
      highlightReason,
      comingSoon: action === 'none' && (!choice.availableToBuy || notOfferedWhileChoosing),
      unavailableBecause: isNext && !choice.availableToBuy ? plan.nextPlanUp?.actionUnavailableBecause ?? null : null,
      // C-22: the server's action first, so an admin-assigned tier offered its
      // own plan gets "Pay for", not the "Current plan" label.
      action,
      ownPlanNote: action === 'pay_for' ? 'choose' : action === 'upgrade' && isCurrent ? 'upgrade' : null,
    };
  });

  const hasActions = columns.some((column) => BUTTON_ACTIONS.includes(column.action));
  // UM-3 CV-5: from the columns' actions (the server's offer), after they are fixed; never a plan id (C-7).
  const subheading: UpgradeModalSubheading =
    variant !== 'settings' ? variant : columns.some((column) => column.action === 'upgrade') ? 'upgrade' : 'default';
  return { available: true, columns, sections: comparison.sections, headline, somethingOffered, hasActions, subheading, ...contextual };
}

/** Which "Your plan" surface Settings opens (UM-D3, SA R-1). */
export type PlanSurface = 'modal' | 'drawer';

/**
 * UM-D3 (SA R-1, D3-1): the pop-up when the server offers this account something
 * to buy or upgrade to, the drawer otherwise. The offer predicate is the view's
 * own `hasActions` (the one that already picks "See plans" over "Compare plans"),
 * so this adds no client rule (UM-FR7, C-21). A checkout return always opens the
 * pop-up, which shows "Payment processing" (R-7).
 *
 * `answer` is the first read's plan, or `null` when the read failed, threw, was
 * not a plan or did not answer within the budget: all of those are the drawer
 * (R-4). Pure, and it names no plan, tier or cohort (C-7).
 */
export function planSurfaceFor(answer: PlanPayload | null, checkoutReturn: boolean): PlanSurface {
  if (checkoutReturn) return 'modal';
  if (answer === null || answer.status !== 'ok') return 'drawer';
  const view = upgradeModalView(answer);
  return view.available && view.hasActions ? 'modal' : 'drawer';
}

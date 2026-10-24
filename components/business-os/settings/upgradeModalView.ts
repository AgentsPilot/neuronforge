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
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PlanComparisonSection, PlanPayload, PlanSentence } from './planPayloadTypes';

export interface PlanColumnView {
  /** From `comparison.planIds`, never compared to a literal. */
  planId: string;
  /** Joined from `plans[]` by `planId`. */
  name: string;
  monthlyPriceUsd: number;
  /** `plan.kind === 'tier' && planId === plan.planId` (C-22). */
  isCurrent: boolean;
  /** Amended UM-SA4 (UM-BQ4) + C-10: the last shown plan that is offered and not current. */
  isRecommended: boolean;
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

export type UpgradeModalHeadline = 'choose' | 'top_plan' | 'compare';

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

export function upgradeModalView(plan: PlanPayload): UpgradeModalView {
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
  const headline: UpgradeModalHeadline = somethingOffered
    ? 'choose'
    : currentId !== null && currentId === lastPlanId
      ? 'top_plan'
      : 'compare';

  const byId = new Map(plans.map((choice) => [choice.planId, choice] as const));
  const planIds = comparison?.planIds ?? [];
  const available = comparison !== null && planIds.length > 0 && planIds.every((id) => byId.has(id));

  if (!available || comparison === null) {
    return { available: false, columns: [], sections: NOTHING, headline, somethingOffered, hasActions: false };
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
    return {
      planId,
      name: choice.name,
      monthlyPriceUsd: choice.monthlyPriceUsd,
      isCurrent,
      isRecommended: planId === recommendedId,
      comingSoon: action === 'none' && (!choice.availableToBuy || notOfferedWhileChoosing),
      unavailableBecause: isNext && !choice.availableToBuy ? plan.nextPlanUp?.actionUnavailableBecause ?? null : null,
      // C-22: the server's action first, so an admin-assigned tier offered its
      // own plan gets "Pay for", not the "Current plan" label.
      action,
      ownPlanNote: action === 'pay_for' ? 'choose' : action === 'upgrade' && isCurrent ? 'upgrade' : null,
    };
  });

  const hasActions = columns.some((column) => BUTTON_ACTIONS.includes(column.action));
  return { available: true, columns, sections: comparison.sections, headline, somethingOffered, hasActions };
}

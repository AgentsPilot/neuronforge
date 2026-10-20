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
 *   - the headline, and the per-column action slot.
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
  /** `!availableToBuy` (SA Q-1): "not offered to you" is not "coming soon". */
  comingSoon: boolean;
  /** The server's reason, on the `nextPlanUp` column only, when it cannot be bought (SA Q-1). */
  unavailableBecause: PlanSentence | null;
  /**
   * What sits under the price and in the footer row (C-22):
   *  'offered'       the server offers this plan to this account; UM-1a renders
   *                  NOTHING here (C-1, SA Q-11), UM-1b mounts the trigger
   *  'current_label' the current column with nothing offered for it: the
   *                  non-interactive "Current plan"
   *  'none'          everything else (a Coming soon chip may still show)
   */
  action: 'offered' | 'current_label' | 'none';
}

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
}

const NOTHING: PlanComparisonSection[] = [];

/** The plan ids the server offers this account to choose or upgrade to. */
function offeredTiers(plan: PlanPayload): Set<string> {
  const offered = new Set<string>();
  const purchase = plan.purchase;
  if (!purchase) return offered;
  if (purchase.offer.kind === 'choose') {
    for (const tier of purchase.offer.tiers) offered.add(tier);
  }
  for (const tier of purchase.upgrade?.tiers ?? []) offered.add(tier);
  return offered;
}

export function upgradeModalView(plan: PlanPayload): UpgradeModalView {
  const plans = plan.plans ?? [];
  const comparison = plan.comparison ?? null;
  const currentId = plan.kind === 'tier' ? plan.planId : null;
  const offered = offeredTiers(plan);

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
    return { available: false, columns: [], sections: NOTHING, headline, somethingOffered };
  }

  const columns = planIds.map((planId): PlanColumnView => {
    // `available` proved every id is in `plans`.
    const choice = byId.get(planId)!;
    const isCurrent = currentId !== null && planId === currentId;
    const isNext = plan.nextPlanUp?.planId === planId;
    return {
      planId,
      name: choice.name,
      monthlyPriceUsd: choice.monthlyPriceUsd,
      isCurrent,
      isRecommended: planId === recommendedId,
      comingSoon: !choice.availableToBuy,
      unavailableBecause: isNext && !choice.availableToBuy ? plan.nextPlanUp?.actionUnavailableBecause ?? null : null,
      // C-22: the server's action first, so an admin-assigned tier offered its
      // own plan gets the slot (empty in UM-1a), not the "Current plan" label.
      action: offered.has(planId) ? 'offered' : isCurrent ? 'current_label' : 'none',
    };
  });

  return { available: true, columns, sections: comparison.sections, headline, somethingOffered };
}

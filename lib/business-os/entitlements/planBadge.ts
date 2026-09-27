import 'server-only';

/**
 * The quiet plan indicator in the Business OS chrome.
 *
 * A small pill beside the business name, and the same in the user menu, both
 * linking through to "Your plan" in settings.
 *
 * ── Why the DECISION lives here and not in the header ───────────────────────
 * The constraint was "no second opinion about who is a champion". A component
 * comparing `cohort === 'champion'` would be exactly that: a second rule, in a
 * file that has no idea about lifecycle, expiry, overrides or the `base` a cohort
 * points at. The day a champion's cohort lapses into grace, the component would
 * still say "Founding Partner" because the string had not changed.
 *
 * So the pill is decided from a **resolution** — the same `EntitlementService`
 * snapshot the plan section reads, through the same account seam — and this
 * module returns either a label or nothing. The header renders a string.
 *
 * ── Why a pill and not a banner ─────────────────────────────────────────────
 * There is nothing to act on. A Founding Partner has everything, free, with no
 * end date; a banner would be a permanent interruption saying "all is well".
 * Quiet, present, and clickable for anyone who wants the detail.
 *
 * ── Champions only, for now ─────────────────────────────────────────────────
 * Trials deliberately get **no pill**, which was the coordinator's instinct and
 * is also what the mechanics favour:
 *
 *   - a trial has an END DATE, so its pill would be a countdown, and a countdown
 *     is something to act on — which is a banner's job, or the settings section's,
 *     not a quiet label's;
 *   - the chrome is a layout that stays mounted across navigations, so a trial
 *     pill would keep showing yesterday's number until a full reload;
 *   - a champion's state is open-ended, so a stale champion pill says the same
 *     thing it said when it rendered.
 *
 * Adding one later is `TIERS_WITH_A_BADGE`-shaped work, not a redesign: the
 * function already receives the whole resolution.
 *
 * @see docs/requirements/BUSINESS_OS_TIER_BILLING_REUSE_PLAN.md §6.5 WS-2
 */

import type { EntitlementResolution } from './resolver';
import { getEntitlementConfig, type EntitlementConfig } from './source';
import { planLabel } from './planPresentation';

/** Where the pill points. One place, so the two renderings cannot disagree. */
export const PLAN_SECTION_HREF = '/business-os/settings?section=plan';

export interface PlanBadge {
  /** The customer-facing plan name, from config — never an internal id. */
  label: string;
  /** Why it is shown, for a tooltip and for the accessible name. */
  title: string;
  href: string;
}

/**
 * The pill for this resolution, or `null`.
 *
 * `null` for every case that is not a champion in force: a paid plan (the name is
 * not news), a trial (see the header), an anomaly, and **any failure** — the
 * caller passes `null` when the read did not work, and gets `null` back. There is
 * no error state to render, by design: a wrong or shouting label in the chrome of
 * every screen is worse than no label.
 */
export function planBadgeFor(
  resolution: EntitlementResolution | null,
  config: EntitlementConfig = getEntitlementConfig()
): PlanBadge | null {
  if (!resolution) return null;

  const basis = resolution.basis;
  if (basis.kind !== 'cohort') return null;

  // The resolver's own word, not the stored column: a champion whose access has
  // lapsed resolves to `grace` or `paused`, and must not still be badged.
  if (resolution.state !== 'champion') return null;

  // DERIVED, not constant (SA R3-1/R3-2). It asserted "with no end date" as both
  // tooltip and accessible name, on the chrome of every screen — so a champion
  // whose access had been given an expiry was told the opposite of the truth
  // everywhere at once, by the one label they could not click away.
  //
  // Same field as the two sentences in the plan section: `lifecycle.accessEndsAt`.
  const endsAt = resolution.lifecycle.accessEndsAt;

  return {
    label: planLabel(config, basis.cohort),
    title:
      endsAt === null
        ? 'Everything included, free, with no end date. See your plan.'
        : 'Everything included and free for now, with an end date set. See your plan.',
    href: PLAN_SECTION_HREF,
  };
}

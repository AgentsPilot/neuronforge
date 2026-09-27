/**
 * The quiet plan pill — beside the logo in the Business OS chrome.
 *
 * ── ONE placement. Settled — please read before adding a second ───────────
 *
 * **Beside the logo in the Business OS chrome, linking to the plan section.** That
 * is the whole of it, by the user's decision of 2026-09-27.
 *
 * A `placement` prop has now been added and removed twice, so the three answers
 * are written down rather than rediscovered:
 *
 *   **Beside the plan heading in settings?** No. The heading already prints the
 *   plan name, so a pill next to it is the same words two centimetres away.
 *
 *   **In a user menu?** There is no user menu in this header — its left slot is the
 *   logo and its right is four icon buttons. One was NOT invented. The agent
 *   platform's `UserMenu` exists but Business OS does not render it, and it fetches
 *   an agent-platform subscription, which would pull that billing state into the
 *   Business OS chrome (the B-8 boundary).
 *
 *   **Somewhere else?** Then it needs a reason of its own, and this component
 *   should grow a variant at that point and not before.
 *
 * Presentational and **data-free**: the label, the tooltip and the destination
 * all arrive as a prop, decided server-side by
 * `lib/business-os/entitlements/planBadge.ts`. There is no cohort string compared
 * here, and nothing to compare it against — which was the point. A component that
 * decided who is a Founding Partner would be a second opinion about it, and the
 * one in the settings section would eventually disagree.
 *
 * Not a client component: it has no state, no effects and no handlers, so it
 * renders on the server with the layout that fetched its data.
 *
 * Deliberately quiet. A Founding Partner has everything, free, with no end date —
 * there is nothing to act on, so a banner would be a permanent interruption
 * announcing that all is well. This is a label that happens to be clickable.
 */

import Link from 'next/link';

export interface PlanBadgeProps {
  label: string;
  title: string;
  href: string;
}

export function PlanBadgePill({ label, title, href }: PlanBadgeProps) {
  return (
    <Link
      href={href}
      title={title}
      // The accessible name carries the REASON, not just the plan name: "Founding
      // Partner" alone tells a screen-reader user nothing about why it is there or
      // what following it does.
      aria-label={`${label} — ${title}`}
      data-testid="plan-badge-pill"
      className="inline-flex items-center gap-1 whitespace-nowrap border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)] hover:text-[var(--v2-primary)] transition-colors text-[11px] px-2 py-0.5"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
    >
      {label}
    </Link>
  );
}

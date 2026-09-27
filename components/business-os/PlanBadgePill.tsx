/**
 * The quiet plan pill — beside the logo in the Business OS chrome.
 *
 * ── Two placements, both real (user decision, 2026-09-27) ───────────────
 *
 *   `bar`   beside the logo in the Business OS chrome. Links to the plan section.
 *   `page`  beside the "Your plan" heading in settings. **Does not link** — there
 *           it identifies the plan, and a link from the section to itself is not
 *           navigation.
 *
 * `placement` was removed last round as an unused variant for a placement that did
 * not exist (SA R3-7), and is back now that both are rendered. It is not here
 * speculatively.
 *
 * ⚠️ **The user menu placement was asked for and is NOT built.** There is no user
 * menu in the Business OS chrome, and the agent platform's `UserMenu` is not
 * rendered by it — see the hand-off for what adding one would involve.
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
  /** Omitted for `page`, where the pill sits inside the thing it would link to. */
  href?: string;
  placement?: 'bar' | 'page';
}

export function PlanBadgePill({ label, title, href, placement = 'bar' }: PlanBadgeProps) {
  const size = placement === 'bar' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1';
  const base = `inline-flex items-center gap-1 whitespace-nowrap border border-[var(--v2-border)] bg-[var(--v2-bg)] text-[var(--v2-text-secondary)] ${size}`;
  const radius = { borderRadius: 'var(--v2-radius-button)' };

  // The accessible name carries the REASON, not just the plan name: "Founding
  // Partner" alone tells a screen-reader user nothing about why it is there.
  const accessibleName = `${label} — ${title}`;

  // A span, not a disabled link: an element with no destination should not be in
  // the tab order at all, and a link to the page you are already on is worse than
  // no link.
  if (!href) {
    return (
      <span title={title} aria-label={accessibleName} data-testid="plan-badge-pill" className={base} style={radius}>
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      title={title}
      aria-label={accessibleName}
      data-testid="plan-badge-pill"
      className={`${base} hover:border-[var(--v2-primary)] hover:text-[var(--v2-primary)] transition-colors`}
      style={radius}
    >
      {label}
    </Link>
  );
}

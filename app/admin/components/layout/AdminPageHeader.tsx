'use client';

/**
 * The admin page header (Admin Layout Standard C-2, §5.3): the page's only h1,
 * a purpose line, and an optional server-clock "As of" line.
 *
 * Generalised from Health's own header. A `<header>` with no role and no
 * `<section>` (A-9): inside `<main>` it is not a landmark, so a page's region
 * count is unchanged. L-1c adds `actions` (Audit trail's Export CSV).
 *
 * Amended by L-3: `badge` arrives with the first page that has a factual badge,
 * Archiving's "Runs off" (SA Q-3). It is data, not a node, and the header
 * renders it as the `neutral` StatusChip, so §5.3 ("at most one, a factual
 * state, the neutral chip") holds by the type. Without a badge the DOM is
 * exactly the pre-L-3 DOM: the h1 is a direct child of the first `div`.
 */

import type { ReactNode } from 'react';

import { StatusChip } from './StatusChip';

export interface AdminPageHeaderProps {
  /** Equals the sidebar label (D-3 (a)). Rendered as the page's only h1. */
  title: string;
  /** What the page is for (§5.3). */
  purpose: string;
  /** Optional server-clock line; omitted when absent. */
  asOf?: string | null;
  /** Page actions on the right (e.g. Export CSV). Never Refresh: it lives in the filter bar (§5.3). */
  actions?: ReactNode;
  /** At most one factual state beside the title (§5.3), shown as the neutral chip. */
  badge?: AdminPageHeaderBadge;
}

export interface AdminPageHeaderBadge {
  /** The state in words, e.g. "Runs off". */
  label: string;
  /** Lets a page keep its existing test id (Archiving: "runs-off-badge"). */
  testId?: string;
}

export function AdminPageHeader({ title, purpose, asOf, actions, badge }: AdminPageHeaderProps) {
  const heading = <h1 className="text-xl font-semibold text-white">{title}</h1>;
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-4">
      <div>
        {badge ? (
          <div className="flex flex-wrap items-center gap-3">
            {heading}
            <StatusChip tone="neutral" testId={badge.testId}>
              {badge.label}
            </StatusChip>
          </div>
        ) : (
          heading
        )}
        <p className="mt-1 max-w-3xl text-sm text-slate-400">{purpose}</p>
        {asOf && (
          <p data-testid="as-of" className="mt-1 text-xs text-slate-400">
            {asOf}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}

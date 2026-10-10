'use client';

/**
 * The admin page header (Admin Layout Standard C-2, §5.3): the page's only h1,
 * a purpose line, and an optional server-clock "As of" line.
 *
 * Generalised from Health's own header. A `<header>` with no role and no
 * `<section>` (A-9): inside `<main>` it is not a landmark, so a page's region
 * count is unchanged. The `badge` and `actions` props arrive with the first
 * pilot that needs them (recorded in the requirement's §1).
 */

export interface AdminPageHeaderProps {
  /** Equals the sidebar label (D-3 (a)). Rendered as the page's only h1. */
  title: string;
  /** What the page is for (§5.3). */
  purpose: string;
  /** Optional server-clock line; omitted when absent. */
  asOf?: string | null;
}

export function AdminPageHeader({ title, purpose, asOf }: AdminPageHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-700 pb-4">
      <div>
        <h1 className="text-xl font-semibold text-white">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">{purpose}</p>
        {asOf && (
          <p data-testid="as-of" className="mt-1 text-xs text-slate-400">
            {asOf}
          </p>
        )}
      </div>
    </header>
  );
}

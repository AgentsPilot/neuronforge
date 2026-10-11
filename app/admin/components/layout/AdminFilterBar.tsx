'use client';

/**
 * The admin filter bar (Admin Layout Standard C-8, §5.5).
 *
 * L-1a builds only the Refresh part. The filter controls, presets, Clear,
 * active chips and the optional "Read at" line arrive in L-1c (SA workplan
 * review ruling 3c: Health and Jobs both show a server "As of" instead,
 * §5.5 part 6). The bar is a plain `<div>`: no `search` or `region` role
 * (SA-R-13).
 */

import { RefreshCw } from 'lucide-react';

export interface AdminFilterBarProps {
  /** Re-runs the page's current read unchanged (§5.5). */
  onRefresh: () => void;
  /** A read is in flight: icon spins, aria-busy, button disabled. */
  busy: boolean;
  /** Noun phrase; the button's accessible name is "Refresh {what}". */
  what: string;
}

export function AdminFilterBar({ onRefresh, busy, what }: AdminFilterBarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="ml-auto flex items-center gap-3">
        {/* The accessible name starts with the visible text "Refresh" (WCAG 2.5.3). */}
        <button
          type="button"
          onClick={onRefresh}
          aria-label={`Refresh ${what}`}
          aria-busy={busy}
          disabled={busy}
          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </button>
      </div>
    </div>
  );
}

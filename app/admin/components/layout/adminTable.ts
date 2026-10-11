/**
 * The admin table classes (Admin Layout Standard C-13, §5.7).
 *
 * Class constants, not a component (SA Q-15): each page keeps its own
 * `<table>` markup, headers and cells, and takes its classes from here so every
 * admin table has one density and one look. Each class is a literal here so
 * Tailwind generates it.
 *
 * L-1d builds what its pilot (Audit trail) uses. The numeric cell classes
 * (`ADMIN_TH_NUM` / `ADMIN_TD_NUM`) arrived with the first table that has a
 * number column: AI cost & usage (L-2b; SA-R-3, L-1d SA Q-2).
 *
 * A plain module: no imports, no 'use client'.
 */

/** The frame: the table scrolls sideways inside it, never the page. */
export const ADMIN_TABLE_WRAP = 'overflow-x-auto rounded-xl border border-slate-700';

export const ADMIN_TABLE = 'min-w-full text-left text-sm text-slate-300';

export const ADMIN_THEAD = 'bg-slate-800/60';

/** Pages add `scope="col"` to every header cell. */
export const ADMIN_TH = 'px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400';

export const ADMIN_TBODY = 'divide-y divide-slate-800';

export const ADMIN_TD = 'px-3 py-2 align-top';

/** Right-aligned header for a number column (§5.7 Numbers). Pages add `scope="col"`. */
export const ADMIN_TH_NUM = 'px-3 py-2 text-right text-[11px] font-medium uppercase tracking-wide text-slate-400';

/** A number cell: right-aligned, tabular figures, never wrapped, never monospace (C-13). */
export const ADMIN_TD_NUM = 'px-3 py-2 align-top text-right tabular-nums whitespace-nowrap';

/** An id in a cell: pages show `formatShortId(id)` and put the full id in `title`. */
export const ADMIN_TD_ID = 'font-mono text-[11px] text-slate-400';

/** "Showing … of …" above or beside a table. */
export const ADMIN_COUNT_LINE = 'text-xs text-slate-400';

/**
 * The admin button ("style A": Refresh, "Try again") with the A-1 focus ring.
 * First consumer: the Audit trail pager (§5.7 Pagination). `AdminStates` and
 * `AdminFilterBar` still carry the same classes inline and converge on this
 * constant when either file is next touched (L-1d SA Q-7).
 */
export const ADMIN_BUTTON =
  'rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500';

/**
 * An id as a table cell shows it (§5.7 Ids): the first 8 characters and "…",
 * or an em dash when there is no id. The full id goes in the cell's `title`.
 */
export function formatShortId(id: string | null): string {
  if (!id) return '—';
  return id.length <= 8 ? id : `${id.slice(0, 8)}…`;
}

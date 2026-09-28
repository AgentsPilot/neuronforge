/**
 * The exact-window deep link into AI cost & usage (admin reorganisation
 * slice 4, SA C-9): `?dateFrom=<ISO>&dateTo=<ISO>`.
 *
 * The Health landing's spend tile links here with the window it counted, so the
 * page can show the same number (while the window holds at most 1,000 calls —
 * OI-P1, parked). Nothing more: the drill-down route, its 1,000-row note and its
 * "vs previous period" block are untouched.
 *
 * Both bounds, or neither. Each must be ISO **with an offset** (`Z` or
 * `±hh:mm`), because the value is sent to the route verbatim and must never go
 * through the custom range's browser-local `T23:59:59` path. A missing, offset-
 * less or reversed pair is ignored entirely.
 */

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface LinkedWindow {
  from: string;
  to: string;
}

interface ParamReader {
  get(name: string): string | null;
}

export function parseLinkedWindow(params: ParamReader | null | undefined): LinkedWindow | null {
  const from = params?.get('dateFrom') ?? null;
  const to = params?.get('dateTo') ?? null;
  if (!from || !to) return null;
  if (!ISO_WITH_OFFSET.test(from) || !ISO_WITH_OFFSET.test(to)) return null;
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs > toMs) return null;
  return { from, to };
}

/**
 * The current URL without the linked-window parameters, or null when it has
 * none. Clearing the chip must also clear the link, or a reload re-applies it
 * (SA code review 4). Every other parameter (`scope`, `user`) is kept.
 */
export function urlWithoutLinkedWindow(href: string): string | null {
  const url = new URL(href);
  if (!url.searchParams.has('dateFrom') && !url.searchParams.has('dateTo')) return null;
  url.searchParams.delete('dateFrom');
  url.searchParams.delete('dateTo');
  return `${url.pathname}${url.search}${url.hash}`;
}

/** "2026-09-25 08:14" in UTC, for the chip. */
export function formatLinkedBound(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * The Health landing's time windows and the spend sums per window (admin
 * reorganisation slice 4, SA C-1 and C-3). Pure: no I/O, no clock. The route
 * reads the clock ONCE and passes it in.
 *
 * ── Interval algebra (C-3) ────────────────────────────────────────────────
 *   end              = now, floored to the minute (UTC)
 *   last 24 h        = [end − 24 h, end]      inclusive both ends, like the
 *   last 7 days      = [end − 7 d,  end]      linked pages' .gte / .lte
 *   previous 24 h    = [end − 48 h, end − 24 h)   half-open, so a row exactly
 *   previous 7 days  = [end − 14 d, end − 7 d)    on a boundary counts once
 *
 * ── Exactness per sub-window (C-1) ────────────────────────────────────────
 * The spend read is newest-first, so a ceiling-truncated read loses the OLDEST
 * rows. A sub-window's sum is exact when the read completed naturally, OR when
 * the oldest row read is STRICTLY older than that sub-window's start (every row
 * the read did not reach is at least as old as the oldest it did reach, so none
 * of them can fall inside the sub-window). Strict `<`, so a tie on the boundary
 * timestamp is never assumed complete.
 *
 * @module lib/admin/health/windows
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export interface HealthWindows {
  end: Date;
  last24hStart: Date;
  previous24hStart: Date;
  last7dStart: Date;
  previous7dStart: Date;
}

/** All five bounds from one clock reading, floored to the minute (UTC). */
export function computeHealthWindows(now: Date): HealthWindows {
  const end = new Date(Math.floor(now.getTime() / MINUTE_MS) * MINUTE_MS);
  return {
    end,
    last24hStart: new Date(end.getTime() - DAY_MS),
    previous24hStart: new Date(end.getTime() - 2 * DAY_MS),
    last7dStart: new Date(end.getTime() - 7 * DAY_MS),
    previous7dStart: new Date(end.getTime() - 14 * DAY_MS),
  };
}

/** The audit page's date filter format: offsetless, minute precision, UTC wall clock (V-18). */
export function toAuditDateParam(date: Date): string {
  return date.toISOString().slice(0, 16);
}

/** A value with its honesty flag. `exact: false` = a lower bound. */
export interface Measured {
  value: number;
  exact: boolean;
}

export interface CostPoint {
  created_at: string;
  cost_usd: number | string | null;
}

export interface SpendSums {
  spend24h: Measured;
  spendPrev24h: Measured;
  spend7d: Measured;
  spendPrev7d: Measured;
  calls24h: Measured;
  calls7d: Measured;
}

/** numeric may arrive as a string; anything unparseable counts as 0 (estimated cost). */
export function toUsd(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sum the rows of one read into the four spend windows.
 *
 * @param rows      the read's rows (newest first, but the order is not relied on)
 * @param windows   from `computeHealthWindows`
 * @param completed true when the read ended on a short page (nothing left unread)
 */
export function summariseSpend(rows: readonly CostPoint[], windows: HealthWindows, completed: boolean): SpendSums {
  const end = windows.end.getTime();
  const s24 = windows.last24hStart.getTime();
  const p24 = windows.previous24hStart.getTime();
  const s7 = windows.last7dStart.getTime();
  const p7 = windows.previous7dStart.getTime();

  let spend24h = 0;
  let spendPrev24h = 0;
  let spend7d = 0;
  let spendPrev7d = 0;
  let calls24h = 0;
  let calls7d = 0;
  let oldest = Number.POSITIVE_INFINITY;

  for (const row of rows) {
    const t = Date.parse(row.created_at);
    if (!Number.isFinite(t)) continue;
    if (t < oldest) oldest = t;
    if (t > end) continue; // outside the read's window; never expected
    const cost = toUsd(row.cost_usd);

    if (t >= s24) {
      spend24h += cost;
      calls24h += 1;
    } else if (t >= p24) {
      spendPrev24h += cost;
    }

    if (t >= s7) {
      spend7d += cost;
      calls7d += 1;
    } else if (t >= p7) {
      spendPrev7d += cost;
    }
  }

  // C-1: exact when nothing is left unread, or when the read reached strictly
  // past the sub-window's start. An empty read is only possible when completed.
  const exactFrom = (start: number) => completed || oldest < start;

  return {
    spend24h: { value: spend24h, exact: exactFrom(s24) },
    spendPrev24h: { value: spendPrev24h, exact: exactFrom(p24) },
    spend7d: { value: spend7d, exact: exactFrom(s7) },
    spendPrev7d: { value: spendPrev7d, exact: exactFrom(p7) },
    calls24h: { value: calls24h, exact: exactFrom(s24) },
    calls7d: { value: calls7d, exact: exactFrom(s7) },
  };
}

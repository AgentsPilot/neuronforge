/**
 * The owner's current credit period (credit deduction slice 6a, SA SQ-20).
 *
 * ── STRINGS END TO END ───────────────────────────────────────────────────────
 * `period_start` is a microsecond `timestamptz`; a JS `Date` holds
 * milliseconds. A key rebuilt from a `Date` is the real key truncated, matches
 * no row, and the card would silently read zero. So the anchor goes from the
 * plan row to the period function as the string PostgREST returned, and the
 * period start comes back and goes to the ledger read the same way. No function
 * on the key path takes a `Date`, and a source guard pins that nothing here
 * builds a `Date` from an anchor or a period key outside the named DISPLAY
 * MATHS: `nextPeriodStartUtc` (the card's reset date, millisecond-truncated,
 * display only), `currentPeriodStartMs` and the admin row selectors. None of
 * their answers is ever sent to the database.
 *
 * ── THE THREE CASES ──────────────────────────────────────────────────────────
 *   - a plan row: the period that contains now, from the database's own rule
 *     (`business_os_credit_period_start`) — the one the charge recorder uses;
 *   - no plan row: the recorder's calendar-month rule
 *     (`date_trunc('month', now() AT TIME ZONE 'UTC')`), which is exact at the
 *     whole second, so a `Date` cannot truncate it;
 *   - a trial total: summed from the anchor itself (decided in
 *     `ownerCreditUsage.ts`, which knows the allowance's shape).
 *
 * Reads are injected (`CreditPeriodDeps`); the production wiring is
 * `ownerCreditUsageDeps.ts`, the one file that names the plan repository.
 *
 * @module lib/business-os/credits/creditPeriod
 */

type Result<T> = { data: T | null; error: Error | null };

export interface CreditPeriodDeps {
  /** The plan row's `period_anchor`, verbatim; `null` when the account has no plan row. */
  findPeriodAnchor: (accountId: string) => Promise<Result<string | null>>;
  /** `business_os_credit_period_start(anchor, at)`, verbatim. */
  periodStartFor: (anchor: string, at: string) => Promise<Result<string>>;
}

export interface ResolvedCreditPeriod {
  /** The plan anchor string, or `null` with no plan row. */
  anchor: string | null;
  /** The `period_start` key of the period that contains `at`. */
  periodStart: string;
  kind: 'monthly' | 'calendar_month';
}

/**
 * The recorder's rule with no plan row: the first instant of the UTC calendar
 * month. Pinned against the migration by a source test.
 */
export function calendarMonthStartUtc(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01T00:00:00.000Z`;
}

const TIMESTAMP_PARTS =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/;

/** Milliseconds since the epoch, for DISPLAY maths only. Fractions past the millisecond are dropped. */
function displayInstantMs(iso: string): number {
  const match = TIMESTAMP_PARTS.exec(iso);
  if (!match) return Number.NaN;
  const [, y, mo, d, h, mi, s, fraction, zone] = match;
  const millis = (fraction ?? '').padEnd(3, '0').slice(0, 3);
  const offset = zone === 'Z' ? 'Z' : zone.length === 3 ? `${zone}:00` : zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}.${millis}${offset}`);
}

/**
 * A ledger timestamp as a millisecond ISO instant, for DISPLAY only (credit
 * history, slice 7a, SA SQ-37): some browsers mis-parse six fractional
 * digits. Never a key, a filter or a page position — those travel as the
 * exact string PostgREST returned. `null` when the string does not parse.
 */
export function displayInstantIso(iso: string): string | null {
  const ms = displayInstantMs(iso);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Postgres `timestamp + interval 'n months'`: same day, clamped to the target month's last day. */
function addMonthsClampedUtc(base: Date, months: number): Date {
  const targetMonthIndex = base.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), targetMonthIndex + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      targetMonthIndex,
      Math.min(base.getUTCDate(), lastDay),
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds()
    )
  );
}

/**
 * The anchor's digits past the millisecond (0 to 999 microseconds), which a
 * `Date` drops. A missing fraction is zero. `NaN` when the string does not parse.
 */
function subMillisecondPart(iso: string): number {
  const match = TIMESTAMP_PARTS.exec(iso);
  if (!match) return Number.NaN;
  return Number((match[7] ?? '').padEnd(6, '0').slice(3));
}

/**
 * The start of the period that contains `now`, in epoch milliseconds: a TS
 * mirror of `business_os_credit_period_start(anchor, now)` (migration 20261015),
 * step for step, pinned to the SQL body by a source test (re-anchor fix, SA C-2):
 *   1. months = whole calendar months from the anchor to now, in UTC;
 *   2. candidate = anchor + months, clamped like Postgres (`addMonthsClampedUtc`);
 *   3. if candidate > now, step back one month.
 *
 * DISPLAY MATHS / ROW SELECTION ONLY: never a key, a filter or a value sent to
 * the database (keys travel as strings, see the header).
 *
 * Exact to the SQL, sub-millisecond tie included (SA C-3): `now` is a `Date`,
 * so its microseconds are zero, and the SQL's `candidate > now` is true when
 * the candidate's millisecond is later, OR equal while the anchor (whose time
 * of day every candidate keeps) has non-zero microseconds.
 *
 * `null` when the anchor does not parse.
 */
export function currentPeriodStartMs(anchorIso: string, now: Date): number | null {
  const anchorMs = displayInstantMs(anchorIso);
  const anchorMicros = subMillisecondPart(anchorIso);
  const nowMs = now.getTime();
  if (Number.isNaN(anchorMs) || Number.isNaN(anchorMicros) || Number.isNaN(nowMs)) return null;

  const anchorInstant = new Date(anchorMs);
  const months =
    (now.getUTCFullYear() - anchorInstant.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchorInstant.getUTCMonth());
  const candidateMs = addMonthsClampedUtc(anchorInstant, months).getTime();
  const isAfterNow = candidateMs > nowMs || (candidateMs === nowMs && anchorMicros > 0);
  return isAfterNow ? addMonthsClampedUtc(anchorInstant, months - 1).getTime() : candidateMs;
}

/**
 * When the current period ends — the next period's start — as an ISO instant:
 * the owner card's reset date. DISPLAY ONLY: never a key or a filter, which is
 * why it may go through `Date`. Millisecond-truncated (the anchor's
 * microseconds are dropped), which a displayed date cannot show anyway. It is
 * NOT the admin row selector: that is `isCurrentPeriodRow`, exact to the SQL tie.
 *
 * Counted FROM THE ANCHOR, the way the database counts: k = whole months from
 * the anchor to the period start, answer = anchor + (k + 1) months, clamped.
 * Never "period start + 1 month": an anchor on the 31st has a 28 February
 * period, and the next one starts on 31 March, not 28 March.
 *
 * Returns `null` when either string does not parse.
 */
export function nextPeriodStartUtc(anchorIso: string, periodStartIso: string): string | null {
  const anchorMs = displayInstantMs(anchorIso);
  const periodMs = displayInstantMs(periodStartIso);
  if (Number.isNaN(anchorMs) || Number.isNaN(periodMs)) return null;

  const anchorInstant = new Date(anchorMs);
  const periodInstant = new Date(periodMs);
  const monthsSinceAnchor =
    (periodInstant.getUTCFullYear() - anchorInstant.getUTCFullYear()) * 12 +
    (periodInstant.getUTCMonth() - anchorInstant.getUTCMonth());

  return addMonthsClampedUtc(anchorInstant, monthsSinceAnchor + 1).toISOString();
}

/**
 * Whether a totals row read by range is the CURRENT period's row (admin
 * Businesses column and finance positions, credit deduction slice 8a, SA
 * SQ-42; re-anchor fix): its key equals, to the millisecond, the period start
 * the database would give now (`currentPeriodStartMs`, the TS mirror of
 * `business_os_credit_period_start`) — the same key the owner card reads.
 *
 * Exact-key equality, never a range: after a re-anchor (a plan payment or an
 * admin tier change) old-anchor rows are not on the new anchor's boundaries,
 * and a range would count one as current. Millisecond equality is safe: every
 * key under an anchor keeps that anchor's sub-millisecond digits, and two keys
 * of one account are months apart.
 *
 * Pass `expectedStartMs` when it was already computed for the account (the
 * batched pass does, once per account); otherwise it is computed here.
 *
 * A ROW SELECTOR among rows already read, DISPLAY maths only: never a filter
 * key, never sent to the database. `false` when either string does not parse.
 */
export function isCurrentPeriodRow(
  anchorIso: string,
  periodStartIso: string,
  now: Date,
  expectedStartMs: number | null = currentPeriodStartMs(anchorIso, now)
): boolean {
  const startMs = displayInstantMs(periodStartIso);
  if (Number.isNaN(startMs) || expectedStartMs === null) return false;
  return startMs === expectedStartMs;
}

/**
 * Whether a period key is at or after the anchor — the trial total's ROW
 * SELECTOR (slice 8a). Display maths, never a filter: safe at the millisecond
 * because a trial's first period key equals its anchor and later keys are
 * months apart. `false` when either string does not parse.
 */
export function isAtOrAfter(periodStartIso: string, anchorIso: string): boolean {
  const periodMs = displayInstantMs(periodStartIso);
  const anchorMs = displayInstantMs(anchorIso);
  if (Number.isNaN(periodMs) || Number.isNaN(anchorMs)) return false;
  return periodMs >= anchorMs;
}

/**
 * The UTC midnight at or before an instant — used ONLY as a whole-day RANGE
 * BOUND (slice 8a), which no millisecond truncation can move past a row (the
 * ledger read repository's half-open rule, CR-B1). `null` when it does not parse.
 */
export function utcDayFloor(iso: string): Date | null {
  const ms = displayInstantMs(iso);
  if (Number.isNaN(ms)) return null;
  const instant = new Date(ms);
  return new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
}

/**
 * The period that contains `at` for this account. The anchor read and the
 * period function are both uncached: the recorder reads the live anchor, so the
 * card must too.
 */
export async function resolveCreditPeriod(
  accountId: string,
  at: Date,
  deps: CreditPeriodDeps
): Promise<Result<ResolvedCreditPeriod>> {
  const anchorResult = await deps.findPeriodAnchor(accountId);
  if (anchorResult.error) return { data: null, error: anchorResult.error };

  const anchor = anchorResult.data;
  if (anchor === null) {
    return { data: { anchor: null, periodStart: calendarMonthStartUtc(at), kind: 'calendar_month' }, error: null };
  }

  // The "now" side may be millisecond; only the anchor must stay exact.
  const periodResult = await deps.periodStartFor(anchor, at.toISOString());
  if (periodResult.error || periodResult.data === null) {
    return { data: null, error: periodResult.error ?? new Error('No period start returned') };
  }

  return { data: { anchor, periodStart: periodResult.data, kind: 'monthly' }, error: null };
}

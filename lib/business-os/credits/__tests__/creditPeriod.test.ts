/**
 * creditPeriod — the owner's current credit period (credit deduction slice 6a,
 * workplan §4.2, SA SQ-20).
 *
 * The property that matters most: the anchor and the period key are passed
 * through as the strings PostgREST returned. A `Date` would cut a microsecond
 * key to milliseconds, match no row, and the card would read zero.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  calendarMonthStartUtc,
  currentPeriodStartMs,
  displayInstantIso,
  isAtOrAfter,
  isCurrentPeriodRow,
  nextPeriodStartUtc,
  resolveCreditPeriod,
  utcDayFloor,
  type CreditPeriodDeps,
} from '../creditPeriod';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const ANCHOR = '2026-09-14T09:31:07.123456+00:00';
const PERIOD = '2026-09-14T09:31:07.123456+00:00';

function deps(overrides: Partial<CreditPeriodDeps> = {}) {
  const findPeriodAnchor = jest.fn<ReturnType<CreditPeriodDeps['findPeriodAnchor']>, [string]>(async () => ({
    data: ANCHOR,
    error: null,
  }));
  const periodStartFor = jest.fn<ReturnType<CreditPeriodDeps['periodStartFor']>, [string, string]>(async () => ({
    data: PERIOD,
    error: null,
  }));
  return { findPeriodAnchor, periodStartFor, ...overrides };
}

describe('resolveCreditPeriod', () => {
  it('with a plan row: the anchor string goes to the period function verbatim, and its answer comes back verbatim', async () => {
    const d = deps();
    const at = new Date('2026-09-30T12:00:00.000Z');

    const result = await resolveCreditPeriod(ACCOUNT, at, d);

    expect(result).toEqual({ data: { anchor: ANCHOR, periodStart: PERIOD, kind: 'monthly' }, error: null });
    expect(d.findPeriodAnchor).toHaveBeenCalledWith(ACCOUNT);
    expect(d.periodStartFor).toHaveBeenCalledWith(ANCHOR, '2026-09-30T12:00:00.000Z');
  });

  it('with no plan row: the recorder\'s calendar-month rule, no period function call', async () => {
    const d = deps({ findPeriodAnchor: jest.fn(async () => ({ data: null, error: null })) });

    const result = await resolveCreditPeriod(ACCOUNT, new Date('2026-09-30T23:59:59.999Z'), d);

    expect(result).toEqual({
      data: { anchor: null, periodStart: '2026-09-01T00:00:00.000Z', kind: 'calendar_month' },
      error: null,
    });
    expect(d.periodStartFor).not.toHaveBeenCalled();
  });

  it('an anchor read error is an error, never "no plan row"', async () => {
    const d = deps({ findPeriodAnchor: jest.fn(async () => ({ data: null, error: new Error('read failed') })) });
    const result = await resolveCreditPeriod(ACCOUNT, new Date(), d);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('read failed');
    expect(d.periodStartFor).not.toHaveBeenCalled();
  });

  it('a period function error is an error', async () => {
    const d = deps({ periodStartFor: jest.fn(async () => ({ data: null, error: new Error('rpc failed') })) });
    const result = await resolveCreditPeriod(ACCOUNT, new Date(), d);
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('rpc failed');
  });
});

describe('calendarMonthStartUtc', () => {
  it.each([
    ['2026-09-30T23:59:59.999Z', '2026-09-01T00:00:00.000Z'],
    ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    ['2026-12-31T23:00:00.000Z', '2026-12-01T00:00:00.000Z'],
  ])('%s → %s (UTC, whatever the host zone)', (now, expected) => {
    expect(calendarMonthStartUtc(new Date(now))).toBe(expected);
  });

  it('is the recorder\'s rule, read out of the migration (a rule change there fails here)', () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20261015_business_os_credit_charges.sql'),
      'utf8'
    );
    expect(migration).toContain("v_period := date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';");
    expect(migration).toContain("v_source := 'calendar_month';");
  });
});

describe('nextPeriodStartUtc (display only; counted from the anchor, clamped like Postgres)', () => {
  it.each([
    // k = 0, microsecond anchor: the answer keeps the time of day.
    ['k = 0', ANCHOR, PERIOD, '2026-10-14T09:31:07.123Z'],
    ['anchor 28th, December → January', '2026-12-28T08:00:00+00:00', '2026-12-28T08:00:00+00:00', '2027-01-28T08:00:00.000Z'],
    ['anchor 29th, non-leap February', '2026-01-29T08:00:00+00:00', '2026-01-29T08:00:00+00:00', '2026-02-28T08:00:00.000Z'],
    ['anchor 29th, leap February', '2028-01-29T08:00:00+00:00', '2028-01-29T08:00:00+00:00', '2028-02-29T08:00:00.000Z'],
    ['anchor 30th into February', '2026-01-30T08:00:00+00:00', '2026-01-30T08:00:00+00:00', '2026-02-28T08:00:00.000Z'],
    ['anchor 31st into February', '2026-01-31T08:00:00+00:00', '2026-01-31T08:00:00+00:00', '2026-02-28T08:00:00.000Z'],
    // After a clamped February the next period is back on the 31st, not the 28th.
    ['anchor 31st, after a clamped February', '2026-01-31T08:00:00+00:00', '2026-02-28T08:00:00+00:00', '2026-03-31T08:00:00.000Z'],
    ['anchor 29 February, next year', '2028-02-29T08:00:00+00:00', '2029-01-29T08:00:00+00:00', '2029-02-28T08:00:00.000Z'],
    ['k = 13, anchor 31st', '2025-08-31T08:00:00+00:00', '2026-09-30T08:00:00+00:00', '2026-10-31T08:00:00.000Z'],
    ['anchor with a non-UTC offset', '2026-01-31T23:30:00-02:00', '2026-02-01T01:30:00+00:00', '2026-03-01T01:30:00.000Z'],
  ])('%s', (_name, anchor, periodStart, expected) => {
    expect(nextPeriodStartUtc(anchor, periodStart)).toBe(expected);
  });

  it('returns null when a string does not parse', () => {
    expect(nextPeriodStartUtc('nope', PERIOD)).toBeNull();
    expect(nextPeriodStartUtc(ANCHOR, '')).toBeNull();
  });
});

describe('source guard: period keys never pass through Date (SQ-20, R-1)', () => {
  /** Comments stripped: prose about a Date is not a Date. */
  const codeOf = (file: string) =>
    fs
      .readFileSync(path.join(process.cwd(), file), 'utf8')
      // A Windows checkout (core.autocrlf) has CRLF; the cut regexes expect LF.
      .replace(/\r\n/g, '\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** `new Date(` or `Date.parse(` whose argument names an anchor or a period key. */
  const KEY_TO_DATE = /(new Date|Date\.parse)\(\s*[\w.?]*(anchor|periodStart|period_start|created_at|createdAt)/i;

  /** The body of `nextPeriodStartUtc` (and its display helper), the one place a Date is allowed. */
  function withoutDisplayMaths(code: string): string {
    return code
      .replace(/export function nextPeriodStartUtc[\s\S]*?\n}\n/, '')
      .replace(/function displayInstantMs[\s\S]*?\n}\n/, '')
      // Slice 7a (SA W7-4): the history's display instant, and nothing else.
      .replace(/export function displayInstantIso[\s\S]*?\n}\n/, '')
      // Re-anchor fix (SA W-2): the TS mirror of the period function, display maths only.
      .replace(/export function currentPeriodStartMs[\s\S]*?\n}\n/, '')
      // Slice 8a (SA DV-3): the admin column's row selectors and range bound, and nothing else.
      // Since the re-anchor fix `isCurrentPeriodRow` builds no Date itself; its cut is kept (harmless).
      .replace(/export function isCurrentPeriodRow[\s\S]*?\n}\n/, '')
      .replace(/export function isAtOrAfter[\s\S]*?\n}\n/, '')
      .replace(/export function utcDayFloor[\s\S]*?\n}\n/, '');
  }

  it('the rule matches planted violations', () => {
    expect(KEY_TO_DATE.test('const d = new Date(anchor);')).toBe(true);
    expect(KEY_TO_DATE.test('new Date(period.periodStart)')).toBe(true);
    expect(KEY_TO_DATE.test('Date.parse(row.period_start)')).toBe(true);
    expect(KEY_TO_DATE.test('new Date(row.created_at)')).toBe(true);
    expect(KEY_TO_DATE.test('Date.parse(cursor.createdAt)')).toBe(true);
    expect(KEY_TO_DATE.test('new Date(now)')).toBe(false);
  });

  it.each([
    'lib/business-os/credits/creditPeriod.ts',
    'lib/business-os/credits/ownerCreditUsage.ts',
    // Slice 7a (SA W7-4): the credit history's builder and its cursor.
    'lib/business-os/credits/ownerCreditHistory.ts',
    'lib/business-os/credits/creditHistoryCursor.ts',
    // Slice 8a: the admin Businesses column's batch.
    'lib/business-os/credits/adminCreditPercent.ts',
    // Slice 8b: the low-line check (keys stay strings end to end).
    'lib/business-os/credits/creditLowLine.ts',
  ])(
    '%s builds no Date from an anchor or a period key outside the display maths',
    (file) => {
      const code = withoutDisplayMaths(codeOf(file));
      expect(KEY_TO_DATE.test(code)).toBe(false);
    }
  );

  it('the exclusion really removed the display maths (so the check above is not vacuous by accident)', () => {
    const code = codeOf('lib/business-os/credits/creditPeriod.ts');
    expect(code).toMatch(/export function nextPeriodStartUtc/);
    expect(withoutDisplayMaths(code)).not.toMatch(/export function nextPeriodStartUtc/);
    expect(withoutDisplayMaths(code)).toMatch(/export async function resolveCreditPeriod/);
    expect(code).toMatch(/export function displayInstantIso/);
    expect(withoutDisplayMaths(code)).not.toMatch(/export function displayInstantIso/);
    for (const name of ['currentPeriodStartMs', 'isCurrentPeriodRow', 'isAtOrAfter', 'utcDayFloor']) {
      expect(code).toMatch(new RegExp(`export function ${name}`));
      expect(withoutDisplayMaths(code)).not.toMatch(new RegExp(`export function ${name}`));
    }
  });

  describe('the leak check (creditLeakCheck.ts): anchors and period keys never pass through Date', () => {
    // KEY_TO_DATE without created_at/createdAt: the leak check parses usage and
    // ledger ROW INSTANTS (`Date.parse(row.created_at)`) for window matching, at
    // millisecond precision by design, never a key. No display-maths cut here.
    const LEAK_KEY_TO_DATE = /(new Date|Date\.parse)\(\s*[\w.?]*(anchor|periodStart|period_start)/i;
    const LEAK_CHECK = 'lib/business-os/credits/creditLeakCheck.ts';

    it('the rule matches planted violations, and its carve-outs are deliberate', () => {
      // The pre-fold body's own line.
      expect(LEAK_KEY_TO_DATE.test('const anchorMs = Date.parse(anchorIso);')).toBe(true);
      expect(LEAK_KEY_TO_DATE.test('new Date(row.period_start)')).toBe(true);
      // Row instants for the window.
      expect(LEAK_KEY_TO_DATE.test('const t = Date.parse(row.created_at);')).toBe(false);
      // The label dedupe/sort key: labels stay verbatim, never a DB key.
      expect(LEAK_KEY_TO_DATE.test('const key = Date.parse(period);')).toBe(false);
    });

    it('builds no Date from an anchor or a period key', () => {
      const code = codeOf(LEAK_CHECK);
      expect(code).toMatch(/export function creditPeriodStartAt/);
      expect(LEAK_KEY_TO_DATE.test(code)).toBe(false);
    });

    it('one mirror only: no month-add maths of its own, it calls currentPeriodStartMs', () => {
      const code = codeOf(LEAK_CHECK);
      expect(code).not.toMatch(/addMonths/);
      expect(code).toMatch(/currentPeriodStartMs\(/);
    });
  });
});

describe('displayInstantIso (slice 7a, display only)', () => {
  it('turns a microsecond PostgREST string into a millisecond ISO instant', () => {
    expect(displayInstantIso('2026-09-30T07:00:00.123456+00:00')).toBe('2026-09-30T07:00:00.123Z');
    expect(displayInstantIso('2026-09-30T10:00:00+03:00')).toBe('2026-09-30T07:00:00.000Z');
  });

  it('answers null for anything that is not a timestamp', () => {
    expect(displayInstantIso('')).toBeNull();
    expect(displayInstantIso('yesterday')).toBeNull();
  });
});

describe('slice 8a display helpers (row selectors and a range bound — never a filter key)', () => {
  const A31 = '2026-01-31T08:00:00.123456+00:00';

  it('isCurrentPeriodRow: the row whose key is the period start the database gives now', () => {
    expect(isCurrentPeriodRow(ANCHOR, PERIOD, new Date('2026-09-30T12:00:00.000Z'))).toBe(true);
    // The first millisecond fully after the microsecond key.
    expect(isCurrentPeriodRow(ANCHOR, PERIOD, new Date('2026-09-14T09:31:07.124Z'))).toBe(true);
    // Next period: this row is no longer current.
    expect(isCurrentPeriodRow(ANCHOR, PERIOD, new Date('2026-10-14T09:31:07.124Z'))).toBe(false);
    // Before it started.
    expect(isCurrentPeriodRow(ANCHOR, PERIOD, new Date('2026-09-14T09:31:07.122Z'))).toBe(false);
    // A precomputed expected key is used as given (the batched pass computes it once per account).
    expect(isCurrentPeriodRow(ANCHOR, PERIOD, new Date('2026-09-30T12:00:00.000Z'), null)).toBe(false);
  });

  it('isCurrentPeriodRow: a re-anchor — an old-anchor row inside the "range" is not current', () => {
    // The reproduction: anchor moved to 10-12; the 10-04 row belongs to the old anchor.
    expect(isCurrentPeriodRow('2026-10-12T18:21:50Z', '2026-10-04 15:15:01+00', new Date('2026-10-12T19:00:00Z'))).toBe(false);
    expect(isCurrentPeriodRow('2026-10-12T18:21:50Z', '2026-10-12 18:21:50+00', new Date('2026-10-12T19:00:00Z'))).toBe(true);
  });

  it('isCurrentPeriodRow: an anchor on the 31st, a clamped February, a month end', () => {
    expect(isCurrentPeriodRow(A31, '2026-02-28T08:00:00.123456+00:00', new Date('2026-03-30T23:59:59.000Z'))).toBe(true);
    expect(isCurrentPeriodRow(A31, '2026-02-28T08:00:00.123456+00:00', new Date('2026-03-31T08:00:00.124Z'))).toBe(false);
    expect(isCurrentPeriodRow(A31, '2026-03-31T08:00:00.123456+00:00', new Date('2026-03-31T08:00:00.124Z'))).toBe(true);
  });

  it('isCurrentPeriodRow: false when a string does not parse', () => {
    expect(isCurrentPeriodRow('nope', PERIOD, new Date())).toBe(false);
    expect(isCurrentPeriodRow(ANCHOR, '', new Date())).toBe(false);
  });

  it('isAtOrAfter: the trial selector — the anchor itself counts, an earlier key does not', () => {
    expect(isAtOrAfter(ANCHOR, ANCHOR)).toBe(true);
    expect(isAtOrAfter('2026-10-14T09:31:07.123456+00:00', ANCHOR)).toBe(true);
    expect(isAtOrAfter('2026-08-14T09:31:07.123456+00:00', ANCHOR)).toBe(false);
    expect(isAtOrAfter('x', ANCHOR)).toBe(false);
  });

  it('utcDayFloor: the UTC midnight at or before, as a range bound', () => {
    expect(utcDayFloor(ANCHOR)?.toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(utcDayFloor('2026-09-14T01:00:00+03:00')?.toISOString()).toBe('2026-09-13T00:00:00.000Z');
    expect(utcDayFloor('nope')).toBeNull();
  });
});

describe('currentPeriodStartMs — the TS mirror of business_os_credit_period_start (re-anchor fix)', () => {
  const iso = (anchor: string, at: string) => {
    const ms = currentPeriodStartMs(anchor, new Date(at));
    return ms === null ? null : new Date(ms).toISOString();
  };

  it.each([
    ['unmoved microsecond anchor', ANCHOR, '2026-09-30T12:00:00.000Z', '2026-09-14T09:31:07.123Z'],
    ['the reproduction (re-anchored the same day)', '2026-10-12T18:21:50Z', '2026-10-12T19:00:00Z', '2026-10-12T18:21:50.000Z'],
    ['case a: backdated Stripe anchor', '2026-11-04T15:14:00Z', '2026-11-04T15:20:00Z', '2026-11-04T15:14:00.000Z'],
    ['case b: now before the anchor → anchor − 1 month', '2026-10-20T08:00:00Z', '2026-10-12T19:00:00Z', '2026-09-20T08:00:00.000Z'],
    ['anchor 31st, clamped February', '2026-01-31T08:00:00Z', '2026-02-28T09:00:00Z', '2026-02-28T08:00:00.000Z'],
    ['anchor 31st, end of March before the 31st boundary', '2026-01-31T08:00:00Z', '2026-03-30T23:59:59Z', '2026-02-28T08:00:00.000Z'],
    ['December → January year roll, stepping back', '2025-12-15T00:00:00Z', '2026-01-10T00:00:00Z', '2025-12-15T00:00:00.000Z'],
    ['December → January year roll, forward', '2025-12-28T08:00:00Z', '2026-01-29T00:00:00Z', '2026-01-28T08:00:00.000Z'],
    ['non-UTC offset anchor', '2026-01-31T23:30:00-02:00', '2026-03-15T00:00:00Z', '2026-03-01T01:30:00.000Z'],
  ])('%s', (_name, anchor, at, expected) => {
    expect(iso(anchor, at)).toBe(expected);
  });

  it('null when the anchor does not parse', () => {
    expect(currentPeriodStartMs('not-a-timestamp', new Date())).toBeNull();
    expect(currentPeriodStartMs(ANCHOR, new Date(Number.NaN))).toBeNull();
  });

  describe('C-3: the sub-millisecond tie follows the SQL ">" on microseconds', () => {
    it('was L208: at 09:31:07.123Z the .123456 key is still ahead, so SQL steps back (true → false)', () => {
      // SQL: 09-14 09:31:07.123456 > 09:31:07.123000, so the previous month.
      expect(iso(ANCHOR, '2026-09-14T09:31:07.123Z')).toBe('2026-08-14T09:31:07.123Z');
      expect(isCurrentPeriodRow(ANCHOR, PERIOD, new Date('2026-09-14T09:31:07.123Z'))).toBe(false);
    });

    it('was L210: at 10-14 09:31:07.123Z the 10-14 key is not reached, so 09-14 is still current (false → true)', () => {
      // SQL: 10-14 09:31:07.123456 > 10-14 09:31:07.123000, so it stays on 09-14.
      expect(isCurrentPeriodRow(ANCHOR, PERIOD, new Date('2026-10-14T09:31:07.123Z'))).toBe(true);
    });

    it('a whole-millisecond anchor does not step back on the tie (SQL: equal is not greater)', () => {
      expect(iso('2026-09-14T09:31:07.123000+00:00', '2026-09-14T09:31:07.123Z')).toBe('2026-09-14T09:31:07.123Z');
      expect(iso('2026-09-14T09:31:07.123Z', '2026-09-14T09:31:07.123Z')).toBe('2026-09-14T09:31:07.123Z');
    });

    it('a non-UTC offset anchor with sub-millisecond digits steps back on the tie', () => {
      // 2026-01-31T23:30:00.000500-02:00 is 2026-02-01T01:30:00.000500Z.
      expect(iso('2026-01-31T23:30:00.000500-02:00', '2026-03-01T01:30:00.000Z')).toBe('2026-02-01T01:30:00.000Z');
      expect(iso('2026-01-31T23:30:00-02:00', '2026-03-01T01:30:00.000Z')).toBe('2026-03-01T01:30:00.000Z');
    });
  });
});

describe('C-2: the mirror is pinned to the SQL body of business_os_credit_period_start', () => {
  const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations');
  const PIN_FILE = '20261015_business_os_credit_charges.sql';
  const DEFINITION = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.business_os_credit_period_start\(/;
  const flat = (text: string) => text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');

  it('the function is defined in exactly one migration (a redefinition elsewhere: re-pin to the new migration)', () => {
    const defining = fs
      .readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => DEFINITION.test(fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')));
    // A failure here means the live body moved: re-pin to the new migration.
    expect(defining).toEqual([PIN_FILE]);
  });

  it('the SQL steps are the ones the mirror implements (a change on either side must change both)', () => {
    const sql = fs.readFileSync(path.join(MIGRATIONS, PIN_FILE), 'utf8');
    const start = sql.search(DEFINITION);
    expect(start).toBeGreaterThanOrEqual(0);
    const body = flat(sql.slice(start, sql.indexOf('$period$;', start)));
    expect(body).toContain("v_anchor_utc := p_anchor AT TIME ZONE 'UTC'; v_at_utc := p_at AT TIME ZONE 'UTC';");
    expect(body).toContain(
      'v_months := (extract(year FROM v_at_utc)::integer - extract(year FROM v_anchor_utc)::integer) * 12 + (extract(month FROM v_at_utc)::integer - extract(month FROM v_anchor_utc)::integer);'
    );
    expect(body.match(/v_candidate_utc := v_anchor_utc \+ make_interval\(months => v_months\);/g)).toHaveLength(2);
    expect(body).toContain(
      'IF v_candidate_utc > v_at_utc THEN v_months := v_months - 1; v_candidate_utc := v_anchor_utc + make_interval(months => v_months); END IF;'
    );
  });

  it('the TS side: the same month difference, the clamped add twice, a strict ">" with the microsecond tie', () => {
    const code = fs.readFileSync(path.join(process.cwd(), 'lib/business-os/credits/creditPeriod.ts'), 'utf8').replace(/\r\n/g, '\n');
    const fn = code.slice(code.indexOf('export function currentPeriodStartMs'));
    const body = fn.slice(0, fn.indexOf('\n}\n'));
    expect(flat(body)).toContain(
      '(now.getUTCFullYear() - anchorInstant.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchorInstant.getUTCMonth())'
    );
    expect(body.match(/addMonthsClampedUtc\(anchorInstant, months(?: - 1)?\)/g)).toEqual([
      'addMonthsClampedUtc(anchorInstant, months)',
      'addMonthsClampedUtc(anchorInstant, months - 1)',
    ]);
    expect(body).toContain('candidateMs > nowMs || (candidateMs === nowMs && anchorMicros > 0)');
  });
});

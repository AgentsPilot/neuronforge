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

import { calendarMonthStartUtc, nextPeriodStartUtc, resolveCreditPeriod, type CreditPeriodDeps } from '../creditPeriod';

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
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

  /** `new Date(` or `Date.parse(` whose argument names an anchor or a period key. */
  const KEY_TO_DATE = /(new Date|Date\.parse)\(\s*[\w.?]*(anchor|periodStart|period_start)/i;

  /** The body of `nextPeriodStartUtc` (and its display helper), the one place a Date is allowed. */
  function withoutDisplayMaths(code: string): string {
    return code
      .replace(/export function nextPeriodStartUtc[\s\S]*?\n}\n/, '')
      .replace(/function displayInstantMs[\s\S]*?\n}\n/, '');
  }

  it('the rule matches planted violations', () => {
    expect(KEY_TO_DATE.test('const d = new Date(anchor);')).toBe(true);
    expect(KEY_TO_DATE.test('new Date(period.periodStart)')).toBe(true);
    expect(KEY_TO_DATE.test('Date.parse(row.period_start)')).toBe(true);
    expect(KEY_TO_DATE.test('new Date(now)')).toBe(false);
  });

  it.each(['lib/business-os/credits/creditPeriod.ts', 'lib/business-os/credits/ownerCreditUsage.ts'])(
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
  });
});

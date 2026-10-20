/**
 * Money MK-5b (§5.1 F-K5b, BD-9, G-3): the pure Converted this month rule.
 */

import { CONVERTED_SHOWN_LIMIT, convertedThisMonth, currentUtcMonth } from '../convertedThisMonth';

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';
const D = 'aaaaaaaa-0000-4000-8000-000000000004';
const OCT = currentUtcMonth(new Date('2026-10-20T08:00:00.000Z'));

describe('currentUtcMonth (BD-9)', () => {
  it('is the calendar month of now, in UTC, half-open', () => {
    expect(OCT).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' });
  });

  it('just after midnight UTC on the 1st is the new month; December rolls into January', () => {
    expect(currentUtcMonth(new Date('2026-11-01T00:00:00.000Z')).from).toBe('2026-11-01T00:00:00.000Z');
    expect(currentUtcMonth(new Date('2026-12-31T23:59:59.999Z'))).toEqual({ from: '2026-12-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' });
  });
});

describe('convertedThisMonth', () => {
  const run = (firstPayments: Array<{ accountId: string; paidAt: string }>, paying: string[], accounts = [A, B, C, D]) =>
    convertedThisMonth({ firstPayments, accountIds: new Set(accounts), payingIds: new Set(paying), month: OCT });

  it('counts the accounts paying now whose first payment is this month', () => {
    const result = run(
      [
        { accountId: A, paidAt: '2026-10-05T00:00:00.000Z' },
        { accountId: B, paidAt: '2026-10-01T00:00:00.000Z' },
      ],
      [A, B]
    );
    expect(result).toEqual({
      converted: 2,
      stopped: 0,
      accounts: [
        { accountId: A, firstPaymentAt: '2026-10-05T00:00:00.000Z', payingNow: true },
        { accountId: B, firstPaymentAt: '2026-10-01T00:00:00.000Z', payingNow: true },
      ],
    });
  });

  it('"converted, no longer paying": listed, never counted', () => {
    const result = run([{ accountId: C, paidAt: '2026-10-05T00:00:00.000Z' }], []);
    expect(result.converted).toBe(0);
    expect(result.stopped).toBe(1);
    expect(result.accounts).toEqual([{ accountId: C, firstPaymentAt: '2026-10-05T00:00:00.000Z', payingNow: false }]);
  });

  it('a first payment last month (or on the next 1st) is not this month (G-3: first payment only)', () => {
    const result = run(
      [
        { accountId: A, paidAt: '2026-09-30T23:59:59.999Z' },
        { accountId: B, paidAt: '2026-11-01T00:00:00.000Z' },
      ],
      [A, B]
    );
    expect(result).toEqual({ converted: 0, stopped: 0, accounts: [] });
  });

  it('an account outside the given set, or an unreadable date, is never counted', () => {
    const result = run(
      [
        { accountId: D, paidAt: '2026-10-05T00:00:00.000Z' },
        { accountId: A, paidAt: 'not a date' },
      ],
      [A, D],
      [A, B, C]
    );
    expect(result).toEqual({ converted: 0, stopped: 0, accounts: [] });
  });

  it('newest first payment first, then by id', () => {
    const result = run(
      [
        { accountId: B, paidAt: '2026-10-02T00:00:00.000Z' },
        { accountId: C, paidAt: '2026-10-09T00:00:00.000Z' },
        { accountId: A, paidAt: '2026-10-02T00:00:00.000Z' },
      ],
      [A, B, C]
    );
    expect(result.accounts.map((a) => a.accountId)).toEqual([C, A, B]);
  });

  it('is not capped: the caller caps the list at CONVERTED_SHOWN_LIMIT, the figure counts all', () => {
    expect(CONVERTED_SHOWN_LIMIT).toBe(100);
    const ids = Array.from({ length: 120 }, (_, i) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const result = convertedThisMonth({
      firstPayments: ids.map((accountId) => ({ accountId, paidAt: '2026-10-05T00:00:00.000Z' })),
      accountIds: new Set(ids),
      payingIds: new Set(ids),
      month: OCT,
    });
    expect(result.converted).toBe(120);
    expect(result.accounts).toHaveLength(120);
  });
});

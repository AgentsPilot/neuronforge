/**
 * Money MK-5b (SA-10, Q-12 / G-1), re-sourced by MK5B-FU-1 (SA-WP-M5F): the
 * first plan payment per account in the CURRENT Stripe mode. Runs through the
 * REAL admin billing reader over an in-memory billing events table and its
 * reference first-payment view (`tests/helpers/fakeFirstPaymentDb.ts`), so the
 * mode, range and id filters are the production query shapes, not mock answers.
 */

import * as fs from 'fs';
import * as path from 'path';

import { BusinessOsBillingAdminReadRepository } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { fakeFirstPaymentDb, type FakeBillingEvent } from '@/tests/helpers/fakeFirstPaymentDb';
import { listCurrentModeFirstPlanPayments, type FirstPlanPaymentsQuery } from '../firstPlanPayments';

const A = '44444444-4444-4444-8444-000000000001';
const B = '44444444-4444-4444-8444-000000000002';
const C = '44444444-4444-4444-8444-000000000003';
const OTHER = '44444444-4444-4444-8444-000000000099';
const OCT = { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' };

const ev = (id: string, user: string, patch: Partial<FakeBillingEvent>): FakeBillingEvent => ({
  id,
  user_id: user,
  kind: 'invoice_paid',
  livemode: false,
  amount_minor: 1900,
  paid_at: '2026-10-05T10:00:00.000Z',
  ...patch,
});

const TABLE: FakeBillingEvent[] = [
  // A: a test-mode payment in August, and its first live one in October.
  ev('00000000-0000-4000-9000-000000000001', A, { livemode: false, paid_at: '2026-08-01T00:00:00.000Z' }),
  ev('00000000-0000-4000-9000-000000000002', A, { livemode: true, paid_at: '2026-10-03T00:00:00.000Z' }),
  // B: a zero invoice first (not a first payment), then a real one.
  ev('00000000-0000-4000-9000-000000000003', B, { amount_minor: 0, paid_at: '2026-09-01T00:00:00.000Z' }),
  ev('00000000-0000-4000-9000-000000000004', B, { paid_at: '2026-10-07T00:00:00.000Z' }),
  // B: a failed payment is not a paid invoice.
  ev('00000000-0000-4000-9000-000000000005', B, { kind: 'invoice_payment_failed', paid_at: '2026-08-15T00:00:00.000Z' }),
  // Another account, never asked for by id; its first test-mode payment is in October.
  ev('00000000-0000-4000-9000-000000000006', OTHER, { paid_at: '2026-10-01T00:00:00.000Z' }),
];

const run = (query: FirstPlanPaymentsQuery, mode: 'test' | 'live') => {
  const fake = fakeFirstPaymentDb(TABLE);
  return listCurrentModeFirstPlanPayments(query, {
    reader: new BusinessOsBillingAdminReadRepository(fake.client),
    mode: () => mode,
  }).then((result) => ({ result, queries: fake.queries }));
};
const byId = (accountIds: string[]): FirstPlanPaymentsQuery => ({ accountIds, firstPaymentIn: null });

describe('listCurrentModeFirstPlanPayments (MK-5b, MK5B-FU-1)', () => {
  it('current mode only (G-1): in live mode A first paid in October, not August (that was test mode)', async () => {
    const { result } = await run(byId([A, B, C]), 'live');
    expect(result).toEqual({ data: [{ accountId: A, paidAt: '2026-10-03T00:00:00.000Z' }], error: null });
  });

  it('in test mode: the earliest paid invoice ABOVE ZERO (a zero invoice and a failed payment never count)', async () => {
    const { result } = await run(byId([A, B, C]), 'test');
    expect(result.data).toEqual([
      { accountId: A, paidAt: '2026-08-01T00:00:00.000Z' },
      { accountId: B, paidAt: '2026-10-07T00:00:00.000Z' },
    ]);
  });

  it('by id only: reads exactly the given accounts, only the first-payment view (a boost is never a first payment)', async () => {
    const { result, queries } = await run(byId([A]), 'test');
    expect(result.data?.map((row) => row.accountId)).toEqual([A]);
    expect(queries.map((q) => q.table)).toEqual(['business_os_first_plan_payments']);
    expect(queries[0].filters.some((f) => f.column === 'first_payment_at')).toBe(false);
  });

  it('range only: every account whose first payment is in the range, in the current mode', async () => {
    const { result, queries } = await run({ accountIds: [], firstPaymentIn: OCT }, 'test');
    // B (Oct 7) and OTHER (Oct 1); A first paid in August in test mode.
    expect(result.data).toEqual([
      { accountId: B, paidAt: '2026-10-07T00:00:00.000Z' },
      { accountId: OTHER, paidAt: '2026-10-01T00:00:00.000Z' },
    ]);
    expect(queries).toHaveLength(1);
    expect(queries[0].filters).toEqual(
      expect.arrayContaining([
        { op: 'eq', column: 'livemode', value: false },
        { op: 'gte', column: 'first_payment_at', value: OCT.from },
        { op: 'lt', column: 'first_payment_at', value: OCT.to },
      ])
    );
  });

  it('both: joined by account, one row each, sorted; the mode is resolved once and used for both', async () => {
    const mode = jest.fn(() => 'test' as const);
    const fake = fakeFirstPaymentDb(TABLE);
    const result = await listCurrentModeFirstPlanPayments(
      { accountIds: [A, B], firstPaymentIn: OCT },
      { reader: new BusinessOsBillingAdminReadRepository(fake.client), mode }
    );
    expect(result.data).toEqual([
      { accountId: A, paidAt: '2026-08-01T00:00:00.000Z' },
      { accountId: B, paidAt: '2026-10-07T00:00:00.000Z' },
      { accountId: OTHER, paidAt: '2026-10-01T00:00:00.000Z' },
    ]);
    expect(mode).toHaveBeenCalledTimes(1);
    expect(fake.queries).toHaveLength(2);
    for (const q of fake.queries) expect(q.filters).toContainEqual({ op: 'eq', column: 'livemode', value: false });
  });

  it('neither: no read, nothing found', async () => {
    const { result, queries } = await run({ accountIds: [], firstPaymentIn: null }, 'test');
    expect(result).toEqual({ data: [], error: null });
    expect(queries).toHaveLength(0);
  });

  it('the two reads disagreeing for one account is an ERROR, never a pick', async () => {
    const reader = {
      listFirstPlanPaymentsInRangeAllAccounts: jest.fn(async () => ({ data: [{ user_id: A, paid_at: '2026-10-02T00:00:00.000Z' }], error: null })),
      listFirstPlanPaymentsForAccounts: jest.fn(async () => ({ data: [{ user_id: A, paid_at: '2026-10-03T00:00:00.000Z' }], error: null })),
    };
    const result = await listCurrentModeFirstPlanPayments({ accountIds: [A], firstPaymentIn: OCT }, { reader, mode: () => 'test' });
    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/disagree/);
  });

  it('the same instant written two ways is the same payment, not a disagreement', async () => {
    const reader = {
      listFirstPlanPaymentsInRangeAllAccounts: jest.fn(async () => ({ data: [{ user_id: A, paid_at: '2026-10-02T00:00:00.000Z' }], error: null })),
      listFirstPlanPaymentsForAccounts: jest.fn(async () => ({ data: [{ user_id: A, paid_at: '2026-10-02T00:00:00+00:00' }], error: null })),
    };
    const result = await listCurrentModeFirstPlanPayments({ accountIds: [A], firstPaymentIn: OCT }, { reader, mode: () => 'test' });
    expect(result).toEqual({ data: [{ accountId: A, paidAt: '2026-10-02T00:00:00.000Z' }], error: null });
  });

  it('an unknown key mode reads nothing and fails closed', async () => {
    const reader = { listFirstPlanPaymentsForAccounts: jest.fn(), listFirstPlanPaymentsInRangeAllAccounts: jest.fn() };
    const result = await listCurrentModeFirstPlanPayments(
      { accountIds: [A], firstPaymentIn: OCT },
      {
        reader,
        mode: () => {
          throw new Error('stripe_key_mode_unknown');
        },
      }
    );
    expect(result).toEqual({ data: null, error: expect.objectContaining({ message: 'stripe_key_mode_unknown' }) });
    expect(reader.listFirstPlanPaymentsForAccounts).not.toHaveBeenCalled();
    expect(reader.listFirstPlanPaymentsInRangeAllAccounts).not.toHaveBeenCalled();
  });

  it('either reader error (the ceiling, isolation, the database) fails the whole read (M5F-7), never a partial list', async () => {
    const error = new Error('ceiling');
    const okRows = async () => ({ data: [{ user_id: A, paid_at: '2026-10-02T00:00:00.000Z' }], error: null });
    const rangeFails = { listFirstPlanPaymentsInRangeAllAccounts: jest.fn(async () => ({ data: null, error })), listFirstPlanPaymentsForAccounts: jest.fn(okRows) };
    expect(await listCurrentModeFirstPlanPayments({ accountIds: [A], firstPaymentIn: OCT }, { reader: rangeFails, mode: () => 'test' })).toEqual({ data: null, error });
    expect(rangeFails.listFirstPlanPaymentsInRangeAllAccounts).toHaveBeenCalledWith(OCT, false);

    const idsFail = { listFirstPlanPaymentsInRangeAllAccounts: jest.fn(okRows), listFirstPlanPaymentsForAccounts: jest.fn(async () => ({ data: null, error })) };
    expect(await listCurrentModeFirstPlanPayments({ accountIds: [A], firstPaymentIn: OCT }, { reader: idsFail, mode: () => 'live' })).toEqual({ data: null, error });
    expect(idsFail.listFirstPlanPaymentsForAccounts).toHaveBeenCalledWith([A], true);
  });

  it('source: server-only, maps field by field, names no Stripe id', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'firstPlanPayments.ts'), 'utf8');
    expect(code).toContain("import 'server-only';");
    expect(code).toMatch(/\(\{ accountId: row\.user_id, paidAt: row\.paid_at \}\)/);
    expect(code).not.toMatch(/stripe_(customer|invoice|subscription)_id/);
  });
});

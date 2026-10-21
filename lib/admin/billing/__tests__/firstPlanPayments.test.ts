/**
 * Money MK-5b (SA-10, Q-12 / G-1): the first plan payment per account in the
 * CURRENT Stripe mode. Runs through the REAL admin billing reader over a small
 * in-memory billing events table, so the mode, kind and amount filters are the
 * production query shapes, not mock answers.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessOsBillingAdminReadRepository } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { listCurrentModeFirstPlanPayments } from '../firstPlanPayments';

type Row = Record<string, unknown>;

/** A table supporting eq / gt / not-is-null / in / order(id) / limit, as the reader uses them. */
function fakeClient(table: Row[]) {
  const reads: string[] = [];
  const client = {
    from: (name: string) => {
      reads.push(name);
      const filters: Array<(row: Row) => boolean> = [];
      let limit = Infinity;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => (filters.push((row) => row[col] === val), builder),
        gt: (col: string, val: unknown) =>
          (filters.push((row) => (typeof val === 'number' ? Number(row[col]) > val : String(row[col]) > String(val))), builder),
        not: (col: string, _op: string, _val: null) => (filters.push((row) => row[col] !== null && row[col] !== undefined), builder),
        in: (col: string, vals: unknown[]) => (filters.push((row) => vals.includes(row[col])), builder),
        order: () => builder,
        limit: (n: number) => ((limit = n), builder),
        then: (resolve: (v: unknown) => void) =>
          resolve({
            data: table
              .filter((row) => filters.every((f) => f(row)))
              .sort((a, b) => String(a.id).localeCompare(String(b.id)))
              .slice(0, limit)
              .map((row) => ({ id: row.id, user_id: row.user_id, paid_at: row.paid_at })),
            error: null,
          }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, reads };
}

const A = '44444444-4444-4444-8444-000000000001';
const B = '44444444-4444-4444-8444-000000000002';
const C = '44444444-4444-4444-8444-000000000003';
const OTHER = '44444444-4444-4444-8444-000000000099';

const ev = (id: string, user: string, patch: Row): Row => ({
  id,
  user_id: user,
  kind: 'invoice_paid',
  livemode: false,
  amount_minor: 1900,
  paid_at: '2026-10-05T10:00:00.000Z',
  ...patch,
});

const TABLE: Row[] = [
  // A: a test-mode payment in August, and its first live one in October.
  ev('e01', A, { livemode: false, paid_at: '2026-08-01T00:00:00.000Z' }),
  ev('e02', A, { livemode: true, paid_at: '2026-10-03T00:00:00.000Z' }),
  // B: a zero invoice first (not a first payment), then a real one.
  ev('e03', B, { amount_minor: 0, paid_at: '2026-09-01T00:00:00.000Z' }),
  ev('e04', B, { paid_at: '2026-10-07T00:00:00.000Z' }),
  // B: a failed payment is not a paid invoice.
  ev('e05', B, { kind: 'invoice_payment_failed', paid_at: '2026-08-15T00:00:00.000Z' }),
  // Another account, never asked for.
  ev('e06', OTHER, { paid_at: '2026-10-01T00:00:00.000Z' }),
];

const run = (ids: string[], mode: 'test' | 'live') => {
  const fake = fakeClient(TABLE);
  return listCurrentModeFirstPlanPayments(ids, {
    reader: new BusinessOsBillingAdminReadRepository(fake.client),
    mode: () => mode,
  }).then((result) => ({ result, reads: fake.reads }));
};

describe('listCurrentModeFirstPlanPayments (MK-5b)', () => {
  it('current mode only (G-1): in live mode A first paid in October, not August (that was test mode)', async () => {
    const { result } = await run([A, B, C], 'live');
    expect(result).toEqual({ data: [{ accountId: A, paidAt: '2026-10-03T00:00:00.000Z' }], error: null });
  });

  it('in test mode: the earliest paid invoice ABOVE ZERO (a zero invoice and a failed payment never count)', async () => {
    const { result } = await run([A, B, C], 'test');
    expect(result.data).toEqual([
      { accountId: A, paidAt: '2026-08-01T00:00:00.000Z' },
      { accountId: B, paidAt: '2026-10-07T00:00:00.000Z' },
    ]);
  });

  it('reads exactly the given accounts, and only the billing events table (a boost is never a first payment)', async () => {
    const { result, reads } = await run([A], 'test');
    expect(result.data?.map((row) => row.accountId)).toEqual([A]);
    expect(reads).toEqual(['business_os_billing_events']);
  });

  it('an unknown key mode reads nothing and fails closed', async () => {
    const reader = { listFirstPlanPaymentsForAccounts: jest.fn() };
    const result = await listCurrentModeFirstPlanPayments([A], {
      reader,
      mode: () => {
        throw new Error('stripe_key_mode_unknown');
      },
    });
    expect(result).toEqual({ data: null, error: expect.objectContaining({ message: 'stripe_key_mode_unknown' }) });
    expect(reader.listFirstPlanPaymentsForAccounts).not.toHaveBeenCalled();
  });

  it('a reader error (the ceiling, isolation, the database) is passed on, never a partial list', async () => {
    const error = new Error('ceiling');
    const reader = { listFirstPlanPaymentsForAccounts: jest.fn(async () => ({ data: null, error })) };
    expect(await listCurrentModeFirstPlanPayments([A], { reader, mode: () => 'test' })).toEqual({ data: null, error });
    expect(reader.listFirstPlanPaymentsForAccounts).toHaveBeenCalledWith([A], false);
  });

  it('source: server-only, maps field by field, names no Stripe id', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'firstPlanPayments.ts'), 'utf8');
    expect(code).toContain("import 'server-only';");
    expect(code).toMatch(/\(\{ accountId: row\.user_id, paidAt: row\.paid_at \}\)/);
    expect(code).not.toMatch(/stripe_(customer|invoice|subscription)_id/);
  });
});

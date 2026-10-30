/**
 * Unit tests for `StripeConnectRepository.countOtherUsersNamingStripeAccount`
 * (self-service exit SX-5 / D5, W-10).
 *
 * The delete asks whether another business's Express row names the account it
 * is about to release. Only a count may come back: the owner lookup
 * `findOwnerIdByStripeAccountId` stays the webhook resolver's alone (CF-5 PR 5
 * tenant-isolation guard). A head-only count, the account filter, and the
 * caller excluded; a read error is passed through with no number.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/logger', () => {
  const l: Record<string, unknown> = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'trace', 'fatal']) l[level] = () => undefined;
  l.child = () => l;
  return { createLogger: () => l };
});

import { StripeConnectRepository } from '@/lib/repositories/PaymentRepository';

type Call = [method: string, ...args: unknown[]];

function recordingClient(answer: { count: number | null; error: unknown }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(answer).then(resolve, reject),
  };
  for (const method of ['select', 'eq', 'neq', 'maybeSingle']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  const client = {
    from: (table: string) => {
      calls.push(['from', table]);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('StripeConnectRepository.countOtherUsersNamingStripeAccount (D5, W-10)', () => {
  it('counts other businesses only, head-only, by account id', async () => {
    const { client, calls } = recordingClient({ count: 1, error: null });
    const result = await new StripeConnectRepository(client).countOtherUsersNamingStripeAccount('acct_a', 'user-1');
    expect(result).toEqual({ data: 1, error: null });
    expect(calls).toEqual([
      ['from', 'stripe_connect_accounts'],
      ['select', 'id', { count: 'exact', head: true }],
      ['eq', 'stripe_account_id', 'acct_a'],
      ['neq', 'user_id', 'user-1'],
    ]);
  });

  it('no other row → 0', async () => {
    const { client } = recordingClient({ count: null, error: null });
    expect(await new StripeConnectRepository(client).countOtherUsersNamingStripeAccount('acct_a', 'user-1')).toEqual({ data: 0, error: null });
  });

  it('a read error → no number, the error passed through', async () => {
    const error = { code: '42P01', message: 'x' };
    const { client } = recordingClient({ count: null, error });
    expect(await new StripeConnectRepository(client).countOtherUsersNamingStripeAccount('acct_a', 'user-1')).toEqual({ data: null, error });
  });
});

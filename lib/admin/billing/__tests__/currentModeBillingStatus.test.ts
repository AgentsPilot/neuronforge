/**
 * Finance R4 (P8A-R4): billing STATUS for the current Stripe mode only.
 * Workplan docs/workplans/BUSINESS_OS_FINANCE_HEALTH_R4_BILLING_MODE_WORKPLAN.md.
 *
 * The two-row case (one account with a test row AND a live row, legal under
 * UNIQUE (user_id, livemode)) runs through the REAL P-8a reader over a small
 * recording client, so the mode filter, the keyset and the page size are the
 * production query shapes, not mock answers.
 */

import * as fs from 'fs';
import * as path from 'path';

import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessOsBillingAdminReadRepository } from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import {
  CurrentModeBillingDuplicateError,
  findCurrentModeBillingStatusForAccount,
  listCurrentModeBillingStatusesAllAccounts,
  type CurrentModeBillingStatusDeps,
} from '../currentModeBillingStatus';
import type { StripeMode } from '@/lib/business-os/billing/stripeMode';

type Row = Record<string, unknown>;
interface Recorded {
  filters: Array<[string, string, unknown]>;
  limit: number | null;
  terminal: 'many' | 'maybeSingle';
}

/** A billing table with eq / gt / order / limit / maybeSingle, recording each query. */
function fakeClient(table: Row[]) {
  const queries: Recorded[] = [];
  const from = () => {
    const q: Recorded = { filters: [], limit: null, terminal: 'many' };
    let orderBy: string | null = null;
    const run = () => {
      queries.push(q);
      let rows = table.filter((row) =>
        q.filters.every(([op, col, val]) => (op === 'eq' ? row[col] === val : String(row[col]) > String(val)))
      );
      if (orderBy) rows = [...rows].sort((a, b) => String(a[orderBy as string]).localeCompare(String(b[orderBy as string])));
      if (q.limit !== null) rows = rows.slice(0, q.limit);
      if (q.terminal === 'maybeSingle') {
        if (rows.length > 1) return { data: null, error: { message: 'JSON object requested, multiple rows returned' } };
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    };
    const builder = {
      select: () => builder,
      eq: (col: string, val: unknown) => (q.filters.push(['eq', col, val]), builder),
      gt: (col: string, val: unknown) => (q.filters.push(['gt', col, val]), builder),
      order: (col: string) => ((orderBy = col), builder),
      limit: (n: number) => ((q.limit = n), builder),
      maybeSingle: () => ((q.terminal = 'maybeSingle'), Promise.resolve(run())),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, queries };
}

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const billingRow = (id: string, userId: string | null, isLive: boolean, status: string, extra: Row = {}): Row => ({
  id,
  user_id: userId,
  livemode: isLive,
  subscription_status: status,
  bought_tier: 'tier_a',
  current_period_end: null,
  cancel_at_period_end: false,
  pending_tier: null,
  last_paid_at: null,
  last_payment_failed_at: null,
  failed_attempts: 0,
  founder_discount_applied_at: null,
  ended_at: null,
  stripe_customer_id: 'cus_secret',
  ...extra,
});

/** The owner has a test row AND a live row (the live-key day); another account has a test row only. */
const TWO_MODE_TABLE: Row[] = [
  billingRow('a-test-owner', OWNER, false, 'canceled', { ended_at: '2026-10-01T00:00:00.000Z' }),
  billingRow('b-live-owner', OWNER, true, 'active', { bought_tier: 'tier_b' }),
  billingRow('c-test-other', OTHER, false, 'active'),
  billingRow('d-test-detached', null, false, 'active'),
];

const depsFor = (table: Row[], mode: StripeMode) => {
  const { client, queries } = fakeClient(table);
  const deps: CurrentModeBillingStatusDeps = { reader: new BusinessOsBillingAdminReadRepository(client), mode: () => mode };
  return { deps, queries };
};

describe('R-c, current mode: an account with a test row and a live row (P8A-R4)', () => {
  it('live key: one row per account, the live one, and no duplicate error', async () => {
    const { deps, queries } = depsFor(TWO_MODE_TABLE, 'live');
    const result = await listCurrentModeBillingStatusesAllAccounts(undefined, deps);
    expect(result).toEqual({
      data: [{ user_id: OWNER, subscription_status: 'active', ended_at: null, bought_tier: 'tier_b' }],
      error: null,
    });
    expect(queries.every((q) => q.filters.some(([op, col, val]) => op === 'eq' && col === 'livemode' && val === true))).toBe(true);
  });

  it('test key: the test rows only, the owner once, the detached row dropped', async () => {
    const { deps, queries } = depsFor(TWO_MODE_TABLE, 'test');
    const result = await listCurrentModeBillingStatusesAllAccounts(undefined, deps);
    expect(result.error).toBeNull();
    expect(result.data).toEqual([
      { user_id: OWNER, subscription_status: 'canceled', ended_at: '2026-10-01T00:00:00.000Z', bought_tier: 'tier_a' },
      { user_id: OTHER, subscription_status: 'active', ended_at: null, bought_tier: 'tier_a' },
    ]);
    expect(queries.every((q) => q.filters.some(([op, col, val]) => op === 'eq' && col === 'livemode' && val === false))).toBe(true);
  });

  it('only the four status fields travel (no Stripe id, no mode, no row id)', async () => {
    const { deps } = depsFor(TWO_MODE_TABLE, 'live');
    const result = await listCurrentModeBillingStatusesAllAccounts(undefined, deps);
    expect(Object.keys(result.data?.[0] ?? {}).sort()).toEqual(['bought_tier', 'ended_at', 'subscription_status', 'user_id']);
  });

  it('pages at 1,000: a full page is followed by the next one', async () => {
    const table = Array.from({ length: 1001 }, (_, i) =>
      billingRow(`id-${String(i).padStart(5, '0')}`, `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, false, 'active')
    );
    const { deps, queries } = depsFor(table, 'test');
    const result = await listCurrentModeBillingStatusesAllAccounts(undefined, deps);
    expect(result.data).toHaveLength(1001);
    expect(queries.map((q) => q.limit)).toEqual([1000, 1000]);
    expect(queries[1].filters).toContainEqual(['gt', 'id', 'id-00999']);
  });

  it('passes the options to the reader (a small page)', async () => {
    const { deps, queries } = depsFor(TWO_MODE_TABLE, 'test');
    await listCurrentModeBillingStatusesAllAccounts({ pageSize: 1 }, deps);
    expect(queries.every((q) => q.limit === 1)).toBe(true);
  });

  it('a same-mode duplicate (planted; UNIQUE makes it unreachable) is an error, never a guess', async () => {
    const table = [billingRow('x1', OWNER, true, 'active'), billingRow('x2', OWNER, true, 'past_due')];
    const { deps } = depsFor(table, 'live');
    const result = await listCurrentModeBillingStatusesAllAccounts(undefined, deps);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(CurrentModeBillingDuplicateError);
  });

  it('an unknown key fails closed with zero queries', async () => {
    const { client, queries } = fakeClient(TWO_MODE_TABLE);
    const result = await listCurrentModeBillingStatusesAllAccounts(undefined, {
      reader: new BusinessOsBillingAdminReadRepository(client),
      mode: () => {
        throw new Error('stripe_key_mode_unknown');
      },
    });
    expect(result).toEqual({ data: null, error: new Error('stripe_key_mode_unknown') });
    expect(queries).toHaveLength(0);
  });

  it('a reader error is passed on', async () => {
    const error = new Error('boom');
    const result = await listCurrentModeBillingStatusesAllAccounts(undefined, {
      reader: { listBillingRowsForModeAllAccounts: async () => ({ data: null, error }), findBillingRowForAccount: async () => ({ data: null, error: null }) },
      mode: () => 'test',
    });
    expect(result).toEqual({ data: null, error });
  });
});

describe("R-c′, current mode: the same two-row account, picked (P8A-R4)", () => {
  it('live key: the live row, no maybeSingle error', async () => {
    const { deps, queries } = depsFor(TWO_MODE_TABLE, 'live');
    const result = await findCurrentModeBillingStatusForAccount(OWNER, deps);
    expect(result).toEqual({
      data: { user_id: OWNER, subscription_status: 'active', ended_at: null, bought_tier: 'tier_b' },
      error: null,
    });
    expect(queries).toHaveLength(1);
    expect(queries[0].terminal).toBe('maybeSingle');
    expect(queries[0].filters).toEqual(
      expect.arrayContaining([['eq', 'user_id', OWNER], ['eq', 'livemode', true]])
    );
  });

  it('test key: the test row', async () => {
    const { deps } = depsFor(TWO_MODE_TABLE, 'test');
    const result = await findCurrentModeBillingStatusForAccount(OWNER, deps);
    expect(result.data).toEqual({ user_id: OWNER, subscription_status: 'canceled', ended_at: '2026-10-01T00:00:00.000Z', bought_tier: 'tier_a' });
  });

  it('control: without the mode filter the same account errors (the bug being fixed)', async () => {
    const { client } = fakeClient(TWO_MODE_TABLE);
    const unfiltered = await (client.from('business_os_billing_accounts') as unknown as {
      select: () => { eq: (c: string, v: unknown) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> } };
    })
      .select()
      .eq('user_id', OWNER)
      .maybeSingle();
    expect(unfiltered.error).not.toBeNull();
  });

  it('no row in the current mode is null, not an error', async () => {
    const { deps } = depsFor(TWO_MODE_TABLE, 'live');
    expect(await findCurrentModeBillingStatusForAccount(OTHER, deps)).toEqual({ data: null, error: null });
  });

  it('only the four status fields travel (the panel read carries the customer id; it stops here)', async () => {
    const { deps } = depsFor(TWO_MODE_TABLE, 'live');
    const result = await findCurrentModeBillingStatusForAccount(OWNER, deps);
    expect(Object.keys(result.data ?? {}).sort()).toEqual(['bought_tier', 'ended_at', 'subscription_status', 'user_id']);
  });

  it('a malformed account id is refused by the reader, with zero queries', async () => {
    const { deps, queries } = depsFor(TWO_MODE_TABLE, 'live');
    const result = await findCurrentModeBillingStatusForAccount('not-a-uuid', deps);
    expect(result.data).toBeNull();
    expect(result.error).not.toBeNull();
    expect(queries).toHaveLength(0);
  });

  it('an unknown key fails closed with zero queries', async () => {
    const { client, queries } = fakeClient(TWO_MODE_TABLE);
    const result = await findCurrentModeBillingStatusForAccount(OWNER, {
      reader: new BusinessOsBillingAdminReadRepository(client),
      mode: () => {
        throw new Error('stripe_key_mode_unknown');
      },
    });
    expect(result.data).toBeNull();
    expect(queries).toHaveLength(0);
  });
});

describe('the finance wiring uses the current-mode reads (R4)', () => {
  const code = fs
    .readFileSync(path.join(process.cwd(), 'lib/business-os/finance/financeHealthDeps.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('wires both billing-status names to the current-mode functions', () => {
    expect(code).toMatch(/listBillingStatusesAllAccounts: \(opts\) => listCurrentModeBillingStatusesAllAccounts\(opts\)/);
    expect(code).toMatch(/findBillingStatusForAccount: \(accountId\) => findCurrentModeBillingStatusForAccount\(accountId\)/);
  });

  it('no longer calls the unfiltered R-c or R-c′', () => {
    expect(code).not.toMatch(/businessOsFinanceReadRepository\.(listBillingStatusesAllAccounts|findBillingStatusForAccount)\(/);
  });
});

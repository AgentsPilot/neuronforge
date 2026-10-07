/**
 * Unit tests for BusinessOsBillingEventRepository (plan payments P-3b.1;
 * workplan BUSINESS_OS_PLAN_PAYMENTS_P3B_WORKPLAN.md §3.2, §4, §8; SA C-1 to
 * C-3, Q-11; new-repository and tenant-isolation-guard skills).
 *
 * What matters here: the RPC receives exactly the eighteen named arguments
 * (never a spread), every answer of the function is mapped strictly (an
 * unknown status or an unreadable id is an error, never a guess), invalid
 * input never reaches the database, the insert is an explicit allow-list that
 * can never write `invoice_paid` or `plan_written`, a redelivered event id is
 * `duplicate` and not an error, nothing is ever thrown, and only the listed
 * files may name the repository.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
const mockInfo = jest.fn();
const mockError = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...args: unknown[]) => mockInfo(...args),
      warn: jest.fn(),
      error: (...args: unknown[]) => mockError(...args),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import {
  BILLING_EVENT_COLUMNS,
  BILLING_EVENT_KINDS,
  BOS_APPLY_PLAN_PAYMENT_RPC,
  BOS_BILLING_EVENTS_TABLE,
  BusinessOsBillingEventRepository,
  businessOsBillingEventRepository,
  type BusinessOsApplyPlanPaymentInput,
  type BusinessOsBillingEventInput,
} from '@/lib/repositories/BusinessOsBillingEventRepository';

const ROOT = process.cwd();
const USER = '11111111-1111-4111-8111-111111111111';
const ROW_ID = '22222222-2222-4222-8222-222222222222';

type Call = { method: string; args: unknown[] };
type Answer = { data: unknown; error: unknown };

/** A client that records the RPC call and every chained insert call. */
function recordingClient(answer: () => Answer) {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const queries: Call[][] = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return Promise.resolve(answer());
    },
    from: (table: string) => {
      const calls: Call[] = [{ method: 'from', args: [table] }];
      queries.push(calls);
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'or', 'insert', 'update', 'upsert', 'delete']) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ method, args });
          return builder;
        };
      }
      builder.single = () => {
        calls.push({ method: 'single', args: [] });
        return Promise.resolve(answer());
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, rpcCalls, queries };
}

function applyInput(overrides: Partial<BusinessOsApplyPlanPaymentInput> = {}): BusinessOsApplyPlanPaymentInput {
  return {
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_TestCustomer1',
    stripeSubscriptionId: 'sub_TestSubscription1',
    replacesSubscriptionId: null,
    stripeEventId: 'evt_TestEvent1',
    stripeInvoiceId: 'in_TestInvoice1',
    tier: 'tier_one',
    planVersion: 3,
    assignsPlan: true,
    amountMinor: 7900,
    amountTaxMinor: 0,
    currency: 'usd',
    periodStart: '2026-10-07T00:00:00.000Z',
    periodEnd: '2026-11-07T00:00:00.000Z',
    paidAt: '2026-10-07T00:00:05.000Z',
    billingCycleAnchor: '2026-10-07T00:00:00.000Z',
    subscriptionStatus: 'active',
    ...overrides,
  };
}

function eventInput(overrides: Partial<BusinessOsBillingEventInput> = {}): BusinessOsBillingEventInput {
  return {
    accountId: USER,
    livemode: false,
    kind: 'invoice_payment_failed',
    stripeEventId: 'evt_TestEvent2',
    stripeInvoiceId: 'in_TestInvoice2',
    stripeSubscriptionId: 'sub_TestSubscription1',
    stripeCustomerId: 'cus_TestCustomer1',
    tier: 'tier_one',
    amountMinor: 7900,
    amountTaxMinor: 0,
    currency: 'usd',
    ...overrides,
  };
}

const APPLIED_ROW = {
  out_status: 'applied',
  out_event_row_id: ROW_ID,
  out_tier_before: null,
  out_tier_after: 'tier_one',
  out_plan_written: true,
  out_anchor_set: true,
};

beforeEach(() => {
  mockInfo.mockClear();
  mockError.mockClear();
});

describe('constants', () => {
  it('names the table, the function, the nine kinds and the eighteen columns', () => {
    expect(BOS_BILLING_EVENTS_TABLE).toBe('business_os_billing_events');
    expect(BOS_APPLY_PLAN_PAYMENT_RPC).toBe('business_os_apply_plan_payment');
    expect(BILLING_EVENT_KINDS).toHaveLength(9);
    expect(BILLING_EVENT_COLUMNS.split(', ')).toHaveLength(18);
  });

  it('the singleton runs on the service-role client', () => {
    expect((businessOsBillingEventRepository as unknown as { supabase: unknown }).supabase).toEqual({ marker: 'service-role-default' });
  });
});

describe('applyPlanPayment', () => {
  it('calls the RPC once with exactly the eighteen named arguments, in the function order', async () => {
    const { client, rpcCalls } = recordingClient(() => ({ data: [APPLIED_ROW], error: null }));
    await new BusinessOsBillingEventRepository(client).applyPlanPayment(applyInput());

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('business_os_apply_plan_payment');
    expect(rpcCalls[0].args).toEqual({
      p_user_id: USER,
      p_livemode: false,
      p_stripe_customer_id: 'cus_TestCustomer1',
      p_stripe_subscription_id: 'sub_TestSubscription1',
      p_replaces_subscription_id: null,
      p_stripe_event_id: 'evt_TestEvent1',
      p_stripe_invoice_id: 'in_TestInvoice1',
      p_tier: 'tier_one',
      p_plan_version: 3,
      p_assigns_plan: true,
      p_amount_minor: 7900,
      p_amount_tax_minor: 0,
      p_currency: 'usd',
      p_period_start: '2026-10-07T00:00:00.000Z',
      p_period_end: '2026-11-07T00:00:00.000Z',
      p_paid_at: '2026-10-07T00:00:05.000Z',
      p_billing_cycle_anchor: '2026-10-07T00:00:00.000Z',
      p_subscription_status: 'active',
    });
    expect(Object.keys(rpcCalls[0].args)).toHaveLength(18);
  });

  it('an injected extra field on the input never reaches the RPC', async () => {
    const { client, rpcCalls } = recordingClient(() => ({ data: [APPLIED_ROW], error: null }));
    const injected = { ...applyInput(), user_id: 'ATTACKER', p_user_id: 'ATTACKER', plan_written: true } as unknown as BusinessOsApplyPlanPaymentInput;
    await new BusinessOsBillingEventRepository(client).applyPlanPayment(injected);
    expect(rpcCalls[0].args.p_user_id).toBe(USER);
    expect(Object.keys(rpcCalls[0].args)).not.toContain('user_id');
    expect(Object.keys(rpcCalls[0].args)).not.toContain('plan_written');
  });

  it('maps applied and recorded with every output', async () => {
    const { client } = recordingClient(() => ({ data: [APPLIED_ROW], error: null }));
    const applied = await new BusinessOsBillingEventRepository(client).applyPlanPayment(applyInput());
    expect(applied).toEqual({
      data: { status: 'applied', eventRowId: ROW_ID, tierBefore: null, tierAfter: 'tier_one', planWritten: true, anchorSet: true },
      error: null,
    });

    const recordedRow = { ...APPLIED_ROW, out_status: 'recorded', out_tier_before: 'tier_one', out_plan_written: false, out_anchor_set: false };
    const { client: second } = recordingClient(() => ({ data: [recordedRow], error: null }));
    const recorded = await new BusinessOsBillingEventRepository(second).applyPlanPayment(applyInput({ assignsPlan: false, amountMinor: 0 }));
    expect(recorded.data).toEqual({ status: 'recorded', eventRowId: ROW_ID, tierBefore: 'tier_one', tierAfter: 'tier_one', planWritten: false, anchorSet: false });
  });

  it.each([
    ['already_applied', { out_event_row_id: ROW_ID }, { status: 'already_applied', eventRowId: ROW_ID }],
    ['already_recorded', { out_event_row_id: ROW_ID }, { status: 'already_recorded', eventRowId: ROW_ID }],
    ['subscription_conflict', { out_event_row_id: ROW_ID }, { status: 'subscription_conflict', eventRowId: ROW_ID }],
    ['subscription_conflict', { out_event_row_id: null }, { status: 'subscription_conflict', eventRowId: null }],
    ['billing_row_missing', { out_event_row_id: null }, { status: 'billing_row_missing' }],
    ['customer_mismatch', { out_event_row_id: null }, { status: 'customer_mismatch' }],
    ['plan_row_missing', { out_event_row_id: null }, { status: 'plan_row_missing' }],
  ])('maps %s as data, never as an error', async (status, extra, expected) => {
    const { client } = recordingClient(() => ({ data: [{ out_status: status, ...extra }], error: null }));
    const result = await new BusinessOsBillingEventRepository(client).applyPlanPayment(applyInput());
    expect(result).toEqual({ data: expected, error: null });
  });

  it.each([
    ['an unknown status', [{ out_status: 'made_up' }]],
    ['no row', []],
    ['two rows', [APPLIED_ROW, APPLIED_ROW]],
    ['an unreadable row id', [{ ...APPLIED_ROW, out_event_row_id: 'not-a-uuid' }]],
    ['an unreadable boolean', [{ ...APPLIED_ROW, out_anchor_set: 'yes' }]],
    ['null data', null],
  ])('%s is an error, never a guessed answer', async (_name, data) => {
    const { client } = recordingClient(() => ({ data, error: null }));
    const result = await new BusinessOsBillingEventRepository(client).applyPlanPayment(applyInput());
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(mockError).toHaveBeenCalled();
  });

  it('a database error (a raised 22023, or a unique violation) is an error with its SQLSTATE kept', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '22023', message: 'out of range' } }));
    const result = await new BusinessOsBillingEventRepository(client).applyPlanPayment(applyInput());
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('22023');
  });

  it('never throws, even when the client does', async () => {
    const client = { rpc: () => Promise.reject(new Error('network down')) } as unknown as SupabaseClient;
    await expect(new BusinessOsBillingEventRepository(client).applyPlanPayment(applyInput())).resolves.toEqual({
      data: null,
      error: expect.any(Error),
    });
  });

  it.each<[string, Partial<BusinessOsApplyPlanPaymentInput>]>([
    ['a non-uuid account', { accountId: 'abc' }],
    ['a non-boolean livemode', { livemode: 'false' as unknown as boolean }],
    ['a bad customer id', { stripeCustomerId: 'acct_1' }],
    ['a bad subscription id', { stripeSubscriptionId: 'sub-1' }],
    ['a replaced subscription equal to the new one', { replacesSubscriptionId: 'sub_TestSubscription1' }],
    ['a bad replaced subscription', { replacesSubscriptionId: 'si_1' }],
    ['a bad event id', { stripeEventId: 'ev_1' }],
    ['a bad invoice id', { stripeInvoiceId: 'inv_1' }],
    ['an empty tier', { tier: '' }],
    ['a long tier', { tier: 'x'.repeat(65) }],
    ['a zero plan version', { planVersion: 0 }],
    ['a fractional amount', { amountMinor: 79.5 }],
    ['a negative tax', { amountTaxMinor: -1 }],
    ['another currency', { currency: 'eur' as 'usd' }],
    ['a period that ends before it starts', { periodEnd: '2026-10-06T00:00:00.000Z' }],
    ['an unreadable paid time', { paidAt: 'yesterday' }],
    ['an unknown status', { subscriptionStatus: 'gone' as 'active' }],
  ])('refuses %s before any query', async (_name, overrides) => {
    const { client, rpcCalls } = recordingClient(() => ({ data: [APPLIED_ROW], error: null }));
    const result = await new BusinessOsBillingEventRepository(client).applyPlanPayment(applyInput(overrides));
    expect(result.data).toBeNull();
    expect(result.error?.message).toBe('invalid_input');
    expect(rpcCalls).toHaveLength(0);
  });

  it('accepts a NULL event id (the P-8b reconciler) and a proven replacement', async () => {
    const { client, rpcCalls } = recordingClient(() => ({ data: [APPLIED_ROW], error: null }));
    const result = await new BusinessOsBillingEventRepository(client).applyPlanPayment(
      applyInput({ stripeEventId: null, replacesSubscriptionId: 'sub_OldSubscription' })
    );
    expect(result.error).toBeNull();
    expect(rpcCalls[0].args.p_stripe_event_id).toBeNull();
    expect(rpcCalls[0].args.p_replaces_subscription_id).toBe('sub_OldSubscription');
  });
});

describe('recordEvent', () => {
  it('inserts an explicit allow-list into the money history and returns the new id', async () => {
    const { client, queries } = recordingClient(() => ({ data: { id: ROW_ID }, error: null }));
    const result = await new BusinessOsBillingEventRepository(client).recordEvent(eventInput());

    expect(result).toEqual({ data: { outcome: 'recorded', eventRowId: ROW_ID }, error: null });
    expect(queries).toHaveLength(1);
    expect(queries[0][0]).toEqual({ method: 'from', args: ['business_os_billing_events'] });
    const insert = queries[0].find((call) => call.method === 'insert');
    expect(insert?.args[0]).toEqual({
      user_id: USER,
      livemode: false,
      kind: 'invoice_payment_failed',
      stripe_event_id: 'evt_TestEvent2',
      stripe_invoice_id: 'in_TestInvoice2',
      stripe_subscription_id: 'sub_TestSubscription1',
      stripe_customer_id: 'cus_TestCustomer1',
      tier: 'tier_one',
      refusal_reason: null,
      amount_minor: 7900,
      amount_tax_minor: 0,
      currency: 'usd',
      period_start: null,
      period_end: null,
      paid_at: null,
    });
    expect(queries[0].map((call) => call.method)).toEqual(['from', 'insert', 'select', 'single']);
  });

  it('never writes id, created_at or plan_written, even when injected', async () => {
    const { client, queries } = recordingClient(() => ({ data: { id: ROW_ID }, error: null }));
    const injected = { ...eventInput(), id: ROW_ID, created_at: 'x', plan_written: true, user_id: 'ATTACKER' } as unknown as BusinessOsBillingEventInput;
    await new BusinessOsBillingEventRepository(client).recordEvent(injected);
    const payload = queries[0].find((call) => call.method === 'insert')?.args[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('created_at');
    expect(payload).not.toHaveProperty('plan_written');
    expect(payload.user_id).toBe(USER);
  });

  it('records an unknown-customer refusal with no account and a reason', async () => {
    const { client, queries } = recordingClient(() => ({ data: { id: ROW_ID }, error: null }));
    const result = await new BusinessOsBillingEventRepository(client).recordEvent(
      eventInput({ accountId: null, kind: 'mismatch_refused', refusalReason: 'unknown_customer', currency: null })
    );
    expect(result.data).toEqual({ outcome: 'recorded', eventRowId: ROW_ID });
    const payload = queries[0].find((call) => call.method === 'insert')?.args[0] as Record<string, unknown>;
    expect(payload.user_id).toBeNull();
    expect(payload.refusal_reason).toBe('unknown_customer');
    expect(payload.currency).toBeNull();
  });

  it('a redelivered event id answers duplicate, not an error', async () => {
    const { client } = recordingClient(() => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "business_os_billing_events_stripe_event_id_key"' },
    }));
    const result = await new BusinessOsBillingEventRepository(client).recordEvent(eventInput());
    expect(result).toEqual({ data: { outcome: 'duplicate' }, error: null });
  });

  it('a unique violation on another key is an error', async () => {
    const { client } = recordingClient(() => ({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "business_os_billing_events_invoice_paid_key"' },
    }));
    const result = await new BusinessOsBillingEventRepository(client).recordEvent(eventInput());
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('any other database error is an error, never thrown', async () => {
    const { client } = recordingClient(() => ({ data: null, error: { code: '42501', message: 'permission denied' } }));
    const result = await new BusinessOsBillingEventRepository(client).recordEvent(eventInput());
    expect(result.data).toBeNull();
    expect((result.error as Error & { code?: string }).code).toBe('42501');
  });

  it.each<[string, Partial<BusinessOsBillingEventInput>]>([
    ['invoice_paid (only the apply function writes it)', { kind: 'invoice_paid' as 'refunded' }],
    ['an unknown kind', { kind: 'made_up' as 'refunded' }],
    ['a refusal with no reason', { kind: 'mismatch_refused', refusalReason: null }],
    ['a reason on a non-refusal', { refusalReason: 'second_subscription' }],
    ['a reason that is not a code', { kind: 'mismatch_refused', refusalReason: 'Not A Code' }],
    ['a bad account id', { accountId: 'abc' }],
    ['a bad event id', { stripeEventId: 'event_1' }],
    ['a bad customer id', { stripeCustomerId: 'acct_1' }],
    ['another currency', { currency: 'eur' as 'usd' }],
    ['a negative amount', { amountMinor: -5 }],
    ['a period that ends before it starts', { periodStart: '2026-10-08T00:00:00.000Z', periodEnd: '2026-10-07T00:00:00.000Z' }],
  ])('refuses %s before any query', async (_name, overrides) => {
    const { client, queries } = recordingClient(() => ({ data: { id: ROW_ID }, error: null }));
    const result = await new BusinessOsBillingEventRepository(client).recordEvent(eventInput(overrides));
    expect(result.error?.message).toBe('invalid_input');
    expect(queries).toHaveLength(0);
  });
});

describe('source rules', () => {
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'repositories', 'BusinessOsBillingEventRepository.ts'), 'utf8');

  it('has no update, delete or upsert: the history is append-only', () => {
    expect(source).not.toMatch(/\.(update|delete|upsert)\(/);
  });

  it('logs with Pino, never console', () => {
    expect(source).not.toMatch(/console\./);
  });

  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir)) {
      if (['node_modules', '.next', '.git', '.claude', 'coverage'].includes(entry)) continue;
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
    }
    return out;
  }

  it('only the listed files name the repository', () => {
    const ALLOWED = [
      // P-3b.1 ships the repository with no caller. P-3b.2 adds the webhook
      // use case (planPaymentApply.ts) here, in its own review.
      'lib/repositories/BusinessOsBillingEventRepository.ts',
      // Not a caller: the billing account repository's own caller guard lists
      // this file's path, because it imports that repository's status type.
      'lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts',
      'lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts',
    ];
    const SYMBOLS = ['BusinessOsBillingEventRepository', 'businessOsBillingEventRepository'];
    const found = ['app', 'lib', 'components', 'hooks', 'scripts']
      .filter((dir) => fs.existsSync(path.join(ROOT, dir)))
      .flatMap((dir) => walk(path.join(ROOT, dir)))
      .filter((file) => SYMBOLS.some((symbol) => fs.readFileSync(file, 'utf8').includes(symbol)))
      .map((file) => path.relative(ROOT, file).replace(/\\/g, '/'));
    expect(found.sort()).toEqual(ALLOWED);
  });
});

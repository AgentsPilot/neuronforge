/**
 * ensureBusinessOsStripeCustomer (plan payments P-2a, workplan §3.6 and §7;
 * SA rulings Q-6, Q-11, P2-C3, P2-C8; C-3).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
const mockError = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: jest.fn(),
      error: (...args: unknown[]) => mockError(...args),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
const mockGetStripeService = jest.fn();
jest.mock('@/lib/stripe/StripeService', () => ({ getStripeService: () => mockGetStripeService() }));

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BusinessOsStripeCustomerError,
  businessOsCustomerIdempotencyKey,
  businessOsReplacementCustomerIdempotencyKey,
  ensureBusinessOsStripeCustomer,
  replaceBusinessOsStripeCustomer,
  type EnsureBusinessOsStripeCustomerDeps,
  type ReplaceBusinessOsStripeCustomerDeps,
} from '@/lib/business-os/billing/businessOsStripeCustomer';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';

const USER = '11111111-1111-4111-8111-111111111111';

function account(overrides: Partial<BusinessOsBillingAccount> = {}): BusinessOsBillingAccount {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_stored',
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    boughtTier: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    lastInvoiceId: null,
    lastPaidAt: null,
    lastPaymentFailedAt: null,
    failedAttempts: 0,
    actionRequiredInvoiceUrl: null,
    founderDiscountAppliedAt: null,
    endedAt: null,
    createdAt: '2026-10-04T00:00:00.000Z',
    updatedAt: '2026-10-04T00:00:00.000Z',
    ...overrides,
  };
}

function setup(options: {
  found?: { data: BusinessOsBillingAccount | null; error: Error | null };
  stripe?: () => Promise<{ customerId: string; created: boolean; livemode: boolean | null }>;
  recorded?: (input: { userId: string; livemode: boolean; stripeCustomerId: string }) => {
    data: { account: BusinessOsBillingAccount; created: boolean } | null;
    error: Error | null;
  };
  mode?: 'test' | 'live';
}) {
  const findByUser = jest.fn(async () => options.found ?? { data: null, error: null });
  const recordCustomer = jest.fn(async (input: { userId: string; livemode: boolean; stripeCustomerId: string }) =>
    options.recorded
      ? options.recorded(input)
      : { data: { account: account({ stripeCustomerId: input.stripeCustomerId, livemode: input.livemode }), created: true }, error: null }
  );
  const findOrCreatePlatformCustomer = jest.fn(
    options.stripe ?? (async () => ({ customerId: 'cus_new', created: true, livemode: options.mode === 'live' }))
  );
  const deps: EnsureBusinessOsStripeCustomerDeps = {
    repo: { findByUser, recordCustomer } as unknown as EnsureBusinessOsStripeCustomerDeps['repo'],
    stripe: { findOrCreatePlatformCustomer },
    mode: () => options.mode ?? 'test',
  };
  return { deps, findByUser, recordCustomer, findOrCreatePlatformCustomer };
}

beforeEach(() => {
  mockError.mockReset();
  mockGetStripeService.mockReset();
});

describe('ensureBusinessOsStripeCustomer', () => {
  it('a stored row → its customer, with no Stripe call and no write (the row is trusted, Q-6)', async () => {
    const { deps, findByUser, recordCustomer, findOrCreatePlatformCustomer } = setup({ found: { data: account(), error: null } });
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps)).resolves.toEqual({
      customerId: 'cus_stored',
      created: false,
    });
    expect(findByUser).toHaveBeenCalledWith(USER, false);
    expect(findOrCreatePlatformCustomer).not.toHaveBeenCalled();
    expect(recordCustomer).not.toHaveBeenCalled();
  });

  it('reads the row of the CURRENT mode (live key → livemode true)', async () => {
    const { deps, findByUser } = setup({ found: { data: account({ livemode: true }), error: null }, mode: 'live' });
    await ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps);
    expect(findByUser).toHaveBeenCalledWith(USER, true);
  });

  it('no row → one create with Business OS metadata (never user_id, C-3) and the bos-customer key, then records it with the reported mode', async () => {
    const { deps, recordCustomer, findOrCreatePlatformCustomer } = setup({});
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com', name: 'Ann' }, deps)).resolves.toEqual({
      customerId: 'cus_new',
      created: true,
    });
    expect(findOrCreatePlatformCustomer.mock.calls).toEqual([
      [
        {
          email: 'a@example.com',
          name: 'Ann',
          metadata: { product: 'business_os_plan', bos_user_id: USER },
          idempotencyKey: `bos-customer:${USER}`,
        },
      ],
    ]);
    const call = findOrCreatePlatformCustomer.mock.calls[0] as unknown as [{ metadata: Record<string, string>; existingCustomerId?: unknown }];
    expect(call[0].metadata).not.toHaveProperty('user_id');
    expect(call[0]).not.toHaveProperty('existingCustomerId');
    expect(recordCustomer.mock.calls).toEqual([[{ userId: USER, livemode: false, stripeCustomerId: 'cus_new' }]]);
  });

  it('the idempotency key is bos-customer:<userId>', () => {
    expect(businessOsCustomerIdempotencyKey(USER)).toBe(`bos-customer:${USER}`);
  });

  it('a lost race (23505 with our own row) → the stored id, created false', async () => {
    const { deps } = setup({
      recorded: () => ({ data: { account: account({ stripeCustomerId: 'cus_winner' }), created: false }, error: null }),
    });
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps)).resolves.toEqual({
      customerId: 'cus_winner',
      created: false,
    });
  });

  it('a mode disagreement (test key, live customer) throws and records nothing (PF-15)', async () => {
    const { deps, recordCustomer } = setup({ stripe: async () => ({ customerId: 'cus_new', created: true, livemode: true }) });
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps)).rejects.toMatchObject({
      reason: 'stripe_mode_mismatch',
    });
    expect(recordCustomer).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ alert: true }), expect.any(String));
  });

  it('a null livemode (a reused deleted customer) is a disagreement too and records nothing (P2-C3)', async () => {
    const { deps, recordCustomer } = setup({ stripe: async () => ({ customerId: 'cus_deleted', created: false, livemode: null }) });
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps)).rejects.toBeInstanceOf(
      BusinessOsStripeCustomerError
    );
    expect(recordCustomer).not.toHaveBeenCalled();
  });

  it('a Stripe error rejects and records nothing', async () => {
    const { deps, recordCustomer } = setup({
      stripe: async () => {
        throw new Error('stripe down');
      },
    });
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps)).rejects.toThrow('stripe down');
    expect(recordCustomer).not.toHaveBeenCalled();
  });

  it('a Stripe idempotency_error (same key, different email within 24 h) rejects and records nothing (P2-C8)', async () => {
    const idempotencyError = Object.assign(new Error('Keys for idempotent requests can only be used with the same parameters'), {
      type: 'StripeIdempotencyError',
      rawType: 'idempotency_error',
    });
    const { deps, recordCustomer } = setup({
      stripe: async () => {
        throw idempotencyError;
      },
    });
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'b@example.com' }, deps)).rejects.toBe(idempotencyError);
    expect(recordCustomer).not.toHaveBeenCalled();
    expect(mockError).toHaveBeenCalledWith(
      expect.objectContaining({ stripeErrorType: 'StripeIdempotencyError' }),
      expect.any(String)
    );
    // Never the email in the log.
    const logged = mockError.mock.calls.map((call) => {
      const context = { ...(call[0] as Record<string, unknown>) };
      delete context.err;
      return context;
    });
    expect(JSON.stringify(logged)).not.toContain('b@example.com');
  });

  it('an unreadable billing row rejects BEFORE any Stripe call (no second customer)', async () => {
    const { deps, findOrCreatePlatformCustomer } = setup({ found: { data: null, error: new Error('db down') } });
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps)).rejects.toMatchObject({
      reason: 'billing_row_unreadable',
    });
    expect(findOrCreatePlatformCustomer).not.toHaveBeenCalled();
  });

  it('a failed record (e.g. the customer is held by another account) rejects', async () => {
    const { deps } = setup({ recorded: () => ({ data: null, error: new Error('stripe_customer_held_by_another_account') }) });
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps)).rejects.toMatchObject({
      reason: 'billing_row_not_recorded',
    });
  });

  it('an unknown key mode throws before anything is read', async () => {
    const { deps, findByUser } = setup({});
    deps.mode = () => {
      throw new Error('stripe_key_mode_unknown');
    };
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps)).rejects.toThrow('stripe_key_mode_unknown');
    expect(findByUser).not.toHaveBeenCalled();
  });

  it.each([
    [{ userId: 'not-a-uuid', email: 'a@example.com' }],
    [{ userId: USER, email: '' }],
    [{ userId: USER, email: '   ' }],
  ])('refuses invalid input %p before anything is read', async (input) => {
    const { deps, findByUser } = setup({});
    await expect(ensureBusinessOsStripeCustomer(input, deps)).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(findByUser).not.toHaveBeenCalled();
  });

  it('uses the shared StripeService when no Stripe dependency is injected', async () => {
    const findOrCreatePlatformCustomer = jest.fn(async () => ({ customerId: 'cus_shared', created: true, livemode: false }));
    mockGetStripeService.mockReturnValue({ findOrCreatePlatformCustomer });
    const { deps } = setup({});
    delete deps.stripe;
    await expect(ensureBusinessOsStripeCustomer({ userId: USER, email: 'a@example.com' }, deps)).resolves.toEqual({
      customerId: 'cus_shared',
      created: true,
    });
  });
});

describe('replaceBusinessOsStripeCustomer (P-3a §3.5, SA Q-8, C-3)', () => {
  const NOW = new Date('2026-10-07T10:00:00.000Z');

  function replaceSetup(options: {
    replaced?: { data: { replaced: boolean } | null; error: Error | null };
    stored?: { data: BusinessOsBillingAccount | null; error: Error | null };
    stripeLivemode?: boolean | null;
    newCustomerId?: string;
    mode?: 'test' | 'live';
  }) {
    const replaceCustomer = jest.fn(async () => options.replaced ?? { data: { replaced: true }, error: null });
    const findByUser = jest.fn(async () => options.stored ?? { data: null, error: null });
    const findOrCreatePlatformCustomer = jest.fn(async () => ({
      customerId: options.newCustomerId ?? 'cus_replacement',
      created: true,
      livemode: options.stripeLivemode === undefined ? options.mode === 'live' : options.stripeLivemode,
    }));
    const deps: ReplaceBusinessOsStripeCustomerDeps = {
      repo: { findByUser, replaceCustomer } as unknown as ReplaceBusinessOsStripeCustomerDeps['repo'],
      stripe: { findOrCreatePlatformCustomer },
      mode: () => options.mode ?? 'test',
      now: () => NOW,
    };
    return { deps, replaceCustomer, findByUser, findOrCreatePlatformCustomer };
  }

  const INPUT = { userId: USER, email: 'a@example.com', oldCustomerId: 'cus_deleted' };

  it('creates the replacement under its OWN key (never bos-customer:<userId>) and swaps by compare-and-set', async () => {
    const { deps, replaceCustomer, findOrCreatePlatformCustomer } = replaceSetup({});
    await expect(replaceBusinessOsStripeCustomer(INPUT, deps)).resolves.toEqual({ customerId: 'cus_replacement', replaced: true });

    const call = findOrCreatePlatformCustomer.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(call[0].idempotencyKey).toBe(`bos-customer:${USER}:replaces:cus_deleted`);
    expect(call[0].idempotencyKey).not.toBe(businessOsCustomerIdempotencyKey(USER));
    expect(businessOsReplacementCustomerIdempotencyKey(USER, 'cus_deleted')).toBe(`bos-customer:${USER}:replaces:cus_deleted`);
    expect(call[0].existingCustomerId).toBeUndefined();
    expect(call[0].metadata).toEqual({ product: 'business_os_plan', bos_user_id: USER });
    expect(replaceCustomer).toHaveBeenCalledWith({
      userId: USER,
      livemode: false,
      oldCustomerId: 'cus_deleted',
      newCustomerId: 'cus_replacement',
      nowIso: NOW.toISOString(),
    });
  });

  it('a mode disagreement (incl. null) records nothing', async () => {
    for (const stripeLivemode of [true, null]) {
      const { deps, replaceCustomer } = replaceSetup({ stripeLivemode });
      await expect(replaceBusinessOsStripeCustomer(INPUT, deps)).rejects.toMatchObject({ reason: 'stripe_mode_mismatch' });
      expect(replaceCustomer).not.toHaveBeenCalled();
    }
  });

  it('lost compare-and-set → re-reads and returns the STORED replacement', async () => {
    const { deps, findByUser } = replaceSetup({
      replaced: { data: { replaced: false }, error: null },
      stored: { data: account({ stripeCustomerId: 'cus_winner' }), error: null },
    });
    await expect(replaceBusinessOsStripeCustomer(INPUT, deps)).resolves.toEqual({ customerId: 'cus_winner', replaced: false });
    expect(findByUser).toHaveBeenCalledWith(USER, false);
  });

  it('lost compare-and-set but the stored customer is still the old one (or gone) → not recorded, never the old id', async () => {
    for (const stored of [account({ stripeCustomerId: 'cus_deleted' }), null]) {
      const { deps } = replaceSetup({ replaced: { data: { replaced: false }, error: null }, stored: { data: stored, error: null } });
      await expect(replaceBusinessOsStripeCustomer(INPUT, deps)).rejects.toMatchObject({ reason: 'billing_row_not_recorded' });
    }
  });

  it('a failed write (incl. the new id held by another account) → billing_row_not_recorded with an alert', async () => {
    const { deps } = replaceSetup({ replaced: { data: null, error: new Error('stripe_customer_held_by_another_account') } });
    await expect(replaceBusinessOsStripeCustomer(INPUT, deps)).rejects.toMatchObject({ reason: 'billing_row_not_recorded' });
    expect(mockError).toHaveBeenCalledWith(expect.objectContaining({ alert: true }), expect.any(String));
  });

  it('a failed re-read after a lost race → billing_row_unreadable', async () => {
    const { deps } = replaceSetup({
      replaced: { data: { replaced: false }, error: null },
      stored: { data: null, error: new Error('down') },
    });
    await expect(replaceBusinessOsStripeCustomer(INPUT, deps)).rejects.toMatchObject({ reason: 'billing_row_unreadable' });
  });

  it('a Stripe error rejects and records nothing', async () => {
    const { deps, replaceCustomer, findOrCreatePlatformCustomer } = replaceSetup({});
    findOrCreatePlatformCustomer.mockRejectedValueOnce(Object.assign(new Error('boom'), { type: 'StripeAPIError' }));
    await expect(replaceBusinessOsStripeCustomer(INPUT, deps)).rejects.toThrow('boom');
    expect(replaceCustomer).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...INPUT, email: '' }],
    [{ ...INPUT, userId: 'nope' }],
    [{ ...INPUT, oldCustomerId: 'sub_1' }],
  ])('refuses invalid input %p before any call', async (input) => {
    const { deps, findOrCreatePlatformCustomer } = replaceSetup({});
    await expect(replaceBusinessOsStripeCustomer(input, deps)).rejects.toMatchObject({ reason: 'invalid_input' });
    expect(findOrCreatePlatformCustomer).not.toHaveBeenCalled();
  });
});

describe('source guards', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'billing', 'businessOsStripeCustomer.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('never names user_subscriptions or the agent-platform customer method (RD-2)', () => {
    expect(code).not.toContain('user_subscriptions');
    expect(code).not.toContain('getOrCreateCustomer');
  });

  it('never writes the legacy user_id metadata key (C-3)', () => {
    expect(code).not.toMatch(/\buser_id\s*:/);
  });

  it('only the plan checkout calls it (P-3a wired it in; SA Q-11: no route calls it directly)', () => {
    const { readdirSync, statSync } = jest.requireActual<typeof import('fs')>('fs');
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (['node_modules', '.next', '__tests__'].includes(entry)) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry) && readFileSync(full, 'utf8').includes('ensureBusinessOsStripeCustomer')) {
          offenders.push(full.slice(process.cwd().length + 1).split('\\').join('/'));
        }
      }
    };
    for (const dir of ['app', 'lib', 'components', 'hooks']) walk(join(process.cwd(), dir));
    expect(offenders).toEqual([
      'lib/business-os/billing/businessOsStripeCustomer.ts',
      'lib/business-os/billing/planCheckout.ts',
    ]);
  });
});

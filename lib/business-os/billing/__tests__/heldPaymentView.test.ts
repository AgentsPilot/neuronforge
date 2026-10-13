/**
 * The holding screen's model (plan payments P-5a.2; workplan §3.3, §8 "Screen
 * model"; SA S5-6, W-7, Q-5).
 *
 * Every port is injected: switches, billing reader, key mode, clock, logger.
 * Tier names and prices come from the CONFIG, never written here (FR-12).
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => {
    throw new Error('the holding screen never talks to Stripe');
  },
}));

import { readFileSync } from 'fs';
import { join } from 'path';

import { INVITE_ISSUANCE_POLICY } from '@/lib/business-os/entitlements/config/invites';
import { TIER_MATRIX, type TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  HELD_PAYMENT_STUCK_AFTER_MS,
  readHeldPaymentView,
  type HeldPaymentViewDeps,
  type HeldPaymentViewInput,
} from '@/lib/business-os/billing/heldPaymentView';
import { isCheckoutReturnMarker } from '@/lib/business-os/billing/checkoutReturnMarker';
import type { HeldPaymentSwitches } from '@/lib/business-os/billing/planCheckoutEligibility';

const USER = '11111111-1111-4111-8111-111111111111';
const INVITE = '66666666-6666-4666-8666-666666666666';
const NOW = new Date('2026-10-12T10:00:00.000Z');
const FRIEND_TIER = INVITE_ISSUANCE_POLICY.account.grantId as TierId;
const ALL_ON: HeldPaymentSwitches = { checkoutEnabled: true, pricesEnabled: true, paidInvitesAvailable: true };

type Billing = NonNullable<HeldPaymentViewDeps['billing']>;
type BillingResult = Awaited<ReturnType<Billing['findByUser']>>;
type Row = NonNullable<BillingResult['data']>;

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_1',
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
    createdAt: '2026-10-12T09:00:00.000Z',
    updatedAt: NOW.toISOString(),
    ...overrides,
  } as Row;
}

const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function harness(options: {
  switches?: HeldPaymentSwitches;
  result?: BillingResult | 'throw';
  modeThrows?: boolean;
  mode?: 'test' | 'live';
} = {}) {
  const reads: Array<[string, boolean]> = [];
  const logger = { warn: jest.fn(), error: jest.fn() };
  const deps: HeldPaymentViewDeps = {
    switches: () => options.switches ?? ALL_ON,
    billing: {
      findByUser: jest.fn(async (userId: string, livemode: boolean) => {
        reads.push([userId, livemode]);
        if (options.result === 'throw') throw new Error('down');
        return options.result ?? { data: null, error: null };
      }),
    } as Billing,
    mode: () => {
      if (options.modeThrows) throw new Error('stripe_key_mode_unknown');
      return options.mode ?? 'test';
    },
    now: () => NOW,
    logger,
  };
  return { deps, reads, logger };
}

const friendHold = { ok: true, held: true, inviteId: INVITE, source: 'account_invite' } as const;
const adminHold = { ok: true, held: true, inviteId: INVITE, source: 'admin_invite' } as const;

function input(overrides: Partial<HeldPaymentViewInput> = {}): HeldPaymentViewInput {
  return { userId: USER, accountId: USER, hold: friendHold, language: 'en', checkoutReturned: false, ...overrides };
}

const PAY_EN = {
  kind: 'pay',
  tier: FRIEND_TIER,
  planName: TIER_MATRIX.presentation[FRIEND_TIER].labels.en,
  monthlyPriceUsd: TIER_MATRIX.presentation[FRIEND_TIER].monthlyPriceUsd,
};

describe('readHeldPaymentView — the offer comes first (S5-2, D5-3)', () => {
  it.each(['checkoutEnabled', 'pricesEnabled', 'paidInvitesAvailable'] as const)(
    '%s off → coming_soon, and nothing else is read',
    async (off) => {
      const { deps, reads } = harness({ switches: { ...ALL_ON, [off]: false } });
      expect(await readHeldPaymentView(input({ checkoutReturned: true }), deps)).toEqual({ kind: 'coming_soon' });
      expect(reads).toEqual([]);
    }
  );

  it('a held admin invitee → coming_soon (held_tier_unresolved until P-9)', async () => {
    const { deps } = harness();
    expect(await readHeldPaymentView(input({ hold: adminHold }), deps)).toEqual({ kind: 'coming_soon' });
  });
});

describe('readHeldPaymentView — pay', () => {
  it('nothing live → pay, with the plan name and price from presentation, read by the SESSION user and this mode', async () => {
    const { deps, reads } = harness();
    expect(await readHeldPaymentView(input(), deps)).toEqual(PAY_EN);
    expect(reads).toEqual([[USER, false]]);
  });

  it('live key mode reads the live row', async () => {
    const { deps, reads } = harness({ mode: 'live' });
    await readHeldPaymentView(input(), deps);
    expect(reads).toEqual([[USER, true]]);
  });

  it.each(['en', 'he', 'es'] as const)('the plan name is the %s label', async (language) => {
    const { deps } = harness();
    expect(await readHeldPaymentView(input({ language }), deps)).toMatchObject({
      planName: TIER_MATRIX.presentation[FRIEND_TIER].labels[language],
    });
  });

  it('an unknown language reads English', async () => {
    const { deps } = harness();
    expect(await readHeldPaymentView(input({ language: 'fr' }), deps)).toEqual(PAY_EN);
  });

  it('a row with a non-live status (canceled) → pay', async () => {
    const { deps } = harness({ result: { data: row({ subscriptionStatus: 'canceled' }), error: null } });
    expect(await readHeldPaymentView(input(), deps)).toEqual(PAY_EN);
  });

  it('a billing read error → pay (never a release), logged at warn', async () => {
    for (const result of [{ data: null, error: new Error('down') } as BillingResult, 'throw' as const]) {
      const { deps, logger } = harness({ result });
      expect(await readHeldPaymentView(input(), deps)).toEqual(PAY_EN);
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'bos_billing_held_view_billing_unread' }), expect.any(String));
    }
  });

  it('an unknown key mode → pay, no billing read', async () => {
    const { deps, reads } = harness({ modeThrows: true });
    expect(await readHeldPaymentView(input(), deps)).toEqual(PAY_EN);
    expect(reads).toEqual([]);
  });
});

describe('readHeldPaymentView — processing (S5-6, W-7)', () => {
  it('the return marker alone → processing, markerOnly (the escape link, W-7 c)', async () => {
    const { deps } = harness();
    expect(await readHeldPaymentView(input({ checkoutReturned: true }), deps)).toEqual({ kind: 'processing', delay: 'none', markerOnly: true });
  });

  it('the marker with an unreadable billing row or an unknown mode → processing, markerOnly', async () => {
    const failed = harness({ result: 'throw' });
    expect(await readHeldPaymentView(input({ checkoutReturned: true }), failed.deps)).toEqual({ kind: 'processing', delay: 'none', markerOnly: true });
    const unknown = harness({ modeThrows: true });
    expect(await readHeldPaymentView(input({ checkoutReturned: true }), unknown.deps)).toEqual({ kind: 'processing', delay: 'none', markerOnly: true });
  });

  it.each(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'] as const)(
    'a fresh live status (%s) → processing, no delay, not marker-only (the SR-5 set, W-7 a)',
    async (status) => {
      const { deps, logger } = harness({ result: { data: row({ subscriptionStatus: status, updatedAt: minutesAgo(1) }), error: null } });
      expect(await readHeldPaymentView(input(), deps)).toEqual({ kind: 'processing', delay: 'none', markerOnly: false });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    }
  );

  it.each(['active', 'past_due'] as const)('a PAYING status (%s) older than 5 minutes → stuck, error with alert (G5-6, Q-5)', async (status) => {
    const { deps, logger } = harness({ result: { data: row({ subscriptionStatus: status, updatedAt: minutesAgo(6) }), error: null } });
    expect(await readHeldPaymentView(input(), deps)).toEqual({ kind: 'processing', delay: 'stuck', markerOnly: false });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'bos_billing_held_but_paying', alert: true, subscriptionStatus: status }),
      expect.any(String)
    );
  });

  it.each(['incomplete', 'unpaid', 'trialing', 'paused'] as const)(
    'a live but NOT paying status (%s) older than 5 minutes → slow, warn without alert (W-7 b)',
    async (status) => {
      const { deps, logger } = harness({ result: { data: row({ subscriptionStatus: status, updatedAt: minutesAgo(6) }), error: null } });
      expect(await readHeldPaymentView(input(), deps)).toEqual({ kind: 'processing', delay: 'slow', markerOnly: false });
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'bos_billing_held_payment_slow' }), expect.any(String));
      expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('"alert":true');
    }
  );

  it('exactly 5 minutes is not yet stuck', async () => {
    const at = new Date(NOW.getTime() - HELD_PAYMENT_STUCK_AFTER_MS).toISOString();
    const { deps } = harness({ result: { data: row({ subscriptionStatus: 'active', updatedAt: at }), error: null } });
    expect(await readHeldPaymentView(input(), deps)).toEqual({ kind: 'processing', delay: 'none', markerOnly: false });
  });
});

describe('the return marker pattern (display only)', () => {
  it.each([
    ['cs_test_a1B2c3', true],
    ['cs_live_ZZ9', true],
    ['cs_test_', false],
    ['cs_prod_abc', false],
    ['cs_test_abc/../x', false],
    ['cs_test_abc def', false],
    [`cs_test_${'a'.repeat(251)}`, false],
    [['cs_test_a', 'cs_test_b'], false],
    [undefined, false],
  ] as const)('%p → %p', (value, expected) => {
    expect(isCheckoutReturnMarker(value)).toBe(expected);
  });
});

describe('source', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'business-os', 'billing', 'heldPaymentView.ts'), 'utf8');

  it('is server-only, Pino only, and writes no tier name or price literal (FR-12, G5-7)', () => {
    expect(source.trimStart().startsWith("import 'server-only';")).toBe(true);
    expect(source).not.toMatch(/console\./);
    for (const tier of Object.keys(TIER_MATRIX.presentation)) expect(source).not.toMatch(new RegExp(`['"\`]${tier}['"\`]`));
    expect(source).not.toMatch(/\b79\b/);
  });

  it('never releases: it neither redirects nor writes', () => {
    expect(source).not.toMatch(/redirect\(/);
    expect(source).not.toMatch(/\.(update|upsert|insert|rpc)\(/);
  });
});

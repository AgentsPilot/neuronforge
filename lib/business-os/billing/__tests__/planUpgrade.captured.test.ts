/**
 * The REAL upgrade code over the CAPTURED sandbox payloads (plan payments
 * P-7b.1b; workplan §8 "Sandbox Experiments and Fixtures", U-7 / G-3; SA
 * re-check "sandbox evidence" E-1 to E-6).
 *
 * Every Stripe answer here is a scrubbed capture from the P-7b.1 sandbox
 * experiments of 2026-10-13 (standard sandbox, test mode), committed as
 * `fixtures/stripe/captured-p7b1-*.json` and pinned by the C-6 ratchet
 * (`planStripeFields.c6.test.ts`). Nothing is hand-built except the ports
 * Jest cannot run (our billing row, the apply function's answer, the audit).
 *
 * What runs for real: `StripeService` (over a fake `stripe` client that
 * returns the captures, so the SDK-answer parsing is ours), `previewPlanUpgrade`
 * / `confirmPlanUpgrade` (`planUpgrade.ts`), `planInvoiceFacts`, and the
 * webhook's `applyPaidPlanInvoice` / `recordFailedPlanInvoice`.
 *
 *   E-1  the update's answer: applied → `upgraded` with no payment read; a
 *        pending update → ONE `invoicePayments.list` read → `action_required`
 *        with the confirmation secret (the expanded `payments` path hits
 *        `property_expansion_max_depth`, so the list read is permanent)
 *   E-2  a decline is RETURNED (no throw), the pending update kept →
 *        `declined` + `retryAfter` = its expiry
 *   E-3  a credit-balance upgrade: preview `amount_due` 0, invoice paid with
 *        `amount_paid` 0 and `total` > 0 → CF-6 assigns the plan
 *   E-4  the unpaid upgrade invoice is VOIDED at `pending_update.expires_at`:
 *        not resumable (Q-2 needs `open`), and the subscription after expiry
 *        is on the lower tier with no pending update
 *   E-5  an under-minimum upgrade: preview `amount_due` 14 (Stripe applies
 *        no minimum to the preview), invoice paid with `amount_paid` 0,
 *        `total` 14 → CF-6 assigns; the 14 cents ride the next renewal
 *   E-6  the in-flight conflict (`StripeInvalidRequestError`, code
 *        `idempotency_key_in_use`, 409) → `upgrade_busy`, not audited; the
 *        identical replay → `upgraded`
 *
 * For the confirm runs, the fresh subscription read is the E-4 subscription
 * after expiry (a real lower-tier subscription with no pending update, the shape
 * every confirm starts from) re-identified with the experiment's own
 * subscription and customer ids (SA P-7b.1b optimisation), and the write's
 * answer is the experiment's own captured `subscriptions.update` answer. Our
 * billing row is built from those ids.
 */

const mockSubscriptionsRetrieve = jest.fn();
const mockSubscriptionsUpdate = jest.fn();
const mockCreatePreview = jest.fn();
const mockInvoicesRetrieve = jest.fn();
const mockInvoicePaymentsList = jest.fn();
const mockPricesList = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    subscriptions: {
      retrieve: (...args: unknown[]) => mockSubscriptionsRetrieve(...args),
      update: (...args: unknown[]) => mockSubscriptionsUpdate(...args),
    },
    subscriptionItems: { list: jest.fn() },
    invoices: {
      createPreview: (...args: unknown[]) => mockCreatePreview(...args),
      retrieve: (...args: unknown[]) => mockInvoicesRetrieve(...args),
      listLineItems: jest.fn(),
    },
    invoicePayments: { list: (...args: unknown[]) => mockInvoicePaymentsList(...args) },
    prices: { list: (...args: unknown[]) => mockPricesList(...args) },
  }))
);

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger, __logger: logger };
});

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { planInvoiceFacts } from '@/lib/business-os/billing/planInvoiceFacts';
import {
  applyPaidPlanInvoice,
  PlanPaymentRetryError,
  recordFailedPlanInvoice,
  type PlanPaymentDeps,
} from '@/lib/business-os/billing/planPaymentApply';
import { planTierForLookupKey } from '@/lib/business-os/billing/planPriceCatalog';
import { confirmPlanUpgrade, previewPlanUpgrade, type PlanUpgradeDeps } from '@/lib/business-os/billing/planUpgrade';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { BusinessOsApplyPlanPaymentInput, BusinessOsBillingEventInput } from '@/lib/repositories/BusinessOsBillingEventRepository';
import type { RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import type { Logger } from '@/lib/logger';
import { StripeService } from '@/lib/stripe/StripeService';

const sharedLogger = (jest.requireMock('@/lib/logger') as { __logger: Record<string, jest.Mock> }).__logger;
const { errors: stripeErrors } = jest.requireActual('stripe') as {
  errors: { StripeError: { generate: (raw: Record<string, unknown>) => Error } };
};

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');

/** A captured payload, without our `_fixture_*` notes, as a fresh copy. */
function cap<T = Record<string, unknown>>(name: string): T {
  const raw = JSON.parse(fs.readFileSync(path.join(FIXTURES, `captured-p7b1-${name}.json`), 'utf8')) as Record<string, unknown>;
  for (const key of Object.keys(raw)) if (key.startsWith('_fixture_')) delete raw[key];
  return raw as T;
}

type Sub = { id: string; customer: string; items: { data: Array<{ price: Stripe.Price; current_period_start: number }> }; pending_update: { expires_at: number } | null };

// The two plan prices, exactly as Stripe sent them (the lookup keys decide the tier).
const AFTER_EXPIRY = cap<Sub>('e4-10-subscription-after-expiry');
const BASIC_PRICE = AFTER_EXPIRY.items.data[0].price;
const PRO_PRICE = cap<Sub>('e1a-02-update-response').items.data[0].price;
const BASIC = planTierForLookupKey(BASIC_PRICE.lookup_key as string) as string;
const PRO = planTierForLookupKey(PRO_PRICE.lookup_key as string) as string;
const CATALOG = {
  load: async () => ({
    byPriceId: new Map([
      [BASIC_PRICE.id, BASIC_PRICE.lookup_key as string],
      [PRO_PRICE.id, PRO_PRICE.lookup_key as string],
    ]),
    fromCache: false,
  }),
};

// The E-6 run's proration date (from the captured idempotency key), inside every captured item period.
const NOW_S = 1_792_766_146;
const PRORATION = NOW_S - 30;
const USER = '11111111-1111-4111-8111-111111111111';
/** The scrubbed placeholder that stands where Stripe sent the confirmation secret. */
const CAPTURED_SECRET = 'scrubbed_secret';

function rowFor(sub: Sub): BusinessOsBillingAccount {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: sub.customer,
    stripeSubscriptionId: sub.id,
    subscriptionStatus: 'active',
    boughtTier: BASIC,
    currentPeriodEnd: new Date((NOW_S + 86400 * 20) * 1000).toISOString(),
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
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  };
}

function upgradeHarness(freshRead: Sub) {
  const lines: Array<[string, Record<string, unknown>, string]> = [];
  const at = (level: string) => (ctx: Record<string, unknown>, message: string) => {
    lines.push([level, ctx, message]);
  };
  mockSubscriptionsRetrieve.mockImplementation(async (id: string) => {
    if (id !== freshRead.id) throw new Error(`unexpected subscription ${id}`);
    return JSON.parse(JSON.stringify(freshRead));
  });
  const deps: PlanUpgradeDeps = {
    logger: { info: at('info'), warn: at('warn'), error: at('error') },
    repo: { findByUser: async () => ({ data: rowFor(freshRead), error: null }) },
    stripe: new StripeService('sk_test_unit'),
    catalog: CATALOG,
    switches: () => ({ checkoutEnabled: true, pricesEnabled: true }),
    buyableTiers: () => TIER_ORDER,
    mode: () => 'test',
    now: () => new Date(NOW_S * 1000),
  };
  return { deps, lines, tier: PRO as (typeof TIER_ORDER)[number] };
}

const allLogs = (h: { lines: unknown[] }) =>
  JSON.stringify([h.lines, ...['info', 'warn', 'error', 'debug'].map((level) => sharedLogger[level].mock.calls)]);

beforeEach(() => {
  for (const fn of [mockSubscriptionsRetrieve, mockSubscriptionsUpdate, mockCreatePreview, mockInvoicesRetrieve, mockInvoicePaymentsList, mockPricesList]) {
    fn.mockReset();
  }
  for (const level of ['info', 'warn', 'error', 'debug']) sharedLogger[level].mockClear();
  mockPricesList.mockImplementation(async ({ lookup_keys }: { lookup_keys: string[] }) => ({
    data: [BASIC_PRICE, PRO_PRICE].filter((price) => lookup_keys.includes(price.lookup_key as string)),
  }));
});

describe('the captures are what the code says they are (non-vacuity)', () => {
  it('two catalog prices, one per tier, and a basic subscription with no pending update to start from', () => {
    expect([BASIC, PRO]).toEqual([TIER_ORDER[0], TIER_ORDER[1]]);
    expect(AFTER_EXPIRY.pending_update).toBeNull();
    expect(AFTER_EXPIRY.items.data).toHaveLength(1);
    expect(AFTER_EXPIRY.items.data[0].current_period_start).toBeLessThan(PRORATION);
  });
});

describe('E-1 / E-3 / E-5: the preview, through the real StripeService', () => {
  it.each([
    ['e1a-01-preview', 3387, 3387],
    ['e3-01-preview', 0, 3387],
    ['e5-01-preview', 14, 14],
  ])('%s → amounts read exactly (due %i, total %i, tax 0, usd)', async (name, due, total) => {
    const h = upgradeHarness(AFTER_EXPIRY);
    mockCreatePreview.mockResolvedValue(cap(name));
    const result = await previewPlanUpgrade({ userId: USER, tier: h.tier }, h.deps);
    expect(result).toMatchObject({ ok: true, amountDueMinor: due, totalMinor: total, taxMinor: 0, currency: 'usd', prorationDate: NOW_S });
    expect(mockCreatePreview).toHaveBeenCalledWith({
      customer: AFTER_EXPIRY.customer,
      subscription: AFTER_EXPIRY.id,
      subscription_details: {
        items: [{ id: (AFTER_EXPIRY.items.data[0] as unknown as { id: string }).id, price: PRO_PRICE.id }],
        proration_behavior: 'always_invoice',
        proration_date: NOW_S,
      },
    });
  });
});

describe('E-1 to E-6: the confirm, through the real StripeService', () => {
  const confirm = (h: ReturnType<typeof upgradeHarness>) => confirmPlanUpgrade({ userId: USER, tier: h.tier, prorationDate: PRORATION }, h.deps);
  /**
   * SA optimisation (P-7b.1b review): the fresh read is the real pre-upgrade
   * shape (E-4 after expiry) re-identified with THIS experiment's subscription
   * and customer, so the read, our row and the write's answer all name the same
   * subscription, as they did on the sandbox.
   */
  const freshReadFor = (name: string): Sub => {
    const update = cap<{ id: string; customer: string }>(name);
    return { ...AFTER_EXPIRY, id: update.id, customer: update.customer };
  };
  /** The write went to the experiment's own subscription. */
  const expectWriteTo = (fresh: Sub) => expect(mockSubscriptionsUpdate.mock.calls[0]?.[0]).toBe(fresh.id);

  it.each(['e1a-02-update-response', 'e3-02-update-response', 'e5-02-update-response', 'e6a-replay'])(
    '%s (applied, no pending update) → upgraded, and no payment read is made (SA F-1)',
    async (name) => {
      const fresh = freshReadFor(name);
      const h = upgradeHarness(fresh);
      mockSubscriptionsUpdate.mockResolvedValue(cap(name));
      const result = await confirm(h);
      expect(result).toMatchObject({ ok: true, outcome: 'upgraded' });
      expectWriteTo(fresh);
      expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
      expect(allLogs(h)).not.toContain(CAPTURED_SECRET);
    }
  );

  it('E-1b: a pending update + the one invoicePayments read (requires_action) → action_required with the secret, in no log', async () => {
    const fresh = freshReadFor('e1b-01-update-response');
    const h = upgradeHarness(fresh);
    const update = cap<{ latest_invoice: { id: string; payments?: unknown } }>('e1b-01-update-response');
    expect(update.latest_invoice.payments).toBeUndefined();
    mockSubscriptionsUpdate.mockResolvedValue(update);
    mockInvoicePaymentsList.mockResolvedValue(cap('e1b-02-invoicePayments-list'));
    const result = await confirm(h);
    expect(result).toMatchObject({ ok: true, outcome: 'action_required', clientSecret: CAPTURED_SECRET, resumed: false });
    expectWriteTo(fresh);
    expect(mockInvoicePaymentsList).toHaveBeenCalledTimes(1);
    expect(mockInvoicePaymentsList).toHaveBeenCalledWith({ invoice: update.latest_invoice.id, limit: 10, expand: ['data.payment.payment_intent'] });
    expect(allLogs(h)).not.toContain(CAPTURED_SECRET);
    expect(JSON.stringify((result as { audit: unknown }).audit)).not.toContain(CAPTURED_SECRET);
  });

  it('E-2: the decline is RETURNED (no throw), the pending update kept → declined + retryAfter = its expiry', async () => {
    const fresh = freshReadFor('e2-01-update-response');
    const h = upgradeHarness(fresh);
    const update = cap<{ pending_update: { expires_at: number } }>('e2-01-update-response');
    mockSubscriptionsUpdate.mockResolvedValue(update);
    mockInvoicePaymentsList.mockResolvedValue(cap<{ payments: unknown }>('e2-03-invoice').payments);
    const result = await confirm(h);
    expectWriteTo(fresh);
    expect(result).toMatchObject({
      ok: true,
      outcome: 'declined',
      retryAfter: new Date(update.pending_update.expires_at * 1000).toISOString(),
      audit: expect.objectContaining({ outcome: 'declined' }),
    });
    expect(allLogs(h)).not.toContain(CAPTURED_SECRET);
  });

  it('E-6: the in-flight conflict, rebuilt by the SDK from the captured raw body → upgrade_busy, not audited', async () => {
    // The race capture is an error body: its experiment's subscription is the replay's.
    const h = upgradeHarness(freshReadFor('e6a-replay'));
    const captured = cap<{ err: Record<string, unknown>; raw: Record<string, unknown> }>('e6a-race-1');
    const error = stripeErrors.StripeError.generate(captured.raw);
    // The SDK class the capture recorded, and the code SA F-2 matches on.
    expect(error.constructor.name).toBe(captured.err.type);
    expect((error as unknown as { code: string }).code).toBe('idempotency_key_in_use');
    mockSubscriptionsUpdate.mockRejectedValue(error);
    const result = await confirm(h);
    expect(result).toEqual({ ok: false, code: 'upgrade_busy' });
  });
});

describe('Q-2 resume and E-4 expiry over the captures', () => {
  it('E-1b: a pending update on the target, its open invoice waiting on 3-D Secure → resumed; the preview answers awaiting, never a secret', async () => {
    const pending = cap<Sub & { latest_invoice: string }>('e1b-04-subscription-pending');
    const openInvoice = cap<{ latest_invoice: Record<string, unknown> }>('e1b-01-update-response').latest_invoice;
    expect(openInvoice.id).toBe(pending.latest_invoice);
    mockInvoicesRetrieve.mockResolvedValue(openInvoice);
    mockInvoicePaymentsList.mockResolvedValue(cap('e1b-02-invoicePayments-list'));

    const h = upgradeHarness(pending);
    const confirmed = await confirmPlanUpgrade({ userId: USER, tier: h.tier, prorationDate: PRORATION }, h.deps);
    expect(confirmed).toMatchObject({ ok: true, outcome: 'action_required', clientSecret: CAPTURED_SECRET, resumed: true });
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();

    const p = upgradeHarness(pending);
    const previewed = await previewPlanUpgrade({ userId: USER, tier: p.tier }, p.deps);
    expect(previewed).toEqual({ ok: false, code: 'upgrade_awaiting_confirmation', amountDueMinor: 3387, prorationDate: NOW_S });
    expect(JSON.stringify(previewed)).not.toContain(CAPTURED_SECRET);
    expect(allLogs(h) + allLogs(p)).not.toContain(CAPTURED_SECRET);
  });

  it('E-4: the invoice is voided exactly at pending_update.expires_at (U-6), and the subscription is back to basic with none pending', () => {
    const update = cap<{ pending_update: { expires_at: number }; latest_invoice: { id: string } }>('e4-01-update-response');
    const voided = cap<{ id: string; status: string; status_transitions: { voided_at: number } }>('e4-11-invoice-after-expiry');
    expect(voided.id).toBe(update.latest_invoice.id);
    expect(voided.status).toBe('void');
    expect(voided.status_transitions.voided_at).toBe(update.pending_update.expires_at);
    expect(AFTER_EXPIRY.pending_update).toBeNull();
    expect(AFTER_EXPIRY.items.data[0].price.id).toBe(BASIC_PRICE.id);
  });

  it('E-4: a voided upgrade invoice behind a pending update is NOT resumable → upgrade_pending with retryAfter, no payment read, no write', async () => {
    const pending = cap<Sub>('e4-01-update-response');
    mockInvoicesRetrieve.mockResolvedValue(cap('e4-11-invoice-after-expiry'));
    const h = upgradeHarness(pending);
    const result = await confirmPlanUpgrade({ userId: USER, tier: h.tier, prorationDate: PRORATION }, h.deps);
    expect(result).toEqual({
      ok: false,
      code: 'upgrade_pending',
      retryAfter: new Date((pending.pending_update as { expires_at: number }).expires_at * 1000).toISOString(),
    });
    expect(mockInvoicePaymentsList).not.toHaveBeenCalled();
    expect(mockSubscriptionsUpdate).not.toHaveBeenCalled();
  });
});

// ── The webhook side over the captured events ───────────────────────────────

const tierOfPrice = (priceId: string) => (priceId === BASIC_PRICE.id ? BASIC : priceId === PRO_PRICE.id ? PRO : null);

describe('U-3 / CF-6: planInvoiceFacts over every captured invoice.paid event', () => {
  it.each([
    ['e1a-event-invoice-paid-no3X5G', 'subscription_update', 3387],
    ['e1b-event-invoice-paid-bd5SF4', 'subscription_update', 3387],
    ['e3-event-invoice-paid-Mm9iSs', 'subscription_update', 0],
    ['e5-event-invoice-paid-AVZ9jo', 'subscription_update', 0],
    ['e5-event-invoice-paid-3OxITR', 'subscription_cycle', 12914],
  ])('%s (%s, amount_paid %i) → pro, assigns the plan, deciding price = pro', (name, reason, amountPaid) => {
    const invoice = cap<{ data: { object: Stripe.Invoice } }>(name).data.object;
    expect([invoice.billing_reason, invoice.amount_paid]).toEqual([reason, amountPaid]);
    const result = planInvoiceFacts(invoice, invoice.lines.data, tierOfPrice, 'paid');
    expect(result).toMatchObject({
      ok: true,
      facts: { tier: PRO, assignsPlan: true, decidingPriceIds: [PRO_PRICE.id], amountMinor: amountPaid, amountTaxMinor: 0, currency: 'usd' },
    });
  });
});

function webhookHarness(subscriptions: Record<string, Sub>) {
  const applyCalls: BusinessOsApplyPlanPaymentInput[] = [];
  const recorded: BusinessOsBillingEventInput[] = [];
  const audits: RecordPlanChangeInput[] = [];
  const logLines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  mockSubscriptionsRetrieve.mockImplementation(async (id: string) => {
    const found = subscriptions[id];
    if (!found) throw Object.assign(new Error('No such subscription'), { code: 'resource_missing' });
    return JSON.parse(JSON.stringify(found));
  });
  const rowBy = (subscriptionId: string | null, customerId: string | null) => {
    const sub = Object.values(subscriptions).find((s) => s.id === subscriptionId || s.customer === customerId);
    return sub ? rowFor(sub) : null;
  };
  const deps: PlanPaymentDeps = {
    billingAccounts: {
      findByStripeSubscription: async (id: string) => ({ data: rowBy(id, null), error: null }),
      findByStripeCustomer: async (id: string) => ({ data: rowBy(null, id), error: null }),
    } as unknown as PlanPaymentDeps['billingAccounts'],
    billingEvents: {
      // The apply function's answer (Jest cannot run SQL; its rules are pinned by the P-3b and U-8 probes).
      applyPlanPayment: async (input: BusinessOsApplyPlanPaymentInput) => {
        applyCalls.push(input);
        return {
          data: {
            status: input.assignsPlan ? 'applied' : 'recorded',
            eventRowId: '44444444-4444-4444-8444-000000000001',
            tierBefore: BASIC,
            tierAfter: input.assignsPlan ? input.tier : BASIC,
            planWritten: input.assignsPlan,
            anchorSet: false,
            firstPaymentStamped: false,
          },
          error: null,
        };
      },
      recordEvent: async (input: BusinessOsBillingEventInput) => {
        recorded.push(input);
        return { data: { outcome: 'recorded', eventRowId: '44444444-4444-4444-8444-000000000002' }, error: null };
      },
    } as unknown as PlanPaymentDeps['billingEvents'],
    stripe: () => new StripeService('sk_test_unit'),
    catalog: CATALOG,
    entitlementConfig: () => ({ tierOrder: [...TIER_ORDER], matrix: { version: 1 } }) as unknown as ReturnType<PlanPaymentDeps['entitlementConfig']>,
    recordPlanChange: async (input: RecordPlanChangeInput) => {
      audits.push(input);
    },
  };
  const at = (level: string) => (ctx: Record<string, unknown>) => {
    logLines.push({ level, ctx });
  };
  const log = { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug') } as unknown as Logger;
  const logged = (event: string) => logLines.filter((l) => l.ctx.event === event);
  return { deps, log, applyCalls, recorded, audits, logged };
}

describe('U-4 and CF-6: the webhook apply over captured events and captured fresh reads', () => {
  const e1bPaid = () => cap<Stripe.Event>('e1b-event-invoice-paid-bd5SF4');
  const e1bAfterPay = () => cap<Sub>('e1b-06-subscription-after-pay');
  const e1bPending = () => cap<Sub>('e1b-04-subscription-pending');

  it('E-1b: paid, and Stripe now bills pro on its one item → the plan is written, billingReason in the audit (U-9)', async () => {
    const h = webhookHarness({ [e1bAfterPay().id]: e1bAfterPay() });
    await applyPaidPlanInvoice(e1bPaid(), h.log, h.deps);
    expect(h.applyCalls).toEqual([expect.objectContaining({ tier: PRO, assignsPlan: true, amountMinor: 3387 })]);
    expect(h.audits).toEqual([
      expect.objectContaining({ action: 'BOS_BILLING_INVOICE_PAID', details: expect.objectContaining({ billingReason: 'subscription_update' }) }),
    ]);
    expect(h.logged('bos_billing_upgrade_paid_not_applied')).toEqual([]);
  });

  it('E-1b: paid while the fresh read still shows ITS pending update → released for retry, nothing applied (V-5 branch 1)', async () => {
    const pending = e1bPending();
    expect((pending as unknown as { latest_invoice: string }).latest_invoice).toBe((e1bPaid().data.object as Stripe.Invoice).id);
    const h = webhookHarness({ [pending.id]: pending });
    await expect(applyPaidPlanInvoice(e1bPaid(), h.log, h.deps)).rejects.toBeInstanceOf(PlanPaymentRetryError);
    expect(h.applyCalls).toEqual([]);
  });

  it('U-4 case 2: the E-1a upgrade invoice against a captured subscription still on basic → recorded without the plan, alerted once', async () => {
    const event = cap<Stripe.Event>('e1a-event-invoice-paid-no3X5G');
    const invoice = event.data.object as Stripe.Invoice;
    // The E-4 subscription after expiry IS a basic subscription with no pending update; given this invoice's ids.
    const stillBasic = { ...AFTER_EXPIRY, id: invoice.parent!.subscription_details!.subscription as string, customer: invoice.customer as string };
    const h = webhookHarness({ [stillBasic.id]: stillBasic });
    await applyPaidPlanInvoice(event, h.log, h.deps);
    expect(h.applyCalls).toEqual([expect.objectContaining({ assignsPlan: false, amountMinor: 3387 })]);
    expect(h.logged('bos_billing_upgrade_paid_not_applied')).toEqual([
      expect.objectContaining({ level: 'error', ctx: expect.objectContaining({ alert: true }) }),
    ]);
  });

  it.each([
    ['e3-event-invoice-paid-Mm9iSs', 'E-3 credit balance'],
    ['e5-event-invoice-paid-AVZ9jo', 'E-5 under the minimum'],
  ])('CF-6, %s (%s): amount_paid 0 and Stripe bills pro → applied with the plan', async (name) => {
    const event = cap<Stripe.Event>(name);
    const invoice = event.data.object as Stripe.Invoice;
    const onPro = {
      ...e1bAfterPay(),
      id: invoice.parent!.subscription_details!.subscription as string,
      customer: invoice.customer as string,
    };
    const h = webhookHarness({ [onPro.id]: onPro });
    await applyPaidPlanInvoice(event, h.log, h.deps);
    expect(h.applyCalls).toEqual([expect.objectContaining({ tier: PRO, assignsPlan: true, amountMinor: 0 })]);
  });

  it('P-6a forward note: a 3-D Secure upgrade that later SUCCEEDS still leaves one invoice_payment_failed row, and moves nothing', async () => {
    const failed = cap<Stripe.Event>('e1b-event-invoice-payment_failed-PrF4oA');
    const pending = e1bPending();
    const h = webhookHarness({ [pending.id]: pending });
    await recordFailedPlanInvoice(failed, h.log, h.deps);
    expect(h.applyCalls).toEqual([]);
    expect(h.recorded.map((r) => r.kind)).toEqual(['invoice_payment_failed']);
    // The same invoice was paid moments later (E-1b): any future history display must not call this row a failed payment.
    expect((failed.data.object as Stripe.Invoice).id).toBe((e1bPaid().data.object as Stripe.Invoice).id);
  });
});

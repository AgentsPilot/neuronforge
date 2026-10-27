/**
 * `openPlanBillingPortal` / `listPlanInvoices` with fakes (plan payments
 * P-7a.2; workplan §4.4, §4.5; SA C-6, TQ-6). The routes' integration test
 * covers the boundaries; this pins what only the orchestration decides: the
 * order (no Stripe call before our data has passed), the cosmetic plan label,
 * and that faults are alerted by id, never by URL.
 */

import { resetPortalConfigurationCacheForTests } from '@/lib/business-os/billing/portalConfiguration';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { listPlanInvoices, openPlanBillingPortal, portalLocaleFor, type PlanBillingDocsDeps } from '@/lib/business-os/billing/planBillingDocuments';

const USER = 'user-1';
const HOSTED = 'https://invoice.stripe.com/i/acct_1/test_SECRETLINK';

function harness(overrides: Partial<PlanBillingDocsDeps> = {}) {
  const calls: string[] = [];
  const logged: string[] = [];
  const log = (level: string) => (context: Record<string, unknown>, message: string) => {
    logged.push(`${level}:${JSON.stringify(context)}:${message}`);
  };
  const deps: PlanBillingDocsDeps = {
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    switches: () => ({ pricesEnabled: true }),
    mode: () => 'test',
    origin: () => 'https://app.example.test',
    env: { STRIPE_BOS_PORTAL_CONFIGURATION_ID: 'bpc_1' },
    repo: {
      findByUser: jest.fn(async (userId: string, livemode: boolean) => {
        calls.push(`db:${userId}:${livemode}`);
        return {
          data: { livemode: false, stripeCustomerId: 'cus_own', stripeSubscriptionId: 'sub_own' } as never,
          error: null,
        };
      }),
    },
    stripe: {
      retrieveBusinessOsPortalConfiguration: jest.fn(async (id: string) => {
        calls.push(`stripe:config:${id}`);
        return {
          id,
          active: true,
          livemode: false,
          features: { payment_method_update: true, invoice_history: true, subscription_cancel: false, subscription_update: false, customer_update: false },
        };
      }),
      createBusinessOsPortalSession: jest.fn(async (params) => {
        calls.push('stripe:session');
        return { url: 'https://billing.stripe.com/p/session/test_SECRETPORTAL', customerId: params.customerId, configurationId: params.configurationId, livemode: false };
      }),
      listBusinessOsInvoices: jest.fn(async () => {
        calls.push('stripe:invoices');
        return {
          invoices: [
            { id: 'in_1', customerId: 'cus_own', livemode: false, status: 'paid', billingReason: 'subscription_cycle', totalMinor: 7900, currency: 'usd', created: 1_790_000_000, hostedInvoiceUrl: HOSTED, invoicePdf: null, priceIds: ['price_plan'] },
            { id: 'in_eur', customerId: 'cus_own', livemode: false, status: 'paid', billingReason: 'subscription_cycle', totalMinor: 100, currency: 'eur', created: 1_789_000_000, hostedInvoiceUrl: HOSTED, invoicePdf: null, priceIds: [] },
            { id: 'in_draft', customerId: 'cus_own', livemode: false, status: 'draft', billingReason: 'subscription_cycle', totalMinor: 7900, currency: 'usd', created: 1_791_000_000, hostedInvoiceUrl: null, invoicePdf: null, priceIds: [] },
          ],
          hasMore: false,
        };
      }),
    },
    catalog: {
      load: jest.fn(async () => {
        calls.push('stripe:catalog');
        return { byPriceId: new Map([['price_plan', 'bos_plan_pro_monthly_usd']]), fromCache: false };
      }),
    },
    ...overrides,
  };
  return { deps, calls, logged };
}

beforeEach(() => resetPortalConfigurationCacheForTests());

describe('portalLocaleFor (TQ-8, X-5)', () => {
  it('en and es as asked; he (not a Stripe portal locale) and nothing → auto', () => {
    expect([portalLocaleFor('en'), portalLocaleFor('es'), portalLocaleFor('he'), portalLocaleFor(undefined)]).toEqual(['en', 'es', 'auto', 'auto']);
  });
});

describe('order: our data before any Stripe call', () => {
  it.each([
    ['the switch off', { switches: () => ({ pricesEnabled: false }) }, 'documents_unavailable'],
    [
      'an unknown key mode',
      {
        mode: () => {
          throw new Error('stripe_key_mode_unknown');
        },
      },
      'documents_unavailable',
    ],
    ['an unreadable row', { repo: { findByUser: async () => ({ data: null, error: new Error('down') }) } }, 'billing_row_unreadable'],
    ['no row', { repo: { findByUser: async () => ({ data: null, error: null }) } }, 'no_billing_account'],
    [
      'a row of the other mode',
      { repo: { findByUser: async () => ({ data: { livemode: true, stripeCustomerId: 'cus_own', stripeSubscriptionId: 'sub_own' } as never, error: null }) } },
      'no_billing_account',
    ],
  ] as const)('%s → refused, zero Stripe calls (portal and invoices)', async (_label, overrides, code) => {
    for (const run of [
      (deps: PlanBillingDocsDeps) => openPlanBillingPortal({ userId: USER, intent: 'update_card' }, deps),
      (deps: PlanBillingDocsDeps) => listPlanInvoices({ userId: USER }, deps),
    ]) {
      const { deps, calls } = harness(overrides as Partial<PlanBillingDocsDeps>);
      expect(await run(deps)).toEqual({ ok: false, code });
      expect(calls.filter((c) => c.startsWith('stripe:'))).toEqual([]);
    }
  });
});

describe('listPlanInvoices', () => {
  it('labels from the catalog; drafts dropped quietly; a non-USD invoice dropped and ALERTED by id, never by link', async () => {
    const { deps, logged } = harness();
    const result = await listPlanInvoices({ userId: USER }, deps);
    expect(result).toMatchObject({ ok: true, hasMore: false });
    if (!result.ok) throw new Error('expected ok');
    expect(result.invoices.map((r) => [r.id, r.planLabel])).toEqual([['in_1', 'Autopilot']]);
    const alert = logged.find((line) => line.startsWith('error:') && line.includes('bos_billing_invoice_list_dropped'));
    expect(alert).toContain('in_eur');
    expect(alert).toContain('"alert":true');
    expect(alert).not.toContain('in_draft');
    expect(logged.join('\n')).not.toContain('SECRETLINK');
  });

  it('the plan label is cosmetic: an unreadable catalog leaves it empty and the list stands', async () => {
    const { deps } = harness({ catalog: { load: async () => Promise.reject(new Error('down')) } });
    const result = await listPlanInvoices({ userId: USER }, deps);
    if (!result.ok) throw new Error('expected ok');
    expect(result.invoices[0].planLabel).toBeNull();
  });
});

describe('openPlanBillingPortal', () => {
  it('the portal URL is returned to the caller and never logged', async () => {
    const { deps, logged, calls } = harness();
    expect(await openPlanBillingPortal({ userId: USER, intent: 'update_card', language: 'he' }, deps)).toEqual({
      ok: true,
      url: 'https://billing.stripe.com/p/session/test_SECRETPORTAL',
    });
    expect(calls).toEqual([`db:${USER}:false`, 'stripe:config:bpc_1', 'stripe:session']);
    expect(logged.join('\n')).not.toContain('SECRETPORTAL');
  });
});

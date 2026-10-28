/**
 * The Business OS portal configuration specification and its runtime check
 * (plan payments P-7a.2; workplan §4.4; SA-P10, C-6, TQ-7).
 */

import {
  BOS_PORTAL_FEATURES,
  PORTAL_RETURN_PATH,
  ensurePortalConfiguration,
  portalConfigurationProblems,
  portalReturnUrl,
  readPortalConfigurationId,
  resetPortalConfigurationCacheForTests,
  type PortalConfigurationFacts,
} from '@/lib/business-os/billing/portalConfiguration';
import { PLAN_CHECKOUT_RETURN_PATHS } from '@/lib/business-os/billing/planCheckout';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

function config(overrides: Partial<PortalConfigurationFacts> = {}): PortalConfigurationFacts {
  return { id: 'bpc_1', active: true, livemode: false, features: { ...BOS_PORTAL_FEATURES }, ...overrides };
}

describe('the specification (SA-P10)', () => {
  it('card and invoices on; cancel, plan switching and customer edits off', () => {
    expect(BOS_PORTAL_FEATURES).toEqual({
      payment_method_update: true,
      invoice_history: true,
      subscription_cancel: false,
      subscription_update: false,
      customer_update: false,
    });
  });

  it('a matching configuration has no problem; each drift is named', () => {
    expect(portalConfigurationProblems(config(), false)).toEqual([]);
    expect(portalConfigurationProblems(config({ features: { ...BOS_PORTAL_FEATURES, subscription_cancel: true } }), false)).toEqual([
      'subscription_cancel is on, expected off',
    ]);
    expect(portalConfigurationProblems(config(), true)).toEqual(['livemode is false, expected true']);
    expect(portalConfigurationProblems(config({ active: false }), false)).toEqual(['configuration is not active']);
  });

  it('returns to Settings → Plan, the same fixed path as the plan checkout', () => {
    expect(PORTAL_RETURN_PATH).toBe(PLAN_CHECKOUT_RETURN_PATHS.settings_plan);
    expect(portalReturnUrl('https://app.example.test/')).toBe('https://app.example.test/business-os/settings?section=plan');
  });
});

describe('readPortalConfigurationId (never a default)', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['  ', null],
    ['cus_123', null],
    ['bpc_ abc', null],
    ['bpc_1UUv5MC7KDUGYIcA3O6iIzRJ', 'bpc_1UUv5MC7KDUGYIcA3O6iIzRJ'],
    [' bpc_abc ', 'bpc_abc'],
  ])('%p → %p', (value, expected) => {
    expect(readPortalConfigurationId({ STRIPE_BOS_PORTAL_CONFIGURATION_ID: value })).toBe(expected);
  });
});

describe('ensurePortalConfiguration (C-6: success-only cache)', () => {
  const logger = { error: jest.fn() };
  const env = { STRIPE_BOS_PORTAL_CONFIGURATION_ID: 'bpc_1' };

  beforeEach(() => {
    resetPortalConfigurationCacheForTests();
    logger.error.mockClear();
  });

  it('missing id → refused and alerted, Stripe not asked', async () => {
    const retrieve = jest.fn();
    expect(await ensurePortalConfiguration({ livemode: false, retrieve, logger, env: {} })).toEqual({ ok: false, reason: 'configuration_missing' });
    expect(retrieve).not.toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toMatchObject({ alert: true, event: 'bos_billing_portal_configuration_missing' });
  });

  it('a pass is cached per id and mode; a failure is not', async () => {
    const retrieve = jest.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(config());
    expect(await ensurePortalConfiguration({ livemode: false, retrieve, logger, env })).toEqual({ ok: false, reason: 'configuration_unreadable' });
    expect(await ensurePortalConfiguration({ livemode: false, retrieve, logger, env })).toEqual({ ok: true, configurationId: 'bpc_1' });
    expect(await ensurePortalConfiguration({ livemode: false, retrieve, logger, env })).toEqual({ ok: true, configurationId: 'bpc_1' });
    expect(retrieve).toHaveBeenCalledTimes(2);
    // Another mode is checked again (and here refused: the configuration is test-mode).
    expect(await ensurePortalConfiguration({ livemode: true, retrieve, logger, env })).toEqual({ ok: false, reason: 'configuration_mismatch' });
    expect(retrieve).toHaveBeenCalledTimes(3);
  });

  it('a mismatch is refused every time (never cached)', async () => {
    const retrieve = jest.fn().mockResolvedValue(config({ features: { ...BOS_PORTAL_FEATURES, subscription_update: true } }));
    for (let i = 0; i < 2; i += 1) {
      expect(await ensurePortalConfiguration({ livemode: false, retrieve, logger, env })).toEqual({ ok: false, reason: 'configuration_mismatch' });
    }
    expect(retrieve).toHaveBeenCalledTimes(2);
  });

  it('Stripe answering another id is a mismatch', async () => {
    const retrieve = jest.fn().mockResolvedValue(config({ id: 'bpc_other' }));
    expect(await ensurePortalConfiguration({ livemode: false, retrieve, logger, env })).toEqual({ ok: false, reason: 'configuration_mismatch' });
  });
});

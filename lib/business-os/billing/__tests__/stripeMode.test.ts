/**
 * stripeMode (plan payments P-2a, workplan §3.6 and §7).
 */

import { currentStripeMode, isLiveMode, stripeModeFromKey } from '@/lib/business-os/billing/stripeMode';

describe('stripeModeFromKey', () => {
  it.each([
    ['sk_test_abc', 'test'],
    ['rk_test_abc', 'test'],
    ['sk_live_abc', 'live'],
    ['rk_live_abc', 'live'],
  ])('%s → %s', (key, mode) => {
    expect(stripeModeFromKey(key)).toBe(mode);
  });

  it.each([['pk_test_abc'], ['pk_live_abc'], ['sk_abc'], ['whsec_abc'], [''], [' sk_test_abc'], ['SK_TEST_ABC']])(
    'refuses %p',
    (key) => {
      expect(() => stripeModeFromKey(key)).toThrow('stripe_key_mode_unknown');
    }
  );

  it('refuses undefined and null, and never echoes the key in the error', () => {
    expect(() => stripeModeFromKey(undefined)).toThrow('stripe_key_mode_unknown');
    expect(() => stripeModeFromKey(null)).toThrow('stripe_key_mode_unknown');
    try {
      stripeModeFromKey('xk_secretvalue');
    } catch (err) {
      expect((err as Error).message).not.toContain('secretvalue');
    }
  });

  it('isLiveMode spells livemode', () => {
    expect(isLiveMode('live')).toBe(true);
    expect(isLiveMode('test')).toBe(false);
  });
});

describe('currentStripeMode', () => {
  const original = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (original === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = original;
  });

  it('reads STRIPE_SECRET_KEY', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_live_x';
    expect(currentStripeMode()).toBe('live');
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(currentStripeMode()).toBe('test');
  });

  it('throws when the env is missing', () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => currentStripeMode()).toThrow('stripe_key_mode_unknown');
  });
});

/**
 * setup-bos-portal-configuration (plan payments P-7a.2; workplan §4.4; SA
 * C-8, TQ-7; go-live row 13). No test here calls Stripe.
 *
 * The shared guards (`--env` outside every checkout, `--expect-account`, key
 * redaction) are pinned in `stripePlanPriceScripts.test.ts`; this file pins
 * what is new: the mode rule (test by default, live only with `--live`), the
 * return origin, and compare-and-stop.
 */

import { BOS_PORTAL_FEATURES } from '@/lib/business-os/billing/portalConfiguration';
import { ScriptRefusal, assertKeyKind } from '../lib/stripe-script-guards';
import {
  allowedKeyKinds,
  createParams,
  parseReturnOrigin,
  planPortalSetup,
  type ExistingPortalConfiguration,
} from '../setup-bos-portal-configuration';

function existing(overrides: Partial<ExistingPortalConfiguration> = {}): ExistingPortalConfiguration {
  return {
    id: 'bpc_ours',
    active: true,
    livemode: false,
    isDefault: false,
    metadataProduct: 'business_os_portal',
    defaultReturnUrl: null,
    features: { ...BOS_PORTAL_FEATURES },
    ...overrides,
  };
}

describe('mode (TQ-7)', () => {
  it('test by default: only sk_test; a live key without --live is refused before any call', () => {
    expect(allowedKeyKinds(false)).toEqual(['sk_test']);
    expect(() => assertKeyKind('sk_live_FAKE0000', allowedKeyKinds(false))).toThrow(ScriptRefusal);
    expect(() => assertKeyKind('rk_test_FAKE0000', allowedKeyKinds(false))).toThrow(ScriptRefusal);
  });

  it('--live: only sk_live / rk_live; a test key is refused', () => {
    expect(allowedKeyKinds(true)).toEqual(['sk_live', 'rk_live']);
    expect(() => assertKeyKind('sk_test_FAKE0000', allowedKeyKinds(true))).toThrow(ScriptRefusal);
    expect(assertKeyKind('rk_live_FAKE0000', allowedKeyKinds(true))).toBe('rk_live');
  });
});

describe('parseReturnOrigin', () => {
  it('absent → null; an origin → the origin', () => {
    expect(parseReturnOrigin(undefined, false)).toBeNull();
    expect(parseReturnOrigin('https://app.example.test', true)).toBe('https://app.example.test');
    expect(parseReturnOrigin('http://localhost:3000', false)).toBe('http://localhost:3000');
  });

  it.each([
    ['a path', 'https://app.example.test/x', false],
    ['a query', 'https://app.example.test/?a=1', false],
    ['credentials', 'https://u:p@app.example.test', false],
    ['http on a real host', 'http://app.example.test', false],
    ['http localhost in live mode', 'http://localhost:3000', true],
    ['not a URL', 'app.example.test', false],
  ])('refuses %s', (_label, value, live) => {
    expect(() => parseReturnOrigin(value, live)).toThrow(ScriptRefusal);
  });
});

describe('planPortalSetup (compare and stop, never edit)', () => {
  it("none of ours → create (another product's configuration is ignored)", () => {
    expect(planPortalSetup([existing({ id: 'bpc_agent', metadataProduct: null })], false, null)).toEqual({ kind: 'create', stops: [] });
  });

  it('ours, matching → unchanged; being the account default is a note, not a stop', () => {
    expect(planPortalSetup([existing({ isDefault: true })], false, null)).toEqual({ kind: 'unchanged', id: 'bpc_ours', isDefault: true, stops: [] });
  });

  it.each([
    ['cancel switched on', { features: { ...BOS_PORTAL_FEATURES, subscription_cancel: true } }],
    ['plan switching on', { features: { ...BOS_PORTAL_FEATURES, subscription_update: true } }],
    ['customer edits on', { features: { ...BOS_PORTAL_FEATURES, customer_update: true } }],
    ['card update off', { features: { ...BOS_PORTAL_FEATURES, payment_method_update: false } }],
    ['archived', { active: false }],
    ['the other mode', { livemode: true }],
  ])('ours with %s → STOP', (_label, overrides) => {
    expect(planPortalSetup([existing(overrides as Partial<ExistingPortalConfiguration>)], false, null).stops.length).toBeGreaterThan(0);
  });

  it('a different default return URL stops only when --return-origin was given', () => {
    const drifted = existing({ defaultReturnUrl: 'http://localhost:3000/business-os/settings?section=plan' });
    expect(planPortalSetup([drifted], false, null).stops).toEqual([]);
    expect(planPortalSetup([drifted], false, 'https://app.example.test/business-os/settings?section=plan').stops).toHaveLength(1);
  });

  it('two of ours → STOP', () => {
    expect(planPortalSetup([existing(), existing({ id: 'bpc_two' })], false, null).stops).toHaveLength(1);
  });
});

describe('createParams', () => {
  it('exactly the specification, our marker, no default flag', () => {
    expect(createParams('https://app.example.test/business-os/settings?section=plan')).toEqual({
      name: 'AgentPilot Business OS plan: card and invoices',
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        subscription_cancel: { enabled: false },
        subscription_update: { enabled: false },
        customer_update: { enabled: false },
      },
      metadata: { product: 'business_os_portal' },
      default_return_url: 'https://app.example.test/business-os/settings?section=plan',
    });
    expect(createParams(null)).not.toHaveProperty('default_return_url');
  });
});

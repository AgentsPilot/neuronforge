/**
 * The ONE Stripe.js loader (plan payments P-4.1, M-4; P-5a.2 SA P5-3).
 *
 *   - a missing key, or one not shaped like a publishable key, is `null`
 *     (the boost panel's `pk_(test|live)_` check, adopted here);
 *   - one Stripe.js instance per page;
 *   - the boost panel uses it and no longer loads Stripe.js itself;
 *   - the Connect payment form (website blocks) is NOT on it (SA O-3).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const mockLoadStripe = jest.fn(async (key: string) => ({ key }));
jest.mock('@stripe/stripe-js', () => ({ loadStripe: (key: string) => mockLoadStripe(key) }));

const KEY = 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY';
const saved = process.env[KEY];

function freshLoader(): typeof import('@/lib/client/stripeJs') {
  let loader: typeof import('@/lib/client/stripeJs') | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- a fresh module instance per test, so the singleton starts empty
    loader = require('@/lib/client/stripeJs') as typeof import('@/lib/client/stripeJs');
  });
  return loader!;
}

beforeEach(() => mockLoadStripe.mockClear());
afterAll(() => {
  if (saved === undefined) delete process.env[KEY];
  else process.env[KEY] = saved;
});

describe('getStripePromise', () => {
  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['a secret key pasted by mistake', 'sk_test_never_in_the_browser'],
    ['a restricted key', 'rk_live_abc'],
    ['a typo', 'pk_tst_abc'],
  ])('%s → null, and Stripe.js is never loaded', (_label, value) => {
    if (value === undefined) delete process.env[KEY];
    else process.env[KEY] = value;
    expect(freshLoader().getStripePromise()).toBeNull();
    expect(mockLoadStripe).not.toHaveBeenCalled();
  });

  it.each([['pk_test_abc'], ['pk_live_abc']])('%s → loaded once, the same instance on every call', (value) => {
    process.env[KEY] = value;
    const loader = freshLoader();
    const first = loader.getStripePromise();
    const second = loader.getStripePromise();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(mockLoadStripe).toHaveBeenCalledTimes(1);
    expect(mockLoadStripe).toHaveBeenCalledWith(value);
  });
});

describe('one loader on the billing surface (M-4)', () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('BoostPackagesPanel uses the shared loader and does not load Stripe.js itself', () => {
    const panel = code(read('components/business-os/BoostPackagesPanel.tsx'));
    expect(panel).toContain("from '@/lib/client/stripeJs'");
    expect(panel).toContain('getStripePromise()');
    expect(panel).not.toMatch(/loadStripe/);
    expect(panel).not.toMatch(/@stripe\/stripe-js/);
  });

  it('the Connect payment form keeps its own loader (Connect money, SR-10, SA O-3)', () => {
    expect(code(read('components/website/blocks/StripePaymentForm.tsx'))).not.toContain('@/lib/client/stripeJs');
  });
});

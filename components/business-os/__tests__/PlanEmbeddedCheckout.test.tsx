/**
 * @jest-environment jsdom
 *
 * The shared plan embedded checkout (plan payments P-5a.2; workplan §3.4, §8
 * "Shared checkout"; SA P5-3).
 *
 *   - POSTs exactly `{ tier, returnTo }`;
 *   - the client secret reaches Stripe's provider and NO callback;
 *   - a refusal surfaces `code` / `expiresAt`;
 *   - no publishable key → the "not configured" line;
 *   - ONE Stripe.js loader among the plan checkout files.
 */

import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { ReactNode } from 'react';

const stripe: { promise: Promise<unknown> | null; mounted: string[]; completes: Array<() => void> } = {
  promise: Promise.resolve({}),
  mounted: [],
  completes: [],
};
jest.mock('@/lib/client/stripeJs', () => ({ getStripePromise: () => stripe.promise }));
jest.mock('@stripe/react-stripe-js', () => ({
  EmbeddedCheckoutProvider: ({ options, children }: { options: { clientSecret: string; onComplete?: () => void }; children: ReactNode }) => {
    stripe.mounted.push(options.clientSecret);
    if (options.onComplete) stripe.completes.push(options.onComplete);
    return <div data-testid="fake-provider">{children}</div>;
  },
  EmbeddedCheckout: () => <div data-testid="fake-checkout" />,
}));

import {
  PLAN_CHECKOUT_ENDPOINT,
  PlanEmbeddedCheckout,
  REDACTED_CLIENT_SECRET,
  type PlanEmbeddedCheckoutProps,
} from '@/components/business-os/billing/PlanEmbeddedCheckout';

const SECRET = 'cs_test_secret_must_not_leak';
const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
let reply: { status: number; body: unknown } = { status: 200, body: {} };

beforeEach(() => {
  stripe.promise = Promise.resolve({});
  stripe.mounted.length = 0;
  stripe.completes.length = 0;
  calls.length = 0;
  reply = {
    status: 200,
    body: { success: true, data: { clientSecret: SECRET, sessionId: 'cs_test_s1', expiresAt: '2026-10-12T10:31:00.000Z', tier: 'some_tier' } },
  };
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return { ok: reply.status === 200, status: reply.status, json: async () => reply.body } as Response;
  }) as unknown as typeof fetch;
});

function setup(overrides: Partial<PlanEmbeddedCheckoutProps> = {}) {
  const callbacks = {
    onRequest: jest.fn(),
    onStarted: jest.fn(),
    onRefused: jest.fn(),
    onRequestFailed: jest.fn(),
    onComplete: jest.fn(),
    onResponse: jest.fn(),
  };
  render(
    <PlanEmbeddedCheckout
      tier="some_tier"
      returnTo="awaiting_payment"
      labels={{ start: 'Pay', starting: 'Opening…', notConfigured: 'Not configured' }}
      testId="shared"
      {...callbacks}
      {...overrides}
    />
  );
  return callbacks;
}

describe('PlanEmbeddedCheckout', () => {
  it('POSTs exactly { tier, returnTo } to the plan checkout route', async () => {
    setup();
    await userEvent.setup().click(screen.getByTestId('shared-start'));
    expect(PLAN_CHECKOUT_ENDPOINT).toBe('/api/business-os/billing/plan/checkout');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(PLAN_CHECKOUT_ENDPOINT);
    expect(calls[0].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ tier: 'some_tier', returnTo: 'awaiting_payment' });
  });

  it('mounts the session in Stripe\'s provider, and no callback ever receives the client secret', async () => {
    const callbacks = setup();
    await userEvent.setup().click(screen.getByTestId('shared-start'));
    expect(await screen.findByTestId('fake-checkout')).toBeInTheDocument();
    expect(stripe.mounted).toContain(SECRET);
    expect(screen.queryByTestId('shared-start')).not.toBeInTheDocument();

    expect(callbacks.onStarted).toHaveBeenCalledWith({ sessionId: 'cs_test_s1', expiresAt: '2026-10-12T10:31:00.000Z' });
    expect(callbacks.onResponse).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ clientSecret: REDACTED_CLIENT_SECRET }) }));

    stripe.completes[stripe.completes.length - 1]();
    expect(callbacks.onComplete).toHaveBeenCalledWith('cs_test_s1');

    for (const fn of Object.values(callbacks)) expect(JSON.stringify(fn.mock.calls)).not.toContain(SECRET);
  });

  it('a refusal surfaces code and expiresAt (and the server message, for internal screens), with no mount', async () => {
    reply = { status: 409, body: { success: false, error: 'A checkout is already open for your account.', code: 'checkout_open', expiresAt: '2026-10-12T10:20:00.000Z' } };
    const callbacks = setup();
    await userEvent.setup().click(screen.getByTestId('shared-start'));
    expect(callbacks.onRefused).toHaveBeenCalledWith({
      httpStatus: 409,
      code: 'checkout_open',
      expiresAt: '2026-10-12T10:20:00.000Z',
      serverMessage: 'A checkout is already open for your account.',
    });
    expect(callbacks.onStarted).not.toHaveBeenCalled();
    expect(stripe.mounted).toEqual([]);
    expect(screen.getByTestId('shared-start')).toBeEnabled();
  });

  it('a body with no code (e.g. a 500) reports code null; a network failure calls onRequestFailed', async () => {
    reply = { status: 500, body: { success: false, error: 'Internal server error' } };
    const callbacks = setup();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('shared-start'));
    expect(callbacks.onRefused).toHaveBeenCalledWith(expect.objectContaining({ httpStatus: 500, code: null, expiresAt: null }));

    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByTestId('shared-start'));
    expect(callbacks.onRequestFailed).toHaveBeenCalledWith('offline');
  });

  // Rewritten on purpose for P-4.1 M-2: the key is checked BEFORE the POST, so
  // there is no start button to click and no session (or lock) is ever opened.
  it('M-2: no usable publishable key → the "not configured" line, NO start button, and the route is never called', () => {
    stripe.promise = null;
    const callbacks = setup();
    expect(screen.getByTestId('shared-not-configured')).toHaveTextContent('Not configured');
    expect(screen.queryByTestId('shared-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fake-checkout')).not.toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(callbacks.onRequest).not.toHaveBeenCalled();
  });

  it('disabled keeps the start button disabled', () => {
    setup({ disabled: true });
    expect(screen.getByTestId('shared-start')).toBeDisabled();
  });
});

describe('one Stripe.js loader (SA P5-3)', () => {
  const read = (relative: string) => readFileSync(join(process.cwd(), relative), 'utf8');
  const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('loadStripe( appears only in lib/client/stripeJs.ts among the plan checkout files', () => {
    expect(code(read('lib/client/stripeJs.ts'))).toContain('loadStripe(key)');
    for (const file of [
      'components/business-os/billing/PlanEmbeddedCheckout.tsx',
      'components/test-business-os/PlanCheckoutPanel.tsx',
      'app/invite/awaiting-payment/HeldPaymentCheckout.tsx',
      'app/invite/awaiting-payment/page.tsx',
    ]) {
      expect(code(read(file))).not.toMatch(/loadStripe\(/);
    }
  });

  it('the shared component imports nothing from the entitlements module and takes the tier as a string', () => {
    const text = code(read('components/business-os/billing/PlanEmbeddedCheckout.tsx'));
    expect(text).not.toMatch(/business-os\/entitlements/);
    expect(text).toContain('tier: string;');
    expect(text).not.toMatch(/console\./);
  });
});

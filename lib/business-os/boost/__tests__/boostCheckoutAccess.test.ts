/**
 * Who may reach the boost checkout, and its return URL (credits boost slice 3;
 * SA C-1, C-6, C-7, Q-6), plus the Business OS Stripe client's pins (Q-1, C-7).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import {
  BOOST_RETURN_PATH,
  boostReturnUrl,
  isBoostCheckoutOpenFor,
  parseBoostTestAccounts,
} from '@/lib/business-os/boost/boostCheckoutAccess';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe('the flag and the test-account list (C-1, C-7)', () => {
  it('flag unset or off → closed for everyone, list or not', () => {
    delete process.env.BUSINESS_OS_CREDITS_BOOST_ENABLED;
    expect(isBoostCheckoutOpenFor(A)).toBe(false);
    process.env.BUSINESS_OS_CREDITS_BOOST_ENABLED = 'false';
    process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS = A;
    expect(isBoostCheckoutOpenFor(A)).toBe(false);
  });

  it('flag on and no list → open to every account (the launch switch)', () => {
    process.env.BUSINESS_OS_CREDITS_BOOST_ENABLED = 'true';
    delete process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS;
    expect(isBoostCheckoutOpenFor(A)).toBe(true);
    expect(isBoostCheckoutOpenFor(B)).toBe(true);
  });

  it('flag on and a list → only the listed accounts (case-insensitive)', () => {
    process.env.BUSINESS_OS_CREDITS_BOOST_ENABLED = '1';
    process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS = ` ${A.toUpperCase()} , `;
    expect(isBoostCheckoutOpenFor(A)).toBe(true);
    expect(isBoostCheckoutOpenFor(B)).toBe(false);
  });

  it('the list is parsed as UUIDs: blanks ignored, invalid entries ignored and warned once', () => {
    const log = { warn: jest.fn(), error: jest.fn() };
    const raw = `${A},not-an-id,,${B}`;
    expect([...(parseBoostTestAccounts(raw, log) ?? [])]).toEqual([A, B]);
    parseBoostTestAccounts(raw, log);
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.error).not.toHaveBeenCalled();
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('not-an-id');
    expect(parseBoostTestAccounts('', log)).toBeNull();
    expect(parseBoostTestAccounts('   ', log)).toBeNull();
    expect(parseBoostTestAccounts(undefined, log)).toBeNull();
  });

  it('SA CR-2: a set list with no valid UUID closes the checkout to everyone and logs an error once', () => {
    const log = { warn: jest.fn(), error: jest.fn() };
    const bad = parseBoostTestAccounts('not-a-uuid,also-bad', log);
    expect(bad).not.toBeNull();
    expect(bad?.size).toBe(0);
    parseBoostTestAccounts('not-a-uuid,also-bad', log);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('not-a-uuid');

    process.env.BUSINESS_OS_CREDITS_BOOST_ENABLED = 'true';
    process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS = 'not-a-uuid,also-bad';
    expect(isBoostCheckoutOpenFor(A)).toBe(false);
    process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS = 'owner@example.com, tester@example.com';
    expect(isBoostCheckoutOpenFor(A, log)).toBe(false);
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('example.com');
  });
});

describe('the return URL (C-6)', () => {
  it('uses NEXT_PUBLIC_APP_URL when set, trailing slashes trimmed', () => {
    expect(boostReturnUrl('https://evil.example', { appUrl: 'https://app.example.com/', nodeEnv: 'production' })).toBe(`https://app.example.com${BOOST_RETURN_PATH}`);
  });

  it('falls back to the request origin only in development', () => {
    expect(boostReturnUrl('http://localhost:3000', { appUrl: undefined, nodeEnv: 'development' })).toBe(`http://localhost:3000${BOOST_RETURN_PATH}`);
    expect(boostReturnUrl('https://evil.example', { appUrl: undefined, nodeEnv: 'production' })).toBeNull();
    expect(boostReturnUrl('https://evil.example', { appUrl: '  ', nodeEnv: 'test' })).toBeNull();
  });

  it('carries the session placeholder Stripe fills in', () => {
    expect(BOOST_RETURN_PATH).toContain('{CHECKOUT_SESSION_ID}');
  });
});

describe('the Business OS Stripe client (Q-1, C-7)', () => {
  const ROOT = process.cwd();
  const client = readFileSync(join(ROOT, 'lib', 'business-os', 'billing', 'stripeClient.ts'), 'utf8');
  const service = readFileSync(join(ROOT, 'lib', 'stripe', 'StripeService.ts'), 'utf8');

  it("starts with import 'server-only'", () => {
    expect(client.trimStart().startsWith("import 'server-only';")).toBe(true);
  });

  it('is pinned to the same API version as StripeService', () => {
    const ours = client.match(/STRIPE_API_VERSION = '([^']+)'/)?.[1];
    const theirs = service.match(/apiVersion: '([^']+)'/)?.[1];
    expect(ours).toBeDefined();
    expect(ours).toBe(theirs);
  });

  it('throws stripe_key_missing on first use without a key, and never at import', () => {
    delete process.env.STRIPE_SECRET_KEY;
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs a synchronous require
      const mod = require('@/lib/business-os/billing/stripeClient') as typeof import('@/lib/business-os/billing/stripeClient');
      expect(() => mod.getBusinessOsStripeClient()).toThrow('stripe_key_missing');
    });
  });
});

describe('R-5: allow-list edge cases', () => {
  it.each([
    [`  ${A.toUpperCase()}  `, true],
    [`${B}, ${A}`, true],
    [`{${A}}`, false],
    [' , ,', false],
    [B, false],
  ])('list %p → open for A is %p', (list, open) => {
    process.env.BUSINESS_OS_CREDITS_BOOST_ENABLED = 'true';
    process.env.BUSINESS_OS_CREDITS_BOOST_TEST_ACCOUNTS = list;
    expect(isBoostCheckoutOpenFor(A, { warn: jest.fn(), error: jest.fn() })).toBe(open);
  });
});

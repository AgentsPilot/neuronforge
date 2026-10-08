/**
 * The Business OS Stripe scripts' refusals and planning (plan payments P-2b,
 * workplan §3.5; SA P2-C9, P1-C7). No test here calls Stripe.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ScriptRefusal,
  assertKeyKind,
  enclosingGitCheckout,
  readStripeKey,
  redactKeys,
  requireExpectedAccount,
  resolveEnvFile,
  verifyAccount,
} from '../lib/stripe-script-guards';
import { planSetup, productIdForTier, type TierState } from '../setup-bos-plan-prices';
import { formatFindings } from '../check-bos-plan-prices';
import { describeEndpoints, webhookDeliveryRefusal } from '../capture-stripe-billing-fixtures';
import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_MATRIX, TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';

const ROOT = path.resolve(__dirname, '..', '..');
const FAKE_LIVE = 'sk_live_FAKE0000000000000000';
const FAKE_RESTRICTED = 'rk_test_FAKE0000000000000000';
const FAKE_TEST = 'sk_test_FAKE0000000000000000';

let outside: string;

beforeAll(() => {
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'bos-stripe-guard-'));
});
afterAll(() => {
  fs.rmSync(outside, { recursive: true, force: true });
});

function keyFile(name: string, body: string, dir = outside): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

describe('resolveEnvFile (P2-C9: the key file lies outside every repo)', () => {
  it('is required', () => {
    expect(() => resolveEnvFile([], ROOT)).toThrow(ScriptRefusal);
    expect(() => resolveEnvFile(['--env'], ROOT)).toThrow(/--env <file> is required/);
  });

  it('refuses a file under the current directory, even one that does not exist yet', () => {
    expect(() => resolveEnvFile(['--env', '.env.local'], ROOT)).toThrow(/inside the current directory/);
    expect(() => resolveEnvFile(['--env', path.join(ROOT, 'nested', 'k.env')], ROOT)).toThrow(/inside the current directory/);
  });

  it('refuses a file inside ANY git checkout (another worktree or repo), not just the current one', () => {
    const repo = fs.mkdtempSync(path.join(outside, 'repo-'));
    fs.mkdirSync(path.join(repo, '.git'));
    fs.mkdirSync(path.join(repo, 'deep'));
    const file = keyFile('k.env', `STRIPE_SECRET_KEY=${FAKE_TEST}\n`, path.join(repo, 'deep'));
    expect(enclosingGitCheckout(file)).toBe(repo);
    expect(() => resolveEnvFile(['--env', file], ROOT)).toThrow(/inside a git checkout/);

    // A worktree has a .git FILE, not a folder.
    const worktree = fs.mkdtempSync(path.join(outside, 'wt-'));
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: elsewhere\n');
    const wtFile = keyFile('k.env', `STRIPE_SECRET_KEY=${FAKE_TEST}\n`, worktree);
    expect(() => resolveEnvFile(['--env', wtFile], ROOT)).toThrow(/inside a git checkout/);
  });

  it('refuses a missing file, and accepts an existing file outside every checkout', () => {
    expect(() => resolveEnvFile(['--env', path.join(outside, 'nope.env')], ROOT)).toThrow(/not found/);
    const file = keyFile('ok.env', `STRIPE_SECRET_KEY=${FAKE_TEST}\n`);
    expect(resolveEnvFile(['--env', file], ROOT)).toBe(path.resolve(file));
  });
});

describe('the key', () => {
  it('is read from the file without touching process.env', () => {
    const saved = process.env.STRIPE_SECRET_KEY;
    const file = keyFile('read.env', `OTHER=1\nSTRIPE_SECRET_KEY=${FAKE_TEST}\n`);
    expect(readStripeKey(file)).toBe(FAKE_TEST);
    expect(process.env.STRIPE_SECRET_KEY).toBe(saved);
    expect(readStripeKey(keyFile('empty.env', 'OTHER=1\n'))).toBe('');
  });

  it('setup and capture accept only sk_test; the check accepts the four kinds', () => {
    expect(assertKeyKind(FAKE_TEST, ['sk_test'])).toBe('sk_test');
    for (const key of [FAKE_LIVE, FAKE_RESTRICTED, '', 'pk_test_x', 'whatever']) {
      expect(() => assertKeyKind(key, ['sk_test'])).toThrow(ScriptRefusal);
    }
    for (const key of [FAKE_TEST, FAKE_RESTRICTED, FAKE_LIVE, 'rk_live_x']) {
      expect(() => assertKeyKind(key, ['sk_test', 'rk_test', 'sk_live', 'rk_live'])).not.toThrow();
    }
  });

  it('a refusal never echoes the key', () => {
    for (const key of [FAKE_LIVE, FAKE_RESTRICTED, 'garbage-key-value']) {
      try {
        assertKeyKind(key, ['sk_test']);
      } catch (err) {
        expect((err as Error).message).not.toContain(key);
        expect((err as Error).message).not.toContain('FAKE');
      }
    }
  });

  it('redactKeys removes anything shaped like a key, masked or not', () => {
    expect(redactKeys(`Invalid API Key provided: sk_test_****abcd and ${FAKE_LIVE}`)).toBe(
      'Invalid API Key provided: <redacted key> and <redacted key>'
    );
  });
});

describe('the account guard', () => {
  it('--expect-account is required and shaped acct_...', () => {
    expect(() => requireExpectedAccount([])).toThrow(/--expect-account acct_... is required/);
    expect(() => requireExpectedAccount(['--expect-account', 'sandbox'])).toThrow(/must look like acct_/);
    expect(requireExpectedAccount(['--expect-account', 'acct_1ABC'])).toBe('acct_1ABC');
  });

  it('stops when the key belongs to another account, and names both', async () => {
    const stripe = { accounts: { retrieveCurrent: jest.fn().mockResolvedValue({ id: 'acct_other', settings: { dashboard: { display_name: 'Other' } } }) } };
    await expect(verifyAccount(stripe, 'acct_mine')).rejects.toThrow(/belongs to acct_other \(Other\), not acct_mine/);
    await expect(verifyAccount(stripe, 'acct_other')).resolves.toEqual({ id: 'acct_other', displayName: 'Other' });
  });
});

describe('planSetup (what setup-bos-plan-prices would do)', () => {
  function state(tier: TierId, overrides: Partial<TierState> = {}): TierState {
    return {
      tier,
      productId: productIdForTier(tier),
      productName: TIER_MATRIX.presentation[tier].labels.en,
      lookupKey: PLAN_STRIPE_PRICES[tier].lookupKey,
      displayPriceUsd: TIER_MATRIX.presentation[tier].monthlyPriceUsd,
      product: null,
      prices: [],
      ...overrides,
    };
  }
  const product = (tier: TierId, o: Partial<{ active: boolean; livemode: boolean; name: string }> = {}) => ({
    id: productIdForTier(tier),
    active: true,
    livemode: false,
    name: TIER_MATRIX.presentation[tier].labels.en,
    ...o,
  });
  const price = (tier: TierId, o: Record<string, unknown> = {}) => ({
    id: `price_${tier}`,
    lookup_key: PLAN_STRIPE_PRICES[tier].lookupKey,
    active: true,
    currency: 'usd',
    unit_amount: Math.round(TIER_MATRIX.presentation[tier].monthlyPriceUsd * 100),
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    tax_behavior: 'exclusive',
    livemode: false,
    product: productIdForTier(tier),
    ...o,
  });
  const [CHEAPER, DEARER] = TIER_ORDER;

  it('an empty account: one product and one price per tier, at the display price', () => {
    const plan = planSetup(TIER_ORDER.map((t) => state(t)));
    expect(plan.stops).toEqual([]);
    expect(plan.steps).toEqual([
      { kind: 'create_product', tier: CHEAPER, productId: `bos_plan_${CHEAPER}`, name: 'Essentials' },
      { kind: 'create_price', tier: CHEAPER, productId: `bos_plan_${CHEAPER}`, lookupKey: 'bos_plan_basic_monthly_usd', unitAmount: 7900 },
      { kind: 'create_product', tier: DEARER, productId: `bos_plan_${DEARER}`, name: 'Autopilot' },
      { kind: 'create_price', tier: DEARER, productId: `bos_plan_${DEARER}`, lookupKey: 'bos_plan_pro_monthly_usd', unitAmount: 12900 },
    ]);
  });

  it('a second run on a matching account changes nothing (idempotent)', () => {
    const plan = planSetup(TIER_ORDER.map((t) => state(t, { product: product(t), prices: [price(t)] })));
    expect(plan.stops).toEqual([]);
    expect(plan.steps.map((s) => s.kind)).toEqual(['product_ok', 'price_unchanged', 'product_ok', 'price_unchanged']);
  });

  it.each<[string, Partial<TierState>, RegExp]>([
    ['a price that differs', { prices: [price(TIER_ORDER[0], { unit_amount: 6900 })] }, /differs: unit_amount 6900/],
    ['two prices under the key', { prices: [price(TIER_ORDER[0]), price(TIER_ORDER[0], { id: 'p2' })] }, /2 prices hold/],
    ['a price on another product', { prices: [price(TIER_ORDER[0], { product: 'prod_other' })] }, /on product prod_other/],
    ['an archived product', { product: product(TIER_ORDER[0], { active: false }) }, /archived/],
    ['a live-mode product', { product: product(TIER_ORDER[0], { livemode: true }) }, /not a test-mode object/],
    ['a sub-cent display price', { displayPriceUsd: 79.005 }, /sub-cent/],
  ])('STOPS (changes nothing) on %s', (_label, overrides, reason) => {
    const plan = planSetup([state(CHEAPER, { product: product(CHEAPER), ...overrides }), state(DEARER)]);
    expect(plan.stops.join(' | ')).toMatch(reason);
  });

  it('a renamed product is left alone and reported', () => {
    const plan = planSetup([state(CHEAPER, { product: product(CHEAPER, { name: 'Old name' }), prices: [price(CHEAPER)] })]);
    expect(plan.stops).toEqual([]);
    expect(plan.steps[0]).toMatchObject({ kind: 'product_ok', note: expect.stringMatching(/Old name/) });
  });
});

describe('script sources (C-3, CF-4, P1-C7)', () => {
  const read = (f: string) => fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8');
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it.each(['setup-bos-plan-prices.ts', 'capture-stripe-billing-fixtures.ts'])(
    '%s writes no forbidden metadata key and never sets transfer_lookup_key',
    (file) => {
      const src = code(file);
      expect(src).not.toMatch(/transfer_lookup_key/);
      expect(src).not.toMatch(/metadata:\s*\{[^}]*\b(user_id|credits|pilot_credits|bos_user_id)\b/);
    }
  );

  it.each(['setup-bos-plan-prices.ts', 'check-bos-plan-prices.ts', 'capture-stripe-billing-fixtures.ts'])(
    '%s goes through the guards: --env outside the repo, an allowed key kind, the expected account',
    (file) => {
      const src = code(file);
      for (const guard of ['resolveEnvFile(', 'assertKeyKind(', 'requireExpectedAccount(', 'verifyAccount(']) {
        expect(src).toContain(guard);
      }
      expect(src).not.toMatch(/console\.|loadEnv|dotenv/);
    }
  );

  it('setup and capture accept only sk_test keys', () => {
    expect(code('setup-bos-plan-prices.ts')).toMatch(/assertKeyKind\(key, \['sk_test'\]\)/);
    expect(code('capture-stripe-billing-fixtures.ts')).toMatch(/assertKeyKind\(key, \['sk_test'\]\)/);
  });

  it('setup creates nothing unless --apply is given', () => {
    expect(code('setup-bos-plan-prices.ts')).toMatch(/if \(doApply\) await apply\(stripe, plan\)/);
  });
});

describe('formatFindings', () => {
  it('prints a VERDICT row and never a key', () => {
    const lines = formatFindings([
      { tier: TIER_ORDER[0], lookupKey: 'bos_plan_basic_monthly_usd', kind: 'current', status: 'pass', problems: [], priceId: 'price_1', expectedUnitAmount: 7900 },
    ]);
    expect(lines[lines.length - 1]).toBe('VERDICT PASS');
    expect(lines[0]).toContain('$79.00');
  });
});

describe('the scripts as run (refusal before any network call)', () => {
  const run = (script: string, args: string[]) =>
    spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join('scripts', script), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
    });

  it('setup refuses a live key with exit 2 and does not print it', () => {
    const file = keyFile('live.env', `STRIPE_SECRET_KEY=${FAKE_LIVE}\n`);
    const result = run('setup-bos-plan-prices.ts', ['--env', file, '--expect-account', 'acct_1ABC', '--apply']);
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/accepts only sk_test/);
    expect(`${result.stdout}${result.stderr}`).not.toContain('FAKE');
  });

  it('check refuses an --env inside the repo with exit 2', () => {
    const result = run('check-bos-plan-prices.ts', ['--env', '.env.local', '--expect-account', 'acct_1ABC']);
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/inside the current directory/);
  });
});

describe('capture: webhook delivery guard (SA P-2b review F-2)', () => {
  const endpoint = (status: string, url = 'https://neuronforge-kohl.vercel.app/api/stripe/webhook') => ({
    id: `we_${status}`,
    url,
    status,
    api_version: '2025-09-30.clover',
  });

  it('refuses while any endpoint is ENABLED, naming its url', () => {
    const reason = webhookDeliveryRefusal([endpoint('enabled'), endpoint('disabled', 'https://x.example/hook')], false);
    expect(reason).toMatch(/1 enabled webhook endpoint\(s\) would receive every capture event/);
    expect(reason).toContain('https://neuronforge-kohl.vercel.app/api/stripe/webhook');
    expect(reason).not.toContain('x.example');
  });

  it('runs with no endpoint, only disabled ones, or --allow-webhook-delivery', () => {
    expect(webhookDeliveryRefusal([], false)).toBeNull();
    expect(webhookDeliveryRefusal([endpoint('disabled')], false)).toBeNull();
    expect(webhookDeliveryRefusal([endpoint('enabled')], true)).toBeNull();
  });

  it('lists each endpoint with id, status, api_version and url, and nothing else', () => {
    const withSecret = { ...endpoint('enabled'), secret: 'whsec_SHOULD_NOT_PRINT' };
    const lines = describeEndpoints([withSecret]);
    expect(lines).toEqual([
      '  endpoint we_enabled  enabled  2025-09-30.clover  https://neuronforge-kohl.vercel.app/api/stripe/webhook',
    ]);
    expect(lines.join('')).not.toContain('whsec_');
  });

  it('the refusal comes BEFORE anything is created, and is a ScriptRefusal (exit 2)', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'capture-stripe-billing-fixtures.ts'), 'utf8');
    const main = src.slice(src.indexOf('async function main('));
    const guard = main.indexOf('if (refusal) throw new ScriptRefusal(refusal)');
    expect(guard).toBeGreaterThan(0);
    expect(main.indexOf('webhookEndpoints.list(')).toBeLessThan(guard);
    for (const effect of ['readPlanPrices(', 'findOrCreateNoKeyPrice(', 'newClockCustomer(', '.create(']) {
      const at = main.indexOf(effect);
      expect(at).toBeGreaterThan(guard);
    }
    expect(main).toMatch(/hasFlag\(argv, '--allow-webhook-delivery'\)/);
  });
});

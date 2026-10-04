/**
 * capture-stripe-billing-fixtures — records real TEST-MODE Stripe invoice events
 * as fixtures for the Business OS billing router (plan payments P-1, C-8).
 *
 * WHY: the Basil invoice shapes the router reads (`line.pricing.price_details`,
 * `parent.subscription_details`) are easy to get subtly wrong by hand, and a
 * wrong fixture would make a broken reader pass. Until this has been run, the
 * fixtures in `lib/business-os/billing/__tests__/fixtures/stripe/` are
 * HAND-BUILT and say so in `_fixture_source`.
 *
 * SAFETY (workplan §7, SA P1-C7)
 *   - Refuses any key that does not start `sk_test_`, and refuses any created
 *     object that comes back `livemode: true`. Nothing touches live mode.
 *   - Production receives test-mode events, so every object created here carries
 *     NO `user_id`, `credits`, `pilot_credits` or `bos_user_id` metadata, and uses
 *     fresh customers on test clocks with no other subscription. Before the
 *     capture is written, every subscription of those customers is checked for
 *     those keys and the run aborts if any carries one.
 *   - The probe lookup keys are NOT the keys P-2 will create, so production can
 *     never recognise them as Business OS plan prices.
 *   - Test clocks are deleted at the end (which deletes their customers and
 *     subscriptions), also when the run fails.
 *
 * AFTER RUNNING: SA P1-C7 asks for one read-only check that the production
 * webhook processed the capture events without writing `user_subscriptions`.
 * The script prints the event ids to check.
 *
 * USAGE
 *   npx tsx scripts/capture-stripe-billing-fixtures.ts [--env .env.local] [--keep-clocks]
 *
 * Reads STRIPE_SECRET_KEY from the env file. Never prints the key.
 */

import * as fs from 'fs';
import * as path from 'path';
import { config as loadEnv } from 'dotenv';
import Stripe from 'stripe';

const API_VERSION = '2025-10-29.clover';
const PRODUCT_NAME = 'BOS router fixture probe';
const LOOKUP_A = 'bos_router_fixture_probe_a';
const LOOKUP_B = 'bos_router_fixture_probe_b';
const FORBIDDEN_METADATA = ['user_id', 'credits', 'pilot_credits', 'bos_user_id'];
const OUT_DIR = path.join(process.cwd(), 'lib/business-os/billing/__tests__/fixtures/stripe');
const DAY = 24 * 60 * 60;

const out = (line: string) => process.stdout.write(`${line}\n`);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function assertTestMode(label: string, obj: { livemode?: boolean }): void {
  if (obj.livemode !== false) throw new Error(`${label} is not a test-mode object; aborting`);
}

async function waitForClock(stripe: Stripe, clockId: string): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const clock = await stripe.testHelpers.testClocks.retrieve(clockId);
    if (clock.status === 'ready') return;
    if (clock.status === 'internal_failure') throw new Error(`test clock ${clockId} failed`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`test clock ${clockId} did not become ready`);
}

async function advance(stripe: Stripe, clockId: string, to: number): Promise<void> {
  await stripe.testHelpers.testClocks.advance(clockId, { frozen_time: to });
  await waitForClock(stripe, clockId);
}

async function findOrCreatePrices(stripe: Stripe): Promise<{ a: string; b: string; noKey: string }> {
  const existing = await stripe.prices.list({ lookup_keys: [LOOKUP_A, LOOKUP_B], limit: 10 });
  let a = existing.data.find((p) => p.lookup_key === LOOKUP_A);
  let b = existing.data.find((p) => p.lookup_key === LOOKUP_B);
  let productId = (a?.product ?? b?.product) as string | undefined;

  if (!productId) {
    const product = await stripe.products.create({ name: PRODUCT_NAME });
    assertTestMode('product', product);
    productId = product.id;
  }
  const monthly = (amount: number, lookup_key?: string) =>
    stripe.prices.create({ product: productId!, currency: 'usd', unit_amount: amount, recurring: { interval: 'month' }, lookup_key });

  a ??= await monthly(2000, LOOKUP_A);
  b ??= await monthly(5000, LOOKUP_B);

  const all = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  const noKey = all.data.find((p) => !p.lookup_key) ?? (await monthly(1500));
  for (const [label, p] of [['price A', a], ['price B', b], ['no-key price', noKey]] as const) assertTestMode(label, p);
  return { a: a.id, b: b.id, noKey: noKey.id };
}

async function newClockCustomer(stripe: Stripe, start: number, name: string) {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: start, name });
  assertTestMode('test clock', clock);
  // No metadata at all (P1-C7).
  const customer = await stripe.customers.create({
    test_clock: clock.id,
    email: 'fixture@example.invalid',
    payment_method: 'pm_card_visa',
    invoice_settings: { default_payment_method: 'pm_card_visa' },
  });
  assertTestMode('customer', customer);
  return { clock, customer };
}

async function assertNoForbiddenMetadata(stripe: Stripe, customerIds: string[]): Promise<void> {
  for (const customer of customerIds) {
    const subs = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 });
    for (const sub of subs.data) {
      const bad = Object.keys(sub.metadata ?? {}).filter((k) => FORBIDDEN_METADATA.includes(k));
      if (bad.length > 0) throw new Error(`subscription ${sub.id} carries forbidden metadata keys ${bad.join(', ')}; aborting`);
    }
  }
}

function sanitise(event: Stripe.Event): Stripe.Event {
  const copy = JSON.parse(JSON.stringify(event)) as Stripe.Event & { data: { object: Record<string, unknown> } };
  const obj = copy.data.object;
  if ('customer_email' in obj) obj.customer_email = 'fixture@example.invalid';
  for (const k of ['customer_name', 'customer_address', 'customer_phone', 'customer_shipping']) {
    if (k in obj) obj[k] = null;
  }
  return copy;
}

async function main(): Promise<void> {
  loadEnv({ path: arg('--env') ?? '.env.local' });
  const key = process.env.STRIPE_SECRET_KEY ?? '';
  if (!key.startsWith('sk_test_')) {
    out('Refusing to run: STRIPE_SECRET_KEY is missing or is not a test-mode key (must start sk_test_).');
    process.exit(2);
  }

  const stripe = new Stripe(key, { apiVersion: API_VERSION });
  const start = Math.floor(Date.now() / 1000);
  const clocks: string[] = [];
  const keepClocks = process.argv.includes('--keep-clocks');

  try {
    const prices = await findOrCreatePrices(stripe);
    out(`prices: A=${prices.a} B=${prices.b} no-key=${prices.noKey}`);

    // Customer 1: create on A, swap to B with an immediate proration invoice,
    // then fail a renewal.
    const one = await newClockCustomer(stripe, start, 'bos-fixture-1');
    clocks.push(one.clock.id);
    const sub = await stripe.subscriptions.create({ customer: one.customer.id, items: [{ price: prices.a }] });
    assertTestMode('subscription', sub);

    await advance(stripe, one.clock.id, start + 10 * DAY);
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0].id, price: prices.b }],
      proration_behavior: 'always_invoice',
    });

    // Customer 2: subscribe to the price with no lookup key (unknown to the router).
    const two = await newClockCustomer(stripe, start, 'bos-fixture-2');
    clocks.push(two.clock.id);
    await stripe.subscriptions.create({ customer: two.customer.id, items: [{ price: prices.noKey }] });

    // Customer 1's renewal fails.
    const failing = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: one.customer.id });
    await stripe.customers.update(one.customer.id, { invoice_settings: { default_payment_method: failing.id } });
    await stripe.subscriptions.update(sub.id, { default_payment_method: failing.id });
    await advance(stripe, one.clock.id, start + 40 * DAY);

    await assertNoForbiddenMetadata(stripe, [one.customer.id, two.customer.id]);

    // Events can take a moment to appear after the clock settles.
    await new Promise((r) => setTimeout(r, 5000));
    const events = await stripe.events.list({
      types: ['invoice.paid', 'invoice.payment_failed'],
      created: { gte: start - 60 },
      limit: 100,
    });
    const forCustomer = (id: string) =>
      events.data.filter((e) => (e.data.object as Stripe.Invoice).customer === id).reverse(); // oldest first

    const paidOne = forCustomer(one.customer.id).filter((e) => e.type === 'invoice.paid');
    const pick: Record<string, Stripe.Event | undefined> = {
      'invoice-paid-subscription-create.json': paidOne.find((e) => (e.data.object as Stripe.Invoice).billing_reason === 'subscription_create'),
      'invoice-paid-proration.json': paidOne.find((e) => (e.data.object as Stripe.Invoice).billing_reason === 'subscription_update'),
      'invoice-paid-unknown-price.json': forCustomer(two.customer.id).find((e) => e.type === 'invoice.paid'),
      'invoice-payment-failed.json': forCustomer(one.customer.id).find((e) => e.type === 'invoice.payment_failed'),
    };

    const missing = Object.entries(pick).filter(([, e]) => !e).map(([n]) => n);
    if (missing.length > 0) throw new Error(`events not found for ${missing.join(', ')}; nothing written`);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    out('\nWritten (check each in production for no user_subscriptions write, P1-C7):');
    for (const [name, event] of Object.entries(pick)) {
      assertTestMode(name, event!);
      const fixture = {
        _fixture_source: `CAPTURED ${new Date().toISOString()} from ${event!.id} (test mode) by scripts/capture-stripe-billing-fixtures.ts`,
        ...sanitise(event!),
      };
      fs.writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(fixture, null, 2)}\n`);
      out(`  ${name}  event=${event!.id}  api_version=${event!.api_version}`);
    }
  } finally {
    if (!keepClocks) {
      for (const id of clocks) {
        try {
          await stripe.testHelpers.testClocks.del(id);
        } catch (err) {
          out(`could not delete test clock ${id}: ${(err as Error).message}`);
        }
      }
    }
  }
}

main().catch((err: unknown) => {
  out(`capture failed: ${(err as Error).message}`);
  process.exit(1);
});

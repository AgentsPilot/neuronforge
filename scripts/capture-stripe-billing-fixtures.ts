/**
 * capture-stripe-billing-fixtures: records real TEST-MODE Stripe invoice events
 * on the REAL Business OS plan prices, as fixtures for the billing router
 * (plan payments P-1 C-8, P-2b workplan §3.5).
 *
 * WHY: the clover invoice shapes the router reads (`line.pricing.price_details`,
 * `parent.subscription_details`) are easy to get subtly wrong by hand, and a
 * wrong fixture would make a broken reader pass. The fixtures in
 * `lib/business-os/billing/__tests__/fixtures/stripe/` are written by this
 * script and say `CAPTURED` in `_fixture_source`.
 *
 * WHAT IT CAPTURES (customer 1 on a test clock, customer 2 on another)
 *   - invoice-paid-subscription-create.json  customer 1 subscribes on the basic plan price
 *   - invoice-paid-proration.json            day 10: upgrade to the pro plan price, invoiced at once
 *   - invoice-paid-renewal.json              day 35: the monthly renewal on pro (subscription_cycle)
 *   - invoice-payment-failed.json            day 66: the next renewal, on a card that fails
 *   - invoice-paid-unknown-price.json        customer 2 on a probe price with NO lookup key
 *
 * The plan prices must already exist and pass the plan price check
 * (`scripts/setup-bos-plan-prices.ts`); this script never creates or changes
 * them. The only thing it creates besides clocks, customers and subscriptions
 * is the probe product `bos_router_fixture_probe` and its no-key price.
 *
 * SAFETY (SA P1-C7, P2-C9)
 *   - Only an `sk_test_` key; every created object must come back
 *     `livemode: false`. `--expect-account acct_...` is required and checked.
 *   - `--env <file>` is required and must lie outside every git checkout. The
 *     key is never printed.
 *   - No object carries `user_id`, `credits`, `pilot_credits` or `bos_user_id`
 *     metadata. Before anything is written, every subscription of the capture
 *     customers is checked for those keys and the run aborts if one has any.
 *   - Every captured event must be on API version 2025-10-29.clover (the SDK
 *     pin). On any other version NOTHING is written: adapt nothing, report it.
 *   - The account's webhook endpoints are listed FIRST (url, status and
 *     api_version; never a secret). While any endpoint is ENABLED the run
 *     REFUSES (exit 2) before creating anything, because every capture event
 *     would be delivered there (SA P-2b review F-2: on 2026-10-06 the sandbox
 *     turned out to deliver to production). `--allow-webhook-delivery`
 *     overrides it; then, for production, check afterwards that no
 *     `user_subscriptions` row was written for the printed event ids (P1-C7).
 *   - Test clocks are deleted at the end (deleting their customers and
 *     subscriptions), also when the run fails, unless `--keep-clocks`.
 *
 * USAGE
 *   npx tsx scripts/capture-stripe-billing-fixtures.ts --env <file outside the repo> --expect-account acct_... [--keep-clocks] [--allow-webhook-delivery]
 */

import * as fs from 'fs';
import * as path from 'path';
import Stripe from 'stripe';

import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { checkPlanPrices, groupPricesByLookupKey, planPricesPass } from '@/lib/business-os/billing/planPriceCheck';
import { API_VERSION } from './check-bos-plan-prices';
import {
  ScriptRefusal,
  assertKeyKind,
  hasFlag,
  readStripeKey,
  requireExpectedAccount,
  resolveEnvFile,
  runScript,
  verifyAccount,
} from './lib/stripe-script-guards';

const PROBE_PRODUCT_ID = 'bos_router_fixture_probe';
const PROBE_PRODUCT_NAME = 'BOS router fixture probe';
const FORBIDDEN_METADATA = ['user_id', 'credits', 'pilot_credits', 'bos_user_id'];
const OUT_DIR = path.join(process.cwd(), 'lib/business-os/billing/__tests__/fixtures/stripe');
const DAY = 24 * 60 * 60;
const FIXTURE_EMAIL = 'fixture@example.invalid';

const out = (line: string) => process.stdout.write(`${line}\n`);

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

/** The cheaper and dearer plan price ids. They must exist and pass the plan price check. */
async function readPlanPrices(stripe: Stripe): Promise<{ cheaper: string; dearer: string }> {
  const keys = TIER_ORDER.map((tier) => PLAN_STRIPE_PRICES[tier].lookupKey);
  const listed = await stripe.prices.list({ lookup_keys: keys, limit: 10 });
  const findings = checkPlanPrices({ pricesByLookupKey: groupPricesByLookupKey(listed.data), expectedLivemode: false });
  if (!planPricesPass(findings)) {
    throw new ScriptRefusal('the plan prices are missing or differ from the display prices; run setup-bos-plan-prices first');
  }
  const idFor = (tier: (typeof TIER_ORDER)[number]) =>
    findings.find((f) => f.kind === 'current' && f.tier === tier)?.priceId as string;
  return { cheaper: idFor(TIER_ORDER[0]), dearer: idFor(TIER_ORDER[TIER_ORDER.length - 1]) };
}

/** A monthly price on the probe product with no lookup key: unknown to the router by construction. */
async function findOrCreateNoKeyPrice(stripe: Stripe): Promise<string> {
  try {
    await stripe.products.retrieve(PROBE_PRODUCT_ID);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    const product = await stripe.products.create({ id: PROBE_PRODUCT_ID, name: PROBE_PRODUCT_NAME });
    assertTestMode('probe product', product);
  }
  const all = await stripe.prices.list({ product: PROBE_PRODUCT_ID, active: true, limit: 100 });
  const price =
    all.data.find((p) => !p.lookup_key) ??
    (await stripe.prices.create({
      product: PROBE_PRODUCT_ID,
      currency: 'usd',
      unit_amount: 1500,
      recurring: { interval: 'month' },
    }));
  assertTestMode('no-key price', price);
  return price.id;
}

async function newClockCustomer(stripe: Stripe, start: number, name: string) {
  const clock = await stripe.testHelpers.testClocks.create({ frozen_time: start, name });
  assertTestMode('test clock', clock);
  // No metadata at all (P1-C7).
  const customer = await stripe.customers.create({
    test_clock: clock.id,
    email: FIXTURE_EMAIL,
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

export interface WebhookEndpointLike {
  readonly id: string;
  readonly url: string;
  readonly status: string;
  readonly api_version: string | null;
}

/** One line per endpoint: id, url, status, api_version. Never a secret. */
export function describeEndpoints(endpoints: readonly WebhookEndpointLike[]): string[] {
  return endpoints.map((e) => `  endpoint ${e.id}  ${e.status}  ${e.api_version ?? 'account default'}  ${e.url}`);
}

/**
 * Why the capture must not run, or `null`. Any ENABLED endpoint receives every
 * capture event, so the run refuses unless the operator says delivery is intended.
 */
export function webhookDeliveryRefusal(
  endpoints: readonly WebhookEndpointLike[],
  allowDelivery: boolean
): string | null {
  const enabled = endpoints.filter((e) => e.status === 'enabled');
  if (enabled.length === 0 || allowDelivery) return null;
  return (
    `${enabled.length} enabled webhook endpoint(s) would receive every capture event (${enabled.map((e) => e.url).join(', ')}); ` +
    'disable them, or pass --allow-webhook-delivery if that delivery is intended. Nothing was created'
  );
}

/** Removes personal data and the invoice's access links (a hosted invoice URL is a bearer link). */
export function sanitise(event: Stripe.Event): Stripe.Event {
  const copy = JSON.parse(JSON.stringify(event)) as Stripe.Event & { data: { object: Record<string, unknown> } };
  const obj = copy.data.object;
  if ('customer_email' in obj) obj.customer_email = FIXTURE_EMAIL;
  for (const k of [
    'customer_name',
    'customer_address',
    'customer_phone',
    'customer_shipping',
    'hosted_invoice_url',
    'invoice_pdf',
  ]) {
    if (k in obj) obj[k] = null;
  }
  if ('customer_tax_ids' in obj) obj.customer_tax_ids = [];
  return copy;
}

async function main(argv: readonly string[]): Promise<number> {
  const envFile = resolveEnvFile(argv);
  const expectedAccount = requireExpectedAccount(argv);
  const key = readStripeKey(envFile);
  assertKeyKind(key, ['sk_test']);

  const stripe = new Stripe(key, { apiVersion: API_VERSION });
  const account = await verifyAccount(stripe, expectedAccount);
  // Before anything is created (SA F-2): who would receive the capture events?
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  out(`mode test  account ${account.id} (${account.displayName})  webhook endpoints: ${endpoints.data.length}`);
  for (const line of describeEndpoints(endpoints.data)) out(line);
  const refusal = webhookDeliveryRefusal(endpoints.data, hasFlag(argv, '--allow-webhook-delivery'));
  if (refusal) throw new ScriptRefusal(refusal);

  const start = Math.floor(Date.now() / 1000);
  const clocks: string[] = [];
  const keepClocks = hasFlag(argv, '--keep-clocks');

  try {
    const plan = await readPlanPrices(stripe);
    const noKey = await findOrCreateNoKeyPrice(stripe);
    out(`prices: cheaper plan=${plan.cheaper} dearer plan=${plan.dearer} no-key=${noKey}`);

    // Customer 1: cheaper plan, upgrade with an immediate proration invoice,
    // one paid renewal, then a failed renewal.
    const one = await newClockCustomer(stripe, start, 'bos-fixture-1');
    clocks.push(one.clock.id);
    const sub = await stripe.subscriptions.create({ customer: one.customer.id, items: [{ price: plan.cheaper }] });
    assertTestMode('subscription', sub);

    await advance(stripe, one.clock.id, start + 10 * DAY);
    await stripe.subscriptions.update(sub.id, {
      items: [{ id: sub.items.data[0].id, price: plan.dearer }],
      proration_behavior: 'always_invoice',
    });

    await advance(stripe, one.clock.id, start + 35 * DAY);

    const failing = await stripe.paymentMethods.attach('pm_card_chargeCustomerFail', { customer: one.customer.id });
    await stripe.customers.update(one.customer.id, { invoice_settings: { default_payment_method: failing.id } });
    await stripe.subscriptions.update(sub.id, { default_payment_method: failing.id });
    await advance(stripe, one.clock.id, start + 66 * DAY);

    // Customer 2: the price with no lookup key (unknown to the router).
    const two = await newClockCustomer(stripe, start, 'bos-fixture-2');
    clocks.push(two.clock.id);
    await stripe.subscriptions.create({ customer: two.customer.id, items: [{ price: noKey }] });

    await assertNoForbiddenMetadata(stripe, [one.customer.id, two.customer.id]);

    // Events can take a moment to appear after a clock settles.
    await new Promise((r) => setTimeout(r, 8000));
    const events = await stripe.events
      .list({ types: ['invoice.paid', 'invoice.payment_failed'], limit: 100 })
      .autoPagingToArray({ limit: 1000 });
    const forCustomer = (id: string) =>
      events.filter((e) => (e.data.object as Stripe.Invoice).customer === id).reverse(); // oldest first
    const paidOne = forCustomer(one.customer.id).filter((e) => e.type === 'invoice.paid');
    const reason = (e: Stripe.Event) => (e.data.object as Stripe.Invoice).billing_reason;

    const pick: Record<string, Stripe.Event | undefined> = {
      'invoice-paid-subscription-create.json': paidOne.find((e) => reason(e) === 'subscription_create'),
      'invoice-paid-proration.json': paidOne.find((e) => reason(e) === 'subscription_update'),
      'invoice-paid-renewal.json': paidOne.find((e) => reason(e) === 'subscription_cycle'),
      'invoice-payment-failed.json': forCustomer(one.customer.id).find((e) => e.type === 'invoice.payment_failed'),
      'invoice-paid-unknown-price.json': forCustomer(two.customer.id).find((e) => e.type === 'invoice.paid'),
    };

    const missing = Object.entries(pick).filter(([, e]) => !e).map(([n]) => n);
    if (missing.length > 0) throw new Error(`events not found for ${missing.join(', ')}; nothing written`);

    // STOP rather than adapt: fixtures on another API version would test a shape the SDK pin does not read.
    const offVersion = Object.entries(pick).filter(([, e]) => e!.api_version !== API_VERSION);
    if (offVersion.length > 0) {
      for (const [name, e] of offVersion) out(`  ${name}  event=${e!.id}  api_version=${e!.api_version}`);
      throw new Error(`captured events are not on ${API_VERSION}; nothing written`);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const capturedOn = new Date().toISOString().slice(0, 10);
    out('\nWritten:');
    for (const [name, event] of Object.entries(pick)) {
      assertTestMode(name, event!);
      const fixture = {
        _fixture_source: `CAPTURED ${event!.id} ${event!.api_version} ${capturedOn} (test mode, ${account.id}) by scripts/capture-stripe-billing-fixtures.ts`,
        ...sanitise(event!),
      };
      fs.writeFileSync(path.join(OUT_DIR, name), `${JSON.stringify(fixture, null, 2)}\n`);
      out(`  ${name}  event=${event!.id}  api_version=${event!.api_version}`);
    }
    if (endpoints.data.some((e) => e.status === 'enabled')) {
      out('\nDelivered to the enabled endpoints above: check each event id for no user_subscriptions write (P1-C7).');
    }
  } finally {
    if (!keepClocks) {
      for (const id of clocks) {
        try {
          await stripe.testHelpers.testClocks.del(id);
          out(`deleted test clock ${id}`);
        } catch (err) {
          out(`could not delete test clock ${id}: ${(err as Error).message}`);
        }
      }
    }
  }
  return 0;
}

if (require.main === module) runScript(() => main(process.argv.slice(2)), out);

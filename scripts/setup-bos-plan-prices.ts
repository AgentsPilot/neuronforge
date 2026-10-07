/**
 * setup-bos-plan-prices: creates the Business OS plan products and prices in a
 * Stripe TEST-MODE account or sandbox, idempotently by lookup key (plan
 * payments P-2b, workplan §3.5).
 *
 * SAFETY
 *   - Accepts only an `sk_test_` key, checked before any network call. A live
 *     key, a restricted key or a missing key exits 2. Every object Stripe
 *     returns must say `livemode: false`, or the run stops.
 *   - `--expect-account acct_...` is REQUIRED; the run stops if the key belongs
 *     to another account. The account id and its display name are printed.
 *   - `--env <file>` is REQUIRED and must lie outside every git checkout
 *     (P2-C9). The key is never printed.
 *   - DRY RUN BY DEFAULT: it prints what it would create. `--apply` creates.
 *   - Writes no `user_id`, `credits`, `pilot_credits` or `bos_user_id`
 *     metadata (C-3, CF-4), never sets `transfer_lookup_key`, and creates no
 *     customer or subscription.
 *
 * WHAT IT DOES, per tier in the tier matrix
 *   - Product, id `bos_plan_<tier>` (a caller-chosen id, so the step is
 *     idempotent by id), named after `presentation.labels.en`, metadata
 *     `product: business_os_plan`. An archived product stops the run.
 *   - Price, found by its lookup key (archived prices included). One price that
 *     matches the display price: "unchanged". One that differs, more than one,
 *     or one on another product: the run STOPS and changes nothing. Missing:
 *     created as usd, monthly, tax exclusive, `unit_amount` = display price in
 *     cents, with the lookup key and a Stripe idempotency key.
 *   - At the end it prints the same table as `check-bos-plan-prices`.
 *
 * CHANGING A PRICE is not done here. The procedure (retire the old key first)
 * is in `lib/business-os/entitlements/config/planPrices.ts` and is printed
 * when a price differs.
 *
 * USAGE
 *   npx tsx scripts/setup-bos-plan-prices.ts --env <file outside the repo> --expect-account acct_... [--apply]
 */

import Stripe from 'stripe';

import { PLAN_STRIPE_PRICES } from '@/lib/business-os/entitlements/config/planPrices';
import { TIER_MATRIX, TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  displayPriceInCents,
  planPricesPass,
  priceProblems,
  type StripePriceLike,
} from '@/lib/business-os/billing/planPriceCheck';
import { BOS_PLAN_PRODUCT_MARKER, BOS_PRODUCT_METADATA_KEY } from '@/lib/business-os/billing/stripeMetadataKeys';
import { API_VERSION, formatFindings, runPlanPriceCheck } from './check-bos-plan-prices';
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

const out = (line: string) => process.stdout.write(`${line}\n`);

export const PRICE_CHANGE_PROCEDURE = [
  'To change a plan price, do not edit it here. Follow lib/business-os/entitlements/config/planPrices.ts:',
  '  1. In a PR that also changes the display price, add <lookupKey>_retired_<yyyymmdd> to retiredLookupKeys; deploy it.',
  '  2. In Stripe, move the current price to that retired lookup key (prices.update lookup_key).',
  '  3. Run this script again: it creates the new price under the main key.',
  '  4. npm run check-bos-plan-prices must PASS.',
];

export interface ExistingProduct {
  readonly id: string;
  readonly active: boolean;
  readonly livemode: boolean;
  readonly name: string;
}

export interface ExistingPrice extends StripePriceLike {
  /** The product id. */
  readonly product: string;
}

export interface TierState {
  readonly tier: TierId;
  readonly productId: string;
  readonly productName: string;
  readonly lookupKey: string;
  readonly displayPriceUsd: number;
  readonly product: ExistingProduct | null;
  readonly prices: readonly ExistingPrice[];
}

export type SetupStep =
  | { readonly kind: 'create_product'; readonly tier: TierId; readonly productId: string; readonly name: string }
  | { readonly kind: 'product_ok'; readonly tier: TierId; readonly productId: string; readonly note?: string }
  | {
      readonly kind: 'create_price';
      readonly tier: TierId;
      readonly productId: string;
      readonly lookupKey: string;
      readonly unitAmount: number;
    }
  | { readonly kind: 'price_unchanged'; readonly tier: TierId; readonly lookupKey: string; readonly priceId: string };

export interface SetupPlan {
  readonly steps: readonly SetupStep[];
  /** Any entry here means nothing is created. */
  readonly stops: readonly string[];
}

export const productIdForTier = (tier: TierId): string => `bos_plan_${tier}`;

/** Pure: what the script would do, given what Stripe holds. */
export function planSetup(states: readonly TierState[]): SetupPlan {
  const steps: SetupStep[] = [];
  const stops: string[] = [];

  for (const s of states) {
    const unitAmount = displayPriceInCents(s.displayPriceUsd);
    if (unitAmount === null) {
      stops.push(`${s.tier}: display price ${s.displayPriceUsd} has sub-cent precision`);
      continue;
    }

    if (!s.product) {
      steps.push({ kind: 'create_product', tier: s.tier, productId: s.productId, name: s.productName });
    } else if (s.product.livemode !== false) {
      stops.push(`${s.tier}: product ${s.product.id} is not a test-mode object`);
      continue;
    } else if (!s.product.active) {
      stops.push(`${s.tier}: product ${s.product.id} exists but is archived; unarchive it or decide by hand`);
      continue;
    } else {
      const note = s.product.name !== s.productName ? `name in Stripe is "${s.product.name}" (left as is)` : undefined;
      steps.push({ kind: 'product_ok', tier: s.tier, productId: s.productId, note });
    }

    if (s.prices.length > 1) {
      stops.push(`${s.tier}: ${s.prices.length} prices hold lookup key ${s.lookupKey}`);
      continue;
    }
    if (s.prices.length === 0) {
      steps.push({ kind: 'create_price', tier: s.tier, productId: s.productId, lookupKey: s.lookupKey, unitAmount });
      continue;
    }

    const price = s.prices[0];
    const problems = priceProblems(price, unitAmount, false);
    if (price.product !== s.productId) problems.push(`price is on product ${price.product}, not ${s.productId}`);
    if (problems.length > 0) {
      stops.push(`${s.tier}: price ${price.id} under ${s.lookupKey} differs: ${problems.join('; ')}`);
      continue;
    }
    steps.push({ kind: 'price_unchanged', tier: s.tier, lookupKey: s.lookupKey, priceId: price.id });
  }

  return { steps, stops };
}

export function describeStep(step: SetupStep): string {
  switch (step.kind) {
    case 'create_product':
      return `CREATE product ${step.productId} "${step.name}"`;
    case 'product_ok':
      return `OK     product ${step.productId}${step.note ? `  ${step.note}` : ''}`;
    case 'create_price':
      return `CREATE price ${step.lookupKey} on ${step.productId}: ${step.unitAmount} usd per month, tax exclusive`;
    case 'price_unchanged':
      return `OK     price ${step.lookupKey} = ${step.priceId} (unchanged)`;
  }
}

function assertTestObject(label: string, obj: { livemode?: boolean }): void {
  if (obj.livemode !== false) throw new Error(`${label} is not a test-mode object; stopping`);
}

async function readTierStates(stripe: Stripe): Promise<TierState[]> {
  const states: TierState[] = [];
  for (const tier of TIER_ORDER) {
    const productId = productIdForTier(tier);
    let product: ExistingProduct | null = null;
    try {
      const p = await stripe.products.retrieve(productId);
      product = { id: p.id, active: p.active, livemode: p.livemode, name: p.name };
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }

    const lookupKey = PLAN_STRIPE_PRICES[tier].lookupKey;
    const listed = await stripe.prices.list({ lookup_keys: [lookupKey], limit: 10 });
    const prices: ExistingPrice[] = listed.data.map((p) => ({
      ...p,
      product: typeof p.product === 'string' ? p.product : p.product.id,
    }));

    states.push({
      tier,
      productId,
      productName: TIER_MATRIX.presentation[tier].labels.en,
      lookupKey,
      displayPriceUsd: TIER_MATRIX.presentation[tier].monthlyPriceUsd,
      product,
      prices,
    });
  }
  return states;
}

async function apply(stripe: Stripe, plan: SetupPlan): Promise<void> {
  for (const step of plan.steps) {
    if (step.kind === 'create_product') {
      const product = await stripe.products.create(
        { id: step.productId, name: step.name, metadata: { [BOS_PRODUCT_METADATA_KEY]: BOS_PLAN_PRODUCT_MARKER } },
        { idempotencyKey: `bos-plan-product:${step.productId}` }
      );
      assertTestObject(`product ${product.id}`, product);
      out(`created product ${product.id}`);
    } else if (step.kind === 'create_price') {
      const price = await stripe.prices.create(
        {
          product: step.productId,
          currency: 'usd',
          unit_amount: step.unitAmount,
          recurring: { interval: 'month', interval_count: 1 },
          tax_behavior: 'exclusive',
          lookup_key: step.lookupKey,
          nickname: `bos ${step.tier} monthly usd`,
          metadata: { [BOS_PRODUCT_METADATA_KEY]: BOS_PLAN_PRODUCT_MARKER },
        },
        { idempotencyKey: `bos-plan-price:${step.lookupKey}:${step.unitAmount}` }
      );
      assertTestObject(`price ${price.id}`, price);
      out(`created price ${price.id} lookup_key=${price.lookup_key}`);
    }
  }
}

async function main(argv: readonly string[]): Promise<number> {
  const envFile = resolveEnvFile(argv);
  const expectedAccount = requireExpectedAccount(argv);
  const key = readStripeKey(envFile);
  assertKeyKind(key, ['sk_test']);
  const doApply = hasFlag(argv, '--apply');

  const stripe = new Stripe(key, { apiVersion: API_VERSION });
  const account = await verifyAccount(stripe, expectedAccount);
  out(`mode test  account ${account.id} (${account.displayName})  ${doApply ? 'APPLY' : 'DRY RUN (add --apply to create)'}`);

  const plan = planSetup(await readTierStates(stripe));
  for (const step of plan.steps) out(describeStep(step));

  if (plan.stops.length > 0) {
    for (const stop of plan.stops) out(`STOP   ${stop}`);
    for (const line of PRICE_CHANGE_PROCEDURE) out(line);
    throw new ScriptRefusal('Stripe holds something this script will not change; nothing was created');
  }

  if (doApply) await apply(stripe, plan);

  out('');
  const findings = await runPlanPriceCheck(stripe, false);
  for (const line of formatFindings(findings)) out(line);
  // A dry run on an empty account fails the check by definition; only an applied run must pass.
  return !doApply || planPricesPass(findings) ? 0 : 1;
}

if (require.main === module) runScript(() => main(process.argv.slice(2)), out);

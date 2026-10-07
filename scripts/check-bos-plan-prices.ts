/**
 * check-bos-plan-prices: does each Business OS plan price in Stripe equal the
 * price we show? (plan payments P-2b, workplan §3.5; SA-P12 a.)
 *
 * READ-ONLY. One account read and one `prices.list` over every configured plan
 * lookup key (current and retired). Prints one PASS/FAIL row per tier, INFO
 * rows for retired keys, and a VERDICT row. Exit 0 on PASS, 1 on any FAIL,
 * 2 on a refusal.
 *
 * Accepts `sk_test_`, `rk_test_`, `sk_live_` and `rk_live_` keys. For live mode a
 * restricted read-only key is recommended (go-live §9.5 row 7); it needs read
 * access to Prices and to the account.
 *
 * USAGE
 *   npm run check-bos-plan-prices -- --env <file outside the repo> --expect-account acct_...
 *
 * The env file holds one line, STRIPE_SECRET_KEY=..., and must lie outside every
 * git checkout (P2-C9). The key is never printed.
 */

import Stripe from 'stripe';

import { allPlanLookupKeys } from '@/lib/business-os/entitlements/config/planPrices';
import {
  checkPlanPrices,
  groupPricesByLookupKey,
  planPricesPass,
  type PlanPriceFinding,
} from '@/lib/business-os/billing/planPriceCheck';
import {
  assertKeyKind,
  isLiveKind,
  readStripeKey,
  requireExpectedAccount,
  resolveEnvFile,
  runScript,
  verifyAccount,
} from './lib/stripe-script-guards';

export const API_VERSION = '2025-10-29.clover';

const out = (line: string) => process.stdout.write(`${line}\n`);

function usd(cents: number | undefined): string {
  return cents === undefined ? '-' : `$${(cents / 100).toFixed(2)}`;
}

/** The report the check prints (and the setup script reprints at its end). */
export function formatFindings(findings: readonly PlanPriceFinding[]): string[] {
  const lines = findings.map((f) => {
    const status = f.status.toUpperCase().padEnd(4);
    const price = f.priceId ?? '(none)';
    const expected = f.kind === 'current' ? ` display ${usd(f.expectedUnitAmount)}` : '';
    const problems = f.problems.length > 0 ? `  ${f.problems.join('; ')}` : '';
    return `${status} ${f.tier.padEnd(6)} ${f.lookupKey}  ${price}${expected}${problems}`;
  });
  lines.push(`VERDICT ${planPricesPass(findings) ? 'PASS' : 'FAIL'}`);
  return lines;
}

/** Lists the configured keys' prices, active or archived, and checks them. */
export async function runPlanPriceCheck(
  stripe: Pick<Stripe, 'prices'>,
  expectedLivemode: boolean
): Promise<PlanPriceFinding[]> {
  const result = await stripe.prices.list({ lookup_keys: [...allPlanLookupKeys()], limit: 100 });
  return checkPlanPrices({ pricesByLookupKey: groupPricesByLookupKey(result.data), expectedLivemode });
}

async function main(argv: readonly string[]): Promise<number> {
  const envFile = resolveEnvFile(argv);
  const expectedAccount = requireExpectedAccount(argv);
  const key = readStripeKey(envFile);
  const kind = assertKeyKind(key, ['sk_test', 'rk_test', 'sk_live', 'rk_live']);
  const live = isLiveKind(kind);

  const stripe = new Stripe(key, { apiVersion: API_VERSION });
  const account = await verifyAccount(stripe, expectedAccount);
  out(`mode ${live ? 'live' : 'test'}  account ${account.id} (${account.displayName})`);

  const findings = await runPlanPriceCheck(stripe, live);
  for (const line of formatFindings(findings)) out(line);
  return planPricesPass(findings) ? 0 : 1;
}

if (require.main === module) runScript(() => main(process.argv.slice(2)), out);

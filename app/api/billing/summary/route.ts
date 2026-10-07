/**
 * The Settings billing screen's figures — the read behind `BillingSettings`.
 *
 *   GET /api/billing/summary
 *
 * Replaces three reads the browser used to make with its own Supabase client
 * (CLAUDE.md rule 1; P-10 workplan §16b, B-3): the caller's `user_subscriptions`
 * row, their historical reward and boost-pack credit totals from
 * `credit_transactions`, and the two Pilot-Credit pricing values from
 * `ais_system_config`. The sums are done here; the browser gets one compact
 * object.
 *
 * ── INPUT: NONE ──────────────────────────────────────────────────────────────
 * No body and no query parameter is read, so there is nothing for Zod to parse.
 * The account is `user.id` from the verified session, never a request value.
 *
 * ── CLIENT ───────────────────────────────────────────────────────────────────
 * Every read uses the caller's RLS client (`createAuthenticatedServerClient`),
 * injected into the repositories, so the table policies that governed the old
 * browser reads still apply; the user-scoped reads are also `.eq('user_id')`.
 * No service-role client is imported.
 *
 * ── FAILURES ─────────────────────────────────────────────────────────────────
 * A failed subscription or credit read is a 500 (never a silent zero). A failed
 * pricing read is NOT: the screen always had defaults for it (0.00048 USD,
 * 10 tokens per credit) and logged the error, so it keeps doing exactly that.
 *
 * Read-only: no write, no audit entry (a read of one's own figures).
 *
 * @module app/api/billing/summary
 */

import { NextRequest, NextResponse } from 'next/server';

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { ConfigRepository } from '@/lib/repositories/ConfigRepository';
import { CreditTransactionRepository } from '@/lib/repositories/CreditTransactionRepository';
import { UserSubscriptionRepository } from '@/lib/repositories/UserSubscriptionRepository';
import type { UserSubscriptionBillingSummary } from '@/lib/repositories/types';
import { createAuthenticatedServerClient } from '@/lib/supabaseServerAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const logger = createLogger({ module: 'BillingSummaryAPI' });

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const REWARD_CREDIT = 'reward_credit';
const BOOST_PACK_PURCHASE = 'boost_pack_purchase';

/** The defaults the billing screen has always fallen back to. */
const DEFAULT_PILOT_CREDIT_COST_USD = 0.00048;
const DEFAULT_TOKENS_PER_PILOT_CREDIT = 10;

interface BillingSummary {
  /** `null` when the caller has no subscription row — not an error. */
  subscription: UserSubscriptionBillingSummary | null;
  rewardCredits: number;
  boostPackCredits: number;
  pricingConfig: {
    pilot_credit_cost_usd: number;
    tokens_per_pilot_credit: number;
  };
}

/** Same parsing the browser did: a missing key falls back to the default. */
function pricingFrom(config: Record<string, string> | null): BillingSummary['pricingConfig'] {
  return {
    pilot_credit_cost_usd: parseFloat(config?.pilot_credit_cost_usd || String(DEFAULT_PILOT_CREDIT_COST_USD)),
    tokens_per_pilot_credit: parseInt(config?.tokens_per_pilot_credit || String(DEFAULT_TOKENS_PER_PILOT_CREDIT)),
  };
}

function failure(error: string, detail: unknown) {
  return NextResponse.json(
    {
      success: false,
      error,
      details:
        process.env.NODE_ENV === 'development'
          ? detail instanceof Error
            ? detail.message
            : String(detail)
          : undefined,
    },
    { status: 500, headers: NO_STORE }
  );
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    }

    // The caller's own RLS client for every read (see header).
    const ownerClient = await createAuthenticatedServerClient();
    const subscriptions = new UserSubscriptionRepository(ownerClient);
    const transactions = new CreditTransactionRepository(ownerClient);
    // `ais_system_config` is a GLOBAL config table: it has no user_id, so this
    // read is deliberately not user-scoped (CLAUDE.md rule 4 does not apply).
    const config = new ConfigRepository(ownerClient);

    const [subscriptionResult, totalsResult, configResult] = await Promise.all([
      subscriptions.findBillingSummaryByUserId(user.id),
      transactions.sumCreditsDeltaByActivityType(user.id, [REWARD_CREDIT, BOOST_PACK_PURCHASE]),
      config.getSystemConfigs(['pilot_credit_cost_usd', 'tokens_per_pilot_credit']),
    ]);

    if (subscriptionResult.error) {
      requestLogger.error({ err: subscriptionResult.error, userId: user.id }, 'Billing summary: subscription read failed');
      return failure('Could not load your billing details', subscriptionResult.error);
    }
    if (totalsResult.error || !totalsResult.data) {
      requestLogger.error({ err: totalsResult.error, userId: user.id }, 'Billing summary: credit totals read failed');
      return failure('Could not load your billing details', totalsResult.error);
    }
    if (configResult.error) {
      // Non-fatal on purpose: the screen has always shown defaults here.
      requestLogger.warn({ err: configResult.error, userId: user.id }, 'Billing summary: pricing config read failed, using defaults');
    }

    const data: BillingSummary = {
      subscription: subscriptionResult.data,
      rewardCredits: totalsResult.data[REWARD_CREDIT] ?? 0,
      boostPackCredits: totalsResult.data[BOOST_PACK_PURCHASE] ?? 0,
      pricingConfig: pricingFrom(configResult.data),
    };

    requestLogger.info({ userId: user.id, hasSubscription: data.subscription !== null }, 'Billing summary read');
    return NextResponse.json({ success: true, data }, { headers: NO_STORE });
  } catch (error) {
    requestLogger.error({ err: error }, 'Billing summary request failed');
    return failure('Internal server error', error);
  }
}

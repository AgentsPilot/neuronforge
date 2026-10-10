// lib/repositories/UserSubscriptionRepository.ts
// Repository for `user_subscriptions` — the once-only free-tier grant, plus two
// reads (the GDPR export and the Settings billing summary), plus the Stripe
// webhook's agent-platform legacy reads and writes (CF-5 PR 5, section below).
//
// SERVICE ROLE, ON PURPOSE. This repository defaults to `supabaseServer`, which
// bypasses RLS. A user must never be able to write their own `balance`, so the
// grant cannot run under the user's RLS session. The tenant boundary is instead:
//   1. the caller passes the AUTHENTICATED user id (the route takes it from
//      `getUser()`, never from the request body), and every statement is
//      scoped with `.eq('user_id', userId)`;
//   2. every write payload is built here, field by field, from typed arguments.
//      Nothing is spread from caller or DB objects, `id` is never written, and
//      `account_frozen` is written only on a brand-new row (as `false`).
// See docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md §2.4 / §2.8.
//
// The billing-summary read is the exception to the service-role default: its
// route injects the caller's RLS client (createAuthenticatedServerClient), so
// RLS still applies on top of the `.eq('user_id', userId)` scope.
//
// Server-only: never import from a 'use client' file.

import { SupabaseClient, type PostgrestError } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';
import type {
  AgentRepositoryResult as RepositoryResult,
  FreeTierGrantPatch,
  FreeTierInsertOutcome,
  FreeTierNewRow,
  FreeTierNewRowValues,
  FreeTierUpdateOutcome,
  UserSubscriptionBillingSummary,
  UserSubscriptionGrantState,
} from './types';

/**
 * The columns the GDPR export reads from `user_subscriptions`
 * (findForUserDataExport; DATA_EXPORT_FOLLOWUPS_WORKPLAN.md §4.6). Changing
 * this changes what the export holds: a privacy decision.
 *
 * Included: balances, totals, status, period dates, card last 4 / brand (already
 * shown in the app), plan amounts, quotas, trial and free-tier fields, and, by
 * user decision BQ-2 (2026-10-04), the Stripe reference ids on the last line:
 * references to the person's own payments, useless without our secret key.
 * Left out: `last_low_balance_alert_at` (an internal email throttle) and
 * `grace_period_days` (an admin policy value). A column added later is not
 * exported until it is listed here.
 */
const SUBSCRIPTION_DATA_EXPORT_COLUMNS =
  'id, user_id, balance, total_earned, total_spent, created_at, updated_at, status, ' +
  'current_period_start, current_period_end, next_billing_date, credits_used_this_cycle, ' +
  'credits_carried_over, payment_method_last4, payment_method_brand, billing_cycle, ' +
  'pilot_credits_allocated_this_cycle, pilot_credits_used_this_cycle, pilot_credits_carried_over, ' +
  'total_lifetime_credits, cancel_at_period_end, canceled_at, trial_ends_at, monthly_amount_usd, ' +
  'monthly_credits, subscription_type, free_trial_used, trial_credits_granted, last_calculator_inputs, ' +
  'agents_paused, payment_retry_count, last_payment_attempt, storage_quota_mb, storage_used_mb, ' +
  'storage_alert_threshold, executions_quota, executions_used, executions_alert_threshold, ' +
  'free_tier_granted_at, free_tier_expires_at, free_tier_initial_amount, account_frozen, ' +
  'stripe_customer_id, stripe_subscription_id, stripe_price_id';

/** Postgres unique_violation. Matched on the code only, never the message (SA RC-2). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * What the Settings billing screen shows (findBillingSummaryByUserId). Exactly
 * the columns BillingSettings reads — the browser used to `select('*')`, which
 * also handed it the Stripe ids. Every name here is also in
 * SUBSCRIPTION_DATA_EXPORT_COLUMNS, which a live route already selects.
 */
const BILLING_SUMMARY_COLUMNS =
  'balance, total_spent, status, created_at, current_period_start, current_period_end, ' +
  'cancel_at_period_end, monthly_credits, monthly_amount_usd';

const GRANT_STATE_COLUMNS =
  'user_id, balance, total_earned, storage_quota_mb, executions_quota, account_frozen, free_tier_granted_at';

function errorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export class UserSubscriptionRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'UserSubscriptionRepository' });
  }

  /**
   * Read the columns the free-tier grant needs. `data: null` = no row.
   * `maybeSingle()` errors on more than one row, so duplicate rows fail closed.
   */
  async findGrantStateByUserId(
    userId: string
  ): Promise<RepositoryResult<UserSubscriptionGrantState | null>> {
    try {
      const { data, error } = await this.supabase
        .from('user_subscriptions')
        .select(GRANT_STATE_COLUMNS)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as UserSubscriptionGrantState | null) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, method: 'findGrantStateByUserId' }, 'Failed to read grant state');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Plain INSERT (never upsert) of a new row with the free tier already granted.
   * A unique violation on `user_id` means a concurrent grant (or another path)
   * created the row first: it is reported as `conflict`, not as an error.
   */
  async insertFreeTierRow(
    userId: string,
    values: FreeTierNewRowValues
  ): Promise<RepositoryResult<FreeTierInsertOutcome>> {
    const payload: FreeTierNewRow = {
      user_id: userId,
      balance: values.rawTokens,
      total_earned: values.rawTokens,
      storage_quota_mb: values.storageMb,
      storage_used_mb: 0,
      executions_quota: values.executionsQuota,
      executions_used: 0,
      status: 'active',
      free_tier_granted_at: values.grantedAt,
      free_tier_expires_at: values.expiresAt,
      free_tier_initial_amount: values.rawTokens,
      account_frozen: false,
      created_at: values.grantedAt,
      updated_at: values.grantedAt,
    };

    try {
      const { data, error } = await this.supabase
        .from('user_subscriptions')
        .insert(payload)
        .select('user_id');

      if (error) {
        if (errorCode(error) === PG_UNIQUE_VIOLATION) {
          this.logger.debug({ userId, method: 'insertFreeTierRow' }, 'Insert hit unique violation (row already exists)');
          return { data: { inserted: false, conflict: true }, error: null };
        }
        throw error;
      }

      const inserted = Array.isArray(data) && data.length === 1;
      return { data: { inserted, conflict: false }, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, method: 'insertFreeTierRow' }, 'Failed to insert free-tier row');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Conditional UPDATE that applies the grant to an existing row exactly once.
   *
   * The WHERE clause is what makes it race-safe (Postgres re-evaluates it after
   * waiting for a concurrent writer's row lock):
   *   - `free_tier_granted_at IS NULL` → once only;
   *   - `account_frozen IS NOT TRUE`   → never grants a frozen account (SA RC-1),
   *     including one frozen between our read and this write;
   *   - `balance = expected`           → never overwrites a concurrent spend.
   */
  async applyFreeTierGrant(
    userId: string,
    expectedBalance: number | null,
    patch: FreeTierGrantPatch
  ): Promise<RepositoryResult<FreeTierUpdateOutcome>> {
    // Rebuilt key by key: even if a caller passed a wider object, only these reach the DB.
    const payload: Record<string, string | number | null> = {
      balance: patch.balance,
      total_earned: patch.total_earned,
      storage_quota_mb: patch.storage_quota_mb,
      executions_quota: patch.executions_quota,
      free_tier_granted_at: patch.free_tier_granted_at,
      free_tier_initial_amount: patch.free_tier_initial_amount,
      updated_at: patch.updated_at,
    };
    if (patch.free_tier_expires_at !== undefined) {
      payload.free_tier_expires_at = patch.free_tier_expires_at;
    }

    try {
      let query = this.supabase
        .from('user_subscriptions')
        .update(payload)
        .eq('user_id', userId)
        .is('free_tier_granted_at', null)
        // IS NOT TRUE rather than `= false`, so a row whose flag is NULL is still eligible.
        .not('account_frozen', 'is', true);

      // `.eq('balance', null)` would match nothing; NULL needs IS NULL.
      query = expectedBalance === null ? query.is('balance', null) : query.eq('balance', expectedBalance);

      const { data, error } = await query.select('user_id');
      if (error) throw error;

      const rowCount = Array.isArray(data) ? data.length : 0;
      if (rowCount > 1) {
        // Only possible if user_id is not unique (workplan C1). The rows WERE changed, so
        // this must not read as "no update" (which would retry); surface it as an error (SA F-2).
        throw new Error(`Free-tier grant updated ${rowCount} rows; expected at most 1`);
      }
      return { data: { updated: rowCount === 1 }, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, method: 'applyFreeTierGrant' }, 'Failed to apply free-tier grant');
      return { data: null, error: error as Error };
    }
  }

  /**
   * GDPR export only (GET /api/user/data-export, Art. 15 / 20). A READ: the
   * caller's subscription row, SUBSCRIPTION_DATA_EXPORT_COLUMNS only. It changes
   * nothing about the grant writers above. The column set and `.single()` are
   * fixed: changing either changes what the export holds, which is a privacy
   * decision. No row is an error here (PGRST116), as it always was; the route
   * exports `[]`.
   */
  async findForUserDataExport(userId: string): Promise<RepositoryResult<Record<string, unknown>>> {
    try {
      const { data, error } = await this.supabase
        .from('user_subscriptions')
        .select(SUBSCRIPTION_DATA_EXPORT_COLUMNS)
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return { data: data as unknown as Record<string, unknown>, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, method: 'findForUserDataExport' }, 'Failed to read the subscription for the data export');
      return { data: null, error: error as Error };
    }
  }

  /**
   * Settings billing screen (GET /api/billing/summary). A READ of the caller's
   * row, BILLING_SUMMARY_COLUMNS only. `data: null` with no error = no row, which
   * the screen shows as "no subscription" (the browser's old `.single()` read
   * also yielded null there). `maybeSingle()` errors on more than one row.
   */
  async findBillingSummaryByUserId(
    userId: string
  ): Promise<RepositoryResult<UserSubscriptionBillingSummary | null>> {
    try {
      const { data, error } = await this.supabase
        .from('user_subscriptions')
        .select(BILLING_SUMMARY_COLUMNS)
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      return { data: (data as UserSubscriptionBillingSummary | null) ?? null, error: null };
    } catch (error) {
      this.logger.error({ err: error, userId, method: 'findBillingSummaryByUserId' }, 'Failed to read the billing summary');
      return { data: null, error: error as Error };
    }
  }

  // Stripe webhook, agent-platform legacy: owner-scoped (CF-5 PR 5)
  //
  // Moved out of `app/api/stripe/webhook/route.ts` with no behaviour change
  // (CF-5 PR 5, CLAUDE.md rule 1): the dunning handler, the boost-pack
  // checkout and the subscription status mirror. Each method issues exactly
  // the query the route issued inline: same table, operation, columns, filter,
  // payload and its key order, terminal. The webhook's characterisation
  // harness records the full chain.
  //
  // Each keeps the route's `.eq('user_id', userId)`. The id is `metadata.user_id`
  // on a PLATFORM Stripe object (invoice, checkout session, subscription) that
  // our own agent-platform checkout created, never a connected account's
  // metadata (workplan §5.1). These are agent-platform code paths kept as they
  // are (FU-1 dead dunning, FU-2 boost checkout, FU-6 status mirror); do not
  // extend them.
  //
  // Errors: supabase-js's own `{ data, error }`, with no try/catch and no
  // logging, unlike the methods above. A catch would turn a thrown query into
  // a quiet result where the route used to fail with 500 and let Stripe retry.

  /** The dunning state the payment-failure handler reads. `.single()`, as inline. */
  async findDunningState(userId: string): Promise<LegacyWebhookResult<LegacyDunningState>> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('payment_retry_count, grace_period_days, current_period_end')
      .eq('user_id', userId)
      .single<LegacyDunningState>();
    return { data, error };
  }

  /** Records a failed renewal attempt (dunning). `last_payment_attempt` is now. */
  async recordPaymentFailure(
    userId: string,
    failure: { retryCount: number; status: LegacyDunningStatus; agentsPaused: boolean }
  ): Promise<LegacyWebhookResult<null>> {
    const { error } = await this.supabase
      .from('user_subscriptions')
      .update({
        payment_retry_count: failure.retryCount,
        last_payment_attempt: new Date().toISOString(),
        status: failure.status,
        agents_paused: failure.agentsPaused,
      })
      .eq('user_id', userId);
    return { data: null, error };
  }

  /** The balance a boost pack is added to. `.single()`, as inline. */
  async findBalance(userId: string): Promise<LegacyWebhookResult<LegacyBalance>> {
    const { data, error } = await this.supabase
      .from('user_subscriptions')
      .select('balance, total_earned')
      .eq('user_id', userId)
      .single<LegacyBalance>();
    return { data, error };
  }

  /**
   * Writes the balance after a boost pack, clears the free-tier expiry and
   * unfreezes the account (a paying customer). The new values are computed by
   * the route from `findBalance`; the read-then-write is not atomic (FU-7).
   */
  async applyBoostPackBalance(
    userId: string,
    balances: { balance: number; totalEarned: number }
  ): Promise<LegacyWebhookResult<null>> {
    const { error } = await this.supabase
      .from('user_subscriptions')
      .update({
        balance: balances.balance,
        total_earned: balances.totalEarned,
        free_tier_expires_at: null,
        account_frozen: false,
      })
      .eq('user_id', userId);
    return { data: null, error };
  }

  /** Mirrors a Stripe subscription's cancellation state and status. */
  async mirrorStripeStatus(
    userId: string,
    mirror: { cancelAtPeriodEnd: boolean; canceledAt: string | null; status: string }
  ): Promise<LegacyWebhookResult<null>> {
    const { error } = await this.supabase
      .from('user_subscriptions')
      .update({
        cancel_at_period_end: mirror.cancelAtPeriodEnd,
        canceled_at: mirror.canceledAt,
        status: mirror.status,
      })
      .eq('user_id', userId);
    return { data: null, error };
  }

  /** Marks the subscription canceled now (Stripe deleted it). */
  async markCanceled(userId: string): Promise<LegacyWebhookResult<null>> {
    const { error } = await this.supabase
      .from('user_subscriptions')
      .update({
        status: 'canceled',
        canceled_at: new Date().toISOString(),
        cancel_at_period_end: false,
      })
      .eq('user_id', userId);
    return { data: null, error };
  }
}

/** What the webhook's legacy methods return: supabase-js's own result, error object kept. */
export interface LegacyWebhookResult<T> {
  data: T | null;
  error: PostgrestError | null;
}

/** The dunning columns `findDunningState` reads. */
export interface LegacyDunningState {
  payment_retry_count: number | null;
  grace_period_days: number | null;
  current_period_end: string | null;
}

/** The two statuses the dunning handler writes. */
export type LegacyDunningStatus = 'past_due' | 'active';

/** The balance columns `findBalance` reads. */
export interface LegacyBalance {
  balance: number | null;
  total_earned: number | null;
}

// Singleton instance for convenience
export const userSubscriptionRepository = new UserSubscriptionRepository();

// lib/repositories/BusinessOsBillingAccountRepository.ts
//
// Data access for the Business OS billing record `business_os_billing_accounts`:
// one row per account PER STRIPE MODE, holding the Business OS Stripe customer
// (and, from P-3a/P-3b, the subscription and a display mirror of its state).
//
// Schema:   supabase/migrations/20261025_business_os_billing_accounts.sql
// Workplan: docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P2_WORKPLAN.md §3.7 (P-2a),
//           SA rulings Q-1, Q-2, Q-9
//
// ── SCOPE IN P-2a ───────────────────────────────────────────────────────────
// Two methods only (SA Q-9): `findByUser` and `recordCustomer`. Lookups by a
// Stripe id, the SR-5 checkout lock and the webhook mirror updates arrive with
// their callers (P-3a, P-3b), each in its own review. The replace-customer
// method lands in P-3a and must be compare-and-set on the old customer id
// (SA Q-2). There is no DELETE grant, so there is no delete method.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// The table has RLS on, NO policy and NO client grant at all (SA-P1): owners
// will read their billing state through routes, never directly. So this
// repository runs on `supabaseServer`. The account id always comes from a
// server-side caller (the session in P-3a, our own record in P-3b), never from
// request input (tenant-isolation-guard). Every read scopes by
// `.eq('user_id', userId)` (CLAUDE.md rule 4) AND by `livemode` (PF-15).
//
// ── NO ROW CAN MOVE BETWEEN ACCOUNTS ────────────────────────────────────────
// The insert payload is an explicit three-field allow-list: no spread, no
// `id`, no upsert. The database grants no UPDATE on `id`, `user_id`,
// `livemode` or `created_at` (SA Q-2), and the UNIQUE constraint on
// `stripe_customer_id` stops one account taking another's customer: that
// conflict is an error here, never a returned row.
//
// CALLERS: `lib/business-os/billing/businessOsStripeCustomer.ts` only. A source
// guard in `lib/repositories/__tests__/BusinessOsBillingAccountRepository.test.ts`
// holds the exact list of files allowed to name this repository.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

export const BOS_BILLING_ACCOUNTS_TABLE = 'business_os_billing_accounts';

/** The only columns selected: never `*`. A test pins this list to the migration's columns, in order. */
export const BILLING_ACCOUNT_COLUMNS =
  'id, user_id, livemode, stripe_customer_id, stripe_subscription_id, subscription_status, bought_tier, current_period_end, cancel_at_period_end, pending_tier, open_checkout_session_id, open_checkout_expires_at, last_invoice_id, last_paid_at, last_payment_failed_at, failed_attempts, action_required_invoice_url, founder_discount_applied_at, ended_at, created_at, updated_at';

/** Stripe's subscription statuses, as the migration's CHECK admits them. Display only (SA-P8). */
export type BusinessOsSubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

const SUBSCRIPTION_STATUSES: readonly BusinessOsSubscriptionStatus[] = [
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
];

/** One billing row, as the server reads it. */
export interface BusinessOsBillingAccount {
  id: string;
  /** Null only once the account was deleted and the row detached (ON DELETE SET NULL). */
  accountId: string | null;
  livemode: boolean;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  subscriptionStatus: BusinessOsSubscriptionStatus | null;
  boughtTier: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  pendingTier: string | null;
  openCheckoutSessionId: string | null;
  openCheckoutExpiresAt: string | null;
  lastInvoiceId: string | null;
  lastPaidAt: string | null;
  lastPaymentFailedAt: string | null;
  failedAttempts: number;
  actionRequiredInvoiceUrl: string | null;
  founderDiscountAppliedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What `recordCustomer` writes: exactly these three facts. */
export interface BusinessOsBillingCustomerInput {
  /** The server-derived account. Never from request input. */
  userId: string;
  /** The mode of the Stripe customer, as Stripe reported it. */
  livemode: boolean;
  stripeCustomerId: string;
}

export interface BusinessOsBillingCustomerRecordResult {
  account: BusinessOsBillingAccount;
  /** False when the account already had a row in this mode (a lost race): the stored row is returned. */
  created: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]{1,251}$/;
const UNIQUE_VIOLATION = '23505';

class BillingAccountRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingAccountRepositoryError';
  }
}

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  const message =
    typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : 'billing_account_query_failed';
  const wrapped = new BillingAccountRepositoryError(message);
  const code = sqlStateOf(error);
  if (code) Object.assign(wrapped, { code });
  return wrapped;
}

function text(value: unknown): string {
  if (typeof value !== 'string') throw new BillingAccountRepositoryError('unreadable_text');
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new BillingAccountRepositoryError('unreadable_timestamp');
  }
  return value;
}

function nullableTimestamp(value: unknown): string | null {
  return value === null ? null : timestamp(value);
}

function bool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BillingAccountRepositoryError('unreadable_boolean');
  return value;
}

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new BillingAccountRepositoryError('unreadable_id');
  return value;
}

function status(value: unknown): BusinessOsSubscriptionStatus | null {
  if (value === null) return null;
  const found = SUBSCRIPTION_STATUSES.find((known) => known === value);
  if (!found) throw new BillingAccountRepositoryError('unknown_subscription_status');
  return found;
}

function attempts(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new BillingAccountRepositoryError('unreadable_failed_attempts');
  }
  return value;
}

/** Strict mapping: an unreadable row is an error, never a guessed value. */
function mapAccount(raw: Record<string, unknown>): BusinessOsBillingAccount {
  return {
    id: uuid(raw.id),
    accountId: raw.user_id === null ? null : uuid(raw.user_id),
    livemode: bool(raw.livemode),
    stripeCustomerId: text(raw.stripe_customer_id),
    stripeSubscriptionId: nullableText(raw.stripe_subscription_id),
    subscriptionStatus: status(raw.subscription_status),
    boughtTier: nullableText(raw.bought_tier),
    currentPeriodEnd: nullableTimestamp(raw.current_period_end),
    cancelAtPeriodEnd: bool(raw.cancel_at_period_end),
    pendingTier: nullableText(raw.pending_tier),
    openCheckoutSessionId: nullableText(raw.open_checkout_session_id),
    openCheckoutExpiresAt: nullableTimestamp(raw.open_checkout_expires_at),
    lastInvoiceId: nullableText(raw.last_invoice_id),
    lastPaidAt: nullableTimestamp(raw.last_paid_at),
    lastPaymentFailedAt: nullableTimestamp(raw.last_payment_failed_at),
    failedAttempts: attempts(raw.failed_attempts),
    actionRequiredInvoiceUrl: nullableText(raw.action_required_invoice_url),
    founderDiscountAppliedAt: nullableTimestamp(raw.founder_discount_applied_at),
    endedAt: nullableTimestamp(raw.ended_at),
    createdAt: timestamp(raw.created_at),
    updatedAt: timestamp(raw.updated_at),
  };
}

export class BusinessOsBillingAccountRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsBillingAccountRepository' });
  }

  /** The account's billing row in one Stripe mode, or `null` when it has none. */
  async findByUser(userId: string, livemode: boolean): Promise<RepositoryResult<BusinessOsBillingAccount | null>> {
    if (typeof userId !== 'string' || !UUID_PATTERN.test(userId) || typeof livemode !== 'boolean') {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    try {
      const { data, error } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .select(BILLING_ACCOUNT_COLUMNS)
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .maybeSingle();
      if (error) throw asError(error);
      if (data === null || data === undefined) return { data: null, error: null };
      return { data: mapAccount(data as Record<string, unknown>), error: null };
    } catch (err) {
      this.logger.error({ err, method: 'findByUser', userId, livemode }, 'Failed to read the Business OS billing row');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * Record the account's Business OS Stripe customer for one mode.
   *
   * A plain INSERT of exactly three fields. On a unique violation it re-reads
   * the account's own row: if one exists the race was lost and the stored row
   * is returned (`created: false`). If none exists, the conflict was on
   * `stripe_customer_id`: another account holds that customer, which is an
   * error and an alert, never a row.
   */
  async recordCustomer(input: BusinessOsBillingCustomerInput): Promise<RepositoryResult<BusinessOsBillingCustomerRecordResult>> {
    const { userId, livemode, stripeCustomerId } = input;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof stripeCustomerId !== 'string' ||
      !CUSTOMER_ID_PATTERN.test(stripeCustomerId)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'recordCustomer', userId, livemode });

    try {
      // Explicit allow-list (tenant-isolation-guard Step 4): never a spread of the input.
      const { data, error } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .insert({ user_id: userId, livemode, stripe_customer_id: stripeCustomerId })
        .select(BILLING_ACCOUNT_COLUMNS)
        .single();

      if (!error) {
        const account = mapAccount(data as Record<string, unknown>);
        methodLogger.info({ billingAccountId: account.id, stripeCustomerId }, 'Business OS billing row recorded');
        return { data: { account, created: true }, error: null };
      }

      if (sqlStateOf(error) !== UNIQUE_VIOLATION) throw asError(error);

      const existing = await this.findByUser(userId, livemode);
      if (existing.error) return { data: null, error: existing.error };
      if (existing.data) {
        if (existing.data.stripeCustomerId !== stripeCustomerId) {
          methodLogger.warn(
            { storedCustomerId: existing.data.stripeCustomerId, offeredCustomerId: stripeCustomerId },
            'Business OS billing row already held another customer; the stored one wins'
          );
        }
        return { data: { account: existing.data, created: false }, error: null };
      }

      methodLogger.error(
        { stripeCustomerId, alert: true },
        'Stripe customer is already recorded for another account; nothing was recorded'
      );
      return { data: null, error: new BillingAccountRepositoryError('stripe_customer_held_by_another_account') };
    } catch (err) {
      methodLogger.error({ err }, 'Failed to record the Business OS billing row');
      return { data: null, error: asError(err) };
    }
  }
}

// Singleton on the service-role client (see the header for why).
export const businessOsBillingAccountRepository = new BusinessOsBillingAccountRepository();

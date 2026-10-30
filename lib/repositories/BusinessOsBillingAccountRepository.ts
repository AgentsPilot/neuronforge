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
// ── SCOPE ───────────────────────────────────────────────────────────────────
// P-2a (SA Q-9): `findByUser` and `recordCustomer`.
// P-3a (workplan BUSINESS_OS_PLAN_PAYMENTS_P3A_WORKPLAN.md §3.5, SA Q-2, Q-8):
// `acquireCheckoutLock` (the SR-5 checkout lock) and `replaceCustomer`. Both are
// compare-and-set UPDATEs with `{ count: 'exact' }` and NO `.select()`, because
// UPDATE + `.or()` + `.select()` fails with 42703 in production.
// P-3b.2 (workplan BUSINESS_OS_PLAN_PAYMENTS_P3B_WORKPLAN.md §3.3, §3.5): the
// webhook's two lookups by a Stripe id (`findByStripeSubscription`,
// `findByStripeCustomer`) and three compare-and-set UPDATEs
// (`linkCheckoutSession`, `releaseCheckoutLock`, `mirrorSubscriptionState`).
// Like P-3a's, every UPDATE is `{ count: 'exact' }` with NO `.select()` and,
// here, no `.or()` at all. There is no DELETE grant, so there is no delete method.
// P-6a.1 (workplan BUSINESS_OS_PLAN_PAYMENTS_P6A_WORKPLAN.md §5.8, SA C-6):
// `attachTestClockCustomer`, TEST MODE ONLY, for the /test-business-os test
// clock: the same compare-and-set shape, clearing the whole subscription mirror.
// P-6a.2 (same workplan §5.3, §5.4; SA C-1 ruling, C-2, C-3): the renewal
// failure record (`recordRenewalFailure`, `recordActionRequired`) and its cure
// (`clearRenewalFailure`). Each READS the row, DECIDES in a pure exported
// function (`decideRenewalFailure`, `decideRenewalCure`) and writes by
// compare-and-set on every value the decision read: `.eq` / `.is` only, no
// `.or()`, no `.select()`, `{ count: 'exact' }`. "Cured" is decided by billing
// PERIODS (the failed invoice's line period end against `current_period_end`),
// never by comparing `event.created` with a Stripe timestamp: under a test
// clock they are two different clocks (C-1). `current_period_end` is written
// only by the paid apply function (and CLEARED, to null, by the test-mode
// attach and, since P-8b.2 / F-1, by `replaceCustomer`); a source test keeps it so.
// D4b (account deletion lifecycle SX-3 part 2; workplan
// BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md §3.4, §3.5 and the D4b addendum;
// SA S-3, DR-3, DR-13, R-C, R-D): the plan-ends reminder record, three columns
// added by 20261100. The cron's `claimCancelReminders` (the one RPC here,
// `claim_bos_plan_cancel_reminders`), `completeCancelReminder` and
// `releaseCancelReminder` are ⟨unscoped-by-design⟩: cross-account by row, as
// `PluginConnectionRepository`'s cron methods, and the two writes are a CAS on
// the row id + the runner + that row's `user_id` + `livemode`. The cancel
// email's `markCancelReminderCovered` is user-scoped. None writes `updated_at`
// (the bookkeeping is not a billing change, DR-13). Both customer swaps clear
// the three columns with the rest of the subscription (R-C).
//
// ── THE TWO LOOKUPS BY A STRIPE ID (documented exception to CLAUDE.md rule 4) ─
// The webhook does not know the account yet: finding it is the point (SR-8).
// So these two reads filter by a UNIQUE Stripe id + `livemode`, NOT by
// `user_id`, and select the full row. The account is then taken from THAT row,
// never from Stripe metadata, and every write that follows is scoped by that
// row's `user_id` + `livemode` (tenant-isolation-guard). Neither lookup can
// return two rows: `stripe_subscription_id` and `stripe_customer_id` are UNIQUE.
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
// CALLERS: `lib/business-os/billing/businessOsStripeCustomer.ts`,
// `lib/business-os/billing/planCheckout.ts` (P-3a), the P-3b.2 webhook use
// cases (`planPaymentApply.ts`, `planCheckoutSessionEvents.ts`,
// `planSubscriptionMirror.ts`, wired by `planBillingHandler.ts`), the
// P-6a.1 test clock (`planTestClock.ts`), the D4b plan-ends reminder
// (`planCancelReminderPassDeps.ts`, and `planCancelEmailDeps.ts` for the
// covered mark), and the
// admin deletion reads under `lib/business-os/purge/`. A source
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
/** A Stripe Checkout Session id, as the `checkout_id_shape` CHECK admits it (`cs_`, at most 255). */
const CHECKOUT_SESSION_ID_PATTERN = /^cs_[A-Za-z0-9_]{1,252}$/;
/** A Stripe subscription id, as the `subscription_id_shape` CHECK admits it (`sub_`, at most 255). */
const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{1,251}$/;

/**
 * `Date.prototype.toISOString()` output only: no `+` (a URL would turn it into
 * a space) and no comma (it would split the `.or()` list). This is what makes
 * interpolating the time into the lock filter safe.
 */
function isFilterSafeIso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

const INVOICE_ID_PATTERN = /^in_[A-Za-z0-9]{1,252}$/;

/**
 * Stripe's hosted invoice page, the only link a "Confirm payment" banner may
 * open (plan payments P-6a.2, §5.4). A bearer link to the owner's invoice:
 * never logged, never audited. Also re-checked by the banner read (SA C-13).
 * The table's own CHECK (`https://`, at most 2048) is looser; this is ours.
 */
export const HOSTED_INVOICE_URL_PREFIX = 'https://invoice.stripe.com/';

export function isHostedInvoiceUrl(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(HOSTED_INVOICE_URL_PREFIX) &&
    value.length > HOSTED_INVOICE_URL_PREFIX.length &&
    value.length <= 2048 &&
    !/\s/.test(value)
  );
}

/** What a failed (or authentication-needing) RENEWAL invoice says, for the decision. */
export interface RenewalFailureFacts {
  stripeSubscriptionId: string;
  invoiceId: string;
  /** `P`: the invoice's subscription line period end, the paid-through date it would buy (never `invoice.period_end`). */
  periodEndIso: string;
  /** Stripe's `attempt_count` (0 for an off-session 3-D Secure failure, X-5). */
  attemptCount: number;
  /** `event.created`: DISPLAY ONLY. Compared only with an earlier `event.created` (one clock). */
  failedAtIso: string;
  /** The event invoice's `hosted_invoice_url` as Stripe sent it; stored only for `actionRequired` and only when shaped. */
  hostedInvoiceUrl: string | null;
  /** `invoice.payment_action_required` (true) or `invoice.payment_failed` (false). */
  actionRequired: boolean;
}

/** The columns `decideRenewalFailure` reads, and so the compare-and-set compares. */
export type RenewalFailureRowFacts = Pick<
  BusinessOsBillingAccount,
  'stripeSubscriptionId' | 'currentPeriodEnd' | 'lastInvoiceId' | 'failedAttempts' | 'actionRequiredInvoiceUrl' | 'lastPaymentFailedAt'
>;

export type RenewalFailureMootReason = 'no_row' | 'other_subscription' | 'period_already_paid' | 'invoice_already_paid';

export type RenewalFailureDecision =
  | { kind: 'moot'; reason: RenewalFailureMootReason }
  /** A replay, or an older delivery: the row already says as much or more. */
  | { kind: 'unchanged' }
  | { kind: 'write'; failedAttempts: number; lastPaymentFailedAt: string; actionRequiredInvoiceUrl: string | null };

function instant(value: string): number {
  return Date.parse(value);
}

/**
 * The renewal-failure decision (SA C-1 ruling, rules 2 to 6). Pure.
 *
 *   moot       the row holds another subscription (or none), the row is
 *              already paid through `P` (`current_period_end >= P`), or this
 *              very invoice is the last one paid
 *   attempts   `max(row, max(attempt_count, 1))`: a recorded renewal failure
 *              is at least one attempt, and the larger count wins, so a
 *              replay or a late older delivery never lowers it
 *   URL        set by an action-required event with a Stripe-hosted URL; kept
 *              by a later event on the SAME invoice (same hosted URL), cleared
 *              by one on a different invoice
 *   date       the later of the two `event.created` values: display only
 *
 * The two period dates compared are both Stripe's (one clock); `failedAtIso`
 * is never compared with them.
 */
export function decideRenewalFailure(row: RenewalFailureRowFacts | null, facts: RenewalFailureFacts): RenewalFailureDecision {
  if (!row) return { kind: 'moot', reason: 'no_row' };
  if (row.stripeSubscriptionId !== facts.stripeSubscriptionId) return { kind: 'moot', reason: 'other_subscription' };
  if (row.currentPeriodEnd !== null && instant(row.currentPeriodEnd) >= instant(facts.periodEndIso)) {
    return { kind: 'moot', reason: 'period_already_paid' };
  }
  if (row.lastInvoiceId !== null && row.lastInvoiceId === facts.invoiceId) return { kind: 'moot', reason: 'invoice_already_paid' };

  const failedAttempts = Math.max(row.failedAttempts, Math.max(facts.attemptCount, 1));

  let actionRequiredInvoiceUrl: string | null;
  if (facts.actionRequired && isHostedInvoiceUrl(facts.hostedInvoiceUrl)) {
    actionRequiredInvoiceUrl = facts.hostedInvoiceUrl;
  } else if (row.actionRequiredInvoiceUrl !== null && row.actionRequiredInvoiceUrl === facts.hostedInvoiceUrl) {
    actionRequiredInvoiceUrl = row.actionRequiredInvoiceUrl;
  } else {
    actionRequiredInvoiceUrl = null;
  }

  const lastPaymentFailedAt =
    row.lastPaymentFailedAt !== null && instant(row.lastPaymentFailedAt) >= instant(facts.failedAtIso)
      ? row.lastPaymentFailedAt
      : facts.failedAtIso;

  if (
    failedAttempts === row.failedAttempts &&
    actionRequiredInvoiceUrl === row.actionRequiredInvoiceUrl &&
    lastPaymentFailedAt === row.lastPaymentFailedAt
  ) {
    return { kind: 'unchanged' };
  }
  return { kind: 'write', failedAttempts, lastPaymentFailedAt, actionRequiredInvoiceUrl };
}

/** The columns `decideRenewalCure` reads. */
export type RenewalCureRowFacts = Pick<
  BusinessOsBillingAccount,
  'stripeSubscriptionId' | 'currentPeriodEnd' | 'failedAttempts' | 'actionRequiredInvoiceUrl'
>;

export type RenewalCureDecision =
  | { kind: 'nothing'; reason: 'no_row' | 'other_subscription' | 'no_failure' | 'no_period' | 'older_invoice' }
  | { kind: 'clear' };

/**
 * The cure (SA C-1 ruling, rule 5). Pure. Read AFTER the apply: the failure
 * marker is cleared only when the paid invoice is the newest
 * (`P >= current_period_end`), so a late replay of an older paid invoice
 * clears nothing.
 */
export function decideRenewalCure(
  row: RenewalCureRowFacts | null,
  facts: { stripeSubscriptionId: string; paidPeriodEndIso: string }
): RenewalCureDecision {
  if (!row) return { kind: 'nothing', reason: 'no_row' };
  if (row.stripeSubscriptionId !== facts.stripeSubscriptionId) return { kind: 'nothing', reason: 'other_subscription' };
  if (row.failedAttempts === 0 && row.actionRequiredInvoiceUrl === null) return { kind: 'nothing', reason: 'no_failure' };
  if (row.currentPeriodEnd === null) return { kind: 'nothing', reason: 'no_period' };
  if (instant(facts.paidPeriodEndIso) < instant(row.currentPeriodEnd)) return { kind: 'nothing', reason: 'older_invoice' };
  return { kind: 'clear' };
}

/** What a renewal-failure write did. */
export type RenewalFailureWriteResult =
  | { outcome: 'recorded'; failedAttempts: number; actionRequiredUrlStored: boolean }
  | { outcome: 'unchanged' }
  | { outcome: 'moot'; reason: RenewalFailureMootReason };

export type RenewalCureResult = { outcome: 'cleared' } | { outcome: 'nothing'; reason: Extract<RenewalCureDecision, { kind: 'nothing' }>['reason'] };

/** Compare-and-set rounds: the first, and one re-read after a concurrent write (C-2). */
const CAS_ROUNDS = 2;

/** "No lock, or an expired one", as a PostgREST `or` filter. Exported for its test. */
export function checkoutLockFreeFilter(nowIso: string): string {
  return `open_checkout_session_id.is.null,open_checkout_expires_at.lte.${nowIso}`;
}

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

  /**
   * SR-5 / SA-P14 layer 1: record an open checkout session as the account's
   * checkout lock, by COMPARE-AND-SET (P-3a workplan §3.5, SA Q-2).
   *
   * Succeeds only while the row still holds `stripeCustomerId` and has no
   * unexpired lock (none at all, or one whose expiry is at or before `nowIso`).
   * `acquired: false` means another checkout holds the lock, or the customer
   * was replaced meanwhile; the caller expires its own session.
   *
   * `{ count: 'exact' }` and NO `.select()` (see the header). The patch is an
   * explicit allow-list of three columns; `user_id`, `livemode` and `id` have
   * no UPDATE grant anyway.
   */
  async acquireCheckoutLock(input: {
    userId: string;
    livemode: boolean;
    stripeCustomerId: string;
    sessionId: string;
    expiresAtIso: string;
    nowIso: string;
  }): Promise<RepositoryResult<{ acquired: boolean }>> {
    const { userId, livemode, stripeCustomerId, sessionId, expiresAtIso, nowIso } = input;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof stripeCustomerId !== 'string' ||
      !CUSTOMER_ID_PATTERN.test(stripeCustomerId) ||
      typeof sessionId !== 'string' ||
      !CHECKOUT_SESSION_ID_PATTERN.test(sessionId) ||
      !isFilterSafeIso(expiresAtIso) ||
      !isFilterSafeIso(nowIso)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'acquireCheckoutLock', userId, livemode });

    try {
      const { error, count } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .update(
          { open_checkout_session_id: sessionId, open_checkout_expires_at: expiresAtIso, updated_at: nowIso },
          { count: 'exact' }
        )
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .eq('stripe_customer_id', stripeCustomerId)
        .or(checkoutLockFreeFilter(nowIso));
      if (error) throw asError(error);
      if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
      return { data: { acquired: count === 1 }, error: null };
    } catch (err) {
      methodLogger.error({ err, sessionId }, 'Failed to record the Business OS checkout lock');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * Replace the account's Stripe customer after Stripe reported the stored one
   * missing (deleted at Stripe), by COMPARE-AND-SET on the old id (P-2 SA Q-2,
   * Q-6; P-3a §3.5, SA Q-8, C-3).
   *
   * Clears the WHOLE subscription mirror and the lock with it: a deleted
   * customer has no live subscription, and keeping its subscription id would
   * make the checkout refuse for ever. `replaced: false` means another request
   * replaced it first (or the row is gone); the caller re-reads and uses what
   * is stored.
   *
   * P-6a follow-up F-1, fixed in plan payments P-8b.2 (TL decision 11): it now
   * clears every subscription-scoped column of the 20261025 grant, exactly as
   * the test-clock attach does (SA C-6), not only the subscription id, status
   * and lock. The kept columns were the same stale-column class as C-6: a stale
   * `ended_at` hid the next subscription's failures, a stale `current_period_end`
   * could make the apply function treat the next purchase's invoice as not the
   * newest, and stale mirror columns read as false disagreements in the nightly
   * reconcile (Step B). `founder_discount_applied_at` is left alone: it is about
   * the account, not one subscription.
   *
   * A unique violation (the new customer is already recorded for another
   * account) is an error with an alert, never a returned row, as in
   * `recordCustomer`. `{ count: 'exact' }`, no `.select()` (see the header).
   */
  async replaceCustomer(input: {
    userId: string;
    livemode: boolean;
    oldCustomerId: string;
    newCustomerId: string;
    nowIso: string;
  }): Promise<RepositoryResult<{ replaced: boolean }>> {
    const { userId, livemode, oldCustomerId, newCustomerId, nowIso } = input;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof oldCustomerId !== 'string' ||
      !CUSTOMER_ID_PATTERN.test(oldCustomerId) ||
      typeof newCustomerId !== 'string' ||
      !CUSTOMER_ID_PATTERN.test(newCustomerId) ||
      oldCustomerId === newCustomerId ||
      !isFilterSafeIso(nowIso)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'replaceCustomer', userId, livemode });

    try {
      const { error, count } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .update(
          {
            stripe_customer_id: newCustomerId,
            stripe_subscription_id: null,
            subscription_status: null,
            bought_tier: null,
            current_period_end: null,
            cancel_at_period_end: false,
            pending_tier: null,
            open_checkout_session_id: null,
            open_checkout_expires_at: null,
            last_invoice_id: null,
            last_paid_at: null,
            last_payment_failed_at: null,
            failed_attempts: 0,
            action_required_invoice_url: null,
            ended_at: null,
            // D4b (SA R-C): the plan-ends reminder record is subscription-scoped, so it goes with the subscription.
            cancel_reminder_sent_for: null,
            cancel_reminder_claimed_by: null,
            cancel_reminder_claimed_at: null,
            updated_at: nowIso,
          },
          { count: 'exact' }
        )
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .eq('stripe_customer_id', oldCustomerId);
      if (error) {
        if (sqlStateOf(error) === UNIQUE_VIOLATION) {
          methodLogger.error(
            { newCustomerId, alert: true },
            'Replacement Stripe customer is already recorded for another account; nothing was replaced'
          );
          return { data: null, error: new BillingAccountRepositoryError('stripe_customer_held_by_another_account') };
        }
        throw asError(error);
      }
      if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
      return { data: { replaced: count === 1 }, error: null };
    } catch (err) {
      methodLogger.error({ err }, 'Failed to replace the Business OS Stripe customer');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * TEST MODE ONLY (plan payments P-6a.1, SA C-6): put the account on a fresh
   * test-clock customer, by COMPARE-AND-SET on the old customer id, and clear
   * EVERY subscription-scoped column the 20261025 grant lists.
   *
   * Why it clears everything: a stale `ended_at` would make the next
   * subscription read as not live and hide its failures; a stale, clock-future
   * `current_period_end` from an earlier demo would make the apply function
   * treat the next purchase's invoice as not the newest, so the plan row would
   * never be written. `founder_discount_applied_at` is left alone (it is about
   * the account, not one subscription). Since P-8b.2 (follow-up F-1)
   * `replaceCustomer` clears the same set; this method stays separate because
   * it is TEST MODE ONLY.
   *
   * Refuses a live-mode row (`livemode: true`) as invalid input: a test clock
   * has no meaning there. `{ count: 'exact' }`, no `.select()`, no `.or()`.
   */
  async attachTestClockCustomer(input: {
    userId: string;
    oldCustomerId: string;
    newCustomerId: string;
    nowIso: string;
  }): Promise<RepositoryResult<{ replaced: boolean }>> {
    const { userId, oldCustomerId, newCustomerId, nowIso } = input;
    const livemode = false;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof oldCustomerId !== 'string' ||
      !CUSTOMER_ID_PATTERN.test(oldCustomerId) ||
      typeof newCustomerId !== 'string' ||
      !CUSTOMER_ID_PATTERN.test(newCustomerId) ||
      oldCustomerId === newCustomerId ||
      !isFilterSafeIso(nowIso)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'attachTestClockCustomer', userId, livemode });

    try {
      const { error, count } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .update(
          {
            stripe_customer_id: newCustomerId,
            stripe_subscription_id: null,
            subscription_status: null,
            bought_tier: null,
            current_period_end: null,
            cancel_at_period_end: false,
            pending_tier: null,
            open_checkout_session_id: null,
            open_checkout_expires_at: null,
            last_invoice_id: null,
            last_paid_at: null,
            last_payment_failed_at: null,
            failed_attempts: 0,
            action_required_invoice_url: null,
            ended_at: null,
            // D4b (SA R-C): the plan-ends reminder record is subscription-scoped, so it goes with the subscription.
            cancel_reminder_sent_for: null,
            cancel_reminder_claimed_by: null,
            cancel_reminder_claimed_at: null,
            updated_at: nowIso,
          },
          { count: 'exact' }
        )
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .eq('stripe_customer_id', oldCustomerId);
      if (error) {
        if (sqlStateOf(error) === UNIQUE_VIOLATION) {
          methodLogger.error(
            { newCustomerId, alert: true },
            'Test-clock Stripe customer is already recorded for another account; nothing was replaced'
          );
          return { data: null, error: new BillingAccountRepositoryError('stripe_customer_held_by_another_account') };
        }
        throw asError(error);
      }
      if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
      return { data: { replaced: count === 1 }, error: null };
    } catch (err) {
      methodLogger.error({ err }, 'Failed to attach the Business OS test-clock customer');
      return { data: null, error: asError(err) };
    }
  }

  // ── P-3b.2: the webhook's reads and compare-and-set writes (§3.3, §3.5) ────

  /**
   * The billing row holding a Stripe subscription, in one mode, or `null`.
   * Documented exception to the `user_id` filter (see the header): the
   * account is not known yet, and is taken from the returned row.
   */
  async findByStripeSubscription(
    stripeSubscriptionId: string,
    livemode: boolean
  ): Promise<RepositoryResult<BusinessOsBillingAccount | null>> {
    if (
      typeof stripeSubscriptionId !== 'string' ||
      !SUBSCRIPTION_ID_PATTERN.test(stripeSubscriptionId) ||
      typeof livemode !== 'boolean'
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    try {
      const { data, error } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .select(BILLING_ACCOUNT_COLUMNS)
        .eq('stripe_subscription_id', stripeSubscriptionId)
        .eq('livemode', livemode)
        .maybeSingle();
      if (error) throw asError(error);
      if (data === null || data === undefined) return { data: null, error: null };
      return { data: mapAccount(data as Record<string, unknown>), error: null };
    } catch (err) {
      this.logger.error(
        { err, method: 'findByStripeSubscription', stripeSubscriptionId, livemode },
        'Failed to read the Business OS billing row by subscription'
      );
      return { data: null, error: asError(err) };
    }
  }

  /**
   * The billing row holding a Stripe customer, in one mode, or `null`. Same
   * documented exception as `findByStripeSubscription`.
   */
  async findByStripeCustomer(
    stripeCustomerId: string,
    livemode: boolean
  ): Promise<RepositoryResult<BusinessOsBillingAccount | null>> {
    if (typeof stripeCustomerId !== 'string' || !CUSTOMER_ID_PATTERN.test(stripeCustomerId) || typeof livemode !== 'boolean') {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    try {
      const { data, error } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .select(BILLING_ACCOUNT_COLUMNS)
        .eq('stripe_customer_id', stripeCustomerId)
        .eq('livemode', livemode)
        .maybeSingle();
      if (error) throw asError(error);
      if (data === null || data === undefined) return { data: null, error: null };
      return { data: mapAccount(data as Record<string, unknown>), error: null };
    } catch (err) {
      this.logger.error(
        { err, method: 'findByStripeCustomer', stripeCustomerId, livemode },
        'Failed to read the Business OS billing row by customer'
      );
      return { data: null, error: asError(err) };
    }
  }

  /**
   * `checkout.session.completed` (P-3a SA Q-1): link the session's
   * subscription AND clear the checkout lock, by COMPARE-AND-SET.
   *
   * Succeeds only while the row still holds THIS session's lock and has no
   * subscription yet. `linked: false` means either already done (a replay, or
   * `invoice.paid` linked it first) or the row holds another subscription;
   * the caller then clears the lock alone (`releaseCheckoutLock`). A unique
   * violation (another account's row holds the subscription) is an error with
   * an alert, never a returned row.
   */
  async linkCheckoutSession(input: {
    userId: string;
    livemode: boolean;
    sessionId: string;
    stripeSubscriptionId: string;
    nowIso: string;
  }): Promise<RepositoryResult<{ linked: boolean }>> {
    const { userId, livemode, sessionId, stripeSubscriptionId, nowIso } = input;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof sessionId !== 'string' ||
      !CHECKOUT_SESSION_ID_PATTERN.test(sessionId) ||
      typeof stripeSubscriptionId !== 'string' ||
      !SUBSCRIPTION_ID_PATTERN.test(stripeSubscriptionId) ||
      !isFilterSafeIso(nowIso)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'linkCheckoutSession', userId, livemode });

    try {
      const { error, count } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .update(
          {
            stripe_subscription_id: stripeSubscriptionId,
            open_checkout_session_id: null,
            open_checkout_expires_at: null,
            updated_at: nowIso,
          },
          { count: 'exact' }
        )
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .eq('open_checkout_session_id', sessionId)
        .is('stripe_subscription_id', null);
      if (error) {
        if (sqlStateOf(error) === UNIQUE_VIOLATION) {
          methodLogger.error(
            { sessionId, stripeSubscriptionId, alert: true },
            'Stripe subscription is already recorded for another account; nothing was linked'
          );
          return { data: null, error: new BillingAccountRepositoryError('stripe_subscription_held_by_another_account') };
        }
        throw asError(error);
      }
      if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
      return { data: { linked: count === 1 }, error: null };
    } catch (err) {
      methodLogger.error({ err, sessionId }, 'Failed to link the Business OS checkout session');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * Clear the checkout lock of ONE session (`checkout.session.expired`, or a
   * completed session whose subscription is not linked here), by
   * COMPARE-AND-SET on the session id: another session's lock is never
   * cleared. `released: false` means the lock was already gone or belongs to
   * another session.
   */
  async releaseCheckoutLock(input: {
    userId: string;
    livemode: boolean;
    sessionId: string;
    nowIso: string;
  }): Promise<RepositoryResult<{ released: boolean }>> {
    const { userId, livemode, sessionId, nowIso } = input;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof sessionId !== 'string' ||
      !CHECKOUT_SESSION_ID_PATTERN.test(sessionId) ||
      !isFilterSafeIso(nowIso)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'releaseCheckoutLock', userId, livemode });

    try {
      const { error, count } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .update({ open_checkout_session_id: null, open_checkout_expires_at: null, updated_at: nowIso }, { count: 'exact' })
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .eq('open_checkout_session_id', sessionId);
      if (error) throw asError(error);
      if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
      return { data: { released: count === 1 }, error: null };
    } catch (err) {
      methodLogger.error({ err, sessionId }, 'Failed to clear the Business OS checkout lock');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * SA Q-1: the status-only subscription mirror (`customer.subscription.updated`
   * / `.deleted`). The caller passes what Stripe says NOW (read fresh), so
   * event order does not matter. Writes exactly `subscription_status`,
   * `cancel_at_period_end` and `ended_at`, compare-and-set on the row still
   * holding this subscription. Never `current_period_end`: only a paid
   * invoice moves that. `mirrored: false` means the row no longer holds it.
   */
  async mirrorSubscriptionState(input: {
    userId: string;
    livemode: boolean;
    stripeSubscriptionId: string;
    status: BusinessOsSubscriptionStatus;
    cancelAtPeriodEnd: boolean;
    endedAtIso: string | null;
    nowIso: string;
  }): Promise<RepositoryResult<{ mirrored: boolean }>> {
    const { userId, livemode, stripeSubscriptionId, cancelAtPeriodEnd, endedAtIso, nowIso } = input;
    const subscriptionStatus = input.status;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof stripeSubscriptionId !== 'string' ||
      !SUBSCRIPTION_ID_PATTERN.test(stripeSubscriptionId) ||
      !SUBSCRIPTION_STATUSES.includes(subscriptionStatus) ||
      typeof cancelAtPeriodEnd !== 'boolean' ||
      !(endedAtIso === null || isFilterSafeIso(endedAtIso)) ||
      !isFilterSafeIso(nowIso)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'mirrorSubscriptionState', userId, livemode });

    try {
      const { error, count } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .update(
          {
            subscription_status: subscriptionStatus,
            cancel_at_period_end: cancelAtPeriodEnd,
            ended_at: endedAtIso,
            updated_at: nowIso,
          },
          { count: 'exact' }
        )
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .eq('stripe_subscription_id', stripeSubscriptionId);
      if (error) throw asError(error);
      if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
      return { data: { mirrored: count === 1 }, error: null };
    } catch (err) {
      methodLogger.error({ err, stripeSubscriptionId }, 'Failed to mirror the Business OS subscription state');
      return { data: null, error: asError(err) };
    }
  }

  // ── P-6a.2: renewal failures and their cure (§5.3, §5.4; SA C-1, C-2) ──────

  /**
   * `invoice.payment_failed` on a RENEWAL invoice (the caller decides that, U-10):
   * count the attempt on the row holding this subscription. Read, decide
   * (`decideRenewalFailure`), compare-and-set. `concurrent_change` (an error)
   * means two rounds lost to concurrent writes: the caller releases the claim
   * and Stripe retries.
   */
  async recordRenewalFailure(input: RenewalFailureInput): Promise<RepositoryResult<RenewalFailureWriteResult>> {
    return this.writeRenewalFailure(input, false);
  }

  /**
   * `invoice.payment_action_required` on a RENEWAL invoice (3-D Secure, SA-P8:
   * treated as failed): the same decision, and the hosted invoice URL is stored
   * when it is a Stripe-hosted page. The URL is never logged here.
   */
  async recordActionRequired(input: RenewalFailureInput): Promise<RepositoryResult<RenewalFailureWriteResult>> {
    return this.writeRenewalFailure(input, true);
  }

  private async writeRenewalFailure(
    input: RenewalFailureInput,
    actionRequired: boolean
  ): Promise<RepositoryResult<RenewalFailureWriteResult>> {
    const { userId, livemode, stripeSubscriptionId, invoiceId, periodEndIso, attemptCount, failedAtIso, hostedInvoiceUrl, nowIso } = input;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof stripeSubscriptionId !== 'string' ||
      !SUBSCRIPTION_ID_PATTERN.test(stripeSubscriptionId) ||
      typeof invoiceId !== 'string' ||
      !INVOICE_ID_PATTERN.test(invoiceId) ||
      !isFilterSafeIso(periodEndIso) ||
      !isFilterSafeIso(failedAtIso) ||
      typeof attemptCount !== 'number' ||
      !Number.isSafeInteger(attemptCount) ||
      attemptCount < 0 ||
      !(hostedInvoiceUrl === null || typeof hostedInvoiceUrl === 'string') ||
      !isFilterSafeIso(nowIso)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const method = actionRequired ? 'recordActionRequired' : 'recordRenewalFailure';
    // Ids only: never the hosted URL (a bearer link to the owner's invoice).
    const methodLogger = this.logger.child({ method, userId, livemode, stripeSubscriptionId, invoiceId });
    const facts: RenewalFailureFacts = {
      stripeSubscriptionId,
      invoiceId,
      periodEndIso,
      attemptCount,
      failedAtIso,
      hostedInvoiceUrl,
      actionRequired,
    };

    try {
      for (let round = 0; round < CAS_ROUNDS; round += 1) {
        const read = await this.findByUser(userId, livemode);
        if (read.error) return { data: null, error: read.error };
        const row = read.data;
        const decision = decideRenewalFailure(row, facts);
        if (decision.kind === 'moot') return { data: { outcome: 'moot', reason: decision.reason }, error: null };
        if (decision.kind === 'unchanged' || !row) return { data: { outcome: 'unchanged' }, error: null };

        const base = this.supabase
          .from(BOS_BILLING_ACCOUNTS_TABLE)
          .update(
            {
              failed_attempts: decision.failedAttempts,
              last_payment_failed_at: decision.lastPaymentFailedAt,
              action_required_invoice_url: decision.actionRequiredInvoiceUrl,
              updated_at: nowIso,
            },
            { count: 'exact' }
          )
          .eq('user_id', userId)
          .eq('livemode', livemode)
          .eq('stripe_subscription_id', stripeSubscriptionId)
          .eq('failed_attempts', row.failedAttempts);
        // The compare-and-set: every value the decision read, exactly as read.
        const withPeriod = row.currentPeriodEnd === null ? base.is('current_period_end', null) : base.eq('current_period_end', row.currentPeriodEnd);
        const withInvoice = row.lastInvoiceId === null ? withPeriod.is('last_invoice_id', null) : withPeriod.eq('last_invoice_id', row.lastInvoiceId);
        const withUrl =
          row.actionRequiredInvoiceUrl === null
            ? withInvoice.is('action_required_invoice_url', null)
            : withInvoice.eq('action_required_invoice_url', row.actionRequiredInvoiceUrl);
        const query =
          row.lastPaymentFailedAt === null
            ? withUrl.is('last_payment_failed_at', null)
            : withUrl.eq('last_payment_failed_at', row.lastPaymentFailedAt);

        const { error, count } = await query;
        if (error) throw asError(error);
        if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
        if (count === 1) {
          return {
            data: {
              outcome: 'recorded',
              failedAttempts: decision.failedAttempts,
              actionRequiredUrlStored: decision.actionRequiredInvoiceUrl !== null,
            },
            error: null,
          };
        }
        methodLogger.warn({ round }, 'Business OS billing row changed while recording a renewal failure; re-reading');
      }
      return { data: null, error: new BillingAccountRepositoryError('concurrent_change') };
    } catch (err) {
      methodLogger.error({ err }, 'Failed to record the Business OS renewal failure');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * A paid plan invoice (any `applied` / `recorded` / replayed apply): clear the
   * failure marker when the paid invoice is the newest (`decideRenewalCure`),
   * by compare-and-set. `last_payment_failed_at` is kept (the date P-8a shows).
   * Two lost rounds is a `concurrent_change` error; the caller logs it and
   * never throws (the money is already committed).
   */
  async clearRenewalFailure(input: {
    userId: string;
    livemode: boolean;
    stripeSubscriptionId: string;
    /** `P` of the PAID invoice (its line period end). */
    paidPeriodEndIso: string;
    nowIso: string;
  }): Promise<RepositoryResult<RenewalCureResult>> {
    const { userId, livemode, stripeSubscriptionId, paidPeriodEndIso, nowIso } = input;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof stripeSubscriptionId !== 'string' ||
      !SUBSCRIPTION_ID_PATTERN.test(stripeSubscriptionId) ||
      !isFilterSafeIso(paidPeriodEndIso) ||
      !isFilterSafeIso(nowIso)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'clearRenewalFailure', userId, livemode, stripeSubscriptionId });

    try {
      for (let round = 0; round < CAS_ROUNDS; round += 1) {
        const read = await this.findByUser(userId, livemode);
        if (read.error) return { data: null, error: read.error };
        const row = read.data;
        const decision = decideRenewalCure(row, { stripeSubscriptionId, paidPeriodEndIso });
        if (decision.kind === 'nothing' || !row || row.currentPeriodEnd === null) {
          return { data: { outcome: 'nothing', reason: decision.kind === 'nothing' ? decision.reason : 'no_row' }, error: null };
        }

        const base = this.supabase
          .from(BOS_BILLING_ACCOUNTS_TABLE)
          .update({ failed_attempts: 0, action_required_invoice_url: null, updated_at: nowIso }, { count: 'exact' })
          .eq('user_id', userId)
          .eq('livemode', livemode)
          .eq('stripe_subscription_id', stripeSubscriptionId)
          .eq('failed_attempts', row.failedAttempts)
          .eq('current_period_end', row.currentPeriodEnd);
        const query =
          row.actionRequiredInvoiceUrl === null
            ? base.is('action_required_invoice_url', null)
            : base.eq('action_required_invoice_url', row.actionRequiredInvoiceUrl);

        const { error, count } = await query;
        if (error) throw asError(error);
        if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
        if (count === 1) return { data: { outcome: 'cleared' }, error: null };
        methodLogger.warn({ round }, 'Business OS billing row changed while clearing a renewal failure; re-reading');
      }
      return { data: null, error: new BillingAccountRepositoryError('concurrent_change') };
    } catch (err) {
      methodLogger.error({ err }, 'Failed to clear the Business OS renewal failure');
      return { data: null, error: asError(err) };
    }
  }

  // ── D4b: the plan-ends reminder record (workplan §3.4, §3.5; SA S-3, DR-3, R-D) ──

  /**
   * ⟨unscoped-by-design⟩ The reminder cron's claim (durable-queue-drain; the
   * `PluginConnectionRepository` precedent for cron methods that act across
   * accounts by row). A cron has no session, so no `user_id` filter: the RPC
   * leases up to `batch` rows in ONE mode whose plan is set to end within
   * `windowSeconds`, that have no reminder for that period end, no live lease
   * and no open account closure (DR-2), FOR UPDATE SKIP LOCKED, so two
   * overlapping runs never lease the same row. A lease older than
   * `leaseSeconds` is dead (S-3 a). Every id the caller then acts on comes from
   * the returned row, never from input (tenant-isolation-guard Step 6).
   *
   * An unreadable row makes the whole answer an error, never a guessed row;
   * the rows stay leased until the lease expires.
   */
  async claimCancelReminders(input: {
    runnerId: string;
    livemode: boolean;
    windowSeconds: number;
    leaseSeconds: number;
    batch: number;
  }): Promise<RepositoryResult<CancelReminderClaim[]>> {
    const { runnerId, livemode, windowSeconds, leaseSeconds, batch } = input;
    if (
      typeof runnerId !== 'string' ||
      !UUID_PATTERN.test(runnerId) ||
      typeof livemode !== 'boolean' ||
      !isBoundedInteger(windowSeconds, 1, 864_000) ||
      !isBoundedInteger(leaseSeconds, 1, 3_600) ||
      !isBoundedInteger(batch, 1, 100)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'claimCancelReminders', runnerId, livemode });

    try {
      const { data, error } = await this.supabase.rpc(CLAIM_CANCEL_REMINDERS_RPC, {
        p_runner: runnerId,
        p_livemode: livemode,
        p_window_seconds: windowSeconds,
        p_lease_seconds: leaseSeconds,
        p_batch: batch,
      });
      if (error) throw asError(error);
      if (data === null || data === undefined) return { data: [], error: null };
      if (!Array.isArray(data)) throw new BillingAccountRepositoryError('unreadable_claim');
      const rows = data.map((row) => mapReminderClaim(row as Record<string, unknown>));
      if (rows.length > batch || rows.some((row) => row.livemode !== livemode)) {
        throw new BillingAccountRepositoryError('unexpected_claim');
      }
      return { data: rows, error: null };
    } catch (err) {
      // SA code review F-4: an unreadable claimed row fails the whole batch, so an operator must look.
      methodLogger.error({ err, alert: true }, 'Failed to claim Business OS plan-ends reminders');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ The reminder for this period end went out (or its
   * outcome is unknown, S-3 b / DR-5: at most once): record the period end and
   * drop the lease. A compare-and-set on the row id + THIS runner + the row's
   * own `user_id` and `livemode`, so a lost lease writes nothing
   * (`completed: false`). `{ count: 'exact' }`, no `.select()`, no `.or()`.
   */
  async completeCancelReminder(input: {
    id: string;
    userId: string;
    livemode: boolean;
    runnerId: string;
    periodEnd: string;
  }): Promise<RepositoryResult<{ completed: boolean }>> {
    const { id, userId, livemode, runnerId, periodEnd } = input;
    if (
      typeof id !== 'string' ||
      !UUID_PATTERN.test(id) ||
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof runnerId !== 'string' ||
      !UUID_PATTERN.test(runnerId) ||
      !isFilterSafeIso(periodEnd)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'completeCancelReminder', billingAccountId: id, userId, livemode });

    try {
      const { error, count } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .update(
          { cancel_reminder_sent_for: periodEnd, cancel_reminder_claimed_by: null, cancel_reminder_claimed_at: null },
          { count: 'exact' }
        )
        .eq('id', id)
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .eq('cancel_reminder_claimed_by', runnerId);
      if (error) throw asError(error);
      if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
      return { data: { completed: count === 1 }, error: null };
    } catch (err) {
      methodLogger.error({ err }, 'Failed to record the Business OS plan-ends reminder');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * ⟨unscoped-by-design⟩ The reminder did not go (not sent, not cancelling any
   * more, a mismatch, or the run ran out of time): drop the lease only, so a
   * later run may take the row again while it is still inside the window. The
   * same compare-and-set as `completeCancelReminder`. `{ count: 'exact' }`, no
   * `.select()`, no `.or()`.
   */
  async releaseCancelReminder(input: {
    id: string;
    userId: string;
    livemode: boolean;
    runnerId: string;
  }): Promise<RepositoryResult<{ released: boolean }>> {
    const { id, userId, livemode, runnerId } = input;
    if (
      typeof id !== 'string' ||
      !UUID_PATTERN.test(id) ||
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof runnerId !== 'string' ||
      !UUID_PATTERN.test(runnerId)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'releaseCancelReminder', billingAccountId: id, userId, livemode });

    try {
      const { error, count } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .update({ cancel_reminder_claimed_by: null, cancel_reminder_claimed_at: null }, { count: 'exact' })
        .eq('id', id)
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .eq('cancel_reminder_claimed_by', runnerId);
      if (error) throw asError(error);
      if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
      return { data: { released: count === 1 }, error: null };
    } catch (err) {
      methodLogger.error({ err }, 'Failed to release the Business OS plan-ends reminder lease');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * SA R-D (user U-3): the owner cancelled inside the last 3 days and the
   * "Plan cancelled" email (outcome sent or unknown) already gave the date, so
   * no reminder follows. User-scoped (the SESSION user from the cancel route):
   * a compare-and-set on `user_id` + `livemode` + the subscription + this
   * period end + still set to end. `marked: false` means the row moved on
   * (another subscription or period, or no longer cancelling). It records the
   * period end only and leaves any lease alone. `{ count: 'exact' }`, no
   * `.select()`, no `.or()`.
   */
  async markCancelReminderCovered(input: {
    userId: string;
    livemode: boolean;
    stripeSubscriptionId: string;
    periodEnd: string;
  }): Promise<RepositoryResult<{ marked: boolean }>> {
    const { userId, livemode, stripeSubscriptionId, periodEnd } = input;
    if (
      typeof userId !== 'string' ||
      !UUID_PATTERN.test(userId) ||
      typeof livemode !== 'boolean' ||
      typeof stripeSubscriptionId !== 'string' ||
      !SUBSCRIPTION_ID_PATTERN.test(stripeSubscriptionId) ||
      !isFilterSafeIso(periodEnd)
    ) {
      return { data: null, error: new BillingAccountRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'markCancelReminderCovered', userId, livemode, stripeSubscriptionId });

    try {
      const { error, count } = await this.supabase
        .from(BOS_BILLING_ACCOUNTS_TABLE)
        .update({ cancel_reminder_sent_for: periodEnd }, { count: 'exact' })
        .eq('user_id', userId)
        .eq('livemode', livemode)
        .eq('stripe_subscription_id', stripeSubscriptionId)
        .eq('current_period_end', periodEnd)
        .eq('cancel_at_period_end', true);
      if (error) throw asError(error);
      if (count !== 0 && count !== 1) throw new BillingAccountRepositoryError('unexpected_update_count');
      return { data: { marked: count === 1 }, error: null };
    } catch (err) {
      methodLogger.error({ err }, 'Failed to mark the Business OS plan-ends reminder as covered');
      return { data: null, error: asError(err) };
    }
  }
}

/** What the renewal-failure writes take. Every value is server-derived (our row, Stripe's invoice). */
export interface RenewalFailureInput {
  userId: string;
  livemode: boolean;
  stripeSubscriptionId: string;
  invoiceId: string;
  /** `P` (see `RenewalFailureFacts`). */
  periodEndIso: string;
  attemptCount: number;
  /** `event.created`, display only. */
  failedAtIso: string;
  hostedInvoiceUrl: string | null;
  nowIso: string;
}

/** D4b: the one RPC this repository calls (migration 20261100). */
export const CLAIM_CANCEL_REMINDERS_RPC = 'claim_bos_plan_cancel_reminders';

/** One leased reminder row, as the claim returns it. Every id the reminder acts on comes from here. */
export interface CancelReminderClaim {
  id: string;
  /** The row's `user_id`: the account (not null: the claim leaves detached rows out). */
  userId: string;
  livemode: boolean;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  /** Canonical ISO (`toISOString()`), so it can be compared and written back by compare-and-set. */
  currentPeriodEnd: string;
  /** The period end a reminder was last recorded for, canonical ISO, or `null`. */
  cancelReminderSentFor: string | null;
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Postgres prints `+00:00`; the compare-and-set writes and compares the canonical ISO form. */
function canonicalTimestamp(value: unknown): string {
  return new Date(timestamp(value)).toISOString();
}

function mapReminderClaim(raw: Record<string, unknown>): CancelReminderClaim {
  const stripeSubscriptionId = text(raw.reminder_subscription_id);
  if (!SUBSCRIPTION_ID_PATTERN.test(stripeSubscriptionId)) throw new BillingAccountRepositoryError('unreadable_subscription_id');
  const stripeCustomerId = text(raw.reminder_customer_id);
  if (!CUSTOMER_ID_PATTERN.test(stripeCustomerId)) throw new BillingAccountRepositoryError('unreadable_customer_id');
  return {
    id: uuid(raw.reminder_row_id),
    userId: uuid(raw.reminder_user_id),
    livemode: bool(raw.reminder_livemode),
    stripeSubscriptionId,
    stripeCustomerId,
    currentPeriodEnd: canonicalTimestamp(raw.reminder_period_end),
    cancelReminderSentFor: raw.reminder_sent_for === null ? null : canonicalTimestamp(raw.reminder_sent_for),
  };
}

// Singleton on the service-role client (see the header for why).
export const businessOsBillingAccountRepository = new BusinessOsBillingAccountRepository();

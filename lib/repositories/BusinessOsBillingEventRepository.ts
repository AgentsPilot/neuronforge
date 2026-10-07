// lib/repositories/BusinessOsBillingEventRepository.ts
//
// Data access for the Business OS money history `business_os_billing_events`
// and the plan payment apply function `business_os_apply_plan_payment`.
//
// Schema:   supabase/migrations/20261027_business_os_billing_events.sql
// Workplan: docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P3B_WORKPLAN.md §3.2, §4
//           (SA review: Q-10, Q-11, C-1 to C-4)
//
// ── SCOPE ───────────────────────────────────────────────────────────────────
// P-3b.1 ships two methods and no caller: `applyPlanPayment` (the RPC, with a
// strictly mapped result) and `recordEvent` (one append-only row for the money
// events the function does not write: a refused payment with no account, a
// failed payment). The webhook handler that calls them is P-3b.2. There is no
// UPDATE and no DELETE grant on the table, so there is no update or delete
// method: the history is append-only (SA-P5).
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// The table has RLS on, NO policy and NO client grant (SA-P5): owners will read
// their invoices through routes (P-7a). So this repository runs on
// `supabaseServer`. The account id it receives is always taken from our own
// billing record by the server (tenant-isolation-guard; workplan §3.3), never
// from Stripe metadata and never from request input. The apply function itself
// re-locks the billing row by that user id and re-checks the customer and the
// subscription, so a wrong id cannot move another account's plan.
//
// ── NO ROW CAN BE FORGED ────────────────────────────────────────────────────
// The insert payload is an explicit allow-list built field by field (no spread
// of the input, no `id`, no `created_at`, no `plan_written`, which only the
// function sets). Every Stripe id is shape-checked here before the query, as
// the migration's CHECKs do after it.
//
// CALLERS: none yet (P-3b.2 adds the webhook use case). A source guard in
// `lib/repositories/__tests__/BusinessOsBillingEventRepository.test.ts` holds
// the exact list of files allowed to name this repository, so the first
// caller is a reviewed change. Deliberately NOT exported from
// `lib/repositories/index.ts`, for the same reason as the billing account
// repository: a barrel export would let any file reach it unseen.
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';
import type { BusinessOsSubscriptionStatus } from './BusinessOsBillingAccountRepository';

export const BOS_BILLING_EVENTS_TABLE = 'business_os_billing_events';
export const BOS_APPLY_PLAN_PAYMENT_RPC = 'business_os_apply_plan_payment';

/** The table's columns, in migration order. The migration test pins this list. */
export const BILLING_EVENT_COLUMNS =
  'id, user_id, livemode, kind, stripe_event_id, stripe_invoice_id, stripe_subscription_id, stripe_customer_id, tier, plan_written, refusal_reason, amount_minor, amount_tax_minor, currency, period_start, period_end, paid_at, created_at';

/** SA-P5: the full v1 set, as the migration's `kind_known` CHECK admits it. The migration test pins this list. */
export const BILLING_EVENT_KINDS = [
  'invoice_paid',
  'invoice_payment_failed',
  'payment_action_required',
  'subscription_updated',
  'subscription_ended',
  'refunded',
  'dispute_opened',
  'dispute_closed',
  'mismatch_refused',
] as const;

export type BusinessOsBillingEventKind = (typeof BILLING_EVENT_KINDS)[number];

/**
 * The kinds `recordEvent` may write. `invoice_paid` is written ONLY by the apply
 * function, inside the same transaction as the plan row (SA-P3 b), so a paid
 * row can never exist without the plan decision that goes with it.
 */
export type BusinessOsRecordableEventKind = Exclude<BusinessOsBillingEventKind, 'invoice_paid'>;

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

/** What the webhook (P-3b.2) or the reconciler (P-8b) hands the apply function. */
export interface BusinessOsApplyPlanPaymentInput {
  /** Taken from OUR billing row, found by a UNIQUE Stripe id + livemode (SR-8). Never from metadata. */
  accountId: string;
  livemode: boolean;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  /** Set only when the handler proved, at Stripe, that the row's old subscription ended. */
  replacesSubscriptionId: string | null;
  /** NULL only for the reconciler, which has no event (P-8b). */
  stripeEventId: string | null;
  stripeInvoiceId: string;
  tier: string;
  planVersion: number;
  /** SA-P8 / SA-P16c: a paid amount, or a discounted cycle invoice. A $0 trial invoice is false. */
  assignsPlan: boolean;
  amountMinor: number;
  amountTaxMinor: number;
  /** SA-P15: USD only; the function refuses anything else with 22023. */
  currency: 'usd';
  periodStart: string;
  periodEnd: string;
  paidAt: string;
  billingCycleAnchor: string;
  subscriptionStatus: BusinessOsSubscriptionStatus;
}

/** The function's answer (§3.2), mapped. */
export type BusinessOsApplyPlanPaymentResult =
  | {
      status: 'applied' | 'recorded';
      eventRowId: string;
      tierBefore: string | null;
      tierAfter: string | null;
      planWritten: boolean;
      anchorSet: boolean;
    }
  /** The invoice was applied before (any event); `eventRowId` is that row. */
  | { status: 'already_applied'; eventRowId: string }
  /** C-2: this event id was recorded before (a refusal resent); nothing was written. */
  | { status: 'already_recorded'; eventRowId: string }
  /** SA-P14 layer 2 / C-1: one refusal row (null when the event id was already taken). */
  | { status: 'subscription_conflict'; eventRowId: string | null }
  | { status: 'billing_row_missing' | 'customer_mismatch' | 'plan_row_missing' };

/** One append-only row the function does not write (refusals with no account, failed payments). */
export interface BusinessOsBillingEventInput {
  /** NULL only for a payment no account could be found for (`unknown_customer`). */
  accountId: string | null;
  livemode: boolean;
  kind: BusinessOsRecordableEventKind;
  stripeEventId: string | null;
  stripeInvoiceId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  tier?: string | null;
  /** Required exactly when `kind` is `mismatch_refused` (the table's pair CHECK). */
  refusalReason?: string | null;
  amountMinor?: number | null;
  amountTaxMinor?: number | null;
  /** USD or nothing: a non-USD refusal records the currency as NULL (the CHECK). */
  currency?: 'usd' | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  paidAt?: string | null;
}

export type BusinessOsBillingEventRecordResult =
  | { outcome: 'recorded'; eventRowId: string }
  /** The event id is already in the history: a webhook redelivery. Not an error. */
  | { outcome: 'duplicate' };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CUSTOMER_ID_PATTERN = /^cus_[A-Za-z0-9]{1,251}$/;
const SUBSCRIPTION_ID_PATTERN = /^sub_[A-Za-z0-9]{1,251}$/;
const INVOICE_ID_PATTERN = /^in_[A-Za-z0-9]{1,252}$/;
const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]{1,251}$/;
const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const UNIQUE_VIOLATION = '23505';
/** The event-id UNIQUE constraint; a 23505 on any other key is a real error. */
const EVENT_ID_KEY = 'business_os_billing_events_stripe_event_id_key';

class BillingEventRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingEventRepositoryError';
  }
}

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function textOf(error: unknown, key: 'message' | 'details'): string {
  if (typeof error === 'object' && error !== null && key in error) {
    const value = (error as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : '';
  }
  return '';
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  const wrapped = new BillingEventRepositoryError(textOf(error, 'message') || 'billing_event_query_failed');
  const code = sqlStateOf(error);
  if (code) Object.assign(wrapped, { code });
  return wrapped;
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function isMinorAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
}

function isTier(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 64;
}

function optional<T>(value: T | null | undefined, check: (candidate: unknown) => boolean): boolean {
  return value === null || value === undefined || check(value);
}

function matches(pattern: RegExp): (value: unknown) => boolean {
  return (value) => typeof value === 'string' && pattern.test(value);
}

/** Exactly one row, or the function broke its contract. */
function singleRow(data: unknown): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || typeof data[0] !== 'object' || data[0] === null) {
    throw new BillingEventRepositoryError('unexpected_rpc_result');
  }
  return data[0] as Record<string, unknown>;
}

function uuidOf(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new BillingEventRepositoryError('unreadable_id');
  return value;
}

function nullableTier(value: unknown): string | null {
  if (value === null) return null;
  if (!isTier(value)) throw new BillingEventRepositoryError('unreadable_tier');
  return value;
}

function boolOf(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BillingEventRepositoryError('unreadable_boolean');
  return value;
}

function validApplyInput(input: BusinessOsApplyPlanPaymentInput): boolean {
  if (typeof input !== 'object' || input === null) return false;
  return (
    matches(UUID_PATTERN)(input.accountId) &&
    typeof input.livemode === 'boolean' &&
    matches(CUSTOMER_ID_PATTERN)(input.stripeCustomerId) &&
    matches(SUBSCRIPTION_ID_PATTERN)(input.stripeSubscriptionId) &&
    optional(input.replacesSubscriptionId, matches(SUBSCRIPTION_ID_PATTERN)) &&
    input.replacesSubscriptionId !== input.stripeSubscriptionId &&
    optional(input.stripeEventId, matches(EVENT_ID_PATTERN)) &&
    matches(INVOICE_ID_PATTERN)(input.stripeInvoiceId) &&
    isTier(input.tier) &&
    typeof input.planVersion === 'number' &&
    Number.isSafeInteger(input.planVersion) &&
    input.planVersion >= 1 &&
    typeof input.assignsPlan === 'boolean' &&
    isMinorAmount(input.amountMinor) &&
    isMinorAmount(input.amountTaxMinor) &&
    input.currency === 'usd' &&
    isIso(input.periodStart) &&
    isIso(input.periodEnd) &&
    Date.parse(input.periodEnd) > Date.parse(input.periodStart) &&
    isIso(input.paidAt) &&
    isIso(input.billingCycleAnchor) &&
    SUBSCRIPTION_STATUSES.includes(input.subscriptionStatus)
  );
}

function validEventInput(input: BusinessOsBillingEventInput): boolean {
  if (typeof input !== 'object' || input === null) return false;
  const kinds: readonly string[] = BILLING_EVENT_KINDS;
  const refused = input.kind === 'mismatch_refused';
  return (
    optional(input.accountId, matches(UUID_PATTERN)) &&
    typeof input.livemode === 'boolean' &&
    kinds.includes(input.kind) &&
    input.kind !== ('invoice_paid' as BusinessOsBillingEventKind) &&
    optional(input.stripeEventId, matches(EVENT_ID_PATTERN)) &&
    optional(input.stripeInvoiceId, matches(INVOICE_ID_PATTERN)) &&
    optional(input.stripeSubscriptionId, matches(SUBSCRIPTION_ID_PATTERN)) &&
    optional(input.stripeCustomerId, matches(CUSTOMER_ID_PATTERN)) &&
    optional(input.tier, isTier) &&
    (refused ? matches(CODE_PATTERN)(input.refusalReason) : input.refusalReason === null || input.refusalReason === undefined) &&
    optional(input.amountMinor, isMinorAmount) &&
    optional(input.amountTaxMinor, isMinorAmount) &&
    (input.currency === null || input.currency === undefined || input.currency === 'usd') &&
    optional(input.periodStart, isIso) &&
    optional(input.periodEnd, isIso) &&
    (!input.periodStart || !input.periodEnd || Date.parse(input.periodEnd) > Date.parse(input.periodStart)) &&
    optional(input.paidAt, isIso)
  );
}

export class BusinessOsBillingEventRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsBillingEventRepository' });
  }

  /**
   * Apply one paid plan invoice through `business_os_apply_plan_payment`
   * (one transaction: money history row, plan row, billing row).
   *
   * Every refusal the function returns is DATA here (`status`), never an
   * error: the caller decides what each means (P-3b.2 throws on
   * `plan_row_missing`, Q-3). An `error` means the call itself failed (input
   * refused before the query, the database unavailable, or a raised 22004 /
   * 22023 / unique violation), and the caller treats that as "could not tell".
   */
  async applyPlanPayment(input: BusinessOsApplyPlanPaymentInput): Promise<RepositoryResult<BusinessOsApplyPlanPaymentResult>> {
    const ids = {
      accountId: input?.accountId,
      livemode: input?.livemode,
      stripeInvoiceId: input?.stripeInvoiceId,
      stripeEventId: input?.stripeEventId,
    };
    if (!validApplyInput(input)) {
      return { data: null, error: new BillingEventRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'applyPlanPayment', ...ids });

    try {
      // Explicit argument list: every value named, none spread from the input.
      const { data, error } = await this.supabase.rpc(BOS_APPLY_PLAN_PAYMENT_RPC, {
        p_user_id: input.accountId,
        p_livemode: input.livemode,
        p_stripe_customer_id: input.stripeCustomerId,
        p_stripe_subscription_id: input.stripeSubscriptionId,
        p_replaces_subscription_id: input.replacesSubscriptionId,
        p_stripe_event_id: input.stripeEventId,
        p_stripe_invoice_id: input.stripeInvoiceId,
        p_tier: input.tier,
        p_plan_version: input.planVersion,
        p_assigns_plan: input.assignsPlan,
        p_amount_minor: input.amountMinor,
        p_amount_tax_minor: input.amountTaxMinor,
        p_currency: input.currency,
        p_period_start: input.periodStart,
        p_period_end: input.periodEnd,
        p_paid_at: input.paidAt,
        p_billing_cycle_anchor: input.billingCycleAnchor,
        p_subscription_status: input.subscriptionStatus,
      });
      if (error) throw asError(error);

      const row = singleRow(data);
      const result = mapApplyResult(row);
      methodLogger.info({ status: result.status }, 'Business OS plan payment apply answered');
      return { data: result, error: null };
    } catch (err) {
      methodLogger.error({ err, sqlstate: sqlStateOf(err) }, 'Business OS plan payment apply failed');
      return { data: null, error: asError(err) };
    }
  }

  /**
   * Record one money event the apply function does not write.
   *
   * A unique violation on the EVENT ID is a redelivery and answers
   * `duplicate` (not an error). A unique violation on anything else, or any
   * other failure, is an error.
   */
  async recordEvent(input: BusinessOsBillingEventInput): Promise<RepositoryResult<BusinessOsBillingEventRecordResult>> {
    const ids = { accountId: input?.accountId, livemode: input?.livemode, kind: input?.kind, stripeEventId: input?.stripeEventId };
    if (!validEventInput(input)) {
      return { data: null, error: new BillingEventRepositoryError('invalid_input') };
    }
    const methodLogger = this.logger.child({ method: 'recordEvent', ...ids });

    try {
      // Explicit allow-list (tenant-isolation-guard Step 3): never a spread of
      // the input. `plan_written` is left to its default (false): only the
      // apply function writes a row that moved the plan.
      const { data, error } = await this.supabase
        .from(BOS_BILLING_EVENTS_TABLE)
        .insert({
          user_id: input.accountId,
          livemode: input.livemode,
          kind: input.kind,
          stripe_event_id: input.stripeEventId,
          stripe_invoice_id: input.stripeInvoiceId ?? null,
          stripe_subscription_id: input.stripeSubscriptionId ?? null,
          stripe_customer_id: input.stripeCustomerId ?? null,
          tier: input.tier ?? null,
          refusal_reason: input.kind === 'mismatch_refused' ? input.refusalReason : null,
          amount_minor: input.amountMinor ?? null,
          amount_tax_minor: input.amountTaxMinor ?? null,
          currency: input.currency ?? null,
          period_start: input.periodStart ?? null,
          period_end: input.periodEnd ?? null,
          paid_at: input.paidAt ?? null,
        })
        .select('id')
        .single();

      if (error) {
        const onEventId =
          sqlStateOf(error) === UNIQUE_VIOLATION &&
          (textOf(error, 'message').includes(EVENT_ID_KEY) || textOf(error, 'details').includes('stripe_event_id'));
        if (onEventId) {
          methodLogger.info('Business OS money event already recorded for this Stripe event');
          return { data: { outcome: 'duplicate' }, error: null };
        }
        throw asError(error);
      }

      const eventRowId = uuidOf((data as { id?: unknown } | null)?.id);
      methodLogger.info({ eventRowId }, 'Business OS money event recorded');
      return { data: { outcome: 'recorded', eventRowId }, error: null };
    } catch (err) {
      methodLogger.error({ err, sqlstate: sqlStateOf(err) }, 'Failed to record the Business OS money event');
      return { data: null, error: asError(err) };
    }
  }
}

/** Strict mapping of the function's one row: an unreadable answer is an error, never a guess. */
function mapApplyResult(row: Record<string, unknown>): BusinessOsApplyPlanPaymentResult {
  switch (row.out_status) {
    case 'applied':
    case 'recorded':
      return {
        status: row.out_status,
        eventRowId: uuidOf(row.out_event_row_id),
        tierBefore: nullableTier(row.out_tier_before),
        tierAfter: nullableTier(row.out_tier_after),
        planWritten: boolOf(row.out_plan_written),
        anchorSet: boolOf(row.out_anchor_set),
      };
    case 'already_applied':
    case 'already_recorded':
      return { status: row.out_status, eventRowId: uuidOf(row.out_event_row_id) };
    case 'subscription_conflict':
      return { status: 'subscription_conflict', eventRowId: row.out_event_row_id === null ? null : uuidOf(row.out_event_row_id) };
    case 'billing_row_missing':
    case 'customer_mismatch':
    case 'plan_row_missing':
      return { status: row.out_status };
    default:
      throw new BillingEventRepositoryError('unknown_apply_status');
  }
}

// Singleton on the service-role client (see the header for why).
export const businessOsBillingEventRepository = new BusinessOsBillingEventRepository();

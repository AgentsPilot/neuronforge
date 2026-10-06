// lib/repositories/BusinessOsBoostPurchaseRepository.ts
//
// Data access for Business OS boost purchases: `business_os_boost_purchases`
// (one row per attempt to buy a credit package: the cap reservation, the
// routing identity for Stripe events and the snapshot of what was sold) and
// `business_os_boost_cap_overrides` (an admin's change to one account's cap).
//
// Schema:   supabase/migrations/20261030_business_os_boost_purchases.sql
// Workplan: docs/workplans/BUSINESS_OS_CREDITS_BOOST_SLICE_2_WORKPLAN.md §3.6
//
// ── WRITTEN ONLY THROUGH RPCS ───────────────────────────────────────────────
// Nothing here inserts, updates or deletes a row directly. The database lets
// `service_role` insert only the reservation columns and update only the
// mutable ones (SA C-1), and the functions are the only intended path: they
// take the per-account boost cap lock `hashtextextended('business_os_boost_cap:'
// || user_id, 0)` (separate from the lots draw lock, R-13) and check the
// account against the row. Slice 2b adds `credit` and `transition` here.
//
// ── SERVICE ROLE (intentional RLS bypass, documented per CLAUDE.md) ─────────
// No client role can write either table or execute any function. Owners may
// SELECT their own purchases through a column list (slice 5 reads it on the
// owner's RLS client, in the owner read repository, never through this file).
// Here the account id always comes from the server-side caller (the checkout
// route's session, the admin route's path after its tenant check), never from
// request input (tenant-isolation-guard). Scoped reads add `.eq('user_id',
// accountId)` (CLAUDE.md rule 4).
//
// The two `…ForWebhook` finders are the deliberate exception (SA C-5, R-6):
// unscoped, because a Stripe event carries no account we trust. Their input
// must come from a signature-verified Stripe event, and the row they return is
// the ownership oracle: its `accountId` is the account. A source guard keeps
// them out of every file under app/ except the Stripe webhook route and the
// slice 4b reconcile cron route.
//
// No import from lib/business-os/entitlements/: callers pass plain fields
// (slice 3 maps a catalogue package into them and registers that import).
//
// Methods never throw: they return `{ data, error }`.

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import type { AgentRepositoryResult as RepositoryResult } from './types';

/** The RPC names, exported so the tests and the checker speak about one thing. */
export const BOS_RESERVE_BOOST_PURCHASE_RPC = 'business_os_reserve_boost_purchase';
export const BOS_ATTACH_BOOST_CHECKOUT_RPC = 'business_os_attach_boost_checkout';
export const BOS_ABANDON_BOOST_PURCHASE_RPC = 'business_os_abandon_boost_purchase';
export const BOS_SET_BOOST_CAP_OVERRIDE_RPC = 'business_os_set_boost_cap_override';
export const BOS_END_BOOST_CAP_OVERRIDE_RPC = 'business_os_end_boost_cap_override';

export const BOOST_PURCHASE_STATUSES = [
  'pending',
  'abandoned',
  'awaiting_payment',
  'paid',
  'failed',
  'expired',
  'flagged_mismatch',
  'partially_refunded',
  'refunded',
  'disputed',
  'dispute_lost',
] as const;
export type BusinessOsBoostPurchaseStatus = (typeof BOOST_PURCHASE_STATUSES)[number];

export interface BusinessOsBoostReservationInput {
  accountId: string;
  livemode: boolean;
  packageId: string;
  packageVersion: number;
  retailVersion: number;
  creditValueVersion: number;
  priceMinor: number;
  currency: 'USD';
  creditsBase: number;
  creditsBonus: number;
  /** From `BOOST_PURCHASE_CAP_DEFAULT` (SA Q-4). */
  defaultCapMinor: number;
  windowDays: number;
  checkoutTtlSeconds: number;
}

export type BusinessOsBoostReservationResult =
  | { outcome: 'reserved'; purchaseId: string; capMinor: number; countedMinor: number }
  | { outcome: 'cap_reached'; capMinor: number; countedMinor: number }
  | { outcome: 'no_plan_row' };

export type BusinessOsBoostAttachStatus =
  | 'attached'
  | 'already_attached'
  | 'session_conflict'
  | 'not_pending'
  | 'reservation_expired'
  | 'not_found';
export type BusinessOsBoostAbandonStatus = 'abandoned' | 'already_abandoned' | 'has_session' | 'not_pending' | 'not_found';

export interface BusinessOsBoostCapOverrideInput {
  accountId: string;
  capMinor: number;
  currency: 'USD';
  reason: string;
  actorAdminId: string;
}

export type BusinessOsBoostSetCapOverrideResult =
  | { outcome: 'set'; overrideId: string; previousOverrideId: string | null }
  | { outcome: 'no_plan_row' };

export type BusinessOsBoostEndCapOverrideResult = { outcome: 'ended'; overrideId: string } | { outcome: 'none_active' };

export interface BusinessOsBoostPurchase {
  id: string;
  /** NULL only after the account was deleted and the row detached. */
  accountId: string | null;
  livemode: boolean;
  status: BusinessOsBoostPurchaseStatus;
  packageId: string;
  packageVersion: number;
  retailVersion: number;
  creditValueVersion: number;
  priceMinor: number;
  currency: string;
  taxExclusive: boolean;
  creditsBase: number;
  creditsBonus: number;
  creditsTotal: number;
  checkoutExpiresAt: string;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeChargeId: string | null;
  receiptUrl: string | null;
  amountSubtotalMinor: number | null;
  amountTaxMinor: number | null;
  amountTotalMinor: number | null;
  amountRefundedMinor: number;
  stripeDisputeId: string | null;
  flagReason: string | null;
  lotId: string | null;
  paidAt: string | null;
  statusChangedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BusinessOsBoostCapOverride {
  id: string;
  accountId: string | null;
  capMinor: number;
  currency: string;
  reason: string;
  actorAdminId: string;
  createdAt: string;
}

export const BOOST_PURCHASE_COLUMNS =
  'id, user_id, livemode, status, package_id, package_version, retail_version, credit_value_version, price_minor, currency, tax_exclusive, credits_base, credits_bonus, credits_total, checkout_expires_at, stripe_checkout_session_id, stripe_payment_intent_id, stripe_charge_id, receipt_url, amount_subtotal_minor, amount_tax_minor, amount_total_minor, amount_refunded_minor, stripe_dispute_id, flag_reason, lot_id, paid_at, status_changed_at, created_at, updated_at';
export const BOOST_CAP_OVERRIDE_COLUMNS = 'id, user_id, cap_minor, currency, reason, actor_admin_id, created_at';

export const BOOST_PURCHASE_READ_LIMITS = {
  /** The most rows `listForAccount` returns; a request above it is clamped. */
  MAX_LIST: 200,
} as const;

const ATTACH_STATUSES: readonly BusinessOsBoostAttachStatus[] = [
  'attached',
  'already_attached',
  'session_conflict',
  'not_pending',
  'reservation_expired',
  'not_found',
];
const UNIQUE_VIOLATION = '23505';
/** QA R-7: the error `attachCheckout` returns when another purchase already holds the session (23505). */
export const BOOST_SESSION_IN_USE_ERROR = 'boost_checkout_session_in_use';
const ABANDON_STATUSES: readonly BusinessOsBoostAbandonStatus[] = ['abandoned', 'already_abandoned', 'has_session', 'not_pending', 'not_found'];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;
/** SA C-2: `boost:` plus the session id must fit the 200-character lot key. */
const MAX_SESSION_ID_LENGTH = 194;
/** SA CR-3: Stripe sessions expire within 24 h; 5 min of clock skew is allowed (the SQL bound). */
const MAX_CHECKOUT_EXPIRY_MS = (24 * 60 + 5) * 60 * 1000;

class BoostPurchaseRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BoostPurchaseRepositoryError';
  }
}

/** A `numeric` as PostgREST returns it: a JSON number or a decimal string. Anything else is an error, never 0. */
function toCredits(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && DECIMAL_PATTERN.test(value)) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  throw new BoostPurchaseRepositoryError('unreadable_figure');
}

/** An `integer` or `bigint` (PostgREST may send a bigint as a string). */
function toInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new BoostPurchaseRepositoryError('unreadable_figure');
}

function toNullableInteger(value: unknown): number | null {
  return value === null ? null : toInteger(value);
}

function toTimestamp(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new BoostPurchaseRepositoryError('unreadable_timestamp');
  return value;
}

function toNullableTimestamp(value: unknown): string | null {
  return value === null ? null : toTimestamp(value);
}

function toUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) throw new BoostPurchaseRepositoryError('unreadable_id');
  return value;
}

function toNullableUuid(value: unknown): string | null {
  return value === null ? null : toUuid(value);
}

function toText(value: unknown): string {
  if (typeof value !== 'string') throw new BoostPurchaseRepositoryError('unreadable_text');
  return value;
}

function toNullableText(value: unknown): string | null {
  return value === null ? null : toText(value);
}

function toBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new BoostPurchaseRepositoryError('unreadable_flag');
  return value;
}

function toOneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw new BoostPurchaseRepositoryError('unknown_value');
  }
  return value as T;
}

/** A set-returning RPC answers an array; exactly one row is required. */
function singleRow(data: unknown, rpc: string): Record<string, unknown> {
  if (!Array.isArray(data) || data.length !== 1 || typeof data[0] !== 'object' || data[0] === null) {
    throw new BoostPurchaseRepositoryError(`${rpc} did not return exactly one row`);
  }
  return data[0] as Record<string, unknown>;
}

function sqlStateOf(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function mapPurchase(raw: Record<string, unknown>): BusinessOsBoostPurchase {
  return {
    id: toUuid(raw.id),
    accountId: toNullableUuid(raw.user_id),
    livemode: toBoolean(raw.livemode),
    status: toOneOf(raw.status, BOOST_PURCHASE_STATUSES),
    packageId: toText(raw.package_id),
    packageVersion: toInteger(raw.package_version),
    retailVersion: toInteger(raw.retail_version),
    creditValueVersion: toInteger(raw.credit_value_version),
    priceMinor: toInteger(raw.price_minor),
    currency: toText(raw.currency),
    taxExclusive: toBoolean(raw.tax_exclusive),
    creditsBase: toCredits(raw.credits_base),
    creditsBonus: toCredits(raw.credits_bonus),
    creditsTotal: toCredits(raw.credits_total),
    checkoutExpiresAt: toTimestamp(raw.checkout_expires_at),
    stripeCheckoutSessionId: toNullableText(raw.stripe_checkout_session_id),
    stripePaymentIntentId: toNullableText(raw.stripe_payment_intent_id),
    stripeChargeId: toNullableText(raw.stripe_charge_id),
    receiptUrl: toNullableText(raw.receipt_url),
    amountSubtotalMinor: toNullableInteger(raw.amount_subtotal_minor),
    amountTaxMinor: toNullableInteger(raw.amount_tax_minor),
    amountTotalMinor: toNullableInteger(raw.amount_total_minor),
    amountRefundedMinor: toInteger(raw.amount_refunded_minor),
    stripeDisputeId: toNullableText(raw.stripe_dispute_id),
    flagReason: toNullableText(raw.flag_reason),
    lotId: toNullableUuid(raw.lot_id),
    paidAt: toNullableTimestamp(raw.paid_at),
    statusChangedAt: toTimestamp(raw.status_changed_at),
    createdAt: toTimestamp(raw.created_at),
    updatedAt: toTimestamp(raw.updated_at),
  };
}

function mapOverride(raw: Record<string, unknown>): BusinessOsBoostCapOverride {
  return {
    id: toUuid(raw.id),
    accountId: toNullableUuid(raw.user_id),
    capMinor: toInteger(raw.cap_minor),
    currency: toText(raw.currency),
    reason: toText(raw.reason),
    actorAdminId: toUuid(raw.actor_admin_id),
    createdAt: toTimestamp(raw.created_at),
  };
}

export class BusinessOsBoostPurchaseRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    // Service role by design — see the header.
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'BusinessOsBoostPurchaseRepository' });
  }

  private assertUuid(value: unknown, what: string): void {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      throw new BoostPurchaseRepositoryError(`${what} (UUID) is required`);
    }
  }

  private assertSessionId(value: unknown): void {
    if (typeof value !== 'string' || !value.startsWith('cs_') || value.length > MAX_SESSION_ID_LENGTH) {
      throw new BoostPurchaseRepositoryError('A Stripe checkout session id the table can store is required');
    }
  }

  /**
   * Logged at warn with the method, SQLSTATE, message and ids only — never the
   * error object, whose `details` can carry the failing row (an admin reason).
   * The returned error is rebuilt from the message for the same reason.
   */
  private fail<T>(method: string, error: unknown, ids: Record<string, unknown>): RepositoryResult<T> {
    const message = String((error as { message?: unknown } | null)?.message ?? error);
    this.logger.warn({ method, sqlstate: sqlStateOf(error), errorMessage: message, ...ids }, 'Boost purchase repository call failed');
    return { data: null, error: new Error(message) };
  }

  // ============ Writes (through the RPCs) ============

  /**
   * Reserve a purchase under the cap. Arguments are built field by field from
   * the typed input — never a spread — so a property the caller's object
   * happens to carry can never reach the RPC (tenant-isolation-guard Step 3).
   */
  async reserve(input: BusinessOsBoostReservationInput): Promise<RepositoryResult<BusinessOsBoostReservationResult>> {
    const method = 'reserve';
    const ids = { accountId: input?.accountId, packageId: input?.packageId, livemode: input?.livemode };
    try {
      this.assertUuid(input.accountId, 'An account id');
      const numbers = [
        input.packageVersion,
        input.retailVersion,
        input.creditValueVersion,
        input.priceMinor,
        input.creditsBase,
        input.creditsBonus,
        input.defaultCapMinor,
        input.windowDays,
        input.checkoutTtlSeconds,
      ];
      // NaN or Infinity would serialise to JSON null and reach the database as "no value".
      if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        throw new BoostPurchaseRepositoryError('Reservation figures must be finite numbers');
      }
      if (typeof input.livemode !== 'boolean') throw new BoostPurchaseRepositoryError('livemode must be a boolean');
      const args = {
        p_user_id: input.accountId,
        p_livemode: input.livemode,
        p_package_id: input.packageId,
        p_package_version: input.packageVersion,
        p_retail_version: input.retailVersion,
        p_credit_value_version: input.creditValueVersion,
        p_price_minor: input.priceMinor,
        p_currency: input.currency,
        p_credits_base: input.creditsBase,
        p_credits_bonus: input.creditsBonus,
        p_default_cap_minor: input.defaultCapMinor,
        p_window_days: input.windowDays,
        p_checkout_ttl_seconds: input.checkoutTtlSeconds,
      };

      const { data, error } = await this.supabase.rpc(BOS_RESERVE_BOOST_PURCHASE_RPC, args);
      if (error) throw error;
      const row = singleRow(data, BOS_RESERVE_BOOST_PURCHASE_RPC);
      const status = toOneOf(row.out_status, ['reserved', 'cap_reached', 'no_plan_row'] as const);
      if (status === 'no_plan_row') return { data: { outcome: 'no_plan_row' }, error: null };
      const capMinor = toInteger(row.out_cap_minor);
      const countedMinor = toInteger(row.out_counted_minor);
      if (status === 'cap_reached') return { data: { outcome: 'cap_reached', capMinor, countedMinor }, error: null };
      return { data: { outcome: 'reserved', purchaseId: toUuid(row.out_purchase_id), capMinor, countedMinor }, error: null };
    } catch (error) {
      return this.fail(method, error, ids);
    }
  }

  /** Attach the Stripe checkout session to this account's pending reservation. */
  async attachCheckout(input: {
    accountId: string;
    purchaseId: string;
    sessionId: string;
    checkoutExpiresAt: string;
  }): Promise<RepositoryResult<{ status: BusinessOsBoostAttachStatus }>> {
    const method = 'attachCheckout';
    const ids = { accountId: input?.accountId, purchaseId: input?.purchaseId };
    try {
      this.assertUuid(input.accountId, 'An account id');
      this.assertUuid(input.purchaseId, 'A purchase id');
      this.assertSessionId(input.sessionId);
      // SA CR-3: the expiry must be in the future and within Stripe's 24 h session
      // limit plus 5 min of clock skew; the function refuses the same with 22023.
      const expiresAtMs = Date.parse(toTimestamp(input.checkoutExpiresAt));
      const nowMs = Date.now();
      if (expiresAtMs <= nowMs || expiresAtMs > nowMs + MAX_CHECKOUT_EXPIRY_MS) {
        throw new BoostPurchaseRepositoryError('The checkout expiry is outside the checkout window');
      }
      const args = {
        p_user_id: input.accountId,
        p_purchase_id: input.purchaseId,
        p_session_id: input.sessionId,
        p_checkout_expires_at: input.checkoutExpiresAt,
      };
      const { data, error } = await this.supabase.rpc(BOS_ATTACH_BOOST_CHECKOUT_RPC, args);
      if (error) {
        // QA R-7: another purchase already holds this session (the UNIQUE key). A refusal, not a
        // crash: the caller (slice 3) must not offer this session and should expire it in Stripe.
        if (sqlStateOf(error) === UNIQUE_VIOLATION) {
          this.logger.warn({ method, sqlstate: UNIQUE_VIOLATION, ...ids }, 'Boost checkout session already held by another purchase');
          return { data: null, error: new Error(BOOST_SESSION_IN_USE_ERROR) };
        }
        throw error;
      }
      return { data: { status: toOneOf(singleRow(data, BOS_ATTACH_BOOST_CHECKOUT_RPC).out_status, ATTACH_STATUSES) }, error: null };
    } catch (error) {
      return this.fail(method, error, ids);
    }
  }

  /** Release a reservation whose Stripe session could not be created (it then stops counting). */
  async abandon(input: { accountId: string; purchaseId: string }): Promise<RepositoryResult<{ status: BusinessOsBoostAbandonStatus }>> {
    const method = 'abandon';
    const ids = { accountId: input?.accountId, purchaseId: input?.purchaseId };
    try {
      this.assertUuid(input.accountId, 'An account id');
      this.assertUuid(input.purchaseId, 'A purchase id');
      const args = { p_user_id: input.accountId, p_purchase_id: input.purchaseId };
      const { data, error } = await this.supabase.rpc(BOS_ABANDON_BOOST_PURCHASE_RPC, args);
      if (error) throw error;
      return { data: { status: toOneOf(singleRow(data, BOS_ABANDON_BOOST_PURCHASE_RPC).out_status, ABANDON_STATUSES) }, error: null };
    } catch (error) {
      return this.fail(method, error, ids);
    }
  }

  /** Set an account's cap, ending any active override as `replaced` (slice 6's admin op). */
  async setCapOverride(input: BusinessOsBoostCapOverrideInput): Promise<RepositoryResult<BusinessOsBoostSetCapOverrideResult>> {
    const method = 'setCapOverride';
    const ids = { accountId: input?.accountId, actorAdminId: input?.actorAdminId };
    try {
      this.assertUuid(input.accountId, 'An account id');
      this.assertUuid(input.actorAdminId, 'An admin id');
      if (!(typeof input.capMinor === 'number' && Number.isSafeInteger(input.capMinor) && input.capMinor > 0)) {
        throw new BoostPurchaseRepositoryError('The cap must be a positive whole number of minor units');
      }
      const args = {
        p_user_id: input.accountId,
        p_cap_minor: input.capMinor,
        p_currency: input.currency,
        p_reason: input.reason,
        p_actor_admin_id: input.actorAdminId,
      };
      const { data, error } = await this.supabase.rpc(BOS_SET_BOOST_CAP_OVERRIDE_RPC, args);
      if (error) throw error;
      const row = singleRow(data, BOS_SET_BOOST_CAP_OVERRIDE_RPC);
      const status = toOneOf(row.out_status, ['set', 'no_plan_row'] as const);
      if (status === 'no_plan_row') return { data: { outcome: 'no_plan_row' }, error: null };
      return {
        data: { outcome: 'set', overrideId: toUuid(row.out_override_id), previousOverrideId: toNullableUuid(row.out_previous_override_id) },
        error: null,
      };
    } catch (error) {
      return this.fail(method, error, ids);
    }
  }

  /** End an account's active cap override; the default cap applies again. */
  async endCapOverride(input: {
    accountId: string;
    actorAdminId: string;
    reason: string;
  }): Promise<RepositoryResult<BusinessOsBoostEndCapOverrideResult>> {
    const method = 'endCapOverride';
    const ids = { accountId: input?.accountId, actorAdminId: input?.actorAdminId };
    try {
      this.assertUuid(input.accountId, 'An account id');
      this.assertUuid(input.actorAdminId, 'An admin id');
      const args = { p_user_id: input.accountId, p_actor_admin_id: input.actorAdminId, p_reason: input.reason };
      const { data, error } = await this.supabase.rpc(BOS_END_BOOST_CAP_OVERRIDE_RPC, args);
      if (error) throw error;
      const row = singleRow(data, BOS_END_BOOST_CAP_OVERRIDE_RPC);
      const status = toOneOf(row.out_status, ['ended', 'none_active'] as const);
      if (status === 'none_active') return { data: { outcome: 'none_active' }, error: null };
      return { data: { outcome: 'ended', overrideId: toUuid(row.out_override_id) }, error: null };
    } catch (error) {
      return this.fail(method, error, ids);
    }
  }

  // ============ Reads ============

  /** One purchase, only if it belongs to this account; `data: null` when missing or another account's. */
  async findForAccount(purchaseId: string, accountId: string): Promise<RepositoryResult<BusinessOsBoostPurchase | null>> {
    const method = 'findForAccount';
    try {
      this.assertUuid(purchaseId, 'A purchase id');
      this.assertUuid(accountId, 'An account id');
      const { data, error } = await this.supabase
        .from('business_os_boost_purchases')
        .select(BOOST_PURCHASE_COLUMNS)
        .eq('id', purchaseId)
        .eq('user_id', accountId)
        .maybeSingle();
      if (error) throw error;
      if (data === null || data === undefined) return { data: null, error: null };
      return { data: mapPurchase(data as unknown as Record<string, unknown>), error: null };
    } catch (error) {
      return this.fail(method, error, { purchaseId, accountId });
    }
  }

  /**
   * UNSCOPED BY DESIGN (R-6, SA C-5). For the Stripe webhook (and the slice 4b
   * reconcile cron) only: `sessionId` must come from a signature-verified Stripe
   * event, never from a request. The returned row's `accountId` IS the account —
   * the caller must use it and nothing from the event. `data: null` when no
   * purchase has this session.
   */
  async findBySessionIdForWebhook(sessionId: string): Promise<RepositoryResult<BusinessOsBoostPurchase | null>> {
    const method = 'findBySessionIdForWebhook';
    try {
      this.assertSessionId(sessionId);
      // Intentionally no user_id filter: see the JSDoc (ownership oracle, R-6).
      const { data, error } = await this.supabase
        .from('business_os_boost_purchases')
        .select(BOOST_PURCHASE_COLUMNS)
        .eq('stripe_checkout_session_id', sessionId)
        .maybeSingle();
      if (error) throw error;
      if (data === null || data === undefined) return { data: null, error: null };
      return { data: mapPurchase(data as unknown as Record<string, unknown>), error: null };
    } catch (error) {
      return this.fail(method, error, {});
    }
  }

  /**
   * UNSCOPED BY DESIGN (R-6, SA C-5). As `findBySessionIdForWebhook`, keyed by
   * the Stripe payment intent (refund and dispute events carry no session).
   */
  async findByPaymentIntentIdForWebhook(paymentIntentId: string): Promise<RepositoryResult<BusinessOsBoostPurchase | null>> {
    const method = 'findByPaymentIntentIdForWebhook';
    try {
      if (typeof paymentIntentId !== 'string' || !paymentIntentId.startsWith('pi_') || paymentIntentId.length > 255) {
        throw new BoostPurchaseRepositoryError('A Stripe payment intent id is required');
      }
      // Intentionally no user_id filter: see the JSDoc (ownership oracle, R-6).
      const { data, error } = await this.supabase
        .from('business_os_boost_purchases')
        .select(BOOST_PURCHASE_COLUMNS)
        .eq('stripe_payment_intent_id', paymentIntentId)
        .maybeSingle();
      if (error) throw error;
      if (data === null || data === undefined) return { data: null, error: null };
      return { data: mapPurchase(data as unknown as Record<string, unknown>), error: null };
    } catch (error) {
      return this.fail(method, error, {});
    }
  }

  /** The account's purchases in one Stripe mode, newest first (admin view, slice 6). */
  async listForAccount(
    accountId: string,
    options: { livemode: boolean; limit?: number }
  ): Promise<RepositoryResult<BusinessOsBoostPurchase[]>> {
    const method = 'listForAccount';
    try {
      this.assertUuid(accountId, 'An account id');
      const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 50)), BOOST_PURCHASE_READ_LIMITS.MAX_LIST);
      const { data, error } = await this.supabase
        .from('business_os_boost_purchases')
        .select(BOOST_PURCHASE_COLUMNS)
        .eq('user_id', accountId)
        .eq('livemode', options.livemode)
        .order('created_at', { ascending: false })
        .range(0, limit - 1);
      if (error) throw error;
      return { data: ((data ?? []) as unknown as Record<string, unknown>[]).map(mapPurchase), error: null };
    } catch (error) {
      return this.fail(method, error, { accountId });
    }
  }

  /** The account's active cap override, or `null` (the default cap applies). */
  async findActiveCapOverride(accountId: string): Promise<RepositoryResult<BusinessOsBoostCapOverride | null>> {
    const method = 'findActiveCapOverride';
    try {
      this.assertUuid(accountId, 'An account id');
      const { data, error } = await this.supabase
        .from('business_os_boost_cap_overrides')
        .select(BOOST_CAP_OVERRIDE_COLUMNS)
        .eq('user_id', accountId)
        .is('ended_at', null)
        .maybeSingle();
      if (error) throw error;
      if (data === null || data === undefined) return { data: null, error: null };
      return { data: mapOverride(data as unknown as Record<string, unknown>), error: null };
    } catch (error) {
      return this.fail(method, error, { accountId });
    }
  }
}

/** Singleton for convenience, matching the rest of the repository layer. */
export const businessOsBoostPurchaseRepository = new BusinessOsBoostPurchaseRepository();

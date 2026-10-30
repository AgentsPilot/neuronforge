/**
 * Upgrade a paying Business OS account to a higher plan at once (plan
 * payments P-7b.1a, workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7B1_WORKPLAN.md
 * §3.2 to §3.4; SA conditions U-1, U-2, U-5, V-1 to V-9; Q-1, Q-2, Q-4, Q-6).
 *
 * Orchestration over injected ports, so every branch is tested with fakes.
 * Two entry points, one per route:
 *
 * - `previewPlanUpgrade`: what the upgrade costs now (Stripe `createPreview`,
 *   read-only), and the proration date the confirm must send back;
 * - `confirmPlanUpgrade`: THE price swap on the existing subscription
 *   (`StripeService.upgradeBusinessOsPlanSubscription`), mapped to an outcome.
 *
 * It ASSIGNS NO PLAN: the webhook applies the paid upgrade invoice (P-3b
 * path, with CF-6 and the U-4 guard of P-7b.1a).
 *
 * THE ORDER IS THE CONTRACT (SA V-9, as P-4.1's amended C-4): every database
 * read, and every refusal decided from our own data, precedes any Stripe call.
 *
 *   3  prices switch off, key mode unknown   → upgrade_unavailable
 *   4  billing row (session user, key mode)  → billing_row_unreadable
 *   5  planUpgradeOffer (our data, §3.1)     → not_subscribed / subscription_not_active /
 *                                              subscription_cancelling / not_an_upgrade /
 *                                              price_unavailable (tier_not_sold) / upgrade_unavailable
 *   6  confirm only: the proration clock     → preview_expired            [no Stripe call yet]
 *   7  Stripe: the subscription, fresh       → planUpgradeEligibility (§3.2, V-2, V-8)
 *   7a Stripe, only when 7 shows a pending update for the target (Q-2): one invoice read
 *                                            → confirm: action_required (resumed)
 *                                            → preview: upgrade_awaiting_confirmation
 *                                            → anything else: upgrade_pending
 *   8  Stripe: runtime price check (target)  → price_unavailable / price_mismatch
 *   9  Stripe: preview | update              → the result
 *
 * TENANT ISOLATION (tenant-isolation-guard). The request names a tier and,
 * for the confirm, a proration date: nothing else. The subscription and
 * customer ids come from OUR billing row (session user, server key mode); the
 * item id from Stripe's answer for that subscription, cross-checked against
 * our row's customer and mode before any write.
 *
 * THE CONFIRMATION SECRET (SA V-1) travels from `StripeService` to the
 * confirm route's 200 body and nowhere else: never a log line, an audit entry
 * or an error.
 *
 * Expected refusals are RESULTS, never throws; an unexpected fault throws and
 * the route answers 500. Refusals and previews are logged, never audited; a
 * confirm that reached the write returns `audit` facts the route writes.
 *
 * Refuses a SALE, never a capability: no `check()` / `decide()`.
 *
 * @module lib/business-os/billing/planUpgrade
 */

import {
  getStripeService,
  type BusinessOsSubscriptionItemFacts,
  type BusinessOsUpgradeFacts,
  type StripeService,
} from '@/lib/stripe/StripeService';
import {
  businessOsBillingAccountRepository,
  type BusinessOsBillingAccount,
  type BusinessOsBillingAccountRepository,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import { buyableTiers, planUpgradeOffer, type PlanPurchaseSwitches } from '@/lib/business-os/billing/planCheckoutEligibility';
import { isPlanCheckoutEnabled } from '@/lib/business-os/billing/planCheckoutFlag';
import { createPlanCheckoutPriceResolver, type PlanCheckoutPriceResolver } from '@/lib/business-os/billing/planCheckoutPrice';
import { planPriceCatalog, planTierForLookupKey, type PlanPriceCatalog } from '@/lib/business-os/billing/planPriceCatalog';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import { hasCancelDate } from '@/lib/business-os/billing/subscriptionCancelling';

// ── Constants (SA Q-1) ──────────────────────────────────────────────────────

/** A proration date may be this far in the future (clock skew). */
export const PLAN_UPGRADE_PRORATION_FUTURE_SKEW_SECONDS = 60;
/** A preview older than this must be taken again before the confirm. */
export const PLAN_UPGRADE_PRORATION_MAX_AGE_SECONDS = 15 * 60;

// ── Refusals ────────────────────────────────────────────────────────────────

export type PlanUpgradeRefusalCode =
  | 'upgrade_unavailable'
  | 'billing_row_unreadable'
  | 'not_subscribed'
  | 'subscription_not_active'
  | 'subscription_cancelling'
  | 'upgrade_pending'
  | 'upgrade_awaiting_confirmation'
  | 'upgrade_processing'
  | 'not_an_upgrade'
  | 'price_unavailable'
  | 'price_mismatch'
  | 'billing_record_mismatch'
  | 'preview_expired'
  | 'upgrade_busy'
  | 'stripe_error';

/** HTTP status and owner-facing message per refusal. Never a Stripe or database message. */
export const PLAN_UPGRADE_REFUSALS: Readonly<Record<PlanUpgradeRefusalCode, { status: number; message: string }>> = {
  upgrade_unavailable: { status: 503, message: 'Upgrading is not available right now. Please try again later.' },
  billing_row_unreadable: { status: 503, message: 'We could not check your billing right now. Please try again.' },
  not_subscribed: { status: 409, message: 'There is no paid plan on your account to upgrade.' },
  subscription_not_active: { status: 409, message: 'Your subscription is not active right now, so it cannot be upgraded.' },
  subscription_cancelling: { status: 409, message: 'Your plan is set to end, so it cannot be upgraded.' },
  upgrade_pending: { status: 409, message: 'An upgrade is already waiting for payment.' },
  upgrade_awaiting_confirmation: { status: 409, message: 'Your upgrade is waiting for you to confirm the payment.' },
  upgrade_processing: { status: 409, message: 'Your upgrade is being processed.' },
  not_an_upgrade: { status: 409, message: 'That plan is not an upgrade from your current plan.' },
  price_unavailable: { status: 503, message: 'This plan cannot be bought right now. Please try again later.' },
  price_mismatch: { status: 503, message: 'This plan cannot be bought right now. Please try again later.' },
  billing_record_mismatch: { status: 409, message: 'We could not upgrade your plan. Please contact support.' },
  preview_expired: { status: 409, message: 'The price needs checking again. Please press Upgrade once more.' },
  upgrade_busy: { status: 409, message: 'Your upgrade is already being processed. Please wait a moment.' },
  stripe_error: { status: 502, message: 'The payment provider did not respond. Please try again.' },
};

/** Logged at `error` with `alert: true` (workplan §3.4 "Logs"); every other refusal is a warn. */
const ALERTED: readonly PlanUpgradeRefusalCode[] = ['billing_record_mismatch', 'price_unavailable', 'price_mismatch', 'stripe_error'];

/**
 * SA F-3 (deviation 7): `upgrade_unavailable` refusals that are configuration
 * faults, reached while the checkout switch is ON, are alerted errors too, as
 * the checkout logs them. The owner-facing code and status do not change.
 * `purchase_switches_off` (unreachable after step 3) stays a warn.
 */
const ALERTED_REASONS: readonly string[] = ['bos_billing_prices_switch_off', 'stripe_key_mode_unknown'];

// ── Ports ───────────────────────────────────────────────────────────────────

export interface PlanUpgradeLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export type PlanUpgradeStripe = Pick<
  StripeService,
  | 'retrieveBusinessOsSubscription'
  | 'retrieveBusinessOsUpgradeInvoice'
  | 'previewBusinessOsPlanUpgrade'
  | 'upgradeBusinessOsPlanSubscription'
  | 'listPricesByLookupKeys'
>;

type SubscriptionRead = Awaited<ReturnType<PlanUpgradeStripe['retrieveBusinessOsSubscription']>>;

export interface PlanUpgradeDeps {
  logger: PlanUpgradeLogger;
  repo?: Pick<BusinessOsBillingAccountRepository, 'findByUser'>;
  stripe?: PlanUpgradeStripe;
  prices?: PlanCheckoutPriceResolver;
  /** Which price is which tier (current and retired keys, CF-1). Default: the process catalog. */
  catalog?: PlanPriceCatalog;
  /** Default: the two environment switches, read from their flag modules. */
  switches?: () => PlanPurchaseSwitches;
  /** Default `buyableTiers()`: a Stripe price AND `availableToBuy`. */
  buyableTiers?: () => readonly TierId[];
  mode?: () => StripeMode;
  now?: () => Date;
}

export interface PlanUpgradeInput {
  /** The session user. Never a request value. */
  userId: string;
  tier: TierId;
}

export interface PlanUpgradeConfirmInput extends PlanUpgradeInput {
  /** The preview's proration date, unix seconds (window-checked, Q-1). */
  prorationDate: number;
}

// ── Results ─────────────────────────────────────────────────────────────────

export type PlanUpgradeRefusal = {
  ok: false;
  code: PlanUpgradeRefusalCode;
  /** ISO time a pending update expires (upgrade_pending). */
  retryAfter?: string;
  /** Q-2, preview only (upgrade_awaiting_confirmation): the pending invoice's amount and a fresh date. */
  amountDueMinor?: number;
  prorationDate?: number;
  /** SA V-3: the write was attempted and its result is unknown. Audited as `unknown`. */
  outcomeUnknown?: true;
  audit?: PlanUpgradeAuditFacts;
};

export interface PlanUpgradePreview {
  ok: true;
  fromTier: TierId;
  tier: TierId;
  lookupKey: string;
  amountDueMinor: number;
  totalMinor: number;
  /** SA V-12. */
  taxMinor: number;
  currency: 'usd';
  prorationDate: number;
  /** ISO end of the current period (the renewal is unchanged). Null when Stripe gave none. */
  renewsOn: string | null;
  monthlyPriceMinor: number;
  livemode: boolean;
}

export type PlanUpgradeAuditOutcome = 'upgraded' | 'processing' | 'action_required' | 'declined' | 'unknown';

/** What the confirm route audits (`BOS_BILLING_UPGRADE_REQUESTED`). Never the secret. */
export interface PlanUpgradeAuditFacts {
  fromTier: TierId;
  toTier: TierId;
  lookupKey: string | null;
  prorationDate: number;
  outcome: PlanUpgradeAuditOutcome;
  invoiceId: string | null;
  subscriptionId: string;
  livemode: boolean;
  resumed: boolean;
}

export type PlanUpgradeConfirmed =
  | { ok: true; outcome: 'upgraded' | 'processing'; audit: PlanUpgradeAuditFacts }
  | { ok: true; outcome: 'declined'; retryAfter?: string; audit: PlanUpgradeAuditFacts }
  | { ok: true; outcome: 'action_required'; clientSecret: string; resumed: boolean; audit: PlanUpgradeAuditFacts };

export type PlanUpgradePreviewResult = PlanUpgradePreview | PlanUpgradeRefusal;
export type PlanUpgradeConfirmResult = PlanUpgradeConfirmed | PlanUpgradeRefusal;

// ── Pure: eligibility after the fresh read (§3.2, U-2, V-2, V-8) ────────────

export type PlanUpgradeEligibility =
  | { kind: 'eligible'; item: BusinessOsSubscriptionItemFacts }
  | { kind: 'pending'; expiresAt: number; pendingTier: string | null; latestInvoiceId: string | null }
  | { kind: 'refused'; code: PlanUpgradeRefusalCode; reason: string; context?: Record<string, unknown> };

export type PlanUpgradeRowFacts = Pick<BusinessOsBillingAccount, 'stripeCustomerId' | 'stripeSubscriptionId' | 'livemode' | 'boughtTier'>;

export type PlanUpgradeSubscriptionFacts = Pick<
  SubscriptionRead,
  'id' | 'customerId' | 'livemode' | 'status' | 'cancelAtPeriodEnd' | 'cancelAt' | 'pendingUpdate' | 'items' | 'latestInvoiceId'
>;

function tierIndex(tier: string | null): number {
  return tier === null ? -1 : (TIER_ORDER as readonly string[]).indexOf(tier);
}

/**
 * Re-check the upgrade against Stripe's answer (pure). First rule wins:
 *
 *   subscription, customer or mode differ from our row → billing_record_mismatch (alert)
 *   status not `active`                                 → subscription_not_active
 *   `cancel_at_period_end`, or any `cancel_at` date     → subscription_cancelling
 *     (follow-ups C-3, SA Q-5: the dashboard may set `cancel_at` alone; an
 *     upgrade bills a proration NOW, so any end date refuses. Log reason
 *     `stripe_cancel_at` when only the date is set)
 *   a pending update                                    → `pending` (the caller decides: Q-2 resume or upgrade_pending)
 *   not exactly one item                                → billing_record_mismatch (alert)
 *   the item's price not in the catalog                 → billing_record_mismatch (alert)
 *   the item on a tier ABOVE `boughtTier`               → upgrade_processing (V-2: the webhook is late; no alert)
 *   the item on a tier BELOW `boughtTier`               → billing_record_mismatch (alert)
 *   the target not above `boughtTier`                   → not_an_upgrade
 *   the target not buyable                              → price_unavailable
 *   confirm: proration date before the item's period    → preview_expired (V-8: the period is on the item)
 */
export function planUpgradeEligibility(
  row: PlanUpgradeRowFacts,
  subscription: PlanUpgradeSubscriptionFacts,
  target: TierId,
  tierOfPrice: (priceId: string) => string | null,
  options: { buyable?: readonly TierId[]; prorationDate?: number } = {}
): PlanUpgradeEligibility {
  const refuse = (code: PlanUpgradeRefusalCode, reason: string, context?: Record<string, unknown>): PlanUpgradeEligibility => ({
    kind: 'refused',
    code,
    reason,
    ...(context ? { context } : {}),
  });

  if (
    subscription.id !== row.stripeSubscriptionId ||
    subscription.customerId !== row.stripeCustomerId ||
    subscription.livemode !== row.livemode
  ) {
    return refuse('billing_record_mismatch', 'subscription_record_differs', {
      subscriptionMatches: subscription.id === row.stripeSubscriptionId,
      customerMatches: subscription.customerId === row.stripeCustomerId,
      modeMatches: subscription.livemode === row.livemode,
    });
  }
  if (subscription.status !== 'active') {
    return refuse('subscription_not_active', 'stripe_status', { subscriptionStatus: subscription.status });
  }
  if (subscription.cancelAtPeriodEnd) return refuse('subscription_cancelling', 'stripe_cancel_at_period_end');
  if (hasCancelDate(subscription)) return refuse('subscription_cancelling', 'stripe_cancel_at');

  if (subscription.pendingUpdate !== null) {
    const pendingTiers = [...new Set(subscription.pendingUpdate.priceIds.map((id) => tierOfPrice(id)))];
    return {
      kind: 'pending',
      expiresAt: subscription.pendingUpdate.expiresAt,
      pendingTier: pendingTiers.length === 1 ? pendingTiers[0] : null,
      latestInvoiceId: subscription.latestInvoiceId,
    };
  }

  if (subscription.items.length !== 1) {
    return refuse('billing_record_mismatch', 'item_count', { itemCount: subscription.items.length });
  }
  const item = subscription.items[0];
  const itemTier = item.priceId ? tierOfPrice(item.priceId) : null;
  const bought = tierIndex(row.boughtTier);
  const billed = tierIndex(itemTier);
  if (itemTier === null || billed < 0 || bought < 0) {
    return refuse('billing_record_mismatch', 'item_price_not_in_catalog', { priceId: item.priceId });
  }
  if (billed > bought) return refuse('upgrade_processing', 'item_already_upgraded', { itemTier });
  if (billed < bought) return refuse('billing_record_mismatch', 'item_below_bought_tier', { itemTier });

  if (tierIndex(target) <= bought) return refuse('not_an_upgrade', 'target_not_above_bought_tier');
  if (!(options.buyable ?? buyableTiers()).includes(target)) return refuse('price_unavailable', 'tier_not_sold');

  if (options.prorationDate !== undefined && (item.currentPeriodStart === null || options.prorationDate < item.currentPeriodStart)) {
    return refuse('preview_expired', 'proration_before_period_start');
  }
  return { kind: 'eligible', item };
}

// ── The orchestration ───────────────────────────────────────────────────────

let defaultPriceResolver: PlanCheckoutPriceResolver | null = null;

/** One resolver per server instance, so its 60 s cache is shared by every request. */
function sharedPriceResolver(): PlanCheckoutPriceResolver {
  if (!defaultPriceResolver) {
    defaultPriceResolver = createPlanCheckoutPriceResolver({
      listPricesByLookupKeys: (keys) => getStripeService().listPricesByLookupKeys(keys),
    });
  }
  return defaultPriceResolver;
}

function defaultSwitches(): PlanPurchaseSwitches {
  return { checkoutEnabled: isPlanCheckoutEnabled(), pricesEnabled: isPlanPriceRecognitionEnabled() };
}

function isoFromUnix(value: number | null): string | null {
  return value === null ? null : new Date(value * 1000).toISOString();
}

function errorType(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const type = (err as { type?: unknown }).type;
  return typeof type === 'string' ? type : null;
}

function errorCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

/**
 * A Stripe error, reduced to what an operator needs (SA V-1). A Stripe card
 * error can carry the PaymentIntent, client secret included, so the error
 * object itself is never logged from this file.
 */
function safeErr(err: unknown): Record<string, unknown> {
  if (typeof err !== 'object' || err === null) return { kind: typeof err };
  const e = err as { type?: unknown; code?: unknown; statusCode?: unknown; requestId?: unknown; name?: unknown };
  return {
    name: typeof e.name === 'string' ? e.name : null,
    type: typeof e.type === 'string' ? e.type : null,
    code: typeof e.code === 'string' ? e.code : null,
    statusCode: typeof e.statusCode === 'number' ? e.statusCode : null,
    requestId: typeof e.requestId === 'string' ? e.requestId : null,
  };
}

/** Stripe refused the request before running it: nothing was written. */
const NOT_EXECUTED_ERROR_TYPES: readonly string[] = [
  'StripeInvalidRequestError',
  'StripeAuthenticationError',
  'StripePermissionError',
  'StripeRateLimitError',
];

/** The tier of a price, from the catalog, reloaded once when a cached map misses one (SA P1-C3). */
async function tierLookupFor(catalog: PlanPriceCatalog, priceIds: readonly string[]): Promise<(priceId: string) => string | null> {
  let known = await catalog.load();
  if (known.fromCache && priceIds.some((id) => !known.byPriceId.has(id))) {
    known = await catalog.load({ bypassCache: true });
  }
  const map = known.byPriceId;
  return (priceId) => {
    const lookupKey = map.get(priceId);
    return lookupKey ? planTierForLookupKey(lookupKey) : null;
  };
}

interface Prepared {
  row: BusinessOsBillingAccount & { stripeSubscriptionId: string };
  fromTier: TierId;
  livemode: boolean;
  stripe: PlanUpgradeStripe;
  subscription: SubscriptionRead;
  eligibility: PlanUpgradeEligibility;
  nowSeconds: number;
}

type RefuseFn = (code: PlanUpgradeRefusalCode, context?: Record<string, unknown>, extra?: Omit<PlanUpgradeRefusal, 'ok' | 'code'>) => PlanUpgradeRefusal;

function refuser(log: PlanUpgradeLogger, userId: string, tier: TierId, step: 'preview' | 'confirm'): RefuseFn {
  return (code, context = {}, extra = {}) => {
    const reason = typeof context.reason === 'string' ? context.reason : null;
    const alerted = ALERTED.includes(code) || (code === 'upgrade_unavailable' && reason !== null && ALERTED_REASONS.includes(reason));
    log[alerted ? 'error' : 'warn'](
      { event: 'bos_billing_upgrade_refused', code, step, userId, tier, ...(alerted ? { alert: true } : {}), ...context },
      'Plan upgrade refused'
    );
    return { ok: false, code, ...extra };
  };
}

/** Steps 3 to 7, shared by both entry points. */
async function prepare(
  input: PlanUpgradeInput,
  deps: PlanUpgradeDeps,
  refuse: RefuseFn,
  confirm: { prorationDate: number } | null
): Promise<Prepared | PlanUpgradeRefusal> {
  const { userId, tier } = input;
  const nowSeconds = Math.floor((deps.now ?? (() => new Date()))().getTime() / 1000);

  // 3. Never sell what the webhook cannot recognise; the key mode decides our row.
  if (!(deps.switches ?? defaultSwitches)().pricesEnabled) {
    return refuse('upgrade_unavailable', { reason: 'bos_billing_prices_switch_off' });
  }
  let mode: StripeMode;
  try {
    mode = (deps.mode ?? currentStripeMode)();
  } catch {
    return refuse('upgrade_unavailable', { reason: 'stripe_key_mode_unknown' });
  }
  const livemode = isLiveMode(mode);

  // 4. Our billing row: by the session user and the server key's mode.
  const read = await (deps.repo ?? businessOsBillingAccountRepository).findByUser(userId, livemode);
  if (read.error) return refuse('billing_row_unreadable');
  const row = read.data;

  // 5. Our-data decision, ONCE (§3.1): the same predicate the view uses.
  const offer = planUpgradeOffer(
    row
      ? {
          boughtTier: row.boughtTier,
          subscriptionId: row.stripeSubscriptionId,
          subscriptionStatus: row.subscriptionStatus,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          endedAt: row.endedAt,
        }
      : null,
    (deps.switches ?? defaultSwitches)(),
    (deps.buyableTiers ?? buyableTiers)()
  );
  if (offer.kind === 'none') {
    switch (offer.reason) {
      case 'switches_off':
        return refuse('upgrade_unavailable', { reason: 'purchase_switches_off' });
      case 'not_subscribed':
        return refuse('not_subscribed', { source: 'record' });
      case 'not_active':
        return refuse('subscription_not_active', { source: 'record', subscriptionStatus: row?.subscriptionStatus ?? null });
      case 'cancelling':
        return refuse('subscription_cancelling', { source: 'record' });
      case 'top_tier':
        return refuse('not_an_upgrade', { reason: 'top_tier' });
      case 'not_on_sale':
        return refuse('price_unavailable', { reason: 'tier_not_sold' });
    }
  }
  if (!offer.tiers.includes(tier)) {
    return tierIndex(tier) <= tierIndex(offer.from)
      ? refuse('not_an_upgrade', { reason: 'target_not_above_bought_tier' })
      : refuse('price_unavailable', { reason: 'tier_not_sold' });
  }
  // `planUpgradeOffer` answered `upgrade`, so the row and its subscription id exist.
  const ownRow = row as BusinessOsBillingAccount & { stripeSubscriptionId: string };

  // 6. Confirm only: the proration clock window (Q-1, V-8), before any Stripe call.
  if (confirm) {
    const { prorationDate } = confirm;
    if (prorationDate > nowSeconds + PLAN_UPGRADE_PRORATION_FUTURE_SKEW_SECONDS) {
      return refuse('preview_expired', { reason: 'proration_in_future', prorationDate });
    }
    if (prorationDate < nowSeconds - PLAN_UPGRADE_PRORATION_MAX_AGE_SECONDS) {
      return refuse('preview_expired', { reason: 'proration_too_old', prorationDate });
    }
  }

  // 7. Stripe's answer, fresh, for OUR row's subscription (never a request value).
  const stripe = deps.stripe ?? getStripeService();
  let subscription: SubscriptionRead;
  let tierOfPrice: (priceId: string) => string | null;
  try {
    subscription = await stripe.retrieveBusinessOsSubscription(ownRow.stripeSubscriptionId);
    tierOfPrice = await tierLookupFor(deps.catalog ?? planPriceCatalog, [
      ...subscription.items.map((item) => item.priceId).filter((id): id is string => id !== null),
      ...(subscription.pendingUpdate?.priceIds ?? []),
    ]);
  } catch (err) {
    return refuse('stripe_error', { stripeError: safeErr(err), step: 'subscription_read', subscriptionId: ownRow.stripeSubscriptionId });
  }

  const eligibility = planUpgradeEligibility(ownRow, subscription, tier, tierOfPrice, {
    buyable: (deps.buyableTiers ?? buyableTiers)(),
    ...(confirm ? { prorationDate: confirm.prorationDate } : {}),
  });
  if (eligibility.kind === 'refused') {
    return refuse(eligibility.code, { reason: eligibility.reason, subscriptionId: ownRow.stripeSubscriptionId, ...eligibility.context });
  }
  return { row: ownRow, fromTier: offer.from, livemode, stripe, subscription, eligibility, nowSeconds };
}

/**
 * Step 7a (Q-2): is the pending update OURS, for this target, waiting on
 * 3-D Secure? One invoice read, by the id Stripe gave for our subscription.
 * Returns the invoice facts when it is resumable, a refusal otherwise.
 */
async function resumable(
  prepared: Prepared,
  tier: TierId,
  refuse: RefuseFn
): Promise<{ ok: true; invoiceId: string; amountDueMinor: number | null; clientSecret: string } | PlanUpgradeRefusal> {
  const { eligibility, row, stripe } = prepared;
  if (eligibility.kind !== 'pending') throw new Error('resumable() needs a pending eligibility');
  const retryAfter = isoFromUnix(eligibility.expiresAt) ?? undefined;
  const pending = (reason: string) =>
    refuse('upgrade_pending', { reason, subscriptionId: row.stripeSubscriptionId }, retryAfter ? { retryAfter } : {});

  if (eligibility.pendingTier !== tier || !eligibility.latestInvoiceId) return pending('pending_update_not_for_target');

  let invoice: Awaited<ReturnType<PlanUpgradeStripe['retrieveBusinessOsUpgradeInvoice']>>;
  try {
    invoice = await stripe.retrieveBusinessOsUpgradeInvoice(eligibility.latestInvoiceId);
  } catch (err) {
    return refuse('stripe_error', { stripeError: safeErr(err), step: 'pending_invoice_read', invoiceId: eligibility.latestInvoiceId });
  }
  const ours =
    invoice.subscriptionId === row.stripeSubscriptionId &&
    invoice.customerId === row.stripeCustomerId &&
    invoice.livemode === row.livemode &&
    invoice.billingReason === 'subscription_update' &&
    invoice.status === 'open';
  if (!ours) return pending('pending_invoice_not_ours_or_not_open');
  if (invoice.paymentState !== 'requires_action' || !invoice.confirmationClientSecret) {
    return pending(`pending_payment_${invoice.paymentState}`);
  }
  return { ok: true, invoiceId: invoice.invoiceId, amountDueMinor: invoice.amountDueMinor, clientSecret: invoice.confirmationClientSecret };
}

/** The preview: what the upgrade costs now. Read-only at Stripe; never audited. */
export async function previewPlanUpgrade(input: PlanUpgradeInput, deps: PlanUpgradeDeps): Promise<PlanUpgradePreviewResult> {
  const { userId, tier } = input;
  const log = deps.logger;
  const refuse = refuser(log, userId, tier, 'preview');

  const prepared = await prepare(input, deps, refuse, null);
  if (!('row' in prepared)) return prepared;
  const { row, fromTier, livemode, stripe, eligibility, nowSeconds } = prepared;

  if (eligibility.kind === 'pending') {
    // 7a. Q-2: the screen offers the same confirmation again; never a secret here.
    const resume = await resumable(prepared, tier, refuse);
    if (!resume.ok) return resume;
    return refuse(
      'upgrade_awaiting_confirmation',
      { invoiceId: resume.invoiceId, subscriptionId: row.stripeSubscriptionId },
      { prorationDate: nowSeconds, ...(resume.amountDueMinor !== null ? { amountDueMinor: resume.amountDueMinor } : {}) }
    );
  }
  if (eligibility.kind !== 'eligible') throw new Error('unreachable eligibility');
  const { item } = eligibility;

  // 8. The target's price must equal the price we show (SA-P12 b).
  const price = await (deps.prices ?? (deps.stripe ? resolverFor(stripe) : sharedPriceResolver())).resolve(tier, livemode, log);
  if (!price.ok) return refuse(price.code, { lookupKey: price.lookupKey });

  // 9. Stripe's preview, at a proration date the server chooses.
  const prorationDate = nowSeconds;
  let quoted: Awaited<ReturnType<PlanUpgradeStripe['previewBusinessOsPlanUpgrade']>>;
  try {
    quoted = await stripe.previewBusinessOsPlanUpgrade({
      customerId: row.stripeCustomerId,
      subscriptionId: row.stripeSubscriptionId,
      itemId: item.id,
      priceId: price.priceId,
      prorationDate,
    });
  } catch (err) {
    return refuse('stripe_error', { stripeError: safeErr(err), step: 'preview', subscriptionId: row.stripeSubscriptionId });
  }
  if (quoted.currency !== 'usd') return refuse('price_mismatch', { reason: 'preview_currency_not_usd', currency: quoted.currency });

  log.info(
    {
      event: 'bos_billing_upgrade_previewed',
      userId,
      fromTier,
      tier,
      lookupKey: price.lookupKey,
      amountDueMinor: quoted.amountDueMinor,
      totalMinor: quoted.totalMinor,
      taxMinor: quoted.taxMinor,
      prorationDate,
      subscriptionId: row.stripeSubscriptionId,
      livemode,
    },
    'Plan upgrade previewed'
  );
  return {
    ok: true,
    fromTier,
    tier,
    lookupKey: price.lookupKey,
    amountDueMinor: quoted.amountDueMinor,
    totalMinor: quoted.totalMinor,
    taxMinor: quoted.taxMinor,
    currency: 'usd',
    prorationDate,
    renewsOn: isoFromUnix(item.currentPeriodEnd),
    monthlyPriceMinor: price.unitAmount,
    livemode,
  };
}

function resolverFor(stripe: PlanUpgradeStripe): PlanCheckoutPriceResolver {
  return createPlanCheckoutPriceResolver({ listPricesByLookupKeys: (keys) => stripe.listPricesByLookupKeys(keys) });
}

/**
 * The outcome of a write that went through (SA U-5, V-4, Q-6). With
 * `pending_if_incomplete`, no pending update means Stripe applied the change.
 * `none` is "could not tell" and never "nothing changed" (V-3).
 */
function outcomeOf(facts: BusinessOsUpgradeFacts): PlanUpgradeAuditOutcome {
  if (!facts.pendingUpdate) return 'upgraded';
  switch (facts.paymentState) {
    case 'succeeded':
    case 'processing':
      return 'processing';
    case 'requires_action':
      return facts.confirmationClientSecret ? 'action_required' : 'unknown';
    case 'requires_payment_method':
      return 'declined';
    case 'none':
      return 'unknown';
  }
}

/** The confirm: THE price swap. Every confirm that reaches the write returns `audit`. */
export async function confirmPlanUpgrade(input: PlanUpgradeConfirmInput, deps: PlanUpgradeDeps): Promise<PlanUpgradeConfirmResult> {
  const { userId, tier, prorationDate } = input;
  const log = deps.logger;
  const refuse = refuser(log, userId, tier, 'confirm');

  const prepared = await prepare(input, deps, refuse, { prorationDate });
  if (!('row' in prepared)) return prepared;
  const { row, fromTier, livemode, stripe, eligibility } = prepared;

  const requested = (audit: PlanUpgradeAuditFacts) => {
    // Never the secret (V-1): ids and the outcome only.
    log.info(
      {
        event: 'bos_billing_upgrade_requested',
        userId,
        fromTier: audit.fromTier,
        tier: audit.toTier,
        outcome: audit.outcome,
        resumed: audit.resumed,
        invoiceId: audit.invoiceId,
        subscriptionId: audit.subscriptionId,
        prorationDate: audit.prorationDate,
        livemode: audit.livemode,
      },
      'Plan upgrade requested'
    );
    return audit;
  };

  if (eligibility.kind === 'pending') {
    // 7a. Q-2 resume: the same invoice, the same confirmation; no new update.
    const resume = await resumable(prepared, tier, refuse);
    if (!resume.ok) return resume;
    const audit = requested({
      fromTier,
      toTier: tier,
      lookupKey: null,
      prorationDate,
      outcome: 'action_required',
      invoiceId: resume.invoiceId,
      subscriptionId: row.stripeSubscriptionId,
      livemode,
      resumed: true,
    });
    return { ok: true, outcome: 'action_required', clientSecret: resume.clientSecret, resumed: true, audit };
  }
  if (eligibility.kind !== 'eligible') throw new Error('unreachable eligibility');
  const { item } = eligibility;

  // 8. The target's price must equal the price we show (SA-P12 b). No price is created.
  const price = await (deps.prices ?? (deps.stripe ? resolverFor(stripe) : sharedPriceResolver())).resolve(tier, livemode, log);
  if (!price.ok) return refuse(price.code, { lookupKey: price.lookupKey });

  const auditBase = {
    fromTier,
    toTier: tier,
    lookupKey: price.lookupKey,
    prorationDate,
    subscriptionId: row.stripeSubscriptionId,
    livemode,
    resumed: false,
  };

  // 9. THE write.
  let facts: BusinessOsUpgradeFacts;
  try {
    facts = await stripe.upgradeBusinessOsPlanSubscription({
      subscriptionId: row.stripeSubscriptionId,
      itemId: item.id,
      priceId: price.priceId,
      prorationDate,
    });
  } catch (err) {
    // SA F-2: the same request still in flight is matched by its CODE first,
    // whatever its class. The SDK builds the class from Stripe's `type`, and
    // an in-flight `idempotency_key_in_use` is not guaranteed to arrive as
    // `idempotency_error`: E-6 saw it as `StripeInvalidRequestError`, HTTP 409.
    // This is the EXPECTED answer to a double click, not a rare one: Stripe
    // sends `stripe-should-retry: false` on it, so the SDK does not retry it
    // (E-6: 2 of 3 parallel calls got it with default retries). Not audited:
    // this request made no write of its own; the first one decides.
    if (errorCode(err) === 'idempotency_key_in_use') {
      return refuse('upgrade_busy', { subscriptionId: row.stripeSubscriptionId });
    }
    const type = errorType(err);
    if (type === 'StripeCardError') {
      // V-7: a decline thrown by the call. A backstop: E-2 observed Stripe
      // RETURNING the decline (pending update kept, `requires_payment_method`),
      // which is the `declined` case of `outcomeOf` below.
      const audit = requested({ ...auditBase, outcome: 'declined', invoiceId: null });
      log.warn({ event: 'bos_billing_upgrade_declined', userId, tier, declineShape: 'thrown', subscriptionId: row.stripeSubscriptionId }, 'Plan upgrade declined');
      return { ok: true, outcome: 'declined', audit };
    }
    if (type === 'StripeIdempotencyError') {
      // Any idempotency error other than the in-flight one (matched above) is an alerted stripe_error.
      return refuse('stripe_error', { stripeError: safeErr(err), step: 'update', reason: 'idempotency_error', subscriptionId: row.stripeSubscriptionId });
    }
    if (type !== null && NOT_EXECUTED_ERROR_TYPES.includes(type)) {
      return refuse('stripe_error', { stripeError: safeErr(err), step: 'update', reason: 'refused_by_stripe', subscriptionId: row.stripeSubscriptionId });
    }
    // V-3: timeout, 5xx, connection: the change may have been made.
    const audit = requested({ ...auditBase, outcome: 'unknown', invoiceId: null });
    return refuse('stripe_error', { stripeError: safeErr(err), step: 'update', reason: 'outcome_unknown', subscriptionId: row.stripeSubscriptionId }, { outcomeUnknown: true, audit });
  }

  const outcome = outcomeOf(facts);
  const audit = requested({ ...auditBase, outcome, invoiceId: facts.invoiceId });
  switch (outcome) {
    case 'upgraded':
    case 'processing':
      return { ok: true, outcome, audit };
    case 'declined': {
      // V-7: the returned shape. Q-6: the pending update stays, so say when to retry.
      const retryAfter = isoFromUnix(facts.pendingUpdateExpiresAt);
      log.warn(
        { event: 'bos_billing_upgrade_declined', userId, tier, declineShape: 'returned', invoiceId: facts.invoiceId, subscriptionId: row.stripeSubscriptionId },
        'Plan upgrade declined'
      );
      return { ok: true, outcome: 'declined', ...(retryAfter ? { retryAfter } : {}), audit };
    }
    case 'action_required':
      return { ok: true, outcome: 'action_required', clientSecret: facts.confirmationClientSecret as string, resumed: false, audit };
    case 'unknown':
      return refuse(
        'stripe_error',
        { step: 'update', reason: 'outcome_unknown', paymentState: facts.paymentState, invoiceId: facts.invoiceId, subscriptionId: row.stripeSubscriptionId },
        { outcomeUnknown: true, audit }
      );
  }
}

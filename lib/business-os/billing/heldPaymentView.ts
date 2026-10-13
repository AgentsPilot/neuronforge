import 'server-only';

/**
 * What the holding screen shows a HELD account (plan payments P-5a.2;
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P5A_WORKPLAN.md §3.3;
 * SA S5-2, S5-6, P5-C5, P5-C6, W-7, Q-5).
 *
 *   coming_soon  today's screen: a held-payment switch is off, or the hold
 *                cannot be paid for yet (D5-3: never offer what the server
 *                refuses). Decided by `heldPaymentOffer`, never re-derived.
 *   pay          "Finish your payment", with the plan name and the monthly
 *                price read from `TIER_MATRIX.presentation` (G5-7: no literal).
 *   processing   a payment is under way: the checkout return marker is on the
 *                URL, or this mode's billing row has a LIVE subscription status
 *                (`LIVE_SUBSCRIPTION_STATUSES`, the set SR-5 refuses on, so the
 *                screen never shows Pay where the server answers
 *                `subscription_live`; W-7 a).
 *
 * Processing, in more detail (W-7, Q-5):
 *   - `delay: 'stuck'`  a PAYING status (`PAYING_SUBSCRIPTION_STATUSES`) whose
 *     row was last updated over 5 minutes ago, while the account is still
 *     held. That is the G5-6 shape: logged at `error` with `alert: true`. The
 *     page does not auto-refresh, so one manual load logs one alert;
 *   - `delay: 'slow'`   a live but non-paying status (`incomplete`, `unpaid`, …)
 *     over 5 minutes old: the "taking longer" line at once, a `warn`, no alert;
 *   - `delay: 'none'`   otherwise; the page polls with `router.refresh()`.
 *   - `markerOnly`      the processing came from the URL marker alone. The
 *     "taking longer" line then links to the screen WITHOUT the marker, which
 *     shows Pay again if nothing is live (W-7 c), so a stale or bookmarked
 *     marker cannot trap a friend on "processing".
 *
 * THIS MODULE NEVER RELEASES ANYONE (P5-C6). Release is the page's server
 * re-read of the hold (`readHoldForSession` → `not_held` → redirect). The
 * marker and the billing row change only what is shown.
 *
 * A failed billing read shows Pay (the server refuses again at SR-5 if a
 * subscription is live, and nobody is released), unless the return marker is
 * present, in which case it shows processing with the marker-only escape link.
 * An unknown Stripe key mode skips the billing read the same way.
 *
 * Tenant isolation: the billing row is read by the SESSION's user id and the
 * server key's mode, never by a request value. `?checkout=` is pattern-checked
 * by the page and changes the display only.
 *
 * The holding page imports nothing from the entitlements module (its source
 * guard): it receives the plan name and price from here as data. This file is
 * the registered importer (`KNOWN_NON_GATE_IMPORTERS`: `TIER_MATRIX`,
 * `TierId`), SA P5-C11.
 *
 * @module lib/business-os/billing/heldPaymentView
 */

import { TIER_MATRIX } from '@/lib/business-os/entitlements/config/tierMatrix';
import type { TierId } from '@/lib/business-os/entitlements/config/tierMatrix';
import {
  businessOsBillingAccountRepository,
  type BusinessOsBillingAccountRepository,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { createLogger } from '@/lib/logger';
import { LIVE_SUBSCRIPTION_STATUSES } from '@/lib/business-os/billing/planCheckout';
import {
  heldPaymentOffer,
  readHeldPaymentSwitches,
  type HeldPaymentHold,
  type HeldPaymentSwitches,
} from '@/lib/business-os/billing/planCheckoutEligibility';
import { PAYING_SUBSCRIPTION_STATUSES } from '@/lib/business-os/billing/payingSubscriptionStatuses';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';

const defaultLogger = createLogger({ module: 'BosHeldPaymentView' });

/** How long a live subscription may sit on a still-held account before the screen says so (Q-5). */
export const HELD_PAYMENT_STUCK_AFTER_MS = 5 * 60 * 1000;

/** The plan-name languages the tier matrix carries. Anything else reads English. */
type LabelLanguage = keyof (typeof TIER_MATRIX.presentation)[TierId]['labels'];

export type HeldPaymentProcessingDelay = 'none' | 'slow' | 'stuck';

export type HeldPaymentView =
  | { kind: 'coming_soon' }
  | { kind: 'pay'; tier: TierId; planName: string; monthlyPriceUsd: number }
  | { kind: 'processing'; delay: HeldPaymentProcessingDelay; markerOnly: boolean };

export interface HeldPaymentViewInput {
  /** The session's user id: the billing row is keyed on it. */
  userId: string;
  /** The session's account id, for the logs. */
  accountId: string;
  hold: HeldPaymentHold;
  /** The invite's language (C-8). */
  language: string;
  /** True when the URL carries a well-formed checkout return marker. */
  checkoutReturned: boolean;
}

export interface HeldPaymentViewLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
}

export interface HeldPaymentViewDeps {
  switches?: () => HeldPaymentSwitches;
  billing?: Pick<BusinessOsBillingAccountRepository, 'findByUser'>;
  mode?: () => StripeMode;
  now?: () => Date;
  logger?: HeldPaymentViewLogger;
}

const LIVE: ReadonlySet<string> = new Set<string>(LIVE_SUBSCRIPTION_STATUSES);
const PAYING: ReadonlySet<string> = new Set<string>(PAYING_SUBSCRIPTION_STATUSES);

function labelLanguage(language: string): LabelLanguage {
  return language === 'he' || language === 'es' ? language : 'en';
}

export async function readHeldPaymentView(input: HeldPaymentViewInput, deps: HeldPaymentViewDeps = {}): Promise<HeldPaymentView> {
  const { userId, accountId, hold, language, checkoutReturned } = input;
  const log = deps.logger ?? defaultLogger;

  // 1. The one predicate (S5-2). Unavailable → today's screen, whatever else is true.
  const offer = heldPaymentOffer(hold, (deps.switches ?? readHeldPaymentSwitches)());
  if (offer.kind !== 'pay') return { kind: 'coming_soon' };

  const pay: HeldPaymentView = {
    kind: 'pay',
    tier: offer.tier,
    planName: TIER_MATRIX.presentation[offer.tier].labels[labelLanguage(language)],
    monthlyPriceUsd: TIER_MATRIX.presentation[offer.tier].monthlyPriceUsd,
  };
  const markerOnly: HeldPaymentView = { kind: 'processing', delay: 'none', markerOnly: true };

  // 2. This mode's billing row. An unknown key mode skips the read.
  let livemode: boolean;
  try {
    livemode = isLiveMode((deps.mode ?? currentStripeMode)());
  } catch {
    log.warn({ event: 'bos_billing_held_view_mode_unknown', accountId }, 'Stripe key mode unknown on the holding screen');
    return checkoutReturned ? markerOnly : pay;
  }

  let row: Awaited<ReturnType<BusinessOsBillingAccountRepository['findByUser']>>['data'];
  try {
    const result = await (deps.billing ?? businessOsBillingAccountRepository).findByUser(userId, livemode);
    if (result.error) throw result.error;
    row = result.data;
  } catch (err) {
    // Never a release: the server re-reads the hold, and SR-5 refuses again.
    log.warn({ err, event: 'bos_billing_held_view_billing_unread', accountId }, 'Billing row unreadable on the holding screen');
    return checkoutReturned ? markerOnly : pay;
  }

  const status = row?.subscriptionStatus ?? null;
  if (row && status && LIVE.has(status)) {
    const updatedAt = Date.parse(row.updatedAt);
    const isOld = Number.isFinite(updatedAt) && (deps.now ?? (() => new Date()))().getTime() - updatedAt > HELD_PAYMENT_STUCK_AFTER_MS;
    if (isOld && PAYING.has(status)) {
      // G5-6: paid (or paying) yet still held. Someone must look.
      log.error(
        { event: 'bos_billing_held_but_paying', alert: true, accountId, livemode, subscriptionStatus: status, updatedAt: row.updatedAt },
        'Account still held with a paying plan subscription'
      );
      return { kind: 'processing', delay: 'stuck', markerOnly: false };
    }
    if (isOld) {
      log.warn(
        { event: 'bos_billing_held_payment_slow', accountId, livemode, subscriptionStatus: status, updatedAt: row.updatedAt },
        'Held account has a live but unpaid plan subscription'
      );
      return { kind: 'processing', delay: 'slow', markerOnly: false };
    }
    return { kind: 'processing', delay: 'none', markerOnly: false };
  }

  // 3. Nothing live: Pay, unless the friend has just come back from the checkout.
  return checkoutReturned ? markerOnly : pay;
}

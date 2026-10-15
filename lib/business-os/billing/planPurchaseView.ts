import 'server-only';

/**
 * What Settings → Plan may offer an owner to BUY, and what our billing record
 * says about the plan they pay for (plan payments P-4.2; workplan §3.4, §3.6;
 * SA M-5, F-2, W-2, W-5, W-7, W-8, W-9, F-C).
 *
 * Built for `GET /api/business-os/entitlements/my-plan`, which takes no input:
 * the account is the session's, the billing row is read by the SESSION user id
 * and the server key's mode, and nothing here comes from the request.
 *
 *   offer      `planPurchaseOffer`, the ONE predicate the checkout also uses
 *              (planCheckoutEligibility.ts), fed from this module's own reads:
 *              the switches, BQ-P10 (`hasOpenEndedFreeAccess` over the
 *              snapshot) and whether our record shows a live subscription
 *              (`isLiveSubscriptionStatus`, the set the checkout refuses on;
 *              SA W-2 and the P-4.1 deviation-1 ruling). The screen shows Choose
 *              for exactly these tiers, so it never offers what the server would
 *              refuse. `planPurchaseOffer.matrix.test.ts` drives THIS function
 *              against the real checkout (SA F-C).
 *   billing    "Renews on" / "Ends on" (F-2), from OUR record only, exactly as
 *              SA W-5 words it. Never a Stripe call (SR-11): this module imports
 *              no Stripe client. P-6a.2 (workplan §5.7): while the price switch
 *              is on, `planPaymentNotice` (the ONE predicate the owner banner
 *              uses too) answers first: a failed renewal, a 3-D Secure request
 *              or an ended subscription, from the same row and the snapshot's
 *              lifecycle. `enforcing` is the server's effective mode (SA Q-5).
 *   endsFreeAccessOnPurchase
 *              the trial / free-access sentence beside the Choose list (W-7),
 *              decided structurally by `freeAccessEndedByPurchase`; `null`
 *              whenever nothing is offered.
 *   upgrade    (P-7b.1b, workplan §3.6; SA U-2) `planUpgradeOffer`, the ONE
 *              predicate both upgrade routes call at their step 5, fed from
 *              the SAME billing row read: the tiers an owner who already pays
 *              may upgrade to now, or `null`. The plan row's tier is not an
 *              input (U-2). `planUpgradeOffer.matrix.test.ts` drives THIS
 *              function against the real preview orchestration.
 *
 * Returns `null` (nothing to offer, no billing sentence) when the plan cannot
 * be read, when the account has no plan row (the checkout refuses both), or
 * when the server key's mode is unknown (the checkout refuses that too). A
 * failed BILLING read never hides the plan: the offer is computed as if there
 * were no record, the checkout still refuses at SR-5 if a subscription is live,
 * and `billing` is `null` (the same choice `heldPaymentView` made).
 *
 * A HELD account is not considered here: it is kept on the holding screen by
 * the page gate and never reaches Settings, and its checkout is decided by
 * `heldPaymentOffer` regardless.
 *
 * It refuses nothing and grants nothing: it describes what the checkout would
 * do. Registered as a non-gate importer of the entitlements module
 * (`enforcementPoints.test.ts`), and as a billing-repository caller in the
 * webhook placement guard (SA W-8).
 *
 * @module lib/business-os/billing/planPurchaseView
 */

import { freeAccessEndedByPurchase, hasOpenEndedFreeAccess } from '@/lib/business-os/entitlements/freeAccess';
import type { FreeAccessEndedByPurchase } from '@/lib/business-os/entitlements/freeAccess';
import { getEntitlementMode } from '@/lib/business-os/entitlements/mode';
import {
  businessOsBillingAccountRepository,
  type BusinessOsBillingAccount,
  type BusinessOsBillingAccountRepository,
} from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { createLogger } from '@/lib/logger';
import { isLiveSubscriptionStatus, type PlanSnapshotLike } from '@/lib/business-os/billing/planCheckout';
import {
  buyableTiers as configBuyableTiers,
  planPurchaseOffer,
  planUpgradeOffer,
  readHeldPaymentSwitches,
  type HeldPaymentSwitches,
} from '@/lib/business-os/billing/planCheckoutEligibility';
import type {
  EndsFreeAccessOnPurchaseWire,
  PlanPurchaseBillingWire,
  PlanPurchaseOfferWire,
  PlanPurchaseWire,
} from '@/lib/business-os/billing/planPurchaseTypes';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import {
  planPaymentNotice,
  type PaymentNoticeLifecycleFacts,
  type PlanPaymentNotice,
} from '@/lib/business-os/billing/planPaymentNotice';

const defaultLogger = createLogger({ module: 'BosPlanPurchaseView' });

/**
 * The structural answer (`freeAccessEndedByPurchase`) to the payload's words
 * (SA W-7). A timed cohort is a trial; an admin-dated one is free access.
 */
const ENDS_FREE_ACCESS: Readonly<Record<Exclude<FreeAccessEndedByPurchase, null>, EndsFreeAccessOnPurchaseWire>> = {
  timed: 'trial',
  admin_dated: 'free_access',
};

export interface PlanPurchaseViewInput {
  /** The session's user id: the billing row is keyed on it. */
  userId: string;
  /** The session's account id, for the logs. */
  accountId: string;
  /**
   * The snapshot the route already read for the session account. P-6a.2 also
   * reads its `lifecycle.state` / `graceEndsAt` (the real resolution has them);
   * absent reads as `unknown`.
   */
  snapshot: PlanSnapshotLike & {
    resolution: (NonNullable<PlanSnapshotLike['resolution']> & { lifecycle: Partial<PaymentNoticeLifecycleFacts> }) | null;
  };
}

export interface PlanPurchaseViewLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
}

export interface PlanPurchaseViewDeps {
  switches?: () => Pick<HeldPaymentSwitches, 'checkoutEnabled' | 'pricesEnabled'>;
  billing?: Pick<BusinessOsBillingAccountRepository, 'findByUser'>;
  mode?: () => StripeMode;
  /** The tiers on sale (M-1). Default `buyableTiers()`, as in the checkout. */
  buyableTiers?: () => readonly string[];
  now?: () => Date;
  logger?: PlanPurchaseViewLogger;
  /** P-6a.2: the EFFECTIVE entitlements mode is `enforce` (SA Q-5). Default: `getEntitlementMode()`. */
  enforcing?: () => boolean;
}

/**
 * F-2, exactly as SA W-5 words it, from our record only.
 *
 *   renewing  `active`, not `cancelAtPeriodEnd`, not ended, period end in the future
 *   ending    `active` with `cancelAtPeriodEnd`
 *   null      anything else, `past_due` included (its period end has not moved,
 *             so a date would be in the past), or a period end we cannot read
 */
export function billingStateFromRecord(
  row: Pick<BusinessOsBillingAccount, 'subscriptionStatus' | 'cancelAtPeriodEnd' | 'currentPeriodEnd' | 'endedAt'>,
  now: Date,
  /** P-6a.2: `planPaymentNotice`'s answer for this row, which wins when there is one. */
  notice: PlanPaymentNotice | null = null
): PlanPurchaseBillingWire | null {
  if (notice) {
    switch (notice.kind) {
      case 'payment_failed':
      case 'paused':
        return { state: 'payment_failed', date: notice.failedAt, attempts: notice.attempts };
      case 'action_required':
        return { state: 'action_required', date: notice.dueOn, confirmUrl: notice.confirmUrl };
      case 'ended':
        return { state: 'ended', date: notice.endedAt };
      default: {
        const unreachable: never = notice;
        throw new Error(`unknown_notice:${String(unreachable)}`);
      }
    }
  }
  if (row.subscriptionStatus !== 'active' || !row.currentPeriodEnd) return null;
  const periodEnd = Date.parse(row.currentPeriodEnd);
  if (!Number.isFinite(periodEnd)) return null;

  if (row.cancelAtPeriodEnd) return { state: 'ending', date: row.currentPeriodEnd };
  if (row.endedAt === null && periodEnd > now.getTime()) return { state: 'renewing', date: row.currentPeriodEnd };
  return null;
}

/**
 * The plan's ending sentence when our record knows it (F-2): a dictionary key
 * and the date, for the component to render. `null` keeps whatever the plan
 * view said (an admin-assigned plan with no billing record says "while the plan
 * is paid for").
 */
export function billingEndsWhen(billing: PlanPurchaseBillingWire | null): { key: string; date: string; count?: number } | null {
  if (!billing) return null;
  switch (billing.state) {
    case 'renewing':
      return { key: 'plan.renews_on', date: billing.date };
    case 'ending':
      return { key: 'plan.ends_on_paid', date: billing.date };
    // P-6a.2: a sentence needs its date; without one the plan keeps its own.
    case 'payment_failed':
      return billing.date ? { key: 'plan.payment_failed_on', date: billing.date, count: billing.attempts } : null;
    case 'action_required':
      return billing.date ? { key: 'plan.payment_action_required_on', date: billing.date } : null;
    case 'ended':
      return { key: 'plan.ended_on', date: billing.date };
    default: {
      const unreachable: never = billing;
      throw new Error(`unknown_billing_state:${String(unreachable)}`);
    }
  }
}

export async function readPlanPurchaseView(
  input: PlanPurchaseViewInput,
  deps: PlanPurchaseViewDeps = {}
): Promise<PlanPurchaseWire | null> {
  const { userId, accountId, snapshot } = input;
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();

  // The checkout refuses an unreadable plan and a missing plan row (step 7), so
  // nothing is offered for either.
  if (snapshot.unavailable || !snapshot.resolution || snapshot.resolution.anomaly === 'no_plan_row') return null;
  const resolution = snapshot.resolution;

  // The server key's mode decides which billing row is ours. Unknown: the
  // checkout refuses every sale (step 5), so nothing is offered.
  let livemode: boolean;
  try {
    livemode = isLiveMode((deps.mode ?? currentStripeMode)());
  } catch {
    log.warn({ event: 'bos_billing_purchase_view_mode_unknown', accountId }, 'Stripe key mode unknown on the plan screen');
    return null;
  }

  // Our record, by the session user and this mode. Never a Stripe call (SR-11).
  let row: BusinessOsBillingAccount | null = null;
  try {
    const result = await (deps.billing ?? businessOsBillingAccountRepository).findByUser(userId, livemode);
    if (result.error) throw result.error;
    row = result.data;
  } catch (err) {
    // Never hides the plan: the offer is computed as if there were no record,
    // and the checkout refuses again at SR-5 if a subscription is live.
    log.warn({ err, event: 'bos_billing_purchase_view_billing_unread', accountId }, 'Billing row unreadable on the plan screen');
    row = null;
  }

  const switches = (deps.switches ?? readHeldPaymentSwitches)();
  // `planPurchaseOffer` / `planUpgradeOffer` type their tiers as `TierId`; the
  // injected list is a test seam, and production reads the same config
  // function the checkout and the upgrade routes do.
  const buyable = (deps.buyableTiers ?? configBuyableTiers)() as ReturnType<typeof configBuyableTiers>;
  const purchaseSwitches = { checkoutEnabled: switches.checkoutEnabled, pricesEnabled: switches.pricesEnabled };
  const offer = planPurchaseOffer(
    {
      openEndedFreeAccess: hasOpenEndedFreeAccess(resolution),
      subscriptionLive: isLiveSubscriptionStatus(row?.subscriptionStatus),
    },
    purchaseSwitches,
    buyable
  );

  // P-7b.1b: the upgrade, from the same row and the same predicate the routes
  // call (planUpgrade.ts step 5). A failed billing read reads as no row, so
  // nothing is offered (`not_subscribed`), never a guess.
  const upgradeOffer = planUpgradeOffer(
    row
      ? {
          boughtTier: row.boughtTier,
          subscriptionId: row.stripeSubscriptionId,
          subscriptionStatus: row.subscriptionStatus,
          cancelAtPeriodEnd: row.cancelAtPeriodEnd,
          endedAt: row.endedAt,
        }
      : null,
    purchaseSwitches,
    buyable
  );

  // Only beside a Choose list: with nothing offered there is no sentence to say.
  const endsFreeAccess = offer.kind === 'choose' ? freeAccessEndedByPurchase(resolution, now) : null;

  const offerWire: PlanPurchaseOfferWire =
    offer.kind === 'choose' ? { kind: 'choose', tiers: [...offer.tiers] } : { kind: 'none', reason: offer.reason };

  // P-6a.2: the one predicate, only while the price switch is on (the banner
  // makes no read at all while it is off, and Settings says nothing more).
  const lifecycle: PaymentNoticeLifecycleFacts = {
    state: resolution.lifecycle.state ?? 'unknown',
    graceEndsAt: resolution.lifecycle.graceEndsAt ?? null,
  };
  const notice =
    row && switches.pricesEnabled
      ? planPaymentNotice(row, lifecycle, { serverLivemode: livemode, enforcing: (deps.enforcing ?? (() => getEntitlementMode() === 'enforce'))() })
      : null;

  return {
    offer: offerWire,
    billing: row ? billingStateFromRecord(row, now, notice) : null,
    endsFreeAccessOnPurchase: endsFreeAccess === null ? null : ENDS_FREE_ACCESS[endsFreeAccess],
    upgrade: upgradeOffer.kind === 'upgrade' ? { tiers: [...upgradeOffer.tiers] } : null,
  };
}

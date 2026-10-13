'use client';

/**
 * Settings → Plan: the Choose list and the embedded checkout (plan payments
 * P-4.2; workplan §3.4, §3.6; SA M-5, M-6, M-8, W-6, W-7).
 *
 * IT RENDERS WHAT THE SERVER SENT; IT DECIDES NOTHING. `tiers` is the server's
 * `purchase.offer.tiers`, from the same predicate the checkout refuses on
 * (`planPurchaseOffer`), so a Choose button is shown exactly where the server
 * would sell. `plans` is the payload's list of every plan shown to customers,
 * with its name and price; one that is shown but not offered says "Coming
 * soon" and has no control (never a dead button). `endsFreeAccess` picks the
 * sentence beside the list; the server decided it.
 *
 * Choose mounts the shared `PlanEmbeddedCheckout` (P-5a.2) with
 * `returnTo: 'settings_plan'`. It POSTs only `{ tier, returnTo }`; the account,
 * email and price come from the server. Once one checkout has started, the
 * other rows' buttons go away, so a second session is never opened beside it.
 * On Stripe's `onComplete` it puts the return marker on the URL
 * (`?section=plan&checkout=<session id>`) and tells the section, which then
 * re-reads the server: success is never claimed here (M-6).
 *
 * A refused start shows a localized line by the route's `code`
 * (`planPurchaseCopy.ts`), never the server's English (M-7).
 *
 * Imports nothing from the entitlements module and no billing VALUE (types
 * only), so no server code reaches the browser bundle (W-6, CLAUDE.md rule 1).
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { PlanEmbeddedCheckout } from '@/components/business-os/billing/PlanEmbeddedCheckout';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { EndsFreeAccessOnPurchaseWire } from '@/lib/business-os/billing/planPurchaseTypes';
import { getStripePromise } from '@/lib/client/stripeJs';

import { fillTemplate, planPurchaseRefusalKey, settingsPlanReturnPath } from './planPurchaseCopy';

/** One plan as the payload lists it (`CustomerPlanChoice`, mirrored over HTTP). */
export interface PlanChoice {
  planId: string;
  name: string;
  monthlyPriceUsd: number;
  availableToBuy: boolean;
}

const ENDS_FREE_ACCESS_KEYS: Record<Exclude<EndsFreeAccessOnPurchaseWire, null>, string> = {
  trial: 'plan.choose.trial_ends_today',
  free_access: 'plan.choose.free_access_ends_today',
};

const CHOOSE_BUTTON =
  'rounded bg-[var(--v2-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60';

export function PlanPurchase({
  plans,
  tiers,
  endsFreeAccess,
  onComplete,
  currentTierId = null,
}: {
  plans: readonly PlanChoice[];
  /** The tiers the server offers (`purchase.offer.tiers`). */
  tiers: readonly string[];
  endsFreeAccess: EndsFreeAccessOnPurchaseWire;
  /** Stripe completed: the section shows "Payment processing" and re-reads. */
  onComplete: (sessionId: string) => void;
  /**
   * The plan in force when it is a TIER (P-7b.1b, SA Q-7): an admin-assigned
   * paid plan with no billing record is offered its own plan. That row reads
   * "Pay for <plan>" with a one-line note, never "Choose" a plan already held.
   * Label only: what is offered is still the server's `tiers`.
   */
  currentTierId?: string | null;
}) {
  const { t } = useLanguage();
  const router = useRouter();
  // M-2: one check for the whole list, so a missing key reads one line, not one per plan.
  const stripeReady = useMemo(() => getStripePromise() !== null, []);
  /** The tier whose start is running or whose frame is open. */
  const [activeTier, setActiveTier] = useState<string | null>(null);
  const [frameOpen, setFrameOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const heading = t('plan.choose.heading');

  return (
    <div className="pt-4 border-t border-[var(--v2-border)] space-y-3" data-testid="plan-purchase">
      <h4 className="text-xs uppercase tracking-wide text-[var(--v2-text-muted)]">{heading}</h4>

      {endsFreeAccess ? (
        <p className="text-xs text-[var(--v2-text-muted)]" data-testid="plan-purchase-ends-free-access">
          {t(ENDS_FREE_ACCESS_KEYS[endsFreeAccess])}
        </p>
      ) : null}

      {!stripeReady ? (
        <p role="alert" className="text-xs text-[var(--v2-text-muted)]" data-testid="plan-purchase-not-configured">
          {t('plan.choose.not_configured')}
        </p>
      ) : null}

      <ul className="space-y-3" aria-label={heading}>
        {plans.map((plan) => {
          const offered = tiers.includes(plan.planId);
          // Once a frame is open, only its own row keeps a checkout.
          const showCheckout = offered && stripeReady && (!frameOpen || activeTier === plan.planId);
          const ownPlan = offered && currentTierId !== null && currentTierId === plan.planId;

          return (
            <li key={plan.planId} className="space-y-2" data-testid={`plan-choice-${plan.planId}`}>
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-sm text-[var(--v2-text-primary)]">{plan.name}</span>
                {plan.monthlyPriceUsd > 0 ? (
                  // Prices stay in digits and USD (SR-15); "excluding tax" travels with them (M-8).
                  <span className="text-xs text-[var(--v2-text-muted)]">
                    {fillTemplate(t('plan.choose.price_ex_tax'), { amount: `$${plan.monthlyPriceUsd}` })}
                  </span>
                ) : null}
                {!offered ? (
                  <span className="inline-block px-1.5 py-0.5 bg-[var(--v2-bg)] text-xs text-[var(--v2-text-muted)] rounded">
                    {t('plan.next.coming_soon')}
                  </span>
                ) : null}
              </div>

              {ownPlan ? (
                <p className="text-xs text-[var(--v2-text-muted)]" data-testid="plan-choice-own-plan-note">
                  {fillTemplate(t('plan.choose.own_plan_note'), { plan: plan.name })}
                </p>
              ) : null}

              {showCheckout ? (
                <PlanEmbeddedCheckout
                  tier={plan.planId}
                  returnTo="settings_plan"
                  labels={{
                    start: fillTemplate(t(ownPlan ? 'plan.choose.button_own' : 'plan.choose.button'), { plan: plan.name }),
                    starting: t('plan.choose.starting'),
                    notConfigured: t('plan.choose.not_configured'),
                  }}
                  buttonClassName={CHOOSE_BUTTON}
                  frameClassName="rounded border border-[var(--v2-border)] p-2"
                  disabled={activeTier !== null && activeTier !== plan.planId}
                  testId={`plan-choose-${plan.planId}`}
                  onRequest={() => {
                    setMessage(null);
                    setActiveTier(plan.planId);
                  }}
                  onStarted={() => setFrameOpen(true)}
                  onRefused={(refusal) => {
                    setActiveTier(null);
                    setMessage(t(planPurchaseRefusalKey(refusal)));
                  }}
                  onRequestFailed={() => {
                    setActiveTier(null);
                    setMessage(t('plan.refusal.generic'));
                  }}
                  onComplete={(sessionId) => {
                    onComplete(sessionId);
                    router.replace(settingsPlanReturnPath(sessionId), { scroll: false });
                  }}
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      {message ? (
        <p role="alert" data-testid="plan-purchase-refused" className="text-sm text-red-700">
          {message}
        </p>
      ) : null}
    </div>
  );
}

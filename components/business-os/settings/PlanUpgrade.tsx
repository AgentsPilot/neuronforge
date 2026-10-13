'use client';

/**
 * Settings → Plan: "Upgrade to <plan>" for an owner who already pays (plan
 * payments P-7b.1b; workplan §3.7, §10; SA U-5, V-1, V-2, V-3, V-4, Q-2, Q-4,
 * Q-5, Q-6; user decision 2026-10-13 on the E-5 wording).
 *
 * IT RENDERS WHAT THE SERVER SENT; IT DECIDES NOTHING. `tiers` is the server's
 * `purchase.upgrade.tiers`, from the same predicate both upgrade routes refuse
 * on (`planUpgradeOffer`), so a button is shown exactly where the server would
 * get past our own data. Names and prices come from the payload (`plans`) and
 * the preview's answer, never a literal (FR-12).
 *
 *   Upgrade      POST the preview { tier }: the amount due now, "excluding
 *                tax", the unchanged renewal date and the monthly price
 *   Confirm      POST the confirm { tier, prorationDate } (the preview's date)
 *     upgraded / processing (Q-4) → the section says "Upgrading…" and re-reads
 *     action_required → Stripe.js `handleNextAction` (3-D Secure in place);
 *                  completed → "Upgrading…" and the re-read; closed, failed or
 *                  refused → "The payment was not confirmed, so nothing
 *                  changed."; a throw or any other error → unknown (SA G-1)
 *     declined     "Your card was declined, so nothing changed." + the time
 *                  it can be retried (Q-6: Stripe keeps the pending update, E-2)
 *     unknown      (V-3) the write was attempted and its answer lost: "We could
 *                  not confirm your upgrade", Check again (one server re-read)
 *                  and Try again, which re-posts the SAME `prorationDate` so the
 *                  idempotency key replays at Stripe and never charges twice
 *     refusal      a localised line by code (`planUpgradeCopy.ts`); the preview's
 *                  `upgrade_awaiting_confirmation` (Q-2) offers the confirm again;
 *                  `upgrade_processing` / `not_an_upgrade` go to the re-read
 *
 * SUCCESS IS NEVER CLAIMED HERE: only `PlanSection`'s re-read of my-plan can
 * say "You're on <plan>" (U-5).
 *
 * THE CONFIRMATION SECRET (SA V-1) lives only in the local variable of the
 * handler that passes it to `handleNextAction`: never in state, a URL,
 * storage or a log line.
 *
 * Imports nothing from the entitlements module and no billing VALUE (types
 * only), so no server code reaches the browser bundle (W-6, CLAUDE.md rule 1).
 */

import { useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { getStripePromise } from '@/lib/client/stripeJs';
import { createLogger } from '@/lib/logger';

import type { PlanChoice } from './PlanPurchase';
import { fillTemplate } from './planPurchaseCopy';
import {
  PLAN_UPGRADE_CONFIRM_PATH,
  PLAN_UPGRADE_PREVIEW_PATH,
  PLAN_UPGRADE_REREAD_CODES,
  formatAccountDay,
  formatAccountTime,
  formatMonthlyUsdMinor,
  formatUsdMinor,
  planUpgradeRefusalKey,
  upgradeDueKey,
} from './planUpgradeCopy';

const logger = createLogger({ module: 'BusinessOsPlanUpgrade' });

const PRIMARY_BUTTON = 'rounded bg-[var(--v2-primary)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60';
const SECONDARY_BUTTON = 'rounded border border-[var(--v2-border)] px-3 py-1.5 text-xs text-[var(--v2-text-primary)] disabled:opacity-60';

/** The preview's 200 body, as the route sends it. */
interface Quote {
  amountDueMinor: number;
  prorationDate: number;
  renewsOn: string | null;
  monthlyPriceMinor: number;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'previewing'; tier: string }
  | { kind: 'quoted'; tier: string; quote: Quote }
  | { kind: 'awaiting'; tier: string; amountDueMinor: number | null; prorationDate: number }
  | { kind: 'confirming'; tier: string; prorationDate: number; shown: Phase }
  | { kind: 'authenticating'; tier: string }
  | { kind: 'declined'; tier: string; retryAfter: string | null }
  | { kind: 'not_confirmed'; tier: string }
  | { kind: 'unknown'; tier: string; prorationDate: number; checking: boolean }
  | { kind: 'refused'; tier: string; message: string };

interface RouteAnswer {
  status: number;
  body: Record<string, unknown> | null;
}

async function post(path: string, payload: Record<string, unknown>): Promise<RouteAnswer> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/**
 * What `handleNextAction` returned, in the only terms the screen needs (SA G-1,
 * V-3 on the client). Structural, so Stripe.js's own result type fits it.
 */
interface NextActionResult {
  paymentIntent?: { status?: string | null } | null;
  error?: { type?: string | null; code?: string | null; payment_intent?: { status?: string | null } | null } | null;
}

/** The PaymentIntent went through or is going through: the change lands. */
const CONFIRMED_INTENT_STATUSES: readonly string[] = ['succeeded', 'processing', 'requires_capture'];
/** Not paid and not being paid: the pending update expires and its invoice is voided (E-4). */
const REFUSED_INTENT_STATUSES: readonly string[] = ['requires_payment_method', 'requires_action', 'canceled'];

/**
 * `upgrading`: the payment is known to have gone through. `not_confirmed`: it is
 * known NOT to have (a refusal, or the owner closed or failed the challenge;
 * Stripe.js reports that as `payment_intent_authentication_failure`). Anything
 * else (a transport, API or rate-limit error, an unrecognised status) is
 * `unknown`: the challenge may have completed, so never "nothing changed".
 */
export function classifyNextAction(result: NextActionResult): 'upgrading' | 'not_confirmed' | 'unknown' {
  const status = result.paymentIntent?.status ?? result.error?.payment_intent?.status ?? null;
  if (status !== null && CONFIRMED_INTENT_STATUSES.includes(status)) return 'upgrading';
  if (status !== null && REFUSED_INTENT_STATUSES.includes(status)) return 'not_confirmed';
  if (result.error?.type === 'card_error' || result.error?.code === 'payment_intent_authentication_failure') return 'not_confirmed';
  return 'unknown';
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

export function PlanUpgrade({
  plans,
  tiers,
  currentPlan,
  onUpgrading,
  onCheckAgain,
}: {
  plans: readonly PlanChoice[];
  /** The tiers the server offers (`purchase.upgrade.tiers`). */
  tiers: readonly string[];
  /** The plan in force, when it is a tier: the Q-5 note, and the "still on" line. */
  currentPlan: { planId: string | null; name: string | null; isTier: boolean };
  /** The change went through or is landing: the section says "Upgrading…" and re-reads (U-5). */
  onUpgrading: (tier: string) => void;
  /** One server re-read (V-3 "Check again"). */
  onCheckAgain: (tier: string) => Promise<void>;
}) {
  const { t, language, timezone } = useLanguage();
  // M-2: without a usable publishable key the confirm is never posted (3-D Secure could not be completed).
  const stripeReady = useMemo(() => getStripePromise() !== null, []);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // One request at a time, whatever React has rendered yet (a double click posts once).
  const inFlight = useRef(false);

  const offered = tiers.flatMap((tier) => {
    const plan = plans.find((candidate) => candidate.planId === tier);
    return plan ? [plan] : [];
  });
  if (offered.length === 0) return null;

  const stillOn = currentPlan.name ?? '';
  const activeTier = phase.kind === 'idle' ? null : phase.tier;
  const flowOpen = phase.kind === 'previewing' || phase.kind === 'quoted' || phase.kind === 'awaiting' || phase.kind === 'confirming' || phase.kind === 'authenticating' || phase.kind === 'unknown';

  const refused = (tier: string, answer: RouteAnswer) => {
    const code = stringOrNull(answer.body?.code);
    if (code !== null && PLAN_UPGRADE_REREAD_CODES.includes(code)) {
      setPhase({ kind: 'idle' });
      onUpgrading(tier);
      return;
    }
    if (code === 'upgrade_pending') {
      const retryAfter = stringOrNull(answer.body?.retryAfter);
      const time = retryAfter ? formatAccountTime(retryAfter, language, timezone) : null;
      setPhase({
        kind: 'refused',
        tier,
        message: time ? fillTemplate(t('plan.upgrade.refusal.pending'), { time }) : t('plan.upgrade.refusal.pending_no_time'),
      });
      return;
    }
    setPhase({ kind: 'refused', tier, message: t(planUpgradeRefusalKey({ httpStatus: answer.status, code })) });
  };

  async function preview(tier: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: 'previewing', tier });
    try {
      const answer = await post(PLAN_UPGRADE_PREVIEW_PATH, { tier });
      const data = answer.body?.success === true ? (answer.body.data as Record<string, unknown> | undefined) : undefined;
      if (answer.status === 200 && data && isNumber(data.amountDueMinor) && isNumber(data.prorationDate) && isNumber(data.monthlyPriceMinor)) {
        setPhase({
          kind: 'quoted',
          tier,
          quote: {
            amountDueMinor: data.amountDueMinor,
            prorationDate: data.prorationDate,
            renewsOn: stringOrNull(data.renewsOn),
            monthlyPriceMinor: data.monthlyPriceMinor,
          },
        });
        return;
      }
      if (answer.body?.code === 'upgrade_awaiting_confirmation' && isNumber(answer.body.prorationDate)) {
        // Q-2: our own upgrade waits for 3-D Secure; the confirm resumes it. Never a secret here.
        setPhase({
          kind: 'awaiting',
          tier,
          amountDueMinor: isNumber(answer.body.amountDueMinor) ? answer.body.amountDueMinor : null,
          prorationDate: answer.body.prorationDate,
        });
        return;
      }
      refused(tier, answer);
    } catch (err) {
      // A preview writes nothing: a lost answer is simply "try again".
      logger.warn({ err }, 'Plan upgrade preview request failed');
      setPhase({ kind: 'refused', tier, message: t('plan.upgrade.refusal.generic') });
    } finally {
      inFlight.current = false;
    }
  }

  /** 3-D Secure in place (E-1b). The secret is this function's argument and nothing else's. */
  async function authenticate(tier: string, clientSecret: string, prorationDate: number) {
    const loading = getStripePromise();
    const stripe = loading ? await loading : null;
    if (!stripe) {
      // Nothing was confirmed: the unpaid invoice is voided when its pending update expires (E-4).
      setPhase({ kind: 'not_confirmed', tier });
      return;
    }
    setPhase({ kind: 'authenticating', tier });
    let result: Awaited<ReturnType<typeof stripe.handleNextAction>>;
    try {
      result = await stripe.handleNextAction({ clientSecret });
    } catch (err) {
      // Stripe.js itself failed: the challenge may or may not have completed (V-3).
      logger.warn({ errName: err instanceof Error ? err.name : typeof err }, 'Stripe.js next action failed');
      setPhase({ kind: 'unknown', tier, prorationDate, checking: false });
      return;
    }
    const reading = classifyNextAction(result);
    if (reading === 'upgrading') {
      setPhase({ kind: 'idle' });
      onUpgrading(tier);
      return;
    }
    if (reading === 'not_confirmed') {
      // Closed, failed or refused by the bank: the pending update stays until it expires and nothing changes (E-4).
      setPhase({ kind: 'not_confirmed', tier });
      return;
    }
    // Not known to be a refusal (G-1, V-3): the payment may have gone through.
    logger.warn({ errType: result.error?.type ?? null, errCode: result.error?.code ?? null }, 'Stripe.js next action answer not conclusive');
    setPhase({ kind: 'unknown', tier, prorationDate, checking: false });
  }

  async function confirm(tier: string, prorationDate: number, shown: Phase) {
    if (inFlight.current || !stripeReady) return;
    inFlight.current = true;
    setPhase({ kind: 'confirming', tier, prorationDate, shown });
    try {
      let answer: RouteAnswer;
      try {
        answer = await post(PLAN_UPGRADE_CONFIRM_PATH, { tier, prorationDate });
      } catch (err) {
        // The request may have reached the server (V-3): never "nothing changed".
        logger.warn({ errName: err instanceof Error ? err.name : typeof err }, 'Plan upgrade confirm request failed');
        setPhase({ kind: 'unknown', tier, prorationDate, checking: false });
        return;
      }
      const data = answer.body?.success === true ? (answer.body.data as Record<string, unknown> | undefined) : undefined;
      if (answer.status === 200 && data) {
        switch (data.outcome) {
          case 'upgraded':
          case 'processing':
            setPhase({ kind: 'idle' });
            onUpgrading(tier);
            return;
          case 'declined':
            setPhase({ kind: 'declined', tier, retryAfter: stringOrNull(data.retryAfter) });
            return;
          case 'action_required': {
            const clientSecret = stringOrNull(data.clientSecret);
            if (clientSecret) {
              await authenticate(tier, clientSecret, prorationDate);
              return;
            }
            setPhase({ kind: 'unknown', tier, prorationDate, checking: false });
            return;
          }
          default:
            setPhase({ kind: 'unknown', tier, prorationDate, checking: false });
            return;
        }
      }
      // V-3: the write was attempted and its answer lost, or the server failed without a code.
      if ((answer.body?.code === 'stripe_error' && answer.body.outcomeUnknown === true) || (answer.status >= 500 && !answer.body?.code)) {
        setPhase({ kind: 'unknown', tier, prorationDate, checking: false });
        return;
      }
      refused(tier, answer);
    } finally {
      inFlight.current = false;
    }
  }

  async function checkAgain(tier: string, prorationDate: number) {
    setPhase({ kind: 'unknown', tier, prorationDate, checking: true });
    await onCheckAgain(tier);
    // If the server now shows the plan, the section replaces this island; otherwise stay unsure.
    setPhase((current) => (current.kind === 'unknown' ? { ...current, checking: false } : current));
  }

  const renderFlow = (tier: string, planName: string) => {
    if (phase.kind === 'idle' || phase.tier !== tier) return null;
    const view = phase.kind === 'confirming' ? phase.shown : phase;
    const busy = phase.kind === 'confirming' || phase.kind === 'authenticating';

    if (phase.kind === 'previewing') {
      return (
        <p role="status" className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)]" data-testid="plan-upgrade-previewing">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{t('plan.upgrade.previewing')}</span>
        </p>
      );
    }

    if (phase.kind === 'authenticating') {
      return (
        <p role="status" className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)]" data-testid="plan-upgrade-authenticating">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{t('plan.upgrade.upgrading')}</span>
        </p>
      );
    }

    if (view.kind === 'quoted' || view.kind === 'awaiting') {
      const amountDue = view.kind === 'quoted' ? view.quote.amountDueMinor : view.amountDueMinor;
      const prorationDate = view.kind === 'quoted' ? view.quote.prorationDate : view.prorationDate;
      const renewsOn = view.kind === 'quoted' && view.quote.renewsOn ? formatAccountDay(view.quote.renewsOn, language, timezone) : null;
      return (
        <div className="space-y-1.5" data-testid="plan-upgrade-quote">
          {view.kind === 'awaiting' ? (
            <p className="text-xs text-[var(--v2-text-primary)]" data-testid="plan-upgrade-awaiting">
              {t('plan.upgrade.awaiting_confirmation')}
            </p>
          ) : null}
          {amountDue !== null ? (
            // Prices stay in digits and USD (SR-15); "excluding tax" travels with them (V-12).
            <p className="text-sm text-[var(--v2-text-primary)]" data-testid="plan-upgrade-due">
              {fillTemplate(t(upgradeDueKey(amountDue)), { amount: formatUsdMinor(amountDue) })}
            </p>
          ) : null}
          {view.kind === 'quoted' && renewsOn ? (
            <p className="text-xs text-[var(--v2-text-muted)]" data-testid="plan-upgrade-then">
              {fillTemplate(t('plan.upgrade.then'), { date: renewsOn, price: formatMonthlyUsdMinor(view.quote.monthlyPriceMinor) })}
            </p>
          ) : null}
          <p className="text-xs text-[var(--v2-text-muted)]">{fillTemplate(t('plan.upgrade.immediate'), { plan: planName })}</p>
          {!stripeReady ? (
            <p role="alert" className="text-xs text-[var(--v2-text-muted)]" data-testid="plan-upgrade-not-configured">
              {t('plan.choose.not_configured')}
            </p>
          ) : null}
          <div className="flex gap-2 pt-1">
            {stripeReady ? (
              <button
                type="button"
                className={PRIMARY_BUTTON}
                disabled={busy}
                data-testid={`plan-upgrade-confirm-${tier}`}
                onClick={() => void confirm(tier, prorationDate, view)}
              >
                {busy ? <Loader2 className="inline w-3.5 h-3.5 me-1 animate-spin" /> : null}
                {t('plan.upgrade.confirm')}
              </button>
            ) : null}
            <button type="button" className={SECONDARY_BUTTON} disabled={busy} onClick={() => setPhase({ kind: 'idle' })}>
              {t('plan.upgrade.cancel')}
            </button>
          </div>
        </div>
      );
    }

    if (phase.kind === 'declined') {
      const time = phase.retryAfter ? formatAccountTime(phase.retryAfter, language, timezone) : null;
      return (
        <div role="alert" className="space-y-1" data-testid="plan-upgrade-declined">
          <p className="text-sm text-red-700">{fillTemplate(t('plan.upgrade.declined'), { plan: stillOn })}</p>
          {time ? <p className="text-xs text-[var(--v2-text-muted)]">{fillTemplate(t('plan.upgrade.retry_after'), { time })}</p> : null}
        </div>
      );
    }

    if (phase.kind === 'not_confirmed') {
      return (
        <p role="alert" className="text-sm text-red-700" data-testid="plan-upgrade-not-confirmed">
          {fillTemplate(t('plan.upgrade.not_confirmed'), { plan: stillOn })}
        </p>
      );
    }

    if (view.kind === 'unknown') {
      const unsure = view;
      const waiting = busy || unsure.checking;
      return (
        <div role="alert" className="space-y-1.5" data-testid="plan-upgrade-unknown">
          {/* Never "nothing changed" (V-3): the change may have been made. */}
          <p className="text-sm text-[var(--v2-text-primary)]">{t('plan.upgrade.not_sure')}</p>
          <div className="flex gap-2">
            <button
              type="button"
              className={SECONDARY_BUTTON}
              disabled={waiting}
              data-testid="plan-upgrade-check-again"
              onClick={() => void checkAgain(tier, unsure.prorationDate)}
            >
              {t('plan.purchase.check_again')}
            </button>
            {/* The SAME prorationDate: the idempotency key replays at Stripe, never a second charge (V-3). */}
            {stripeReady ? (
              <button
                type="button"
                className={SECONDARY_BUTTON}
                disabled={waiting}
                data-testid="plan-upgrade-try-again"
                onClick={() => void confirm(tier, unsure.prorationDate, { ...unsure, checking: false })}
              >
                {t('plan.upgrade.try_again')}
              </button>
            ) : null}
          </div>
        </div>
      );
    }

    if (phase.kind === 'refused') {
      return (
        <p role="alert" className="text-sm text-red-700" data-testid="plan-upgrade-refused">
          {phase.message}
        </p>
      );
    }
    return null;
  };

  return (
    <div className="pt-4 border-t border-[var(--v2-border)] space-y-3" data-testid="plan-upgrade">
      <ul className="space-y-3">
        {offered.map((plan) => {
          // Another tier's flow is open: this one waits (never two upgrades side by side).
          if (flowOpen && activeTier !== plan.planId) return null;
          const showButton = !flowOpen || activeTier !== plan.planId;
          // Q-5: the plan in force is already the target (an admin-assigned plan on a lower paid tier).
          const ownPlan = currentPlan.isTier && currentPlan.planId === plan.planId;
          return (
            <li key={plan.planId} className="space-y-2" data-testid={`plan-upgrade-${plan.planId}`}>
              {ownPlan && showButton ? (
                <p className="text-xs text-[var(--v2-text-muted)]" data-testid="plan-upgrade-own-plan-note">
                  {fillTemplate(t('plan.upgrade.own_plan_note'), { plan: plan.name })}
                </p>
              ) : null}
              {showButton ? (
                <button type="button" className={PRIMARY_BUTTON} data-testid={`plan-upgrade-button-${plan.planId}`} onClick={() => void preview(plan.planId)}>
                  {fillTemplate(t('plan.upgrade.button'), { plan: plan.name })}
                </button>
              ) : null}
              {renderFlow(plan.planId, plan.name)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

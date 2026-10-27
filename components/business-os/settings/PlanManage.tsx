'use client';

/**
 * Cancel and reactivate, in Settings → Plan (plan payments P-7a.1; workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §2.1, §4.2; SA C-1,
 * C-5).
 *
 * IT RENDERS; IT DOES NOT DECIDE. Which control appears comes from the server:
 * `purchase.manage` is `planManageOffer`, the same predicate the cancel and
 * reactivate routes refuse on (C-1), so a button appears exactly where the
 * route gets past our own data. What only Stripe knows is answered by the
 * route, and this island shows its answer.
 *
 * Cancel asks first, inline (the drawer and the pop-up are already dialogs, so
 * no nested dialog): "You keep {plan} until {date} … nothing is refunded".
 * Reactivate needs no confirmation: it charges nothing now. Both post `{}`
 * (C-5); the routes take the account from the session only.
 *
 * After any answer that may have changed something (done, `unchanged`, or a
 * refusal whose outcome is unknown) it calls `onChanged`, so the host re-reads
 * my-plan and the "Renews on" / "Ends on" line follows the server. The line it
 * shows itself comes from the route's own answer, so a failed re-read never
 * hides what happened.
 *
 * P-7a.4 (BQ-3 = A; SA C-11, TQ-12): with `manage.paymentFailed` the
 * confirmation says the plan ENDS NOW, not "until {date}". The route decides
 * the real mode on Stripe's fresh status, and the line after the press says
 * what happened (`mode: 'immediate'` / `state: 'ended'` → "has ended").
 *
 * P-7a.2: "Update card" and "Invoices" (`PlanCardAndInvoices`) render here
 * too, where `manage.cardAndInvoices` is set; the hosts are unchanged.
 *
 * Imports nothing from the entitlements module and no server file (the copy
 * map type-imports the refusal codes only).
 */

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

import { PlanCardAndInvoices } from './PlanCardAndInvoices';
import type { PlanPayload } from './planPayloadTypes';
import { PLAN_CANCEL_PATH, PLAN_REACTIVATE_PATH, planManageRefusalKey } from './planManageCopy';
import { fill } from './planText';
import { formatAccountDay } from './planUpgradeCopy';

const logger = createLogger({ module: 'BusinessOsPlanManage' });

const PRIMARY_BUTTON = 'rounded bg-[var(--v2-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60';
const SECONDARY_BUTTON = 'rounded border border-[var(--v2-border)] px-3 py-1.5 text-xs text-[var(--v2-text-primary)] disabled:opacity-60';

type Action = 'cancel' | 'reactivate';
type Phase = { kind: 'idle' } | { kind: 'confirming' } | { kind: 'busy'; action: Action };
type Notice = { kind: 'done'; text: string } | { kind: 'refused'; key: string } | null;

interface RouteAnswer {
  status: number;
  body: Record<string, unknown> | null;
}

async function post(path: string): Promise<RouteAnswer> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // SA C-5: always `{}`; the route refuses anything else.
    body: JSON.stringify({}),
  });
  let body: Record<string, unknown> | null = null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

export function PlanManage({ plan, onChanged }: { plan: PlanPayload; onChanged?: () => void }) {
  const { t, language, timezone } = useLanguage();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<Notice>(null);

  const manage = plan.purchase?.manage;
  if (!manage && notice === null) return null;

  const planName = plan.name ?? '';
  // P-7a.4: a failed renewal; Cancel ends the plan now.
  const endsNow = manage?.paymentFailed === true && manage.cancel;
  const day = (iso: string | null) => (iso ? formatAccountDay(iso, language, timezone) : null);
  // Only the DATE for the confirmation sentence. This is not a success
  // predicate: "You're on …" stays usePlanFlow's alone (upgrade modal C-2).
  const billing = plan.purchase?.billing ?? null;
  const renewalDate = billing !== null && billing.state === 'renewing' ? billing.date : null;
  const renewsOn = day(renewalDate);

  const run = async (action: Action) => {
    setPhase({ kind: 'busy', action });
    setNotice(null);
    try {
      const answer = await post(action === 'cancel' ? PLAN_CANCEL_PATH : PLAN_REACTIVATE_PATH);
      const data = answer.body?.data as Record<string, unknown> | undefined;
      if (answer.status === 200 && answer.body?.success === true && data) {
        const outcome = data.outcome;
        // SA P-7a.1 F-1: `unchanged` (already so at Stripe: a second tab, or a
        // date set in the Stripe dashboard that our record does not mirror, X-2)
        // says what Stripe holds, from the route's own answer, so a stale
        // re-read never leaves the press with no visible result.
        const state = outcome === 'unchanged' ? data.state : null;
        if ((outcome === 'cancelled' && data.mode === 'immediate') || state === 'ended') {
          // P-7a.4: ended now (or already ended at Stripe).
          setNotice({ kind: 'done', text: fill(t('plan.manage.ended_now'), { plan: planName }) });
        } else if (outcome === 'cancelled' || state === 'cancelling') {
          const ends = day(stringOrNull(outcome === 'cancelled' ? data.endsOn : data.date));
          setNotice({
            kind: 'done',
            text: ends ? fill(t('plan.manage.cancelled'), { plan: planName, date: ends }) : fill(t('plan.manage.cancelled_nodate'), { plan: planName }),
          });
        } else if (outcome === 'reactivated' || state === 'renewing') {
          const renews = day(stringOrNull(outcome === 'reactivated' ? data.renewsOn : data.date));
          setNotice({ kind: 'done', text: renews ? fill(t('plan.manage.reactivated'), { date: renews }) : t('plan.manage.reactivated_nodate') });
        }
        onChanged?.();
      } else {
        const code = stringOrNull(answer.body?.code);
        const outcomeUnknown = answer.body?.outcomeUnknown === true;
        setNotice({ kind: 'refused', key: planManageRefusalKey({ httpStatus: answer.status, code, outcomeUnknown }) });
        // The change may have been made, or our row was healed: follow the server.
        if (outcomeUnknown || answer.status === 409) onChanged?.();
      }
    } catch (err) {
      logger.warn({ err, action }, 'Plan cancel / reactivate request failed');
      setNotice({ kind: 'refused', key: 'plan.manage.refusal.unknown' });
      onChanged?.();
    } finally {
      setPhase({ kind: 'idle' });
    }
  };

  const busy = phase.kind === 'busy';

  return (
    <div className="space-y-2 pt-2" data-testid="plan-manage">
      {manage?.paymentFailed && (
        <p className="text-xs text-[var(--v2-text-secondary)]" data-testid="plan-manage-payment-failed">
          {t('plan.manage.payment_failed_cancel_now')}
        </p>
      )}

      {manage?.cancel && phase.kind === 'idle' && (
        <button type="button" className={SECONDARY_BUTTON} onClick={() => setPhase({ kind: 'confirming' })} data-testid="plan-manage-cancel">
          {t('plan.manage.cancel_button')}
        </button>
      )}

      {/* P-7a.4: the failed-payment confirmation says "ends now" (C-11). */}
      {phase.kind === 'confirming' && endsNow && (
        <div role="group" aria-label={t('plan.manage.cancel_button')} className="space-y-2" data-testid="plan-manage-confirm-now">
          <p className="text-xs text-[var(--v2-text-primary)]">{fill(t('plan.manage.cancel_now_body'), { plan: planName })}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY_BUTTON} onClick={() => void run('cancel')} data-testid="plan-manage-cancel-confirm">
              {t('plan.manage.cancel_now_confirm')}
            </button>
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setPhase({ kind: 'idle' })} data-testid="plan-manage-keep">
              {t('plan.manage.keep')}
            </button>
          </div>
        </div>
      )}

      {phase.kind === 'confirming' && !endsNow && (
        <div role="group" aria-label={t('plan.manage.cancel_button')} className="space-y-2" data-testid="plan-manage-confirm">
          <p className="text-xs text-[var(--v2-text-primary)]">
            {renewsOn
              ? fill(t('plan.manage.cancel_confirm_body'), { plan: planName, date: renewsOn })
              : fill(t('plan.manage.cancel_confirm_body_nodate'), { plan: planName })}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY_BUTTON} onClick={() => void run('cancel')} data-testid="plan-manage-cancel-confirm">
              {t('plan.manage.cancel_confirm')}
            </button>
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setPhase({ kind: 'idle' })} data-testid="plan-manage-keep">
              {t('plan.manage.keep')}
            </button>
          </div>
        </div>
      )}

      {manage?.reactivate && phase.kind === 'idle' && (
        <button type="button" className={PRIMARY_BUTTON} onClick={() => void run('reactivate')} data-testid="plan-manage-reactivate">
          {t('plan.manage.reactivate_button')}
        </button>
      )}

      {busy && (
        <p role="status" className="flex items-center gap-2 text-xs text-[var(--v2-text-secondary)]" data-testid="plan-manage-busy">
          <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
          <span>{t(phase.action === 'cancel' ? 'plan.manage.cancelling' : 'plan.manage.reactivating')}</span>
        </p>
      )}

      {/* P-7a.2: Update card and Invoices, exactly where `manage.cardAndInvoices` says. */}
      {manage?.cardAndInvoices && <PlanCardAndInvoices />}

      {notice?.kind === 'done' && (
        <p role="status" className="text-xs text-[var(--v2-text-primary)]" data-testid="plan-manage-done">
          {notice.text}
        </p>
      )}
      {notice?.kind === 'refused' && (
        <p role="alert" className="text-xs text-[var(--v2-text-secondary)]" data-testid="plan-manage-refused">
          {t(notice.key)}
        </p>
      )}
    </div>
  );
}

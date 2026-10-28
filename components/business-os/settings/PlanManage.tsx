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
 * Cancel opens the four-step Cancel drawer (D3 / SX-2, `PlanCancelDrawer`:
 * reason → what changes → review → confirm), a drawer nested in the Plan
 * drawer or the plan pop-up (SA Q-2). It posts `{ reasonCode }` itself and
 * hands the route's answer back here, so the outcome shows on this card, in
 * the same lines as before, after the drawer has closed. Reactivate, labelled
 * "Keep my plan" since D3, needs no confirmation: it charges nothing now, and
 * posts `{}` (C-5). The routes take the account from the session only.
 *
 * After any answer that may have changed something (done, `unchanged`, or a
 * refusal whose outcome is unknown) it calls `onChanged`, so the host re-reads
 * my-plan and the "Renews on" / "Ends on" line follows the server. The line it
 * shows itself comes from the route's own answer, so a failed re-read never
 * hides what happened.
 *
 * P-7a.4 (BQ-3 = A; SA C-11, TQ-12): with `manage.paymentFailed` the Cancel
 * drawer opens in `mode="now"` (D3 T-13): its review and confirm steps say the
 * plan ENDS TODAY, not "until {date}", and the reason step is still required
 * (D3 SA ruling 6). The body is the same `{ reasonCode }` (P-7a.4 adds no body
 * field, so no `requestExtra`): the route decides the real mode on Stripe's
 * fresh status, and the line after the press says what happened
 * (`mode: 'immediate'` / `state: 'ended'` → "has ended").
 *
 * P-7a.2: "Update card" and "Invoices" (`PlanCardAndInvoices`) render here
 * too, where `manage.cardAndInvoices` is set; the hosts are unchanged.
 *
 * P-7a.3 (BQ-5): where the server sends `manage.freeAccessAfter` (a Founding
 * Partner whose free access outlives the paid plan by more than the 24 h
 * margin), one sentence names the return to free access and its end date: in
 * the Cancel drawer (steps 2 and 4, D3 SA R-4c), in both of its modes (the
 * "until {date}" one and the P-7a.4 "ends now" one, SA P-7a.4 deviation 8),
 * and under "Keep my plan" while the plan is set to end.
 * The server decides when it is true; this island only formats the date.
 *
 * Imports nothing from the entitlements module and no server file (the copy
 * map type-imports the refusal codes only).
 */

import { useMemo, useRef, useState, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

import { PlanCancelDrawer } from './PlanCancelDrawer';
import { PlanCardAndInvoices } from './PlanCardAndInvoices';
import type { PlanPayload } from './planPayloadTypes';
import { PLAN_REACTIVATE_PATH, planManageRefusalKey } from './planManageCopy';
import { postPlanManage, type PlanManageAnswer } from './planManageRequest';
import { fill } from './planText';
import { formatAccountDay } from './planUpgradeCopy';

const logger = createLogger({ module: 'BusinessOsPlanManage' });

const PRIMARY_BUTTON = 'rounded bg-[var(--v2-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60';
const SECONDARY_BUTTON = 'rounded border border-[var(--v2-border)] px-3 py-1.5 text-xs text-[var(--v2-text-primary)] disabled:opacity-60';

type Action = 'cancel' | 'reactivate';
type Phase = { kind: 'idle' } | { kind: 'busy'; action: Action };
type Notice = { kind: 'done'; text: string } | { kind: 'refused'; key: string } | null;

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

export function PlanManage({ plan, onChanged }: { plan: PlanPayload; onChanged?: () => void }) {
  const { t, language, timezone } = useLanguage();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [notice, setNotice] = useState<Notice>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const noticeRef = useRef<HTMLParagraphElement | null>(null);
  /*
   * Where focus lands when the Cancel drawer closes (SA D3 finding 2, QA 8).
   * After an answer, the line that states it: the re-read that follows a
   * successful cancel removes "Cancel plan", and focus on a removed button
   * drops to <body>. The notice stays through the re-read (it is this
   * island's own state). With no answer (closed, or "Don't cancel"), the
   * notice was cleared on open, so focus goes back to "Cancel plan". Read at
   * close time, hence the getter.
   */
  const drawerReturnFocusRef = useMemo<RefObject<HTMLElement | null>>(
    () => ({
      get current() {
        return noticeRef.current ?? cancelButtonRef.current;
      },
    }),
    []
  );

  const manage = plan.purchase?.manage;
  if (!manage && notice === null) return null;

  const planName = plan.name ?? '';
  // P-7a.4: a failed renewal; Cancel ends the plan now (the drawer's `now` mode).
  const endsNow = manage?.paymentFailed === true && manage.cancel;
  const day = (iso: string | null) => (iso ? formatAccountDay(iso, language, timezone) : null);
  // P-7a.3 (BQ-5): the free-access end, only when the server sent it.
  const freeUntil = day(manage?.freeAccessAfter?.endsAt ?? null);
  const foundingLine = freeUntil ? fill(t('plan.manage.cancel_confirm_founding'), { freeUntil }) : null;

  /**
   * The route's answer → the line on this card, for both actions (lifted out
   * of the old `run` by D3 so the Cancel drawer's answer is read by the same
   * code, not a copy). `null` means the request itself failed.
   */
  const applyAnswer = (answer: PlanManageAnswer | null) => {
    if (answer === null) {
      setNotice({ kind: 'refused', key: 'plan.manage.refusal.unknown' });
      onChanged?.();
      return;
    }
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
  };

  const reactivate = async () => {
    setPhase({ kind: 'busy', action: 'reactivate' });
    setNotice(null);
    let answer: PlanManageAnswer | null = null;
    try {
      // SA C-5: always `{}`; the route refuses anything else.
      answer = await postPlanManage(PLAN_REACTIVATE_PATH, {});
    } catch (err) {
      logger.warn({ err, action: 'reactivate' }, 'Plan cancel / reactivate request failed');
    } finally {
      setPhase({ kind: 'idle' });
    }
    applyAnswer(answer);
  };

  // SA Q-2: the drawer closes first, then the outcome shows here and the host
  // re-reads, once.
  const onCancelFinished = (answer: PlanManageAnswer | null) => {
    setCancelOpen(false);
    applyAnswer(answer);
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
        <button
          ref={cancelButtonRef}
          type="button"
          className={SECONDARY_BUTTON}
          onClick={() => {
            setNotice(null);
            setCancelOpen(true);
          }}
          aria-haspopup="dialog"
          data-testid="plan-manage-cancel"
        >
          {t('plan.manage.cancel_button')}
        </button>
      )}

      {manage?.cancel && (
        <PlanCancelDrawer
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          plan={plan}
          onFinished={onCancelFinished}
          returnFocusRef={drawerReturnFocusRef}
          mode={endsNow ? 'now' : 'period_end'}
        />
      )}

      {manage?.reactivate && phase.kind === 'idle' && foundingLine && (
        <p className="text-xs text-[var(--v2-text-secondary)]" data-testid="plan-manage-founding">
          {foundingLine}
        </p>
      )}

      {manage?.reactivate && phase.kind === 'idle' && (
        <button type="button" className={PRIMARY_BUTTON} onClick={() => void reactivate()} data-testid="plan-manage-reactivate">
          {t('settings.plan_cancel.keep_button')}
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
        <p ref={noticeRef} tabIndex={-1} role="status" className="text-xs text-[var(--v2-text-primary)] focus:outline-none" data-testid="plan-manage-done">
          {notice.text}
        </p>
      )}
      {notice?.kind === 'refused' && (
        <p ref={noticeRef} tabIndex={-1} role="alert" className="text-xs text-[var(--v2-text-secondary)] focus:outline-none" data-testid="plan-manage-refused">
          {t(notice.key)}
        </p>
      )}
    </div>
  );
}

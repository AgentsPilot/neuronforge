'use client';

/**
 * The plan Cancel drawer (account-deletion lifecycle SX-2 / D3; workplan
 * docs/workplans/BUSINESS_OS_D3_PLAN_CANCEL_DRAWER_WORKPLAN.md §2.4, §4; SA
 * Q-2, R-4, R-8, R-10).
 *
 * Four steps: reason → what changes → review → confirm.
 *
 *   1 Reason        the seven codes of `planLeaveReasons.ts`, in that order,
 *                   list only (BQ-7, BQ-17). Next stays disabled until one is
 *                   picked; only the CODE is posted, never a label.
 *   2 What changes  from `plan.ending` (`planEndingView`, server-side): the
 *                   move to the free plan until a date, what is lost, and what
 *                   follows; or the return to the account's own free plan; or
 *                   an honest "could not work out" line. Where the server sent
 *                   `manage.freeAccessAfter` (P-7a.3, BQ-5), the Founding
 *                   Partner sentence is P-7a.3's own key, also when `ending`
 *                   is missing (SA R-4c, R-4d). Every date in the sentence
 *                   comes from the server's view, so SX-2b can change the
 *                   period without touching this file.
 *   3 Review        the last day (owner's timezone, R-8), no further charge,
 *                   no refund, and the frozen export entry.
 *   4 Confirm       posts `{ reasonCode }` to the existing cancel route.
 *
 * ── A DRAWER OPENED FROM A DRAWER (SA Q-2, rule 7) ──────────────────────────
 * Rendered inside `PlanManage`, so inside the Plan drawer's (or the plan
 * pop-up's) React tree: Radix treats it as a nested layer, so Escape and an
 * outside press reach this drawer only. While the request is in flight it is
 * `isBusy`: it refuses to close, and the layer below cannot be reached past it.
 * The answer goes to `PlanManage` (`onFinished`), which closes this drawer and
 * then shows the outcome on the card and asks the host to re-read, once.
 *
 * ── MODE: 'period_end' | 'now' (P-7a.4, wired by D3 T-13) ──────────────────
 * `period_end`: the plan runs to the date the owner paid for. `now`: a
 * renewal payment is failing, and P-7a.4's cancel ends the plan today;
 * `PlanManage` passes it on `manage.paymentFailed`. Steps 3 and 4 then read
 * the `_now` copy ("ends today"; step 4 adds P-7a.4's user-approved
 * `plan.manage.cancel_now_body`: the unpaid invoice is cancelled), step 2's view is built from today by the
 * my-plan route, the reason step stays required and the Founding Partner
 * sentence stays in both modes. `requestExtra` carries any body field the
 * cancel route adds beside the `reasonCode`; P-7a.4 adds none (the route
 * decides the mode on Stripe's fresh status), so nothing passes it today.
 *
 * Imports nothing from the entitlements module (upgrade modal C-6): the reason
 * codes come from the import-free `planLeaveReasons.ts`, the ending from the
 * payload's hand-written mirror.
 */

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { Loader2 } from 'lucide-react';

import { DownloadMyDataButton } from '@/components/business-os/data-export/DownloadMyDataButton';
import { PLAN_LEAVE_REASON_CODES, type PlanLeaveReasonCode } from '@/lib/business-os/billing/planLeaveReasons';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';

import type { PlanPayload } from './planPayloadTypes';
import { PLAN_CANCEL_PATH } from './planManageCopy';
import { postPlanManage, type PlanManageAnswer } from './planManageRequest';
import { fill } from './planText';
import { formatAccountDay, localeFor } from './planUpgradeCopy';
import { SettingsDrawer } from './SettingsDrawer';

const logger = createLogger({ module: 'BusinessOsPlanCancelDrawer' });

const PRIMARY_BUTTON = 'rounded bg-[var(--v2-primary)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-60';
const SECONDARY_BUTTON = 'rounded border border-[var(--v2-border)] px-3 py-1.5 text-xs text-[var(--v2-text-primary)] disabled:opacity-60';
const HEADING = 'text-sm font-semibold text-[var(--v2-text-primary)] focus:outline-none';
const BODY = 'text-xs text-[var(--v2-text-primary)]';
const MUTED = 'text-xs text-[var(--v2-text-secondary)]';

const TOTAL_STEPS = 4;
type Step = 1 | 2 | 3 | 4;

/** When the cancel takes effect. `now` is P-7a.4's; see the header. */
export type PlanCancelMode = 'period_end' | 'now';

export interface PlanCancelDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlanPayload;
  /** Called once per confirm: the route's answer, or `null` when the request itself failed. */
  onFinished: (answer: PlanManageAnswer | null) => void;
  /** The "Cancel plan" button, so focus returns to it on close (SA Q-2). */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** Default `period_end`. `now` is the P-7a.4 seam (header). */
  mode?: PlanCancelMode;
  /** Extra body fields the cancel route takes beside `reasonCode` (P-7a.4 seam). Never an account id. */
  requestExtra?: Readonly<Record<string, string | boolean>>;
}

export function PlanCancelDrawer({
  open,
  onOpenChange,
  plan,
  onFinished,
  returnFocusRef,
  mode = 'period_end',
  requestExtra,
}: PlanCancelDrawerProps) {
  const { t, isRTL } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>(1);

  // Every open starts at step 1 with nothing picked (the steps unmount on close).
  useEffect(() => {
    if (!open) setStep(1);
  }, [open]);

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={t('settings.plan_cancel.title')}
      meta={fill(t('settings.plan_cancel.step_of'), { n: String(step), total: String(TOTAL_STEPS) })}
      isBusy={busy}
      isRTL={isRTL}
      closeLabel={t('settings.plan_cancel.close')}
      returnFocusRef={returnFocusRef}
      testId="plan-cancel-drawer"
    >
      <PlanCancelSteps
        plan={plan}
        mode={mode}
        requestExtra={requestExtra}
        step={step}
        setStep={setStep}
        busy={busy}
        setBusy={setBusy}
        onDismiss={() => onOpenChange(false)}
        onFinished={onFinished}
      />
    </SettingsDrawer>
  );
}

function PlanCancelSteps({
  plan,
  mode,
  requestExtra,
  step,
  setStep,
  busy,
  setBusy,
  onDismiss,
  onFinished,
}: {
  plan: PlanPayload;
  mode: PlanCancelMode;
  requestExtra?: Readonly<Record<string, string | boolean>>;
  step: Step;
  setStep: (step: Step) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onDismiss: () => void;
  onFinished: (answer: PlanManageAnswer | null) => void;
}) {
  const { t, language, timezone } = useLanguage();
  const [reason, setReason] = useState<PlanLeaveReasonCode | null>(null);
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const firstRender = useRef(true);
  const groupName = useId();
  const requiredId = useId();

  // Focus follows the step: the new heading is read first (keyboard and screen
  // reader). The first render keeps Radix's own open focus.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  const day = (iso: string | null | undefined) => (iso ? formatAccountDay(iso, language, timezone) : null);
  const planName = plan.name ?? '';
  const billing = plan.purchase?.billing ?? null;
  const lastDay = day(billing !== null && billing.state === 'renewing' ? billing.date : (plan.ending?.endsAt ?? null));
  const ending = plan.ending ?? null;
  // P-7a.3 (BQ-5), SA R-4c / R-4d: the server's own Founding Partner answer and key.
  const freeUntil = day(plan.purchase?.manage?.freeAccessAfter?.endsAt ?? null);
  const foundingLine = freeUntil ? fill(t('plan.manage.cancel_confirm_founding'), { freeUntil }) : null;

  const confirm = async () => {
    if (!reason || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    let answer: PlanManageAnswer | null = null;
    try {
      // The code only, never a label (SX C-10). `reasonCode` last, so no extra field can replace it.
      answer = await postPlanManage(PLAN_CANCEL_PATH, { ...requestExtra, reasonCode: reason });
    } catch (err) {
      logger.warn({ err, reasonCode: reason }, 'Plan cancel request failed');
    }
    inFlight.current = false;
    setBusy(false);
    onFinished(answer);
  };

  const heading = (key: string, vars?: Record<string, string>) => (
    <h3 ref={headingRef} tabIndex={-1} className={HEADING} data-testid="plan-cancel-heading">
      {vars ? fill(t(key), vars) : t(key)}
    </h3>
  );

  const backButton = (
    <button type="button" className={SECONDARY_BUTTON} onClick={() => setStep((step - 1) as Step)} disabled={busy} data-testid="plan-cancel-back">
      {t('settings.plan_cancel.back')}
    </button>
  );
  const nextButton = (disabled: boolean, describedBy?: string) => (
    <button
      type="button"
      className={PRIMARY_BUTTON}
      onClick={() => setStep((step + 1) as Step)}
      disabled={disabled}
      aria-describedby={describedBy}
      data-testid="plan-cancel-next"
    >
      {t('settings.plan_cancel.next')}
    </button>
  );

  if (step === 1) {
    return (
      <div className="space-y-3" data-testid="plan-cancel-step-1">
        <fieldset className="space-y-2">
          <legend className="mb-1">{heading('settings.plan_cancel.reason.heading')}</legend>
          <p className={MUTED}>{t('settings.plan_cancel.reason.hint')}</p>
          {PLAN_LEAVE_REASON_CODES.map((code) => (
            <label key={code} className={`flex items-center gap-2 ${BODY}`}>
              <input
                type="radio"
                name={groupName}
                value={code}
                checked={reason === code}
                onChange={() => setReason(code)}
                className="accent-[var(--v2-primary)]"
                data-testid={`plan-cancel-reason-${code}`}
              />
              <span>{t(`settings.plan_cancel.reason.${code}`)}</span>
            </label>
          ))}
        </fieldset>
        {reason === null && (
          <p id={requiredId} className={MUTED} data-testid="plan-cancel-reason-required">
            {t('settings.plan_cancel.reason.required')}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">{nextButton(reason === null, reason === null ? requiredId : undefined)}</div>
      </div>
    );
  }

  if (step === 2) {
    let mainLine: string;
    if (foundingLine) mainLine = foundingLine;
    else if (ending?.kind === 'free_plan') {
      const values = { date: day(ending.endsAt) ?? '', plan: ending.planName, until: day(ending.until) ?? '' };
      // The figure is the server's (the free cohort's config value); only its number format is ours.
      mainLine =
        typeof ending.credits === 'number'
          ? fill(t('settings.plan_cancel.changes.free_plan'), { ...values, credits: ending.credits.toLocaleString(localeFor(language)) })
          : fill(t('settings.plan_cancel.changes.free_plan_nocredits'), values);
    } else if (ending?.kind === 'back_to_plan') {
      const until = day(ending.until);
      mainLine = until
        ? fill(t('settings.plan_cancel.changes.back_to_plan'), { date: day(ending.endsAt) ?? '', plan: ending.planName, until })
        : fill(t('settings.plan_cancel.changes.back_to_plan_open'), { date: day(ending.endsAt) ?? '', plan: ending.planName });
    } else {
      mainLine = t('settings.plan_cancel.changes.unknown');
    }
    const isUnknown = !foundingLine && (ending === null || ending.kind === 'unknown');
    const loses = ending && ending.kind !== 'unknown' ? ending.loses : null;
    const thenLine =
      !foundingLine && ending?.kind === 'free_plan' && ending.thenReadOnlyDays !== null
        ? fill(t('settings.plan_cancel.changes.free_plan_then'), { until: day(ending.until) ?? '', days: String(ending.thenReadOnlyDays) })
        : null;

    return (
      <div className="space-y-3" data-testid="plan-cancel-step-2">
        {heading('settings.plan_cancel.changes.heading')}
        <p className={BODY} data-testid="plan-cancel-changes-main">{mainLine}</p>
        {loses !== null &&
          (loses.length > 0 ? (
            <div className="space-y-1" data-testid="plan-cancel-loses">
              <p className={BODY}>{t('settings.plan_cancel.changes.lose_heading')}</p>
              <ul className={`list-disc ps-5 space-y-0.5 ${BODY}`}>
                {loses.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className={BODY} data-testid="plan-cancel-keep-everything">{t('settings.plan_cancel.changes.keep_everything')}</p>
          ))}
        {thenLine && <p className={MUTED} data-testid="plan-cancel-then">{thenLine}</p>}
        {!isUnknown && <p className={MUTED}>{t('settings.plan_cancel.changes.data_kept')}</p>}
        <div className="flex flex-wrap gap-2 pt-1">
          {backButton}
          {nextButton(false)}
        </div>
      </div>
    );
  }

  if (step === 3) {
    return (
      <div className="space-y-3" data-testid="plan-cancel-step-3">
        {heading('settings.plan_cancel.review.heading')}
        <ul className={`list-disc ps-5 space-y-1 ${BODY}`}>
          <li data-testid="plan-cancel-last-day">
            {mode === 'now'
              ? t('settings.plan_cancel.review.ends_now')
              : lastDay
                ? fill(t('settings.plan_cancel.review.last_day'), { date: lastDay })
                : t('settings.plan_cancel.review.last_day_nodate')}
          </li>
          <li>{t('settings.plan_cancel.review.no_charge')}</li>
          <li>{t('settings.plan_cancel.review.no_refund')}</li>
        </ul>
        <div className="space-y-2">
          <p className={MUTED}>{t('settings.plan_cancel.review.export')}</p>
          <DownloadMyDataButton variant="button" />
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {backButton}
          {nextButton(false)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="plan-cancel-step-4">
      {heading('settings.plan_cancel.confirm.heading', { plan: planName })}
      <p className={BODY} data-testid="plan-cancel-confirm-body">
        {mode === 'now'
          ? t('settings.plan_cancel.confirm.body_now')
          : lastDay
            ? fill(t('settings.plan_cancel.confirm.body'), { date: lastDay })
            : t('settings.plan_cancel.confirm.body_nodate')}
        {foundingLine && <> {foundingLine}</>}
      </p>
      {/* P-7a.4 (C-11), user-approved: a failing-payment owner learns the open invoice goes away. */}
      {mode === 'now' && (
        <p className={BODY} data-testid="plan-cancel-confirm-invoice">
          {fill(t('plan.manage.cancel_now_body'), { plan: planName })}
        </p>
      )}
      {busy && (
        <p role="status" className={`flex items-center gap-2 ${MUTED}`} data-testid="plan-cancel-busy">
          <Loader2 aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />
          <span>{t('plan.manage.cancelling')}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {backButton}
        <button type="button" className={SECONDARY_BUTTON} onClick={onDismiss} disabled={busy} data-testid="plan-cancel-dismiss">
          {t('settings.plan_cancel.confirm.dismiss')}
        </button>
        <button type="button" className={PRIMARY_BUTTON} onClick={() => void confirm()} disabled={busy || reason === null} data-testid="plan-cancel-confirm">
          {t('settings.plan_cancel.confirm.button')}
        </button>
      </div>
    </div>
  );
}

'use client';

/**
 * Plan billing in the Businesses drawer (plan payments P-8a.2, AM-1, AC-AM.1,
 * AC-F4.1; BD-23: the per-account billing panel beside credits).
 *
 * Two columns side by side (Q-T9): Stripe as MIRRORED on our billing record,
 * and the plan row that decides access, plus the stored-record disagreements
 * and a link to the customer in the Stripe dashboard. Everything comes from
 * `GET /api/admin/business-os/billing/accounts/[accountId]`, which reads our
 * own records only and never calls Stripe.
 *
 * READ ON DEMAND (deviation D-7): the block starts closed and sends its one
 * GET only when the admin opens it. The drawer's frozen pin suites fail on any
 * request their route tables do not know, so a read on drawer open would move
 * them. A closed block sends nothing (the Finance 8.3 history-block precedent).
 *
 * No payment list here: the payments received are on the money view, which the
 * panel's "Open money view" link already reaches, so nothing is duplicated.
 * Money is formatted per currency; nothing here adds two figures.
 */

import { useCallback, useId, useRef, useState } from 'react';
import { CreditCard } from 'lucide-react';

import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { readJsonBody } from '@/app/admin/components/layout/readJsonBody';
import type { BillingDisagreement, BillingPanelPayload } from '@/lib/admin/billing/billingPanelTypes';
import { MRR_PAST_DUE_COUNTED, STATUS_LABEL, STATUS_TONE } from '@/app/admin/subscriptions/subscriptionsCopy';

import { PART_BOX } from './DrawerBox';

export const PLAN_BILLING_COPY = {
  heading: 'Plan billing',
  purpose: 'Stripe subscription, as our records mirror it, beside the plan row.',
  open: 'Show plan billing',
  hide: 'Hide plan billing',
  refresh: 'Read again',
  loading: 'Reading plan billing…',
  noSubscription: 'No Stripe subscription',
  noSubscriptionWhy: 'Nothing is billed in Stripe for this account in the current Stripe mode.',
  noPlanRow: 'No plan row',
  stripeColumn: 'Stripe (mirrored)',
  planColumn: 'Plan row',
  dashboard: 'Open the customer in Stripe',
  testKeyNote: 'This server uses a Stripe test key: this is the test-mode subscription, not real money.',
  agree: 'Stored records agree.',
  disagreeHeading: 'Stored records disagree',
  notReconciliation: 'This compares our own records only; it is not a check against Stripe.',
  error: 'Plan billing could not be read.',
} as const;

/** Every refusal the route can return, as a sentence (the summary block's convention). */
export const PLAN_BILLING_ERROR_COPY: Record<string, string> = {
  invalid_account_id: 'That does not look like an account id.',
  platform_account: 'This is the platform account. It has no plan billing.',
  not_a_business_os_account: 'Not a Business OS account. This login has no Business OS business.',
  tenant_check_failed: 'Whether this is a Business OS account could not be determined. Try again.',
};

export const DISAGREEMENT_COPY: Record<BillingDisagreement, string> = {
  tier_differs: 'The plan row holds a different plan from the one paid for in Stripe. The next renewal restores the paid plan.',
  paid_through_differs: 'The plan row’s paid-through date is not Stripe’s current period end.',
  no_tier_on_plan: 'Stripe is billing, but the plan row has no paid plan.',
};

type Load = { state: 'closed' } | { state: 'loading' } | { state: 'ok'; data: BillingPanelPayload } | { state: 'error'; message: string };

function dateOrNone(value: string | null): string {
  return value === null ? 'None' : formatUtc(value);
}

function Field({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-3">
      <dt className="text-slate-400">{label}</dt>
      <dd data-testid={testId} className="text-slate-200">
        {value}
      </dd>
    </div>
  );
}

export function PlanBillingBlock({ accountId }: { accountId: string }) {
  const [load, setLoad] = useState<Load>({ state: 'closed' });
  const [isOpen, setIsOpen] = useState(false);
  const readSeq = useRef(0);
  const panelId = useId();

  const read = useCallback(async () => {
    readSeq.current += 1;
    const seq = readSeq.current;
    setLoad({ state: 'loading' });
    try {
      const response = await fetch(`/api/admin/business-os/billing/accounts/${encodeURIComponent(accountId)}`, {
        cache: 'no-store',
      });
      const body = await readJsonBody(response);
      if (seq !== readSeq.current) return;
      if (response.ok && body && body.success === true) {
        setLoad({ state: 'ok', data: body.data as BillingPanelPayload });
        return;
      }
      const code = typeof body?.error === 'string' ? body.error : '';
      // The 409 for an unknown key mode is already a sentence; any other code maps to copy or the fallback.
      const message = PLAN_BILLING_ERROR_COPY[code] ?? (response.status === 409 && code ? code : PLAN_BILLING_COPY.error);
      setLoad({ state: 'error', message });
    } catch {
      if (seq === readSeq.current) setLoad({ state: 'error', message: PLAN_BILLING_COPY.error });
    }
  }, [accountId]);

  function toggle() {
    const next = !isOpen;
    setIsOpen(next);
    // One read, on the first opening; "Read again" re-reads.
    if (next && load.state === 'closed') void read();
  }

  const data = load.state === 'ok' ? load.data : null;

  return (
    <div data-testid="plan-billing-block" className={PART_BOX}>
      {/* A label, not a heading: the section's h3 is its only heading (D-20, LF-4b). */}
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-300">
        <CreditCard className="h-4 w-4 text-sky-300" aria-hidden="true" />
        {PLAN_BILLING_COPY.heading}
      </p>
      <p data-testid="plan-billing-purpose" className="text-xs text-slate-400">
        {PLAN_BILLING_COPY.purpose}
      </p>
      <button
        type="button"
        data-testid="plan-billing-toggle"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={toggle}
        className="mt-2 text-sm text-blue-300 underline hover:text-blue-200"
      >
        {isOpen ? PLAN_BILLING_COPY.hide : PLAN_BILLING_COPY.open}
      </button>

      <div id={panelId} hidden={!isOpen} className="mt-2 space-y-3">
        {load.state === 'loading' && <p className="text-sm text-slate-400">{PLAN_BILLING_COPY.loading}</p>}

        {load.state === 'error' && (
          <p data-testid="plan-billing-error" className="text-sm text-rose-300">
            {load.message}
          </p>
        )}

        {data && (
          <>
            {data.mode === 'test' && (
              <p data-testid="plan-billing-test-key-note" className="text-xs text-slate-400">
                {PLAN_BILLING_COPY.testKeyNote}
              </p>
            )}

            <div className="grid gap-3 md:grid-cols-2">
              <section aria-label={PLAN_BILLING_COPY.stripeColumn} data-testid="plan-billing-stripe" className="space-y-1 text-sm">
                <p className="font-semibold text-slate-300">{PLAN_BILLING_COPY.stripeColumn}</p>
                {data.stripe === null ? (
                  <>
                    <p data-testid="plan-billing-no-subscription" className="text-slate-200">
                      {PLAN_BILLING_COPY.noSubscription}
                    </p>
                    <p className="text-xs text-slate-400">{PLAN_BILLING_COPY.noSubscriptionWhy}</p>
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1">
                      <StatusChip tone={STATUS_TONE[data.stripe.status]} testId="plan-billing-status">
                        {STATUS_LABEL[data.stripe.status]}
                      </StatusChip>
                      {data.stripe.statuses
                        .filter((status) => status !== data.stripe?.status)
                        .map((status) => (
                          <StatusChip key={status} tone="neutral">
                            {STATUS_LABEL[status]}
                          </StatusChip>
                        ))}
                    </div>
                    <dl className="space-y-1">
                      <Field label="Stripe status" value={data.stripe.stripeStatus} testId="plan-billing-stripe-status" />
                      <Field label="Plan bought" value={data.stripe.planBought?.name ?? 'None'} testId="plan-billing-bought" />
                      <Field
                        label={data.stripe.cancelAtPeriodEnd ? 'Ends on' : 'Next renewal'}
                        value={data.stripe.endedAt ? `Ended ${formatUtc(data.stripe.endedAt)}` : dateOrNone(data.stripe.currentPeriodEnd)}
                        testId="plan-billing-renewal"
                      />
                      {data.stripe.pendingPlan && (
                        <Field label="Scheduled change" value={`Moves to ${data.stripe.pendingPlan.name} at renewal`} />
                      )}
                      <Field label="Last payment" value={dateOrNone(data.stripe.lastPaidAt)} testId="plan-billing-last-paid" />
                      <Field label="Failed attempts" value={String(data.stripe.failedAttempts)} testId="plan-billing-attempts" />
                      {data.stripe.lastPaymentFailedAt && <Field label="Last failed" value={formatUtc(data.stripe.lastPaymentFailedAt)} />}
                      <Field
                        label="In MRR"
                        value={
                          data.stripe.monthly
                            ? `${data.stripe.monthly.label} a month${data.stripe.monthly.pastDue ? ` · ${MRR_PAST_DUE_COUNTED}` : ''}`
                            : data.stripe.mrrKind === 'discount_unknown'
                              ? 'Founder discount, amount not recorded'
                              : data.stripe.mrrKind === 'unpriced'
                                ? 'No list price for this plan'
                                : 'Not counted'
                        }
                        testId="plan-billing-mrr"
                      />
                    </dl>
                  </>
                )}
              </section>

              <section aria-label={PLAN_BILLING_COPY.planColumn} data-testid="plan-billing-plan" className="space-y-1 text-sm">
                <p className="font-semibold text-slate-300">{PLAN_BILLING_COPY.planColumn}</p>
                {data.plan === null ? (
                  <p className="text-slate-200">{PLAN_BILLING_COPY.noPlanRow}</p>
                ) : (
                  <dl className="space-y-1">
                    <Field label="Plan" value={data.plan.tier?.name ?? 'None'} testId="plan-billing-plan-tier" />
                    {data.plan.cohort && <Field label="Free access" value={data.plan.cohort.name} />}
                    <Field label="Paid through" value={dateOrNone(data.plan.paidThrough)} testId="plan-billing-paid-through" />
                    <Field label="State" value={data.plan.state} testId="plan-billing-state" />
                    <Field label="Set up by" value={data.plan.origin} />
                  </dl>
                )}
              </section>
            </div>

            {data.stripe !== null &&
              (data.disagreements.length === 0 ? (
                <p data-testid="plan-billing-agree" className="text-xs text-slate-400">
                  {PLAN_BILLING_COPY.agree} {PLAN_BILLING_COPY.notReconciliation}
                </p>
              ) : (
                <div data-testid="plan-billing-disagree" className="space-y-1">
                  <StatusChip tone="warn">{PLAN_BILLING_COPY.disagreeHeading}</StatusChip>
                  <ul className="list-disc pl-5 text-sm text-amber-200">
                    {data.disagreements.map((finding) => (
                      <li key={finding}>{DISAGREEMENT_COPY[finding]}</li>
                    ))}
                  </ul>
                  <p className="text-xs text-slate-400">{PLAN_BILLING_COPY.notReconciliation}</p>
                </div>
              ))}

            <div className="flex flex-wrap items-center gap-3 text-sm">
              {data.customerDashboardUrl && (
                <a
                  data-testid="plan-billing-dashboard-link"
                  href={data.customerDashboardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-300 underline hover:text-blue-200"
                >
                  {PLAN_BILLING_COPY.dashboard}
                </a>
              )}
              <span className="text-xs text-slate-400">As of {formatUtc(data.generatedAt)}</span>
            </div>
          </>
        )}

        {(load.state === 'ok' || load.state === 'error') && (
          <button
            type="button"
            data-testid="plan-billing-refresh"
            onClick={() => void read()}
            className="text-xs text-blue-300 underline hover:text-blue-200"
          >
            {PLAN_BILLING_COPY.refresh}
          </button>
        )}
      </div>
    </div>
  );
}

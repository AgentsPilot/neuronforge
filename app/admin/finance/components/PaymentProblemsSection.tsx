'use client';

/**
 * Section 6, "Payment problems" (SA-CR-4b2 CR-1: the frame is neutral), block
 * B, "Client payment problems" (finance & business health
 * slice 2b, S2-FR-15 to S2-FR-26). Where the businesses' clients are not
 * paying: the businesses' problem, not ours (BD-2), so it carries a neutral
 * chip and never feeds a tile.
 *
 * FIVE PARTS, EACH WITH ITS OWN STATUS (S2-FR-15, SA-W31). The frame is never
 * "Could not load": a failed part says so in its own place and the others
 * still show. Each part heading carries a `StatusChip` in words.
 *
 * Reminder health shows the Jobs & queues figures PLAIN: no tone, no colour,
 * no rule of this page's own (S2-FR-20); the link opens Jobs & queues.
 *
 * Slice 4b.2 adds block A FIRST, "Our payment problems (boosts)" (FR-4B-12,
 * S4-FR-15): OUR boost purchases in an open dispute (held now) or paid but not
 * credited, as of now, each with the date it started. Rendered only when the
 * payload carries it (E-103). Per currency; never a total across currencies.
 *
 * Every string from `financeCopy.ts`; shared layout parts through the alias;
 * no test-mode wording anywhere (BD-13).
 */

import type { ReactNode } from 'react';

import type { FinanceBoostProblemsFigures, FinanceBoostProblemsPart, FinanceClientPlansFigures, FinancePaymentProblemsSection, FinanceReminderFigures, FinanceSectionStatus } from '@/lib/business-os/finance/financeTypes';
import { AdminEmpty, AdminNotice } from '@/app/admin/components/layout/AdminStates';
import { formatCount, formatUtc } from '@/app/admin/components/layout/adminFormat';
import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
} from '@/app/admin/components/layout/adminTable';
import { StatusChip, type StatusTone } from '@/app/admin/components/layout/StatusChip';
import {
  BOOST_PROBLEMS_CUT,
  BOOST_PROBLEMS_DATES_FAILED,
  BOOST_PROBLEMS_HELD,
  BOOST_PROBLEMS_LINK,
  BOOST_PROBLEMS_NONE,
  BOOST_PROBLEMS_NOT_CREDITED,
  BOOST_PROBLEMS_NOT_CREDITED_AMOUNT,
  BOOST_PROBLEMS_NOT_CREDITED_HELP,
  BOOST_PROBLEMS_NOT_RECORDED,
  BOOST_PROBLEMS_OPEN,
  BOOST_PROBLEMS_OPENED,
  BOOST_PROBLEMS_SINCE,
  BOOST_PROBLEMS_SUBTITLE,
  BOOST_PROBLEMS_TITLE,
  boostProblemsOnUnpaid,
  JOBS_QUEUES_HREF,
  PROBLEMS_UNKNOWN,
  PROBLEMS_UNKNOWN_CURRENCY,
  REVENUE_CURRENCY,
  REVENUE_EVENTS_OVER_TOTAL,
  PART_COULD_NOT_LOAD,
  PART_OK,
  PART_PARTIAL,
  PLAN_STATUS_LABELS,
  PLAN_STATUS_NONE,
  PLAN_STATUS_UNRECOGNISED,
  PLANS_ACTIVE_NOW,
  PLANS_BY_STATUS,
  PLANS_CANCELLED,
  PLANS_CEILING_NOTICE,
  PLANS_COMPLETED,
  PLANS_COUNT,
  PLANS_EMPTY,
  PLANS_NEXT_CHARGE_OVERDUE,
  PLANS_STATUS,
  PLANS_UNREADABLE_TIMES,
  PROBLEMS_CHIP,
  PROBLEMS_FAILED_COULD_NOT_CHECK,
  PROBLEMS_FAILED_IN_WINDOW,
  PROBLEMS_FAILED_NONE_IN_READ,
  PROBLEMS_FAILED_NOT_RECORDED,
  PROBLEMS_FAILED_NOT_STORED,
  PROBLEMS_FAILED_PLAN_CHARGES,
  PROBLEMS_FAILED_TITLE,
  PROBLEMS_INSTALMENT_RETRIES,
  PROBLEMS_INSTALMENTS,
  PROBLEMS_INVOICES,
  PROBLEMS_PLANS_TITLE,
  PROBLEMS_REMINDERS_TITLE,
  PROBLEMS_SUBTITLE,
  PROBLEMS_TITLE,
  PAYMENT_PROBLEMS_TITLE,
  REMINDERS_FAILED,
  REMINDERS_LABELS,
  REMINDERS_LINK,
  REMINDERS_LINK_LABEL,
  REMINDERS_NOT_NARROWED,
  REMINDERS_SOURCE,
} from '../financeCopy';
import { atLeast, formatMoney } from '../financeFormat';
import { businessesHref } from '../financeLinks';
import { FinanceSection } from './FinanceSection';
import { OverdueTable } from './OverdueTable';

const SUBHEAD = 'text-sm font-medium text-slate-200';

const PART_CHIP: Record<FinanceSectionStatus, { tone: StatusTone; label: string }> = {
  ok: { tone: 'ok', label: PART_OK },
  partial: { tone: 'warn', label: PART_PARTIAL },
  unknown: { tone: 'unknown', label: PART_COULD_NOT_LOAD },
};

/** One part: its heading, its own status in words, and its body, or what it shows when it could not load. */
function Part({
  id,
  title,
  status,
  children,
  unknownBody,
}: {
  id: string;
  title: string;
  /** Null: the part has no read (failed client payments), so no status. */
  status: FinanceSectionStatus | null;
  children: ReactNode;
  /** Replaces the default "Could not load this part" sentence (reminders keep their link). */
  unknownBody?: ReactNode;
}) {
  const headingId = `problems-${id}-heading`;
  return (
    <div className="space-y-2" role="group" aria-labelledby={headingId} data-testid={`problems-${id}`} data-status={status ?? undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={headingId} className={SUBHEAD}>
          {title}
        </h3>
        {status !== null && (
          <StatusChip tone={PART_CHIP[status].tone} testId={`problems-${id}-status`}>
            {PART_CHIP[status].label}
          </StatusChip>
        )}
      </div>
      {status === 'unknown' ? (
        unknownBody ?? (
          <p className="text-sm text-slate-300" role="status" data-testid={`problems-${id}-could-not-load`}>
            {PART_COULD_NOT_LOAD}
          </p>
        )
      ) : (
        children
      )}
    </div>
  );
}

export function PaymentProblemsSection({
  problems,
  windowLabel,
  onRetry,
  accountId = null,
}: {
  problems: FinancePaymentProblemsSection;
  windowLabel: string;
  onRetry: () => void;
  /** The picked business (S4-FR-16's link); null for all businesses. */
  accountId?: string | null;
}) {
  const plans = problems.clientPlans.figures;
  return (
    <FinanceSection
      id="payment-problems"
      title={PAYMENT_PROBLEMS_TITLE}
      subtitle={PROBLEMS_SUBTITLE(problems.today, windowLabel)}
      status={problems.status}
      onRetry={onRetry}
    >
      <div className="space-y-5" data-testid="payment-problems-body">
        {/* A. Our boost problems, as of now (slice 4b.2). */}
        {problems.boosts && (
          <Part id="boosts" title={`${BOOST_PROBLEMS_TITLE} · ${BOOST_PROBLEMS_SUBTITLE}`} status={problems.boosts.status}>
            <BoostProblems part={problems.boosts} accountId={accountId} />
          </Part>
        )}

        {/* B. The clients' payment problems: the businesses' problem, not ours (BD-2). SA-CR-4b2 CR-1:
            the "Client payment problems" heading and its neutral chip sit on this block only, never on the frame. */}
        <div className="space-y-5" role="group" aria-labelledby="problems-clients-heading" data-testid="problems-clients">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="problems-clients-heading" className="text-base font-semibold text-white">
              {PROBLEMS_TITLE}
            </h3>
            <StatusChip tone="neutral" testId="problems-clients-chip">
              {PROBLEMS_CHIP}
            </StatusChip>
          </div>

        {/* 1. Failed client payments: fixed, never a number in place of "not available" (S2-FR-16). */}
        <Part id="failed" title={PROBLEMS_FAILED_TITLE} status={null}>
          <p className="text-sm text-slate-300" data-testid="problems-failed-not-stored">{PROBLEMS_FAILED_NOT_STORED}</p>
          <p className="text-sm text-slate-300" data-testid="problems-failed-plan-charges">
            {PROBLEMS_FAILED_PLAN_CHARGES}: {failedChargesText(problems.clientPlans.status, plans)}
          </p>
          <p className="text-sm text-slate-300" data-testid="problems-instalment-retries">{PROBLEMS_INSTALMENT_RETRIES}</p>
        </Part>

        {/* 2. Overdue invoices, as of now. */}
        <Part id="invoices" title={PROBLEMS_INVOICES.title} status={problems.overdueInvoices.status}>
          {problems.overdueInvoices.figures && (
            <OverdueTable f={problems.overdueInvoices.figures} copy={PROBLEMS_INVOICES} testId="problems-invoices" />
          )}
        </Part>

        {/* 3. Overdue instalments, as of now. */}
        <Part id="instalments" title={PROBLEMS_INSTALMENTS.title} status={problems.overdueInstalments.status}>
          {problems.overdueInstalments.figures && (
            <OverdueTable f={problems.overdueInstalments.figures} copy={PROBLEMS_INSTALMENTS} testId="problems-instalments" />
          )}
        </Part>

        {/* 4. Client plans. */}
        <Part id="plans" title={PROBLEMS_PLANS_TITLE} status={problems.clientPlans.status}>
          {plans && <ClientPlans f={plans} />}
        </Part>

        {/* 5. Reminder health: the Jobs & queues figures, plain. */}
        <Part
          id="reminders"
          title={PROBLEMS_REMINDERS_TITLE}
          status={problems.reminders.status}
          unknownBody={<Reminders reminders={problems.reminders} />}
        >
          <Reminders reminders={problems.reminders} />
        </Part>
        </div>
      </div>
    </FinanceSection>
  );
}

const dateOf = (iso: string | null): string => (iso === null ? BOOST_PROBLEMS_NOT_RECORDED : formatUtc(iso));

/** Block A's body (FR-4B-12): per currency, open disputes and purchases not credited, with their start dates. */
function BoostProblems({ part, accountId }: { part: FinanceBoostProblemsPart; accountId: string | null }) {
  const f: FinanceBoostProblemsFigures | null = part.figures;
  if (f === null) return null;
  const link = accountId !== null && (
    <p className="text-sm">
      <a
        href={businessesHref(accountId)}
        data-testid="problems-boosts-link"
        className="text-xs text-purple-300 underline hover:text-purple-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
      >
        {BOOST_PROBLEMS_LINK}
      </a>
    </p>
  );
  return (
    <div className="space-y-2" data-testid="problems-boosts-body">
      {!f.exact && <AdminNotice testId="problems-boosts-cut">{BOOST_PROBLEMS_CUT}</AdminNotice>}
      {f.openDisputes > 0 && f.openedDates === 'failed' && (
        <AdminNotice testId="problems-boosts-dates-failed">{BOOST_PROBLEMS_DATES_FAILED}</AdminNotice>
      )}
      {f.empty ? (
        <AdminEmpty testId="problems-boosts-none" message={BOOST_PROBLEMS_NONE} />
      ) : (
        <div className={ADMIN_TABLE_WRAP}>
          <table className={ADMIN_TABLE} aria-label={BOOST_PROBLEMS_TITLE} data-testid="problems-boosts-lines">
            <thead className={ADMIN_THEAD}>
              <tr>
                <th scope="col" className={ADMIN_TH}>{REVENUE_CURRENCY}</th>
                <th scope="col" className={ADMIN_TH_NUM}>{BOOST_PROBLEMS_OPEN}</th>
                <th scope="col" className={ADMIN_TH_NUM}>{BOOST_PROBLEMS_HELD}</th>
                <th scope="col" className={ADMIN_TH}>{BOOST_PROBLEMS_OPENED}</th>
                <th scope="col" className={ADMIN_TH_NUM}>{BOOST_PROBLEMS_NOT_CREDITED}</th>
                <th scope="col" className={ADMIN_TH_NUM}>{BOOST_PROBLEMS_NOT_CREDITED_AMOUNT}</th>
                <th scope="col" className={ADMIN_TH}>{BOOST_PROBLEMS_SINCE}</th>
              </tr>
            </thead>
            <tbody className={ADMIN_TBODY}>
              {f.lines.map((line) => (
                <tr key={line.currency ?? 'unknown'} data-testid={`problems-boosts-line-${line.currency ?? 'unknown'}`}>
                  <th scope="row" className={`${ADMIN_TD} font-normal`}>{line.currency ?? PROBLEMS_UNKNOWN_CURRENCY}</th>
                  <td className={ADMIN_TD_NUM}>{atLeast(formatCount(line.openDisputes), f.exact)}</td>
                  <td className={ADMIN_TD_NUM} data-money="held">
                    {line.held === null ? PROBLEMS_UNKNOWN : atLeast(formatMoney(line.held, line.currency), f.exact)}
                  </td>
                  <td className={ADMIN_TD}>{line.openDisputes > 0 ? dateOf(line.oldestDisputeOpenedAt) : ''}</td>
                  <td className={ADMIN_TD_NUM}>{atLeast(formatCount(line.notCredited), f.exact)}</td>
                  <td className={ADMIN_TD_NUM} data-money="not-credited">
                    {line.notCredited === 0
                      ? ''
                      : line.notCreditedAmount === null
                        ? PROBLEMS_UNKNOWN
                        : atLeast(formatMoney(line.notCreditedAmount, line.currency), f.exact)}
                  </td>
                  <td className={ADMIN_TD}>{line.notCredited > 0 ? dateOf(line.oldestNotCreditedAt) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {f.notCredited > 0 && <p className="text-[11px] text-slate-400">{BOOST_PROBLEMS_NOT_CREDITED_HELP}</p>}
      {f.eventsOnUnpaidPurchases !== null && f.eventsOnUnpaidPurchases > 0 && (
        <p className="text-[11px] text-slate-400" data-testid="problems-boosts-unpaid-events">
          {boostProblemsOnUnpaid(f.eventsOnUnpaidPurchases)}
        </p>
      )}
      {f.overTotal !== null && f.overTotal > 0 && (
        <p className="text-[11px] text-slate-400" data-testid="problems-boosts-over-total">{REVENUE_EVENTS_OVER_TOTAL(f.overTotal)}</p>
      )}
      {link}
    </div>
  );
}

function failedChargesText(status: FinanceSectionStatus, f: FinanceClientPlansFigures | null): string {
  if (status === 'unknown' || f === null) return PROBLEMS_FAILED_COULD_NOT_CHECK;
  // QA-1: "never stored" is a claim about every plan, so only a complete read (not at its ceiling, not partial) may make it.
  if (!f.failedCharges.everRecorded) return f.exact && status === 'ok' ? PROBLEMS_FAILED_NOT_RECORDED : PROBLEMS_FAILED_NONE_IN_READ;
  return PROBLEMS_FAILED_IN_WINDOW(atLeast(formatCount(f.failedCharges.inWindow), f.exact));
}

function ClientPlans({ f }: { f: FinanceClientPlansFigures }) {
  if (f.total === 0) return <AdminEmpty testId="problems-plans-empty" message={PLANS_EMPTY} />;
  const count = (value: number) => atLeast(formatCount(value), f.exact);
  const statusLabel = (status: string | null, recognised: boolean) => {
    if (status === null) return `${PLAN_STATUS_NONE} (${PLAN_STATUS_UNRECOGNISED})`;
    const label = PLAN_STATUS_LABELS[status] ?? status;
    return recognised ? label : `${label} (${PLAN_STATUS_UNRECOGNISED})`;
  };
  const facts: Array<[string, number, string]> = [
    [PLANS_ACTIVE_NOW, f.activeNow, 'active-now'],
    [PLANS_CANCELLED, f.cancelledInWindow, 'cancelled'],
    [PLANS_COMPLETED, f.completedInWindow, 'completed'],
    [PLANS_NEXT_CHARGE_OVERDUE, f.nextChargeOverdue, 'next-charge-overdue'],
  ];
  return (
    <div className="space-y-2" data-testid="problems-plans-body">
      {!f.exact && <AdminNotice testId="problems-plans-notice-ceiling">{PLANS_CEILING_NOTICE}</AdminNotice>}
      {f.unreadableTimes > 0 && <AdminNotice testId="problems-plans-notice-times">{PLANS_UNREADABLE_TIMES(f.unreadableTimes)}</AdminNotice>}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {facts.map(([label, value, key]) => (
          <div key={key} data-testid={`problems-plans-${key}`}>
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="font-semibold text-white tabular-nums">{count(value)}</dd>
          </div>
        ))}
      </dl>
      <div className={ADMIN_TABLE_WRAP}>
        <table className={ADMIN_TABLE} aria-label={PLANS_BY_STATUS} data-testid="problems-plans-by-status">
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>{PLANS_STATUS}</th>
              <th scope="col" className={ADMIN_TH_NUM}>{PLANS_COUNT}</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {f.byStatus.map((entry) => (
              <tr key={entry.status ?? '(none)'}>
                <th scope="row" className={`${ADMIN_TD} font-normal`}>{statusLabel(entry.status, entry.recognised)}</th>
                <td className={ADMIN_TD_NUM}>{count(entry.plans)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Reminders({ reminders }: { reminders: FinancePaymentProblemsSection['reminders'] }) {
  const link = (
    <a
      href={JOBS_QUEUES_HREF}
      aria-label={REMINDERS_LINK_LABEL}
      data-testid="problems-reminders-link"
      className="text-xs text-purple-300 underline hover:text-purple-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400"
    >
      {REMINDERS_LINK}
    </a>
  );
  if (reminders.state === 'not_narrowed') {
    return (
      <div className="space-y-1">
        <p className="text-sm text-slate-300" data-testid="problems-reminders-not-narrowed">{REMINDERS_NOT_NARROWED}</p>
        {link}
      </div>
    );
  }
  if (reminders.state === 'failed' || reminders.figures === null) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-slate-300" role="status" data-testid="problems-reminders-failed">{REMINDERS_FAILED}</p>
        {link}
      </div>
    );
  }
  const r: FinanceReminderFigures = reminders.figures;
  const counts: Array<[string, number, string]> = [
    [REMINDERS_LABELS.dueNow, r.dueNow, 'due-now'],
    [REMINDERS_LABELS.inProgress, r.inProgress, 'in-progress'],
    [REMINDERS_LABELS.stuck, r.stuck, 'stuck'],
    [REMINDERS_LABELS.failed24h, r.failed24h, 'failed-24h'],
    [REMINDERS_LABELS.failed7d, r.failed7d, 'failed-7d'],
    [REMINDERS_LABELS.deadLettered24h, r.deadLettered24h, 'deadlettered-24h'],
    [REMINDERS_LABELS.deadLettered7d, r.deadLettered7d, 'deadlettered-7d'],
  ];
  return (
    <div className="space-y-2" data-testid="problems-reminders-figures">
      <p className="text-xs text-slate-400">{REMINDERS_SOURCE}</p>
      {/* Plain figures: no tone, no colour, no threshold of this page's own (S2-FR-20). */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        {counts.map(([label, value, key]) => (
          <div key={key} data-testid={`problems-reminders-${key}`}>
            <dt className="text-xs text-slate-400">{label}</dt>
            <dd className="text-slate-200 tabular-nums">{formatCount(value)}</dd>
          </div>
        ))}
        <div data-testid="problems-reminders-oldest">
          <dt className="text-xs text-slate-400">{REMINDERS_LABELS.oldestDueAt}</dt>
          <dd className="text-slate-200 tabular-nums">{formatUtc(r.oldestDueAt)}</dd>
        </div>
      </dl>
      {link}
    </div>
  );
}

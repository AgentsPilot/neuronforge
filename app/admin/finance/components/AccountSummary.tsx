'use client';

/**
 * The picked business's money summary (Money M-1, finance health §11D.3:
 * M1-FR-5, M1-FR-6, S5-F7). Shown only with a business picked (M1-FR-10),
 * directly under the account header.
 *
 * Every value is SELECTED from the payload and formatted exactly as its own
 * section formats it, so each equals the same figure in its section on the
 * same render (AC-110). This component holds no addition, subtraction,
 * `reduce` or conversion of money (AC-112, SA-WR-18): boosts stay one line per
 * currency, never a total across currencies (BD-12).
 *
 * Money M-2 (§11D.4 M2-FR-6): "Paid us: plan" shows the plans received per
 * currency, and "Paid us, total" shows `revenue.totals`, the server's
 * per-currency boost net plus plans received (SA-Q40): the SAME lines K-5
 * reads, so the tile and the summary cannot differ. Still no margin (M-3).
 *
 * The refund-timing sentence (S4-W-3) shows on the boosts line under the
 * panel's own condition, `notes.refundOrDispute` (S5-F7, SA-W58 (a), SA-WR-38):
 * the one copy constant, with exactly two users.
 *
 * Links carry this business's id and the window, never a name (M1-FR-7,
 * SA-W56); see `financeLinks.ts`.
 *
 * Money M-3 (slice 6a, M3-FR-8): "AI margin (USD)" directly under "Paid us,
 * total", SELECTED from `accountMargin` (built on the server by the same
 * functions as an Accounts tab row, AC-142) and printed by the tab's own
 * `marginText`, so the two cannot differ. Still no arithmetic here.
 *
 * Money M-4 (OV-5, M4-FR-2): "Recorded above charged" directly under "Charged
 * AI cost", rendered by Section 3's own `RecordedAboveValue` from the SAME
 * `aiCost.recorded` (one payload field, rendered twice: AC-158). The recorded
 * figure itself is not repeated here. Absent when the payload has none.
 *
 * Slice 6b (FE-14): "Margin after Stripe fees (estimate, USD)" directly under
 * the AI margin, from the same `accountMargin` and printed by the tab's own
 * `MarginAfterFeesValue`, so the row and the summary cannot differ (AC-250).
 */

import type { ReactNode } from 'react';

import type { FinanceAccountMargin, FinanceAccountsSection, FinanceAiCostSection, FinanceBoostRevenue, FinanceCreditsSection, FinancePlanRevenue, FinanceRevenueSection, FinanceWindowInfo } from '@/lib/business-os/finance/financeTypes';
import { activityHref, analyticsHref, businessesHref, costsHref } from '../financeLinks';
import {
  ACCOUNT_AFTER_FEES,
  ACCOUNT_AI_COST,
  ACCOUNT_CREDITS,
  ACCOUNT_CUTOVER_ENTIRELY,
  ACCOUNT_CUTOVER_NOTE,
  ACCOUNT_LINK_ACTIVITY,
  ACCOUNT_LINK_ANALYTICS,
  ACCOUNT_LINK_BUSINESSES,
  ACCOUNT_LINK_COSTS,
  ACCOUNT_LINKS_TITLE,
  ACCOUNT_MARGIN,
  ACCOUNT_NONE_IN_WINDOW,
  ACCOUNT_PAID_BOOSTS,
  ACCOUNT_PAID_PLAN,
  ACCOUNT_PAID_TOTAL,
  ACCOUNT_PLAN_GROUP,
  ACCOUNT_RECORDED_ABOVE,
  ACCOUNT_SUMMARY_TITLE,
  ACCOUNT_UNKNOWN,
  accountCreditsLine,
  accountCreditsNoAllowance,
  REVENUE_CUT_OFF,
  REVENUE_REFUND_TIMING_NOTE,
  REVENUE_UNKNOWN,
} from '../financeCopy';
import { atLeast, formatCredits, formatMoney, formatUsd } from '../financeFormat';
import { AccountPlanGroup } from './AccountHeader';
import { usedPercent } from './CreditsSection';
import { MarginAfterFeesValue, MarginValue } from './AccountEconomicsTable';
import { RecordedAboveValue } from './RecordedCostLines';

const NOTE = 'text-[11px] text-slate-400';
const LINK = 'text-xs text-purple-300 underline hover:text-purple-200';

function Line({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[12rem_1fr]">
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-200" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/** BD-18: the charged AI cost, exactly as Section 3 prints its total. */
function AiCostValue({ aiCost }: { aiCost: FinanceAiCostSection }) {
  const f = aiCost.figures;
  if (aiCost.status === 'unknown' || f === null) return <>{ACCOUNT_UNKNOWN}</>;
  // AC-40: entirely before the cut-over, the note INSTEAD of a figure, never a $0.
  if (aiCost.coverage === 'entirely_before_cutover') return <span className={NOTE}>{ACCOUNT_CUTOVER_ENTIRELY}</span>;
  return (
    <>
      <span data-testid="account-summary-ai-cost-value">{atLeast(formatUsd(f.costUsd), f.exact)}</span>
      {aiCost.coverage !== 'after_cutover' && <span className={`block ${NOTE}`}>{ACCOUNT_CUTOVER_NOTE}</span>}
    </>
  );
}

/** One line per currency, the panel's own net text; never a total (BD-12, AC-112). */
function BoostsValue({ boosts }: { boosts: FinanceBoostRevenue }) {
  if (boosts.status === 'unknown' || boosts.lines === null || boosts.notes === null) return <>{ACCOUNT_UNKNOWN}</>;
  const notes = boosts.notes;
  if (notes.empty) return <>{ACCOUNT_NONE_IN_WINDOW}</>;
  return (
    <>
      <ul className="space-y-0.5">
        {boosts.lines.map((line) => (
          <li key={line.currency ?? 'unknown'} data-testid={`account-summary-boost-${line.currency ?? 'unknown'}`}>
            {line.net !== null ? formatMoney(line.net, line.currency) : notes.exact ? REVENUE_UNKNOWN : REVENUE_CUT_OFF}
          </li>
        ))}
      </ul>
      {notes.refundOrDispute && (
        <p className={NOTE} data-testid="account-summary-refund-note">
          {REVENUE_REFUND_TIMING_NOTE}
        </p>
      )}
    </>
  );
}

/** M2-FR-6: plans received per currency, as the plans part prints them; never a total across currencies. */
function PlanValue({ plans }: { plans: FinancePlanRevenue }) {
  if (plans.status === 'unknown' || plans.lines === null || plans.notes === null) return <>{ACCOUNT_UNKNOWN}</>;
  if (plans.notes.empty) return <>{ACCOUNT_NONE_IN_WINDOW}</>;
  return (
    <ul className="space-y-0.5">
      {plans.lines.map((line) => (
        <li key={line.currency ?? 'unknown'} data-testid={`account-summary-plan-${line.currency ?? 'unknown'}`}>
          {atLeast(formatMoney(line.received, line.currency), line.exact)}
        </li>
      ))}
    </ul>
  );
}

/** SA-Q40: the server's per-currency total, exactly the lines K-5 reads; "Unknown" where it cannot be exact. */
function TotalValue({ totals }: { totals: FinanceRevenueSection['totals'] }) {
  if (totals === null) return <>{ACCOUNT_UNKNOWN}</>;
  if (totals.length === 0) return <>{ACCOUNT_NONE_IN_WINDOW}</>;
  return (
    <ul className="space-y-0.5">
      {totals.map((line) => (
        <li key={line.currency ?? 'unknown'} data-testid={`account-summary-total-${line.currency ?? 'unknown'}`}>
          {line.total !== null ? formatMoney(line.total, line.currency) : ACCOUNT_UNKNOWN}
        </li>
      ))}
    </ul>
  );
}

/** This account's Section 4 row, in credits (never money). */
function CreditsValue({ credits, accountId }: { credits: FinanceCreditsSection; accountId: string }) {
  if (credits.status === 'unknown' || credits.figures === null) return <>{ACCOUNT_UNKNOWN}</>;
  const row = credits.figures.rows.find((candidate) => candidate.accountId === accountId) ?? null;
  if (row === null || row.kind === 'unknown') return <>{ACCOUNT_UNKNOWN}</>;
  const gifted = row.giftedOutstanding === null ? ACCOUNT_UNKNOWN : formatCredits(row.giftedOutstanding);
  if (row.kind === 'no_allowance') return <>{accountCreditsNoAllowance(gifted)}</>;
  const allowance = row.allowance === null ? ACCOUNT_UNKNOWN : formatCredits(row.allowance);
  const used = row.used === null ? ACCOUNT_UNKNOWN : formatCredits(row.used);
  return <>{accountCreditsLine(allowance, used, usedPercent(row), gifted)}</>;
}

export function AccountSummary({
  accountId,
  window,
  aiCost,
  revenue,
  credits,
  accounts,
  accountMargin = null,
}: {
  accountId: string;
  window: FinanceWindowInfo;
  aiCost: FinanceAiCostSection;
  /** Our revenue: the boosts, the plans and the per-currency totals (slice 5a). */
  revenue: FinanceRevenueSection;
  credits: FinanceCreditsSection;
  accounts: FinanceAccountsSection;
  /** Slice 6a (M3-FR-8): the server's margin for this business; null or absent shows "Unknown". */
  accountMargin?: FinanceAccountMargin | null;
}) {
  const headingId = 'account-summary-heading';
  const links: Array<{ label: string; href: string; testId: string }> = [
    { label: ACCOUNT_LINK_ACTIVITY, href: activityHref(accountId, window), testId: 'account-link-activity' },
    { label: ACCOUNT_LINK_COSTS, href: costsHref(accountId, window), testId: 'account-link-costs' },
    { label: ACCOUNT_LINK_ANALYTICS, href: analyticsHref(accountId, window), testId: 'account-link-analytics' },
    { label: ACCOUNT_LINK_BUSINESSES, href: businessesHref(accountId), testId: 'account-link-businesses' },
  ];
  return (
    <section
      aria-labelledby={headingId}
      data-testid="account-summary"
      className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 space-y-3"
    >
      <h2 id={headingId} className="text-base font-semibold text-white">
        {ACCOUNT_SUMMARY_TITLE}
      </h2>
      <dl className="space-y-2">
        <Line label={ACCOUNT_AI_COST} testId="account-summary-ai-cost">
          <AiCostValue aiCost={aiCost} />
        </Line>
        {aiCost.recorded && (
          <Line label={ACCOUNT_RECORDED_ABOVE} testId="account-summary-recorded-above">
            <RecordedAboveValue recorded={aiCost.recorded} testId="account-summary-recorded-above-value" />
          </Line>
        )}
        <Line label={ACCOUNT_PAID_BOOSTS} testId="account-summary-boosts">
          <BoostsValue boosts={revenue.boosts} />
        </Line>
        <Line label={ACCOUNT_PAID_PLAN} testId="account-summary-plan">
          <PlanValue plans={revenue.plans} />
        </Line>
        <Line label={ACCOUNT_PAID_TOTAL} testId="account-summary-total">
          <TotalValue totals={revenue.totals} />
        </Line>
        <Line label={ACCOUNT_MARGIN} testId="account-summary-margin">
          {accountMargin === null ? ACCOUNT_UNKNOWN : <MarginValue margin={accountMargin.margin} testId="account-summary-margin-value" />}
        </Line>
        <Line label={ACCOUNT_AFTER_FEES} testId="account-summary-after-fees">
          {accountMargin === null ? (
            ACCOUNT_UNKNOWN
          ) : (
            <MarginAfterFeesValue value={accountMargin.marginAfterFees} testId="account-summary-after-fees-value" />
          )}
        </Line>
        <Line label={ACCOUNT_CREDITS} testId="account-summary-credits">
          <CreditsValue credits={credits} accountId={accountId} />
        </Line>
        <Line label={ACCOUNT_PLAN_GROUP} testId="account-summary-group">
          <AccountPlanGroup accounts={accounts} testId="account-summary-group-value" />
        </Line>
      </dl>
      {/* A plain list, not a nav: the summary adds exactly one landmark (its section). */}
      <div data-testid="account-summary-links">
        <p className={NOTE}>{ACCOUNT_LINKS_TITLE}</p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label={ACCOUNT_LINKS_TITLE}>
          {links.map((link) => (
            <li key={link.testId}>
              <a href={link.href} className={LINK} data-testid={link.testId}>
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

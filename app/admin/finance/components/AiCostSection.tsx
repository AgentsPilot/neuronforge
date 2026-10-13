'use client';

/**
 * Section 3, AI cost in the window (S1-FR-16 to S1-FR-20). The ledger cost is
 * USD and labelled so (AC-14); a read at its ceiling says "At least" (AC-15);
 * a window that starts before charging went live shows the cut-over notice,
 * and one entirely before it shows the notice INSTEAD of figures, never a $0
 * (AC-40). The provider-side token measure is a link, not a read (SA-Q4).
 */

import { CutoverNotice } from '@/app/admin/business-os-llm/components/activity/CutoverNotice';
import type { FinanceAiCostSection, FinanceTopAccount } from '@/lib/business-os/finance/financeTypes';
import {
  AI_ACTIONS,
  AI_BUSINESS,
  AI_BY_GROUP,
  AI_BY_GROUP_NOTE,
  AI_BY_GROUP_PARTIAL,
  AI_BY_GROUP_UNKNOWN,
  AI_BY_TRIGGER,
  AI_COST,
  AI_CREDITS,
  AI_DELETED,
  AI_LINK,
  AI_LINK_HREF,
  AI_LINK_NOTE,
  AI_NO_ROWS,
  AI_SOURCE,
  AI_TITLE,
  AI_TOP,
  AI_TOTAL,
  AI_UNREADABLE,
  AI_UNRESOLVED,
  NAME_MISSING,
  NAME_PLATFORM,
  NAME_UNAVAILABLE,
  TRIGGER_LABELS,
} from '../financeCopy';
import { atLeast, formatCount, formatCredits, formatUsd } from '../financeFormat';
import { groupLabel } from './AccountsByPlanSection';
import { FinanceSection } from './FinanceSection';

const TH = 'px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400';
const TD = 'px-2 py-1 text-sm text-slate-200';

function nameOf(account: FinanceTopAccount): string {
  switch (account.nameStatus) {
    case 'found':
      return account.name ?? NAME_MISSING;
    case 'platform':
      return NAME_PLATFORM;
    case 'unavailable':
      return `${NAME_UNAVAILABLE} (${account.accountId.slice(0, 8)}…)`;
    default:
      return `${NAME_MISSING} (${account.accountId.slice(0, 8)}…)`;
  }
}

export function AiCostSection({
  aiCost,
  accountId,
  windowLabel,
  onRetry,
}: {
  aiCost: FinanceAiCostSection;
  accountId: string | null;
  windowLabel: string;
  onRetry: () => void;
}) {
  const f = aiCost.figures;
  const usd = (v: number) => atLeast(formatUsd(v), f?.exact ?? true);
  const entirelyBefore = aiCost.coverage === 'entirely_before_cutover';

  return (
    <FinanceSection id="ai-cost" title={AI_TITLE} subtitle={`${AI_SOURCE}, ${windowLabel}`} status={aiCost.status} onRetry={onRetry}>
      <div className="space-y-3">
        <CutoverNotice coverage={aiCost.coverage} accountId={accountId} />
        {f && !entirelyBefore && (
          <>
            <dl className="grid gap-3 sm:grid-cols-3">
              <div><dt className="text-xs text-slate-400">{AI_TOTAL}</dt><dd className="text-lg font-semibold text-white" data-testid="ai-total">{usd(f.costUsd)}</dd></div>
              <div><dt className="text-xs text-slate-400">{AI_CREDITS}</dt><dd className="text-lg font-semibold text-white">{atLeast(formatCredits(f.credits), f.exact)}</dd></div>
              <div><dt className="text-xs text-slate-400">{AI_ACTIONS}</dt><dd className="text-lg font-semibold text-white">{atLeast(formatCount(f.chargedActions), f.exact)}</dd></div>
            </dl>
            {f.rows === 0 && <p className="text-sm text-slate-300" data-testid="ai-no-rows">{AI_NO_ROWS}</p>}
            {f.rows > 0 && (
              <div className="grid gap-4 lg:grid-cols-2">
                <table className="w-full">
                  <caption className="text-left text-xs font-medium text-slate-300">{AI_BY_TRIGGER}</caption>
                  <thead><tr><th scope="col" className={TH}>{AI_BY_TRIGGER}</th><th scope="col" className={TH}>{AI_COST}</th><th scope="col" className={TH}>{AI_CREDITS}</th></tr></thead>
                  <tbody>
                    {f.byTrigger.map((t) => (
                      <tr key={t.trigger} className="border-t border-slate-700/60">
                        <th scope="row" className={`${TD} font-normal text-left`}>{TRIGGER_LABELS[t.trigger]}</th>
                        <td className={TD}>{usd(t.costUsd)}</td>
                        <td className={TD}>{formatCredits(t.credits)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div>
                  <table className="w-full">
                    <caption className="text-left text-xs font-medium text-slate-300">{AI_BY_GROUP}</caption>
                    <thead><tr><th scope="col" className={TH}>{AI_BY_GROUP}</th><th scope="col" className={TH}>{AI_COST}</th></tr></thead>
                    <tbody>
                      {f.byGroup.lines.map((line) => (
                        <tr key={line.key} className="border-t border-slate-700/60">
                          <th scope="row" className={`${TD} font-normal text-left`}>{groupLabel(line)}</th>
                          <td className={TD}>{usd(line.costUsd)}</td>
                        </tr>
                      ))}
                      {f.deleted.rows > 0 && (
                        <tr className="border-t border-slate-700/60">
                          <th scope="row" className={`${TD} font-normal text-left`}>{AI_DELETED}</th>
                          <td className={TD}>{usd(f.deleted.costUsd)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {f.byGroup.status === 'unknown'
                      ? AI_BY_GROUP_UNKNOWN
                      : f.byGroup.status === 'partial'
                        ? AI_BY_GROUP_PARTIAL
                        : AI_BY_GROUP_NOTE}
                  </p>
                </div>
              </div>
            )}
            {f.topAccounts.length > 0 && (
              <table className="w-full" data-testid="ai-top">
                <caption className="text-left text-xs font-medium text-slate-300">{AI_TOP}</caption>
                <thead><tr><th scope="col" className={TH}>{AI_BUSINESS}</th><th scope="col" className={TH}>{AI_COST}</th><th scope="col" className={TH}>{AI_CREDITS}</th></tr></thead>
                <tbody>
                  {f.topAccounts.map((a) => (
                    <tr key={a.accountId} className="border-t border-slate-700/60">
                      <th scope="row" className={`${TD} font-normal text-left`}>{nameOf(a)}</th>
                      <td className={TD}>{usd(a.costUsd)}</td>
                      <td className={TD}>{formatCredits(a.credits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="text-xs text-slate-400">
              {AI_DELETED}: {usd(f.deleted.costUsd)} ({formatCount(f.deleted.rows)})
              {f.unresolvedAdjustments > 0 && ` · ${formatCount(f.unresolvedAdjustments)} ${AI_UNRESOLVED}`}
              {f.unreadableAmounts > 0 && ` · ${formatCount(f.unreadableAmounts)} ${AI_UNREADABLE}`}
            </p>
          </>
        )}
        <p className="text-xs text-slate-400">
          {AI_LINK_NOTE}{' '}
          <a href={AI_LINK_HREF} className="text-purple-300 underline hover:text-purple-200">
            {AI_LINK}
          </a>
        </p>
      </div>
    </FinanceSection>
  );
}

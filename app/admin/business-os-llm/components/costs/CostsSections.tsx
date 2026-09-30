/**
 * The four sections of the Costs & credits tab (credit deduction slice 4a,
 * workplan §4.1): per account and period, the breakdowns, the fallback-priced
 * charges, and the spread per action type. Presentational only: every figure
 * arrives in the payload; nothing is computed here but formatting.
 */

import { Chip } from '../Chip';
import {
  BREAKDOWN_NOTE,
  FALLBACK_NOTE,
  NET_INCLUDING_CORRECTIONS,
  NOT_DECLARED_LABEL,
  ORIGINALS_FAILED,
  SECTION_FAILED,
  SPREAD_NOTE,
  UNRESOLVED_LABEL,
} from '../../costCopy';
import { formatCount, formatCredits, formatDay, formatUsd } from '../../costFormat';
import type {
  CostBreakdownLine,
  CostPeriodFigures,
  CostReportPayload,
} from '../../costTypes';

const TH = 'px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-slate-400';
const TH_NUM = `${TH} text-right`;
const TD = 'px-3 py-2 text-slate-200';
const TD_NUM = 'px-3 py-2 text-right font-mono text-slate-200';

function accountLabel(companyName: string | null, accountId: string): string {
  return companyName ?? `${accountId.slice(0, 8)}…`;
}

function SectionShell({ title, testId, children }: { title: React.ReactNode; testId: string; children: React.ReactNode }) {
  return (
    <section data-testid={testId} className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <h2 className="text-sm font-semibold text-white">{title}</h2>
      {children}
    </section>
  );
}

function SectionFailed({ testId }: { testId: string }) {
  return (
    <p data-testid={testId} className="text-sm text-red-300">
      {SECTION_FAILED}
    </p>
  );
}

// ============ 1. Per account and period ============

function FiguresCells({ f }: { f: CostPeriodFigures }) {
  return (
    <>
      <td className={TD_NUM}>{formatCredits(f.creditsTotal)}</td>
      <td className={TD_NUM}>{formatCredits(f.creditsOwner)}</td>
      <td className={TD_NUM}>{formatCredits(f.creditsScheduled)}</td>
      <td className={TD_NUM}>{formatCredits(f.creditsExternal)}</td>
      <td className={TD_NUM}>{formatCredits(f.creditsAdjustment)}</td>
      <td className={TD_NUM}>{formatUsd(f.costUsd)}</td>
      <td className={TD_NUM}>{formatCount(f.charges)}</td>
      <td className={TD_NUM}>{formatCount(f.fallbackPriced)}</td>
    </>
  );
}

function CheckCell({ matches, fromRows }: { matches: boolean | null; fromRows: CostPeriodFigures | null }) {
  if (matches === true) {
    return (
      <Chip tone="info" testId="period-check-ok">
        matches its rows
      </Chip>
    );
  }
  if (matches === false) {
    return (
      <div className="space-y-1">
        <Chip tone="danger" testId="period-check-mismatch">
          mismatch
        </Chip>
        {fromRows && (
          <p className="text-[11px] text-red-300">
            rows: {formatCredits(fromRows.creditsTotal)} credits, {formatUsd(fromRows.costUsd)},{' '}
            {formatCount(fromRows.charges)} charges
          </p>
        )}
      </div>
    );
  }
  return (
    <Chip tone="quiet" testId="period-check-skipped">
      not checked
    </Chip>
  );
}

export function PeriodsSection({ report }: { report: CostReportPayload }) {
  return (
    <SectionShell title="Per account and billing period" testId="costs-periods">
      {report.mismatchedPeriods > 0 && (
        <p data-testid="costs-mismatch-summary" className="text-sm text-red-300">
          {report.mismatchedPeriods} period{report.mismatchedPeriods === 1 ? '' : 's'} disagree
          {report.mismatchedPeriods === 1 ? 's' : ''} with {report.mismatchedPeriods === 1 ? 'its' : 'their'} ledger
          rows. Both figures are shown.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="border-b border-slate-700">
            <tr>
              <th className={TH}>Business</th>
              <th className={TH}>Period start</th>
              <th className={TH_NUM}>Credits</th>
              <th className={TH_NUM}>Owner</th>
              <th className={TH_NUM}>Scheduled</th>
              <th className={TH_NUM}>External</th>
              <th className={TH_NUM}>Corrections</th>
              <th className={TH_NUM}>Cost (USD)</th>
              <th className={TH_NUM}>Charges</th>
              <th className={TH_NUM}>Fallback</th>
              <th className={TH}>Check</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {report.periods.map((p) => (
              <tr key={`${p.accountId}|${p.periodStart}`} data-testid="period-row">
                <td className={TD} title={p.accountId}>
                  {accountLabel(p.companyName, p.accountId)}
                </td>
                <td className={`${TD} font-mono`}>{formatDay(p.periodStart)}</td>
                {p.stored ? (
                  <FiguresCells f={p.stored} />
                ) : (
                  <td className={`${TD} text-red-300`} colSpan={8}>
                    no totals row for this period
                  </td>
                )}
                <td className={TD}>
                  <CheckCell matches={p.matches} fromRows={p.fromRows} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-600">
            <tr data-testid="period-total-row">
              <td className={`${TD} font-semibold`} colSpan={2}>
                Total
              </td>
              <FiguresCells f={report.grandTotal.stored} />
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </SectionShell>
  );
}

// ============ 2. Breakdowns ============

function breakdownKey(line: CostBreakdownLine): string {
  if (line.unresolved) return UNRESOLVED_LABEL;
  return line.key ?? NOT_DECLARED_LABEL;
}

function BreakdownTable({ title, lines }: { title: string; lines: CostBreakdownLine[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-700/60">
      <table className="min-w-full text-sm" data-testid={`breakdown-${title}`}>
        <thead className="border-b border-slate-700">
          <tr>
            <th className={TH}>{title}</th>
            <th className={TH_NUM}>Charges</th>
            <th className={TH_NUM}>Credits</th>
            <th className={TH_NUM}>Cost (USD)</th>
            <th className={TH_NUM}>of which corrections</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {lines.map((line) => (
            <tr key={`${line.unresolved}|${line.key}`}>
              <td className={`${TD} font-mono ${line.unresolved ? 'text-amber-300' : ''}`}>
                {breakdownKey(line)}
                {line.failedCharges > 0 && (
                  <span className="ml-2 text-[11px] text-slate-400">({line.failedCharges} failed)</span>
                )}
              </td>
              <td className={TD_NUM}>{formatCount(line.charges)}</td>
              <td className={TD_NUM}>{formatCredits(line.credits)}</td>
              <td className={TD_NUM}>{formatUsd(line.costUsd)}</td>
              <td className={TD_NUM}>
                {line.corrections > 0
                  ? `${formatCredits(line.correctionCredits)} (${line.corrections})`
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BreakdownsSection({ report }: { report: CostReportPayload }) {
  return (
    <SectionShell
      title={
        <>
          Breakdowns <span className="font-normal text-slate-400">&mdash; {NET_INCLUDING_CORRECTIONS}</span>
        </>
      }
      testId="costs-breakdowns"
    >
      {report.breakdowns === null ? (
        <SectionFailed testId="costs-breakdowns-failed" />
      ) : (
        <>
          <p className="text-xs text-slate-400">{BREAKDOWN_NOTE}</p>
          {report.sections.originals === 'failed' && (
            <p data-testid="costs-originals-failed" className="text-xs text-red-300">
              {ORIGINALS_FAILED(report.unresolvedCorrections.count, formatCredits(report.unresolvedCorrections.credits))}
            </p>
          )}
          {report.unresolvedCorrections.count > 0 && report.sections.originals !== 'failed' && (
            <p data-testid="costs-unresolved" className="text-xs text-amber-300">
              {report.unresolvedCorrections.count} correction
              {report.unresolvedCorrections.count === 1 ? '' : 's'} (
              {formatCredits(report.unresolvedCorrections.credits)} credits) could not be matched to the charge
              {report.unresolvedCorrections.count === 1 ? ' it corrects' : 's they correct'}; counted on their own line.
            </p>
          )}
          <div className="grid gap-3 xl:grid-cols-2">
            <BreakdownTable title="Action type" lines={report.breakdowns.byActionType} />
            <BreakdownTable title="Area" lines={report.breakdowns.byArea} />
            <BreakdownTable title="Service" lines={report.breakdowns.byService} />
            <BreakdownTable title="Trigger" lines={report.breakdowns.byTrigger} />
          </div>
        </>
      )}
    </SectionShell>
  );
}

// ============ 3. Fallback-priced charges ============

export function FallbackSection({ report }: { report: CostReportPayload }) {
  const { fallback } = report;
  return (
    <SectionShell title="Fallback-priced charges" testId="costs-fallback">
      {report.sections.rows === 'failed' ? (
        <SectionFailed testId="costs-fallback-failed" />
      ) : (
        <>
          <p className="text-sm text-slate-200" data-testid="costs-fallback-count">
            {fallback.count} fallback-priced charge{fallback.count === 1 ? '' : 's'}
            {fallback.count > 0 ? `, ${fallback.reconciled} reconciled` : ''}.
          </p>
          <p className="text-xs text-slate-400">{FALLBACK_NOTE}</p>
          {fallback.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr>
                    <th className={TH}>When (UTC)</th>
                    <th className={TH}>Business</th>
                    <th className={TH}>Action type</th>
                    <th className={TH_NUM}>Credits</th>
                    <th className={TH_NUM}>Cost (USD)</th>
                    <th className={TH}>Group id</th>
                    <th className={TH}>Reconciled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {fallback.items.map((item) => (
                    <tr key={item.actionId ?? `${item.accountId}|${item.createdAt}`} data-testid="fallback-row">
                      <td className={`${TD} font-mono`}>{item.createdAt.slice(0, 16).replace('T', ' ')}</td>
                      <td className={TD} title={item.accountId}>
                        {accountLabel(item.companyName, item.accountId)}
                      </td>
                      <td className={`${TD} font-mono`}>{item.actionType ?? '—'}</td>
                      <td className={TD_NUM}>{formatCredits(item.credits)}</td>
                      <td className={TD_NUM}>{formatUsd(item.costUsd)}</td>
                      <td className={`${TD} font-mono text-xs`} title={item.actionId ?? undefined}>
                        {item.groupId ?? '—'}
                      </td>
                      <td className={TD}>{item.reconciled ? 'yes' : 'no'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {fallback.count > fallback.items.length && (
                <p className="mt-2 text-xs text-slate-400">
                  Showing the newest {fallback.items.length} of {fallback.count}.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </SectionShell>
  );
}

// ============ 4. Spread per action type ============

export function SpreadSection({ report }: { report: CostReportPayload }) {
  return (
    <SectionShell title="Spread per action type" testId="costs-spread">
      {report.sections.rows === 'failed' ? (
        <SectionFailed testId="costs-spread-failed" />
      ) : (
        <>
          <p className="text-xs text-slate-400">{SPREAD_NOTE(report.limits.fewExamplesBelow)}</p>
          {report.spreads.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-slate-700">
                  <tr>
                    <th className={TH}>Action type</th>
                    <th className={TH}>Area</th>
                    <th className={TH_NUM}>Succeeded</th>
                    <th className={TH_NUM}>Failed</th>
                    <th className={TH_NUM}>Cost p50</th>
                    <th className={TH_NUM}>Cost p90</th>
                    <th className={TH_NUM}>Credits p50</th>
                    <th className={TH_NUM}>Credits p90</th>
                    <th className={TH} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {report.spreads.map((s) => (
                    <tr key={`${s.service}|${s.actionType}`} data-testid="spread-row">
                      <td className={`${TD} font-mono`}>
                        {s.actionType ?? '—'}
                        <span className="ml-1 text-[11px] text-slate-500">{s.service}</span>
                      </td>
                      <td className={TD}>{s.area ?? NOT_DECLARED_LABEL}</td>
                      <td className={TD_NUM}>{formatCount(s.examples)}</td>
                      <td className={TD_NUM}>{formatCount(s.failed)}</td>
                      <td className={TD_NUM}>{formatUsd(s.costUsd.p50)}</td>
                      <td className={TD_NUM}>{formatUsd(s.costUsd.p90)}</td>
                      <td className={TD_NUM}>{formatCredits(s.credits.p50)}</td>
                      <td className={TD_NUM}>{formatCredits(s.credits.p90)}</td>
                      <td className={TD}>
                        {s.fewExamples && (
                          <Chip tone="warn" testId="spread-few-examples">
                            few examples
                          </Chip>
                        )}
                        {s.fallbackExcluded > 0 && (
                          <span className="ml-2 text-[11px] text-slate-400">
                            {s.fallbackExcluded} fallback left out
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </SectionShell>
  );
}

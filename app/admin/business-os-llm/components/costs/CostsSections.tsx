/**
 * The four sections of the Costs & credits tab (credit deduction slice 4a,
 * workplan §4.1): per account and period, the breakdowns, the fallback-priced
 * charges, and the spread per action type. Presentational only: every figure
 * arrives in the payload; nothing is computed here but formatting.
 *
 * Admin Layout Standard L-9b (§2.7): each section stays a card (four
 * differently shaped blocks, §5.7 non-table content), and every table inside
 * takes the shared table classes, so the tab has one density (F-72) and every
 * number column is right-aligned in tabular figures, never monospace (F-71).
 * The period check and "few examples" are the shared `StatusChip` (§5.9:
 * "matches its rows" is a proven-clear state, so `ok`; "not checked" is
 * `unknown`). Fallback times go through the shared `formatUtc`, through
 * `Date`, never sliced as text (F-74). Codes (action types, breakdown keys,
 * period starts) keep their monospace: they are codes, not numbers.
 */

import {
  ADMIN_TABLE,
  ADMIN_TABLE_WRAP,
  ADMIN_TBODY,
  ADMIN_TD,
  ADMIN_TD_ID,
  ADMIN_TD_NUM,
  ADMIN_TH,
  ADMIN_TH_NUM,
  ADMIN_THEAD,
  formatShortId,
} from '@/app/admin/components/layout/adminTable';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';

import {
  BREAKDOWN_NOTE,
  CHARGED_DELETED_NONE,
  CHARGED_IN_WINDOW_NOTE,
  CHARGED_IN_WINDOW_TITLE,
  CHARGED_READ_FAILED,
  COSTS_WHOLE_PERIODS_LABEL,
  chargedDeletedLine,
  FALLBACK_NOTE,
  NET_INCLUDING_CORRECTIONS,
  NOT_DECLARED_LABEL,
  ORIGINALS_FAILED,
  SECTION_FAILED,
  KPI_AT_LEAST,
  SPREAD_NOTE,
  UNRESOLVED_LABEL,
} from '../../costCopy';
import { formatCount, formatCredits, formatDay, formatUsd } from '../../costFormat';
import type {
  CostBreakdownLine,
  CostPeriodFigures,
  CostReportPayload,
} from '../../costTypes';

function accountLabel(companyName: string | null, accountId: string): string {
  return companyName ?? `${accountId.slice(0, 8)}…`;
}

function SectionShell({ title, testId, children }: { title: React.ReactNode; testId: string; children: React.ReactNode }) {
  return (
    // `id` = the test id: the KPI strip's anchor tiles point here (L-9a, §2.5).
    <section id={testId} data-testid={testId} className="space-y-3 rounded-xl border border-slate-700 bg-slate-800/40 p-4">
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
      <td className={ADMIN_TD_NUM}>{formatCredits(f.creditsTotal)}</td>
      <td className={ADMIN_TD_NUM}>{formatCredits(f.creditsOwner)}</td>
      <td className={ADMIN_TD_NUM}>{formatCredits(f.creditsScheduled)}</td>
      <td className={ADMIN_TD_NUM}>{formatCredits(f.creditsExternal)}</td>
      <td className={ADMIN_TD_NUM}>{formatCredits(f.creditsAdjustment)}</td>
      <td className={ADMIN_TD_NUM}>{formatUsd(f.costUsd)}</td>
      <td className={ADMIN_TD_NUM}>{formatCount(f.charges)}</td>
      <td className={ADMIN_TD_NUM}>{formatCount(f.fallbackPriced)}</td>
    </>
  );
}

function CheckCell({ matches, fromRows }: { matches: boolean | null; fromRows: CostPeriodFigures | null }) {
  if (matches === true) {
    return (
      <StatusChip tone="ok" testId="period-check-ok">
        matches its rows
      </StatusChip>
    );
  }
  if (matches === false) {
    return (
      <div className="space-y-1">
        <StatusChip tone="danger" testId="period-check-mismatch">
          mismatch
        </StatusChip>
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
    <StatusChip tone="unknown" testId="period-check-skipped">
      not checked
    </StatusChip>
  );
}

/**
 * Money MK-2 (SA-1): the cost tile's own block. Charges CREATED in the window,
 * deleted accounts included (their own line, all businesses only: with one
 * business picked there is none by construction). Every figure is from the
 * payload; nothing is computed here but formatting.
 */
export function ChargedInWindowSection({ report }: { report: CostReportPayload }) {
  const charged = report.chargedInWindow;
  const known = charged.status !== 'unknown' && charged.costUsd !== null;
  return (
    <SectionShell title={CHARGED_IN_WINDOW_TITLE} testId="costs-charged">
      <p className="text-xs text-slate-400">{CHARGED_IN_WINDOW_NOTE}</p>
      {!known ? (
        <p data-testid="costs-charged-failed" className="text-sm text-red-300">
          {CHARGED_READ_FAILED}
        </p>
      ) : (
        <>
          <p data-testid="costs-charged-total" className="text-sm text-slate-200">
            {charged.status === 'partial' && <>{KPI_AT_LEAST} </>}
            {formatUsd(charged.costUsd)} &middot; {formatCredits(charged.credits)} credits &middot;{' '}
            {formatCount(charged.charges ?? 0)} charges
          </p>
          {report.accountFilter === null && charged.deleted && (
            <p data-testid="costs-charged-deleted" className="text-sm text-slate-300">
              {charged.deleted.rows > 0
                ? chargedDeletedLine(formatUsd(charged.deleted.costUsd), charged.deleted.rows)
                : CHARGED_DELETED_NONE}
            </p>
          )}
        </>
      )}
    </SectionShell>
  );
}

export function PeriodsSection({ report }: { report: CostReportPayload }) {
  return (
    <SectionShell title="Per account and billing period" testId="costs-periods">
      <p data-testid="costs-whole-periods" className="text-xs text-slate-400">
        {COSTS_WHOLE_PERIODS_LABEL}
      </p>
      {report.mismatchedPeriods > 0 && (
        <p data-testid="costs-mismatch-summary" className="text-sm text-red-300">
          {report.mismatchedPeriods} period{report.mismatchedPeriods === 1 ? '' : 's'} disagree
          {report.mismatchedPeriods === 1 ? 's' : ''} with {report.mismatchedPeriods === 1 ? 'its' : 'their'} ledger
          rows. Both figures are shown.
        </p>
      )}
      <div className={ADMIN_TABLE_WRAP}>
        <table className={ADMIN_TABLE} aria-label="Per account and billing period">
          <thead className={ADMIN_THEAD}>
            <tr>
              <th scope="col" className={ADMIN_TH}>Business</th>
              <th scope="col" className={ADMIN_TH}>Period start</th>
              <th scope="col" className={ADMIN_TH_NUM}>Credits</th>
              <th scope="col" className={ADMIN_TH_NUM}>Owner</th>
              <th scope="col" className={ADMIN_TH_NUM}>Scheduled</th>
              <th scope="col" className={ADMIN_TH_NUM}>External</th>
              <th scope="col" className={ADMIN_TH_NUM}>Corrections</th>
              <th scope="col" className={ADMIN_TH_NUM}>Cost (USD)</th>
              <th scope="col" className={ADMIN_TH_NUM}>Charges</th>
              <th scope="col" className={ADMIN_TH_NUM}>Fallback</th>
              <th scope="col" className={ADMIN_TH}>Check</th>
            </tr>
          </thead>
          <tbody className={ADMIN_TBODY}>
            {report.periods.map((p) => (
              <tr key={`${p.accountId}|${p.periodStart}`} data-testid="period-row">
                <td className={ADMIN_TD} title={p.accountId}>
                  {accountLabel(p.companyName, p.accountId)}
                </td>
                <td className={`${ADMIN_TD} whitespace-nowrap font-mono`}>{formatDay(p.periodStart)}</td>
                {p.stored ? (
                  <FiguresCells f={p.stored} />
                ) : (
                  <td className={`${ADMIN_TD} text-red-300`} colSpan={8}>
                    no totals row for this period
                  </td>
                )}
                <td className={ADMIN_TD}>
                  <CheckCell matches={p.matches} fromRows={p.fromRows} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-600">
            <tr data-testid="period-total-row">
              <td className={`${ADMIN_TD} font-semibold text-slate-200`} colSpan={2}>
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
    <div className={ADMIN_TABLE_WRAP}>
      <table className={ADMIN_TABLE} data-testid={`breakdown-${title}`} aria-label={`Breakdown by ${title.toLowerCase()}`}>
        <thead className={ADMIN_THEAD}>
          <tr>
            <th scope="col" className={ADMIN_TH}>{title}</th>
            <th scope="col" className={ADMIN_TH_NUM}>Charges</th>
            <th scope="col" className={ADMIN_TH_NUM}>Credits</th>
            <th scope="col" className={ADMIN_TH_NUM}>Cost (USD)</th>
            <th scope="col" className={ADMIN_TH_NUM}>of which corrections</th>
          </tr>
        </thead>
        <tbody className={ADMIN_TBODY}>
          {lines.map((line) => (
            <tr key={`${line.unresolved}|${line.key}`}>
              <td className={`${ADMIN_TD} font-mono ${line.unresolved ? 'text-amber-300' : ''}`}>
                {breakdownKey(line)}
                {line.failedCharges > 0 && (
                  <span className="ml-2 text-[11px] text-slate-400">({line.failedCharges} failed)</span>
                )}
              </td>
              <td className={ADMIN_TD_NUM}>{formatCount(line.charges)}</td>
              <td className={ADMIN_TD_NUM}>{formatCredits(line.credits)}</td>
              <td className={ADMIN_TD_NUM}>{formatUsd(line.costUsd)}</td>
              <td className={ADMIN_TD_NUM}>
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

/** The hover text of the short group id: the full group id, then the action id when there is one. */
function fallbackIdTitle(groupId: string | null, actionId: string | null): string | undefined {
  const parts = [groupId ? `Group ${groupId}` : null, actionId ? `Action ${actionId}` : null].filter(
    (part): part is string => part !== null
  );
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

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
            <div>
              <div className={ADMIN_TABLE_WRAP}>
                <table className={ADMIN_TABLE} aria-label="Fallback-priced charges">
                  <thead className={ADMIN_THEAD}>
                    <tr>
                      <th scope="col" className={ADMIN_TH}>When (UTC)</th>
                      <th scope="col" className={ADMIN_TH}>Business</th>
                      <th scope="col" className={ADMIN_TH}>Action type</th>
                      <th scope="col" className={ADMIN_TH_NUM}>Credits</th>
                      <th scope="col" className={ADMIN_TH_NUM}>Cost (USD)</th>
                      <th scope="col" className={ADMIN_TH}>Group id</th>
                      <th scope="col" className={ADMIN_TH}>Reconciled</th>
                    </tr>
                  </thead>
                  <tbody className={ADMIN_TBODY}>
                    {fallback.items.map((item) => (
                      <tr key={item.actionId ?? `${item.accountId}|${item.createdAt}`} data-testid="fallback-row">
                        {/* Through Date, never sliced as text (F-74): an offset instant shows its UTC time. */}
                        <td className={`${ADMIN_TD} whitespace-nowrap tabular-nums`}>{formatUtc(item.createdAt)}</td>
                        <td className={ADMIN_TD} title={item.accountId}>
                          {accountLabel(item.companyName, item.accountId)}
                        </td>
                        <td className={`${ADMIN_TD} font-mono`}>{item.actionType ?? '—'}</td>
                        <td className={ADMIN_TD_NUM}>{formatCredits(item.credits)}</td>
                        <td className={ADMIN_TD_NUM}>{formatUsd(item.costUsd)}</td>
                        {/* §5.7 Ids: the short id shown, the full group id and the action id on hover. */}
                        <td className={ADMIN_TD} title={fallbackIdTitle(item.groupId, item.actionId)} data-testid="fallback-group-id">
                          <span className={ADMIN_TD_ID}>{formatShortId(item.groupId)}</span>
                        </td>
                        <td className={ADMIN_TD}>{item.reconciled ? 'yes' : 'no'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
            <div className={ADMIN_TABLE_WRAP}>
              <table className={ADMIN_TABLE} aria-label="Spread per action type">
                <thead className={ADMIN_THEAD}>
                  <tr>
                    <th scope="col" className={ADMIN_TH}>Action type</th>
                    <th scope="col" className={ADMIN_TH}>Area</th>
                    <th scope="col" className={ADMIN_TH_NUM}>Succeeded</th>
                    <th scope="col" className={ADMIN_TH_NUM}>Failed</th>
                    <th scope="col" className={ADMIN_TH_NUM}>Cost p50</th>
                    <th scope="col" className={ADMIN_TH_NUM}>Cost p90</th>
                    <th scope="col" className={ADMIN_TH_NUM}>Credits p50</th>
                    <th scope="col" className={ADMIN_TH_NUM}>Credits p90</th>
                    <th scope="col" className={ADMIN_TH} />
                  </tr>
                </thead>
                <tbody className={ADMIN_TBODY}>
                  {report.spreads.map((s) => (
                    <tr key={`${s.service}|${s.actionType}`} data-testid="spread-row">
                      <td className={`${ADMIN_TD} font-mono`}>
                        {s.actionType ?? '—'}
                        <span className="ml-1 text-[11px] text-slate-400">{s.service}</span>
                      </td>
                      <td className={ADMIN_TD}>{s.area ?? NOT_DECLARED_LABEL}</td>
                      <td className={ADMIN_TD_NUM}>{formatCount(s.examples)}</td>
                      <td className={ADMIN_TD_NUM}>{formatCount(s.failed)}</td>
                      <td className={ADMIN_TD_NUM}>{formatUsd(s.costUsd.p50)}</td>
                      <td className={ADMIN_TD_NUM}>{formatUsd(s.costUsd.p90)}</td>
                      <td className={ADMIN_TD_NUM}>{formatCredits(s.credits.p50)}</td>
                      <td className={ADMIN_TD_NUM}>{formatCredits(s.credits.p90)}</td>
                      <td className={ADMIN_TD}>
                        {s.fewExamples && (
                          <StatusChip tone="warn" testId="spread-few-examples">
                            few examples
                          </StatusChip>
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

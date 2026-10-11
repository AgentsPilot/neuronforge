'use client';

/**
 * AI cost & usage: the table (Admin Layout Standard L-2b, workplan §3.3).
 *
 * Two variants on the shared table classes (§5.7, C-13): aggregate rows
 * (provider … execution) and the call rows of one run. Aggregate rows drill
 * through a real link in their label cell (§5.8 D-3); call rows open the
 * drawer through their Open button only (§5.8 D-2, L-1d SA Q-10). No `tr` has
 * a click handler.
 *
 * No colour carries meaning here except the status chips (§5.9, T-6): the
 * category columns, the footer and the labels are plain text.
 */

import type { MouseEvent } from 'react';

import { isPlainLeftClick } from '@/app/admin/components/layout/KpiStrip';
import { OpenRowButton } from '@/app/admin/components/layout/OpenRowButton';
import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import { formatCount } from '@/app/admin/components/layout/adminFormat';
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

import { callStatus, formatLatency, readMeta } from '../analyticsCall';
import {
  BREAKDOWN_OPTIONS,
  formatCost,
  formatNumber,
  type BreakdownDimension,
  type CategoryTotals,
  type DrillDownItem,
  type DrillDownResponse,
  type Scope,
} from '../analyticsTypes';

/** The response's totals: the route's own type, so the two shapes cannot drift (SA C-1). */
export type AnalyticsTotals = DrillDownResponse['totals'];

export interface AnalyticsTableProps {
  /** Non-empty: the page shows `AdminEmpty` instead of an empty table (§5.10). */
  items: DrillDownItem[];
  scope: Scope;
  breakdownBy: BreakdownDimension;
  totals: AnalyticsTotals;
  categoryTotals: CategoryTotals | null;
  /** Any drill, business or category filter is on: the footer says "Subtotal" (F-49). */
  drilled: boolean;
  /** The drilled view's real address, for a modified or middle click. */
  drillHref: (item: DrillDownItem) => string;
  /** A plain left click on a row's name: drill in place. */
  onDrill: (item: DrillDownItem) => void;
  /** A call row's Open button. */
  onOpenCall: (item: DrillDownItem, opener: HTMLButtonElement) => void;
}

const CHIP = 'text-xs px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400';

/** Context chips: the related dimensions a row spans. */
export function ContextChips({ item, breakdownBy, scope }: { item: DrillDownItem; breakdownBy: BreakdownDimension; scope: Scope }) {
  const meta = readMeta(item);
  const chips: Array<{ key: string; text: string }> = [];
  if (breakdownBy !== 'user' && meta.userCount !== null && meta.userCount > 0) {
    chips.push({ key: 'users', text: `${meta.userCount} users` });
  }
  // Agents and executions are AgentsPilot counts: not shown in Business OS scope (C3-2).
  if (scope === 'all' && breakdownBy !== 'agent' && meta.agentCount !== null && meta.agentCount > 0) {
    chips.push({ key: 'agents', text: `${meta.agentCount} agents` });
  }
  if (scope === 'all' && breakdownBy !== 'execution' && meta.executionCount !== null && meta.executionCount > 0) {
    chips.push({ key: 'executions', text: `${meta.executionCount} executions` });
  }
  if (chips.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip.key} className={CHIP}>
          {chip.text}
        </span>
      ))}
    </div>
  );
}

/**
 * A row's name as a real link to the drilled view (§5.8 D-3). A plain left
 * click applies the same patch in place; any other click is the browser's
 * (a new tab, a new window). The check is the KPI filter tile's own (SA Q-3).
 * The link holds only the label, so its name is exactly the label (SA S-4).
 */
function DrillLink({ item, href, onDrill }: { item: DrillDownItem; href: string; onDrill: (item: DrillDownItem) => void }) {
  return (
    <a
      href={href}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        onDrill(item);
      }}
      className="rounded font-medium text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500"
    >
      {item.label}
    </a>
  );
}

/** A category cost cell: the cost, or an em dash when there is none (§5.7 Missing value). */
function categoryCost(cost: number | undefined): string {
  return cost ? formatCost(cost) : '—';
}

export function AnalyticsTable(props: AnalyticsTableProps) {
  const isCalls = props.items[0]?.type === 'call';
  return (
    <div className={ADMIN_TABLE_WRAP}>
      {isCalls ? <CallTable {...props} /> : <AggregateTable {...props} />}
    </div>
  );
}

function AggregateTable({ items, scope, breakdownBy, totals, categoryTotals, drilled, drillHref, onDrill }: AnalyticsTableProps) {
  const dimension = BREAKDOWN_OPTIONS.find((option) => option.value === breakdownBy)?.label ?? 'Name';
  const showCategories = scope === 'all';
  return (
    <table className={ADMIN_TABLE} aria-label={`AI cost by ${dimension}`} data-testid="analytics-table">
      <thead className={ADMIN_THEAD}>
        <tr>
          <th scope="col" className={ADMIN_TH}>{dimension}</th>
          <th scope="col" className={ADMIN_TH_NUM}>Cost (USD)</th>
          <th scope="col" className={ADMIN_TH_NUM}>Tokens</th>
          <th scope="col" className={ADMIN_TH_NUM}>Calls</th>
          {/* AgentsPilot taxonomy: in Business OS scope these would read a dash
              on every row while the cost sits in System (W3-7). "(USD)" also
              keeps the headers unique when grouped by Execution. */}
          {showCategories && (
            <>
              <th scope="col" data-testid="table-col-creation" className={ADMIN_TH_NUM}>Creation (USD)</th>
              <th scope="col" data-testid="table-col-execution" className={ADMIN_TH_NUM}>Execution (USD)</th>
              <th scope="col" data-testid="table-col-memory" className={ADMIN_TH_NUM}>Memory (USD)</th>
            </>
          )}
        </tr>
      </thead>
      <tbody className={ADMIN_TBODY}>
        {items.map((item) => {
          const category = item.type === 'activity' ? readMeta(item).category : null;
          return (
            <tr key={item.id}>
              <td className={ADMIN_TD}>
                <DrillLink item={item} href={drillHref(item)} onDrill={onDrill} />
                <ContextChips item={item} breakdownBy={breakdownBy} scope={scope} />
                {category && <div className="mt-1 text-xs text-slate-400">{category}</div>}
              </td>
              <td className={`${ADMIN_TD_NUM} text-slate-200`}>{formatCost(item.cost)}</td>
              <td className={ADMIN_TD_NUM}>{formatNumber(item.tokens)}</td>
              <td className={ADMIN_TD_NUM}>{formatCount(item.calls)}</td>
              {showCategories && (
                <>
                  <td className={ADMIN_TD_NUM}>{categoryCost(item.category_breakdown?.creation.cost)}</td>
                  <td className={ADMIN_TD_NUM}>{categoryCost(item.category_breakdown?.execution.cost)}</td>
                  <td className={ADMIN_TD_NUM}>{categoryCost(item.category_breakdown?.memory.cost)}</td>
                </>
              )}
            </tr>
          );
        })}
      </tbody>
      <tfoot className="border-t border-slate-700">
        <tr className="font-medium text-slate-200" data-testid="analytics-footer">
          <td className={ADMIN_TD}>{drilled ? 'Subtotal' : 'Total'}</td>
          <td className={ADMIN_TD_NUM}>{formatCost(totals.cost)}</td>
          <td className={ADMIN_TD_NUM}>{formatNumber(totals.tokens)}</td>
          <td className={ADMIN_TD_NUM}>{formatCount(totals.calls)}</td>
          {showCategories && (
            <>
              <td className={ADMIN_TD_NUM}>{formatCost(categoryTotals?.creation.cost ?? 0)}</td>
              <td className={ADMIN_TD_NUM}>{formatCost(categoryTotals?.execution.cost ?? 0)}</td>
              <td className={ADMIN_TD_NUM}>{formatCost(categoryTotals?.memory.cost ?? 0)}</td>
            </>
          )}
        </tr>
      </tfoot>
    </table>
  );
}

function CallTable({ items, totals, onOpenCall }: AnalyticsTableProps) {
  return (
    <table className={ADMIN_TABLE} aria-label="AI calls in this run" data-testid="analytics-table">
      <thead className={ADMIN_THEAD}>
        <tr>
          <th scope="col" className={ADMIN_TH}>Details</th>
          <th scope="col" className={ADMIN_TH}>Call</th>
          <th scope="col" className={ADMIN_TH_NUM}>Cost (USD)</th>
          <th scope="col" className={ADMIN_TH_NUM}>Input tokens</th>
          <th scope="col" className={ADMIN_TH_NUM}>Output tokens</th>
          <th scope="col" className={ADMIN_TH_NUM}>Total tokens</th>
          <th scope="col" className={ADMIN_TH_NUM}>Latency</th>
          <th scope="col" className={ADMIN_TH}>Status</th>
        </tr>
      </thead>
      <tbody className={ADMIN_TBODY}>
        {items.map((item, index) => {
          const meta = readMeta(item);
          const status = callStatus(meta.success);
          return (
            <tr key={item.id}>
              <td className={ADMIN_TD}>
                {/* The row number keeps the name unique when labels repeat ("gpt-4o call"). */}
                <OpenRowButton
                  testId={`open-call-${item.id}`}
                  label={`Open details for call ${index + 1}, ${item.label}`}
                  onOpen={(opener) => onOpenCall(item, opener)}
                />
              </td>
              <td className={`${ADMIN_TD} font-medium text-white`}>{item.label}</td>
              <td className={`${ADMIN_TD_NUM} text-slate-200`}>{formatCost(item.cost)}</td>
              <td className={ADMIN_TD_NUM}>{formatNumber(item.inputTokens)}</td>
              <td className={ADMIN_TD_NUM}>{formatNumber(item.outputTokens)}</td>
              <td className={ADMIN_TD_NUM}>{formatNumber(item.tokens)}</td>
              <td className={ADMIN_TD_NUM}>{formatLatency(meta.latencyMs, 'cell')}</td>
              <td className={ADMIN_TD}>
                <StatusChip tone={status.tone} testId="call-status">
                  {status.word}
                </StatusChip>
              </td>
            </tr>
          );
        })}
      </tbody>
      <tfoot className="border-t border-slate-700">
        <tr className="font-medium text-slate-200" data-testid="analytics-footer">
          <td className={ADMIN_TD} colSpan={2}>
            Total
          </td>
          <td className={ADMIN_TD_NUM}>{formatCost(totals.cost)}</td>
          <td className={ADMIN_TD_NUM}>{formatNumber(totals.inputTokens)}</td>
          <td className={ADMIN_TD_NUM}>{formatNumber(totals.outputTokens)}</td>
          <td className={ADMIN_TD_NUM}>{formatNumber(totals.tokens)}</td>
          {/* Latency and Status have no total: empty data cells keep the footer aligned. */}
          <td className={ADMIN_TD} />
          <td className={ADMIN_TD} />
        </tr>
      </tfoot>
    </table>
  );
}

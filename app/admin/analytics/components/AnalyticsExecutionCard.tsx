'use client';

/**
 * AI cost & usage: the run card above a run's calls (Admin Layout Standard
 * L-2b, workplan §2.4 and §3.5; SA Q-2).
 *
 * A static card, not a drawer: it describes the run every call row on screen
 * belongs to, so it is context for the table, not one row's detail. Nothing
 * expands (§5.8 D-1). Metadata only (C3-5): the same fields as the old panel,
 * with both statuses labelled apart (SA M-2): the run's as a chip, the
 * agent's as plain text. Times are UTC (F-50).
 */

import { StatusChip } from '@/app/admin/components/layout/StatusChip';
import { formatUtc } from '@/app/admin/components/layout/adminFormat';
import { ADMIN_TD_ID, formatShortId } from '@/app/admin/components/layout/adminTable';

import { executionStatusTone } from '../analyticsCall';
import type { AgentData, ExecutionDetails } from '../analyticsTypes';

export function AnalyticsExecutionCard({ details, agent }: { details: ExecutionDetails; agent: AgentData }) {
  const plugins = agent.connectedPlugins ?? [];
  const subLine = [
    'Agent run',
    agent.mode || null,
    plugins.length > 0 ? `${plugins.length} plugin(s)` : null,
  ].filter((part): part is string => part !== null);

  return (
    <div data-testid="execution-card" className="rounded-xl border border-slate-700 bg-slate-800/40 p-4">
      <h2 className="text-sm font-semibold text-white">{agent.name}</h2>
      <p className="mb-3 text-xs text-slate-400">{subLine.join(' · ')}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-slate-400">Started</dt>
        <dd className="text-slate-200">{formatUtc(details.startedAt ?? null)}</dd>
        <dt className="text-slate-400">Completed</dt>
        <dd className="text-slate-200">{details.completedAt ? formatUtc(details.completedAt) : 'In progress'}</dd>
        <dt className="text-slate-400">Run status</dt>
        <dd className="text-slate-200">
          <StatusChip tone={executionStatusTone(details.status)} testId="run-status">
            {details.status || 'Unknown'}
          </StatusChip>
        </dd>
        {agent.status && (
          <>
            <dt className="text-slate-400">Agent status</dt>
            <dd className="text-slate-200" data-testid="agent-status">
              {agent.status}
            </dd>
          </>
        )}
        <dt className="text-slate-400">Agent ID</dt>
        <dd className="text-slate-200">
          <span className={ADMIN_TD_ID} title={agent.id}>
            {formatShortId(agent.id)}
          </span>
        </dd>
        {plugins.length > 0 && (
          <>
            <dt className="text-slate-400">Connected plugins</dt>
            <dd className="flex flex-wrap gap-1">
              {plugins.map((plugin) => (
                <span
                  key={plugin}
                  className="rounded border border-slate-600 bg-slate-700/40 px-2 py-0.5 text-xs text-slate-300"
                >
                  {plugin}
                </span>
              ))}
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}

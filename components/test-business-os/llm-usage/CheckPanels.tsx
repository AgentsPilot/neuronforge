'use client';

import { useState } from 'react';
import type {
  AreaTotals,
  CallsCheck,
  GroupsCheck,
  LegacyLabelsCheck,
  LlmUsageCallRow,
  LlmUsageReport,
  PlatformAccountCheck,
  RowFlag,
  UsageCardCheck,
} from '@/lib/business-os/usage/llmUsageReportTypes';
import { StatusBadge } from './StatusBadge';
import { formatCostUsd, formatLocalTime, formatNumber, shortId, type DisplayStatus } from './formatters';

const INCOMPLETE_TEXT = 'Incomplete: more than 5,000 Business OS calls in this window; narrow the start time.';

const FLAG_LABEL: Record<RowFlag, string> = {
  legacy_feature: 'legacy label',
  unknown_area: 'unknown area',
  unknown_call_name: 'call name not in catalog',
  missing_group_id: 'no grouping id',
};

const panel: React.CSSProperties = { border: '1px solid #ddd', borderRadius: '4px', padding: '10px', marginTop: '12px' };
const table: React.CSSProperties = { borderCollapse: 'collapse', width: '100%', fontSize: '12px' };
const cell: React.CSSProperties = { borderBottom: '1px solid #eee', padding: '3px 6px', textAlign: 'left', verticalAlign: 'top' };

function PanelHeader({ title, status, testId }: { title: string; status: DisplayStatus; testId: string }) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
      <h3 style={{ margin: 0, fontSize: '15px' }}>{title}</h3>
      <StatusBadge status={status} testId={testId} />
    </div>
  );
}

function Warning({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} role="alert" style={{ color: '#856404', background: '#fff3cd', padding: '4px 8px', margin: '6px 0', fontSize: '12px' }}>
      {children}
    </div>
  );
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div role="alert" style={{ color: '#721c24', background: '#f8d7da', padding: '4px 8px', margin: '6px 0', fontSize: '12px' }}>
      {error}
    </div>
  );
}

function CopyId({ id }: { id: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span style={{ color: '#721c24' }}>none</span>;
  return (
    <span>
      <code title={id}>{shortId(id)}</code>{' '}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(id).then(() => setCopied(true));
        }}
        style={{ fontSize: '10px', padding: '0 4px', cursor: 'pointer' }}
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </span>
  );
}

function RowFlags({ row }: { row: LlmUsageCallRow }) {
  if (row.flags.length === 0) {
    return row.knownComponent ? <span style={{ color: '#666' }}> (expected: {row.knownComponent.reason})</span> : null;
  }
  return <span style={{ color: '#721c24' }}> [{row.flags.map((f) => FLAG_LABEL[f]).join(', ')}]</span>;
}

export function CallsPanel({ check }: { check: CallsCheck }) {
  return (
    <section style={panel} data-testid="llm-usage-panel-calls">
      <PanelHeader title="Check 1 — Calls" status={check.status} testId="llm-usage-panel-status-calls" />
      <ErrorLine error={check.error} />
      <p style={{ fontSize: '12px', margin: '6px 0' }}>
        {formatNumber(check.rowsRead)} Business OS calls read; {formatNumber(check.flaggedRows)} flagged (computed from all
        rows read, not only the rows shown).
      </p>
      {check.incomplete && <Warning>{INCOMPLETE_TEXT}</Warning>}
      {check.rowsTruncated && (
        <Warning testId="llm-usage-truncated-calls">
          Showing the newest {check.displayCap} of {formatNumber(check.rowsRead)} calls.
        </Warning>
      )}
      {check.rows.length > 0 && (
        <table style={table}>
          <thead>
            <tr>
              {['Time', 'Area', 'Call name', 'Grouping id', 'Tokens', 'Estimated cost', 'Success'].map((h) => (
                <th key={h} style={cell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {check.rows.map((row, i) => (
              <tr key={`${row.createdAt}-${i}`} style={{ background: row.flags.length ? '#fdf2f2' : undefined }}>
                <td style={cell}>{formatLocalTime(row.createdAt)}</td>
                <td style={cell}>{row.areaLabel}</td>
                <td style={cell}>
                  {row.component ?? '(none)'}
                  <RowFlags row={row} />
                </td>
                <td style={cell}>
                  <CopyId id={row.sessionId} />
                </td>
                <td style={cell}>{formatNumber(row.tokens)}</td>
                <td style={cell}>{formatCostUsd(row.estimatedCostUsd)} (estimated)</td>
                <td style={cell}>{row.success ? 'yes' : `no${row.errorCode ? ` (${row.errorCode})` : ''}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function PlatformAccountPanel({ check }: { check: PlatformAccountCheck }) {
  return (
    <section style={panel} data-testid="llm-usage-panel-platform">
      <PanelHeader title="Check 2 — Nothing on the platform account" status={check.status} testId="llm-usage-panel-status-platformAccount" />
      <ErrorLine error={check.error} />
      <p style={{ fontSize: '12px', margin: '6px 0' }}>
        Platform-wide, not limited to the selected business: a mis-attributed call has lost its account.{' '}
        {check.count !== null && <strong>{formatNumber(check.count)} Business OS calls on the platform account.</strong>}
      </p>
      {check.breakdownTruncated && (
        <Warning testId="llm-usage-truncated-platform">
          Breakdown built from the newest {formatNumber(check.breakdownRowsRead)} rows (cap {check.breakdownCap}); the count
          above is exact.
        </Warning>
      )}
      {check.breakdown.length > 0 && (
        <table style={table}>
          <tbody>
            {check.breakdown.map((b) => (
              <tr key={`${b.feature}|${b.component ?? ''}`}>
                <td style={cell}>{b.feature}</td>
                <td style={cell}>{b.component ?? '(none)'}</td>
                <td style={cell}>{formatNumber(b.calls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function LegacyLabelsPanel({ check }: { check: LegacyLabelsCheck }) {
  const helper = `${check.helperLabel.feature} / ${check.helperLabel.component}`;
  return (
    <section style={panel} data-testid="llm-usage-panel-legacy">
      <PanelHeader title="Check 3 — No legacy labels" status={check.status} testId="llm-usage-panel-status-legacyLabels" />
      <ErrorLine error={check.error} />
      <ul style={{ fontSize: '12px', margin: '6px 0' }}>
        <li>
          (a) Legacy feature values on the selected business:{' '}
          {check.legacyOnSelected ? formatNumber(check.legacyOnSelected.count) : '—'}
          {check.legacyOnSelected?.byFeature.map((f) => ` · ${f.feature} ×${f.calls}`)}
          {check.legacyOnSelected?.incomplete && <Warning>{INCOMPLETE_TEXT}</Warning>}
        </li>
        <li>
          (a) Legacy feature values on the platform account: {check.legacyOnPlatform ? formatNumber(check.legacyOnPlatform.count) : '—'}
        </li>
        <li>
          (b) <code>{helper}</code> on the selected business (a mislabelled call):{' '}
          {check.helperLabelOnSelected ? formatNumber(check.helperLabelOnSelected.count) : '—'}
        </li>
        <li>
          (c) <code>{helper}</code> on the platform account — Info only, never Fail:{' '}
          {check.helperLabelOnPlatform ? formatNumber(check.helperLabelOnPlatform.count) : '—'}
          <div style={{ color: '#666' }}>
            Since Layer 1 the only live source is the onboarding conversation. A website or intake call that lost its
            context would also appear here; this tab can&apos;t prove it is absent. Match these times to your own test
            actions.
          </div>
          {check.helperLabelOnPlatform && check.helperLabelOnPlatform.timestamps.length > 0 && (
            <div>{check.helperLabelOnPlatform.timestamps.map(formatLocalTime).join(' · ')}</div>
          )}
          {check.helperLabelOnPlatform?.timestampsTruncated && (
            <Warning testId="llm-usage-truncated-timestamps">
              Showing the newest {check.helperLabelOnPlatform.timestampCap} timestamps.
            </Warning>
          )}
        </li>
      </ul>
    </section>
  );
}

export function GroupsPanel({ check }: { check: GroupsCheck }) {
  return (
    <section style={panel} data-testid="llm-usage-panel-groups">
      <PanelHeader title="Check 4 — Grouped by action" status={check.status} testId="llm-usage-panel-status-groups" />
      <ErrorLine error={check.error} />
      <p style={{ fontSize: '12px', color: '#666', margin: '6px 0' }}>
        Insight runs share one grouping id across businesses; only this business&apos;s calls are counted. A chat turn may
        lack the plan-cache store embedding (Layer 1 KI-2); that is not a failure.
      </p>
      {check.incomplete && <Warning>{INCOMPLETE_TEXT}</Warning>}
      {check.groupsTruncated && (
        <Warning testId="llm-usage-truncated-groups">
          Showing the newest {check.displayCap} of {formatNumber(check.groupsTotal)} groups.
        </Warning>
      )}
      {check.groups.length > 0 && (
        <table style={table}>
          <thead>
            <tr>
              {['Grouping id', 'Area', 'Calls', 'Call names', 'Tokens', 'Estimated cost', 'First', 'Last'].map((h) => (
                <th key={h} style={cell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {check.groups.map((g) => (
              <tr key={g.sessionId}>
                <td style={cell}>
                  <CopyId id={g.sessionId} />
                </td>
                <td style={cell}>{g.areaLabel}</td>
                <td style={cell}>{g.callCount}</td>
                <td style={cell}>{g.callSummary}</td>
                <td style={cell}>{formatNumber(g.tokens)}</td>
                <td style={cell}>{formatCostUsd(g.estimatedCostUsd)} (estimated)</td>
                <td style={cell}>{formatLocalTime(g.firstAt)}</td>
                <td style={cell}>{formatLocalTime(g.lastAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {check.ungroupedTotal > 0 && (
        <>
          <h4 style={{ fontSize: '13px', margin: '10px 0 4px' }}>
            Ungrouped ({formatNumber(check.ungroupedTotal)}; {formatNumber(check.ungroupedFlagged)} flagged)
          </h4>
          {check.ungroupedTruncated && <Warning>Showing the newest {check.displayCap} ungrouped calls.</Warning>}
          <table style={table}>
            <tbody>
              {check.ungrouped.map((row, i) => (
                <tr key={`${row.createdAt}-${i}`} style={{ background: row.expected ? undefined : '#fdf2f2' }}>
                  <td style={cell}>{formatLocalTime(row.createdAt)}</td>
                  <td style={cell}>{row.areaLabel}</td>
                  <td style={cell}>{row.component ?? '(none)'}</td>
                  <td style={cell}>{row.expected ? `expected (${row.knownComponent?.reason ?? 'exempt'})` : 'flagged: no grouping id'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function UsageCardPanel({ check }: { check: UsageCardCheck }) {
  return (
    <section style={panel} data-testid="llm-usage-panel-card">
      <PanelHeader title="Check 5 — Usage card view" status={check.status} testId="llm-usage-panel-status-usageCard" />
      <ErrorLine error={check.error} />
      <p style={{ fontSize: '12px', color: '#666', margin: '6px 0' }} data-testid="llm-usage-card-caveat">
        Computed exactly as the owner&apos;s usage card computes it, over this tab&apos;s start time with an open end (the
        card&apos;s computation has no end bound). The owner&apos;s card uses fixed ranges (24 hours to 90 days), so the figures
        match it only when the windows match. Covers all of the business&apos;s usage, not only Business OS.
      </p>
      {check.totals && (
        <p style={{ fontSize: '12px', margin: '6px 0' }}>
          Total: {formatNumber(check.totals.calls)} calls · {formatNumber(check.totals.tokens)} tokens ·{' '}
          {formatNumber(check.totals.credits)} credits (summed by {check.summedBy}, {check.tokensPerCredit} tokens per credit)
        </p>
      )}
      {check.categories.length > 0 && (
        <table style={table}>
          <thead>
            <tr>
              {['Category', 'Calls', 'Tokens', 'Credits', 'On the card'].map((h) => (
                <th key={h} style={cell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {check.categories.map((c) => (
              <tr key={c.key}>
                <td style={cell}>{c.key}</td>
                <td style={cell}>{formatNumber(c.calls)}</td>
                <td style={cell}>{formatNumber(c.tokens)}</td>
                <td style={cell}>{formatNumber(c.credits)}</td>
                <td style={cell}>{c.shownOnCard ? 'yes' : 'no (no tokens)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {check.otherFeatures.length > 0 && (
        <div style={{ fontSize: '12px', marginTop: '6px' }}>
          Feature values in <code>other</code>:{' '}
          {check.otherFeatures.map((f) => (
            <span key={f.feature} style={{ color: f.isBusinessOs ? '#721c24' : undefined, marginRight: '8px' }}>
              {f.feature} ({formatNumber(f.calls)}){f.isBusinessOs ? ' — Business OS value, should not be here' : ''}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

export function AreaTotalsPanel({ totals }: { totals: AreaTotals }) {
  const status: DisplayStatus = totals.status === 'error' ? 'fail' : totals.status === 'incomplete' ? 'incomplete' : 'info';
  return (
    <section style={panel} data-testid="llm-usage-panel-areas">
      <PanelHeader title="Area totals" status={status} testId="llm-usage-panel-status-areaTotals" />
      <ErrorLine error={totals.error} />
      {totals.status === 'incomplete' && <Warning>{INCOMPLETE_TEXT}</Warning>}
      {totals.lines.length > 0 && (
        <table style={table}>
          <thead>
            <tr>
              {['Area', 'Calls', 'Tokens', 'Estimated cost'].map((h) => (
                <th key={h} style={cell}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {totals.lines.map((l) => (
              <tr key={l.key}>
                <td style={cell}>{l.kind === 'unknown' ? 'unknown area' : l.key}</td>
                <td style={cell}>{formatNumber(l.calls)}</td>
                <td style={cell}>{formatNumber(l.tokens)}</td>
                <td style={cell}>{formatCostUsd(l.estimatedCostUsd)} (estimated)</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold' }}>
              <td style={cell}>Total</td>
              <td style={cell}>{formatNumber(totals.total.calls)}</td>
              <td style={cell}>{formatNumber(totals.total.tokens)}</td>
              <td style={cell}>{formatCostUsd(totals.total.estimatedCostUsd)} (estimated)</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

export function CheckPanels({ report }: { report: LlmUsageReport }) {
  return (
    <div>
      <CallsPanel check={report.checks.calls} />
      <PlatformAccountPanel check={report.checks.platformAccount} />
      <LegacyLabelsPanel check={report.checks.legacyLabels} />
      <GroupsPanel check={report.checks.groups} />
      <UsageCardPanel check={report.checks.usageCard} />
      <AreaTotalsPanel totals={report.areaTotals} />
    </div>
  );
}

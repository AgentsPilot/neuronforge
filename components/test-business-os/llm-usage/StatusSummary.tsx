'use client';

import type { LlmUsageReport } from '@/lib/business-os/usage/llmUsageReportTypes';
import { StatusBadge } from './StatusBadge';
import { formatLocalTime, localTimeZoneName, type DisplayStatus } from './formatters';

interface StatusSummaryProps {
  accountId: string | null;
  companyName: string | null;
  report: LlmUsageReport | null;
}

const CHECKS: Array<{ key: keyof LlmUsageReport['checks'] | 'areaTotals'; label: string }> = [
  { key: 'calls', label: 'Check 1 — Calls' },
  { key: 'platformAccount', label: 'Check 2 — Nothing on the platform account' },
  { key: 'legacyLabels', label: 'Check 3 — No legacy labels' },
  { key: 'groups', label: 'Check 4 — Grouped by action' },
  { key: 'usageCard', label: 'Check 5 — Usage card view' },
  { key: 'areaTotals', label: 'Area totals' },
];

function statusFor(report: LlmUsageReport | null, key: (typeof CHECKS)[number]['key']): DisplayStatus {
  if (!report) return 'not_checked';
  if (key === 'areaTotals') {
    const s = report.areaTotals.status;
    return s === 'error' ? 'fail' : s === 'incomplete' ? 'incomplete' : 'info';
  }
  return report.checks[key].status;
}

/** FR-11: business, window, platform ids checked, one status per check. */
export function StatusSummary({ accountId, companyName, report }: StatusSummaryProps) {
  const zone = localTimeZoneName();

  return (
    <div data-testid="llm-usage-summary" style={{ fontSize: '13px', display: 'grid', gap: '6px' }}>
      <div>
        <strong>Business:</strong> {companyName ?? (accountId ? '(name not loaded)' : '—')}{' '}
        <code>{accountId ?? 'none selected'}</code>
        {report?.account.profileLookup === 'failed' && (
          <span style={{ color: '#856404' }}> (the name could not be loaded; the checks are unaffected)</span>
        )}
      </div>
      {report && (
        <>
          <div>
            <strong>Window ({zone}):</strong> {formatLocalTime(report.window.start)} → {formatLocalTime(report.window.end)}{' '}
            (server end, fixed for this refresh)
            {report.window.startClamped && <span> — the start was a few seconds ahead and was set to now</span>}
          </div>
          <div>
            <strong>Check 5 window:</strong> {formatLocalTime(report.window.start)} → time of the read (open end: the
            card&apos;s own computation has no end bound)
          </div>
          <div>
            <strong>Platform account ids checked:</strong>{' '}
            {report.platformAccountIdsChecked.map((id) => (
              <code key={id} style={{ marginRight: '8px' }}>
                {id}
              </code>
            ))}
          </div>
          {report.platformAccountEnvIgnored && (
            <div role="alert" style={{ color: '#856404', background: '#fff3cd', padding: '6px 10px' }}>
              SYSTEM_ADMIN_USER_ID is set but is not a UUID; only the all-zero id was checked
            </div>
          )}
          {report.incomplete && (
            <div role="alert" style={{ color: '#856404', background: '#fff3cd', padding: '6px 10px' }}>
              Incomplete: more than 5,000 Business OS calls in this window; narrow the start time
            </div>
          )}
        </>
      )}
      <table style={{ borderCollapse: 'collapse', marginTop: '4px' }}>
        <tbody>
          {CHECKS.map(({ key, label }) => (
            <tr key={key}>
              <td style={{ padding: '2px 12px 2px 0' }}>{label}</td>
              <td>
                <StatusBadge status={statusFor(report, key)} testId={`llm-usage-status-${key}`} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

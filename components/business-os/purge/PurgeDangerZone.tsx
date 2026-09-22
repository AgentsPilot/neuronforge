'use client';

/**
 * T22 (dry-run slice) — the internal Danger Zone on /test-business-os.
 *
 * ⚠️ SLICE 2: THIS PAGE CAN DELETE DATA. The preview is still read-only, but a
 * Reset commit button now exists behind a typed confirmation. It deletes nothing
 * until `purge_business_data` is applied — until then the server refuses before
 * writing anything — but the banner says so plainly rather than leaving a stale
 * "nothing will be deleted" beside a delete button. A reassuring banner that has
 * quietly become false is worse than no banner at all.
 *
 * Two display rules, both deliberate:
 *   1. A count that could not be read renders as **unknown**, never as 0. Zero
 *      invites a decision; unknown withholds one.
 *   2. The limitations panel is rendered ABOVE the counts, not below them. What
 *      this build could not verify is more important than what it could.
 */

import React, { useCallback, useEffect, useState } from 'react';

interface TableCount {
  table: string;
  count: number | null;
  error?: string;
  truncated?: boolean;
}

interface PreviewResult {
  level: 'reset' | 'purge';
  options: Record<string, boolean>;
  correlationId: string;
  tables: TableCount[];
  totals: { rows: number; tablesWithRows: number; tablesUnknown: number };
  storage: TableCount[];
  gate: { outcome: string; refusalReason?: string };
  gateCoverage: { headline: string; unchecked: string[] };
  limitations: string[];
  canProceed: false;
  generatedAt: string;
  durationMs: number;
}

type CommitOutcome =
  | {
      status: 'completed';
      correlationId: string;
      snapshotPath: string;
      rows: { total: number; byTable: Record<string, number> };
      storage: Array<{ bucket: string; deleted: number; failed: Array<{ path: string; reason: string }> }>;
      residue: string[];
      committedAt: string;
      durationMs: number;
    }
  | {
      status: 'refused';
      correlationId: string;
      reason: string;
      message: string;
      snapshotWritten: boolean;
      rowsDeleted: 0;
    };

interface AccessState {
  allowed: boolean;
  reason: string;
  userId?: string;
  email?: string | null;
  /**
   * Whether Reset can ACTUALLY delete right now, from the server's own probe.
   * true = LIVE · false = function not applied · null/undefined = unknown.
   */
  resetLive?: boolean | null;
}

const box: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 12,
  marginBottom: 12,
  background: '#fff',
};

export interface PurgeDangerZoneProps {
  /**
   * Write to the page's shared debug console.
   *
   * Optional so the component stands alone, but the test page always passes it:
   * an empty console beside a populated results table reads as "nothing
   * happened", which is the opposite of what a preview should communicate.
   */
  onLog?: (type: 'info' | 'success' | 'error', message: string) => void;
  /** Publish the raw payload to the page's shared response viewer. */
  onResponse?: (payload: unknown) => void;
}

export function PurgeDangerZone({ onLog, onResponse }: PurgeDangerZoneProps = {}) {
  const [access, setAccess] = useState<AccessState | null>(null);
  const [level, setLevel] = useState<'reset' | 'purge'>('reset');
  const [options, setOptions] = useState({
    integrations: false,
    agents: false,
    activityHistory: false,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Reset commit (slice 2) ──────────────────────────────────────────────
  const [confirmText, setConfirmText] = useState('');
  const [committing, setCommitting] = useState(false);
  const [commitOutcome, setCommitOutcome] = useState<CommitOutcome | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/business-os/purge/access')
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const data = j?.data ?? { allowed: false, reason: 'error' };
        setAccess(data);
        onLog?.(
          data.allowed ? 'success' : 'info',
          data.allowed
            ? `Danger Zone access granted (admin) for ${data.email ?? data.userId}`
            : `Danger Zone access denied — ${data.reason}`,
        );
      })
      .catch((e) => {
        if (cancelled) return;
        setAccess({ allowed: false, reason: 'error' });
        onLog?.('error', `Access check failed: ${e instanceof Error ? e.message : String(e)}`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    const startedAt = Date.now();
    onLog?.(
      'info',
      `Dry-run preview: level=${level} options=${Object.entries(options)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(',') || 'none'} → POST /api/business-os/purge/preview`,
    );
    try {
      const res = await fetch('/api/business-os/purge/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, surface: 'internal', options }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error || `Request failed (${res.status})`);
        onLog?.('error', `Preview failed (${res.status}): ${json?.error ?? 'unknown'}`);
        onResponse?.(json);
        return;
      }

      const data = json.data as PreviewResult;
      setResult(data);
      onResponse?.(json);

      onLog?.(
        'success',
        `Preview OK in ${Date.now() - startedAt}ms · correlationId=${data.correlationId} · ` +
          `${data.totals.rows} rows across ${data.totals.tablesWithRows} table(s) · ` +
          `${data.tables.length} descriptors evaluated · gate=${data.gate.outcome}`,
      );

      // Per-table read failures, individually — a table that could not be read
      // is the single most important thing this console can surface, and a
      // summary count would bury it.
      for (const t of data.tables.filter((x) => x.count === null)) {
        onLog?.('error', `Could not count ${t.table}: ${t.error ?? 'unknown error'}`);
      }
      for (const t of data.tables.filter((x) => x.truncated)) {
        onLog?.('info', `${t.table}: count is a FLOOR, an internal cap was hit`);
      }
      for (const s2 of data.storage.filter((x) => x.count === null)) {
        onLog?.('error', `Could not count storage bucket ${s2.table}: ${s2.error ?? 'unknown'}`);
      }
      onLog?.('info', `Limitations reported: ${data.limitations.length}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onLog?.('error', `Preview threw: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [level, options, onLog, onResponse]);

  const runReset = async () => {
    setCommitting(true);
    setCommitError(null);
    setCommitOutcome(null);
    onLog?.('info', 'RESET requested — POST /api/business-os/purge/commit (typed confirmation supplied)');

    try {
      const res = await fetch('/api/business-os/purge/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: 'reset', confirmText }),
      });
      const json = await res.json();
      onResponse?.(json);

      if (!res.ok || !json.success) {
        const msg = json?.error || `Request failed (${res.status})`;
        setCommitError(msg);
        onLog?.('error', `Reset rejected (${res.status}): ${msg}`);
        return;
      }

      const outcome = json.data as CommitOutcome;
      setCommitOutcome(outcome);

      if (outcome.status === 'completed') {
        onLog?.(
          'success',
          `RESET COMPLETED · ${outcome.rows.total} rows deleted · snapshot ${outcome.snapshotPath} · correlationId=${outcome.correlationId}`,
        );
        for (const r of outcome.residue) onLog?.('error', `Storage residue: ${r}`);
        // The counts shown are now pre-reset and wrong. Clear them rather than
        // leave a table of numbers that describes data which no longer exists.
        setResult(null);
        setConfirmText('');
      } else {
        onLog?.(
          'info',
          `Reset refused (${outcome.reason}) · snapshotWritten=${outcome.snapshotWritten} · rowsDeleted=0 · ${outcome.message}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCommitError(msg);
      onLog?.('error', `Reset threw: ${msg}`);
    } finally {
      setCommitting(false);
    }
  };

  if (access === null) {
    return <p style={{ color: '#666' }}>Checking access…</p>;
  }

  if (!access.allowed) {
    return (
      <div style={{ ...box, borderColor: '#f5c6cb', background: '#fff5f5' }}>
        <strong>Not available.</strong>{' '}
        {access.reason === 'signed_out'
          ? 'Sign in on the Overview tab first.'
          : 'This surface is restricted to platform administrators (the `admin_users` table).'}
        <p style={{ fontSize: 12, color: '#666', marginTop: 8, marginBottom: 0 }}>
          This is a server-side check. Hiding the tab is cosmetic — the preview route
          performs the same check independently and will refuse regardless of what this
          page renders.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* ── The banner that must be unmistakable ───────────────────────── */}
      <div style={{ ...box, borderColor: '#dc3545', background: '#fff5f5', borderWidth: 2 }}>
        <h3 style={{ margin: '0 0 6px' }}>⚠️ This page can DELETE data</h3>
        <p style={{ margin: 0, fontSize: 14 }}>
          <strong>Preview</strong> is read-only and changes nothing. <strong>Reset</strong> (offered
          after a Reset preview) permanently deletes this business&apos;s CRM, scheduling, payment,
          website and insight data, behind a typed confirmation. A verified snapshot is written
          first. <strong>There is no undo.</strong>
        </p>
        {/*
          M-4: driven by the server's live probe, never by a hard-coded sentence.
          The earlier fixed text ("the server refuses Reset — expected") was true
          until the migration was applied and silently false afterwards, beside a
          button that by then deleted. This cannot drift from ResetService,
          because it asks the same question.
        */}
        {access.resetLive === true && (
          <p
            role="alert"
            style={{
              margin: '8px 0 0',
              padding: 8,
              fontSize: 14,
              fontWeight: 700,
              background: '#dc3545',
              color: 'white',
              borderRadius: 4,
            }}
          >
            ⚠️ Reset is LIVE — it will delete data.
          </p>
        )}
        {access.resetLive === false && (
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>
            Reset is currently <strong>refused — the destructive function is not applied</strong>.
            Pressing Reset will be rejected by the server before anything is written.
          </p>
        )}
        {(access.resetLive === null || access.resetLive === undefined) && (
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#b8860b' }}>
            <strong>Could not determine whether Reset is live.</strong> Treat it as live: the server
            re-checks before deleting and refuses if it cannot confirm.
          </p>
        )}
      </div>

      {/* ── Whose data, stated before anything else ────────────────────── */}
      <div style={{ ...box, borderColor: '#ffc107', background: '#fffbe6' }}>
        <strong>⚠️ This environment points at the live database.</strong>
        <p style={{ margin: '6px 0 0', fontSize: 14 }}>
          Counts below are <strong>real production rows</strong> for the signed-in account:
          <br />
          <code>{access.email ?? '(no email)'}</code> · <code>{access.userId}</code>
        </p>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: '#665' }}>
          The preview always targets your own session user. No account id is accepted from
          this page, so it cannot be aimed at anyone else.
        </p>
      </div>

      {/* ── Controls ───────────────────────────────────────────────────── */}
      <div style={box}>
        <div style={{ marginBottom: 10 }}>
          <label style={{ marginRight: 16 }}>
            <input
              type="radio"
              checked={level === 'reset'}
              onChange={() => setLevel('reset')}
            />{' '}
            <strong>Reset</strong> — wipe the business data, keep the business
          </label>
          <label>
            <input
              type="radio"
              checked={level === 'purge'}
              onChange={() => setLevel('purge')}
            />{' '}
            <strong>Purge</strong> — also remove the profile, config and connections
          </label>
        </div>

        <div style={{ marginBottom: 10, fontSize: 14 }}>
          {(
            [
              ['integrations', 'Also disconnect integrations (plugin_connections)'],
              ['agents', 'Also delete my agents (and their logs, memory, sessions)'],
              ['activityHistory', 'Also delete my activity history (audit_trail)'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) => setOptions((o) => ({ ...o, [key]: e.target.checked }))}
              />{' '}
              {label}
            </label>
          ))}
        </div>

        <button
          onClick={runPreview}
          disabled={loading}
          style={{
            padding: '8px 16px',
            borderRadius: 4,
            border: '1px solid #0d6efd',
            background: loading ? '#ccc' : '#0d6efd',
            color: 'white',
            fontWeight: 600,
            cursor: loading ? 'default' : 'pointer',
          }}
        >
          {loading ? 'Counting…' : 'Run dry-run preview'}
        </button>
      </div>

      {error && (
        <div style={{ ...box, borderColor: '#f5c6cb', background: '#fff5f5' }}>
          <strong>Preview failed:</strong> {error}
        </div>
      )}

      {result && (
        <>
          {/* Limitations FIRST — see the header comment. */}
          <div style={{ ...box, borderColor: '#dc3545', background: '#fff5f5' }}>
            <h4 style={{ margin: '0 0 8px' }}>What this preview could NOT verify</h4>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
              {result.limitations.map((l, i) => (
                <li key={i} style={{ marginBottom: 4 }}>
                  {l}
                </li>
              ))}
            </ul>
          </div>

          <div style={box}>
            <h4 style={{ margin: '0 0 8px' }}>Stripe pre-flight gate</h4>
            <p style={{ margin: '0 0 6px', fontSize: 14 }}>
              Outcome: <strong>{result.gate.outcome.toUpperCase()}</strong>
              {result.gate.refusalReason ? ` (${result.gate.refusalReason})` : ''}
            </p>
            <p style={{ margin: '0 0 6px', fontSize: 14 }}>{result.gateCoverage.headline}</p>
            {result.gateCoverage.unchecked.length > 0 && (
              <>
                <p style={{ margin: '6px 0 2px', fontSize: 13, fontWeight: 600 }}>
                  Conditions NOT checked:
                </p>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                  {result.gateCoverage.unchecked.map((u, i) => (
                    <li key={i}>{u}</li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div style={box}>
            <h4 style={{ margin: '0 0 8px' }}>
              {result.level === 'reset' ? 'Reset' : 'Purge'} would affect{' '}
              {result.totals.rows.toLocaleString()} rows across{' '}
              {result.totals.tablesWithRows} table(s)
            </h4>
            <p style={{ margin: '0 0 8px', fontSize: 13, color: '#666' }}>
              {result.tables.length} descriptors evaluated ·{' '}
              {result.totals.tablesUnknown} unknown · {result.durationMs}ms · correlation{' '}
              <code>{result.correlationId.slice(0, 8)}</code>
            </p>

            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                  <th style={{ padding: 4 }}>Table</th>
                  <th style={{ padding: 4, width: 110 }}>Rows</th>
                </tr>
              </thead>
              <tbody>
                {result.tables
                  .slice()
                  .sort((a, b) => (b.count ?? -1) - (a.count ?? -1))
                  .map((t) => (
                    <tr
                      key={t.table}
                      style={{
                        borderBottom: '1px solid #f2f2f2',
                        color: t.count === null ? '#b8860b' : (t.count ?? 0) > 0 ? '#111' : '#999',
                      }}
                    >
                      <td style={{ padding: 4 }}>
                        <code>{t.table}</code>
                        {t.error && (
                          <span style={{ color: '#b8860b', fontSize: 12 }}> — {t.error}</span>
                        )}
                      </td>
                      <td style={{ padding: 4 }}>
                        {t.count === null ? (
                          <strong style={{ color: '#b8860b' }}>unknown</strong>
                        ) : (
                          <>
                            {t.count.toLocaleString()}
                            {t.truncated ? '+' : ''}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div style={box}>
            <h4 style={{ margin: '0 0 8px' }}>Storage objects under your folder</h4>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
              {result.storage.map((s) => (
                <li key={s.table}>
                  <code>{s.table}</code>:{' '}
                  {s.count === null ? (
                    <strong style={{ color: '#b8860b' }}>unknown{s.error ? ` — ${s.error}` : ''}</strong>
                  ) : (
                    `${s.count}${s.truncated ? '+' : ''} object(s)`
                  )}
                </li>
              ))}
            </ul>
          </div>

          {result.level === 'reset' && (
            <div style={{ ...box, borderColor: '#dc3545', borderWidth: 2 }}>
              <h4 style={{ margin: '0 0 8px', color: '#b02a37' }}>Reset this business</h4>
              <p style={{ margin: '0 0 8px', fontSize: 14 }}>
                Permanently deletes the {result.totals.rows.toLocaleString()} rows counted above for{' '}
                <code>{access.email ?? access.userId}</code>. A verified snapshot is written first.{' '}
                <strong>There is no undo.</strong>
              </p>
              <label htmlFor="purge-confirm" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>
                Type the <strong>business name</strong> (or, if the business has none, the{' '}
                <strong>account email</strong>) to confirm:
              </label>
              <input
                id="purge-confirm"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                style={{ width: '100%', padding: 6, marginBottom: 8, fontFamily: 'monospace' }}
              />
              <button
                onClick={runReset}
                disabled={committing || confirmText.trim().length === 0}
                style={{
                  padding: '8px 16px',
                  borderRadius: 4,
                  border: '1px solid #dc3545',
                  background: committing || !confirmText.trim() ? '#ccc' : '#dc3545',
                  color: 'white',
                  fontWeight: 600,
                  cursor: committing || !confirmText.trim() ? 'default' : 'pointer',
                }}
              >
                {committing ? 'Resetting…' : 'Reset — delete permanently'}
              </button>
            </div>
          )}
        </>
      )}

      {commitError && (
        <div role="alert" style={{ ...box, borderColor: '#f5c6cb', background: '#fff5f5' }}>
          <strong>Reset rejected:</strong> {commitError}
        </div>
      )}

      {commitOutcome && commitOutcome.status === 'refused' && (
        <div role="alert" style={{ ...box, borderColor: '#ffc107', background: '#fffbe6' }}>
          <strong>Reset refused — {commitOutcome.reason}</strong>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>{commitOutcome.message}</p>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>
            Rows deleted: <strong>0</strong> · Snapshot written:{' '}
            <strong>{commitOutcome.snapshotWritten ? 'yes' : 'no'}</strong> · correlation{' '}
            <code>{commitOutcome.correlationId.slice(0, 8)}</code>
          </p>
        </div>
      )}

      {commitOutcome && commitOutcome.status === 'completed' && (
        <div role="status" style={{ ...box, borderColor: '#198754', background: '#f0fff4' }}>
          <strong>Reset completed.</strong>
          <p style={{ margin: '6px 0 0', fontSize: 14 }}>
            {commitOutcome.rows.total.toLocaleString()} rows deleted in {commitOutcome.durationMs}ms.
            Snapshot: <code>{commitOutcome.snapshotPath}</code>
          </p>
          {commitOutcome.residue.length > 0 && (
            <>
              <p style={{ margin: '6px 0 2px', fontSize: 13, fontWeight: 600, color: '#b02a37' }}>
                The rows are gone, but some files could not be removed:
              </p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                {commitOutcome.residue.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default PurgeDangerZone;

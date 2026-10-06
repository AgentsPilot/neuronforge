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
 * Purge slice 3b: the commit is offered for BOTH levels (Reset and Purge),
 * after a preview of that level, with the two opt-in extras that preview used.
 * There is deliberately NO "delete my agents" checkbox: the user decided
 * (OQ-1 = (c), 2026-10-05) that a purge never deletes agents, and the server
 * refuses the option with its own code regardless of what this page sends.
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
  /** Purge slice 3a. Optional on the wire type so an older payload renders as NOT verified, never clean (C-5). */
  deleteGraph?: DeleteGraphView;
  canProceed: false;
  generatedAt: string;
  durationMs: number;
}

/** Mirror of `DeleteGraphResult` (lib/business-os/purge/deleteGraph.ts); this client file does not import server code. */
interface DeleteGraphEdgeView {
  constraint: string;
  child: string;
  parent: string;
}

interface DeleteGraphView {
  status: 'ok' | 'refused' | 'unreadable';
  blockingOrderViolations: DeleteGraphEdgeView[];
  unlistedCascadeChildren: DeleteGraphEdgeView[];
  unreviewedDeleteTriggers: Array<{ table: string; trigger: string }>;
  cascadeAfterParent: Array<DeleteGraphEdgeView & { exempt: boolean }>;
  error?: string;
}

/** Purge slice 3a (T3a-5): the delete-graph verdict, plain text. Anything but `ok` is shown as blocking. */
function DeleteGraphPanel({ graph, boxStyle }: { graph: DeleteGraphView | undefined; boxStyle: React.CSSProperties }) {
  const status = graph?.status ?? 'unreadable';
  const isClean = status === 'ok';
  const edges = (list: DeleteGraphEdgeView[]) =>
    list.map((e) => `${e.parent} -> ${e.child} (${e.constraint})`);

  const sections: Array<{ title: string; items: string[] }> = graph
    ? [
        { title: 'Child deleted after a parent it blocks (RESTRICT / NO ACTION)', items: edges(graph.blockingOrderViolations) },
        { title: 'Tables a cascade would empty that this run does not list', items: edges(graph.unlistedCascadeChildren) },
        {
          title: 'DELETE triggers nobody has reviewed',
          items: graph.unreviewedDeleteTriggers.map((t) => `${t.table}.${t.trigger}`),
        },
      ]
    : [];

  return (
    <div
      style={{
        ...boxStyle,
        borderColor: isClean ? '#28a745' : '#dc3545',
        background: isClean ? '#f6fff8' : '#fff5f5',
      }}
    >
      <h4 style={{ margin: '0 0 8px' }}>Delete graph (live foreign keys and triggers)</h4>
      <p style={{ margin: '0 0 6px', fontSize: 14 }}>
        Verdict:{' '}
        <strong>
          {status === 'ok' ? 'CLEAN' : status === 'refused' ? 'REFUSED' : 'NOT VERIFIED (treated as refused)'}
        </strong>
        {graph?.error ? ` (${graph.error})` : ''}
      </p>
      {sections
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <div key={s.title}>
            <p style={{ margin: '6px 0 2px', fontSize: 13, fontWeight: 600 }}>{s.title}:</p>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
              {s.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      {graph && graph.cascadeAfterParent.length > 0 && (
        <p style={{ margin: '6px 0 0', fontSize: 12, color: '#555' }}>
          Counted after their cascade parent (statement count may read low; the snapshot count is the truth):{' '}
          {graph.cascadeAfterParent.map((e) => `${e.child}${e.exempt ? ' (accepted)' : ''}`).join(', ')}
        </p>
      )}
    </div>
  );
}

type CommitOutcome =
  | {
      status: 'completed';
      correlationId: string;
      /** Slice 3b. Optional so a slice-2 payload still renders. */
      level?: 'reset' | 'purge';
      snapshotPath: string;
      rows: { total: number; byTable: Record<string, number> };
      storage: Array<{ bucket: string; deleted: number; failed: Array<{ path: string; reason: string }> }>;
      residue: string[];
      /** Slice 3b: internal-surface result notes (FR-24, FR-25, AC-32, AC-42). */
      notes?: string[];
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
  // No `agents` key: the option is not offered (OQ-1 = (c)). The routes default
  // it to false.
  const [options, setOptions] = useState({
    integrations: false,
    activityHistory: false,
  });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Commit (Reset since slice 2, Purge since slice 3b) ──────────────────
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
      const graphStatus = data.deleteGraph?.status ?? 'unreadable';
      onLog?.(graphStatus === 'ok' ? 'info' : 'error', `Delete graph: ${graphStatus}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      onLog?.('error', `Preview threw: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [level, options, onLog, onResponse]);

  const runCommit = async () => {
    if (!result) return;
    // Commit exactly what was previewed: the preview's level and its two extras.
    const commitLevel = result.level;
    const commitOptions = {
      integrations: result.options.integrations === true,
      activityHistory: result.options.activityHistory === true,
    };
    const label = commitLevel === 'purge' ? 'PURGE' : 'RESET';
    setCommitting(true);
    setCommitError(null);
    setCommitOutcome(null);
    onLog?.(
      'info',
      `${label} requested — POST /api/business-os/purge/commit (typed confirmation supplied; options=${
        Object.entries(commitOptions)
          .filter(([, v]) => v)
          .map(([k]) => k)
          .join(',') || 'none'
      })`,
    );

    try {
      const res = await fetch('/api/business-os/purge/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level: commitLevel, confirmText, options: commitOptions }),
      });
      const json = await res.json();
      onResponse?.(json);

      if (!res.ok || !json.success) {
        const msg = json?.error || `Request failed (${res.status})`;
        setCommitError(msg);
        onLog?.('error', `${label} rejected (${res.status}): ${msg}`);
        return;
      }

      const outcome = json.data as CommitOutcome;
      setCommitOutcome(outcome);

      if (outcome.status === 'completed') {
        onLog?.(
          'success',
          `${label} COMPLETED · ${outcome.rows.total} rows deleted · snapshot ${outcome.snapshotPath} · correlationId=${outcome.correlationId}`,
        );
        for (const r of outcome.residue) onLog?.('error', `Storage residue: ${r}`);
        for (const n of outcome.notes ?? []) onLog?.('info', `Note: ${n}`);
        // The counts shown are now pre-reset and wrong. Clear them rather than
        // leave a table of numbers that describes data which no longer exists.
        setResult(null);
        setConfirmText('');
      } else {
        onLog?.(
          'info',
          `${label} refused (${outcome.reason}) · snapshotWritten=${outcome.snapshotWritten} · rowsDeleted=0 · ${outcome.message}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCommitError(msg);
      onLog?.('error', `${label} threw: ${msg}`);
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
          <strong>Preview</strong> is read-only and changes nothing. Once the server-side delete
          function is applied (its status is shown below), <strong>Reset</strong> (offered
          after a Reset preview) permanently deletes this business&apos;s CRM, scheduling, payment,
          website and insight data. <strong>Purge</strong> (offered after a Purge preview) also
          deletes the business profile, its configuration and its channel connections. Both sit
          behind a typed confirmation, and a verified snapshot is written first.{' '}
          <strong>There is no undo.</strong>
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
            ⚠️ Reset and Purge are LIVE — they will delete data.
          </p>
        )}
        {access.resetLive === false && (
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>
            Reset and Purge are currently <strong>refused — the destructive function is not
            applied</strong>. Pressing either will be rejected by the server before anything is
            written.
          </p>
        )}
        {(access.resetLive === null || access.resetLive === undefined) && (
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#b8860b' }}>
            <strong>Could not determine whether Reset and Purge are live.</strong> Treat them as live: the server
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
              ['activityHistory', 'Also delete my activity history (audit_trail and its archived copies)'],
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
          {/* AC-32 */}
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#555' }}>
            Purge always removes channel connections, whether or not integrations are disconnected.
            There is no option to delete agents: a purge never deletes them.
          </p>
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

          <DeleteGraphPanel graph={result.deleteGraph} boxStyle={box} />

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

          <div style={{ ...box, borderColor: '#dc3545', borderWidth: 2 }}>
            <h4 style={{ margin: '0 0 8px', color: '#b02a37' }}>
              {result.level === 'purge' ? 'Purge this business' : 'Reset this business'}
            </h4>
            {/*
              SA G-1: this box renders after every preview, so its copy follows the
              same probe as the banner. Only a LIVE function "deletes"; otherwise the
              server refuses before any snapshot, and the box says so. The button
              stays enabled on purpose: the audited refusal path is worth exercising.
            */}
            {access.resetLive === false && (
              <p data-testid="commit-not-live" style={{ margin: '0 0 8px', fontSize: 13, color: '#b02a37', fontWeight: 600 }}>
                The destructive function is not applied, so the server will refuse this run before anything
                is snapshotted or deleted.
              </p>
            )}
            {access.resetLive !== true && access.resetLive !== false && (
              <p data-testid="commit-state-unknown" style={{ margin: '0 0 8px', fontSize: 13, color: '#b8860b', fontWeight: 600 }}>
                Whether the destructive function is applied is unknown. The server re-checks first and refuses
                if it cannot confirm; treat this button as live.
              </p>
            )}
            <p style={{ margin: '0 0 8px', fontSize: 14 }}>
              {access.resetLive === true ? 'Permanently deletes' : 'Would permanently delete'} the{' '}
              {result.totals.rows.toLocaleString()} rows counted above for{' '}
              <code>{access.email ?? access.userId}</code>. A verified snapshot is written first.{' '}
              <strong>There is no undo.</strong>
            </p>
            {result.level === 'purge' && (
              <ul style={{ margin: '0 0 8px', paddingLeft: 20, fontSize: 13 }}>
                {/* FR-25 / AC-42 / AC-32 — stated BEFORE the confirmation, not only after. */}
                <li>The business profile is deleted, so its subdomain is released and anyone can claim it.</li>
                <li>
                  Setting the business up again creates a new public code: old /c/ booking and contact links
                  stop working for good.
                </li>
                <li>Channel connections are removed.</li>
                {result.options.integrations && <li>Integrations are disconnected.</li>}
                {result.options.activityHistory && (
                  <li>Activity history is deleted; the record of this purge is written afterwards and kept.</li>
                )}
              </ul>
            )}
            {(result.deleteGraph?.status ?? 'unreadable') !== 'ok' && (
              <p style={{ margin: '0 0 8px', fontSize: 13, color: '#b02a37', fontWeight: 600 }}>
                The delete graph above is not CLEAN, so the server will refuse this run.
              </p>
            )}
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
              onClick={runCommit}
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
              {committing
                ? result.level === 'purge'
                  ? 'Purging…'
                  : 'Resetting…'
                : result.level === 'purge'
                  ? 'Purge — delete permanently'
                  : 'Reset — delete permanently'}
            </button>
          </div>
        </>
      )}

      {commitError && (
        <div role="alert" style={{ ...box, borderColor: '#f5c6cb', background: '#fff5f5' }}>
          <strong>Commit rejected:</strong> {commitError}
        </div>
      )}

      {commitOutcome && commitOutcome.status === 'refused' && (
        <div role="alert" style={{ ...box, borderColor: '#ffc107', background: '#fffbe6' }}>
          <strong>Commit refused — {commitOutcome.reason}</strong>
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
          <strong>{commitOutcome.level === 'purge' ? 'Purge' : 'Reset'} completed.</strong>
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
          {(commitOutcome.notes ?? []).length > 0 && (
            <>
              <p style={{ margin: '8px 0 2px', fontSize: 13, fontWeight: 600 }}>What this means:</p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13 }}>
                {(commitOutcome.notes ?? []).map((n, i) => (
                  <li key={i}>{n}</li>
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

'use client';

/**
 * "Remove a test account", the admin-only section of the Danger Zone on
 * /test-business-os (test-account cleanup, slice 2).
 *
 * ⚠️ DESTRUCTIVE once the deployment is configured: it removes one TEST
 * account completely, login included. Every guard (G-1 to G-19) runs on the
 * server inside the generated database function; this panel adds none and
 * decides nothing. It only orders the steps: check, then confirm, then delete.
 *
 * Rules kept here on purpose:
 *   - Mounted by PurgeDangerZone only after its server access check said
 *     admin, and it renders nothing if its own probe answers 401 / 403.
 *   - The delete is offered only after a check that is OK, or BLOCKED by G-12
 *     alone (files in storage, which the delete removes first). Editing the
 *     email or the tag throws the check away (FR-6).
 *   - Refusals and errors read as one plain sentence chosen from the error
 *     CODE. The server's `message` and `details` are never rendered.
 *   - The Copy buttons build their text from the server view alone, so the
 *     typed email and confirmation can never end up on the clipboard.
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md
 * Runbook: docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md §6
 */

import React, { useEffect, useRef, useState } from 'react';
import type {
  CleanupBlockerView,
  CleanupCheckRowView,
  CleanupCheckView,
  CleanupDeleteErrorCode,
  CleanupDeleteView,
  CleanupErrorBody,
} from '@/lib/business-os/test-account-cleanup/cleanupApiTypes';

const CHECK_URL = '/api/admin/test-account-cleanup/check';
const DELETE_URL = '/api/admin/test-account-cleanup/delete';
export const DEFAULT_TEST_TAG = '+test';

const box: React.CSSProperties = {
  border: '1px solid #ddd',
  borderRadius: 6,
  padding: 12,
  marginBottom: 12,
  background: '#fff',
};
const cell: React.CSSProperties = { padding: '2px 8px', borderBottom: '1px solid #eee', textAlign: 'left' };
const inputStyle: React.CSSProperties = { padding: 6, border: '1px solid #ccc', borderRadius: 4, width: 320 };

/** Same look as the Danger Zone's "Run dry-run preview" button; grey when it cannot be pressed. */
function actionButtonStyle(colour: string, isDisabled: boolean): React.CSSProperties {
  return {
    padding: '8px 16px',
    borderRadius: 4,
    border: `1px solid ${isDisabled ? '#ccc' : colour}`,
    background: isDisabled ? '#ccc' : colour,
    color: 'white',
    fontWeight: 600,
    cursor: isDisabled ? 'default' : 'pointer',
  };
}

/** Same rule as the server's G-3 comparison: trimmed, case-insensitive. */
export const normaliseEmail = (value: string): string => value.trim().toLowerCase();

/** The guard that only means "files in storage": the delete removes them first (SA-6). */
const STORAGE_GUARD = 'G-12';

/** OK, or BLOCKED by G-12 alone. A BLOCKED verdict with no listed blocker offers nothing. */
export function canOfferDelete(check: CleanupCheckView): boolean {
  if (!check.functionUpToDate || check.targetUserId === null) return false;
  if (check.verdict === 'OK') return true;
  return check.blockers.length > 0 && check.blockers.every((blocker) => blocker.guard === STORAGE_GUARD);
}

/** The check-result sections the panel lays out itself; anything else goes to "Other rows". */
const KNOWN_SECTIONS = new Set(['VERDICT', 'guard', 'remove', 'storage', 'trigger', 'kept']);

/** One plain sentence per refusal, chosen from the code alone. */
export function checkErrorSentence(status: number, body: CleanupErrorBody | null): string {
  const code = body?.error;
  if (code === 'not_configured') return 'Not set up on this deployment. Nothing was changed.';
  if (code === 'not_authorised' || code === 'function_missing') {
    return 'The cleanup is not available on this deployment. Nothing was changed.';
  }
  if (code === 'invalid_body') return 'Enter a valid email and a tag.';
  if (status === 401 || status === 403) return 'Only platform administrators can run this.';
  return 'The check could not run. Nothing was changed.';
}

type SentenceFacts = { filesGone: boolean; guards: string };

/** Exhaustive by type: a new server code fails `typecheck:bos-llm` until it has a sentence. */
const DELETE_SENTENCES: Record<CleanupDeleteErrorCode, (facts: SentenceFacts) => string> = {
  invalid_body: () => 'Enter a valid email and a tag.',
  not_configured: () => 'Not set up on this deployment. Nothing was removed.',
  not_authorised: ({ filesGone }) =>
    filesGone
      ? 'The cleanup is not available on this deployment. Files removed, account kept.'
      : 'The cleanup is not available on this deployment. Nothing was removed.',
  function_missing: (facts) => DELETE_SENTENCES.not_authorised(facts),
  function_out_of_date: ({ filesGone }) =>
    filesGone
      ? 'The database function is out of date. Files removed, account kept.'
      : 'The database function is out of date. Apply the current migration. Nothing was removed.',
  confirmation_mismatch: () => 'The confirmation does not equal the email. Nothing was removed.',
  blocked: ({ filesGone, guards }) =>
    filesGone
      ? `Files removed, account kept: blocked by ${guards || 'a guard'}.`
      : `BLOCKED by ${guards || 'a guard'}, nothing was removed.`,
  storage_failed: () => 'The storage step failed, so some files may be gone. The account was kept. Run the check again.',
  delete_failed: ({ filesGone }) =>
    filesGone
      ? 'Files removed, account kept: the delete did not run to the end.'
      : 'The removal did not run. Nothing was removed.',
  check_failed: (facts) => DELETE_SENTENCES.delete_failed(facts),
  'Internal server error': () => 'The removal stopped unexpectedly. Run the check again before retrying.',
};

export function deleteErrorSentence(status: number, body: CleanupErrorBody | null): string {
  const code = body?.error;
  const facts = { filesGone: (body?.filesRemoved ?? 0) > 0, guards: (body?.guards ?? []).join(', ') };
  if (code && Object.prototype.hasOwnProperty.call(DELETE_SENTENCES, code)) {
    return DELETE_SENTENCES[code as CleanupDeleteErrorCode](facts);
  }
  if (status === 401 || status === 403) return 'Only platform administrators can run this.';
  return DELETE_SENTENCES['Internal server error'](facts);
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * The count shown for a "Rows to remove" row. 'absent' is the server saying the
 * table does not exist on this database; 'unknown' stays for a count that failed.
 */
export function removeCountLabel(row: CleanupCheckRowView): string {
  if (row.status === 'absent') return 'not present';
  return row.found === null ? 'unknown' : String(row.found);
}

/** One blocker as one line, the same words BlockerList renders. */
function blockerLine(blocker: CleanupBlockerView): string {
  const found = blocker.found !== null ? ` (${blocker.found})` : '';
  const tail =
    blocker.guard === STORAGE_GUARD
      ? ' — the delete removes these files first.'
      : blocker.clears
        ? ` — to clear: ${blocker.clears}`
        : '';
  return `${blocker.guard} ${blocker.item}${found}${tail}`;
}

/**
 * The check result block as plain text, built from the same view the panel
 * renders. It takes only the server view, so the typed emails cannot reach it.
 */
export function formatCheckResultText(view: CleanupCheckView): string {
  const lines: string[] = [`${view.verdict} · login ${view.targetUserId ?? 'not found'}`];
  if (view.serverMs !== null) lines.push(`Server time: ${view.serverMs} ms`);
  if (!view.functionUpToDate) {
    lines.push('The database function is out of date, so the delete will refuse. Apply the current migration.');
  }
  lines.push(...view.blockers.map(blockerLine));
  const section = (name: string) => view.rows.filter((row) => row.section === name);
  const withExtras = (row: CleanupCheckRowView) =>
    `${row.item}${row.found !== null ? ` (${row.found})` : ''}${row.detail ? ` — ${row.detail}` : ''}`;

  if (section('remove').length > 0) {
    lines.push('Rows to remove', ...section('remove').map((row) => `${row.item}\t${removeCountLabel(row)}`));
  }
  if (view.storageObjects.length > 0) {
    lines.push(
      `Files that will be removed (${view.storageObjects.length})`,
      ...view.storageObjects.map((object) => `${object.bucket}/${object.path}`)
    );
  }
  if (section('trigger').length > 0) {
    lines.push(
      'Triggers that fire on the login',
      ...section('trigger').map((row) => `${row.item}${row.detail ? ` — ${row.detail}` : ''}`)
    );
  }
  if (section('kept').length > 0) lines.push('Kept', ...section('kept').map(withExtras));
  const other = view.rows.filter((row) => !KNOWN_SECTIONS.has(row.section));
  if (other.length > 0) {
    lines.push('Other rows', ...other.map((row) => `${row.section} · ${row.status} · ${withExtras(row)}`));
  }
  return lines.join('\n');
}

/** The delete report block as plain text, from the same view the panel renders. */
export function formatDeleteReportText(removed: CleanupDeleteView): string {
  const { tables, total } = removed.report;
  const lines: string[] = [
    'Test account removed.',
    'Table\tRows',
    ...tables.map((row) => `${row.table}\t${row.rowsRemoved}`),
    `TOTAL · ${total.result}\t${total.rowsRemoved} rows in ${total.tablesRemoved} tables`,
    `Files removed: ${removed.filesRemoved} · login ${total.removedLogin ?? removed.targetUserId ?? 'unknown'}${
      total.removedAt ? ` · at ${total.removedAt}` : ''
    }`,
  ];
  if (removed.serverMs.check !== null || removed.serverMs.delete !== null) {
    lines.push(`Server time: check ${removed.serverMs.check ?? '?'} ms · delete ${removed.serverMs.delete ?? '?'} ms`);
  }
  return lines.join('\n');
}

type CopyState = 'idle' | 'copied' | 'failed';

/** Small grey Copy button for one output block; the label says what it copies. */
function CopyButton({ label, text, testId }: { label: string; text: () => string; testId: string }) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      // Absent outside a secure context (plain http) and in some browsers.
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text());
      setState('copied');
      timer.current = setTimeout(() => setState('idle'), 2000);
    } catch {
      setState('failed');
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {state === 'failed' && (
        <span data-testid={`${testId}-failed`} role="status" style={{ fontSize: 12, color: '#b02a37' }}>
          Could not copy — select the text instead
        </span>
      )}
      <button
        type="button"
        aria-label={label}
        data-testid={testId}
        onClick={copy}
        style={{ ...actionButtonStyle('#6c757d', false), padding: '2px 10px', fontSize: 12 }}
      >
        {state === 'copied' ? 'Copied' : 'Copy'}
      </button>
    </span>
  );
}

const blockHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 8,
};

function BlockerList({ blockers }: { blockers: CleanupBlockerView[] }) {
  if (blockers.length === 0) return null;
  return (
    <ul data-testid="cleanup-blockers" style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 13 }}>
      {blockers.map((blocker, i) => (
        <li key={`${blocker.guard}-${i}`}>
          <strong>{blocker.guard}</strong> {blocker.item}
          {blocker.found !== null && <> ({blocker.found})</>}
          {blocker.guard === STORAGE_GUARD ? (
            <> — the delete removes these files first.</>
          ) : (
            blocker.clears && <> — to clear: {blocker.clears}</>
          )}
        </li>
      ))}
    </ul>
  );
}

export interface TestAccountCleanupPanelProps {
  /** The page's shared debug console. Codes and counts only, never an email. */
  onLog?: (type: 'info' | 'success' | 'error', message: string) => void;
}

type Probe = 'loading' | 'configured' | 'not_configured' | 'hidden' | 'unknown';

export function TestAccountCleanupPanel({ onLog }: TestAccountCleanupPanelProps = {}) {
  const [probe, setProbe] = useState<Probe>('loading');
  const [email, setEmail] = useState('');
  const [tag, setTag] = useState(DEFAULT_TEST_TAG);

  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ email: string; tag: string; view: CleanupCheckView } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ sentence: string; blockers: CleanupBlockerView[] } | null>(null);
  const [removed, setRemoved] = useState<CleanupDeleteView | null>(null);

  // A ref, not only state: a second click in the same tick must not post twice.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch(CHECK_URL)
      .then(async (res) => {
        const json = (await readJson(res)) as { data?: { configured?: unknown } } | null;
        if (cancelled) return;
        if (res.status === 401 || res.status === 403) return setProbe('hidden');
        if (!res.ok || typeof json?.data?.configured !== 'boolean') return setProbe('unknown');
        setProbe(json.data.configured ? 'configured' : 'not_configured');
      })
      .catch(() => {
        if (!cancelled) setProbe('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const resetFlow = () => {
    setCheck(null);
    setCheckError(null);
    setConfirmEmail('');
    setDeleteError(null);
  };

  const runCheck = async () => {
    if (inFlight.current) return;
    const target = { email: email.trim(), tag: tag.trim() };
    if (!target.email || !target.tag) return;
    inFlight.current = true;
    setChecking(true);
    resetFlow();
    setRemoved(null);
    try {
      const res = await fetch(CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(target),
      });
      const json = (await readJson(res)) as { success?: boolean; data?: CleanupCheckView } | CleanupErrorBody | null;
      if (!res.ok || !json || json.success !== true || !('data' in json) || !json.data) {
        setCheckError(checkErrorSentence(res.status, json as CleanupErrorBody | null));
        onLog?.('error', `Test-account check refused (${res.status} ${(json as CleanupErrorBody | null)?.error ?? 'unknown'})`);
        return;
      }
      setCheck({ ...target, view: json.data });
      onLog?.(
        'info',
        `Test-account check: ${json.data.verdict} · ${json.data.blockers.length} blocker(s) · ${json.data.storageObjects.length} file(s)`
      );
    } catch {
      setCheckError('Could not reach the server. Nothing was changed.');
      onLog?.('error', 'Test-account check: network error');
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  };

  const runDelete = async () => {
    if (inFlight.current || !check || normaliseEmail(confirmEmail) !== normaliseEmail(check.email)) return;
    inFlight.current = true;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(DELETE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: check.email, tag: check.tag, confirmEmail }),
      });
      const json = (await readJson(res)) as { success?: boolean; data?: CleanupDeleteView } | CleanupErrorBody | null;
      if (!res.ok || !json || json.success !== true || !('data' in json) || !json.data) {
        const body = json as CleanupErrorBody | null;
        setDeleteError({ sentence: deleteErrorSentence(res.status, body), blockers: body?.blockers ?? [] });
        onLog?.('error', `Test-account removal refused (${res.status} ${body?.error ?? 'unknown'})`);
        return;
      }
      setRemoved(json.data);
      onLog?.('success', `Test account removed · ${json.data.report.total.rowsRemoved} rows · ${json.data.filesRemoved} file(s)`);
      // The check now describes an account that no longer exists.
      resetFlow();
      setEmail('');
    } catch {
      setDeleteError({
        sentence: 'The request did not complete. Run the check again to see what is left.',
        blockers: [],
      });
      onLog?.('error', 'Test-account removal: network error');
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  };

  if (probe === 'hidden') return null;

  const disabled = probe !== 'configured';
  const checkDisabled = disabled || checking || deleting || !email.trim() || !tag.trim();
  const view = check?.view ?? null;
  const offerDelete = view !== null && canOfferDelete(view);
  const confirmMatches = check !== null && normaliseEmail(confirmEmail) === normaliseEmail(check.email);
  const rowsOf = (section: string) => (view ? view.rows.filter((row) => row.section === section) : []);
  // Never drop a row silently: a section this build does not lay out is still listed.
  const otherRows = view ? view.rows.filter((row) => !KNOWN_SECTIONS.has(row.section)) : [];

  return (
    <section
      aria-labelledby="test-account-cleanup-title"
      data-testid="test-account-cleanup-panel"
      style={{ ...box, borderColor: '#dc3545', borderWidth: 2, marginTop: 24 }}
    >
      <h3 id="test-account-cleanup-title" style={{ margin: '0 0 6px' }}>
        Remove a test account
      </h3>
      <p style={{ margin: '0 0 8px', fontSize: 14 }}>
        Removes one <strong>test</strong> account completely, login included, so the email can sign up again. The
        email must contain the tag. Run the check first. <strong>There is no undo.</strong>
      </p>

      {probe === 'loading' && <p style={{ color: '#666', fontSize: 13 }}>Checking whether this is set up…</p>}
      {probe === 'not_configured' && (
        <p data-testid="cleanup-not-configured" style={{ margin: '0 0 8px', fontSize: 13 }}>
          <strong>Not set up on this deployment.</strong> See the test-account cleanup runbook, section 6
          (docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md).
        </p>
      )}
      {probe === 'unknown' && (
        <p style={{ margin: '0 0 8px', fontSize: 13, color: '#b8860b' }}>
          <strong>Could not tell whether this is set up.</strong> Reload the page to try again.
        </p>
      )}

      <div style={{ display: 'grid', gap: 8, marginBottom: 8 }}>
        <label style={{ fontSize: 13 }}>
          Email of the test account
          <br />
          <input
            type="email"
            value={email}
            disabled={disabled || deleting}
            onChange={(e) => {
              setEmail(e.target.value);
              resetFlow();
            }}
            style={inputStyle}
            autoComplete="off"
          />
        </label>
        <label style={{ fontSize: 13 }}>
          Test tag (the email must contain it)
          <br />
          <input
            type="text"
            value={tag}
            disabled={disabled || deleting}
            onChange={(e) => {
              setTag(e.target.value);
              resetFlow();
            }}
            style={inputStyle}
            autoComplete="off"
            aria-describedby={!tag.trim() ? 'cleanup-empty-tag-hint' : undefined}
          />
        </label>
        {/* Check is disabled on an empty tag on purpose (it would match every
            account); say so, or the button just looks broken. */}
        {!tag.trim() && !disabled && (
          <p
            id="cleanup-empty-tag-hint"
            data-testid="cleanup-empty-tag-hint"
            style={{ margin: 0, fontSize: 13, color: '#b02a37' }}
          >
            Enter a test tag. An empty tag would match every account, so Check stays off.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={runCheck}
        disabled={checkDisabled}
        style={actionButtonStyle('#0d6efd', checkDisabled)}
      >
        {checking ? 'Checking…' : 'Check'}
      </button>

      {checkError && (
        <p role="alert" data-testid="cleanup-check-error" style={{ margin: '8px 0 0', fontSize: 14, color: '#b02a37' }}>
          {checkError}
        </p>
      )}

      {view && (
        <div data-testid="cleanup-check-result" style={{ ...box, marginTop: 12 }}>
          <div style={blockHeader}>
            <p style={{ margin: 0, fontSize: 15 }}>
              <strong data-testid="cleanup-verdict" style={{ color: view.verdict === 'OK' ? '#198754' : '#b02a37' }}>
                {view.verdict}
              </strong>{' '}
              · login <code>{view.targetUserId ?? 'not found'}</code>
            </p>
            <CopyButton label="Copy check result" testId="cleanup-copy-check" text={() => formatCheckResultText(view)} />
          </div>
          {view.serverMs !== null && (
            <p data-testid="cleanup-check-server-time" style={{ margin: '4px 0 0', fontSize: 12, color: '#6c757d' }}>
              Server time: {view.serverMs} ms
            </p>
          )}
          {!view.functionUpToDate && (
            <p role="alert" style={{ margin: '6px 0 0', fontSize: 13, color: '#b02a37' }}>
              The database function is out of date, so the delete will refuse. Apply the current migration.
            </p>
          )}
          <BlockerList blockers={view.blockers} />

          {rowsOf('remove').length > 0 && (
            <>
              <p style={{ margin: '10px 0 2px', fontSize: 13, fontWeight: 600 }}>Rows to remove</p>
              <table data-testid="cleanup-remove-rows" style={{ fontSize: 12, borderCollapse: 'collapse' }}>
                <tbody>
                  {rowsOf('remove').map((row, i) => (
                    <tr key={i}>
                      <td style={cell}>{row.item}</td>
                      <td style={cell}>{removeCountLabel(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view.storageObjects.length > 0 && (
            <>
              <p style={{ margin: '10px 0 2px', fontSize: 13, fontWeight: 600 }}>
                Files that will be removed ({view.storageObjects.length})
              </p>
              <ul data-testid="cleanup-storage" style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                {view.storageObjects.map((object, i) => (
                  <li key={i}>
                    <code>
                      {object.bucket}/{object.path}
                    </code>
                  </li>
                ))}
              </ul>
            </>
          )}

          {rowsOf('trigger').length > 0 && (
            <>
              <p style={{ margin: '10px 0 2px', fontSize: 13, fontWeight: 600 }}>Triggers that fire on the login</p>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                {rowsOf('trigger').map((row, i) => (
                  <li key={i}>
                    <code>{row.item}</code>
                    {row.detail && <> — {row.detail}</>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {rowsOf('kept').length > 0 && (
            <>
              <p style={{ margin: '10px 0 2px', fontSize: 13, fontWeight: 600 }}>Kept</p>
              <ul data-testid="cleanup-kept" style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                {rowsOf('kept').map((row, i) => (
                  <li key={i}>
                    {row.item}
                    {row.found !== null && <> ({row.found})</>}
                    {row.detail && <> — {row.detail}</>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {otherRows.length > 0 && (
            <>
              <p style={{ margin: '10px 0 2px', fontSize: 13, fontWeight: 600 }}>Other rows</p>
              <ul data-testid="cleanup-other-rows" style={{ margin: 0, paddingLeft: 20, fontSize: 12 }}>
                {otherRows.map((row, i) => (
                  <li key={i}>
                    {row.section} · {row.status} · {row.item}
                    {row.found !== null && <> ({row.found})</>}
                    {row.detail && <> — {row.detail}</>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {offerDelete && (
            <div data-testid="cleanup-confirm" style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid #f5c6cb' }}>
              <label style={{ fontSize: 13 }}>
                Type the email again to confirm
                <br />
                <input
                  type="text"
                  value={confirmEmail}
                  disabled={deleting}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  style={inputStyle}
                  autoComplete="off"
                />
              </label>
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={runDelete}
                  disabled={!confirmMatches || deleting || disabled}
                  style={actionButtonStyle('#dc3545', !confirmMatches || deleting || disabled)}
                >
                  {deleting ? 'Deleting…' : 'Delete this test account'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {deleteError && (
        <div role="alert" data-testid="cleanup-delete-error" style={{ ...box, marginTop: 12, borderColor: '#ffc107', background: '#fffbe6' }}>
          <p style={{ margin: 0, fontSize: 14 }}>{deleteError.sentence}</p>
          <BlockerList blockers={deleteError.blockers} />
        </div>
      )}

      {removed && (
        <div role="status" data-testid="cleanup-report" style={{ ...box, marginTop: 12, borderColor: '#198754', background: '#f0fff4' }}>
          <div style={blockHeader}>
            <strong>Test account removed.</strong>
            <CopyButton label="Copy delete report" testId="cleanup-copy-report" text={() => formatDeleteReportText(removed)} />
          </div>
          <table style={{ fontSize: 12, borderCollapse: 'collapse', marginTop: 6 }}>
            <thead>
              <tr>
                <th style={cell}>Table</th>
                <th style={cell}>Rows</th>
              </tr>
            </thead>
            <tbody>
              {removed.report.tables.map((row, i) => (
                <tr key={i}>
                  <td style={cell}>{row.table}</td>
                  <td style={cell}>{row.rowsRemoved}</td>
                </tr>
              ))}
              <tr data-testid="cleanup-report-total" style={{ fontWeight: 700 }}>
                <td style={cell}>TOTAL · {removed.report.total.result}</td>
                <td style={cell}>
                  {removed.report.total.rowsRemoved} rows in {removed.report.total.tablesRemoved} tables
                </td>
              </tr>
            </tbody>
          </table>
          <p style={{ margin: '6px 0 0', fontSize: 13 }}>
            Files removed: <strong>{removed.filesRemoved}</strong> · login{' '}
            <code>{removed.report.total.removedLogin ?? removed.targetUserId ?? 'unknown'}</code>
            {removed.report.total.removedAt && <> · at {removed.report.total.removedAt}</>}
          </p>
          {(removed.serverMs.check !== null || removed.serverMs.delete !== null) && (
            <p data-testid="cleanup-delete-server-time" style={{ margin: '4px 0 0', fontSize: 12, color: '#6c757d' }}>
              Server time: check {removed.serverMs.check ?? '?'} ms · delete {removed.serverMs.delete ?? '?'} ms
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default TestAccountCleanupPanel;

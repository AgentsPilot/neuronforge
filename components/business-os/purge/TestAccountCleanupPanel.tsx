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
 * Locked mode (AU-1, /admin/users): with `lockedEmail` the same panel runs the
 * same check and delete for the account an admin picked on its row. The email
 * and the tag are read-only and both equal that email, so the tag rule always
 * passes and every other guard is the only safety, exactly as before. The
 * typed confirmation stays. Without the prop the Danger Zone render is
 * unchanged (AU-C1).
 *
 * Tone: `tone="admin-dark"` (passed by /admin/users) swaps every inline light
 * style for Tailwind classes matching that page, with each text colour set
 * explicitly, and drops the panel's own card so it sits in the danger area.
 * The default 'light' renders exactly the inline styles it always had.
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md
 * Amendment: docs/requirements/TEST_ACCOUNT_CLEANUP_ADMIN_USERS_AMENDMENT.md
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

/**
 * Visual tone. 'light' is the Danger Zone look on /test-business-os (inline
 * styles, unchanged). 'admin-dark' is /admin/users: Tailwind classes matching
 * that page, with every text colour set explicitly. The admin page's text is
 * white, so an inherited colour on a light surface reads as white on white.
 */
export type CleanupPanelTone = 'light' | 'admin-dark';

/** One element's styling: classes in admin-dark, the inline style (or nothing) in light. */
type Skin = { className?: string; style?: React.CSSProperties };
function skinFor(isDark: boolean) {
  return (dark: string, light?: React.CSSProperties): Skin => (isDark ? { className: dark } : light ? { style: light } : {});
}

const DARK_BUTTON = 'px-4 py-2 text-sm font-medium rounded-lg transition-colors';
/** A dark-tone action button; `hover` only applies while it can be pressed. */
function darkButtonClass(colours: string, hover: string, isDisabled: boolean): string {
  return `${DARK_BUTTON} ${colours} ${isDisabled ? 'opacity-50 cursor-not-allowed' : hover}`;
}
const DARK_INPUT =
  'mt-1 block w-full max-w-md bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500';
/** Read-only locked input: greyed, but the email stays readable. */
const DARK_INPUT_LOCKED =
  'mt-1 block w-full max-w-md border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-300 bg-slate-900/60 cursor-not-allowed';
const DARK_BLOCK = 'mt-4 bg-slate-800/70 border border-slate-700 rounded-lg p-4 text-slate-300';
const DARK_SUBHEAD = 'mt-3 mb-1 text-sm font-semibold text-slate-200';
const DARK_LIST = 'mt-1 pl-5 list-disc text-xs text-slate-300';
const DARK_CELL = 'px-2 py-0.5 border-b border-slate-700 text-left text-slate-300';
const DARK_HEAD_CELL = 'px-2 py-0.5 border-b border-slate-700 text-left font-medium text-slate-400';

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

/** Report heading in the Danger Zone; locked mode uses LOCKED_REMOVED_TITLE. */
const REMOVED_TITLE = 'Test account removed.';
const LOCKED_REMOVED_TITLE = 'Account removed.';

/** The fixed warning line of locked mode (user-accepted copy, SA SQ-3). */
export const LOCKED_WARNING = 'Permanently removes a real account, its login and money history.';

/** The delete report block as plain text, from the same view the panel renders. */
export function formatDeleteReportText(removed: CleanupDeleteView, title: string = REMOVED_TITLE): string {
  const { tables, total } = removed.report;
  const lines: string[] = [
    title,
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
function CopyButton({
  label,
  text,
  testId,
  isDark = false,
}: {
  label: string;
  text: () => string;
  testId: string;
  isDark?: boolean;
}) {
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
    <span
      {...skinFor(isDark)('inline-flex items-center gap-1.5 shrink-0', {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        flexShrink: 0,
      })}
    >
      {state === 'failed' && (
        <span
          data-testid={`${testId}-failed`}
          role="status"
          {...skinFor(isDark)('text-xs text-rose-300', { fontSize: 12, color: '#b02a37' })}
        >
          Could not copy — select the text instead
        </span>
      )}
      <button
        type="button"
        aria-label={label}
        data-testid={testId}
        onClick={copy}
        {...skinFor(isDark)(darkButtonClass('bg-slate-700 text-slate-100', 'hover:bg-slate-600', false), {
          ...actionButtonStyle('#6c757d', false),
          padding: '2px 10px',
          fontSize: 12,
        })}
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

function BlockerList({ blockers, isDark = false }: { blockers: CleanupBlockerView[]; isDark?: boolean }) {
  if (blockers.length === 0) return null;
  const skin = skinFor(isDark);
  return (
    <ul
      data-testid="cleanup-blockers"
      {...skin('mt-1 pl-5 list-disc text-sm text-slate-300', { margin: '4px 0 0', paddingLeft: 20, fontSize: 13 })}
    >
      {blockers.map((blocker, i) => (
        <li key={`${blocker.guard}-${i}`}>
          <strong {...skin('text-white')}>{blocker.guard}</strong> {blocker.item}
          {blocker.found !== null && <> ({blocker.found})</>}
          {blocker.guard === STORAGE_GUARD ? (
            isDark ? (
              <span className="text-slate-400"> — the delete removes these files first.</span>
            ) : (
              <> — the delete removes these files first.</>
            )
          ) : (
            blocker.clears &&
            (isDark ? (
              <span className="text-slate-400"> — to clear: {blocker.clears}</span>
            ) : (
              <> — to clear: {blocker.clears}</>
            ))
          )}
        </li>
      ))}
    </ul>
  );
}

export interface TestAccountCleanupPanelProps {
  /** The page's shared debug console. Codes and counts only, never an email. */
  onLog?: (type: 'info' | 'success' | 'error', message: string) => void;
  /**
   * Locked mode (AU-1): the account picked on an /admin/users row. Email and
   * tag are pre-filled with it and read-only; the typed confirmation stays.
   */
  lockedEmail?: string;
  /**
   * Called once after a delete whose report result is CLEAN, never otherwise.
   * Locked mode: when the admin clicks Done under the report, or on unmount,
   * or when the answer lands after the panel has unmounted (LF-F1).
   */
  onRemoved?: () => void;
  /** Visual tone; 'light' (default) keeps the Danger Zone look, 'admin-dark' matches /admin/users. */
  tone?: CleanupPanelTone;
}

type Probe = 'loading' | 'configured' | 'not_configured' | 'hidden' | 'unknown';

export function TestAccountCleanupPanel({
  onLog,
  lockedEmail,
  onRemoved,
  tone = 'light',
}: TestAccountCleanupPanelProps = {}) {
  const isLocked = typeof lockedEmail === 'string' && lockedEmail.trim() !== '';
  const isDark = tone === 'admin-dark';
  const skin = skinFor(isDark);
  const [probe, setProbe] = useState<Probe>('loading');
  // Locked: tag = email, so G-2 (email contains tag) always passes; the
  // server trims and lower-cases both, so case in the row email cannot fail it.
  const [email, setEmail] = useState(isLocked ? (lockedEmail as string) : '');
  const [tag, setTag] = useState(isLocked ? (lockedEmail as string) : DEFAULT_TEST_TAG);

  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ email: string; tag: string; view: CleanupCheckView } | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);

  const [confirmEmail, setConfirmEmail] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ sentence: string; blockers: CleanupBlockerView[] } | null>(null);
  const [removed, setRemoved] = useState<CleanupDeleteView | null>(null);

  // A ref, not only state: a second click in the same tick must not post twice.
  const inFlight = useRef(false);

  // Locked mode: a CLEAN result waits here until Done. If the panel unmounts
  // first (row collapsed, page left), the cleanup still reports it, so the
  // list never keeps showing a deleted account. Fires at most once.
  const cleanPending = useRef(false);
  const onRemovedRef = useRef(onRemoved);
  onRemovedRef.current = onRemoved;
  const fireRemoved = () => {
    if (!cleanPending.current) return;
    cleanPending.current = false;
    onRemovedRef.current?.();
  };
  useEffect(
    () => () => {
      if (cleanPending.current) {
        cleanPending.current = false;
        onRemovedRef.current?.();
      }
    },
    []
  );
  // LF-F1: a delete can outlive the panel (Escape closes the drawer mid-delete).
  // Its unmount cleanup has then already run, so a CLEAN answer landing later
  // must report itself; see runDelete. Set again on a StrictMode re-mount.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
      if (!isLocked) setEmail('');
      if (json.data.report.total.result === 'CLEAN') {
        // Locked: the report stays until Done (or unmount), so the admin can read and copy it.
        // Unmounted already (LF-F1): no Done and no unmount cleanup is left to
        // report it, so report it now; this is the only call for this answer.
        if (!mounted.current) onRemovedRef.current?.();
        else if (isLocked) cleanPending.current = true;
        else onRemovedRef.current?.();
      }
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
      {...skin('mt-2 text-slate-300', { ...box, borderColor: '#dc3545', borderWidth: 2, marginTop: 24 })}
    >
      {/* admin-dark: no card of its own, it sits directly inside the page's bordered danger area. */}
      <h3 id="test-account-cleanup-title" {...skin('text-base font-semibold text-white mb-1', { margin: '0 0 6px' })}>
        {isDark ? 'Remove this account' : isLocked ? 'Remove this account permanently' : 'Remove a test account'}
      </h3>
      {isLocked ? (
        <>
          <p
            data-testid="cleanup-locked-warning"
            {...skin('text-sm font-semibold text-rose-300 mb-1', {
              margin: '0 0 6px',
              fontSize: 14,
              fontWeight: 700,
              color: '#b02a37',
            })}
          >
            {LOCKED_WARNING}
          </p>
          <p {...skin('text-sm text-slate-400 mb-3', { margin: '0 0 8px', fontSize: 14 })}>
            Removes this account completely, login included, so the email can sign up again. Run the check first.{' '}
            <strong {...skin('text-slate-200')}>There is no undo.</strong>
          </p>
        </>
      ) : (
        <p {...skin('text-sm text-slate-400 mb-3', { margin: '0 0 8px', fontSize: 14 })}>
          Removes one <strong>test</strong> account completely, login included, so the email can sign up again. The
          email must contain the tag. Run the check first. <strong>There is no undo.</strong>
        </p>
      )}

      {probe === 'loading' && (
        <p {...skin('text-sm text-slate-400 mb-2', { color: '#666', fontSize: 13 })}>Checking whether this is set up…</p>
      )}
      {probe === 'not_configured' && (
        <p data-testid="cleanup-not-configured" {...skin('text-sm text-slate-300 mb-2', { margin: '0 0 8px', fontSize: 13 })}>
          <strong {...skin('text-white')}>Not set up on this deployment.</strong> See the test-account cleanup runbook, section 6
          (docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md).
        </p>
      )}
      {probe === 'unknown' && (
        <p {...skin('text-sm text-amber-300 mb-2', { margin: '0 0 8px', fontSize: 13, color: '#b8860b' })}>
          <strong>Could not tell whether this is set up.</strong> Reload the page to try again.
        </p>
      )}

      <div {...skin('grid gap-3 mb-3', { display: 'grid', gap: 8, marginBottom: 8 })}>
        <label {...skin('block text-sm text-slate-300', { fontSize: 13 })}>
          {isLocked ? 'Email' : 'Email of the test account'}
          <br />
          <input
            type="email"
            value={email}
            readOnly={isLocked}
            disabled={disabled || deleting}
            onChange={(e) => {
              if (isLocked) return;
              setEmail(e.target.value);
              resetFlow();
            }}
            {...skin(isLocked ? DARK_INPUT_LOCKED : DARK_INPUT, inputStyle)}
            autoComplete="off"
          />
        </label>
        <label {...skin('block text-sm text-slate-300', { fontSize: 13 })}>
          {isLocked ? 'Tag (the same email)' : 'Test tag (the email must contain it)'}
          <br />
          <input
            type="text"
            value={tag}
            readOnly={isLocked}
            disabled={disabled || deleting}
            onChange={(e) => {
              if (isLocked) return;
              setTag(e.target.value);
              resetFlow();
            }}
            {...skin(isLocked ? DARK_INPUT_LOCKED : DARK_INPUT, inputStyle)}
            autoComplete="off"
            aria-describedby={!tag.trim() ? 'cleanup-empty-tag-hint' : undefined}
          />
        </label>
        {/* Check is disabled on an empty tag on purpose (it would match every
            account); say so, or the button just looks broken. */}
        {!isLocked && !tag.trim() && !disabled && (
          <p
            id="cleanup-empty-tag-hint"
            data-testid="cleanup-empty-tag-hint"
            {...skin('text-sm text-rose-300', { margin: 0, fontSize: 13, color: '#b02a37' })}
          >
            Enter a test tag. An empty tag would match every account, so Check stays off.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={runCheck}
        disabled={checkDisabled}
        {...skin(
          darkButtonClass('bg-blue-600 text-white', 'hover:bg-blue-500', checkDisabled),
          actionButtonStyle('#0d6efd', checkDisabled)
        )}
      >
        {checking ? 'Checking…' : 'Check'}
      </button>

      {checkError && (
        <p
          role="alert"
          data-testid="cleanup-check-error"
          {...skin('mt-2 text-sm text-rose-300', { margin: '8px 0 0', fontSize: 14, color: '#b02a37' })}
        >
          {checkError}
        </p>
      )}

      {view && (
        <div data-testid="cleanup-check-result" {...skin(DARK_BLOCK, { ...box, marginTop: 12 })}>
          <div {...skin('flex justify-between items-start gap-2', blockHeader)}>
            <p {...skin('text-sm text-slate-300', { margin: 0, fontSize: 15 })}>
              <strong
                data-testid="cleanup-verdict"
                {...skin(view.verdict === 'OK' ? 'font-semibold text-emerald-400' : 'font-semibold text-rose-400', {
                  color: view.verdict === 'OK' ? '#198754' : '#b02a37',
                })}
              >
                {view.verdict}
              </strong>{' '}
              · login <code {...skin('text-slate-400')}>{view.targetUserId ?? 'not found'}</code>
            </p>
            <CopyButton
              label="Copy check result"
              testId="cleanup-copy-check"
              text={() => formatCheckResultText(view)}
              isDark={isDark}
            />
          </div>
          {view.serverMs !== null && (
            <p
              data-testid="cleanup-check-server-time"
              {...skin('mt-1 text-xs text-slate-500', { margin: '4px 0 0', fontSize: 12, color: '#6c757d' })}
            >
              Server time: {view.serverMs} ms
            </p>
          )}
          {!view.functionUpToDate && (
            <p role="alert" {...skin('mt-1.5 text-sm text-rose-300', { margin: '6px 0 0', fontSize: 13, color: '#b02a37' })}>
              The database function is out of date, so the delete will refuse. Apply the current migration.
            </p>
          )}
          <BlockerList blockers={view.blockers} isDark={isDark} />

          {rowsOf('remove').length > 0 && (
            <>
              <p {...skin(DARK_SUBHEAD, { margin: '10px 0 2px', fontSize: 13, fontWeight: 600 })}>Rows to remove</p>
              <table data-testid="cleanup-remove-rows" {...skin('text-xs border-collapse', { fontSize: 12, borderCollapse: 'collapse' })}>
                <tbody>
                  {rowsOf('remove').map((row, i) => (
                    <tr key={i}>
                      <td {...skin(DARK_CELL, cell)}>{row.item}</td>
                      <td {...skin(DARK_CELL, cell)}>{removeCountLabel(row)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view.storageObjects.length > 0 && (
            <>
              <p {...skin(DARK_SUBHEAD, { margin: '10px 0 2px', fontSize: 13, fontWeight: 600 })}>
                Files that will be removed ({view.storageObjects.length})
              </p>
              <ul data-testid="cleanup-storage" {...skin(DARK_LIST, { margin: 0, paddingLeft: 20, fontSize: 12 })}>
                {view.storageObjects.map((object, i) => (
                  <li key={i}>
                    <code {...skin('text-slate-400')}>
                      {object.bucket}/{object.path}
                    </code>
                  </li>
                ))}
              </ul>
            </>
          )}

          {rowsOf('trigger').length > 0 && (
            <>
              <p {...skin(DARK_SUBHEAD, { margin: '10px 0 2px', fontSize: 13, fontWeight: 600 })}>Triggers that fire on the login</p>
              <ul {...skin(DARK_LIST, { margin: 0, paddingLeft: 20, fontSize: 12 })}>
                {rowsOf('trigger').map((row, i) => (
                  <li key={i}>
                    <code {...skin('text-slate-400')}>{row.item}</code>
                    {row.detail && <> — {row.detail}</>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {rowsOf('kept').length > 0 && (
            <>
              <p {...skin(DARK_SUBHEAD, { margin: '10px 0 2px', fontSize: 13, fontWeight: 600 })}>Kept</p>
              <ul data-testid="cleanup-kept" {...skin(DARK_LIST, { margin: 0, paddingLeft: 20, fontSize: 12 })}>
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
              <p {...skin(DARK_SUBHEAD, { margin: '10px 0 2px', fontSize: 13, fontWeight: 600 })}>Other rows</p>
              <ul data-testid="cleanup-other-rows" {...skin(DARK_LIST, { margin: 0, paddingLeft: 20, fontSize: 12 })}>
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
            <div
              data-testid="cleanup-confirm"
              {...skin('mt-4 pt-3 border-t border-slate-700', { marginTop: 12, paddingTop: 8, borderTop: '1px solid #f5c6cb' })}
            >
              <label {...skin('block text-sm text-slate-300', { fontSize: 13 })}>
                Type the email again to confirm
                <br />
                <input
                  type="text"
                  value={confirmEmail}
                  disabled={deleting}
                  onChange={(e) => setConfirmEmail(e.target.value)}
                  {...skin(DARK_INPUT, inputStyle)}
                  autoComplete="off"
                />
              </label>
              <div {...skin('mt-3', { marginTop: 8 })}>
                <button
                  type="button"
                  onClick={runDelete}
                  disabled={!confirmMatches || deleting || disabled}
                  {...skin(
                    darkButtonClass('bg-rose-600 text-white', 'hover:bg-rose-500', !confirmMatches || deleting || disabled),
                    actionButtonStyle('#dc3545', !confirmMatches || deleting || disabled)
                  )}
                >
                  {deleting ? 'Deleting…' : isLocked ? 'Delete this account' : 'Delete this test account'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {deleteError && (
        <div
          role="alert"
          data-testid="cleanup-delete-error"
          {...skin(DARK_BLOCK, { ...box, marginTop: 12, borderColor: '#ffc107', background: '#fffbe6' })}
        >
          <p {...skin('text-sm text-rose-300', { margin: 0, fontSize: 14 })}>{deleteError.sentence}</p>
          <BlockerList blockers={deleteError.blockers} isDark={isDark} />
        </div>
      )}

      {removed && (
        <div
          role="status"
          data-testid="cleanup-report"
          {...skin(DARK_BLOCK, { ...box, marginTop: 12, borderColor: '#198754', background: '#f0fff4' })}
        >
          <div {...skin('flex justify-between items-start gap-2', blockHeader)}>
            <strong {...skin('font-semibold text-emerald-400')}>{isLocked ? LOCKED_REMOVED_TITLE : REMOVED_TITLE}</strong>
            <CopyButton
              label="Copy delete report"
              testId="cleanup-copy-report"
              text={() => formatDeleteReportText(removed, isLocked ? LOCKED_REMOVED_TITLE : REMOVED_TITLE)}
              isDark={isDark}
            />
          </div>
          <table {...skin('mt-2 text-xs border-collapse', { fontSize: 12, borderCollapse: 'collapse', marginTop: 6 })}>
            <thead>
              <tr>
                <th {...skin(DARK_HEAD_CELL, cell)}>Table</th>
                <th {...skin(DARK_HEAD_CELL, cell)}>Rows</th>
              </tr>
            </thead>
            <tbody>
              {removed.report.tables.map((row, i) => (
                <tr key={i}>
                  <td {...skin(DARK_CELL, cell)}>{row.table}</td>
                  <td {...skin(DARK_CELL, cell)}>{row.rowsRemoved}</td>
                </tr>
              ))}
              <tr data-testid="cleanup-report-total" {...skin('font-semibold', { fontWeight: 700 })}>
                <td {...skin(DARK_CELL, cell)}>TOTAL · {removed.report.total.result}</td>
                <td {...skin(DARK_CELL, cell)}>
                  {removed.report.total.rowsRemoved} rows in {removed.report.total.tablesRemoved} tables
                </td>
              </tr>
            </tbody>
          </table>
          <p {...skin('mt-2 text-sm text-slate-300', { margin: '6px 0 0', fontSize: 13 })}>
            Files removed: <strong {...skin('text-white')}>{removed.filesRemoved}</strong> · login{' '}
            <code {...skin('text-slate-400')}>{removed.report.total.removedLogin ?? removed.targetUserId ?? 'unknown'}</code>
            {removed.report.total.removedAt && <> · at {removed.report.total.removedAt}</>}
          </p>
          {(removed.serverMs.check !== null || removed.serverMs.delete !== null) && (
            <p
              data-testid="cleanup-delete-server-time"
              {...skin('mt-1 text-xs text-slate-500', { margin: '4px 0 0', fontSize: 12, color: '#6c757d' })}
            >
              Server time: check {removed.serverMs.check ?? '?'} ms · delete {removed.serverMs.delete ?? '?'} ms
            </p>
          )}
          {isLocked && removed.report.total.result === 'CLEAN' && (
            <div {...skin('mt-3', { marginTop: 10 })}>
              <button
                type="button"
                data-testid="cleanup-done"
                onClick={fireRemoved}
                {...skin(
                  darkButtonClass('bg-slate-700 text-slate-100', 'hover:bg-slate-600', false),
                  actionButtonStyle('#6c757d', false)
                )}
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default TestAccountCleanupPanel;

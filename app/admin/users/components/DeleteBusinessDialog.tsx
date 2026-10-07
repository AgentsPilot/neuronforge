'use client';

/**
 * The "Delete…" dialog for ONE business (admin delete AD-1c preview, AD-2b
 * typed confirmation and result; requirement FR-A1 … FR-A3, FR-A6, FR-A9,
 * AC-A2, AC-A3, AC-A6, AC-A7; SA SC-9, SC-12, AC2-5).
 *
 * Every time it opens it POSTs `{}` to the admin preview route
 * (`/api/admin/users/<id>/deletion/preview`) and shows what deleting the
 * business would remove and keep, and every refusal with what clears it.
 *
 * AD-2b. Only when the preview returned a `commitToken` (the off switch is on,
 * nothing blocks, a value to type is known: FR-A3) is a typed-confirmation
 * field offered. Delete enables when the text matches the business name (or
 * the account email when there is none), using the server's normalisation;
 * that is a convenience, the server compares again and is authoritative. It
 * POSTs `{ token, confirmText }` to `/api/admin/users/<id>/deletion/commit`
 * and shows the result, or the refusal as one sentence from the copy file.
 * The token is held in component state only: never a URL, storage or a log.
 * Without a token the confirm stays disabled with "Deletion not yet
 * available: <reason>" linked through `aria-describedby` (SC-9). The account
 * id comes from the row; the server reads the target from the path only.
 *
 * Accessibility (SC-12): the Radix dialog traps focus and closes on Esc; one
 * `role="status"` region, mounted for the dialog's whole life, announces
 * loading and then the blocked state in text (never colour alone). A failure
 * is a `role="alert"` sentence from the copy file, never the server's raw
 * error.
 *
 * The shared Dialog primitive falls back to light colours on the admin shell,
 * which does not load the `--v2-*` tokens; the `!` classes override that (the
 * `CreditFormDialog` precedent).
 */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import {
  BLOCKING_STATUSES,
  DELETION_AREA_LABELS,
  DELETION_COMMIT_UNKNOWN,
  DELETION_COPY,
  DELETION_KEPT_CATEGORIES,
  DELETION_REFUSAL_TITLES,
  DELETION_RESULT_KEPT,
  DELETION_STATUS_LABELS,
  REOPEN_PREVIEW_CODES,
  commitRefusalSentence,
  deletionErrorSentence,
  formatAreaRows,
  formatJoined,
  formatRows,
  formatTableCount,
  inviteResultLines,
  isKnownCommitCode,
  normaliseConfirmText,
  storageResultLine,
} from '../deletionCopy';
import type {
  DeletionAreaView,
  DeletionCommitRefusalView,
  DeletionCommitResultView,
  DeletionPreviewPayload,
  DeletionRefusalView,
} from '../types';

const DARK_DIALOG = '!border-slate-700 !bg-slate-900 !text-slate-100 sm:!max-w-2xl';
const DARK_INPUT = '!border-slate-600 !bg-slate-800 !text-white';

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'error'; sentence: string }
  | { kind: 'ready'; preview: DeletionPreviewPayload };

export function deletionPreviewUrl(accountId: string): string {
  return `/api/admin/users/${encodeURIComponent(accountId)}/deletion/preview`;
}

/** POST `{}` and read the answer; never throws. Only a known code reaches the copy, never a raw message. */
async function fetchPreview(accountId: string, signal: AbortSignal): Promise<PreviewState> {
  try {
    const response = await fetch(deletionPreviewUrl(accountId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      cache: 'no-store',
      signal,
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    if (response.ok && record?.success === true && record.data && typeof record.data === 'object') {
      return { kind: 'ready', preview: record.data as DeletionPreviewPayload };
    }
    return { kind: 'error', sentence: deletionErrorSentence(typeof record?.error === 'string' ? record.error : 'unknown') };
  } catch {
    return { kind: 'error', sentence: deletionErrorSentence('unknown') };
  }
}

function statusClass(refusal: DeletionRefusalView): string {
  if (BLOCKING_STATUSES.has(refusal.status)) return 'border-rose-500/40 bg-rose-500/10';
  if (refusal.status === 'clear') return 'border-emerald-500/30 bg-emerald-500/5';
  return 'border-slate-700 bg-slate-800/40';
}

function badgeClass(refusal: DeletionRefusalView): string {
  if (BLOCKING_STATUSES.has(refusal.status)) return 'bg-rose-500/20 text-rose-200';
  if (refusal.status === 'clear') return 'bg-emerald-500/20 text-emerald-200';
  return 'bg-slate-600/40 text-slate-200';
}

function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 text-sm font-semibold text-slate-200">{children}</h3>;
}

function PreviewBody({ preview }: { preview: DeletionPreviewPayload }) {
  const blockingCount = preview.refusals.filter((r) => BLOCKING_STATUSES.has(r.status)).length;

  return (
    <div className="space-y-5 text-sm">
      <dl data-testid="deletion-target" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-slate-400">Business</dt>
        <dd className={preview.target.businessName ? 'text-white font-semibold' : 'text-slate-400 italic'}>
          {preview.target.businessName ?? DELETION_COPY.noBusinessName}
        </dd>
        <dt className="text-slate-400">Email</dt>
        <dd className="text-white break-all">{preview.target.email ?? DELETION_COPY.unknown}</dd>
        <dt className="text-slate-400">User id</dt>
        <dd className="text-white font-mono text-xs break-all">{preview.target.userId}</dd>
        <dt className="text-slate-400">Joined</dt>
        <dd className="text-white">{formatJoined(preview.target.joinedAt)}</dd>
      </dl>

      <section aria-labelledby="deletion-refusals-heading">
        <SectionHeading>
          <span id="deletion-refusals-heading">
            Refusals ({blockingCount} blocking)
          </span>
        </SectionHeading>
        <ul data-testid="deletion-refusals" className="space-y-2">
          {preview.refusals.map((refusal) => (
            <li
              key={refusal.id}
              data-testid={`refusal-${refusal.id}`}
              data-status={refusal.status}
              className={`rounded-lg border p-3 ${statusClass(refusal)}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-slate-400">{refusal.id}</span>
                <span className="font-semibold text-white">{DELETION_REFUSAL_TITLES[refusal.id]}</span>
                <span className={`ms-auto rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(refusal)}`}>
                  {DELETION_STATUS_LABELS[refusal.status]}
                </span>
              </div>
              <p className="mt-1 text-slate-300">{refusal.message}</p>
              {refusal.clearingAction && BLOCKING_STATUSES.has(refusal.status) && (
                <p data-testid={`clearing-${refusal.id}`} className="mt-1 text-amber-200">
                  To clear: {refusal.clearingAction}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section data-testid="deletion-removed">
        <SectionHeading>What would be removed</SectionHeading>
        {!preview.counted ? (
          <p className="text-slate-400">{DELETION_COPY.notCounted}</p>
        ) : (
          <>
            <ul className="space-y-1">
              {preview.areas.map((area) => (
                <li key={area.area} data-testid={`area-${area.area}`} className="flex justify-between gap-4">
                  <span className="text-slate-300">{DELETION_AREA_LABELS[area.area]}</span>
                  <span className="text-white tabular-nums">{formatAreaRows(area)}</span>
                </li>
              ))}
            </ul>
            {preview.storage.length > 0 && (
              <ul className="mt-3 space-y-1">
                {preview.storage.map((bucket) => (
                  <li key={bucket.table} data-testid={`storage-${bucket.table}`} className="flex justify-between gap-4">
                    <span className="text-slate-300">
                      Files in <span className="font-mono text-xs">{bucket.table}</span>
                    </span>
                    <span className="text-white tabular-nums">{formatTableCount(bucket)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section data-testid="deletion-kept">
        <SectionHeading>What is kept, and why</SectionHeading>
        <ul className="space-y-1">
          {DELETION_KEPT_CATEGORIES.map((kept) => (
            <li key={kept.title}>
              <span className="font-medium text-white">{kept.title}.</span>{' '}
              <span className="text-slate-300">{kept.why}</span>
            </li>
          ))}
        </ul>
      </section>

      {preview.limitations.length > 0 && (
        <section data-testid="deletion-limitations">
          <SectionHeading>What this preview could not verify</SectionHeading>
          <ul className="list-disc space-y-1 ps-5 text-slate-300">
            {preview.limitations.map((line, i) => (
              <li key={`${i}-${line}`}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <details data-testid="deletion-technical" className="rounded-lg border border-slate-700 p-3">
        <summary className="cursor-pointer text-slate-300">{DELETION_COPY.technical}</summary>
        <div className="mt-3 space-y-3 text-xs">
          {preview.areas.map((area) => (
            <div key={area.area}>
              <p className="font-semibold text-slate-200">{DELETION_AREA_LABELS[area.area]}</p>
              <ul className="font-mono text-slate-400">
                {area.tables.map((t) => (
                  <li key={t.table}>
                    {t.table}: {formatTableCount(t)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div>
            <p className="font-semibold text-slate-200">Kept tables</p>
            <ul className="text-slate-400">
              {preview.keptTables.map((t) => (
                <li key={t.table}>
                  <span className="font-mono">{t.table}</span>
                  {t.notes ? `: ${t.notes}` : ''}
                </li>
              ))}
            </ul>
          </div>
          {preview.schema && (
            <div>
              <p className="font-semibold text-slate-200">Schema check: {preview.schema.status}</p>
              {preview.schema.unclassified.length > 0 && (
                <p className="text-slate-400">Unclassified: <span className="font-mono">{preview.schema.unclassified.join(', ')}</span></p>
              )}
              {preview.schema.missingDeletable.length > 0 && (
                <p className="text-slate-400">Missing deletable: <span className="font-mono">{preview.schema.missingDeletable.join(', ')}</span></p>
              )}
            </div>
          )}
          <p className="text-slate-500">
            Correlation id: <span className="font-mono">{preview.correlationId}</span>
          </p>
        </div>
      </details>
    </div>
  );
}

// ── AD-2b: the commit ──────────────────────────────────────────────────────

type CommitState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'completed'; result: DeletionCommitResultView }
  | {
      kind: 'refused';
      sentence: string;
      reopen: boolean;
      blocking: DeletionRefusalView[];
      snapshotWritten: boolean;
      correlationId: string | null;
    }
  | { kind: 'unknown'; sentence: string };

export function deletionCommitUrl(accountId: string): string {
  return `/api/admin/users/${encodeURIComponent(accountId)}/deletion/commit`;
}

/**
 * POST `{ token, confirmText }` and read the answer; never throws. A known
 * code becomes its sentence; anything else (a 500, a network failure, an
 * unreadable body) is "the result is not known", because it may have deleted.
 * The token lives only in component state and this request body (SA AC2-5).
 */
async function postCommit(accountId: string, token: string, confirmText: string): Promise<CommitState> {
  let response: Response;
  try {
    response = await fetch(deletionCommitUrl(accountId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, confirmText }),
      cache: 'no-store',
    });
  } catch {
    return { kind: 'unknown', sentence: DELETION_COMMIT_UNKNOWN };
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    parsed = null;
  }
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  if (response.ok && record?.success === true) {
    // A 200 the screen cannot read may still have deleted: never crash, never claim either way (QA).
    return isCommitResult(record.data)
      ? { kind: 'completed', result: record.data }
      : { kind: 'unknown', sentence: DELETION_COMMIT_UNKNOWN };
  }
  const body = record as Partial<DeletionCommitRefusalView> | null;
  const code = typeof body?.error === 'string' ? body.error : '';
  const sentence = commitRefusalSentence(code, body?.expectedKind);
  if (sentence === null) return { kind: 'unknown', sentence: DELETION_COMMIT_UNKNOWN };
  // SA-3: the RPC call failing may be a transport failure after the database committed, so it is not a clean refusal.
  if (code === 'commit_failed') return { kind: 'unknown', sentence };
  return {
    kind: 'refused',
    sentence,
    reopen: isKnownCommitCode(code) && REOPEN_PREVIEW_CODES.has(code),
    blocking: Array.isArray(body?.refusals) ? body.refusals.filter((r) => BLOCKING_STATUSES.has(r.status)) : [],
    snapshotWritten: body?.snapshotWritten === true,
    correlationId: typeof body?.correlationId === 'string' ? body.correlationId : null,
  };
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isCountOrNull = (v: unknown) => v === null || isCount(v);

/** The fields the result screen reads, checked before it renders (QA: a malformed 200 must not crash it). */
function isCommitResult(data: unknown): data is DeletionCommitResultView {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  const rows = d.rows as Record<string, unknown> | null | undefined;
  const invites = d.invites as Record<string, unknown> | null | undefined;
  return (
    typeof d.snapshotPath === 'string' &&
    typeof d.correlationId === 'string' &&
    typeof d.auditRecorded === 'boolean' &&
    !!rows &&
    typeof rows === 'object' &&
    isCount(rows.total) &&
    !!rows.byTable &&
    typeof rows.byTable === 'object' &&
    Object.values(rows.byTable as Record<string, unknown>).every(isCount) &&
    Array.isArray(d.storage) &&
    (d.storage as unknown[]).every(
      (b) => !!b && typeof b === 'object' && typeof (b as Record<string, unknown>).bucket === 'string' &&
        isCount((b as Record<string, unknown>).deleted) && isCount((b as Record<string, unknown>).failed)
    ) &&
    !!invites &&
    typeof invites === 'object' &&
    isCountOrNull(invites.revoked) &&
    isCountOrNull(invites.skippedMidSignup)
  );
}

/** What the admin must type, from the preview (the server compares its own value). */
function expectedConfirmation(preview: DeletionPreviewPayload): string | null {
  if (preview.confirmKind === 'business name') return preview.target.businessName;
  if (preview.confirmKind === 'account email') return preview.target.email;
  return null;
}

/** A confirmation is offered only with a token, a known value to type, and no blocking refusal (FR-A3). */
function confirmableValue(preview: DeletionPreviewPayload): string | null {
  if (!preview.commitToken) return null;
  if (preview.refusals.some((r) => BLOCKING_STATUSES.has(r.status))) return null;
  const expected = expectedConfirmation(preview);
  return expected && expected.trim() !== '' ? expected : null;
}

/** Rows removed per area, grouped as the preview groups tables (FR-A9). Unknown tables go last. */
function rowsByArea(
  result: DeletionCommitResultView,
  preview: DeletionPreviewPayload | null
): Array<{ key: string; label: string; rows: number }> {
  const areaOf = new Map<string, DeletionAreaView>();
  for (const area of preview?.areas ?? []) for (const t of area.tables) areaOf.set(t.table, area.area);
  const totals = new Map<string, number>();
  for (const [table, rows] of Object.entries(result.rows.byTable)) {
    const key = areaOf.get(table) ?? 'other';
    totals.set(key, (totals.get(key) ?? 0) + rows);
  }
  const order = (preview?.areas ?? []).map((a) => a.area as string);
  return [...totals.entries()]
    .sort(([a], [b]) => {
      const ia = a === 'other' ? Number.MAX_SAFE_INTEGER : order.indexOf(a);
      const ib = b === 'other' ? Number.MAX_SAFE_INTEGER : order.indexOf(b);
      return ia - ib;
    })
    .map(([key, rows]) => ({
      key,
      label: key === 'other' ? DELETION_COPY.otherTables : DELETION_AREA_LABELS[key as DeletionAreaView],
      rows,
    }));
}

function CompletedBody({ result, preview }: { result: DeletionCommitResultView; preview: DeletionPreviewPayload | null }) {
  const areas = rowsByArea(result, preview);
  return (
    <div data-testid="deletion-result" className="space-y-5 text-sm">
      <section data-testid="result-removed">
        <SectionHeading>What was removed</SectionHeading>
        <p className="mb-2 text-white">
          In total: <span className="tabular-nums">{formatRows(result.rows.total)}</span>
        </p>
        <ul className="space-y-1">
          {areas.map((area) => (
            <li key={area.key} data-testid={`result-area-${area.key}`} className="flex justify-between gap-4">
              <span className="text-slate-300">{area.label}</span>
              <span className="text-white tabular-nums">{formatRows(area.rows)}</span>
            </li>
          ))}
        </ul>
        {result.storage.length > 0 && (
          <ul className="mt-3 space-y-1">
            {result.storage.map((bucket) => (
              <li
                key={bucket.bucket}
                data-testid={`result-storage-${bucket.bucket}`}
                className={bucket.failed > 0 ? 'text-amber-200' : 'text-slate-300'}
              >
                Files in <span className="font-mono text-xs">{bucket.bucket}</span>: {storageResultLine(bucket)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-testid="result-invites">
        <SectionHeading>Invites</SectionHeading>
        <ul className="space-y-1 text-slate-300">
          {inviteResultLines(result.invites).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <section data-testid="result-kept">
        <SectionHeading>What was kept</SectionHeading>
        <ul className="list-disc space-y-1 ps-5 text-slate-300">
          {DELETION_RESULT_KEPT.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>

      <p
        data-testid="result-audit"
        role={result.auditRecorded ? undefined : 'alert'}
        className={result.auditRecorded ? 'text-slate-300' : 'rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-rose-200'}
      >
        {result.auditRecorded ? DELETION_COPY.auditRecorded : DELETION_COPY.auditNotRecorded}
      </p>

      <dl data-testid="result-reference" className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
        <dt className="text-slate-400">Snapshot</dt>
        <dd className="font-mono text-slate-200 break-all">{result.snapshotPath}</dd>
        <dt className="text-slate-400">Correlation id</dt>
        <dd className="font-mono text-slate-200 break-all">{result.correlationId}</dd>
      </dl>
    </div>
  );
}

function RefusedBody({ state }: { state: Extract<CommitState, { kind: 'refused' }> }) {
  return (
    <div data-testid="deletion-refused" className="space-y-3 text-sm">
      <p data-testid="refused-sentence" role="alert" className="text-rose-200">
        {state.sentence}
      </p>
      {state.blocking.length > 0 && (
        <p data-testid="refused-blocking" className="text-slate-300">
          {DELETION_COPY.blockingNow} {state.blocking.map((r) => DELETION_REFUSAL_TITLES[r.id]).join(', ')}.
        </p>
      )}
      {state.snapshotWritten && (
        <p data-testid="refused-snapshot" className="text-slate-300">
          {DELETION_COPY.snapshotWrittenNote}
        </p>
      )}
      {state.correlationId && (
        <p className="text-xs text-slate-500">
          Correlation id: <span className="font-mono">{state.correlationId}</span>
        </p>
      )}
    </div>
  );
}

function ConfirmField({
  id,
  hintId,
  kind,
  expected,
  value,
  onChange,
  disabled,
}: {
  id: string;
  hintId: string;
  kind: DeletionPreviewPayload['confirmKind'];
  expected: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
}) {
  return (
    <div data-testid="deletion-confirm-field" className="space-y-1 rounded-lg border border-rose-500/40 bg-rose-500/5 p-3">
      <Label htmlFor={id} className="text-slate-200">
        {kind === 'account email' ? DELETION_COPY.confirmLabelEmail : DELETION_COPY.confirmLabelBusinessName}:{' '}
        <span data-testid="deletion-confirm-expected" className="font-semibold text-white break-all">
          {expected}
        </span>
      </Label>
      <Input
        id={id}
        data-testid="deletion-confirm-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        aria-describedby={hintId}
        className={DARK_INPUT}
      />
      <p id={hintId} className="text-xs text-slate-400">
        {DELETION_COPY.confirmHint}
      </p>
    </div>
  );
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  /** Called when the dialog closes after a completed (or unknown) deletion, so the page refreshes the row (FR-A9). */
  onDeleted?: () => void;
}

export function DeleteBusinessDialog({ open, onOpenChange, accountId, onDeleted }: Props) {
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const inputId = `${ids}-confirm`;
  const hintId = `${ids}-confirm-hint`;
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  const [commit, setCommit] = useState<CommitState>({ kind: 'idle' });
  const [typed, setTyped] = useState('');
  const controller = useRef<AbortController | null>(null);
  const resultHeading = useRef<HTMLSpanElement | null>(null);
  // State updates are async: a second submit in the same tick would still see `idle`. The ref closes that gap (QA).
  const inFlight = useRef(false);

  const load = useCallback(() => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setState({ kind: 'loading' });
    setCommit({ kind: 'idle' });
    setTyped('');
    void fetchPreview(accountId, next.signal).then((result) => {
      // A closed dialog or a newer request owns the state now.
      if (!next.signal.aborted) setState(result);
    });
  }, [accountId]);

  // A fresh preview (and a fresh token) every time the dialog opens: counts and refusals change.
  useEffect(() => {
    if (!open) return;
    load();
    return () => controller.current?.abort();
  }, [open, load]);

  const preview = state.kind === 'ready' ? state.preview : null;
  const expected = preview ? confirmableValue(preview) : null;
  const isSubmitting = commit.kind === 'submitting';
  const hasOutcome = commit.kind === 'completed' || commit.kind === 'refused' || commit.kind === 'unknown';
  const isConfirmable = expected !== null && !hasOutcome;
  const matches = expected !== null && normaliseConfirmText(typed) !== '' && normaliseConfirmText(typed) === normaliseConfirmText(expected);
  const canSubmit = isConfirmable && matches && !isSubmitting;

  // Move focus to the outcome's heading, so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (hasOutcome) resultHeading.current?.focus();
  }, [hasOutcome]);

  const handleOpenChange = (next: boolean) => {
    // Never close mid-request: the admin must see what happened.
    if (!next && isSubmitting) return;
    if (!next && (commit.kind === 'completed' || commit.kind === 'unknown')) onDeleted?.();
    onOpenChange(next);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // Enter in the field must not submit what the button would not.
    if (!canSubmit || !preview?.commitToken) return;
    if (inFlight.current) return;
    inFlight.current = true;
    setCommit({ kind: 'submitting' });
    void postCommit(accountId, preview.commitToken, typed).then((next) => {
      inFlight.current = false;
      setCommit(next);
    });
  };

  let statusText: string;
  if (commit.kind === 'submitting') statusText = DELETION_COPY.deleting;
  else if (commit.kind === 'completed') statusText = DELETION_COPY.resultTitle;
  else if (commit.kind === 'refused') statusText = `${DELETION_COPY.refusedTitle}. ${commit.sentence}`;
  else if (commit.kind === 'unknown') statusText = commit.sentence;
  else if (isConfirmable) statusText = DELETION_COPY.readyToConfirm;
  else if (state.kind === 'loading')
    statusText = `${DELETION_COPY.loading} ${DELETION_COPY.unavailablePrefix}${DELETION_COPY.reasonLoading}`;
  else if (state.kind === 'ready') statusText = `${DELETION_COPY.unavailablePrefix}${state.preview.deletionUnavailableReason}`;
  else statusText = `${DELETION_COPY.unavailablePrefix}${DELETION_COPY.reasonError}`;

  let title: string = DELETION_COPY.title;
  let description: string = isConfirmable ? DELETION_COPY.descriptionConfirm : DELETION_COPY.description;
  if (commit.kind === 'completed') {
    title = DELETION_COPY.resultTitle;
    description = DELETION_COPY.resultDescription;
  } else if (commit.kind === 'refused') {
    title = DELETION_COPY.refusedTitle;
    description = DELETION_COPY.refusedDescription;
  } else if (commit.kind === 'unknown') {
    title = DELETION_COPY.unknownTitle;
    description = commit.sentence;
  }

  const closeButton = (
    <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
      {DELETION_COPY.close}
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="delete-business-dialog" className={DARK_DIALOG} aria-busy={isSubmitting}>
        <DialogHeader>
          <DialogTitle className="!text-white">
            <span ref={resultHeading} tabIndex={-1} data-testid="deletion-title" className="outline-none">
              {title}
            </span>
          </DialogTitle>
          <DialogDescription className="!text-slate-400">{description}</DialogDescription>
        </DialogHeader>

        {/* One live region for the dialog's whole life: loading, the blocked or ready state, progress, the outcome. */}
        <p
          id={reasonId}
          data-testid="deletion-status"
          role="status"
          aria-live="polite"
          className={
            state.kind === 'ready' && !hasOutcome
              ? 'rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100'
              : 'text-sm text-slate-400'
          }
        >
          {statusText}
        </p>

        {state.kind === 'error' && (
          <div className="space-y-3">
            <p data-testid="deletion-error" role="alert" className="text-sm text-rose-300">
              {state.sentence}
            </p>
            <Button type="button" variant="outline" onClick={load}>
              {DELETION_COPY.retry}
            </Button>
          </div>
        )}

        {commit.kind === 'completed' && <CompletedBody result={commit.result} preview={preview} />}
        {commit.kind === 'refused' && <RefusedBody state={commit} />}
        {commit.kind === 'unknown' && (
          <p data-testid="deletion-unknown" role="alert" className="text-sm text-amber-200">
            {commit.sentence}
          </p>
        )}

        {!hasOutcome && preview && <PreviewBody preview={preview} />}

        {hasOutcome ? (
          <DialogFooter className="gap-2">
            {commit.kind === 'refused' ? (
              <>
                {closeButton}
                {commit.reopen && (
                  <Button type="button" data-testid="deletion-reopen" onClick={load}>
                    {DELETION_COPY.reopenPreview}
                  </Button>
                )}
              </>
            ) : (
              <Button type="button" data-testid="deletion-close-result" onClick={() => handleOpenChange(false)}>
                {DELETION_COPY.closeResult}
              </Button>
            )}
          </DialogFooter>
        ) : isConfirmable && preview ? (
          <form data-testid="deletion-confirm-form" onSubmit={submit} noValidate className="space-y-4">
            {preview.resetLive === false && (
              <p data-testid="deletion-not-applied" className="text-sm text-amber-200">
                {DELETION_COPY.notAppliedLine}
              </p>
            )}
            {preview.resetLive === null && (
              <p data-testid="deletion-not-applied" className="text-sm text-amber-200">
                {DELETION_COPY.unknownAppliedLine}
              </p>
            )}
            <ConfirmField
              id={inputId}
              hintId={hintId}
              kind={preview.confirmKind}
              expected={expected}
              value={typed}
              onChange={setTyped}
              disabled={isSubmitting}
            />
            <DialogFooter className="gap-2">
              {closeButton}
              <Button
                type="submit"
                className="!bg-rose-700 !text-white"
                data-testid="deletion-confirm"
                disabled={!canSubmit}
                aria-describedby={reasonId}
              >
                {isSubmitting ? DELETION_COPY.deletingButton : DELETION_COPY.confirmButton}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <DialogFooter className="gap-2">
            {closeButton}
            {/* No token (switched off, refused, not offerable): the confirm stays disabled, with its reason (SC-9). */}
            <Button
              type="button"
              className="!bg-rose-700 !text-white"
              data-testid="deletion-confirm"
              disabled
              aria-describedby={reasonId}
            >
              {DELETION_COPY.confirmButton}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

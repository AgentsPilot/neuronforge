'use client';

/**
 * The "Delete…" dialog for ONE business (admin delete AD-1c; requirement
 * FR-A1, FR-A2, FR-A3, AC-A2, AC-A3; SA SC-9, SC-12).
 *
 * READ-ONLY. Every time it opens it POSTs `{}` to the admin preview route
 * (`/api/admin/users/<id>/deletion/preview`, AD-1b) and shows what deleting the
 * business would remove and keep, and every refusal with what clears it. There
 * is no confirmation input and no destructive call: the confirm button is
 * always disabled, with "Deletion not yet available: <reason>" linked to it
 * through `aria-describedby` (SC-9). The account id comes from the row; the
 * server reads the target from the path only.
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

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  BLOCKING_STATUSES,
  DELETION_AREA_LABELS,
  DELETION_COPY,
  DELETION_KEPT_CATEGORIES,
  DELETION_REFUSAL_TITLES,
  DELETION_STATUS_LABELS,
  deletionErrorSentence,
  formatAreaRows,
  formatJoined,
  formatTableCount,
} from '../deletionCopy';
import type { DeletionPreviewPayload, DeletionRefusalView } from '../types';

const DARK_DIALOG = '!border-slate-700 !bg-slate-900 !text-slate-100 sm:!max-w-2xl';

type PreviewState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
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
    return { kind: 'error', message: deletionErrorSentence(typeof record?.error === 'string' ? record.error : 'unknown') };
  } catch {
    return { kind: 'error', message: deletionErrorSentence('unknown') };
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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
}

export function DeleteBusinessDialog({ open, onOpenChange, accountId }: Props) {
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const [state, setState] = useState<PreviewState>({ kind: 'loading' });
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setState({ kind: 'loading' });
    void fetchPreview(accountId, next.signal).then((result) => {
      // A closed dialog or a newer request owns the state now.
      if (!next.signal.aborted) setState(result);
    });
  }, [accountId]);

  // A fresh preview every time the dialog opens: counts and refusals change.
  useEffect(() => {
    if (!open) return;
    load();
    return () => controller.current?.abort();
  }, [open, load]);

  // The disabled confirm always has a reason, in every state (SA/QA AD-1c).
  const statusText =
    state.kind === 'loading'
      ? `${DELETION_COPY.loading} ${DELETION_COPY.unavailablePrefix}${DELETION_COPY.reasonLoading}`
      : state.kind === 'ready'
        ? `${DELETION_COPY.unavailablePrefix}${state.preview.deletionUnavailableReason}`
        : `${DELETION_COPY.unavailablePrefix}${DELETION_COPY.reasonError}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="delete-business-dialog" className={DARK_DIALOG}>
        <DialogHeader>
          <DialogTitle className="!text-white">{DELETION_COPY.title}</DialogTitle>
          <DialogDescription className="!text-slate-400">{DELETION_COPY.description}</DialogDescription>
        </DialogHeader>

        {/* One live region for the dialog's whole life: loading, then the blocked state. */}
        <p
          id={reasonId}
          data-testid="deletion-status"
          role="status"
          aria-live="polite"
          className={
            state.kind === 'ready'
              ? 'rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100'
              : 'text-sm text-slate-400'
          }
        >
          {statusText}
        </p>

        {state.kind === 'error' && (
          <div className="space-y-3">
            <p data-testid="deletion-error" role="alert" className="text-sm text-rose-300">
              {state.message}
            </p>
            <Button type="button" variant="outline" onClick={load}>
              {DELETION_COPY.retry}
            </Button>
          </div>
        )}

        {state.kind === 'ready' && <PreviewBody preview={state.preview} />}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {DELETION_COPY.close}
          </Button>
          {/* Always disabled in AD-1 (SC-9): there is no commit route. */}
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
      </DialogContent>
    </Dialog>
  );
}

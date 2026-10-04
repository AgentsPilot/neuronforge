'use client';

/**
 * "Cancel item" for one queue item (ADMIN_BOS_CLEANUP slice 7b; FR-Q1, FR-Q3,
 * FR-Q7; SA C7-13, OP-13, W7B-5, W7B-7; workplan §2.7).
 *
 * The item list's ONE action, and the only request in this file: one POST, to
 * the action route, with exactly what the row showed (queue, id, status,
 * attempts) and the admin's reason. Pinned by
 * `app/admin/__tests__/jobsQueues.source.guard.test.ts`.
 *
 * WORDING (OP-13). The action is always "Cancel item" (the trigger and the
 * confirm button); the dismiss button is "Close", never "Cancel", so the two
 * cannot be confused. While busy the confirm reads "Cancelling…"; after any
 * outcome only "Close" remains.
 *
 * REFRESH ON CLOSE (deviation from the workplan's "refresh at once", recorded
 * in the workplan): the dialog lives in the item's own row, and a refreshed
 * list usually no longer has that row, which would unmount the dialog before
 * the admin read the outcome. So the outcome is shown first, and the page and
 * the list refresh (FR-Q7) when the dialog is closed after any outcome that may
 * have changed the item.
 *
 * Server error text is never shown: each outcome maps to a fixed sentence.
 * The one server value rendered is the 409's status label, and only when it
 * is one of the platform's own fixed labels.
 *
 * Imports from lib/admin/jobs and lib/cron are `import type` only (C-21).
 */

import { useId, useRef, useState } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createLogger } from '@/lib/logger';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import type { QueueItemView } from '@/lib/admin/jobs/jobsQueuesTypes';

const logger = createLogger({ module: 'AdminCancelQueueItemDialog' });

const DARK_DIALOG = '!border-slate-700 !bg-slate-900 !text-slate-100';
const REASON_MIN = 3;
const REASON_MAX = 500;

/** What happens next, per queue (workplan §1.3). Fixed text. */
const NEXT_STEP: Readonly<Record<BosQueueId, string>> = {
  payment_reminders:
    "The invoice is not changed. If it stays unpaid, a later reminder can still be scheduled under the business's reminder settings.",
  payment_automations: 'The automation rule is not changed; later events can still queue new runs.',
  daily_briefing_sends: 'No briefing goes to this business for that day. Other days are not affected.',
  lead_responses: 'This message is not queued again for the same lead.',
  insight_actions: 'The same action is not queued again in the same period.',
};

/**
 * The platform's own status labels: QUEUE_ITEM_STATUS_LABELS' values plus the
 * list's two extra labels, mirrored here because a client file may not import
 * that module at runtime (C-21). A test pins the two equal.
 */
export const KNOWN_STATUS_LABELS: ReadonlySet<string> = new Set([
  'Waiting',
  'In progress',
  'Failed',
  'Dead-lettered',
  'Sent',
  'Completed',
  'Skipped',
  'Cancelled',
  'Unrecognised status',
]);

type Outcome =
  | 'cancelled'
  | 'item_changed'
  | 'item_not_found'
  | 'leased'
  | 'not_cancellable_state'
  | 'invalid_input'
  | 'action_failed'
  | 'session'
  | 'unknown';

const UNKNOWN_SENTENCE =
  'The request did not complete, so the item may or may not have been cancelled. The list refreshes when you close this; check its status there.';

function sentenceFor(outcome: Exclude<Outcome, 'cancelled'>, currentLabel: string | null): string {
  switch (outcome) {
    case 'item_changed':
      return currentLabel
        ? `This item changed since the list was loaded (it is now ${currentLabel}). Nothing was cancelled.`
        : 'This item changed since the list was loaded. Nothing was cancelled.';
    case 'item_not_found':
      return 'This item is no longer in this queue. Nothing was cancelled.';
    case 'leased':
      return 'A run has picked this item up, so it cannot be cancelled now.';
    case 'not_cancellable_state':
      return 'This item can no longer be cancelled.';
    case 'invalid_input':
      // The reason field is hidden once an outcome shows, and the client already
      // enforces the 3-character reason, so a 400 cannot be fixed in place.
      return 'This request was not accepted. Nothing was cancelled. Close this and try again.';
    case 'action_failed':
      // The server answers action_failed only when a read fails before its
      // update, or after an update that matched no row, so this request wrote
      // nothing. The item may still have moved for another reason (a lost
      // race), so the list refreshes on Close.
      return 'Could not read the item just now. Nothing was cancelled.';
    case 'session':
      return 'Your admin session has ended. Sign in again.';
    default:
      return UNKNOWN_SENTENCE;
  }
}

/** Outcomes after which the item may have changed, so the page refreshes on Close. */
const REFRESH_AFTER: ReadonlySet<Outcome> = new Set<Outcome>([
  'cancelled',
  'item_changed',
  'item_not_found',
  'leased',
  'not_cancellable_state',
  'action_failed',
  'unknown',
]);

function codeOf(body: unknown): unknown {
  return body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
}

function classify(status: number, body: unknown): Outcome {
  if (status === 200) {
    const data = body && typeof body === 'object' ? (body as { success?: unknown; data?: { action?: unknown } }) : null;
    return data?.success === true && data.data?.action === 'cancel' ? 'cancelled' : 'unknown';
  }
  if (status === 401 || status === 403) return 'session';
  if (status === 400) return 'invalid_input';
  if (status === 404) return 'item_not_found';
  if (status === 409) return 'item_changed';
  if (status === 422) return codeOf(body) === 'leased' ? 'leased' : 'not_cancellable_state';
  if (status === 500 && codeOf(body) === 'action_failed') return 'action_failed';
  return 'unknown';
}

/** The 409's current label, only when it is one of the fixed labels. */
function currentLabelOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const current = (body as { current?: { statusLabel?: unknown } }).current;
  const label = current && typeof current === 'object' ? current.statusLabel : undefined;
  return typeof label === 'string' && KNOWN_STATUS_LABELS.has(label) ? label : null;
}

interface Props {
  queueId: BosQueueId;
  queueLabel: string;
  item: Pick<QueueItemView, 'id' | 'status' | 'statusLabel' | 'attempts' | 'kindLabel' | 'businessName' | 'lease'>;
  /** Refresh the page's figures and the open list. */
  onChanged: () => void;
}

export function CancelQueueItemDialog({ queueId, queueLabel, item, onChanged }: Props) {
  const reasonId = useId();
  const hintId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  // A second click before React re-renders the disabled button must not send twice.
  const inFlight = useRef(false);

  const canConfirm = !busy && outcome === null && reason.trim().length >= REASON_MIN;

  // While the call is in flight the dialog cannot be dismissed (Escape, a
  // click outside, Close or the corner close): the admin sees the outcome.
  const onOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next && outcome !== null && REFRESH_AFTER.has(outcome)) onChanged();
    setOpen(next);
    if (next) {
      setReason('');
      setOutcome(null);
      setCurrentLabel(null);
    }
  };

  const confirm = async () => {
    if (!canConfirm || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/jobs-queues/items/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queue: queueId,
          itemId: item.id,
          action: 'cancel',
          expected: { status: item.status, attempts: item.attempts },
          reason: reason.trim(),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      const kind = classify(response.status, body);
      if (kind !== 'cancelled') {
        logger.warn({ queue: queueId, status: response.status, kind }, 'Queue item cancel did not complete');
      }
      setCurrentLabel(kind === 'item_changed' ? currentLabelOf(body) : null);
      setOutcome(kind);
    } catch (err) {
      logger.error({ err, queue: queueId }, 'Queue item cancel request failed');
      setOutcome('unknown');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="whitespace-nowrap rounded border border-slate-600 px-2 py-0.5 text-xs text-slate-200 hover:bg-slate-700/50"
        >
          Cancel item
        </button>
      </DialogTrigger>
      <DialogContent
        data-testid="cancel-item-dialog"
        aria-label={`Cancel an item in ${queueLabel}`}
        className={DARK_DIALOG}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="!text-white">Cancel this item?</DialogTitle>
          <DialogDescription className="!text-slate-400">
            {item.kindLabel} for {item.businessName} · item {item.id.slice(0, 8)} · {item.statusLabel}
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>
            Cancelling closes this item for good. The queue will never pick it up or send it, and it cannot be re-sent
            afterwards.
          </li>
          <li>{NEXT_STEP[queueId]}</li>
          {item.lease === 'none' && <li>No run holds this item (no claim was recorded), so closing it is safe.</li>}
          <li>The business is not told. Your reason is kept in the admin audit trail.</li>
        </ul>

        {outcome === null && (
          <div className="space-y-1">
            <label htmlFor={reasonId} className="block text-xs font-medium text-slate-200">
              Why are you cancelling this item? (at least {REASON_MIN} characters)
            </label>
            <input
              id={reasonId}
              type="text"
              maxLength={REASON_MAX}
              value={reason}
              disabled={busy}
              aria-describedby={hintId}
              onChange={(event) => setReason(event.target.value)}
              className="w-full rounded border border-slate-600 bg-slate-900/60 px-3 py-2 text-sm text-white"
            />
            <p id={hintId} className="text-xs text-slate-500">
              Don&apos;t paste client details.
            </p>
          </div>
        )}

        {outcome === 'cancelled' && (
          <p data-testid="cancel-item-result" className="text-sm text-slate-200">
            Cancelled. The queue will not send it.
          </p>
        )}
        {outcome !== null && outcome !== 'cancelled' && (
          <p role="alert" className="text-sm text-red-300">
            {sentenceFor(outcome, currentLabel)}
          </p>
        )}

        <DialogFooter className="gap-2">
          <button
            type="button"
            data-testid="cancel-item-close"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/50 disabled:opacity-40"
          >
            Close
          </button>
          {outcome === null && (
            <button
              type="button"
              data-testid="cancel-item-confirm"
              onClick={() => void confirm()}
              disabled={!canConfirm}
              aria-busy={busy}
              className="rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Cancelling…' : 'Cancel item'}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

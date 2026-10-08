'use client';

/**
 * "Retry item" for one failed queue item (ADMIN_BOS_CLEANUP slice 7c; FR-Q1,
 * FR-Q3, FR-Q7; SA C7-13, OP-13, W7C-12; workplan §2.8).
 *
 * A retry ADDS one more send attempt to a real client (or, for the morning
 * briefing, to the business owner), so the dialog says plainly what can go
 * wrong before it asks for a reason: if an earlier attempt was actually
 * delivered but not recorded, the recipient may get it twice.
 *
 * The only request in this file: one POST, to the action route, with exactly
 * what the row showed (queue, id, status, attempts) and the admin's reason.
 * The client never sends a time: the server works out when the item may go
 * out. Pinned by `app/admin/__tests__/jobsQueues.source.guard.test.ts`.
 *
 * WORDING (OP-13). The action is always "Retry item" (the trigger and the
 * confirm button); the dismiss button is "Close". While busy the confirm reads
 * "Retrying…"; after any outcome only "Close" remains.
 *
 * REFRESH ON CLOSE (the 7b pattern, D-1): the outcome is shown first, and the
 * page and the list refresh when the dialog is closed after any outcome that
 * may have changed the item.
 *
 * Server error text is never shown: each outcome maps to a fixed sentence.
 * The server values rendered are the 409's status label (only one of the
 * platform's fixed labels) and two times (only when they parse as dates).
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
import { formatUtc } from './jobsFormat';
import { KNOWN_STATUS_LABELS } from './CancelQueueItemDialog';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import type { QueueItemView } from '@/lib/admin/jobs/jobsQueuesTypes';

const logger = createLogger({ module: 'AdminRetryQueueItemDialog' });

const DARK_DIALOG = '!border-slate-700 !bg-slate-900 !text-slate-100';
const REASON_MIN = 3;
const REASON_MAX = 500;

/** Who could receive a send twice: the briefing goes to the business owner, the rest to a client. */
function recipientOf(queueId: BosQueueId): string {
  return queueId === 'daily_briefing_sends' ? 'the business owner' : 'the client';
}

/**
 * Who sends it, and whether running the queue now from this page is sooner
 * (QA-3). A retried reminder waits for the business's next sending-hours time
 * (`next_attempt_at`), so running its queue now does not send it any sooner
 * while that time is still ahead; the other queues' retried items are due at
 * once. (The word for that button is not used here: the page guard forbids it.)
 */
function whenSent(queueId: BosQueueId): string {
  return queueId === 'payment_reminders'
    ? 'the queue sends it on a run at or after its next sending-hours time. Running this queue now from this page sends it sooner only if that time has already come.'
    : 'the queue sends it on its next run, or sooner if this queue is run now from this page.';
}

/** What happens next, per queue (workplan §2.8; OP-1, OP-9, OP-10). Fixed text. */
function nextStep(queueId: BosQueueId, due: QueueItemView['due']): string {
  switch (queueId) {
    case 'payment_reminders':
      return "It is sent at the next time inside the business's sending hours (08:00–20:00 in its time zone), on the hourly reminders run after that. If the invoice has been paid by then, it is not sent. If the business's next scheduled reminder for this invoice falls due meanwhile, the client may get both that day.";
    case 'daily_briefing_sends': {
      const day = due.basis === 'business_day' && due.date ? due.date : 'its business day';
      return `Only today: it is sent by the next hourly briefing run while it is still ${day} in the business's time zone, which may be well after the usual morning time. If no run happens before midnight there, it is closed without being sent. If the day's figures changed, writing it again uses AI, charged to the business at its normal rate.`;
    }
    case 'lead_responses':
      return 'It is sent on the next lead-replies run (every 5 minutes), after the queue checks again that the business still allows it and that it still applies (for example, the lead has not booked).';
    case 'insight_actions':
      return 'It is sent on the next run (every 15 minutes), after the queue checks the daily limit and the invoice or booking again.';
    default:
      // Payment automations are never retried; the list never offers this dialog there.
      return 'Items on this queue are never re-sent from here.';
  }
}

type Outcome =
  | 'retried'
  | 'item_changed'
  | 'item_not_found'
  | 'retry_window_passed'
  | 'briefing_not_today'
  | 'retry_held'
  | 'not_retryable'
  | 'invalid_input'
  | 'action_failed'
  | 'session'
  | 'unknown';

const UNKNOWN_SENTENCE =
  'The request did not complete, so the item may or may not have been put back in its queue. The list refreshes when you close this; check its status there.';

/** A server time, shown only when it really is one. */
function timeOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value)) ? value : null;
}

function sentenceFor(
  outcome: Exclude<Outcome, 'retried'>,
  queueId: BosQueueId,
  currentLabel: string | null,
  anchorAt: string | null
): string {
  switch (outcome) {
    case 'item_changed':
      return currentLabel
        ? `This item changed since the list was loaded (it is now ${currentLabel}). Nothing was retried.`
        : 'This item changed since the list was loaded. Nothing was retried.';
    case 'item_not_found':
      return 'This item is no longer in this queue. Nothing was retried.';
    case 'retry_window_passed':
      if (queueId === 'payment_reminders') {
        return anchorAt
          ? `This reminder was due ${formatUtc(anchorAt)}. Its next sending-hours time is more than 72 hours after that, so it can be cancelled but not retried.`
          : 'Its next sending-hours time is more than 72 hours after this reminder was due, so it can be cancelled but not retried.';
      }
      return anchorAt
        ? `This item was queued ${formatUtc(anchorAt)}, more than 72 hours ago, so it can be cancelled but not retried.`
        : 'This item was queued more than 72 hours ago, so it can be cancelled but not retried.';
    case 'briefing_not_today':
      return "This briefing's day has passed in the business's time zone, so it can be cancelled but not retried.";
    case 'retry_held':
      return 'Retrying lead replies is paused for now. Nothing was changed.';
    case 'not_retryable':
      return 'This item can no longer be retried.';
    case 'invalid_input':
      // The reason field is hidden once an outcome shows, and the client already
      // enforces the 3-character reason, so a 400 cannot be fixed in place.
      return 'This request was not accepted. Nothing was retried. Close this and try again.';
    case 'action_failed':
      // The server answers action_failed only before its update, or after an
      // update that matched no row, so this request wrote nothing.
      return 'Could not read the item just now. Nothing was retried.';
    case 'session':
      return 'Your admin session has ended. Sign in again.';
    default:
      return UNKNOWN_SENTENCE;
  }
}

/** Outcomes after which the item may have changed, so the page refreshes on Close. */
const REFRESH_AFTER: ReadonlySet<Outcome> = new Set<Outcome>([
  'retried',
  'item_changed',
  'item_not_found',
  'retry_window_passed',
  'briefing_not_today',
  'retry_held',
  'not_retryable',
  'action_failed',
  'unknown',
]);

function field(body: unknown, name: string): unknown {
  return body && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined;
}

function classify(status: number, body: unknown): Outcome {
  if (status === 200) {
    const data = field(body, 'data');
    return field(body, 'success') === true && field(data, 'action') === 'retry' ? 'retried' : 'unknown';
  }
  if (status === 401 || status === 403) return 'session';
  if (status === 400) return 'invalid_input';
  if (status === 404) return 'item_not_found';
  if (status === 409) return 'item_changed';
  if (status === 422) {
    const code = field(body, 'code');
    if (code === 'retry_window_passed' || code === 'briefing_not_today' || code === 'retry_held') return code;
    return 'not_retryable';
  }
  if (status === 500 && field(body, 'code') === 'action_failed') return 'action_failed';
  return 'unknown';
}

/** The 409's current label, only when it is one of the fixed labels. */
function currentLabelOf(body: unknown): string | null {
  const label = field(field(body, 'current'), 'statusLabel');
  return typeof label === 'string' && KNOWN_STATUS_LABELS.has(label) ? label : null;
}

interface Props {
  queueId: BosQueueId;
  queueLabel: string;
  item: Pick<QueueItemView, 'id' | 'status' | 'statusLabel' | 'attempts' | 'kindLabel' | 'businessName' | 'due'>;
  /** The list's "until …" words for this row, shown under the trigger. */
  windowNote: string;
  /** Refresh the page's figures and the open list. */
  onChanged: () => void;
}

export function RetryQueueItemDialog({ queueId, queueLabel, item, windowNote, onChanged }: Props) {
  const reasonId = useId();
  const hintId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [currentLabel, setCurrentLabel] = useState<string | null>(null);
  const [anchorAt, setAnchorAt] = useState<string | null>(null);
  const [nextAt, setNextAt] = useState<string | null>(null);
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
      setAnchorAt(null);
      setNextAt(null);
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
          action: 'retry',
          expected: { status: item.status, attempts: item.attempts },
          reason: reason.trim(),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      const kind = classify(response.status, body);
      if (kind !== 'retried') {
        logger.warn({ queue: queueId, status: response.status, kind }, 'Queue item retry did not complete');
      }
      setCurrentLabel(kind === 'item_changed' ? currentLabelOf(body) : null);
      setAnchorAt(kind === 'retry_window_passed' ? timeOrNull(field(body, 'anchorAt')) : null);
      setNextAt(kind === 'retried' ? timeOrNull(field(field(body, 'data'), 'nextAttemptAt')) : null);
      setOutcome(kind);
    } catch (err) {
      logger.error({ err, queue: queueId }, 'Queue item retry request failed');
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
          Retry item
        </button>
      </DialogTrigger>
      <span data-testid="retry-window-note" className="mt-0.5 block text-[11px] text-slate-400">
        {windowNote}
      </span>
      <DialogContent
        data-testid="retry-item-dialog"
        aria-label={`Retry an item in ${queueLabel}`}
        className={DARK_DIALOG}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="!text-white">Retry this item?</DialogTitle>
          <DialogDescription className="!text-slate-400">
            {item.kindLabel} for {item.businessName} · item {item.id.slice(0, 8)} · {item.statusLabel} · {item.attempts}{' '}
            attempts so far
          </DialogDescription>
        </DialogHeader>

        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
          <li>
            Retrying puts this item back in its queue for <strong>one more try</strong>. Nothing is sent from here:{' '}
            {whenSent(queueId)} If it fails again, it is closed as failed.
          </li>
          <li>{nextStep(queueId, item.due)}</li>
          <li>The business is not told. Your reason is kept in the admin audit trail.</li>
        </ul>

        <p
          data-testid="retry-item-risk"
          className="rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
        >
          If an earlier attempt was actually delivered but not recorded, <strong>{recipientOf(queueId)}</strong> may
          receive it twice.
        </p>

        {outcome === null && (
          <div className="space-y-1">
            <label htmlFor={reasonId} className="block text-xs font-medium text-slate-200">
              Why are you retrying this item? (at least {REASON_MIN} characters)
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

        {outcome === 'retried' && (
          <p data-testid="retry-item-result" className="text-sm text-slate-200">
            Queued for one more try. The queue sends it on its next run.
            {queueId === 'payment_reminders' && nextAt ? ` Not before ${formatUtc(nextAt)} (the business's sending hours).` : ''}
          </p>
        )}
        {outcome !== null && outcome !== 'retried' && (
          <p role="alert" className="text-sm text-red-300">
            {sentenceFor(outcome, queueId, currentLabel, anchorAt)}
          </p>
        )}

        <DialogFooter className="gap-2">
          <button
            type="button"
            data-testid="retry-item-close"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/50 disabled:opacity-40"
          >
            Close
          </button>
          {outcome === null && (
            <button
              type="button"
              data-testid="retry-item-confirm"
              onClick={() => void confirm()}
              disabled={!canConfirm}
              aria-busy={busy}
              className="rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Retrying…' : 'Retry item'}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

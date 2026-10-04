'use client';

/**
 * "Drain now" for one Business OS queue (ADMIN_BOS_CLEANUP slice 7d; FR-Q2,
 * FR-Q3, FR-Q7; SA C7-13, W7D-2, W7D-7, W7D-8).
 *
 * The ONE action on the Scheduled jobs & queues page, and the only request
 * this page makes besides its read: one POST, to the drain route, with the
 * queue and a reason. Pinned by `app/admin/__tests__/jobsQueues.source.guard.test.ts`.
 *
 * The copy says exactly what the drain does and does not do, per queue. It is
 * fixed text: nothing from a queue row is shown. On a result the parent
 * refreshes the page, so the new figures show (FR-Q7). Server error text is
 * never shown; each outcome maps to a plain sentence.
 *
 * Imports from lib/admin/jobs and lib/cron are `import type` only (C-21).
 * The shared Dialog primitive falls back to light colours on the admin shell;
 * the `!` classes override that (the ArchiveConfirmDialog precedent).
 */

import { useId, useState } from 'react';

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
import type { DrainCount, DrainResult } from '@/lib/admin/jobs/jobsQueuesTypes';

const logger = createLogger({ module: 'AdminDrainNowDialog' });

const DARK_DIALOG = '!border-slate-700 !bg-slate-900 !text-slate-100';
const REASON_MIN = 3;
const REASON_MAX = 500;

const ALSO_QUEUES = 'It also queues what has just become due, the same as the scheduled run.';

interface QueueCopy {
  /** Extra lines about what this queue's drain also does. */
  does: readonly string[];
  /** Extra lines about what it does not do. */
  doesNot: readonly string[];
}

/**
 * Per-queue copy (W7D-7). Exhaustive over BosQueueId, and also the typed
 * lookup that narrows a page queue id to a BosQueueId (W7D-8).
 */
const QUEUE_COPY: Readonly<Record<BosQueueId, QueueCopy>> = {
  payment_reminders: {
    does: [],
    doesNot: [
      'It does not bill plan stages, look for newly overdue invoices or mark invoices overdue. Those stay with the scheduled job.',
    ],
  },
  payment_automations: {
    does: [],
    doesNot: ['It does not retry card payments.'],
  },
  daily_briefing_sends: {
    does: [
      `${ALSO_QUEUES} Only businesses in their own local morning (07:00–10:59) are queued.`,
      "Writing a briefing uses AI and is charged to that business's credits, as on the scheduled run. A briefing already written today is reused.",
    ],
    doesNot: [],
  },
  lead_responses: {
    does: [ALSO_QUEUES],
    doesNot: [],
  },
  insight_actions: {
    does: [],
    doesNot: [],
  },
};

const SHARED_DOES_NOT = [
  'It does not re-send failed or dead-lettered items.',
  'It does not touch items scheduled for later.',
  "It does not record a run of the scheduled job, so the job's status still shows when Vercel last ran it.",
] as const;

/** True for the five queue ids, narrowing a page id with no cast (W7D-8). */
export function isDrainQueueId(id: string): id is BosQueueId {
  return Object.prototype.hasOwnProperty.call(QUEUE_COPY, id);
}

type Problem = 'invalid_input' | 'session' | 'timed_out' | 'drain_failed' | 'unknown';

const PROBLEM_TEXT: Record<Problem, string> = {
  invalid_input: 'Give a reason of at least 3 characters, then try again.',
  session: 'Your admin session has ended. Sign in again.',
  timed_out:
    'It ran out of time. Anything it did not reach is picked up by the next run. Wait a few minutes before pressing again.',
  drain_failed: 'The drain stopped with an error. Some items may already have been sent. Check the queue counts.',
  unknown: 'The request did not complete, so the drain may or may not have run. Check the queue counts before pressing again.',
};

/** Outcomes after which items may have moved, so the page refreshes. */
const REFRESH_AFTER: ReadonlySet<Problem> = new Set<Problem>(['timed_out', 'drain_failed', 'unknown']);

function isDrainResult(value: unknown): value is { success: true; data: DrainResult } {
  if (!value || typeof value !== 'object') return false;
  const { success, data } = value as { success?: unknown; data?: Partial<DrainResult> };
  return success === true && !!data && Array.isArray(data.counts) && typeof data.durationMs === 'number';
}

function classify(status: number, body: unknown): Problem {
  if (status === 401 || status === 403) return 'session';
  // A platform time-out answers 504, often with an HTML page (not JSON).
  if (status === 504 || body === null) return 'timed_out';
  const code = body && typeof body === 'object' ? (body as { code?: unknown }).code : undefined;
  if (code === 'invalid_input') return 'invalid_input';
  if (code === 'drain_failed') return 'drain_failed';
  return 'unknown';
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

interface Props {
  queueId: BosQueueId;
  queueLabel: string;
  drainedByLabel: string;
  /** Refresh the page's figures. */
  onDrained: () => void;
}

export function DrainNowDialog({ queueId, queueLabel, drainedByLabel, onDrained }: Props) {
  const reasonId = useId();
  const hintId = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ counts: DrainCount[]; durationMs: number } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const copy = QUEUE_COPY[queueId];
  const canConfirm = !busy && !result && reason.trim().length >= REASON_MIN;

  // While the call is in flight the dialog cannot be dismissed (Escape, a
  // click outside, Cancel or the corner close): the admin sees the outcome.
  const onOpenChange = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (next) {
      setReason('');
      setResult(null);
      setProblem(null);
    }
  };

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    setProblem(null);
    try {
      const response = await fetch('/api/admin/jobs-queues/drain', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ queue: queueId, reason: reason.trim() }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok && isDrainResult(body)) {
        setResult({ counts: body.data.counts, durationMs: body.data.durationMs });
        onDrained();
        return;
      }
      const kind = classify(response.status, body);
      logger.warn({ queue: queueId, status: response.status, kind }, 'Drain now did not complete');
      setProblem(kind);
      if (REFRESH_AFTER.has(kind)) onDrained();
    } catch (err) {
      logger.error({ err, queue: queueId }, 'Drain now request failed');
      setProblem('unknown');
      onDrained();
    } finally {
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
          Drain now
        </button>
      </DialogTrigger>
      <DialogContent
        data-testid="drain-dialog"
        className={DARK_DIALOG}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="!text-white">Drain {queueLabel} now?</DialogTitle>
          <DialogDescription className="!text-slate-400">
            Runs this queue&apos;s scheduled step now, the same one {drainedByLabel} runs: it recovers items whose
            run died, picks up items that are due, and processes them. Each item is checked again before it goes
            out.
          </DialogDescription>
        </DialogHeader>

        {copy.does.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-300">
            {copy.does.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-400">
          {[...SHARED_DOES_NOT, ...copy.doesNot].map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {!result && (
          <div className="space-y-1">
            <label htmlFor={reasonId} className="block text-xs font-medium text-slate-200">
              Why are you draining this queue? (at least {REASON_MIN} characters)
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

        {result && (
          <div data-testid="drain-result" className="space-y-1 text-sm text-slate-200">
            {result.counts.length > 0 ? (
              <>
                <p>Done in {seconds(result.durationMs)}.</p>
                <ul className="list-disc pl-5">
                  {result.counts.map((c) => (
                    <li key={c.key}>
                      {c.label}: {c.value}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p>Finished. This queue&apos;s drain reports no counts; the refreshed figures below show what changed.</p>
                <p className="text-xs text-slate-400">Took {seconds(result.durationMs)}.</p>
              </>
            )}
          </div>
        )}

        {problem && (
          <p role="alert" className="text-sm text-red-300">
            {PROBLEM_TEXT[problem]}
          </p>
        )}

        <DialogFooter className="gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={busy}
            className="rounded border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700/50 disabled:opacity-40"
          >
            {result ? 'Close' : 'Cancel'}
          </button>
          {!result && (
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={!canConfirm}
              aria-busy={busy}
              className="rounded bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Draining…' : 'Confirm'}
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

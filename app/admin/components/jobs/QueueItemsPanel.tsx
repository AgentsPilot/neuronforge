'use client';

/**
 * The read-only item list of one queue on Scheduled jobs & queues
 * (ADMIN_BOS_CLEANUP slice 7a; FR-Q5, FR-Q6, FR-Q7; SA C7-13; workplan §2.7 and
 * conditions W7A-2, W7A-4, W7A-5, W7A-7(c), W7A-10).
 *
 * READ-ONLY. Its one request is a GET to the items route, with the queue, the
 * state and the page only. Its only buttons are the four state tabs and
 * Previous / Next. The re-send and cancellable columns are marks computed on
 * the server by the shared eligibility function; there is no action here
 * (7b/7c add them). Pinned by app/admin/__tests__/jobsQueues.source.guard.test.ts.
 *
 * It renders only what the route sent: fixed labels, the platform's status
 * words, times and counts. Server error text is never shown; each outcome
 * maps to a fixed sentence.
 *
 * Races (W7A-5): every request has its own AbortController, aborted when the
 * queue, tab, page or refresh changes and on unmount, so an older response can
 * never overwrite a newer one. An aborted request is not an error.
 *
 * Past the end (W7A-2): a list that shrank under an open panel (a drain, say)
 * comes back as `total: null`; the panel goes back to page 1. A new
 * `refreshKey` also resets to page 1.
 *
 * Imports from lib/admin/jobs and lib/cron are `import type` only (C-21).
 */

import { useEffect, useState } from 'react';

import { createLogger } from '@/lib/logger';
import { ageWords, formatUtc } from './jobsFormat';
import type { BosQueueId } from '@/lib/cron/bosCronJobs';
import type { QueueItemState, QueueItemView, QueueItemsView } from '@/lib/admin/jobs/jobsQueuesTypes';

const logger = createLogger({ module: 'AdminQueueItemsPanel' });

const TABS: ReadonlyArray<{ state: QueueItemState; label: string }> = [
  { state: 'stuck', label: 'Stuck' },
  { state: 'failed', label: 'Failed' },
  { state: 'dead_lettered', label: 'Dead-lettered' },
  { state: 'waiting', label: 'Waiting' },
];

const LOAD_FAILED = 'Could not load the items. Try again in a moment.';
const SESSION_ENDED = 'Your admin session has ended. Sign in again.';

/** What a failed or dead-lettered age is counted from, per queue (W7A-4). */
function ageAnchorSentence(queueId: BosQueueId): string {
  if (queueId === 'daily_briefing_sends') return 'from when their business day began';
  if (queueId === 'lead_responses' || queueId === 'insight_actions') return 'from when they were queued';
  return 'from when they were due';
}

function dueWords(item: QueueItemView): string {
  let words: string;
  if (item.due.basis === 'scheduled') words = item.due.at ? formatUtc(item.due.at) : 'no due time';
  else if (item.due.basis === 'business_day') words = item.due.date ? `business day ${item.due.date}` : 'no business day recorded';
  else words = `queued ${formatUtc(item.due.at)}`;
  return item.nextAttemptAt ? `${words} · next try ${formatUtc(item.nextAttemptAt)}` : words;
}

function ageText(item: QueueItemView): string {
  const { minutes, basis } = item.age;
  if (basis === 'no_lease') return 'no lease recorded';
  if (minutes === null) return 'no due time';
  if (minutes < 0) return `due in ${ageWords(-minutes)}`;
  switch (basis) {
    case 'since_claimed':
      return `stuck ${ageWords(minutes)} (claimed)`;
    case 'since_due':
      return `${ageWords(minutes)} since it was due`;
    case 'since_queued':
      return `${ageWords(minutes)} since it was queued`;
    case 'since_day_start':
      return `${ageWords(minutes)} since its business day began`;
    default:
      return `overdue by ${ageWords(minutes)}`;
  }
}

function resendWords(queueId: BosQueueId, item: QueueItemView): string {
  const { retry } = item;
  if (retry.allowed) {
    // The briefing's end is the next day's first instant: exclusive (W7A-7(c)).
    if (queueId === 'daily_briefing_sends') return `until its business day ends (${formatUtc(retry.until)})`;
    // 7c also needs a time inside the business's sending hours (C7-8, OP-7).
    if (queueId === 'payment_reminders') return `until ${formatUtc(retry.until)} (within the business's sending hours)`;
    return `until ${formatUtc(retry.until)}`;
  }
  switch (retry.code) {
    case 'retry_window_passed':
      return queueId === 'payment_reminders' ? 'no: due more than 72 h ago' : 'no: queued more than 72 h ago';
    case 'briefing_not_today':
      return "no: the briefing's day has passed";
    case 'retry_not_offered':
      return 'no: never re-sent on this queue';
    case 'no_due_time':
      return 'no: no due time recorded';
    default:
      return item.cancel.allowed === false && item.cancel.code === 'leased' ? leasedWords(item) : 'no';
  }
}

/**
 * CR7A-3: a claimed row on the Stuck tab is past the stuck threshold, so its
 * run is presumed dead; "a run holds it" would say the opposite. The queue's
 * own sweep is what releases it, so the words say that.
 */
function leasedWords(item: QueueItemView): string {
  return item.lease === 'expired' ? "no: claimed by a run; the queue's own sweep releases it" : 'no: a run holds it';
}

function cancellableWords(item: QueueItemView): string {
  if (item.cancel.allowed) return 'yes';
  return item.cancel.code === 'leased' ? leasedWords(item) : 'no';
}

export function QueueItemsPanel({
  queueId,
  queueLabel,
  refreshKey,
}: {
  queueId: BosQueueId;
  queueLabel: string;
  refreshKey: number;
}) {
  const [tab, setTab] = useState<QueueItemState>('stuck');
  // The page, with the refreshKey it was chosen under: a new refreshKey means
  // page 1 again (W7A-2). Adjusted during render, React's documented pattern
  // for resetting state on a prop change, so only one request is made.
  const [paging, setPaging] = useState({ page: 1, refreshKey });
  if (paging.refreshKey !== refreshKey) setPaging({ page: 1, refreshKey });
  const page = paging.refreshKey === refreshKey ? paging.page : 1;

  const [data, setData] = useState<QueueItemsView | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ queue: queueId, state: tab, page: String(page) });
    setLoading(true);
    setFailure(null);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/jobs-queues/items?${params}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = (await response.json().catch(() => null)) as
          | { success: true; data: QueueItemsView }
          | { success: false }
          | null;
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) {
          setData(null);
          setFailure(SESSION_ENDED);
          return;
        }
        if (!response.ok || !body || body.success !== true) {
          throw new Error(`Queue items request failed with status ${response.status}`);
        }
        if (body.data.total === null && page > 1) {
          // Past the end: the list shrank. Back to page 1, once.
          setPaging((current) => ({ ...current, page: 1 }));
          return;
        }
        setData(body.data);
      } catch (err) {
        if (controller.signal.aborted) return; // superseded or unmounted: not an error
        logger.error({ err, queue: queueId, state: tab }, 'Queue items request failed');
        setData(null);
        setFailure(LOAD_FAILED);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [queueId, tab, page, refreshKey]);

  const chooseTab = (state: QueueItemState) => {
    if (state === tab) return;
    setData(null);
    setTab(state);
    setPaging((current) => ({ ...current, page: 1 }));
  };
  const goTo = (next: number) => setPaging((current) => ({ ...current, page: next }));

  const items = data?.items ?? [];
  const total = data?.total ?? null;
  const first = data ? (data.page - 1) * data.pageSize + 1 : 0;
  const last = data ? first + items.length - 1 : 0;
  // CR7A-2: only the first maxPage x pageSize items can be paged to; say so.
  const listCap = data ? data.maxPage * data.pageSize : 0;
  const capNote = total !== null && total > listCap ? ` (first ${listCap.toLocaleString('en-US')} shown)` : '';

  return (
    <section
      id={`queue-items-${queueId}`}
      data-testid={`queue-items-${queueId}`}
      aria-label={`${queueLabel} items`}
      aria-busy={loading}
      className="mt-2 space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3"
    >
      <p className="text-xs text-slate-400">
        Read-only. Re-send and cancel come in a later release; these columns show which items would qualify. Failed
        items keep no failure time, so their age is counted {ageAnchorSentence(queueId)}.
      </p>

      <div role="group" aria-label="Item state" className="flex flex-wrap gap-1">
        {TABS.map(({ state, label }) => (
          <button
            key={state}
            type="button"
            aria-pressed={tab === state}
            onClick={() => chooseTab(state)}
            className={`rounded border px-2 py-0.5 text-xs ${
              tab === state ? 'border-amber-500/40 bg-amber-500/15 text-amber-200' : 'border-slate-600 bg-slate-800 text-slate-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {failure && (
        <p role="alert" data-testid="queue-items-error" className="text-xs text-amber-300">
          {failure}
        </p>
      )}
      {!failure && loading && !data && <p className="text-xs text-slate-400">Loading…</p>}
      {!failure && data && items.length === 0 && (
        <p data-testid="queue-items-empty" className="text-xs text-slate-400">
          No items in this state.
        </p>
      )}

      {!failure && items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="uppercase tracking-wide text-slate-500">
              <tr>
                <th className="pb-1 pr-3 font-normal">Business</th>
                <th className="pb-1 pr-3 font-normal">Item</th>
                <th className="pb-1 pr-3 font-normal">Kind</th>
                <th className="pb-1 pr-3 font-normal">Status</th>
                <th className="pb-1 pr-3 font-normal">Due</th>
                <th className="pb-1 pr-3 font-normal">Attempts</th>
                <th className="pb-1 pr-3 font-normal">Age</th>
                <th className="pb-1 pr-3 font-normal">Re-send</th>
                <th className="pb-1 font-normal">Cancellable</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} data-testid="queue-item-row" className="border-t border-slate-700/60 align-top text-slate-300">
                  <td className="py-1 pr-3 text-slate-200">{item.businessName}</td>
                  <td className="py-1 pr-3 font-mono" title={item.id}>
                    {item.id.slice(0, 8)}
                  </td>
                  <td className="py-1 pr-3">{item.kindLabel}</td>
                  <td className="py-1 pr-3">{item.statusLabel}</td>
                  <td className="py-1 pr-3">{dueWords(item)}</td>
                  <td className="py-1 pr-3">{item.attempts}</td>
                  <td className="py-1 pr-3">{ageText(item)}</td>
                  <td className="py-1 pr-3">{resendWords(queueId, item)}</td>
                  <td className="py-1">{cancellableWords(item)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
        <span data-testid="queue-items-showing">
          {!failure && data && total !== null && items.length > 0 ? `Showing ${first}–${last} of ${total}${capNote}` : ''}
        </span>
        <span className="flex gap-1">
          <button
            type="button"
            onClick={() => goTo(page - 1)}
            disabled={loading || page <= 1}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-slate-300 disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => goTo(page + 1)}
            disabled={loading || !data?.hasMore}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-slate-300 disabled:opacity-50"
          >
            Next
          </button>
        </span>
      </div>
    </section>
  );
}

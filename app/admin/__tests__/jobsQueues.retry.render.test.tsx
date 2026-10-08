/**
 * @jest-environment jsdom
 */

/**
 * "Retry item" on a queue's item list (ADMIN_BOS_CLEANUP slice 7c; workplan
 * §2.8, §5.15 U-1..U-12; SA W7C-12, OP-13).
 *
 * What would mislead an admin if it were wrong: a button on a row that cannot
 * be retried; a confirm that does not need a reason; no warning that the
 * recipient may get it twice (or a warning naming the wrong recipient); a
 * dismiss button that says "Cancel"; two requests from a double click; a body
 * that carries a time, an owner or an account; server text shown verbatim; a
 * success that claims the item was sent; and a list that does not refresh
 * after the outcome.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockLoggerWarn = jest.fn();
const mockLoggerError = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: (...a: unknown[]) => mockLoggerWarn(...a),
    error: (...a: unknown[]) => mockLoggerError(...a),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

import AdminJobsQueuesPage from '../jobs-queues/page';
import { RetryQueueItemDialog } from '../components/jobs/RetryQueueItemDialog';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { CronRunSummaryRow } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { JobsQueuesView, QueueItemView, QueueItemsView, QueueItemState } from '@/lib/admin/jobs/jobsQueuesTypes';
import { BOS_QUEUES, type BosQueueId } from '@/lib/cron/bosCronJobs';
import { quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.setPointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

jest.setTimeout(20000);

const NOW = new Date('2026-10-04T12:00:00.000Z');
const ACTION_URL = '/api/admin/jobs-queues/items/action';
const ITEMS_PREFIX = '/api/admin/jobs-queues/items?';
const JOBS_URL = '/api/admin/jobs-queues';
const UNKNOWN =
  'The request did not complete, so the item may or may not have been put back in its queue. The list refreshes when you close this; check its status there.';

function item(overrides: Partial<QueueItemView> = {}): QueueItemView {
  return {
    id: 'abcdef12-3456-4789-8abc-def012345678',
    businessName: 'Acme Plumbing',
    kindLabel: 'Follow-up to a lead',
    status: 'failed',
    statusLabel: 'Failed',
    state: 'dead_lettered',
    errorCategory: 'dead_lettered',
    attempts: 3,
    due: { basis: 'queued', at: '2026-10-04T08:00:00.000Z' },
    nextAttemptAt: null,
    age: { minutes: 240, basis: 'since_queued' },
    lease: null,
    retry: { allowed: true, until: '2026-10-07T08:00:00.000Z' },
    cancel: { allowed: true },
    ...overrides,
  };
}

type Reply = { status: number; body: unknown };
let actionReply: () => Reply | Promise<Reply>;
let fetchMock: jest.Mock;

function installFetch(itemsFor: (params: URLSearchParams) => QueueItemView[] = () => [item()]) {
  fetchMock = jest.fn(async (url: string) => {
    if (url === ACTION_URL) {
      const reply = await actionReply();
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => {
          if (reply.body === null) throw new SyntaxError('Unexpected token < in JSON');
          return reply.body;
        },
      };
    }
    if (url.startsWith(ITEMS_PREFIX)) {
      const params = new URLSearchParams(url.slice(ITEMS_PREFIX.length));
      const items = itemsFor(params);
      const data: QueueItemsView = {
        queue: params.get('queue')!,
        state: params.get('state') as QueueItemState,
        now: NOW.toISOString(),
        page: 1,
        pageSize: 50,
        maxPage: 20,
        total: items.length,
        hasMore: false,
        items,
      };
      return { ok: true, status: 200, json: async () => ({ success: true, data }) };
    }
    const view: JobsQueuesView = buildJobsQueuesView(
      {
        runs: { state: 'ok', rows: quietSummaryRows(NOW) as CronRunSummaryRow[] },
        queues: Object.fromEntries(BOS_QUEUES.map((q) => [q.id, { ok: true as const, figures: quietQueueFigures() }])),
      },
      NOW
    );
    return { ok: true, status: 200, json: async () => ({ success: true, data: view }) };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

const actionCalls = () => fetchMock.mock.calls.filter(([url]) => url === ACTION_URL);
const itemCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(ITEMS_PREFIX));
const jobsCalls = () => fetchMock.mock.calls.filter(([url]) => url === JOBS_URL);

function success(queue: BosQueueId, nextAttemptAt: string | null): Reply {
  return {
    status: 200,
    body: {
      success: true,
      data: {
        queue,
        itemId: item().id,
        action: 'retry',
        before: { status: 'failed', statusLabel: 'Failed' },
        after: { status: 'pending', statusLabel: 'Waiting' },
        nextAttemptAt,
      },
    },
  };
}

async function openDialog(queueId: BosQueueId = 'lead_responses', overrides: Partial<QueueItemView> = {}) {
  const onChanged = jest.fn();
  const user = userEvent.setup();
  render(
    <RetryQueueItemDialog
      queueId={queueId}
      queueLabel="Lead replies"
      item={item(overrides)}
      windowNote="until 2026-10-07 08:00 UTC"
      onChanged={onChanged}
    />
  );
  await user.click(screen.getByRole('button', { name: 'Retry item' }));
  const dialog = await screen.findByTestId('retry-item-dialog');
  return { user, dialog, onChanged };
}

const footerClose = (dialog: HTMLElement) => within(dialog).getByTestId('retry-item-close');
const confirmButton = (dialog: HTMLElement) => within(dialog).queryByTestId('retry-item-confirm');

async function confirmWith(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, reason = 'client asked again') {
  await user.type(within(dialog).getByLabelText(/Why are you retrying this item/), reason);
  await user.click(confirmButton(dialog)!);
}

beforeEach(() => {
  jest.clearAllMocks();
  actionReply = () => success('lead_responses', null);
  installFetch();
});

// ─────────────────────────────────────────────────────────────────────────
describe('U-1: the trigger, only on a re-sendable row, in its Re-send cell', () => {
  it('one "Retry item" per allowed row, with the "until …" words under it; refused rows keep the 7a words; Cancel cells unchanged', async () => {
    installFetch(() => [
      item(),
      item({ id: '22222222-aaaa-4bbb-8ccc-dddddddddddd', retry: { allowed: false, code: 'retry_window_passed' } }),
      item({ id: '33333333-aaaa-4bbb-8ccc-dddddddddddd', retry: { allowed: false, code: 'briefing_not_today' } }),
      item({ id: '44444444-aaaa-4bbb-8ccc-dddddddddddd', retry: { allowed: false, code: 'retry_held' }, cancel: { allowed: false, code: 'not_cancellable_state' } }),
    ]);
    render(<AdminJobsQueuesPage />);
    fireEvent.click(within(await screen.findByTestId('queue-lead_responses')).getByRole('button', { name: 'View items' }));
    const panel = await screen.findByTestId('queue-items-lead_responses');
    await waitFor(() => expect(within(panel).getAllByTestId('queue-item-row')).toHaveLength(4));
    const rows = within(panel).getAllByTestId('queue-item-row');
    expect(within(panel).getAllByRole('button', { name: 'Retry item' })).toHaveLength(1);
    const cells0 = rows[0].querySelectorAll('td');
    const resend0 = cells0[cells0.length - 2] as HTMLElement;
    expect(within(resend0).getByRole('button', { name: 'Retry item' })).toBeInTheDocument();
    expect(within(resend0).getByTestId('retry-window-note').textContent).toBe('until 2026-10-07 08:00 UTC');
    const resendText = (row: HTMLElement) => {
      const cells = row.querySelectorAll('td');
      return cells[cells.length - 2].textContent;
    };
    expect(resendText(rows[1])).toBe('no: queued more than 72 h ago');
    expect(resendText(rows[2])).toBe("no: the briefing's day has passed");
    expect(resendText(rows[3])).toBe('no: paused on this queue for now');
    expect(within(panel).getAllByRole('button', { name: 'Cancel item' })).toHaveLength(3);
    // Opening nothing makes no request (M-4).
    expect(actionCalls()).toHaveLength(0);
  });

  it('payment automations: never a Retry item button', async () => {
    installFetch((params) =>
      params.get('queue') === 'payment_automations' ? [item({ retry: { allowed: false, code: 'retry_not_offered' } })] : [item()]
    );
    render(<AdminJobsQueuesPage />);
    fireEvent.click(within(await screen.findByTestId('queue-payment_automations')).getByRole('button', { name: 'View items' }));
    const panel = await screen.findByTestId('queue-items-payment_automations');
    await within(panel).findByTestId('queue-item-row');
    expect(within(panel).queryByRole('button', { name: 'Retry item' })).toBeNull();
    expect(within(panel).getByTestId('queue-item-row').textContent).toContain('no: never re-sent on this queue');
  });
});

describe('U-2 / U-3: the dialog copy and the reason', () => {
  it('U-2 title, description with attempts, "one more try", the business is not told; Confirm disabled; dismiss is Close; no button reads Cancel', async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Retry this item?' })).toBeInTheDocument();
    expect(dialog.textContent).toContain('Follow-up to a lead for Acme Plumbing · item abcdef12 · Failed · 3 attempts so far');
    expect(dialog.textContent).not.toContain('abcdef12-3456');
    expect(dialog.textContent).toContain('Retrying puts this item back in its queue for one more try. Nothing is sent from here');
    expect(dialog.textContent).toContain('If it fails again, it is closed as failed.');
    expect(dialog.textContent).toContain('The business is not told. Your reason is kept in the admin audit trail.');
    expect(confirmButton(dialog)).toBeDisabled();
    expect(confirmButton(dialog)).toHaveTextContent('Retry item');
    expect(footerClose(dialog)).toHaveTextContent('Close');
    for (const button of within(dialog).getAllByRole('button')) expect(button.textContent?.trim()).not.toMatch(/^Cancel/);
    expect(actionCalls()).toHaveLength(0);
  });

  it.each([
    ['payment_reminders', 'the client', "sending hours (08:00–20:00 in its time zone)"],
    ['lead_responses', 'the client', 'lead-replies run (every 5 minutes)'],
    ['insight_actions', 'the client', 'next run (every 15 minutes)'],
    ['daily_briefing_sends', 'the business owner', 'Only today'],
  ] as const)('U-2 %s: the known-risk warning names %s; its own next step', async (queue, recipient, step) => {
    const { dialog } = await openDialog(queue, queue === 'daily_briefing_sends' ? { due: { basis: 'business_day', date: '2026-10-04' } } : {});
    const risk = within(dialog).getByTestId('retry-item-risk');
    expect(risk.textContent).toBe(`If an earlier attempt was actually delivered but not recorded, ${recipient} may receive it twice.`);
    expect(dialog.textContent).toContain(step);
    if (queue !== 'daily_briefing_sends') expect(risk.textContent).not.toContain('business owner');
  });

  // QA-3: a retried reminder waits for its next sending-hours time, so "sooner
  // if run now" is true only once that time has come; the other queues' items
  // are due at once.
  it('U-2 reminders: running the queue now is sooner only once the sending-hours time has come (QA-3)', async () => {
    const { dialog } = await openDialog('payment_reminders');
    expect(dialog.textContent).toContain(
      'Nothing is sent from here: the queue sends it on a run at or after its next sending-hours time. Running this queue now from this page sends it sooner only if that time has already come. If it fails again, it is closed as failed.'
    );
    expect(dialog.textContent).not.toContain('or sooner if this queue is run now from this page');
  });

  it.each(['lead_responses', 'insight_actions', 'daily_briefing_sends'] as const)(
    'U-2 %s: sent on the next run, or sooner if the queue is run now (QA-3)',
    async (queue) => {
      const { dialog } = await openDialog(queue, queue === 'daily_briefing_sends' ? { due: { basis: 'business_day', date: '2026-10-04' } } : {});
      expect(dialog.textContent).toContain(
        'Nothing is sent from here: the queue sends it on its next run, or sooner if this queue is run now from this page. If it fails again, it is closed as failed.'
      );
      expect(dialog.textContent).not.toContain('sending-hours time has already come');
    }
  );

  it('U-2 reminders: the same-day chase note (OP-10)', async () => {
    const { dialog } = await openDialog('payment_reminders');
    expect(dialog.textContent).toContain(
      "If the business's next scheduled reminder for this invoice falls due meanwhile, the client may get both that day."
    );
    expect(dialog.textContent).toContain('If the invoice has been paid by then, it is not sent.');
  });

  it('U-2 briefing: only today (its date), closed unsent after midnight, and the AI cost sentence; the other queues have no AI sentence', async () => {
    const { dialog } = await openDialog('daily_briefing_sends', { due: { basis: 'business_day', date: '2026-10-04' } });
    expect(dialog.textContent).toContain("while it is still 2026-10-04 in the business's time zone");
    expect(dialog.textContent).toContain('If no run happens before midnight there, it is closed without being sent.');
    expect(dialog.textContent).toContain("If the day's figures changed, writing it again uses AI, charged to the business at its normal rate.");
  });

  it.each(['payment_reminders', 'lead_responses', 'insight_actions'] as const)('U-2 %s: no AI sentence', async (queue) => {
    const { dialog } = await openDialog(queue);
    expect(dialog.textContent).not.toMatch(/\bAI\b/);
  });

  it('U-3 "ab" and "  ab  " keep Confirm disabled; "abc" enables it; the input caps at 500 and warns about client details', async () => {
    const { user, dialog } = await openDialog();
    const input = within(dialog).getByLabelText(/Why are you retrying this item\? \(at least 3 characters\)/);
    expect(input).toHaveAttribute('maxLength', '500');
    expect(dialog.textContent).toContain("Don't paste client details.");
    await user.type(input, 'ab');
    expect(confirmButton(dialog)).toBeDisabled();
    await user.clear(input);
    await user.type(input, '  ab  ');
    expect(confirmButton(dialog)).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'abc');
    expect(confirmButton(dialog)).toBeEnabled();
  });
});

describe('U-4 / U-5: the request', () => {
  it('U-4 one POST with exactly queue, id, action retry, the row\'s status and attempts, and the trimmed reason: no time, owner or account', async () => {
    const { user, dialog } = await openDialog('payment_reminders', { attempts: 5 });
    await confirmWith(user, dialog, '  provider was down  ');
    await waitFor(() => expect(actionCalls()).toHaveLength(1));
    const [url, init] = actionCalls()[0];
    expect(url).toBe(ACTION_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      queue: 'payment_reminders',
      itemId: 'abcdef12-3456-4789-8abc-def012345678',
      action: 'retry',
      expected: { status: 'failed', attempts: 5 },
      reason: 'provider was down',
    });
  });

  it('U-4 while in flight: "Retrying…", disabled, aria-busy; Escape, a click outside and Close do nothing', async () => {
    let release!: (r: Reply) => void;
    actionReply = () => new Promise<Reply>((resolve) => (release = resolve));
    const { user, dialog, onChanged } = await openDialog();
    await confirmWith(user, dialog);
    await waitFor(() => expect(confirmButton(dialog)).toHaveTextContent('Retrying…'));
    expect(confirmButton(dialog)).toBeDisabled();
    expect(confirmButton(dialog)).toHaveAttribute('aria-busy', 'true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await user.click(footerClose(dialog));
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId('retry-item-dialog')).toBeInTheDocument();
    await act(async () => release({ status: 409, body: { success: false, code: 'item_changed' } }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('U-5 a double click sends one request', async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText(/Why are you retrying this item/), 'client asked again');
    await user.dblClick(confirmButton(dialog)!);
    await waitFor(() => expect(within(dialog).getByTestId('retry-item-result')).toBeInTheDocument());
    expect(actionCalls()).toHaveLength(1);
  });

  it('U-5 two clicks in the same tick still send one request', async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText(/Why are you retrying this item/), 'client asked again');
    const button = confirmButton(dialog)!;
    await act(async () => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(within(dialog).getByTestId('retry-item-result')).toBeInTheDocument());
    expect(actionCalls()).toHaveLength(1);
  });
});

describe('U-6..U-10: outcomes are fixed sentences; the list refreshes when the dialog closes', () => {
  it('U-6 reminders 200 → "Queued for one more try…" plus "Not before {UTC}"; Close refreshes once', async () => {
    actionReply = () => success('payment_reminders', '2026-10-05T08:00:00.000Z');
    const { user, dialog, onChanged } = await openDialog('payment_reminders');
    await confirmWith(user, dialog);
    expect((await within(dialog).findByTestId('retry-item-result')).textContent).toBe(
      "Queued for one more try. The queue sends it on its next run. Not before 2026-10-05 08:00 UTC (the business's sending hours)."
    );
    expect(confirmButton(dialog)).toBeNull();
    expect(within(dialog).queryByLabelText(/Why are you retrying/)).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
    await user.click(footerClose(dialog));
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('retry-item-dialog')).toBeNull());
  });

  it('U-7 briefing 200 (nextAttemptAt null) → no time sentence; never says "sent"', async () => {
    actionReply = () => success('daily_briefing_sends', null);
    const { user, dialog } = await openDialog('daily_briefing_sends');
    await confirmWith(user, dialog);
    const text = (await within(dialog).findByTestId('retry-item-result')).textContent;
    expect(text).toBe('Queued for one more try. The queue sends it on its next run.');
  });

  it('U-6 a reminders 200 with an unparseable nextAttemptAt drops the time', async () => {
    actionReply = () => success('payment_reminders', 'SENTINEL');
    const { user, dialog } = await openDialog('payment_reminders');
    await confirmWith(user, dialog);
    expect((await within(dialog).findByTestId('retry-item-result')).textContent).toBe(
      'Queued for one more try. The queue sends it on its next run.'
    );
    expect(document.body.innerHTML).not.toContain('SENTINEL');
  });

  it('U-6 on the page: after a retry and Close, the jobs view and the open list both reload', async () => {
    const user = userEvent.setup();
    render(<AdminJobsQueuesPage />);
    await user.click(within(await screen.findByTestId('queue-lead_responses')).getByRole('button', { name: 'View items' }));
    const panel = await screen.findByTestId('queue-items-lead_responses');
    await user.click(await within(panel).findByRole('button', { name: 'Retry item' }));
    const dialog = await screen.findByTestId('retry-item-dialog');
    const jobsBefore = jobsCalls().length;
    const itemsBefore = itemCalls().length;
    await confirmWith(user, dialog);
    await within(dialog).findByTestId('retry-item-result');
    await user.click(footerClose(dialog));
    await waitFor(() => expect(jobsCalls().length).toBe(jobsBefore + 1));
    await waitFor(() => expect(itemCalls().length).toBe(itemsBefore + 1));
  });

  it.each([
    ['lead_responses', { status: 409, body: { success: false, code: 'item_changed', current: { status: 'pending', statusLabel: 'Waiting' } } },
      'This item changed since the list was loaded (it is now Waiting). Nothing was retried.', true],
    ['lead_responses', { status: 409, body: { success: false, code: 'item_changed', current: { status: 'x', statusLabel: '<b>x</b>' } } },
      'This item changed since the list was loaded. Nothing was retried.', true],
    ['lead_responses', { status: 404, body: { success: false, code: 'item_not_found' } }, 'This item is no longer in this queue. Nothing was retried.', true],
    ['payment_reminders', { status: 422, body: { success: false, code: 'retry_window_passed', anchorAt: '2026-10-01T09:00:00.000Z' } },
      'This reminder was due 2026-10-01 09:00 UTC. Its next sending-hours time is more than 72 hours after that, so it can be cancelled but not retried.', true],
    ['payment_reminders', { status: 422, body: { success: false, code: 'retry_window_passed', anchorAt: 'SENTINEL' } },
      'Its next sending-hours time is more than 72 hours after this reminder was due, so it can be cancelled but not retried.', true],
    ['insight_actions', { status: 422, body: { success: false, code: 'retry_window_passed', anchorAt: '2026-10-01T09:00:00.000Z' } },
      'This item was queued 2026-10-01 09:00 UTC, more than 72 hours ago, so it can be cancelled but not retried.', true],
    ['insight_actions', { status: 422, body: { success: false, code: 'retry_window_passed' } },
      'This item was queued more than 72 hours ago, so it can be cancelled but not retried.', true],
    ['daily_briefing_sends', { status: 422, body: { success: false, code: 'briefing_not_today', anchorAt: '2026-10-04T00:00:00.000Z' } },
      "This briefing's day has passed in the business's time zone, so it can be cancelled but not retried.", true],
    ['lead_responses', { status: 422, body: { success: false, code: 'retry_held' } }, 'Retrying lead replies is paused for now. Nothing was changed.', true],
    ['lead_responses', { status: 422, body: { success: false, code: 'retry_not_offered' } }, 'This item can no longer be retried.', true],
    ['lead_responses', { status: 422, body: { success: false, code: 'not_retryable_state' } }, 'This item can no longer be retried.', true],
    ['lead_responses', { status: 422, body: { success: false, code: 'no_due_time', anchorAt: null } }, 'This item can no longer be retried.', true],
    ['lead_responses', { status: 400, body: { success: false, code: 'invalid_input' } },
      'This request was not accepted. Nothing was retried. Close this and try again.', false],
    ['lead_responses', { status: 401, body: { success: false, error: 'Unauthorized' } }, 'Your admin session has ended. Sign in again.', false],
    ['lead_responses', { status: 403, body: { success: false, error: 'Forbidden' } }, 'Your admin session has ended. Sign in again.', false],
    ['lead_responses', { status: 500, body: { success: false, code: 'action_failed', error: 'SENTINEL-ERR', details: 'SENTINEL-DETAILS' } },
      'Could not read the item just now. Nothing was retried.', true],
    ['lead_responses', { status: 500, body: { success: false, code: 'outcome_unknown', error: 'SENTINEL-ERR', details: 'SENTINEL-DETAILS' } }, UNKNOWN, true],
    ['lead_responses', { status: 504, body: null }, UNKNOWN, true],
    ['lead_responses', { status: 200, body: { success: true, data: { action: 'cancel' } } }, UNKNOWN, true],
  ] as const)('U-8..U-10 %s %j → its fixed sentence', async (queue, reply, sentence, refreshes) => {
    actionReply = () => reply as Reply;
    const { user, dialog, onChanged } = await openDialog(queue);
    await confirmWith(user, dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toBe(sentence);
    expect(document.body.innerHTML).not.toMatch(/SENTINEL|<b>x<\/b>|&lt;b&gt;/);
    await user.click(footerClose(dialog));
    expect(onChanged).toHaveBeenCalledTimes(refreshes ? 1 : 0);
  });

  it('U-10 a rejected fetch → the unknown-outcome sentence, logged without the reason or the id; refresh on Close', async () => {
    const { user, dialog, onChanged } = await openDialog();
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await confirmWith(user, dialog, 'REASON-SENTINEL');
    expect((await within(dialog).findByRole('alert')).textContent).toBe(UNKNOWN);
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockLoggerError.mock.calls)).not.toMatch(/REASON-SENTINEL|abcdef12/);
    await user.click(footerClose(dialog));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a non-2xx is logged with queue, status and kind only', async () => {
    actionReply = () => ({ status: 422, body: { success: false, code: 'retry_window_passed' } });
    const { user, dialog } = await openDialog();
    await confirmWith(user, dialog, 'REASON-SENTINEL');
    await within(dialog).findByRole('alert');
    expect(mockLoggerWarn).toHaveBeenCalledWith({ queue: 'lead_responses', status: 422, kind: 'retry_window_passed' }, expect.any(String));
    expect(JSON.stringify(mockLoggerWarn.mock.calls)).not.toMatch(/REASON-SENTINEL|abcdef12/);
  });

  it('re-opening after a result starts fresh: empty reason, no message', async () => {
    actionReply = () => ({ status: 422, body: { success: false, code: 'not_retryable_state' } });
    const { user, dialog } = await openDialog();
    await confirmWith(user, dialog);
    await within(dialog).findByRole('alert');
    await user.click(footerClose(dialog));
    await user.click(screen.getByRole('button', { name: 'Retry item' }));
    const again = await screen.findByTestId('retry-item-dialog');
    expect(within(again).queryByRole('alert')).toBeNull();
    expect(within(again).getByLabelText(/Why are you retrying/)).toHaveValue('');
  });
});

describe('U-11 / U-12', () => {
  it('U-11 no green class in the dialog', async () => {
    const { dialog } = await openDialog();
    expect(dialog.innerHTML).not.toMatch(/\b(?:bg|text|border)-(?:green|emerald)-/);
  });

  it('U-12 the view header is the 7c sentence; with panels closed the page buttons are unchanged (no Retry item)', async () => {
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('queue-lead_responses');
    expect(document.body.textContent).toContain(
      "Each queue has a Drain now button; a waiting, failed or orphaned item can be cancelled, and a recently failed item can be retried, from its queue's list; everything else here is read-only."
    );
    expect(screen.queryByRole('button', { name: 'Retry item' })).toBeNull();
  });
});

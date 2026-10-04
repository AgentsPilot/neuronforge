/**
 * @jest-environment jsdom
 */

/**
 * "Cancel item" on a queue's item list (ADMIN_BOS_CLEANUP slice 7b; workplan
 * §2.7, §5.10 U-1..U-12, SA W7B-7, OP-13).
 *
 * What would mislead an admin if it were wrong: a button on a row that cannot
 * be cancelled; a confirm that does not need a reason; a dismiss button that
 * says "Cancel" (it would read as the action); two requests from a double
 * click; a body that carries anything but what the row showed; a success that
 * claims more than the queue can promise; server text shown verbatim; and a
 * list that does not refresh after the outcome.
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
import { CancelQueueItemDialog, KNOWN_STATUS_LABELS } from '../components/jobs/CancelQueueItemDialog';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { CronRunSummaryRow } from '@/lib/admin/jobs/buildJobsQueuesView';
import { QUEUE_ITEM_STATUS_LABELS } from '@/lib/admin/jobs/buildQueueItemsView';
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

function item(overrides: Partial<QueueItemView> = {}): QueueItemView {
  return {
    id: 'abcdef12-3456-4789-8abc-def012345678',
    businessName: 'Acme Plumbing',
    kindLabel: 'Follow-up to a lead',
    status: 'pending',
    statusLabel: 'Waiting',
    state: 'waiting',
    errorCategory: null,
    attempts: 2,
    due: { basis: 'queued', at: '2026-10-04T08:00:00.000Z' },
    nextAttemptAt: null,
    age: { minutes: 240, basis: 'overdue' },
    lease: null,
    retry: { allowed: false, code: 'not_retryable_state' },
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

/** The dialog on its own, for the copy and outcome cases. */
async function openDialog(queueId: BosQueueId = 'lead_responses', overrides: Partial<QueueItemView> = {}) {
  const onChanged = jest.fn();
  const user = userEvent.setup();
  render(<CancelQueueItemDialog queueId={queueId} queueLabel="Lead replies" item={item(overrides)} onChanged={onChanged} />);
  await user.click(screen.getByRole('button', { name: 'Cancel item' }));
  const dialog = await screen.findByTestId('cancel-item-dialog');
  return { user, dialog, onChanged };
}

const footerClose = (dialog: HTMLElement) => within(dialog).getByTestId('cancel-item-close');
const confirmButton = (dialog: HTMLElement) => within(dialog).queryByTestId('cancel-item-confirm');

async function confirmWith(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, reason = 'wrong client') {
  await user.type(within(dialog).getByLabelText(/Why are you cancelling this item/), reason);
  await user.click(confirmButton(dialog)!);
}

beforeEach(() => {
  jest.clearAllMocks();
  actionReply = () => ({
    status: 200,
    body: {
      success: true,
      data: {
        queue: 'lead_responses',
        itemId: item().id,
        action: 'cancel',
        before: { status: 'pending', statusLabel: 'Waiting' },
        after: { status: 'skipped', statusLabel: 'Skipped' },
      },
    },
  });
  installFetch();
});

// ─────────────────────────────────────────────────────────────────────────
describe('U-1: the trigger, only on a cancellable row', () => {
  it('one "Cancel item" button, in the allowed row\'s Cancellable cell; the other rows keep the 7a words', async () => {
    installFetch(() => [
      item(),
      item({
        id: '22222222-aaaa-4bbb-8ccc-dddddddddddd',
        status: 'processing',
        statusLabel: 'In progress',
        state: 'stuck',
        lease: 'expired',
        cancel: { allowed: false, code: 'leased' },
      }),
      item({ id: '33333333-aaaa-4bbb-8ccc-dddddddddddd', status: 'sent', cancel: { allowed: false, code: 'not_cancellable_state' } }),
    ]);
    render(<AdminJobsQueuesPage />);
    fireEvent.click(within(await screen.findByTestId('queue-lead_responses')).getByRole('button', { name: 'View items' }));
    const panel = await screen.findByTestId('queue-items-lead_responses');
    await waitFor(() => expect(within(panel).getAllByTestId('queue-item-row')).toHaveLength(3));
    const rows = within(panel).getAllByTestId('queue-item-row');
    expect(within(panel).getAllByRole('button', { name: 'Cancel item' })).toHaveLength(1);
    const cells0 = rows[0].querySelectorAll('td');
    expect(within(cells0[cells0.length - 1] as HTMLElement).getByRole('button', { name: 'Cancel item' })).toBeInTheDocument();
    expect(rows[1].lastElementChild?.textContent).toBe("no: claimed by a run; the queue's own sweep releases it");
    expect(rows[2].lastElementChild?.textContent).toBe('no');
    expect(panel.querySelectorAll('td button')).toHaveLength(1);
    expect(panel.querySelectorAll('td a, td input')).toHaveLength(0);
    // Opening nothing makes no request (M-4).
    expect(actionCalls()).toHaveLength(0);
  });
});

describe('U-2 / U-3: the dialog copy and the reason', () => {
  it('U-2 title, kind, business, short id, status; "never" line; Confirm disabled; the dismiss button reads Close; no button reads Cancel', async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Cancel this item?' })).toBeInTheDocument();
    expect(dialog.textContent).toContain('Follow-up to a lead for Acme Plumbing · item abcdef12 · Waiting');
    expect(dialog.textContent).not.toContain('abcdef12-3456');
    expect(dialog.textContent).toContain(
      'Cancelling closes this item for good. The queue will never pick it up or send it, and it cannot be re-sent afterwards.'
    );
    expect(dialog.textContent).toContain('The business is not told. Your reason is kept in the admin audit trail.');
    expect(dialog.textContent).not.toContain('No run holds this item');
    expect(confirmButton(dialog)).toBeDisabled();
    expect(confirmButton(dialog)).toHaveTextContent('Cancel item');
    expect(footerClose(dialog)).toHaveTextContent('Close');
    for (const button of within(dialog).getAllByRole('button')) expect(button.textContent?.trim()).not.toBe('Cancel');
    expect(actionCalls()).toHaveLength(0);
  });

  it.each([
    ['payment_reminders', 'The invoice is not changed. If it stays unpaid, a later reminder can still be scheduled under the business\'s reminder settings.'],
    ['payment_automations', 'The automation rule is not changed; later events can still queue new runs.'],
    ['daily_briefing_sends', 'No briefing goes to this business for that day. Other days are not affected.'],
    ['lead_responses', 'This message is not queued again for the same lead.'],
    ['insight_actions', 'The same action is not queued again in the same period.'],
  ] as const)('U-2 %s: its "what happens next" line', async (queue, line) => {
    const { dialog } = await openDialog(queue);
    expect(dialog.textContent).toContain(line);
  });

  it('U-2 the orphan line appears only for an in-progress row with no claim', async () => {
    const { dialog } = await openDialog('lead_responses', { status: 'processing', statusLabel: 'In progress', state: 'stuck', lease: 'none' });
    expect(dialog.textContent).toContain('No run holds this item (no claim was recorded), so closing it is safe.');
  });

  it('U-3 "ab" and "  ab  " keep Confirm disabled; "abc" enables it; the input caps at 500 and warns about client details', async () => {
    const { user, dialog } = await openDialog();
    const input = within(dialog).getByLabelText(/Why are you cancelling this item\? \(at least 3 characters\)/);
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
  it('U-4 one POST to the action route with exactly the row\'s queue, id, status and attempts, and the trimmed reason', async () => {
    const { user, dialog } = await openDialog('insight_actions', { status: 'failed', statusLabel: 'Failed', attempts: 3 });
    await confirmWith(user, dialog, '  duplicate send  ');
    await waitFor(() => expect(actionCalls()).toHaveLength(1));
    const [url, init] = actionCalls()[0];
    expect(url).toBe(ACTION_URL);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      queue: 'insight_actions',
      itemId: 'abcdef12-3456-4789-8abc-def012345678',
      action: 'cancel',
      expected: { status: 'failed', attempts: 3 },
      reason: 'duplicate send',
    });
  });

  it('U-4 while in flight: "Cancelling…", disabled, aria-busy; Escape, a click outside and Close do nothing', async () => {
    let release!: (r: Reply) => void;
    actionReply = () => new Promise<Reply>((resolve) => (release = resolve));
    const { user, dialog, onChanged } = await openDialog();
    await confirmWith(user, dialog);
    await waitFor(() => expect(confirmButton(dialog)).toHaveTextContent('Cancelling…'));
    expect(confirmButton(dialog)).toBeDisabled();
    expect(confirmButton(dialog)).toHaveAttribute('aria-busy', 'true');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await user.click(footerClose(dialog));
    fireEvent.pointerDown(document.body);
    expect(screen.getByTestId('cancel-item-dialog')).toBeInTheDocument();
    await act(async () => release({ status: 409, body: { success: false, code: 'item_changed' } }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeInTheDocument());
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('U-5 a double click on Confirm sends one request', async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText(/Why are you cancelling this item/), 'wrong client');
    await user.dblClick(confirmButton(dialog)!);
    await waitFor(() => expect(within(dialog).getByTestId('cancel-item-result')).toBeInTheDocument());
    expect(actionCalls()).toHaveLength(1);
  });

  it('U-5 two clicks in the same tick (before React re-renders the disabled button) still send one request', async () => {
    const { user, dialog } = await openDialog();
    await user.type(within(dialog).getByLabelText(/Why are you cancelling this item/), 'wrong client');
    const button = confirmButton(dialog)!;
    await act(async () => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(within(dialog).getByTestId('cancel-item-result')).toBeInTheDocument());
    expect(actionCalls()).toHaveLength(1);
  });
});

describe('U-6..U-10: outcomes are fixed sentences; the list refreshes when the dialog closes', () => {
  it('U-6 200 → "Cancelled. The queue will not send it."; Confirm hidden; Close refreshes once', async () => {
    const { user, dialog, onChanged } = await openDialog();
    await confirmWith(user, dialog);
    expect((await within(dialog).findByTestId('cancel-item-result')).textContent).toBe('Cancelled. The queue will not send it.');
    expect(confirmButton(dialog)).toBeNull();
    expect(within(dialog).queryByLabelText(/Why are you cancelling/)).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();
    await user.click(footerClose(dialog));
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('cancel-item-dialog')).toBeNull());
  });

  it('U-6 on the page: after a cancel and Close, the jobs view and the open list both reload', async () => {
    const user = userEvent.setup();
    render(<AdminJobsQueuesPage />);
    await user.click(within(await screen.findByTestId('queue-lead_responses')).getByRole('button', { name: 'View items' }));
    const panel = await screen.findByTestId('queue-items-lead_responses');
    await user.click(await within(panel).findByRole('button', { name: 'Cancel item' }));
    const dialog = await screen.findByTestId('cancel-item-dialog');
    const jobsBefore = jobsCalls().length;
    const itemsBefore = itemCalls().length;
    await confirmWith(user, dialog);
    await within(dialog).findByTestId('cancel-item-result');
    await user.click(footerClose(dialog));
    await waitFor(() => expect(jobsCalls().length).toBe(jobsBefore + 1));
    await waitFor(() => expect(itemCalls().length).toBe(itemsBefore + 1));
  });

  it.each([
    [{ status: 409, body: { success: false, code: 'item_changed', current: { status: 'processing', statusLabel: 'In progress' } } },
      'This item changed since the list was loaded (it is now In progress). Nothing was cancelled.', true],
    [{ status: 409, body: { success: false, code: 'item_changed', current: { status: 'x', statusLabel: '<b>x</b>' } } },
      'This item changed since the list was loaded. Nothing was cancelled.', true],
    [{ status: 409, body: { success: false, code: 'item_changed' } },
      'This item changed since the list was loaded. Nothing was cancelled.', true],
    [{ status: 404, body: { success: false, code: 'item_not_found' } }, 'This item is no longer in this queue. Nothing was cancelled.', true],
    [{ status: 422, body: { success: false, code: 'leased' } }, 'A run has picked this item up, so it cannot be cancelled now.', true],
    [{ status: 422, body: { success: false, code: 'not_cancellable_state' } }, 'This item can no longer be cancelled.', true],
    [{ status: 400, body: { success: false, code: 'invalid_input' } },
      'This request was not accepted. Nothing was cancelled. Close this and try again.', false],
    // SA code review (optional suggestion, taken): a 500 action_failed wrote nothing, so it is told apart from the unknown outcome.
    [{ status: 500, body: { success: false, code: 'action_failed', error: 'SENTINEL-ERR', details: 'SENTINEL-DETAILS' } },
      'Could not read the item just now. Nothing was cancelled.', true],
    [{ status: 401, body: { success: false, error: 'Unauthorized' } }, 'Your admin session has ended. Sign in again.', false],
    [{ status: 403, body: { success: false, error: 'Forbidden' } }, 'Your admin session has ended. Sign in again.', false],
    [{ status: 500, body: { success: false, code: 'outcome_unknown', error: 'SENTINEL-ERR', details: 'SENTINEL-DETAILS' } },
      'The request did not complete, so the item may or may not have been cancelled. The list refreshes when you close this; check its status there.', true],
    [{ status: 504, body: null },
      'The request did not complete, so the item may or may not have been cancelled. The list refreshes when you close this; check its status there.', true],
  ] as const)('U-7..U-10 %j → its fixed sentence', async (reply, sentence, refreshes) => {
    actionReply = () => reply as Reply;
    const { user, dialog, onChanged } = await openDialog();
    await confirmWith(user, dialog);
    expect((await within(dialog).findByRole('alert')).textContent).toBe(sentence);
    expect(document.body.innerHTML).not.toMatch(/SENTINEL|<b>x<\/b>|&lt;b&gt;/);
    await user.click(footerClose(dialog));
    expect(onChanged).toHaveBeenCalledTimes(refreshes ? 1 : 0);
  });

  it('U-10 a rejected fetch → the unknown-outcome sentence, logged without the reason or the id; refresh on Close', async () => {
    const { user, dialog, onChanged } = await openDialog();
    // The standalone dialog makes no other request, so the next fetch is the POST.
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await confirmWith(user, dialog, 'REASON-SENTINEL');
    expect((await within(dialog).findByRole('alert')).textContent).toContain('may or may not have been cancelled');
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockLoggerError.mock.calls)).not.toMatch(/REASON-SENTINEL|abcdef12/);
    await user.click(footerClose(dialog));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('a non-2xx is logged with queue and status only', async () => {
    actionReply = () => ({ status: 409, body: { success: false, code: 'item_changed' } });
    const { user, dialog } = await openDialog();
    await confirmWith(user, dialog, 'REASON-SENTINEL');
    await within(dialog).findByRole('alert');
    expect(mockLoggerWarn).toHaveBeenCalledWith({ queue: 'lead_responses', status: 409, kind: 'item_changed' }, expect.any(String));
    expect(JSON.stringify(mockLoggerWarn.mock.calls)).not.toMatch(/REASON-SENTINEL|abcdef12/);
  });

  it('re-opening after a result starts fresh: empty reason, no message', async () => {
    actionReply = () => ({ status: 422, body: { success: false, code: 'leased' } });
    const { user, dialog } = await openDialog();
    await confirmWith(user, dialog);
    await within(dialog).findByRole('alert');
    await user.click(footerClose(dialog));
    await user.click(screen.getByRole('button', { name: 'Cancel item' }));
    const again = await screen.findByTestId('cancel-item-dialog');
    expect(within(again).queryByRole('alert')).toBeNull();
    expect(within(again).getByLabelText(/Why are you cancelling/)).toHaveValue('');
  });
});

describe('U-11 / labels', () => {
  it('no green class in the dialog', async () => {
    const { dialog } = await openDialog();
    expect(dialog.innerHTML).not.toMatch(/\b(?:bg|text|border)-(?:green|emerald)-/);
  });

  it('the client-side label set mirrors QUEUE_ITEM_STATUS_LABELS (plus the two list-only labels)', () => {
    expect([...KNOWN_STATUS_LABELS].sort()).toEqual(
      [...new Set([...Object.values(QUEUE_ITEM_STATUS_LABELS), 'Dead-lettered', 'Unrecognised status'])].sort()
    );
  });
});

/**
 * @jest-environment jsdom
 */

/**
 * "Drain now" on the Scheduled jobs & queues page (ADMIN_BOS_CLEANUP slice 7d;
 * workplan §5.6 U-1..U-9, SA W7D-7, W7D-8).
 *
 * What would mislead an admin if it were wrong: a button missing on a queue
 * whose figures could not be read (recovery is the point), a confirm that does
 * not need a reason, copy that promises more than the drain does, a result
 * that claims items moved when the drain reports nothing, a time-out shown as
 * an error, and server text shown verbatim.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }),
}));

import AdminJobsQueuesPage from '../jobs-queues/page';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { CronRunSummaryRow } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { JobsQueuesView } from '@/lib/admin/jobs/jobsQueuesTypes';
import { BOS_QUEUES } from '@/lib/cron/bosCronJobs';
import { quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.setPointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

const NOW = new Date('2026-09-27T12:00:00.000Z');
const DRAIN_URL = '/api/admin/jobs-queues/drain';

function view(): JobsQueuesView {
  return buildJobsQueuesView(
    {
      runs: { state: 'ok', rows: quietSummaryRows(NOW) as CronRunSummaryRow[] },
      queues: Object.fromEntries(
        BOS_QUEUES.map((q) => [
          q.id,
          // One queue whose figures could not be read: its button must still show.
          q.id === 'insight_actions' ? { ok: false as const } : { ok: true as const, figures: quietQueueFigures() },
        ])
      ),
    },
    NOW
  );
}

interface DrainReply {
  status: number;
  /** null = the body is not JSON (a platform time-out page). */
  body: unknown;
}

let drainReply: DrainReply | (() => Promise<DrainReply>);
let fetchMock: jest.Mock;

function installFetch() {
  fetchMock = jest.fn(async (url: string) => {
    if (url === DRAIN_URL) {
      const reply = typeof drainReply === 'function' ? await drainReply() : drainReply;
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => {
          if (reply.body === null) throw new SyntaxError('Unexpected token < in JSON');
          return reply.body;
        },
      };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: view() }) };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

const jobsFetches = () => fetchMock.mock.calls.filter(([url]) => url === '/api/admin/jobs-queues').length;
const drainFetches = () => fetchMock.mock.calls.filter(([url]) => url === DRAIN_URL);

async function openDialog(queue: string) {
  const user = userEvent.setup();
  render(<AdminJobsQueuesPage />);
  const card = await screen.findByTestId(`queue-${queue}`);
  await user.click(within(card).getByRole('button', { name: 'Drain now' }));
  const dialog = await screen.findByTestId('drain-dialog');
  return { user, dialog };
}

beforeEach(() => {
  jest.clearAllMocks();
  drainReply = { status: 200, body: { success: true, data: { queue: 'payment_reminders', counts: [], durationMs: 1200 } } };
  installFetch();
});

// SA L-1 / QA: these userEvent flows pass alone but exceed Jest's 5 s default
// under parallel load in the wide run.
jest.setTimeout(20000);

describe('Drain now', () => {
  it('U-1 one Drain now per queue, inside its card, even when the figures could not be read', async () => {
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('queue-payment_reminders');
    for (const queue of BOS_QUEUES) {
      expect(within(screen.getByTestId(`queue-${queue.id}`)).getByRole('button', { name: 'Drain now' })).toBeInTheDocument();
    }
    expect(within(screen.getByTestId('queue-insight_actions')).getByText('Could not check just now.')).toBeInTheDocument();
  });

  it('U-2 payment reminders: what it does and does not do; Confirm starts disabled', async () => {
    const { dialog } = await openDialog('payment_reminders');
    expect(dialog).toHaveTextContent(
      "Runs this queue's scheduled step now, the same one Payment reminders runs: it recovers items whose run died, picks up items that are due, and processes them. Each item is checked again before it goes out."
    );
    expect(dialog).toHaveTextContent('It does not re-send failed or dead-lettered items.');
    expect(dialog).toHaveTextContent('It does not touch items scheduled for later.');
    expect(dialog).toHaveTextContent("It does not record a run of the scheduled job, so the job's status still shows when Vercel last ran it.");
    expect(dialog).toHaveTextContent(
      'It does not bill plan stages, look for newly overdue invoices or mark invoices overdue. Those stay with the scheduled job.'
    );
    expect(dialog).toHaveTextContent("Don't paste client details.");
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('U-3 Confirm needs at least 3 characters after trimming', async () => {
    const { user, dialog } = await openDialog('payment_reminders');
    const input = within(dialog).getByLabelText(/Why are you draining this queue/);
    const confirm = within(dialog).getByRole('button', { name: 'Confirm' });
    await user.type(input, 'ab');
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, '  ab  ');
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, 'abc');
    expect(confirm).toBeEnabled();
    expect(input).toHaveAttribute('maxLength', '500');
  });

  it('U-4 Confirm POSTs { queue, reason } and is busy, and the dialog cannot be dismissed, while pending', async () => {
    let release!: (reply: DrainReply) => void;
    drainReply = () => new Promise<DrainReply>((resolve) => (release = resolve));
    const { user, dialog } = await openDialog('payment_reminders');
    await user.type(within(dialog).getByLabelText(/Why are you draining this queue/), '  abc  ');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(drainFetches()).toHaveLength(1));
    const [, init] = drainFetches()[0];
    expect(init).toMatchObject({ method: 'POST' });
    expect(JSON.parse(init.body)).toEqual({ queue: 'payment_reminders', reason: 'abc' });

    const busy = within(dialog).getByRole('button', { name: 'Draining…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');

    // Escape, Cancel and the corner close do nothing while the call is in flight.
    await user.keyboard('{Escape}');
    expect(screen.getByTestId('drain-dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.getByTestId('drain-dialog')).toBeInTheDocument();

    release({ status: 200, body: { success: true, data: { queue: 'payment_reminders', counts: [], durationMs: 10 } } });
    await screen.findByTestId('drain-result');
  });

  it('U-5 counts and duration are shown, and the page refreshes', async () => {
    drainReply = {
      status: 200,
      body: {
        success: true,
        data: {
          queue: 'payment_reminders',
          counts: [
            { key: 'processed', label: 'picked up', value: 3 },
            { key: 'sent', label: 'sent', value: 2 },
          ],
          durationMs: 2340,
        },
      },
    };
    const { user, dialog } = await openDialog('payment_reminders');
    expect(jobsFetches()).toBe(1);
    await user.type(within(dialog).getByLabelText(/Why are you draining this queue/), 'cron is down');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    const result = await screen.findByTestId('drain-result');
    expect(result).toHaveTextContent('Done in 2.3 s.');
    expect(within(result).getByText('picked up: 3')).toBeInTheDocument();
    expect(within(result).getByText('sent: 2')).toBeInTheDocument();
    await waitFor(() => expect(jobsFetches()).toBe(2));
    // A finished drain cannot be confirmed again from the same dialog.
    expect(within(dialog).queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
  });

  it('U-6 a drain with no counts (automations) never claims items moved, and never says "Done" alone', async () => {
    drainReply = { status: 200, body: { success: true, data: { queue: 'payment_automations', counts: [], durationMs: 400 } } };
    const { user, dialog } = await openDialog('payment_automations');
    expect(dialog).toHaveTextContent('It does not retry card payments.');
    await user.type(within(dialog).getByLabelText(/Why are you draining this queue/), 'cron is down');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    const result = await screen.findByTestId('drain-result');
    expect(result).toHaveTextContent(
      "Finished. This queue's drain reports no counts; the refreshed figures below show what changed."
    );
    expect(result).not.toHaveTextContent(/Done|moved|sent/);
    await waitFor(() => expect(jobsFetches()).toBe(2));
  });

  it('U-7 a drain that threw: the plain sentence, never the server text, and the page refreshes', async () => {
    drainReply = {
      status: 500,
      body: { success: false, error: 'SERVER-ERROR-TEXT', code: 'drain_failed', details: 'SERVER-DETAILS' },
    };
    const { user, dialog } = await openDialog('lead_responses');
    await user.type(within(dialog).getByLabelText(/Why are you draining this queue/), 'cron is down');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'The drain stopped with an error. Some items may already have been sent. Check the queue counts.'
    );
    expect(document.body.innerHTML).not.toMatch(/SERVER-ERROR-TEXT|SERVER-DETAILS/);
    await waitFor(() => expect(jobsFetches()).toBe(2));
  });

  it.each([
    ['a 504 with a non-JSON body', { status: 504, body: null }],
    ['a 504 with JSON', { status: 504, body: { success: false } }],
    ['a 502 whose body is not JSON', { status: 502, body: null }],
  ])('W7D-7 time-out (%s) has its own sentence, and the page refreshes', async (_label, reply) => {
    drainReply = reply;
    const { user, dialog } = await openDialog('daily_briefing_sends');
    await user.type(within(dialog).getByLabelText(/Why are you draining this queue/), 'cron is down');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'It ran out of time. Anything it did not reach is picked up by the next run. Wait a few minutes before pressing again.'
    );
    expect(alert).not.toHaveTextContent('stopped with an error');
    await waitFor(() => expect(jobsFetches()).toBe(2));
  });

  it.each([
    [400, { success: false, error: 'x', code: 'invalid_input' }, 'Give a reason of at least 3 characters, then try again.'],
    [401, { success: false, error: 'Unauthorized' }, 'Your admin session has ended. Sign in again.'],
    [403, { success: false, error: 'Forbidden' }, 'Your admin session has ended. Sign in again.'],
  ])('U-8 a %s shows its mapped sentence, and does not refresh', async (status, body, sentence) => {
    drainReply = { status, body };
    const { user, dialog } = await openDialog('insight_actions');
    await user.type(within(dialog).getByLabelText(/Why are you draining this queue/), 'cron is down');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(sentence);
    expect(jobsFetches()).toBe(1);
  });

  it('U-9 the briefing dialog says it uses AI on the business credits, reuses a briefing, and queues only local mornings', async () => {
    const { dialog } = await openDialog('daily_briefing_sends');
    expect(dialog).toHaveTextContent(
      "Writing a briefing uses AI and is charged to that business's credits, as on the scheduled run. A briefing already written today is reused."
    );
    expect(dialog).toHaveTextContent('It also queues what has just become due, the same as the scheduled run.');
    expect(dialog).toHaveTextContent('07:00–10:59');
  });

  it('U-9 the lead replies dialog says it also queues; no AI line', async () => {
    const { dialog } = await openDialog('lead_responses');
    expect(dialog).toHaveTextContent('It also queues what has just become due, the same as the scheduled run.');
    expect(dialog).not.toHaveTextContent(/AI|credits/);
  });

  it.each(['payment_reminders', 'payment_automations', 'insight_actions'])(
    'U-9 %s shows neither the AI line nor the "also queues" line',
    async (queue) => {
      const { dialog } = await openDialog(queue);
      expect(dialog).not.toHaveTextContent(/AI|credits/);
      expect(dialog).not.toHaveTextContent('It also queues');
    }
  );

  it('QA: a network failure (fetch rejects) has its own sentence, not the time-out one, and the page refreshes', async () => {
    const { user, dialog } = await openDialog('lead_responses');
    fetchMock.mockImplementationOnce(async () => {
      throw new TypeError('Failed to fetch');
    });
    await user.type(within(dialog).getByLabelText(/Why are you draining this queue/), 'cron is down');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(
      'The request did not complete, so the drain may or may not have run. Check the queue counts before pressing again.'
    );
    expect(alert).not.toHaveTextContent(/ran out of time|stopped with an error/);
    expect(document.body.innerHTML).not.toContain('Failed to fetch');
    await waitFor(() => expect(jobsFetches()).toBe(2));
    // The admin may try again from the same dialog: Confirm is still offered.
    expect(within(dialog).getByRole('button', { name: 'Confirm' })).toBeEnabled();
  });

  it('QA: a double-click on Confirm sends one request, not two', async () => {
    let release!: (reply: DrainReply) => void;
    drainReply = () => new Promise<DrainReply>((resolve) => (release = resolve));
    const { user, dialog } = await openDialog('payment_reminders');
    await user.type(within(dialog).getByLabelText(/Why are you draining this queue/), 'cron is down');
    await user.dblClick(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(drainFetches()).toHaveLength(1));
    release({ status: 200, body: { success: true, data: { queue: 'payment_reminders', counts: [], durationMs: 10 } } });
    await screen.findByTestId('drain-result');
    expect(drainFetches()).toHaveLength(1);
  });

  it('Cancel closes the dialog and sends nothing', async () => {
    const { user, dialog } = await openDialog('insight_actions');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('drain-dialog')).not.toBeInTheDocument());
    expect(drainFetches()).toHaveLength(0);
  });
});

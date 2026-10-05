/**
 * @jest-environment jsdom
 */

/**
 * The per-queue item list on Scheduled jobs & queues (ADMIN_BOS_CLEANUP slice
 * 7a; workplan §5.8 and conditions W7A-2, W7A-4, W7A-5, W7A-7(c), W7A-10).
 *
 * Renders what the items route sends, read-only: one GET per view of a list,
 * four state tabs, Previous / Next, fixed sentences for failures, no server
 * text, no action, and no stale response overwriting a newer one.
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockLoggerError = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: (...a: unknown[]) => mockLoggerError(...a),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
  }),
}));

import AdminJobsQueuesPage from '../jobs-queues/page';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { CronRunSummaryRow } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { JobsQueuesView, QueueItemView, QueueItemsView, QueueItemState } from '@/lib/admin/jobs/jobsQueuesTypes';
import { BOS_QUEUES } from '@/lib/cron/bosCronJobs';
import { quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const JOBS_URL = '/api/admin/jobs-queues';
const ITEMS_PREFIX = '/api/admin/jobs-queues/items?';
const DRAIN_URL = '/api/admin/jobs-queues/drain';

// The Radix dialog behind Drain now needs these in jsdom (as the drain render test).
beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.setPointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

// Slice 7b: every cancellable row now renders a Radix dialog trigger, so the
// 50-row paging flows exceed Jest's 5 s default (the 7d drain render suite's
// precedent, SA L-1). Explicit per-test timeouts below still win.
jest.setTimeout(20000);

function jobsView(): JobsQueuesView {
  return buildJobsQueuesView(
    {
      runs: { state: 'ok', rows: quietSummaryRows(NOW) as CronRunSummaryRow[] },
      queues: Object.fromEntries(
        BOS_QUEUES.map((q) => [
          q.id,
          q.id === 'insight_actions' ? { ok: false as const } : { ok: true as const, figures: quietQueueFigures() },
        ])
      ),
    },
    NOW
  );
}

function item(overrides: Partial<QueueItemView> = {}): QueueItemView {
  return {
    id: 'abcdef12-3456-4789-8abc-def012345678',
    businessName: 'Acme Plumbing',
    kindLabel: 'Follow-up to a lead',
    status: 'failed',
    statusLabel: 'Failed',
    state: 'failed',
    errorCategory: 'failed',
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

function itemsView(params: URLSearchParams, items: QueueItemView[], total: number | null = items.length): QueueItemsView {
  const page = Number(params.get('page'));
  return {
    queue: params.get('queue')!,
    state: params.get('state') as QueueItemState,
    now: NOW.toISOString(),
    page,
    pageSize: 50,
    maxPage: 20,
    total,
    hasMore: total !== null && page < 20 && page * 50 < total,
    items,
  };
}

type Reply = { status: number; body: unknown };
/** What the items route answers for a request; a Promise to hold the reply back. */
let itemsReply: (params: URLSearchParams) => Reply | Promise<Reply>;
let drainReply: () => Reply;
let fetchMock: jest.Mock;

function installFetch() {
  fetchMock = jest.fn(async (url: string) => {
    if (url.startsWith(ITEMS_PREFIX) || url === DRAIN_URL) {
      const reply = url === DRAIN_URL ? drainReply() : await itemsReply(new URLSearchParams(url.slice(ITEMS_PREFIX.length)));
      return {
        ok: reply.status >= 200 && reply.status < 300,
        status: reply.status,
        json: async () => {
          if (reply.body === null) throw new SyntaxError('Unexpected token < in JSON');
          return reply.body;
        },
      };
    }
    return { ok: true, status: 200, json: async () => ({ success: true, data: jobsView() }) };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

const itemCalls = () => fetchMock.mock.calls.filter(([url]) => String(url).startsWith(ITEMS_PREFIX));
const itemUrls = () => itemCalls().map(([url]) => String(url));
const jobsCalls = () => fetchMock.mock.calls.filter(([url]) => url === JOBS_URL);

async function openPanel(queue: string) {
  render(<AdminJobsQueuesPage />);
  const card = await screen.findByTestId(`queue-${queue}`);
  fireEvent.click(within(card).getByRole('button', { name: 'View items' }));
  return screen.findByTestId(`queue-items-${queue}`);
}

beforeEach(() => {
  jest.clearAllMocks();
  itemsReply = (params) => ({ status: 200, body: { success: true, data: itemsView(params, [item()]) } });
  drainReply = () => ({ status: 500, body: null });
  installFetch();
});

describe('U-1 / U-2: opening a list', () => {
  it('U-1: every card has View items (also when its figures failed); no list is open; one jobs request only', async () => {
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('queue-lead_responses');
    for (const queue of BOS_QUEUES) {
      expect(within(screen.getByTestId(`queue-${queue.id}`)).getByRole('button', { name: 'View items' })).toBeInTheDocument();
    }
    expect(within(screen.getByTestId('queue-insight_actions')).getByText('Could not check just now.')).toBeInTheDocument();
    expect(document.querySelector('[data-testid^="queue-items-"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('U-2: opening asks once for the stuck list, page 1, no-store, as a GET; the toggle says Hide items', async () => {
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(itemCalls()).toHaveLength(1));
    const [url, init] = itemCalls()[0];
    expect(url).toBe('/api/admin/jobs-queues/items?queue=lead_responses&state=stuck&page=1');
    expect(init).toMatchObject({ cache: 'no-store' });
    expect(init).not.toHaveProperty('method');
    expect(init).not.toHaveProperty('body');
    expect(within(panel).getByRole('button', { name: 'Stuck' })).toHaveAttribute('aria-pressed', 'true');
    const toggle = within(screen.getByTestId('queue-lead_responses')).getByRole('button', { name: 'Hide items' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('queue-items-lead_responses')).toBeNull();
  });
});

describe('U-3: rows', () => {
  it('shows each column in fixed words, the short id with the full id in a title', async () => {
    itemsReply = (params) => ({
      status: 200,
      body: {
        success: true,
        data: itemsView(params, [
          item(),
          item({
            id: '22222222-aaaa-4bbb-8ccc-dddddddddddd',
            businessName: 'No business profile',
            status: 'processing',
            statusLabel: 'In progress',
            state: 'stuck',
            errorCategory: null,
            age: { minutes: 25, basis: 'since_claimed' },
            lease: 'expired',
            retry: { allowed: false, code: 'not_retryable_state' },
            cancel: { allowed: false, code: 'leased' },
          }),
          item({
            id: '33333333-aaaa-4bbb-8ccc-dddddddddddd',
            status: 'processing',
            statusLabel: 'In progress',
            age: { minutes: null, basis: 'no_lease' },
            lease: 'none',
            retry: { allowed: false, code: 'not_retryable_state' },
            cancel: { allowed: true },
          }),
          item({
            id: '44444444-aaaa-4bbb-8ccc-dddddddddddd',
            status: 'pending',
            statusLabel: 'Waiting',
            due: { basis: 'queued', at: '2026-10-04T08:00:00.000Z' },
            nextAttemptAt: '2026-10-04T12:15:00.000Z',
            age: { minutes: -15, basis: 'overdue' },
            retry: { allowed: false, code: 'not_retryable_state' },
          }),
          item({
            id: '55555555-aaaa-4bbb-8ccc-dddddddddddd',
            status: 'pending',
            statusLabel: 'Waiting',
            age: { minutes: 20, basis: 'overdue' },
            retry: { allowed: false, code: 'retry_window_passed' },
          }),
          item({ id: '66666666-aaaa-4bbb-8ccc-dddddddddddd', retry: { allowed: false, code: 'no_due_time' }, cancel: { allowed: false, code: 'not_cancellable_state' } }),
        ]),
      },
    });
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(within(panel).getAllByTestId('queue-item-row')).toHaveLength(6));
    const rows = within(panel).getAllByTestId('queue-item-row').map((r) => r.textContent);
    expect(rows[0]).toContain('Acme Plumbing');
    expect(rows[0]).toContain('abcdef12');
    expect(rows[0]).not.toContain('abcdef12-3456');
    expect(within(panel).getByText('abcdef12')).toHaveAttribute('title', 'abcdef12-3456-4789-8abc-def012345678');
    expect(rows[0]).toContain('Follow-up to a lead');
    expect(rows[0]).toContain('Failed');
    expect(rows[0]).toContain('queued 2026-10-04 08:00 UTC');
    expect(rows[0]).toContain('4 h 0 min since it was queued');
    expect(rows[0]).toContain('until 2026-10-07 08:00 UTC');
    expect(rows[0]).not.toContain('sending hours');
    // Slice 7b: a cancellable row's Cancellable cell is the "Cancel item" button.
    expect(rows[0]).toMatch(/Cancel item$/);
    expect(rows[1]).toContain('stuck 25 min (claimed)');
    // CR7A-3: an expired lease on the Stuck tab is not "held" by a run.
    expect(rows[1]).toContain("no: claimed by a run; the queue's own sweep releases it");
    expect(rows[1]).not.toContain('a run holds it');
    expect(rows[2]).toContain('no lease recorded');
    expect(rows[3]).toContain('next try 2026-10-04 12:15 UTC');
    expect(rows[3]).toContain('due in 15 min');
    expect(rows[4]).toContain('overdue by 20 min');
    expect(rows[4]).toContain('no: queued more than 72 h ago');
    expect(rows[5]).toContain('no: no due time recorded');
  });

  it('W7A-4: the age words and the header match each queue\'s anchor', async () => {
    itemsReply = (params) => {
      const queue = params.get('queue');
      const age =
        queue === 'payment_reminders'
          ? { minutes: 240, basis: 'since_due' as const }
          : queue === 'daily_briefing_sends'
            ? { minutes: 240, basis: 'since_day_start' as const }
            : { minutes: 240, basis: 'since_queued' as const };
      return { status: 200, body: { success: true, data: itemsView(params, [item({ age })]) } };
    };
    render(<AdminJobsQueuesPage />);
    const expectations: Array<[string, string, string]> = [
      ['payment_reminders', '4 h 0 min since it was due', 'counted from when they were due'],
      ['daily_briefing_sends', '4 h 0 min since its business day began', 'counted from when their business day began'],
      ['lead_responses', '4 h 0 min since it was queued', 'counted from when they were queued'],
      ['insight_actions', '4 h 0 min since it was queued', 'counted from when they were queued'],
    ];
    for (const [queue, ageText, header] of expectations) {
      const card = await screen.findByTestId(`queue-${queue}`);
      fireEvent.click(within(card).getByRole('button', { name: 'View items' }));
      const panel = await screen.findByTestId(`queue-items-${queue}`);
      await waitFor(() => expect(within(panel).getByTestId('queue-item-row').textContent).toContain(ageText));
      expect(panel.textContent).toContain(header);
    }
  });

  it('U-11 / W7A-7(c): payment reminders say "within the business\'s sending hours"; a briefing says until its day ends', async () => {
    itemsReply = (params) => ({
      status: 200,
      body: {
        success: true,
        data: itemsView(params, [
          item({
            due: params.get('queue') === 'payment_reminders' ? { basis: 'scheduled', at: '2026-10-04T08:00:00.000Z' } : { basis: 'business_day', date: '2026-10-04' },
            retry: { allowed: true, until: params.get('queue') === 'payment_reminders' ? '2026-10-07T08:00:00.000Z' : '2026-10-04T21:00:00.000Z' },
          }),
        ]),
      },
    });
    render(<AdminJobsQueuesPage />);
    fireEvent.click(within(await screen.findByTestId('queue-payment_reminders')).getByRole('button', { name: 'View items' }));
    fireEvent.click(within(screen.getByTestId('queue-daily_briefing_sends')).getByRole('button', { name: 'View items' }));
    const reminders = await screen.findByTestId('queue-items-payment_reminders');
    const briefing = await screen.findByTestId('queue-items-daily_briefing_sends');
    await waitFor(() =>
      expect(within(reminders).getByTestId('queue-item-row').textContent).toContain(
        "until 2026-10-07 08:00 UTC (within the business's sending hours)"
      )
    );
    expect(within(reminders).getByTestId('queue-item-row').textContent).toContain('2026-10-04 08:00 UTC');
    const briefingRow = within(briefing).getByTestId('queue-item-row').textContent;
    expect(briefingRow).toContain('until its business day ends (2026-10-04 21:00 UTC)');
    expect(briefingRow).toContain('business day 2026-10-04');
    expect(briefingRow).not.toContain('sending hours');
  });

  it('refusal words for the briefing and payment automations', async () => {
    itemsReply = (params) => ({
      status: 200,
      body: {
        success: true,
        data: itemsView(params, [
          item({
            retry:
              params.get('queue') === 'payment_automations'
                ? { allowed: false, code: 'retry_not_offered' }
                : params.get('queue') === 'daily_briefing_sends'
                  ? { allowed: false, code: 'briefing_not_today' }
                  : { allowed: false, code: 'retry_window_passed' },
          }),
        ]),
      },
    });
    render(<AdminJobsQueuesPage />);
    for (const [queue, words] of [
      ['payment_automations', 'no: never re-sent on this queue'],
      ['daily_briefing_sends', "no: the briefing's day has passed"],
      ['payment_reminders', 'no: due more than 72 h ago'],
    ] as const) {
      fireEvent.click(within(await screen.findByTestId(`queue-${queue}`)).getByRole('button', { name: 'View items' }));
      const panel = await screen.findByTestId(`queue-items-${queue}`);
      await waitFor(() => expect(within(panel).getByTestId('queue-item-row').textContent).toContain(words));
    }
  });
});

describe('U-4 / U-5: tabs and paging', () => {
  beforeEach(() => {
    itemsReply = (params) => {
      const page = Number(params.get('page'));
      const count = page < 3 ? 50 : 32;
      const items = Array.from({ length: count }, (_, i) =>
        item({ id: `${String(page).padStart(2, '0')}${String(i).padStart(6, '0')}-aaaa-4bbb-8ccc-dddddddddddd` })
      );
      return { status: 200, body: { success: true, data: itemsView(params, items, 132) } };
    };
  });

  it('U-5: "Showing 1–50 of 132"; Next goes to page 2; Previous disabled on page 1; Next disabled on the last page', async () => {
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('Showing 1–50 of 132'));
    const previous = within(panel).getByRole('button', { name: 'Previous' });
    const next = within(panel).getByRole('button', { name: 'Next' });
    expect(previous).toBeDisabled();
    expect(next).toBeEnabled();
    fireEvent.click(next);
    await waitFor(() => expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('Showing 51–100 of 132'));
    expect(itemUrls().at(-1)).toBe('/api/admin/jobs-queues/items?queue=lead_responses&state=stuck&page=2');
    expect(previous).toBeEnabled();
    fireEvent.click(next);
    await waitFor(() => expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('Showing 101–132 of 132'));
    expect(next).toBeDisabled();
    fireEvent.click(previous);
    await waitFor(() => expect(itemUrls().at(-1)).toContain('page=2'));
  });

  it('U-5: both disabled while loading', async () => {
    let release!: () => void;
    const first = itemsReply;
    itemsReply = (params) => new Promise<Reply>((resolve) => (release = () => resolve(first(params) as Reply)));
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(itemCalls()).toHaveLength(1));
    expect(panel).toHaveAttribute('aria-busy', 'true');
    expect(within(panel).getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'Next' })).toBeDisabled();
    await act(async () => release());
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Next' })).toBeEnabled());
    expect(panel).toHaveAttribute('aria-busy', 'false');
  });

  it('U-4: a tab asks for that state, page 1; changing tab after paging resets to page 1', async () => {
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Next' })).toBeEnabled());
    fireEvent.click(within(panel).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(itemUrls().at(-1)).toContain('page=2'));
    fireEvent.click(within(panel).getByRole('button', { name: 'Dead-lettered' }));
    await waitFor(() => expect(itemUrls().at(-1)).toBe('/api/admin/jobs-queues/items?queue=lead_responses&state=dead_lettered&page=1'));
    expect(within(panel).getByRole('button', { name: 'Dead-lettered' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).getByRole('button', { name: 'Stuck' })).toHaveAttribute('aria-pressed', 'false');
    for (const [label, state] of [['Failed', 'failed'], ['Waiting', 'waiting'], ['Stuck', 'stuck']] as const) {
      fireEvent.click(within(panel).getByRole('button', { name: label }));
      await waitFor(() => expect(itemUrls().at(-1)).toBe(`/api/admin/jobs-queues/items?queue=lead_responses&state=${state}&page=1`));
    }
  });
});

describe('CR7A-2 / QA-7A-1: the 20-page cap', () => {
  it('a list of 1,500 says "(first 1,000 shown)"; on page 20 Next is disabled', async () => {
    itemsReply = (params) => {
      // One row per page keeps 19 page turns fast; the Showing line still counts from the page.
      const page = Number(params.get('page'));
      const items = [item({ id: `${String(page).padStart(2, '0')}000000-aaaa-4bbb-8ccc-dddddddddddd` })];
      return { status: 200, body: { success: true, data: itemsView(params, items, 1500) } };
    };
    const panel = await openPanel('lead_responses');
    const showing = () => within(panel).getByTestId('queue-items-showing').textContent;
    await waitFor(() => expect(showing()).toBe('Showing 1–1 of 1500 (first 1,000 shown)'));
    for (let page = 2; page <= 20; page += 1) {
      await waitFor(() => expect(within(panel).getByRole('button', { name: 'Next' })).toBeEnabled());
      fireEvent.click(within(panel).getByRole('button', { name: 'Next' }));
      await waitFor(() => expect(itemUrls().at(-1)).toContain(`page=${page}`));
    }
    await waitFor(() => expect(showing()).toBe('Showing 951–951 of 1500 (first 1,000 shown)'));
    expect(within(panel).getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'Previous' })).toBeEnabled();
    expect(itemUrls().some((url) => url.includes('page=21'))).toBe(false);
    expect(within(panel).queryByTestId('queue-items-error')).toBeNull();
  }, 30_000);

  it('no note when the total is within the cap', async () => {
    itemsReply = (params) => ({ status: 200, body: { success: true, data: itemsView(params, [item()], 1000) } });
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('Showing 1–1 of 1000'));
  });
});

describe('W7A-2: past the end, and refresh resets to page 1', () => {
  it('a Drain now shrinks the list while on page 2 → the panel goes back to page 1, with no error', async () => {
    let shrunk = false;
    itemsReply = (params) => {
      const page = Number(params.get('page'));
      // Page 2 after the drain is past the end: the route answers total null.
      if (shrunk && page > 1) return { status: 200, body: { success: true, data: itemsView(params, [], null) } };
      const total = shrunk ? 3 : 132;
      const items = Array.from({ length: shrunk ? 3 : 50 }, (_, i) => item({ id: `${page}-${i}-aaaaaaaa` }));
      return { status: 200, body: { success: true, data: itemsView(params, items, total) } };
    };
    drainReply = () => {
      shrunk = true;
      return { status: 200, body: { success: true, data: { queue: 'lead_responses', counts: [], durationMs: 10 } } };
    };
    const user = userEvent.setup();
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Next' })).toBeEnabled());
    fireEvent.click(within(panel).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('Showing 51–100 of 132'));
    const before = itemCalls().length;

    // The real Drain now dialog on the same card; its success refreshes the page.
    await user.click(within(screen.getByTestId('queue-lead_responses')).getByRole('button', { name: 'Drain now' }));
    const dialog = await screen.findByTestId('drain-dialog');
    await user.type(within(dialog).getByLabelText(/Why are you draining this queue/), 'stuck backlog');
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('Showing 1–3 of 3'));
    expect(itemUrls().slice(before).every((u) => u.endsWith('&page=1'))).toBe(true);
    expect(within(panel).queryByTestId('queue-items-error')).toBeNull();
    expect(mockLoggerError).not.toHaveBeenCalled();
  }, 20000);

  it('a past-the-end answer for page 2 snaps back to page 1 once', async () => {
    let calls = 0;
    itemsReply = (params) => {
      calls += 1;
      const page = Number(params.get('page'));
      if (page === 2) return { status: 200, body: { success: true, data: itemsView(params, [], null) } };
      return { status: 200, body: { success: true, data: itemsView(params, [item()], calls === 1 ? 132 : 1) } };
    };
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Next' })).toBeEnabled());
    fireEvent.click(within(panel).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('Showing 1–1 of 1'));
    expect(itemUrls().map((u) => new URLSearchParams(u.slice(ITEMS_PREFIX.length)).get('page'))).toEqual(['1', '2', '1']);
  });

  it('a refresh (a new refreshKey) resets the open list to page 1', async () => {
    itemsReply = (params) => ({
      status: 200,
      body: { success: true, data: itemsView(params, Array.from({ length: 50 }, (_, i) => item({ id: `${params.get('page')}-${i}-aaaa` })), 132) },
    });
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(within(panel).getByRole('button', { name: 'Next' })).toBeEnabled());
    fireEvent.click(within(panel).getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('Showing 51–100 of 132'));
    const before = itemCalls().length;
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('Showing 1–50 of 132'));
    // One request for the refresh, and it asks for page 1 (not page 2 first).
    expect(itemUrls().slice(before)).toEqual(['/api/admin/jobs-queues/items?queue=lead_responses&state=stuck&page=1']);
  });
});

describe('W7A-5: an older response never overwrites a newer one', () => {
  it('switching Stuck → Failed before the first answer: only Failed rows render', async () => {
    const held: Array<{ params: URLSearchParams; resolve: (r: Reply) => void }> = [];
    itemsReply = (params) => new Promise<Reply>((resolve) => held.push({ params, resolve }));
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(held).toHaveLength(1));
    fireEvent.click(within(panel).getByRole('button', { name: 'Failed' }));
    await waitFor(() => expect(held).toHaveLength(2));
    // The first request was aborted.
    expect((itemCalls()[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    expect((itemCalls()[1][1] as { signal: AbortSignal }).signal.aborted).toBe(false);

    await act(async () =>
      held[1].resolve({ status: 200, body: { success: true, data: itemsView(held[1].params, [item({ businessName: 'Failed Co' })]) } })
    );
    await waitFor(() => expect(within(panel).getByTestId('queue-item-row').textContent).toContain('Failed Co'));
    // The stale Stuck answer arrives last, and is ignored.
    await act(async () =>
      held[0].resolve({ status: 200, body: { success: true, data: itemsView(held[0].params, [item({ businessName: 'Stuck Co' })]) } })
    );
    expect(within(panel).getAllByTestId('queue-item-row')).toHaveLength(1);
    expect(panel.textContent).not.toContain('Stuck Co');
    expect(panel.textContent).toContain('Failed Co');
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it('closing the panel mid-request aborts it, and is not an error', async () => {
    let release!: () => void;
    itemsReply = () => new Promise<Reply>((resolve) => (release = () => resolve({ status: 500, body: null })));
    await openPanel('lead_responses');
    await waitFor(() => expect(itemCalls()).toHaveLength(1));
    fireEvent.click(within(screen.getByTestId('queue-lead_responses')).getByRole('button', { name: 'Hide items' }));
    expect((itemCalls()[0][1] as { signal: AbortSignal }).signal.aborted).toBe(true);
    await act(async () => release());
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});

describe('U-6 / U-7: empty and failures', () => {
  it('U-6: an empty state says so', async () => {
    itemsReply = (params) => ({ status: 200, body: { success: true, data: itemsView(params, [], 0) } });
    const panel = await openPanel('payment_automations');
    expect((await within(panel).findByTestId('queue-items-empty')).textContent).toBe('No items in this state.');
    expect(within(panel).getByTestId('queue-items-showing').textContent).toBe('');
  });

  it.each([
    [500, null, 'Could not load the items. Try again in a moment.'],
    [500, { success: false, error: 'SERVER-ERROR-TEXT', details: 'SERVER-DETAILS' }, 'Could not load the items. Try again in a moment.'],
    [401, { success: false, error: 'Unauthorized SERVER-ERROR-TEXT' }, 'Your admin session has ended. Sign in again.'],
    [403, { success: false, error: 'Forbidden SERVER-ERROR-TEXT' }, 'Your admin session has ended. Sign in again.'],
  ])('U-7: HTTP %i shows a fixed sentence, never the server text', async (status, body, sentence) => {
    itemsReply = () => ({ status, body });
    const panel = await openPanel('lead_responses');
    expect((await within(panel).findByTestId('queue-items-error')).textContent).toBe(sentence);
    expect(document.body.innerHTML).not.toMatch(/SERVER-ERROR-TEXT|SERVER-DETAILS/);
  });
});

describe('U-8 / U-9 / W7A-10: no leak, no action', () => {
  it('U-8: extra fields a response might carry are never rendered', async () => {
    itemsReply = (params) => ({
      status: 200,
      body: {
        success: true,
        data: {
          ...itemsView(params, []),
          userId: 'SENTINEL-ACCOUNT',
          items: [
            {
              ...item(),
              error_message: 'SENTINEL-ERR',
              skip_reason: 'SENTINEL-SKIP',
              payload: { to: 'sentinel@client.test' },
              userId: 'SENTINEL-ACCOUNT',
              timezone: 'SENTINEL/Zone',
              kind: 'SENTINEL-KIND',
            },
          ],
        },
      },
    });
    const panel = await openPanel('lead_responses');
    await within(panel).findByTestId('queue-item-row');
    expect(document.body.innerHTML).not.toMatch(/SENTINEL|sentinel|client\.test/);
  });

  // Amended by slice 7b (workplan §2.8): the four tabs, then one "Cancel item"
  // per cancellable row, then Previous / Next. "Cancel item" is the ONE action
  // word allowed, and only as a button inside a cell.
  it('W7A-10 / 7b: the open panel\'s buttons are the four tabs, one Cancel item per cancellable row, and Previous / Next', async () => {
    itemsReply = (params) => ({
      status: 200,
      body: {
        success: true,
        data: itemsView(params, [
          item(),
          item({ id: '22222222-aaaa-4bbb-8ccc-dddddddddddd', cancel: { allowed: false, code: 'not_cancellable_state' } }),
          item({ id: '33333333-aaaa-4bbb-8ccc-dddddddddddd', cancel: { allowed: true } }),
        ]),
      },
    });
    const panel = await openPanel('lead_responses');
    await waitFor(() => expect(within(panel).getAllByTestId('queue-item-row')).toHaveLength(3));
    expect(within(panel).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Stuck',
      'Failed',
      'Dead-lettered',
      'Waiting',
      'Cancel item',
      'Cancel item',
      'Previous',
      'Next',
    ]);
    for (const button of within(panel).getAllByRole('button')) {
      if (button.textContent === 'Cancel item') continue;
      expect(button.textContent).not.toMatch(/retry|re-send|cancel|requeue|release|drain/i);
    }
    // The column headers are header cells, not buttons.
    expect(within(panel).getByRole('columnheader', { name: 'Re-send' })).toBeInTheDocument();
    expect(within(panel).getByRole('columnheader', { name: 'Cancellable' })).toBeInTheDocument();
    expect(panel.querySelectorAll('td button')).toHaveLength(2);
    expect(panel.querySelectorAll('td a, td input')).toHaveLength(0);
  });

  it('no green class anywhere in the panel', async () => {
    const panel = await openPanel('lead_responses');
    await within(panel).findByTestId('queue-item-row');
    expect(panel.innerHTML).not.toMatch(/\b(?:bg|text|border)-(?:green|emerald)-/);
  });
});

describe('U-10: Refresh reloads the jobs view and the open list', () => {
  it('both refetch', async () => {
    const panel = await openPanel('lead_responses');
    await within(panel).findByTestId('queue-item-row');
    const jobsBefore = jobsCalls().length;
    const itemsBefore = itemCalls().length;
    fireEvent.click(screen.getByRole('button', { name: /Refresh/ }));
    await waitFor(() => expect(jobsCalls().length).toBe(jobsBefore + 1));
    await waitFor(() => expect(itemCalls().length).toBe(itemsBefore + 1));
  });
});

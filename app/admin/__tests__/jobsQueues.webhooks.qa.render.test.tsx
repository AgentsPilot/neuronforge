/**
 * @jest-environment jsdom
 */

/**
 * QA edge cases for the "Stripe webhook events" block on the Scheduled jobs &
 * queues page (plan payments P-8b.3b, AM-4; SA P3-SA-7, P3-SA-9).
 *
 * Adds to the Dev render suite: the block failing (500, 409, network) still
 * shows the jobs; exactly one block read on mount AFTER the jobs read has
 * settled (the jobs view's own refreshKey bump must not re-read it); one
 * Refresh is exactly one more read; the jobs "Try again" does not re-read the
 * block; a refresh that fails keeps the last figures; exactly 200 per state
 * has no "At least"; the singular count line; a row whose id is not an
 * `evt_` id renders as text with no link; and the named region.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }),
}));
jest.mock('@/lib/logger/client', () => {
  const rec = () => undefined;
  return { clientLogger: { child: () => ({ error: rec, warn: rec, info: rec, debug: rec }) } };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import AdminJobsQueuesPage from '../jobs-queues/page';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { CronRunSummaryRow } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { JobsQueuesView } from '@/lib/admin/jobs/jobsQueuesTypes';
import { buildWebhookEventsView, type WebhookEventsInput } from '@/lib/admin/jobs/webhookEventsView';
import type { WebhookEventsPayload } from '@/lib/admin/jobs/webhookEventsTypes';
import type { AdminWebhookEventRow } from '@/lib/repositories/AdminWebhookEventReadRepository';
import { WEBHOOK_EVENTS_MODE_UNKNOWN } from '@/lib/admin/jobs/webhookEventsTypes';
import { STALE_CLAIM_AGE_MS } from '@/lib/repositories/ProcessedWebhookEventRepository';
import { BOS_QUEUES } from '@/lib/cron/bosCronJobs';
import { quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

const JOBS_URL = '/api/admin/jobs-queues';
const WEBHOOKS_URL = '/api/admin/jobs-queues/webhook-events';
const NOW = new Date('2026-10-28T12:00:00.000Z');

function jobsView(): JobsQueuesView {
  return buildJobsQueuesView(
    {
      runs: { state: 'ok', rows: quietSummaryRows(NOW) as CronRunSummaryRow[] },
      queues: Object.fromEntries(BOS_QUEUES.map((q) => [q.id, { ok: true as const, figures: quietQueueFigures({}) }])),
    },
    NOW
  );
}

function row(id: string, minutesAgo: number, patch: Partial<AdminWebhookEventRow> = {}): AdminWebhookEventRow {
  return {
    event_id: id,
    event_type: 'invoice.payment_failed',
    status: 'failed',
    processed_at: '2026-10-28T11:30:00.000Z',
    failure_message: 'boom',
    metadata: { created: Math.floor((NOW.getTime() - minutesAgo * 60_000) / 1000), livemode: false },
    ...patch,
  };
}

function payload(patch: Partial<WebhookEventsInput> = {}): WebhookEventsPayload {
  return buildWebhookEventsView({
    mode: 'test',
    now: NOW,
    counts: { failed: 0, stuck: 0 },
    lists: { failed: [], stuck: [] },
    noMode: { failed: 0, stuck: 0 },
    readPerState: 200,
    staleAfterMs: STALE_CLAIM_AGE_MS,
    ...patch,
  });
}

type Answer = { status: number; body: unknown } | 'network';
let fetchMock: jest.Mock;

function mockFetch(webhooks: Answer | Answer[], jobs: Answer | Answer[] = { status: 200, body: { success: true, data: jobsView() } }) {
  const wq = Array.isArray(webhooks) ? [...webhooks] : [webhooks];
  const jq = Array.isArray(jobs) ? [...jobs] : [jobs];
  const next = (q: Answer[]) => (q.length > 1 ? q.shift()! : q[0]);
  fetchMock = jest.fn(async (url: string) => {
    const answer = url === WEBHOOKS_URL ? next(wq) : url === JOBS_URL ? next(jq) : null;
    if (answer === null) throw new Error(`unexpected fetch ${url}`);
    if (answer === 'network') throw new TypeError('Failed to fetch');
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

const ok = (data: WebhookEventsPayload): Answer => ({ status: 200, body: { success: true, data } });
const webhookCalls = () => fetchMock.mock.calls.filter(([url]) => url === WEBHOOKS_URL).length;
const jobsCalls = () => fetchMock.mock.calls.filter(([url]) => url === JOBS_URL).length;

/** Let every pending promise and effect run. */
async function settle() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function renderPage() {
  render(<AdminJobsQueuesPage />);
  const block = await screen.findByTestId('webhook-events');
  await waitFor(() => expect(within(block).queryByText(/^Reading the webhook events/)).toBeNull());
  return block;
}

async function jobsShown() {
  await waitFor(() => expect(document.getElementById('jobs')).not.toBeNull());
  expect(document.getElementById('queues')).not.toBeNull();
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('QA: isolation both ways (P3-SA-7)', () => {
  it.each<[string, Answer]>([
    ['a 500', { status: 500, body: { success: false, error: 'Could not read the webhook events. Try again.' } }],
    ['a 409', { status: 409, body: { success: false, error: WEBHOOK_EVENTS_MODE_UNKNOWN } }],
    ['a network failure', 'network'],
  ])('the block failing with %s still shows the jobs and queues', async (_label, answer) => {
    mockFetch(answer);
    const block = await renderPage();
    await jobsShown();
    expect(within(block).getByTestId('webhook-events-error')).toBeTruthy();
    expect(screen.queryByTestId('jobs-error')).toBeNull();
  });

  it('both failing: each shows its own error', async () => {
    mockFetch({ status: 500, body: { success: false, error: 'x' } }, { status: 500, body: { success: false, error: 'y' } });
    const block = await renderPage();
    await screen.findByTestId('jobs-error');
    expect(within(block).getByTestId('webhook-events-error')).toBeTruthy();
  });
});

describe('QA: reads (no double read, one per Refresh)', () => {
  it('exactly one block read on mount, after the jobs read has fully settled', async () => {
    mockFetch(ok(payload()));
    await renderPage();
    await jobsShown();
    await settle();
    expect(jobsCalls()).toBe(1);
    expect(webhookCalls()).toBe(1);
  });

  it('one Refresh is exactly one more block read (2, never 3)', async () => {
    mockFetch(ok(payload()));
    await renderPage();
    await jobsShown();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Refresh the jobs and queues/ }));
    await settle();
    expect(webhookCalls()).toBe(2);
    expect(jobsCalls()).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: /Refresh the jobs and queues/ }));
    await settle();
    expect(webhookCalls()).toBe(3);
  });

  it("the jobs read's own Try again re-reads the jobs only, not the block", async () => {
    mockFetch(ok(payload()), [{ status: 500, body: { success: false, error: 'y' } }, { status: 200, body: { success: true, data: jobsView() } }]);
    await renderPage();
    const jobsError = await screen.findByTestId('jobs-error');
    await settle();
    // The Try again button follows the message, outside the testid element.
    fireEvent.click(within(jobsError.parentElement as HTMLElement).getByRole('button', { name: 'Try again' }));
    await jobsShown();
    await settle();
    expect(jobsCalls()).toBe(2);
    expect(webhookCalls()).toBe(1);
  });

  it('a Refresh that fails keeps the last figures on screen beside the error', async () => {
    const first = payload({ counts: { failed: 1, stuck: 0 }, lists: { failed: [row('evt_K1', 30)], stuck: [] } });
    mockFetch([ok(first), { status: 500, body: { success: false, error: 'Could not read the webhook events. Try again.' } }]);
    const block = await renderPage();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: /Refresh the jobs and queues/ }));
    await within(block).findByTestId('webhook-events-error');
    expect(within(block).getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 1');
    expect(within(block).getByTestId('webhook-row-evt_K1')).toBeTruthy();
  });
});

describe('QA: limits in words', () => {
  it('exactly 200 in a state: no "At least" and no partial-order sentence', async () => {
    const failed = Array.from({ length: 200 }, (_, i) => row(`evt_E${i}`, 100 + i));
    mockFetch(ok(payload({ counts: { failed: 200, stuck: 0 }, lists: { failed, stuck: [] } })));
    const block = await renderPage();
    expect(within(block).getByTestId('webhook-kpi-oldest').textContent).toBe('4 h 59 min');
    expect(within(block).getByTestId('webhook-count-line').textContent).toBe('Showing 50 of 200 unfinished events, oldest first.');
  });

  it('201 in a state: "At least" on the tile, its accessible name, and the partial sentence', async () => {
    const failed = Array.from({ length: 200 }, (_, i) => row(`evt_E${i}`, 100 + i));
    mockFetch(ok(payload({ counts: { failed: 201, stuck: 0 }, lists: { failed, stuck: [] } })));
    const block = await renderPage();
    expect(within(block).getByTestId('webhook-kpi-oldest-kpi').getAttribute('aria-label')).toBe('Oldest unfinished, At least 4 h 59 min');
    expect(within(block).getByTestId('webhook-count-line').textContent).toContain('The order covers the first 200 read for each state.');
  });

  it('one event: the singular count line', async () => {
    mockFetch(ok(payload({ counts: { failed: 1, stuck: 0 }, lists: { failed: [row('evt_S1', 5)], stuck: [] } })));
    const block = await renderPage();
    expect(within(block).getByTestId('webhook-count-line').textContent).toBe('Showing 1 of 1 unfinished event, oldest first.');
  });

  it('1,234 matching: the thousands separator in the count line', async () => {
    const failed = Array.from({ length: 60 }, (_, i) => row(`evt_T${i}`, 100 + i));
    mockFetch(ok(payload({ counts: { failed: 1234, stuck: 0 }, lists: { failed, stuck: [] } })));
    const block = await renderPage();
    expect(within(block).getByTestId('webhook-count-line').textContent).toMatch(/^Showing 50 of 1,234 unfinished events/);
    expect(within(block).getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 1,234');
  });

  it('no-mode rows only: zero tiles, the empty list AND the no-mode line', async () => {
    mockFetch(ok(payload({ noMode: { failed: 0, stuck: 2 } })));
    const block = await renderPage();
    expect(within(block).getByTestId('webhook-events-empty')).toBeTruthy();
    expect(within(block).getByTestId('webhook-no-mode').textContent).toBe(
      '2 unfinished events have no recorded mode and are not counted above.'
    );
    expect(within(block).getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 0');
  });
});

describe('QA: accessibility and links', () => {
  it('the block is a region named by its heading', async () => {
    mockFetch(ok(payload()));
    await renderPage();
    expect(screen.getByRole('region', { name: 'Stripe webhook events' }).id).toBe('webhooks');
  });

  it('every tile has an accessible name with its value; column headers are scoped', async () => {
    mockFetch(ok(payload({ counts: { failed: 1, stuck: 0 }, lists: { failed: [row('evt_A11y', 5)], stuck: [] } })));
    const block = await renderPage();
    expect(within(block).getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 1');
    expect(within(block).getByTestId('webhook-kpi-stuck-kpi').getAttribute('aria-label')).toBe('Stuck, 0');
    expect(within(block).getByTestId('webhook-kpi-oldest-kpi').getAttribute('aria-label')).toBe('Oldest unfinished, 5 min');
    const headers = within(block).getAllByRole('columnheader');
    expect(headers.map((h) => h.textContent)).toEqual([
      'Event type',
      'State',
      'What went wrong',
      'Created at Stripe',
      'Last attempt',
      'Age',
      'Event',
    ]);
    for (const h of headers) expect(h.getAttribute('scope')).toBe('col');
  });

  it('every link opens a new tab with rel="noopener noreferrer" and names its event', async () => {
    const failed = [row('evt_L1', 3), row('evt_L2', 2, { metadata: { created: Math.floor(NOW.getTime() / 1000) - 120, livemode: true } })];
    mockFetch(ok(payload({ counts: { failed: 2, stuck: 0 }, lists: { failed, stuck: [] } })));
    const block = await renderPage();
    const links = within(block).getAllByRole('link');
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      expect(link.getAttribute('aria-label')).toMatch(/^Open evt_L\d in Stripe \(opens in a new tab\)$/);
    }
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      'https://dashboard.stripe.com/test/events/evt_L1',
      'https://dashboard.stripe.com/events/evt_L2',
    ]);
  });

  it('a row whose id is not an evt_ id renders the id as text, with no link', async () => {
    mockFetch(ok(payload({ counts: { failed: 1, stuck: 0 }, lists: { failed: [row('evt_bad/../x', 5)], stuck: [] } })));
    const block = await renderPage();
    const r = within(block).getByTestId('webhook-row-evt_bad/../x');
    expect(within(r).queryByRole('link')).toBeNull();
    expect(r.textContent).toContain('evt_bad/../x');
  });

  it('a row with no event type shows an em dash', async () => {
    mockFetch(ok(payload({ counts: { failed: 1, stuck: 0 }, lists: { failed: [row('evt_NT', 5, { event_type: null })], stuck: [] } })));
    const block = await renderPage();
    expect(within(block).getByTestId('webhook-row-evt_NT').textContent).toMatch(/^—/);
  });
});

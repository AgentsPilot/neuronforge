/**
 * @jest-environment jsdom
 */

/**
 * The "Stripe webhook events" block on the Scheduled jobs & queues page (plan
 * payments P-8b.3b, AM-4; SA P3-SA-2 items 1 to 3 and 7, P3-SA-7, P3-SA-9).
 *
 * The whole page renders with a fetch mock routed by URL; the block's payload
 * is built by the REAL builder, so the block shows what the route would send.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }),
}));
const mockLoggerCalls: unknown[][] = [];
jest.mock('@/lib/logger/client', () => {
  const rec = (...a: unknown[]) => void mockLoggerCalls.push(a);
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
import { WEBHOOK_KPI_DEFINITIONS } from '../components/jobs/webhookEventsCopy';

const JOBS_URL = '/api/admin/jobs-queues';
const WEBHOOKS_URL = '/api/admin/jobs-queues/webhook-events';
const NOW = new Date('2026-10-28T12:00:00.000Z');
const PII = 'jane.customer@example.com';

function jobsView(): JobsQueuesView {
  return buildJobsQueuesView(
    {
      runs: { state: 'ok', rows: quietSummaryRows(NOW) as CronRunSummaryRow[] },
      queues: Object.fromEntries(BOS_QUEUES.map((q) => [q.id, { ok: true as const, figures: quietQueueFigures({}) }])),
    },
    NOW
  );
}

function row(id: string, patch: Partial<AdminWebhookEventRow> & { minutesAgo?: number | null; livemode?: boolean } = {}): AdminWebhookEventRow {
  const { minutesAgo = 60, livemode = false, ...rest } = patch;
  return {
    event_id: id,
    event_type: 'invoice.payment_failed',
    status: 'failed',
    processed_at: '2026-10-28T11:30:00.000Z',
    failure_message: `No such customer: ${PII}`,
    metadata:
      minutesAgo === null ? { livemode } : { created: Math.floor((NOW.getTime() - minutesAgo * 60_000) / 1000), livemode },
    ...rest,
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

const FIVE_FAILED = (): WebhookEventsPayload =>
  payload({
    counts: { failed: 2, stuck: 1 },
    lists: {
      failed: [
        row('evt_Recent1', { minutesAgo: 30, failure_message: 'Request timed out' }),
        row('evt_Old1', { minutesAgo: 3 * 24 * 60 }),
      ],
      stuck: [row('evt_Stuck1', { minutesAgo: null, status: 'processing', failure_message: null, event_type: 'checkout.session.completed' })],
    },
  });

type Answer = { status: number; body: unknown } | 'network';

let fetchMock: jest.Mock;
function mockFetch(webhooks: Answer | Answer[], jobs: Answer = { status: 200, body: { success: true, data: jobsView() } }) {
  const queue = Array.isArray(webhooks) ? [...webhooks] : [webhooks];
  fetchMock = jest.fn(async (url: string) => {
    const answer = url === WEBHOOKS_URL ? (queue.length > 1 ? queue.shift()! : queue[0]) : url === JOBS_URL ? jobs : null;
    if (answer === null) throw new Error(`unexpected fetch ${url}`);
    if (answer === 'network') throw new TypeError('Failed to fetch');
    return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, json: async () => answer.body };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

const ok = (data: WebhookEventsPayload): Answer => ({ status: 200, body: { success: true, data } });
const webhookCalls = () => fetchMock.mock.calls.filter(([url]) => url === WEBHOOKS_URL);
const jobsCalls = () => fetchMock.mock.calls.filter(([url]) => url === JOBS_URL);

async function renderBlock() {
  render(<AdminJobsQueuesPage />);
  const block = await screen.findByTestId('webhook-events');
  await waitFor(() => expect(within(block).queryByText(/^Reading the webhook events/)).toBeNull());
  return block;
}

beforeEach(() => {
  mockLoggerCalls.length = 0;
});

describe('the request (P3-SA-9)', () => {
  it('one GET to the literal URL, no query, cache no-store; the jobs read is still one', async () => {
    mockFetch(ok(payload()));
    await renderBlock();
    await waitFor(() => expect(jobsCalls()).toHaveLength(1));
    expect(webhookCalls()).toEqual([[WEBHOOKS_URL, { cache: 'no-store' }]]);
  });

  it("the page's Refresh re-reads the jobs and the block", async () => {
    mockFetch(ok(payload()));
    await renderBlock();
    await waitFor(() => expect(jobsCalls()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /Refresh the jobs and queues/ }));
    await waitFor(() => expect(webhookCalls()).toHaveLength(2));
    await waitFor(() => expect(jobsCalls()).toHaveLength(2));
  });
});

describe('the block (P3-SA-7)', () => {
  it('section #webhooks, its title, and the mode chip', async () => {
    mockFetch(ok(payload({ mode: 'live' })));
    const block = await renderBlock();
    expect(block.tagName).toBe('SECTION');
    expect(block.id).toBe('webhooks');
    expect(within(block).getByRole('heading', { name: 'Stripe webhook events' })).toBeTruthy();
    expect(within(block).getByTestId('webhook-events-mode').textContent).toContain('Stripe live mode');
  });

  it('three tiles on the KpiStrip grid: Failed lagging, Stuck leading, Oldest unfinished leading', async () => {
    mockFetch(ok(FIVE_FAILED()));
    const block = await renderBlock();
    const failed = within(block).getByTestId('webhook-kpi-failed-kpi');
    const stuck = within(block).getByTestId('webhook-kpi-stuck-kpi');
    const oldest = within(block).getByTestId('webhook-kpi-oldest-kpi');
    expect(failed.getAttribute('aria-label')).toBe('Failed, 2');
    expect(stuck.getAttribute('aria-label')).toBe('Stuck, 1');
    expect(oldest.getAttribute('aria-label')).toBe('Oldest unfinished, 3 d 0 h');
    expect(within(block).getByTestId('webhook-kpi-failed-indicator').getAttribute('data-indicator')).toBe('lagging');
    expect(within(block).getByTestId('webhook-kpi-stuck-indicator').getAttribute('data-indicator')).toBe('leading');
    expect(within(block).getByTestId('webhook-kpi-oldest-indicator').getAttribute('data-indicator')).toBe('leading');
    // Red at 1 or more, in words; Oldest has no threshold.
    expect(within(block).getByTestId('webhook-kpi-failed-chip').textContent).toContain('Needs action');
    expect(within(block).getByTestId('webhook-kpi-stuck-chip').textContent).toContain('Needs action');
    expect(within(block).queryByTestId('webhook-kpi-oldest-chip')).toBeNull();
    // The Oldest definition names Stripe's 30-day retention.
    expect(WEBHOOK_KPI_DEFINITIONS.oldest).toMatch(/30 days/);
    expect(within(block).getByTestId('webhook-kpi-oldest-indicator-tooltip').textContent).toContain('30 days');
    expect(within(block).getByTestId('webhook-kpi-stuck-indicator-tooltip').textContent).toContain('15 minutes');
    // The tiles sit in the shared strip's grid.
    expect(failed.parentElement).toBe(oldest.parentElement);
  });

  it('no chip at zero', async () => {
    mockFetch(ok(payload()));
    const block = await renderBlock();
    expect(within(block).queryByTestId('webhook-kpi-failed-chip')).toBeNull();
    expect(within(block).queryByTestId('webhook-kpi-stuck-chip')).toBeNull();
    expect(within(block).getByTestId('webhook-kpi-oldest-kpi').getAttribute('aria-label')).toBe('Oldest unfinished, None');
  });

  it('the list: oldest first, event type, state, class in words, created or "not recorded", last attempt, age, link', async () => {
    mockFetch(ok(FIVE_FAILED()));
    const block = await renderBlock();
    const rows = within(block).getAllByTestId(/^webhook-row-/);
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'webhook-row-evt_Old1',
      'webhook-row-evt_Recent1',
      // No creation time: its age counts from the last attempt (30 min ago), tying with evt_Recent1; the id breaks the tie.
      'webhook-row-evt_Stuck1',
    ]);
    const old = rows[0];
    expect(old.textContent).toContain('invoice.payment_failed');
    expect(within(old).getByTestId('webhook-state').textContent).toContain('Failed');
    expect(within(old).getByTestId('webhook-failure').textContent).toBe('Our handler raised an error');
    expect(old.textContent).toContain('2026-10-25 12:00 UTC');
    expect(old.textContent).toContain('2026-10-28 11:30 UTC');
    expect(old.textContent).toContain('3 d 0 h');
    expect(within(rows[1]).getByTestId('webhook-failure').textContent).toBe('Timed out');
    const stuck = rows[2];
    expect(within(stuck).getByTestId('webhook-state').textContent).toContain('Stuck');
    expect(within(stuck).getByTestId('webhook-failure').textContent).toBe('Still processing after 15 minutes');
    expect(stuck.textContent).toContain('Created time not recorded');

    const link = within(old).getByRole('link', { name: 'Open evt_Old1 in Stripe (opens in a new tab)' });
    expect(link.getAttribute('href')).toBe('https://dashboard.stripe.com/test/events/evt_Old1');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.textContent).toBe('evt_Old1');

    expect(within(block).getByTestId('webhook-count-line').textContent).toBe('Showing 3 of 3 unfinished events, oldest first.');
    // P3-SA-6: never the message.
    expect(block.textContent).not.toContain(PII);
    expect(block.textContent).not.toContain('No such customer');
  });

  it('a live row links to the live dashboard', async () => {
    mockFetch(
      ok(payload({ mode: 'live', counts: { failed: 1, stuck: 0 }, lists: { failed: [row('evt_L1', { livemode: true })], stuck: [] } }))
    );
    const block = await renderBlock();
    expect(within(block).getByRole('link', { name: /evt_L1/ }).getAttribute('href')).toBe('https://dashboard.stripe.com/events/evt_L1');
  });

  it('above 200 in a state: the Oldest tile says "At least" and the count line says the order covers the first 200', async () => {
    const failed = Array.from({ length: 200 }, (_, i) => row(`evt_F${i}`, { minutesAgo: 100 + i }));
    mockFetch(ok(payload({ counts: { failed: 340, stuck: 0 }, lists: { failed, stuck: [] } })));
    const block = await renderBlock();
    expect(within(block).getByTestId('webhook-kpi-oldest').textContent).toBe('At least 4 h 59 min');
    expect(within(block).getAllByTestId(/^webhook-row-/)).toHaveLength(50);
    expect(within(block).getByTestId('webhook-count-line').textContent).toBe(
      'Showing 50 of 340 unfinished events, oldest first. The order covers the first 200 read for each state.'
    );
  });

  it('empty: says so for the mode, with zero tiles', async () => {
    mockFetch(ok(payload()));
    const block = await renderBlock();
    expect(within(block).getByTestId('webhook-events-empty').textContent).toBe(
      'No failed or stuck webhook events in Stripe test mode.'
    );
    expect(within(block).queryByTestId('webhook-count-line')).toBeNull();
  });

  it('Q-P3-7: a count line for rows with no mode; nothing at zero', async () => {
    mockFetch(ok(payload({ noMode: { failed: 2, stuck: 1 } })));
    let block = await renderBlock();
    expect(within(block).getByTestId('webhook-no-mode').textContent).toBe(
      '3 unfinished events have no recorded mode and are not counted above.'
    );
    document.body.innerHTML = '';
    mockFetch(ok(payload({ noMode: { failed: 1, stuck: 0 } })));
    block = await renderBlock();
    expect(within(block).getByTestId('webhook-no-mode').textContent).toBe(
      '1 unfinished event has no recorded mode and is not counted above.'
    );
    document.body.innerHTML = '';
    mockFetch(ok(payload()));
    block = await renderBlock();
    expect(within(block).queryByTestId('webhook-no-mode')).toBeNull();
  });
});

describe('failure states', () => {
  it('a failed jobs read does not hide the block (P3-SA-7)', async () => {
    mockFetch(ok(FIVE_FAILED()), { status: 500, body: { success: false, error: 'Could not build the jobs and queues view' } });
    const block = await renderBlock();
    await screen.findByTestId('jobs-error');
    expect(within(block).getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 2');
    expect(within(block).getAllByTestId(/^webhook-row-/)).toHaveLength(3);
  });

  it('a 409 shows the existing unknown-mode words, and no tiles', async () => {
    mockFetch({ status: 409, body: { success: false, error: WEBHOOK_EVENTS_MODE_UNKNOWN } });
    const block = await renderBlock();
    expect(within(block).getByTestId('webhook-events-error').textContent).toBe(WEBHOOK_EVENTS_MODE_UNKNOWN);
    expect(within(block).queryByTestId('webhook-kpi-failed-kpi')).toBeNull();
    expect(within(block).queryByTestId('webhook-events-mode')).toBeNull();
  });

  it('a 401 says the session ended; a network failure has its own words; logs carry status or err only', async () => {
    mockFetch({ status: 401, body: { success: false, error: 'Unauthorized' } });
    let block = await renderBlock();
    expect(within(block).getByTestId('webhook-events-error').textContent).toBe('Your admin session has ended. Sign in again.');
    document.body.innerHTML = '';
    mockFetch('network');
    block = await renderBlock();
    expect(within(block).getByTestId('webhook-events-error').textContent).toBe(
      'Could not reach the server. Check your connection and try again.'
    );
    for (const [ctx] of mockLoggerCalls) {
      for (const key of Object.keys(ctx as object)) expect(['status', 'err']).toContain(key);
    }
  });

  it('"Try again" reads the block again and a later success replaces the error', async () => {
    mockFetch([{ status: 500, body: { success: false, error: 'Could not read the webhook events. Try again.' } }, ok(FIVE_FAILED())]);
    const block = await renderBlock();
    expect(within(block).getByTestId('webhook-events-error').textContent).toBe('Could not read the webhook events. Try again.');
    fireEvent.click(within(block).getByRole('button', { name: 'Try again' }));
    expect(await within(block).findAllByTestId(/^webhook-row-/)).toHaveLength(3);
    expect(within(block).queryByTestId('webhook-events-error')).toBeNull();
    expect(webhookCalls()).toHaveLength(2);
  });
});

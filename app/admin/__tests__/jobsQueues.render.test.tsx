/**
 * @jest-environment jsdom
 */

/**
 * The "Scheduled jobs & queues" page (admin reorganisation slice 5, part C):
 * renders what the route sends; read-only apart from one Drain now per queue
 * (slice 7d); "Due now" and
 * "Scheduled for later" are separate; green only on Healthy / Clear, with a
 * text label; the "not installed" sentence; no forbidden field names.
 */

import React from 'react';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }),
}));

import AdminJobsQueuesPage from '../jobs-queues/page';
import { JOB_TONE, QUEUE_TONE, TONE_CLASSES, formatUtc } from '../components/jobs/JobsQueuesView';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { CronRunSummaryRow } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { JobsQueuesView } from '@/lib/admin/jobs/jobsQueuesTypes';
import { BOS_QUEUES, findBosCronJob } from '@/lib/cron/bosCronJobs';
import { fixtureRow, fixtureRun, quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

const GREEN = /\b(?:bg|text|border)-(?:green|emerald)-/;
const NOW = new Date('2026-09-27T12:00:00.000Z');

function view(): JobsQueuesView {
  const lead = findBosCronJob('lead-response')!;
  const rows = (quietSummaryRows(NOW) as CronRunSummaryRow[]).map((r) =>
    r.job === 'lead-response'
      ? (fixtureRow(lead, NOW, [
          fixtureRun(lead, NOW, 1, { outcome: 'failed', error_class: 'http_error', http_status: 500 }),
        ]) as CronRunSummaryRow)
      : r
  );
  return buildJobsQueuesView(
    {
      runs: { state: 'ok', rows },
      queues: Object.fromEntries(
        BOS_QUEUES.map((q) => [
          q.id,
          q.id === 'insight_actions'
            ? { ok: false as const }
            : { ok: true as const, figures: quietQueueFigures({ dueNow: 2, later: 7 }) },
        ])
      ),
    },
    NOW
  );
}

function mockRoute(data: JobsQueuesView = view(), ok = true) {
  const fetchMock = jest.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => (ok ? { success: true, data } : { success: false, error: 'Forbidden' }),
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  return fetchMock;
}

beforeEach(() => jest.clearAllMocks());

describe('the Scheduled jobs & queues page', () => {
  it('fetches with no parameters and no-store', async () => {
    const fetchMock = mockRoute();
    render(<AdminJobsQueuesPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]).toEqual(['/api/admin/jobs-queues', { cache: 'no-store' }]);
  });

  it('lists all 13 jobs and all 5 queues, with a text status label each', async () => {
    mockRoute();
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('job-calendar-sync');
    // 13 since credit deduction slice 4b added the nightly credit leak check.
    expect(document.querySelectorAll('[data-testid^="job-"]')).toHaveLength(13);
    expect(document.querySelectorAll('[data-testid^="queue-"]')).toHaveLength(5);
    expect(within(screen.getByTestId('job-lead-response')).getByTestId('status-badge').textContent).toBe('Last run failed');
    expect(within(screen.getByTestId('job-calendar-sync')).getByTestId('status-badge').textContent).toBe('Healthy');
    expect(within(screen.getByTestId('queue-insight_actions')).getByTestId('status-badge').textContent).toBe('Could not check');
  });

  it('shows "Due now" and "Scheduled for later" as separate figures', async () => {
    mockRoute();
    render(<AdminJobsQueuesPage />);
    const queue = await screen.findByTestId('queue-lead_responses');
    expect(within(queue).getByText('Due now').nextSibling?.textContent).toBe('2');
    expect(within(queue).getByText('Scheduled for later (not a backlog)').nextSibling?.textContent).toBe('7');
  });

  // Amended deliberately by ADMIN_BOS_CLEANUP slice 7d (SA W7D-2, OP-3): the
  // page was "Refresh only"; it is now Refresh plus one Drain now per queue.
  // Amended again by slice 7a (SA OP-11): plus one "View items" per queue
  // (a read-only toggle), with every item list closed, and nothing else.
  it('the only buttons are Refresh, one Drain now and one View items per queue', async () => {
    mockRoute();
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('job-calendar-sync');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1 + 5 + 5);
    expect(buttons.filter((b) => b.textContent?.includes('Refresh'))).toHaveLength(1);
    const drains = buttons.filter((b) => b.textContent === 'Drain now');
    expect(drains).toHaveLength(5);
    expect(buttons.filter((b) => b.textContent === 'View items')).toHaveLength(5);
    for (const queue of BOS_QUEUES) {
      const inCard = within(screen.getByTestId(`queue-${queue.id}`)).getAllByRole('button');
      expect(inCard.map((b) => b.textContent)).toEqual(['Drain now', 'View items']);
    }
  });

  it('green only on a Healthy or Clear badge', async () => {
    mockRoute();
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('job-calendar-sync');
    for (const badge of screen.getAllByTestId('status-badge')) {
      expect(GREEN.test(badge.className)).toBe(badge.textContent === 'Healthy' || badge.textContent === 'Clear');
    }
    for (const [status, tone] of Object.entries(JOB_TONE)) expect(tone === 'green').toBe(status === 'healthy');
    for (const [status, tone] of Object.entries(QUEUE_TONE)) expect(tone === 'green').toBe(status === 'clear');
    expect(new Set(Object.values(TONE_CLASSES)).size).toBe(4);
  });

  it('says so when the run record is not installed', async () => {
    const data = buildJobsQueuesView(
      { runs: { state: 'not_installed' }, queues: Object.fromEntries(BOS_QUEUES.map((q) => [q.id, { ok: true, figures: quietQueueFigures() }])) },
      NOW
    );
    mockRoute(data);
    render(<AdminJobsQueuesPage />);
    expect((await screen.findByTestId('runs-read-message')).textContent).toBe(
      'Could not check: run recording is not installed yet.'
    );
  });

  it('never renders a payload, recommendation, error message or skip reason field', async () => {
    mockRoute();
    const { container } = render(<AdminJobsQueuesPage />);
    await screen.findByTestId('job-calendar-sync');
    expect(container.innerHTML).not.toMatch(/payload|recommendation|error_message|skip_reason|dead-letter: max attempts/);
  });

  it('Refresh refetches and is aria-busy while loading', async () => {
    const fetchMock = mockRoute();
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('job-calendar-sync');
    const button = screen.getByRole('button', { name: /Refresh/ });
    fireEvent.click(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('a failed load says so', async () => {
    mockRoute(view(), false);
    render(<AdminJobsQueuesPage />);
    expect((await screen.findByTestId('jobs-error')).textContent).toBe('Forbidden');
  });
});

describe('QA-L2: times are converted to UTC, never sliced', () => {
  it('a +02:00 timestamp is shown as the UTC wall clock', () => {
    expect(formatUtc('2026-09-27T14:30:00+02:00')).toBe('2026-09-27 12:30 UTC');
    expect(formatUtc('2026-09-28T01:15:00+02:00')).toBe('2026-09-27 23:15 UTC'); // crosses midnight
    expect(formatUtc('2026-09-27T12:30:00.000Z')).toBe('2026-09-27 12:30 UTC');
    expect(formatUtc(null)).toBe('—');
    expect(formatUtc('not a time')).toBe('—');
  });

  it('the page renders a +02:00 start as UTC', async () => {
    const data = view();
    const job = data.jobs.find((j) => j.id === 'calendar-sync')!;
    job.lastRun = { ...job.lastRun!, startedAt: '2026-09-27T13:59:00+02:00', finishedAt: '2026-09-27T14:00:00+02:00' };
    mockRoute(data);
    render(<AdminJobsQueuesPage />);
    const row = await screen.findByTestId('job-calendar-sync');
    expect(row.textContent).toContain('Started 2026-09-27 11:59 UTC');
    expect(row.textContent).toContain('Finished 2026-09-27 12:00 UTC');
    expect(row.textContent).not.toContain('13:59');
  });
});

describe('QA-L4: an unfinished last run shows its outcome words once', () => {
  it('"did not finish" appears exactly once in the last-run cell', async () => {
    const data = view();
    const job = data.jobs.find((j) => j.id === 'lead-response')!;
    job.lastRun = {
      ...job.lastRun!,
      finishedAt: null,
      outcome: 'did_not_finish',
      outcomeWords: 'did not finish (or its finish could not be recorded)',
      errorClass: null,
      httpStatus: null,
    };
    job.recentFailures = [];
    mockRoute(data);
    render(<AdminJobsQueuesPage />);
    const row = await screen.findByTestId('job-lead-response');
    const cell = row.querySelectorAll('td')[2];
    expect(cell.textContent!.split('did not finish').length - 1).toBe(1);
    expect(cell.textContent).not.toContain('Finished');
  });
});

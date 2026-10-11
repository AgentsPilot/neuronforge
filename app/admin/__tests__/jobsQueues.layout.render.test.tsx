/**
 * @jest-environment jsdom
 */

/**
 * Scheduled jobs & queues as the Admin Layout Standard L-1b pilot (§7.2): the
 * shared header, the KPI strip (K-1 to K-10), the Refresh bar, the shared
 * states and §5.10 error copy, the status chip tones and the shared dialog
 * class. The strict Jobs pins (11 buttons, one fetch, test id counts, status
 * words, "Forbidden" on a 500) stay in `jobsQueues.render.test.tsx`; this is a
 * new file so those stay exact (the `health.layout.render` precedent).
 */

import '@testing-library/jest-dom';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const logError = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }),
}));
// RC-1: the Jobs files log through `clientLogger.child`.
jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  const child = () => ({ error: (...args: unknown[]) => logError(...args), warn: noop, info: noop, debug: noop });
  return { clientLogger: { child } };
});

import AdminJobsQueuesPage from '../jobs-queues/page';
import { ADMIN_DIALOG_CLASS } from '@/app/admin/components/layout/adminDialog';
import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { CronRunSummaryRow } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { JobsQueuesView } from '@/lib/admin/jobs/jobsQueuesTypes';
import { BOS_CRON_JOBS, BOS_QUEUES, findBosCronJob } from '@/lib/cron/bosCronJobs';
import {
  fixtureRow,
  fixtureRun,
  quietQueueFigures,
  quietSummaryRows,
  type FixtureQueueFigures,
} from '@/tests/helpers/jobs-queues-fixtures';

beforeAll(() => {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.releasePointerCapture ??= () => undefined;
  proto.setPointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
});

const NOW = new Date('2026-09-27T12:00:00.000Z');

const PURPOSE =
  'The Business OS scheduled jobs and the queues they drain. Red needs action, amber needs a look, and the green ' +
  'label Healthy or Clear means checked and clear. Grey means no run recorded yet or could not check. ' +
  "Each queue has a Drain now button; a waiting, failed or orphaned item can be cancelled, and a recently failed item can be retried, from its queue's list; everything else here is read-only.";

/**
 * The payload, built by the real server computation (SA S-1), so the tiles and
 * the queue chips come from the same rule the route applies. `figures` sets
 * one queue's figures; `insight_actions` is unreadable unless `allRead`.
 */
function view(options: { figures?: Partial<Record<string, Partial<FixtureQueueFigures>>>; allRead?: boolean } = {}): JobsQueuesView {
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
          q.id === 'insight_actions' && !options.allRead
            ? { ok: false as const }
            : { ok: true as const, figures: quietQueueFigures({ dueNow: 2, later: 7, ...(options.figures?.[q.id] ?? {}) }) },
        ])
      ),
    },
    NOW
  );
}

type Step =
  | { kind: 'json'; status: number; body: unknown }
  | { kind: 'html'; status: number }
  | { kind: 'network' }
  | { kind: 'pending' };

/** One fetch mock answering each call with the next step; the last step repeats. `release` settles a pending step. */
function mockFetch(...steps: Step[]): { fetchMock: jest.Mock; release: (data: JobsQueuesView) => void } {
  let call = 0;
  let resolvePending: ((value: unknown) => void) | null = null;
  const fetchMock = jest.fn(async () => {
    const step = steps[Math.min(call, steps.length - 1)];
    call += 1;
    if (step.kind === 'network') throw new TypeError('Failed to fetch');
    if (step.kind === 'pending') {
      return new Promise((resolve) => {
        resolvePending = resolve;
      });
    }
    const ok = step.status >= 200 && step.status < 300;
    if (step.kind === 'html') {
      return {
        ok,
        status: step.status,
        json: async () => {
          throw new SyntaxError("Unexpected token '<' in JSON at position 0");
        },
      };
    }
    return { ok, status: step.status, json: async () => step.body };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  const release = (data: JobsQueuesView) =>
    resolvePending?.({ ok: true, status: 200, json: async () => ({ success: true, data }) });
  return { fetchMock, release };
}

const okStep = (data: JobsQueuesView = view()): Step => ({ kind: 'json', status: 200, body: { success: true, data } });

const tile = (testId: string) => screen.getByTestId(testId);

/** The tones of the queue cards' chips (the K-5 (i) source of the red tiles). */
function queueChipTones(): string[] {
  return BOS_QUEUES.map(
    (q) => within(screen.getByTestId(`queue-${q.id}`)).getByTestId('status-badge').getAttribute('data-tone') ?? ''
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('header, strip and bar (§5.3, §5.4, §5.5)', () => {
  it('one h1 while loading and once loaded; the purpose text is unchanged', async () => {
    const { release } = mockFetch({ kind: 'pending' });
    render(<AdminJobsQueuesPage />);
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Scheduled jobs & queues']);
    await act(async () => release(view()));
    await screen.findByTestId('job-calendar-sync');
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['Scheduled jobs & queues']);
    expect(screen.getByText(PURPOSE)).toBeInTheDocument();
  });

  it('four tile links, in order, to #jobs and #queues; none is a button', async () => {
    mockFetch(okStep());
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('kpi-jobs');
    const tiles = ['kpi-jobs', 'kpi-queues', 'kpi-stuck', 'kpi-dead-lettered'].map(tile);
    expect(tiles.map((t) => t.tagName)).toEqual(['A', 'A', 'A', 'A']);
    expect(tiles.map((t) => t.getAttribute('href'))).toEqual(['#jobs', '#queues', '#queues', '#queues']);
    expect(document.getElementById('jobs')).not.toBeNull();
    expect(document.getElementById('queues')).not.toBeNull();
  });

  it('Jobs and Queues are counts, neutral even though a job is "Last run failed" (SA-R-4)', async () => {
    mockFetch(okStep());
    render(<AdminJobsQueuesPage />);
    const jobs = await screen.findByTestId('kpi-jobs');
    expect(within(screen.getByTestId('job-lead-response')).getByTestId('status-badge').textContent).toBe('Last run failed');
    expect(jobs.getAttribute('data-status')).toBe('neutral');
    expect(jobs.textContent).not.toContain('Needs action');
    expect(jobs).toHaveAccessibleName(`Jobs, ${BOS_CRON_JOBS.length}`);
    expect(jobs.textContent).toContain(`${BOS_CRON_JOBS.length - 1} Healthy · 1 Last run failed`);
    const queues = tile('kpi-queues');
    expect(queues.getAttribute('data-status')).toBe('neutral');
    expect(queues).toHaveAccessibleName('Queues, 5');
  });

  it('with nothing stuck or dead-lettered, both tiles are neutral at 0, with the K-8 lower-bound sub-line', async () => {
    mockFetch(okStep());
    render(<AdminJobsQueuesPage />);
    const stuck = await screen.findByTestId('kpi-stuck');
    expect(stuck.getAttribute('data-status')).toBe('neutral');
    expect(stuck).toHaveAccessibleName('Stuck items, 0');
    // The fixture's insight_actions queue could not be read.
    expect(stuck).toHaveAccessibleDescription('at least: 1 of 5 queues could not be checked');
    expect(tile('kpi-dead-lettered').getAttribute('data-status')).toBe('neutral');
    expect(tile('kpi-dead-lettered')).toHaveAccessibleName('Dead-lettered (24 h), 0');
  });

  it('every queue read: the sub-line says "across 5 queues"', async () => {
    mockFetch(okStep(view({ allRead: true })));
    render(<AdminJobsQueuesPage />);
    expect(await screen.findByTestId('kpi-stuck')).toHaveAccessibleDescription('across 5 queues');
  });

  it('Stuck items is red when a queue has stuck items, and a queue chip is red too (K-5 (i), SA S-1)', async () => {
    mockFetch(okStep(view({ figures: { lead_responses: { stuck: 2 } } })));
    render(<AdminJobsQueuesPage />);
    const stuck = await screen.findByTestId('kpi-stuck');
    expect(stuck.getAttribute('data-status')).toBe('red');
    expect(stuck).toHaveAccessibleName('Stuck items, 2, needs action');
    expect(stuck.textContent).toContain('Needs action');
    expect(queueChipTones().filter((tone) => tone === 'danger').length).toBeGreaterThanOrEqual(1);
    expect(within(screen.getByTestId('queue-lead_responses')).getByTestId('status-badge').getAttribute('data-tone')).toBe('danger');
    expect(tile('kpi-dead-lettered').getAttribute('data-status')).toBe('neutral');
  });

  it('Dead-lettered (24 h) is red when a queue dead-lettered an item, and a queue chip is red too (K-5 (i), SA S-1)', async () => {
    mockFetch(okStep(view({ figures: { payment_reminders: { deadLettered24h: 1, deadLettered7d: 1 } } })));
    render(<AdminJobsQueuesPage />);
    const dead = await screen.findByTestId('kpi-dead-lettered');
    expect(dead.getAttribute('data-status')).toBe('red');
    expect(dead).toHaveAccessibleName('Dead-lettered (24 h), 1, needs action');
    expect(queueChipTones().filter((tone) => tone === 'danger').length).toBeGreaterThanOrEqual(1);
    expect(within(screen.getByTestId('queue-payment_reminders')).getByTestId('status-badge').getAttribute('data-tone')).toBe('danger');
    expect(tile('kpi-stuck').getAttribute('data-status')).toBe('neutral');
  });

  it('As of shows the full server time through the shared formatter (F-60)', async () => {
    mockFetch(okStep());
    render(<AdminJobsQueuesPage />);
    expect((await screen.findByTestId('as-of')).textContent).toBe('As of 2026-09-27 12:00 UTC.');
  });

  it('Refresh is named "Refresh the jobs and queues"; there is no Read at line', async () => {
    mockFetch(okStep());
    const { container } = render(<AdminJobsQueuesPage />);
    await screen.findByTestId('job-calendar-sync');
    expect(screen.getByRole('button', { name: 'Refresh the jobs and queues' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('Read at');
  });
});

describe('status chips (§5.9)', () => {
  it('every chip carries a hidden icon; "No run recorded yet" and "Could not check" are unknown (dashed)', async () => {
    const data = view();
    const job = data.jobs.find((j) => j.id === 'calendar-sync')!;
    job.status = 'no_run_yet';
    job.statusWords = 'No run recorded yet';
    mockFetch(okStep(data));
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('job-calendar-sync');
    for (const chip of screen.getAllByTestId('status-badge')) {
      const icon = chip.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
    }
    const noRun = within(screen.getByTestId('job-calendar-sync')).getByTestId('status-badge');
    expect(noRun.textContent).toBe('No run recorded yet');
    expect(noRun.getAttribute('data-tone')).toBe('unknown');
    const couldNot = within(screen.getByTestId('queue-insight_actions')).getByTestId('status-badge');
    expect(couldNot.textContent).toBe('Could not check');
    expect(couldNot.getAttribute('data-tone')).toBe('unknown');
    expect(couldNot.className).toContain('border-dashed');
  });
});

describe('the dialogs take the shared class (C-10, F-88)', () => {
  it('Drain now opens a dialog with ADMIN_DIALOG_CLASS whose Close is its direct child', async () => {
    mockFetch(okStep());
    render(<AdminJobsQueuesPage />);
    const card = await screen.findByTestId('queue-lead_responses');
    await userEvent.click(within(card).getByRole('button', { name: 'Drain now' }));
    const dialog = await screen.findByRole('dialog');
    for (const cls of ADMIN_DIALOG_CLASS.split(' ')) expect(dialog.className.split(' ')).toContain(cls);
    expect(within(dialog).getByRole('button', { name: 'Close' }).parentElement).toBe(dialog);
  });
});

describe('states and §5.10 error copy', () => {
  it('a 403 says the admin session ended (sessionEndedCopy)', async () => {
    mockFetch({ kind: 'json', status: 403, body: { success: false, error: 'Forbidden' } });
    render(<AdminJobsQueuesPage />);
    expect((await screen.findByTestId('jobs-error')).textContent).toBe('Your admin session has ended. Sign in again.');
  });

  it('a 500 whose body is not JSON shows the fixed fallback, never a parser message', async () => {
    mockFetch({ kind: 'html', status: 500 });
    render(<AdminJobsQueuesPage />);
    expect((await screen.findByTestId('jobs-error')).textContent).toBe(
      'Could not read the jobs and queues. Try again in a moment.'
    );
  });

  it('a network failure shows the fixed network copy and logs the error', async () => {
    mockFetch({ kind: 'network' });
    render(<AdminJobsQueuesPage />);
    expect((await screen.findByTestId('jobs-error')).textContent).toBe(ADMIN_NETWORK_ERROR);
    expect(logError).toHaveBeenCalled();
  });

  it('"Try again" reads again and clears the error', async () => {
    const { fetchMock } = mockFetch({ kind: 'network' }, okStep());
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('jobs-error');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByTestId('job-calendar-sync');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('jobs-error')).toBeNull();
  });

  it('placeholders and the spinner while the first read is in flight; no strip after a failed first read (K-10)', async () => {
    const { release } = mockFetch({ kind: 'pending' });
    const { unmount } = render(<AdminJobsQueuesPage />);
    expect(screen.getAllByTestId('kpi-placeholder')).toHaveLength(4);
    expect(screen.getByRole('status').textContent).toBe('Reading the jobs and queues…');
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    await act(async () => release(view()));
    await screen.findByTestId('kpi-jobs');
    expect(screen.queryAllByTestId('kpi-placeholder')).toHaveLength(0);
    unmount();

    mockFetch({ kind: 'network' });
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('jobs-error');
    expect(screen.queryAllByTestId('kpi-placeholder')).toHaveLength(0);
    expect(screen.queryByTestId('kpi-jobs')).toBeNull();
  });

  it('a Refresh in flight keeps the tiles and shows no placeholders (SA S-2)', async () => {
    const { release } = mockFetch(okStep(), { kind: 'pending' });
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('kpi-jobs');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the jobs and queues' }));
    expect(screen.getByRole('button', { name: 'Refresh the jobs and queues' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('kpi-jobs')).toBeInTheDocument();
    expect(screen.queryAllByTestId('kpi-placeholder')).toHaveLength(0);
    expect(document.getElementById('jobs')?.parentElement).toHaveAttribute('aria-busy', 'true');
    // Settle the held Refresh so nothing is left pending after the test (SA CR-2).
    await act(async () => release(view()));
    expect(screen.getByRole('button', { name: 'Refresh the jobs and queues' })).toHaveAttribute('aria-busy', 'false');
  });

  it('a failed Refresh keeps the tiles and both sections on screen (SA Q-11)', async () => {
    mockFetch(okStep(), { kind: 'network' });
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('kpi-jobs');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh the jobs and queues' }));
    await screen.findByTestId('jobs-error');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Refresh the jobs and queues' })).not.toHaveAttribute('aria-busy', 'true')
    );
    expect(screen.getByTestId('kpi-jobs')).toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(document.getElementById('jobs')).not.toBeNull();
    expect(document.getElementById('queues')).not.toBeNull();
  });
});

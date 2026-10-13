/**
 * @jest-environment jsdom
 */

/**
 * "Reconcile top-ups now (all accounts)" on the Scheduled jobs & queues page
 * (Admin Layout follow-ups LF-4c; requirement ADMIN_LAYOUT_FOLLOWUPS BD-6,
 * §1.3 PIN-e, PIN-f, PIN-g; SA-C2, SA-C3; workplan SA-W1 to SA-W4).
 *
 * REC-1 to REC-3 MOVED here from the LF-4a.1 drawer pins
 * (`app/admin/users/__tests__/businessDrawer.pins.boost.render.test.tsx`), and
 * the "Run billing reconcile now (SA C-6)" cases MOVED here from
 * `boostBlock.actions.render.test.tsx`, with the SAME assertions. The only
 * edits, each named in the workplan's assertion table: the BD-6 label, title
 * and description (deliberate copy changes); the locators of elements that now
 * live on this page (the Billing reconcile row, `reconcile-notice`); and the
 * re-read assertion, which is part of the move (this page has no top-ups list,
 * and a press records no run of the job, so the page reads nothing again).
 *
 * The recording stub is the Businesses drawer pin harness
 * (`tests/admin/drawerPinHarness.ts`), reused unedited (SA SQ-8): it records
 * URL, method, headers, raw body and `cache`, so the request pin is the same
 * comparison the drawer made, and any request this file's route table does
 * not know fails the test, as does any console error or warning.
 */

import React from 'react';
import { act, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

import {
  deferred,
  fromQueue,
  getCount,
  installFetch,
  installPinLifecycle,
  posts,
  quiet,
  requestOf,
  setRoutes,
  unexpected,
  type Queued,
  type Reply,
} from '@/tests/admin/drawerPinHarness';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }),
}));
// The Jobs files log through `clientLogger.child` (RC-1); silent here so the console guard sees only real warnings.
jest.mock('@/lib/logger/client', () => {
  const noop = () => undefined;
  return { clientLogger: { child: () => ({ error: noop, warn: noop, info: noop, debug: noop }) } };
});

import AdminJobsQueuesPage from '../jobs-queues/page';
import { RECONCILE_COPY } from '../components/jobs/reconcileCopy';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { CronRunSummaryRow } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { JobsQueuesView } from '@/lib/admin/jobs/jobsQueuesTypes';
import { BOS_QUEUES, findBosCronJob } from '@/lib/cron/bosCronJobs';
import { fixtureRow, fixtureRun, quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

jest.setTimeout(30_000);
configure({ asyncUtilTimeout: 5_000 });

// ── Fixtures ────────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-27T12:00:00.000Z');
const JOBS_URL = '/api/admin/jobs-queues';
const RECONCILE_URL = '/api/admin/business-os/credits/boost/reconcile';
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const RECONCILE_JOB = 'bos-billing-reconcile';

/** Copied byte for byte from the drawer pins. */
const RECONCILE_OK = {
  counts: { boostExamined: 3, boostCredited: 1, boostExpired: 0, boostFailed: 0, boostFlagged: 0, boostDeferred: 0 },
  passesFailed: 0,
};
/** The whole expected reconcile request: the body is the literal string '{}'. */
const RECONCILE_POST = { url: RECONCILE_URL, method: 'POST', headers: JSON_HEADERS, cache: 'no-store', body: '{}' };

/**
 * SA-W4: the Billing reconcile row has a recorded last run of its own (90
 * minutes ago, 4.2 s, two top-ups examined), so "the last run is unchanged"
 * compares real text, never two empty cells.
 */
function view(runsState: 'ok' | 'failed' = 'ok'): JobsQueuesView {
  const job = findBosCronJob(RECONCILE_JOB)!;
  const rows = (quietSummaryRows(NOW) as CronRunSummaryRow[]).map((row) =>
    row.job === RECONCILE_JOB
      ? (fixtureRow(job, NOW, [fixtureRun(job, NOW, 90, { duration_ms: 4200, counts: { boostExamined: 2 } })]) as CronRunSummaryRow)
      : row
  );
  return buildJobsQueuesView(
    {
      runs: runsState === 'ok' ? { state: 'ok', rows } : { state: 'failed' },
      queues: Object.fromEntries(BOS_QUEUES.map((q) => [q.id, { ok: true as const, figures: quietQueueFigures() }])),
    },
    NOW
  );
}

// ── The route table (the recording stub is the shared pin harness) ──────────

let jobsData: JobsQueuesView;
let reconcileQueue: Queued[] = [];

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });

function routeGet(url: string): Queued {
  if (url === JOBS_URL) return ok(jobsData);
  unexpected.push(`GET ${url}`);
  return { status: 404, body: { success: false, error: 'not mocked' } };
}

function routePost(url: string): Queued {
  if (url === RECONCILE_URL) return fromQueue(reconcileQueue, url);
  unexpected.push(`POST ${url}`);
  return { status: 404, body: { success: false, error: 'not mocked' } };
}

setRoutes(routeGet, routePost);
installPinLifecycle({ countUuids: false });

beforeEach(() => {
  jobsData = view();
  reconcileQueue = [];
});

/** The page, its one read answered; returns the Billing reconcile row. */
async function openPage(): Promise<HTMLElement> {
  installFetch();
  render(<AdminJobsQueuesPage />);
  const row = await screen.findByTestId(`job-${RECONCILE_JOB}`);
  await quiet();
  return row;
}

const button = (root: HTMLElement, testId: string) => within(root).getByTestId(testId) as HTMLButtonElement;
const noticeLines = (notice: HTMLElement) => Array.from(notice.querySelectorAll('p')).map((p) => p.textContent);

/** SA-W4: the row's last run and status, read before a press and compared after. */
function rowFacts(row: HTMLElement) {
  const outcome = within(row).getByTestId('last-run-outcome');
  return { outcome: outcome.textContent, status: within(row).getByTestId('status-badge').textContent };
}

/** No page re-read: the one jobs GET, nothing else read (part of the move; SA SQ-2). */
async function expectNoReRead() {
  await quiet();
  expect(getCount(JOBS_URL)).toBe(1);
}

// ── Moved from the drawer pins (LF-4a.1 REC-1 to REC-3) ─────────────────────

describe('Reconcile top-ups now (PIN-e, PIN-f, PIN-g; moved from the drawer in LF-4c with the same request assertions)', () => {
  it("REC-1: opener, words, confirm step; POST, the header, the literal body '{}', cache no-store; the counts as the notice; no re-read", async () => {
    const row = await openPage();
    const before = rowFacts(row);
    expect(before.outcome).toContain('4.2 s');
    const opener = button(row, 'boost-reconcile');
    // BD-6 label (deliberate): was "Run billing reconcile now (all accounts)".
    expect(opener.textContent).toBe('Reconcile top-ups now (all accounts)');
    expect(row.contains(opener)).toBe(true);

    fireEvent.click(opener);
    const dialog = await screen.findByTestId('boost-reconcile-dialog');
    // BD-6 title (deliberate, SA-W1): was "Run billing reconcile now".
    expect(within(dialog).getByRole('heading').textContent).toBe('Reconcile top-ups now');
    // BD-6 description (deliberate, SA-C2, SA-W2).
    expect(within(dialog).getByTestId('boost-reconcile-description').textContent).toBe(
      'This checks Stripe for unfinished credit top-ups of every business. It may add credits, close expired checkouts or mark failed payments, exactly as the nightly run at 05:41 UTC does for top-ups. A press is not recorded as a run of the Billing reconcile job: its last run and counts stay as they are.'
    );
    expect(button(dialog, 'boost-reconcile-run').textContent).toBe('Run now');
    expect(posts()).toEqual([]);

    reconcileQueue.push(ok(RECONCILE_OK));
    fireEvent.click(button(dialog, 'boost-reconcile-run'));
    const notice = await within(row).findByTestId('reconcile-notice');
    expect(noticeLines(notice)).toEqual([
      'Reconcile finished: 3 stuck top-ups examined, 1 credited, 0 expired, 0 marked failed, 0 need a person, 0 left for the next run.',
    ]);
    expect(screen.queryByTestId('boost-reconcile-dialog')).toBeNull();

    expect(posts().map((p) => requestOf(p, true))).toStrictEqual([RECONCILE_POST]);
    // Was: one top-ups re-read. Now: no re-read, and the row's last run is unchanged (SA-W4).
    await expectNoReRead();
    expect(rowFacts(row)).toEqual(before);
  });

  it('REC-2 (PIN-f): a double click on Run sends once; while running, Run says Running…, Close is disabled and Escape is refused', async () => {
    const row = await openPage();
    const before = rowFacts(row);
    fireEvent.click(button(row, 'boost-reconcile'));
    const dialog = await screen.findByTestId('boost-reconcile-dialog');
    const held = deferred<Reply>();
    reconcileQueue.push(held.promise);
    const run = button(dialog, 'boost-reconcile-run');
    act(() => {
      run.click();
      run.click();
    });
    expect(posts()).toHaveLength(1);
    expect(button(dialog, 'boost-reconcile-run').textContent).toBe('Running…');
    expect(button(dialog, 'boost-reconcile-run').disabled).toBe(true);
    expect(button(dialog, 'boost-reconcile-close').disabled).toBe(true);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await act(async () => undefined);
    expect(screen.getByTestId('boost-reconcile-dialog')).toBe(dialog);
    // Was: the drawer stays open. Now: the row is still on the page.
    expect(screen.getByTestId(`job-${RECONCILE_JOB}`)).toBe(row);
    await act(async () => {
      held.resolve(ok(RECONCILE_OK));
    });
    await waitFor(() => expect(screen.queryByTestId('boost-reconcile-dialog')).toBeNull());
    expect(posts().map((p) => requestOf(p, true))).toStrictEqual([RECONCILE_POST]);
    await expectNoReRead();
    expect(rowFacts(row)).toEqual(before);
  });

  it('REC-3 (PIN-g, QA6b-M1): a 200 whose pass failed shows the failure words and stays open; no notice, no re-read; Run again sends the same body', async () => {
    const row = await openPage();
    const before = rowFacts(row);
    fireEvent.click(button(row, 'boost-reconcile'));
    const dialog = await screen.findByTestId('boost-reconcile-dialog');
    reconcileQueue.push(ok({ ...RECONCILE_OK, passesFailed: 1 }));
    fireEvent.click(button(dialog, 'boost-reconcile-run'));
    expect((await within(dialog).findByTestId('boost-reconcile-error')).textContent).toBe(
      'The reconcile could not run. Nothing is lost: the nightly run will try again.'
    );
    await expectNoReRead();
    expect(screen.getByTestId('boost-reconcile-dialog')).toBe(dialog);
    expect(within(row).queryByTestId('reconcile-notice')).toBeNull();
    expect(posts().map((p) => requestOf(p, true))).toStrictEqual([RECONCILE_POST]);

    reconcileQueue.push(ok(RECONCILE_OK));
    fireEvent.click(button(dialog, 'boost-reconcile-run'));
    await waitFor(() => expect(screen.queryByTestId('boost-reconcile-dialog')).toBeNull());
    expect(posts().map((p) => requestOf(p, true))).toStrictEqual([RECONCILE_POST, RECONCILE_POST]);
    await expectNoReRead();
    expect(rowFacts(row)).toEqual(before);
  });
});

// ── Moved from boostBlock.actions.render ("Run billing reconcile now (SA C-6)") ──

describe('Reconcile top-ups now: the words (SA C-6; moved from boostBlock.actions.render in LF-4c)', () => {
  const COUNTS = {
    boostExamined: 3,
    boostCredited: 1,
    boostExpired: 1,
    boostFailed: 0,
    boostFlagged: 1,
    boostDeferred: 0,
    boostDisputesExamined: 0,
    boostReceiptsFilled: 2,
    boostDeadlineHit: 0,
  };

  async function press(reply: Queued): Promise<HTMLElement> {
    const row = await openPage();
    reconcileQueue.push(reply);
    fireEvent.click(button(row, 'boost-reconcile'));
    fireEvent.click(await screen.findByTestId('boost-reconcile-run'));
    return row;
  }

  it('the confirm says it covers every business; Run posts an EMPTY body (no account id) and shows the counts in words', async () => {
    const row = await openPage();
    reconcileQueue.push(ok({ runId: 'r1', counts: COUNTS, passesRun: 1, passesFailed: 0, durationMs: 12 }));
    fireEvent.click(button(row, 'boost-reconcile'));
    expect((await screen.findByTestId('boost-reconcile-description')).textContent).toBe(RECONCILE_COPY.description);
    // BD-6 copy (deliberate): was toContain('not only this one').
    expect(screen.getByTestId('boost-reconcile-dialog').textContent).not.toContain('not only this one');
    expect(screen.getByTestId('boost-reconcile-dialog').textContent).toContain('every business');
    expect(screen.getByTestId('boost-reconcile-dialog').textContent).toContain('not recorded as a run');
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByTestId('boost-reconcile-run'));
    const notice = await within(row).findByTestId('reconcile-notice');
    expect(notice.textContent).toContain('Reconcile finished: 3 stuck top-ups examined, 1 credited, 1 expired, 0 marked failed, 1 need a person, 0 left for the next run.');
    expect(notice.textContent).toContain('2 missing receipts filled.');
    const sent = posts();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe('{}');
  });

  it('a run cut by its deadline, or with Stripe unreadable, says so', async () => {
    const row = await press(ok({ counts: { ...COUNTS, boostDeadlineHit: 1, boostRowsLeft: 4, boostStripeUnavailable: 1 } }));
    const notice = await within(row).findByTestId('reconcile-notice');
    expect(notice.textContent).toContain('It stopped at its time limit with 4 top-ups left; the nightly run picks them up.');
    expect(notice.textContent).toContain('Stripe could not be read, so nothing was checked.');
  });

  it.each([
    ['a pass that failed (passesFailed > 0)', { runId: 'r1', counts: {}, passesRun: 1, passesFailed: 1, durationMs: 3 }],
    ['counts without boostExamined', { runId: 'r1', counts: { passesRun: 1 }, passesRun: 1, passesFailed: 0, durationMs: 3 }],
    ['no counts at all', { runId: 'r1', passesRun: 1, passesFailed: 0 }],
  ])('QA6b-M1: a 200 with %s is the failure line, never "0 examined"', async (_name, data) => {
    await press(ok(data));
    expect((await screen.findByTestId('boost-reconcile-error')).textContent).toBe(
      'The reconcile could not run. Nothing is lost: the nightly run will try again.'
    );
    expect(screen.queryByTestId('reconcile-notice')).toBeNull();
  });

  it('a list read that failed is mentioned', async () => {
    const row = await press(ok({ counts: { ...COUNTS, boostListFailed: 1 }, passesRun: 1, passesFailed: 0 }));
    expect((await within(row).findByTestId('reconcile-notice')).textContent).toContain('Some top-ups could not be listed; the nightly run tries again.');
  });

  it('one run at a time, and a failure says it could not run', async () => {
    const held = deferred<Reply>();
    const row = await openPage();
    reconcileQueue.push(held.promise);
    fireEvent.click(button(row, 'boost-reconcile'));
    fireEvent.click(await screen.findByTestId('boost-reconcile-run'));
    fireEvent.click(screen.getByTestId('boost-reconcile-run'));
    expect(posts()).toHaveLength(1);
    expect(screen.getByTestId('boost-reconcile-run').textContent).toBe('Running…');
    await act(async () => held.resolve({ status: 500, body: { success: false, error: 'reconcile_failed' } }));
    expect((await screen.findByTestId('boost-reconcile-error')).textContent).toBe(RECONCILE_COPY.failed);
    expect(screen.queryByTestId('reconcile-notice')).toBeNull();
  });
});

// ── New in LF-4c ────────────────────────────────────────────────────────────

describe('Reconcile top-ups now: where it lives, focus and the notice (LF-4c)', () => {
  it("JREC-P1: the button is in the Billing reconcile row's Job cell, after its schedule line, and no other cell of the row has a button", async () => {
    const row = await openPage();
    const jobCell = row.querySelector('td')!;
    const opener = button(row, 'boost-reconcile');
    expect(jobCell.contains(opener)).toBe(true);
    const scheduleLine = within(jobCell).getByText(/Daily at 05:41 UTC/);
    expect(scheduleLine.compareDocumentPosition(opener) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Every other cell of the row holds no button.
    for (const cell of Array.from(row.querySelectorAll('td')).slice(1)) expect(within(cell).queryAllByRole('button')).toHaveLength(0);
  });

  it('JREC-P1b: with the runs unreadable (status Could not check), the button still shows', async () => {
    jobsData = view('failed');
    installFetch();
    render(<AdminJobsQueuesPage />);
    const row = await screen.findByTestId(`job-${RECONCILE_JOB}`);
    expect(within(row).getByTestId('status-badge').textContent).toBe('Could not check');
    expect(button(row, 'boost-reconcile').textContent).toBe(RECONCILE_COPY.button);
  });

  it('JREC-P2: no Billing reconcile row, no reconcile button anywhere', async () => {
    const full = view();
    jobsData = { ...full, jobs: full.jobs.filter((job) => job.id !== RECONCILE_JOB) };
    installFetch();
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('job-calendar-sync');
    expect(screen.queryByTestId('boost-reconcile')).toBeNull();
    expect(screen.queryByRole('button', { name: /reconcile/i })).toBeNull();
  });

  it('JREC-F1: Close returns focus to the button; after a success focus is on the button and the notice is under it', async () => {
    const row = await openPage();
    const opener = button(row, 'boost-reconcile');
    fireEvent.click(opener);
    const dialog = await screen.findByTestId('boost-reconcile-dialog');
    fireEvent.click(button(dialog, 'boost-reconcile-close'));
    await waitFor(() => expect(screen.queryByTestId('boost-reconcile-dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(posts()).toEqual([]);

    fireEvent.click(opener);
    reconcileQueue.push(ok(RECONCILE_OK));
    fireEvent.click(button(await screen.findByTestId('boost-reconcile-dialog'), 'boost-reconcile-run'));
    const notice = await within(row).findByTestId('reconcile-notice');
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(opener.compareDocumentPosition(notice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(notice.getAttribute('role')).toBe('status');
  });

  it('JREC-F2: opening the dialog again clears the previous notice', async () => {
    const row = await openPage();
    reconcileQueue.push(ok(RECONCILE_OK));
    fireEvent.click(button(row, 'boost-reconcile'));
    fireEvent.click(button(await screen.findByTestId('boost-reconcile-dialog'), 'boost-reconcile-run'));
    await within(row).findByTestId('reconcile-notice');
    fireEvent.click(button(row, 'boost-reconcile'));
    await screen.findByTestId('boost-reconcile-dialog');
    expect(within(row).queryByTestId('reconcile-notice')).toBeNull();
  });

  it('JREC-F3: an outside click while in flight leaves the dialog open', async () => {
    const row = await openPage();
    fireEvent.click(button(row, 'boost-reconcile'));
    const dialog = await screen.findByTestId('boost-reconcile-dialog');
    const held = deferred<Reply>();
    reconcileQueue.push(held.promise);
    fireEvent.click(button(dialog, 'boost-reconcile-run'));
    fireEvent.pointerDown(document.body);
    await act(async () => undefined);
    expect(screen.getByTestId('boost-reconcile-dialog')).toBe(dialog);
    await act(async () => {
      held.resolve(ok(RECONCILE_OK));
    });
    await waitFor(() => expect(screen.queryByTestId('boost-reconcile-dialog')).toBeNull());
  });

  // SA F2 (LF-4c code review): the drawer remounted the dialog on every open,
  // so a reopen never showed the last failure; the Jobs dialog stays mounted
  // and must clear it itself.
  it('JREC-F4: after a failed run, Close and reopen: no failure line, Run reads "Run now", and opening sent nothing', async () => {
    const row = await openPage();
    fireEvent.click(button(row, 'boost-reconcile'));
    const first = await screen.findByTestId('boost-reconcile-dialog');
    reconcileQueue.push(ok({ ...RECONCILE_OK, passesFailed: 1 }));
    fireEvent.click(button(first, 'boost-reconcile-run'));
    await within(first).findByTestId('boost-reconcile-error');
    fireEvent.click(button(first, 'boost-reconcile-close'));
    await waitFor(() => expect(screen.queryByTestId('boost-reconcile-dialog')).toBeNull());
    expect(posts()).toHaveLength(1);

    fireEvent.click(button(row, 'boost-reconcile'));
    const reopened = await screen.findByTestId('boost-reconcile-dialog');
    expect(within(reopened).queryByTestId('boost-reconcile-error')).toBeNull();
    expect(button(reopened, 'boost-reconcile-run').textContent).toBe('Run now');
    expect(button(reopened, 'boost-reconcile-run').disabled).toBe(false);
    await expectNoReRead();
    expect(posts()).toHaveLength(1);
  });

  it('JREC-T1: the row the button keys on exists, and the time the copy states is the registry\'s (SA-W3)', () => {
    const job = findBosCronJob(RECONCILE_JOB);
    expect(job).toBeDefined();
    expect(job!.label).toBe('Billing reconcile');
    // The copy cannot import the registry (C-21). If this schedule changes,
    // RECONCILE_COPY.description in reconcileCopy.ts must change with it.
    expect(job!.schedule).toBe('41 5 * * *');
    expect(job!.scheduleWords).toBe('Daily at 05:41 UTC');
    expect(RECONCILE_COPY.description).toContain('05:41 UTC');
  });
});

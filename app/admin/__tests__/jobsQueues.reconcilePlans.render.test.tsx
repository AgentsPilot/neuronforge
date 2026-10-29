/**
 * @jest-environment jsdom
 */

/**
 * "Reconcile plan payments now" on the Scheduled jobs & queues page (plan
 * payments P-8b.3c; workplan D3-4, D3-5; SA P3-SA-2 items 4 and 8, P3-SA-8,
 * P3-SA-9).
 *
 *   PR    the press: where it lives, its words, the one POST, the notice; the
 *         jobs are NOT read again and the webhook block IS (Q-P3-4)
 *   PRF   QA6b-M1: a 200 with passesFailed > 0, or with no planEventsSeen, is
 *         the failure line (tested both ways), as is a 500 or a network error
 *   PRC   the words: every plan `partlyDoneWhen` key of the registry has a
 *         sentence (the copy cannot read the registry, so this test pins it);
 *         a press with any of them never reads as a clean "finished"; findings
 *         are said "with Stripe", never like the list's "Disagrees"
 *   WSEQ  the webhook block ignores an older answer that lands after a newer one
 *
 * The whole page renders with a fetch mock routed by URL; the block's payload
 * is built by the REAL builder.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
import {
  PLAN_FINDING_SENTENCES,
  PLAN_LEFT_WORK_SENTENCES,
  PLAN_RECONCILE_COPY,
  planReconcileOutcome,
  planReconcileSentences,
} from '../components/jobs/reconcileCopy';
import { buildJobsQueuesView } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { CronRunSummaryRow } from '@/lib/admin/jobs/buildJobsQueuesView';
import type { JobsQueuesView } from '@/lib/admin/jobs/jobsQueuesTypes';
import { buildWebhookEventsView, type WebhookEventsInput } from '@/lib/admin/jobs/webhookEventsView';
import type { WebhookEventsPayload } from '@/lib/admin/jobs/webhookEventsTypes';
import { STALE_CLAIM_AGE_MS } from '@/lib/repositories/ProcessedWebhookEventRepository';
import { PLAN_RECONCILE_COUNT_KEYS } from '@/lib/business-os/billing/planReconcilePass';
import { flattenedCountKey } from '@/lib/business-os/billing/reconcilePassRunner';
import { BOS_QUEUES, findBosCronJob } from '@/lib/cron/bosCronJobs';
import { quietQueueFigures, quietSummaryRows } from '@/tests/helpers/jobs-queues-fixtures';

const JOBS_URL = '/api/admin/jobs-queues';
const WEBHOOKS_URL = '/api/admin/jobs-queues/webhook-events';
const PLANS_URL = '/api/admin/business-os/billing/reconcile';
const NOW = new Date('2026-10-28T12:00:00.000Z');
const RECONCILE_JOB = 'bos-billing-reconcile';
const FAILED_WORDS = 'The plan reconcile could not finish. Nothing is lost: the nightly run will try again.';

/** Every plan count at 0, flattened as the route answers them. */
const ZERO_COUNTS: Record<string, number> = Object.fromEntries(PLAN_RECONCILE_COUNT_KEYS.map((key) => [flattenedCountKey('plan', key), 0]));
const counts = (patch: Record<string, number> = {}) => ({ ...ZERO_COUNTS, planEventsSeen: 3, planReplayed: 1, ...patch });
const answer = (patch: Record<string, number> = {}, extra: Record<string, unknown> = {}) => ({
  runId: 'r1',
  counts: counts(patch),
  passesRun: 1,
  passesFailed: 0,
  durationMs: 12,
  ...extra,
});

/** The registry's plan keys in the Billing reconcile job's `partlyDoneWhen`. */
const PLAN_PARTLY_DONE_KEYS = findBosCronJob(RECONCILE_JOB)!
  .partlyDoneWhen.map((condition) => condition.key)
  .filter((key) => key.startsWith('plan'));

function jobsView(): JobsQueuesView {
  return buildJobsQueuesView(
    {
      runs: { state: 'ok', rows: quietSummaryRows(NOW) as CronRunSummaryRow[] },
      queues: Object.fromEntries(BOS_QUEUES.map((q) => [q.id, { ok: true as const, figures: quietQueueFigures({}) }])),
    },
    NOW
  );
}

function payload(failed: number): WebhookEventsPayload {
  const input: WebhookEventsInput = {
    mode: 'test',
    now: NOW,
    counts: { failed, stuck: 0 },
    lists: { failed: [], stuck: [] },
    noMode: { failed: 0, stuck: 0 },
    readPerState: 200,
    staleAfterMs: STALE_CLAIM_AGE_MS,
  };
  return buildWebhookEventsView(input);
}

// ── The fetch mock: answers are queued per URL; a queued promise holds the reply ──

type Reply = { status: number; body: unknown } | 'network';
type Queued = Reply | Promise<Reply>;

let queues: Record<string, Queued[]>;
let fetchMock: jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });

function installFetch() {
  fetchMock = jest.fn(async (url: string) => {
    const queue = queues[url];
    if (!queue) throw new Error(`unexpected fetch ${url}`);
    if (queue.length === 0) throw new Error(`no answer queued for ${url}`);
    // The last answer repeats, so the mount read and later reads can share one.
    const next = await (queue.length > 1 ? queue.shift()! : queue[0]);
    if (next === 'network') throw new TypeError('Failed to fetch');
    return { ok: next.status >= 200 && next.status < 300, status: next.status, json: async () => next.body };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

const callsTo = (url: string) => fetchMock.mock.calls.filter(([u]) => u === url);

beforeEach(() => {
  mockLoggerCalls.length = 0;
  queues = { [JOBS_URL]: [ok(jobsView())], [WEBHOOKS_URL]: [ok(payload(0))], [PLANS_URL]: [] };
});

async function openPage(): Promise<HTMLElement> {
  installFetch();
  render(<AdminJobsQueuesPage />);
  const row = await screen.findByTestId(`job-${RECONCILE_JOB}`);
  await waitFor(() => expect(callsTo(WEBHOOKS_URL)).toHaveLength(1));
  await screen.findByTestId('webhook-kpi-failed-kpi');
  return row;
}

const button = (root: HTMLElement, testId: string) => within(root).getByTestId(testId) as HTMLButtonElement;
const noticeLines = (notice: HTMLElement) => Array.from(notice.querySelectorAll('p')).map((p) => p.textContent);

async function press(row: HTMLElement, reply: Queued) {
  queues[PLANS_URL].push(reply);
  fireEvent.click(button(row, 'plan-reconcile'));
  const dialog = await screen.findByTestId('plan-reconcile-dialog');
  fireEvent.click(button(dialog, 'plan-reconcile-run'));
  return dialog;
}

// ── PR: the press ────────────────────────────────────────────────────────────

describe('PR: the press', () => {
  it('PR-1: in the Billing reconcile row after the top-ups button; its words; one POST with the literal body; the notice; the block re-reads, the jobs do not', async () => {
    const row = await openPage();
    const topUps = button(row, 'boost-reconcile');
    const opener = button(row, 'plan-reconcile');
    expect(opener.textContent).toBe('Reconcile plan payments now');
    expect(topUps.compareDocumentPosition(opener) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Only the Billing reconcile row has it.
    expect(screen.getAllByTestId('plan-reconcile')).toHaveLength(1);

    fireEvent.click(opener);
    const dialog = await screen.findByTestId('plan-reconcile-dialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Reconcile plan payments now');
    expect(within(dialog).getByTestId('plan-reconcile-description').textContent).toBe(PLAN_RECONCILE_COPY.description);
    expect(PLAN_RECONCILE_COPY.description).toContain('every business');
    expect(PLAN_RECONCILE_COPY.description).toContain('not recorded as a run');
    expect(button(dialog, 'plan-reconcile-run').textContent).toBe('Run now');
    expect(callsTo(PLANS_URL)).toHaveLength(0);

    queues[WEBHOOKS_URL] = [ok(payload(2))];
    queues[PLANS_URL].push(ok(answer()));
    fireEvent.click(button(dialog, 'plan-reconcile-run'));
    const notice = await within(row).findByTestId('plan-reconcile-notice');
    expect(noticeLines(notice)).toEqual(['Plan reconcile finished: 3 plan events listed from Stripe, 1 replayed.']);
    expect(notice.getAttribute('role')).toBe('status');
    await waitFor(() => expect(screen.queryByTestId('plan-reconcile-dialog')).toBeNull());

    expect(callsTo(PLANS_URL)).toEqual([
      [PLANS_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' }],
    ]);
    // Q-P3-4: the block reads again and shows the new figure; the jobs are read once only.
    await waitFor(() => expect(callsTo(WEBHOOKS_URL)).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 2'));
    expect(callsTo(JOBS_URL)).toHaveLength(1);
    // The top-ups notice is untouched by a plan press.
    expect(within(row).queryByTestId('reconcile-notice')).toBeNull();
  });

  it('PR-2: a double click on Run sends once; while running, Run says Running… and Close is disabled', async () => {
    const row = await openPage();
    fireEvent.click(button(row, 'plan-reconcile'));
    const dialog = await screen.findByTestId('plan-reconcile-dialog');
    const held = deferred<Reply>();
    queues[PLANS_URL].push(held.promise);
    const run = button(dialog, 'plan-reconcile-run');
    act(() => {
      run.click();
      run.click();
    });
    expect(callsTo(PLANS_URL)).toHaveLength(1);
    expect(button(dialog, 'plan-reconcile-run').textContent).toBe('Running…');
    expect(button(dialog, 'plan-reconcile-close').disabled).toBe(true);
    await act(async () => {
      held.resolve(ok(answer()));
    });
    await waitFor(() => expect(screen.queryByTestId('plan-reconcile-dialog')).toBeNull());
    expect(callsTo(PLANS_URL)).toHaveLength(1);
  });

  it('PR-3: a lost claim (another run held an event) is said in words, with no clean "finished" line', async () => {
    const row = await openPage();
    await press(row, ok(answer({ planIncomplete: 1, planReplayed: 0 })));
    const notice = await within(row).findByTestId('plan-reconcile-notice');
    expect(noticeLines(notice)).toEqual([
      'Plan reconcile did not finish everything: 3 plan events listed from Stripe, 0 replayed.',
      'Some plan events were left for the nightly run: another run held them, or a limit was reached.',
    ]);
  });

  it('PR-4: findings are counts "logged for a person to check"', async () => {
    const row = await openPage();
    await press(row, ok(answer({ planMismatch: 2, planOrphan: 1, planUnassigned: 1 })));
    const notice = await within(row).findByTestId('plan-reconcile-notice');
    expect(noticeLines(notice)).toEqual([
      'Plan reconcile finished: 3 plan events listed from Stripe, 1 replayed.',
      '2 plan subscriptions disagree with Stripe: logged for a person to check.',
      '1 Stripe plan subscription has no billing record: logged for a person to check.',
      '1 paid plan invoice has no plan assigned: logged for a person to check.',
    ]);
  });

  it('PR-5: opening the dialog again clears the previous notice; Close sends nothing', async () => {
    const row = await openPage();
    await press(row, ok(answer()));
    await within(row).findByTestId('plan-reconcile-notice');
    fireEvent.click(button(row, 'plan-reconcile'));
    const dialog = await screen.findByTestId('plan-reconcile-dialog');
    expect(within(row).queryByTestId('plan-reconcile-notice')).toBeNull();
    fireEvent.click(button(dialog, 'plan-reconcile-close'));
    await waitFor(() => expect(screen.queryByTestId('plan-reconcile-dialog')).toBeNull());
    expect(callsTo(PLANS_URL)).toHaveLength(1);
  });
});

// ── PRF: failures (QA6b-M1, P3-SA-8) ─────────────────────────────────────────

describe('PRF: a press that did not really run is a failure', () => {
  it.each([
    ['a 200 whose pass failed (passesFailed > 0)', ok(answer({}, { passesFailed: 1 }))],
    ['a 200 with no planEventsSeen', ok({ runId: 'r1', counts: { planReplayed: 0 }, passesRun: 1, passesFailed: 0 })],
    ['a 200 with no counts at all', ok({ runId: 'r1', passesRun: 1, passesFailed: 0 })],
    ['a 500', { status: 500, body: { success: false, error: 'internal words that must never show' } } as Reply],
  ])('%s: the failure line, the dialog stays open, no notice; the block still re-reads', async (_name, reply) => {
    const row = await openPage();
    const dialog = await press(row, reply);
    expect((await within(dialog).findByTestId('plan-reconcile-error')).textContent).toBe(FAILED_WORDS);
    expect(screen.getByTestId('plan-reconcile-dialog')).toBe(dialog);
    expect(within(row).queryByTestId('plan-reconcile-notice')).toBeNull();
    expect(document.body.textContent).not.toContain('internal words');
    // It reached the route, so a part-run may have left events: the block reads again.
    await waitFor(() => expect(callsTo(WEBHOOKS_URL)).toHaveLength(2));
    expect(callsTo(JOBS_URL)).toHaveLength(1);
  });

  it('a network failure: the failure line; nothing reached the route, so the block does not re-read', async () => {
    const row = await openPage();
    const dialog = await press(row, 'network');
    expect((await within(dialog).findByTestId('plan-reconcile-error')).textContent).toBe(FAILED_WORDS);
    await act(async () => undefined);
    expect(callsTo(WEBHOOKS_URL)).toHaveLength(1);
  });

  it('the logs carry status, passesFailed or err only, never the body', async () => {
    const row = await openPage();
    const dialog = await press(row, ok(answer({}, { passesFailed: 1 })));
    await within(dialog).findByTestId('plan-reconcile-error');
    const fromDialog = mockLoggerCalls.filter(([, msg]) => typeof msg === 'string' && msg.startsWith('Reconcile plan payments'));
    expect(fromDialog).toEqual([[{ status: 200, passesFailed: 1 }, 'Reconcile plan payments did not complete']]);
  });

  it('planReconcileOutcome directly: passesFailed > 0, no planEventsSeen, no counts, not an object → null', () => {
    expect(planReconcileOutcome(answer({}, { passesFailed: 1 }))).toBeNull();
    expect(planReconcileOutcome({ counts: { planReplayed: 1 }, passesFailed: 0 })).toBeNull();
    expect(planReconcileOutcome({ passesFailed: 0 })).toBeNull();
    expect(planReconcileOutcome(null)).toBeNull();
    expect(planReconcileOutcome('x')).toBeNull();
    expect(planReconcileOutcome(answer())).toEqual(['Plan reconcile finished: 3 plan events listed from Stripe, 1 replayed.']);
  });
});

// ── PRC: the words cover the registry (P3-SA-2 item 8) ──────────────────────

describe('PRC: the words cover every plan partlyDoneWhen key', () => {
  it('the copy has a sentence for exactly the plan keys of the Billing reconcile job’s partlyDoneWhen', () => {
    expect(PLAN_PARTLY_DONE_KEYS.length).toBeGreaterThan(0);
    expect(Object.keys(PLAN_LEFT_WORK_SENTENCES).sort()).toEqual([...PLAN_PARTLY_DONE_KEYS].sort());
  });

  it('every copy key is a real counter of the plan pass', () => {
    const real = new Set(PLAN_RECONCILE_COUNT_KEYS.map((key) => flattenedCountKey('plan', key)));
    for (const key of [...Object.keys(PLAN_LEFT_WORK_SENTENCES), ...Object.keys(PLAN_FINDING_SENTENCES), 'planEventsSeen', 'planReplayed']) {
      expect({ key, real: real.has(key) }).toEqual({ key, real: true });
    }
  });

  it.each(PLAN_PARTLY_DONE_KEYS)('%s > 0: its own sentence, and never a clean "finished" line', (key) => {
    const lines = planReconcileSentences(counts({ [key]: 2 }));
    expect(lines[0]).toBe('Plan reconcile did not finish everything: 3 plan events listed from Stripe, 1 replayed.');
    expect(lines).toContain(PLAN_LEFT_WORK_SENTENCES[key](2));
    expect(lines.some((line) => line.startsWith('Plan reconcile finished'))).toBe(false);
  });

  it('each left-work sentence, in words', () => {
    expect(PLAN_LEFT_WORK_SENTENCES.planIncomplete(1)).toBe('Some plan events were left for the nightly run: another run held them, or a limit was reached.');
    expect(PLAN_LEFT_WORK_SENTENCES.planDeadlineHit(1)).toBe('It stopped at its time limit; the nightly run picks up the rest.');
    expect(PLAN_LEFT_WORK_SENTENCES.planReplayFailed(1)).toBe('1 plan event failed when replayed; the nightly run will try again.');
    expect(PLAN_LEFT_WORK_SENTENCES.planReplayFailed(3)).toBe('3 plan events failed when replayed; the nightly run will try again.');
    expect(PLAN_LEFT_WORK_SENTENCES.planWindowClipped(1)).toBe('Only the last 7 days of Stripe events were checked.');
    expect(PLAN_LEFT_WORK_SENTENCES.planApiVersionSkipped(1)).toBe('1 plan event was skipped because Stripe used a version we have not checked.');
    expect(PLAN_LEFT_WORK_SENTENCES.planApiVersionSkipped(4)).toBe('4 plan events were skipped because Stripe used a version we have not checked.');
    expect(PLAN_LEFT_WORK_SENTENCES.planCheckIncomplete(1)).toBe('Not every plan subscription could be compared with Stripe; the nightly run will try again.');
  });

  it('findings are worded "with Stripe" or about a missing record, never like the list’s "Disagrees" between our two records', () => {
    const all = [1, 2].flatMap((n) => Object.values(PLAN_FINDING_SENTENCES).map((sentence) => sentence(n)));
    for (const line of all) {
      expect(line).toMatch(/logged for a person to check\.$/);
      expect(line).not.toMatch(/\bDisagrees\b/);
      expect(line).not.toMatch(/our (two )?records|each other/i);
    }
    expect(PLAN_FINDING_SENTENCES.planMismatch(1)).toBe('1 plan subscription disagrees with Stripe: logged for a person to check.');
    expect(PLAN_FINDING_SENTENCES.planMismatch(2)).toBe('2 plan subscriptions disagree with Stripe: logged for a person to check.');
    expect(PLAN_FINDING_SENTENCES.planOrphan(2)).toBe('2 Stripe plan subscriptions have no billing record: logged for a person to check.');
    expect(PLAN_FINDING_SENTENCES.planUnassigned(2)).toBe('2 paid plan invoices have no plan assigned: logged for a person to check.');
  });

  it('a clean run says finished, with the singular for one event', () => {
    expect(planReconcileSentences(counts({ planEventsSeen: 1, planReplayed: 0 }))).toEqual([
      'Plan reconcile finished: 1 plan event listed from Stripe, 0 replayed.',
    ]);
  });
});

// ── WSEQ: the block ignores an older answer (SA suggestion, 3b review) ───────

describe('WSEQ: the webhook block keeps the newest read', () => {
  it('an older answer that lands after a newer one is ignored', async () => {
    const first = deferred<Reply>();
    queues[WEBHOOKS_URL] = [first.promise, ok(payload(3))];
    installFetch();
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId(`job-${RECONCILE_JOB}`);
    await waitFor(() => expect(callsTo(WEBHOOKS_URL)).toHaveLength(1));

    // A second read starts while the first is still out, and answers first.
    fireEvent.click(screen.getByRole('button', { name: /Refresh the jobs and queues/ }));
    await waitFor(() => expect(callsTo(WEBHOOKS_URL)).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 3'));

    // The older read lands last: it must not replace the newer figures.
    await act(async () => {
      first.resolve(ok(payload(1)));
    });
    await act(async () => undefined);
    expect(screen.getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 3');
    expect(within(screen.getByTestId('webhook-events')).queryByText(/^Reading the webhook events/)).toBeNull();
  });

  it('an older FAILURE that lands after a newer success shows no error', async () => {
    const first = deferred<Reply>();
    queues[WEBHOOKS_URL] = [first.promise, ok(payload(2))];
    installFetch();
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId(`job-${RECONCILE_JOB}`);
    await waitFor(() => expect(callsTo(WEBHOOKS_URL)).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: /Refresh the jobs and queues/ }));
    await waitFor(() => expect(screen.getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 2'));

    await act(async () => {
      first.resolve({ status: 500, body: { success: false, error: 'x' } });
    });
    await act(async () => undefined);
    expect(screen.queryByTestId('webhook-events-error')).toBeNull();
    expect(screen.getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 2');
  });

  it('control: without an overlap, a later failure still shows its error (the guard drops only older answers)', async () => {
    queues[WEBHOOKS_URL] = [ok(payload(2)), { status: 500, body: { success: false, error: 'x' } }];
    installFetch();
    render(<AdminJobsQueuesPage />);
    await screen.findByTestId('webhook-kpi-failed-kpi');
    fireEvent.click(screen.getByRole('button', { name: /Refresh the jobs and queues/ }));
    expect(await screen.findByTestId('webhook-events-error')).toBeTruthy();
    // The previous figures stay beside the error.
    expect(screen.getByTestId('webhook-kpi-failed-kpi').getAttribute('aria-label')).toBe('Failed, 2');
  });
});

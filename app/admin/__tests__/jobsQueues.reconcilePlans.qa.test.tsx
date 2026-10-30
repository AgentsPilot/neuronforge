/**
 * @jest-environment jsdom
 */

/**
 * QA (P-8b.3c): adversarial tests for "Reconcile plan payments now".
 *
 *   QW   the words: singular and plural at 0, 1 and many; every count sentence
 *        appears only above 0; all 63 combinations of left work never read
 *        "finished"; line order; nothing reads like the list's "Disagrees";
 *        the "7 days" figure pinned to the pass's window limit (SA suggestion 2)
 *   QO   planReconcileOutcome on odd answers (missing, non-numeric, arrays)
 *   QD   the dialog rendered on its own with an onFinished spy: every failure
 *        answer (200 with a failed pass, missing counts, non-numeric counts,
 *        non-JSON, 4xx, 5xx, network); onFinished exactly once per press that
 *        reached the route and never on a network error; a double press while
 *        busy; Escape and Close while running; unmount while running
 *   QS   WebhookEventsBlock: three overlapping reads resolving in every order
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

import { ReconcilePlansDialog } from '../components/jobs/ReconcilePlansDialog';
import { WebhookEventsBlock } from '../components/jobs/WebhookEventsBlock';
import {
  PLAN_FINDING_SENTENCES,
  PLAN_LEFT_WORK_SENTENCES,
  PLAN_RECONCILE_COPY,
  RECONCILE_COPY,
  planReconcileOutcome,
  planReconcileSentences,
  reconcileSentences,
} from '../components/jobs/reconcileCopy';
import { PLAN_RECONCILE_COUNT_KEYS, PLAN_RECONCILE_LIMITS } from '@/lib/business-os/billing/planReconcilePass';
import { flattenedCountKey } from '@/lib/business-os/billing/reconcilePassRunner';
import { buildWebhookEventsView, type WebhookEventsInput } from '@/lib/admin/jobs/webhookEventsView';
import type { WebhookEventsPayload } from '@/lib/admin/jobs/webhookEventsTypes';
import { STALE_CLAIM_AGE_MS } from '@/lib/repositories/ProcessedWebhookEventRepository';

const PLANS_URL = '/api/admin/business-os/billing/reconcile';
const WEBHOOKS_URL = '/api/admin/jobs-queues/webhook-events';
const FAILED = PLAN_RECONCILE_COPY.failed;
const LEFT_KEYS = Object.keys(PLAN_LEFT_WORK_SENTENCES);
const FINDING_KEYS = Object.keys(PLAN_FINDING_SENTENCES);
const ZERO: Record<string, number> = Object.fromEntries(PLAN_RECONCILE_COUNT_KEYS.map((k) => [flattenedCountKey('plan', k), 0]));
const counts = (patch: Record<string, unknown> = {}) => ({ ...ZERO, planEventsSeen: 3, planReplayed: 1, ...patch });

// ── QW: the words ────────────────────────────────────────────────────────────

describe('QW: the words', () => {
  it('first line: 0 and many use the plural, 1 the singular', () => {
    expect(planReconcileSentences(counts({ planEventsSeen: 0, planReplayed: 0 }))).toEqual([
      'Plan reconcile finished: 0 plan events listed from Stripe, 0 replayed.',
    ]);
    expect(planReconcileSentences(counts({ planEventsSeen: 1, planReplayed: 1 }))[0]).toBe(
      'Plan reconcile finished: 1 plan event listed from Stripe, 1 replayed.'
    );
    expect(planReconcileSentences(counts({ planEventsSeen: 250, planReplayed: 200 }))[0]).toBe(
      'Plan reconcile finished: 250 plan events listed from Stripe, 200 replayed.'
    );
  });

  it.each([1, 2, 37])('every count sentence at N = %i reads right (singular at 1 only)', (n) => {
    const one = n === 1;
    expect(PLAN_LEFT_WORK_SENTENCES.planReplayFailed(n)).toBe(`${n} plan ${one ? 'event' : 'events'} failed when replayed; the nightly run will try again.`);
    expect(PLAN_LEFT_WORK_SENTENCES.planApiVersionSkipped(n)).toBe(
      `${n} plan ${one ? 'event was' : 'events were'} skipped because Stripe used a version we have not checked.`
    );
    expect(PLAN_FINDING_SENTENCES.planMismatch(n)).toBe(
      `${n} plan ${one ? 'subscription disagrees' : 'subscriptions disagree'} with Stripe: logged for a person to check.`
    );
    expect(PLAN_FINDING_SENTENCES.planOrphan(n)).toBe(
      `${n} Stripe plan ${one ? 'subscription has' : 'subscriptions have'} no billing record: logged for a person to check.`
    );
    expect(PLAN_FINDING_SENTENCES.planUnassigned(n)).toBe(
      `${n} paid plan ${one ? 'invoice has' : 'invoices have'} no plan assigned: logged for a person to check.`
    );
  });

  it.each([...LEFT_KEYS, ...FINDING_KEYS])('%s: absent at 0, present at 1 and at many', (key) => {
    const sentence = key in PLAN_LEFT_WORK_SENTENCES ? PLAN_LEFT_WORK_SENTENCES[key] : PLAN_FINDING_SENTENCES[key];
    expect(planReconcileSentences(counts({ [key]: 0 }))).toHaveLength(1);
    expect(planReconcileSentences(counts({ [key]: 1 }))).toContain(sentence(1));
    expect(planReconcileSentences(counts({ [key]: 5 }))).toContain(sentence(5));
    expect(planReconcileSentences(counts({ [key]: 5 }))).toHaveLength(2);
  });

  it('all 63 non-empty combinations of left work: the first line never says "finished"; the empty one does', () => {
    for (let mask = 0; mask < 1 << LEFT_KEYS.length; mask += 1) {
      const patch: Record<string, number> = {};
      LEFT_KEYS.forEach((key, i) => {
        if (mask & (1 << i)) patch[key] = 1;
      });
      // Findings on top never change the verdict.
      const lines = planReconcileSentences(counts({ ...patch, planMismatch: 1, planOrphan: 1, planUnassigned: 1 }));
      if (mask === 0) {
        expect(lines[0]).toMatch(/^Plan reconcile finished: /);
      } else {
        expect(lines[0]).toMatch(/^Plan reconcile did not finish everything: /);
        expect(lines.join(' ')).not.toMatch(/\bfinished\b/);
        expect(lines).toHaveLength(1 + Object.keys(patch).length + 3);
      }
    }
  });

  it('order: the first line, then left work in key order, then findings', () => {
    const all = Object.fromEntries([...LEFT_KEYS, ...FINDING_KEYS].map((k) => [k, 2]));
    const lines = planReconcileSentences(counts(all));
    expect(lines.slice(1)).toEqual([
      ...LEFT_KEYS.map((k) => PLAN_LEFT_WORK_SENTENCES[k](2)),
      ...FINDING_KEYS.map((k) => PLAN_FINDING_SENTENCES[k](2)),
    ]);
    // Each line is unique (the notice keys its <p> on the line).
    expect(new Set(lines).size).toBe(lines.length);
  });

  it('counts that are not shown: planSkippedNotPlan and planStaleReclaimed add no line', () => {
    expect(planReconcileSentences(counts({ planSkippedNotPlan: 9, planStaleReclaimed: 4 }))).toHaveLength(1);
  });

  it('nothing in the plan words reads like the Finance list\'s "Disagrees" chip', () => {
    const everything = [
      ...Object.values(PLAN_RECONCILE_COPY),
      ...[0, 1, 2].flatMap((n) => [...Object.values(PLAN_LEFT_WORK_SENTENCES), ...Object.values(PLAN_FINDING_SENTENCES)].map((f) => f(n))),
      ...planReconcileSentences(counts(Object.fromEntries([...LEFT_KEYS, ...FINDING_KEYS].map((k) => [k, 3])))),
    ];
    for (const line of everything) {
      expect(line).not.toMatch(/Disagrees/); // the chip's exact word
      expect(line).not.toMatch(/records? (that )?disagree|each other|our two records/i);
      // Any "disagree" is "with Stripe".
      if (/disagree/i.test(line)) expect(line).toMatch(/disagrees? with Stripe/);
    }
  });

  it('"the last 7 days" matches the pass\'s window limit (SA suggestion 2)', () => {
    const days = PLAN_RECONCILE_LIMITS.MAX_WINDOW_MS / (24 * 60 * 60 * 1000);
    expect(PLAN_LEFT_WORK_SENTENCES.planWindowClipped(1)).toContain(`the last ${days} days`);
  });

  it('regression: the boost words are unchanged by this slice', () => {
    // Byte-identical to HEAD (git show HEAD:…/reconcileCopy.ts, line 16).
    expect(RECONCILE_COPY.button).toBe('Reconcile top-ups now (all accounts)');
    expect(reconcileSentences({ boostListFailed: 1 })).toContain('Some top-ups could not be listed; the nightly run tries again.');
  });
});

// ── QO: planReconcileOutcome on odd answers ─────────────────────────────────

describe('QO: odd answers to planReconcileOutcome', () => {
  it.each([
    ['undefined', undefined],
    ['an array', []],
    ['counts null', { counts: null, passesFailed: 0 }],
    ['counts a string', { counts: 'x', passesFailed: 0 }],
    ['counts an array', { counts: [1, 2], passesFailed: 0 }],
    ['planEventsSeen a string', { counts: counts({ planEventsSeen: '3' }), passesFailed: 0 }],
    ['planEventsSeen null (what JSON makes of NaN)', { counts: counts({ planEventsSeen: null }), passesFailed: 0 }],
    ['passesFailed 2', { counts: counts(), passesFailed: 2 }],
    // Post-review fix 1 (fail closed): the cases below were documented as "finished" before.
    ['passesFailed missing', { counts: counts() }],
    ['passesFailed a string', { counts: counts(), passesFailed: '1' }],
    ['passesFailed a string zero', { counts: counts(), passesFailed: '0' }],
    ['passesFailed negative', { counts: counts(), passesFailed: -1 }],
    ['passesFailed a fraction', { counts: counts(), passesFailed: 0.5 }],
    ['a left-work count a string', { counts: counts({ planIncomplete: '1' }), passesFailed: 0 }],
    ['a left-work count null', { counts: counts({ planReplayFailed: null }), passesFailed: 0 }],
    ['a left-work count negative', { counts: counts({ planDeadlineHit: -1 }), passesFailed: 0 }],
    ['a left-work count a fraction', { counts: counts({ planCheckIncomplete: 0.5 }), passesFailed: 0 }],
    ['a finding count a string', { counts: counts({ planMismatch: '2' }), passesFailed: 0 }],
    ['planEventsSeen negative', { counts: counts({ planEventsSeen: -3 }), passesFailed: 0 }],
    ['planReplayed a string', { counts: counts({ planReplayed: '1' }), passesFailed: 0 }],
  ])('%s → null (the failure line)', (_n, data) => {
    expect(planReconcileOutcome(data)).toBeNull();
  });

  it('control: whole-number counts and passesFailed 0 still read as finished', () => {
    expect(planReconcileOutcome({ counts: counts(), passesFailed: 0 })![0]).toMatch(/^Plan reconcile finished/);
  });
});

// ── QD: the dialog on its own ───────────────────────────────────────────────

type Reply = { status: number; body?: unknown; badJson?: boolean } | 'network';
let fetchMock: jest.Mock;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function installFetch(replies: Array<Reply | Promise<Reply>>) {
  fetchMock = jest.fn(async () => {
    const next = await replies.shift();
    if (next === undefined) throw new Error('no reply queued');
    if (next === 'network') throw new TypeError('Failed to fetch');
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => {
        if (next.badJson) throw new SyntaxError('Unexpected token < in JSON at position 0');
        return next.body;
      },
    };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
}

const ok = (data: unknown): Reply => ({ status: 200, body: { success: true, data } });
const answer = (patch: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  runId: 'r1',
  counts: counts(patch),
  passesRun: 1,
  passesFailed: 0,
  durationMs: 5,
  ...extra,
});
const SERVER_TEXT = 'server words: cus_LEAK jane@example.org';

function mount() {
  const onFinished = jest.fn();
  const view = render(<ReconcilePlansDialog onFinished={onFinished} />);
  return { onFinished, ...view };
}
async function openAndRun() {
  fireEvent.click(screen.getByTestId('plan-reconcile'));
  const dialog = await screen.findByTestId('plan-reconcile-dialog');
  fireEvent.click(within(dialog).getByTestId('plan-reconcile-run'));
  return dialog;
}

beforeEach(() => {
  mockLoggerCalls.length = 0;
});

describe('QD: failure answers', () => {
  it.each<[string, Reply]>([
    ['200, passesFailed 1', ok(answer({}, { passesFailed: 1 }))],
    ['200, counts missing', ok({ runId: 'r1', passesRun: 1, passesFailed: 0 })],
    ['200, planEventsSeen non-numeric', ok(answer({ planEventsSeen: 'three' }))],
    ['200, data null', ok(null)],
    ['200, success false', { status: 200, body: { success: false, error: SERVER_TEXT, data: answer() } }],
    ['200, success "true" as a string', { status: 200, body: { success: 'true', data: answer() } }],
    ['200, a non-JSON body', { status: 200, badJson: true }],
    ['200, a JSON array', { status: 200, body: [answer()] }],
    ['400', { status: 400, body: { success: false, error: SERVER_TEXT, code: 'invalid_input' } }],
    ['401', { status: 401, body: { success: false, error: SERVER_TEXT } }],
    ['403', { status: 403, body: { success: false, error: SERVER_TEXT } }],
    ['404 HTML', { status: 404, badJson: true }],
    ['500', { status: 500, body: { success: false, error: SERVER_TEXT, details: SERVER_TEXT } }],
    ['502 HTML from the edge', { status: 502, badJson: true }],
    ['504 with a success body (a proxy lying)', { status: 504, body: { success: true, data: answer() } }],
  ])('%s: the fixed failure line, dialog stays open, no notice, no server text; onFinished once', async (_n, reply) => {
    installFetch([reply]);
    const { onFinished } = mount();
    const dialog = await openAndRun();
    expect((await within(dialog).findByTestId('plan-reconcile-error')).textContent).toBe(FAILED);
    expect(screen.getByTestId('plan-reconcile-dialog')).toBe(dialog);
    expect(screen.queryByTestId('plan-reconcile-notice')).toBeNull();
    expect(document.body.textContent).not.toContain('cus_LEAK');
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mockLoggerCalls)).not.toContain('cus_LEAK');
    // Run is usable again.
    expect((within(dialog).getByTestId('plan-reconcile-run') as HTMLButtonElement).disabled).toBe(false);
  });

  it('a network error: the failure line, and onFinished is NEVER called', async () => {
    installFetch(['network']);
    const { onFinished } = mount();
    const dialog = await openAndRun();
    expect((await within(dialog).findByTestId('plan-reconcile-error')).textContent).toBe(FAILED);
    await act(async () => undefined);
    expect(onFinished).not.toHaveBeenCalled();
    expect(mockLoggerCalls).toHaveLength(1);
    expect(Object.keys(mockLoggerCalls[0][0] as object)).toEqual(['err']);
  });

  it('a failure, then Run again with success: onFinished once per press (2), the error clears and the notice shows', async () => {
    installFetch([{ status: 500, body: { success: false } }, ok(answer())]);
    const { onFinished } = mount();
    const dialog = await openAndRun();
    await within(dialog).findByTestId('plan-reconcile-error');
    expect(onFinished).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByTestId('plan-reconcile-run'));
    await waitFor(() => expect(screen.queryByTestId('plan-reconcile-dialog')).toBeNull());
    expect(onFinished).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('plan-reconcile-notice').textContent).toContain('Plan reconcile finished');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('network, then a press that reaches the route: onFinished only for the second', async () => {
    installFetch(['network', { status: 500, body: {} }]);
    const { onFinished } = mount();
    const dialog = await openAndRun();
    await within(dialog).findByTestId('plan-reconcile-error');
    expect(onFinished).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByTestId('plan-reconcile-run'));
    await waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
  });
});

describe('QD: one run at a time', () => {
  it('a double press while busy (two submits and two clicks): one POST, onFinished once', async () => {
    const held = deferred<Reply>();
    installFetch([held.promise, ok(answer())]);
    const { onFinished } = mount();
    fireEvent.click(screen.getByTestId('plan-reconcile'));
    const dialog = await screen.findByTestId('plan-reconcile-dialog');
    const run = within(dialog).getByTestId('plan-reconcile-run') as HTMLButtonElement;
    const form = run.closest('form')!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
      run.click();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(run.disabled).toBe(true);
    await act(async () => {
      held.resolve(ok(answer()));
    });
    await waitFor(() => expect(screen.queryByTestId('plan-reconcile-dialog')).toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it('closing while running is refused: Escape, Close and an outside press leave it open; the answer still lands', async () => {
    const held = deferred<Reply>();
    installFetch([held.promise]);
    const { onFinished } = mount();
    const dialog = await openAndRun();
    const close = within(dialog).getByTestId('plan-reconcile-close') as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    fireEvent.click(close);
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    fireEvent.pointerDown(document.body);
    await act(async () => undefined);
    expect(screen.getByTestId('plan-reconcile-dialog')).toBe(dialog);
    expect(dialog.getAttribute('aria-busy')).toBe('true');
    await act(async () => {
      held.resolve(ok(answer({ planReplayFailed: 2 })));
    });
    await waitFor(() => expect(screen.queryByTestId('plan-reconcile-dialog')).toBeNull());
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(Array.from(screen.getByTestId('plan-reconcile-notice').querySelectorAll('p')).map((p) => p.textContent)).toEqual([
      'Plan reconcile did not finish everything: 3 plan events listed from Stripe, 1 replayed.',
      '2 plan events failed when replayed; the nightly run will try again.',
    ]);
  });

  it('after the answer, Escape closes again (the busy guard is released)', async () => {
    installFetch([{ status: 500, body: {} }]);
    mount();
    const dialog = await openAndRun();
    await within(dialog).findByTestId('plan-reconcile-error');
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('plan-reconcile-dialog')).toBeNull());
  });

  it('unmounting while running throws nothing; onFinished fires at most once', async () => {
    const held = deferred<Reply>();
    installFetch([held.promise]);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { onFinished, unmount } = mount();
    await openAndRun();
    unmount();
    await act(async () => {
      held.resolve(ok(answer()));
    });
    await act(async () => undefined);
    expect(onFinished.mock.calls.length).toBeLessThanOrEqual(1);
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('the request body is the literal "{}" whatever happened before (no account id ever)', async () => {
    installFetch([ok(answer()), ok(answer())]);
    mount();
    await openAndRun();
    await waitFor(() => expect(screen.queryByTestId('plan-reconcile-dialog')).toBeNull());
    await openAndRun();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe(PLANS_URL);
      expect(init).toEqual({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', cache: 'no-store' });
    }
  });
});

// ── QS: WebhookEventsBlock, three overlapping reads ─────────────────────────

const NOW = new Date('2026-10-28T12:00:00.000Z');
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

type BlockReply = { kind: 'ok'; failed: number } | { kind: 'error' } | { kind: 'network' };
const PERMUTATIONS = [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
];

async function threeReads(replies: BlockReply[], order: number[]) {
  const held = replies.map(() => deferred<BlockReply>());
  let call = 0;
  fetchMock = jest.fn(async (url: string) => {
    expect(url).toBe(WEBHOOKS_URL);
    const r = await held[call++].promise;
    if (r.kind === 'network') throw new TypeError('Failed to fetch');
    if (r.kind === 'error') return { ok: false, status: 500, json: async () => ({ success: false, error: 'read failed' }) };
    return { ok: true, status: 200, json: async () => ({ success: true, data: payload(r.failed) }) };
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- jsdom has no fetch; standard test stub
  (global as any).fetch = fetchMock;
  const view = render(<WebhookEventsBlock refreshKey={0} />);
  view.rerender(<WebhookEventsBlock refreshKey={1} />);
  view.rerender(<WebhookEventsBlock refreshKey={2} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  const states: Array<{ busy: boolean }> = [];
  for (const i of order) {
    await act(async () => {
      held[i].resolve(replies[i]);
    });
    await act(async () => undefined);
    const busyHolder = screen.getByTestId('webhook-events').querySelector('[aria-busy]');
    states.push({ busy: busyHolder ? busyHolder.getAttribute('aria-busy') === 'true' : screen.queryByText(/Reading the webhook events/) !== null });
  }
  return { states, order };
}
const failedTile = () => screen.queryByTestId('webhook-kpi-failed-kpi')?.getAttribute('aria-label') ?? null;

describe('QS: three overlapping reads, every resolution order', () => {
  it.each(PERMUTATIONS)('order %i,%i,%i: the newest (third) read wins; loading ends only with it', async (...order) => {
    const { states } = await threeReads(
      [
        { kind: 'ok', failed: 1 },
        { kind: 'ok', failed: 2 },
        { kind: 'ok', failed: 3 },
      ],
      order
    );
    expect(failedTile()).toBe('Failed, 3');
    expect(screen.queryByTestId('webhook-events-error')).toBeNull();
    // Still loading at every step until the third read answered.
    const thirdAt = order.indexOf(2);
    states.forEach((s, step) => expect({ step, busy: s.busy }).toEqual({ step, busy: step < thirdAt }));
  });

  it.each(PERMUTATIONS)('order %i,%i,%i: older failures and network errors are ignored when the newest succeeds', async (...order) => {
    await threeReads([{ kind: 'error' }, { kind: 'network' }, { kind: 'ok', failed: 4 }], order);
    expect(failedTile()).toBe('Failed, 4');
    expect(screen.queryByTestId('webhook-events-error')).toBeNull();
  });

  it.each(PERMUTATIONS)('order %i,%i,%i: the newest failing shows its error; older successes never paint over it', async (...order) => {
    await threeReads([{ kind: 'ok', failed: 1 }, { kind: 'ok', failed: 2 }, { kind: 'error' }], order);
    expect(screen.getByTestId('webhook-events-error')).toBeTruthy();
    // No older answer may set the figures: none were on screen before the reads overlapped.
    expect(failedTile()).toBeNull();
  });
});

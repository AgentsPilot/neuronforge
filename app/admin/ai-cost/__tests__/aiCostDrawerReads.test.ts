/**
 * Money MK-8b (§8.1): the AI cost drawers' one read. The key is the report
 * request for one business in the dates on screen, in `reportSearch`'s order;
 * every answer becomes a shared admin state; a log never carries an id or a
 * name (SA-WP-MK8B C-4), and an abort logs nothing.
 */

const warn = jest.fn();
jest.mock('@/lib/logger/client', () => ({
  clientLogger: { child: () => ({ warn, info: jest.fn(), error: jest.fn(), debug: jest.fn() }) },
}));

import { ADMIN_NETWORK_ERROR } from '@/app/admin/components/layout/readAdminResponse';
import { COSTS_PLATFORM_ACCOUNT } from '@/app/admin/business-os-llm/costCopy';
import { reportSearch } from '../aiCostFilters';
import { aiCostDrawerKey, readAiCostDrawer } from '../aiCostDrawerReads';

const A = '1a2b3c4d-1111-4111-8111-abcdefabcdef';
const REPORT = '/api/admin/business-os/credits/report';

function respond(status: number, body: unknown) {
  global.fetch = jest.fn(async () => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response) as unknown as typeof fetch;
}

beforeEach(() => warn.mockClear());

describe('aiCostDrawerKey', () => {
  it('is the report request for that business, in reportSearch order', () => {
    expect(aiCostDrawerKey({ from: '2026-10-01', to: '2026-10-16' }, A)).toBe(`from=2026-10-01&to=2026-10-16&accountId=${A}`);
    // Same string the page sends with that business picked.
    const picked = reportSearch({ kind: 'custom', from: '2026-09-01', to: '2026-09-30' }, A, new Date('2026-10-16T10:00:00Z'));
    expect(aiCostDrawerKey({ from: '2026-09-01', to: '2026-09-30' }, A)).toBe(picked);
  });
});

describe('readAiCostDrawer', () => {
  const signal = () => new AbortController().signal;

  it('reads the report route once, no-store, and answers the data', async () => {
    respond(200, { success: true, data: { marker: 1 } });
    const key = aiCostDrawerKey({ from: '2026-10-01', to: '2026-10-16' }, A);
    await expect(readAiCostDrawer(key, signal())).resolves.toEqual({ ok: true, data: { kind: 'report', report: { marker: 1 } } });
    const calls = (global.fetch as jest.Mock).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(`${REPORT}?${key}`);
    expect(calls[0][1]).toMatchObject({ method: 'GET', cache: 'no-store' });
  });

  // MK8B note / FU2-C1: a platform account is its own KIND, from the status AND the route's stable code.
  it('409 platform_account: answered as the platform_account kind (data, not an error)', async () => {
    respond(409, { success: false, error: 'platform_account' });
    await expect(readAiCostDrawer('k', signal())).resolves.toEqual({ ok: true, data: { kind: 'platform_account' } });
  });

  it('FU2-C1: any other 409 stays an error with its reason', async () => {
    respond(409, { success: false, error: 'conflict' });
    await expect(readAiCostDrawer('k', signal())).resolves.toEqual({ ok: false, message: 'conflict' });
  });

  it('FU2-C1: the platform code on another status is not the platform kind', async () => {
    respond(400, { success: false, error: 'platform_account' });
    await expect(readAiCostDrawer('k', signal())).resolves.toEqual({ ok: false, message: 'platform_account' });
  });

  it('the platform SENTENCE as a reason is just a reason (wording never decides the kind)', async () => {
    respond(400, { success: false, error: COSTS_PLATFORM_ACCOUNT });
    await expect(readAiCostDrawer('k', signal())).resolves.toEqual({ ok: false, message: COSTS_PLATFORM_ACCOUNT });
  });

  it('400 with a reason: that reason', async () => {
    respond(400, { success: false, error: 'The window is longer than 92 days.' });
    await expect(readAiCostDrawer('k', signal())).resolves.toEqual({ ok: false, message: 'The window is longer than 92 days.' });
  });

  it.each([401, 403])('%i: the session-ended words', async (status) => {
    respond(status, { success: false, error: 'Unauthorized' });
    await expect(readAiCostDrawer('k', signal())).resolves.toEqual({ ok: false, message: 'Your admin session has ended. Sign in again.' });
  });

  it('500 with no body: the shared fallback', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json'); } }) as unknown as Response) as unknown as typeof fetch;
    const result = await readAiCostDrawer('k', signal());
    expect(result).toEqual({ ok: false, message: "Could not read this business's AI cost. Try again in a moment." });
  });

  it('a throw: the network sentence, and a warn that names no id', async () => {
    global.fetch = jest.fn(async () => { throw new TypeError(`failed ${A}`); }) as unknown as typeof fetch;
    const key = aiCostDrawerKey({ from: '2026-10-01', to: '2026-10-16' }, A);
    await expect(readAiCostDrawer(key, signal())).resolves.toEqual({ ok: false, message: ADMIN_NETWORK_ERROR });
    expect(warn).toHaveBeenCalledTimes(1);
    const [context, message] = warn.mock.calls[0];
    expect(Object.keys(context)).toEqual(['err']);
    expect(message).not.toContain(A);
  });

  it('an abort logs nothing', async () => {
    const controller = new AbortController();
    controller.abort();
    global.fetch = jest.fn(async () => { throw new DOMException('aborted', 'AbortError'); }) as unknown as typeof fetch;
    await expect(readAiCostDrawer('k', controller.signal)).resolves.toEqual({ ok: false, message: ADMIN_NETWORK_ERROR });
    expect(warn).not.toHaveBeenCalled();
  });
});

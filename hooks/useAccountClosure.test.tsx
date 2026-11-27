/**
 * @jest-environment jsdom
 *
 * The Danger Zone's reads (DL-2a; DL-2 workplan §5.2, D-3). The closure route
 * first; the pre-check only when no request is open or the closure read
 * failed; `refreshClosure` re-reads the closure only.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

// SA CR-1: the host refresh goes through the public next/navigation API.
const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn(), replace: jest.fn() }) }));
import { readClosure, useDangerZoneState, useHostRefresh, ACCOUNT_CLOSURE_URL } from './useAccountClosure';

const CHECK_URL = '/api/business-os/account/deletion-check';
const PENDING = {
  status: 'pending',
  planEndsAt: '2026-11-26T10:00:00.000Z',
  lockAt: '2026-12-09T22:00:00.000Z',
  lockAtIsProjected: true,
  timezone: 'Asia/Jerusalem',
  renewalWasOn: true,
  graceDays: 14,
};

const fetchMock = jest.fn();
let closureBodies: Array<{ status: number; body: unknown }>;

beforeEach(() => {
  closureBodies = [{ status: 200, body: { success: true, data: { closure: null } } }];
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    const reply =
      url === ACCOUNT_CLOSURE_URL
        ? closureBodies.length > 1
          ? closureBodies.shift()!
          : closureBodies[0]
        : { status: 200, body: { success: true, data: { enabled: false } } };
    return { ok: reply.status === 200, status: reply.status, json: async () => reply.body };
  });
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  delete (global as unknown as { fetch?: typeof fetch }).fetch;
});

const calls = (url: string) => fetchMock.mock.calls.filter(([u]) => String(u).split('?')[0] === url).length;

describe('readClosure', () => {
  it('parses an open closure with the route schema', async () => {
    closureBodies = [{ status: 200, body: { success: true, data: { closure: PENDING }, correlationId: 'c' } }];
    expect(await readClosure()).toEqual({ status: 'open', closure: PENDING });
  });

  it.each([
    ['a non-200', { status: 503, body: { success: false, error: 'try_again' } }],
    ['an unexpected shape', { status: 200, body: { success: true, data: { closure: { ...PENDING, status: 'kept' } } } }],
    ['an extra key (strict)', { status: 200, body: { success: true, data: { closure: { ...PENDING, reasonCode: 'other' } } } }],
  ])('%s → error', async (_name, reply) => {
    closureBodies = [reply];
    expect(await readClosure()).toEqual({ status: 'error' });
  });

  it('a throw → error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await readClosure()).toEqual({ status: 'error' });
  });
});

describe('useDangerZoneState', () => {
  it('open → the pre-check is never called', async () => {
    closureBodies = [{ status: 200, body: { success: true, data: { closure: PENDING } } }];
    const { result } = renderHook(() => useDangerZoneState());
    await waitFor(() => expect(result.current.closure.status).toBe('open'));
    expect(calls(CHECK_URL)).toBe(0);
    expect(result.current.check.status).toBe('loading');
  });

  it('none → then the pre-check, once', async () => {
    const { result } = renderHook(() => useDangerZoneState());
    await waitFor(() => expect(result.current.check.status).toBe('off'));
    expect(calls(ACCOUNT_CLOSURE_URL)).toBe(1);
    expect(calls(CHECK_URL)).toBe(1);
  });

  it('a closure error → the pre-check anyway', async () => {
    closureBodies = [{ status: 500, body: {} }];
    const { result } = renderHook(() => useDangerZoneState());
    await waitFor(() => expect(result.current.check.status).toBe('off'));
    expect(result.current.closure.status).toBe('error');
  });

  it('refreshClosure re-reads the closure only, and resolves with what it read', async () => {
    closureBodies = [
      { status: 200, body: { success: true, data: { closure: null } } },
      { status: 200, body: { success: true, data: { closure: PENDING } } },
    ];
    const { result } = renderHook(() => useDangerZoneState());
    await waitFor(() => expect(result.current.check.status).toBe('off'));
    let read: unknown;
    await act(async () => {
      read = await result.current.refreshClosure();
    });
    expect(read).toEqual({ status: 'open', closure: PENDING });
    expect(result.current.closure.status).toBe('open');
    expect(calls(ACCOUNT_CLOSURE_URL)).toBe(2);
    expect(calls(CHECK_URL)).toBe(1);
  });
});

describe('useHostRefresh', () => {
  it('calls router.refresh() of the host page, once per call', () => {
    mockRefresh.mockReset();
    const { result } = renderHook(() => useHostRefresh());
    expect(mockRefresh).not.toHaveBeenCalled();
    result.current();
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

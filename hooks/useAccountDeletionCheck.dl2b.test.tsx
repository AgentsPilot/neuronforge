/**
 * @jest-environment jsdom
 *
 * DL-2b (DL-2 workplan §6.1): the pre-check read carries `?lang=`, the only
 * input the route accepts; any UI language but en / he / es asks for `en`.
 * The answer's new fields parse with the route's own schema.
 */

import { renderHook, waitFor } from '@testing-library/react';

const mockRefresh = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh, push: jest.fn(), replace: jest.fn() }) }));

import { deletionCheckUrl, useAccountDeletionCheck } from './useAccountDeletionCheck';
import { useDangerZoneState } from './useAccountClosure';

const READY = {
  enabled: true,
  available: true,
  blockers: [],
  willKeepBilling: false,
  exportFacts: { lastReadyAt: null, downloaded: false },
  timeline: { kind: 'free', lockAt: '2026-12-09T22:00:00.000Z', timezone: 'Asia/Jerusalem', graceDays: 14 },
  futureBookings: { count: 2 },
};

const fetchMock = jest.fn();
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    const data = url.startsWith('/api/business-os/account/closure') ? { closure: null } : READY;
    return { ok: true, status: 200, json: async () => ({ success: true, data }) };
  });
  (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
});
afterAll(() => {
  delete (global as unknown as { fetch?: typeof fetch }).fetch;
});

describe('deletionCheckUrl', () => {
  it.each([
    ['en', 'en'],
    ['he', 'he'],
    ['es', 'es'],
    ['fr', 'en'],
    ['', 'en'],
    [undefined, 'en'],
  ])('%p → ?lang=%s', (language, lang) => {
    expect(deletionCheckUrl(language)).toBe(`/api/business-os/account/deletion-check?lang=${lang}`);
  });
});

describe('useAccountDeletionCheck', () => {
  it('reads with the language and parses timeline + futureBookings', async () => {
    const { result } = renderHook(() => useAccountDeletionCheck({ lang: 'he' }));
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/account/deletion-check?lang=he', expect.any(Object));
    const state = result.current.state;
    expect(state.status === 'ready' && state.data.timeline).toEqual(READY.timeline);
    expect(state.status === 'ready' && state.data.futureBookings).toEqual({ count: 2 });
  });

  it('no language → ?lang=en', async () => {
    const { result } = renderHook(() => useAccountDeletionCheck());
    await waitFor(() => expect(result.current.state.status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledWith('/api/business-os/account/deletion-check?lang=en', expect.any(Object));
  });
});

describe('useDangerZoneState passes the language to the deferred pre-check', () => {
  it('es', async () => {
    const { result } = renderHook(() => useDangerZoneState({ lang: 'es' }));
    await waitFor(() => expect(result.current.check.status).toBe('ready'));
    expect(fetchMock.mock.calls.map(([url]) => url)).toContain('/api/business-os/account/deletion-check?lang=es');
  });
});

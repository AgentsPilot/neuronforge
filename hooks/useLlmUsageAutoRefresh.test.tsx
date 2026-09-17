/**
 * @jest-environment jsdom
 *
 * useLlmUsageAutoRefresh — Layer 1.1 AC-18 (timers, no overlap, visibility,
 * trigger) and AC-19 (Debug Logs rules), WC-7.
 */

import { act, renderHook } from '@testing-library/react';
import type { LlmUsageReport } from '@/lib/business-os/usage/llmUsageReportTypes';
import { useLlmUsageAutoRefresh, type FetchReport, type FetchReportResult } from './useLlmUsageAutoRefresh';

const ACCOUNT = '2f734ed5-3681-4049-880d-3de7b096bea3';
const START = '2026-09-17T11:00:00.000Z';

function okResult(): FetchReportResult {
  return {
    status: 200,
    body: {
      success: true,
      data: { account: { userId: ACCOUNT, companyName: 'Acme', profileLookup: 'found' } } as unknown as LlmUsageReport,
    },
  };
}

let visibility: DocumentVisibilityState = 'visible';

beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

beforeEach(() => {
  jest.useFakeTimers();
  visibility = 'visible';
});

afterEach(() => {
  jest.useRealTimers();
});

async function flush() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function setup(fetchReport: jest.Mock) {
  const onLog = jest.fn();
  const onResponse = jest.fn();
  const hook = renderHook(() =>
    useLlmUsageAutoRefresh({ initialStartIso: START, onLog, onResponse, fetchReport: fetchReport as unknown as FetchReport })
  );
  act(() => hook.result.current.selectAccount(ACCOUNT));
  return { hook, onLog, onResponse };
}

describe('useLlmUsageAutoRefresh', () => {
  it('is off by default: no request without a manual refresh', async () => {
    const fetchReport = jest.fn().mockResolvedValue(okResult());
    setup(fetchReport);
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(fetchReport).not.toHaveBeenCalled();
  });

  it('sends trigger=manual on refresh, logs it and publishes the response', async () => {
    const fetchReport = jest.fn().mockResolvedValue(okResult());
    const { hook, onLog, onResponse } = setup(fetchReport);

    act(() => hook.result.current.refresh());
    await flush();

    expect(fetchReport).toHaveBeenCalledWith({ accountId: ACCOUNT, startIso: START, trigger: 'manual' }, expect.any(Object));
    expect(onLog.mock.calls.map((c) => c[0])).toEqual(['info', 'success']);
    expect(onResponse).toHaveBeenCalledTimes(1);
    expect(hook.result.current.state.phase).toBe('ready');
  });

  it('runs at the chosen interval with trigger=auto and no Debug Logs line on success', async () => {
    const fetchReport = jest.fn().mockResolvedValue(okResult());
    const { hook, onLog, onResponse } = setup(fetchReport);

    act(() => {
      hook.result.current.setIntervalSec(10);
      hook.result.current.setAutoRefresh(true);
    });
    await act(async () => {
      jest.advanceTimersByTime(9_999);
    });
    expect(fetchReport).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    await flush();
    expect(fetchReport).toHaveBeenCalledTimes(1);
    expect(fetchReport.mock.calls[0][0].trigger).toBe('auto');

    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await flush();
    expect(fetchReport).toHaveBeenCalledTimes(2);
    expect(onLog).not.toHaveBeenCalled();
    expect(onResponse).not.toHaveBeenCalled();
  });

  it('never overlaps: the next auto request waits until the slow one finished, plus the interval', async () => {
    let resolveSlow: (r: FetchReportResult) => void = () => undefined;
    const fetchReport = jest
      .fn()
      .mockImplementationOnce(() => new Promise<FetchReportResult>((resolve) => (resolveSlow = resolve)))
      .mockResolvedValue(okResult());
    const { hook } = setup(fetchReport);

    act(() => {
      hook.result.current.setIntervalSec(10);
      hook.result.current.setAutoRefresh(true);
    });
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(fetchReport).toHaveBeenCalledTimes(1);

    // 25 s pass while the first request is still running: nothing else starts.
    await act(async () => {
      jest.advanceTimersByTime(25_000);
    });
    expect(fetchReport).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSlow(okResult());
    });
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(9_999);
    });
    expect(fetchReport).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(fetchReport).toHaveBeenCalledTimes(2);
  });

  it('pauses while the browser tab is hidden and does not resume on its own', async () => {
    const fetchReport = jest.fn().mockResolvedValue(okResult());
    const { hook } = setup(fetchReport);

    act(() => {
      hook.result.current.setIntervalSec(10);
      hook.result.current.setAutoRefresh(true);
    });
    act(() => {
      visibility = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(hook.result.current.state.auto.status).toBe('paused_hidden');

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(fetchReport).not.toHaveBeenCalled();

    act(() => {
      visibility = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(fetchReport).not.toHaveBeenCalled();

    act(() => hook.result.current.refresh());
    await flush();
    expect(hook.result.current.state.auto.status).toBe('running');
  });

  it('sends nothing when the timer fires while hidden', async () => {
    const fetchReport = jest.fn().mockResolvedValue(okResult());
    const { hook } = setup(fetchReport);
    act(() => {
      hook.result.current.setIntervalSec(10);
      hook.result.current.setAutoRefresh(true);
    });
    visibility = 'hidden'; // no event: the tick itself must notice
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    expect(fetchReport).not.toHaveBeenCalled();
    expect(hook.result.current.state.auto.status).toBe('paused_hidden');
  });

  it('turns auto off and logs an error when an auto request fails, including a 400 (WC-7)', async () => {
    const fetchReport = jest.fn().mockResolvedValue({
      status: 400,
      body: { success: false, error: 'Start time is more than 7 days ago; the maximum window is 7 days' },
    });
    const { hook, onLog } = setup(fetchReport);

    act(() => {
      hook.result.current.setIntervalSec(10);
      hook.result.current.setAutoRefresh(true);
    });
    await act(async () => {
      jest.advanceTimersByTime(10_000);
    });
    await flush();

    expect(hook.result.current.state.auto.status).toBe('off');
    expect(hook.result.current.state.error).toMatch(/7 days/);
    expect(onLog).toHaveBeenCalledWith('error', expect.stringContaining('7 days'));

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(fetchReport).toHaveBeenCalledTimes(1);
  });

  it('stops auto-refresh when the start time changes', async () => {
    const fetchReport = jest.fn().mockResolvedValue(okResult());
    const { hook } = setup(fetchReport);
    act(() => {
      hook.result.current.setIntervalSec(10);
      hook.result.current.setAutoRefresh(true);
    });
    act(() => hook.result.current.setStart('2026-09-17T11:45:00.000Z'));
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(fetchReport).not.toHaveBeenCalled();
    expect(hook.result.current.state.auto.status).toBe('stopped_input_change');
  });

  it('clears the timer and aborts the in-flight request on unmount (leaving the tab)', async () => {
    let signal: AbortSignal | undefined;
    const fetchReport = jest.fn().mockImplementation((_p, s: AbortSignal) => {
      signal = s;
      return new Promise<FetchReportResult>(() => undefined);
    });
    const { hook, onLog } = setup(fetchReport);

    act(() => hook.result.current.refresh());
    expect(signal?.aborted).toBe(false);
    onLog.mockClear();

    hook.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(120_000);
    });
    expect(fetchReport).toHaveBeenCalledTimes(1);
    expect(onLog).not.toHaveBeenCalled();
  });
});

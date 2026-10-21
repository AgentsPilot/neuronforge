/**
 * @jest-environment jsdom
 */

/**
 * `useDrawerPrefetch` (C-a workplan T-H1..T-H9; SA C-a review Q-1, SA-CA-8).
 * The five rules: used once, maximum age, key, enabled, idle. Fake time only
 * moves `Date.now()` and runs the idle timer; nothing asserts a duration.
 */

import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import { act, render, renderHook } from '@testing-library/react';

import {
  DRAWER_PREFETCH_MAX_AGE_MS,
  useDrawerPrefetch,
  type DrawerPrefetchOptions,
} from '@/components/business-os/settings/useDrawerPrefetch';

type Opts = DrawerPrefetchOptions<{ n: number }>;

let started: number;
const start = jest.fn(() => ({ n: ++started }));

function setup(over: Partial<Opts> = {}) {
  const initial: Opts = { start, key: 'user-1:en', enabled: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false, ...over };
  return renderHook((props: Opts) => useDrawerPrefetch(props), { initialProps: initial });
}

const realIdle = window.requestIdleCallback;
const realCancelIdle = window.cancelIdleCallback;

beforeEach(() => {
  started = 0;
  start.mockClear();
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-16T10:00:00Z'));
});

afterEach(() => {
  jest.useRealTimers();
  window.requestIdleCallback = realIdle;
  window.cancelIdleCallback = realCancelIdle;
});

describe('useDrawerPrefetch', () => {
  it('T-H1: warm() starts once; a second warm() while the set is held starts nothing', () => {
    const { result } = setup();
    act(() => result.current.warm());
    act(() => result.current.warm());
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('T-H2: take() hands the held value over, then null (used once)', () => {
    const { result } = setup();
    act(() => result.current.warm());
    expect(result.current.take()).toEqual({ n: 1 });
    expect(result.current.take()).toBeNull();
  });

  it('T-H2: after a take, the next warm() starts a new set', () => {
    const { result } = setup();
    act(() => result.current.warm());
    result.current.take();
    act(() => result.current.warm());
    expect(start).toHaveBeenCalledTimes(2);
    expect(result.current.take()).toEqual({ n: 2 });
  });

  it('T-H3: take() with nothing warmed is null, and never starts anything', () => {
    const { result } = setup();
    expect(result.current.take()).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it('T-H4: at exactly maxAgeMs the set is still usable (boundary)', () => {
    const { result } = setup();
    act(() => result.current.warm());
    jest.setSystemTime(Date.now() + DRAWER_PREFETCH_MAX_AGE_MS);
    expect(result.current.take()).toEqual({ n: 1 });
  });

  it('T-H4: older than maxAgeMs → take() is null, and the next warm() starts again', () => {
    const { result } = setup();
    act(() => result.current.warm());
    jest.setSystemTime(Date.now() + DRAWER_PREFETCH_MAX_AGE_MS + 1);
    act(() => result.current.warm());
    expect(start).toHaveBeenCalledTimes(2);

    jest.setSystemTime(Date.now() + DRAWER_PREFETCH_MAX_AGE_MS + 1);
    expect(result.current.take()).toBeNull();
  });

  it('T-H4: the maximum age is 60 s (SA Q-3)', () => {
    expect(DRAWER_PREFETCH_MAX_AGE_MS).toBe(60_000);
  });

  it('T-H5: a key change (user or language) drops the held set', () => {
    const { result, rerender } = setup();
    act(() => result.current.warm());
    rerender({ start, key: 'user-1:he', enabled: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    expect(result.current.take()).toBeNull();
  });

  it('T-H5: a set is never handed to another key, even before the drop effect runs', () => {
    const { result, rerender } = setup();
    act(() => result.current.warm());
    rerender({ start, key: 'user-2:en', enabled: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    rerender({ start, key: 'user-1:en', enabled: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    // Dropped on the way through user-2, so coming back does not revive it.
    expect(result.current.take()).toBeNull();
  });

  /*
   * A child's effects run before its parent's. A drawer that mounts in the same
   * commit as a language switch takes the set before the page's drop effect
   * has run, so `take()` itself must refuse a set held under another key.
   */
  it('T-H5: take() refuses another key even before the drop effect runs (child effect, same commit)', () => {
    const taken: Array<{ n: number } | null> = [];
    function Child({ take }: { take: () => { n: number } | null }) {
      useEffect(() => {
        taken.push(take());
      }, [take]);
      return null;
    }
    function Parent({ lang, showChild }: { lang: string; showChild: boolean }) {
      const prefetch = useDrawerPrefetch({ start, key: `user-1:${lang}`, enabled: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
      warmRef.current = prefetch.warm;
      return showChild ? <Child take={prefetch.take} /> : null;
    }
    const warmRef: { current: () => void } = { current: () => undefined };
    const view = render(<Parent lang="en" showChild={false} />);
    act(() => warmRef.current());
    expect(start).toHaveBeenCalledTimes(1);
    view.rerender(<Parent lang="he" showChild />);
    expect(taken).toEqual([null]);
  });

  it('T-H6: enabled false → warm() is a no-op', () => {
    const { result } = setup({ enabled: false });
    act(() => result.current.warm());
    expect(start).not.toHaveBeenCalled();
    expect(result.current.take()).toBeNull();
  });

  it('T-H6: turning enabled false drops a held set', () => {
    const { result, rerender } = setup();
    act(() => result.current.warm());
    rerender({ start, key: 'user-1:en', enabled: false, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    rerender({ start, key: 'user-1:en', enabled: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    expect(result.current.take()).toBeNull();
  });

  /*
   * Rule 4's drop happens on the way OFF, not later: while the configuration
   * dialog is open (and during its closing grace) nothing may hand over a set
   * from before an address-book edit. Kills a drop moved to the way back on.
   */
  it('T-H6: the drop is immediate: take() while off is null', () => {
    const { result, rerender } = setup();
    act(() => result.current.warm());
    rerender({ start, key: 'user-1:en', enabled: false, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    expect(result.current.take()).toBeNull();
  });

  it('T-H7: key null → never starts', () => {
    const { result } = setup({ key: null, warmOnIdle: true });
    act(() => result.current.warm());
    act(() => {
      jest.runAllTimers();
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('T-H8: with requestIdleCallback, warm runs once after enabled turns true', () => {
    const callbacks: Array<() => void> = [];
    window.requestIdleCallback = jest.fn((cb: IdleRequestCallback) => {
      callbacks.push(() => cb({ didTimeout: false, timeRemaining: () => 50 }));
      return callbacks.length;
    }) as unknown as typeof window.requestIdleCallback;
    window.cancelIdleCallback = jest.fn();

    const { result, rerender } = setup({ enabled: false, warmOnIdle: true });
    expect(window.requestIdleCallback).not.toHaveBeenCalled();
    rerender({ start, key: 'user-1:en', enabled: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: true });
    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1);
    expect((window.requestIdleCallback as jest.Mock).mock.calls[0][1]).toEqual({ timeout: 2000 });
    expect(start).not.toHaveBeenCalled();

    act(() => callbacks[0]());
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.take()).toEqual({ n: 1 });
  });

  it('T-H8: without requestIdleCallback, the timer fallback warms', () => {
    // @ts-expect-error -- simulating Safari, which has no requestIdleCallback
    delete window.requestIdleCallback;
    const { result } = setup({ warmOnIdle: true });
    expect(start).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.take()).toEqual({ n: 1 });
  });

  it('T-H8: unmounting before idle cancels it; start is never called (timer)', () => {
    // @ts-expect-error -- simulating Safari, which has no requestIdleCallback
    delete window.requestIdleCallback;
    const { unmount } = setup({ warmOnIdle: true });
    unmount();
    act(() => {
      jest.runAllTimers();
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('T-H8: unmounting before idle cancels it (requestIdleCallback)', () => {
    window.requestIdleCallback = jest.fn(() => 7) as unknown as typeof window.requestIdleCallback;
    window.cancelIdleCallback = jest.fn();
    const { unmount } = setup({ warmOnIdle: true });
    unmount();
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(7);
  });

  it('T-H8: warmOnIdle false never schedules', () => {
    // @ts-expect-error -- simulating Safari, which has no requestIdleCallback
    delete window.requestIdleCallback;
    setup({ warmOnIdle: false });
    act(() => {
      jest.runAllTimers();
    });
    expect(start).not.toHaveBeenCalled();
  });

  it('T-H9: warm and take keep their identity across re-renders', () => {
    const { result, rerender } = setup();
    const { warm, take } = result.current;
    rerender({ start: jest.fn(() => ({ n: 99 })), key: 'user-1:he', enabled: true, maxAgeMs: 10, warmOnIdle: false });
    expect(result.current.warm).toBe(warm);
    expect(result.current.take).toBe(take);
  });

  it('T-H9: warm uses the latest start and key', () => {
    const { result, rerender } = setup();
    const latestStart = jest.fn(() => ({ n: 42 }));
    rerender({ start: latestStart, key: 'user-1:he', enabled: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    act(() => result.current.warm());
    expect(latestStart).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
    expect(result.current.take()).toEqual({ n: 42 });
  });

  /*
   * Rule 6, QA-CA-B1. The drawer that pauses the hook is the one that takes
   * the set, and its content mounts a commit later (a Radix portal), after the
   * page's effects for the render that paused it. So the set held when it
   * paused must still be there for that later take.
   */
  it('T-H6b: a child mounting a commit AFTER the parent paused still takes the set it opened with', () => {
    const taken: Array<{ n: number } | null> = [];
    function Child({ take }: { take: () => { n: number } | null }) {
      useEffect(() => {
        taken.push(take());
        // Mount only, like the panel.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    }
    // Mounts its child one commit after it mounts itself, as a Radix portal does.
    function LatePortal({ children }: { children: ReactNode }) {
      const [mounted, setMounted] = useState(false);
      useLayoutEffect(() => setMounted(true), []);
      return mounted ? <>{children}</> : null;
    }
    const warmRef: { current: () => void } = { current: () => undefined };
    function Parent({ open }: { open: boolean }) {
      const prefetch = useDrawerPrefetch({ start, key: 'user-1:en', enabled: true, paused: open, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
      warmRef.current = prefetch.warm;
      return open ? (
        <LatePortal>
          <Child take={prefetch.take} />
        </LatePortal>
      ) : null;
    }
    const view = render(<Parent open={false} />);
    act(() => warmRef.current());
    act(() => view.rerender(<Parent open />));
    expect(taken).toEqual([{ n: 1 }]);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('T-H6b: while paused, warm() starts nothing, and the slot stays empty after the take', () => {
    const { result, rerender } = setup();
    act(() => result.current.warm());
    rerender({ start, key: 'user-1:en', enabled: true, paused: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    expect(result.current.take()).toEqual({ n: 1 });
    act(() => result.current.warm());
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.take()).toBeNull();
  });

  it('T-H6b: un-pausing drops a set that was never taken (the drawer closed), so the next warm is fresh', () => {
    const { result, rerender } = setup();
    act(() => result.current.warm());
    rerender({ start, key: 'user-1:en', enabled: true, paused: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    rerender({ start, key: 'user-1:en', enabled: true, paused: false, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
    expect(result.current.take()).toBeNull();
    act(() => result.current.warm());
    expect(start).toHaveBeenCalledTimes(2);
    expect(result.current.take()).toEqual({ n: 2 });
  });

  it('T-H6c: an idle warm still pending when the hook pauses never starts; it is rescheduled when the pause ends', () => {
    const callbacks: Array<{ run: () => void; cancelled: boolean }> = [];
    window.requestIdleCallback = jest.fn((cb: IdleRequestCallback) => {
      callbacks.push({ run: () => cb({ didTimeout: false, timeRemaining: () => 50 }), cancelled: false });
      return callbacks.length;
    }) as unknown as typeof window.requestIdleCallback;
    window.cancelIdleCallback = jest.fn((handle: number) => {
      callbacks[handle - 1].cancelled = true;
    });

    const { result, rerender } = setup({ warmOnIdle: true });
    expect(callbacks).toHaveLength(1);
    rerender({ start, key: 'user-1:en', enabled: true, paused: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: true });
    expect(callbacks[0].cancelled).toBe(true);
    expect(callbacks).toHaveLength(1);
    // Even if the browser runs it anyway, a paused hook starts nothing.
    act(() => callbacks[0].run());
    expect(start).not.toHaveBeenCalled();

    rerender({ start, key: 'user-1:en', enabled: true, paused: false, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: true });
    expect(callbacks).toHaveLength(2);
    act(() => callbacks[1].run());
    expect(start).toHaveBeenCalledTimes(1);
    expect(result.current.take()).toEqual({ n: 1 });
  });

  it('T-H6c: without requestIdleCallback, the timer pending when the hook pauses never starts', () => {
    // @ts-expect-error -- simulating Safari, which has no requestIdleCallback
    delete window.requestIdleCallback;
    const { rerender } = setup({ warmOnIdle: true });
    rerender({ start, key: 'user-1:en', enabled: true, paused: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: true });
    act(() => {
      jest.advanceTimersByTime(1500);
    });
    expect(start).not.toHaveBeenCalled();
  });

  /*
   * QA-MU-4. Rule 2 measures the age from the set's START. A warm on a held
   * set (another hover) must not make it younger, or a set could be kept alive
   * past 60 s by moving the pointer over the row.
   */
  it('T-H4b: repeated warms on a held set do not refresh its age; it still expires 60 s after it started', () => {
    const { result } = setup();
    const t0 = Date.now();
    act(() => result.current.warm());
    jest.setSystemTime(t0 + 30_000);
    act(() => result.current.warm());
    jest.setSystemTime(t0 + 50_000);
    act(() => result.current.warm());
    expect(start).toHaveBeenCalledTimes(1);

    jest.setSystemTime(t0 + DRAWER_PREFETCH_MAX_AGE_MS + 1_000);
    expect(result.current.take()).toBeNull();
  });

  /*
   * QA-MU-1 and requirement R-4 (sign-out then sign-in in the same tab): what
   * the hook holds goes with the component. A remount with the same key, whose
   * child takes in its mount effect (before the parent's own effects), gets
   * nothing.
   */
  it('T-H10: a held set does not survive an unmount; a remount with the same key hands over nothing', () => {
    const taken: Array<{ n: number } | null> = [];
    function Child({ take }: { take: () => { n: number } | null }) {
      useEffect(() => {
        taken.push(take());
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    }
    const warmRef: { current: () => void } = { current: () => undefined };
    function Parent({ showChild }: { showChild: boolean }) {
      const prefetch = useDrawerPrefetch({ start, key: 'user-1:en', enabled: true, maxAgeMs: DRAWER_PREFETCH_MAX_AGE_MS, warmOnIdle: false });
      warmRef.current = prefetch.warm;
      return showChild ? <Child take={prefetch.take} /> : null;
    }
    const first = render(<Parent showChild={false} />);
    act(() => warmRef.current());
    expect(start).toHaveBeenCalledTimes(1);
    first.unmount();

    render(<Parent showChild />);
    expect(taken).toEqual([null]);
  });
});

/**
 * @jest-environment jsdom
 *
 * creditUsageSignal — the typed "credit usage may have changed" browser signal
 * (credit deduction slice 6a, SA SQ-24).
 */

import { CREDIT_USAGE_CHANGED_EVENT, notifyCreditUsageChanged, onCreditUsageChanged } from '../creditUsageSignal';

describe('creditUsageSignal', () => {
  it('a raise reaches a listener once, with nothing passed to it', () => {
    const handler = jest.fn();
    const off = onCreditUsageChanged(handler);

    notifyCreditUsageChanged();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith();
    off();
  });

  it('the event carries no payload', () => {
    const seen: Event[] = [];
    const listener = (event: Event) => seen.push(event);
    window.addEventListener(CREDIT_USAGE_CHANGED_EVENT, listener);

    notifyCreditUsageChanged();

    window.removeEventListener(CREDIT_USAGE_CHANGED_EVENT, listener);
    expect(seen).toHaveLength(1);
    expect((seen[0] as CustomEvent).detail ?? null).toBeNull();
  });

  it('unsubscribing stops delivery', () => {
    const handler = jest.fn();
    const off = onCreditUsageChanged(handler);
    off();
    notifyCreditUsageChanged();
    expect(handler).not.toHaveBeenCalled();
  });

  it('a raise with nobody listening is a no-op', () => {
    expect(() => notifyCreditUsageChanged()).not.toThrow();
  });
});

describe('creditUsageSignal without a window (SSR)', () => {
  it('both functions do nothing', () => {
    const original = globalThis.window;
    // Simulate the server: no window at all.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deleting a global for the SSR case
    delete (globalThis as any).window;
    try {
      expect(() => notifyCreditUsageChanged()).not.toThrow();
      const off = onCreditUsageChanged(jest.fn());
      expect(() => off()).not.toThrow();
    } finally {
      globalThis.window = original;
    }
  });
});

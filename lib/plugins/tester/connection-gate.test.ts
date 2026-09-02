// lib/plugins/tester/connection-gate.test.ts
import {
  evaluateConnectionGate,
  runSequentialRefresh,
  REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS,
} from './connection-gate';

const allConnected = {
  connected: REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS.map((key) => ({ key })),
};

describe('evaluateConnectionGate (FR12/D6)', () => {
  it('enables when all five Google Suite plugins are connected', () => {
    const result = evaluateConnectionGate('user-1', allConnected);
    expect(result.enabled).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.userIdRequired).toBe(false);
    expect(result.perPlugin).toHaveLength(5);
    expect(result.perPlugin.every((p) => p.connected)).toBe(true);
  });

  it('disables and lists the missing plugin when one is not connected', () => {
    const status = {
      connected: [
        { key: 'google-drive' },
        { key: 'google-sheets' },
        { key: 'google-docs' },
        { key: 'google-mail' },
        // google-calendar missing
      ],
    };
    const result = evaluateConnectionGate('user-1', status);
    expect(result.enabled).toBe(false);
    expect(result.missing).toEqual(['google-calendar']);
    expect(result.userIdRequired).toBe(false);
    expect(result.perPlugin.find((p) => p.key === 'google-calendar')?.connected).toBe(false);
  });

  it('disables with all missing when status is empty', () => {
    const result = evaluateConnectionGate('user-1', { connected: [] });
    expect(result.enabled).toBe(false);
    expect(result.missing).toEqual([...REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS]);
  });

  it('short-circuits to userIdRequired when userId is empty (FR11)', () => {
    const result = evaluateConnectionGate('', allConnected);
    expect(result.enabled).toBe(false);
    expect(result.userIdRequired).toBe(true);
    expect(result.missing).toEqual([...REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS]);
  });

  it('short-circuits when userId is whitespace only', () => {
    const result = evaluateConnectionGate('   ', allConnected);
    expect(result.userIdRequired).toBe(true);
    expect(result.enabled).toBe(false);
  });

  it('treats null status as not-connected (not yet loaded)', () => {
    const result = evaluateConnectionGate('user-1', null);
    expect(result.enabled).toBe(false);
    expect(result.missing).toEqual([...REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS]);
  });

  it('treats an expired plugin as not-runnable and surfaces it distinctly (Fix 1)', () => {
    // All five appear in `connected`, but one token is expired.
    const status = {
      connected: REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS.map((key) => ({ key })),
      active_expired: ['google-calendar'],
    };
    const result = evaluateConnectionGate('user-1', status);
    expect(result.enabled).toBe(false);
    expect(result.missing).toEqual(['google-calendar']);
    expect(result.expired).toEqual(['google-calendar']);
    const cal = result.perPlugin.find((p) => p.key === 'google-calendar');
    expect(cal).toEqual({ key: 'google-calendar', connected: false, expired: true });
  });

  it('enables when all five are connected and none expired', () => {
    const status = {
      connected: REQUIRED_GOOGLE_SUITE_PLUGIN_KEYS.map((key) => ({ key })),
      active_expired: [],
    };
    const result = evaluateConnectionGate('user-1', status);
    expect(result.enabled).toBe(true);
    expect(result.expired).toEqual([]);
  });
});

describe('runSequentialRefresh (refresh-all, one by one)', () => {
  it('refreshes keys sequentially, awaiting each before the next', async () => {
    const order: string[] = [];
    let active = 0;
    const refreshOne = jest.fn(async (key: string) => {
      active++;
      expect(active).toBe(1); // never overlaps → truly sequential
      await new Promise((r) => setTimeout(r, 5));
      order.push(key);
      active--;
    });

    const failed = await runSequentialRefresh(['a', 'b', 'c'], refreshOne);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(failed).toEqual([]);
  });

  it('reports progress as current/total/key for each step', async () => {
    const progress: Array<{ current: number; total: number; key: string }> = [];
    await runSequentialRefresh(['x', 'y'], async () => {}, (p) => progress.push(p));
    expect(progress).toEqual([
      { current: 1, total: 2, key: 'x' },
      { current: 2, total: 2, key: 'y' },
    ]);
  });

  it('continues past a failing key and returns the failed keys', async () => {
    const refreshOne = jest.fn(async (key: string) => {
      if (key === 'b') throw new Error('boom');
    });
    const failed = await runSequentialRefresh(['a', 'b', 'c'], refreshOne);
    expect(refreshOne).toHaveBeenCalledTimes(3); // did not wedge
    expect(failed).toEqual(['b']);
  });
});

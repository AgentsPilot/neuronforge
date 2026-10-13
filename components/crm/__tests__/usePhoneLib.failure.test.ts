/**
 * PERF-2: a failed phone-library download never throws into the form around it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The library is now fetched after the page loads, so it can fail on its own
 * (offline after load, a dropped chunk request). The loader must:
 *   - resolve to null rather than reject, so the modal or drawer stays usable
 *     and shows the field's placeholder;
 *   - not remember the failure, so the next mount of a phone field retries;
 *   - log it (Pino), never swallow it.
 * Its own file because the mock below must fail for the whole module registry.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const attempts: number[] = [];

jest.mock('@/components/crm/phoneLib', () => {
  attempts.push(attempts.length + 1);
  throw new Error('ChunkLoadError: offline');
});

const warn = jest.fn();
jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn, error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
}));

import { loadPhoneLib } from '../usePhoneLib';

describe('loadPhoneLib when the download fails', () => {
  it('resolves to null instead of rejecting, and logs the failure', async () => {
    await expect(loadPhoneLib()).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toHaveProperty('err');
  });

  it('does not cache the failure: the next call tries again', async () => {
    const before = attempts.length;
    await expect(loadPhoneLib()).resolves.toBeNull();
    expect(attempts.length).toBe(before + 1);
  });
});

/**
 * Contract lock for requestDeduplicator, specifically the behaviour the post-login
 * cookie-race retry in components/UserProvider.tsx depends on (SA review R3 / C10).
 *
 * getUserPluginStatus() wraps its fetch in requestDeduplicator.deduplicate(
 *   `plugin-status-${userId}`, ...) with a 1000 ms TTL. The deduplicator caches the
 * PROMISE — including a rejected one — until settle + TTL. So a naive retry inside that
 * window replays the same rejection and issues NO second HTTP request; the retry has to
 * clear the key first. These tests prove both halves of that claim, so the fix cannot be
 * silently reverted (e.g. by someone "simplifying" the retry back to a bare re-call).
 */

import { requestDeduplicator } from '../request-deduplication';

const KEY = 'plugin-status-11111111-1111-4111-8111-111111111111';

describe('requestDeduplicator — retry semantics relied on by UserProvider', () => {
  beforeEach(() => {
    requestDeduplicator.clear();
  });

  it('replays a cached REJECTION instead of re-issuing the request (why the fix is needed)', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('401 Authentication required'));

    await expect(requestDeduplicator.deduplicate(KEY, fetcher)).rejects.toThrow('401');
    // Retry WITHOUT clearing — inside the 1000 ms TTL.
    await expect(requestDeduplicator.deduplicate(KEY, fetcher)).rejects.toThrow('401');

    expect(fetcher).toHaveBeenCalledTimes(1); // no second request was ever made
  });

  it('issues a real second request once the key is cleared (the fix)', async () => {
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new Error('401 Authentication required'))
      .mockResolvedValueOnce({ connected: [] });

    await expect(requestDeduplicator.deduplicate(KEY, fetcher)).rejects.toThrow('401');

    requestDeduplicator.clear(KEY);
    await expect(requestDeduplicator.deduplicate(KEY, fetcher)).resolves.toEqual({ connected: [] });

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('clearing one key does not disturb another user’s in-flight entry', async () => {
    const mine = jest.fn().mockResolvedValue('mine');
    const theirs = jest.fn().mockResolvedValue('theirs');

    await requestDeduplicator.deduplicate(KEY, mine);
    await requestDeduplicator.deduplicate('plugin-status-other', theirs);

    requestDeduplicator.clear(KEY);

    expect(requestDeduplicator.getStats().keys).toEqual(['plugin-status-other']);
  });
});

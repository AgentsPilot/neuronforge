/**
 * The connections are asked before a run is spent on them — and an uncertain
 * answer lets the run proceed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RUN THIS EXISTS TO SAVE
 *
 * Live account, 2026-11-03. `draft_client_replies` ran at 09:10, 09:15, 09:20,
 * 09:25 and 09:30 and failed every time on its first step:
 *
 *   Non-retryable execution error at step "Scan the mailbox for new replies"
 *   (Your Gmail connection has expired. Please reconnect in Settings)
 *
 * The connection was not dead. Each failure triggered a token refresh that
 * SUCCEEDED — at 09:30:23, one second after the 09:30:22 failure — because the
 * refresh only ever ran when a step reached for the token and was refused. The
 * agent had a working token and nothing left to use it on, fifteen times.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TWO HALVES THIS FILE PINS
 *
 *   1. ASK FIRST. `getConnection` is called for every OAuth plugin the plan
 *      requires, before the first step. That call carries the smart refresh, so
 *      asking IS the fix for a token near expiry.
 *
 *   2. FAIL OPEN. Every uncertainty resolves to "let the run proceed". The
 *      opposite mistake is the worst outcome available here: every run skipped
 *      for ever, with a reason that reads like a decision and nothing failing
 *      anywhere to say otherwise. A wrong "go ahead" costs one run that would
 *      have failed regardless, behind an executor that still retries a 401.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const getConnection = jest.fn();
const getPluginDefinition = jest.fn();
const refreshToken = jest.fn();

/** The provider's answer to the pre-flight's verification call. */
const fetchMock = jest.fn();
(global as unknown as { fetch: unknown }).fetch = fetchMock;

jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: jest.fn(async () => ({ getPluginDefinition })),
  },
}));

jest.mock('@/lib/server/user-plugin-connections', () => ({
  UserPluginConnections: {
    getInstance: jest.fn(() => ({ getConnection, refreshToken })),
  },
}));

import { connectionsReady } from '@/lib/execution/connectionsReady';

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** A plugin definition shaped the way `getPluginDefinition` returns one. */
const oauth = {
  plugin: {
    auth_config: {
      auth_type: 'oauth2_google',
      profile_url: 'https://example.invalid/userinfo',
    },
  },
};
const internal = { plugin: { auth_config: { auth_type: 'platform_key' } } };

/** A connection row, as far as this module cares: not null. */
const live = { access_token: 'good' };

beforeEach(() => {
  jest.clearAllMocks();
  getPluginDefinition.mockReturnValue(oauth);
  getConnection.mockResolvedValue(live);
  refreshToken.mockResolvedValue({ access_token: 'fresh' });
  /* The provider accepts the token unless a test says otherwise. */
  fetchMock.mockResolvedValue({ status: 200 });
});

describe('asking before the run', () => {
  it('asks for every OAuth plugin the plan requires', async () => {
    /*
     * The ask IS the refresh: `getConnection` renews a token within five
     * minutes of expiry. Before this, nothing called it until a step did, and
     * by then the step had already failed.
     */
    const blocked = await connectionsReady(USER, ['google-mail', 'google-sheets']);

    expect(blocked).toEqual([]);
    expect(getConnection).toHaveBeenCalledTimes(2);
    expect(getConnection).toHaveBeenCalledWith(USER, 'google-mail', expect.anything());
    expect(getConnection).toHaveBeenCalledWith(USER, 'google-sheets', expect.anything());
  });

  it('asks once for a plugin named twice', async () => {
    await connectionsReady(USER, ['google-mail', 'google-mail']);

    expect(getConnection).toHaveBeenCalledTimes(1);
  });

  it('reports the plugin when no usable connection comes back', async () => {
    getConnection.mockResolvedValue(null);

    const blocked = await connectionsReady(USER, ['google-mail']);

    expect(blocked).toEqual([{ plugin: 'google-mail', reason: 'no_usable_connection' }]);
  });

  it('reports only the plugin that is actually unusable', async () => {
    getConnection.mockImplementation(async (_u: string, plugin: string) =>
      plugin === 'google-mail' ? null : live
    );

    const blocked = await connectionsReady(USER, ['google-mail', 'google-sheets']);

    expect(blocked.map(b => b.plugin)).toEqual(['google-mail']);
  });

  it('does nothing at all for an agent with no required plugins', async () => {
    const blocked = await connectionsReady(USER, []);

    expect(blocked).toEqual([]);
    expect(getConnection).not.toHaveBeenCalled();
  });
});

describe('what is never blocked on', () => {
  it('a platform_key plugin, which holds no grant and cannot expire', async () => {
    /*
     * `business-os` is in almost every committed plan's `plugins_required`.
     * Blocking on it would stop every agent on the platform, and there would be
     * nothing an owner could do about it: there is no connection to make.
     */
    getPluginDefinition.mockReturnValue(internal);

    const blocked = await connectionsReady(USER, ['business-os']);

    expect(blocked).toEqual([]);
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('a plugin with no definition, or a definition carrying no auth', async () => {
    getPluginDefinition.mockReturnValue(undefined);

    expect(await connectionsReady(USER, ['something-unknown'])).toEqual([]);

    getPluginDefinition.mockReturnValue({ plugin: {} });

    expect(await connectionsReady(USER, ['no-auth-block'])).toEqual([]);
  });
});

describe('it fails open', () => {
  it('lets the run proceed when one connection check throws', async () => {
    getConnection.mockRejectedValue(new Error('supabase said no'));

    const blocked = await connectionsReady(USER, ['google-mail']);

    /*
     * THE RULE THIS FILE IS MOST FOR. A check that cannot answer must not
     * answer "no" — the run proceeds and fails honestly if the connection
     * really is dead, which is strictly better than a skip nobody can see.
     */
    expect(blocked).toEqual([]);
  });

  it('lets the run proceed when the plugin layer will not load', async () => {
    const { PluginManagerV2 } = jest.requireMock('@/lib/server/plugin-manager-v2');
    PluginManagerV2.getInstance.mockRejectedValueOnce(new Error('cold start failed'));

    const blocked = await connectionsReady(USER, ['google-mail']);

    expect(blocked).toEqual([]);
  });

  it('still blocks the plugin it could read, when another one threw', async () => {
    /* Fail-open applies per plugin, not to the whole check: one unanswerable
       plugin must not suppress a definite answer about a different one. */
    getConnection.mockImplementation(async (_u: string, plugin: string) => {
      if (plugin === 'google-sheets') throw new Error('unreachable');
      return null;
    });

    const blocked = await connectionsReady(USER, ['google-mail', 'google-sheets']);

    expect(blocked.map(b => b.plugin)).toEqual(['google-mail']);
  });
});

/**
 * Verifying, rather than trusting `expires_at`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE EXPIRY IS NOT ENOUGH, MEASURED
 *
 * Live account, 2026-11-04 15:30. The stored Gmail token answered
 *
 *   401  "Request had invalid authentication credentials"
 *
 * while its `expires_at` sat comfortably in the future, and one refresh call
 * produced a token that read the mailbox on the very next request. The grant
 * was healthy the whole time.
 *
 * `getConnection` refreshes only within five minutes of the stored expiry, so
 * it handed that dead token straight to the first step — and the owner was told
 * for two days to reconnect something that was one API call from working.
 */
describe('verifying the token with the provider', () => {
  it('asks the profile endpoint the plugin already declares', async () => {
    await connectionsReady(USER, ['google-mail']);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://example.invalid/userinfo',
      expect.objectContaining({ headers: { Authorization: 'Bearer good' } })
    );
  });

  it('refreshes when the provider rejects a token the clock still calls valid', async () => {
    fetchMock.mockResolvedValue({ status: 401 });

    const blocked = await connectionsReady(USER, ['google-mail']);

    expect(refreshToken).toHaveBeenCalledTimes(1);
    /* Refreshed, so the run proceeds — which is the whole point of asking
       before the step rather than after it. */
    expect(blocked).toEqual([]);
  });

  it('blocks only when the token is rejected AND cannot be refreshed', async () => {
    /* Proven dead and unrefreshable is the one case where the owner genuinely
       must reconnect, and the only one worth skipping a run over. */
    fetchMock.mockResolvedValue({ status: 401 });
    refreshToken.mockResolvedValue(null);

    const blocked = await connectionsReady(USER, ['google-mail']);

    expect(blocked).toEqual([{ plugin: 'google-mail', reason: 'no_usable_connection' }]);
  });

  it('does NOT treat a 403 as a dead token', async () => {
    /*
     * A 403 is a scope or quota problem. The credential is fine and refreshing
     * it changes nothing, so calling it dead would skip every run for ever over
     * a permission only the owner can grant.
     */
    fetchMock.mockResolvedValue({ status: 403 });

    const blocked = await connectionsReady(USER, ['google-mail']);

    expect(refreshToken).not.toHaveBeenCalled();
    expect(blocked).toEqual([]);
  });

  it('does not refresh a token the provider accepts', async () => {
    await connectionsReady(USER, ['google-mail']);

    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('lets the run proceed when the provider cannot be reached', async () => {
    /* A timeout or a 5xx says nothing about the credential. Same fail-open rule
       as everything else here. */
    fetchMock.mockRejectedValue(new Error('network down'));

    const blocked = await connectionsReady(USER, ['google-mail']);

    expect(blocked).toEqual([]);
    expect(refreshToken).not.toHaveBeenCalled();
  });

  it('skips the probe for a plugin that declares no profile endpoint', async () => {
    getPluginDefinition.mockReturnValue({
      plugin: { auth_config: { auth_type: 'oauth2', profile_url: undefined } },
    });

    const blocked = await connectionsReady(USER, ['some-oauth-plugin']);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(blocked).toEqual([]);
  });
});

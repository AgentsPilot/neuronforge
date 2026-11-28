/**
 * GET /oauth/callback/[plugin]
 *
 * Three sets of locks, one set of seams:
 *
 * 1. IDENTITY COMES FROM THE SESSION. The account a vendor grant is stored
 *    under is decided by `getUser()`, and the plugin by the route segment. The
 *    `state` the vendor hands back is a blob the client authored, so its
 *    `user_id` / `plugin_key` are compared and must agree — never used as the
 *    source. A disagreement, or no session at all, is refused BEFORE the token
 *    exchange, so no grant is minted for a request we discard. The four core
 *    cases are the shape of that rule, not a description of any one defect:
 *    (i) no session writes nothing and calls nothing outbound, (ii) a state
 *    naming a different account is refused, (iii) an agreeing state writes
 *    under the session id, (iv) a state naming a different plugin is refused.
 *    These run the REAL `UserPluginConnections` against mocked seams.
 *
 * 2. WHAT REACHES THE LOGGER. The callback carries a one-time authorization
 *    code and the state value. Neither may be handed to the logger, on any
 *    branch: log key names, never parameter values. The leak check runs on
 *    every argument of every logger call, so it holds whatever the logger's
 *    redaction list happens to contain.
 *
 * 3. WHAT REACHES THE POPUP PAGE. Generic errors, development-only details,
 *    and escaping that survives every line terminator.
 *
 * Sets 2 and 3 stub the service's two methods with prototype spies (restored
 * after each case), so they test the route alone.
 *
 * Every seam is mocked: no plugin manager, no Supabase, no network.
 *
 * Workplan: docs/workplans/plugin-oauth-callback-session-identity-workplan.md
 */

const getUser = jest.fn();
const getPluginDefinition = jest.fn();
const exchangeCodeForTokens = jest.fn();
const fetchUserProfile = jest.fn();
const upsert = jest.fn();
const existsByUserAndPlugin = jest.fn();
const auditLog = jest.fn();
const auditFlush = jest.fn();

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: (...a: unknown[]) => mockLog.info(...a),
      warn: (...a: unknown[]) => mockLog.warn(...a),
      error: (...a: unknown[]) => mockLog.error(...a),
      debug: (...a: unknown[]) => mockLog.debug(...a),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

jest.mock('@/lib/auth', () => ({
  getUser: (...args: unknown[]) => getUser(...args),
}));

jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: async () => ({
      getPluginDefinition: (key: string) => getPluginDefinition(key),
    }),
  },
}));

jest.mock('@/lib/services/OAuthTokenService', () => ({
  exchangeCodeForTokens: (...args: unknown[]) => exchangeCodeForTokens(...args),
  fetchUserProfile: (...args: unknown[]) => fetchUserProfile(...args),
  calculateExpiresAt: () => null,
  refreshAccessToken: jest.fn(),
  refreshAccessTokenDetailed: jest.fn(),
}));

jest.mock('@/lib/repositories', () => ({
  pluginConnectionRepository: {
    upsert: (...args: unknown[]) => upsert(...args),
    existsByUserAndPlugin: (...args: unknown[]) => existsByUserAndPlugin(...args),
  },
}));

/*
 * The audit sink is a FAITHFUL FAKE, not two spies.
 *
 * `AuditTrail.log()` resolves only after an await of its own and then QUEUES;
 * `flush()` returns immediately when the queue is empty. A pair of resolved
 * spies hides the one failure that matters — a flush issued before the entry
 * reaches the queue writes nothing and still reports success — so the fake
 * reproduces both halves and the assertions below are made on what reached
 * `written`, never on `flush` having been called.
 */
// `any`: these hold `AuditLogInput`s, and typing them would pull the audit
// types into a fake whose only job is to record what arrived.
const queued: any[] = [];
const written: any[] = [];

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: {
    log: (...args: unknown[]) => auditLog(...args),
    flush: (...args: unknown[]) => auditFlush(...args),
  },
  AuditTrailService: {
    getInstance: () => ({
      log: (...args: unknown[]) => auditLog(...args),
      flush: (...args: unknown[]) => auditFlush(...args),
    }),
  },
}));

import { NextRequest } from 'next/server';
import { __resetAuditFlushChainForTests } from '@/lib/audit/boundedAuditFlush';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';
import { GET } from '../route';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';

const AUTH_CONFIG = {
  auth_type: 'oauth2',
  client_id: 'client-id',
  client_secret: 'client-secret',
  token_url: 'https://vendor.test/token',
  redirect_uri: 'https://app.test/oauth/callback/gmail',
};

/**
 * What the page's script hands the opener, by running it against a stub
 * window. Reads the message rather than matching its serialised text, so the
 * assertions hold whichever way the payload is written into the script.
 */
function postedMessage(html: string): { success?: boolean; error?: string } | undefined {
  const start = html.indexOf('<script>') + '<script>'.length;
  const script = html.slice(start, html.lastIndexOf('</script>'));
  const posted: Array<{ success?: boolean; error?: string }> = [];
  const stubWindow = {
    opener: { postMessage: (msg: { success?: boolean; error?: string }) => posted.push(msg) },
    close: () => undefined,
  };
  new Function('window', 'setTimeout', 'document', script)(stubWindow, () => undefined, {});
  return posted[0];
}

beforeEach(() => {
  jest.clearAllMocks();
  /*
   * `logAndFlush` is NOT mocked here, and its serialising chain is module
   * state that Jest keeps for the whole file. Every case below settles its
   * own link, so this changes no result today (QA checked: identical 10/10
   * with and without). It is here so that a later case which deliberately
   * hangs or fails a flush cannot leave every following case queued behind
   * its link.
   */
  __resetAuditFlushChainForTests();

  getUser.mockResolvedValue({ id: SESSION_ID });
  queued.length = 0;
  written.length = 0;
  // One await before queueing, exactly like `buildLogEntry` in the service.
  auditLog.mockImplementation(async (entry: unknown) => {
    await Promise.resolve();
    queued.push(entry);
  });
  // The service's own early return: an empty queue writes nothing.
  auditFlush.mockImplementation(async () => {
    if (queued.length === 0) return;
    written.push(...queued.splice(0, queued.length));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Identity comes from the session
// ─────────────────────────────────────────────────────────────────────────────

/** A `?code=…&state=…` callback for `plugin`, carrying a cookie by default. */
function callback(
  plugin: string,
  state: Record<string, unknown>,
  opts: { cookie?: boolean } = {}
): { request: NextRequest; params: Promise<{ plugin: string }> } {
  const encoded = encodeURIComponent(JSON.stringify(state));
  const url = `https://app.test/oauth/callback/${plugin}?code=auth-code&state=${encodeURIComponent(encoded)}`;
  const headers: Record<string, string> = { 'x-correlation-id': 'test-correlation' };
  if (opts.cookie !== false) headers.cookie = 'sb-project-auth-token=cookie-value';

  return {
    request: new NextRequest(url, { headers }),
    params: Promise.resolve({ plugin }),
  };
}

describe('plugin OAuth callback: identity comes from the session', () => {
  beforeEach(() => {
    getPluginDefinition.mockReturnValue({ plugin: { auth_config: AUTH_CONFIG } });
    exchangeCodeForTokens.mockResolvedValue({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
      scope: 'gmail.readonly',
    });
    fetchUserProfile.mockResolvedValue({ name: 'Owner', email: 'owner@example.com' });
    existsByUserAndPlugin.mockResolvedValue({ data: false, error: null });
    // `any`: the upsert input is asserted on directly below, so typing it here
    // would only restate `UpsertPluginConnectionInput` in a mock.
    upsert.mockImplementation(async (input: any) => ({
      data: {
        id: 'connection-id',
        user_id: input.user_id,
        plugin_key: input.plugin_key,
        plugin_name: input.plugin_name,
        username: input.username,
        connected_at: '2026-11-07T00:00:00.000Z',
      },
      error: null,
    }));
  });

  /** The one row of `action`, or `undefined` if it never reached the sink. */
  const writtenRow = (action: string) => written.find((entry) => entry.action === action);

  it('(i) refuses with no session, and performs no token exchange and no write', async () => {
    getUser.mockResolvedValue(null);

    const { request, params } = callback('gmail', { user_id: SESSION_ID, plugin_key: 'gmail' });
    const response = await GET(request, { params });

    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(existsByUserAndPlugin).not.toHaveBeenCalled();

    const html = await response.text();
    expect(postedMessage(html)?.success).toBe(false);

    // The row REACHED THE SINK before the response — not merely "flush was
    // called". This fails if the queue-then-flush ordering ever regresses.
    const entry = writtenRow('PLUGIN_AUTH_REFUSED');
    expect(entry).toBeDefined();
    expect(queued).toHaveLength(0);
    // Recorded against nobody, with the cookie-presence signal and no state.
    expect(entry.userId).toBeNull();
    expect(entry.details.reason).toBe('no_session');
    expect(entry.details.auth_cookie_present).toBe(true);
    expect(JSON.stringify(entry.details)).not.toContain('auth-code');
    // No `request`: a refusal row must never be a place credentials collect.
    expect(entry.request).toBeUndefined();
    // Classification belongs to EVENT_METADATA, not to the call site.
    expect(entry.severity).toBeUndefined();
    expect(entry.complianceFlags).toBeUndefined();
  });

  it('(i-c) records the refusal with the request metadata in details, not the request', async () => {
    getUser.mockResolvedValue(null);

    const url = `https://app.test/oauth/callback/gmail?code=auth-code&state=${encodeURIComponent(
      encodeURIComponent(JSON.stringify({ user_id: SESSION_ID, plugin_key: 'gmail' }))
    )}`;
    const request = new NextRequest(url, {
      headers: {
        cookie: 'sb-project-auth-token=cookie-value',
        'x-forwarded-for': '203.0.113.9, 70.41.3.18',
        'user-agent': 'TestAgent/1.0',
      },
    });

    await GET(request, { params: Promise.resolve({ plugin: 'gmail' }) });

    const entry = writtenRow('PLUGIN_AUTH_REFUSED');
    expect(entry.details.ip_address).toBe('203.0.113.9');
    expect(entry.details.user_agent).toBe('TestAgent/1.0');
    expect(entry.request).toBeUndefined();
  });

  it('(i-b) reports when no auth cookie reached the route at all', async () => {
    getUser.mockResolvedValue(null);

    const { request, params } = callback(
      'gmail',
      { user_id: SESSION_ID, plugin_key: 'gmail' },
      { cookie: false }
    );
    await GET(request, { params });

    expect(writtenRow('PLUGIN_AUTH_REFUSED').details.auth_cookie_present).toBe(false);
  });

  it('(ii) refuses when the callback names a different account, and writes nothing', async () => {
    const { request, params } = callback('gmail', { user_id: OTHER_ID, plugin_key: 'gmail' });
    const response = await GET(request, { params });

    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();

    const html = await response.text();
    expect(postedMessage(html)?.success).toBe(false);

    const entry = writtenRow('PLUGIN_AUTH_REFUSED');
    expect(entry).toBeDefined();
    expect(entry.details.reason).toBe('user_mismatch');
    // Attributed to the session, never to the account the callback named.
    expect(entry.userId).toBe(SESSION_ID);
    expect(JSON.stringify(entry)).not.toContain(OTHER_ID);
  });

  it('(iii) stores the connection under the session id when the callback agrees', async () => {
    const { request, params } = callback('gmail', { user_id: SESSION_ID, plugin_key: 'gmail' });
    const response = await GET(request, { params });

    expect(exchangeCodeForTokens).toHaveBeenCalled();
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: SESSION_ID, plugin_key: 'gmail' })
    );

    const html = await response.text();
    expect(postedMessage(html)?.success).toBe(true);
    // The connection row reached the sink too, and its identity is the session.
    const entry = writtenRow('PLUGIN_CONNECTED');
    expect(entry).toBeDefined();
    expect(entry.userId).toBe(SESSION_ID);
    expect(queued).toHaveLength(0);
  });

  it('(iii-b) refuses a callback that does not name the account at all', async () => {
    const { request, params } = callback('gmail', { plugin_key: 'gmail' });
    const response = await GET(request, { params });

    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();

    const html = await response.text();
    expect(postedMessage(html)?.success).toBe(false);
    expect(writtenRow('PLUGIN_AUTH_REFUSED').details.reason).toBe('state_unreadable');
  });

  it('(iv) refuses when the callback names a plugin other than the route segment', async () => {
    const { request, params } = callback('gmail', {
      user_id: SESSION_ID,
      plugin_key: 'google-calendar',
    });
    const response = await GET(request, { params });

    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();

    const html = await response.text();
    expect(postedMessage(html)?.success).toBe(false);

    const entry = writtenRow('PLUGIN_AUTH_REFUSED');
    expect(entry).toBeDefined();
    expect(entry.details.reason).toBe('plugin_mismatch');
    expect(entry.details.plugin_key).toBe('gmail');
  });

  /*
   * The third audited outcome (SA nit (a)). The other two — refused and
   * connected — are locked above; this one is the exchange failing after the
   * identity checks have passed.
   *
   * It locks three things at once: the row REACHES the sink (it is written
   * through the same bounded writer, not left in a queue the response outruns),
   * there is exactly ONE of it (the writer cannot be re-entered by the rethrow),
   * and it is attributed to the session — this row used to take its `userId`
   * from the callback's own claim, which would let a caller file audit rows
   * against an account that is not theirs.
   */
  it('(v) records one failure row, attributed to the session, when the exchange fails', async () => {
    exchangeCodeForTokens.mockRejectedValue(new Error('token endpoint rejected the exchange'));

    const { request, params } = callback('gmail', { user_id: SESSION_ID, plugin_key: 'gmail' });
    const response = await GET(request, { params });

    // The identity checks passed, so the exchange was reached — and nothing
    // was stored once it failed.
    expect(exchangeCodeForTokens).toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();

    const html = await response.text();
    expect(postedMessage(html)?.success).toBe(false);

    // Exactly one, in `written` — not merely "flush was called".
    const failures = written.filter((entry) => entry.action === 'PLUGIN_AUTH_FAILED');
    expect(failures).toHaveLength(1);
    expect(queued).toHaveLength(0);
    expect(failures[0].userId).toBe(SESSION_ID);
    expect(failures[0].details.plugin_key).toBe('gmail');
    // No success row slipped out alongside it.
    expect(writtenRow('PLUGIN_CONNECTED')).toBeUndefined();
    expect(writtenRow('PLUGIN_RECONNECTED')).toBeUndefined();
  });

  /*
   * The shape the two real producers actually send (QA).
   *
   * Both add fields no consumer reads — `timestamp`, and `random` from the
   * client producer — so the schema's unknown-key handling decides whether a
   * real connect completes or is refused. Every other case above sends only
   * the two compared fields, which means none of them would notice the schema
   * being tightened to reject unknown keys; that change would refuse EVERY
   * real connect while leaving the suite green. This case is the lock.
   */
  it('(vi) accepts the extra fields the real producers send, and stores none of them', async () => {
    const { request, params } = callback('gmail', {
      user_id: SESSION_ID,
      plugin_key: 'gmail',
      timestamp: 1762502400000,
      random: 'abc123',
    });
    const response = await GET(request, { params });

    const html = await response.text();
    expect(postedMessage(html)?.success).toBe(true);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: SESSION_ID, plugin_key: 'gmail' })
    );
    // Dropped, not carried into the stored row.
    const stored = upsert.mock.calls[0][0];
    expect(stored).not.toHaveProperty('timestamp');
    expect(stored).not.toHaveProperty('random');
    expect(writtenRow('PLUGIN_CONNECTED').userId).toBe(SESSION_ID);
  });

  it('shows the refusal on the page, not only through the opener message', async () => {
    getUser.mockResolvedValue(null);

    const { request, params } = callback('gmail', { user_id: SESSION_ID, plugin_key: 'gmail' });
    const html = await (await GET(request, { params })).text();

    // The body text survives a postMessage that throws on an empty origin.
    expect(html).toMatch(/<body><p>We could not confirm which account/);
  });

  it('refuses an unreadable state before any token exchange', async () => {
    const url = 'https://app.test/oauth/callback/gmail?code=auth-code&state=not-json';
    const request = new NextRequest(url, { headers: { cookie: 'sb-project-auth-token=v' } });

    await GET(request, { params: Promise.resolve({ plugin: 'gmail' }) });

    expect(exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
    expect(writtenRow('PLUGIN_AUTH_REFUSED').details.reason).toBe('state_unreadable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 and 3. The route alone: the service's two methods are stubbed
// ─────────────────────────────────────────────────────────────────────────────

const PLANTED_CODE = 'planted-auth-code-7f3a9c';
// Carried inside the state, which must now be a readable state for the session
// to get past the identity checks; any part of the state reaching a log line
// carries this marker with it.
const PLANTED_STATE_MARKER = 'planted-state-value-b81d42';
const PLANTED_STATE = encodeURIComponent(
  JSON.stringify({ user_id: SESSION_ID, plugin_key: 'example', code_verifier: PLANTED_STATE_MARKER })
);
const PLANTED_PROFILE_VALUE = 'planted-profile-value-e05c17';

describe('GET /oauth/callback/[plugin] — the route alone', () => {
  let mockHandleOAuthCallback: jest.SpyInstance;
  let mockUpdateProfileData: jest.SpyInstance;

  beforeEach(() => {
    getPluginDefinition.mockReturnValue({
      plugin: { auth_config: { oauth_callback_profile_params: ['shop'] } },
    });
    mockHandleOAuthCallback = jest
      .spyOn(UserPluginConnections.prototype, 'handleOAuthCallback')
      .mockResolvedValue({
        user_id: SESSION_ID,
        plugin_key: 'example',
        plugin_name: 'Example',
        username: '',
        connected_at: '2026-11-07T00:00:00.000Z',
      } as never);
    mockUpdateProfileData = jest
      .spyOn(UserPluginConnections.prototype, 'updateConnectionProfileData')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    // Back to the real methods, so the session-identity cases above run the
    // real service whatever order Jest runs the file in.
    mockHandleOAuthCallback.mockRestore();
    mockUpdateProfileData.mockRestore();
  });

  function routeCallback(query: Record<string, string>) {
    const qs = new URLSearchParams(query).toString();
    return GET(new NextRequest(`http://localhost/oauth/callback/example?${qs}`), {
      params: Promise.resolve({ plugin: 'example' }),
    });
  }

  /** Every argument of every logger call, serialised. */
  function everythingLogged(): string {
    return JSON.stringify(
      [mockLog.info, mockLog.warn, mockLog.error, mockLog.debug].map((fn) => fn.mock.calls)
    );
  }

  describe('callback parameter values never reach the logger', () => {
    it('logs the received key names, not the code or state, when the expected profile params are missing', async () => {
      await routeCallback({ code: PLANTED_CODE, state: PLANTED_STATE });

      const logged = everythingLogged();
      expect(logged).not.toContain(PLANTED_CODE);
      expect(logged).not.toContain(PLANTED_STATE_MARKER);
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.objectContaining({ expectedParams: ['shop'], receivedKeys: ['code', 'state'] }),
        'OAuth callback missing expected profile params'
      );
    });

    it('logs the stored profile param names, not their values', async () => {
      await routeCallback({ code: PLANTED_CODE, state: PLANTED_STATE, shop: PLANTED_PROFILE_VALUE });

      expect(mockUpdateProfileData).toHaveBeenCalledWith(SESSION_ID, 'example', { shop: PLANTED_PROFILE_VALUE });
      const logged = everythingLogged();
      expect(logged).not.toContain(PLANTED_CODE);
      expect(logged).not.toContain(PLANTED_STATE_MARKER);
      expect(logged).not.toContain(PLANTED_PROFILE_VALUE);
      expect(mockLog.info).toHaveBeenCalledWith({ storedParams: ['shop'] }, 'Stored plugin profile data');
    });

    it('does not log the code or state on the provider-error branch', async () => {
      await routeCallback({ code: PLANTED_CODE, state: PLANTED_STATE, error: 'access_denied' });

      const logged = everythingLogged();
      expect(logged).not.toContain(PLANTED_CODE);
      expect(logged).not.toContain(PLANTED_STATE_MARKER);
    });

    it('does not log the code or state when the token exchange throws', async () => {
      mockHandleOAuthCallback.mockRejectedValue(new Error('exchange failed'));

      await routeCallback({ code: PLANTED_CODE, state: PLANTED_STATE });

      // Must reach the service: a refusal would pass the absence checks below vacuously.
      expect(mockHandleOAuthCallback).toHaveBeenCalled();
      const logged = everythingLogged();
      expect(logged).not.toContain(PLANTED_CODE);
      expect(logged).not.toContain(PLANTED_STATE_MARKER);
    });

    it('does not log the code or state when the callback is refused', async () => {
      getUser.mockResolvedValue(null);

      await routeCallback({ code: PLANTED_CODE, state: PLANTED_STATE });

      expect(mockHandleOAuthCallback).not.toHaveBeenCalled();
      const logged = everythingLogged();
      expect(logged).not.toContain(PLANTED_CODE);
      expect(logged).not.toContain(PLANTED_STATE_MARKER);
    });
  });

  describe('what reaches the popup page', () => {
    const INTERNAL_DETAIL = 'Failed to save connection: planted-db-detail-9e27';
    const env = process.env as Record<string, string | undefined>;
    const originalNodeEnv = env.NODE_ENV;

    afterEach(() => {
      env.NODE_ENV = originalNodeEnv;
    });

    it('returns a generic error, not the thrown message, when the callback fails', async () => {
      mockHandleOAuthCallback.mockRejectedValue(new Error(INTERNAL_DETAIL));

      const html = await (await routeCallback({ code: PLANTED_CODE, state: PLANTED_STATE })).text();

      expect(html).not.toContain('planted-db-detail-9e27');
      expect(html).toContain("error: 'OAuth callback failed'");
      expect(html).not.toContain('details:');
    });

    it('adds the thrown message as details in development only', async () => {
      env.NODE_ENV = 'development';
      mockHandleOAuthCallback.mockRejectedValue(new Error(INTERNAL_DETAIL));

      const html = await (await routeCallback({ code: PLANTED_CODE, state: PLANTED_STATE })).text();

      expect(html).toContain("error: 'OAuth callback failed'");
      expect(html).toContain("details: 'Failed to save connection: planted-db-detail-9e27'");
    });

    it.each([
      ['a carriage return', '\r'],
      ['a line separator', '\u2028'],
      ['a paragraph separator', '\u2029'],
    ])('escapes %s in a provider error_description', async (_label, ch) => {
      const html = await (
        await routeCallback({ error: 'access_denied', error_description: `before${ch}after` })
      ).text();

      const script = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
      expect(script).not.toContain(ch);
      expect(script).toContain('before');
      expect(script).toContain('after');
    });

    it('runs, and hands the opener the provider text unchanged', async () => {
      const LS = String.fromCharCode(0x2028);
      const PS = String.fromCharCode(0x2029);
      const description = `a\rb${LS}c${PS}d\ne'f"g\\h</script>i`;
      const html = await (
        await routeCallback({ error: 'access_denied', error_description: description })
      ).text();

      const start = html.indexOf('<script>') + '<script>'.length;
      const script = html.slice(start, html.lastIndexOf('</script>'));
      const posted: Array<{ error?: string }> = [];
      const stubWindow = {
        opener: { postMessage: (msg: { error?: string }) => posted.push(msg) },
        close: () => undefined,
      };
      new Function('window', 'setTimeout', 'document', script)(stubWindow, () => undefined, {});

      expect(posted).toHaveLength(1);
      expect(posted[0].error).toBe(`access_denied: ${description}`);
    });
  });
});

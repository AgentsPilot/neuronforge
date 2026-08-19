/**
 * Identity-hardening regression locks for the plugin routes.
 *
 * Each of these handlers previously took a caller-supplied `userId` with NO
 * authentication. The critical lock in every case is the same shape:
 *   an unauthenticated request carrying a victim's userId must be refused
 *   AND the underlying side-effect must never run.
 *
 * Workplan: docs/workplans/BUSINESS_OS_PLUGIN_ROUTE_IDENTITY_HARDENING_WORKPLAN.md
 */

const resolveActingUserIdentity = jest.fn();
const execute = jest.fn();
const disconnectPlugin = jest.fn();
const getConnectionStatus = jest.fn();
const updateAdditionalConfig = jest.fn();
const getAdditionalConfig = jest.fn();
const getPluginDefinition = jest.fn();
const getActionDefinition = jest.fn();

jest.mock('@/lib/server/route-identity', () => ({
  resolveActingUserIdentity: (...args: unknown[]) => resolveActingUserIdentity(...args),
}));

const getConnectedPlugins = jest.fn();
const getActiveExpiredPluginKeys = jest.fn();
const getDisconnectedPlugins = jest.fn();
// The refresh-token route reaches the EXTERNAL OAuth exchange through
// pluginManager['userConnections'], not through a PluginManagerV2 method — assert on
// these or the "no token refresh attempted" lock is vacuously true.
const getAllActivePlugins = jest.fn();
const refreshToken = jest.fn();

jest.mock('@/lib/server/plugin-manager-v2', () => ({
  PluginManagerV2: {
    getInstance: async () => ({
      getPluginDefinition: (p: string) => getPluginDefinition(p),
      getActionDefinition: (p: string, a: string) => getActionDefinition(p, a),
      getConnectedPlugins: (...args: unknown[]) => getConnectedPlugins(...args),
      getActiveExpiredPluginKeys: (...args: unknown[]) => getActiveExpiredPluginKeys(...args),
      getDisconnectedPlugins: (...args: unknown[]) => getDisconnectedPlugins(...args),
      userConnections: {
        getAllActivePlugins: (...args: unknown[]) => getAllActivePlugins(...args),
        refreshToken: (...args: unknown[]) => refreshToken(...args),
        isTokenValid: () => false,
        shouldRefreshToken: () => true,
      },
    }),
  },
}));

jest.mock('@/lib/server/plugin-executer-v2', () => ({
  PluginExecuterV2: {
    getInstance: async () => ({
      execute: (...args: unknown[]) => execute(...args),
    }),
  },
}));

jest.mock('@/lib/server/user-plugin-connections', () => ({
  UserPluginConnections: {
    getInstance: () => ({
      disconnectPlugin: (...args: unknown[]) => disconnectPlugin(...args),
      getConnectionStatus: (...args: unknown[]) => getConnectionStatus(...args),
      updateAdditionalConfig: (...args: unknown[]) => updateAdditionalConfig(...args),
      getAdditionalConfig: (...args: unknown[]) => getAdditionalConfig(...args),
    }),
  },
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: jest.fn().mockResolvedValue(undefined) }) },
}));

import { NextRequest } from 'next/server';
import { POST as executePost } from '../execute/route';
import { POST as refreshTokenPost } from '../refresh-token/route';
import { POST as disconnectPost, GET as disconnectGet } from '../disconnect/route';
import { GET as userStatusGet } from '../user-status/route';
import {
  POST as configPost,
  PUT as configPut,
  GET as configGet,
} from '../additional-config/route';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const VICTIM_ID = '22222222-2222-4222-8222-222222222222';

const UNAUTHENTICATED = { ok: false, status: 401, error: 'Authentication required' };
const FORBIDDEN = { ok: false, status: 403, error: 'Not permitted to act on behalf of another user' };
const SELF = {
  ok: true,
  userId: SESSION_ID,
  sessionUserId: SESSION_ID,
  sessionUserEmail: 'op@example.com',
  actingAs: false,
};

function postRequest(path: string, body: Record<string, unknown>) {
  return new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: 'GET' });
}

describe('plugin route identity hardening', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveActingUserIdentity.mockResolvedValue(SELF);
    getPluginDefinition.mockReturnValue({ actions: {}, plugin: { additional_config: { enabled: true, fields: [] } } });
    getActionDefinition.mockReturnValue({ description: 'x' });
    execute.mockResolvedValue({ success: true, data: {} });
    disconnectPlugin.mockResolvedValue(true);
    getConnectionStatus.mockResolvedValue({ connected: true, reason: 'ok', expires_at: null });
    updateAdditionalConfig.mockResolvedValue(true);
    getAdditionalConfig.mockResolvedValue({});
    getConnectedPlugins.mockResolvedValue({});
    getActiveExpiredPluginKeys.mockResolvedValue([]);
    getDisconnectedPlugins.mockResolvedValue({});
    getAllActivePlugins.mockResolvedValue([]);
    refreshToken.mockResolvedValue({});
  });

  // T1 (SA C12) — the one hardened route whose side effect is an EXTERNAL OAuth token
  // exchange, so "never runs when unauthenticated" matters most here.
  describe('POST /api/plugins/refresh-token', () => {
    it('refuses unauthenticated and attempts no token refresh', async () => {
      resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

      const req = new NextRequest(`http://localhost/api/plugins/refresh-token?userId=${VICTIM_ID}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginKeys: ['google-mail'] }),
      });
      const res = await refreshTokenPost(req);

      expect(res.status).toBe(401);
      // The real side effect: no connection was even read, and no external OAuth token
      // exchange was attempted.
      expect(getAllActivePlugins).not.toHaveBeenCalled();
      expect(refreshToken).not.toHaveBeenCalled();
      expect(getConnectedPlugins).not.toHaveBeenCalled();
    });

    it('refuses a non-admin act-as with 403', async () => {
      resolveActingUserIdentity.mockResolvedValue(FORBIDDEN);

      const req = new NextRequest('http://localhost/api/plugins/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: VICTIM_ID }),
      });
      const res = await refreshTokenPost(req);

      expect(res.status).toBe(403);
      expect(getAllActivePlugins).not.toHaveBeenCalled();
      expect(refreshToken).not.toHaveBeenCalled();
    });

    it('refreshes for the RESOLVED id when an admin acts as another user', async () => {
      resolveActingUserIdentity.mockResolvedValue({
        ok: true,
        userId: VICTIM_ID,
        sessionUserId: SESSION_ID,
        sessionUserEmail: 'admin@example.com',
        actingAs: true,
      });

      getAllActivePlugins.mockResolvedValue([
        { plugin_key: 'google-mail', expires_at: '2000-01-01T00:00:00Z' },
      ]);

      const req = new NextRequest('http://localhost/api/plugins/refresh-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: VICTIM_ID, pluginKeys: ['google-mail'] }),
      });
      const res = await refreshTokenPost(req);

      expect(res.status).toBe(200);
      // Connections are read for the RESOLVED id, never the raw body value path.
      expect(getAllActivePlugins).toHaveBeenCalledWith(VICTIM_ID);
      expect((await res.json()).refreshed).toEqual(['google-mail']);
    });
  });

  // L6 — a handler that silently DROPPED the caller-supplied id would pass every other
  // test (it fails safe, degrading to self), so assert the act-as request is forwarded.
  it('forwards the caller-supplied userId to the resolver as an act-as request', async () => {
    await executePost(
      postRequest('/api/plugins/execute', {
        userId: VICTIM_ID,
        pluginName: 'google-mail',
        actionName: 'list_emails',
      })
    );

    expect(resolveActingUserIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ requestedUserId: VICTIM_ID })
    );
  });

  describe('POST /api/plugins/execute', () => {
    // E1 — the core lock
    it('refuses an unauthenticated request carrying a victim userId, and never executes', async () => {
      resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

      const res = await executePost(
        postRequest('/api/plugins/execute', {
          userId: VICTIM_ID,
          pluginName: 'google-mail',
          actionName: 'send_email',
          parameters: { to: 'attacker@example.com' },
        })
      );

      expect(res.status).toBe(401);
      expect(execute).not.toHaveBeenCalled();
    });

    // E2
    it('executes as the session user when no userId is supplied', async () => {
      const res = await executePost(
        postRequest('/api/plugins/execute', { pluginName: 'google-mail', actionName: 'list_emails' })
      );

      expect(res.status).toBe(200);
      expect(execute).toHaveBeenCalledWith(SESSION_ID, 'google-mail', 'list_emails', {});
    });

    // E3
    it('refuses a non-admin act-as with 403 and never executes', async () => {
      resolveActingUserIdentity.mockResolvedValue(FORBIDDEN);

      const res = await executePost(
        postRequest('/api/plugins/execute', {
          userId: VICTIM_ID,
          pluginName: 'google-mail',
          actionName: 'send_email',
        })
      );

      expect(res.status).toBe(403);
      expect(execute).not.toHaveBeenCalled();
    });

    // E4
    it('executes as the target when an admin acts on their behalf', async () => {
      resolveActingUserIdentity.mockResolvedValue({
        ok: true,
        userId: VICTIM_ID,
        sessionUserId: SESSION_ID,
        sessionUserEmail: 'admin@example.com',
        actingAs: true,
      });

      const res = await executePost(
        postRequest('/api/plugins/execute', {
          userId: VICTIM_ID,
          pluginName: 'google-mail',
          actionName: 'list_emails',
        })
      );

      expect(res.status).toBe(200);
      expect(execute).toHaveBeenCalledWith(VICTIM_ID, 'google-mail', 'list_emails', {});
    });

    // E5 — behaviour preserved
    it('still 404s for an unknown plugin', async () => {
      getPluginDefinition.mockReturnValue(undefined);

      const res = await executePost(
        postRequest('/api/plugins/execute', { pluginName: 'nope', actionName: 'x' })
      );

      expect(res.status).toBe(404);
      expect(execute).not.toHaveBeenCalled();
    });

    // Zod
    it('rejects a body missing pluginName with 400 before resolving identity', async () => {
      const res = await executePost(postRequest('/api/plugins/execute', { actionName: 'x' }));

      expect(res.status).toBe(400);
      expect(resolveActingUserIdentity).not.toHaveBeenCalled();
      expect(execute).not.toHaveBeenCalled();
    });
  });

  describe('POST /api/plugins/disconnect', () => {
    // D1 — destructive: the most important never-runs assertion
    it('refuses unauthenticated and never disconnects', async () => {
      resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

      const res = await disconnectPost(
        postRequest('/api/plugins/disconnect', { userId: VICTIM_ID, pluginKey: 'google-mail' })
      );

      expect(res.status).toBe(401);
      expect(disconnectPlugin).not.toHaveBeenCalled();
    });

    // D2 — cache key must follow the RESOLVED id
    it('disconnects and invalidates the cache for the resolved id', async () => {
      resolveActingUserIdentity.mockResolvedValue({
        ok: true,
        userId: VICTIM_ID,
        sessionUserId: SESSION_ID,
        sessionUserEmail: 'admin@example.com',
        actingAs: true,
      });

      const res = await disconnectPost(
        postRequest('/api/plugins/disconnect', { userId: VICTIM_ID, pluginKey: 'google-mail' })
      );

      expect(res.status).toBe(200);
      expect(disconnectPlugin).toHaveBeenCalledWith(VICTIM_ID, 'google-mail', expect.anything());
      expect((await res.json()).user_id).toBe(VICTIM_ID);
    });
  });

  // D3t
  it('GET /api/plugins/disconnect refuses unauthenticated', async () => {
    resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

    const res = await disconnectGet(
      getRequest(`/api/plugins/disconnect?userId=${VICTIM_ID}&pluginKey=google-mail`)
    );

    expect(res.status).toBe(401);
    expect(getConnectionStatus).not.toHaveBeenCalled();
  });

  describe('GET /api/plugins/user-status', () => {
    // U1 — the fallback is gone
    it('refuses a bare ?userId= with no session', async () => {
      resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

      const res = await userStatusGet(getRequest(`/api/plugins/user-status?userId=${VICTIM_ID}`));

      expect(res.status).toBe(401);
    });

    // U2
    it('refuses a non-admin act-as with 403', async () => {
      resolveActingUserIdentity.mockResolvedValue(FORBIDDEN);

      const res = await userStatusGet(getRequest(`/api/plugins/user-status?userId=${VICTIM_ID}`));

      expect(res.status).toBe(403);
    });

    // U4 — never let a shared cache hold user-specific data
    it('does not send a public cache directive', async () => {
      resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);
      const res = await userStatusGet(getRequest('/api/plugins/user-status'));

      const cacheControl = res.headers.get('Cache-Control') ?? '';
      expect(cacheControl).not.toContain('public');
    });

    // U3 (SA C12) — D7 cache-isolation lock. An admin act-as populates the VICTIM's cache
    // entry; the admin's own subsequent call must not be served that entry. This exercises
    // the REAL module-level pluginStatusCache, so a key built from anything other than the
    // resolved id would surface here as a cross-user leak.
    it('does not serve an act-as cache entry to the admin’s own call', async () => {
      resolveActingUserIdentity.mockResolvedValue({
        ok: true,
        userId: VICTIM_ID,
        sessionUserId: SESSION_ID,
        sessionUserEmail: 'admin@example.com',
        actingAs: true,
      });
      getConnectedPlugins.mockResolvedValue({
        notion: {
          definition: {
            plugin: { name: 'Notion', description: '', context: '', version: '1', auth_config: { auth_type: 'oauth' } },
            actions: {},
          },
          connection: { username: 'victim@example.com', email: 'victim@example.com' },
        },
      });

      const actAs = await userStatusGet(getRequest(`/api/plugins/user-status?userId=${VICTIM_ID}`));
      const actAsBody = await actAs.json();
      expect(actAsBody.user_id).toBe(VICTIM_ID);
      expect(actAsBody.connected.map((p: any) => p.key)).toEqual(['notion']);

      // Now the same admin calls for themselves.
      resolveActingUserIdentity.mockResolvedValue(SELF);
      getConnectedPlugins.mockResolvedValue({});

      const selfRes = await userStatusGet(getRequest('/api/plugins/user-status'));
      const selfBody = await selfRes.json();

      expect(selfBody.user_id).toBe(SESSION_ID);
      expect(selfBody.connected).toEqual([]);
      expect(selfRes.headers.get('X-Cache')).toBe('MISS');
    });

    // Concurrency — two in-flight calls for the same session must each resolve identity
    // independently and neither may be served the other's payload.
    it('handles concurrent calls without crossing identities', async () => {
      const calls: string[] = [];
      resolveActingUserIdentity.mockImplementation(async (opts: any) => {
        calls.push(opts.requestedUserId ?? 'none');
        return SELF;
      });
      getConnectedPlugins.mockResolvedValue({});

      const [a, b] = await Promise.all([
        userStatusGet(getRequest('/api/plugins/user-status')),
        userStatusGet(getRequest(`/api/plugins/user-status?userId=${SESSION_ID}`)),
      ]);

      expect((await a.json()).user_id).toBe(SESSION_ID);
      expect((await b.json()).user_id).toBe(SESSION_ID);
      expect(calls).toHaveLength(2);
    });
  });

  describe('/api/plugins/additional-config', () => {
    // A1
    it('POST refuses unauthenticated and never writes', async () => {
      resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

      const res = await configPost(
        postRequest('/api/plugins/additional-config', {
          userId: VICTIM_ID,
          pluginKey: 'google-mail',
          additionalData: { spreadsheet_id: 'attacker' },
        })
      );

      expect(res.status).toBe(401);
      expect(updateAdditionalConfig).not.toHaveBeenCalled();
    });

    // A2 — PUT was a near-copy of POST and was previously unguarded too
    it('PUT refuses unauthenticated and never writes', async () => {
      resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

      const req = new NextRequest('http://localhost/api/plugins/additional-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: VICTIM_ID,
          pluginKey: 'google-mail',
          additionalData: { spreadsheet_id: 'attacker' },
        }),
      });
      const res = await configPut(req);

      expect(res.status).toBe(401);
      expect(updateAdditionalConfig).not.toHaveBeenCalled();
    });

    // A3
    it('GET refuses unauthenticated and never reads', async () => {
      resolveActingUserIdentity.mockResolvedValue(UNAUTHENTICATED);

      const res = await configGet(
        getRequest(`/api/plugins/additional-config?userId=${VICTIM_ID}&pluginKey=google-mail`)
      );

      expect(res.status).toBe(401);
      expect(getAdditionalConfig).not.toHaveBeenCalled();
    });

    // Writes go to the resolved id, never the body value
    it('writes config for the resolved id', async () => {
      const res = await configPost(
        postRequest('/api/plugins/additional-config', {
          userId: VICTIM_ID,
          pluginKey: 'google-mail',
          additionalData: { spreadsheet_id: 'abc' },
        })
      );

      expect(res.status).toBe(200);
      expect(updateAdditionalConfig).toHaveBeenCalledWith(SESSION_ID, 'google-mail', {
        spreadsheet_id: 'abc',
      });
    });
  });
});

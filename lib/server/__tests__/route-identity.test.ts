/**
 * resolveActingUserIdentity — the single tenant boundary for routes that used to accept
 * a caller-supplied userId.
 *
 * These tests are the security regression locks: identity comes from the session, a
 * foreign target requires platform admin, and every failure path fails CLOSED.
 */

const getUser = jest.fn();
const isAdmin = jest.fn();
const auditLog = jest.fn();

jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

jest.mock('@/lib/services/AdminAccessService', () => ({
  adminAccessService: { isAdmin: (u: unknown) => isAdmin(u) },
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: (e: unknown) => auditLog(e) }) },
}));

import { resolveActingUserIdentity } from '../route-identity';

const SESSION_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_EMAIL = 'operator@example.com';

describe('resolveActingUserIdentity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUser.mockResolvedValue({ id: SESSION_ID, email: SESSION_EMAIL });
    isAdmin.mockResolvedValue(false);
    auditLog.mockResolvedValue(undefined);
  });

  // R1
  it('refuses with 401 when there is no session, without consulting the admin list', async () => {
    getUser.mockResolvedValue(null);

    const result = await resolveActingUserIdentity({ requestedUserId: OTHER_ID, route: 'test' });

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(isAdmin).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  // R2
  it('uses the session user when no target is requested', async () => {
    const result = await resolveActingUserIdentity({ route: 'test' });

    expect(result).toEqual({
      ok: true,
      userId: SESSION_ID,
      sessionUserId: SESSION_ID,
      sessionUserEmail: SESSION_EMAIL,
      actingAs: false,
    });
    expect(isAdmin).not.toHaveBeenCalled();
  });

  // R3 — self-targeting is not an act-as, so it must not require admin
  it('allows targeting yourself without an admin check', async () => {
    const result = await resolveActingUserIdentity({ requestedUserId: SESSION_ID, route: 'test' });

    expect(result).toMatchObject({ ok: true, userId: SESSION_ID, actingAs: false });
    expect(isAdmin).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });

  // R4 — the core privilege lock
  it('refuses a foreign target with 403 for a non-admin', async () => {
    const result = await resolveActingUserIdentity({ requestedUserId: OTHER_ID, route: 'test' });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(auditLog).not.toHaveBeenCalled();
  });

  // R5
  it('allows a foreign target for an admin and audits it', async () => {
    isAdmin.mockResolvedValue(true);

    const result = await resolveActingUserIdentity({
      requestedUserId: OTHER_ID,
      route: 'POST /api/plugins/execute',
      details: { pluginName: 'google-mail' },
    });

    expect(result).toMatchObject({ ok: true, userId: OTHER_ID, sessionUserId: SESSION_ID, actingAs: true });

    // Audit schema: userId = the subject, actorId = who actually did it.
    expect(auditLog).toHaveBeenCalledTimes(1);
    const entry = auditLog.mock.calls[0][0];
    expect(entry).toMatchObject({
      action: 'PLUGIN_ACT_AS',
      userId: OTHER_ID,
      actorId: SESSION_ID,
      severity: 'critical',
    });
    expect(entry.details).toMatchObject({ pluginName: 'google-mail', route: 'POST /api/plugins/execute' });
  });

  // R5b — admin identity check must use the email-bearing form (self-heal + env bootstrap)
  it('passes the session email to the admin check', async () => {
    isAdmin.mockResolvedValue(true);

    await resolveActingUserIdentity({ requestedUserId: OTHER_ID, route: 'test' });

    expect(isAdmin).toHaveBeenCalledWith({ id: SESSION_ID, email: SESSION_EMAIL });
  });

  // R10 (QA N-1) — canonicalisation: an upper-case form of your OWN id is still a
  // self-target, and an act-as target is lower-cased so it cannot address a second
  // in-process cache entry for the same account.
  it('treats an upper-case form of your own id as self-targeting', async () => {
    const result = await resolveActingUserIdentity({
      requestedUserId: SESSION_ID.toUpperCase(),
      route: 'test',
    });

    expect(result).toMatchObject({ ok: true, userId: SESSION_ID, actingAs: false });
    expect(isAdmin).not.toHaveBeenCalled();
  });

  it('lower-cases an act-as target id', async () => {
    isAdmin.mockResolvedValue(true);

    const result = await resolveActingUserIdentity({
      requestedUserId: OTHER_ID.toUpperCase(),
      route: 'test',
    });

    expect(result).toMatchObject({ ok: true, userId: OTHER_ID, actingAs: true });
    expect(auditLog.mock.calls[0][0].userId).toBe(OTHER_ID);
  });

  // R6 — fail closed. AdminAccessService swallows its own errors today, but the resolver
  // must not depend on that: a throwing admin check has to deny, not 500.
  it('refuses with 403 when the admin check rejects', async () => {
    isAdmin.mockRejectedValue(new Error('admin lookup exploded'));

    const result = await resolveActingUserIdentity({ requestedUserId: OTHER_ID, route: 'test' });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(auditLog).not.toHaveBeenCalled();
  });

  // R7 — a Supabase outage must be a 401, never an unhandled 500
  it('returns 401 when the session lookup throws', async () => {
    getUser.mockRejectedValue(new Error('supabase unreachable'));

    const result = await resolveActingUserIdentity({ requestedUserId: OTHER_ID, route: 'test' });

    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(isAdmin).not.toHaveBeenCalled();
  });

  // R8 — validate before the lookup so junk never reaches cache keys or audit rows
  it('rejects a malformed target id with 400 before checking admin', async () => {
    const result = await resolveActingUserIdentity({ requestedUserId: 'test_user_123', route: 'test' });

    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(isAdmin).not.toHaveBeenCalled();
  });

  // R9 — audit must never block a legitimate admin action
  it('still resolves when the audit write rejects', async () => {
    isAdmin.mockResolvedValue(true);
    auditLog.mockRejectedValue(new Error('audit down'));

    const result = await resolveActingUserIdentity({ requestedUserId: OTHER_ID, route: 'test' });

    expect(result).toMatchObject({ ok: true, userId: OTHER_ID, actingAs: true });
  });
});

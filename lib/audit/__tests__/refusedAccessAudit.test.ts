/**
 * The one writer of SECURITY_UNAUTHORIZED_ACCESS (T4).
 *
 * What is asserted here is the PAYLOAD, because every requirement this slice
 * has about the row is a statement about the payload: who it is attributed to,
 * what it must not contain, and what it must not pass to the audit service.
 *
 * The three things most likely to be "fixed" back by a future reader, and so
 * the three with a test each:
 *   - no `request` (it would copy a live credential into `session_id`);
 *   - no `severity` / `complianceFlags` (the registration owns them);
 *   - `userId` is the refused CALLER, never the act-as target.
 */

const mockLog = jest.fn();
const mockFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: {
    log: (...args: unknown[]) => mockLog(...args),
    flush: (...args: unknown[]) => mockFlush(...args),
  },
}));

import {
  recordRefusedAccess,
  REFUSAL_REASON,
  REFUSED_SURFACES,
  type RefusedSurface,
} from '../recordRefusedAccess';
import { AUDIT_EVENTS } from '../events';

const CALLER = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';

const logs: Array<{ level: string; ctx: Record<string, unknown>; msg: string }> = [];
const testLogger = {
  warn: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'warn', ctx, msg }),
  error: (ctx: Record<string, unknown>, msg: string) => logs.push({ level: 'error', ctx, msg }),
};

/** The single entry handed to the audit service. */
const written = () => mockLog.mock.calls[0][0] as Record<string, unknown>;

beforeEach(() => {
  mockLog.mockReset();
  mockLog.mockResolvedValue(undefined);
  mockFlush.mockReset();
  mockFlush.mockResolvedValue(undefined);
  logs.length = 0;
});

describe('the payload', () => {
  it('writes exactly one entry and flushes it before returning', async () => {
    await recordRefusedAccess({ userId: CALLER, surface: 'admin_api', logger: testLogger });

    expect(mockLog).toHaveBeenCalledTimes(1);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([]);
  });

  it('is the registered event, against the platform and not against a row', async () => {
    await recordRefusedAccess({ userId: CALLER, surface: 'admin_api', logger: testLogger });

    expect(written()).toMatchObject({
      action: AUDIT_EVENTS.SECURITY_UNAUTHORIZED_ACCESS,
      entityType: 'system',
      entityId: null,
    });
  });

  it('attributes the row to the refused caller, as both subject and actor', async () => {
    await recordRefusedAccess({ userId: CALLER, surface: 'admin_page', logger: testLogger });

    expect(written().userId).toBe(CALLER);
    expect(written().actorId).toBe(CALLER);
  });

  it('passes NO request — session_id must stay null', async () => {
    // `extractRequestContext` copies a live bearer/refresh token into
    // `session_id`. A refusal row is read while investigating a probe; it must
    // not hand the reader the prober's credential.
    await recordRefusedAccess({ userId: CALLER, surface: 'admin_api', logger: testLogger });

    expect(written()).not.toHaveProperty('request');
    expect(Object.keys(written())).not.toContain('request');
  });

  it('passes NO severity and NO complianceFlags — the registration owns them', async () => {
    await recordRefusedAccess({ userId: CALLER, surface: 'admin_api', logger: testLogger });

    expect(written()).not.toHaveProperty('severity');
    expect(written()).not.toHaveProperty('complianceFlags');
  });

  it('details is a closed key set: surface and reason, nothing else by default', async () => {
    await recordRefusedAccess({ userId: CALLER, surface: 'admin_api', logger: testLogger });

    expect(written().details).toEqual({ surface: 'admin_api', reason: REFUSAL_REASON });
  });

  it('carries no email, no token and no resource name anywhere', async () => {
    await recordRefusedAccess({
      userId: CALLER,
      surface: 'act_as',
      route: '/api/plugins/execute',
      requestedUserId: TARGET,
      headers: { ip: '203.0.113.7', userAgent: 'curl/8.4.0' },
      logger: testLogger,
    });

    const serialised = JSON.stringify(written());
    expect(serialised).not.toMatch(/@/);
    expect(serialised).not.toMatch(/[Bb]earer/);
    expect(written()).not.toHaveProperty('resourceName');
    expect(written()).not.toHaveProperty('changes');
  });
});

describe('the surface is exact, and the path only where it is known (D-2)', () => {
  it('the three surfaces are the only ones, pinned so a fourth call site cannot invent a spelling', () => {
    expect([...REFUSED_SURFACES]).toEqual(['admin_api', 'admin_page', 'act_as']);
  });

  it.each(REFUSED_SURFACES)('%s is recorded verbatim', async (surface: RefusedSurface) => {
    await recordRefusedAccess({ userId: CALLER, surface, logger: testLogger });
    expect((written().details as Record<string, unknown>).surface).toBe(surface);
  });

  it('omits route where the caller does not know it', async () => {
    await recordRefusedAccess({ userId: CALLER, surface: 'admin_api', logger: testLogger });
    expect(Object.keys(written().details as object)).not.toContain('route');
  });

  it('records the exact route where the caller does know it', async () => {
    await recordRefusedAccess({
      userId: CALLER,
      surface: 'act_as',
      route: '/api/plugin-connections',
      logger: testLogger,
    });
    expect((written().details as Record<string, unknown>).route).toBe('/api/plugin-connections');
  });
});

describe('a refused act-as names the target in details only', () => {
  it('the row belongs to the caller; the target is a detail', async () => {
    await recordRefusedAccess({
      userId: CALLER,
      surface: 'act_as',
      route: '/api/plugins/execute',
      requestedUserId: TARGET,
      logger: testLogger,
    });

    expect(written().userId).toBe(CALLER);
    expect(written().entityId).toBeNull();
    expect((written().details as Record<string, unknown>).requestedUserId).toBe(TARGET);
    // Deliberately NOT shaped like the GRANTED act-as write eleven lines below
    // it in route-identity.ts, which uses the target as `userId` and carries
    // `details.adminEmail`.
    expect(written()).not.toHaveProperty('adminEmail');
    expect(JSON.stringify(written())).not.toContain('adminEmail');
  });
});

describe('ip and user agent (D-1)', () => {
  it('are recorded in details when the caller supplies them', async () => {
    await recordRefusedAccess({
      userId: CALLER,
      surface: 'act_as',
      headers: { ip: '203.0.113.7', userAgent: 'curl/8.4.0' },
      logger: testLogger,
    });

    expect(written().details).toMatchObject({ ip_address: '203.0.113.7', user_agent: 'curl/8.4.0' });
  });

  it("are OMITTED, not written as 'unknown', when unavailable", async () => {
    // The deliberate divergence from the change-password precedent: "not
    // captured" and "captured as unknown" must stay distinguishable.
    await recordRefusedAccess({
      userId: CALLER,
      surface: 'act_as',
      headers: { ip: null, userAgent: undefined },
      logger: testLogger,
    });

    const keys = Object.keys(written().details as object);
    expect(keys).not.toContain('ip_address');
    expect(keys).not.toContain('user_agent');
    expect(JSON.stringify(written())).not.toContain('unknown');
  });

  it('reading the ambient headers outside a request scope does not throw (condition 1)', async () => {
    // `headers()` from next/headers throws here, which is exactly the
    // production case this guard exists for: this function sits one statement
    // before a 403 and must never be able to raise.
    await expect(
      recordRefusedAccess({ userId: CALLER, surface: 'admin_api', logger: testLogger })
    ).resolves.toBeUndefined();
    expect(mockLog).toHaveBeenCalledTimes(1);
  });
});

describe('it never throws, whatever the audit service does', () => {
  it('a rejecting log resolves and is logged at error', async () => {
    mockLog.mockRejectedValue(new Error('queue exploded'));

    await expect(
      recordRefusedAccess({ userId: CALLER, surface: 'admin_api', logger: testLogger })
    ).resolves.toBeUndefined();

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('error');
    expect(logs[0].msg).toBe('Audit flush on refused admin access failed; the refusal is unaffected');
  });

  it('a rejecting flush resolves and is logged at error', async () => {
    mockFlush.mockRejectedValue(new Error('database unreachable'));

    await expect(
      recordRefusedAccess({ userId: CALLER, surface: 'admin_page', logger: testLogger })
    ).resolves.toBeUndefined();

    expect(logs.some((l) => l.level === 'error')).toBe(true);
  });

  it('a hanging flush resolves after the bounded wait, with a warning', async () => {
    let release: () => void = () => undefined;
    mockFlush.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );

    const started = Date.now();
    await expect(
      recordRefusedAccess({ userId: CALLER, surface: 'admin_api', logger: testLogger })
    ).resolves.toBeUndefined();
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(logs.some((l) => l.level === 'warn')).toBe(true);
    release(); // do not leave the shared chain blocked for later tests
  }, 10_000);
});

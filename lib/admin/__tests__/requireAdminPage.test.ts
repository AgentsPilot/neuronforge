/**
 * Slice 5 — the `/admin` page guard.
 *
 * ── The assertion that carries the security claim ─────────────────────────
 * BQ-3 (option A) says a non-admin is silently redirected to their normal
 * dashboard. That only buys anything if an ANONYMOUS visitor and a SIGNED-IN
 * NON-ADMIN are indistinguishable — otherwise the difference between the two
 * responses is itself the disclosure the choice was meant to prevent. So the
 * load-bearing test here is `identical`, not the happy path.
 *
 * ── The fixture trap, and why the test is not weakened to dodge it ────────
 * `middleware.ts` runs BEFORE this layout, and `/admin` is deliberately not on
 * its skip list. A signed-in non-admin who has NOT completed onboarding is
 * redirected by middleware to `/onboarding-chat` and never reaches this guard,
 * while an anonymous visitor (no auth cookies) falls through to it.
 *
 * That is NOT a disclosure — that user is sent to `/onboarding-chat` from every
 * protected path, so it says nothing about `/admin` — but it WOULD turn a naive
 * "anonymous vs any signed-in non-admin" test red for a non-security reason,
 * and the reflex on a red security test is to weaken it.
 *
 * So: the fixture is an ONBOARDED signed-in non-admin, which is the population
 * that actually reaches this code. Fix the fixture, keep the assertion.
 */

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockIsAdmin = jest.fn();
jest.mock('@/lib/services/AdminAccessService', () => ({
  AdminAccessService: {
    getInstance: () => ({ isAdmin: (...args: unknown[]) => mockIsAdmin(...args) }),
  },
}));

/**
 * Mocked because the non-admin cases below now WRITE. `AuditTrail` is built at
 * module scope against the jest env stubs, so without this the redirect cases
 * would attempt a real insert at a stub URL from inside a unit test.
 */
const auditLog = jest.fn();
const auditFlush = jest.fn();
jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrail: {
    log: (...args: unknown[]) => auditLog(...args),
    flush: (...args: unknown[]) => auditFlush(...args),
  },
}));

const loggedArgs: unknown[] = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const rec = (...args: unknown[]) => {
      loggedArgs.push(...args);
    };
    const logger: Record<string, unknown> = { info: rec, warn: rec, error: rec, debug: rec };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

/**
 * `redirect()` throws to unwind the render. The mock reproduces that, because a
 * mock that merely RECORDS the call would let execution continue past the
 * redirect — and a guard that "redirects" but keeps going is exactly the bug
 * this file exists to catch.
 */
class RedirectSignal extends Error {
  constructor(public readonly to: string) {
    super(`NEXT_REDIRECT:${to}`);
  }
}
jest.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectSignal(to);
  },
}));

import { requireAdminPage, NON_ADMIN_REDIRECT } from '../requireAdminPage';
import { AUDIT_EVENTS } from '@/lib/audit/events';

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', email: 'ops@example.com' };
/** Onboarded — see the header. This is the population that reaches the guard. */
const ONBOARDED_CUSTOMER = { id: '22222222-2222-4222-8222-222222222222', email: 'customer@example.com' };

/** Run the guard and describe the outcome the way a caller would see it. */
async function outcome(): Promise<{ redirectedTo: string } | { allowed: true }> {
  try {
    await requireAdminPage();
    return { allowed: true };
  } catch (err) {
    if (err instanceof RedirectSignal) return { redirectedTo: err.to };
    throw err;
  }
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockIsAdmin.mockReset();
  auditLog.mockReset();
  auditLog.mockResolvedValue(undefined);
  auditFlush.mockReset();
  auditFlush.mockResolvedValue(undefined);
  loggedArgs.length = 0;
});

describe('requireAdminPage', () => {
  it('lets an admin through and returns their identity', async () => {
    mockGetUser.mockResolvedValue(ADMIN);
    mockIsAdmin.mockResolvedValue(true);

    await expect(requireAdminPage()).resolves.toEqual({ id: ADMIN.id, email: ADMIN.email });
  });

  it('redirects an anonymous visitor', async () => {
    mockGetUser.mockResolvedValue(null);
    expect(await outcome()).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
  });

  it('redirects an onboarded signed-in non-admin', async () => {
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    expect(await outcome()).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
  });

  it('ANONYMOUS AND ONBOARDED-NON-ADMIN ARE INDISTINGUISHABLE (BQ-3)', async () => {
    // The security claim of option A. If these two ever diverge — one to
    // /login, one to /business-os — the redirect itself tells a prober that an
    // admin area exists at this URL, and the whole point is lost.
    //
    // This is about the RESPONSE. The latency differs since the refusal became
    // audited, deliberately and acceptably — see the module header's qualifier.
    mockGetUser.mockResolvedValue(null);
    const anonymous = await outcome();

    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    const nonAdmin = await outcome();

    expect(anonymous).toEqual(nonAdmin);
  });

  it('fails closed when the admin check throws', async () => {
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockRejectedValue(new Error('admin_users unreachable'));

    expect(await outcome()).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
  });

  it('fails closed when the auth lookup throws', async () => {
    mockGetUser.mockRejectedValue(new Error('malformed cookie jar'));

    expect(await outcome()).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
  });

  it('never returns for a non-admin — the redirect actually unwinds', async () => {
    // Guards against a future refactor that logs a redirect and falls through.
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);

    await expect(requireAdminPage()).rejects.toBeInstanceOf(RedirectSignal);
  });

  it('logs the denial with userId only — never an email (FR-6)', async () => {
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    await outcome();

    const logged = JSON.stringify(loggedArgs);
    expect(logged).toContain(ONBOARDED_CUSTOMER.id);
    expect(logged).not.toContain('@');
  });

  it('logs nothing identifying for an anonymous visitor', async () => {
    // There is no identity to attribute, and inventing one would be the only
    // way the two cases could be told apart downstream.
    mockGetUser.mockResolvedValue(null);
    await outcome();

    expect(JSON.stringify(loggedArgs)).not.toContain('@');
  });
});

/**
 * The refused page load is recorded (security-audit-events slice). The lockout
 * story the requirement is sold on is "an admin locked out of /admin leaves a
 * trace"; before this, it left none.
 */
describe('requireAdminPage records a refusal', () => {
  it('writes exactly one row for a signed-in non-admin, and still redirects', async () => {
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);

    expect(await outcome()).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditFlush).toHaveBeenCalledTimes(1);
    expect(auditLog.mock.calls[0][0]).toMatchObject({
      action: AUDIT_EVENTS.SECURITY_UNAUTHORIZED_ACCESS,
      entityType: 'system',
      entityId: null,
      userId: ONBOARDED_CUSTOMER.id,
      actorId: ONBOARDED_CUSTOMER.id,
      details: { surface: 'admin_page', reason: 'not_an_admin' },
    });
  });

  it('the flush happens BEFORE the redirect unwinds the render', async () => {
    // Not awaiting it would lose the row: redirect() throws immediately.
    const order: string[] = [];
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    auditFlush.mockImplementation(async () => void order.push('flush'));

    const result = await outcome();
    order.push('redirect');

    expect(result).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
    expect(order).toEqual(['flush', 'redirect']);
  });

  it('the row carries no request, no severity, no flags and no email', async () => {
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    await outcome();

    const entry = auditLog.mock.calls[0][0] as Record<string, unknown>;
    expect(entry).not.toHaveProperty('request');
    expect(entry).not.toHaveProperty('severity');
    expect(entry).not.toHaveProperty('complianceFlags');
    expect(JSON.stringify(entry)).not.toContain(ONBOARDED_CUSTOMER.email);
  });

  it('writes NOTHING for an anonymous visitor — no identity was refused (OQ-3)', async () => {
    mockGetUser.mockResolvedValue(null);
    expect(await outcome()).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('writes NOTHING when the admin check threw', async () => {
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockRejectedValue(new Error('admin_users unreachable'));

    expect(await outcome()).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('writes nothing when the auth lookup threw, and nothing for an admin', async () => {
    mockGetUser.mockRejectedValue(new Error('malformed cookie jar'));
    await outcome();
    expect(auditLog).not.toHaveBeenCalled();

    mockGetUser.mockReset();
    mockGetUser.mockResolvedValue(ADMIN);
    mockIsAdmin.mockResolvedValue(true);
    await outcome();
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('a REJECTING audit write still redirects — it can never swallow the signal', async () => {
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    auditFlush.mockRejectedValue(new Error('database unreachable'));

    expect(await outcome()).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
  });

  it('a HANGING audit write still redirects, after the bounded wait', async () => {
    mockGetUser.mockResolvedValue(ONBOARDED_CUSTOMER);
    mockIsAdmin.mockResolvedValue(false);
    let release: () => void = () => undefined;
    auditFlush.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      })
    );

    const started = Date.now();
    const result = await outcome();
    const elapsed = Date.now() - started;

    expect(result).toEqual({ redirectedTo: NON_ADMIN_REDIRECT });
    expect(elapsed).toBeGreaterThanOrEqual(1900);
    expect(elapsed).toBeLessThan(5000);
    release();
  }, 10_000);
});

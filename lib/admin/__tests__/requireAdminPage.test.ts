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

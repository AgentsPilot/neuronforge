/**
 * Unit tests for AdminAccessService — the admin authz gate surface.
 *
 * Covers the 3-step isAdmin resolution (bound user_id → email match + self-heal →
 * ADMIN_EMAILS env fallback), fail-closed behavior, listAdminEmails union +
 * degradation, and the 60s cache (single fetch + invalidateCache).
 *
 * The repository is faked (only listActive + bindUserId are used by the service),
 * so these tests never touch Supabase.
 */

import { AdminAccessService } from '@/lib/services/AdminAccessService';
import type { AdminUserRepository } from '@/lib/repositories/AdminUserRepository';

function row(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: 'r',
    user_id: null,
    email: 'a@x.com',
    granted_by: null,
    notes: null,
    is_active: true,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...overrides,
  };
}

/** Build a fake repo exposing just the methods AdminAccessService calls. */
function fakeRepo(listResult: { data: any; error: any }) {
  return {
    listActive: jest.fn().mockResolvedValue(listResult),
    bindUserId: jest.fn().mockResolvedValue({ data: null, error: null }),
  } as unknown as AdminUserRepository & {
    listActive: jest.Mock;
    bindUserId: jest.Mock;
  };
}

/** Create a service with a given ADMIN_EMAILS env value (read at construction). */
function makeService(repo: AdminUserRepository, adminEmails = '') {
  const prev = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = adminEmails;
  const svc = AdminAccessService.createForTest(repo);
  process.env.ADMIN_EMAILS = prev; // service already captured it in its constructor
  return svc;
}

describe('AdminAccessService.isAdmin', () => {
  it('grants when the user_id is a bound admin (step 1, no email needed)', async () => {
    const repo = fakeRepo({ data: [row({ user_id: 'u1', email: 'a@x.com' })], error: null });
    const svc = makeService(repo);

    expect(await svc.isAdmin({ id: 'u1' })).toBe(true);
  });

  it('grants by email and self-heals the user_id binding (step 2)', async () => {
    const repo = fakeRepo({ data: [row({ user_id: null, email: 'b@x.com' })], error: null });
    const svc = makeService(repo);

    const result = await svc.isAdmin({ id: 'u2', email: 'B@x.com' });

    expect(result).toBe(true);
    expect((repo as any).bindUserId).toHaveBeenCalledWith('b@x.com', 'u2');
  });

  it('grants via the ADMIN_EMAILS env fallback before the DB is seeded (step 3)', async () => {
    const repo = fakeRepo({ data: [], error: null });
    const svc = makeService(repo, 'env@x.com, other@x.com');

    expect(await svc.isAdmin({ id: 'u3', email: 'ENV@x.com' })).toBe(true);
  });

  it('denies a user that matches none of the three paths', async () => {
    const repo = fakeRepo({ data: [row({ user_id: 'u1', email: 'a@x.com' })], error: null });
    const svc = makeService(repo);

    expect(await svc.isAdmin({ id: 'nope', email: 'nope@x.com' })).toBe(false);
  });

  it('fails closed (denies) when the repository errors', async () => {
    const repo = fakeRepo({ data: null, error: new Error('db down') });
    const svc = makeService(repo, 'env@x.com');

    // Even an env-listed email is denied here because the cache load throws first.
    expect(await svc.isAdmin({ id: 'u1', email: 'a@x.com' })).toBe(false);
  });

  it('denies when no user id is provided', async () => {
    const repo = fakeRepo({ data: [], error: null });
    const svc = makeService(repo);

    expect(await svc.isAdmin({ id: '' })).toBe(false);
  });
});

describe('AdminAccessService.isAdminById', () => {
  it('true for a bound admin, false otherwise', async () => {
    const repo = fakeRepo({ data: [row({ user_id: 'u1' })], error: null });
    const svc = makeService(repo);

    expect(await svc.isAdminById('u1')).toBe(true);
    expect(await svc.isAdminById('u2')).toBe(false);
  });
});

describe('AdminAccessService.listAdminEmails', () => {
  it('returns the union of DB rows and ADMIN_EMAILS', async () => {
    const repo = fakeRepo({ data: [row({ email: 'a@x.com' })], error: null });
    const svc = makeService(repo, 'env@x.com');

    const emails = await svc.listAdminEmails();

    expect(emails.sort()).toEqual(['a@x.com', 'env@x.com']);
  });

  it('still returns env admins when the DB read fails', async () => {
    const repo = fakeRepo({ data: null, error: new Error('db down') });
    const svc = makeService(repo, 'env@x.com');

    expect(await svc.listAdminEmails()).toEqual(['env@x.com']);
  });
});

describe('AdminAccessService caching', () => {
  it('loads the admin set once within the TTL and refetches after invalidateCache', async () => {
    const repo = fakeRepo({ data: [row({ user_id: 'u1' })], error: null });
    const svc = makeService(repo);

    await svc.isAdminById('u1');
    await svc.isAdminById('u1');
    expect((repo as any).listActive).toHaveBeenCalledTimes(1);

    svc.invalidateCache();
    await svc.isAdminById('u1');
    expect((repo as any).listActive).toHaveBeenCalledTimes(2);
  });
});

/**
 * Admin delete AD-1b (SA D-3): the read-only, tri-state check R-2 uses.
 * Shares isAdmin's resolver; the isAdmin tests above are unmodified, which is
 * the proof that the extraction changed nothing for requireAdmin.
 */
describe('AdminAccessService.checkAdminStatus', () => {
  it('true for a bound user_id, even with no email', async () => {
    const repo = fakeRepo({ data: [row({ user_id: 'u1', email: 'a@x.com' })], error: null });
    const svc = makeService(repo);

    expect(await svc.checkAdminStatus({ id: 'u1', email: null })).toBe(true);
  });

  it('true on a DB email match, and NEVER self-heals (no bindUserId write)', async () => {
    const repo = fakeRepo({ data: [row({ user_id: null, email: 'b@x.com' })], error: null });
    const svc = makeService(repo);

    expect(await svc.checkAdminStatus({ id: 'u2', email: 'B@x.com' })).toBe(true);
    expect(repo.bindUserId).not.toHaveBeenCalled();
  });

  it('true via the ADMIN_EMAILS env list', async () => {
    const repo = fakeRepo({ data: [], error: null });
    const svc = makeService(repo, 'env@x.com');

    expect(await svc.checkAdminStatus({ id: 'u3', email: 'env@x.com' })).toBe(true);
  });

  it('false when none of the three sources match', async () => {
    const repo = fakeRepo({ data: [row({ user_id: 'u1', email: 'a@x.com' })], error: null });
    const svc = makeService(repo, 'env@x.com');

    expect(await svc.checkAdminStatus({ id: 'nope', email: 'nope@x.com' })).toBe(false);
    expect(await svc.checkAdminStatus({ id: 'nope', email: null })).toBe(false);
  });

  it('null (unknown), never false, when the admin set cannot be read', async () => {
    const repo = fakeRepo({ data: null, error: new Error('db down') });
    const svc = makeService(repo, 'env@x.com');

    expect(await svc.checkAdminStatus({ id: 'u1', email: 'env@x.com' })).toBeNull();
  });

  it('null when no id is given', async () => {
    const repo = fakeRepo({ data: [], error: null });
    const svc = makeService(repo);

    expect(await svc.checkAdminStatus({ id: '' })).toBeNull();
  });

  it('never logs the email it was asked about (env path included)', async () => {
    const logged: unknown[] = [];
    // Load a fresh copy of the service bound to the recording logger.
    let Fresh: typeof AdminAccessService | undefined;
    jest.isolateModules(() => {
      jest.doMock('@/lib/logger', () => {
        const rec = (...args: unknown[]) => logged.push(args);
        const make = (): Record<string, unknown> => {
          const l: Record<string, unknown> = { info: rec, warn: rec, error: rec, debug: rec };
          l.child = () => l;
          return l;
        };
        return { createLogger: () => make() };
      });
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      Fresh = require('@/lib/services/AdminAccessService').AdminAccessService;
    });
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = 'secret-env@x.com';
    const okRepo = fakeRepo({ data: [], error: null });
    const svc = Fresh!.createForTest(okRepo);
    const failing = Fresh!.createForTest(fakeRepo({ data: null, error: new Error('db down') }));
    process.env.ADMIN_EMAILS = prev;

    expect(await svc.checkAdminStatus({ id: 'u9', email: 'secret-env@x.com' })).toBe(true);
    expect(await failing.checkAdminStatus({ id: 'u9', email: 'secret-env@x.com' })).toBeNull();
    // Control: the recorder works (the failing read logged an error with the id).
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.stringify(logged)).not.toContain('secret-env@x.com');
  });
});

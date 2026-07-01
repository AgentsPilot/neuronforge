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

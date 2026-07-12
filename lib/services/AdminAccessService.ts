// lib/services/AdminAccessService.ts
// The single surface other components use to answer "is this user an admin?" and
// "who are the admins?" (e.g. the admin authz gate on /api/admin/* routes and the
// failure-notification recipient list).
//
// Source of truth: the `admin_users` table (via AdminUserRepository), which is
// service-role write only. Do NOT read `profiles.role` for admin authz — it is
// user-writable and cannot be trusted (see AdminUserRepository's header note).
//
// Bootstrap: admins are seeded from the ADMIN_EMAILS env allow-list (comma or
// semicolon separated). Seeding into the DB is done by scripts/seed-admin-users.ts.
// As a safety net, an email present in ADMIN_EMAILS is ALSO treated as an admin at
// runtime even if the DB seed hasn't run yet — so the very first operator is never
// locked out. The DB remains the authoritative, runtime-manageable source.
//
// Usage (authz gate):
//   const svc = AdminAccessService.getInstance();
//   if (!(await svc.isAdmin({ id: user.id, email: user.email }))) return forbidden();
//
// Usage (notification recipients):
//   const emails = await svc.listAdminEmails();

import { createLogger } from '@/lib/logger';
import {
  AdminUserRepository,
  adminUserRepository,
  type AdminUser,
} from '@/lib/repositories/AdminUserRepository';

const logger = createLogger({ service: 'AdminAccessService' });

/** Minimal identity shape accepted by the gate — matches Supabase's auth user. */
export interface AdminCheckUser {
  id: string;
  email?: string | null;
}

// Cache the active-admin set briefly so the gate (which runs on every admin request)
// doesn't hit the DB each time. The admin set is tiny and changes rarely, so a short
// TTL is a safe trade-off between freshness and load.
const CACHE_TTL_MS = 60_000;

interface AdminCache {
  userIds: Set<string>;
  emails: Set<string>;
  admins: AdminUser[];
  fetchedAt: number;
}

/** Parse ADMIN_EMAILS (comma/semicolon/whitespace separated) into a normalized set. */
function parseEnvAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS || '';
  return new Set(
    raw
      .split(/[,;\s]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

export class AdminAccessService {
  private static instance: AdminAccessService | null = null;

  private repo: AdminUserRepository;
  private cache: AdminCache | null = null;
  private envAdminEmails: Set<string>;

  private constructor(repo: AdminUserRepository = adminUserRepository) {
    this.repo = repo;
    this.envAdminEmails = parseEnvAdminEmails();
  }

  static getInstance(): AdminAccessService {
    if (!AdminAccessService.instance) {
      AdminAccessService.instance = new AdminAccessService();
    }
    return AdminAccessService.instance;
  }

  /** For tests / DI — build an isolated instance with a custom repository. */
  static createForTest(repo: AdminUserRepository): AdminAccessService {
    return new AdminAccessService(repo);
  }

  /**
   * Primary admin gate. Returns true if the user is an admin.
   *
   * Checks (in order):
   *   1. DB row bound to the user_id (fast path, cached).
   *   2. DB row matching the user's email — if found unbound, binds the user_id so
   *      subsequent checks hit the fast path (self-heals seeded-by-email rows).
   *   3. The ADMIN_EMAILS env allow-list, so the first operator is never locked out
   *      before the DB seed runs.
   *
   * Pass the auth user's email when you have it (you almost always do from getUser())
   * — it enables the self-heal and env-fallback paths.
   */
  async isAdmin(user: AdminCheckUser): Promise<boolean> {
    if (!user?.id) return false;
    const email = user.email ? user.email.trim().toLowerCase() : null;

    try {
      const cache = await this.getCache();

      // 1. Bound user_id — fast path.
      if (cache.userIds.has(user.id)) return true;

      // 2. Matched by email in the DB allow-list.
      if (email && cache.emails.has(email)) {
        // Self-heal: bind the user_id so future checks hit the fast path.
        const existing = cache.admins.find((a) => a.email === email);
        if (existing && existing.user_id !== user.id) {
          await this.repo.bindUserId(email, user.id);
          this.invalidateCache();
        }
        return true;
      }

      // 3. Env allow-list fallback (pre-seed safety net).
      if (email && this.envAdminEmails.has(email)) {
        logger.warn(
          { userId: user.id, email },
          'Admin granted via ADMIN_EMAILS env fallback — DB seed has not run for this admin yet'
        );
        return true;
      }

      return false;
    } catch (error) {
      // Fail closed: on any error, deny admin access (never grant on failure).
      logger.error({ err: error, userId: user.id }, 'Admin check failed — denying access');
      return false;
    }
  }

  /** Convenience: gate by user id only (no email self-heal / env fallback). */
  async isAdminById(userId: string): Promise<boolean> {
    if (!userId) return false;
    try {
      const cache = await this.getCache();
      return cache.userIds.has(userId);
    } catch (error) {
      logger.error({ err: error, userId }, 'Admin check (by id) failed — denying access');
      return false;
    }
  }

  /** All active admins (DB rows). Use for management UIs / auditing. */
  async listAdmins(): Promise<AdminUser[]> {
    try {
      const cache = await this.getCache();
      return cache.admins;
    } catch (error) {
      logger.error({ err: error }, 'Failed to list admins');
      return [];
    }
  }

  /**
   * All admin email addresses — DB rows unioned with the ADMIN_EMAILS env allow-list.
   * Use this for notification recipient resolution (failure emails, etc.).
   */
  async listAdminEmails(): Promise<string[]> {
    try {
      const cache = await this.getCache();
      const emails = new Set<string>(cache.emails);
      for (const e of this.envAdminEmails) emails.add(e);
      return Array.from(emails);
    } catch (error) {
      logger.error({ err: error }, 'Failed to list admin emails');
      // Still surface env admins so notifications aren't fully lost on DB failure.
      return Array.from(this.envAdminEmails);
    }
  }

  /** Drop the cache — call after seeding/granting/revoking so changes take effect now. */
  invalidateCache(): void {
    this.cache = null;
  }

  // --------------------------------------------------------------------------

  private async getCache(): Promise<AdminCache> {
    const now = Date.now();
    if (this.cache && now - this.cache.fetchedAt < CACHE_TTL_MS) {
      return this.cache;
    }

    const { data, error } = await this.repo.listActive();
    if (error) {
      // If we have a stale cache, prefer it over throwing (graceful degradation).
      if (this.cache) return this.cache;
      throw error;
    }

    const admins = data ?? [];
    this.cache = {
      admins,
      userIds: new Set(admins.map((a) => a.user_id).filter((v): v is string => !!v)),
      emails: new Set(admins.map((a) => a.email)),
      fetchedAt: now,
    };
    return this.cache;
  }
}

// Singleton instance for convenience.
export const adminAccessService = AdminAccessService.getInstance();

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
// The env value is parsed by the shared lib/admin/adminEmailsEnv.ts (one parser for
// app code; the admin list route uses the same one).
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

import { readEnvAdminEmails } from '@/lib/admin/adminEmailsEnv';
import { createLogger } from '@/lib/logger';
import {
  AdminUserRepository,
  adminUserRepository,
  type AdminUser,
} from '@/lib/repositories/AdminUserRepository';

const logger = createLogger({ service: 'AdminAccessService' });

/** Trimmed, lower-cased email, or null when absent. */
function normaliseEmail(email: string | null | undefined): string | null {
  return email ? email.trim().toLowerCase() : null;
}

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

export class AdminAccessService {
  private static instance: AdminAccessService | null = null;

  private repo: AdminUserRepository;
  private cache: AdminCache | null = null;
  private envAdminEmails: Set<string>;

  private constructor(repo: AdminUserRepository = adminUserRepository) {
    this.repo = repo;
    this.envAdminEmails = readEnvAdminEmails();
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
    const email = normaliseEmail(user.email);

    try {
      const match = await this.resolveAdminMatch(user.id, email);
      if (!match) return false;

      if (match.source === 'db_email' && email) {
        // Self-heal: bind the user_id so future checks hit the fast path.
        const existing = match.cache.admins.find((a) => a.email === email);
        if (existing && existing.user_id !== user.id) {
          await this.repo.bindUserId(email, user.id);
          this.invalidateCache();
        }
      }

      if (match.source === 'env_email') {
        logger.warn(
          { userId: user.id, email },
          'Admin granted via ADMIN_EMAILS env fallback — DB seed has not run for this admin yet'
        );
      }

      return true;
    } catch (error) {
      // Fail closed: on any error, deny admin access (never grant on failure).
      logger.error({ err: error, userId: user.id }, 'Admin check failed — denying access');
      return false;
    }
  }

  /**
   * Read-only, tri-state admin status of ANY user — for a caller that must
   * refuse when the answer is unknown (admin delete AD-1b, R-2; SA D-3).
   *
   *   true   the user is an admin (same three sources, same order as isAdmin)
   *   false  definitely not an admin
   *   null   could not tell (the admin set could not be read, or no id) — the
   *          caller must treat this as "possibly an admin" and refuse
   *
   * Why not isAdmin: as a GATE, isAdmin fails closed by answering `false`, which
   * for a REFUSAL is fail-open ("not an admin, go ahead"). It also self-heals
   * with a write and logs the email on the env path. This method shares the one
   * resolver with isAdmin, never writes, and logs ids only. `email` may be null:
   * the bound-id source still decides.
   *
   * By default it shares isAdmin's 60 s cache, so a just-added admin may read
   * `false` until it expires. Acceptable for a read-only preview.
   *
   * `{ fresh: true }` (admin delete AD-2, SA T-8 / AC2-7) is for a DESTRUCTIVE
   * caller: it reads the admin set straight from the repository, bypassing
   * BOTH the cache and its stale fallback, and never refills the shared cache.
   * A read error is `null` (unknown, which refuses), never a stale answer.
   * Not `invalidateCache()` + read: that races other requests on the shared
   * singleton and degrades every concurrent isAdmin caller.
   */
  async checkAdminStatus(user: AdminCheckUser, opts: { fresh?: boolean } = {}): Promise<boolean | null> {
    if (!user?.id) return null;
    try {
      const loader = opts.fresh === true ? () => this.readAdminSetFresh() : () => this.getCache();
      const match = await this.resolveAdminMatch(user.id, normaliseEmail(user.email), loader);
      return match !== null;
    } catch (error) {
      logger.error({ err: error, userId: user.id }, 'Admin status check failed — status unknown');
      return null;
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

  /**
   * The ONE admin rule (SA D-3 a): cache -> bound id -> DB email -> env email.
   * Returns which source matched (plus the cache it read), `null` when none
   * did, and THROWS when the admin set cannot be read. Pure decision: no write
   * and no log, so each public method adds its own behaviour on top.
   */
  private async resolveAdminMatch(
    userId: string,
    email: string | null,
    loader: () => Promise<AdminCache> = () => this.getCache()
  ): Promise<{ source: 'bound_id' | 'db_email' | 'env_email'; cache: AdminCache } | null> {
    const cache = await loader();
    if (cache.userIds.has(userId)) return { source: 'bound_id', cache };
    if (email && cache.emails.has(email)) return { source: 'db_email', cache };
    if (email && this.envAdminEmails.has(email)) return { source: 'env_email', cache };
    return null;
  }

  /** Build an admin set from rows (shared by the cached and the fresh path). */
  private static toCache(admins: AdminUser[], fetchedAt: number): AdminCache {
    return {
      admins,
      userIds: new Set(admins.map((a) => a.user_id).filter((v): v is string => !!v)),
      emails: new Set(admins.map((a) => a.email)),
      fetchedAt,
    };
  }

  /**
   * The admin set read now, for a destructive caller (`checkAdminStatus` with
   * `fresh`). No cache read, no stale fallback, no cache refill: an error THROWS
   * (the caller maps it to `null`).
   */
  private async readAdminSetFresh(): Promise<AdminCache> {
    const { data, error } = await this.repo.listActive();
    if (error) throw error;
    return AdminAccessService.toCache(data ?? [], Date.now());
  }

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

    this.cache = AdminAccessService.toCache(data ?? [], now);
    return this.cache;
  }
}

// Singleton instance for convenience.
export const adminAccessService = AdminAccessService.getInstance();

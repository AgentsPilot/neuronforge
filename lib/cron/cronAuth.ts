/**
 * Is this request Vercel Cron (or an operator holding its secret), and not the
 * open internet? (PROD-1b, A5)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE CRON AUTH CHECK. Every cron entry point calls it before any work;
 * `lib/__tests__/envConfigHardening.guard.test.ts` (G-6) fails if one does not.
 *
 * It replaces 22 inline copies of the same function and fixes five routes that
 * ran for anyone when `CRON_SECRET` was unset: a cron URL is public, and the
 * bearer secret is the only thing separating a scheduled call from a stranger.
 *
 * FAIL CLOSED.
 *   1. Local development only (`NODE_ENV === 'development'` and no
 *      `VERCEL_ENV`): allowed, for manual triggering. A Vercel deployment can
 *      never take this branch, even with a misconfigured `NODE_ENV`; under
 *      `vercel dev` the secret is needed (SA D-8).
 *   2. `CRON_SECRET` unset, empty or whitespace: refused, with the error line
 *      every copy used to write (same text, so existing log searches match).
 *   3. Otherwise `Authorization: Bearer <secret>`, compared in constant time.
 *      Both sides are hashed first, so a length mismatch cannot throw.
 *   4. Any exception inside: refused. An auth check that throws must never
 *      turn into a 500 that skipped auth.
 *
 * The header and the secret are never logged. The caller passes its own
 * logger so the refusal line keeps the route's module name; each route keeps
 * its own "Unauthorized" warning and 401 body.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Not used by `process-queue` (a QStash signature, a different credential) or
 * `check-free-tier-expiration` (its own stricter check with no development
 * bypass); G-6 exempts both with reasons.
 *
 * @module lib/cron/cronAuth
 */

import { createHash, timingSafeEqual } from 'crypto';
import type { Logger } from '@/lib/logger';

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

export function isAuthorizedCronRequest(request: Request, logger: Logger): boolean {
  try {
    const vercelEnv = (process.env.VERCEL_ENV ?? '').trim();
    if (process.env.NODE_ENV === 'development' && vercelEnv === '') return true;

    const secret = process.env.CRON_SECRET;
    if (!secret || secret.trim() === '') {
      logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
      return false;
    }

    const header = request.headers.get('authorization') ?? '';
    return timingSafeEqual(sha256(header), sha256(`Bearer ${secret}`));
  } catch {
    return false;
  }
}

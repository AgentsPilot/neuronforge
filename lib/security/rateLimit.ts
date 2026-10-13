/**
 * The throttle the unauthenticated endpoints put in front of themselves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO COUNTERS PER CALLER, AND THE SECOND IS THE POINT
 *
 * Every protected route counts a request twice over: once under `ok:` when it
 * served normally, and once under `fail:` when the credential did not verify.
 *
 * Those two are not the same measurement. A client reloading their booking
 * fifteen times is a client with bad signal; fifteen rejected tokens from one
 * address is somebody trying keys in a lock. Counting them together means the
 * only limit you can set is one loose enough for the first, which is far too
 * loose for the second — so the failure allowance is a fraction of the success
 * allowance, and it is the one that actually detects anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A CALLER IS
 *
 * The client IP, from `x-forwarded-for`, hashed before it is stored. Hashed
 * because these rows would otherwise be a log of who visited which invoice,
 * retained for a day, in a table nobody thinks of as holding personal data.
 * The hash is one-way and the key is all the limiter ever needs.
 *
 * Carrier NAT and office gateways mean clients DO share an address, so the
 * allowances are deliberately generous. This is an abuse brake, not a meter:
 * the failure mode to avoid is locking a real client out of their own booking,
 * not letting an attacker have a few more tries than intended.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHEN THE LIMITER ITSELF IS BROKEN
 *
 * `fail open` for reads, `fail closed` for nothing. If the counter is
 * unreachable, a client must still be able to open their booking and pay their
 * bill — a database hiccup that takes the portal down with it would be a
 * self-inflicted outage on the surface clients actually use. The degradation
 * is logged so it is visible rather than silent.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';

import { createLogger } from '@/lib/logger';
import { rateLimitRepository } from '@/lib/repositories/RateLimitRepository';

const logger = createLogger({ service: 'RateLimit' });

/** How many of each, per window, per caller. */
export interface RateLimitRule {
  /** Requests that were served. */
  limit: number;
  /** Requests whose credential did not verify. Much tighter — see above. */
  failureLimit: number;
  windowSeconds: number;
}

/*
 * Three shapes, so a route picks the one that matches what it does rather than
 * inventing numbers. All are per caller per window.
 */
export const RATE_LIMITS = {
  /**
   * Reading something behind a token — the portal, an invoice, a calendar
   * file. Generous: this is a page a client refreshes, and several of these
   * routes are called more than once per page view.
   */
  read: { limit: 120, failureLimit: 20, windowSeconds: 300 },

  /**
   * Changing something — cancel, reschedule, answer a quote, confirm consent.
   * A client does these once or twice, ever.
   */
  write: { limit: 20, failureLimit: 10, windowSeconds: 300 },

  /**
   * Creating an account, or putting a file in object storage, from a stranger.
   * The tightest, because the cost of each one is borne by the business.
   */
  create: { limit: 10, failureLimit: 10, windowSeconds: 900 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * The caller, as a key component.
 *
 * `x-forwarded-for` is a list when proxies chain; the FIRST entry is the
 * client and the rest are the hops. Falls back to a constant so a request with
 * no discoverable address is still counted — as one shared bucket, which is
 * the conservative reading.
 */
function callerKey(request: NextRequest | Request): string {
  const header =
    request.headers.get('x-forwarded-for') ??
    request.headers.get('x-real-ip') ??
    '';

  const ip = header.split(',')[0]?.trim() || 'unknown';

  // Hashed: see the note above about what this table would otherwise be.
  return createHash('sha256').update(ip).digest('hex').slice(0, 32);
}

export interface RateLimitOutcome {
  allowed: boolean;
  hits: number;
  degraded: boolean;
}

/**
 * Count one request against a route's allowance.
 *
 * `outcome: 'failure'` counts under the tighter failure budget instead. Call it
 * AFTER the credential check, so the route knows which bucket this was.
 */
export async function rateLimit(
  request: NextRequest | Request,
  route: string,
  rule: RateLimitRule,
  outcome: 'ok' | 'failure' = 'ok'
): Promise<RateLimitOutcome> {
  const bucket = outcome === 'failure' ? 'fail' : 'ok';
  const limit = outcome === 'failure' ? rule.failureLimit : rule.limit;

  const verdict = await rateLimitRepository.hit(
    `${bucket}:${route}:${callerKey(request)}`,
    rule.windowSeconds,
    limit
  );

  if (!verdict.allowed) {
    /*
     * Logged at `warn` with the route and the count, never the address. This
     * is the record an audit asks for: that the control ran, and what it did.
     */
    logger.warn({ route, bucket, hits: verdict.hits, limit }, 'Rate limit exceeded');
  }

  return {
    allowed: verdict.allowed,
    hits: verdict.hits,
    degraded: Boolean(verdict.degraded),
  };
}

/** The response a throttled caller gets. No detail: it is not owed one. */
export function tooManyRequests(windowSeconds: number): Response {
  return new Response(
    JSON.stringify({ success: false, error: 'Too many requests' }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(windowSeconds),
      },
    }
  );
}

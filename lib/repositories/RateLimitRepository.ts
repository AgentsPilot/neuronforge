/**
 * The counter behind the public endpoints' throttle.
 *
 * Thin by design: one RPC call. The atomicity that matters lives in
 * `public.rate_limit_hit` — a select-then-write here would let two requests
 * arriving together both read "4 of 5", which is the same race the durable
 * queue drain exists to avoid, and it bites exactly under the load that makes
 * a throttle worth having.
 *
 * No `user_id` filter, and that is not an exception to CLAUDE.md rule 4: these
 * rows belong to no tenant. A key is a route name plus a hashed caller
 * address, and the table holds nothing that identifies a person.
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ service: 'RateLimitRepository' });

export interface RateLimitVerdict {
  allowed: boolean;
  /** How many requests this key has made in the current window, including this one. */
  hits: number;
  /**
   * True when the counter itself could not be read or written.
   *
   * Reported rather than folded into `allowed`, so the caller decides what a
   * broken limiter means for its own route — see `rateLimit` for why reads and
   * writes answer that differently.
   */
  degraded?: boolean;
}

export const rateLimitRepository = {
  async hit(key: string, windowSeconds: number, limit: number): Promise<RateLimitVerdict> {
    try {
      const { data, error } = await supabaseServer.rpc('rate_limit_hit', {
        p_key: key,
        p_window_seconds: windowSeconds,
        p_limit: limit,
      });

      if (error) {
        logger.warn({ err: error, key }, 'Rate limit counter unavailable');
        return { allowed: true, hits: 0, degraded: true };
      }

      /* PostgREST returns a TABLE-returning function as an array of rows. */
      const row = Array.isArray(data) ? data[0] : data;

      return {
        allowed: Boolean(row?.allowed),
        hits: Number(row?.hits ?? 0),
      };
    } catch (err) {
      logger.warn({ err, key }, 'Rate limit counter threw');
      return { allowed: true, hits: 0, degraded: true };
    }
  },

  /** Drops closed windows. Called from the queue cron. */
  async prune(olderThan = '1 day'): Promise<number> {
    try {
      const { data, error } = await supabaseServer.rpc('rate_limit_prune', {
        p_older_than: olderThan,
      });
      if (error) {
        logger.warn({ err: error }, 'Rate limit prune failed');
        return 0;
      }
      return Number(data ?? 0);
    } catch (err) {
      logger.warn({ err }, 'Rate limit prune threw');
      return 0;
    }
  },
};

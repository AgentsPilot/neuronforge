/**
 * A quote that has passed its date says so.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EXPIRY WAS A CALCULATION IN ONE PLACE, NOT A STATE
 *
 * `'expired'` has always been in the proposal status union, and nothing ever
 * wrote it. The only component that knew a quote had lapsed was the client's
 * own page, which worked it out live each time the link was opened:
 *
 *     new Date(`${valid_until}T23:59:59Z`) < Date.now()  →  expired
 *
 * Everything on the business side therefore went on reading `sent`. The
 * consequences all followed from that one absence:
 *
 *   · `quote_awaiting_client` filters on `status in ('sent','viewed')` and
 *     nothing else, so My Day chased a lapsed quote for ever — and the chase
 *     sent the client to the one page that DID check, which refused them. The
 *     owner was asked to do something guaranteed to fail.
 *   · `quote_deadline_unanswered` watches the deadline approach and stops
 *     matching the moment it passes, so attention ended exactly when the
 *     problem began.
 *   · open-pipeline reads count `sent` as live, so a quote that lapsed in
 *     September is still forecast revenue today.
 *
 * Making it a state fixes all three at once, which is why it is done here
 * rather than by teaching each reader to compare the date itself. That was the
 * arrangement that produced the bug: one component remembered and the rest did
 * not, and every new reader is another chance to forget.
 *
 * ── THE DAY BOUNDARY ────────────────────────────────────────────────────────
 *
 * A quote valid "until the 30th" is valid for the whole of the 30th, wherever
 * the client is reading it — the client page says so with `T23:59:59Z`. So the
 * comparison here is `valid_until < today` in UTC, which first becomes true on
 * the 31st. The two must agree: a quote this sweep calls dead while the client
 * page still accepts it would be refused by the owner's card and taken by the
 * client on the same afternoon.
 *
 * ── IDEMPOTENT, AND DELIBERATELY NARROW ─────────────────────────────────────
 *
 * Only `sent` and `viewed` move. A second run writes nothing, because an
 * expired row no longer matches. `accepted`, `declined`, `stopped` and
 * `superseded` are answers somebody gave and are never overwritten by a clock
 * — an accepted quote whose validity date has passed is still accepted.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/proposals/expireLapsedQuotes
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';

const logger = createLogger({ module: 'ExpireLapsedQuotes' });

/** The statuses a clock may move. Everything else is somebody's decision. */
const AWAITING_AN_ANSWER = ['sent', 'viewed'] as const;

export async function expireLapsedQuotes(now: Date = new Date()): Promise<{ expired: number }> {
  try {
    /* UTC, to match the client page's end-of-day rule — see the note above. */
    const today = now.toISOString().slice(0, 10);

    const { data, error } = await supabaseServer
      .from('proposals')
      .update({ status: 'expired', updated_at: now.toISOString() })
      /*
       * Unscoped by user on purpose: this is a clock, not a request. It runs
       * for every business at once and touches only rows whose own date has
       * passed, so there is no caller-supplied id that could reach across
       * tenants. The filters below are the whole of what it can see.
       */
      .in('status', AWAITING_AN_ANSWER)
      .not('valid_until', 'is', null)
      .lt('valid_until', today)
      .select('id, user_id');

    if (error) throw error;

    const expired = data?.length ?? 0;

    if (expired > 0) {
      logger.info(
        { expired, businesses: new Set((data ?? []).map(row => row.user_id)).size, today },
        'Quotes past their date marked expired'
      );
    }

    return { expired };
  } catch (err) {
    /*
     * Never fatal to its caller. This runs inside a cron that has other work,
     * and a quote left reading `sent` for another hour is the cost — the same
     * state it has been in all along. Throwing would take the invoice half of
     * that cron down with it.
     */
    logger.error({ err }, 'Could not expire lapsed quotes');
    return { expired: 0 };
  }
}

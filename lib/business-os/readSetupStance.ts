import 'server-only';

/**
 * Has anybody arrived yet — answered on the server, for the tab bar's FIRST
 * FRAME.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FLASH THIS EXISTS TO REMOVE
 *
 * `BusinessOSTabs` reads its answer from a session key that only `LiveDashboard`
 * writes. On a cold load that key is absent, which the bar reads as UNKNOWN,
 * and unknown deliberately shows everything — hiding four tabs from a business
 * that has traded for a year because one request was slow is far worse than
 * briefly offering a new account a tab it cannot use.
 *
 * Correct, and visibly wrong: an owner finishing the chat landed on the
 * configuration, saw all six tabs for about two seconds, and watched four of
 * them vanish when the dashboard mounted and said "still in setup". Reported
 * from production.
 *
 * The guess was only ever needed because nothing on the server had an opinion.
 * This gives it one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE FACT, NOT A SECOND MODEL OF "IS SETUP DONE"
 *
 * The temptation is to answer the whole question here — profile, catalogue,
 * website, mailbox — and that is precisely the mistake this codebase keeps
 * paying for: two models of the same thing, disagreeing for the accounts that
 * sit between them.
 *
 * So this answers the single fact `setupMode` already turns on, and the half
 * that is knowable without the walkthrough's own state: `nobodyHasArrived`.
 * Once a client has been added, booked or paid, the account is not being
 * walked through, whatever the phases say. The dashboard still has the final
 * word through the session key, which refines the remaining case — an owner
 * who finished every phase before anybody arrived.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GUARANTEES
 *
 *   1. **Never throws, and fails OPEN.** Any error returns `hasArrived: true`,
 *      which shows every tab the account's capabilities allow. That is the
 *      same asymmetry the bar itself is built on: a slow read must never take
 *      navigation away from a working business.
 *   2. **The session user only.** No parameter: the id is `getUser().id`,
 *      memoised per request, so this shares the lookup the layout's other
 *      reads already make.
 *   3. **Two counted reads, in parallel, through repositories** (CLAUDE.md
 *      rule 1). Each counts on an indexed `user_id`, and they run
 *      inside the layout's existing parallel block, so the page waits on the
 *      slowest read it was already doing rather than on these.
 *
 * @module lib/business-os
 */

import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { paymentTransactionRepository } from '@/lib/repositories/PaymentRepository';

const logger = createLogger({ module: 'BusinessOsSetupStanceRead' });

export type SetupStance = {
  /**
   * Somebody has been added as a client, or money has moved.
   *
   * `true` also stands for "we could not tell", on purpose: see guarantee 1.
   */
  hasArrived: boolean;
};

export async function readSetupStance(): Promise<SetupStance> {
  try {
    const user = await getUser();
    if (!user?.id) return { hasArrived: true };

    /*
     * TWO READS, NOT THREE. Bookings are not counted separately: a booking
     * always attaches a contact, so an account with bookings has contacts, and
     * `SchedulingRepository.countBookings` counts one SERVICE's bookings
     * rather than the account's.
     */
    const [contacts, payments] = await Promise.all([
      crmContactRepository.count(user.id).catch(() => null),
      paymentTransactionRepository.count(user.id).catch(() => null),
    ]);

    const found = (result: unknown): number | null => {
      if (typeof result === 'number') return result;
      if (result && typeof result === 'object' && 'data' in result) {
        const value = (result as { data: unknown }).data;
        return typeof value === 'number' ? value : null;
      }
      return null;
    };

    const counts = [found(contacts), found(payments)];

    /* A read that could not answer is not evidence of an empty business, so an
       unreadable count cannot by itself say "nobody has arrived". */
    if (counts.every(count => count === null)) return { hasArrived: true };

    return { hasArrived: counts.some(count => (count ?? 0) > 0) };
  } catch (err) {
    logger.warn({ err }, 'Could not read whether anybody has arrived; showing every tab');
    return { hasArrived: true };
  }
}

/**
 * Turning an unsubscribe link into a withdrawal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE MIRROR OF `confirmConsent`, AND DELIBERATELY LESS CAREFUL THAN IT.
 *
 * Confirming has a human-click check, because a mail scanner prefetching a link
 * must never subscribe somebody who did not act. Withdrawing has none. If a
 * gateway prefetches this link and takes a person off a marketing list they
 * never wanted, nothing is harmed — whereas making somebody click twice to
 * leave, so that a scanner cannot, gets the risk exactly backwards.
 *
 * Reaching this function IS the withdrawal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE WRITE, BECAUSE THE DATABASE DOES THE REST.
 *
 * `marketing_consent_events` is append-only evidence, and the trigger
 * `trg_mce_project` (20260930_marketing_consent.sql) projects the latest
 * decision onto `marketing_consent_state`. `marketingGate` reads that state
 * before every marketing send, so recording the event is the whole of stopping
 * the email. Nothing here writes the state, and nothing needs a second
 * suppression list.
 *
 * The roster is nudged alongside, exactly as the CRM drawer's withdrawal does:
 * a `business_subscribers` row saying `confirmed` beside a consent saying
 * `withdrawn` is a disagreement nothing later reconciles.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { businessSubscriberRepository } from '@/lib/repositories/BusinessSubscriberRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { verifyUnsubscribeToken } from '@/lib/consent/unsubscribeToken';

const logger = createLogger({ module: 'Consent', service: 'Withdraw' });

export type WithdrawOutcome =
  | { ok: true; alreadyOff: boolean; businessName: string | null; email: string }
  | { ok: false; reason: 'invalid' | 'failed' };

export interface WithdrawEvidence {
  /** `unsubscribe_link` for a person clicking, `list_unsubscribe` for one-click. */
  via: 'unsubscribe_link' | 'list_unsubscribe';
  ipHash?: string | null;
  userAgent?: string | null;
}

export async function withdrawConsent(
  token: string,
  evidence: WithdrawEvidence
): Promise<WithdrawOutcome> {
  const payload = verifyUnsubscribeToken(token);
  if (!payload) return { ok: false, reason: 'invalid' };

  const { userId, email, contactId } = payload;
  const log = logger.child({ userId, via: evidence.via });

  try {
    const [{ data: profile }, { data: existing }] = await Promise.all([
      businessProfileRepository.findByUserId(userId),
      marketingConsentRepository.getState(userId, email),
    ]);

    const businessName = profile?.company_name ?? null;

    /*
     * Already off: write nothing and still answer "you are unsubscribed",
     * because that is the true answer. People press it twice, forward the
     * email, open it on a phone and then a laptop, and a second identical
     * event would only clutter the evidence trail this table exists to keep
     * readable.
     */
    if (existing?.consented === false) {
      return { ok: true, alreadyOff: true, businessName, email };
    }

    const recorded = await marketingConsentRepository.record({
      userId,
      email,
      contactId: contactId ?? null,
      decision: 'withdrawn',
      /* Both values have been in the enum since the table was designed: one for
         a person clicking, one for the mail client doing it on their behalf. */
      method: evidence.via,
      sourceSurface: 'email',
      ipHash: evidence.ipHash ?? null,
      userAgent: evidence.userAgent ?? null,
      evidence: { via: evidence.via },
    });

    if (recorded.error) {
      log.error({ err: recorded.error }, 'Could not record the withdrawal');
      return { ok: false, reason: 'failed' };
    }

    /* No-ops for anybody with no roster row, which is most contacts. */
    void businessSubscriberRepository.markUnsubscribed(userId, email);

    log.info('Unsubscribed');
    return { ok: true, alreadyOff: false, businessName, email };
  } catch (error) {
    log.error({ err: error }, 'Unsubscribe failed');
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Turning a confirmation link into a consent record.
 *
 * Shared by the two ways somebody can arrive at it: a real click on the link in
 * the email, which confirms on the spot, and the button shown to anything that
 * does not look like a real click. Both end here so the record written is
 * identical either way.
 *
 * @module lib/consent/confirmConsent
 */

import { verifyConsentConfirmToken } from '@/lib/consent/confirmToken';
import { resolveStatement } from '@/lib/consent/defaultStatements';
import { resolvePrivacyPolicyUrl } from '@/lib/consent/privacyPolicyUrl';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { businessSubscriberRepository } from '@/lib/repositories/BusinessSubscriberRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ConfirmConsent' });

export type ConfirmOutcome =
  | { ok: true; alreadyConfirmed: boolean }
  | { ok: false; reason: 'expired' | 'invalid' | 'capture_disabled' | 'failed' };

export interface ConfirmEvidence {
  ipHash?: string | null;
  userAgent?: string | null;
  /** How we decided this was a person: 'email_link' or 'confirm_button'. */
  via: 'email_link' | 'confirm_button';
}

export async function confirmConsent(
  token: string,
  evidence: ConfirmEvidence
): Promise<ConfirmOutcome> {
  const verdict = verifyConsentConfirmToken(token);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };

  const { u: userId, e: email, c: contactId, s: surface, l: locale } = verdict.payload;

  try {
    const [{ data: profile }, { data: settings }] = await Promise.all([
      businessProfileRepository.findByUserId(userId),
      marketingConsentRepository.settings(userId),
    ]);

    if (settings && settings.capture_enabled === false) {
      return { ok: false, reason: 'capture_disabled' };
    }

    /*
     * Already confirmed? Say so and write nothing.
     *
     * A second arrival is normal: people forward the email, press back, open it
     * on a phone and then a laptop. Appending another identical grant would
     * clutter the evidence trail this table exists to keep readable.
     */
    const { data: existing } = await marketingConsentRepository.getState(userId, email);
    if (existing?.consented) {
      /*
       * Keep the roster in step even on a repeat click. A row that says
       * `pending` next to a consent that says `granted` is the kind of
       * disagreement nothing later would reconcile, because nothing writes
       * this table again.
       */
      void businessSubscriberRepository.markConfirmed(userId, email);
      return { ok: true, alreadyConfirmed: true };
    }

    // The server's current wording wins, exactly as it does on the forms.
    const statement = resolveStatement({
      locale,
      businessName: profile?.company_name || 'this business',
      tenantStatements: settings,
    });

    const privacyPolicyUrl = await resolvePrivacyPolicyUrl(userId, settings, profile);

    const { error } = await marketingConsentRepository.record({
      userId,
      contactId: contactId ?? null,
      email,
      decision: 'granted',
      // The distinguishing fact about this record: it was confirmed from the
      // address itself, not merely typed into a form by somebody.
      method: 'double_optin_confirm',
      statementText: statement.text,
      statementLocale: statement.locale,
      statementVersion: statement.version,
      privacyPolicyUrl,
      sourceSurface: surface,
      ipHash: evidence.ipHash ?? null,
      ipHashSalt: evidence.ipHash ? new Date().toDateString() : null,
      userAgent: evidence.userAgent ?? null,
      evidence: { confirmed_via: evidence.via },
    });

    if (error) throw error;

    /*
     * The roster follows the consent, not the other way round. Non-blocking:
     * the consent record is what governs sending, and a failure here leaves a
     * subscriber looking `pending` in the tab while being correctly mailable.
     * No-ops for somebody who was already a contact, who has no roster row.
     */
    void businessSubscriberRepository.markConfirmed(userId, email);

    logger.info({ userId, surface, via: evidence.via }, 'Marketing consent confirmed');
    return { ok: true, alreadyConfirmed: false };
  } catch (err) {
    logger.error({ err, userId }, 'Failed to confirm consent');
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Did a PERSON click this link, or did a machine fetch it?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Confirming on arrival is the right experience — one click, the way every
 * mailing list works, rather than a link that opens a page with another button
 * on it. The cost is that corporate mail gateways, Outlook Safe Links and some
 * antivirus fetch every URL in an email before the recipient ever sees it. A
 * link that confirms on arrival would let one of those subscribe somebody who
 * never clicked anything, which is the precise failure double opt-in exists to
 * prevent.
 *
 * `Sec-Fetch-User: ?1` is the discriminator. Browsers send it ONLY on a
 * navigation the user actually triggered — a click, not a prefetch, not a
 * scan, not a redirect chain. Paired with `Sec-Fetch-Dest: document` it says
 * "a person clicked a link and is looking at the result".
 *
 * A machine that forges these headers could still get through. That is fine:
 * the threat here is well-behaved corporate scanners, not an adversary, and an
 * adversary who wants a false consent record has easier routes than spoofing
 * fetch metadata.
 *
 * WHAT HAPPENS WHEN IT SAYS NO: the page renders a button. Nothing is lost —
 * an old browser that sends no `Sec-Fetch-*` headers gets one extra click, and
 * a scanner gets a page it cannot press. Degrading to the safe side costs a
 * click; degrading the other way costs a consent record that is a lie.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function looksLikeHumanClick(headers: {
  get(name: string): string | null;
}): boolean {
  return (
    headers.get('sec-fetch-user') === '?1' && headers.get('sec-fetch-dest') === 'document'
  );
}

/**
 * The one check between a marketing email and a recipient.
 *
 * Called from `sendEmail` before any transport is touched. Everything else in
 * that file is best-effort by design — a failed lookup falls back, a missing
 * config degrades — and this is the deliberate exception: **it fails closed.**
 * A consent lookup that errors blocks the send. An email that was not sent is
 * recoverable; one sent to someone who never agreed is not.
 *
 * What this gate does NOT cover
 * ─────────────────────────────
 * `lib/server/gmail-plugin-executor.ts` and `outlook-plugin-executor.ts` send
 * through the user's own OAuth mailbox, entirely outside `emailTransport.ts`.
 * An agent wired to "email all my contacts" through the Gmail plugin bypasses
 * every line of this file. The current position is that the owner is the
 * controller of their own mailbox and the platform is not the sender there.
 * That is a policy boundary, not a technical one, and it is written down here
 * so nobody later mistakes this gate for total coverage.
 *
 * @module lib/consent/marketingGate
 */

import {
  MarketingConsentRepository,
  marketingConsentRepository,
  type MarketingConsentSettings,
} from '@/lib/repositories/MarketingConsentRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'MarketingGate' });

export type MarketingBlockReason =
  | 'sending_not_enabled'
  | 'no_consent'
  | 'no_postal_address'
  /* Not asked, and no sale or enquiry behind the address — so soft opt-in has
     nothing to stand on and this is a stranger. */
  | 'no_relationship'
  | 'consent_lookup_failed'
  /* The footer could not be built, so the message would have gone out with no
     way off it. Refused by `sendEmail` AFTER this gate passes — the gate asks
     whether we MAY send, this one whether we CAN do it properly. */
  | 'no_unsubscribe';

/**
 * Marketing sending, and the three obligations it waited for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This was `false` from the day consent capture shipped, and the comment here
 * named what had to exist first: an unsubscribe link in the body, a
 * `List-Unsubscribe` header, and a postal address in the footer. Consent was
 * collected in the meantime because it cannot be collected retroactively — a
 * re-permission email is itself a marketing email to someone who never agreed.
 *
 * All three now exist, and none of them is a template's responsibility:
 *
 *   the link      `sendEmail` derives it per recipient from a signed token and
 *                 appends `buildMarketingFooter` to the body. A marketing send
 *                 whose footer cannot be built is REFUSED, not degraded.
 *   the header    `unsubscribeHeaders` sets `List-Unsubscribe`, and declares
 *                 one-click only for `/api/unsubscribe`, which implements it.
 *   the address   printed in that same footer, from
 *                 `marketing_consent_settings.postal_address` — which this gate
 *                 already refuses to send without.
 *
 * And the way off is real: `/consent/unsubscribe/[token]` records a withdrawal
 * through `marketingConsentRepository`, the `trg_mce_project` trigger projects
 * it onto `marketing_consent_state`, and the `no_consent` check below is what
 * then stops every future send. The loop closes.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MARKETING_SENDING_ENABLED = true;

/**
 * What made this send lawful, when one did.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Recorded rather than assumed, because the two are defended differently if
 * anybody ever asks:
 *
 *   consent       they ticked a box. The event, its wording and its date are
 *                 in `marketing_consent_events`.
 *   soft_opt_in   they did not tick, and did not refuse either. The address
 *                 came from a sale or from negotiating one, the message is
 *                 about the same kind of work, and a refusal was offered then
 *                 and in every message since.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type MarketingBasis = 'consent' | 'soft_opt_in';

export interface MarketingGateVerdict {
  allowed: boolean;
  reason?: MarketingBlockReason;
  basis?: MarketingBasis;
}

/**
 * What the CALLER is claiming about this particular message.
 *
 * `softOptIn` is not a way round consent and cannot be used to reach a
 * stranger: the gate verifies the relationship itself rather than taking the
 * caller's word, and a recorded refusal still refuses. It is the caller
 * asserting the OTHER half, which only it knows — that this message is about
 * the same kind of work the person came for.
 */
export interface MarketingIntent {
  softOptIn?: boolean;
}

/**
 * Settings are read once per gate instance rather than once per recipient: a
 * fan-out of a hundred asks the same tenant question a hundred times otherwise.
 */
export class MarketingGate {
  private settingsCache = new Map<
    string,
    { value: MarketingConsentSettings | null; at: number }
  >();

  /**
   * Long enough to collapse a fan-out into one read, short enough that an owner
   * who has just filled in their postal address is not told for an hour that
   * they still have not.
   */
  private static readonly SETTINGS_TTL_MS = 60_000;

  constructor(private repo: MarketingConsentRepository = marketingConsentRepository) {}

  async check(
    ownerUserId: string,
    email: string,
    intent: MarketingIntent = {}
  ): Promise<MarketingGateVerdict> {
    if (!MARKETING_SENDING_ENABLED) {
      return { allowed: false, reason: 'sending_not_enabled' };
    }

    const { data: state, error } = await this.repo.getState(ownerUserId, email);
    if (error) {
      // Fail closed. See the module note.
      logger.error(
        { err: error, ownerUserId },
        'Consent lookup failed — refusing the marketing send'
      );
      return { allowed: false, reason: 'consent_lookup_failed' };
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THREE STATES, NOT TWO. REFUSED IS NOT THE SAME AS NOT ASKED.
     *
     * `recordConsent` is careful about this and the comment there says why: an
     * untouched box is not a decision, because recording one would silently
     * unsubscribe somebody who agreed on an earlier form. So the data holds
     * `granted`, `withdrawn`, and nothing at all — and this read `!consented`,
     * which collapsed the last two into a refusal.
     *
     *   withdrawn     never, whatever the caller claims. Absolute.
     *   granted       send; the basis is their consent.
     *   no decision   send ONLY under soft opt-in, and only when the caller
     *                 says the message is about the same kind of work AND the
     *                 relationship below is real.
     *
     * Soft opt-in is ePrivacy Art 13(2) / PECR reg 22(3), and the
     * existing-customer exception in Israel's Amendment 40: an address taken
     * in the course of a sale or in negotiating one may be written to about
     * the sender's own similar services, provided a refusal was offered at
     * collection and in every message since. Both of those are now true —
     * `sendEmail` puts the unsubscribe link and the postal address in every
     * marketing message, and the booking form shows the box.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const refused = state?.consented === false;
    const granted = state?.consented === true;

    if (refused) {
      return { allowed: false, reason: 'no_consent' };
    }

    if (!granted) {
      if (!intent.softOptIn) {
        return { allowed: false, reason: 'no_consent' };
      }

      /*
       * The relationship, checked HERE rather than trusted. A caller that
       * could assert its way past this would make the flag a hole rather than
       * a basis.
       */
      const known = await this.hasRelationship(ownerUserId, email);

      if (known === undefined) {
        return { allowed: false, reason: 'consent_lookup_failed' };
      }

      if (!known) {
        return { allowed: false, reason: 'no_relationship' };
      }
    }

    const settings = await this.settingsFor(ownerUserId);
    if (settings === undefined) {
      return { allowed: false, reason: 'consent_lookup_failed' };
    }

    // CAN-SPAM requires a physical postal address in every commercial message,
    // and consent does not substitute for it.
    if (!settings?.postal_address?.trim()) {
      return { allowed: false, reason: 'no_postal_address' };
    }

    return { allowed: true, basis: granted ? 'consent' : 'soft_opt_in' };
  }

  /**
   * Did this address come from a sale, or from negotiating one?
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A booking is a sale. An enquiry is negotiating one — the person wrote in
   * asking about the work, which is what the exception is written around.
   *
   * Keyed on the ADDRESS and not on a contact id, like consent itself: a person
   * may exist on several contact rows or on none, and what the exception asks
   * about is the address the business obtained.
   *
   * `undefined` means the read failed, which the caller turns into a refusal.
   * A lookup that cannot confirm the relationship must never be read as
   * confirming it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  private async hasRelationship(
    ownerUserId: string,
    email: string
  ): Promise<boolean | undefined> {
    try {
      const { supabaseServer } = await import('@/lib/supabaseServer');
      const { emailLikePattern } = await import('@/lib/utils/emailMatch');

      const { data: contacts, error } = await supabaseServer
        .from('crm_contacts')
        .select('id')
        .eq('user_id', ownerUserId)
        .ilike('email', emailLikePattern(email))
        .limit(5);

      if (error) throw error;
      if (!contacts?.length) return false;

      /* A contact row alone is not enough: an address typed into a notebook and
         imported is not an address obtained in the course of a sale. Something
         has to have happened. */
      const ids = contacts.map(c => c.id);

      const [{ count: bookings }, { count: enquiries }] = await Promise.all([
        supabaseServer
          .from('scheduling_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', ownerUserId)
          .in('contact_id', ids),
        supabaseServer
          .from('crm_activities')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', ownerUserId)
          .in('contact_id', ids)
          .in('activity_type', ['enquiry_received', 'quote_request', 'form_submission']),
      ]);

      return (bookings ?? 0) > 0 || (enquiries ?? 0) > 0;
    } catch (err) {
      logger.error({ err, ownerUserId }, 'Relationship lookup failed — refusing the send');
      return undefined;
    }
  }

  /** `undefined` means the read failed; `null` means the tenant has no row. */
  private async settingsFor(
    ownerUserId: string
  ): Promise<MarketingConsentSettings | null | undefined> {
    const cached = this.settingsCache.get(ownerUserId);
    if (cached && Date.now() - cached.at < MarketingGate.SETTINGS_TTL_MS) {
      return cached.value;
    }

    const { data, error } = await this.repo.settings(ownerUserId);
    if (error) {
      logger.error({ err: error, ownerUserId }, 'Consent settings lookup failed');
      return undefined;
    }

    this.settingsCache.set(ownerUserId, { value: data, at: Date.now() });
    return data;
  }
}

/**
 * The shared instance `sendEmail` uses.
 *
 * Its settings cache is per process and short-lived, so a fan-out asks the
 * tenant question once while an owner who has just filled in their postal
 * address is not told for long that they still have not. The failure mode of a
 * stale entry here is refusing to send, never sending something it should not.
 */
export const marketingGate = new MarketingGate();

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
  | 'consent_lookup_failed';

/**
 * Marketing sending is off at the platform level until the send-time
 * obligations exist: an unsubscribe link in the body, a `List-Unsubscribe`
 * header, and a postal address in the footer.
 *
 * Consent is being COLLECTED now because it cannot be collected retroactively —
 * a re-permission email is itself a marketing email to someone who never
 * agreed. Sending is a separate, later switch, and this is it. Flip to `true`
 * only when unsubscribe support is live.
 */
export const MARKETING_SENDING_ENABLED = false;

export interface MarketingGateVerdict {
  allowed: boolean;
  reason?: MarketingBlockReason;
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

  async check(ownerUserId: string, email: string): Promise<MarketingGateVerdict> {
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

    // No row means no decision was ever recorded, which is a no.
    if (!state?.consented) {
      return { allowed: false, reason: 'no_consent' };
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

    return { allowed: true };
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

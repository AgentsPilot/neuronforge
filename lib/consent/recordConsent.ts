/**
 * Turn "the visitor ticked the box" into evidence.
 *
 * Called from every public capture route after the contact row exists.
 * Non-blocking by construction: a failure here loses a consent record, never a
 * booking. The caller must not await it in a way that can fail the request —
 * see the `.catch` pattern each route uses for its activity insert.
 *
 * Two decisions worth knowing about:
 *
 * THE SERVER'S WORDING WINS. The form echoes back the sentence it displayed,
 * and that echo is kept under `evidence.client_statement`. What gets recorded
 * as `statement_text` is the tenant's CURRENT wording, resolved here. A visitor
 * on a cached page showing last month's sentence would otherwise be recorded as
 * having agreed to this month's — so the two are compared and a mismatch is
 * logged rather than silently resolved.
 *
 * THE IP SALT IS STORED. `hashIP` salts with the calendar day, which is right
 * for the unique-visitor counting it was written for and useless as evidence:
 * the same address hashes differently tomorrow, so the stored hash cannot be
 * reproduced or checked. Recording the salt alongside makes it verifiable. A
 * raw IP would be better evidence and worse privacy; this is the middle.
 *
 * @module lib/consent/recordConsent
 */

import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { resolveStatement } from '@/lib/consent/defaultStatements';
import { resolvePrivacyPolicyUrl } from '@/lib/consent/privacyPolicyUrl';
import type { ConsentInput } from '@/lib/validation/consent';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'RecordConsent' });

export interface RecordConsentParams {
  userId: string;
  contactId: string | null;
  email: string;
  consent: ConsentInput;
  /** Which form this came from: 'website_form', 'newsletter', 'booking', … */
  sourceSurface: string;
  sourcePageUrl?: string | null;
  /** Straight from `buildAttributionFromRequest`, which every route already calls. */
  attribution?: {
    ip_hash?: string;
    user_agent?: string | null;
    session_id?: string;
  } | null;
  /** The locale the form was rendered in. */
  locale?: string;
}

export async function recordConsent(params: RecordConsentParams): Promise<void> {
  const { consent } = params;

  /*
   * An untouched box is not a decision.
   *
   * Recording `withdrawn` for someone who simply did not tick would overwrite a
   * consent they gave on a previous form — a person who subscribed last month
   * and books an appointment today would be silently unsubscribed by the
   * booking. Only an explicit tick, or an explicit unsubscribe elsewhere, moves
   * the record.
   */
  if (!consent?.granted) return;

  const email = params.email?.trim();
  if (!email) return;

  try {
    const { data: profile } = await businessProfileRepository.findByUserId(params.userId);
    const { data: settings } = await marketingConsentRepository.settings(params.userId);

    // Capture switched off means this business does not do marketing email.
    // A tick arriving anyway is a stale page, and honouring it would record
    // consent under wording they have withdrawn from their own forms.
    if (settings && settings.capture_enabled === false) {
      logger.warn(
        { userId: params.userId, surface: params.sourceSurface },
        'Consent submitted while capture is disabled — ignored'
      );
      return;
    }

    const statement = resolveStatement({
      locale: params.locale || consent.statement_locale || 'en',
      businessName: profile?.company_name || 'this business',
      tenantStatements: settings,
    });

    const privacyPolicyUrl = await resolvePrivacyPolicyUrl(params.userId, settings, profile);

    const clientStatement = consent.statement_text?.trim();
    if (clientStatement && clientStatement !== statement.text) {
      // Not an error: a page cached before the wording changed. Worth seeing,
      // because a lot of these means the wording is changing faster than pages
      // are being re-fetched.
      logger.warn(
        { userId: params.userId, surface: params.sourceSurface },
        'Consent was given against wording that is no longer current'
      );
    }

    const { error } = await marketingConsentRepository.record({
      userId: params.userId,
      contactId: params.contactId,
      email,
      decision: 'granted',
      method: 'web_form',
      statementText: statement.text,
      statementLocale: statement.locale,
      statementVersion: statement.version,
      privacyPolicyUrl,
      sourceSurface: params.sourceSurface,
      sourcePageUrl: params.sourcePageUrl ?? null,
      ipHash: params.attribution?.ip_hash ?? null,
      // See the module note: the hash is unverifiable without it.
      ipHashSalt: params.attribution?.ip_hash ? new Date().toDateString() : null,
      userAgent: params.attribution?.user_agent ?? null,
      sessionId: params.attribution?.session_id ?? null,
      evidence: clientStatement ? { client_statement: clientStatement } : {},
    });

    if (error) throw error;
  } catch (err) {
    logger.error(
      { err, userId: params.userId, surface: params.sourceSurface },
      'Failed to record consent'
    );
  }
}

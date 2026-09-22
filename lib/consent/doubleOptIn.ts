/**
 * Double opt-in: asking the address whether it really signed up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONLY THE NEWSLETTER SURFACES USE THIS
 *
 * Every other public form proves the address as a side effect of what it does.
 * Book an appointment and the confirmation has to arrive; request a quote and
 * the quote has to arrive; pay and the receipt has to arrive. A mistyped or
 * borrowed address fails visibly, immediately, and the person notices.
 *
 * A newsletter box has no such step. One field, one button, a thank-you
 * message, and nothing ever has to reach anybody. It is the only surface where
 * "this address agreed" rests entirely on somebody having typed it — which
 * means anyone can subscribe anyone, and the record we would keep of it would
 * be confidently wrong.
 *
 * Putting this in front of BOOKING would be the mistake in the other
 * direction: a confirmation email between a client and their appointment, to
 * verify something the appointment already verifies.
 *
 * NOTHING IS RECORDED HERE
 *
 * This function writes no consent event. That is the entire point: until the
 * link is clicked there is no consent, and `marketing_consent_state` has no row
 * for the address, which the send gate reads as "no". Absence is the pending
 * state, so no third value has to exist anywhere.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/consent/doubleOptIn
 */

import { resolveEmailBranding } from '@/lib/email/branding';
import { generateConsentConfirmationEmail } from '@/lib/email/templates/consent-confirmation';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import { marketingConsentRepository } from '@/lib/repositories/MarketingConsentRepository';
import { resolveStatement } from '@/lib/consent/defaultStatements';
import { signConsentConfirmToken } from '@/lib/consent/confirmToken';
import { createLogger } from '@/lib/logger';
import type { Locale } from '@/lib/i18n/config';

const logger = createLogger({ module: 'DoubleOptIn' });

/*
 * There is no `requiresDoubleOptIn` helper any more, deliberately.
 *
 * It answered "does this surface need confirming?" from a set containing one
 * value, while the contact endpoint decided whether to call it. That decision is
 * now structural: newsletter signups have their own endpoint and it always
 * confirms; every other form records consent directly. A predicate that can only
 * return true for the one caller that no longer exists is indirection with
 * nothing behind it.
 */

export interface BeginDoubleOptInParams {
  userId: string;
  contactId: string | null;
  email: string;
  sourceSurface: string;
  locale?: string;
}

/**
 * Send the confirmation. Never throws: a signup must not fail because a mail
 * provider is slow, and the person is already in the CRM either way.
 */
export async function beginDoubleOptIn(params: BeginDoubleOptInParams): Promise<void> {
  const email = params.email?.trim();
  if (!email) return;

  try {
    const [{ data: profile }, { data: settings }] = await Promise.all([
      businessProfileRepository.findByUserId(params.userId),
      marketingConsentRepository.settings(params.userId),
    ]);

    // A business that does not collect marketing consent should not be asking
    // anybody to confirm one.
    if (settings && settings.capture_enabled === false) return;

    const locale = (params.locale || profile?.language || 'en') as Locale;

    const statement = resolveStatement({
      locale,
      businessName: profile?.company_name || 'this business',
      tenantStatements: settings,
    });

    const token = signConsentConfirmToken({
      u: params.userId,
      e: email,
      c: params.contactId,
      s: params.sourceSurface,
      l: statement.locale,
    });

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const confirmUrl = `${appUrl}/consent/confirm/${token}`;

    const branding = await resolveEmailBranding(params.userId, locale, profile);

    const { subject, html } = generateConsentConfirmationEmail({
      businessName: branding.businessName,
      statementText: statement.text,
      confirmUrl,
      branding,
      locale,
    });

    /*
     * TRANSACTIONAL, and correctly so. It carries no offer, it was triggered by
     * the recipient's own submission seconds earlier, and its only content is a
     * question about that submission. This is also what lets it go out while
     * marketing sending is disabled — which it must, or double opt-in could
     * never be completed and the feature would be self-defeating.
     */
    const result = await sendEmail({
      kind: 'transactional',
      to: [email],
      subject,
      html,
      ownerUserId: params.userId,
    });

    if (!result.sent) {
      logger.warn(
        { userId: params.userId, surface: params.sourceSurface, error: result.error },
        'Consent confirmation could not be sent'
      );
    }
  } catch (err) {
    logger.error(
      { err, userId: params.userId, surface: params.sourceSurface },
      'Failed to start double opt-in'
    );
  }
}

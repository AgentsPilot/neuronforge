import { generateBookingCancellationEmail } from '../templates/booking-confirmation';
import { emailTranslations } from '../templates/translations';
import type { BrandingData } from '../branding';
import { locales } from '@/lib/i18n/config';

/*
 * The cancellation a client gets when the BUSINESS is closing, sent while the
 * account is being deleted.
 *
 * It is the one message in a deletion that reaches somebody who did not ask for
 * any of this, and it goes out at the exact moment nobody is left to notice it
 * was wrong — so what it says is worth pinning down.
 */

const BRANDING: BrandingData = {
  businessName: 'Studio Levi',
  primaryColor: '#2563EB',
  secondaryColor: '#1E40AF',
  logoUrl: undefined,
};

const closedReason = emailTranslations.bookingCancellation.closedReason;

function render(locale: 'en' | 'es' | 'he') {
  return generateBookingCancellationEmail({
    clientName: 'Dana Levi',
    serviceName: 'Initial consultation',
    dateTime: new Date('2026-10-01T09:00:00Z'),
    timezone: 'UTC',
    reason: closedReason[locale],
    // What `cancelFutureBookingsForClosure` passes: no rebooking invitation.
    bookAgainUrl: undefined,
    branding: BRANDING,
    locale,
  });
}

describe('the cancellation sent when a business closes', () => {
  it('is written in every language the platform speaks', () => {
    // A missing locale would fall through to `undefined` and drop the reason
    // row entirely — the client would be told their appointment was cancelled
    // with no explanation at all.
    for (const locale of locales) {
      expect(typeof closedReason[locale]).toBe('string');
      expect(closedReason[locale].length).toBeGreaterThan(20);
    }
  });

  it('never invites the client to book again', () => {
    /*
     * "Book Again" contradicts an email saying the business has ceased
     * operating, and points at a page that stops existing seconds later.
     * Suppressed by passing no url — see `offerRebooking` in
     * BookingEmailService.
     */
    for (const locale of locales) {
      const { html } = render(locale);
      expect(html).not.toContain(emailTranslations.bookingCancellation.bookAgain[locale]);
      expect(html).not.toContain(emailTranslations.bookingCancellation.bookAgainPrompt[locale]);
    }
  });

  it('carries the closure reason into the email body', () => {
    for (const locale of locales) {
      const { html } = render(locale);
      expect(html).toContain(closedReason[locale]);
    }
  });

  it('still points the client at the owner', () => {
    // The whole message is "we are gone, ask the owner" — the second half is
    // useless without the business name.
    for (const locale of locales) {
      const { html } = render(locale);
      expect(html).toContain(
        emailTranslations.bookingCancellation.questions[locale](BRANDING.businessName)
      );
    }
  });
});

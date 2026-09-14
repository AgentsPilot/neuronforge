/**
 * The invitation a lead receives.
 *
 * The load-bearing case is the verb: a quoted service cannot be bought, so
 * telling that client to "book and pay" sends them to a page that will not let
 * them — the business looking broken at the moment it was trying to look
 * organised.
 */

import { generateBookingInviteEmail } from '../templates/booking-invite';
import type { BrandingData } from '../templates/base-template';

const branding: BrandingData = {
  businessName: 'Test Practice',
  primaryColor: '#4F46E5',
  secondaryColor: '#818CF8',
};

const base = {
  businessName: 'Test Practice',
  bookingUrl: 'https://app.example.com/c/abc123/book',
  branding,
};

describe('the booking invitation', () => {
  it('asks them to book when the work can be bought', () => {
    const { subject, html } = generateBookingInviteEmail({ ...base, clientName: 'Dana Levi' });
    expect(subject).toContain('Book a time');
    expect(html).toContain('Book a time');
    expect(html).not.toContain('quote');
  });

  it('asks for a quote when the journey ends at a request', () => {
    const { subject, html } = generateBookingInviteEmail({ ...base, isQuote: true });
    expect(subject).toContain('Request a quote');
    expect(html).toContain('Request a quote');
    // Promising a booking here would land them on a page that refuses.
    expect(html).not.toContain('pick a time that suits you');
  });

  it('greets by first name only, so it does not read as a form letter', () => {
    const { html } = generateBookingInviteEmail({ ...base, clientName: 'Dana Levi' });
    expect(html).toContain('Hi Dana,');
    expect(html).not.toContain('Hi Dana Levi,');
  });

  it('greets without a name rather than leaving a gap', () => {
    const { html } = generateBookingInviteEmail({ ...base, clientName: null });
    expect(html).toContain('Hi,');
  });

  it('adds one line for the chase and otherwise says the same thing', () => {
    const first = generateBookingInviteEmail({ ...base });
    const chase = generateBookingInviteEmail({ ...base, reminder: true });

    expect(chase.html).toContain('Just in case it got buried');
    expect(first.html).not.toContain('Just in case it got buried');
    // Same subject: a follow-up that looks like a different email invites the
    // reader to compare them and notice they are being processed.
    expect(chase.subject).toBe(first.subject);
  });

  it('escapes a name typed into a public form', () => {
    const { html } = generateBookingInviteEmail({
      ...base,
      clientName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>');
  });

  it('carries the link it was asked to carry', () => {
    const withService = generateBookingInviteEmail({
      ...base,
      bookingUrl: 'https://app.example.com/c/abc123/book?service=xyz',
      serviceName: 'Intro call',
    });
    expect(withService.html).toContain('service=xyz');
    expect(withService.html).toContain('Intro call');
  });

  it('renders right-to-left in Hebrew', () => {
    const { html } = generateBookingInviteEmail({ ...base, locale: 'he' });
    expect(html).toContain('dir="rtl"');
  });
});

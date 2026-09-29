/**
 * What an email must look like when the website looks like something.
 *
 * Emails share the business's FLAVOUR — its colours, its faces, its radius —
 * but never its composition: email HTML is tables and inline styles, so Stone's
 * ruled rows and Bold's mono cannot render there. Sharing the flavour is the
 * most an email can do, and it is the whole of what makes a receipt look like
 * it came from the same business as the site that sent it.
 *
 * The regression these exist for: `resolveEmailBranding` read the profile's
 * stored theme verbatim. The design tab saves only the two colours and two
 * faces it edits, so one Save left a business on Lumen with a profile theme
 * carrying no ground and no radius — and every email silently went white while
 * the website stayed near-black.
 */

import { completeTheme } from '@/lib/branding/theme';
import { wrapInBrandedTemplate, type BrandingData } from '../templates/base-template';
import {
  generateBookingConfirmationEmail,
  generateBookingCancellationEmail,
  generateBookingRescheduledEmail,
  generateMissedAppointmentEmail,
} from '../templates/booking-confirmation';
import { generateWelcomeEmail, generateReturningContactEmail } from '../templates/welcome-email';
import { generateInvoiceEmail } from '../templates/invoice';
import { generateIntakeRequestEmail } from '../templates/intake-request';
import { generateIntakeReceivedEmail } from '../templates/intake-received';
import { generatePaymentReceiptEmail } from '../templates/payment-receipt';
import { generateRefundConfirmationEmail } from '../templates/refund-confirmation';
import { generateProposalEmail } from '../templates/proposal';
import { generateDailyBriefingEmail } from '../templates/daily-briefing';
import { generateNewEnquiryEmail } from '../templates/new-enquiry';
import { generateBookingInviteEmail } from '../templates/booking-invite';
import { generateConsentConfirmationEmail } from '../templates/consent-confirmation';
import {
  generateChaseInvoiceEmail,
  generateFollowupNudgeEmail,
  generateBookingReminderEmail,
} from '../templates/insight-actions';
import { generateMeetingReminderEmail, generateOwnerMeetingReminderEmail } from '../templates/meeting-reminder';

/** What the design tab writes to `business_profiles.theme` after a Save. */
const AFTER_DESIGN_TAB_SAVE = {
  colors: { primary: '#FF0000', secondary: '#00FF00' },
  fonts: { heading: 'Georgia', body: 'Georgia' },
};

describe('a business whose profile theme is partial', () => {
  it('still resolves its template\'s ground and radius', () => {
    const theme = completeTheme(AFTER_DESIGN_TAB_SAVE, 'lumen');

    // Lumen's own, not the platform's white/8px.
    expect(theme.colors.background).toBe('#141414');
    expect(theme.borderRadius).toBe('30px');

    // And the owner's edits survive.
    expect(theme.colors.primary).toBe('#FF0000');
    expect(theme.fonts.heading).toBe('Georgia');
  });

  it('resolves a dark template as dark, which is what the email inherits', () => {
    expect(completeTheme(AFTER_DESIGN_TAB_SAVE, 'bold').colors.background).toBe('#141416');
    expect(completeTheme(AFTER_DESIGN_TAB_SAVE, 'warm').colors.background).toBe('#FBF7F1');
  });
});

describe('a business that has chosen nothing', () => {
  /*
   * The behaviour the old `raw` read was protecting, kept deliberately: an
   * account with no look sends exactly the email it always sent. It survives
   * because the platform default and the email default are the same two
   * colours — `#4F46E5` and `#818CF8`.
   */
  it('falls back to the colours emails have always used', () => {
    const theme = completeTheme(null, null);
    expect(theme.colors.primary).toBe('#4F46E5');
    expect(theme.colors.secondary).toBe('#818CF8');
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Business emails after the platform-email fix (invite-only signup Slice 3a,
 * T-3a-4 and T-3a-5; SA Q-7, R-9).
 *
 * Every email the wrapper produces loses its developer comments, business ones
 * included, and keeps the Outlook conditional. A business's emails keep the
 * business's own logo or name, in the markup they always had, and never get
 * the AgentPilot wordmark, even with NEXT_PUBLIC_APP_URL set to an https origin
 * (the state in which the platform emails do carry it).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BUSINESS = 'Night Practice';
const BUSINESS_LOGO = 'https://cdn.example.com/night-practice/logo.png';
const MSO_BLOCK = /<!--\[if mso\]>[\s\S]*?<!\[endif\]-->/g;
const OLD_LOGO_MARKUP = `<img src="${BUSINESS_LOGO}" alt="${BUSINESS}" style="max-height: 34px; max-width: 180px; display: inline-block;" />`;

const now = new Date('2026-03-04T10:00:00Z');
const later = new Date('2026-03-04T11:00:00Z');

/** Every business template that goes through the wrapper, rendered for one branding. */
function renderAll(branding: BrandingData): Array<[string, string]> {
  const booking = {
    clientName: 'Dana Levi',
    clientEmail: 'dana@example.com',
    serviceName: 'Initial consultation',
    dateTime: now,
    endTime: later,
    duration: 60,
    timezone: 'UTC',
    price: 200,
    currency: 'USD',
    rescheduleUrl: 'https://example.com/r',
    cancelUrl: 'https://example.com/c',
    bookingId: 'b1',
    branding,
  };
  const reminder = {
    clientName: 'Dana Levi',
    businessName: BUSINESS,
    serviceName: 'Initial consultation',
    startsAt: later,
    timezone: 'UTC',
    manageUrl: 'https://example.com/m',
    branding,
    now: now.getTime(),
  };
  const insight = { clientName: 'Dana Levi', businessName: BUSINESS, branding };

  return [
    [
      'booking confirmation',
      generateBookingConfirmationEmail({ ...booking, paymentStatus: 'pending', paymentUrl: 'https://example.com/pay' }).html,
    ],
    [
      'booking cancellation',
      generateBookingCancellationEmail({
        clientName: 'Dana Levi',
        serviceName: 'Initial consultation',
        dateTime: now,
        timezone: 'UTC',
        reason: 'Illness',
        bookAgainUrl: 'https://example.com/book',
        branding,
      }).html,
    ],
    [
      'missed appointment',
      generateMissedAppointmentEmail({
        clientName: 'Dana Levi',
        serviceName: 'Initial consultation',
        dateTime: now,
        timezone: 'UTC',
        bookAgainUrl: 'https://example.com/book',
        branding,
      }).html,
    ],
    [
      'booking rescheduled',
      generateBookingRescheduledEmail({ ...booking, oldDateTime: now, newDateTime: later, newEndTime: later }).html,
    ],
    [
      'contact form reply',
      generateWelcomeEmail({
        clientName: 'Dana Levi',
        clientEmail: 'dana@example.com',
        message: 'Space next week?',
        bookingUrl: 'https://example.com/book',
        websiteUrl: 'https://example.com',
        branding,
      }).html,
    ],
    [
      'contact form reply, returning',
      generateReturningContactEmail({ clientName: 'Dana Levi', clientEmail: 'dana@example.com', message: 'Following up', branding }).html,
    ],
    [
      'invoice',
      generateInvoiceEmail({
        clientName: 'Dana Levi',
        invoiceNumber: 'INV-1',
        amount: 200,
        currency: 'USD',
        dueDate: now,
        lineItems: [{ description: 'Consultation', quantity: 1, unitPrice: 200, amount: 200 }],
        paymentOptions: {
          card: false,
          cardUrl: null,
          bank: true,
          bankName: 'Bank',
          bankAccount: '12-345',
          bankRouting: null,
          instructions: 'Transfer',
          none: false,
        },
        branding,
      }).html,
    ],
    ['intake request', generateIntakeRequestEmail({ ...booking, intakeFormUrl: 'https://example.com/intake' }).html],
    [
      'intake received',
      generateIntakeReceivedEmail({
        clientName: 'Dana Levi',
        serviceName: 'Initial consultation',
        dateTime: now,
        timezone: 'UTC',
        completedAt: now,
        rescheduleUrl: 'https://example.com/r',
        cancelUrl: 'https://example.com/c',
        branding,
      }).html,
    ],
    [
      'payment receipt',
      generatePaymentReceiptEmail({
        clientName: 'Dana Levi',
        amount: 200,
        currency: 'USD',
        receiptNumber: 'R-1',
        paymentDate: now,
        paymentMethod: 'Card',
        serviceName: 'Initial consultation',
        appointmentDate: now,
        timezone: 'UTC',
        bookingManageUrl: 'https://example.com/m',
        branding,
      }).html,
    ],
    [
      'refund confirmation',
      generateRefundConfirmationEmail({
        clientName: 'Dana Levi',
        refundAmount: 200,
        originalAmount: 200,
        currency: 'USD',
        refundType: 'full',
        refundDate: now,
        serviceName: 'Initial consultation',
        reason: 'Cancelled',
        bookAgainUrl: 'https://example.com/book',
        branding,
      }).html,
    ],
    [
      'proposal',
      generateProposalEmail({
        title: 'Kitchen refit',
        description: 'As discussed',
        total: 5000,
        currency: 'USD',
        stages: [{ label: 'Deposit', amount: 2500 }],
        dueOnAccept: 2500,
        viewUrl: 'https://example.com/p',
        ownerName: 'Sam',
        clientFirstName: 'Dana',
        branding,
      }).html,
    ],
    [
      'daily briefing',
      generateDailyBriefingEmail({
        lines: ['Two people wrote in.'],
        date: '2026-03-04',
        timezone: 'UTC',
        ownerFirstName: 'Sam',
        dashboardUrl: 'https://example.com/d',
        settingsUrl: 'https://example.com/s',
        branding,
      }).html,
    ],
    [
      'new enquiry alert',
      generateNewEnquiryEmail({
        kind: 'enquiry',
        contactName: 'Dana Levi',
        contactEmail: 'dana@example.com',
        message: 'Space?',
        contactUrl: 'https://example.com/crm',
        settingsUrl: 'https://example.com/s',
        branding,
      }).html,
    ],
    [
      'booking invite',
      generateBookingInviteEmail({
        clientName: 'Dana Levi',
        businessName: BUSINESS,
        bookingUrl: 'https://example.com/book',
        serviceName: 'Initial consultation',
        branding,
      }).html,
    ],
    [
      'consent confirmation',
      generateConsentConfirmationEmail({
        businessName: BUSINESS,
        statementText: 'I agree to receive news.',
        confirmUrl: 'https://example.com/confirm',
        branding,
      }).html,
    ],
    [
      'chase invoice',
      generateChaseInvoiceEmail({
        ...insight,
        invoiceNumber: 'INV-1',
        amount: 200,
        currency: 'USD',
        dueDate: now,
        daysOverdue: 7,
        payUrl: 'https://example.com/pay',
      }).html,
    ],
    [
      'follow-up nudge',
      generateFollowupNudgeEmail({
        ...insight,
        serviceName: 'Initial consultation',
        bookingUrl: 'https://example.com/book',
        daysSinceContact: 30,
        reason: 'past_client',
      }).html,
    ],
    [
      'booking reminder',
      generateBookingReminderEmail({
        ...insight,
        serviceName: 'Initial consultation',
        startsAt: later,
        timezone: 'UTC',
        manageUrl: 'https://example.com/m',
      }).html,
    ],
    ['meeting reminder', generateMeetingReminderEmail(reminder).html],
    [
      'owner meeting reminder',
      generateOwnerMeetingReminderEmail({ ...reminder, clientEmail: 'dana@example.com', outstanding: { intakeMissing: true } }).html,
    ],
    // The BizQL composer's wrapped path (`bizql/mutate/emailSend.ts`): arbitrary composed content.
    ['composed through the chat', wrapInBrandedTemplate('<p>Hello<!-- composed note --></p>', branding)],
  ];
}

describe('business emails after the platform-email fix (Slice 3a)', () => {
  const ORIGINAL = process.env.NEXT_PUBLIC_APP_URL;

  beforeAll(() => {
    // The state in which the platform emails DO carry the wordmark. Set before
    // the tables below are rendered (at collection time is too early, so they
    // are rendered inside each test).
    process.env.NEXT_PUBLIC_APP_URL = 'https://neuronforge-kohl.vercel.app';
  });
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL;
  });

  const withLogo: BrandingData = {
    businessName: BUSINESS,
    logoUrl: BUSINESS_LOGO,
    primaryColor: '#F97316',
    secondaryColor: '#FDBA74',
  };
  const withoutLogo: BrandingData = { businessName: BUSINESS, primaryColor: '#F97316', secondaryColor: '#FDBA74' };

  it('renders every template that goes through the wrapper', () => {
    expect(renderAll(withLogo)).toHaveLength(22);
  });

  it('the only "<!--" in any of them is the MSO conditional (T-3a-4)', () => {
    for (const branding of [withLogo, withoutLogo]) {
      for (const [name, html] of renderAll(branding)) {
        expect([name, html.match(MSO_BLOCK)?.length]).toEqual([name, 1]);
        expect([name, html.replace(MSO_BLOCK, '').includes('<!--')]).toEqual([name, false]);
      }
    }
  });

  it('with a business logo: that logo in its old markup, never the wordmark (T-3a-5)', () => {
    for (const [name, html] of renderAll(withLogo)) {
      expect([name, html.includes('/images/brand/wordmark')]).toEqual([name, false]);
      expect([name, html.includes(OLD_LOGO_MARKUP)]).toEqual([name, true]);
      // No platform sizing on a business logo.
      expect([name, /<img [^>]*width="/.test(html)]).toEqual([name, false]);
    }
  });

  it('with no business logo: the business name, no image, never AgentPilot', () => {
    const nameSpan = new RegExp(`<span style="font-family:[^"]*">\\s*${BUSINESS}\\s*</span>`);
    for (const [name, html] of renderAll(withoutLogo)) {
      expect([name, html.includes('/images/brand/wordmark')]).toEqual([name, false]);
      expect([name, nameSpan.test(html)]).toEqual([name, true]);
      expect([name, html.includes('alt="AgentPilot"')]).toEqual([name, false]);
    }
  });

  it('a logo with only one of the two dimensions keeps the old markup', () => {
    const html = wrapInBrandedTemplate('<p>x</p>', { ...withLogo, logoWidth: 154 });
    expect(html).toContain(OLD_LOGO_MARKUP);
  });
});

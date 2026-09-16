/**
 * Every template, rendered on a dark card, read for legibility.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS CATCHES
 *
 * The shell was taught to paint a business's own colours; the markup inside it
 * was not. Every template wrote `color: #1a1a1a` for its headings and
 * `color: #666666` for its copy, so a business on a dark theme sent a message
 * whose greeting, body and sign-off were near-black ink on a near-black ground
 * — the mail arrived, looked empty, and nothing in the send path could tell.
 *
 * A screenshot found it. This finds it again, for every template at once, which
 * is the only way a fix to eleven files stays fixed.
 *
 * HOW IT READS THE PAGE
 *
 * Rather than parsing the HTML into a tree and resolving inheritance — which no
 * email client agrees on anyway — it takes every colour the document actually
 * declares and measures it against the card the shell painted. A template may
 * legitimately place light ink on a saturated badge (the ✓ on the paid circle),
 * so a small set of known-good literals is allowed by name rather than by rule.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { contrastRatio } from '@/lib/branding/color';
import type { BrandingData } from '../templates/base-template';
import { emailPalette } from '../templates/base-template';
import {
  generateBookingConfirmationEmail,
  generateBookingCancellationEmail,
  generateBookingRescheduledEmail,
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

/**
 * What `resolveEmailBranding` hands a template for a business on a dark
 * archetype — the same derivation, written out so this file needs no database.
 */
const DARK: BrandingData = {
  businessName: 'Night Practice',
  primaryColor: '#F97316',
  secondaryColor: '#FDBA74',
  onBrand: '#000000',
  pageColor: '#0A0A0B',
  surfaceColor: '#17171A',
  mutedSurfaceColor: '#1F1F23',
  borderColor: '#33333A',
  textColor: '#F4F4F5',
  mutedTextColor: '#A1A1AA',
  radius: '20px',
  buttonRadius: '13px',
};

const SURFACE = DARK.surfaceColor!;

/**
 * Light ink that is deliberately placed on something other than the card: a
 * glyph inside a filled badge, the label on a filled button. Each is legible
 * where it actually sits; none of them is ever loose on the card.
 */
const ON_A_FILL = new Set(['#ffffff', '#000000']);

/**
 * Every colour the rendered document sets as TEXT.
 *
 * The lookbehind is load-bearing: without it this also collects
 * `background-color` and `border-color`, and then asks why the card's own dark
 * ground fails to contrast with itself.
 */
function declaredColors(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/(?<![-\w])color:\s*(#[0-9a-fA-F]{3,8})/g)) {
    found.add(match[1].toLowerCase());
  }
  return [...found];
}

/**
 * Below this a reader is straining, and at the bottom of it they see nothing
 * at all. WCAG AA for body text is 4.5; 3.0 is the large-text floor and is used
 * here because these documents mix both and the failure being guarded against
 * is invisibility, not a near miss.
 */
const FLOOR = 3.0;

function unreadableOn(html: string, surface: string): string[] {
  return declaredColors(html).filter(
    (color) => !ON_A_FILL.has(color) && contrastRatio(color, surface) < FLOOR
  );
}

const now = new Date('2026-03-04T10:00:00Z');
const later = new Date('2026-03-04T11:00:00Z');

const bookingBase = {
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
  branding: DARK,
};

/** Every template, with the arguments that light up as much of it as possible. */
const RENDERED: Array<[string, () => { html: string }]> = [
  [
    'booking confirmation, payment outstanding',
    () => generateBookingConfirmationEmail({ ...bookingBase, paymentStatus: 'pending', paymentUrl: 'https://example.com/pay' }),
  ],
  [
    'booking cancellation',
    () =>
      generateBookingCancellationEmail({
        clientName: 'Dana Levi',
        serviceName: 'Initial consultation',
        dateTime: now,
        timezone: 'UTC',
        reason: 'Illness',
        bookAgainUrl: 'https://example.com/book',
        branding: DARK,
      }),
  ],
  [
    'booking rescheduled',
    () =>
      generateBookingRescheduledEmail({
        clientName: 'Dana Levi',
        clientEmail: 'dana@example.com',
        serviceName: 'Initial consultation',
        oldDateTime: now,
        newDateTime: later,
        newEndTime: later,
        duration: 60,
        timezone: 'UTC',
        rescheduleUrl: 'https://example.com/r',
        cancelUrl: 'https://example.com/c',
        bookingId: 'b1',
        branding: DARK,
      }),
  ],
  ['contact form reply', () => generateWelcomeEmail({
    clientName: 'Dana Levi',
    clientEmail: 'dana@example.com',
    message: 'Do you have space next week?',
    serviceInterest: 'Initial consultation',
    bookingUrl: 'https://example.com/book',
    websiteUrl: 'https://example.com',
    branding: DARK,
  })],
  ['contact form reply, returning', () => generateReturningContactEmail({
    clientName: 'Dana Levi',
    clientEmail: 'dana@example.com',
    message: 'Following up',
    bookingUrl: 'https://example.com/book',
    branding: DARK,
  })],
  ['invoice, overdue and payable by transfer', () => generateInvoiceEmail({
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
      bankName: 'Bank Leumi',
      bankAccount: '12-345-6789',
      bankRouting: null,
      instructions: 'Transfer on the day',
      none: false,
    },
    branding: DARK,
  })],
  ['intake request', () => generateIntakeRequestEmail({
    clientName: 'Dana Levi',
    clientEmail: 'dana@example.com',
    serviceName: 'Initial consultation',
    dateTime: now,
    duration: 60,
    timezone: 'UTC',
    intakeFormUrl: 'https://example.com/intake',
    rescheduleUrl: 'https://example.com/r',
    cancelUrl: 'https://example.com/c',
    bookingId: 'b1',
    branding: DARK,
  })],
  ['intake received', () => generateIntakeReceivedEmail({
    clientName: 'Dana Levi',
    serviceName: 'Initial consultation',
    dateTime: now,
    timezone: 'UTC',
    completedAt: now,
    rescheduleUrl: 'https://example.com/r',
    cancelUrl: 'https://example.com/c',
    branding: DARK,
  })],
  ['payment receipt', () => generatePaymentReceiptEmail({
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
    branding: DARK,
  })],
  ['refund confirmation', () => generateRefundConfirmationEmail({
    clientName: 'Dana Levi',
    refundAmount: 200,
    originalAmount: 200,
    currency: 'USD',
    refundType: 'full',
    refundDate: now,
    serviceName: 'Initial consultation',
    reason: 'Cancelled',
    bookAgainUrl: 'https://example.com/book',
    branding: DARK,
  })],
  ['proposal', () => generateProposalEmail({
    title: 'Kitchen refit',
    description: 'As discussed',
    total: 5000,
    currency: 'USD',
    stages: [{ label: 'Deposit', amount: 2500 }],
    dueOnAccept: 2500,
    viewUrl: 'https://example.com/p',
    ownerName: 'Sam',
    clientFirstName: 'Dana',
    branding: DARK,
  })],
  ['daily briefing', () => generateDailyBriefingEmail({
    lines: ['Two people wrote in overnight.', 'One invoice went past due.'],
    date: '2026-03-04',
    timezone: 'UTC',
    ownerFirstName: 'Sam',
    dashboardUrl: 'https://example.com/d',
    settingsUrl: 'https://example.com/s',
    branding: DARK,
  })],
  ['new enquiry alert', () => generateNewEnquiryEmail({
    kind: 'enquiry',
    contactName: 'Dana Levi',
    contactEmail: 'dana@example.com',
    message: 'Do you have space?',
    contactUrl: 'https://example.com/crm',
    settingsUrl: 'https://example.com/s',
    branding: DARK,
  })],
  ['booking invite', () => generateBookingInviteEmail({
    clientName: 'Dana Levi',
    businessName: 'Night Practice',
    bookingUrl: 'https://example.com/book',
    serviceName: 'Initial consultation',
    branding: DARK,
  })],
];

describe('every email on a dark theme', () => {
  it.each(RENDERED)('%s keeps its text readable', (_name, render) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each entry
    // has its own argument shape; only the rendered HTML matters here.
    const { html } = (render as () => any)();
    expect(unreadableOn(html, SURFACE)).toEqual([]);
  });

  it('paints the card itself dark, so the test above is measuring something', () => {
    const { html } = generateWelcomeEmail({
      clientName: 'Dana Levi',
      clientEmail: 'dana@example.com',
      branding: DARK,
    });
    expect(html).toContain(`background-color: ${SURFACE}`);
    expect(emailPalette(DARK).dark).toBe(true);
  });
});

describe('a business with no theme of its own', () => {
  /*
   * The whole point of the fallbacks: an account that has chosen nothing must
   * receive the email it always received, on white, in the same greys.
   */
  it('still gets the greys these templates were written in', () => {
    const plain: BrandingData = {
      businessName: 'Plain',
      primaryColor: '#4F46E5',
      secondaryColor: '#818CF8',
    };
    const palette = emailPalette(plain);

    expect(palette.ink).toBe('#1a1a1a');
    expect(palette.inkMuted).toBe('#666666');
    expect(palette.inkFaint).toBe('#888888');
    expect(palette.dark).toBe(false);
  });
});

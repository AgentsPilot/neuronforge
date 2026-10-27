/**
 * What a cancellation actually tells the client.
 *
 * The email that prompted this said "ההזמנה בוטלה", showed "מחיר €100" and then
 * asked "האם תרצה לקבוע פגישה חדשה?" — about a COURSE, which was never a meeting.
 * It never said whether the €100 had been paid, refunded, or was still owed.
 */

import { generateBookingCancellationEmail } from '@/lib/email/templates/booking-confirmation';

const branding = {
  businessName: 'בית הספר הבינלאומי להורות',
  primaryColor: '#B91C1C',
  secondaryColor: '#B91C1C',
};

const course = {
  clientName: 'דויד המלך',
  serviceName: 'קורס מומחים',
  dateTime: new Date('2026-09-13T13:00:00Z'),
  timezone: 'Asia/Jerusalem',
  hasSchedule: false as const,
  price: 100,
  currency: 'EUR',
  branding,
  locale: 'he' as const,
};

describe('a cancelled course, which was never an appointment', () => {
  const html = generateBookingCancellationEmail({
    ...course,
    bookAgainUrl: 'https://app.example.com/c/ABC123/book',
    serviceId: 'svc-1',
  }).html;

  it('does not ask about scheduling a meeting', () => {
    // The whole complaint: meeting language on something with no time.
    expect(html).not.toContain('לקבוע פגישה חדשה');
  });

  it('names the thing it is inviting them back to', () => {
    expect(html).toContain('קורס מומחים');
    /*
     * Was `להירשם שוב` — "sign up again" — one of two variants, the other
     * being `לקבוע מועד אחר` for anything with a time on it. Both were
     * replaced with a single neutral invitation that reads correctly over a
     * course and over an appointment alike, so there is no longer a wording
     * that can be wrong for the kind of thing being cancelled. See the
     * reasoning on `bookAgainPrompt` in lib/email/templates/translations.ts.
     */
    expect(html).toMatch(/תרצו להזמין שוב/);
  });

  it('links straight to that service, not to the list', () => {
    expect(html).toContain('service=svc-1');
  });

  it('appends the service without breaking an existing query string', () => {
    const withQuery = generateBookingCancellationEmail({
      ...course,
      bookAgainUrl: 'https://app.example.com/c/ABC123/book?utm_source=email',
      serviceId: 'svc-1',
    }).html;
    // A raw ampersand, as every other URL in these templates renders. The point
    // of the test is the JOINER: a second `?` would silently void the whole
    // query string, taking the utm parameter down with the service id.
    expect(withQuery).toContain('utm_source=email&service=svc-1');
    expect(withQuery).not.toContain('book?utm_source=email?service');
  });
});

describe('what happened to the money', () => {
  const render = (over: Record<string, unknown>) =>
    generateBookingCancellationEmail({ ...course, ...over }).html;

  it('says plainly when nothing was paid', () => {
    // A price with no payment line reads as a bill still owed.
    const html = render({ paidAmount: 0, refundedAmount: 0, amountHeld: 0 });
    expect(html).toContain('לא שולם עבור זה דבר');
  });

  it('says so when it was refunded in full', () => {
    const html = render({ paidAmount: 100, refundedAmount: 100, amountHeld: 0 });
    expect(html).toContain('הוחזרו במלואם');
    expect(html).toContain('€100.00');
  });

  it('separates a partial refund from what is still held', () => {
    const html = render({ paidAmount: 100, refundedAmount: 40, amountHeld: 60, heldCurrency: 'EUR' });
    expect(html).toContain('€40.00');
    expect(html).toContain('€60.00');
  });

  it('reports money still held when nothing was returned', () => {
    const html = render({ paidAmount: 100, refundedAmount: 0, amountHeld: 100, heldCurrency: 'EUR' });
    expect(html).toContain('עדיין מוחזקים');
  });

  it('never promises a refund that has not happened', () => {
    const html = render({ paidAmount: 100, refundedAmount: 0, amountHeld: 100, heldCurrency: 'EUR' });
    expect(html).not.toContain('הוחזרו במלואם');
  });

  it('tells the four states apart, which one figure cannot', () => {
    // `amountHeld: 0` is true of BOTH "never paid" and "refunded in full".
    const never = render({ paidAmount: 0, refundedAmount: 0, amountHeld: 0 });
    const returned = render({ paidAmount: 100, refundedAmount: 100, amountHeld: 0 });
    expect(never).not.toEqual(returned);
  });
});

/*
 * A scheduled booking and an unscheduled one now read the SAME.
 *
 * This described a second wording kept specially for things with a time on
 * them. That variant is gone on purpose: one invitation that is true of both
 * cannot be the wrong one, whereas two variants can only ever be right when
 * the code picks correctly between them. What still has to hold is that
 * neither case reverts to meeting language, which is the complaint the whole
 * file exists for.
 */
describe('scheduled or not, it reads the same and never mentions a meeting', () => {
  const base = {
    ...course,
    bookAgainUrl: 'https://app.example.com/c/ABC123/book',
    serviceId: 'svc-1',
  };
  const scheduled = generateBookingCancellationEmail({ ...base, hasSchedule: true }).html;
  const unscheduled = generateBookingCancellationEmail(base).html;

  it('uses the one neutral invitation and names the service', () => {
    expect(scheduled).toMatch(/תרצו להזמין שוב/);
    expect(scheduled).toContain('קורס מומחים');
  });

  it('does not ask about scheduling a meeting either', () => {
    expect(scheduled).not.toContain('לקבוע פגישה חדשה');
  });

  /* The point of unifying them: no branch can pick the wrong wording. */
  it('says the same thing whether or not there was a time', () => {
    expect(scheduled).toMatch(/תרצו להזמין שוב/);
    expect(unscheduled).toMatch(/תרצו להזמין שוב/);
  });
});

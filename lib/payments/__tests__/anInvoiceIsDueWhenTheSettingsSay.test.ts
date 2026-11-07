/**
 * Every invoice takes its deadline from the configuration, never from a rule
 * written into one code path.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SHAPE OF WHAT WENT WRONG
 *
 * Five paths raised invoices and four of them had invented their own answer:
 *
 *   booking, one payment   "due on the service date" — hardcoded, and sitting
 *                          in FRONT of the business default so it could never
 *                          be reached on the surface most owners use
 *   chat / BizQL invoice   no due date at all, with the words "due on receipt"
 *                          printed over the empty column. Nothing with an empty
 *                          due date can age, so none were ever chased
 *   booking → Stripe       the rule re-derived rather than the date reused, so
 *                          the email and the Stripe page could disagree
 *   send → Stripe          a hardcoded thirty days
 *   raise → Stripe         `new Date()` — due the instant it arrived
 *
 * The owner's setting existed the whole time and was read by the quote path
 * alone. An owner who set 45 days watched every booking fall due on the day of
 * the appointment with nothing on screen to explain it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE, WHICH IS NOW THE ONLY ONE
 *
 *     the entity's own terms  →  the business default  →  DEFAULT_PAYMENT_TERMS_DAYS
 *
 * "The entity's own terms" is narrow and deliberately so: a payment plan's
 * first-payment setting, and a quote's `payment_terms_days`. Those are the two
 * things an owner can actually set. A single-payment service cannot express
 * terms at all — the control is behind the instalments gate — so `on_booking`
 * on one of those is not an instruction, it is the default nobody was offered,
 * and it correctly resolves to the business number.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

import {
  DEFAULT_PAYMENT_TERMS_DAYS,
  dueDateFromTerms,
  fallbackInvoiceTerms,
  resolveTermsDays,
  termsValueForDays,
} from '@/lib/payments/paymentTerms';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');
/** Comments stripped: this file asserts on code, and the prose repeats it. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const ISSUED = new Date('2026-11-07T10:00:00Z');

describe('the fallback returns a date and its words together', () => {
  it('uses the business number', () => {
    expect(fallbackInvoiceTerms(45, ISSUED)).toEqual({
      due_date: '2026-12-22',
      payment_terms: 'net45',
    });
  });

  it('falls to the platform default when the business has set nothing', () => {
    /* `null` is "never asked", and 30 is what the settings dialog itself
       defaults to — so an unanswered setting and the shown default agree. */
    const { due_date, payment_terms } = fallbackInvoiceTerms(null, ISSUED);

    expect(payment_terms).toBe(termsValueForDays(DEFAULT_PAYMENT_TERMS_DAYS));
    expect(due_date).toBe(dueDateFromTerms(DEFAULT_PAYMENT_TERMS_DAYS, ISSUED));
  });

  it('treats zero days as a real answer, not as missing', () => {
    /*
     * `??`, never `||`. Zero is "due on receipt", which a business may mean,
     * and `||` would silently promote it to the platform default.
     */
    expect(resolveTermsDays(null, 0)).toBe(0);
    expect(fallbackInvoiceTerms(0, ISSUED).due_date).toBe('2026-11-07');
  });

  it('never returns a date without the words that describe it', () => {
    /*
     * The pairing IS the fix for what the chat path did: `due_date: null`
     * stored beside `payment_terms: 'due_on_receipt'` — two answers at once,
     * the words saying pay now and the column saying there is no deadline.
     */
    for (const days of [null, undefined, 0, 7, 30, 45, 60]) {
      const terms = fallbackInvoiceTerms(days, ISSUED);

      expect(terms.due_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(terms.payment_terms).toBeTruthy();
    }
  });
});

describe('the booking path obeys the configuration', () => {
  const booking = code(read('lib/services/BookingLifecycleService.ts'));

  it('reads the business default', () => {
    /* THE BUG, AS ONE ASSERTION. This path never asked for it. */
    expect(booking).toContain('businessProfileRepository.getPaymentTermsDays(userId)');
    expect(booking).toContain('fallbackInvoiceTerms(businessTermsDays)');
  });

  it('no longer dates an invoice by the appointment', () => {
    /*
     * The invented third rule. It belonged to neither layer the owner can
     * configure, and it sat in front of the one they can.
     */
    expect(booking).not.toContain('SERVICE_DATE_TERMS');
    expect(booking).not.toMatch(/businessDateKey\(new Date\(bookingData\.start_time/);
  });

  it('still lets a service that states its own terms win', () => {
    /* `days_after` is the one thing a service can say that an owner actually
       chose, since nothing writes it by default. */
    expect(booking).toContain("service.first_payment_due === 'days_after'");
    expect(booking).toContain('planStartDate(');
  });

  it('writes the terms as one expression with the date', () => {
    /* Computed apart is how they drifted apart. */
    expect(booking).toContain('businessFallback.due_date');
    expect(booking).toContain('businessFallback.payment_terms');
  });
});

describe('an invoice with no service and no quote still gets a deadline', () => {
  it.each([
    ['the chat executor', 'lib/business-os/chat/CapabilityEngine.ts'],
    ['the BizQL mutate path', 'lib/business-os/bizql/mutate/MutateExecutor.ts'],
  ])('%s asks for the business default', (_label, file) => {
    const source = code(read(file));

    expect(source).toContain('getPaymentTermsDays');
    expect(source).toContain('fallbackInvoiceTerms');
  });

  it('the chat executor no longer stores a null due date', () => {
    /*
     * Scoped to the INVOICE executor. The file also holds `createTask`, which
     * stores `due_date: … || null` and is right to: a task with no date is a
     * task with no date, where an invoice with none can never be chased.
     */
    const source = code(read('lib/business-os/chat/CapabilityEngine.ts'));
    const from = source.indexOf('private async createInvoice(');
    const to = source.indexOf('private async sendInvoice(', from);

    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);

    const createInvoice = source.slice(from, to);

    expect(createInvoice).not.toMatch(/due_date:\s*\(params\.due_date as string\) \|\| null/);
    /* A date the caller supplied still wins; the default only fills a silence. */
    expect(createInvoice).toContain("(params.due_date as string) || fallback.due_date");
  });

  it('the BizQL path lets a stated due date win over the default', () => {
    /*
     * Order matters and is the whole correctness of that line: the fallback is
     * spread BEFORE `...data`, so a plan that names its own date overrides it.
     * Reversed, every explicit date would be silently overwritten.
     */
    const source = code(read('lib/business-os/bizql/mutate/MutateExecutor.ts'));
    const spreadFallback = source.indexOf('...fallbackInvoiceTerms(businessDays)');
    const spreadData = source.indexOf('...data,', spreadFallback);

    expect(spreadFallback).toBeGreaterThan(-1);
    expect(spreadData).toBeGreaterThan(spreadFallback);
  });
});

describe('Stripe is told the date the invoice carries', () => {
  it('the booking path reuses the date rather than re-deriving the rule', () => {
    const booking = code(read('lib/services/BookingLifecycleService.ts'));

    expect(booking).toContain('dueDate: new Date(`${dueDate}T12:00:00Z`)');
    /* The re-derivation that let the email and the Stripe page disagree. */
    expect(booking).not.toMatch(/dueDate: scheduledSale \? new Date\(bookingData\.start_time/);
  });

  it('the send path no longer invents thirty days', () => {
    const delivery = code(read('lib/services/InvoiceDeliveryService.ts'));

    expect(delivery).not.toContain('30 * 24 * 60 * 60 * 1000');
    expect(delivery).toContain('defaultDueDate(businessDays: number | null | undefined)');
  });

  it('the raise path no longer makes an invoice due the moment it arrives', () => {
    const raise = code(read('lib/payments/raiseInvoiceForPayment.ts'));

    expect(raise).not.toMatch(/dueDate: invoice\.due_date \? new Date\(invoice\.due_date as string\) : new Date\(\),/);
    expect(raise).toContain('fallbackInvoiceTerms');
  });
});

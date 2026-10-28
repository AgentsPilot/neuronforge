/**
 * A receipt names the payment method in the client's language, and only
 * itemises money that was actually billed per session.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO THINGS A HEBREW RECEIPT GOT WRONG
 *
 *   אמצעי תשלום        card          ← an English enum beside a Hebrew label
 *   הפגישות שלך        … תשלום       ← a per-session money column on a package
 *                                       the client paid for in one payment
 *
 * The first is a value that went from the database into the email untouched.
 * The second is subtler: a package paid UPFRONT has no per-session charge at
 * all, so the figures in that column are a share this platform divided out.
 * Printing three of them asks the reader to reconcile them against the single
 * sum stated at the top of the same email — which they already paid, once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HALF THAT MUST SURVIVE
 *
 * A package billed PER SESSION needs that column: each meeting has its own
 * stage, its own invoice and its own state, and the client is paying them one
 * at a time. Dropping it there would hide what they still owe. Both flavours
 * are asserted below, because a fix that satisfies only the reported one is
 * the more expensive mistake.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generatePaymentReceiptEmail } from '../payment-receipt';

const branding = {
  businessName: 'בית הספר',
  primaryColor: '#8B5CF6',
} as unknown as Parameters<typeof generatePaymentReceiptEmail>[0]['branding'];

const session = (number: number, billedPerSession: boolean) => ({
  number,
  start: `2026-11-${String(3 + (number - 1) * 7).padStart(2, '0')}T08:00:00Z`,
  state: 'upcoming' as const,
  amount: 316.67,
  currency: 'ILS',
  money: 'paid' as const,
  refunded: null,
  isSubject: number === 1,
  billedPerSession,
});

/**
 * The sessions table alone.
 *
 * Bounded at both ends on purpose. Above it sits the details table carrying
 * "אמצעי תשלום", and below it the footer sentence "קבלה זו מאשרת את התשלום
 * שלך" — both contain the word this file searches for, and an unbounded slice
 * matched the footer and failed for the one reason it should have passed.
 */
const sessionsTable = (html: string) =>
  html.slice(html.indexOf('הפגישות שלך'), html.indexOf('כל השעות לפי'));

const receipt = (overrides: Record<string, unknown> = {}) =>
  generatePaymentReceiptEmail({
    clientName: 'שלמה המלך',
    amount: 950,
    currency: 'ILS',
    paymentMethod: 'card',
    receiptNumber: 'INV-00042',
    paymentDate: new Date('2026-10-27T10:00:00Z'),
    branding,
    locale: 'he',
    ...overrides,
  } as unknown as Parameters<typeof generatePaymentReceiptEmail>[0]);

describe('the payment method', () => {
  it('is translated, not printed as a database value', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT WAS REPORTED.
     * ─────────────────────────────────────────────────────────────────────
     */
    const { html } = receipt();

    expect(html).toContain('כרטיס אשראי');
    expect(html).not.toMatch(/>\s*card\s*</);
  });

  it.each([
    ['cash', 'מזומן'],
    ['bank_transfer', 'העברה בנקאית'],
    ['cheque', 'צ׳ק'],
    ['check', 'צ׳ק'],
  ])('translates %s', (stored, expected) => {
    // `cheque` and `check` are both stored in this product, by different paths.
    const { html } = receipt({ paymentMethod: stored });

    expect(html).toContain(expected);
  });

  it('prints an unknown method rather than dropping it', () => {
    /*
     * A method nobody has translated is still a fact about the payment, and
     * showing it names itself the next time someone reads a receipt.
     */
    const { html } = receipt({ paymentMethod: 'carrier_pigeon' });

    expect(html).toContain('carrier_pigeon');
  });
});

describe('every template that draws this table', () => {
  it('asks the one shared rule, rather than deciding for itself', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * FIVE CALL SITES, ONE RULE.
     *
     * The receipt and four branches of the confirmation all render this
     * table. A rule about money written out five times is four chances for
     * them to disagree — and a client who gets a confirmation itemising
     * three charges and a receipt itemising none has been told two things
     * about one payment.
     * ─────────────────────────────────────────────────────────────────────
     */
    const read = (file: string) =>
      require('fs').readFileSync(require('path').join(process.cwd(), file), 'utf8');

    const receiptSource = read('lib/email/templates/payment-receipt.ts');
    const confirmation = read('lib/email/templates/booking-confirmation.ts');

    // Every `payment:` in a columns block goes through the helper.
    for (const source of [receiptSource, confirmation]) {
      expect(source).not.toMatch(/payment: t(Confirm|Plan)?\.sessionColPayment\[locale\],/);
      expect(source).toContain('sessionPaymentColumn(');
    }

    // Four in the confirmation, one in the receipt.
    expect(confirmation.split('sessionPaymentColumn(').length - 1).toBe(4);
  });
});

describe('the sessions table', () => {
  it('drops the payment column when the block was paid up front', () => {
    const { html } = receipt({
      sessionLines: [session(1, false), session(2, false), session(3, false)],
      timezone: 'Asia/Jerusalem',
    });

    // The sessions are still listed; only the money column goes.
    expect(html).toContain('הפגישות שלך');
    expect(sessionsTable(html)).not.toContain('תשלום');
    expect(sessionsTable(html)).not.toContain('316');
  });

  it('KEEPS it when the sessions are billed one at a time', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE HALF THAT MUST NOT BREAK.
     *
     * Here each meeting has its own stage and invoice, and the client pays
     * as the sessions happen — so the column is the only thing telling them
     * which ones are settled.
     * ─────────────────────────────────────────────────────────────────────
     */
    const { html } = receipt({
      sessionLines: [session(1, true), session(2, true), session(3, true)],
      timezone: 'Asia/Jerusalem',
    });

    expect(sessionsTable(html)).toContain('תשלום');
    expect(sessionsTable(html)).toContain('שולם');
  });

  it('keeps it when even one session carries its own charge', () => {
    // A mixed block still owes the reader the per-session detail.
    const { html } = receipt({
      sessionLines: [session(1, false), session(2, true)],
      timezone: 'Asia/Jerusalem',
    });

    expect(sessionsTable(html)).toContain('תשלום');
  });
});

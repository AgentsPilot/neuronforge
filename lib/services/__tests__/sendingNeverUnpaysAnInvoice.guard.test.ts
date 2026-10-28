/**
 * Sending an invoice can never undo a payment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT HAPPENED, FROM THE LIVE ROW
 *
 * A client paid ₪660 in the portal and the page went on showing them a Pay
 * button. The money was fine; the invoice row was not:
 *
 *     INV1611-00034   status: 'sent'   paid_at: 17:54:45   tx: succeeded 17:54:46
 *
 * That combination cannot come from the settlement path — `settleInvoicePaid`
 * writes `status` and `paid_at` in one statement, so they move together. It
 * comes from a SECOND writer:
 *
 *     17:50:40  invoice created, sending begins
 *     17:54:45  client pays; status becomes 'paid', paid_at is stamped
 *     17:54:46  the transaction is recorded
 *      after    the send finishes and writes status 'sent' over 'paid'
 *
 * `paid_at` survived because the send never touched it. The portal reads
 * status, so it asked for money it had already taken.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A GUARD AND NOT JUST A FIX
 *
 * `InvoiceDeliveryService` had TWO unconditional status writes — the Stripe
 * path and the email path — and the module's own comment shows the thinking
 * that produced them: "an invoice marked sent that nobody received is the exact
 * bug this module exists to prevent." Correct about one direction and blind to
 * the other. A third send path would be written the same way.
 *
 * So what is asserted is that no send path sets `status` itself: they all go
 * through `markDelivered`, which moves the status only while the invoice is
 * still unsettled, and lets the database decide that in the same statement.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const delivery = read('lib/services/InvoiceDeliveryService.ts');
const repository = read('lib/repositories/PaymentRepository.ts');

/** Source with comments removed: the prose here discusses `status: 'sent'`. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[\s;,({[])\/\/[^\n]*/g, '$1');

describe('the delivery service', () => {
  it('never writes a status of its own', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * Two unconditional `status: 'sent'` writes are what overwrote a payment.
     * Any new send path that reintroduces one fails here.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(code(delivery)).not.toMatch(/status:\s*'sent'/);
  });

  it('records delivery through the one method that defers to a settlement', () => {
    const calls = code(delivery).match(/paymentInvoiceRepository\.markDelivered\(/g) ?? [];

    // Both paths: the Stripe send and the email fallback.
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('still records that the invoice went out', () => {
    // The fix removes a status write, not the delivery record. An invoice that
    // was emailed and says it never was is the bug this module was built for.
    expect(code(delivery)).toMatch(/sent_at: new Date\(\)\.toISOString\(\)/);
  });
});

describe('the repository method', () => {
  it('refuses to move the status of a settled invoice', () => {
    expect(repository).toMatch(
      /\.not\('status', 'in', '\("paid","refunded","partially_refunded"\)'\)/
    );
  });

  it('checks paid_at as well as the status', () => {
    /*
     * A refund can land on an invoice that was never marked paid, leaving the
     * status at `sent` with the money gone — the case `isSettledInvoice`
     * documents. Status alone would let a send stamp over it.
     */
    expect(repository).toMatch(/\.is\('paid_at', null\)/);
  });

  it('lets the database decide, not a prior read', () => {
    /*
     * A read-then-write would lose the same race a few milliseconds later.
     * The condition travels with the UPDATE.
     */
    const method = repository.slice(repository.indexOf('async markDelivered'));
    const body = method.slice(0, method.indexOf('async updateStripeFields'));

    expect(body).not.toMatch(/\.select\('status'\)|getById|findById/);
    expect(body).toMatch(/\.update\(\{ status: 'sent'/);
  });

  it('writes the delivery facts whatever the payment did', () => {
    /*
     * Two statements on purpose: the Stripe id and the sent timestamp are true
     * regardless of whether money arrived mid-send, so they are written
     * unconditionally and only the status is conditional.
     */
    const method = repository.slice(repository.indexOf('async markDelivered'));
    const body = method.slice(0, method.indexOf('async updateStripeFields'));

    expect(body).toMatch(/\.update\(\{ \.\.\.delivery, updated_at: now \}\)/);
  });

  it('treats a settled invoice as an ordinary outcome, not a failure', () => {
    // The send succeeded and the payment stands; nothing here is wrong.
    const method = repository.slice(repository.indexOf('async markDelivered'));

    expect(method.slice(0, 2600)).toMatch(/logger\.info\(/);
  });
});

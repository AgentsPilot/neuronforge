/**
 * A cancelled invoice stops being owed, on the card as well as in the database.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * The payment step decided money was "given up on" by one test:
 *
 *     booking.status === 'cancelled'
 *
 * That is one of TWO ways money stops being owed. The other is the invoice
 * itself being called off — a quote stopped part way, or the owner pressing
 * "Cancel this payment" — and neither of those touches the booking.
 *
 * So a ₪5,000 invoice, voided locally AND at Stripe, went on reading
 * "outstanding ₪5,000" on a completed booking, still offered "Manage payment",
 * and still offered to resend the invoice that had just been voided.
 *
 * Three separate symptoms, one cause: `cancelledUnpaid` feeds the totals strip,
 * the cancelled chip, and the two buttons.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as fs from 'fs';
import * as path from 'path';

const FILE = 'components/crm/contact-drawer/BookingsTab.tsx';
const source = fs.readFileSync(path.join(process.cwd(), FILE), 'utf8');
const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/** The whole definition, however it is wrapped. */
const definition = code
  .slice(code.indexOf('const cancelledUnpaid'), code.indexOf('const cancelledUnpaid') + 420)
  .replace(/\s+/g, ' ');

describe('money that is not coming', () => {
  it('strips comments first, or it passes on its own explanation', () => {
    expect(source).toContain('Money that is not coming, by either route');
    expect(code).not.toContain('Money that is not coming, by either route');
  });

  it('counts a cancelled invoice as well as a cancelled booking', () => {
    expect(definition).toContain("booking.status === 'cancelled'");
    expect(definition).toContain("payment?.invoiceStatus === 'cancelled'");
    // Either, not both: the two routes are independent and the invoice one
    // leaves the booking untouched.
    expect(definition).toMatch(/\|\|/);
  });

  it('still refuses to call it given-up-on once money has moved', () => {
    /*
     * An invoice cancelled after part of it was collected is not money given
     * up on; it belongs in the refunded/kept pair. This guard is what keeps the
     * widened test from swallowing that case.
     */
    expect(definition).toContain('!moneyMoved');
  });

  it('and still only applies to the payment step, where money is expected', () => {
    expect(definition).toContain('isPaymentStep');
    expect(definition).toContain('paymentExpected');
  });
});

describe('what the one flag puts right', () => {
  it('the strip shows it as stopped, not as outstanding', () => {
    // Left `pending` the card asks the owner to collect money it has just been
    // told will never arrive.
    expect(code).toContain('const isStopped = cancelledUnpaid;');
    expect(code).toMatch(/status: isStopped\s*\? 'cancelled'/);
  });

  it('stopped money is not late money', () => {
    // `isOverdue` is only "pending and past its date", and voiding leaves both
    // true -- the card read "₪300.00 (overdue)" above a "cancelled" chip.
    expect(code).toContain("!isPaid && !isStopped && payment.invoiceStatus === 'overdue'");
  });

  it('it does not offer to resend a voided invoice', () => {
    expect(code).toContain('!isPaid && !isStopped && !isOverdue && Boolean(payment.invoiceId)');
  });

  it('and the Manage payment button stands down', () => {
    expect(code).toContain('!cancelledUnpaid && !nothingLeftToManage');
  });
});

describe('the type can carry the state being read', () => {
  it('invoiceStatus includes cancelled', () => {
    // Read from a union that did not list it, every comparison would be dead
    // code that silently never matched.
    const types = fs.readFileSync(
      path.join(process.cwd(), 'components/crm/contact-drawer/types.ts'),
      'utf8'
    );
    const line = types.split('\n').find(l => l.includes('invoiceStatus?:')) ?? '';
    expect(line).toContain("'cancelled'");
  });
});

describe('a QUOTED job carries its invoice state too', () => {
  /*
   * The second path, and the one that actually rendered the ₪5,000.
   *
   * A quoted job's payment is NOT built from the booking: `paymentData` is
   * `quotedMoney` whenever the quote answers, and `quotedPayment` set every
   * other field while never setting `invoiceStatus`. So the field was always
   * undefined for exactly the jobs a quote can stop, and the card could not
   * see its own cancelled invoice however correct the database was.
   *
   * Both call sites of `quotedPayment` are covered by the one fix.
   */
  const drawer = fs
    .readFileSync(path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('quoted money is what the card reads, when there is a quote', () => {
    // If this stops being true, the fix below is in the wrong function.
    expect(drawer).toContain('const paymentData: SessionPayment | null = quotedMoney ? quotedMoney :');
  });

  it('quotedPayment reports the invoice state', () => {
    expect(drawer).toMatch(/invoiceStatus: stages\.length\s*\? undefined\s*: \(proposal\.invoice\.status/);
  });

  it('and leaves a staged quote to its stages', () => {
    /*
     * A staged quote's money is read from the stages, which carry their own
     * statuses and are already `cancelled` when a job is stopped. Naming the
     * quote's own invoice there would describe the wrong record.
     */
    const fn = drawer.slice(drawer.indexOf('function quotedPayment'), drawer.indexOf('function quotedPayment') + 4000);
    expect(fn).toContain('stages.length');
  });

  it('the type it is cast to is the one the card checks', () => {
    expect(drawer).toContain("SessionPayment['invoiceStatus']");
  });
});

describe('a cancelled invoice cannot be resent', () => {
  /*
   * `InvoiceDeliveryService` refuses it outright -- `InvoiceNotSendableError`
   * with reason `'cancelled'` -- so the button returned a 400 saying the
   * invoice was cancelled, directly beneath a line already saying so.
   *
   * Decided where `canResend` is built, because it feeds four controls.
   */
  const drawer = fs
    .readFileSync(path.join(process.cwd(), 'components/crm/contact-drawer/CRMContactDrawerV2.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('canResend says no to a cancelled invoice', () => {
    const block = drawer.slice(drawer.indexOf('canResend:'), drawer.indexOf('canResend:') + 260).replace(/\s+/g, ' ');
    expect(block).toContain("payment.invoiceStatus !== 'cancelled'");
  });

  it('and still says no to a refunded one', () => {
    // The rule this sits beside. Widening must not drop it.
    const block = drawer.slice(drawer.indexOf('canResend:'), drawer.indexOf('canResend:') + 260).replace(/\s+/g, ' ');
    expect(block).toContain('(payment.refundedAmount ?? 0) <= 0');
  });

  it('the service really does refuse it, so the button could never have worked', () => {
    const service = fs.readFileSync(
      path.join(process.cwd(), 'lib/services/InvoiceDeliveryService.ts'),
      'utf8'
    );
    expect(service).toContain("if (invoice.status === 'cancelled')");
    expect(service).toContain("'cancelled'");
  });
});

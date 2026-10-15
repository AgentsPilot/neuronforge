/**
 * The Manage payment dialog reads the refund, like the card behind it does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT SHOWED
 *
 * On the ₪2,000 job with both stages collected and both fully refunded, the
 * card said "returned ₪2,000 · you keep ₪0" and the dialog opened on top of it
 * saying:
 *
 *     Total ₪2,000   Collected ₪2,000   Outstanding ₪0
 *     Deposit            Paid · 9 Oct            ₪1,000
 *     On completion      Paid · 9 Oct            ₪1,000
 *     [ Mark as paid ]
 *
 * Three separate failures with one cause: a refund is recorded against the
 * INVOICE, so the stage keeps `status: 'paid'` — correctly — and everything
 * that read only the status believed the money was still collected.
 *
 * The third was the dangerous one. `outstandingInvoiceId` asked "is this
 * invoice not `paid`", a refunded invoice reads `refunded`, and returned money
 * therefore presented as collectable with a button offering to settle it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MUST NOT BREAK WHILE FIXING IT
 *
 * This dialog is the ONLY way to record money that arrived outside a processor
 * — cash, a cheque, a transfer — and the only way an owner with no Stripe
 * closes an invoice at all. Every rule here is therefore conditioned narrowly,
 * so a job with a refunded deposit and a milestone still owed keeps its
 * collect button. Several of these assert exactly that.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const modal = read('components/crm/contact-drawer/PaymentManagementModal.tsx');
const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
const menu = read('components/crm/contact-drawer/StageRowActions.tsx');
const route = read('app/api/payments/invoices/[id]/resend-refund-confirmation/route.ts');
const notifier = read('lib/payments/notifyRefund.ts');

describe('the totals strip', () => {
  it('is told what came back', () => {
    // The component has rendered charged / returned / kept since it was
    // written; only this dialog never passed the figure.
    expect(modal).toMatch(/refunded=\{Number\(paymentData\?\.refundedAmount \?\? 0\)\}/);
  });

  it('uses the same words as the card, not its own', () => {
    /*
     * Both labels are required together — without them the component keeps the
     * ordinary three cells rather than putting an English fallback into a
     * Hebrew strip — and they must be the keys the card uses, or one strip is
     * labelled two ways depending on which surface drew it.
     */
    expect(modal).toMatch(/refunded: t\('crm\.journey\.returned'\)/);
    expect(modal).toMatch(/kept: t\('crm\.journey\.kept'\)/);
  });
});

describe('the stage rows', () => {
  it('read the refund figure, not only the status', () => {
    expect(modal).toMatch(/const stageRefunded = Number\(stage\.refundedAmount \?\? 0\)/);
  });

  it('separate a full return from a partial one', () => {
    // A partial refund leaves money with the business, and dressing it as a
    // full one would misstate what the owner is holding.
    expect(modal).toMatch(/fullyReturned =\s*\n?\s*stageRefunded > 0 && stageRefunded >= Number\(stage\.amount \?\? 0\)/);
  });
});

describe('a refunded invoice is not an outstanding one', () => {
  it('the fallback checks the amount returned, not the status', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * `status !== 'paid'` is true of a refunded invoice, which is how money
     * that had been handed back came to present as money still to collect,
     * with a button offering to mark it paid.
     *
     * The amount, not the status: a refund can land on an invoice never
     * marked paid (leaving `status` at `sent`), and a PARTIAL refund
     * deliberately leaves it at `paid`.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(drawer).toMatch(/Number\(proposal\.invoice\.refunded_amount \?\? 0\) <= 0/);
  });

  it('still finds a genuinely unpaid stage', () => {
    /*
     * The half that must survive. A job whose deposit was refunded while its
     * final milestone is still owed has real money to collect, and the first
     * clause is what keeps the button alive for it.
     */
    expect(drawer).toMatch(/stages\.find\(s => s\.status !== 'paid' && s\.invoice_id\)/);
  });
});

describe('the dialog opens on the payment, never on a refund form', () => {
  it('has no flag that can send it somewhere else', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE REGRESSION THIS REPLACES, WHICH WAS CAUSED BY "FIXING" IT.
     *
     * `startInRefundView` was dead: the drawer passed `true` and the effect
     * overwrote it. Making the dialog obey it looked like a correctness fix
     * and was the opposite — there is ONE mount of this component and it is
     * the "Manage payment" button, so every job with money already collected
     * began opening into a refund form instead.
     *
     * With no way back: the refund view returns `RefundModal`, not this one.
     * A plan with one stage paid and another still owed could not be
     * collected at all. Reported from the live account within the hour.
     * ─────────────────────────────────────────────────────────────────────
     */
    expect(modal).not.toMatch(/startInRefundView\s*&&/);
    expect(drawer).not.toMatch(/startInRefundView=/);
  });

  it('opens on details unconditionally', () => {
    /*
     * Including when everything is collected. Opening on the refund form then
     * stranded an owner who came to read a date or resend a document, and
     * "Manage payment opens the payment" is a rule a person can predict.
     */
    const effect = modal.slice(modal.indexOf('ALWAYS details, including when'));

    expect(effect.slice(0, 1600)).toMatch(/setView\('details'\);/);
    expect(modal).not.toMatch(/setView\(canRefund && !hasOutstanding \? 'refund' : 'details'\)/);
  });

  it('still offers the refund, from the details view', () => {
    // Removed as an auto-open, not as a capability.
    expect(modal).toMatch(/setView\('refund'\)/);
  });
});

describe('the client can be told about the refund again', () => {
  it('replaces the receipt in the stage menu', () => {
    /*
     * "Send receipt" could only error there: `sendInvoice` refuses a refunded
     * invoice, because the document it builds carries a live pay button for
     * money the client was just given back.
     */
    /* `refunded <= 0` is the clause this test is about. The condition has since
       gained `&& (paid || !stopped)` — a cancelled demand is not re-sent — so it
       is matched as a prefix rather than in full. */
    expect(menu).toMatch(/if \(invoiceId && onSendDocument && refunded <= 0/);
    expect(menu).toMatch(/if \(refunded > 0 && onResendRefundEmail\)/);
  });

  it('is confirmed before it leaves', () => {
    // Outward-facing and unrecallable, like every other send from this drawer.
    expect(drawer).toMatch(/setShowRefundEmailConfirm\(true\)/);
    expect(drawer).toMatch(/resend-refund-confirmation`/);
  });

  it('does not claim a send that did not happen', () => {
    /*
     * A client with no email on file is a fact about their record, not a
     * failure of the request — but a green "sent" there is the UI lying to the
     * owner, who finds out when the client rings.
     */
    expect(notifier).toMatch(/export async function notifyRefund\(input: NotifyRefundInput\): Promise<boolean>/);
    expect(drawer).toMatch(/if \(data\.data\?\.sent\)/);
    expect(drawer).toMatch(/crm\.refund\.email_no_address/);
  });

  it('refuses an invoice with no refund on it', () => {
    expect(route).toMatch(/refundedAmount <= 0/);
    expect(route).not.toMatch(/invoice\.status === 'refunded'/);
  });

  it('is scoped to the signed-in owner on every read', () => {
    const scoped = route.match(/\.eq\('user_id', user\.id\)/g) ?? [];
    expect(scoped.length).toBeGreaterThanOrEqual(2);
  });

  it('sends through the one notifier rather than a second template', () => {
    expect(route).toMatch(/notifyRefund\(\{/);
    expect(route).toMatch(/notifyContact: true/);
  });
});

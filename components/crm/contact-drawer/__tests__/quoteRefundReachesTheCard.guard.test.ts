/**
 * A refund on a quoted job reaches the card that shows the job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The refund was always recorded correctly: `payment_refunds` is the ledger and
 * triggers derive `refunded_amount` / `refund_status` onto the invoice and the
 * transaction. The payments list read those and showed it.
 *
 * The booking card could not, and was blind at THREE layers at once — each of
 * which looks fine on its own:
 *
 *   1. the proposals route selected `id, status, amount, currency, due_date`
 *      and no refund column;
 *   2. it fetched only `created_invoice_id`, the deposit's invoice, so a refund
 *      against a LATER milestone was not in the payload under any column;
 *   3. `quotedPayment` returned no refund fields and a status that could only
 *      be 'paid' or 'pending'.
 *
 * Every refund surface in the drawer reads exactly the fields none of those
 * supplied, so a refunded quote looked untouched. Nothing errored, nothing
 * logged, and the payments list disagreed with the booking card about the same
 * money.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The failure is a dropped field across a route, a mapper and a renderer. There
 * is no single unit whose behaviour is wrong — each layer is correct about what
 * it was given — so what has to hold is that the data is passed on at every
 * step, and that is a property of the source.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

const route = read('app/api/business-os/proposals/route.ts');
const drawer = read('components/crm/contact-drawer/CRMContactDrawerV2.tsx');
const tab = read('components/crm/contact-drawer/BookingsTab.tsx');

describe('the route fetches what a refund is recorded in', () => {
  it('selects the derived refund columns', () => {
    expect(route).toMatch(/refunded_amount, refund_status, refunded_at/);
  });

  it('fetches every STAGE invoice, not only the proposal’s', () => {
    /*
     * Each milestone raises its own invoice when billed, and a refund attaches
     * to whichever one was paid. Reading `created_invoice_id` alone means a
     * refund against stage two is absent from the payload entirely — the drawer
     * could not have shown it however hard it looked.
     */
    expect(route).toMatch(/const stageInvoiceIds/);
    expect(route).toMatch(/\.\.\.stageInvoiceIds/);
  });

  it('attaches each stage’s own refund to that stage', () => {
    // A refund belongs to the milestone whose money came back, not to the job.
    expect(route).toMatch(/refunded_amount: stageInvoice\?\.refunded_amount/);
  });
});

describe('quotedPayment reports the money that came back', () => {
  it('sums the refund across stages rather than reading one invoice', () => {
    expect(drawer).toMatch(/const refundedAmount = stages\.length/);
    expect(drawer).toMatch(/s\.refunded_amount \|\| 0/);
  });

  it('calls it refunded only when ALL of what was collected went back', () => {
    /*
     * A partial refund leaves the status at `paid` and travels in
     * `refundedAmount` — the rule `SessionPayment.refundedAmount` documents,
     * and the reason that field exists apart from the status.
     *
     * Compared against what the stages COLLECTED, not against the agreement: a
     * ₪7,000 job with one ₪2,000 stage paid and refunded is fully refunded,
     * because there is no other money to return.
     */
    expect(drawer).toMatch(/const fullyRefunded = refundedAmount > 0 && collected > 0/);
    expect(drawer).toMatch(/status: fullyRefunded \? 'refunded'/);
  });

  it('carries the fields the UI actually reads', () => {
    expect(drawer).toMatch(/refundedAmount: refundedAmount > 0 \? refundedAmount : undefined/);
    expect(drawer).toMatch(/refundedAt,/);
  });
});

describe('the card shows it, and says which stage', () => {
  it('both strips report the returned total', () => {
    /*
     * The staged branch and the quote step. An owner looks at either when a job
     * has been unwound, and a strip that omits the refund says the money is
     * still collected.
     */
    const strips = tab.match(/refunded=\{refunded\}/g) ?? [];

    expect(strips.length).toBeGreaterThanOrEqual(2);
  });

  it('the stage row names its own refund', () => {
    /*
     * The strip can only ever report a total. "₪2,000 came back" is answerable
     * there; "which ₪2,000" is answerable only on the row.
     *
     * It moved to a second line under the figure once the row grew to five
     * facts and the label started truncating — the amount shows what was KEPT,
     * and this says how that was arrived at.
     */
    expect(tab).toMatch(/const stageRefunded = Number\(stage\.refundedAmount \|\| 0\)/);
    expect(tab).toMatch(/\{stageRefunded > 0 && \(/);
    expect(tab).toMatch(/crm\.stage\.refund_breakdown/);
  });

  it('states what the client PAID on the payment line', () => {
    /*
     * It briefly showed the net, and that misstated the event: the row reads
     * "₪X שולם 7 באוק׳", so a net figure there says the client paid ₪2,250 on
     * the 7th when they paid ₪4,500. What happened afterwards does not change
     * what was paid.
     */
    expect(tab).toMatch(/const amountText = money\(stage\.amount\);/);
  });

  it('states the refund and what survived it on the line below', () => {
    /*
     * The two figures an owner weighs after a partial refund — how much went
     * back, how much stayed — in the same words the totals strip uses, so the
     * row and the strip cannot describe one refund differently.
     */
    expect(tab).toMatch(/crm\.stage\.refund_breakdown/);
    expect(tab).toMatch(/'\{kept\}',\s*money\(Math\.max\(stage\.amount - stageRefunded, 0\)\)/);
  });

  it('shows a PARTIAL refund too, which the status cannot express', () => {
    /*
     * A partially refunded stage still reads `paid`, so without a figure it is
     * indistinguishable from an untouched one. The row is keyed on the amount,
     * not on the status.
     */
    expect(tab).not.toMatch(/stage\.status === 'refunded'/);
  });

  it('isolates the breakdown line from the row around it', () => {
    /*
     * It mixes two left-to-right currency runs into a right-to-left sentence.
     * Left loose, the bidi algorithm reorders the neutrals between them; the
     * earlier version carried a bare leading minus and rendered "−₪2,250" as
     * "₪2,250−", which reads as a typo rather than a deduction.
     */
    /* A forward window: the menu's comment sits BEFORE this block in the file,
       so bounding the slice with it ran the range backwards and matched an
       empty string — which passed nothing and failed everything. */
    const from = tab.indexOf('WHAT BECAME OF IT, under what was paid');
    expect(from).toBeGreaterThan(-1);

    const line = tab.slice(from, from + 2600);

    expect(line).toMatch(/<bdi>/);
  });
});

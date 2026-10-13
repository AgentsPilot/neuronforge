/**
 * Recording a payment by hand records what actually happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DIALOG IS FOR
 *
 * A client can pay in ways no processor sees: cash in hand, a cheque, a card
 * machine that is not ours, a bank transfer. It is also the only way an owner
 * with no Stripe at all closes an invoice. So the manual path is not an
 * edge case — for some businesses it is the whole of how money gets recorded.
 *
 * Three ways it was recording something other than the truth, each guarded
 * below. Source-level, because none of them is a function returning a wrong
 * value: what was wrong is that files stopped agreeing, or that a field with
 * five legal values only ever carried one.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');

const route = read('app/api/payments/invoices/[id]/mark-paid/route.ts');
const modal = read('components/crm/contact-drawer/PaymentManagementModal.tsx');
const settlement = read('lib/payments/invoiceSettlement.ts');

describe('the method is asked, not assumed', () => {
  it('the dialog sends the owner choice', () => {
    /*
     * It sent the literal `'bank_transfer'` for every payment, so cash was
     * recorded, reported and receipted as a transfer. The route has accepted
     * all five values since it was written.
     */
    const body = modal.slice(modal.indexOf("mark-paid`"));

    expect(body).toMatch(/payment_method:\s*paymentMethod/);
    expect(body).not.toMatch(/payment_method:\s*'bank_transfer'/);
  });

  it('every value the route accepts can be picked in the dialog', () => {
    /*
     * The two lists have to stay in step. A value in the schema with no option
     * is a method an owner cannot record; an option the schema does not name is
     * rejected by Zod at the door.
     */
    const schema = route.match(/payment_method:\s*z\.enum\(\[([^\]]+)\]/);
    expect(schema).toBeTruthy();

    const accepted = [...schema![1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]);
    expect(accepted.length).toBeGreaterThanOrEqual(5);

    const offered = modal.slice(modal.indexOf('const MANUAL_METHODS'));
    for (const value of accepted) {
      expect(offered).toMatch(new RegExp(`value:\\s*'${value}'`));
    }
  });

  it('every option has a translation key, including the cheque spelling clash', () => {
    /*
     * The API spells it `cheque` and the translation files spell it `check`, in
     * all three languages. The option carries its key explicitly so that
     * mismatch cannot show up as a blank line in the dropdown — and so neither
     * side has to be renamed, which would mean migrating stored values or
     * sweeping every locale.
     */
    const list = modal.slice(modal.indexOf('const MANUAL_METHODS'), modal.indexOf('] as const;'));

    const options = [...list.matchAll(/value:\s*'([a-z_]+)',\s*labelKey:\s*'([^']+)'/g)];
    expect(options.length).toBeGreaterThanOrEqual(5);
    for (const [, , labelKey] of options) {
      expect(labelKey).toMatch(/^payments\.payment_method\./);
    }

    const cheque = options.find(([, value]) => value === 'cheque');
    expect(cheque?.[2]).toBe('payments.payment_method.check');
  });
});

describe('a part payment is refused, not rounded up to settled', () => {
  it('the route compares the amount against the invoice', () => {
    /*
     * `settleInvoicePaid` marks the invoice AND its plan stage paid whatever
     * figure it is handed, so ₪200 against a ₪400 invoice closed the whole
     * ₪400 and the missing ₪200 stopped being owed by anybody.
     *
     * `payment_invoices` has no `amount_paid` column — there is nowhere to hold
     * "₪200 of ₪400" — so the honest answer is to refuse until there is.
     */
    expect(route).toMatch(/Math\.abs\(requestedAmount - Number\(invoice\.amount\)\)/);
    expect(route).toMatch(/status:\s*400/);
  });

  it('the check runs BEFORE the money is written', () => {
    // After the settle it would be an apology, not a guard.
    expect(route.indexOf('requestedAmount !== undefined')).toBeLessThan(
      route.indexOf('await settleInvoicePaid(')
    );
  });
});

describe('Stripe is told when it raised the invoice', () => {
  it('the route reconciles after a manual settlement', () => {
    expect(route).toMatch(/settleInvoiceAtStripe\(\{/);
    expect(route).toMatch(/stripeInvoiceId:\s*invoice\.stripe_invoice_id/);
  });

  it('it reads the Stripe id, which it has to select to have', () => {
    // A column left out of the select is `undefined`, which this helper treats
    // as "never raised at Stripe" — so the reconciliation would silently never
    // happen while every test about it still passed.
    const select = route.slice(route.indexOf(".select('id, user_id"));
    expect(select.slice(0, 200)).toMatch(/stripe_invoice_id/);
  });

  it('only on a FRESH settlement', () => {
    /*
     * `alreadySettled` means a payment was already recorded against this
     * invoice — quite possibly by Stripe itself. Paying out of band over the
     * top of a real charge is not a correction.
     */
    expect(route).toMatch(/result\.alreadySettled\s*\n?\s*\?\s*'skipped'/);
  });
});

describe('the stage keeps saying how it was paid', () => {
  it('settlement writes the method onto the installment', () => {
    /*
     * Guarded here as well as in its own unit test because this is the half
     * the mixed-method case depends on: a deposit on a card and a milestone in
     * cash have to be distinguishable on the rows themselves.
     */
    const stageUpdate = settlement.slice(settlement.indexOf("from('payment_plan_installments')"));

    expect(stageUpdate.slice(0, 2000)).toMatch(/payment_method:\s*input\.paymentMethod/);
    expect(stageUpdate.slice(0, 2000)).toMatch(/transaction_id:\s*transaction\.id/);
  });
});

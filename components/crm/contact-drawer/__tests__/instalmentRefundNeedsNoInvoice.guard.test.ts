/**
 * A paid instalment can be refunded from the row that reports it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The stage row's Refund item was gated on `invoiceId`:
 *
 *     if (paid && invoiceId && onRefund && remaining > 0)
 *
 * which is right for a quoted MILESTONE — it raises an invoice and is refunded
 * through it. An INSTALMENT period charged by the processor never gets one. The
 * money lands as a `payment_transactions` row and
 * `payment_plan_installments.invoice_id` stays null, with `transaction_id` set.
 *
 * So the owner saw ₪400 collected on a stopped job and had no way to give it
 * back from the row reporting it. Reported as "no menu with refund for paid
 * payment", on booking b68afc19 whose paid period carries
 * `transaction_id: c5637f67…` and `invoice_id: null`.
 *
 * Nothing downstream needed building, which is what made this a wiring bug
 * rather than a feature: `/api/payments/refunds` has always accepted
 * `transaction_id` as an alternative to `invoice_id`, and `RefundModal` has
 * always had the prop. Four links in the middle dropped the key — the select,
 * the stage type, the row's gate, and a `as string` cast over a null at the one
 * call site that would have made the type complain.
 *
 * SOURCE guard: `BookingsTab.tsx` is ~4,700 lines of one component with no seam
 * to render a single stage row through, and the chain being protected spans
 * five files. What matters is that each link still carries the key.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const actions = strip(read('components/crm/contact-drawer/StageRowActions.tsx'));
const tab = strip(read('components/crm/contact-drawer/BookingsTab.tsx'));
const drawer = strip(read('components/crm/contact-drawer/CRMContactDrawerV2.tsx'));
const types = strip(read('components/crm/contact-drawer/types.ts'));
const repo = strip(read('lib/repositories/SchedulingRepository.ts'));

describe('the comment stripping works', () => {
  it('removes prose that quotes the forbidden gate', () => {
    /* Without this, the negative assertion below passes on its own comment. */
    expect(read('components/crm/contact-drawer/StageRowActions.tsx')).toContain(
      'This read `invoiceId` alone'
    );
    expect(actions).not.toContain('This read `invoiceId` alone');
  });
});

describe('the row offers Refund on either key', () => {
  it('accepts a transaction where there is no invoice', () => {
    expect(actions).toContain(
      'if (paid && (invoiceId || transactionId) && onRefund && remaining > 0)'
    );
  });

  it('no longer requires an invoice', () => {
    expect(actions).not.toContain('if (paid && invoiceId && onRefund');
  });

  it('still requires the stage to be paid, with something left to return', () => {
    /*
     * The widening is about WHICH key, not about when. An unpaid period must
     * not offer a refund, and a fully refunded one stops offering it.
     */
    const gate = actions.slice(
      actions.indexOf('if (paid && (invoiceId || transactionId)'),
      actions.indexOf('if (paid && (invoiceId || transactionId)') + 120
    );

    expect(gate).toContain('paid &&');
    expect(gate).toContain('remaining > 0');
  });

  it('takes the key as a prop', () => {
    expect(actions).toContain('transactionId?: string | null;');
  });
});

describe('every link in the chain carries it', () => {
  it('the query selects it', () => {
    /* The first link. The column existed and was simply never asked for. */
    const select = repo.slice(
      repo.indexOf('planPeriods:payment_plan_installments'),
      repo.indexOf('planPeriods:payment_plan_installments') + 240
    );

    expect(select).toContain('transaction_id');
  });

  it('the stage type declares it', () => {
    expect(types).toContain('transactionId?: string | null;');
  });

  it('the plan builder maps it onto the stage', () => {
    expect(drawer).toContain('transactionId: p.transaction_id ?? null,');
  });

  it('the row is given it', () => {
    expect(tab).toContain('transactionId={stage.transactionId}');
  });

  it('the refund callback forwards it', () => {
    const call = tab.slice(tab.indexOf('onRefundStage({'), tab.indexOf('onRefundStage({') + 300);

    expect(call).toContain('transactionId: stage.transactionId ?? null,');
  });

  it('and the dialog receives it', () => {
    expect(drawer).toContain('transactionId={refundStage.transactionId ?? undefined}');
  });
});

describe('the null that the types used to hide', () => {
  it('invoiceId is nullable on the refund payload, not cast from null', () => {
    /*
     * `invoiceId: stage.invoiceId as string` is what let this ship: the cast
     * silenced the one place the compiler would have pointed at the null.
     */
    const payload = tab.slice(
      tab.indexOf('onRefundStage?: (stage: {'),
      tab.indexOf('onRefundStage?: (stage: {') + 400
    );

    expect(payload).toContain('invoiceId: string | null;');
    expect(payload).toContain('transactionId: string | null;');
    expect(tab).not.toContain('invoiceId: stage.invoiceId as string');
  });

  it('and the dialog is handed undefined rather than null', () => {
    /* `RefundModal` picks its query key by truthiness, and a null prop would
       read as "given" while carrying nothing. */
    expect(drawer).toContain('invoiceId={refundStage.invoiceId ?? undefined}');
  });
});

/**
 * Join plan payments back to the bills they paid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG, AND WHAT THIS PUTS RIGHT.
 *
 * `recordPlanPeriodPaid` recorded the payment and ticked off the instalment,
 * and never wrote two things: `payment_transactions.invoice_id`, and the
 * invoice's own `paid`. So a plan payment arrived, the plan knew, and the bill
 * went on saying `overdue` for ever.
 *
 * The visible damage: a client emailed to pay money they had already paid, and
 * every such plan reporting its paid instalment TWICE — once as collected via
 * the transaction, once as outstanding via the stale invoice. An 800 plan read
 * 1,200.
 *
 * THE INSTALMENT IS THE AUTHORITY. It carries both links already —
 * `invoice_id` and `transaction_id` — written at the moment the money arrived.
 * Nothing here infers anything: it copies what the instalment already knows
 * onto the two rows that should have had it.
 *
 * Safe to run twice. Every write is guarded on the row still being wrong.
 *
 *   npx tsx -r dotenv/config scripts/backfill-plan-invoice-links.ts dotenv_config_path=.env.local
 *   add --apply to write. Without it, nothing is changed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const APPLY = process.argv.includes('--apply');
const SETTLED = ['paid', 'refunded', 'partially_refunded'];

type Row = Record<string, unknown>;
const line = (s = '') => console.log(s);

async function main() {
  line(APPLY ? '*** APPLYING ***\n' : 'DRY RUN — nothing will be written. Add --apply.\n');

  /* Every instalment that has been paid and knows both sides of the join. */
  const { data: paid, error } = await db
    .from('payment_plan_installments')
    .select('id, user_id, installment_number, invoice_id, transaction_id, paid_at')
    .eq('status', 'paid')
    .not('invoice_id', 'is', null);

  if (error) {
    line(`could not read instalments: ${error.message}`);
    process.exit(1);
  }

  const rows = (paid ?? []) as Row[];
  line(`paid instalments carrying an invoice: ${rows.length}`);

  const invoiceIds = [...new Set(rows.map(r => r.invoice_id as string))];
  const { data: invoices } = await db
    .from('payment_invoices')
    .select('id, invoice_number, status, paid_at, user_id')
    .in('id', invoiceIds);
  const invoiceById = new Map(((invoices ?? []) as Row[]).map(i => [i.id as string, i]));

  const txIds = [...new Set(rows.map(r => r.transaction_id as string).filter(Boolean))];
  const { data: txs } = await db
    .from('payment_transactions')
    .select('id, invoice_id, user_id')
    .in('id', txIds);
  const txById = new Map(((txs ?? []) as Row[]).map(t => [t.id as string, t]));

  const staleInvoices: Row[] = [];
  const unlinkedTx: { tx: Row; invoiceId: string; inst: Row }[] = [];

  for (const inst of rows) {
    const invoice = invoiceById.get(inst.invoice_id as string);
    if (invoice && !SETTLED.includes(String(invoice.status))) {
      staleInvoices.push({ ...invoice, _paidAt: inst.paid_at });
    }
    const tx = inst.transaction_id ? txById.get(inst.transaction_id as string) : undefined;
    if (tx && !tx.invoice_id) {
      unlinkedTx.push({ tx, invoiceId: inst.invoice_id as string, inst });
    }
  }

  line(`\n1. BILLS PAID BUT NOT MARKED PAID: ${staleInvoices.length}`);
  for (const i of staleInvoices) {
    line(`   ${i.invoice_number}  ${i.status} → paid   (paid_at ← ${String(i._paidAt ?? '').slice(0, 19) || 'now'})`);
  }

  line(`\n2. PAYMENTS NOT JOINED TO THEIR BILL: ${unlinkedTx.length}`);
  for (const u of unlinkedTx.slice(0, 10)) {
    line(`   ${String(u.tx.id).slice(0, 8)} → invoice ${String(u.invoiceId).slice(0, 8)}  (instalment #${u.inst.installment_number})`);
  }
  if (unlinkedTx.length > 10) line(`   … and ${unlinkedTx.length - 10} more`);

  if (!APPLY) {
    line('\nNothing written. Re-run with --apply to make these changes.');
    return;
  }

  let fixedInvoices = 0;
  for (const i of staleInvoices) {
    /* Guarded on the status still being wrong, so a second run is a no-op and
       a bill settled by hand in the meantime is left alone. */
    const { error: e } = await db
      .from('payment_invoices')
      .update({
        status: 'paid',
        /* The moment the money actually arrived, from the instalment — never
           the moment this script happened to run. */
        paid_at: (i._paidAt as string) ?? new Date().toISOString(),
      })
      .eq('id', i.id as string)
      .eq('user_id', i.user_id as string)
      .not('status', 'in', `(${SETTLED.join(',')})`);
    if (e) line(`   ! ${i.invoice_number}: ${e.message}`);
    else fixedInvoices += 1;
  }

  let fixedTx = 0;
  for (const u of unlinkedTx) {
    const { error: e } = await db
      .from('payment_transactions')
      .update({ invoice_id: u.invoiceId })
      .eq('id', u.tx.id as string)
      .eq('user_id', u.tx.user_id as string)
      .is('invoice_id', null);
    if (e) line(`   ! ${String(u.tx.id).slice(0, 8)}: ${e.message}`);
    else fixedTx += 1;
  }

  line(`\nDONE. invoices marked paid: ${fixedInvoices}   payments joined: ${fixedTx}`);
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

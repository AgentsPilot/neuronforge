/**
 * Record the payments behind invoices that were settled without one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THESE ROWS ARE MISSING
 *
 * Two code paths could mark an invoice paid. `settleInvoicePaid` — the
 * mark-paid route and every processor path — writes a `payment_transactions`
 * row alongside the invoice update. `paymentInvoiceRepository.markAsPaid`, used
 * by the booking PUT, updated only the invoice.
 *
 * So an invoice settled from the booking reads `paid` with no payment behind
 * it. Two things follow:
 *
 *   - Revenue is understated. The money reports count transactions, not
 *     invoices, so the amount never appears.
 *   - The contact is never promoted. `promote_contact_on_payment` is a trigger
 *     ON `payment_transactions` — money arriving is what makes someone a client
 *     — so a quoted job's deposit was collected while the client stayed a
 *     prospect.
 *
 * The code paths are now unified. This closes the rows already written.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT WILL AND WILL NOT DO
 *
 * Only invoices that are `paid`, have an amount, and have NO transaction. It
 * never touches an invoice, never changes a stage directly, and never writes a
 * second transaction for one already recorded — so running it twice is safe.
 *
 * The promotion is left to the trigger rather than written here. Inserting the
 * payment is the true fact; the stage follows from it by the same rule that
 * governs every other payment, which is the point.
 *
 * Usage:
 *   npx tsx scripts/backfill-missing-payment-transactions.ts          # dry run
 *   npx tsx scripts/backfill-missing-payment-transactions.ts --apply
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const APPLY = process.argv.includes('--apply');

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: paidInvoices, error } = await db
    .from('payment_invoices')
    .select('id, user_id, invoice_number, amount, currency, contact_id, paid_at, payment_method, processor_type, status')
    .eq('status', 'paid');

  if (error) throw error;

  const { data: transactions, error: txError } = await db
    .from('payment_transactions')
    .select('invoice_id');

  if (txError) throw txError;

  const recorded = new Set((transactions ?? []).map(t => t.invoice_id).filter(Boolean));

  const missing = (paidInvoices ?? []).filter(
    inv => !recorded.has(inv.id) && Number(inv.amount) > 0
  );

  console.log('');
  console.log(`  paid invoices        ${paidInvoices?.length ?? 0}`);
  console.log(`  already recorded     ${recorded.size}`);
  console.log(`  missing a payment    ${missing.length}`);
  console.log('');

  for (const inv of missing) {
    console.log(
      `  ${inv.invoice_number}  ${inv.currency} ${inv.amount}  contact=${
        inv.contact_id ? String(inv.contact_id).slice(0, 8) : 'NONE (no promotion)'
      }  paid_at=${inv.paid_at ?? '(unknown)'}`
    );
  }

  if (!APPLY) {
    console.log('');
    console.log('  Dry run. Re-run with --apply to write.');
    return;
  }

  let written = 0;

  for (const inv of missing) {
    // The instant the money was recorded as arriving. Falls back to now only
    // when the invoice never captured one, so a backfilled payment is never
    // dated earlier than the fact it describes.
    const paidAt = inv.paid_at ?? new Date().toISOString();

    const { error: insertError } = await db.from('payment_transactions').insert({
      user_id: inv.user_id,
      contact_id: inv.contact_id ?? null,
      invoice_id: inv.id,
      amount: inv.amount,
      currency: String(inv.currency).toUpperCase(),
      status: 'succeeded',
      payment_method: inv.payment_method ?? 'manual',
      processor_type: inv.processor_type ?? 'manual',
      description: `Invoice ${inv.invoice_number}`,
      paid_at: paidAt,
      refund_status: 'none',
      refunded_amount: 0,
      // No Stripe account was involved. Stated explicitly so the refund path
      // does not try to return money through one that never received it.
      stripe_connect_account_id: null,
      charge_account_kind: 'platform',
      account_resolution: 'recorded',
      metadata: {
        source: 'backfill_missing_transaction',
        reason: 'Invoice was settled through a path that did not record a payment',
      },
    });

    if (insertError) {
      console.error(`  x ${inv.invoice_number} failed: ${insertError.message}`);
      continue;
    }

    written++;
    console.log(`  + ${inv.invoice_number} recorded`);
  }

  console.log('');
  console.log(`  wrote ${written} of ${missing.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

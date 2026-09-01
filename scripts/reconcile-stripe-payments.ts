/**
 * Reconcile the database against Stripe.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe is authoritative for: whether an invoice was paid, when, how much,
 * which payment intent settled it, which account the charge lives on, and what
 * has been refunded.
 *
 * The database is authoritative for: who the invoice belongs to, which contact
 * and booking it relates to, and what it is called. This script NEVER rewrites
 * that half from Stripe.
 *
 * WHY IT EXISTS
 *
 * The webhook spent months routing connected-account events down the platform
 * branch, so client payments were never recorded. Three invoices on this account
 * were paid ₪200 each and still read `overdue` — the business was chasing
 * customers who had already paid. The database cannot know this; only Stripe
 * can.
 *
 * SAFETY
 *
 *   · dry run by default — writing needs --apply AND --confirm=<n> matching
 *   · read-only against Stripe: retrieve and list, never create
 *   · never deletes; corrections are inserts and updates
 *   · a row whose Stripe account cannot be established is REPORTED, never
 *     rewritten. Wrong refund state is worse than no refund state.
 *
 *   npx tsx -r dotenv/config scripts/reconcile-stripe-payments.ts --mode=invoices dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/reconcile-stripe-payments.ts --mode=invoices --apply --confirm=3 dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/reconcile-stripe-payments.ts --mode=refunds dotenv_config_path=.env.local
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Stripe from 'stripe';
import { supabaseServer } from '../lib/supabaseServer';
import { settleInvoicePaid } from '../lib/payments/invoiceSettlement';

const arg = (name: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const MODE = (arg('mode') ?? 'invoices') as 'invoices' | 'refunds' | 'accounts';
const APPLY = process.argv.includes('--apply');
const CONFIRM = arg('confirm') ? Number(arg('confirm')) : null;
const USER = arg('user');

interface InvoiceRow {
  id: string;
  user_id: string;
  contact_id: string | null;
  invoice_number: string | null;
  amount: number;
  currency: string;
  status: string;
  stripe_invoice_id: string | null;
}

/**
 * The payment intent that settled an invoice, across API versions.
 *
 * `invoice.payment_intent` was removed in the 2025 API versions; settlement now
 * hangs off `invoice.payments[].payment`. This account is already on the newer
 * shape — every paid invoice here returns `payment_intent: undefined` while
 * carrying a real one under `payments`. Reading only the old field would repair
 * these invoices into rows that can never be refunded.
 */
function paymentIntentOf(invoice: unknown): string | null {
  const inv = invoice as {
    payment_intent?: string | { id: string };
    payments?: { data?: Array<{ payment?: { payment_intent?: string | { id: string } } }> };
  };

  const asId = (v: unknown): string | null =>
    typeof v === 'string' ? v : (v as { id?: string })?.id ?? null;

  return asId(inv.payment_intent) ?? asId(inv.payments?.data?.[0]?.payment?.payment_intent);
}

async function accountFor(userId: string): Promise<string | undefined> {
  const { data } = await supabaseServer
    .from('stripe_connect_accounts')
    .select('stripe_account_id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.stripe_account_id ?? undefined;
}

/**
 * Invoices Stripe says were paid, that this database does not know about.
 *
 * The repair writes a payment through `settleInvoicePaid` — the same path a
 * webhook uses — so the transaction, the invoice status and every trigger that
 * hangs off them behave identically to a payment that had arrived normally.
 */
async function reconcileInvoices(stripe: Stripe) {
  let query = supabaseServer
    .from('payment_invoices')
    .select('id, user_id, contact_id, invoice_number, amount, currency, status, stripe_invoice_id')
    .not('stripe_invoice_id', 'is', null)
    .order('created_at', { ascending: false });

  if (USER) query = query.eq('user_id', USER);

  const { data, error } = await query;
  if (error) throw error;

  const invoices = (data ?? []) as InvoiceRow[];
  const accounts = new Map<string, string | undefined>();
  const repairs: Array<{ invoice: InvoiceRow; amountPaid: number; paymentIntent: string | null; paidAt: string; account?: string }> = [];

  console.log(`Examining ${invoices.length} invoice(s) with a Stripe invoice.\n`);

  for (const invoice of invoices) {
    if (!accounts.has(invoice.user_id)) {
      accounts.set(invoice.user_id, await accountFor(invoice.user_id));
    }
    const account = accounts.get(invoice.user_id);

    let stripeInvoice: Stripe.Invoice;
    try {
      stripeInvoice = await stripe.invoices.retrieve(
        invoice.stripe_invoice_id!,
        { expand: ['payments'] } as Stripe.InvoiceRetrieveParams,
        account ? { stripeAccount: account } : undefined
      );
    } catch (err) {
      console.log(`  NOT IN STRIPE   ${invoice.invoice_number}  ${(err as Error).message.slice(0, 60)}`);
      continue;
    }

    const amountPaid = (stripeInvoice.amount_paid ?? 0) / 100;
    const stripePaid = stripeInvoice.status === 'paid' || amountPaid > 0;
    const dbPaid = ['paid', 'refunded', 'partially_refunded'].includes(invoice.status);

    // Already settled here? Then whether a transaction exists is what matters,
    // and that is the orphan check rather than this one.
    if (!stripePaid || dbPaid) {
      console.log(`  ok              ${invoice.invoice_number}  db:${invoice.status}`);
      continue;
    }

    const paymentIntent = paymentIntentOf(stripeInvoice);
    const paidAt = stripeInvoice.status_transitions?.paid_at
      ? new Date(stripeInvoice.status_transitions.paid_at * 1000).toISOString()
      : new Date().toISOString();

    console.log(
      `  PAID, MISSING   ${invoice.invoice_number}  ${amountPaid} ${invoice.currency}  db:${invoice.status}  pi:${paymentIntent ?? 'none'}`
    );

    repairs.push({ invoice, amountPaid, paymentIntent, paidAt, account });
  }

  console.log(`\n${repairs.length} payment(s) to record, ${repairs.reduce((s, r) => s + r.amountPaid, 0)} total.`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply --confirm=' + repairs.length + ' to write these.');
    return;
  }

  // The count must match what the dry run reported. If the data moved between
  // the two runs, the operator is approving something they have not seen.
  if (CONFIRM !== repairs.length) {
    console.error(
      `\nRefusing to write: --confirm=${CONFIRM} does not match the ${repairs.length} change(s) found.`
    );
    process.exit(1);
  }

  for (const repair of repairs) {
    const result = await settleInvoicePaid(supabaseServer, {
      invoiceId: repair.invoice.id,
      userId: repair.invoice.user_id,
      contactId: repair.invoice.contact_id,
      amount: repair.amountPaid,
      currency: repair.invoice.currency,
      paidAt: repair.paidAt,
      paymentMethod: 'card',
      processorType: 'stripe',
      stripePaymentIntentId: repair.paymentIntent,
      // Proved against Stripe just now, which is what makes these refundable.
      // Without it they would be `unknown` and the refund path would refuse.
      accountContext: {
        stripe_connect_account_id: repair.account ?? null,
        charge_account_kind: repair.account ? 'connect' : 'platform',
        account_resolution: 'reconciled',
      },
      description: `Payment for invoice ${repair.invoice.invoice_number}`,
      metadata: { source: 'reconciliation', stripe_invoice_id: repair.invoice.stripe_invoice_id },
    });

    console.log(
      `  recorded  ${repair.invoice.invoice_number}  tx:${result.transactionId}${result.alreadySettled ? ' (already existed)' : ''}`
    );
  }

  console.log(`\nDone. ${repairs.length} payment(s) recorded.`);
}

/**
 * Refunds Stripe knows about that the ledger does not — dashboard refunds, and
 * anything issued before `charge.refunded` was handled.
 */
async function reconcileRefunds(stripe: Stripe) {
  let query = supabaseServer
    .from('payment_transactions')
    .select('id, user_id, invoice_id, amount, currency, refunded_amount, stripe_payment_intent_id, stripe_charge_id, stripe_connect_account_id, account_resolution')
    .in('status', ['succeeded', 'refunded']);

  if (USER) query = query.eq('user_id', USER);

  const { data, error } = await query;
  if (error) throw error;

  const transactions = data ?? [];
  console.log(`Examining ${transactions.length} settled payment(s).\n`);

  const writes: Array<Record<string, unknown>> = [];

  for (const tx of transactions) {
    if (!['recorded', 'reconciled'].includes(tx.account_resolution ?? '')) {
      // Asking the wrong account returns an empty list, which would read as
      // "no refunds" and could later let an over-refund through.
      console.log(`  SKIP (account unresolved)  ${tx.id.slice(0, 8)}`);
      continue;
    }
    if (!tx.stripe_payment_intent_id && !tx.stripe_charge_id) {
      console.log(`  SKIP (no Stripe reference) ${tx.id.slice(0, 8)}`);
      continue;
    }

    const options = tx.stripe_connect_account_id
      ? { stripeAccount: tx.stripe_connect_account_id }
      : undefined;

    let refunds: Stripe.ApiList<Stripe.Refund>;
    try {
      refunds = await stripe.refunds.list(
        tx.stripe_payment_intent_id
          ? { payment_intent: tx.stripe_payment_intent_id, limit: 100 }
          : { charge: tx.stripe_charge_id!, limit: 100 },
        options
      );
    } catch (err) {
      console.log(`  ERROR  ${tx.id.slice(0, 8)}  ${(err as Error).message.slice(0, 60)}`);
      continue;
    }

    const stripeTotal = refunds.data
      .filter(r => r.status === 'succeeded')
      .reduce((sum, r) => sum + r.amount, 0) / 100;

    const dbTotal = Number(tx.refunded_amount ?? 0);

    if (Math.abs(stripeTotal - dbTotal) < 0.005) continue;

    console.log(
      `  DIFFERS  ${tx.id.slice(0, 8)}  db ${dbTotal} → stripe ${stripeTotal}  (${refunds.data.length} refund(s))`
    );

    for (const r of refunds.data) {
      writes.push({
        user_id: tx.user_id,
        transaction_id: tx.id,
        invoice_id: tx.invoice_id,
        amount: r.amount / 100,
        amount_minor: r.amount,
        currency: (r.currency || tx.currency).toUpperCase(),
        status: r.status === 'succeeded' ? 'succeeded' : 'pending',
        processor_type: 'stripe',
        processor_refund_id: r.id,
        stripe_connect_account_id: tx.stripe_connect_account_id,
        idempotency_key: `stripe:${r.id}`,
        source: 'reconciler',
        succeeded_at: r.status === 'succeeded' ? new Date(r.created * 1000).toISOString() : null,
        metadata: { origin: 'reconciliation' },
      });
    }
  }

  console.log(`\n${writes.length} ledger row(s) to write.`);

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply --confirm=' + writes.length + ' to write these.');
    return;
  }

  if (CONFIRM !== writes.length) {
    console.error(`\nRefusing to write: --confirm=${CONFIRM} does not match ${writes.length}.`);
    process.exit(1);
  }

  // Upsert on the Stripe refund id, so a row the webhook already created is
  // matched rather than duplicated. The triggers recompute the totals.
  const { error: writeError } = await supabaseServer
    .from('payment_refunds')
    .upsert(writes, { onConflict: 'processor_refund_id' });

  if (writeError) throw writeError;
  console.log(`\nDone. ${writes.length} refund(s) reconciled.`);
}

/** Payments whose Stripe account was never recorded, and therefore cannot be refunded. */
async function reportUnresolvedAccounts() {
  let query = supabaseServer
    .from('payment_transactions')
    .select('id, user_id, amount, currency, account_resolution, stripe_payment_intent_id')
    .in('status', ['succeeded', 'refunded'])
    .in('account_resolution', ['unknown', 'ambiguous']);

  if (USER) query = query.eq('user_id', USER);

  const { data } = await query;
  const rows = data ?? [];

  console.log(`${rows.length} settled payment(s) with an unresolved Stripe account.\n`);
  for (const row of rows) {
    console.log(`  ${row.id.slice(0, 8)}  ${row.amount} ${row.currency}  ${row.account_resolution}  pi:${row.stripe_payment_intent_id ?? 'none'}`);
  }
  if (rows.length) {
    console.log('\nThese cannot be refunded until their account is established.');
  }
}

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set.');
    process.exit(1);
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  console.log(`mode=${MODE}  ${APPLY ? 'APPLY' : 'dry run'}${USER ? `  user=${USER}` : ''}\n`);

  if (MODE === 'invoices') await reconcileInvoices(stripe);
  else if (MODE === 'refunds') await reconcileRefunds(stripe);
  else await reportUnresolvedAccounts();

  if (!APPLY) console.log('\nNothing was written.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

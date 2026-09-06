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
 *   npx tsx -r dotenv/config scripts/reconcile-stripe-payments.ts --mode=references dotenv_config_path=.env.local
 *   npx tsx -r dotenv/config scripts/reconcile-stripe-payments.ts --mode=fees dotenv_config_path=.env.local
 * ─────────────────────────────────────────────────────────────────────────────
 */
import Stripe from 'stripe';
import { fromMinorUnits } from '../lib/payments/refundMath';
import { supabaseServer } from '../lib/supabaseServer';
import { settleInvoicePaid } from '../lib/payments/invoiceSettlement';
import { resolveInvoicePaymentIntent } from '../lib/payments/invoicePaymentIntent';
import { resolveProcessorFee } from '../lib/payments/processorFee';

const arg = (name: string) =>
  process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const MODE = (arg('mode') ?? 'invoices') as
  | 'invoices'
  | 'refunds'
  | 'accounts'
  | 'pending'
  | 'references'
  | 'fees';

/**
 * How old a `pending` refund must be before this tool will judge it.
 *
 * A refund in flight right now is not stuck. Fifteen minutes is far longer than
 * any Stripe call, and short enough that a genuinely orphaned row does not hold
 * a transaction hostage for a day.
 */
const PENDING_STALE_MINUTES = 15;
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

    // Summed in MINOR units and converted once. Dividing each refund by 100
    // assumed two decimals and, in the tool meant to REPAIR refund state,
    // reported a ¥ total a hundredfold too small — so a genuinely reconciled
    // row looked like a discrepancy and was rewritten wrong.
    const stripeTotal = fromMinorUnits(
      refunds.data.filter(r => r.status === 'succeeded').reduce((sum, r) => sum + r.amount, 0),
      tx.currency
    );

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
        amount: fromMinorUnits(r.amount, (r.currency || tx.currency).toUpperCase()),
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

/**
 * Close out refund rows that were opened and never resolved.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `RefundService` writes a `pending` ledger row BEFORE calling Stripe, so that a
 * crash leaves evidence rather than an invisible refund. The over-refund guard
 * counts `pending` toward the budget, deliberately — money that may be moving
 * must not be promised twice.
 *
 * Both are right, and together they leak. A process killed between the insert
 * and the response leaves a row `pending` FOREVER: the guard keeps reserving
 * that amount, so the payment becomes permanently un-refundable and reports
 * `EXCEEDS_REMAINING` against a `refunded_amount` of zero.
 *
 * `idx_payment_refunds_pending` was created as "the reconciler's work queue".
 * Nothing read it until now.
 *
 * The judgement is deliberately one-sided: a row is only marked `failed` when
 * Stripe can be asked and says the refund is not there. Marking one failed while
 * the money actually moved would release budget that is not free and permit a
 * genuine over-refund — so an unresolved account is skipped, not guessed at.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function settlePendingRefunds(stripe: Stripe) {
  const staleBefore = new Date(Date.now() - PENDING_STALE_MINUTES * 60_000).toISOString();

  let query = supabaseServer
    .from('payment_refunds')
    .select('id, user_id, transaction_id, amount_minor, currency, created_at, metadata')
    .eq('status', 'pending')
    .is('processor_refund_id', null)
    .lt('created_at', staleBefore)
    .order('created_at', { ascending: true });

  if (USER) query = query.eq('user_id', USER);

  const { data: rows, error } = await query;
  if (error) throw error;

  console.log(`${rows?.length ?? 0} pending refund(s) older than ${PENDING_STALE_MINUTES} minutes\n`);
  if (!rows?.length) return;

  let settled = 0;
  let failed = 0;

  for (const row of rows) {
    const { data: tx } = await supabaseServer
      .from('payment_transactions')
      .select('id, stripe_payment_intent_id, stripe_charge_id, stripe_connect_account_id, account_resolution')
      .eq('id', row.transaction_id)
      .maybeSingle();

    if (!tx) {
      console.log(`  SKIP (no transaction)      ${row.id.slice(0, 8)}`);
      continue;
    }

    // The same two guards the refunds mode uses, for the same reasons.
    if (!['recorded', 'reconciled'].includes(tx.account_resolution ?? '')) {
      console.log(`  SKIP (account unresolved)  ${row.id.slice(0, 8)}`);
      continue;
    }
    if (!tx.stripe_payment_intent_id && !tx.stripe_charge_id) {
      console.log(`  SKIP (no Stripe reference) ${row.id.slice(0, 8)}`);
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
      console.log(`  SKIP (stripe error)        ${row.id.slice(0, 8)}  ${(err as Error).message}`);
      continue;
    }

    /*
     * Match by the ledger row id carried in the refund's metadata, falling back
     * to an exact minor-unit amount that no other ledger row has claimed.
     *
     * The metadata path is exact and covers everything issued after that change
     * shipped. The fallback exists for rows opened before it, and is narrow on
     * purpose: adopting the wrong refund would mark one row succeeded and leave
     * another orphaned.
     */
    const byMetadata = refunds.data.find(r => r.metadata?.refund_row_id === row.id);

    const unclaimed = byMetadata
      ? [byMetadata]
      : await (async () => {
          const candidates = refunds.data.filter(r => r.amount === Number(row.amount_minor));
          if (candidates.length !== 1) return candidates;

          const { data: claimed } = await supabaseServer
            .from('payment_refunds')
            .select('id')
            .eq('processor_refund_id', candidates[0].id)
            .maybeSingle();

          return claimed ? [] : candidates;
        })();

    if (unclaimed.length !== 1) {
      console.log(
        `  SKIP (${unclaimed.length === 0 ? 'no match' : 'ambiguous'})         ${row.id.slice(0, 8)}`
      );
      continue;
    }

    const match = unclaimed[0];

    if (match.status === 'succeeded') {
      console.log(`  SETTLE  ${row.id.slice(0, 8)} → succeeded  ${match.id}`);
      settled++;

      if (APPLY) {
        await supabaseServer
          .from('payment_refunds')
          .update({
            status: 'succeeded',
            processor_refund_id: match.id,
            succeeded_at: new Date(match.created * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', row.id);
      }
      continue;
    }

    if (match.status === 'pending') {
      console.log(`  WAIT    ${row.id.slice(0, 8)}  still pending at Stripe`);
      continue;
    }

    console.log(`  RELEASE ${row.id.slice(0, 8)} → failed (${match.status})`);
    failed++;

    if (APPLY) {
      await supabaseServer
        .from('payment_refunds')
        .update({
          status: 'failed',
          processor_refund_id: match.id,
          failure_code: match.failure_reason ?? match.status ?? 'not_succeeded',
          failure_message: 'Resolved by the pending sweep: Stripe reports this refund did not succeed.',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    }
  }

  console.log(`\n${settled} settled, ${failed} released.`);
  if (settled + failed > 0 && !APPLY) {
    console.log(`Re-run with --apply --confirm=${settled + failed} to write.`);
  }
}

/**
 * Payments that settled through Stripe but carry no reference to it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every payment plan installment was written this way: `recordPlanPeriodPaid`
 * stored the Stripe INVOICE id and nothing else, so `RefundService` had neither
 * a payment intent nor a charge to refund against. The money is real, the client
 * paid it, and it could not be returned. The webhook now records the intent; the
 * periods already collected need it filled in, and only Stripe knows it.
 *
 * NARROW BY CONSTRUCTION. Only rows that have a `stripe_invoice_id`, no
 * reference of either kind, and a resolvable account are touched — a payment
 * genuinely taken outside Stripe (cash, bank transfer) has no invoice id and is
 * never visited. Nothing is inferred: if Stripe does not name the payment
 * intent, the row is reported and left exactly as it is.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function backfillPaymentReferences(stripe: Stripe) {
  let query = supabaseServer
    .from('payment_transactions')
    .select('id, user_id, amount, currency, description, invoice_id, stripe_connect_account_id, created_at')
    .in('status', ['succeeded', 'refunded'])
    .eq('processor_type', 'stripe')
    .is('stripe_payment_intent_id', null)
    .is('stripe_charge_id', null)
    .order('created_at', { ascending: false });

  if (USER) query = query.eq('user_id', USER);

  const { data: rows, error } = await query;
  if (error) {
    console.error('Could not read transactions:', error.message);
    return;
  }

  if (!rows?.length) {
    console.log('Every settled Stripe payment already has its reference.');
    return;
  }

  console.log(`${rows.length} settled payment(s) with no Stripe reference:\n`);

  let repaired = 0;
  let unresolved = 0;

  for (const row of rows) {
    const label = `${row.currency} ${row.amount}  ${row.description ?? ''}`.trim();

    /*
     * Which Stripe invoice settled this payment.
     *
     * `payment_transactions` has NO `stripe_invoice_id` column — the id lives on
     * whichever record owns the arrangement:
     *
     *   · a plan period → `payment_plan_installments.stripe_invoice_id`
     *   · an invoice     → `payment_invoices.stripe_invoice_id`
     *
     * An earlier version of this backfill filtered on
     * `payment_transactions.stripe_invoice_id` and simply errored out on every
     * run — "column does not exist" — so nothing was ever repaired.
     */
    let stripeInvoiceId: string | null = null;

    const { data: installment } = await supabaseServer
      .from('payment_plan_installments')
      .select('stripe_invoice_id')
      .eq('transaction_id', row.id)
      .not('stripe_invoice_id', 'is', null)
      .maybeSingle();

    stripeInvoiceId = installment?.stripe_invoice_id ?? null;

    if (!stripeInvoiceId && row.invoice_id) {
      const { data: invoice } = await supabaseServer
        .from('payment_invoices')
        .select('stripe_invoice_id')
        .eq('id', row.invoice_id)
        .maybeSingle();

      stripeInvoiceId = invoice?.stripe_invoice_id ?? null;
    }

    if (!stripeInvoiceId) {
      console.log(`  ?  ${label} — no Stripe invoice recorded anywhere, skipped`);
      unresolved++;
      continue;
    }

    // Direct-charge invoices are invisible from the platform account, and
    // guessing an account could attach another business's payment intent.
    const account = row.stripe_connect_account_id ?? (await accountFor(row.user_id));
    if (!account) {
      console.log(`  ?  ${label} — no Stripe account resolved, skipped`);
      unresolved++;
      continue;
    }

    let intent: string | null = null;
    try {
      const invoice = await stripe.invoices.retrieve(
        stripeInvoiceId,
        { expand: ['payments'] } as Stripe.InvoiceRetrieveParams,
        { stripeAccount: account }
      );
      intent = await resolveInvoicePaymentIntent(invoice, stripe, account);
    } catch (err) {
      console.log(`  ?  ${label} — Stripe could not return ${stripeInvoiceId}: ${(err as Error).message}`);
      unresolved++;
      continue;
    }

    if (!intent) {
      console.log(`  ?  ${label} — Stripe names no payment intent for ${stripeInvoiceId}`);
      unresolved++;
      continue;
    }

    console.log(`  →  ${label}   ${intent}`);
    repaired++;

    if (APPLY && CONFIRM === rows.length) {
      const { error: writeError } = await supabaseServer
        .from('payment_transactions')
        .update({
          stripe_payment_intent_id: intent,
          // The account is recorded alongside it, because a refund needs both
          // and `resolveRefundAccount` refuses on `account_resolution: unknown`.
          // A row repaired from Stripe is reconciled by definition.
          stripe_connect_account_id: account,
          account_resolution: 'reconciled',
        })
        .eq('id', row.id);

      if (writeError) console.error(`     write failed: ${writeError.message}`);
    }
  }

  console.log(`\n${repaired} refundable, ${unresolved} still without a reference.`);
  if (repaired > 0 && !APPLY) {
    console.log(`Re-run with --apply --confirm=${rows.length} to write.`);
  }
}

/**
 * What the processor kept, for payments recorded before fees were tracked.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Every payment this platform has ever taken was recorded without a fee, so the
 * business's P&L is out by roughly 3% on every sale — and a refunded payment is
 * out by the whole fee, because Stripe does not give it back.
 *
 * ASKED, NEVER CALCULATED. The fee comes from each charge's balance
 * transaction. A rate applied here would be confidently wrong for every payment
 * on a different card type, country or currency.
 *
 * A charge that has not settled yet has no balance transaction. Those are
 * REPORTED and left alone, so a later run picks them up — writing zero would
 * make them indistinguishable from a payment that genuinely cost nothing, and
 * this tool would never visit them again.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function backfillProcessorFees(stripe: Stripe) {
  let query = supabaseServer
    .from('payment_transactions')
    .select('id, user_id, amount, currency, description, stripe_payment_intent_id, stripe_charge_id, stripe_connect_account_id, created_at')
    .in('status', ['succeeded', 'refunded'])
    .eq('processor_type', 'stripe')
    .is('processor_fee', null)
    .order('created_at', { ascending: false });

  if (USER) query = query.eq('user_id', USER);

  const { data: rows, error } = await query;
  if (error) {
    console.error('Could not read transactions:', error.message);
    return;
  }

  if (!rows?.length) {
    console.log('Every settled Stripe payment already has its fee recorded.');
    return;
  }

  console.log(`${rows.length} settled payment(s) with no fee recorded:\n`);

  let priced = 0;
  let unknown = 0;
  const feeTotals: Record<string, number> = {};

  for (const row of rows) {
    const label = `${row.currency} ${row.amount}  ${row.description ?? ''}`.trim();

    const account = row.stripe_connect_account_id ?? (await accountFor(row.user_id));

    // Direct charges live on the connected account; asked from the platform the
    // charge does not exist. Guessing an account could read another business's
    // fee onto this payment.
    if (!account) {
      console.log(`  ?  ${label} — no Stripe account resolved, skipped`);
      unknown++;
      continue;
    }

    const fee = await resolveProcessorFee({
      stripe,
      account,
      chargeId: row.stripe_charge_id,
      paymentIntentId: row.stripe_payment_intent_id,
    });

    if (!fee) {
      console.log(`  ?  ${label} — Stripe reports no settled fee yet`);
      unknown++;
      continue;
    }

    console.log(`  →  ${label}   fee ${fee.feeCurrency} ${fee.fee}   net ${fee.net}`);
    feeTotals[fee.feeCurrency] =
      Math.round(((feeTotals[fee.feeCurrency] ?? 0) + fee.fee) * 100) / 100;
    priced++;

    if (APPLY && CONFIRM === rows.length) {
      const { error: writeError } = await supabaseServer
        .from('payment_transactions')
        .update({
          processor_fee: fee.fee,
          net_amount: fee.net,
          fee_currency: fee.feeCurrency,
        })
        .eq('id', row.id);

      if (writeError) console.error(`     write failed: ${writeError.message}`);
    }
  }

  // Per currency, never summed across: Stripe charges the fee in the SETTLEMENT
  // currency, so one business can genuinely have fees in two.
  const summary = Object.entries(feeTotals)
    .map(([currency, amount]) => `${currency} ${amount}`)
    .join(', ');

  console.log(`\n${priced} priced${summary ? ` (fees: ${summary})` : ''}, ${unknown} still unknown.`);
  if (priced > 0 && !APPLY) {
    console.log(`Re-run with --apply --confirm=${rows.length} to write.`);
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
  else if (MODE === 'pending') await settlePendingRefunds(stripe);
  else if (MODE === 'references') await backfillPaymentReferences(stripe);
  else if (MODE === 'fees') await backfillProcessorFees(stripe);
  else await reportUnresolvedAccounts();

  if (!APPLY) console.log('\nNothing was written.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

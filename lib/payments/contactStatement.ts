/**
 * What one client owes and what they have paid — the data behind a statement.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ONE CAPABILITY AND NOT FOUR CALLS
 *
 * "Email Dana what's outstanding" is answerable from existing pieces: find her
 * invoices, filter to the open ones, find her payments, total both. But that
 * asks the caller to know three things it has no business knowing — which
 * statuses count as open, that money reaches a contact through invoices AND
 * transactions, and that two currencies must never be added together.
 *
 * Getting any of those wrong produces a number that looks perfectly ordinary
 * and is wrong, in an email chasing a client for money. So the assembly lives
 * here, once, and the caller gets a statement it can read out.
 *
 * THE OPEN RULE IS READ, NOT RESTATED. `unpaid` is a business rule with a
 * single home — `semanticTerms` on `invoices.status` in the catalog — after
 * previously being duplicated in three places that drifted. This reads it from
 * there rather than becoming the fourth copy.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/contactStatement
 */

import 'server-only';

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { CATALOG } from '@/lib/business-os/catalog';

const logger = createLogger({ module: 'ContactStatement' });

export interface StatementInvoice {
  id: string;
  invoice_number: string | null;
  amount: number;
  currency: string;
  status: string;
  due_date: string | null;
  created_at: string;
  description: string | null;
}

export interface StatementPayment {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paid_at: string | null;
  created_at: string;
  description: string | null;
  invoice_number: string | null;
}

/** A total is always per currency: adding ILS to USD invents a number. */
export interface StatementTotal {
  currency: string;
  amount: number;
  count: number;
}

export interface ContactStatement {
  contact: { id: string; name: string; email: string | null };
  /** The statuses that counted as open, so a reader can see the rule applied. */
  openStatuses: string[];
  openInvoices: StatementInvoice[];
  openTotals: StatementTotal[];
  payments: StatementPayment[];
  paidTotals: StatementTotal[];
  /** True when a list hit its cap and more rows exist. */
  truncated: boolean;
}

export class ContactStatementError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'ContactStatementError';
  }
}

/** Enough for any real statement; a cap so one client cannot pull the table. */
const MAX_ROWS = 200;

/**
 * Which invoice statuses mean "still owed", from the catalog's own definition.
 *
 * Falls back to the same two values the catalog declares rather than to
 * something permissive: if the lookup ever fails, a statement that lists too
 * FEW invoices is a visible mistake, whereas one that counts drafts and
 * cancelled invoices as owed is an accusation.
 */
function openInvoiceStatuses(): string[] {
  const declared = CATALOG.entities.invoices?.fields?.status?.semanticTerms?.unpaid;
  if (Array.isArray(declared) && declared.length > 0) return declared as string[];

  logger.warn('Catalog did not declare the unpaid statuses; falling back');
  return ['sent', 'overdue'];
}

function totalsByCurrency(
  rows: Array<{ amount: number; currency: string }>
): StatementTotal[] {
  const byCurrency = new Map<string, StatementTotal>();

  for (const row of rows) {
    const currency = row.currency || '';
    if (!currency) continue;

    const existing = byCurrency.get(currency) ?? { currency, amount: 0, count: 0 };
    existing.amount += Number(row.amount) || 0;
    existing.count += 1;
    byCurrency.set(currency, existing);
  }

  return [...byCurrency.values()].map(total => ({
    ...total,
    // Money summed as floats drifts: 632.3299999999999 is what the ledger
    // aggregate returns today. Two decimals is what a statement means.
    amount: Math.round(total.amount * 100) / 100,
  }));
}

const invoiceNumberOf = (invoice: unknown): string | null => {
  const row = Array.isArray(invoice) ? invoice[0] : invoice;
  return (row as { invoice_number?: string })?.invoice_number ?? null;
};

/**
 * One client's open invoices and payments.
 *
 * A READ: nothing is written, nothing is sent. The caller decides what to say
 * and whether to say it.
 */
export async function buildContactStatement(params: {
  userId: string;
  contactId: string;
}): Promise<ContactStatement> {
  const { userId, contactId } = params;
  const openStatuses = openInvoiceStatuses();

  const [contactResult, invoicesResult, paymentsResult] = await Promise.all([
    supabaseServer
      .from('crm_contacts')
      .select('id, first_name, last_name, email')
      .eq('id', contactId)
      .eq('user_id', userId)
      .maybeSingle(),

    supabaseServer
      .from('payment_invoices')
      .select('id, invoice_number, amount, currency, status, due_date, created_at, description')
      .eq('user_id', userId)
      .eq('contact_id', contactId)
      .in('status', openStatuses)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(MAX_ROWS),

    // What actually arrived. `succeeded` only — a failed attempt is not a
    // payment, and listing one in a statement tells a client they have paid.
    supabaseServer
      .from('payment_transactions')
      .select(
        'id, amount, currency, status, paid_at, created_at, description, ' +
          'invoice:payment_invoices(invoice_number)'
      )
      .eq('user_id', userId)
      .eq('contact_id', contactId)
      .eq('status', 'succeeded')
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS),
  ]);

  const failure = contactResult.error || invoicesResult.error || paymentsResult.error;
  if (failure) {
    logger.error({ err: failure, userId, contactId }, 'Statement read failed');
    throw new ContactStatementError('Could not read the statement', failure);
  }

  if (!contactResult.data) {
    throw new ContactStatementError('Contact not found');
  }

  const contactRow = contactResult.data as {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  };

  const openInvoices: StatementInvoice[] = ((invoicesResult.data ?? []) as unknown[]).map(i => {
    const row = i as Record<string, unknown>;
    return {
      id: String(row.id),
      invoice_number: (row.invoice_number as string) ?? null,
      amount: Number(row.amount) || 0,
      currency: String(row.currency ?? ''),
      status: String(row.status ?? ''),
      due_date: (row.due_date as string) ?? null,
      created_at: String(row.created_at),
      description: (row.description as string) ?? null,
    };
  });

  const payments: StatementPayment[] = ((paymentsResult.data ?? []) as unknown[]).map(p => {
    const row = p as Record<string, unknown>;
    return {
      id: String(row.id),
      amount: Number(row.amount) || 0,
      currency: String(row.currency ?? ''),
      status: String(row.status ?? ''),
      paid_at: (row.paid_at as string) ?? null,
      created_at: String(row.created_at),
      description: (row.description as string) ?? null,
      invoice_number: invoiceNumberOf(row.invoice),
    };
  });

  return {
    contact: {
      id: contactRow.id,
      name: [contactRow.first_name, contactRow.last_name].filter(Boolean).join(' '),
      email: contactRow.email ?? null,
    },
    openStatuses,
    openInvoices,
    openTotals: totalsByCurrency(openInvoices),
    payments,
    paidTotals: totalsByCurrency(payments),
    truncated: openInvoices.length >= MAX_ROWS || payments.length >= MAX_ROWS,
  };
}

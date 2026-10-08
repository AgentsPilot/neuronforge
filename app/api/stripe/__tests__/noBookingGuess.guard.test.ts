/**
 * A paid invoice is never matched to a booking by guesswork.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * The Connect `invoice.paid` handler used to have a fallback: when an invoice
 * carried no `booking_id`, it looked for one — same contact, a booking whose
 * SERVICE PRICE equalled the invoice amount, most recent unpaid one wins. On a
 * match it marked that booking paid and wrote its id onto the invoice.
 *
 * Three loose signals cannot tell an invoice raised FOR a booking from a
 * standalone invoice that happens to cost the same. For a business selling one
 * service repeatedly at one price that is not an edge case, it is the ordinary
 * shape of the data.
 *
 * On live data it bound a standalone ₪300 invoice, at the moment it was paid, to
 * an unrelated booking three days older that already had its own ₪300 invoice.
 * Two silent consequences:
 *
 *   · the invoice left the "invoices without an order" tab and merged into that
 *     booking's row, which then read ₪600 overdue — one paid invoice and one
 *     unpaid, added together as though they were one job;
 *   · the booking was marked PAID by money that was never for it.
 *
 * And `booking_id` is what every later read follows, so the binding was
 * permanent.
 *
 * A SOURCE GUARD, because the alternative is standing up a Stripe webhook, a
 * Connect account and a matching booking to prove a negative. What has to stay
 * true is structural — this handler must not query bookings by contact-and-price
 * — and that is exactly what a source assertion can hold.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

const webhook = fs.readFileSync(
  path.join(process.cwd(), 'app/api/stripe/webhook/route.ts'),
  'utf8'
);

/*
 * CF-5 PR 2 moved the paid handler's invoice queries into
 * `PaymentInvoiceRepository` (workplan BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES
 * §7.3.3, SA C-2). The "never writes booking_id onto an invoice" check would
 * then pass on an empty handler, so it follows the writes into the repository:
 * the handler reaches the table only through an allow-listed set of methods,
 * the ones of those that write are exactly two, and neither writes booking_id.
 */
const REPOSITORY_FILE = path.join(process.cwd(), 'lib/repositories/PaymentRepository.ts');
const repositorySf = ts.createSourceFile(
  REPOSITORY_FILE,
  fs.readFileSync(REPOSITORY_FILE, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TS
);

/** The methods of `PaymentInvoiceRepository`, by name (overload signatures skipped). */
function invoiceRepositoryMethods(): Map<string, ts.MethodDeclaration> {
  const methods = new Map<string, ts.MethodDeclaration>();
  const visit = (node: ts.Node) => {
    if (ts.isClassDeclaration(node) && node.name?.text === 'PaymentInvoiceRepository') {
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && member.body) methods.set(member.name.getText(repositorySf), member);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(repositorySf);
  return methods;
}

/** A method's code without comments (its doc may explain booking_id; its body may not use it). */
function codeOfMethod(method: ts.MethodDeclaration): string {
  return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, method, repositorySf);
}

const WRITE_OPS = /\.(update|insert|upsert|delete)\(/;

/** The only invoice-repository methods the paid handler may call. */
const PAID_HANDLER_INVOICE_METHODS = [
  'findByStripeInvoiceId',
  'findByIdUnscoped',
  'recordStripeInvoiceId',
  'markPaidFromStripeInvoice',
  'readFieldsUnscoped',
];

/** The `invoice.paid` handler, where the guess used to live. */
function connectInvoicePaidHandler(): string {
  const start = webhook.indexOf('async function handleConnectInvoicePaid');
  expect(start).toBeGreaterThan(-1);
  // To the next top-level function, which bounds the handler well enough.
  const next = webhook.indexOf('\nasync function ', start + 1);
  return webhook.slice(start, next === -1 ? undefined : next);
}

describe('paying an invoice never invents a booking link', () => {
  it('does not search for a booking to attach a paid invoice to', () => {
    // The exact shape of the old fallback: find a booking, then adopt it.
    expect(webhook).not.toMatch(/matchingBooking/);
  });

  it('never writes booking_id onto an invoice from the paid handler', () => {
    /*
     * The permanent half of the damage. Marking a booking paid is recoverable;
     * writing the id onto the invoice is what every later read then follows.
     */
    const handler = connectInvoicePaidHandler();

    expect(handler).not.toMatch(/from\(['"]payment_invoices['"]\)[\s\S]{0,200}booking_id:/);
  });

  it('reaches payment_invoices only through allow-listed repository methods (CF-5 PR 2, SA C-2)', () => {
    const handler = connectInvoicePaidHandler();

    // No inline query on the table in any quote style, so the check above is
    // not the only thing standing between the handler and an inline write.
    expect(handler).not.toMatch(/from\(\s*['"`]payment_invoices['"`]\s*\)/);
    // Only the singleton, never a class instance built around the allow-list.
    expect(handler).not.toMatch(/\bPaymentInvoiceRepository\b/);

    // Every mention of the singleton is a direct call to an allow-listed
    // method: no alias, no other method (the generic user-scoped `update`
    // accepts any column, booking_id included).
    const mentions = handler.match(/\bpaymentInvoiceRepository\b/g) ?? [];
    const calls = [...handler.matchAll(/\bpaymentInvoiceRepository\.(\w+)\(/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(mentions.length);
    for (const method of calls) expect(PAID_HANDLER_INVOICE_METHODS).toContain(method);
  });

  it('the paid handler writes payment_invoices through exactly two methods, and neither writes booking_id (SA C-2)', () => {
    const handler = connectInvoicePaidHandler();
    const methods = invoiceRepositoryMethods();
    const called = new Set([...handler.matchAll(/\bpaymentInvoiceRepository\.(\w+)\(/g)].map((m) => m[1]));

    // Which of the called methods write is read from the repository's code,
    // not taken from the method names.
    const writers = [...called].filter((name) => {
      const method = methods.get(name);
      expect(method).toBeDefined();
      return WRITE_OPS.test(codeOfMethod(method!));
    });
    expect(writers.sort()).toEqual(['markPaidFromStripeInvoice', 'recordStripeInvoiceId']);

    for (const name of writers) {
      const code = codeOfMethod(methods.get(name)!);
      expect(code).toMatch(/from\('payment_invoices'\)/);
      expect(code).not.toContain('booking_id');
    }

    // And no method the handler calls goes looking for a booking either.
    for (const name of called) {
      const code = codeOfMethod(methods.get(name)!);
      expect(code).not.toMatch(/scheduling_/);
      expect(code).not.toMatch(/servicePrice/);
    }
  });

  it('does not match a booking by its service price', () => {
    // `Math.abs(servicePrice - invoiceAmount) < 0.01` was the whole test that
    // bound unrelated money together.
    const handler = connectInvoicePaidHandler();

    expect(handler).not.toMatch(/servicePrice/);
    expect(handler).not.toMatch(/scheduling_services\(price\)/);
  });

  it('still marks the booking paid when the invoice genuinely names one', () => {
    /*
     * The other half, and the reason this is not simply "delete the code". An
     * invoice raised against a booking carries `booking_id` from creation, and
     * that booking must still be settled when it is paid.
     */
    const handler = connectInvoicePaidHandler();

    expect(handler).toMatch(/if \(platformInvoice\.booking_id\)/);
    expect(handler).toMatch(/payment_status: 'paid'/);
  });

  it('says in the log that an unlinked invoice was left unlinked', () => {
    // So the next person reading production logs sees a decision rather than a
    // gap, and does not re-add the guess to "fix" the silence.
    const handler = connectInvoicePaidHandler();

    expect(handler).toMatch(/left unlinked rather than matched by guess/);
  });
});

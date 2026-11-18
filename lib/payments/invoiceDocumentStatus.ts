/**
 * What the STATUS LINE on an invoice document should say.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE PDF SAID "DRAFT" ON EVERY INVOICE ANYONE EVER RECEIVED.
 *
 * `InvoicePDFGenerator` prints `labels[status_${invoice.status}]`, and the row
 * is still `draft` at the moment the document is built: `markDelivered` runs
 * AFTER the mail is away, deliberately, because an invoice marked sent that
 * nobody received is the failure `InvoiceDeliveryService` exists to prevent.
 *
 * That ordering is right for the row and wrong for the paper. The client
 * opened a demand for money stamped DRAFT, which reads as "not a real invoice
 * yet" and is precisely the thing a person does not pay. Found on a live
 * account: the client booked, the invoice went out, and the badge on the
 * document said draft.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT LIVES HERE, AND NOT IN THE DELIVERY SERVICE
 *
 * `sendingNeverUnpaysAnInvoice.guard.test.ts` forbids the literal
 * `status: 'sent'` anywhere in `InvoiceDeliveryService.ts`. That guard is not
 * fussiness: two unconditional writes of exactly that string once overwrote a
 * client's payment, and the invoice went on asking for money it had taken.
 *
 * This function does not write anything — it returns a copy for a renderer —
 * but a reader skimming that file for status writes should find none, and a
 * guard with an exception is a guard that erodes. So the one place that needs
 * to say the word says it here, where writing to the database is not what this
 * module does.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments
 */

/**
 * The invoice as the client will hold it, for the document only.
 *
 * Only `draft` is touched. A resend of a paid invoice still says PAID, an
 * overdue one still says OVERDUE, and a cancelled one is refused long before
 * any document is built.
 */
export function asDelivered<T extends { status?: string | null }>(invoice: T): T {
  return invoice.status === 'draft' ? { ...invoice, status: 'sent' } : invoice;
}

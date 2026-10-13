/**
 * Where a client is sent to pay an invoice, from any email that offers to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONE FUNCTION
 *
 * Five senders carry a Pay button — the booking confirmation, the rescheduled
 * email, the invoice itself, the payment reminders, and the insight-driven
 * chase — and each decided the destination for itself. All five reached the
 * same conclusion:
 *
 *     invoice.stripe_hosted_invoice_url || <something of ours>
 *
 * so a client paying from email landed on `invoice.stripe.com`: Stripe's
 * branding, Stripe's layout, no sign of the business whose bill it was, and no
 * sign of the appointment it was for. The comment in `PaymentReminderService`
 * said why — "Stripe's hosted page is preferred because it can actually take
 * the money" — and that was true when it was written. It is not any more: both
 * the portal and the invoice page mount Stripe's Payment Element themselves.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 *
 *   · an invoice with a booking behind it  → the PORTAL, payment open
 *   · an invoice with none                 → the invoice page
 *   · never Stripe's hosted page
 *
 * The portal because the client can see what they are paying for: the
 * appointment, the plan it belongs to, the other sessions. An invoice raised
 * cold has no booking to show and no token to sign, so it keeps the invoice
 * page — which carries the document, the VAT breakdown, the bank details and
 * the same card fields.
 *
 * This is the shape `/proposal/[token]` already uses for quotes: into the
 * portal where there is a booking, standalone where there is not.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ASYNC, FOR A FUNCTION THAT COMPUTES A STRING
 *
 * It reads the booking, which is a database call — that is the only reason
 * left. `generateBookingToken` used to be the other one: it lived in
 * `BookingEmailService`, 38 static imports deep, so this reached it through a
 * dynamic `import()` at call time to keep that weight out of the graph. The
 * token now lives in `lib/services/bookingToken`, a leaf over `jsonwebtoken`,
 * and is imported normally.
 *
 * Nothing here touches Stripe, and nothing here decides whether money can be
 * taken — `resolveInvoicePaymentOptions` still owns that. This only decides
 * which of OUR pages the client opens.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { generateInvoiceToken } from '@/lib/payments/invoiceAccessToken';
import { generateBookingToken } from '@/lib/services/bookingToken';
import { supabaseServer } from '@/lib/supabaseServer';

export interface InvoicePayLinkInput {
  /** The invoice being paid. Always required: it is the fallback destination. */
  invoiceId: string;
  /** The booking it was raised against, when it was raised against one. */
  bookingId?: string | null;
  /**
   * The owner, so the booking lookup below cannot cross a tenant.
   * CLAUDE.md rule 4.
   */
  userId: string;
  /** Absolute origin. Callers already resolve this their own way. */
  baseUrl: string;
}

export async function invoicePayLink({
  invoiceId,
  bookingId,
  userId,
  baseUrl,
}: InvoicePayLinkInput): Promise<string> {
  const origin = baseUrl.replace(/\/+$/, '');
  /*
   * SIGNED, always.
   *
   * The invoice page honours a bare URL only while the invoice is younger than
   * the token lifetime, so every link we mint from here carries a token and
   * keeps working on its own terms rather than on the invoice's age.
   */
  const invoicePage = `${origin}/invoice/${invoiceId}?t=${await generateInvoiceToken(invoiceId)}`;

  if (!bookingId) return invoicePage;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE ADDRESS THE PORTAL WILL ACTUALLY CHECK, NOT THE ONE ON THE INVOICE.
   *
   * `/api/book/manage/[token]` compares the token's email against the
   * BOOKING'S CONTACT and returns "booking not found" when they differ. An
   * invoice carries `client_email` as a snapshot taken when it was raised, so
   * a contact who has since changed address would be sent a Pay button that
   * resolves to nothing — on the one link where a dead end costs the business
   * the payment.
   *
   * One indexed read, on a path that is already sending an email.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { data: booking } = await supabaseServer
    .from('scheduling_bookings')
    .select('id, contact:crm_contacts(email)')
    .eq('id', bookingId)
    .eq('user_id', userId)
    .maybeSingle();

  const contact = Array.isArray(booking?.contact) ? booking?.contact[0] : booking?.contact;
  const email = (contact?.email as string | undefined) ?? null;

  /* No booking, or no address to sign for: the invoice page still works and
     still takes the payment. A link that shows the bill beats none. */
  if (!email) return invoicePage;

  /*
   * `?pay=1` so the portal opens with the card fields already showing. A
   * client who followed a Pay button and then had to find the Pay button again
   * would reasonably think the link was wrong.
   */
  return `${origin}/book/manage/${generateBookingToken(bookingId, email)}?pay=1`;
}

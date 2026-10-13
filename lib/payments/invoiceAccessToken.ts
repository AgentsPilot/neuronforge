/**
 * The signed link a client opens to read and pay one invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FIXES
 *
 * `/invoice/[id]` was authorised by the invoice's UUID alone — the route said
 * so: "the invoice id in the URL is the authorisation". A v4 UUID is 122 bits
 * and cannot be guessed, so this was never an enumeration risk.
 *
 * The risk is PERMANENCE. Unlike the booking token, a bare invoice URL has no
 * expiry and is bound to nobody, so it is a bearer credential that works
 * forever for anyone it is ever forwarded to — and what it discloses is the
 * client's name, postal address, email, every line item, the amounts, and the
 * business's bank details. It also yields a Stripe `confirmation_secret`
 * through `/api/public/invoice/[id]/intent`.
 *
 * A booking token ages out in thirty days. An invoice link did not age at all.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE BARE URL STILL WORKS, AND FOR EXACTLY HOW LONG
 *
 * Invoice emails already sent carry a bare `/invoice/<id>`, and refusing those
 * outright would take a client's own bill away from them — including clients
 * who are trying to pay it.
 *
 * So the rule is the one the token itself implies: a bare URL is honoured while
 * the invoice that carried it is younger than `TOKEN_EXPIRY_DAYS`. That is not
 * an arbitrary cutoff — it is the same window we would have granted had the
 * link been signed. A bare link is exactly as old as the email that delivered
 * it, so inside the window it is no weaker than a token, and beyond it, it has
 * outlived what any token of ours would have allowed.
 *
 * The result: every link in an inbox today keeps working, and no invoice stays
 * readable forever.
 *
 * `isInvoiceLinkFresh` is the half that governs bare URLs; `verify` governs
 * signed ones. Both must be applied by every surface that serves an invoice, or
 * the weakest one becomes the way in — which is why `/intent` enforces it too.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import * as jwt from 'jsonwebtoken';

import { supabaseServer } from '@/lib/supabaseServer';

/**
 * Fatal when unset, for the reason given in `BookingEmailService` and
 * `proposalToken`: the token IS the authorisation, so one signed with a string
 * committed to this repository could be minted by anyone for any invoice.
 */
function secret(): string {
  const configured = process.env.BOOKING_TOKEN_SECRET || process.env.NEXTAUTH_SECRET;

  if (!configured) {
    throw new Error(
      'BOOKING_TOKEN_SECRET (or NEXTAUTH_SECRET) must be set to sign invoice links'
    );
  }

  return configured;
}

/**
 * Thirty days, matching the booking token rather than the proposal's 180.
 *
 * A quote sits in an inbox while someone decides; a bill is acted on or chased.
 * The reminders re-send a fresh link on their own schedule, so a client who
 * leaves one unpaid is handed a new window rather than left with a dead URL.
 */
export const TOKEN_EXPIRY_DAYS = 30;

export interface InvoiceTokenPayload {
  invoiceId: string;
  /** The address this link was issued to. Absent on nothing — see below. */
  email?: string | null;
}

/**
 * The address the client is reachable at NOW, not the snapshot on the invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * This is what gives invoice links the revocation property booking links
 * already have for free: `/api/book/manage/[token]` compares a token's email
 * against the booking's CURRENT contact, so changing a client's email silently
 * invalidates every outstanding link for them. Reading `client_email` — the
 * snapshot written when the invoice was raised — would not do that, because the
 * snapshot never changes.
 *
 * `client_email` remains the fallback for an invoice with no linked contact: a
 * cold invoice has nothing else to bind to, and refusing to sign one would take
 * away the only way its client can pay. Those links do not gain
 * revocation-on-change, which is a real limitation and the reason the fallback
 * is narrow rather than the default.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function contactEmailFor(invoiceId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from('payment_invoices')
    .select('client_email, contact:crm_contacts(email)')
    .eq('id', invoiceId)
    .maybeSingle();

  const contact = Array.isArray(data?.contact) ? data?.contact[0] : data?.contact;

  return (
    ((contact?.email as string | undefined) ?? (data?.client_email as string | undefined)) || null
  );
}

/** Lower-cased and trimmed, so a capitalised address is still the same person. */
const sameAddress = (a?: string | null, b?: string | null) =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

export async function generateInvoiceToken(invoiceId: string): Promise<string> {
  const email = await contactEmailFor(invoiceId);
  return jwt.sign({ invoiceId, email }, secret(), { expiresIn: `${TOKEN_EXPIRY_DAYS}d` });
}

/** Null for anything tampered with, expired, or simply not one of ours. */
export function verifyInvoiceToken(token: string): InvoiceTokenPayload | null {
  // Outside the try: a missing secret is a misconfiguration, not a bad token,
  // and returning null for it would tell every client with a valid link that
  // their link was invalid while nothing said why.
  const key = secret();

  try {
    const decoded = jwt.verify(token, key) as InvoiceTokenPayload;
    if (!decoded?.invoiceId) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * May this request see this invoice?
 *
 * One answer for every surface that serves one, so the page and the payment
 * endpoint cannot disagree about who is allowed in. A disagreement here is not
 * a cosmetic bug: it is the endpoint handing out a Stripe secret for a document
 * the page would have refused to show.
 *
 * `token` wins when it is present and names THIS invoice. The id in the URL is
 * never trusted over the one in the verified payload.
 */
export type InvoiceAccessReason =
  | 'token'
  | 'fresh'
  | 'expired'
  | 'bad_token'
  | 'address_changed';

export async function mayViewInvoice(input: {
  invoiceId: string;
  token?: string | null;
  /** `sent_at`, falling back to `created_at` — when the link went out. */
  issuedAt?: string | Date | null;
  now?: Date;
}): Promise<{ allowed: boolean; reason: InvoiceAccessReason }> {
  if (input.token) {
    const payload = verifyInvoiceToken(input.token);

    /*
     * The id in the URL is never trusted over the one in the verified payload.
     * Without this, a token for any invoice would open every invoice.
     */
    if (payload?.invoiceId !== input.invoiceId) {
      /*
       * A token that is present and wrong is refused rather than quietly
       * falling back to the freshness rule. Otherwise stripping a signature off
       * a URL would grant MORE access than presenting it, which makes signing
       * the link pointless.
       */
      return { allowed: false, reason: 'bad_token' };
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE ADDRESS, COMPARED AGAINST THE CONTACT AS THEY ARE NOW.
     *
     * This is the revocation. A booking token already has it — the portal
     * compares against the booking's current contact — so changing a client's
     * email invalidates every outstanding booking link for them. Invoice links
     * now behave the same way, with no denylist and nothing to expire.
     *
     * A token minted before the address was bound carries no `email`. There is
     * no such token in anyone's inbox — none of this has shipped — so it is
     * refused rather than admitted on the old terms. Admitting it would leave a
     * permanent way to present an unbound token and be let in.
     * ───────────────────────────────────────────────────────────────────────
     */
    const current = await contactEmailFor(input.invoiceId);

    return sameAddress(payload.email, current)
      ? { allowed: true, reason: 'token' }
      : { allowed: false, reason: 'address_changed' };
  }

  const issued = input.issuedAt ? new Date(input.issuedAt) : null;
  if (!issued || Number.isNaN(issued.getTime())) {
    /*
     * An invoice with no issue date has never been sent to anybody, so no bare
     * link to it was ever handed out and there is nothing to keep working.
     */
    return { allowed: false, reason: 'expired' };
  }

  const ageDays = ((input.now ?? new Date()).getTime() - issued.getTime()) / 86_400_000;

  /*
   * `fresh` is the bare-URL path, and it is the one to WATCH. Every caller
   * logs it, so the decision to stop honouring bare URLs can be taken from how
   * often they are actually used rather than from a guess at a date. When this
   * approaches zero, `INVOICE_BARE_URL_GRACE_DAYS` goes to 0 and the rule
   * collapses to "signed links only".
   */
  return ageDays <= bareUrlGraceDays()
    ? { allowed: true, reason: 'fresh' }
    : { allowed: false, reason: 'expired' };
}

/**
 * How long a BARE url is honoured, in days.
 *
 * Defaults to the token lifetime, which is the argument for honouring one at
 * all: a bare link is exactly as old as the email that delivered it, so inside
 * that window it is no weaker than a token we would have signed.
 *
 * Set `INVOICE_BARE_URL_GRACE_DAYS=0` to require a signed link for every
 * invoice. Deliberately an env var and NOT a hardcoded sunset date: a date
 * changes behaviour silently, months later, when nobody is watching and nobody
 * remembers. Locking a client out of their own bill should be a decision
 * somebody made, not a constant quietly expiring.
 */
export function bareUrlGraceDays(): number {
  const raw = process.env.INVOICE_BARE_URL_GRACE_DAYS;
  if (raw === undefined || raw === '') return TOKEN_EXPIRY_DAYS;

  const parsed = Number(raw);
  /* A malformed value falls back to the default rather than to zero: a typo in
     an env var must not lock every client out of every invoice. */
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : TOKEN_EXPIRY_DAYS;
}

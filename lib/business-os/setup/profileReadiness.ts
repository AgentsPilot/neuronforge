/**
 * Whether the business profile and the invoice details are filled in.
 *
 * These are the two readiness steps that live in user settings rather than in
 * the configuration dialog, and neither had any signal behind it — a business
 * could send invoices for months with no company name, no tax id and no address
 * on them, and nothing on screen would say so.
 *
 * Kept pure, outside the route and the component, so "what counts as complete"
 * is one readable list with tests against it rather than a condition buried in
 * a query. Same shape as funnelGap.ts and stageLabels.ts.
 */

/** Fields from `business_profiles` that the settings form writes. */
import { resolveDocumentType } from '@/lib/payments/documentType';

export interface BusinessProfileFields {
  company_name?: string | null;
  vertical?: string | null;
  /**
   * The PUBLIC contact details — what a client uses to reach this business.
   *
   * Not the account's login email: that is `auth.users.email` and it is often
   * a personal address nobody wants printed on a booking page.
   */
  phone?: string | null;
  email?: string | null;
  /**
   * `business_profiles.logo_url`. Optional in this type on purpose: the column
   * arrives with the logo migration, and until it does the caller has no value
   * to pass. Treated as missing, never as a reason to fail.
   */
  logo_url?: string | null;
}

/** `organizations.settings` — the rest of what that same form writes. */
export interface OrganizationSettings {
  industry?: string | null;
  company_size?: string | null;
  primary_goal?: string | null;
  technical_level?: string | null;
  /**
   * What the owner calls their business, in their own words.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE ANSWER THAT HAD NOWHERE TO GO.
   *
   * `business_profiles.vertical` is a PIPELINE KEY, picked from a fixed list,
   * and `default` is a legitimate value for a business the list cannot
   * describe. The check below is right to refuse the sentinel — and until this
   * field existed it also made the gap unfixable: no question asked for a
   * business type, no form could set one, and the dashboard asked for it
   * anyway. Measured on a renovation contractor, who read "Business type:
   * Service Provider" in settings and "business type missing" on the dashboard
   * in the same session.
   *
   * So the two facts are now separate. The pipeline stays whatever fits, even
   * when that is the generic board; this holds what the business IS, free text,
   * answered in settings. Either one satisfies the gate: a trade we have a
   * preset for needs no typing, and a trade we do not can still be named.
   * ───────────────────────────────────────────────────────────────────────────
   */
  business_type?: string | null;
}

export type ProfileField =
  | 'company_name'
  | 'business_type'
  /*
   * No 'logo'.
   *
   * A logo is not something a business can be incomplete for. Plenty of them
   * do not have one — a sole practitioner, a new business, anyone who simply
   * has not made one — and nothing on the platform stops working without it:
   * the header falls back to the business name, the invoice PDF and the emails
   * render perfectly well. It was counted here, so its absence made the profile
   * "incomplete", which made the readiness step outstanding and — until this —
   * could refuse a website publish over a missing image.
   *
   * Asking for one is still worth doing; it is just never a gate. That belongs
   * in a prompt somewhere, not in a completeness test every gate reads.
   */
  | 'industry'
  | 'company_size'
  | 'primary_goal'
  | 'technical_level'
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * 'phone' AND 'email' — ASKED FOR, BECAUSE NOTHING ELSE EVER ASKS.
   *
   * These were deliberately excluded, on the argument that a contact section
   * falls back to the enquiry form so a page without them still works. That
   * argument is sound about the PAGE and wrong about the BUSINESS, and the
   * thing it missed is where the answer would otherwise come from:
   *
   *   the onboarding chat has no question for either. Not a skipped one, not
   *   an optional one — no question exists, so a business that never opens
   *   settings has no way to be reachable by phone or by mail, and nothing in
   *   the product ever mentions it.
   *
   * A prompt was the previous answer and a prompt is only as good as the
   * screen it appears on. Making them part of the profile step puts them in
   * the one place every account is walked through, once, at the start.
   *
   * WHAT THIS DOES NOT DO: it does not block an invoice. `journeyReadiness`
   * lists both in `NOT_NEEDED_TO_INVOICE`, because a legal document needs a
   * company name, a tax id, an address and a way to be paid — not a phone
   * number. The gate they reach is the profile step, which is where they are
   * typed.
   * ───────────────────────────────────────────────────────────────────────────
   */
  | 'phone'
  | 'email';

/** Fields from `business_profiles` that the invoice settings section writes. */
export interface InvoiceFields {
  invoice_company_name?: string | null;
  invoice_tax_id?: string | null;
  /**
   * Which document this business issues, and the setting the automatic choice
   * is derived from. Both already live on the same row and are written by the
   * same panel; they are declared here because `missingInvoiceFields` now has
   * to know which document it is checking for.
   */
  invoice_document_type?: string | null;
  invoice_prices_include_tax?: boolean | null;
  invoice_address?: InvoiceAddress | null;
  invoice_bank_name?: string | null;
  invoice_bank_account?: string | null;
  invoice_payment_instructions?: string | null;
}

export interface InvoiceAddress {
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export type InvoiceField = 'company_name' | 'tax_id' | 'address' | 'payment_method';

/**
 * A field counts as filled only if it holds something a person typed.
 *
 * Whitespace does not count: a form saved with a space in a box is empty, and
 * treating it as complete would put a blank line on an invoice where the tax id
 * belongs.
 */
function hasValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * The values `vertical` holds when nothing is known about the trade.
 *
 * `default` is the fallback pipeline preset's own key, written by the story
 * extraction when it cannot read a trade from what the owner typed. `other`
 * is the same sentinel under its previous name and is still in older rows.
 */
const UNKNOWN_VERTICALS = new Set(['default', 'other']);

/**
 * What the business profile is still missing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOT every field the form exposes. This comment used to claim that it was, and
 * the claim was false: `BusinessProfileSection` also writes `website_url`,
 * `address`/`address_parts` and `logo_url`, none of which are counted here.
 * (`phone` and `email` were in that list and have since joined the gates — see
 * `ProfileField` for why.)
 *
 * The distinction is deliberate, and it is not "the whole form". A field
 * belongs in this list only if the platform BREAKS without it:
 *
 *   company_name    on every invoice, email and public page
 *   business_type   chooses the pipeline, the sub-vertical and the site's copy
 *   industry        \
 *   company_size     | the four answers the setup and the AI read to decide
 *   primary_goal     | what this account needs
 *   technical_level /
 *   phone           \  how a client reaches this business. NOTHING ELSE ASKS:
 *   email           /  the onboarding chat has no question for either
 *
 * Deliberately NOT gates, each for a reason worth keeping:
 *
 *   logo_url     plenty of businesses have none, and everything falls back to
 *                the name. See `ProfileField` — counting it once refused a
 *                website publish over a missing image.
 *   website_url  we BUILD them one. Asking for a site as a precondition of
 *                finishing setup inverts the product.
 *   address      the invoice needs one and `missingInvoiceFields` gates it
 *                there, on `invoice_address`, where it is actually used.
 *
 * The rule, so the next person does not "complete" this list: a gate is a
 * thing that is broken without an answer, not a thing it would be nice to
 * know. Everything else belongs in a prompt.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function missingProfileFields(
  profile: BusinessProfileFields | null | undefined,
  settings: OrganizationSettings | null | undefined
): ProfileField[] {
  const missing: ProfileField[] = [];

  if (!hasValue(profile?.company_name)) missing.push('company_name');
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A SENTINEL IS NOT AN ANSWER.
   *
   * `vertical` holds `'default'` when the story extraction could not tell what
   * the business is — it is the key of the fallback pipeline preset, not a
   * trade. `'other'` was the same thing under its older name, and both are
   * still written by `extractBusinessStory`'s failure path.
   *
   * `hasValue` only asks whether a person typed something, and nobody typed
   * these: we did. Measured on a real account whose readiness card read
   * "Business details — complete" with `vertical: 'default'`, which is the one
   * field in this list that decides the shape of the whole setup.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * UNLESS THE OWNER HAS SAID IT THEMSELVES, which is the other half of the
   * same argument.
   *
   * A sentinel is not an answer from US. It can still be sitting beside one
   * the owner gave: `settings.business_type` is free text, typed in settings,
   * for the trades the preset list has no key for — a contractor, a caterer, a
   * garage. Refusing those too made this gate unsatisfiable rather than strict,
   * and a gate nobody can pass stops being read. See the field's own note.
   *
   * The pipeline is deliberately NOT required to change for that: we have no
   * renovation preset, the generic board is a reasonable one, and manufacturing
   * a preset key out of typed words would hand somebody stages they did not
   * choose — the exact failure `normalizeVertical` records.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const verticalIsAnswer =
    hasValue(profile?.vertical) && !UNKNOWN_VERTICALS.has(profile!.vertical!.trim().toLowerCase());

  if (!verticalIsAnswer && !hasValue(settings?.business_type)) {
    missing.push('business_type');
  }
  if (!hasValue(settings?.industry)) missing.push('industry');
  if (!hasValue(settings?.company_size)) missing.push('company_size');
  if (!hasValue(settings?.primary_goal)) missing.push('primary_goal');
  if (!hasValue(settings?.technical_level)) missing.push('technical_level');

  /*
   * How a client reaches this business, asked here because nowhere else asks.
   *
   * Last in the list on purpose: the list is read out in order on the dashboard
   * and in the settings strip, and who the business is comes before how to
   * reach it.
   *
   * `hasValue` is the whole test. A phone number's shape is the form's problem
   * — `toE164` and the phone input handle that — and a second opinion here
   * would let the two disagree about the same string.
   */
  if (!hasValue(profile?.phone)) missing.push('phone');
  if (!hasValue(profile?.email)) missing.push('email');

  return missing;
}

export function isBusinessProfileComplete(
  profile: BusinessProfileFields | null | undefined,
  settings: OrganizationSettings | null | undefined
): boolean {
  return missingProfileFields(profile, settings).length === 0;
}

/** Everything above, plus the address — which only the settings form insists on. */
export type SettingsProfileField = ProfileField | 'address';

/**
 * What the business settings form will not save without.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SECOND LIST AND NOT A LONGER FIRST ONE.
 *
 * The owner asked for the business address to be mandatory. `missingProfileFields`
 * is the wrong place to put it, and the note above it says why in advance: that
 * list is read by the readiness card, by `journeyReadiness` and by the publish
 * gate, so adding a field there does not make a form stricter — it refuses a
 * website publish.
 *
 * Measured before writing this, on the live database: of 8 business profiles, 4
 * have a usable address, 3 have part of one and 1 has nothing. Adding `address`
 * to the gate list would therefore have stopped half the accounts on the
 * platform from publishing, over a field they were never asked for and whose
 * absence breaks nothing they are doing today.
 *
 * So the ASK is honoured where the ask was made. This form holds the one place
 * a business address is typed, it is the only caller of this function, and it
 * blocks its own Save on the answer. Nothing downstream reads it, which is the
 * point: an owner is stopped while they are in the form with the field in front
 * of them, not later, somewhere else, by a refusal they cannot connect to it.
 *
 * The address test is `hasUsableAddress` — street, city, country — the same one
 * the invoice gate applies to `invoice_address`, so an owner is not asked for a
 * postal code their country does not write.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function missingSettingsProfileFields(
  profile: BusinessProfileFields | null | undefined,
  settings: OrganizationSettings | null | undefined,
  address: InvoiceAddress | null | undefined
): SettingsProfileField[] {
  const missing: SettingsProfileField[] = [...missingProfileFields(profile, settings)];

  /* Last, like phone and email: who the business is comes before where it is. */
  if (!hasUsableAddress(address)) missing.push('address');

  return missing;
}

/**
 * An address is enough to put on an invoice when it says where the business is.
 *
 * Street, city and country. Postal code and state are deliberately not required
 * — plenty of countries write addresses without either, and demanding them would
 * leave those businesses permanently incomplete over a field they cannot fill.
 */
function hasUsableAddress(address: InvoiceAddress | null | undefined): boolean {
  return hasValue(address?.line1) && hasValue(address?.city) && hasValue(address?.country);
}

/**
 * A client has to be told how to pay. Bank details and written instructions are
 * two ways of saying the same thing, so either satisfies this — and the routing
 * number never counts, because it is a US convention that most of the world has
 * no equivalent for.
 */
function hasPaymentMethod(invoice: InvoiceFields | null | undefined): boolean {
  const hasBank = hasValue(invoice?.invoice_bank_name) && hasValue(invoice?.invoice_bank_account);
  return hasBank || hasValue(invoice?.invoice_payment_instructions);
}

/**
 * What the invoice details are still missing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TAX ID DEPENDS ON WHICH DOCUMENT THEY ISSUE.
 *
 * This asked every business for one, and the platform has never believed that.
 * `defaultDocumentType` decides what to call a business's documents and says
 * so outright: "Tax without a number is an ordinary invoice; neither is a
 * receipt, which is what a service business collecting on the spot is really
 * sending." A tax ID is what makes a tax invoice a tax invoice, not a
 * precondition for billing anybody.
 *
 * So two halves of one system disagreed, and the half with no idea about
 * document types was the one holding the gate. Reported by an owner with no
 * tax ID: the publish gate refused their invoiced services, and the only
 * answers available to them were to invent a number or to leave.
 *
 * The document type is READ FROM THE SAME ROW rather than taken as an
 * argument, so every existing caller keeps working and none of them can pass
 * a different answer than the invoice itself will use. `resolveDocumentType`
 * is the one place that decides: their explicit choice, or the derived
 * default when they have not made one.
 *
 * A receipt and an invoice still need the other three. A company name, an
 * address and a way to be paid are what let a client know who billed them and
 * where the money goes, and no document is usable without those.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function missingInvoiceFields(invoice: InvoiceFields | null | undefined): InvoiceField[] {
  const missing: InvoiceField[] = [];

  if (!hasValue(invoice?.invoice_company_name)) missing.push('company_name');
  if (resolveDocumentType(invoice) === 'tax_invoice' && !hasValue(invoice?.invoice_tax_id)) {
    missing.push('tax_id');
  }
  if (!hasUsableAddress(invoice?.invoice_address)) missing.push('address');
  if (!hasPaymentMethod(invoice)) missing.push('payment_method');

  return missing;
}

export function isInvoicingComplete(invoice: InvoiceFields | null | undefined): boolean {
  return missingInvoiceFields(invoice).length === 0;
}

/**
 * What the website editor writes when nobody has chosen anything. Kept beside
 * the check below so the two cannot drift; if the editor's defaults change,
 * this is the one place that has to follow.
 */
export const STOCK_THEME = {
  primary: '#4F6EF7',
  secondary: '#6366F1',
  font: 'Inter',
} as const;

/** `website_pages.theme` — only the parts that say whose look this is. */
export interface PageThemeFields {
  colors?: { primary?: string; secondary?: string } | null;
  fonts?: { heading?: string; body?: string } | null;
}

/**
 * Whether the business has a look of its own.
 *
 * The theme is stored on the website page, but it is not only the website's:
 * every transactional email and the invoice PDF are drawn from the same colours
 * and fonts. So this is a question about the business, not about its site.
 *
 * Holding a theme proves nothing — every generated page is given one — so the
 * test is whether anything has moved off the editor's own fallbacks.
 */
export function isThemeCustomized(theme: PageThemeFields | null | undefined): boolean {
  if (!theme) return false;

  return !!(
    (theme.colors?.primary && theme.colors.primary.toUpperCase() !== STOCK_THEME.primary) ||
    (theme.colors?.secondary && theme.colors.secondary.toUpperCase() !== STOCK_THEME.secondary) ||
    (theme.fonts?.heading && theme.fonts.heading !== STOCK_THEME.font) ||
    (theme.fonts?.body && theme.fonts.body !== STOCK_THEME.font)
  );
}

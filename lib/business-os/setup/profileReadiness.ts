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
export interface BusinessProfileFields {
  company_name?: string | null;
  vertical?: string | null;
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
}

export type ProfileField =
  | 'company_name'
  | 'business_type'
  | 'logo'
  | 'industry'
  | 'company_size'
  | 'primary_goal'
  | 'technical_level';

/** Fields from `business_profiles` that the invoice settings section writes. */
export interface InvoiceFields {
  invoice_company_name?: string | null;
  invoice_tax_id?: string | null;
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
 * What the business profile is still missing.
 *
 * Every field the settings form exposes, because the whole form is what the
 * chip is asking the user to finish.
 */
export function missingProfileFields(
  profile: BusinessProfileFields | null | undefined,
  settings: OrganizationSettings | null | undefined
): ProfileField[] {
  const missing: ProfileField[] = [];

  if (!hasValue(profile?.company_name)) missing.push('company_name');
  if (!hasValue(profile?.vertical)) missing.push('business_type');
  if (!hasValue(profile?.logo_url)) missing.push('logo');
  if (!hasValue(settings?.industry)) missing.push('industry');
  if (!hasValue(settings?.company_size)) missing.push('company_size');
  if (!hasValue(settings?.primary_goal)) missing.push('primary_goal');
  if (!hasValue(settings?.technical_level)) missing.push('technical_level');

  return missing;
}

export function isBusinessProfileComplete(
  profile: BusinessProfileFields | null | undefined,
  settings: OrganizationSettings | null | undefined
): boolean {
  return missingProfileFields(profile, settings).length === 0;
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

/** What the invoice details are still missing. */
export function missingInvoiceFields(invoice: InvoiceFields | null | undefined): InvoiceField[] {
  const missing: InvoiceField[] = [];

  if (!hasValue(invoice?.invoice_company_name)) missing.push('company_name');
  if (!hasValue(invoice?.invoice_tax_id)) missing.push('tax_id');
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

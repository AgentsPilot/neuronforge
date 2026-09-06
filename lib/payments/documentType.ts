/**
 * What the document a client receives is actually called.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Every document this platform sends is titled "INVOICE" / "חשבונית". For most
 * businesses on it that is the wrong word. An invoice is a demand for payment;
 * what these businesses send is almost always confirmation that payment was
 * already taken. And in a VAT country the word carries a further claim — a
 * *tax* invoice is a document only a registered business may issue, and issuing
 * one without a registration number is a claim its recipient may act on.
 *
 * WHY THE BUSINESS CHOOSES, AND THE PLATFORM ONLY SUGGESTS
 *
 * The obvious design is to derive the title from the tax flag and be done. It is
 * nearly right, and wrong in the one case that matters: whether a business MAY
 * issue a tax invoice depends on its registration, not on whether it typed a
 * rate into a settings form. A business can charge tax and not be entitled to
 * issue tax invoices; another can be exempt and still owe its clients receipts.
 *
 * So the platform derives a sensible default, SHOWS the business what its
 * documents will be called, and lets it say otherwise. The legal call belongs to
 * the person who knows the answer — which is never us.
 *
 * `null` means "follow the default". Storing the derived value instead would
 * freeze it: a business that later registers for VAT would keep issuing
 * receipts, and nothing would tell it why.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/documentType
 */

export type DocumentType = 'receipt' | 'invoice' | 'tax_invoice';

export const DOCUMENT_TYPES: readonly DocumentType[] = ['receipt', 'invoice', 'tax_invoice'];

export interface DocumentTypeSettings {
  /** The business's explicit choice. Null/absent = use the derived default. */
  invoice_document_type?: DocumentType | string | null;
  invoice_prices_include_tax?: boolean | null;
  invoice_tax_id?: string | null;
}

type TitleLocale = 'en' | 'es' | 'he';

/**
 * The word itself.
 *
 * Hebrew is the case that shows why these are not translations of one string:
 * קבלה, חשבונית and חשבונית מס are three different documents with three
 * different legal meanings, not one word said three ways.
 */
const TITLES: Record<TitleLocale, Record<DocumentType, string>> = {
  en: {
    receipt: 'RECEIPT',
    invoice: 'INVOICE',
    tax_invoice: 'TAX INVOICE',
  },
  es: {
    receipt: 'RECIBO',
    invoice: 'FACTURA',
    tax_invoice: 'FACTURA',
  },
  he: {
    receipt: 'קבלה',
    invoice: 'חשבונית',
    tax_invoice: 'חשבונית מס',
  },
};

/** Sentence case, for an email subject line where a shout would read as spam. */
const NOUNS: Record<TitleLocale, Record<DocumentType, string>> = {
  en: {
    receipt: 'Receipt',
    invoice: 'Invoice',
    tax_invoice: 'Tax invoice',
  },
  es: {
    receipt: 'Recibo',
    invoice: 'Factura',
    tax_invoice: 'Factura',
  },
  he: {
    receipt: 'קבלה',
    invoice: 'חשבונית',
    tax_invoice: 'חשבונית מס',
  },
};

const isDocumentType = (value: unknown): value is DocumentType =>
  typeof value === 'string' && (DOCUMENT_TYPES as readonly string[]).includes(value);

/**
 * What the platform would call this business's documents if it never asked.
 *
 * Tax and a registration number together are the only signal that supports the
 * stronger word. Tax without a number is an ordinary invoice; neither is a
 * receipt, which is what a service business collecting on the spot is really
 * sending.
 */
export function defaultDocumentType(settings: DocumentTypeSettings | null | undefined): DocumentType {
  if (!settings?.invoice_prices_include_tax) return 'receipt';
  return settings.invoice_tax_id?.trim() ? 'tax_invoice' : 'invoice';
}

/** The business's choice, or the default when it has not made one. */
export function resolveDocumentType(settings: DocumentTypeSettings | null | undefined): DocumentType {
  const chosen = settings?.invoice_document_type;
  return isDocumentType(chosen) ? chosen : defaultDocumentType(settings);
}

const localeOf = (locale: string | null | undefined): TitleLocale =>
  locale === 'he' || locale === 'es' ? locale : 'en';

/**
 * The heading a document carries.
 *
 * `isPaid` is not decoration. A receipt is evidence that money was received, so
 * putting the word on an unpaid document states something untrue about a
 * payment that has not happened — and it is the one document a client might
 * reasonably file instead of paying. An unpaid receipt is issued as an invoice
 * regardless of the setting; every other combination is left alone.
 */
export function documentTitle(
  settings: DocumentTypeSettings | null | undefined,
  locale: string | null | undefined,
  isPaid: boolean
): string {
  const resolved = resolveDocumentType(settings);
  const effective: DocumentType = resolved === 'receipt' && !isPaid ? 'invoice' : resolved;
  return TITLES[localeOf(locale)][effective];
}

/** The same word in sentence case, for subject lines and prose. */
export function documentNoun(
  settings: DocumentTypeSettings | null | undefined,
  locale: string | null | undefined,
  isPaid: boolean
): string {
  const resolved = resolveDocumentType(settings);
  const effective: DocumentType = resolved === 'receipt' && !isPaid ? 'invoice' : resolved;
  return NOUNS[localeOf(locale)][effective];
}

/**
 * The label on the reference number.
 *
 * A document headed "קבלה" whose first field reads "מספר חשבונית" contradicts
 * itself on the same line, so the number follows the heading. The value it
 * labels is unchanged — internally it is still the invoice's number, and the
 * business's prefix and sequence are untouched.
 */
export function documentNumberLabel(
  settings: DocumentTypeSettings | null | undefined,
  locale: string | null | undefined,
  isPaid: boolean
): string {
  const noun = documentNoun(settings, locale, isPaid);
  const loc = localeOf(locale);
  if (loc === 'he') return `מספר ${noun}`;
  if (loc === 'es') return `Número de ${noun.toLowerCase()}`;
  return `${noun} number`;
}

/** For the settings screen: what auto currently resolves to, in the user's language. */
export function documentTypeLabel(type: DocumentType, locale: string | null | undefined): string {
  return NOUNS[localeOf(locale)][type];
}

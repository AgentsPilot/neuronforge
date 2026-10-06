/**
 * Invoice PDF Generator
 *
 * Generates professional PDF invoices with:
 * - Multi-language support (EN, ES, HE)
 * - Proper RTL support for Hebrew using react-pdf-rtl
 * - Vertical-specific styling
 * - Professional design
 */

import React from 'react';
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
  renderToBuffer,
} from '@react-pdf/renderer';
import {
  setupHebrewPDF,
  RTLText,
  RTLView,
  getRTLPageStyle,
  formatCurrencyRTL,
} from 'react-pdf-rtl';
import type { PaymentInvoice, InvoiceLineItem, InvoiceAddress } from '@/lib/repositories/PaymentRepository';
import type { InvoiceSettings } from '@/lib/repositories/BusinessProfileRepository';
import { createLogger } from '@/lib/logger';
import { formatAddressLines } from '@/lib/geo/address';
import { registerThemeFont } from './themeFonts';
import { taxLineFor } from '@/lib/payments/taxLine';
import { documentTitle } from '@/lib/payments/documentType';

const logger = createLogger({ module: 'InvoicePDFGenerator' });

// Initialize Hebrew PDF support once at module level
let hebrewSetupDone = false;
function ensureHebrewSetup() {
  if (!hebrewSetupDone) {
    setupHebrewPDF('Rubik'); // Uses Rubik font from Google Fonts CDN
    hebrewSetupDone = true;
    logger.info('Hebrew PDF support initialized with Rubik font');
  }
}

/**
 * Supported languages
 */
type Language = 'en' | 'es' | 'he';

/**
 * PDF Labels for each language
 */
const PDF_LABELS: Record<Language, Record<string, string>> = {
  en: {
    invoiceNumber: 'Invoice Number',
    copyBadge: 'COPY',
    date: 'Date',
    dueDate: 'Due Date',
    status: 'Status',
    billTo: 'Bill To',
    details: 'Details',
    description: 'Description',
    qty: 'Qty',
    unitPrice: 'Unit Price',
    amount: 'Amount',
    subtotal: 'Subtotal',
    total: 'Total',
    amountDue: 'Amount Due',
    paid: 'PAID',
    paymentInfo: 'Payment Information',
    bank: 'Bank',
    account: 'Account',
    routing: 'Routing',
    notes: 'Notes',
    planTitle: 'Payment plan',
    planPaid: 'paid',
    planDue: 'due',
    planThisInvoice: 'this invoice',
    planTotal: 'Plan total',
    taxId: 'Tax ID',
    currency: 'Currency',
    service: 'Service',
    status_paid: 'PAID',
    status_sent: 'SENT',
    status_draft: 'DRAFT',
    status_overdue: 'OVERDUE',
    status_cancelled: 'CANCELLED',
    status_refunded: 'REFUNDED',
    status_partially_refunded: 'PARTLY REFUNDED',
    refunded_line: 'Refunded',
    net_retained: 'Amount retained',
    includes_tax: 'Includes',
  },
  es: {
    invoiceNumber: 'Número de Factura',
    copyBadge: 'COPIA',
    date: 'Fecha',
    dueDate: 'Fecha de Vencimiento',
    status: 'Estado',
    billTo: 'Facturar a',
    details: 'Detalles',
    description: 'Descripción',
    qty: 'Cant.',
    unitPrice: 'Precio Unit.',
    amount: 'Monto',
    subtotal: 'Subtotal',
    total: 'Total',
    amountDue: 'Monto a Pagar',
    paid: 'PAGADO',
    paymentInfo: 'Información de Pago',
    bank: 'Banco',
    account: 'Cuenta',
    routing: 'CLABE/Ruta',
    notes: 'Notas',
    planTitle: 'Plan de pagos',
    planPaid: 'pagado',
    planDue: 'a pagar',
    planThisInvoice: 'esta factura',
    planTotal: 'Total del plan',
    taxId: 'NIF/CIF',
    currency: 'Moneda',
    service: 'Servicio',
    status_paid: 'PAGADO',
    status_sent: 'ENVIADO',
    status_draft: 'BORRADOR',
    status_overdue: 'VENCIDO',
    status_cancelled: 'CANCELADO',
    status_refunded: 'REEMBOLSADO',
    status_partially_refunded: 'REEMBOLSADO EN PARTE',
    refunded_line: 'Reembolsado',
    net_retained: 'Importe retenido',
    includes_tax: 'Incluye',
  },
  he: {
    invoiceNumber: 'מספר חשבונית',
    copyBadge: 'העתק',
    date: 'תאריך',
    dueDate: 'תאריך לתשלום',
    status: 'סטטוס',
    billTo: 'לכבוד',
    details: 'פרטים',
    description: 'תיאור',
    qty: 'כמות',
    unitPrice: 'מחיר יחידה',
    amount: 'סכום',
    subtotal: 'סכום ביניים',
    total: 'סה״כ',
    amountDue: 'יתרה לתשלום',
    paid: 'שולם',
    paymentInfo: 'פרטי תשלום',
    bank: 'בנק',
    account: 'חשבון',
    routing: 'סניף',
    notes: 'הערות',
    planTitle: 'תוכנית תשלומים',
    planPaid: 'שולם',
    planDue: 'לתשלום',
    planThisInvoice: 'החשבונית הזו',
    planTotal: 'סה״כ בתוכנית',
    taxId: 'ח.פ',
    currency: 'מטבע',
    service: 'שירות',
    status_paid: 'שולם',
    status_sent: 'נשלח',
    status_draft: 'טיוטה',
    status_overdue: 'באיחור',
    status_cancelled: 'בוטל',
    status_refunded: 'הוחזר',
    status_partially_refunded: 'הוחזר חלקית',
    refunded_line: 'הוחזר',
    net_retained: 'סכום שנותר',
    includes_tax: 'כולל',
  },
};

/**
 * Thank you messages per language and vertical
 */
const THANK_YOU_MESSAGES: Record<Language, Record<string, string>> = {
  en: {
    therapist: 'Thank you for your continued trust in our care.',
    lawyer: 'Thank you for choosing our legal services.',
    coach: 'Thank you for investing in your growth!',
    consultant: 'Thank you for your business.',
    course_creator: 'Thank you for investing in your learning!',
    default: 'Thank you for your business.',
  },
  es: {
    therapist: 'Gracias por su confianza continua en nuestro cuidado.',
    lawyer: 'Gracias por elegir nuestros servicios legales.',
    coach: 'Gracias por invertir en su crecimiento!',
    consultant: 'Gracias por su negocio.',
    course_creator: 'Gracias por invertir en su aprendizaje!',
    default: 'Gracias por su preferencia.',
  },
  he: {
    therapist: 'תודה על האמון המתמשך בטיפול שלנו.',
    lawyer: 'תודה שבחרת בשירותים המשפטיים שלנו.',
    coach: 'תודה שהשקעת בצמיחה שלך!',
    consultant: 'תודה על העסקה.',
    course_creator: 'תודה שהשקעת בלמידה שלך!',
    default: 'תודה על העסקה.',
  },
};

/**
 * Vertical-specific styling configuration
 */
interface VerticalConfig {
  primaryColor: string;
  accentColor: string;
}

/**
 * Vertical configurations for different business types
 */
const VERTICAL_CONFIGS: Record<string, VerticalConfig> = {
  therapist: { primaryColor: '#4A90A4', accentColor: '#6AA8BA' },
  lawyer: { primaryColor: '#1E3A5F', accentColor: '#2D5587' },
  coach: { primaryColor: '#F59E0B', accentColor: '#FBBF24' },
  consultant: { primaryColor: '#4B5563', accentColor: '#6B7280' },
  course_creator: { primaryColor: '#7C3AED', accentColor: '#A78BFA' },
  default: { primaryColor: '#3B82F6', accentColor: '#60A5FA' },
};

/**
 * Invoice data for PDF generation
 */
export interface InvoicePDFData {
  invoice: PaymentInvoice;
  businessSettings: InvoiceSettings & {
    /** The business's logo. Owned by the profile — the invoice only wears it. */
    logo_url?: string | null;
    /**
     * What the business says is already inside its prices.
     *
     * Display only: the platform never adds tax to a price. Absent for the many
     * businesses that are not registered, and then no tax line is drawn at all.
     */
    invoice_prices_include_tax?: boolean | null;
    invoice_tax_rate?: number | string | null;
    invoice_tax_label?: string | null;
  };
  /**
   * A second copy of an invoice the client already has.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Marked because a duplicate tax invoice that is NOT marked can be entered in
   * the books twice. It is standard practice — "העתק" in Hebrew — and the
   * client's bookkeeper is the person who needs it, not the client.
   *
   * It is the same invoice, not a new one: the number, the date and the amount
   * are unchanged, and the badge beside the invoice number is the only
   * difference. That is exactly what a copy is, and why this is a display flag
   * rather than a new document.
   * ───────────────────────────────────────────────────────────────────────────
   */
  isCopy?: boolean;
  /**
   * The instalment plan this invoice is one period OF.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WITHOUT IT THE DOCUMENT LOOKED LIKE THE WHOLE SALE.
   *
   * A period invoice is correct and complete on its own — INV-00013 asks for
   * ₪400 and ₪400 is what is owed — but read alone it describes a ₪400 sale.
   * The client has agreed to ₪800 across two dates, and nothing on the page
   * said so: not which period this is, not what is still to come, not when.
   *
   * The line item carries "(1/2)" only because the caller happened to write it
   * into the description. That is a string, not a schedule.
   *
   * Absent on every ordinary invoice, and then nothing below is drawn.
   * ───────────────────────────────────────────────────────────────────────────
   */
  planPeriods?: Array<{
    number: number;
    amount: number;
    /** `YYYY-MM-DD`. */
    dueDate: string | null;
    status: string;
    /** True for the period this very invoice bills. */
    isThisInvoice: boolean;
  }>;
  businessName?: string;
  businessVertical?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactAddress?: InvoiceAddress;
  language?: Language;
  /**
   * The business's own design, from its website theme — the same source the
   * emails use. Absent falls back to the per-vertical palette, which is what
   * every invoice looked like before.
   */
  branding?: {
    primaryColor?: string;
    accentColor?: string;
    /** Already registered with react-pdf, or omitted. See lib/pdf/themeFonts.ts. */
    headingFont?: string;
    bodyFont?: string;
  };
}

/**
 * Get vertical config with fallback to default
 */
function getVerticalConfig(vertical?: string): VerticalConfig {
  if (!vertical) return VERTICAL_CONFIGS.default;
  return VERTICAL_CONFIGS[vertical.toLowerCase()] || VERTICAL_CONFIGS.default;
}

/**
 * Get labels for language
 */
function getLabels(language: Language): Record<string, string> {
  return PDF_LABELS[language] || PDF_LABELS.en;
}

/**
 * Get thank you message
 */
function getThankYouMessage(language: Language, vertical?: string): string {
  const messages = THANK_YOU_MESSAGES[language] || THANK_YOU_MESSAGES.en;
  return messages[vertical?.toLowerCase() || 'default'] || messages.default;
}

/**
 * Format address for display.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Delegates to the shared formatter because the COUNTRY IS NOW A CODE.
 *
 * This pushed `address.country` onto the page verbatim, which was right while
 * the column held "Israel" and became wrong the moment the field became a
 * picker storing 'IL' — this is a tax document, and it would have started
 * printing "IL" to clients.
 *
 * `formatAddressLines` translates a real code into the invoice's own language
 * and passes anything else through untouched, so a business that has not
 * re-saved its settings keeps printing exactly what it typed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function formatAddress(
  address: InvoiceAddress | null | undefined,
  language: Language = 'en'
): string[] {
  return formatAddressLines(address, language === 'he' ? 'he' : language === 'es' ? 'es' : 'en');
}

/**
 * Format currency for display - uses react-pdf-rtl for proper RTL handling
 */
function formatCurrency(amount: number, currency: string, language: Language): string {
  if (language === 'he' && currency.toUpperCase() === 'ILS') {
    return formatCurrencyRTL(amount, '₪', 'he-IL');
  }
  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US';
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount);
}

/**
 * Format date for display
 */
/** `YYYY-MM-DD` with nothing after it — a DATE, not an instant. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Hoisted so the date-only branch and the instant branch name one list. */
const HEBREW_MONTHS = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];

function formatDate(dateString: string | null | undefined, language: Language): string {
  if (!dateString) return '-';

  /*
   * A DATE-ONLY COLUMN HAS NO TIMEZONE, SO NONE IS APPLIED.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `due_date` is a SQL DATE — `2026-09-30`, no time, no zone.
   * `new Date('2026-09-30')` makes it midnight UTC, and every read below then
   * resolves it wherever the renderer happens to be. One hour west of UTC turns
   * it into the 29th: INV-00013, raised on the 30th and payable on receipt,
   * printed "due 29 September", a day before the invoice existed.
   *
   * The common workaround is to anchor at noon UTC. That is not enough — a test
   * in `dateOnlyIsNotMidnightUTC.guard` shows noon UTC on the 30th is already
   * the 1st in Auckland (UTC+13). So the value is rendered AS the calendar date
   * it is: built in UTC and formatted in UTC, which returns the stored date in
   * every zone rather than in most of them.
   *
   * Timestamps keep their old treatment — `created_at` is a real instant and
   * must be resolved, not frozen.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const dateOnly = DATE_ONLY.test(dateString);
  const date = dateOnly ? new Date(`${dateString}T00:00:00Z`) : new Date(dateString);

  if (dateOnly && language === 'he') {
    const [y, m, d] = dateString.split('-').map(Number);
    return `${d} ב${HEBREW_MONTHS[m - 1]} ${y}`;
  }

  if (dateOnly) {
    return date.toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US', {
      timeZone: 'UTC',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  if (language === 'he') {
    const day = date.getDate();
    const month = HEBREW_MONTHS[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ב${month} ${year}`;
  }

  const locale = language === 'es' ? 'es-ES' : 'en-US';
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get status color
 */
function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    paid: '#22C55E',
    sent: '#3B82F6',
    draft: '#9CA3AF',
    overdue: '#EF4444',
    cancelled: '#6B7280',
    /*
     * Both statuses the refund trigger writes. Missing here, a refunded invoice
     * fell through to the grey `draft` colour while the badge printed the raw
     * database word — an English "REFUNDED" on a Hebrew document.
     */
    refunded: '#F97316',
    partially_refunded: '#F97316',
  };
  return colors[status] || colors.draft;
}

/**
 * Smart Text component that uses RTLText for Hebrew and regular Text otherwise
 */
interface SmartTextProps {
  children: React.ReactNode;
  style?: object;
  isRTL: boolean;
}

const SmartText: React.FC<SmartTextProps> = ({ children, style, isRTL }) => {
  if (isRTL) {
    return <RTLText style={style}>{String(children)}</RTLText>;
  }
  return <Text style={style}>{children}</Text>;
};

/**
 * Invoice Document Component
 */
interface InvoiceDocumentProps {
  data: InvoicePDFData;
}

const InvoiceDocument: React.FC<InvoiceDocumentProps> = ({ data }) => {
  const { invoice, businessSettings, businessName, businessVertical, branding } = data;
  const language = data.language || 'en';
  const isRTL = language === 'he';
  // The business's own colours where it has them; the vertical palette is the
  // fallback for a business that has never chosen any.
  const verticalConfig = getVerticalConfig(businessVertical);
  const config = {
    primaryColor: branding?.primaryColor || verticalConfig.primaryColor,
    accentColor: branding?.accentColor || verticalConfig.accentColor,
  };
  const labels = getLabels(language);

  // Hebrew keeps Rubik: the Latin faces a theme names almost never carry Hebrew
  // glyphs, and the invoice would render as empty boxes.
  const fontFamily = isRTL ? 'Rubik' : (branding?.bodyFont || 'Helvetica');
  const headingFontFamily = isRTL ? 'Rubik' : (branding?.headingFont || branding?.bodyFont || 'Helvetica');

  // Prepare data
  const lineItems = invoice.line_items || [];
  const companyName = businessSettings.invoice_company_name || businessName || 'Invoice';
  const clientName = invoice.client_name || data.contactName || 'Client';
  const clientEmail = invoice.client_email || data.contactEmail || '';
  const statusLabel = labels[`status_${invoice.status}`] || invoice.status.toUpperCase();

  /*
   * The heading, which is not always "INVOICE".
   *
   * A business that takes payment on the spot is sending a receipt, and one
   * registered for VAT may be sending a tax invoice — three documents with
   * three different meanings, chosen by the business in its settings rather
   * than assumed here. `documentTitle` also refuses to head an unpaid document
   * "RECEIPT", which would tell the client money had been received.
   */
  const isPaid = invoice.status === 'paid'
    || invoice.status === 'refunded'
    || invoice.status === 'partially_refunded';
  const headingLabel = documentTitle(businessSettings, language, isPaid);

  /*
   * Derived on the invoice by trigger from its transactions, so it is already
   * correct here — the document only has to print it.
   */
  const refundedAmount =
    Number((invoice as { refunded_amount?: number | string | null }).refunded_amount ?? 0) || 0;

  /*
   * The tax already inside the price, when the business has said there is one.
   * Null otherwise, so a business that never configured tax gets no line —
   * a "VAT 0.00" row would read to their client as a mistake.
   */
  const taxLine = taxLineFor(invoice.amount, invoice.currency, businessSettings);
  // The invoice's own language, so a Hebrew invoice says ישראל and the same
  // business's English one says Israel.
  const businessAddressLines = formatAddress(businessSettings.invoice_address, language);
  const clientAddress = invoice.client_address || data.contactAddress;
  const clientAddressLines = formatAddress(clientAddress, language);

  const subtotal = lineItems.reduce(
    (sum: number, item: InvoiceLineItem) => sum + (item.quantity || 1) * (item.unit_price || 0),
    0
  ) || invoice.amount;

  // Create styles
  const styles = StyleSheet.create({
    page: {
      padding: 40,
      fontFamily,
      fontSize: 10,
      backgroundColor: '#FFFFFF',
    },
    header: {
      flexDirection: isRTL ? 'row-reverse' : 'row',
      justifyContent: 'space-between',
      marginBottom: 30,
    },
    companySection: {
      width: '60%',
    },
    invoiceSection: {
      width: '40%',
    },
    logo: {
      // Matches the height the email header uses, so an invoice and its
      // covering email look like the same business.
      height: 48,
      maxWidth: 160,
      objectFit: 'contain',
      marginBottom: 8,
      alignSelf: isRTL ? 'flex-end' : 'flex-start',
    },
    companyName: {
      fontFamily: headingFontFamily,
      fontSize: 18,
      fontWeight: 700,
      color: config.primaryColor,
      marginBottom: 5,
      textAlign: isRTL ? 'right' : 'left',
    },
    companyAddress: {
      fontSize: 9,
      color: '#6B7280',
      marginBottom: 2,
      textAlign: isRTL ? 'right' : 'left',
    },
    invoiceLabel: {
      fontSize: 10,
      color: '#6B7280',
      textAlign: isRTL ? 'left' : 'right',
      marginBottom: 2,
    },
    /*
     * The copy mark: a badge beside the invoice number, in the document's flow.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * IT REPLACES A DIAGONAL WATERMARK, AND NOT FOR TASTE.
     *
     * The watermark was absolutely positioned and drawn first so the figures
     * would stay legible on top of it. They did — but so did everything else
     * with a fill: the striped table rows, the notes block, the totals band.
     * Those are opaque, so the word ran under them and came out in pieces, with
     * whole letters missing where it crossed one. Rendered and looked at, it
     * read as a printer fault rather than as a mark.
     *
     * A badge cannot do that: it is laid out, not overlaid, so nothing can be
     * drawn across it and nothing it covers.
     *
     * Deliberately NOT the status colour. The status says what happened to the
     * money; this says which SEND of the document you are holding, which is a
     * different question, and colouring them alike invites reading one as the
     * other. Grey on grey is the register of a filing mark.
     * ─────────────────────────────────────────────────────────────────────────
     */
    copyBadge: {
      fontSize: 8,
      fontWeight: 700,
      color: '#4B5563',
      backgroundColor: '#F3F4F6',
      borderWidth: 1,
      borderStyle: 'solid',
      borderColor: '#D1D5DB',
      padding: '4 8',
      /*
       * The gap between the two badges, written out per direction rather than
       * as a logical `marginEnd`: the row is reversed for Hebrew, so the end
       * side and the side the space is needed on are not the same thing.
       */
      marginLeft: isRTL ? 0 : 4,
      marginRight: isRTL ? 4 : 0,
      textAlign: isRTL ? 'left' : 'right',
    },
    /*
     * The two badges on one line, in the order the language reads: the status
     * first, the copy mark beside it. Carries the spacing and the edge
     * alignment that used to sit on each badge, so that a row of one and a row
     * of two sit in exactly the same place under the invoice number.
     */
    invoiceBadges: {
      flexDirection: isRTL ? 'row-reverse' : 'row',
      alignItems: 'center',
      marginTop: 5,
      alignSelf: isRTL ? 'flex-start' : 'flex-end',
    },
    invoiceNumber: {
      fontFamily: headingFontFamily,
      fontSize: 12,
      fontWeight: 700,
      color: config.primaryColor,
      textAlign: isRTL ? 'left' : 'right',
    },
    statusBadge: {
      fontSize: 8,
      fontWeight: 700,
      color: '#FFFFFF',
      backgroundColor: getStatusColor(invoice.status),
      padding: '4 8',
      textAlign: isRTL ? 'left' : 'right',
      /* Spacing and edge alignment now belong to `invoiceBadges`, the row. */
    },
    detailsRow: {
      flexDirection: isRTL ? 'row-reverse' : 'row',
      justifyContent: 'space-between',
      marginBottom: 30,
    },
    billToSection: {
      width: '48%',
    },
    detailsSection: {
      width: '48%',
    },
    sectionHeader: {
      fontSize: 10,
      fontWeight: 700,
      color: config.primaryColor,
      marginBottom: 8,
      textAlign: isRTL ? 'right' : 'left',
    },
    clientName: {
      fontSize: 11,
      fontWeight: 700,
      color: '#1F2937',
      marginBottom: 3,
      textAlign: isRTL ? 'right' : 'left',
    },
    clientInfo: {
      fontSize: 9,
      color: '#6B7280',
      marginBottom: 2,
      textAlign: isRTL ? 'right' : 'left',
    },
    detailRow: {
      flexDirection: isRTL ? 'row-reverse' : 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    detailLabel: {
      fontSize: 9,
      color: '#6B7280',
      textAlign: isRTL ? 'right' : 'left',
    },
    detailValue: {
      fontSize: 9,
      fontWeight: 700,
      color: '#1F2937',
      textAlign: isRTL ? 'left' : 'right',
    },
    table: {
      marginBottom: 20,
    },
    tableHeader: {
      flexDirection: isRTL ? 'row-reverse' : 'row',
      backgroundColor: config.primaryColor,
      padding: 8,
    },
    tableHeaderCell: {
      fontSize: 9,
      fontWeight: 700,
      color: '#FFFFFF',
    },
    tableRow: {
      flexDirection: isRTL ? 'row-reverse' : 'row',
      padding: 8,
      borderBottomWidth: 0.5,
      borderBottomColor: '#E5E7EB',
    },
    tableRowEven: {
      backgroundColor: '#F9FAFB',
    },
    tableCell: {
      fontSize: 9,
      color: '#1F2937',
    },
    descriptionCol: { width: '50%' },
    qtyCol: { width: '10%', textAlign: 'center' },
    priceCol: { width: '20%', textAlign: isRTL ? 'left' : 'right' },
    amountCol: { width: '20%', textAlign: isRTL ? 'left' : 'right' },
    totalsSection: {
      flexDirection: 'row',
      justifyContent: isRTL ? 'flex-start' : 'flex-end',
      marginBottom: 30,
    },
    totalsTable: {
      width: 200,
    },
    totalRow: {
      flexDirection: isRTL ? 'row-reverse' : 'row',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    totalLabel: {
      fontSize: 9,
      color: '#6B7280',
      textAlign: isRTL ? 'right' : 'left',
    },
    totalValue: {
      fontSize: 9,
      textAlign: isRTL ? 'left' : 'right',
    },
    grandTotalLabel: {
      fontSize: 12,
      fontWeight: 700,
      color: '#1F2937',
      textAlign: isRTL ? 'right' : 'left',
    },
    grandTotalValue: {
      fontSize: 12,
      fontWeight: 700,
      color: config.primaryColor,
      textAlign: isRTL ? 'left' : 'right',
    },
    /* The plan block: quieter than the payment box, which is the call to
       action. This is context for the figure above it, not a second demand. */
    planSection: {
      backgroundColor: '#F9FAFB',
      padding: 10,
      marginBottom: 20,
    },
    planHeader: {
      fontSize: 10,
      fontWeight: 700,
      color: '#374151',
      marginBottom: 5,
      textAlign: isRTL ? 'right' : 'left',
    },
    planRow: {
      flexDirection: isRTL ? 'row-reverse' : 'row',
      justifyContent: 'space-between',
      marginBottom: 3,
    },
    planTotalRow: {
      flexDirection: isRTL ? 'row-reverse' : 'row',
      justifyContent: 'space-between',
      marginTop: 5,
      paddingTop: 5,
      borderTopWidth: 1,
      borderTopColor: '#E5E7EB',
    },
    planRowText: {
      fontSize: 9,
      color: '#6B7280',
    },
    planRowTextStrong: {
      fontSize: 9,
      fontWeight: 700,
      color: '#1F2937',
    },
    paymentSection: {
      backgroundColor: '#FFFBEB',
      padding: 10,
      marginBottom: 20,
    },
    paymentHeader: {
      fontSize: 10,
      fontWeight: 700,
      color: '#92400E',
      marginBottom: 5,
      textAlign: isRTL ? 'right' : 'left',
    },
    paymentDetails: {
      fontSize: 9,
      color: '#1F2937',
      marginBottom: 3,
      textAlign: isRTL ? 'right' : 'left',
    },
    paymentInstructions: {
      fontSize: 8,
      color: '#6B7280',
      textAlign: isRTL ? 'right' : 'left',
    },
    notesSection: {
      backgroundColor: '#F3F4F6',
      padding: 10,
      marginBottom: 20,
    },
    notesHeader: {
      fontSize: 10,
      fontWeight: 700,
      color: '#1F2937',
      marginBottom: 5,
      textAlign: isRTL ? 'right' : 'left',
    },
    notesText: {
      fontSize: 9,
      color: '#6B7280',
      textAlign: isRTL ? 'right' : 'left',
    },
    thankYou: {
      fontSize: 11,
      fontWeight: 700,
      color: config.primaryColor,
      textAlign: 'center',
      marginTop: 30,
    },
    footerText: {
      fontSize: 8,
      color: '#9CA3AF',
      textAlign: 'center',
      marginTop: 10,
    },
  });

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.companySection}>
            {/* The logo was passed to this generator for months and never drawn,
                so the PDF was the one invoice surface with no branding at all.
                A broken or unreachable URL must not fail the render, hence the
                plain presence check and the company name underneath regardless. */}
            {businessSettings.logo_url ? (
              <Image style={styles.logo} src={businessSettings.logo_url} />
            ) : null}
            <SmartText style={styles.companyName} isRTL={isRTL}>{companyName}</SmartText>
            {businessAddressLines.map((line, idx) => (
              <SmartText key={idx} style={styles.companyAddress} isRTL={isRTL}>{line}</SmartText>
            ))}
            {businessSettings.invoice_tax_id && (
              <SmartText style={styles.companyAddress} isRTL={isRTL}>
                {`${labels.taxId}: ${businessSettings.invoice_tax_id}`}
              </SmartText>
            )}
          </View>
          <View style={styles.invoiceSection}>
            <SmartText style={styles.invoiceLabel} isRTL={isRTL}>{headingLabel}</SmartText>
            <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
            {/*
              The copy mark, when this is a resend — a badge beside the status,
              not a stamp across the sheet. The diagonal watermark it replaces
              was drawn first so it would sit UNDER the content, and that is
              exactly what spoiled it: every row stripe, every tinted band and
              the notes block are opaque, so the word was chopped into pieces
              wherever it ran beneath one. A mark that arrives in fragments
              reads as a printing fault, not as a mark.
            */}
            <View style={styles.invoiceBadges}>
              <SmartText style={styles.statusBadge} isRTL={isRTL}>{statusLabel}</SmartText>
              {data.isCopy && (
                <SmartText style={styles.copyBadge} isRTL={isRTL}>{labels.copyBadge}</SmartText>
              )}
            </View>
          </View>
        </View>

        {/* Bill To and Details */}
        <View style={styles.detailsRow}>
          <View style={styles.billToSection}>
            <SmartText style={styles.sectionHeader} isRTL={isRTL}>{labels.billTo}</SmartText>
            <SmartText style={styles.clientName} isRTL={isRTL}>{clientName}</SmartText>
            {clientEmail && <Text style={styles.clientInfo}>{clientEmail}</Text>}
            {data.contactPhone && <Text style={styles.clientInfo}>{data.contactPhone}</Text>}
            {clientAddressLines.map((line, idx) => (
              <SmartText key={idx} style={styles.clientInfo} isRTL={isRTL}>{line}</SmartText>
            ))}
          </View>
          <View style={styles.detailsSection}>
            <SmartText style={styles.sectionHeader} isRTL={isRTL}>{labels.details}</SmartText>
            <View style={styles.detailRow}>
              <SmartText style={styles.detailLabel} isRTL={isRTL}>{labels.date}</SmartText>
              <SmartText style={styles.detailValue} isRTL={isRTL}>{formatDate(invoice.created_at, language)}</SmartText>
            </View>
            <View style={styles.detailRow}>
              <SmartText style={styles.detailLabel} isRTL={isRTL}>{labels.dueDate}</SmartText>
              <SmartText style={styles.detailValue} isRTL={isRTL}>{formatDate(invoice.due_date, language)}</SmartText>
            </View>
            <View style={styles.detailRow}>
              <SmartText style={styles.detailLabel} isRTL={isRTL}>{labels.currency}</SmartText>
              <Text style={styles.detailValue}>{invoice.currency.toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {/* Line Items Table */}
        <View style={styles.table}>
          {/* Table Header */}
          <View style={styles.tableHeader}>
            <SmartText style={[styles.tableHeaderCell, styles.descriptionCol, { textAlign: isRTL ? 'right' : 'left' }]} isRTL={isRTL}>
              {labels.description}
            </SmartText>
            <SmartText style={[styles.tableHeaderCell, styles.qtyCol]} isRTL={isRTL}>{labels.qty}</SmartText>
            <SmartText style={[styles.tableHeaderCell, styles.priceCol]} isRTL={isRTL}>{labels.unitPrice}</SmartText>
            <SmartText style={[styles.tableHeaderCell, styles.amountCol]} isRTL={isRTL}>{labels.amount}</SmartText>
          </View>

          {/* Table Rows */}
          {lineItems.length > 0 ? (
            lineItems.map((item: InvoiceLineItem, idx: number) => (
              <View key={idx} style={[styles.tableRow, idx % 2 === 0 ? styles.tableRowEven : {}]}>
                <SmartText style={[styles.tableCell, styles.descriptionCol, { textAlign: isRTL ? 'right' : 'left' }]} isRTL={isRTL}>
                  {item.description || labels.service}
                </SmartText>
                <Text style={[styles.tableCell, styles.qtyCol]}>{item.quantity || 1}</Text>
                <Text style={[styles.tableCell, styles.priceCol]}>
                  {formatCurrency(item.unit_price || 0, invoice.currency, language)}
                </Text>
                <Text style={[styles.tableCell, styles.amountCol, { fontWeight: 700 }]}>
                  {formatCurrency((item.quantity || 1) * (item.unit_price || 0), invoice.currency, language)}
                </Text>
              </View>
            ))
          ) : (
            <View style={[styles.tableRow, styles.tableRowEven]}>
              <SmartText style={[styles.tableCell, styles.descriptionCol, { textAlign: isRTL ? 'right' : 'left' }]} isRTL={isRTL}>
                {labels.service}
              </SmartText>
              <Text style={[styles.tableCell, styles.qtyCol]}>1</Text>
              <Text style={[styles.tableCell, styles.priceCol]}>
                {formatCurrency(invoice.amount, invoice.currency, language)}
              </Text>
              <Text style={[styles.tableCell, styles.amountCol, { fontWeight: 700 }]}>
                {formatCurrency(invoice.amount, invoice.currency, language)}
              </Text>
            </View>
          )}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalsTable}>
            <View style={styles.totalRow}>
              <SmartText style={styles.totalLabel} isRTL={isRTL}>{labels.subtotal}</SmartText>
              <Text style={styles.totalValue}>{formatCurrency(subtotal, invoice.currency, language)}</Text>
            </View>
            <View style={styles.totalRow}>
              <SmartText style={styles.grandTotalLabel} isRTL={isRTL}>{labels.total}</SmartText>
              <Text style={styles.grandTotalValue}>{formatCurrency(invoice.amount, invoice.currency, language)}</Text>
            </View>

            {/* Under the total, because it is CONTAINED in it. Placed above and
                the reader adds it on — which is the one misreading that changes
                what they think they owe. */}
            {taxLine && (
              <View style={styles.totalRow}>
                <SmartText style={styles.totalLabel} isRTL={isRTL}>
                  {`${labels.includes_tax} ${taxLine.label} ${taxLine.rate}%`}
                </SmartText>
                <Text style={styles.totalValue}>
                  {formatCurrency(taxLine.amount, invoice.currency, language)}
                </Text>
              </View>
            )}

            {/* What came back, and what the client actually paid in the end.

                Without these the document still read "PAID $200.00" after $150
                had been returned — and this file is what the client keeps and
                what their accountant reads. An invoice that overstates what was
                paid is worse than no document at all. */}
            {refundedAmount > 0 && (
              <>
                <View style={styles.totalRow}>
                  <SmartText style={styles.totalLabel} isRTL={isRTL}>{labels.refunded_line}</SmartText>
                  <Text style={styles.totalValue}>
                    {`-${formatCurrency(refundedAmount, invoice.currency, language)}`}
                  </Text>
                </View>
                <View style={styles.totalRow}>
                  <SmartText style={styles.grandTotalLabel} isRTL={isRTL}>{labels.net_retained}</SmartText>
                  <Text style={styles.grandTotalValue}>
                    {formatCurrency(
                      Math.max(0, invoice.amount - refundedAmount),
                      invoice.currency,
                      language
                    )}
                  </Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* The plan this invoice is one period of.

            A period invoice is complete on its own — this one asks for ₪400 and
            ₪400 is owed — but read alone it describes a ₪400 sale. The client
            agreed to a schedule, so the schedule is shown: which period this is,
            what has been paid, and what is still to come with its date.

            Drawn only when the caller supplies it, so every ordinary invoice is
            byte-identical to before. */}
        {data.planPeriods && data.planPeriods.length > 1 && (
          <View style={styles.planSection}>
            <SmartText style={styles.planHeader} isRTL={isRTL}>
              {labels.planTitle}
            </SmartText>

            {data.planPeriods.map(period => {
              const note = period.isThisInvoice
                ? labels.planThisInvoice
                : period.status === 'paid'
                  ? labels.planPaid
                  : labels.planDue;

              // `formatDate` anchors a date-only value itself now, so the raw
              // column goes in — one rule, in one place.
              const when = period.dueDate ? formatDate(period.dueDate, language) : '';

              return (
                <View style={styles.planRow} key={period.number}>
                  <SmartText
                    style={period.isThisInvoice ? styles.planRowTextStrong : styles.planRowText}
                    isRTL={isRTL}
                  >
                    {`${period.number}. ${when}${when ? ' · ' : ''}${note}`}
                  </SmartText>
                  <Text
                    style={period.isThisInvoice ? styles.planRowTextStrong : styles.planRowText}
                  >
                    {formatCurrency(period.amount, invoice.currency, language)}
                  </Text>
                </View>
              );
            })}

            <View style={styles.planTotalRow}>
              <SmartText style={styles.planRowTextStrong} isRTL={isRTL}>
                {labels.planTotal}
              </SmartText>
              <Text style={styles.planRowTextStrong}>
                {formatCurrency(
                  data.planPeriods.reduce((sum, p) => sum + p.amount, 0),
                  invoice.currency,
                  language
                )}
              </Text>
            </View>
          </View>
        )}

        {/* Payment Information.

            Gated on ANY of the four fields. It required a bank NAME or
            instructions, while the public page accepted a name or an account
            number — so a business that filled in only its account number got
            the details on the web page and none in the PDF. The email carried
            none either, which meant none in anything the client was sent. */}
        {(businessSettings.invoice_bank_name ||
          businessSettings.invoice_bank_account ||
          businessSettings.invoice_bank_routing ||
          businessSettings.invoice_payment_instructions) && (
          <View style={styles.paymentSection}>
            <SmartText style={styles.paymentHeader} isRTL={isRTL}>{labels.paymentInfo}</SmartText>
            {businessSettings.invoice_bank_name && (
              <SmartText style={styles.paymentDetails} isRTL={isRTL}>
                {`${labels.bank}: ${businessSettings.invoice_bank_name}`}
              </SmartText>
            )}
            {businessSettings.invoice_bank_account && (
              <SmartText style={styles.paymentDetails} isRTL={isRTL}>
                {`${labels.account}: ${businessSettings.invoice_bank_account}`}
              </SmartText>
            )}
            {businessSettings.invoice_bank_routing && (
              <SmartText style={styles.paymentDetails} isRTL={isRTL}>
                {`${labels.routing}: ${businessSettings.invoice_bank_routing}`}
              </SmartText>
            )}
            {businessSettings.invoice_payment_instructions && (
              <SmartText style={styles.paymentInstructions} isRTL={isRTL}>
                {businessSettings.invoice_payment_instructions}
              </SmartText>
            )}
          </View>
        )}

        {/* Notes */}
        {invoice.notes && (
          <View style={styles.notesSection}>
            <SmartText style={styles.notesHeader} isRTL={isRTL}>{labels.notes}</SmartText>
            <SmartText style={styles.notesText} isRTL={isRTL}>{invoice.notes}</SmartText>
          </View>
        )}

        {/* Thank You */}
        <SmartText style={styles.thankYou} isRTL={isRTL}>
          {getThankYouMessage(language, businessVertical)}
        </SmartText>

        {/* Footer */}
        {businessSettings.invoice_footer_text && (
          <SmartText style={styles.footerText} isRTL={isRTL}>
            {businessSettings.invoice_footer_text}
          </SmartText>
        )}
      </Page>
    </Document>
  );
};

/**
 * Generate invoice PDF - Modern Professional Design with proper RTL support
 * @deprecated Use generateInvoicePDFAsync instead
 */
export async function generateInvoicePDF(data: InvoicePDFData): Promise<Buffer> {
  return generateInvoicePDFAsync(data);
}

/**
 * Generate invoice PDF (async version)
 * Uses react-pdf-rtl for proper Hebrew RTL support
 */
export async function generateInvoicePDFAsync(data: InvoicePDFData): Promise<Buffer> {
  const { invoice } = data;
  const language = data.language || 'en';
  const isRTL = language === 'he';

  logger.info({ invoiceId: invoice.id, language, isRTL }, 'Generating invoice PDF with react-pdf-rtl');

  // Ensure Hebrew fonts are registered
  if (isRTL) {
    ensureHebrewSetup();
  }

  // Register the business's theme fonts before the document names them.
  // Skipped for Hebrew, which keeps Rubik — see lib/pdf/themeFonts.ts. Either
  // may come back null, and the styles fall back on their own.
  let branding = data.branding;
  if (!isRTL && branding && (branding.headingFont || branding.bodyFont)) {
    const [headingFont, bodyFont] = await Promise.all([
      registerThemeFont(branding.headingFont),
      registerThemeFont(branding.bodyFont),
    ]);
    branding = { ...branding, headingFont: headingFont ?? undefined, bodyFont: bodyFont ?? undefined };
  }

  // Create the document element
  const doc = React.createElement(InvoiceDocument, { data: { ...data, branding } });

  // Render to buffer
  const buffer = await renderToBuffer(doc);

  logger.info({ invoiceId: invoice.id, size: buffer.length }, 'Invoice PDF generated successfully');
  return buffer;
}

/**
 * Export the generator class for compatibility
 */
export class InvoicePDFGenerator {
  /**
   * @deprecated Use generateAsync instead
   */
  async generate(data: InvoicePDFData): Promise<Buffer> {
    return generateInvoicePDF(data);
  }

  async generateAsync(data: InvoicePDFData): Promise<Buffer> {
    return generateInvoicePDFAsync(data);
  }

  getVerticalConfig(vertical?: string): VerticalConfig {
    return getVerticalConfig(vertical);
  }
}

export default InvoicePDFGenerator;

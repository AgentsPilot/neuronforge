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
import { registerThemeFont } from './themeFonts';

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
    invoice: 'INVOICE',
    invoiceNumber: 'Invoice Number',
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
    taxId: 'Tax ID',
    currency: 'Currency',
    service: 'Service',
    status_paid: 'PAID',
    status_sent: 'SENT',
    status_draft: 'DRAFT',
    status_overdue: 'OVERDUE',
    status_cancelled: 'CANCELLED',
  },
  es: {
    invoice: 'FACTURA',
    invoiceNumber: 'Número de Factura',
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
    taxId: 'NIF/CIF',
    currency: 'Moneda',
    service: 'Servicio',
    status_paid: 'PAGADO',
    status_sent: 'ENVIADO',
    status_draft: 'BORRADOR',
    status_overdue: 'VENCIDO',
    status_cancelled: 'CANCELADO',
  },
  he: {
    invoice: 'חשבונית',
    invoiceNumber: 'מספר חשבונית',
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
    taxId: 'ח.פ',
    currency: 'מטבע',
    service: 'שירות',
    status_paid: 'שולם',
    status_sent: 'נשלח',
    status_draft: 'טיוטה',
    status_overdue: 'באיחור',
    status_cancelled: 'בוטל',
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
  };
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
 * Format address for display
 */
function formatAddress(address: InvoiceAddress | null | undefined): string[] {
  if (!address) return [];

  const lines: string[] = [];
  if (address.line1) lines.push(address.line1);
  if (address.line2) lines.push(address.line2);

  const cityLine = [address.city, address.state, address.postal_code]
    .filter(Boolean)
    .join(', ');
  if (cityLine) lines.push(cityLine);

  if (address.country) lines.push(address.country);

  return lines;
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
function formatDate(dateString: string | null | undefined, language: Language): string {
  if (!dateString) return '-';
  const date = new Date(dateString);

  if (language === 'he') {
    // Hebrew months for proper display
    const hebrewMonths = [
      'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
      'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
    ];
    const day = date.getDate();
    const month = hebrewMonths[date.getMonth()];
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
  const businessAddressLines = formatAddress(businessSettings.invoice_address);
  const clientAddress = invoice.client_address || data.contactAddress;
  const clientAddressLines = formatAddress(clientAddress);

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
      marginTop: 5,
      textAlign: isRTL ? 'left' : 'right',
      alignSelf: isRTL ? 'flex-start' : 'flex-end',
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
            <SmartText style={styles.invoiceLabel} isRTL={isRTL}>{labels.invoice}</SmartText>
            <Text style={styles.invoiceNumber}>{invoice.invoice_number}</Text>
            <SmartText style={styles.statusBadge} isRTL={isRTL}>{statusLabel}</SmartText>
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
          </View>
        </View>

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

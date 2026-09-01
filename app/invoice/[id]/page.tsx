/**
 * Public Invoice Page
 *
 * Shows invoice details to clients (no auth required).
 * Handles different states: paid, pending payment, manual payment instructions.
 * Supports Hebrew, Spanish, and English with RTL layout for Hebrew.
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabaseServer';
import { CheckCircle, Clock, CreditCard, Building2, AlertCircle } from 'lucide-react';

// Translations for the invoice page
const translations: Record<string, Record<string, string>> = {
  en: {
    invoice: 'Invoice',
    paymentReceived: 'Payment Received',
    paymentReceivedDesc: 'Thank you! Your payment has been successfully processed.',
    paymentCancelled: 'Payment Cancelled',
    paymentCancelledDesc: 'Your payment was cancelled. You can try again using the payment options below.',
    billTo: 'Bill To',
    from: 'From',
    invoiceNumber: 'Invoice #',
    issueDate: 'Issue Date',
    dueDate: 'Due Date',
    dueOnServiceDate: 'Due on service date',
    description: 'Description',
    qty: 'Qty',
    price: 'Price',
    amount: 'Amount',
    subtotal: 'Subtotal',
    total: 'Total',
    notes: 'Notes',
    paymentOptions: 'Payment Options',
    payOnline: 'Pay Online with Card',
    bankTransfer: 'Bank Transfer',
    bank: 'Bank',
    account: 'Account',
    routingBranch: 'Branch',
    includeInvoiceNumber: 'Please include invoice number {invoiceNumber} in the transfer reference.',
    paymentInstructions: 'Payment Instructions',
    contactForPayment: 'Please contact {businessName} directly for payment options.',
    paid: 'PAID',
    overdue: 'OVERDUE',
    pending: 'PENDING',
    bookingFor: 'Booking for {name}',
    thankYou: 'Thank you for your business!'
  },
  es: {
    invoice: 'Factura',
    paymentReceived: 'Pago Recibido',
    paymentReceivedDesc: '¡Gracias! Tu pago ha sido procesado exitosamente.',
    paymentCancelled: 'Pago Cancelado',
    paymentCancelledDesc: 'Tu pago fue cancelado. Puedes intentar de nuevo.',
    billTo: 'Facturar a',
    from: 'De',
    invoiceNumber: 'Factura #',
    issueDate: 'Fecha de Emisión',
    dueDate: 'Fecha de Vencimiento',
    dueOnServiceDate: 'Vence en la fecha del servicio',
    description: 'Descripción',
    qty: 'Cant.',
    price: 'Precio',
    amount: 'Monto',
    subtotal: 'Subtotal',
    total: 'Total',
    notes: 'Notas',
    paymentOptions: 'Opciones de Pago',
    payOnline: 'Pagar en Línea con Tarjeta',
    bankTransfer: 'Transferencia Bancaria',
    bank: 'Banco',
    account: 'Cuenta',
    routingBranch: 'Sucursal',
    includeInvoiceNumber: 'Por favor incluye el número de factura {invoiceNumber} en la referencia.',
    paymentInstructions: 'Instrucciones de Pago',
    contactForPayment: 'Por favor contacta a {businessName} directamente.',
    paid: 'PAGADO',
    overdue: 'VENCIDO',
    pending: 'PENDIENTE',
    bookingFor: 'Reserva para {name}',
    thankYou: '¡Gracias por su preferencia!'
  },
  he: {
    invoice: 'חשבונית',
    paymentReceived: 'התשלום התקבל',
    paymentReceivedDesc: 'תודה! התשלום שלך עובד בהצלחה.',
    paymentCancelled: 'התשלום בוטל',
    paymentCancelledDesc: 'התשלום שלך בוטל. אפשר לנסות שוב.',
    billTo: 'לכבוד',
    from: 'מאת',
    invoiceNumber: 'חשבונית מס׳',
    issueDate: 'תאריך הנפקה',
    dueDate: 'לתשלום עד',
    dueOnServiceDate: 'לתשלום במועד השירות',
    description: 'תיאור',
    qty: 'כמות',
    price: 'מחיר',
    amount: 'סכום',
    subtotal: 'סכום ביניים',
    total: 'סה"כ לתשלום',
    notes: 'הערות',
    paymentOptions: 'אפשרויות תשלום',
    payOnline: 'שלם בכרטיס אשראי',
    bankTransfer: 'העברה בנקאית',
    bank: 'בנק',
    account: 'מספר חשבון',
    routingBranch: 'סניף',
    includeInvoiceNumber: 'נא לציין את מספר החשבונית {invoiceNumber} בהעברה.',
    paymentInstructions: 'הוראות תשלום',
    contactForPayment: 'ניתן ליצור קשר עם {businessName} לתיאום תשלום.',
    paid: 'שולם',
    overdue: 'באיחור',
    pending: 'ממתין לתשלום',
    bookingFor: 'הזמנה עבור {name}',
    thankYou: 'תודה רבה!'
  }
};

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;

  const { data: invoice } = await supabaseServer
    .from('payment_invoices')
    .select('invoice_number')
    .eq('id', id)
    .single();

  return {
    title: invoice ? `Invoice ${invoice.invoice_number}` : 'Invoice',
  };
}

export default async function InvoicePage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const paymentStatus = query.payment as string | undefined;
  const status = query.status as string | undefined;

  // Fetch invoice
  const { data: invoice, error } = await supabaseServer
    .from('payment_invoices')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !invoice) {
    notFound();
  }

  // Fetch business profile
  const { data: profile } = await supabaseServer
    .from('business_profiles')
    .select(`
      company_name,
      invoice_company_name,
      invoice_address,
      invoice_bank_name,
      invoice_bank_account,
      invoice_bank_routing,
      invoice_payment_instructions,
      logo_url,
      language
    `)
    .eq('user_id', invoice.user_id)
    .single();

  const locale = profile?.language || 'en';
  const isRTL = locale === 'he';

  const t = (key: string, params?: Record<string, string>): string => {
    let text = translations[locale]?.[key] || translations.en[key] || key;
    if (params) {
      Object.entries(params).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, v);
      });
    }
    return text;
  };

  const getLocaleCode = () => {
    switch (locale) {
      case 'he': return 'he-IL';
      case 'es': return 'es-ES';
      default: return 'en-US';
    }
  };

  const businessName = profile?.invoice_company_name || profile?.company_name || 'Business';
  const isPaid = invoice.status === 'paid' || status === 'paid' || paymentStatus === 'success';
  const isManualPayment = paymentStatus === 'manual';
  const isCancelled = paymentStatus === 'cancelled';
  const isOverdue = invoice.status === 'overdue';

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat(getLocaleCode(), {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount);
  };

  // Format date - handles special cases and translates them
  const formatDate = (dateString: string | null): string => {
    if (!dateString) return '-';

    // Check for special text values (case-insensitive, with common variations)
    const lowerDate = dateString.toLowerCase().trim();
    if (
      lowerDate === 'due on service date' ||
      lowerDate === 'service_date' ||
      lowerDate === 'on service date' ||
      lowerDate.includes('service date')
    ) {
      return t('dueOnServiceDate');
    }

    // Try to parse as date
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString;
    }
    return date.toLocaleDateString(getLocaleCode(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const translateNotes = (notes: string): string => {
    const bookingForMatch = notes.match(/^Booking for (.+)$/);
    if (bookingForMatch) {
      return t('bookingFor', { name: bookingForMatch[1] });
    }
    return notes;
  };

  return (
    <div className="min-h-screen bg-slate-100 py-8 px-4" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="max-w-2xl mx-auto">
        {/* Status Banners */}
        {isPaid && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <div>
              <p className="font-semibold text-green-800">{t('paymentReceived')}</p>
              <p className="text-sm text-green-700">{t('paymentReceivedDesc')}</p>
            </div>
          </div>
        )}

        {isCancelled && (
          <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-semibold text-amber-800">{t('paymentCancelled')}</p>
              <p className="text-sm text-amber-700">{t('paymentCancelledDesc')}</p>
            </div>
          </div>
        )}

        {/* Invoice Document */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 overflow-hidden">

          {/* Header with Logo and Invoice Info */}
          <div className="p-6 border-b border-slate-100">
            <div className="flex justify-between items-start">
              {/* Business Info */}
              <div className="flex items-center gap-3">
                {profile?.logo_url ? (
                  <img
                    src={profile.logo_url}
                    alt={businessName}
                    className="h-12 w-auto object-contain"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-lg bg-slate-800 flex items-center justify-center">
                    <Building2 className="h-6 w-6 text-white" />
                  </div>
                )}
                <div>
                  <h2 className="font-bold text-slate-900 text-lg">{businessName}</h2>
                </div>
              </div>

              {/* Invoice Number & Status */}
              <div className={`${isRTL ? 'text-left' : 'text-right'}`}>
                <p className="text-sm text-slate-500">{t('invoiceNumber')}</p>
                <p className="font-bold text-slate-900 text-xl">{invoice.invoice_number}</p>

                {/* Status Badge */}
                <div className={`inline-flex items-center gap-1.5 mt-2 px-3 py-1 rounded text-xs font-bold uppercase tracking-wide ${
                  isPaid
                    ? 'bg-green-100 text-green-800'
                    : isOverdue
                    ? 'bg-red-100 text-red-800'
                    : 'bg-amber-100 text-amber-800'
                }`}>
                  {isPaid ? (
                    <><CheckCircle className="h-3.5 w-3.5" />{t('paid')}</>
                  ) : isOverdue ? (
                    <><AlertCircle className="h-3.5 w-3.5" />{t('overdue')}</>
                  ) : (
                    <><Clock className="h-3.5 w-3.5" />{t('pending')}</>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Bill To & Dates */}
          <div className="p-6 border-b border-slate-100 bg-slate-50">
            <div className="grid grid-cols-2 gap-6">
              {/* Bill To */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('billTo')}</p>
                <p className="font-semibold text-slate-900">{invoice.client_name || '-'}</p>
                {invoice.client_email && (
                  <p className="text-sm text-slate-600">{invoice.client_email}</p>
                )}
              </div>

              {/* Dates */}
              <div className={`${isRTL ? 'text-left' : 'text-right'}`}>
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('issueDate')}</p>
                  <p className="text-slate-900">{formatDate(invoice.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{t('dueDate')}</p>
                  <p className="text-slate-900 font-medium">{formatDate(invoice.due_date)}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="p-6">
            {invoice.line_items && invoice.line_items.length > 0 ? (
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    <th className={`pb-3 ${isRTL ? 'text-right' : 'text-left'} text-xs font-semibold text-slate-500 uppercase tracking-wide`}>{t('description')}</th>
                    <th className="pb-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">{t('qty')}</th>
                    <th className={`pb-3 ${isRTL ? 'text-left' : 'text-right'} text-xs font-semibold text-slate-500 uppercase tracking-wide w-24`}>{t('price')}</th>
                    <th className={`pb-3 ${isRTL ? 'text-left' : 'text-right'} text-xs font-semibold text-slate-500 uppercase tracking-wide w-28`}>{t('amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.line_items.map((item: { description: string; quantity: number; unit_price: number }, idx: number) => (
                    <tr key={idx} className="border-b border-slate-100">
                      <td className={`py-3 ${isRTL ? 'text-right' : 'text-left'} text-slate-900`}>{item.description}</td>
                      <td className="py-3 text-center text-slate-600">{item.quantity}</td>
                      <td className={`py-3 ${isRTL ? 'text-left' : 'text-right'} text-slate-600`}>
                        {formatAmount(item.unit_price, invoice.currency)}
                      </td>
                      <td className={`py-3 ${isRTL ? 'text-left' : 'text-right'} text-slate-900 font-medium`}>
                        {formatAmount(item.quantity * item.unit_price, invoice.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="py-4 text-center text-slate-500">-</div>
            )}

            {/* Total */}
            <div className={`mt-4 pt-4 border-t-2 border-slate-200 flex justify-between items-center`}>
              <span className="text-lg font-bold text-slate-900">{t('total')}</span>
              <span className="text-2xl font-bold text-slate-900">
                {formatAmount(invoice.amount, invoice.currency)}
              </span>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="px-6 pb-6">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">{t('notes')}</p>
              <p className="text-sm text-slate-600 bg-slate-50 rounded p-3">{translateNotes(invoice.notes)}</p>
            </div>
          )}

          {/* Payment Section */}
          {!isPaid && (
            <div className="p-6 bg-slate-50 border-t border-slate-200">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-slate-600" />
                {t('paymentOptions')}
              </h3>

              <div className="space-y-3">
                {/* Online Payment */}
                {!isManualPayment && (
                  <a
                    href={`/api/public/invoice/${invoice.id}/pay`}
                    className="block w-full text-center px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {t('payOnline')}
                  </a>
                )}

                {/* Bank Transfer */}
                {(profile?.invoice_bank_name || profile?.invoice_bank_account) && (
                  <div className="p-4 bg-white border border-slate-200 rounded-lg">
                    <h4 className="font-semibold text-slate-900 mb-3">{t('bankTransfer')}</h4>
                    <div className="space-y-2 text-sm">
                      {profile.invoice_bank_name && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">{t('bank')}</span>
                          <span className="font-medium text-slate-900">{profile.invoice_bank_name}</span>
                        </div>
                      )}
                      {profile.invoice_bank_account && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">{t('account')}</span>
                          <span className="font-medium text-slate-900 font-mono">{profile.invoice_bank_account}</span>
                        </div>
                      )}
                      {profile.invoice_bank_routing && (
                        <div className="flex justify-between">
                          <span className="text-slate-500">{t('routingBranch')}</span>
                          <span className="font-medium text-slate-900">{profile.invoice_bank_routing}</span>
                        </div>
                      )}
                    </div>
                    <p className="mt-3 text-xs text-slate-500 border-t border-slate-100 pt-3">
                      {t('includeInvoiceNumber', { invoiceNumber: invoice.invoice_number })}
                    </p>
                  </div>
                )}

                {/* Payment Instructions */}
                {profile?.invoice_payment_instructions && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <h4 className="font-semibold text-amber-800 mb-2">{t('paymentInstructions')}</h4>
                    <p className="text-sm text-amber-700">{profile.invoice_payment_instructions}</p>
                  </div>
                )}

                {/* Contact for Payment */}
                {isManualPayment && !profile?.invoice_bank_name && !profile?.invoice_payment_instructions && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-center">
                    <p className="text-sm text-blue-700">
                      {t('contactForPayment', { businessName })}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="px-6 py-4 bg-slate-800 text-center">
            <p className="text-sm text-slate-300">{t('thankYou')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Public Invoice Page
 *
 * Shows invoice details to clients (no auth required).
 * Handles different states: paid, pending payment, manual payment instructions.
 * Supports Hebrew, Spanish, and English with RTL layout for Hebrew.
 */

import { Metadata } from 'next';
import { resolveInvoicePaymentOptions } from '@/lib/payments/invoicePaymentOptions';
import { resolvePaymentCollectionCapability } from '@/lib/payments/stripeAccountContext';
import { notFound } from 'next/navigation';
import { supabaseServer } from '@/lib/supabaseServer';
import { CheckCircle, Clock, CreditCard, Building2, AlertCircle } from 'lucide-react';
import { BusinessInfoPanel } from '@/components/public/BusinessInfoPanel';
import { resolvePublicBranding } from '@/lib/branding/publicBranding';
import { localeCode, publicT, toLocale } from '@/lib/i18n/public-pages';
import { taxLineFor } from '@/lib/payments/taxLine';

// The page's own translation table moved into `lib/i18n/public-pages`, where it
// sits beside the date and money formatters that have to agree with it.

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
    // An invoice names a real customer and an amount they owe. It must never
    // reach a search index.
    robots: { index: false, follow: false },
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
      invoice_footer_text,
      logo_url,
      language
    `)
    .eq('user_id', invoice.user_id)
    .single();

  /*
   * The tax the business says is already inside the price.
   *
   * A SEPARATE query, deliberately, rather than three more columns on the
   * profile select above. That select feeds the company name, the bank details
   * and the footer, and PostgREST fails the WHOLE statement if any one column is
   * missing — so adding optional columns to it would take this page's identity
   * down on any database where the tax migration has not run yet. Here a failure
   * costs exactly the tax line, which is also what an unconfigured business
   * sees.
   */
  const { data: taxSettings } = await supabaseServer
    .from('business_profiles')
    .select('invoice_prices_include_tax, invoice_tax_rate, invoice_tax_label')
    .eq('user_id', invoice.user_id)
    .maybeSingle();

  // Null when the business never configured tax — and then no line is drawn at
  // all, rather than a "VAT 0.00" on every invoice from every business.
  const taxLine = taxLineFor(invoice.amount, invoice.currency, taxSettings);

  // The business's identity and look, from the one public resolver — the same
  // one the confirmation email and the booking pages read. This page used to
  // take only the logo and the name from the profile and then hardcode a blue
  // pay button, so it was the one public surface wearing no brand colour at all.
  const brand = await resolvePublicBranding({ by: 'invoiceId', invoiceId: id });

  const locale = toLocale(brand?.locale ?? profile?.language);
  const isRTL = locale === 'he';

  const t = (key: string, params?: Record<string, string>): string =>
    publicT(locale, key, params);

  const getLocaleCode = () => localeCode(locale);

  const businessName =
    profile?.invoice_company_name || profile?.company_name || brand?.businessName || 'Business';
  const isPaid = invoice.status === 'paid' || status === 'paid' || paymentStatus === 'success';
  const isManualPayment = paymentStatus === 'manual';

  /**
   * What this client can actually do, resolved the same way the email and the
   * PDF resolve it.
   *
   * The card button used to render on `!isManualPayment` alone — a query string
   * — with no regard for whether the business has a processor. On a business
   * that collects by transfer the only route to the bank details was to click
   * that button, be bounced through `/pay`, and land back here with
   * `?payment=manual`. Nothing ever linked to that directly, so it was the only
   * way in, and it went via a dead end.
   */
  const capability = await resolvePaymentCollectionCapability(supabaseServer, invoice.user_id);

  const paymentOptions = resolveInvoicePaymentOptions({
    // The query string still forces the manual view, so an explicit
    // "pay another way" link keeps working.
    canCollectOnline: capability.canCollect && !isManualPayment,
    // And the invoice's own answer, which is what the business ticked when it
    // wrote the invoice. Without this the page offered a card on an invoice
    // marked transfer-only, and the business never knew.
    allowOnlinePayment: invoice.allow_online_payment,
    cardUrl: `/api/public/invoice/${invoice.id}/pay`,
    profile,
  });
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

  /**
   * Hebrew has no letter case.
   *
   * `uppercase tracking-wide` was applied to every column heading and field
   * label unconditionally, which does nothing to לכבוד or תיאור except space
   * the letters out unnaturally.
   */
  const labelCase: React.CSSProperties = isRTL
    ? { textTransform: 'none', letterSpacing: 'normal' }
    : { textTransform: 'uppercase', letterSpacing: '0.05em' };

  const labelStyle: React.CSSProperties = {
    color: 'var(--ap-text-muted)',
    ...labelCase,
  };

  // `text-start` / `text-end` rather than an `isRTL ?` ternary on each of eight
  // table cells: the logical property already means "whichever side the reader
  // starts on".
  const startAlign = 'text-start';
  const endAlign = 'text-end';

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      lang={locale}
      className="min-h-screen px-4 py-8"
      style={{ background: 'var(--ap-surface-2)', color: 'var(--ap-text)' }}
    >
      <div className="mx-auto max-w-2xl">
        {isPaid && (
          <div
            className="mb-4 flex items-center gap-3 p-4"
            style={{
              background: '#DCFCE7',
              border: '1px solid #BBF7D0',
              borderRadius: 'var(--ap-radius-md)',
            }}
          >
            <CheckCircle className="h-5 w-5 shrink-0" style={{ color: '#15803D' }} />
            <div>
              <p className="font-semibold" style={{ color: '#166534' }}>
                {t('paymentReceived')}
              </p>
              <p className="text-sm" style={{ color: '#15803D' }}>
                {t('paymentReceivedDesc')}
              </p>
            </div>
          </div>
        )}

        {isCancelled && (
          <div
            className="mb-4 flex items-center gap-3 p-4"
            style={{
              background: '#FEF3C7',
              border: '1px solid #FDE68A',
              borderRadius: 'var(--ap-radius-md)',
            }}
          >
            <AlertCircle className="h-5 w-5 shrink-0" style={{ color: '#B45309' }} />
            <div>
              <p className="font-semibold" style={{ color: '#92400E' }}>
                {t('paymentCancelled')}
              </p>
              <p className="text-sm" style={{ color: '#B45309' }}>
                {t('paymentCancelledDesc')}
              </p>
            </div>
          </div>
        )}

        {/* The document itself. A brand-coloured rule across the top is the one
            place the business's colour can appear without competing with the
            status colours that have to stay semantic. */}
        <div
          className="overflow-hidden"
          style={{
            background: 'var(--ap-surface)',
            border: '1px solid var(--ap-border)',
            borderRadius: 'var(--ap-radius-lg)',
            boxShadow: 'var(--ap-shadow-md)',
            borderTop: '4px solid var(--ap-brand)',
          }}
        >
          <div className="p-6" style={{ borderBottom: '1px solid var(--ap-border)' }}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {profile?.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- arbitrary remote host
                  <img
                    src={profile.logo_url}
                    alt={businessName}
                    className="h-12 w-auto object-contain"
                  />
                ) : (
                  <div
                    className="flex h-12 w-12 items-center justify-center"
                    style={{ background: 'var(--ap-brand)', borderRadius: 'var(--ap-radius-md)' }}
                  >
                    <Building2 className="h-6 w-6" style={{ color: 'var(--ap-on-brand)' }} />
                  </div>
                )}
                <h2
                  className="text-lg font-bold"
                  style={{ color: 'var(--ap-text)', fontFamily: 'var(--ap-font-heading)' }}
                >
                  <bdi>{businessName}</bdi>
                </h2>
              </div>

              <div className={endAlign}>
                <p className="text-sm" style={{ color: 'var(--ap-text-muted)' }}>
                  {t('invoiceNumber')}
                </p>
                <p className="text-xl font-bold" style={{ color: 'var(--ap-text)' }}>
                  <bdi>{invoice.invoice_number}</bdi>
                </p>

                <div
                  className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold"
                  style={{
                    borderRadius: 'var(--ap-radius-sm)',
                    ...labelCase,
                    ...(isPaid
                      ? { background: '#DCFCE7', color: '#166534' }
                      : isOverdue
                        ? { background: '#FEE2E2', color: '#991B1B' }
                        : { background: '#FEF3C7', color: '#92400E' }),
                  }}
                >
                  {isPaid ? (
                    <>
                      <CheckCircle className="h-3.5 w-3.5" />
                      {t('paid')}
                    </>
                  ) : isOverdue ? (
                    <>
                      <AlertCircle className="h-3.5 w-3.5" />
                      {t('overdue')}
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5" />
                      {t('pending')}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div
            className="p-6"
            style={{
              background: 'var(--ap-surface-2)',
              borderBottom: '1px solid var(--ap-border)',
            }}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6">
              <div className="min-w-0">
                <p className="mb-1 text-xs font-semibold" style={labelStyle}>
                  {t('billTo')}
                </p>
                <p className="font-semibold" style={{ color: 'var(--ap-text)' }}>
                  <bdi>{invoice.client_name || '-'}</bdi>
                </p>
                {invoice.client_email && (
                  <p className="text-sm break-words" style={{ color: 'var(--ap-text-muted)' }}>
                    <bdi>{invoice.client_email}</bdi>
                  </p>
                )}
              </div>

              {/* Literal classes, not `sm:${endAlign}`: Tailwind scans source
                  text for class names, so an interpolated variant is never
                  generated and the rule would silently not exist. */}
              <div className="min-w-0 text-start sm:text-end">
                <div className="mb-2">
                  <p className="text-xs font-semibold" style={labelStyle}>
                    {t('issueDate')}
                  </p>
                  <p style={{ color: 'var(--ap-text)' }}>{formatDate(invoice.created_at)}</p>
                </div>
                <div>
                  <p className="text-xs font-semibold" style={labelStyle}>
                    {t('dueDate')}
                  </p>
                  <p className="font-medium" style={{ color: 'var(--ap-text)' }}>
                    {formatDate(invoice.due_date)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6">
            {invoice.line_items && invoice.line_items.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--ap-border)' }}>
                      <th className={`pb-3 text-xs font-semibold ${startAlign}`} style={labelStyle}>
                        {t('description')}
                      </th>
                      <th className="w-16 pb-3 text-center text-xs font-semibold" style={labelStyle}>
                        {t('qty')}
                      </th>
                      <th className={`w-24 pb-3 text-xs font-semibold ${endAlign}`} style={labelStyle}>
                        {t('price')}
                      </th>
                      <th className={`w-28 pb-3 text-xs font-semibold ${endAlign}`} style={labelStyle}>
                        {t('amount')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoice.line_items.map(
                      (
                        item: { description: string; quantity: number; unit_price: number },
                        idx: number
                      ) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--ap-border)' }}>
                          <td className={`py-3 ${startAlign}`} style={{ color: 'var(--ap-text)' }}>
                            <bdi>{item.description}</bdi>
                          </td>
                          <td className="py-3 text-center" style={{ color: 'var(--ap-text-muted)' }}>
                            {item.quantity}
                          </td>
                          <td className={`py-3 ${endAlign}`} style={{ color: 'var(--ap-text-muted)' }}>
                            {formatAmount(item.unit_price, invoice.currency)}
                          </td>
                          <td
                            className={`py-3 font-medium ${endAlign}`}
                            style={{ color: 'var(--ap-text)' }}
                          >
                            {formatAmount(item.quantity * item.unit_price, invoice.currency)}
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-4 text-center" style={{ color: 'var(--ap-text-muted)' }}>
                -
              </div>
            )}

            <div
              className="mt-4 flex items-center justify-between pt-4"
              style={{ borderTop: `2px solid var(--ap-brand)` }}
            >
              <span className="text-lg font-bold" style={{ color: 'var(--ap-text)' }}>
                {t('total')}
              </span>
              <span className="text-2xl font-bold" style={{ color: 'var(--ap-brand)' }}>
                {formatAmount(invoice.amount, invoice.currency)}
              </span>
            </div>

            {/* UNDER the total, because the tax is contained in it. Above, and
                the reader adds it on — the one misreading that changes what
                they think they owe. Same placement as the emailed invoice and
                the PDF, all three derived from the same figures. */}
            {taxLine && (
              <div
                className="mt-2 flex items-center justify-between text-sm"
                style={{ color: 'var(--ap-text-muted)' }}
              >
                <span>
                  {t('includesTax')} {taxLine.label} {taxLine.rate}%
                </span>
                <span>{formatAmount(taxLine.amount, invoice.currency)}</span>
              </div>
            )}
          </div>

          {invoice.notes && (
            <div className="px-6 pb-6">
              <p className="mb-1 text-xs font-semibold" style={labelStyle}>
                {t('notes')}
              </p>
              <p
                className="p-3 text-sm"
                style={{
                  color: 'var(--ap-text-muted)',
                  background: 'var(--ap-surface-2)',
                  borderRadius: 'var(--ap-radius-sm)',
                }}
              >
                <bdi>{translateNotes(invoice.notes)}</bdi>
              </p>
            </div>
          )}

          {/* Paying is what this page is for, so it is the visual climax. */}
          {!isPaid && (
            <div
              className="p-6"
              style={{
                background: 'var(--ap-surface-2)',
                borderTop: '1px solid var(--ap-border)',
              }}
            >
              <h3
                className="mb-4 flex items-center gap-2 font-semibold"
                style={{ color: 'var(--ap-text)' }}
              >
                <CreditCard className="h-5 w-5" style={{ color: 'var(--ap-brand)' }} />
                {t('paymentOptions')}
              </h3>

              <div className="space-y-3">
                {/* Online Payment — only when a card can actually be taken. */}
                {paymentOptions.card && paymentOptions.cardUrl && (
                  <a
                    href={paymentOptions.cardUrl}
                    className="block w-full px-6 py-3.5 text-center font-semibold transition-opacity hover:opacity-90 ap-no-print"
                    style={{
                      background: 'var(--ap-brand)',
                      color: 'var(--ap-on-brand)',
                      borderRadius: 'var(--ap-radius-md)',
                    }}
                  >
                    {t('payOnline')}
                  </a>
                )}

                {/* Bank Transfer — on ANY bank field. This required a name or
                    an account, while the PDF required a name or instructions,
                    so a business with only an account number was described
                    differently by the two. */}
                {paymentOptions.bank && (
                  <div
                    className="p-4"
                    style={{
                      background: 'var(--ap-surface)',
                      border: '1px solid var(--ap-border)',
                      borderRadius: 'var(--ap-radius-md)',
                    }}
                  >
                    <h4 className="mb-3 font-semibold" style={{ color: 'var(--ap-text)' }}>
                      {t('bankTransfer')}
                    </h4>
                    <div className="space-y-2 text-sm">
                      {paymentOptions.bankName && (
                        <div className="flex justify-between gap-4">
                          <span style={{ color: 'var(--ap-text-muted)' }}>{t('bank')}</span>
                          <span className="font-medium" style={{ color: 'var(--ap-text)' }}>
                            <bdi>{paymentOptions.bankName}</bdi>
                          </span>
                        </div>
                      )}
                      {paymentOptions.bankAccount && (
                        <div className="flex justify-between gap-4">
                          <span style={{ color: 'var(--ap-text-muted)' }}>{t('account')}</span>
                          {/* An account number is a Latin digit string that must
                              not be reordered inside a Hebrew line. */}
                          <span
                            dir="ltr"
                            className="font-mono font-medium"
                            style={{ color: 'var(--ap-text)' }}
                          >
                            {paymentOptions.bankAccount}
                          </span>
                        </div>
                      )}
                      {paymentOptions.bankRouting && (
                        <div className="flex justify-between gap-4">
                          <span style={{ color: 'var(--ap-text-muted)' }}>{t('routingBranch')}</span>
                          <span dir="ltr" className="font-medium" style={{ color: 'var(--ap-text)' }}>
                            {paymentOptions.bankRouting}
                          </span>
                        </div>
                      )}
                    </div>
                    <p
                      className="mt-3 pt-3 text-xs"
                      style={{ color: 'var(--ap-text-muted)', borderTop: '1px solid var(--ap-border)' }}
                    >
                      {t('includeInvoiceNumber', { invoiceNumber: invoice.invoice_number })}
                    </p>
                  </div>
                )}

                {paymentOptions.instructions && (
                  <div
                    className="p-4"
                    style={{
                      background: '#FEF3C7',
                      border: '1px solid #FDE68A',
                      borderRadius: 'var(--ap-radius-md)',
                    }}
                  >
                    <h4 className="mb-2 font-semibold" style={{ color: '#92400E' }}>
                      {t('paymentInstructions')}
                    </h4>
                    <p className="text-sm" style={{ color: '#B45309' }}>
                      {paymentOptions.instructions}
                    </p>
                  </div>
                )}

                {/* Contact for Payment — whenever there is genuinely no way to
                    pay, not only after a bounce through `?payment=manual`. A
                    client holding a bill with a blank space where the method
                    should be needs telling, however they arrived. */}
                {paymentOptions.none && (
                  <div
                    className="p-4 text-center"
                    style={{
                      background: 'var(--ap-brand-tint)',
                      border: '1px solid var(--ap-brand-ring)',
                      borderRadius: 'var(--ap-radius-md)',
                    }}
                  >
                    <p className="text-sm" style={{ color: 'var(--ap-text)' }}>
                      <bdi>{t('contactForPayment', { businessName })}</bdi>
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div
            className="px-6 py-4 text-center"
            style={{ background: 'var(--ap-brand)', color: 'var(--ap-on-brand)' }}
          >
            <p className="text-sm">{t('thankYouBusiness')}</p>
            {profile?.invoice_footer_text && (
              <p className="mt-1 text-xs opacity-80">
                <bdi>{profile.invoice_footer_text}</bdi>
              </p>
            )}
          </div>
        </div>

        {/* How to reach the business about this bill. */}
        {brand && (
          <div className="mt-6">
            <BusinessInfoPanel brand={brand} variant="card" show={['contact', 'address']} />
          </div>
        )}
      </div>
    </div>
  );
}

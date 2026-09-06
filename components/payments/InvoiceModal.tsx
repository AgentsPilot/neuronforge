'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SwitchRow } from './SwitchRow';
import { createLogger } from '@/lib/logger';
import { useLanguage, type CurrencyCode } from '@/lib/business-os/LanguageContext';
import {
  // No X: DialogContent renders its own close control, and a second one in the
  // header was the hand-rolled overlay's job.
  Plus,
  Trash2,
  User,
  Mail,
  Calendar,
  CreditCard,
  FileText,
  Loader2,
  ChevronDown,
  Check,
  AlertCircle,
  Search,
  Send,
} from 'lucide-react';

const logger = createLogger({ module: 'InvoiceModal' });

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSave: () => void;
  contactId?: string;
  contactName?: string;
  contactEmail?: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  // Set when the line was filled from the service catalogue. The invoice itself
  // carries one service, so the first line that names one attributes the whole
  // invoice in the revenue-by-service breakdown.
  service_id?: string | null;
}

interface Contact {
  id: string;
  full_name: string;
  email: string | null;
}

interface Service {
  id: string;
  service_name: string;
  price: number;
  currency: string;
}

// Reports theme color (green) - matches reports page
const REPORTS_COLOR = '#22C58B';

// Due date preset options - translation keys for the labels
const DUE_DATE_PRESETS_BASE = [
  { value: 'receipt', key: 'due_on_receipt', days: 0 },
  { value: 'net7', key: 'net_7', days: 7 },
  { value: 'net15', key: 'net_15', days: 15 },
  { value: 'net30', key: 'net_30', days: 30 },
  { value: 'net60', key: 'net_60', days: 60 },
  { value: 'custom', key: 'custom', days: -1 },
];

export function InvoiceModal({ isOpen, onClose, onSave, contactId, contactName, contactEmail }: Props) {
  const { currencyCode, availableCurrencies, t, isRTL } = useLanguage();

  // Get translated due date presets - memoized to update when language changes
  const dueDatePresets = useMemo(() => {
    return DUE_DATE_PRESETS_BASE.map(preset => ({
      value: preset.value,
      label: t(`invoice.payment_terms_values.${preset.key}`) || preset.key,
      days: preset.days,
    }));
  }, [t]);

  const [loading, setLoading] = useState(false);
  // Which of the two footer actions is in flight, so the spinner appears on the
  // button that was actually pressed rather than on both.
  const [pendingIntent, setPendingIntent] = useState<'create' | 'send' | null>(null);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  /*
   * Three states, not two: connected, not connected, and NOT YET KNOWN.
   *
   * Held as a plain boolean this started `false`, so every opening of the
   * dialog asserted "Stripe not connected" until the check came back — and on
   * the orders page, where a dozen requests are in flight at once, that answer
   * sat on screen long enough to be read and believed. It is the same mistake
   * as rendering an empty list before the rows arrive, except the empty state
   * here is a factual claim about the business's account.
   *
   * `null` means the question is still open, and nothing is claimed either way.
   */
  const [hasStripeConnect, setHasStripeConnect] = useState<boolean | null>(null);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [dueDatePreset, setDueDatePreset] = useState('net30');
  const [showDueDateDropdown, setShowDueDateDropdown] = useState(false);
  const [activeServiceDropdown, setActiveServiceDropdown] = useState<number | null>(null);
  const [serviceSearch, setServiceSearch] = useState('');

  /*
   * The currency THIS invoice is in.
   *
   * Seeded from the business's default, because that is what nearly every
   * invoice will be — but it is a property of the invoice, not of the business.
   * A client abroad is billed in their currency, and until now the dialog
   * printed the default as a fixed label and sent it regardless.
   *
   * Changing it RELABELS, it does not convert: 400 stays 400. There is no rate
   * here and inventing one would silently restate what someone is being
   * charged, so the numbers are left exactly as typed.
   */
  const [invoiceCurrency, setInvoiceCurrency] = useState<CurrencyCode>(currencyCode);

  const [lineItems, setLineItems] = useState<LineItem[]>([
    { description: '', quantity: 1, unit_price: 0, total: 0 }
  ]);

  const [formData, setFormData] = useState({
    contact_id: contactId || '',
    client_name: contactName || '',
    client_email: contactEmail || '',
    amount: 0,
    due_date: '',
    payment_terms: 'net_30',
    notes: '',
    // How it goes out, once the footer says it should. Whether it goes out at
    // all is not stored: it is the button that was pressed.
    send_via_stripe: true,
  });

  // Track when modal was last opened to prevent resetting during user interaction
  const wasOpenRef = React.useRef(false);

  /*
   * Nothing is fetched until the dialog is actually opened.
   *
   * This ran on MOUNT — and the dialog is mounted with the orders page, closed,
   * so every page load fired three requests for a form nobody had opened yet:
   * contacts, services, and the Stripe check. They queued among the list's own
   * requests (money, invoices, refunds, transactions) against the browser's
   * ~6-connection limit, each paying the auth cost on the way in.
   *
   * So the Stripe answer genuinely did arrive "after the orders loaded" — it
   * was behind them in the queue, for a question no one had asked yet.
   *
   * Moved into the open transition below: the page loads faster for not doing
   * this work, and the check runs on a clear field, which is why it now comes
   * back quickly rather than last.
   */

  // Reset formData when modal opens with props (only on open transition)
  useEffect(() => {
    // Only reset when transitioning from closed to open
    if (isOpen && !wasOpenRef.current) {
      const date = new Date();
      date.setDate(date.getDate() + 30);

      setFormData({
        contact_id: contactId || '',
        client_name: contactName || '',
        client_email: contactEmail || '',
        amount: 0,
        due_date: date.toISOString().split('T')[0],
        payment_terms: 'net_30',
        notes: '',
        send_via_stripe: true,
      });

      // Reset line items
      setLineItems([{ description: '', quantity: 1, unit_price: 0, total: 0 }]);
      setDueDatePreset('net30');
      setInvoiceCurrency(currencyCode);

      /*
       * Everything this form needs, asked for when it is opened.
       *
       * Also the correct moment for the Stripe check on its own merits: a
       * business can connect in another tab, and an answer cached from page
       * load would be the one deciding whether this invoice can be sent.
       */
      loadContacts();
      loadServices();
      checkStripeConnect();
    }

    wasOpenRef.current = isOpen;
  }, [isOpen, contactId, contactName, contactEmail]);

  const loadContacts = async () => {
    try {
      setLoadingContacts(true);
      const response = await fetch('/api/crm/contacts?limit=100');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.contacts) {
          // Map contacts to include full_name
          const mappedContacts = data.contacts.map((c: { id: string; first_name?: string; last_name?: string; email?: string | null }) => ({
            id: c.id,
            full_name: [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown',
            email: c.email || null,
          }));
          setContacts(mappedContacts);
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load contacts');
    } finally {
      setLoadingContacts(false);
    }
  };

  const loadServices = async () => {
    try {
      const response = await fetch('/api/scheduling/services?activeOnly=true');
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.services) {
          setServices(data.services.map((s: { id: string; service_name: string; price?: number; currency?: string }) => ({
            id: s.id,
            service_name: s.service_name,
            price: s.price || 0,
            currency: s.currency || currencyCode,
          })));
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load services');
    }
  };

  /*
   * Is this business connected to Stripe?
   *
   * The answer decides whether the dialog offers to send the invoice at all, so
   * getting it wrong is not cosmetic: a business whose account is live and
   * charging is told "Stripe not connected", the send option disappears, and
   * the invoice is written as a draft that never reaches anyone.
   *
   * Two things used to make a wrong answer stick:
   *
   *   - it ran ONCE on mount. The dialog is mounted with the page, so a check
   *     that failed at page load stayed failed for every invoice written
   *     afterwards, with no way to retry short of a reload.
   *   - state was only ever set on the success path. A failed request left the
   *     previous answer — false, on first load — in place and said nothing, so
   *     a transient failure was indistinguishable from a real disconnection.
   *
   * Now it re-asks each time the dialog opens and writes the answer on every
   * path, so an unknown is at least a fresh unknown and a failure is logged.
   */
  const checkStripeConnect = async () => {
    try {
      const response = await fetch('/api/payments/stripe-connect');
      const data = await response.json();

      if (!response.ok || !data.success) {
        // Still unknown. Sending falls back to the branded email either way, so
        // an unanswered check costs the Stripe option — never a false claim.
        logger.warn({ status: response.status }, 'Stripe Connect status check failed');
        return;
      }

      // `data.data` is null when the business genuinely has no account — a real
      // answer, and the one case where false is correct.
      setHasStripeConnect(!!data.data?.stripe_account_id);
    } catch (error) {
      logger.error({ err: error }, 'Failed to check Stripe Connect status');
    }
  };

  const selectContact = (contact: Contact) => {
    setFormData(prev => ({
      ...prev,
      contact_id: contact.id,
      client_name: contact.full_name,
      client_email: contact.email || '',
    }));
    setContactSearch('');
    setShowContactDropdown(false);
  };

  const selectDueDatePreset = (preset: typeof dueDatePresets[0]) => {
    if (preset.value === 'custom') {
      setDueDatePreset('custom');
      setShowDueDateDropdown(false);
      return;
    }

    const date = new Date();
    date.setDate(date.getDate() + preset.days);
    setFormData(prev => ({
      ...prev,
      due_date: date.toISOString().split('T')[0],
      payment_terms: preset.value,
    }));
    setDueDatePreset(preset.value);
    setShowDueDateDropdown(false);
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { description: '', quantity: 1, unit_price: 0, total: 0 }]);
  };

  const updateLineItem = (index: number, field: keyof LineItem, value: string | number) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };

    if (field === 'quantity' || field === 'unit_price') {
      updated[index].total = updated[index].quantity * updated[index].unit_price;
    }

    setLineItems(updated);

    const totalAmount = updated.reduce((sum, item) => sum + item.total, 0);
    setFormData(prev => ({ ...prev, amount: totalAmount }));
  };

  const removeLineItem = (index: number) => {
    if (lineItems.length > 1) {
      const updated = lineItems.filter((_, i) => i !== index);
      setLineItems(updated);

      const totalAmount = updated.reduce((sum, item) => sum + item.total, 0);
      setFormData(prev => ({ ...prev, amount: totalAmount }));
    }
  };

  const selectService = (index: number, service: Service) => {
    const updated = [...lineItems];
    updated[index] = {
      ...updated[index],
      description: service.service_name,
      unit_price: service.price,
      total: updated[index].quantity * service.price,
      service_id: service.id,
    };
    setLineItems(updated);

    const totalAmount = updated.reduce((sum, item) => sum + item.total, 0);
    setFormData(prev => ({ ...prev, amount: totalAmount }));
    setActiveServiceDropdown(null);
    setServiceSearch('');
  };

  /*
   * Will pressing the button send this to the client?
   *
   * Sending does NOT require Stripe. `sendInvoice` uses a Stripe-hosted invoice
   * when the business is connected and asked for one, and otherwise emails the
   * branded invoice with its PDF attached — so a business collecting by
   * transfer can still send, which the old single "Send via Stripe" tick made
   * look impossible.
   *
   * The button reads this, and so does the request, so the label cannot promise
   * something different from what is posted.
   */
  const willUseStripe = formData.send_via_stripe && hasStripeConnect === true;

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: invoiceCurrency,
    }).format(amount);
  };

  /*
   * Which button was pressed — and what happens when neither was.
   *
   * Both footer buttons submit the form, so native validation still runs on the
   * required fields. `submitter` says which one, and a submit with NO submitter
   * is the Enter key: that saves a draft. Sending has to be an act of pressing
   * the send button, not something a stray keystroke in the notes box can do.
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const send = submitter?.value === 'send';
    setPendingIntent(send ? 'send' : 'create');

    // Validate client info
    if (!formData.client_name || !formData.client_email) {
      alert('Please provide client name and email');
      return;
    }

    // Validate line items
    const validItems = lineItems.filter(item => item.description && item.quantity > 0);
    if (validItems.length === 0) {
      alert('Please add at least one line item');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/payments/invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: formData.contact_id || null,
          client_name: formData.client_name,
          client_email: formData.client_email,
          amount: formData.amount,
          due_date: formData.due_date,
          payment_terms: formData.payment_terms,
          notes: formData.notes,
          line_items: validItems,
          // Which service this invoice is for, so the money lands on a row in
          // the reports page's revenue-by-service card.
          service_id: validItems.find(item => item.service_id)?.service_id || null,
          currency: invoiceCurrency,
          /*
           * Issued, whichever button was pressed.
           *
           * `sent` is what this codebase means by ISSUED — it is what
           * ISSUED_INVOICE_STATUSES counts, what ages into overdue, and what the
           * mark-paid and payment-link actions act on. An invoice written here
           * is a real numbered document that a client owes; not emailing it
           * does not make it provisional.
           *
           * `sent_at` stays null when we did not deliver it, and the list reads
           * that to label it "Issued" rather than claiming it was sent.
           */
          status: 'sent',
          send,
          // Only meaningful when sending, and only when actually connected.
          use_stripe: send && willUseStripe,
          /*
           * The toggle as an INTENT, independent of whether this press sends.
           *
           * Deliberately not `send && …`: an invoice created without sending
           * would then record "transfer only" purely because it was not sent
           * yet, and its pay page would drop the card button the writer had
           * asked for.
           *
           * Only stated when we know the business could collect online at all —
           * otherwise no choice was made and the column stays null.
           */
          allow_online_payment:
            hasStripeConnect === true ? formData.send_via_stripe : undefined,
        }),
      });

      const result = await response.json();

      if (result.success) {
        /*
         * The invoice exists either way, so the dialog closes either way — a
         * second attempt from here would create a duplicate. But a delivery
         * that failed has to be said out loud: it leaves a draft sitting in the
         * list that the business believes is with their client, which is the
         * failure this whole path was reported for.
         */
        if (result.delivery && !result.delivery.sent) {
          alert(
            `${t('invoice.created_not_sent') || 'Invoice created, but it could not be sent'}${
              result.delivery.error ? `: ${result.delivery.error}` : ''
            }`
          );
        }
        onSave();
      } else {
        logger.error({ error: result.error }, 'Failed to create invoice');
        alert(result.error || 'Failed to create invoice. Please try again.');
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to create invoice');
      alert('Failed to create invoice. Please try again.');
    } finally {
      setLoading(false);
      setPendingIntent(null);
    }
  };

  /*
   * A Radix dialog, like every other money dialog on this screen.
   *
   * The hand-rolled `fixed inset-0 z-[100]` this replaces is the same shape
   * that put the refund modal behind the CRM drawer: a raw overlay inside
   * another component's stacking context loses to whatever it was opened from,
   * and nothing about the z-index says so. Radix portals to the body and owns
   * the focus trap, the escape key and the scroll lock.
   */
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="flex w-full sm:max-w-2xl h-[100vh] sm:h-auto max-h-[100vh] sm:max-h-[90vh] flex-col rounded-none sm:rounded-lg p-0 overflow-hidden"
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
        {/* ── Header ──────────────────────────────────────────────────────
            Led by the total, the way the refund dialog is led by the amount
            being returned. What this invoice comes to is the fact the writer
            is watching; it used to sit two thirds of the way down the form,
            below the line items, where it could not be seen while typing them.
            The currency sits directly under it because it is what that number
            is denominated in. */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-5 py-5">
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-8 w-8 items-center justify-center"
              style={{ backgroundColor: `${REPORTS_COLOR}15`, borderRadius: 'var(--v2-radius-button)' }}
            >
              <FileText className="h-4 w-4" style={{ color: REPORTS_COLOR }} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-[15px] font-semibold text-[var(--v2-text-primary)]">
                {t('invoice.create_title') || 'Create Invoice'}
              </DialogTitle>
              <p className="truncate text-[12px] text-[var(--v2-text-muted)]">
                {t('invoice.create_subtitle') || 'Send a professional invoice to your client'}
              </p>
            </div>
          </div>

          <div className="mt-4 text-[28px] font-semibold leading-none tabular-nums text-[var(--v2-text-primary)]">
            <bdi>{formatCurrency(formData.amount)}</bdi>
          </div>

          {/* Four currencies, so segments rather than another dropdown — the
              same control the refund dialog uses for a short exclusive choice,
              and one that shows all the options without being opened. */}
          <div
            className="mt-3 inline-flex gap-1 bg-[var(--v2-surface-hover)] p-1"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            role="radiogroup"
            aria-label={t('invoice.currency') || 'Currency'}
          >
            {(Object.keys(availableCurrencies) as CurrencyCode[]).map(code => (
              <button
                key={code}
                type="button"
                role="radio"
                aria-checked={invoiceCurrency === code}
                onClick={() => setInvoiceCurrency(code)}
                className={`px-2.5 py-1 text-[12px] transition-colors ${
                  invoiceCurrency === code
                    ? 'bg-[var(--v2-bg)] font-medium text-[var(--v2-text-primary)] shadow-sm'
                    : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]'
                }`}
                style={{ borderRadius: 'calc(var(--v2-radius-button) - 2px)' }}
              >
                {availableCurrencies[code].symbol} {code}
              </button>
            ))}
          </div>
        </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">
          {/* Client Selection */}
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              <User className="w-3.5 h-3.5" />
              {t('invoice.client_info') || 'Client Information'}
            </h3>

            {/* Contact Dropdown */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowContactDropdown(!showContactDropdown)}
                className="w-full px-3 py-2.5 text-sm border border-[var(--v2-border)] bg-[var(--v2-bg)] rounded-lg flex items-center justify-between hover:border-[var(--v2-primary)] transition-colors"
              >
                <span className={formData.contact_id ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                  {formData.client_name || (t('invoice.select_contact') || 'Select a contact or enter manually')}
                </span>
                <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${showContactDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showContactDropdown && (
                <>
                  <div className="fixed inset-0 z-[90]" onClick={() => { setShowContactDropdown(false); setContactSearch(''); }} />
                  <div className="absolute z-[95] w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg overflow-hidden">
                    {/* Search Input */}
                    <div className="p-2 border-b border-[var(--v2-border)]">
                      <div className="relative">
                        <Search className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
                        <input
                          type="text"
                          value={contactSearch}
                          onChange={(e) => setContactSearch(e.target.value)}
                          placeholder={t('invoice.search_contacts') || 'Search contacts...'}
                          className={`w-full px-3 py-2 text-sm border border-[var(--v2-border)] bg-[var(--v2-bg)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)] ${isRTL ? 'pr-10' : 'pl-10'}`}
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Contact List */}
                    <div className="max-h-48 overflow-y-auto">
                      {loadingContacts ? (
                        <div className="px-4 py-3 flex items-center justify-center">
                          <Loader2 className="w-4 h-4 animate-spin text-[var(--v2-primary)]" />
                        </div>
                      ) : (() => {
                        const filteredContacts = contacts.filter(contact => {
                          if (!contactSearch) return true;
                          const searchLower = contactSearch.toLowerCase();
                          return contact.full_name.toLowerCase().includes(searchLower) ||
                                 (contact.email?.toLowerCase().includes(searchLower));
                        });

                        if (filteredContacts.length === 0) {
                          return (
                            <div className="px-4 py-3 text-sm text-[var(--v2-text-muted)]">
                              {contactSearch ? (t('invoice.no_matching_contacts') || 'No matching contacts') : (t('invoice.no_contacts') || 'No contacts found')}
                            </div>
                          );
                        }

                        return filteredContacts.map((contact) => (
                          <button
                            key={contact.id}
                            type="button"
                            onClick={() => selectContact(contact)}
                            className={`w-full px-4 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${
                              formData.contact_id === contact.id ? 'bg-[var(--v2-bg)]' : ''
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center">
                                <span className="text-xs font-medium text-[var(--v2-primary)]">
                                  {contact.full_name.charAt(0).toUpperCase()}
                                </span>
                              </div>
                              <div className="text-start">
                                <p className="font-medium text-[var(--v2-text-primary)]">{contact.full_name}</p>
                                {contact.email && (
                                  <p className="text-xs text-[var(--v2-text-muted)]">{contact.email}</p>
                                )}
                              </div>
                            </div>
                            {formData.contact_id === contact.id && (
                              <Check className="w-4 h-4 text-[var(--v2-primary)]" />
                            )}
                          </button>
                        ));
                      })()}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Manual Client Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1">
                  {t('invoice.client_name') || 'Client Name'} *
                </label>
                <Input
                  value={formData.client_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, client_name: e.target.value }))}
                  placeholder={t('invoice.client_name_placeholder') || 'Enter client name'}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1">
                  {t('invoice.client_email') || 'Client Email'} *
                </label>
                <div className="relative">
                  <Mail className={`w-4 h-4 absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)]`} />
                  <Input
                    type="email"
                    value={formData.client_email}
                    onChange={(e) => setFormData(prev => ({ ...prev, client_email: e.target.value }))}
                    placeholder={t('invoice.client_email_placeholder') || 'client@example.com'}
                    className={isRTL ? 'pr-10' : 'pl-10'}
                    required
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-3">
            {/* The currency label that used to sit here is now the picker in
                the header, beside the number it applies to. */}
            <h3 className="text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('invoice.line_items') || 'Line Items'}
            </h3>

            {/* Header */}
            <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-[var(--v2-text-secondary)] px-1">
              <div className="col-span-5">{t('invoice.description') || 'Description'}</div>
              <div className="col-span-2 text-center">{t('invoice.qty') || 'Qty'}</div>
              <div className="col-span-2 text-center">{t('invoice.price') || 'Price'}</div>
              <div className="col-span-2 text-center">{t('invoice.total') || 'Total'}</div>
              <div className="col-span-1"></div>
            </div>

            {/* Items */}
            <div className="space-y-2">
              {lineItems.map((item, index) => (
                <div key={index} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-12 sm:col-span-5 relative">
                    <div className="relative">
                      <Input
                        placeholder={t('invoice.item_description') || 'Item description'}
                        value={item.description}
                        onChange={(e) => {
                          updateLineItem(index, 'description', e.target.value);
                          setServiceSearch(e.target.value);
                          if (e.target.value && services.length > 0) {
                            setActiveServiceDropdown(index);
                          } else {
                            setActiveServiceDropdown(null);
                          }
                        }}
                        onFocus={() => {
                          if (services.length > 0) {
                            setActiveServiceDropdown(index);
                            setServiceSearch(item.description);
                          }
                        }}
                        required
                      />
                      {services.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setActiveServiceDropdown(activeServiceDropdown === index ? null : index)}
                          className="absolute end-2 top-1/2 -translate-y-1/2 p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                        >
                          <ChevronDown className={`w-4 h-4 transition-transform ${activeServiceDropdown === index ? 'rotate-180' : ''}`} />
                        </button>
                      )}
                    </div>

                    {/* Service Dropdown */}
                    {activeServiceDropdown === index && services.length > 0 && (
                      <>
                        <div className="fixed inset-0 z-[90]" onClick={() => { setActiveServiceDropdown(null); setServiceSearch(''); }} />
                        <div className="absolute z-[95] w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg max-h-48 overflow-y-auto">
                          {(() => {
                            const filteredServices = services.filter(service => {
                              if (!serviceSearch) return true;
                              return service.service_name.toLowerCase().includes(serviceSearch.toLowerCase());
                            });

                            if (filteredServices.length === 0) {
                              return (
                                <div className="px-4 py-2 text-sm text-[var(--v2-text-muted)]">
                                  {t('invoice.no_matching_services') || 'No matching services. Type to add custom item.'}
                                </div>
                              );
                            }

                            return filteredServices.map((service) => (
                              <button
                                key={service.id}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectService(index, service);
                                }}
                                className="w-full px-4 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] text-start"
                              >
                                <span className="font-medium text-[var(--v2-text-primary)]">{service.service_name}</span>
                                <span className="text-[var(--v2-text-muted)]">{formatCurrency(service.price)}</span>
                              </button>
                            ));
                          })()}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <Input
                      type="number"
                      placeholder={t('invoice.qty') || 'Qty'}
                      value={item.quantity}
                      onChange={(e) => updateLineItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      min="0"
                      step="1"
                      required
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <Input
                      type="number"
                      placeholder={t('invoice.price') || 'Price'}
                      value={item.unit_price}
                      onChange={(e) => updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      min="0"
                      step="0.01"
                      required
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <Input
                      type="text"
                      value={formatCurrency(item.total)}
                      disabled
                      className="bg-[var(--v2-bg)] text-center"
                    />
                  </div>
                  <div className="col-span-1 flex items-center justify-center">
                    {lineItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLineItem(index)}
                        className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={addLineItem}
              className="w-full sm:w-auto"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t('invoice.add_item') || 'Add Line Item'}
            </Button>
          </div>

          {/* Due Date with Presets */}
          <div className="space-y-3">
            <h3 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-[var(--v2-text-muted)]">
              <Calendar className="w-3.5 h-3.5" />
              {t('invoice.payment_details') || 'Payment Details'}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Due Date Preset */}
              <div className="relative">
                <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1">
                  {t('invoice.payment_terms') || 'Payment Terms'}
                </label>
                <button
                  type="button"
                  onClick={() => setShowDueDateDropdown(!showDueDateDropdown)}
                  className="w-full px-3 py-2.5 text-sm border border-[var(--v2-border)] bg-[var(--v2-bg)] rounded-lg flex items-center justify-between hover:border-[var(--v2-primary)] transition-colors"
                >
                  <span className="text-[var(--v2-text-primary)]">
                    {dueDatePresets.find(p => p.value === dueDatePreset)?.label || t('invoice.payment_terms_values.net_30') || 'Net 30'}
                  </span>
                  <ChevronDown className={`w-4 h-4 text-[var(--v2-text-muted)] transition-transform ${showDueDateDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showDueDateDropdown && (
                  <>
                    <div className="fixed inset-0 z-[90]" onClick={() => setShowDueDateDropdown(false)} />
                    <div className="absolute z-[95] w-full mt-1 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg shadow-lg">
                      {dueDatePresets.map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectDueDatePreset(preset);
                          }}
                          className={`w-full px-4 py-2.5 text-sm flex items-center justify-between hover:bg-[var(--v2-bg)] ${
                            dueDatePreset === preset.value ? 'bg-[var(--v2-bg)]' : ''
                          }`}
                        >
                          <span>{preset.label}</span>
                          {dueDatePreset === preset.value && (
                            <Check className="w-4 h-4 text-[var(--v2-primary)]" />
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Custom Due Date */}
              <div>
                <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1">
                  {t('invoice.due_date') || 'Due Date'}
                </label>
                <Input
                  type="date"
                  value={formData.due_date}
                  onChange={(e) => {
                    setFormData(prev => ({ ...prev, due_date: e.target.value }));
                    setDueDatePreset('custom');
                  }}
                />
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-[var(--v2-text-secondary)] mb-1">
              {t('invoice.notes') || 'Notes (optional)'}
            </label>
            <textarea
              className="w-full px-3 py-2.5 text-sm border border-[var(--v2-border)] bg-[var(--v2-bg)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)] text-[var(--v2-text-primary)]"
              rows={3}
              value={formData.notes}
              onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder={t('invoice.notes_placeholder') || 'Additional notes for the client...'}
            />
          </div>

            {/* ── Delivery ────────────────────────────────────────────────
                The same switch the refund and stop-plan dialogs use for "and
                also do this", rather than a checkbox that looks like a
                different kind of control for the same kind of decision.

                This one decides whether the invoice is SENT. It used to be
                collected and thrown away — the row was written as a draft
                whichever way it was set — so the tick has to mean something
                now that it does. */}
            {/* WHETHER to send is decided in the footer, deliberately, because
                a switch left on from the last invoice is exactly how something
                reaches a client before it was ready. This is only HOW it goes
                out once that button is pressed. */}
            {hasStripeConnect === true && (
              <div
                className="border border-[var(--v2-border)] overflow-hidden"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <SwitchRow
                  checked={formData.send_via_stripe}
                  onChange={next => setFormData(prev => ({ ...prev, send_via_stripe: next }))}
                  label={t('invoice.send_via_stripe') || 'Send via Stripe'}
                  description={
                    t('invoice.stripe_description') ||
                    'Client will receive a professional Stripe invoice with online payment options'
                  }
                  icon={<CreditCard className="h-4 w-4 flex-shrink-0 text-purple-500" />}
                  isRTL={isRTL}
                />
              </div>
            )}

            {/* Not a dead end: without Stripe the invoice still goes out as a
                branded email with its PDF attached. What is missing is the
                online payment button, not the send. */}
            {hasStripeConnect === null && (
              <div
                className="flex items-center gap-2.5 border border-[var(--v2-border)] px-3 py-2.5 text-[12.5px] text-[var(--v2-text-muted)]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
                <span>{t('invoice.checking_payment_connection')}</span>
              </div>
            )}

            {/* Only once we actually know. `!hasStripeConnect` was true while
                the answer was still null, which is what put the warning on
                screen before anything had been asked. */}
            {hasStripeConnect === false && (
              <div
                className="flex items-start gap-3 border border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                <div className="min-w-0">
                  <p className="text-[12.5px] font-medium text-[var(--v2-text-primary)]">
                    {t('invoice.no_stripe_title') || 'Stripe not connected'}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-[var(--v2-text-muted)]">
                    {t('invoice.no_stripe_description') || 'Connect Stripe to send invoices with online payment. Without Stripe, you can still create invoices and download PDFs.'}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* ── Footer ──────────────────────────────────────────────────────
              Two actions, not one action and a switch.

              Sending an invoice is irreversible in the way that matters: the
              client has it. A toggle in the body decides that at the top of the
              form and is still set when the button is pressed a minute later,
              which is exactly how something goes out before it was ready. Two
              buttons make it the last thing chosen rather than an earlier one
              being remembered.

              Both submit, so the browser still validates the required fields —
              `submitter` is what separates them. Enter submits with no
              submitter, and that saves a draft. */}
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-[var(--v2-border)] px-5 py-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              {t('invoice.cancel') || 'Cancel'}
            </Button>

            <Button
              type="submit"
              name="intent"
              value="create"
              variant="outline"
              // An invoice for nothing is not a document worth writing.
              disabled={loading || formData.amount <= 0}
            >
              {loading && pendingIntent === 'create' ? (
                <Loader2 className="me-2 h-4 w-4 animate-spin" />
              ) : (
                <FileText className="me-2 h-4 w-4" />
              )}
              {t('invoice.create_only') || 'Create without sending'}
            </Button>

            <Button
              type="submit"
              name="intent"
              value="send"
              disabled={loading || formData.amount <= 0}
              // The platform's action treatment — tinted, outlined, in the
              // reports green. It is the same button that opened this dialog.
              variant="outline"
              className="border-[#22C58B] bg-[#22C58B]/10 text-[#22C58B] hover:bg-[#22C58B]/20 hover:text-[#22C58B] disabled:opacity-50"
            >
              {loading && pendingIntent === 'send' ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {t('common.sending') || 'Sending...'}
                </>
              ) : (
                <>
                  <Send className="me-2 h-4 w-4" />
                  {t('invoice.create_and_send') || 'Create & send'}
                  {formData.amount > 0 && (
                    <>
                      <span className="mx-1.5 opacity-50">·</span>
                      <bdi className="tabular-nums">{formatCurrency(formData.amount)}</bdi>
                    </>
                  )}
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

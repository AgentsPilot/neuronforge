'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import {
  X,
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
  const { currencyCode, t, isRTL } = useLanguage();

  // Get translated due date presets - memoized to update when language changes
  const dueDatePresets = useMemo(() => {
    return DUE_DATE_PRESETS_BASE.map(preset => ({
      value: preset.value,
      label: t(`invoice.payment_terms_values.${preset.key}`) || preset.key,
      days: preset.days,
    }));
  }, [t]);

  const [loading, setLoading] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [hasStripeConnect, setHasStripeConnect] = useState(false);
  const [showContactDropdown, setShowContactDropdown] = useState(false);
  const [contactSearch, setContactSearch] = useState('');
  const [dueDatePreset, setDueDatePreset] = useState('net30');
  const [showDueDateDropdown, setShowDueDateDropdown] = useState(false);
  const [activeServiceDropdown, setActiveServiceDropdown] = useState<number | null>(null);
  const [serviceSearch, setServiceSearch] = useState('');

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
    send_via_stripe: true, // Default to Stripe if available
  });

  // Track when modal was last opened to prevent resetting during user interaction
  const wasOpenRef = React.useRef(false);

  // Load contacts, services, and check Stripe Connect status
  useEffect(() => {
    loadContacts();
    loadServices();
    checkStripeConnect();
  }, []);

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

  const checkStripeConnect = async () => {
    try {
      // Check if user has a Stripe Connect account configured
      // For dev/test environments using same Stripe account, we check if stripe_account_id exists
      const response = await fetch('/api/payments/stripe-connect');
      const data = await response.json();

      if (response.ok && data.success && data.data) {
        // If stripe_account_id exists, consider Stripe as connected
        // In production, this would also check charges_enabled from Stripe API
        const hasStripeAccount = !!data.data.stripe_account_id;
        setHasStripeConnect(hasStripeAccount);
      }
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currencyCode,
    }).format(amount);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

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
          currency: currencyCode,
          status: 'draft',
          use_stripe: formData.send_via_stripe && hasStripeConnect,
        }),
      });

      const result = await response.json();

      if (result.success) {
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
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] p-0 sm:p-4"
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      <div className="bg-[var(--v2-surface)] sm:rounded-lg shadow-xl w-full sm:max-w-3xl h-[100vh] sm:h-auto sm:max-h-[90vh] flex flex-col overflow-hidden">
        {/* Fixed Header */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-4 sm:px-6 py-4 sm:py-6 bg-[var(--v2-surface)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg" style={{ backgroundColor: `${REPORTS_COLOR}15` }}>
                <FileText className="w-5 h-5" style={{ color: REPORTS_COLOR }} />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                  {t('invoice.create_title') || 'Create Invoice'}
                </h2>
                <p className="text-sm text-[var(--v2-text-secondary)]">
                  {t('invoice.create_subtitle') || 'Send a professional invoice to your client'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-6">
          {/* Client Selection */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-[var(--v2-text-primary)] flex items-center gap-2">
              <User className="w-4 h-4" />
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
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[var(--v2-text-primary)]">
                {t('invoice.line_items') || 'Line Items'}
              </h3>
              <div className="text-xs text-[var(--v2-text-muted)]">
                {t('invoice.currency') || 'Currency'}: {currencyCode}
              </div>
            </div>

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

          {/* Total */}
          <div className="flex items-center justify-between border-t border-[var(--v2-border)] pt-4">
            <span className="text-lg font-semibold text-[var(--v2-text-primary)]">
              {t('invoice.total') || 'Total'}
            </span>
            <span className="text-2xl font-bold text-[var(--v2-primary)]">
              {formatCurrency(formData.amount)}
            </span>
          </div>

          {/* Due Date with Presets */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-[var(--v2-text-primary)] flex items-center gap-2">
              <Calendar className="w-4 h-4" />
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

            {/* Stripe Option */}
            {hasStripeConnect && (
              <div className="p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/20 rounded-lg">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.send_via_stripe}
                    onChange={(e) => setFormData(prev => ({ ...prev, send_via_stripe: e.target.checked }))}
                    className="mt-0.5 w-4 h-4 rounded border-[var(--v2-border)] text-[var(--v2-primary)] focus:ring-[var(--v2-primary)]"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-purple-500" />
                      <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                        {t('invoice.send_via_stripe') || 'Send via Stripe'}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--v2-text-secondary)] mt-1">
                      {t('invoice.stripe_description') || 'Client will receive a professional Stripe invoice with online payment options'}
                    </p>
                  </div>
                </label>
              </div>
            )}

            {!hasStripeConnect && (
              <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200">
                      {t('invoice.no_stripe_title') || 'Stripe not connected'}
                    </p>
                    <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
                      {t('invoice.no_stripe_description') || 'Connect Stripe to send invoices with online payment. Without Stripe, you can still create invoices and download PDFs.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Fixed Footer */}
          <div className="flex-shrink-0 flex items-center justify-end gap-3 px-4 sm:px-6 py-4 sm:py-6 border-t border-[var(--v2-border)] bg-[var(--v2-surface)]">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('invoice.cancel') || 'Cancel'}
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {t('common.creating') || 'Creating...'}
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4 mr-2" />
                  {t('invoice.create') || 'Create Invoice'}
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

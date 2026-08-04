'use client';

import { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, Settings, ChevronDown, ChevronRight, Check, Tag, Trash2, Loader2, AlertCircle, CreditCard } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { SchedulingService, ServiceCurrency, PaymentType, InstallmentFrequency, FirstPaymentDue } from '@/lib/repositories/SchedulingRepository';

interface SchedulingServiceModalProps {
  service?: SchedulingService;
  isOpen: boolean;
  onClose: () => void;
  onServiceUpdated: () => void;
  prefill?: Record<string, any>; // Pre-fill values for new service (from chat)
  onServiceCreated?: (service: { name: string; duration: number; price: number; currency: string }) => void; // Callback when new service created (for chat publish flow)
}

// Scheduling theme color: Teal
const SCHEDULING_COLOR = '#14B8A6';

export function SchedulingServiceModal({ service, isOpen, onClose, onServiceUpdated, prefill, onServiceCreated }: SchedulingServiceModalProps) {
  const { t, currencyCode } = useLanguage();
  const [formData, setFormData] = useState({
    service_name: '',
    description: '',
    duration_minutes: 60,
    price: 0,
    currency: currencyCode as ServiceCurrency,
    buffer_minutes: 15,
    max_bookings_per_day: null as number | null,
    advance_booking_days: 30,
    min_notice_hours: 24,
    is_active: true,
    // Payment options
    payment_type: 'full' as PaymentType,
    installment_count: 1,
    installment_frequency: 'monthly' as InstallmentFrequency,
    first_payment_due: 'on_booking' as FirstPaymentDue,
    first_payment_days: 0
  });

  const currencyOptions: { code: ServiceCurrency; label: string; symbol: string }[] = [
    { code: 'USD', label: '$ USD', symbol: '$' },
    { code: 'EUR', label: '€ EUR', symbol: '€' },
    { code: 'ILS', label: '₪ ILS', symbol: '₪' },
    { code: 'GBP', label: '£ GBP', symbol: '£' }
  ];

  const getCurrencySymbol = (code: ServiceCurrency) => {
    return currencyOptions.find(c => c.code === code)?.symbol || '₪';
  };
  const [loading, setLoading] = useState(false);
  const [currencyDropdownOpen, setCurrencyDropdownOpen] = useState(false);
  const currencyDropdownRef = useRef<HTMLDivElement>(null);

  // Delete state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ message: string; bookingCount?: number } | null>(null);

  // Advanced options toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Close currency dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (currencyDropdownRef.current && !currencyDropdownRef.current.contains(event.target as Node)) {
        setCurrencyDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (service) {
      // Load existing service data, then apply any prefill updates (from chat commands like "change price to $200")
      // IMPORTANT: Use the service's stored currency, NOT the user's locale currency
      // Only fall back to 'USD' if no currency is stored (for legacy services created before currency was added)
      const baseData = {
        service_name: service.service_name,
        description: service.description || '',
        duration_minutes: service.duration_minutes,
        price: service.price || 0,
        currency: (service.currency || 'USD') as ServiceCurrency,
        buffer_minutes: service.buffer_minutes,
        max_bookings_per_day: service.max_bookings_per_day,
        advance_booking_days: service.advance_booking_days,
        min_notice_hours: service.min_notice_hours,
        is_active: service.is_active,
        payment_type: service.payment_type || 'full',
        installment_count: service.installment_count || 1,
        installment_frequency: service.installment_frequency || 'monthly',
        first_payment_due: service.first_payment_due || 'on_booking',
        first_payment_days: service.first_payment_days || 0
      };

      // Apply prefill updates on top of existing service data
      if (prefill) {
        setFormData({
          ...baseData,
          ...(prefill.service_name !== undefined && { service_name: prefill.service_name }),
          ...(prefill.description !== undefined && { description: prefill.description }),
          ...(prefill.duration_minutes !== undefined && { duration_minutes: prefill.duration_minutes }),
          ...(prefill.price !== undefined && { price: prefill.price }),
          ...(prefill.currency !== undefined && { currency: prefill.currency as ServiceCurrency }),
          ...(prefill.buffer_minutes !== undefined && { buffer_minutes: prefill.buffer_minutes }),
        });
      } else {
        setFormData(baseData);
      }
    } else {
      // New service: use user's preferred currency as default
      const defaults = {
        service_name: '',
        description: '',
        duration_minutes: 60,
        price: 0,
        currency: currencyCode as ServiceCurrency,
        buffer_minutes: 15,
        max_bookings_per_day: null as number | null,
        advance_booking_days: 30,
        min_notice_hours: 24,
        is_active: true,
        payment_type: 'full' as PaymentType,
        installment_count: 1,
        installment_frequency: 'monthly' as InstallmentFrequency,
        first_payment_due: 'on_booking' as FirstPaymentDue,
        first_payment_days: 0
      };

      if (prefill) {
        setFormData({
          ...defaults,
          service_name: prefill.service_name || defaults.service_name,
          description: prefill.description || defaults.description,
          duration_minutes: prefill.duration_minutes || defaults.duration_minutes,
          price: prefill.price ?? defaults.price,
          currency: (prefill.currency as ServiceCurrency) || defaults.currency,
          buffer_minutes: prefill.buffer_minutes ?? defaults.buffer_minutes,
        });
      } else {
        setFormData(defaults);
      }
    }
    // Note: currencyCode is only used for NEW services (when service is null)
    // For existing services, we use the stored service.currency
  }, [service, currencyCode, prefill]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const url = service ? `/api/scheduling/services/${service.id}` : '/api/scheduling/services';
      const method = service ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        // For new services, call onServiceCreated callback (for chat publish flow)
        if (!service && onServiceCreated) {
          onServiceCreated({
            name: formData.service_name,
            duration: formData.duration_minutes,
            price: formData.price,
            currency: formData.currency,
          });
        }
        onServiceUpdated();
      }
    } catch (error) {
      console.error('Failed to save service:', error);
    } finally {
      setLoading(false);
    }
  };

  const getServiceInitials = (name: string) => {
    if (!name) return 'NS';
    const words = name.split(' ');
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const handleDeleteClick = async () => {
    if (!service) return;

    setDeleteError(null);
    setDeleting(true);

    // Pre-check if service has bookings
    try {
      const response = await fetch(`/api/scheduling/services/${service.id}/bookings/count`);
      const data = await response.json();

      if (response.ok && data.count > 0) {
        // Service has bookings - show error
        setDeleteError({
          message: t('scheduling.service.delete_has_bookings'),
          bookingCount: data.count
        });
      }
      setShowDeleteConfirm(true);
    } catch {
      // If pre-check fails, just show confirmation
      setShowDeleteConfirm(true);
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!service || deleting) return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/scheduling/services/${service.id}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (response.ok) {
        setShowDeleteConfirm(false);
        onServiceUpdated();
      } else if (response.status === 409) {
        setDeleteError({
          message: t('scheduling.service.delete_has_bookings'),
          bookingCount: data.bookingCount
        });
      } else {
        setDeleteError({ message: data.error || t('scheduling.service.delete_error') });
      }
    } catch {
      setDeleteError({ message: t('scheduling.service.delete_error') });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
    setDeleteError(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full sm:max-w-2xl h-[100vh] sm:h-auto sm:max-h-[90vh] flex flex-col bg-[var(--v2-surface)] border-[var(--v2-border)] p-0 overflow-hidden">
        {/* Sticky Header - pe-14 for close button space */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-4 sm:px-6 py-4 sm:py-6 pe-12 sm:pe-14 bg-[var(--v2-surface)]">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg sm:rounded-xl flex items-center justify-center text-base sm:text-lg font-semibold text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 flex-shrink-0">
              {getServiceInitials(formData.service_name)}
            </div>
            <div className="flex-1 min-w-0">
              <DialogHeader>
                <DialogTitle className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)] rtl:text-right truncate">
                  {service ? t('scheduling.modal.edit_service') : t('scheduling.modal.new_service')}
                </DialogTitle>
              </DialogHeader>
              <p className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mt-1 hidden sm:block">
                {t('scheduling.modal.service_subtitle')}
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
          {/* Basic Info Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide">
              {t('scheduling.modal.basic_info')}
            </h3>

            {/* Service Name */}
            <div>
              <label htmlFor="service_name" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                {t('scheduling.modal.service_name')} <span className="text-red-500">*</span>
              </label>
              <input
                id="service_name"
                value={formData.service_name}
                onChange={(e) => setFormData(prev => ({ ...prev, service_name: e.target.value }))}
                placeholder={t('scheduling.modal.service_name_placeholder')}
                required
                className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                {t('scheduling.modal.description')}
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t('scheduling.modal.description_placeholder')}
                rows={3}
                className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all resize-none"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
            </div>
          </div>

          {/* Time & Pricing Section */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
              <Tag className="h-4 w-4" />
              {t('scheduling.modal.time_pricing')}
            </h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="duration_minutes" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                  {t('scheduling.modal.duration')} <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <input
                    id="duration_minutes"
                    type="number"
                    min="5"
                    max="480"
                    value={formData.duration_minutes}
                    onChange={(e) => setFormData(prev => ({ ...prev, duration_minutes: parseInt(e.target.value) }))}
                    required
                    className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  />
                  <span className="absolute end-4 top-1/2 -translate-y-1/2 text-[var(--v2-text-muted)] text-sm">
                    {t('scheduling.service.minutes')}
                  </span>
                </div>
              </div>
              <div>
                <label htmlFor="price" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                  {t('scheduling.modal.price')}
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      id="price"
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.price}
                      onChange={(e) => setFormData(prev => ({ ...prev, price: parseFloat(e.target.value) || 0 }))}
                      className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                  </div>
                  <div className="relative" ref={currencyDropdownRef}>
                    <button
                      type="button"
                      onClick={() => setCurrencyDropdownOpen(!currencyDropdownOpen)}
                      className="flex items-center justify-between gap-2 w-24 px-3 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm hover:bg-[var(--v2-surface-hover)] transition-all cursor-pointer"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <span className="font-medium">{getCurrencySymbol(formData.currency)} {formData.currency}</span>
                      <ChevronDown className={`h-4 w-4 text-[var(--v2-text-muted)] transition-transform ${currencyDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {currencyDropdownOpen && (
                      <div
                        className="absolute top-full mt-1 w-32 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-50 overflow-hidden"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        {currencyOptions.map(opt => (
                          <button
                            key={opt.code}
                            type="button"
                            onClick={() => {
                              setFormData(prev => ({ ...prev, currency: opt.code }));
                              setCurrencyDropdownOpen(false);
                            }}
                            className={`w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-[var(--v2-surface-hover)] transition-colors ${
                              formData.currency === opt.code ? 'bg-[#14B8A6]/10 text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'
                            }`}
                          >
                            <span className="font-medium">{opt.symbol} {opt.code}</span>
                            {formData.currency === opt.code && <Check className="h-4 w-4" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Advanced Options Toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between p-4 bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <div className="flex items-center gap-3">
              <Settings className="h-5 w-5 text-[var(--v2-text-muted)]" />
              <div className="text-start">
                <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('scheduling.modal.advanced_options')}
                </span>
                <p className="text-xs text-[var(--v2-text-muted)] mt-0.5">
                  {t('scheduling.modal.advanced_options_desc')}
                </p>
              </div>
            </div>
            {showAdvanced ? (
              <ChevronDown className="h-5 w-5 text-[var(--v2-text-muted)]" />
            ) : (
              <ChevronRight className="h-5 w-5 text-[var(--v2-text-muted)]" />
            )}
          </button>

          {/* Collapsible Advanced Options */}
          {showAdvanced && (
            <div className="space-y-6 pt-2">
              {/* Payment Options Section - only show if service has a price */}
              {formData.price > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
                  <CreditCard className="h-4 w-4" />
                  {t('scheduling.modal.payment_options')}
                </h3>

                {/* Payment Type Toggle */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, payment_type: 'full', installment_count: 1 }))}
                    className={`p-4 text-start border transition-all ${
                      formData.payment_type === 'full'
                        ? 'border-[#14B8A6] bg-[#14B8A6]/10'
                        : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        formData.payment_type === 'full' ? 'border-[#14B8A6]' : 'border-[var(--v2-text-muted)]'
                      }`}>
                        {formData.payment_type === 'full' && <div className="w-2 h-2 rounded-full bg-[#14B8A6]" />}
                      </div>
                      <span className={`text-sm font-medium ${formData.payment_type === 'full' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'}`}>
                        {t('scheduling.modal.payment_full')}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
                      {t('scheduling.modal.payment_full_desc')}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, payment_type: 'installments', installment_count: prev.installment_count > 1 ? prev.installment_count : 2 }))}
                    className={`p-4 text-start border transition-all ${
                      formData.payment_type === 'installments'
                        ? 'border-[#14B8A6] bg-[#14B8A6]/10'
                        : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        formData.payment_type === 'installments' ? 'border-[#14B8A6]' : 'border-[var(--v2-text-muted)]'
                      }`}>
                        {formData.payment_type === 'installments' && <div className="w-2 h-2 rounded-full bg-[#14B8A6]" />}
                      </div>
                      <span className={`text-sm font-medium ${formData.payment_type === 'installments' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'}`}>
                        {t('scheduling.modal.payment_installments')}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
                      {t('scheduling.modal.payment_installments_desc')}
                    </p>
                  </button>
                </div>

                {/* Installment Details - only show when installments selected */}
                {formData.payment_type === 'installments' && (
                  <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    <div>
                      <label htmlFor="installment_count" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                        {t('scheduling.modal.installment_count')}
                      </label>
                      <input
                        id="installment_count"
                        type="number"
                        min="2"
                        max="24"
                        value={formData.installment_count}
                        onChange={(e) => setFormData(prev => ({ ...prev, installment_count: Math.max(2, Math.min(24, parseInt(e.target.value) || 2)) }))}
                        className="w-full px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                      <p className="text-xs text-[var(--v2-text-muted)] mt-1.5">
                        {formData.price > 0 && formData.installment_count >= 2
                          ? `${getCurrencySymbol(formData.currency)}${(formData.price / formData.installment_count).toFixed(2)} ${t('scheduling.modal.per_installment')}`
                          : ''
                        }
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                        {t('scheduling.modal.installment_frequency')}
                      </label>
                      <Select
                        value={formData.installment_frequency}
                        onValueChange={(value) => setFormData(prev => ({ ...prev, installment_frequency: value as InstallmentFrequency }))}
                      >
                        <SelectTrigger
                          className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:border-[#14B8A6] focus:ring-[#14B8A6]/20"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)]">
                          <SelectItem value="weekly" className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488]">
                            {t('scheduling.modal.frequency_weekly')}
                          </SelectItem>
                          <SelectItem value="biweekly" className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488]">
                            {t('scheduling.modal.frequency_biweekly')}
                          </SelectItem>
                          <SelectItem value="monthly" className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488]">
                            {t('scheduling.modal.frequency_monthly')}
                          </SelectItem>
                          <SelectItem value="quarterly" className="text-[var(--v2-text-primary)] focus:bg-[#14B8A6]/10 focus:text-[#0D9488]">
                            {t('scheduling.modal.frequency_quarterly')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* First Payment Due (Optional) */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-[var(--v2-text-primary)]">
                    {t('scheduling.modal.first_payment_due')}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, first_payment_due: 'on_booking', first_payment_days: 0 }))}
                      className={`p-3 text-start border transition-all ${
                        formData.first_payment_due === 'on_booking'
                          ? 'border-[#14B8A6] bg-[#14B8A6]/10'
                          : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <span className={`text-sm font-medium ${formData.first_payment_due === 'on_booking' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'}`}>
                        {t('scheduling.modal.payment_on_booking')}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, first_payment_due: 'days_after', first_payment_days: prev.first_payment_days || 7 }))}
                      className={`p-3 text-start border transition-all ${
                        formData.first_payment_due === 'days_after'
                          ? 'border-[#14B8A6] bg-[#14B8A6]/10'
                          : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <span className={`text-sm font-medium ${formData.first_payment_due === 'days_after' ? 'text-[#14B8A6]' : 'text-[var(--v2-text-primary)]'}`}>
                        {t('scheduling.modal.payment_days_after')}
                      </span>
                    </button>
                  </div>

                  {formData.first_payment_due === 'days_after' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={formData.first_payment_days}
                        onChange={(e) => setFormData(prev => ({ ...prev, first_payment_days: Math.max(1, Math.min(365, parseInt(e.target.value) || 1)) }))}
                        className="w-20 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                      <span className="text-sm text-[var(--v2-text-secondary)]">
                        {t('scheduling.modal.days_after_booking')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              )}

              {/* Booking Settings Section */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-[var(--v2-text-muted)] uppercase tracking-wide flex items-center gap-2">
                  <Clock className="h-4 w-4" />
                  {t('scheduling.modal.booking_settings')}
                </h3>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="buffer_minutes" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                      {t('scheduling.modal.buffer_time')}
                    </label>
                    <input
                      id="buffer_minutes"
                      type="number"
                      min="0"
                      max="120"
                      value={formData.buffer_minutes}
                      onChange={(e) => setFormData(prev => ({ ...prev, buffer_minutes: parseInt(e.target.value) }))}
                      className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1.5">{t('scheduling.modal.buffer_hint')}</p>
                  </div>
                  <div>
                    <label htmlFor="max_bookings_per_day" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                      {t('scheduling.modal.max_bookings')}
                    </label>
                    <input
                      id="max_bookings_per_day"
                      type="number"
                      min="1"
                      value={formData.max_bookings_per_day || ''}
                      onChange={(e) => setFormData(prev => ({
                        ...prev,
                        max_bookings_per_day: e.target.value ? parseInt(e.target.value) : null
                      }))}
                      placeholder={t('scheduling.modal.no_limit')}
                      className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="min_notice_hours" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                      {t('scheduling.modal.min_notice')}
                    </label>
                    <input
                      id="min_notice_hours"
                      type="number"
                      min="0"
                      value={formData.min_notice_hours}
                      onChange={(e) => setFormData(prev => ({ ...prev, min_notice_hours: parseInt(e.target.value) }))}
                      className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1.5">{t('scheduling.modal.notice_hint')}</p>
                  </div>
                  <div>
                    <label htmlFor="advance_booking_days" className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                      {t('scheduling.modal.book_ahead')}
                    </label>
                    <input
                      id="advance_booking_days"
                      type="number"
                      min="0"
                      value={formData.advance_booking_days}
                      onChange={(e) => setFormData(prev => ({ ...prev, advance_booking_days: parseInt(e.target.value) }))}
                      className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#14B8A6] focus:ring-2 focus:ring-[#14B8A6]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1.5">{t('scheduling.modal.book_ahead_hint')}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Active Toggle - Always visible */}
          <div
            className="flex items-center justify-between p-4 bg-[var(--v2-bg)] border border-[var(--v2-border)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <div className="flex-1">
              <label htmlFor="is_active" className="text-sm font-medium text-[var(--v2-text-primary)]">
                {t('scheduling.modal.active_service')}
              </label>
              <p className="text-xs text-[var(--v2-text-muted)] mt-0.5">{t('scheduling.modal.active_hint')}</p>
            </div>
            <button
              type="button"
              role="switch"
              dir="ltr"
              aria-checked={formData.is_active}
              onClick={() => setFormData(prev => ({ ...prev, is_active: !prev.is_active }))}
              className={`
                relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent
                transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#14B8A6] focus:ring-offset-2
                ${formData.is_active ? 'bg-[#14B8A6]' : 'bg-[var(--v2-border)]'}
              `}
            >
              <span
                className={`
                  pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--v2-surface)] shadow ring-0
                  transition duration-200 ease-in-out
                  ${formData.is_active ? 'translate-x-5' : 'translate-x-0'}
                `}
              />
            </button>
          </div>

          </div>

          {/* Sticky Footer */}
          <div className="flex-shrink-0 flex justify-between p-6 border-t border-[var(--v2-border)] bg-[var(--v2-surface)]">
            {/* Delete button - only show when editing */}
            {service ? (
              <button
                type="button"
                onClick={handleDeleteClick}
                disabled={deleting}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-red-500 hover:text-red-600 hover:bg-red-500/10 transition-all disabled:opacity-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                {t('scheduling.service.delete')}
              </button>
            ) : (
              <div />
            )}

            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {t('button.cancel')}
              </button>
              <button
                type="submit"
                disabled={loading || !formData.service_name}
                className="px-5 py-2.5 text-sm font-medium text-[#14B8A6] border border-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {loading ? t('scheduling.modal.saving') : service ? t('scheduling.modal.save_changes') : t('scheduling.modal.create_service')}
              </button>
            </div>
          </div>
        </form>

        {/* Delete Confirmation Dialog */}
        {showDeleteConfirm && service && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 rounded-lg">
            <div
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 max-w-sm w-full mx-4 shadow-xl"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              {deleteError?.bookingCount ? (
                /* Cannot delete - has bookings */
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
                      <AlertCircle className="h-5 w-5 text-amber-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                        {t('scheduling.service.cannot_delete_title')}
                      </h3>
                    </div>
                  </div>

                  <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
                    {t('scheduling.service.cannot_delete_message')
                      .replace('{name}', service.service_name)
                      .replace('{count}', String(deleteError.bookingCount))}
                  </p>

                  <div className="flex">
                    <button
                      onClick={handleDeleteCancel}
                      className="flex-1 px-4 py-2.5 text-sm font-medium text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {t('button.ok')}
                    </button>
                  </div>
                </>
              ) : (
                /* Can delete - confirmation */
                <>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
                      <Trash2 className="h-5 w-5 text-red-500" />
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                        {t('scheduling.service.delete_confirm_title')}
                      </h3>
                    </div>
                  </div>

                  <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
                    {t('scheduling.service.delete_confirm_message').replace('{name}', service.service_name)}
                  </p>

                  {deleteError && !deleteError.bookingCount && (
                    <div className="flex items-start gap-2 p-3 mb-4 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-sm" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                      <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <p>{deleteError.message}</p>
                    </div>
                  )}

                  <div className="flex gap-3">
                    <button
                      onClick={handleDeleteCancel}
                      disabled={deleting}
                      className="flex-1 px-4 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {t('button.cancel')}
                    </button>
                    <button
                      onClick={handleDeleteConfirm}
                      disabled={deleting}
                      className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 transition-all disabled:opacity-50"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {deleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      {t('scheduling.service.delete')}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

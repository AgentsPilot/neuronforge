'use client';

import { useState, useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, Pause, Sparkles, Check, Loader2, Pencil, Trash2, AlertCircle, Tag, CreditCard, FileText, X, Plus, Power } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { SchedulingService, PaymentType, InstallmentFrequency, FirstPaymentDue, ServiceCurrency } from '@/lib/repositories/SchedulingRepository';

// Configuration theme color: Pink (#D14E97)
const CONFIG_COLOR = '#D14E97';

interface SchedulingServicesListProps {
  services: SchedulingService[];
  onServiceClick?: (service: SchedulingService) => void;
  onServicePublished?: () => void;
  onServicePublishedWithId?: (serviceId: string) => void; // Callback when a specific service is published
  onSilentRefresh?: () => void;
  showAddButton?: boolean;
  autoStartNewRow?: boolean; // Auto-start a new row in edit mode (from chat)
  newRowPrefill?: Record<string, any>; // Pre-fill values for the auto-started new row
  onAutoStartConsumed?: () => void; // Callback when auto-start is consumed
  onServiceCreatedFromChat?: (service: { name: string; duration: number; price: number; currency: string }) => void; // Callback when service created from chat prefill
  autoEditServiceId?: string; // Auto-start editing a specific service (from chat)
  onAutoEditConsumed?: () => void; // Callback when auto-edit is consumed
  onServiceEdited?: (serviceId: string) => void; // Callback when a service is edited (saved as draft)
}


export function SchedulingServicesList({ services, onServiceClick, onServicePublished, onServicePublishedWithId, onSilentRefresh, showAddButton = false, autoStartNewRow, newRowPrefill, onAutoStartConsumed, onServiceCreatedFromChat, autoEditServiceId, onAutoEditConsumed, onServiceEdited }: SchedulingServicesListProps) {
  const { t, formatCurrency, currencyCode } = useLanguage();
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [recentlyEditedId, setRecentlyEditedId] = useState<string | null>(null); // Track recently edited service for highlight animation
  // Row editing state - stores all editable values for a row
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [editRowValues, setEditRowValues] = useState<{
    name: string;
    duration: string;
    buffer: string;
    price: string;
    currency: ServiceCurrency;
    payment_type: PaymentType;
    installment_count: number;
    installment_frequency: InstallmentFrequency;
    first_payment_due: FirstPaymentDue;
    first_payment_days: number;
  }>({
    name: '',
    duration: '',
    buffer: '',
    price: '',
    currency: 'ILS',
    payment_type: 'full',
    installment_count: 1,
    installment_frequency: 'monthly',
    first_payment_due: 'on_booking',
    first_payment_days: 0
  });
  const [savingRow, setSavingRow] = useState(false);
  const [editRowPaymentDialogOpen, setEditRowPaymentDialogOpen] = useState(false);
  const editRowPaymentDialogRef = useRef<HTMLDivElement>(null);

  // Valid currencies for services
  const validCurrencies: ServiceCurrency[] = ['USD', 'EUR', 'ILS', 'GBP'];
  const currencySymbolToCode: Record<string, ServiceCurrency> = {
    '$': 'USD',
    '€': 'EUR',
    '₪': 'ILS',
    '£': 'GBP'
  };
  const getValidCurrency = (code: string | undefined | null): ServiceCurrency => {
    if (!code) return 'ILS';
    // If it's already a valid code, return it
    if (validCurrencies.includes(code as ServiceCurrency)) {
      return code as ServiceCurrency;
    }
    // If it's a symbol, convert to code
    if (currencySymbolToCode[code]) {
      return currencySymbolToCode[code];
    }
    return 'ILS';
  };

  // New row state for inline service creation
  const [isAddingNewRow, setIsAddingNewRow] = useState(false);
  const [newRowValues, setNewRowValues] = useState({
    name: '',
    duration: '60',
    buffer: '0',
    price: '0',
    currency: 'ILS' as ServiceCurrency,
    payment_type: 'full' as PaymentType,
    installment_count: 1,
    installment_frequency: 'monthly' as InstallmentFrequency,
    first_payment_due: 'on_booking' as FirstPaymentDue,
    first_payment_days: 0
  });
  const [savingNewRow, setSavingNewRow] = useState(false);
  const [newRowPaymentDialogOpen, setNewRowPaymentDialogOpen] = useState(false);
  const newRowPaymentDialogRef = useRef<HTMLDivElement>(null);
  const [newRowFromChat, setNewRowFromChat] = useState(false); // Track if new row was started from chat
  // Optimistic updates - local overrides for immediate UI feedback
  const [optimisticUpdates, setOptimisticUpdates] = useState<Record<string, Partial<SchedulingService>>>({});
  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ serviceId: string; serviceName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ message: string; bookingCount?: number } | null>(null);
  // Toggle active state
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Description mini-dialog state
  const [descriptionDialogId, setDescriptionDialogId] = useState<string | null>(null);
  const [descriptionValue, setDescriptionValue] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const descriptionDialogRef = useRef<HTMLDivElement>(null);

  // Payment plan popup state
  const [paymentDialogId, setPaymentDialogId] = useState<string | null>(null);
  const [paymentValues, setPaymentValues] = useState<{
    payment_type: PaymentType;
    installment_count: number;
    installment_frequency: InstallmentFrequency;
    first_payment_due: FirstPaymentDue;
    first_payment_days: number;
  }>({
    payment_type: 'full',
    installment_count: 1,
    installment_frequency: 'monthly',
    first_payment_due: 'on_booking',
    first_payment_days: 0
  });
  const [savingPayment, setSavingPayment] = useState(false);
  const paymentDialogRef = useRef<HTMLDivElement>(null);

  // Currency helper
  const getCurrencySymbol = (code?: ServiceCurrency) => {
    const currencyOptions: Record<string, string> = { USD: '$', EUR: '€', ILS: '₪', GBP: '£' };
    return currencyOptions[code || currencyCode] || '₪';
  };

  // Frequency short label helper
  const getFrequencyShortLabel = (frequency?: InstallmentFrequency): string => {
    switch (frequency) {
      case 'weekly': return t('scheduling.frequency_short.weekly') || '/wk';
      case 'biweekly': return t('scheduling.frequency_short.biweekly') || '/2wk';
      case 'monthly': return t('scheduling.frequency_short.monthly') || '/mo';
      case 'quarterly': return t('scheduling.frequency_short.quarterly') || '/qtr';
      default: return '';
    }
  };

  // Close dialogs on outside click (but not when clicking Radix portals like Select)
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;

      // Check if click is inside a Radix portal (Select dropdown, etc.)
      const isInRadixPortal = (target as Element).closest?.('[data-radix-popper-content-wrapper]');
      if (isInRadixPortal) return;

      if (descriptionDialogRef.current && !descriptionDialogRef.current.contains(target)) {
        setDescriptionDialogId(null);
      }
      if (paymentDialogRef.current && !paymentDialogRef.current.contains(target)) {
        setPaymentDialogId(null);
      }
      if (newRowPaymentDialogRef.current && !newRowPaymentDialogRef.current.contains(target)) {
        setNewRowPaymentDialogOpen(false);
      }
      if (editRowPaymentDialogRef.current && !editRowPaymentDialogRef.current.contains(target)) {
        setEditRowPaymentDialogOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Track if we've already consumed the auto-start to prevent re-triggering after save
  const autoStartConsumedRef = useRef(false);

  // Reset the consumed ref when autoStartNewRow changes from false to true (new trigger)
  useEffect(() => {
    if (!autoStartNewRow) {
      autoStartConsumedRef.current = false;
    }
  }, [autoStartNewRow]);

  // Auto-start new row when triggered from chat
  useEffect(() => {
    if (autoStartNewRow && !isAddingNewRow && !autoStartConsumedRef.current) {
      // Mark as consumed immediately to prevent re-triggering
      autoStartConsumedRef.current = true;

      // Start adding a new row with prefill values
      const defaultCurrency = validCurrencies.includes(currencyCode as ServiceCurrency)
        ? currencyCode as ServiceCurrency
        : 'ILS';

      setIsAddingNewRow(true);
      setNewRowFromChat(true); // Mark this as from chat for callback
      setNewRowValues({
        name: newRowPrefill?.service_name || '',
        duration: (newRowPrefill?.duration_minutes || 60).toString(),
        buffer: (newRowPrefill?.buffer_minutes || 0).toString(),
        price: (newRowPrefill?.price || 0).toString(),
        currency: (newRowPrefill?.currency as ServiceCurrency) || defaultCurrency,
        payment_type: (newRowPrefill?.payment_type as PaymentType) || 'full',
        installment_count: newRowPrefill?.installment_count || 1,
        installment_frequency: (newRowPrefill?.installment_frequency as InstallmentFrequency) || 'monthly',
        first_payment_due: (newRowPrefill?.first_payment_due as FirstPaymentDue) || 'on_booking',
        first_payment_days: newRowPrefill?.first_payment_days || 0
      });
      // Signal that we consumed the auto-start
      onAutoStartConsumed?.();
    }
  }, [autoStartNewRow, newRowPrefill, currencyCode, isAddingNewRow, onAutoStartConsumed, validCurrencies]);

  // Auto-edit a specific service when triggered from chat
  const autoEditConsumedRef = useRef(false);
  const lastAutoEditServiceIdRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset consumed ref when autoEditServiceId changes to a new value
    if (autoEditServiceId !== lastAutoEditServiceIdRef.current) {
      autoEditConsumedRef.current = false;
      lastAutoEditServiceIdRef.current = autoEditServiceId || null;
    }
  }, [autoEditServiceId]);

  useEffect(() => {
    if (autoEditServiceId && services.length > 0 && !autoEditConsumedRef.current) {
      const serviceToEdit = services.find(s => s.id === autoEditServiceId);
      if (serviceToEdit) {
        // Mark as consumed immediately to prevent re-triggering
        autoEditConsumedRef.current = true;
        // Start editing this service
        setEditingRowId(serviceToEdit.id);
        setEditRowValues({
          name: serviceToEdit.service_name,
          duration: serviceToEdit.duration_minutes?.toString() || '60',
          buffer: serviceToEdit.buffer_minutes?.toString() || '0',
          price: serviceToEdit.price?.toString() || '0',
          currency: serviceToEdit.currency || 'ILS',
          payment_type: serviceToEdit.payment_type || 'full',
          installment_count: serviceToEdit.installment_count || 1,
          installment_frequency: serviceToEdit.installment_frequency || 'monthly',
          first_payment_due: serviceToEdit.first_payment_due || 'on_booking',
          first_payment_days: serviceToEdit.first_payment_days || 0
        });
        // Signal that we consumed the auto-edit
        onAutoEditConsumed?.();
      }
    }
  }, [autoEditServiceId, services, onAutoEditConsumed]);

  // Get effective service with optimistic updates applied
  const getEffectiveService = (service: SchedulingService): SchedulingService => {
    const updates = optimisticUpdates[service.id];
    if (!updates) return service;
    return { ...service, ...updates };
  };

  const getServiceInitials = (name: string) => {
    const words = name.split(' ');
    if (words.length >= 2) {
      return (words[0][0] + words[1][0]).toUpperCase();
    }
    return name.substring(0, 2).toUpperCase();
  };

  const handlePublish = async (serviceId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (publishingId) return;

    setPublishingId(serviceId);
    try {
      const response = await fetch(`/api/scheduling/services/${serviceId}/publish`, {
        method: 'POST'
      });

      if (response.ok) {
        // Clear the recently edited highlight since service is now published
        if (recentlyEditedId === serviceId) {
          setRecentlyEditedId(null);
        }
        onServicePublished?.();
        onServicePublishedWithId?.(serviceId);
      }
    } catch (error) {
      // Silently fail - user can retry
    } finally {
      setPublishingId(null);
    }
  };

  const handleToggleActive = async (e: React.MouseEvent, service: SchedulingService) => {
    e.stopPropagation();
    if (togglingId) return;

    const newActiveState = !service.is_active;
    setTogglingId(service.id);

    // Optimistic update
    setOptimisticUpdates(prev => ({
      ...prev,
      [service.id]: { ...prev[service.id], is_active: newActiveState }
    }));

    try {
      const response = await fetch(`/api/scheduling/services/${service.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          is_active: newActiveState,
          // Sync status with is_active flag
          status: newActiveState ? 'active' : 'inactive'
        })
      });

      if (response.ok) {
        onSilentRefresh?.();
      } else {
        // Revert optimistic update on failure
        setOptimisticUpdates(prev => {
          const updated = { ...prev };
          delete updated[service.id];
          return updated;
        });
      }
    } catch {
      // Revert optimistic update on error
      setOptimisticUpdates(prev => {
        const updated = { ...prev };
        delete updated[service.id];
        return updated;
      });
    } finally {
      setTogglingId(null);
    }
  };

  const handleDeleteClick = async (e: React.MouseEvent, service: SchedulingService) => {
    e.stopPropagation();
    setDeleteError(null);
    setDeleting(true);

    // Pre-check if service has bookings before showing confirmation
    try {
      const response = await fetch(`/api/scheduling/services/${service.id}/bookings/count`);
      const data = await response.json();

      if (response.ok && data.count > 0) {
        // Service has bookings - show error immediately
        setDeleteConfirm({ serviceId: service.id, serviceName: service.service_name });
        setDeleteError({
          message: t('scheduling.service.delete_has_bookings'),
          bookingCount: data.count
        });
      } else {
        // No bookings - show normal confirmation
        setDeleteConfirm({ serviceId: service.id, serviceName: service.service_name });
      }
    } catch {
      // If pre-check fails, just show confirmation and let delete handle it
      setDeleteConfirm({ serviceId: service.id, serviceName: service.service_name });
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm || deleting) return;

    setDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(`/api/scheduling/services/${deleteConfirm.serviceId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (response.ok) {
        setDeleteConfirm(null);
        onServicePublished?.();
      } else if (response.status === 409) {
        // Service has bookings
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
    setDeleteConfirm(null);
    setDeleteError(null);
  };

  // Description dialog handlers
  const openDescriptionDialog = (service: SchedulingService, e: React.MouseEvent) => {
    e.stopPropagation();
    setDescriptionValue(service.description || '');
    setDescriptionDialogId(service.id);
  };

  const saveDescription = async (serviceId: string) => {
    if (savingDescription) return;

    setSavingDescription(true);

    // Optimistic update
    setOptimisticUpdates(prev => ({
      ...prev,
      [serviceId]: { ...prev[serviceId], description: descriptionValue }
    }));

    setDescriptionDialogId(null);

    try {
      const response = await fetch(`/api/scheduling/services/${serviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: descriptionValue })
      });

      if (response.ok) {
        // Success - clear optimistic update and do silent refresh
        setOptimisticUpdates(prev => {
          const updated = { ...prev };
          if (updated[serviceId]) {
            delete updated[serviceId].description;
            if (Object.keys(updated[serviceId]).length === 0) {
              delete updated[serviceId];
            }
          }
          return updated;
        });
        onSilentRefresh?.();
      } else {
        // Revert optimistic update on failure
        setOptimisticUpdates(prev => {
          const updated = { ...prev };
          if (updated[serviceId]) {
            delete updated[serviceId].description;
            if (Object.keys(updated[serviceId]).length === 0) {
              delete updated[serviceId];
            }
          }
          return updated;
        });
        onSilentRefresh?.();
      }
    } catch {
      // Revert on error
      setOptimisticUpdates(prev => {
        const updated = { ...prev };
        if (updated[serviceId]) {
          delete updated[serviceId].description;
          if (Object.keys(updated[serviceId]).length === 0) {
            delete updated[serviceId];
          }
        }
        return updated;
      });
      onSilentRefresh?.();
    } finally {
      setSavingDescription(false);
    }
  };

  // Payment plan dialog handlers
  const openPaymentDialog = (service: SchedulingService, e: React.MouseEvent) => {
    e.stopPropagation();
    setPaymentValues({
      payment_type: service.payment_type || 'full',
      installment_count: service.installment_count || 1,
      installment_frequency: service.installment_frequency || 'monthly',
      first_payment_due: service.first_payment_due || 'on_booking',
      first_payment_days: service.first_payment_days || 0
    });
    setPaymentDialogId(service.id);
  };

  const savePaymentPlan = async (serviceId: string) => {
    if (savingPayment) return;

    setSavingPayment(true);

    // Optimistic update
    setOptimisticUpdates(prev => ({
      ...prev,
      [serviceId]: { ...prev[serviceId], ...paymentValues }
    }));

    setPaymentDialogId(null);

    try {
      const response = await fetch(`/api/scheduling/services/${serviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paymentValues)
      });

      if (response.ok) {
        // Success - clear optimistic update and do silent refresh
        setOptimisticUpdates(prev => {
          const updated = { ...prev };
          delete updated[serviceId];
          return updated;
        });
        onSilentRefresh?.();
      } else {
        // Revert optimistic update on failure
        setOptimisticUpdates(prev => {
          const updated = { ...prev };
          delete updated[serviceId];
          return updated;
        });
        onSilentRefresh?.();
      }
    } catch {
      // Revert on error
      setOptimisticUpdates(prev => {
        const updated = { ...prev };
        delete updated[serviceId];
        return updated;
      });
      onSilentRefresh?.();
    } finally {
      setSavingPayment(false);
    }
  };

  // New row handlers
  const startAddNewRow = () => {
    setIsAddingNewRow(true);
    setNewRowValues({
      name: '',
      duration: '60',
      buffer: '0',
      price: '0',
      currency: getValidCurrency(currencyCode),
      payment_type: 'full',
      installment_count: 1,
      installment_frequency: 'monthly',
      first_payment_due: 'on_booking',
      first_payment_days: 0
    });
  };

  const cancelNewRow = () => {
    setIsAddingNewRow(false);
    setNewRowValues({
      name: '',
      duration: '60',
      buffer: '0',
      price: '0',
      currency: getValidCurrency(currencyCode),
      payment_type: 'full',
      installment_count: 1,
      installment_frequency: 'monthly',
      first_payment_due: 'on_booking',
      first_payment_days: 0
    });
  };

  const saveNewRow = async () => {
    if (savingNewRow || !newRowValues.name.trim()) return;

    setSavingNewRow(true);

    try {
      const response = await fetch('/api/scheduling/services', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_name: newRowValues.name,
          duration_minutes: parseInt(newRowValues.duration) || 60,
          buffer_minutes: parseInt(newRowValues.buffer) || 0,
          price: parseFloat(newRowValues.price) || 0,
          currency: newRowValues.currency,
          is_active: false, // Start as draft
          status: 'draft',
          payment_type: newRowValues.payment_type,
          installment_count: newRowValues.installment_count,
          installment_frequency: newRowValues.installment_frequency,
          first_payment_due: newRowValues.first_payment_due,
          first_payment_days: newRowValues.first_payment_days
        })
      });

      if (response.ok) {
        const data = await response.json();
        const newServiceId = data.service?.id;

        // If this was created from chat, call the callback with service info
        if (newRowFromChat && onServiceCreatedFromChat) {
          onServiceCreatedFromChat({
            name: newRowValues.name,
            duration: parseInt(newRowValues.duration) || 60,
            price: parseFloat(newRowValues.price) || 0,
            currency: newRowValues.currency
          });
        }

        // Track the new service as edited (draft) so we can warn on close
        if (newServiceId) {
          setRecentlyEditedId(newServiceId);
          onServiceEdited?.(newServiceId);
        }

        setNewRowFromChat(false);
        setIsAddingNewRow(false);
        setNewRowValues({
          name: '',
          duration: '60',
          buffer: '0',
          price: '0',
          currency: getValidCurrency(currencyCode),
          payment_type: 'full',
          installment_count: 1,
          installment_frequency: 'monthly',
          first_payment_due: 'on_booking',
          first_payment_days: 0
        });
        onServicePublished?.();
      }
    } catch {
      // Error handling - keep the row open so user can retry
    } finally {
      setSavingNewRow(false);
    }
  };

  const startRowEdit = (service: SchedulingService) => {
    setEditingRowId(service.id);
    setEditRowValues({
      name: service.service_name,
      duration: service.duration_minutes?.toString() || '60',
      buffer: service.buffer_minutes?.toString() || '0',
      price: service.price?.toString() || '0',
      currency: getValidCurrency(service.currency),
      payment_type: service.payment_type || 'full',
      installment_count: service.installment_count || 1,
      installment_frequency: service.installment_frequency || 'monthly',
      first_payment_due: service.first_payment_due || 'on_booking',
      first_payment_days: service.first_payment_days || 0
    });
  };

  const cancelRowEdit = () => {
    setEditingRowId(null);
    setEditRowPaymentDialogOpen(false);
    setEditRowValues({
      name: '',
      duration: '',
      buffer: '',
      price: '',
      currency: 'ILS',
      payment_type: 'full',
      installment_count: 1,
      installment_frequency: 'monthly',
      first_payment_due: 'on_booking',
      first_payment_days: 0
    });
  };

  const saveRowEdit = async (serviceId: string) => {
    if (savingRow) return;

    const updateData = {
      service_name: editRowValues.name,
      duration_minutes: parseInt(editRowValues.duration) || 60,
      buffer_minutes: parseInt(editRowValues.buffer) || 0,
      price: editRowValues.price !== '' ? parseFloat(editRowValues.price) : null,
      currency: editRowValues.currency,
      payment_type: editRowValues.payment_type,
      installment_count: editRowValues.installment_count,
      installment_frequency: editRowValues.installment_frequency,
      first_payment_due: editRowValues.first_payment_due,
      first_payment_days: editRowValues.first_payment_days,
      status: 'draft' // Set to draft on edit - requires explicit publish
    };

    // Optimistic update
    setOptimisticUpdates(prev => ({
      ...prev,
      [serviceId]: { ...prev[serviceId], ...updateData }
    }));

    setEditingRowId(null);
    setEditRowPaymentDialogOpen(false);
    setEditRowValues({
      name: '',
      duration: '',
      buffer: '',
      price: '',
      currency: 'ILS',
      payment_type: 'full',
      installment_count: 1,
      installment_frequency: 'monthly',
      first_payment_due: 'on_booking',
      first_payment_days: 0
    });

    // Background API call
    fetch(`/api/scheduling/services/${serviceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateData)
    }).then(async response => {
      if (response.ok) {
        // Success - clear optimistic update and do silent refresh
        setOptimisticUpdates(prev => {
          const updated = { ...prev };
          delete updated[serviceId];
          return updated;
        });
        // Highlight the row to draw attention to the publish button (persists until dialog closes)
        setRecentlyEditedId(serviceId);
        // Notify parent that this service was edited (now draft)
        onServiceEdited?.(serviceId);
        onSilentRefresh?.();
      } else {
        // Log error for debugging
        const errorData = await response.json().catch(() => ({}));
        console.error('Service update failed:', { status: response.status, ...errorData });
        console.error('Sent data:', updateData);
        if (errorData.details) {
          console.error('Validation errors:', errorData.details);
        }
        setOptimisticUpdates(prev => {
          const updated = { ...prev };
          delete updated[serviceId];
          return updated;
        });
        onSilentRefresh?.();
      }
    }).catch((err) => {
      console.error('Service update error:', err);
      setOptimisticUpdates(prev => {
        const updated = { ...prev };
        delete updated[serviceId];
        return updated;
      });
      onSilentRefresh?.();
    });
  };

  const getStatusBadge = (service: SchedulingService) => {
    if (service.status === 'draft') {
      return (
        <Badge
          variant="outline"
          className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
        >
          <Sparkles className="h-3 w-3 me-1" />
          {t('scheduling.service.draft')}
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className={`text-xs ${
          service.is_active
            ? 'bg-[#14B8A6]/10 text-[#0D9488] dark:text-[#5EEAD4] border-[#14B8A6]/30'
            : 'bg-[var(--v2-border)]/30 text-[var(--v2-text-muted)] border-[var(--v2-border)]'
        }`}
      >
        {service.is_active ? t('scheduling.service.active') : t('scheduling.service.inactive')}
      </Badge>
    );
  };

  const getSourceBadge = (service: SchedulingService) => {
    if (service.source === 'ai_generated') {
      return (
        <Badge
          variant="outline"
          className="text-xs bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30"
        >
          <Sparkles className="h-3 w-3 me-1" />
          {t('scheduling.service.ai_generated')}
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="text-xs bg-[var(--v2-border)]/30 text-[var(--v2-text-muted)] border-[var(--v2-border)]"
      >
        {t('scheduling.service.manual')}
      </Badge>
    );
  };

  const renderServiceRow = (service: SchedulingService) => {
    const effectiveService = getEffectiveService(service);
    const isDraft = service.status === 'draft';
    const isPublishing = publishingId === service.id;
    const isEditing = editingRowId === service.id;
    const isRecentlyEdited = recentlyEditedId === service.id;

    if (isEditing) {
      return (
        <tr key={service.id} className="bg-[#D14E97]/5">
          {/* Service Name */}
          <td className="px-4 py-3">
            <input
              type="text"
              value={editRowValues.name}
              onChange={(e) => setEditRowValues(prev => ({ ...prev, name: e.target.value }))}
              className="w-full px-2 py-1.5 text-sm bg-[var(--v2-bg)] border border-[#D14E97]/30 rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#D14E97]"
              autoFocus
            />
          </td>
          {/* Duration */}
          <td className="px-4 py-3">
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={editRowValues.duration}
                onChange={(e) => setEditRowValues(prev => ({ ...prev, duration: e.target.value }))}
                className="w-16 px-2 py-1.5 text-sm bg-[var(--v2-bg)] border border-[#D14E97]/30 rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#D14E97]"
              />
              <span className="text-xs text-[var(--v2-text-muted)]">{t('scheduling.service.minutes')}</span>
            </div>
          </td>
          {/* Buffer */}
          <td className="px-4 py-3">
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={editRowValues.buffer}
                onChange={(e) => setEditRowValues(prev => ({ ...prev, buffer: e.target.value }))}
                className="w-16 px-2 py-1.5 text-sm bg-[var(--v2-bg)] border border-[#D14E97]/30 rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#D14E97]"
              />
              <span className="text-xs text-[var(--v2-text-muted)]">{t('scheduling.service.min_buffer')}</span>
            </div>
          </td>
          {/* Price with Currency */}
          <td className="px-4 py-3">
            <div className="flex items-center gap-1">
              <Select
                value={editRowValues.currency}
                onValueChange={(value) => setEditRowValues(prev => ({ ...prev, currency: value as ServiceCurrency }))}
              >
                <SelectTrigger
                  className="w-14 h-8 px-1.5 text-xs bg-[var(--v2-bg)] border-[#D14E97]/30 text-[var(--v2-text-primary)] focus:border-[#D14E97] focus:ring-[#D14E97]/20"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)]">
                  <SelectItem value="USD" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">$</SelectItem>
                  <SelectItem value="EUR" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">€</SelectItem>
                  <SelectItem value="ILS" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">₪</SelectItem>
                  <SelectItem value="GBP" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">£</SelectItem>
                </SelectContent>
              </Select>
              <input
                type="number"
                value={editRowValues.price}
                onChange={(e) => setEditRowValues(prev => ({ ...prev, price: e.target.value }))}
                className="w-16 px-2 py-1.5 text-sm bg-[var(--v2-bg)] border border-[#D14E97]/30 rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#D14E97]"
              />
            </div>
          </td>
          {/* Payment Plan */}
          <td className="px-4 py-3 text-xs text-[var(--v2-text-secondary)]">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setEditRowPaymentDialogOpen(true);
              }}
              className={`flex items-center gap-1.5 px-2 py-1 transition-all hover:bg-[#D14E97]/10 whitespace-nowrap ${
                editRowValues.payment_type === 'installments' ? 'text-[#D14E97]' : 'text-[var(--v2-text-muted)]'
              }`}
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('scheduling.modal.payment_options')}
            >
              <CreditCard className="h-3.5 w-3.5 flex-shrink-0" />
              {editRowValues.payment_type === 'installments' && editRowValues.installment_count > 1 ? (
                <span>{editRowValues.installment_count}x {getFrequencyShortLabel(editRowValues.installment_frequency)}</span>
              ) : (
                <span>{t('scheduling.modal.payment_full')}</span>
              )}
            </button>
          </td>
          {/* Status */}
          <td className="px-4 py-3">{getStatusBadge(service)}</td>
          {/* Actions */}
          <td className="px-4 py-3">
            <div className="flex items-center gap-1 justify-end">
              <button
                onClick={() => saveRowEdit(service.id)}
                disabled={savingRow}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#D14E97] hover:bg-[#D14E97]/90 transition-all disabled:opacity-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {savingRow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                {t('button.save')}
              </button>
              <button
                onClick={cancelRowEdit}
                className="px-3 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {t('button.cancel')}
              </button>
            </div>
          </td>
        </tr>
      );
    }

    return (
      <tr
        key={service.id}
        className={`border-b border-[var(--v2-border)] last:border-b-0 hover:bg-[var(--v2-bg)] transition-colors group ${isDraft ? 'bg-amber-500/5' : ''} ${isRecentlyEdited ? 'recently-edited-row' : ''}`}
      >
        {/* Service Name */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold flex-shrink-0 border ${
                isDraft
                  ? 'text-amber-600 border-amber-500 bg-amber-500/10'
                  : 'text-[#D14E97] border-[#D14E97] bg-[#D14E97]/10'
              }`}
            >
              {getServiceInitials(effectiveService.service_name)}
            </div>
            <span className="text-sm font-medium text-[var(--v2-text-primary)]">
              {effectiveService.service_name}
            </span>
            {/* Description button */}
            <button
              onClick={(e) => openDescriptionDialog(service, e)}
              className={`p-1 transition-all ${
                effectiveService.description
                  ? 'text-[#D14E97] hover:bg-[#D14E97]/10'
                  : 'text-[var(--v2-text-muted)] hover:text-[#D14E97] hover:bg-[#D14E97]/10'
              }`}
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('scheduling.modal.description')}
            >
              <FileText className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
        {/* Duration */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm text-[var(--v2-text-secondary)]">
            <Clock className="h-3.5 w-3.5 text-[var(--v2-text-muted)]" />
            <span>{effectiveService.duration_minutes}</span>
            <span className="text-[var(--v2-text-muted)]">{t('scheduling.service.minutes')}</span>
          </div>
        </td>
        {/* Buffer */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm text-[var(--v2-text-secondary)]">
            <Pause className="h-3.5 w-3.5 text-[var(--v2-text-muted)]" />
            <span>{effectiveService.buffer_minutes || 0}</span>
            <span className="text-[var(--v2-text-muted)]">{t('scheduling.service.min_buffer')}</span>
          </div>
        </td>
        {/* Price */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 text-sm font-medium text-[#0D9488]">
            <Tag className="h-3.5 w-3.5" />
            <span>{formatCurrency(effectiveService.price, { currencyOverride: service.currency })}</span>
          </div>
        </td>
        {/* Payment Plan */}
        <td className="px-4 py-3 text-xs text-[var(--v2-text-secondary)]">
          <button
            onClick={(e) => openPaymentDialog(service, e)}
            className={`flex items-center gap-1.5 px-2 py-1 transition-all hover:bg-[#D14E97]/10 whitespace-nowrap ${
              effectiveService.payment_type === 'installments' ? 'text-[#D14E97]' : 'text-[var(--v2-text-muted)]'
            }`}
            style={{ borderRadius: 'var(--v2-radius-button)' }}
            title={t('scheduling.modal.payment_options')}
          >
            <CreditCard className="h-3.5 w-3.5 flex-shrink-0" />
            {effectiveService.payment_type === 'installments' && effectiveService.installment_count ? (
              <span>{effectiveService.installment_count}x {getFrequencyShortLabel(effectiveService.installment_frequency)}</span>
            ) : (
              <span>{t('scheduling.modal.payment_full')}</span>
            )}
          </button>
        </td>
        {/* Status */}
        <td className="px-4 py-3">
          {getStatusBadge(service)}
        </td>
        {/* Actions */}
        <td className="px-4 py-3">
          <div className={`flex items-center gap-1 justify-end transition-opacity ${isRecentlyEdited ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            {isDraft && (
              <button
                onClick={(e) => handlePublish(service.id, e)}
                disabled={isPublishing}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all disabled:opacity-50 ${isRecentlyEdited ? 'publish-pulse' : ''}`}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
                title={t('scheduling.service.publish')}
              >
                {isPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
            )}
            {/* Toggle Active/Inactive */}
            <button
              onClick={(e) => handleToggleActive(e, service)}
              disabled={togglingId === service.id}
              className={`p-1.5 transition-all ${
                effectiveService.is_active
                  ? 'text-[#14B8A6] hover:text-[#0D9488] hover:bg-[#14B8A6]/10'
                  : 'text-[var(--v2-text-muted)] hover:text-[#14B8A6] hover:bg-[#14B8A6]/10'
              }`}
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={effectiveService.is_active ? t('scheduling.service.deactivate') : t('scheduling.service.activate')}
            >
              {togglingId === service.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Power className="h-4 w-4" />
              )}
            </button>
            <button
              onClick={() => startRowEdit(service)}
              className="p-1.5 text-[var(--v2-text-muted)] hover:text-[#D14E97] hover:bg-[#D14E97]/10 transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('scheduling.service.edit')}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={(e) => handleDeleteClick(e, service)}
              className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              title={t('scheduling.service.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div className="space-y-4">
      {/* CSS animation for recently edited service highlight */}
      <style>{`
        @keyframes publish-pulse-animation {
          0%, 100% { box-shadow: 0 0 0 0 rgba(20, 184, 166, 0.5); }
          50% { box-shadow: 0 0 0 8px rgba(20, 184, 166, 0); }
        }
        .publish-pulse {
          animation: publish-pulse-animation 1.2s ease-in-out infinite !important;
          background-color: rgba(20, 184, 166, 0.15) !important;
        }
        .publish-pulse:hover {
          background-color: rgba(20, 184, 166, 0.15) !important;
        }
        .recently-edited-row {
          background-color: rgba(20, 184, 166, 0.08) !important;
        }
      `}</style>
      {/* Services Table */}
      {services.length > 0 && (
        <div
          className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--v2-bg)] border-b border-[var(--v2-border)] text-xs font-medium text-[var(--v2-text-muted)] uppercase tracking-wide">
                <th className="px-4 py-2.5 text-start w-[28%]">{t('config.services.column.service')}</th>
                <th className="px-4 py-2.5 text-start w-[14%]">{t('config.services.column.duration')}</th>
                <th className="px-4 py-2.5 text-start w-[14%]">{t('config.services.column.buffer')}</th>
                <th className="px-4 py-2.5 text-start w-[12%]">{t('config.services.column.price')}</th>
                <th className="px-4 py-2.5 text-start w-[10%]">{t('config.services.column.payment')}</th>
                <th className="px-4 py-2.5 text-start w-[10%]">{t('config.services.column.status')}</th>
                <th className="px-4 py-2.5 text-end w-[12%]">{t('config.services.column.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {[...services].sort((a, b) => {
                // Active published services first, then draft, then inactive
                const aActive = a.status !== 'draft' && a.is_active;
                const bActive = b.status !== 'draft' && b.is_active;
                if (aActive && !bActive) return -1;
                if (!aActive && bActive) return 1;
                // Then draft services
                const aDraft = a.status === 'draft';
                const bDraft = b.status === 'draft';
                if (aDraft && !bDraft) return -1;
                if (!aDraft && bDraft) return 1;
                return 0;
              }).map(renderServiceRow)}
              {/* New Row for adding service */}
              {isAddingNewRow && (
                <tr className="bg-[#D14E97]/5 border-t border-[var(--v2-border)]">
                  {/* Service Name */}
                  <td className="px-4 py-3">
                    <input
                      type="text"
                      value={newRowValues.name}
                      onChange={(e) => setNewRowValues(prev => ({ ...prev, name: e.target.value }))}
                      placeholder={t('scheduling.modal.service_name_placeholder')}
                      className="w-full px-2 py-1.5 text-sm bg-[var(--v2-bg)] border border-[#D14E97]/30 rounded text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[#D14E97]"
                      autoFocus
                    />
                  </td>
                  {/* Duration */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={newRowValues.duration}
                        onChange={(e) => setNewRowValues(prev => ({ ...prev, duration: e.target.value }))}
                        className="w-16 px-2 py-1.5 text-sm bg-[var(--v2-bg)] border border-[#D14E97]/30 rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#D14E97]"
                      />
                      <span className="text-xs text-[var(--v2-text-muted)]">{t('scheduling.service.minutes')}</span>
                    </div>
                  </td>
                  {/* Buffer */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={newRowValues.buffer}
                        onChange={(e) => setNewRowValues(prev => ({ ...prev, buffer: e.target.value }))}
                        className="w-16 px-2 py-1.5 text-sm bg-[var(--v2-bg)] border border-[#D14E97]/30 rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#D14E97]"
                      />
                      <span className="text-xs text-[var(--v2-text-muted)]">{t('scheduling.service.min_buffer')}</span>
                    </div>
                  </td>
                  {/* Price with Currency */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <Select
                        value={newRowValues.currency}
                        onValueChange={(value) => setNewRowValues(prev => ({ ...prev, currency: value as ServiceCurrency }))}
                      >
                        <SelectTrigger
                          className="w-14 h-8 px-1.5 text-xs bg-[var(--v2-bg)] border-[#D14E97]/30 text-[var(--v2-text-primary)] focus:border-[#D14E97] focus:ring-[#D14E97]/20"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)]">
                          <SelectItem value="USD" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">$</SelectItem>
                          <SelectItem value="EUR" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">€</SelectItem>
                          <SelectItem value="ILS" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">₪</SelectItem>
                          <SelectItem value="GBP" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">£</SelectItem>
                        </SelectContent>
                      </Select>
                      <input
                        type="number"
                        value={newRowValues.price}
                        onChange={(e) => setNewRowValues(prev => ({ ...prev, price: e.target.value }))}
                        className="w-16 px-2 py-1.5 text-sm bg-[var(--v2-bg)] border border-[#D14E97]/30 rounded text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#D14E97]"
                      />
                    </div>
                  </td>
                  {/* Payment Plan */}
                  <td className="px-4 py-3 text-xs text-[var(--v2-text-secondary)]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setNewRowPaymentDialogOpen(true);
                      }}
                      className={`flex items-center gap-1.5 px-2 py-1 transition-all hover:bg-[#D14E97]/10 whitespace-nowrap ${
                        newRowValues.payment_type === 'installments' ? 'text-[#D14E97]' : 'text-[var(--v2-text-muted)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                      title={t('scheduling.modal.payment_options')}
                    >
                      <CreditCard className="h-3.5 w-3.5 flex-shrink-0" />
                      {newRowValues.payment_type === 'installments' && newRowValues.installment_count > 1 ? (
                        <span>{newRowValues.installment_count}x {getFrequencyShortLabel(newRowValues.installment_frequency)}</span>
                      ) : (
                        <span>{t('scheduling.modal.payment_full')}</span>
                      )}
                    </button>
                  </td>
                  {/* Status - draft by default */}
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30"
                    >
                      <Sparkles className="h-3 w-3 me-1" />
                      {t('scheduling.service.draft')}
                    </Badge>
                  </td>
                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={saveNewRow}
                        disabled={savingNewRow || !newRowValues.name.trim()}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#D14E97] hover:bg-[#D14E97]/90 transition-all disabled:opacity-50"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        {savingNewRow ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                        {t('button.save')}
                      </button>
                      <button
                        onClick={cancelNewRow}
                        className="px-3 py-1.5 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        {t('button.cancel')}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

        </div>
      )}

      {/* Add Button - shown when showAddButton is true and not already adding */}
      {showAddButton && !isAddingNewRow && services.length > 0 && (
        <button
          onClick={startAddNewRow}
          className="w-full flex items-center justify-center gap-2 py-3 text-sm font-medium border border-dashed border-gray-300 dark:border-gray-600 bg-transparent transition-all hover:border-[#F97316]/50 hover:bg-[#F97316]/5"
          style={{ borderRadius: 'var(--v2-radius-card)', color: '#F97316' }}
        >
          <Plus className="h-4 w-4" />
          {t('scheduling.new_service') || 'Add a service'}
        </button>
      )}

      {/* Empty State - show Add button here when no services */}
      {services.length === 0 && !isAddingNewRow && (
        <div
          className="flex flex-col items-center justify-center py-16 bg-[var(--v2-surface)] border border-[var(--v2-border)]"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
            style={{ backgroundColor: `${CONFIG_COLOR}15` }}
          >
            <Clock className="w-8 h-8" style={{ color: CONFIG_COLOR }} />
          </div>
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">
            {t('scheduling.no_services')}
          </h3>
          <p className="text-sm text-[var(--v2-text-muted)] mb-4">
            {t('scheduling.no_services_desc')}
          </p>
          {showAddButton && (
            <button
              onClick={startAddNewRow}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium border transition-all"
              style={{
                borderRadius: 'var(--v2-radius-button)',
                color: CONFIG_COLOR,
                borderColor: CONFIG_COLOR,
                backgroundColor: `${CONFIG_COLOR}10`
              }}
            >
              <Plus className="h-4 w-4" />
              {t('scheduling.new_service') || 'Add Service'}
            </button>
          )}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
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
                    .replace('{name}', deleteConfirm.serviceName)
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
                  {t('scheduling.service.delete_confirm_message').replace('{name}', deleteConfirm.serviceName)}
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

      {/* Description Mini-Dialog */}
      {descriptionDialogId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            ref={descriptionDialogRef}
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 max-w-md w-full mx-4 shadow-xl"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${CONFIG_COLOR}20` }}
                >
                  <FileText className="h-5 w-5" style={{ color: CONFIG_COLOR }} />
                </div>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {t('scheduling.modal.description')}
                </h3>
              </div>
              <button
                onClick={() => setDescriptionDialogId(null)}
                className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <textarea
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.target.value)}
              placeholder={t('scheduling.modal.description_placeholder')}
              rows={4}
              className="w-full px-4 py-2.5 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#D14E97] focus:ring-2 focus:ring-[#D14E97]/20 transition-all resize-none"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
              autoFocus
            />

            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={() => setDescriptionDialogId(null)}
                className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {t('button.cancel')}
              </button>
              <button
                onClick={() => saveDescription(descriptionDialogId)}
                disabled={savingDescription}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-all disabled:opacity-50"
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  backgroundColor: CONFIG_COLOR
                }}
              >
                {savingDescription ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t('button.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Plan Dialog */}
      {paymentDialogId && (() => {
        const service = services.find(s => s.id === paymentDialogId);
        const servicePrice = service?.price || 0;
        const serviceCurrency = service?.currency;

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div
              ref={paymentDialogRef}
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 max-w-lg w-full mx-4 shadow-xl"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ backgroundColor: `${CONFIG_COLOR}20` }}
                  >
                    <CreditCard className="h-5 w-5" style={{ color: CONFIG_COLOR }} />
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {t('scheduling.modal.payment_options')}
                  </h3>
                </div>
                <button
                  onClick={() => setPaymentDialogId(null)}
                  className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Payment Type Toggle */}
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setPaymentValues(prev => ({ ...prev, payment_type: 'full', installment_count: 1 }))}
                    className={`p-4 text-start border transition-all ${
                      paymentValues.payment_type === 'full'
                        ? 'border-[#D14E97] bg-[#D14E97]/10'
                        : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        paymentValues.payment_type === 'full' ? 'border-[#D14E97]' : 'border-[var(--v2-text-muted)]'
                      }`}>
                        {paymentValues.payment_type === 'full' && <div className="w-2 h-2 rounded-full bg-[#D14E97]" />}
                      </div>
                      <span className={`text-sm font-medium ${paymentValues.payment_type === 'full' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                        {t('scheduling.modal.payment_full')}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
                      {t('scheduling.modal.payment_full_desc')}
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setPaymentValues(prev => ({ ...prev, payment_type: 'installments', installment_count: prev.installment_count > 1 ? prev.installment_count : 2 }))}
                    className={`p-4 text-start border transition-all ${
                      paymentValues.payment_type === 'installments'
                        ? 'border-[#D14E97] bg-[#D14E97]/10'
                        : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        paymentValues.payment_type === 'installments' ? 'border-[#D14E97]' : 'border-[var(--v2-text-muted)]'
                      }`}>
                        {paymentValues.payment_type === 'installments' && <div className="w-2 h-2 rounded-full bg-[#D14E97]" />}
                      </div>
                      <span className={`text-sm font-medium ${paymentValues.payment_type === 'installments' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                        {t('scheduling.modal.payment_installments')}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
                      {t('scheduling.modal.payment_installments_desc')}
                    </p>
                  </button>
                </div>

                {/* Installment Details - only show when installments selected */}
                {paymentValues.payment_type === 'installments' && (
                  <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                    <div>
                      <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                        {t('scheduling.modal.installment_count')}
                      </label>
                      <input
                        type="number"
                        min="2"
                        max="24"
                        value={paymentValues.installment_count}
                        onChange={(e) => setPaymentValues(prev => ({ ...prev, installment_count: Math.max(2, Math.min(24, parseInt(e.target.value) || 2)) }))}
                        className="w-full px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#D14E97] focus:ring-2 focus:ring-[#D14E97]/20 transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                      <p className="text-xs text-[var(--v2-text-muted)] mt-1.5">
                        {servicePrice > 0 && paymentValues.installment_count >= 2
                          ? `${getCurrencySymbol(serviceCurrency)}${(servicePrice / paymentValues.installment_count).toFixed(2)} ${t('scheduling.modal.per_installment')}`
                          : ''
                        }
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                        {t('scheduling.modal.installment_frequency')}
                      </label>
                      <Select
                        value={paymentValues.installment_frequency}
                        onValueChange={(value) => setPaymentValues(prev => ({ ...prev, installment_frequency: value as InstallmentFrequency }))}
                      >
                        <SelectTrigger
                          className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:border-[#D14E97] focus:ring-[#D14E97]/20"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)]">
                          <SelectItem value="weekly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                            {t('scheduling.modal.frequency_weekly')}
                          </SelectItem>
                          <SelectItem value="biweekly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                            {t('scheduling.modal.frequency_biweekly')}
                          </SelectItem>
                          <SelectItem value="monthly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                            {t('scheduling.modal.frequency_monthly')}
                          </SelectItem>
                          <SelectItem value="quarterly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                            {t('scheduling.modal.frequency_quarterly')}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* First Payment Due */}
                <div className="space-y-3">
                  <label className="block text-sm font-medium text-[var(--v2-text-primary)]">
                    {t('scheduling.modal.first_payment_due')}
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setPaymentValues(prev => ({ ...prev, first_payment_due: 'on_booking', first_payment_days: 0 }))}
                      className={`p-3 text-start border transition-all ${
                        paymentValues.first_payment_due === 'on_booking'
                          ? 'border-[#D14E97] bg-[#D14E97]/10'
                          : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <span className={`text-sm font-medium ${paymentValues.first_payment_due === 'on_booking' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                        {t('scheduling.modal.payment_on_booking')}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPaymentValues(prev => ({ ...prev, first_payment_due: 'days_after', first_payment_days: prev.first_payment_days || 7 }))}
                      className={`p-3 text-start border transition-all ${
                        paymentValues.first_payment_due === 'days_after'
                          ? 'border-[#D14E97] bg-[#D14E97]/10'
                          : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <span className={`text-sm font-medium ${paymentValues.first_payment_due === 'days_after' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                        {t('scheduling.modal.payment_days_after')}
                      </span>
                    </button>
                  </div>

                  {paymentValues.first_payment_due === 'days_after' && (
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        max="365"
                        value={paymentValues.first_payment_days}
                        onChange={(e) => setPaymentValues(prev => ({ ...prev, first_payment_days: Math.max(1, Math.min(365, parseInt(e.target.value) || 1)) }))}
                        className="w-20 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#D14E97] focus:ring-2 focus:ring-[#D14E97]/20 transition-all"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      />
                      <span className="text-sm text-[var(--v2-text-secondary)]">
                        {t('scheduling.modal.days_after_booking')}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setPaymentDialogId(null)}
                  className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {t('button.cancel')}
                </button>
                <button
                  onClick={() => savePaymentPlan(paymentDialogId)}
                  disabled={savingPayment}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-all disabled:opacity-50"
                  style={{
                    borderRadius: 'var(--v2-radius-button)',
                    backgroundColor: CONFIG_COLOR
                  }}
                >
                  {savingPayment ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  {t('button.save')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* New Row Payment Plan Dialog */}
      {newRowPaymentDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            ref={newRowPaymentDialogRef}
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 max-w-lg w-full mx-4 shadow-xl"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${CONFIG_COLOR}20` }}
                >
                  <CreditCard className="h-5 w-5" style={{ color: CONFIG_COLOR }} />
                </div>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {t('scheduling.modal.payment_options')}
                </h3>
              </div>
              <button
                onClick={() => setNewRowPaymentDialogOpen(false)}
                className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Payment Type Toggle */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setNewRowValues(prev => ({ ...prev, payment_type: 'full', installment_count: 1 }))}
                  className={`p-4 text-start border transition-all ${
                    newRowValues.payment_type === 'full'
                      ? 'border-[#D14E97] bg-[#D14E97]/10'
                      : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      newRowValues.payment_type === 'full' ? 'border-[#D14E97]' : 'border-[var(--v2-text-muted)]'
                    }`}>
                      {newRowValues.payment_type === 'full' && <div className="w-2 h-2 rounded-full bg-[#D14E97]" />}
                    </div>
                    <span className={`text-sm font-medium ${newRowValues.payment_type === 'full' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                      {t('scheduling.modal.payment_full')}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
                    {t('scheduling.modal.payment_full_desc')}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setNewRowValues(prev => ({ ...prev, payment_type: 'installments', installment_count: prev.installment_count > 1 ? prev.installment_count : 2 }))}
                  className={`p-4 text-start border transition-all ${
                    newRowValues.payment_type === 'installments'
                      ? 'border-[#D14E97] bg-[#D14E97]/10'
                      : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      newRowValues.payment_type === 'installments' ? 'border-[#D14E97]' : 'border-[var(--v2-text-muted)]'
                    }`}>
                      {newRowValues.payment_type === 'installments' && <div className="w-2 h-2 rounded-full bg-[#D14E97]" />}
                    </div>
                    <span className={`text-sm font-medium ${newRowValues.payment_type === 'installments' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                      {t('scheduling.modal.payment_installments')}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
                    {t('scheduling.modal.payment_installments_desc')}
                  </p>
                </button>
              </div>

              {/* Installment Details */}
              {newRowValues.payment_type === 'installments' && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                      {t('scheduling.modal.installment_count')}
                    </label>
                    <input
                      type="number"
                      min="2"
                      max="24"
                      value={newRowValues.installment_count}
                      onChange={(e) => setNewRowValues(prev => ({ ...prev, installment_count: Math.max(2, Math.min(24, parseInt(e.target.value) || 2)) }))}
                      className="w-full px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#D14E97] focus:ring-2 focus:ring-[#D14E97]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1.5">
                      {parseFloat(newRowValues.price) > 0 && newRowValues.installment_count >= 2
                        ? `${getCurrencySymbol(newRowValues.currency)}${(parseFloat(newRowValues.price) / newRowValues.installment_count).toFixed(2)} ${t('scheduling.modal.per_installment')}`
                        : ''
                      }
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                      {t('scheduling.modal.installment_frequency')}
                    </label>
                    <Select
                      value={newRowValues.installment_frequency}
                      onValueChange={(value) => setNewRowValues(prev => ({ ...prev, installment_frequency: value as InstallmentFrequency }))}
                    >
                      <SelectTrigger
                        className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:border-[#D14E97] focus:ring-[#D14E97]/20"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)]">
                        <SelectItem value="weekly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                          {t('scheduling.modal.frequency_weekly')}
                        </SelectItem>
                        <SelectItem value="biweekly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                          {t('scheduling.modal.frequency_biweekly')}
                        </SelectItem>
                        <SelectItem value="monthly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                          {t('scheduling.modal.frequency_monthly')}
                        </SelectItem>
                        <SelectItem value="quarterly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                          {t('scheduling.modal.frequency_quarterly')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* First Payment Due */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('scheduling.modal.first_payment_due')}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setNewRowValues(prev => ({ ...prev, first_payment_due: 'on_booking', first_payment_days: 0 }))}
                    className={`p-3 text-start border transition-all ${
                      newRowValues.first_payment_due === 'on_booking'
                        ? 'border-[#D14E97] bg-[#D14E97]/10'
                        : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <span className={`text-sm font-medium ${newRowValues.first_payment_due === 'on_booking' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                      {t('scheduling.modal.payment_on_booking')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRowValues(prev => ({ ...prev, first_payment_due: 'days_after', first_payment_days: prev.first_payment_days || 7 }))}
                    className={`p-3 text-start border transition-all ${
                      newRowValues.first_payment_due === 'days_after'
                        ? 'border-[#D14E97] bg-[#D14E97]/10'
                        : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <span className={`text-sm font-medium ${newRowValues.first_payment_due === 'days_after' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                      {t('scheduling.modal.payment_days_after')}
                    </span>
                  </button>
                </div>

                {newRowValues.first_payment_due === 'days_after' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={newRowValues.first_payment_days}
                      onChange={(e) => setNewRowValues(prev => ({ ...prev, first_payment_days: Math.max(1, Math.min(365, parseInt(e.target.value) || 1)) }))}
                      className="w-20 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#D14E97] focus:ring-2 focus:ring-[#D14E97]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                    <span className="text-sm text-[var(--v2-text-secondary)]">
                      {t('scheduling.modal.days_after_booking')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setNewRowPaymentDialogOpen(false)}
                className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {t('button.cancel')}
              </button>
              <button
                onClick={() => setNewRowPaymentDialogOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-all"
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  backgroundColor: CONFIG_COLOR
                }}
              >
                <Check className="h-4 w-4" />
                {t('button.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Row Payment Plan Dialog */}
      {editRowPaymentDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div
            ref={editRowPaymentDialogRef}
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-6 max-w-lg w-full mx-4 shadow-xl"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: `${CONFIG_COLOR}20` }}
                >
                  <CreditCard className="h-5 w-5" style={{ color: CONFIG_COLOR }} />
                </div>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                  {t('scheduling.modal.payment_options')}
                </h3>
              </div>
              <button
                onClick={() => setEditRowPaymentDialogOpen(false)}
                className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Payment Type Toggle */}
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setEditRowValues(prev => ({ ...prev, payment_type: 'full', installment_count: 1 }))}
                  className={`p-4 text-start border transition-all ${
                    editRowValues.payment_type === 'full'
                      ? 'border-[#D14E97] bg-[#D14E97]/10'
                      : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      editRowValues.payment_type === 'full' ? 'border-[#D14E97]' : 'border-[var(--v2-text-muted)]'
                    }`}>
                      {editRowValues.payment_type === 'full' && <div className="w-2 h-2 rounded-full bg-[#D14E97]" />}
                    </div>
                    <span className={`text-sm font-medium ${editRowValues.payment_type === 'full' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                      {t('scheduling.modal.payment_full')}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
                    {t('scheduling.modal.payment_full_desc')}
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setEditRowValues(prev => ({ ...prev, payment_type: 'installments', installment_count: prev.installment_count > 1 ? prev.installment_count : 2 }))}
                  className={`p-4 text-start border transition-all ${
                    editRowValues.payment_type === 'installments'
                      ? 'border-[#D14E97] bg-[#D14E97]/10'
                      : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      editRowValues.payment_type === 'installments' ? 'border-[#D14E97]' : 'border-[var(--v2-text-muted)]'
                    }`}>
                      {editRowValues.payment_type === 'installments' && <div className="w-2 h-2 rounded-full bg-[#D14E97]" />}
                    </div>
                    <span className={`text-sm font-medium ${editRowValues.payment_type === 'installments' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                      {t('scheduling.modal.payment_installments')}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--v2-text-muted)] mt-1.5 ms-6">
                    {t('scheduling.modal.payment_installments_desc')}
                  </p>
                </button>
              </div>

              {/* Installment Details */}
              {editRowValues.payment_type === 'installments' && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-[var(--v2-bg)] border border-[var(--v2-border)]" style={{ borderRadius: 'var(--v2-radius-button)' }}>
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                      {t('scheduling.modal.installment_count')}
                    </label>
                    <input
                      type="number"
                      min="2"
                      max="24"
                      value={editRowValues.installment_count}
                      onChange={(e) => setEditRowValues(prev => ({ ...prev, installment_count: Math.max(2, Math.min(24, parseInt(e.target.value) || 2)) }))}
                      className="w-full px-4 py-2.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#D14E97] focus:ring-2 focus:ring-[#D14E97]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                    <p className="text-xs text-[var(--v2-text-muted)] mt-1.5">
                      {parseFloat(editRowValues.price) > 0 && editRowValues.installment_count >= 2
                        ? `${getCurrencySymbol(editRowValues.currency)}${(parseFloat(editRowValues.price) / editRowValues.installment_count).toFixed(2)} ${t('scheduling.modal.per_installment')}`
                        : ''
                      }
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                      {t('scheduling.modal.installment_frequency')}
                    </label>
                    <Select
                      value={editRowValues.installment_frequency}
                      onValueChange={(value) => setEditRowValues(prev => ({ ...prev, installment_frequency: value as InstallmentFrequency }))}
                    >
                      <SelectTrigger
                        className="w-full bg-[var(--v2-surface)] border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:border-[#D14E97] focus:ring-[#D14E97]/20"
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)]">
                        <SelectItem value="weekly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                          {t('scheduling.modal.frequency_weekly')}
                        </SelectItem>
                        <SelectItem value="biweekly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                          {t('scheduling.modal.frequency_biweekly')}
                        </SelectItem>
                        <SelectItem value="monthly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                          {t('scheduling.modal.frequency_monthly')}
                        </SelectItem>
                        <SelectItem value="quarterly" className="text-[var(--v2-text-primary)] focus:bg-[#D14E97]/10 focus:text-[#D14E97]">
                          {t('scheduling.modal.frequency_quarterly')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* First Payment Due */}
              <div className="space-y-3">
                <label className="block text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('scheduling.modal.first_payment_due')}
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setEditRowValues(prev => ({ ...prev, first_payment_due: 'on_booking', first_payment_days: 0 }))}
                    className={`p-3 text-start border transition-all ${
                      editRowValues.first_payment_due === 'on_booking'
                        ? 'border-[#D14E97] bg-[#D14E97]/10'
                        : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <span className={`text-sm font-medium ${editRowValues.first_payment_due === 'on_booking' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                      {t('scheduling.modal.payment_on_booking')}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditRowValues(prev => ({ ...prev, first_payment_due: 'days_after', first_payment_days: prev.first_payment_days || 7 }))}
                    className={`p-3 text-start border transition-all ${
                      editRowValues.first_payment_due === 'days_after'
                        ? 'border-[#D14E97] bg-[#D14E97]/10'
                        : 'border-[var(--v2-border)] bg-[var(--v2-bg)] hover:border-[var(--v2-text-muted)]'
                    }`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <span className={`text-sm font-medium ${editRowValues.first_payment_due === 'days_after' ? 'text-[#D14E97]' : 'text-[var(--v2-text-primary)]'}`}>
                      {t('scheduling.modal.payment_days_after')}
                    </span>
                  </button>
                </div>

                {editRowValues.first_payment_due === 'days_after' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={editRowValues.first_payment_days}
                      onChange={(e) => setEditRowValues(prev => ({ ...prev, first_payment_days: Math.max(1, Math.min(365, parseInt(e.target.value) || 1)) }))}
                      className="w-20 px-3 py-2 bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] text-sm focus:outline-none focus:border-[#D14E97] focus:ring-2 focus:ring-[#D14E97]/20 transition-all"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    />
                    <span className="text-sm text-[var(--v2-text-secondary)]">
                      {t('scheduling.modal.days_after_booking')}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setEditRowPaymentDialogOpen(false)}
                className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {t('button.cancel')}
              </button>
              <button
                onClick={() => setEditRowPaymentDialogOpen(false)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white transition-all"
                style={{
                  borderRadius: 'var(--v2-radius-button)',
                  backgroundColor: CONFIG_COLOR
                }}
              >
                <Check className="h-4 w-4" />
                {t('button.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

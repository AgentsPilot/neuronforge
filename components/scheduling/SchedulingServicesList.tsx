'use client';

import { useState, useRef, useEffect } from 'react';
import { serviceShapeValues, collectionToPersist } from '@/lib/business-os/serviceEditValues';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, ChevronRight, Pause, Sparkles, Check, Loader2, Pencil, Trash2, AlertCircle, Tag, CreditCard, FileText, X, Plus, Power } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { createLogger } from '@/lib/logger';
import type { SchedulingService, PaymentType, InstallmentFrequency, FirstPaymentDue, ServiceCurrency, ServiceCollection, ServiceSaleMode } from '@/lib/repositories/SchedulingRepository';
import { ClientJourneyStrip } from '@/components/business-os/setup/ClientJourneyStrip';

const logger = createLogger({ module: 'SchedulingServicesList' });

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
  /**
   * The business collects an intake form after a booking.
   *
   * Passed in rather than fetched here: the dialog that owns this list already
   * knows, and a list does not need a network call to draw a row.
   */
  intakeEnabled?: boolean;
  /**
   * A card can actually be charged right now.
   *
   * Passed in for the same reason as `intakeEnabled` — the dialog that owns
   * this list already knows. Defaults to false rather than true: the journey
   * strip draws a payment step from this, and showing the owner a step their
   * clients cannot complete is the failure worth avoiding. An owner who HAS
   * connected Stripe sees it appear as soon as the caller says so.
   */
  processorReady?: boolean;
}


/**
 * Column widths, declared once.
 *
 * The list scrolls and the new-service line is pinned beneath it, which makes
 * them two separate <table> elements — and two tables only look like one if
 * their columns are pinned to the same widths. `table-fixed` plus a shared
 * colgroup is what keeps the pinned line's fields under the headers they
 * belong to.
 */
const COLUMN_WIDTHS = ['19%', '13%', '12%', '14%', '12%', '12%', '8%', '10%'] as const;

export function SchedulingServicesList({ services, onServiceClick, onServicePublished, onServicePublishedWithId, onSilentRefresh, showAddButton = false, autoStartNewRow, newRowPrefill, onAutoStartConsumed, onServiceCreatedFromChat, autoEditServiceId, onAutoEditConsumed, onServiceEdited, intakeEnabled = false, processorReady = false }: SchedulingServicesListProps) {
  const { t, formatCurrency, currencyCode } = useLanguage();
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [recentlyEditedId, setRecentlyEditedId] = useState<string | null>(null); // Track recently edited service for highlight animation
  // Row editing state - stores all editable values for a row
  const [editingRowId, setEditingRowId] = useState<string | null>(null);

  /**
   * Which rows have their client journey open.
   *
   * The journey used to render under every service, always — nine columns of
   * settings and a strip of what they add up to, for every row at once. Folded
   * away by default the table is half as tall, and the journey becomes
   * something you ask for about one service rather than something you scroll
   * past for all of them.
   *
   * A Set, not a single id: opening one service does not close another, so two
   * can be compared. Collapsed is the default for every row — including a row
   * that was just added, which lands in the table already understood.
   */
  const [openJourneyIds, setOpenJourneyIds] = useState<Set<string>>(new Set());

  const toggleJourney = (serviceId: string) => {
    setOpenJourneyIds(prev => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  };
  const [editRowValues, setEditRowValues] = useState<{
    name: string;
    /**
     * The one-line description, edited in place.
     *
     * It used to be a button that opened a dialog of its own — a second surface
     * for one text field, in a panel that has room for it. The dialog survives
     * only for the case that opens it by itself: publishing a service that has
     * no description yet.
     */
    description: string;
    duration: string;
    buffer: string;
    price: string;
    currency: ServiceCurrency;
    is_scheduled: boolean;
    collection: ServiceCollection;
    sale_mode: ServiceSaleMode;
    payment_type: PaymentType;
    installment_count: number;
    installment_frequency: InstallmentFrequency;
    first_payment_due: FirstPaymentDue;
    first_payment_days: number;
  }>({
    name: '',
    description: '',
    duration: '',
    buffer: '',
    price: '',
    currency: 'ILS',
    is_scheduled: true,
    collection: 'invoice' as ServiceCollection,
    sale_mode: 'direct' as ServiceSaleMode,
    payment_type: 'full',
    installment_count: 1,
    installment_frequency: 'monthly',
    first_payment_due: 'on_booking',
    first_payment_days: 0
  });
  const [savingRow, setSavingRow] = useState(false);

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
    description: '',
    duration: '60',
    buffer: '0',
    price: '0',
    currency: 'ILS' as ServiceCurrency,
    is_scheduled: true,
    collection: 'invoice' as ServiceCollection,
    sale_mode: 'direct' as ServiceSaleMode,
    payment_type: 'full' as PaymentType,
    installment_count: 1,
    installment_frequency: 'monthly' as InstallmentFrequency,
    first_payment_due: 'on_booking' as FirstPaymentDue,
    first_payment_days: 0
  });
  const [savingNewRow, setSavingNewRow] = useState(false);
  const [newRowFromChat, setNewRowFromChat] = useState(false); // Track if new row was started from chat
  // Optimistic updates - local overrides for immediate UI feedback
  const [optimisticUpdates, setOptimisticUpdates] = useState<Record<string, Partial<SchedulingService>>>({});
  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<{ serviceId: string; serviceName: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<{ message: string; bookingCount?: number } | null>(null);
  // Toggle active state
  const [togglingId, setTogglingId] = useState<string | null>(null);
  // Which service's journey is mid-save, so its pills stop accepting presses.
  const [journeySavingId, setJourneySavingId] = useState<string | null>(null);

  // Description mini-dialog state
  const [descriptionDialogId, setDescriptionDialogId] = useState<string | null>(null);
  /** Set when the dialog was opened by a publish that could not go ahead. */
  const [descriptionRequiredFor, setDescriptionRequiredFor] = useState<string | null>(null);
  const [descriptionValue, setDescriptionValue] = useState('');
  const [savingDescription, setSavingDescription] = useState(false);
  const descriptionDialogRef = useRef<HTMLDivElement>(null);

  // Payment plan popup state

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

      // The description dialog is the only one left: it opens by itself when a
      // service is published without one. The three payment modals it used to
      // sit beside are gone — the plan is edited in the panel now.
      if (descriptionDialogRef.current && !descriptionDialogRef.current.contains(target)) {
        setDescriptionDialogId(null);
        setDescriptionRequiredFor(null);
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
        description: newRowPrefill?.description || '',
        duration: (newRowPrefill?.duration_minutes || 60).toString(),
        buffer: (newRowPrefill?.buffer_minutes || 0).toString(),
        price: (newRowPrefill?.price || 0).toString(),
        currency: (newRowPrefill?.currency as ServiceCurrency) || defaultCurrency,
        is_scheduled: true,
        collection: 'invoice' as ServiceCollection,
        sale_mode: 'direct' as ServiceSaleMode,
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
          description: optimisticUpdates[serviceToEdit.id]?.description ?? serviceToEdit.description ?? '',
          duration: serviceToEdit.duration_minutes?.toString() || '60',
          buffer: serviceToEdit.buffer_minutes?.toString() || '0',
          price: serviceToEdit.price?.toString() || '0',
          currency: serviceToEdit.currency || 'ILS',
          // The same rule as `startRowEdit`, from the same tested helper.
          ...serviceShapeValues(serviceToEdit),
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

    // A published service is one a client can be shown, and the website writes
    // its section from this description. Publishing without one puts a
    // paragraph the model guessed from the service's name in front of clients,
    // so the description is asked for here rather than repaired afterwards.
    //
    // At publish rather than at save: the onboarding chat creates drafts fast
    // and on purpose, and stopping to write copy there is exactly the friction
    // that flow exists to avoid.
    const service = services.find(item => item.id === serviceId);
    const description = (optimisticUpdates[serviceId]?.description ?? service?.description ?? '').trim();
    if (!description) {
      setDescriptionValue(service?.description || '');
      setDescriptionDialogId(serviceId);
      setDescriptionRequiredFor(serviceId);
      return;
    }

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

  /**
   * Change the journey by pressing it.
   *
   * The two facts the strip draws — does the client pick a time, and does the
   * money arrive online — are the same two columns above it, so this saves
   * exactly what the row edit would have saved. It exists because the shortest
   * way to say "no, they should not pay online" is to press the step that says
   * they will, rather than to open the row editor and find the right control.
   *
   * Optimistic like the active toggle, and reverted the same way: the strip
   * redraws on the press, and puts itself back if the write fails.
   */
  const saveJourneyPatch = async (
    service: SchedulingService,
    patch: { scheduled?: boolean; collection?: ServiceCollection }
  ) => {
    if (journeySavingId) return;

    const update: Partial<SchedulingService> = {};
    if (patch.scheduled !== undefined) update.is_scheduled = patch.scheduled;
    if (patch.collection !== undefined) update.collection = patch.collection;
    if (Object.keys(update).length === 0) return;

    setJourneySavingId(service.id);
    setOptimisticUpdates(prev => ({ ...prev, [service.id]: { ...prev[service.id], ...update } }));

    try {
      const response = await fetch(`/api/scheduling/services/${service.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(update),
      });

      if (!response.ok) throw new Error(`PATCH responded ${response.status}`);
      onSilentRefresh?.();
    } catch (err) {
      // Put the strip back to what the server still believes.
      setOptimisticUpdates(prev => {
        const next = { ...prev };
        delete next[service.id];
        return next;
      });
      logger.error({ err, serviceId: service.id }, 'Failed to save journey change');
    } finally {
      setJourneySavingId(null);
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


  // New row handlers
  const startAddNewRow = () => {
    setIsAddingNewRow(true);
    setNewRowValues({
      name: '',
      description: '',
      duration: '60',
      buffer: '0',
      price: '0',
      currency: getValidCurrency(currencyCode),
      is_scheduled: true,
      collection: 'invoice' as ServiceCollection,
      sale_mode: 'direct' as ServiceSaleMode,
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
      description: '',
      duration: '60',
      buffer: '0',
      price: '0',
      currency: getValidCurrency(currencyCode),
      is_scheduled: true,
      collection: 'invoice' as ServiceCollection,
      sale_mode: 'direct' as ServiceSaleMode,
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
          description: newRowValues.description.trim() || null,
          duration_minutes: newRowValues.duration.trim() !== '' ? (parseInt(newRowValues.duration) || null) : null,
          is_scheduled: newRowValues.is_scheduled,
          sale_mode: newRowValues.sale_mode,
          // A quoted service publishes no collection — the price, and so the
          // method, belong to a proposal that does not exist yet.
          collection: newRowValues.sale_mode === 'proposal'
            ? null
            : (parseFloat(newRowValues.price) > 0 ? newRowValues.collection : null),
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
          description: '',
          duration: '60',
          buffer: '0',
          price: '0',
          currency: getValidCurrency(currencyCode),
          is_scheduled: true,
          collection: 'invoice' as ServiceCollection,
          sale_mode: 'direct' as ServiceSaleMode,
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
      // The optimistic copy wins: a description saved a moment ago from the
      // publish prompt is the one the owner just wrote.
      description: optimisticUpdates[service.id]?.description ?? service.description ?? '',
      duration: service.duration_minutes?.toString() || '60',
      buffer: service.buffer_minutes?.toString() || '0',
      price: service.price?.toString() || '0',
      currency: getValidCurrency(service.currency),
      // READ THE SERVICE. These two were hardcoded, and `saveRowEdit` writes
      // them back — so editing a name, a duration or a price on a card-collected
      // service silently converted it to invoiced, and turned a product back
      // into an appointment. The rule lives in `serviceEditValues` so it can be
      // tested; a fallback and an override look identical in an object literal.
      ...serviceShapeValues(service),
      payment_type: service.payment_type || 'full',
      installment_count: service.installment_count || 1,
      installment_frequency: service.installment_frequency || 'monthly',
      first_payment_due: service.first_payment_due || 'on_booking',
      first_payment_days: service.first_payment_days || 0
    });
  };

  const cancelRowEdit = () => {
    setEditingRowId(null);
    setEditRowValues({
      name: '',
      description: '',
      duration: '',
      buffer: '',
      price: '',
      currency: 'ILS',
      is_scheduled: true,
      collection: 'invoice' as ServiceCollection,
      sale_mode: 'direct' as ServiceSaleMode,
      payment_type: 'full',
      installment_count: 1,
      installment_frequency: 'monthly',
      first_payment_due: 'on_booking',
      first_payment_days: 0
    });
  };

  /*
   * What the row's other columns are allowed to say, given how it is sold.
   *
   * A quoted service has no price — that is decided per job, in the proposal —
   * so price, collection and payment plan describe money that does not exist
   * yet. Leaving them editable invites an owner to set a price that no public
   * surface will ever show, and then wonder why.
   *
   * The columns stay in place rather than disappearing: a row whose cells move
   * as you change a toggle is harder to read than one whose cells grey out.
   */
  const rowMoneyDisabled = editRowValues.sale_mode === 'proposal';
  /** The same two rules for the new-service line, which has its own state. */
  const newMoneyDisabled = newRowValues.sale_mode === 'proposal';
  const newTimeDisabled = !newRowValues.is_scheduled;
  /** A service nobody books against a slot has no length to run for. */
  const rowTimeDisabled = !editRowValues.is_scheduled;

  const saveRowEdit = async (serviceId: string) => {
    if (savingRow) return;

    const priced = editRowValues.price !== '' && parseFloat(editRowValues.price) > 0;

    const updateData = {
      service_name: editRowValues.name,
      description: editRowValues.description.trim() || null,
      // A product is not booked against a time, and a free service is not
      // collected at all — storing either would describe something that never
      // happens to a client.
      duration_minutes: editRowValues.duration.trim() !== '' ? (parseInt(editRowValues.duration) || null) : null,
      is_scheduled: editRowValues.is_scheduled,
      sale_mode: editRowValues.sale_mode,
      /*
       * A quoted service publishes no collection: the price, and therefore the
       * method, belong to the proposal that has not been written yet.
       */
      collection: editRowValues.sale_mode === 'proposal'
        ? null
        : collectionToPersist(editRowValues.collection, priced ? 1 : 0),
      buffer_minutes: parseInt(editRowValues.buffer) || 0,
      price: editRowValues.price !== '' ? parseFloat(editRowValues.price) : null,
      currency: editRowValues.currency,
      payment_type: editRowValues.payment_type,
      installment_count: editRowValues.installment_count,
      installment_frequency: editRowValues.installment_frequency,
      first_payment_due: editRowValues.first_payment_due,
      first_payment_days: editRowValues.first_payment_days,
      status: 'draft' as const // Set to draft on edit - requires explicit publish
    };

    // Optimistic update
    setOptimisticUpdates(prev => ({
      ...prev,
      [serviceId]: { ...prev[serviceId], ...updateData }
    }));

    /*
     * The service stays open.
     *
     * Saving used to close the panel and empty the form — which read as "done",
     * when saving is only half of it: an edited service goes back to DRAFT and
     * reaches nobody until it is published. Closing the panel took away the
     * publish button at the exact moment it mattered, and the owner walked away
     * believing clients could see the change.
     *
     * So the panel keeps the service, `recentlyEditedId` pulses Publish, and a
     * line above the fields says what is still missing.
     */

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
        logger.error(
          { status: response.status, serviceId, errorData, updateData, validation: errorData.details },
          'Service update failed'
        );
        setOptimisticUpdates(prev => {
          const updated = { ...prev };
          delete updated[serviceId];
          return updated;
        });
        onSilentRefresh?.();
      }
    }).catch((err) => {
      logger.error({ err, serviceId }, 'Service update error');
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

  /**
   * The service that is open in the panel.
   *
   * Selection and editing are the same act now. There is no row that turns
   * into inputs and back, so `editingRowId` IS the selection — a service is
   * either open in the panel, being edited, or it is not open at all.
   */
  const selectedService = editingRowId
    ? services.find(s => s.id === editingRowId) ?? null
    : null;

  /**
   * One service, as three questions and their consequence.
   *
   * `null` means the new one being added, which asks exactly the same questions
   * against `newRowValues` instead of `editRowValues`. Writing it once is the
   * point: the old table had the new-service line as a second copy of the edit
   * row in a second <table>, and the two drifted.
   */
  const renderServicePanel = (service: SchedulingService | null) => {
    const isNew = service === null;
    const values = isNew ? newRowValues : editRowValues;
    const setValues = (isNew ? setNewRowValues : setEditRowValues) as React.Dispatch<
      React.SetStateAction<typeof values>
    >;
    const saving = isNew ? savingNewRow : savingRow;

    // The same two derivations the table row made, kept verbatim: a quoted
    // service has no price of its own, and an unscheduled one has no length.
    const moneyDisabled = values.sale_mode === 'proposal';
    const timeDisabled = values.is_scheduled === false;
    const price = parseFloat(values.price);

    const effective = service ? { ...service, ...(optimisticUpdates[service.id] || {}) } : null;
    const isDraft = effective ? effective.status === 'draft' : true;

    /*
     * No width here.
     *
     * This carried `w-full`, and a `w-28` added at the call site does not beat
     * it — both are single-class utilities, so the winner is whichever Tailwind
     * emits later in the stylesheet, which is `w-full`. Every "narrower" field
     * in this panel was silently full width, however small the number it held.
     *
     * Width belongs to the field, so each one states its own.
     */
    const field = 'px-3 py-2 text-sm bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:border-transparent';
    const fieldStyle = { borderRadius: 'var(--v2-radius-button)', ['--tw-ring-color' as string]: CONFIG_COLOR };

    /**
     * A choice of two, drawn as a segment rather than as two buttons.
     *
     * The pair is one control with one answer, and a pill-inside-a-pill says so
     * — the selected half lifts onto the surface, the other stays on the track.
     * Two separately-bordered buttons read as two independent switches, which
     * is what the old table row had and what made "אופן מכירה" and "דורש תור?"
     * look like unrelated settings that happened to be adjacent.
     */
    const segment = (
      options: { value: string; label: string; active: boolean; onClick: () => void }[]
    ) => (
      <div
        role="group"
        className="inline-flex p-0.5 border border-[var(--v2-border)] bg-[var(--v2-bg)] self-start"
        style={{ borderRadius: '999px' }}
      >
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            onClick={option.onClick}
            aria-pressed={option.active}
            className={`px-3.5 py-1.5 text-[12.5px] transition-colors ${
              option.active
                ? 'bg-[var(--v2-surface)] text-[var(--v2-text-primary)] font-medium shadow-sm'
                : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
            }`}
            style={{ borderRadius: '999px' }}
          >
            {option.label}
          </button>
        ))}
      </div>
    );

    return (
      <>
        {/* Header: what this is, and what can be done to it. The four actions
            used to be hover-revealed buttons sharing a 9% cell with the status
            badge — they landed on top of it, and Publish could not be clicked
            reliably. Here they have room and are visible without hovering. */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-[var(--v2-border)] flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[var(--v2-text-primary)] truncate">
              {isNew
                ? t('scheduling.new_service') || 'Add a service'
                : values.name || effective?.service_name}
            </h3>
            {/* Published · active · saved a moment ago — one line, because
                the three are one answer to "where does this stand". A single
                word could only ever say one of them. */}
            <p className="text-[12px] text-[var(--v2-text-secondary)] mt-0.5">
              {isNew
                ? t('config.services.new_hint')
                : [
                    isDraft ? t('scheduling.service.draft') : t('config.services.published'),
                    effective?.is_active
                      ? t('scheduling.service.active')
                      : t('scheduling.service.inactive'),
                    recentlyEditedId === service?.id ? t('config.services.saved_just_now') : null,
                  ].filter(Boolean).join(' · ')}
            </p>
          </div>

          <div className="flex items-center gap-1.5 ms-auto flex-shrink-0">
            {!isNew && service && (
              <>
                {isDraft && (
                  <button
                    onClick={(e) => handlePublish(service.id, e)}
                    disabled={publishingId === service.id}
                    title={t('scheduling.service.publish')}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#14B8A6] bg-[#14B8A6]/10 hover:bg-[#14B8A6]/20 transition-all disabled:opacity-50 ${recentlyEditedId === service.id ? 'publish-pulse' : ''}`}
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    {publishingId === service.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Check className="h-3.5 w-3.5" />}
                    {t('scheduling.service.publish')}
                  </button>
                )}
                <button
                  onClick={(e) => handleToggleActive(e, service)}
                  disabled={togglingId === service.id}
                  title={effective?.is_active ? t('scheduling.service.deactivate') : t('scheduling.service.activate')}
                  aria-label={effective?.is_active ? t('scheduling.service.deactivate') : t('scheduling.service.activate')}
                  className="p-1.5 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all disabled:opacity-50"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {togglingId === service.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : effective?.is_active ? <Pause className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                </button>
                <button
                  onClick={(e) => handleDeleteClick(e, service)}
                  title={t('button.delete')}
                  aria-label={t('button.delete')}
                  className="p-1.5 text-[var(--v2-text-muted)] hover:text-red-500 hover:bg-red-500/10 transition-all"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* The three questions */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-4 flex flex-col gap-5">

          {/* Saved is not live.
              An edited service returns to draft, so the owner has done half of
              the act and the half that reaches clients is still waiting. Said
              here, next to the button that finishes it. */}
          {!isNew && service && recentlyEditedId === service.id && isDraft && (
            <div
              className="flex items-start gap-2.5 px-3.5 py-3 text-[12.5px]"
              style={{
                borderRadius: 'var(--v2-radius-button)',
                backgroundColor: 'rgba(245, 158, 11, 0.10)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                color: 'var(--v2-text-primary)',
              }}
              role="status"
            >
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-px text-amber-500" />
              <span>{t('config.services.saved_publish_prompt')}</span>
            </div>
          )}

          <section>
            <h4 className="text-[13.5px] font-semibold text-[var(--v2-text-primary)]">
              {t('config.services.q.what')}
            </h4>
            <p className="text-[12px] text-[var(--v2-text-muted)] mt-0.5 mb-3">
              {t('config.services.q.what_hint')}
            </p>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-[var(--v2-text-secondary)]">
                  {t('config.services.column.service')}
                </span>
                <input
                  type="text"
                  value={values.name}
                  onChange={(e) => setValues(prev => ({ ...prev, name: e.target.value }))}
                  className={`${field} w-full`}
                  style={fieldStyle}
                  autoFocus
                />
              </label>

              {/* In place. This was a button that opened a dialog for one text
                  field; the panel has room for the field itself. The dialog is
                  still there for the case that opens it by itself — publishing
                  a service that has no description yet. */}
              <label className="flex flex-col gap-1.5">
                <span className="text-[12px] text-[var(--v2-text-secondary)]">
                  {t('config.services.short_description')}
                </span>
                {/* A textarea, because a description is prose. A single-line
                    input hid everything past the first line behind a cursor,
                    for the one field on this panel whose whole job is to be
                    read. `resize-y` so an owner who writes more can see more. */}
                <textarea
                  value={values.description}
                  onChange={(e) => setValues(prev => ({ ...prev, description: e.target.value }))}
                  placeholder={t('config.services.short_description_placeholder')}
                  rows={3}
                  className={`${field} w-full resize-y leading-relaxed`}
                  style={fieldStyle}
                />
              </label>
            </div>
          </section>

          <section className="border-t border-[var(--v2-border)] pt-4">
            <h4 className="text-[13.5px] font-semibold text-[var(--v2-text-primary)]">
              {t('config.services.q.sold')}
            </h4>
            <p className="text-[12px] text-[var(--v2-text-muted)] mt-0.5 mb-3">
              {t('config.services.q.sold_hint')}
            </p>
            {/* One line, in order: what kind of sale, then whether it needs a
                slot, then — only if it does — how long it runs. */}
            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-[var(--v2-text-secondary)]">
                  {t('config.services.column.sale_mode')}
                </span>
                {segment([
                  {
                    value: 'direct',
                    label: t('config.services.sale_mode.direct'),
                    active: values.sale_mode === 'direct',
                    onClick: () => setValues(prev => ({ ...prev, sale_mode: 'direct' })),
                  },
                  {
                    value: 'proposal',
                    label: t('config.services.sale_mode.proposal'),
                    active: values.sale_mode === 'proposal',
                    onClick: () => setValues(prev => ({ ...prev, sale_mode: 'proposal' })),
                  },
                ])}
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[12px] text-[var(--v2-text-secondary)]">
                  {t('config.services.column.needs_time')}
                </span>
                {segment([
                  {
                    value: 'yes',
                    label: t('config.services.needs_time.yes'),
                    active: values.is_scheduled === true,
                    onClick: () => setValues(prev => ({ ...prev, is_scheduled: true })),
                  },
                  {
                    value: 'no',
                    label: t('config.services.needs_time.no'),
                    active: values.is_scheduled === false,
                    onClick: () => setValues(prev => ({ ...prev, is_scheduled: false })),
                  },
                ])}
              </div>

              {/* Absent, not disabled.
                  A service nobody books against a slot has no length and no gap
                  after it — those are facts about an appointment. Two greyed
                  fields showing "—" put a question on screen that has already
                  been answered, and invited the owner to wonder what they had
                  done wrong. Answer "לא" and they simply are not asked.

                  The values behind them are untouched: turning scheduling back
                  on brings the same numbers back rather than defaults. */}
              {!timeDisabled && (
                <>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[12px] text-[var(--v2-text-secondary)]">
                      {t('config.services.column.duration')}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={values.duration}
                        onChange={(e) => setValues(prev => ({ ...prev, duration: e.target.value }))}
                        className={`${field} w-20 tabular-nums`}
                        style={fieldStyle}
                      />
                      <span className="text-[12px] text-[var(--v2-text-muted)]">
                        {t('scheduling.service.minutes')}
                      </span>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-[12px] text-[var(--v2-text-secondary)]">
                      {t('scheduling.service.min_buffer')}
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={values.buffer}
                        onChange={(e) => setValues(prev => ({ ...prev, buffer: e.target.value }))}
                        className={`${field} w-20 tabular-nums`}
                        style={fieldStyle}
                      />
                      <span className="text-[12px] text-[var(--v2-text-muted)]">
                        {t('scheduling.service.minutes')}
                      </span>
                    </div>
                  </label>
                </>
              )}
            </div>
          </section>

          <section className="border-t border-[var(--v2-border)] pt-4">
            <h4 className="text-[13.5px] font-semibold text-[var(--v2-text-primary)]">
              {t('config.services.q.paid')}
            </h4>
            <p className="text-[12px] text-[var(--v2-text-muted)] mt-0.5 mb-3">
              {t('config.services.q.paid_hint')}
            </p>

            {moneyDisabled ? (
              /* Quoted: the amount and how it arrives are settled in the
                 proposal, per job. Saying so beats three disabled controls. */
              <p className="text-[12.5px] text-[var(--v2-text-muted)]">
                {t('config.services.sale_mode.by_proposal')}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* The price is the number being decided; the currency is
                    picked once and rarely changed. The old row gave the two
                    equal room and then some — a 56px dropdown beside a 56px
                    number field — so the amount, which is the point, was the
                    smallest thing in the group.

                    Four currencies is a choice, not a list to open: shown as
                    the same segment the questions above use, so picking one is
                    a single click instead of open-scan-select. */}
                <label className="flex flex-col gap-1.5 sm:col-span-2">
                  <span className="text-[12px] text-[var(--v2-text-secondary)]">
                    {t('config.services.column.price')}
                  </span>
                  {/* One line: how much, in what, and when it is taken.
                      They are one sentence about the money — splitting "מתי
                      נגבה" onto a row of its own made it read as a separate
                      setting rather than as the end of the price. */}
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <input
                      type="number"
                      value={values.price}
                      onChange={(e) => setValues(prev => ({ ...prev, price: e.target.value }))}
                      // Sized to the number it holds, not to the row it sits
                      // in. `flex-1` made it swallow whatever the currency and
                      // the collection segment left over — a field for four
                      // digits stretched across half the panel.
                      className={`${field} w-32 text-[15px] py-2.5 tabular-nums`}
                      style={fieldStyle}
                    />
                    {segment(
                      ([
                        ['ILS', '₪'],
                        ['USD', '$'],
                        ['EUR', '€'],
                        ['GBP', '£'],
                      ] as const).map(([code, symbol]) => ({
                        value: code,
                        label: symbol,
                        active: values.currency === code,
                        onClick: () => setValues(prev => ({ ...prev, currency: code as ServiceCurrency })),
                      }))
                    )}

                    {/* Nothing to collect when nothing is charged, so the
                        question simply does not appear. */}
                    {price > 0 && (
                      <span className="flex items-center gap-2">
                        <span className="text-[12px] text-[var(--v2-text-secondary)] whitespace-nowrap">
                          {t('config.services.when_collected')}
                        </span>
                        {segment([
                          {
                            value: 'online',
                            label: t('config.services.collection.online'),
                            active: values.collection === 'online',
                            onClick: () => setValues(prev => ({ ...prev, collection: 'online' })),
                          },
                          {
                            value: 'invoice',
                            label: t('config.services.collection.invoice'),
                            active: values.collection === 'invoice',
                            onClick: () => setValues(prev => ({ ...prev, collection: 'invoice' })),
                          },
                        ])}
                      </span>
                    )}
                  </div>
                </label>

                {/* The plan, in place.
                    This was a button that opened a modal holding four fields —
                    for a question that belongs directly under the price it
                    splits. The extra fields appear only when there is a plan to
                    describe, so a service paid in one go still shows one line. */}
                <div className="flex flex-col gap-2.5 sm:col-span-2">
                  <span className="text-[12px] text-[var(--v2-text-secondary)]">
                    {t('config.services.column.payment')}
                  </span>

                  {price > 0 ? (
                    <>
                      {segment([
                        {
                          value: 'full',
                          label: t('scheduling.modal.payment_full'),
                          active: values.payment_type !== 'installments',
                          onClick: () => setValues(prev => ({
                            ...prev, payment_type: 'full', installment_count: 1,
                          })),
                        },
                        {
                          value: 'installments',
                          label: t('scheduling.modal.payment_installments'),
                          active: values.payment_type === 'installments',
                          onClick: () => setValues(prev => ({
                            ...prev,
                            payment_type: 'installments',
                            installment_count: prev.installment_count > 1 ? prev.installment_count : 2,
                          })),
                        },
                      ])}

                      {values.payment_type === 'installments' && (
                        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 ps-0.5">
                          {/* One line, read in order: how many, how often, and
                              when the first one is taken. They describe a single
                              arrangement, so they sit together rather than being
                              spread to the edges of the panel. */}
                          <label className="flex flex-col gap-1.5">
                            <span className="text-[12px] text-[var(--v2-text-secondary)]">
                              {t('scheduling.modal.installment_count')}
                            </span>
                            <div className="flex items-center gap-2">
                              {/* Two digits at most — 24 is the ceiling — so the
                                  field is sized for two, leaving the split
                                  beside it room to stay on one line. */}
                              <input
                                type="number"
                                min={2}
                                max={24}
                                value={values.installment_count}
                                onChange={(e) => setValues(prev => ({
                                  ...prev,
                                  installment_count: Math.max(2, Math.min(24, parseInt(e.target.value) || 2)),
                                }))}
                                className={`${field} w-14 tabular-nums`}
                                style={fieldStyle}
                              />
                              {/* What one period actually costs. The owner is
                                  splitting a total; the split is the answer. */}
                              <span className="text-[12px] text-[var(--v2-text-muted)] tabular-nums whitespace-nowrap">
                                {values.installment_count >= 2
                                  ? `${getCurrencySymbol(values.currency)}${(price / values.installment_count).toFixed(2)} ${t('scheduling.modal.per_installment')}`
                                  : ''}
                              </span>
                            </div>
                          </label>
                          <label className="flex flex-col gap-1.5">
                            <span className="text-[12px] text-[var(--v2-text-secondary)]">
                              {t('scheduling.modal.installment_frequency')}
                            </span>
                            <Select
                              value={values.installment_frequency}
                              onValueChange={(value) => setValues(prev => ({
                                ...prev, installment_frequency: value as InstallmentFrequency,
                              }))}
                            >
                              <SelectTrigger
                                className="h-9 px-3 text-[13px] bg-[var(--v2-bg)] border-[var(--v2-border)] text-[var(--v2-text-primary)]"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="bg-[var(--v2-surface)] border-[var(--v2-border)]">
                                <SelectItem value="weekly" className="text-[var(--v2-text-primary)]">{t('scheduling.modal.frequency_weekly')}</SelectItem>
                                <SelectItem value="biweekly" className="text-[var(--v2-text-primary)]">{t('scheduling.modal.frequency_biweekly')}</SelectItem>
                                <SelectItem value="monthly" className="text-[var(--v2-text-primary)]">{t('scheduling.modal.frequency_monthly')}</SelectItem>
                                <SelectItem value="quarterly" className="text-[var(--v2-text-primary)]">{t('scheduling.modal.frequency_quarterly')}</SelectItem>
                              </SelectContent>
                            </Select>
                          </label>

                          <div className="flex flex-col gap-1.5">
                            <span className="text-[12px] text-[var(--v2-text-secondary)]">
                              {t('scheduling.modal.first_payment_due')}
                            </span>
                            <div className="flex items-center gap-2 flex-wrap">
                              {segment([
                                {
                                  value: 'on_booking',
                                  label: t('scheduling.modal.payment_on_booking'),
                                  active: values.first_payment_due === 'on_booking',
                                  onClick: () => setValues(prev => ({
                                    ...prev, first_payment_due: 'on_booking', first_payment_days: 0,
                                  })),
                                },
                                {
                                  value: 'days_after',
                                  label: t('scheduling.modal.payment_days_after'),
                                  active: values.first_payment_due === 'days_after',
                                  onClick: () => setValues(prev => ({
                                    ...prev,
                                    first_payment_due: 'days_after',
                                    first_payment_days: prev.first_payment_days || 7,
                                  })),
                                },
                              ])}
                              {values.first_payment_due === 'days_after' && (
                                <div className="flex items-center gap-2">
                                  <input
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={values.first_payment_days}
                                    onChange={(e) => setValues(prev => ({
                                      ...prev,
                                      first_payment_days: Math.max(1, Math.min(365, parseInt(e.target.value) || 1)),
                                    }))}
                                    className={`${field} w-20`}
                                    style={fieldStyle}
                                  />
                                  <span className="text-[12px] text-[var(--v2-text-muted)]">
                                    {t('scheduling.modal.days_after_booking')}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-[12.5px] text-[var(--v2-text-muted)]">
                      {t('journey.pay.free')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>

        {/* The consequence, on screen with the settings that produce it.
            This was folded behind a chevron, which is how a business discovered
            its booking link led nowhere — from a client's email. Turn off
            "needs a time" above and the date step disappears while you watch. */}
        <div className="flex-shrink-0 border-t border-[var(--v2-border)] bg-[var(--v2-bg)] px-5 py-3">
          <span className="block text-[10.5px] font-semibold tracking-wide uppercase text-[var(--v2-text-muted)] mb-2">
            {t('journey.label')}
          </span>
          <ClientJourneyStrip
            compact
            intakeEnabled={intakeEnabled}
            processorReady={processorReady}
            service={{
              scheduled: values.is_scheduled !== false,
              collection: (values.collection as ServiceCollection | null) ?? null,
              price: moneyDisabled ? null : (Number.isFinite(price) ? price : null),
              saleMode: (values.sale_mode as ServiceSaleMode | null) ?? 'direct',
            }}
          />
        </div>

        {/* Save and cancel */}
        <div className="flex-shrink-0 border-t border-[var(--v2-border)] px-5 py-3 flex items-center justify-end gap-2">
          <button
            onClick={isNew ? cancelNewRow : cancelRowEdit}
            className="px-3.5 py-2 text-[13px] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {t('button.cancel')}
          </button>
          <button
            onClick={() => (isNew ? saveNewRow() : saveRowEdit(service!.id))}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium text-white transition-all disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)', backgroundColor: CONFIG_COLOR }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            {t('button.save')}
          </button>
        </div>
      </>
    );
  };

  return (
    // A column, so the table can take the free space and the new-service line
    // can be pinned beneath it rather than scrolling away with the list.
    <div className="flex flex-col min-h-0 flex-1 gap-4">
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
      {/* The action, above the list.
          It used to sit under the table, which put it below the fold for any
          business with more than a screenful of services — and moved further
          away with every service they added. */}
      {showAddButton && !isAddingNewRow && services.length > 0 && (
        <div className="flex-shrink-0 flex justify-end mb-3">
          <button
            onClick={startAddNewRow}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium border border-dashed transition-all"
            style={{
              borderRadius: 'var(--v2-radius-button)',
              // The tab's own colour. Orange belonged to nothing in this dialog.
              color: CONFIG_COLOR,
              borderColor: `${CONFIG_COLOR}70`,
              backgroundColor: `${CONFIG_COLOR}08`,
            }}
          >
            <Plus className="h-4 w-4" />
            {t('scheduling.new_service') || 'Add a service'}
          </button>
        </div>
      )}

      {/* ── Two panes ──────────────────────────────────────────────────────
          The list carries identity; the panel carries meaning.

          This was an eight-column table — שירות · אופן מכירה · דורש תור? · משך ·
          מחיר · איך משלמים · תוכנית תשלום · סטטוס — inside a dialog about 700px
          wide, with every cell at its minimum and editing done IN the cells. A
          number input and its unit could not sit side by side without wrapping.

          Three of those columns are one question. Sale mode, "needs a time" and
          how the money arrives together decide what the client actually walks
          through, and they sat far apart with the price wedged between them —
          while the thing they add up to was folded away behind a chevron.

          So: the list keeps only what tells one service from another, and the
          panel asks the three questions in the order an owner answers them,
          with the journey strip pinned beneath as the consequence.

          Direction is never hardcoded. The list is FIRST in the DOM, so it sits
          on the right in Hebrew and on the left in English, with no `isRTL`
          branch anywhere. */}
      {(services.length > 0 || isAddingNewRow) && (
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[300px_minmax(0,1fr)] gap-3">

          {/* ── The list ─────────────────────────────────────────────────── */}
          <div
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden flex flex-col min-h-0"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-[var(--v2-border)] flex-shrink-0">
              <span className="text-[11px] font-semibold tracking-wide uppercase text-[var(--v2-text-muted)]">
                {t('config.tab.services')}
              </span>
              <span className="text-[11px] text-[var(--v2-text-muted)] tabular-nums">{services.length}</span>
            </div>

            <div className="overflow-y-auto min-h-0 flex-1">
              {[...services].sort((a, b) => {
                const aActive = a.status !== 'draft' && a.is_active;
                const bActive = b.status !== 'draft' && b.is_active;
                if (aActive !== bActive) return aActive ? -1 : 1;
                if ((a.status === 'draft') !== (b.status === 'draft')) return a.status === 'draft' ? -1 : 1;
                return (a.service_name || '').localeCompare(b.service_name || '');
              }).map(service => {
                const effective = { ...service, ...(optimisticUpdates[service.id] || {}) };
                const isDraft = effective.status === 'draft';
                const isSelected = editingRowId === service.id;
                const scheduled = effective.is_scheduled !== false;

                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => startRowEdit(service)}
                    aria-current={isSelected}
                    className={`w-full text-start px-3.5 py-3 border-b border-[var(--v2-border)] last:border-b-0 transition-colors ${
                      isSelected
                        ? 'bg-[var(--v2-bg)]'
                        : 'hover:bg-[var(--v2-bg)]'
                    } ${recentlyEditedId === service.id ? 'recently-edited-row' : ''}`}
                    style={isSelected ? { boxShadow: `inset 3px 0 0 ${CONFIG_COLOR}` } : undefined}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {/* State as a dot, not a column. Published-and-live,
                          draft, and switched-off are three states and this is
                          the only place the list needs to say which. */}
                      <i
                        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                        style={{
                          backgroundColor: isDraft
                            ? '#F59E0B'
                            : effective.is_active
                              ? '#22C58B'
                              : 'var(--v2-text-muted)',
                        }}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-medium text-[var(--v2-text-primary)] truncate">
                        {effective.service_name}
                      </span>
                    </span>
                    {/* The four facts that tell services apart, on one line. */}
                    <span className="mt-1 block text-[12px] text-[var(--v2-text-secondary)] tabular-nums truncate">
                      {[
                        effective.sale_mode === 'proposal'
                          ? t('config.services.sale_mode.by_proposal')
                          : (effective.price ?? 0) > 0
                            ? `${getCurrencySymbol(effective.currency)}${effective.price}`
                            : t('journey.pay.free'),
                        effective.payment_type === 'installments' && (effective.installment_count ?? 0) > 1
                          ? `${effective.installment_count}x ${getFrequencyShortLabel(effective.installment_frequency)}`
                          : null,
                        scheduled && effective.duration_minutes
                          ? `${effective.duration_minutes} ${t('scheduling.service.minutes')}`
                          : null,
                      ].filter(Boolean).join(' · ')}
                    </span>
                  </button>
                );
              })}
            </div>

            {showAddButton && (
              <div className="flex-shrink-0 border-t border-[var(--v2-border)] p-2">
                <button
                  onClick={startAddNewRow}
                  disabled={isAddingNewRow}
                  className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium border border-dashed transition-all disabled:opacity-50"
                  style={{
                    borderRadius: 'var(--v2-radius-button)',
                    color: CONFIG_COLOR,
                    borderColor: `${CONFIG_COLOR}70`,
                    backgroundColor: `${CONFIG_COLOR}08`,
                  }}
                >
                  <Plus className="h-4 w-4" />
                  {t('scheduling.new_service') || 'Add a service'}
                </button>
              </div>
            )}
          </div>

          {/* ── The panel ────────────────────────────────────────────────── */}
          <div
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden flex flex-col min-h-0"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {isAddingNewRow
              ? renderServicePanel(null)
              : selectedService
                ? renderServicePanel(selectedService)
                : (
                  /* Nothing chosen. Said plainly rather than left blank — an
                     empty half of a dialog reads as something that failed to
                     load. */
                  <div className="flex-1 flex flex-col items-center justify-center gap-2 p-10 text-center">
                    <Tag className="h-7 w-7 text-[var(--v2-text-muted)]" />
                    <p className="text-sm text-[var(--v2-text-secondary)]">
                      {t('config.services.pick_one')}
                    </p>
                  </div>
                )}
          </div>
        </div>
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
                <div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    {t('scheduling.modal.description')}
                  </h3>
                  {/* A dialog that opens by itself has to say why it did. */}
                  {descriptionRequiredFor === descriptionDialogId && (
                    <p className="text-xs text-[#C2410C] mt-0.5">
                      {t('scheduling.description.requiredToPublish')}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => { setDescriptionDialogId(null); setDescriptionRequiredFor(null); }}
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
                onClick={() => { setDescriptionDialogId(null); setDescriptionRequiredFor(null); }}
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

      {/* New Row Payment Plan Dialog */}

      {/* Edit Row Payment Plan Dialog */}
    </div>
  );
}

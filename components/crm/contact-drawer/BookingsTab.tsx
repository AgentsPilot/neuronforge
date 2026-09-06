'use client';

import { useState } from 'react';
import {
  Calendar, Clock, CreditCard, ClipboardList, Mail, CheckCircle2,
  XCircle, AlertCircle, ChevronDown, ChevronUp, Plus, Edit2,
  Loader2, ShoppingBag, Package, Truck, Gift, User, MapPin,
  Phone, AtSign, Eye, ExternalLink, Save, X, RotateCcw, Ban,
  type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CollapsibleSection } from '../CollapsibleSection';
import type { SessionCardData, IntakeTemplate, BookingJourneyData, BookingJourneyStep } from './types';
import { groupJourneyByDay } from '@/lib/business-os/journeyDays';

interface BookingsTabProps {
  sessions: SessionCardData[];
  /**
   * The real state of each booking's payment plan, keyed by booking id.
   *
   * The plan on a session is built from the SERVICE — "sold as three monthly
   * payments" — which says how it was sold, not what happened. A plan that was
   * stopped went on reading as a live plan on its first period, with nothing on
   * the timeline to say the remaining charges will never be taken.
   *
   * Absent for a contact with no plan, and while it is still loading; the plan
   * terms show either way and only the state line waits.
   */
  planStates?: Record<string, { status: string; periodsPaid: number; installmentCount: number }>;
  t: (key: string) => string;
  isRTL: boolean;
  language: string;
  onNewSession?: () => void | Promise<void>;
  onEditSession?: (bookingId: string) => void;
  onManagePayment?: (session: SessionCardData) => void;
  onIntakeSaved?: (bookingId: string) => void;
  onSendIntake?: (bookingId: string) => Promise<void>;
  onSendInvoice?: (invoiceId: string, bookingId: string) => Promise<void>;
  /**
   * Send the confirmation email again — the "reminder" action on the journey.
   *
   * Optional and NOT yet wired by the drawer: the button is rendered so the
   * strip matches the agreed design, and it is inert until a handler is passed.
   * Deliberately not pointed at `onSendInvoice`, which sends a different email
   * entirely — a button that does the wrong thing is worse than one that waits.
   */
  onResendConfirmation?: (bookingId: string) => Promise<void> | void;
  /**
   * Record how an appointment actually went, from the card header.
   *
   * The edit dialog has always been able to set this; reaching it meant opening
   * a form about times and prices to answer a question — did they turn up? —
   * that the card itself is showing.
   */
  onSetBookingStatus?: (
    bookingId: string,
    status: 'completed' | 'no_show' | 'cancelled'
  ) => Promise<void> | void;
  isLoading?: boolean;
  intakeTemplates?: Record<string, IntakeTemplate>;
  isOpen?: boolean;
  onToggle?: (isOpen: boolean) => void;
}

// Step status types
type StepStatus = 'completed' | 'active' | 'pending' | 'failed' | 'skipped';

// Status colors for step indicators
const STATUS_COLORS: Record<StepStatus, { bg: string; border: string; icon: string; line: string; dot: string }> = {
  completed: {
    bg: 'bg-green-500',
    border: 'border-green-500',
    icon: 'text-white',
    line: 'bg-green-500',
    dot: 'bg-green-500'
  },
  active: {
    bg: 'bg-amber-500',
    border: 'border-amber-500',
    icon: 'text-white',
    line: 'bg-amber-500',
    dot: 'bg-amber-500'
  },
  pending: {
    bg: 'bg-[var(--v2-surface)]',
    border: 'border-[var(--v2-border)]',
    icon: 'text-[var(--v2-text-muted)]',
    line: 'bg-[var(--v2-border)]',
    dot: 'bg-[var(--v2-text-muted)]'
  },
  failed: {
    bg: 'bg-red-500',
    border: 'border-red-500',
    icon: 'text-white',
    line: 'bg-red-500',
    dot: 'bg-red-500'
  },
  skipped: {
    bg: 'bg-slate-500/50',
    border: 'border-slate-500/50',
    icon: 'text-slate-400',
    line: 'bg-slate-500/50',
    dot: 'bg-slate-400'
  }
};

// Map step keys to icons
const STEP_ICONS: Record<string, LucideIcon> = {
  // Service/Product steps
  service: Calendar,
  product: ShoppingBag,
  booked: Calendar,
  ordered: ShoppingBag,
  // Schedule
  schedule: Clock,
  // Client
  client: User,
  // Payment
  payment: CreditCard,
  // Intake
  intake: ClipboardList,
  // Confirmation
  confirmation: Mail,
  email: Mail,
  // Session/Completion
  session: Clock,
  completed: CheckCircle2,
  done: CheckCircle2,
  // Fulfillment (products)
  fulfillment: Package,
  fulfilled: Gift,
  shipped: Truck,
  delivered: Package,
  // Status
  cancelled: XCircle,
  no_show: AlertCircle,
  failed: XCircle,
};

export function BookingsTab({
  sessions,
  planStates,
  t,
  isRTL,
  language,
  onNewSession,
  onEditSession,
  onManagePayment,
  onIntakeSaved,
  onSendIntake,
  onSendInvoice,
  onResendConfirmation,
  onSetBookingStatus,
  isLoading = false,
  intakeTemplates = {},
  isOpen,
  onToggle
}: BookingsTabProps) {
  const [expandedBookings, setExpandedBookings] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  // Inline intake editing state
  const [editingIntakeBookingId, setEditingIntakeBookingId] = useState<string | null>(null);
  const [editingIntakeResponses, setEditingIntakeResponses] = useState<Record<string, unknown>>({});
  const [intakeSaving, setIntakeSaving] = useState(false);
  const [intakeError, setIntakeError] = useState<string | null>(null);
  const [intakeSuccess, setIntakeSuccess] = useState(false);
  // Intake email sending state
  const [sendingIntakeBookingId, setSendingIntakeBookingId] = useState<string | null>(null);
  // Invoice email sending state
  const [sendingInvoiceBookingId, setSendingInvoiceBookingId] = useState<string | null>(null);

  const toggleBooking = (id: string) => {
    setExpandedBookings(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Sort sessions: upcoming first, then by date
  const sortedSessions = [...sessions].sort((a, b) => {
    const now = new Date();
    const aDate = a.booking.start_time ? new Date(a.booking.start_time) : (a.booking.created_at ? new Date(a.booking.created_at) : new Date());
    const bDate = b.booking.start_time ? new Date(b.booking.start_time) : (b.booking.created_at ? new Date(b.booking.created_at) : new Date());
    const aUpcoming = a.booking.status === 'confirmed' && a.booking.start_time && aDate > now;
    const bUpcoming = b.booking.status === 'confirmed' && b.booking.start_time && bDate > now;

    if (aUpcoming && !bUpcoming) return -1;
    if (!aUpcoming && bUpcoming) return 1;
    if (aUpcoming && bUpcoming) return aDate.getTime() - bDate.getTime();
    return bDate.getTime() - aDate.getTime();
  });

  // Format helpers
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatShortDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(language, {
      month: 'short',
      day: 'numeric'
    });
  };

  /** Just the clock: the day already has its own marker above the entries. */
  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString(language, {
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatDateTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString(language, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} ${t('common.minutes') || 'min'}`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (mins === 0) return `${hours} ${t('common.hours') || 'hr'}`;
    return `${hours}h ${mins}m`;
  };

  // Check if booking is a product (no time slot)
  const isProductBooking = (booking: SessionCardData['booking']) => {
    return !booking.start_time || booking.service?.is_product;
  };

  /*
   * The badge on a booking header.
   *
   * Turns on whether a time was BOOKED, not on any notion of a product —
   * nothing in the data says "product", and the start time is the only thing
   * that distinguishes a session from a course sold without one.
   *
   * `confirmed` renders as "קרובה" — *upcoming*, a word about when something
   * will be attended. With no time booked there is nothing to attend, so the
   * card announced a purchase as "coming soon" beside a line saying it had been
   * bought a week ago.
   *
   * Only that one status differs. Completed, cancelled and awaiting-payment
   * mean the same thing either way, and giving them separate wording would be
   * inventing a difference to be consistent about.
   */
  const getBookingStatusLabel = (status: string, hasSchedule = true) => {
    const labels: Record<string, { text: string; color: string; bgColor: string }> = {
      confirmed: {
        text: hasSchedule
          ? t('crm.booking.status.confirmed') || 'Upcoming'
          : t('crm.booking.status.unscheduled_confirmed'),
        color: 'text-amber-600 dark:text-amber-400',
        bgColor: 'bg-amber-500/10',
      },
      completed: { text: t('crm.booking.status.completed') || 'Completed', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/10' },
      cancelled: { text: t('crm.booking.status.cancelled') || 'Cancelled', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/10' },
      no_show: { text: t('crm.booking.status.no_show') || 'No Show', color: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-500/10' },
      // `pending` was missing, so it fell through to the fallback below and
      // rendered the raw database value — an English "pending" sitting in the
      // middle of a Hebrew card. It is the status every unpaid booking has.
      pending: { text: t('crm.booking.status.pending') || 'Awaiting payment', color: 'text-orange-600 dark:text-orange-400', bgColor: 'bg-orange-500/10' }
    };
    return labels[status] || { text: status, color: 'text-[var(--v2-text-muted)]', bgColor: 'bg-[var(--v2-surface)]' };
  };

  // Intake editing helpers
  const startEditingIntake = (booking: SessionCardData['booking']) => {
    if (booking.intake_responses?.responses) {
      setEditingIntakeBookingId(booking.id);
      setEditingIntakeResponses({ ...booking.intake_responses.responses });
      setIntakeError(null);
      setIntakeSuccess(false);
    }
  };

  const cancelEditingIntake = () => {
    setEditingIntakeBookingId(null);
    setEditingIntakeResponses({});
    setIntakeError(null);
    setIntakeSuccess(false);
  };

  const saveIntakeResponses = async (bookingId: string) => {
    setIntakeSaving(true);
    setIntakeError(null);

    try {
      const response = await fetch(`/api/scheduling/bookings/${bookingId}/intake`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ responses: editingIntakeResponses })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update intake responses');
      }

      setIntakeSuccess(true);
      onIntakeSaved?.(bookingId);

      // Reset after short delay to show success
      setTimeout(() => {
        setEditingIntakeBookingId(null);
        setEditingIntakeResponses({});
        setIntakeSuccess(false);
      }, 1500);
    } catch (err) {
      setIntakeError(err instanceof Error ? err.message : 'Failed to update responses');
    } finally {
      setIntakeSaving(false);
    }
  };

  const handleIntakeFieldChange = (key: string, value: unknown) => {
    setEditingIntakeResponses(prev => ({ ...prev, [key]: value }));
  };

  // Handle sending/resending intake form email
  const handleSendIntake = async (bookingId: string) => {
    if (!onSendIntake || sendingIntakeBookingId) return;

    setSendingIntakeBookingId(bookingId);
    try {
      await onSendIntake(bookingId);
    } finally {
      setSendingIntakeBookingId(null);
    }
  };

  // Handle sending/resending invoice
  const handleSendInvoice = async (invoiceId: string, bookingId: string) => {
    if (!onSendInvoice || sendingInvoiceBookingId) return;

    setSendingInvoiceBookingId(bookingId);
    try {
      await onSendInvoice(invoiceId, bookingId);
    } finally {
      setSendingInvoiceBookingId(null);
    }
  };

  // Build intake content for expanded view (supports view and edit modes)
  const buildIntakeContent = (booking: SessionCardData['booking'], template?: IntakeTemplate) => {
    if (!booking.intake_responses?.responses) return null;

    const isEditing = editingIntakeBookingId === booking.id;

    const getFieldLabel = (key: string): string => {
      if (!template?.fields) return key.replace(/_/g, ' ');
      const field = template.fields.find(f => f.key === key);
      if (!field) return key.replace(/_/g, ' ');
      const langKey = `label_${language}` as keyof typeof field;
      return (field[langKey] as string) || field.label_en;
    };

    const getFieldPlaceholder = (field: IntakeTemplate['fields'][0]) => {
      const langKey = `placeholder_${language}` as keyof typeof field;
      return (field[langKey] as string) || '';
    };

    const getOptionLabel = (key: string, value: string): string => {
      if (!template?.fields) return value;
      const field = template.fields.find(f => f.key === key);
      if (!field?.options) return value;
      const option = field.options.find(opt => opt.value === value);
      if (!option) return value;
      const langKey = `label_${language}` as keyof typeof option;
      return (option[langKey] as string) || option.label_en || value;
    };

    const translateValue = (key: string, value: unknown): string => {
      if (typeof value === 'boolean') {
        return value ? (t('common.yes') || 'Yes') : (t('common.no') || 'No');
      }
      if (typeof value === 'string') {
        if (value.toLowerCase() === 'yes') return t('common.yes') || 'Yes';
        if (value.toLowerCase() === 'no') return t('common.no') || 'No';
        return getOptionLabel(key, value);
      }
      if (Array.isArray(value)) {
        return value.map(v => typeof v === 'string' ? getOptionLabel(key, v) : String(v)).join(', ');
      }
      return String(value);
    };

    // Render editable field based on template field type
    const renderEditableField = (field: IntakeTemplate['fields'][0]) => {
      const value = editingIntakeResponses[field.key];
      const label = getFieldLabel(field.key);
      const placeholder = getFieldPlaceholder(field);

      switch (field.type) {
        case 'text':
        case 'email':
        case 'tel':
          return (
            <div key={field.key} className="space-y-1">
              <label className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                {label}
                {field.required && <span className="text-red-500 ms-0.5">*</span>}
              </label>
              <Input
                type={field.type}
                value={(value as string) || ''}
                onChange={(e) => handleIntakeFieldChange(field.key, e.target.value)}
                placeholder={placeholder}
                className="h-8 text-sm bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6]"
                dir={isRTL ? 'rtl' : 'ltr'}
              />
            </div>
          );

        case 'textarea':
          return (
            <div key={field.key} className="space-y-1">
              <label className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                {label}
                {field.required && <span className="text-red-500 ms-0.5">*</span>}
              </label>
              <textarea
                value={(value as string) || ''}
                onChange={(e) => handleIntakeFieldChange(field.key, e.target.value)}
                placeholder={placeholder}
                rows={2}
                className="w-full px-3 py-2 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-md text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#8B5CF6] focus:ring-1 focus:ring-[#8B5CF6]/20 resize-none"
                dir={isRTL ? 'rtl' : 'ltr'}
              />
            </div>
          );

        case 'select':
          return (
            <div key={field.key} className="space-y-1">
              <label className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                {label}
                {field.required && <span className="text-red-500 ms-0.5">*</span>}
              </label>
              <select
                value={(value as string) || ''}
                onChange={(e) => handleIntakeFieldChange(field.key, e.target.value)}
                className="w-full h-8 px-3 text-sm bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-md text-[var(--v2-text-primary)] focus:outline-none focus:border-[#8B5CF6]"
                dir={isRTL ? 'rtl' : 'ltr'}
              >
                <option value="">{t('common.select') || 'Select...'}</option>
                {field.options?.map(option => (
                  <option key={option.value} value={option.value}>
                    {getOptionLabel(field.key, option.value)}
                  </option>
                ))}
              </select>
            </div>
          );

        case 'radio':
          return (
            <div key={field.key} className="space-y-1.5">
              <label className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                {label}
                {field.required && <span className="text-red-500 ms-0.5">*</span>}
              </label>
              <div className="space-y-1">
                {field.options?.map(option => (
                  <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name={field.key}
                      value={option.value}
                      checked={value === option.value}
                      onChange={(e) => handleIntakeFieldChange(field.key, e.target.value)}
                      className="h-3.5 w-3.5 text-[#8B5CF6] border-gray-300 focus:ring-[#8B5CF6]"
                    />
                    <span className="text-sm text-[var(--v2-text-primary)]">
                      {getOptionLabel(field.key, option.value)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );

        case 'checkbox':
          const isMultiple = field.options && field.options.length > 1;
          if (isMultiple) {
            const selectedValues = Array.isArray(value) ? value : [];
            return (
              <div key={field.key} className="space-y-1.5">
                <label className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                  {label}
                  {field.required && <span className="text-red-500 ms-0.5">*</span>}
                </label>
                <div className="space-y-1">
                  {field.options?.map(option => (
                    <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        value={option.value}
                        checked={selectedValues.includes(option.value)}
                        onChange={(e) => {
                          const newValues = e.target.checked
                            ? [...selectedValues, option.value]
                            : selectedValues.filter((v: string) => v !== option.value);
                          handleIntakeFieldChange(field.key, newValues);
                        }}
                        className="h-3.5 w-3.5 rounded text-[#8B5CF6] border-gray-300 focus:ring-[#8B5CF6]"
                      />
                      <span className="text-sm text-[var(--v2-text-primary)]">
                        {getOptionLabel(field.key, option.value)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            );
          } else {
            return (
              <div key={field.key} className="space-y-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={value === true || value === 'yes'}
                    onChange={(e) => handleIntakeFieldChange(field.key, e.target.checked ? 'yes' : 'no')}
                    className="h-3.5 w-3.5 rounded text-[#8B5CF6] border-gray-300 focus:ring-[#8B5CF6]"
                  />
                  <span className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    {label}
                    {field.required && <span className="text-red-500 ms-0.5">*</span>}
                  </span>
                </label>
              </div>
            );
          }

        default:
          return null;
      }
    };

    const responses = Object.entries(booking.intake_responses.responses);
    const responseCount = responses.length;

    // EDIT MODE
    if (isEditing) {
      return (
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-[var(--v2-border)]">
            <span className="text-xs font-medium text-[#8B5CF6]">
              {t('crm.intake.edit_title') || 'Edit Intake Form'}
            </span>
          </div>

          {/* Success Message */}
          {intakeSuccess && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-green-500/10 text-green-600 text-sm">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
              {t('crm.intake.update_success') || 'Intake updated successfully'}
            </div>
          )}

          {/* Error Message */}
          {intakeError && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-red-500/10 text-red-600 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {intakeError}
            </div>
          )}

          {/* Editable fields */}
          <div className="space-y-3">
            {template?.fields ? (
              template.fields.map(renderEditableField)
            ) : (
              // Fallback: render text inputs for each response key
              responses.map(([key]) => (
                <div key={key} className="space-y-1">
                  <label className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    {getFieldLabel(key)}
                  </label>
                  <Input
                    type="text"
                    value={(editingIntakeResponses[key] as string) || ''}
                    onChange={(e) => handleIntakeFieldChange(key, e.target.value)}
                    className="h-8 text-sm bg-[var(--v2-surface)] border-[var(--v2-border)] focus:border-[#8B5CF6]"
                    dir={isRTL ? 'rtl' : 'ltr'}
                  />
                </div>
              ))
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 pt-2 border-t border-[var(--v2-border)]">
            <Button
              type="button"
              size="sm"
              onClick={() => saveIntakeResponses(booking.id)}
              disabled={intakeSaving || intakeSuccess}
              className="h-7 text-xs text-white"
              style={{ background: 'linear-gradient(135deg, #8B5CF6 0%, #7C3AED 100%)' }}
            >
              {intakeSaving ? (
                <>
                  <Loader2 className="h-3 w-3 me-1.5 animate-spin" />
                  {t('common.saving') || 'Saving...'}
                </>
              ) : (
                <>
                  <Save className="h-3 w-3 me-1.5" />
                  {t('button.save') || 'Save'}
                </>
              )}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelEditingIntake}
              disabled={intakeSaving}
              className="h-7 text-xs border-[var(--v2-border)]"
            >
              <X className="h-3 w-3 me-1.5" />
              {t('button.cancel') || 'Cancel'}
            </Button>
          </div>
        </div>
      );
    }

    // VIEW MODE
    return (
      <div className="space-y-3">
        {/* Header with count and edit button */}
        <div className="flex items-center justify-between pb-2 border-b border-[var(--v2-border)]">
          <span className="text-xs font-medium text-[var(--v2-text-muted)]">
            {responseCount} {responseCount === 1
              ? (t('crm.intake.response') || 'response')
              : (t('crm.intake.responses') || 'responses')}
          </span>
          <div className="flex items-center gap-2">
            {booking.intake_completed_at && (
              <span className="text-xs text-[var(--v2-text-muted)]">
                {formatShortDate(booking.intake_completed_at)}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                startEditingIntake(booking);
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium text-[#8B5CF6] hover:bg-[#8B5CF6]/10 rounded-full transition-colors"
            >
              <Edit2 className="h-3 w-3" />
              {t('button.edit') || 'Edit'}
            </button>
          </div>
        </div>

        {/* Response grid */}
        <div className="grid gap-3">
          {responses.map(([key, value]) => {
            const displayValue = translateValue(key, value);
            const isLongText = displayValue.length > 50;

            return (
              <div
                key={key}
                className={`${isLongText ? 'col-span-full' : ''}`}
              >
                <div className="flex flex-col gap-1 p-2 rounded-md bg-[var(--v2-surface)] border border-[var(--v2-border)]">
                  <span className="text-[10px] font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    {getFieldLabel(key)}
                  </span>
                  <span className={`text-sm text-[var(--v2-text-primary)] ${isLongText ? 'whitespace-pre-wrap' : ''}`}>
                    {displayValue}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render a journey section row
  // Count upcoming sessions for badge
  const upcomingCount = sessions.filter(s =>
    s.booking.status === 'confirmed' && s.booking.start_time && new Date(s.booking.start_time) > new Date()
  ).length;

  return (
    <CollapsibleSection
      title={t('crm.drawer.section_bookings') || 'Bookings'}
      icon={<Calendar className="h-4 w-4 text-[var(--v2-text-muted)]" />}
      defaultOpen={true}
      isOpen={isOpen}
      onToggle={onToggle}
      isRTL={isRTL}
      badge={
        sessions.length > 0 && (
          <span className="text-xs text-[var(--v2-text-muted)]">
            {upcomingCount > 0 && (
              <span className="text-amber-500">{upcomingCount} {t('crm.drawer.upcoming')}</span>
            )}
            {upcomingCount > 0 && sessions.length > upcomingCount && ' • '}
            {sessions.length > upcomingCount && (
              <span>{sessions.length - upcomingCount} {t('crm.drawer.past') || 'past'}</span>
            )}
          </span>
        )
      }
      actionButton={
        onNewSession && (
          <Button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNewSession();
            }}
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[#8B5CF6] hover:bg-[#8B5CF6]/10"
          >
            <Plus className="h-4 w-4 me-1" />
            {t('crm.drawer.new_session') || 'New'}
          </Button>
        )
      }
    >
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-[#8B5CF6]" />
          </div>
        ) : sessions.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-[var(--v2-border)] rounded-lg">
            <Calendar className="h-12 w-12 text-[var(--v2-text-muted)] mx-auto mb-3" />
            <p className="text-sm text-[var(--v2-text-muted)] mb-4">
              {t('crm.drawer.no_sessions') || 'No bookings yet'}
            </p>
            {onNewSession && (
              <Button
                type="button"
                onClick={onNewSession}
                className="bg-[#8B5CF6] hover:bg-[#7C3AED] text-white"
              >
                <Plus className="h-4 w-4 me-1" />
                {t('crm.drawer.schedule_first') || 'Create first booking'}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {sortedSessions.map((session) => {
              const { booking, payment, journeyData } = session;
              const isExpanded = expandedBookings.has(booking.id);
              // Declared first: the badge's wording depends on it.
              const isProduct = isProductBooking(booking);
              const statusInfo = getBookingStatusLabel(booking.status, !isProduct);
              const bookingDate = booking.start_time ? new Date(booking.start_time) : null;
              const isUpcoming = booking.status === 'confirmed' && bookingDate && bookingDate > new Date();
              const isPendingProduct = isProduct && booking.status !== 'completed' && booking.status !== 'cancelled';

              // Get intake template
              const templateId = booking.intake_responses?.template_id;
              const template = templateId ? intakeTemplates[templateId] : undefined;
              const hasIntake = booking.intake_responses && Object.keys(booking.intake_responses.responses || {}).length > 0;

              return (
                <div
                  key={booking.id}
                  className={`border rounded-lg overflow-hidden transition-all ${
                    isUpcoming
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : isPendingProduct
                      ? 'border-purple-500/50 bg-purple-500/5'
                      : 'border-[var(--v2-border)] bg-[var(--v2-surface)]'
                  }`}
                >
                  {/* Booking header - clickable */}
                  <button
                    type="button"
                    onClick={() => toggleBooking(booking.id)}
                    className="w-full flex items-center justify-between p-4 hover:bg-[var(--v2-surface)]/80 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {/* Type indicator icon */}
                      {isProduct ? (
                        <ShoppingBag className={`h-5 w-5 flex-shrink-0 ${
                          booking.status === 'completed' ? 'text-green-500' :
                          booking.status === 'cancelled' ? 'text-red-500' :
                          'text-purple-500'
                        }`} />
                      ) : (
                        <Calendar className={`h-5 w-5 flex-shrink-0 ${
                          booking.status === 'completed' ? 'text-green-500' :
                          booking.status === 'confirmed' ? 'text-amber-500' :
                          booking.status === 'cancelled' ? 'text-red-500' :
                          'text-slate-500'
                        }`} />
                      )}

                      <div className="text-start">
                        <p className="font-medium text-[var(--v2-text-primary)]">
                          {booking.service?.service_name || t('crm.session.unknown_service')}
                        </p>
                        <p className="text-xs text-[var(--v2-text-muted)]">
                          {isProduct ? (
                            <bdi>
                              {t('crm.booking.purchased_on') || 'Purchased'}{' '}
                              {formatShortDate(booking.created_at || new Date().toISOString())}
                            </bdi>
                          ) : booking.start_time ? (
                            <bdi>{formatDate(booking.start_time)}</bdi>
                          ) : null}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${statusInfo.color} ${statusInfo.bgColor}`}>
                        {statusInfo.text}
                      </span>

                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 text-[var(--v2-text-muted)]" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-[var(--v2-text-muted)]" />
                      )}
                    </div>
                  </button>

                  {/* ── How did it go? ──────────────────────────────────────
                      Outside the header BUTTON, not inside it: the whole header
                      is the expand control, and nesting buttons inside a button
                      is invalid markup that browsers resolve unpredictably.

                      Offered only while the outcome is still open — a booking
                      already completed, cancelled or marked a no-show has its
                      answer, and changing it belongs in the edit form where the
                      consequences are visible.

                      SHOWN WITH OR WITHOUT A SCHEDULE. This whole strip used to
                      be withheld when no time was booked, on the grounds that
                      there is no attendance to record — true of "did not
                      attend", and true of nothing else. An order can be
                      fulfilled and an order can be cancelled; withholding both
                      left a course sale with no way to end it at all, and the
                      only route to cancelling one was to refund it.

                      So only "did not attend" is conditional. The other two mean
                      the same thing either way. */}
                  {onSetBookingStatus &&
                    booking.status !== 'completed' &&
                    booking.status !== 'cancelled' &&
                    booking.status !== 'no_show' && (
                      <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
                        <button
                          type="button"
                          onClick={() => onSetBookingStatus(booking.id, 'completed')}
                          className="px-3 py-1 rounded-full text-[12px] font-medium border border-green-600/40 text-green-700 dark:text-green-400 hover:bg-green-500/10 transition-colors"
                        >
                          {/* "Completed" for a session that was held; the same
                              word serves an order that was delivered. */}
                          {t('crm.booking.status.completed') || 'Completed'}
                        </button>

                        {/* The one that needs a time to mean anything. */}
                        {!isProduct && (
                          <button
                            type="button"
                            onClick={() => onSetBookingStatus(booking.id, 'no_show')}
                            className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
                          >
                            {t('crm.booking.status.no_show') || 'No show'}
                          </button>
                        )}

                        {/* Last, and the only one in red: it reaches the client. */}
                        <button
                          type="button"
                          onClick={() => onSetBookingStatus(booking.id, 'cancelled')}
                          className="px-3 py-1 rounded-full text-[12px] font-medium border border-red-600/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 transition-colors"
                        >
                          {t('crm.booking.status.cancelled') || 'Cancel'}
                        </button>
                      </div>
                    )}

                  {/* Expanded content - Full Journey from journeySteps */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-[var(--v2-border)]">
                      <div className="pt-4">

                        {/* ── The journey, as a day book ──────────────────────
                            Steps grouped under the day they happened on, with
                            the wait between distant days drawn rather than
                            collapsed into one more evenly spaced row. Every
                            action the old strip offered is still here — the
                            node is still the send/resend control, intake still
                            expands, payment still opens the manager — with
                            reschedule and resend added as visible buttons
                            rather than affordances hidden on an icon. */}
                        {session.journeySteps && session.journeySteps.length > 0 ? (
                          groupJourneyByDay(session.journeySteps).map(group => {
                            if (group.kind === 'wait') {
                              return (
                                <div
                                  key={group.key}
                                  className="relative py-3.5 text-[11.5px] text-[var(--v2-text-muted)]"
                                  style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: '51px' }}
                                >
                                  {/* The rail carries through the gap: the line is
                                      still the journey, it just has nothing on it. */}
                                  <span
                                    className="absolute top-0 bottom-0 border-s-2 border-dashed border-[var(--v2-border)]"
                                    style={{ [isRTL ? 'right' : 'left']: '11px' }}
                                    aria-hidden="true"
                                  />
                                  {(t('crm.journey.wait_days') || '{count} days of waiting')
                                    .replace('{count}', String(group.days))}
                                </div>
                              );
                            }

                            return (
                              <div key={group.key}>
                                {/* One marker per DAY, not a date repeated on
                                    every row. */}
                                <div className="flex items-baseline gap-2 pt-4 pb-2">
                                  {group.date ? (
                                    <>
                                      <span className="text-[16px] font-bold leading-none text-[var(--v2-text-primary)]">
                                        {group.date.getDate()}
                                      </span>
                                      <span className="text-[11px] tracking-wide text-[var(--v2-text-muted)]">
                                        {new Intl.DateTimeFormat(language, { month: 'short' }).format(group.date)}
                                      </span>
                                    </>
                                  ) : (
                                    <span className="text-[11px] text-[var(--v2-text-muted)]">
                                      {t('crm.journey.upcoming') || 'Upcoming'}
                                    </span>
                                  )}
                                  <span className="flex-1 h-px bg-[var(--v2-border)]" aria-hidden="true" />
                                </div>

                                {group.steps.map((step, index) => {
                                  const StepIcon = STEP_ICONS[step.key] || CheckCircle2;

                                  const stepTitle = step.label || t(`crm.booking.step.${step.key}`) || step.key;
                                  const isIntakeStep = step.key === 'intake';
                                  const isPaymentStep = step.key === 'payment';
                                  const isConfirmationStep = step.key === 'confirmation';
                                  const isScheduleStep = step.key === 'session' || step.key === 'schedule';
                                  const intakeExpandable = isIntakeStep && hasIntake;
                                  const sectionKey = `${booking.id}-${step.key}-${index}`;
                                  const isSectionExpanded = expandedSections.has(sectionKey);

                                  const payment = session.payment;
                                  const refunded = payment?.refundedAmount ?? 0;

                                  /*
                                   * What was CHARGED — from the invoice first.
                                   *
                                   * `payment.amount` is the service's CURRENT price:
                                   * a live figure that can be edited, zeroed, or lost
                                   * when a service is replaced. Reading it meant the
                                   * receipt could vanish from a booking whose money
                                   * had not changed at all. What was invoiced is a
                                   * fact about the past and cannot move.
                                   */
                                  /*
                                   * A PLAN has collected only what its paid periods
                                   * add up to — not the agreement's total, and not
                                   * the service's price. The plan booking on this
                                   * account read "charged $1,000.00" with $333.33
                                   * actually taken, which overstates by two thirds
                                   * on a block whose whole job is to add up.
                                   */
                                  const collectedOnPlan =
                                    payment?.plan && (payment.plan.periodsPaid ?? 0) > 0
                                      ? Math.round(
                                          payment.plan.installmentAmount *
                                            (payment.plan.periodsPaid ?? 0) * 100
                                        ) / 100
                                      : null;
                                  /*
                                   * `periodsPaid` comes from the plan's local mirror
                                   * and is undefined until it exists. Multiplying by
                                   * zero produced a charged figure of 0 — and `??`
                                   * does not fall through a zero — so the receipt
                                   * vanished from every plan whose mirror had not
                                   * landed yet. Unknown falls back to the payment.
                                   */

                                  const charged =
                                    collectedOnPlan ??
                                    payment?.invoicedAmount ??
                                    payment?.amount ??
                                    0;

                                  /*
                                   * Shown whenever money exists — charged OR refunded.
                                   *
                                   * Gating on `charged > 0` alone let a refund with no
                                   * price behind it disappear entirely, which is the
                                   * one case where the figure matters most.
                                   */
                                  const showAccount =
                                    isPaymentStep &&
                                    !!payment &&
                                    payment.status !== 'free' &&
                                    (charged > 0 || refunded > 0);

                                  const colors = STATUS_COLORS[step.status];

                                  /*
                                   * The appointment reads as three things, not one:
                                   * the time it runs, the day and whether it has
                                   * happened, and how long it lasts. The step only
                                   * carries the time range, so the rest is composed
                                   * here from the booking itself.
                                   */
                                  /*
                                   * The time the appointment runs.
                                   *
                                   * The `session` step carries no details of its own
                                   * — it is only a status marker — so the row showed
                                   * a weekday and a duration and never said WHEN.
                                   * Composed from the slot, like the schedule step
                                   * above it does.
                                   */
                                  const scheduleFact =
                                    isScheduleStep && !step.details && booking.start_time
                                      ? booking.end_time
                                        ? `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`
                                        : formatTime(booking.start_time)
                                      : null;

                                  /*
                                   * The booking's OWN status wins over the clock.
                                   *
                                   * This read the start time first, so an
                                   * appointment marked completed — or a no-show —
                                   * still said "טרם התקיימה" until its slot came
                                   * round, and offered to reschedule it. What the
                                   * owner recorded outranks what the calendar
                                   * implies; the clock is only the fallback for a
                                   * booking still sitting at `confirmed`.
                                   */
                                  /*
                                   * The booking has an outcome on record.
                                   *
                                   * Describes the BOOKING, not any one step: it
                                   * gates rescheduling, resending the confirmation
                                   * and the status buttons alike. An appointment
                                   * that did not happen must not be re-confirmed —
                                   * that email carries a calendar invite and would
                                   * put a dead appointment back in the client's
                                   * diary.
                                   */
                                  const settledStatus =
                                    booking.status === 'completed' ||
                                    booking.status === 'cancelled' ||
                                    booking.status === 'no_show';

                                  const scheduleDetail =
                                    isScheduleStep && booking.start_time
                                      ? [
                                          new Intl.DateTimeFormat(language, { weekday: 'long' })
                                            .format(new Date(booking.start_time)),
                                          settledStatus
                                            ? getBookingStatusLabel(booking.status, !isProduct).text
                                            : new Date(booking.start_time) > new Date()
                                              ? t('crm.journey.not_yet_held') || 'Not yet held'
                                              : t('crm.journey.awaiting_outcome') || 'Awaiting an outcome'
                                        ]
                                          .filter(Boolean)
                                          .join(' · ')
                                      : null;

                                  /*
                                   * How long it runs, in the clock column — the fact
                                   * beside it is already the time range, so repeating
                                   * the start time there would say nothing new.
                                   */
                                  const scheduleDuration = (() => {
                                    if (!isScheduleStep) return null;
                                    // Derived from the slot rather than a stored
                                    // figure: `duration` lives on the service, and a
                                    // booking that was moved or extended is the
                                    // authority on how long it actually runs.
                                    const minutes =
                                      (booking.start_time && booking.end_time
                                        ? Math.round(
                                            (new Date(booking.end_time).getTime() -
                                              new Date(booking.start_time).getTime()) / 60000
                                          )
                                        : null);
                                    return minutes && minutes > 0 ? formatDuration(minutes) : null;
                                  })();

                                  // The node keeps its send/resend behaviour.
                                  const onNodeClick =
                                    isIntakeStep && !hasIntake && onSendIntake && booking.status !== 'cancelled'
                                      ? () => handleSendIntake(booking.id)
                                      : isPaymentStep && step.metadata?.canResend && onSendInvoice && booking.status !== 'cancelled'
                                        ? () => handleSendInvoice(step.metadata?.invoiceId as string, booking.id)
                                        : undefined;

                                  const nodeLoading =
                                    (isIntakeStep && sendingIntakeBookingId === booking.id) ||
                                    (isPaymentStep && sendingInvoiceBookingId === booking.id);

                                  return (
                                    <div key={sectionKey}>
                                      <div
                                        className="relative grid items-baseline py-3 border-t border-[var(--v2-border)] first:border-t-0"
                                        style={{ gridTemplateColumns: '24px 74px minmax(0, 1fr)', columnGap: '11px', rowGap: '2px' }}
                                      >
                                        {/* The connector, behind the nodes. */}
                                        <span
                                          className="absolute top-0 bottom-0 w-0.5 bg-[var(--v2-border)]"
                                          style={{ [isRTL ? 'right' : 'left']: '11px' }}
                                          aria-hidden="true"
                                        />

                                        {/* The node. Still the control it was. */}
                                        <button
                                          type="button"
                                          onClick={e => {
                                            if (!onNodeClick) return;
                                            e.stopPropagation();
                                            onNodeClick();
                                          }}
                                          disabled={!onNodeClick || nodeLoading}
                                          title={
                                            isIntakeStep && !hasIntake
                                              ? t('crm.intake.send_form') || 'Send intake form'
                                              : isPaymentStep && step.metadata?.canResend
                                                ? t('crm.invoice.resend') || 'Resend invoice'
                                                : undefined
                                          }
                                          className={`relative z-10 justify-self-center w-[22px] h-[22px] rounded-full flex items-center justify-center border-2 ${colors.bg} ${colors.border} ${
                                            onNodeClick && !nodeLoading
                                              ? 'cursor-pointer hover:scale-110 transition-transform'
                                              : 'cursor-default'
                                          }`}
                                          style={{ gridColumn: 1, gridRow: 1 }}
                                        >
                                          {nodeLoading ? (
                                            <Loader2 className={`h-3 w-3 ${colors.icon} animate-spin`} />
                                          ) : (
                                            <StepIcon className={`h-3 w-3 ${colors.icon}`} />
                                          )}
                                        </button>

                                        {/* The spine: every label starts here. */}
                                        <span
                                          className="text-[12px] leading-[1.5] text-[var(--v2-text-muted)] break-words"
                                          style={{ gridColumn: 2, gridRow: 1 }}
                                        >
                                          {stepTitle}
                                        </span>

                                        {/* The clock. The day is already named
                                            above, so the row only needs the time. */}
                                        {(scheduleDuration || step.timestamp) && (
                                          <span
                                            className="absolute top-3 text-[11.5px] tabular-nums text-[var(--v2-text-muted)] whitespace-nowrap"
                                            style={{ [isRTL ? 'left' : 'right']: '0' }}
                                          >
                                            {scheduleDuration ?? formatTime(step.timestamp!)}
                                          </span>
                                        )}

                                        {/* What happened. */}
                                        {showAccount ? (
                                          <div
                                            className="grid items-baseline mt-0.5"
                                            style={{
                                              gridColumn: 3,
                                              gridTemplateColumns: 'minmax(0, 1fr) auto',
                                              gap: '4px 18px',
                                              maxWidth: 'min(290px, 100% - 46px)'
                                            }}
                                          >
                                            {/* An account, not a number: charged,
                                                returned, and a ruled total. A block
                                                that has to add up cannot hide a
                                                partial refund behind the gross. */}
                                            <span className="text-[12.5px] text-[var(--v2-text-muted)] break-words">
                                              {t('crm.journey.charged') || 'Charged'}
                                            </span>
                                            <span className="text-[13px] tabular-nums text-[var(--v2-text-secondary)] text-end whitespace-nowrap">
                                              {formatAmount(charged, payment!.currency)}
                                            </span>

                                            {refunded > 0 && (
                                              <>
                                                <span className="text-[12.5px] text-orange-600 dark:text-orange-400 break-words">
                                                  {t('crm.journey.returned') || 'Refunded'}
                                                  {payment!.refundedAt
                                                    ? ` · ${formatShortDate(payment!.refundedAt)}`
                                                    : ''}
                                                </span>
                                                {/* `bdi` so the minus stays ON the
                                                    number. In an RTL row a bare
                                                    "−$100.00" is reordered by the
                                                    bidi algorithm and renders as
                                                    "$100.00−", which reads like a
                                                    typo rather than a deduction. */}
                                                <bdi className="text-[13px] tabular-nums text-orange-600 dark:text-orange-400 text-end whitespace-nowrap">
                                                  −{formatAmount(refunded, payment!.currency)}
                                                </bdi>

                                                <span
                                                  className="h-px bg-[var(--v2-border)]"
                                                  style={{ gridColumn: '1 / -1', margin: '3px 0 1px' }}
                                                  aria-hidden="true"
                                                />

                                                <span className="text-[12.5px] font-medium text-[var(--v2-text-secondary)]">
                                                  {t('crm.journey.kept') || 'You keep'}
                                                </span>
                                                <span className="text-[17px] font-medium tabular-nums text-green-600 dark:text-green-400 text-end whitespace-nowrap">
                                                  {formatAmount(Math.max(0, charged - refunded), payment!.currency)}
                                                </span>
                                              </>
                                            )}
                                          </div>
                                        ) : (
                                          <span
                                            className="text-[14.5px] font-medium leading-[1.5] text-[var(--v2-text-primary)] break-words"
                                            style={{ gridColumn: 3, gridRow: 1, paddingInlineEnd: '46px' }}
                                          >
                                            {step.details ||
                                              scheduleFact ||
                                              (isConfirmationStep && step.status === 'completed'
                                                ? t('crm.booking.email_sent')
                                                : '')}
                                          </span>
                                        )}

                                        {/* Supporting detail — a plan's terms,
                                            the answer count — under the fact. */}
                                        {/* Only a PLAN's terms — "₪333.33 · 1 of 3 ·
                                            monthly" — which the receipt above cannot
                                            express. For an ordinary payment
                                            `step.details` is the amount itself, so
                                            this printed the figure a second time
                                            under the block that just totalled it. */}
                                        {showAccount && payment?.plan && step.details && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)] break-words"
                                            style={{ gridColumn: 3 }}
                                          >
                                            {step.details}
                                          </span>
                                        )}

                                        {/* A plan that is no longer running.
                                            Only when it has actually ended: an
                                            active plan needs no announcement,
                                            and a line saying so on every plan
                                            would bury the one case that
                                            matters — remaining charges that
                                            will never be taken, on a booking
                                            that otherwise reads as mid-plan. */}
                                        {(() => {
                                          // The PAYMENT step only. Without this it
                                          // rendered under every step in the journey —
                                          // the product, the client details, the
                                          // confirmation — because a plan belongs to
                                          // the booking and every step could see it.
                                          // A plan being stopped is a fact about the
                                          // money, and it belongs beside the money.
                                          const planState = planStates?.[booking.id];
                                          if (!isPaymentStep || !payment?.plan || !planState) return null;
                                          if (planState.status !== 'cancelled') return null;

                                          return (
                                            <span
                                              className="flex items-center gap-1.5 text-[12.5px] leading-[1.5] text-orange-600"
                                              style={{ gridColumn: 3 }}
                                            >
                                              <Ban className="h-3.5 w-3.5 shrink-0" />
                                              <bdi>
                                                {t('payments.plan.status.cancelled')}
                                                {planState.installmentCount > 0 && (
                                                  <span className="text-[var(--v2-text-muted)]">
                                                    {' · '}
                                                    {t('payments.plan.periods_collected')
                                                      .replace('{paid}', String(planState.periodsPaid))
                                                      .replace('{count}', String(planState.installmentCount))}
                                                  </span>
                                                )}
                                              </bdi>
                                            </span>
                                          );
                                        })()}

                                        {scheduleDetail && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)]"
                                            style={{ gridColumn: 3 }}
                                          >
                                            {scheduleDetail}
                                          </span>
                                        )}

                                        {isIntakeStep && hasIntake && (
                                          <span
                                            className="text-[12.5px] leading-[1.5] text-[var(--v2-text-muted)]"
                                            style={{ gridColumn: 3 }}
                                          >
                                            {Object.keys(booking.intake_responses?.responses || {}).length}{' '}
                                            {t('crm.intake.responses')}
                                          </span>
                                        )}

                                        {/* State, then actions. A state is a quiet
                                            tinted word; an action is a control. */}
                                        <div className="flex flex-wrap items-center gap-1.5 mt-2" style={{ gridColumn: 3 }}>
                                          {isIntakeStep && hasIntake && (
                                            <span className="px-2.5 py-0.5 rounded-full text-[11.5px] font-medium bg-green-500/10 text-green-600 dark:text-green-400">
                                              {t('crm.booking.intake_completed') || 'Completed'}
                                            </span>
                                          )}

                                          {isPaymentStep &&
                                            (payment?.status === 'refunded' || refunded > 0) && (
                                              <span className="px-2.5 py-0.5 rounded-full text-[11.5px] font-medium bg-orange-500/10 text-orange-600 dark:text-orange-400">
                                                {payment?.status === 'refunded'
                                                  ? t('crm.payment.status.refunded') || 'Refunded'
                                                  : t('crm.payment.status.partially_refunded_short') || 'Partially refunded'}
                                              </span>
                                            )}

                                          {intakeExpandable && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                toggleSection(sectionKey);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
                                            >
                                              {isSectionExpanded
                                                ? t('common.hide') || 'Hide'
                                                : t('crm.intake.view_responses') || 'View responses'}
                                            </button>
                                          )}

                                          {isPaymentStep && payment && payment.status !== 'free' && onManagePayment && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onManagePayment(session);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[#8B5CF6] text-[#8B5CF6] hover:bg-[#8B5CF6] hover:text-white transition-colors"
                                            >
                                              {t('crm.payment.manage') || 'Manage payment'}
                                            </button>
                                          )}

                                          {isPaymentStep && !!step.metadata?.canResend && onSendInvoice && booking.status !== 'cancelled' && (
                                            <button
                                              type="button"
                                              disabled={sendingInvoiceBookingId === booking.id}
                                              onClick={e => {
                                                e.stopPropagation();
                                                handleSendInvoice(step.metadata?.invoiceId as string, booking.id);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors disabled:opacity-50"
                                            >
                                              {t('crm.invoice.resend') || 'Resend invoice'}
                                            </button>
                                          )}

                                          {isIntakeStep && !hasIntake && onSendIntake && booking.status !== 'cancelled' && (
                                            <button
                                              type="button"
                                              disabled={sendingIntakeBookingId === booking.id}
                                              onClick={e => {
                                                e.stopPropagation();
                                                handleSendIntake(booking.id);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors disabled:opacity-50"
                                            >
                                              {t('crm.intake.send_form') || 'Send intake form'}
                                            </button>
                                          )}

                                          {/* Resend the confirmation — the details
                                              and the calendar invite, to a client
                                              who lost the email or whose address
                                              was wrong at the time. Still guarded
                                              on the handler: this component is used
                                              without one elsewhere, and a button
                                              that silently does nothing is worse
                                              than one that shows it cannot. */}
                                          {isConfirmationStep && step.status === 'completed' && !settledStatus && (
                                            <button
                                              type="button"
                                              disabled={!onResendConfirmation}
                                              title={onResendConfirmation ? undefined : t('crm.journey.not_wired') || 'Not connected yet'}
                                              onClick={e => {
                                                e.stopPropagation();
                                                onResendConfirmation?.(booking.id);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                              {t('crm.journey.resend') || 'Send again'}
                                            </button>
                                          )}

                                          {/* Reschedule, on the step it belongs to.
                                              The same action as the footer's Edit —
                                              it is just reachable from the row that
                                              names the time. */}
                                          {/* Only what can still be moved. A booking
                                              already completed, cancelled or marked
                                              a no-show is a record of what happened
                                              — offering to reschedule it invites an
                                              edit that contradicts the outcome. */}
                                          {isScheduleStep && onEditSession && !isProduct && !settledStatus && (
                                            <button
                                              type="button"
                                              onClick={e => {
                                                e.stopPropagation();
                                                onEditSession(booking.id);
                                              }}
                                              className="px-3 py-1 rounded-full text-[12px] font-medium border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:border-[var(--v2-text-muted)] transition-colors"
                                            >
                                              {t('crm.booking.reschedule') || 'Reschedule'}
                                            </button>
                                          )}
                                        </div>
                                      </div>

                                      {/* The intake answers, unchanged. */}
                                      {intakeExpandable && isSectionExpanded && (
                                        <div
                                          style={{ [isRTL ? 'paddingRight' : 'paddingLeft']: '109px' }}
                                          className="pb-3"
                                        >
                                          <div className="p-4 bg-[var(--v2-bg)] rounded-xl border border-[var(--v2-border)] shadow-sm">
                                            {buildIntakeContent(booking, template)}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })
                        ) : (
                          // Fallback: No journey steps provided - show message
                          <div className="text-center py-4">
                            <p className="text-sm text-[var(--v2-text-muted)]">
                              {t('crm.booking.no_journey_steps') || 'No journey steps available'}
                            </p>
                          </div>
                        )}

                        {/* Notes */}
                        {booking.notes && booking.status !== 'cancelled' && (
                          <div className="mt-2 p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
                            <p className="text-xs font-medium text-[var(--v2-text-muted)] mb-1">
                              {t('crm.journey.notes') || 'Notes'}
                            </p>
                            <p className="text-sm text-[var(--v2-text-primary)] italic">
                              {booking.notes}
                            </p>
                          </div>
                        )}

                      </div>

                      {/* Edit — only while the booking can still change.
                          A completed appointment, a cancellation or a no-show is a
                          record of what happened; editing its time afterwards
                          rewrites history and, for a completed one, contradicts the
                          outcome the owner just recorded. */}
                      {onEditSession &&
                        !isProduct &&
                        booking.status !== 'completed' &&
                        booking.status !== 'cancelled' &&
                        booking.status !== 'no_show' && (
                        <div className="mt-4 pt-3 border-t border-[var(--v2-border)]">
                          <Button
                            type="button"
                            onClick={() => onEditSession(booking.id)}
                            size="sm"
                            variant="outline"
                            className="w-full border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]"
                          >
                            <Edit2 className="h-4 w-4 me-2" />
                            {t('crm.booking.edit') || 'Edit Booking'}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

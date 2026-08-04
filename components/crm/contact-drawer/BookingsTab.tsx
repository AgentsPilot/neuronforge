'use client';

import { useState } from 'react';
import {
  Calendar, Clock, CreditCard, ClipboardList, Mail, CheckCircle2,
  XCircle, AlertCircle, ChevronDown, ChevronUp, Plus, Edit2,
  Loader2, ShoppingBag, Package, Truck, Gift, User, MapPin,
  Phone, AtSign, Eye, ExternalLink,
  type LucideIcon
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollapsibleSection } from '../CollapsibleSection';
import type { SessionCardData, IntakeTemplate, BookingJourneyData, BookingJourneyStep } from './types';

interface BookingsTabProps {
  sessions: SessionCardData[];
  t: (key: string) => string;
  isRTL: boolean;
  language: string;
  onNewSession?: () => void;
  onEditSession?: (bookingId: string) => void;
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
  t,
  isRTL,
  language,
  onNewSession,
  onEditSession,
  isLoading = false,
  intakeTemplates = {},
  isOpen,
  onToggle
}: BookingsTabProps) {
  const [expandedBookings, setExpandedBookings] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

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

  // Get status info
  const getBookingStatusLabel = (status: string) => {
    const labels: Record<string, { text: string; color: string; bgColor: string }> = {
      confirmed: { text: t('crm.booking.status.confirmed') || 'Upcoming', color: 'text-amber-600 dark:text-amber-400', bgColor: 'bg-amber-500/10' },
      completed: { text: t('crm.booking.status.completed') || 'Completed', color: 'text-green-600 dark:text-green-400', bgColor: 'bg-green-500/10' },
      cancelled: { text: t('crm.booking.status.cancelled') || 'Cancelled', color: 'text-red-600 dark:text-red-400', bgColor: 'bg-red-500/10' },
      no_show: { text: t('crm.booking.status.no_show') || 'No Show', color: 'text-slate-600 dark:text-slate-400', bgColor: 'bg-slate-500/10' }
    };
    return labels[status] || { text: status, color: 'text-[var(--v2-text-muted)]', bgColor: 'bg-[var(--v2-surface)]' };
  };

  // Build intake content for expanded view
  const buildIntakeContent = (booking: SessionCardData['booking'], template?: IntakeTemplate) => {
    if (!booking.intake_responses?.responses) return null;

    const getFieldLabel = (key: string): string => {
      if (!template?.fields) return key.replace(/_/g, ' ');
      const field = template.fields.find(f => f.key === key);
      if (!field) return key.replace(/_/g, ' ');
      const langKey = `label_${language}` as keyof typeof field;
      return (field[langKey] as string) || field.label_en;
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

    const responses = Object.entries(booking.intake_responses.responses);
    const responseCount = responses.length;

    return (
      <div className="space-y-3">
        {/* Header with count */}
        <div className="flex items-center justify-between pb-2 border-b border-[var(--v2-border)]">
          <span className="text-xs font-medium text-[var(--v2-text-muted)]">
            {responseCount} {responseCount === 1
              ? (t('crm.intake.response') || 'response')
              : (t('crm.intake.responses') || 'responses')}
          </span>
          {booking.intake_completed_at && (
            <span className="text-xs text-[var(--v2-text-muted)]">
              {formatShortDate(booking.intake_completed_at)}
            </span>
          )}
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
  const renderJourneyRow = (
    icon: LucideIcon,
    title: string,
    status: StepStatus,
    content: React.ReactNode,
    sectionKey: string,
    expandable: boolean = false,
    expandedContent?: React.ReactNode
  ) => {
    const Icon = icon;
    const colors = STATUS_COLORS[status];
    const isExpanded = expandedSections.has(sectionKey);

    return (
      <div className="relative flex gap-3">
        {/* Vertical line connector */}
        <div className="absolute top-6 bottom-0 w-0.5 bg-[var(--v2-border)]" style={{ [isRTL ? 'right' : 'left']: '11px' }} />

        {/* Status dot */}
        <div className={`relative z-10 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${colors.bg} border-2 ${colors.border}`}>
          <Icon className={`h-3 w-3 ${colors.icon}`} />
        </div>

        {/* Content */}
        <div className="flex-1 pb-4">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className={`text-sm font-medium ${
                status === 'completed' ? 'text-[var(--v2-text-primary)]' :
                status === 'active' ? 'text-amber-600 dark:text-amber-400' :
                status === 'failed' ? 'text-red-600 dark:text-red-400' :
                'text-[var(--v2-text-muted)]'
              }`}>
                {title}
              </p>
              <div className="mt-1">
                {content}
              </div>
            </div>

          </div>

          {/* Expandable button - styled as a proper button */}
          {expandable && !isExpanded && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleSection(sectionKey);
              }}
              className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#8B5CF6] bg-[#8B5CF6]/10 hover:bg-[#8B5CF6]/20 rounded-full transition-colors"
            >
              <Eye className="h-3 w-3" />
              {t('crm.intake.view_responses') || 'View responses'}
            </button>
          )}

          {/* Expanded content */}
          {expandable && isExpanded && expandedContent && (
            <div className="mt-3 p-4 bg-[var(--v2-bg)] rounded-xl border border-[var(--v2-border)] shadow-sm">
              {expandedContent}
              {/* Collapse button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSection(sectionKey);
                }}
                className="mt-3 flex items-center gap-1 text-xs text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)] transition-colors"
              >
                <ChevronUp className="h-3 w-3" />
                {t('common.hide') || 'Hide'}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

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
              const statusInfo = getBookingStatusLabel(booking.status);
              const isProduct = isProductBooking(booking);
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

                  {/* Expanded content - Full Journey from journeySteps */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-[var(--v2-border)]">
                      <div className="pt-4">

                        {/* Render journey steps dynamically */}
                        {session.journeySteps && session.journeySteps.length > 0 ? (
                          // Use provided journey steps
                          session.journeySteps.map((step, index) => {
                            const StepIcon = STEP_ICONS[step.key] || CheckCircle2;
                            const stepTitle = step.label || t(`crm.booking.step.${step.key}`) || step.key;
                            const isIntakeStep = step.key === 'intake';
                            const isConfirmationStep = step.key === 'confirmation';
                            const intakeExpandable = isIntakeStep && hasIntake;

                            return renderJourneyRow(
                              StepIcon,
                              stepTitle,
                              step.status,
                              <div className="space-y-1">
                                {step.details && (
                                  <p className="text-sm text-[var(--v2-text-primary)]">
                                    {step.details}
                                  </p>
                                )}
                                {/* For confirmation step without details, show "Email sent" */}
                                {isConfirmationStep && !step.details && step.status === 'completed' && (
                                  <p className="text-sm text-[var(--v2-text-primary)]">
                                    {t('crm.booking.email_sent')}
                                  </p>
                                )}
                                {/* Show timestamp - use full date+time for confirmation step */}
                                {step.timestamp && (
                                  <p className="text-xs text-[var(--v2-text-muted)]">
                                    {isConfirmationStep ? formatDateTime(step.timestamp) : formatShortDate(step.timestamp)}
                                  </p>
                                )}
                                {/* Special rendering for intake step with response count */}
                                {isIntakeStep && hasIntake && (
                                  <div className="flex items-center gap-2">
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-500/10 text-green-600 dark:text-green-400">
                                      <CheckCircle2 className="h-3 w-3" />
                                      {t('crm.booking.intake_completed') || 'Completed'}
                                    </span>
                                    <bdi className="text-xs text-[var(--v2-text-muted)]">
                                      {Object.keys(booking.intake_responses?.responses || {}).length} {t('crm.intake.responses')}
                                    </bdi>
                                  </div>
                                )}
                              </div>,
                              `${booking.id}-${step.key}-${index}`,
                              intakeExpandable,
                              intakeExpandable ? buildIntakeContent(booking, template) : undefined
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

                      {/* Edit button - only for services (with time slots), not for products */}
                      {onEditSession && !isProduct && (
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

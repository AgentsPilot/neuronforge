'use client';

import { useState } from 'react';
import { Calendar, Clock, CreditCard, ClipboardList, ChevronDown, ChevronUp, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';

interface IntakeResponses {
  template_id: string;
  template_key: string;
  responses: Record<string, unknown>;
}

interface IntakeTemplateField {
  key: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'tel' | 'email';
  label_en: string;
  label_es: string;
  label_he: string;
  required?: boolean;
  options?: Array<{
    value: string;
    label_en: string;
    label_es: string;
    label_he: string;
  }>;
}

interface IntakeTemplate {
  id: string;
  template_key: string;
  name_en: string;
  name_es: string;
  name_he: string;
  fields: IntakeTemplateField[];
}

interface SessionPayment {
  amount: number;
  currency: string;
  status: 'paid' | 'pending' | 'failed' | 'free';
  paidAt?: string;
}

interface SessionBooking {
  id: string;
  service_id: string;
  client_first_name: string;
  client_last_name?: string;
  start_time: string;
  end_time: string;
  timezone?: string;
  status: 'confirmed' | 'cancelled' | 'completed' | 'no_show';
  notes?: string;
  intake_responses?: IntakeResponses;
  intake_completed_at?: string;
  service?: {
    service_name: string;
  };
}

export interface SessionCardData {
  booking: SessionBooking;
  payment: SessionPayment | null;
}

interface SessionCardProps {
  session: SessionCardData;
  locale: string;
  isRTL: boolean;
  t: (key: string) => string;
  onEdit?: (bookingId: string) => void;
  onViewIntake?: (bookingId: string) => void;
  intakeTemplate?: IntakeTemplate;
}

const STATUS_STYLES = {
  // Booking status
  completed: { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400', icon: CheckCircle2 },
  confirmed: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400', icon: Clock },
  cancelled: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400', icon: XCircle },
  no_show: { bg: 'bg-slate-500/10', text: 'text-slate-600 dark:text-slate-400', icon: AlertCircle },
};

const PAYMENT_STATUS_STYLES = {
  paid: { bg: 'bg-green-500/10', text: 'text-green-600 dark:text-green-400' },
  pending: { bg: 'bg-amber-500/10', text: 'text-amber-600 dark:text-amber-400' },
  failed: { bg: 'bg-red-500/10', text: 'text-red-600 dark:text-red-400' },
  free: { bg: 'bg-slate-500/10', text: 'text-slate-600 dark:text-slate-400' },
};

export function SessionCard({ session, locale, isRTL, t, onEdit, onViewIntake, intakeTemplate }: SessionCardProps) {
  const [showIntake, setShowIntake] = useState(false);
  const { booking, payment } = session;

  // Helper to get translated field label
  const getFieldLabel = (key: string): string => {
    if (!intakeTemplate?.fields) return key.replace(/_/g, ' ');
    const field = intakeTemplate.fields.find(f => f.key === key);
    if (!field) return key.replace(/_/g, ' ');
    const langKey = `label_${locale}` as keyof typeof field;
    return (field[langKey] as string) || field.label_en;
  };

  // Helper to get translated option value
  const getOptionLabel = (key: string, value: string): string => {
    if (!intakeTemplate?.fields) return value;
    const field = intakeTemplate.fields.find(f => f.key === key);
    if (!field?.options) return value;
    const option = field.options.find(opt => opt.value === value);
    if (!option) return value;
    const langKey = `label_${locale}` as keyof typeof option;
    return (option[langKey] as string) || option.label_en || value;
  };

  // Helper to translate a value
  const translateValue = (key: string, value: unknown): string => {
    if (typeof value === 'boolean') {
      return value ? (t('common.yes') || 'Yes') : (t('common.no') || 'No');
    }
    if (typeof value === 'string') {
      // Check if it's a yes/no string
      if (value.toLowerCase() === 'yes') return t('common.yes') || 'Yes';
      if (value.toLowerCase() === 'no') return t('common.no') || 'No';
      // Check if it's an option value that needs translation
      return getOptionLabel(key, value);
    }
    if (Array.isArray(value)) {
      return value.map(v => typeof v === 'string' ? getOptionLabel(key, v) : String(v)).join(', ');
    }
    return String(value);
  };

  const bookingDate = new Date(booking.start_time);
  const endDate = new Date(booking.end_time);
  const isUpcoming = booking.status === 'confirmed' && bookingDate > new Date();
  const isPast = bookingDate < new Date();

  // Format date
  const formattedDate = bookingDate.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });

  // Format time
  const formattedTime = bookingDate.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
  });

  // Duration in minutes
  const durationMinutes = Math.round((endDate.getTime() - bookingDate.getTime()) / (1000 * 60));

  // Get booking status style
  const statusStyle = STATUS_STYLES[booking.status] || STATUS_STYLES.confirmed;
  const StatusIcon = statusStyle.icon;

  // Get payment info
  const hasPayment = payment !== null;
  const paymentStyle = payment ? PAYMENT_STATUS_STYLES[payment.status] : null;

  // Format payment amount
  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  // Check if intake exists
  const hasIntake = booking.intake_responses && Object.keys(booking.intake_responses.responses || {}).length > 0;

  const handleCardClick = () => {
    if (onEdit) {
      onEdit(booking.id);
    }
  };

  return (
    <div
      className={`border border-[var(--v2-border)] bg-[var(--v2-surface)] rounded-lg overflow-hidden transition-all hover:border-[#8B5CF6]/50 ${onEdit ? 'cursor-pointer' : ''}`}
      onClick={handleCardClick}
      dir={isRTL ? 'rtl' : 'ltr'}
    >
      {/* Main content */}
      <div className="p-4">
        {/* Header: Service name + Status */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <h4 className="font-medium text-[var(--v2-text-primary)] truncate">
              {booking.service?.service_name || t('crm.session.unknown_service')}
            </h4>
            <div className="flex items-center gap-2 mt-1 text-sm text-[var(--v2-text-secondary)]">
              <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{formattedDate}</span>
              <span className="text-[var(--v2-text-muted)]">•</span>
              <Clock className="h-3.5 w-3.5 flex-shrink-0" />
              <span>{formattedTime}</span>
              <span className="text-[var(--v2-text-muted)]">•</span>
              <span>{durationMinutes} {t('crm.session.minutes')}</span>
            </div>
          </div>

          {/* Status badge */}
          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
            <StatusIcon className="h-3.5 w-3.5" />
            <span>{t(`crm.booking.status.${booking.status}`)}</span>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-[var(--v2-border)] my-3" />

        {/* Payment row */}
        <div className="flex items-center gap-3">
          <CreditCard className="h-4 w-4 text-[var(--v2-text-muted)]" />
          {payment ? (
            <div className="flex items-center gap-2 flex-1">
              <span className="text-sm font-medium text-[var(--v2-text-primary)]">
                {payment.status === 'free'
                  ? t('crm.session.free')
                  : formatAmount(payment.amount, payment.currency)
                }
              </span>
              {payment.status !== 'free' && paymentStyle && (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${paymentStyle.bg} ${paymentStyle.text}`}>
                  {t(`crm.payment.status.${payment.status}`)}
                </span>
              )}
            </div>
          ) : (
            <span className="text-sm text-[var(--v2-text-muted)]">
              {t('crm.session.no_payment')}
            </span>
          )}
        </div>

        {/* Intake row - only show if intake exists */}
        {hasIntake && (
          <>
            <div className="flex items-center gap-3 mt-2">
              <ClipboardList className="h-4 w-4 text-[var(--v2-text-muted)]" />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowIntake(!showIntake);
                }}
                className="flex items-center gap-2 text-sm text-[#8B5CF6] hover:text-[#7C3AED] transition-colors"
              >
                <span>{t('crm.session.intake_completed')}</span>
                {showIntake ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>

            {/* Intake responses - expandable */}
            {showIntake && booking.intake_responses && (
              <div className="mt-3 p-3 bg-[var(--v2-bg)] rounded-lg border border-[var(--v2-border)]">
                <div className="space-y-2">
                  {Object.entries(booking.intake_responses.responses || {}).map(([key, value]) => (
                    <div key={key} className="flex flex-col gap-0.5">
                      <span className="text-xs font-medium text-[var(--v2-text-secondary)] uppercase">
                        {getFieldLabel(key)}
                      </span>
                      <span className="text-sm text-[var(--v2-text-primary)]">
                        {translateValue(key, value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Notes - only show if exists */}
        {booking.notes && (
          <div className="mt-3 p-2 bg-[var(--v2-bg)] rounded text-sm text-[var(--v2-text-secondary)] italic">
            {booking.notes}
          </div>
        )}
      </div>
    </div>
  );
}

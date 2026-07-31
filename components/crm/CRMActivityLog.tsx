'use client';

import { useState, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { Mail, Phone, Calendar, DollarSign, MessageSquare, FileText, Bot, User, UserPlus } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import type { CRMActivity } from '@/lib/repositories/CRMActivityRepository';

const ACTIVITY_ICONS: Record<string, React.ReactNode> = {
  note: <FileText className="h-4 w-4" />,
  email: <Mail className="h-4 w-4" />,
  call: <Phone className="h-4 w-4" />,
  meeting: <MessageSquare className="h-4 w-4" />,
  booking: <Calendar className="h-4 w-4" />,
  payment: <DollarSign className="h-4 w-4" />,
  document_uploaded: <FileText className="h-4 w-4" />,
  contact_created: <UserPlus className="h-4 w-4" />
};

const ACTIVITY_COLORS: Record<string, string> = {
  note: 'bg-slate-500/20 text-slate-600 dark:text-slate-400',
  email: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  call: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  meeting: 'bg-green-500/20 text-green-600 dark:text-green-400',
  booking: 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  payment: 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  document_uploaded: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
  contact_created: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400'
};

// Format activity title - handles database-stored titles like "Booking: ServiceName"
const formatActivityTitle = (
  title: string,
  activityType: string,
  t: (key: string) => string
): string => {
  // Handle "Booking: ServiceName"
  if (activityType === 'booking') {
    const bookingMatch = title.match(/^Booking:\s*(.+)$/);
    if (bookingMatch) {
      return `${t('crm.activity.title.booking')}: ${bookingMatch[1]}`;
    }
  }

  // Handle "Payment Received: $100"
  if (activityType === 'payment') {
    const paymentMatch = title.match(/^Payment Received:\s*(.+)$/);
    if (paymentMatch) {
      return `${t('crm.activity.title.payment_received')}: ${paymentMatch[1]}`;
    }
  }

  // Handle "Email Sent: Subject"
  if (activityType === 'email') {
    const emailMatch = title.match(/^Email Sent:\s*(.+)$/);
    if (emailMatch) {
      return `${t('crm.activity.title.email_sent')}: ${emailMatch[1]}`;
    }
  }

  // Return as-is for other titles
  return title;
};

// Format activity description - handles both old format and new JSON format
const formatActivityDescription = (
  description: string | null | undefined,
  activityType: string,
  t: (key: string) => string
): string | null => {
  if (!description) return null;

  // For document_uploaded activities, try to parse JSON format first
  if (activityType === 'document_uploaded') {
    // Try to parse as JSON (new format)
    try {
      const data = JSON.parse(description);
      if (data.document_type && data.file_name) {
        const typeLabel = t('crm.activity.desc.type');
        const fileLabel = t('crm.activity.desc.file');
        const docTypeTranslation = t(`crm.document.type.${data.document_type}`);
        const docType = docTypeTranslation !== `crm.document.type.${data.document_type}`
          ? docTypeTranslation
          : data.document_type;
        return `${typeLabel}: ${docType} | ${fileLabel}: ${data.file_name}`;
      }
    } catch {
      // Not JSON, try old format
    }

    // Handle old format: "Type: xxx | File: yyy"
    const oldFormatMatch = description.match(/^Type:\s*(\w+)\s*\|\s*File:\s*(.+)$/);
    if (oldFormatMatch) {
      const typeLabel = t('crm.activity.desc.type');
      const fileLabel = t('crm.activity.desc.file');
      const docTypeTranslation = t(`crm.document.type.${oldFormatMatch[1]}`);
      const docType = docTypeTranslation !== `crm.document.type.${oldFormatMatch[1]}`
        ? docTypeTranslation
        : oldFormatMatch[1];
      return `${typeLabel}: ${docType} | ${fileLabel}: ${oldFormatMatch[2]}`;
    }
  }

  // For contact_created activities, parse JSON and translate
  if (activityType === 'contact_created') {
    try {
      const data = JSON.parse(description);
      const sourceKey = `crm.source.${data.source}`;
      const sourceTranslation = t(sourceKey);
      const source = sourceTranslation !== sourceKey ? sourceTranslation : data.source;
      const stageKey = `crm.stage.${data.stage}`;
      const stageTranslation = t(stageKey);
      const stage = stageTranslation !== stageKey ? stageTranslation : data.stage;
      return `${t('crm.activity.desc.source')}: ${source} | ${t('crm.activity.desc.stage')}: ${stage}`;
    } catch {
      // Not JSON, return as-is
    }
  }

  // For booking activities, translate common English phrases
  if (activityType === 'booking') {
    // Translate "No reason provided"
    if (description === 'No reason provided') {
      return t('crm.activity.desc.no_reason');
    }
    // Translate "Client did not attend scheduled session"
    if (description === 'Client did not attend scheduled session') {
      return t('crm.activity.desc.client_no_show');
    }
    // Translate "Scheduled for YYYY-MM-DD HH:MM"
    const scheduledMatch = description.match(/^Scheduled for (.+)$/);
    if (scheduledMatch) {
      return `${t('crm.activity.desc.scheduled_for')} ${scheduledMatch[1]}`;
    }
    // Translate "Booked via website for DATE (paid)"
    const bookedViaPaidMatch = description.match(/^Booked via website for (.+) \(paid\)$/);
    if (bookedViaPaidMatch) {
      return `${t('crm.activity.desc.booked_via_website')} ${bookedViaPaidMatch[1]} (${t('crm.activity.desc.paid')})`;
    }
    // Translate "Booked via website for DATE - Paid CURRENCY AMOUNT"
    const bookedViaCurrencyMatch = description.match(/^Booked via website for (.+) - Paid (.+)$/);
    if (bookedViaCurrencyMatch) {
      return `${t('crm.activity.desc.booked_via_website')} ${bookedViaCurrencyMatch[1]} - ${t('crm.activity.desc.paid')} ${bookedViaCurrencyMatch[2]}`;
    }
    // Translate "Booked via website for DATE"
    const bookedViaMatch = description.match(/^Booked via website for (.+)$/);
    if (bookedViaMatch) {
      return `${t('crm.activity.desc.booked_via_website')} ${bookedViaMatch[1]}`;
    }
  }

  // Return as-is for other activity types
  return description;
};

export function CRMActivityLog() {
  const { t } = useLanguage();
  const [activities, setActivities] = useState<CRMActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchActivities();
  }, []);

  const fetchActivities = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/crm/activities?limit=50');
      const data = await response.json();

      if (data.success) {
        setActivities(data.activities);
      }
    } catch (error) {
      console.error('Failed to fetch activities:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date: string) => {
    const activityDate = new Date(date);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - activityDate.getTime()) / 1000);

    if (diffInSeconds < 60) return t('crm.activity.just_now');
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} ${t('crm.table.min_ago')}`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} ${t('crm.table.hours_ago')}`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} ${t('crm.table.days_ago')}`;

    return activityDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: activityDate.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-[var(--v2-primary)] border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-[var(--v2-text-secondary)] font-medium">{t('crm.activity.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="space-y-4">
        {activities.map(activity => {
          // Translate the activity title (handles patterns like "Booking: ServiceName")
          const displayTitle = formatActivityTitle(activity.title, activity.activity_type, t);

          return (
          <div
            key={activity.id}
            className="bg-[var(--v2-surface)] border border-[var(--v2-border)] p-4"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className={`p-2 rounded-lg ${ACTIVITY_COLORS[activity.activity_type] || 'bg-slate-500/20 text-slate-600'}`}>
                {ACTIVITY_ICONS[activity.activity_type] || <FileText className="h-4 w-4" />}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h4 className="font-medium text-[var(--v2-text-primary)]">
                        {displayTitle}
                      </h4>
                      {activity.auto_logged ? (
                        <Badge className="text-xs gap-1 bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30">
                          <Bot className="h-3 w-3" />
                          {t('crm.activity.auto')}
                        </Badge>
                      ) : (
                        <Badge className="text-xs gap-1 bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30">
                          <User className="h-3 w-3" />
                          {t('crm.activity.manual')}
                        </Badge>
                      )}
                    </div>
                    {activity.description && (
                      <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                        {formatActivityDescription(activity.description, activity.activity_type, t)}
                      </p>
                    )}
                    {activity.source_capability && (
                      <div className="mt-2">
                        <Badge variant="secondary" className="text-xs">
                          {activity.source_capability}
                        </Badge>
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-[var(--v2-text-muted)] whitespace-nowrap">
                    {formatDate(activity.activity_date)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
        })}

        {activities.length === 0 && (
          <div className="text-center py-12 text-[var(--v2-text-muted)]">
            {t('crm.activity.no_activity')}
          </div>
        )}
      </div>
    </div>
  );
}

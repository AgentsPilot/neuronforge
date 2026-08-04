'use client';

import { useState } from 'react';
import {
  Activity, Plus, MessageSquare, Phone, Mail, Users,
  Calendar, CreditCard, FileText, ChevronDown, Clock, Bot, User, Eye
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from '../CollapsibleSection';
import type { CRMActivity } from './types';
import type { ContactEmail } from './types';

interface ActivitySectionProps {
  activities: CRMActivity[];
  emails?: ContactEmail[];
  t: (key: string) => string;
  isRTL: boolean;
  language: string;
  onAddActivity?: (type: string, description: string) => void;
  isLoading?: boolean;
  isLoadingEmails?: boolean;
}

// Manual activity types for adding new activities
const MANUAL_ACTIVITY_TYPES = [
  { value: 'note', labelKey: 'crm.activity.type.note', icon: MessageSquare },
  { value: 'call', labelKey: 'crm.activity.type.call', icon: Phone },
  { value: 'email', labelKey: 'crm.activity.type.email', icon: Mail },
  { value: 'meeting', labelKey: 'crm.activity.type.meeting', icon: Users }
];

// Filter categories for filtering the activity list
const FILTER_CATEGORIES = [
  { value: 'all', labelKey: 'crm.activity.filter.all', icon: Activity, types: [] },
  { value: 'note', labelKey: 'crm.activity.filter.notes', icon: MessageSquare, types: ['note'] },
  { value: 'call', labelKey: 'crm.activity.filter.calls', icon: Phone, types: ['call'] },
  { value: 'email', labelKey: 'crm.activity.filter.emails', icon: Mail, types: ['email', 'email_sent'] },
  { value: 'meeting', labelKey: 'crm.activity.filter.meetings', icon: Users, types: ['meeting'] },
  { value: 'booking', labelKey: 'crm.activity.filter.bookings', icon: Calendar, types: ['booking', 'booking_created', 'booking_completed', 'booking_cancelled', 'booking_confirmed'] },
  { value: 'payment', labelKey: 'crm.activity.filter.payments', icon: CreditCard, types: ['payment', 'payment_received', 'payment_failed'] },
  { value: 'task', labelKey: 'crm.activity.filter.tasks', icon: FileText, types: ['task', 'task_created', 'task_completed'] }
];

const ACTIVITY_ICONS: Record<string, typeof Activity> = {
  note: MessageSquare,
  call: Phone,
  email: Mail,
  meeting: Users,
  booking_created: Calendar,
  booking_completed: Calendar,
  booking_cancelled: Calendar,
  payment_received: CreditCard,
  payment_failed: CreditCard,
  document_uploaded: FileText,
  contact_created: Activity,
  contact_updated: Activity,
  stage_changed: Activity
};

const ACTIVITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  note: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-500' },
  call: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-500' },
  email: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-500' },
  meeting: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-500' },
  booking_created: { bg: 'bg-teal-500/10', border: 'border-teal-500/30', text: 'text-teal-500' },
  booking_completed: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-500' },
  booking_cancelled: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-500' },
  payment_received: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-500' },
  payment_failed: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-500' },
  document_uploaded: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-500' },
  contact_created: { bg: 'bg-slate-500/10', border: 'border-slate-500/30', text: 'text-slate-500' },
  contact_updated: { bg: 'bg-slate-500/10', border: 'border-slate-500/30', text: 'text-slate-500' },
  stage_changed: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-500' }
};

const EMAIL_STATUS_COLORS: Record<string, string> = {
  sent: 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  delivered: 'bg-green-500/20 text-green-600 dark:text-green-400',
  opened: 'bg-purple-500/20 text-purple-600 dark:text-purple-400',
  clicked: 'bg-indigo-500/20 text-indigo-600 dark:text-indigo-400',
  bounced: 'bg-red-500/20 text-red-600 dark:text-red-400',
  failed: 'bg-red-500/20 text-red-600 dark:text-red-400',
  pending: 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400'
};

export function ActivitySection({
  activities,
  emails = [],
  t,
  isRTL,
  language,
  onAddActivity,
  isLoading = false,
  isLoadingEmails = false
}: ActivitySectionProps) {
  const [selectedType, setSelectedType] = useState('note');
  const [activityText, setActivityText] = useState('');
  const [activeSubTab, setActiveSubTab] = useState<'activity' | 'emails'>('activity');
  const [filterType, setFilterType] = useState<string | null>(null); // null = show all

  const handleAddActivity = () => {
    if (activityText.trim() && onAddActivity) {
      onAddActivity(selectedType, activityText.trim());
      setActivityText('');
    }
  };

  const formatActivityTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return t('crm.activity.just_now') || 'Just now';
    if (diffMins < 60) return `${diffMins}${t('crm.activity.mins_ago') || 'm ago'}`;
    if (diffHours < 24) return `${diffHours}${t('crm.activity.hours_ago') || 'h ago'}`;
    if (diffDays < 7) return `${diffDays}${t('crm.activity.days_ago') || 'd ago'}`;

    return date.toLocaleDateString(language, {
      month: 'short',
      day: 'numeric'
    });
  };

  const getActivityIcon = (type: string) => {
    // Normalize: convert spaces to underscores for lookup
    const normalizedType = type.replace(/\s+/g, '_');
    return ACTIVITY_ICONS[normalizedType] || Activity;
  };

  const getActivityColors = (type: string) => {
    // Normalize: convert spaces to underscores for lookup
    const normalizedType = type.replace(/\s+/g, '_');
    return ACTIVITY_COLORS[normalizedType] || { bg: 'bg-slate-500/10', border: 'border-slate-500/30', text: 'text-slate-500' };
  };

  // System activity types that should be translated (auto-logged activities)
  const SYSTEM_ACTIVITY_TYPES = [
    'booking', 'payment', 'email', 'task',
    'booking_created', 'booking_completed', 'booking_cancelled', 'booking_confirmed',
    'payment_received', 'payment_failed',
    'document_uploaded',
    'contact_created', 'contact_updated',
    'stage_changed',
    'task_created', 'task_completed',
    'email_sent'
  ];

  const isSystemActivity = (activity: CRMActivity) => {
    // Normalize activity type: convert spaces to underscores for comparison
    const normalizedType = activity.activity_type.replace(/\s+/g, '_');
    return activity.auto_logged || SYSTEM_ACTIVITY_TYPES.includes(normalizedType);
  };

  // Translate English descriptions stored in DB to the current language
  const translateDescription = (description: string | null, activityType?: string): string | null => {
    if (!description) return null;

    // Try to parse JSON descriptions (document_uploaded, contact_created, etc.)
    try {
      const data = JSON.parse(description);

      // JSON format for document_uploaded: { document_type, file_name }
      if (data.document_type && data.file_name) {
        const typeLabel = t('crm.activity.desc.type');
        const fileLabel = t('crm.activity.desc.file');
        const docTypeKey = `crm.document.type.${data.document_type}`;
        const docTypeTranslation = t(docTypeKey);
        const docType = docTypeTranslation !== docTypeKey ? docTypeTranslation : data.document_type;
        return `${typeLabel}: ${docType} | ${fileLabel}: ${data.file_name}`;
      }

      // JSON format for contact_created: { source, stage }
      if (data.source && data.stage) {
        const sourceKey = `crm.source.${data.source}`;
        const sourceTranslation = t(sourceKey);
        const source = sourceTranslation !== sourceKey ? sourceTranslation : data.source;
        const stageKey = `crm.stage.${data.stage}`;
        const stageTranslation = t(stageKey);
        const stage = stageTranslation !== stageKey ? stageTranslation : data.stage;
        return `${t('crm.activity.desc.source')}: ${source} | ${t('crm.activity.desc.stage')}: ${stage}`;
      }
    } catch {
      // Not JSON, continue with string pattern matching
    }

    // Pattern: "No reason provided"
    if (description === 'No reason provided') {
      const translated = t('crm.activity.desc.no_reason');
      if (translated !== 'crm.activity.desc.no_reason') {
        return translated;
      }
    }

    // Pattern: "Client did not attend scheduled session"
    if (description === 'Client did not attend scheduled session') {
      const translated = t('crm.activity.desc.client_no_show');
      if (translated !== 'crm.activity.desc.client_no_show') {
        return translated;
      }
    }

    // Pattern: "Booked via website for DATE (paid)"
    const bookedPaidMatch = description.match(/^Booked via website for (.+) \(paid\)$/);
    if (bookedPaidMatch) {
      const template = t('crm.activity.description.booked_via_website_paid');
      if (template !== 'crm.activity.description.booked_via_website_paid') {
        return template.replace('{date}', bookedPaidMatch[1]);
      }
      // Fallback to label-based translation
      const bookedVia = t('crm.activity.desc.booked_via_website');
      const paid = t('crm.activity.desc.paid');
      if (bookedVia !== 'crm.activity.desc.booked_via_website') {
        return `${bookedVia} ${bookedPaidMatch[1]} (${paid})`;
      }
    }

    // Pattern: "Booked via website for DATE - Paid CURRENCY AMOUNT"
    const bookedViaCurrencyMatch = description.match(/^Booked via website for (.+) - Paid (.+)$/);
    if (bookedViaCurrencyMatch) {
      const bookedVia = t('crm.activity.desc.booked_via_website');
      const paid = t('crm.activity.desc.paid');
      if (bookedVia !== 'crm.activity.desc.booked_via_website') {
        return `${bookedVia} ${bookedViaCurrencyMatch[1]} - ${paid} ${bookedViaCurrencyMatch[2]}`;
      }
    }

    // Pattern: "Booked via website for DATE"
    const bookedMatch = description.match(/^Booked via website for (.+)$/);
    if (bookedMatch) {
      const template = t('crm.activity.description.booked_via_website');
      if (template !== 'crm.activity.description.booked_via_website') {
        return template.replace('{date}', bookedMatch[1]);
      }
      // Fallback to label-based translation
      const bookedVia = t('crm.activity.desc.booked_via_website');
      if (bookedVia !== 'crm.activity.desc.booked_via_website') {
        return `${bookedVia} ${bookedMatch[1]}`;
      }
    }

    // Pattern: "Purchased via website (paid)"
    if (description === 'Purchased via website (paid)') {
      const translated = t('crm.activity.description.purchased_via_website_paid');
      if (translated !== 'crm.activity.description.purchased_via_website_paid') {
        return translated;
      }
      // Fallback
      const purchased = t('crm.activity.desc.purchased_via_website');
      const paid = t('crm.activity.desc.paid');
      if (purchased !== 'crm.activity.desc.purchased_via_website') {
        return `${purchased} (${paid})`;
      }
    }

    // Pattern: "Purchased via website"
    if (description === 'Purchased via website') {
      const translated = t('crm.activity.description.purchased_via_website');
      if (translated !== 'crm.activity.description.purchased_via_website') {
        return translated;
      }
      // Fallback
      const purchased = t('crm.activity.desc.purchased_via_website');
      if (purchased !== 'crm.activity.desc.purchased_via_website') {
        return purchased;
      }
    }

    // Pattern: "Scheduled for DATE"
    const scheduledMatch = description.match(/^Scheduled for (.+)$/);
    if (scheduledMatch) {
      const template = t('crm.activity.description.scheduled_for');
      if (template !== 'crm.activity.description.scheduled_for') {
        return template.replace('{date}', scheduledMatch[1]);
      }
      // Fallback
      const scheduledFor = t('crm.activity.desc.scheduled_for');
      if (scheduledFor !== 'crm.activity.desc.scheduled_for') {
        return `${scheduledFor} ${scheduledMatch[1]}`;
      }
    }

    // Pattern: "Manual email"
    if (description === 'Manual email' || description.toLowerCase() === 'manual email') {
      const translated = t('crm.activity.description.manual_email');
      if (translated !== 'crm.activity.description.manual_email') {
        return translated;
      }
      // Fallback
      const manualEmail = t('crm.activity.desc.manual_email');
      if (manualEmail !== 'crm.activity.desc.manual_email') {
        return manualEmail;
      }
    }

    // Pattern: "Campaign email"
    if (description === 'Campaign email') {
      const translated = t('crm.activity.desc.campaign_email');
      if (translated !== 'crm.activity.desc.campaign_email') {
        return translated;
      }
    }

    // Pattern: "Email Sent: SUBJECT" - translate prefix
    const emailSentMatch = description.match(/^Email Sent: (.+)$/);
    if (emailSentMatch) {
      const emailSentTranslated = t('crm.activity.type.email_sent');
      if (emailSentTranslated !== 'crm.activity.type.email_sent') {
        return `${emailSentTranslated}: ${emailSentMatch[1]}`;
      }
    }

    // Pattern: "Payment Received: $AMOUNT" or "Payment Received: CURRENCY AMOUNT"
    const paymentReceivedMatch = description.match(/^Payment Received: (.+)$/);
    if (paymentReceivedMatch) {
      const paymentTranslated = t('crm.activity.type.payment_received');
      if (paymentTranslated !== 'crm.activity.type.payment_received') {
        return `${paymentTranslated}: ${paymentReceivedMatch[1]}`;
      }
    }

    // Pattern: "Payment Failed: $AMOUNT" or "Payment Failed: CURRENCY AMOUNT"
    const paymentFailedMatch = description.match(/^Payment Failed: (.+)$/);
    if (paymentFailedMatch) {
      const paymentTranslated = t('crm.activity.type.payment_failed');
      if (paymentTranslated !== 'crm.activity.type.payment_failed') {
        return `${paymentTranslated}: ${paymentFailedMatch[1]}`;
      }
    }

    // Pattern: "Type: xxx | File: yyy" (document uploads - old format)
    const typeFileMatch = description.match(/^Type:\s*(\w+)\s*\|\s*File:\s*(.+)$/);
    if (typeFileMatch) {
      const typeLabel = t('crm.activity.desc.type');
      const fileLabel = t('crm.activity.desc.file');
      const docTypeKey = `crm.document.type.${typeFileMatch[1]}`;
      const docTypeTranslation = t(docTypeKey);
      const docType = docTypeTranslation !== docTypeKey ? docTypeTranslation : typeFileMatch[1];
      if (typeLabel !== 'crm.activity.desc.type') {
        return `${typeLabel}: ${docType} | ${fileLabel}: ${typeFileMatch[2]}`;
      }
    }

    // Pattern: "Source: xxx | Stage: yyy" (contact created - old format)
    const sourceStageMatch = description.match(/^Source:\s*(.+)\s*\|\s*Stage:\s*(.+)$/);
    if (sourceStageMatch) {
      const sourceLabel = t('crm.activity.desc.source');
      const stageLabel = t('crm.activity.desc.stage');
      const sourceKey = `crm.source.${sourceStageMatch[1].trim()}`;
      const sourceTranslation = t(sourceKey);
      const source = sourceTranslation !== sourceKey ? sourceTranslation : sourceStageMatch[1].trim();
      const stageKey = `crm.stage.${sourceStageMatch[2].trim()}`;
      const stageTranslation = t(stageKey);
      const stage = stageTranslation !== stageKey ? stageTranslation : sourceStageMatch[2].trim();
      if (sourceLabel !== 'crm.activity.desc.source') {
        return `${sourceLabel}: ${source} | ${stageLabel}: ${stage}`;
      }
    }

    // No translation needed or available
    return description;
  };

  // Translate English title stored in DB to the current language
  const translateTitle = (title: string | null): string | null => {
    if (!title) return null;

    // Pattern: "Booking: SERVICE_NAME"
    const bookingMatch = title.match(/^Booking: (.+)$/);
    if (bookingMatch) {
      const bookingTranslated = t('crm.activity.type.booking');
      if (bookingTranslated !== 'crm.activity.type.booking') {
        return `${bookingTranslated}: ${bookingMatch[1]}`;
      }
    }

    // Pattern: "Booking Confirmed: SERVICE_NAME"
    const bookingConfirmedMatch = title.match(/^Booking Confirmed: (.+)$/);
    if (bookingConfirmedMatch) {
      const bookingConfirmedTranslated = t('crm.activity.type.booking_confirmed');
      if (bookingConfirmedTranslated !== 'crm.activity.type.booking_confirmed') {
        return `${bookingConfirmedTranslated}: ${bookingConfirmedMatch[1]}`;
      }
    }

    // Pattern: "Payment Received: $AMOUNT"
    const paymentMatch = title.match(/^Payment Received: \$(.+)$/);
    if (paymentMatch) {
      const paymentTranslated = t('crm.activity.type.payment_received');
      if (paymentTranslated !== 'crm.activity.type.payment_received') {
        return `${paymentTranslated}: $${paymentMatch[1]}`;
      }
    }

    // Pattern: "Email Sent: SUBJECT"
    const emailMatch = title.match(/^Email Sent: (.+)$/);
    if (emailMatch) {
      const emailTranslated = t('crm.activity.type.email_sent');
      if (emailTranslated !== 'crm.activity.type.email_sent') {
        return `${emailTranslated}: ${emailMatch[1]}`;
      }
    }

    // Pattern: "Document Uploaded: FILENAME"
    const docMatch = title.match(/^Document Uploaded: (.+)$/);
    if (docMatch) {
      const docTranslated = t('crm.activity.type.document_uploaded');
      if (docTranslated !== 'crm.activity.type.document_uploaded') {
        return `${docTranslated}: ${docMatch[1]}`;
      }
    }

    // Pattern: "Task Completed: TASK_NAME"
    const taskMatch = title.match(/^Task Completed: (.+)$/);
    if (taskMatch) {
      const taskTranslated = t('crm.activity.type.task_completed');
      if (taskTranslated !== 'crm.activity.type.task_completed') {
        return `${taskTranslated}: ${taskMatch[1]}`;
      }
    }

    return title;
  };

  const getActivityLabel = (activity: CRMActivity) => {
    // Normalize activity type: convert spaces to underscores for translation lookup
    const activityType = activity.activity_type.replace(/\s+/g, '_');

    // Try to get system translation first
    const systemKey = `crm.activity.system.${activityType}`;
    const systemTranslated = t(systemKey);
    if (systemTranslated !== systemKey) {
      // For system activities, show translated type + translated description if available
      if (activity.description) {
        const translatedDesc = translateDescription(activity.description);
        return `${systemTranslated}: ${translatedDesc || activity.description}`;
      }
      return systemTranslated;
    }

    // Try type translation
    const typeKey = `crm.activity.type.${activityType}`;
    const typeTranslated = t(typeKey);
    if (typeTranslated !== typeKey) {
      if (activity.description) {
        const translatedDesc = translateDescription(activity.description);
        return `${typeTranslated}: ${translatedDesc || activity.description}`;
      }
      return typeTranslated;
    }

    // Fallback: format the activity type nicely
    return translateDescription(activity.description) || activity.description || activityType.replace(/_/g, ' ');
  };

  // Get display title - always use translation for system activities
  const getDisplayTitle = (activity: CRMActivity) => {
    // For system/auto-logged activities, try to translate title
    if (isSystemActivity(activity)) {
      // First try to translate the stored title
      const translatedTitle = translateTitle(activity.title);
      if (translatedTitle && translatedTitle !== activity.title) {
        return translatedTitle;
      }
      // Fall back to activity label
      return getActivityLabel(activity);
    }
    // For manual user activities (note, call, meeting), use description or title
    return activity.description || activity.title || getActivityLabel(activity);
  };

  return (
    <CollapsibleSection
      title={t('crm.drawer.section_activity') || 'Activity'}
      icon={<Activity className="h-4 w-4" />}
      defaultOpen={true}
      isRTL={isRTL}
      badge={
        (activities.length > 0 || emails.length > 0) && (
          <span className="text-xs text-[var(--v2-text-muted)]">
            {activities.length + emails.length}
          </span>
        )
      }
    >
      <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>
        {/* Sub-tabs for Activity vs Emails */}
        <div className="flex gap-1 p-1 bg-[var(--v2-surface)] rounded-lg border border-[var(--v2-border)]">
          <button
            type="button"
            onClick={() => setActiveSubTab('activity')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              activeSubTab === 'activity'
                ? 'bg-[var(--v2-bg)] text-[#8B5CF6] shadow-sm'
                : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)]'
            }`}
          >
            <Activity className="h-3.5 w-3.5" />
            {t('crm.activity.tab.activity') || 'Activity'}
            {activities.length > 0 && (
              <span className="text-xs bg-[#8B5CF6]/10 text-[#8B5CF6] px-1.5 py-0.5 rounded-full">
                {activities.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('emails')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium rounded-md transition-all ${
              activeSubTab === 'emails'
                ? 'bg-[var(--v2-bg)] text-[#8B5CF6] shadow-sm'
                : 'text-[var(--v2-text-muted)] hover:text-[var(--v2-text-secondary)]'
            }`}
          >
            <Mail className="h-3.5 w-3.5" />
            {t('crm.activity.tab.emails') || 'Emails'}
            {emails.length > 0 && (
              <span className="text-xs bg-[#8B5CF6]/10 text-[#8B5CF6] px-1.5 py-0.5 rounded-full">
                {emails.length}
              </span>
            )}
          </button>
        </div>

        {/* Activity Sub-tab Content */}
        {activeSubTab === 'activity' && (
          <>
            {/* Quick add activity */}
            {onAddActivity && (
              <div className="space-y-2">
                {/* Input row */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={activityText}
                    onChange={(e) => setActivityText(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddActivity()}
                    placeholder={t('crm.activity.add_placeholder') || 'Add a note...'}
                    className="flex-1 h-10 w-full rounded-md border px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#8B5CF6] border-[var(--v2-border)] focus:border-[#8B5CF6] text-start placeholder:text-[var(--v2-text-muted)] bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                  />
                  <Button
                    type="button"
                    onClick={handleAddActivity}
                    size="sm"
                    disabled={!activityText.trim()}
                    className="px-3 bg-[#8B5CF6] hover:bg-[#7C3AED] text-white disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}

            {/* Filter badges - show only categories that have activities */}
            {activities.length > 0 && (
              <div className="flex gap-1 flex-wrap">
                {FILTER_CATEGORIES.map(category => {
                  const Icon = category.icon;
                  // For "all", always show
                  if (category.value === 'all') {
                    return (
                      <button
                        key={category.value}
                        type="button"
                        onClick={() => setFilterType(null)}
                        className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full transition-all ${
                          filterType === null
                            ? 'bg-[#8B5CF6] text-white'
                            : 'bg-[var(--v2-surface)] text-[var(--v2-text-muted)] hover:bg-[var(--v2-surface-hover)] border border-[var(--v2-border)]'
                        }`}
                      >
                        {t(category.labelKey)}
                      </button>
                    );
                  }
                  // Count activities matching this category
                  const count = activities.filter(a => {
                    const normalizedType = a.activity_type.replace(/\s+/g, '_');
                    return category.types.includes(normalizedType);
                  }).length;
                  if (count === 0) return null;
                  return (
                    <button
                      key={category.value}
                      type="button"
                      onClick={() => setFilterType(filterType === category.value ? null : category.value)}
                      className={`flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full transition-all ${
                        filterType === category.value
                          ? 'bg-[#8B5CF6] text-white'
                          : 'bg-[var(--v2-surface)] text-[var(--v2-text-muted)] hover:bg-[var(--v2-surface-hover)] border border-[var(--v2-border)]'
                      }`}
                    >
                      <Icon className="h-3 w-3" />
                      {t(category.labelKey)}
                      <span className="opacity-70">({count})</span>
                    </button>
                  );
                })}
              </div>
            )}


            {/* Activity timeline */}
            {(() => {
              // Filter activities based on selected filter
              const filteredActivities = filterType
                ? activities.filter(a => {
                    const normalizedType = a.activity_type.replace(/\s+/g, '_');
                    const category = FILTER_CATEGORIES.find(c => c.value === filterType);
                    return category ? category.types.includes(normalizedType) : true;
                  })
                : activities;

              if (isLoading) {
                return (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-start gap-3 animate-pulse">
                        <div className="w-6 h-6 bg-[var(--v2-border)] rounded-full" />
                        <div className="flex-1">
                          <div className="h-4 bg-[var(--v2-border)] rounded w-3/4 mb-1" />
                          <div className="h-3 bg-[var(--v2-border)] rounded w-1/4" />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }

              if (activities.length === 0) {
                return (
                  <div className="text-center py-4">
                    <Activity className="h-8 w-8 text-[var(--v2-text-muted)] mx-auto mb-2" />
                    <p className="text-sm text-[var(--v2-text-muted)]">
                      {t('crm.drawer.no_activity') || 'No activity yet'}
                    </p>
                  </div>
                );
              }

              if (filteredActivities.length === 0) {
                return (
                  <div className="text-center py-4">
                    <Activity className="h-8 w-8 text-[var(--v2-text-muted)] mx-auto mb-2" />
                    <p className="text-sm text-[var(--v2-text-muted)]">
                      {t('crm.activity.no_matching') || 'No matching activities'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setFilterType(null)}
                      className="text-xs text-[#8B5CF6] hover:underline mt-1"
                    >
                      {t('crm.activity.clear_filter') || 'Clear filter'}
                    </button>
                  </div>
                );
              }

              return (
                <div className="space-y-0">
                  {/* Timeline with filtered activities */}
                  {filteredActivities.map((activity, index) => {
                    const Icon = getActivityIcon(activity.activity_type);
                    const colors = getActivityColors(activity.activity_type);
                    const activityDate = new Date(activity.created_at);
                    const isLast = index === filteredActivities.length - 1;

                  return (
                    <div key={activity.id} className="flex items-start gap-3">
                      {/* Timeline line and icon */}
                      <div className="relative flex-shrink-0">
                        <div className={`w-8 h-8 rounded-full ${colors.bg} border ${colors.border} flex items-center justify-center`}>
                          <Icon className={`h-4 w-4 ${colors.text}`} />
                        </div>
                        {/* Timeline line */}
                        {!isLast && (
                          <div className="absolute top-8 left-1/2 -translate-x-1/2 w-px h-full min-h-[40px] bg-[var(--v2-border)]" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 pb-4 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-[var(--v2-text-primary)] break-words">
                              {getDisplayTitle(activity)}
                            </p>
                            {activity.description && activity.title && (
                              <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5 break-words">
                                {translateDescription(activity.description)}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {activity.auto_logged ? (
                              <Badge className="text-xs gap-1 bg-purple-500/20 text-purple-600 dark:text-purple-400 border-purple-500/30 px-1.5 py-0.5">
                                <Bot className="h-3 w-3" />
                              </Badge>
                            ) : (
                              <Badge className="text-xs gap-1 bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30 px-1.5 py-0.5">
                                <User className="h-3 w-3" />
                              </Badge>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)]">
                          <span className={`px-1.5 py-0.5 rounded ${colors.bg} ${colors.text}`}>
                            {(() => {
                              // Normalize activity type: convert spaces to underscores for translation lookup
                              const normalizedType = activity.activity_type.replace(/\s+/g, '_');
                              const typeKey = `crm.activity.type.${normalizedType}`;
                              const translated = t(typeKey);
                              return translated !== typeKey ? translated : activity.activity_type.replace(/_/g, ' ');
                            })()}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatActivityTime(activity.created_at)}
                          </span>
                          <span className="hidden sm:inline">
                            {activityDate.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                  })}
                </div>
              );
            })()}
          </>
        )}

        {/* Emails Sub-tab Content */}
        {activeSubTab === 'emails' && (
          <div className="space-y-0">
            {isLoadingEmails ? (
              <div className="space-y-3">
                {[1, 2].map((i) => (
                  <div key={i} className="flex items-start gap-3 animate-pulse">
                    <div className="w-8 h-8 bg-[var(--v2-border)] rounded-full" />
                    <div className="flex-1">
                      <div className="h-4 bg-[var(--v2-border)] rounded w-3/4 mb-2" />
                      <div className="h-3 bg-[var(--v2-border)] rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : emails.length === 0 ? (
              <div className="text-center py-6">
                <Mail className="h-8 w-8 text-[var(--v2-text-muted)] mx-auto mb-2" />
                <p className="text-sm text-[var(--v2-text-muted)]">
                  {t('crm.drawer.no_emails') || 'No emails sent'}
                </p>
                <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                  {t('crm.drawer.no_emails_hint') || 'Emails sent to this contact will appear here'}
                </p>
              </div>
            ) : (
              /* Email timeline - same style as activity */
              emails.map((email, index) => {
                const sentDate = email.sent_at ? new Date(email.sent_at) : new Date(email.created_at);
                const statusColor = EMAIL_STATUS_COLORS[email.status] || 'bg-slate-500/20 text-slate-600';
                const isLast = index === emails.length - 1;

                return (
                  <div key={email.id} className="flex items-start gap-3">
                    {/* Timeline line and icon */}
                    <div className="relative flex-shrink-0">
                      <div className="w-8 h-8 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                        <Mail className="h-4 w-4 text-purple-500" />
                      </div>
                      {/* Timeline line */}
                      {!isLast && (
                        <div className="absolute top-8 left-1/2 -translate-x-1/2 w-px h-full min-h-[40px] bg-[var(--v2-border)]" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 pb-4 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-[var(--v2-text-primary)] truncate flex-1">
                          {email.subject}
                        </p>
                        <Badge className={`text-xs ${statusColor} flex-shrink-0`}>
                          {t(`crm.email.status.${email.status}`) || email.status}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)] flex-wrap">
                        <span className="flex items-center gap-1">
                          <Mail className="h-3 w-3" />
                          {email.to_email}
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {sentDate.toLocaleDateString(language)} {sentDate.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      {email.opened_at && (
                        <div className="mt-1.5 text-xs text-green-600 dark:text-green-400 flex items-center gap-1">
                          <Eye className="h-3 w-3" />
                          {t('crm.email.opened_at') || 'Opened:'} {new Date(email.opened_at).toLocaleString(language)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}

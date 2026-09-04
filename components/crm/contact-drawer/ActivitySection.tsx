'use client';

import { useState } from 'react';
import { activityFieldName } from '@/lib/business-os/activityText';
import {
  Activity, Plus, MessageSquare, Phone, Mail, Users,
  Calendar, CreditCard, FileText, ChevronDown, Clock, Bot, User, Eye,
  Paperclip, ClipboardList, UserCog, RotateCcw
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
  { value: 'booking', labelKey: 'crm.activity.filter.bookings', icon: Calendar, types: ['booking', 'booking_created', 'booking_completed', 'booking_cancelled', 'booking_confirmed', 'booking_confirmation_sent', 'booking_rescheduled', 'booking_no_show'] },
  { value: 'payment', labelKey: 'crm.activity.filter.payments', icon: CreditCard, types: ['payment', 'payment_received', 'payment_failed', 'invoice_sent', 'refund_issued'] },
  { value: 'task', labelKey: 'crm.activity.filter.tasks', icon: FileText, types: ['task', 'task_created', 'task_completed'] },
  { value: 'forms', labelKey: 'crm.activity.filter.forms', icon: ClipboardList, types: ['intake_form_sent', 'intake_form_completed'] },
  { value: 'files', labelKey: 'crm.activity.filter.files', icon: Paperclip, types: ['document_uploaded'] },
  // The record's own history: when it was created, and every edit since.
  // Without a category these rows were reachable only under "all" — invisible
  // the moment any chip was pressed.
  { value: 'changes', labelKey: 'crm.activity.filter.changes', icon: UserCog, types: ['contact_created', 'contact_updated', 'stage_changed'] }
];


const ACTIVITY_ICONS: Record<string, typeof Activity> = {
  note: MessageSquare,
  call: Phone,
  email: Mail,
  email_sent: Mail,
  meeting: Users,
  booking_created: Calendar,
  booking_completed: Calendar,
  booking_no_show: Clock,
  booking_rescheduled: Calendar,
  booking_confirmed: Calendar,
  booking_cancelled: Calendar,
  booking_confirmation_sent: Mail,
  intake_form_sent: FileText,
  intake_form_completed: FileText,
  invoice_sent: CreditCard,
  payment_received: CreditCard,
  refund_issued: RotateCcw,
  payment_failed: CreditCard,
  task_created: ClipboardList,
  task_completed: ClipboardList,
  document_uploaded: FileText,
  contact_created: Activity,
  contact_updated: Activity,
  stage_changed: Activity
};

/*
 * Every type the drawer can draw must be reachable by some chip.
 *
 * `contact_updated` and `stage_changed` were written and then unfindable, and
 * `document_uploaded` and `contact_created` had the same gap. Asserted in
 * development so the next type added to `ACTIVITY_ICONS` cannot quietly become
 * invisible behind a filter.
 */
if (process.env.NODE_ENV === 'development') {
  const covered = new Set(FILTER_CATEGORIES.flatMap(category => category.types));
  const orphaned = Object.keys(ACTIVITY_ICONS).filter(type => !covered.has(type));
  if (orphaned.length > 0) {
    // eslint-disable-next-line no-console
    console.warn('[ActivitySection] activity types no filter can reach:', orphaned);
  }
}

const ACTIVITY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  note: { bg: 'bg-blue-500/10', border: 'border-blue-500/30', text: 'text-blue-500' },
  call: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-500' },
  email: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-500' },
  email_sent: { bg: 'bg-purple-500/10', border: 'border-purple-500/30', text: 'text-purple-500' },
  meeting: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-500' },
  booking_created: { bg: 'bg-teal-500/10', border: 'border-teal-500/30', text: 'text-teal-500' },
  booking_completed: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-500' },
  booking_cancelled: { bg: 'bg-red-500/10', border: 'border-red-500/30', text: 'text-red-500' },
  booking_confirmation_sent: { bg: 'bg-teal-500/10', border: 'border-teal-500/30', text: 'text-teal-500' },
  intake_form_sent: { bg: 'bg-indigo-500/10', border: 'border-indigo-500/30', text: 'text-indigo-500' },
  intake_form_completed: { bg: 'bg-green-500/10', border: 'border-green-500/30', text: 'text-green-500' },
  invoice_sent: { bg: 'bg-amber-500/10', border: 'border-amber-500/30', text: 'text-amber-500' },
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

  /**
   * A booking time, as the business keeps it.
   *
   * Short on purpose — "7 Sep, 13:00" — because these read inside a sentence,
   * not as a heading.
   *
   * The zone travels with the row rather than arriving as a prop: an activity
   * records what was agreed at the time, and a business that later changes its
   * timezone must not silently rewrite the hour of every appointment already in
   * the history. Falls back to the viewer's zone only when a row predates this.
   */
  const formatActivityMoment = (value: string, timeZone?: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(language, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: language === 'en',
      ...(timeZone ? { timeZone } : {}),
    });
  };

  /**
   * Which row is open. One at a time — a timeline with several panels open is
   * the wall of detail this was meant to avoid.
   */
  const [openRow, setOpenRow] = useState<string | null>(null);

  /**
   * The few facts a row can answer for itself.
   *
   * Deliberately three lines at most. An email says whether it arrived and
   * whether it was read; a change says what the value was before. Anything
   * longer belongs on the record itself, not in a timeline.
   */
  const rowDetail = (activity: CRMActivity): { label: string; value: string }[] => {
    const rows: { label: string; value: string }[] = [];

    // A change: what it was, what it is now.
    try {
      const data = JSON.parse(activity.description || '');
      if (data.kind === 'contact_updated' && data.changes) {
        for (const [field, change] of Object.entries(data.changes as Record<string, { from?: unknown; to?: unknown }>)) {
          /*
           * The same names the sentence above the row was written from.
           *
           * This looked up `crm.field.*`, which exists in no language, so every
           * label fell through to the raw column name — a Hebrew row opening to
           * "first name: דוד → דויד". `activityFieldName` is the one place those
           * names live, and it is a pure module, so the drawer can share it
           * with the writers rather than keeping a second list that drifts.
           */
          const fieldLabel = activityFieldName(field, language);
          const was = change?.from ?? '';
          const now = change?.to ?? '';
          rows.push({
            label: fieldLabel,
            value: `${was === '' || was === null ? t('crm.activity.detail.empty') : String(was)} → ${now === '' || now === null ? t('crm.activity.detail.empty') : String(now)}`,
          });
        }
        return rows;
      }

      if (data.kind === 'booking_rescheduled' && data.from && data.to) {
        rows.push({ label: t('crm.activity.detail.was'), value: formatActivityMoment(data.from, data.timeZone) });
        rows.push({ label: t('crm.activity.detail.now'), value: formatActivityMoment(data.to, data.timeZone) });
        return rows;
      }

      /*
       * The outcome events: completed, no-show, confirmed, cancelled.
       *
       * All four answer the same two questions — when was the appointment, and
       * what did it move from — so they share a shape rather than each growing
       * its own branch.
       */
      if (
        data.kind === 'booking_completed' ||
        data.kind === 'booking_no_show' ||
        data.kind === 'booking_confirmed'
      ) {
        if (data.from) {
          rows.push({ label: t('crm.activity.detail.was'), value: formatActivityMoment(data.from, data.timeZone) });
        }
        if (data.previousStatus) {
          const key = `crm.booking.status.${data.previousStatus}`;
          rows.push({
            label: t('crm.activity.detail.previous_status'),
            value: t(key) !== key ? t(key) : String(data.previousStatus),
          });
        }
        return rows;
      }

      if (data.kind === 'task_created' || data.kind === 'task_completed') {
        if (data.dueDate) {
          rows.push({ label: t('crm.activity.detail.due'), value: formatActivityMoment(data.dueDate) });
        }
        if (data.priority) {
          const key = `crm.task.priority.${data.priority}`;
          rows.push({ label: t('crm.activity.detail.priority'), value: t(key) !== key ? t(key) : String(data.priority) });
        }
        return rows;
      }

      if (data.kind === 'booking_created') {
        if (data.service) rows.push({ label: t('crm.activity.detail.service'), value: String(data.service) });
        if (data.bookingDate) {
          rows.push({ label: t('crm.activity.detail.now'), value: formatActivityMoment(data.bookingDate, data.timeZone) });
        }
        return rows;
      }

      if (data.kind === 'payment_received' || data.kind === 'payment_failed' || data.kind === 'refund_issued') {
        if (data.service) rows.push({ label: t('crm.activity.detail.service'), value: String(data.service) });
        if (data.invoiceNumber) rows.push({ label: t('crm.activity.detail.invoice'), value: String(data.invoiceNumber) });
        if (data.receipt) rows.push({ label: t('crm.activity.detail.receipt'), value: String(data.receipt) });
        if (data.reason) rows.push({ label: t('crm.activity.detail.reason'), value: String(data.reason) });
        return rows;
      }

      if (data.kind === 'booking_cancelled') {
        if (data.from) {
          rows.push({ label: t('crm.activity.detail.was'), value: formatActivityMoment(data.from, data.timeZone) });
        }
        // The reason only when somebody gave one — an empty "Reason: —" is noise.
        if (data.reason) {
          rows.push({ label: t('crm.activity.detail.reason'), value: String(data.reason) });
        }
        return rows;
      }
    } catch {
      // Not a fact row; fall through to the email lookup below.
    }

    // An email: did it arrive, was it read.
    const email = emails?.find(e => e.id === activity.source_entity_id);
    if (email) {
      if (email.sent_at) {
        rows.push({ label: t('crm.activity.detail.sent'), value: formatActivityMoment(email.sent_at) });
      }
      rows.push({
        label: t('crm.activity.detail.opened'),
        value: email.opened_at
          ? formatActivityMoment(email.opened_at)
          : t('crm.activity.detail.not_opened'),
      });
    }

    return rows;
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
    'booking_confirmation_sent',
    'intake_form_sent', 'intake_form_completed',
    'invoice_sent',
    'payment_received', 'payment_failed',
    'document_uploaded',
    'contact_created', 'contact_updated',
    'stage_changed',
    'task_created', 'task_completed',
    'email_sent'
  ];

  /** Whether the description is structured facts rather than a sentence. */
  const isFactRow = (activity: CRMActivity) => {
    if (!activity.description) return false;
    try {
      return typeof JSON.parse(activity.description)?.kind === 'string';
    } catch {
      return false;
    }
  };

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

      /*
       * A row written by the platform carries its own sentence.
       *
       * It was composed on the server, in the language the business was working
       * in, at the moment it happened — an activity is a record, not a label,
       * and switching the dashboard later must not re-narrate the past. So it is
       * printed exactly as stored; the facts beside it exist for the drill-down.
       */
      if (typeof data.text === 'string' && data.text.length > 0) {
        return data.text;
      }

      /*
       * A description that is purely facts says nothing on its own.
       *
       * The sentence lives in `title` — written server-side in the business's
       * language — and this column carries only the before/after behind it, for
       * the drill-down. Composing a second sentence here would print the row
       * twice, which is the duplication this set out to remove.
       */
      if (typeof data.kind === 'string') {
        return null;
      }

      /*
       * Rows written before that, which carry facts and no sentence. Composed
       * here so they still read, rather than showing nothing.
       */
      // `t` here takes a key only, so the values are substituted at the call
      // site — the same `{name}` convention the rest of the platform uses.
      const fill = (key: string, values: Record<string, string>) => {
        let text = t(key);
        if (text === key) return null; // key missing: say nothing rather than print it
        for (const [name, value] of Object.entries(values)) {
          text = text.replace(`{${name}}`, value);
        }
        return text;
      };

      if (data.kind === 'booking_rescheduled' && data.from && data.to) {
        return fill('crm.activity.desc.rescheduled', {
          from: formatActivityMoment(data.from, data.timeZone),
          to: formatActivityMoment(data.to, data.timeZone),
        });
      }

      if (data.kind === 'booking_confirmation_sent' || data.kind === 'intake_form_sent') {
        const base = data.kind === 'booking_confirmation_sent' ? 'confirmation_sent' : 'intake_sent';
        return data.bookingDate
          ? fill(`crm.activity.desc.${base}_dated`, {
              service: data.service || '',
              date: formatActivityMoment(data.bookingDate, data.timeZone),
            })
          : fill(`crm.activity.desc.${base}`, { service: data.service || '' });
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

    /*
     * Rows written before activities stored facts.
     *
     * These sentences are already in the database in English, so they can only
     * be met with pattern matching. New rows carry JSON and are composed above;
     * these two exist so the history a business already has stops reading half
     * in English.
     *
     * The captured date is reformatted rather than echoed: it was written by
     * `toLocaleDateString()` on the server, so it arrives as `9/7/2026` — and
     * as `12/31/1969` for a booking that never had a time, which is said as
     * nothing at all rather than repeated.
     */
    const legacyDated = (
      pattern: RegExp,
      datedKey: string,
      plainKey: string
    ): string | null => {
      const match = description.match(pattern);
      if (!match) return null;

      const raw = match[1];
      const parsed = new Date(raw);
      const isEpoch = !Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() <= 1970;
      const readable = Number.isNaN(parsed.getTime()) || isEpoch ? null : formatActivityMoment(raw);

      const key = readable ? datedKey : plainKey;
      const text = t(key);
      if (text === key) return null;
      return text.replace('{service}', '').replace('{date}', readable || '').replace(/\s+/g, ' ').trim();
    };

    const legacyConfirmation = legacyDated(
      /^Confirmation email sent for booking on (.+)$/,
      'crm.activity.desc.confirmation_sent_dated',
      'crm.activity.desc.confirmation_sent'
    );
    if (legacyConfirmation) return legacyConfirmation;

    const legacyIntake = legacyDated(
      /^Intake form request sent for booking on (.+)$/,
      'crm.activity.desc.intake_sent_dated',
      'crm.activity.desc.intake_sent'
    );
    if (legacyIntake) return legacyIntake;

    // Pattern: "Scheduled for DATE"
    const scheduledMatch = description.match(/^Scheduled for (.+)$/);
    if (scheduledMatch) {
      const template = t('crm.activity.description.scheduled_for');
      if (template !== 'crm.activity.description.scheduled_for') {
        // Reformatted, not echoed: it was stored as a raw machine date.
        const readable = formatActivityMoment(scheduledMatch[1]) || scheduledMatch[1];
        return template.replace('{date}', readable);
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
      const bookingTranslated = t('crm.activity.title.booking');
      if (bookingTranslated !== 'crm.activity.title.booking') {
        return `${bookingTranslated}: ${bookingMatch[1]}`;
      }
    }

    // Pattern: "Booking Confirmed: SERVICE_NAME"
    const bookingConfirmedMatch = title.match(/^Booking Confirmed: (.+)$/);
    if (bookingConfirmedMatch) {
      const bookingConfirmedTranslated = t('crm.activity.title.booking_confirmed');
      if (bookingConfirmedTranslated !== 'crm.activity.title.booking_confirmed') {
        return `${bookingConfirmedTranslated}: ${bookingConfirmedMatch[1]}`;
      }
    }

    // Pattern: "Payment Received: $AMOUNT"
    const paymentMatch = title.match(/^Payment Received: \$(.+)$/);
    if (paymentMatch) {
      const paymentTranslated = t('crm.activity.title.payment_received');
      if (paymentTranslated !== 'crm.activity.title.payment_received') {
        return `${paymentTranslated}: $${paymentMatch[1]}`;
      }
    }

    // Pattern: "Email Sent: SUBJECT"
    const emailMatch = title.match(/^Email Sent: (.+)$/);
    if (emailMatch) {
      const emailTranslated = t('crm.activity.title.email_sent');
      if (emailTranslated !== 'crm.activity.title.email_sent') {
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
    // Never the raw payload: a fact row's description is JSON, and printing it
    // put `{"kind":"contact_updated",…}` on the timeline.
    return (
      translateDescription(activity.description) ||
      (isFactRow(activity) ? null : activity.description) ||
      activityType.replace(/_/g, ' ')
    );
  };

  // Get display title - always use translation for system activities
  const getDisplayTitle = (activity: CRMActivity) => {
    /*
     * A row written by the platform already says what it says.
     *
     * Its title was composed server-side in the business's language at the
     * moment it happened, so it is printed verbatim — translating it would
     * re-narrate history, and falling through to `getActivityLabel` printed the
     * raw JSON facts, because that helper ends in `|| activity.description`.
     */
    if (activity.title && isFactRow(activity)) {
      return activity.title;
    }

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
    return translateDescription(activity.description) || activity.title || getActivityLabel(activity);
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
              const byFilter = filterType
                ? activities.filter(a => {
                    const normalizedType = a.activity_type.replace(/\s+/g, '_');
                    const category = FILTER_CATEGORIES.find(c => c.value === filterType);
                    return category ? category.types.includes(normalizedType) : true;
                  })
                : activities;

              /*
               * One event, one row.
               *
               * Every outgoing message was logged twice: once by the thing that
               * happened — `booking_confirmation_sent`, `intake_form_sent` —
               * and again as a generic `email` row for the message about it. So
               * a single booking produced five entries, three of them about
               * email, and a client who rescheduled four times filled the
               * timeline with four identical lines.
               *
               * The `email` copy is the one that goes: it carries a subject and
               * "Manual email", where the system row names the actual event and
               * links to the booking. Kept only where nothing else covers it —
               * a genuine one-off message still has its place.
               */
              const systemWindowMs = 2 * 60 * 1000;
              const systemMoments = byFilter
                .filter(a => a.activity_type !== 'email')
                .map(a => new Date(a.activity_date || a.created_at).getTime());

              const deduped = byFilter.filter(activity => {
                if (activity.activity_type !== 'email') return true;
                const at = new Date(activity.activity_date || activity.created_at).getTime();
                // Covered by the system row it was sent for.
                return !systemMoments.some(moment => Math.abs(moment - at) < systemWindowMs);
              });

              /*
               * The same thing said twice in a row is said once, with a count.
               *
               * A confirmation resent three times is one fact about this client,
               * not three — and the repetition is what makes a timeline
               * unreadable rather than informative.
               */
              const filteredActivities: (CRMActivity & { repeatCount?: number })[] = [];
              for (const activity of deduped) {
                const previous = filteredActivities[filteredActivities.length - 1];
                const sameThing =
                  previous &&
                  previous.activity_type === activity.activity_type &&
                  previous.title === activity.title &&
                  previous.description === activity.description;

                if (sameThing) {
                  previous.repeatCount = (previous.repeatCount || 1) + 1;
                  continue;
                }
                filteredActivities.push({ ...activity });
              }

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
                              {/* Collapsed, not hidden: the reader is told how
                                  many times it happened, because "sent four
                                  times" is itself worth knowing. */}
                              {(activity as { repeatCount?: number }).repeatCount && (
                                <span className="ms-1.5 text-xs font-normal text-[var(--v2-text-muted)]">
                                  ×{(activity as { repeatCount?: number }).repeatCount}
                                </span>
                              )}
                            </p>
                            {/* The second line only when it says something the
                                first does not. The two were rendered whenever
                                both existed, so a row whose title and
                                description were the same sentence printed it
                                twice and then its own type underneath. */}
                            {(() => {
                              const detail = translateDescription(activity.description);
                              if (!detail || detail === getDisplayTitle(activity)) return null;
                              return (
                                <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5 break-words">
                                  {detail}
                                </p>
                              );
                            })()}

                            {/* Drill-down: only offered where there is
                                something worth opening, so most rows carry no
                                affordance at all. */}
                            {(() => {
                              const details = rowDetail(activity);
                              if (details.length === 0) return null;
                              const isOpen = openRow === activity.id;
                              return (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => setOpenRow(isOpen ? null : activity.id)}
                                    className="mt-1 text-xs text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                                  >
                                    {isOpen ? '▾' : (isRTL ? '◂' : '▸')} {t('crm.activity.details') !== 'crm.activity.details' ? t('crm.activity.details') : ''}
                                  </button>
                                  {isOpen && (
                                    <div className="mt-1.5 ps-2 border-s-2 border-[var(--v2-border)] space-y-0.5">
                                      {details.map(row => (
                                        <p key={row.label} className="text-xs text-[var(--v2-text-secondary)] break-words">
                                          <span className="text-[var(--v2-text-muted)]">{row.label}:</span> {row.value}
                                        </p>
                                      ))}
                                    </div>
                                  )}
                                </>
                              );
                            })()}
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

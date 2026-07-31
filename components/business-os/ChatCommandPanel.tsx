'use client';

import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { Send, CheckCircle2, Bot, User, Phone, Mail, ExternalLink, Edit3, Trash2, Power, Calendar, Clock, AlertCircle, X, RefreshCw, DollarSign, FileText } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { DialogAction, PendingContext } from '@/lib/business-os/DraftManagerTypes';

interface EntityCardAction {
  type: 'navigate' | 'edit' | 'call' | 'email' | 'deactivate' | 'delete' | 'complete' | 'reschedule' | 'cancel' | 'send_invoice' | 'mark_paid';
  label: string;
  labelHe?: string;
  destination?: string;
  params?: Record<string, string>;
}

interface EntityCard {
  entityType: string;
  entity: Record<string, unknown>;
  actions: EntityCardAction[];
}

interface BookingListItem {
  id: string;
  serviceName: string;
  contactName?: string;
  startTime: string;
  endTime?: string;
  status: string;
}

interface ChatMessage {
  type: 'ai' | 'user' | 'success' | 'entity_card' | 'booking_list';
  content: string;
  entityCard?: EntityCard;
  bookingList?: BookingListItem[];
}

interface ChatCommandPanelProps {
  onCommand?: (command: string, route: string | null) => void;
  onAction?: (action: DialogAction) => void;
  onPublishDraft?: () => void;
  onConfirmUpdate?: () => void;
  onCancelUpdate?: () => void;
  expanded?: boolean;
}

export interface ChatCommandPanelRef {
  addMessage: (type: 'ai' | 'success', content: string) => void;
  setSuggestions: (suggestions: string[]) => void;
}

// Helper function to get entity display name based on type
function getEntityDisplayName(entity: Record<string, unknown>, entityType: string): string {
  if (entityType === 'contacts') {
    const firstName = (entity.first_name || '') as string;
    const lastName = (entity.last_name || '') as string;
    return `${firstName} ${lastName}`.trim() || (entity.email as string) || 'Contact';
  }
  if (entityType === 'services') {
    return (entity.service_name || entity.name || 'Service') as string;
  }
  if (entityType === 'tasks') {
    return (entity.title || 'Task') as string;
  }
  if (entityType === 'invoices') {
    const invoiceNumber = entity.invoice_number as string;
    return invoiceNumber ? `Invoice #${invoiceNumber}` : `Invoice #${entity.id}`;
  }
  return (entity.name || entity.title || 'Item') as string;
}

// Entity Card Message Component
function EntityCardMessage({
  entityCard,
  router,
  isHebrew,
  onCompleteTask,
  onEditEntity,
  onOpenBooking,
  onSendInvoice,
  onMarkInvoicePaid
}: {
  entityCard: EntityCard;
  router: ReturnType<typeof useRouter>;
  isHebrew: boolean;
  onCompleteTask?: (taskId: string) => Promise<void>;
  onEditEntity?: (entityType: string, entityId: string, entity: Record<string, unknown>) => void;
  onOpenBooking?: (bookingId: string) => void;
  onSendInvoice?: (invoiceId: string) => void;
  onMarkInvoicePaid?: (invoiceId: string) => void;
}) {
  const entityName = getEntityDisplayName(entityCard.entity, entityCard.entityType);

  return (
    <div className="flex items-start gap-2">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: 'linear-gradient(135deg, #FFB454 0%, #F97316 100%)' }}
      >
        <Bot className="w-3.5 h-3.5 text-white" strokeWidth={2.2} />
      </div>
      <div
        className="bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-sm overflow-hidden w-full max-w-[320px]"
        style={{ borderRadius: '12px' }}
      >
        {/* Entity Header */}
        <div
          className="px-4 py-3 border-b border-[var(--v2-border)]"
          style={{ background: 'linear-gradient(135deg, rgba(249,115,22,0.05) 0%, rgba(255,180,84,0.05) 100%)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm"
              style={{ background: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)' }}
            >
              {entityName.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[var(--v2-text-primary)] truncate">
                {entityName}
              </div>
              <div className="text-xs text-[var(--v2-text-muted)] capitalize">
                {entityCard.entityType.replace('_', ' ')}
              </div>
            </div>
          </div>
        </div>

        {/* Entity Details - varies by entity type */}
        <div className="px-4 py-3 space-y-2">
          {/* Contact fields */}
          {entityCard.entity.email && (
            <div className="flex items-center gap-2 text-sm">
              <Mail className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
              <span className="text-[var(--v2-text-secondary)] truncate">
                {entityCard.entity.email as string}
              </span>
            </div>
          )}
          {entityCard.entity.phone && (
            <div className="flex items-center gap-2 text-sm">
              <Phone className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
              <span className="text-[var(--v2-text-secondary)]">
                {entityCard.entity.phone as string}
              </span>
            </div>
          )}

          {/* Task fields */}
          {entityCard.entityType === 'tasks' && (
            <>
              {entityCard.entity.due_date && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    {new Date(entityCard.entity.due_date as string).toLocaleDateString(isHebrew ? 'he-IL' : 'en-US', {
                      weekday: 'short',
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                </div>
              )}
              {entityCard.entity.status && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  <span className={`capitalize ${
                    entityCard.entity.status === 'completed' ? 'text-green-600 dark:text-green-400' :
                    entityCard.entity.status === 'overdue' ? 'text-red-600 dark:text-red-400' :
                    'text-[var(--v2-text-secondary)]'
                  }`}>
                    {isHebrew ? (
                      entityCard.entity.status === 'pending' ? 'ממתין' :
                      entityCard.entity.status === 'in_progress' ? 'בתהליך' :
                      entityCard.entity.status === 'completed' ? 'הושלם' :
                      entityCard.entity.status
                    ) : entityCard.entity.status as string}
                  </span>
                </div>
              )}
              {entityCard.entity.priority && entityCard.entity.priority !== 'medium' && (
                <div className="flex items-center gap-2 text-sm">
                  <AlertCircle className={`w-3.5 h-3.5 ${
                    entityCard.entity.priority === 'high' ? 'text-red-500 dark:text-red-400' :
                    entityCard.entity.priority === 'low' ? 'text-gray-400 dark:text-gray-500' :
                    'text-[var(--v2-text-muted)]'
                  }`} />
                  <span className={`capitalize ${
                    entityCard.entity.priority === 'high' ? 'text-red-600 dark:text-red-400 font-medium' :
                    'text-[var(--v2-text-secondary)]'
                  }`}>
                    {isHebrew ? (
                      entityCard.entity.priority === 'high' ? 'עדיפות גבוהה' :
                      entityCard.entity.priority === 'low' ? 'עדיפות נמוכה' :
                      entityCard.entity.priority
                    ) : `${entityCard.entity.priority} priority`}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Service fields */}
          {entityCard.entityType === 'services' && (
            <>
              {entityCard.entity.price !== undefined && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--v2-text-muted)]">₪</span>
                  <span className="text-[var(--v2-text-secondary)] font-medium">
                    {entityCard.entity.price as number}
                  </span>
                </div>
              )}
              {entityCard.entity.duration_minutes && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    {entityCard.entity.duration_minutes} {isHebrew ? 'דקות' : 'minutes'}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Booking fields */}
          {entityCard.entityType === 'bookings' && entityCard.entity.start_time && (
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
              <span className="text-[var(--v2-text-secondary)]">
                {new Date(entityCard.entity.start_time as string).toLocaleString(isHebrew ? 'he-IL' : 'en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </span>
            </div>
          )}

          {/* Invoice fields */}
          {entityCard.entityType === 'invoices' && (
            <>
              {/* Amount */}
              {(entityCard.entity.amount !== undefined || entityCard.entity.total_amount !== undefined) && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[var(--v2-text-muted)]">{entityCard.entity.currency || '₪'}</span>
                  <span className="text-[var(--v2-text-secondary)] font-medium">
                    {(entityCard.entity.amount ?? entityCard.entity.total_amount) as number}
                  </span>
                </div>
              )}
              {/* Status */}
              {entityCard.entity.status && (
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  <span className={`capitalize ${
                    entityCard.entity.status === 'paid' ? 'text-green-600 dark:text-green-400' :
                    entityCard.entity.status === 'overdue' ? 'text-red-600 dark:text-red-400' :
                    (entityCard.entity.status === 'sent' || entityCard.entity.status === 'pending') ? 'text-orange-500 dark:text-orange-400' :
                    'text-[var(--v2-text-secondary)]'
                  }`}>
                    {isHebrew ? (
                      entityCard.entity.status === 'draft' ? 'טיוטה' :
                      entityCard.entity.status === 'sent' ? 'נשלחה' :
                      entityCard.entity.status === 'pending' ? 'ממתינה' :
                      entityCard.entity.status === 'paid' ? 'שולמה' :
                      entityCard.entity.status === 'overdue' ? 'באיחור' :
                      entityCard.entity.status === 'cancelled' ? 'בוטלה' :
                      entityCard.entity.status
                    ) : entityCard.entity.status as string}
                  </span>
                </div>
              )}
              {/* Due date */}
              {entityCard.entity.due_date && (
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    {isHebrew ? 'תאריך יעד: ' : 'Due: '}
                    {new Date(entityCard.entity.due_date as string).toLocaleDateString(isHebrew ? 'he-IL' : 'en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric'
                    })}
                  </span>
                </div>
              )}
              {/* Contact name */}
              {entityCard.entity.contact_name && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
                  <span className="text-[var(--v2-text-secondary)]">
                    {entityCard.entity.contact_name as string}
                  </span>
                </div>
              )}
            </>
          )}

          {/* Notes (for all entity types) */}
          {entityCard.entity.notes && (
            <div className="text-xs text-[var(--v2-text-muted)] mt-2 line-clamp-2">
              {entityCard.entity.notes as string}
            </div>
          )}
        </div>

        {/* Actions */}
        {entityCard.actions.length > 0 && (
          <div className="px-3 py-2 border-t border-[var(--v2-border)] bg-[var(--v2-bg)] flex flex-wrap gap-1.5">
            {entityCard.actions.map((action, actionIndex) => {
              const isDestructive = action.type === 'delete' || action.type === 'deactivate';
              const actionLabel = action.labelHe && isHebrew ? action.labelHe : action.label;

              const ActionIcon = action.type === 'navigate' ? ExternalLink
                : action.type === 'edit' ? Edit3
                : action.type === 'call' ? Phone
                : action.type === 'email' ? Mail
                : action.type === 'deactivate' ? Power
                : action.type === 'delete' ? Trash2
                : action.type === 'complete' ? CheckCircle2
                : action.type === 'reschedule' ? RefreshCw
                : action.type === 'cancel' ? X
                : action.type === 'send_invoice' ? FileText
                : action.type === 'mark_paid' ? DollarSign
                : ExternalLink;

              return (
                <button
                  key={actionIndex}
                  onClick={async () => {
                    if (action.type === 'navigate' && action.destination) {
                      const url = new URL(action.destination, window.location.origin);
                      if (action.params) {
                        Object.entries(action.params).forEach(([key, value]) => {
                          url.searchParams.set(key, value);
                        });
                      }
                      router.push(url.pathname + url.search);
                    } else if (action.type === 'call' && entityCard.entity.phone) {
                      window.open(`tel:${entityCard.entity.phone}`);
                    } else if (action.type === 'email' && entityCard.entity.email) {
                      window.open(`mailto:${entityCard.entity.email}`);
                    } else if (action.type === 'complete' && entityCard.entity.id && onCompleteTask) {
                      await onCompleteTask(entityCard.entity.id as string);
                    } else if (action.type === 'edit' && entityCard.entity.id && onEditEntity) {
                      onEditEntity(entityCard.entityType, entityCard.entity.id as string, entityCard.entity);
                    } else if ((action.type === 'reschedule' || action.type === 'cancel') && entityCard.entity.id && onOpenBooking) {
                      // Both reschedule and cancel open the booking modal which has these options
                      onOpenBooking(entityCard.entity.id as string);
                    } else if (action.type === 'send_invoice' && entityCard.entity.id && onSendInvoice) {
                      onSendInvoice(entityCard.entity.id as string);
                    } else if (action.type === 'mark_paid' && entityCard.entity.id && onMarkInvoicePaid) {
                      onMarkInvoicePaid(entityCard.entity.id as string);
                    }
                  }}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${
                    isDestructive
                      ? 'text-red-600 hover:bg-red-500/10 dark:hover:bg-red-500/20'
                      : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)] hover:text-[#F97316]'
                  }`}
                >
                  <ActionIcon className="w-3 h-3" />
                  {actionLabel}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// Booking List Message Component - displays multiple bookings as styled cards
function BookingListMessage({
  bookings,
  isHebrew,
  onOpenBooking
}: {
  bookings: BookingListItem[];
  isHebrew: boolean;
  onOpenBooking?: (bookingId: string) => void;
}) {
  const formatDateTime = (isoString: string) => {
    const date = new Date(isoString);
    return {
      date: date.toLocaleDateString(isHebrew ? 'he-IL' : 'en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }),
      time: date.toLocaleTimeString(isHebrew ? 'he-IL' : 'en-US', {
        hour: '2-digit',
        minute: '2-digit'
      })
    };
  };

  return (
    <div className="flex items-start gap-2">
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
        style={{ background: 'linear-gradient(135deg, #FFB454 0%, #F97316 100%)' }}
      >
        <Bot className="w-3.5 h-3.5 text-white" strokeWidth={2.2} />
      </div>
      <div className="flex-1 space-y-2 max-w-[340px]">
        {/* Header */}
        <div className="text-sm font-medium text-[var(--v2-text-primary)]">
          {isHebrew ? 'הפגישות הקרובות שלך:' : 'Your upcoming meetings:'}
        </div>

        {/* Booking Cards */}
        {bookings.map((booking, index) => {
          const { date, time } = formatDateTime(booking.startTime);
          const displayName = booking.contactName || booking.serviceName;

          return (
            <div
              key={booking.id}
              onClick={() => onOpenBooking?.(booking.id)}
              className="bg-[var(--v2-surface)] border border-[var(--v2-border)] overflow-hidden cursor-pointer hover:border-[#F97316] transition-colors group"
              style={{ borderRadius: '10px' }}
            >
              <div className="px-3 py-2.5 flex items-center gap-3">
                {/* Avatar/Number */}
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm flex-shrink-0"
                  style={{ background: 'linear-gradient(135deg, #F97316 0%, #EA580C 100%)' }}
                >
                  {displayName.charAt(0).toUpperCase()}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-[var(--v2-text-primary)] truncate group-hover:text-[#F97316] transition-colors">
                    {displayName}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[var(--v2-text-muted)]">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>{date}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>{time}</span>
                    </div>
                  </div>
                </div>

                {/* Arrow indicator */}
                <ExternalLink className="w-4 h-4 text-[var(--v2-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              {/* Action buttons - opens booking modal where user can reschedule or cancel */}
              {booking.status === 'confirmed' && (
                <div className="px-3 pb-2.5 flex gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBooking?.(booking.id);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)] hover:text-[#F97316] border border-[var(--v2-border)]"
                  >
                    <RefreshCw className="w-3 h-3" />
                    {isHebrew ? 'שנה מועד' : 'Reschedule'}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenBooking?.(booking.id);
                    }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors text-red-600 hover:bg-red-500/10 dark:hover:bg-red-500/20 border border-[var(--v2-border)]"
                  >
                    <X className="w-3 h-3" />
                    {isHebrew ? 'בטל' : 'Cancel'}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const ChatCommandPanel = forwardRef<ChatCommandPanelRef, ChatCommandPanelProps>(
  function ChatCommandPanel({ onCommand, onAction, onPublishDraft, onConfirmUpdate, onCancelUpdate, expanded = false }, ref) {
  const { t } = useLanguage();
  const router = useRouter();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      type: 'ai',
      content: t('chat.welcome') || "Morning! I'm watching over everything. Want to change something? Just tell me in plain words — a price, your hours, a post, anything — and I'll make it happen across the right place."
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Generic pending context for multi-turn conversations
  const [pendingContext, setPendingContext] = useState<PendingContext | null>(null);
  // Legacy: keep for backward compatibility until migration complete
  const [pendingAvailabilityDays, setPendingAvailabilityDays] = useState<string[] | null>(null);
  // Track the currently displayed entity for context-aware follow-ups
  const [activeEntity, setActiveEntity] = useState<{
    type: 'tasks' | 'contacts' | 'services' | 'bookings' | 'invoices';
    id: string;
    data: Record<string, unknown>;
  } | null>(null);

  // Default examples
  const defaultExamples = [
    t('chat.example.slot') || 'Add Saturday morning hours',
    t('chat.example.service') || 'Add a 90 min session for $150',
    t('chat.example.money') || 'Who owes me money?',
    t('chat.example.booking') || 'Book a client for tomorrow at 2pm'
  ];

  const examples = suggestions.length > 0 ? suggestions : defaultExamples;

  /**
   * Generate confirmation message based on actionType using translation keys
   */
  const generateConfirmationMessage = useCallback((
    actionType: string,
    entity: string
  ): string => {
    const actionLabel = t(`chat.action.${actionType}`) || actionType;
    const entityLabel = t(`chat.entity.${entity}`) || entity;

    // Get confirmation message template based on action type
    let messageTemplate: string;
    if (actionType === 'deactivate' || actionType === 'activate' || actionType === 'delete') {
      messageTemplate = t(`chat.confirm.${actionType}`) || t('chat.confirm.default') || 'Are you sure you want to proceed?';
    } else {
      messageTemplate = t('chat.confirm.default') || 'Are you sure you want to proceed?';
    }

    // Replace {entity} placeholder with actual entity label
    const message = messageTemplate.replace('{entity}', entityLabel);

    return `<strong>${actionLabel} ${entityLabel}</strong><br/>${message}`;
  }, [t]);

  /**
   * Get confirmation suggestion chips using translation keys
   */
  const getConfirmationSuggestions = useCallback((): string[] => {
    return [
      t('chat.confirm.yes') || 'Yes',
      t('chat.confirm.no') || 'No'
    ];
  }, [t]);

  // Expose methods to parent via ref
  useImperativeHandle(ref, () => ({
    addMessage: (type: 'ai' | 'success', content: string) => {
      setMessages(prev => [...prev, { type, content }]);
    },
    setSuggestions: (newSuggestions: string[]) => {
      setSuggestions(newSuggestions);
    }
  }), []);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Handle completing a task from entity card
  const handleCompleteTask = useCallback(async (taskId: string) => {
    try {
      const response = await fetch(`/api/crm/tasks/${taskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed' })
      });

      const result = await response.json();
      if (result.success) {
        setMessages(prev => [...prev, {
          type: 'success',
          content: t('chat.task_completed') || 'Task marked as complete ✓'
        }]);
      }
    } catch (error) {
      console.error('Failed to complete task:', error);
    }
  }, [t]);

  // Handle editing an entity from entity card
  // For tasks: use in-chat editing (context-aware follow-ups)
  // For other entities: navigate to the appropriate page
  const handleEditEntity = useCallback((entityType: string, entityId: string, entity: Record<string, unknown>) => {
    // Check if user's language is Hebrew
    const isHebrew = /[\u0590-\u05FF]/.test(messages[0]?.content || '');

    // Hardcoded fallback messages (translation keys may not exist)
    const editTaskPrompt = isHebrew
      ? 'ספר/י לי מה לשנות. לדוגמה: "שנה תאריך למחר", "עדכן עדיפות לגבוהה", "שנה כותרת ל..."'
      : `Tell me what to change. For example: "change date to tomorrow", "set priority to high", "rename to..."`;

    const editEntityPrompt = isHebrew
      ? 'ספר/י לי מה לשנות בפריט הזה.'
      : `Tell me what you'd like to change about this item.`;

    switch (entityType) {
      case 'tasks':
        // Always use in-chat editing for tasks (leverages activeEntity context)
        setMessages(prev => [...prev, {
          type: 'ai',
          content: editTaskPrompt
        }]);
        // Ensure active entity is set for context-aware edits
        setActiveEntity({
          type: 'tasks',
          id: entityId,
          data: entity
        });
        break;
      case 'contacts':
        router.push(`/business-os/crm?contact=${entityId}`);
        break;
      case 'services':
        // Open service edit dialog via onAction
        onAction?.({
          type: 'open_service_modal',
          mode: 'edit',
          serviceId: entityId,
          prefill: entity
        });
        break;
      case 'bookings':
        router.push(`/business-os`);
        break;
      case 'invoices':
        router.push(`/business-os/payments?invoice=${entityId}`);
        break;
      default:
        // Fallback - prompt user to describe the edit
        setMessages(prev => [...prev, {
          type: 'ai',
          content: editEntityPrompt
        }]);
    }
  }, [router, messages]);

  // Handle sending an invoice
  const handleSendInvoice = useCallback(async (invoiceId: string) => {
    const isHebrew = /[\u0590-\u05FF]/.test(messages[0]?.content || '');
    try {
      const response = await fetch(`/api/payments/invoices/${invoiceId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      const result = await response.json();
      if (result.success) {
        setMessages(prev => [...prev, {
          type: 'success',
          content: isHebrew ? 'החשבונית נשלחה בהצלחה ✓' : 'Invoice sent successfully ✓'
        }]);
      } else {
        setMessages(prev => [...prev, {
          type: 'ai',
          content: isHebrew ? 'לא הצלחתי לשלוח את החשבונית. נסה שוב.' : 'Failed to send invoice. Please try again.'
        }]);
      }
    } catch (error) {
      console.error('Failed to send invoice:', error);
      setMessages(prev => [...prev, {
        type: 'ai',
        content: isHebrew ? 'שגיאה בשליחת החשבונית.' : 'Error sending invoice.'
      }]);
    }
  }, [messages]);

  // Handle marking invoice as paid
  const handleMarkInvoicePaid = useCallback(async (invoiceId: string) => {
    const isHebrew = /[\u0590-\u05FF]/.test(messages[0]?.content || '');
    try {
      const response = await fetch(`/api/payments/invoices/${invoiceId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' })
      });

      const result = await response.json();
      if (result.success) {
        setMessages(prev => [...prev, {
          type: 'success',
          content: isHebrew ? 'החשבונית סומנה כשולמה ✓' : 'Invoice marked as paid ✓'
        }]);
      } else {
        setMessages(prev => [...prev, {
          type: 'ai',
          content: isHebrew ? 'לא הצלחתי לעדכן את החשבונית.' : 'Failed to update invoice.'
        }]);
      }
    } catch (error) {
      console.error('Failed to mark invoice as paid:', error);
      setMessages(prev => [...prev, {
        type: 'ai',
        content: isHebrew ? 'שגיאה בעדכון החשבונית.' : 'Error updating invoice.'
      }]);
    }
  }, [messages]);

  const handleSend = useCallback(async () => {
    const command = input.trim();
    if (!command || loading) return;

    // Check if this is a publish command (from suggestion chip)
    // Handle both with and without checkmark prefix (✓)
    const normalizedCommand = command.replace(/^✓\s*/, '').toLowerCase();
    const isPublishCommand =
      normalizedCommand === 'publish service' ||
      normalizedCommand === 'פרסם שירות';

    if (isPublishCommand && onPublishDraft) {
      setMessages(prev => [...prev, { type: 'user', content: command }]);
      setInput('');
      onPublishDraft();
      return;
    }

    // Check if this is a confirmation command for service update
    const isConfirmUpdate =
      normalizedCommand === 'yes, update' ||
      normalizedCommand === 'כן, עדכן';

    if (isConfirmUpdate && onConfirmUpdate) {
      setMessages(prev => [...prev, { type: 'user', content: command }]);
      setInput('');
      onConfirmUpdate();
      return;
    }

    // Check if this is a cancel command for service update
    const isCancelUpdate =
      normalizedCommand === 'no, cancel' ||
      normalizedCommand === 'לא, בטל';

    if (isCancelUpdate && onCancelUpdate) {
      setMessages(prev => [...prev, { type: 'user', content: command }]);
      setInput('');
      onCancelUpdate();
      return;
    }

    // Add user message
    setMessages(prev => [...prev, { type: 'user', content: command }]);
    setInput('');
    setLoading(true);

    try {
      // Build message history for conversation context (last 6 messages = 3 exchanges)
      // Format: V2 API expects { role: 'user' | 'assistant', content: string }
      const conversationHistory = messages.slice(-6).map(m => ({
        role: m.type === 'user' ? 'user' as const : 'assistant' as const,
        content: m.content,
      }));

      // Check if user selected from candidates - if so, include the entity ID
      // This ensures the LLM uses the correct ID instead of trying to match by name
      let messageToSend = command;
      if (pendingContext?.candidates && pendingContext.candidates.length > 0) {
        // Try to find matching candidate by label (with or without detail)
        const matchedCandidate = pendingContext.candidates.find(c => {
          const labelWithDetail = c.detail ? `${c.name} (${c.detail})` : c.name;
          return command === c.name || command === labelWithDetail || command.startsWith(c.name);
        });

        if (matchedCandidate) {
          // Include the ID in the message so LLM can use it directly
          messageToSend = `${command} [ID: ${matchedCandidate.id}]`;
        }
      }

      // Call AI Data Layer V2 endpoint - autonomous LLM with capability-aware tools
      const response = await fetch('/api/business-os/chat-v2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: messageToSend,
          conversationHistory,
          pendingConfirmationId: pendingContext?.confirmationId || undefined,
          // Pass active entity context for follow-up commands
          activeEntity: activeEntity || undefined,
        }),
      });

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to process message');
      }

      const { data } = result;

      // Handle pending confirmation - render UI based on actionType
      if (data.pendingConfirmation) {
        const { id, actionType, entity, preview } = data.pendingConfirmation;

        // Generate localized confirmation message based on actionType (using translation keys)
        const confirmationMessage = generateConfirmationMessage(actionType, entity);
        setMessages(prev => [...prev, { type: 'ai', content: confirmationMessage }]);

        // Store confirmation context for next message
        setPendingContext({
          confirmationId: id,
          actionType,
          entity,
          preview,
          awaitingConfirmation: true
        });

        // Set confirmation suggestion chips
        setSuggestions(getConfirmationSuggestions());
      } else {
        // Add AI response (only if there's a message)
        if (data.message) {
          setMessages(prev => [...prev, { type: 'ai', content: data.message }]);
        }

        // Clear pending context
        setPendingContext(null);
        setPendingAvailabilityDays(null);

        // Handle actions
        if (data.actions?.length > 0) {
          for (const action of data.actions) {
            if (action.type === 'present_choices') {
              // Present choices as suggestion chips
              const choiceLabels = action.choices.map((c: { label: string; detail?: string }) =>
                c.detail ? `${c.label} (${c.detail})` : c.label
              );
              setSuggestions(choiceLabels);
              // Store pending action context so we know what to do with selection
              // Map label -> name for PendingContext.candidates compatibility
              const candidates = action.choices.map((c: { id: string; label: string; detail?: string }) => ({
                id: c.id,
                name: c.label,
                detail: c.detail
              }));
              setPendingContext({
                entityType: action.entityType,
                candidates,
                // Store the pending action (e.g., 'deactivate') for when user selects
                actionType: action.pendingAction as PendingContext['actionType']
              });
              break;
            } else if (action.type === 'navigate') {
              setTimeout(() => {
                router.push(action.destination);
              }, 1500);
              break;
            } else if (action.type === 'open_modal') {
              setTimeout(() => {
                onAction?.(action);
              }, 300);
              break;
            } else if (action.type === 'present_entity_card') {
              // Display entity card in chat
              setMessages(prev => [...prev, {
                type: 'entity_card',
                content: '',
                entityCard: {
                  entityType: action.entityType,
                  entity: action.entity,
                  actions: action.actions
                }
              }]);
              // Track this entity for context-aware follow-ups
              setActiveEntity({
                type: action.entityType as 'tasks' | 'contacts' | 'services' | 'bookings' | 'invoices',
                id: action.entity.id as string,
                data: action.entity
              });
              break;
            } else if (action.type === 'present_booking_list') {
              // Display booking list as styled cards
              setMessages(prev => [...prev, {
                type: 'booking_list',
                content: '',
                bookingList: action.bookings
              }]);
              break;
            }
          }
        }
      }

      onCommand?.(command, null);

    } catch (error) {
      // Log the error for debugging
      console.error('Chat processing error:', error);

      // Show error message
      setMessages(prev => [
        ...prev,
        {
          type: 'ai',
          content: "Sorry, I couldn't process that. Please try again or rephrase your request.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, router, onCommand, onAction, pendingContext, pendingAvailabilityDays, messages]);

  const handleExampleClick = (example: string) => {
    setInput(example);
    inputRef.current?.focus();
  };

  // Calculate height based on expanded state (when MyDay section is collapsed)
  const panelHeight = expanded ? '640px' : '460px';

  return (
    <section
      className="bg-[var(--v2-surface)] border border-[var(--v2-border)] flex flex-col overflow-hidden transition-all duration-300"
      style={{
        borderRadius: '22px',
        boxShadow: '0 20px 50px -34px rgba(20, 26, 43, 0.4)',
        height: panelHeight,
        maxHeight: panelHeight
      }}
    >
      {/* Header */}
      <div
        className="flex-shrink-0 border-b border-[var(--v2-border)]"
        style={{ padding: '18px 20px 14px' }}
      >
        <div className="flex items-center gap-3">
          {/* AI Orb */}
          <div
            className="w-9 h-9 flex items-center justify-center flex-none"
            style={{
              borderRadius: '10px',
              background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
              boxShadow: '0 8px 18px -8px rgba(249, 115, 22, 0.6)'
            }}
          >
            <svg
              viewBox="0 0 24 24"
              className="w-5 h-5"
              stroke="#fff"
              strokeWidth={2.2}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3l2.5 5.5L20 11l-5.5 2.5L12 19l-2.5-5.5L4 11l5.5-2.5z" />
            </svg>
          </div>
          <div>
            <b
              className="block"
              style={{
                fontFamily: '"Space Grotesk", system-ui, sans-serif',
                fontSize: '16px',
                fontWeight: 600,
                letterSpacing: '-0.01em',
                color: 'var(--v2-text-primary)'
              }}
            >
              {t('chat.title') || 'Just tell me'}
            </b>
            <small className="text-xs text-[var(--v2-text-muted)]">
              {t('chat.subtitle') || "Change anything, anywhere — I'll handle it"}
            </small>
          </div>
        </div>
      </div>

      {/* Messages - scrollable area with fixed height */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-scroll flex flex-col gap-3 scrollbar-thin"
        style={{
          padding: '16px 18px',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(209, 213, 219, 0.5) transparent'
        }}
      >
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`max-w-[88%] text-sm leading-relaxed animate-in fade-in slide-in-from-bottom-2 duration-300 ${
              msg.type === 'user'
                ? 'self-end'
                : 'self-start'
            }`}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            {msg.type === 'ai' && (
              <div className="flex items-start gap-2">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ background: 'linear-gradient(135deg, #FFB454 0%, #F97316 100%)' }}
                >
                  <Bot className="w-3.5 h-3.5 text-white" strokeWidth={2.2} />
                </div>
                <div
                  className="bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] [&_a]:text-[#F97316] [&_a]:underline [&_a]:hover:text-[#EA580C] [&_strong]:text-[var(--v2-text-primary)] whitespace-pre-wrap"
                  style={{ borderRadius: '4px 14px 14px 14px', padding: '11px 13px' }}
                  dangerouslySetInnerHTML={{ __html: msg.content }}
                />
              </div>
            )}
            {msg.type === 'user' && (
              <div className="flex items-start gap-2 justify-end">
                <div
                  className="text-white font-medium"
                  style={{
                    background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)',
                    borderRadius: '14px 14px 4px 14px',
                    padding: '10px 14px'
                  }}
                >
                  {msg.content}
                </div>
                <div className="w-6 h-6 rounded-full bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" strokeWidth={2} />
                </div>
              </div>
            )}
            {msg.type === 'success' && (
              <div
                className="inline-flex items-center gap-2 text-xs font-semibold text-green-600 dark:text-green-400 bg-green-500/10 dark:bg-green-500/20 border border-green-500/20 dark:border-green-500/30"
                style={{
                  borderRadius: '20px',
                  padding: '6px 12px'
                }}
              >
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                <span dangerouslySetInnerHTML={{ __html: msg.content }} />
              </div>
            )}
            {msg.type === 'entity_card' && msg.entityCard && (
              <EntityCardMessage
                entityCard={msg.entityCard}
                router={router}
                isHebrew={/[\u0590-\u05FF]/.test(messages[0]?.content || '')}
                onCompleteTask={msg.entityCard.entityType === 'tasks' ? handleCompleteTask : undefined}
                onEditEntity={handleEditEntity}
                onOpenBooking={msg.entityCard.entityType === 'bookings' ? (id) => onAction?.({ type: 'open_booking', bookingId: id }) : undefined}
                onSendInvoice={msg.entityCard.entityType === 'invoices' ? handleSendInvoice : undefined}
                onMarkInvoicePaid={msg.entityCard.entityType === 'invoices' ? handleMarkInvoicePaid : undefined}
              />
            )}
            {msg.type === 'booking_list' && msg.bookingList && (
              <BookingListMessage
                bookings={msg.bookingList}
                isHebrew={/[\u0590-\u05FF]/.test(messages[0]?.content || '')}
                onOpenBooking={(bookingId) => {
                  onAction?.({ type: 'open_booking', bookingId });
                }}
              />
            )}
          </div>
        ))}
        {loading && (
          <div className="self-start">
            <div className="flex items-start gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                style={{ background: 'linear-gradient(135deg, #FFB454 0%, #F97316 100%)' }}
              >
                <Bot className="w-3.5 h-3.5 text-white" strokeWidth={2.2} />
              </div>
              <div
                className="bg-[var(--v2-bg)] border border-[var(--v2-border)] flex gap-1.5"
                style={{ borderRadius: '4px 14px 14px 14px', padding: '14px 18px' }}
              >
                <span className="w-2 h-2 rounded-full bg-[var(--v2-text-muted)] animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 rounded-full bg-[var(--v2-text-muted)] animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 rounded-full bg-[var(--v2-text-muted)] animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dock */}
      <div
        className="flex-shrink-0 border-t border-[var(--v2-border)]"
        style={{ padding: '12px 16px 16px' }}
      >
        {/* Example chips */}
        <div className="flex flex-wrap gap-2 mb-3">
          {examples.slice(0, 4).map((example, index) => (
            <button
              key={index}
              onClick={() => handleExampleClick(example)}
              className="text-xs font-medium text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] transition-all hover:border-[#F97316] hover:text-[#F97316]"
              style={{ borderRadius: '16px', padding: '7px 12px' }}
            >
              {example}
            </button>
          ))}
        </div>

        {/* Input bar */}
        <div
          className="flex gap-2 items-center bg-[var(--v2-surface)] border border-[var(--v2-border)] transition-all focus-within:border-[#F97316] focus-within:shadow-[0_0_0_4px_rgba(249,115,22,0.08)]"
          style={{ borderRadius: '14px', padding: '5px 5px 5px 14px', borderWidth: '1.5px' }}
        >
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder={t('chat.placeholder') || 'e.g. add a 90 min session for $150…'}
            className="flex-1 border-0 bg-transparent text-sm focus:outline-none text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)]"
            disabled={loading}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="w-10 h-10 flex items-center justify-center flex-none transition-transform active:scale-95 disabled:opacity-50"
            style={{
              borderRadius: '10px',
              background: 'linear-gradient(120deg, #FFB454 0%, #F97316 55%, #EA580C 100%)'
            }}
          >
            <Send className="w-4 h-4 text-white" strokeWidth={2.2} />
          </button>
        </div>
      </div>

    </section>
  );
});

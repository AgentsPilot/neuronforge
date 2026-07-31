/**
 * Type definitions for the Draft Manager system
 * Handles preview/publish state for chat-driven changes
 */

// Draft types for different capabilities
export type DraftType = 'service' | 'availability' | 'contact' | 'invoice' | 'booking';

// Actions that can be performed
export type DraftAction = 'create' | 'update' | 'delete';

// Preview context - which view to show in the slide panel
export type PreviewContext = 'services' | 'crm' | 'reports' | 'payments';

// Individual draft item
export interface Draft {
  id: string;                    // Unique draft ID (uuid)
  type: DraftType;               // What kind of entity
  action: DraftAction;           // What we're doing to it
  entityId?: string;             // ID of existing entity (for update/delete)
  data: Record<string, any>;     // The draft data
  timestamp: number;             // When the draft was created
  description: string;           // Human-readable description (e.g., "Add 1:1 Session for $150")
}

// Service draft data shape
export interface ServiceDraftData {
  service_name: string;
  description?: string;
  duration_minutes: number;
  price: number;
  currency: string;
  is_free: boolean;
  status: 'draft' | 'active' | 'inactive';
  buffer_minutes?: number;
  max_bookings_per_day?: number;
  advance_booking_days?: number;
  min_notice_hours?: number;
}

// Availability draft data shape
export interface AvailabilityDraftData {
  sunday?: { start: string; end: string }[];
  monday?: { start: string; end: string }[];
  tuesday?: { start: string; end: string }[];
  wednesday?: { start: string; end: string }[];
  thursday?: { start: string; end: string }[];
  friday?: { start: string; end: string }[];
  saturday?: { start: string; end: string }[];
}

// Contact draft data shape
export interface ContactDraftData {
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  company?: string;
  stage?: string;
  notes?: string;
}

// Invoice draft data shape
export interface InvoiceDraftData {
  contact_id: string;
  amount: number;
  currency: string;
  description?: string;
  due_date?: string;
  items?: { description: string; amount: number }[];
}

// Booking draft data shape
export interface BookingDraftData {
  service_id: string;
  contact_id?: string;
  client_first_name: string;
  client_last_name?: string;
  client_email: string;
  client_phone?: string;
  start_time: string;
  end_time: string;
  timezone?: string;
  notes?: string;
}

// Draft state managed by context
export interface DraftState {
  drafts: Draft[];
  previewContext: PreviewContext;
  isPanelOpen: boolean;
  isPublishing: boolean;
  publishError: string | null;
}

// Draft manager context value
export interface DraftManagerContextValue {
  state: DraftState;

  // Draft operations
  addDraft: (draft: Omit<Draft, 'id' | 'timestamp'>) => void;
  updateDraft: (id: string, data: Partial<Draft['data']>) => void;
  removeDraft: (id: string) => void;
  clearDrafts: () => void;

  // Publish operations
  publishAll: () => Promise<void>;
  discardAll: () => void;

  // Panel operations
  openPanel: (context?: PreviewContext) => void;
  closePanel: () => void;
  setPreviewContext: (context: PreviewContext) => void;

  // Computed values
  draftCount: number;
  hasDrafts: boolean;
  getDraftsByType: (type: DraftType) => Draft[];
}

// Intent types returned by the AI parser
export type IntentType =
  | 'service.create'
  | 'service.update'
  | 'service.delete'
  | 'availability.update'
  | 'availability.query'
  | 'calendar.open'
  | 'booking.create'
  | 'booking.query'
  | 'booking.cancel'
  | 'booking.update_status'
  | 'contact.add'
  | 'contact.update'
  | 'contact.query'
  | 'contact.view'
  | 'activity.add'
  | 'task.create'
  | 'task.query'
  | 'invoice.create'
  | 'invoice.query'
  | 'payment.record'
  | 'report.query'
  | 'report.compare'
  | 'navigate'
  | 'preview.switch'
  | 'unknown';

// Pending context for multi-turn conversations
// Used to collect missing fields across multiple chat messages
export interface PendingContext {
  intent?: IntentType;                    // The intent being built (legacy)
  entities?: Record<string, any>;          // Collected entities so far (legacy)
  missingFields?: string[];                // Fields still needed (legacy)
  awaitingConfirmation?: boolean;         // Waiting for yes/no confirmation
  confirmMessage?: string;                // The confirmation message shown to user
  entityType?: string;                    // For disambiguation (e.g., 'contact', 'service')
  candidates?: Array<{ id: string; name: string; detail?: string }>; // For disambiguation
  // V2 AI Data Layer confirmation flow
  confirmationId?: string;                // ID of pending mutation to confirm/cancel
  actionType?: 'create' | 'update' | 'deactivate' | 'activate' | 'delete' | 'complete' | 'cancel' | 'publish' | 'send';
  entity?: string;                        // Entity type being acted upon
  preview?: string;                       // Preview text from backend
}

// Parsed intent from AI
export interface ParsedIntent {
  intent: IntentType;
  entities: Record<string, any>;
  confidence: number;
  confirmRequired: boolean;
  rawText: string;
  language?: string; // Detected language code (e.g., "en", "he", "es")
}

// Action types for triggering dialogs/modals
export type DialogAction =
  | { type: 'open_service_dialog'; mode: 'create' | 'edit'; serviceId?: string; prefill?: Partial<ServiceDraftData> }
  | { type: 'open_service_modal'; mode: 'create' | 'edit'; serviceId?: string; prefill?: Partial<ServiceDraftData> } // Alias for open_service_dialog
  | { type: 'open_contact_dialog'; mode: 'create' | 'edit'; contactId?: string; prefill?: Partial<ContactDraftData> }
  | { type: 'open_booking_dialog'; mode: 'create'; prefill?: Partial<BookingDraftData> }
  | { type: 'open_booking'; bookingId: string } // Open a specific booking in the calendar dialog
  | { type: 'open_booking_calendar'; date?: string } // Open calendar/schedule view, optionally focused on a date
  | { type: 'open_availability_dialog'; days?: string[] } // Optional days to pre-select
  | { type: 'open_invoice_dialog'; prefill?: Partial<InvoiceDraftData> }
  | { type: 'show_service_list'; services: Array<{ id: string; name: string; price: number; currency: string; duration: number }> }
  | { type: 'show_booking_list'; bookings: Array<{ id: string; client_name: string; service_name: string; start_time: string; status: string }> }
  | { type: 'confirm_booking_cancel'; bookingId: string; clientName: string; startTime: string }
  | { type: 'confirm_service_update'; serviceId: string; serviceName: string; updates: Record<string, any>; updateDescription: string }
  | { type: 'store_pending_availability'; days: string[] } // Store pending days for follow-up time question (deprecated - use store_pending_context)
  // New unified conversational flow actions
  | { type: 'store_pending_context'; context: PendingContext } // Store pending context for multi-turn conversation
  | { type: 'await_confirmation'; context: PendingContext } // Awaiting user confirmation (yes/no)
  | { type: 'clear_pending_context' } // Clear pending context (user cancelled or completed)
  | { type: 'show_delete_confirmation'; entityType: 'service' | 'contact' | 'booking' | 'task' | 'invoice'; entityId: string; entityName: string } // Show delete confirmation dialog
  | { type: 'show_disambiguation'; entityType: string; candidates: Array<{ id: string; name: string; detail?: string }>; context: PendingContext }; // Ask user to choose from multiple matches

// Query result data types
export interface QueryResultData {
  type: 'contact_list' | 'task_list' | 'invoice_list' | 'booking_list';
  contacts?: Array<{ id: string; first_name?: string; last_name?: string; email?: string; stage?: string }>;
  tasks?: Array<{ id: string; title: string; due_date?: string; status: string; contact_id?: string }>;
  invoices?: Array<{ id: string; invoice_number?: string; amount: number; currency: string; status: string; contact_id?: string }>;
  bookings?: Array<{ id: string; client_name: string; service_name: string; start_time: string; end_time: string; status: string }>;
}

// Chat command execution result
export interface CommandResult {
  success: boolean;
  response: string;              // AI-generated response text
  draft?: Draft;                 // Created draft (if applicable)
  suggestions?: string[];        // Quick action chip suggestions
  previewContext?: PreviewContext; // Which preview to show
  route?: string;                // Navigation route (if applicable)
  error?: string;                // Error message (if failed)
  action?: DialogAction;         // Action to trigger (open dialog, etc.)
  data?: QueryResultData;        // Query result data (for contact.query, task.query, invoice.query)
}

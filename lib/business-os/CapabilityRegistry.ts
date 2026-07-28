/**
 * CapabilityRegistry - Auto-generates chat prompt from registered capabilities
 *
 * Instead of hardcoding capabilities in the system prompt, we define them here
 * as structured data. The prompt is generated dynamically, making it easy to
 * add new capabilities without editing the prompt text.
 */

export interface EntityDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  description: string;
  required?: boolean;
}

export interface Capability {
  id: string;
  category: 'services' | 'availability' | 'crm' | 'payments' | 'tasks' | 'navigation' | 'reports' | 'scheduling';
  description: string;
  entities: EntityDef[];
  notes?: string; // Additional instructions for the LLM
}

/**
 * All registered business capabilities
 * Adding a new capability = adding one object here
 */
export const capabilities: Capability[] = [
  // ============================================================================
  // Services & Scheduling
  // ============================================================================
  {
    id: 'service.create',
    category: 'services',
    description: 'User wants to ADD a NEW service offering',
    entities: [
      { name: 'service_name', type: 'string', description: 'Name of the service' },
      { name: 'duration_minutes', type: 'number', description: 'Duration in minutes (convert hours to minutes)' },
      { name: 'price', type: 'number', description: 'Price amount' },
      { name: 'currency', type: 'string', description: 'Currency code (USD, ILS, EUR, GBP)' },
      { name: 'is_free', type: 'boolean', description: 'Whether the service is free' },
    ],
  },
  {
    id: 'service.update',
    category: 'services',
    description: 'User wants to MODIFY an EXISTING service (price, duration, name, etc.)',
    entities: [
      { name: 'service_name', type: 'string', description: 'Name of service to modify (if mentioned)' },
      { name: 'price', type: 'number', description: 'The ACTUAL new price value. ONLY set if user provides a specific number.' },
      { name: 'duration_minutes', type: 'number', description: 'The ACTUAL new duration in minutes. ONLY set if user provides a specific number.' },
      { name: 'currency', type: 'string', description: 'Currency code (if changing)' },
      { name: 'update_price', type: 'boolean', description: 'TRUE if user WANTS to change price but did NOT provide the actual value yet.' },
      { name: 'update_duration', type: 'boolean', description: 'TRUE if user WANTS to change duration but did NOT provide the actual value yet.' },
    ],
    notes: 'IMPORTANT: If user says "change the price" but does NOT say what the new price is, set update_price=true but leave price empty. Same for duration. Only set price/duration_minutes when user provides the actual number.',
  },
  {
    id: 'service.delete',
    category: 'services',
    description: 'User wants to REMOVE a service',
    entities: [
      { name: 'service_name', type: 'string', description: 'Name of service to delete', required: true },
    ],
    notes: 'Always set confirmRequired: true',
  },
  {
    id: 'availability.update',
    category: 'availability',
    description: 'User wants to change their WORKING HOURS or SCHEDULE',
    entities: [
      { name: 'days', type: 'array', description: 'Array of day names in English (monday, tuesday, etc.)' },
      { name: 'start_time', type: 'string', description: 'Start time in 24h format (e.g., 09:00)' },
      { name: 'end_time', type: 'string', description: 'End time in 24h format (e.g., 17:00)' },
      { name: 'needs_time_clarification', type: 'boolean', description: 'Set true if days mentioned but no times' },
      { name: 'open_dialog', type: 'boolean', description: 'Set true if user wants custom/other hours' },
    ],
    notes: 'Convert natural time expressions to 24h format (2pm→14:00, 5pm→17:00)',
  },
  {
    id: 'availability.query',
    category: 'availability',
    description: 'User wants to SEE or CHECK their current availability/working hours - מה השעות שלי, what are my hours, show availability',
    entities: [],
    notes: 'Returns current availability schedule. No entities needed.',
  },

  // ============================================================================
  // CRM & Contacts
  // ============================================================================
  {
    id: 'contact.add',
    category: 'crm',
    description: 'User wants to add a new CLIENT or CONTACT',
    entities: [
      { name: 'first_name', type: 'string', description: 'First name' },
      { name: 'last_name', type: 'string', description: 'Last name' },
      { name: 'email', type: 'string', description: 'Email address' },
      { name: 'phone', type: 'string', description: 'Phone number' },
    ],
  },
  {
    id: 'contact.update',
    category: 'crm',
    description: 'User wants to modify a contact\'s details or move them in the pipeline',
    entities: [
      { name: 'contact_name', type: 'string', description: 'Name of the contact to update' },
      { name: 'stage', type: 'string', description: 'New pipeline stage (lead, qualified, client, etc.)' },
      { name: 'email', type: 'string', description: 'New email (if changing)' },
      { name: 'phone', type: 'string', description: 'New phone (if changing)' },
    ],
  },
  {
    id: 'contact.query',
    category: 'crm',
    description: 'User wants to SEARCH, FILTER, or VIEW multiple contacts (list view)',
    entities: [
      { name: 'stage', type: 'string', description: 'Filter by pipeline stage (lead, qualified, client, etc.)' },
      { name: 'has_overdue_tasks', type: 'boolean', description: 'Filter contacts with overdue tasks/follow-ups' },
      { name: 'has_due_tasks', type: 'boolean', description: 'Filter contacts with any due tasks' },
      { name: 'search', type: 'string', description: 'Name or email to search for' },
      { name: 'limit', type: 'number', description: 'Max number of results' },
    ],
  },
  {
    id: 'contact.view',
    category: 'crm',
    description: 'User wants to OPEN or VIEW a SPECIFIC contact record/file/page - פתח את הקובץ של, open Sara, show contact details, view client profile',
    entities: [
      { name: 'contact_name', type: 'string', description: 'Name of the contact to view', required: true },
    ],
    notes: 'Use when user wants to open ONE specific contact page/record. For listing multiple contacts use contact.query instead.',
  },
  {
    id: 'activity.add',
    category: 'crm',
    description: 'User wants to add an ACTIVITY to a contact (note, call, meeting, email) - רשום שיחה עם, add note for, log call with',
    entities: [
      { name: 'contact_name', type: 'string', description: 'Contact name to add activity for', required: true },
      { name: 'activity_type', type: 'string', description: 'Type: note, call, meeting, email', required: true },
      { name: 'title', type: 'string', description: 'Activity title/summary' },
      { name: 'description', type: 'string', description: 'Details or notes about the activity' },
    ],
    notes: 'Activity types: note, call, meeting, email. If type not specified, default to "note".',
  },

  // ============================================================================
  // Tasks
  // ============================================================================
  {
    id: 'task.create',
    category: 'tasks',
    description: 'User wants to create a reminder or follow-up task',
    entities: [
      { name: 'description', type: 'string', description: 'What the task is about' },
      { name: 'contact_name', type: 'string', description: 'Contact this task is related to' },
      { name: 'due_date', type: 'string', description: 'When the task is due (parse relative dates)' },
    ],
  },
  {
    id: 'task.query',
    category: 'tasks',
    description: 'User wants to see their tasks (overdue, upcoming, all)',
    entities: [
      { name: 'status', type: 'string', description: 'Filter: overdue, pending, completed, upcoming' },
      { name: 'contact_name', type: 'string', description: 'Filter by contact name' },
      { name: 'due_period', type: 'string', description: 'Time period: today, this_week, this_month' },
      { name: 'limit', type: 'number', description: 'Max number of results' },
    ],
  },

  // ============================================================================
  // Payments & Invoices
  // ============================================================================
  {
    id: 'invoice.create',
    category: 'payments',
    description: 'User wants to create an invoice for a client',
    entities: [
      { name: 'contact_name', type: 'string', description: 'Client name or email', required: true },
      { name: 'amount', type: 'number', description: 'Invoice amount', required: true },
      { name: 'currency', type: 'string', description: 'Currency (USD, ILS, EUR, GBP)' },
      { name: 'description', type: 'string', description: 'What the invoice is for' },
    ],
  },
  {
    id: 'invoice.query',
    category: 'payments',
    description: 'User wants to see invoices (overdue, pending, all)',
    entities: [
      { name: 'status', type: 'string', description: 'Filter: draft, sent, paid, overdue' },
      { name: 'contact_name', type: 'string', description: 'Filter by client name' },
    ],
    notes: '"Who owes me money?" → status: overdue',
  },
  {
    id: 'payment.record',
    category: 'payments',
    description: 'User wants to record a payment received (cash, bank transfer, etc.)',
    entities: [
      { name: 'contact_name', type: 'string', description: 'Client who paid', required: true },
      { name: 'amount', type: 'number', description: 'Payment amount', required: true },
      { name: 'currency', type: 'string', description: 'Currency code' },
      { name: 'method', type: 'string', description: 'Payment method: cash, bank_transfer, card, other' },
      { name: 'invoice_id', type: 'string', description: 'Invoice this payment is for (if known)' },
    ],
  },

  // ============================================================================
  // Reports & Analytics
  // ============================================================================
  {
    id: 'report.query',
    category: 'reports',
    description: 'User asks about BUSINESS METRICS (revenue, bookings, earnings)',
    entities: [
      { name: 'metric', type: 'string', description: 'What to measure: revenue, bookings, clients, payments' },
      { name: 'period', type: 'string', description: 'Time period: today, this_week, this_month, last_month' },
    ],
  },
  {
    id: 'report.compare',
    category: 'reports',
    description: 'User wants to compare metrics across time periods',
    entities: [
      { name: 'metric', type: 'string', description: 'What to compare: revenue, bookings' },
      { name: 'period1', type: 'string', description: 'First period to compare' },
      { name: 'period2', type: 'string', description: 'Second period to compare' },
    ],
  },

  // ============================================================================
  // Scheduling & Bookings
  // ============================================================================
  {
    id: 'calendar.open',
    category: 'scheduling',
    description: 'User wants to OPEN or SHOW the calendar/schedule UI - USE THIS for: פתח יומן, טען יומן, open calendar, show calendar, open my schedule, הראה יומן',
    entities: [],
    notes: 'ALWAYS use this intent for "פתח יומן", "טען יומן", "open calendar", "show calendar". No entities needed.',
  },
  {
    id: 'booking.create',
    category: 'scheduling',
    description: 'User wants to CREATE a BOOKING/APPOINTMENT/MEETING with a client',
    entities: [
      { name: 'contact_name', type: 'string', description: 'Client name - if Hebrew, transliterate to English spelling' },
      { name: 'service_name', type: 'string', description: 'Service to book (if mentioned)' },
      { name: 'date', type: 'string', description: 'Date for the booking (parse relative dates: tomorrow, next Monday, next week = starting Monday, etc.)' },
      { name: 'time', type: 'string', description: 'Specific time in 24h format (e.g., 14:00). Leave EMPTY if user does NOT specify an exact time.' },
      { name: 'show_available', type: 'boolean', description: 'TRUE when user wants to SEE available/free/open time slots instead of specifying a time. Detect intent like: when is free, show availability, what times work, find an open slot, etc.' },
    ],
    notes: 'If user does NOT provide a specific time but asks to find/show available times, set show_available=true and leave time empty. The system will show available slots.',
  },
  {
    id: 'booking.query',
    category: 'scheduling',
    description: 'User asks about their EXISTING bookings - what meetings do I have, מה יש לי היום',
    entities: [
      { name: 'period', type: 'string', description: 'Time period: today, tomorrow, this_week, next_week' },
      { name: 'contact_name', type: 'string', description: 'Filter by client name' },
      { name: 'status', type: 'string', description: 'Filter: confirmed, cancelled, completed' },
    ],
    notes: 'Use for questions about existing bookings. "מה יש לי היום" → period: today. For opening calendar UI use calendar.open.',
  },
  {
    id: 'booking.cancel',
    category: 'scheduling',
    description: 'User wants to CANCEL an existing booking',
    entities: [
      { name: 'contact_name', type: 'string', description: 'Client name whose booking to cancel' },
      { name: 'date', type: 'string', description: 'Date of the booking to cancel' },
      { name: 'booking_id', type: 'string', description: 'Specific booking ID (if known)' },
    ],
    notes: 'Always set confirmRequired: true. If multiple bookings match, show a picker.',
  },
  {
    id: 'booking.update_status',
    category: 'scheduling',
    description: 'User wants to mark a booking as completed, no-show, or change its status - סמן כהגיע, mark as completed, no show',
    entities: [
      { name: 'contact_name', type: 'string', description: 'Client name for the booking' },
      { name: 'booking_id', type: 'string', description: 'Specific booking ID (if known)' },
      { name: 'date', type: 'string', description: 'Date of the booking' },
      { name: 'new_status', type: 'string', description: 'New status: completed, no_show, cancelled, confirmed', required: true },
    ],
    notes: 'Booking statuses: confirmed (default), completed (client showed up), no_show (client didnt show), cancelled.',
  },

  // ============================================================================
  // Navigation
  // ============================================================================
  {
    id: 'navigate',
    category: 'navigation',
    description: 'User wants to GO TO a specific page or section',
    entities: [
      { name: 'destination', type: 'string', description: 'Where to go: people/contacts, reports, services, payments, calendar, settings' },
    ],
  },
  {
    id: 'preview.switch',
    category: 'navigation',
    description: 'User wants to switch the preview panel context',
    entities: [
      { name: 'context', type: 'string', description: 'What to show: services, crm/contacts, payments, reports' },
    ],
  },
];

/**
 * Generate the capabilities section of the system prompt
 */
export function generateCapabilityPrompt(): string {
  let prompt = 'AVAILABLE CAPABILITIES:\n\n';

  // Group by category for readability
  const byCategory = capabilities.reduce((acc, cap) => {
    if (!acc[cap.category]) acc[cap.category] = [];
    acc[cap.category].push(cap);
    return acc;
  }, {} as Record<string, Capability[]>);

  const categoryOrder = ['services', 'availability', 'scheduling', 'crm', 'tasks', 'payments', 'reports', 'navigation'];

  for (const category of categoryOrder) {
    const caps = byCategory[category];
    if (!caps) continue;

    for (const cap of caps) {
      prompt += `${cap.id} - ${cap.description}\n`;

      // List entities to extract
      const entityNames = cap.entities.map(e => e.name).join(', ');
      prompt += `  → Extract: ${entityNames}\n`;

      // Add notes if present
      if (cap.notes) {
        prompt += `  → Note: ${cap.notes}\n`;
      }

      prompt += '\n';
    }
  }

  return prompt;
}

/**
 * Get capability by ID
 */
export function getCapability(id: string): Capability | undefined {
  return capabilities.find(c => c.id === id);
}

/**
 * Get all capabilities in a category
 */
export function getCapabilitiesByCategory(category: Capability['category']): Capability[] {
  return capabilities.filter(c => c.category === category);
}

/**
 * Get all intent IDs (for type checking)
 */
export function getAllIntentIds(): string[] {
  return capabilities.map(c => c.id);
}

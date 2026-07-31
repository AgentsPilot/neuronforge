/**
 * CapabilityRegistry
 *
 * Single source of truth for all chat capabilities.
 * Defines what the LLM can do, with schemas for validation.
 */

import { z } from 'zod';
import type { ParamType } from './ParameterParsers';

// ============== TYPES ==============

export interface CapabilityParam {
  name: string;
  type: ParamType;
  required: boolean;
  description: string;
  description_he?: string;

  // For entity_ref type - which entity table to reference
  entityType?: 'contacts' | 'tasks' | 'services' | 'bookings' | 'invoices';

  // For validation
  validation?: z.ZodSchema;

  // Default value if not provided
  default?: unknown;

  // Prompt to ask user for this param (if not provided by LLM)
  prompt?: string;
  prompt_he?: string;

  // Enum values (for select-style params)
  enumValues?: string[];
}

export interface Capability {
  id: string;  // e.g., "task.create", "invoice.send"

  // Categorization
  domain: 'crm' | 'scheduling' | 'payments' | 'communication' | 'settings';
  entity: string;  // e.g., "task", "contact", "invoice"
  action: string;  // e.g., "create", "update", "send"

  // For LLM understanding
  description: string;
  description_he?: string;

  // Natural language examples that trigger this capability
  examples?: string[];
  examples_he?: string[];

  // Parameters
  params: CapabilityParam[];

  // Behavior flags
  confirmationRequired: boolean;
  destructive: boolean;  // Cannot be undone

  // Templates for messages
  confirmationTemplate?: string;
  confirmationTemplate_he?: string;
  successTemplate?: string;
  successTemplate_he?: string;
  errorTemplate?: string;
  errorTemplate_he?: string;
}

// ============== CAPABILITY DEFINITIONS ==============

export const CAPABILITY_REGISTRY: Capability[] = [
  // =====================================
  // CRM - CONTACTS
  // =====================================
  {
    id: 'contact.create',
    domain: 'crm',
    entity: 'contact',
    action: 'create',
    description: 'Create a new contact, client, or customer',
    description_he: 'יצירת איש קשר או לקוח חדש',
    examples: [
      'add a new contact',
      'create contact John Smith',
      'add client with email john@example.com'
    ],
    examples_he: [
      'הוסף איש קשר חדש',
      'צור לקוח בשם דוד כהן',
      'הוסף לקוח עם אימייל'
    ],
    params: [
      {
        name: 'first_name',
        type: 'string',
        required: true,
        description: 'First name',
        description_he: 'שם פרטי',
        prompt: "What's their first name?",
        prompt_he: 'מה השם הפרטי?'
      },
      {
        name: 'last_name',
        type: 'string',
        required: false,
        description: 'Last name',
        description_he: 'שם משפחה',
        prompt: "What's their last name?",
        prompt_he: 'מה שם המשפחה?'
      },
      {
        name: 'email',
        type: 'email',
        required: false,
        description: 'Email address',
        description_he: 'כתובת אימייל'
      },
      {
        name: 'phone',
        type: 'phone',
        required: false,
        description: 'Phone number',
        description_he: 'מספר טלפון'
      }
    ],
    confirmationRequired: false,
    destructive: false,
    successTemplate: 'Contact {first_name} {last_name} created successfully!',
    successTemplate_he: 'איש הקשר {first_name} {last_name} נוצר בהצלחה!'
  },

  {
    id: 'contact.update',
    domain: 'crm',
    entity: 'contact',
    action: 'update',
    description: 'Update an existing contact',
    description_he: 'עדכון פרטי איש קשר',
    examples: [
      'update contact email',
      'change phone number for John',
      'edit contact details'
    ],
    examples_he: [
      'עדכן אימייל של לקוח',
      'שנה טלפון של דוד',
      'ערוך פרטי איש קשר'
    ],
    params: [
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: true,
        description: 'Contact to update',
        prompt: 'Which contact do you want to update?',
        prompt_he: 'איזה איש קשר לעדכן?'
      },
      {
        name: 'first_name',
        type: 'string',
        required: false,
        description: 'New first name'
      },
      {
        name: 'last_name',
        type: 'string',
        required: false,
        description: 'New last name'
      },
      {
        name: 'email',
        type: 'email',
        required: false,
        description: 'New email'
      },
      {
        name: 'phone',
        type: 'phone',
        required: false,
        description: 'New phone'
      }
    ],
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Update contact {contact_id_entity.first_name} {contact_id_entity.last_name}?',
    confirmationTemplate_he: 'לעדכן את {contact_id_entity.first_name} {contact_id_entity.last_name}?',
    successTemplate: 'Contact updated successfully!',
    successTemplate_he: 'איש הקשר עודכן בהצלחה!'
  },

  {
    id: 'contact.delete',
    domain: 'crm',
    entity: 'contact',
    action: 'delete',
    description: 'Permanently delete a contact',
    description_he: 'מחיקת איש קשר לצמיתות',
    params: [
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: true,
        description: 'Contact to delete',
        prompt: 'Which contact do you want to delete?',
        prompt_he: 'איזה איש קשר למחוק?'
      }
    ],
    confirmationRequired: true,
    destructive: true,
    confirmationTemplate: '⚠️ PERMANENTLY delete {contact_id_entity.first_name}? This cannot be undone!',
    confirmationTemplate_he: '⚠️ למחוק לצמיתות את {contact_id_entity.first_name}? לא ניתן לשחזר!'
  },

  // =====================================
  // CRM - TASKS
  // =====================================
  {
    id: 'task.create',
    domain: 'crm',
    entity: 'task',
    action: 'create',
    description: 'Create a new task, todo, or reminder',
    description_he: 'יצירת משימה או תזכורת',
    examples: [
      'create a task',
      'add todo: call John tomorrow',
      'remind me to send invoice',
      'add task for next week'
    ],
    examples_he: [
      'צור משימה',
      'הוסף משימה: להתקשר לדוד',
      'תזכיר לי לשלוח חשבונית',
      'הוסף משימה לשבוע הבא'
    ],
    params: [
      {
        name: 'title',
        type: 'string',
        required: true,
        description: 'Task title or description',
        prompt: 'What is the task?',
        prompt_he: 'מה המשימה?'
      },
      {
        name: 'due_date',
        type: 'date',
        required: false,
        description: 'When the task is due',
        prompt: 'When is it due?',
        prompt_he: 'מתי לבצע?'
      },
      {
        name: 'priority',
        type: 'string',
        required: false,
        description: 'Task priority',
        default: 'medium',
        enumValues: ['low', 'medium', 'high']
      },
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: false,
        description: 'Related contact'
      }
    ],
    confirmationRequired: false,
    destructive: false,
    successTemplate: 'Task "{title}" created!',
    successTemplate_he: 'המשימה "{title}" נוצרה!'
  },

  {
    id: 'task.complete',
    domain: 'crm',
    entity: 'task',
    action: 'complete',
    description: 'Mark a task as completed',
    description_he: 'סימון משימה כהושלמה',
    examples: [
      'complete task',
      'mark as done',
      'finish task',
      'task done'
    ],
    examples_he: [
      'סיים משימה',
      'סמן כבוצע',
      'המשימה הושלמה',
      'בוצע'
    ],
    params: [
      {
        name: 'task_id',
        type: 'entity_ref',
        entityType: 'tasks',
        required: true,
        description: 'Task to complete',
        prompt: 'Which task did you complete?',
        prompt_he: 'איזו משימה הושלמה?'
      }
    ],
    confirmationRequired: false,
    destructive: false,
    successTemplate: 'Task marked as completed!',
    successTemplate_he: 'המשימה סומנה כהושלמה!'
  },

  {
    id: 'task.update',
    domain: 'crm',
    entity: 'task',
    action: 'update',
    description: 'Update task details',
    description_he: 'עדכון פרטי משימה',
    params: [
      {
        name: 'task_id',
        type: 'entity_ref',
        entityType: 'tasks',
        required: true,
        description: 'Task to update'
      },
      {
        name: 'title',
        type: 'string',
        required: false,
        description: 'New title'
      },
      {
        name: 'due_date',
        type: 'date',
        required: false,
        description: 'New due date'
      },
      {
        name: 'priority',
        type: 'string',
        required: false,
        description: 'New priority',
        enumValues: ['low', 'medium', 'high']
      }
    ],
    confirmationRequired: true,
    destructive: false
  },

  {
    id: 'task.delete',
    domain: 'crm',
    entity: 'task',
    action: 'delete',
    description: 'Delete a task',
    description_he: 'מחיקת משימה',
    params: [
      {
        name: 'task_id',
        type: 'entity_ref',
        entityType: 'tasks',
        required: true,
        description: 'Task to delete'
      }
    ],
    confirmationRequired: true,
    destructive: true
  },

  // =====================================
  // SCHEDULING - SERVICES
  // =====================================
  {
    id: 'service.create',
    domain: 'scheduling',
    entity: 'service',
    action: 'create',
    description: 'Create a new service offering',
    description_he: 'יצירת שירות חדש',
    params: [
      {
        name: 'service_name',
        type: 'string',
        required: true,
        description: 'Service name',
        prompt: 'What is the service called?',
        prompt_he: 'מה שם השירות?'
      },
      {
        name: 'duration_minutes',
        type: 'duration',
        required: true,
        description: 'Service duration',
        prompt: 'How long is the service?',
        prompt_he: 'כמה זמן נמשך השירות?'
      },
      {
        name: 'price',
        type: 'money',
        required: false,
        description: 'Service price',
        prompt: 'What is the price?',
        prompt_he: 'מה המחיר?'
      },
      {
        name: 'description',
        type: 'string',
        required: false,
        description: 'Service description'
      }
    ],
    confirmationRequired: false,
    destructive: false,
    successTemplate: 'Service "{service_name}" created!',
    successTemplate_he: 'השירות "{service_name}" נוצר!'
  },

  {
    id: 'service.update',
    domain: 'scheduling',
    entity: 'service',
    action: 'update',
    description: 'Update a service',
    description_he: 'עדכון שירות',
    params: [
      {
        name: 'service_id',
        type: 'entity_ref',
        entityType: 'services',
        required: true,
        description: 'Service to update',
        prompt: 'Which service to update?',
        prompt_he: 'איזה שירות לעדכן?'
      },
      {
        name: 'service_name',
        type: 'string',
        required: false,
        description: 'New name'
      },
      {
        name: 'duration_minutes',
        type: 'duration',
        required: false,
        description: 'New duration'
      },
      {
        name: 'price',
        type: 'money',
        required: false,
        description: 'New price'
      }
    ],
    confirmationRequired: true,
    destructive: false
  },

  {
    id: 'service.deactivate',
    domain: 'scheduling',
    entity: 'service',
    action: 'deactivate',
    description: 'Deactivate a service (hide, can reactivate later)',
    description_he: 'השבתת שירות (ניתן להפעיל מחדש)',
    examples: [
      'deactivate service',
      'hide service',
      'disable service'
    ],
    examples_he: [
      'השבת שירות',
      'הסתר שירות',
      'בטל שירות'
    ],
    params: [
      {
        name: 'service_id',
        type: 'entity_ref',
        entityType: 'services',
        required: true,
        description: 'Service to deactivate',
        prompt: 'Which service to deactivate?',
        prompt_he: 'איזה שירות להשבית?'
      }
    ],
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Deactivate "{service_id_entity.service_name}"? It will be hidden but can be reactivated.',
    confirmationTemplate_he: 'להשבית את "{service_id_entity.service_name}"? השירות יוסתר אך ניתן להפעילו מחדש.'
  },

  {
    id: 'service.activate',
    domain: 'scheduling',
    entity: 'service',
    action: 'activate',
    description: 'Reactivate a deactivated service',
    description_he: 'הפעלת שירות מחדש',
    params: [
      {
        name: 'service_id',
        type: 'entity_ref',
        entityType: 'services',
        required: true,
        description: 'Service to activate'
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  // =====================================
  // SCHEDULING - BOOKINGS
  // =====================================
  {
    id: 'booking.create',
    domain: 'scheduling',
    entity: 'booking',
    action: 'create',
    description: 'Schedule a new appointment, meeting, or booking',
    description_he: 'קביעת פגישה או תור חדש',
    examples: [
      'schedule a meeting',
      'book an appointment',
      'create booking for tomorrow'
    ],
    examples_he: [
      'קבע פגישה',
      'תאם תור',
      'הזמן פגישה למחר'
    ],
    params: [
      {
        name: 'service_id',
        type: 'entity_ref',
        entityType: 'services',
        required: true,
        description: 'Service type',
        prompt: 'Which service?',
        prompt_he: 'איזה שירות?'
      },
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: true,
        description: 'Client for the booking',
        prompt: 'For which client?',
        prompt_he: 'לאיזה לקוח?'
      },
      {
        name: 'start_time',
        type: 'datetime',
        required: true,
        description: 'Appointment date and time',
        prompt: 'When should we schedule it?',
        prompt_he: 'מתי לקבוע?'
      }
    ],
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Book {service_id_entity.service_name} with {contact_id_entity.first_name} on {start_time}?',
    confirmationTemplate_he: 'לקבוע {service_id_entity.service_name} עם {contact_id_entity.first_name} ב-{start_time}?'
  },

  {
    id: 'booking.reschedule',
    domain: 'scheduling',
    entity: 'booking',
    action: 'reschedule',
    description: 'Reschedule an existing appointment',
    description_he: 'שינוי מועד פגישה',
    examples: [
      'reschedule meeting',
      'move appointment',
      'change booking time'
    ],
    examples_he: [
      'הזז פגישה',
      'שנה מועד',
      'העבר תור'
    ],
    params: [
      {
        name: 'booking_id',
        type: 'entity_ref',
        entityType: 'bookings',
        required: true,
        description: 'Booking to reschedule',
        prompt: 'Which booking to reschedule?',
        prompt_he: 'איזו פגישה להזיז?'
      },
      {
        name: 'new_start_time',
        type: 'datetime',
        required: true,
        description: 'New date and time',
        prompt: 'When should we reschedule to?',
        prompt_he: 'למתי להעביר?'
      }
    ],
    confirmationRequired: true,
    destructive: false
  },

  {
    id: 'booking.cancel',
    domain: 'scheduling',
    entity: 'booking',
    action: 'cancel',
    description: 'Cancel an appointment',
    description_he: 'ביטול פגישה',
    params: [
      {
        name: 'booking_id',
        type: 'entity_ref',
        entityType: 'bookings',
        required: true,
        description: 'Booking to cancel',
        prompt: 'Which booking to cancel?',
        prompt_he: 'איזו פגישה לבטל?'
      }
    ],
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Cancel {booking_id_entity.service_name} with {booking_id_entity.contact_name}?',
    confirmationTemplate_he: 'לבטל את הפגישה עם {booking_id_entity.contact_name}?'
  },

  // =====================================
  // PAYMENTS - INVOICES
  // =====================================
  {
    id: 'invoice.create',
    domain: 'payments',
    entity: 'invoice',
    action: 'create',
    description: 'Create a new invoice',
    description_he: 'יצירת חשבונית חדשה',
    params: [
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: true,
        description: 'Client to invoice',
        prompt: 'Who should we invoice?',
        prompt_he: 'למי לשלוח חשבונית?'
      },
      {
        name: 'amount',
        type: 'money',
        required: true,
        description: 'Invoice amount',
        prompt: 'What is the total amount?',
        prompt_he: 'מה הסכום?'
      },
      {
        name: 'description',
        type: 'string',
        required: true,
        description: 'Invoice description',
        prompt: 'What is the invoice for?',
        prompt_he: 'עבור מה החשבונית?'
      },
      {
        name: 'due_date',
        type: 'date',
        required: false,
        description: 'Payment due date'
      }
    ],
    confirmationRequired: true,
    destructive: false
  },

  {
    id: 'invoice.send',
    domain: 'payments',
    entity: 'invoice',
    action: 'send',
    description: 'Send an invoice to the client',
    description_he: 'שליחת חשבונית ללקוח',
    examples: [
      'send invoice',
      'email invoice to client'
    ],
    examples_he: [
      'שלח חשבונית',
      'שלח חשבונית במייל'
    ],
    params: [
      {
        name: 'invoice_id',
        type: 'entity_ref',
        entityType: 'invoices',
        required: true,
        description: 'Invoice to send',
        prompt: 'Which invoice to send?',
        prompt_he: 'איזו חשבונית לשלוח?'
      }
    ],
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Send invoice #{invoice_id_entity.invoice_number} ({invoice_id_entity.amount}) to {invoice_id_entity.contact_name}?',
    confirmationTemplate_he: 'לשלוח חשבונית #{invoice_id_entity.invoice_number} ({invoice_id_entity.amount}) ל-{invoice_id_entity.contact_name}?'
  },

  // =====================================
  // COMMUNICATION - EMAIL
  // =====================================
  {
    id: 'email.send',
    domain: 'communication',
    entity: 'email',
    action: 'send',
    description: 'Send an email to a contact',
    description_he: 'שליחת אימייל לאיש קשר',
    examples: [
      'send email',
      'email John',
      'compose email to client'
    ],
    examples_he: [
      'שלח מייל',
      'שלח אימייל לדוד',
      'כתוב מייל ללקוח'
    ],
    params: [
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: true,
        description: 'Email recipient',
        prompt: 'Who should receive the email?',
        prompt_he: 'למי לשלוח?'
      },
      {
        name: 'subject',
        type: 'string',
        required: true,
        description: 'Email subject',
        prompt: 'What is the subject?',
        prompt_he: 'מה הנושא?'
      },
      {
        name: 'body',
        type: 'string',
        required: true,
        description: 'Email body',
        prompt: 'What should the email say?',
        prompt_he: 'מה לכתוב באימייל?'
      }
    ],
    confirmationRequired: true,
    destructive: false,
    confirmationTemplate: 'Send email to {contact_id_entity.email}?\n\nSubject: {subject}\n\n{body}',
    confirmationTemplate_he: 'לשלוח אימייל ל-{contact_id_entity.email}?\n\nנושא: {subject}\n\n{body}'
  }
];

// ============== HELPER FUNCTIONS ==============

/**
 * Get a capability by ID
 */
export function getCapability(id: string): Capability | undefined {
  return CAPABILITY_REGISTRY.find(c => c.id === id);
}

/**
 * Get all capabilities for an entity
 */
export function getCapabilitiesForEntity(entity: string): Capability[] {
  return CAPABILITY_REGISTRY.filter(c => c.entity === entity);
}

/**
 * Get all capabilities for a domain
 */
export function getCapabilitiesForDomain(domain: string): Capability[] {
  return CAPABILITY_REGISTRY.filter(c => c.domain === domain);
}

/**
 * Find capabilities matching a search term
 */
export function searchCapabilities(query: string): Capability[] {
  const lower = query.toLowerCase();
  return CAPABILITY_REGISTRY.filter(c =>
    c.id.toLowerCase().includes(lower) ||
    c.description.toLowerCase().includes(lower) ||
    c.description_he?.includes(query) ||
    c.examples?.some(e => e.toLowerCase().includes(lower)) ||
    c.examples_he?.some(e => e.includes(query))
  );
}

/**
 * Get required parameters for a capability
 */
export function getRequiredParams(capabilityId: string): CapabilityParam[] {
  const capability = getCapability(capabilityId);
  return capability?.params.filter(p => p.required) || [];
}

/**
 * Get optional parameters for a capability
 */
export function getOptionalParams(capabilityId: string): CapabilityParam[] {
  const capability = getCapability(capabilityId);
  return capability?.params.filter(p => !p.required) || [];
}

/**
 * Generate OpenAI tool schema from capability registry
 */
export function generateLLMToolSchema(): object[] {
  return CAPABILITY_REGISTRY.map(cap => ({
    type: 'function',
    function: {
      name: cap.id.replace('.', '_'),  // task.create → task_create
      description: cap.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          cap.params.map(p => [
            p.name,
            {
              type: paramTypeToJsonSchema(p.type),
              description: p.description,
              ...(p.enumValues ? { enum: p.enumValues } : {})
            }
          ])
        ),
        required: cap.params.filter(p => p.required).map(p => p.name)
      }
    }
  }));
}

/**
 * Generate minimal tool schema (for smaller models)
 */
export function generateMinimalToolSchema(): object[] {
  // Only include the most common capabilities
  const commonIds = [
    'task.create', 'task.complete',
    'contact.create',
    'booking.create', 'booking.cancel',
    'invoice.send'
  ];

  return CAPABILITY_REGISTRY
    .filter(c => commonIds.includes(c.id))
    .map(cap => ({
      type: 'function',
      function: {
        name: cap.id.replace('.', '_'),
        description: cap.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            cap.params
              .filter(p => p.required)  // Only required params
              .map(p => [
                p.name,
                { type: 'string', description: p.description }
              ])
          ),
          required: cap.params.filter(p => p.required).map(p => p.name)
        }
      }
    }));
}

function paramTypeToJsonSchema(type: ParamType): string {
  switch (type) {
    case 'number':
    case 'money':
    case 'duration':
      return 'number';
    case 'boolean':
      return 'boolean';
    default:
      return 'string';
  }
}

/**
 * Validate parameters against capability schema
 */
export function validateParams(
  capabilityId: string,
  params: Record<string, unknown>
): { valid: boolean; missing: string[]; errors: Record<string, string> } {
  const capability = getCapability(capabilityId);
  if (!capability) {
    return { valid: false, missing: [], errors: { _capability: 'Unknown capability' } };
  }

  const missing: string[] = [];
  const errors: Record<string, string> = {};

  for (const param of capability.params) {
    const value = params[param.name];

    // Check required
    if (param.required && (value === undefined || value === null || value === '')) {
      missing.push(param.name);
      continue;
    }

    // Check enum values
    if (param.enumValues && value !== undefined) {
      if (!param.enumValues.includes(String(value))) {
        errors[param.name] = `Must be one of: ${param.enumValues.join(', ')}`;
      }
    }

    // Check Zod validation
    if (param.validation && value !== undefined) {
      const result = param.validation.safeParse(value);
      if (!result.success) {
        errors[param.name] = result.error.errors[0]?.message || 'Invalid value';
      }
    }
  }

  return {
    valid: missing.length === 0 && Object.keys(errors).length === 0,
    missing,
    errors
  };
}

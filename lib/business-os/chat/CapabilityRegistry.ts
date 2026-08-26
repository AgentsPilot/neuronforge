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

  // Display label for the parameter (used in confirmations/prompts)
  label?: string;
  label_he?: string;

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
  domain: 'crm' | 'scheduling' | 'payments' | 'communication' | 'settings' | 'reports' | 'navigation';
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
        description_he: 'כתובת אימייל',
        prompt: 'Email address? (or skip)',
        prompt_he: 'כתובת אימייל? (או דלג)'
      },
      {
        name: 'phone',
        type: 'phone',
        required: false,
        description: 'Phone number',
        description_he: 'מספר טלפון',
        prompt: 'Phone number? (or skip)',
        prompt_he: 'מספר טלפון? (או דלג)'
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
        description: 'New first name',
        prompt: 'New first name? (or skip)',
        prompt_he: 'שם פרטי חדש? (או דלג)'
      },
      {
        name: 'last_name',
        type: 'string',
        required: false,
        description: 'New last name',
        prompt: 'New last name? (or skip)',
        prompt_he: 'שם משפחה חדש? (או דלג)'
      },
      {
        name: 'email',
        type: 'email',
        required: false,
        description: 'New email',
        prompt: 'New email address? (or skip)',
        prompt_he: 'אימייל חדש? (או דלג)'
      },
      {
        name: 'phone',
        type: 'phone',
        required: false,
        description: 'New phone',
        prompt: 'New phone number? (or skip)',
        prompt_he: 'טלפון חדש? (או דלג)'
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
    examples: [
      'delete contact',
      'remove client',
      'delete customer'
    ],
    examples_he: [
      'מחק איש קשר',
      'מחק לקוח',
      'הסר לקוח'
    ],
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
      'create task',
      'add task',
      'new task',
      'open task',
      'add todo: call John tomorrow',
      'remind me to send invoice',
      'add task for next week'
    ],
    examples_he: [
      'צור משימה',
      'פתח משימה',
      'הוסף משימה',
      'משימה חדשה',
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
        enumValues: ['low', 'medium', 'high'],
        prompt: 'What priority? (low/medium/high, or skip)',
        prompt_he: 'מה העדיפות? (נמוכה/בינונית/גבוהה, או דלג)'
      },
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: false,
        description: 'Contact name when mentioned (e.g., "for Moshe" / "לדוד" / "למשה")',
        prompt: 'Related to a contact? If yes, who?',
        prompt_he: 'האם קשור לאיש קשר? אם כן, למי?'
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
    examples: [
      'update task',
      'change task',
      'edit task',
      'modify task'
    ],
    examples_he: [
      'עדכן משימה',
      'שנה משימה',
      'ערוך משימה'
    ],
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
    examples: [
      'delete task',
      'remove task',
      'remove todo'
    ],
    examples_he: [
      'מחק משימה',
      'הסר משימה'
    ],
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
    examples: [
      'create service',
      'add service',
      'new service',
      'add offering'
    ],
    examples_he: [
      'צור שירות',
      'הוסף שירות',
      'שירות חדש'
    ],
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
    examples: [
      'update service',
      'change service',
      'edit service',
      'modify service price'
    ],
    examples_he: [
      'עדכן שירות',
      'שנה שירות',
      'ערוך שירות',
      'שנה מחיר שירות'
    ],
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
    examples: [
      'activate service',
      'enable service',
      'reactivate service',
      'turn on service'
    ],
    examples_he: [
      'הפעל שירות',
      'הפעל מחדש שירות',
      'אפשר שירות'
    ],
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
    examples: [
      'cancel booking',
      'cancel appointment',
      'cancel meeting',
      'cancel session'
    ],
    examples_he: [
      'בטל פגישה',
      'בטל תור',
      'ביטול פגישה',
      'ביטול תור'
    ],
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
    examples: [
      'create invoice',
      'new invoice',
      'make invoice',
      'bill client',
      'create bill'
    ],
    examples_he: [
      'צור חשבונית',
      'חשבונית חדשה',
      'הפק חשבונית',
      'יצירת חשבונית'
    ],
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
        description: 'Payment due date',
        prompt: 'When is the payment due? (or skip)',
        prompt_he: 'מתי התשלום? (או דלג)'
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
      'שלח אימייל',
      'שלח אימייל לדוד',
      'שליחת אימייל',
      'שליחת מייל',
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
  },

  // =====================================
  // SEARCH/QUERY OPERATIONS
  // =====================================
  {
    id: 'contact.search',
    domain: 'crm',
    entity: 'contact',
    action: 'search',
    description: 'Search or list contacts/clients/leads',
    description_he: 'חיפוש או הצגת אנשי קשר/לקוחות/לידים',
    examples: [
      'find contact',
      'search for John',
      'show all clients',
      'who are my leads',
      'list contacts'
    ],
    examples_he: [
      'מצא איש קשר',
      'חפש לקוח',
      'הראה לידים',
      'כמה לידים יש לי',
      'הראה את כל הלקוחות'
    ],
    params: [
      {
        name: 'query',
        type: 'string',
        required: false,
        description: 'Name or email to search for',
        prompt: 'Search for a specific name or email? (or skip to show all)',
        prompt_he: 'לחפש שם או אימייל ספציפי? (או דלג להראות הכל)'
      },
      {
        name: 'status',
        type: 'string',
        required: false,
        description: 'Filter by status: lead, client, prospect',
        enumValues: ['lead', 'client', 'prospect', 'qualified'],
        prompt: 'Filter by status? (lead/client/prospect, or skip)',
        prompt_he: 'לסנן לפי סטטוס? (ליד/לקוח/פוטנציאלי, או דלג)'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: 'Maximum number of results',
        prompt: 'How many results? (or skip for default)',
        prompt_he: 'כמה תוצאות להציג? (או דלג לברירת מחדל)'
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  {
    id: 'task.search',
    domain: 'crm',
    entity: 'task',
    action: 'search',
    description: 'Search or list tasks/todos',
    description_he: 'חיפוש או הצגת משימות',
    examples: [
      'show my tasks',
      'what tasks are due today',
      'list overdue tasks',
      'show all todos'
    ],
    examples_he: [
      'הראה משימות',
      'מה המשימות להיום',
      'משימות באיחור',
      'כל המשימות'
    ],
    params: [
      {
        name: 'status',
        type: 'string',
        required: false,
        description: 'Filter: pending, completed, overdue',
        enumValues: ['pending', 'completed', 'overdue'],
        prompt: 'Filter by status? (pending/completed/overdue, or skip)',
        prompt_he: 'לסנן לפי סטטוס? (ממתין/הושלם/באיחור, או דלג)'
      },
      {
        name: 'due_period',
        type: 'string',
        required: false,
        description: 'Time period: today, this_week, this_month',
        enumValues: ['today', 'tomorrow', 'this_week', 'this_month'],
        prompt: 'Filter by time period? (today/tomorrow/this_week/this_month, or skip)',
        prompt_he: 'לסנן לפי תקופה? (היום/מחר/השבוע/החודש, או דלג)'
      },
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: false,
        description: 'Filter by related contact',
        prompt: 'Filter by contact? (enter name, or skip)',
        prompt_he: 'לסנן לפי איש קשר? (הזן שם, או דלג)'
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  {
    id: 'booking.search',
    domain: 'scheduling',
    entity: 'booking',
    action: 'search',
    description: 'Search or list bookings/appointments',
    description_he: 'חיפוש או הצגת פגישות/תורים',
    examples: [
      'show my bookings',
      'what meetings do I have today',
      'show appointments this week',
      'list all bookings'
    ],
    examples_he: [
      'הראה פגישות',
      'מה יש לי היום',
      'פגישות השבוע',
      'כל התורים'
    ],
    params: [
      {
        name: 'period',
        type: 'string',
        required: false,
        description: 'Time period: today, tomorrow, this_week, next_week',
        enumValues: ['today', 'tomorrow', 'this_week', 'next_week', 'this_month'],
        prompt: 'Which time period? (today/tomorrow/this_week/next_week, or skip)',
        prompt_he: 'איזו תקופה? (היום/מחר/השבוע/שבוע הבא, או דלג)'
      },
      {
        name: 'status',
        type: 'string',
        required: false,
        description: 'Filter: confirmed, cancelled, completed',
        enumValues: ['confirmed', 'cancelled', 'completed', 'no_show'],
        prompt: 'Filter by status? (confirmed/cancelled/completed, or skip)',
        prompt_he: 'לסנן לפי סטטוס? (מאושר/מבוטל/הושלם, או דלג)'
      },
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: false,
        description: 'Filter by client',
        prompt: 'Filter by client? (enter name, or skip)',
        prompt_he: 'לסנן לפי לקוח? (הזן שם, או דלג)'
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  {
    id: 'service.search',
    domain: 'scheduling',
    entity: 'service',
    action: 'search',
    description: 'Search or list services',
    description_he: 'חיפוש או הצגת שירותים',
    examples: [
      'show my services',
      'list all services',
      'what services do I offer'
    ],
    examples_he: [
      'הראה שירותים',
      'כל השירותים',
      'אילו שירותים אני מציע'
    ],
    params: [
      {
        name: 'active_only',
        type: 'boolean',
        required: false,
        description: 'Show only active services',
        default: true,
        prompt: 'Show only active services? (yes/no, or skip)',
        prompt_he: 'להציג רק שירותים פעילים? (כן/לא, או דלג)'
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  {
    id: 'invoice.search',
    domain: 'payments',
    entity: 'invoice',
    action: 'search',
    description: 'Search or list invoices',
    description_he: 'חיפוש או הצגת חשבוניות',
    examples: [
      'show invoices',
      'who owes me money',
      'unpaid invoices',
      'show overdue invoices',
      'open invoices'
    ],
    examples_he: [
      'הראה חשבוניות',
      'מי חייב לי כסף',
      'חשבוניות שלא שולמו',
      'חשבוניות באיחור',
      'חשבוניות פתוחות',
      'האם יש לי חשבוניות פתוחות'
    ],
    params: [
      {
        name: 'status',
        type: 'string',
        required: false,
        description: 'Filter: draft, sent, paid, overdue, open. Use "open" or "unpaid" for outstanding invoices.',
        enumValues: ['draft', 'sent', 'paid', 'overdue', 'cancelled', 'open', 'unpaid'],
        prompt: 'Filter by status? (draft/sent/paid/overdue, or skip)',
        prompt_he: 'לסנן לפי סטטוס? (טיוטה/נשלחה/שולם/באיחור, או דלג)'
      },
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: false,
        description: 'Filter by client',
        prompt: 'Filter by client? (enter name, or skip)',
        prompt_he: 'לסנן לפי לקוח? (הזן שם, או דלג)'
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  {
    id: 'transaction.search',
    domain: 'payments',
    entity: 'transaction',
    action: 'search',
    description: 'Search or list payment transactions (refunds, payments received)',
    description_he: 'חיפוש עסקאות תשלום (החזרים, תשלומים שהתקבלו)',
    examples: [
      'show transactions',
      'who got a refund',
      'list refunds',
      'show payment history'
    ],
    examples_he: [
      'הראה עסקאות',
      'מי קיבל החזר',
      'הראה החזרים',
      'היסטוריית תשלומים'
    ],
    params: [
      {
        name: 'status',
        type: 'string',
        required: false,
        description: 'Filter: succeeded, refunded, pending, failed',
        enumValues: ['succeeded', 'refunded', 'pending', 'failed']
      },
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: false,
        description: 'Filter by client'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: 'Max results'
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  // =====================================
  // AVAILABILITY & CALENDAR
  // =====================================
  {
    id: 'availability.update',
    domain: 'settings',
    entity: 'availability',
    action: 'update',
    description: 'Update working hours/availability schedule',
    description_he: 'עדכון שעות עבודה/זמינות',
    examples: [
      'add Saturday hours',
      'change my availability',
      'set working hours',
      'update schedule'
    ],
    examples_he: [
      'הוסף שעות בשבת',
      'שנה זמינות',
      'עדכן שעות עבודה',
      'שנה לוח זמנים'
    ],
    params: [
      {
        name: 'days',
        type: 'string',
        required: false,
        description: 'Days to update (comma-separated): sunday, monday, tuesday, wednesday, thursday, friday, saturday'
      },
      {
        name: 'start_time',
        type: 'time',
        required: false,
        description: 'Start time (24h format)',
        prompt: 'What time do you start?',
        prompt_he: 'באיזו שעה מתחילים?'
      },
      {
        name: 'end_time',
        type: 'time',
        required: false,
        description: 'End time (24h format)',
        prompt: 'What time do you finish?',
        prompt_he: 'באיזו שעה מסיימים?'
      }
    ],
    confirmationRequired: true,
    destructive: false
  },

  {
    id: 'availability.query',
    domain: 'settings',
    entity: 'availability',
    action: 'query',
    description: 'Check current availability/working hours',
    description_he: 'בדיקת זמינות/שעות עבודה נוכחיות',
    examples: [
      'what are my hours',
      'show availability',
      'when am I available'
    ],
    examples_he: [
      'מה השעות שלי',
      'הראה זמינות',
      'מתי אני פנוי'
    ],
    params: [],
    confirmationRequired: false,
    destructive: false
  },

  {
    id: 'calendar.open',
    domain: 'scheduling',
    entity: 'calendar',
    action: 'open',
    description: 'Open/show the calendar view',
    description_he: 'פתיחת תצוגת היומן',
    examples: [
      'open calendar',
      'show my calendar',
      'open schedule'
    ],
    examples_he: [
      'פתח יומן',
      'הראה יומן',
      'טען יומן'
    ],
    params: [],
    confirmationRequired: false,
    destructive: false
  },

  // =====================================
  // REPORTS & ANALYTICS
  // =====================================
  {
    id: 'report.query',
    domain: 'reports',
    entity: 'report',
    action: 'query',
    description: 'Get business metrics (revenue, bookings, clients)',
    description_he: 'קבלת מדדים עסקיים (הכנסות, פגישות, לקוחות)',
    examples: [
      'how much did I earn',
      'show revenue',
      'how many bookings this week',
      'show monthly report'
    ],
    examples_he: [
      'כמה הרווחתי',
      'הראה הכנסות',
      'כמה פגישות השבוע',
      'הראה דוח חודשי'
    ],
    params: [
      {
        name: 'metric',
        type: 'string',
        required: false,
        description: 'Metric to show: revenue, bookings, clients, payments',
        enumValues: ['revenue', 'bookings', 'clients', 'payments']
      },
      {
        name: 'period',
        type: 'string',
        required: false,
        description: 'Time period: today, this_week, this_month, last_month',
        enumValues: ['today', 'this_week', 'this_month', 'last_month', 'this_year']
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  // =====================================
  // NAVIGATION
  // =====================================
  {
    id: 'navigate',
    domain: 'settings',
    entity: 'navigation',
    action: 'go',
    description: 'Navigate to a specific page or section',
    description_he: 'מעבר לדף או חלק ספציפי',
    examples: [
      'go to contacts',
      'open settings',
      'show reports page'
    ],
    examples_he: [
      'עבור לאנשי קשר',
      'פתח הגדרות',
      'הראה דוחות'
    ],
    params: [
      {
        name: 'destination',
        type: 'string',
        required: true,
        description: 'Where to navigate: contacts, calendar, services, payments, reports, settings',
        enumValues: ['contacts', 'calendar', 'services', 'payments', 'reports', 'settings']
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  // =====================================
  // BOOKING STATUS UPDATE
  // =====================================
  {
    id: 'booking.update_status',
    domain: 'scheduling',
    entity: 'booking',
    action: 'update_status',
    description: 'Mark booking as completed, no-show, or other status',
    description_he: 'סימון פגישה כהושלמה, לא הגיע, או סטטוס אחר',
    examples: [
      'mark as completed',
      'client showed up',
      'no show',
      'mark as no-show'
    ],
    examples_he: [
      'סמן כהושלם',
      'הלקוח הגיע',
      'לא הגיע',
      'סמן כלא הגיע'
    ],
    params: [
      {
        name: 'booking_id',
        type: 'entity_ref',
        entityType: 'bookings',
        required: true,
        description: 'Booking to update',
        prompt: 'Which booking?',
        prompt_he: 'איזו פגישה?'
      },
      {
        name: 'new_status',
        type: 'string',
        required: true,
        description: 'New status: completed, no_show, cancelled',
        enumValues: ['completed', 'no_show', 'cancelled', 'confirmed']
      }
    ],
    confirmationRequired: false,
    destructive: false
  },

  // =====================================
  // PAYMENT RECORDING
  // =====================================
  {
    id: 'payment.record',
    domain: 'payments',
    entity: 'payment',
    action: 'record',
    description: 'Record a payment received (cash, bank transfer, etc.)',
    description_he: 'רישום תשלום שהתקבל (מזומן, העברה בנקאית, וכו\')',
    examples: [
      'record payment',
      'John paid cash',
      'mark invoice as paid',
      'received payment'
    ],
    examples_he: [
      'רשום תשלום',
      'דוד שילם במזומן',
      'סמן חשבונית כשולמה',
      'התקבל תשלום'
    ],
    params: [
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: true,
        description: 'Client who paid',
        prompt: 'Who paid?',
        prompt_he: 'מי שילם?'
      },
      {
        name: 'amount',
        type: 'money',
        required: true,
        description: 'Payment amount',
        prompt: 'How much?',
        prompt_he: 'כמה?'
      },
      {
        name: 'method',
        type: 'string',
        required: false,
        description: 'Payment method: cash, bank_transfer, card, other',
        enumValues: ['cash', 'bank_transfer', 'card', 'other'],
        default: 'cash'
      },
      {
        name: 'invoice_id',
        type: 'entity_ref',
        entityType: 'invoices',
        required: false,
        description: 'Invoice this payment is for'
      }
    ],
    confirmationRequired: true,
    destructive: false
  },

  // =====================================
  // CRM - ACTIVITIES
  // =====================================
  {
    id: 'activity.create',
    domain: 'crm',
    entity: 'activity',
    action: 'create',
    description: 'Add an activity to a contact (note, call, meeting, email)',
    description_he: 'הוספת פעילות לאיש קשר (הערה, שיחה, פגישה, אימייל)',
    examples: [
      'add note for John',
      'log call with client',
      'record meeting notes'
    ],
    examples_he: [
      'הוסף הערה לדוד',
      'רשום שיחה עם לקוח',
      'רשום סיכום פגישה'
    ],
    params: [
      {
        name: 'contact_id',
        type: 'entity_ref',
        entityType: 'contacts',
        required: true,
        description: 'Contact to add activity for',
        prompt: 'For which contact?',
        prompt_he: 'לאיזה איש קשר?'
      },
      {
        name: 'activity_type',
        type: 'string',
        required: true,
        description: 'Type: note, call, meeting, email',
        enumValues: ['note', 'call', 'meeting', 'email'],
        default: 'note'
      },
      {
        name: 'title',
        type: 'string',
        required: false,
        description: 'Activity title/summary'
      },
      {
        name: 'description',
        type: 'string',
        required: true,
        description: 'Activity details',
        prompt: 'What are the details?',
        prompt_he: 'מה הפרטים?'
      }
    ],
    confirmationRequired: false,
    destructive: false
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
        // NOTE: We intentionally don't mark params as required here.
        // If we do, the LLM will fabricate values for required params even when
        // the user didn't provide them. Instead, we handle requirements at runtime
        // via the slot-filling service, which asks the user for missing params.
        required: []
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

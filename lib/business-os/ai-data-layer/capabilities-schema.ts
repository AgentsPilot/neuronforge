/**
 * Capabilities Schema
 *
 * Defines the complete structure of Business OS capabilities that the LLM
 * can understand and operate on. This is the single source of truth for
 * what the AI can do.
 *
 * Structure:
 * - Capability (e.g., CRM, Scheduling)
 *   - Entity (e.g., contacts, services)
 *     - Actions (e.g., list, create, update, deactivate, delete)
 *       - Action semantics (what it does, is it destructive, etc.)
 */

// =============================================================================
// Action Types
// =============================================================================

export type ActionType =
  | 'list'      // Query multiple records
  | 'get'       // Get single record by ID
  | 'create'    // Create new record
  | 'update'    // Modify existing record (generic)
  | 'delete'    // Permanently remove (destructive)
  // Semantic actions (more specific than update/delete)
  | 'deactivate'   // Hide/unpublish (reversible, data preserved)
  | 'activate'     // Show/publish (reversible)
  | 'complete'     // Mark as done (bookings, tasks)
  | 'cancel'       // Cancel (bookings, invoices)
  | 'archive'      // Soft archive (pages)
  | 'publish'      // Make live (pages, services)
  | 'send'         // Send out (invoices, emails)
  | 'enroll'       // Enroll in sequence
  | 'pause'        // Pause (enrollments)
  | 'resume';      // Resume (enrollments)

export interface ActionDefinition {
  type: ActionType;
  /** What this action does - for LLM understanding */
  description: string;
  /** Is this action destructive (cannot be undone)? */
  destructive: boolean;
  /** Does this action require confirmation? */
  requiresConfirmation: boolean;
  /** Required fields for this action */
  requiredFields?: string[];
  /** Optional fields */
  optionalFields?: string[];
  /** The underlying operation (for execution) */
  operation: 'query' | 'mutation';
  /** For mutations: the actual DB operation */
  dbOperation?: 'insert' | 'update' | 'delete';
  /** For updates: the payload to apply */
  payload?: Record<string, unknown>;
}

// =============================================================================
// Entity Definitions
// =============================================================================

export interface EntityField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  description: string;
  required?: boolean;
  /** Possible values for enum-like fields */
  enum?: string[];
}

export interface EntityDefinition {
  name: string;
  /** Singular display name */
  displayName: string;
  /** Plural display name */
  displayNamePlural: string;
  /** Description for LLM */
  description: string;
  /** Primary identifier field */
  primaryKey: string;
  /** Fields that can be used for search/display */
  searchableFields: string[];
  /** Human-readable label field (for "Show contact X") */
  labelField: string;
  /** Available actions for this entity */
  actions: Record<ActionType, ActionDefinition | undefined>;
  /** Field definitions */
  fields: EntityField[];
}

// =============================================================================
// Capability Definitions
// =============================================================================

export interface CapabilityDefinition {
  key: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  entities: Record<string, EntityDefinition>;
  /** Navigation paths */
  routes: {
    main: string;
    [key: string]: string;
  };
}

// =============================================================================
// The Complete Capabilities Schema
// =============================================================================

export const CAPABILITIES_SCHEMA: Record<string, CapabilityDefinition> = {
  crm: {
    key: 'crm',
    name: 'CRM',
    description: 'Client relationship management - contacts, tasks, and pipeline',
    icon: 'Users',
    color: '#60A5FA',
    routes: {
      main: '/business-os/crm',
      contacts: '/business-os/crm',
      tasks: '/business-os/crm?tab=tasks',
    },
    entities: {
      contacts: {
        name: 'contacts',
        displayName: 'contact',
        displayNamePlural: 'contacts',
        description: 'Client/lead contact records with personal info and stage tracking',
        primaryKey: 'id',
        searchableFields: ['first_name', 'last_name', 'email', 'phone'],
        labelField: 'first_name',
        fields: [
          { name: 'id', type: 'string', description: 'Unique identifier' },
          { name: 'first_name', type: 'string', description: 'First name' },
          { name: 'last_name', type: 'string', description: 'Last name' },
          { name: 'email', type: 'string', description: 'Email address' },
          { name: 'phone', type: 'string', description: 'Phone number' },
          { name: 'stage', type: 'string', description: 'Pipeline stage', enum: ['lead', 'client', 'past_client'] },
          { name: 'tags', type: 'array', description: 'Tags for categorization' },
          { name: 'source', type: 'string', description: 'How they found you', enum: ['website_form', 'manual', 'import', 'booking'] },
        ],
        actions: {
          list: {
            type: 'list',
            description: 'Get a list of contacts with optional filters',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            optionalFields: ['stage', 'tags', 'search', 'limit'],
          },
          get: {
            type: 'get',
            description: 'Get a single contact by ID',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            requiredFields: ['id'],
          },
          create: {
            type: 'create',
            description: 'Create a new contact',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'insert',
            requiredFields: ['first_name'],
            optionalFields: ['last_name', 'email', 'phone', 'stage', 'tags'],
          },
          update: {
            type: 'update',
            description: 'Update contact information',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            optionalFields: ['first_name', 'last_name', 'email', 'phone', 'stage', 'tags'],
          },
          delete: {
            type: 'delete',
            description: 'Permanently delete a contact - this cannot be undone!',
            destructive: true,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'delete',
            requiredFields: ['id'],
          },
          // Semantic actions not applicable
          deactivate: undefined,
          activate: undefined,
          complete: undefined,
          cancel: undefined,
          archive: undefined,
          publish: undefined,
          send: undefined,
          enroll: undefined,
          pause: undefined,
          resume: undefined,
        },
      },
      tasks: {
        name: 'tasks',
        displayName: 'task',
        displayNamePlural: 'tasks',
        description: 'Follow-up tasks linked to contacts',
        primaryKey: 'id',
        searchableFields: ['title', 'description'],
        labelField: 'title',
        fields: [
          { name: 'id', type: 'string', description: 'Unique identifier' },
          { name: 'contact_id', type: 'string', description: 'Associated contact' },
          { name: 'title', type: 'string', description: 'Task title', required: true },
          { name: 'description', type: 'string', description: 'Task details' },
          { name: 'priority', type: 'string', description: 'Priority level', enum: ['low', 'medium', 'high', 'urgent'] },
          { name: 'status', type: 'string', description: 'Current status', enum: ['pending', 'in_progress', 'completed', 'cancelled'] },
          { name: 'due_date', type: 'date', description: 'Due date' },
        ],
        actions: {
          list: {
            type: 'list',
            description: 'Get a list of tasks',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            optionalFields: ['contact_id', 'status', 'priority'],
          },
          get: {
            type: 'get',
            description: 'Get a single task',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            requiredFields: ['id'],
          },
          create: {
            type: 'create',
            description: 'Create a new task',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'insert',
            requiredFields: ['title'],
            optionalFields: ['contact_id', 'description', 'priority', 'due_date'],
          },
          update: {
            type: 'update',
            description: 'Update task details',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
          },
          complete: {
            type: 'complete',
            description: 'Mark task as completed',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { status: 'completed' },
          },
          cancel: {
            type: 'cancel',
            description: 'Cancel a task',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { status: 'cancelled' },
          },
          delete: {
            type: 'delete',
            description: 'Permanently delete a task',
            destructive: true,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'delete',
            requiredFields: ['id'],
          },
          deactivate: undefined,
          activate: undefined,
          archive: undefined,
          publish: undefined,
          send: undefined,
          enroll: undefined,
          pause: undefined,
          resume: undefined,
        },
      },
    },
  },

  scheduling: {
    key: 'scheduling',
    name: 'Scheduling',
    description: 'Services, bookings, and availability management',
    icon: 'Calendar',
    color: '#10B981',
    routes: {
      main: '/business-os/scheduling',
      services: '/business-os/scheduling?tab=services',
      bookings: '/business-os/scheduling',
      availability: '/business-os/scheduling?tab=availability',
    },
    entities: {
      services: {
        name: 'services',
        displayName: 'service',
        displayNamePlural: 'services',
        description: 'Appointment types that clients can book (e.g., consultation, therapy session)',
        primaryKey: 'id',
        searchableFields: ['service_name', 'description'],
        labelField: 'service_name',
        fields: [
          { name: 'id', type: 'string', description: 'Unique identifier' },
          { name: 'service_name', type: 'string', description: 'Service name', required: true },
          { name: 'description', type: 'string', description: 'Service description' },
          { name: 'duration_minutes', type: 'number', description: 'Duration in minutes', required: true },
          { name: 'price', type: 'number', description: 'Price amount' },
          { name: 'currency', type: 'string', description: 'Currency', enum: ['USD', 'EUR', 'ILS', 'GBP'] },
          { name: 'is_active', type: 'boolean', description: 'Whether service is visible to clients' },
          { name: 'status', type: 'string', description: 'Draft or active', enum: ['draft', 'active'] },
        ],
        actions: {
          list: {
            type: 'list',
            description: 'Get a list of services',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            optionalFields: ['is_active'],
          },
          get: {
            type: 'get',
            description: 'Get a single service',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            requiredFields: ['id'],
          },
          create: {
            type: 'create',
            description: 'Create a new service',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'insert',
            requiredFields: ['service_name', 'duration_minutes'],
            optionalFields: ['description', 'price', 'currency'],
          },
          update: {
            type: 'update',
            description: 'Update service details (name, price, duration, etc.)',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
          },
          deactivate: {
            type: 'deactivate',
            description: 'Hide service from clients - service is preserved but not visible for booking. This is reversible.',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { is_active: false },
          },
          activate: {
            type: 'activate',
            description: 'Make service visible to clients for booking',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { is_active: true },
          },
          publish: {
            type: 'publish',
            description: 'Publish a draft service (same as activate)',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { is_active: true, status: 'active' },
          },
          delete: {
            type: 'delete',
            description: 'Permanently delete a service - this cannot be undone! Use deactivate to hide instead.',
            destructive: true,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'delete',
            requiredFields: ['id'],
          },
          complete: undefined,
          cancel: undefined,
          archive: undefined,
          send: undefined,
          enroll: undefined,
          pause: undefined,
          resume: undefined,
        },
      },
      bookings: {
        name: 'bookings',
        displayName: 'booking',
        displayNamePlural: 'bookings',
        description: 'Client appointments/bookings',
        primaryKey: 'id',
        searchableFields: ['client_first_name', 'client_last_name', 'client_email'],
        labelField: 'client_first_name',
        fields: [
          { name: 'id', type: 'string', description: 'Unique identifier' },
          { name: 'service_id', type: 'string', description: 'Which service', required: true },
          { name: 'contact_id', type: 'string', description: 'Associated contact' },
          { name: 'client_first_name', type: 'string', description: 'Client first name', required: true },
          { name: 'client_last_name', type: 'string', description: 'Client last name' },
          { name: 'client_email', type: 'string', description: 'Client email', required: true },
          { name: 'client_phone', type: 'string', description: 'Client phone' },
          { name: 'start_time', type: 'date', description: 'Start date/time', required: true },
          { name: 'end_time', type: 'date', description: 'End date/time', required: true },
          { name: 'status', type: 'string', description: 'Booking status', enum: ['pending', 'confirmed', 'completed', 'no_show', 'cancelled'] },
          { name: 'notes', type: 'string', description: 'Client notes' },
        ],
        actions: {
          list: {
            type: 'list',
            description: 'Get a list of bookings',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            optionalFields: ['service_id', 'status', 'start_date', 'end_date'],
          },
          get: {
            type: 'get',
            description: 'Get a single booking',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            requiredFields: ['id'],
          },
          create: {
            type: 'create',
            description: 'Create a new booking',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'insert',
            requiredFields: ['service_id', 'client_first_name', 'client_email', 'start_time'],
          },
          update: {
            type: 'update',
            description: 'Update booking details',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
          },
          complete: {
            type: 'complete',
            description: 'Mark booking as completed (appointment happened)',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { status: 'completed' },
          },
          cancel: {
            type: 'cancel',
            description: 'Cancel a booking',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { status: 'cancelled' },
          },
          delete: {
            type: 'delete',
            description: 'Permanently delete a booking',
            destructive: true,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'delete',
            requiredFields: ['id'],
          },
          deactivate: undefined,
          activate: undefined,
          archive: undefined,
          publish: undefined,
          send: undefined,
          enroll: undefined,
          pause: undefined,
          resume: undefined,
        },
      },
    },
  },

  payments: {
    key: 'payments',
    name: 'Payments',
    description: 'Invoices, transactions, and payment collection',
    icon: 'CreditCard',
    color: '#F59E0B',
    routes: {
      main: '/business-os/payments',
      invoices: '/business-os/payments?tab=invoices',
      transactions: '/business-os/payments?tab=transactions',
    },
    entities: {
      invoices: {
        name: 'invoices',
        displayName: 'invoice',
        displayNamePlural: 'invoices',
        description: 'Payment requests sent to clients',
        primaryKey: 'id',
        searchableFields: ['invoice_number'],
        labelField: 'invoice_number',
        fields: [
          { name: 'id', type: 'string', description: 'Unique identifier' },
          { name: 'invoice_number', type: 'string', description: 'Invoice number' },
          { name: 'contact_id', type: 'string', description: 'Client contact' },
          { name: 'amount', type: 'number', description: 'Total amount', required: true },
          { name: 'currency', type: 'string', description: 'Currency', enum: ['USD', 'EUR', 'ILS', 'GBP'] },
          { name: 'status', type: 'string', description: 'Invoice status', enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'] },
          { name: 'due_date', type: 'date', description: 'Payment due date' },
          { name: 'line_items', type: 'array', description: 'Invoice line items' },
          { name: 'notes', type: 'string', description: 'Notes for client' },
        ],
        actions: {
          list: {
            type: 'list',
            description: 'Get a list of invoices',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            optionalFields: ['status', 'contact_id'],
          },
          get: {
            type: 'get',
            description: 'Get a single invoice',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            requiredFields: ['id'],
          },
          create: {
            type: 'create',
            description: 'Create a new invoice',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'insert',
            requiredFields: ['amount'],
            optionalFields: ['contact_id', 'currency', 'due_date', 'line_items', 'notes'],
          },
          update: {
            type: 'update',
            description: 'Update invoice details',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
          },
          send: {
            type: 'send',
            description: 'Send invoice to client via email',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { status: 'sent' },
          },
          cancel: {
            type: 'cancel',
            description: 'Cancel an invoice',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { status: 'cancelled' },
          },
          delete: {
            type: 'delete',
            description: 'Permanently delete an invoice',
            destructive: true,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'delete',
            requiredFields: ['id'],
          },
          deactivate: undefined,
          activate: undefined,
          complete: undefined,
          archive: undefined,
          publish: undefined,
          enroll: undefined,
          pause: undefined,
          resume: undefined,
        },
      },
      transactions: {
        name: 'transactions',
        displayName: 'transaction',
        displayNamePlural: 'transactions',
        description: 'Payment transactions (money received)',
        primaryKey: 'id',
        searchableFields: ['description'],
        labelField: 'description',
        fields: [
          { name: 'id', type: 'string', description: 'Unique identifier' },
          { name: 'contact_id', type: 'string', description: 'Client contact' },
          { name: 'invoice_id', type: 'string', description: 'Related invoice' },
          { name: 'amount', type: 'number', description: 'Amount', required: true },
          { name: 'currency', type: 'string', description: 'Currency' },
          { name: 'status', type: 'string', description: 'Status', enum: ['pending', 'succeeded', 'failed', 'refunded'] },
          { name: 'description', type: 'string', description: 'Description' },
          { name: 'paid_at', type: 'date', description: 'Payment date' },
        ],
        actions: {
          list: {
            type: 'list',
            description: 'Get a list of transactions',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            optionalFields: ['status', 'contact_id'],
          },
          get: {
            type: 'get',
            description: 'Get a single transaction',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            requiredFields: ['id'],
          },
          // Transactions are typically read-only (created by payment processors)
          create: undefined,
          update: undefined,
          delete: undefined,
          deactivate: undefined,
          activate: undefined,
          complete: undefined,
          cancel: undefined,
          archive: undefined,
          publish: undefined,
          send: undefined,
          enroll: undefined,
          pause: undefined,
          resume: undefined,
        },
      },
    },
  },

  email: {
    key: 'email',
    name: 'Email Automation',
    description: 'Email sequences and automated campaigns',
    icon: 'Mail',
    color: '#8B5CF6',
    routes: {
      main: '/business-os/email-automation',
      sequences: '/business-os/email-automation',
    },
    entities: {
      sequences: {
        name: 'sequences',
        displayName: 'email sequence',
        displayNamePlural: 'email sequences',
        description: 'Automated email sequences (welcome series, follow-ups)',
        primaryKey: 'id',
        searchableFields: ['name', 'description'],
        labelField: 'name',
        fields: [
          { name: 'id', type: 'string', description: 'Unique identifier' },
          { name: 'name', type: 'string', description: 'Sequence name', required: true },
          { name: 'description', type: 'string', description: 'Description' },
          { name: 'trigger_type', type: 'string', description: 'What triggers the sequence', enum: ['manual', 'contact_created', 'booking_confirmed', 'payment_received', 'tag_added'] },
          { name: 'is_active', type: 'boolean', description: 'Whether sequence is running' },
        ],
        actions: {
          list: {
            type: 'list',
            description: 'Get a list of email sequences',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            optionalFields: ['is_active'],
          },
          get: {
            type: 'get',
            description: 'Get a single sequence',
            destructive: false,
            requiresConfirmation: false,
            operation: 'query',
            requiredFields: ['id'],
          },
          create: {
            type: 'create',
            description: 'Create a new email sequence',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'insert',
            requiredFields: ['name'],
          },
          update: {
            type: 'update',
            description: 'Update sequence details',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
          },
          deactivate: {
            type: 'deactivate',
            description: 'Pause the sequence - no new emails will be sent',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { is_active: false },
          },
          activate: {
            type: 'activate',
            description: 'Activate the sequence - emails will be sent',
            destructive: false,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'update',
            requiredFields: ['id'],
            payload: { is_active: true },
          },
          delete: {
            type: 'delete',
            description: 'Permanently delete a sequence',
            destructive: true,
            requiresConfirmation: true,
            operation: 'mutation',
            dbOperation: 'delete',
            requiredFields: ['id'],
          },
          complete: undefined,
          cancel: undefined,
          archive: undefined,
          publish: undefined,
          send: undefined,
          enroll: undefined,
          pause: undefined,
          resume: undefined,
        },
      },
    },
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get all available actions across all capabilities
 */
export function getAllActions(): { capability: string; entity: string; action: ActionDefinition }[] {
  const actions: { capability: string; entity: string; action: ActionDefinition }[] = [];

  for (const [capKey, capability] of Object.entries(CAPABILITIES_SCHEMA)) {
    for (const [entityKey, entity] of Object.entries(capability.entities)) {
      for (const [actionKey, action] of Object.entries(entity.actions)) {
        if (action) {
          actions.push({ capability: capKey, entity: entityKey, action });
        }
      }
    }
  }

  return actions;
}

/**
 * Find an entity by name across all capabilities
 */
export function findEntity(entityName: string): { capability: CapabilityDefinition; entity: EntityDefinition } | null {
  for (const capability of Object.values(CAPABILITIES_SCHEMA)) {
    if (capability.entities[entityName]) {
      return { capability, entity: capability.entities[entityName] };
    }
  }
  return null;
}

/**
 * Get action for an entity
 */
export function getAction(entityName: string, actionType: ActionType): ActionDefinition | null {
  const result = findEntity(entityName);
  if (!result) return null;
  return result.entity.actions[actionType] || null;
}

/**
 * Generate a human-readable description of available capabilities for LLM
 */
export function generateCapabilitiesDescription(): string {
  const lines: string[] = ['# Available Capabilities\n'];

  for (const capability of Object.values(CAPABILITIES_SCHEMA)) {
    lines.push(`## ${capability.name}`);
    lines.push(`${capability.description}\n`);

    for (const entity of Object.values(capability.entities)) {
      lines.push(`### ${entity.displayNamePlural}`);
      lines.push(`${entity.description}`);
      lines.push('');

      const availableActions = Object.entries(entity.actions)
        .filter(([_, action]) => action !== undefined)
        .map(([type, action]) => `- **${type}**: ${action!.description}${action!.destructive ? ' ⚠️ DESTRUCTIVE' : ''}`);

      lines.push('Actions:');
      lines.push(...availableActions);
      lines.push('');
    }
  }

  return lines.join('\n');
}

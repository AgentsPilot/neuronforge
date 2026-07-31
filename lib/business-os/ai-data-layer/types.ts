/**
 * AI Data Layer Types
 *
 * Type definitions for the autonomous AI data layer that enables
 * LLM-driven queries and mutations via OpenAI function calling.
 */

import type { ChatCompletionTool } from 'openai/resources/chat/completions';

// =============================================================================
// Entity Types
// =============================================================================

export type EntityType =
  | 'contacts'
  | 'services'
  | 'bookings'
  | 'tasks'
  | 'invoices'
  | 'availability';

export type AggregateOperation = 'count' | 'sum' | 'avg' | 'min' | 'max';

export type MutationOperation = 'create' | 'update' | 'delete';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'is_null'
  | 'is_not_null';

// =============================================================================
// Tool Call Types
// =============================================================================

export interface DataQueryParams {
  entity: EntityType;
  filters?: Record<string, unknown>;
  fields?: string[];
  orderBy?: {
    field: string;
    direction: 'asc' | 'desc';
  };
  limit?: number;
}

export interface DataAggregateParams {
  entity: EntityType;
  operation: AggregateOperation;
  field?: string;  // Required for sum, avg, min, max
  filters?: Record<string, unknown>;
  groupBy?: string;
}

export interface DataMutateParams {
  entity: EntityType;
  operation: MutationOperation;
  id?: string;  // Required for update/delete
  payload?: Record<string, unknown>;  // Required for create/update
}

export interface NavigateParams {
  destination: string;
  params?: Record<string, string>;
}

export interface OpenModalParams {
  type: 'new_contact' | 'new_service' | 'new_booking' | 'new_task' | 'new_invoice' | 'edit_contact' | 'edit_service';
  prefill?: Record<string, unknown>;
  entityId?: string;  // For edit modals
}

// =============================================================================
// Tool Results
// =============================================================================

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresConfirmation?: boolean;
  confirmationId?: string;
  preview?: string;
}

export interface QueryResult extends ToolResult {
  data?: Record<string, unknown>[];
  totalCount?: number;
}

export interface AggregateResult extends ToolResult {
  data?: number | Record<string, number>;
}

export interface MutationResult extends ToolResult {
  requiresConfirmation: true;
  confirmationId: string;
  preview: string;
  /**
   * Semantic action type - use this to generate correct confirmation messages:
   * - 'create' = creating new entity
   * - 'update' = modifying entity fields
   * - 'deactivate' = hiding/unpublishing (data preserved, reversible)
   * - 'activate' = publishing/showing (making visible)
   * - 'delete' = permanent removal (destructive, irreversible)
   *
   * IMPORTANT: When actionType is 'deactivate', use words like "deactivate", "disable", "unpublish", "hide".
   * When actionType is 'delete', use words like "delete", "remove permanently", "destroy".
   * These are semantically different - deactivate preserves data, delete destroys it.
   */
  actionType: 'create' | 'update' | 'deactivate' | 'activate' | 'delete';
  pendingAction: {
    entity: EntityType;
    operation: MutationOperation;
    payload?: Record<string, unknown>;
    id?: string;
  };
}

export interface NavigationResult extends ToolResult {
  action: {
    type: 'navigate';
    destination: string;
    params?: Record<string, string>;
  };
}

export interface ModalResult extends ToolResult {
  action: {
    type: 'open_modal';
    modalType: OpenModalParams['type'];
    prefill?: Record<string, unknown>;
    entityId?: string;
  };
}

export interface ChoicesResult extends ToolResult {
  action: {
    type: 'present_choices';
    prompt: string;
    choices: Array<{
      id: string;
      label: string;
      detail?: string;
    }>;
    entityType?: string;
    pendingAction?: string;
  };
}

export interface EntityCardResult extends ToolResult {
  action: {
    type: 'present_entity_card';
    entityType: string;
    entity: Record<string, unknown>;
    /** Available actions for this entity */
    actions: Array<{
      type: 'navigate' | 'edit' | 'call' | 'email' | 'deactivate' | 'delete';
      label: string;
      /** For navigate: the destination URL with params */
      destination?: string;
      params?: Record<string, string>;
    }>;
  };
}

export interface BookingListResult extends ToolResult {
  action: {
    type: 'present_booking_list';
    bookings: Array<{
      id: string;
      serviceName: string;
      contactName?: string;
      startTime: string;
      endTime?: string;
      status: string;
    }>;
  };
}

// =============================================================================
// Context Types
// =============================================================================

export interface UserContext {
  userId: string;
  profile: {
    businessName?: string;
    vertical?: string;
    timezone?: string;
    currency?: string;
    language?: string;
  };
  stats: {
    totalContacts: number;
    todayBookings: number;
    pendingTasks: number;
    pendingInvoices: number;
    thisWeekRevenue: number;
  };
  recentActivity: {
    lastContact?: { id: string; name: string; createdAt: string };
    lastBooking?: { id: string; serviceName: string; date: string };
    lastTask?: { id: string; title: string; status: string };
  };
  entities: {
    services: Array<{ id: string; name: string; price: number; duration_minutes: number }>;
    contacts: Array<{ id: string; name: string; email?: string }>;
  };
}

// =============================================================================
// Pending Mutation (for confirmation flow)
// =============================================================================

export interface PendingMutation {
  id: string;
  userId: string;
  entity: EntityType;
  operation: MutationOperation;
  payload?: Record<string, unknown>;
  entityId?: string;
  preview: string;
  createdAt: Date;
  expiresAt: Date;
}

// =============================================================================
// AI Data Layer Service Types
// =============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

// =============================================================================
// Active Entity Context (for context-aware follow-ups)
// =============================================================================

export interface ActiveEntity {
  type: 'tasks' | 'contacts' | 'services' | 'bookings' | 'invoices';
  id: string;
  data: Record<string, unknown>;
}

export interface AIDataLayerRequest {
  message: string;
  conversationHistory?: ChatMessage[];
  pendingConfirmationId?: string;  // If user is confirming a mutation
  activeEntity?: ActiveEntity;  // Currently displayed entity for context-aware follow-ups
}

export interface AIDataLayerResponse {
  message: string;
  actions?: Array<NavigationResult['action'] | ModalResult['action'] | ChoicesResult['action'] | EntityCardResult['action'] | BookingListResult['action']>;
  pendingConfirmation?: {
    id: string;
    /** English preview text describing the action */
    preview: string;
    /** Semantic action type - frontend should use this to display correct UI/text */
    actionType: 'create' | 'update' | 'deactivate' | 'activate' | 'delete' | 'complete' | 'cancel' | 'publish' | 'send';
    /** Entity being modified */
    entity: string;
  };
  toolCalls?: Array<{
    name: string;
    args: Record<string, unknown>;
    result: ToolResult;
  }>;
}

// =============================================================================
// Tool Definitions (OpenAI format)
// =============================================================================

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'data_query',
      description: 'Query entities from the database. Use this to find contacts, services, bookings, tasks, or invoices. Always returns data owned by the current user only.',
      parameters: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            enum: ['contacts', 'services', 'bookings', 'tasks', 'invoices', 'availability'],
            description: 'The type of entity to query'
          },
          filters: {
            type: 'object',
            description: 'Filter conditions. Keys are field names, values are the expected values. Use { "field": { "$gt": value } } for operators.',
            additionalProperties: true
          },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific fields to return. If omitted, returns all safe fields.'
          },
          orderBy: {
            type: 'object',
            properties: {
              field: { type: 'string' },
              direction: { type: 'string', enum: ['asc', 'desc'] }
            },
            description: 'Sort order for results'
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 20, max: 50)'
          }
        },
        required: ['entity']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'data_aggregate',
      description: 'Perform aggregate operations (count, sum, avg) on entities. Use for statistics like "how many contacts", "total revenue", etc.',
      parameters: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            enum: ['contacts', 'services', 'bookings', 'tasks', 'invoices'],
            description: 'The type of entity to aggregate'
          },
          operation: {
            type: 'string',
            enum: ['count', 'sum', 'avg', 'min', 'max'],
            description: 'The aggregate operation to perform'
          },
          field: {
            type: 'string',
            description: 'The field to aggregate (required for sum, avg, min, max)'
          },
          filters: {
            type: 'object',
            description: 'Filter conditions before aggregating',
            additionalProperties: true
          },
          groupBy: {
            type: 'string',
            description: 'Group results by this field (e.g., "month", "status")'
          }
        },
        required: ['entity', 'operation']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'data_mutate',
      description: 'Create, update, or delete entities. ALL mutations require user confirmation before execution. Use this to add new contacts, update services, etc.',
      parameters: {
        type: 'object',
        properties: {
          entity: {
            type: 'string',
            enum: ['contacts', 'services', 'bookings', 'tasks', 'invoices'],
            description: 'The type of entity to mutate'
          },
          operation: {
            type: 'string',
            enum: ['create', 'update', 'delete'],
            description: 'The mutation operation'
          },
          id: {
            type: 'string',
            description: 'Entity ID (required for update/delete)'
          },
          payload: {
            type: 'object',
            description: 'The data to create or update',
            additionalProperties: true
          }
        },
        required: ['entity', 'operation']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: 'Navigate the user to a specific page in the application. Use when user wants to go somewhere.',
      parameters: {
        type: 'object',
        properties: {
          destination: {
            type: 'string',
            enum: [
              '/business-os',
              '/business-os/crm',
              '/business-os/payments',
              '/business-os/email-automation',
              '/business-os/settings'
            ],
            description: 'The page to navigate to'
          },
          params: {
            type: 'object',
            description: 'Query parameters to include (e.g., { contact: "id" } for /business-os/crm)',
            additionalProperties: { type: 'string' }
          }
        },
        required: ['destination']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_modal',
      description: 'Open a modal dialog for creating or editing entities. Use when user wants to add or edit something.',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['new_contact', 'new_service', 'new_booking', 'new_task', 'new_invoice', 'edit_contact', 'edit_service'],
            description: 'The type of modal to open'
          },
          prefill: {
            type: 'object',
            description: 'Pre-fill form fields with these values',
            additionalProperties: true
          },
          entityId: {
            type: 'string',
            description: 'Entity ID for edit modals'
          }
        },
        required: ['type']
      }
    }
  }
];

// =============================================================================
// Sensitive Fields Configuration
// =============================================================================

export const SENSITIVE_FIELDS: Record<EntityType, string[]> = {
  contacts: ['password_hash', 'auth_token', 'api_key'],
  services: [],
  bookings: ['payment_token', 'card_last4'],
  tasks: [],
  invoices: ['payment_intent_id', 'stripe_invoice_id'],
  availability: []
};

export const MAX_RESULTS_PER_QUERY = 50;
export const CONFIRMATION_EXPIRY_MINUTES = 5;
export const MAX_TOOL_CALLS_PER_REQUEST = 10;

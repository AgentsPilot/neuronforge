/**
 * SafeExecutionLayer for AI Data Layer
 *
 * Executes tool calls safely:
 * - Read operations: execute immediately via repositories
 * - Write operations: create PendingMutation, wait for confirmation
 * - ALWAYS enforces user_id filtering
 * - Sanitizes results before returning to LLM
 */

import { createLogger } from '@/lib/logger';
import { z } from 'zod';
import { crmContactRepository, type CRMContactListOptions } from '@/lib/repositories/CRMContactRepository';
import { crmTaskRepository } from '@/lib/repositories/CRMTaskRepository';
import {
  schedulingServiceRepository,
  schedulingBookingRepository
} from '@/lib/repositories/SchedulingRepository';
import { paymentInvoiceRepository, paymentTransactionRepository } from '@/lib/repositories/PaymentRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import type {
  EntityType,
  ToolResult,
  QueryResult,
  MutationResult,
  NavigationResult,
  PendingMutation
} from './types';
import { getAction, type ActionType } from './capabilities-schema';

const logger = createLogger({ service: 'SafeExecutionLayer' });

// In-memory store for pending mutations (in production, use Redis or database)
const pendingMutations = new Map<string, PendingMutation>();

// Validation schemas for tool parameters
const dataQuerySchema = z.object({
  entity: z.enum(['contacts', 'services', 'bookings', 'tasks', 'invoices', 'availability']),
  filters: z.record(z.unknown()).optional(),
  fields: z.array(z.string()).optional(),
  orderBy: z.object({
    field: z.string(),
    direction: z.enum(['asc', 'desc'])
  }).optional(),
  limit: z.number().min(1).max(50).optional()
});

const dataAggregateSchema = z.object({
  entity: z.enum(['contacts', 'services', 'bookings', 'tasks', 'invoices']),
  operation: z.enum(['count', 'sum', 'avg', 'min', 'max']),
  field: z.string().optional(),
  filters: z.record(z.unknown()).optional(),
  groupBy: z.string().optional()
});

const dataMutateSchema = z.object({
  entity: z.enum(['contacts', 'services', 'bookings', 'tasks', 'invoices']),
  operation: z.enum(['create', 'update', 'delete']),
  id: z.string().optional(),
  payload: z.record(z.unknown()).optional()
});

const navigateSchema = z.object({
  destination: z.string(),
  params: z.record(z.string()).optional()
});

const openModalSchema = z.object({
  type: z.enum(['new_contact', 'new_service', 'new_booking', 'new_task', 'new_invoice', 'edit_contact', 'edit_service']),
  prefill: z.record(z.unknown()).optional(),
  entityId: z.string().optional()
});

// Sensitive fields to remove from results
const SENSITIVE_FIELDS_MAP: Record<EntityType, string[]> = {
  contacts: ['password_hash', 'auth_token', 'api_key'],
  services: [],
  bookings: ['payment_token', 'card_last4', 'stripe_payment_intent_id'],
  tasks: [],
  invoices: ['stripe_invoice_id', 'processor_payment_id'],
  availability: []
};

export class SafeExecutionLayer {
  private userId: string;

  constructor(userId: string) {
    this.userId = userId;
  }

  /**
   * Execute a tool call safely
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    logger.info({ userId: this.userId, toolName, args }, 'Executing tool call');

    try {
      switch (toolName) {
        case 'execute_action':
          return this.executeAction(args);
        case 'present_choices':
          return this.executePresentChoices(args);
        case 'present_entity_card':
          return this.executePresentEntityCard(args);
        case 'navigate':
          return this.executeNavigate(args);
        // Legacy tools for backward compatibility
        case 'data_query':
          return this.executeQuery(args);
        case 'data_aggregate':
          return this.executeAggregate(args);
        case 'data_mutate':
          return this.executeMutate(args);
        case 'open_modal':
          return this.executeOpenModal(args);
        default:
          return { success: false, error: `Unknown tool: ${toolName}` };
      }
    } catch (error) {
      logger.error({ err: error, userId: this.userId, toolName }, 'Tool execution failed');
      return { success: false, error: 'Tool execution failed' };
    }
  }

  /**
   * Execute a capability-based action
   */
  private async executeAction(args: Record<string, unknown>): Promise<ToolResult> {
    const entity = args.entity as EntityType;
    const action = args.action as ActionType;
    const id = args.id as string | undefined;
    const filters = args.filters as Record<string, unknown> | undefined;
    const data = args.data as Record<string, unknown> | undefined;
    const limit = args.limit as number | undefined;

    // Validate the action exists for this entity
    const actionDef = getAction(entity, action);
    if (!actionDef) {
      return { success: false, error: `Action "${action}" is not available for entity "${entity}"` };
    }

    // Route to appropriate handler based on action type
    if (actionDef.operation === 'query') {
      // List or Get
      if (action === 'list') {
        return this.executeQuery({ entity, filters, limit });
      } else if (action === 'get' && id) {
        return this.executeGetById(entity, id);
      }
      return { success: false, error: 'Invalid query action' };
    }

    // Mutation actions
    if (actionDef.operation === 'mutation') {
      // Check required fields
      if (actionDef.requiredFields?.includes('id') && !id) {
        // Return helpful error that guides LLM to list first
        return {
          success: false,
          error: `ID is required for ${action} action. You must first use the "list" action to get available ${entity} with their IDs, then use the correct ID.`,
          requiresList: true // Signal to the system that a list is needed
        } as ToolResult;
      }

      // Validate ID is a valid UUID (not a made-up ID like "svc-4")
      if (id && !this.isValidUUID(id)) {
        logger.warn(
          { userId: this.userId, entity, action, invalidId: id },
          'Invalid ID format - not a UUID. LLM may have generated a fake ID.'
        );
        // Return error that tells LLM to list entities first to get real IDs
        return {
          success: false,
          error: `Invalid ID format: "${id}" is not a valid UUID. You MUST first call the "list" action for "${entity}" to get the actual entity IDs from the database. Never generate or guess IDs.`,
          requiresList: true
        } as ToolResult;
      }

      // Build the mutation payload
      let payload = data || {};

      // Apply predefined payload from action definition (e.g., deactivate sets is_active: false)
      if (actionDef.payload) {
        payload = { ...payload, ...actionDef.payload };
      }

      // Map action to database operation
      const dbOperation = actionDef.dbOperation || 'update';

      return this.executeMutate({
        entity,
        operation: dbOperation,
        id,
        payload
      }, action); // Pass the semantic action type
    }

    return { success: false, error: `Unsupported action: ${action}` };
  }

  /**
   * Check if a string is a valid UUID
   */
  private isValidUUID(str: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(str);
  }

  /**
   * Get a single entity by ID
   */
  private async executeGetById(entity: EntityType, id: string): Promise<QueryResult> {
    let result: { data: unknown | null; error: Error | null };

    switch (entity) {
      case 'contacts':
        result = await crmContactRepository.findById(id, this.userId);
        break;
      case 'services':
        result = await schedulingServiceRepository.findById(id, this.userId);
        break;
      case 'bookings':
        result = await schedulingBookingRepository.findById(id, this.userId);
        break;
      case 'tasks':
        result = await crmTaskRepository.findById(id, this.userId);
        break;
      case 'invoices':
        result = await paymentInvoiceRepository.findById(id, this.userId);
        break;
      default:
        return { success: false, error: `Cannot get entity: ${entity}` };
    }

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    if (!result.data) {
      return { success: false, error: `${entity} not found` };
    }

    return {
      success: true,
      data: [this.sanitizeRecord(entity, result.data as Record<string, unknown>)],
      totalCount: 1
    };
  }

  /**
   * Sanitize a single record
   */
  private sanitizeRecord(entity: EntityType, record: Record<string, unknown>): Record<string, unknown> {
    const sensitiveFields = SENSITIVE_FIELDS_MAP[entity] || [];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      if (!sensitiveFields.includes(key)) {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Execute present_choices tool - returns choices for frontend to render as buttons
   */
  private executePresentChoices(args: Record<string, unknown>): ToolResult & { choices: unknown } {
    const prompt = args.prompt as string;
    const choices = args.choices as Array<{ id: string; label: string; detail?: string }>;
    const entityType = args.entityType as string | undefined;
    const pendingAction = args.pendingAction as string | undefined;

    logger.info(
      { userId: this.userId, choiceCount: choices?.length, entityType, pendingAction },
      'Presenting choices to user'
    );

    return {
      success: true,
      // Return structured data for frontend rendering
      action: {
        type: 'present_choices',
        prompt,
        choices: choices || [],
        entityType,
        pendingAction
      },
      choices: choices || []
    };
  }

  /**
   * Execute present_entity_card tool - returns entity data with action buttons for frontend rendering
   */
  private executePresentEntityCard(args: Record<string, unknown>): ToolResult {
    const entityType = args.entityType as string;
    const entityId = args.entityId as string;
    const entity = args.entity as Record<string, unknown>;

    logger.info(
      { userId: this.userId, entityType, entityId },
      'Presenting entity card to user'
    );

    // Build available actions based on entity type
    const actions: Array<{
      type: 'navigate' | 'edit' | 'call' | 'email' | 'deactivate' | 'delete';
      label: string;
      labelHe?: string;
      destination?: string;
      params?: Record<string, string>;
    }> = [];

    switch (entityType) {
      case 'contacts':
        // Add "Open in CRM" action
        actions.push({
          type: 'navigate',
          label: 'Open in CRM',
          labelHe: 'פתח ב-CRM',
          destination: '/business-os/crm',
          params: { contact: entityId }
        });

        // Add call action if phone exists
        if (entity.phone) {
          actions.push({
            type: 'call',
            label: `Call ${entity.phone}`,
            labelHe: `התקשר ${entity.phone}`
          });
        }

        // Add email action if email exists
        if (entity.email) {
          actions.push({
            type: 'email',
            label: `Email`,
            labelHe: 'שלח אימייל'
          });
        }

        // Add edit action
        actions.push({
          type: 'edit',
          label: 'Edit Contact',
          labelHe: 'ערוך איש קשר'
        });
        break;

      case 'services':
        actions.push({
          type: 'navigate',
          label: 'Open in Scheduling',
          labelHe: 'פתח בתזמון',
          destination: '/business-os/scheduling',
          params: { service: entityId }
        });
        actions.push({
          type: 'edit',
          label: 'Edit Service',
          labelHe: 'ערוך שירות'
        });
        break;

      case 'tasks':
        // Only show "Open in CRM" if task is linked to a contact
        if (entity.contact_id) {
          actions.push({
            type: 'navigate',
            label: 'Open in CRM',
            labelHe: 'פתח ב-CRM',
            destination: '/business-os/crm',
            params: { task: entityId }
          });
        }
        // Add complete action if task is pending
        if (entity.status === 'pending' || entity.status === 'in_progress') {
          actions.push({
            type: 'complete' as any,
            label: 'Mark Complete',
            labelHe: 'סמן כהושלם'
          });
        }
        actions.push({
          type: 'edit',
          label: 'Edit Task',
          labelHe: 'ערוך משימה'
        });
        break;

      case 'bookings':
        actions.push({
          type: 'navigate',
          label: 'Open in Scheduling',
          labelHe: 'פתח בתזמון',
          destination: '/business-os/scheduling',
          params: { booking: entityId }
        });
        break;

      case 'invoices':
        actions.push({
          type: 'navigate',
          label: 'Open in Payments',
          labelHe: 'פתח בתשלומים',
          destination: '/business-os/payments',
          params: { invoice: entityId }
        });
        break;
    }

    return {
      success: true,
      action: {
        type: 'present_entity_card',
        entityType,
        entity: this.sanitizeRecord(entityType as any, entity),
        actions
      }
    };
  }

  /**
   * Confirm and execute a pending mutation
   */
  async confirmMutation(confirmationId: string): Promise<ToolResult> {
    const pending = pendingMutations.get(confirmationId);

    if (!pending) {
      return { success: false, error: 'Confirmation expired or not found' };
    }

    if (pending.userId !== this.userId) {
      return { success: false, error: 'Unauthorized' };
    }

    if (new Date() > pending.expiresAt) {
      pendingMutations.delete(confirmationId);
      return { success: false, error: 'Confirmation expired' };
    }

    // Execute the actual mutation
    const result = await this.executeActualMutation(pending);

    // Clean up
    pendingMutations.delete(confirmationId);

    return result;
  }

  /**
   * Cancel a pending mutation
   */
  cancelMutation(confirmationId: string): boolean {
    const pending = pendingMutations.get(confirmationId);
    if (pending && pending.userId === this.userId) {
      pendingMutations.delete(confirmationId);
      return true;
    }
    return false;
  }

  // ==========================================================================
  // Query Execution
  // ==========================================================================

  private async executeQuery(args: Record<string, unknown>): Promise<QueryResult> {
    const parsed = dataQuerySchema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `Invalid query parameters: ${parsed.error.message}` };
    }

    const { entity, filters, fields, orderBy, limit } = parsed.data;
    const maxLimit = Math.min(limit || 20, 50);

    let result: { data: unknown[] | null; error: Error | null };

    switch (entity) {
      case 'contacts':
        result = await this.queryContacts(filters, orderBy, maxLimit);
        break;
      case 'services':
        result = await this.queryServices(filters, maxLimit);
        break;
      case 'bookings':
        result = await this.queryBookings(filters, orderBy, maxLimit);
        break;
      case 'tasks':
        result = await this.queryTasks(filters, orderBy, maxLimit);
        break;
      case 'invoices':
        result = await this.queryInvoices(filters, maxLimit);
        break;
      case 'availability':
        result = await this.queryAvailability();
        break;
      default:
        return { success: false, error: `Unknown entity: ${entity}` };
    }

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    // Sanitize results
    const sanitizedData = this.sanitizeResults(entity, result.data || [], fields);

    return {
      success: true,
      data: sanitizedData,
      totalCount: sanitizedData.length
    };
  }

  private async queryContacts(
    filters: Record<string, unknown> | undefined,
    orderBy: { field: string; direction: 'asc' | 'desc' } | undefined,
    limit: number
  ) {
    const orderField = orderBy?.field as 'created_at' | 'updated_at' | 'first_name' | 'last_name' | undefined;
    const options: CRMContactListOptions = {
      limit,
      orderBy: orderField || 'created_at',
      orderDirection: orderBy?.direction || 'desc'
    };

    if (filters) {
      if (filters.stage) options.stage = String(filters.stage);
      if (filters.search) options.search = String(filters.search);
      if (filters.tags && Array.isArray(filters.tags)) options.tags = filters.tags as string[];
    }

    return crmContactRepository.list(this.userId, options);
  }

  private async queryServices(
    filters: Record<string, unknown> | undefined,
    limit: number
  ) {
    const activeOnly = filters?.is_active !== false;
    const result = await schedulingServiceRepository.listAll(this.userId, activeOnly);

    // Apply search filter if provided (client-side filtering)
    if (result.data && filters?.search) {
      const searchTerm = String(filters.search).toLowerCase();
      result.data = result.data.filter(service =>
        (service.service_name || '').toLowerCase().includes(searchTerm) ||
        (service.description || '').toLowerCase().includes(searchTerm)
      );
    }

    return result;
  }

  private async queryBookings(
    filters: Record<string, unknown> | undefined,
    orderBy: { field: string; direction: 'asc' | 'desc' } | undefined,
    limit: number
  ) {
    const options: {
      serviceId?: string;
      contactId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      limit: number;
    } = { limit };

    if (filters) {
      if (filters.service_id) options.serviceId = String(filters.service_id);
      if (filters.contact_id) options.contactId = String(filters.contact_id);
      if (filters.status) options.status = String(filters.status);
      if (filters.start_date) options.startDate = String(filters.start_date);
      if (filters.end_date) options.endDate = String(filters.end_date);
    }

    return schedulingBookingRepository.list(this.userId, options);
  }

  private async queryTasks(
    filters: Record<string, unknown> | undefined,
    orderBy: { field: string; direction: 'asc' | 'desc' } | undefined,
    limit: number
  ) {
    const options: {
      contact_id?: string;
      status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      include_completed?: boolean;
      limit: number;
    } = { limit };

    if (filters) {
      if (filters.contact_id) options.contact_id = String(filters.contact_id);
      if (filters.status) options.status = filters.status as any;
      if (filters.priority) options.priority = filters.priority as any;
      if (filters.include_completed) options.include_completed = true;
    }

    return crmTaskRepository.list(this.userId, options);
  }

  private async queryInvoices(
    filters: Record<string, unknown> | undefined,
    limit: number
  ) {
    const options: {
      status?: string;
      contactId?: string;
      limit: number;
    } = { limit };

    if (filters) {
      if (filters.status) options.status = String(filters.status);
      if (filters.contact_id) options.contactId = String(filters.contact_id);
    }

    return paymentInvoiceRepository.list(this.userId, options);
  }

  private async queryAvailability() {
    const result = await businessProfileRepository.findByUserId(this.userId);
    if (result.error) {
      return { data: null, error: result.error };
    }

    // Extract availability from profile
    const profile = result.data;
    const availability = (profile as any)?.scheduling_availability || [];

    return { data: availability, error: null };
  }

  // ==========================================================================
  // Aggregate Execution
  // ==========================================================================

  private async executeAggregate(args: Record<string, unknown>): Promise<AggregateResult> {
    const parsed = dataAggregateSchema.safeParse(args);
    if (!parsed.success) {
      return { success: false, error: `Invalid aggregate parameters: ${parsed.error.message}` };
    }

    const { entity, operation, field, filters, groupBy } = parsed.data;

    // For now, support basic count operations
    if (operation === 'count') {
      return this.executeCount(entity, filters);
    }

    // TODO: Implement sum, avg, min, max with groupBy support
    return { success: false, error: `Operation ${operation} not yet implemented` };
  }

  private async executeCount(
    entity: EntityType,
    filters: Record<string, unknown> | undefined
  ): Promise<AggregateResult> {
    let count = 0;

    switch (entity) {
      case 'contacts': {
        const result = await crmContactRepository.count(this.userId, {
          stage: filters?.stage as string,
          search: filters?.search as string
        });
        count = result.data || 0;
        break;
      }
      case 'services': {
        const result = await schedulingServiceRepository.listAll(this.userId, true);
        count = result.data?.length || 0;
        break;
      }
      case 'bookings': {
        const result = await schedulingBookingRepository.list(this.userId, {
          status: filters?.status as string
        });
        count = result.data?.length || 0;
        break;
      }
      case 'tasks': {
        const result = await crmTaskRepository.countByStatus(this.userId);
        if (filters?.status) {
          const statusKey = filters.status as 'pending' | 'in_progress' | 'completed' | 'cancelled';
          count = result.data?.[statusKey] || 0;
        } else {
          const counts = result.data || { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
          count = counts.pending + counts.in_progress + counts.completed + counts.cancelled;
        }
        break;
      }
      case 'invoices': {
        const result = await paymentInvoiceRepository.list(this.userId, {
          status: filters?.status as string
        });
        count = result.data?.length || 0;
        break;
      }
      default:
        return { success: false, error: `Cannot count entity: ${entity}` };
    }

    return { success: true, data: count };
  }

  // ==========================================================================
  // Mutation Execution (with confirmation)
  // ==========================================================================

  /**
   * Execute a mutation with confirmation
   * @param args - mutation arguments
   * @param semanticAction - the semantic action type (e.g., 'deactivate' instead of 'update')
   */
  private async executeMutate(
    args: Record<string, unknown>,
    semanticAction?: ActionType
  ): Promise<MutationResult> {
    const parsed = dataMutateSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid mutation parameters: ${parsed.error.message}`,
        requiresConfirmation: true,
        confirmationId: '',
        preview: '',
        actionType: semanticAction || 'create',
        pendingAction: { entity: 'contacts', operation: 'create' }
      };
    }

    const { entity, operation, id, payload } = parsed.data;

    // Validate required fields for operations
    if ((operation === 'update' || operation === 'delete') && !id) {
      return {
        success: false,
        error: `ID is required for ${operation} operation`,
        requiresConfirmation: true,
        confirmationId: '',
        preview: '',
        actionType: semanticAction || (operation as 'update' | 'delete'),
        pendingAction: { entity, operation }
      };
    }

    if ((operation === 'create' || operation === 'update') && !payload) {
      return {
        success: false,
        error: `Payload is required for ${operation} operation`,
        requiresConfirmation: true,
        confirmationId: '',
        preview: '',
        actionType: semanticAction || (operation as 'create' | 'update'),
        pendingAction: { entity, operation }
      };
    }

    // Determine the semantic action type
    // Priority: explicit semanticAction > inferred from payload > default to operation
    let actionType: ActionType = semanticAction || (operation as ActionType);

    // If no explicit semantic action, try to infer from payload
    if (!semanticAction) {
      if (operation === 'update' && payload?.is_active === false) {
        actionType = 'deactivate';
      } else if (operation === 'update' && payload?.is_active === true) {
        actionType = 'activate';
      } else if (operation === 'update' && payload?.status === 'completed') {
        actionType = 'complete';
      } else if (operation === 'update' && payload?.status === 'cancelled') {
        actionType = 'cancel';
      }
    }

    // Create pending mutation
    const confirmationId = crypto.randomUUID();
    const preview = this.generatePreview(entity, operation, payload, id, actionType);

    const pendingMutation: PendingMutation = {
      id: confirmationId,
      userId: this.userId,
      entity,
      operation,
      payload,
      entityId: id,
      preview,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes
    };

    pendingMutations.set(confirmationId, pendingMutation);

    logger.info(
      { userId: this.userId, confirmationId, entity, operation, actionType },
      'Created pending mutation awaiting confirmation'
    );

    return {
      success: true,
      requiresConfirmation: true,
      confirmationId,
      preview,
      // actionType is the semantic meaning - this is what the LLM should use
      // to generate the correct terminology in the confirmation message
      actionType,
      pendingAction: {
        entity,
        operation,
        payload,
        id
      }
    };
  }

  private generatePreview(
    entity: EntityType,
    operation: string,
    payload: Record<string, unknown> | undefined,
    id: string | undefined,
    actionType?: ActionType
  ): string {
    const entityLabels: Record<EntityType, string> = {
      contacts: 'contact',
      services: 'service',
      bookings: 'booking',
      tasks: 'task',
      invoices: 'invoice',
      availability: 'availability'
    };

    const label = entityLabels[entity] || entity;

    // Use semantic action type for preview when available
    const effectiveAction = actionType || operation;

    switch (effectiveAction) {
      case 'create':
        if (entity === 'contacts') {
          const name = `${payload?.first_name || ''} ${payload?.last_name || ''}`.trim();
          return `Create new ${label}: ${name || payload?.email || 'unnamed'}`;
        }
        if (entity === 'services') {
          return `Create new ${label}: ${payload?.service_name || payload?.name} (${payload?.price || 0})`;
        }
        if (entity === 'tasks') {
          return `Create new ${label}: ${payload?.title}`;
        }
        return `Create new ${label}`;

      case 'deactivate':
        return `DEACTIVATE ${label} (will be hidden but NOT deleted - can be reactivated later)`;

      case 'activate':
        return `ACTIVATE ${label} (will be visible to clients)`;

      case 'complete':
        return `Mark ${label} as COMPLETED`;

      case 'cancel':
        return `CANCEL ${label}`;

      case 'publish':
        return `PUBLISH ${label} (will be live and visible)`;

      case 'send':
        return `SEND ${label} to client`;

      case 'update':
        if (entity === 'services' && payload?.price !== undefined) {
          return `Update ${label} price to ${payload.price}`;
        }
        if (entity === 'services' && payload?.service_name !== undefined) {
          return `Rename ${label} to "${payload.service_name}"`;
        }
        return `Update ${label}`;

      case 'delete':
        return `PERMANENTLY DELETE ${label} (this CANNOT be undone!)`;

      default:
        return `${effectiveAction} ${label}`;
    }
  }

  private async executeActualMutation(pending: PendingMutation): Promise<ToolResult> {
    const { entity, operation, payload, entityId } = pending;

    logger.info(
      { userId: this.userId, entity, operation, entityId },
      'Executing confirmed mutation'
    );

    try {
      switch (entity) {
        case 'contacts':
          return this.mutateContact(operation, payload, entityId);
        case 'services':
          return this.mutateService(operation, payload, entityId);
        case 'bookings':
          return this.mutateBooking(operation, payload, entityId);
        case 'tasks':
          return this.mutateTask(operation, payload, entityId);
        case 'invoices':
          return this.mutateInvoice(operation, payload, entityId);
        default:
          return { success: false, error: `Cannot mutate entity: ${entity}` };
      }
    } catch (error) {
      logger.error({ err: error, entity, operation }, 'Mutation execution failed');
      return { success: false, error: 'Mutation failed' };
    }
  }

  private async mutateContact(
    operation: string,
    payload: Record<string, unknown> | undefined,
    id: string | undefined
  ): Promise<ToolResult> {
    switch (operation) {
      case 'create': {
        const result = await crmContactRepository.create({
          user_id: this.userId,
          first_name: payload?.first_name as string,
          last_name: payload?.last_name as string,
          email: payload?.email as string,
          phone: payload?.phone as string,
          stage: (payload?.stage as string) || 'lead',
          tags: (payload?.tags as string[]) || [],
          source: 'chat'
        });
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true, data: result.data };
      }
      case 'update': {
        if (!id) return { success: false, error: 'ID required for update' };
        const result = await crmContactRepository.update(id, this.userId, {
          first_name: payload?.first_name as string,
          last_name: payload?.last_name as string,
          email: payload?.email as string,
          phone: payload?.phone as string,
          stage: payload?.stage as string,
          tags: payload?.tags as string[]
        });
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true, data: result.data };
      }
      case 'delete': {
        if (!id) return { success: false, error: 'ID required for delete' };
        const result = await crmContactRepository.delete(id, this.userId);
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true };
      }
      default:
        return { success: false, error: `Unknown operation: ${operation}` };
    }
  }

  private async mutateService(
    operation: string,
    payload: Record<string, unknown> | undefined,
    id: string | undefined
  ): Promise<ToolResult> {
    switch (operation) {
      case 'create': {
        const result = await schedulingServiceRepository.create({
          user_id: this.userId,
          service_name: (payload?.service_name || payload?.name) as string,
          description: payload?.description as string,
          duration_minutes: (payload?.duration_minutes || payload?.duration || 60) as number,
          price: payload?.price as number,
          is_active: true,
          status: 'active',
          source: 'manual'
        });
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true, data: result.data };
      }
      case 'update': {
        if (!id) return { success: false, error: 'ID required for update' };
        const result = await schedulingServiceRepository.update(id, this.userId, {
          service_name: payload?.service_name as string,
          description: payload?.description as string,
          duration_minutes: payload?.duration_minutes as number,
          price: payload?.price as number,
          is_active: payload?.is_active as boolean
        });
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true, data: result.data };
      }
      case 'delete': {
        if (!id) return { success: false, error: 'ID required for delete' };
        const result = await schedulingServiceRepository.delete(id, this.userId);
        if (result.error) return { success: false, error: result.error.message };
        if (!result.data?.deleted) {
          return { success: false, error: `Cannot delete service with ${result.data?.bookingCount} existing bookings` };
        }
        return { success: true };
      }
      default:
        return { success: false, error: `Unknown operation: ${operation}` };
    }
  }

  private async mutateBooking(
    operation: string,
    payload: Record<string, unknown> | undefined,
    id: string | undefined
  ): Promise<ToolResult> {
    switch (operation) {
      case 'create': {
        const result = await schedulingBookingRepository.create({
          user_id: this.userId,
          service_id: payload?.service_id as string,
          contact_id: payload?.contact_id as string,
          client_first_name: payload?.client_first_name as string,
          client_last_name: payload?.client_last_name as string,
          client_email: payload?.client_email as string,
          client_phone: payload?.client_phone as string,
          start_time: payload?.start_time as string,
          end_time: payload?.end_time as string,
          notes: payload?.notes as string
        });
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true, data: result.data };
      }
      case 'update': {
        if (!id) return { success: false, error: 'ID required for update' };
        const result = await schedulingBookingRepository.update(id, this.userId, {
          status: payload?.status as 'confirmed' | 'cancelled' | 'completed' | 'no_show',
          internal_notes: payload?.internal_notes as string
        });
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true, data: result.data };
      }
      case 'delete': {
        if (!id) return { success: false, error: 'ID required for delete' };
        const result = await schedulingBookingRepository.delete(id, this.userId);
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true };
      }
      default:
        return { success: false, error: `Unknown operation: ${operation}` };
    }
  }

  private async mutateTask(
    operation: string,
    payload: Record<string, unknown> | undefined,
    id: string | undefined
  ): Promise<ToolResult> {
    switch (operation) {
      case 'create': {
        const result = await crmTaskRepository.create({
          user_id: this.userId,
          contact_id: payload?.contact_id as string,
          title: payload?.title as string,
          description: payload?.description as string,
          priority: (payload?.priority || 'medium') as 'low' | 'medium' | 'high' | 'urgent',
          due_date: payload?.due_date as string,
          tags: (payload?.tags as string[]) || []
        });
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true, data: result.data };
      }
      case 'update': {
        if (!id) return { success: false, error: 'ID required for update' };
        const result = await crmTaskRepository.update(id, this.userId, {
          title: payload?.title as string,
          description: payload?.description as string,
          priority: payload?.priority as 'low' | 'medium' | 'high' | 'urgent',
          status: payload?.status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
          due_date: payload?.due_date as string
        });
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true, data: result.data };
      }
      case 'delete': {
        if (!id) return { success: false, error: 'ID required for delete' };
        const result = await crmTaskRepository.delete(id, this.userId);
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true };
      }
      default:
        return { success: false, error: `Unknown operation: ${operation}` };
    }
  }

  private async mutateInvoice(
    operation: string,
    payload: Record<string, unknown> | undefined,
    id: string | undefined
  ): Promise<ToolResult> {
    switch (operation) {
      case 'update': {
        if (!id) return { success: false, error: 'ID required for update' };
        const result = await paymentInvoiceRepository.update(id, this.userId, {
          status: payload?.status as 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled',
          notes: payload?.notes as string
        });
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true, data: result.data };
      }
      case 'delete': {
        if (!id) return { success: false, error: 'ID required for delete' };
        const result = await paymentInvoiceRepository.delete(id, this.userId);
        return result.error
          ? { success: false, error: result.error.message }
          : { success: true };
      }
      default:
        return { success: false, error: `Invoice ${operation} not supported via chat` };
    }
  }

  // ==========================================================================
  // Navigation & Modal Execution
  // ==========================================================================

  private async executeNavigate(args: Record<string, unknown>): Promise<NavigationResult> {
    const parsed = navigateSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid navigation parameters: ${parsed.error.message}`,
        action: { type: 'navigate', destination: '' }
      };
    }

    const { destination, params } = parsed.data;

    return {
      success: true,
      action: {
        type: 'navigate',
        destination,
        params
      }
    };
  }

  private async executeOpenModal(args: Record<string, unknown>): Promise<ModalResult> {
    const parsed = openModalSchema.safeParse(args);
    if (!parsed.success) {
      return {
        success: false,
        error: `Invalid modal parameters: ${parsed.error.message}`,
        action: { type: 'open_modal', modalType: 'new_contact' }
      };
    }

    const { type, prefill, entityId } = parsed.data;

    return {
      success: true,
      action: {
        type: 'open_modal',
        modalType: type,
        prefill,
        entityId
      }
    };
  }

  // ==========================================================================
  // Result Sanitization
  // ==========================================================================

  private sanitizeResults(
    entity: EntityType,
    data: unknown[],
    fields?: string[]
  ): Record<string, unknown>[] {
    const sensitiveFields = SENSITIVE_FIELDS_MAP[entity] || [];

    return data.map(item => {
      const record = item as Record<string, unknown>;
      const sanitized: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(record)) {
        // Skip sensitive fields
        if (sensitiveFields.includes(key)) continue;

        // If specific fields requested, only include those
        if (fields && fields.length > 0 && !fields.includes(key)) continue;

        sanitized[key] = value;
      }

      return sanitized;
    });
  }
}

// Factory function
export function createExecutionLayer(userId: string): SafeExecutionLayer {
  return new SafeExecutionLayer(userId);
}

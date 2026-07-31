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
  AggregateResult,
  MutationResult,
  NavigationResult,
  PendingMutation,
  BookingListResult
} from './types';
import { getAction, type ActionType } from './capabilities-schema';
import { resolveAllSemanticFilters } from './semantic-schema';

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
        case 'update_entity_field':
          return this.executeUpdateEntityField(args);
        case 'present_choices':
          return this.executePresentChoices(args);
        case 'present_entity_card':
          return this.executePresentEntityCard(args);
        case 'present_booking_list':
          return this.executePresentBookingList(args);
        case 'reschedule_booking':
          return this.executeRescheduleBooking(args);
        case 'update_availability':
          return this.executeUpdateAvailability(args);
        case 'get_revenue_stats':
          return this.executeGetRevenueStats(args);
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
      // List, Get, or Count
      if (action === 'list') {
        return this.executeQuery({ entity, filters, limit });
      } else if (action === 'get' && id) {
        return this.executeGetById(entity, id);
      } else if (action === 'count') {
        return this.executeCount(entity, filters);
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
   * Update a single field on an entity - for quick inline edits
   * Safe fields are updated immediately without confirmation
   */
  private async executeUpdateEntityField(args: Record<string, unknown>): Promise<ToolResult> {
    const entityType = args.entityType as EntityType;
    const entityId = args.entityId as string;
    const field = args.field as string;
    let value = args.value;

    // Validate required args
    if (!entityType || !entityId || !field || value === undefined) {
      return { success: false, error: 'Missing required parameters: entityType, entityId, field, value' };
    }

    // Validate UUID
    if (!this.isValidUUID(entityId)) {
      return { success: false, error: 'Invalid entity ID format' };
    }

    // Define safe fields that can be updated without confirmation
    const safeFields: Record<EntityType, string[]> = {
      tasks: ['title', 'description', 'due_date', 'priority', 'status'],
      contacts: ['first_name', 'last_name', 'email', 'phone', 'notes'],
      services: ['service_name', 'description', 'duration_minutes', 'price'],
      bookings: ['notes', 'status'],
      invoices: ['notes', 'due_date'],
      availability: []
    };

    const entitySafeFields = safeFields[entityType] || [];
    if (!entitySafeFields.includes(field)) {
      return {
        success: false,
        error: `Field "${field}" cannot be updated directly. Allowed fields for ${entityType}: ${entitySafeFields.join(', ')}`
      };
    }

    // Parse date values if the field is a date field
    if (field.includes('date') && typeof value === 'string') {
      // Handle relative dates
      const today = new Date();
      const lowerValue = value.toLowerCase();

      if (lowerValue === 'tomorrow' || lowerValue === 'מחר') {
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        value = tomorrow.toISOString().split('T')[0];
      } else if (lowerValue.includes('next week') || lowerValue.includes('בעוד שבוע')) {
        const nextWeek = new Date(today);
        nextWeek.setDate(nextWeek.getDate() + 7);
        value = nextWeek.toISOString().split('T')[0];
      }
      // Otherwise assume it's already in ISO format or let DB handle it
    }

    // Execute the update
    logger.info(
      { userId: this.userId, entityType, entityId, field, value },
      'Executing direct field update'
    );

    try {
      let result: { data: unknown | null; error: Error | null };

      switch (entityType) {
        case 'tasks':
          result = await crmTaskRepository.update(entityId, this.userId, { [field]: value });
          break;
        case 'contacts':
          result = await crmContactRepository.update(entityId, this.userId, { [field]: value });
          break;
        case 'services':
          result = await schedulingServiceRepository.update(entityId, this.userId, { [field]: value });
          break;
        case 'bookings':
          result = await schedulingBookingRepository.update(entityId, this.userId, { [field]: value });
          break;
        case 'invoices':
          result = await paymentInvoiceRepository.update(entityId, this.userId, { [field]: value });
          break;
        default:
          return { success: false, error: `Cannot update entity type: ${entityType}` };
      }

      if (result.error) {
        logger.error(
          { err: result.error, userId: this.userId, entityType, entityId, field },
          'Field update failed'
        );
        return { success: false, error: result.error.message };
      }

      logger.info(
        { userId: this.userId, entityType, entityId, field, value },
        'Field update successful'
      );

      return {
        success: true,
        data: {
          entityType,
          entityId,
          field,
          newValue: value,
          updatedEntity: result.data
        }
      };
    } catch (error) {
      logger.error(
        { err: error, userId: this.userId, entityType, entityId, field },
        'Field update threw exception'
      );
      return { success: false, error: 'Failed to update field' };
    }
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
          label: 'Open in Dashboard',
          labelHe: 'פתח בלוח הבקרה',
          destination: '/business-os',
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
          label: 'Open in Dashboard',
          labelHe: 'פתח בלוח הבקרה',
          destination: '/business-os',
          params: { booking: entityId }
        });
        break;

      case 'invoices':
        actions.push({
          type: 'navigate',
          label: 'Open in Reports',
          labelHe: 'פתח בדוחות',
          destination: '/business-os/reports',
          params: { tab: 'invoices', invoice: entityId }
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
   * Execute present_booking_list tool - returns booking data for beautiful card display
   */
  private executePresentBookingList(args: Record<string, unknown>): BookingListResult {
    const bookings = args.bookings as Array<{
      id: string;
      start_time: string;
      end_time?: string;
      status: string;
      service_name?: string;
      client_first_name?: string;
      client_last_name?: string;
      client_email?: string;
      client_phone?: string;
      service?: { service_name?: string };
      contact?: { first_name?: string; last_name?: string };
    }>;

    logger.info(
      { userId: this.userId, bookingCount: bookings?.length },
      'Presenting booking list to user'
    );

    // Transform bookings to the required format
    const formattedBookings = (bookings || []).map(booking => {
      // Get service name from nested object or direct field
      const serviceName = booking.service_name ||
        booking.service?.service_name ||
        'Service';

      // Get contact name from nested object or direct fields
      const contactFirstName = booking.client_first_name ||
        booking.contact?.first_name ||
        '';
      const contactLastName = booking.client_last_name ||
        booking.contact?.last_name ||
        '';
      const contactName = `${contactFirstName} ${contactLastName}`.trim() || undefined;

      return {
        id: booking.id,
        serviceName,
        contactName,
        startTime: booking.start_time,
        endTime: booking.end_time,
        status: booking.status || 'confirmed'
      };
    });

    return {
      success: true,
      action: {
        type: 'present_booking_list',
        bookings: formattedBookings
      }
    };
  }

  /**
   * Execute reschedule_booking tool - reschedule a booking to a new time with availability check
   */
  private async executeRescheduleBooking(args: Record<string, unknown>): Promise<ToolResult> {
    const bookingId = args.booking_id as string;
    const newStartTime = args.new_start_time as string;

    if (!bookingId || !newStartTime) {
      return { success: false, error: 'booking_id and new_start_time are required' };
    }

    logger.info(
      { userId: this.userId, bookingId, newStartTime },
      'Rescheduling booking'
    );

    try {
      // 1. Get the current booking to find service duration
      const bookingResult = await schedulingBookingRepository.findById(bookingId, this.userId);
      if (bookingResult.error || !bookingResult.data) {
        return { success: false, error: 'Booking not found' };
      }

      const booking = bookingResult.data;

      // Calculate duration from existing booking
      const existingStart = new Date(booking.start_time);
      const existingEnd = new Date(booking.end_time);
      const durationMs = existingEnd.getTime() - existingStart.getTime();

      // Calculate new end time based on duration
      const newStart = new Date(newStartTime);
      const newEnd = new Date(newStart.getTime() + durationMs);

      // 2. Check for overlapping bookings (excluding current booking)
      const overlapResult = await schedulingBookingRepository.checkOverlap(
        this.userId,
        newStart.toISOString(),
        newEnd.toISOString(),
        bookingId // exclude this booking from overlap check
      );

      if (overlapResult.data && overlapResult.data.length > 0) {
        // There's a conflict - return error with details
        const conflicts = overlapResult.data.map(b => ({
          start: b.start_time,
          end: b.end_time,
          client: `${b.client_first_name} ${b.client_last_name || ''}`.trim()
        }));

        return {
          success: false,
          error: `Time slot not available. Conflicts with ${conflicts.length} existing booking(s).`,
          data: { conflicts }
        };
      }

      // 3. Check availability for this day/time
      // Get availability settings from business profile
      const profileResult = await businessProfileRepository.findByUserId(this.userId);

      if (profileResult.data) {
        const profile = profileResult.data as { scheduling_availability?: Record<string, Array<{ start: string; end: string }>> };
        const availability = profile.scheduling_availability;

        if (availability) {
          const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
          const dayOfWeek = days[newStart.getDay()] as string;

          const daySlots = availability[dayOfWeek] as Array<{ start: string; end: string }> | undefined;

          if (!daySlots || daySlots.length === 0) {
            return {
              success: false,
              error: `Not available on ${newStart.toLocaleDateString('en-US', { weekday: 'long' })}s. Please choose a different day.`
            };
          }

          // Check if new time falls within available hours
          const newStartHour = newStart.getHours();
          const newStartMinutes = newStart.getMinutes();
          const newStartTimeStr = `${String(newStartHour).padStart(2, '0')}:${String(newStartMinutes).padStart(2, '0')}`;

          const newEndHour = newEnd.getHours();
          const newEndMinutes = newEnd.getMinutes();
          const newEndTimeStr = `${String(newEndHour).padStart(2, '0')}:${String(newEndMinutes).padStart(2, '0')}`;

          const isWithinAvailability = daySlots.some(slot =>
            slot.start <= newStartTimeStr && slot.end >= newEndTimeStr
          );

          if (!isWithinAvailability) {
            return {
              success: false,
              error: `Time ${newStartTimeStr} is outside available hours. Available times: ${daySlots.map(s => `${s.start}-${s.end}`).join(', ')}`
            };
          }
        }
      }

      // 4. Create pending mutation for confirmation
      const confirmationId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      pendingMutations.set(confirmationId, {
        id: confirmationId,
        userId: this.userId,
        entity: 'bookings',
        operation: 'update',
        entityId: bookingId,
        payload: {
          start_time: newStart.toISOString(),
          end_time: newEnd.toISOString()
        },
        preview: `Reschedule booking to ${newStart.toLocaleDateString()} ${newStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        createdAt: now,
        expiresAt
      });

      return {
        success: true,
        requiresConfirmation: true,
        confirmationId,
        preview: `Reschedule booking to ${newStart.toLocaleDateString()} ${newStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
        actionType: 'update',
        entity: 'bookings'
      };
    } catch (error) {
      logger.error({ err: error, bookingId, newStartTime }, 'Failed to reschedule booking');
      return { success: false, error: 'Failed to reschedule booking' };
    }
  }

  /**
   * Execute update_availability tool - update business hours for specific days
   */
  private async executeUpdateAvailability(args: Record<string, unknown>): Promise<ToolResult> {
    const days = args.days as string[] | undefined;
    const hours = args.hours as Array<{ start: string; end: string }> | undefined;
    const clearDay = args.clear_day as string | undefined;

    logger.info(
      { userId: this.userId, days, hours, clearDay },
      'Updating availability'
    );

    try {
      // Get current availability
      const profileResult = await businessProfileRepository.findByUserId(this.userId);
      if (profileResult.error) {
        return { success: false, error: 'Failed to fetch current availability' };
      }

      const profile = profileResult.data as { scheduling_availability?: Record<string, Array<{ start: string; end: string }>> } | null;
      const currentAvailability = profile?.scheduling_availability || {};

      // Handle clearing a day (making it unavailable)
      if (clearDay) {
        const dayName = this.normalizeDayName(clearDay);
        if (!dayName) {
          return { success: false, error: `Invalid day name: ${clearDay}` };
        }

        const updatedAvailability = { ...currentAvailability };
        delete updatedAvailability[dayName];

        // Create pending mutation for confirmation
        const confirmationId = crypto.randomUUID();
        const now = new Date();
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        pendingMutations.set(confirmationId, {
          id: confirmationId,
          userId: this.userId,
          entity: 'availability',
          operation: 'update',
          payload: { scheduling_availability: updatedAvailability },
          preview: `Mark ${dayName} as unavailable (closed)`,
          createdAt: now,
          expiresAt
        });

        return {
          success: true,
          requiresConfirmation: true,
          confirmationId,
          preview: `Mark ${dayName} as unavailable (closed)`,
          actionType: 'update',
          entity: 'availability'
        } as any;
      }

      // Handle setting hours for days
      if (!days || days.length === 0) {
        return { success: false, error: 'days array is required' };
      }

      if (!hours || hours.length === 0) {
        return { success: false, error: 'hours array with start/end times is required' };
      }

      // Validate time format (HH:MM)
      const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
      for (const slot of hours) {
        if (!timeRegex.test(slot.start) || !timeRegex.test(slot.end)) {
          return { success: false, error: `Invalid time format. Use HH:MM (e.g., "09:00", "17:00")` };
        }
        if (slot.start >= slot.end) {
          return { success: false, error: `Start time (${slot.start}) must be before end time (${slot.end})` };
        }
      }

      // Normalize day names
      const normalizedDays: string[] = [];
      for (const day of days) {
        const normalized = this.normalizeDayName(day);
        if (!normalized) {
          return { success: false, error: `Invalid day name: ${day}` };
        }
        normalizedDays.push(normalized);
      }

      // Build updated availability
      const updatedAvailability = { ...currentAvailability };
      for (const dayName of normalizedDays) {
        updatedAvailability[dayName] = hours;
      }

      // Create pending mutation for confirmation
      const confirmationId = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      const hoursDescription = hours.map(h => `${h.start}-${h.end}`).join(', ');
      const daysDescription = normalizedDays.join(', ');

      pendingMutations.set(confirmationId, {
        id: confirmationId,
        userId: this.userId,
        entity: 'availability',
        operation: 'update',
        payload: { scheduling_availability: updatedAvailability },
        preview: `Set availability for ${daysDescription}: ${hoursDescription}`,
        createdAt: now,
        expiresAt
      });

      return {
        success: true,
        requiresConfirmation: true,
        confirmationId,
        preview: `Set availability for ${daysDescription}: ${hoursDescription}`,
        actionType: 'update',
        entity: 'availability'
      } as any;
    } catch (error) {
      logger.error({ err: error, days, hours }, 'Failed to update availability');
      return { success: false, error: 'Failed to update availability' };
    }
  }

  /**
   * Normalize day name to lowercase English (sunday, monday, etc.)
   */
  private normalizeDayName(day: string): string | null {
    const dayMap: Record<string, string> = {
      // English
      'sunday': 'sunday', 'sun': 'sunday',
      'monday': 'monday', 'mon': 'monday',
      'tuesday': 'tuesday', 'tue': 'tuesday', 'tues': 'tuesday',
      'wednesday': 'wednesday', 'wed': 'wednesday',
      'thursday': 'thursday', 'thu': 'thursday', 'thur': 'thursday', 'thurs': 'thursday',
      'friday': 'friday', 'fri': 'friday',
      'saturday': 'saturday', 'sat': 'saturday',
      // Hebrew
      'ראשון': 'sunday', 'יום ראשון': 'sunday',
      'שני': 'monday', 'יום שני': 'monday',
      'שלישי': 'tuesday', 'יום שלישי': 'tuesday',
      'רביעי': 'wednesday', 'יום רביעי': 'wednesday',
      'חמישי': 'thursday', 'יום חמישי': 'thursday',
      'שישי': 'friday', 'יום שישי': 'friday',
      'שבת': 'saturday', 'יום שבת': 'saturday'
    };

    return dayMap[day.toLowerCase().trim()] || null;
  }

  /**
   * Execute get_revenue_stats tool - get revenue and payment statistics
   */
  private async executeGetRevenueStats(args: Record<string, unknown>): Promise<ToolResult> {
    const period = (args.period as string) || 'this_month';

    logger.info({ userId: this.userId, period }, 'Getting revenue stats');

    try {
      // Calculate date range based on period
      const now = new Date();
      let startDate: Date;

      switch (period) {
        case 'today':
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          break;
        case 'this_week':
          const dayOfWeek = now.getDay();
          startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dayOfWeek);
          break;
        case 'this_month':
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case 'last_30_days':
          startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case 'all_time':
        default:
          startDate = new Date(0); // Beginning of time
      }

      // Fetch revenue data
      const [revenueResult, invoicesResult, transactionsResult] = await Promise.all([
        paymentTransactionRepository.getTotalRevenue(
          this.userId,
          startDate.toISOString(),
          now.toISOString()
        ),
        paymentInvoiceRepository.list(this.userId, { status: 'paid' }),
        paymentTransactionRepository.list(this.userId, { status: 'succeeded' })
      ]);

      // Calculate stats
      const totalRevenue = revenueResult.data || 0;
      const paidInvoices = invoicesResult.data?.filter(inv => {
        const paidDate = inv.paid_at ? new Date(inv.paid_at) : null;
        return paidDate && paidDate >= startDate && paidDate <= now;
      }).length || 0;
      const transactionCount = transactionsResult.data?.filter(tx => {
        const txDate = tx.paid_at ? new Date(tx.paid_at) : new Date(tx.created_at);
        return txDate >= startDate && txDate <= now;
      }).length || 0;

      // Get pending invoices (sent or overdue - not paid yet)
      const [sentInvoicesResult, overdueInvoicesResult] = await Promise.all([
        paymentInvoiceRepository.list(this.userId, { status: 'sent' }),
        paymentInvoiceRepository.list(this.userId, { status: 'overdue' })
      ]);
      const allPendingInvoices = [
        ...(sentInvoicesResult.data || []),
        ...(overdueInvoicesResult.data || [])
      ];
      const pendingAmount = allPendingInvoices.reduce((sum, inv) => sum + inv.amount, 0);
      const pendingCount = allPendingInvoices.length;

      // Get user's currency from profile
      const profileResult = await businessProfileRepository.findByUserId(this.userId);
      const currency = profileResult.data?.currency || 'ILS';

      return {
        success: true,
        data: {
          period,
          currency,
          totalRevenue,
          transactionCount,
          paidInvoicesCount: paidInvoices,
          pendingInvoices: {
            count: pendingCount,
            totalAmount: pendingAmount
          },
          summary: `Revenue for ${period.replace('_', ' ')}: ${currency} ${totalRevenue.toLocaleString()}. ${transactionCount} transactions, ${paidInvoices} paid invoices. ${pendingCount} pending invoices worth ${currency} ${pendingAmount.toLocaleString()}.`
        }
      };
    } catch (error) {
      logger.error({ err: error, userId: this.userId, period }, 'Failed to get revenue stats');
      return { success: false, error: 'Failed to retrieve revenue statistics' };
    }
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

    const { entity, fields, orderBy, limit } = parsed.data;
    const maxLimit = Math.min(limit || 20, 50);

    // Resolve semantic filters (e.g., status_semantic: "pending" → status: ["sent", "overdue"])
    const resolvedFilters = parsed.data.filters
      ? resolveAllSemanticFilters(entity, parsed.data.filters)
      : undefined;

    logger.debug(
      { entity, originalFilters: parsed.data.filters, resolvedFilters },
      'Resolved semantic filters'
    );

    let result: { data: unknown[] | null; error: Error | null };

    switch (entity) {
      case 'contacts':
        result = await this.queryContacts(resolvedFilters, orderBy, maxLimit);
        break;
      case 'services':
        result = await this.queryServices(resolvedFilters, maxLimit);
        break;
      case 'bookings':
        result = await this.queryBookings(resolvedFilters, orderBy, maxLimit);
        break;
      case 'tasks':
        result = await this.queryTasks(resolvedFilters, orderBy, maxLimit);
        break;
      case 'invoices':
        result = await this.queryInvoices(resolvedFilters, maxLimit);
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
    // Handle array status (from semantic resolution) by fetching multiple statuses
    if (filters?.status && Array.isArray(filters.status)) {
      const statuses = filters.status as string[];
      const serviceId = filters.service_id ? String(filters.service_id) : undefined;
      const contactId = filters.contact_id ? String(filters.contact_id) : undefined;
      const startDate = filters.start_date ? String(filters.start_date) : undefined;
      const endDate = filters.end_date ? String(filters.end_date) : undefined;
      const search = filters.search ? String(filters.search) : undefined;

      // Fetch all statuses in parallel
      const results = await Promise.all(
        statuses.map(status =>
          schedulingBookingRepository.list(this.userId, {
            serviceId,
            contactId,
            status,
            startDate,
            endDate,
            search,
            limit
          })
        )
      );

      // Combine results and remove duplicates by ID
      const allBookings = results.flatMap(r => r.data || []);
      const uniqueBookings = Array.from(
        new Map(allBookings.map(booking => [booking.id, booking])).values()
      );

      // Sort by start_time and apply limit
      uniqueBookings.sort((a, b) => {
        const aTime = (a as { start_time: string }).start_time;
        const bTime = (b as { start_time: string }).start_time;
        return new Date(aTime).getTime() - new Date(bTime).getTime();
      });

      return {
        data: uniqueBookings.slice(0, limit),
        error: null
      };
    }

    // Single status or no status filter
    const options: {
      serviceId?: string;
      contactId?: string;
      status?: string;
      startDate?: string;
      endDate?: string;
      search?: string;
      limit: number;
    } = { limit };

    if (filters) {
      if (filters.service_id) options.serviceId = String(filters.service_id);
      if (filters.contact_id) options.contactId = String(filters.contact_id);
      if (filters.status) options.status = String(filters.status);
      if (filters.start_date) options.startDate = String(filters.start_date);
      if (filters.end_date) options.endDate = String(filters.end_date);
      // Search by client name
      if (filters.search) options.search = String(filters.search);
    }

    return schedulingBookingRepository.list(this.userId, options);
  }

  private async queryTasks(
    filters: Record<string, unknown> | undefined,
    orderBy: { field: string; direction: 'asc' | 'desc' } | undefined,
    limit: number
  ) {
    // Handle array status (from semantic resolution) by fetching multiple statuses
    if (filters?.status && Array.isArray(filters.status)) {
      const statuses = filters.status as string[];
      const contactId = filters.contact_id ? String(filters.contact_id) : undefined;
      const priority = filters.priority as 'low' | 'medium' | 'high' | 'urgent' | undefined;
      const search = filters.search ? String(filters.search) : undefined;

      // Fetch all statuses in parallel
      const results = await Promise.all(
        statuses.map(status =>
          crmTaskRepository.list(this.userId, {
            contact_id: contactId,
            status: status as 'pending' | 'in_progress' | 'completed' | 'cancelled',
            priority,
            search,
            include_completed: status === 'completed',
            limit
          })
        )
      );

      // Combine results and remove duplicates by ID
      const allTasks = results.flatMap(r => r.data || []);
      const uniqueTasks = Array.from(
        new Map(allTasks.map(task => [task.id, task])).values()
      );

      // Sort by due_date or created_at and apply limit
      uniqueTasks.sort((a, b) => {
        const aTask = a as { due_date?: string; created_at: string };
        const bTask = b as { due_date?: string; created_at: string };
        const aDate = aTask.due_date ? new Date(aTask.due_date) : new Date(aTask.created_at);
        const bDate = bTask.due_date ? new Date(bTask.due_date) : new Date(bTask.created_at);
        return aDate.getTime() - bDate.getTime();
      });

      return {
        data: uniqueTasks.slice(0, limit),
        error: null
      };
    }

    // Handle array priority (from semantic resolution)
    if (filters?.priority && Array.isArray(filters.priority)) {
      const priorities = filters.priority as string[];
      const contactId = filters.contact_id ? String(filters.contact_id) : undefined;
      const status = filters.status as 'pending' | 'in_progress' | 'completed' | 'cancelled' | undefined;
      const search = filters.search ? String(filters.search) : undefined;

      // Fetch all priorities in parallel
      const results = await Promise.all(
        priorities.map(priority =>
          crmTaskRepository.list(this.userId, {
            contact_id: contactId,
            status,
            priority: priority as 'low' | 'medium' | 'high' | 'urgent',
            search,
            include_completed: status === 'completed',
            limit
          })
        )
      );

      // Combine results and remove duplicates by ID
      const allTasks = results.flatMap(r => r.data || []);
      const uniqueTasks = Array.from(
        new Map(allTasks.map(task => [task.id, task])).values()
      );

      return {
        data: uniqueTasks.slice(0, limit),
        error: null
      };
    }

    // Single status or no status filter
    const options: {
      contact_id?: string;
      status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
      priority?: 'low' | 'medium' | 'high' | 'urgent';
      include_completed?: boolean;
      search?: string;
      limit: number;
    } = { limit };

    if (filters) {
      if (filters.contact_id) options.contact_id = String(filters.contact_id);
      if (filters.status) options.status = filters.status as any;
      if (filters.priority) options.priority = filters.priority as any;
      if (filters.include_completed) options.include_completed = true;
      // Search by title/description
      if (filters.search) options.search = String(filters.search);
    }

    return crmTaskRepository.list(this.userId, options);
  }

  private async queryInvoices(
    filters: Record<string, unknown> | undefined,
    limit: number
  ) {
    // Handle array status (from semantic resolution) by fetching multiple statuses
    if (filters?.status && Array.isArray(filters.status)) {
      const statuses = filters.status as string[];
      const contactId = filters.contact_id ? String(filters.contact_id) : undefined;
      const search = filters.search ? String(filters.search) : undefined;

      // Fetch all statuses in parallel, including contact info for display
      const results = await Promise.all(
        statuses.map(status =>
          paymentInvoiceRepository.list(this.userId, {
            status,
            contactId,
            search,
            limit,
            includeContact: true
          })
        )
      );

      // Combine results and remove duplicates by ID
      const allInvoices = results.flatMap(r => r.data || []);
      const uniqueInvoices = Array.from(
        new Map(allInvoices.map(inv => [inv.id, inv])).values()
      );

      // Sort by created_at descending and apply limit
      uniqueInvoices.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      return {
        data: uniqueInvoices.slice(0, limit),
        error: null
      };
    }

    // Single status or no status filter
    const options: {
      status?: string;
      contactId?: string;
      search?: string;
      limit: number;
      includeContact: boolean;
    } = { limit, includeContact: true };

    if (filters) {
      if (filters.status) options.status = String(filters.status);
      if (filters.contact_id) options.contactId = String(filters.contact_id);
      // Search by invoice number
      if (filters.search) options.search = String(filters.search);
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
    // Resolve semantic filters before counting
    const resolvedFilters = filters
      ? resolveAllSemanticFilters(entity, filters)
      : undefined;

    let count = 0;

    switch (entity) {
      case 'contacts': {
        // Check if we have date filters
        const hasDateFilters = filters?.created_at_gte || filters?.created_at_lte;

        if (hasDateFilters) {
          // Use list with date filters and count results
          const listResult = await crmContactRepository.list(this.userId, {
            stage: filters?.stage as string,
            search: filters?.search as string,
            limit: 1000 // Get all for counting
          });

          if (listResult.data) {
            // Filter by date range
            let filteredContacts = listResult.data;

            if (filters?.created_at_gte) {
              const startDate = new Date(filters.created_at_gte as string);
              filteredContacts = filteredContacts.filter(c =>
                new Date(c.created_at) >= startDate
              );
            }

            if (filters?.created_at_lte) {
              const endDate = new Date(filters.created_at_lte as string);
              filteredContacts = filteredContacts.filter(c =>
                new Date(c.created_at) <= endDate
              );
            }

            count = filteredContacts.length;
          }
        } else {
          // Use optimized count query without date filters
          const result = await crmContactRepository.count(this.userId, {
            stage: filters?.stage as string,
            search: filters?.search as string
          });
          count = result.data || 0;
        }
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
        // Handle array status (from semantic resolution like "open" → ["pending", "in_progress"])
        if (resolvedFilters?.status && Array.isArray(resolvedFilters.status)) {
          const statuses = resolvedFilters.status as Array<'pending' | 'in_progress' | 'completed' | 'cancelled'>;
          count = statuses.reduce((sum, status) => sum + (result.data?.[status] || 0), 0);
        } else if (resolvedFilters?.status) {
          const statusKey = resolvedFilters.status as 'pending' | 'in_progress' | 'completed' | 'cancelled';
          count = result.data?.[statusKey] || 0;
        } else {
          const counts = result.data || { pending: 0, in_progress: 0, completed: 0, cancelled: 0 };
          count = counts.pending + counts.in_progress + counts.completed + counts.cancelled;
        }
        break;
      }
      case 'invoices': {
        // Handle array status (from semantic resolution)
        if (resolvedFilters?.status && Array.isArray(resolvedFilters.status)) {
          const statuses = resolvedFilters.status as string[];
          const results = await Promise.all(
            statuses.map(status =>
              paymentInvoiceRepository.list(this.userId, { status })
            )
          );
          // Combine and deduplicate by ID
          const allInvoices = results.flatMap(r => r.data || []);
          const uniqueIds = new Set(allInvoices.map(inv => inv.id));
          count = uniqueIds.size;
        } else {
          const result = await paymentInvoiceRepository.list(this.userId, {
            status: resolvedFilters?.status as string
          });
          count = result.data?.length || 0;
        }
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
        case 'availability':
          return this.mutateAvailability(operation, payload);
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
        // Build update object with only provided fields
        const updateData: Record<string, unknown> = {};
        if (payload?.status) updateData.status = payload.status as 'confirmed' | 'cancelled' | 'completed' | 'no_show';
        if (payload?.internal_notes !== undefined) updateData.internal_notes = payload.internal_notes as string;
        if (payload?.start_time) updateData.start_time = payload.start_time as string;
        if (payload?.end_time) updateData.end_time = payload.end_time as string;

        const result = await schedulingBookingRepository.update(id, this.userId, updateData);
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
      case 'create': {
        // Get next invoice number
        const invoiceNumberResult = await paymentInvoiceRepository.getNextInvoiceNumber(this.userId);
        if (invoiceNumberResult.error || !invoiceNumberResult.data) {
          return { success: false, error: 'Failed to generate invoice number' };
        }

        // Build line items from payload
        const lineItems = payload?.line_items as Array<{
          description: string;
          quantity: number;
          unit_price: number;
          total?: number;
        }> || [];

        // Calculate total if line items provided
        const calculatedItems = lineItems.map(item => ({
          description: item.description,
          quantity: item.quantity || 1,
          unit_price: item.unit_price,
          total: item.total ?? (item.quantity || 1) * item.unit_price
        }));

        const totalAmount = payload?.amount as number ||
          calculatedItems.reduce((sum, item) => sum + item.total, 0);

        const result = await paymentInvoiceRepository.create({
          user_id: this.userId,
          contact_id: payload?.contact_id as string || null,
          invoice_number: invoiceNumberResult.data,
          amount: totalAmount,
          currency: (payload?.currency as string) || 'ILS',
          status: 'draft',
          line_items: calculatedItems.length > 0 ? calculatedItems : [{
            description: (payload?.description as string) || 'Services',
            quantity: 1,
            unit_price: totalAmount,
            total: totalAmount
          }],
          due_date: payload?.due_date as string || null,
          payment_terms: (payload?.payment_terms as string) || 'due_on_receipt',
          notes: payload?.notes as string || null,
          internal_notes: payload?.internal_notes as string || null,
          sent_at: null,
          paid_at: null,
          payment_method: null,
          payment_received_at: null,
          payment_notes: null,
          processor_type: null,
          processor_checkout_id: null,
          processor_payment_id: null,
          processor_customer_id: null,
          processor_payment_method_id: null,
          retry_count: 0,
          last_retry_at: null,
          next_retry_at: null
        });

        if (result.error) {
          return { success: false, error: result.error.message };
        }

        logger.info(
          { userId: this.userId, invoiceId: result.data?.id, invoiceNumber: invoiceNumberResult.data },
          'Invoice created via chat'
        );

        return { success: true, data: result.data };
      }
      case 'update': {
        if (!id) return { success: false, error: 'ID required for update' };
        const result = await paymentInvoiceRepository.update(id, this.userId, {
          status: payload?.status as 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled',
          notes: payload?.notes as string,
          due_date: payload?.due_date as string,
          amount: payload?.amount as number
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

  private async mutateAvailability(
    operation: string,
    payload: Record<string, unknown> | undefined
  ): Promise<ToolResult> {
    if (operation !== 'update') {
      return { success: false, error: `Availability ${operation} not supported` };
    }

    if (!payload?.scheduling_availability) {
      return { success: false, error: 'scheduling_availability payload required' };
    }

    const result = await businessProfileRepository.update(this.userId, {
      scheduling_availability: payload.scheduling_availability as Record<string, Array<{ start: string; end: string }>>
    });

    if (result.error) {
      return { success: false, error: result.error.message };
    }

    logger.info(
      { userId: this.userId },
      'Availability updated via chat'
    );

    return { success: true, data: result.data };
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

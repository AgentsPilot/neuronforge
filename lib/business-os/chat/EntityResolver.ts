/**
 * EntityResolver
 *
 * Resolves entity references deterministically without LLM.
 * Handles exact matches, fuzzy matches, and disambiguation.
 */

import { crmContactRepository } from '@/lib/repositories/CRMContactRepository';
import { crmTaskRepository } from '@/lib/repositories/CRMTaskRepository';
import {
  schedulingServiceRepository,
  schedulingBookingRepository
} from '@/lib/repositories/SchedulingRepository';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'EntityResolver' });

// ============== TYPES ==============

export type EntityType = 'contacts' | 'tasks' | 'services' | 'bookings' | 'invoices';

export interface ResolvedEntity {
  id: string;
  type: EntityType;
  data: Record<string, unknown>;
  displayName: string;
  confidence: number;  // 0-1, how confident we are in the match
}

export interface EntityChoice {
  id: string;
  label: string;
  sublabel?: string;
  entity: Record<string, unknown>;
}

export type ResolutionStatus = 'exact' | 'multiple' | 'none' | 'error';

export interface ResolutionResult {
  status: ResolutionStatus;
  entity?: ResolvedEntity;
  choices?: EntityChoice[];
  error?: string;
  searchedTerm?: string;
}

// ============== PATTERNS ==============

// Entity ID pattern: [ID: uuid]
const ENTITY_ID_PATTERN = /\[ID:\s*([a-f0-9-]{36})\]/i;
const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

// ============== RESOLVER CLASS ==============

export class EntityResolver {
  constructor(private userId: string) {}

  /**
   * Resolve an entity reference to actual entity data
   */
  async resolve(
    entityType: EntityType,
    reference: string,
    filters?: Record<string, unknown>
  ): Promise<ResolutionResult> {
    const trimmed = reference.trim();

    logger.debug({ entityType, reference: trimmed, filters }, 'Resolving entity');

    // 1. Check for explicit ID in [ID: uuid] format
    const bracketMatch = ENTITY_ID_PATTERN.exec(trimmed);
    if (bracketMatch) {
      return this.resolveById(entityType, bracketMatch[1]);
    }

    // 2. Check if reference is a raw UUID
    if (UUID_PATTERN.test(trimmed)) {
      return this.resolveById(entityType, trimmed);
    }

    // 3. Search by name/text
    return this.resolveBySearch(entityType, trimmed, filters);
  }

  /**
   * Resolve entity by exact ID
   */
  async resolveById(entityType: EntityType, id: string): Promise<ResolutionResult> {
    try {
      logger.debug({ entityType, id }, 'Resolving entity by ID');

      let result: { data: unknown | null; error: Error | null };

      switch (entityType) {
        case 'contacts':
          result = await crmContactRepository.findById(id, this.userId);
          break;
        case 'tasks':
          result = await crmTaskRepository.findById(id, this.userId);
          break;
        case 'services':
          result = await schedulingServiceRepository.findById(id, this.userId);
          break;
        case 'bookings':
          result = await schedulingBookingRepository.getById(id, this.userId);
          break;
        case 'invoices':
          result = await paymentInvoiceRepository.findById(id, this.userId);
          break;
        default:
          return { status: 'error', error: `Unknown entity type: ${entityType}` };
      }

      if (result.error || !result.data) {
        logger.warn({ entityType, id }, 'Entity not found by ID');
        return { status: 'none', searchedTerm: id };
      }

      const entity = result.data as Record<string, unknown>;
      return {
        status: 'exact',
        entity: {
          id,
          type: entityType,
          data: entity,
          displayName: this.getDisplayName(entityType, entity),
          confidence: 1.0
        }
      };
    } catch (error) {
      logger.error({ err: error, entityType, id }, 'Failed to resolve entity by ID');
      return { status: 'error', error: 'Failed to resolve entity' };
    }
  }

  /**
   * Resolve entity by search text
   */
  async resolveBySearch(
    entityType: EntityType,
    searchText: string,
    filters?: Record<string, unknown>
  ): Promise<ResolutionResult> {
    try {
      logger.debug({ entityType, searchText, filters }, 'Resolving entity by search');

      let entities: Array<Record<string, unknown>> = [];

      switch (entityType) {
        case 'contacts':
          entities = await this.searchContacts(searchText, filters);
          break;
        case 'tasks':
          entities = await this.searchTasks(searchText, filters);
          break;
        case 'services':
          entities = await this.searchServices(searchText, filters);
          break;
        case 'bookings':
          entities = await this.searchBookings(searchText, filters);
          break;
        case 'invoices':
          entities = await this.searchInvoices(searchText, filters);
          break;
        default:
          return { status: 'error', error: `Unknown entity type: ${entityType}` };
      }

      // No matches
      if (entities.length === 0) {
        logger.debug({ entityType, searchText }, 'No entities found');
        return { status: 'none', searchedTerm: searchText };
      }

      // Exact single match
      if (entities.length === 1) {
        const entity = entities[0];
        return {
          status: 'exact',
          entity: {
            id: entity.id as string,
            type: entityType,
            data: entity,
            displayName: this.getDisplayName(entityType, entity),
            confidence: this.calculateMatchConfidence(searchText, entity, entityType)
          }
        };
      }

      // Multiple matches - return choices
      logger.debug(
        { entityType, searchText, matchCount: entities.length },
        'Multiple entities found, returning choices'
      );

      return {
        status: 'multiple',
        choices: entities.slice(0, 10).map(entity => ({
          id: entity.id as string,
          label: this.getDisplayName(entityType, entity),
          sublabel: this.getSublabel(entityType, entity),
          entity
        })),
        searchedTerm: searchText
      };
    } catch (error) {
      logger.error({ err: error, entityType, searchText }, 'Failed to resolve entity by search');
      return { status: 'error', error: 'Failed to search entities' };
    }
  }

  // ============== SEARCH METHODS ==============

  private async searchContacts(
    searchText: string,
    filters?: Record<string, unknown>
  ): Promise<Array<Record<string, unknown>>> {
    const result = await crmContactRepository.list(this.userId, {
      search: searchText,
      stage: filters?.stage as string,
      limit: 10
    });

    return (result.data || []) as Array<Record<string, unknown>>;
  }

  private async searchTasks(
    searchText: string,
    filters?: Record<string, unknown>
  ): Promise<Array<Record<string, unknown>>> {
    // Default to pending tasks if no status filter
    const status = filters?.status as string || 'pending';

    const result = await crmTaskRepository.list(this.userId, {
      search: searchText,
      status,
      limit: 10
    });

    return (result.data || []) as Array<Record<string, unknown>>;
  }

  private async searchServices(
    searchText: string,
    filters?: Record<string, unknown>
  ): Promise<Array<Record<string, unknown>>> {
    // Default to active services only
    const activeOnly = filters?.is_active !== false;

    const result = await schedulingServiceRepository.listAll(this.userId, activeOnly);
    const services = (result.data || []) as Array<Record<string, unknown>>;

    // Filter by search text
    const searchLower = searchText.toLowerCase();
    return services.filter(s =>
      (s.service_name as string || '').toLowerCase().includes(searchLower) ||
      (s.description as string || '').toLowerCase().includes(searchLower)
    ).slice(0, 10);
  }

  private async searchBookings(
    searchText: string,
    filters?: Record<string, unknown>
  ): Promise<Array<Record<string, unknown>>> {
    // Default to upcoming bookings
    const result = await schedulingBookingRepository.listUpcoming(this.userId, 20);
    const bookings = (result.data || []) as Array<Record<string, unknown>>;

    // Filter by search (client name, service name)
    const searchLower = searchText.toLowerCase();
    return bookings.filter(b => {
      const clientName = `${b.client_first_name || ''} ${b.client_last_name || ''}`.toLowerCase();
      const serviceName = (b.service_name as string || '').toLowerCase();
      const startDate = new Date(b.start_time as string).toLocaleDateString();

      return clientName.includes(searchLower) ||
             serviceName.includes(searchLower) ||
             startDate.includes(searchText);
    }).slice(0, 10);
  }

  private async searchInvoices(
    searchText: string,
    filters?: Record<string, unknown>
  ): Promise<Array<Record<string, unknown>>> {
    const result = await paymentInvoiceRepository.list(this.userId, {
      status: filters?.status as string,
      limit: 20,
      includeContact: true
    });
    const invoices = (result.data || []) as Array<Record<string, unknown>>;

    // Filter by search (invoice number, contact name)
    const searchLower = searchText.toLowerCase();
    return invoices.filter(inv =>
      (inv.invoice_number as string || '').toLowerCase().includes(searchLower) ||
      (inv.contact_name as string || '').toLowerCase().includes(searchLower)
    ).slice(0, 10);
  }

  // ============== DISPLAY HELPERS ==============

  /**
   * Get display name for an entity
   */
  getDisplayName(entityType: EntityType, entity: Record<string, unknown>): string {
    switch (entityType) {
      case 'contacts': {
        const firstName = (entity.first_name || '') as string;
        const lastName = (entity.last_name || '') as string;
        return `${firstName} ${lastName}`.trim() || (entity.email as string) || 'Contact';
      }
      case 'tasks':
        return (entity.title as string) || 'Task';
      case 'services':
        return (entity.service_name as string) || 'Service';
      case 'bookings': {
        const date = new Date(entity.start_time as string).toLocaleDateString();
        const serviceName = entity.service_name as string || 'Booking';
        const clientName = `${entity.client_first_name || ''} ${entity.client_last_name || ''}`.trim();
        return clientName ? `${serviceName} with ${clientName} (${date})` : `${serviceName} (${date})`;
      }
      case 'invoices':
        return `Invoice #${entity.invoice_number || entity.id}`;
      default:
        return entity.id as string;
    }
  }

  /**
   * Get sublabel for choice display
   */
  getSublabel(entityType: EntityType, entity: Record<string, unknown>): string | undefined {
    switch (entityType) {
      case 'contacts':
        return entity.email as string || entity.phone as string;
      case 'tasks': {
        if (entity.due_date) {
          return `Due: ${new Date(entity.due_date as string).toLocaleDateString()}`;
        }
        return undefined;
      }
      case 'services': {
        const price = entity.price as number;
        const duration = entity.duration_minutes as number;
        const parts = [];
        if (duration) parts.push(`${duration} min`);
        if (price) parts.push(`₪${price}`);
        return parts.join(' • ') || undefined;
      }
      case 'bookings': {
        const time = new Date(entity.start_time as string).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit'
        });
        return time;
      }
      case 'invoices': {
        const amount = entity.amount as number;
        const status = entity.status as string;
        return `₪${amount} • ${status}`;
      }
      default:
        return undefined;
    }
  }

  /**
   * Calculate confidence score for a match
   */
  private calculateMatchConfidence(
    searchText: string,
    entity: Record<string, unknown>,
    entityType: EntityType
  ): number {
    const displayName = this.getDisplayName(entityType, entity).toLowerCase();
    const searchLower = searchText.toLowerCase();

    // Exact match
    if (displayName === searchLower) {
      return 1.0;
    }

    // Starts with
    if (displayName.startsWith(searchLower)) {
      return 0.9;
    }

    // Contains
    if (displayName.includes(searchLower)) {
      return 0.8;
    }

    // Word match
    const searchWords = searchLower.split(/\s+/);
    const displayWords = displayName.split(/\s+/);
    const matchingWords = searchWords.filter(sw =>
      displayWords.some(dw => dw.includes(sw) || sw.includes(dw))
    );

    if (matchingWords.length > 0) {
      return 0.5 + (0.3 * matchingWords.length / searchWords.length);
    }

    return 0.5;
  }

  // ============== BATCH RESOLUTION ==============

  /**
   * Resolve multiple entity references at once
   */
  async resolveMultiple(
    refs: Array<{ entityType: EntityType; reference: string; paramName: string }>
  ): Promise<Record<string, ResolutionResult>> {
    const results: Record<string, ResolutionResult> = {};

    // Run all resolutions in parallel
    await Promise.all(
      refs.map(async ({ entityType, reference, paramName }) => {
        results[paramName] = await this.resolve(entityType, reference);
      })
    );

    return results;
  }

  // ============== LIST METHODS (for displaying all options) ==============

  /**
   * List all entities of a type (for "which X?" questions)
   */
  async listAll(
    entityType: EntityType,
    filters?: Record<string, unknown>,
    limit = 10
  ): Promise<EntityChoice[]> {
    let entities: Array<Record<string, unknown>> = [];

    switch (entityType) {
      case 'contacts': {
        const result = await crmContactRepository.list(this.userId, { limit });
        entities = (result.data || []) as Array<Record<string, unknown>>;
        break;
      }
      case 'tasks': {
        const status = filters?.status as string || 'pending';
        const result = await crmTaskRepository.list(this.userId, { status, limit });
        entities = (result.data || []) as Array<Record<string, unknown>>;
        break;
      }
      case 'services': {
        const result = await schedulingServiceRepository.listAll(this.userId, true);
        entities = ((result.data || []) as Array<Record<string, unknown>>).slice(0, limit);
        break;
      }
      case 'bookings': {
        const result = await schedulingBookingRepository.listUpcoming(this.userId, limit);
        entities = (result.data || []) as Array<Record<string, unknown>>;
        break;
      }
      case 'invoices': {
        const result = await paymentInvoiceRepository.list(this.userId, {
          status: filters?.status as string,
          limit,
          includeContact: true
        });
        entities = (result.data || []) as Array<Record<string, unknown>>;
        break;
      }
    }

    return entities.map(entity => ({
      id: entity.id as string,
      label: this.getDisplayName(entityType, entity),
      sublabel: this.getSublabel(entityType, entity),
      entity
    }));
  }
}

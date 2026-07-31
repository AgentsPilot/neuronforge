/**
 * Semantic Schema for AI Data Layer
 *
 * Maps semantic terms (what users say) to actual database values.
 * This allows the LLM to output language-agnostic semantic terms
 * while the code handles the DB-specific resolution.
 *
 * Example:
 * - User says: "הצג חשבוניות ממתינות" (show pending invoices)
 * - LLM outputs: { status_semantic: "pending" }
 * - Code resolves: pending → ['sent', 'overdue']
 *
 * This works for ANY language because:
 * 1. LLMs are excellent at synonym normalization (ממתינה = מחכה = pending = waiting)
 * 2. We only need to define semantic → DB mappings once
 * 3. No language-specific examples needed in prompts
 */

// =============================================================================
// Semantic Mappings by Entity
// =============================================================================

export interface SemanticMapping {
  [semanticTerm: string]: string[];
}

export interface EntitySemanticFields {
  [fieldName: string]: SemanticMapping;
}

export interface SemanticMappings {
  [entityName: string]: EntitySemanticFields;
}

/**
 * Complete semantic mappings for all entities.
 * Add new mappings here - no prompt changes needed.
 */
export const SEMANTIC_MAPPINGS: SemanticMappings = {
  // Invoice semantic mappings
  invoices: {
    status: {
      // Pending/unpaid invoices (sent but not paid, or overdue)
      pending: ['sent', 'overdue'],
      unpaid: ['sent', 'overdue'],
      waiting: ['sent', 'overdue'],
      outstanding: ['sent', 'overdue'],

      // Paid invoices
      paid: ['paid'],
      completed: ['paid'],
      settled: ['paid'],

      // Draft invoices
      draft: ['draft'],
      unsent: ['draft'],

      // Cancelled invoices
      cancelled: ['cancelled'],
      voided: ['cancelled'],

      // Overdue specifically
      overdue: ['overdue'],
      late: ['overdue'],
    },
  },

  // Task semantic mappings
  tasks: {
    status: {
      // Open/active tasks
      open: ['pending', 'in_progress'],
      active: ['pending', 'in_progress'],
      incomplete: ['pending', 'in_progress'],
      todo: ['pending'],

      // In progress
      in_progress: ['in_progress'],
      working: ['in_progress'],
      started: ['in_progress'],

      // Completed tasks
      done: ['completed'],
      completed: ['completed'],
      finished: ['completed'],
      closed: ['completed'],

      // Cancelled tasks
      cancelled: ['cancelled'],
      dropped: ['cancelled'],
    },
    priority: {
      // High priority
      high: ['high', 'urgent'],
      important: ['high', 'urgent'],
      critical: ['urgent'],
      urgent: ['urgent'],

      // Medium priority
      medium: ['medium'],
      normal: ['medium'],

      // Low priority
      low: ['low'],
      minor: ['low'],
    },
  },

  // Booking semantic mappings
  bookings: {
    status: {
      // Upcoming/scheduled bookings
      upcoming: ['pending', 'confirmed'],
      scheduled: ['pending', 'confirmed'],
      active: ['pending', 'confirmed'],

      // Pending confirmation
      pending: ['pending'],
      unconfirmed: ['pending'],

      // Confirmed bookings
      confirmed: ['confirmed'],
      approved: ['confirmed'],

      // Completed bookings
      done: ['completed'],
      completed: ['completed'],
      finished: ['completed'],
      past: ['completed'],

      // No-show
      no_show: ['no_show'],
      missed: ['no_show'],

      // Cancelled bookings
      cancelled: ['cancelled'],
    },
  },

  // Contact semantic mappings
  contacts: {
    stage: {
      // Lead stage
      lead: ['lead'],
      prospect: ['lead'],
      potential: ['lead'],
      new: ['lead'],

      // Client stage
      client: ['client'],
      customer: ['client'],
      active: ['client'],

      // Past client
      past: ['past_client'],
      former: ['past_client'],
      inactive: ['past_client'],
      churned: ['past_client'],
    },
  },

  // Service semantic mappings
  services: {
    status: {
      // Active/published services
      active: ['active'],
      published: ['active'],
      live: ['active'],
      available: ['active'],

      // Draft/unpublished services
      draft: ['draft'],
      unpublished: ['draft'],
      hidden: ['draft'],
    },
  },

  // Transaction semantic mappings
  transactions: {
    status: {
      // Successful transactions
      successful: ['succeeded'],
      succeeded: ['succeeded'],
      completed: ['succeeded'],
      paid: ['succeeded'],

      // Pending transactions
      pending: ['pending'],
      processing: ['pending'],

      // Failed transactions
      failed: ['failed'],
      declined: ['failed'],
      rejected: ['failed'],

      // Refunded transactions
      refunded: ['refunded'],
      reversed: ['refunded'],
    },
  },

  // Email sequence semantic mappings
  sequences: {
    is_active: {
      // Active sequences (boolean field mapped to string for semantic resolution)
      active: ['true'],
      running: ['true'],
      enabled: ['true'],

      // Inactive sequences
      inactive: ['false'],
      paused: ['false'],
      disabled: ['false'],
      stopped: ['false'],
    },
  },
};

// =============================================================================
// Resolution Functions
// =============================================================================

/**
 * Resolve a semantic filter value to actual database values.
 *
 * @param entity - The entity name (e.g., 'invoices', 'tasks')
 * @param field - The field name (e.g., 'status', 'priority')
 * @param semanticValue - The semantic term from LLM (e.g., 'pending', 'open')
 * @returns Array of actual DB values, or the original value if no mapping found
 *
 * @example
 * resolveSemanticFilter('invoices', 'status', 'pending')
 * // Returns: ['sent', 'overdue']
 *
 * resolveSemanticFilter('tasks', 'status', 'open')
 * // Returns: ['pending', 'in_progress']
 *
 * resolveSemanticFilter('invoices', 'status', 'sent')
 * // Returns: 'sent' (no semantic mapping, returns literal)
 */
export function resolveSemanticFilter(
  entity: string,
  field: string,
  semanticValue: string
): string[] | string {
  const normalizedValue = semanticValue.toLowerCase().trim();
  const mapping = SEMANTIC_MAPPINGS[entity]?.[field]?.[normalizedValue];

  if (mapping) {
    return mapping;
  }

  // No semantic mapping found - return the original value
  // This allows literal DB values to pass through unchanged
  return semanticValue;
}

/**
 * Check if a value is a semantic term (has a mapping).
 */
export function isSemanticTerm(
  entity: string,
  field: string,
  value: string
): boolean {
  const normalizedValue = value.toLowerCase().trim();
  return !!SEMANTIC_MAPPINGS[entity]?.[field]?.[normalizedValue];
}

/**
 * Get all semantic terms for a field.
 * Useful for generating prompt hints.
 */
export function getSemanticTerms(entity: string, field: string): string[] {
  const fieldMappings = SEMANTIC_MAPPINGS[entity]?.[field];
  if (!fieldMappings) return [];
  return Object.keys(fieldMappings);
}

/**
 * Resolve all semantic filters in a filters object.
 * Looks for keys ending in '_semantic' and resolves them.
 *
 * @example
 * resolveAllSemanticFilters('invoices', { status_semantic: 'pending', contact_id: '123' })
 * // Returns: { status: ['sent', 'overdue'], contact_id: '123' }
 */
export function resolveAllSemanticFilters(
  entity: string,
  filters: Record<string, unknown>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(filters)) {
    if (key.endsWith('_semantic') && typeof value === 'string') {
      // This is a semantic filter - resolve it
      const actualField = key.replace('_semantic', '');
      const actualValues = resolveSemanticFilter(entity, actualField, value);
      resolved[actualField] = actualValues;
    } else {
      // Not a semantic filter - pass through unchanged
      resolved[key] = value;
    }
  }

  return resolved;
}

// =============================================================================
// Prompt Generation Helpers
// =============================================================================

/**
 * Generate the semantic filter instruction for LLM prompts.
 * This is a compact, language-agnostic instruction.
 */
export function generateSemanticFilterInstruction(): string {
  return `## Semantic Filters

When filtering by status or similar fields, use semantic terms with the "_semantic" suffix.
The system will resolve these to actual database values.

Examples:
- { "status_semantic": "pending" } → resolves to sent/overdue invoices, open tasks, etc.
- { "status_semantic": "done" } → resolves to completed/paid items
- { "status_semantic": "cancelled" } → resolves to cancelled items
- { "priority_semantic": "high" } → resolves to high/urgent priority

DO NOT hardcode specific status values like "sent" or "in_progress".
Use semantic terms: pending, done, cancelled, active, etc.

The LLM understands synonyms in any language - just output the canonical semantic term.`;
}

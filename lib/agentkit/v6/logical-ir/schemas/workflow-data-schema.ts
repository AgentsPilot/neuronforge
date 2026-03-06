/**
 * Workflow Data Schema Types
 *
 * Centralized, field-level type declarations for all data flowing through a workflow.
 * Declared once (Phase 3), validated (Phase 4), enforced (runtime).
 *
 * Replaces the flat VariableDefinition system with recursive, field-level schemas
 * that enable compile-time validation of cross-step data references.
 *
 * @see docs/v6/V6_WORKFLOW_DATA_SCHEMA_DESIGN.md
 */

/**
 * Scalar types a schema field can hold.
 */
export type SchemaFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array'
  | 'any';

/**
 * A single field within an object schema.
 * Recursive: an object field's `properties` contains more SchemaField entries.
 *
 * @example Object with nested array
 * {
 *   type: 'object',
 *   properties: {
 *     emails: {
 *       type: 'array',
 *       items: {
 *         type: 'object',
 *         properties: {
 *           id: { type: 'string' },
 *           subject: { type: 'string' }
 *         }
 *       }
 *     },
 *     total_found: { type: 'number' }
 *   },
 *   source: 'plugin'
 * }
 */
export interface SchemaField {
  type: SchemaFieldType;
  description?: string;
  required?: boolean;

  /** Object fields — each key maps to a nested SchemaField */
  properties?: Record<string, SchemaField>;

  /** Array fields — schema of each array element */
  items?: SchemaField;

  /** Union fields (for conditional branches that produce different shapes) */
  oneOf?: SchemaField[];

  /** Origin tracking — how this schema was determined */
  source?: 'plugin' | 'ai_declared' | 'inferred' | 'user_input';
}

/**
 * A named entry in the workflow data schema.
 * This is the top-level data slot that steps read from and write to.
 *
 * @example Plugin action output slot
 * {
 *   schema: {
 *     type: 'object',
 *     properties: {
 *       emails: { type: 'array', items: { type: 'object', properties: { ... } } },
 *       total_found: { type: 'number' }
 *     },
 *     source: 'plugin'
 *   },
 *   scope: 'global',
 *   produced_by: 'fetch_emails'
 * }
 */
export interface DataSlot {
  /** Field-level schema describing the shape of this slot's data */
  schema: SchemaField;

  /** Visibility scope of this slot */
  scope: 'global' | 'loop' | 'branch';

  /** Node ID that writes to this slot */
  produced_by: string;

  /** Node IDs that read from this slot */
  consumed_by?: string[];
}

/**
 * The workflow-level data schema.
 * Every named data path is declared here.
 * Steps reference these names in {{...}} expressions.
 *
 * @example
 * {
 *   slots: {
 *     search_results: { schema: { ... }, scope: 'global', produced_by: 'fetch_emails' },
 *     current_email: { schema: { ... }, scope: 'loop', produced_by: 'loop_emails' },
 *     all_invoices: { schema: { ... }, scope: 'global', produced_by: 'loop_emails' }
 *   }
 * }
 */
export interface WorkflowDataSchema {
  slots: Record<string, DataSlot>;
}

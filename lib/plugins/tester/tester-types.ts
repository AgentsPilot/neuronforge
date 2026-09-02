// lib/plugins/tester/tester-types.ts
//
// Shared TypeScript types for the schema-driven Plugin API Tester (FR1-FR12).
// Pure type module — no React, no fetch, no plugin/action hardcoding (F5).
// The tester derives everything from the plugin definition schema at runtime.

/**
 * The per-action schema block returned by GET /api/plugins/action-schema.
 * This is a strict, metadata-only projection of the plugin definition — it never
 * carries user data, connections, or tokens (see the endpoint's metadata-only invariant).
 */
export interface ActionSchema {
  name: string;
  description?: string;
  parameters: JsonSchemaObject;
  required_params: string[];
  optional_params: string[];
  capability?: string;
  idempotent?: boolean;
  rules?: ActionRules;
  output_schema?: Record<string, unknown>;
}

/** JSON-Schema object node (the `parameters` block of an action). */
export interface JsonSchemaObject {
  type: 'object';
  required?: string[];
  properties: Record<string, JsonSchemaProperty>;
}

/** A single JSON-Schema property, including the platform's `x-` extensions. */
export interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  /** For nested object properties: names of required sub-fields. */
  required?: string[];
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  'x-dynamic-options'?: {
    source: string;
    description?: string;
    depends_on?: string[];
  };
}

/** Confirmation/limit rules attached to an action, keyed by rule name. */
export interface ActionRules {
  limits?: Record<string, RuleDefinition>;
  confirmations?: Record<string, RuleDefinition>;
}

export interface RuleDefinition {
  condition: string;
  action: 'block' | 'confirm' | 'warn';
  message: string;
}

/**
 * The control type the UI should render for a given form field.
 * The default form is 100% free-text/simple inputs — there is NO JSON editing.
 * Composite shapes are decomposed:
 *   - `object`        → a titled group of nested labeled inputs (flattened).
 *   - `object-array`  → an "add row / remove row" repeater of flattened item inputs.
 *   - `scalar-matrix` → a repeater of comma-separated rows (2-D array like Sheets values).
 */
export type FormControl =
  | 'text'
  | 'number'
  | 'boolean'
  | 'enum'
  | 'scalar-array'
  | 'object'
  | 'object-array'
  | 'scalar-matrix';

/**
 * A render-ready descriptor for one action parameter (or a nested leaf/group).
 * The UI renders purely from these — it never inspects raw JSON-Schema or references
 * plugin/action names (F5). Composite descriptors carry `children` (object) or
 * `itemFields` (object-array) so the renderer and the (re)assembler stay generic.
 */
export interface FormFieldDescriptor {
  name: string;
  /** Full path from the root parameter to this field (e.g. ['reminders','overrides']). */
  path: string[];
  control: FormControl;
  required: boolean;
  label: string;
  description?: string;
  enumValues?: string[];
  defaultValue?: unknown;
  min?: number;
  max?: number;
  /** True when the field carries x-dynamic-options — rendered as labeled free-text in v1 (D4). */
  isDynamicOption?: boolean;
  dynamicOptionSource?: string;
  /** For scalar-array / scalar-matrix: the item primitive type (string/number/boolean/integer). */
  itemType?: string;
  /** For `object`: the flattened child field descriptors. */
  children?: FormFieldDescriptor[];
  /** For `object-array`: the descriptor template for a single row's fields. */
  itemFields?: FormFieldDescriptor[];
}

/**
 * Result of the destructive-detection classifier (CR1).
 * `requiresConfirm` gates Run ONLY for presence-check (existence) confirm rules —
 * the genuinely destructive class. Numeric-threshold / boolean-equality confirms are
 * advisory and do NOT block.
 */
export interface ConfirmationDecision {
  /** Blocking confirm gate — true only for presence-check (destructive) confirms. */
  requiresConfirm: boolean;
  /** The authored confirm message to render, when requiresConfirm is true. */
  message?: string;
  /** Visual red-flag styling (capability delete OR idempotent === false), independent of the gate. */
  isDestructiveStyle: boolean;
  /** Non-blocking advisory notices (threshold/boolean confirms) surfaced without gating Run. */
  advisories: string[];
}

/** Per-plugin connection state for the gate panel. */
export interface PluginGateState {
  key: string;
  /** Genuinely connected with a valid token (runnable). */
  connected: boolean;
  /** Connected but the OAuth token is expired — needs reconnect/refresh (not runnable). */
  expired: boolean;
}

/** Outcome of the FR12 connection-completeness gate. */
export interface ConnectionGateResult {
  enabled: boolean;
  perPlugin: PluginGateState[];
  /** Required plugins that are not genuinely connected (includes expired ones). */
  missing: string[];
  /** Required plugins whose token is expired (subset of missing) — reconnect to fix. */
  expired: string[];
  /** True when userId is empty — gate short-circuits, no status fetch/run (FR11). */
  userIdRequired: boolean;
}

/** A single side-console entry (FR8). One per plugin API call. */
export interface ConsoleEntry {
  id: string;
  timestamp: string;
  userId: string;
  plugin: string;
  action: string;
  request: Record<string, unknown>;
  response: unknown;
  outcome: 'success' | 'error';
  durationMs: number;
}

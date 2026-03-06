// lib/types/plugin-types.ts

import type { Domain, Capability } from '../agentkit/v6/semantic-plan/types/intent-schema-types'

// Core plugin definition structure (loaded from JSON files)
export type PluginCategory = 
  | 'communication'
  | 'productivity'
  | 'crm'
  | 'marketing'
  | 'project'
  | 'finance'
  | 'integration'
  | 'ai'
  | 'other';

// Input template types (from pluginRegistry.ts)
export interface InputTemplate {
  name: string;
  type: string;
  required: boolean;
  placeholder?: string;
  description: string;
  enum?: string[];
  runtime_populated?: boolean;
  sandboxFetch?: string;
  dependsOn?: string;
}

export interface OutputTemplate {
  type: string;
  description: string;
  schema?: Record<string, any>;
}

export interface PluginDefinition {
  plugin: {
    name: string;
    displayName?: string; // Optional friendly name
    label?: string; // Optional label for backward compatibility
    version: string;
    description: string;
    context: string;
    icon?: React.ReactNode;
    category: PluginCategory;  // Optional category for grouping
    isPopular?: boolean; // Optional flag for popular plugins
    isSystem?: boolean; // Optional flag for system plugins (no user OAuth required)
    auth_config: PluginAuthConfig;

    // ----- V6 CAPABILITY BINDING METADATA -----
    /**
     * Provider family identifier for capability binding preferences.
     * REQUIRED: Enables CapabilityUse.preferences.provider_family matching.
     * Examples: "google", "microsoft", "slack", "hubspot", "airtable"
     */
    provider_family?: string; // TODO: Make required after all plugins updated
  };
  actions: Record<string, ActionDefinition>;
}

// Extended plugin definition that includes fields from pluginRegistry.ts
export interface IPluginDefinitionContext extends PluginDefinition {
  key: string;
  label: string;
  displayName: string;
  icon?: string;
  category: string;
  capabilities: string[];
  usage: ('input' | 'output' | 'both')[];
  requiresMapping: boolean;

  // Input/Output templates for agent generation
  inputTemplates?: {
    [capability: string]: InputTemplate[];
  };
  outputTemplates?: {
    [capability: string]: OutputTemplate;
  };
}

// Core plugin definition structure and user connection details in a single object
export interface ActionablePlugin {
  definition: PluginDefinition;
  connection: UserConnection;
}

// OAuth/Authentication configuration
export interface PluginAuthConfig {
  auth_type: string;
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  auth_url: string;
  token_url: string;
  refresh_url: string;
  required_scopes: string[];
  profile_url?: string;
  user_scopes?: string[]; // For providers like Slack that separate bot and user scopes
  requires_pkce?: boolean; // Indicates if plugin requires PKCE for OAuth
  token_expiry_seconds?: number; // Token expiration time in seconds
}

// JSON Schema for action output structure (machine-readable)
export interface ActionOutputSchema {
  type: string;
  properties?: Record<string, ActionOutputSchemaProperty>;
  items?: any;
  description?: string;
  required?: string[]; // Required fields in output
}

// Output schema property with extension fields
export interface ActionOutputSchemaProperty {
  type: string;
  description?: string;
  items?: any;
  properties?: Record<string, any>;

  // Extension: Indicates this field is ALWAYS present in output (never undefined/null)
  'x-guaranteed'?: boolean;
}

// Human-readable output guidance for LLM and runtime
export interface ActionOutputGuidance {
  success_description: string;
  sample_output?: any;
  common_errors: Record<string, string>;
}

// Extension: Variable mapping for parameter inputs
export interface VariableMapping {
  from_type: string; // Expected input type (e.g., "file_attachment", "folder")
  field_path: string; // Path to extract from input (e.g., "content", "id")
  description: string; // Description of the mapping
}

// Extension: Input mapping for parameters that accept multiple input types
export interface InputMapping {
  accepts: string[]; // Accepted input types (e.g., ["file_object", "url_string"])
  from_file_object?: string; // Field path if input is file object
  from_url?: string; // Field path if input is URL
  description: string; // Description of accepted inputs
}

// Extension: Context binding for parameters sourced from workflow config
export interface ContextBinding {
  source: 'workflow_config' | 'runtime_context'; // Where to get the value
  key: string; // Key in the source
  required: boolean; // Whether this binding is required
  default?: any; // Default value if not provided
  description: string; // Description of the binding
}

// Parameter schema property with extension fields
export interface ActionParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  default?: any;
  items?: any;
  properties?: Record<string, any>;
  required?: boolean;
  minimum?: number;
  maximum?: number;
  maxLength?: number;

  // Extension: How to map variable data to this parameter
  'x-variable-mapping'?: VariableMapping;

  // Extension: How to handle different input types for this parameter
  'x-input-mapping'?: InputMapping;

  // Extension: How to bind this parameter from workflow context
  'x-context-binding'?: ContextBinding;

  // Existing dynamic options support
  'x-dynamic-options'?: {
    source: string;
    description: string;
    depends_on?: string[];
  };
}

// Action parameter schema
export interface ActionParameterSchema {
  type: 'object';
  required?: string[];
  properties: Record<string, ActionParameterProperty>;
}

// Individual action definition within a plugin
export interface ActionDefinition {
  description: string;
  usage_context: string;
  parameters: ActionParameterSchema; // JSON Schema object with extensions
  rules: ActionRuleDefinition;
  output_schema?: ActionOutputSchema; // Machine-readable JSON Schema for output
  output_guidance: ActionOutputGuidance; // Human-readable guidance
  idempotent?: boolean; // Whether the action is idempotent (can be safely retried)
  idempotent_alternative?: string; // Alternative idempotent action if this one is not

  // ----- V6 CAPABILITY BINDING METADATA (Phase 1) -----
  // These fields enable deterministic capability binding without hardcoded plugin logic.
  // EVERY action MUST declare domain and capability for Generic Intent V1 binding to work.

  /**
   * Semantic domain this action operates in.
   * REQUIRED: Must match Domain enum from intent-schema-types.ts exactly.
   * Examples: "email", "storage", "table", "crm", "messaging"
   */
  domain?: Domain; // TODO: Make required after all plugins updated

  /**
   * Semantic capability this action provides.
   * REQUIRED: Must match Capability enum from intent-schema-types.ts exactly.
   * Examples: "search", "create", "update", "send_message", "extract_structured_data"
   */
  capability?: Capability; // TODO: Make required after all plugins updated

  /**
   * Entity type this action operates on (input).
   * null if the action doesn't require an existing entity as input.
   * Examples: "email", "file", "folder", "row", "contact"
   */
  input_entity?: string | null;

  /**
   * Entity type this action produces (output).
   * Examples: "email", "file", "folder", "row", "contact"
   */
  output_entity?: string;

  /**
   * Input cardinality: does this action operate on a single item or collection?
   * null if no input entity required.
   */
  input_cardinality?: "single" | "collection" | null;

  /**
   * Output cardinality: does this action produce a single item or collection?
   */
  output_cardinality?: "single" | "collection";

  /**
   * List of output field names this action GUARANTEES to return.
   * Used by compiler to validate downstream field references without runtime guessing.
   * Examples: ["id", "sender", "subject", "body", "date"] for search_emails
   */
  output_fields?: string[];

  /**
   * Required parameter names (must be provided for action to succeed).
   * Extracted from parameters schema for explicit validation.
   */
  required_params?: string[];

  /**
   * Optional parameter names (can be provided but not required).
   * Extracted from parameters schema for explicit validation.
   */
  optional_params?: string[];

  /**
   * Capability flags this action supports (for filtering).
   * Used in CapabilityUse.preferences.must_support matching.
   * Examples: ["unread_filter", "attachment_metadata", "html_email"]
   */
  must_support?: string[];
}

// Action Rule definitions structure
export interface ActionRuleDefinition {
  limits?: Record<string, RuleDefinition>;
  confirmations?: Record<string, RuleDefinition>;
}

// Rule definition for validation
export interface RuleDefinition {
  condition: string;
  action: 'block' | 'confirm' | 'warn';
  message: string;
}

// Validation result structure
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  confirmations_required: string[];
  blocked: boolean;
  block_reason?: string;
}

// User connection data (database record)
export interface UserConnection {
  user_id: string;
  plugin_key: string;
  plugin_name: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null; // Nullable for system plugins that don't expire
  status: string;
  connected_at: string;
  username?: string;
  email?: string | null; // Nullable for system plugins
  profile_data?: any;
  scope?: string | null; // Nullable for system plugins
  settings?: any;
  last_used?: string;
  updated_at?: string;
  last_refreshed_at?: string; // Track when token was last refreshed for rate limiting
  id?: string; // Optional ID field for database records
}

// Connection status information
export interface ConnectionStatus {
  connected: boolean;
  reason: 'connected' | 'not_connected' | 'token_expired' | 'connection_error';
  expires_at?: string;
}

// Plugin information for client consumption (API response format)
export interface PluginInfo {
  key: string;
  name: string;
  description: string;
  context: string;
  version: string;
  auth_type: string;
  auth_config: PluginAuthConfig;
  actions: string[];
  action_count: number;
  isSystem?: boolean; // Flag for system plugins (no user OAuth required)
}

export interface ConnectedPluginInfo extends PluginInfo {
  username?: string;
  email?: string;
  last_used?: string;
  connected_at?: string;
}

// User plugin status (API response format)
export interface UserPluginStatus {
  connected: ConnectedPluginInfo[];  // ← Changed from PluginInfo[]
  active_expired: string[];  // Plugin keys with expired tokens that can be refreshed
  disconnected: (PluginInfo & {
    status: string;
    reason: string;
    auth_url: string;
  })[];
  summary: {
    connected_count: number;
    active_expired_count: number;
    disconnected_count: number;
    total_available: number;
  };
}

// LLM context structure
export interface LLMContext {
  connected_plugins: Record<string, {
    name: string;
    description: string;
    context: string;
    status: string;
    actions: Record<string, {
      description: string;
      usage_context: string;
      parameters: any;
    }>;
  }>;
  available_plugins: Record<string, {
    name: string;
    description: string;
    reason: string;
    auth_url: string;
    message: string;
  }>;
  summary: {
    connected_count: number;
    disconnected_count: number;
    total_available: number;
  };
}

// Plugin action execution result
export interface ExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  message?: string;
}

// OAuth flow result
export interface OAuthResult {
  success: boolean;
  data?: any;
  error?: string;
}

// API response wrapper
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Plugin action parameter types (for common use cases)
export interface EmailParameters {
  recipients: {
    to: string[];
    cc?: string[];
    bcc?: string[];
  };
  content: {
    subject: string;
    body?: string;
    html_body?: string;
  };
  options?: {
    send_immediately?: boolean;
    request_read_receipt?: boolean;
  };
}

export interface SearchParameters {
  query: string;
  max_results?: number;
  include_attachments?: boolean;
  folder?: string;
}

// Common error types
export type PluginErrorType =
  | 'auth_failed'
  | 'quota_exceeded'
  | 'invalid_recipient'
  | 'attachment_too_large'
  | 'api_rate_limit'
  | 'insufficient_permissions'
  | 'invalid_query'
  | 'no_results'
  | 'connection_error'
  | 'execution_error'
  | 'validation_error';

// ============================================================================
// V6 ENHANCED PLUGIN METADATA - EXAMPLE
// ============================================================================
//
// This example shows the complete structure for an enhanced action definition
// with all V6 capability binding metadata fields.
//
// BEFORE (insufficient metadata):
// ---------------------------------
// {
//   "search_emails": {
//     "description": "Search for emails in the user's Gmail account",
//     "usage_context": "When user wants to find specific emails...",
//     "parameters": { ... },
//     "rules": { ... },
//     "output_guidance": { ... }
//   }
// }
//
// AFTER (complete metadata for deterministic binding):
// -----------------------------------------------------
// {
//   "search_emails": {
//     "description": "Search for emails in the user's Gmail account",
//     "usage_context": "When user wants to find specific emails...",
//     "parameters": { ... },
//     "rules": { ... },
//     "output_guidance": { ... },
//
//     // === V6 CAPABILITY BINDING METADATA ===
//     "domain": "email",                    // Semantic domain (REQUIRED)
//     "capability": "search",               // Semantic capability (REQUIRED)
//     "input_entity": null,                 // No input entity required
//     "output_entity": "email",             // Produces email entities
//     "input_cardinality": null,            // No input collection
//     "output_cardinality": "collection",   // Returns collection of emails
//     "output_fields": [                    // GUARANTEED output fields
//       "id",
//       "sender",
//       "subject",
//       "body",
//       "date",
//       "is_unread",
//       "has_attachments"
//     ],
//     "required_params": [],                // No required params
//     "optional_params": [                  // All params are optional
//       "query",
//       "max_results",
//       "include_spam_trash"
//     ],
//     "must_support": [                     // Capability flags
//       "unread_filter",
//       "attachment_metadata",
//       "html_email"
//     ]
//   }
// }
//
// WHY THIS MATTERS:
// -----------------
// With this metadata, the CapabilityBinder can deterministically match:
//
// 1. Domain + Capability matching:
//    IntentContract step says: uses: [{ domain: "email", capability: "search" }]
//    Binder finds: search_emails because domain="email" AND capability="search"
//
// 2. Provider preference filtering:
//    IntentContract says: preferences: { provider_family: "google" }
//    Binder prefers: gmail plugin because plugin.provider_family = "google"
//
// 3. Must-support filtering:
//    IntentContract says: must_support: ["attachment_metadata"]
//    Binder filters: only actions with "attachment_metadata" in must_support array
//
// 4. Entity contract validation:
//    Compiler validates: output_entity matches next step's input_entity
//    Compiler validates: output_cardinality matches next step's expectations
//
// 5. Field guarantee validation:
//    Compiler validates: downstream refs to email.subject are safe
//    Because "subject" is in output_fields array
//
// 6. Parameter validation:
//    Compiler validates: all required_params are provided
//    Compiler suggests: optional_params that might improve results
//
// ============================================================================
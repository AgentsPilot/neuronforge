// lib/types/plugin-types.ts

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

export interface PluginDefinition {
  plugin: {
    name: string;
    DisplayName?: string; // Optional friendly name
    Label?: string; // Optional label for backward compatibility
    version: string;
    description: string;
    context: string;
    icon: React.ReactNode;
    category?: PluginCategory;  // Optional category for grouping
    isPopular?: boolean; // Optional flag for popular plugins    
    auth_config: PluginAuthConfig;
  };
  actions: Record<string, ActionDefinition>;
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
}

// Individual action definition within a plugin
export interface ActionDefinition {
  description: string;
  usage_context: string;
  parameters: any; // JSON Schema object
  rules: ActionRuleDefinition;
  output_guidance: {
    success_message: string;
    common_errors: Record<string, string>;
  };
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
  expires_at: string;
  status: string;
  connected_at: string;
  username?: string;
  email?: string;
  profile_data?: any;
  scope?: string;
  settings?: any;
  last_used?: string;
  updated_at?: string;
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
  disconnected: (PluginInfo & {
    status: string;
    reason: string;
    auth_url: string;
  })[];
  summary: {
    connected_count: number;
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
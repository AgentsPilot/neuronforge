// /lib/audit/events.ts
// Centralized registry of all auditable events
// Add new event types here as needed - zero code changes elsewhere

import { AuditSeverity, ComplianceFlag } from './types';

/**
 * Event metadata defining how each event should be logged
 */
interface EventMetadata {
  severity: AuditSeverity;
  complianceFlags?: ComplianceFlag[];
  description: string;
}

/**
 * All auditable events in the system
 * Organized by category for maintainability
 */
export const AUDIT_EVENTS = {
  // ==========================================
  // AGENT EVENTS
  // ==========================================
  AGENT_CREATED: 'AGENT_CREATED',
  AGENT_UPDATED: 'AGENT_UPDATED',
  AGENT_DELETED: 'AGENT_DELETED',
  AGENT_ARCHIVED: 'AGENT_ARCHIVED',
  AGENT_RESTORED: 'AGENT_RESTORED',
  AGENT_STATUS_CHANGED: 'AGENT_STATUS_CHANGED', // draft → active, etc.
  AGENT_SCHEDULE_CHANGED: 'AGENT_SCHEDULE_CHANGED', // cron/timezone updates
  AGENT_MODE_CHANGED: 'AGENT_MODE_CHANGED', // instant ↔ scheduled
  AGENT_RUN_STARTED: 'AGENT_RUN_STARTED',
  AGENT_RUN_COMPLETED: 'AGENT_RUN_COMPLETED',
  AGENT_RUN_FAILED: 'AGENT_RUN_FAILED',
  AGENT_SCHEMA_UPDATED: 'AGENT_SCHEMA_UPDATED', // input/output schema changes

  // Agent Generation events
  AGENT_GENERATION_STARTED: 'AGENT_GENERATION_STARTED',
  AGENT_GENERATION_COMPLETED: 'AGENT_GENERATION_COMPLETED',
  AGENT_GENERATION_FAILED: 'AGENT_GENERATION_FAILED',

  // AgentKit-specific events
  AGENTKIT_EXECUTION_STARTED: 'AGENTKIT_EXECUTION_STARTED',
  AGENTKIT_EXECUTION_COMPLETED: 'AGENTKIT_EXECUTION_COMPLETED',
  AGENTKIT_EXECUTION_FAILED: 'AGENTKIT_EXECUTION_FAILED',
  AGENTKIT_PLUGIN_CALLED: 'AGENTKIT_PLUGIN_CALLED',
  AGENTKIT_PLUGIN_SUCCESS: 'AGENTKIT_PLUGIN_SUCCESS',
  AGENTKIT_PLUGIN_FAILED: 'AGENTKIT_PLUGIN_FAILED',
  AGENTKIT_ITERATION_COMPLETED: 'AGENTKIT_ITERATION_COMPLETED',
  AGENTKIT_MAX_ITERATIONS_REACHED: 'AGENTKIT_MAX_ITERATIONS_REACHED',

  // AI Model Routing events
  MODEL_ROUTING_DECISION: 'MODEL_ROUTING_DECISION',

  // ==========================================
  // USER / PROFILE EVENTS
  // ==========================================
  USER_CREATED: 'USER_CREATED',
  USER_LOGIN: 'USER_LOGIN',
  USER_LOGOUT: 'USER_LOGOUT',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_PASSWORD_CHANGED: 'USER_PASSWORD_CHANGED',
  USER_EMAIL_CHANGED: 'USER_EMAIL_CHANGED',
  USER_TERMINATED: 'USER_TERMINATED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_REACTIVATED: 'USER_REACTIVATED',
  USER_ONBOARDING_COMPLETED: 'USER_ONBOARDING_COMPLETED',
  USER_ONBOARDING_FAILED: 'USER_ONBOARDING_FAILED',

  PROFILE_UPDATED: 'PROFILE_UPDATED', // name, avatar, company, etc.
  PROFILE_VIEWED: 'PROFILE_VIEWED', // Who viewed whose profile

  // ==========================================
  // SETTINGS EVENTS (Phase 1 focus)
  // ==========================================
  SETTINGS_PROFILE_UPDATED: 'SETTINGS_PROFILE_UPDATED',
  SETTINGS_PREFERENCES_UPDATED: 'SETTINGS_PREFERENCES_UPDATED',
  SETTINGS_NOTIFICATIONS_UPDATED: 'SETTINGS_NOTIFICATIONS_UPDATED',
  SETTINGS_SECURITY_UPDATED: 'SETTINGS_SECURITY_UPDATED',
  SETTINGS_API_KEY_CREATED: 'SETTINGS_API_KEY_CREATED',
  SETTINGS_API_KEY_REVOKED: 'SETTINGS_API_KEY_REVOKED',
  SETTINGS_2FA_ENABLED: 'SETTINGS_2FA_ENABLED',
  SETTINGS_2FA_DISABLED: 'SETTINGS_2FA_DISABLED',

  // ==========================================
  // PLUGIN / CONNECTION EVENTS
  // ==========================================
  PLUGIN_CONNECTED: 'PLUGIN_CONNECTED',
  PLUGIN_DISCONNECTED: 'PLUGIN_DISCONNECTED',
  PLUGIN_RECONNECTED: 'PLUGIN_RECONNECTED',
  PLUGIN_AUTH_FAILED: 'PLUGIN_AUTH_FAILED',
  PLUGIN_PERMISSION_GRANTED: 'PLUGIN_PERMISSION_GRANTED',
  PLUGIN_PERMISSION_REVOKED: 'PLUGIN_PERMISSION_REVOKED',

  // ==========================================
  // DATA EVENTS (GDPR compliance)
  // ==========================================
  DATA_EXPORTED: 'DATA_EXPORTED', // User data export
  DATA_DELETED: 'DATA_DELETED', // Right to erasure
  DATA_ANONYMIZED: 'DATA_ANONYMIZED', // PII anonymization
  DATA_ACCESSED: 'DATA_ACCESSED', // Who accessed what data
  CONSENT_GRANTED: 'CONSENT_GRANTED',
  CONSENT_REVOKED: 'CONSENT_REVOKED',

  // ==========================================
  // ADMIN / SYSTEM EVENTS
  // ==========================================
  ADMIN_ACTION: 'ADMIN_ACTION',
  ADMIN_IMPERSONATION_STARTED: 'ADMIN_IMPERSONATION_STARTED',
  ADMIN_IMPERSONATION_ENDED: 'ADMIN_IMPERSONATION_ENDED',
  SYSTEM_CONFIG_CHANGED: 'SYSTEM_CONFIG_CHANGED',
  SYSTEM_MAINTENANCE_STARTED: 'SYSTEM_MAINTENANCE_STARTED',
  SYSTEM_MAINTENANCE_ENDED: 'SYSTEM_MAINTENANCE_ENDED',

  // ==========================================
  // AIS (AGENT INTENSITY SYSTEM) EVENTS
  // ==========================================
  AIS_SCORE_CALCULATED: 'AIS_SCORE_CALCULATED', // Initial calculation
  AIS_SCORE_UPDATED: 'AIS_SCORE_UPDATED', // Score changed due to new executions
  AIS_SCORE_RECALCULATED: 'AIS_SCORE_RECALCULATED', // Manual refresh
  AIS_NORMALIZATION_REFRESH_STARTED: 'AIS_NORMALIZATION_REFRESH_STARTED', // Admin updates ranges
  AIS_NORMALIZATION_REFRESH_COMPLETED: 'AIS_NORMALIZATION_REFRESH_COMPLETED', // Ranges updated
  AIS_SCORES_BULK_RECALCULATED: 'AIS_SCORES_BULK_RECALCULATED', // All agents recalculated
  AIS_MODE_SWITCHED: 'AIS_MODE_SWITCHED', // Switched between best_practice/dynamic mode
  AIS_THRESHOLD_UPDATED: 'AIS_THRESHOLD_UPDATED', // Min executions threshold changed

  // ==========================================
  // REWARD CONFIGURATION EVENTS
  // ==========================================
  REWARD_CONFIG_CREATED: 'REWARD_CONFIG_CREATED',
  REWARD_CONFIG_UPDATED: 'REWARD_CONFIG_UPDATED',
  REWARD_CONFIG_DELETED: 'REWARD_CONFIG_DELETED',
  REWARD_CONFIG_TOGGLED: 'REWARD_CONFIG_TOGGLED', // Active/inactive toggle

  // ==========================================
  // SYSTEM CONFIGURATION EVENTS
  // ==========================================
  ROUTING_CONFIG_UPDATED: 'ROUTING_CONFIG_UPDATED', // Intelligent routing settings
  AI_PRICING_CREATED: 'AI_PRICING_CREATED',
  AI_PRICING_UPDATED: 'AI_PRICING_UPDATED',
  AI_PRICING_DELETED: 'AI_PRICING_DELETED',
  AI_PRICING_SYNCED: 'AI_PRICING_SYNCED', // Synced from external source

  // ==========================================
  // SECURITY EVENTS
  // ==========================================
  SECURITY_BREACH_DETECTED: 'SECURITY_BREACH_DETECTED',
  SECURITY_ANOMALY_DETECTED: 'SECURITY_ANOMALY_DETECTED',
  SECURITY_RATE_LIMIT_EXCEEDED: 'SECURITY_RATE_LIMIT_EXCEEDED',
  SECURITY_UNAUTHORIZED_ACCESS: 'SECURITY_UNAUTHORIZED_ACCESS',
} as const;

// Type-safe event names
export type AuditEvent = typeof AUDIT_EVENTS[keyof typeof AUDIT_EVENTS];

/**
 * Metadata for each event type
 * Defines default severity and compliance requirements
 */
export const EVENT_METADATA: Record<string, EventMetadata> = {
  // Agent events - mostly info
  [AUDIT_EVENTS.AGENT_CREATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'New agent created',
  },
  [AUDIT_EVENTS.AGENT_UPDATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Agent configuration updated',
  },
  [AUDIT_EVENTS.AGENT_DELETED]: {
    severity: 'critical',
    complianceFlags: ['SOC2', 'GDPR'],
    description: 'Agent permanently deleted',
  },
  [AUDIT_EVENTS.AGENT_SCHEDULE_CHANGED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Agent schedule modified',
  },
  [AUDIT_EVENTS.AGENT_RUN_STARTED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Agent execution started',
  },
  [AUDIT_EVENTS.AGENT_RUN_COMPLETED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Agent execution completed successfully',
  },
  [AUDIT_EVENTS.AGENT_RUN_FAILED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Agent execution failed',
  },

  // Agent Generation events
  [AUDIT_EVENTS.AGENT_GENERATION_STARTED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Agent generation process started',
  },
  [AUDIT_EVENTS.AGENT_GENERATION_COMPLETED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Agent generation completed successfully',
  },
  [AUDIT_EVENTS.AGENT_GENERATION_FAILED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Agent generation failed',
  },

  // AgentKit events
  [AUDIT_EVENTS.AGENTKIT_EXECUTION_STARTED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'AgentKit execution started',
  },
  [AUDIT_EVENTS.AGENTKIT_EXECUTION_COMPLETED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'AgentKit execution completed successfully',
  },
  [AUDIT_EVENTS.AGENTKIT_EXECUTION_FAILED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'AgentKit execution failed',
  },
  [AUDIT_EVENTS.AGENTKIT_PLUGIN_CALLED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'AgentKit called a plugin action',
  },
  [AUDIT_EVENTS.AGENTKIT_PLUGIN_SUCCESS]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'AgentKit plugin action succeeded',
  },
  [AUDIT_EVENTS.AGENTKIT_PLUGIN_FAILED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'AgentKit plugin action failed',
  },
  [AUDIT_EVENTS.AGENTKIT_ITERATION_COMPLETED]: {
    severity: 'info',
    description: 'AgentKit completed one iteration',
  },
  [AUDIT_EVENTS.AGENTKIT_MAX_ITERATIONS_REACHED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'AgentKit reached maximum iteration limit',
  },

  // User events - critical for security
  [AUDIT_EVENTS.USER_LOGIN]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'User logged in',
  },
  [AUDIT_EVENTS.USER_LOGIN_FAILED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Failed login attempt',
  },
  [AUDIT_EVENTS.USER_PASSWORD_CHANGED]: {
    severity: 'critical',
    complianceFlags: ['SOC2', 'GDPR'],
    description: 'User password changed',
  },
  [AUDIT_EVENTS.USER_EMAIL_CHANGED]: {
    severity: 'critical',
    complianceFlags: ['SOC2', 'GDPR'],
    description: 'User email address changed',
  },
  [AUDIT_EVENTS.USER_TERMINATED]: {
    severity: 'critical',
    complianceFlags: ['SOC2', 'GDPR'],
    description: 'User account terminated',
  },
  [AUDIT_EVENTS.USER_ONBOARDING_COMPLETED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'User completed onboarding process',
  },
  [AUDIT_EVENTS.USER_ONBOARDING_FAILED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'User failed to complete onboarding',
  },

  // Settings events - Phase 1 focus
  [AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED]: {
    severity: 'info',
    complianceFlags: ['GDPR'],
    description: 'User profile settings updated',
  },
  [AUDIT_EVENTS.SETTINGS_NOTIFICATIONS_UPDATED]: {
    severity: 'info',
    complianceFlags: ['GDPR'],
    description: 'Notification preferences updated',
  },
  [AUDIT_EVENTS.SETTINGS_SECURITY_UPDATED]: {
    severity: 'critical',
    complianceFlags: ['SOC2', 'GDPR'],
    description: 'Security settings modified',
  },
  [AUDIT_EVENTS.SETTINGS_API_KEY_CREATED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'New API key generated',
  },
  [AUDIT_EVENTS.SETTINGS_API_KEY_REVOKED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'API key revoked',
  },
  [AUDIT_EVENTS.SETTINGS_2FA_ENABLED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Two-factor authentication enabled',
  },
  [AUDIT_EVENTS.SETTINGS_2FA_DISABLED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'Two-factor authentication disabled',
  },

  // Plugin events
  [AUDIT_EVENTS.PLUGIN_CONNECTED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Plugin connected',
  },
  [AUDIT_EVENTS.PLUGIN_DISCONNECTED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Plugin disconnected',
  },

  // GDPR events - all critical
  [AUDIT_EVENTS.DATA_EXPORTED]: {
    severity: 'critical',
    complianceFlags: ['GDPR', 'SOC2'],
    description: 'User data exported (GDPR Article 20)',
  },
  [AUDIT_EVENTS.DATA_DELETED]: {
    severity: 'critical',
    complianceFlags: ['GDPR', 'SOC2'],
    description: 'User data deleted (GDPR Article 17)',
  },
  [AUDIT_EVENTS.DATA_ANONYMIZED]: {
    severity: 'critical',
    complianceFlags: ['GDPR'],
    description: 'Personal data anonymized',
  },
  [AUDIT_EVENTS.CONSENT_GRANTED]: {
    severity: 'info',
    complianceFlags: ['GDPR'],
    description: 'User consent granted',
  },
  [AUDIT_EVENTS.CONSENT_REVOKED]: {
    severity: 'warning',
    complianceFlags: ['GDPR'],
    description: 'User consent revoked',
  },

  // Admin events - all critical
  [AUDIT_EVENTS.ADMIN_IMPERSONATION_STARTED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'Admin started impersonating user',
  },
  [AUDIT_EVENTS.ADMIN_IMPERSONATION_ENDED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'Admin stopped impersonating user',
  },

  // Security events - all critical
  [AUDIT_EVENTS.SECURITY_BREACH_DETECTED]: {
    severity: 'critical',
    complianceFlags: ['SOC2', 'GDPR', 'HIPAA'],
    description: 'Security breach detected',
  },
  [AUDIT_EVENTS.SECURITY_ANOMALY_DETECTED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'Anomalous activity detected',
  },
  [AUDIT_EVENTS.SECURITY_UNAUTHORIZED_ACCESS]: {
    severity: 'critical',
    complianceFlags: ['SOC2', 'GDPR'],
    description: 'Unauthorized access attempt',
  },

  // AIS events
  [AUDIT_EVENTS.AIS_SCORE_CALCULATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Agent intensity score initially calculated',
  },
  [AUDIT_EVENTS.AIS_SCORE_UPDATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Agent intensity score updated after execution',
  },
  [AUDIT_EVENTS.AIS_SCORE_RECALCULATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Agent intensity score manually recalculated',
  },
  [AUDIT_EVENTS.AIS_NORMALIZATION_REFRESH_STARTED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'AIS normalization ranges refresh started',
  },
  [AUDIT_EVENTS.AIS_NORMALIZATION_REFRESH_COMPLETED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'AIS normalization ranges refresh completed',
  },
  [AUDIT_EVENTS.AIS_SCORES_BULK_RECALCULATED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'All agent intensity scores bulk recalculated',
  },
  [AUDIT_EVENTS.AIS_MODE_SWITCHED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'AIS mode switched between best_practice and dynamic',
  },
  [AUDIT_EVENTS.AIS_THRESHOLD_UPDATED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'AIS minimum executions threshold updated',
  },

  // Reward Config events
  [AUDIT_EVENTS.REWARD_CONFIG_CREATED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'New reward configuration created',
  },
  [AUDIT_EVENTS.REWARD_CONFIG_UPDATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Reward configuration updated',
  },
  [AUDIT_EVENTS.REWARD_CONFIG_DELETED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'Reward configuration deleted',
  },
  [AUDIT_EVENTS.REWARD_CONFIG_TOGGLED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Reward configuration active status toggled',
  },

  // System Config events
  [AUDIT_EVENTS.ROUTING_CONFIG_UPDATED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Intelligent routing configuration updated',
  },
  [AUDIT_EVENTS.AI_PRICING_CREATED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'AI model pricing created',
  },
  [AUDIT_EVENTS.AI_PRICING_UPDATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'AI model pricing updated',
  },
  [AUDIT_EVENTS.AI_PRICING_DELETED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'AI model pricing deleted',
  },
  [AUDIT_EVENTS.AI_PRICING_SYNCED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'AI model pricing synced from external source',
  },
};

/**
 * Get metadata for an event
 * Returns default metadata if event not found
 */
export function getEventMetadata(event: string): EventMetadata {
  return EVENT_METADATA[event] || {
    severity: 'info',
    description: `Unknown event: ${event}`,
  };
}

/**
 * Check if an event requires specific compliance tracking
 */
export function requiresCompliance(event: string, flag: ComplianceFlag): boolean {
  const metadata = EVENT_METADATA[event];
  return metadata?.complianceFlags?.includes(flag) || false;
}

/**
 * Get all events for a specific compliance framework
 */
export function getEventsByCompliance(flag: ComplianceFlag): string[] {
  return Object.entries(EVENT_METADATA)
    .filter(([_, metadata]) => metadata.complianceFlags?.includes(flag))
    .map(([event]) => event);
}

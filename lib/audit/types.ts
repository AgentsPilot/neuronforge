// /lib/audit/types.ts
// TypeScript types for enterprise audit trail system

import { NextRequest } from 'next/server';

/**
 * Severity levels for audit events
 * - info: Regular operations (reads, routine updates)
 * - warning: Potentially concerning actions (multiple failed logins)
 * - critical: Security-sensitive operations (deletions, permission changes)
 */
export type AuditSeverity = 'info' | 'warning' | 'critical';

/**
 * Entity types that can be audited
 */
export type EntityType =
  | 'agent'
  | 'user'
  | 'plugin'
  | 'settings'
  | 'profile'
  | 'connection'
  | 'execution'
  | 'system';

/**
 * Compliance frameworks this event relates to
 */
export type ComplianceFlag = 'GDPR' | 'SOC2' | 'HIPAA' | 'ISO27001' | 'CCPA';

/**
 * Change record for UPDATE operations
 * Captures before/after state for specific fields
 */
export interface FieldChange<T = any> {
  from: T;
  to: T;
  field?: string; // Field name for clarity
}

/**
 * Array change record (for fields like plugins, tags, etc.)
 */
export interface ArrayChange<T = any> {
  added?: T[];
  removed?: T[];
  unchanged?: T[];
}

/**
 * Complete change set for an entity update
 */
export interface ChangeSet {
  [fieldName: string]: FieldChange | ArrayChange | any;
}

/**
 * Core audit log entry matching Supabase schema
 */
export interface AuditLogEntry {
  id?: string; // Auto-generated UUID
  user_id: string | null; // User who performed the action (null for system events)
  actor_id?: string | null; // Who actually did it (for impersonation/admin actions)
  action: string; // Event type from AUDIT_EVENTS
  entity_type: EntityType;
  entity_id: string | null; // ID of the affected resource
  resource_name?: string | null; // Human-readable name (e.g., "Email Bot")
  changes?: ChangeSet | null; // Before/after diff for updates
  details?: Record<string, any> | null; // Additional context
  ip_address?: string | null;
  user_agent?: string | null;
  session_id?: string | null;
  severity?: AuditSeverity;
  compliance_flags?: ComplianceFlag[];
  created_at?: string; // ISO timestamp
  hash?: string | null; // For tamper detection
}

/**
 * Input for logging an audit event
 * Simplified API - service will enrich with context
 */
export interface AuditLogInput {
  action: string;
  entityType: EntityType;
  entityId?: string | null;
  userId?: string | null;
  actorId?: string | null; // Different from userId for admin actions
  resourceName?: string;
  changes?: ChangeSet;
  details?: Record<string, any>;
  severity?: AuditSeverity;
  complianceFlags?: ComplianceFlag[];
  request?: NextRequest; // Auto-extract IP, user-agent, session
}

/**
 * Query parameters for retrieving audit logs
 */
export interface AuditQueryParams {
  userId?: string;
  actorId?: string;
  action?: string | string[];
  entityType?: EntityType | EntityType[];
  entityId?: string;
  severity?: AuditSeverity | AuditSeverity[];
  complianceFlags?: ComplianceFlag[];
  dateFrom?: Date | string;
  dateTo?: Date | string;
  searchText?: string; // Full-text search in details/changes
  page?: number;
  limit?: number;
  sortBy?: 'created_at' | 'severity' | 'action';
  sortOrder?: 'asc' | 'desc';
}

/**
 * Paginated audit log response
 */
export interface AuditQueryResult {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * GDPR export format
 */
export interface GDPRExport {
  userId: string;
  exportedAt: string;
  totalEvents: number;
  dateRange: {
    from: string;
    to: string;
  };
  logs: AuditLogEntry[];
  summary: {
    actionsPerformed: Record<string, number>;
    entitiesModified: Record<EntityType, number>;
  };
}

/**
 * Retention policy configuration
 */
export interface RetentionPolicy {
  defaultDays: number; // Default retention for all logs
  criticalEventsDays?: number; // Extended retention for critical events
  gdprMaxDays?: number; // GDPR compliance limit
  autoAnonymizeDays?: number; // Auto-anonymize PII after X days
}

/**
 * Audit trail service configuration
 */
export interface AuditServiceConfig {
  enabled?: boolean; // Feature flag to disable audit trail
  batchSize?: number; // Number of logs to batch before writing
  batchIntervalMs?: number; // Max time to wait before flushing batch
  silent?: boolean; // Suppress all errors (never throw)
  retentionPolicy?: RetentionPolicy;
  enableTamperDetection?: boolean; // Cryptographic chaining
  enableCompression?: boolean; // Compress details/changes JSON
}

/**
 * Diff options for change detection
 */
export interface DiffOptions {
  ignoreFields?: string[]; // Fields to exclude from diff
  deepCompare?: boolean; // Deep object comparison
  arrayStrategy?: 'full' | 'diff'; // How to handle arrays
}

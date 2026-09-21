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
 * Entity types that can be audited.
 *
 * A runtime list, not only a type: the client write routes validate `entityType`
 * against it (Layer 3 step 0, FR-24), and the type is derived from it so the
 * two can never drift.
 */
export const AUDIT_ENTITY_TYPES = [
  'agent',
  'shared_agent',
  'user',
  'plugin',
  'settings',
  'profile',
  'connection',
  'execution',
  'system',
  'scheduling_service',
  'scheduling_booking',
  'payment_invoice',
  // A payment and a refund are audited against the transaction, which was not
  // in this union — so the refund route's audit entry, written at severity
  // `critical`, did not typecheck against the service it calls.
  'payment_transaction',
  // Stopping a client's payment plan changes what they will be charged, so it
  // is audited like money moving — and the plan is the entity it happened to.
  'payment_plan_subscription',
  // A milestone billed is a charge the client will see, and the stage is the
  // thing it happened to — the invoice it produces is audited separately, so
  // without this "when was milestone 2 billed" has no entity to hang off.
  'payment_plan_installment',
  // A quote is a commitment the business made to a client at a moment in time,
  // and what it later became. "What did we offer, and when" has to be
  // answerable independently of the invoice it produced.
  'proposal',
  'crm_contact',
  'business_profile',
  'website_page',
  // Publishing an intake decides what every future client is asked, so it is
  // audited against the form version that went live rather than against the
  // business — "which questions did we send in September" has to be answerable.
  'intake_form',
  // Subscription and boost-pack purchases. Written by the Stripe routes, which
  // used these values before the list was enforced; registered so their stored
  // rows stay exactly as they were (Layer 3 step 0, WC-12).
  'subscription',
  'boost_pack',
  // One Business OS AI action (Layer 3). The entity id is the action's usage
  // grouping id, so an entry links to its rows in token_usage. Server-written
  // only, and hidden from owners (lib/audit/requestSchemas.ts,
  // AuditTrailRepository).
  'ai_action',
  // AI model pricing rows. Written by the admin pricing helpers in
  // lib/audit/admin-helpers.ts, which have used this value since before the list
  // was enforced; registered so their stored rows stay exactly as they were, and
  // so AI_PRICING_ZERO_SET (Layer 2 Step 0) type-checks like its siblings.
  'ai_pricing',
] as const;

export type EntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * Compliance frameworks this event relates to
 */
export const COMPLIANCE_FLAGS = [
  'GDPR',
  'SOC2',
  'HIPAA',
  'ISO27001',
  'CCPA',
  // The Stripe routes have always stored 'FINANCIAL' on their subscription
  // events; it is kept so what they store does not change (Layer 3 step 0, WC-12).
  'FINANCIAL',
] as const;

export type ComplianceFlag = (typeof COMPLIANCE_FLAGS)[number];

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

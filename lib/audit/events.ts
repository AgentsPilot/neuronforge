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
  // Written live by app/api/run-agent/route.ts and stored in audit_trail, but
  // never registered here — so it was reachable only because the admin page
  // hardcoded it. Registered so the catalogue-driven filter (Gap A, FR-A3)
  // still offers it. Its metadata below is deliberately identical to the
  // getEventMetadata() fallback it has been written under (severity 'info', no
  // compliance flags), so already-stored rows and new ones stay the same (WC-12).
  AGENT_EXECUTED: 'AGENT_EXECUTED',
  AGENT_SCHEMA_UPDATED: 'AGENT_SCHEMA_UPDATED', // input/output schema changes
  AGENT_CONFIG_SAVED: 'AGENT_CONFIG_SAVED', // input values saved/updated
  EFFORT_ESTIMATE_GENERATED: 'EFFORT_ESTIMATE_GENERATED', // Effort Estimator wrote agent_config.roi_estimate
  AGENT_CALIBRATION_FIELD_CORRECTED: 'AGENT_CALIBRATION_FIELD_CORRECTED', // Item 7: calibration rewrote a wrong field name to the plugin's real spelling in place

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
  AGENTKIT_LOOP_DETECTED: 'AGENTKIT_LOOP_DETECTED',
  AGENTKIT_ITERATION_TOKEN_LIMIT_EXCEEDED: 'AGENTKIT_ITERATION_TOKEN_LIMIT_EXCEEDED',
  AGENTKIT_CIRCUIT_BREAKER_TRIGGERED: 'AGENTKIT_CIRCUIT_BREAKER_TRIGGERED',

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
  SETTINGS_CURRENCY_CHANGED: 'SETTINGS_CURRENCY_CHANGED',
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
  PLUGIN_TESTER_EXECUTE: 'PLUGIN_TESTER_EXECUTE', // A plugin action was run via the /test-plugins-v2 Form Tester
  PLUGIN_ACT_AS: 'PLUGIN_ACT_AS', // An admin invoked a plugin route on behalf of another user

  // ==========================================
  // DATA EVENTS (GDPR compliance)
  // ==========================================
  DATA_EXPORTED: 'DATA_EXPORTED', // User data export
  // The owner's own data download from the V2 security settings. Distinct from
  // DATA_EXPORTED, which is the server-side GDPR export.
  USER_DATA_EXPORTED: 'USER_DATA_EXPORTED',
  DATA_DELETED: 'DATA_DELETED', // Right to erasure
  DATA_ANONYMIZED: 'DATA_ANONYMIZED', // PII anonymization
  // Business OS purge (Reset / Purge of one business's data). Distinct from
  // DATA_DELETED: that is account-level erasure, whereas a business Reset
  // deliberately keeps the login, the profile and the configuration. Conflating
  // them would make an audit query for "erasure requests" return test resets.
  BUSINESS_DATA_PURGED: 'BUSINESS_DATA_PURGED',
  // Written for REFUSED runs too (FR-20, AC-18). A refused purge is the more
  // interesting event to have on record: it is the one where something was
  // wrong, and the one someone may later ask about.
  BUSINESS_DATA_PURGE_BLOCKED: 'BUSINESS_DATA_PURGE_BLOCKED',
  // Admin delete AD-1b: an admin opened the READ-ONLY deletion preview of one
  // business (POST /api/admin/users/[id]/deletion/preview). Nothing is deleted.
  // Entity type 'user', id = the TARGET account; written with the ADMIN's own id
  // as user_id and actor (the archive_run / bos_queue precedent), so it never
  // lands on the owner's account and the owner can never read it. The details
  // carry the outcome, the refusal ids and statuses and the correlation id;
  // never an email or a business name.
  BUSINESS_DELETION_PREVIEWED: 'BUSINESS_DELETION_PREVIEWED',
  // Admin delete AD-2a: the WRITE-AHEAD row, written (and CONFIRMED, via
  // AuditTrailService.writeNow) by the admin commit immediately before the
  // destructive RPC, after the second refusal evaluation passed. If it cannot
  // be confirmed, nothing is deleted. Same placement as the preview: the ADMIN
  // is user_id and actor, entity 'user' = the TARGET, so the owner never reads
  // it and it survives the target's erasure (SA T-1 option A, BQ-4).
  // ⚠️ STARTED WITHOUT A MATCHING BUSINESS_DATA_PURGED (same commit correlation
  // id) MUST NEVER BE READ AS "DELETED": the RPC may still have refused,
  // failed and rolled back, or the request may have died; a confirmed write
  // that timed out can also land late. Only BUSINESS_DATA_PURGED records a
  // completed deletion.
  BUSINESS_DELETION_STARTED: 'BUSINESS_DELETION_STARTED',
  // Business OS AI activity (Layer 3): one entry per AI action or background
  // job, summarising its LLM calls. Written by the server only; a browser can
  // never write one (lib/audit/requestSchemas.ts) and owners never read one
  // (AuditTrailRepository.listOwnerEntries). Entity type 'ai_action'.
  BUSINESS_AI_ACTION_COMPLETED: 'BUSINESS_AI_ACTION_COMPLETED',
  BUSINESS_AI_ACTION_FAILED: 'BUSINESS_AI_ACTION_FAILED',
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
  // BUSINESS OS ENTITLEMENTS (admin-only)
  // ==========================================
  // Every one of these is an admin changing what an account is entitled to, so
  // each carries the actor, the reason and the before/after plan row. They are
  // the only write path to the entitlement tables (workplan §4.12, WC-7).
  // Those written against an account (entity 'business_os_account_plan') are
  // hidden from that account's owner (BD-26, lib/audit/ownerVisibility.ts).
  BOS_ENTITLEMENT_PLAN_ROW_ENSURED: 'BOS_ENTITLEMENT_PLAN_ROW_ENSURED',
  BOS_ENTITLEMENT_COHORT_SET: 'BOS_ENTITLEMENT_COHORT_SET',
  BOS_ENTITLEMENT_EXPIRY_SET: 'BOS_ENTITLEMENT_EXPIRY_SET',
  BOS_ENTITLEMENT_TIER_ASSIGNED: 'BOS_ENTITLEMENT_TIER_ASSIGNED',
  BOS_ENTITLEMENT_OVERRIDE_ADDED: 'BOS_ENTITLEMENT_OVERRIDE_ADDED',
  BOS_ENTITLEMENT_OVERRIDE_ENDED: 'BOS_ENTITLEMENT_OVERRIDE_ENDED',
  // A-3: wipe and recreate the plan state. The entry carries the account's
  // before-state, including every override that was ENDED by the reset — M-2
  // makes the RPC end them (`ended_at`, `ended_by_admin_id`, `ended_reason`)
  // rather than delete any, so the rows are still there; this is the
  // before-state in one place rather than the last copy of it.
  BOS_ENTITLEMENT_PLAN_STATE_RESET: 'BOS_ENTITLEMENT_PLAN_STATE_RESET',
  // R2-1: the multi-account launch operation. Slice 1 ships the dry run.
  BOS_ENTITLEMENT_LAUNCH_DRY_RUN: 'BOS_ENTITLEMENT_LAUNCH_DRY_RUN',
  // Credit deduction slice 11b: an admin gave extra credits to an account, or
  // took credits back out of one of its credit lots. Entity type
  // 'business_os_credit_lot', id = the lot id. The details carry the reason, the
  // credits, the lot's source and the idempotency key; the changes carry the
  // account's extra credits before / after (read before the write, labelled
  // `extraCreditsBasis: 'read_before_write'`) and, for a reduction, the lot's
  // remaining before / after as the reversal function returned them under its
  // lock. A replay of the same request writes no entry (S11-CR-2): the lot or
  // draw row is itself the append-only record. Hidden from the account's owner
  // (BD-26, lib/audit/ownerVisibility.ts): the reason is internal.
  BOS_CREDIT_LOT_GRANTED: 'BOS_CREDIT_LOT_GRANTED',
  BOS_CREDIT_LOT_REDUCED: 'BOS_CREDIT_LOT_REDUCED',
  // Credit deduction slice 8b: a recorded AI charge took the account's shown
  // percentage of PLAN credits left from at or above the low line (10) to
  // below it. Written only by lib/business-os/credits/creditLowLine.ts, with
  // `logAndFlush`. Entity type 'business_os_credit_period', id = the account.
  // The details carry the period key and kind, the plan allowance, the shown
  // percentage before / after, the line and the crossing action's id, type and
  // trigger; never owner text, tokens or dollars. "Once per period" is derived,
  // not stored (KI-21, KI-22): count distinct (account, periodStart).
  BOS_CREDIT_LOW_LINE_CROSSED: 'BOS_CREDIT_LOW_LINE_CROSSED',

  // ==========================================
  // BUSINESS OS INVITES (admin-only, server-written)
  // ==========================================
  // Invite-only signup, Slice 0. Entity type 'business_os_invite', id = the
  // invite id. The details carry the grant, the expiry and the admin's reason,
  // never the token, its hash or the invited email (C-3). The durable record is
  // the invite row itself (issuer, timestamps, revoke reason); these entries are
  // the investigation trail on top of it.
  BOS_INVITE_CREATED: 'BOS_INVITE_CREATED',
  BOS_INVITE_REVOKED: 'BOS_INVITE_REVOKED',
  // Slice 1a (FR-8a): an invite was opened and its email already had an
  // account. Anonymous actor; written once per invite (the row's
  // `opened_by_existing_account_at` stamp decides). Nothing was burned or
  // changed, and no session was created.
  BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT: 'BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT',
  // Slice 1b: a champion signed up from an invite. REDEEMED and PLAN_PROVISIONED
  // are written together, after the finalise function succeeded (actor = the new
  // account). REFUSED is a terminal refusal (an email that already has an
  // account at account creation, or the code attempts used up). INCOMPLETE is a
  // signup that stopped halfway with its claim kept (FR-12a, SA D-2): its details
  // repeat the invite row's failure record, never an email, token, code or
  // password.
  BOS_INVITE_REDEEMED: 'BOS_INVITE_REDEEMED',
  BOS_INVITE_PLAN_PROVISIONED: 'BOS_INVITE_PLAN_PROVISIONED',
  BOS_INVITE_REDEMPTION_REFUSED: 'BOS_INVITE_REDEMPTION_REFUSED',
  BOS_INVITE_REDEMPTION_INCOMPLETE: 'BOS_INVITE_REDEMPTION_INCOMPLETE',
  // Slice 2a: the invitation email of a create. Actor = the admin (SA R-8).
  // SENT carries the provider and, from Resend, its message id; NOT_SENT the
  // reason class (`sender_not_configured` or `transport_failed`). Never the
  // invitee email, the link, the token, its hash or a provider's error text.
  BOS_INVITE_EMAIL_SENT: 'BOS_INVITE_EMAIL_SENT',
  BOS_INVITE_EMAIL_NOT_SENT: 'BOS_INVITE_EMAIL_NOT_SENT',
  // N-1: the issuer of an accepted invite (the champion, or the one admin who
  // issued it) was, or was not, emailed. A system event: no owner (userId and
  // actorId null, SA Q-4), so it appears in neither person's own audit view;
  // the recipient's account id, the status, the language and the reason class
  // are in the details. Never an email address of anyone.
  BOS_INVITE_INVITER_NOTIFIED: 'BOS_INVITE_INVITER_NOTIFIED',
  BOS_INVITE_INVITER_NOT_NOTIFIED: 'BOS_INVITE_INVITER_NOT_NOTIFIED',
  // Slice 5a (F5a-13): a champion's friend invites. Actor = the champion
  // account. CREATED carries the language; REVOKED nothing beyond the invite
  // id; REFUSED the reason class only (`own_email`, `allowance_reached`,
  // `daily_limit`, `already_invited`). `not_eligible` is logged, never audited
  // (Slice 5b, N-4: any signed-in account can trigger it). Never the friend's
  // email, the note, the link, the token or its hash. The email outcome reuses
  // BOS_INVITE_EMAIL_SENT / BOS_INVITE_EMAIL_NOT_SENT with the champion as actor.
  BOS_FRIEND_INVITE_CREATED: 'BOS_FRIEND_INVITE_CREATED',
  BOS_FRIEND_INVITE_REVOKED: 'BOS_FRIEND_INVITE_REVOKED',
  BOS_FRIEND_INVITE_REFUSED: 'BOS_FRIEND_INVITE_REFUSED',

  // ==========================================
  // BUSINESS OS QUEUES (admin-only, server-written)
  // ==========================================
  // ADMIN_BOS_CLEANUP slice 7d: an admin pressed "Drain now" on one Business OS
  // queue (POST /api/admin/jobs-queues/drain). Entity type 'bos_queue', id = the
  // queue id. Written BEFORE the drain runs (a write-ahead record, SA W7D-1), so
  // a drain the platform kills at its time limit is still on record; hence
  // "STARTED", not "DRAINED". The details carry exactly the admin's reason, the
  // queue and the correlation id. The outcome, counts and duration are in the
  // response and the server log under the same correlation id, never here.
  BOS_QUEUE_DRAIN_STARTED: 'BOS_QUEUE_DRAIN_STARTED',
  // ADMIN_BOS_CLEANUP slice 7b: an admin cancelled ONE queue item
  // (POST /api/admin/jobs-queues/items/action). Entity type 'bos_queue_item',
  // id = the queue row's own id; written against the item's ACCOUNT (user_id)
  // with the admin as actor, and classified 'operator' so the owner never reads
  // the admin's reason (SA OP-2 option 1, migration 20261035). Written only
  // AFTER the compare-and-set won (OP-1): a refused or lost cancel writes
  // nothing. The details carry exactly the reason, the queue, the action, the
  // correlation id and the due anchor; never content, error text or a name.
  BOS_QUEUE_ITEM_CANCELLED: 'BOS_QUEUE_ITEM_CANCELLED',
  // ADMIN_BOS_CLEANUP slice 7c: an admin put ONE failed queue item back to
  // pending for exactly one more send attempt (POST
  // /api/admin/jobs-queues/items/action, action 'retry'). Same entity type,
  // account and actor rules as the cancel above ('bos_queue_item', owner-hidden
  // by migration 20261035). Written only AFTER the compare-and-set won; the
  // send itself happens later, through the queue's own claim. changes.after
  // carries the reminder's next sending-hours time (null on other queues); the
  // details carry exactly the reason, queue, action, correlation id and due anchor.
  BOS_QUEUE_ITEM_RETRIED: 'BOS_QUEUE_ITEM_RETRIED',

  // ==========================================
  // ADMIN ARCHIVING (admin-only, server-written)
  // ==========================================
  // One entry when a run starts and one when it ends. A run that stops at its
  // time budget (`partial`) writes nothing: it has not ended, and Continue
  // finishes it (condition C-9f). Entity type 'archive_run', id = the run id.
  ARCHIVE_RUN_STARTED: 'ARCHIVE_RUN_STARTED',
  ARCHIVE_RUN_COMPLETED: 'ARCHIVE_RUN_COMPLETED',
  ARCHIVE_RUN_FAILED: 'ARCHIVE_RUN_FAILED',

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
  AI_PRICING_ZERO_SET: 'AI_PRICING_ZERO_SET', // A price was saved as $0 — usage of that model is billed at nothing

  // ==========================================
  // MEMORY SYSTEM EVENTS
  // ==========================================
  MEMORY_CREATED: 'MEMORY_CREATED', // New memory record saved
  MEMORY_SUMMARIZATION_STARTED: 'MEMORY_SUMMARIZATION_STARTED', // LLM summarization began
  MEMORY_SUMMARIZATION_COMPLETED: 'MEMORY_SUMMARIZATION_COMPLETED', // Summary saved
  MEMORY_SUMMARIZATION_FAILED: 'MEMORY_SUMMARIZATION_FAILED', // Summarization error
  MEMORY_INJECTED: 'MEMORY_INJECTED', // Memory context injected into execution
  MEMORY_EMBEDDING_GENERATED: 'MEMORY_EMBEDDING_GENERATED', // Vector embedding created
  MEMORY_CONSOLIDATED: 'MEMORY_CONSOLIDATED', // Multiple memories merged
  MEMORY_DELETED: 'MEMORY_DELETED', // Memory removed (retention policy)
  MEMORY_CONFIG_UPDATED: 'MEMORY_CONFIG_UPDATED', // Memory system config changed
  MEMORY_SENTIMENT_DETECTED: 'MEMORY_SENTIMENT_DETECTED', // Sentiment classification
  MEMORY_PATTERN_DETECTED: 'MEMORY_PATTERN_DETECTED', // Recurring pattern identified
  MEMORY_ALERT_TRIGGERED: 'MEMORY_ALERT_TRIGGERED', // Negative sentiment alert

  // User Memory Events (cross-agent preferences)
  USER_MEMORY_EXTRACTED: 'USER_MEMORY_EXTRACTED', // User preference extracted from conversation
  USER_MEMORY_SAVED: 'USER_MEMORY_SAVED', // User preference saved to database
  USER_MEMORY_UPDATED: 'USER_MEMORY_UPDATED', // User preference updated
  USER_MEMORY_INJECTED: 'USER_MEMORY_INJECTED', // User context injected into execution

  // ==========================================
  // WORKFLOW PILOT EVENTS
  // ==========================================
  PILOT_EXECUTION_STARTED: 'PILOT_EXECUTION_STARTED', // Workflow execution began
  PILOT_EXECUTION_COMPLETED: 'PILOT_EXECUTION_COMPLETED', // Workflow completed successfully
  PILOT_EXECUTION_FAILED: 'PILOT_EXECUTION_FAILED', // Workflow failed
  PILOT_EXECUTION_PAUSED: 'PILOT_EXECUTION_PAUSED', // Workflow paused
  PILOT_EXECUTION_RESUMED: 'PILOT_EXECUTION_RESUMED', // Workflow resumed
  PILOT_EXECUTION_CANCELLED: 'PILOT_EXECUTION_CANCELLED', // Workflow cancelled
  PILOT_STEP_EXECUTED: 'PILOT_STEP_EXECUTED', // Individual step executed
  PILOT_STEP_FAILED: 'PILOT_STEP_FAILED', // Individual step failed
  PILOT_STEP_RETRIED: 'PILOT_STEP_RETRIED', // Step retried after failure
  PILOT_DISABLED: 'PILOT_DISABLED', // Pilot disabled - execution blocked
  PILOT_CONFIG_UPDATED: 'PILOT_CONFIG_UPDATED', // Pilot settings changed
  PILOT_STRUCTURAL_REPAIR_APPLIED: 'PILOT_STRUCTURAL_REPAIR_APPLIED', // Pre-execution auto-repair fired — indicates a generator bug

  // Subscription and boost-pack billing (the Stripe routes)
  SUBSCRIPTION_CHECKOUT_INITIATED: 'SUBSCRIPTION_CHECKOUT_INITIATED',
  BOOST_PACK_CHECKOUT_INITIATED: 'BOOST_PACK_CHECKOUT_INITIATED',
  SUBSCRIPTION_CANCELED: 'SUBSCRIPTION_CANCELED',
  SUBSCRIPTION_REACTIVATED: 'SUBSCRIPTION_REACTIVATED',
  CUSTOMER_PORTAL_ACCESSED: 'CUSTOMER_PORTAL_ACCESSED',
  // One-time free-tier grant at onboarding (S-6 fix). Written only on an actual grant.
  FREE_TIER_ALLOCATED: 'FREE_TIER_ALLOCATED',

  // Business OS money
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  PAYMENT_BLOCK_EXECUTED: 'PAYMENT_BLOCK_EXECUTED',
  INVOICE_MARKED_PAID: 'INVOICE_MARKED_PAID',
  PAYMENT_PLAN_CANCELLED: 'PAYMENT_PLAN_CANCELLED',

  // Per-Step Intelligent Routing events
  PILOT_ROUTING_DECISION: 'PILOT_ROUTING_DECISION', // Model selected for step
  PILOT_ROUTING_ENABLED: 'PILOT_ROUTING_ENABLED', // Per-step routing enabled
  PILOT_ROUTING_DISABLED: 'PILOT_ROUTING_DISABLED', // Per-step routing disabled
  PILOT_ROUTING_CONFIG_UPDATED: 'PILOT_ROUTING_CONFIG_UPDATED', // Routing config changed

  // Workflow Generation events
  WORKFLOW_GENERATED: 'WORKFLOW_GENERATED', // Workflow generated successfully
  WORKFLOW_GENERATION_FALLBACK: 'WORKFLOW_GENERATION_FALLBACK', // Fallback to secondary orchestrator

  // Human-in-the-Loop Approval Events (Phase 6)
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED', // Approval request created
  APPROVAL_APPROVED: 'APPROVAL_APPROVED', // User approved request
  APPROVAL_REJECTED: 'APPROVAL_REJECTED', // User rejected request
  APPROVAL_TIMEOUT: 'APPROVAL_TIMEOUT', // Approval timed out
  APPROVAL_ESCALATED: 'APPROVAL_ESCALATED', // Approval escalated to higher authority
  APPROVAL_DELEGATED: 'APPROVAL_DELEGATED', // Approval delegated to another user

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
  [AUDIT_EVENTS.AGENT_CONFIG_SAVED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Agent input configuration saved or updated',
  },
  [AUDIT_EVENTS.EFFORT_ESTIMATE_GENERATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Effort Estimator generated/overwrote agent_config.roi_estimate',
  },
  [AUDIT_EVENTS.AGENT_CALIBRATION_FIELD_CORRECTED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Calibration rewrote a stored workflow field name to the plugin\'s real spelling (Item 7 in-place field-fidelity correction)',
  },
  [AUDIT_EVENTS.AGENT_EXECUTED]: {
    // No complianceFlags on purpose: this event has always been written through
    // the getEventMetadata() fallback (severity 'info', no flags), and metadata
    // is what decides both when the caller does not pass them.
    severity: 'info',
    description: 'Agent executed',
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
  [AUDIT_EVENTS.AGENTKIT_LOOP_DETECTED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'AgentKit detected infinite loop - execution stopped to prevent credit exhaustion',
  },
  [AUDIT_EVENTS.AGENTKIT_ITERATION_TOKEN_LIMIT_EXCEEDED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'AgentKit iteration exceeded token limit - execution stopped to prevent credit exhaustion',
  },
  [AUDIT_EVENTS.AGENTKIT_CIRCUIT_BREAKER_TRIGGERED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'AgentKit circuit breaker triggered - total execution tokens exceeded limit',
  },

  // User events - critical for security
  [AUDIT_EVENTS.USER_LOGIN]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'User logged in',
  },
  // Registered for Layer 3 step 0 (WC-12): the client write routes now take
  // severity and flags from here, so these carry exactly what the logout
  // buttons sent before.
  [AUDIT_EVENTS.USER_LOGOUT]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'User logged out',
  },
  // The V2 security tab sent severity 'medium', which the table's severity
  // CHECK rejects: every such row failed its whole batch and none was stored.
  // 'warning' is the valid level between the two it was presumably meant as.
  [AUDIT_EVENTS.USER_DATA_EXPORTED]: {
    severity: 'warning',
    complianceFlags: ['GDPR', 'CCPA'],
    description: 'User downloaded their own data from settings',
  },
  [AUDIT_EVENTS.USER_LOGIN_FAILED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Failed login attempt',
  },
  /*
   * A password change is RECORDED, not ALERTED (user decision, 2026-10-01).
   *
   * It was 'critical', which is the severity the admin Health "Critical audit
   * events" tile counts action-blind and the /monitoring page shows as a
   * security incident — so a customer following security advice raised an
   * operational alarm. Same reasoning as PAYMENT_REFUNDED (#157) and
   * PAYMENT_PLAN_CANCELLED (#160): the event is fully auditable and
   * compliance-flagged, it is simply not an incident.
   *
   * Compliance flags are UNCHANGED, and this registration is now the single
   * owner of both: /api/user/change-password used to pass severity 'warning'
   * and complianceFlags ['SOC2'] of its own, and both overrides are deleted.
   * That means future rows gain GDPR, which is correct for a credential change.
   *
   * Stored rows keep the severity they were written with: this is a
   * write-forward change, not a rewrite of a compliance table.
   *
   * Pinned by lib/audit/__tests__/passwordChangeSeverity.guard.test.ts.
   */
  [AUDIT_EVENTS.USER_PASSWORD_CHANGED]: {
    severity: 'warning',
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
  [AUDIT_EVENTS.SETTINGS_PREFERENCES_UPDATED]: {
    severity: 'info',
    complianceFlags: ['GDPR'],
    description: 'User preferences updated (timezone, language)',
  },
  [AUDIT_EVENTS.SETTINGS_CURRENCY_CHANGED]: {
    severity: 'info',
    complianceFlags: ['GDPR', 'SOC2'],
    description: 'User preferred currency changed',
  },
  [AUDIT_EVENTS.SETTINGS_NOTIFICATIONS_UPDATED]: {
    severity: 'info',
    complianceFlags: ['GDPR'],
    description: 'Notification preferences updated',
  },
  /*
   * Changing your own security preferences is RECORDED, not ALERTED — the same
   * decision and the same reasoning as USER_PASSWORD_CHANGED above.
   *
   * Its only writer is the V1 settings Security tab, which posts a severity in
   * its body that the write route has always ignored (AuditWriteBodySchema
   * accepts `severity` and drops it), so this registration has always been the
   * only thing that decided. Flags unchanged; write-forward only.
   */
  [AUDIT_EVENTS.SETTINGS_SECURITY_UPDATED]: {
    severity: 'warning',
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
  [AUDIT_EVENTS.PLUGIN_TESTER_EXECUTE]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Plugin action executed via the Form Tester (real side effects)',
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
  [AUDIT_EVENTS.BUSINESS_DATA_PURGED]: {
    severity: 'critical',
    complianceFlags: ['GDPR', 'SOC2'],
    description: 'Business data reset or purged (irreversible; pre-purge snapshot recorded)',
  },
  // Layer 3. Severity comes only from here (the emitter never passes one), and
  // neither is critical: these are kept for the default retention, not seven years.
  [AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'A Business OS AI action completed (its LLM calls summarised)',
  },
  [AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'A Business OS AI action failed after making at least one LLM call',
  },
  // Admin Archiving. Moving audit rows out of the live table is a change to what
  // the audit trail shows, so start and completion are warnings; a failed batch
  // is critical because an admin has to act on it (Continue).
  [AUDIT_EVENTS.ARCHIVE_RUN_STARTED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'An admin started an archive run (source, retention and cutoff recorded)',
  },
  [AUDIT_EVENTS.ARCHIVE_RUN_COMPLETED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'An archive run finished: every row before its cutoff is archived',
  },
  [AUDIT_EVENTS.ARCHIVE_RUN_FAILED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'An archive batch failed and was rolled back; the run can be continued',
  },
  // Business OS invites (Slice 0). Issuing or withdrawing a way into the
  // product is an admin decision worth an entry, but it changes no account yet.
  [AUDIT_EVENTS.BOS_INVITE_CREATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'An admin created a Business OS invite (grant, link expiry and reason recorded)',
  },
  [AUDIT_EVENTS.BOS_INVITE_REVOKED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'An admin revoked a Business OS invite before it was used',
  },
  [AUDIT_EVENTS.BOS_INVITE_OPENED_BY_EXISTING_ACCOUNT]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'A Business OS invite was opened for an email that already has an account; the visitor was sent to sign in and nothing changed',
  },
  [AUDIT_EVENTS.BOS_INVITE_REDEEMED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'A Business OS invite was redeemed: an account was created from it (invitation circle recorded)',
  },
  [AUDIT_EVENTS.BOS_INVITE_PLAN_PROVISIONED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'A plan row was provisioned from a Business OS invite (champion cohort, origin invite)',
  },
  [AUDIT_EVENTS.BOS_INVITE_REDEMPTION_REFUSED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'A Business OS invite signup was refused (reason class only)',
  },
  [AUDIT_EVENTS.BOS_INVITE_REDEMPTION_INCOMPLETE]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'A Business OS invite signup stopped halfway; the claim was kept for recovery',
  },
  [AUDIT_EVENTS.BOS_INVITE_EMAIL_SENT]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'A Business OS invitation email was handed to the email provider (provider and message id recorded)',
  },
  [AUDIT_EVENTS.BOS_INVITE_EMAIL_NOT_SENT]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'A Business OS invitation email was not sent, or not confirmed in time; the admin was shown the link to copy (reason class only)',
  },
  // N-1: 'info' for both. A skipped courtesy email is not an operator alert.
  [AUDIT_EVENTS.BOS_INVITE_INVITER_NOTIFIED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'The issuer of an accepted Business OS invite was emailed (recipient kind, account id, status and language recorded)',
  },
  [AUDIT_EVENTS.BOS_INVITE_INVITER_NOT_NOTIFIED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'The issuer of an accepted Business OS invite was not emailed, or the send was not confirmed in time (reason class only)',
  },
  // Credit deduction slice 11b. 'warning': an admin changed what an account can
  // spend. SOC2 and not FINANCIAL: FINANCIAL is reserved for AgentsPilot's own
  // platform-billing events (see PAYMENT_PLAN_CANCELLED below); every Business
  // OS money event carries SOC2 alone (SA W11b-3).
  [AUDIT_EVENTS.BOS_CREDIT_LOT_GRANTED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'An admin gave extra credits to a Business OS account (credits, expiry and reason recorded)',
  },
  [AUDIT_EVENTS.BOS_CREDIT_LOT_REDUCED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'An admin took credits back from a Business OS credit lot (credits, lot remaining and reason recorded)',
  },
  // Credit deduction slice 8b (SA SQ-46): 'info', no compliance flags — an
  // observation for admins, not an operator alert. The writer passes NO
  // severity, so this registration is the only source (pinned by test).
  [AUDIT_EVENTS.BOS_CREDIT_LOW_LINE_CROSSED]: {
    severity: 'info',
    description: "A Business OS account's plan credits dropped below the low line (percentage before / after recorded)",
  },
  // ADMIN_BOS_CLEANUP slice 7d. 'warning': an admin made the platform process
  // (and possibly send) queued items across every account, outside the schedule.
  [AUDIT_EVENTS.BOS_QUEUE_DRAIN_STARTED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'An admin started a Business OS queue drain now',
  },
  // ADMIN_BOS_CLEANUP slice 7b. 'warning': an admin closed a real client's
  // queued message for good; it will not be sent.
  [AUDIT_EVENTS.BOS_QUEUE_ITEM_CANCELLED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'An admin cancelled one Business OS queue item; it will not be sent',
  },
  // ADMIN_BOS_CLEANUP slice 7c. 'warning': an admin added one more send
  // attempt to a real client's queued message.
  [AUDIT_EVENTS.BOS_QUEUE_ITEM_RETRIED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'An admin put one failed Business OS queue item back for exactly one more send attempt',
  },
  // Slice 5a: a champion's friend invites (FR-28 to FR-32, F5a-13).
  [AUDIT_EVENTS.BOS_FRIEND_INVITE_CREATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'A champion sent a Business OS friend invite to Essentials (language recorded)',
  },
  [AUDIT_EVENTS.BOS_FRIEND_INVITE_REVOKED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'A champion revoked one of their own Business OS friend invites; its slot returned to their allowance',
  },
  [AUDIT_EVENTS.BOS_FRIEND_INVITE_REFUSED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'A Business OS friend invite send was refused (reason class only)',
  },
  [AUDIT_EVENTS.BUSINESS_DATA_PURGE_BLOCKED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Business data reset or purge refused before any data was touched',
  },
  // Admin delete AD-1b. 'info': a read, nothing changed. Kept so the later
  // deletion trail (AD-2) shows what the admin saw first.
  [AUDIT_EVENTS.BUSINESS_DELETION_PREVIEWED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'An admin opened the read-only deletion preview of a business (nothing deleted)',
  },
  // Admin delete AD-2a. 'critical': the record that a destructive, irreversible
  // run was about to start. Not proof that it ran (see the event comment).
  [AUDIT_EVENTS.BUSINESS_DELETION_STARTED]: {
    severity: 'critical',
    complianceFlags: ['GDPR', 'SOC2'],
    description: 'An admin started deleting a business (write-ahead; only BUSINESS_DATA_PURGED records completion)',
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
  [AUDIT_EVENTS.PLUGIN_ACT_AS]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'Admin executed a plugin route on behalf of another user',
  },
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
  /*
   * The one event in this family anything writes: lib/audit/recordRefusedAccess.ts,
   * from the two admin gates and the refused act-as. Stays 'critical' — a
   * signed-in account being told no on an admin surface is worth an alert.
   *
   * Severity and flags live here and nowhere else: no call site may pass them.
   */
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

  // Memory System events
  [AUDIT_EVENTS.MEMORY_CREATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'New memory record created for agent execution',
  },
  [AUDIT_EVENTS.MEMORY_SUMMARIZATION_STARTED]: {
    severity: 'info',
    description: 'Memory summarization process initiated',
  },
  [AUDIT_EVENTS.MEMORY_SUMMARIZATION_COMPLETED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Memory summarization completed and saved',
  },
  [AUDIT_EVENTS.MEMORY_SUMMARIZATION_FAILED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'Memory summarization failed',
  },
  [AUDIT_EVENTS.MEMORY_INJECTED]: {
    severity: 'info',
    description: 'Memory context injected into agent execution',
  },
  [AUDIT_EVENTS.MEMORY_EMBEDDING_GENERATED]: {
    severity: 'info',
    description: 'Vector embedding generated for memory',
  },
  [AUDIT_EVENTS.MEMORY_CONSOLIDATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Multiple memories consolidated',
  },
  [AUDIT_EVENTS.MEMORY_DELETED]: {
    severity: 'warning',
    complianceFlags: ['SOC2', 'GDPR'],
    description: 'Memory record deleted per retention policy',
  },
  [AUDIT_EVENTS.MEMORY_CONFIG_UPDATED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Memory system configuration updated',
  },
  [AUDIT_EVENTS.MEMORY_SENTIMENT_DETECTED]: {
    severity: 'info',
    description: 'Sentiment classification detected in memory',
  },
  [AUDIT_EVENTS.MEMORY_PATTERN_DETECTED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Recurring pattern detected across executions',
  },
  [AUDIT_EVENTS.MEMORY_ALERT_TRIGGERED]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'Memory alert triggered for negative sentiment pattern',
  },

  // User Memory Events
  [AUDIT_EVENTS.USER_MEMORY_EXTRACTED]: {
    severity: 'info',
    description: 'User preference extracted from agent conversation',
  },
  [AUDIT_EVENTS.USER_MEMORY_SAVED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'User preference saved to cross-agent memory',
  },
  [AUDIT_EVENTS.USER_MEMORY_UPDATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'User preference updated in cross-agent memory',
  },
  [AUDIT_EVENTS.USER_MEMORY_INJECTED]: {
    severity: 'info',
    description: 'User context injected into agent execution',
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
  // Critical, like AI_PRICING_DELETED: the revenue effect is comparable — every
  // call to a zero-priced model is billed at $0 until someone notices.
  [AUDIT_EVENTS.AI_PRICING_ZERO_SET]: {
    severity: 'critical',
    complianceFlags: ['SOC2'],
    description: 'AI model price set to zero (usage billed at $0)',
  },

  // Workflow Pilot events
  [AUDIT_EVENTS.PILOT_EXECUTION_STARTED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Workflow execution started',
  },
  [AUDIT_EVENTS.PILOT_EXECUTION_COMPLETED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Workflow execution completed successfully',
  },
  [AUDIT_EVENTS.PILOT_EXECUTION_FAILED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Workflow execution failed',
  },
  [AUDIT_EVENTS.PILOT_EXECUTION_PAUSED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Workflow execution paused',
  },
  [AUDIT_EVENTS.PILOT_EXECUTION_RESUMED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Workflow execution resumed',
  },

  // Per-Step Intelligent Routing events
  [AUDIT_EVENTS.PILOT_ROUTING_DECISION]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'AI model selected for workflow step based on complexity analysis',
  },
  [AUDIT_EVENTS.PILOT_ROUTING_ENABLED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Per-step intelligent model routing enabled',
  },
  [AUDIT_EVENTS.PILOT_ROUTING_DISABLED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Per-step intelligent model routing disabled',
  },
  [AUDIT_EVENTS.PILOT_ROUTING_CONFIG_UPDATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Per-step routing configuration updated',
  },

  // Workflow Generation events
  [AUDIT_EVENTS.WORKFLOW_GENERATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Workflow successfully generated by orchestrator',
  },
  [AUDIT_EVENTS.WORKFLOW_GENERATION_FALLBACK]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Workflow generation fallback triggered',
  },

  // Human-in-the-Loop Approval events (Phase 6)
  [AUDIT_EVENTS.APPROVAL_REQUESTED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Human approval requested for workflow step',
  },
  [AUDIT_EVENTS.APPROVAL_APPROVED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Workflow approval granted by user',
  },
  [AUDIT_EVENTS.APPROVAL_REJECTED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Workflow approval rejected by user',
  },
  [AUDIT_EVENTS.APPROVAL_TIMEOUT]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Workflow approval timed out',
  },
  [AUDIT_EVENTS.APPROVAL_ESCALATED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Workflow approval escalated to higher authority',
  },
  [AUDIT_EVENTS.APPROVAL_DELEGATED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Workflow approval delegated to another user',
  },

  // Pre-execution auto-repair (Phase 6 — Tier 3 Fix #12)
  // Fires when StructuralRepairEngine modified the workflow before execution.
  // Indicates a generator bug — the agent's saved workflow was missing required
  // fields or had structural issues that the repair engine had to patch.
  // Operators should triage these to fix the upstream generator.
  [AUDIT_EVENTS.PILOT_STRUCTURAL_REPAIR_APPLIED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'Structural auto-repair fired on a workflow before execution',
  },

  // Money leaving the business. Registered because an unregistered event falls
  // through getEventMetadata to severity 'info' and the description
  // "Unknown event" — which is how refunds were being recorded until then.
  //
  // 'warning', not 'critical'. A refund is a business owner doing normal
  // business with their own client: it belongs in the record, and the SOC2 flag
  // says so, but nothing about it needs a platform admin. At 'critical' it was
  // counted by the admin health tile, which counts severity and ignores the
  // action (app/api/admin/health-summary/route.ts), and by the owner's own
  // /monitoring page, so one refund read as "critical security event, immediate
  // review recommended". Not 'info' either: money left the business and will not
  // come back, which is more than a routine read. This matches the money events
  // either side of it — PAYMENT_BLOCK_EXECUTED and INVOICE_MARKED_PAID.
  //
  // The refund route deliberately passes NO severity (buildLogEntry prefers the
  // caller's value over this one, which is how the two came to disagree), so
  // this entry is the only place the classification lives. A guard test pins
  // both halves: lib/audit/__tests__/paymentRefundSeverity.guard.test.ts.
  [AUDIT_EVENTS.PAYMENT_REFUNDED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'A payment was refunded to a client',
  },
  [AUDIT_EVENTS.PAYMENT_BLOCK_EXECUTED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'A payment block was executed',
  },
  // Money asserted to have arrived, on a human's word rather than a processor's.
  [AUDIT_EVENTS.INVOICE_MARKED_PAID]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: 'An invoice was marked paid manually',
  },
  // Future charges to a client stopped, and possibly collected money returned.
  //
  // Registered here for the first time: it was written only by its call site, so
  // every row it has ever produced fell through getEventMetadata to the
  // description "Unknown event: PAYMENT_PLAN_CANCELLED" and to no compliance
  // flags at all. Registering it fixes the record quality as well as the label.
  //
  // 'warning', for the same reason as PAYMENT_REFUNDED directly above. The call
  // site used to say 'critical' and its comment said why — "audited at the same
  // level as money moving", i.e. deliberately matched to the refund. The refund
  // is now 'warning', so keeping this at 'critical' would break that stated
  // intent and leave the two contradicting each other. A business owner stopping
  // a plan they sold to their own client is normal business: it belongs in the
  // record, but it is not something a platform admin needs to review, and at
  // 'critical' it was counted by the admin health tile (which counts severity
  // and ignores the action) and shown on the owner's own /monitoring page as a
  // security event needing immediate review. Not 'info' either: it changes what
  // a client will be charged and can return money already collected.
  //
  // SOC2 and not FINANCIAL, matching all three money events above. FINANCIAL is
  // carried only by AgentsPilot's own platform-billing events, and there to keep
  // their pre-existing stored rows unchanged (Layer 3 step 0, WC-12).
  //
  // The cancel route deliberately passes NO severity (buildLogEntry prefers the
  // caller's value over this one), so this entry is the only place the
  // classification lives. Guard: paymentPlanCancelledSeverity.guard.test.ts.
  [AUDIT_EVENTS.PAYMENT_PLAN_CANCELLED]: {
    severity: 'warning',
    complianceFlags: ['SOC2'],
    description: "A client's payment plan was cancelled",
  },

  // Subscription billing. Registered for Layer 3 step 0 (WC-12) with exactly the
  // severity and flags the Stripe routes sent before, including FINANCIAL, so
  // their stored rows do not change.
  [AUDIT_EVENTS.SUBSCRIPTION_CHECKOUT_INITIATED]: {
    severity: 'info',
    complianceFlags: ['SOC2', 'FINANCIAL'],
    description: 'Subscription checkout started',
  },
  [AUDIT_EVENTS.BOOST_PACK_CHECKOUT_INITIATED]: {
    severity: 'info',
    complianceFlags: ['SOC2', 'FINANCIAL'],
    description: 'Boost pack checkout started',
  },
  [AUDIT_EVENTS.SUBSCRIPTION_CANCELED]: {
    severity: 'info',
    complianceFlags: ['SOC2', 'FINANCIAL'],
    description: 'Subscription set to cancel at period end',
  },
  [AUDIT_EVENTS.SUBSCRIPTION_REACTIVATED]: {
    severity: 'info',
    complianceFlags: ['SOC2', 'FINANCIAL'],
    description: 'Subscription reactivated',
  },
  [AUDIT_EVENTS.CUSTOMER_PORTAL_ACCESSED]: {
    severity: 'info',
    complianceFlags: ['SOC2'],
    description: 'Stripe customer portal opened',
  },
  // Free credits and quotas granted once, at onboarding. Same severity and flags
  // as the Stripe billing events: it changes an account's credit balance.
  [AUDIT_EVENTS.FREE_TIER_ALLOCATED]: {
    severity: 'info',
    complianceFlags: ['SOC2', 'FINANCIAL'],
    description: 'Free-tier credits and quotas granted',
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

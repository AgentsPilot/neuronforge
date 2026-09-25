// lib/audit/eventAudience.ts
//
// Which product each audit event belongs to (admin reorganisation, slice 2c).
//
// Every registered event is tagged, one entry per event:
//   - 'bos'          Business OS only
//   - 'shared'       serves both products: sign-in, account, settings, plugin
//                    connections, GDPR, admin/system, AI pricing, billing, security
//   - 'agentspilot'  the parked agent platform only
//
// The admin audit trail's Action Type dropdown offers 'bos' + 'shared'
// (OPERATOR_AUDIENCES). This only changes what the DROPDOWN lists: nothing is
// removed from AUDIT_EVENTS, the route never filters by audience, and "All
// Actions" still returns every row.
//
// Why one entry per event and not prefix rules: a rule such as USER_ -> shared
// would silently tag a future USER_MEMORY_* (an agent event) as shared. A new
// event must not appear or disappear without somebody deciding.
//
// What protects production, stated honestly:
//   - An event with NO entry here is treated as VISIBLE (isVisibleTo). A missed
//     classification costs one extra dropdown line; it can never hide an event.
//   - lib/audit/__tests__/eventAudience.test.ts fails on an untagged event or a
//     stale entry. That is a Jest suite, and no CI job runs Jest today, so it is
//     caught locally / by QA, not by CI.
//   - The `satisfies Record<AuditEvent, AuditAudience>` below is not CI-enforced
//     either (lib/audit is outside the typecheck:bos-llm scope).
//
// Borderline tags were confirmed by the user on 2026-09-25: PLUGIN_* (incl. the
// tester), USER_ONBOARDING_*, BOOST_PACK_CHECKOUT_INITIATED -> shared;
// EFFORT_ESTIMATE_GENERATED -> agentspilot. The rule for a doubtful new event
// is 'shared': hiding is the costlier mistake in an investigation tool.
//
// Pure: no I/O, no React, no zod. Safe inside a client bundle.

import { AUDIT_EVENTS } from './events';
import type { AuditEvent } from './events';

export type AuditAudience = 'bos' | 'shared' | 'agentspilot';

/** The audiences the operator (Business OS) dropdown shows. */
export const OPERATOR_AUDIENCES: readonly AuditAudience[] = ['bos', 'shared'];

/** Exactly one audience per registered event, in catalogue order. */
export const AUDIT_EVENT_AUDIENCE = {
  [AUDIT_EVENTS.AGENT_CREATED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_DELETED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_ARCHIVED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_RESTORED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_STATUS_CHANGED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_SCHEDULE_CHANGED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_MODE_CHANGED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_RUN_STARTED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_RUN_COMPLETED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_RUN_FAILED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_EXECUTED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_SCHEMA_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_CONFIG_SAVED]: 'agentspilot',
  [AUDIT_EVENTS.EFFORT_ESTIMATE_GENERATED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_CALIBRATION_FIELD_CORRECTED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_GENERATION_STARTED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_GENERATION_COMPLETED]: 'agentspilot',
  [AUDIT_EVENTS.AGENT_GENERATION_FAILED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_EXECUTION_STARTED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_EXECUTION_COMPLETED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_EXECUTION_FAILED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_PLUGIN_CALLED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_PLUGIN_SUCCESS]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_PLUGIN_FAILED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_ITERATION_COMPLETED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_MAX_ITERATIONS_REACHED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_LOOP_DETECTED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_ITERATION_TOKEN_LIMIT_EXCEEDED]: 'agentspilot',
  [AUDIT_EVENTS.AGENTKIT_CIRCUIT_BREAKER_TRIGGERED]: 'agentspilot',
  [AUDIT_EVENTS.MODEL_ROUTING_DECISION]: 'agentspilot',
  [AUDIT_EVENTS.USER_CREATED]: 'shared',
  [AUDIT_EVENTS.USER_LOGIN]: 'shared',
  [AUDIT_EVENTS.USER_LOGOUT]: 'shared',
  [AUDIT_EVENTS.USER_LOGIN_FAILED]: 'shared',
  [AUDIT_EVENTS.USER_PASSWORD_CHANGED]: 'shared',
  [AUDIT_EVENTS.USER_EMAIL_CHANGED]: 'shared',
  [AUDIT_EVENTS.USER_TERMINATED]: 'shared',
  [AUDIT_EVENTS.USER_SUSPENDED]: 'shared',
  [AUDIT_EVENTS.USER_REACTIVATED]: 'shared',
  [AUDIT_EVENTS.USER_ONBOARDING_COMPLETED]: 'shared',
  [AUDIT_EVENTS.USER_ONBOARDING_FAILED]: 'shared',
  [AUDIT_EVENTS.PROFILE_UPDATED]: 'shared',
  [AUDIT_EVENTS.PROFILE_VIEWED]: 'shared',
  [AUDIT_EVENTS.SETTINGS_PROFILE_UPDATED]: 'shared',
  [AUDIT_EVENTS.SETTINGS_PREFERENCES_UPDATED]: 'shared',
  [AUDIT_EVENTS.SETTINGS_CURRENCY_CHANGED]: 'shared',
  [AUDIT_EVENTS.SETTINGS_NOTIFICATIONS_UPDATED]: 'shared',
  [AUDIT_EVENTS.SETTINGS_SECURITY_UPDATED]: 'shared',
  [AUDIT_EVENTS.SETTINGS_API_KEY_CREATED]: 'shared',
  [AUDIT_EVENTS.SETTINGS_API_KEY_REVOKED]: 'shared',
  [AUDIT_EVENTS.SETTINGS_2FA_ENABLED]: 'shared',
  [AUDIT_EVENTS.SETTINGS_2FA_DISABLED]: 'shared',
  [AUDIT_EVENTS.PLUGIN_CONNECTED]: 'shared',
  [AUDIT_EVENTS.PLUGIN_DISCONNECTED]: 'shared',
  [AUDIT_EVENTS.PLUGIN_RECONNECTED]: 'shared',
  [AUDIT_EVENTS.PLUGIN_AUTH_FAILED]: 'shared',
  [AUDIT_EVENTS.PLUGIN_PERMISSION_GRANTED]: 'shared',
  [AUDIT_EVENTS.PLUGIN_PERMISSION_REVOKED]: 'shared',
  [AUDIT_EVENTS.PLUGIN_TESTER_EXECUTE]: 'shared',
  [AUDIT_EVENTS.PLUGIN_ACT_AS]: 'shared',
  [AUDIT_EVENTS.DATA_EXPORTED]: 'shared',
  [AUDIT_EVENTS.USER_DATA_EXPORTED]: 'shared',
  [AUDIT_EVENTS.DATA_DELETED]: 'shared',
  [AUDIT_EVENTS.DATA_ANONYMIZED]: 'shared',
  [AUDIT_EVENTS.BUSINESS_DATA_PURGED]: 'bos',
  [AUDIT_EVENTS.BUSINESS_DATA_PURGE_BLOCKED]: 'bos',
  [AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED]: 'bos',
  [AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED]: 'bos',
  [AUDIT_EVENTS.DATA_ACCESSED]: 'shared',
  [AUDIT_EVENTS.CONSENT_GRANTED]: 'shared',
  [AUDIT_EVENTS.CONSENT_REVOKED]: 'shared',
  [AUDIT_EVENTS.ADMIN_ACTION]: 'shared',
  [AUDIT_EVENTS.ADMIN_IMPERSONATION_STARTED]: 'shared',
  [AUDIT_EVENTS.ADMIN_IMPERSONATION_ENDED]: 'shared',
  [AUDIT_EVENTS.SYSTEM_CONFIG_CHANGED]: 'shared',
  [AUDIT_EVENTS.SYSTEM_MAINTENANCE_STARTED]: 'shared',
  [AUDIT_EVENTS.SYSTEM_MAINTENANCE_ENDED]: 'shared',
  [AUDIT_EVENTS.BOS_ENTITLEMENT_PLAN_ROW_ENSURED]: 'bos',
  [AUDIT_EVENTS.BOS_ENTITLEMENT_COHORT_SET]: 'bos',
  [AUDIT_EVENTS.BOS_ENTITLEMENT_EXPIRY_SET]: 'bos',
  [AUDIT_EVENTS.BOS_ENTITLEMENT_TIER_ASSIGNED]: 'bos',
  [AUDIT_EVENTS.BOS_ENTITLEMENT_OVERRIDE_ADDED]: 'bos',
  [AUDIT_EVENTS.BOS_ENTITLEMENT_OVERRIDE_ENDED]: 'bos',
  [AUDIT_EVENTS.BOS_ENTITLEMENT_PLAN_STATE_RESET]: 'bos',
  [AUDIT_EVENTS.BOS_ENTITLEMENT_LAUNCH_DRY_RUN]: 'bos',
  [AUDIT_EVENTS.AIS_SCORE_CALCULATED]: 'agentspilot',
  [AUDIT_EVENTS.AIS_SCORE_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.AIS_SCORE_RECALCULATED]: 'agentspilot',
  [AUDIT_EVENTS.AIS_NORMALIZATION_REFRESH_STARTED]: 'agentspilot',
  [AUDIT_EVENTS.AIS_NORMALIZATION_REFRESH_COMPLETED]: 'agentspilot',
  [AUDIT_EVENTS.AIS_SCORES_BULK_RECALCULATED]: 'agentspilot',
  [AUDIT_EVENTS.AIS_MODE_SWITCHED]: 'agentspilot',
  [AUDIT_EVENTS.AIS_THRESHOLD_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.REWARD_CONFIG_CREATED]: 'agentspilot',
  [AUDIT_EVENTS.REWARD_CONFIG_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.REWARD_CONFIG_DELETED]: 'agentspilot',
  [AUDIT_EVENTS.REWARD_CONFIG_TOGGLED]: 'agentspilot',
  [AUDIT_EVENTS.ROUTING_CONFIG_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.AI_PRICING_CREATED]: 'shared',
  [AUDIT_EVENTS.AI_PRICING_UPDATED]: 'shared',
  [AUDIT_EVENTS.AI_PRICING_DELETED]: 'shared',
  [AUDIT_EVENTS.AI_PRICING_SYNCED]: 'shared',
  [AUDIT_EVENTS.AI_PRICING_ZERO_SET]: 'shared',
  [AUDIT_EVENTS.MEMORY_CREATED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_SUMMARIZATION_STARTED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_SUMMARIZATION_COMPLETED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_SUMMARIZATION_FAILED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_INJECTED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_EMBEDDING_GENERATED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_CONSOLIDATED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_DELETED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_CONFIG_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_SENTIMENT_DETECTED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_PATTERN_DETECTED]: 'agentspilot',
  [AUDIT_EVENTS.MEMORY_ALERT_TRIGGERED]: 'agentspilot',
  [AUDIT_EVENTS.USER_MEMORY_EXTRACTED]: 'agentspilot',
  [AUDIT_EVENTS.USER_MEMORY_SAVED]: 'agentspilot',
  [AUDIT_EVENTS.USER_MEMORY_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.USER_MEMORY_INJECTED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_EXECUTION_STARTED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_EXECUTION_COMPLETED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_EXECUTION_FAILED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_EXECUTION_PAUSED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_EXECUTION_RESUMED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_EXECUTION_CANCELLED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_STEP_EXECUTED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_STEP_FAILED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_STEP_RETRIED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_DISABLED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_CONFIG_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_STRUCTURAL_REPAIR_APPLIED]: 'agentspilot',
  [AUDIT_EVENTS.SUBSCRIPTION_CHECKOUT_INITIATED]: 'shared',
  [AUDIT_EVENTS.BOOST_PACK_CHECKOUT_INITIATED]: 'shared',
  [AUDIT_EVENTS.SUBSCRIPTION_CANCELED]: 'shared',
  [AUDIT_EVENTS.SUBSCRIPTION_REACTIVATED]: 'shared',
  [AUDIT_EVENTS.CUSTOMER_PORTAL_ACCESSED]: 'shared',
  [AUDIT_EVENTS.FREE_TIER_ALLOCATED]: 'shared',
  [AUDIT_EVENTS.PAYMENT_REFUNDED]: 'bos',
  [AUDIT_EVENTS.PAYMENT_BLOCK_EXECUTED]: 'bos',
  [AUDIT_EVENTS.INVOICE_MARKED_PAID]: 'bos',
  [AUDIT_EVENTS.PILOT_ROUTING_DECISION]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_ROUTING_ENABLED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_ROUTING_DISABLED]: 'agentspilot',
  [AUDIT_EVENTS.PILOT_ROUTING_CONFIG_UPDATED]: 'agentspilot',
  [AUDIT_EVENTS.WORKFLOW_GENERATED]: 'agentspilot',
  [AUDIT_EVENTS.WORKFLOW_GENERATION_FALLBACK]: 'agentspilot',
  [AUDIT_EVENTS.APPROVAL_REQUESTED]: 'agentspilot',
  [AUDIT_EVENTS.APPROVAL_APPROVED]: 'agentspilot',
  [AUDIT_EVENTS.APPROVAL_REJECTED]: 'agentspilot',
  [AUDIT_EVENTS.APPROVAL_TIMEOUT]: 'agentspilot',
  [AUDIT_EVENTS.APPROVAL_ESCALATED]: 'agentspilot',
  [AUDIT_EVENTS.APPROVAL_DELEGATED]: 'agentspilot',
  [AUDIT_EVENTS.SECURITY_BREACH_DETECTED]: 'shared',
  [AUDIT_EVENTS.SECURITY_ANOMALY_DETECTED]: 'shared',
  [AUDIT_EVENTS.SECURITY_RATE_LIMIT_EXCEEDED]: 'shared',
  [AUDIT_EVENTS.SECURITY_UNAUTHORIZED_ACCESS]: 'shared',
} as const satisfies Record<AuditEvent, AuditAudience>;

/** The audience of an event, or undefined when it has not been tagged. */
export function audienceOf(event: string): AuditAudience | undefined {
  return (AUDIT_EVENT_AUDIENCE as Readonly<Record<string, AuditAudience>>)[event];
}

/**
 * Whether an event belongs in a list restricted to `audiences`. An untagged
 * event is ALWAYS visible: a new event can never vanish from a dropdown before
 * someone has classified it.
 */
export function isVisibleTo(event: string, audiences: readonly AuditAudience[]): boolean {
  const audience = audienceOf(event);
  return audience === undefined || audiences.includes(audience);
}

// scripts/generate-test-account-cleanup-sql.ts
//
// Writes the two operator SQL files that remove ONE test account completely,
// so the same email can be invited and sign up again:
//
//   scripts/test-account-cleanup-check.sql    read-only, ends with OK or BLOCKED
//   scripts/test-account-cleanup-delete.sql   one all-or-nothing block
//   supabase/migrations/<FUNCTION_MIGRATION>.sql
//                                             the same builders as ONE
//                                             secret-gated function (OX-1r),
//                                             CREATE OR REPLACE over the
//                                             applied 20261041 setup
//   supabase/SQL Scripts/<FUNCTION_MIGRATION>_rollback.sql
//                                             restores the previous function
//   lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts
//                                             only the function's version stamp
//
//   npx tsx scripts/generate-test-account-cleanup-sql.ts
//
// Workplan: docs/workplans/TEST_ACCOUNT_CLEANUP_SCRIPT_WORKPLAN.md
// Runbook:  docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md
//
// ── Why generated ───────────────────────────────────────────────────────────
// The table list and delete order come from the purge descriptors
// (lib/business-os/purge/descriptors.ts), not from a hand-written list. A hand
// list here would drift exactly the way the one in reset-onboarding.ts did
// (17 tables named, 55 real). `scripts/__tests__/testAccountCleanupSql.test.ts`
// regenerates both files and fails if the committed SQL differs, so a new
// descriptor or a changed band shows up as a red test, not as a missed table.
//
// ── Operator exception OX-1 ─────────────────────────────────────────────────
// This hard-deletes `auth.users`, which D3 / D14 / UD-1 forbid for every product
// path. It is allowed ONLY as SQL an operator pastes by hand, for an account
// whose email contains the test tag. No route, service or TS runtime path may
// ever run it. Recorded in both requirements (purge D3, admin delete UD-1/D14).
//
// ── OX-1r (SA re-ruling R-7, 2026-10-07, supersedes the paragraph above) ───
// Operator-only hard delete of `auth.users` for accounts whose email contains
// the test tag, run either as pasted SQL or by the admin-only
// `/api/admin/test-account-cleanup/*` routes through the single secret-gated
// RPC `public.operator_test_account_cleanup`, both generated from the same
// builders. No other RPC, no other caller. The function is applied by the
// migration this file writes; it refuses (42501) unless the caller sends the
// second secret whose sha256 only the database holds (R-3). No SQL exists at
// runtime in the app: it only calls the function and checks its version.
// Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md
//
// ── What lives here ─────────────────────────────────────────────────────────
// Only reviewed data that the descriptors cannot express: the extra `never`
// tables removed for a test account (BQ-2), the foreign keys to the login that
// name another account or the platform (SA C-2), and the guard queries. Each
// entry carries its reason. Output is deterministic (SA C-9): no dates, no
// randomness, LF line endings.
//
// ── SQL editor hazards (SA C-6) ─────────────────────────────────────────────
// The Supabase SQL editor has failed on the word "into" in prose. The emitted
// SQL contains exactly one such token, `INSERT INTO public.audit_trail (`, and
// assigns plpgsql variables with `:=`, never `SELECT ... INTO`. Comments appear
// only on the edit lines at the top. The test enforces all of it.

import { createHash } from 'crypto';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  REVIEWED_DELETE_TRIGGERS,
  STORAGE_DESCRIPTORS,
  descriptorsForRun,
} from '@/lib/business-os/purge/descriptors';
import { LOCAL_BLOCKING_CONDITIONS } from '@/lib/business-os/purge/localPrecondition';
import { R3_LIVE_STATUSES } from '@/lib/business-os/purge/adminDeletionRefusals';

// ════════════════════════════════════════════════════════════════════════════
// Reviewed data
// ════════════════════════════════════════════════════════════════════════════

/** The audit event the delete writes. Must equal the registry (lib/audit/events.ts). */
export const AUDIT_ACTION = 'BUSINESS_TEST_ACCOUNT_REMOVED';
export const AUDIT_SEVERITY = 'warning';
export const AUDIT_COMPLIANCE_FLAGS = ['SOC2'] as const;

/** Placeholder email in both files. A login never matches it, so an unedited paste blocks at G-1. */
export const PLACEHOLDER_EMAIL = 'name+test1@example.com';
/** Default test tag (BQ-1, user 2026-10-06): an account qualifies when its email CONTAINS it. */
export const DEFAULT_TEST_TAG = '+test';

export const CHECK_FILE = 'scripts/test-account-cleanup-check.sql';
export const DELETE_FILE = 'scripts/test-account-cleanup-delete.sql';
/**
 * The migration that created the function, its private schema and the secret
 * table (R-1). APPLIED to prod, so it is history: this generator no longer
 * writes it, and the test pins its bytes (and its rollback's) by sha256.
 */
export const INITIAL_FUNCTION_MIGRATION = '20261041_operator_test_account_cleanup';
/**
 * The migration the generator writes now: CREATE OR REPLACE of the same
 * function with the current plan (R-1). NEVER edit it once applied: a changed
 * plan gets a new dated name here, PREVIOUS_FUNCTION_MIGRATION moves to the
 * name below, and the drift test then expects the new file. The old file stays
 * as applied history.
 *
 * If two branches both change the cleanup plan, whichever lands second
 * rebases onto the first one's generator, takes the next free number, sets
 * PREVIOUS_FUNCTION_MIGRATION to the first one's file, adds the first one's
 * sha256 to the APPLIED pins (scripts/__tests__/testAccountCleanupSql.test.ts)
 * once it is applied, and regenerates.
 *
 * 20261042: the plan gained business_os_billing_events (plan payments P-3b.1).
 * 20261043: insight_hypotheses and insight_measurements classified, their links
 * reviewed (G-18), cheaper G-18 and survivor scans, trigger events shown, and
 * the database time returned as server_ms (test-account cleanup first live run).
 */
export const FUNCTION_MIGRATION = '20261043_operator_test_account_cleanup_insight_links';
/** The applied migration whose function the rollback restores, byte for byte. */
export const PREVIOUS_FUNCTION_MIGRATION = '20261042_operator_test_account_cleanup_billing_events';
export const MIGRATION_FILE = `supabase/migrations/${FUNCTION_MIGRATION}.sql`;
export const ROLLBACK_FILE = `supabase/SQL Scripts/${FUNCTION_MIGRATION}_rollback.sql`;
export const PREVIOUS_MIGRATION_FILE = `supabase/migrations/${PREVIOUS_FUNCTION_MIGRATION}.sql`;
/**
 * Tables the function names in STATIC SQL that a migration newer than the
 * previously applied function creates. A plpgsql body is only parsed when it
 * is created, so without a guard the migration would apply cleanly and then
 * fail every check and delete with 42P01 (undefined table). The migration
 * therefore refuses, and applies nothing, until each table exists: that makes
 * the apply order (the creating migration first, then this one) enforced
 * rather than only documented. The test checks each entry against its file.
 */
export const FUNCTION_REQUIRED_TABLES: ReadonlyArray<{ table: string; migration: string; reason: string }> = [
  {
    table: 'business_os_billing_events',
    migration: '20261027_business_os_billing_events',
    reason: 'Guard G-5 counts its live-mode rows and the plan deletes it, both in static SQL (plan payments P-3b.1).',
  },
];
export const VERSION_FILE = 'lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts';
export const FUNCTION_NAME = 'public.operator_test_account_cleanup';
export const FUNCTION_SIGNATURE = `${FUNCTION_NAME}(text, text, text, text, uuid, text)`;
/** The row of operator_private.secrets holding the sha256 of TEST_CLEANUP_SECRET (R-3). */
export const SECRET_ROW_NAME = 'test_account_cleanup';

/** Where a table's rows name the account, when it is not `user_id`. */
const KEY_COLUMN_OVERRIDES: Readonly<Record<string, string>> = {
  profiles: 'id',
  organizations: 'owner_user_id',
};

/**
 * Step B: user-scoped `never` descriptors removed for a TEST account only.
 *
 * A business purge keeps all of these (billing evidence, compliance records,
 * account settings, the agent platform). For a test account the user decided
 * (BQ-2, 2026-10-06) to remove the credit and payment history too, behind the
 * live-mode and Stripe guards (G-5 to G-8). Two of them, `credit_transactions`
 * and `user_subscriptions`, carry NO ACTION foreign keys to the login, so the
 * login cannot be deleted while they hold rows.
 *
 * ORDER MATTERS. It follows the measured NO ACTION edges in
 * STEP_B_BLOCKING_EDGES: a child always before its parent.
 */
export const FULL_REMOVAL_EXTRAS: ReadonlyArray<{ table: string; reason: string }> = [
  // Legacy billing cluster. Children first (billing_events, boost_pack_purchases,
  // user_rewards -> credit_transactions -> token_usage; billing_events -> user_subscriptions).
  { table: 'billing_events', reason: 'Legacy billing history of the test account (BQ-2). Child of credit_transactions and user_subscriptions.' },
  { table: 'boost_pack_purchases', reason: 'Legacy boost purchases (BQ-2). Child of credit_transactions.' },
  { table: 'user_rewards', reason: 'Legacy rewards ledger (BQ-2). Child of credit_transactions.' },
  { table: 'credit_transactions', reason: 'Legacy credit ledger (BQ-2). NO ACTION to the login. Child of token_usage.' },
  { table: 'token_usage', reason: 'Token accounting of the test account (BQ-2). Parent of credit_transactions.' },
  // Before user_subscriptions: its AFTER DELETE triggers recompute the storage quota.
  { table: 'storage_usage', reason: 'Quota rows of the test account. AFTER DELETE triggers recompute the quota, so it runs before user_subscriptions.' },
  { table: 'user_subscriptions', reason: 'Legacy subscription row (BQ-2). NO ACTION to the login. G-7 refuses one with a Stripe subscription id.' },
  { table: 'subscriptions', reason: 'Billing state. Absent on prod (measured 2026-10-06), skipped at run time while absent.' },
  { table: 'subscription_invoices', reason: 'Legacy invoices (BQ-2).' },
  // Business OS money. Lot children first.
  { table: 'business_os_boost_purchases', reason: 'Boost purchases (BQ-2). G-5 refuses any live-mode row. Child of business_os_credit_lots.' },
  { table: 'business_os_credit_lot_draws', reason: 'Credit taken back from lots (BQ-2). Child of business_os_credit_lots.' },
  { table: 'business_os_credit_lots', reason: 'Credits added to the test account (BQ-2).' },
  { table: 'business_os_credit_charges', reason: 'The credit bill of the test account (BQ-2). SET NULL to the login, so it would otherwise survive with no owner.' },
  { table: 'business_os_credit_totals', reason: 'Running totals derived from the bill (BQ-2).' },
  { table: 'business_os_billing_events', reason: 'Plan money history (BQ-2). Append-only, but the owner may delete. G-5 refuses any live-mode row.' },
  { table: 'business_os_billing_accounts', reason: 'Plan billing rows (BQ-2). G-5 refuses live mode, G-6 refuses a live subscription in either mode.' },
  { table: 'business_os_boost_cap_overrides', reason: 'Admin boost cap changes for the test account (BQ-2).' },
  { table: 'business_os_account_plans', reason: 'Plan state. A re-signup gets a fresh plan, which is the point of the cleanup.' },
  { table: 'business_os_entitlement_overrides', reason: 'Admin grants on the test account.' },
  { table: 'business_os_entitlement_shadow_events', reason: 'Resolver counters for the test account.' },
  { table: 'processed_webhook_events', reason: 'Webhook idempotency rows of the test account. G-6 / G-8 ensure no Stripe object still sends events for it.' },
  // Compliance projections. marketing_consent_events itself is append-only and must be empty (G-14).
  { table: 'marketing_consent_state', reason: 'Consent projection. Only reachable when the append-only event ledger is empty (G-14).' },
  { table: 'email_unsubscribes', reason: 'Unsubscribes collected by the test business. Kept by a purge so a rebuilt business cannot mail opt-outs. A removed test account mails nobody.' },
  // Account settings.
  { table: 'user_preferences', reason: 'Account settings of the test login.' },
  { table: 'notification_settings', reason: 'Account settings of the test login.' },
  { table: 'security_settings', reason: 'Account settings of the test login.' },
  { table: 'api_keys', reason: 'Account configuration of the test login.' },
  { table: 'audit_logs', reason: 'Legacy user-scoped log, distinct from audit_trail.' },
  { table: 'auth_handoff_codes', reason: 'Short-lived sign-in codes. Cascade with the login anyway, removed explicitly so the count is reported.' },
  // Agent platform and kernel learning.
  { table: 'agent_configurations', reason: 'Agent platform.' },
  { table: 'agent_execution_logs', reason: 'Agent platform.' },
  { table: 'agent_intensity_metrics', reason: 'Agent platform telemetry.' },
  { table: 'agent_stats', reason: 'Agent platform telemetry.' },
  { table: 'agent_templates', reason: 'Agent platform.' },
  { table: 'agentkit_analytics', reason: 'Agent platform.' },
  { table: 'calibration_history', reason: 'Kernel learning.' },
  { table: 'calibration_sessions', reason: 'Agent platform.' },
  { table: 'error_patterns', reason: 'Kernel learning.' },
  { table: 'execution_anomalies', reason: 'Kernel learning.' },
  { table: 'execution_baselines', reason: 'Kernel learning.' },
  { table: 'execution_insight_runs', reason: 'The other insights system (agent quality).' },
  { table: 'execution_insights', reason: 'The other insights system (agent quality).' },
  { table: 'pilot_step_routing_history', reason: 'Agent platform.' },
  { table: 'plugin_performance', reason: 'Kernel learning.' },
  { table: 'shadow_failure_snapshots', reason: 'Agent platform.' },
  { table: 'shared_agents', reason: 'Agents the test account shared. G-16 refuses when another account imported one (the cascade would remove their import).' },
  { table: 'workflow_executions', reason: 'Agent platform.' },
  // Org analytics.
  { table: 'advisor_reports', reason: 'Org analytics of the test account.' },
  { table: 'automation_slas', reason: 'Workflow SLAs of the test account.' },
  { table: 'group_metrics_rollup', reason: 'Workflow-group analytics of the test account.' },
  { table: 'metric_baselines', reason: 'Agent-execution analytics of the test account.' },
  { table: 'organization_members', reason: 'Memberships of the test login. G-13 refuses when another account is a member of an organisation it owns.' },
];

/**
 * Step C, after everything else, in this order, then the login itself.
 *
 * `business_profiles` is held back from step A (its TENANCY_ROOT band already
 * says "last"). `profiles` precedes `organizations` (profiles.org_id is NO
 * ACTION). The invitation-circle row and the invitations the account SENT go
 * last (BQ-3). The invitation that brought it in is kept.
 */
export const FINAL_STEPS: ReadonlyArray<{ table: string; column: string; reason: string }> = [
  { table: 'business_profiles', column: 'user_id', reason: 'The tenancy root. Cascades into every business-owned table, all already empty.' },
  { table: 'profiles', column: 'id', reason: 'NO ACTION to the login. Parent of nothing still present.' },
  { table: 'organizations', column: 'owner_user_id', reason: 'Organisations the test login owns. After profiles (profiles.org_id is NO ACTION). G-13 refuses when another account is inside.' },
  { table: 'business_os_account_lineage', column: 'account_id', reason: 'Its own place in the invitation circle (BQ-3). G-15 refuses when another account hangs below it.' },
  { table: 'business_os_invites', column: 'issuer_account_id', reason: 'Invitations the test account sent (BQ-3).' },
];

/** User-scoped descriptors that are never deleted: the delete refuses unless they are empty. */
export const MUST_BE_EMPTY: Readonly<Record<string, string>> = {
  admin_users: 'G-4. The target must not be a platform admin. Deleting admin rows locks admins out.',
  marketing_consent_events:
    'G-14. Append-only: its BEFORE DELETE trigger refuses every delete, including the cascade from the login. A test account that ever collected consent cannot be removed by this script.',
};

/** What stays after a clean run, and why. Reported by the check, excluded from CLEAN. */
export const KEPT_RESIDUE: ReadonlyArray<{ item: string; reason: string }> = [
  {
    item: 'business_os_invites redeemed or claimed by the account',
    reason: 'BQ-3: the invitation that brought it in stays as the record of what the inviter did. It holds only the pseudonymous id.',
  },
  { item: 'one audit_trail row', reason: 'The record of this cleanup, written with no user id.' },
];

/**
 * Measured NO ACTION / RESTRICT edges among step B and step C tables (prod,
 * 2026-10-06, purge_schema_introspect). The step A edges are BLOCKING_EDGES in
 * descriptors.ts. The test asserts child-before-parent for both lists.
 */
export const STEP_B_BLOCKING_EDGES: ReadonlyArray<{ child: string; parent: string }> = [
  { child: 'billing_events', parent: 'user_subscriptions' },
  { child: 'billing_events', parent: 'credit_transactions' },
  { child: 'boost_pack_purchases', parent: 'credit_transactions' },
  { child: 'user_rewards', parent: 'credit_transactions' },
  { child: 'credit_transactions', parent: 'token_usage' },
  { child: 'business_os_boost_purchases', parent: 'business_os_credit_lots' },
  { child: 'business_os_credit_lot_draws', parent: 'business_os_credit_lots' },
  { child: 'profiles', parent: 'organizations' },
];

/**
 * Foreign keys to the login that hold OTHER accounts' or platform rows (SA C-2).
 *
 * Deleting the login silently nulls or deletes these, with no 23503 to stop
 * it. Any row naming the target here is BLOCKED, except when the row's own
 * owner column is the target (then it is the account's own row).
 *
 * Every other FK to the login must be a TENANCY column of a table in the plan
 * (derived below). A FK on neither list is BLOCKED (fail closed).
 */
export const ACTOR_FOREIGN_KEYS: ReadonlyArray<{ schema: string; table: string; column: string; ownerColumn: string | null }> = [
  { schema: 'public', table: 'admin_users', column: 'granted_by', ownerColumn: 'user_id' },
  { schema: 'public', table: 'ais_scoring_weights', column: 'updated_by', ownerColumn: null },
  { schema: 'public', table: 'ais_system_config', column: 'updated_by', ownerColumn: null },
  { schema: 'public', table: 'exchange_rate_history', column: 'changed_by', ownerColumn: null },
  { schema: 'public', table: 'exchange_rates', column: 'updated_by', ownerColumn: null },
  { schema: 'public', table: 'marketing_consent_events', column: 'recorded_by', ownerColumn: 'user_id' },
  { schema: 'public', table: 'shared_agent_imports', column: 'imported_by_user_id', ownerColumn: null },
  { schema: 'public', table: 'sla_events', column: 'acknowledged_by', ownerColumn: null },
  { schema: 'public', table: 'system_settings_config', column: 'updated_by', ownerColumn: null },
  // Present only on older Supabase storage versions. Harmless when absent.
  { schema: 'storage', table: 'buckets', column: 'owner', ownerColumn: null },
  { schema: 'storage', table: 'objects', column: 'owner', ownerColumn: null },
];

/**
 * Tables that cascade or null from an organisation the target owns, with the
 * column naming their own account (G-13). A row of another account here would
 * be removed or rewritten by deleting the organisation.
 */
export const ORG_CHILD_TABLES: ReadonlyArray<{ table: string; ownerColumn: string }> = [
  { table: 'advisor_reports', ownerColumn: 'user_id' },
  { table: 'agents', ownerColumn: 'user_id' },
  { table: 'automation_slas', ownerColumn: 'user_id' },
  { table: 'execution_insights', ownerColumn: 'user_id' },
  { table: 'group_metrics_rollup', ownerColumn: 'user_id' },
  { table: 'metric_baselines', ownerColumn: 'user_id' },
  { table: 'organization_members', ownerColumn: 'user_id' },
  { table: 'profiles', ownerColumn: 'id' },
  // workflow_groups also cascades from organizations but has no owner column:
  // its rows belong to the organisation, which belongs to the target.
];

/**
 * DELETE-capable triggers on plan tables reviewed for this script (C-11), on
 * top of REVIEWED_DELETE_TRIGGERS. Any other one blocks (G-17). G-17 covers plan
 * tables, every table with a FK to the login, and every table with a FK into a
 * plan table (SA F-3): the login delete cascades into all three.
 */
export const EXTRA_REVIEWED_TRIGGERS: ReadonlyArray<{ table: string; trigger: string; note: string }> = [
  { table: 'storage_usage', trigger: 'trigger_update_storage_on_delete', note: 'AFTER DELETE, recomputes the storage quota of the same login. Runs before user_subscriptions.' },
  { table: 'storage_usage', trigger: 'trigger_update_storage_used', note: 'AFTER INSERT OR DELETE OR UPDATE, same quota bookkeeping.' },
  { table: 'marketing_consent_events', trigger: 'trg_mce_guard', note: 'BEFORE DELETE OR UPDATE, refuses every delete. Reached through the login cascade. Never fires here: G-14 requires zero rows of the target, and G-18 refuses rows of other accounts that point at its contacts.' },
];

/**
 * Every foreign key INTO a table this script empties (SA F-2), measured on prod
 * 2026-10-06 with purge_schema_introspect: [child table, constraint, owner column].
 *
 * Deleting a parent row CASCADEs, SET NULLs or SET DEFAULTs the rows that point
 * at it, with no 23503 to stop it, and those rows may belong to ANOTHER
 * account. G-18 reads the same edges from pg_constraint at run time and
 * refuses when a row points at a row this script removes while its owner
 * column names someone else. An edge missing here blocks by name (fail
 * closed), the same shape as G-10. G-13 and G-16 are reviewed instances of it.
 *
 * The owner column is `user_id` where the child has one. `null` means the
 * child has no owner column and its rows belong to the parent row (see
 * PARENT_OWNED_REASONS). `shared_agent_imports` is owned by its importer.
 */
export const INBOUND_FOREIGN_KEYS: ReadonlyArray<readonly [string, string, string | null]> = [
  ['advisor_reports', 'advisor_reports_org_id_fkey', 'user_id'],
  ['agent_configurations', 'agent_configurations_agent_id_fkey', 'user_id'],
  ['agent_executions', 'agent_executions_agent_id_fkey', 'user_id'],
  ['agent_group_memberships', 'agent_group_memberships_agent_id_fkey', null],
  ['agent_intensity_metrics', 'agent_intensity_metrics_agent_id_fkey', 'user_id'],
  ['agent_logs', 'agent_logs_agent_id_fkey', 'user_id'],
  ['agent_memory', 'agent_memory_agent_id_fkey', 'user_id'],
  ['agent_prompt_workflow_generation_sessions', 'agent_prompt_workflow_generation_sessions_agent_id_fkey', 'user_id'],
  ['agent_scheduler_state', 'agent_scheduler_state_agent_id_fkey', null],
  ['agent_scheduler_state', 'agent_scheduler_state_last_execution_id_fkey', null],
  ['agent_stats', 'agent_stats_agent_id_fkey', 'user_id'],
  ['agentkit_analytics', 'agentkit_analytics_agent_id_fkey', 'user_id'],
  ['agents', 'agents_org_id_fkey', 'user_id'],
  ['agents', 'fk_agents_last_calibration', 'user_id'],
  ['automation_slas', 'automation_slas_agent_id_fkey', 'user_id'],
  ['automation_slas', 'automation_slas_org_id_fkey', 'user_id'],
  ['billing_events', 'billing_events_subscription_id_fkey', 'user_id'],
  ['billing_events', 'billing_events_transaction_id_fkey', 'user_id'],
  ['boost_pack_purchases', 'boost_pack_purchases_transaction_id_fkey', 'user_id'],
  ['business_addresses', 'business_addresses_business_fk', 'user_id'],
  ['business_chat_action_log', 'business_chat_action_log_business_fk', 'user_id'],
  ['business_chat_conversation', 'business_chat_conversation_business_fk', 'user_id'],
  ['business_chat_plan_cache', 'business_chat_plan_cache_business_fk', 'user_id'],
  ['business_chat_saved_plans', 'business_chat_saved_plans_business_fk', 'user_id'],
  ['business_chat_verified_questions', 'business_chat_verified_questions_business_fk', 'user_id'],
  ['business_events', 'business_events_business_fk', 'user_id'],
  ['business_events', 'business_events_contact_id_fkey', 'user_id'],
  ['business_health_summaries', 'business_health_summaries_business_fk', 'user_id'],
  ['business_intake_forms', 'business_intake_forms_business_fk', 'user_id'],
  ['business_os_boost_purchases', 'business_os_boost_purchases_lot_id_fkey', 'user_id'],
  ['business_os_credit_charges', 'business_os_credit_charges_adjusts_action_id_fkey', 'user_id'],
  ['business_os_credit_lot_draws', 'business_os_credit_lot_draws_lot_id_fkey', 'user_id'],
  ['business_os_entitlement_overrides', 'business_os_entitlement_overrides_user_id_fkey', 'user_id'],
  ['business_profiles', 'business_profiles_address_id_fkey', 'user_id'],
  ['business_profiles', 'business_profiles_invoice_address_id_fkey', 'user_id'],
  ['business_subscribers', 'business_subscribers_business_fk', 'user_id'],
  ['business_subscribers', 'business_subscribers_promoted_contact_id_fkey', 'user_id'],
  ['calibration_history', 'calibration_history_agent_id_fkey', 'user_id'],
  ['calibration_history', 'calibration_history_session_id_fkey', 'user_id'],
  ['calibration_sessions', 'calibration_sessions_agent_id_fkey', 'user_id'],
  ['calibration_sessions', 'calibration_sessions_execution_id_fkey', 'user_id'],
  ['calibration_sessions', 'calibration_sessions_user_id_fkey', 'user_id'],
  ['channel_connections', 'channel_connections_business_fk', 'user_id'],
  ['channel_metrics_daily', 'channel_metrics_daily_business_fk', 'user_id'],
  ['contact_documents', 'contact_documents_business_fk', 'user_id'],
  ['contact_documents', 'contact_documents_contact_id_fkey', 'user_id'],
  ['credit_transactions', 'credit_transactions_token_usage_id_fkey', 'user_id'],
  ['crm_activities', 'crm_activities_business_fk', 'user_id'],
  ['crm_activities', 'crm_activities_contact_id_fkey', 'user_id'],
  ['crm_contacts', 'crm_contacts_business_fk', 'user_id'],
  ['crm_pipeline_stages', 'crm_pipeline_stages_business_fk', 'user_id'],
  ['crm_tasks', 'crm_tasks_business_fk', 'user_id'],
  ['crm_tasks', 'crm_tasks_contact_id_fkey', 'user_id'],
  ['daily_briefing_sends', 'daily_briefing_sends_business_fk', 'user_id'],
  ['daily_briefings', 'daily_briefings_business_fk', 'user_id'],
  ['data_decision_requests', 'fk_data_decision_requests_agent', 'user_id'],
  ['data_decision_requests', 'fk_data_decision_requests_execution', 'user_id'],
  ['derived_metrics', 'derived_metrics_business_fk', 'user_id'],
  ['email_campaigns', 'email_campaigns_business_fk', 'user_id'],
  ['email_sends', 'email_sends_business_fk', 'user_id'],
  ['email_sends', 'email_sends_campaign_id_fkey', 'user_id'],
  ['email_sends', 'email_sends_contact_id_fkey', 'user_id'],
  ['email_sends', 'email_sends_sequence_id_fkey', 'user_id'],
  ['email_sends', 'email_sends_sequence_step_id_fkey', 'user_id'],
  ['email_sequence_enrollments', 'email_sequence_enrollments_business_fk', 'user_id'],
  ['email_sequence_enrollments', 'email_sequence_enrollments_contact_id_fkey', 'user_id'],
  ['email_sequence_enrollments', 'email_sequence_enrollments_sequence_id_fkey', 'user_id'],
  ['email_sequence_steps', 'email_sequence_steps_business_fk', 'user_id'],
  ['email_sequence_steps', 'email_sequence_steps_sequence_id_fkey', 'user_id'],
  ['email_sequences', 'email_sequences_business_fk', 'user_id'],
  ['email_unsubscribes', 'email_unsubscribes_contact_id_fkey', 'user_id'],
  ['error_patterns', 'error_patterns_agent_id_fkey', 'user_id'],
  ['execution_anomalies', 'execution_anomalies_agent_id_fkey', 'user_id'],
  ['execution_anomalies', 'execution_anomalies_execution_id_fkey', 'user_id'],
  ['execution_baselines', 'execution_baselines_agent_id_fkey', 'user_id'],
  ['execution_insight_runs', 'execution_insight_runs_agent_id_fkey', 'user_id'],
  ['execution_insight_runs', 'execution_insight_runs_execution_id_fkey', 'user_id'],
  ['execution_insight_runs', 'execution_insight_runs_insight_id_fkey', 'user_id'],
  ['execution_insights', 'execution_insights_agent_id_fkey', 'user_id'],
  ['execution_insights', 'execution_insights_org_id_fkey', 'user_id'],
  ['execution_metrics', 'execution_metrics_agent_id_fkey', null],
  ['execution_metrics', 'execution_metrics_execution_id_fkey', null],
  ['execution_routing_decisions', 'execution_routing_decisions_execution_id_fkey', null],
  ['external_calendar_events', 'external_calendar_events_business_fk', 'user_id'],
  ['group_metrics_rollup', 'group_metrics_rollup_org_id_fkey', 'user_id'],
  ['insight_actions', 'insight_actions_booking_id_fkey', 'user_id'],
  ['insight_actions', 'insight_actions_business_fk', 'user_id'],
  ['insight_actions', 'insight_actions_contact_id_fkey', 'user_id'],
  ['insight_actions', 'insight_actions_insight_id_fkey', 'user_id'],
  ['insight_actions', 'insight_actions_invoice_id_fkey', 'user_id'],
  ['insight_automations', 'insight_automations_business_fk', 'user_id'],
  ['insight_automations', 'insight_automations_created_from_insight_id_fkey', 'user_id'],
  ['insight_automations', 'insight_automations_last_run_execution_id_fkey', 'user_id'],
  // Live-only tables (no CREATE TABLE in the repo), measured 2026-10-07 on the first live run.
  ['insight_hypotheses', 'insight_hypotheses_business_fk', 'user_id'],
  ['insight_measurements', 'insight_measurements_business_fk', 'user_id'],
  ['insight_measurements', 'insight_measurements_insight_id_fkey', 'user_id'],
  ['insights', 'insights_business_fk', 'user_id'],
  ['insights', 'insights_correlation_parent_id_fkey', 'user_id'],
  ['kernel_action_log', 'kernel_action_log_execution_id_fkey', 'user_id'],
  ['kernel_action_log', 'kernel_action_log_insight_id_fkey', 'user_id'],
  ['kernel_executions', 'kernel_executions_insight_id_fkey', 'user_id'],
  ['lead_responses', 'lead_responses_business_fk', 'user_id'],
  ['lead_responses', 'lead_responses_contact_id_fkey', 'user_id'],
  ['marketing_consent_events', 'marketing_consent_events_contact_id_fkey', 'user_id'],
  ['marketing_consent_settings', 'marketing_consent_settings_business_fk', 'user_id'],
  ['marketing_consent_state', 'marketing_consent_state_contact_id_fkey', 'user_id'],
  ['metric_baselines', 'metric_baselines_org_id_fkey', 'user_id'],
  ['onboarding_prompt_ideas', 'onboarding_prompt_ideas_agent_created_id_fkey', 'user_id'],
  ['organization_members', 'organization_members_org_id_fkey', 'user_id'],
  ['owner_insight_history', 'owner_insight_history_business_fk', 'user_id'],
  ['owner_insight_history', 'owner_insight_history_insight_id_fkey', 'user_id'],
  ['payment_automation_executions', 'payment_automation_executions_business_fk', 'user_id'],
  ['payment_automation_executions', 'payment_automation_executions_rule_id_fkey', 'user_id'],
  ['payment_automation_executions', 'payment_automation_executions_trigger_event_id_fkey', 'user_id'],
  ['payment_automation_rules', 'payment_automation_rules_business_fk', 'user_id'],
  ['payment_events', 'payment_events_business_fk', 'user_id'],
  ['payment_events', 'payment_events_contact_id_fkey', 'user_id'],
  ['payment_invoices', 'payment_invoices_booking_id_fkey', 'user_id'],
  ['payment_invoices', 'payment_invoices_business_fk', 'user_id'],
  ['payment_invoices', 'payment_invoices_contact_id_fkey', 'user_id'],
  ['payment_invoices', 'payment_invoices_service_id_fkey', 'user_id'],
  ['payment_methods', 'payment_methods_business_fk', 'user_id'],
  ['payment_plan_installments', 'payment_plan_installments_booking_id_fkey', 'user_id'],
  ['payment_plan_installments', 'payment_plan_installments_business_fk', 'user_id'],
  ['payment_plan_installments', 'payment_plan_installments_contact_id_fkey', 'user_id'],
  ['payment_plan_installments', 'payment_plan_installments_invoice_id_fkey', 'user_id'],
  ['payment_plan_installments', 'payment_plan_installments_payment_plan_id_fkey', 'user_id'],
  ['payment_plan_installments', 'payment_plan_installments_proposal_id_fkey', 'user_id'],
  ['payment_plan_installments', 'payment_plan_installments_subscription_id_fkey', 'user_id'],
  ['payment_plan_installments', 'payment_plan_installments_transaction_id_fkey', 'user_id'],
  ['payment_plan_subscriptions', 'payment_plan_subscriptions_booking_id_fkey', 'user_id'],
  ['payment_plan_subscriptions', 'payment_plan_subscriptions_business_fk', 'user_id'],
  ['payment_plan_subscriptions', 'payment_plan_subscriptions_contact_id_fkey', 'user_id'],
  ['payment_plan_subscriptions', 'payment_plan_subscriptions_payment_plan_id_fkey', 'user_id'],
  ['payment_plan_subscriptions', 'payment_plan_subscriptions_service_id_fkey', 'user_id'],
  ['payment_plans', 'payment_plans_business_fk', 'user_id'],
  ['payment_plans', 'payment_plans_service_id_fkey', 'user_id'],
  ['payment_processors', 'payment_processors_business_fk', 'user_id'],
  ['payment_refunds', 'payment_refunds_business_fk', 'user_id'],
  ['payment_refunds', 'payment_refunds_invoice_id_fkey', 'user_id'],
  ['payment_refunds', 'payment_refunds_transaction_id_fkey', 'user_id'],
  ['payment_reminders', 'payment_reminders_business_fk', 'user_id'],
  ['payment_reminders', 'payment_reminders_contact_id_fkey', 'user_id'],
  ['payment_reminders', 'payment_reminders_installment_id_fkey', 'user_id'],
  ['payment_reminders', 'payment_reminders_invoice_id_fkey', 'user_id'],
  ['payment_transactions', 'payment_transactions_booking_id_fkey', 'user_id'],
  ['payment_transactions', 'payment_transactions_business_fk', 'user_id'],
  ['payment_transactions', 'payment_transactions_contact_id_fkey', 'user_id'],
  ['payment_transactions', 'payment_transactions_invoice_id_fkey', 'user_id'],
  ['payment_transactions', 'payment_transactions_service_id_fkey', 'user_id'],
  ['plugin_performance', 'plugin_performance_agent_id_fkey', 'user_id'],
  ['profiles', 'profiles_org_id_fkey', 'id'],
  ['proposals', 'proposals_booking_id_fkey', 'user_id'],
  ['proposals', 'proposals_business_fk', 'user_id'],
  ['proposals', 'proposals_contact_id_fkey', 'user_id'],
  ['proposals', 'proposals_created_invoice_id_fkey', 'user_id'],
  ['proposals', 'proposals_created_plan_id_fkey', 'user_id'],
  ['proposals', 'proposals_document_id_fkey', 'user_id'],
  ['proposals', 'proposals_package_booking_id_fkey', 'user_id'],
  ['proposals', 'proposals_service_id_fkey', 'user_id'],
  ['proposals', 'proposals_supersedes_id_fkey', 'user_id'],
  ['run_memories', 'run_memories_agent_id_fkey', 'user_id'],
  ['saved_payment_methods', 'saved_payment_methods_business_fk', 'user_id'],
  ['saved_payment_methods', 'saved_payment_methods_contact_id_fkey', 'user_id'],
  ['scheduling_availability_exceptions', 'scheduling_availability_exceptions_business_fk', 'user_id'],
  ['scheduling_bookings', 'scheduling_bookings_business_fk', 'user_id'],
  ['scheduling_bookings', 'scheduling_bookings_contact_id_fkey', 'user_id'],
  ['scheduling_bookings', 'scheduling_bookings_invoice_id_fkey', 'user_id'],
  ['scheduling_bookings', 'scheduling_bookings_parent_booking_id_fkey', 'user_id'],
  ['scheduling_bookings', 'scheduling_bookings_payment_plan_id_fkey', 'user_id'],
  ['scheduling_bookings', 'scheduling_bookings_service_id_fkey', 'user_id'],
  ['scheduling_services', 'scheduling_services_business_fk', 'user_id'],
  ['shadow_failure_snapshots', 'shadow_failure_snapshots_agent_id_fkey', 'user_id'],
  ['shared_agent_imports', 'shared_agent_imports_created_agent_id_fkey', 'imported_by_user_id'],
  ['shared_agent_imports', 'shared_agent_imports_shared_agent_id_fkey', 'imported_by_user_id'],
  ['shared_agents', 'fk_shared_agents_original_agent', 'user_id'],
  ['sla_events', 'sla_events_sla_id_fkey', null],
  ['smart_link_clicks', 'smart_link_clicks_smart_link_id_fkey', null],
  ['smart_links', 'smart_links_business_fk', 'user_id'],
  ['stripe_connect_accounts', 'stripe_connect_accounts_business_fk', 'user_id'],
  ['user_capabilities', 'user_capabilities_business_fk', 'user_id'],
  ['user_capability_blocks', 'user_capability_blocks_user_capability_id_fkey', null],
  ['user_intake_settings', 'user_intake_settings_business_fk', 'user_id'],
  ['user_media', 'user_media_business_fk', 'user_id'],
  ['user_memory', 'user_memory_source_agent_id_fkey', 'user_id'],
  ['user_rewards', 'user_rewards_transaction_id_fkey', 'user_id'],
  ['website_blocks', 'website_blocks_page_id_fkey', null],
  ['website_content', 'website_content_business_fk', 'user_id'],
  ['website_page_views', 'website_page_views_business_fk', 'user_id'],
  ['website_page_views', 'website_page_views_page_id_fkey', 'user_id'],
  ['website_pages', 'website_pages_business_fk', 'user_id'],
  ['workflow_groups', 'workflow_groups_org_id_fkey', null],
];

/** Why a child without an owner column is safe to lose with its parent. */
export const PARENT_OWNED_REASONS: Readonly<Record<string, string>> = {
  agent_group_memberships: 'Group memberships of the target agents. The agent belongs to the target.',
  agent_scheduler_state: 'Scheduler state of the target agents (a purge descriptor, reached through agents).',
  execution_metrics: 'Metrics of the target agents and workflow runs.',
  execution_routing_decisions: 'Routing decisions of the target agent runs.',
  sla_events: 'Events of the target SLAs. The actor column is checked separately by G-10.',
  smart_link_clicks: 'Clicks on the target links (a purge descriptor, reached through smart_links).',
  user_capability_blocks: 'Blocks of the target capabilities (a purge descriptor).',
  website_blocks: 'Blocks of the target pages (a purge descriptor, reached through website_pages).',
  workflow_groups: 'Groups of an organisation the target owns. G-13 refuses when another account is inside it.',
};

// ════════════════════════════════════════════════════════════════════════════
// The plan
// ════════════════════════════════════════════════════════════════════════════

export interface PlanEntry {
  step: 'A' | 'B' | 'C';
  table: string;
  /** Column compared with the account id (for `via`, the FK to the parent). */
  column: string;
  /** Set for `via` scope: the parent table, keyed by `user_id`. */
  parent: string | null;
}

/** Every delete, in order. The login itself follows the last entry. */
export function buildCleanupPlan(): PlanEntry[] {
  const stepA: PlanEntry[] = descriptorsForRun('purge', { integrations: true, agents: true, activityHistory: true })
    .filter((d) => !FINAL_STEPS.some((f) => f.table === d.table))
    .map((d) => {
      if (d.scope.kind === 'via') return { step: 'A', table: d.table, column: d.scope.fk, parent: d.scope.parent };
      return { step: 'A', table: d.table, column: KEY_COLUMN_OVERRIDES[d.table] ?? 'user_id', parent: null };
    });
  const stepB: PlanEntry[] = FULL_REMOVAL_EXTRAS.map((e) => ({
    step: 'B',
    table: e.table,
    column: KEY_COLUMN_OVERRIDES[e.table] ?? 'user_id',
    parent: null,
  }));
  const stepC: PlanEntry[] = FINAL_STEPS.map((f) => ({ step: 'C', table: f.table, column: f.column, parent: null }));
  return [...stepA, ...stepB, ...stepC];
}

/** FKs to the login that are the account's OWN rows: the key column of every plan or must-be-empty table. */
export function tenancyForeignKeys(): Array<{ schema: string; table: string; column: string }> {
  const keys = new Map<string, { schema: string; table: string; column: string }>();
  const add = (table: string, column: string) => keys.set(`${table}.${column}`, { schema: 'public', table, column });
  for (const entry of buildCleanupPlan()) if (entry.parent === null) add(entry.table, entry.column);
  for (const table of Object.keys(MUST_BE_EMPTY)) add(table, 'user_id');
  return [...keys.values()].sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`));
}

// ════════════════════════════════════════════════════════════════════════════
// SQL rendering
// ════════════════════════════════════════════════════════════════════════════

/** A SQL string literal. Inputs are generator constants, never user data. */
const lit = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const litOrNull = (value: string | null): string => (value === null ? 'NULL' : lit(value));
const litList = (values: readonly string[]): string => values.map(lit).join(', ');

/** Run `query` (which selects one column `row_count`) and read the number back, without a DO block. */
const countOf = (queryExpr: string): string =>
  `(xpath('/row/row_count/text()', query_to_xml(${queryExpr}, false, true, '')))[1]::text::bigint`;

function planValues(indent: string): string {
  const rows = buildCleanupPlan().map(
    (entry, index) =>
      `${indent}(${index + 1}, ${lit(entry.step)}, ${lit(entry.table)}, ${lit(entry.column)}, ${litOrNull(entry.parent)})`
  );
  // The first row carries the types so a NULL parent is typed text.
  rows[0] = rows[0].replace(/^(\s*)\((\d+), ('[^']*'), ('[^']*'), ('[^']*'), (NULL|'[^']*')\)$/, '$1($2, $3::text, $4::text, $5::text, $6::text)');
  return rows.join(',\n');
}

/** The CTEs both files share: settings, the target, the plan and the catalog read. */
function sharedCtes(): string {
  const reviewed = [
    ...tenancyForeignKeys().map((fk) => `(${lit(fk.schema)}, ${lit(fk.table)}, ${lit(fk.column)}, 'tenancy', NULL)`),
    ...ACTOR_FOREIGN_KEYS.map(
      (fk) => `(${lit(fk.schema)}, ${lit(fk.table)}, ${lit(fk.column)}, 'actor', ${litOrNull(fk.ownerColumn)})`
    ),
  ];
  reviewed[0] = reviewed[0].replace(/^\(('[^']*'), ('[^']*'), ('[^']*'), ('[^']*'), (NULL|'[^']*')\)$/, '($1::text, $2::text, $3::text, $4::text, $5::text)');
  const inbound = INBOUND_FOREIGN_KEYS.map(([child, constraint, owner]) => `(${lit(child)}, ${lit(constraint)}, ${litOrNull(owner)})`);
  inbound[0] = inbound[0].replace(/^\(('[^']*'), ('[^']*'), (NULL|'[^']*')\)$/, '($1::text, $2::text, $3::text)');

  return `params AS (
  SELECT
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '') AS target_email,
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.test_tag', true), ''))), '') AS test_tag
),
matches AS (
  SELECT users.id AS user_id
  FROM auth.users AS users
  JOIN params ON lower(users.email) = params.target_email
),
target AS (
  SELECT CASE WHEN (SELECT count(*) FROM matches) = 1 THEN (SELECT matches.user_id FROM matches LIMIT 1) END AS user_id
),
target_orgs AS (
  SELECT orgs.id AS org_id
  FROM public.organizations AS orgs
  JOIN target ON orgs.owner_user_id = target.user_id
),
plan AS (
  SELECT plan_values.ord, plan_values.step, plan_values.table_name, plan_values.key_column, plan_values.parent_table
  FROM (VALUES
${planValues('    ')}
  ) AS plan_values(ord, step, table_name, key_column, parent_table)
),
plan_state AS (
  SELECT
    plan.*,
    to_regclass(format('public.%I', plan.table_name)) IS NOT NULL AS present,
    EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.table_name AND cols.column_name = plan.key_column
    ) AS key_ok,
    (plan.parent_table IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'public' AND cols.table_name = plan.parent_table AND cols.column_name = 'user_id'
    )) AS parent_ok
  FROM plan
),
fk_catalog AS (
  SELECT
    nsp.nspname::text AS fk_schema,
    rel.relname::text AS fk_table,
    att.attname::text AS fk_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'
),
fk_review AS (
  SELECT reviewed.fk_schema, reviewed.fk_table, reviewed.fk_column, reviewed.kind, reviewed.owner_column
  FROM (VALUES
    ${reviewed.join(',\n    ')}
  ) AS reviewed(fk_schema, fk_table, fk_column, kind, owner_column)
),
fk_rows AS (
  SELECT
    fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, fk_catalog.key_width, fk_review.kind,
    CASE
      WHEN target.user_id IS NULL OR fk_review.kind = 'tenancy' OR fk_catalog.key_width <> 1 THEN 0
      ELSE ${countOf(`format('SELECT count(*) AS row_count FROM %I.%I WHERE %I = %L AND %s', fk_catalog.fk_schema, fk_catalog.fk_table, fk_catalog.fk_column, target.user_id, CASE WHEN fk_review.owner_column IS NULL THEN 'true' ELSE format('%I IS DISTINCT FROM %L', fk_review.owner_column, target.user_id) END)`)}
    END AS found
  FROM fk_catalog
  CROSS JOIN target
  LEFT JOIN fk_review USING (fk_schema, fk_table, fk_column)
),
inbound_catalog AS (
  SELECT
    con.conname::text AS fk_name,
    child_nsp.nspname::text AS child_schema,
    child_rel.relname::text AS child_table,
    child_att.attname::text AS child_column,
    parent_rel.relname::text AS parent_table,
    parent_att.attname::text AS parent_column,
    cardinality(con.conkey) AS key_width
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS child_att ON child_att.attrelid = con.conrelid AND child_att.attnum = con.conkey[1]
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS parent_att ON parent_att.attrelid = con.confrelid AND parent_att.attnum = con.confkey[1]
  WHERE con.contype = 'f' AND parent_nsp.nspname = 'public' AND parent_rel.relname IN (SELECT plan.table_name FROM plan)
),
inbound_review AS (
  SELECT reviewed.child_table, reviewed.fk_name, reviewed.owner_column
  FROM (VALUES
    ${inbound.join(',\n    ')}
  ) AS reviewed(child_table, fk_name, owner_column)
),
inbound_joined AS (
  SELECT
    inbound_catalog.*,
    inbound_review.child_table IS NOT NULL AND inbound_catalog.child_schema = 'public' AS reviewed,
    inbound_review.owner_column,
    (inbound_review.owner_column IS NULL OR EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = inbound_catalog.child_schema AND cols.table_name = inbound_catalog.child_table AND cols.column_name = inbound_review.owner_column
    )) AS owner_ok,
    CASE WHEN plan.parent_table IS NULL
      THEN format('%I = %L', plan.key_column, target.user_id)
      ELSE format('%I IN (SELECT id FROM public.%I WHERE user_id = %L)', plan.key_column, plan.parent_table, target.user_id)
    END AS parent_predicate,
    plan.ord AS parent_ord,
    plan.parent_table IS NULL AND inbound_catalog.parent_column = plan.key_column
      AND inbound_catalog.child_column = inbound_review.owner_column AS owner_is_target,
    target.user_id
  FROM inbound_catalog
  JOIN plan ON plan.table_name = inbound_catalog.parent_table
  CROSS JOIN target
  LEFT JOIN inbound_review USING (child_table, fk_name)
),
inbound_parents AS (
  SELECT
    needed.parent_ord,
    ${countOf(`format('SELECT count(*) AS row_count FROM (SELECT 1 FROM public.%I WHERE %s LIMIT 1) AS one_row', needed.parent_table, needed.parent_predicate)`)} AS found
  FROM (
    SELECT DISTINCT inbound_joined.parent_ord, inbound_joined.parent_table, inbound_joined.parent_predicate
    FROM inbound_joined
    WHERE inbound_joined.user_id IS NOT NULL AND inbound_joined.reviewed AND inbound_joined.owner_column IS NOT NULL
      AND inbound_joined.owner_ok AND inbound_joined.key_width = 1 AND NOT inbound_joined.owner_is_target
  ) AS needed
),
inbound_rows AS (
  SELECT
    inbound_joined.*,
    CASE
      WHEN inbound_joined.user_id IS NULL OR NOT inbound_joined.reviewed OR inbound_joined.owner_column IS NULL
        OR NOT inbound_joined.owner_ok OR inbound_joined.key_width <> 1 THEN 0
      WHEN inbound_joined.owner_is_target OR inbound_parents.found = 0 THEN 0
      ELSE ${countOf(`format('SELECT count(*) AS row_count FROM %I.%I AS child_rows WHERE child_rows.%I IN (SELECT %I FROM public.%I WHERE %s) AND child_rows.%I IS DISTINCT FROM %L', inbound_joined.child_schema, inbound_joined.child_table, inbound_joined.child_column, inbound_joined.parent_column, inbound_joined.parent_table, inbound_joined.parent_predicate, inbound_joined.owner_column, inbound_joined.user_id)`)}
    END AS found
  FROM inbound_joined
  LEFT JOIN inbound_parents USING (parent_ord)
)`;
}

/** One guard row. `countSql` may read `target.user_id` and `params.*`. */
function guard(id: string, item: string, countSql: string, clears: string, blockedWhen = 'counted.found > 0'): string {
  return `SELECT ${lit(id)}::text AS guard, ${lit(item)}::text AS item, counted.found::bigint AS found, (${blockedWhen}) AS blocked, ${lit(clears)}::text AS clears
  FROM (SELECT (${countSql}) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted`;
}

/** The guard rows (G-1, G-2, G-4 to G-18). G-3, the typed confirmation, is checked in the delete block. */
function guardRowsCte(): string {
  const uid = 'target.user_id';
  const reviewedTriggers = [...REVIEWED_DELETE_TRIGGERS, ...EXTRA_REVIEWED_TRIGGERS]
    .map((t) => `(${lit(t.table)}, ${lit(t.trigger)})`)
    .join(', ');
  const buckets = litList(STORAGE_DESCRIPTORS.map((s) => s.bucket));

  const rows: string[] = [
    guard(
      'G-1',
      'exactly one login has this email',
      '(SELECT count(*) FROM matches)',
      'Edit the email line at the top. It must match exactly one login.',
      'counted.target_email IS NULL OR counted.found <> 1'
    ),
    guard(
      'G-2',
      'the email contains the test tag',
      `CASE WHEN params.test_tag IS NULL OR params.target_email IS NULL THEN 0 ELSE sign(strpos(params.target_email, params.test_tag)) END`,
      'Only an email containing the test tag can be removed. Set the tag line (never empty) or pick a test account.',
      'counted.test_tag IS NULL OR counted.found <> 1'
    ),
    guard(
      'G-4',
      'not a platform admin',
      `(SELECT count(*) FROM public.admin_users AS admins WHERE admins.user_id = ${uid} OR lower(admins.email) = params.target_email)`,
      'Admins are never removed here. Remove the admin row by hand first if this really is a test account.'
    ),
    guard(
      'G-5',
      'nothing ever ran in Stripe live mode',
      `(SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = ${uid} AND billing.livemode)
      + (SELECT count(*) FROM public.business_os_boost_purchases AS boosts WHERE boosts.user_id = ${uid} AND boosts.livemode)
      + (SELECT count(*) FROM public.business_os_billing_events AS money WHERE money.user_id = ${uid} AND money.livemode)`,
      'Real money. This account is not a test account and must not be removed.'
    ),
    guard(
      'G-6',
      'no live plan subscription, test or live mode',
      `(SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = ${uid}
        AND (billing.subscription_status IN (${litList(R3_LIVE_STATUSES)}) OR (billing.stripe_subscription_id IS NOT NULL AND billing.ended_at IS NULL)))`,
      'Cancel the subscription in the Stripe dashboard, in its mode, then wait for the webhook.'
    ),
    guard(
      'G-7',
      'legacy subscription with a Stripe id',
      `(SELECT count(*) FROM public.user_subscriptions AS legacy WHERE legacy.user_id = ${uid} AND legacy.stripe_subscription_id IS NOT NULL)`,
      'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.'
    ),
    guard(
      'G-7',
      'legacy credit payment with a Stripe id',
      `(SELECT count(*) FROM public.credit_transactions AS legacy WHERE legacy.user_id = ${uid} AND legacy.stripe_payment_intent_id IS NOT NULL)`,
      'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.'
    ),
    guard(
      'G-7',
      'legacy billing event from Stripe',
      `(SELECT count(*) FROM public.billing_events AS legacy WHERE legacy.user_id = ${uid} AND legacy.stripe_event_id IS NOT NULL)`,
      'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.'
    ),
    guard(
      'G-8',
      'no Stripe account connected for client payments',
      `(SELECT count(*) FROM public.stripe_connect_accounts AS connect WHERE connect.user_id = ${uid})
      + (SELECT count(*) FROM public.plugin_connections AS plugins WHERE plugins.user_id = ${uid} AND plugins.plugin_key = 'stripe')`,
      'Disconnect Stripe from the business first.'
    ),
    ...LOCAL_BLOCKING_CONDITIONS.map((condition) =>
      guard(
        'G-9',
        `money in flight: ${condition.label}`,
        `(SELECT count(*) FROM public.${condition.table} AS money WHERE money.user_id = ${uid} AND money.status IN (${litList(condition.statuses)}))`,
        'Finish or cancel these in the app first.'
      )
    ),
    `SELECT 'G-10'::text AS guard, fk_rows.fk_schema || '.' || fk_rows.fk_table || '.' || fk_rows.fk_column AS item, fk_rows.found::bigint AS found, true AS blocked,
    CASE WHEN fk_rows.kind IS NULL OR fk_rows.key_width <> 1
      THEN 'A link to the login nobody has reviewed. Engineering must classify it in the generator first.'
      ELSE 'Rows of other accounts or of the platform name this login. Clear them by hand first.' END AS clears
  FROM fk_rows
  WHERE fk_rows.kind IS NULL OR fk_rows.key_width <> 1 OR (fk_rows.kind = 'actor' AND fk_rows.found > 0)`,
    `SELECT 'G-10'::text AS guard, 'links to the login, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears FROM fk_catalog`,
    `SELECT 'G-11'::text AS guard, plan_state.table_name || '.' || plan_state.key_column AS item, NULL::bigint AS found, true AS blocked,
    'A column this script relies on is missing. Regenerate the script after the schema change.'::text AS clears
  FROM plan_state
  WHERE plan_state.present AND NOT (plan_state.key_ok AND plan_state.parent_ok)`,
    guard(
      'G-12',
      'no stored files under the account folder',
      `(SELECT count(*) FROM storage.objects AS objects WHERE objects.bucket_id IN (${buckets}) AND starts_with(objects.name, ${uid}::text || '/'))`,
      'Empty the listed folders in the Supabase Storage dashboard, then run the check again.'
    ),
    ...ORG_CHILD_TABLES.map((child) =>
      guard(
        'G-13',
        `no other account in its organisation: ${child.table}`,
        `(SELECT count(*) FROM public.${child.table} AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.${child.ownerColumn} IS DISTINCT FROM ${uid})`,
        'Another account belongs to an organisation this login owns. Move it out first.'
      )
    ),
    guard(
      'G-14',
      'no consent ledger rows',
      `(SELECT count(*) FROM public.marketing_consent_events AS consent WHERE consent.user_id = ${uid})`,
      'The consent ledger is append-only and cannot be removed. This account cannot be cleaned by this script.'
    ),
    guard(
      'G-15',
      'nobody else hangs below it in the invitation circle',
      `(SELECT count(*) FROM public.business_os_account_lineage AS lineage WHERE (lineage.parent_account_id = ${uid} OR lineage.root_account_id = ${uid}) AND lineage.account_id IS DISTINCT FROM ${uid})`,
      'It invited an account that still exists. Remove that account first.'
    ),
    guard(
      'G-16',
      'no other account imported its shared agents',
      `(SELECT count(*) FROM public.shared_agent_imports AS imports JOIN public.shared_agents AS shared ON shared.id = imports.shared_agent_id WHERE shared.user_id = ${uid} AND imports.imported_by_user_id IS DISTINCT FROM ${uid})`,
      'Another account imported an agent it shared. Engineering must review this account.'
    ),
    `SELECT 'G-17'::text AS guard, rel.relname || '.' || trg.tgname AS item, 1::bigint AS found, true AS blocked,
    'A trigger on a table this script empties has not been reviewed. Engineering must review it in the generator first.'::text AS clears
  FROM pg_catalog.pg_trigger AS trg
  JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public' AND NOT trg.tgisinternal AND (trg.tgtype::integer & 8) <> 0
    AND (
      rel.relname IN (SELECT plan.table_name FROM plan)
      OR rel.oid IN (SELECT fk_con.conrelid FROM pg_catalog.pg_constraint AS fk_con WHERE fk_con.contype = 'f' AND fk_con.confrelid = 'auth.users'::regclass)
      OR rel.relname IN (SELECT inbound_catalog.child_table FROM inbound_catalog WHERE inbound_catalog.child_schema = 'public')
    )
    AND (rel.relname::text, trg.tgname::text) NOT IN (VALUES ${reviewedTriggers})`,
    `SELECT 'G-18'::text AS guard, inbound_rows.child_schema || '.' || inbound_rows.child_table || '.' || inbound_rows.child_column || ' to ' || inbound_rows.parent_table AS item,
    inbound_rows.found::bigint AS found, true AS blocked,
    CASE
      WHEN NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1
        THEN 'A link pointing at a table this script empties has not been reviewed. Engineering must classify it in the generator first.'
      WHEN NOT inbound_rows.owner_ok
        THEN 'The owner column of this link is missing. Regenerate the script after the schema change.'
      ELSE 'Rows of another account point at rows this script removes, and would be deleted or emptied with them. Engineering must review this account.'
    END AS clears
  FROM inbound_rows
  WHERE NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1 OR NOT inbound_rows.owner_ok OR inbound_rows.found > 0`,
    `SELECT 'G-18'::text AS guard, 'links pointing at removed tables, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears FROM inbound_catalog`,
  ];

  return `guard_rows AS (
  ${rows.join('\n  UNION ALL\n  ')}
)`;
}

const EDIT_LINES = `SELECT set_config('cleanup.target_email', ${lit(PLACEHOLDER_EMAIL)}, true) AS edit_target_email;
-- 2. The test tag. Only an account whose email contains this text can be removed. Never leave it empty.
SELECT set_config('cleanup.test_tag', ${lit(DEFAULT_TEST_TAG)}, true) AS edit_test_tag;`;

export function renderCheckSql(): string {
  return `-- TEST ACCOUNT CLEANUP, CHECK. Read-only. Edit the two lines below, then run the whole file.
-- Runbook: docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md
-- 1. The email of the test account to remove.
${EDIT_LINES}

${buildCheckQuery()};
`;
}

/** The check statement, no edit lines, no trailing `;`. Reads `cleanup.target_email` and `cleanup.test_tag`. */
export function buildCheckQuery(): string {
  return `${checkCtes()}
SELECT report.section, report.status, report.item, report.found, report.detail
FROM report
ORDER BY report.section_order, report.sort_order, report.item`;
}

/** The same check as one jsonb array, ordered by explicit keys (R-2 g). */
export function buildCheckJson(): string {
  return `${checkCtes()}
SELECT jsonb_agg(jsonb_build_object('section', report.section, 'status', report.status, 'item', report.item, 'found', report.found, 'detail', report.detail)
  ORDER BY report.section_order, report.sort_order, report.item)
FROM report`;
}

/** Every CTE of the check, ending with `report`. */
function checkCtes(): string {
  const buckets = litList(STORAGE_DESCRIPTORS.map((s) => s.bucket));
  return `WITH
${sharedCtes()},
${guardRowsCte()},
removal AS (
  SELECT
    plan_state.ord, plan_state.step, plan_state.table_name, plan_state.present,
    CASE
      WHEN NOT plan_state.present OR NOT (plan_state.key_ok AND plan_state.parent_ok) OR target.user_id IS NULL THEN NULL
      WHEN plan_state.parent_table IS NULL
        THEN ${countOf(`format('SELECT count(*) AS row_count FROM public.%I WHERE %I = %L', plan_state.table_name, plan_state.key_column, target.user_id)`)}
      ELSE ${countOf(`format('SELECT count(*) AS row_count FROM public.%I WHERE %I IN (SELECT id FROM public.%I WHERE user_id = %L)', plan_state.table_name, plan_state.key_column, plan_state.parent_table, target.user_id)`)}
    END AS found
  FROM plan_state
  CROSS JOIN target
),
report AS (
  SELECT 0 AS section_order, 'VERDICT'::text AS section, 0 AS sort_order,
    CASE WHEN (SELECT count(*) FROM guard_rows WHERE guard_rows.blocked) = 0 THEN 'OK' ELSE 'BLOCKED' END AS status,
    'login ' || coalesce((SELECT target.user_id::text FROM target), 'not found') AS item,
    (SELECT count(*) FROM guard_rows WHERE guard_rows.blocked)::bigint AS found,
    CASE WHEN (SELECT count(*) FROM guard_rows WHERE guard_rows.blocked) = 0
      THEN 'Nothing blocks. Rows to remove: ' || coalesce((SELECT sum(removal.found) FROM removal)::text, '0') || '. Run the delete file next.'
      ELSE 'Fix every BLOCKED row below, then run this check again. Do not run the delete file.' END AS detail
  UNION ALL
  SELECT 1, 'guard', substring(guard_rows.guard FROM 3)::integer, CASE WHEN guard_rows.blocked THEN 'BLOCKED' ELSE 'ok' END,
    guard_rows.guard || ' ' || guard_rows.item, guard_rows.found, CASE WHEN guard_rows.blocked THEN guard_rows.clears ELSE '' END
  FROM guard_rows
  UNION ALL
  SELECT 2, 'remove', removal.ord,
    CASE WHEN NOT removal.present THEN 'absent' WHEN removal.found IS NULL THEN 'unknown' ELSE 'remove' END,
    removal.step || ' ' || removal.table_name, removal.found, ''
  FROM removal
  WHERE removal.found IS DISTINCT FROM 0 AND (SELECT target.user_id FROM target) IS NOT NULL
  UNION ALL
  SELECT 2, 'remove', 100000, 'remove', 'C the login (auth.users)', (SELECT count(*) FROM matches), 'Deleted last. Its cascades clear the rest.'
  WHERE (SELECT target.user_id FROM target) IS NOT NULL
  UNION ALL
  SELECT 3, 'storage', 0, 'empty this folder', objects.bucket_id || '/' || objects.name, NULL, 'Delete it in the Supabase Storage dashboard.'
  FROM storage.objects AS objects
  CROSS JOIN target
  WHERE objects.bucket_id IN (${buckets}) AND starts_with(objects.name, target.user_id::text || '/')
  UNION ALL
  SELECT 4, 'trigger', 0, 'info', 'auth.users.' || trg.tgname, NULL,
    CASE WHEN (trg.tgtype::integer & 8) <> 0 THEN 'Fires when the login is deleted. Events: ' ELSE 'Does not fire on this delete. Events: ' END
      || concat_ws(' OR ', CASE WHEN (trg.tgtype::integer & 4) <> 0 THEN 'INSERT' END, CASE WHEN (trg.tgtype::integer & 8) <> 0 THEN 'DELETE' END,
        CASE WHEN (trg.tgtype::integer & 16) <> 0 THEN 'UPDATE' END, CASE WHEN (trg.tgtype::integer & 32) <> 0 THEN 'TRUNCATE' END) || '.'
  FROM pg_catalog.pg_trigger AS trg
  WHERE trg.tgrelid = 'auth.users'::regclass AND NOT trg.tgisinternal
  UNION ALL
  SELECT 5, 'kept', 0, 'kept', 'business_os_invites redeemed or claimed by it',
    (SELECT count(*) FROM public.business_os_invites AS invites CROSS JOIN target WHERE invites.redeemed_account_id = target.user_id OR invites.claimed_account_id = target.user_id),
    ${lit(KEPT_RESIDUE[0].reason)}
)`;
}

export function renderDeleteSql(): string {
  return `-- TEST ACCOUNT CLEANUP, DELETE. Removes one test account completely, or nothing at all.
-- Run the check file first and continue only when it says OK.
-- Runbook: docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md
-- 1. The email of the test account to remove.
${EDIT_LINES}
-- 3. Type the same email again to confirm.
SELECT set_config('cleanup.confirm_email', 'type-the-email-again', true) AS edit_confirm_email;

DO $cleanup$
${buildDeleteBlock()}
$cleanup$;

${buildDeleteReportQuery()};
`;
}

/**
 * The all-or-nothing DO block alone. Reads `cleanup.target_email`,
 * `cleanup.test_tag`, `cleanup.confirm_email` and, for the audit row only,
 * `cleanup.actor_id` and `cleanup.source` (SA-5). Unset, those two give
 * `actor_id = NULL` and `source = 'operator_sql'`, exactly as the pasted file
 * always wrote.
 */
export function buildDeleteBlock(): string {
  const auditColumns = 'action, entity_type, entity_id, resource_name, user_id, actor_id, details, severity, compliance_flags, created_at';
  return `DECLARE
  v_email text := NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '');
  v_confirm text := NULLIF(lower(btrim(coalesce(current_setting('cleanup.confirm_email', true), ''))), '');
  v_blockers text;
  v_survivors text;
  v_user_id uuid;
  v_rows bigint;
  v_total bigint := 0;
  v_tables integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_step record;
BEGIN
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'No email on the first edit line. Nothing was removed.';
  END IF;
  IF v_confirm IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'G-3 the confirmation line does not equal the email. Nothing was removed.';
  END IF;

  v_blockers := (
    WITH
${sharedCtes()},
${guardRowsCte()}
    SELECT string_agg(guard_rows.guard || ' ' || guard_rows.item, ', ' ORDER BY guard_rows.guard, guard_rows.item)
    FROM guard_rows
    WHERE guard_rows.blocked
  );
  IF v_blockers IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED, nothing was removed: %', v_blockers;
  END IF;

  v_user_id := (SELECT users.id FROM auth.users AS users WHERE lower(users.email) = v_email);

  FOR v_step IN
    SELECT plan_values.table_name, plan_values.key_column, plan_values.parent_table
    FROM (VALUES
${planValues('      ')}
    ) AS plan_values(ord, step, table_name, key_column, parent_table)
    ORDER BY plan_values.ord
  LOOP
    IF to_regclass(format('public.%I', v_step.table_name)) IS NULL THEN
      CONTINUE;
    END IF;
    IF v_step.parent_table IS NULL THEN
      EXECUTE format('DELETE FROM public.%I WHERE %I = %L', v_step.table_name, v_step.key_column, v_user_id);
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE %I IN (SELECT id FROM public.%I WHERE user_id = %L)', v_step.table_name, v_step.key_column, v_step.parent_table, v_user_id);
    END IF;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_counts := v_counts || jsonb_build_object(v_step.table_name, v_rows);
      v_total := v_total + v_rows;
      v_tables := v_tables + 1;
    END IF;
  END LOOP;

  DELETE FROM auth.users WHERE id = v_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'The login was not removed. Everything was rolled back.';
  END IF;

  v_survivors := (
    WITH plan_keys AS (
      SELECT plan_values.table_name, plan_values.key_column
      FROM (VALUES
${planValues('        ')}
      ) AS plan_values(ord, step, table_name, key_column, parent_table)
      WHERE plan_values.parent_table IS NULL
    )
    SELECT string_agg(left_over.item || ' ' || left_over.found, ', ' ORDER BY left_over.item)
    FROM (
      SELECT 'auth.users'::text AS item, (SELECT count(*) FROM auth.users AS users WHERE users.id = v_user_id)::bigint AS found
      UNION ALL
      SELECT plan_keys.table_name,
        ${countOf(`format('SELECT count(*) AS row_count FROM public.%I WHERE %I = %L', plan_keys.table_name, plan_keys.key_column, v_user_id)`)}
      FROM plan_keys
      WHERE to_regclass(format('public.%I', plan_keys.table_name)) IS NOT NULL
      UNION ALL
      SELECT nsp.nspname || '.' || rel.relname || '.' || att.attname,
        ${countOf(`format('SELECT count(*) AS row_count FROM %I.%I WHERE %I = %L', nsp.nspname, rel.relname, att.attname, v_user_id)`)}
      FROM pg_catalog.pg_constraint AS con
      JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
      JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
      JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
      WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'
        AND NOT (nsp.nspname = 'public' AND (rel.relname::text, att.attname::text) IN (SELECT plan_keys.table_name, plan_keys.key_column FROM plan_keys))
    ) AS left_over
    WHERE left_over.found > 0
  );
  IF v_survivors IS NOT NULL THEN
    RAISE EXCEPTION 'Rows still name the login after the delete, so everything was rolled back: %', v_survivors;
  END IF;

  INSERT INTO public.audit_trail (${auditColumns})
  VALUES (
    ${lit(AUDIT_ACTION)}, 'user', v_user_id::text, NULL, NULL, NULLIF(current_setting('cleanup.actor_id', true), '')::uuid,
    jsonb_build_object('source', coalesce(NULLIF(current_setting('cleanup.source', true), ''), 'operator_sql'), 'script', ${lit(DELETE_FILE)}, 'tables', v_tables, 'rows', v_total, 'counts', v_counts),
    ${lit(AUDIT_SEVERITY)}, ARRAY[${litList(AUDIT_COMPLIANCE_FLAGS)}]::text[], now()
  );

  RAISE NOTICE 'CLEAN. Removed % rows from % tables and the login %', v_total, v_tables, v_user_id;
END`;
}

/**
 * The per-table report alone. Read-only. Run inside the delete transaction,
 * before COMMIT, `created_at = now()` matches only this run's audit row (SA-3).
 */
export function buildDeleteReportQuery(): string {
  return `${reportCtes()}
SELECT report.line, report.rows_removed, report.result, report.tables_removed, report.removed_login, report.removed_at, report.same_run
FROM (
${reportRows()}
) AS report
ORDER BY report.sort_order, report.line`;
}

/** The same report as one jsonb array, ordered by explicit keys (R-2 g). */
export function buildDeleteReportJson(): string {
  return `${reportCtes()}
SELECT jsonb_agg(jsonb_build_object('line', report.line, 'rows_removed', report.rows_removed, 'result', report.result,
    'tables_removed', report.tables_removed, 'removed_login', report.removed_login, 'removed_at', report.removed_at, 'same_run', report.same_run)
  ORDER BY report.sort_order, report.line)
FROM (
${reportRows()}
) AS report`;
}

function reportRows(): string {
  return `  SELECT 0 AS sort_order, per_table.table_name AS line, per_table.rows_removed,
    NULL::text AS result, NULL::bigint AS tables_removed, NULL::text AS removed_login, NULL::timestamptz AS removed_at, NULL::boolean AS same_run
  FROM per_table
  UNION ALL
  SELECT 1, 'TOTAL', summary.rows_removed, summary.result, summary.tables_removed, summary.removed_login, summary.removed_at, summary.same_run
  FROM summary`;
}

function reportCtes(): string {
  return `WITH
recent AS (
  SELECT audit.entity_id, audit.created_at, audit.details
  FROM public.audit_trail AS audit
  WHERE audit.action = ${lit(AUDIT_ACTION)} AND audit.created_at >= now() - interval '15 minutes'
  ORDER BY audit.created_at DESC
  LIMIT 1
),
per_table AS (
  SELECT counted.key AS table_name, counted.value::bigint AS rows_removed
  FROM recent
  CROSS JOIN LATERAL jsonb_each_text(coalesce(recent.details -> 'counts', '{}'::jsonb)) AS counted
),
summary AS (
  SELECT
    CASE
      WHEN recent.entity_id IS NULL THEN 'NO RECENT REMOVAL'
      WHEN recent.created_at = now() THEN 'CLEAN'
      ELSE 'REMOVED EARLIER'
    END AS result,
    (SELECT coalesce(sum(per_table.rows_removed), 0) FROM per_table)::bigint AS rows_removed,
    (SELECT count(*) FROM per_table)::bigint AS tables_removed,
    recent.entity_id AS removed_login,
    recent.created_at AS removed_at,
    coalesce(recent.created_at = now(), false) AS same_run
  FROM (SELECT 1 AS anchor) AS anchor_row
  LEFT JOIN recent ON true
)`;
}

const VERSION_TOKEN = '__CLEANUP_FUNCTION_VERSION__';

/** The function, with `version` either the token or the real stamp. */
function renderFunctionSql(version: string): string {
  return `CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}(p_mode text, p_email text, p_tag text, p_confirm text, p_actor uuid, p_secret text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $operator_cleanup$
DECLARE
  v_result jsonb;
BEGIN
  IF p_secret IS NULL OR pg_catalog.length(p_secret) < 32 OR NOT EXISTS (
    SELECT 1 FROM operator_private.secrets AS stored
    WHERE stored.name = ${lit(SECRET_ROW_NAME)}
      AND stored.secret_sha256 = pg_catalog.sha256(pg_catalog.convert_to(p_secret, 'UTF8'))
  ) THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('check', 'delete') THEN
    RAISE EXCEPTION 'unknown mode' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'delete' AND p_actor IS NULL THEN
    RAISE EXCEPTION 'a delete needs the admin id' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'check' THEN
    PERFORM pg_catalog.set_config('transaction_read_only', 'on', true);
  END IF;
  PERFORM pg_catalog.set_config('cleanup.target_email', coalesce(p_email, ''), true);
  PERFORM pg_catalog.set_config('cleanup.test_tag', coalesce(p_tag, ''), true);
  PERFORM pg_catalog.set_config('cleanup.confirm_email', CASE WHEN p_mode = 'delete' THEN coalesce(p_confirm, '') ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.actor_id', CASE WHEN p_mode = 'delete' THEN p_actor::text ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.source', 'admin_page', true);
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  IF p_mode = 'check' THEN
    v_result := (
${buildCheckJson()}
    );
  ELSE
${buildDeleteBlock()};
    v_result := (
${buildDeleteReportJson()}
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object('version', ${lit(version)}, 'mode', p_mode, 'rows', coalesce(v_result, '[]'::jsonb),
    'server_ms', (pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() - pg_catalog.statement_timestamp()) * 1000)::bigint);
END
$operator_cleanup$`;
}

/** sha256 of the function SQL (with the token in place of the stamp), first 16 hex digits. */
export function cleanupFunctionVersion(): string {
  return createHash('sha256').update(renderFunctionSql(VERSION_TOKEN)).digest('hex').slice(0, 16);
}

/** The grants every version re-asserts. CREATE OR REPLACE keeps them, this makes it explicit. */
function renderGrantsSql(): string {
  return `ALTER FUNCTION ${FUNCTION_SIGNATURE} OWNER TO postgres;
REVOKE ALL ON FUNCTION ${FUNCTION_SIGNATURE} FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} TO service_role;`;
}

/**
 * The migration (R-1 to R-4): CREATE OR REPLACE of the function, on top of the
 * schema, secret table and function the initial migration created. It never
 * touches the schema or the secret table, so the stored hash survives and no
 * setup step is repeated. Comments stay at the top, without semicolons or
 * apostrophes, so the file is as paste-safe as the operator files.
 */
export function renderMigrationSql(): string {
  const requiredChecks = FUNCTION_REQUIRED_TABLES.map(
    (required) => `  IF pg_catalog.to_regclass(${lit(`public.${required.table}`)}) IS NULL THEN
    RAISE EXCEPTION ${lit(`Apply ${required.migration} first  Nothing was applied`)};
  END IF;`
  ).join('\n');
  const requiredNames = FUNCTION_REQUIRED_TABLES.map((required) => required.migration).join(' and ');
  return `-- ${FUNCTION_MIGRATION}. GENERATED by scripts/generate-test-account-cleanup-sql.ts. Never edit by hand, and never edit once applied
-- A changed plan goes in a new dated file (generator constant FUNCTION_MIGRATION).
-- Replaces the function public.operator_test_account_cleanup with the current plan. The schema operator_private and its secret table stay as they are
-- Apply order. First ${INITIAL_FUNCTION_MIGRATION}${requiredNames ? ` and ${requiredNames}` : ''}, then this file. It refuses otherwise and applies nothing
-- The app pins the version stamp this function returns. Until the deployed build and this function agree, the Danger Zone check and delete refuse
-- Rollback supabase/SQL Scripts/${FUNCTION_MIGRATION}_rollback.sql restores the function of ${PREVIOUS_FUNCTION_MIGRATION}
-- Operator exception OX-1r. One secret-gated function for the admin-only test-account cleanup routes
-- It runs the same generated guards G-1 to G-18 as scripts/test-account-cleanup-delete.sql
-- It refuses with 42501 unless the caller sends the second secret whose sha256 only this database holds
-- Requirement docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md, SA re-ruling R-1 to R-9
-- Runbook docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md, section 6
-- search_path is pg_catalog, public, pg_temp (SA review) so the reviewed delete triggers resolve their tables as today

DO $create_guard$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'anon or authenticated may create objects in schema public. Revoke that first. Nothing was applied.';
  END IF;
END
$create_guard$;

DO $order_guard$
BEGIN
  IF pg_catalog.to_regclass('operator_private.secrets') IS NULL OR pg_catalog.to_regprocedure(${lit(FUNCTION_SIGNATURE)}) IS NULL THEN
    RAISE EXCEPTION ${lit(`Apply ${INITIAL_FUNCTION_MIGRATION} first  Nothing was applied`)};
  END IF;
${requiredChecks}
END
$order_guard$;

${renderFunctionSql(cleanupFunctionVersion())};

${renderGrantsSql()}

NOTIFY pgrst, 'reload schema';
`;
}

/**
 * The function exactly as the previous applied migration created it, as
 * CREATE OR REPLACE. Read from that file, which the test pins by sha256, so
 * the rollback restores the bytes that were applied and nothing newer.
 */
export function previousFunctionSql(previousMigrationSql: string): string {
  // Windows checkouts may hold CRLF. The generator always writes LF (SA C-9).
  const sql = previousMigrationSql.replace(/\r\n/g, '\n');
  const heads = [`CREATE FUNCTION ${FUNCTION_NAME}(`, `CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}(`];
  const starts = heads.map((head) => sql.indexOf(head)).filter((index) => index >= 0);
  const close = '\n$operator_cleanup$;';
  const start = starts.length > 0 ? Math.min(...starts) : -1;
  const end = start < 0 ? -1 : sql.indexOf(close, start);
  if (start < 0 || end < 0) {
    throw new Error(`${PREVIOUS_MIGRATION_FILE}: the function was not found`);
  }
  // Up to and including the closing dollar tag, without its semicolon.
  const body = sql.slice(start, end + close.length - 1);
  return body.startsWith('CREATE OR REPLACE') ? body : body.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
}

export function renderRollbackSql(previousMigrationSql = readFileSync(join(__dirname, '..', ...PREVIOUS_MIGRATION_FILE.split('/')), 'utf8')): string {
  return `-- Rollback of supabase/migrations/${FUNCTION_MIGRATION}.sql. GENERATED, never edit by hand.
-- Restores the function exactly as supabase/migrations/${PREVIOUS_FUNCTION_MIGRATION}.sql created it. Keeps the schema, the secret table and the stored hash
-- Then redeploy an app build that pins the version stamp of ${PREVIOUS_FUNCTION_MIGRATION}, or the Danger Zone check and delete refuse
-- To remove the whole feature instead, also run supabase/SQL Scripts/${INITIAL_FUNCTION_MIGRATION}_rollback.sql afterwards

${previousFunctionSql(previousMigrationSql)};

${renderGrantsSql()}

NOTIFY pgrst, 'reload schema';
`;
}

/** The only generated TS: the stamp the delete route compares before the storage step (R-6). */
export function renderVersionModule(): string {
  return `// GENERATED by scripts/generate-test-account-cleanup-sql.ts. Never edit by hand.
// The version stamp the test-account cleanup database function returns. The
// delete route refuses before the storage step when the applied function
// returns another one (SA re-ruling R-6). The drift test pins it.

export const CLEANUP_FUNCTION_VERSION = '${cleanupFunctionVersion()}';
`;
}

function main(): void {
  const root = join(__dirname, '..');
  writeFileSync(join(root, ...CHECK_FILE.split('/')), renderCheckSql());
  writeFileSync(join(root, ...DELETE_FILE.split('/')), renderDeleteSql());
  writeFileSync(join(root, ...MIGRATION_FILE.split('/')), renderMigrationSql());
  writeFileSync(join(root, ...ROLLBACK_FILE.split('/')), renderRollbackSql());
  writeFileSync(join(root, ...VERSION_FILE.split('/')), renderVersionModule());
  process.stdout.write(`Wrote ${CHECK_FILE}, ${DELETE_FILE}, ${MIGRATION_FILE}, ${ROLLBACK_FILE} and ${VERSION_FILE}\n`);
}

if (require.main === module) main();

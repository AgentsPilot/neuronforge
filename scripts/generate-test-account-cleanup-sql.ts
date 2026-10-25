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
// The Supabase SQL editor has failed on the word "into" in prose. The pasted
// files contain exactly one such token, `INSERT INTO public.audit_trail (`. The
// function also holds the anonymise audit insert and, once, `INSERT INTO
// public.business_os_deletion_receipts (` (DE-10b.1, W-9). Every plpgsql
// variable is assigned with `:=`, never `SELECT ... INTO`. Comments appear
// only on the edit lines at the top. The test enforces all of it.
//
// ── Anonymise (data export DE-10b.1, SA Review 2 §D) ─────────────────────────
// The function also closes and anonymises a login in place (modes
// anonymise_check / anonymise): the business data goes, KEEP_SET stays under the
// same user_id with BLANK_LIST blanked, and the login becomes a tombstone. Its
// direct writes to `auth.*` (UPDATE auth.users, the AUTH_CLOSURE deletes, the
// auth log delete) are approved ONLY inside this generated function, as an
// extension of OX-1r. lib/business-os/purge/__tests__/no-deletion-paths.guard
// family 4 enforces it.

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
 * 20261046: scheduling_bookings deleted before crm_contacts (its contact_id is
 * NOT NULL with ON DELETE SET NULL, so the old order failed with 23502 on prod,
 * 2026-10-08), and G-19 refuses any plan that deletes a parent before such a
 * child. 20261044 is the unrelated SECURITY DEFINER lockdown, slice 1.
 * 20261047: the audit row names the admin as user_id as well as actor_id (the
 * AD-2 convention), so /admin/audit-trail shows who removed the account. The
 * pasted operator_sql path has no signed-in admin and still writes NULL.
 * 20261075: the plan gained business_os_data_exports and the
 * business-data-exports bucket (data export DE-8a, created by 20261074). Chained
 * on 20261047, confirmed live on prod 2026-10-17 (stamp 789e4758d674b561).
 * Finance 4b.1 (20261072 + 20261073) was not on main yet: per SA C-7 it now
 * renumbers its regenerated cleanup above 20261075 and chains on this file.
 * 20261077: the link business_os_boost_reversal_events -> business_os_boost_purchases
 * (finance slice 4b.1, migration 20261076, ON DELETE CASCADE) reviewed as
 * parent-owned for G-18. No delete step: the step B purchase delete cascades.
 * First written as 20261073 over 20261047; renumbered and regenerated on
 * 2026-10-17 to chain on 20261075, so it keeps the data_exports plan.
 * 20261081 (data export DE-10b.1): two new modes, anonymise_check and
 * anonymise, that close and anonymise the login in place in the same
 * transaction that deletes the business data, keep our billing (KEEP_SET) with
 * its personal columns blanked (BLANK_LIST), and write the deletion receipt
 * (20261080) last, inside the transaction. The hard delete of a test account is
 * unchanged, and now writes a receipt too. Two new parameters, p_subject and
 * p_receipt: the migration drops the 6-argument signature, so no old overload
 * stays callable.
 * 20261092: the eight links into and out of abandoned_bookings and
 * scheduling_meetings reviewed for G-18 (INBOUND_FOREIGN_KEYS). Both tables
 * joined the plan in c21a4b0f, which regenerated the ALREADY APPLIED 20261081
 * in place (stamp 2bd40a46795e4555) without their links, so G-18 refused every
 * check and delete on prod. 20261081 is restored to its applied bytes and
 * pinned; this file carries the fix. On 2026-10-23 prod got a hand-made bridge
 * (this plan with the 20261081 stamp swapped in), so the live body is neither
 * file. The rollback restores 20261081 as committed, see
 * docs/workplans/TEST_ACCOUNT_CLEANUP_MEETINGS_FK_FIX_WORKPLAN.md.
 */
export const FUNCTION_MIGRATION = '20261092_operator_test_account_cleanup_meeting_links';
/** The applied migration whose function the rollback restores, byte for byte. */
export const PREVIOUS_FUNCTION_MIGRATION = '20261081_operator_account_cleanup_anonymise';
/**
 * What this migration changes, for its header (comment lines, no semicolons or
 * apostrophes: the file must stay paste-safe). Rewritten with each new
 * FUNCTION_MIGRATION; the applied files keep their own.
 */
export const FUNCTION_MIGRATION_PURPOSE: ReadonlyArray<string> = [
  'Reviews for G-18 the eight links to and from abandoned_bookings and scheduling_meetings, which joined the plan without them',
  'Without them G-18 refuses every check and delete. Nothing else in the plan changes. Same 8 argument signature as 20261081',
];
/**
 * What running this migration's rollback means beyond restoring the previous
 * function, for the rollback header (same paste-safe rules). Rewritten with
 * each new FUNCTION_MIGRATION.
 */
export const ROLLBACK_CONSEQUENCE: ReadonlyArray<string> = [
  'The restored 20261081 function lacks the eight reviewed links, so G-18 refuses every check and delete again until this file is reapplied',
  'That fails closed. It removes nothing. It is NOT the hand made bridge of 2026-10-23, which carried the same stamp with the links',
];
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
  {
    table: 'business_os_data_exports',
    migration: '20261074_business_os_data_exports',
    reason: 'The plan deletes the export jobs of the account (data export DE-8a). Required whether the plan names it in static or dynamic SQL (SA C-8): a missing table would fail every check and delete with 42P01.',
  },
  {
    table: 'business_os_deletion_receipts',
    migration: '20261080_business_os_deletion_receipts',
    reason: 'The delete and the anonymise insert the deletion receipt last, inside their transaction, in static SQL (data export DE-10b.1, SA R-2). A missing table would fail every delete with 42P01.',
  },
];
export const VERSION_FILE = 'lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts';
export const FUNCTION_NAME = 'public.operator_test_account_cleanup';
/** The 8-argument signature of 20261081 (DE-10b.1): p_subject and p_receipt added, both DEFAULT NULL. */
export const FUNCTION_SIGNATURE = `${FUNCTION_NAME}(text, text, text, text, uuid, text, uuid, jsonb)`;
/**
 * The 6-argument signature every version up to 20261077 had. 20261081 dropped
 * it. Every later migration still drops it if present (a no-op on prod), so no
 * old overload can stay callable whichever version a database starts from.
 */
export const RETIRED_FUNCTION_SIGNATURE = `${FUNCTION_NAME}(text, text, text, text, uuid, text)`;
/** The signature of PREVIOUS_FUNCTION_MIGRATION's function: what the rollback restores and grants. */
export const PREVIOUS_FUNCTION_SIGNATURE = FUNCTION_SIGNATURE;
/** The table the delete and the anonymise insert their receipt in (migration 20261080). */
export const RECEIPTS_TABLE = 'public.business_os_deletion_receipts';
/** The audit event the anonymise writes inside its transaction (O-8). Must equal the registry. */
export const ANONYMISE_AUDIT_ACTION = 'ACCOUNT_PSEUDONYMISED';
export const ANONYMISE_AUDIT_SEVERITY = 'critical';
export const ANONYMISE_AUDIT_COMPLIANCE_FLAGS = ['GDPR', 'SOC2'] as const;
/** The closed login's email domain (TQ-21). `.invalid` is reserved by RFC 2606 and never delivers. */
export const CLOSED_EMAIL_DOMAIN = 'deleted.invalid';
/** How long the closed login stays banned (O-5): GoTrue reads banned_until as a Go time, which cannot hold infinity. */
export const CLOSED_BAN_INTERVAL = '100 years';

/** hard: the test-account delete (OX-1r). anonymise: close and anonymise the login, keep our billing (DE-10b.1). */
export type CleanupMode = 'hard' | 'anonymise';
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
  { item: 'one audit_trail row', reason: 'The record of this cleanup, naming the admin who ran it (no user id when pasted).' },
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
  ['abandoned_bookings', 'abandoned_bookings_booking_id_fkey', 'user_id'],
  ['abandoned_bookings', 'abandoned_bookings_business_fk', 'user_id'],
  ['abandoned_bookings', 'abandoned_bookings_service_id_fkey', 'user_id'],
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
  ['business_os_boost_reversal_events', 'business_os_boost_reversal_events_purchase_id_fkey', null],
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
  ['email_sends', 'email_sends_booking_id_fkey', 'user_id'],
  ['email_sends', 'email_sends_business_fk', 'user_id'],
  ['email_sends', 'email_sends_campaign_id_fkey', 'user_id'],
  ['email_sends', 'email_sends_contact_id_fkey', 'user_id'],
  ['email_sends', 'email_sends_meeting_id_fkey', 'user_id'],
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
  ['payment_plan_installments', 'payment_plan_installments_meeting_id_fkey', 'user_id'],
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
  ['scheduling_meetings', 'scheduling_meetings_booking_id_fkey', 'user_id'],
  ['scheduling_meetings', 'scheduling_meetings_business_fk', 'user_id'],
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
  business_os_boost_reversal_events:
    'Refund and dispute events of the target boost purchases. No owner column: the account comes through the purchase, which step B removes, and the link cascades.',
  execution_metrics: 'Metrics of the target agents and workflow runs.',
  execution_routing_decisions: 'Routing decisions of the target agent runs.',
  sla_events: 'Events of the target SLAs. The actor column is checked separately by G-10.',
  smart_link_clicks: 'Clicks on the target links (a purge descriptor, reached through smart_links).',
  user_capability_blocks: 'Blocks of the target capabilities (a purge descriptor).',
  website_blocks: 'Blocks of the target pages (a purge descriptor, reached through website_pages).',
  workflow_groups: 'Groups of an organisation the target owns. G-13 refuses when another account is inside it.',
};

/**
 * `never` descriptors scoped `via` a plan table that the plan does NOT delete
 * itself: the parent's delete removes them through an ON DELETE CASCADE link
 * (finance 4b.1, SA-W105). TypeScript only, never rendered into SQL. The
 * coverage test accepts an entry only when the parent is a plan table, the
 * descriptor is `via` that parent with the same FK, and the link is reviewed
 * parent-owned in INBOUND_FOREIGN_KEYS (so G-18 does not block it).
 */
export const CASCADE_CHILDREN: ReadonlyArray<{ table: string; parent: string; fk: string; constraint: string; reason: string }> = [
  {
    table: 'business_os_boost_reversal_events',
    parent: 'business_os_boost_purchases',
    fk: 'purchase_id',
    constraint: 'business_os_boost_reversal_events_purchase_id_fkey',
    reason: 'Dated refund and dispute history of a boost purchase (migration 20261076). Removed by the step B purchase delete through ON DELETE CASCADE (SA-Q66).',
  },
];

// ── Anonymise mode (data export DE-10b.1, SA Review 2 §D, workplan §3) ──────

/**
 * The keep-set: tables whose rows stay, under the same user_id, when an account
 * is closed and anonymised (SA §D verbatim, plus O-3). Everything else in the
 * hard plan is deleted. `column` is the key naming the account; null when the
 * table has none (its rows come through a kept parent).
 */
export const KEEP_SET: ReadonlyArray<{ table: string; column: string | null; reason: string }> = [
  { table: 'business_os_billing_accounts', column: 'user_id', reason: 'Our plan billing (SA §D). Finance totals and history read it by account id.' },
  { table: 'business_os_billing_events', column: 'user_id', reason: 'Our plan money history (SA §D). Append-only evidence for accounting and tax.' },
  { table: 'business_os_boost_purchases', column: 'user_id', reason: 'Our boost revenue (SA §D). Finance totals read it.' },
  { table: 'business_os_boost_reversal_events', column: null, reason: 'Refunds and disputes of kept boost purchases (SA §D). No owner column: kept with its purchase.' },
  { table: 'business_os_credit_charges', column: 'user_id', reason: 'The credit bill (SA §D). The credit ledger figures read it.' },
  { table: 'business_os_credit_lots', column: 'user_id', reason: 'Credits granted and bought (SA §D). The credit ledger figures read it.' },
  { table: 'business_os_credit_lot_draws', column: 'user_id', reason: 'Credit taken back from lots (O-3). Ledger detail credit-leak-check reads; NO ACTION child of the kept lots.' },
  { table: 'business_os_credit_totals', column: 'user_id', reason: 'Running credit totals (SA §D).' },
  { table: 'credit_transactions', column: 'user_id', reason: 'Legacy credit ledger (SA §D). NO ACTION to the login, which stays.' },
  { table: 'user_subscriptions', column: 'user_id', reason: 'Legacy subscription row (SA §D). NO ACTION to the login, which stays.' },
  { table: 'billing_events', column: 'user_id', reason: 'Legacy billing history (SA §D).' },
  { table: 'processed_webhook_events', column: 'user_id', reason: 'Webhook idempotency (SA §D): stops a replayed Stripe event applying twice to the kept rows.' },
  { table: 'marketing_consent_events', column: 'user_id', reason: 'The consent ledger of the business clients (NBQ-3): proof a person said no. Kept whole, append-only.' },
  { table: 'marketing_consent_state', column: 'user_id', reason: 'The consent projection (NBQ-3), kept with its ledger.' },
  { table: 'business_os_account_lineage', column: 'account_id', reason: 'The nameless link in the invitation circle (NBQ-4). Ids only.' },
  { table: 'token_usage', column: 'user_id', reason: 'Our AI cost (NBQ-2 yes). Personal columns blanked.' },
  { table: 'boost_pack_purchases', column: 'user_id', reason: 'Legacy boost purchases (O-3), child of the kept credit_transactions. No personal column (TL W-2).' },
  { table: 'user_rewards', column: 'user_id', reason: 'Legacy rewards ledger (O-3), child of the kept credit_transactions.' },
  { table: 'subscription_invoices', column: 'user_id', reason: 'Legacy invoices (O-3): billing evidence. The Stripe-hosted links are blanked.' },
];

export type BlankTarget = 'null' | 'empty_object' | 'strip' | 'placeholder';

/**
 * The blank list: personal columns on kept rows, and what each becomes (TL
 * SQL results 2026-10-18, TL W-2, O-4 / W-6). SQL-W1: every column is
 * nullable; the jsonb columns with a `'{}'` default get `'{}'`, never NULL.
 * `strip` removes the listed keys from a jsonb object. `placeholder` is the
 * closed login's email (invites the subject redeemed or claimed: NOT NULL, and
 * the placeholder passes its lower-case and length CHECK).
 *
 * `key`: `user_id` = the subject's own rows; `invite_redeemer` = invites the
 * subject redeemed or claimed, which another account issued (W-6). Every blank
 * runs behind a column-exists guard (G-11), and the anonymise re-reads every
 * one afterwards and rolls everything back on a value left (workplan §3.3).
 */
export const BLANK_LIST: ReadonlyArray<{
  table: string;
  column: string;
  target: BlankTarget;
  keys?: readonly string[];
  key: 'user_id' | 'invite_redeemer';
  reason: string;
}> = [
  { table: 'business_os_billing_accounts', column: 'action_required_invoice_url', target: 'null', key: 'user_id', reason: 'Stripe-hosted invoice link: anyone holding it sees the billing details (F-4).' },
  { table: 'business_os_billing_accounts', column: 'open_checkout_session_id', target: 'null', key: 'user_id', reason: 'A Stripe checkout pointer that resolves to the customer (F-4).' },
  { table: 'business_os_boost_purchases', column: 'receipt_url', target: 'null', key: 'user_id', reason: 'Stripe-hosted receipt link (F-4).' },
  { table: 'business_os_credit_lots', column: 'reason', target: 'null', key: 'user_id', reason: 'Admin free text (F-4). Nullable (SQL-W1).' },
  { table: 'business_os_credit_lot_draws', column: 'reason', target: 'null', key: 'user_id', reason: 'Admin free text (TL W-2), same rule as credit_lots.reason.' },
  { table: 'user_subscriptions', column: 'payment_method_last4', target: 'null', key: 'user_id', reason: 'Card detail (SQL-1).' },
  { table: 'user_subscriptions', column: 'payment_method_brand', target: 'null', key: 'user_id', reason: 'Card detail (SQL-1).' },
  { table: 'user_subscriptions', column: 'last_calculator_inputs', target: 'null', key: 'user_id', reason: 'Free-form inputs the person typed (SQL-1).' },
  { table: 'credit_transactions', column: 'description', target: 'null', key: 'user_id', reason: 'Free text that may name the business (SQL-1).' },
  { table: 'credit_transactions', column: 'metadata', target: 'strip', keys: ['agent_name'], key: 'user_id', reason: 'The agent name the person typed (SQL-1b). jsonb with a {} default: keys stripped, never NULL.' },
  { table: 'billing_events', column: 'payload', target: 'empty_object', key: 'user_id', reason: 'Stripe event payload (SQL-1). jsonb with a {} default (SQL-W1).' },
  { table: 'billing_events', column: 'error_message', target: 'null', key: 'user_id', reason: 'Free text (SQL-1).' },
  { table: 'token_usage', column: 'error_message', target: 'null', key: 'user_id', reason: 'Provider error text may quote the prompt (SQL-1).' },
  { table: 'token_usage', column: 'request_payload', target: 'null', key: 'user_id', reason: 'The prompt (SQL-1). Nullable, no default (SQL-W1).' },
  { table: 'token_usage', column: 'response_metadata', target: 'null', key: 'user_id', reason: 'Provider response detail (SQL-1). Nullable, no default (SQL-W1).' },
  { table: 'token_usage', column: 'metadata', target: 'strip', keys: ['user_goal', 'user_role', 'user_mode', 'agent_name'], key: 'user_id', reason: 'What the person said about themselves and their agent (SQL-1b). Cost keys stay.' },
  { table: 'subscription_invoices', column: 'stripe_invoice_pdf', target: 'null', key: 'user_id', reason: 'Stripe-hosted document showing the name and email (TL W-2).' },
  { table: 'subscription_invoices', column: 'stripe_hosted_invoice_url', target: 'null', key: 'user_id', reason: 'Stripe-hosted document showing the name and email (TL W-2).' },
  { table: 'subscription_invoices', column: 'metadata', target: 'empty_object', key: 'user_id', reason: 'jsonb with a {} default (TL W-2), blanked defensively.' },
  { table: 'user_rewards', column: 'metadata', target: 'empty_object', key: 'user_id', reason: 'jsonb with a {} default (TL W-2), blanked defensively.' },
  { table: 'business_os_invites', column: 'email', target: 'placeholder', key: 'invite_redeemer', reason: 'The invitee email of an invite the subject redeemed or claimed (O-4). NOT NULL, so the closed placeholder.' },
  { table: 'business_os_invites', column: 'personal_note', target: 'null', key: 'invite_redeemer', reason: 'Note addressed to the invitee (O-4).' },
  { table: 'business_os_invites', column: 'email_problem_detail', target: 'null', key: 'invite_redeemer', reason: 'Delivery detail naming the invitee address (O-4).' },
  { table: 'business_os_invites', column: 'redemption_error_message', target: 'null', key: 'invite_redeemer', reason: 'Free text of a failed redemption (O-4).' },
];

/**
 * The closure of the login, exactly what `UPDATE auth.users` sets (SA §D, TL
 * SQL-W2, O-5, O-6). The GoTrue token columns become '' and never NULL: GoTrue
 * scans them as strings, and one NULL has broken auth.admin.listUsers() for
 * every user elsewhere (K-1). `deleted_at` is left unset (O-7).
 */
export const AUTH_USERS_CLOSURE: ReadonlyArray<{ column: string; value: string }> = [
  { column: 'email', value: 'v_placeholder' },
  { column: 'phone', value: 'NULL' },
  { column: 'encrypted_password', value: "''" },
  { column: 'raw_user_meta_data', value: "'{}'::jsonb" },
  { column: 'raw_app_meta_data', value: "pg_catalog.jsonb_build_object('provider', 'email', 'providers', pg_catalog.jsonb_build_array('email'), 'deleted', true)" },
  { column: 'banned_until', value: `now() + interval '${CLOSED_BAN_INTERVAL}'` },
  { column: 'confirmation_token', value: "''" },
  { column: 'recovery_token', value: "''" },
  { column: 'email_change_token_new', value: "''" },
  { column: 'email_change_token_current', value: "''" },
  { column: 'phone_change_token', value: "''" },
  { column: 'reauthentication_token', value: "''" },
  { column: 'email_change', value: "''" },
  { column: 'phone_change', value: "''" },
];

/**
 * Every `auth` table that names a login, and what the closure does with it
 * (SA §D, TL SQL-4 and SQL-W2, O-7, W-5, W-11). `delete`: its rows for the
 * subject are deleted by `column`. `via_sessions` / `via_factors`: removed by
 * the cascade from a deleted session or factor; the survivor scan counts them
 * by the ids captured before. `must_be_empty`: no row may name the subject
 * (G-20), found through the table's foreign key to the login. G-20 refuses an
 * auth table that links to the login, or has a user_id column, and is not here.
 */
export const AUTH_CLOSURE: ReadonlyArray<{
  table: string;
  column: string | null;
  action: 'delete' | 'via_sessions' | 'via_factors' | 'must_be_empty';
  reason: string;
}> = [
  { table: 'identities', column: 'user_id', action: 'delete', reason: 'Google and other sign-in links (SA §D).' },
  { table: 'sessions', column: 'user_id', action: 'delete', reason: 'Live sessions (SA §D). Cascades refresh_tokens and mfa_amr_claims.' },
  { table: 'refresh_tokens', column: 'user_id', action: 'delete', reason: 'Refresh tokens (SA §D). Its user_id is text: the %L literal compares as text.' },
  { table: 'mfa_amr_claims', column: 'session_id', action: 'via_sessions', reason: 'Sign-in method claims of a session (SQL-4). Cascade from sessions.' },
  { table: 'mfa_factors', column: 'user_id', action: 'delete', reason: 'MFA factors (SA §D). Cascades mfa_challenges.' },
  { table: 'mfa_challenges', column: 'factor_id', action: 'via_factors', reason: 'Challenges of a factor (W2). Cascade from mfa_factors (O-7).' },
  { table: 'mfa_recovery_code_sets', column: 'user_id', action: 'delete', reason: 'MFA recovery codes (SQL-4, O-7).' },
  { table: 'one_time_tokens', column: 'user_id', action: 'delete', reason: 'Magic link and recovery tokens (SA §D).' },
  { table: 'oauth_authorizations', column: 'user_id', action: 'delete', reason: 'OAuth grants (SQL-4, O-7).' },
  { table: 'oauth_consents', column: 'user_id', action: 'delete', reason: 'OAuth consents (SQL-4, O-7).' },
  { table: 'webauthn_credentials', column: 'user_id', action: 'delete', reason: 'Passkeys (SQL-4, O-7).' },
  { table: 'webauthn_challenges', column: 'user_id', action: 'delete', reason: 'Passkey challenges (SQL-4, O-7).' },
  { table: 'flow_state', column: 'user_id', action: 'delete', reason: 'PKCE flow state, holds provider tokens (W2, O-7). No foreign key, so listed by name.' },
  { table: 'scim_users', column: null, action: 'must_be_empty', reason: 'SET NULL from users (SQL-4). G-20 requires no row naming the subject.' },
];

/**
 * UPDATE triggers reviewed for G-21 (O-1, TL W5 and W-2): the only ones on
 * auth.users, on a blanked table or on business_os_invites. Both only stamp
 * updated_at on NEW. Any other blocks the anonymise.
 */
export const REVIEWED_UPDATE_TRIGGERS: ReadonlyArray<{ schema: string; table: string; trigger: string; note: string }> = [
  { schema: 'public', table: 'token_usage', trigger: 'update_token_usage_updated_at', note: 'BEFORE UPDATE, sets updated_at (TL W5).' },
  { schema: 'public', table: 'user_subscriptions', trigger: 'trigger_update_user_subscriptions_updated_at', note: 'BEFORE UPDATE, sets updated_at (TL W5).' },
];

/**
 * Links from a kept table to a table the anonymise empties, reviewed for G-22
 * (O-2). SET NULL on a nullable column only: deleting the business clients
 * clears the link and keeps the consent row (NBQ-3). `trg_mce_guard`
 * (20260930) lets exactly that update through. Any other such link blocks:
 * CASCADE or SET NULL would damage kept rows silently, NO ACTION would roll the
 * run back with a raw 23503.
 */
export const REVIEWED_KEPT_LINKS: ReadonlyArray<{ table: string; constraint: string; note: string }> = [
  { table: 'marketing_consent_events', constraint: 'marketing_consent_events_contact_id_fkey', note: 'contact_id to crm_contacts, ON DELETE SET NULL, nullable (20260930).' },
  { table: 'marketing_consent_state', constraint: 'marketing_consent_state_contact_id_fkey', note: 'contact_id to crm_contacts, ON DELETE SET NULL, nullable (20260930).' },
];

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

/**
 * Every delete, in order. The login itself follows the last entry in the hard
 * mode. The anonymise plan is the same list, in the same order, minus the
 * keep-set (so step C loses business_os_account_lineage): workplan §3.3.
 */
export function buildCleanupPlan(mode: CleanupMode = 'hard'): PlanEntry[] {
  const hard = buildHardPlan();
  if (mode === 'hard') return hard;
  const kept = new Set(KEEP_SET.map((entry) => entry.table));
  return hard.filter((entry) => !kept.has(entry.table));
}

function buildHardPlan(): PlanEntry[] {
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

function planValues(indent: string, mode: CleanupMode = 'hard'): string {
  const rows = buildCleanupPlan(mode).map(
    (entry, index) =>
      `${indent}(${index + 1}, ${lit(entry.step)}, ${lit(entry.table)}, ${lit(entry.column)}, ${litOrNull(entry.parent)})`
  );
  // The first row carries the types so a NULL parent is typed text.
  rows[0] = rows[0].replace(/^(\s*)\((\d+), ('[^']*'), ('[^']*'), ('[^']*'), (NULL|'[^']*')\)$/, '$1($2, $3::text, $4::text, $5::text, $6::text)');
  return rows.join(',\n');
}

/**
 * The CTEs both files share: settings, the target, the plan and the catalog
 * read. The anonymise mode adds `params.subject_id` (G-2a) and reads its own
 * plan; the hard rendering is byte-identical to 20261077 (W-10).
 */
function sharedCtes(mode: CleanupMode = 'hard'): string {
  const reviewed = [
    ...tenancyForeignKeys().map((fk) => `(${lit(fk.schema)}, ${lit(fk.table)}, ${lit(fk.column)}, 'tenancy', NULL)`),
    ...ACTOR_FOREIGN_KEYS.map(
      (fk) => `(${lit(fk.schema)}, ${lit(fk.table)}, ${lit(fk.column)}, 'actor', ${litOrNull(fk.ownerColumn)})`
    ),
  ];
  reviewed[0] = reviewed[0].replace(/^\(('[^']*'), ('[^']*'), ('[^']*'), ('[^']*'), (NULL|'[^']*')\)$/, '($1::text, $2::text, $3::text, $4::text, $5::text)');
  const inbound = INBOUND_FOREIGN_KEYS.map(([child, constraint, owner]) => `(${lit(child)}, ${lit(constraint)}, ${litOrNull(owner)})`);
  inbound[0] = inbound[0].replace(/^\(('[^']*'), ('[^']*'), (NULL|'[^']*')\)$/, '($1::text, $2::text, $3::text)');

  const subjectParam =
    mode === 'anonymise' ? `,\n    NULLIF(current_setting('cleanup.subject_id', true), '')::uuid AS subject_id` : '';
  return `params AS (
  SELECT
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '') AS target_email,
    NULLIF(lower(btrim(coalesce(current_setting('cleanup.test_tag', true), ''))), '') AS test_tag${subjectParam}
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
${planValues('    ', mode)}
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

/**
 * One guard row. `countSql` may read `target.user_id` and `params.*`. `info`
 * is set only in the anonymise mode: every row then carries an `info` column,
 * true for a row that is reported but never blocks (G-5, G-7, G-9 C3, G-14,
 * G-15, workplan §3.2). Null keeps the hard rendering byte-identical.
 */
function guard(
  id: string,
  item: string,
  countSql: string,
  clears: string,
  blockedWhen = 'counted.found > 0',
  info: string | null = null
): string {
  const infoColumn = info === null ? '' : `, (${info}) AS info`;
  return `SELECT ${lit(id)}::text AS guard, ${lit(item)}::text AS item, counted.found::bigint AS found, (${blockedWhen}) AS blocked, ${lit(clears)}::text AS clears${infoColumn}
  FROM (SELECT (${countSql}) AS found, params.target_email, params.test_tag FROM target CROSS JOIN params) AS counted`;
}

/** Tables the anonymise blanks, once each, in BLANK_LIST order. */
export function blankedTables(): string[] {
  return [...new Set(BLANK_LIST.map((blank) => blank.table))];
}

/** The key columns a blank rule reads its rows by. */
const blankKeyColumns = (key: 'user_id' | 'invite_redeemer'): string[] =>
  key === 'user_id' ? ['user_id'] : ['redeemed_account_id', 'claimed_account_id'];

/** The anonymise-only guard rows: G-11 for blank columns, G-20, G-21 and G-22. Each ends with `AS info`. */
function anonymiseGuardRows(): string[] {
  const blankState = BLANK_LIST.map(
    (blank) =>
      `(${lit(blank.table)}, ${lit(blank.column)}, ${blank.target === 'null' || blank.target === 'placeholder' ? 'false' : 'true'}, ${lit(`{${blankKeyColumns(blank.key).join(',')}}`)})`
  );
  blankState[0] = blankState[0].replace(/^\(('[^']*'), ('[^']*'), (true|false), ('[^']*')\)$/, '($1::text, $2::text, $3, $4::text[])');

  const authColumns = AUTH_USERS_CLOSURE.map((closure) => `(${lit('users')}, ${lit(closure.column)})`);
  authColumns.push(`(${lit('audit_log_entries')}, ${lit('payload')})`);
  authColumns[0] = authColumns[0].replace(/^\(('[^']*'), ('[^']*')\)$/, '($1::text, $2::text)');

  const closureTables = litList(AUTH_CLOSURE.map((closure) => closure.table));
  const keyed = AUTH_CLOSURE.filter((closure) => closure.column !== null).map(
    (closure) => `(${lit(closure.table)}, ${lit(closure.column as string)})`
  );
  keyed[0] = keyed[0].replace(/^\(('[^']*'), ('[^']*')\)$/, '($1::text, $2::text)');
  const privileges = [
    `(${lit('users')}, ${lit('UPDATE')})`,
    `(${lit('audit_log_entries')}, ${lit('DELETE')})`,
    ...AUTH_CLOSURE.filter((closure) => closure.action === 'delete').map((closure) => `(${lit(closure.table)}, ${lit('DELETE')})`),
  ];
  privileges[0] = privileges[0].replace(/^\(('[^']*'), ('[^']*')\)$/, '($1::text, $2::text)');
  const mustBeEmpty = litList(AUTH_CLOSURE.filter((closure) => closure.action === 'must_be_empty').map((closure) => closure.table));

  const updateTables = litList(blankedTables());
  const reviewedUpdates = REVIEWED_UPDATE_TRIGGERS.map((t) => `(${lit(t.schema)}, ${lit(t.table)}, ${lit(t.trigger)})`).join(', ');
  const keptTables = litList(KEEP_SET.map((entry) => entry.table));
  const reviewedLinks = REVIEWED_KEPT_LINKS.map((link) => `(${lit(link.table)}, ${lit(link.constraint)})`).join(', ');

  return [
    `SELECT 'G-11'::text AS guard, blank_state.table_name || '.' || blank_state.column_name AS item, NULL::bigint AS found, true AS blocked,
    'A column the anonymise blanks, or the column it finds the rows by, is missing or is not jsonb where it must be. Regenerate after the schema change.'::text AS clears, false AS info
  FROM (VALUES
    ${blankState.join(',\n    ')}
  ) AS blank_state(table_name, column_name, needs_jsonb, key_columns)
  WHERE to_regclass(format('public.%I', blank_state.table_name)) IS NOT NULL
    AND (
      NOT EXISTS (
        SELECT 1 FROM information_schema.columns AS cols
        WHERE cols.table_schema = 'public' AND cols.table_name = blank_state.table_name AND cols.column_name = blank_state.column_name
          AND (NOT blank_state.needs_jsonb OR cols.data_type = 'jsonb')
      )
      OR (SELECT count(*) FROM information_schema.columns AS cols
          WHERE cols.table_schema = 'public' AND cols.table_name = blank_state.table_name AND cols.column_name::text = ANY (blank_state.key_columns))
        <> cardinality(blank_state.key_columns)
    )`,
    `SELECT 'G-20'::text AS guard, 'auth.' || needed.table_name || ' is missing' AS item, NULL::bigint AS found, true AS blocked,
    'A table of the auth schema the closure relies on is missing. Supabase changed the auth schema. Engineering must review the generator first.'::text AS clears, false AS info
  FROM (VALUES ('users'::text), ('sessions'), ('mfa_factors'), ('audit_log_entries')) AS needed(table_name)
  WHERE to_regclass(format('auth.%I', needed.table_name)) IS NULL`,
    `SELECT 'G-20'::text AS guard, 'auth.' || needed.table_name || '.' || needed.column_name AS item, NULL::bigint AS found, true AS blocked,
    'A column the closure writes or reads is missing. Supabase changed the auth schema. Engineering must review the generator first.'::text AS clears, false AS info
  FROM (VALUES
    ${authColumns.join(',\n    ')},
    ${keyed.join(',\n    ')}
  ) AS needed(table_name, column_name)
  WHERE to_regclass(format('auth.%I', needed.table_name)) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns AS cols
      WHERE cols.table_schema = 'auth' AND cols.table_name = needed.table_name AND cols.column_name = needed.column_name
    )`,
    `SELECT 'G-20'::text AS guard, 'auth.' || rel.relname || '.' || att.attname || ' links to the login' AS item, 1::bigint AS found, true AS blocked,
    'A table of the auth schema that links to the login or to its sessions has not been reviewed. Engineering must add it to the closure in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND nsp.nspname = 'auth'
    AND con.confrelid IN (SELECT to_regclass('auth.users') UNION ALL SELECT to_regclass('auth.sessions'))
    AND rel.relname::text NOT IN (${closureTables})`,
    `SELECT 'G-20'::text AS guard, 'auth.' || cols.table_name || ' has a user_id column' AS item, 1::bigint AS found, true AS blocked,
    'A table of the auth schema names a login without a link (W-5). Engineering must add it to the closure in the generator first.'::text AS clears, false AS info
  FROM information_schema.columns AS cols
  WHERE cols.table_schema = 'auth' AND cols.column_name = 'user_id' AND cols.table_name::text NOT IN (${closureTables})`,
    `SELECT 'G-20'::text AS guard, 'auth.' || rel.relname || '.' || att.attname || ' names the login' AS item,
    ${countOf(`format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = %L', rel.relname, att.attname, target.user_id)`)} AS found, true AS blocked,
    'A row of the auth schema that must not exist names the login. Engineering must review this account.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  CROSS JOIN target
  WHERE con.contype = 'f' AND nsp.nspname = 'auth' AND con.confrelid = 'auth.users'::regclass
    AND rel.relname::text IN (${mustBeEmpty}) AND target.user_id IS NOT NULL
    AND ${countOf(`format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = %L', rel.relname, att.attname, target.user_id)`)} > 0`,
    `SELECT 'G-20'::text AS guard, 'privilege ' || needed.privilege_name || ' on auth.' || needed.table_name AS item, NULL::bigint AS found, true AS blocked,
    'The function owner may not write this auth table. Engineering must review the grants first.'::text AS clears, false AS info
  FROM (VALUES
    ${privileges.join(',\n    ')}
  ) AS needed(table_name, privilege_name)
  WHERE to_regclass(format('auth.%I', needed.table_name)) IS NOT NULL
    AND NOT pg_catalog.has_table_privilege(format('auth.%I', needed.table_name), needed.privilege_name)`,
    `SELECT 'G-20'::text AS guard, 'auth closure reviewed'::text AS item, 0::bigint AS found, false AS blocked, ''::text AS clears, false AS info`,
    `SELECT 'G-21'::text AS guard, nsp.nspname || '.' || rel.relname || '.' || trg.tgname AS item, 1::bigint AS found, true AS blocked,
    'An update trigger on the login or on a table the anonymise blanks has not been reviewed. Engineering must review it in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_trigger AS trg
  JOIN pg_catalog.pg_class AS rel ON rel.oid = trg.tgrelid
  JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace
  WHERE NOT trg.tgisinternal AND (trg.tgtype::integer & 16) <> 0
    AND ((nsp.nspname = 'auth' AND rel.relname = 'users') OR (nsp.nspname = 'public' AND rel.relname::text IN (${updateTables})))
    AND (nsp.nspname::text, rel.relname::text, trg.tgname::text) NOT IN (VALUES ${reviewedUpdates})`,
    `SELECT 'G-22'::text AS guard, child_rel.relname || '.' || con.conname || ' to ' || parent_rel.relname AS item, 1::bigint AS found, true AS blocked,
    'A kept table links to a table the anonymise empties, so deleting it would change or refuse kept rows. Engineering must review the link in the generator first.'::text AS clears, false AS info
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
  WHERE con.contype = 'f' AND child_nsp.nspname = 'public' AND parent_nsp.nspname = 'public' AND con.conrelid <> con.confrelid
    AND child_rel.relname::text IN (${keptTables})
    AND parent_rel.relname::text IN (SELECT plan.table_name FROM plan)
    AND (
      (child_rel.relname::text, con.conname::text) NOT IN (VALUES ${reviewedLinks})
      OR con.confdeltype <> 'n' OR att.attnotnull OR cardinality(con.conkey) <> 1
    )`,
  ];
}

/**
 * The guard rows (G-1, G-2, G-4 to G-19). G-3, the typed confirmation, is
 * checked in the delete block. The anonymise mode (workplan §3.2) replaces G-2
 * with G-2a, reports G-5, G-7, G-9 C3, G-14 and G-15 as `info`, and adds the
 * blank-column G-11 rows, G-20, G-21 and G-22.
 */
function guardRowsCte(mode: CleanupMode = 'hard'): string {
  const isAnonymise = mode === 'anonymise';
  /** `, false AS info` on the inline rows in the anonymise mode, nothing in the hard mode. */
  const ix = isAnonymise ? ', false AS info' : '';
  const g = (id: string, item: string, countSql: string, clears: string, blockedWhen = 'counted.found > 0', info = false) =>
    isAnonymise
      ? guard(id, item, countSql, info ? KEPT_CLEARS[id] ?? clears : clears, info ? 'false' : blockedWhen, info ? 'counted.found > 0' : 'false')
      : guard(id, item, countSql, clears, blockedWhen);
  const uid = 'target.user_id';
  const reviewedTriggers = [...REVIEWED_DELETE_TRIGGERS, ...EXTRA_REVIEWED_TRIGGERS]
    .map((t) => `(${lit(t.table)}, ${lit(t.trigger)})`)
    .join(', ');
  const buckets = litList(STORAGE_DESCRIPTORS.map((s) => s.bucket));

  const rows: string[] = [
    g(
      'G-1',
      'exactly one login has this email',
      '(SELECT count(*) FROM matches)',
      'Edit the email line at the top. It must match exactly one login.',
      'counted.target_email IS NULL OR counted.found <> 1'
    ),
    isAnonymise
      ? g(
          'G-2a',
          'the account id and the email name the same login',
          `CASE WHEN ${uid} IS NOT NULL AND ${uid} = params.subject_id THEN 1 ELSE 0 END`,
          'The account picked and the email do not resolve to the same login. Reload the page and pick the account again.',
          'counted.found <> 1'
        )
      : g(
          'G-2',
          'the email contains the test tag',
          `CASE WHEN params.test_tag IS NULL OR params.target_email IS NULL THEN 0 ELSE sign(strpos(params.target_email, params.test_tag)) END`,
          'Only an email containing the test tag can be removed. Set the tag line (never empty) or pick a test account.',
          'counted.test_tag IS NULL OR counted.found <> 1'
        ),
    g(
      'G-4',
      'not a platform admin',
      `(SELECT count(*) FROM public.admin_users AS admins WHERE admins.user_id = ${uid} OR lower(admins.email) = params.target_email)`,
      'Admins are never removed here. Remove the admin row by hand first if this really is a test account.'
    ),
    g(
      'G-5',
      'nothing ever ran in Stripe live mode',
      `(SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = ${uid} AND billing.livemode)
      + (SELECT count(*) FROM public.business_os_boost_purchases AS boosts WHERE boosts.user_id = ${uid} AND boosts.livemode)
      + (SELECT count(*) FROM public.business_os_billing_events AS money WHERE money.user_id = ${uid} AND money.livemode)`,
      'Real money. This account is not a test account and must not be removed.',
      'counted.found > 0',
      true
    ),
    g(
      'G-6',
      'no live plan subscription, test or live mode',
      `(SELECT count(*) FROM public.business_os_billing_accounts AS billing WHERE billing.user_id = ${uid}
        AND (billing.subscription_status IN (${litList(R3_LIVE_STATUSES)}) OR (billing.stripe_subscription_id IS NOT NULL AND billing.ended_at IS NULL)))`,
      'Cancel the subscription in the Stripe dashboard, in its mode, then wait for the webhook.'
    ),
    g(
      'G-7',
      'legacy subscription with a Stripe id',
      `(SELECT count(*) FROM public.user_subscriptions AS legacy WHERE legacy.user_id = ${uid} AND legacy.stripe_subscription_id IS NOT NULL)`,
      'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.',
      'counted.found > 0',
      true
    ),
    g(
      'G-7',
      'legacy credit payment with a Stripe id',
      `(SELECT count(*) FROM public.credit_transactions AS legacy WHERE legacy.user_id = ${uid} AND legacy.stripe_payment_intent_id IS NOT NULL)`,
      'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.',
      'counted.found > 0',
      true
    ),
    g(
      'G-7',
      'legacy billing event from Stripe',
      `(SELECT count(*) FROM public.billing_events AS legacy WHERE legacy.user_id = ${uid} AND legacy.stripe_event_id IS NOT NULL)`,
      'Legacy rows carry no Stripe mode, so they are treated as real money. Engineering must review this account.',
      'counted.found > 0',
      true
    ),
    g(
      'G-8',
      'no Stripe account connected for client payments',
      `(SELECT count(*) FROM public.stripe_connect_accounts AS connect WHERE connect.user_id = ${uid})
      + (SELECT count(*) FROM public.plugin_connections AS plugins WHERE plugins.user_id = ${uid} AND plugins.plugin_key = 'stripe')`,
      'Disconnect Stripe from the business first.'
    ),
    ...LOCAL_BLOCKING_CONDITIONS.map((condition) =>
      g(
        'G-9',
        `money in flight: ${condition.label}`,
        `(SELECT count(*) FROM public.${condition.table} AS money WHERE money.user_id = ${uid} AND money.status IN (${litList(condition.statuses)}))`,
        // TL-6: in the anonymise modes only live money blocks. Sent or overdue
        // invoices are the business's own data and go with it (C3 is info).
        isAnonymise && condition.condition === 'C3'
          ? 'Reported only: these invoices are the business own data and are deleted with the account.'
          : 'Finish or cancel these in the app first.',
        'counted.found > 0',
        isAnonymise && condition.condition === 'C3'
      )
    ),
    `SELECT 'G-10'::text AS guard, fk_rows.fk_schema || '.' || fk_rows.fk_table || '.' || fk_rows.fk_column AS item, fk_rows.found::bigint AS found, true AS blocked,
    CASE WHEN fk_rows.kind IS NULL OR fk_rows.key_width <> 1
      THEN 'A link to the login nobody has reviewed. Engineering must classify it in the generator first.'
      ELSE 'Rows of other accounts or of the platform name this login. Clear them by hand first.' END AS clears${ix}
  FROM fk_rows
  WHERE fk_rows.kind IS NULL OR fk_rows.key_width <> 1 OR (fk_rows.kind = 'actor' AND fk_rows.found > 0)`,
    `SELECT 'G-10'::text AS guard, 'links to the login, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears${ix} FROM fk_catalog`,
    `SELECT 'G-11'::text AS guard, plan_state.table_name || '.' || plan_state.key_column AS item, NULL::bigint AS found, true AS blocked,
    'A column this script relies on is missing. Regenerate the script after the schema change.'::text AS clears${ix}
  FROM plan_state
  WHERE plan_state.present AND NOT (plan_state.key_ok AND plan_state.parent_ok)`,
    g(
      'G-12',
      'no stored files under the account folder',
      `(SELECT count(*) FROM storage.objects AS objects WHERE objects.bucket_id IN (${buckets}) AND starts_with(objects.name, ${uid}::text || '/'))`,
      'Empty the listed folders in the Supabase Storage dashboard, then run the check again.'
    ),
    ...ORG_CHILD_TABLES.map((child) =>
      g(
        'G-13',
        `no other account in its organisation: ${child.table}`,
        `(SELECT count(*) FROM public.${child.table} AS org_child WHERE org_child.org_id IN (SELECT target_orgs.org_id FROM target_orgs) AND org_child.${child.ownerColumn} IS DISTINCT FROM ${uid})`,
        'Another account belongs to an organisation this login owns. Move it out first.'
      )
    ),
    g(
      'G-14',
      'no consent ledger rows',
      `(SELECT count(*) FROM public.marketing_consent_events AS consent WHERE consent.user_id = ${uid})`,
      'The consent ledger is append-only and cannot be removed. This account cannot be cleaned by this script.',
      'counted.found > 0',
      true
    ),
    g(
      'G-15',
      'nobody else hangs below it in the invitation circle',
      `(SELECT count(*) FROM public.business_os_account_lineage AS lineage WHERE (lineage.parent_account_id = ${uid} OR lineage.root_account_id = ${uid}) AND lineage.account_id IS DISTINCT FROM ${uid})`,
      'It invited an account that still exists. Remove that account first.',
      'counted.found > 0',
      true
    ),
    g(
      'G-16',
      'no other account imported its shared agents',
      `(SELECT count(*) FROM public.shared_agent_imports AS imports JOIN public.shared_agents AS shared ON shared.id = imports.shared_agent_id WHERE shared.user_id = ${uid} AND imports.imported_by_user_id IS DISTINCT FROM ${uid})`,
      'Another account imported an agent it shared. Engineering must review this account.'
    ),
    `SELECT 'G-17'::text AS guard, rel.relname || '.' || trg.tgname AS item, 1::bigint AS found, true AS blocked,
    'A trigger on a table this script empties has not been reviewed. Engineering must review it in the generator first.'::text AS clears${ix}
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
    END AS clears${ix}
  FROM inbound_rows
  WHERE NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1 OR NOT inbound_rows.owner_ok OR inbound_rows.found > 0`,
    `SELECT 'G-18'::text AS guard, 'links pointing at removed tables, reviewed'::text AS item, count(*)::bigint AS found, false AS blocked, ''::text AS clears${ix} FROM inbound_catalog`,
    // G-19 (2026-10-08): ON DELETE SET NULL / SET DEFAULT into a NOT NULL
    // column fails the parent delete with 23502, as NO ACTION fails it with
    // 23503. Read from pg_catalog, never from a list, so any such link between
    // two plan tables is checked, and a plan that removes the parent first is
    // refused before anything is removed. Every key column counts, the
    // conservative reading of a column-list SET NULL (none exists on prod).
    `SELECT 'G-19'::text AS guard, child_plan.table_name || '.' || att.attname || ' to ' || parent_plan.table_name AS item, 1::bigint AS found, true AS blocked,
    'Removing a row of the second table empties a NOT NULL column of the first (ON DELETE SET NULL or SET DEFAULT), which the database refuses, and the plan removes the second table first. Engineering must order the first table before it in the generator.'::text AS clears${ix}
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS child_rel ON child_rel.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS child_nsp ON child_nsp.oid = child_rel.relnamespace
  JOIN pg_catalog.pg_class AS parent_rel ON parent_rel.oid = con.confrelid
  JOIN pg_catalog.pg_namespace AS parent_nsp ON parent_nsp.oid = parent_rel.relnamespace
  JOIN plan AS parent_plan ON parent_plan.table_name = parent_rel.relname::text
  JOIN plan AS child_plan ON child_plan.table_name = child_rel.relname::text
  JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
  WHERE con.contype = 'f' AND con.confdeltype IN ('n', 'd') AND con.conrelid <> con.confrelid
    AND parent_nsp.nspname = 'public' AND child_nsp.nspname = 'public'
    AND att.attnotnull AND (con.confdeltype = 'n' OR NOT att.atthasdef)
    AND child_plan.ord > parent_plan.ord`,
    ...(isAnonymise ? anonymiseGuardRows() : []),
  ];

  return `guard_rows AS (
  ${rows.join('\n  UNION ALL\n  ')}
)`;
}

/** What an informational guard row says in the anonymise mode: kept, not refused. */
const KEPT_CLEARS: Readonly<Record<string, string>> = {
  'G-5': 'Reported only: real money with us. Our billing rows are kept, with their personal details removed.',
  'G-7': 'Reported only: legacy money with us. The billing rows are kept, with their personal details removed.',
  'G-14': 'Reported only: the consent records of the business clients are kept under the closed account (NBQ-3).',
  'G-15': 'Reported only: the invitation link stays as a nameless link (NBQ-4).',
};

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
export function buildCheckQuery(mode: CleanupMode = 'hard'): string {
  return `${checkCtes(mode)}
SELECT report.section, report.status, report.item, report.found, report.detail
FROM report
ORDER BY report.section_order, report.sort_order, report.item`;
}

/**
 * The same check as one jsonb array, ordered by explicit keys (R-2 g). The
 * anonymise mode also reads `cleanup.subject_id` (G-2a) and reports `info`
 * rows apart from `BLOCKED` ones.
 */
export function buildCheckJson(mode: CleanupMode = 'hard'): string {
  return `${checkCtes(mode)}
SELECT jsonb_agg(jsonb_build_object('section', report.section, 'status', report.status, 'item', report.item, 'found', report.found, 'detail', report.detail)
  ORDER BY report.section_order, report.sort_order, report.item)
FROM report`;
}

/** The anonymise check: what stays, and the login, closed. The hard check lists the login under `remove`. */
function anonymiseKeptRows(): string {
  const kept = KEEP_SET.filter((entry) => entry.column !== null).map(
    (entry, index) => `(${index + 1}, ${lit(entry.table)}, ${lit(entry.column as string)})`
  );
  kept[0] = kept[0].replace(/^\((\d+), ('[^']*'), ('[^']*')\)$/, '($1, $2::text, $3::text)');
  return `  SELECT 5, 'kept', kept_values.ord, 'kept', kept_values.table_name,
    CASE WHEN target.user_id IS NULL THEN NULL
      ELSE ${countOf(`format('SELECT count(*) AS row_count FROM public.%I WHERE %I = %L', kept_values.table_name, kept_values.key_column, target.user_id)`)} END,
    'Kept under the same account id. Personal columns are blanked.'
  FROM (VALUES
    ${kept.join(',\n    ')}
  ) AS kept_values(ord, table_name, key_column)
  CROSS JOIN target
  WHERE EXISTS (
    SELECT 1 FROM information_schema.columns AS cols
    WHERE cols.table_schema = 'public' AND cols.table_name = kept_values.table_name AND cols.column_name = kept_values.key_column
  )
  UNION ALL
  SELECT 5, 'kept', 1000, 'kept', 'business_os_invites redeemed or claimed by it',
    (SELECT count(*) FROM public.business_os_invites AS invites CROSS JOIN target WHERE invites.redeemed_account_id = target.user_id OR invites.claimed_account_id = target.user_id),
    'Kept for the inviter. The invitee email becomes the closed placeholder and the notes are emptied.'
  UNION ALL
  SELECT 5, 'kept', 1001, 'kept', 'the login (auth.users)', (SELECT count(*) FROM matches),
    'Closed and anonymised in place: placeholder email, no password, phone, identities or sessions, banned. The email can sign up again.'
  WHERE (SELECT target.user_id FROM target) IS NOT NULL`;
}

/**
 * Every CTE of the check, ending with `report`. The hard rendering is
 * byte-identical to 20261077 (W-10). The anonymise one sorts G-2a by its
 * number, reports `info` rows with their note, lists the keep-set and the
 * closed login under `kept`, and leaves out the login-trigger section (G-21
 * reviews the triggers the closure fires).
 */
function checkCtes(mode: CleanupMode = 'hard'): string {
  const buckets = litList(STORAGE_DESCRIPTORS.map((s) => s.bucket));
  const isAnonymise = mode === 'anonymise';
  const guardSort = isAnonymise ? `substring(guard_rows.guard FROM '[0-9]+')::integer` : 'substring(guard_rows.guard FROM 3)::integer';
  const guardStatus = isAnonymise
    ? `CASE WHEN guard_rows.blocked THEN 'BLOCKED' WHEN guard_rows.info AND guard_rows.found > 0 THEN 'info' ELSE 'ok' END`
    : `CASE WHEN guard_rows.blocked THEN 'BLOCKED' ELSE 'ok' END`;
  const guardDetail = isAnonymise
    ? `CASE WHEN guard_rows.blocked OR (guard_rows.info AND guard_rows.found > 0) THEN guard_rows.clears ELSE '' END`
    : `CASE WHEN guard_rows.blocked THEN guard_rows.clears ELSE '' END`;
  const tail = isAnonymise
    ? `
  UNION ALL
  SELECT 3, 'storage', 0, 'empty this folder', objects.bucket_id || '/' || objects.name, NULL, 'The delete removes it first.'
  FROM storage.objects AS objects
  CROSS JOIN target
  WHERE objects.bucket_id IN (${buckets}) AND starts_with(objects.name, target.user_id::text || '/')
  UNION ALL
${anonymiseKeptRows()}
)`
    : `
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
  return `WITH
${sharedCtes(mode)},
${guardRowsCte(mode)},
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
  SELECT 1, 'guard', ${guardSort}, ${guardStatus},
    guard_rows.guard || ' ' || guard_rows.item, guard_rows.found, ${guardDetail}
  FROM guard_rows
  UNION ALL
  SELECT 2, 'remove', removal.ord,
    CASE WHEN NOT removal.present THEN 'absent' WHEN removal.found IS NULL THEN 'unknown' ELSE 'remove' END,
    removal.step || ' ' || removal.table_name, removal.found, ''
  FROM removal
  WHERE removal.found IS DISTINCT FROM 0 AND (SELECT target.user_id FROM target) IS NOT NULL${tail}`;
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
 * `cleanup.actor_id` and `cleanup.source` (SA-5). The admin page sets both:
 * the admin is then `user_id` AND `actor_id` (AD-2 convention), because
 * /admin/audit-trail names a row only from `user_id`. Unset, as in the pasted
 * file, they give `user_id = actor_id = NULL` and `source = 'operator_sql'`.
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
    ${lit(AUDIT_ACTION)}, 'user', v_user_id::text, NULL,
    NULLIF(current_setting('cleanup.actor_id', true), '')::uuid, NULLIF(current_setting('cleanup.actor_id', true), '')::uuid,
    jsonb_build_object('source', coalesce(NULLIF(current_setting('cleanup.source', true), ''), 'operator_sql'), 'script', ${lit(DELETE_FILE)}, 'tables', v_tables, 'rows', v_total, 'counts', v_counts),
    ${lit(AUDIT_SEVERITY)}, ARRAY[${litList(AUDIT_COMPLIANCE_FLAGS)}]::text[], now()
  );

  RAISE NOTICE 'CLEAN. Removed % rows from % tables and the login %', v_total, v_tables, v_user_id;
END`;
}

/**
 * The predicate naming the subject in Supabase's own auth log (W-4, TL W3). The
 * payload column is `json`, so it is cast. Every comparison is text. The email
 * catches rows a failed or pre-signup action wrote without the subject's id.
 */
export function authLogPredicate(alias: string): string {
  return `((${alias}.payload::jsonb ->> 'actor_id') = v_user_id::text
      OR (${alias}.payload::jsonb -> 'traits' ->> 'user_id') = v_user_id::text
      OR lower(${alias}.payload::jsonb ->> 'actor_username') = v_email
      OR lower(${alias}.payload::jsonb -> 'traits' ->> 'user_email') = v_email)`;
}

/**
 * The blank rules as rows, with the SET value, the "still holds a value" test
 * and the key predicate already formatted. Read by the blank loop and by the
 * re-read after it, so both use exactly the same rule. Reads `v_user_id` and
 * `v_placeholder`.
 */
function blankRowsSql(indent: string): string {
  const values = BLANK_LIST.map(
    (blank, index) =>
      `${indent}  (${index + 1}, ${lit(blank.table)}, ${lit(blank.column)}, ${lit(blank.target)}, ${lit(`{${(blank.keys ?? []).join(',')}}`)}, ${lit(blank.key)})`
  );
  values[0] = values[0].replace(/\((\d+), ('[^']*'), ('[^']*'), ('[^']*'), ('[^']*'), ('[^']*')\)$/, '($1, $2::text, $3::text, $4::text, $5::text[], $6::text)');
  return `${indent}SELECT blank_values.ord, blank_values.table_name, blank_values.column_name,
${indent}  CASE blank_values.target
${indent}    WHEN 'null' THEN 'NULL'
${indent}    WHEN 'empty_object' THEN format('%L::jsonb', '{}')
${indent}    WHEN 'strip' THEN format('%I - %L::text[]', blank_values.column_name, blank_values.strip_keys)
${indent}    WHEN 'placeholder' THEN format('%L', v_placeholder)
${indent}  END AS set_sql,
${indent}  CASE blank_values.target
${indent}    WHEN 'null' THEN format('%I IS NOT NULL', blank_values.column_name)
${indent}    WHEN 'empty_object' THEN format('%I IS DISTINCT FROM %L::jsonb', blank_values.column_name, '{}')
${indent}    WHEN 'strip' THEN format('%I ?| %L::text[]', blank_values.column_name, blank_values.strip_keys)
${indent}    WHEN 'placeholder' THEN format('%I IS DISTINCT FROM %L', blank_values.column_name, v_placeholder)
${indent}  END AS still_sql,
${indent}  CASE blank_values.key_kind
${indent}    WHEN 'user_id' THEN format('user_id = %L', v_user_id)
${indent}    WHEN 'invite_redeemer' THEN format('(redeemed_account_id = %L OR claimed_account_id = %L)', v_user_id, v_user_id)
${indent}  END AS key_sql
${indent}FROM (VALUES
${values.join(',\n')}
${indent}) AS blank_values(ord, table_name, column_name, target, strip_keys, key_kind)
${indent}WHERE to_regclass(format('public.%I', blank_values.table_name)) IS NOT NULL`;
}

/** The closure tables as typed VALUES rows: (ord, table_name, key_column, action). */
function authClosureValues(indent: string): string {
  const rows = AUTH_CLOSURE.filter((closure) => closure.column !== null).map(
    (closure, index) => `${indent}(${index + 1}, ${lit(closure.table)}, ${lit(closure.column as string)}, ${lit(closure.action)})`
  );
  rows[0] = rows[0].replace(/\((\d+), ('[^']*'), ('[^']*'), ('[^']*')\)$/, '($1, $2::text, $3::text, $4::text)');
  return rows.join(',\n');
}

/**
 * The anonymise (data export DE-10b.1, workplan §3), as one nested block of the
 * function. Never in a pasted file: it reads and sets variables of the
 * function around it (`v_receipt_id`, `v_receipt_mode`, `v_receipt_ref`,
 * `v_removed_rows`, `v_removed_tables`, `v_blanked_rows`, `v_subject_id`,
 * `v_report`).
 *
 * Order (§7.2): G-3 and every guard, then the anonymise plan, then the blanks
 * and their re-read, then the login closure and the auth log, then the
 * survivor scan, then the audit row. The function inserts the receipt after
 * it. Any failure raises, and the whole transaction rolls back.
 */
export function buildAnonymiseBlock(): string {
  const auditColumns = 'action, entity_type, entity_id, resource_name, user_id, actor_id, details, severity, compliance_flags, created_at';
  const keptTables = litList(KEEP_SET.map((entry) => entry.table));
  const closureSet = AUTH_USERS_CLOSURE.map((closure) => `${closure.column} = ${closure.value}`).join(',\n    ');
  return `DECLARE
  v_email text := NULLIF(lower(btrim(coalesce(current_setting('cleanup.target_email', true), ''))), '');
  v_confirm text := NULLIF(lower(btrim(coalesce(current_setting('cleanup.confirm_email', true), ''))), '');
  v_subject uuid := NULLIF(current_setting('cleanup.subject_id', true), '')::uuid;
  v_guard jsonb;
  v_blockers text;
  v_survivors text;
  v_user_id uuid;
  v_rows bigint;
  v_total bigint := 0;
  v_tables integer := 0;
  v_blanked_total bigint := 0;
  v_counts jsonb := '{}'::jsonb;
  v_blanked jsonb := '{}'::jsonb;
  v_closed jsonb := '{}'::jsonb;
  v_placeholder text;
  v_session_ids uuid[];
  v_factor_ids uuid[];
  v_step record;
  v_blank record;
  v_auth record;
BEGIN
  IF v_email IS NULL OR v_subject IS NULL THEN
    RAISE EXCEPTION 'No email or no account id. Nothing was removed.';
  END IF;
  IF v_confirm IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'G-3 the confirmation does not equal the email. Nothing was removed.';
  END IF;

  v_guard := (
    WITH
${sharedCtes('anonymise')},
${guardRowsCte('anonymise')}
    SELECT jsonb_build_object(
      'blockers', string_agg(guard_rows.guard || ' ' || guard_rows.item, ', ' ORDER BY guard_rows.guard, guard_rows.item) FILTER (WHERE guard_rows.blocked),
      'paid', coalesce(bool_or(guard_rows.info AND guard_rows.found > 0 AND guard_rows.guard IN ('G-5', 'G-7')), false))
    FROM guard_rows
  );
  v_blockers := v_guard ->> 'blockers';
  IF v_blockers IS NOT NULL THEN
    RAISE EXCEPTION 'BLOCKED, nothing was removed: %', v_blockers;
  END IF;

  v_user_id := v_subject;
  v_receipt_mode := CASE WHEN (v_guard ->> 'paid')::boolean THEN 'pseudonymised_billing_kept' ELSE 'anonymised' END;
  v_receipt_ref := substr(replace(v_receipt_id::text, '-', ''), 1, 12);
  v_placeholder := 'deleted-' || v_receipt_ref || '@' || ${lit(CLOSED_EMAIL_DOMAIN)};

  FOR v_step IN
    SELECT plan_values.table_name, plan_values.key_column, plan_values.parent_table
    FROM (VALUES
${planValues('      ', 'anonymise')}
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

  FOR v_blank IN
${blankRowsSql('    ')}
    ORDER BY 1
  LOOP
    IF v_blank.set_sql IS NULL OR v_blank.still_sql IS NULL OR v_blank.key_sql IS NULL THEN
      RAISE EXCEPTION 'A blank rule is not known, so everything was rolled back.';
    END IF;
    EXECUTE format('UPDATE public.%I SET %I = %s WHERE %s AND %s', v_blank.table_name, v_blank.column_name, v_blank.set_sql, v_blank.key_sql, v_blank.still_sql);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_blanked := v_blanked || jsonb_build_object(v_blank.table_name || '.' || v_blank.column_name, v_rows);
      v_blanked_total := v_blanked_total + v_rows;
    END IF;
  END LOOP;

  v_survivors := (
    SELECT string_agg(left_over.table_name || '.' || left_over.column_name, ', ' ORDER BY left_over.ord)
    FROM (
${blankRowsSql('      ')}
    ) AS left_over
    WHERE ${countOf(`format('SELECT count(*) AS row_count FROM public.%I WHERE %s AND %s', left_over.table_name, left_over.key_sql, left_over.still_sql)`)} > 0
  );
  IF v_survivors IS NOT NULL THEN
    RAISE EXCEPTION 'A blanked value is still there, so everything was rolled back: %', v_survivors;
  END IF;

  v_session_ids := ARRAY(SELECT sessions.id FROM auth.sessions AS sessions WHERE sessions.user_id = v_user_id);
  v_factor_ids := ARRAY(SELECT factors.id FROM auth.mfa_factors AS factors WHERE factors.user_id = v_user_id);

  UPDATE auth.users SET
    ${closureSet}
  WHERE id = v_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'The login was not closed. Everything was rolled back.';
  END IF;

  FOR v_auth IN
    SELECT closure.table_name, closure.key_column
    FROM (VALUES
${authClosureValues('      ')}
    ) AS closure(ord, table_name, key_column, action)
    WHERE closure.action = 'delete' AND to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL
    ORDER BY closure.ord
  LOOP
    EXECUTE format('DELETE FROM auth.%I WHERE %I = %L', v_auth.table_name, v_auth.key_column, v_user_id);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows > 0 THEN
      v_closed := v_closed || jsonb_build_object(v_auth.table_name, v_rows);
    END IF;
  END LOOP;

  DELETE FROM auth.audit_log_entries AS log_rows
  WHERE ${authLogPredicate('log_rows')};
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows > 0 THEN
    v_closed := v_closed || jsonb_build_object('audit_log_entries', v_rows);
  END IF;

  v_survivors := (
    WITH plan_keys AS (
      SELECT plan_values.table_name, plan_values.key_column
      FROM (VALUES
${planValues('        ', 'anonymise')}
      ) AS plan_values(ord, step, table_name, key_column, parent_table)
      WHERE plan_values.parent_table IS NULL
    )
    SELECT string_agg(left_over.item || ' ' || left_over.found, ', ' ORDER BY left_over.item)
    FROM (
      SELECT 'auth.users closed'::text AS item,
        (1 - (SELECT count(*) FROM auth.users AS users
          WHERE users.id = v_user_id AND users.email = v_placeholder AND users.phone IS NULL AND users.encrypted_password = ''
            AND users.banned_until > now() + interval '99 years'))::bigint AS found
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
        AND NOT (nsp.nspname = 'public' AND rel.relname::text IN (${keptTables}))
      UNION ALL
      SELECT 'auth.' || closure.table_name,
        ${countOf(`format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = %L', closure.table_name, closure.key_column, v_user_id)`)}
      FROM (VALUES
${authClosureValues('        ')}
      ) AS closure(ord, table_name, key_column, action)
      WHERE closure.action = 'delete' AND to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL
      UNION ALL
      SELECT 'auth.' || closure.table_name,
        ${countOf(`format('SELECT count(*) AS row_count FROM auth.%I WHERE %I = ANY (%L::uuid[])', closure.table_name, closure.key_column, CASE WHEN closure.action = 'via_sessions' THEN v_session_ids ELSE v_factor_ids END)`)}
      FROM (VALUES
${authClosureValues('        ')}
      ) AS closure(ord, table_name, key_column, action)
      WHERE closure.action IN ('via_sessions', 'via_factors') AND to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL
      UNION ALL
      SELECT 'auth.audit_log_entries'::text,
        (SELECT count(*) FROM auth.audit_log_entries AS log_rows WHERE ${authLogPredicate('log_rows')})::bigint
    ) AS left_over
    WHERE left_over.found > 0
  );
  IF v_survivors IS NOT NULL THEN
    RAISE EXCEPTION 'Something still names the login after the anonymise, so everything was rolled back: %', v_survivors;
  END IF;

  v_subject_id := v_user_id;
  v_removed_rows := v_total;
  v_removed_tables := v_tables;
  v_blanked_rows := v_blanked_total;
  v_report := jsonb_build_object('receipt_id', v_receipt_id, 'placeholder_ref', v_receipt_ref, 'receipt_mode', v_receipt_mode,
    'rows_removed', v_total, 'tables_removed', v_tables, 'rows_blanked', v_blanked_total, 'counts', v_counts, 'blanked', v_blanked, 'closed', v_closed);

  INSERT INTO public.audit_trail (${auditColumns})
  VALUES (
    ${lit(ANONYMISE_AUDIT_ACTION)}, 'user', v_user_id::text, NULL,
    NULLIF(current_setting('cleanup.actor_id', true), '')::uuid, NULLIF(current_setting('cleanup.actor_id', true), '')::uuid,
    jsonb_build_object('source', coalesce(NULLIF(current_setting('cleanup.source', true), ''), 'admin_page'), 'receipt_id', v_receipt_id, 'mode', v_receipt_mode,
      'tables', v_tables, 'rows', v_total, 'rows_blanked', v_blanked_total, 'counts', v_counts, 'blanked', v_blanked, 'closed', v_closed),
    ${lit(ANONYMISE_AUDIT_SEVERITY)}, ARRAY[${litList(ANONYMISE_AUDIT_COMPLIANCE_FLAGS)}]::text[], now()
  );

  RAISE NOTICE 'CLOSED. Removed % rows from % tables, blanked %, closed the login %', v_total, v_tables, v_blanked_total, v_user_id;
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

/** The receipt columns, in the order the INSERT names them (migration 20261080). */
export const RECEIPT_COLUMNS = [
  'id', 'status', 'mode', 'subject_user_id', 'placeholder_ref', 'email_fingerprint', 'fingerprint_key_version',
  'origin', 'executor_kind', 'executor_admin_id', 'executor_admin_email', 'reason_category', 'reason_note',
  'statement_language', 'statement_text', 'owner_last_export_ready_at', 'owner_export_downloaded_at', 'admin_export_existed',
  'rows_removed', 'rows_blanked', 'files_removed', 'tables_removed', 'requested_at', 'completed_at', 'retain_until', 'correlation_id',
] as const;

/**
 * The keys the function reads from `p_receipt` (W-7). Everything else the
 * receipt holds the function computes itself (id, status, mode, the reference,
 * the totals, completed_at) or takes from its parameters (executor_admin_id is
 * p_actor), and any such key in `p_receipt` is ignored.
 */
export const RECEIPT_INPUT_KEYS = [
  'email_fingerprint', 'fingerprint_key_version', 'origin', 'executor_kind', 'executor_admin_email', 'reason_category',
  'reason_note', 'statement_language', 'statement_text', 'owner_last_export_ready_at', 'owner_export_downloaded_at',
  'admin_export_existed', 'files_removed', 'requested_at', 'retain_until', 'correlation_id',
] as const;

/** The receipt, inserted last inside the transaction (R-2), for both the delete and the anonymise. */
function receiptInsertSql(): string {
  const r = (key: (typeof RECEIPT_INPUT_KEYS)[number]) => `(p_receipt ->> ${lit(key)})`;
  return `  IF p_mode IN ('delete', 'anonymise') THEN
    INSERT INTO ${RECEIPTS_TABLE} (${RECEIPT_COLUMNS.join(', ')})
    VALUES (
      v_receipt_id, 'completed', v_receipt_mode, v_subject_id, v_receipt_ref, ${r('email_fingerprint')}, ${r('fingerprint_key_version')}::smallint,
      ${r('origin')}, ${r('executor_kind')}, p_actor, NULLIF(${r('executor_admin_email')}, ''), ${r('reason_category')}, ${r('reason_note')},
      ${r('statement_language')}, ${r('statement_text')}, ${r('owner_last_export_ready_at')}::timestamptz, ${r('owner_export_downloaded_at')}::timestamptz, ${r('admin_export_existed')}::boolean,
      v_removed_rows, v_blanked_rows, coalesce(${r('files_removed')}::bigint, 0), v_removed_tables, ${r('requested_at')}::timestamptz, now(), ${r('retain_until')}::timestamptz, ${r('correlation_id')}
    );
  END IF;`;
}

/** The function, with `version` either the token or the real stamp. */
function renderFunctionSql(version: string): string {
  return `CREATE OR REPLACE FUNCTION ${FUNCTION_NAME}(p_mode text, p_email text, p_tag text, p_confirm text, p_actor uuid, p_secret text, p_subject uuid DEFAULT NULL, p_receipt jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $operator_cleanup$
DECLARE
  v_result jsonb;
  v_report jsonb := '{}'::jsonb;
  v_receipt_id uuid := pg_catalog.gen_random_uuid();
  v_receipt_mode text;
  v_receipt_ref text;
  v_subject_id uuid;
  v_removed_rows bigint := 0;
  v_removed_tables integer := 0;
  v_blanked_rows bigint := 0;
BEGIN
  IF p_secret IS NULL OR pg_catalog.length(p_secret) < 32 OR NOT EXISTS (
    SELECT 1 FROM operator_private.secrets AS stored
    WHERE stored.name = ${lit(SECRET_ROW_NAME)}
      AND stored.secret_sha256 = pg_catalog.sha256(pg_catalog.convert_to(p_secret, 'UTF8'))
  ) THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501';
  END IF;
  IF p_mode IS NULL OR p_mode NOT IN ('check', 'delete', 'anonymise_check', 'anonymise') THEN
    RAISE EXCEPTION 'unknown mode' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'delete' AND p_actor IS NULL THEN
    RAISE EXCEPTION 'a delete needs the admin id' USING ERRCODE = '22023';
  END IF;
  IF p_mode IN ('delete', 'anonymise') AND (p_receipt IS NULL OR pg_catalog.jsonb_typeof(p_receipt) IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'a delete needs the receipt' USING ERRCODE = '22023';
  END IF;
  IF p_mode IN ('anonymise_check', 'anonymise') AND p_subject IS NULL THEN
    RAISE EXCEPTION 'an anonymise needs the account id' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'anonymise' AND p_actor IS NULL AND (p_receipt ->> 'origin') IS DISTINCT FROM 'owner' THEN
    RAISE EXCEPTION 'an anonymise needs the admin id unless the owner asked' USING ERRCODE = '22023';
  END IF;
  IF p_mode IN ('delete', 'anonymise') THEN
    IF (p_receipt ->> 'origin') IS NULL OR (p_receipt ->> 'origin') NOT IN ('owner', 'admin') THEN
      RAISE EXCEPTION 'the receipt has no known origin' USING ERRCODE = '22023';
    END IF;
    IF ((p_receipt ->> 'origin') = 'owner') IS DISTINCT FROM ((p_receipt ->> 'executor_kind') = 'self_service') THEN
      RAISE EXCEPTION 'the receipt origin and executor disagree' USING ERRCODE = '22023';
    END IF;
    IF (p_receipt ->> 'origin') = 'owner' AND p_actor IS NOT NULL THEN
      RAISE EXCEPTION 'an owner deletion has no admin id' USING ERRCODE = '22023';
    END IF;
    IF (p_receipt ->> 'origin') = 'admin' AND p_actor IS NULL THEN
      RAISE EXCEPTION 'an admin deletion needs the admin id' USING ERRCODE = '22023';
    END IF;
    IF p_mode = 'delete' AND (p_receipt ->> 'origin') <> 'admin' THEN
      RAISE EXCEPTION 'a full delete is for admins only' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_mode IN ('check', 'anonymise_check') THEN
    PERFORM pg_catalog.set_config('transaction_read_only', 'on', true);
  END IF;
  PERFORM pg_catalog.set_config('cleanup.target_email', coalesce(p_email, ''), true);
  PERFORM pg_catalog.set_config('cleanup.test_tag', CASE WHEN p_mode IN ('check', 'delete') THEN coalesce(p_tag, '') ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.confirm_email', CASE WHEN p_mode IN ('delete', 'anonymise') THEN coalesce(p_confirm, '') ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.actor_id', CASE WHEN p_mode IN ('delete', 'anonymise') THEN coalesce(p_actor::text, '') ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.source', CASE WHEN (p_receipt ->> 'origin') = 'owner' THEN 'self_service' ELSE 'admin_page' END, true);
  PERFORM pg_catalog.set_config('cleanup.subject_id', CASE WHEN p_mode IN ('anonymise_check', 'anonymise') THEN p_subject::text ELSE '' END, true);
  PERFORM pg_catalog.set_config('cleanup.mode', p_mode, true);
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  IF p_mode = 'check' THEN
    v_result := (
${buildCheckJson()}
    );
  ELSIF p_mode = 'anonymise_check' THEN
    v_result := (
${buildCheckJson('anonymise')}
    );
  ELSIF p_mode = 'delete' THEN
    v_subject_id := (
      SELECT CASE WHEN count(*) = 1 THEN min(users.id::text)::uuid END
      FROM auth.users AS users
      WHERE lower(users.email) = NULLIF(lower(btrim(coalesce(p_email, ''))), '')
    );
${buildDeleteBlock()};
    v_result := (
${buildDeleteReportJson()}
    );
    v_receipt_mode := 'full_delete';
    v_removed_rows := (
      SELECT (audit.details ->> 'rows')::bigint FROM public.audit_trail AS audit
      WHERE audit.action = ${lit(AUDIT_ACTION)} AND audit.entity_id = v_subject_id::text AND audit.created_at = now()
      LIMIT 1
    );
    v_removed_tables := (
      SELECT (audit.details ->> 'tables')::integer FROM public.audit_trail AS audit
      WHERE audit.action = ${lit(AUDIT_ACTION)} AND audit.entity_id = v_subject_id::text AND audit.created_at = now()
      LIMIT 1
    );
    IF v_subject_id IS NULL OR v_removed_rows IS NULL OR v_removed_tables IS NULL THEN
      RAISE EXCEPTION 'The removal left no audit row to take the receipt totals from, so everything was rolled back.';
    END IF;
    v_report := pg_catalog.jsonb_build_object('receipt_id', v_receipt_id, 'receipt_mode', v_receipt_mode);
  ELSE
${buildAnonymiseBlock()};
    v_result := '[]'::jsonb;
  END IF;

${receiptInsertSql()}

  RETURN pg_catalog.jsonb_build_object('version', ${lit(version)}, 'mode', p_mode, 'rows', coalesce(v_result, '[]'::jsonb),
    'server_ms', (pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() - pg_catalog.statement_timestamp()) * 1000)::bigint) || v_report;
END
$operator_cleanup$`;
}

/** sha256 of the function SQL (with the token in place of the stamp), first 16 hex digits. */
export function cleanupFunctionVersion(): string {
  return createHash('sha256').update(renderFunctionSql(VERSION_TOKEN)).digest('hex').slice(0, 16);
}

/** The grants every version re-asserts. CREATE OR REPLACE keeps them, this makes it explicit. */
function renderGrantsSql(signature: string = FUNCTION_SIGNATURE): string {
  return `ALTER FUNCTION ${signature} OWNER TO postgres;
REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`;
}

/**
 * The migration (R-1 to R-4): CREATE OR REPLACE of the function, on top of the
 * schema, secret table and function the initial migration created. It never
 * touches the schema or the secret table, so the stored hash survives and no
 * setup step is repeated. It first drops the retired 6-argument signature if
 * present (20261081 did, SA §D), so the 8-argument one is the only overload. Comments stay at the top,
 * without semicolons or apostrophes, so the file is as paste-safe as the
 * operator files.
 */
export function renderMigrationSql(): string {
  const requiredChecks = FUNCTION_REQUIRED_TABLES.map(
    (required) => `  IF pg_catalog.to_regclass(${lit(`public.${required.table}`)}) IS NULL THEN
    RAISE EXCEPTION ${lit(`Apply ${required.migration} first  Nothing was applied`)};
  END IF;`
  ).join('\n');
  const requiredNames = FUNCTION_REQUIRED_TABLES.map((required) => required.migration).join(' and ');
  const purposeLines = FUNCTION_MIGRATION_PURPOSE.map((line) => `-- ${line}`).join(String.fromCharCode(10));
  return `-- ${FUNCTION_MIGRATION}. GENERATED by scripts/generate-test-account-cleanup-sql.ts. Never edit by hand, and never edit once applied
-- A changed plan goes in a new dated file (generator constant FUNCTION_MIGRATION).
-- Replaces the function public.operator_test_account_cleanup with the current plan. The schema operator_private and its secret table stay as they are
${purposeLines}
-- Drops the retired 6 argument signature first if it is still there
-- Apply order. First ${INITIAL_FUNCTION_MIGRATION}${requiredNames ? ` and ${requiredNames}` : ''}, then this file. It refuses otherwise and applies nothing
-- The app pins the version stamp this function returns. Until the deployed build and this function agree, the Danger Zone check and delete refuse
-- Rollback supabase/SQL Scripts/${FUNCTION_MIGRATION}_rollback.sql drops this signature and restores the function of ${PREVIOUS_FUNCTION_MIGRATION}
-- Operator exception OX-1r, extended by SA Review 2 section D. One secret-gated function for the admin-only cleanup routes
-- Its direct writes to the auth schema exist only here, in this generated function
-- It runs the same generated guards G-1 to G-19 as scripts/test-account-cleanup-delete.sql, and G-2a and G-20 to G-22 in the anonymise modes
-- It refuses with 42501 unless the caller sends the second secret whose sha256 only this database holds
-- Requirement docs/requirements/BUSINESS_OS_DATA_EXPORT_DE10B_REQUIREMENT.md and docs/requirements/TEST_ACCOUNT_CLEANUP_DANGER_ZONE_REQUIREMENT.md
-- Runbook docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md, section 6
-- search_path is pg_catalog, public, pg_temp (SA review) so the reviewed delete triggers resolve their tables as today
-- The whole file is one transaction, so the old signature goes and the new function arrives together or not at all

BEGIN;

DO $create_guard$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'anon or authenticated may create objects in schema public. Revoke that first. Nothing was applied.';
  END IF;
END
$create_guard$;

DO $order_guard$
BEGIN
  IF pg_catalog.to_regclass('operator_private.secrets') IS NULL OR (pg_catalog.to_regprocedure(${lit(RETIRED_FUNCTION_SIGNATURE)}) IS NULL AND pg_catalog.to_regprocedure(${lit(FUNCTION_SIGNATURE)}) IS NULL) THEN
    RAISE EXCEPTION ${lit(`Apply ${INITIAL_FUNCTION_MIGRATION} first  Nothing was applied`)};
  END IF;
${requiredChecks}
END
$order_guard$;

DROP FUNCTION IF EXISTS ${RETIRED_FUNCTION_SIGNATURE};

${renderFunctionSql(cleanupFunctionVersion())};

${renderGrantsSql()}

NOTIFY pgrst, 'reload schema';

COMMIT;
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
-- Drops this function first, so no two overloads stay live (SA W-3)
-- Then restores the function exactly as supabase/migrations/${PREVIOUS_FUNCTION_MIGRATION}.sql created it, with its grants. Keeps the schema, the secret table and the stored hash
-- Then redeploy an app build that pins the version stamp of ${PREVIOUS_FUNCTION_MIGRATION}, or the Danger Zone check and delete refuse
${ROLLBACK_CONSEQUENCE.map((line) => `-- ${line}`).join(String.fromCharCode(10))}
-- Closed accounts and receipts already made stay as they are. Nothing can restore them
-- The receipt table of 20261080 stays. Its own rollback refuses once any receipt exists
-- To remove the whole feature instead, also run supabase/SQL Scripts/${INITIAL_FUNCTION_MIGRATION}_rollback.sql afterwards
-- The whole file is one transaction

BEGIN;

DROP FUNCTION IF EXISTS ${FUNCTION_SIGNATURE};

${previousFunctionSql(previousMigrationSql)};

${renderGrantsSql(PREVIOUS_FUNCTION_SIGNATURE)}

NOTIFY pgrst, 'reload schema';

COMMIT;
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

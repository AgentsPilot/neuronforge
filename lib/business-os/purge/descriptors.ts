// lib/business-os/purge/descriptors.ts
//
// T4 — THE declarative descriptor set. This is the whole design.
//
// Requirement §10.9: the executor iterates *only* this structure, and no table
// or bucket name appears anywhere else in the feature. If you can grep a table
// name outside this file and the RPC's generated body, the design has leaked.
// `__tests__/descriptors.invariant.test.ts` (AC-45) enforces that mechanically,
// including the B-1 assertion that `BusinessPurgeRepository` is the only file in
// the feature importing a Supabase client.
//
// ── Where the contents come from ────────────────────────────────────────────
// Every row is traceable to one of two places, never to a migration file:
//   * Classification (`level`) — the requirement's §3 (64 in-scope) and §8
//     (54 exclusions), as amended by the T1 classification pass.
//   * Ordering (`order`) and scoping facts — the LIVE schema dump,
//     `docs/workplans/business-os-business-data-purge-schema-dump.md`, produced
//     by `purge_schema_introspect()` on 2026-09-15T13:12:15Z.
//
// Migration files describe intent; three separate inventory claims built from
// them were wrong when measured. The database is the fact.
//
// ── How ordering works, and why it is only a handful of constraints ─────────
// The full FK graph is CYCLIC and cannot be topologically sorted:
// `scheduling_bookings.contact_id -> crm_contacts` is SET NULL while other
// edges run the other way. That does not matter, because only RESTRICT and
// NO ACTION edges can make a DELETE fail — CASCADE removes the child for you,
// SET NULL nulls it. Restricted to blocking edges the graph IS acyclic, and
// there are exactly TEN of them whose parent is in the delete set, of which
// FIVE constrain a purge (the other five are billing-to-billing, never-to-never),
// plus `crm_activities`-last and B4, which is a trigger and not an FK at all.
//
// ⚠️ The count is TEN, not nine. A census filtered to edges where BOTH endpoints
// are user-scoped returns nine and misses B7 — `agent_scheduler_state` has no
// tenancy column, so a user-scoped filter cannot see it BY CONSTRUCTION. The
// correct filter is "every blocking edge whose PARENT is in the delete set",
// child unrestricted. Anyone re-deriving this with the obvious filter will get
// nine again and lose exactly the edge that is hardest to find.
//
// So `order` is not a topological sort. It is a set of bands, and the invariant
// test asserts the real constraints hold within it. Adding a table in the
// wrong band is caught by the test, not by review.

import type { PurgeDescriptor, StorageDescriptor } from './types';

/**
 * Ordering bands. Lower runs first.
 *
 * Bands exist so a new table can be added without renumbering anything: pick
 * the band, and the invariant test tells you if you were wrong.
 */
const ORDER = {
  /** Children that BLOCK a later delete. Must precede their parent. */
  BLOCKING_CHILD: 100,
  /** Ordinary leaf/child rows. */
  LEAF: 300,
  /** Domain roots reached by the blocking children above. */
  ROOT: 500,
  /** Config/identity kept by Reset, removed by Purge. */
  CONFIG: 700,
  /**
   * `crm_activities` only. Deleted LAST inside the RPC (FR-17, AC-22).
   *
   * Deleting `payment_refunds` fires `recompute_transaction_refund_state`,
   * which UPDATEs `payment_transactions.status`, which fires
   * `log_payment_activity_trigger`, which INSERTs into `crm_activities`. That
   * is the single live residue path — confirmed against the live trigger
   * definitions, not inferred. Trigger suppression is NOT available to the
   * service role (`DISABLE TRIGGER` is owner-only, `session_replication_role`
   * is superuser-only), so ordering is the entire mitigation.
   */
  LAST: 9000,
} as const;

/**
 * The blocking FK edges that constrain a purge, lifted verbatim from the live dump.
 *
 * Exported because the invariant test asserts `order[child] < order[parent]`
 * for each one. That makes the ordering *verified against the database* rather
 * than asserted by whoever last edited the bands.
 *
 * `agent_logs -> agents` (B6) and `agent_scheduler_state -> agent_executions`
 * (B7) both sit inside the off-by-default "delete my agents" option, so a
 * default T28 sweep never exercises them — which is why C-28 makes the
 * agents-on run a hard gate rather than a nice-to-have.
 */
export const BLOCKING_EDGES: ReadonlyArray<{
  child: string;
  parent: string;
  onDelete: 'RESTRICT' | 'NO ACTION';
  id: string;
}> = [
  { child: 'payment_refunds',            parent: 'payment_transactions', onDelete: 'RESTRICT',  id: 'B1' },
  { child: 'payment_plan_subscriptions', parent: 'scheduling_bookings',  onDelete: 'RESTRICT',  id: 'B2' },
  { child: 'insight_automations',        parent: 'kernel_executions',    onDelete: 'NO ACTION', id: 'B3' },
  { child: 'agent_logs',                 parent: 'agents',               onDelete: 'NO ACTION', id: 'B6' },
  { child: 'agent_scheduler_state',      parent: 'agent_executions',     onDelete: 'NO ACTION', id: 'B7' },
  // The remaining four blocking edges among user-scoped tables sit entirely
  // between tables the owner ruled `never` (the billing cluster:
  // billing_events, boost_pack_purchases, user_rewards -> credit_transactions;
  // credit_transactions -> token_usage; billing_events -> user_subscriptions).
  // They never constrain a purge. Listed here in comment form so that
  // reclassifying any billing table knows it inherits an ordering problem.
];

/**
 * B4 is not an FK constraint and cannot be expressed as one.
 *
 * `scheduling_bookings.contact_id -> crm_contacts` is SET NULL and does not
 * block. The constraint comes from `delete_future_bookings_on_contact_delete_trigger`,
 * a BEFORE DELETE trigger on `crm_contacts` that deletes future bookings and so
 * trips B2 from a direction B2 alone does not name. Encoded as an explicit
 * ordering assertion because no FK dump would ever reveal it.
 */
export const TRIGGER_ORDERING: ReadonlyArray<{ before: string; after: string; why: string }> = [
  {
    before: 'payment_plan_subscriptions',
    after: 'crm_contacts',
    why: 'B4 — T1 (BEFORE DELETE on crm_contacts) deletes future bookings, tripping B2',
  },
];

// ────────────────────────────────────────────────────────────────────────────
// IN SCOPE — the 64 tables of requirement §3
// ────────────────────────────────────────────────────────────────────────────

const IN_SCOPE: PurgeDescriptor[] = [
  // ── §3.1 Business profile ────────────────────────────────────────────────
  { table: 'business_profiles', level: 'purge', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows',
    notes: '1:1 with auth.users — THIS is the "business" row. Kept by Reset so tests re-run without onboarding. No DELETE RLS policy.' },

  // ── §3.2 CRM ─────────────────────────────────────────────────────────────
  { table: 'crm_contacts', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows',
    notes: 'CRM hub. BEFORE DELETE trigger T1 deletes future bookings — see TRIGGER_ORDERING (B4).' },
  { table: 'crm_activities', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LAST, snapshot: 'rows',
    notes: 'DELETED LAST. The single live T5 residue path writes here mid-purge; ordering is the only available mitigation.' },
  { table: 'crm_pipeline_stages', level: 'purge', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows',
    notes: 'Seeded by /api/onboarding/build; Reset keeps them so the board still works.' },
  { table: 'crm_tasks', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'contact_documents', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'Rows index objects in the contact-documents bucket. NOTE: ContactDocumentsRepository soft-deletes, which is why the snapshot must NOT read through it (B-4).' },

  // ── §3.3 Website ─────────────────────────────────────────────────────────
  { table: 'website_pages', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'website_blocks', level: 'reset', scope: { kind: 'via', parent: 'website_pages', fk: 'page_id' }, order: ORDER.LEAF, snapshot: 'ids',
    notes: 'No user_id column. Child ids captured pre-delete so AC-5 has an oracle (C-13).' },
  { table: 'website_content', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: '1:1. No DELETE RLS policy.' },
  { table: 'website_page_views', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'ids',
    notes: 'IDS ONLY (DEV-Q6). Unbounded, publicly writable (WITH CHECK true), append-only, forensically worthless row-by-row. A row ceiling here would make a busy business undeletable.' },

  // ── §3.4 Scheduling ──────────────────────────────────────────────────────
  { table: 'scheduling_services', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'scheduling_bookings', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows',
    notes: 'Blocked by B2; also reached by trigger T1.' },
  { table: 'scheduling_availability_exceptions', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'external_calendar_events', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'calendar-sync repopulates within ~5 min after a Reset (business_profiles is kept and drives its enumeration) — FR-26.' },

  // ── §3.5 Payments ────────────────────────────────────────────────────────
  { table: 'payment_refunds', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.BLOCKING_CHILD, snapshot: 'rows',
    notes: 'B1 — RESTRICT onto payment_transactions, so this goes first. Deleting it fires T2, the single T5 residue path.' },
  { table: 'payment_plan_subscriptions', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.BLOCKING_CHILD, snapshot: 'rows',
    notes: 'B2 (RESTRICT onto scheduling_bookings) and B4 (must also precede crm_contacts). SELECT-only RLS.' },
  { table: 'payment_transactions', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'payment_invoices', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'payment_plans', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'payment_plan_installments', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'payment_events', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'payment_automation_rules', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'payment_automation_executions', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'payment_reminders', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'saved_payment_methods', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'payment_methods', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'Live — 2026-08-14_drop_payment_methods.sql was never applied. Measured, not assumed.' },
  { table: 'payment_processors', level: 'purge', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows',
    notes: 'Holds credentials JSONB. Kept by Reset so test payments work immediately.' },
  { table: 'stripe_connect_accounts', level: 'purge', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows',
    notes: 'The pre-flight gate READS this in phase 1, long before phase 2 deletes it.' },

  // ── §3.6 Email automation ────────────────────────────────────────────────
  { table: 'email_sequences', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'email_sequence_steps', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'email_campaigns', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'email_sends', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'email_sequence_enrollments', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'email_unsubscribes', level: 'never', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'K* — RETAINED BY BOTH LEVELS (D8). A third party withdrew consent. auth.users survives, so the same user_id can re-onboard; deleting this would resume emailing people who opted out. FR-23 requires the copy to say so. Now DERIVED from marketing_consent_events by trigger, and kept because this promise is made to users in two places.' },

  { table: 'business_subscribers', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'The newsletter audience. Reset clears it with the rest of the business data — unlike the consent ledger, which records what each person AGREED to and is retained forever. A rebuilt business starts with an empty list and has to earn it again.' },

  // ── §3.6b Marketing consent ──────────────────────────────────────────────
  { table: 'marketing_consent_events', level: 'never', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows',
    notes: 'Same reasoning as email_unsubscribes, in both directions. A withdrawal must outlive the business, or a reset resumes mailing people who opted out. A GRANT must outlive it too: the evidence of what someone agreed to is what answers a complaint or a subject access request years later, and it cannot be reconstructed.' },
  { table: 'marketing_consent_state', level: 'never', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'The projection the send gate reads. Deleting it would read as "no decision recorded", which fails closed for grants but would also lose every suppression. Derived, but not disposable.' },
  { table: 'marketing_consent_settings', level: 'purge', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows',
    notes: 'Business configuration — the tenant\'s own consent wording, privacy notice and postal address. Unlike the decisions above, this is theirs, not their clients\'.' },

  // ── §3.7 Intake ──────────────────────────────────────────────────────────
  { table: 'user_intake_settings', level: 'purge', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows' },
  { table: 'business_intake_forms', level: 'purge', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows',
    notes: 'Confirmed live by T1, so §10.2 para 2 is firm and AC-3 asserts it unconditionally.' },

  // ── §3.8 Onboarding & chat ───────────────────────────────────────────────
  { table: 'onboarding_conversations', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'Append-only RLS; /api/onboarding/chat/reset already hard-deletes these.' },
  { table: 'onboarding_prompt_ideas', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'command_sessions', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'business_chat_conversation', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'user_id is the PRIMARY KEY, so at most one row per business. A low count here is correct, not a broken query.' },
  { table: 'business_chat_action_log', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'Deleted, and the idempotency keys are NOT retained — FR-24 accepts the plan-level re-arm deliberately.' },
  { table: 'business_chat_saved_plans', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'business_chat_verified_questions', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'user_id is NOT NULL (measured) — so §8.2\'s portable-row shape does NOT apply here, unlike business_chat_plan_cache. Plain scoped delete.' },
  { table: 'business_chat_plan_cache', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'user_id is NULLABLE (measured). Rows WHERE user_id IS NULL are PORTABLE and shared by every tenant. The predicate is `user_id = p_user_id` and must stay equality — `<>`, `IS DISTINCT FROM` and `NOT IN` are FORBIDDEN here (§8.2). Those surviving rows are also why a planId can recur post-purge (FR-24).' },

  // ── §3.9 Capabilities ────────────────────────────────────────────────────
  { table: 'user_capabilities', level: 'purge', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows' },
  { table: 'user_capability_blocks', level: 'purge', scope: { kind: 'via', parent: 'user_capabilities', fk: 'user_capability_id' }, order: ORDER.CONFIG - 1, snapshot: 'ids',
    notes: 'No user_id. Child ids captured pre-delete for AC-5. Ordered one ahead of its parent so the reported count is the rows this delete actually removed, rather than 0 because the parent CASCADE got there first.' },

  // ── §3.10 Conversion / attribution ───────────────────────────────────────
  { table: 'smart_links', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'smart_link_clicks', level: 'reset', scope: { kind: 'via', parent: 'smart_links', fk: 'smart_link_id' }, order: ORDER.LEAF, snapshot: 'ids',
    notes: 'IDS ONLY (DEV-Q6) and no user_id. Publicly writable (WITH CHECK true). Ids-only still satisfies AC-5, which needs the ids and not the rows.' },

  // ── §3.11 Channel insights ───────────────────────────────────────────────
  { table: 'channel_connections', level: 'purge', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows',
    notes: 'Holds account_token. ALWAYS deleted by Purge regardless of the integrations checkbox — the UI must not imply otherwise (AC-32).' },
  { table: 'channel_metrics_daily', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'After a Reset, channel_connections and its last_synced_at both survive, so this returns on the connection\'s NEXT SCHEDULED sync — up to ~20h, not within the hour (FR-26 as amended).' },

  // ── §3.12 Insights ───────────────────────────────────────────────────────
  { table: 'insight_automations', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.BLOCKING_CHILD, snapshot: 'rows',
    notes: 'B3 — NO ACTION onto kernel_executions, so this goes first.' },
  { table: 'insights', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows',
    notes: 'Self-FK correlation_parent_id is SET NULL — cosmetic, needs no ordering.' },
  { table: 'owner_insight_history', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'business_events', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'Hazard H1 — no emitters; likely empty. Also one of insight-detect\'s four tenant-enumeration sources, all of which Reset deletes (FR-26).' },
  { table: 'derived_metrics', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'business_health_summaries', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },

  // ── §3.13 Kernel (insight-triggered) ─────────────────────────────────────
  { table: 'kernel_executions', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'kernel_action_log', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },

  // ── §3.14 Owner configuration ────────────────────────────────────────────
  { table: 'user_preferences', level: 'never', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows',
    notes: 'K* — RETAINED BY BOTH LEVELS. Holds preferred_language and currency. Deleting it resets the owner\'s language while they are reading the result screen, and renders their NEXT sign-in wrong — on a login that survives every level (D3).' },

  // ── §3.15 Newly classified in scope (T1 pass) ────────────────────────────
  { table: 'proposals', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows',
    notes: 'Business content the owner authored and sent to their clients. Self-FK supersedes_id is SET NULL — no ordering needed.' },
  { table: 'lead_responses', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'Lead data is customer data.' },
  { table: 'daily_briefings', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'daily_briefing_sends', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'A send log. It has the email_unsubscribes flavour but not its substance: a send history is the business\'s own activity record, not a third party\'s withdrawal of consent, so D8\'s retention reasoning does not extend to it.' },
  { table: 'user_media', level: 'reset', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'CONFIRMED at T4: storage_path points at the EXISTING website-images bucket (GeneratedImageService and StockImageService both write BUCKET = website-images and record here). So NO fourth StorageDescriptor is needed and AC-4 does not extend to a new bucket.' },
];

// ────────────────────────────────────────────────────────────────────────────
// OPT-IN EXTRAS — §10.3, all off by default
// ────────────────────────────────────────────────────────────────────────────

const OPT_IN: PurgeDescriptor[] = [
  { table: 'plugin_connections', level: 'optional:integrations', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows',
    notes: 'READ during phase 1 for Stripe account resolution, deleted in phase 2 — the phase split is what makes AC-33 true, and T9 asserts the order rather than assuming it.' },

  // "Also delete my agents". B6 and B7 both live here, and both are invisible
  // to a default T28 run because the option is off by default (C-28).
  { table: 'agent_logs', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.BLOCKING_CHILD, snapshot: 'rows',
    notes: 'B6 — NO ACTION onto agents, so this must precede it.' },
  { table: 'agent_scheduler_state', level: 'optional:agents', scope: { kind: 'via', parent: 'agents', fk: 'agent_id' }, order: ORDER.BLOCKING_CHILD + 1, snapshot: 'ids',
    notes: 'B7 (C-30). NO tenancy column at all, so FR-1\'s predicate cannot see it by construction — it is reachable only through the blocking-edge check. last_execution_id -> agent_executions is NO ACTION. agent_id -> agents is CASCADE, so deleting agents would clear it incidentally, but relying on that would make the order depend on an FK action someone can later change to SET NULL.' },
  { table: 'agents', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows' },
  { table: 'agent_executions', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.ROOT + 1, snapshot: 'rows' },
  { table: 'agent_memory', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'Confirmed live at T4 — it was not a migration-file phantom.' },
  { table: 'agent_memories', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'Distinct from agent_memory (singular). Both exist; see also run_memories and user_memory — four memory tables in total.' },
  { table: 'run_memories', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'user_memory', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'The user\'s own remembered preferences — leaving it after "delete my agents" is the same defect that added the prompt threads.' },
  { table: 'agent_prompt_threads', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'agent_prompt_workflow_generation_sessions', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows' },
  { table: 'data_decision_requests', level: 'optional:agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'PENDING a requirement amendment — §8.10 still lists this as provisional `never`, awaiting the identification T4 was asked for. Supplied: written by lib/pilot/shadow/DataDecisionHandler.ts, keyed to agent_id/execution_id, and decision_context/user_decision hold the data the decision was about. SA ruled optional:agents (N11). Both its FKs are CASCADE, so it adds NO ordering constraint (B5 does not exist).' },

  { table: 'audit_trail', level: 'optional:activityHistory', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows',
    notes: 'user_id is SET NULL on the auth FK. With this option ticked, the audit record of THIS purge is still written afterwards.' },
  // Admin Archiving (Slice 2, condition C-4): the audit rows that have been moved
  // out of audit_trail. Same classification, scope and band as their source, so
  // "delete my activity history" reaches archived history too (BQ-7, FR-14a).
  // `snapshot: 'ids'`, unlike audit_trail: archived history is the long tail by
  // definition, and a full-row snapshot above the 250,000-row SNAPSHOT_ROW_CEILING
  // would make a business with years of history impossible to purge.
  { table: 'archived_records', level: 'optional:activityHistory', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'ids',
    notes: 'Archived audit_trail rows (Admin Archiving). No FK to auth.users on purpose (Slice 2 SA R-1), so the user_id survives account deletion and this scope still finds the rows. Its archive_run_id FK points at archive_runs, which is never, so it constrains no purge.' },
];

// ────────────────────────────────────────────────────────────────────────────
// NEVER — §8. Enumerated, not prose.
//
// Without these rows FR-1 route (a) cannot tell an unknown table from a
// deliberately excluded one, and would fail closed on EVERY run. That is
// SA-2P1, and it is why a category name is not evaluable.
// ────────────────────────────────────────────────────────────────────────────

/** Build a `never` descriptor. Scope is recorded for documentation only — a `never` row never emits a delete. */
const never = (table: string, scope: PurgeDescriptor['scope'], notes: string): PurgeDescriptor =>
  ({ table, level: 'never', scope, order: ORDER.LEAF, snapshot: 'ids', notes });

const G = { kind: 'global' } as const;
const U = { kind: 'user_id' } as const;

const EXCLUDED: PurgeDescriptor[] = [
  // §8.1 Global catalogs — no user_id
  never('capabilities', G, 'Shared catalog, RLS off. Deleting it breaks every user.'),
  never('capability_building_blocks', G, 'Same.'),
  never('website_templates', G, 'Public read; breaks website creation platform-wide.'),
  never('intake_form_templates', G, 'Global catalog. Per the tenant-isolation-guard skill, do NOT invent a user_id filter on a global catalog.'),

  // §8.4 Organisation / multi-user
  never('organizations', { kind: 'user_id' }, 'Keys on owner_user_id, NOT user_id — so FR-1\'s predicate cannot see it, which is the gap N15\'s union predicate closes. Every user gets a row via get_or_create_user_organization.'),
  never('organization_members', U, 'Deleting a membership can strand a multi-user org.'),

  // §8.5 Billing & quota — owner-ruled
  never('subscriptions', U, 'Billing state.'),
  never('storage_usage', U, 'Platform quota accounting; deleting it corrupts billing state. Also carries AFTER DELETE triggers that recompute quota.'),
  never('user_subscriptions', U, 'OWNER RULING: the platform\'s commercial relationship with the customer, not the customer\'s data about their clients. A customer disputing a charge needs the evidence.'),
  never('subscription_invoices', U, 'Owner ruling — as above.'),
  never('billing_events', U, 'Owner ruling — as above.'),
  never('credit_transactions', U, 'Owner ruling — as above.'),
  never('boost_pack_purchases', U, 'Owner ruling — as above.'),

  // §8.6 Org analytics — a different subsystem
  never('advisor_reports', U, 'Org-analytics advisor, not Business OS Insights.'),
  never('automation_slas', U, 'Workflow/agent SLAs.'),
  never('metric_baselines', U, 'Agent-execution analytics, not derived_metrics.'),
  never('group_metrics_rollup', U, 'Workflow-group analytics.'),

  // §8.7 Kernel / V6 learning
  never('calibration_history', U, 'Kernel learning.'),
  never('error_patterns', U, 'Kernel learning.'),
  never('execution_anomalies', U, 'Kernel learning.'),
  never('execution_baselines', U, 'Kernel learning.'),
  never('plugin_performance', U, 'Kernel learning.'),

  // §8.8 Platform identity
  never('admin_users', U, 'Deleting rows here locks admins out. The trusted admin signal — never profiles.role.'),
  never('profiles', U, 'D3 — never deleted. (Its FK is profiles.id -> auth.users(id), not a user_id column.)'),

  // §8.10 Agent / workflow platform (kernel)
  never('agent_configurations', U, 'Agent platform.'),
  never('agent_execution_logs', U, 'Agent platform.'),
  never('agent_templates', U, 'Agent platform.'),
  never('agentkit_analytics', U, 'Agent platform.'),
  never('calibration_sessions', U, 'Agent platform.'),
  never('workflow_executions', U, 'Agent platform.'),
  never('pilot_step_routing_history', U, 'Agent platform. NOTE: carries WITH CHECK (true) INSERT policies granted to public — tracked separately (N17).'),
  never('shadow_failure_snapshots', U, 'Agent platform.'),
  never('shared_agents', U, 'Agent platform.'),
  never('execution_insight_runs', U, 'The OTHER insights system — agent execution quality, not the owner\'s business. The name collision is the most common mistake in this area.'),
  never('execution_insights', U, 'The OTHER insights system. Also carries a public WITH CHECK (true) INSERT policy (N17).'),
  never('agent_stats', U, 'BASE TABLE, not a view — confirmed by Part 2, so it needs this descriptor. Agent platform telemetry.'),
  never('agent_intensity_metrics', U, 'BASE TABLE, not a view — confirmed by Part 2. Agent platform telemetry.'),

  // §8.11 Token accounting
  never('token_usage', U, 'Token accounting.'),

  // §8.13 Business OS entitlements (subscription module, component 1)
  //
  // These are `never` for a reason that is the opposite of the usual one. They
  // ARE about this business — but a Reset that removed them would hand the
  // account a fresh trial, which is a commercial loophole, not a start-over.
  // They are keyed to auth.users, NOT cascaded from business_profiles, so
  // neither Reset nor Purge can reach them by accident either.
  never('business_os_account_plans', U,
    'Entitlement state (tier, cohort, expiries). Deleting it would restart the trial clock — a Reset must not be a way to get another free period. Keyed to auth.users, not business_profiles.'),
  never('business_os_entitlement_overrides', U,
    'The durable record of what an admin granted or revoked, and why. Support evidence; also never deleted by the admin reset, which ends rows instead.'),
  never('business_os_entitlement_shadow_events', U,
    'Aggregated "what would have been gated" counters. Platform observability about the product, not the owner\'s business data.'),

  // Admin Archiving (Slice 2, condition C-4)
  never('archive_runs', G,
    'The platform run log of archiving: who ran it, when, which cutoff, how many rows. No user_id and no business content, counts only. Never archived and never purged.'),

  // §8.12 Account configuration and unowned tables
  never('notification_settings', U, 'Account configuration that survives the business.'),
  never('security_settings', U, 'Account configuration that survives the business.'),
  never('api_keys', U, 'Account configuration.'),
  never('user_rewards', U, 'Rewards ledger, adjacent to billing.'),
  never('audit_logs', U, 'Live and user-scoped — NOT phantom, measured at T1. Distinct from audit_trail, so the activity-history checkbox does NOT cover it.'),
  never('processed_webhook_events', U, 'Carries a user_id, so §3.15\'s planned "global" default did not apply. Excluded anyway: a user-scoped idempotency row deleted mid-flight could let Stripe replay a webhook against a business that no longer exists.'),
];

// ────────────────────────────────────────────────────────────────────────────
// STORAGE (C-16) — buckets get descriptors for the same reason tables do.
// Unlike tables, storage has NO information_schema to fail closed against, so
// this list is the ONLY inventory that exists.
// ────────────────────────────────────────────────────────────────────────────

export const STORAGE_DESCRIPTORS: readonly StorageDescriptor[] = [
  { bucket: 'contact-documents', level: 'reset', pathPrefix: '{user_id}/', purpose: 'CRM contact documents; indexed by contact_documents rows.' },
  { bucket: 'website-images', level: 'reset', pathPrefix: '{user_id}/', purpose: 'Website images. ALSO backs user_media — confirmed at T4, which is why no fourth bucket descriptor is needed.' },
  { bucket: 'business-purge-snapshots', level: 'never', pathPrefix: '{user_id}/', purpose: 'The pre-purge snapshot itself. NEVER emptied by a purge — deleting the forensic artefact as part of the act it records would defeat its purpose. Private, no RLS policy granting authenticated anything (AC-36).' },
];

/** The single structure the executor iterates. Nothing else may enumerate tables. */
export const PURGE_DESCRIPTORS: readonly PurgeDescriptor[] = [
  ...IN_SCOPE,
  ...OPT_IN,
  ...EXCLUDED,
];

/** Tables a given run will actually delete from, in order. */
export function descriptorsForRun(
  level: 'reset' | 'purge',
  options: { integrations: boolean; agents: boolean; activityHistory: boolean }
): PurgeDescriptor[] {
  return PURGE_DESCRIPTORS.filter((d) => {
    if (d.level === 'never') return false;
    if (d.level === 'reset') return true;
    if (d.level === 'purge') return level === 'purge';
    const key = d.level.slice('optional:'.length) as keyof typeof options;
    return options[key] === true;
  }).sort((a, b) => a.order - b.order || a.table.localeCompare(b.table));
}

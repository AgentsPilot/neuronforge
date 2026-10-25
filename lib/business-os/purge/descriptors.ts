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
// The full FK graph is CYCLIC and cannot be topologically sorted: SET NULL
// edges such as `proposals.booking_id -> scheduling_bookings` run against
// others. That does not matter, because only RESTRICT and NO ACTION edges can
// make a DELETE fail — CASCADE removes the child for you, SET NULL nulls it —
// with ONE exception: SET NULL (or SET DEFAULT) into a NOT NULL column fails
// the parent delete with 23502, exactly as NO ACTION fails it with 23503.
// Those are NOT_NULL_OVERWRITE_EDGES below, held to the same child-first rule
// (test-account cleanup live failure, 2026-10-08). Restricted to blocking
// edges the graph IS acyclic, and
// there are exactly TEN of them whose parent is in the delete set, of which
// FIVE constrain a purge (the other five are billing-to-billing, never-to-never),
// plus `crm_activities`-last. (B4, a trigger rather than an FK, was retired in
// purge slice 3a — see the review note above REVIEWED_DELETE_TRIGGERS.)
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
import type { TableExportClassification } from '@/lib/business-os/data-export/classificationTypes';

// ── Data export classification (DE-2) ───────────────────────────────────────
// Every descriptor, table and bucket, carries a REQUIRED `export` field: is
// this in "Download my data"? (BUSINESS_OS_DATA_EXPORT_REQUIREMENT.md §0.3.6,
// FR-E17; BUSINESS_OS_DATA_EXPORT_DE2_WORKPLAN.md §4.) It is a second axis,
// independent of `level`: the purge engine never reads it, and nothing here
// derives one from the other. A new table is not done until it is classified:
// lib/business-os/data-export/__tests__/exportClassification.test.ts fails CI
// on a descriptor without one, on a secret column in an include list, and on a
// section registry that disagrees with these rows.

/** Why a table stays out of the export. Repeated reasons are named, not retyped. */
const EXPORT_REASON = {
  BILLING: 'DX-1: billing and credits are not exported',
  AGENTS: 'not Business OS data (user 2026-10-14)',
  ACTIVITY: 'DX-1d: activity (assistant chats, briefings, insights, emails sent) is not exported',
  VISITOR: 'DX-1d / SQ-E7: visitor tracking, not exported',
  AUDIT: "DX-1d: the owner's activity history is not exported; BD-26 hidden types never",
  PLATFORM: "platform data, not this account's data",
  ACTOR_REF: 'platform data; the account appears only as who changed a row',
  SECRET: 'secrets and credentials are never exported (§3.2)',
  CACHE: "cache or derived data, not the owner's data",
  MODULE_SETUP: 'PLATFORM: module setup, not data the owner entered (user 2026-10-15)',
  ORGANISATION: 'PLATFORM: agent-platform organisation record (user 2026-10-15)',
  // Data export DE-8a (requirement §0.3.3): the jobs table and the bucket that
  // hold the export are not exported again inside a later export.
  EXPORT_ITSELF: "the export itself: a short-lived copy of this account's data",
} as const;

/** Not in the export. `detail` adds what is specific to this table. */
const exclude = (reason: string, detail?: string): TableExportClassification =>
  ({ kind: 'exclude', reason: detail ? `${reason}; ${detail}` : reason });

// DE-7 (SA-Q9): the `planned()` helper is gone. Every table is now `include`
// or `exclude`, and the CI forbids `planned` on a table
// (exportClassification.test.ts, PLANNED_TABLES_ALLOWED = false), so a new
// table is classified on the spot. Buckets kept their own `planned` until
// DE-8b, which classified the last two (PLANNED_FILES_ALLOWED = false).

// `PROFILES_EXPORT` (section `user_profile`) moved to the DE-3 block below,
// after EXPORT_COLUMN_REASON, whose AGENT_SETTING reason it now uses.

/**
 * `plugin_connections` is NOT exported (user decision 2026-10-15, DE-4): the
 * export holds business data only, and a connected app is account plumbing.
 * The pending lawyer note in the requirement's §0.2 DX-1 now names connected
 * apps alongside activity. Until DE-4 this was an `include` of 13 columns with
 * a `profile_data` allow-list (DE-1 / DE-2); the reader, its repository method
 * and the allow-list were removed with it. The DE-0a / DE-0b token controls are
 * unaffected: they are about browser access, not the export.
 */
const PLUGIN_CONNECTIONS_EXCLUDED =
  'user 2026-10-15: connected apps dropped from the export (business data only); see lawyer note §0.2 DX-1';

// ── DE-4: client records (BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md §3) ─────────
// Eight tables, one section each, group `client_records` (AgentPilot is the
// processor; the account holder is the controller). Every list was checked
// column by column against the live schema on 2026-10-15 (workplan §10.1, SA
// review DE-4). Order matters: the export repository selects
// `columns.join(', ')`, pinned byte for byte in the characterization test.
// Ids and foreign-key ids ARE included: they are how a booking points at its
// client and its service inside the file. Changing a list changes what the
// export holds: a privacy decision, and an SA item.

/** Why a COLUMN stays out. Repeated reasons are named, not retyped (DE-4 SA-Q4). */
const EXPORT_COLUMN_REASON = {
  OWNER_ID: 'always the exporting account; it is in export_metadata.user_id',
  DOCUMENT_STORAGE:
    "where the file sits in our storage; the file itself arrives in 'Your files' (DE-8b), whose manifest comes from STORAGE_DESCRIPTORS",
  REMINDER_SENT: 'DX-1d: a reminder email sent is activity (user BC-6, 2026-10-15)',
  INTAKE_SENT: 'DX-1d: when the intake email was sent is activity (user BC-6, 2026-10-15)',
  CALENDAR_SYNC: 'calendar sync plumbing',
  // DE-3. The two user reasons are VERBATIM (user decisions BC-A / BC-B,
  // 2026-10-16; DE-3 SA C-1). Do not reword them.
  AGENT_SETTING: 'user 2026-10-16: agent-platform setting, Business OS data only',
  BANK_DETAILS: 'user 2026-10-16: bank details left out of the file',
  ASSISTANT_OUTPUT: 'assistant output, not something the owner entered (DX-1d; as DE-4 BC-7)',
  CONNECTED_APPS: 'connected apps are not exported (user DE4-U2, 2026-10-15)',
  SETUP_STATE: 'setup progress state the product keeps, not data the owner entered (as DE-2 BC-1; user BC-D, 2026-10-16)',
} as const;

/**
 * `crm_contacts` -> section `clients`. `source_metadata` is read but never
 * written raw: the section keeps only the user's BC-4 keys
 * (SOURCE_METADATA_KEYS in data-export/sections.ts). It also holds `ip_hash`
 * (a day-salted hash of the visitor's IP, recoverable), `session_id` and
 * `user_agent`, which never reach the file. The four attribution columns are
 * generated from `source_metadata` (20260826).
 */
const CRM_CONTACTS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'clients',
  columns: [
    'id', 'first_name', 'last_name', 'email', 'phone', 'stage', 'stage_entered_at', 'tags', 'custom_fields', 'notes',
    'source', 'source_metadata', 'referrer_domain', 'utm_source', 'utm_medium', 'utm_campaign', 'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/** `crm_activities` -> `client_activities`: notes and the history timeline, every type (B1 in whole). */
const CRM_ACTIVITIES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'client_activities',
  columns: [
    'id', 'contact_id', 'activity_type', 'title', 'description', 'activity_date', 'auto_logged', 'source_capability',
    'source_entity_id', 'created_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/** `crm_pipeline_stages` -> `pipeline_stages`. `stage_key` passes the deny list through DENY_EXCEPTIONS (SA-Q5). */
const CRM_PIPELINE_STAGES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'pipeline_stages',
  columns: ['id', 'vertical', 'stage_key', 'stage_label', 'position', 'color', 'stage_type', 'is_primary_client_stage', 'created_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/** `crm_tasks` -> `client_tasks`. Completed and cancelled tasks are in: statuses (BC-2). */
const CRM_TASKS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'client_tasks',
  columns: [
    'id', 'contact_id', 'title', 'description', 'priority', 'status', 'due_date', 'reminder_at', 'completed_at',
    'created_by', 'source_entity_type', 'source_entity_id', 'tags', 'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/**
 * `contact_documents` -> `client_documents`: the details only; the files
 * arrive in DE-8b. Deleted documents (`status = 'deleted'`, the soft delete
 * of ContactDocumentsRepository) are left out; archived ones are in (BC-3).
 * `status` is NOT NULL DEFAULT 'active' (20260722), so NOT IN drops no NULL row.
 */
const CONTACT_DOCUMENTS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'client_documents',
  columns: [
    'id', 'contact_id', 'name', 'document_type', 'file_name', 'file_size', 'mime_type', 'description', 'tags', 'status',
    'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    storage_path: EXPORT_COLUMN_REASON.DOCUMENT_STORAGE,
    storage_bucket: EXPORT_COLUMN_REASON.DOCUMENT_STORAGE,
  },
  rowFilter: {
    column: 'status',
    notIn: ['deleted'],
    reason: 'SQ-E5: soft-deleted documents are not exported (user BC-3, 2026-10-15: archived ones are)',
  },
};

/**
 * `scheduling_services` -> `services`. `price` always travels with
 * `currency`, the authority for what a client is charged (FR-E9). Draft and
 * inactive services are in: statuses.
 */
const SCHEDULING_SERVICES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'services',
  columns: [
    'id', 'service_name', 'description', 'duration_minutes', 'price', 'currency', 'buffer_minutes', 'max_bookings_per_day',
    'advance_booking_days', 'min_notice_hours', 'availability', 'is_active', 'status', 'is_scheduled', 'collection',
    'sale_mode', 'payment_type', 'installment_count', 'installment_frequency', 'first_payment_due', 'first_payment_days',
    'source', 'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    ai_suggestions: 'assistant output kept to pre-fill the service form, not a setting the owner chose (DX-1d; user BC-7, 2026-10-15)',
  },
};

/**
 * `scheduling_bookings` -> `bookings`. Cancelled, completed and no-show
 * bookings are in (BC-2); the owner's private `internal_notes` are in (BC-1).
 * `payment_amount` travels with `payment_currency`. `intake_responses` are the
 * client's answers: the owner's record.
 */
const SCHEDULING_BOOKINGS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'bookings',
  columns: [
    'id', 'service_id', 'contact_id', 'parent_booking_id', 'occurrence_number', 'start_time', 'end_time', 'timezone',
    'status', 'cancellation_reason', 'cancel_reason', 'cancel_note', 'cancelled_by', 'booking_source', 'notes',
    'internal_notes', 'payment_status', 'payment_method', 'payment_amount', 'payment_currency', 'payment_id', 'invoice_id',
    'payment_plan_id', 'intake_responses', 'intake_completed_at', 'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    reminder_24hr_sent: EXPORT_COLUMN_REASON.REMINDER_SENT,
    reminder_2hr_sent: EXPORT_COLUMN_REASON.REMINDER_SENT,
    intake_sent_at: EXPORT_COLUMN_REASON.INTAKE_SENT,
    intake_reminded_at: EXPORT_COLUMN_REASON.INTAKE_SENT,
    external_calendar_event_id: EXPORT_COLUMN_REASON.CALENDAR_SYNC,
    calendar_sync_provider: EXPORT_COLUMN_REASON.CALENDAR_SYNC,
    calendar_synced_at: EXPORT_COLUMN_REASON.CALENDAR_SYNC,
    calendar_sync_error: "the calendar provider's error text from our integration",
  },
};

/*
 * DE-7 replaced `planned()`: every table is classified on the spot, and the CI
 * forbids the old placeholder. These two arrived on a branch written before
 * that rule.
 *
 * EXCLUDED, NOT INCLUDED, AND THAT IS A DEFERRAL RATHER THAN A DECISION.
 *
 * `include` needs a SECTION, and the exporter allows exactly one include
 * descriptor per section — `BusinessDataExportRepository` raises
 * "expected one include descriptor for the section, found 3" when three tables
 * share `bookings`. Giving each its own section means adding ids to
 * `ExportSectionId` and naming them in `SECTION_NAMES_EN` and
 * `SECTION_NAMES_HE`, which changes what an owner sees in their downloaded
 * data and its README in two languages. That is a product change, not a merge
 * resolution.
 *
 * Purge is unaffected: both stay `level: 'reset'`, so deleting an account
 * still clears them. Only the export omits them, exactly as it does today on
 * main, where neither table is classified at all.
 */
const SCHEDULING_MEETINGS_EXPORT: TableExportClassification = exclude(
  'the appointments are represented by their bookings in the bookings section',
  'a section of its own is a product decision (DE-4 follow-up)'
);

const ABANDONED_BOOKINGS_EXPORT: TableExportClassification = exclude(
  'enquiries that were never completed into a booking',
  'a section of its own is a product decision (DE-4 follow-up)'
);


/** `scheduling_availability_exceptions` -> `time_off`. */
const SCHEDULING_AVAILABILITY_EXCEPTIONS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'time_off',
  columns: ['id', 'exception_type', 'start_date', 'end_date', 'custom_hours', 'reason', 'created_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

// ── DE-3: profile details (BUSINESS_OS_DATA_EXPORT_DE3_WORKPLAN.md §3) ────────
// The person's account and their business's own details (DX-1a), group
// `account` (AgentPilot is the controller; DE-3 SA-Q2). Every list below is
// SA's "Final column lists" (SA review DE-3, 2026-10-16), reconciled with the
// live schema on 2026-10-16 (workplan §10.1): `columns` ∪ `excludedColumns` is
// exactly the live column set of each table. Order matters: the export
// repository selects `columns.join(', ')`, pinned byte for byte in the route
// characterization test. Changing a list changes what the export holds: a
// privacy decision, and an SA item.

/**
 * The `profiles` columns the export reads (section `user_profile`): the
 * person's own profile and onboarding answers. Listed by name so a column added
 * later is NOT exported until someone decides it should be.
 *
 * `plan` is left out ON PURPOSE (DE-1, SA ruling Q-3): the export carries
 * profile details only, no plan or billing data (user decision DX-1a,
 * requirement §0.3.1). DE-3 settled the three columns DE-1 left open (§0.5):
 * `role` (the persona picked in onboarding; it grants nothing, 20261002) is
 * IN; `org_id` and `hourly_rate_usd` (the agent-platform ROI rate) are OUT.
 * Moved from UserProfileRepository PROFILE_DATA_EXPORT_COLUMNS (DE-2).
 */
const PROFILES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'user_profile',
  columns: [
    'id', 'full_name', 'avatar_url', 'company', 'job_title', 'timezone', 'language', 'created_at', 'updated_at',
    'role', 'domain', 'onboarding', 'onboarding_goal', 'onboarding_mode', 'onboarding_data',
  ],
  excludedColumns: {
    plan: 'DX-1a / DE-1 SA Q-3: no plan or billing data',
    org_id: 'DE-2 BC-2 (user 2026-10-15): the agent-platform organisation record is not exported; its id alone points at nothing in the file',
    hourly_rate_usd: EXPORT_COLUMN_REASON.AGENT_SETTING,
  },
};

/**
 * `user_preferences` -> section `preferences`: the person's clock, language,
 * currency and display / privacy choices. `timezone` here is the clock
 * authority (`profiles.timezone` is a mirror); both are exported as held.
 * The agent-platform AI tuning and developer flags are out (user BC-A,
 * 2026-10-16; SA R-3). No jsonb column, no secret (workplan §10.1).
 */
const USER_PREFERENCES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'preferences',
  columns: [
    'id', 'preferred_language', 'timezone', 'timezone_confirmed_at', 'preferred_currency', 'theme', 'sidebar_collapsed',
    'compact_mode', 'show_timestamps', 'enable_sounds', 'keyboard_shortcuts', 'data_retention_days', 'analytics_enabled',
    'telemetry_enabled', 'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    default_model: EXPORT_COLUMN_REASON.AGENT_SETTING,
    max_tokens: EXPORT_COLUMN_REASON.AGENT_SETTING,
    temperature: EXPORT_COLUMN_REASON.AGENT_SETTING,
    auto_save_conversations: EXPORT_COLUMN_REASON.AGENT_SETTING,
    debug_mode: EXPORT_COLUMN_REASON.AGENT_SETTING,
    beta_features: EXPORT_COLUMN_REASON.AGENT_SETTING,
  },
};

/**
 * `notification_settings` -> section `notification_settings`: how we may
 * contact the person. `quiet_hours_timezone` is the zone of the quiet hours
 * only (SA-Q8). The three `*_agent_updates` toggles are about agent runs only:
 * out (user BC-A, 2026-10-16; SA R-3). No jsonb, no token or push-subscription
 * column (workplan §10.1).
 */
const NOTIFICATION_SETTINGS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'notification_settings',
  columns: [
    'id', 'email_enabled', 'email_frequency', 'email_system_alerts', 'email_security_alerts', 'email_marketing',
    'push_enabled', 'push_system_alerts', 'push_mentions', 'desktop_enabled', 'desktop_system_alerts', 'inapp_enabled',
    'inapp_sounds', 'inapp_popups', 'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end', 'quiet_hours_timezone',
    'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    email_agent_updates: EXPORT_COLUMN_REASON.AGENT_SETTING,
    push_agent_updates: EXPORT_COLUMN_REASON.AGENT_SETTING,
    desktop_agent_updates: EXPORT_COLUMN_REASON.AGENT_SETTING,
  },
};

/**
 * `business_profiles` -> section `business_profile`: what the owner told us
 * about their business, its contact details, public address, working hours,
 * invoice profile and the automations they chose. The jsonb columns travel
 * whole: the 2026-10-16 key census (workplan §10.1 Q4) shows owner-chosen
 * content only (SA-Q5). `address_id` / `invoice_address_id` are bare ids: the
 * addresses are read by their own `user_id` in `business_addresses`, never by
 * following these pointers (tenant-isolation-guard; DE-3 SA).
 *
 * Out: the assistant's output and the onboarding chat (user BC-C), the
 * connected apps (BC-F), calendar sync (BC-E), setup progress (BC-D) and the
 * invoice bank details (BC-B). `invoice_payment_instructions` goes with the
 * bank details (SA R-2); `invoice_tax_id` stays (SA R-1).
 */
const BUSINESS_PROFILES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'business_profile',
  columns: [
    'id',
    'vertical', 'sub_vertical', 'company_name', 'company_size', 'clients_per_week', 'revenue_tier', 'description', 'services',
    'pain_points', 'goals', 'tools', 'payment_mode', 'online_presence_mode', 'primary_crm', 'primary_calendar', 'primary_payment',
    'phone', 'email', 'address', 'address_parts', 'address_id', 'invoice_address_id',
    'website_url', 'landing_pages', 'logo_url', 'show_logo_on_smart_links', 'theme', 'template_id', 'subdomain', 'user_code',
    'scheduling_availability', 'process_steps', 'language', 'currency',
    'invoice_company_name', 'invoice_address', 'invoice_tax_id', 'invoice_footer_text', 'invoice_number_prefix',
    'invoice_document_type', 'invoice_prices_include_tax', 'invoice_tax_rate', 'invoice_tax_label', 'invoice_payment_terms_days',
    'collection_method', 'default_payment_processor', 'payment_retry_enabled', 'payment_retry_intervals', 'payment_max_retries',
    'payment_reminder_enabled', 'payment_reminder_days_before', 'payment_overdue_reminder_days', 'payment_reminder_channels',
    'daily_briefing_email_enabled', 'lead_alert_email_enabled', 'lead_autosend_enabled', 'chase_invoices_enabled',
    'chase_intake_enabled', 'chase_quotes_enabled', 'automations_declined', 'meeting_reminder_enabled',
    'meeting_reminder_hours_before', 'meeting_reminder_notify_client', 'meeting_reminder_notify_owner',
    'auto_complete_meetings_enabled',
    'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    website_analysis: `${EXPORT_COLUMN_REASON.ASSISTANT_OUTPUT}: scraped website data and the assistant's analysis of it`,
    extracted_data: `${EXPORT_COLUMN_REASON.ASSISTANT_OUTPUT}: what the assistant extracted from the onboarding bio`,
    onboarding_conversation: `${EXPORT_REASON.ACTIVITY}: the onboarding chat`,
    connected_plugins: EXPORT_COLUMN_REASON.CONNECTED_APPS,
    calendar_sync_enabled: EXPORT_COLUMN_REASON.CALENDAR_SYNC,
    calendar_sync_provider: EXPORT_COLUMN_REASON.CALENDAR_SYNC,
    calendar_last_synced_at: EXPORT_COLUMN_REASON.CALENDAR_SYNC,
    onboarding_completed: EXPORT_COLUMN_REASON.SETUP_STATE,
    profile_completeness: EXPORT_COLUMN_REASON.SETUP_STATE,
    setup_checklist_dismissed: EXPORT_COLUMN_REASON.SETUP_STATE,
    dismissed_setup_steps: EXPORT_COLUMN_REASON.SETUP_STATE,
    needs_stripe_connect: `${EXPORT_COLUMN_REASON.SETUP_STATE}: derived from the onboarding answers`,
    invoice_bank_name: EXPORT_COLUMN_REASON.BANK_DETAILS,
    invoice_bank_account: EXPORT_COLUMN_REASON.BANK_DETAILS,
    invoice_bank_routing: EXPORT_COLUMN_REASON.BANK_DETAILS,
    invoice_payment_instructions:
      `${EXPORT_COLUMN_REASON.BANK_DETAILS} (free-text payment instructions; the product treats them as the same thing as bank details: SA DE-3)`,
  },
};

/** `business_addresses` -> `business_addresses`: the saved address book. Not soft-deleted, so no rowFilter. */
const BUSINESS_ADDRESSES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'business_addresses',
  columns: ['id', 'label', 'parts', 'is_default', 'created_at', 'updated_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

// ── DE-5: client money (BUSINESS_OS_DATA_EXPORT_DE5_WORKPLAN.md §3) ───────────
// What the business's clients were quoted, invoiced, charged and refunded, the
// payment plans they are on and their instalments (group `client_records`,
// AgentPilot the processor), and which Stripe account and payment provider the
// business takes money through (group `account`, AgentPilot the controller;
// DE-5 SA-Q1). Money paid to US (plans, credits, boosts) is not in these
// tables and never in the file (DX-1a). Every list was reconciled with the
// live schema on 2026-10-16 (workplan §11.1): `columns` ∪ `excludedColumns` is
// exactly the live column set of each table. Order matters: the export
// repository selects `columns.join(', ')`, pinned byte for byte in the route
// characterization test.
//
// Currency (CLAUDE.md § Currency & Timezone): every amount is exported as
// stored, next to the currency column it is denominated in; nothing is
// converted, summed or defaulted. `processor_fee` / `net_amount` are in
// `fee_currency`, which is not always the payment's. `payment_refunds.
// fee_returned` / `refund_fee` have NO currency column and are exported with
// none (SA-Q6). No total of any kind (user BC-11). The pairing is pinned in
// exportClassification.test.ts (SA C-4).
//
// All history is in: failed, cancelled, refunded, draft, superseded rows, each
// with its status (user BC-2). None of these tables soft-deletes, so no
// rowFilter. Changing a list changes what the export holds: a privacy
// decision, and an SA item.

/** Why a DE-5 COLUMN stays out. Repeated reasons are named, not retyped. */
const MONEY_COLUMN_REASON = {
  PROCESSOR_METADATA:
    'processor plumbing (Stripe object ids already in their own columns, routing bits); no key the owner entered on live rows (DE-5 SA-Q3)',
  RECONCILIATION_STATE:
    'which Stripe account our refund path must target; internal routing state (DE-5 SA-Q7)',
  RETRY_STATE: "the collection run's retry counters: product machinery, not the owner's data (DE-5 SA-Q12)",
  CARD_EXPIRY: 'user 2026-10-16 (DE-5 BC-1): card brand and last 4 digits only; the expiry stays out',
  ACTOR_ID:
    'the id that started the refund inside our system, which can be an AgentPilot operator; `source` says how it was started (DE-5 SA-Q15)',
  IDEMPOTENCY: "our internal dedupe key for the refund request, not the owner's data (and a secret deny-list name)",
  PROVIDER_CAPABILITY: "what the payment provider can do: a product fact, not the owner's data",
} as const;

/**
 * `payment_transactions` -> section `payments`: every payment a client made
 * or attempted (failed and pending in, with their status). `processor_fee`
 * and `net_amount` are in `fee_currency` (NULL fee and NULL fee_currency mean
 * "fee not recorded", not zero). `metadata` is READ but never written raw: the
 * section keeps only `notes` (what the owner typed when recording a cash or
 * bank payment) and `source` (how the payment was recorded), as strings
 * (PAYMENT_METADATA_KEYS in data-export/sections.ts, DE-5 SA-Q3, user BC-7).
 * `charge_account_kind` is out with `account_resolution` (SA-Q7): on live
 * rows `platform` only ever marks a manual payment the owner recorded, and in
 * a client-money file it would read as money paid to AgentPilot.
 */
const PAYMENT_TRANSACTIONS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'payments',
  columns: [
    'id', 'contact_id', 'invoice_id', 'booking_id', 'service_id', 'amount', 'currency', 'status', 'payment_method',
    'description', 'metadata', 'failure_reason', 'paid_at', 'refund_status', 'refunded_amount', 'refunded_at',
    'refund_reason', 'processor_type', 'processor_refund_id', 'processor_fee', 'net_amount', 'fee_currency',
    'stripe_payment_intent_id', 'stripe_charge_id', 'stripe_customer_id', 'stripe_connect_account_id', 'created_at',
    'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    account_resolution: MONEY_COLUMN_REASON.RECONCILIATION_STATE,
    charge_account_kind: MONEY_COLUMN_REASON.RECONCILIATION_STATE,
  },
};

/**
 * `payment_refunds` -> `refunds`: the append-only refund ledger, one dated row
 * per refund, amounts POSITIVE as stored (money returned to the client; SA-Q4).
 * `amount_minor` is the figure Stripe was told, in the refund's own
 * `currency`. `fee_returned` / `refund_fee` carry no currency (SA-Q6).
 */
const PAYMENT_REFUNDS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'refunds',
  columns: [
    'id', 'transaction_id', 'invoice_id', 'amount', 'amount_minor', 'currency', 'status', 'reason', 'reason_note',
    'processor_type', 'processor_refund_id', 'stripe_connect_account_id', 'source', 'failure_code', 'failure_message',
    'fee_returned', 'refund_fee', 'created_at', 'updated_at', 'succeeded_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    idempotency_key: MONEY_COLUMN_REASON.IDEMPOTENCY,
    initiated_by: MONEY_COLUMN_REASON.ACTOR_ID,
    metadata: MONEY_COLUMN_REASON.PROCESSOR_METADATA,
  },
};

/**
 * `payment_invoices` -> `invoices`: drafts, cancelled and refunded invoices
 * in. The owner's private `internal_notes` are in (user BC-7). The Stripe
 * invoice web and PDF links (`stripe_hosted_invoice_url`,
 * `stripe_invoice_pdf`) are IN by the user's decision (BC-3, 2026-10-16, which
 * overrides the workplan default and SA-Q5): anyone holding the file can open
 * those invoice pages.
 */
const PAYMENT_INVOICES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'invoices',
  columns: [
    'id', 'contact_id', 'booking_id', 'service_id', 'invoice_number', 'amount', 'currency', 'status', 'line_items',
    'due_date', 'payment_terms', 'notes', 'internal_notes', 'sent_at', 'paid_at', 'payment_method', 'payment_received_at',
    'payment_notes', 'processor_type', 'processor_checkout_id', 'processor_payment_id', 'processor_customer_id',
    'processor_payment_method_id', 'stripe_invoice_id', 'stripe_hosted_invoice_url', 'stripe_invoice_pdf', 'client_name',
    'client_email', 'client_address', 'refunded_amount', 'refund_status', 'refunded_at', 'allow_online_payment',
    'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    retry_count: MONEY_COLUMN_REASON.RETRY_STATE,
    last_retry_at: MONEY_COLUMN_REASON.RETRY_STATE,
    next_retry_at: MONEY_COLUMN_REASON.RETRY_STATE,
  },
};

/**
 * `proposals` -> `quotes` (the product calls them quotes). Every status in.
 * `decline_note` is the client's own words to the business; `accepted_snapshot`
 * is the record of what the client agreed to, whole (live key census: the
 * quote's own terms only, workplan §11.1 Q4).
 */
const PROPOSALS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'quotes',
  columns: [
    'id', 'contact_id', 'service_id', 'booking_id', 'package_booking_id', 'document_id', 'supersedes_id',
    'created_invoice_id', 'created_plan_id', 'title', 'description', 'currency', 'total', 'prices_include_tax', 'tax_rate',
    'tax_label', 'payment_shape', 'payment_terms_days', 'sessions', 'status', 'valid_until', 'decline_reason',
    'decline_note', 'stop_reason', 'stop_note', 'accepted_snapshot', 'sent_at', 'viewed_at', 'decided_at', 'stopped_at',
    'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/** `payment_plans` -> `payment_plans`: the owner's plan templates, inactive ones in. */
const PAYMENT_PLANS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'payment_plans',
  columns: [
    'id', 'service_id', 'name', 'description', 'total_amount', 'currency', 'supported_currencies', 'installment_count',
    'installment_amount', 'installment_frequency', 'allowed_processors', 'preferred_processor', 'is_active', 'created_at',
    'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/**
 * `payment_plan_subscriptions` -> `client_payment_plans`: the plans clients
 * are on, past-due, cancelled and completed ones in. Card brand and last 4
 * in; expiry out (user BC-1).
 */
const PAYMENT_PLAN_SUBSCRIPTIONS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'client_payment_plans',
  columns: [
    'id', 'contact_id', 'booking_id', 'service_id', 'payment_plan_id', 'stripe_subscription_id', 'stripe_schedule_id',
    'stripe_price_id', 'stripe_customer_id', 'stripe_connect_account_id', 'installment_count', 'installment_amount',
    'currency', 'frequency', 'periods_paid', 'status', 'next_charge_at', 'next_charge_amount', 'last_failure_code',
    'last_failure_at', 'card_brand', 'card_last4', 'cancel_reason', 'cancel_note', 'cancelled_by', 'created_at',
    'updated_at', 'completed_at', 'cancelled_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    card_exp_month: MONEY_COLUMN_REASON.CARD_EXPIRY,
    card_exp_year: MONEY_COLUMN_REASON.CARD_EXPIRY,
    metadata: MONEY_COLUMN_REASON.PROCESSOR_METADATA,
  },
};

/** `payment_plan_installments` -> `installments`: every instalment, cancelled ones in. */
const PAYMENT_PLAN_INSTALLMENTS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'installments',
  columns: [
    'id', 'payment_plan_id', 'subscription_id', 'booking_id', 'contact_id', 'proposal_id', 'invoice_id', 'transaction_id',
    'installment_number', 'label', 'trigger', 'amount', 'currency', 'due_date', 'status', 'paid_at', 'payment_method',
    'processor_type', 'stripe_invoice_id', 'completed_at', 'cancel_reason', 'cancel_note', 'cancelled_by', 'cancelled_at',
    'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    retry_count: MONEY_COLUMN_REASON.RETRY_STATE,
    last_retry_at: MONEY_COLUMN_REASON.RETRY_STATE,
    next_retry_at: MONEY_COLUMN_REASON.RETRY_STATE,
  },
};

/**
 * `saved_payment_methods` -> `client_payment_methods`. `processor_method_id`
 * is a Stripe reference, not a credential: charging it needs the business's
 * own secret key (SA-Q5). No card number is ever stored. Expiry out (BC-1).
 */
const SAVED_PAYMENT_METHODS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'client_payment_methods',
  columns: [
    'id', 'contact_id', 'processor_type', 'processor_customer_id', 'processor_method_id', 'method_type', 'brand',
    'last_four', 'is_default', 'is_valid', 'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    expiry_month: MONEY_COLUMN_REASON.CARD_EXPIRY,
    expiry_year: MONEY_COLUMN_REASON.CARD_EXPIRY,
  },
};

/**
 * `stripe_connect_accounts` -> `payment_account` (group `account`): the
 * business's own Stripe account, one per owner. `currency` is the account's
 * settlement currency, stored lower case and exported as stored; it explains
 * `fee_currency` on payments. `stripe_email` is the owner's own email for the
 * account (SA-Q13).
 */
const STRIPE_CONNECT_ACCOUNTS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'payment_account',
  columns: [
    'id', 'stripe_account_id', 'stripe_account_type', 'charges_enabled', 'payouts_enabled', 'details_submitted',
    'onboarding_completed', 'country', 'currency', 'business_type', 'stripe_email', 'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/**
 * `payment_processors` -> `payment_providers` (group `account`): which
 * provider the business uses and whether it is connected (disconnected rows
 * are a status, in). `credentials` is never selected, not even to drop later
 * (user BC-12: keys never).
 */
const PAYMENT_PROCESSORS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'payment_providers',
  columns: ['id', 'processor_type', 'is_active', 'is_default', 'connection_status', 'last_verified_at', 'created_at', 'updated_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    credentials: EXPORT_REASON.SECRET,
    supports_checkout: MONEY_COLUMN_REASON.PROVIDER_CAPABILITY,
    supports_saved_methods: MONEY_COLUMN_REASON.PROVIDER_CAPABILITY,
    supports_refunds: MONEY_COLUMN_REASON.PROVIDER_CAPABILITY,
    supports_partial_refunds: MONEY_COLUMN_REASON.PROVIDER_CAPABILITY,
  },
};

// ── DE-6: intake, email marketing and consent (BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md §3) ──
// The questions the owner asks clients (every version), the intake on/off
// settings, the email campaigns and sequences the owner wrote, which clients
// are in which sequence, the newsletter sign-up list, the do-not-email list,
// the consent record and the owner's consent settings. Ten sections, group
// `client_records` (AgentPilot the processor; DE-6 SA-Q2). Every list was
// reconciled with the live schema on 2026-10-16 (workplan §11.1, SA review
// DE-6): `columns` ∪ `excludedColumns` is exactly the live column set of each
// table. Order matters: the export repository selects `columns.join(', ')`,
// pinned byte for byte in the route characterization test.
//
// All history is in: draft and archived forms, pending and unsubscribed
// sign-ups, withdrawn and redacted consent records, cancelled enrollments
// (DX-8; TL defaults BC-4, BC-5, BC-8, 2026-10-16). None of these tables
// soft-deletes, so no rowFilter. Every child table (steps, enrollments,
// consent records) is read by its OWN `user_id`, never by following a parent
// id. Out: visitor tracking (BC-1), delivery counters (BC-3), the AI
// provenance of a form (BC-4), and two whole tables (the lead-message queue,
// BC-2; the derived consent projection, BC-6). Changing a list changes what
// the export holds: a privacy decision, and an SA item.

/** Why a DE-6 COLUMN stays out. Repeated reasons are named, not retyped. */
const MARKETING_COLUMN_REASON = {
  DELIVERY_STATS:
    'DX-1d: how many emails went out, were opened or were clicked is activity (TL default BC-3, 2026-10-16)',
  QUEUE_STATE: 'when the next email is scheduled to go: sending machinery, not a record (DE-6 SA-Q6)',
  GENERATION_METADATA: `${EXPORT_COLUMN_REASON.ASSISTANT_OUTPUT}: how the assistant built the form (model, inputs) (TL default BC-4, 2026-10-16)`,
  VISITOR_EVIDENCE:
    'a scrambled internet address with the key to check it, the browser signature and the visit id: visitor tracking, not exported (TL default BC-1, 2026-10-16; as DE-4 BC-4)',
  DERIVED_COPY: 'a generated lower-case copy of email, which is in (DE-6 SA-Q8)',
  ACTOR_ID:
    'the id that recorded the decision inside our system (the owner on every live row); `method` says how it was recorded (DE-6 SA-Q10; as DE-5 SA-Q15)',
} as const;

/** `user_intake_settings` -> `intake_settings`: one row per owner (UNIQUE user_id). */
const USER_INTAKE_SETTINGS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'intake_settings',
  columns: ['id', 'is_enabled', 'send_after_booking', 'created_at', 'updated_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/**
 * `business_intake_forms` -> `intake_forms`: every version and status (draft,
 * published, archived), so an answer in `bookings.intake_responses` can be
 * read against the form it was given to. `questions` travels whole (SA-Q4).
 */
const BUSINESS_INTAKE_FORMS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'intake_forms',
  columns: ['id', 'version', 'status', 'questions', 'generated_at', 'published_at', 'created_at', 'updated_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    generated_from: MARKETING_COLUMN_REASON.GENERATION_METADATA,
  },
};

/** `email_campaigns` -> `email_campaigns`: the wording, audience, status and dates; no counters. */
const EMAIL_CAMPAIGNS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'email_campaigns',
  columns: [
    'id', 'name', 'subject', 'body_html', 'body_text', 'segment_filter', 'status', 'scheduled_at', 'sent_at', 'created_at',
    'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    recipients_count: MARKETING_COLUMN_REASON.DELIVERY_STATS,
    sent_count: MARKETING_COLUMN_REASON.DELIVERY_STATS,
    opened_count: MARKETING_COLUMN_REASON.DELIVERY_STATS,
    clicked_count: MARKETING_COLUMN_REASON.DELIVERY_STATS,
    failed_count: MARKETING_COLUMN_REASON.DELIVERY_STATS,
  },
};

/** `email_sequences` -> `email_sequences`: `trigger_config` travels whole (SA-Q4, C-5). */
const EMAIL_SEQUENCES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'email_sequences',
  columns: ['id', 'name', 'description', 'trigger_type', 'trigger_config', 'is_active', 'created_at', 'updated_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    total_sent: MARKETING_COLUMN_REASON.DELIVERY_STATS,
    total_opened: MARKETING_COLUMN_REASON.DELIVERY_STATS,
    total_clicked: MARKETING_COLUMN_REASON.DELIVERY_STATS,
  },
};

/** `email_sequence_steps` -> `email_sequence_steps`: read by its own `user_id`, never via `sequence_id`. */
const EMAIL_SEQUENCE_STEPS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'email_sequence_steps',
  columns: ['id', 'sequence_id', 'step_number', 'delay_minutes', 'subject', 'body_html', 'body_text', 'created_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    sent_count: MARKETING_COLUMN_REASON.DELIVERY_STATS,
    opened_count: MARKETING_COLUMN_REASON.DELIVERY_STATS,
    clicked_count: MARKETING_COLUMN_REASON.DELIVERY_STATS,
  },
};

/** `email_sequence_enrollments` -> `email_sequence_enrollments`: which client is in which sequence, every status. */
const EMAIL_SEQUENCE_ENROLLMENTS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'email_sequence_enrollments',
  columns: ['id', 'sequence_id', 'contact_id', 'status', 'current_step_number', 'enrolled_at', 'completed_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    next_send_at: MARKETING_COLUMN_REASON.QUEUE_STATE,
  },
};

/** `email_unsubscribes` -> `email_unsubscribes`: the owner's do-not-email list (derived by trigger from the ledger). */
const EMAIL_UNSUBSCRIBES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'email_unsubscribes',
  columns: ['id', 'contact_id', 'email', 'reason', 'unsubscribed_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/**
 * `marketing_consent_events` -> `consent_records`: every grant and withdrawal,
 * with the exact wording agreed to, its locale and version, the method, the
 * form and page, and when. Redacted rows go out as held (BC-8). `evidence` is
 * READ but never written raw: only `client_statement`, `confirmed_via` and
 * `note`, as strings (CONSENT_EVIDENCE_KEYS in data-export/sections.ts,
 * SA-Q4). `source_page_url` loses its query string and fragment in the
 * section mapper (SA-Q7: 2 of 16 live URLs carried token-like parameters).
 * `privacy_policy_url` is kept as held (0 with a query string, §11.2).
 */
const MARKETING_CONSENT_EVENTS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'consent_records',
  columns: [
    'id', 'contact_id', 'email', 'channel', 'purpose', 'decision', 'method', 'statement_text', 'statement_locale',
    'statement_version', 'privacy_policy_url', 'source_surface', 'source_page_url', 'evidence', 'redacted_at',
    'occurred_at', 'created_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    email_normalized: MARKETING_COLUMN_REASON.DERIVED_COPY,
    ip_hash: MARKETING_COLUMN_REASON.VISITOR_EVIDENCE,
    ip_hash_salt: MARKETING_COLUMN_REASON.VISITOR_EVIDENCE,
    user_agent: MARKETING_COLUMN_REASON.VISITOR_EVIDENCE,
    session_id: MARKETING_COLUMN_REASON.VISITOR_EVIDENCE,
    recorded_by: MARKETING_COLUMN_REASON.ACTOR_ID,
  },
};

/**
 * `marketing_consent_settings` -> `consent_settings`: the owner's consent
 * wording per language, privacy notice, postal address and advertisement
 * label (BC-7). The table has NO `id`: its primary key is `user_id`, so it is
 * read as one row (`rowKey: 'user_id'`, DE-6 SA-Q1), not keyset paged. The
 * only descriptor with a `rowKey`; a second one is an SA item.
 */
const MARKETING_CONSENT_SETTINGS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'consent_settings',
  rowKey: 'user_id',
  columns: [
    'capture_enabled', 'statement_en', 'statement_es', 'statement_he', 'statement_version', 'privacy_policy_mode',
    'privacy_policy_url', 'privacy_policy_body', 'privacy_policy_updated_at', 'postal_address', 'label_as_advertisement',
    'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: `${EXPORT_COLUMN_REASON.OWNER_ID}; it is also the row key (one row per owner)`,
  },
};

/**
 * `business_subscribers` -> `newsletter_subscribers`: every sign-up, pending
 * and unsubscribed included, with its status (BC-5). `attribution` is built
 * by the same code as `crm_contacts.source_metadata`, so it goes through the
 * same SOURCE_METADATA_KEYS allow-list, with the page URLs cut at the query
 * string (SA-Q7 C-2).
 */
const BUSINESS_SUBSCRIBERS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'newsletter_subscribers',
  columns: [
    'id', 'email', 'name', 'status', 'source', 'attribution', 'subscribed_at', 'confirmed_at', 'promoted_contact_id',
    'promoted_at', 'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    email_normalized: MARKETING_COLUMN_REASON.DERIVED_COPY,
  },
};

// ── DE-7: website and content (BUSINESS_OS_DATA_EXPORT_DE7_WORKPLAN.md §3) ────
// The business's website text, every website and landing page (draft, live
// and archived), the blocks on those pages (hidden ones included), every
// smart link (on or off) and the picture library. Five sections, group
// `content` (AgentPilot the processor; the account holder the controller;
// DE-7 SA-Q3). Every list was reconciled with the live schema on 2026-10-17
// (workplan §11.1, SA review DE-7): `columns` ∪ `excludedColumns` is exactly
// the live column set of each table. Order matters: the export repository
// selects `columns.join(', ')`, pinned byte for byte in the route
// characterization test.
//
// All history is in (DX-8; TL defaults BC-2, BC-3, BC-7, 2026-10-17): none of
// these tables soft-deletes, so no rowFilter. These are the RECORDS; the
// picture files arrive in DE-8b's "Your files". Out: the smart-link counters
// and attributed revenue (BC-1), the picture reuse key and our storage key.
// `website_blocks` has no `user_id`: it is read through its owner's pages
// (`viaParent`, DE-7 SA-Q1, the one parent-scoped read). Changing a list
// changes what the export holds: a privacy decision, and an SA item.

/** Why a DE-7 COLUMN stays out. Repeated reasons are named, not retyped. */
const CONTENT_COLUMN_REASON = {
  VISIT_STATS: 'DX-1d: how many visits and sign-ups a link brought is activity (TL default BC-1, 2026-10-17)',
  ATTRIBUTED_REVENUE:
    'a running total derived from payments already in the file, with no currency of its own (DX-1d; CLAUDE.md § Currency; TL default BC-1, 2026-10-17)',
  REUSE_KEY:
    'our lookup key that stops the same picture being fetched or paid for twice (a stock library id, or a hash of a picture request); `source` says where the picture came from (DE-7 SA-Q6)',
} as const;

/**
 * `website_content` -> `website_content`: the website text per section, one
 * row per owner (UNIQUE user_id), the owner's edits merged over the block
 * content. The 19 jsonb sections go out whole (Q6 census clean, SA-Q7).
 * `payment_button` carries its own `currency` key: out exactly as held.
 */
const WEBSITE_CONTENT_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'website_content',
  columns: [
    'id', 'hero', 'about', 'services', 'testimonials', 'faq', 'team', 'contact', 'process', 'features', 'stats',
    'pricing', 'gallery', 'cta', 'newsletter', 'logo_cloud', 'video', 'booking_widget', 'payment_button', 'intake_form',
    'created_at', 'updated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/**
 * `website_pages` -> `website_pages`: every website and landing page, every
 * status (BC-3), with its public addresses (BC-6, as DE-3 SA-Q3) and
 * `content_generated_at` (a timestamp only; BC-4, SA-Q12). `template_id` is a
 * bare id; the platform template is never read. Also the PARENT of
 * `website_blocks`: its `id` is the ownership oracle of the parent-scoped read.
 */
const WEBSITE_PAGES_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'website_pages',
  columns: [
    'id', 'page_type', 'slug', 'title', 'meta_description', 'seo_keywords', 'published', 'published_at', 'template_id',
    'theme', 'created_at', 'updated_at', 'subdomain', 'custom_domain', 'custom_domain_verified', 'status',
    'last_published_at', 'favicon_url', 'og_image_url', 'client_flow', 'website_language', 'content_generated_at',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
  },
};

/**
 * `website_blocks` -> `website_blocks`: the content of every block on the
 * owner's pages, hidden blocks included with `enabled` (BC-7). No `user_id`:
 * ownership is `page_id -> website_pages.user_id`, so the reader takes the
 * owner's page ids first and the blocks by `.in('page_id', ids)`, and checks
 * every block against those ids (DE-7 SA-Q1, C-1…C-6). `viaParent` restates
 * the purge scope on purpose (two-key opt-in, SA-Q2). Nothing to exclude.
 */
const WEBSITE_BLOCKS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'website_blocks',
  viaParent: { parent: 'website_pages', fk: 'page_id' },
  columns: ['id', 'page_id', 'block_type', 'position', 'content', 'styles', 'created_at', 'enabled', 'capability_config'],
};

/**
 * `smart_links` -> `smart_links`: every link, on or off, system-created ones
 * included (BC-2). `code` is the link's public short code (BC-6, SA-Q11); the
 * UTM tags are the owner's settings. The counters and the attributed revenue
 * are out (BC-1).
 */
const SMART_LINKS_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'smart_links',
  columns: [
    'id', 'code', 'name', 'destination_url', 'destination_type', 'source', 'medium', 'campaign', 'content', 'is_active',
    'created_at', 'updated_at', 'metadata',
  ],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    click_count: CONTENT_COLUMN_REASON.VISIT_STATS,
    conversion_count: CONTENT_COLUMN_REASON.VISIT_STATS,
    revenue_cents: CONTENT_COLUMN_REASON.ATTRIBUTED_REVENUE,
  },
};

/**
 * `user_media` -> `images`: the picture library records, every source
 * (stock, generated, upload; BC-5), each with its public address and its
 * description (for a generated picture, the request the owner typed; SA-Q12).
 * `storage_path` is out with the same reason as `contact_documents` (SA-Q5);
 * the file itself arrives in DE-8b.
 */
const USER_MEDIA_EXPORT: TableExportClassification = {
  kind: 'include',
  section: 'images',
  columns: ['id', 'public_url', 'source', 'section', 'aspect', 'description', 'width', 'height', 'created_at'],
  excludedColumns: {
    user_id: EXPORT_COLUMN_REASON.OWNER_ID,
    storage_path: EXPORT_COLUMN_REASON.DOCUMENT_STORAGE,
    source_ref: CONTENT_COLUMN_REASON.REUSE_KEY,
  },
};

/**
 * Ordering bands. Lower runs first.
 *
 * Bands exist so a new table can be added without renumbering anything: pick
 * the band, and the invariant test tells you if you were wrong.
 */
const ORDER = {
  /**
   * Purge slice 3a (M-4). CASCADE children of a BLOCKING_CHILD table. Ordered
   * ahead of it so each reports the rows its own delete removed, rather than 0
   * because the parent's cascade got there first. Within the band the child
   * sits below its parent (`payment_reminders` < `payment_plan_installments`).
   */
  PRE_BLOCKING: 50,
  /** Children that BLOCK a later delete. Must precede their parent. */
  BLOCKING_CHILD: 100,
  /** Ordinary leaf/child rows. */
  LEAF: 300,
  /** Domain roots reached by the blocking children above. */
  ROOT: 500,
  /** Config/identity kept by Reset, removed by Purge. */
  CONFIG: 700,
  /**
   * `crm_activities` only. Deleted LAST inside the RPC (FR-17, AC-22), with
   * the single exception of `business_profiles` (TENANCY_ROOT, below), which
   * a Purge deletes after it.
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
  /**
   * `business_profiles` ONLY (purge slice 3a, §0.10 F-SA-3). 56 tables carry a
   * CASCADE FK `(user_id) -> business_profiles(user_id)` (measured 2026-10-05),
   * so deleting it before any of them makes every later count 0 — measured on
   * the 7 CONFIG siblings and `crm_activities`. It goes after everything,
   * including `crm_activities`: every T5 trigger source (`payment_refunds`) is
   * already gone by then, and `crm_activities` is itself one of its cascade
   * children, so the cascade clears any residue (workplan R-8).
   */
  TENANCY_ROOT: 9900,
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
 * SET NULL / SET DEFAULT edges whose child column is NOT NULL, both ends in a
 * run. Deleting the parent first tries to null the column and fails with
 * 23502 (not_null_violation), rolling back the whole run, so they block
 * exactly like BLOCKING_EDGES and the invariant test asserts the same
 * `order[child] < order[parent]` for each.
 *
 * Measured on prod 2026-10-08 (purge_schema_introspect: on_delete per
 * constraint, `columns[].is_nullable` per column): of the 73 SET NULL / SET
 * DEFAULT FKs in `public`, exactly two land on a NOT NULL column. This one,
 * and `shared_agent_imports.imported_by_user_id -> auth.users`, whose parent is
 * the login rather than a run table (the cleanup's G-10 already refuses any
 * row of it naming the target). There is no SET DEFAULT FK at all.
 *
 * The live check does not rely on this list: `deleteGraph.ts` (and G-19 in the
 * test-account cleanup) detect the class from the schema, so a new one is
 * refused before it fails. This list makes the ORDER verified, not detected.
 */
export const NOT_NULL_OVERWRITE_EDGES: ReadonlyArray<{
  child: string;
  column: string;
  parent: string;
  onDelete: 'SET NULL' | 'SET DEFAULT';
  id: string;
}> = [
  { child: 'scheduling_bookings', column: 'contact_id', parent: 'crm_contacts', onDelete: 'SET NULL', id: 'N1' },
];

// ── B4 retired — review note (purge slice 3a, 2026-10-05, §0.10 F-SA-4) ─────
// B4 was an ordering assertion, `payment_plan_subscriptions` before
// `crm_contacts`, because `delete_future_bookings_on_contact_delete_trigger`
// (BEFORE DELETE on crm_contacts) deleted future bookings and so tripped B2
// from a direction B2 alone does not name. Migration
// `20260928_contact_delete_handled_in_app.sql` DROPPED that trigger, and the
// live measurement of 2026-10-05 (workplan §1.3 M-2, re-run at T3a-0) confirms
// crm_contacts has no DELETE trigger. The `TRIGGER_ORDERING` export that
// encoded it is deleted. `payment_plan_subscriptions` stays in BLOCKING_CHILD
// for B2 alone.
//
// The lesson is kept instead of the edge: a hand-encoded trigger assertion
// goes stale silently in BOTH directions (this one outlived its trigger; a new
// trigger would never have been added). So triggers are now DETECTED, not
// encoded: `deleteGraph.ts` refuses a run when a DELETE-capable trigger sits
// on a run table or a CASCADE child and is not in the reviewed list below.

/**
 * DELETE-capable triggers a reviewer has looked at, keyed by (table, trigger).
 *
 * Populated from the live delete-graph run of 2026-10-05T12:47Z (SA C-3):
 * across all 16 level x option combinations this is the ONLY DELETE-capable
 * trigger on a run table or on a CASCADE child of one. The other three
 * DELETE-capable triggers in `public` are reached by no run: `trg_mce_guard`
 * (marketing_consent_events — `never`, and a SET NULL child of crm_contacts,
 * so never deleted) and the `storage_usage` pair
 * (`trigger_update_storage_on_delete`, `trigger_update_storage_used` —
 * `never`, and not a CASCADE child of any run table). If a future FK makes
 * any of them reachable, the check refuses and names it.
 */
export const REVIEWED_DELETE_TRIGGERS: ReadonlyArray<{ table: string; trigger: string; note: string }> = [
  {
    table: 'payment_refunds',
    trigger: 'recompute_transaction_refund_state_trigger',
    note: 'T2. AFTER INSERT OR DELETE OR UPDATE. Deleting a refund recomputes payment_transactions.status, whose log trigger INSERTs into crm_activities — the single live T5 residue path. Mitigated by ordering: crm_activities is LAST (FR-17, AC-22). Reviewed 2026-10-05, purge slice 3a.',
  },
];

/**
 * CASCADE children allowed to sit AFTER a cascade parent in a run, so their
 * statement count can under-report (OQ-4: snapshot counts are the truth).
 *
 * `crm_activities` only: it must be deleted after `payment_refunds` (T5), and
 * it is a CASCADE child of `crm_contacts`, which cannot move after it without
 * breaking the bands. Any other cascade-after-parent edge is a banding defect,
 * and the invariant test fails on it.
 */
export const CASCADE_COUNT_EXEMPT: readonly string[] = ['crm_activities'];

// ────────────────────────────────────────────────────────────────────────────
// IN SCOPE — the 64 tables of requirement §3
// ────────────────────────────────────────────────────────────────────────────

const IN_SCOPE: PurgeDescriptor[] = [
  // ── §3.1 Business profile ────────────────────────────────────────────────
  { table: 'business_profiles', level: 'purge', area: 'business_profile', scope: { kind: 'user_id' }, order: ORDER.TENANCY_ROOT, snapshot: 'rows', export: BUSINESS_PROFILES_EXPORT,
    notes: '1:1 with auth.users — THIS is the "business" row. Kept by Reset so tests re-run without onboarding. No DELETE RLS policy. Alone in the final band (TENANCY_ROOT): 56 tables CASCADE from it (measured 2026-10-05; 57 with business_addresses, 20261037), so it goes last or their counts read 0 (F-SA-3).' },
  // Added 2026-10-06 (20261036_business_addresses_book.sql + 20261037_…_ownership_fk.sql):
  // the address book behind business_profiles.address_parts / invoice_address.
  { table: 'business_addresses', level: 'purge', area: 'business_profile', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: BUSINESS_ADDRESSES_EXPORT,
    notes: 'The business\'s saved addresses. Same level as business_profiles, which Reset keeps: its address_id / invoice_address_id point here and its address_parts / invoice_address are copies of these rows, so a Reset that emptied the book would leave the profile showing an address the picker no longer offers. CASCADE child of business_profiles (business_addresses_business_fk), so CONFIG keeps it ahead of TENANCY_ROOT for an accurate count. Its only inbound FKs are those two business_profiles columns, ON DELETE SET NULL — no blocking edge.' },

  // ── §3.2 CRM ─────────────────────────────────────────────────────────────
  { table: 'crm_contacts', level: 'reset', area: 'crm', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: CRM_CONTACTS_EXPORT,
    notes: 'CRM hub. CASCADE parent of proposals and crm_activities. Has no DELETE trigger since 20260928_contact_delete_handled_in_app.sql dropped T1 (B4 retired, slice 3a).' },
  { table: 'crm_activities', level: 'reset', area: 'crm', scope: { kind: 'user_id' }, order: ORDER.LAST, snapshot: 'rows', export: CRM_ACTIVITIES_EXPORT,
    notes: 'DELETED LAST. The single live T5 residue path writes here mid-purge; ordering is the only available mitigation.' },
  { table: 'crm_pipeline_stages', level: 'purge', area: 'crm', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: CRM_PIPELINE_STAGES_EXPORT,
    notes: 'Seeded by /api/onboarding/build; Reset keeps them so the board still works.' },
  { table: 'crm_tasks', level: 'reset', area: 'crm', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: CRM_TASKS_EXPORT },
  { table: 'contact_documents', level: 'reset', area: 'crm', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: CONTACT_DOCUMENTS_EXPORT,
    notes: 'Rows index objects in the contact-documents bucket. NOTE: ContactDocumentsRepository soft-deletes, which is why the snapshot must NOT read through it (B-4).' },

  // ── §3.3 Website ─────────────────────────────────────────────────────────
  { table: 'website_pages', level: 'reset', area: 'website', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: WEBSITE_PAGES_EXPORT },
  { table: 'website_blocks', level: 'reset', area: 'website', scope: { kind: 'via', parent: 'website_pages', fk: 'page_id' }, order: ORDER.LEAF, snapshot: 'ids', export: WEBSITE_BLOCKS_EXPORT,
    notes: 'No user_id column. Child ids captured pre-delete so AC-5 has an oracle (C-13).' },
  { table: 'website_content', level: 'reset', area: 'website', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: WEBSITE_CONTENT_EXPORT,
    notes: '1:1. No DELETE RLS policy.' },
  { table: 'website_page_views', level: 'reset', area: 'website', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'ids', export: exclude(EXPORT_REASON.VISITOR),
    notes: 'IDS ONLY (DEV-Q6). Unbounded, publicly writable (WITH CHECK true), append-only, forensically worthless row-by-row. A row ceiling here would make a busy business undeletable.' },

  // ── §3.4 Scheduling ──────────────────────────────────────────────────────
  { table: 'scheduling_services', level: 'reset', area: 'scheduling', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: SCHEDULING_SERVICES_EXPORT },
  { table: 'scheduling_bookings', level: 'reset', area: 'scheduling', scope: { kind: 'user_id' }, order: ORDER.ROOT - 2, snapshot: 'rows', export: SCHEDULING_BOOKINGS_EXPORT,
    notes: 'Blocked by B2 (payment_plan_subscriptions RESTRICT). No longer reached by a crm_contacts trigger: T1 was dropped (B4 retired, slice 3a). ROOT - 2 (2026-10-08): N1 — contact_id is NOT NULL with ON DELETE SET NULL to crm_contacts, so deleting a contact first fails with 23502; it must run before crm_contacts (ROOT). Still after payment_plan_subscriptions (B2) and before scheduling_services, its CASCADE parent.' },
  { table: 'abandoned_bookings', level: 'reset', area: 'scheduling', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: ABANDONED_BOOKINGS_EXPORT,
    notes: 'Somebody who gave their details on a booking page and did not finish. LEAF: its two references — service_id and booking_id — are both ON DELETE SET NULL, so it blocks nothing and can go at any point. Reset rather than purge: the prospects belong to the business, like the bookings they nearly became.' },
  { table: 'scheduling_meetings', level: 'reset', area: 'scheduling', scope: { kind: 'user_id' }, order: ORDER.PRE_BLOCKING, snapshot: 'rows', export: SCHEDULING_MEETINGS_EXPORT,
    notes: 'The appointments themselves (20261073). Scoped by user_id rather than via the booking, because it carries its own — CLAUDE.md rule 4 wants the tenant filter reachable without a join. PRE_BLOCKING, not LEAF: booking_id is ON DELETE CASCADE, so scheduling_bookings would take these rows with it and this descriptor would report 0 deleted for a table that was in fact emptied. Running first makes the count honest. Nothing references it except payment_plan_installments.meeting_id, which is ON DELETE SET NULL and so blocks nothing.' },
  { table: 'scheduling_availability_exceptions', level: 'reset', area: 'scheduling', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: SCHEDULING_AVAILABILITY_EXCEPTIONS_EXPORT },
  { table: 'external_calendar_events', level: 'reset', area: 'scheduling', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude("user 2026-10-15: synced copy of the owner's own external calendar, not Business OS data"),
    notes: 'calendar-sync repopulates within ~5 min after a Reset (business_profiles is kept and drives its enumeration) — FR-26.' },

  // ── §3.5 Payments ────────────────────────────────────────────────────────
  { table: 'payment_refunds', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.BLOCKING_CHILD, snapshot: 'rows', export: PAYMENT_REFUNDS_EXPORT,
    notes: 'B1 — RESTRICT onto payment_transactions, so this goes first. Deleting it fires T2, the single T5 residue path.' },
  { table: 'payment_plan_subscriptions', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.BLOCKING_CHILD, snapshot: 'rows', export: PAYMENT_PLAN_SUBSCRIPTIONS_EXPORT,
    notes: 'B2 (RESTRICT onto scheduling_bookings), so this goes first. CASCADE parent of payment_plan_installments, which sit in PRE_BLOCKING ahead of it. SELECT-only RLS.' },
  { table: 'payment_transactions', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: PAYMENT_TRANSACTIONS_EXPORT },
  { table: 'payment_invoices', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: PAYMENT_INVOICES_EXPORT },
  { table: 'payment_plans', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: PAYMENT_PLANS_EXPORT },
  { table: 'payment_plan_installments', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.PRE_BLOCKING + 1, snapshot: 'rows', export: PAYMENT_PLAN_INSTALLMENTS_EXPORT,
    notes: 'CASCADE child of payment_plan_subscriptions (BLOCKING_CHILD), so it is ordered ahead of it for an accurate count (slice 3a, M-4).' },
  { table: 'payment_events', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY, 'payment event log feeding the automation engine; the payments, invoices and refunds it records are exported themselves (user BC-5, 2026-10-16; as business_events, §0.3.1 SQ-E7)') },
  { table: 'payment_automation_rules', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: exclude(EXPORT_REASON.PLATFORM, 'the built-in payment rules the platform seeds; the owner cannot create or edit them (defaultPaymentRules.ts; user BC-6, 2026-10-16)') },
  { table: 'payment_automation_executions', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY, 'automation run history and its claim / lease columns (user BC-5, 2026-10-16)') },
  { table: 'payment_reminders', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.PRE_BLOCKING, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY, 'payment reminders scheduled and sent to clients: emails sent are activity (user BC-4, 2026-10-16; as DE-4 BC-6)'),
    notes: 'CASCADE child of payment_plan_installments, so it is ordered ahead of it for an accurate count (slice 3a, M-4).' },
  { table: 'saved_payment_methods', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: SAVED_PAYMENT_METHODS_EXPORT },
  { table: 'payment_methods', level: 'reset', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.PLATFORM, 'dead table superseded by saved_payment_methods: no app reads or writes it, 0 rows (live 2026-10-16); drop migration pending'),
    notes: 'Live — 2026-08-14_drop_payment_methods.sql was never applied. Measured, not assumed.' },
  { table: 'payment_processors', level: 'purge', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: PAYMENT_PROCESSORS_EXPORT,
    notes: 'Holds credentials JSONB. Kept by Reset so test payments work immediately.' },
  { table: 'stripe_connect_accounts', level: 'purge', area: 'payments', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: STRIPE_CONNECT_ACCOUNTS_EXPORT,
    notes: 'The pre-flight gate READS this in phase 1, long before phase 2 deletes it.' },

  // ── §3.6 Email automation ────────────────────────────────────────────────
  { table: 'email_sequences', level: 'reset', area: 'email_marketing', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: EMAIL_SEQUENCES_EXPORT },
  { table: 'email_sequence_steps', level: 'reset', area: 'email_marketing', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: EMAIL_SEQUENCE_STEPS_EXPORT },
  { table: 'email_campaigns', level: 'reset', area: 'email_marketing', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: EMAIL_CAMPAIGNS_EXPORT },
  { table: 'email_sends', level: 'reset', area: 'email_marketing', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY) },
  { table: 'email_sequence_enrollments', level: 'reset', area: 'email_marketing', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: EMAIL_SEQUENCE_ENROLLMENTS_EXPORT },
  { table: 'email_unsubscribes', level: 'never', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: EMAIL_UNSUBSCRIBES_EXPORT,
    notes: 'K* — RETAINED BY BOTH LEVELS (D8). A third party withdrew consent. auth.users survives, so the same user_id can re-onboard; deleting this would resume emailing people who opted out. FR-23 requires the copy to say so. Now DERIVED from marketing_consent_events by trigger, and kept because this promise is made to users in two places.' },

  { table: 'business_subscribers', level: 'reset', area: 'email_marketing', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: BUSINESS_SUBSCRIBERS_EXPORT,
    notes: 'The newsletter audience. Reset clears it with the rest of the business data — unlike the consent ledger, which records what each person AGREED to and is retained forever. A rebuilt business starts with an empty list and has to earn it again.' },

  // ── §3.6b Marketing consent ──────────────────────────────────────────────
  { table: 'marketing_consent_events', level: 'never', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: MARKETING_CONSENT_EVENTS_EXPORT,
    notes: 'Same reasoning as email_unsubscribes, in both directions. A withdrawal must outlive the business, or a reset resumes mailing people who opted out. A GRANT must outlive it too: the evidence of what someone agreed to is what answers a complaint or a subject access request years later, and it cannot be reconstructed.' },
  { table: 'marketing_consent_state', level: 'never', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.CACHE, 'the current consent per address, rebuilt by trigger from marketing_consent_events, which is exported whole as consent_records; no id column to page on (TL default BC-6, 2026-10-16; DE-6 SA-Q3)'),
    notes: 'The projection the send gate reads. Deleting it would read as "no decision recorded", which fails closed for grants but would also lose every suppression. Derived, but not disposable.' },
  { table: 'marketing_consent_settings', level: 'purge', area: 'email_marketing', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: MARKETING_CONSENT_SETTINGS_EXPORT,
    notes: 'Business configuration — the tenant\'s own consent wording, privacy notice and postal address. Unlike the decisions above, this is theirs, not their clients\'.' },

  // ── §3.7 Intake ──────────────────────────────────────────────────────────
  { table: 'user_intake_settings', level: 'purge', area: 'intake', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: USER_INTAKE_SETTINGS_EXPORT },
  { table: 'business_intake_forms', level: 'purge', area: 'intake', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: BUSINESS_INTAKE_FORMS_EXPORT,
    notes: 'Confirmed live by T1, so §10.2 para 2 is firm and AC-3 asserts it unconditionally.' },

  // ── §3.8 Onboarding & chat ───────────────────────────────────────────────
  { table: 'onboarding_conversations', level: 'reset', area: 'onboarding_chat', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'Append-only RLS; /api/onboarding/chat/reset already hard-deletes these.' },
  { table: 'onboarding_prompt_ideas', level: 'reset', area: 'onboarding_chat', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY) },
  { table: 'command_sessions', level: 'reset', area: 'onboarding_chat', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY) },
  { table: 'business_chat_conversation', level: 'reset', area: 'onboarding_chat', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'user_id is the PRIMARY KEY, so at most one row per business. A low count here is correct, not a broken query.' },
  { table: 'business_chat_action_log', level: 'reset', area: 'onboarding_chat', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'Deleted, and the idempotency keys are NOT retained — FR-24 accepts the plan-level re-arm deliberately.' },
  { table: 'business_chat_saved_plans', level: 'reset', area: 'onboarding_chat', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY) },
  { table: 'business_chat_verified_questions', level: 'reset', area: 'onboarding_chat', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'user_id is NOT NULL (measured) — so §8.2\'s portable-row shape does NOT apply here, unlike business_chat_plan_cache. Plain scoped delete.' },
  { table: 'business_chat_plan_cache', level: 'reset', area: 'onboarding_chat', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.CACHE),
    notes: 'user_id is NULLABLE (measured). Rows WHERE user_id IS NULL are PORTABLE and shared by every tenant. The predicate is `user_id = p_user_id` and must stay equality — `<>`, `IS DISTINCT FROM` and `NOT IN` are FORBIDDEN here (§8.2). Those surviving rows are also why a planId can recur post-purge (FR-24).' },

  // ── §3.9 Capabilities ────────────────────────────────────────────────────
  { table: 'user_capabilities', level: 'purge', area: 'capabilities', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: exclude(EXPORT_REASON.MODULE_SETUP) },
  { table: 'user_capability_blocks', level: 'purge', area: 'capabilities', scope: { kind: 'via', parent: 'user_capabilities', fk: 'user_capability_id' }, order: ORDER.CONFIG - 1, snapshot: 'ids', export: exclude(EXPORT_REASON.MODULE_SETUP),
    notes: 'No user_id. Child ids captured pre-delete for AC-5. Ordered one ahead of its parent so the reported count is the rows this delete actually removed, rather than 0 because the parent CASCADE got there first.' },

  // ── §3.10 Conversion / attribution ───────────────────────────────────────
  { table: 'smart_links', level: 'reset', area: 'smart_links', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: SMART_LINKS_EXPORT },
  { table: 'smart_link_clicks', level: 'reset', area: 'smart_links', scope: { kind: 'via', parent: 'smart_links', fk: 'smart_link_id' }, order: ORDER.LEAF, snapshot: 'ids', export: exclude(EXPORT_REASON.VISITOR),
    notes: 'IDS ONLY (DEV-Q6) and no user_id. Publicly writable (WITH CHECK true). Ids-only still satisfies AC-5, which needs the ids and not the rows.' },

  // ── §3.11 Channel insights ───────────────────────────────────────────────
  { table: 'channel_connections', level: 'purge', area: 'channels', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY, 'and it holds account_token'),
    notes: 'Holds account_token. ALWAYS deleted by Purge regardless of the integrations checkbox — the UI must not imply otherwise (AC-32).' },
  { table: 'channel_metrics_daily', level: 'reset', area: 'channels', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'After a Reset, channel_connections and its last_synced_at both survive, so this returns on the connection\'s NEXT SCHEDULED sync — up to ~20h, not within the hour (FR-26 as amended).' },

  // ── §3.12 Insights ───────────────────────────────────────────────────────
  { table: 'insight_automations', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.BLOCKING_CHILD, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'B3 — NO ACTION onto kernel_executions, so this goes first.' },
  { table: 'insights', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'Self-FK correlation_parent_id is SET NULL — cosmetic, needs no ordering.' },
  // Admin delete AD-1a (SC-8, SA-1(a)): found unclassified on prod 2026-10-04.
  { table: 'insight_actions', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'Chase-invoice / follow-up actions the insights engine proposes to the owner about their clients — business data. Its FK to business_profiles is CASCADE, so before AD-1a a Purge emptied it with no snapshot and no count (the only uncounted cascade child of business_profiles, SA-1(a)). Measured live 2026-10-04: no inbound FK; outbound insight_id -> insights SET NULL, contact/booking/invoice CASCADE — no blocking edge, so LEAF.' },
  { table: 'owner_insight_history', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY) },
  // Test-account cleanup first live run (2026-10-07): both found unclassified on prod.
  // PR #257 then committed their CREATE TABLEs (20261006e, 20261006g) and added both to
  // the ownership migration's business_owned array (20260916), whose loop is what creates
  // the `<table>_business_fk` CASCADE measured live. One descriptor each (main-fix 2026-10-08).
  { table: 'insight_hypotheses', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'Model-proposed findings awaiting review (20261006e): claim, query, confirm_when, verdict about this business. A published row is copied into `insights`, not joined to it. Business data. Measured live 2026-10-07: user_id NOT NULL with insight_hypotheses_business_fk -> business_profiles(user_id) CASCADE; no other FK, no inbound FK, no trigger. decided_by is a plain uuid with no FK. No blocking edge, so LEAF. FK discrepancy reconciled 2026-10-08: 20261006e itself declares no FK; the business_fk comes from the 20260916 ownership loop (#257 added the table to its array), so the live measurement stands. RLS: 20261006e enables RLS with no policy (operator-only), matching the live probe (anon sees 0 of its 12 rows).' },
  { table: 'insight_measurements', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'Re-readings of the insight metric after the owner acted or dismissed (20261006g): value_before, value_after, verdict. Business data. Measured live 2026-10-07: user_id NOT NULL with insight_measurements_business_fk -> business_profiles(user_id) CASCADE, insight_id NOT NULL -> insights CASCADE; no inbound FK, no trigger. LEAF, so it runs before insights (ROOT) and reports its own count rather than 0 from the cascade. Both FKs are declared by 20261006g (insight_id inline; business_fk explicitly, and also by the 20260916 ownership loop). RLS: 20261006g enables RLS with no policy (operator-only); live measurement found no policy, consistent.' },
  { table: 'business_events', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'Hazard H1 — no emitters; likely empty. Also one of insight-detect\'s four tenant-enumeration sources, all of which Reset deletes (FR-26).' },
  { table: 'derived_metrics', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.CACHE) },
  { table: 'business_health_summaries', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY) },

  // ── §3.13 Kernel (insight-triggered) ─────────────────────────────────────
  { table: 'kernel_executions', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY) },
  { table: 'kernel_action_log', level: 'reset', area: 'insights', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY) },

  // ── §3.14 Owner configuration ────────────────────────────────────────────
  { table: 'user_preferences', level: 'never', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: USER_PREFERENCES_EXPORT,
    notes: 'K* — RETAINED BY BOTH LEVELS. Holds preferred_language and currency. Deleting it resets the owner\'s language while they are reading the result screen, and renders their NEXT sign-in wrong — on a login that survives every level (D3).' },

  // ── §3.15 Newly classified in scope (T1 pass) ────────────────────────────
  { table: 'proposals', level: 'reset', area: 'crm', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: PROPOSALS_EXPORT,
    notes: 'Business content the owner authored and sent to their clients. Self-FK supersedes_id is SET NULL — no ordering needed. LEAF (slice 3a, M-4): a CASCADE child of crm_contacts, so it goes before it for an accurate count.' },
  { table: 'lead_responses', level: 'reset', area: 'crm', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY, 'queued and sent automatic messages to leads and clients (invitations, chases, reminders) with their claim / lease columns: messages sent are activity (TL default BC-2, 2026-10-16; as payment_reminders, DE-5 BC-4)'),
    notes: 'Lead data is customer data.' },
  { table: 'daily_briefings', level: 'reset', area: 'briefings', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY) },
  { table: 'daily_briefing_sends', level: 'reset', area: 'briefings', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.ACTIVITY),
    notes: 'A send log. It has the email_unsubscribes flavour but not its substance: a send history is the business\'s own activity record, not a third party\'s withdrawal of consent, so D8\'s retention reasoning does not extend to it.' },
  { table: 'user_media', level: 'reset', area: 'website', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: USER_MEDIA_EXPORT,
    notes: 'CONFIRMED at T4: storage_path points at the EXISTING website-images bucket (GeneratedImageService and StockImageService both write BUCKET = website-images and record here). So NO fourth StorageDescriptor is needed and AC-4 does not extend to a new bucket.' },

  // ── §3.16 Data export (DE-8a, migration 20261074) ────────────────────────
  { table: 'business_os_data_exports', level: 'purge', area: 'data_exports', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'ids', export: exclude(EXPORT_REASON.EXPORT_ITSELF),
    notes: 'The "Download my data" jobs (data export requirement §0.4.1 A). user_id -> auth.users CASCADE, no FK to business_profiles (an agent-platform user may export too), requested_by has no FK (SA Q-2), no inbound FK, no trigger: LEAF. A row holds dates, counts and bytes, never content. snapshot ids: the pre-purge snapshot must not copy another copy of the business. Kept by Reset (an owner may export, then start over); Purge and account deletion remove it, and the business-data-exports bucket with it.' },
];

// ────────────────────────────────────────────────────────────────────────────
// OPT-IN EXTRAS — §10.3, all off by default
// ────────────────────────────────────────────────────────────────────────────

const OPT_IN: PurgeDescriptor[] = [
  { table: 'plugin_connections', level: 'optional:integrations', area: 'integrations', scope: { kind: 'user_id' }, order: ORDER.CONFIG, snapshot: 'rows', export: exclude(PLUGIN_CONNECTIONS_EXCLUDED),
    notes: 'READ during phase 1 for Stripe account resolution, deleted in phase 2 — the phase split is what makes AC-33 true, and T9 asserts the order rather than assuming it. Export: excluded since DE-4 (user 2026-10-15, connected apps out), so the export never reads this table.' },

  // "Also delete my agents". B6 and B7 both live here, and both are invisible
  // to a default T28 run because the option is off by default (C-28).
  { table: 'agent_logs', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.BLOCKING_CHILD, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS),
    notes: 'B6 — NO ACTION onto agents, so this must precede it.' },
  { table: 'agent_scheduler_state', level: 'optional:agents', area: 'agents', scope: { kind: 'via', parent: 'agents', fk: 'agent_id' }, order: ORDER.BLOCKING_CHILD + 1, snapshot: 'ids', export: exclude(EXPORT_REASON.AGENTS),
    notes: 'B7 (C-30). NO tenancy column at all, so FR-1\'s predicate cannot see it by construction — it is reachable only through the blocking-edge check. last_execution_id -> agent_executions is NO ACTION. agent_id -> agents is CASCADE, so deleting agents would clear it incidentally, but relying on that would make the order depend on an FK action someone can later change to SET NULL.' },
  { table: 'agents', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.ROOT, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS) },
  { table: 'agent_executions', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.ROOT - 1, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS),
    notes: 'CASCADE child of agents, so it goes one ahead of it for an accurate count (slice 3a, M-4). Still after agent_scheduler_state (B7).' },
  { table: 'agent_memory', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS),
    notes: 'Confirmed live at T4 — it was not a migration-file phantom.' },
  { table: 'agent_memories', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS),
    notes: 'Distinct from agent_memory (singular). Both exist; see also run_memories and user_memory — four memory tables in total.' },
  { table: 'run_memories', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS) },
  { table: 'user_memory', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS),
    notes: 'The user\'s own remembered preferences — leaving it after "delete my agents" is the same defect that added the prompt threads.' },
  { table: 'agent_prompt_threads', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS) },
  { table: 'agent_prompt_workflow_generation_sessions', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS) },
  { table: 'data_decision_requests', level: 'optional:agents', area: 'agents', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.AGENTS),
    notes: 'PENDING a requirement amendment — §8.10 still lists this as provisional `never`, awaiting the identification T4 was asked for. Supplied: written by lib/pilot/shadow/DataDecisionHandler.ts, keyed to agent_id/execution_id, and decision_context/user_decision hold the data the decision was about. SA ruled optional:agents (N11). Both its FKs are CASCADE, so it adds NO ordering constraint (B5 does not exist).' },

  { table: 'audit_trail', level: 'optional:activityHistory', area: 'activity_history', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'rows', export: exclude(EXPORT_REASON.AUDIT),
    notes: 'user_id is SET NULL on the auth FK. With this option ticked, the audit record of THIS purge is still written afterwards.' },
  // Admin Archiving (Slice 2, condition C-4): the audit rows that have been moved
  // out of audit_trail. Same classification, scope and band as their source, so
  // "delete my activity history" reaches archived history too (BQ-7, FR-14a).
  // `snapshot: 'ids'`, unlike audit_trail: archived history is the long tail by
  // definition, and a full-row snapshot above the 250,000-row SNAPSHOT_ROW_CEILING
  // would make a business with years of history impossible to purge.
  { table: 'archived_records', level: 'optional:activityHistory', area: 'activity_history', scope: { kind: 'user_id' }, order: ORDER.LEAF, snapshot: 'ids', export: exclude(EXPORT_REASON.AUDIT),
    notes: 'Archived audit_trail rows (Admin Archiving). No FK to auth.users on purpose (Slice 2 SA R-1), so the user_id survives account deletion and this scope still finds the rows. Its archive_run_id FK points at archive_runs, which is never, so it constrains no purge.' },
];

// ────────────────────────────────────────────────────────────────────────────
// NEVER — §8. Enumerated, not prose.
//
// Without these rows FR-1 route (a) cannot tell an unknown table from a
// deliberately excluded one, and would fail closed on EVERY run. That is
// SA-2P1, and it is why a category name is not evaluable.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a `never` descriptor. Scope is recorded for documentation only — a
 * `never` row never emits a delete. `exportAs` is the data export
 * classification (DE-2): never purged does not mean never exported.
 */
const never = (
  table: string,
  scope: PurgeDescriptor['scope'],
  exportAs: TableExportClassification,
  notes: string
): PurgeDescriptor =>
  ({ table, level: 'never', scope, order: ORDER.LEAF, snapshot: 'ids', notes, export: exportAs });

const G = { kind: 'global' } as const;
const U = { kind: 'user_id' } as const;

const EXCLUDED: PurgeDescriptor[] = [
  // §8.1 Global catalogs — no user_id
  never('capabilities', G, exclude(EXPORT_REASON.PLATFORM), 'Shared catalog, RLS off. Deleting it breaks every user.'),
  never('capability_building_blocks', G, exclude(EXPORT_REASON.PLATFORM), 'Same.'),
  never('website_templates', G, exclude(EXPORT_REASON.PLATFORM), 'Public read; breaks website creation platform-wide.'),
  never('intake_form_templates', G, exclude(EXPORT_REASON.PLATFORM), 'Global catalog. Per the tenant-isolation-guard skill, do NOT invent a user_id filter on a global catalog.'),

  // §8.4 Organisation / multi-user
  never('organizations', { kind: 'user_id' }, exclude(EXPORT_REASON.ORGANISATION), 'Keys on owner_user_id, NOT user_id — so FR-1\'s predicate cannot see it, which is the gap N15\'s union predicate closes. Every user gets a row via get_or_create_user_organization.'),
  never('organization_members', U, exclude(EXPORT_REASON.ORGANISATION), 'Deleting a membership can strand a multi-user org.'),

  // §8.5 Billing & quota — owner-ruled
  never('subscriptions', U, exclude(EXPORT_REASON.BILLING), 'Billing state.'),
  never('storage_usage', U, exclude(EXPORT_REASON.PLATFORM, 'quota accounting'), 'Platform quota accounting; deleting it corrupts billing state. Also carries AFTER DELETE triggers that recompute quota.'),
  never('user_subscriptions', U, exclude(EXPORT_REASON.BILLING), 'OWNER RULING: the platform\'s commercial relationship with the customer, not the customer\'s data about their clients. A customer disputing a charge needs the evidence.'),
  never('subscription_invoices', U, exclude(EXPORT_REASON.BILLING), 'Owner ruling — as above.'),
  never('billing_events', U, exclude(EXPORT_REASON.BILLING), 'Owner ruling — as above.'),
  never('credit_transactions', U, exclude(EXPORT_REASON.BILLING), 'Owner ruling — as above.'),
  never('boost_pack_purchases', U, exclude(EXPORT_REASON.BILLING), 'Owner ruling — as above.'),

  // §8.6 Org analytics — a different subsystem
  never('advisor_reports', U, exclude(EXPORT_REASON.AGENTS), 'Org-analytics advisor, not Business OS Insights.'),
  never('automation_slas', U, exclude(EXPORT_REASON.AGENTS), 'Workflow/agent SLAs.'),
  never('metric_baselines', U, exclude(EXPORT_REASON.AGENTS), 'Agent-execution analytics, not derived_metrics.'),
  never('group_metrics_rollup', U, exclude(EXPORT_REASON.AGENTS), 'Workflow-group analytics.'),

  // §8.7 Kernel / V6 learning
  never('calibration_history', U, exclude(EXPORT_REASON.AGENTS), 'Kernel learning.'),
  never('error_patterns', U, exclude(EXPORT_REASON.AGENTS), 'Kernel learning.'),
  never('execution_anomalies', U, exclude(EXPORT_REASON.AGENTS), 'Kernel learning.'),
  never('execution_baselines', U, exclude(EXPORT_REASON.AGENTS), 'Kernel learning.'),
  never('plugin_performance', U, exclude(EXPORT_REASON.AGENTS), 'Kernel learning.'),
  // Data export DE-2 (§0.3.6, SA-Q9): the only USER_OWNED_TABLES entry that had no descriptor.
  never('intent_examples', G, exclude(EXPORT_REASON.AGENTS),
    'V6 few-shot intent catalog (PII-stripped examples). No user_id: its only CREATE TABLE (20260629_intent_examples_table.sql) has none and the live dump of 2026-09-15 measured none, so scope global and FR-1 never enumerates it. Listed in USER_OWNED_TABLES although it has no user_id: decide in the next ownership pass (DE-2 SA-Q9 follow-up).'),

  // §8.8 Platform identity
  never('admin_users', U, exclude(EXPORT_REASON.PLATFORM, 'platform authorization'), 'Deleting rows here locks admins out. The trusted admin signal — never profiles.role.'),
  never('profiles', U, PROFILES_EXPORT, 'D3 — never deleted. (Its FK is profiles.id -> auth.users(id), not a user_id column.)'),

  // §8.10 Agent / workflow platform (kernel)
  never('agent_configurations', U, exclude(EXPORT_REASON.AGENTS), 'Agent platform.'),
  never('agent_execution_logs', U, exclude(EXPORT_REASON.AGENTS), 'Agent platform.'),
  never('agent_templates', U, exclude(EXPORT_REASON.AGENTS), 'Agent platform.'),
  never('agentkit_analytics', U, exclude(EXPORT_REASON.AGENTS), 'Agent platform.'),
  never('calibration_sessions', U, exclude(EXPORT_REASON.AGENTS), 'Agent platform.'),
  never('workflow_executions', U, exclude(EXPORT_REASON.AGENTS), 'Agent platform.'),
  never('pilot_step_routing_history', U, exclude(EXPORT_REASON.AGENTS), 'Agent platform. Its public policies were removed by migration 20261055 (server-only plus an admin SELECT policy). execution_insights still carries its N17 policy, tracked separately.'),
  never('shadow_failure_snapshots', U, exclude(EXPORT_REASON.AGENTS), 'Agent platform.'),
  never('shared_agents', U, exclude(EXPORT_REASON.AGENTS), 'Agent platform.'),
  never('execution_insight_runs', U, exclude(EXPORT_REASON.AGENTS), 'The OTHER insights system — agent execution quality, not the owner\'s business. The name collision is the most common mistake in this area.'),
  never('execution_insights', U, exclude(EXPORT_REASON.AGENTS), 'The OTHER insights system. Also carries a public WITH CHECK (true) INSERT policy (N17).'),
  never('agent_stats', U, exclude(EXPORT_REASON.AGENTS), 'BASE TABLE, not a view — confirmed by Part 2, so it needs this descriptor. Agent platform telemetry.'),
  never('agent_intensity_metrics', U, exclude(EXPORT_REASON.AGENTS), 'BASE TABLE, not a view — confirmed by Part 2. Agent platform telemetry.'),

  // §8.11 Token accounting
  never('token_usage', U, exclude(EXPORT_REASON.BILLING, 'usage and our provider cost'), 'Token accounting.'),

  // §8.13 Business OS entitlements (subscription module, component 1)
  //
  // These are `never` for a reason that is the opposite of the usual one. They
  // ARE about this business — but a Reset that removed them would hand the
  // account a fresh trial, which is a commercial loophole, not a start-over.
  // They are keyed to auth.users, NOT cascaded from business_profiles, so
  // neither Reset nor Purge can reach them by accident either.
  never('business_os_account_plans', U, exclude(EXPORT_REASON.BILLING),
    'Entitlement state (tier, cohort, expiries). Deleting it would restart the trial clock — a Reset must not be a way to get another free period. Keyed to auth.users, not business_profiles.'),
  never('business_os_entitlement_overrides', U, exclude(EXPORT_REASON.BILLING),
    'The durable record of what an admin granted or revoked, and why. Support evidence; also never deleted by the admin reset, which ends rows instead.'),
  never('business_os_entitlement_shadow_events', U, exclude(EXPORT_REASON.CACHE, 'platform counters'),
    'Aggregated "what would have been gated" counters. Platform observability about the product, not the owner\'s business data.'),

  // Credit deduction slice 3b-i (SA-S8, workplan §6.5): the credit ledger (any service, one pool).
  // `never` for the same reason as the plan rows above, and more so: this is
  // the bill. Keyed to auth.users, not business_profiles, so no Reset or Purge
  // can reach it through the business cascade either.
  never('business_os_credit_charges', U, exclude(EXPORT_REASON.BILLING),
    'The bill: one row per charged Business OS action, AI or any other service. Never purged and never archived — a Reset that removed it would erase what the account was charged. Keyed to auth.users (ON DELETE SET NULL), not business_profiles.'),
  never('business_os_credit_totals', U, exclude(EXPORT_REASON.BILLING),
    'The running total of business_os_credit_charges per billing period. Derived from the bill and rebuilt from it; never purged. Keyed to auth.users (ON DELETE CASCADE), not business_profiles.'),

  // Credit deduction slice 11a (S11-SQ-12): credit lots. Financial records,
  // like the bill: never purged and never archived.
  never('business_os_credit_lots', U, exclude(EXPORT_REASON.BILLING),
    'Credits added to the account: one row per admin grant, later per boost purchase. A financial record: never purged and never archived — a Reset that removed it would erase credits the account was given or paid for. Keyed to auth.users (ON DELETE SET NULL), not business_profiles.'),
  never('business_os_credit_lot_draws', U, exclude(EXPORT_REASON.BILLING),
    'Credits taken back out of a lot (admin reversals; consumption from slice 9). A financial record that what is left of a lot is rebuilt from; never purged and never archived. Keyed to auth.users (ON DELETE SET NULL), not business_profiles.'),

  // Plan payments P-2a (PF-14, SA-P1): the Business OS billing record.
  never('business_os_billing_accounts', U, exclude(EXPORT_REASON.BILLING),
    'The Business OS billing record: the Stripe customer and subscription of the plan, one row per account per Stripe mode. A Reset that removed it would orphan a live Stripe subscription that keeps charging, and lose the customer link. A retained financial record: never purged and never archived. Keyed to auth.users (ON DELETE SET NULL), not business_profiles.'),

  // Plan payments P-3b.1 (SA-P5, migration 20261027): the money history.
  never('business_os_billing_events', U, exclude(EXPORT_REASON.BILLING),
    'The Business OS money history: one append-only row per Stripe money event of the plan (paid, failed, refused). A retained financial record: never purged and never archived. A Reset that removed it would erase what the account paid and which payment moved its plan. Keyed to auth.users (ON DELETE SET NULL), not business_profiles.'),

  // Credits boost slice 2a (NFR-12, F-11): boost purchases and cap overrides.
  never('business_os_boost_purchases', U, exclude(EXPORT_REASON.BILLING),
    'Boost purchases: one row per attempt to buy credits, with the price, the Stripe references and the link to the credit lot. A financial record: never purged and never archived — a Reset that removed it would erase what the account paid for. Keyed to auth.users (ON DELETE SET NULL), not business_profiles.'),
  never('business_os_boost_cap_overrides', U, exclude(EXPORT_REASON.BILLING),
    "Admin changes to the account's boost purchase cap, ended and never deleted. An audited admin record: never purged and never archived. Keyed to auth.users (ON DELETE SET NULL), not business_profiles."),
  // Finance slice 4b.1 (BD-17, migration 20261076): the dated refund and dispute history of a boost purchase.
  never('business_os_boost_reversal_events', { kind: 'via', parent: 'business_os_boost_purchases', fk: 'purchase_id' }, exclude(EXPORT_REASON.BILLING),
    'One append-only, dated row per refund step or dispute stage of a boost purchase: the date Finance counts it in. A financial record: never purged and never archived. No user_id: the account comes through the purchase, and the row is removed only with its purchase (ON DELETE CASCADE).'),

  // Admin Archiving (Slice 2, condition C-4)
  never('archive_runs', G, exclude(EXPORT_REASON.PLATFORM),
    'The platform run log of archiving: who ran it, when, which cutoff, how many rows. No user_id and no business content, counts only. Never archived and never purged.'),

  // Admin reorganisation slice 5 (SA SC-4): the Business OS cron run record.
  never('bos_cron_runs', G, exclude(EXPORT_REASON.PLATFORM),
    'The platform run record of the Business OS scheduled jobs: job name, times, an outcome word, an error class and numeric counts. No user_id and no business content. Platform monitoring data, pruned at 30 days by the recorder; never purged.'),
  // Finance slice 8.1 (§11M.6, HS-W-8): the nightly platform history of states that cannot be rebuilt.
  never('business_os_finance_snapshots', G, exclude(EXPORT_REASON.PLATFORM),
    'One row per platform figure per UTC day: counts of accounts and amounts of credits, written by the nightly finance snapshot job. No user_id, no account, no money: platform aggregates, not tenant data. Append only; never purged and never archived (the history cannot be rebuilt).'),
  // Data export DE-10b.1 (SA Review 2 §E, migration 20261080): the deletion receipt.
  never('business_os_deletion_receipts', G, exclude(EXPORT_REASON.PLATFORM),
    'One row per committed account deletion, inserted only by the cleanup function inside its own transaction. No user_id, no owner_user_id and no foreign key, so no cascade, purge, audit erasure or archiving reaches it: the proof of an erasure must outlive the account. Holds a keyed fingerprint of the email, never the email. Never purged by a business purge; retention is its own release-3 sweep.'),
  // Account deletion lifecycle DL-1a (XC-1, SA O-2, migration 20261093): the deletion request itself.
  never('business_os_account_closures', U, exclude('the deletion request itself: process state shown in the app', 'dates, a language code and guard codes, never the typed statement'),
    'One row per deletion request of the account (stages A to D). `never` on purpose: a business Reset or Purge must not cancel a pending deletion request, or the banner, the lock and the stored GDPR request time would vanish while the plan stays set not to renew. Keyed to auth.users (ON DELETE CASCADE), no inbound foreign key, no trigger. Removed by step B of the test-account cleanup in both modes (the hard delete and the anonymise): at stage E the engine deletes it with the account.'),
  never('bos_cron_run_recording', G, exclude(EXPORT_REASON.PLATFORM),
    'One row: when the cron run record was installed. Platform monitoring baseline, no user_id; never purged.'),

  // Invite-only signup, Slice 0 (condition C-10, SA ruling F-1).
  never('business_os_invites', G, exclude(EXPORT_REASON.BILLING),
    'Platform record of who was invited, by which admin, on what grant, and whether it was used. No user_id: not tenant data, so a Reset or Purge must never touch it (a Reset that removed it would also let an owner re-enter as a fresh invitee). Deliberately NOT in USER_OWNED_TABLES: the account-deletion sweep deletes by user_id, which this table does not have. Erasure of the invitee email is requirement L-12, designed in the Slice 1 workplan.'),
  // Invite-only signup, Slice 1b (L-6, C-10).
  never('business_os_account_lineage', G, exclude(EXPORT_REASON.PLATFORM),
    'Platform record of who invited whom (the invitation circle, level, parent, root). Keyed on account_id, deliberately no user_id: not tenant data, and a Reset or Purge that removed it would let an owner re-enter as the referral of someone else. Not in USER_OWNED_TABLES for the same reason as business_os_invites; it holds no email, and keeps its pseudonymous ids after erasure (SA F-12).'),

  // Admin delete AD-1a (SC-8). Found by the SchemaReconciler on prod 2026-10-04.
  never('auth_handoff_codes', U, exclude(EXPORT_REASON.SECRET, 'short-lived sign-in codes'),
    'Ephemeral sign-in handoff codes: identity-level, not business data. Short-lived by design and CASCADE-deleted with the auth user, which survives every purge level (D14).'),
  //
  // Actor references on PLATFORM data. None has a tenancy column: each is a
  // platform/config table whose only link to auth.users records which person
  // changed or acknowledged a row. FR-1(iv)'s union predicate (any FK to
  // auth.users) sees them; they are not this business's data and a purge must
  // not delete them. Scope `global` for documentation: there is no user_id.
  never('ais_scoring_weights', G, exclude(EXPORT_REASON.ACTOR_REF),
    'Actor reference on platform data: updated_by -> auth.users (SET NULL). Platform AIS scoring config.'),
  never('ais_system_config', G, exclude(EXPORT_REASON.ACTOR_REF),
    'Actor reference on platform data: updated_by -> auth.users (SET NULL). Platform AIS config.'),
  never('shared_agent_imports', G, exclude(EXPORT_REASON.AGENTS),
    'Actor reference on platform data: imported_by_user_id -> auth.users (SET NULL). Agent-platform sharing record; created_agent_id -> agents is SET NULL, so the agents option does not block on it.'),
  never('exchange_rates', G, exclude(EXPORT_REASON.ACTOR_REF),
    'Actor reference on platform data: updated_by -> auth.users is NO ACTION. FU-9: a hard delete of the auth user is BLOCKED while any row names them — the FU-9 hard-delete design must null or reassign this column first.'),
  never('exchange_rate_history', G, exclude(EXPORT_REASON.ACTOR_REF),
    'Actor reference on platform data: changed_by -> auth.users is NO ACTION. FU-9: blocks a hard delete of the auth user, as exchange_rates.'),
  never('system_settings_config', G, exclude(EXPORT_REASON.ACTOR_REF),
    'Actor reference on platform data: updated_by -> auth.users is NO ACTION. Platform-wide settings. FU-9: blocks a hard delete of the auth user, as exchange_rates.'),
  never('sla_events', G, exclude(EXPORT_REASON.ACTOR_REF),
    'Actor reference on platform data: acknowledged_by -> auth.users is NO ACTION (sla_id -> automation_slas is CASCADE; automation_slas is never). FU-9: blocks a hard delete of the auth user, as exchange_rates.'),

  // §8.12 Account configuration and unowned tables
  never('notification_settings', U, NOTIFICATION_SETTINGS_EXPORT, 'Account configuration that survives the business.'),
  never('security_settings', U, exclude(EXPORT_REASON.SECRET, 'security configuration, not in the DX-1a set (may hold second-factor material)'), 'Account configuration that survives the business.'),
  never('api_keys', U, exclude(EXPORT_REASON.SECRET), 'Account configuration.'),
  never('user_rewards', U, exclude(EXPORT_REASON.BILLING), 'Rewards ledger, adjacent to billing.'),
  never('audit_logs', U, exclude(EXPORT_REASON.AUDIT), 'Live and user-scoped — NOT phantom, measured at T1. Distinct from audit_trail, so the activity-history checkbox does NOT cover it.'),
  never('processed_webhook_events', U, exclude(EXPORT_REASON.PLATFORM, 'webhook idempotency'), 'Carries a user_id, so §3.15\'s planned "global" default did not apply. Excluded anyway: a user-scoped idempotency row deleted mid-flight could let Stripe replay a webhook against a business that no longer exists.'),
];

// ────────────────────────────────────────────────────────────────────────────
// STORAGE (C-16) — buckets get descriptors for the same reason tables do.
// Unlike tables, storage has NO information_schema to fail closed against, so
// this list is the ONLY inventory that exists.
// ────────────────────────────────────────────────────────────────────────────

export const STORAGE_DESCRIPTORS: readonly StorageDescriptor[] = [
  // DE-8b (SA Q-17): both buckets are in "Your files", under these zip folders
  // (`files/<folder>/...`). Classification only: the purge fields are untouched.
  // Documents: only objects a live contact_documents row points at (C-11);
  // images: every object in the owner's folder (Q10b, BC-4).
  { bucket: 'contact-documents', level: 'reset', pathPrefix: '{user_id}/', purpose: 'CRM contact documents; indexed by contact_documents rows.', export: { kind: 'include', folder: 'client-documents' } },
  { bucket: 'website-images', level: 'reset', pathPrefix: '{user_id}/', purpose: 'Website images. ALSO backs user_media — confirmed at T4, which is why no fourth bucket descriptor is needed.', export: { kind: 'include', folder: 'website-images' } },
  { bucket: 'business-purge-snapshots', level: 'never', pathPrefix: '{user_id}/', purpose: 'The pre-purge snapshot itself. NEVER emptied by a purge — deleting the forensic artefact as part of the act it records would defeat its purpose. Private, no RLS policy granting authenticated anything (AC-36).',
    export: { kind: 'exclude', reason: 'an internal copy taken before a purge, not the live data' } },
  // Data export DE-8a (migration 20261074). Objects sit at {user_id}/{job_id}/1.zip.
  { bucket: 'business-data-exports', level: 'purge', pathPrefix: '{user_id}/', purpose: 'Phase 1 "Download my data" zips, kept 3 days. Private, no policy (AC-36 pattern). Emptied by Purge and account deletion, kept by Reset like its jobs table.',
    export: { kind: 'exclude', reason: EXPORT_REASON.EXPORT_ITSELF } },
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

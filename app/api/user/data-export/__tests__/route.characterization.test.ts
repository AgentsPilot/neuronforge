/**
 * Characterization pin for GET /api/user/data-export
 * (DATA_EXPORT_REPOSITORY_REFACTOR_WORKPLAN.md §4.1, SA C-1 / C-2).
 *
 * Written against the route BEFORE its reads moved into repositories, and kept
 * unedited afterwards: the refactor must not change what the export reads, in
 * what order, on which client, or what it returns.
 *
 * - `@supabase/supabase-js` createClient is the service-role client (the route's
 *   own client before the move, the `supabaseServer` singleton after it). It
 *   records under `service:<table>`.
 * - `@supabase/ssr` createBrowserClient is the anon browser client (what
 *   `@/lib/supabaseClient` builds). It records under `anon:<table>`, so a read
 *   that lands on it fails the pin (C-1). createServerClient carries auth only.
 * - Only the route's own log lines are asserted, never the total log count: the
 *   repositories add their own error log on a failed read (C-2).
 * - The clock is frozen, so `export_date`, the duration and the file name are
 *   deterministic.
 *
 * Deliberately re-pinned by DATA_EXPORT_FOLLOWUPS_WORKPLAN.md (SA C-2): the
 * eight selects (FU-P1), the audit `created_at` filter and order (FU-1), the
 * plugin connection seed and mapping (NF-1, SA C-1) and the 500 body (FU-P2).
 *
 * Deliberately re-pinned AGAIN by DE-1 (BUSINESS_OS_DATA_EXPORT_DE1_WORKPLAN.md
 * §6.2, SA C-7). Every changed expectation carries a `DE-1:` comment:
 * - six tables leave the export (DX-1, BQ-SA-1) and are asserted NEVER read;
 * - the profile read is `.maybeSingle()` (Q-4) and no longer selects `plan` (Q-3);
 * - the body is the typed section model, `format_version: 2` (§3.3);
 * - a failed read is a `failed` section, not an empty one (FR-E12, AC-E9);
 * - the file name drops the user id and the old brand (Q-1);
 * - the audit entry goes through `logAndFlush` (WC-7).
 * Everything else (401, 500, headers other than the name, the anon-client
 * check, the token-free check) is unchanged.
 *
 * Deliberately re-pinned AGAIN by DE-4 (BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md
 * §8 C-1, SA C-1). Every changed expectation carries a `DE-4:` comment:
 * - ten tables are read, was two: + the eight client_records tables, each
 *   keyset-paged on `id` until an empty page, all on the service-role client;
 *   `external_calendar_events` is never read (user BC-5);
 * - the eight literal select strings, the paging calls and the
 *   contact_documents row filter are pinned;
 * - the body gains eight sections and the `client_records` group;
 * - the audit `section_counts` / `data_categories` gain eight keys;
 * - the mock gains a per-table result QUEUE (a paged reader would loop on a
 *   mock that resolves every call the same) and a hard call cap that fails the
 *   test instead of hanging (R-8).
 * The token-free check extends to the new sections (source_metadata tracking keys).
 *
 * Deliberately re-pinned AGAIN by the DE-4 user decisions of 2026-10-15
 * (BUSINESS_OS_DATA_EXPORT_DE4_WORKPLAN.md, "Post-review changes"). Every
 * changed expectation carries a `DE-4 (user 2026-10-15):` comment:
 * - connected apps left the export: `plugin_connections` is asserted NEVER
 *   read, its section, select, chain and mapping are gone, and the audit
 *   `section_counts` / `data_categories` lose the key. The seed still puts
 *   token-bearing rows in that table, raw and unprojected (this mock never
 *   honours `select`), so the token-free check stays as strong: if the table
 *   were ever read again, the tokens would be in the body;
 * - the file name is `agentpilot-data-export-YYYY-MM-DD-HHmm.json` on the
 *   owner's clock: one more read, `user_preferences.timezone`, after the
 *   sections; NULL, invalid or unreadable gives a UTC name and still a 200.
 *
 * Deliberately re-pinned AGAIN by DE-3 (BUSINESS_OS_DATA_EXPORT_DE3_WORKPLAN.md
 * §7 X-9 / X-11, SA C-2). Every changed expectation carries a `DE-3:` comment.
 * Insert-only for DE-4: the eight DE-4 selects, their order, their group and
 * role and the clients source_metadata reshaping are untouched.
 * - four account tables are read after `profiles` and before the DE-4 tables
 *   (user_preferences, notification_settings, business_profiles,
 *   business_addresses), each keyset-paged like a DE-4 table, all on the
 *   service-role client; their four literal select strings are pinned;
 * - the `profiles` select loses `hourly_rate_usd` and `org_id` (15 columns);
 * - the body gains four `account` sections; the audit `section_counts` /
 *   `data_categories` gain four keys;
 * - `user_preferences` is now read twice (the section, then the timezone),
 *   so the mock takes a paged table's queued page when the query is AWAITED
 *   and answers `maybeSingle` from `mockResults`, was: one queued page per
 *   `from()` whatever the terminal. Every DE-4 read is awaited, never
 *   `maybeSingle`, so the DE-4 tables see exactly what they saw before.
 *
 * Deliberately re-pinned AGAIN by DE-5 (BUSINESS_OS_DATA_EXPORT_DE5_WORKPLAN.md
 * §8 M-10, SA C-6 / C-7). Every changed expectation carries a `DE-5:` comment.
 * Insert-only for DE-3 / DE-4: the thirteen earlier selects (incl. `profiles`),
 * their chains, groups and the clients source_metadata reshaping are untouched.
 * - ten money tables are read, each keyset-paged like a DE-4 table, all on the
 *   service-role client: `stripe_connect_accounts` and `payment_processors`
 *   after the DE-3 tables (account), the eight client-money tables after the
 *   DE-4 tables; their ten literal select strings are pinned;
 * - the body gains ten sections; `payments.metadata` keeps `notes` and
 *   `source` only; the audit `section_counts` / `data_categories` gain ten keys;
 * - the five excluded money tables and the tables of money paid to AgentPilot
 *   are seeded (raw, unprojected) and asserted NEVER read (SA C-6 a).
 *
 * Deliberately re-pinned AGAIN by DE-6 (BUSINESS_OS_DATA_EXPORT_DE6_WORKPLAN.md
 * §8 N-12, SA C-7). Every changed expectation carries a `DE-6:` comment.
 * Insert-only for DE-1 … DE-5: the twenty-three earlier select strings are the
 * literals of origin/main 98735db9, untouched, as are their chains, groups and
 * order. The ONE deliberate change to earlier output is F-DE6-1 (TL
 * 2026-10-16): `clients.source_metadata` `capture_page_url` / `referrer_url`
 * lose their query string and fragment; its own test below seeds them.
 * - ten intake, email marketing and consent tables are read after the DE-5
 *   tables, all on the service-role client: nine keyset-paged like a DE-4
 *   table, `marketing_consent_settings` as ONE query (`.eq('user_id')
 *   .limit(2)`, SA-Q1); their ten literal select strings are pinned;
 * - the body gains ten `client_records` sections; consent `evidence` and
 *   subscriber `attribution` are allow-listed, page URLs cut at the query;
 *   the audit `section_counts` / `data_categories` gain ten keys;
 * - `lead_responses`, `marketing_consent_state` and `email_sends` are seeded
 *   raw and asserted NEVER read (N-7).
 */

import { NextRequest } from 'next/server';

type Call = [string, ...unknown[]];
type Result = { data: unknown; error: unknown };

/** Recorded calls per `<client>:<table>`, and the order the tables were read in. */
const mockCalls: Record<string, Call[]> = {};
const mockReadOrder: string[] = [];
/** What each table resolves to; set per test. */
const mockResults: Record<string, Result> = {};
/**
 * DE-4: what each successive query on a PAGED table resolves to, in order.
 * An exhausted queue answers an empty page, which ends the reader's loop.
 */
const mockQueues: Record<string, Result[]> = {};
const MOCK_PAGED_TABLES = new Set([
  // DE-3: the four account tables read through the same paged reader.
  'user_preferences', 'notification_settings', 'business_profiles', 'business_addresses',
  // DE-5: the ten money tables.
  'stripe_connect_accounts', 'payment_processors', 'proposals', 'payment_invoices', 'payment_transactions',
  'payment_refunds', 'payment_plans', 'payment_plan_subscriptions', 'payment_plan_installments', 'saved_payment_methods',
  'crm_pipeline_stages', 'crm_contacts', 'crm_activities', 'crm_tasks', 'contact_documents',
  'scheduling_services', 'scheduling_bookings', 'scheduling_availability_exceptions',
  // DE-6: the ten DE-6 tables (consent settings is awaited once, so it takes one queued result).
  'user_intake_settings', 'business_intake_forms', 'email_campaigns', 'email_sequences', 'email_sequence_steps',
  'email_sequence_enrollments', 'business_subscribers', 'marketing_consent_events', 'marketing_consent_settings',
  'email_unsubscribes',
]);
/** DE-4 (R-8): more queries than this means a reader is looping; fail, do not hang. */
const MOCK_CALL_CAP = 100;

const mockChainMethods = ['select', 'eq', 'neq', 'not', 'in', 'is', 'gte', 'gt', 'lte', 'lt', 'like', 'ilike', 'or', 'order', 'limit', 'range'];

function mockBuilder(client: string, table: string) {
  const key = `${client}:${table}`;
  if (mockReadOrder.length >= MOCK_CALL_CAP) throw new Error(`call cap reached on ${key}: a reader is looping`);
  mockReadOrder.push(key);
  const calls: Call[] = (mockCalls[key] = mockCalls[key] ?? []);
  // DE-4: a paged table takes the next queued page at query time.
  // DE-3: when the query is awaited (the keyset read), so a `maybeSingle` on the
  // same table (the timezone read on user_preferences) is answered from mockResults.
  const paged = (): Result => mockQueues[table]?.shift() ?? { data: [], error: null };
  const result = (): Result => mockResults[table] ?? { data: null, error: null };
  const builder: Record<string, unknown> = {};
  for (const method of mockChainMethods) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    };
  }
  for (const terminal of ['single', 'maybeSingle']) {
    builder[terminal] = () => {
      calls.push([terminal]);
      return Promise.resolve(result());
    };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve(MOCK_PAGED_TABLES.has(table) ? paged() : result()).then(resolve, reject);
  return builder;
}

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: (table: string) => mockBuilder('service', table) }),
}));

const mockGetUser = jest.fn();
jest.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser: () => mockGetUser() } }),
  createBrowserClient: () => ({ from: (table: string) => mockBuilder('anon', table) }),
}));
jest.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

// DE-1: the audit entry goes through logAndFlush (WC-7), was `auditLog` from AuditTrailService.
const mockLogAndFlush = jest.fn();
jest.mock('@/lib/audit/boundedAuditFlush', () => ({
  logAndFlush: (...args: unknown[]) => mockLogAndFlush(...args),
}));

const mockLogged: Array<{ level: string; fields: Record<string, unknown>; msg: string }> = [];
const mockChildBindings: Array<Record<string, unknown>> = [];
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['trace', 'debug', 'info', 'warn', 'error', 'fatal']) {
      logger[level] = (first: unknown, second?: unknown) => {
        const fields =
          typeof first === 'object' && first !== null
            ? JSON.parse(JSON.stringify(first, (_k, v) => (v instanceof Error ? { name: v.name, message: v.message } : v)))
            : {};
        mockLogged.push({ level, fields, msg: typeof first === 'string' ? first : String(second ?? '') });
      };
    }
    logger.child = (bindings: Record<string, unknown>) => {
      mockChildBindings.push(bindings);
      return logger;
    };
    return logger;
  };
  return { createLogger: () => make() };
});

import { GET } from '../route';

const NOW = '2026-07-15T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

const OWNER = { id: '2f734ed5-3681-4049-880d-3de7b096bea3', email: 'a@example.com', created_at: '2026-01-01T00:00:00Z' };

// DE-1: two tables, was eight (profiles, agents, agent_executions,
// agent_configurations, plugin_connections, user_subscriptions,
// credit_transactions, audit_trail).
// DE-4 (user 2026-10-15): one, was ['profiles', 'plugin_connections'].
const ACCOUNT_TABLES = ['profiles'] as const;
// DE-3: the four account tables read through the paged reader, after profiles (section in the comment).
const DE3_TABLES = [
  'user_preferences', // preferences
  'notification_settings', // notification_settings
  'business_profiles', // business_profile
  'business_addresses', // business_addresses
] as const;
// DE-4: + the eight client_records tables, in registry order (section in the comment).
const DE4_TABLES = [
  'crm_pipeline_stages', // pipeline_stages
  'crm_contacts', // clients
  'crm_activities', // client_activities
  'crm_tasks', // client_tasks
  'contact_documents', // client_documents
  'scheduling_services', // services
  'scheduling_bookings', // bookings
  'scheduling_availability_exceptions', // time_off
] as const;
// DE-5: the two account money tables, after the DE-3 tables (section in the comment).
const DE5_ACCOUNT_TABLES = [
  'stripe_connect_accounts', // payment_account
  'payment_processors', // payment_providers
] as const;
// DE-5: the eight client-money tables, after the DE-4 tables, in registry order.
const DE5_TABLES = [
  'proposals', // quotes
  'payment_invoices', // invoices
  'payment_transactions', // payments
  'payment_refunds', // refunds
  'payment_plans', // payment_plans
  'payment_plan_subscriptions', // client_payment_plans
  'payment_plan_installments', // installments
  'saved_payment_methods', // client_payment_methods
] as const;
// DE-6: the ten intake, email marketing and consent tables, after the DE-5 tables, in registry order.
const DE6_TABLES = [
  'user_intake_settings', // intake_settings
  'business_intake_forms', // intake_forms
  'email_campaigns', // email_campaigns
  'email_sequences', // email_sequences
  'email_sequence_steps', // email_sequence_steps
  'email_sequence_enrollments', // email_sequence_enrollments
  'business_subscribers', // newsletter_subscribers
  'marketing_consent_events', // consent_records
  'marketing_consent_settings', // consent_settings (one row, SA-Q1)
  'email_unsubscribes', // email_unsubscribes
] as const;
// DE-3: + DE3_TABLES after the account table. DE-5: + DE5_ACCOUNT_TABLES, + DE5_TABLES. DE-6: + DE6_TABLES.
const TABLES = [...ACCOUNT_TABLES, ...DE3_TABLES, ...DE5_ACCOUNT_TABLES, ...DE4_TABLES, ...DE5_TABLES, ...DE6_TABLES] as const;
type Table = (typeof TABLES)[number];
/** DE-6: every DE-6 table; the single-row one is not keyset paged. */
type De6Table = (typeof DE6_TABLES)[number];
type De6PagedTable = Exclude<De6Table, 'marketing_consent_settings'>;
const DE6_PAGED_TABLES = DE6_TABLES.filter((t): t is De6PagedTable => t !== 'marketing_consent_settings');
type De4Table = (typeof DE4_TABLES)[number];
type De3Table = (typeof DE3_TABLES)[number];
/** DE-5: every money table. */
type De5Table = (typeof DE5_ACCOUNT_TABLES)[number] | (typeof DE5_TABLES)[number];
/** DE-3: every table read through the paged reader. DE-5: + De5Table. DE-6: + the nine paged DE-6 tables. */
type PagedTable = De3Table | De4Table | De5Table | De6PagedTable;

const DE3_SECTION: Record<De3Table, string> = {
  user_preferences: 'preferences',
  notification_settings: 'notification_settings',
  business_profiles: 'business_profile',
  business_addresses: 'business_addresses',
};

const DE4_SECTION: Record<De4Table, string> = {
  crm_pipeline_stages: 'pipeline_stages',
  crm_contacts: 'clients',
  crm_activities: 'client_activities',
  crm_tasks: 'client_tasks',
  contact_documents: 'client_documents',
  scheduling_services: 'services',
  scheduling_bookings: 'bookings',
  scheduling_availability_exceptions: 'time_off',
};

// DE-5: the section each money table backs.
const DE5_SECTION: Record<De5Table, string> = {
  stripe_connect_accounts: 'payment_account',
  payment_processors: 'payment_providers',
  proposals: 'quotes',
  payment_invoices: 'invoices',
  payment_transactions: 'payments',
  payment_refunds: 'refunds',
  payment_plans: 'payment_plans',
  payment_plan_subscriptions: 'client_payment_plans',
  payment_plan_installments: 'installments',
  saved_payment_methods: 'client_payment_methods',
};
const DE5_ALL_TABLES: readonly De5Table[] = [...DE5_ACCOUNT_TABLES, ...DE5_TABLES];

// DE-6: the section each DE-6 table backs.
const DE6_SECTION: Record<De6Table, string> = {
  user_intake_settings: 'intake_settings',
  business_intake_forms: 'intake_forms',
  email_campaigns: 'email_campaigns',
  email_sequences: 'email_sequences',
  email_sequence_steps: 'email_sequence_steps',
  email_sequence_enrollments: 'email_sequence_enrollments',
  business_subscribers: 'newsletter_subscribers',
  marketing_consent_events: 'consent_records',
  marketing_consent_settings: 'consent_settings',
  email_unsubscribes: 'email_unsubscribes',
};

// DE-1 (new, required by SA C-7): the six tables that left the export are never read.
// DE-4: + external_calendar_events (user BC-5: the synced calendar copy is not exported).
// DE-4 (user 2026-10-15): + plugin_connections (connected apps are not exported).
// DE-5: + the five excluded money tables (activity, built-in, dead; user BC-4 … BC-6) and,
// SA C-6 (a), the tables of money paid to AgentPilot, seeded raw so a read would show.
// SA F-1 (2026-10-16): `subscriptions` is not a live table, so it is not listed.
const MONEY_TO_US_TABLES = [
  'billing_events', 'boost_pack_purchases', 'user_subscriptions', 'credit_transactions', 'subscription_invoices',
  'business_os_account_plans',
  'business_os_billing_accounts', 'business_os_billing_events', 'business_os_credit_charges', 'business_os_credit_totals',
  'business_os_credit_lots', 'business_os_credit_lot_draws', 'business_os_boost_purchases',
] as const;
const EXCLUDED_MONEY_TABLES = [
  'payment_events', 'payment_reminders', 'payment_automation_rules', 'payment_automation_executions', 'payment_methods',
] as const;
// DE-6 (N-7): the lead-message queue and the derived consent projection are
// excluded (TL defaults BC-2 / BC-6), and email_sends is activity; seeded raw.
const EXCLUDED_DE6_TABLES = ['lead_responses', 'marketing_consent_state', 'email_sends'] as const;
const REMOVED_TABLES = [
  'agents', 'agent_executions', 'agent_configurations', 'audit_trail',
  'external_calendar_events', 'plugin_connections',
  ...EXCLUDED_MONEY_TABLES,
  ...MONEY_TO_US_TABLES,
  // DE-6.
  ...EXCLUDED_DE6_TABLES,
] as const;

// DE-4 (user 2026-10-15, new): the owner's clock for the file name, read after the sections.
const PREFERENCES_CHAIN: Call[] = [['select', 'timezone'], ['eq', 'user_id', OWNER.id], ['maybeSingle']];
/** NOW (12:00Z, 15 July) as the file name carries it in UTC. */
const UTC_FILE_NAME = 'attachment; filename="agentpilot-data-export-2026-07-15-1200.json"';

// DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-P1 (intended change): every read names
// its columns instead of `*`. Written out literally so a list change is a
// visible diff here.
const SELECTS: Record<Table, string> = {
  // DE-1 (SA Q-3 / C-1): `plan` removed (DX-1a: no plan or billing data); was
  // 'id, full_name, avatar_url, plan, company, …'.
  // DE-3 (§3.1): `hourly_rate_usd` and `org_id` removed (user BC-A / DE-2 BC-2); `role` kept.
  profiles:
    'id, full_name, avatar_url, company, job_title, timezone, language, created_at, updated_at, ' +
    'role, domain, onboarding, onboarding_goal, onboarding_mode, onboarding_data',
  // DE-3 (new): the four account selects, from the descriptors (SA final lists), byte for byte.
  user_preferences:
    'id, preferred_language, timezone, timezone_confirmed_at, preferred_currency, theme, sidebar_collapsed, ' +
    'compact_mode, show_timestamps, enable_sounds, keyboard_shortcuts, data_retention_days, analytics_enabled, ' +
    'telemetry_enabled, created_at, updated_at',
  notification_settings:
    'id, email_enabled, email_frequency, email_system_alerts, email_security_alerts, email_marketing, ' +
    'push_enabled, push_system_alerts, push_mentions, desktop_enabled, desktop_system_alerts, inapp_enabled, ' +
    'inapp_sounds, inapp_popups, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, quiet_hours_timezone, ' +
    'created_at, updated_at',
  business_profiles:
    'id, vertical, sub_vertical, company_name, company_size, clients_per_week, revenue_tier, description, services, ' +
    'pain_points, goals, tools, payment_mode, online_presence_mode, primary_crm, primary_calendar, primary_payment, ' +
    'phone, email, address, address_parts, address_id, invoice_address_id, ' +
    'website_url, landing_pages, logo_url, show_logo_on_smart_links, theme, template_id, subdomain, user_code, ' +
    'scheduling_availability, process_steps, language, currency, ' +
    'invoice_company_name, invoice_address, invoice_tax_id, invoice_footer_text, invoice_number_prefix, ' +
    'invoice_document_type, invoice_prices_include_tax, invoice_tax_rate, invoice_tax_label, invoice_payment_terms_days, ' +
    'collection_method, default_payment_processor, payment_retry_enabled, payment_retry_intervals, payment_max_retries, ' +
    'payment_reminder_enabled, payment_reminder_days_before, payment_overdue_reminder_days, payment_reminder_channels, ' +
    'daily_briefing_email_enabled, lead_alert_email_enabled, lead_autosend_enabled, chase_invoices_enabled, ' +
    'chase_intake_enabled, chase_quotes_enabled, automations_declined, meeting_reminder_enabled, ' +
    'meeting_reminder_hours_before, meeting_reminder_notify_client, meeting_reminder_notify_owner, ' +
    'auto_complete_meetings_enabled, created_at, updated_at',
  business_addresses: 'id, label, parts, is_default, created_at, updated_at',
  // DE-4 (user 2026-10-15): the plugin_connections select is gone (the table is never read).
  // DE-4 (new): the eight client_records selects, from the descriptors (workplan §3), byte for byte.
  crm_pipeline_stages: 'id, vertical, stage_key, stage_label, position, color, stage_type, is_primary_client_stage, created_at',
  crm_contacts:
    'id, first_name, last_name, email, phone, stage, stage_entered_at, tags, custom_fields, notes, ' +
    'source, source_metadata, referrer_domain, utm_source, utm_medium, utm_campaign, created_at, updated_at',
  crm_activities:
    'id, contact_id, activity_type, title, description, activity_date, auto_logged, source_capability, source_entity_id, created_at',
  crm_tasks:
    'id, contact_id, title, description, priority, status, due_date, reminder_at, completed_at, ' +
    'created_by, source_entity_type, source_entity_id, tags, created_at, updated_at',
  contact_documents:
    'id, contact_id, name, document_type, file_name, file_size, mime_type, description, tags, status, created_at, updated_at',
  scheduling_services:
    'id, service_name, description, duration_minutes, price, currency, buffer_minutes, max_bookings_per_day, ' +
    'advance_booking_days, min_notice_hours, availability, is_active, status, is_scheduled, collection, ' +
    'sale_mode, payment_type, installment_count, installment_frequency, first_payment_due, first_payment_days, ' +
    'source, created_at, updated_at',
  scheduling_bookings:
    'id, service_id, contact_id, parent_booking_id, occurrence_number, start_time, end_time, timezone, ' +
    'status, cancellation_reason, cancel_reason, cancel_note, cancelled_by, booking_source, notes, ' +
    'internal_notes, payment_status, payment_method, payment_amount, payment_currency, payment_id, invoice_id, ' +
    'payment_plan_id, intake_responses, intake_completed_at, created_at, updated_at',
  scheduling_availability_exceptions: 'id, exception_type, start_date, end_date, custom_hours, reason, created_at',
  // DE-5 (new): the ten money selects, from the descriptors (SA C-2), byte for byte.
  stripe_connect_accounts:
    'id, stripe_account_id, stripe_account_type, charges_enabled, payouts_enabled, details_submitted, ' +
    'onboarding_completed, country, currency, business_type, stripe_email, created_at, updated_at',
  payment_processors:
    'id, processor_type, is_active, is_default, connection_status, last_verified_at, created_at, ' +
    'updated_at',
  proposals:
    'id, contact_id, service_id, booking_id, package_booking_id, document_id, supersedes_id, ' +
    'created_invoice_id, created_plan_id, title, description, currency, total, prices_include_tax, ' +
    'tax_rate, tax_label, payment_shape, payment_terms_days, sessions, status, valid_until, ' +
    'decline_reason, decline_note, stop_reason, stop_note, accepted_snapshot, sent_at, viewed_at, ' +
    'decided_at, stopped_at, created_at, updated_at',
  payment_invoices:
    'id, contact_id, booking_id, service_id, invoice_number, amount, currency, status, line_items, ' +
    'due_date, payment_terms, notes, internal_notes, sent_at, paid_at, payment_method, ' +
    'payment_received_at, payment_notes, processor_type, processor_checkout_id, processor_payment_id, ' +
    'processor_customer_id, processor_payment_method_id, stripe_invoice_id, stripe_hosted_invoice_url, ' +
    'stripe_invoice_pdf, client_name, client_email, client_address, refunded_amount, refund_status, ' +
    'refunded_at, allow_online_payment, created_at, updated_at',
  payment_transactions:
    'id, contact_id, invoice_id, booking_id, service_id, amount, currency, status, payment_method, ' +
    'description, metadata, failure_reason, paid_at, refund_status, refunded_amount, refunded_at, ' +
    'refund_reason, processor_type, processor_refund_id, processor_fee, net_amount, fee_currency, ' +
    'stripe_payment_intent_id, stripe_charge_id, stripe_customer_id, stripe_connect_account_id, ' +
    'created_at, updated_at',
  payment_refunds:
    'id, transaction_id, invoice_id, amount, amount_minor, currency, status, reason, reason_note, ' +
    'processor_type, processor_refund_id, stripe_connect_account_id, source, failure_code, ' +
    'failure_message, fee_returned, refund_fee, created_at, updated_at, succeeded_at',
  payment_plans:
    'id, service_id, name, description, total_amount, currency, supported_currencies, installment_count, ' +
    'installment_amount, installment_frequency, allowed_processors, preferred_processor, is_active, ' +
    'created_at, updated_at',
  payment_plan_subscriptions:
    'id, contact_id, booking_id, service_id, payment_plan_id, stripe_subscription_id, stripe_schedule_id, ' +
    'stripe_price_id, stripe_customer_id, stripe_connect_account_id, installment_count, ' +
    'installment_amount, currency, frequency, periods_paid, status, next_charge_at, next_charge_amount, ' +
    'last_failure_code, last_failure_at, card_brand, card_last4, cancel_reason, cancel_note, cancelled_by, ' +
    'created_at, updated_at, completed_at, cancelled_at',
  payment_plan_installments:
    'id, payment_plan_id, subscription_id, booking_id, contact_id, proposal_id, invoice_id, ' +
    'transaction_id, installment_number, label, trigger, amount, currency, due_date, status, paid_at, ' +
    'payment_method, processor_type, stripe_invoice_id, completed_at, cancel_reason, cancel_note, ' +
    'cancelled_by, cancelled_at, created_at, updated_at',
  saved_payment_methods:
    'id, contact_id, processor_type, processor_customer_id, processor_method_id, method_type, brand, ' +
    'last_four, is_default, is_valid, created_at, updated_at',
  // DE-6 (new): the ten intake, email marketing and consent selects, from the descriptors (SA review DE-6), byte for byte.
  user_intake_settings: 'id, is_enabled, send_after_booking, created_at, updated_at',
  business_intake_forms: 'id, version, status, questions, generated_at, published_at, created_at, updated_at',
  email_campaigns:
    'id, name, subject, body_html, body_text, segment_filter, status, scheduled_at, sent_at, created_at, ' +
    'updated_at',
  email_sequences: 'id, name, description, trigger_type, trigger_config, is_active, created_at, updated_at',
  email_sequence_steps: 'id, sequence_id, step_number, delay_minutes, subject, body_html, body_text, created_at',
  email_sequence_enrollments: 'id, sequence_id, contact_id, status, current_step_number, enrolled_at, completed_at',
  business_subscribers:
    'id, email, name, status, source, attribution, subscribed_at, confirmed_at, promoted_contact_id, ' +
    'promoted_at, created_at, updated_at',
  marketing_consent_events:
    'id, contact_id, email, channel, purpose, decision, method, statement_text, statement_locale, ' +
    'statement_version, privacy_policy_url, source_surface, source_page_url, evidence, redacted_at, ' +
    'occurred_at, created_at',
  marketing_consent_settings:
    'capture_enabled, statement_en, statement_es, statement_he, statement_version, privacy_policy_mode, ' +
    'privacy_policy_url, privacy_policy_body, privacy_policy_updated_at, postal_address, label_as_advertisement, ' +
    'created_at, updated_at',
  email_unsubscribes: 'id, contact_id, email, reason, unsubscribed_at',
};

// DE-4: one row per client_records table (two clients), ids in ascending order.
const id = (n: number) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`;
const DE4_ROWS: Record<De4Table, Array<Record<string, unknown>>> = {
  crm_pipeline_stages: [{ id: id(1), stage_key: 'lead', stage_label: 'Lead', position: 0 }],
  crm_contacts: [
    {
      id: id(2),
      first_name: 'Dana',
      // DE-4: the tracking keys are the token-free check's new case (BC-4).
      source_metadata: { capture_channel: 'website', ip_hash: 'never-exported-ip-hash', user_agent: 'never-exported-ua', session_id: 'never-exported-session' },
    },
    { id: id(3), first_name: 'Noa', source_metadata: null },
  ],
  crm_activities: [{ id: id(4), contact_id: id(2), activity_type: 'note', title: 'Called' }],
  crm_tasks: [{ id: id(5), contact_id: id(2), title: 'Follow up', status: 'cancelled' }],
  contact_documents: [{ id: id(6), contact_id: id(2), name: 'Intake form', status: 'archived' }],
  scheduling_services: [{ id: id(7), service_name: 'Session', price: 100, currency: 'ILS', status: 'draft' }],
  scheduling_bookings: [{ id: id(8), service_id: id(7), contact_id: id(2), status: 'no_show', internal_notes: 'private' }],
  scheduling_availability_exceptions: [{ id: id(9), exception_type: 'blocked', reason: 'holiday' }],
};
// DE-3: one row per account table read through the paged reader, ids after the DE-4 ones.
const DE3_ROWS: Record<De3Table, Array<Record<string, unknown>>> = {
  user_preferences: [{ id: id(21), preferred_language: 'he', timezone: 'Asia/Jerusalem' }],
  notification_settings: [{ id: id(22), email_enabled: true, quiet_hours_timezone: 'Asia/Jerusalem' }],
  business_profiles: [{ id: id(23), company_name: 'Acme Studio', address_id: id(24), invoice_tax_id: '515151515' }],
  business_addresses: [{ id: id(24), label: 'Studio', parts: { city: 'Tel Aviv', country: 'IL' }, is_default: true }],
};
// DE-5: one row per money table (incl. a failed payment, a positive refund, a
// cancelled instalment), ids after the DE-3 ones. As this mock never honours
// `select`, payments.metadata is seeded raw and must leave with notes / source only.
const DE5_ROWS: Record<De5Table, Array<Record<string, unknown>>> = {
  stripe_connect_accounts: [{ id: id(31), stripe_account_id: 'acct_owner', currency: 'usd', charges_enabled: true }],
  payment_processors: [{ id: id(32), processor_type: 'stripe', connection_status: 'connected', is_active: true }],
  proposals: [{ id: id(33), contact_id: id(2), title: 'Package', currency: 'ILS', total: 1200, status: 'superseded' }],
  payment_invoices: [{ id: id(34), contact_id: id(2), amount: 350, currency: 'USD', status: 'cancelled', stripe_invoice_pdf: 'https://pay.example/pdf' }],
  payment_transactions: [
    {
      id: id(35),
      contact_id: id(2),
      amount: 200,
      currency: 'ILS',
      status: 'failed',
      processor_fee: 1.75,
      fee_currency: 'USD',
      metadata: { notes: 'cash at the desk', source: 'manual_mark_paid', checkout_session_id: 'never-exported-checkout', connect_account_id: 'never-exported-acct' },
    },
  ],
  payment_refunds: [{ id: id(36), transaction_id: id(35), amount: 50, currency: 'ILS', status: 'succeeded', fee_returned: 0.5 }],
  payment_plans: [{ id: id(37), name: 'Three payments', total_amount: 900, currency: 'ILS', is_active: false }],
  payment_plan_subscriptions: [{ id: id(38), payment_plan_id: id(37), installment_amount: 300, currency: 'ILS', status: 'completed', card_last4: '4242' }],
  payment_plan_installments: [{ id: id(39), subscription_id: id(38), amount: 300, currency: 'ILS', status: 'cancelled' }],
  saved_payment_methods: [{ id: id(40), contact_id: id(2), brand: 'visa', last_four: '4242', is_valid: false }],
};
// DE-5: what the payments section writes: metadata allow-listed in place.
const MAPPED_DE5_ROWS: Record<De5Table, Array<Record<string, unknown>>> = {
  ...DE5_ROWS,
  payment_transactions: [
    { ...DE5_ROWS.payment_transactions[0], metadata: { notes: 'cash at the desk', source: 'manual_mark_paid' } },
  ],
};
// DE-6: one row per DE-6 table (a draft form, a withdrawn and an owner-entered consent, a
// pending subscriber), ids after the DE-5 ones. The tracking values and the token-like
// query strings are seeded raw (this mock never honours `select`) and must not leave.
const DE6_ROWS: Record<De6Table, Array<Record<string, unknown>>> = {
  user_intake_settings: [{ id: id(51), is_enabled: true, send_after_booking: true }],
  business_intake_forms: [{ id: id(52), version: 2, status: 'draft', questions: [{ id: 'q1', label: 'Goals?', type: 'long_text', required: true }] }],
  email_campaigns: [{ id: id(53), name: 'Spring', subject: 'Hello', status: 'sent', segment_filter: { tags: ['vip'] } }],
  email_sequences: [{ id: id(54), name: 'Welcome', trigger_type: 'tag_added', trigger_config: { tag: 'new' }, is_active: false }],
  email_sequence_steps: [{ id: id(55), sequence_id: id(54), step_number: 1, delay_minutes: 60, subject: 'Day one' }],
  email_sequence_enrollments: [{ id: id(56), sequence_id: id(54), contact_id: id(2), status: 'cancelled' }],
  business_subscribers: [
    {
      id: id(57),
      email: 'lee@example.com',
      status: 'pending',
      attribution: {
        capture_page_url: 'https://biz.test/join?code=never-exported-code#frag',
        capture_channel: 'website',
        ip_hash: 'never-exported-sub-ip-hash',
        user_agent: 'never-exported-sub-ua',
        session_id: 'never-exported-sub-session',
      },
    },
  ],
  marketing_consent_events: [
    {
      id: id(58),
      email: 'dana@example.com',
      decision: 'withdrawn',
      method: 'owner_entered',
      privacy_policy_url: 'https://biz.test/privacy',
      source_page_url: 'https://biz.test/p?token=never-exported-token&sid=never-exported-sid#frag',
      evidence: { note: 'asked by phone', client_statement: 'No more emails', ip: 'never-exported-evidence-ip' },
    },
  ],
  marketing_consent_settings: [{ capture_enabled: true, statement_en: 'Email me offers', privacy_policy_mode: 'hosted' }],
  email_unsubscribes: [{ id: id(59), contact_id: id(2), email: 'dana@example.com', reason: 'unsubscribe_link' }],
};
// DE-6: what the two reshaped DE-6 sections write (key order kept).
const MAPPED_DE6_ROWS: Record<De6Table, Array<Record<string, unknown>>> = {
  ...DE6_ROWS,
  business_subscribers: [
    { ...DE6_ROWS.business_subscribers[0], attribution: { capture_page_url: 'https://biz.test/join', capture_channel: 'website' } },
  ],
  marketing_consent_events: [
    {
      ...DE6_ROWS.marketing_consent_events[0],
      source_page_url: 'https://biz.test/p',
      evidence: { client_statement: 'No more emails', note: 'asked by phone' },
    },
  ],
};
/** DE-3: the rows of every paged table, for its last id. DE-5: + DE5_ROWS. DE-6: + the nine paged DE-6 tables. */
const PAGED_ROWS: Record<PagedTable, Array<Record<string, unknown>>> = { ...DE3_ROWS, ...DE4_ROWS, ...DE5_ROWS, ...DE6_ROWS };

// DE-4: what the clients section writes: source_metadata allow-listed in place.
const MAPPED_DE4_ROWS: Record<De4Table, Array<Record<string, unknown>>> = {
  ...DE4_ROWS,
  crm_contacts: [
    { id: id(2), first_name: 'Dana', source_metadata: { capture_channel: 'website' } },
    { id: id(3), first_name: 'Noa', source_metadata: {} },
  ],
};

/** DE-4: one keyset page query on a client_records table. DE-3: or on a DE-3 account table. */
function pageQuery(table: PagedTable, after: string | null): Call[] {
  return [
    ['select', SELECTS[table]],
    ['eq', 'user_id', OWNER.id],
    // DE-4: deleted documents are left out (BC-3), the value quoted (SA C-6).
    ...(table === 'contact_documents' ? ([['not', 'status', 'in', '("deleted")']] as Call[]) : []),
    ...(after === null ? [] : ([['gt', 'id', after]] as Call[])),
    ['order', 'id', { ascending: true }],
    ['limit', 1000],
  ];
}

// DE-3: over every paged table, was DE4_ROWS only.
const lastId = (table: PagedTable) => String(PAGED_ROWS[table][PAGED_ROWS[table].length - 1].id);

const EXPECTED_CHAINS: Record<Table, Call[]> = {
  // DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-P1: every ['select', SELECTS.x] below was ['select', '*'].
  // DE-1 (SA Q-4): ['maybeSingle'], was ['single'].
  profiles: [['select', SELECTS.profiles], ['eq', 'id', OWNER.id], ['maybeSingle']],
  // DE-3 (new): a data page, then the empty page; user_preferences then gets the timezone read.
  ...(Object.fromEntries(DE3_TABLES.map((t) => [t, [...pageQuery(t, null), ...pageQuery(t, lastId(t))]])) as Record<De3Table, Call[]>),
  user_preferences: [...pageQuery('user_preferences', null), ...pageQuery('user_preferences', lastId('user_preferences')), ...PREFERENCES_CHAIN],
  // DE-4 (user 2026-10-15): the plugin_connections chain is gone; REMOVED_TABLES pins it unread.
  // DE-4 (new): a data page, then the empty page after its last id that ends the read.
  ...(Object.fromEntries(DE4_TABLES.map((t) => [t, [...pageQuery(t, null), ...pageQuery(t, lastId(t))]])) as Record<De4Table, Call[]>),
  // DE-5 (new): a data page, then the empty page, on every money table.
  ...(Object.fromEntries(DE5_ALL_TABLES.map((t) => [t, [...pageQuery(t, null), ...pageQuery(t, lastId(t))]])) as Record<De5Table, Call[]>),
  // DE-6 (new): a data page, then the empty page, on the nine paged tables.
  ...(Object.fromEntries(DE6_PAGED_TABLES.map((t) => [t, [...pageQuery(t, null), ...pageQuery(t, lastId(t))]])) as Record<De6PagedTable, Call[]>),
  // DE-6 (new, SA-Q1): the single-row read. One query: the tenant filter, limit 2; no order, no gt.
  marketing_consent_settings: [['select', SELECTS.marketing_consent_settings], ['eq', 'user_id', OWNER.id], ['limit', 2]],
};

const PROFILE = { id: OWNER.id, full_name: 'Ada Owner', company: 'Acme' };
// DATA_EXPORT_FOLLOWUPS_WORKPLAN.md NF-1 / SA C-1 (intended change): the seed
// carries the newly read columns instead of the non-existent `metadata`, and a
// `profile_data` holding a token, a provider id and a nested object.
// DE-4 (user 2026-10-15): still seeded, raw, though the table is never read:
// a read would put every `never-exported` string in the body. + refresh_token,
// credentials and settings.
const CONNECTIONS = [
  {
    user_id: OWNER.id,
    plugin_key: 'google-mail',
    plugin_name: 'Gmail',
    username: 'Ada Owner',
    email: 'a@example.com',
    scope: 'gmail.readonly',
    status: 'active',
    connected_at: '2026-01-31T00:00:00Z',
    created_at: '2026-02-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    last_used: '2026-03-05T00:00:00Z',
    disconnected_at: null,
    profile_data: { name: 'Ada Owner', sub: 'provider-id-1', token: 'never-exported-profile-token', address: { city: 'X' } },
    access_token: 'never-exported',
    refresh_token: 'never-exported-refresh',
    credentials: { api_key: 'never-exported-credentials' },
    settings: { webhook_secret: 'never-exported-settings' },
  },
  {
    user_id: OWNER.id,
    plugin_key: 'slack',
    plugin_name: null,
    username: null,
    email: null,
    scope: null,
    status: 'disconnected',
    connected_at: null,
    created_at: '2026-02-02T00:00:00Z',
    updated_at: '2026-03-02T00:00:00Z',
    last_used: null,
    disconnected_at: '2026-03-02T00:00:00Z',
    profile_data: null,
  },
];

const POSTGREST_ERROR = { message: 'boom', code: 'XX000', details: null, hint: null };

function seed(): void {
  mockResults.profiles = { data: PROFILE, error: null };
  // DE-4 (user 2026-10-15): seeded with tokens so a read of it would leak; it must never be read.
  mockResults.plugin_connections = { data: CONNECTIONS, error: null };
  // DE-4: one data page per client_records table; the empty page follows.
  for (const t of DE4_TABLES) mockQueues[t] = [{ data: DE4_ROWS[t], error: null }];
  // DE-3: and per DE-3 account table.
  for (const t of DE3_TABLES) mockQueues[t] = [{ data: DE3_ROWS[t], error: null }];
  // DE-5: and per money table.
  for (const t of DE5_ALL_TABLES) mockQueues[t] = [{ data: DE5_ROWS[t], error: null }];
  // DE-5 (SA C-6 a): the excluded money tables and money paid to us hold rows; a read would leak them.
  for (const t of [...EXCLUDED_MONEY_TABLES, ...MONEY_TO_US_TABLES]) {
    mockResults[t] = { data: [{ user_id: OWNER.id, amount: 999, currency: 'USD', note: `never-exported-${t}` }], error: null };
  }
  // DE-6: one data result per DE-6 table (the paged ones then read an empty page).
  for (const t of DE6_TABLES) mockQueues[t] = [{ data: DE6_ROWS[t], error: null }];
  // DE-6 (N-7): the excluded tables hold rows; a read would leak them.
  for (const t of EXCLUDED_DE6_TABLES) mockResults[t] = { data: [{ user_id: OWNER.id, note: `never-exported-${t}` }], error: null };
}

// DE-4 (user 2026-10-15): MAPPED_CONNECTIONS is gone with the section.
type SectionRows = unknown[] | 'failed';

/** One section as the route writes it. DE-4: the client_records sections are group client_records, processor. */
function section(id: string, rows: SectionRows): Record<string, unknown> {
  // DE-5: + the eight client-money sections.
  // DE-6: + the ten DE-6 sections.
  const isRecord =
    Object.values(DE4_SECTION).includes(id) || DE5_TABLES.some((t) => DE5_SECTION[t] === id) || Object.values(DE6_SECTION).includes(id);
  const group = isRecord ? 'client_records' : 'account';
  const gdpr_role = isRecord ? 'processor' : 'controller';
  return rows === 'failed'
    ? { id, group, gdpr_role, status: 'failed', row_count: 0, rows: [] }
    : { id, group, gdpr_role, status: 'ok', row_count: rows.length, rows };
}

/**
 * The export body the route builds, in the route's key order.
 *
 * DE-1: the typed section model (format_version 2), was the 2025 shape with
 * top-level user_profile (auth fields spread under the profile row), agents,
 * agent_executions, agent_configurations, plugin_connections, subscriptions,
 * transactions, audit_logs and a total_* summary; `data_controller:
 * 'NeuronForge'` is now `provider: 'AgentPilot'` plus a per-group controller.
 */
// DE-4: + `records`, the eight client_records sections by table (default: the mapped seed).
// DE-4 (user 2026-10-15): `connections` removed.
// DE-3: + `details`, the four account sections read from tables (default: the seed).
type BodyParts = {
  profile: SectionRows;
  records?: Partial<Record<De4Table, SectionRows>>;
  details?: Partial<Record<De3Table, SectionRows>>;
  // DE-5: the ten money sections by table (default: the mapped seed).
  money?: Partial<Record<De5Table, SectionRows>>;
  // DE-6: the ten DE-6 sections by table (default: the mapped seed).
  intake?: Partial<Record<De6Table, SectionRows>>;
};

function expectedBody(parts: BodyParts): Record<string, unknown> {
  const sections = [
    section('account_identity', [{ id: OWNER.id, email: OWNER.email, created_at: OWNER.created_at }]),
    section('user_profile', parts.profile),
    // DE-3: the four account sections, after user_profile.
    ...DE3_TABLES.map((t) => section(DE3_SECTION[t], parts.details?.[t] ?? DE3_ROWS[t])),
    // DE-5: the two account money sections, after the DE-3 ones.
    ...DE5_ACCOUNT_TABLES.map((t) => section(DE5_SECTION[t], parts.money?.[t] ?? MAPPED_DE5_ROWS[t])),
    // DE-4 (user 2026-10-15): no plugin_connections section.
    ...DE4_TABLES.map((t) => section(DE4_SECTION[t], parts.records?.[t] ?? MAPPED_DE4_ROWS[t])),
    // DE-5: the eight client-money sections, after the DE-4 ones.
    ...DE5_TABLES.map((t) => section(DE5_SECTION[t], parts.money?.[t] ?? MAPPED_DE5_ROWS[t])),
    // DE-6: the ten intake, email marketing and consent sections, after the DE-5 ones.
    ...DE6_TABLES.map((t) => section(DE6_SECTION[t], parts.intake?.[t] ?? MAPPED_DE6_ROWS[t])),
  ];
  const head = {
    export_metadata: {
      format_version: 2,
      user_id: OWNER.id,
      export_date: NOW,
      export_format: 'JSON',
      gdpr_article: 'Article 15 (Right to Access) & Article 20 (Data Portability)',
      provider: 'AgentPilot',
      groups: {
        account: {
          gdpr_role: 'controller',
          controller: 'AgentPilot',
          description: 'Your own account details. AgentPilot is the controller of this data.',
        },
        // DE-4 (new, SA-Q13).
        client_records: {
          gdpr_role: 'processor',
          controller: 'account_holder',
          description:
            'Records you keep about your clients. You, the account holder, are the controller of these records. AgentPilot keeps them on your behalf, as its processor.',
        },
      },
    },
    sections,
  };
  return {
    ...head,
    summary: {
      section_counts: Object.fromEntries(sections.map((s) => [s.id, s.row_count])),
      failed_sections: sections.filter((s) => s.status === 'failed').map((s) => s.id),
      export_size_kb: Math.round(JSON.stringify(head).length / 1024),
      export_duration_ms: 0,
    },
  };
}

// DE-4 (user 2026-10-15): no `connections`.
const FULL: BodyParts = { profile: [PROFILE] };

// DE-4: the row count of each client_records section for the seed.
const DE4_COUNTS = Object.fromEntries(DE4_TABLES.map((t) => [DE4_SECTION[t], DE4_ROWS[t].length]));
// DE-3: the row count of each DE-3 account section for the seed.
const DE3_COUNTS = Object.fromEntries(DE3_TABLES.map((t) => [DE3_SECTION[t], DE3_ROWS[t].length]));
// DE-5: the row count of each money section for the seed, in registry order (account two first).
const DE5_ACCOUNT_COUNTS = Object.fromEntries(DE5_ACCOUNT_TABLES.map((t) => [DE5_SECTION[t], DE5_ROWS[t].length]));
const DE5_COUNTS = Object.fromEntries(DE5_TABLES.map((t) => [DE5_SECTION[t], DE5_ROWS[t].length]));
// DE-6: the row count of each DE-6 section for the seed.
const DE6_COUNTS = Object.fromEntries(DE6_TABLES.map((t) => [DE6_SECTION[t], DE6_ROWS[t].length]));

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/user/data-export', { headers });
}

const routeLine = (msg: string) => mockLogged.find((l) => l.msg === msg);

let consoleSpies: jest.SpyInstance[] = [];

beforeEach(() => {
  jest.useFakeTimers({ now: NOW_MS, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  for (const key of Object.keys(mockCalls)) delete mockCalls[key];
  for (const key of Object.keys(mockResults)) delete mockResults[key];
  for (const key of Object.keys(mockQueues)) delete mockQueues[key];
  mockReadOrder.length = 0;
  mockGetUser.mockReset();
  mockLogAndFlush.mockReset();
  mockLogAndFlush.mockResolvedValue(undefined);
  mockLogged.length = 0;
  mockChildBindings.length = 0;
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => jest.spyOn(console, method).mockImplementation(() => undefined));
});

afterEach(() => {
  for (const spy of consoleSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
  jest.useRealTimers();
});

describe('GET /api/user/data-export: characterization pin', () => {
  it('401 with no session, and reads nothing on any client', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(JSON.parse(await res.text())).toEqual({ error: 'Unauthorized' });
    expect(mockReadOrder).toEqual([]);
    expect(mockLogAndFlush).not.toHaveBeenCalled();
  });

  it('401 on an auth error, and reads nothing', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: { message: 'jwt expired' } });
    const res = await GET(request());
    expect(res.status).toBe(401);
    expect(mockReadOrder).toEqual([]);
  });

  // DE-1: two tables, was "the eight tables". DE-4: ten tables; each client_records
  // table is read twice (its data page, then the empty page that ends the read).
  // DE-4 (user 2026-10-15): nine section tables, was ten (plugin_connections out),
  // then user_preferences once for the file name's clock.
  // DE-3: thirteen section tables, was nine: the four account tables, paged, after profiles.
  // DE-5: twenty-three, was thirteen: the two account money tables after the DE-3
  // tables, the eight client-money tables after the DE-4 tables.
  // DE-6: thirty-three, was twenty-three: the ten DE-6 tables after the DE-5 ones;
  // consent settings is read once (the single-row read), the others twice.
  it('reads the thirty-three section tables in order, then the timezone, all on the service-role client', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request());
    expect(mockReadOrder).toEqual([
      ...ACCOUNT_TABLES.map((t) => `service:${t}`),
      ...DE3_TABLES.flatMap((t) => [`service:${t}`, `service:${t}`]),
      ...DE5_ACCOUNT_TABLES.flatMap((t) => [`service:${t}`, `service:${t}`]),
      ...DE4_TABLES.flatMap((t) => [`service:${t}`, `service:${t}`]),
      ...DE5_TABLES.flatMap((t) => [`service:${t}`, `service:${t}`]),
      // DE-6.
      ...DE6_TABLES.flatMap((t) => (t === 'marketing_consent_settings' ? [`service:${t}`] : [`service:${t}`, `service:${t}`])),
      'service:user_preferences',
    ]);
    // DE-5 (SA C-6 a): the set of tables touched is exactly the registry's 23 (the timezone read is on one of them).
    // DE-6: 33.
    expect(new Set(mockReadOrder)).toEqual(new Set(TABLES.map((t) => `service:${t}`)));
    expect(TABLES).toHaveLength(33);
    expect(Object.keys(mockCalls).filter((k) => k.startsWith('anon:'))).toEqual([]);
  });

  // DE-4 (new): a section longer than one page is read to the end, page by page.
  it('pages a client_records table past one page, ending only on an empty page', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    const page1 = [{ id: id(10) }, { id: id(11) }];
    const page2 = [{ id: id(12) }];
    mockQueues.crm_activities = [{ data: page1, error: null }, { data: page2, error: null }];
    const res = await GET(request());
    const body = JSON.parse(await res.text());
    expect(body.sections.find((s: { id: string }) => s.id === 'client_activities').rows).toEqual([...page1, ...page2]);
    expect(mockCalls['service:crm_activities']).toEqual([
      ...pageQuery('crm_activities', null),
      ...pageQuery('crm_activities', id(11)),
      ...pageQuery('crm_activities', id(12)),
    ]);
  });

  // DE-6 (F-DE6-1, TL 2026-10-16): the one deliberate change to DE-4 output.
  it('DE-6 (F-DE6-1): clients.source_metadata page URLs reach the body without their query string or fragment', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    mockQueues.crm_contacts = [
      {
        data: [
          {
            id: id(2),
            first_name: 'Dana',
            source_metadata: {
              capture_page_url: 'https://biz.test/book?token=F1-TOKEN-NEVER&sid=F1-SID-NEVER#F1-FRAG-NEVER',
              referrer_url: 'https://ref.test/x?code=F1-CODE-NEVER',
              capture_channel: 'website',
            },
          },
        ],
        error: null,
      },
    ];
    const res = await GET(request());
    const text = await res.text();
    const clients = JSON.parse(text).sections.find((s: { id: string }) => s.id === 'clients');
    expect(clients.rows).toEqual([
      { id: id(2), first_name: 'Dana', source_metadata: { capture_page_url: 'https://biz.test/book', referrer_url: 'https://ref.test/x', capture_channel: 'website' } },
    ]);
    for (const leaked of ['F1-TOKEN-NEVER', 'F1-SID-NEVER', 'F1-FRAG-NEVER', 'F1-CODE-NEVER', 'token=', 'sid=']) expect(text).not.toContain(leaked);
  });

  // DE-6 (N-6 / SA-Q7 C-4): consent page URLs and subscriber URLs, cut; tracking values never in the body.
  it('DE-6: consent and subscriber tracking values and query strings never reach the body; the page path does', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    const res = await GET(request());
    const text = await res.text();
    expect(text).not.toContain('never-exported');
    expect(text).toContain('"source_page_url": "https://biz.test/p"');
    expect(text).toContain('"capture_page_url": "https://biz.test/join"');
    expect(text).toContain('"privacy_policy_url": "https://biz.test/privacy"');
    for (const key of ['ip_hash', 'ip_hash_salt', 'user_agent', 'session_id', 'recorded_by', 'email_normalized', 'generated_from', 'next_send_at']) {
      expect(text).not.toContain(`"${key}"`);
    }
  });

  // DE-1 (new, SA C-7): DX-1 / BQ-SA-1 removed these sections.
  it.each(REMOVED_TABLES)('never reads %s, on any client', async (table) => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request());
    expect(mockCalls[`service:${table}`]).toBeUndefined();
    expect(mockCalls[`anon:${table}`]).toBeUndefined();
  });

  it.each(TABLES)('pins the full query chain on %s', async (table) => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request());
    expect(mockCalls[`service:${table}`]).toEqual(EXPECTED_CHAINS[table]);
  });

  // DE-4 (user 2026-10-15, new): one explicit column, scoped to the session id.
  // DE-3: user_preferences is also the preferences section, read first; the timezone read is the last three calls.
  it('pins the timezone read: select timezone, the session id, maybeSingle', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request());
    expect(mockCalls['service:user_preferences'].slice(-PREFERENCES_CHAIN.length)).toEqual(PREFERENCES_CHAIN);
    expect(mockReadOrder[mockReadOrder.length - 1]).toBe('service:user_preferences');
  });

  // DE-1: the section model, was "(profile spread, plugin mapping, summary)".
  it('returns the full export body for a seeded account (sections, plugin mapping, summary)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    // Exact text: key order and the 2-space indentation are part of the export.
    expect(text).toBe(JSON.stringify(expectedBody(FULL), null, 2));
    const body = JSON.parse(text);
    // DE-1: identity and profile are separate sections, so a profile key can no
    // longer override an auth field (was: "Profile keys override the auth fields").
    expect(body.sections[0]).toEqual(section('account_identity', [{ id: OWNER.id, email: OWNER.email, created_at: OWNER.created_at }]));
    // DE-1 (new): none of the removed parts is in the body, under any key.
    for (const removed of ['agents', 'agent_executions', 'agent_configurations', 'subscriptions', 'transactions', 'audit_logs']) {
      expect(Object.keys(body)).not.toContain(removed);
      expect(body.sections.map((s: { id: string }) => s.id)).not.toContain(removed);
    }
    // Credentials never reach the export. DE-4 (user 2026-10-15): the seeded
    // plugin_connections rows hold them raw; the table is not read, so none appears.
    // DE-5: nor the raw payments.metadata keys, nor any excluded money or billing row.
    expect(text).not.toContain('never-exported');
    expect(body.sections.map((s: { id: string }) => s.id)).not.toContain('plugin_connections');
    for (const key of ['plugin_key', 'access_token', 'refresh_token', 'credentials', 'profile_data', 'account_profile']) {
      expect(text).not.toContain(`"${key}"`);
    }
  });

  it('sets the download headers', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    const res = await GET(request());
    expect(res.headers.get('Content-Type')).toBe('application/json');
    // DE-1 (SA Q-1): no user id, no old brand, UTC date; was
    // `neuronforge-data-export-${OWNER.id}-${NOW_MS}.json`.
    // DE-4 (user 2026-10-15): + the time, on the owner's clock; no timezone stored (NULL) gives UTC.
    expect(res.headers.get('Content-Disposition')).toBe(UTC_FILE_NAME);
    expect(res.headers.get('Content-Disposition')).not.toContain(OWNER.id);
    expect(res.headers.get('Cache-Control')).toBe('no-store, no-cache, must-revalidate');
  });

  // DE-1 (SA Q-4): no profile row is an ok, empty section; the subscription half
  // of this case went with the subscription section.
  it('exports an ok, empty user_profile section when there is no profile row', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    mockResults.profiles = { data: null, error: null };
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(expectedBody({ ...FULL, profile: [] }), null, 2));
  });

  const FAILED_PART: Record<Table, Partial<BodyParts>> = {
    profiles: { profile: 'failed' },
    // DE-4 (user 2026-10-15): the plugin_connections case is gone with the section.
    // DE-4 (new).
    ...(Object.fromEntries(DE4_TABLES.map((t) => [t, { records: { [t]: 'failed' } }])) as Record<De4Table, Partial<BodyParts>>),
    // DE-3 (new).
    ...(Object.fromEntries(DE3_TABLES.map((t) => [t, { details: { [t]: 'failed' } }])) as Record<De3Table, Partial<BodyParts>>),
    // DE-5 (new).
    ...(Object.fromEntries(DE5_ALL_TABLES.map((t) => [t, { money: { [t]: 'failed' } }])) as Record<De5Table, Partial<BodyParts>>),
    // DE-6 (new).
    ...(Object.fromEntries(DE6_TABLES.map((t) => [t, { intake: { [t]: 'failed' } }])) as Record<De6Table, Partial<BodyParts>>),
  };

  /** DE-4: an error on `table`, whichever kind of read it is. */
  function failRead(table: Table): void {
    if (MOCK_PAGED_TABLES.has(table)) mockQueues[table] = [{ data: null, error: POSTGREST_ERROR }];
    else mockResults[table] = { data: null, error: POSTGREST_ERROR };
  }

  // DE-1 (FR-E12, AC-E9): a failed read is a `failed` section listed in
  // failed_sections, was "gives an empty section", the behaviour FR-E12 forbids.
  it.each(TABLES)('a PostgREST error on %s gives a failed section and still a 200', async (table) => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    failRead(table);
    const res = await GET(request());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe(JSON.stringify(expectedBody({ ...FULL, ...FAILED_PART[table] }), null, 2));
    // SA C-3: no error text, code or message in the body.
    expect(text).not.toContain('boom');
    expect(text).not.toContain('XX000');
    expect(routeLine('Data export failed')).toBeUndefined();
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
  });

  // DE-1: every read failing leaves the identity ok and two failed sections, was "every section empty".
  // DE-4: ten failed sections, was two.
  it('every table failing still gives a 200 with account_identity ok and every other section failed', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    for (const table of TABLES) failRead(table);
    const res = await GET(request());
    expect(res.status).toBe(200);
    const records = Object.fromEntries(DE4_TABLES.map((t) => [t, 'failed'])) as Record<De4Table, SectionRows>;
    // DE-3: and the four account sections read from tables.
    const details = Object.fromEntries(DE3_TABLES.map((t) => [t, 'failed'])) as Record<De3Table, SectionRows>;
    // DE-5: and the ten money sections.
    const money = Object.fromEntries(DE5_ALL_TABLES.map((t) => [t, 'failed'])) as Record<De5Table, SectionRows>;
    // DE-6: and the ten DE-6 sections.
    const intake = Object.fromEntries(DE6_TABLES.map((t) => [t, 'failed'])) as Record<De6Table, SectionRows>;
    // DE-4 (user 2026-10-15): no `connections: 'failed'`.
    expect(await res.text()).toBe(JSON.stringify(expectedBody({ profile: 'failed', records, details, money, intake }), null, 2));
  });

  // DE-1 (WC-7, §3.7): through logAndFlush with its context; details carry section
  // counts and failed sections, was `auditLog` with the whole `summary` object.
  it('records the export in the audit trail with the section counts and request details', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'pin-agent' }));
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
    const [entry, flushLogger, context] = mockLogAndFlush.mock.calls[0];
    expect(entry).toEqual({
      action: 'DATA_EXPORTED',
      entityType: 'user',
      entityId: OWNER.id,
      userId: OWNER.id,
      resourceName: OWNER.email,
      details: {
        export_timestamp: NOW,
        export_format: 'JSON',
        format_version: 2,
        // DE-4: + the eight client_records sections.
        // DE-4 (user 2026-10-15): plugin_connections removed from both.
        // DE-3: + the four account sections, after user_profile.
        // DE-5: + the ten money sections (counts only: no amount, no currency).
        // DE-6: + the ten DE-6 sections (counts only: no email, no wording).
        data_categories: [
          'account_identity', 'user_profile', ...DE3_TABLES.map((t) => DE3_SECTION[t]), ...DE5_ACCOUNT_TABLES.map((t) => DE5_SECTION[t]),
          ...DE4_TABLES.map((t) => DE4_SECTION[t]), ...DE5_TABLES.map((t) => DE5_SECTION[t]), ...DE6_TABLES.map((t) => DE6_SECTION[t]),
        ],
        section_counts: { account_identity: 1, user_profile: 1, ...DE3_COUNTS, ...DE5_ACCOUNT_COUNTS, ...DE4_COUNTS, ...DE5_COUNTS, ...DE6_COUNTS },
        failed_sections: [],
        gdpr_basis: 'Article 15 (Right to Access) & Article 20 (Data Portability)',
        ip_address: '203.0.113.7',
        user_agent: 'pin-agent',
      },
      severity: 'info',
      complianceFlags: ['GDPR', 'SOC2'],
    });
    expect(typeof (flushLogger as { warn: unknown }).warn).toBe('function');
    expect(typeof (flushLogger as { error: unknown }).error).toBe('function');
    expect(context).toEqual({ reason: 'data export', continues: 'the export is still returned' });
  });

  // DE-1 (new): a failed section is named in the audit details, never its reason (SA C-3).
  // DE-4 (user 2026-10-15): driven through profiles, was plugin_connections.
  it('a failed section is listed in the audit details, without its error text', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    mockResults.profiles = { data: null, error: POSTGREST_ERROR };
    await GET(request());
    const details = mockLogAndFlush.mock.calls[0][0].details;
    // DE-4: + the eight client_records sections.
    // DE-3: + the four account sections. DE-5: + the ten money sections.
    // DE-6: + the ten DE-6 sections.
    expect(details.data_categories).toEqual([
      'account_identity', ...DE3_TABLES.map((t) => DE3_SECTION[t]), ...DE5_ACCOUNT_TABLES.map((t) => DE5_SECTION[t]),
      ...DE4_TABLES.map((t) => DE4_SECTION[t]), ...DE5_TABLES.map((t) => DE5_SECTION[t]), ...DE6_TABLES.map((t) => DE6_SECTION[t]),
    ]);
    expect(details.failed_sections).toEqual(['user_profile']);
    expect(details.section_counts).toEqual({ account_identity: 1, user_profile: 0, ...DE3_COUNTS, ...DE5_ACCOUNT_COUNTS, ...DE4_COUNTS, ...DE5_COUNTS, ...DE6_COUNTS });
    expect(JSON.stringify(details)).not.toContain('boom');
  });

  // DE-1: sectionCounts / failedSections, was totalAgents … totalAuditLogs; the
  // "audit logged" line is gone (logAndFlush logs its own timeout and failure).
  it("logs the route's own lines: started, completed (counts only); correlation id from the header", async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    await GET(request({ 'x-correlation-id': 'corr-pin' }));
    expect(mockChildBindings).toContainEqual({ correlationId: 'corr-pin' });
    expect(routeLine('Data export started')).toEqual({ level: 'info', fields: { userId: OWNER.id }, msg: 'Data export started' });
    const summary = expectedBody(FULL).summary as Record<string, number>;
    expect(routeLine('Data export completed')).toEqual({
      level: 'info',
      msg: 'Data export completed',
      fields: {
        userId: OWNER.id,
        // DE-4: + the eight client_records counts. DE-4 (user 2026-10-15): no plugin_connections.
        // DE-3: + the four account section counts. DE-5: + the ten money section counts.
        // DE-6: + the ten DE-6 section counts.
        sectionCounts: { account_identity: 1, user_profile: 1, ...DE3_COUNTS, ...DE5_ACCOUNT_COUNTS, ...DE4_COUNTS, ...DE5_COUNTS, ...DE6_COUNTS },
        failedSections: [],
        exportSizeKb: summary.export_size_kb,
        durationMs: 0,
      },
    });
    expect(routeLine('Data export completed with failed sections')).toBeUndefined();
    expect(routeLine('Data export failed')).toBeUndefined();
    // Never the email in any log field.
    expect(JSON.stringify(mockLogged)).not.toContain(OWNER.email);
  });

  // DE-1 (new): a failed section turns the completion line into a warn.
  it('logs "completed with failed sections" at warn when a section failed', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    mockResults.profiles = { data: null, error: POSTGREST_ERROR };
    await GET(request());
    expect(routeLine('Data export completed with failed sections')).toMatchObject({
      level: 'warn',
      fields: { userId: OWNER.id, failedSections: ['user_profile'] },
    });
    expect(routeLine('Data export completed')).toBeUndefined();
  });

  // DE-1: logAndFlush never rejects by contract; it logs its own failure and the
  // route returns the export. Was "a failed audit write is logged as an error" by the route itself.
  it('an audit flush that fails (logged by logAndFlush) still returns the full export', async () => {
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    mockLogAndFlush.mockImplementation(async (_entry: unknown, flushLogger: { error: (c: Record<string, unknown>, m: string) => void }) => {
      flushLogger.error({ err: new Error('queue full') }, 'Audit flush on data export failed; the export is still returned');
    });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(JSON.stringify(expectedBody(FULL), null, 2));
  });

  // DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-P2 (intended change): the body no longer carries the error message outside development.
  it('an unexpected throw gives 500 with the pinned body (FU-P2: no message, no details outside development)', async () => {
    mockGetUser.mockRejectedValue(new Error('auth service down'));
    const res = await GET(request());
    expect(res.status).toBe(500);
    // DATA_EXPORT_FOLLOWUPS_WORKPLAN.md FU-P2: was { error: 'Data export failed', message: 'auth service down' }.
    expect(JSON.parse(await res.text())).toEqual({ success: false, error: 'Data export failed' });
    expect(routeLine('Data export failed')).toEqual({
      level: 'error',
      msg: 'Data export failed',
      fields: { err: { name: 'Error', message: 'auth service down' } },
    });
    expect(mockReadOrder).toEqual([]);
  });
});

// DE-4 (user 2026-10-15, new): the file name's time is on the owner's clock,
// from the same instant as `export_date`; the clock never fails the export.
describe("GET /api/user/data-export: file name on the owner's clock (DE-4, user 2026-10-15)", () => {
  const disposition = (name: string) => `attachment; filename="agentpilot-data-export-${name}.json"`;

  async function exportAt(iso: string): Promise<{ res: Response; text: string }> {
    jest.setSystemTime(Date.parse(iso));
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    const res = await GET(request());
    return { res, text: await res.text() };
  }

  it('Asia/Jerusalem moves the name across midnight; export_date is the same instant, in UTC', async () => {
    mockResults.user_preferences = { data: { timezone: 'Asia/Jerusalem' }, error: null };
    const { res, text } = await exportAt('2026-07-15T22:30:00.000Z');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(disposition('2026-07-16-0130'));
    const body = JSON.parse(text);
    expect(body.export_metadata.export_date).toBe('2026-07-15T22:30:00.000Z');
    expect(mockLogAndFlush.mock.calls[0][0].details.export_timestamp).toBe('2026-07-15T22:30:00.000Z');
  });

  it('the same instant in UTC (a stored UTC is a choice, honoured as such)', async () => {
    mockResults.user_preferences = { data: { timezone: 'UTC' }, error: null };
    const { res } = await exportAt('2026-07-15T22:30:00.000Z');
    expect(res.headers.get('Content-Disposition')).toBe(disposition('2026-07-15-2230'));
  });

  it('NULL (never set) gives UTC', async () => {
    mockResults.user_preferences = { data: { timezone: null }, error: null };
    const { res } = await exportAt(NOW);
    expect(res.headers.get('Content-Disposition')).toBe(UTC_FILE_NAME);
  });

  it('an invalid zone string gives UTC, and the export is unchanged', async () => {
    mockResults.user_preferences = { data: { timezone: 'Mars/Olympus_Mons' }, error: null };
    const { res, text } = await exportAt(NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(UTC_FILE_NAME);
    expect(text).toBe(JSON.stringify(expectedBody(FULL), null, 2));
  });

  it('a failed timezone read gives UTC and still the full export, logged at warn without error text in the body', async () => {
    mockResults.user_preferences = { data: null, error: POSTGREST_ERROR };
    const { res, text } = await exportAt(NOW);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(UTC_FILE_NAME);
    expect(text).toBe(JSON.stringify(expectedBody(FULL), null, 2));
    expect(text).not.toContain('boom');
    expect(routeLine('Data export: timezone unreadable, file name in UTC')).toEqual({
      level: 'warn',
      msg: 'Data export: timezone unreadable, file name in UTC',
      fields: { userId: OWNER.id },
    });
    expect(routeLine('Data export failed')).toBeUndefined();
    expect(mockLogAndFlush).toHaveBeenCalledTimes(1);
  });

  // QA delta DE-4 Edge case 2: under the frozen clock every reading is the same
  // instant, so a second `new Date()` for the name would pass every case above.
  // Here each reading moves the clock one minute, so only the one `exportedAt`
  // reading makes the name match `export_date` on the owner's clock.
  it('one clock reading: with a clock that moves on every reading, the name is still export_date on the owner clock', async () => {
    mockResults.user_preferences = { data: { timezone: 'Asia/Jerusalem' }, error: null };
    mockGetUser.mockResolvedValue({ data: { user: OWNER }, error: null });
    seed();
    const FrozenDate = global.Date;
    const startMs = Date.parse('2026-07-15T22:30:00.000Z');
    let readings = 0;
    const nextReading = (): number => startMs + 60_000 * readings++;
    // A no-argument `new Date()` and `Date.now()` are clock readings; a Date
    // built from a value is not.
    class MovingDate extends FrozenDate {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(nextReading());
        else super(args[0] as string | number | Date);
      }
      static now(): number {
        return nextReading();
      }
    }
    global.Date = MovingDate as DateConstructor;
    let res: Response;
    let text: string;
    try {
      res = await GET(request());
      text = await res.text();
    } finally {
      global.Date = FrozenDate;
    }
    expect(res.status).toBe(200);
    // Not vacuous: the route read the clock more than once.
    expect(readings).toBeGreaterThan(1);
    const exportDate = JSON.parse(text).export_metadata.export_date as string;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jerusalem',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .formatToParts(new FrozenDate(exportDate))
        .map((p) => [p.type, p.value])
    );
    expect(res.headers.get('Content-Disposition')).toBe(disposition(`${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}`));
    expect(mockLogAndFlush.mock.calls[0][0].details.export_timestamp).toBe(exportDate);
  });

  it('negative control: without the timezone the name would be UTC, so the Jerusalem case is not vacuous', async () => {
    const { res } = await exportAt('2026-07-15T22:30:00.000Z');
    expect(res.headers.get('Content-Disposition')).toBe(disposition('2026-07-15-2230'));
    expect(res.headers.get('Content-Disposition')).not.toBe(disposition('2026-07-16-0130'));
  });
});

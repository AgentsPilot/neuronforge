/**
 * Which tables belong to a BUSINESS, and which belong to the person.
 *
 * The distinction has no representation in the schema — every Business OS table
 * is scoped by `user_id` alone, and `business_profiles` is one row per user —
 * so "this row belonged to the business that was deleted" is not a question the
 * database could answer. It is answered here, and enforced by the foreign keys
 * in supabase/migrations/20260916_business_data_ownership.sql.
 *
 * Keeping the list in TypeScript as well as SQL is not duplication for its own
 * sake: application code needs to reason about the boundary (what a teardown
 * covers, what an export includes, what a "start over" means) and cannot read a
 * migration. The test beside this file asserts the two never disagree.
 *
 * It is ALSO checked against the purge descriptors
 * (`lib/business-os/purge/descriptors.ts`, the single source of truth for what
 * a Reset or Purge deletes). The same test asserts both directions: every table
 * here is classified `reset` or `purge` there (deleting `business_profiles`
 * cascades into all of them), and every `reset`/`purge` descriptor is named
 * here or in USER_OWNED_TABLES, with listed, reasoned exceptions (purge slice
 * 3a, §0.10 F-SA-3).
 *
 * WHY THIS EXISTS AT ALL
 *
 * There was already a list, inside scripts/reset-onboarding.ts. It named 17
 * tables and had fallen 38 behind — every insight table among them. Nothing
 * failed when it drifted, because a list that is merely out of date looks
 * exactly like a list that is complete. That is the failure this file and its
 * test are built to make loud.
 */

/**
 * Tables a business owns. Deleting the business deletes these.
 *
 * Order is irrelevant — the foreign keys cascade, so the database resolves
 * dependencies itself rather than relying on anyone getting child-first
 * ordering right.
 */
export const BUSINESS_OWNED_TABLES = [
  // The addresses the business trades and bills from — its address book
  // (20261036). Business data, not the person's: these are the addresses
  // printed on its invoices and shown on its public booking and contact pages,
  // and a new business must no more inherit the last one's address than its
  // company name. `business_profiles.address_id` / `invoice_address_id` point
  // in here, so the rows go when the profile they belong to does.
  'business_addresses',
  // CRM
  'crm_activities',
  'crm_contacts',
  'crm_pipeline_stages',
  'crm_tasks',
  'contact_documents',
  // Scheduling
  'scheduling_bookings',
  'scheduling_services',
  'scheduling_availability_exceptions',
  'external_calendar_events',
  // Payments
  'payment_automation_executions',
  'payment_automation_rules',
  'payment_events',
  'payment_invoices',
  'payment_methods',
  'payment_plan_installments',
  'payment_plan_subscriptions',
  'payment_plans',
  'payment_processors',
  'payment_refunds',
  'payment_reminders',
  'payment_transactions',
  'saved_payment_methods',
  'stripe_connect_accounts',
  'proposals',
  // Online presence
  'smart_links',
  'website_content',
  'website_page_views',
  'website_pages',
  'websites',
  'user_media',
  // Insight
  'business_events',
  'business_health_summaries',
  'channel_connections',
  'channel_metrics_daily',
  'derived_metrics',
  'insight_automations',
  'insight_outcomes',
  'insights',
  'owner_insight_history',
  // Daily briefing
  'daily_briefings',
  'daily_briefing_sends',
  // Intake
  'business_intake_forms',
  'user_intake_settings',
  // The business's newsletter audience. Deleting the business deletes its list,
  // the same as its contacts — these people gave their address to THIS business.
  // (The record of what they CONSENTED to is separate and outlives it; see
  // marketing_consent_events below.)
  'business_subscribers',
  // Marketing consent — the business's OWN wording, privacy notice and postal
  // address. The decisions those settings produced are user-owned and outlive
  // the business (below); this is configuration, and a new business must not
  // inherit another's legal notice.
  'marketing_consent_settings',
  // Email
  'email_campaigns',
  'email_sends',
  'email_sequence_enrollments',
  'email_sequence_steps',
  'email_sequences',
  // Leads
  'lead_responses',
  // What the business switched on
  'user_capabilities',
  // Queued actions the platform takes on the business's behalf
  'insight_actions',
  // Business chat
  'business_chat_action_log',
  'business_chat_conversation',
  'business_chat_plan_cache',
  'business_chat_saved_plans',
  'business_chat_verified_questions',
] as const;

/**
 * Tables that carry a `user_id` and survive a change of business, each with the
 * reason it survives.
 *
 * A reason is required rather than encouraged. "Not business-owned" is a claim
 * about someone's data outliving the thing that collected it, and the two
 * entries below that are genuinely load-bearing — the unsubscribe list and the
 * onboarding transcript — are both cases where the obvious answer is wrong.
 */
export const USER_OWNED_TABLES: Record<string, string> = {
  business_profiles: 'The parent row itself.',

  auth_handoff_codes:
    'Keyed to the auth user, not to a business profile. A row is a pending sign-in that ' +
    'expires in sixty seconds, and it is created during sign-in — possibly before the ' +
    'profile exists at all, so a foreign key to it would reject the first sign-in of a ' +
    'new account. Rows go with the auth user through ON DELETE CASCADE.',

  onboarding_conversations:
    'Written before the profile exists — the chat is what produces the profile. ' +
    'A foreign key here would reject the first message of every new account.',

  email_unsubscribes:
    'Compliance. An unsubscribe has to outlive the business that collected it, ' +
    'or rebuilding would resume mailing people who opted out.',

  marketing_consent_events:
    'Compliance, in both directions. A withdrawal has to outlive the business ' +
    'for the same reason an unsubscribe does; a grant has to outlive it because ' +
    'the record of what someone agreed to is the only thing that can answer a ' +
    'complaint later, and it cannot be reconstructed after the fact.',

  marketing_consent_state:
    'The projection the send gate reads. Tied to the events above, and losing ' +
    'it would lose every suppression they encode.',

  user_preferences: 'Theme, sidebar, default model. The person\'s settings, not the business\'s.',

  business_os_account_plans:
    'The commercial relationship with the account: tier, cohort, trial and grace dates. ' +
    'Deliberately NOT business-owned even though the name says business_os — if deleting a ' +
    'business took the plan with it, "start over" would also mean "get another free trial".',

  business_os_entitlement_overrides:
    'What an admin granted or revoked for this account, and why. Evidence about the ' +
    'platform\'s dealings with the person, which has to outlive any one business.',

  business_os_entitlement_shadow_events:
    'Counters of what the entitlement resolver would have decided. Platform observability ' +
    'about the product, not data the owner entered about their clients.',

  business_os_credit_charges:
    'The commercial record of what the account was charged in Business OS credits, for AI or ' +
    'any other chargeable service (one credit pool). Keyed to ' +
    'auth.users, not business_profiles, so a business Reset cannot erase it.',

  business_os_credit_totals:
    'A running total of business_os_credit_charges per billing period — derived from the bill, ' +
    'so it follows the account for the same reason.',

  // Credit deduction slice 11a (S11-SQ-12).
  business_os_credit_lots:
    'Credits added to the account (admin grants, later boost purchases). Keyed to auth.users, ' +
    'not business_profiles, so a business Reset cannot erase them.',

  business_os_credit_lot_draws:
    'Credits taken back from a lot; follows the account for the same reason.',

  // Plan payments P-2a (PF-14, SA-P1).
  business_os_billing_accounts:
    'The commercial relationship with the person: their Business OS Stripe customer and plan ' +
    'subscription. Keyed to auth.users, not business_profiles, so it survives any business Reset ' +
    '(a Reset that removed it would orphan a subscription that keeps charging).',

  // Plan payments P-3b.1 (SA-P5, migration 20261027).
  business_os_billing_events:
    'The money history of the Business OS plan: what the person paid and which payment moved the ' +
    'plan. Keyed to auth.users, not business_profiles, so a business Reset cannot erase it.',

  // Credits boost slice 2a (NFR-12, F-11).
  business_os_boost_purchases:
    'Boost purchases of the account: what was bought, its price and Stripe references. Keyed to ' +
    'auth.users, not business_profiles, so a business Reset cannot erase them.',

  business_os_boost_cap_overrides:
    "Admin changes to the account's boost purchase cap; follows the account for the same reason.",
  profiles: 'Account level.',
  plugin_connections: 'Account level — the user\'s own third-party credentials.',
  admin_users: 'Platform authorization.',
  organization_members: 'Account level.',
  command_sessions: 'Account level.',
  token_usage: 'Billing and usage accounting, which must outlive any one business.',
  archived_records:
    "The person's own archived activity history (Admin Archiving). Like audit_trail, it " +
    'follows the account, not the business: erasure and the activity-history purge reach it ' +
    'by user_id, and a business Reset must not cascade it away.',

  automation_slas:
    'Reads as Business OS and is not: it carries agent_id, group_id and ' +
    'metric_name "time_saved_seconds". It belongs to the agent platform.',

  // The agent platform. A user keeps their agents across a change of business.
  agents: 'Agent platform.',
  agent_configurations: 'Agent platform.',
  agent_execution_logs: 'Agent platform.',
  agent_executions: 'Agent platform.',
  agent_intensity_metrics: 'Agent platform.',
  agent_logs: 'Agent platform.',
  agent_stats: 'Agent platform.',
  shared_agents: 'Agent platform.',
  calibration_history: 'Agent platform.',
  calibration_sessions: 'Agent platform.',
  error_patterns: 'Agent platform.',
  execution_anomalies: 'Agent platform.',
  execution_baselines: 'Agent platform.',
  execution_insight_runs: 'Agent platform — the OTHER insight system.',
  execution_insights: 'Agent platform — the OTHER insight system.',
  intent_examples: 'Agent platform.',
  kernel_action_log: 'Agent platform.',
  kernel_executions: 'Agent platform.',
  plugin_performance: 'Agent platform.',
  run_memories: 'Agent platform.',
};

export type BusinessOwnedTable = (typeof BUSINESS_OWNED_TABLES)[number];

/** Whether a business owns this table's rows. */
export function isBusinessOwned(table: string): boolean {
  return (BUSINESS_OWNED_TABLES as readonly string[]).includes(table);
}

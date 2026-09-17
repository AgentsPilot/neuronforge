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

  onboarding_conversations:
    'Written before the profile exists — the chat is what produces the profile. ' +
    'A foreign key here would reject the first message of every new account.',

  email_unsubscribes:
    'Compliance. An unsubscribe has to outlive the business that collected it, ' +
    'or rebuilding would resume mailing people who opted out.',

  user_preferences: 'Theme, sidebar, default model. The person\'s settings, not the business\'s.',
  profiles: 'Account level.',
  plugin_connections: 'Account level — the user\'s own third-party credentials.',
  admin_users: 'Platform authorization.',
  organization_members: 'Account level.',
  command_sessions: 'Account level.',
  token_usage: 'Billing and usage accounting, which must outlive any one business.',

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

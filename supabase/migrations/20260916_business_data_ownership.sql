-- Make a business own its data, so deleting one deletes it.
--
-- THE PROBLEM
--
-- Every Business OS table is scoped by `user_id` alone. There is no business
-- identity anywhere in the schema, and `business_profiles` is one row per user.
-- So "a business" is not something that can be pointed at, and deleting one
-- deletes exactly one row: the profile. Everything else it owned stays behind,
-- still tagged with the same `user_id`, and is silently adopted by whatever
-- business is created next.
--
-- That is not theoretical. On the account this migration was written from,
-- a rebuilt business inherited:
--
--   * all four CRM pipeline stages from the deleted business — so the funnel
--     map, the gap detection and the stage-flow detectors described a pipeline
--     that no longer existed, and the new business's own configured stages were
--     never written at all;
--   * all six core capabilities — crm, reports, insights, payments, website,
--     scheduling — meaning every major tab was switched on by the dead
--     business's rows, and the new one activated only the two it happened to
--     add;
--   * both smart links, still addressed to the previous `user_code`.
--
-- The mechanism is the same in each case: the build asks "does this USER
-- already have one?" as a proxy for "has this BUSINESS been built?", and the
-- previous business answers yes.
--
-- THE FIX
--
-- Give the rows a parent. `business_profiles.user_id` is already UNIQUE NOT
-- NULL, so it can serve as the referenced key without any new column, backfill
-- or query change. With ON DELETE CASCADE, deleting the profile row becomes a
-- complete, atomic deletion of that business — which is what everyone already
-- assumed it was.
--
-- This is the pattern the schema already uses one level up: 54 tables declare
-- REFERENCES auth.users(id) ON DELETE CASCADE, which is why deleting an ACCOUNT
-- is clean. Nothing pointed at business_profiles, which is why deleting a
-- BUSINESS was not.
--
-- WHY NOT VALID
--
-- Added NOT VALID deliberately. That skips the one-time scan of existing rows
-- while still enforcing every subsequent insert and update, and the cascade
-- fires either way. It matters here because the database currently holds rows
-- whose user has no profile at all — leftovers from businesses already deleted
-- — and a validating constraint would simply refuse to be created until every
-- one of them was cleaned up. Separating the two lets the rule start protecting
-- new writes immediately.
--
-- Run VALIDATE CONSTRAINT (bottom of this file) only after the orphans are
-- cleared and onboarding has been exercised end to end.
--
-- WHAT THIS CHANGES FOR ANYONE OPERATING THE DATABASE
--
-- Deleting a row from business_profiles stops being a small act. Today it
-- orphans data; afterwards it erases the business. Do not delete that row to
-- reset a single field — update the field.

BEGIN;

DO $$
DECLARE
  target text;
  constraint_name text;
  created int := 0;
  skipped int := 0;
  /*
   * Tables a BUSINESS owns.
   *
   * The test in lib/business-os/__tests__/businessOwnedTables.test.ts parses
   * this array and fails if it drifts from the TypeScript registry, or if any
   * table carrying a user_id is left unclassified by both lists. That guard is
   * the point: the previous attempt at this problem was a hand-maintained list
   * inside a script, and it had already fallen 38 tables behind — every insight
   * table among them.
   */
  business_owned text[] := ARRAY[
    -- CRM
    'crm_activities',
    'crm_contacts',
    'crm_pipeline_stages',
    'crm_tasks',
    'contact_documents',
    -- Scheduling
    'scheduling_bookings',
    'scheduling_services',
    'scheduling_availability_exceptions',
    'external_calendar_events',
    -- Payments. `stripe_connect_accounts` belongs here: it is the link to this
    -- business's payout account, and a new business must not inherit it.
    -- Removing the row does not touch anything at Stripe.
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
    -- Online presence
    'smart_links',
    'website_content',
    'website_page_views',
    'website_pages',
    'websites',
    'user_media',
    -- Insight. Named in full because the script this replaces omitted every
    -- one of them, which is how a rebuilt business kept the old one's metrics.
    'business_events',
    'business_health_summaries',
    'channel_connections',
    'channel_metrics_daily',
    'derived_metrics',
    'insight_automations',
    'insight_outcomes',
    'insights',
    'owner_insight_history',
    -- Daily briefing
    'daily_briefings',
    'daily_briefing_sends',
    -- Intake
    'business_intake_forms',
    'user_intake_settings',
    -- Email
    'email_campaigns',
    'email_sends',
    'email_sequence_enrollments',
    'email_sequence_steps',
    'email_sequences',
    -- Leads
    'lead_responses',
    -- What the business switched on
    'user_capabilities',
    -- Business chat
    'business_chat_action_log',
    'business_chat_conversation',
    'business_chat_plan_cache',
    'business_chat_saved_plans',
    'business_chat_verified_questions'
  ];
BEGIN
  FOREACH target IN ARRAY business_owned LOOP
    constraint_name := target || '_business_fk';

    -- A table named here but absent from this database is reported, not fatal:
    -- environments are not identical and a migration that stops halfway leaves
    -- the schema in a state nobody intended.
    IF to_regclass('public.' || quote_ident(target)) IS NULL THEN
      RAISE NOTICE 'business ownership: % is not in this database, skipping', target;
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = constraint_name
        AND conrelid = ('public.' || quote_ident(target))::regclass
    ) THEN
      skipped := skipped + 1;
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I '
      'FOREIGN KEY (user_id) REFERENCES public.business_profiles(user_id) '
      'ON DELETE CASCADE NOT VALID',
      target, constraint_name
    );
    created := created + 1;
  END LOOP;

  RAISE NOTICE 'business ownership: % constraints added, % skipped', created, skipped;
END $$;

COMMIT;


-- ── Deliberately NOT owned by a business ────────────────────────────────────
--
-- Recorded here because an absence explains nothing on its own, and the next
-- person to read the array above will wonder what happened to these.
--
--   business_profiles          The parent itself.
--
--   onboarding_conversations   Written BEFORE the profile exists — the chat is
--                              what produces the profile. A foreign key here
--                              would reject the first message of every new
--                              account.
--
--   email_unsubscribes         Compliance. An unsubscribe has to outlive the
--                              business that collected it, or rebuilding would
--                              resume mailing people who opted out.
--
--   user_preferences           Theme, sidebar, default model. The person's
--                              settings, not the business's.
--
--   profiles, plugin_connections, admin_users, organization_members,
--   command_sessions, token_usage
--                              Account level.
--
--   automation_slas            Reads as Business OS and is not: it carries
--                              agent_id, group_id and metric_name
--                              'time_saved_seconds'. It belongs to the agent
--                              platform.
--
--   agents, agent_*, calibration_*, execution_*, kernel_*, error_patterns,
--   intent_examples, run_memories, shared_agents, plugin_performance,
--   workflow_*
--                              The agent platform. A user keeps their agents
--                              across a change of business.


-- ── Step 2, run separately ──────────────────────────────────────────────────
--
-- Only after the orphans are cleared and a full onboarding has been exercised.
-- Until then the constraints protect new writes and leave existing rows alone.
--
-- Find the orphans first:
--
--   SELECT 'crm_contacts' AS t, count(*) FROM crm_contacts c
--   WHERE NOT EXISTS (SELECT 1 FROM business_profiles p WHERE p.user_id = c.user_id)
--   -- ...repeated per table, or generated from the array above.
--
-- Then, per table:
--
--   ALTER TABLE public.crm_contacts VALIDATE CONSTRAINT crm_contacts_business_fk;
--
-- VALIDATE takes only a SHARE UPDATE EXCLUSIVE lock, so it does not block
-- reads or writes, and it can be run one table at a time.

-- Unique (user_id, name) on payment_automation_rules.
--
-- Closes the concurrent-first-emit double-seed race in ensureDefaultPaymentRules
-- (lib/payments/defaultPaymentRules.ts): two simultaneous first payment events for
-- a brand-new user could both pass the "user has no rules yet" empty-check and each
-- insert the 3 defaults, leaving 6 rules. With this unique index the racing seeder's
-- ON CONFLICT DO NOTHING upsert is ignored, so exactly one set of default rules lands.
--
-- Also a sensible general invariant: a user should not hold two automation rules with
-- the same name (a future rule-management UI would enforce this at author-time anyway).
--
-- Safe to add now: payment_automation_rules is currently dark (no rows; the engine was
-- dormant), so there is no existing (user_id, name) duplicate to collide with.

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_automation_rules_user_name
  ON payment_automation_rules(user_id, name);

-- ============================================================================
-- Down-migration (manual):
--   DROP INDEX IF EXISTS idx_payment_automation_rules_user_name;
-- ============================================================================

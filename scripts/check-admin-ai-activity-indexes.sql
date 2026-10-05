-- Admin AI Activity view (Gap B) — SA-RC-9 live checks 2 and 3.
-- READ-ONLY. Run in the Supabase SQL editor on production and paste the
-- result into F-24 of docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md.
--
-- Check 2: every live index on business_os_credit_charges (read before the B0' migration is written).
-- Check 3: every live index on audit_trail — confirms idx_audit_trail_entity_id exists
--          (it and idx_audit_trail_details are defined only in supabase/SQL Scripts/create_audit_trail.sql).

SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('business_os_credit_charges', 'audit_trail')
ORDER BY tablename, indexname;

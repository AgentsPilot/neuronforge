/*
 * Checker for 20261128_how_a_client_has_behaved_over_time.sql
 *
 * Every row must read `ok`. Run it ONCE BEFORE the apply as well: the first
 * eight gates must read FAIL there, or the checker cannot detect the apply.
 *
 * Run through the read-only wrapper:  begin read only; <this>; commit;
 */

WITH checks AS (
  SELECT 'table crm_client_standing exists' AS gate,
         CASE WHEN to_regclass('public.crm_client_standing') IS NOT NULL THEN 'ok' ELSE 'FAIL' END AS result
  UNION ALL
  SELECT 'every column the writer needs is present',
         CASE WHEN (
           SELECT count(*) FROM pg_attribute
           WHERE attrelid = to_regclass('public.crm_client_standing')
             AND NOT attisdropped
             AND attname IN (
               'id','user_id','contact_id','as_of','window_days','band',
               'sessions_settled','sessions_held','sessions_missed',
               'sessions_cancelled_by_client','sessions_cancelled_by_owner',
               'sessions_cancelled_unknown','instalments_due',
               'instalments_paid_on_time','instalments_paid_late',
               'instalments_overdue','refunds','proposals_declined',
               'miss_rate','late_rate','created_at'
             )
         ) = 21 THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 'one snapshot per client per day (unique user_id, contact_id, as_of)',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conrelid = to_regclass('public.crm_client_standing')
             AND contype = 'u'
             AND array_length(conkey, 1) = 3
         ) THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 'band is constrained to the four it may hold',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conrelid = to_regclass('public.crm_client_standing')
             AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%at_risk%'
         ) THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 'row level security is on',
         CASE WHEN COALESCE(
           (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.crm_client_standing')),
           false
         ) THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 'the owner may read their own rows, and only read',
         CASE WHEN (
           SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'crm_client_standing' AND cmd = 'SELECT'
         ) = 1 AND (
           SELECT count(*) FROM pg_policies
           WHERE schemaname = 'public' AND tablename = 'crm_client_standing' AND cmd <> 'SELECT'
         ) = 0 THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 'business ownership FK present',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint
           WHERE conname = 'crm_client_standing_business_fk'
             AND conrelid = to_regclass('public.crm_client_standing')
         ) THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 'both reads are indexed',
         CASE WHEN (
           SELECT count(*) FROM pg_indexes
           WHERE schemaname = 'public' AND tablename = 'crm_client_standing'
             AND indexname IN ('idx_crm_client_standing_latest', 'idx_crm_client_standing_attention')
         ) = 2 THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  /* Informational: nothing should have written to it yet. */
  SELECT 'rows so far (expected 0 until the job runs)',
         COALESCE((SELECT count(*)::text FROM public.crm_client_standing), 'table absent')
)
SELECT gate, result FROM checks ORDER BY gate;

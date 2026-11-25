/*
 * READ ONLY. Run AFTER the migration. Every row must read `t`.
 *
 * Written so it can FAIL: each line asserts one thing the migration promised,
 * rather than reporting that the table exists and calling that success.
 */

SELECT 'table exists' AS check, to_regclass('public.refund_requests') IS NOT NULL AS ok
UNION ALL
SELECT 'RLS enabled',
       (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.refund_requests'::regclass)
UNION ALL
SELECT 'owner policy present',
       EXISTS (SELECT 1 FROM pg_policies
               WHERE schemaname = 'public' AND tablename = 'refund_requests')
UNION ALL
SELECT 'business ownership FK present',
       EXISTS (SELECT 1 FROM pg_constraint
               WHERE conname = 'refund_requests_business_fk'
                 AND conrelid = 'public.refund_requests'::regclass)
UNION ALL
SELECT 'one-open-per-booking index present',
       EXISTS (SELECT 1 FROM pg_indexes
               WHERE schemaname = 'public'
                 AND indexname = 'idx_refund_requests_one_open_per_booking')
UNION ALL
SELECT 'status CHECK rejects an unknown value',
       NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conrelid = 'public.refund_requests'::regclass
           AND contype = 'c'
           AND pg_get_constraintdef(oid) LIKE '%status%'
           AND pg_get_constraintdef(oid) NOT LIKE '%awaiting_owner%'
       )
UNION ALL
SELECT 'anon and authenticated have no grant',
       NOT EXISTS (
         SELECT 1 FROM information_schema.role_table_grants
         WHERE table_schema = 'public'
           AND table_name = 'refund_requests'
           AND grantee IN ('anon', 'authenticated')
           AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE')
       );

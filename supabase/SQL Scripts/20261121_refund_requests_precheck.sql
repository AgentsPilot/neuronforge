/*
 * READ ONLY. Run before 20261121_a_client_can_ask_for_their_money_back.sql.
 *
 * Answers the four things that decide whether that migration is safe to paste,
 * and nothing else. It writes nothing and locks nothing.
 */

-- 1. Does the table already exist? (expected: f, on a first apply)
SELECT 'table already present' AS check,
       to_regclass('public.refund_requests') IS NOT NULL AS answer;

-- 2. Do the three tables it points at exist? (expected: all t)
SELECT 'crm_contacts present' AS check, to_regclass('public.crm_contacts') IS NOT NULL AS answer
UNION ALL
SELECT 'scheduling_bookings present', to_regclass('public.scheduling_bookings') IS NOT NULL
UNION ALL
SELECT 'business_profiles present', to_regclass('public.business_profiles') IS NOT NULL;

-- 3. Does `business_profiles.user_id` carry a unique constraint for the FK to
--    reference? Without one the business-ownership constraint cannot be added,
--    and the migration would fail on that statement alone. (expected: t)
SELECT 'business_profiles.user_id is unique' AS check,
       EXISTS (
         SELECT 1
         FROM pg_constraint c
         JOIN pg_attribute a
           ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
         WHERE c.conrelid = 'public.business_profiles'::regclass
           AND c.contype IN ('p', 'u')
           AND a.attname = 'user_id'
           AND cardinality(c.conkey) = 1
       ) AS answer;

-- 4. Is `gen_random_uuid()` available? (expected: t — pgcrypto or pg13+)
SELECT 'gen_random_uuid available' AS check,
       to_regprocedure('gen_random_uuid()') IS NOT NULL AS answer;

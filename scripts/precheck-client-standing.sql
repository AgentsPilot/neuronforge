/*
 * Pre-check for 20261128_how_a_client_has_behaved_over_time.sql
 *
 * Proves the shape the migration expects BEFORE it runs: the table is absent,
 * and the two tables it points at exist with the columns the foreign keys name.
 * A surprise shape refuses here rather than half-applying.
 *
 * Run through the read-only wrapper:  begin read only; <this>; commit;
 */

WITH checks AS (
  SELECT 'crm_client_standing is absent' AS gate,
         CASE WHEN to_regclass('public.crm_client_standing') IS NULL THEN 'ok' ELSE 'FAIL' END AS result
  UNION ALL
  SELECT 'crm_contacts exists',
         CASE WHEN to_regclass('public.crm_contacts') IS NOT NULL THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 'business_profiles.user_id exists (the ownership FK target)',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_attribute
           WHERE attrelid = 'public.business_profiles'::regclass
             AND attname = 'user_id' AND NOT attisdropped
         ) THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 'business_profiles.user_id is unique (a FK needs it)',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_constraint c
           JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
           WHERE c.conrelid = 'public.business_profiles'::regclass
             AND c.contype IN ('p', 'u')
             AND a.attname = 'user_id'
         ) THEN 'ok' ELSE 'FAIL' END
  UNION ALL
  SELECT 'no constraint named crm_client_standing_business_fk',
         CASE WHEN NOT EXISTS (
           SELECT 1 FROM pg_constraint WHERE conname = 'crm_client_standing_business_fk'
         ) THEN 'ok' ELSE 'FAIL' END
)
SELECT gate, result FROM checks ORDER BY gate;

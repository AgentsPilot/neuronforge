SET default_transaction_read_only = on;

WITH probe_invites AS (
  SELECT invite_row.id
  FROM public.business_os_invites AS invite_row
  WHERE invite_row.internal_reason = 'admin paid finalise probe'
),
probe_lineage AS (
  SELECT lineage_row.account_id
  FROM public.business_os_account_lineage AS lineage_row
  JOIN probe_invites ON probe_invites.id = lineage_row.invite_id
)
SELECT 'F11 rows left behind by the probe expected 0' AS check_name,
       CASE WHEN (SELECT count(*) FROM probe_invites) = 0 AND (SELECT count(*) FROM probe_lineage) = 0 THEN 'PASS' ELSE 'FAIL' END AS status,
       (SELECT count(*) FROM probe_invites) || ' probe invites  ' || (SELECT count(*) FROM probe_lineage) || ' probe lineage rows' AS detail;

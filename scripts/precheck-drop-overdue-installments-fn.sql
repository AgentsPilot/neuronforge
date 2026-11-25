/*
 * PRE-CHECK for 20261133_a_period_nobody_invoiced_is_not_late.sql
 *
 * Read-only. Run inside:
 *
 *     begin read only; <this file>; commit;
 *
 * Every GATE row must read `ok`, or apply nothing.
 *
 * Gates:
 *   P-1  the function exists, so this migration is removing something real and
 *        not silently doing nothing.
 *   P-2  it is the SECURITY DEFINER, zero-argument function the migration
 *        describes -- not some later redefinition that somebody fixed by hand
 *        and that a drop would now destroy.
 *   P-3  NOTHING depends on it. A view, trigger, default or another function
 *        referencing it would be broken by a non-CASCADE drop, and the drop
 *        would fail; this names the dependency first instead.
 *
 * Info (never a gate):
 *   P-4  how many periods are currently in the stranded state this function
 *        creates -- `overdue` with no invoice. These are NOT fixed by the
 *        migration; `billDueDatedStages` now reads them and raises invoices.
 *        Recorded so the apply has a before-figure.
 *   P-5  who can still execute it, for the record.
 */

/*
 * READ ONLY, DECLARED RATHER THAN MERELY INTENDED.
 *
 * Everything below is a SELECT, and the labels it prints name the thing it is
 * checking for — 'zero-argument and SECURITY DEFINER, as described'. The
 * SECURITY DEFINER surface guard's O-1 tripwire cannot tell a report LABEL
 * from a definition inside a string, so it exempts scripts that open by
 * putting the session beyond DDL. It is the right statement for this file on
 * its own merits: a precheck that could alter the database is not a precheck.
 */
SET default_transaction_read_only = on;

WITH
p1 AS (
  SELECT
    'P-1' AS check,
    'GATE' AS kind,
    'the function exists' AS item,
    CASE WHEN to_regprocedure('public.update_overdue_installments()') IS NOT NULL
         THEN 'ok' ELSE 'FAIL' END AS status,
    coalesce(to_regprocedure('public.update_overdue_installments()')::text, 'absent') AS detail
),
p2 AS (
  SELECT
    'P-2' AS check,
    'GATE' AS kind,
    'zero-argument and SECURITY DEFINER, as described' AS item,
    CASE WHEN count(*) = 1 THEN 'ok' ELSE 'FAIL' END AS status,
    coalesce(
      min('args=' || pronargs::text || ' security_definer=' || prosecdef::text),
      'not found'
    ) AS detail
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'update_overdue_installments'
    AND pronargs = 0
    AND prosecdef
),
p3 AS (
  SELECT
    'P-3' AS check,
    'GATE' AS kind,
    'nothing depends on it' AS item,
    CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 0 THEN 'no dependents'
         ELSE count(*)::text || ' dependent object(s)' END AS detail
  FROM pg_depend d
  JOIN pg_proc p ON p.oid = d.refobjid
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname = 'update_overdue_installments'
    AND d.deptype NOT IN ('i', 'a')
    AND d.classid <> 'pg_namespace'::regclass
),
p4 AS (
  SELECT
    'P-4' AS check,
    'INFO' AS kind,
    'periods already stranded: overdue with no invoice' AS item,
    'ok' AS status,
    count(*)::text || ' period(s)' ||
      CASE WHEN count(*) = 0 THEN ''
           ELSE ', totalling ' || string_agg(DISTINCT upper(currency), '/') END AS detail
  FROM public.payment_plan_installments
  WHERE status = 'overdue'
    AND invoice_id IS NULL
),
p5 AS (
  SELECT
    'P-5' AS check,
    'INFO' AS kind,
    'who can execute it' AS item,
    'ok' AS status,
    'public=' || has_function_privilege('public', 'public.update_overdue_installments()', 'EXECUTE')::text ||
    ' anon=' || has_function_privilege('anon', 'public.update_overdue_installments()', 'EXECUTE')::text ||
    ' authenticated=' || has_function_privilege('authenticated', 'public.update_overdue_installments()', 'EXECUTE')::text AS detail
)
SELECT * FROM p1
UNION ALL SELECT * FROM p2
UNION ALL SELECT * FROM p3
UNION ALL SELECT * FROM p4
UNION ALL SELECT * FROM p5
ORDER BY check;

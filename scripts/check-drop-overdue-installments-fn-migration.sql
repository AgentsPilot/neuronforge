/*
 * CHECKER for 20261133_a_period_nobody_invoiced_is_not_late.sql
 *
 * Read-only. Run inside:
 *
 *     begin read only; <this file>; commit;
 *
 * Returns 3 rows. Both GATE rows must read `ok`.
 *
 * Before the apply, C-1 must read `FAIL` -- that is what proves this checker
 * can detect the apply at all, and it is run once against the pre-apply state
 * for exactly that reason.
 *
 * Gates:
 *   C-1  the function is gone, under the exact name and signature the
 *        migration dropped.
 *   C-2  no function of that NAME survives under any other signature. A drop
 *        names one specific overload, so an accidental second definition
 *        (different argument list) would be left behind still able to strand
 *        periods -- which would make C-1 a false clean bill.
 *
 * Info (never a gate):
 *   C-3  periods still stranded (`overdue`, no invoice). The migration does not
 *        fix these and is not expected to: `billDueDatedStages` reads them and
 *        raises invoices, so this figure should fall on its own over the runs
 *        after the deploy. Compare with the pre-check's P-4.
 */

WITH
c1 AS (
  SELECT
    'C-1' AS check,
    'GATE' AS kind,
    'the function is gone' AS item,
    CASE WHEN to_regprocedure('public.update_overdue_installments()') IS NULL
         THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN to_regprocedure('public.update_overdue_installments()') IS NULL
         THEN 'absent, as intended'
         ELSE 'STILL PRESENT: ' || to_regprocedure('public.update_overdue_installments()')::text END AS detail
),
c2 AS (
  SELECT
    'C-2' AS check,
    'GATE' AS kind,
    'no overload of that name survives' AS item,
    CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END AS status,
    CASE WHEN count(*) = 0 THEN 'none'
         ELSE count(*)::text || ' remaining: ' ||
              string_agg(pg_get_function_identity_arguments(oid), ' | ') END AS detail
  FROM pg_proc
  WHERE pronamespace = 'public'::regnamespace
    AND proname = 'update_overdue_installments'
),
c3 AS (
  SELECT
    'C-3' AS check,
    'INFO' AS kind,
    'periods still stranded: overdue with no invoice' AS item,
    'ok' AS status,
    count(*)::text || ' period(s) - billDueDatedStages raises invoices for these' AS detail
  FROM public.payment_plan_installments
  WHERE status = 'overdue'
    AND invoice_id IS NULL
)
SELECT * FROM c1
UNION ALL SELECT * FROM c2
UNION ALL SELECT * FROM c3
ORDER BY check;

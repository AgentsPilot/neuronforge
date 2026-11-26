/*
 * READ ONLY. Run AFTER 20261123. Every row must read `t`.
 *
 * Written so it can FAIL: each line asserts one thing the migration promised,
 * rather than reporting that something exists and calling that success.
 */

SELECT 'queue columns present' AS check,
       (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'refund_requests'
          AND column_name IN ('claimed_by', 'claimed_at', 'attempts', 'next_attempt_at')) = 4 AS ok
UNION ALL
SELECT 'assessment columns present',
       (SELECT count(*) FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'refund_requests'
          AND column_name IN ('recommendation', 'recommended_amount', 'reasoning',
                              'client_message_draft', 'assessed_at', 'transaction_id')) = 6
UNION ALL
SELECT 'assessing is an allowed status',
       EXISTS (SELECT 1 FROM pg_constraint
               WHERE conname = 'refund_requests_status_check'
                 AND pg_get_constraintdef(oid) LIKE '%assessing%')
UNION ALL
/* The three readers of "open" must agree. This is the one the database owns. */
SELECT 'the open set in the unique index is the trio',
       (SELECT pg_get_indexdef(indexrelid) FROM pg_index
         WHERE indexrelid = 'public.idx_refund_requests_one_open_per_booking'::regclass)
       LIKE '%assessing%'
UNION ALL
SELECT 'the claim has its own index',
       EXISTS (SELECT 1 FROM pg_indexes
               WHERE schemaname = 'public' AND indexname = 'idx_refund_requests_claimable')
UNION ALL
SELECT 'claim RPC exists and skips locked rows',
       (SELECT prosrc FROM pg_proc WHERE proname = 'claim_due_refund_requests')
       LIKE '%SKIP LOCKED%'
UNION ALL
SELECT 'reaper gives up towards the owner, not a dead letter',
       (SELECT prosrc FROM pg_proc WHERE proname = 'reap_stale_refund_requests')
       LIKE '%awaiting_owner%'
UNION ALL
/*
 * ─────────────────────────────────────────────────────────────────────────────
 * REWRITTEN 2026-11-26. This asked `information_schema.role_routine_grants`,
 * which shows only grants whose grantor or grantee is a role the CALLER belongs
 * to. Run in the SQL editor as `postgres` it answers properly; run through a
 * read-only connection it sees zero rows of that view in total, so NOT EXISTS
 * is vacuously true and the row reads `t` however wide the grants are.
 *
 * Measured, not supposed: `supabase_read_only_user` sees 0 rows there.
 *
 * `has_function_privilege` resolves the same question from the ACL itself and
 * gives the same answer to every caller, which is the property a checker needs.
 * ─────────────────────────────────────────────────────────────────────────────
 */
SELECT 'neither RPC is callable by a browser',
       NOT has_function_privilege('anon',
             to_regprocedure('public.claim_due_refund_requests(uuid,int)'), 'EXECUTE')
       AND NOT has_function_privilege('authenticated',
             to_regprocedure('public.claim_due_refund_requests(uuid,int)'), 'EXECUTE')
       AND NOT has_function_privilege('anon',
             to_regprocedure('public.reap_stale_refund_requests(int,int)'), 'EXECUTE')
       AND NOT has_function_privilege('authenticated',
             to_regprocedure('public.reap_stale_refund_requests(int,int)'), 'EXECUTE')
UNION ALL
SELECT 'a refund settles the request it answers',
       EXISTS (SELECT 1 FROM pg_trigger
               WHERE tgname = 'settle_refund_request_on_refund_trigger'
                 AND tgrelid = 'public.payment_refunds'::regclass
                 AND NOT tgisinternal)
UNION ALL
/*
 * G-17 of the operator cleanup refuses every test-account check on an
 * unreviewed DELETE trigger over a table in its plan. This one must not be
 * one: `(tgtype & 8)` is the DELETE bit.
 */
SELECT 'that trigger does not fire on DELETE (G-17 stays green)',
       (SELECT (tgtype::integer & 8) = 0 FROM pg_trigger
         WHERE tgname = 'settle_refund_request_on_refund_trigger'
           AND tgrelid = 'public.payment_refunds'::regclass)
UNION ALL
/*
 * ─────────────────────────────────────────────────────────────────────────────
 * ADDED 2026-11-26, after this checker was run for the first time and the row
 * above came back `f`.
 *
 * The trigger was absent because the FUNCTION behind it was absent: the
 * migration's last statement block never landed, and `CREATE TRIGGER` on a
 * missing function is the error that stopped it. Checking the trigger alone
 * reports the symptom and not the cause, and after a repair the two can come
 * back separately — so the function is now asserted in its own right, with the
 * two properties that make it safe to exist.
 * ─────────────────────────────────────────────────────────────────────────────
 */
SELECT 'the function that trigger calls is actually defined',
       to_regprocedure('public.settle_refund_request_on_refund()') IS NOT NULL
UNION ALL
/*
 * Counted, not probed. `to_regprocedure` answers NULL for a function that is
 * not there, so `oid IN (a, b, NULL)` quietly matches fewer rows instead of
 * failing — a NOT EXISTS phrased over that list passes most convincingly when
 * all three functions are missing. Requiring THREE is what makes this row able
 * to fail.
 */
SELECT 'all three functions are SECURITY DEFINER with search_path pinned',
       (SELECT count(*) FROM pg_proc
         WHERE oid IN (to_regprocedure('public.claim_due_refund_requests(uuid,int)'),
                       to_regprocedure('public.reap_stale_refund_requests(int,int)'),
                       to_regprocedure('public.settle_refund_request_on_refund()'))
           AND prosecdef
           AND coalesce(proconfig::text, '') LIKE '%search_path%') = 3
UNION ALL
/* The grant check above covers the two RPCs. A SECURITY DEFINER trigger
   function is callable by name like any other, so it needs the same REVOKE —
   and `public` is the one that matters here, because EXECUTE is granted to it
   by default and both browser roles inherit it. */
SELECT 'nor is the trigger function callable by a browser',
       NOT has_function_privilege('anon',
             to_regprocedure('public.settle_refund_request_on_refund()'), 'EXECUTE')
       AND NOT has_function_privilege('authenticated',
             to_regprocedure('public.settle_refund_request_on_refund()'), 'EXECUTE')
UNION ALL
/*
 * The other direction, and the one a too-broad REVOKE breaks silently: the
 * cron drains this queue as the service role. Lock it out and nothing refunds,
 * with no error anywhere a client can see.
 */
SELECT 'and the service role can still run the queue',
       has_function_privilege('service_role',
         to_regprocedure('public.claim_due_refund_requests(uuid,int)'), 'EXECUTE')
       AND has_function_privilege('service_role',
         to_regprocedure('public.reap_stale_refund_requests(int,int)'), 'EXECUTE');

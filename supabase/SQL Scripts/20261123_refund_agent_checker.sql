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
SELECT 'neither RPC is callable by a browser',
       NOT EXISTS (
         SELECT 1 FROM information_schema.role_routine_grants
         WHERE routine_schema = 'public'
           AND routine_name IN ('claim_due_refund_requests', 'reap_stale_refund_requests')
           AND grantee IN ('anon', 'authenticated')
       )
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
           AND tgrelid = 'public.payment_refunds'::regclass);

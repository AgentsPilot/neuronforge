SET default_transaction_read_only = on;

SELECT obj.bucket_id, (storage.foldername(obj.name))[1] AS owner_id,
       count(*) AS files, pg_catalog.pg_size_pretty(sum((obj.metadata->>'size')::bigint)) AS bytes
FROM storage.objects AS obj
WHERE obj.bucket_id IN ('contact-documents', 'website-images')
GROUP BY 1, 2
ORDER BY sum((obj.metadata->>'size')::bigint) DESC NULLS LAST
LIMIT 10;

SELECT obj.bucket_id, count(*) AS export_files, pg_catalog.pg_size_pretty(sum((obj.metadata->>'size')::bigint)) AS export_bytes,
       max((obj.metadata->>'size')::bigint) AS largest_export_bytes
FROM storage.objects AS obj
WHERE obj.bucket_id = 'business-data-exports'
GROUP BY 1;

SELECT crm.user_id, count(*) AS contacts FROM public.crm_contacts AS crm GROUP BY 1 ORDER BY 2 DESC LIMIT 5;

SELECT act.user_id, count(*) AS activities FROM public.crm_activities AS act GROUP BY 1 ORDER BY 2 DESC LIMIT 5;

SELECT bkg.user_id, count(*) AS bookings FROM public.scheduling_bookings AS bkg GROUP BY 1 ORDER BY 2 DESC LIMIT 5;

SELECT pay.user_id, count(*) AS payments FROM public.payment_transactions AS pay GROUP BY 1 ORDER BY 2 DESC LIMIT 5;

SELECT st.relname, st.n_live_tup, pg_catalog.pg_size_pretty(pg_catalog.pg_total_relation_size(st.relid)) AS total_size
FROM pg_catalog.pg_stat_user_tables AS st
WHERE st.schemaname = 'public'
ORDER BY pg_catalog.pg_total_relation_size(st.relid) DESC
LIMIT 25;

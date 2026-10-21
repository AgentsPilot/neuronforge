SET default_transaction_read_only = on;

SET ROLE anon;

SELECT set_config('lockdown_probe.anon_rows', (SELECT count(*) FROM storage.objects WHERE storage.objects.bucket_id = 'website-images')::text, false);

RESET ROLE;

SELECT set_config('request.jwt.claims', COALESCE(json_build_object('sub', (SELECT left(storage.objects.name, 36) FROM storage.objects WHERE storage.objects.bucket_id = 'website-images' AND storage.objects.name ~ '^[0-9a-f-]{36}' ORDER BY storage.objects.created_at LIMIT 1), 'role', 'authenticated')::text, ''), false);

SET ROLE authenticated;

SELECT set_config('lockdown_probe.owner_rows', (SELECT count(*) FROM storage.objects WHERE storage.objects.bucket_id = 'website-images')::text, false);

RESET ROLE;

RESET "request.jwt.claims";

SELECT 'anon rows visible in website-images' AS probe, current_setting('lockdown_probe.anon_rows') AS rows_seen, '0' AS expected_after_apply
UNION ALL
SELECT 'signed in owner rows visible in website-images', current_setting('lockdown_probe.owner_rows'), '0'
UNION ALL
SELECT 'objects in website-images seen by the editor role', (SELECT count(*) FROM storage.objects WHERE storage.objects.bucket_id = 'website-images')::text, 'unchanged by the migration';

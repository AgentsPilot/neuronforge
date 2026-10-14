BEGIN;

SET LOCAL ROLE authenticated;

SELECT plugin_key, status FROM public.plugin_connections LIMIT 1;

SELECT access_token FROM public.plugin_connections LIMIT 1;

ROLLBACK;

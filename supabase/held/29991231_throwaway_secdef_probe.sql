CREATE FUNCTION public.throwaway_secdef_probe()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
AS $$ SELECT 1 $$;

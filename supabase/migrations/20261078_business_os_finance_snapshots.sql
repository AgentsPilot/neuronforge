BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.business_os_finance_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  as_of_date date NOT NULL,
  metric text NOT NULL,
  dimension text NOT NULL,
  unit text NOT NULL,
  value numeric(18,6) NOT NULL,
  taken_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_os_finance_snapshots_pkey PRIMARY KEY (id)
);

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_metric_shape CHECK (metric ~ '^[a-z][a-z0-9_]{0,47}$');

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_dimension_shape CHECK (dimension ~ '^([a-z][a-z0-9_]{0,47}|tier:[a-z0-9_-]{1,40})$');

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_unit_known CHECK (unit IN ('accounts', 'credits'));

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_value_not_negative CHECK (value >= 0);

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_accounts_whole CHECK (unit <> 'accounts' OR value = trunc(value));

ALTER TABLE public.business_os_finance_snapshots ADD CONSTRAINT business_os_finance_snapshots_day_ended CHECK (taken_at >= ((as_of_date + 1)::timestamp AT TIME ZONE 'UTC'));

CREATE UNIQUE INDEX business_os_finance_snapshots_day_metric_key ON public.business_os_finance_snapshots (as_of_date, metric, dimension);

COMMENT ON TABLE public.business_os_finance_snapshots IS 'One row per platform figure per UTC day  as_of_date is the day whose end the state describes  Counts of accounts and amounts of credits only  No money and no account  Append only  Written only by the nightly finance snapshot job  Server only with no client grant  Never purged';

ALTER TABLE public.business_os_finance_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_os_finance_snapshots FROM PUBLIC;

REVOKE ALL ON TABLE public.business_os_finance_snapshots FROM anon;

REVOKE ALL ON TABLE public.business_os_finance_snapshots FROM authenticated;

REVOKE ALL ON TABLE public.business_os_finance_snapshots FROM service_role;

GRANT SELECT ON TABLE public.business_os_finance_snapshots TO service_role;

GRANT INSERT (as_of_date, metric, dimension, unit, value) ON TABLE public.business_os_finance_snapshots TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

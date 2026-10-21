DO $probe$
DECLARE
  v_user_text text := 'paste-your-user-id-here';
  v_admin     uuid := '00000000-0000-4000-8000-0000000000ad';
  v_me        text := current_user;
  v_user      uuid;
  v_row       record;
  v_outcome   text;
  v_job       uuid;
  v_retry     timestamptz;
  v_first     uuid;
  v_count     bigint;
  v_raised    boolean;
BEGIN
  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'PROBE REFUSED: this session is read-only. Open a new SQL editor tab and run only this probe';
  END IF;
  IF v_user_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'PROBE REFUSED: paste your own user id (a uuid) on the v_user_text line first';
  END IF;
  v_user := v_user_text::uuid;
  IF NOT EXISTS (SELECT 1 FROM auth.users AS u WHERE u.id = v_user) THEN
    RAISE EXCEPTION 'PROBE REFUSED: no login has the id %', v_user;
  END IF;
  IF pg_catalog.to_regprocedure('public.business_os_data_export_start(uuid, uuid, text)') IS NULL THEN
    RAISE EXCEPTION 'PROBE REFUSED: apply 20261074_business_os_data_exports first';
  END IF;

  SET LOCAL ROLE service_role;
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PROBE FAIL setup: could not switch to service_role';
  END IF;

  DELETE FROM public.business_os_data_exports AS job WHERE job.user_id = v_user;
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'started' OR v_job IS NULL OR v_retry IS NOT NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P1: expected started with a job id, got %', v_outcome;
  END IF;
  v_count := (SELECT count(*) FROM public.business_os_data_exports AS job
               WHERE job.user_id = v_user AND job.id = v_job AND job.status = 'running'
                 AND job.requested_by_kind = 'owner' AND job.requested_by = v_user);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL P1: expected one running owner row, found %', v_count;
  END IF;
  v_first := v_job;
  RAISE NOTICE 'P1 PASS: first start as service_role is started';

  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'in_progress' OR v_job IS NOT NULL
     OR v_retry IS DISTINCT FROM (SELECT job.created_at + interval '90 seconds' FROM public.business_os_data_exports AS job WHERE job.id = v_first AND job.user_id = v_user) THEN
    RAISE EXCEPTION 'PROBE FAIL P2: expected in_progress retrying at the first row plus 90 seconds, got % %', v_outcome, v_retry;
  END IF;
  v_count := (SELECT count(*) FROM public.business_os_data_exports AS job WHERE job.user_id = v_user);
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL P2: a second start added a row, found %', v_count;
  END IF;
  RAISE NOTICE 'P2 PASS: a second start while one runs is in_progress';

  UPDATE public.business_os_data_exports AS job
     SET status = 'ready', finished_at = now(), ready_at = now(), expires_at = now() + interval '72 hours', updated_at = now()
   WHERE job.id = v_first AND job.user_id = v_user;
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'started' OR v_job IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P3: expected the second export started, got %', v_outcome;
  END IF;
  UPDATE public.business_os_data_exports AS job
     SET status = 'ready', finished_at = now(), ready_at = now(), expires_at = now() + interval '72 hours', updated_at = now()
   WHERE job.id = v_job AND job.user_id = v_user;
  RAISE NOTICE 'P3 PASS: a second export starts once the first is ready';

  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'started' OR v_job IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P4: expected the third export started, got %', v_outcome;
  END IF;
  UPDATE public.business_os_data_exports AS job
     SET status = 'ready', finished_at = now(), ready_at = now(), expires_at = now() + interval '72 hours', updated_at = now()
   WHERE job.id = v_job AND job.user_id = v_user;
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'daily_limit' OR v_job IS NOT NULL OR v_retry IS DISTINCT FROM now() + interval '24 hours' THEN
    RAISE EXCEPTION 'PROBE FAIL P4: expected daily_limit retrying in 24 hours, got % %', v_outcome, v_retry;
  END IF;
  RAISE NOTICE 'P4 PASS: the fourth export in 24 hours is daily_limit';

  DELETE FROM public.business_os_data_exports AS job WHERE job.user_id = v_user;
  INSERT INTO public.business_os_data_exports AS seed (user_id, requested_by, requested_by_kind, status, created_at)
  VALUES (v_user, v_user, 'owner', 'running', now() - interval '91 seconds')
  RETURNING seed.id INTO v_first;
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'started' OR v_job IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P5: a 91 second old running row still blocked, got %', v_outcome;
  END IF;
  v_count := (SELECT count(*) FROM public.business_os_data_exports AS job
               WHERE job.id = v_first AND job.user_id = v_user AND job.status = 'failed'
                 AND job.failure_reason = 'timeout' AND job.finished_at = now());
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL P5: the stale row was not turned to failed timeout';
  END IF;
  RAISE NOTICE 'P5 PASS: a 91 second old running row is reaped and does not block';

  DELETE FROM public.business_os_data_exports AS job WHERE job.user_id = v_user;
  INSERT INTO public.business_os_data_exports AS seed (user_id, requested_by, requested_by_kind, status, created_at)
  VALUES (v_user, v_user, 'owner', 'running', now() - interval '89 seconds');
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'in_progress' OR v_retry IS DISTINCT FROM now() + interval '1 second' THEN
    RAISE EXCEPTION 'PROBE FAIL P6: an 89 second old running row did not block, got % %', v_outcome, v_retry;
  END IF;
  RAISE NOTICE 'P6 PASS: an 89 second old running row blocks';

  DELETE FROM public.business_os_data_exports AS job WHERE job.user_id = v_user;
  INSERT INTO public.business_os_data_exports AS seed (user_id, requested_by, requested_by_kind, status, failure_reason, created_at, finished_at)
  SELECT v_user, v_user, 'owner', 'failed', 'error', now() - (step.n * interval '10 minutes'), now() - (step.n * interval '9 minutes')
  FROM pg_catalog.generate_series(1, 3) AS step (n);
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'started' THEN
    RAISE EXCEPTION 'PROBE FAIL P7: three failed exports were counted, got %', v_outcome;
  END IF;
  RAISE NOTICE 'P7 PASS: failed exports never count';

  DELETE FROM public.business_os_data_exports AS job WHERE job.user_id = v_user;
  INSERT INTO public.business_os_data_exports AS seed (user_id, requested_by, requested_by_kind, status, created_at, finished_at, ready_at, expires_at, expired_at)
  SELECT v_user, v_user, 'owner', 'expired', now() - (step.n * interval '10 minutes'), now() - (step.n * interval '9 minutes'),
         now() - (step.n * interval '9 minutes'), now() - (step.n * interval '9 minutes') + interval '72 hours', now()
  FROM pg_catalog.generate_series(1, 3) AS step (n);
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'daily_limit' OR v_retry IS DISTINCT FROM now() - interval '30 minutes' + interval '24 hours' THEN
    RAISE EXCEPTION 'PROBE FAIL P8: three expired exports were not counted, got % %', v_outcome, v_retry;
  END IF;
  RAISE NOTICE 'P8 PASS: expired exports count';

  DELETE FROM public.business_os_data_exports AS job WHERE job.user_id = v_user;
  INSERT INTO public.business_os_data_exports AS seed (user_id, requested_by, requested_by_kind, status, created_at, finished_at, ready_at, expires_at)
  SELECT v_user, v_user, 'owner', 'ready', now() - (step.n * interval '10 minutes'), now() - (step.n * interval '9 minutes'),
         now() - (step.n * interval '9 minutes'), now() - (step.n * interval '9 minutes') + interval '72 hours'
  FROM pg_catalog.generate_series(1, 2) AS step (n);
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_admin, 'admin') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'started' OR v_job IS NULL THEN
    RAISE EXCEPTION 'PROBE FAIL P9: the admin start was refused, got %', v_outcome;
  END IF;
  v_count := (SELECT count(*) FROM public.business_os_data_exports AS job
               WHERE job.id = v_job AND job.user_id = v_user AND job.requested_by = v_admin AND job.requested_by_kind = 'admin');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'PROBE FAIL P9: the admin row does not name the admin as requester';
  END IF;
  UPDATE public.business_os_data_exports AS job
     SET status = 'ready', finished_at = now(), ready_at = now(), expires_at = now() + interval '72 hours', updated_at = now()
   WHERE job.id = v_job AND job.user_id = v_user;
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'daily_limit' THEN
    RAISE EXCEPTION 'PROBE FAIL P9: an admin-started export did not count against the owner, got %', v_outcome;
  END IF;
  RAISE NOTICE 'P9 PASS: an admin-started export counts against the owner';

  DELETE FROM public.business_os_data_exports AS job WHERE job.user_id = v_user;
  INSERT INTO public.business_os_data_exports AS seed (user_id, requested_by, requested_by_kind, status, created_at, finished_at, ready_at, expires_at)
  SELECT v_user, v_user, 'owner', 'ready', now() - interval '24 hours 1 second', now() - interval '24 hours',
         now() - interval '24 hours', now() - interval '24 hours' + interval '72 hours'
  FROM pg_catalog.generate_series(1, 3) AS step (n);
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'started' THEN
    RAISE EXCEPTION 'PROBE FAIL P10: exports older than 24 hours still counted, got %', v_outcome;
  END IF;
  DELETE FROM public.business_os_data_exports AS job WHERE job.user_id = v_user;
  INSERT INTO public.business_os_data_exports AS seed (user_id, requested_by, requested_by_kind, status, created_at, finished_at, ready_at, expires_at)
  SELECT v_user, v_user, 'owner', 'ready', now() - interval '23 hours 59 minutes', now() - interval '23 hours 58 minutes',
         now() - interval '23 hours 58 minutes', now() - interval '23 hours 58 minutes' + interval '72 hours'
  FROM pg_catalog.generate_series(1, 3) AS step (n);
  v_outcome := NULL; v_job := NULL; v_retry := NULL;
  FOR v_row IN SELECT r.result_outcome, r.result_job_id, r.result_retry_at FROM public.business_os_data_export_start(v_user, v_user, 'owner') AS r LOOP
    v_outcome := v_row.result_outcome; v_job := v_row.result_job_id; v_retry := v_row.result_retry_at;
  END LOOP;
  IF v_outcome IS DISTINCT FROM 'daily_limit' OR v_retry IS DISTINCT FROM now() + interval '1 minute' THEN
    RAISE EXCEPTION 'PROBE FAIL P10: exports 23 hours 59 minutes old did not count, got % %', v_outcome, v_retry;
  END IF;
  RAISE NOTICE 'P10 PASS: the rolling 24 hour boundary holds';

  v_raised := false;
  BEGIN
    PERFORM 1 FROM public.business_os_data_export_start(NULL, v_user, 'owner');
  EXCEPTION WHEN invalid_parameter_value THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'PROBE FAIL P11: a NULL user id did not raise 22023'; END IF;
  v_raised := false;
  BEGIN
    PERFORM 1 FROM public.business_os_data_export_start(v_user, v_user, 'bogus');
  EXCEPTION WHEN invalid_parameter_value THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'PROBE FAIL P11: an unknown kind did not raise 22023'; END IF;
  v_raised := false;
  BEGIN
    PERFORM 1 FROM public.business_os_data_export_start(v_user, v_admin, 'owner');
  EXCEPTION WHEN invalid_parameter_value THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'PROBE FAIL P11: an owner export with another requester did not raise 22023'; END IF;
  v_raised := false;
  BEGIN
    PERFORM 1 FROM public.business_os_data_export_start(v_admin, v_admin, 'owner');
  EXCEPTION WHEN foreign_key_violation THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'PROBE FAIL P11: an id with no login did not raise 23503'; END IF;
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'PROBE FAIL P11: the role changed inside the argument checks';
  END IF;
  RAISE NOTICE 'P11 PASS: bad arguments raise 22023 and an unknown login raises 23503';

  RESET ROLE;
  IF current_user <> v_me THEN
    RAISE EXCEPTION 'PROBE FAIL setup: the role was not restored after service_role';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_raised := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.business_os_data_exports AS job LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'PROBE FAIL P12: authenticated could read the table'; END IF;
  IF current_user <> v_me THEN RAISE EXCEPTION 'PROBE FAIL P12: the role was not restored'; END IF;
  v_raised := false;
  BEGIN
    SET LOCAL ROLE authenticated;
    PERFORM 1 FROM public.business_os_data_export_start(v_user, v_user, 'owner');
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'PROBE FAIL P12: authenticated could call the start function'; END IF;
  IF current_user <> v_me THEN RAISE EXCEPTION 'PROBE FAIL P12: the role was not restored'; END IF;
  RAISE NOTICE 'P12 PASS: authenticated gets 42501 on the table and the function';

  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.json_build_object('role', 'anon')::text, true);
  v_raised := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.business_os_data_exports AS job LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'PROBE FAIL P13: anon could read the table'; END IF;
  IF current_user <> v_me THEN RAISE EXCEPTION 'PROBE FAIL P13: the role was not restored'; END IF;
  v_raised := false;
  BEGIN
    SET LOCAL ROLE anon;
    PERFORM 1 FROM public.business_os_data_export_start(v_user, v_user, 'owner');
  EXCEPTION WHEN insufficient_privilege THEN v_raised := true;
  END;
  IF NOT v_raised THEN RAISE EXCEPTION 'PROBE FAIL P13: anon could call the start function'; END IF;
  IF current_user <> v_me THEN RAISE EXCEPTION 'PROBE FAIL P13: the role was not restored'; END IF;
  RAISE NOTICE 'P13 PASS: anon gets 42501 on the table and the function';

  RAISE NOTICE 'P14 INFO: two simultaneous sessions cannot be shown in one transaction. The advisory lock and the unique index are pinned by the migration test';

  RAISE EXCEPTION 'PROBE PASS P1 to P14. This error is expected and rolls everything back';
END
$probe$;

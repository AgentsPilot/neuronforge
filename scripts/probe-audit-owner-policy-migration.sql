DO $probe$
DECLARE
  v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';
  v_owner uuid;
  v_stranger uuid := gen_random_uuid();
  v_nonce text := 'bd26_probe_' || replace(gen_random_uuid()::text, chr(45), '');
  v_tag jsonb;
  v_live_owner uuid := '39c134b8fab349ebb05fc174ce4a8229'::uuid;
  v_live_row uuid := 'f29556b8bf4c4a55ab247165acdf4866'::uuid;
  v_live_ready boolean := false;
  v_fail boolean := false;
  v_report text := '';
  v_inserted bigint;
  v_own_ordinary bigint;
  v_own_lot bigint;
  v_own_plan bigint;
  v_own_period bigint;
  v_own_low_line bigint;
  v_own_ai bigint;
  v_own_queue_item bigint;
  v_own_stranger bigint;
  v_own_total bigint;
  v_stranger_own bigint;
  v_stranger_owner bigint;
  v_stranger_total bigint;
  v_service_total bigint;
  v_live_seen bigint;
BEGIN
  IF position('YOUR_OWN_USER_ID' IN v_owner_text) > 0 THEN
    RAISE EXCEPTION 'PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE with your own user id and run it again';
  END IF;

  BEGIN
    v_owner := v_owner_text::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'PROBE SKIPPED  the pasted value is not a valid user id  paste only the id between the quotes with no spaces and run it again';
  END;

  IF current_setting('transaction_read_only') = 'on' THEN
    RAISE EXCEPTION 'PROBE SKIPPED  this session is read only  open a new SQL editor tab or run RESET default_transaction_read_only on its own and run the probe again';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = v_owner) THEN
    RAISE EXCEPTION 'PROBE SKIPPED  that user id is not an account on this database';
  END IF;

  v_tag := jsonb_build_object('bd26_probe', v_nonce);

  BEGIN
    INSERT INTO public.audit_trail (user_id, action, entity_type, details)
    VALUES (v_owner, 'SETTINGS_PROFILE_UPDATED', 'settings', v_tag),
           (v_owner, 'BUSINESS_AI_ACTION_COMPLETED', 'ai_action', v_tag),
           (v_owner, 'BOS_ENTITLEMENT_TIER_ASSIGNED', 'business_os_account_plan', v_tag),
           (v_owner, 'BOS_CREDIT_LOT_GRANTED', 'business_os_credit_lot', v_tag),
           (v_owner, 'BOS_CREDIT_LOW_LINE_CROSSED', 'business_os_credit_period', v_tag),
           (v_owner, 'BOS_QUEUE_ITEM_CANCELLED', 'bos_queue_item', v_tag),
           (v_stranger, 'SETTINGS_PROFILE_UPDATED', 'settings', v_tag);
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE SKIPPED  the probe rows could not be inserted ' || SQLSTATE || ' ' || SQLERRM;
  END;

  SELECT count(*) INTO v_inserted FROM public.audit_trail AS audit_row WHERE audit_row.details @> v_tag;
  v_report := v_report || chr(10) || 'P00 INFO ' || v_inserted || ' probe rows inserted for the owner and a random stranger id';

  v_live_ready := EXISTS (SELECT 1 FROM auth.users AS auth_user WHERE auth_user.id = v_live_owner)
                  AND EXISTS (SELECT 1 FROM public.audit_trail AS audit_row WHERE audit_row.id = v_live_row AND audit_row.user_id = v_live_owner);

  SET LOCAL ROLE authenticated;
  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);

  BEGIN
    SELECT count(*) FILTER (WHERE audit_row.entity_type = 'settings' AND audit_row.user_id = v_owner),
           count(*) FILTER (WHERE audit_row.entity_type = 'business_os_credit_lot'),
           count(*) FILTER (WHERE audit_row.entity_type = 'business_os_account_plan'),
           count(*) FILTER (WHERE audit_row.entity_type = 'business_os_credit_period'),
           count(*) FILTER (WHERE audit_row.action = 'BOS_CREDIT_LOW_LINE_CROSSED'),
           count(*) FILTER (WHERE audit_row.entity_type = 'ai_action'),
           count(*) FILTER (WHERE audit_row.entity_type = 'bos_queue_item'),
           count(*) FILTER (WHERE audit_row.user_id = v_stranger),
           count(*)
    INTO v_own_ordinary, v_own_lot, v_own_plan, v_own_period, v_own_low_line, v_own_ai, v_own_queue_item, v_own_stranger, v_own_total
    FROM public.audit_trail AS audit_row
    WHERE audit_row.details @> v_tag;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  the owner read raised ' || SQLSTATE || ' ' || SQLERRM;
  END;

  IF v_own_ordinary = 1 THEN
    v_report := v_report || chr(10) || 'P01 PASS the owner sees their own ordinary row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P01 FAIL the owner saw ' || v_own_ordinary || ' of their own ordinary row';
  END IF;

  IF v_own_lot = 0 THEN
    v_report := v_report || chr(10) || 'P02 PASS the owner cannot see the business_os_credit_lot row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P02 FAIL the owner saw ' || v_own_lot || ' business_os_credit_lot rows';
  END IF;

  IF v_own_plan = 0 THEN
    v_report := v_report || chr(10) || 'P03 PASS the owner cannot see the business_os_account_plan row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P03 FAIL the owner saw ' || v_own_plan || ' business_os_account_plan rows';
  END IF;

  IF v_own_period = 0 AND v_own_low_line = 0 THEN
    v_report := v_report || chr(10) || 'P04 PASS the owner cannot see the BOS_CREDIT_LOW_LINE_CROSSED row of type business_os_credit_period';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P04 FAIL the owner saw ' || v_own_period || ' business_os_credit_period rows and ' || v_own_low_line || ' BOS_CREDIT_LOW_LINE_CROSSED rows';
  END IF;

  IF v_own_ai = 0 THEN
    v_report := v_report || chr(10) || 'P05 PASS the owner still cannot see the ai_action row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P05 FAIL the owner saw ' || v_own_ai || ' ai_action rows';
  END IF;

  IF v_own_queue_item = 0 THEN
    v_report := v_report || chr(10) || 'P10 PASS the owner cannot see the bos_queue_item row';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P10 FAIL the owner saw ' || v_own_queue_item || ' bos_queue_item rows';
  END IF;

  IF v_own_stranger = 0 AND v_own_total = 1 THEN
    v_report := v_report || chr(10) || 'P06 PASS the owner sees none of the stranger rows and exactly 1 probe row in all';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P06 FAIL the owner saw ' || v_own_stranger || ' stranger rows and ' || v_own_total || ' probe rows in all';
  END IF;

  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('sub', v_stranger::text, 'role', 'authenticated')::text, true);

  BEGIN
    SELECT count(*) FILTER (WHERE audit_row.user_id = v_stranger),
           count(*) FILTER (WHERE audit_row.user_id = v_owner),
           count(*)
    INTO v_stranger_own, v_stranger_owner, v_stranger_total
    FROM public.audit_trail AS audit_row
    WHERE audit_row.details @> v_tag;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  the stranger read raised ' || SQLSTATE || ' ' || SQLERRM;
  END;

  IF v_stranger_own = 1 AND v_stranger_owner = 0 AND v_stranger_total = 1 THEN
    v_report := v_report || chr(10) || 'P07 PASS the stranger sees only their own row and none of the owner rows';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P07 FAIL the stranger saw ' || v_stranger_own || ' own rows and ' || v_stranger_owner || ' owner rows';
  END IF;

  RESET ROLE;
  SET LOCAL ROLE service_role;
  PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                     json_build_object('role', 'service_role')::text, true);

  BEGIN
    SELECT count(*) INTO v_service_total FROM public.audit_trail AS audit_row WHERE audit_row.details @> v_tag;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  the service_role read raised ' || SQLSTATE || ' ' || SQLERRM;
  END;

  IF v_service_total = 7 THEN
    v_report := v_report || chr(10) || 'P08 PASS service_role sees all 7 probe rows';
  ELSE
    v_fail := true;
    v_report := v_report || chr(10) || 'P08 FAIL service_role saw ' || v_service_total || ' of 7 probe rows';
  END IF;

  IF v_live_ready THEN
    RESET ROLE;
    SET LOCAL ROLE authenticated;
    PERFORM set_config(concat_ws(chr(46), 'request', 'jwt', 'claims'),
                       json_build_object('sub', v_live_owner::text, 'role', 'authenticated')::text, true);
    BEGIN
      SELECT count(*) INTO v_live_seen FROM public.audit_trail AS audit_row WHERE audit_row.id = v_live_row;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION USING MESSAGE = 'PROBE FAIL  the live owner read raised ' || SQLSTATE || ' ' || SQLERRM;
    END;
    IF v_live_seen = 0 THEN
      v_report := v_report || chr(10) || 'P09 INFO the live credit lot row is invisible to its own account';
    ELSE
      v_fail := true;
      v_report := v_report || chr(10) || 'P09 FAIL the live credit lot row is visible to its own account';
    END IF;
  ELSE
    v_report := v_report || chr(10) || 'P09 INFO skipped  the live credit lot row or its account is not on this database';
  END IF;

  RAISE EXCEPTION USING MESSAGE = 'PROBE ' || CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END
    || '  this error is expected and rolls everything back' || v_report;
END
$probe$;

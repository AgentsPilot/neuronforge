BEGIN;

SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  pin_agent_hex text := 'FILL_AGENT_ID';
  pin_old_user_hex text := 'FILL_OLD_USER_ID';
  pin_new_owner_hex text := 'FILL_NEW_OWNER_ID';
  pin_agent uuid;
  pin_old_user uuid;
  pin_new_owner uuid;
  changed_rows integer;
BEGIN
  IF length(pin_agent_hex) <> 32 OR ltrim(pin_agent_hex, '0123456789abcdef') <> ''
     OR length(pin_old_user_hex) <> 32 OR ltrim(pin_old_user_hex, '0123456789abcdef') <> ''
     OR length(pin_new_owner_hex) <> 32 OR ltrim(pin_new_owner_hex, '0123456789abcdef') <> '' THEN
    RAISE EXCEPTION USING MESSAGE = 'D0b reverse pins are not filled in as 32 lowercase hex digits so nothing was applied';
  END IF;

  pin_agent := pin_agent_hex::uuid;
  pin_old_user := pin_old_user_hex::uuid;
  pin_new_owner := pin_new_owner_hex::uuid;

  IF md5(pin_agent::text) IS DISTINCT FROM '2a4cf06b64f83d1f077506323dad7d7d' THEN
    RAISE EXCEPTION USING MESSAGE = 'D0b reverse agent is not the D0a pinned agent so nothing was applied';
  END IF;

  IF pin_old_user = pin_new_owner THEN
    RAISE EXCEPTION USING MESSAGE = 'D0b reverse old user and new owner are the same so nothing was applied';
  END IF;

  IF (SELECT count(*)
      FROM public.agent_stats AS mismatch_row
      JOIN public.agents AS mismatch_agent ON mismatch_agent.id = mismatch_row.agent_id
      WHERE mismatch_agent.user_id IS DISTINCT FROM mismatch_row.user_id) <> 0 THEN
    RAISE EXCEPTION USING MESSAGE = 'D0b reverse agent_stats mismatch count is not 0 before the change so nothing was applied';
  END IF;

  UPDATE public.agent_stats
     SET user_id = pin_old_user
   WHERE agent_stats.agent_id = pin_agent
     AND agent_stats.user_id = pin_new_owner
     AND EXISTS (
       SELECT 1 FROM public.agents AS owned_agent
       WHERE owned_agent.id = agent_stats.agent_id
         AND owned_agent.user_id = pin_new_owner
     );

  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'D0b reverse changed ' || changed_rows || ' rows instead of exactly 1 so nothing was applied';
  END IF;

  IF (SELECT count(*)
      FROM public.agent_stats AS mismatch_row
      JOIN public.agents AS mismatch_agent ON mismatch_agent.id = mismatch_row.agent_id
      WHERE mismatch_agent.user_id IS DISTINCT FROM mismatch_row.user_id) <> 1 THEN
    RAISE EXCEPTION USING MESSAGE = 'D0b reverse agent_stats mismatch count is not 1 after the change so nothing was applied';
  END IF;

  IF (SELECT md5(string_agg(mismatch_row.agent_id::text, chr(44) ORDER BY mismatch_row.agent_id::text COLLATE "C"))
      FROM public.agent_stats AS mismatch_row
      JOIN public.agents AS mismatch_agent ON mismatch_agent.id = mismatch_row.agent_id
      WHERE mismatch_agent.user_id IS DISTINCT FROM mismatch_row.user_id) IS DISTINCT FROM '2a4cf06b64f83d1f077506323dad7d7d' THEN
    RAISE EXCEPTION USING MESSAGE = 'D0b reverse the restored mismatch set is not the D0a pin so nothing was applied';
  END IF;
END
$$;

COMMIT;

SELECT 'D0b reverse done' AS step,
       replace(agent_stats.agent_id::text, chr(45), '') AS agent_hex,
       'FILL_NEW_OWNER_ID' AS before_user_hex,
       replace(agent_stats.user_id::text, chr(45), '') AS after_user_hex,
       replace(agents.user_id::text, chr(45), '') AS agent_owner_hex,
       CASE WHEN agents.user_id = agent_stats.user_id THEN 'row user is the agent owner' ELSE 'row user differs from the agent owner' END AS ownership,
       agent_stats.run_count,
       agent_stats.success_count,
       agent_stats.last_run_at
FROM public.agent_stats
JOIN public.agents ON agents.id = agent_stats.agent_id
WHERE agent_stats.agent_id = 'FILL_AGENT_ID'::uuid;

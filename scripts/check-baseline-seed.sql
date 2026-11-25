-- Seed checker for PROD-2: proves the reference-data copy (workplan section 6.2).
--
-- Read-only. It reads the 19 seed tables, the bos_cron_run_recording table
-- and two sequences, and prints row counts and md5 hashes only, never a row.
-- Run it on both sides with the SAME client and the same session settings,
-- then compare the two outputs row by row.
--
-- WHERE IT RUNS
--   - Inside the seed export (U4, staging) and the seed import (U5 and U5r,
--     production), through psql. The export writes its rows from the export
--     snapshot, and the import compares its own rows with them and refuses on
--     any difference. That in-transaction comparison is the run of record.
--   - Through execute_sql (DO), summary rows only, without the SET line and
--     wrapped in begin read only ... commit, per supabase-ops section 1. A run
--     on staging after the export may differ from the export snapshot, because
--     reference data is edited by admins on each environment (forward rule 6).
--     That is information, not a failure.
--
-- HOW TO READ IT
--   1. VERDICT must be PASS. FAIL means a seed table is empty, the
--      bos_cron_run_recording table does not hold exactly one row, or a
--      serial sequence would hand out an id that is already taken.
--   2. Compare CONTEXT KEY first. If it differs the comparison is VOID, not
--      FAIL. to_jsonb writes timestamps, floats, intervals and bytea by the
--      session settings in S00 (SA B-9). Re-run both sides in one client.
--   3. Then compare SEED KEY (S01 to S19). Equal means every seed table holds
--      the same rows. Unequal is a FAIL: compare the S rows to find the tables.
--
-- ROW COUNT. Returns exactly 25 rows: VERDICT, S00 to S21, CONTEXT KEY and
-- SEED KEY. Fewer rows is a failed check (supabase-ops section 1).
--
-- WHAT IS HASHED. Each row of a seed table as to_jsonb, minus the columns the
-- export nulls at the source (SA R-2: updated_by on four tables, and the two
-- price-proposal columns of ai_model_pricing), with the admin_users settings
-- key emptied the way the export empties it (SA R-3). The same transform runs
-- on both sides, so a faithful copy compares equal. Lines are sorted with
-- COLLATE C before hashing.
--
-- S20 checks that bos_cron_run_recording holds exactly one row and never reads
-- its content, because production writes its own (OQ-15 class b). S21 checks
-- that the two serial sequences would not hand out an id already taken, and
-- that no other seed table owns a sequence (SA R-2).
--
-- A seed table that does not exist is an SQL error, not a FAIL row: there is
-- nothing to compare on a project without the schema. The empty-project proof
-- is the parity checker (F1).
--
-- ENCODING. Every hash is computed on the server, in the server encoding, so
-- the console code page and client_encoding never change a row of the output.
-- No transaction control and no client_min_messages setting: the seed import
-- runs this inside the apply transaction, where warnings must stay visible.
--
-- PRIVACY. Counts and md5 hashes of reference data only. The output can be
-- shared. The seed rows themselves stay in the private baseline folder.
--
-- PASTE SAFETY. ASCII only, LF line endings, no psql meta-commands, no
-- single-letter aliases, and the standalone word the SQL editor misparses
-- appears nowhere. Every table is schema-qualified, because the seed import
-- runs it after the dump has emptied search_path.
--
-- @see docs/workplans/prod-2-schema-baseline-workplan.md sections 6 and 19
-- @see supabase/baseline/prove-seed-checker-can-fail.psql (F6: it can fail)

SET default_transaction_read_only = on;

WITH seed_lines AS (
  -- [block S00]
  -- The session settings that change how to_jsonb writes a value (SA B-9).
  SELECT 'S00'::text AS code,
         format('TimeZone=%s | DateStyle=%s | IntervalStyle=%s | extra_float_digits=%s | bytea_output=%s | server_encoding=%s',
                current_setting('TimeZone'), current_setting('DateStyle'),
                current_setting('IntervalStyle'), current_setting('extra_float_digits'),
                current_setting('bytea_output'), current_setting('server_encoding')) AS line,
         true AS gate_ok
  UNION ALL
  -- [block S01]
  SELECT 'S01', (to_jsonb(src) - ARRAY['proposal_id', 'proposal_line_id']::text[])::text, true
  FROM public.ai_model_pricing AS src
  UNION ALL
  -- [block S02]
  SELECT 'S02', (to_jsonb(src) - ARRAY['updated_by']::text[])::text, true
  FROM public.ais_system_config AS src
  UNION ALL
  -- [block S03]
  SELECT 'S03', (to_jsonb(src) - ARRAY['updated_by']::text[])::text, true
  FROM public.ais_scoring_weights AS src
  UNION ALL
  -- [block S04]
  SELECT 'S04', to_jsonb(src)::text, true
  FROM public.ais_normalization_ranges AS src
  UNION ALL
  -- [block S05]
  SELECT 'S05', to_jsonb(src)::text, true
  FROM public.pricing_config AS src
  UNION ALL
  -- [block S06]
  -- The admin_users key is emptied at export (SA R-3), so it is emptied here too.
  SELECT 'S06',
         ((CASE WHEN src.key = 'admin_users' THEN jsonb_set(to_jsonb(src), ARRAY['value'], '[]'::jsonb)
                ELSE to_jsonb(src) END) - ARRAY['updated_by']::text[])::text,
         true
  FROM public.system_settings_config AS src
  UNION ALL
  -- [block S07]
  SELECT 'S07', to_jsonb(src)::text, true
  FROM public.memory_config AS src
  UNION ALL
  -- [block S08]
  SELECT 'S08', to_jsonb(src)::text, true
  FROM public.model_routing_config AS src
  UNION ALL
  -- [block S09]
  SELECT 'S09', to_jsonb(src)::text, true
  FROM public.boost_packs AS src
  UNION ALL
  -- [block S10]
  SELECT 'S10', to_jsonb(src)::text, true
  FROM public.storage_plans AS src
  UNION ALL
  -- [block S11]
  SELECT 'S11', to_jsonb(src)::text, true
  FROM public.reward_config AS src
  UNION ALL
  -- [block S12]
  SELECT 'S12', to_jsonb(src)::text, true
  FROM public.reward_settings AS src
  UNION ALL
  -- [block S13]
  SELECT 'S13', (to_jsonb(src) - ARRAY['updated_by']::text[])::text, true
  FROM public.exchange_rates AS src
  UNION ALL
  -- [block S14]
  SELECT 'S14', to_jsonb(src)::text, true
  FROM public.capabilities AS src
  UNION ALL
  -- [block S15]
  SELECT 'S15', to_jsonb(src)::text, true
  FROM public.capability_building_blocks AS src
  UNION ALL
  -- [block S16]
  SELECT 'S16', to_jsonb(src)::text, true
  FROM public.help_articles AS src
  UNION ALL
  -- [block S17]
  SELECT 'S17', to_jsonb(src)::text, true
  FROM public.helpbot_page_contexts AS src
  UNION ALL
  -- [block S18]
  SELECT 'S18', to_jsonb(src)::text, true
  FROM public.plugin_semantic_ops AS src
  UNION ALL
  -- [block S19]
  SELECT 'S19', to_jsonb(src)::text, true
  FROM public.website_archetypes AS src
  UNION ALL
  -- [block S20]
  -- One constant line per row. The content is never read (OQ-15 class b).
  SELECT 'S20', 'initialisation row', true
  FROM public.bos_cron_run_recording AS src
  UNION ALL
  -- [block S21]
  -- The next id of each serial sequence is clear of the highest id in use.
  SELECT 'S21',
         format('%s.%s next id %s', seq_check.table_name, seq_check.column_name,
                CASE WHEN coalesce(seq_check.last_used, 0) >= coalesce(seq_check.max_id, 0)
                     THEN 'clear' ELSE 'COLLIDES' END),
         coalesce(seq_check.last_used, 0) >= coalesce(seq_check.max_id, 0)
  FROM (VALUES
          ('ais_scoring_weights', 'id',
           (SELECT max(src.id) FROM public.ais_scoring_weights AS src)::bigint,
           pg_sequence_last_value(pg_get_serial_sequence('public.ais_scoring_weights', 'id')::regclass)),
          ('help_articles', 'id',
           (SELECT max(src.id) FROM public.help_articles AS src)::bigint,
           pg_sequence_last_value(pg_get_serial_sequence('public.help_articles', 'id')::regclass))
       ) AS seq_check (table_name, column_name, max_id, last_used)
  UNION ALL
  -- No other seed table owns a sequence (serial or identity).
  SELECT 'S21', 'owned sequences: ' || coalesce(owned.column_list, 'none'),
         coalesce(owned.column_list, 'none') = 'ais_scoring_weights.id,help_articles.id'
  FROM (
    SELECT string_agg(owner_col.col_name, ',' ORDER BY owner_col.col_name COLLATE "C") AS column_list
    FROM (
      SELECT tbl.relname || '.' || att.attname AS col_name
      FROM pg_depend AS dep
      JOIN pg_class AS seq ON seq.oid = dep.objid AND seq.relkind = 'S'
      JOIN pg_class AS tbl ON tbl.oid = dep.refobjid
      JOIN pg_namespace AS nsp ON nsp.oid = tbl.relnamespace AND nsp.nspname = 'public'
      JOIN pg_attribute AS att ON att.attrelid = tbl.oid AND att.attnum = dep.refobjsubid
      WHERE dep.classid = 'pg_class'::regclass
        AND dep.refclassid = 'pg_class'::regclass
        AND dep.deptype IN ('a', 'i')
        AND tbl.relname IN ('ai_model_pricing', 'ais_system_config', 'ais_scoring_weights',
                            'ais_normalization_ranges', 'pricing_config', 'system_settings_config',
                            'memory_config', 'model_routing_config', 'boost_packs', 'storage_plans',
                            'reward_config', 'reward_settings', 'exchange_rates', 'capabilities',
                            'capability_building_blocks', 'help_articles', 'helpbot_page_contexts',
                            'plugin_semantic_ops', 'website_archetypes')
    ) AS owner_col
  ) AS owned
),
-- [block sections]
-- kind: context and seed rows must have at least one line, single must have
-- exactly one, sequence must have every line clear.
-- display: value prints the lines, rows prints the line count, count prints
-- the row count and the md5.
sections (sort_order, code, title, kind, display) AS (
  VALUES
    (100, 'S00', 'seed context', 'context', 'value'),
    (101, 'S01', 'ai_model_pricing', 'seed', 'count'),
    (102, 'S02', 'ais_system_config', 'seed', 'count'),
    (103, 'S03', 'ais_scoring_weights', 'seed', 'count'),
    (104, 'S04', 'ais_normalization_ranges', 'seed', 'count'),
    (105, 'S05', 'pricing_config', 'seed', 'count'),
    (106, 'S06', 'system_settings_config', 'seed', 'count'),
    (107, 'S07', 'memory_config', 'seed', 'count'),
    (108, 'S08', 'model_routing_config', 'seed', 'count'),
    (109, 'S09', 'boost_packs', 'seed', 'count'),
    (110, 'S10', 'storage_plans', 'seed', 'count'),
    (111, 'S11', 'reward_config', 'seed', 'count'),
    (112, 'S12', 'reward_settings', 'seed', 'count'),
    (113, 'S13', 'exchange_rates', 'seed', 'count'),
    (114, 'S14', 'capabilities', 'seed', 'count'),
    (115, 'S15', 'capability_building_blocks', 'seed', 'count'),
    (116, 'S16', 'help_articles', 'seed', 'count'),
    (117, 'S17', 'helpbot_page_contexts', 'seed', 'count'),
    (118, 'S18', 'plugin_semantic_ops', 'seed', 'count'),
    (119, 'S19', 'website_archetypes', 'seed', 'count'),
    (120, 'S20', 'bos_cron_run_recording row', 'single', 'rows'),
    (121, 'S21', 'serial sequences', 'sequence', 'value')
),
summary AS (
  SELECT sec.sort_order, sec.code, sec.title, sec.kind, sec.display,
         count(seed_lines.line) AS line_count,
         coalesce(bool_and(seed_lines.gate_ok), false) AS gates_ok,
         md5(coalesce(string_agg(seed_lines.line, chr(10) ORDER BY seed_lines.line COLLATE "C"), '')) AS fingerprint,
         string_agg(seed_lines.line, ' / ' ORDER BY seed_lines.line COLLATE "C")
           FILTER (WHERE sec.display = 'value') AS joined
  FROM sections AS sec
  LEFT JOIN seed_lines ON seed_lines.code = sec.code
  GROUP BY sec.sort_order, sec.code, sec.title, sec.kind, sec.display
),
graded AS (
  SELECT summary.sort_order, summary.code, summary.title, summary.kind, summary.fingerprint,
         CASE WHEN summary.kind = 'single' THEN CASE WHEN summary.line_count = 1 THEN 'PASS' ELSE 'FAIL' END
              WHEN summary.line_count > 0 AND summary.gates_ok THEN 'PASS'
              ELSE 'FAIL' END AS result,
         CASE WHEN summary.display = 'value' THEN coalesce(summary.joined, '(no lines)')
              WHEN summary.display = 'rows' THEN 'rows ' || summary.line_count
              ELSE summary.line_count || ' rows, md5 ' || summary.fingerprint END AS detail
  FROM summary
),
report AS (
  -- [block report]
  SELECT 0 AS sort_order, 'VERDICT'::text AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM graded WHERE graded.result = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM graded WHERE graded.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM graded WHERE graded.result = 'FAIL') || ' fail'
           || ' | compare CONTEXT KEY first, unequal means VOID, then SEED KEY' AS detail
  UNION ALL
  SELECT graded.sort_order, graded.code || ' ' || graded.title, graded.result, graded.detail
  FROM graded
  UNION ALL
  -- CONTEXT KEY is the S00 hash on its own. When it differs the comparison is VOID (SA B-9).
  SELECT 900, 'CONTEXT KEY', 'INFO',
         (SELECT 'md5 ' || graded.fingerprint FROM graded WHERE graded.code = 'S00')
  UNION ALL
  -- SEED KEY covers S01 to S19 only: the copied rows, not the context and not the gates.
  SELECT 901, 'SEED KEY', 'INFO',
         (SELECT 'md5 ' || md5(string_agg(graded.fingerprint, ',' ORDER BY graded.sort_order))
          FROM graded WHERE graded.kind = 'seed')
)
SELECT report.check_name, report.result, report.detail
FROM report
ORDER BY report.sort_order;

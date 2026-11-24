-- Schema parity checker for PROD-2: the empty-diff proof (workplan section 7).
--
-- Read-only. It reads the system catalog plus the configuration rows of
-- storage.buckets, and never reads table data. Run it on both projects with the
-- SAME client, then compare the two outputs row by row.
--
-- HOW TO READ IT
--   1. VERDICT must be PASS on both sides. FAIL means the fingerprint is not
--      complete: a section came back with no lines, or G1 found an ACL item
--      granted by a role other than the object owner. A project with no schema
--      is FAIL by design (run F1).
--   2. Compare CONTEXT KEY first. If it differs, the comparison is VOID, not
--      FAIL. The deparse context (P00) changes the text of every definition,
--      so re-run both sides in one client and compare again.
--   3. Then compare PARITY KEY (P01 to P26). Equal means the two schemas match
--      in every section. Unequal is a FAIL: compare the P rows to find which
--      sections differ, then use lines mode (below) to find the lines.
--
-- ROW COUNT. Summary mode returns exactly 39 rows: VERDICT, P00 to P26, G1,
-- CONTEXT KEY, PARITY KEY and I1 to I8. Fewer rows is a failed check
-- (supabase-ops section 1).
--
-- GATES. VERDICT, P00 to P26 and G1 are gates. I1 to I8 are information rows,
-- never a gate and outside both keys.
--
-- PRIVACY. The privilege sections (P08, P09, P10, P15, P17, P24, P25) and I4
-- print an md5 only, never a count, so the summary carries no grant counts.
-- Setting values are hashed in every mode. The summary output can be shared.
--
-- LINES MODE. Change run_mode below from summary to lines and the output also
-- carries every line behind every hash, which is what you diff when a section
-- differs. Lines mode prints the grant posture. It is never run through
-- execute_sql, because its rows would land in the chat transcript. Only the
-- user runs it, in the SQL editor using download as CSV (the result grid
-- truncates) or in psql writing to the private baseline folder. Never commit
-- the file with run_mode set to lines.
--
-- ANCHORS. P05, P10, P15, P19, P21, P22 and P23 can legitimately have nothing
-- to report. Each emits an anchor line (built from the population it scanned,
-- or constant for P15), so a section that returned nothing at all fails
-- VERDICT, while one with nothing to report still shows its anchor.
--
-- DETERMINISM. Lines are sorted with COLLATE C before hashing. No OID appears
-- in any line: identity comes from names. Function bodies and comments have
-- CR stripped before hashing, so line endings never change a hash.
--
-- PASTE SAFETY. ASCII only, LF line endings, no psql meta-commands, no
-- single-letter aliases. Runs unchanged in the SQL editor, in psql and through
-- execute_sql (summary mode only, without the first line, per supabase-ops).
--
-- @see docs/workplans/prod-2-schema-baseline-workplan.md section 7
-- @see supabase/baseline/prove-checker-can-fail.psql (one deliberate difference per section)

SET default_transaction_read_only = on;

WITH params AS (
  SELECT 'summary'::text AS run_mode
),
our_schemas AS (
  SELECT nsp.oid AS nsp_oid, nsp.nspname, nsp.nspowner, nsp.nspacl
  FROM pg_namespace AS nsp
  WHERE nsp.nspname IN ('public', 'operator_private')
),
ext_member AS (
  SELECT dep.classid, dep.objid
  FROM pg_depend AS dep
  WHERE dep.deptype = 'e'
),
api_role AS (
  SELECT want.rolname
  FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS want (rolname)
),
our_rel AS (
  SELECT cls.oid AS rel_oid, sch.nspname, cls.relname, cls.relkind, cls.relowner, cls.relacl
  FROM pg_class AS cls
  JOIN our_schemas AS sch ON sch.nsp_oid = cls.relnamespace
  WHERE cls.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
    AND NOT EXISTS (SELECT 1 FROM ext_member AS em
                    WHERE em.classid = 'pg_class'::regclass AND em.objid = cls.oid)
),
our_fn AS (
  SELECT fn.oid AS fn_oid, sch.nspname, fn.prokind, fn.proowner, fn.proacl,
         sch.nspname || '.' || fn.proname || '(' || pg_get_function_identity_arguments(fn.oid) || ')' AS fn_ident
  FROM pg_proc AS fn
  JOIN our_schemas AS sch ON sch.nsp_oid = fn.pronamespace
  WHERE NOT EXISTS (SELECT 1 FROM ext_member AS em
                    WHERE em.classid = 'pg_proc'::regclass AND em.objid = fn.oid)
),
ext_fn AS (
  SELECT fn.oid AS fn_oid, ext.extname, fn.proowner, fn.proacl,
         sch.nspname || '.' || fn.proname || '(' || pg_get_function_identity_arguments(fn.oid) || ')' AS fn_ident
  FROM pg_proc AS fn
  JOIN our_schemas AS sch ON sch.nsp_oid = fn.pronamespace
  JOIN pg_depend AS dep ON dep.classid = 'pg_proc'::regclass AND dep.objid = fn.oid
                       AND dep.refclassid = 'pg_extension'::regclass AND dep.deptype = 'e'
  JOIN pg_extension AS ext ON ext.oid = dep.refobjid
),
our_type AS (
  -- Standalone types only: no table row types and no implicit array types.
  SELECT typ.oid AS type_oid, sch.nspname, typ.typname, typ.typtype, typ.typowner, typ.typacl
  FROM pg_type AS typ
  JOIN our_schemas AS sch ON sch.nsp_oid = typ.typnamespace
  LEFT JOIN pg_class AS rowrel ON rowrel.oid = typ.typrelid
  WHERE (typ.typrelid = 0 OR rowrel.relkind = 'c')
    AND NOT EXISTS (SELECT 1 FROM pg_type AS elem WHERE elem.typarray = typ.oid)
    AND NOT EXISTS (SELECT 1 FROM ext_member AS em
                    WHERE em.classid = 'pg_type'::regclass AND em.objid = typ.oid)
),
-- [block acl_items]
-- Exploded, grantor-free ACL sets (SA A-7). A NULL ACL expands to its built-in
-- default, so never granted and explicitly default compare equal. Column ACLs
-- and default ACLs are never NULL-expanded: a NULL attacl means no column
-- privileges, and defaclacl is never NULL (SA B-6).
acl_items AS (
  SELECT 'P08'::text AS section, fn.fn_ident AS object_ident, fn.proowner AS owner_oid,
         acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
  FROM our_fn AS fn
  CROSS JOIN LATERAL aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) AS acl
  UNION ALL
  SELECT 'P09', rel.nspname || '.' || rel.relname, rel.relowner,
         acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
  FROM our_rel AS rel
  CROSS JOIN LATERAL aclexplode(coalesce(rel.relacl, acldefault((CASE WHEN rel.relkind = 'S' THEN 's' ELSE 'r' END)::"char", rel.relowner))) AS acl
  WHERE rel.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
  UNION ALL
  SELECT 'P10', rel.nspname || '.' || rel.relname || '.' || att.attname, rel.relowner,
         acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
  FROM our_rel AS rel
  JOIN pg_attribute AS att ON att.attrelid = rel.rel_oid AND att.attnum > 0 AND NOT att.attisdropped
  CROSS JOIN LATERAL aclexplode(att.attacl) AS acl
  WHERE att.attacl IS NOT NULL
  UNION ALL
  -- P15: the default ACLs of postgres in our schemas plus its GLOBAL rows only
  -- (SA A-6). Its rows in managed schemas, and every other role, are I4.
  SELECT 'P15', coalesce(dns.nspname, 'GLOBAL') || ' | ' || dacl.defaclobjtype::text, dacl.defaclrole,
         acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
  FROM pg_default_acl AS dacl
  LEFT JOIN pg_namespace AS dns ON dns.oid = dacl.defaclnamespace
  CROSS JOIN LATERAL aclexplode(dacl.defaclacl) AS acl
  WHERE dacl.defaclrole = (SELECT rol.oid FROM pg_roles AS rol WHERE rol.rolname = 'postgres')
    AND (dacl.defaclnamespace = 0
         OR dacl.defaclnamespace IN (SELECT sch.nsp_oid FROM our_schemas AS sch))
  UNION ALL
  SELECT 'P17', fn.extname || ': ' || fn.fn_ident, fn.proowner,
         acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
  FROM ext_fn AS fn
  CROSS JOIN LATERAL aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) AS acl
  UNION ALL
  SELECT 'P24', typ.nspname || '.' || typ.typname, typ.typowner,
         acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
  FROM our_type AS typ
  CROSS JOIN LATERAL aclexplode(coalesce(typ.typacl, acldefault('T', typ.typowner))) AS acl
  UNION ALL
  SELECT 'P25', sch.nspname::text, sch.nspowner,
         acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
  FROM our_schemas AS sch
  CROSS JOIN LATERAL aclexplode(coalesce(sch.nspacl, acldefault('n', sch.nspowner))) AS acl
),
-- [block comment_scope]
-- Every object that lives in our schemas and can carry a comment. Constraints,
-- triggers, policies and rules are found through their table.
comment_scope AS (
  SELECT 'pg_class'::regclass::oid AS classoid, cls.oid AS objoid
  FROM pg_class AS cls
  JOIN our_schemas AS sch ON sch.nsp_oid = cls.relnamespace
  UNION ALL
  SELECT 'pg_proc'::regclass::oid, fn.oid
  FROM pg_proc AS fn
  JOIN our_schemas AS sch ON sch.nsp_oid = fn.pronamespace
  UNION ALL
  SELECT 'pg_type'::regclass::oid, typ.oid
  FROM pg_type AS typ
  JOIN our_schemas AS sch ON sch.nsp_oid = typ.typnamespace
  UNION ALL
  SELECT 'pg_constraint'::regclass::oid, con.oid
  FROM pg_constraint AS con
  JOIN our_schemas AS sch ON sch.nsp_oid = con.connamespace
  UNION ALL
  SELECT 'pg_trigger'::regclass::oid, trg.oid
  FROM pg_trigger AS trg
  JOIN pg_class AS cls ON cls.oid = trg.tgrelid
  JOIN our_schemas AS sch ON sch.nsp_oid = cls.relnamespace
  UNION ALL
  SELECT 'pg_policy'::regclass::oid, pol.oid
  FROM pg_policy AS pol
  JOIN pg_class AS cls ON cls.oid = pol.polrelid
  JOIN our_schemas AS sch ON sch.nsp_oid = cls.relnamespace
  UNION ALL
  SELECT 'pg_rewrite'::regclass::oid, rul.oid
  FROM pg_rewrite AS rul
  JOIN pg_class AS cls ON cls.oid = rul.ev_class
  JOIN our_schemas AS sch ON sch.nsp_oid = cls.relnamespace
  UNION ALL
  SELECT dep.classid, dep.objid
  FROM pg_depend AS dep
  JOIN our_schemas AS sch ON sch.nsp_oid = dep.refobjid
  WHERE dep.refclassid = 'pg_namespace'::regclass
    AND dep.deptype = 'n'
    AND dep.classid NOT IN ('pg_class'::regclass, 'pg_proc'::regclass, 'pg_type'::regclass)
),
lines AS (
  -- [block P00]
  SELECT 'P00'::text AS section,
         format('search_path=%s | TimeZone=%s | DateStyle=%s | IntervalStyle=%s | extra_float_digits=%s | quote_all_identifiers=%s | standard_conforming_strings=%s | bytea_output=%s | server_encoding=%s',
                current_setting('search_path'), current_setting('TimeZone'),
                current_setting('DateStyle'), current_setting('IntervalStyle'),
                current_setting('extra_float_digits'), current_setting('quote_all_identifiers'),
                current_setting('standard_conforming_strings'), current_setting('bytea_output'),
                current_setting('server_encoding')) AS line

  -- [block P01]
  UNION ALL
  SELECT 'P01',
         format('%s.%s | kind=%s | persistence=%s | owner=%s | rls=%s | force_rls=%s | replident=%s | partition=%s | bound=%s | partkey=%s | inherits=%s | am=%s | options=%s',
                rel.nspname, rel.relname, cls.relkind, cls.relpersistence, pg_get_userbyid(cls.relowner),
                cls.relrowsecurity, cls.relforcerowsecurity, cls.relreplident, cls.relispartition,
                pg_get_expr(cls.relpartbound, cls.oid), pg_get_partkeydef(cls.oid),
                array_to_string(ARRAY(SELECT par_ns.nspname || '.' || par.relname
                                      FROM pg_inherits AS inh
                                      JOIN pg_class AS par ON par.oid = inh.inhparent
                                      JOIN pg_namespace AS par_ns ON par_ns.oid = par.relnamespace
                                      WHERE inh.inhrelid = cls.oid
                                      ORDER BY inh.inhseqno), ','),
                am.amname,
                array_to_string(ARRAY(SELECT opt FROM unnest(cls.reloptions) AS opt
                                      ORDER BY opt COLLATE "C"), ','))
  FROM our_rel AS rel
  JOIN pg_class AS cls ON cls.oid = rel.rel_oid
  LEFT JOIN pg_am AS am ON am.oid = cls.relam

  -- [block P02]
  -- The ordinal counts live columns only, so dropped-column gaps never differ.
  UNION ALL
  SELECT 'P02',
         format('%s.%s | %s | %s | type=%s | notnull=%s | default=%s | identity=%s | generated=%s | collation=%s | storage=%s | compression=%s | stattarget=%s',
                rel.nspname, rel.relname,
                row_number() OVER (PARTITION BY att.attrelid ORDER BY att.attnum),
                att.attname, format_type(att.atttypid, att.atttypmod), att.attnotnull,
                pg_get_expr(adef.adbin, adef.adrelid), att.attidentity, att.attgenerated,
                coll.collname, att.attstorage, att.attcompression, att.attstattarget)
  FROM our_rel AS rel
  JOIN pg_attribute AS att ON att.attrelid = rel.rel_oid AND att.attnum > 0 AND NOT att.attisdropped
  LEFT JOIN pg_attrdef AS adef ON adef.adrelid = att.attrelid AND adef.adnum = att.attnum
  LEFT JOIN pg_collation AS coll ON coll.oid = att.attcollation
  WHERE rel.relkind IN ('r', 'p', 'v', 'm', 'f', 'c')

  -- [block P03]
  UNION ALL
  SELECT 'P03',
         format('%s.%s | %s | type=%s | %s', rel.nspname, rel.relname, con.conname, con.contype,
                pg_get_constraintdef(con.oid))
  FROM our_rel AS rel
  JOIN pg_constraint AS con ON con.conrelid = rel.rel_oid

  -- [block P04]
  -- indisvalid: an index left invalid on staging comes back valid from a dump,
  -- and that difference must show.
  UNION ALL
  SELECT 'P04',
         format('%s | clustered=%s | replident=%s | valid=%s', pg_get_indexdef(idx.indexrelid),
                idx.indisclustered, idx.indisreplident, idx.indisvalid)
  FROM our_rel AS rel
  JOIN pg_index AS idx ON idx.indrelid = rel.rel_oid

  -- [block P05]
  -- Internal (constraint) triggers have OID-derived names, so they are not
  -- listed. The anchor line counts the ones not enabled, because disabled FK
  -- enforcement would otherwise pass (SA B-5).
  UNION ALL
  SELECT 'P05',
         format('%s.%s | %s | enabled=%s | %s', rel.nspname, rel.relname, trg.tgname, trg.tgenabled,
                pg_get_triggerdef(trg.oid))
  FROM our_rel AS rel
  JOIN pg_trigger AS trg ON trg.tgrelid = rel.rel_oid
  WHERE NOT trg.tgisinternal
  UNION ALL
  SELECT 'P05', format('anchor | internal triggers not enabled: %s', count(*))
  FROM our_rel AS rel
  JOIN pg_trigger AS trg ON trg.tgrelid = rel.rel_oid
  WHERE trg.tgisinternal AND trg.tgenabled <> 'O'

  -- [block P06]
  UNION ALL
  SELECT 'P06',
         format('%s.%s | kind=%s | definition md5 %s', rel.nspname, rel.relname, rel.relkind,
                md5(pg_get_viewdef(rel.rel_oid, true)))
  FROM our_rel AS rel
  WHERE rel.relkind IN ('v', 'm')

  -- [block P07]
  -- pg_get_functiondef raises on an aggregate, so aggregates hash their
  -- pg_aggregate row instead. CR is stripped before hashing.
  UNION ALL
  SELECT 'P07',
         format('%s | kind=%s | body md5 %s | secdef=%s | config=%s | owner=%s',
                fn.fn_ident, fn.prokind,
                CASE WHEN fn.prokind = 'a'
                     THEN (SELECT md5(format('%s | %s | %s | %s | %s | %s | %s', agg.aggkind, agg.aggtransfn,
                                             agg.aggfinalfn, agg.aggcombinefn,
                                             format_type(agg.aggtranstype, NULL), agg.agginitval,
                                             agg.aggsortop::regoperator))
                           FROM pg_aggregate AS agg WHERE agg.aggfnoid = fn.fn_oid)
                     ELSE md5(replace(pg_get_functiondef(fn.fn_oid), chr(13), '')) END,
                proc.prosecdef,
                array_to_string(ARRAY(SELECT cfg FROM unnest(proc.proconfig) AS cfg
                                      ORDER BY cfg COLLATE "C"), ','),
                pg_get_userbyid(fn.proowner))
  FROM our_fn AS fn
  JOIN pg_proc AS proc ON proc.oid = fn.fn_oid

  -- [block acl_lines]
  -- P08, P09, P10, P15, P17, P24 and P25. DISTINCT, so a privilege held from
  -- two grantors is one line (SA A-7). A missing revoke shows as an extra line.
  UNION ALL
  SELECT DISTINCT acl_items.section,
         format('%s | %s | %s | grantable=%s', acl_items.object_ident,
                CASE WHEN acl_items.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl_items.grantee) END,
                acl_items.privilege_type, acl_items.is_grantable)
  FROM acl_items

  -- [block P10]
  UNION ALL
  SELECT 'P10', format('anchor | column ACL scan | schema %s', sch.nspname)
  FROM our_schemas AS sch

  -- [block P15]
  -- Constant anchors: postgres may legitimately hold no default-ACL row in our
  -- schemas or GLOBAL, for example after a lockdown empties them (SA code
  -- review 3). Constant, so P15 still prints its md5 only.
  UNION ALL
  SELECT 'P15', format('anchor | default ACL scan | %s', want.scope)
  FROM (VALUES ('public'), ('operator_private'), ('GLOBAL')) AS want (scope)

  -- [block G1]
  -- The restore runs as postgres, which cannot replay a grant made by another
  -- grantor (SA A-3). Schema ACLs are left out on purpose: see OQ-13.
  UNION ALL
  SELECT DISTINCT 'G1', format('%s | %s | grantor is not the owner', acl_items.section, acl_items.object_ident)
  FROM acl_items
  WHERE acl_items.section IN ('P08', 'P09', 'P10', 'P24')
    AND acl_items.grantor <> acl_items.owner_oid

  -- [block P11]
  UNION ALL
  SELECT 'P11',
         format('%s.%s | %s | cmd=%s | permissive=%s | roles=%s | using=%s | check=%s',
                rel.nspname, rel.relname, pol.polname, pol.polcmd, pol.polpermissive,
                array_to_string(ARRAY(
                  SELECT role_list.role_name
                  FROM (SELECT CASE WHEN rid.role_oid = 0 THEN 'PUBLIC'
                                    ELSE pg_get_userbyid(rid.role_oid) END AS role_name
                        FROM unnest(pol.polroles) AS rid (role_oid)) AS role_list
                  ORDER BY role_list.role_name COLLATE "C"), ','),
                pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid))
  FROM our_rel AS rel
  JOIN pg_policy AS pol ON pol.polrelid = rel.rel_oid

  -- [block P12]
  -- Structure only. The type ACL lines are P24, so this count is never a
  -- privilege count (SA B-4).
  UNION ALL
  SELECT 'P12',
         format('%s.%s | type=%s | owner=%s | %s', typ.nspname, typ.typname, typ.typtype,
                pg_get_userbyid(typ.typowner),
                CASE typ.typtype
                  WHEN 'e' THEN 'labels=' || array_to_string(ARRAY(
                         SELECT lab.enumlabel FROM pg_enum AS lab
                         WHERE lab.enumtypid = typ.type_oid
                         ORDER BY lab.enumsortorder), ',')
                  WHEN 'd' THEN format('base=%s | notnull=%s | default=%s | collation=%s | checks=%s',
                         format_type(dom.typbasetype, dom.typtypmod), dom.typnotnull, dom.typdefault,
                         (SELECT dcoll.collname FROM pg_collation AS dcoll WHERE dcoll.oid = dom.typcollation),
                         array_to_string(ARRAY(
                           SELECT dcon.conname || ' ' || pg_get_constraintdef(dcon.oid)
                           FROM pg_constraint AS dcon
                           WHERE dcon.contypid = typ.type_oid
                           ORDER BY dcon.conname COLLATE "C"), ' / '))
                  WHEN 'r' THEN (SELECT format('subtype=%s | collation=%s | opclass=%s | canonical=%s | subdiff=%s',
                                              format_type(rng.rngsubtype, NULL),
                                              (SELECT rcoll.collname FROM pg_collation AS rcoll
                                               WHERE rcoll.oid = rng.rngcollation),
                                              opc.opcname, rng.rngcanonical, rng.rngsubdiff)
                                 FROM pg_range AS rng
                                 LEFT JOIN pg_opclass AS opc ON opc.oid = rng.rngsubopc
                                 WHERE rng.rngtypid = typ.type_oid)
                  WHEN 'c' THEN 'composite, attributes in P02'
                  ELSE format('input=%s | output=%s', dom.typinput, dom.typoutput)
                END)
  FROM our_type AS typ
  JOIN pg_type AS dom ON dom.oid = typ.type_oid

  -- [block P13]
  -- Never last_value, which is data.
  UNION ALL
  SELECT 'P13',
         format('%s.%s | type=%s | start=%s | increment=%s | min=%s | max=%s | cache=%s | cycle=%s | owned_by=%s',
                rel.nspname, rel.relname, format_type(seq.seqtypid, NULL), seq.seqstart,
                seq.seqincrement, seq.seqmin, seq.seqmax, seq.seqcache, seq.seqcycle,
                (SELECT string_agg(own_ns.nspname || '.' || own_rel.relname || '.' || own_att.attname
                                     || ' dep=' || own_dep.deptype::text, ','
                                   ORDER BY (own_ns.nspname || '.' || own_rel.relname || '.' || own_att.attname) COLLATE "C")
                 FROM pg_depend AS own_dep
                 JOIN pg_class AS own_rel ON own_rel.oid = own_dep.refobjid
                 JOIN pg_namespace AS own_ns ON own_ns.oid = own_rel.relnamespace
                 JOIN pg_attribute AS own_att ON own_att.attrelid = own_dep.refobjid
                                             AND own_att.attnum = own_dep.refobjsubid
                 WHERE own_dep.classid = 'pg_class'::regclass
                   AND own_dep.objid = rel.rel_oid
                   AND own_dep.refclassid = 'pg_class'::regclass
                   AND own_dep.refobjsubid > 0
                   AND own_dep.deptype IN ('a', 'i')))
  FROM our_rel AS rel
  JOIN pg_sequence AS seq ON seq.seqrelid = rel.rel_oid

  -- [block P14]
  -- Structure only. The schema ACL lines are P25 (SA B-4).
  UNION ALL
  SELECT 'P14',
         format('%s | owner=%s | comment md5 %s', sch.nspname, pg_get_userbyid(sch.nspowner),
                md5(replace(coalesce(nsp_dsc.description, ''), chr(13), '')))
  FROM our_schemas AS sch
  LEFT JOIN pg_description AS nsp_dsc ON nsp_dsc.classoid = 'pg_namespace'::regclass
                                      AND nsp_dsc.objoid = sch.nsp_oid
                                      AND nsp_dsc.objsubid = 0

  -- [block P16]
  UNION ALL
  SELECT 'P16',
         format('%s | version=%s | schema=%s | owner=%s', ext.extname, ext.extversion, sch.nspname,
                pg_get_userbyid(ext.extowner))
  FROM pg_extension AS ext
  JOIN our_schemas AS sch ON sch.nsp_oid = ext.extnamespace

  -- [block P18]
  UNION ALL
  SELECT 'P18',
         format('%s | %s | md5 %s', ident.type, ident.identity,
                md5(replace(coalesce(obj_dsc.description, ''), chr(13), '')))
  FROM (SELECT DISTINCT scope.classoid, scope.objoid FROM comment_scope AS scope) AS scoped
  JOIN pg_description AS obj_dsc ON obj_dsc.classoid = scoped.classoid AND obj_dsc.objoid = scoped.objoid
  CROSS JOIN LATERAL pg_identify_object(obj_dsc.classoid, obj_dsc.objoid, obj_dsc.objsubid) AS ident
  WHERE NOT EXISTS (SELECT 1 FROM ext_member AS em
                    WHERE em.classid = obj_dsc.classoid AND em.objid = obj_dsc.objoid)

  -- [block P19]
  -- Triggers on tables outside our schemas whose function is ours, for
  -- example the user settings trigger on auth.users.
  UNION ALL
  SELECT 'P19',
         format('%s.%s | %s | enabled=%s | %s', tns.nspname, trel.relname, trg.tgname, trg.tgenabled,
                pg_get_triggerdef(trg.oid))
  FROM pg_trigger AS trg
  JOIN pg_class AS trel ON trel.oid = trg.tgrelid
  JOIN pg_namespace AS tns ON tns.oid = trel.relnamespace
  JOIN pg_proc AS tfn ON tfn.oid = trg.tgfoid
  JOIN our_schemas AS sch ON sch.nsp_oid = tfn.pronamespace
  WHERE NOT trg.tgisinternal
    AND tns.oid NOT IN (SELECT ours.nsp_oid FROM our_schemas AS ours)
  UNION ALL
  SELECT 'P19', format('anchor | schema %s | present=%s', want.nspname, to_regnamespace(want.nspname) IS NOT NULL)
  FROM (VALUES ('auth'), ('storage'), ('realtime')) AS want (nspname)

  -- [block P20]
  -- Bucket configuration only. Objects are data and are never read.
  UNION ALL
  SELECT 'P20',
         format('%s | name=%s | public=%s | size_limit=%s | mime=%s', bkt.id, bkt.name, bkt.public,
                bkt.file_size_limit,
                array_to_string(ARRAY(SELECT mime.mime_type FROM unnest(bkt.allowed_mime_types) AS mime (mime_type)
                                      ORDER BY mime.mime_type COLLATE "C"), ','))
  FROM storage.buckets AS bkt

  -- [block P21]
  UNION ALL
  SELECT 'P21',
         format('storage.%s | %s | cmd=%s | permissive=%s | roles=%s | using=%s | check=%s',
                stbl.relname, pol.polname, pol.polcmd, pol.polpermissive,
                array_to_string(ARRAY(
                  SELECT role_list.role_name
                  FROM (SELECT CASE WHEN rid.role_oid = 0 THEN 'PUBLIC'
                                    ELSE pg_get_userbyid(rid.role_oid) END AS role_name
                        FROM unnest(pol.polroles) AS rid (role_oid)) AS role_list
                  ORDER BY role_list.role_name COLLATE "C"), ','),
                pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid))
  FROM pg_policy AS pol
  JOIN pg_class AS stbl ON stbl.oid = pol.polrelid
  WHERE stbl.relnamespace = to_regnamespace('storage')::oid
  UNION ALL
  SELECT 'P21',
         format('anchor | storage.%s | present=%s | rls=%s | force_rls=%s | policies=%s',
                want.relname, stbl.oid IS NOT NULL, stbl.relrowsecurity, stbl.relforcerowsecurity,
                (SELECT count(*) FROM pg_policy AS spol WHERE spol.polrelid = stbl.oid))
  FROM (VALUES ('objects'), ('buckets')) AS want (relname)
  LEFT JOIN pg_class AS stbl ON stbl.relname = want.relname
                            AND stbl.relnamespace = to_regnamespace('storage')::oid

  -- [block P22]
  UNION ALL
  SELECT 'P22',
         format('anchor | publication %s | present=%s | all_tables=%s | ins=%s | upd=%s | del=%s | trunc=%s | via_root=%s',
                want.pubname, pub.oid IS NOT NULL, pub.puballtables, pub.pubinsert, pub.pubupdate,
                pub.pubdelete, pub.pubtruncate, pub.pubviaroot)
  FROM (VALUES ('supabase_realtime')) AS want (pubname)
  LEFT JOIN pg_publication AS pub ON pub.pubname = want.pubname
  UNION ALL
  SELECT 'P22',
         format('member table | %s.%s | filter=%s | columns=%s', mem_ns.nspname, mem_rel.relname,
                pg_get_expr(prel.prqual, prel.prrelid),
                array_to_string(ARRAY(SELECT patt.attname FROM pg_attribute AS patt
                                      WHERE patt.attrelid = prel.prrelid AND patt.attnum = ANY (prel.prattrs)
                                      ORDER BY patt.attname COLLATE "C"), ','))
  FROM pg_publication AS pub
  JOIN pg_publication_rel AS prel ON prel.prpubid = pub.oid
  JOIN pg_class AS mem_rel ON mem_rel.oid = prel.prrelid
  JOIN pg_namespace AS mem_ns ON mem_ns.oid = mem_rel.relnamespace
  WHERE pub.pubname = 'supabase_realtime'
  UNION ALL
  SELECT 'P22', format('member schema | %s', mem_ns.nspname)
  FROM pg_publication AS pub
  JOIN pg_publication_namespace AS pnsp ON pnsp.pnpubid = pub.oid
  JOIN pg_namespace AS mem_ns ON mem_ns.oid = pnsp.pnnspid
  WHERE pub.pubname = 'supabase_realtime'

  -- [block P23]
  -- Setting names in clear, values as md5 only, in every mode.
  UNION ALL
  SELECT 'P23',
         format('anchor | role %s | present=%s | bypassrls=%s | inherit=%s | login=%s',
                want.rolname, rol.oid IS NOT NULL, rol.rolbypassrls, rol.rolinherit, rol.rolcanlogin)
  FROM api_role AS want
  LEFT JOIN pg_roles AS rol ON rol.rolname = want.rolname
  UNION ALL
  SELECT 'P23',
         format('%s | scope=%s | %s | value md5 %s', rol.rolname,
                CASE WHEN drs.setdatabase = 0 THEN 'all databases' ELSE 'this database' END,
                split_part(cfg.setting, '=', 1), md5(substr(cfg.setting, strpos(cfg.setting, '=') + 1)))
  FROM pg_db_role_setting AS drs
  JOIN pg_roles AS rol ON rol.oid = drs.setrole
  JOIN api_role AS want ON want.rolname = rol.rolname
  CROSS JOIN LATERAL unnest(drs.setconfig) AS cfg (setting)
  WHERE drs.setdatabase IN (0, (SELECT dbs.oid FROM pg_database AS dbs WHERE dbs.datname = current_database()))

  -- [block P26]
  -- Object census (SA B-5): per catalog, how many objects depend on our
  -- schemas, plus rewrite rules and statistics objects. An object kind that
  -- no other section models (an operator, an opclass, a collation) still
  -- moves this section.
  UNION ALL
  SELECT 'P26', format('census | %s | %s', cen.classid::regclass, count(*))
  FROM pg_depend AS cen
  JOIN our_schemas AS sch ON sch.nsp_oid = cen.refobjid
  WHERE cen.refclassid = 'pg_namespace'::regclass AND cen.deptype = 'n'
  GROUP BY cen.classid
  UNION ALL
  SELECT 'P26',
         format('rule | %s.%s | %s | md5 %s', rel.nspname, rel.relname, rul.rulename,
                md5(pg_get_ruledef(rul.oid)))
  FROM our_rel AS rel
  JOIN pg_rewrite AS rul ON rul.ev_class = rel.rel_oid
  WHERE rul.rulename <> '_RETURN'
  UNION ALL
  SELECT 'P26',
         format('statistics | %s.%s | %s', sch.nspname, stx.stxname, pg_get_statisticsobjdef(stx.oid))
  FROM pg_statistic_ext AS stx
  JOIN our_schemas AS sch ON sch.nsp_oid = stx.stxnamespace
  -- Event triggers owned by postgres (SA R-7). They belong to no schema, so
  -- the census cannot see them, yet one can change our DDL. Event triggers of
  -- other owners are platform ones and stay in I5, info only. evtenabled is
  -- "char", so it is printed through format() only. Tags are sorted.
  UNION ALL
  SELECT 'P26',
         format('event trigger | %s | event=%s | tags=%s | enabled=%s | function=%s', evt.evtname,
                evt.evtevent,
                array(SELECT evt_tag.tag_name FROM unnest(evt.evttags) AS evt_tag (tag_name)
                      ORDER BY evt_tag.tag_name COLLATE "C"),
                evt.evtenabled, evt.evtfoid::regproc)
  FROM pg_event_trigger AS evt
  WHERE evt.evtowner = (SELECT rol.oid FROM pg_roles AS rol WHERE rol.rolname = 'postgres')
),
info_lines AS (
  -- [block I1]
  SELECT 'I1'::text AS section, current_setting('server_version') AS line

  -- [block I2]
  UNION ALL
  SELECT 'I2', format('%s | version=%s | schema=%s', ext.extname, ext.extversion, ext_ns.nspname)
  FROM pg_extension AS ext
  JOIN pg_namespace AS ext_ns ON ext_ns.oid = ext.extnamespace
  WHERE ext_ns.oid NOT IN (SELECT sch.nsp_oid FROM our_schemas AS sch)

  -- [block I3]
  UNION ALL
  SELECT 'I3', coalesce((SELECT 'present, version ' || ext.extversion
                         FROM pg_extension AS ext WHERE ext.extname = 'pg_graphql'), 'absent')

  -- [block I4]
  -- Default ACLs outside P15: every role other than postgres (supabase_admin
  -- among them), and postgres in managed schemas. Compared by hash only. A
  -- difference is an SA ruling, not a gate (SA A-6).
  UNION ALL
  SELECT DISTINCT 'I4',
         format('%s | %s | %s | %s | %s | grantable=%s', pg_get_userbyid(dacl.defaclrole),
                coalesce(dns.nspname, 'GLOBAL'), dacl.defaclobjtype,
                CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
                acl.privilege_type, acl.is_grantable)
  FROM pg_default_acl AS dacl
  LEFT JOIN pg_namespace AS dns ON dns.oid = dacl.defaclnamespace
  CROSS JOIN LATERAL aclexplode(dacl.defaclacl) AS acl
  WHERE NOT (dacl.defaclrole = (SELECT rol.oid FROM pg_roles AS rol WHERE rol.rolname = 'postgres')
             AND (dacl.defaclnamespace = 0
                  OR dacl.defaclnamespace IN (SELECT sch.nsp_oid FROM our_schemas AS sch)))

  -- [block I5]
  UNION ALL
  SELECT 'I5', format('%s | event=%s | enabled=%s | function=%s', evt.evtname, evt.evtevent,
                      evt.evtenabled, evt.evtfoid::regproc)
  FROM pg_event_trigger AS evt

  -- [block I6]
  -- Database-level settings and the authenticator and postgres role settings.
  -- Names in clear, values as md5 only.
  UNION ALL
  SELECT 'I6',
         format('%s | %s | value md5 %s',
                CASE WHEN drs.setrole = 0 THEN 'database' ELSE pg_get_userbyid(drs.setrole) END,
                split_part(cfg.setting, '=', 1), md5(substr(cfg.setting, strpos(cfg.setting, '=') + 1)))
  FROM pg_db_role_setting AS drs
  CROSS JOIN LATERAL unnest(drs.setconfig) AS cfg (setting)
  WHERE (drs.setrole = 0
         AND drs.setdatabase = (SELECT dbs.oid FROM pg_database AS dbs WHERE dbs.datname = current_database()))
     OR drs.setrole IN (SELECT rol.oid FROM pg_roles AS rol WHERE rol.rolname IN ('authenticator', 'postgres'))

  -- [block I7]
  UNION ALL
  SELECT 'I7', format('%s | %s.%s', owned.kind, owned.nspname, owned.objname)
  FROM (
    SELECT 'relation'::text AS kind, mns.nspname, cls.relname::text AS objname, cls.oid AS objoid,
           'pg_class'::regclass::oid AS classoid, cls.relowner AS ownerid
    FROM pg_class AS cls
    JOIN pg_namespace AS mns ON mns.oid = cls.relnamespace
    WHERE cls.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    UNION ALL
    SELECT 'function', mns.nspname, fn.proname || '(' || pg_get_function_identity_arguments(fn.oid) || ')',
           fn.oid, 'pg_proc'::regclass::oid, fn.proowner
    FROM pg_proc AS fn
    JOIN pg_namespace AS mns ON mns.oid = fn.pronamespace
    UNION ALL
    SELECT 'type', mns.nspname, typ.typname::text, typ.oid, 'pg_type'::regclass::oid, typ.typowner
    FROM pg_type AS typ
    JOIN pg_namespace AS mns ON mns.oid = typ.typnamespace
    WHERE typ.typrelid = 0
      AND NOT EXISTS (SELECT 1 FROM pg_type AS elem WHERE elem.typarray = typ.oid)
  ) AS owned
  WHERE owned.nspname IN ('auth', 'storage', 'realtime', 'extensions', 'vault', 'graphql', 'graphql_public',
                          'supabase_functions', 'supabase_migrations', 'net', 'cron', 'pgsodium',
                          'pgsodium_masks', 'pgbouncer')
    AND owned.ownerid = (SELECT rol.oid FROM pg_roles AS rol WHERE rol.rolname = 'postgres')
    AND NOT EXISTS (SELECT 1 FROM ext_member AS em
                    WHERE em.classid = owned.classoid AND em.objid = owned.objoid)
  -- A schema owned by postgres that is neither ours nor managed would be
  -- invisible to every P section. Name only, info only (SA code review 6).
  UNION ALL
  SELECT 'I7', format('unlisted schema | %s', other_ns.nspname)
  FROM pg_namespace AS other_ns
  WHERE other_ns.nspowner = (SELECT rol.oid FROM pg_roles AS rol WHERE rol.rolname = 'postgres')
    AND other_ns.oid NOT IN (SELECT sch.nsp_oid FROM our_schemas AS sch)
    AND other_ns.nspname NOT IN ('auth', 'storage', 'realtime', 'extensions', 'vault', 'graphql', 'graphql_public',
                                 'supabase_functions', 'supabase_migrations', 'net', 'cron', 'pgsodium',
                                 'pgsodium_masks', 'pgbouncer', 'information_schema')
    AND left(other_ns.nspname, 3) <> 'pg_'

  -- [block I8]
  -- Reconciliation counts for DevOps (SA B-2), computed through the same
  -- filters as the sections, so a match against the inventory also proves the
  -- filters. Structural counts only, never a privilege count.
  UNION ALL
  SELECT 'I8',
         format('%s: tables=%s partitioned=%s views=%s matviews=%s sequences=%s foreign=%s composite=%s functions=%s triggers=%s policies=%s indexes=%s constraints=%s enums=%s',
                sch.nspname,
                (SELECT count(*) FROM our_rel AS rel WHERE rel.nspname = sch.nspname AND rel.relkind = 'r'),
                (SELECT count(*) FROM our_rel AS rel WHERE rel.nspname = sch.nspname AND rel.relkind = 'p'),
                (SELECT count(*) FROM our_rel AS rel WHERE rel.nspname = sch.nspname AND rel.relkind = 'v'),
                (SELECT count(*) FROM our_rel AS rel WHERE rel.nspname = sch.nspname AND rel.relkind = 'm'),
                (SELECT count(*) FROM our_rel AS rel WHERE rel.nspname = sch.nspname AND rel.relkind = 'S'),
                (SELECT count(*) FROM our_rel AS rel WHERE rel.nspname = sch.nspname AND rel.relkind = 'f'),
                (SELECT count(*) FROM our_rel AS rel WHERE rel.nspname = sch.nspname AND rel.relkind = 'c'),
                (SELECT count(*) FROM our_fn AS fn WHERE fn.nspname = sch.nspname),
                (SELECT count(*) FROM our_rel AS rel JOIN pg_trigger AS trg ON trg.tgrelid = rel.rel_oid
                 WHERE rel.nspname = sch.nspname AND NOT trg.tgisinternal),
                (SELECT count(*) FROM our_rel AS rel JOIN pg_policy AS pol ON pol.polrelid = rel.rel_oid
                 WHERE rel.nspname = sch.nspname),
                (SELECT count(*) FROM our_rel AS rel JOIN pg_index AS idx ON idx.indrelid = rel.rel_oid
                 WHERE rel.nspname = sch.nspname),
                (SELECT count(*) FROM our_rel AS rel JOIN pg_constraint AS con ON con.conrelid = rel.rel_oid
                 WHERE rel.nspname = sch.nspname),
                (SELECT count(*) FROM our_type AS typ WHERE typ.nspname = sch.nspname AND typ.typtype = 'e'))
  FROM our_schemas AS sch
),
all_lines AS (
  SELECT lines.section, lines.line FROM lines
  UNION ALL
  SELECT info_lines.section, info_lines.line FROM info_lines
),
-- [block sections]
-- kind: context and structure and acl sections must have at least one line.
-- grantor (G1) must have none. info rows are never a gate.
-- display: value prints the line itself, count prints the line count and the
-- md5, md5 prints the md5 only. Every acl section is md5 (SA B-4).
sections (sort_order, code, title, kind, display) AS (
  VALUES
    (100, 'P00', 'deparse context', 'context', 'value'),
    (101, 'P01', 'relations', 'structure', 'count'),
    (102, 'P02', 'columns', 'structure', 'count'),
    (103, 'P03', 'constraints', 'structure', 'count'),
    (104, 'P04', 'indexes', 'structure', 'count'),
    (105, 'P05', 'triggers', 'structure', 'count'),
    (106, 'P06', 'views', 'structure', 'count'),
    (107, 'P07', 'functions', 'structure', 'count'),
    (108, 'P08', 'function ACLs', 'acl', 'md5'),
    (109, 'P09', 'relation ACLs', 'acl', 'md5'),
    (110, 'P10', 'column ACLs', 'acl', 'md5'),
    (111, 'P11', 'policies', 'structure', 'count'),
    (112, 'P12', 'types', 'structure', 'count'),
    (113, 'P13', 'sequences', 'structure', 'count'),
    (114, 'P14', 'schemas', 'structure', 'count'),
    (115, 'P15', 'default ACLs of postgres', 'acl', 'md5'),
    (116, 'P16', 'extensions in our schemas', 'structure', 'count'),
    (117, 'P17', 'extension member function ACLs', 'acl', 'md5'),
    (118, 'P18', 'comments', 'structure', 'count'),
    (119, 'P19', 'our triggers on managed tables', 'structure', 'count'),
    (120, 'P20', 'storage buckets', 'structure', 'count'),
    (121, 'P21', 'storage policies', 'structure', 'count'),
    (122, 'P22', 'realtime publication', 'structure', 'count'),
    (123, 'P23', 'API role settings', 'structure', 'count'),
    (124, 'P24', 'type ACLs', 'acl', 'md5'),
    (125, 'P25', 'schema ACLs', 'acl', 'md5'),
    (126, 'P26', 'object census', 'structure', 'count'),
    (150, 'G1', 'ACL items whose grantor is not the owner', 'grantor', 'presence'),
    (1001, 'I1', 'server version', 'info', 'value'),
    (1002, 'I2', 'extensions in managed schemas', 'info', 'count'),
    (1003, 'I3', 'pg_graphql', 'info', 'value'),
    (1004, 'I4', 'other default ACLs', 'info', 'md5'),
    (1005, 'I5', 'event triggers', 'info', 'count'),
    (1006, 'I6', 'database and login role settings', 'info', 'count'),
    (1007, 'I7', 'objects owned by postgres in managed schemas', 'info', 'count'),
    (1008, 'I8', 'reconciliation counts', 'info', 'value')
),
summary AS (
  SELECT sec.sort_order, sec.code, sec.title, sec.kind, sec.display,
         count(all_lines.line) AS line_count,
         md5(coalesce(string_agg(all_lines.line, chr(10) ORDER BY all_lines.line COLLATE "C"), '')) AS fingerprint,
         string_agg(all_lines.line, ' / ' ORDER BY all_lines.line COLLATE "C") AS joined
  FROM sections AS sec
  LEFT JOIN all_lines ON all_lines.section = sec.code
  GROUP BY sec.sort_order, sec.code, sec.title, sec.kind, sec.display
),
graded AS (
  SELECT summary.sort_order, summary.code, summary.title,
         CASE WHEN summary.kind = 'info' THEN 'INFO'
              WHEN summary.kind = 'grantor' THEN CASE WHEN summary.line_count = 0 THEN 'PASS' ELSE 'FAIL' END
              WHEN summary.line_count > 0 THEN 'PASS'
              ELSE 'FAIL' END AS result,
         CASE WHEN summary.kind = 'grantor'
                THEN CASE WHEN summary.line_count = 0 THEN 'none'
                          ELSE 'present, list them privately in lines mode' END
              WHEN summary.display = 'value' THEN coalesce(summary.joined, '(no lines)')
              WHEN summary.display = 'count' THEN summary.line_count || ' lines, md5 ' || summary.fingerprint
              ELSE 'md5 ' || summary.fingerprint END AS detail
  FROM summary
),
report AS (
  -- [block report]
  SELECT 0 AS sort_order, 0 AS sub_order, 'VERDICT'::text AS check_name,
         CASE WHEN EXISTS (SELECT 1 FROM graded WHERE graded.result = 'FAIL') THEN 'FAIL' ELSE 'PASS' END AS result,
         (SELECT count(*) FROM graded WHERE graded.result = 'PASS') || ' pass '
           || (SELECT count(*) FROM graded WHERE graded.result = 'FAIL') || ' fail'
           || ' | compare CONTEXT KEY first, unequal means VOID, then PARITY KEY' AS detail
  UNION ALL
  SELECT graded.sort_order, 0, graded.code || ' ' || graded.title, graded.result, graded.detail
  FROM graded
  UNION ALL
  -- CONTEXT KEY is the P00 hash on its own. When it differs the comparison is VOID (SA B-3).
  SELECT 900, 0, 'CONTEXT KEY', 'INFO',
         (SELECT 'md5 ' || summary.fingerprint FROM summary WHERE summary.code = 'P00')
  UNION ALL
  -- PARITY KEY covers P01 to P26 only. P00 is the context, not the schema.
  SELECT 901, 0, 'PARITY KEY', 'INFO',
         (SELECT 'md5 ' || md5(string_agg(summary.fingerprint, ',' ORDER BY summary.sort_order))
          FROM summary WHERE summary.kind IN ('structure', 'acl'))
  UNION ALL
  SELECT sec.sort_order, 1, all_lines.section, 'LINE', all_lines.line
  FROM all_lines
  JOIN sections AS sec ON sec.code = all_lines.section
  CROSS JOIN params
  WHERE params.run_mode = 'lines'
)
SELECT report.check_name, report.result, report.detail
FROM report
ORDER BY report.sort_order, report.sub_order, report.detail COLLATE "C";

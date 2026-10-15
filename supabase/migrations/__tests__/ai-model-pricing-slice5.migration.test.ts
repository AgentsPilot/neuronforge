/**
 * Guard over AI model price review slice 5, migration `20261069`: the submit
 * function learns fetch rounds (workplan
 * docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE5_WORKPLAN.md §4; SA SC-1..SC-6).
 *
 * WHY A TEST OVER SQL TEXT. There is no branch database: the user pastes these
 * files in the Supabase SQL editor on PRODUCTION by hand. What the files alone
 * can prove is pinned here: paste safety, the exact statement list (one
 * CREATE OR REPLACE, the grants, nothing that touches a table), the unchanged
 * signature and attributes, the slice 3 body rules re-asserted on the new
 * body, the five cross-check columns, the zero-line rule only on `fetch`, and
 * a rollback that restores the slice 3 function byte for byte.
 *
 * The slice 3 test reads only its own four files and stays unedited (SC-4).
 */

import { existsSync } from 'fs';
import { join } from 'path';

import { bodyOf, flatOf, literalsOf, readSql, statementsOf } from '@/tests/helpers/sqlText';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261069_ai_price_submit_pending_fetch_rounds.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261069_ai_price_submit_pending_fetch_rounds_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-ai-price-submit-pending-fetch-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-ai-price-submit-pending-fetch-migration.sql');
const SLICE3 = join(ROOT, 'supabase', 'migrations', '20261066_ai_price_pending_area.sql');

const migration = readSql(MIGRATION);
const rollback = readSql(ROLLBACK);
const checker = readSql(CHECKER);
const probe = readSql(PROBE);
const slice3 = readSql(SLICE3);

const SUBMIT_FN = 'public.ai_price_submit_pending(uuid, text, jsonb, jsonb)';
const RETURNS =
  'RETURNS TABLE (out_proposal_id uuid, out_line_id uuid, out_line_index integer, out_superseded_line_id uuid)';
const LIVE_TABLE = /ai_model_pricing|ai_model_image_pricing/;
const CROSS_CHECK_COLUMNS = [
  'cross_check_verdict',
  'cross_check_value',
  'cross_check_source',
  'cross_check_fetched_at',
  'cross_check_diff_pct',
];

/** The slice 3 `CREATE FUNCTION public.ai_price_submit_pending ... $submit_pending$;` text. */
function slice3Function(): string {
  const start = slice3.indexOf('CREATE FUNCTION public.ai_price_submit_pending(');
  const end = slice3.indexOf('$submit_pending$;', start) + '$submit_pending$;'.length;
  return slice3.slice(start, end);
}

const PLAIN_LITERAL = /^[A-Za-z0-9_ ]*$/;
const PASTED_FILES: Array<[string, string]> = [
  ['migration', MIGRATION],
  ['rollback', ROLLBACK],
  ['checker', CHECKER],
  ['probe', PROBE],
];

describe('paste safety (SC-6)', () => {
  it.each(PASTED_FILES)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(PASTED_FILES)('%s has no line comment, no block comment and no backslash', (_name, file) => {
    const text = readSql(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
    expect(text).not.toContain(String.fromCharCode(92));
  });

  it.each(PASTED_FILES)('%s is ASCII only', (_name, file) => {
    expect(/^[ -~\n\t]*$/.test(readSql(file))).toBe(true);
  });

  it.each(PASTED_FILES)('%s uses no single-letter alias', (_name, file) => {
    expect(readSql(file)).not.toMatch(/(?<![A-Za-z0-9_])AS [a-z](?![A-Za-z0-9_])/i);
    expect(readSql(file)).not.toMatch(/(?<![A-Za-z0-9_])(FROM|JOIN) [a-z_.]+ [a-z](?![A-Za-z0-9_])(?! *[(])/);
  });

  it.each([
    ['migration', migration],
    ['rollback', rollback],
  ])('%s says "into" exactly twice, each as one of the two INSERT statements', (_name, text) => {
    expect(text.match(/into/gi)).toHaveLength(2);
    expect(text.match(/INSERT INTO public[.]ai_price_proposals [(]/g)).toHaveLength(1);
    expect(text.match(/INSERT INTO public[.]ai_price_proposal_lines [(]/g)).toHaveLength(1);
    for (const literal of literalsOf(text)) expect(literal).not.toMatch(/into/i);
  });

  it.each([
    ['checker', checker],
    ['probe', probe],
  ])('%s never contains "into"', (_name, text) => {
    expect(text).not.toMatch(/into/i);
  });

  it('every literal is letters, digits, underscores and spaces, with named exceptions only', () => {
    const allowed: Record<string, (literal: string) => boolean> = {
      migration: () => false,
      rollback: () => false,
      checker: (literal) =>
        [
          SUBMIT_FN,
          'search_path=""',
          'TABLE(out_proposal_id uuid, out_line_id uuid, out_line_index integer, out_superseded_line_id uuid)',
        ].includes(literal),
      probe: (literal) =>
        ['probe-model-', '0.075', '0.3', '7.25', 'developers.openai.com', 'raw.githubusercontent.com'].includes(literal) ||
        // SA F-4: P05 passes only for a refused EXECUTE, not for any other privilege error.
        literal === 'permission denied for function%' ||
        /^P0[0-9] (PASS|FAIL) [a-z0-9 _]+$/i.test(literal) ||
        /^PROBE SKIPPED  [a-z0-9 _]+$/i.test(literal) ||
        literal === '  this error is expected and rolls everything back',
    };
    for (const [name, file] of PASTED_FILES) {
      for (const literal of literalsOf(readSql(file))) {
        if (!PLAIN_LITERAL.test(literal)) {
          expect({ name, literal, ok: allowed[name](literal) }).toEqual({ name, literal, ok: true });
        }
      }
    }
  });
});

describe('statement list (SC-2)', () => {
  const expectedTail = [
    `REVOKE ALL ON FUNCTION ${SUBMIT_FN} FROM PUBLIC`,
    `REVOKE ALL ON FUNCTION ${SUBMIT_FN} FROM anon`,
    `REVOKE ALL ON FUNCTION ${SUBMIT_FN} FROM authenticated`,
    `REVOKE ALL ON FUNCTION ${SUBMIT_FN} FROM service_role`,
    `GRANT EXECUTE ON FUNCTION ${SUBMIT_FN} TO service_role`,
    'COMMIT',
  ];

  it.each([
    ['migration', migration, '5s'],
    ['rollback', rollback, '2s'],
  ])('%s is BEGIN, lock_timeout, one CREATE OR REPLACE, four REVOKEs, one GRANT, COMMIT', (_name, text, timeout) => {
    const statements = statementsOf(text);
    expect(statements).toHaveLength(9);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe(`SET LOCAL lock_timeout = '${timeout}'`);
    expect(statements[2].startsWith('CREATE OR REPLACE FUNCTION public.ai_price_submit_pending( p_admin_user_id uuid, p_source_kind text, p_provider_outcomes jsonb, p_lines jsonb )')).toBe(true);
    expect(statements.slice(3)).toEqual(expectedTail);
    expect(text.startsWith(`BEGIN;\nSET LOCAL lock_timeout = '${timeout}';\n`)).toBe(true);
  });

  it('touches no table, trigger or index, and drops nothing', () => {
    for (const text of [migration, rollback]) {
      expect(text).not.toMatch(/ALTER TABLE|ON TABLE|CREATE TRIGGER|CREATE (UNIQUE )?INDEX|DROP /);
      expect(text).not.toMatch(/SECURITY DEFINER/);
    }
  });
});

describe('signature and attributes (SC-2, SC-4)', () => {
  it('the RETURNS TABLE text is identical to slice 3', () => {
    expect(slice3Function()).toContain(RETURNS);
    expect(migration.split(RETURNS)).toHaveLength(2);
  });

  it('SECURITY INVOKER with an empty search path is stated once', () => {
    expect(migration.match(/LANGUAGE plpgsql\nVOLATILE\nSECURITY INVOKER\nSET search_path = ''/g)).toHaveLength(1);
    expect(migration.match(/SECURITY INVOKER\nSET search_path = ''/g)).toHaveLength(1);
  });
});

describe('the new body (SC-3)', () => {
  const body = bodyOf(migration, 'submit_pending');
  const flat = flatOf(body);

  it('never names a live price table', () => {
    expect(body).not.toMatch(LIVE_TABLE);
    expect(migration).not.toMatch(LIVE_TABLE);
  });

  it('keeps the admin check', () => {
    expect(flat).toContain(
      'IF NOT EXISTS ( SELECT 1 FROM public.admin_users AS admin_row WHERE admin_row.user_id = p_admin_user_id AND admin_row.is_active ) THEN'
    );
    expect(flat).toContain("USING ERRCODE = '42501'");
  });

  it('keeps the advisory lock in unit-key order, the supersede, then the insert', () => {
    const order = [
      flat.indexOf('ORDER BY unit_key'),
      flat.indexOf('PERFORM pg_advisory_xact_lock(hashtextextended('),
      flat.indexOf("SET state = 'superseded', decided_by = p_admin_user_id, decided_at = now(), superseded_by = v_line_id"),
      flat.indexOf('INSERT INTO public.ai_price_proposal_lines ('),
    ];
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps the duplicate-unit check and the pre-generated ids (no RETURNING)', () => {
    expect(flat).toContain("RAISE EXCEPTION 'two lines name the same model and unit' USING ERRCODE = '22023';");
    expect(flat).toContain('v_proposal_id := gen_random_uuid();');
    expect(flat).toContain('v_line_id := gen_random_uuid();');
    expect(body).not.toMatch(/RETURNING/);
  });

  it('the lines INSERT names all five cross-check columns and reads them from the line JSON', () => {
    const insert = flat.slice(flat.indexOf('INSERT INTO public.ai_price_proposal_lines ('));
    for (const column of CROSS_CHECK_COLUMNS) {
      expect(insert).toContain(column);
    }
    expect(insert).toContain("v_line.line_value ->> 'cross_check_verdict'");
    expect(insert).toContain("(v_line.line_value ->> 'cross_check_fetched_at')::timestamptz");
    expect(insert).toContain("(v_line.line_value ->> 'cross_check_diff_pct')::numeric");
  });

  it('zero lines are allowed only on the fetch branch, and need provider outcomes', () => {
    expect(flat).toContain("IF p_source_kind = 'fetch' THEN IF jsonb_array_length(p_lines) > 200 THEN");
    expect(flat).toContain(
      "IF jsonb_array_length(p_lines) = 0 AND (p_provider_outcomes IS NULL OR jsonb_typeof(p_provider_outcomes) <> 'object') THEN"
    );
    expect(flat).toContain("ELSIF jsonb_array_length(p_lines) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'ai_price_submit_pending needs between 1 and 200 lines' USING ERRCODE = '22023';");
  });

  it('a zero-line round returns one row with the round id and no line, after the round insert', () => {
    const roundInsert = flat.indexOf('INSERT INTO public.ai_price_proposals (');
    const zero = flat.indexOf(
      'IF jsonb_array_length(p_lines) = 0 THEN out_proposal_id := v_proposal_id; out_line_id := NULL; out_line_index := NULL; out_superseded_line_id := NULL; RETURN NEXT; RETURN; END IF;'
    );
    expect(roundInsert).toBeGreaterThan(-1);
    expect(zero).toBeGreaterThan(roundInsert);
  });
});

describe('rollback (SC-5a)', () => {
  it('restores the slice 3 function byte for byte (CREATE becomes CREATE OR REPLACE)', () => {
    const restored = rollback.slice(rollback.indexOf('CREATE OR REPLACE FUNCTION'), rollback.indexOf('$submit_pending$;') + '$submit_pending$;'.length);
    expect(restored).toBe(slice3Function().replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION'));
  });

  it('has no guard block and deletes nothing (the statement list above holds only the function and its grants)', () => {
    expect(rollback).not.toMatch(/DELETE|DO [$]/);
  });
});

describe('checker and probe (SC-5)', () => {
  it('the checker is read-only from its first statement and writes nothing', () => {
    expect(checker.startsWith('SET default_transaction_read_only = on;\n')).toBe(true);
    expect(checker).not.toMatch(/(?<![A-Za-z0-9_])(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)(?![A-Za-z0-9_])(?!')/);
  });

  it('the checker covers existence, invoker, search path, result type, grants, the live body and no live table', () => {
    const flat = flatOf(checker);
    expect(flat).toContain(`to_regprocedure('${SUBMIT_FN}')`);
    expect(flat).toContain('NOT submit_proc.prosecdef');
    expect(flat).toContain(`submit_proc.proconfig = ARRAY['search_path=""']`);
    expect(flat).toContain('pg_get_function_result(submit_proc.oid)');
    expect(flat).toContain("has_function_privilege('service_role', submit_proc.oid, 'EXECUTE')");
    expect(flat).toContain('aclexplode(submit_proc.proacl)');
    expect(flat).toContain("position('cross_check_verdict' IN submit_proc.prosrc) > 0");
    expect(flat).toContain("position('ai_model_image_pricing' IN submit_proc.prosrc) = 0");
    expect(flat).toContain("'VERDICT' AS check_name");
  });

  it('the probe is one DO block that always ends in an error, so nothing it writes is kept', () => {
    expect(probe.trim().startsWith('DO $probe$')).toBe(true);
    expect(probe.trim().endsWith('$probe$;')).toBe(true);
    expect(probe).not.toMatch(/(?<![A-Za-z0-9_])COMMIT(?![A-Za-z0-9_])/);
    const flat = flatOf(probe);
    expect(flat.slice(flat.lastIndexOf('RAISE EXCEPTION'))).toMatch(
      /^RAISE EXCEPTION USING MESSAGE = 'PROBE ' [|][|] CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END/
    );
    expect(probe).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('the probe checks P01 to P05', () => {
    for (const label of ['P01', 'P02', 'P03', 'P04', 'P05']) expect(probe).toContain(`'${label} PASS`);
    expect(flatOf(probe)).toContain(
      "IF SQLERRM LIKE 'permission denied for function%' THEN v_report := v_report || chr(10) || 'P05 PASS authenticated cannot run the submit function'; ELSE v_fail := true;"
    );
  });
});

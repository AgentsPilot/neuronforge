/**
 * Guard over AI model price review slice 3, the pending-price area (workplan
 * docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE3_WORKPLAN.md §2 and §5; SA changes
 * C-1 to C-4, C-11, rulings O-1, O-2, O-12, O-17).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run Postgres and there is no branch
 * database: the user pastes these files in the Supabase SQL editor on
 * PRODUCTION by hand. What the files alone can prove is pinned here: paste
 * safety ("into" only in the two INSERT statements), the R-2 security shape
 * (REVOKE ALL per role, admin-only SELECT policy, INVOKER functions executable
 * by service_role only, the narrowed column grant), the transition trigger,
 * that the submit function never names the live price tables, that the only
 * statements naming them are the provenance foreign keys and indexes placed
 * LAST, and that the checker, rollback and probe stay in step.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { PRICE_STRING_PATTERN } from '@/lib/ai/pricing-research/bounds';
import { PENDING_LINE_FLAGS } from '@/lib/ai/pricing-research/lineFlags';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261066_ai_price_pending_area.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261066_ai_price_pending_area_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-ai-price-pending-area-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-ai-price-pending-area-migration.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const flatOf = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const probe = read(PROBE);
const migrationFlat = flatOf(migration);
const rollbackFlat = flatOf(rollback);

const PROPOSALS = 'public.ai_price_proposals';
const LINES = 'public.ai_price_proposal_lines';
const SUBMIT_FN = 'public.ai_price_submit_pending(uuid, text, jsonb, jsonb)';
const TRANSITION_FN = 'public.ai_price_proposal_line_transition()';
const LIVE_TABLE = /(?<![A-Za-z0-9_])public[.](ai_model_pricing|ai_model_image_pricing)(?![A-Za-z0-9_])/;

/** Statements of a file, split on semicolons outside dollar-quoted bodies. */
function statementsOf(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollarTag: string | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const rest = sql.slice(index);
    const tag = /^[$][a-z_]*[$]/.exec(rest);
    if (tag) {
      if (dollarTag === null) dollarTag = tag[0];
      else if (dollarTag === tag[0]) dollarTag = null;
      current += tag[0];
      index += tag[0].length - 1;
      continue;
    }
    const character = sql[index];
    if (character === ';' && dollarTag === null) {
      statements.push(flatOf(current));
      current = '';
    } else {
      current += character;
    }
  }
  if (flatOf(current)) statements.push(flatOf(current));
  return statements.filter(Boolean);
}

function bodyOf(sql: string, tag: string): string {
  const start = sql.indexOf(`$${tag}$`);
  const end = sql.indexOf(`$${tag}$`, start + 1);
  if (start < 0 || end < 0) throw new Error(`no body ${tag}`);
  return sql.slice(start, end);
}

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

const PLAIN_LITERAL = /^[A-Za-z0-9_ ]*$/;
/** No backslash anywhere in this file's regexes that a hex digit follows (Tailwind scan hazard, PR #180): word boundaries are spelled out. */
const QUALIFIED_NAME_LITERAL = /^public[.][a-z0-9_]+$/;

const PASTED_FILES: Array<[string, string]> = [
  ['migration', MIGRATION],
  ['rollback', ROLLBACK],
  ['checker', CHECKER],
  ['probe', PROBE],
];

describe('paste safety (the user pastes every file by hand on production)', () => {
  it.each(PASTED_FILES)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(PASTED_FILES)('%s has no line comment, no block comment and no backslash', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
    expect(text).not.toContain(String.fromCharCode(92));
  });

  it.each(PASTED_FILES)('%s is ASCII only', (_name, file) => {
    expect(/^[\x00-\x7F]*$/.test(read(file))).toBe(true);
  });

  it.each(PASTED_FILES)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/(?<![A-Za-z0-9_])AS [a-z](?![A-Za-z0-9_])/i);
    expect(read(file)).not.toMatch(/(?<![A-Za-z0-9_])(FROM|JOIN) [a-z_.]+ [a-z](?![A-Za-z0-9_])(?! *[(])/);
  });

  // O-1: the editor misreads "into" inside a literal. The SQL keyword in the
  // two INSERT statements is the only occurrence allowed anywhere.
  it('the migration says "into" exactly twice, each as one of the two INSERT statements', () => {
    expect(migration.match(/into/gi)).toHaveLength(2);
    expect(migration.match(/INSERT INTO public[.]ai_price_proposals [(]/g)).toHaveLength(1);
    expect(migration.match(/INSERT INTO public[.]ai_price_proposal_lines [(]/g)).toHaveLength(1);
    for (const literal of literalsOf(migration)) expect(literal).not.toMatch(/into/i);
  });

  it.each([
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
    ['probe', PROBE],
  ])('%s never contains "into" anywhere', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it('every literal is letters, digits, underscores and spaces, with named exceptions only', () => {
    const allowed: Record<string, (literal: string) => boolean> = {
      migration: (literal) =>
        [
          PRICE_STRING_PATTERN,
          '^[a-z0-9]+$',
          '^[a-z0-9]+([.-][a-z0-9]+)*$',
          '^[0-9]{2,5}x[0-9]{2,5}$',
          '^[a-z]{1,20}$',
        ].includes(literal),
      rollback: () => false,
      checker: (literal) =>
        [
          'public.ai_price_submit_pending(uuid, text, jsonb, jsonb)',
          'public.ai_price_proposal_line_transition()',
          'search_path=""',
          'public.',
        ].includes(literal),
      probe: (literal) =>
        ['probe-model-', '0.075', '0.3', 'developers.openai.com', 'P01 PASS 0 point 075 per 1M stored as exactly 0 point 000000075 per token'].includes(literal) ||
        /^P0[0-9] (PASS|FAIL) [a-z0-9 _]+$/i.test(literal) ||
        /^PROBE SKIPPED  [a-z0-9 _]+$/i.test(literal) ||
        literal === '  this error is expected and rolls everything back',
    };
    for (const [name, file] of PASTED_FILES) {
      for (const literal of literalsOf(read(file))) {
        if (!PLAIN_LITERAL.test(literal) && !QUALIFIED_NAME_LITERAL.test(literal)) {
          expect({ name, literal, ok: allowed[name](literal) }).toEqual({ name, literal, ok: true });
        }
      }
    }
  });

  it.each([
    ['migration', migration, '5s'],
    ['rollback', rollback, '2s'],
  ])('%s is one BEGIN ... COMMIT with lock_timeout set first', (_name, text, timeout) => {
    expect(text.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(text.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(text.startsWith(`BEGIN;\nSET LOCAL lock_timeout = '${timeout}';\n`)).toBe(true);
  });

  it('the checker is read-only from its first statement and writes nothing', () => {
    expect(checker.startsWith('SET default_transaction_read_only = on;\n')).toBe(true);
    expect(checker).not.toMatch(/(?<![A-Za-z0-9_])(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)(?![A-Za-z0-9_])(?!')/);
  });

  it('the checker never names the new tables outside the catalogue (it must parse before the migration, step U-1)', () => {
    expect(checker).not.toMatch(/FROM public[.]ai_price_/);
    expect(checker).not.toMatch(/JOIN public[.]ai_price_/);
  });
});

describe('tables (RR-2, O-2, C-3)', () => {
  it('prices are the submitted per 1M text plus four STORED generated numbers, by multiplication (O-2)', () => {
    expect(migrationFlat).toContain('input_cost_per_token numeric GENERATED ALWAYS AS (input_per_1m::numeric * 0.000001) STORED');
    expect(migrationFlat).toContain('output_cost_per_token numeric GENERATED ALWAYS AS (output_per_1m::numeric * 0.000001) STORED');
    expect(migrationFlat).toContain(
      'cached_input_cost_per_token numeric GENERATED ALWAYS AS (cached_input_per_1m::numeric * 0.000001) STORED'
    );
    expect(migrationFlat).toContain('cost_per_image numeric GENERATED ALWAYS AS (price_per_image::numeric) STORED');
    expect(migration).not.toMatch(/[/] *1000000/);
    expect(migration).not.toMatch(/(?<![A-Za-z0-9_])numeric *[(]/i);
  });

  it('the price CHECK uses the same R-1 pattern as the shared Zod schema', () => {
    const pattern = `'${PRICE_STRING_PATTERN}'`;
    expect(migration.split(pattern)).toHaveLength(5);
  });

  it('the flag CHECK lists exactly the flags the code knows', () => {
    const match = /flags <@ ARRAY\[([^\]]+)\]::text\[\]/.exec(migrationFlat);
    expect(match).not.toBeNull();
    const listed = literalsOf(match![1]);
    expect(listed).toEqual([...PENDING_LINE_FLAGS]);
  });

  it('C-3: prices must be above 0 (output may be 0) and superseded carries no reasons', () => {
    expect(migrationFlat).toContain('AND input_cost_per_token > 0 AND output_cost_per_token >= 0');
    expect(migrationFlat).toContain('AND (cached_input_per_1m IS NULL OR cached_input_cost_per_token > 0)');
    expect(migrationFlat).toContain('AND cost_per_image > 0');
    expect(migrationFlat).toContain(
      "(state = 'superseded' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND superseded_by IS NOT NULL AND decision_reason IS NULL AND override_reason IS NULL)"
    );
  });

  it('one pending line per model and unit, by a partial unique index', () => {
    expect(migrationFlat).toContain(
      "CREATE UNIQUE INDEX ai_price_proposal_lines_one_pending_key ON public.ai_price_proposal_lines (provider, model_name, kind, coalesce(image_size, ''), coalesce(image_quality, '')) WHERE state = 'pending';"
    );
  });

  it('the supersede self-reference is deferred, so a line can be superseded before its successor is inserted', () => {
    expect(migrationFlat).toContain(
      'FOREIGN KEY (superseded_by) REFERENCES public.ai_price_proposal_lines (id) DEFERRABLE INITIALLY DEFERRED'
    );
  });

  it('created_by and decided_by have no foreign key to auth.users (account deletion hazard)', () => {
    expect(migration).not.toMatch(/auth[.]users/);
  });
});

describe('security (R-2 precedent, C-1)', () => {
  const statements = statementsOf(migration);

  it.each([PROPOSALS, LINES])('%s: RLS on, one admin SELECT policy, REVOKE ALL per role on its own line', (table) => {
    expect(statements).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
    const policies = statements.filter((statement) => statement.startsWith('CREATE POLICY') && statement.includes(` ON ${table} `));
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/FOR SELECT TO authenticated USING [(][(]SELECT public[.]is_platform_admin[(][)][)][)]$/);
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(statements).toContain(`REVOKE ALL ON TABLE ${table} FROM ${role}`);
    }
  });

  it('grants exactly: authenticated SELECT, service_role SELECT and INSERT, plus four UPDATE columns on lines (C-1)', () => {
    const grants = statements.filter((statement) => statement.startsWith('GRANT') && statement.includes(' ON TABLE '));
    expect(grants).toEqual([
      `GRANT SELECT ON TABLE ${PROPOSALS} TO authenticated`,
      `GRANT SELECT ON TABLE ${LINES} TO authenticated`,
      `GRANT SELECT, INSERT ON TABLE ${PROPOSALS} TO service_role`,
      `GRANT SELECT, INSERT, UPDATE (state, decided_by, decided_at, superseded_by) ON TABLE ${LINES} TO service_role`,
    ]);
    const lastRevoke = Math.max(...statements.map((s, i) => (s.startsWith('REVOKE ALL ON TABLE') ? i : -1)));
    const firstGrant = statements.findIndex((s) => s.startsWith('GRANT'));
    expect(firstGrant).toBeGreaterThan(lastRevoke);
    expect(migration).not.toMatch(/GRANT[^;]*(?<![A-Za-z0-9_])(DELETE|TRUNCATE|REFERENCES|TRIGGER)(?![A-Za-z0-9_])/);
    expect(migration).not.toMatch(/GRANT[^;]*TO (anon|PUBLIC)/);
  });

  it('both functions are SECURITY INVOKER with an empty search path; none is SECURITY DEFINER', () => {
    expect(migration).not.toMatch(/SECURITY DEFINER/);
    expect(migration.match(/SECURITY INVOKER\nSET search_path = ''/g)).toHaveLength(2);
  });

  it('the submit function is executable by service_role only, revoked after it is created', () => {
    const create = statements.findIndex((s) => s.startsWith('CREATE FUNCTION public.ai_price_submit_pending'));
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      const revoke = statements.indexOf(`REVOKE ALL ON FUNCTION ${SUBMIT_FN} FROM ${role}`);
      expect(revoke).toBeGreaterThan(create);
    }
    expect(statements.filter((s) => s.startsWith('GRANT EXECUTE'))).toEqual([`GRANT EXECUTE ON FUNCTION ${SUBMIT_FN} TO service_role`]);
  });

  it('the trigger function is revoked from PUBLIC, anon and authenticated after it is created (C-2)', () => {
    const create = statements.findIndex((s) => s.startsWith('CREATE FUNCTION public.ai_price_proposal_line_transition'));
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(statements.indexOf(`REVOKE ALL ON FUNCTION ${TRANSITION_FN} FROM ${role}`)).toBeGreaterThan(create);
    }
  });
});

describe('the transition trigger (C-2)', () => {
  const body = flatOf(bodyOf(migration, 'line_transition'));

  it('refuses anything but pending to superseded, applied or dismissed', () => {
    expect(body).toContain("IF OLD.state <> 'pending' OR NEW.state NOT IN ('superseded', 'applied', 'dismissed') THEN");
    expect(body).toContain("USING ERRCODE = '23514'");
  });

  it('fires BEFORE UPDATE on every line and never names the live tables', () => {
    expect(migrationFlat).toContain(
      'CREATE TRIGGER ai_price_proposal_lines_transition BEFORE UPDATE ON public.ai_price_proposal_lines FOR EACH ROW EXECUTE FUNCTION public.ai_price_proposal_line_transition();'
    );
    expect(body).not.toMatch(LIVE_TABLE);
  });
});

describe('the submit function (RR-1, RR-2)', () => {
  const body = bodyOf(migration, 'submit_pending');
  const flat = flatOf(body);

  it('never names ai_model_pricing or ai_model_image_pricing (pending-only writes)', () => {
    expect(body).not.toMatch(/ai_model_pricing|ai_model_image_pricing/);
  });

  it('repeats the admin check on the admin id it is given (R-2, O-15)', () => {
    expect(flat).toContain(
      'IF NOT EXISTS ( SELECT 1 FROM public.admin_users AS admin_row WHERE admin_row.user_id = p_admin_user_id AND admin_row.is_active ) THEN'
    );
    expect(flat).toContain("USING ERRCODE = '42501'");
  });

  it('takes the per-unit advisory lock in unit-key order, supersedes, then inserts', () => {
    const order = [
      flat.indexOf('ORDER BY unit_key'),
      flat.indexOf('PERFORM pg_advisory_xact_lock(hashtextextended('),
      flat.indexOf("SET state = 'superseded', decided_by = p_admin_user_id, decided_at = now(), superseded_by = v_line_id"),
      flat.indexOf('INSERT INTO public.ai_price_proposal_lines ('),
    ];
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('inserts prices as text only: it never computes a per token value itself (generated columns do)', () => {
    const insert = flat.slice(flat.indexOf('INSERT INTO public.ai_price_proposal_lines ('));
    expect(insert).not.toMatch(/0[.]000001/);
    expect(insert).toContain("v_line.line_value ->> 'input_per_1m'");
  });

  it('pre-generates ids instead of RETURNING or SELECT ... INTO', () => {
    expect(flat).toContain('v_proposal_id := gen_random_uuid();');
    expect(flat).toContain('v_line_id := gen_random_uuid();');
    expect(body).not.toMatch(/RETURNING/);
  });
});

describe('live price tables: foreign keys and indexes only, LAST (O-6, C-4, RR-6)', () => {
  const statements = statementsOf(migration);
  const naming = statements.filter((statement) => LIVE_TABLE.test(statement));

  it('the only statements naming the live tables are the four foreign keys and two indexes', () => {
    expect(naming).toEqual([
      'ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_proposal_fkey FOREIGN KEY (proposal_id) REFERENCES public.ai_price_proposals (id)',
      'ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_proposal_line_fkey FOREIGN KEY (proposal_line_id, proposal_id) REFERENCES public.ai_price_proposal_lines (id, proposal_id)',
      'CREATE INDEX ai_model_pricing_proposal_line_idx ON public.ai_model_pricing (proposal_line_id)',
      'ALTER TABLE public.ai_model_image_pricing ADD CONSTRAINT ai_model_image_pricing_proposal_fkey FOREIGN KEY (proposal_id) REFERENCES public.ai_price_proposals (id)',
      'ALTER TABLE public.ai_model_image_pricing ADD CONSTRAINT ai_model_image_pricing_proposal_line_fkey FOREIGN KEY (proposal_line_id, proposal_id) REFERENCES public.ai_price_proposal_lines (id, proposal_id)',
      'CREATE INDEX ai_model_image_pricing_proposal_line_idx ON public.ai_model_image_pricing (proposal_line_id)',
    ]);
  });

  it('they are the last six statements before COMMIT', () => {
    const tail = statements.slice(-7);
    expect(tail.slice(0, 6)).toEqual(naming);
    expect(tail[6]).toBe('COMMIT');
  });
});

describe('rollback', () => {
  it('refuses while any live price row came from a pending line, then drops everything in reverse', () => {
    expect(rollbackFlat).toContain('IF EXISTS (SELECT 1 FROM public.ai_model_pricing AS pricing WHERE pricing.proposal_id IS NOT NULL) THEN');
    expect(rollbackFlat).toContain(
      'IF EXISTS (SELECT 1 FROM public.ai_model_image_pricing AS image_pricing WHERE image_pricing.proposal_id IS NOT NULL) THEN'
    );
    const order = [
      'DROP INDEX public.ai_model_image_pricing_proposal_line_idx;',
      'ALTER TABLE public.ai_model_pricing DROP CONSTRAINT ai_model_pricing_proposal_fkey;',
      `DROP FUNCTION ${SUBMIT_FN};`,
      'DROP TRIGGER ai_price_proposal_lines_transition ON public.ai_price_proposal_lines;',
      `DROP FUNCTION ${TRANSITION_FN};`,
      `DROP TABLE ${LINES};`,
      `DROP TABLE ${PROPOSALS};`,
    ].map((needle) => rollbackFlat.indexOf(needle));
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(rollback).not.toMatch(/CASCADE|IF EXISTS public|DELETE|UPDATE/);
  });
});

describe('checker and probe stay in step with the migration', () => {
  it('the checker names every foreign key and index the migration creates', () => {
    for (const name of [...migration.matchAll(/ADD CONSTRAINT ([a-z_]+)\s+FOREIGN KEY/g)].map((match) => match[1])) {
      expect(checker).toContain(`'${name}'`);
    }
    for (const name of [...migration.matchAll(/CREATE (?:UNIQUE )?INDEX ([a-z_]+)/g)].map((match) => match[1])) {
      expect(checker).toContain(`'${name}'`);
    }
  });

  it('the checker asserts the one-pending index is unique and partial, not just present', () => {
    const flatChecker = flatOf(checker);
    expect(flatChecker).toContain(
      "WHERE pg_index.indexrelid = to_regclass('public.ai_price_proposal_lines_one_pending_key') AND pg_index.indisunique AND pg_index.indpred IS NOT NULL"
    );
  });

  it('the checker expects exactly the four UPDATE columns of C-1', () => {
    expect(checker).toContain("IN ('state', 'decided_by', 'decided_at', 'superseded_by')");
  });

  it('the probe is one DO block that always ends in an error, so nothing it writes is kept (C-11)', () => {
    expect(probe.trim().startsWith('DO $probe$')).toBe(true);
    expect(probe.trim().endsWith('$probe$;')).toBe(true);
    expect(probe).not.toMatch(/(?<![A-Za-z0-9_])COMMIT(?![A-Za-z0-9_])/);
    const flat = flatOf(probe);
    const last = flat.slice(flat.lastIndexOf('RAISE EXCEPTION'));
    expect(last).toMatch(/^RAISE EXCEPTION USING MESSAGE = 'PROBE ' [|][|] CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END/);
  });

  it('the probe reads the admin id from admin_users, switches to service_role, and holds no uuid literal', () => {
    expect(probe).toContain('FROM public.admin_users AS admin_row');
    expect(probe).toContain('SET LOCAL ROLE service_role;');
    expect(probe).not.toMatch(/'[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('the probe checks exactness, supersede, the trigger and the privilege refusals', () => {
    for (const label of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06']) expect(probe).toContain(`'${label} PASS`);
    expect(probe).toContain('pending_line.input_cost_per_token = 0.000000075');
  });
});

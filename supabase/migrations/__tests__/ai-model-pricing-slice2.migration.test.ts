/**
 * Guard over AI model price review slice 2 (workplan
 * docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE2_WORKPLAN.md sections 3 to 5 and 7,
 * SA changes SA-1 to SA-6, rulings O-1 to O-6).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run Postgres and there is no branch
 * database: the user pastes every one of these files into the Supabase SQL
 * editor on PRODUCTION by hand. What the files alone can prove is pinned here:
 * paste safety, that the baseline is a guarded no-op holding the captured
 * definition, that both cost columns become unconstrained numeric, that the
 * active-row index exists before the old constraint is dropped, that the
 * dependent legacy view `pilot_cost_savings_summary` is dropped before the
 * ALTER TYPE and recreated after it from the captured definition, the image
 * table's R-2 security shape, and that the retire script only retires the
 * twelve approved rows with a count check and an in-transaction price
 * fingerprint check.
 *
 * The captured names and types are constants in this file (SA-4c, O-1). The
 * test never parses the workplan.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SQL_SCRIPTS_DIR = join(ROOT, 'supabase', 'SQL Scripts');

const BASELINE = join(MIGRATIONS_DIR, '20261052_ai_model_pricing_baseline.sql');
const MIGRATION = join(MIGRATIONS_DIR, '20261053_ai_model_pricing_exact_prices_and_image_table.sql');
const ROLLBACK = join(SQL_SCRIPTS_DIR, '20261053_ai_model_pricing_exact_prices_and_image_table_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-ai-model-pricing-slice2-migration.sql');
const RETIRE = join(SQL_SCRIPTS_DIR, '20261010_ai_model_pricing_retire_duplicate_rows.sql');
const RETIRE_ROLLBACK = join(SQL_SCRIPTS_DIR, '20261010_ai_model_pricing_retire_duplicate_rows_rollback.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const flatOf = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const baseline = read(BASELINE);
const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const retire = read(RETIRE);
const retireRollback = read(RETIRE_ROLLBACK);
const baselineFlat = flatOf(baseline);
const migrationFlat = flatOf(migration);
const rollbackFlat = flatOf(rollback);
const retireFlat = flatOf(retire);
const retireRollbackFlat = flatOf(retireRollback);

// ---------------------------------------------------------------------------
// Captured from production on 2026-10-10 (C-1, user-run). See the capture MD.
// ---------------------------------------------------------------------------
const CAPTURED_UNIQUE_NAME = 'ai_model_pricing_provider_model_name_effective_date_key';
const CAPTURED_PK_NAME = 'ai_model_pricing_pkey';
const CAPTURED_COLUMNS = [
  'id uuid NOT NULL DEFAULT gen_random_uuid()',
  'provider character varying(50) NOT NULL',
  'model_name character varying(100) NOT NULL',
  'input_cost_per_token numeric(10,8) NOT NULL',
  'output_cost_per_token numeric(10,8) NOT NULL',
  'effective_date date NOT NULL',
  'retired_date date',
  'created_at timestamp with time zone DEFAULT now()',
];
const CAPTURED_POLICIES = [
  'CREATE POLICY ai_model_pricing_admin_select ON public.ai_model_pricing FOR SELECT TO authenticated USING (public.is_platform_admin())',
  'CREATE POLICY ai_model_pricing_admin_write ON public.ai_model_pricing FOR ALL TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin())',
];
const CAPTURED_TABLE_COMMENT =
  'Per-token model pricing; every credit charge is computed from it. Written only by the service role through ' +
  '/api/admin/system-config/pricing (admin-gated). RLS: admin_users-backed read + write for authenticated sessions; ' +
  'anon has no privileges beyond SELECT, which RLS then denies.';
const CAPTURED_GRANTS = [
  'GRANT SELECT ON TABLE public.ai_model_pricing TO anon',
  'GRANT SELECT ON TABLE public.ai_model_pricing TO authenticated',
  'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ai_model_pricing TO service_role',
];

/**
 * pg_get_viewdef('public.pilot_cost_savings_summary', true), captured by the
 * user 2026-10-10, with only the two table references schema-qualified.
 */
const CAPTURED_VIEW_BODY_QUALIFIED = flatOf(`
 WITH execution_costs AS (
         SELECT psrh.execution_id,
            psrh.agent_id,
            sum(psrh.tokens_used) AS total_tokens,
            sum(psrh.estimated_cost_usd) AS actual_cost,
            sum(psrh.tokens_used)::numeric * (( SELECT (ai_model_pricing.input_cost_per_token + ai_model_pricing.output_cost_per_token) / 2::numeric
                   FROM public.ai_model_pricing
                  WHERE ai_model_pricing.provider::text = 'openai'::text AND ai_model_pricing.model_name::text = 'gpt-4o'::text AND ai_model_pricing.retired_date IS NULL
                  ORDER BY ai_model_pricing.effective_date DESC
                 LIMIT 1)) AS tier3_cost,
            psrh.created_at
           FROM public.pilot_step_routing_history psrh
          WHERE psrh.routing_source = 'pilot_per_step'::text
          GROUP BY psrh.execution_id, psrh.agent_id, psrh.created_at
        )
 SELECT execution_id,
    agent_id,
    total_tokens,
    actual_cost,
    tier3_cost,
    tier3_cost - actual_cost AS cost_saved,
        CASE
            WHEN tier3_cost > 0::numeric THEN (tier3_cost - actual_cost) / tier3_cost * 100::numeric
            ELSE 0::numeric
        END AS savings_percentage,
    created_at
   FROM execution_costs
  WHERE tier3_cost > 0::numeric
  ORDER BY created_at DESC;`);
const VIEW = 'public.pilot_cost_savings_summary';
/**
 * User decision 2026-10-11: recreate HARDENED. Captured prod state was owner
 * postgres, no reloptions, no comment, and ALL (arwdDxtm) to anon,
 * authenticated and service_role. Now: security_invoker on, anon has nothing,
 * authenticated and service_role SELECT only, owner postgres, no comment.
 */
const VIEW_CREATE_HEAD = `CREATE VIEW ${VIEW} WITH (security_invoker = true) AS`;
const VIEW_OWNER = `ALTER VIEW ${VIEW} OWNER TO postgres;`;
const VIEW_GRANT = `GRANT SELECT ON ${VIEW} TO authenticated, service_role;`;
const VIEW_COLUMNS = ['execution_id', 'agent_id', 'total_tokens', 'actual_cost', 'tier3_cost', 'cost_saved', 'savings_percentage', 'created_at'];

/** The twelve rows the user approved in writing on 2026-10-10 (P-1). */
const APPROVED_RETIRE: Array<[string, string, string]> = [
  ['909b8936-1c6b-4bc5-887e-7b387f615b4c', 'anthropic', 'claude-3-5-sonnet-20241022'],
  ['48e013db-0320-4b54-bd45-261a1f181328', 'anthropic', 'claude-3-5-sonnet-20241022'],
  ['1253bb1d-8f50-4d09-9526-858fa77c395e', 'anthropic', 'claude-3-5-sonnet-20241022'],
  ['f4d788e3-d028-470d-88e0-bb4b8fc968fb', 'anthropic', 'claude-3-haiku-20240307'],
  ['9326b11a-601d-4c5c-a553-409604f98e8a', 'anthropic', 'claude-3-haiku-20240307'],
  ['2c06eb3a-4bab-435c-b838-ac3f30897ef7', 'anthropic', 'claude-3-haiku-20240307'],
  ['296b4e13-3129-4a69-982c-db42ce345c3d', 'openai', 'gpt-4o-mini'],
  ['e4553790-6bcf-4322-977e-e701e9333a17', 'openai', 'gpt-4o-mini'],
  ['f56e9b2e-4896-48c2-94de-1b1a44cec53d', 'openai', 'gpt-4o-mini'],
  ['9e223fff-fc18-4c2c-b335-72ed7609baa7', 'anthropic', 'claude-3-haiku'],
  ['ad3717eb-9024-419e-857c-d2fa3e182588', 'anthropic', 'claude-3-opus'],
  ['1a69f840-d5df-4185-b85c-c11fe05bbc6a', 'anthropic', 'claude-3-sonnet'],
];
/** The rows the charging code picks today; never in the retire list. */
const KEPT_ROW_IDS = [
  '7c1c0f51-75a2-4baa-a335-e144874058cb',
  'e412a440-54a1-4a64-970c-ffb87d4cc0bd',
  '6d0bbad2-d0d6-4136-be7b-f59284de4872',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

const PLAIN_LITERAL = /^[A-Za-z0-9_ ]*$/;
/** A schema-qualified name for to_regclass, as in the workplan's guard (no other punctuation). */
const QUALIFIED_NAME_LITERAL = /^public\.[a-z0-9_]+$/;
const UUID_LITERAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Model names (hyphen and digits only beyond letters); never two hyphens in a row. */
const MODEL_LITERAL = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** True if the text declares a numeric with a typmod, e.g. numeric(10,8). */
const hasNumericTypmod = (sql: string) => /\bnumeric\s*\(/i.test(sql);

/** Index of a needle in text; fails loudly when absent so order checks cannot pass by -1. */
function at(text: string, needle: string): number {
  const index = text.indexOf(needle);
  if (index < 0) throw new Error(`not found: ${needle}`);
  return index;
}

const PASTED_FILES: Array<[string, string]> = [
  ['baseline', BASELINE],
  ['schema migration', MIGRATION],
  ['schema rollback', ROLLBACK],
  ['checker', CHECKER],
  ['retire script', RETIRE],
  ['retire rollback', RETIRE_ROLLBACK],
];

// ---------------------------------------------------------------------------
describe('paste safety (the user pastes every file by hand on production)', () => {
  it.each(PASTED_FILES)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(PASTED_FILES)('%s has no line comment, no block comment and no backslash', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
    expect(text).not.toContain('\\');
  });

  // The Supabase SQL editor misreads the word "into" even inside a literal or an identifier.
  it.each(PASTED_FILES)('%s never contains "into" anywhere', (_name, file) => {
    expect(read(file)).not.toMatch(/into/i);
  });

  it.each(PASTED_FILES)('%s is ASCII only', (_name, file) => {
    expect(/^[\x00-\x7F]*$/.test(read(file))).toBe(true);
  });

  it.each(PASTED_FILES)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\bAS [a-z]\b/i);
    expect(read(file)).not.toMatch(/\b(FROM|JOIN) [a-z_.]+ [a-z]\b(?! *\()/);
  });

  it('every literal is letters, digits, underscores and spaces, with named exceptions only', () => {
    const allowed: Record<string, (literal: string) => boolean> = {
      // The captured table comment, verbatim (O-1).
      baseline: (literal) => literal === CAPTURED_TABLE_COMMENT,
      // The view keeps its captured literal byte for byte.
      'schema migration': (literal) => literal === 'gpt-4o',
      'schema rollback': (literal) => literal === 'gpt-4o',
      // Model names in the fingerprint's alias exclusion list.
      checker: (literal) => MODEL_LITERAL.test(literal),
      'retire script': (literal) => UUID_LITERAL.test(literal) || MODEL_LITERAL.test(literal),
      'retire rollback': (literal) => UUID_LITERAL.test(literal) || MODEL_LITERAL.test(literal),
    };
    for (const [name, file] of PASTED_FILES) {
      for (const literal of literalsOf(read(file))) {
        if (!PLAIN_LITERAL.test(literal) && !QUALIFIED_NAME_LITERAL.test(literal)) expect({ name, literal, ok: allowed[name](literal) }).toEqual({ name, literal, ok: true });
      }
    }
  });

  it.each([
    ['baseline', baseline],
    ['schema migration', migration],
    ['schema rollback', rollback],
    ['retire script', retire],
    ['retire rollback', retireRollback],
  ])('%s is one BEGIN ... COMMIT with lock_timeout set first', (_name, text) => {
    expect(text.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(text.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(text.startsWith("BEGIN;\nSET LOCAL lock_timeout = '5s';\n")).toBe(true);
  });

  it('the checker is read-only from its first statement and writes nothing', () => {
    expect(checker.startsWith('SET default_transaction_read_only = on;\n')).toBe(true);
    expect(checker).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|ALTER|DROP|CREATE)\b(?!')/);
  });

  it('negative control: the typmod detector flags numeric(10,8)', () => {
    expect(hasNumericTypmod('ALTER COLUMN input_cost_per_token TYPE numeric(10,8)')).toBe(true);
    expect(hasNumericTypmod('ALTER COLUMN input_cost_per_token TYPE numeric;')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('baseline 20261052: a guarded no-op holding the captured definition (O-1)', () => {
  it('has exactly one DO block, guarded by to_regclass IS NULL', () => {
    expect(baseline.match(/\bDO \$baseline\$/g)).toHaveLength(1);
    expect(baseline.match(/\$baseline\$/g)).toHaveLength(2);
    expect(baselineFlat).toContain("DO $baseline$ BEGIN IF to_regclass('public.ai_model_pricing') IS NULL THEN");
    expect(baselineFlat).toContain('END IF; END $baseline$;');
  });

  it('has no statement outside the guard', () => {
    const outside = baseline.replace(/DO \$baseline\$[\s\S]*\$baseline\$;/, '');
    expect(flatOf(outside)).toBe("BEGIN; SET LOCAL lock_timeout = '5s'; COMMIT;");
  });

  it('creates the captured columns, in position order, with their captured types and defaults', () => {
    const columnsList = CAPTURED_COLUMNS.join(', ');
    expect(baselineFlat).toContain(`CREATE TABLE public.ai_model_pricing ( ${columnsList}, `);
  });

  it('names the captured primary key and unique constraint', () => {
    expect(baselineFlat).toContain(`CONSTRAINT ${CAPTURED_PK_NAME} PRIMARY KEY (id)`);
    expect(baselineFlat).toContain(`CONSTRAINT ${CAPTURED_UNIQUE_NAME} UNIQUE (provider, model_name, effective_date)`);
  });

  it('holds the captured table comment, RLS, both policies and the captured grants (MAINTAIN is left to the platform default)', () => {
    expect(baselineFlat).toContain(`COMMENT ON TABLE public.ai_model_pricing IS '${CAPTURED_TABLE_COMMENT}';`);
    expect(baselineFlat).toContain('ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;');
    for (const policy of CAPTURED_POLICIES) expect(baselineFlat).toContain(`${policy};`);
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(baselineFlat).toContain(`REVOKE ALL ON TABLE public.ai_model_pricing FROM ${role};`);
    }
    for (const grant of CAPTURED_GRANTS) expect(baselineFlat).toContain(`${grant};`);
    expect(baseline.match(/\bGRANT\b/g)).toHaveLength(CAPTURED_GRANTS.length);
    expect(baseline).not.toMatch(/MAINTAIN|WITH GRANT OPTION/);
    for (const grant of CAPTURED_GRANTS) {
      expect(at(baselineFlat, `${grant};`)).toBeGreaterThan(at(baselineFlat, 'REVOKE ALL ON TABLE public.ai_model_pricing FROM service_role;'));
    }
  });

  it('creates no index beyond the two constraint indexes, and no function', () => {
    expect(baseline).not.toMatch(/CREATE (UNIQUE )?INDEX|CREATE (OR REPLACE )?FUNCTION/);
  });
});

// ---------------------------------------------------------------------------
describe('schema migration 20261053', () => {
  describe('precision: both cost columns become unconstrained numeric', () => {
    it('relaxes both cost columns to numeric with no typmod', () => {
      expect(migrationFlat).toContain(
        'ALTER TABLE public.ai_model_pricing ALTER COLUMN input_cost_per_token TYPE numeric, ALTER COLUMN output_cost_per_token TYPE numeric;'
      );
    });

    it('declares no numeric with a typmod anywhere (cached input and image cost included)', () => {
      expect(hasNumericTypmod(migration)).toBe(false);
      expect(migrationFlat).toContain('ADD COLUMN cached_input_cost_per_token numeric;');
      expect(migrationFlat).toContain('cost_per_image numeric NOT NULL,');
    });

    it('refuses unless the cost columns are the captured numeric(10,8)', () => {
      expect(migrationFlat).toContain('AND cost_column.numeric_precision = 10 AND cost_column.numeric_scale = 8) <> 2 THEN');
    });
  });

  describe('the dependent view pilot_cost_savings_summary (deviation for SA ruling)', () => {
    it('guards first: view present and plain, nothing depends on it, captured columns', () => {
      const guard = at(migrationFlat, 'DO $view_guard$');
      expect(guard).toBeLessThan(at(migrationFlat, `DROP VIEW ${VIEW};`));
      expect(migrationFlat).toContain("v_view := to_regclass('public.pilot_cost_savings_summary');");
      expect(migrationFlat).toContain("WHERE pg_class.oid = v_view) <> 'v' THEN");
      expect(migrationFlat).toContain("AND dependency.refobjid = v_view AND dependency.deptype = 'n'");
      expect(migrationFlat).toContain(`ARRAY[${VIEW_COLUMNS.map((column) => `'${column}'`).join(', ')}]`);
      expect(migrationFlat).toContain(
        "AND NOT (dependency.classid = 'pg_rewrite'::regclass AND dependency.objid IN (SELECT pg_rewrite.oid FROM pg_rewrite WHERE pg_rewrite.ev_class = v_view))"
      );
    });

    // CR-1: DROP VIEW without CASCADE still drops auto-dependents silently.
    it.each([
      ['migration', () => migrationFlat],
      ['rollback', () => rollbackFlat],
    ])('the %s guard refuses on a trigger on the view or a rewrite rule beyond its own (CR-1)', (_name, flatText) => {
      expect(flatText()).toContain('IF EXISTS (SELECT 1 FROM pg_trigger WHERE pg_trigger.tgrelid = v_view) THEN RAISE EXCEPTION');
      expect(flatText()).toContain('IF (SELECT count(*) FROM pg_rewrite WHERE pg_rewrite.ev_class = v_view) <> 1 THEN RAISE EXCEPTION');
    });

    it('the migration guard refuses when the view or a view column has a comment (CR-1, migration only)', () => {
      expect(migrationFlat).toContain('IF EXISTS (SELECT 1 FROM pg_description WHERE pg_description.objoid = v_view) THEN RAISE EXCEPTION');
      expect(rollbackFlat).not.toContain('pg_description');
    });

    it('drops the view, then alters the type, then recreates the view, in that order', () => {
      const drop = at(migrationFlat, `DROP VIEW ${VIEW};`);
      const alter = at(migrationFlat, 'ALTER COLUMN input_cost_per_token TYPE numeric,');
      const create = at(migrationFlat, `CREATE VIEW ${VIEW} `);
      expect(drop).toBeLessThan(alter);
      expect(alter).toBeLessThan(create);
      expect(migration.match(/DROP VIEW/g)).toHaveLength(1);
      expect(migration.match(/CREATE VIEW/g)).toHaveLength(1);
    });

    it('never cascades and never drops the view conditionally', () => {
      expect(migration).not.toMatch(/CASCADE|DROP (VIEW|INDEX|TABLE|CONSTRAINT|COLUMN) IF EXISTS/);
    });

    it('recreates the view from the captured definition, schema-qualified', () => {
      expect(migrationFlat).toContain(`${VIEW_CREATE_HEAD} ${CAPTURED_VIEW_BODY_QUALIFIED}`);
    });

    it('hardened (user decision 2026-10-11): owner postgres, revoke all from every role, then SELECT only to authenticated and service_role, no comment', () => {
      const create = at(migrationFlat, VIEW_CREATE_HEAD);
      const owner = at(migrationFlat, VIEW_OWNER);
      const grant = at(migrationFlat, VIEW_GRANT);
      expect(create).toBeLessThan(owner);
      for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
        const revoke = at(migrationFlat, `REVOKE ALL ON TABLE ${VIEW} FROM ${role};`);
        expect(revoke).toBeGreaterThan(owner);
        expect(revoke).toBeLessThan(grant);
      }
      expect(migration).not.toMatch(/COMMENT ON VIEW/);
    });
  });

  describe('uniqueness: partial index on active rows replaces the constraint (finding 8)', () => {
    it('creates the partial unique index before dropping the captured constraint, with no IF EXISTS', () => {
      const index = at(
        migrationFlat,
        'CREATE UNIQUE INDEX ai_model_pricing_active_model_date_key ON public.ai_model_pricing (provider, model_name, effective_date) WHERE retired_date IS NULL;'
      );
      const drop = at(migrationFlat, `ALTER TABLE public.ai_model_pricing DROP CONSTRAINT ${CAPTURED_UNIQUE_NAME};`);
      expect(index).toBeLessThan(drop);
    });
  });

  describe('new nullable columns and CHECKs (O-4)', () => {
    it('adds three nullable columns with no default and the two CHECKs', () => {
      expect(migrationFlat).toContain('ADD COLUMN proposal_id uuid;');
      expect(migrationFlat).toContain('ADD COLUMN proposal_line_id uuid;');
      expect(migrationFlat).toContain(
        "ADD CONSTRAINT ai_model_pricing_cached_input_valid CHECK (cached_input_cost_per_token IS NULL OR (cached_input_cost_per_token >= 0 AND cached_input_cost_per_token <> 'NaN' AND cached_input_cost_per_token <> 'Infinity'));"
      );
      expect(migrationFlat).toContain(
        'ADD CONSTRAINT ai_model_pricing_provenance_paired CHECK ((proposal_id IS NULL) = (proposal_line_id IS NULL));'
      );
      expect(migration).not.toMatch(/ADD COLUMN [a-z_]+ [a-z]+ (NOT NULL|DEFAULT)/);
      expect(migration).not.toMatch(/FOREIGN KEY|REFERENCES public/);
    });
  });

  it('token table security unchanged: no GRANT, REVOKE, POLICY or DML naming public.ai_model_pricing (SA-4b)', () => {
    const lines = migration.split('\n').filter((line) => /\bpublic\.ai_model_pricing\b(?!_)/.test(line));
    for (const line of lines) {
      expect(line).not.toMatch(/\b(GRANT|REVOKE|POLICY|INSERT|UPDATE|DELETE|TRUNCATE)\b/);
    }
    expect(lines.length).toBeGreaterThan(0);
  });

  describe('image table (R-2 pattern, O-2, O-5)', () => {
    it('declares the columns in order', () => {
      expect(migrationFlat).toContain(
        'CREATE TABLE public.ai_model_image_pricing ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, model_name text NOT NULL, size text NOT NULL, quality text NOT NULL, cost_per_image numeric NOT NULL, effective_date date NOT NULL, retired_date date, created_at timestamptz NOT NULL DEFAULT now(), proposal_id uuid, proposal_line_id uuid );'
      );
    });

    it('refuses a non-positive, NaN or infinite image price (CR-2)', () => {
      expect(migrationFlat).toContain(
        "ADD CONSTRAINT ai_model_image_pricing_cost_positive CHECK (cost_per_image > 0 AND cost_per_image <> 'NaN' AND cost_per_image <> 'Infinity');"
      );
    });

    it('has RLS on and exactly one admin SELECT policy', () => {
      expect(migrationFlat).toContain('ALTER TABLE public.ai_model_image_pricing ENABLE ROW LEVEL SECURITY;');
      expect(migrationFlat).toContain(
        'CREATE POLICY ai_model_image_pricing_admin_select ON public.ai_model_image_pricing FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));'
      );
      expect(migration.match(/CREATE POLICY/g)).toHaveLength(1);
    });

    it('revokes all from each role on its own line, then grants exactly two, after every revoke', () => {
      const revokes = ['PUBLIC', 'anon', 'authenticated', 'service_role'].map((role) =>
        at(migrationFlat, `REVOKE ALL ON TABLE public.ai_model_image_pricing FROM ${role};`)
      );
      const grants = [
        at(migrationFlat, 'GRANT SELECT ON TABLE public.ai_model_image_pricing TO authenticated;'),
        at(migrationFlat, 'GRANT SELECT, INSERT, UPDATE (retired_date) ON TABLE public.ai_model_image_pricing TO service_role;'),
      ];
      expect(migration.split('\n').filter((line) => /\bGRANT\b.*ai_model_image_pricing/.test(line))).toHaveLength(2);
      expect(migration.match(/\bGRANT\b/g)).toHaveLength(3);
      for (const grant of grants) for (const revoke of revokes) expect(grant).toBeGreaterThan(revoke);
    });

    it('grants no DELETE, TRUNCATE, REFERENCES or TRIGGER, nothing to anon or PUBLIC, and creates no function', () => {
      const grantLines = migration.split('\n').filter((line) => /\bGRANT\b/.test(line));
      for (const line of grantLines) {
        expect(line).not.toMatch(/DELETE|TRUNCATE|REFERENCES|TRIGGER|\bALL\b|TO anon|TO PUBLIC/);
      }
      expect(migration).not.toMatch(/CREATE (OR REPLACE )?FUNCTION/);
    });
  });
});

// ---------------------------------------------------------------------------
describe('schema rollback', () => {
  it('refuses rather than loses data', () => {
    expect(rollbackFlat).toContain('IF EXISTS (SELECT 1 FROM public.ai_model_image_pricing) THEN');
    expect(rollbackFlat).toContain('pricing.cached_input_cost_per_token IS NOT NULL OR pricing.proposal_id IS NOT NULL');
    expect(rollbackFlat).toContain('pricing.input_cost_per_token <> round(pricing.input_cost_per_token, 8)');
    expect(rollbackFlat).toContain('pricing.output_cost_per_token <> round(pricing.output_cost_per_token, 8)');
    expect(rollbackFlat).toContain('GROUP BY pricing.provider, pricing.model_name, pricing.effective_date HAVING count(*) > 1');
    // abs() also covers a large negative value and -Infinity.
    expect(rollbackFlat).toContain('OR abs(pricing.input_cost_per_token) >= 100 OR abs(pricing.output_cost_per_token) >= 100) THEN');
  });

  it('restores the captured unique constraint before dropping the partial index', () => {
    const add = at(rollbackFlat, `ADD CONSTRAINT ${CAPTURED_UNIQUE_NAME} UNIQUE (provider, model_name, effective_date);`);
    const drop = at(rollbackFlat, 'DROP INDEX public.ai_model_pricing_active_model_date_key;');
    expect(add).toBeLessThan(drop);
  });

  it('drops the view, alters back to numeric(10,8), then recreates the view identically', () => {
    const guard = at(rollbackFlat, 'DO $rollback_guard$');
    const drop = at(rollbackFlat, `DROP VIEW ${VIEW};`);
    const alter = at(rollbackFlat, 'ALTER COLUMN input_cost_per_token TYPE numeric(10,8), ALTER COLUMN output_cost_per_token TYPE numeric(10,8);');
    const create = at(rollbackFlat, `${VIEW_CREATE_HEAD} ${CAPTURED_VIEW_BODY_QUALIFIED}`);
    expect(guard).toBeLessThan(drop);
    expect(drop).toBeLessThan(alter);
    expect(alter).toBeLessThan(create);
    expect(rollback).not.toMatch(/CASCADE|DROP (VIEW|INDEX|TABLE|CONSTRAINT|COLUMN) IF EXISTS/);
  });

  it('removes everything the migration added', () => {
    expect(rollbackFlat).toContain('DROP TABLE public.ai_model_image_pricing;');
    for (const column of ['proposal_line_id', 'proposal_id', 'cached_input_cost_per_token']) {
      expect(rollbackFlat).toContain(`DROP COLUMN ${column};`);
    }
    for (const check of ['ai_model_pricing_provenance_paired', 'ai_model_pricing_cached_input_valid']) {
      expect(rollbackFlat).toContain(`DROP CONSTRAINT ${check};`);
    }
  });

  it('the view restore block is identical in the migration and the rollback', () => {
    const block = (flat: string) => flat.slice(at(flat, `CREATE VIEW ${VIEW}`), at(flat, VIEW_GRANT) + VIEW_GRANT.length);
    expect(block(rollbackFlat)).toBe(block(migrationFlat));
  });
});

// ---------------------------------------------------------------------------
describe('retire script (supabase/SQL Scripts, SA-2) and its rollback', () => {
  const FINGERPRINT_CORE =
    "row_number() OVER (PARTITION BY pricing.provider, pricing.model_name ORDER BY pricing.effective_date DESC, pricing.created_at DESC) AS position FROM public.ai_model_pricing AS pricing WHERE pricing.retired_date IS NULL AND pricing.effective_date <= (now() AT TIME ZONE 'utc')::date AND pricing.model_name NOT IN ('claude-3-haiku', 'claude-3-opus', 'claude-3-sonnet') ) AS ranked WHERE ranked.position = 1)";

  it('only sets retired_date and never deletes', () => {
    expect(retire).not.toMatch(/\bDELETE\b|\bINSERT\b|\bTRUNCATE\b|\bDROP\b|\bALTER\b/);
    expect(retire.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(retireFlat).toContain("UPDATE public.ai_model_pricing AS pricing SET retired_date = (now() AT TIME ZONE 'utc')::date FROM (VALUES");
    expect(retireFlat).toContain('AND pricing.retired_date IS NULL; GET DIAGNOSTICS v_retired = ROW_COUNT;');
  });

  it('lists exactly the twelve approved ids, each bound to its approved provider and model', () => {
    const uuids = retire.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
    expect(uuids.sort()).toEqual(APPROVED_RETIRE.map(([id]) => id).sort());
    for (const [id, provider, model] of APPROVED_RETIRE) {
      expect(retireFlat).toContain(`('${id}'::uuid, '${provider}', '${model}')`);
    }
    for (const kept of KEPT_ROW_IDS) expect(retire).not.toContain(kept);
  });

  it('checks the row count and the in-transaction price fingerprint, before and after', () => {
    expect(retireFlat).toContain('IF v_retired <> 12 THEN RAISE EXCEPTION');
    expect(retireFlat).toContain('IF v_before IS NULL OR v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION');
    const before = at(retireFlat, 'v_before := (SELECT md5(');
    const update = at(retireFlat, 'UPDATE public.ai_model_pricing');
    const after = at(retireFlat, 'v_after := (SELECT md5(');
    expect(before).toBeLessThan(update);
    expect(update).toBeLessThan(after);
    expect(retireFlat.split(FINGERPRINT_CORE).length - 1).toBe(3);
  });

  it('the fingerprint expression is identical in the retire script, the retire rollback and checker V-4 (no drift)', () => {
    const start = '(SELECT md5(string_agg(';
    const expressionOf = (flat: string) => flat.slice(at(flat, start), at(flat, FINGERPRINT_CORE) + FINGERPRINT_CORE.length);
    const reference = expressionOf(retireFlat);
    expect(reference.startsWith(start)).toBe(true);
    const checkerFlat = flatOf(checker);
    expect(expressionOf(retireRollbackFlat)).toBe(reference);
    expect(expressionOf(checkerFlat)).toBe(reference);
    expect(checkerFlat).toContain(`'V4 price fingerprint compare with the value the retire script printed', 'INFO', ${reference}`);
    for (const flat of [retireFlat, retireRollbackFlat]) {
      expect(flat.split(reference).length - 1).toBe(3);
    }
  });

  it('keeps exactly one active row for each duplicated model, counted per model', () => {
    expect(retireFlat).toContain(
      "AND pricing.model_name IN ('claude-3-5-sonnet-20241022', 'claude-3-haiku-20240307', 'gpt-4o-mini') GROUP BY pricing.model_name HAVING count(*) = 1 ) AS kept_model) <> 3 THEN"
    );
  });

  it('the rollback restores only those twelve, all retired by one run, with the same fingerprint check', () => {
    expect(retireRollback).not.toMatch(/\bDELETE\b|\bINSERT\b|\bTRUNCATE\b|\bDROP\b|\bALTER\b/);
    expect(retireRollbackFlat).toContain('SET retired_date = NULL FROM (VALUES');
    for (const [id, provider, model] of APPROVED_RETIRE) {
      expect(retireRollbackFlat).toContain(`('${id}'::uuid, '${provider}', '${model}')`);
    }
    expect(retireRollbackFlat).toContain('count(DISTINCT pricing.retired_date)');
    expect(retireRollbackFlat).toContain('IF v_restored <> 12 THEN RAISE EXCEPTION');
    expect(retireRollbackFlat).toContain('IF v_before IS NULL OR v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION');
  });
});

// ---------------------------------------------------------------------------
describe('checker covers what the migration does', () => {
  it('names the same index, constraint, columns, image table and view', () => {
    for (const name of [
      'ai_model_pricing_active_model_date_key',
      CAPTURED_UNIQUE_NAME,
      'cached_input_cost_per_token',
      'proposal_id',
      'proposal_line_id',
      'ai_model_pricing_cached_input_valid',
      'ai_model_pricing_provenance_paired',
      'ai_model_image_pricing_admin_select',
      'public.pilot_cost_savings_summary',
      'public.ai_model_image_pricing',
    ]) {
      expect(checker).toContain(name);
    }
  });

  it('reports a VERDICT first and prints the price fingerprint for comparison', () => {
    expect(checker).toContain("'VERDICT' AS check_name");
    expect(checker).toContain("'V4 price fingerprint compare with the value the retire script printed', 'INFO'");
    expect(checker).toContain("pg_attribute.atttypid = 'numeric'::regtype AND pg_attribute.atttypmod = -1");
  });
});

// ---------------------------------------------------------------------------
// T-2b, filled 2026-10-11: the view is recreated hardened (user decision).
describe('the recreated view is hardened (user decision 2026-10-11)', () => {
  const PASTED_WITH_VIEW: Array<[string, string]> = [
    ['schema migration', migration],
    ['schema rollback', rollback],
  ];

  it.each(PASTED_WITH_VIEW)('%s holds no placeholder left from the capture', (_name, text) => {
    expect(text.match(/CAPTURED_[A-Z_]+/g) ?? []).toEqual([]);
  });

  it.each(PASTED_WITH_VIEW)('%s recreates with security_invoker, owner postgres, SELECT to authenticated and service_role only', (_name, text) => {
    const flat = flatOf(text);
    expect(flat).toContain(VIEW_CREATE_HEAD);
    expect(flat).toContain(VIEW_OWNER);
    expect(flat).toContain(VIEW_GRANT);
    const viewGrants = text.split('\n').filter((line) => /\bGRANT\b/.test(line) && line.includes(VIEW));
    expect(viewGrants).toEqual([VIEW_GRANT]);
  });

  it.each(PASTED_WITH_VIEW)('%s never grants anything on the view to anon or PUBLIC', (_name, text) => {
    for (const line of text.split('\n').filter((candidate) => /\bGRANT\b/.test(candidate) && candidate.includes(VIEW))) {
      expect(line).not.toMatch(/\banon\b|\bPUBLIC\b|\bALL\b|INSERT|UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN/);
    }
    expect(flatOf(text)).toContain(`REVOKE ALL ON TABLE ${VIEW} FROM anon;`);
  });

  it('the rollback says it does not restore anon access', () => {
    expect(rollback).toContain("RAISE NOTICE 'the view is recreated hardened  security invoker on  anon access is not restored';");
  });

  it('the checker verifies owner postgres, security_invoker on, and the privileges per role', () => {
    expect(checker).not.toMatch(/CAPTURED_[A-Z_]+/);
    expect(checker).toContain("'V5 view owner postgres'");
    expect(checker).toContain("= 'postgres'");
    expect(checker).toContain("view_option.option_name = 'security_invoker'");
    expect(flatOf(checker)).toContain("('anon', ARRAY[]::text[]), ('authenticated', ARRAY['SELECT']), ('service_role', ARRAY['SELECT'])");
    expect(checker).toContain("('MAINTAIN')");
  });
});

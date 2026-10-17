/**
 * Guard over AI model price review slice 8, Apply and Dismiss (workplan
 * docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE8_WORKPLAN.md §2.1-§2.3; SA RC-1..RC-16,
 * the slice 7 notes F-1 and F-5).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run Postgres and there is no branch
 * database: the user pastes these files in the Supabase SQL editor on
 * PRODUCTION by hand. What the files alone can prove is pinned here: paste
 * safety, the statement order (batch row before any line update, RC-2; the
 * lock order, RC-3 and RC-5), the cached-input rule (F-1), the grants (RC-8),
 * the rollback (RC-9) and that the checker and probe stay in step.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import { BLOCKING_FLAGS } from '@/lib/ai/pricing-research/lineFlags';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261079_ai_price_apply_and_dismiss.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261079_ai_price_apply_and_dismiss_rollback.sql');
const SLICE3_ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261066_ai_price_pending_area_rollback.sql');
const SLICE3_MIGRATION = join(ROOT, 'supabase', 'migrations', '20261066_ai_price_pending_area.sql');
const CHECKER = join(ROOT, 'scripts', 'check-ai-price-apply-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-ai-price-apply-migration.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const flatOf = (sql: string) => sql.replace(/\s+/g, ' ').trim();

const migration = read(MIGRATION);
const rollback = read(ROLLBACK);
const checker = read(CHECKER);
const probe = read(PROBE);
const migrationFlat = flatOf(migration);
const rollbackFlat = flatOf(rollback);

const APPLY_FN = 'public.ai_price_apply_lines(uuid, jsonb, jsonb)';
const DISMISS_FN = 'public.ai_price_dismiss_lines(uuid, uuid[], text)';
const REVIEW_FN = 'public.ai_price_apply_batch_review_done(uuid, uuid, text)';
const BATCH_TRIGGER_FN = 'public.ai_price_apply_batch_transition()';
const BATCHES = 'public.ai_price_apply_batches';
const LINES = 'public.ai_price_proposal_lines';
const PRICING = 'public.ai_model_pricing';

/** The advisory key expression of the submit function, byte for byte (RC-5). */
const LOCK_KEY_EXPRESSION =
  "'ai_price_proposal_lines' || chr(124) || concat_ws(chr(124), provider, model_name, kind, coalesce(image_size, ''), coalesce(image_quality, ''))";

/** Statements of a file, split on semicolons outside dollar-quoted bodies and single-quoted literals. */
function statementsOf(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let dollarTag: string | null = null;
  let inLiteral = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (!inLiteral) {
      const tag = /^[$][a-z_]*[$]/.exec(sql.slice(index, index + 40));
      if (tag) {
        if (dollarTag === null) dollarTag = tag[0];
        else if (dollarTag === tag[0]) dollarTag = null;
        current += tag[0];
        index += tag[0].length - 1;
        continue;
      }
    }
    if (character === "'" && dollarTag === null) inLiteral = !inLiteral;
    if (character === ';' && dollarTag === null && !inLiteral) {
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
const QUALIFIED_NAME_LITERAL = /^public[.][a-z0-9_]+$/;
const DECIMAL_LITERAL = /^[0-9]+[.][0-9]+$/;

const PASTED_FILES: Array<[string, string]> = [
  ['migration', MIGRATION],
  ['rollback', ROLLBACK],
  ['checker', CHECKER],
  ['probe', PROBE],
];

/** The comment text the rollback restores (20261052, as captured): the one rollback literal with punctuation. */
const CAPTURED_PRICING_COMMENT =
  'Per-token model pricing; every credit charge is computed from it. Written only by the service role through /api/admin/system-config/pricing (admin-gated). RLS: admin_users-backed read + write for authenticated sessions; anon has no privileges beyond SELECT, which RLS then denies.';

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

  it('the migration says "into" only as its three INSERT INTO statements', () => {
    expect(migration.match(/into/gi)).toHaveLength(3);
    expect(migration.match(/INSERT INTO public[.]ai_price_apply_batches [(]/g)).toHaveLength(1);
    expect(migration.match(/INSERT INTO public[.]ai_model_pricing [(]/g)).toHaveLength(1);
    expect(migration.match(/INSERT INTO public[.]ai_model_image_pricing [(]/g)).toHaveLength(1);
    for (const literal of literalsOf(migration)) expect(literal).not.toMatch(/into/i);
  });

  it('the probe says "into" only as INSERT INTO on the price table; rollback and checker never', () => {
    expect((probe.match(/into/gi) ?? []).length).toBe((probe.match(/INSERT INTO public[.]ai_model_pricing [(]/g) ?? []).length);
    expect(rollback).not.toMatch(/into/i);
    expect(checker).not.toMatch(/into/i);
  });

  it('every literal is letters, digits, underscores and spaces, with named exceptions only', () => {
    const allowed: Record<string, (literal: string) => boolean> = {
      migration: () => false,
      rollback: (literal) => literal === CAPTURED_PRICING_COMMENT,
      checker: (literal) =>
        [APPLY_FN, DISMISS_FN, REVIEW_FN, BATCH_TRIGGER_FN, 'search_path=""', 'lock_timeout=5s', 'public.'].includes(literal) ||
        literal === '%Written only by the function ai_price_apply_lines run by the service role%',
      probe: (literal) =>
        DECIMAL_LITERAL.test(literal) ||
        /^probe-(apply|image)-[a-g]-$/.test(literal) ||
        ['developers.openai.com', '1024x1024'].includes(literal) ||
        /^P[01][0-9] (PASS|FAIL)[a-z0-9 _]*$/i.test(literal) ||
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

  it('the checker never names the new table outside the catalogue (it must parse before the migration)', () => {
    expect(checker).not.toMatch(/FROM public[.]ai_price_/);
    expect(checker).not.toMatch(/JOIN public[.]ai_price_/);
  });
});

describe('statement order', () => {
  const statements = statementsOf(migration);
  const indexOf = (prefix: string) => statements.findIndex((statement) => statement.startsWith(prefix));

  it('the planned statement list, in order', () => {
    const order = [
      `CREATE TABLE ${BATCHES}`,
      `ALTER TABLE ${LINES} ADD COLUMN apply_batch_id uuid`,
      `ALTER TABLE ${LINES} ADD CONSTRAINT ai_price_proposal_lines_apply_batch_fkey`,
      `ALTER TABLE ${LINES} ADD CONSTRAINT ai_price_proposal_lines_applied_batch_shape`,
      'CREATE INDEX ai_price_proposal_lines_apply_batch_idx',
      `COMMENT ON TABLE ${BATCHES}`,
      `CREATE FUNCTION ${BATCH_TRIGGER_FN.replace('()', '')}`,
      'CREATE TRIGGER ai_price_apply_batches_transition',
      'CREATE FUNCTION public.ai_price_apply_lines',
      'CREATE FUNCTION public.ai_price_dismiss_lines',
      'CREATE FUNCTION public.ai_price_apply_batch_review_done',
      `ALTER TABLE ${BATCHES} ENABLE ROW LEVEL SECURITY`,
      'CREATE POLICY ai_price_apply_batches_admin_select',
      `DROP POLICY ai_model_pricing_admin_write ON ${PRICING}`,
      `COMMENT ON TABLE ${PRICING}`,
      'COMMENT ON TABLE public.ai_model_image_pricing',
      'COMMIT',
    ].map(indexOf);
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('the batch link is partial-indexed and tied to the applied state (RC-13, O-5)', () => {
    expect(migrationFlat).toContain('CHECK ((state = \'applied\') = (apply_batch_id IS NOT NULL))');
    expect(migrationFlat).toContain(`ON ${LINES} (apply_batch_id) WHERE apply_batch_id IS NOT NULL`);
    expect(migrationFlat).toContain(`FOREIGN KEY (apply_batch_id) REFERENCES ${BATCHES} (id)`);
  });

  it('the batch table has no user_id column and no foreign key to auth.users (RC-13)', () => {
    const table = statements.find((statement) => statement.startsWith(`CREATE TABLE ${BATCHES}`)) ?? '';
    expect(table).not.toMatch(/(?<![A-Za-z0-9_])user_id(?![A-Za-z0-9_])/);
    expect(migration).not.toMatch(/REFERENCES auth[.]/);
  });
});

describe('security (RC-8, the credit-lots precedent)', () => {
  const statements = statementsOf(migration);

  it('batches: RLS on, one admin SELECT policy, REVOKE ALL per role', () => {
    expect(statements).toContain(`ALTER TABLE ${BATCHES} ENABLE ROW LEVEL SECURITY`);
    const policies = statements.filter((statement) => statement.startsWith('CREATE POLICY') && statement.includes(` ON ${BATCHES} `));
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(/FOR SELECT TO authenticated USING [(][(]SELECT public[.]is_platform_admin[(][)][)][)]$/);
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(statements).toContain(`REVOKE ALL ON TABLE ${BATCHES} FROM ${role}`);
      expect(statements).toContain(`REVOKE ALL ON TABLE ${PRICING} FROM ${role}`);
    }
  });

  it('grants exactly the planned privileges, each after its REVOKEs', () => {
    const grants = statements.filter((statement) => statement.startsWith('GRANT') && statement.includes(' ON TABLE '));
    expect(grants).toEqual([
      `GRANT SELECT ON TABLE ${BATCHES} TO authenticated`,
      `GRANT SELECT, INSERT, UPDATE (margin_review_done, margin_review_by, margin_review_at, margin_review_note) ON TABLE ${BATCHES} TO service_role`,
      `GRANT UPDATE (decision_reason, override_reason, apply_batch_id) ON TABLE ${LINES} TO service_role`,
      `GRANT SELECT ON TABLE ${PRICING} TO authenticated`,
      `GRANT SELECT, INSERT, UPDATE (retired_date) ON TABLE ${PRICING} TO service_role`,
    ]);
    const lastPricingRevoke = statements.lastIndexOf(`REVOKE ALL ON TABLE ${PRICING} FROM service_role`);
    expect(statements.indexOf(`GRANT SELECT ON TABLE ${PRICING} TO authenticated`)).toBeGreaterThan(lastPricingRevoke);
    expect(migration).not.toMatch(/GRANT[^;]*(?<![A-Za-z0-9_])(DELETE|TRUNCATE|REFERENCES|TRIGGER|MAINTAIN)(?![A-Za-z0-9_])/);
    expect(migration).not.toMatch(/GRANT[^;]*TO (anon|PUBLIC)/);
  });

  it('the inert write policy is dropped and the comment names the one writer; 20261052 is not edited', () => {
    expect(statements).toContain(`DROP POLICY ai_model_pricing_admin_write ON ${PRICING}`);
    const comment = statements.find((statement) => statement.startsWith(`COMMENT ON TABLE ${PRICING}`)) ?? '';
    expect(comment).toContain('Written only by the function ai_price_apply_lines run by the service role');
    expect(comment).toContain('Authenticated platform admins may read it and nobody else may');
    expect(read(join(ROOT, 'supabase', 'migrations', '20261052_ai_model_pricing_baseline.sql'))).toContain(CAPTURED_PRICING_COMMENT);
  });

  it('all four functions are SECURITY INVOKER with an empty search path; apply and dismiss carry lock_timeout (RC-3)', () => {
    expect(migration).not.toMatch(/SECURITY DEFINER/);
    expect(migration.match(/SECURITY INVOKER\nSET search_path = ''/g)).toHaveLength(4);
    expect(migration.match(/SET search_path = ''\nSET lock_timeout = '5s'\nAS [$](apply_lines|dismiss_lines)[$]/g)).toHaveLength(2);
  });

  it.each([APPLY_FN, DISMISS_FN, REVIEW_FN])('%s is executable by service_role only, revoked after it is created', (fn) => {
    const name = fn.slice(0, fn.indexOf('('));
    const create = statements.findIndex((s) => s.startsWith(`CREATE FUNCTION ${name}`));
    for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
      expect(statements.indexOf(`REVOKE ALL ON FUNCTION ${fn} FROM ${role}`)).toBeGreaterThan(create);
    }
    expect(statements.indexOf(`GRANT EXECUTE ON FUNCTION ${fn} TO service_role`)).toBeGreaterThan(statements.indexOf(`REVOKE ALL ON FUNCTION ${fn} FROM service_role`));
  });

  it('only the three functions get EXECUTE; the trigger function is revoked only', () => {
    expect(statements.filter((s) => s.startsWith('GRANT EXECUTE'))).toEqual([
      `GRANT EXECUTE ON FUNCTION ${APPLY_FN} TO service_role`,
      `GRANT EXECUTE ON FUNCTION ${DISMISS_FN} TO service_role`,
      `GRANT EXECUTE ON FUNCTION ${REVIEW_FN} TO service_role`,
    ]);
    for (const role of ['PUBLIC', 'anon', 'authenticated']) {
      expect(statements).toContain(`REVOKE ALL ON FUNCTION ${BATCH_TRIGGER_FN} FROM ${role}`);
    }
  });
});

describe('the apply function (RC-2, RC-3, RC-5, F-1)', () => {
  const body = flatOf(bodyOf(migration, 'apply_lines'));
  const at = (needle: string) => {
    const position = body.indexOf(needle);
    expect({ needle, found: position >= 0 }).toEqual({ needle, found: true });
    return position;
  };

  it('repeats the admin check and RAISES 42501 on it, in all three functions (X12)', () => {
    for (const [tag, name] of [['apply_lines', 'ai_price_apply_lines'], ['dismiss_lines', 'ai_price_dismiss_lines'], ['review_done', 'ai_price_apply_batch_review_done']]) {
      expect(flatOf(bodyOf(migration, tag))).toContain(
        `IF NOT EXISTS ( SELECT 1 FROM public.admin_users AS admin_row WHERE admin_row.user_id = p_admin_user_id AND admin_row.is_active ) THEN RAISE EXCEPTION '${name} is for active platform admins only' USING ERRCODE = '42501'; END IF;`
      );
    }
  });

  it('caps the lines at exactly 50 in apply, dismiss and the batch CHECK; 500 would fail (O-17, M08)', () => {
    expect(body).toMatch(/jsonb_array_length[(]p_lines[)] NOT BETWEEN 1 AND 50 THEN/);
    expect(flatOf(bodyOf(migration, 'dismiss_lines'))).toMatch(/cardinality[(]p_line_ids[)] NOT BETWEEN 1 AND 50 OR /);
    expect(migrationFlat).toMatch(/CHECK [(]line_count BETWEEN 1 AND 50[)];/);
    for (const cap of migration.match(/BETWEEN 1 AND [0-9]+/g) ?? []) expect(cap).toBe('BETWEEN 1 AND 50');
  });

  it('order: advisory keys sorted in SQL, the ROW EXCLUSIVE table lock, the batch insert, then the line locks and updates', () => {
    const keys = at(`SELECT DISTINCT ${LOCK_KEY_EXPRESSION} AS lock_key`);
    const advisory = at('PERFORM pg_advisory_xact_lock(hashtextextended(v_key.lock_key, 0))');
    const tableLock = at('LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing IN ROW EXCLUSIVE MODE;');
    const batch = at('INSERT INTO public.ai_price_apply_batches');
    const lineLock = at('WHERE price_line.id = v_item.line_id FOR UPDATE');
    const lineUpdate = at('UPDATE public.ai_price_proposal_lines AS price_line SET state = \'applied\'');
    expect([keys, advisory, tableLock, batch, lineLock, lineUpdate]).toEqual([...[keys, advisory, tableLock, batch, lineLock, lineUpdate]].sort((a, b) => a - b));
    // RC-5 (X03): ascending, exactly; DESC would break deadlock freedom with submit and dismiss.
    expect(body).toContain('WHERE id = ANY (v_ids) ORDER BY 1 LOOP PERFORM pg_advisory_xact_lock(hashtextextended(v_key.lock_key, 0));');
    expect(flatOf(bodyOf(migration, 'dismiss_lines'))).toContain(
      'WHERE id = ANY (p_line_ids) ORDER BY 1 LOOP PERFORM pg_advisory_xact_lock(hashtextextended(v_key.lock_key, 0));'
    );
    expect(migration).not.toMatch(/ORDER BY 1 DESC/);
  });

  it('dismiss takes the same advisory keys in the same order before its row locks (RC-5); the expression equals the submit function', () => {
    const dismiss = flatOf(bodyOf(migration, 'dismiss_lines'));
    const keys = dismiss.indexOf(`SELECT DISTINCT ${LOCK_KEY_EXPRESSION} AS lock_key`);
    const lineLock = dismiss.indexOf('FOR UPDATE');
    expect(keys).toBeGreaterThan(-1);
    expect(lineLock).toBeGreaterThan(keys);
    const submit = flatOf(read(SLICE3_MIGRATION));
    expect(submit).toContain("pg_advisory_xact_lock(hashtextextended('ai_price_proposal_lines' || chr(124) || v_line.unit_key, 0))");
    expect(submit).toContain(
      "concat_ws(chr(124), element.line_value ->> 'provider', element.line_value ->> 'model_name', element.line_value ->> 'kind', coalesce(element.line_value ->> 'image_size', ''), coalesce(element.line_value ->> 'image_quality', '')) AS unit_key"
    );
  });

  it('locks every active row of the unit in one statement with no LIMIT, then checks in separate statements (RC-3)', () => {
    expect(body).toContain(
      'PERFORM 1 FROM public.ai_model_pricing AS live_row WHERE live_row.provider = v_line.provider AND live_row.model_name = v_line.model_name AND live_row.retired_date IS NULL FOR UPDATE;'
    );
    expect(body).toContain('AND live_image.retired_date IS NULL FOR UPDATE;');
    const lock = body.indexOf('AND live_row.retired_date IS NULL FOR UPDATE;');
    const stale = body.indexOf('v_charged_id IS DISTINCT FROM v_line.current_row_id');
    expect(stale).toBeGreaterThan(lock);
  });

  it('F-1: the expected cached rate is OpenAI only, the stored rate above 0, else half the input, compared IS NOT DISTINCT FROM', () => {
    expect(body).toContain(
      "(CASE WHEN v_line.provider = 'openai' AND live_row.cached_input_cost_per_token > 0 THEN live_row.cached_input_cost_per_token WHEN v_line.provider = 'openai' THEN live_row.input_cost_per_token / 2 ELSE NULL END) IS NOT DISTINCT FROM v_line.current_cached_input_cost_per_token"
    );
    expect(body).toContain('live_row.input_cost_per_token = v_line.current_input_cost_per_token');
    expect(body).toContain('live_row.output_cost_per_token = v_line.current_output_cost_per_token');
    // Numerics compare as numerics (RC-6): the only text casts name a refused line in DETAIL.
    expect(body.replace(/DETAIL = v_[a-z_]+[.][a-z_]+::text/g, '')).not.toContain('::text');
  });

  it('current_row_id is resolved by kind; image_setting is always stale; a later dated price refuses', () => {
    expect(body).toContain('live_image.id = v_charged_id AND live_image.cost_per_image = v_line.current_cost_per_image');
    expect(body).toContain("IF v_line.current_basis = 'image_setting' THEN");
    expect(body.match(/ERRCODE = 'P8007'/g)).toHaveLength(2);
    expect(body).toContain('live_row.effective_date > v_today');
  });

  it('the blocking list equals the code BLOCKING_FLAGS; an override needs a blocking flag', () => {
    const list = /v_blocking text\[\] := ARRAY\[([^\]]*)\]/.exec(body)?.[1] ?? '';
    expect(literalsOf(list)).toEqual([...BLOCKING_FLAGS]);
    expect(body).toContain("ERRCODE = 'P8003'");
    expect(body).toContain("ERRCODE = 'P8006'");
  });

  it('every live-table UPDATE sets retired_date only; prices come from the line; a cached 0 is written as NULL', () => {
    const updates = [...body.matchAll(/UPDATE public[.](ai_model_pricing|ai_model_image_pricing) AS [a-z_]+ SET ([^;]*?) WHERE/g)].map((match) => match[2].trim());
    expect(updates).toEqual(['retired_date = v_today', 'retired_date = v_today']);
    expect(body).toContain('CASE WHEN v_line.cached_input_cost_per_token > 0 THEN v_line.cached_input_cost_per_token ELSE NULL END');
    expect(body).toContain('v_line.input_cost_per_token, v_line.output_cost_per_token');
    // The caller's lines carry an id and words only: the function reads no other key from them.
    const keys = [...body.matchAll(/line_value ->> '([a-z_]+)'/g)].map((match) => match[1]);
    expect([...new Set(keys)].sort()).toEqual(['line_id', 'override_reason', 'reason']);
  });

  it('pre-generates ids; no RETURNING and no SELECT ... INTO', () => {
    expect(migration).not.toMatch(/RETURNING/);
    expect(body).toContain('v_batch_id := gen_random_uuid();');
    expect(body).toContain('v_new_row_id := gen_random_uuid();');
  });

  it('dismiss and the review function never name a live table', () => {
    for (const tag of ['dismiss_lines', 'review_done', 'batch_transition']) {
      expect(bodyOf(migration, tag)).not.toMatch(/ai_model_(image_)?pricing/);
    }
  });
});

describe('the batch trigger (RC-13, M10)', () => {
  it('allows only open to done, never back, and refuses any change once done', () => {
    const trigger = flatOf(bodyOf(migration, 'batch_transition'));
    expect(trigger).toContain('IF OLD.margin_review_done OR NOT NEW.margin_review_done OR NEW.applied_by IS DISTINCT FROM OLD.applied_by');
    expect(trigger).toContain("USING ERRCODE = '23514'");
    expect(migrationFlat).toContain(
      'CREATE TRIGGER ai_price_apply_batches_transition BEFORE UPDATE ON public.ai_price_apply_batches FOR EACH ROW EXECUTE FUNCTION public.ai_price_apply_batch_transition();'
    );
  });

  it('the probe tries to reopen a done review and expects the refusal', () => {
    expect(flatOf(probe)).toContain(
      'SET margin_review_done = false, margin_review_by = NULL, margin_review_at = NULL, margin_review_note = NULL WHERE batch_row.id = v_batch_needed;'
    );
  });
});

describe('rollback (RC-9) and the slice 3 rollback lock', () => {
  it('locks first, refuses only on a batch or an applied line, then drops in reverse and restores the captured state', () => {
    expect(rollback.startsWith("BEGIN;\nSET LOCAL lock_timeout = '2s';\nLOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing, public.ai_price_proposal_lines IN SHARE ROW EXCLUSIVE MODE;\n")).toBe(true);
    expect(rollbackFlat).toContain('IF EXISTS (SELECT 1 FROM public.ai_price_apply_batches AS batch_row) THEN');
    expect(rollbackFlat).toContain("WHERE price_line.state = 'applied') THEN");
    expect(rollbackFlat).not.toContain("'dismissed'");
    const order = [
      `DROP FUNCTION ${REVIEW_FN};`,
      `DROP FUNCTION ${DISMISS_FN};`,
      `DROP FUNCTION ${APPLY_FN};`,
      'ALTER TABLE public.ai_price_proposal_lines DROP COLUMN apply_batch_id;',
      `DROP TABLE ${BATCHES};`,
      `GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLE ${PRICING} TO service_role;`,
      `CREATE POLICY ai_model_pricing_admin_write ON ${PRICING}`,
    ].map((needle) => rollbackFlat.indexOf(needle));
    for (const position of order) expect(position).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(rollback).toContain(CAPTURED_PRICING_COMMENT);
    expect(rollback).not.toMatch(/CASCADE|DELETE FROM|TRUNCATE TABLE/);
  });

  it('the slice 3 rollback now takes the same lock before its guard', () => {
    const slice3 = read(SLICE3_ROLLBACK);
    expect(slice3.indexOf('IN SHARE ROW EXCLUSIVE MODE;')).toBeGreaterThan(-1);
    expect(slice3.indexOf('IN SHARE ROW EXCLUSIVE MODE;')).toBeLessThan(slice3.indexOf('DO $rollback_guard$'));
  });
});

describe('checker and probe stay in step with the migration', () => {
  it('the checker names every constraint and index the migration creates', () => {
    for (const name of [...migration.matchAll(/ADD CONSTRAINT ([a-z_]+)/g)].map((match) => match[1])) {
      expect(checker).toContain(`'${name}'`);
    }
    expect(checker).toContain("to_regclass('public.ai_price_proposal_lines_apply_batch_idx')");
  });

  it('the checker expects the narrowed grants (RC-8): pricing has SELECT for authenticated, SELECT and INSERT for service_role, MAINTAIN checked', () => {
    const flat = flatOf(checker);
    expect(flat).toContain("('anon', ARRAY[]::text[]), ('authenticated', ARRAY['SELECT']), ('service_role', ARRAY['SELECT', 'INSERT'])");
    expect(flat).toContain("('MAINTAIN')");
    expect(flat).toContain("SELECT 'ai_model_pricing', pricing_table.table_oid, ARRAY['retired_date'] FROM pricing_table");
    expect(flat).toContain("ARRAY['state', 'decided_by', 'decided_at', 'superseded_by', 'decision_reason', 'override_reason', 'apply_batch_id']");
    expect(flat).toContain("= ARRAY['ai_model_pricing_admin_select']");
  });

  it('the probe is one DO block that always ends in an error, so nothing it writes is kept', () => {
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

  it('the probe covers the RC-2 batch, the parity cases, the refusals and the privileges', () => {
    for (const label of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14']) {
      expect(probe).toContain(`'${label} PASS`);
    }
    // RC-6 parity on the SQL side: a stored 0, an odd last digit, another provider.
    expect(probe).toContain("'current_cached_input_cost_per_token', '0.0000000000000015'");
    expect(probe).toContain("'current_cached_input_cost_per_token', '0.0000000375'");
    expect(probe).toContain("'anthropic'");
  });
});

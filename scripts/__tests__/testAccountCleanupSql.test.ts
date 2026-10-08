/**
 * The test-account cleanup SQL (operator exception OX-1).
 *
 * Two pasted files remove ONE test account completely, login included. They
 * run as `postgres`, so RLS protects nothing and these files ARE the safety.
 * This suite pins them to their generator and to the purge descriptors:
 *
 *   - drift:    the committed SQL is exactly what the generator writes now, so
 *               a new descriptor or a changed band cannot be missed silently
 *   - coverage: every user-scoped descriptor is deleted, must be empty, or is
 *               handled in the final steps (SA C-3)
 *   - order:    bands, blocking edges and `via` children (SA C-12)
 *   - guards:   present in both files, checked before the first DELETE
 *   - hygiene:  the SQL editor hazards (SA C-6, C-11, the paste rules)
 *
 * Pure: reads files and imports the generator. No database, no network.
 * Workplan: docs/workplans/TEST_ACCOUNT_CLEANUP_SCRIPT_WORKPLAN.md
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ACTOR_FOREIGN_KEYS,
  AUDIT_ACTION,
  AUDIT_COMPLIANCE_FLAGS,
  AUDIT_SEVERITY,
  CHECK_FILE,
  DEFAULT_TEST_TAG,
  DELETE_FILE,
  FINAL_STEPS,
  FULL_REMOVAL_EXTRAS,
  INBOUND_FOREIGN_KEYS,
  MUST_BE_EMPTY,
  PARENT_OWNED_REASONS,
  FUNCTION_REQUIRED_TABLES,
  FUNCTION_SIGNATURE,
  INITIAL_FUNCTION_MIGRATION,
  MIGRATION_FILE,
  PREVIOUS_FUNCTION_MIGRATION,
  PREVIOUS_MIGRATION_FILE,
  PLACEHOLDER_EMAIL,
  ROLLBACK_FILE,
  SECRET_ROW_NAME,
  STEP_B_BLOCKING_EDGES,
  VERSION_FILE,
  buildCheckJson,
  buildCheckQuery,
  buildCleanupPlan,
  buildDeleteBlock,
  buildDeleteReportJson,
  buildDeleteReportQuery,
  cleanupFunctionVersion,
  previousFunctionSql,
  renderCheckSql,
  renderDeleteSql,
  renderMigrationSql,
  renderRollbackSql,
  renderVersionModule,
} from '../generate-test-account-cleanup-sql';
import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';
import {
  BLOCKING_EDGES,
  PURGE_DESCRIPTORS,
  STORAGE_DESCRIPTORS,
  descriptorsForRun,
} from '@/lib/business-os/purge/descriptors';
import { BUSINESS_OWNED_TABLES } from '@/lib/business-os/businessOwnedTables';
import { AUDIT_EVENTS, EVENT_METADATA } from '@/lib/audit/events';

const REPO = join(__dirname, '..', '..');
/** Windows checkouts may hold CRLF. The generator always writes LF (SA C-9). */
const readSql = (file: string) => readFileSync(join(REPO, ...file.split('/')), 'utf8').replace(/\r\n/g, '\n');

const checkSql = readSql(CHECK_FILE);
const deleteSql = readSql(DELETE_FILE);
const FILES: ReadonlyArray<[string, string]> = [
  [CHECK_FILE, checkSql],
  [DELETE_FILE, deleteSql],
];
const migrationSql = readSql(MIGRATION_FILE);
const rollbackSql = readSql(ROLLBACK_FILE);
const previousMigrationSql = readSql(PREVIOUS_MIGRATION_FILE);

const plan = buildCleanupPlan();
const position = (table: string) => plan.findIndex((entry) => entry.table === table);

// ── A small, correct SQL scanner: comments, string literals, dollar bodies ──

interface Token {
  kind: 'comment' | 'string';
  text: string;
}

/** Comments and string literals, recursing into `$tag$` bodies (a DO body is itself a literal). */
function scan(sql: string): { tokens: Token[]; unterminated: boolean } {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    if (sql.startsWith('--', i)) {
      const end = sql.indexOf('\n', i);
      tokens.push({ kind: 'comment', text: sql.slice(i, end === -1 ? sql.length : end) });
      i = end === -1 ? sql.length : end;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      if (end === -1) return { tokens, unterminated: true };
      tokens.push({ kind: 'comment', text: sql.slice(i, end + 2) });
      i = end + 2;
      continue;
    }
    const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (tag) {
      const close = sql.indexOf(tag[0], i + tag[0].length);
      if (close === -1) return { tokens, unterminated: true };
      const inner = scan(sql.slice(i + tag[0].length, close));
      if (inner.unterminated) return { tokens, unterminated: true };
      tokens.push(...inner.tokens);
      i = close + tag[0].length;
      continue;
    }
    if (sql[i] === "'") {
      let j = i + 1;
      let text = '';
      for (;;) {
        if (j >= sql.length) return { tokens, unterminated: true };
        if (sql[j] === "'" && sql[j + 1] === "'") {
          text += "''";
          j += 2;
          continue;
        }
        if (sql[j] === "'") break;
        text += sql[j];
        j += 1;
      }
      tokens.push({ kind: 'string', text });
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return { tokens, unterminated: false };
}

describe('drift: the committed SQL is what the generator writes', () => {
  it.each(FILES)('%s matches the generator output', (file, committed) => {
    const generated = file === CHECK_FILE ? renderCheckSql() : renderDeleteSql();
    // If this fails: run `npx tsx scripts/generate-test-account-cleanup-sql.ts`
    // and review the diff. Never hand-edit the SQL.
    expect(committed).toBe(generated);
  });

  it.each([
    [MIGRATION_FILE, () => renderMigrationSql()],
    [ROLLBACK_FILE, () => renderRollbackSql()],
    [VERSION_FILE, () => renderVersionModule()],
  ])('%s matches the generator output (R-1)', (file, render) => {
    // Same fix as above: regenerate, never hand-edit. Once the migration is
    // applied, a changed plan needs a NEW FUNCTION_MIGRATION name instead.
    expect(readSql(file)).toBe(render());
  });

  it('the pasted files wrap the same builders the function runs (R-1)', () => {
    expect(checkSql.endsWith(`\n\n${buildCheckQuery()};\n`)).toBe(true);
    expect(deleteSql).toContain(`DO $cleanup$\n${buildDeleteBlock()}\n$cleanup$;\n\n${buildDeleteReportQuery()};\n`);
    expect(migrationSql).toContain(buildCheckJson());
    expect(migrationSql).toContain(`${buildDeleteBlock()};`);
    expect(migrationSql).toContain(buildDeleteReportJson());
    // The builders carry no edit line, no comment and no settings of their own.
    for (const body of [buildCheckQuery(), buildDeleteBlock(), buildDeleteReportQuery()]) {
      expect(body).not.toContain('--');
      expect(body).not.toContain(PLACEHOLDER_EMAIL);
      expect(body).not.toMatch(/set_config\(/);
      expect(body.trimEnd().endsWith(';')).toBe(false);
    }
  });

  it('is deterministic', () => {
    expect(renderMigrationSql()).toBe(renderMigrationSql());
    expect(renderMigrationSql()).not.toMatch(/\r/);
    expect(renderCheckSql()).toBe(renderCheckSql());
    expect(renderDeleteSql()).toBe(renderDeleteSql());
    expect(renderDeleteSql()).not.toMatch(/\r/);
  });
});

describe('coverage (SA C-3)', () => {
  it('handles every user-scoped descriptor: deleted, must be empty, or a final step', () => {
    const handled = new Set([...plan.map((entry) => entry.table), ...Object.keys(MUST_BE_EMPTY)]);
    const missing = PURGE_DESCRIPTORS.filter((d) => d.scope.kind !== 'global' && !handled.has(d.table)).map((d) => d.table);
    expect(missing).toEqual([]);
  });

  it('deletes every table a purge deletes, with every option on', () => {
    const run = descriptorsForRun('purge', { integrations: true, agents: true, activityHistory: true }).map((d) => d.table);
    expect(run.filter((table) => position(table) === -1)).toEqual([]);
  });

  it('deletes every business-owned table', () => {
    // Named in the ownership migration but measured ABSENT from the database,
    // so they have no descriptor (businessOwnedTables.test.ts, requirement §8.9).
    // Were one re-created, the business_profiles cascade would still clear it.
    const MEASURED_ABSENT = ['insight_outcomes', 'websites'];
    for (const table of MEASURED_ABSENT) {
      expect(PURGE_DESCRIPTORS.some((d) => d.table === table)).toBe(false);
    }
    expect(BUSINESS_OWNED_TABLES.filter((table) => position(table) === -1 && !MEASURED_ABSENT.includes(table))).toEqual([]);
  });

  it('names each table once', () => {
    const tables = plan.map((entry) => entry.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('only extends `never` descriptors that exist, each with a reason', () => {
    const never = new Set(PURGE_DESCRIPTORS.filter((d) => d.level === 'never').map((d) => d.table));
    for (const extra of FULL_REMOVAL_EXTRAS) {
      expect(never.has(extra.table)).toBe(true);
      expect(extra.reason.length).toBeGreaterThan(10);
    }
  });

  it('never deletes platform data: global descriptors, actor-column tables, must-be-empty tables', () => {
    // The two invite tables are global and are the reviewed exception (BQ-3).
    const allowedGlobal = new Set(['business_os_account_lineage', 'business_os_invites']);
    const globals = PURGE_DESCRIPTORS.filter((d) => d.scope.kind === 'global' && !allowedGlobal.has(d.table)).map((d) => d.table);
    const actorOnly = ACTOR_FOREIGN_KEYS.filter((fk) => fk.ownerColumn === null).map((fk) => fk.table);
    for (const table of [...globals, ...actorOnly, ...Object.keys(MUST_BE_EMPTY)]) {
      expect(position(table)).toBe(-1);
    }
  });
});

describe('order (SA C-12)', () => {
  it('runs step A in the descriptor bands, then step B, then step C', () => {
    const steps = plan.map((entry) => entry.step).join('');
    expect(steps).toMatch(/^A+B+C+$/);
    const order = new Map(PURGE_DESCRIPTORS.map((d) => [d.table, d.order]));
    const bands = plan.filter((entry) => entry.step === 'A').map((entry) => order.get(entry.table) ?? -1);
    expect(bands).toEqual([...bands].sort((a, b) => a - b));
  });

  it('puts every blocking child before its parent', () => {
    for (const edge of [...BLOCKING_EDGES, ...STEP_B_BLOCKING_EDGES]) {
      if (position(edge.child) === -1 || position(edge.parent) === -1) continue;
      expect([edge.child, position(edge.child) < position(edge.parent)]).toEqual([edge.child, true]);
    }
  });

  it('puts every `via` child before its parent, so the sub-select still finds the parent rows', () => {
    const via = plan.filter((entry) => entry.parent !== null);
    expect(via.length).toBeGreaterThan(0);
    for (const entry of via) {
      expect([entry.table, position(entry.table) < position(entry.parent as string)]).toEqual([entry.table, true]);
    }
  });

  it('ends with business_profiles, profiles, organizations, then the circle and the invites', () => {
    expect(plan.slice(-FINAL_STEPS.length).map((entry) => entry.table)).toEqual(FINAL_STEPS.map((step) => step.table));
    expect(plan.filter((entry) => entry.table === 'business_profiles')).toHaveLength(1);
  });

  it('deletes the login last, after the plan loop and before the audit row', () => {
    const loop = deleteSql.indexOf('END LOOP');
    const login = deleteSql.indexOf('DELETE FROM auth.users');
    const audit = deleteSql.indexOf('INSERT INTO public.audit_trail (');
    expect(loop).toBeGreaterThan(0);
    expect(login).toBeGreaterThan(loop);
    expect(audit).toBeGreaterThan(login);
  });
});

describe('the delete proves CLEAN before it commits (SA F-1)', () => {
  const block = deleteSql.slice(deleteSql.indexOf('DO $cleanup$'), deleteSql.indexOf('$cleanup$;'));
  const after = deleteSql.slice(deleteSql.indexOf('$cleanup$;'));

  it('scans for survivors inside the block, between the login delete and the audit row, and raises on any', () => {
    const login = block.indexOf('DELETE FROM auth.users');
    const scan = block.indexOf('v_survivors := (');
    const raise = block.indexOf("RAISE EXCEPTION 'Rows still name the login after the delete, so everything was rolled back: %', v_survivors");
    const audit = block.indexOf('INSERT INTO public.audit_trail (');
    expect(login).toBeGreaterThan(0);
    expect(scan).toBeGreaterThan(login);
    expect(raise).toBeGreaterThan(scan);
    expect(audit).toBeGreaterThan(raise);
  });

  it('scans every plan table and every link to the login', () => {
    const scan = block.slice(block.indexOf('v_survivors := ('), block.indexOf('IF v_survivors IS NOT NULL'));
    expect(scan).toContain("con.confrelid = 'auth.users'::regclass");
    expect(scan).toContain('FROM auth.users AS users WHERE users.id = v_user_id');
    for (const entry of plan.filter((e) => e.parent === null)) expect(scan).toContain(`'${entry.table}'`);
  });

  it('keeps the final SELECT informational: the latest removal in 15 minutes, with same_run', () => {
    expect(after).not.toMatch(/\bDELETE\b|\bINSERT\b|NOT RUN/);
    expect(after).toContain("'NO RECENT REMOVAL'");
    expect(after).toContain("audit.created_at >= now() - interval '15 minutes'");
    expect(after).toContain('ORDER BY audit.created_at DESC');
    expect(after).toContain('AS same_run');
  });

  it('reports one row per removed table, by name, from the audit counts, then a TOTAL row', () => {
    // User request 2026-10-07: show what was removed, table by table.
    expect(after).toContain("jsonb_each_text(coalesce(recent.details -> 'counts', '{}'::jsonb))");
    expect(after).toContain(
      'SELECT report.line, report.rows_removed, report.result, report.tables_removed, report.removed_login, report.removed_at, report.same_run'
    );
    expect(after).toContain("SELECT 1, 'TOTAL', summary.rows_removed, summary.result");
    expect(after).toContain('ORDER BY report.sort_order, report.line;');
    expect(after).toContain('(SELECT coalesce(sum(per_table.rows_removed), 0) FROM per_table)::bigint AS rows_removed');
    expect(after).toContain('(SELECT count(*) FROM per_table)::bigint AS tables_removed');
    // The block records the counts the report reads.
    expect(deleteSql).toContain("'tables', v_tables, 'rows', v_total, 'counts', v_counts");
  });
});

describe('links pointing at removed tables (SA F-2, F-3)', () => {
  it('reviews each inbound link once, and explains every child without an owner column', () => {
    const keys = INBOUND_FOREIGN_KEYS.map(([child, constraint]) => `${child}.${constraint}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [child, , owner] of INBOUND_FOREIGN_KEYS) {
      if (owner === null) expect([child, typeof PARENT_OWNED_REASONS[child]]).toEqual([child, 'string']);
    }
    expect(Object.keys(PARENT_OWNED_REASONS).filter((child) => !INBOUND_FOREIGN_KEYS.some(([c, , o]) => c === child && o === null))).toEqual([]);
  });

  it.each(FILES)('%s reads inbound links from the catalog and blocks unreviewed or foreign-owned ones', (_file, sql) => {
    expect(sql).toContain('parent_rel.relname IN (SELECT plan.table_name FROM plan)');
    expect(sql).toContain('WHERE NOT inbound_rows.reviewed OR inbound_rows.key_width <> 1 OR NOT inbound_rows.owner_ok OR inbound_rows.found > 0');
    expect(sql).toContain('child_rows.%I IS DISTINCT FROM %L');
  });

  it.each(FILES)('%s reviews delete triggers on plan tables, login children and inbound children', (_file, sql) => {
    const g17 = sql.slice(sql.indexOf("'G-17'::text AS guard"), sql.indexOf("'G-18'::text AS guard"));
    expect(g17).toContain('rel.relname IN (SELECT plan.table_name FROM plan)');
    expect(g17).toContain("fk_con.confrelid = 'auth.users'::regclass");
    expect(g17).toContain('inbound_catalog.child_table FROM inbound_catalog');
  });
});

describe('guards', () => {
  const ids = ['G-1', 'G-2', 'G-4', 'G-5', 'G-6', 'G-7', 'G-8', 'G-9', 'G-10', 'G-11', 'G-12', 'G-13', 'G-14', 'G-15', 'G-16', 'G-17', 'G-18'];

  it.each(ids)('%s is in both files', (id) => {
    expect(checkSql).toContain(`'${id}'::text AS guard`);
    expect(deleteSql).toContain(`'${id}'::text AS guard`);
  });

  it('checks every guard and the typed confirmation before the first DELETE (SA TQ-1 b)', () => {
    const blockedRaise = deleteSql.indexOf("RAISE EXCEPTION 'BLOCKED, nothing was removed: %'");
    const confirm = deleteSql.indexOf('IF v_confirm IS DISTINCT FROM v_email THEN');
    const marker = deleteSql.indexOf("'G-2'::text AS guard");
    expect(blockedRaise).toBeGreaterThan(0);
    expect(confirm).toBeGreaterThan(0);
    expect(marker).toBeGreaterThan(0);
    // "DELETE FROM", not "DELETE": the header comment names the file "DELETE".
    const firstStatementDelete = deleteSql.indexOf('DELETE FROM');
    expect(firstStatementDelete).toBeGreaterThan(blockedRaise);
    expect(marker).toBeLessThan(blockedRaise);
  });

  it('qualifies a test account by the email CONTAINING the tag, case-insensitive, never an empty tag', () => {
    for (const [, sql] of FILES) {
      expect(sql).toContain("NULLIF(lower(btrim(coalesce(current_setting('cleanup.test_tag', true), ''))), '') AS test_tag");
      expect(sql).toContain('sign(strpos(params.target_email, params.test_tag))');
      expect(sql).toContain('counted.test_tag IS NULL OR counted.found <> 1');
      // strpos, not LIKE: a `%` or `_` in the tag must be read as itself.
      expect(sql).not.toMatch(/LIKE\s+params\.test_tag/i);
    }
  });

  it('has the tag and the email on their own edit lines at the top of both files', () => {
    for (const [, sql] of FILES) {
      const lines = sql.split('\n');
      const emailLine = lines.findIndex((line) => line.startsWith("SELECT set_config('cleanup.target_email'"));
      const tagLine = lines.findIndex((line) => line.startsWith("SELECT set_config('cleanup.test_tag'"));
      expect(emailLine).toBeGreaterThan(-1);
      expect(tagLine).toBeGreaterThan(-1);
      expect(lines[emailLine]).toContain(`'${PLACEHOLDER_EMAIL}', true)`);
      expect(lines[tagLine]).toContain(`'${DEFAULT_TEST_TAG}', true)`);
      expect(lines[tagLine - 1]).toMatch(/^-- 2\. The test tag/);
      expect(tagLine).toBeLessThan(lines.findIndex((line) => line.startsWith('WITH') || line.startsWith('DO ')));
    }
    expect(deleteSql).toContain("SELECT set_config('cleanup.confirm_email', 'type-the-email-again', true)");
  });

  it('sets settings transaction-local and reads them fail-closed (SA C-5)', () => {
    for (const [, sql] of FILES) {
      for (const call of sql.match(/set_config\([^)]*\)/g) ?? []) expect(call).toMatch(/, true\)$/);
      expect(sql).not.toMatch(/current_setting\('cleanup\.[a-z_]+'\)/);
    }
  });

  it('blocks on stored files in every bucket the descriptors list (SA C-4)', () => {
    for (const bucket of STORAGE_DESCRIPTORS.map((s) => s.bucket)) {
      expect(checkSql).toContain(`'${bucket}'`);
      expect(deleteSql).toContain(`'${bucket}'`);
    }
  });
});

describe('audit row (SA TQ-5, C-7)', () => {
  it('uses a registered event whose severity and flags match the SQL', () => {
    expect(AUDIT_EVENTS.BUSINESS_TEST_ACCOUNT_REMOVED).toBe(AUDIT_ACTION);
    const meta = EVENT_METADATA[AUDIT_EVENTS.BUSINESS_TEST_ACCOUNT_REMOVED];
    expect(meta.severity).toBe(AUDIT_SEVERITY);
    expect([...(meta.complianceFlags ?? [])]).toEqual([...AUDIT_COMPLIANCE_FLAGS]);
    expect(deleteSql).toContain(
      `'${AUDIT_ACTION}', 'user', v_user_id::text, NULL, NULL, NULLIF(current_setting('cleanup.actor_id', true), '')::uuid,`
    );
    // SA-5: unset (the pasted file), actor_id is NULL and source is 'operator_sql', as before.
    expect(deleteSql).toContain("'source', coalesce(NULLIF(current_setting('cleanup.source', true), ''), 'operator_sql')");
    expect(deleteSql).toContain(`'${AUDIT_SEVERITY}', ARRAY['SOC2']::text[], now()`);
  });
});

describe('SQL editor hygiene (SA C-6, C-10, C-11)', () => {
  it.each(FILES)('%s has exactly one "into", the audit insert', (_file, sql) => {
    const allowed = 'INSERT INTO public.audit_trail (';
    const occurrences = sql.split(allowed).length - 1;
    expect(occurrences).toBe(_file === DELETE_FILE ? 1 : 0);
    expect(sql.split(allowed).join('').match(/\binto\b/gi)).toBeNull();
  });

  it.each(FILES)('%s closes every string, comment and dollar quote', (_file, sql) => {
    expect(scan(sql).unterminated).toBe(false);
    const tags = sql.match(/\$[A-Za-z_]*\$/g) ?? [];
    expect(tags.length % 2).toBe(0);
  });

  it.each(FILES)('%s keeps comments to the header, without semicolons or apostrophes', (_file, sql) => {
    const lines = sql.split('\n');
    const firstCode = lines.findIndex((line) => line.startsWith('WITH') || line.startsWith('DO '));
    lines.forEach((line, index) => {
      if (line.includes('--')) {
        expect([index, line.startsWith('-- ') && index < firstCode]).toEqual([index, true]);
      }
    });
    for (const token of scan(sql).tokens.filter((t) => t.kind === 'comment')) {
      expect(token.text).not.toMatch(/[;']/);
    }
  });

  it.each(FILES)('%s has no semicolon or "--" inside a string literal', (_file, sql) => {
    const offenders = scan(sql)
      .tokens.filter((t) => t.kind === 'string' && (t.text.includes(';') || t.text.includes('--')))
      .map((t) => t.text.slice(0, 60));
    expect(offenders).toEqual([]);
  });

  it.each(FILES)('%s never assigns with SELECT ... INTO, never disables triggers, never deletes storage', (_file, sql) => {
    expect(sql).not.toMatch(/session_replication_role/i);
    expect(sql).not.toMatch(/DISABLE\s+TRIGGER/i);
    expect(sql).not.toMatch(/DELETE\s+FROM\s+storage\./i);
    expect(sql).not.toMatch(/raw_app_meta_data|raw_user_meta_data/i);
    expect(sql).not.toMatch(/\bUPDATE\s+(auth|public)\./i);
  });

  it.each(FILES)('%s has no single-letter aliases', (_file, sql) => {
    expect(sql).not.toMatch(/\bAS\s+[a-z]\b/i);
  });

  it.each(FILES)('%s contains no email except the placeholder', (_file, sql) => {
    const emails = sql.match(/[A-Za-z0-9.+_-]+@[A-Za-z0-9.-]+/g) ?? [];
    expect(new Set(emails)).toEqual(new Set([PLACEHOLDER_EMAIL]));
  });

  it.each(FILES)('%s is several standalone statements', (_file, sql) => {
    // Statement ends at a line that ends with ";" outside the DO body.
    const outsideDo = sql.replace(/DO \$cleanup\$[\s\S]*?\$cleanup\$;/, 'DO_BLOCK;');
    const statements = outsideDo.split(/;\n/).map((part) => part.trim()).filter(Boolean);
    expect(statements.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the secret-gated function (SA re-ruling R-2 to R-4, R-6)', () => {
  const fn = migrationSql.slice(migrationSql.indexOf('CREATE OR REPLACE FUNCTION'), migrationSql.indexOf('$operator_cleanup$;'));
  const head = fn.slice(0, fn.indexOf('IF p_mode = \'check\' THEN\n    v_result'));

  it('is SECURITY DEFINER with search_path pg_catalog, public, pg_temp (pg_temp last), returning jsonb', () => {
    // Not '': the reviewed delete triggers (refund recompute, storage quota) name
    // their tables without a schema and must resolve them as they do today (SA review).
    expect(fn).toContain(
      'CREATE OR REPLACE FUNCTION public.operator_test_account_cleanup(p_mode text, p_email text, p_tag text, p_confirm text, p_actor uuid, p_secret text)\nRETURNS jsonb\nLANGUAGE plpgsql\nVOLATILE\nSECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp\n'
    );
  });

  it('starts by aborting when anon or authenticated may CREATE in schema public (SA review)', () => {
    const guard = migrationSql.indexOf('DO $create_guard$');
    expect(guard).toBeGreaterThan(0);
    expect(guard).toBeLessThan(migrationSql.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(migrationSql).toContain(
      "IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN"
    );
    expect(migrationSql.slice(guard, migrationSql.indexOf('$create_guard$;'))).toContain('RAISE EXCEPTION');
  });

  it('names the tables it touches directly with their schema', () => {
    // The function's own SQL stays schema-qualified; public is on the path only for the triggers.
    for (const table of ['operator_private.secrets', 'public.audit_trail', 'auth.users', 'storage.objects', 'public.admin_users']) {
      expect(fn).toContain(table);
    }
    expect(fn).not.toMatch(/(FROM|JOIN|INSERT INTO|DELETE FROM)\s+(audit_trail|admin_users|secrets|users|objects)\b/);
  });

  it('replaces only the function: never creates, alters or drops the schema or the secret table', () => {
    // The schema, the secret table and its RLS were created by the applied
    // initial migration (pinned below). Re-running them would fail, or worse,
    // drop the stored hash and disarm the routes.
    expect(migrationSql).not.toMatch(/CREATE (SCHEMA|TABLE)|ALTER TABLE|DROP |TRUNCATE|DELETE FROM operator_private/i);
    expect(migrationSql).not.toMatch(/IF NOT EXISTS/i);
    expect(migrationSql).not.toMatch(/CREATE POLICY/i);
    expect(migrationSql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  });

  it('refuses, before replacing anything, until the initial migration and every required table are applied', () => {
    const guard = migrationSql.slice(migrationSql.indexOf('DO $order_guard$'), migrationSql.indexOf('$order_guard$;'));
    expect(migrationSql.indexOf('DO $order_guard$')).toBeGreaterThan(0);
    expect(migrationSql.indexOf('$order_guard$;')).toBeLessThan(migrationSql.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(guard).toContain(
      `IF pg_catalog.to_regclass('operator_private.secrets') IS NULL OR pg_catalog.to_regprocedure('${FUNCTION_SIGNATURE}') IS NULL THEN\n    RAISE EXCEPTION 'Apply ${INITIAL_FUNCTION_MIGRATION} first  Nothing was applied';`
    );
    for (const required of FUNCTION_REQUIRED_TABLES) {
      expect(guard).toContain(
        `IF pg_catalog.to_regclass('public.${required.table}') IS NULL THEN\n    RAISE EXCEPTION 'Apply ${required.migration} first  Nothing was applied';`
      );
    }
  });

  it('names each required table with the migration that really creates it, and really uses it', () => {
    expect(FUNCTION_REQUIRED_TABLES.length).toBeGreaterThan(0);
    for (const required of FUNCTION_REQUIRED_TABLES) {
      const file = `supabase/migrations/${required.migration}.sql`;
      expect([file, existsSync(join(REPO, ...file.split('/')))]).toEqual([file, true]);
      expect(readSql(file)).toContain(`CREATE TABLE public.${required.table} (`);
      expect(fn).toContain(`public.${required.table}`);
      expect(required.reason.length).toBeGreaterThan(20);
    }
  });

  it('grants EXECUTE to service_role only, then reloads the schema cache last', () => {
    expect(migrationSql).toContain(`ALTER FUNCTION ${FUNCTION_SIGNATURE} OWNER TO postgres;`);
    expect(migrationSql).toContain(`REVOKE ALL ON FUNCTION ${FUNCTION_SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    const grants = migrationSql.match(/^GRANT .*$/gm) ?? [];
    expect(grants).toEqual([`GRANT EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} TO service_role;`]);
    expect(migrationSql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });

  it('checks the secret first, by sha256, and refuses with 42501', () => {
    const secret = head.indexOf('pg_catalog.sha256(pg_catalog.convert_to(p_secret, \'UTF8\'))');
    expect(head).toContain('p_secret IS NULL OR pg_catalog.length(p_secret) < 32');
    expect(head).toContain(`stored.name = '${SECRET_ROW_NAME}'`);
    expect(secret).toBeGreaterThan(0);
    expect(head.indexOf("RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'")).toBeGreaterThan(secret);
    // The secret check comes before anything else the function does.
    expect(secret).toBeLessThan(head.indexOf('p_mode NOT IN'));
    expect(fn).not.toMatch(/pgcrypto|crypt\(|digest\(/i);
  });

  it('holds no secret, hash or hex literal, and never raises a parameter', () => {
    expect(migrationSql).not.toMatch(/'[0-9a-f]{32,}'/i);
    expect(migrationSql).not.toMatch(/decode\(/i);
    expect(migrationSql).not.toMatch(/RAISE[^;]*p_(secret|email|tag|confirm)/i);
  });

  it('sets all five cleanup values from parameters, plus read-only for a check and the lock timeout', () => {
    expect(head).toContain("PERFORM pg_catalog.set_config('transaction_read_only', 'on', true);");
    for (const name of ['target_email', 'test_tag', 'confirm_email', 'actor_id', 'source']) {
      expect(head).toContain(`PERFORM pg_catalog.set_config('cleanup.${name}', `);
    }
    expect(head).toContain("PERFORM pg_catalog.set_config('cleanup.source', 'admin_page', true);");
    expect(head).toContain("IF p_mode = 'delete' AND p_actor IS NULL THEN");
    expect(head).toContain("PERFORM pg_catalog.set_config('lock_timeout', '5s', true);");
    expect(fn).not.toContain('statement_timeout');
    expect(fn).not.toMatch(/\bDO \$/);
  });

  it('returns the version stamp the app pins (R-6)', () => {
    expect(CLEANUP_FUNCTION_VERSION).toBe(cleanupFunctionVersion());
    expect(CLEANUP_FUNCTION_VERSION).toMatch(/^[0-9a-f]{16}$/);
    expect(fn).toContain(`pg_catalog.jsonb_build_object('version', '${CLEANUP_FUNCTION_VERSION}', 'mode', p_mode, 'rows'`);
  });

  it('the rollback restores the previous applied function byte for byte, keeps the secret, then reloads', () => {
    const restored = previousFunctionSql(previousMigrationSql);
    // The previous function, only its CREATE turned into CREATE OR REPLACE.
    const close = '\n$operator_cleanup$';
    expect(restored.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')).toBe(
      previousMigrationSql.slice(previousMigrationSql.indexOf('CREATE FUNCTION'), previousMigrationSql.indexOf(`${close};`) + close.length)
    );
    expect(rollbackSql).toContain(`\n${restored};\n`);
    expect(rollbackSql).toBe(renderRollbackSql(previousMigrationSql));
    // It restores an older stamp, never the one this build pins.
    expect(restored).not.toContain(`'${CLEANUP_FUNCTION_VERSION}'`);
    expect(restored).toMatch(/jsonb_build_object\('version', '[0-9a-f]{16}', 'mode'/);
    expect(rollbackSql).not.toMatch(/DROP |CREATE (SCHEMA|TABLE)|operator_private\.secrets\s*\(/i);
    expect(rollbackSql).toContain(`ALTER FUNCTION ${FUNCTION_SIGNATURE} OWNER TO postgres;`);
    expect(rollbackSql).toContain(`REVOKE ALL ON FUNCTION ${FUNCTION_SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    expect(rollbackSql.match(/^GRANT .*$/gm) ?? []).toEqual([`GRANT EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} TO service_role;`]);
    expect(rollbackSql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';")).toBe(true);
  });
});

describe('applied history: a function migration is never edited once applied', () => {
  // sha256 of the LF-normalised file as applied to prod. If this fails, the
  // applied file was edited: put it back from origin/main, and put the change
  // in a NEW dated FUNCTION_MIGRATION instead. When a newer migration becomes
  // applied history, add it here with its own hash.
  const APPLIED: ReadonlyArray<[string, string]> = [
    [`supabase/migrations/${INITIAL_FUNCTION_MIGRATION}.sql`, '19df58138f21362ed57f8f6bba4af889067ba2b2dd64a305ae56cc9fe08ec15e'],
    [`supabase/SQL Scripts/${INITIAL_FUNCTION_MIGRATION}_rollback.sql`, 'f8573a4d29f35e131a369f77e072a27b08822ef06dcb94c7fd39d01c27ea62f1'],
  ];

  it.each(APPLIED)('%s is byte-identical to what was applied', (file, sha256) => {
    expect(createHash('sha256').update(readSql(file)).digest('hex')).toBe(sha256);
  });

  it('the generator writes a newer file than every applied one, and rolls back to the previous', () => {
    const applied = APPLIED.map(([file]) => file);
    expect(applied).not.toContain(MIGRATION_FILE);
    expect(applied).not.toContain(ROLLBACK_FILE);
    expect(applied).toContain(PREVIOUS_MIGRATION_FILE);
    // Dated names sort by date: the new file must be later than the one it replaces.
    expect(MIGRATION_FILE > PREVIOUS_MIGRATION_FILE).toBe(true);
  });
});

describe('paste safety of the migration and rollback (SA C-6, R-1)', () => {
  const SQL: ReadonlyArray<[string, string, number]> = [
    [MIGRATION_FILE, migrationSql, 1],
    // The restored previous function carries the same single audit insert.
    [ROLLBACK_FILE, rollbackSql, 1],
  ];

  it.each(SQL)('%s has "into" only as the audit INSERT INTO keyword', (_file, sql, expected) => {
    const allowed = 'INSERT INTO public.audit_trail (';
    expect(sql.split(allowed).length - 1).toBe(expected);
    expect(sql.split(allowed).join('').match(/\binto\b/gi)).toBeNull();
  });

  it.each(SQL)('%s closes every string, comment and dollar quote', (_file, sql) => {
    expect(scan(sql).unterminated).toBe(false);
  });

  it.each(SQL)('%s keeps comments to the header, without semicolons or apostrophes', (_file, sql) => {
    const lines = sql.split('\n');
    const firstCode = lines.findIndex((line) => line !== '' && !line.startsWith('--'));
    lines.forEach((line, index) => {
      if (line.includes('--')) expect([index, line.startsWith('-- ') && index < firstCode]).toEqual([index, true]);
    });
    for (const token of scan(sql).tokens.filter((t) => t.kind === 'comment')) expect(token.text).not.toMatch(/[;']/);
  });

  it.each(SQL)('%s has no semicolon or "--" inside a string literal, and no email', (_file, sql) => {
    const offenders = scan(sql)
      .tokens.filter((t) => t.kind === 'string' && (t.text.includes(';') || t.text.includes('--')))
      .map((t) => t.text.slice(0, 60));
    expect(offenders).toEqual([]);
    expect(sql.match(/[A-Za-z0-9.+_-]+@[A-Za-z0-9.-]+\.[a-z]+/g)).toBeNull();
  });
});

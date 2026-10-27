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
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ACTOR_FOREIGN_KEYS,
  ANONYMISE_AUDIT_ACTION,
  ANONYMISE_AUDIT_COMPLIANCE_FLAGS,
  ANONYMISE_AUDIT_SEVERITY,
  AUDIT_ACTION,
  AUTH_CLOSURE,
  AUTH_USERS_CLOSURE,
  BLANK_LIST,
  CLOSED_BAN_INTERVAL,
  CLOSED_EMAIL_DOMAIN,
  KEEP_SET,
  PREVIOUS_FUNCTION_SIGNATURE,
  RETIRED_FUNCTION_SIGNATURE,
  RECEIPT_COLUMNS,
  RECEIPT_INPUT_KEYS,
  RECEIPTS_TABLE,
  REVIEWED_KEPT_LINKS,
  REVIEWED_UPDATE_TRIGGERS,
  authLogPredicate,
  blankedTables,
  buildAnonymiseBlock,
  AUDIT_COMPLIANCE_FLAGS,
  AUDIT_SEVERITY,
  CASCADE_CHILDREN,
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
  NOT_NULL_OVERWRITE_EDGES,
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

/**
 * SA-W105 (finance 4b.1): a `never` child removed by its parent's ON DELETE
 * CASCADE counts as handled only when its parent is a plan table, its
 * descriptor is `via` that parent with the same FK, and the link is reviewed
 * parent-owned (owner column null) so G-18 lets it through.
 */
function handledCascadeChildren(
  children: typeof CASCADE_CHILDREN,
  planTables: ReadonlySet<string>,
  descriptors: typeof PURGE_DESCRIPTORS,
  inbound: typeof INBOUND_FOREIGN_KEYS
): string[] {
  return children
    .filter((child) => {
      const scope = descriptors.find((d) => d.table === child.table)?.scope;
      return (
        planTables.has(child.parent) &&
        scope?.kind === 'via' &&
        scope.parent === child.parent &&
        scope.fk === child.fk &&
        inbound.some(([table, constraint, owner]) => table === child.table && constraint === child.constraint && owner === null)
      );
    })
    .map((child) => child.table);
}

describe('coverage (SA C-3)', () => {
  const planTables = new Set(plan.map((entry) => entry.table));
  const missingFrom = (handledChildren: readonly string[]) => {
    const handled = new Set([...planTables, ...Object.keys(MUST_BE_EMPTY), ...handledChildren]);
    return PURGE_DESCRIPTORS.filter((d) => d.scope.kind !== 'global' && !handled.has(d.table)).map((d) => d.table);
  };

  it('handles every user-scoped descriptor: deleted, must be empty, a final step, or a reviewed cascade child', () => {
    expect(missingFrom(handledCascadeChildren(CASCADE_CHILDREN, planTables, PURGE_DESCRIPTORS, INBOUND_FOREIGN_KEYS))).toEqual([]);
  });

  it('accepts each cascade child only through its reviewed link (SA-W105)', () => {
    expect(handledCascadeChildren(CASCADE_CHILDREN, planTables, PURGE_DESCRIPTORS, INBOUND_FOREIGN_KEYS)).toEqual(
      CASCADE_CHILDREN.map((child) => child.table)
    );
    // A cascade child is never also deleted by the plan itself: there is no delete step (SA-Q66).
    for (const child of CASCADE_CHILDREN) expect(planTables.has(child.table)).toBe(false);
  });

  it('negative controls: a cascade child is missing when its parent is not a plan table, its descriptor differs, or its link is unreviewed', () => {
    const child = CASCADE_CHILDREN[0];
    expect(missingFrom([])).toEqual([child.table]);
    const notInPlan = [{ ...child, parent: 'not_a_plan_table' }];
    expect(handledCascadeChildren(notInPlan, planTables, PURGE_DESCRIPTORS, INBOUND_FOREIGN_KEYS)).toEqual([]);
    const otherFk = [{ ...child, fk: 'other_id' }];
    expect(handledCascadeChildren(otherFk, planTables, PURGE_DESCRIPTORS, INBOUND_FOREIGN_KEYS)).toEqual([]);
    const unreviewed = INBOUND_FOREIGN_KEYS.filter(([table]) => table !== child.table);
    expect(handledCascadeChildren(CASCADE_CHILDREN, planTables, PURGE_DESCRIPTORS, unreviewed)).toEqual([]);
    const ownedLink = INBOUND_FOREIGN_KEYS.map((edge) => (edge[0] === child.table ? ([edge[0], edge[1], 'user_id'] as const) : edge));
    expect(handledCascadeChildren(CASCADE_CHILDREN, planTables, PURGE_DESCRIPTORS, ownedLink)).toEqual([]);
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
    for (const edge of [...BLOCKING_EDGES, ...NOT_NULL_OVERWRITE_EDGES, ...STEP_B_BLOCKING_EDGES]) {
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
  const ids = ['G-1', 'G-2', 'G-4', 'G-5', 'G-6', 'G-7', 'G-8', 'G-9', 'G-10', 'G-11', 'G-12', 'G-13', 'G-14', 'G-15', 'G-16', 'G-17', 'G-18', 'G-19'];

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

const ACTOR = "NULLIF(current_setting('cleanup.actor_id', true), '')::uuid";

describe('audit row (SA TQ-5, C-7)', () => {
  it('uses a registered event whose severity and flags match the SQL', () => {
    expect(AUDIT_EVENTS.BUSINESS_TEST_ACCOUNT_REMOVED).toBe(AUDIT_ACTION);
    const meta = EVENT_METADATA[AUDIT_EVENTS.BUSINESS_TEST_ACCOUNT_REMOVED];
    expect(meta.severity).toBe(AUDIT_SEVERITY);
    expect([...(meta.complianceFlags ?? [])]).toEqual([...AUDIT_COMPLIANCE_FLAGS]);
    expect(deleteSql).toContain(`'${AUDIT_ACTION}', 'user', v_user_id::text, NULL,\n    ${ACTOR}, ${ACTOR},`);
    // SA-5: unset (the pasted file), actor_id is NULL and source is 'operator_sql', as before.
    expect(deleteSql).toContain("'source', coalesce(NULLIF(current_setting('cleanup.source', true), ''), 'operator_sql')");
    expect(deleteSql).toContain(`'${AUDIT_SEVERITY}', ARRAY['SOC2']::text[], now()`);
  });

  // 20261047 (AD-2 convention): /admin/audit-trail names a row only from user_id,
  // so the admin who ran the delete is user_id AND actor_id; entity = the removed login.
  it('names the admin as user_id and actor_id on the admin page, and NULL for the pasted operator_sql file', () => {
    const columns = 'action, entity_type, entity_id, resource_name, user_id, actor_id,';
    for (const sql of [deleteSql, migrationSql]) {
      expect(sql).toContain(`INSERT INTO public.audit_trail (${columns}`);
      expect(sql).toContain(`'${AUDIT_ACTION}', 'user', v_user_id::text, NULL,\n    ${ACTOR}, ${ACTOR},`);
    }
    // admin_page: the function sets the actor from p_actor on a delete (and refuses a delete without one).
    expect(migrationSql).toContain(
      "PERFORM pg_catalog.set_config('cleanup.actor_id', CASE WHEN p_mode IN ('delete', 'anonymise') THEN coalesce(p_actor::text, '') ELSE '' END, true);"
    );
    expect(migrationSql).toContain(
      "PERFORM pg_catalog.set_config('cleanup.source', CASE WHEN (p_receipt ->> 'origin') = 'owner' THEN 'self_service' ELSE 'admin_page' END, true);"
    );
    expect(migrationSql).toContain("IF p_mode = 'delete' AND p_actor IS NULL THEN");
    // operator_sql: the pasted file never sets an actor or a source, so user_id = actor_id = NULL.
    expect(deleteSql).not.toMatch(/set_config\('cleanup\.(actor_id|source)'/);
    // The rollback restores the previous function (PREVIOUS_FUNCTION_MIGRATION). Since
    // 20261075 (data export DE-8a) that names the admin too; since DL-1a's 20261094 the previous
    // function is 20261092 (the meeting links). The 20261046 shape (user_id NULL) is gone from it.
    expect(rollbackSql).toContain(`'${AUDIT_ACTION}', 'user', v_user_id::text, NULL,
    ${ACTOR}, ${ACTOR},`);
    expect(rollbackSql).not.toContain(`'${AUDIT_ACTION}', 'user', v_user_id::text, NULL, NULL, ${ACTOR},`);
    expect(PREVIOUS_FUNCTION_MIGRATION).toBe('20261092_operator_test_account_cleanup_meeting_links');
  });
});

describe('SQL editor hygiene (SA C-6, C-10, C-11)', () => {
  it.each(FILES)('%s has exactly one "into", the audit insert', (_file, sql) => {
    const allowed = 'INSERT INTO public.audit_trail (';
    const occurrences = sql.split(allowed).length - 1;
    expect(occurrences).toBe(_file === DELETE_FILE ? 1 : 0);
    expect(sql.split(allowed).join('').match(/\binto\b/gi)).toBeNull();
    // The receipt is the function's alone: a pasted file never writes one (W-9, workplan 7.2).
    expect(sql).not.toContain(RECEIPTS_TABLE);
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
      'CREATE OR REPLACE FUNCTION public.operator_test_account_cleanup(p_mode text, p_email text, p_tag text, p_confirm text, p_actor uuid, p_secret text, p_subject uuid DEFAULT NULL, p_receipt jsonb DEFAULT NULL)\nRETURNS jsonb\nLANGUAGE plpgsql\nVOLATILE\nSECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp\n'
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

  /** The trigger-events label, the only TRUNCATE the function may contain. */
  const TRUNCATE_LABEL = "CASE WHEN (trg.tgtype::integer & 32) <> 0 THEN 'TRUNCATE' END";
  /** The one DROP the migration may hold: the retired 6-argument signature, before the CREATE (SA §D). */
  const DROP_OLD = `DROP FUNCTION IF EXISTS ${RETIRED_FUNCTION_SIGNATURE};`;
  const withoutTruncateLabel = (sql: string) => sql.split(TRUNCATE_LABEL).join('').split(DROP_OLD).join('');
  const FORBIDDEN_DDL = /CREATE (SCHEMA|TABLE)|ALTER TABLE|DROP |TRUNCATE|DELETE FROM operator_private/i;

  it('replaces only the function: never creates, alters or drops the schema or the secret table', () => {
    // The schema, the secret table and its RLS were created by the applied
    // initial migration (pinned below). Re-running them would fail, or worse,
    // drop the stored hash and disarm the routes.
    // Bare TRUNCATE stays banned. Only the one label literal of the trigger-events
    // section is stripped first, so any other TRUNCATE (statement or dynamic) fails.
    expect(migrationSql.split(TRUNCATE_LABEL).length - 1).toBe(1);
    expect(migrationSql.split(DROP_OLD).length - 1).toBe(1);
    expect(migrationSql.indexOf(DROP_OLD)).toBeLessThan(migrationSql.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(withoutTruncateLabel(migrationSql)).not.toMatch(FORBIDDEN_DDL);
    for (const planted of ["EXECUTE format('TRUNCATE %I', t);", 'TRUNCATE "x";', 'truncate table public.audit_trail;']) {
      expect(withoutTruncateLabel(`${migrationSql}
${planted}`)).toMatch(FORBIDDEN_DDL);
    }
    expect(migrationSql).not.toMatch(/IF NOT EXISTS/i);
    expect(migrationSql).not.toMatch(/CREATE POLICY/i);
    expect(migrationSql.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
  });

  it('refuses, before replacing anything, until the initial migration and every required table are applied', () => {
    const guard = migrationSql.slice(migrationSql.indexOf('DO $order_guard$'), migrationSql.indexOf('$order_guard$;'));
    expect(migrationSql.indexOf('DO $order_guard$')).toBeGreaterThan(0);
    expect(migrationSql.indexOf('$order_guard$;')).toBeLessThan(migrationSql.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(guard).toContain(
      `IF pg_catalog.to_regclass('operator_private.secrets') IS NULL OR (pg_catalog.to_regprocedure('${RETIRED_FUNCTION_SIGNATURE}') IS NULL AND pg_catalog.to_regprocedure('${FUNCTION_SIGNATURE}') IS NULL) THEN\n    RAISE EXCEPTION 'Apply ${INITIAL_FUNCTION_MIGRATION} first  Nothing was applied';`
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
      // Static SQL names it schema-qualified; the generated step A plan names it as a
      // dynamic format('%I') row literal. Either way the function reaches it (SA C-8, DE-8a).
      expect([required.table, fn.includes(`public.${required.table}`) || fn.includes(`'A', '${required.table}', `)]).toEqual([required.table, true]);
      expect(required.reason.length).toBeGreaterThan(20);
    }
  });

  it('grants EXECUTE to service_role only, then reloads the schema cache last', () => {
    expect(migrationSql).toContain(`ALTER FUNCTION ${FUNCTION_SIGNATURE} OWNER TO postgres;`);
    expect(migrationSql).toContain(`REVOKE ALL ON FUNCTION ${FUNCTION_SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    const grants = migrationSql.match(/^GRANT .*$/gm) ?? [];
    expect(grants).toEqual([`GRANT EXECUTE ON FUNCTION ${FUNCTION_SIGNATURE} TO service_role;`]);
    // One transaction (DE-10b.1): the drop of the old signature and the new function land together.
    expect(migrationSql).toMatch(/\nBEGIN;\n/);
    expect(migrationSql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
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
    expect(head).toContain("IF p_mode IN ('check', 'anonymise_check') THEN\n    PERFORM pg_catalog.set_config('transaction_read_only', 'on', true);");
    for (const name of ['target_email', 'test_tag', 'confirm_email', 'actor_id', 'source', 'subject_id', 'mode']) {
      expect(head).toContain(`PERFORM pg_catalog.set_config('cleanup.${name}', `);
    }
    expect(head).toContain(
      "PERFORM pg_catalog.set_config('cleanup.source', CASE WHEN (p_receipt ->> 'origin') = 'owner' THEN 'self_service' ELSE 'admin_page' END, true);"
    );
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
    // The previous file may say CREATE FUNCTION (20261041) or CREATE OR REPLACE FUNCTION (every later version).
    const previous = previousMigrationSql; // readSql already normalised CRLF
    const head = previous.search(/CREATE (OR REPLACE )?FUNCTION public\.operator_test_account_cleanup\(/);
    expect(head).toBeGreaterThan(-1);
    expect(restored.replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')).toBe(
      previous.slice(head, previous.indexOf(`${close};`, head) + close.length).replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
    );
    expect(rollbackSql).toContain(`\n${restored};\n`);
    expect(rollbackSql).toBe(renderRollbackSql(previousMigrationSql));
    // It restores an older stamp, never the one this build pins.
    expect(restored).not.toContain(`'${CLEANUP_FUNCTION_VERSION}'`);
    expect(restored).toMatch(/jsonb_build_object\('version', '[0-9a-f]{16}', 'mode'/);
    // W-3: this function is dropped FIRST, so CREATE OR REPLACE of the previous one cannot leave
    // two overloads live (20261081 restored 6 arguments over 8; 20261092 restores 8 over 8). That drop is the only one.
    const dropNew = `DROP FUNCTION IF EXISTS ${FUNCTION_SIGNATURE};`;
    expect(rollbackSql.split(dropNew).length - 1).toBe(1);
    expect(rollbackSql.indexOf(dropNew)).toBeLessThan(rollbackSql.indexOf('CREATE OR REPLACE FUNCTION'));
    expect(rollbackSql.split(dropNew).join('')).not.toMatch(/DROP |CREATE (SCHEMA|TABLE)|operator_private\.secrets\s*\(/i);
    expect(rollbackSql).toContain(`ALTER FUNCTION ${PREVIOUS_FUNCTION_SIGNATURE} OWNER TO postgres;`);
    expect(rollbackSql).toContain(`REVOKE ALL ON FUNCTION ${PREVIOUS_FUNCTION_SIGNATURE} FROM PUBLIC, anon, authenticated;`);
    expect(rollbackSql.match(/^GRANT .*$/gm) ?? []).toEqual([`GRANT EXECUTE ON FUNCTION ${PREVIOUS_FUNCTION_SIGNATURE} TO service_role;`]);
    expect(rollbackSql).toMatch(/\nBEGIN;\n/);
    expect(rollbackSql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
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
    // Applied to prod by the user 2026-10-07 (plan payments P-3b.1, PR #251).
    ['supabase/migrations/20261042_operator_test_account_cleanup_billing_events.sql', 'f2aec8391439e1d26f67e720d4d625087614b289c6968e008b5ae91aebc4d40c'],
    ['supabase/SQL Scripts/20261042_operator_test_account_cleanup_billing_events_rollback.sql', 'ac784912b9d370cb78af13052e03247c9a0b994c0e3ede26c634a13436984067'],
    // Applied to prod 2026-10-07/08 (test-account cleanup first live run, insight links).
    ['supabase/migrations/20261043_operator_test_account_cleanup_insight_links.sql', '5f4c0d5650e7158506f65fbbe25f8818fed9b5875ae78ef040c83561276b800f'],
    ['supabase/SQL Scripts/20261043_operator_test_account_cleanup_insight_links_rollback.sql', '7c16da55c512d10307ea9df995d23f7b4e8e5aeef11f0fd9ca701cb03b26a27b'],
    // Applied to prod 2026-10-08 (scheduling_bookings before crm_contacts, G-19).
    ['supabase/migrations/20261046_operator_test_account_cleanup_notnull_order.sql', 'e401f27fbe77e7a67fadb54e74fd36fc568a904c90eec410cc37d73ab45fa3b9'],
    ['supabase/SQL Scripts/20261046_operator_test_account_cleanup_notnull_order_rollback.sql', 'd86a4874dcf2161d1849433061ce2b9c9c7841c1a216175cee3d4d20c1d7293b'],
    // Applied to prod (audit actor, AD-2 convention). Confirmed live by TL 2026-10-17:
    // the function returns stamp 789e4758d674b561 (data export DE-8a pre-check Q9).
    ['supabase/migrations/20261047_operator_test_account_cleanup_audit_actor.sql', '8294bb810be6b4c314bde18807777c204fe4035788a0096fff6d2fcc134862f9'],
    ['supabase/SQL Scripts/20261047_operator_test_account_cleanup_audit_actor_rollback.sql', '3a808ed17d6522cf82aadbf8e9f6241243a895d69c5a798cca65e3e1d1c6c2de'],
    // Data export DE-8a (PR #451, on main): the version 20261077 chains on and its rollback restores.
    // Pinned as history now because 4b.1 is applied only after it: check 23 requires its stamp
    // a824848e0a538477 live (SA-W108 pattern). If that row is false, nothing of 4b.1 is applied.
    ['supabase/migrations/20261075_operator_test_account_cleanup_data_exports.sql', 'd4fd31d565ddefdc83d84121bf90d97c5d815356e119ae1d1e60bca50437d5c3'],
    ['supabase/SQL Scripts/20261075_operator_test_account_cleanup_data_exports_rollback.sql', '25c8e89e662e857022267aed995665b07a86f44eb56bff87aa3b3d366f2d8c1b'],
    // Finance 4b.1 (PR #447): the function 20261081 replaces and its rollback restores. Applied to prod by
    // the user 2026-10-18; TL confirmed stamp b78b4579fc6631f8 live (DE-10b.1 pre-check row 1, CR-1).
    ['supabase/migrations/20261077_operator_test_account_cleanup_boost_reversal_events.sql', 'b147d83eb21fe0424026d444a41ec7483d833b0de001882d8ce00a81124ff5aa'],
    ['supabase/SQL Scripts/20261077_operator_test_account_cleanup_boost_reversal_events_rollback.sql', '5304e26d92a95dcbc792c52a18ef3377cdb81938e1c601ade0db6cb07abf5d47'],
    // Data export DE-10b.1, as main holds it after c21a4b0f regenerated it IN PLACE (stamp 2bd40a46795e4555).
    // Applied to prod by the user 2026-10-23, then overwritten the same day by the hand-made bridge (this
    // plan with that stamp). 20261092 replaces it, and its rollback restores these bytes. Never regenerate it.
    ['supabase/migrations/20261081_operator_account_cleanup_anonymise.sql', 'e08f76aa400e964de6fa980f24507e82c4b72fb53aedbff483e6da6cf0e5c5e1'],
    ['supabase/SQL Scripts/20261081_operator_account_cleanup_anonymise_rollback.sql', 'd7ecfbeecc64c29b589655a172a4e1bdd11b068c1773e55cb350be1776c3918d'],
    // 20261092 (the meeting and abandoned-booking links, stamp ec34d5604055abfe). Confirmed live on
    // prod by TL 2026-10-25 (DL-1a schema check Q-5). DL-1a's 20261094 replaces it, and its rollback
    // restores these bytes. Never regenerate it.
    ['supabase/migrations/20261092_operator_test_account_cleanup_meeting_links.sql', 'e858e9ae1bc1e1e2a3f934cf563e2fecfadc5a682a43a9bfdec229ab3feec088'],
    ['supabase/SQL Scripts/20261092_operator_test_account_cleanup_meeting_links_rollback.sql', 'f86ef4e22c0bf2b625c771033f047a2a5e6cfc53f51ba42386f5c51ced16b43f'],
  ];

  /** Nothing pending: 20261092 is applied (confirmed 2026-10-25), so it sits in APPLIED directly. */
  const PENDING_PREVIOUS: ReadonlyArray<[string, string]> = [];

  /**
   * G-a (SA code review 2026-10-24, C-2): the generator's own target, self-pinned. A cleanup
   * migration is applied to prod before its PR merges (migration-gated, manual merge), so a target
   * on main is applied history. Pinning its bytes here is what would have caught c21a4b0f, which
   * regenerated the CURRENT target (20261081) in place. Only this slot may name MIGRATION_FILE and
   * ROLLBACK_FILE. On the next bump: move this pair to APPLIED, then pin the new target here once
   * its bytes are final. If a pin fails, put the change in a NEW dated FUNCTION_MIGRATION.
   */
  const APPLIED_TARGET: ReadonlyArray<[string, string]> = [
    // DL-1a's 20261094 (business_os_account_closures in step B), stamp 792d801e13101316.
    [MIGRATION_FILE, 'eb04be0682923bfebe093ba83b1b2c8901cd1530eb9006eb734406b8a169ea33'],
    [ROLLBACK_FILE, '9e79c08b2c55e7ed840adb34c3a36794b5689e7a50d1853b5700a2927ef119dd'],
  ];

  it.each([...APPLIED, ...PENDING_PREVIOUS, ...APPLIED_TARGET])('%s is byte-identical to what was applied', (file, sha256) => {
    expect(createHash('sha256').update(readSql(file)).digest('hex')).toBe(sha256);
  });

  it('the generator writes a newer file than every applied one, and rolls back to the previous', () => {
    const applied = [...APPLIED, ...PENDING_PREVIOUS].map(([file]) => file);
    // The target may be pinned only through its own slot (G-a), never as older history.
    expect(applied).not.toContain(MIGRATION_FILE);
    expect(applied).not.toContain(ROLLBACK_FILE);
    expect(APPLIED_TARGET.map(([file]) => file)).toEqual([MIGRATION_FILE, ROLLBACK_FILE]);
    expect(applied).toContain(PREVIOUS_MIGRATION_FILE);
    // Dated names sort by date: the new file must be later than the one it replaces.
    expect(MIGRATION_FILE > PREVIOUS_MIGRATION_FILE).toBe(true);
    for (const file of applied.filter((name) => name.startsWith('supabase/migrations/'))) {
      expect([file, MIGRATION_FILE > file]).toEqual([file, true]);
    }
  });

  /** The first line every generated function migration starts with. */
  const GENERATED_MARKER = 'GENERATED by scripts/generate-test-account-cleanup-sql.ts';

  /** Generated function migrations and their rollbacks, found by CONTENT, not by name (G-b). */
  function generatedCleanupFiles(): string[] {
    const firstLine = (file: string) => readSql(file).split('\n', 1)[0];
    const migrations = readdirSync(join(REPO, 'supabase', 'migrations'))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => `supabase/migrations/${name}`)
      .filter((file) => firstLine(file).startsWith('-- ') && firstLine(file).includes(GENERATED_MARKER));
    const generated = new Set(migrations);
    const rollbacks = readdirSync(join(REPO, 'supabase', 'SQL Scripts'))
      .filter((name) => name.endsWith('_rollback.sql'))
      .map((name) => `supabase/SQL Scripts/${name}`)
      .filter((file) => {
        const match = /^-- Rollback of (supabase\/migrations\/\S+\.sql)\./.exec(firstLine(file));
        return match !== null && generated.has(match[1]);
      });
    return [...migrations, ...rollbacks].sort();
  }

  it('G-b: every generated function migration and its rollback on disk is pinned (APPLIED or APPLIED_TARGET)', () => {
    // Matched by the first-line marker: 20261081 (operator_account_cleanup) already broke the
    // operator_test_account_cleanup name pattern, so a filename glob would miss the next one too.
    const pinned = new Set([...APPLIED, ...PENDING_PREVIOUS, ...APPLIED_TARGET].map(([file]) => file));
    const found = generatedCleanupFiles();
    // Every version from 20261041 on, each with its rollback.
    expect(found.length).toBeGreaterThanOrEqual(18);
    expect(found).toContain(MIGRATION_FILE);
    expect(found).toContain(ROLLBACK_FILE);
    expect(found.filter((file) => !pinned.has(file))).toEqual([]);
  });
});

describe('paste safety of the migration and rollback (SA C-6, R-1)', () => {
  /** [file, sql, audit inserts, receipt inserts]. */
  const SQL: ReadonlyArray<[string, string, number, number]> = [
    // The hard delete and the anonymise each write one audit row; the receipt is inserted once, after both (W-9).
    [MIGRATION_FILE, migrationSql, 2, 1],
    // The restored previous function is 20261092's: the same two audit inserts and one receipt.
    [ROLLBACK_FILE, rollbackSql, 2, 1],
  ];

  it.each(SQL)('%s has "into" only as the audit and receipt INSERT INTO keywords (W-9)', (_file, sql, audits, receipts) => {
    const audit = 'INSERT INTO public.audit_trail (';
    const receipt = `INSERT INTO ${RECEIPTS_TABLE} (`;
    expect(sql.split(audit).length - 1).toBe(audits);
    expect(sql.split(receipt).length - 1).toBe(receipts);
    expect(sql.split(audit).join('').split(receipt).join('').match(/\binto\b/gi)).toBeNull();
  });

  it.each(SQL)('%s never assigns with SELECT ... INTO (W-9)', (_file, sql) => {
    expect(sql).not.toMatch(/\bSELECT\b[^;]*?\bINTO\s+v_/i);
    expect(sql).not.toMatch(/\bINTO\s+STRICT\b/i);
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

describe('first live run fixes (2026-10-07)', () => {
  it('reviews the three links into emptied tables that blocked every account (G-18)', () => {
    const reviewed = INBOUND_FOREIGN_KEYS.map(([child, constraint, owner]) => `${child}.${constraint}.${owner}`);
    expect(reviewed).toEqual(
      expect.arrayContaining([
        'insight_hypotheses.insight_hypotheses_business_fk.user_id',
        'insight_measurements.insight_measurements_business_fk.user_id',
        'insight_measurements.insight_measurements_insight_id_fkey.user_id',
      ])
    );
    // Both tables are now deleted by the plan, child before its CASCADE parent.
    expect(position('insight_measurements')).toBeGreaterThan(-1);
    expect(position('insight_hypotheses')).toBeGreaterThan(-1);
    expect(position('insight_measurements')).toBeLessThan(position('insights'));
  });

  it('G-18 skips only counts that are zero by construction', () => {
    const shared = buildCheckQuery();
    // (a) the parent row is removed because its key column IS the target, the link
    // points at that column, and the link column is the owner column: the child
    // row names the target as owner, so it can never be another account's row.
    expect(shared).toContain(
      'plan.parent_table IS NULL AND inbound_catalog.parent_column = plan.key_column\n      AND inbound_catalog.child_column = inbound_review.owner_column AS owner_is_target'
    );
    // (b) the parent has no row this script removes (the same predicate the count
    // would use, LIMIT 1), so nothing can point at a removed row. Asked once per parent.
    expect(shared).toContain(
      "format('SELECT count(*) AS row_count FROM (SELECT 1 FROM public.%I WHERE %s LIMIT 1) AS one_row', needed.parent_table, needed.parent_predicate)"
    );
    expect(shared).toContain('SELECT DISTINCT inbound_joined.parent_ord, inbound_joined.parent_table, inbound_joined.parent_predicate');
    expect(shared).toContain('WHEN inbound_joined.owner_is_target OR inbound_parents.found = 0 THEN 0');
    expect(shared).toContain('LEFT JOIN inbound_parents USING (parent_ord)');
    // The delete reads the same guard rows, so it skips exactly the same counts.
    expect(buildDeleteBlock()).toContain('WHEN inbound_joined.owner_is_target OR inbound_parents.found = 0 THEN 0');
  });

  it('the survivor scan still covers every link to the login, counting a plan table once', () => {
    const block = buildDeleteBlock();
    const scan = block.slice(block.indexOf('v_survivors := ('), block.indexOf('IF v_survivors IS NOT NULL'));
    expect(scan).toContain("WHERE con.contype = 'f' AND con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'");
    // Only a link already counted by the plan-table half is left out: same table, same key column, keyed by user.
    expect(scan).toContain(
      "AND NOT (nsp.nspname = 'public' AND (rel.relname::text, att.attname::text) IN (SELECT plan_keys.table_name, plan_keys.key_column FROM plan_keys))"
    );
    // plan_keys is every plan table keyed by the login, and the first half counts each of them.
    expect(scan).toMatch(/\) AS plan_values\(ord, step, table_name, key_column, parent_table\)\n\s+WHERE plan_values\.parent_table IS NULL\n\s+\)/);
    expect(scan).toContain("FROM plan_keys\n      WHERE to_regclass(format('public.%I', plan_keys.table_name)) IS NOT NULL");
  });

  it('the function returns its own database time in ms, in both modes (SA C-2)', () => {
    expect(migrationSql).toContain(
      "'server_ms', (pg_catalog.date_part('epoch', pg_catalog.clock_timestamp() - pg_catalog.statement_timestamp()) * 1000)::bigint) || v_report;"
    );
    // One RETURN, after both branches, so a check and a delete both carry it.
    expect(migrationSql.match(/RETURN pg_catalog\.jsonb_build_object\(/g)).toHaveLength(1);
  });

  it('the trigger section says which events a login trigger fires on', () => {
    expect(checkSql).not.toContain("'Fires when the login is deleted.'");
    expect(checkSql).toContain("CASE WHEN (trg.tgtype::integer & 8) <> 0 THEN 'Fires when the login is deleted. Events: ' ELSE 'Does not fire on this delete. Events: ' END");
    for (const [bit, event] of [[4, 'INSERT'], [8, 'DELETE'], [16, 'UPDATE'], [32, 'TRUNCATE']] as const) {
      expect(checkSql).toContain(`CASE WHEN (trg.tgtype::integer & ${bit}) <> 0 THEN '${event}' END`);
    }
  });
});

describe('NOT NULL columns emptied by ON DELETE SET NULL (prod 23502, 2026-10-08)', () => {
  it('deletes scheduling_bookings before crm_contacts, and every measured edge child-first', () => {
    expect(NOT_NULL_OVERWRITE_EDGES.map((e) => `${e.child}.${e.column}->${e.parent}`)).toContain(
      'scheduling_bookings.contact_id->crm_contacts'
    );
    for (const edge of NOT_NULL_OVERWRITE_EDGES) {
      expect(position(edge.child)).toBeGreaterThan(-1);
      expect([edge.child, position(edge.child) < position(edge.parent)]).toEqual([edge.child, true]);
    }
  });

  it('G-19 reads the class from pg_catalog, in both files and the function, before the first DELETE', () => {
    const g19 = buildCheckQuery();
    for (const fragment of [
      "con.confdeltype IN ('n', 'd') AND con.conrelid <> con.confrelid",
      "AND att.attnotnull AND (con.confdeltype = 'n' OR NOT att.atthasdef)",
      'AND child_plan.ord > parent_plan.ord',
      'JOIN pg_catalog.pg_attribute AS att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)',
    ]) {
      expect(g19).toContain(fragment);
      expect(deleteSql).toContain(fragment);
      expect(migrationSql).toContain(fragment);
    }
    // In the delete, G-19 is part of the guard rows that raise before anything is removed.
    expect(deleteSql.indexOf("'G-19'::text AS guard")).toBeLessThan(deleteSql.indexOf("RAISE EXCEPTION 'BLOCKED, nothing was removed: %'"));
  });
});

describe('finance 4b.1: the reversal events link (PF-11, SA-Q66, SA-W105, SA-W108)', () => {
  const EDGE = "('business_os_boost_reversal_events', 'business_os_boost_reversal_events_purchase_id_fkey', NULL)";

  it('reviews the link as parent-owned, with a reason', () => {
    expect(INBOUND_FOREIGN_KEYS).toContainEqual(['business_os_boost_reversal_events', 'business_os_boost_reversal_events_purchase_id_fkey', null]);
    expect(typeof PARENT_OWNED_REASONS.business_os_boost_reversal_events).toBe('string');
  });

  it.each([
    [CHECK_FILE, checkSql],
    [DELETE_FILE, deleteSql],
    [MIGRATION_FILE, migrationSql],
  ])('%s carries the reviewed link', (_file, sql) => {
    expect(sql).toContain(EDGE);
  });

  it('adds no delete step and no static reference, so the cleanup runs with or without the table', () => {
    expect(plan.some((entry) => entry.table === 'business_os_boost_reversal_events')).toBe(false);
    expect(FUNCTION_REQUIRED_TABLES.map((r) => r.table)).not.toContain('business_os_boost_reversal_events');
    for (const sql of [checkSql, deleteSql, migrationSql]) expect(sql).not.toContain('public.business_os_boost_reversal_events');
  });

  it('20261077 is applied history (DE-10b.1 chained on it), and check 24 pins its stamp', () => {
    expect(readSql('supabase/migrations/20261077_operator_test_account_cleanup_boost_reversal_events.sql')).toContain("'version', 'b78b4579fc6631f8'");
    const check24 = readSql('scripts/check-bos-boost-reversal-events-migration.sql');
    expect(check24).toContain("position('b78b4579fc6631f8' in p.prosrc) > 0");
    const check23 = readSql('scripts/precheck-bos-boost-reversal-events.sql');
    expect(check23).toContain("position('a824848e0a538477' in p.prosrc) > 0");
    // The DE-8a plan survives the regeneration: the export jobs are still deleted.
    expect(migrationSql).toContain("'business_os_data_exports'");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Data export DE-10b.1: the anonymise modes, the receipt (workplan §7.2, C2-7)
// ════════════════════════════════════════════════════════════════════════════

describe('DE-10b.1: the hard path is unchanged (W-10)', () => {
  it('the pasted files still hold G-2, the full plan and the login delete, and the C3 money row still blocks', () => {
    for (const [, sql] of FILES) {
      expect(sql).toContain("'G-2'::text AS guard");
      expect(sql).not.toContain("'G-2a'");
      expect(sql).not.toContain('AS info');
      expect(sql).toContain("'money in flight: unpaid invoice(s) owed to this business'::text AS item");
      expect(sql).toContain("'Finish or cancel these in the app first.'::text AS clears");
    }
    expect(deleteSql).toContain('DELETE FROM auth.users WHERE id = v_user_id;');
    for (const entry of plan) expect(checkSql).toContain(`'${entry.table}'`);
  });

  it('the function still runs the hard check and delete from the same builders', () => {
    expect(migrationSql).toContain(`v_result := (\n${buildCheckJson()}\n    );`);
    expect(migrationSql).toContain(`${buildDeleteBlock()};`);
  });
});

describe('DE-10b.1: keep-set and the anonymise plan (SA §D, O-3)', () => {
  const anonymisePlan = buildCleanupPlan('anonymise');
  const hardTables = new Set(plan.map((entry) => entry.table));

  it('is exactly the reviewed list, each with a reason', () => {
    expect(KEEP_SET.map((entry) => entry.table)).toEqual([
      'business_os_billing_accounts',
      'business_os_billing_events',
      'business_os_boost_purchases',
      'business_os_boost_reversal_events',
      'business_os_credit_charges',
      'business_os_credit_lots',
      'business_os_credit_lot_draws',
      'business_os_credit_totals',
      'credit_transactions',
      'user_subscriptions',
      'billing_events',
      'processed_webhook_events',
      'marketing_consent_events',
      'marketing_consent_state',
      'business_os_account_lineage',
      'token_usage',
      'boost_pack_purchases',
      'user_rewards',
      'subscription_invoices',
    ]);
    for (const entry of KEEP_SET) expect(entry.reason.length).toBeGreaterThan(10);
  });

  it('the anonymise plan is the hard plan minus the keep-set, in the same order', () => {
    const kept = new Set(KEEP_SET.map((entry) => entry.table));
    expect(anonymisePlan.map((entry) => entry.table)).toEqual(plan.filter((entry) => !kept.has(entry.table)).map((entry) => entry.table));
    for (const entry of anonymisePlan) {
      expect(kept.has(entry.table)).toBe(false);
      expect(hardTables.has(entry.table)).toBe(true);
    }
  });

  it('deletes profiles, user_preferences, audit_trail and every invite the account issued (O-4), never the lineage row', () => {
    const tables = anonymisePlan.map((entry) => entry.table);
    for (const table of ['profiles', 'business_profiles', 'user_preferences', 'audit_trail']) expect(tables).toContain(table);
    expect(anonymisePlan.find((entry) => entry.table === 'business_os_invites')).toMatchObject({ step: 'C', column: 'issuer_account_id' });
    expect(tables).not.toContain('business_os_account_lineage');
  });

  it('every keep-set table with an owner column is in the hard plan or must be empty', () => {
    for (const entry of KEEP_SET.filter((e) => e.column !== null)) {
      expect([entry.table, hardTables.has(entry.table) || entry.table in MUST_BE_EMPTY]).toEqual([entry.table, true]);
    }
  });
});

describe('DE-10b.1: the blank list (TL SQL results, TL W-2, O-4, W-6)', () => {
  it('is exactly the reviewed (table, column, target) triples', () => {
    expect(BLANK_LIST.map((b) => `${b.table}.${b.column}=${b.target}${b.keys ? `[${b.keys.join(',')}]` : ''}@${b.key}`)).toEqual([
      'business_os_billing_accounts.action_required_invoice_url=null@user_id',
      'business_os_billing_accounts.open_checkout_session_id=null@user_id',
      'business_os_boost_purchases.receipt_url=null@user_id',
      'business_os_credit_lots.reason=null@user_id',
      'business_os_credit_lot_draws.reason=null@user_id',
      'user_subscriptions.payment_method_last4=null@user_id',
      'user_subscriptions.payment_method_brand=null@user_id',
      'user_subscriptions.last_calculator_inputs=null@user_id',
      'credit_transactions.description=null@user_id',
      'credit_transactions.metadata=strip[agent_name]@user_id',
      'billing_events.payload=empty_object@user_id',
      'billing_events.error_message=null@user_id',
      'token_usage.error_message=null@user_id',
      'token_usage.request_payload=null@user_id',
      'token_usage.response_metadata=null@user_id',
      'token_usage.metadata=strip[user_goal,user_role,user_mode,agent_name]@user_id',
      'subscription_invoices.stripe_invoice_pdf=null@user_id',
      'subscription_invoices.stripe_hosted_invoice_url=null@user_id',
      'subscription_invoices.metadata=empty_object@user_id',
      'user_rewards.metadata=empty_object@user_id',
      'business_os_invites.email=placeholder@invite_redeemer',
      'business_os_invites.personal_note=null@invite_redeemer',
      'business_os_invites.email_problem_detail=null@invite_redeemer',
      'business_os_invites.redemption_error_message=null@invite_redeemer',
    ]);
    for (const blank of BLANK_LIST) expect(blank.reason.length).toBeGreaterThan(5);
  });

  it('blanks only kept rows: every table is in the keep-set, or is the invites table keyed on the redeemer', () => {
    const kept = new Set(KEEP_SET.map((entry) => entry.table));
    for (const blank of BLANK_LIST) {
      if (blank.key === 'invite_redeemer') expect(blank.table).toBe('business_os_invites');
      else expect([blank.table, kept.has(blank.table)]).toEqual([blank.table, true]);
    }
  });

  it('the jsonb columns with a {} default are never set to NULL (SQL-W1)', () => {
    for (const column of ['billing_events.payload', 'credit_transactions.metadata', 'subscription_invoices.metadata', 'user_rewards.metadata']) {
      const blank = BLANK_LIST.find((b) => `${b.table}.${b.column}` === column);
      expect([column, blank?.target === 'null']).toEqual([column, false]);
    }
  });

  it('the invite blanks leave the issuer data alone (O-4)', () => {
    const invite = BLANK_LIST.filter((b) => b.table === 'business_os_invites').map((b) => b.column);
    for (const issuer of ['inviter_display_name', 'inviter_reply_to', 'internal_reason']) expect(invite).not.toContain(issuer);
  });

  const block = buildAnonymiseBlock();

  it('each blank runs behind a column-exists guard (G-11), with the jsonb type where it matters', () => {
    expect(migrationSql).toContain("'A column the anonymise blanks, or the column it finds the rows by, is missing or is not jsonb where it must be.");
    expect(migrationSql).toContain("AND (NOT blank_state.needs_jsonb OR cols.data_type = 'jsonb')");
    expect(migrationSql).toContain('cols.column_name::text = ANY (blank_state.key_columns)');
    for (const blank of BLANK_LIST) expect(migrationSql).toMatch(new RegExp(`'${blank.table}'(::text)?, '${blank.column}'`));
  });

  it('re-reads every blanked column after the loop and rolls back on a value left', () => {
    const loop = block.indexOf('FOR v_blank IN');
    const reread = block.indexOf("RAISE EXCEPTION 'A blanked value is still there, so everything was rolled back: %', v_survivors;");
    expect(loop).toBeGreaterThan(0);
    expect(reread).toBeGreaterThan(loop);
    expect(block).toContain(
      "EXECUTE format('UPDATE public.%I SET %I = %s WHERE %s AND %s', v_blank.table_name, v_blank.column_name, v_blank.set_sql, v_blank.key_sql, v_blank.still_sql);"
    );
    expect(block).toContain(
      "format('SELECT count(*) AS row_count FROM public.%I WHERE %s AND %s', left_over.table_name, left_over.key_sql, left_over.still_sql)"
    );
    // The invites of another account are found by the subject id only, never by a caller-supplied id (W-6).
    expect(block).toContain("WHEN 'invite_redeemer' THEN format('(redeemed_account_id = %L OR claimed_account_id = %L)', v_user_id, v_user_id)");
  });
});

describe('DE-10b.1: guards in the anonymise modes (workplan §3.2)', () => {
  const anonCheck = buildCheckJson('anonymise');
  /** The first line of the guard row with this id and item. */
  const rowOf = (id: string, item: string) => {
    const from = anonCheck.indexOf(`'${id}'::text AS guard, '${item}'::text AS item`);
    expect([id, item, from]).not.toEqual([id, item, -1]);
    const row = anonCheck.slice(from);
    return row.slice(0, row.indexOf('\n'));
  };

  it('G-2a replaces G-2, and the tag is never read', () => {
    expect(anonCheck).toContain("'G-2a'::text AS guard");
    expect(anonCheck).not.toContain("'G-2'::text AS guard");
    expect(anonCheck).not.toContain('strpos(params.target_email, params.test_tag)');
    expect(anonCheck).toContain('CASE WHEN target.user_id IS NOT NULL AND target.user_id = params.subject_id THEN 1 ELSE 0 END');
    expect(anonCheck).toContain("NULLIF(current_setting('cleanup.subject_id', true), '')::uuid AS subject_id");
    expect(buildCheckJson()).not.toContain('G-2a');
    // The tag is only ever set in the hard modes (F-1).
    expect(migrationSql).toContain(
      "PERFORM pg_catalog.set_config('cleanup.test_tag', CASE WHEN p_mode IN ('check', 'delete') THEN coalesce(p_tag, '') ELSE '' END, true);"
    );
  });

  it.each([
    ['G-5', 'nothing ever ran in Stripe live mode'],
    ['G-7', 'legacy subscription with a Stripe id'],
    ['G-7', 'legacy credit payment with a Stripe id'],
    ['G-7', 'legacy billing event from Stripe'],
    ['G-9', 'money in flight: unpaid invoice(s) owed to this business'],
    ['G-14', 'no consent ledger rows'],
    ['G-15', 'nobody else hangs below it in the invitation circle'],
  ])('%s %s is info: never blocks, reported when found', (id, item) => {
    expect(rowOf(id, item)).toMatch(/\(false\) AS blocked, '[^']*'::text AS clears, \(counted\.found > 0\) AS info$/);
  });

  it.each([
    ['G-4', 'not a platform admin'],
    ['G-6', 'no live plan subscription, test or live mode'],
    ['G-8', 'no Stripe account connected for client payments'],
    ['G-9', 'money in flight: recurring payment plan(s) still running'],
    ['G-9', 'money in flight: payment(s) still pending'],
    ['G-9', 'money in flight: refund(s) still in flight'],
    ['G-12', 'no stored files under the account folder'],
  ])('%s %s still blocks (TL-6)', (id, item) => {
    expect(rowOf(id, item)).toMatch(/\(counted\.found > 0\) AS blocked, '[^']*'::text AS clears, \(false\) AS info$/);
  });

  it('reports info rows apart from BLOCKED, and sorts G-2a by its number', () => {
    expect(anonCheck).toContain("CASE WHEN guard_rows.blocked THEN 'BLOCKED' WHEN guard_rows.info AND guard_rows.found > 0 THEN 'info' ELSE 'ok' END");
    expect(anonCheck).toContain("substring(guard_rows.guard FROM '[0-9]+')::integer");
  });

  it('G-20: auth columns, closure key columns, unreviewed links, user_id tables, must-be-empty rows and privileges', () => {
    for (const fragment of [
      "'A table of the auth schema the closure relies on is missing.",
      "'A column the closure writes or reads is missing.",
      "con.confrelid IN (SELECT to_regclass('auth.users') UNION ALL SELECT to_regclass('auth.sessions'))",
      "WHERE cols.table_schema = 'auth' AND cols.column_name = 'user_id' AND cols.table_name::text NOT IN (",
      "'A row of the auth schema that must not exist names the login.",
      "AND NOT pg_catalog.has_table_privilege(format('auth.%I', needed.table_name), needed.privilege_name)",
    ]) {
      expect(anonCheck).toContain(fragment);
    }
    for (const closure of AUTH_USERS_CLOSURE) expect(anonCheck).toMatch(new RegExp(`\\('users'(::text)?, '${closure.column}'(::text)?\\)`));
    expect(anonCheck).toContain("('audit_log_entries', 'payload')");
    for (const closure of AUTH_CLOSURE) expect(anonCheck).toContain(`'${closure.table}'`);
  });

  it('G-21: update triggers on auth.users, the blanked tables and the invites, allow-listed by name', () => {
    expect(REVIEWED_UPDATE_TRIGGERS.map((t) => `${t.table}.${t.trigger}`)).toEqual([
      'token_usage.update_token_usage_updated_at',
      'user_subscriptions.trigger_update_user_subscriptions_updated_at',
    ]);
    expect(blankedTables()).toContain('business_os_invites');
    expect(anonCheck).toContain('WHERE NOT trg.tgisinternal AND (trg.tgtype::integer & 16) <> 0');
    expect(anonCheck).toContain("(nsp.nspname = 'auth' AND rel.relname = 'users')");
    for (const table of blankedTables()) expect(anonCheck).toContain(`'${table}'`);
  });

  it('G-22: any link from a kept table to an anonymise-plan table blocks, except the two reviewed SET NULL ones', () => {
    expect(REVIEWED_KEPT_LINKS.map((l) => l.constraint)).toEqual([
      'marketing_consent_events_contact_id_fkey',
      'marketing_consent_state_contact_id_fkey',
    ]);
    expect(anonCheck).toContain('AND parent_rel.relname::text IN (SELECT plan.table_name FROM plan)');
    expect(anonCheck).toContain("OR con.confdeltype <> 'n' OR att.attnotnull OR cardinality(con.conkey) <> 1");
  });

  it('every anonymise guard row carries the info column, so the UNION has one shape', () => {
    const rows = anonCheck.slice(anonCheck.indexOf('guard_rows AS ('), anonCheck.indexOf('removal AS ('));
    for (const select of rows.split('\n  UNION ALL\n  ')) {
      expect([select.slice(0, 50), /AS info\b/.test(select)]).toEqual([select.slice(0, 50), true]);
    }
  });
});

describe('DE-10b.1: the login closure (SA §D, O-5, O-6, O-7, W-4, W-11)', () => {
  const block = buildAnonymiseBlock();
  const update = block.slice(block.indexOf('UPDATE auth.users SET'), block.indexOf('WHERE id = v_user_id;'));

  it('sets exactly the reviewed auth.users columns, tokens to empty strings, never NULL', () => {
    expect(AUTH_USERS_CLOSURE.map((c) => c.column)).toEqual([
      'email', 'phone', 'encrypted_password', 'raw_user_meta_data', 'raw_app_meta_data', 'banned_until',
      'confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current',
      'phone_change_token', 'reauthentication_token', 'email_change', 'phone_change',
    ]);
    const set = update.split('\n').map((line) => line.trim().replace(/,$/, '')).filter((line) => line.includes(' = '));
    expect(set.map((line) => line.split(' = ')[0])).toEqual(AUTH_USERS_CLOSURE.map((c) => c.column));
    for (const column of ['encrypted_password', 'confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change_token_current', 'phone_change_token', 'reauthentication_token', 'email_change', 'phone_change']) {
      expect(set).toContain(`${column} = ''`);
    }
    expect(set).toContain('phone = NULL');
    expect(set.filter((line) => line.endsWith('= NULL'))).toEqual(['phone = NULL']);
    expect(set).toContain(`banned_until = now() + interval '${CLOSED_BAN_INTERVAL}'`);
    expect(CLOSED_BAN_INTERVAL).toBe('100 years');
    expect(block).not.toMatch(/infinity/i);
    expect(block).not.toContain('deleted_at');
    expect(set).toContain(
      "raw_app_meta_data = pg_catalog.jsonb_build_object('provider', 'email', 'providers', pg_catalog.jsonb_build_array('email'), 'deleted', true)"
    );
    expect(block).toContain(`v_placeholder := 'deleted-' || v_receipt_ref || '@' || '${CLOSED_EMAIL_DOMAIN}';`);
    expect(block).toContain("v_receipt_ref := substr(replace(v_receipt_id::text, '-', ''), 1, 12);");
  });

  it('deletes the full closure list, and only the auth tables on it; never the login', () => {
    expect(AUTH_CLOSURE.map((c) => `${c.table}:${c.action}`)).toEqual([
      'identities:delete', 'sessions:delete', 'refresh_tokens:delete', 'mfa_amr_claims:via_sessions', 'mfa_factors:delete',
      'mfa_challenges:via_factors', 'mfa_recovery_code_sets:delete', 'one_time_tokens:delete', 'oauth_authorizations:delete',
      'oauth_consents:delete', 'webauthn_credentials:delete', 'webauthn_challenges:delete', 'flow_state:delete', 'scim_users:must_be_empty',
    ]);
    expect(block).toContain("EXECUTE format('DELETE FROM auth.%I WHERE %I = %L', v_auth.table_name, v_auth.key_column, v_user_id);");
    expect(block).toContain("WHERE closure.action = 'delete' AND to_regclass(format('auth.%I', closure.table_name)) IS NOT NULL");
    expect(block).not.toMatch(/DELETE FROM auth\.users/);
  });

  it('deletes the subject auth-log rows by id, target id, actor email and target email, all as text (W-4)', () => {
    const predicate = authLogPredicate('log_rows');
    for (const fragment of [
      "(log_rows.payload::jsonb ->> 'actor_id') = v_user_id::text",
      "(log_rows.payload::jsonb -> 'traits' ->> 'user_id') = v_user_id::text",
      "lower(log_rows.payload::jsonb ->> 'actor_username') = v_email",
      "lower(log_rows.payload::jsonb -> 'traits' ->> 'user_email') = v_email",
    ]) {
      expect(predicate).toContain(fragment);
    }
    expect(block).toContain(`DELETE FROM auth.audit_log_entries AS log_rows\n  WHERE ${predicate};`);
    // The survivor scan re-runs the same predicate and expects zero.
    expect(block.split(predicate).length - 1).toBe(2);
  });

  it('the survivor scan covers the closed login, plan tables, links outside the keep-set, the closure, its cascades and the auth log (W-11)', () => {
    const scan = block.slice(block.lastIndexOf('v_survivors := ('), block.indexOf("RAISE EXCEPTION 'Something still names the login"));
    expect(scan).toContain("users.id = v_user_id AND users.email = v_placeholder AND users.phone IS NULL AND users.encrypted_password = ''");
    expect(scan).toContain("users.banned_until > now() + interval '99 years'");
    expect(scan).toContain("con.confrelid = 'auth.users'::regclass AND nsp.nspname <> 'auth'");
    expect(scan).toContain("AND NOT (nsp.nspname = 'public' AND rel.relname::text IN (");
    for (const entry of KEEP_SET) expect(scan).toContain(`'${entry.table}'`);
    expect(scan).toContain("WHERE closure.action IN ('via_sessions', 'via_factors')");
    expect(scan).toContain("CASE WHEN closure.action = 'via_sessions' THEN v_session_ids ELSE v_factor_ids END");
    expect(scan).toContain("'mfa_challenges'");
    expect(scan).toContain("'flow_state'");
    expect(scan).toContain("SELECT 'auth.audit_log_entries'::text");
    // The session and factor ids are captured BEFORE the closure deletes them.
    expect(block.indexOf('v_session_ids := ARRAY(')).toBeLessThan(block.indexOf('UPDATE auth.users SET'));
  });
});

describe('DE-10b.1: order inside the anonymise (workplan §7.2)', () => {
  const fn = migrationSql.slice(migrationSql.indexOf('CREATE OR REPLACE FUNCTION'), migrationSql.indexOf('$operator_cleanup$;'));
  const block = buildAnonymiseBlock();

  it('G-3 and every guard, then the plan, blanks, closure, auth log, survivor scan, audit row; the receipt last', () => {
    const steps = [
      "RAISE EXCEPTION 'G-3 the confirmation does not equal the email. Nothing was removed.';",
      "RAISE EXCEPTION 'BLOCKED, nothing was removed: %', v_blockers;",
      "EXECUTE format('DELETE FROM public.%I WHERE %I = %L', v_step.table_name",
      'FOR v_blank IN',
      'UPDATE auth.users SET',
      "EXECUTE format('DELETE FROM auth.%I WHERE",
      'DELETE FROM auth.audit_log_entries AS log_rows',
      "RAISE EXCEPTION 'Something still names the login after the anonymise",
      'INSERT INTO public.audit_trail (',
    ];
    const at = steps.map((step) => block.indexOf(step));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(migrationSql).toContain(`${block};`);
    const receipt = fn.indexOf(`INSERT INTO ${RECEIPTS_TABLE} (`);
    expect(receipt).toBeGreaterThan(fn.indexOf(block));
    expect(receipt).toBeGreaterThan(fn.indexOf(buildDeleteReportJson()));
    expect(receipt).toBeLessThan(fn.indexOf('RETURN pg_catalog.jsonb_build_object('));
  });

  it('the anonymise block is the function alone: never in a pasted file', () => {
    for (const [, sql] of FILES) {
      expect(sql).not.toContain('UPDATE auth.users');
      expect(sql).not.toContain(ANONYMISE_AUDIT_ACTION);
    }
  });
});

describe('DE-10b.1: entry rules and receipt trust (§3.1, W-7)', () => {
  const head = migrationSql.slice(migrationSql.indexOf('CREATE OR REPLACE FUNCTION'), migrationSql.indexOf("IF p_mode = 'check' THEN\n    v_result"));

  it.each([
    ["p_mode NOT IN ('check', 'delete', 'anonymise_check', 'anonymise')", 'unknown mode'],
    ["IF p_mode = 'delete' AND p_actor IS NULL THEN", 'a delete needs the admin id'],
    ["IF p_mode IN ('delete', 'anonymise') AND (p_receipt IS NULL OR pg_catalog.jsonb_typeof(p_receipt) IS DISTINCT FROM 'object') THEN", 'a delete needs the receipt'],
    ["IF p_mode IN ('anonymise_check', 'anonymise') AND p_subject IS NULL THEN", 'an anonymise needs the account id'],
    ["IF p_mode = 'anonymise' AND p_actor IS NULL AND (p_receipt ->> 'origin') IS DISTINCT FROM 'owner' THEN", 'an anonymise needs the admin id unless the owner asked'],
    ["IF ((p_receipt ->> 'origin') = 'owner') IS DISTINCT FROM ((p_receipt ->> 'executor_kind') = 'self_service') THEN", 'the receipt origin and executor disagree'],
    ["IF (p_receipt ->> 'origin') = 'owner' AND p_actor IS NOT NULL THEN", 'an owner deletion has no admin id'],
    ["IF p_mode = 'delete' AND (p_receipt ->> 'origin') <> 'admin' THEN", 'a full delete is for admins only'],
  ])('%s raises "%s" (22023), after the secret check', (condition, message) => {
    const at = head.indexOf(condition);
    expect(at).toBeGreaterThan(head.indexOf("RAISE EXCEPTION 'not authorised' USING ERRCODE = '42501'"));
    expect(head.slice(at)).toContain(`RAISE EXCEPTION '${message}' USING ERRCODE = '22023';`);
  });

  it('the function computes id, status, mode, reference, totals and completed_at itself, and ignores those keys in p_receipt', () => {
    const insert = migrationSql.slice(migrationSql.indexOf(`INSERT INTO ${RECEIPTS_TABLE} (`), migrationSql.indexOf('RETURN pg_catalog.jsonb_build_object('));
    expect(insert).toContain(`INSERT INTO ${RECEIPTS_TABLE} (${RECEIPT_COLUMNS.join(', ')})`);
    expect(insert).toContain("v_receipt_id, 'completed', v_receipt_mode, v_subject_id, v_receipt_ref,");
    expect(insert).toContain('v_removed_rows, v_blanked_rows,');
    expect(insert).toContain(', now(), ');
    // executor_admin_id is p_actor, never a key of the receipt.
    expect(insert).toContain("(p_receipt ->> 'executor_kind'), p_actor,");
    const read = [...insert.matchAll(/p_receipt ->> '([a-z_]+)'/g)].map((m) => m[1]);
    expect([...new Set(read)].sort()).toEqual([...RECEIPT_INPUT_KEYS].sort());
    for (const computed of ['id', 'status', 'mode', 'placeholder_ref', 'rows_removed', 'rows_blanked', 'tables_removed', 'completed_at', 'executor_admin_id', 'subject_user_id']) {
      expect(read).not.toContain(computed);
    }
  });

  it('the hard delete takes its receipt totals from its own audit row, and refuses without one', () => {
    expect(migrationSql).toContain(`WHERE audit.action = '${AUDIT_ACTION}' AND audit.entity_id = v_subject_id::text AND audit.created_at = now()`);
    expect(migrationSql).toContain("RAISE EXCEPTION 'The removal left no audit row to take the receipt totals from, so everything was rolled back.';");
    expect(migrationSql).toContain("v_receipt_mode := 'full_delete';");
  });

  it('every required table is guarded, the receipts table by its own migration (C2-4)', () => {
    expect(FUNCTION_REQUIRED_TABLES.find((r) => r.table === 'business_os_deletion_receipts')?.migration).toBe('20261080_business_os_deletion_receipts');
  });
});

describe('DE-10b.1: the anonymise audit row (O-8, F-2, TQ-19)', () => {
  const block = buildAnonymiseBlock();

  it('uses a registered event whose severity and flags match the SQL', () => {
    expect(AUDIT_EVENTS.ACCOUNT_PSEUDONYMISED).toBe(ANONYMISE_AUDIT_ACTION);
    const meta = EVENT_METADATA[AUDIT_EVENTS.ACCOUNT_PSEUDONYMISED];
    expect(meta.severity).toBe(ANONYMISE_AUDIT_SEVERITY);
    expect([...(meta.complianceFlags ?? [])]).toEqual([...ANONYMISE_AUDIT_COMPLIANCE_FLAGS]);
  });

  it('names the admin for an admin run and NULL for an owner run (the owner login is closed), never an email', () => {
    expect(block).toContain(`'${ANONYMISE_AUDIT_ACTION}', 'user', v_user_id::text, NULL,\n    ${ACTOR}, ${ACTOR},`);
    // actor_id is '' unless the mode is delete or anonymise, and p_actor is NULL for an owner (entry rule).
    expect(migrationSql).toContain("IF (p_receipt ->> 'origin') = 'owner' AND p_actor IS NOT NULL THEN");
    const details = block.slice(block.indexOf("jsonb_build_object('source'"), block.indexOf(`'${ANONYMISE_AUDIT_SEVERITY}', ARRAY[`));
    expect(details).not.toMatch(/email|reason|note|fingerprint/i);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 20261092: the links of abandoned_bookings and scheduling_meetings (G-18)
// ════════════════════════════════════════════════════════════════════════════

describe('20261092: the meeting and abandoned-booking links are reviewed (G-18)', () => {
  /** The eight links c21a4b0f left out. TL verified each on prod; every one is owned by its row user_id. */
  const MEETING_LINKS: ReadonlyArray<readonly [string, string, string]> = [
    ['abandoned_bookings', 'abandoned_bookings_booking_id_fkey', 'user_id'],
    ['abandoned_bookings', 'abandoned_bookings_business_fk', 'user_id'],
    ['abandoned_bookings', 'abandoned_bookings_service_id_fkey', 'user_id'],
    ['email_sends', 'email_sends_booking_id_fkey', 'user_id'],
    ['email_sends', 'email_sends_meeting_id_fkey', 'user_id'],
    ['payment_plan_installments', 'payment_plan_installments_meeting_id_fkey', 'user_id'],
    ['scheduling_meetings', 'scheduling_meetings_booking_id_fkey', 'user_id'],
    ['scheduling_meetings', 'scheduling_meetings_business_fk', 'user_id'],
  ];
  /** The stamp of 20261081 as applied, and of the 2026-10-23 bridge that kept it. */
  const APPLIED_81_STAMP = '2bd40a46795e4555';
  /**
   * SA W-8 (DL-1a): every reference that moves with the generator is a literal here, because
   * CLEANUP_FUNCTION_VERSION, migrationSql, rollbackSql and previousMigrationSql now mean 20261094.
   */
  const STAMP_92 = 'ec34d5604055abfe';
  const MIGRATION_92 = readSql('supabase/migrations/20261092_operator_test_account_cleanup_meeting_links.sql');
  const ROLLBACK_92 = readSql('supabase/SQL Scripts/20261092_operator_test_account_cleanup_meeting_links_rollback.sql');
  const PREVIOUS_81 = readSql('supabase/migrations/20261081_operator_account_cleanup_anonymise.sql');

  it.each(MEETING_LINKS)('%s.%s is reviewed, owned by %s', (table, constraint, owner) => {
    expect(INBOUND_FOREIGN_KEYS).toContainEqual([table, constraint, owner]);
    for (const sql of [checkSql, deleteSql, MIGRATION_92, migrationSql]) expect(sql).toContain(`'${constraint}'`);
  });

  it('both tables are in the plan this fix completes', () => {
    expect(position('abandoned_bookings')).toBeGreaterThanOrEqual(0);
    expect(position('scheduling_meetings')).toBeGreaterThanOrEqual(0);
  });

  it('chains on 20261081 as applied: its stamp, without the links, and the rollback restores exactly that', () => {
    expect(MIGRATION_92).toContain('restores the function of 20261081_operator_account_cleanup_anonymise');
    expect(MIGRATION_92).toContain(`'version', '${STAMP_92}'`);
    expect(PREVIOUS_81).toContain(`'version', '${APPLIED_81_STAMP}'`);
    for (const [, constraint] of MEETING_LINKS) {
      expect([constraint, PREVIOUS_81.includes(`'${constraint}'`)]).toEqual([constraint, false]);
    }
    expect(ROLLBACK_92).toContain(`'version', '${APPLIED_81_STAMP}'`);
    // A new stamp: the deployed build must change with the function, and the bridge stamp never returns from here.
    expect(STAMP_92).not.toBe(APPLIED_81_STAMP);
    expect(MIGRATION_92).not.toContain(APPLIED_81_STAMP);
  });

  it('keeps the 8-argument signature, and still drops only the retired 6-argument one', () => {
    expect(PREVIOUS_FUNCTION_SIGNATURE).toBe(FUNCTION_SIGNATURE);
    expect(RETIRED_FUNCTION_SIGNATURE).toBe('public.operator_test_account_cleanup(text, text, text, text, uuid, text)');
    expect(MIGRATION_92.match(/^DROP FUNCTION .*$/gm)).toEqual([`DROP FUNCTION IF EXISTS ${RETIRED_FUNCTION_SIGNATURE};`]);
    expect(ROLLBACK_92.match(/^DROP FUNCTION .*$/gm)).toEqual([`DROP FUNCTION IF EXISTS ${FUNCTION_SIGNATURE};`]);
  });

  const PRECHECK_92 = readSql('scripts/precheck-test-account-cleanup-meeting-links.sql');
  const CHECKER_92 = readSql('scripts/check-test-account-cleanup-meeting-links-migration.sql');

  it('the pre-check requires the 20261081 stamp live and this stamp absent; the checker requires this build stamp', () => {
    // C-3: absent, so the NOT EXISTS form exactly. A bare position() match would pass inside EXISTS too.
    expect(PRECHECK_92).toContain(
      `NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('${STAMP_92}' in p.prosrc) > 0)`
    );
    expect(PRECHECK_92).not.toMatch(new RegExp(`(?<!NOT )EXISTS \\(SELECT 1 FROM pg_catalog\\.pg_proc AS p WHERE p\\.oid = \\(SELECT fn\\.oid FROM fn\\) AND position\\('${STAMP_92}'`));
    expect(PRECHECK_92).toContain(
      `  SELECT 2, 'its body holds the 20261081 stamp 2bd40a46795e4555, the one the deployed build pins',\n    EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('${APPLIED_81_STAMP}' in p.prosrc) > 0)`
    );
    expect(CHECKER_92).toContain(`AND position('${STAMP_92}' in p.prosrc) > 0)
  UNION ALL`);
    expect(CHECKER_92).toContain(`NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('${APPLIED_81_STAMP}' in p.prosrc) > 0)`);
    for (const sql of [PRECHECK_92, CHECKER_92]) {
      expect(sql).toContain(`pg_catalog.to_regprocedure('${FUNCTION_SIGNATURE}')`);
      expect(sql).toContain(`pg_catalog.to_regprocedure('${RETIRED_FUNCTION_SIGNATURE}') IS NULL`);
      for (const [, constraint] of MEETING_LINKS) expect(sql).toContain(`'${constraint}'`);
    }
  });

  it('the checker information row carries the md5 of the committed function body (SA optional)', () => {
    const tag = '$operator_cleanup$';
    const start = MIGRATION_92.indexOf(tag) + tag.length;
    const body = MIGRATION_92.slice(start, MIGRATION_92.indexOf(tag, start));
    const md5 = createHash('md5').update(body).digest('hex');
    expect(CHECKER_92).toContain(`AND pg_catalog.md5(p.prosrc) = '${md5}')`);
    expect(CHECKER_92).toContain(`'information only. md5 of the body is ${md5}, the committed 20261092 body'`);
  });

  it.each([
    ['pre-check', PRECHECK_92],
    ['checker', CHECKER_92],
  ])('the %s is read-only and paste-safe', (_name, sql) => {
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|DO|BEGIN)\b/im);
    expect(sql).not.toMatch(/\bset_config\(/i);
    expect(sql.match(/\binto\b/gi)).toBeNull();
    expect(scan(sql).unterminated).toBe(false);
    for (const token of scan(sql).tokens) {
      if (token.kind === 'comment') expect(token.text).not.toMatch(/[;']/);
      else expect(token.text).not.toMatch(/;|--/);
    }
    expect(sql.trimEnd().endsWith('ORDER BY checks.ord;')).toBe(true);
    expect(sql.split(';').length - 1).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 20261094: the deletion request of the account (DL-1a, XC-1, SA O-2, O-3, W-8)
// ════════════════════════════════════════════════════════════════════════════

describe('20261094: business_os_account_closures joins step B (DL-1a)', () => {
  /** The stamp of 20261092 as applied (DL-1a TL Q-5), literal so it never moves with the generator. */
  const STAMP_92 = 'ec34d5604055abfe';
  const CLOSURES = 'business_os_account_closures';
  const MIGRATION_94 = readSql('supabase/migrations/20261094_operator_test_account_cleanup_account_closures.sql');
  const ROLLBACK_94 = readSql('supabase/SQL Scripts/20261094_operator_test_account_cleanup_account_closures_rollback.sql');
  const MIGRATION_92 = readSql('supabase/migrations/20261092_operator_test_account_cleanup_meeting_links.sql');

  it('is the generator target and chains on 20261092', () => {
    expect(MIGRATION_FILE).toBe('supabase/migrations/20261094_operator_test_account_cleanup_account_closures.sql');
    expect(PREVIOUS_MIGRATION_FILE).toBe('supabase/migrations/20261092_operator_test_account_cleanup_meeting_links.sql');
    expect(MIGRATION_94).toBe(migrationSql);
    expect(ROLLBACK_94).toBe(rollbackSql);
    expect(MIGRATION_92).toContain(`'version', '${STAMP_92}'`);
    expect(ROLLBACK_94).toContain(`'version', '${STAMP_92}'`);
    expect(ROLLBACK_94).toContain(`\n${previousFunctionSql(MIGRATION_92)};\n`);
  });

  it('has a new stamp, never the 20261092 one', () => {
    expect(CLEANUP_FUNCTION_VERSION).not.toBe(STAMP_92);
    expect(MIGRATION_94).toContain(`'version', '${CLEANUP_FUNCTION_VERSION}'`);
    expect(MIGRATION_94).not.toContain(STAMP_92);
    expect(MIGRATION_92).not.toContain(`'${CLOSURES}'`);
  });

  it('removes the closure row in step B of both modes, and never keeps it (not in KEEP_SET)', () => {
    expect(FULL_REMOVAL_EXTRAS.map((entry) => entry.table)).toContain(CLOSURES);
    expect(KEEP_SET.map((entry) => entry.table)).not.toContain(CLOSURES);
    for (const mode of ['hard', 'anonymise'] as const) {
      const entry = buildCleanupPlan(mode).find((e) => e.table === CLOSURES);
      expect([mode, entry]).toEqual([mode, { step: 'B', table: CLOSURES, column: 'user_id', parent: null }]);
    }
    for (const sql of [checkSql, deleteSql, MIGRATION_94]) expect(sql).toContain(`'B', '${CLOSURES}', 'user_id', NULL)`);
  });

  it('its link to the login is a tenancy key the plan knows, so G-10 accepts it once this is live (SA F-A)', () => {
    for (const sql of [checkSql, deleteSql, MIGRATION_94]) expect(sql).toContain(`('public', '${CLOSURES}', 'user_id', 'tenancy', NULL)`);
  });

  it('is a user-scoped never descriptor, so a business Reset or Purge never removes it (SA O-2)', () => {
    const descriptor = PURGE_DESCRIPTORS.find((d) => d.table === CLOSURES);
    expect(descriptor?.level).toBe('never');
    expect(descriptor?.scope).toEqual({ kind: 'user_id' });
    for (const level of ['reset', 'purge'] as const) {
      expect(descriptorsForRun(level, { integrations: true, agents: true, activityHistory: true }).map((d) => d.table)).not.toContain(CLOSURES);
    }
  });

  it('does not require the table at apply time (SA O-3): step B names it only as a literal, skipped while absent', () => {
    expect(FUNCTION_REQUIRED_TABLES.map((entry) => entry.table)).not.toContain(CLOSURES);
    expect(MIGRATION_94).not.toContain(`pg_catalog.to_regclass('public.${CLOSURES}') IS NULL`);
  });

  const CHECKER_94 = readSql('scripts/check-test-account-cleanup-account-closures-migration.sql');
  const PRECHECK = readSql('scripts/precheck-account-closures.sql');

  it('the pre-check requires the 20261092 stamp live and this stamp absent; the checker requires this stamp and the table', () => {
    expect(PRECHECK).toContain(
      `EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('${STAMP_92}' in p.prosrc) > 0)`
    );
    expect(PRECHECK).toContain(
      `NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('${CLEANUP_FUNCTION_VERSION}' in p.prosrc) > 0)`
    );
    expect(PRECHECK).not.toMatch(new RegExp(`(?<!NOT )EXISTS \\(SELECT 1 FROM pg_catalog\\.pg_proc AS p WHERE p\\.oid = \\(SELECT fn\\.oid FROM fn\\) AND position\\('${CLEANUP_FUNCTION_VERSION}'`));
    expect(CHECKER_94).toContain(`AND position('${CLEANUP_FUNCTION_VERSION}' in p.prosrc) > 0)\n  UNION ALL`);
    expect(CHECKER_94).toContain(`NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc AS p WHERE p.oid = (SELECT fn.oid FROM fn) AND position('${STAMP_92}' in p.prosrc) > 0)`);
    expect(CHECKER_94).toContain(`position(pg_catalog.quote_literal('${CLOSURES}') in p.prosrc) > 0)`);
    expect(CHECKER_94).toContain(`pg_catalog.to_regclass('public.${CLOSURES}') IS NOT NULL`);
    for (const sql of [PRECHECK, CHECKER_94]) {
      expect(sql).toContain(`pg_catalog.to_regprocedure('${FUNCTION_SIGNATURE}')`);
      expect(sql).toContain(`pg_catalog.to_regprocedure('${RETIRED_FUNCTION_SIGNATURE}') IS NULL`);
    }
  });

  it('the checker information row carries the md5 of the committed function body', () => {
    const tag = '$operator_cleanup$';
    const start = MIGRATION_94.indexOf(tag) + tag.length;
    const body = MIGRATION_94.slice(start, MIGRATION_94.indexOf(tag, start));
    const md5 = createHash('md5').update(body).digest('hex');
    expect(CHECKER_94).toContain(`AND pg_catalog.md5(p.prosrc) = '${md5}')`);
    expect(CHECKER_94).toContain(`'information only. md5 of the body is ${md5}, the committed 20261094 body'`);
  });

  it.each([
    ['pre-check', PRECHECK],
    ['checker', CHECKER_94],
  ])('the %s is read-only and paste-safe', (_name, sql) => {
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|DO|BEGIN)\b/im);
    expect(sql).not.toMatch(/\bset_config\(/i);
    expect(sql.match(/\binto\b/gi)).toBeNull();
    expect(scan(sql).unterminated).toBe(false);
    for (const token of scan(sql).tokens) {
      if (token.kind === 'comment') expect(token.text).not.toMatch(/[;']/);
      else expect(token.text).not.toMatch(/;|--/);
    }
    expect(sql.trimEnd().endsWith('ORDER BY checks.ord;')).toBe(true);
    expect(sql.split(';').length - 1).toBe(1);
  });
});

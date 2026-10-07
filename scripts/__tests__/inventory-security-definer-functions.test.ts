/**
 * Guard over scripts/inventory-security-definer-functions.sql — the read-only
 * inventory of every SECURITY DEFINER function in `public` and who can execute
 * it (PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md §10, the queued P1).
 *
 * WHY A TEST OVER SQL TEXT: there is no branch database. The user pastes this
 * file into the Supabase SQL editor on production by hand, so it must be
 * read-only from its first statement, must survive the editor's quirks, and
 * must return exactly one result set (the editor shows only the last one).
 * Same pattern as the pre-check/checker guards in
 * supabase/migrations/__tests__/boost-packs-drop-dead-policies.migration.test.ts.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const FILE = join(process.cwd(), 'scripts', 'inventory-security-definer-functions.sql');
const read = () => readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

function statementsOf(sql: string): string[] {
  return sql
    .split(';')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

describe('inventory-security-definer-functions.sql', () => {
  it('exists', () => {
    expect(existsSync(FILE)).toBe(true);
  });

  describe('SQL-editor safety (the user pastes it by hand)', () => {
    it('has no line comment and no block comment', () => {
      const text = read();
      expect(text).not.toContain('--');
      expect(text).not.toContain('/*');
    });

    // The Supabase SQL editor misreads the word "into" even inside a string
    // literal or an identifier (2026-10-04).
    it('never contains "into" anywhere, in any case', () => {
      expect(read()).not.toMatch(/into/i);
    });

    it('holds only letters, digits, underscores and spaces inside string literals', () => {
      const literals = literalsOf(read());
      expect(literals.length).toBeGreaterThan(0);
      for (const literal of literals) expect(literal).toMatch(/^[A-Za-z0-9_ ]*$/);
    });

    it('has an even number of single quotes', () => {
      expect((read().match(/'/g) ?? []).length % 2).toBe(0);
    });

    it('uses no single-letter alias', () => {
      expect(read()).not.toMatch(/\bAS [a-z]\b/i);
    });
  });

  describe('read-only, one result set', () => {
    const statements = statementsOf(read());

    it('makes the session read-only as its first statement', () => {
      expect(statements[0]).toBe('SET default_transaction_read_only = on');
    });

    it('is exactly two statements: the SET and one WITH … SELECT', () => {
      expect(statements).toHaveLength(2);
      expect(statements[1]).toMatch(/^WITH /);
      expect(statements[1]).toMatch(/ORDER BY report\.sort_order$/);
    });

    it('contains no write, DDL, privilege or transaction-control statement', () => {
      const text = read();
      expect(text).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|MERGE|TRUNCATE|CREATE|ALTER|DROP|GRANT|REVOKE|COPY|VACUUM|ANALYZE|REINDEX|CLUSTER|COMMENT|SECURITY LABEL|LOCK|CALL|DO|BEGIN|COMMIT|ROLLBACK|NOTIFY|LISTEN|REFRESH)\b/i,
      );
    });

    it('never turns read-only back off or executes dynamic SQL', () => {
      const text = read();
      expect(text).not.toMatch(/read_only\s*=\s*off/i);
      expect(text).not.toMatch(/\b(EXECUTE\s+format|query_to_xml|dblink|pg_read_file|lo_import|set_config)\b/i);
    });
  });

  describe('what it measures', () => {
    const text = read();

    it('filters to SECURITY DEFINER functions', () => {
      expect(text).toContain('WHERE proc_row.prosecdef');
    });

    it.each(['public', 'anon', 'authenticated', 'service_role'])(
      'computes effective EXECUTE for %s with has_function_privilege (accounts for PUBLIC inheritance)',
      (role) => {
        expect(text).toContain(`has_function_privilege('${role}', secdef_fn.fn_oid, 'EXECUTE')`);
      },
    );

    it('reads the explicit ACL through the default when proacl is NULL', () => {
      expect(text).toContain("COALESCE(proc_row.proacl, acldefault('f', proc_row.proowner))");
      expect(text).toContain('acl_item.grantee = 0');
    });

    it('flags trigger-returning functions and pinned search_path', () => {
      expect(text).toContain("proc_row.prorettype = 'trigger'::regtype");
      expect(text).toContain("left(config_item, 11) = 'search_path'");
    });

    it.each([
      'total secdef in public',
      'anon executable',
      'anon executable non trigger',
      'anon executable non trigger zero args',
      'missing pinned search_path',
      'secdef in other non system schemas',
    ])('emits the summary row "%s"', (label) => {
      expect(text).toContain(`'${label}'`);
    });

    it('gives every summary row a distinct sort_order', () => {
      const orders = [...text.matchAll(/SELECT (\d+), 'summary'/g)].map((m) => Number(m[1]));
      orders.push(1);
      expect(new Set(orders).size).toBe(orders.length);
      for (const order of orders) expect(order).toBeLessThan(100);
    });
  });
});

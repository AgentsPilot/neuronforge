/**
 * Data export DE-10b.1 (SA Review 2 §E, C2-7; workplan §4, §7.3): the deletion
 * receipt table, migration 20261080, its rollback, the pre-check and the checker.
 *
 * The receipt must survive the deletion it proves: the account cascade, a
 * purge, the audit erasure, archiving and the deletion of the acting admin.
 * It does that by having nothing they can reach: no foreign key and no
 * `user_id` / `owner_user_id` column. The helper below is the rule, and it is
 * proven able to fail on two planted copies (a `REFERENCES auth.users` and a
 * `user_id uuid` column).
 *
 * Source pins only: no database, no network.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { CLEANUP_FUNCTION_VERSION } from '@/lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated';

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read('supabase', 'migrations', '20261080_business_os_deletion_receipts.sql');
const ROLLBACK = read('supabase', 'SQL Scripts', '20261080_business_os_deletion_receipts_rollback.sql');
const PRECHECK = read('scripts', 'precheck-de10b-deletion-receipts.sql');
const CHECKER = read('scripts', 'check-de10b-deletion-receipts-migration.sql');
const TABLE = 'public.business_os_deletion_receipts';

function createTable(sql: string): string {
  const start = sql.indexOf(`CREATE TABLE ${TABLE} (`);
  if (start < 0) return '';
  return sql.slice(start, sql.indexOf('\n);\n', start) + 3);
}

/**
 * Every way the receipt table could become reachable by a cascade or a
 * user-keyed erasure, or readable by a browser. Empty means compliant.
 */
export function receiptTableViolations(sql: string): string[] {
  const out: string[] = [];
  const table = createTable(sql);
  if (table === '') out.push('no CREATE TABLE');
  // The DDL that could add a link: the table itself and any ALTER TABLE. The
  // post-condition messages and privilege lists name these words in strings.
  const ddl = [table, ...sql.split(';').filter((statement) => /^\s*ALTER\s+TABLE\b/i.test(statement))].join('\n');
  if (/\bREFERENCES\b/i.test(ddl)) out.push('REFERENCES');
  if (/FOREIGN\s+KEY/i.test(ddl)) out.push('FOREIGN KEY');
  if (/^\s*(user_id|owner_user_id)\s+\w+/im.test(table)) out.push('user_id column');
  if (/CREATE\s+TRIGGER/i.test(sql)) out.push('trigger');
  if (/CREATE\s+POLICY/i.test(sql)) out.push('policy');
  if (!sql.includes(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`)) out.push('RLS not enabled');
  const revoke = sql.indexOf(`REVOKE ALL ON TABLE ${TABLE} FROM PUBLIC, anon, authenticated, service_role;`);
  const grant = sql.indexOf(`GRANT SELECT, INSERT ON TABLE ${TABLE} TO service_role;`);
  if (revoke < 0 || grant < 0 || grant < revoke) out.push('revoke then grant');
  const grants = sql.match(/^GRANT .*$/gm) ?? [];
  if (grants.length !== 1) out.push('other grants');
  return out;
}

describe('20261080: the receipt table cannot be reached by any cascade or user-keyed erasure', () => {
  it('passes the rule', () => {
    expect(receiptTableViolations(MIGRATION)).toEqual([]);
  });

  it('negative fixture: a REFERENCES auth.users fails the same helper', () => {
    const planted = MIGRATION.replace(
      '  subject_user_id             uuid        NOT NULL,',
      '  subject_user_id             uuid        NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,'
    );
    expect(planted).not.toBe(MIGRATION);
    expect(receiptTableViolations(planted)).toContain('REFERENCES');
  });

  it('negative fixture: a user_id uuid column fails the same helper', () => {
    const planted = MIGRATION.replace(
      '  subject_user_id             uuid        NOT NULL,',
      '  subject_user_id             uuid        NOT NULL,\n  user_id uuid NULL,'
    );
    expect(receiptTableViolations(planted)).toContain('user_id column');
    const owner = MIGRATION.replace('  status ', '  owner_user_id uuid,\n  status ');
    expect(receiptTableViolations(owner)).toContain('user_id column');
  });

  it('negative fixture: a policy, a trigger or an extra grant fails it', () => {
    expect(receiptTableViolations(`${MIGRATION}\nCREATE POLICY p ON ${TABLE} FOR SELECT USING (true);`)).toContain('policy');
    expect(receiptTableViolations(`${MIGRATION}\nCREATE TRIGGER t AFTER INSERT ON ${TABLE} FOR EACH ROW EXECUTE FUNCTION f();`)).toContain('trigger');
    expect(receiptTableViolations(`${MIGRATION}\nGRANT SELECT ON TABLE ${TABLE} TO authenticated;`)).toContain('other grants');
    const altered = `${MIGRATION}\nALTER TABLE ${TABLE} ADD CONSTRAINT receipts_subject_fkey FOREIGN KEY (subject_user_id) REFERENCES auth.users (id);`;
    expect(receiptTableViolations(altered)).toEqual(expect.arrayContaining(['REFERENCES', 'FOREIGN KEY']));
  });
});

describe('20261080: the table shape (workplan §4, W-7)', () => {
  const table = createTable(MIGRATION);

  it.each([
    ["CHECK (status = 'completed')"],
    ["CHECK (mode IN ('full_delete', 'anonymised', 'pseudonymised_billing_kept'))"],
    ["CHECK (placeholder_ref IS NULL OR placeholder_ref ~ '^[0-9a-f]{12}$')"],
    ["CHECK ((mode = 'full_delete') = (placeholder_ref IS NULL))"],
    ["CHECK (email_fingerprint ~ '^[0-9a-f]{64}$')"],
    ['CHECK (fingerprint_key_version >= 1)'],
    ["CHECK (origin IN ('owner', 'admin'))"],
    ["CHECK (executor_kind IN ('self_service', 'admin'))"],
    // W-7: origin and executor can never disagree.
    ["CHECK ((origin = 'owner') = (executor_kind = 'self_service'))"],
    ["CHECK ((executor_kind = 'admin') = (executor_admin_id IS NOT NULL))"],
    ["CHECK (reason_category IS NULL OR reason_category IN ('customer_asked', 'test_account', 'other'))"],
    ["CHECK (origin <> 'admin' OR reason_category IS NOT NULL)"],
    ['CHECK (reason_note IS NULL OR char_length(reason_note) BETWEEN 5 AND 500)'],
    ["CHECK (reason_category IS DISTINCT FROM 'other' OR reason_note IS NOT NULL)"],
    ["CHECK (statement_language IS NULL OR statement_language IN ('en', 'he', 'es'))"],
    ['CHECK (statement_text IS NULL OR char_length(statement_text) <= 500)'],
    ['CHECK (rows_removed >= 0 AND rows_blanked >= 0 AND files_removed >= 0 AND tables_removed >= 0)'],
    // R-6 floor: no receipt can be swept within a year of the deletion.
    ["CHECK (retain_until >= completed_at + interval '1 year')"],
  ])('holds %s', (check) => {
    expect(table).toContain(check);
  });

  it('has the subject id, no email column and no admin_export_downloaded (O-12)', () => {
    expect(table).toMatch(/^\s+subject_user_id\s+uuid\s+NOT NULL,$/m);
    expect(table).not.toMatch(/^\s+email\s/m);
    expect(table).not.toContain('admin_export_downloaded');
    expect(table).toMatch(/^\s+admin_export_existed\s+boolean\s+NULL,$/m);
  });

  it('indexes the subject and the fingerprint', () => {
    expect(MIGRATION).toContain(`CREATE INDEX business_os_deletion_receipts_subject\n  ON ${TABLE} (subject_user_id);`);
    expect(MIGRATION).toContain(`CREATE INDEX business_os_deletion_receipts_fingerprint\n  ON ${TABLE} (email_fingerprint, fingerprint_key_version);`);
  });
});

describe('20261080: self-verifying (the 20261074 shape)', () => {
  it('refuses before anything when browser roles may CREATE in public or the table exists', () => {
    const guard = MIGRATION.slice(MIGRATION.indexOf('DO $pre_guard$'), MIGRATION.indexOf('$pre_guard$;'));
    expect(MIGRATION.indexOf('$pre_guard$;')).toBeLessThan(MIGRATION.indexOf(`CREATE TABLE ${TABLE}`));
    expect(guard).toContain("pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')");
    expect(guard).toContain("pg_catalog.to_regclass('public.business_os_deletion_receipts') IS NOT NULL");
  });

  it.each([
    ['RLS on', 'post-condition 1: row level security is off'],
    ['no policy', "post-condition 1: the table has a policy"],
    ['no foreign key out', "post-condition 2: the table has a foreign key"],
    ['no foreign key in', "post-condition 2: a foreign key points at the table"],
    ['no user_id column', "post-condition 2: the table has a user_id or owner_user_id column"],
    ['browser roles hold nothing', "post-condition 3: ' || v_role || ' holds table "],
    ['service_role SELECT and INSERT', "post-condition 4: service_role lacks "],
    ['service_role nothing else', "post-condition 4: service_role holds "],
    ['postgres can add a receipt', "IF NOT pg_catalog.has_table_privilege('postgres', v_table, 'INSERT') THEN"],
    ['no trigger', 'post-condition 5: the table has a trigger'],
    ['the indexes', 'post-condition 6: an index is missing'],
  ])('post-condition: %s', (_name, fragment) => {
    const post = MIGRATION.slice(MIGRATION.indexOf('DO $post_condition$'), MIGRATION.indexOf('$post_condition$;'));
    expect(post).toContain(fragment);
  });

  it('is one transaction that reloads PostgREST', () => {
    expect(MIGRATION).toMatch(/\nBEGIN;\n/);
    expect(MIGRATION.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
  });
});

describe('the rollback refuses once any receipt exists', () => {
  it('checks rows and the 20261081 function before the DROP', () => {
    const drop = ROLLBACK.indexOf(`DROP TABLE ${TABLE};`);
    expect(drop).toBeGreaterThan(0);
    const guard = ROLLBACK.slice(0, drop);
    expect(guard).toContain('v_rows := (SELECT count(*) FROM public.business_os_deletion_receipts);');
    expect(guard).toContain('IF v_rows > 0 THEN');
    expect(guard).toContain(
      "pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') IS NOT NULL"
    );
    expect(ROLLBACK.match(/DROP /g)).toHaveLength(1);
  });
});

describe('SQL editor hygiene (W-9): no "into", no SELECT ... INTO', () => {
  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['pre-check', PRECHECK],
    ['checker', CHECKER],
  ])('%s never holds the word', (_name, sql) => {
    expect(sql.match(/\binto\b/gi)).toBeNull();
  });

  it.each([
    ['pre-check', PRECHECK],
    ['checker', CHECKER],
  ])('%s is read-only', (_name, sql) => {
    const code = sql
      .split('\n')
      .filter((line) => !line.startsWith('--'))
      .join('\n');
    // No statement that writes: privilege names inside has_table_privilege() are only words in a string.
    expect(code).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|DO)\b/im);
    expect(code).not.toMatch(/\bset_config\(/i);
  });
});

describe('the pre-check and the checker pin the right function versions (workplan section 8)', () => {
  it('the pre-check requires the 20261077 stamp live, and neither 20261080 nor 20261081 applied', () => {
    expect(PRECHECK).toContain("position('b78b4579fc6631f8' in p.prosrc) > 0");
    expect(PRECHECK).toContain(
      "pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)') IS NULL"
    );
    expect(PRECHECK).toContain("pg_catalog.to_regclass('public.business_os_deletion_receipts') IS NULL");
  });

  it('the checker requires the stamp this build pins, and the 6 argument function gone', () => {
    expect(CHECKER).toContain(`position('${CLEANUP_FUNCTION_VERSION}' in p.prosrc) > 0`);
    expect(CHECKER).toContain("pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text)') IS NULL");
  });
});

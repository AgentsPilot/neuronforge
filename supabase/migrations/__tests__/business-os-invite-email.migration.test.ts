/**
 * Guard over the invite email migration (invite-only signup, Slice 2a;
 * workplan §5.1, §6.1, §13; SA R-1, R-10).
 *
 * Jest cannot run SQL and there is no branch database: the user pastes the
 * migration into the Supabase SQL editor on PROD by hand, then runs
 * `scripts/check-bos-invite-email-migration.sql`. What the files alone can
 * prove is pinned here: editor safety (no comments, NO string literal at all
 * in the migration and rollback, no alias), exactly the listed columns and
 * CHECKs, NULL-safe CHECKs, no privilege statement and no new object, a
 * rollback that drops exactly what was added, and a checker that matches the
 * migration, proves no column-level privilege exists, and keeps the total
 * CHECK count out of its VERDICT (R-10).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261020_business_os_invite_email.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261020_business_os_invite_email_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-invite-email-migration.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const rollbackText = read(ROLLBACK);
const rollback = rollbackText.replace(/\s+/g, ' ');
const checker = read(CHECKER);
const checkerFlat = checker.replace(/\s+/g, ' ');

function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The literal list of the checker's `<column> IN (…)` whose first entry starts with `prefix`. */
function checkerList(column: string, prefix = ''): string[] {
  const escaped = column.replace('.', '\\.');
  const lists = [...checker.matchAll(new RegExp(`${escaped} IN \\(([^)]*)\\)`, 'g'))].map((match) => literalsOf(match[1]));
  const found = lists.find((list) => list.length > 0 && list[0].startsWith(prefix));
  expect(found).toBeDefined();
  return found ?? [];
}

const NEW_COLUMNS = [...flat.matchAll(/ALTER TABLE public\.business_os_invites ADD COLUMN (\w+)/g)].map((m) => m[1]);
const NEW_CHECKS = [...flat.matchAll(/ALTER TABLE public\.business_os_invites ADD CONSTRAINT (\w+) CHECK/g)].map((m) => m[1]);

describe('SQL-editor safety (the user pastes this by hand)', () => {
  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
  ])('%s has no comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  it('the migration and the rollback contain no string literal at all', () => {
    expect(migration).not.toContain("'");
    expect(rollbackText).not.toContain("'");
  });

  it('the checker literals hold only letters, digits, underscores and spaces', () => {
    for (const literal of literalsOf(checker)) {
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
    }
    expect(checker).not.toContain('%');
    expect(checker).not.toMatch(/\bLIKE\b/i);
  });

  it.each([
    ['migration', MIGRATION],
    ['checker', CHECKER],
  ])('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN|UPDATE)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
  });

  it('is one transaction with no IF NOT EXISTS / OR REPLACE (a second paste fails and changes nothing)', () => {
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.trim().startsWith('BEGIN;')).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
    expect(flat).not.toMatch(/IF NOT EXISTS|OR REPLACE/i);
  });

  it('creates no table, function, trigger or policy, grants and revokes nothing, and drops nothing', () => {
    expect(flat).not.toMatch(/\b(REVOKE|GRANT)\b/);
    expect(flat).not.toMatch(/CREATE TABLE|FUNCTION|TRIGGER|POLICY/);
    expect(flat).not.toMatch(/\bREFERENCES\b/);
    expect(flat).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/);
    expect(flat.match(/CREATE UNIQUE INDEX/g)).toHaveLength(1);
    expect(flat.match(/CREATE (?!UNIQUE INDEX)/g)).toBeNull();
  });
});

describe('columns, CHECKs and the index (§5.1)', () => {
  it('adds exactly the seven email columns, all nullable', () => {
    expect(NEW_COLUMNS).toEqual([
      'inviter_reply_to',
      'email_attempted_at',
      'email_sent_at',
      'email_provider_message_id',
      'email_problem',
      'email_problem_at',
      'email_problem_detail',
    ]);
    for (const match of flat.matchAll(/ADD COLUMN (\w+) ([^;]+);/g)) {
      expect(match[2]).not.toMatch(/NOT NULL|DEFAULT/);
    }
  });

  it('adds exactly four CHECKs, each NULL-safe (SA M-2)', () => {
    expect(NEW_CHECKS).toEqual([
      'business_os_invites_inviter_reply_to_normalised',
      'business_os_invites_email_problem_paired',
      'business_os_invites_email_lengths',
      'business_os_invites_email_sent_shape',
    ]);
    expect(flat).toContain(
      'CHECK (inviter_reply_to IS NULL OR (inviter_reply_to = lower(btrim(inviter_reply_to)) AND char_length(inviter_reply_to) BETWEEN 3 AND 320))'
    );
    expect(flat).toContain(
      'CHECK ((email_problem IS NULL AND email_problem_at IS NULL AND email_problem_detail IS NULL) OR (email_problem IS NOT NULL AND email_problem_at IS NOT NULL))'
    );
    expect(flat).toContain('email_problem IS NULL OR char_length(email_problem) <= 32');
    expect(flat).toContain('email_problem_detail IS NULL OR char_length(email_problem_detail) <= 300');
    expect(flat).toContain('email_provider_message_id IS NULL OR char_length(email_provider_message_id) <= 255');
    expect(flat).toContain(
      'CHECK ((email_sent_at IS NULL OR email_attempted_at IS NOT NULL) AND (email_provider_message_id IS NULL OR email_sent_at IS NOT NULL))'
    );
  });

  it('the problem vocabulary lives in TypeScript, not SQL (length only)', () => {
    for (const word of ['not_sent', 'bounced', 'complained', 'failed', 'suppressed', 'sender_not_configured']) {
      expect(migration).not.toContain(word);
    }
  });

  it('the message id index is unique and partial on a non-null id', () => {
    expect(flat).toContain(
      'CREATE UNIQUE INDEX business_os_invites_email_message_id_key ON public.business_os_invites (email_provider_message_id) WHERE email_provider_message_id IS NOT NULL;'
    );
  });
});

describe('rollback', () => {
  it('drops the index, every new CHECK and every new column, and nothing else', () => {
    expect(rollback).toContain('DROP INDEX public.business_os_invites_email_message_id_key;');
    for (const name of NEW_CHECKS) expect(rollback).toContain(`DROP CONSTRAINT ${name};`);
    for (const column of NEW_COLUMNS) expect(rollback).toContain(`DROP COLUMN ${column};`);
    expect(rollback.match(/\bDROP\b/g)).toHaveLength(1 + NEW_CHECKS.length + NEW_COLUMNS.length);
    expect(rollback.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(rollback.match(/\bCOMMIT;/g)).toHaveLength(1);
  });

  it('drops the CHECKs before the columns they name', () => {
    const lastCheck = Math.max(...NEW_CHECKS.map((name) => rollback.indexOf(`DROP CONSTRAINT ${name};`)));
    const firstColumn = Math.min(...NEW_COLUMNS.map((column) => rollback.indexOf(`DROP COLUMN ${column};`)));
    expect(lastCheck).toBeLessThan(firstColumn);
  });
});

describe('checker (§6.1, R-10)', () => {
  it('is read-only and has M01 to M09 plus a verdict', () => {
    expect(checker.trim().startsWith('SET default_transaction_read_only = on;')).toBe(true);
    const rows = [...checker.matchAll(/'(M\d\d) /g)].map((match) => match[1]);
    expect(rows).toEqual(['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09']);
    expect(checker).toContain("'VERDICT'");
    expect(checker).toContain('aclexplode(');
  });

  it('names exactly the new columns and the new CHECKs', () => {
    expect(checkerList('pg_attribute.attname').sort()).toEqual([...NEW_COLUMNS].sort());
    expect(checkerList('pg_constraint.conname', 'business_os_invites_').sort()).toEqual([...NEW_CHECKS].sort());
    expect(checkerFlat).toContain('AND NOT pg_attribute.attnotnull) AS new_nullable_columns');
    expect(checkerFlat).toContain('CASE WHEN invite_columns.new_nullable_columns = 7 THEN');
    expect(checkerFlat).toContain('CASE WHEN invite_checks.named_checks = 4 THEN');
  });

  it('M03 (the total CHECK count) is INFO and can never FAIL, so the VERDICT ignores it (R-10)', () => {
    const m03 = checkerFlat.slice(checkerFlat.indexOf("'M03 "), checkerFlat.indexOf("'M04 "));
    expect(m03).toContain("'INFO'");
    expect(m03).not.toContain('PASS');
    expect(m03).not.toContain('FAIL');
    expect(checkerFlat).toContain("CASE WHEN EXISTS (SELECT 1 FROM checks WHERE checks.status = 'FAIL') THEN 'FAIL' ELSE 'PASS' END");
  });

  it('M07 proves no column-level privilege exists (every column attacl IS NULL, R-10)', () => {
    expect(checkerFlat).toContain('count(*) FILTER (WHERE pg_attribute.attacl IS NOT NULL) AS column_acl_columns');
    expect(checkerFlat).toContain('CASE WHEN invite_columns.column_acl_columns = 0 THEN');
    // Every live column, not only the new ones.
    const columnsCte = checkerFlat.slice(checkerFlat.indexOf('invite_columns AS ('), checkerFlat.indexOf('invite_checks AS ('));
    expect(columnsCte).toContain('pg_attribute.attnum > 0');
    expect(columnsCte).toContain('NOT pg_attribute.attisdropped');
  });

  it('M04 needs the named index to be unique AND partial', () => {
    expect(checkerFlat).toContain("index_class.relname = 'business_os_invites_email_message_id_key'");
    expect(checkerFlat).toContain('count(*) FILTER (WHERE pg_index.indisunique AND pg_index.indpred IS NOT NULL) AS unique_partial');
    expect(checkerFlat).toContain('CASE WHEN message_index.total = 1 AND message_index.unique_partial = 1 THEN');
  });

  it('M05/M06 pin the table privilege end state exactly (QA-1b-1 lesson)', () => {
    expect(checkerFlat).toContain("acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')");
    expect(checkerFlat).toContain("count(*) FILTER (WHERE acl_entries.privilege_name IN ('SELECT', 'INSERT', 'UPDATE')) AS expected_total");
    expect(checkerFlat).toContain("count(*) FILTER (WHERE acl_entries.privilege_name NOT IN ('SELECT', 'INSERT', 'UPDATE')) AS unexpected_total");
    expect(checkerFlat).toContain('CASE WHEN service_entries.expected_total = 3 AND service_entries.unexpected_total = 0 THEN');
    expect(checkerFlat).toContain('CASE WHEN client_entries.total = 0 THEN');
  });

  it('M08/M09: RLS on with no policy, and no trigger', () => {
    expect(checkerFlat).toContain(
      'CASE WHEN COALESCE((SELECT invite_table.rls_on FROM invite_table), false) AND policy_summary.total = 0 THEN'
    );
    expect(checkerFlat).toContain('CASE WHEN trigger_summary.total = 0 THEN');
    expect(checkerFlat).toContain('AND NOT pg_trigger.tgisinternal');
  });
});

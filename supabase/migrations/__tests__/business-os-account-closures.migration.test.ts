/**
 * Account deletion lifecycle DL-1a (workplan §4, T-2; SA W-2, W-3, W-6, W-13):
 * migration 20261093, its rollback, the pre-check and the 20261093 checker.
 *
 * The SQL literals are the authority (the claim lease, the settle time, the
 * status list), and closureLifecycle.ts mirrors them. This suite fails CI when
 * the two disagree, the jobPolicy.ts precedent.
 *
 * Source pins only: no database, no network.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CLAIMABLE_CLOSURE_STATUSES,
  CLOSURE_LEASE_SECONDS,
  CLOSURE_STATUSES,
  KEPT_SOURCES,
  OPEN_CLOSURE_STATUSES,
  REQUESTING_SETTLE_MINUTES,
} from '@/lib/business-os/account-deletion/closureLifecycle';
import { STATEMENT_LANGUAGES } from '@/lib/business-os/account-deletion/acknowledgement';

/** The two function names, literal here: this test does not import the repositories (their callers guard). */
const CLOSURE_CLAIM_FUNCTION = 'business_os_account_closures_claim_due';
const SESSION_CUT_FUNCTION = 'business_os_account_closure_cut_sessions';

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8').replace(/\r\n/g, '\n');

const MIGRATION = read('supabase', 'migrations', '20261093_business_os_account_closures.sql');
const ROLLBACK = read('supabase', 'SQL Scripts', '20261093_business_os_account_closures_rollback.sql');
const PRECHECK = read('scripts', 'precheck-account-closures.sql');
const CHECKER = read('scripts', 'check-account-closures-migration.sql');
const TABLE = 'public.business_os_account_closures';
const CLAIM_SIGNATURE = `public.${CLOSURE_CLAIM_FUNCTION}(uuid, integer)`;
const CUT_SIGNATURE = `public.${SESSION_CUT_FUNCTION}(uuid)`;

const quoted = (values: ReadonlyArray<string>) => values.map((value) => `'${value}'`).join(', ');

/** The CREATE TABLE statement. */
function createTable(sql: string): string {
  const start = sql.indexOf(`CREATE TABLE ${TABLE} (`);
  return start < 0 ? '' : sql.slice(start, sql.indexOf('\n);\n', start) + 3);
}

/** The body of one dollar-quoted function, between its tags. */
function body(sql: string, tag: string): string {
  const open = `AS $${tag}$`;
  const start = sql.indexOf(open);
  if (start < 0) return '';
  const from = start + open.length;
  return sql.slice(from, sql.indexOf(`$${tag}$;`, from));
}

/** The statement that creates a function, up to its AS. */
function header(sql: string, name: string): string {
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  const end = start < 0 ? -1 : sql.indexOf('\nAS $', start);
  return start < 0 || end < 0 ? '' : sql.slice(start, end);
}

const table = createTable(MIGRATION);
const claimBody = body(MIGRATION, 'claim');
const cutBody = body(MIGRATION, 'cut');

describe('20261093: the table (§4.1, W-6, W-13)', () => {
  it('the status CHECK is exactly CLOSURE_STATUSES, with no closed status and no closed_at column (W-6, XC-1a)', () => {
    expect(table).toContain(`CHECK (status IN (${quoted(CLOSURE_STATUSES)}))`);
    expect(CLOSURE_STATUSES).not.toContain('closed' as never);
    expect(table).not.toMatch(/^\s*closed_at\s/m);
    expect(MIGRATION).not.toMatch(/'closed'/);
  });

  it('the language CHECK is exactly STATEMENT_LANGUAGES and kept_source is KEPT_SOURCES', () => {
    expect(table).toContain(`CHECK (statement_language IN (${quoted(STATEMENT_LANGUAGES)}))`);
    expect(table).toContain(`kept_source IN (${quoted(KEPT_SOURCES)})`);
  });

  it('user_id is NOT NULL and cascades from auth.users; it is the only foreign key', () => {
    expect(table).toMatch(/^\s*user_id\s+uuid\s+NOT NULL REFERENCES auth\.users \(id\) ON DELETE CASCADE,$/m);
    expect(table.match(/REFERENCES/g)).toHaveLength(1);
    expect(table).not.toMatch(/FOREIGN\s+KEY/i);
    expect(MIGRATION).not.toMatch(/^\s*ALTER\s+TABLE\b(?![^;]*ENABLE ROW LEVEL SECURITY)/im);
  });

  it('carries the SR-8 columns and the D-9 columns, and the one-email-per-column set', () => {
    for (const column of [
      'closed_email_attempts',
      'closed_email_first_attempt_at',
      'lock_timezone',
      'next_check_at',
      'last_error_code',
      'requested_email_sent_at',
      'grace_email_sent_at',
      'reminder_email_sent_at',
      'blocked_email_sent_at',
      'closed_email_sent_at',
      'kept_email_sent_at',
    ]) {
      expect([column, new RegExp(`^\\s*${column}\\s`, 'm').test(table)]).toEqual([column, true]);
    }
  });

  it('the row shape CHECKs: kept, grace and locked, the claim pair', () => {
    expect(table).toContain("CHECK ((status = 'kept') = (kept_source IS NOT NULL) AND (status = 'kept') = (kept_at IS NOT NULL))");
    expect(table).toContain("CHECK (status NOT IN ('grace', 'locked') OR (grace_starts_at IS NOT NULL AND lock_at IS NOT NULL))");
    expect(table).toContain("CHECK (status <> 'locked' OR locked_at IS NOT NULL)");
    expect(table).toContain('CHECK ((claimed_by IS NULL) = (claimed_at IS NULL))');
  });

  it('blocked_codes uses the W-13 form with no helper function, and lock_timezone is at most 64', () => {
    expect(table).toContain(
      "CHECK (cardinality(blocked_codes) <= 20\n           AND array_position(blocked_codes, NULL) IS NULL\n" +
        "           AND array_position(blocked_codes, '') IS NULL\n" +
        "           AND cardinality(string_to_array(array_to_string(blocked_codes, ','), ',')) = cardinality(blocked_codes)\n" +
        "           AND array_to_string(blocked_codes, ',') ~ '^(([A-Z]-[0-9]{1,2}[a-z]?|[a-z_]{1,40})(,|$))*$')"
    );
    expect(table).toContain('CHECK (lock_timezone IS NULL OR char_length(lock_timezone) <= 64)');
    expect(table).toContain("CHECK (reason_code ~ '^[a-z][a-z0-9_]{1,39}$')");
  });

  /**
   * The whole blocked_codes CHECK as Postgres evaluates it (SA code review comment 2). In Postgres
   * string_to_array('', ',') is an empty array, so the split of an empty join counts 0.
   */
  const blockedCodesAccepted = (codes: Array<string | null>): boolean => {
    const joined = codes.filter((code): code is string => code !== null).join(',');
    const pieces = joined === '' ? 0 : joined.split(',').length;
    return (
      codes.length <= 20 &&
      !codes.includes(null) &&
      !codes.includes('') &&
      pieces === codes.length &&
      /^(([A-Z]-[0-9]{1,2}[a-z]?|[a-z_]{1,40})(,|$))*$/.test(joined)
    );
  };

  it('the CHECK refuses an empty element and a comma inside an element (SA code review comment 2)', () => {
    expect(blockedCodesAccepted([])).toBe(true);
    expect(blockedCodesAccepted(['G-9', 'G-12a', 'payment_failed'])).toBe(true);
    expect(blockedCodesAccepted([''])).toBe(false);
    expect(blockedCodesAccepted(['G-9', ''])).toBe(false);
    expect(blockedCodesAccepted(['G-9,G-1'])).toBe(false);
    expect(blockedCodesAccepted([null])).toBe(false);
    expect(blockedCodesAccepted(Array.from({ length: 21 }, () => 'G-9'))).toBe(false);
  });

  it('the blocked_codes pattern accepts guard codes and refuses free text', () => {
    const pattern = /^(([A-Z]-[0-9]{1,2}[a-z]?|[a-z_]{1,40})(,|$))*$/;
    expect(pattern.test(['G-9', 'G-12a', 'payment_failed'].join(','))).toBe(true);
    expect(pattern.test('')).toBe(true);
    expect(pattern.test('Owes money!')).toBe(false);
    expect(pattern.test(['G-9', 'call me'].join(','))).toBe(false);
  });

  it('the open index is unique over exactly OPEN_CLOSURE_STATUSES; the claimable index over CLAIMABLE_CLOSURE_STATUSES', () => {
    expect(MIGRATION).toContain(
      `CREATE UNIQUE INDEX business_os_account_closures_one_open\n  ON ${TABLE} (user_id)\n  WHERE status IN (${quoted(OPEN_CLOSURE_STATUSES)});`
    );
    expect(MIGRATION).toContain(
      `CREATE INDEX business_os_account_closures_claimable\n  ON ${TABLE} (next_check_at)\n  WHERE status IN (${quoted(CLAIMABLE_CLOSURE_STATUSES)});`
    );
    expect(OPEN_CLOSURE_STATUSES).toContain('requesting');
  });

  it('RLS on, no policy, no trigger; revoke from every role, then SELECT, INSERT, UPDATE, DELETE to service_role only', () => {
    expect(MIGRATION).toContain(`ALTER TABLE ${TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(MIGRATION).not.toMatch(/CREATE\s+POLICY/i);
    expect(MIGRATION).not.toMatch(/CREATE\s+TRIGGER/i);
    const revoke = MIGRATION.indexOf(`REVOKE ALL ON TABLE ${TABLE} FROM PUBLIC, anon, authenticated, service_role;`);
    const grant = MIGRATION.indexOf(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${TABLE} TO service_role;`);
    expect(revoke).toBeGreaterThan(0);
    expect(grant).toBeGreaterThan(revoke);
    expect(MIGRATION.match(/^GRANT .*$/gm)).toEqual([
      `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${TABLE} TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${CLAIM_SIGNATURE} TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${CUT_SIGNATURE} TO service_role;`,
    ]);
  });
});

describe('20261093: the claim function (§4.2, W-2, O-4)', () => {
  it('runs with the rights of its caller, is volatile sql with a pinned search_path, and takes no lease parameter', () => {
    const head = header(MIGRATION, CLOSURE_CLAIM_FUNCTION);
    expect(head).toContain(`CREATE FUNCTION ${CLAIM_SIGNATURE.replace('(uuid, integer)', '(p_runner uuid, p_batch integer)')}`);
    expect(head).toContain(`RETURNS SETOF ${TABLE}`);
    expect(head).toMatch(/\nLANGUAGE sql\nVOLATILE\nSECURITY INVOKER\nSET search_path = pg_catalog, public, pg_temp$/);
    expect(MIGRATION).not.toContain('p_lease_seconds');
  });

  it('the lease literal equals CLOSURE_LEASE_SECONDS and the settle literal equals REQUESTING_SETTLE_MINUTES', () => {
    expect(claimBody).toContain(`c.claimed_at < now() - interval '${CLOSURE_LEASE_SECONDS} seconds'`);
    expect(claimBody).toContain(`c.requested_at < now() - interval '${REQUESTING_SETTLE_MINUTES} minutes'`);
    expect(CLOSURE_LEASE_SECONDS).toBe(90);
    expect(REQUESTING_SETTLE_MINUTES).toBe(15);
  });

  it('claims only CLAIMABLE_CLOSURE_STATUSES, skips locked rows, clamps the batch and bumps attempts', () => {
    expect(claimBody).toContain(`c.status IN (${quoted(CLAIMABLE_CLOSURE_STATUSES)})`);
    expect(claimBody).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimBody).toContain('LIMIT LEAST(GREATEST(coalesce(p_batch, 1), 1), 100)');
    expect(claimBody).toContain('attempts = c.attempts + 1');
    expect(claimBody).toContain('p_runner IS NOT NULL');
    expect(claimBody).toContain('(c.next_check_at IS NULL OR c.next_check_at <= now())');
  });

  it('EXECUTE is revoked from every role, then granted to service_role', () => {
    const revoke = MIGRATION.indexOf(`REVOKE ALL ON FUNCTION ${CLAIM_SIGNATURE} FROM PUBLIC, anon, authenticated, service_role;`);
    expect(revoke).toBeGreaterThan(MIGRATION.indexOf('$claim$;'));
    expect(MIGRATION.indexOf(`GRANT EXECUTE ON FUNCTION ${CLAIM_SIGNATURE} TO service_role;`)).toBeGreaterThan(revoke);
  });
});

describe('20261093: the session cut function (§4.3, W-3, O-5)', () => {
  it('runs with its owner rights, owned by postgres, with a pinned search_path', () => {
    const head = header(MIGRATION, SESSION_CUT_FUNCTION);
    expect(head).toContain(`CREATE FUNCTION public.${SESSION_CUT_FUNCTION}(p_user_id uuid)`);
    expect(head).toMatch(/\nRETURNS jsonb\nLANGUAGE plpgsql\nVOLATILE\nSECURITY DEFINER\nSET search_path = pg_catalog, public, pg_temp$/);
    expect(MIGRATION).toContain(`ALTER FUNCTION ${CUT_SIGNATURE} OWNER TO postgres;`);
    const revoke = MIGRATION.indexOf(`REVOKE ALL ON FUNCTION ${CUT_SIGNATURE} FROM PUBLIC, anon, authenticated, service_role;`);
    expect(revoke).toBeGreaterThan(MIGRATION.indexOf('$cut$;'));
    expect(MIGRATION.indexOf(`GRANT EXECUTE ON FUNCTION ${CUT_SIGNATURE} TO service_role;`)).toBeGreaterThan(revoke);
  });

  it('refuses with 42501 unless locked, or grace past its lock time; a NULL id is refused too (W-3)', () => {
    expect(cutBody).toContain('IF p_user_id IS NULL OR NOT EXISTS (');
    expect(cutBody).toContain("AND (c.status = 'locked' OR (c.status = 'grace' AND c.lock_at <= now()))");
    expect(cutBody).toContain("RAISE EXCEPTION USING ERRCODE = '42501'");
    // The refusal comes before any write.
    expect(cutBody.indexOf('42501')).toBeLessThan(cutBody.indexOf('DELETE FROM'));
  });

  it('removes the sessions by uuid and the refresh tokens by user_id::text, and nothing else in auth', () => {
    expect(cutBody).toContain('DELETE FROM auth.sessions AS s WHERE s.user_id = p_user_id;');
    expect(cutBody).toContain('DELETE FROM auth.refresh_tokens AS t WHERE t.user_id = p_user_id::text;');
    expect(MIGRATION.match(/DELETE\s+FROM\s+auth\.\S+/gi)).toEqual(['DELETE FROM auth.sessions', 'DELETE FROM auth.refresh_tokens']);
    expect(MIGRATION).not.toMatch(/UPDATE\s+auth\./i);
    expect(MIGRATION).not.toMatch(/INSERT\s+INTO\s+auth\./i);
    expect(cutBody).toContain("RETURN pg_catalog.jsonb_build_object('sessions', v_sessions, 'refresh_tokens', v_tokens);");
  });
});

describe('20261093: guards and paste safety (§4.4)', () => {
  it('pre-guards the auth column types and the owner privileges, post-conditions every grant and both functions', () => {
    expect(MIGRATION).toContain("att.atttypid = 'uuid'::regtype");
    expect(MIGRATION).toContain("att.atttypid IN ('text'::regtype, 'varchar'::regtype)");
    expect(MIGRATION).toContain("pg_catalog.has_table_privilege('postgres', 'auth.sessions', 'DELETE')");
    for (let n = 1; n <= 7; n++) expect(MIGRATION).toContain(`Account closures post-condition ${n}:`);
    expect(MIGRATION).toContain('acl.grantee = 0');
  });

  it('one transaction, then the schema reload', () => {
    expect(MIGRATION).toMatch(/\nBEGIN;\n/);
    expect(MIGRATION.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';\n\nCOMMIT;")).toBe(true);
  });

  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['pre-check', PRECHECK],
    ['checker', CHECKER],
  ])('the %s has no "into" and never assigns with SELECT ... INTO', (_name, sql) => {
    expect(sql.match(/\binto\b/gi)).toBeNull();
    expect(sql).not.toMatch(/\bSELECT\b[^;]*?\bINTO\s+v_/i);
  });

  it.each([
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
  ])('the %s keeps comments to the header, without semicolons or apostrophes', (_name, sql) => {
    const lines = sql.split('\n');
    const firstCode = lines.findIndex((line) => line !== '' && !line.startsWith('--'));
    lines.forEach((line, index) => {
      if (line.trimStart().startsWith('--')) expect([index, index < firstCode, /[;']/.test(line)]).toEqual([index, true, false]);
    });
  });
});

describe('20261093: rollback (§10, W-1)', () => {
  it('refuses while the live cleanup function names the table, and while any row exists, then drops the three objects', () => {
    expect(ROLLBACK).toContain("position('business_os_account_closures' in p.prosrc) > 0");
    expect(ROLLBACK).toContain(`v_rows := (SELECT count(*) FROM ${TABLE});`);
    // Locked before the count, so no write slips between the count and the DROP (SA optimisation).
    const lock = ROLLBACK.indexOf(`LOCK TABLE ${TABLE} IN ACCESS EXCLUSIVE MODE;`);
    expect(lock).toBeGreaterThan(0);
    expect(lock).toBeLessThan(ROLLBACK.indexOf('v_rows := (SELECT count(*)'));
    expect(ROLLBACK).toContain(`DROP FUNCTION IF EXISTS ${CUT_SIGNATURE};`);
    expect(ROLLBACK).toContain(`DROP FUNCTION IF EXISTS ${CLAIM_SIGNATURE};`);
    expect(ROLLBACK).toContain(`DROP TABLE ${TABLE};`);
    expect(ROLLBACK.indexOf('$rollback_guard$;')).toBeLessThan(ROLLBACK.indexOf('DROP FUNCTION'));
  });
});

describe('the pre-check and the 20261093 checker (§9, W-1)', () => {
  it('the pre-check requires the 20261092 stamp live and the 20261094 stamp absent, and the closure objects absent', () => {
    expect(PRECHECK).toContain("position('ec34d5604055abfe' in p.prosrc) > 0)");
    expect(PRECHECK).toMatch(/NOT EXISTS \(SELECT 1 FROM pg_catalog\.pg_proc AS p WHERE p\.oid = \(SELECT fn\.oid FROM fn\) AND position\('[0-9a-f]{16}' in p\.prosrc\) > 0\)/);
    expect(PRECHECK).toContain(`pg_catalog.to_regclass('${TABLE}') IS NULL`);
    expect(PRECHECK).toContain(`pg_catalog.to_regprocedure('${CLAIM_SIGNATURE}') IS NULL`);
    expect(PRECHECK).toContain(`pg_catalog.to_regprocedure('${CUT_SIGNATURE}') IS NULL`);
  });

  it('checker row 12 names every CHECK constraint the migration creates (SA optimisation)', () => {
    const named = [...table.matchAll(/CONSTRAINT (business_os_account_closures_\w+)\n\s+CHECK/g)].map((match) => match[1]);
    expect(named).toHaveLength(12);
    for (const name of named) expect(CHECKER).toContain(`'${name}'`);
    expect(CHECKER).toContain("WHERE con.conrelid = (SELECT closures.rel FROM closures) AND con.contype = 'c'");
    expect(CHECKER).toContain("'business_os_account_closures_counts_check')) = 12\n");
  });

  it('the checker pins both literals and the W-3 predicate, and row 13 is the G-10 information row', () => {
    expect(CHECKER).toContain(`position('interval ''${CLOSURE_LEASE_SECONDS} seconds''' in p.prosrc) > 0`);
    expect(CHECKER).toContain(`position('interval ''${REQUESTING_SETTLE_MINUTES} minutes''' in p.prosrc) > 0`);
    expect(CHECKER).toContain("position('c.lock_at <= now()' in p.prosrc) > 0");
    expect(cutBody).toContain('c.lock_at <= now()');
    expect(CHECKER).toMatch(/SELECT 13, 'information only\. ok once 20261094 is live\. FAIL until then is expected: every test account check and delete refuses with G-10 on this table'/);
  });

  it.each([
    ['pre-check', PRECHECK],
    ['checker', CHECKER],
  ])('the %s is one read-only statement ending ORDER BY checks.ord', (_name, sql) => {
    expect(sql).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE|TRUNCATE|DO|BEGIN)\b/im);
    expect(sql).not.toMatch(/\bset_config\(/i);
    expect(sql.trimEnd().endsWith('ORDER BY checks.ord;')).toBe(true);
    expect(sql.split(';').length - 1).toBe(1);
    for (const line of sql.split('\n').filter((l) => l.startsWith('--'))) expect(line).not.toMatch(/[;']/);
  });
});

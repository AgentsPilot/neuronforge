/**
 * Guard over the Business OS credit lots migration (credit deduction slice 11a;
 * workplan BUSINESS_OS_CREDIT_DEDUCTION_SLICE_11_WORKPLAN.md §3.1 to §3.3, §6,
 * §7.1, and SA conditions W11a-1, W11a-3, W11a-5, W11a-6).
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database: the user pastes the migration into the Supabase SQL editor on PROD,
 * then runs the read-only checker `scripts/check-bos-credit-lots-migration.sql`
 * and the mandatory write probe `scripts/probe-bos-credit-lots-migration.sql`.
 * What the files alone can prove is pinned here: the paste-safety rules, the
 * security shape (REVOKE ALL, column-level owner SELECT, INVOKER functions, no
 * trigger, append-only by privilege), the reversal function's step order and
 * lock, that the charge path is not named, and that the checker and the probe
 * have not drifted from the migration they verify.
 *
 * L8 (W11a-5). The checker pins the md5 of the two charge function bodies from
 * `20261015`. This test computes those two hashes from the file and asserts
 * the checker holds exactly them, AND that no other SQL file under
 * `supabase/migrations/` or `supabase/SQL Scripts/` names the charge objects.
 * When a later migration changes the charge path, that second test fails and
 * L8 is re-pinned on purpose in the same change.
 *
 * The helpers below are copied from the slice 3 test on purpose, rather than
 * imported across test files.
 */

import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const SQL_SCRIPTS_DIR = join(ROOT, 'supabase', 'SQL Scripts');
const MIGRATION = join(MIGRATIONS_DIR, '20261017_business_os_credit_lots.sql');
const ROLLBACK = join(SQL_SCRIPTS_DIR, '20261017_business_os_credit_lots_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-credit-lots-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-bos-credit-lots-migration.sql');
const CHARGES_MIGRATION = join(MIGRATIONS_DIR, '20261015_business_os_credit_charges.sql');
const CHARGES_ROLLBACK = join(SQL_SCRIPTS_DIR, '20261015_business_os_credit_charges_rollback.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const checker = read(CHECKER);
const checkerFlat = checker.replace(/\s+/g, ' ');
const probe = read(PROBE);
const probeFlat = probe.replace(/\s+/g, ' ');
const rollbackFlat = read(ROLLBACK).replace(/\s+/g, ' ').trim();

const LOTS = 'public.business_os_credit_lots';
const DRAWS = 'public.business_os_credit_lot_draws';
const RECORD_FN = 'public.business_os_record_credit_lot(uuid, text, numeric, numeric, integer, timestamptz, text, uuid, text, uuid, text)';
const REVERSE_FN = 'public.business_os_reverse_credit_lot(uuid, uuid, numeric, text, uuid, text)';

/** The four charge-path names 11a must never touch (G1). */
const CHARGE_PATH_NAMES = [
  'business_os_credit_charges',
  'business_os_credit_totals',
  'business_os_record_credit_charge',
  'business_os_credit_period_start',
];

/** What an owner may read (SA-11; 11d's owner repository is subset-tested against these lines). */
const OWNER_LOT_COLUMNS = ['id', 'user_id', 'source', 'credits_granted', 'credits_base', 'credits_bonus', 'expires_at', 'created_at'];
const OWNER_DRAW_COLUMNS = ['id', 'lot_id', 'user_id', 'kind', 'credits', 'created_at'];

const STATUSES = ['recorded', 'already_recorded', 'lot_not_found', 'lot_expired', 'nothing_left', 'exceeds_remaining'];

/** Every single-quoted literal in a SQL text. */
function literalsOf(sql: string): string[] {
  return [...sql.matchAll(/'([^']*)'/g)].map((match) => match[1]);
}

/** The body of one CREATE TABLE statement. */
function tableBody(table: string): string {
  const start = migration.indexOf(`CREATE TABLE ${table} (`);
  expect(start).toBeGreaterThanOrEqual(0);
  return migration.slice(start, migration.indexOf('\n);\n', start) + 3);
}

/** Column names of one CREATE TABLE, in order. */
function columnsOf(table: string): string[] {
  return tableBody(table)
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => /^[a-z_]+ /.test(line) && !line.startsWith('CONSTRAINT'))
    .map((line) => line.split(' ')[0]);
}

/** One function's full CREATE statement, through its closing dollar tag. */
function functionText(sql: string, name: string, tag: string): string {
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const close = sql.indexOf(`$${tag}$;`, start);
  expect(close).toBeGreaterThan(start);
  return sql.slice(start, close + tag.length + 3);
}

/** The text between a function's opening and closing dollar tags: what Postgres stores as prosrc. */
function functionBody(sql: string, tag: string): string {
  const open = `AS $${tag}$`;
  const start = sql.indexOf(open);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf(`$${tag}$;`, start + open.length);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start + open.length, end);
}

/** One CHECK's full statement, by constraint name. */
function checkStatement(name: string): string {
  const match = flat.match(new RegExp(`ADD CONSTRAINT ${name} CHECK [^;]*;`));
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

/** CHECK constraint names the migration defines on one table, in file order. */
function migrationCheckNames(table?: string): string[] {
  const pattern = table
    ? new RegExp(`ALTER TABLE ${table.replace('.', '\\.')} ADD CONSTRAINT (\\w+) CHECK`, 'g')
    : /ADD CONSTRAINT (\w+) CHECK/g;
  return [...flat.matchAll(pattern)].map((match) => match[1]);
}

/** The column list of the GRANT SELECT (…) ON TABLE <table> TO authenticated. */
function ownerGrantColumns(sql: string, table: string): string[] {
  const match = sql.replace(/\s+/g, ' ').match(new RegExp(`GRANT SELECT \\(([^)]*)\\) ON TABLE ${table.replace('.', '\\.')} TO authenticated;`));
  expect(match).not.toBeNull();
  return match ? match[1].split(',').map((column) => column.trim()) : [];
}

/**
 * B-1 guard (copied from the slice 3 test). PL/pgSQL ends an IF / ELSIF
 * condition at the first THEN not inside parentheses, so a bare CASE in the
 * condition is cut at its own THEN and the block fails with 42601.
 */
function bareCaseInIfConditions(sql: string): string[] {
  const code = sql.replace(/'[^']*'/g, (literal) => `'${' '.repeat(literal.length - 2)}'`);
  const wordAt = (word: string, i: number) =>
    code.startsWith(word, i) && !/\w/.test(code[i - 1] ?? '') && !/\w/.test(code[i + word.length] ?? '');
  const found: string[] = [];
  for (const match of code.matchAll(/\b(?:ELSIF|IF)\b/g)) {
    const at = match.index ?? 0;
    if (/\bEND\s+$/.test(code.slice(Math.max(0, at - 8), at))) continue;
    let depth = 0;
    for (let i = at + match[0].length; i < code.length; i += 1) {
      const ch = code[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      else if (ch === ';' && depth === 0) break;
      else if (depth === 0 && wordAt('THEN', i)) break;
      else if (depth === 0 && wordAt('CASE', i)) {
        const lineEnd = sql.indexOf('\n', at);
        found.push(sql.slice(at, lineEnd > 0 ? lineEnd : sql.length).trim());
        break;
      }
    }
  }
  return found;
}

const recordFn = functionText(migration, 'business_os_record_credit_lot', 'record_lot');
const reverseFn = functionText(migration, 'business_os_reverse_credit_lot', 'reverse_lot');
const reverseBody = functionBody(migration, 'reverse_lot');
const allColumns = () => new Set([...columnsOf(LOTS), ...columnsOf(DRAWS)]);

describe('SQL-editor safety (the user pastes all four files by hand)', () => {
  const files: Array<[string, string]> = [
    ['migration', MIGRATION],
    ['rollback', ROLLBACK],
    ['checker', CHECKER],
    ['probe', PROBE],
  ];

  it.each(files)('%s exists', (_name, file) => {
    expect(existsSync(file)).toBe(true);
  });

  it.each(files)('%s has no line comment and no block comment', (_name, file) => {
    const text = read(file);
    expect(text).not.toContain('--');
    expect(text).not.toContain('/*');
  });

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals (COMMENT text included, W11a-6)', (_name, file) => {
    for (const literal of literalsOf(read(file))) {
      expect({ literal, ok: /^[A-Za-z0-9_ ]*$/.test(literal) }).toEqual({ literal, ok: true });
    }
  });

  it.each(files)('%s uses no single-letter alias', (_name, file) => {
    expect(read(file)).not.toMatch(/\b(?:FROM|JOIN)\s+[\w.]+\s+(?:AS\s+)?[a-z]\b(?!\w)/i);
    expect(read(file)).not.toMatch(/\bINTO\s+[\w.]+\s+AS\s+[a-z]\b(?!\w)/i);
  });

  it.each(files)('%s never puts a bare CASE inside an IF or ELSIF condition (B-1: 42601)', (_name, file) => {
    expect(bareCaseInIfConditions(read(file))).toEqual([]);
  });

  it('the B-1 guard still flags a bare CASE (negative control)', () => {
    expect(bareCaseInIfConditions("BEGIN IF v_x = CASE WHEN v_y THEN 'a' ELSE 'b' END THEN NULL; END IF; END")).toHaveLength(1);
    expect(bareCaseInIfConditions("BEGIN IF v_x = (CASE WHEN v_y THEN 'a' ELSE 'b' END) THEN NULL; END IF; END")).toEqual([]);
  });

  it.each(files)('%s names no Pilot-Credit or token table', (_name, file) => {
    const text = read(file);
    for (const table of ['token_usage', 'user_subscriptions', 'credit_transactions', 'billing_events']) {
      expect(text).not.toContain(table);
    }
  });

  it('every colon in a stored key or the lock key is spelled chr(58), in brackets next to a comparison (OP-1, W11a-1)', () => {
    for (const text of [migration, checker, probe]) {
      expect(text).not.toMatch(/'(admin_grant|boost|admin_reversal|business_os_credit_lots):/);
      // A comparison (not a PL/pgSQL `:=` assignment) must bracket the concatenation.
      expect(text).not.toMatch(/(?:[^:<>!]=|<>) '(admin_grant|boost|admin_reversal)' \|\| chr\(58\)/);
    }
    // Negative control: the guard catches the unbracketed form and lets an assignment through.
    const unbracketed = /(?:[^:<>!]=|<>) '(admin_grant|boost|admin_reversal)' \|\| chr\(58\)/;
    expect("left(idempotency_key, 12) = 'admin_grant' || chr(58)").toMatch(unbracketed);
    expect("v_key text := 'admin_grant' || chr(58) || v_id").not.toMatch(unbracketed);
  });
});

describe('one migration, two tables, two functions, one transaction', () => {
  it('is wrapped in exactly one BEGIN … COMMIT with a lock timeout, plain CREATE (a second paste fails and changes nothing)', () => {
    expect(flat.trim().startsWith("BEGIN; SET LOCAL lock_timeout = '5s';")).toBe(true);
    expect(flat.trim().endsWith('COMMIT;')).toBe(true);
    expect(flat.match(/\bBEGIN;/g)).toHaveLength(1);
    expect(flat.match(/\bCOMMIT;/g)).toHaveLength(1);
    expect(flat.match(/CREATE TABLE/g)).toHaveLength(2);
    expect(flat.match(/CREATE FUNCTION/g)).toHaveLength(2);
    expect(flat).not.toMatch(/IF NOT EXISTS/i);
    expect(flat).not.toMatch(/OR REPLACE/i);
  });

  it('G1: names none of the four charge-path objects', () => {
    for (const name of CHARGE_PATH_NAMES) expect(migration).not.toContain(name);
    expect(read(ROLLBACK)).not.toMatch(/business_os_credit_charges|business_os_credit_totals|business_os_record_credit_charge|business_os_credit_period_start/);
  });

  it('touches nothing but its own objects and holds no data', () => {
    expect(flat.replace(/ON DELETE SET NULL/g, '')).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/);
    expect(flat).not.toMatch(/\bUPDATE\b/);
    for (const alter of flat.match(/ALTER TABLE [\w.]+/g) ?? []) {
      expect([`ALTER TABLE ${LOTS}`, `ALTER TABLE ${DRAWS}`]).toContain(alter);
    }
    expect(flat.match(/INSERT INTO [\w.]+/g)).toEqual([`INSERT INTO ${LOTS}`, `INSERT INTO ${DRAWS}`]);
    expect(recordFn).toContain(`INSERT INTO ${LOTS}`);
    expect(recordFn).not.toContain(`INSERT INTO ${DRAWS}`);
    expect(reverseFn).toContain(`INSERT INTO ${DRAWS}`);
    expect(reverseFn).not.toContain(`INSERT INTO ${LOTS}`);
  });

  it('creates no trigger and nothing SECURITY DEFINER (tenant-isolation-guard Step 4)', () => {
    expect(flat).not.toMatch(/\bTRIGGER\b/i);
    expect(flat).not.toMatch(/SECURITY DEFINER/i);
  });
});

describe('the lots table (SA-11 "The tables", §3.1)', () => {
  it('has exactly the specified columns, in order', () => {
    expect(columnsOf(LOTS)).toEqual([
      'id',
      'user_id',
      'source',
      'credits_granted',
      'credits_base',
      'credits_bonus',
      'credit_value_version',
      'expires_at',
      'idempotency_key',
      'source_ref',
      'actor_kind',
      'actor_admin_id',
      'reason',
      'created_at',
    ]);
  });

  it('types and nullability: numeric(18,6) on every credit column; user_id, expires_at, source_ref, actor_admin_id, reason nullable', () => {
    const body = tableBody(LOTS);
    expect(body).toContain('  id uuid NOT NULL DEFAULT gen_random_uuid(),\n');
    expect(body).toContain('  user_id uuid,\n');
    expect(body).toContain('  source text NOT NULL,\n');
    for (const column of ['credits_granted', 'credits_base', 'credits_bonus']) {
      expect(body).toContain(`  ${column} numeric(18,6) NOT NULL,\n`);
    }
    expect(body).toContain('  credit_value_version integer NOT NULL,\n');
    expect(body).toContain('  expires_at timestamptz,\n');
    expect(body).toContain('  idempotency_key text NOT NULL,\n');
    expect(body).toContain('  source_ref uuid,\n');
    expect(body).toContain('  actor_kind text NOT NULL,\n');
    expect(body).toContain('  actor_admin_id uuid,\n');
    expect(body).toContain('  reason text,\n');
    expect(body).toContain('  created_at timestamptz NOT NULL DEFAULT now(),\n');
    expect(body).toContain('CONSTRAINT business_os_credit_lots_pkey PRIMARY KEY (id)');
  });

  it('the idempotency key is a plain UNIQUE constraint (the ON CONFLICT target), never a partial index', () => {
    expect(flat).toContain(`ALTER TABLE ${LOTS} ADD CONSTRAINT business_os_credit_lots_idempotency_key_key UNIQUE (idempotency_key);`);
    expect(flat).not.toMatch(/CREATE UNIQUE INDEX/i);
  });

  it('exactly the twelve named CHECKs, each with its specified text', () => {
    const expected: Record<string, string> = {
      business_os_credit_lots_source_known: "CHECK (source IN ('admin_grant', 'boost_purchase'));",
      business_os_credit_lots_actor_kind_known: "CHECK (actor_kind IN ('admin', 'stripe_webhook'));",
      business_os_credit_lots_amounts_are_numbers: "CHECK (credits_granted <> 'NaN' AND credits_base <> 'NaN' AND credits_bonus <> 'NaN');",
      business_os_credit_lots_granted_positive: 'CHECK (credits_granted > 0);',
      business_os_credit_lots_parts_not_negative: 'CHECK (credits_base >= 0 AND credits_bonus >= 0);',
      business_os_credit_lots_parts_add_up: 'CHECK (credits_base + credits_bonus = credits_granted);',
      business_os_credit_lots_version_not_negative: 'CHECK (credit_value_version >= 0);',
      business_os_credit_lots_expiry_after_creation: 'CHECK (expires_at IS NULL OR expires_at > created_at);',
      business_os_credit_lots_idempotency_key_length: 'CHECK (char_length(idempotency_key) BETWEEN 1 AND 200);',
      business_os_credit_lots_reason_length: 'CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500);',
      business_os_credit_lots_admin_grant_shape:
        "CHECK (source <> 'admin_grant' OR (actor_kind = 'admin' AND actor_admin_id IS NOT NULL AND reason IS NOT NULL AND source_ref IS NULL AND credits_bonus = 0 AND left(idempotency_key, 12) = ('admin_grant' || chr(58))));",
      business_os_credit_lots_boost_purchase_shape:
        "CHECK (source <> 'boost_purchase' OR (actor_kind = 'stripe_webhook' AND actor_admin_id IS NULL AND reason IS NULL AND source_ref IS NOT NULL AND left(idempotency_key, 6) = ('boost' || chr(58))));",
    };
    expect(migrationCheckNames(LOTS)).toEqual(Object.keys(expected));
    for (const [name, text] of Object.entries(expected)) {
      expect(checkStatement(name)).toBe(`ADD CONSTRAINT ${name} ${text}`);
    }
  });

  it('the key prefix lengths match the prefixes (12 = admin_grant plus a colon, 6 = boost plus a colon)', () => {
    expect('admin_grant:'.length).toBe(12);
    expect('boost:'.length).toBe(6);
    expect('admin_reversal:'.length).toBe(15);
  });

  it('user_id → auth.users ON DELETE SET NULL; no FK on actor_admin_id or source_ref', () => {
    expect(flat).toContain(
      `ALTER TABLE ${LOTS} ADD CONSTRAINT business_os_credit_lots_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;`
    );
    expect(flat).not.toMatch(/FOREIGN KEY \((actor_admin_id|source_ref)\)/);
    expect(flat).not.toMatch(/REFERENCES public\.business_profiles/);
  });

  it('the (user_id, created_at) index', () => {
    expect(flat).toContain(`CREATE INDEX business_os_credit_lots_user_created_idx ON ${LOTS} (user_id, created_at);`);
  });
});

describe('the draws table (SA-11, S11-SQ-2)', () => {
  it('has exactly the specified columns, in order, with types and nullability', () => {
    expect(columnsOf(DRAWS)).toEqual(['id', 'lot_id', 'user_id', 'kind', 'credits', 'reason', 'actor_admin_id', 'idempotency_key', 'created_at']);
    const body = tableBody(DRAWS);
    expect(body).toContain('  lot_id uuid NOT NULL,\n');
    expect(body).toContain('  user_id uuid,\n');
    expect(body).toContain('  kind text NOT NULL,\n');
    expect(body).toContain('  credits numeric(18,6) NOT NULL,\n');
    expect(body).toContain('  reason text,\n');
    expect(body).toContain('  actor_admin_id uuid,\n');
    expect(body).toContain('  idempotency_key text NOT NULL,\n');
    expect(body).toContain('  created_at timestamptz NOT NULL DEFAULT now(),\n');
  });

  it('G2: kind admits reversal only (slice 9 adds consumption with its own columns)', () => {
    expect(checkStatement('business_os_credit_lot_draws_kind_known')).toContain("CHECK (kind IN ('reversal'));");
    expect(migration).not.toMatch(/'consumption'/);
  });

  it('exactly the six named CHECKs, each with its specified text', () => {
    const expected: Record<string, string> = {
      business_os_credit_lot_draws_kind_known: "CHECK (kind IN ('reversal'));",
      business_os_credit_lot_draws_credits_is_number: "CHECK (credits <> 'NaN');",
      business_os_credit_lot_draws_credits_positive: 'CHECK (credits > 0);',
      business_os_credit_lot_draws_idempotency_key_length: 'CHECK (char_length(idempotency_key) BETWEEN 1 AND 200);',
      business_os_credit_lot_draws_reason_length: 'CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 3 AND 500);',
      business_os_credit_lot_draws_reversal_shape:
        "CHECK (kind <> 'reversal' OR (reason IS NOT NULL AND actor_admin_id IS NOT NULL AND left(idempotency_key, 15) = ('admin_reversal' || chr(58))));",
    };
    expect(migrationCheckNames(DRAWS)).toEqual(Object.keys(expected));
    for (const [name, text] of Object.entries(expected)) {
      expect(checkStatement(name)).toBe(`ADD CONSTRAINT ${name} ${text}`);
    }
  });

  it('lot_id → lots (no ON DELETE action: lots are never removed); user_id → auth.users ON DELETE SET NULL; no FK on actor_admin_id', () => {
    expect(flat).toContain(
      `ALTER TABLE ${DRAWS} ADD CONSTRAINT business_os_credit_lot_draws_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES ${LOTS} (id);`
    );
    expect(flat).toContain(
      `ALTER TABLE ${DRAWS} ADD CONSTRAINT business_os_credit_lot_draws_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;`
    );
    expect(flat.match(/FOREIGN KEY/g)).toHaveLength(3);
  });

  it('the idempotency key is UNIQUE, and both draw indexes exist', () => {
    expect(flat).toContain(`ALTER TABLE ${DRAWS} ADD CONSTRAINT business_os_credit_lot_draws_idempotency_key_key UNIQUE (idempotency_key);`);
    expect(flat).toContain(`CREATE INDEX business_os_credit_lot_draws_lot_idx ON ${DRAWS} (lot_id);`);
    expect(flat).toContain(`CREATE INDEX business_os_credit_lot_draws_user_created_idx ON ${DRAWS} (user_id, created_at);`);
    expect(flat.match(/CREATE INDEX/g)).toHaveLength(3);
  });

  it('no CHECK on either table names user_id, so ON DELETE SET NULL can never violate one (slice 3 SF-1)', () => {
    for (const name of migrationCheckNames()) {
      expect({ name, namesUserId: /\buser_id\b/.test(checkStatement(name)) }).toEqual({ name, namesUserId: false });
    }
  });
});

describe('the database comments (W11a-6)', () => {
  it('states append-only, the only writer and the lock key in words', () => {
    const tableComment = flat.match(new RegExp(`COMMENT ON TABLE ${LOTS.replace('.', '\\.')} IS '([^']*)';`))?.[1] ?? '';
    expect(tableComment).toMatch(/Append only and never changed in place/);
    expect(tableComment).toMatch(/Written only through business_os_record_credit_lot/);
    expect(tableComment).toMatch(/hashtextextended of business_os_credit_lots then a colon then the user id with seed 0/);
    expect(tableComment).toMatch(/Lots never touch the credit charge ledger/);
    const drawsComment = flat.match(new RegExp(`COMMENT ON TABLE ${DRAWS.replace('.', '\\.')} IS '([^']*)';`))?.[1] ?? '';
    expect(drawsComment).toMatch(/Written only through business_os_reverse_credit_lot/);
  });
});

describe('RLS and privileges (§3.3, G5)', () => {
  it('RLS on both tables, one owner SELECT policy each, evaluated once per statement', () => {
    expect(flat).toContain(`ALTER TABLE ${LOTS} ENABLE ROW LEVEL SECURITY;`);
    expect(flat).toContain(`ALTER TABLE ${DRAWS} ENABLE ROW LEVEL SECURITY;`);
    expect(flat.match(/CREATE POLICY [^;]*;/g)).toEqual([
      `CREATE POLICY business_os_credit_lots_owner_select ON ${LOTS} FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);`,
      `CREATE POLICY business_os_credit_lot_draws_owner_select ON ${DRAWS} FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);`,
    ]);
  });

  it('REVOKE ALL from each of the four roles on every object, and never an enumerated REVOKE (the MAINTAIN defect)', () => {
    const revokes = flat.match(/REVOKE [^;]*;/g) ?? [];
    const expected: string[] = [];
    for (const target of [`TABLE ${LOTS}`, `TABLE ${DRAWS}`, `FUNCTION ${RECORD_FN}`, `FUNCTION ${REVERSE_FN}`]) {
      for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
        expected.push(`REVOKE ALL ON ${target} FROM ${role};`);
      }
    }
    expect([...revokes].sort()).toEqual([...expected].sort());
    expect(flat).not.toMatch(/REVOKE\s+(?!ALL\b)/i);
  });

  it('exactly six GRANTs, each after every REVOKE of its object', () => {
    expect(flat.match(/GRANT [^;]*;/g)).toEqual([
      `GRANT SELECT (${OWNER_LOT_COLUMNS.join(', ')}) ON TABLE ${LOTS} TO authenticated;`,
      `GRANT SELECT (${OWNER_DRAW_COLUMNS.join(', ')}) ON TABLE ${DRAWS} TO authenticated;`,
      `GRANT SELECT, INSERT ON TABLE ${LOTS} TO service_role;`,
      `GRANT SELECT, INSERT ON TABLE ${DRAWS} TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${RECORD_FN} TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${REVERSE_FN} TO service_role;`,
    ]);
    for (const table of [LOTS, DRAWS]) {
      const lastRevoke = flat.lastIndexOf(`REVOKE ALL ON TABLE ${table} FROM`);
      expect(flat.indexOf(`ON TABLE ${table} TO authenticated;`)).toBeGreaterThan(lastRevoke);
      expect(flat.indexOf(`ON TABLE ${table} TO service_role;`)).toBeGreaterThan(lastRevoke);
    }
    for (const fn of [RECORD_FN, REVERSE_FN]) {
      expect(flat.indexOf(`GRANT EXECUTE ON FUNCTION ${fn}`)).toBeGreaterThan(flat.lastIndexOf(`REVOKE ALL ON FUNCTION ${fn}`));
    }
  });

  it('the owner GRANT lines each sit on one line of their own (11d parses them, S11-SQ-10)', () => {
    for (const table of [LOTS, DRAWS]) {
      expect(migration).toMatch(new RegExp(`\\nGRANT SELECT \\([^)\\n]*\\) ON TABLE ${table.replace('.', '\\.')} TO authenticated;\\n`));
    }
  });

  it('authenticated gets NO table-level SELECT (it would override the column list), and anon or PUBLIC nothing', () => {
    expect(flat).not.toMatch(/GRANT SELECT ON TABLE [\w.]+ TO authenticated/);
    expect(flat).not.toMatch(/GRANT [^;(]*\bTO (anon|PUBLIC)\b/i);
    expect(flat).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
  });

  it('the owner column lists are exactly SA-11s, so reason, actor, key, source_ref and version stay hidden', () => {
    expect(ownerGrantColumns(migration, LOTS)).toEqual(OWNER_LOT_COLUMNS);
    expect(ownerGrantColumns(migration, DRAWS)).toEqual(OWNER_DRAW_COLUMNS);
    for (const hidden of ['reason', 'actor_kind', 'actor_admin_id', 'idempotency_key', 'source_ref', 'credit_value_version']) {
      expect(ownerGrantColumns(migration, LOTS)).not.toContain(hidden);
      expect(ownerGrantColumns(migration, DRAWS)).not.toContain(hidden);
    }
  });

  it('append-only by privilege: no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER is granted to anyone', () => {
    for (const grant of flat.match(/GRANT [^;]*;/g) ?? []) {
      expect(grant).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|REFERENCES|TRIGGER|ALL)\b/);
    }
  });
});

describe('the record function (§3.2)', () => {
  it('has the exact signature and attributes', () => {
    expect(recordFn).toContain(
      'business_os_record_credit_lot(\n  p_user_id uuid,\n  p_source text,\n  p_credits_base numeric,\n  p_credits_bonus numeric,\n  p_credit_value_version integer,\n  p_expires_at timestamptz,\n  p_idempotency_key text,\n  p_source_ref uuid,\n  p_actor_kind text,\n  p_actor_admin_id uuid,\n  p_reason text\n)'
    );
    expect(recordFn).toContain('RETURNS TABLE (out_recorded boolean, out_lot_id uuid)');
    expect(recordFn).toMatch(/LANGUAGE plpgsql\nVOLATILE\nSECURITY INVOKER\nSET search_path = ''\nAS \$record_lot\$/);
  });

  it('OUT columns are out_*, and no parameter or variable shares a name with a column of either table (slice 3 C-2)', () => {
    const outNames = (recordFn.match(/RETURNS TABLE \(([^)]*)\)/)?.[1] ?? '').split(',').map((part) => part.trim().split(' ')[0]);
    expect(outNames).toEqual(['out_recorded', 'out_lot_id']);
    const columns = allColumns();
    for (const name of outNames) expect(columns.has(name)).toBe(false);
    const declared = [...recordFn.matchAll(/\b([pv]_[a-z_]+)\b/g)].map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(10);
    for (const name of declared) expect(columns.has(name)).toBe(false);
    expect(recordFn).not.toContain('#variable_conflict');
  });

  it('refuses a NULL user or key with 22004', () => {
    expect(recordFn).toContain('IF p_user_id IS NULL OR p_idempotency_key IS NULL THEN');
    expect(recordFn).toContain("USING ERRCODE = '22004'");
  });

  it('rounds once to 6 dp and stores granted as base plus bonus', () => {
    expect(recordFn).toContain('v_base := round(p_credits_base, 6);');
    expect(recordFn).toContain('v_bonus := round(p_credits_bonus, 6);');
    expect(recordFn).toContain('v_granted := v_base + v_bonus;');
    const afterRound = recordFn.slice(recordFn.indexOf('v_granted := v_base + v_bonus;'));
    expect(afterRound).not.toMatch(/\bp_credits_(base|bonus)\b/);
  });

  it('is idempotent on the key: ON CONFLICT DO NOTHING, then the replay compares account, source and amount, else 23505', () => {
    const recordFlat = recordFn.replace(/\s+/g, ' ');
    expect(recordFlat).toContain('ON CONFLICT (idempotency_key) DO NOTHING RETURNING lot_row.id INTO v_lot_id;');
    expect(recordFlat).toContain(
      'IF v_existing_id IS NOT NULL AND v_existing_user = p_user_id AND v_existing_source = p_source AND v_existing_granted = v_granted THEN'
    );
    expect(recordFlat).toContain("RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'idempotency key reused for a different lot';");
  });

  it('every name in the body is schema-qualified', () => {
    for (const body of [recordFn, reverseFn]) {
      for (const match of body.matchAll(/\b(?:FROM|INTO|JOIN)\s+([a-z_][\w.]*)/g)) {
        const name = match[1];
        // Variables and parameters (`INTO v_x`, `IS DISTINCT FROM p_user_id`) are not relations.
        if (name.startsWith('v_') || name.startsWith('p_')) continue;
        expect(name).toMatch(/^public\./);
      }
    }
  });
});

describe('the reverse function (§3.2, OP-3 to OP-5, W11a-3)', () => {
  it('has the exact signature and attributes', () => {
    expect(reverseFn).toContain(
      'business_os_reverse_credit_lot(\n  p_user_id uuid,\n  p_lot_id uuid,\n  p_credits numeric,\n  p_idempotency_key text,\n  p_actor_admin_id uuid,\n  p_reason text\n)'
    );
    expect(reverseFn).toContain(
      'RETURNS TABLE (out_status text, out_draw_id uuid, out_credits numeric, out_remaining_before numeric, out_remaining_after numeric)'
    );
    expect(reverseFn).toMatch(/LANGUAGE plpgsql\nVOLATILE\nSECURITY INVOKER\nSET search_path = ''\nAS \$reverse_lot\$/);
  });

  it('no parameter, variable or OUT column shares a name with a column (slice 3 C-2)', () => {
    const columns = allColumns();
    const declared = [...reverseFn.matchAll(/\b((?:p|v|out)_[a-z_]+)\b/g)].map((match) => match[1]);
    expect(declared.length).toBeGreaterThan(10);
    for (const name of declared) expect(columns.has(name)).toBe(false);
  });

  it('refuses a NULL user, lot or key with 22004 before the lock (OP-4)', () => {
    const nullCheck = reverseBody.indexOf('IF p_user_id IS NULL OR p_lot_id IS NULL OR p_idempotency_key IS NULL THEN');
    expect(nullCheck).toBeGreaterThan(0);
    expect(nullCheck).toBeLessThan(reverseBody.indexOf('pg_advisory_xact_lock'));
    expect(reverseBody.slice(nullCheck, reverseBody.indexOf('END IF;', nullCheck))).toContain("USING ERRCODE = '22004'");
  });

  it('takes the per-account advisory lock, spelled exactly, before any read (S11-CR-4, W11a-2)', () => {
    const lock = "PERFORM pg_advisory_xact_lock(hashtextextended('business_os_credit_lots' || chr(58) || p_user_id::text, 0));";
    expect(reverseBody.split(lock)).toHaveLength(2);
    const lockAt = reverseBody.indexOf(lock);
    const firstRead = reverseBody.search(/\bSELECT\b/);
    expect(firstRead).toBeGreaterThan(lockAt);
    expect(reverseBody.indexOf('FOR UPDATE')).toBe(-1);
  });

  it('the steps run in SA order: key, lot, expiry, remaining, amount, insert', () => {
    const positions = [
      reverseBody.indexOf('WHERE draw_row.idempotency_key = p_idempotency_key;'),
      reverseBody.indexOf("out_status := 'lot_not_found';"),
      reverseBody.indexOf("out_status := 'lot_expired';"),
      reverseBody.indexOf("out_status := 'nothing_left';"),
      reverseBody.indexOf("out_status := 'exceeds_remaining';"),
      reverseBody.indexOf(`INSERT INTO ${DRAWS}`),
    ];
    for (const at of positions) expect(at).toBeGreaterThan(0);
    expect([...positions].sort((left, right) => left - right)).toEqual(positions);
  });

  it('answers with the six statuses and no other', () => {
    const assigned = [...reverseBody.matchAll(/out_status := '(\w+)';/g)].map((match) => match[1]);
    expect([...new Set(assigned)].sort()).toEqual([...STATUSES].sort());
  });

  it('a replay answers already_recorded with the original draw and the remaining now as both figures (OP-3); a foreign replay raises 23505', () => {
    const replay = reverseBody.slice(reverseBody.indexOf('IF v_existing_draw_id IS NOT NULL THEN'), reverseBody.indexOf("out_status := 'already_recorded';") + 200);
    expect(replay).toContain('IF v_existing_lot_id = p_lot_id AND v_existing_user = p_user_id THEN');
    expect(replay).toContain('out_draw_id := v_existing_draw_id;');
    expect(replay).toContain('out_credits := v_existing_credits;');
    expect(replay).toContain('out_remaining_before := v_remaining;');
    expect(replay).toContain('out_remaining_after := v_remaining;');
    expect(reverseBody.replace(/\s+/g, ' ')).toContain(
      "RETURN; END IF; RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'idempotency key reused for a different lot'; END IF;"
    );
  });

  it('a foreign lot gets exactly the missing-lot answer, with no figures', () => {
    expect(reverseBody).toContain('IF NOT v_lot_found OR v_lot_user IS DISTINCT FROM p_user_id THEN');
    const branch = reverseBody.slice(reverseBody.indexOf('IF NOT v_lot_found'), reverseBody.indexOf('END IF;', reverseBody.indexOf('IF NOT v_lot_found')));
    expect(branch.replace(/\s+/g, ' ').trim()).toBe(
      "IF NOT v_lot_found OR v_lot_user IS DISTINCT FROM p_user_id THEN out_status := 'lot_not_found'; RETURN NEXT; RETURN;"
    );
  });

  it('expired means expires_at <= now(), the same <= as creditLots.ts', () => {
    expect(reverseBody).toContain('(lot_row.expires_at IS NOT NULL AND lot_row.expires_at <= now())');
    expect(reverseBody).not.toMatch(/expires_at < now\(\)/);
  });

  it('NULL credits means the rest; NaN, then zero or less, raise 22023 (W11a-3, OP-5)', () => {
    const amount = reverseBody.slice(reverseBody.indexOf('IF p_credits IS NULL THEN'));
    expect(amount).toMatch(/^IF p_credits IS NULL THEN\n\s+v_credits := v_remaining;\n\s+ELSE\n\s+v_credits := round\(p_credits, 6\);/);
    const nan = amount.indexOf("IF v_credits = 'NaN' THEN");
    const notPositive = amount.indexOf('IF v_credits <= 0 THEN');
    const exceeds = amount.indexOf('IF v_credits > v_remaining THEN');
    expect(nan).toBeGreaterThan(0);
    expect(notPositive).toBeGreaterThan(nan);
    expect(exceeds).toBeGreaterThan(notPositive);
    expect(amount.slice(nan, notPositive)).toContain("USING ERRCODE = '22023'");
    expect(amount.slice(notPositive, exceeds)).toContain("USING ERRCODE = '22023'");
  });

  it('inserts only kind reversal, on the caller account, and reports before and after', () => {
    const insert = reverseBody.slice(reverseBody.indexOf(`INSERT INTO ${DRAWS}`)).replace(/\s+/g, ' ');
    expect(insert).toContain(
      "VALUES ( p_lot_id, p_user_id, 'reversal', v_credits, p_reason, p_actor_admin_id, p_idempotency_key ) RETURNING draw_row.id INTO v_draw_id;"
    );
    expect(insert).toContain('out_remaining_before := v_remaining; out_remaining_after := v_remaining - v_credits;');
  });
});

describe('the read-only checker (L1 to L10)', () => {
  it('is read-only and ends in one SELECT', () => {
    expect(checker.trim().startsWith('SET default_transaction_read_only = on;')).toBe(true);
    const code = checker.replace(/'[^']*'/g, "''");
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REVOKE|CREATE|TRUNCATE)\b/);
    expect(checker.match(/;/g)).toHaveLength(2);
  });

  it('holds every row L1 to L10 and a verdict', () => {
    for (const id of ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L9', 'L10']) {
      expect(checker).toContain(`'${id} `);
    }
    expect(checker).toContain("'VERDICT'");
  });

  it('reads privileges with aclexplode (table and column level), so MAINTAIN, TRUNCATE, REFERENCES and TRIGGER are all seen', () => {
    expect(checker).toContain('aclexplode(lot_tables.table_acl)');
    expect(checker).toContain('aclexplode(pg_attribute.attacl)');
    expect(checker).toContain("('UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')");
    expect(checker).toContain("table_acl_entries.privilege_name NOT IN ('SELECT', 'INSERT')");
  });

  it('its owner column lists equal the migration GRANT lines, and its counts match the migration', () => {
    const lotsList = checker.match(/lot_tables\.table_name = 'business_os_credit_lots' AND pg_attribute\.attname::text IN \(([^)]*)\)/)?.[1] ?? '';
    const drawsList = checker.match(/lot_tables\.table_name = 'business_os_credit_lot_draws' AND pg_attribute\.attname::text IN \(([^)]*)\)/)?.[1] ?? '';
    expect(literalsOf(lotsList)).toEqual(ownerGrantColumns(migration, LOTS));
    expect(literalsOf(drawsList)).toEqual(ownerGrantColumns(migration, DRAWS));
    const all = columnsOf(LOTS).length + columnsOf(DRAWS).length;
    const readable = OWNER_LOT_COLUMNS.length + OWNER_DRAW_COLUMNS.length;
    expect(checkerFlat).toContain(`column_summary.total = ${all} AND column_summary.owner_may_read_count = ${readable}`);
    expect(checkerFlat).toContain(`column_summary.owner_readable = ${readable} THEN`);
  });

  it('its CHECK lists are exactly the CHECKs the migration defines per table, so the two cannot drift', () => {
    const listFor = (table: string) => {
      const marker = `pg_constraint.conrelid IN (SELECT ${table}.table_oid FROM ${table}) AND pg_constraint.conname IN (`;
      const start = checker.indexOf(marker);
      expect(start).toBeGreaterThanOrEqual(0);
      const open = start + marker.length - 1;
      return literalsOf(checker.slice(open, checker.indexOf(')', open) + 1));
    };
    const lots = migrationCheckNames(LOTS);
    const draws = migrationCheckNames(DRAWS);
    expect([...listFor('lots_table')].sort()).toEqual([...lots].sort());
    expect([...listFor('draws_table')].sort()).toEqual([...draws].sort());
    expect(checkerFlat).toContain(`constraint_summary.lots_named_checks = ${lots.length} AND constraint_summary.draws_named_checks = ${draws.length} AND constraint_summary.all_checks = ${lots.length + draws.length}`);
    expect(checkerFlat).toContain(`all ${lots.length + draws.length} check constraints present`);
  });

  it('names every constraint, index, foreign key, policy and function of the migration (drift guard)', () => {
    for (const match of flat.matchAll(/ADD CONSTRAINT (\w+) /g)) expect(checker).toContain(`'${match[1]}'`);
    for (const match of flat.matchAll(/CONSTRAINT (\w+_pkey) PRIMARY KEY/g)) expect(checker).toContain(`'${match[1]}'`);
    for (const match of flat.matchAll(/CREATE INDEX (\w+) /g)) expect(checker).toContain(`'${match[1]}'`);
    for (const match of flat.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)) expect(checker).toContain(`'${match[1]}'`);
    for (const match of flat.matchAll(/CREATE POLICY \w+ ON public\.(\w+) /g)) expect(checker).toContain(`'${match[1]}'`);
    expect(checker).toContain("pg_constraint.confdeltype = 'n'");
    expect(checker).toContain("pg_constraint.confdeltype = 'a'");
  });

  it('L5 compares each function exact argument types and names, in order', () => {
    expect(checker).toContain(
      "array_to_string(pg_proc.proargtypes::regtype[], ' ') = 'uuid text numeric numeric integer timestamp with time zone text uuid text uuid text'"
    );
    expect(checker).toContain("array_to_string(pg_proc.proargtypes::regtype[], ' ') = 'uuid uuid numeric text uuid text'");
    const names = (fn: string) =>
      [...functionText(migration, fn, fn === 'business_os_record_credit_lot' ? 'record_lot' : 'reverse_lot').matchAll(/\b((?:p|out)_[a-z_]+) (?:uuid|text|numeric|integer|timestamptz|boolean)\b/g)].map(
        (match) => match[1]
      );
    expect(checker).toContain(`array_to_string(pg_proc.proargnames, ' ') = '${names('business_os_record_credit_lot').join(' ')}'`);
    expect(checker).toContain(`array_to_string(pg_proc.proargnames, ' ') = '${names('business_os_reverse_credit_lot').join(' ')}'`);
  });

  it('L7 covers (a) to (e), the account comparison both ways', () => {
    expect(checker).toContain('WHERE lot_remaining.remaining < 0');
    expect(checker).toContain('WHERE draw_row.user_id IS DISTINCT FROM lot_row.user_id');
    expect(checker).toContain('WHERE draw_row.created_at < lot_row.created_at');
    expect(checker).toContain('FULL OUTER JOIN account_totals ON account_totals.account_key = remaining_by_account.account_key');
    expect(checker).toContain("left(lot_row.idempotency_key, 12) <> ('admin_grant' || chr(58))");
    expect(checker).toContain("left(lot_row.idempotency_key, 6) <> ('boost' || chr(58))");
    expect(checker).toContain("left(draw_row.idempotency_key, 15) <> ('admin_reversal' || chr(58))");
  });

  it('L9 prints the first lot in UTC with a utc suffix, and the empty-state wording the runbook quotes', () => {
    expect(checker).toContain("COALESCE((lot_counts.first_created_at AT TIME ZONE 'UTC')::text || ' utc', 'none')");
    expect(checker).toContain(
      "lot_counts.lot_rows || ' lots and ' || lot_counts.draw_rows || ' draws and ' || lot_counts.accounts || ' accounts and ' || lot_counts.unexpired_credits || ' unexpired credits and first lot at '"
    );
  });
});

describe('L8: the charge path is pinned to 20261015 (T11a.4, OP-7, W11a-5)', () => {
  const charges = read(CHARGES_MIGRATION).replace(/\r/g, '');
  const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');
  const recordMd5 = md5(functionBody(charges, 'record'));
  const periodMd5 = md5(functionBody(charges, 'period'));

  /** Column names of one CREATE TABLE in 20261015, in order. */
  function chargeColumns(table: string): string[] {
    const start = charges.indexOf(`CREATE TABLE ${table} (`);
    expect(start).toBeGreaterThanOrEqual(0);
    return charges
      .slice(start, charges.indexOf('\n);\n', start))
      .split('\n')
      .slice(1)
      .map((line) => line.trim())
      .filter((line) => /^[a-z_]+ /.test(line) && !line.startsWith('CONSTRAINT'))
      .map((line) => line.split(' ')[0]);
  }

  it('the checker holds exactly the md5 of both function bodies, compared without carriage returns', () => {
    expect(recordMd5).toMatch(/^[0-9a-f]{32}$/);
    expect(checker).toContain(
      `pg_proc.proname = 'business_os_record_credit_charge' AND md5(replace(pg_proc.prosrc, chr(13), '')) = '${recordMd5}'`
    );
    expect(checker).toContain(
      `pg_proc.proname = 'business_os_credit_period_start' AND md5(replace(pg_proc.prosrc, chr(13), '')) = '${periodMd5}'`
    );
    expect(checker.match(/md5\(/g)).toHaveLength(2);
  });

  it('the workplan §6.7 constants are these two values', () => {
    const workplan = read(join(ROOT, 'docs', 'workplans', 'BUSINESS_OS_CREDIT_DEDUCTION_SLICE_11_WORKPLAN.md'));
    expect(workplan).toContain(recordMd5);
    expect(workplan).toContain(periodMd5);
  });

  it('the checker column lists equal the charges and totals columns of 20261015, in order', () => {
    expect(checker).toContain(
      `charge_table_columns.charges_columns = '${chargeColumns('public.business_os_credit_charges').join(' ')}'`
    );
    expect(checker).toContain(`charge_table_columns.totals_columns = '${chargeColumns('public.business_os_credit_totals').join(' ')}'`);
  });

  it('no other SQL file under supabase/migrations or supabase/SQL Scripts names the charge objects: a change there must re-pin L8 on purpose', () => {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (entry.endsWith('.sql')) out.push(path);
      }
      return out;
    };
    // Re-pinned on purpose (Admin AI Activity slice B0', PR #195): two index-only files on
    // business_os_credit_charges. They create/drop indexes and nothing else, so the charge path
    // L8 pins (functions, columns, grants) is unchanged; the test below keeps them index-only.
    const indexOnly = [
      join(MIGRATIONS_DIR, '20261026_business_os_credit_charges_activity_indexes.sql'),
      join(SQL_SCRIPTS_DIR, '20261026_business_os_credit_charges_activity_indexes_rollback.sql'),
    ];
    // Re-pinned on purpose (test-account cleanup OX-1r, 2026-10-07): the generated cleanup
    // function names the charge and totals tables only to count and delete ONE test account's
    // rows by user_id. It defines no charge function, column or grant, so what L8 pins is unchanged.
    // 20261042 (plan payments P-3b.1) is the next version of that same generated function, and its
    // rollback restores the 20261041 one: same reason, nothing on the charge path changes.
    const testAccountCleanup = [
      join(MIGRATIONS_DIR, '20261041_operator_test_account_cleanup.sql'),
      join(MIGRATIONS_DIR, '20261042_operator_test_account_cleanup_billing_events.sql'),
      join(SQL_SCRIPTS_DIR, '20261042_operator_test_account_cleanup_billing_events_rollback.sql'),
    ];
    const allowed = new Set(
      [CHARGES_MIGRATION, CHARGES_ROLLBACK, ...indexOnly, ...testAccountCleanup].map((file) => relative(ROOT, file))
    );
    const files = [...walk(MIGRATIONS_DIR), ...walk(SQL_SCRIPTS_DIR)];
    expect(files.length).toBeGreaterThan(20);
    const namers = files
      .map((file) => relative(ROOT, file))
      .filter((rel) => !allowed.has(rel))
      .filter((rel) => CHARGE_PATH_NAMES.some((name) => readFileSync(join(ROOT, rel), 'utf8').includes(name)))
      .map((rel) => rel.split(sep).join('/'));
    expect(namers).toEqual([]);
    for (const file of indexOnly) {
      const statements = read(file)
        .replace(/\r/g, '')
        .replace(/--[^\n]*/g, '')
        .split(';')
        .map((statement) => statement.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      for (const statement of statements) {
        expect(statement).toMatch(/^(BEGIN|COMMIT|SET LOCAL lock_timeout = '1s'|CREATE INDEX IF NOT EXISTS business_os_credit_charges_\w+ ON public\.business_os_credit_charges \(|DROP INDEX IF EXISTS public\.business_os_credit_charges_\w+$)/);
      }
    }
  });
});

describe('the mandatory write probe (P00 to P18)', () => {
  it('is one DO block that always ends in an error, so nothing it writes can be kept', () => {
    expect(probe.trim().startsWith('DO $probe$')).toBe(true);
    expect(probe.trim().endsWith('$probe$;')).toBe(true);
    expect(probeFlat).not.toMatch(/\bCOMMIT\b/);
    const lastStatement = probeFlat.slice(probeFlat.lastIndexOf('RAISE EXCEPTION'));
    expect(lastStatement).toMatch(/^RAISE EXCEPTION USING MESSAGE = 'PROBE ' \|\| CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END/);
    expect(lastStatement).toContain('this error is expected and rolls everything back');
  });

  it('runs on the user own account, the placeholder on the third line', () => {
    expect(probe.split('\n')[2]).toBe("  v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';");
    expect(probe).toContain('FROM auth.users AS auth_user WHERE auth_user.id = v_owner');
    expect(probe).not.toMatch(/INSERT INTO auth\./);
  });

  it('the four guards come in order, before any role switch or write', () => {
    const order = [
      probe.indexOf("IF position('YOUR_OWN_USER_ID' IN v_owner_text) > 0 THEN"),
      probe.indexOf('EXCEPTION WHEN invalid_text_representation THEN'),
      probe.indexOf("IF current_setting('transaction_read_only') = 'on' THEN"),
      probe.indexOf("RAISE EXCEPTION 'PROBE SKIPPED  that user id is not an account on this database';"),
      probe.indexOf('SET LOCAL ROLE service_role;'),
      probe.indexOf('business_os_record_credit_lot('),
    ];
    for (const at of order) expect(at).toBeGreaterThan(0);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    expect(probe).toContain("'PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE with your own user id");
    expect(probe).toContain("'PROBE SKIPPED  the pasted value is not a valid user id ");
    expect(probe).toContain("'PROBE SKIPPED  this session is read only  open a new SQL editor tab or run RESET default_transaction_read_only");
  });

  it('acts as service_role for every write, then as authenticated through the slice 3 claims form', () => {
    const service = probe.indexOf('SET LOCAL ROLE service_role;');
    const authenticated = probe.indexOf('SET LOCAL ROLE authenticated;');
    expect(authenticated).toBeGreaterThan(service);
    expect(probe.indexOf('business_os_reverse_credit_lot(')).toBeGreaterThan(service);
    expect(probe.match(/set_config\(concat_ws\(chr\(46\), 'request', 'jwt', 'claims'\),/g)).toHaveLength(2);
  });

  it('holds P00 to P18 with the right kind of line', () => {
    for (let id = 0; id <= 18; id += 1) {
      const label = `P${String(id).padStart(2, '0')}`;
      const kind = id === 0 || id === 18 ? 'INFO' : 'PASS';
      expect({ label, found: probe.includes(`'${label} ${kind} `) }).toEqual({ label, found: true });
    }
  });

  it('W11a-1: P01, P07 and P08 read back the stored key and check its prefix', () => {
    expect(probe).toContain("AND v_stored.idempotency_key = v_grant_key\n     AND left(v_stored.idempotency_key, 12) = ('admin_grant' || chr(58)) THEN");
    expect(probe).toContain("v_draw_key = v_boost_key AND left(v_draw_key, 6) = ('boost' || chr(58))");
    expect(probe).toContain("AND v_draw_key = v_reverse_key AND left(v_draw_key, 15) = ('admin_reversal' || chr(58))");
  });

  it('G2: every draw the probe asks for goes through the reverse function, and only reversal is written', () => {
    expect(probe.match(/INSERT INTO public\.business_os_credit_lot_draws/g)).toHaveLength(1);
    const asOwner = probe.slice(probe.indexOf('SET LOCAL ROLE authenticated;'));
    expect(asOwner).toContain('INSERT INTO public.business_os_credit_lot_draws');
    expect(probe).not.toMatch(/'consumption'/);
  });

  it('P14: UPDATE, DELETE and TRUNCATE on each table, each refused to service_role', () => {
    const service = probe.slice(probe.indexOf('SET LOCAL ROLE service_role;'), probe.indexOf('SET LOCAL ROLE authenticated;'));
    for (const statement of [
      'UPDATE public.business_os_credit_lots SET',
      'DELETE FROM public.business_os_credit_lots WHERE',
      'TRUNCATE public.business_os_credit_lots;',
      'UPDATE public.business_os_credit_lot_draws SET',
      'DELETE FROM public.business_os_credit_lot_draws WHERE',
      'TRUNCATE public.business_os_credit_lot_draws;',
    ]) {
      const at = service.indexOf(statement);
      expect({ statement, found: at > 0 }).toEqual({ statement, found: true });
      expect(service.slice(at, service.indexOf('END;', at))).toContain('EXCEPTION WHEN insufficient_privilege THEN');
    }
  });

  it('P15: as the owner, inserts, EXECUTE and the hidden columns all fail 42501', () => {
    const asOwner = probe.slice(probe.indexOf('SET LOCAL ROLE authenticated;'));
    expect(asOwner).toContain('INSERT INTO public.business_os_credit_lots (');
    expect(asOwner).toContain('PERFORM public.business_os_record_credit_lot(');
    expect(asOwner).toContain('PERFORM public.business_os_reverse_credit_lot(');
    expect(asOwner).toContain('SELECT lot_row.reason INTO');
    expect(asOwner).toContain('SELECT lot_row.idempotency_key INTO');
    expect(asOwner.match(/EXCEPTION WHEN insufficient_privilege THEN/g)?.length).toBeGreaterThanOrEqual(7);
  });

  it('P13 and P16: a stranger id gets lot_not_found and sees nothing', () => {
    expect(probe).toContain('business_os_reverse_credit_lot(v_stranger, ');
    expect(probe).toContain("v_status_result.out_status = 'lot_not_found'");
    expect(probe).toContain("json_build_object('sub', v_stranger::text, 'role', 'authenticated')");
  });
});

describe('the rollback', () => {
  it('lives outside supabase/migrations, locks both tables, refuses when rows exist, then drops exactly four objects', () => {
    expect(ROLLBACK).not.toContain(join('supabase', 'migrations'));
    expect(rollbackFlat).toBe(
      "BEGIN; SET LOCAL lock_timeout = '5s'; " +
        `LOCK TABLE ${LOTS} IN ACCESS EXCLUSIVE MODE; LOCK TABLE ${DRAWS} IN ACCESS EXCLUSIVE MODE; ` +
        `DO $refuse$ BEGIN IF EXISTS (SELECT 1 FROM ${LOTS} AS lot_row) OR EXISTS (SELECT 1 FROM ${DRAWS} AS draw_row) THEN ` +
        "RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED the credit lots tables hold rows so nothing was dropped'; END IF; END $refuse$; " +
        `DROP FUNCTION ${REVERSE_FN}; DROP FUNCTION ${RECORD_FN}; DROP TABLE ${DRAWS}; DROP TABLE ${LOTS}; COMMIT;`
    );
    expect(rollbackFlat.match(/\bDROP\b/g)).toHaveLength(4);
    expect(rollbackFlat.lastIndexOf('LOCK TABLE')).toBeLessThan(rollbackFlat.indexOf('IF EXISTS'));
    expect(rollbackFlat.indexOf('RAISE EXCEPTION')).toBeLessThan(rollbackFlat.indexOf('DROP '));
  });
});

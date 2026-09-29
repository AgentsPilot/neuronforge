/**
 * Guard over the Business OS credit ledger migration (credit deduction
 * slice 3b-i; workplan BUSINESS_OS_CREDIT_DEDUCTION_SLICE_3_WORKPLAN.md §3.2 to
 * §3.5, §6, and SA conditions C-1 to C-4, SF-1, Q-1, Q-3, Q-8, Q-9).
 *
 * NOT AI-SPECIFIC (user decision 2026-09-29): every chargeable action of any
 * service is charged to ONE credit pool per account. The ledger row carries a
 * `service` identifier (format-checked, not enumerated); the totals row is per
 * account and period, never per service. Slice 3 records only `'ai'`.
 *
 * WHY A TEST OVER SQL TEXT. Jest cannot run PL/pgSQL and there is no branch
 * database: the user pastes the migration into the Supabase SQL editor on PROD,
 * runs `scripts/check-bos-credit-charges-migration.sql` (read-only) and then the
 * mandatory write probe `scripts/probe-bos-credit-charges-migration.sql` (C-1),
 * which is the only execution of the RPC before production traffic reaches it.
 * What can be proven from the files alone is pinned here: the security shape
 * (REVOKE ALL, column-level owner SELECT, INVOKER functions, no trigger), the
 * PL/pgSQL name-clash trap (C-2), the totals invariant (C-3), the UTC period
 * arithmetic (Q-1), and that the checker and the probe have not drifted from
 * the migration they claim to verify.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261015_business_os_credit_charges.sql');
const ROLLBACK = join(ROOT, 'supabase', 'SQL Scripts', '20261015_business_os_credit_charges_rollback.sql');
const CHECKER = join(ROOT, 'scripts', 'check-bos-credit-charges-migration.sql');
const PROBE = join(ROOT, 'scripts', 'probe-bos-credit-charges-migration.sql');

const read = (file: string) => readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const migration = read(MIGRATION);
const flat = migration.replace(/\s+/g, ' ');
const checker = read(CHECKER);
const checkerFlat = checker.replace(/\s+/g, ' ');
const probe = read(PROBE);
const probeFlat = probe.replace(/\s+/g, ' ');

const CHARGES = 'public.business_os_credit_charges';
const TOTALS = 'public.business_os_credit_totals';
const RECORD_FN = 'public.business_os_record_credit_charge(uuid, uuid, uuid, text, text, text, text, numeric, numeric, integer, boolean)';
const PERIOD_FN = 'public.business_os_credit_period_start(timestamptz, timestamptz)';

/** Columns an owner must never read through the API (Q-9). */
const HIDDEN_FROM_OWNERS = ['cost_usd', 'is_fallback_priced', 'cost_usd_total', 'fallback_priced_count'];

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
function functionText(name: string, tag: string): string {
  const start = migration.indexOf(`CREATE FUNCTION public.${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const close = migration.indexOf(`$${tag}$;`, start);
  expect(close).toBeGreaterThan(start);
  return migration.slice(start, close + tag.length + 3);
}

/** One CHECK's full statement, by constraint name. */
function checkStatement(name: string): string {
  const match = flat.match(new RegExp(`ADD CONSTRAINT ${name} CHECK [^;]*;`));
  expect(match).not.toBeNull();
  return match ? match[0] : '';
}

/** CHECK constraint names the migration defines, in file order. */
function migrationCheckNames(): string[] {
  return [...migration.matchAll(/ADD CONSTRAINT (\w+) CHECK/g)].map((match) => match[1]);
}

/** The column list of the GRANT SELECT (…) ON TABLE <table> TO authenticated. */
function ownerGrantColumns(table: string): string[] {
  const match = flat.match(new RegExp(`GRANT SELECT \\(([^)]*)\\) ON TABLE ${table.replace('.', '\\.')} TO authenticated;`));
  expect(match).not.toBeNull();
  return match ? match[1].split(',').map((column) => column.trim()) : [];
}

/**
 * B-1 guard. PL/pgSQL ends an IF / ELSIF condition at the first THEN that is
 * not inside parentheses, so a bare `CASE WHEN … THEN … END` in the condition
 * is cut at the CASE's own THEN and the whole block fails with 42601. For each
 * IF / ELSIF (not END IF), scan to its terminating depth-0 THEN (or a depth-0
 * `;`, which means it was DDL `IF [NOT] EXISTS`, not a condition), ignoring
 * string literals, and report any CASE met at depth 0 on the way. Keywords are
 * matched upper case only, which is how every file under guard writes them.
 */
function bareCaseInIfConditions(sql: string): string[] {
  // Blank every literal's contents first, so a keyword or a bracket inside a
  // string can neither start a scan nor move the depth.
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

const recordFn = functionText('business_os_record_credit_charge', 'record');
const periodFn = functionText('business_os_credit_period_start', 'period');

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

  it.each(files)('%s holds only letters, digits, underscores and spaces inside string literals', (_name, file) => {
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

  it('the B-1 guard flags the committed defect and accepts its parenthesised fix (negative control)', () => {
    const defect = "IF v_source = CASE WHEN v_anchor IS NOT NULL THEN 'plan' ELSE 'calendar_month' END AND v_ok THEN";
    const fixed = "IF v_source = (CASE WHEN v_anchor IS NOT NULL THEN 'plan' ELSE 'calendar_month' END) AND v_ok THEN";
    expect(bareCaseInIfConditions(`BEGIN ${defect} NULL; END IF; END`)).toHaveLength(1);
    expect(bareCaseInIfConditions(`BEGIN ELSIF v_ok THEN NULL; ELSIF ${defect.slice(3)} NULL; END IF; END`)).toHaveLength(1);
    expect(bareCaseInIfConditions(`BEGIN ${fixed} NULL; END IF; END`)).toEqual([]);
    expect(bareCaseInIfConditions('DROP TABLE IF EXISTS x; SELECT CASE WHEN true THEN 1 END;')).toEqual([]);
    expect(bareCaseInIfConditions(`IF v_ok THEN v_x := CASE WHEN v_ok THEN 1 ELSE 2 END; END IF;`)).toEqual([]);
  });

  it('the B-1 guard covers both function bodies of the migration', () => {
    expect(bareCaseInIfConditions(recordFn)).toEqual([]);
    expect(bareCaseInIfConditions(periodFn)).toEqual([]);
  });

  it.each(files)('%s names no Pilot-Credit or token table (FR-11, FR-14, AC-11, AC-30)', (_name, file) => {
    const text = read(file);
    for (const table of ['token_usage', 'user_subscriptions', 'credit_transactions', 'billing_events']) {
      expect(text).not.toContain(table);
    }
  });
});

describe('one migration, two tables, one transaction', () => {
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

  it('touches nothing but its own objects and holds no data', () => {
    // The two foreign-key actions are the only place DELETE may appear.
    expect(flat.replace(/ON DELETE (SET NULL|CASCADE)/g, '')).not.toMatch(/\b(DROP|TRUNCATE|DELETE)\b/);
    expect(flat).not.toMatch(/\bUPDATE public\./);
    for (const alter of flat.match(/ALTER TABLE [\w.]+/g) ?? []) {
      expect([`ALTER TABLE ${CHARGES}`, `ALTER TABLE ${TOTALS}`]).toContain(alter);
    }
    const inserts = flat.match(/INSERT INTO [\w.]+/g) ?? [];
    expect(inserts).toEqual([`INSERT INTO ${CHARGES}`, `INSERT INTO ${TOTALS}`]);
    expect(recordFn).toContain(`INSERT INTO ${CHARGES}`);
    expect(recordFn).toContain(`INSERT INTO ${TOTALS}`);
  });

  it('creates no trigger and nothing SECURITY DEFINER (tenant-isolation-guard Step 4, SA-S8)', () => {
    expect(flat).not.toMatch(/\bTRIGGER\b/i);
    expect(flat).not.toMatch(/SECURITY DEFINER/i);
  });
});

describe('the charge table: a thin row with a kind (FR-13, SQ-15, §3.2)', () => {
  it('has exactly the thin-row columns, in order', () => {
    expect(columnsOf(CHARGES)).toEqual([
      'id',
      'kind',
      'action_id',
      'adjusts_action_id',
      'reason_code',
      'user_id',
      'period_start',
      'group_id',
      'credits',
      'cost_usd',
      'credit_value_version',
      'is_fallback_priced',
      'service',
      'action_type',
      'triggered_by',
      'outcome',
      'created_at',
    ]);
  });

  it('carries no tokens, models, call names, areas, prompts or error codes', () => {
    expect(tableBody(CHARGES)).not.toMatch(/\b(token|tokens|model|models|call_name|area|prompt|error_code|errcode|details|metadata)\b/i);
  });

  it('stores credits at 6 dp and cost at 10 dp (SQ-8), and user_id is nullable (Q-8 minimise)', () => {
    const body = tableBody(CHARGES);
    expect(body).toContain('credits numeric(18,6) NOT NULL,');
    expect(body).toContain('cost_usd numeric(16,10) NOT NULL,');
    expect(body).toContain('period_start timestamptz NOT NULL,');
    expect(body).toMatch(/\n {2}user_id uuid,\n/);
    expect(body).toMatch(/\n {2}action_id uuid,\n/);
    expect(body).toMatch(/\n {2}group_id uuid,\n/);
  });

  it('action_id is UNIQUE as a plain constraint (the idempotency key and the self-FK target), never a partial index', () => {
    expect(flat).toContain(`ALTER TABLE ${CHARGES} ADD CONSTRAINT business_os_credit_charges_action_id_key UNIQUE (action_id);`);
    expect(flat).not.toMatch(/CREATE UNIQUE INDEX/i);
  });

  it('group_id is indexed and NOT unique (SQ-15 (2))', () => {
    expect(flat).toContain(`CREATE INDEX business_os_credit_charges_group_idx ON ${CHARGES} (group_id);`);
    expect(flat).toContain(`CREATE INDEX business_os_credit_charges_user_period_idx ON ${CHARGES} (user_id, period_start, created_at DESC);`);
    expect(flat).not.toMatch(/UNIQUE \(group_id\)/);
  });

  it('user_id → auth.users ON DELETE SET NULL (the minimise verdict, Q-8); adjusts_action_id → the charge table (SF-1)', () => {
    expect(flat).toContain(
      `ALTER TABLE ${CHARGES} ADD CONSTRAINT business_os_credit_charges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE SET NULL;`
    );
    expect(flat).toContain(
      `ALTER TABLE ${CHARGES} ADD CONSTRAINT business_os_credit_charges_adjusts_action_id_fkey FOREIGN KEY (adjusts_action_id) REFERENCES ${CHARGES} (action_id);`
    );
    expect(flat).not.toMatch(/REFERENCES public\.business_profiles/);
  });

  it('the kind domain and both shape CHECKs', () => {
    expect(checkStatement('business_os_credit_charges_kind_known')).toContain("CHECK (kind IN ('charge', 'adjustment'));");
    expect(checkStatement('business_os_credit_charges_charge_shape')).toContain(
      "CHECK (kind <> 'charge' OR (action_id IS NOT NULL AND group_id IS NOT NULL AND service IS NOT NULL AND action_type IS NOT NULL AND triggered_by IS NOT NULL AND outcome IS NOT NULL AND adjusts_action_id IS NULL AND reason_code IS NULL AND credits >= 0 AND cost_usd >= 0));"
    );
    expect(checkStatement('business_os_credit_charges_adjustment_shape')).toContain(
      "CHECK (kind <> 'adjustment' OR (action_id IS NULL AND adjusts_action_id IS NOT NULL AND reason_code IS NOT NULL AND service IS NULL AND action_type IS NULL AND triggered_by IS NULL AND outcome IS NULL AND is_fallback_priced IS FALSE));"
    );
  });

  it('SF-1 / Q-8: no CHECK names user_id, so ON DELETE SET NULL can never violate one', () => {
    for (const name of migrationCheckNames()) {
      expect({ name, namesUserId: /\buser_id\b/.test(checkStatement(name)) }).toEqual({ name, namesUserId: false });
    }
  });

  it('closed trigger and outcome lists (SQ-15 (3)); action_type format-checked, not enumerated', () => {
    expect(checkStatement('business_os_credit_charges_triggered_by_known')).toContain(
      "CHECK (triggered_by IS NULL OR triggered_by IN ('owner', 'scheduled', 'external'));"
    );
    expect(checkStatement('business_os_credit_charges_outcome_known')).toContain(
      "CHECK (outcome IS NULL OR outcome IN ('succeeded', 'failed'));"
    );
    expect(checkStatement('business_os_credit_charges_action_type_format')).toContain('char_length(action_type) BETWEEN 1 AND 64');
    expect(checkStatement('business_os_credit_charges_action_type_format')).not.toContain('chat_turn');
  });

  it('service: required on a charge, NULL on an adjustment, format-checked like action_type and never enumerated', () => {
    expect(tableBody(CHARGES)).toMatch(/\n {2}service text,\n/);
    const format = checkStatement('business_os_credit_charges_service_format');
    expect(format).toContain(
      "CHECK (service IS NULL OR (char_length(service) BETWEEN 1 AND 64 AND position(left(service, 1) IN 'abcdefghijklmnopqrstuvwxyz') > 0 AND translate(service, 'abcdefghijklmnopqrstuvwxyz0123456789_', '') = ''));"
    );
    // Same rule as action_type, character for character: only the column differs.
    expect(format.replace(/service/g, 'X')).toBe(
      checkStatement('business_os_credit_charges_action_type_format').replace(/action_type/g, 'X')
    );
    // Not a closed list: no service name appears in any CHECK.
    for (const name of migrationCheckNames()) {
      expect(checkStatement(name)).not.toMatch(/'ai'|notification/);
    }
  });

  it('one credit pool: the totals row is per account and period, with no service column or key', () => {
    expect(columnsOf(TOTALS)).not.toContain('service');
    expect(tableBody(TOTALS)).toContain('PRIMARY KEY (user_id, period_start)');
    expect(recordFn.replace(/\s+/g, ' ')).toContain('ON CONFLICT (user_id, period_start) DO UPDATE SET');
  });

  it('the database says the ledger is not AI-specific, group_id is for every service, and is_fallback_priced is service-neutral', () => {
    const escaped = CHARGES.replace('.', '\\.');
    const tableComment = flat.match(new RegExp(`COMMENT ON TABLE ${escaped} IS '([^']*)';`))?.[1];
    expect(tableComment).toMatch(/every chargeable action of any service/);
    expect(tableComment).toMatch(/One credit pool per account/);
    expect(tableComment).not.toMatch(/\bAI\b/);
    const columnComment = (column: string) =>
      flat.match(new RegExp(`COMMENT ON COLUMN ${escaped}\\.${column} IS '([^']*)';`))?.[1];
    expect(columnComment('service')).toMatch(/not a closed list/);
    expect(columnComment('service')).toMatch(/NULL on adjustment rows which inherit the service of the charge they adjust/);
    expect(columnComment('group_id')).toMatch(/for any service/);
    expect(columnComment('group_id')).toMatch(/even for a group of one/);
    expect(columnComment('is_fallback_priced')).toMatch(/^True when the cost was priced from a fallback rate rather than the measured one /);
    expect(columnComment('is_fallback_priced')).toMatch(/only if it defines its own documented fallback and otherwise records false/);
    expect(columnComment('is_fallback_priced')).not.toMatch(/AI specific|every other service/);
  });

  it('NaN cannot be stored (NaN >= 0 is TRUE in Postgres, so the shape CHECK alone would let it through)', () => {
    expect(checkStatement('business_os_credit_charges_amounts_are_numbers')).toContain("CHECK (credits <> 'NaN' AND cost_usd <> 'NaN');");
  });
});

describe('C-3: the totals table and its invariant', () => {
  it('has the per-trigger split, the adjustment bucket and the counts', () => {
    expect(columnsOf(TOTALS)).toEqual([
      'user_id',
      'period_start',
      'credits_total',
      'credits_owner',
      'credits_scheduled',
      'credits_external',
      'credits_adjustment',
      'cost_usd_total',
      'charge_count',
      'fallback_priced_count',
      'created_at',
      'updated_at',
    ]);
    expect(tableBody(TOTALS)).toContain('CONSTRAINT business_os_credit_totals_pkey PRIMARY KEY (user_id, period_start)');
  });

  it('credits_total = owner + scheduled + external + adjustment, as a CHECK', () => {
    expect(checkStatement('business_os_credit_totals_credits_add_up')).toContain(
      'CHECK (credits_total = credits_owner + credits_scheduled + credits_external + credits_adjustment);'
    );
  });

  it('states what each summed column sums, adjustments included or excluded, in the database itself', () => {
    const sums: Record<string, RegExp> = {
      credits_total: /ALL ledger rows .* including adjustments/,
      credits_owner: /charge rows with triggered_by owner but not adjustment rows/,
      credits_scheduled: /charge rows with triggered_by scheduled but not adjustment rows/,
      credits_external: /charge rows with triggered_by external but not adjustment rows/,
      credits_adjustment: /adjustment rows/,
      cost_usd_total: /ALL ledger rows .* including adjustments/,
      charge_count: /Adjustment rows are not counted/,
      fallback_priced_count: /is_fallback_priced true/,
    };
    for (const [column, meaning] of Object.entries(sums)) {
      const match = flat.match(new RegExp(`COMMENT ON COLUMN ${TOTALS.replace('.', '\\.')}\\.${column} IS '([^']*)';`));
      expect({ column, found: match !== null }).toEqual({ column, found: true });
      expect(match?.[1]).toMatch(meaning);
    }
  });

  it('user_id → auth.users ON DELETE CASCADE (derived data, the delete verdict, Q-8)', () => {
    expect(flat).toContain(
      `ALTER TABLE ${TOTALS} ADD CONSTRAINT business_os_credit_totals_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users (id) ON DELETE CASCADE;`
    );
  });
});

describe('RLS and privileges (SA-S8, Q-9, C-4)', () => {
  it('RLS on both tables, one owner SELECT policy each, evaluated once per statement', () => {
    expect(flat).toContain(`ALTER TABLE ${CHARGES} ENABLE ROW LEVEL SECURITY;`);
    expect(flat).toContain(`ALTER TABLE ${TOTALS} ENABLE ROW LEVEL SECURITY;`);
    expect(flat.match(/CREATE POLICY [^;]*;/g)).toEqual([
      `CREATE POLICY business_os_credit_charges_owner_select ON ${CHARGES} FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);`,
      `CREATE POLICY business_os_credit_totals_owner_select ON ${TOTALS} FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);`,
    ]);
  });

  it('REVOKE ALL from each of the four roles on every object, and never an enumerated REVOKE (the MAINTAIN defect)', () => {
    const revokes = flat.match(/REVOKE [^;]*;/g) ?? [];
    const expected: string[] = [];
    for (const target of [`TABLE ${CHARGES}`, `TABLE ${TOTALS}`, `FUNCTION ${PERIOD_FN}`, `FUNCTION ${RECORD_FN}`]) {
      for (const role of ['PUBLIC', 'anon', 'authenticated', 'service_role']) {
        expected.push(`REVOKE ALL ON ${target} FROM ${role};`);
      }
    }
    expect([...revokes].sort()).toEqual([...expected].sort());
    expect(flat).not.toMatch(/REVOKE\s+(?!ALL\b)/i);
  });

  it('exactly six GRANTs, each after every REVOKE of its object', () => {
    expect(flat.match(/GRANT [^;]*;/g)).toEqual([
      `GRANT SELECT (${ownerGrantColumns(CHARGES).join(', ')}) ON TABLE ${CHARGES} TO authenticated;`,
      `GRANT SELECT (${ownerGrantColumns(TOTALS).join(', ')}) ON TABLE ${TOTALS} TO authenticated;`,
      `GRANT SELECT, INSERT ON TABLE ${CHARGES} TO service_role;`,
      `GRANT SELECT, INSERT, UPDATE ON TABLE ${TOTALS} TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${PERIOD_FN} TO service_role;`,
      `GRANT EXECUTE ON FUNCTION ${RECORD_FN} TO service_role;`,
    ]);
    expect(flat.indexOf('GRANT SELECT (')).toBeGreaterThan(flat.indexOf(`REVOKE ALL ON TABLE ${TOTALS} FROM service_role;`));
    expect(flat.indexOf(`GRANT EXECUTE ON FUNCTION ${PERIOD_FN}`)).toBeGreaterThan(
      flat.lastIndexOf(`REVOKE ALL ON FUNCTION ${PERIOD_FN}`)
    );
    expect(flat.indexOf(`GRANT EXECUTE ON FUNCTION ${RECORD_FN}`)).toBeGreaterThan(
      flat.lastIndexOf(`REVOKE ALL ON FUNCTION ${RECORD_FN}`)
    );
  });

  it('C-4: authenticated gets NO table-level SELECT (it would override the column list)', () => {
    expect(flat).not.toMatch(/GRANT SELECT ON TABLE [\w.]+ TO authenticated/);
    expect(flat).not.toMatch(/GRANT [^;(]*\bTO (anon|PUBLIC)\b/i);
    expect(flat).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*TO authenticated/);
  });

  it('Q-9: the owner column lists are every column EXCEPT the cost and fallback columns', () => {
    for (const table of [CHARGES, TOTALS]) {
      const expected = columnsOf(table).filter((column) => !HIDDEN_FROM_OWNERS.includes(column));
      expect(ownerGrantColumns(table)).toEqual(expected);
    }
    expect(ownerGrantColumns(CHARGES)).toContain('service');
    expect(ownerGrantColumns(CHARGES)).not.toContain('cost_usd');
    expect(ownerGrantColumns(CHARGES)).not.toContain('is_fallback_priced');
    expect(ownerGrantColumns(TOTALS)).not.toContain('cost_usd_total');
    expect(ownerGrantColumns(TOTALS)).not.toContain('fallback_priced_count');
  });

  it('service_role cannot UPDATE, DELETE or TRUNCATE a charge row: rows are never changed, by privilege', () => {
    const charges = flat.match(new RegExp(`GRANT [^;]* ON TABLE ${CHARGES.replace('.', '\\.')} TO service_role;`));
    expect(charges?.[0]).toBe(`GRANT SELECT, INSERT ON TABLE ${CHARGES} TO service_role;`);
  });
});

describe('the period function (Q-1, T-6)', () => {
  it('is SECURITY INVOKER, STABLE and pins an empty search_path', () => {
    expect(periodFn).toContain('RETURNS timestamptz');
    expect(periodFn).toMatch(/LANGUAGE plpgsql\nSTABLE\nSECURITY INVOKER\nSET search_path = ''\nAS \$period\$/);
  });

  it('(a) converts to the UTC wall clock, and back, in both directions', () => {
    expect(periodFn).toContain("v_anchor_utc := p_anchor AT TIME ZONE 'UTC';");
    expect(periodFn).toContain("v_at_utc := p_at AT TIME ZONE 'UTC';");
    expect(periodFn).toContain("RETURN v_candidate_utc AT TIME ZONE 'UTC';");
    expect(periodFn).toMatch(/v_anchor_utc timestamp;\n\s+v_at_utc timestamp;/);
    expect(periodFn).toMatch(/v_candidate_utc timestamp;/);
    expect(periodFn).not.toMatch(/v_\w+ timestamptz/);
  });

  it('(b) counts n from the anchor, never chains month to month', () => {
    expect(periodFn.match(/v_candidate_utc := v_anchor_utc \+ make_interval\(months => v_months\);/g)).toHaveLength(2);
    expect(periodFn).not.toMatch(/v_candidate_utc := v_candidate_utc/);
    expect(periodFn).toContain('v_months := v_months - 1;');
  });

  it('never does timestamptz + interval (the session-TimeZone-dependent form)', () => {
    expect(periodFn).not.toMatch(/p_(anchor|at) [+-]/);
  });
});

describe('the write RPC (SQ-1, SQ-2, C-2)', () => {
  it('is SECURITY INVOKER, VOLATILE and pins an empty search_path', () => {
    expect(recordFn).toMatch(/LANGUAGE plpgsql\nVOLATILE\nSECURITY INVOKER\nSET search_path = ''\nAS \$record\$/);
  });

  it('C-2: OUT columns are named out_*, and none equals a column of either table (no 42702 on the first call)', () => {
    const match = recordFn.match(/RETURNS TABLE \(([^)]*)\)/);
    expect(match).not.toBeNull();
    const outNames = (match?.[1] ?? '').split(',').map((part) => part.trim().split(' ')[0]);
    expect(outNames).toEqual(['out_recorded', 'out_period_start', 'out_anchor_source']);
    const tableColumns = new Set([...columnsOf(CHARGES), ...columnsOf(TOTALS)]);
    for (const name of outNames) expect(tableColumns.has(name)).toBe(false);
  });

  it('C-2: no parameter or variable shares a name with a column either', () => {
    const tableColumns = new Set([...columnsOf(CHARGES), ...columnsOf(TOTALS)]);
    const declared = [...recordFn.matchAll(/\b([pv]_[a-z_]+)\b/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(10);
    for (const name of declared) expect(tableColumns.has(name)).toBe(false);
    expect(recordFn).not.toContain('#variable_conflict');
  });

  it('takes typed scalars only: no jsonb, no kind parameter (tenant-isolation-guard Step 3)', () => {
    expect(recordFn).not.toMatch(/jsonb/i);
    expect(recordFn).not.toMatch(/p_kind/);
    expect(recordFn).toContain(
      'p_action_id uuid,\n  p_user_id uuid,\n  p_group_id uuid,\n  p_service text,\n  p_action_type text,\n  p_triggered_by text,\n  p_outcome text,\n  p_credits numeric,\n  p_cost_usd numeric,\n  p_credit_value_version integer,\n  p_is_fallback_priced boolean\n)'
    );
  });

  it('refuses a NULL action, user or group id, or service', () => {
    expect(recordFn).toContain('IF p_action_id IS NULL OR p_user_id IS NULL OR p_group_id IS NULL OR p_service IS NULL THEN');
    expect(recordFn).toContain("USING ERRCODE = '22004'");
  });

  it('kind is hard-coded charge: this RPC cannot write an adjustment', () => {
    const values = recordFn.slice(recordFn.indexOf(`INSERT INTO ${CHARGES}`));
    expect(values).toMatch(/VALUES \(\n\s+'charge', p_action_id, p_user_id, v_period,/);
  });

  it('stores p_service in the service column, and adds it to no total (one credit pool)', () => {
    const recordFlat = recordFn.replace(/\s+/g, ' ');
    expect(recordFlat).toContain('credit_value_version, is_fallback_priced, service, action_type, triggered_by, outcome )');
    expect(recordFlat).toContain('p_credit_value_version, p_is_fallback_priced, p_service, p_action_type, p_triggered_by, p_outcome )');
    const totals = recordFlat.slice(recordFlat.indexOf(`INSERT INTO ${TOTALS}`));
    expect(totals).not.toContain('p_service');
  });

  it('idempotent on the action id; totals move only when a row was inserted', () => {
    const recordFlat = recordFn.replace(/\s+/g, ' ');
    expect(recordFlat).toContain('ON CONFLICT (action_id) DO NOTHING RETURNING charge_row.id INTO v_inserted_id;');
    const guard = recordFlat.indexOf('IF v_inserted_id IS NOT NULL THEN');
    expect(guard).toBeGreaterThan(recordFlat.indexOf('ON CONFLICT (action_id) DO NOTHING'));
    expect(recordFlat.indexOf(`INSERT INTO ${TOTALS}`)).toBeGreaterThan(guard);
    expect(recordFlat).toContain('out_recorded := v_inserted_id IS NOT NULL;');
  });

  it('the totals upsert is a single row-locked add of every summed column', () => {
    const recordFlat = recordFn.replace(/\s+/g, ' ');
    expect(recordFlat).toContain('ON CONFLICT (user_id, period_start) DO UPDATE SET');
    for (const column of [
      'credits_total',
      'credits_owner',
      'credits_scheduled',
      'credits_external',
      'cost_usd_total',
      'charge_count',
      'fallback_priced_count',
    ]) {
      expect(recordFlat).toContain(`${column} = totals_row.${column} + EXCLUDED.${column},`);
    }
  });

  it('rounds once, to the stored precision, and uses the same rounded value in both tables', () => {
    expect(recordFn).toContain('v_credits := round(p_credits, 6);');
    expect(recordFn).toContain('v_cost_usd := round(p_cost_usd, 10);');
    const roundLine = 'v_cost_usd := round(p_cost_usd, 10);';
    const afterRound = recordFn.slice(recordFn.indexOf(roundLine) + roundLine.length);
    expect(afterRound).not.toMatch(/\bp_credits\b|\bp_cost_usd\b/);
  });

  it('Q-1 / Q-3: the period comes from the plan anchor, else the UTC calendar month, and says which', () => {
    expect(recordFn).toContain('v_period := public.business_os_credit_period_start(v_anchor, v_now);');
    expect(recordFn).toContain("v_source := 'plan';");
    expect(recordFn).toContain("v_period := date_trunc('month', v_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';");
    expect(recordFn).toContain("v_source := 'calendar_month';");
    expect(recordFn).toContain('FROM public.business_os_account_plans AS account_plan');
  });

  it('every name in both function bodies is schema-qualified', () => {
    for (const body of [recordFn, periodFn]) {
      for (const match of body.matchAll(/\b(?:FROM|INTO|JOIN)\s+([a-z_][\w.]*)/g)) {
        const name = match[1];
        if (name.startsWith('v_')) continue;
        expect(name).toMatch(/^public\./);
      }
    }
  });
});

describe('the read-only checker (C1 to C8, C-4)', () => {
  it('is read-only and ends in one SELECT', () => {
    expect(checker.trim().startsWith('SET default_transaction_read_only = on;')).toBe(true);
    const code = checker.replace(/'[^']*'/g, "''");
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REVOKE|CREATE|TRUNCATE)\b/);
    expect(checker.match(/;/g)).toHaveLength(2);
  });

  it('holds every check and a verdict', () => {
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']) {
      expect(checker).toContain(`'${id} `);
    }
    expect(checker).toContain("'VERDICT'");
  });

  it('reads privileges with aclexplode, so MAINTAIN, TRUNCATE, REFERENCES and TRIGGER are all seen', () => {
    expect(checker).toContain('aclexplode(');
    expect(checker).toContain("table_acl_entries.grantee_name IN ('PUBLIC', 'anon', 'authenticated')");
    expect(checker).toContain("table_acl_entries.privilege_name NOT IN ('SELECT', 'INSERT')");
    expect(checker).toContain("table_acl_entries.privilege_name NOT IN ('SELECT', 'INSERT', 'UPDATE')");
  });

  it('C-4: checks the column grants per column, and its expected counts match the migration', () => {
    const all = columnsOf(CHARGES).length + columnsOf(TOTALS).length;
    const readable = ownerGrantColumns(CHARGES).length + ownerGrantColumns(TOTALS).length;
    expect(checkerFlat).toContain(`column_summary.total = ${all} AND`);
    expect(checkerFlat).toContain(`column_summary.owner_readable = ${readable} AND`);
    expect(checkerFlat).toContain(`has_column_privilege('authenticated', ledger_tables.table_oid, pg_attribute.attname::text, 'SELECT')`);
    expect(checkerFlat).toContain(
      `pg_attribute.attname::text NOT IN (${HIDDEN_FROM_OWNERS.map((column) => `'${column}'`).join(', ')})`
    );
  });

  it('its CHECK list is exactly the CHECK constraints the migration defines, so the two cannot drift', () => {
    const start = checker.indexOf("pg_constraint.contype = 'c' AND pg_constraint.conname IN (");
    expect(start).toBeGreaterThanOrEqual(0);
    const open = checker.indexOf('(', checker.indexOf('conname IN', start));
    const listed = literalsOf(checker.slice(open, checker.indexOf(')', open) + 1));
    const defined = migrationCheckNames();
    expect([...listed].sort()).toEqual([...defined].sort());
    expect(checkerFlat).toContain(`constraint_summary.named_checks = ${defined.length}`);
    expect(checkerFlat).toContain(`all ${defined.length} check constraints present`);
  });

  it('names every index, foreign key, policy and function the migration creates', () => {
    for (const match of flat.matchAll(/CREATE INDEX (\w+) /g)) expect(checker).toContain(`'${match[1]}'`);
    for (const match of flat.matchAll(/ADD CONSTRAINT (\w+_fkey) /g)) expect(checker).toContain(`'${match[1]}'`);
    for (const match of flat.matchAll(/CREATE FUNCTION public\.(\w+)\(/g)) expect(checker).toContain(`'${match[1]}'`);
    expect(checker).toContain("pg_constraint.confdeltype = 'n'");
    expect(checker).toContain("pg_constraint.confdeltype = 'c'");
    expect(checker).toContain("pg_proc.proname IN ('business_os_credit_period_start', 'business_os_record_credit_charge')");
  });

  it('C6: the period cases, including leap year, exactly-at-anchor and a moved session time zone', () => {
    expect(checker).toContain("make_timestamptz(2028, 2, 29, 12, 0, 0, 'UTC'), make_timestamptz(2028, 2, 29, 10, 0, 0, 'UTC')");
    expect(checker).toContain(
      "('exactly at the anchor', make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC'), make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC'), make_timestamptz(2026, 1, 31, 10, 0, 0, 'UTC'))"
    );
    expect(checker).toContain("set_config('TimeZone', 'NZ', true)");
    expect(checker).toContain('zone sensitive case');
    expect(checker).toContain('FROM (SELECT count(*) AS forced FROM default_zone_results) AS forced_first');
  });

  it('S-1: the C7 first-row time prints in UTC, because C6 has moved the statement TimeZone to NZ by then', () => {
    expect(checker).toContain(
      "COALESCE((ledger_counts.first_created_at AT TIME ZONE 'UTC')::text || ' utc', 'none')"
    );
    expect(checker).not.toContain('first_created_at::text');
  });

  it('C7: the rebuild computes every summed column, skips detached rows, and compares both ways', () => {
    expect(checker).toContain('WHERE charge_row.user_id IS NOT NULL');
    expect(checker).toContain('FULL OUTER JOIN public.business_os_credit_totals AS stored_totals');
    for (const column of [
      'credits_total',
      'credits_owner',
      'credits_scheduled',
      'credits_external',
      'credits_adjustment',
      'cost_usd_total',
      'charge_count',
      'fallback_priced_count',
    ]) {
      expect(checker).toContain(`stored_totals.${column} <> rebuilt_totals.${column}`);
    }
  });
});

describe('C-1: the mandatory write probe', () => {
  it('is one DO block that always ends in an error, so nothing it writes can be kept', () => {
    expect(probe.trim().startsWith('DO $probe$')).toBe(true);
    expect(probe.trim().endsWith('$probe$;')).toBe(true);
    expect(probeFlat).not.toMatch(/\bCOMMIT\b/);
    const lastStatement = probeFlat.slice(probeFlat.lastIndexOf('RAISE EXCEPTION'));
    expect(lastStatement).toMatch(/^RAISE EXCEPTION USING MESSAGE = 'PROBE ' \|\| CASE WHEN v_fail THEN 'FAIL' ELSE 'PASS' END/);
    expect(lastStatement).toContain('this error is expected and rolls everything back');
  });

  it('runs on the user own account, through a placeholder that fails loudly if it is left in', () => {
    expect(probe).toContain("v_owner_text text := 'PASTE_YOUR_OWN_USER_ID_HERE';");
    expect(probe).toContain('EXCEPTION WHEN invalid_text_representation THEN');
    expect(probe).toContain('FROM auth.users AS auth_user WHERE auth_user.id = v_owner');
    expect(probe).not.toMatch(/INSERT INTO auth\./);
  });

  it('QA-N4: a placeholder left in and a malformed id get different messages, the placeholder first', () => {
    const placeholder = probe.indexOf("IF position('YOUR_OWN_USER_ID' IN v_owner_text) > 0 THEN");
    const cast = probe.indexOf('v_owner := v_owner_text::uuid;');
    expect(placeholder).toBeGreaterThan(0);
    expect(cast).toBeGreaterThan(placeholder);
    expect(probe.slice(placeholder, cast)).toContain("'PROBE SKIPPED  replace PASTE_YOUR_OWN_USER_ID_HERE with your own user id");
    const handler = probe.slice(cast, probe.indexOf('END;', cast));
    expect(handler).toContain('EXCEPTION WHEN invalid_text_representation THEN');
    expect(handler).toContain("'PROBE SKIPPED  the pasted value is not a valid user id ");
    expect(handler).not.toContain('PASTE_YOUR_OWN_USER_ID_HERE');
  });

  it('QA-N3: refuses a read-only session with a clear message before any role switch or write', () => {
    const guard = probe.indexOf("IF current_setting('transaction_read_only') = 'on' THEN");
    expect(guard).toBeGreaterThan(probe.indexOf('v_owner := v_owner_text::uuid;'));
    expect(guard).toBeLessThan(probe.indexOf('SET LOCAL ROLE service_role;'));
    expect(guard).toBeLessThan(probe.indexOf('business_os_record_credit_charge('));
    expect(probe.slice(guard, probe.indexOf('END IF;', guard))).toContain(
      "'PROBE SKIPPED  this session is read only  open a new SQL editor tab or run RESET default_transaction_read_only",
    );
  });

  it('QA-N5: P00 prints the plan anchor in UTC with a utc suffix, like P04 and C7 (S-1)', () => {
    expect(probe).toContain("COALESCE((v_anchor AT TIME ZONE 'UTC')::text || ' utc', 'none')");
    expect(probe).not.toContain('COALESCE(v_anchor::text');
  });

  it('(a) acts as service_role before any write, then as authenticated', () => {
    const service = probe.indexOf('SET LOCAL ROLE service_role;');
    const authenticated = probe.indexOf('SET LOCAL ROLE authenticated;');
    expect(service).toBeGreaterThan(0);
    expect(authenticated).toBeGreaterThan(service);
    expect(probe.indexOf('business_os_record_credit_charge(')).toBeGreaterThan(service);
  });

  it('(a) the idempotency pair, the summed pair and the rebuild', () => {
    expect(probe.match(/business_os_record_credit_charge\(v_first, /g)).toHaveLength(2);
    expect(probe).toContain('business_os_record_credit_charge(v_second, ');
    for (const id of ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08']) {
      expect(probe).toContain(`'${id} PASS `);
    }
  });

  it('(a) every charge the probe records for AI passes service ai, and P03 checks it was stored', () => {
    const calls = [
      ...probe.matchAll(/business_os_record_credit_charge\((v_first|v_second|NULL|v_refused|gen_random_uuid\(\)), v_owner, v_group, '(\w+)'/g),
    ];
    expect(calls.length).toBe(6);
    for (const call of calls) expect(call[2]).toBe('ai');
    expect(probe).toContain("AND v_stored.service = 'ai' THEN");
  });

  it('(a) P08A to P08C: another service joins the same pool, a malformed or missing service is refused', () => {
    expect(probe).toContain("business_os_record_credit_charge(v_other_service, v_owner, v_group, 'notification_email', ");
    expect(probe).toContain("AND v_service = 'notification_email' AND v_rows = 1");
    expect(probe).toContain("business_os_record_credit_charge(v_bad_service, v_owner, v_group, 'Notification Email', ");
    expect(probe).toContain('business_os_record_credit_charge(v_bad_service, v_owner, v_group, NULL, ');
    const malformed = probe.indexOf("'Notification Email'");
    const handler = probe.slice(malformed, probe.indexOf('END;', probe.indexOf('EXCEPTION', malformed)));
    expect(handler).toContain('EXCEPTION WHEN check_violation THEN');
    for (const id of ['P08A', 'P08B', 'P08C']) {
      expect(probe).toContain(`'${id} PASS `);
    }
    expect(probe.indexOf("'P08A PASS ")).toBeLessThan(probe.indexOf('SET LOCAL ROLE authenticated;'));
  });

  it('(b) UPDATE, DELETE and TRUNCATE are each refused to service_role', () => {
    for (const statement of [
      "UPDATE public.business_os_credit_charges SET outcome = 'failed' WHERE action_id = v_first;",
      'DELETE FROM public.business_os_credit_charges WHERE action_id = v_first;',
      'TRUNCATE public.business_os_credit_charges;',
      'DELETE FROM public.business_os_credit_totals WHERE user_id = v_owner;',
      'TRUNCATE public.business_os_credit_totals;',
    ]) {
      const at = probe.indexOf(statement);
      expect({ statement, found: at > 0 }).toEqual({ statement, found: true });
      expect(probe.slice(at, probe.indexOf('END;', at))).toContain('EXCEPTION WHEN insufficient_privilege THEN');
      expect(at).toBeLessThan(probe.indexOf('SET LOCAL ROLE authenticated;'));
    }
  });

  it('(c) as authenticated: EXECUTE on both functions and SELECT of every hidden column fail 42501', () => {
    const asOwner = probe.slice(probe.indexOf('SET LOCAL ROLE authenticated;'));
    expect(asOwner).toContain('PERFORM public.business_os_record_credit_charge(');
    expect(asOwner).toContain('PERFORM public.business_os_credit_period_start(');
    for (const column of HIDDEN_FROM_OWNERS) {
      expect(asOwner).toMatch(new RegExp(`SELECT (charge_row|totals_row)\\.${column} INTO`));
    }
    for (const id of ['P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20', 'P21', 'P22']) {
      expect(asOwner).toContain(`'${id} PASS `);
    }
    expect(asOwner.match(/EXCEPTION WHEN insufficient_privilege THEN/g)?.length).toBeGreaterThanOrEqual(7);
  });
});

describe('the rollback', () => {
  it('is a separate file outside supabase/migrations and drops exactly these four objects, functions first', () => {
    const rollback = read(ROLLBACK).replace(/\s+/g, ' ').trim();
    expect(rollback.endsWith(
      `DROP FUNCTION ${RECORD_FN}; DROP FUNCTION ${PERIOD_FN}; DROP TABLE ${TOTALS}; DROP TABLE ${CHARGES}; COMMIT;`
    )).toBe(true);
    expect(rollback.match(/\bDROP\b/g)).toHaveLength(4);
  });

  it('S-2: refuses, before any DROP, when the ledger holds a charge row, so it can never silently drop a bill', () => {
    const rollback = read(ROLLBACK).replace(/\s+/g, ' ').trim();
    expect(rollback).toBe(
      "BEGIN; SET LOCAL lock_timeout = '5s'; LOCK TABLE public.business_os_credit_charges IN ACCESS EXCLUSIVE MODE; " +
        'DO $refuse$ BEGIN IF EXISTS (SELECT 1 FROM public.business_os_credit_charges AS charge_row) THEN ' +
        "RAISE EXCEPTION USING MESSAGE = 'ROLLBACK REFUSED the ledger holds charge rows so nothing was dropped'; END IF; END $refuse$; " +
        `DROP FUNCTION ${RECORD_FN}; DROP FUNCTION ${PERIOD_FN}; DROP TABLE ${TOTALS}; DROP TABLE ${CHARGES}; COMMIT;`
    );
    // The lock is taken before the count, so no charge can land between the
    // check and the DROP; the DO block raising aborts the whole transaction.
    expect(rollback.indexOf('LOCK TABLE')).toBeLessThan(rollback.indexOf('IF EXISTS'));
    expect(rollback.indexOf('RAISE EXCEPTION')).toBeLessThan(rollback.indexOf('DROP '));
  });
});

/**
 * Guard: every foreign key INTO a table the test-account cleanup empties, and
 * every foreign key to the login (auth.users), is reviewed in the generator
 * before its migration reaches prod.
 *
 * `public.operator_test_account_cleanup` runs guard G-18 at run time: it refuses
 * every check, hard delete and anonymise while any FK points at a table the
 * plan empties without a matching (child table, constraint) entry in
 * INBOUND_FOREIGN_KEYS. Twice a migration added such an FK without touching
 * the generator, and account deletion stopped on prod (20261092, then 20261097
 * fixed by 20261104). This test replays every migration statically and fails
 * the PR instead.
 *
 * What it checks (SA-6):
 *   - each replayed FK whose parent is a `public` table of buildCleanupPlan('hard')
 *     has a (child_table, constraint) entry in INBOUND_FOREIGN_KEYS and a
 *     `public` child, mirroring `inbound_joined.reviewed`;
 *   - no such FK is wider than one column (G-18 blocks those even when reviewed);
 *   - G-10 (SA code review 3): each replayed FK to auth.users from a child
 *     outside the `auth` schema is keyed (schema, table, first column) in
 *     tenancyForeignKeys() or ACTOR_FOREIGN_KEYS, mirroring `fk_catalog` /
 *     `fk_review`, and is one column wide (G-10 blocks wider ones too);
 *   - the migrations read with certainty: unterminated text, FK syntax the
 *     replay cannot attribute, and dynamic FK SQL all fail (fail closed).
 * The PARENT_OWNED_REASONS rule (null owner needs a reason) is NOT repeated
 * here: testAccountCleanupSql.test.ts already enforces it.
 *
 * ONE DIRECTION ONLY. This sees the FKs the repo declares. An FK that exists
 * only on prod (created by hand, or by a table with no CREATE TABLE in the
 * repo) is invisible here and stays G-18's runtime job. Extra
 * INBOUND_FOREIGN_KEYS entries for prod-only tables are not errors.
 *
 * Pure: reads supabase/migrations/*.sql and imports the generator. No database,
 * no network (SA-7). The exception lists below are reviewed by SA entry by
 * entry; each one feeds the normal check and fails when it goes stale (SA-4).
 *
 * Requirement: docs/requirements/TEST_ACCOUNT_CLEANUP_INBOUND_FK_GUARD_REQUIREMENT.md
 * Workplan:    docs/workplans/TEST_ACCOUNT_CLEANUP_INBOUND_FK_GUARD_WORKPLAN.md
 */

import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  ACTOR_FOREIGN_KEYS,
  INBOUND_FOREIGN_KEYS,
  buildCleanupPlan,
  tenancyForeignKeys,
} from '@/scripts/generate-test-account-cleanup-sql';
import {
  compareFileNames,
  replayMigrations,
  type ForeignKey,
  type MigrationFile,
  type ReplayAdjustment,
} from '@/scripts/lib/migrationForeignKeys';

const GENERATOR = 'scripts/generate-test-account-cleanup-sql.ts';
const THIS_FILE = 'scripts/__tests__/testAccountCleanupInboundFk.guard.test.ts';

// ── Reviewed exceptions (SA-4) ──────────────────────────────────────────────

/** A migration whose FKs are built by dynamic SQL, pinned by sha256 and expanded by hand (SA-4a). */
interface DynamicFkMigration {
  readonly file: string;
  /** sha256 of the CRLF-normalised text, as testAccountCleanupSql.test.ts pins applied files. */
  readonly sha256: string;
  readonly expands: ReadonlyArray<{ readonly child: string; readonly columns: readonly string[]; readonly parent: string; readonly constraint: string }>;
  readonly reason: string;
}

/** An FK the repo names `repoName` that prod carries as `liveName` (SA-4b). */
interface LiveNameAlias {
  readonly file: string;
  readonly child: string;
  readonly repoName: string;
  readonly liveName: string;
  readonly reason: string;
}

/** An FK the repo declares that does not exist on prod (SA-4c). */
interface NotOnProd {
  readonly file: string;
  readonly child: string;
  readonly constraint: string;
  readonly reason: string;
}

/**
 * The tables in the `business_owned` array of 20260916_business_data_ownership.sql,
 * copied by hand in its order. Its loop runs
 * `ALTER TABLE public.<t> ADD CONSTRAINT <t>_business_fk FOREIGN KEY (user_id)
 * REFERENCES public.business_profiles(user_id)` through EXECUTE format(), which
 * the replay does not evaluate (SA-4: option (c) rejected).
 */
const BUSINESS_OWNED_20260916: readonly string[] = [
  'business_addresses',
  'crm_activities',
  'crm_contacts',
  'crm_pipeline_stages',
  'crm_tasks',
  'contact_documents',
  'scheduling_bookings',
  'scheduling_meetings',
  'scheduling_services',
  'abandoned_bookings',
  'scheduling_availability_exceptions',
  'external_calendar_events',
  'payment_automation_executions',
  'payment_automation_rules',
  'payment_events',
  'payment_invoices',
  'payment_methods',
  'payment_plan_installments',
  'payment_plan_subscriptions',
  'payment_plans',
  'payment_processors',
  'payment_refunds',
  'payment_reminders',
  'payment_transactions',
  'saved_payment_methods',
  'stripe_connect_accounts',
  'proposals',
  'smart_links',
  'website_content',
  'website_page_views',
  'website_pages',
  'websites',
  'user_media',
  'business_events',
  'business_health_summaries',
  'channel_connections',
  'channel_metrics_daily',
  'derived_metrics',
  'insight_actions',
  'insight_automations',
  'insight_hypotheses',
  'insight_measurements',
  'insight_outcomes',
  'insights',
  'owner_insight_history',
  'daily_briefings',
  'daily_briefing_sends',
  'business_intake_forms',
  'user_intake_settings',
  'email_campaigns',
  'email_sends',
  'email_sequence_enrollments',
  'email_sequence_steps',
  'email_sequences',
  'lead_responses',
  'user_capabilities',
  'business_chat_action_log',
  'business_chat_conversation',
  'business_chat_plan_cache',
  'business_chat_saved_plans',
  'business_chat_verified_questions',
  'marketing_consent_settings',
  'business_subscribers',
];

const DYNAMIC_FK_MIGRATIONS: readonly DynamicFkMigration[] = [
  {
    file: '20260916_business_data_ownership.sql',
    sha256: '6d9cad766e5ce3655df454153975af7a637e7ffe11ce5d17ae15a6bcc303a7f6',
    expands: BUSINESS_OWNED_20260916.map((table) => ({
      child: table,
      columns: ['user_id'],
      parent: 'business_profiles',
      constraint: `${table}_business_fk`,
    })),
    reason:
      'The business-ownership loop (line ~182): one <table>_business_fk per entry of business_owned, built with EXECUTE format(). ' +
      'Expanded from the array as committed. The loop skips a table absent from the database, which is why two of the ' +
      'expansions are on NOT_ON_PROD. The file is edited whenever a business-owned table joins the array: re-copy the ' +
      'array above and update the sha256 in the same PR.',
  },
];

const LIVE_NAME_ALIASES: readonly LiveNameAlias[] = [
  {
    file: '20260809214450_add_service_id_to_invoices.sql',
    child: 'payment_invoices',
    repoName: 'fk_payment_invoices_service',
    liveName: 'payment_invoices_service_id_fkey',
    reason:
      'The repo names the payment_invoices.service_id -> scheduling_services link fk_payment_invoices_service and never ' +
      'drops or renames it; prod carries it as payment_invoices_service_id_fkey, the name INBOUND_FOREIGN_KEYS reviews ' +
      '(measured with purge_schema_introspect 2026-10-06). G-18 has passed on prod since, which it could not with an ' +
      'unreviewed fk_payment_invoices_service present. Live check 2026-10-30: prod has payment_invoices_service_id_fkey and no fk_payment_invoices_service.',
  },
];

const NOT_ON_PROD: readonly NotOnProd[] = [
  {
    file: '20260916_business_data_ownership.sql',
    child: 'websites',
    constraint: 'websites_business_fk',
    reason:
      'No migration creates public.websites, and the 20260916 loop skips a table that is absent (to_regclass check), ' +
      'so the constraint was never created. Live check 2026-10-30: to_regclass of public.websites is NULL ' +
      'and no websites_business_fk exists.',
  },
  {
    file: '20260916_business_data_ownership.sql',
    child: 'insight_outcomes',
    constraint: 'insight_outcomes_business_fk',
    reason:
      '20261006g_insight_measurements.sql records that public.insight_outcomes does not exist, and the 20260916 loop ' +
      'skips an absent table, so the constraint was never created. G-18 has passed on prod with it unreviewed. ' +
      'Live check 2026-10-30: to_regclass of public.insight_outcomes is NULL and no insight_outcomes_business_fk exists.',
  },
];

/**
 * Constraints that may never be excepted (SA-8): they were real G-18 outages,
 * and the only fix is a generator review. An exception naming one fails.
 */
const NEVER_EXCEPTED: readonly string[] = ['scheduling_meetings_replaces_meeting_id_fkey'];

// ── The check (the same function runs the guard and the negative controls) ──

interface Exceptions {
  readonly dynamic: readonly DynamicFkMigration[];
  readonly aliases: readonly LiveNameAlias[];
  readonly notOnProd: readonly NotOnProd[];
}

/** A link to the login G-10 accepts: the key of `fk_review`. */
interface LoginLinkKey {
  readonly schema: string;
  readonly table: string;
  readonly column: string;
}

interface InboundCheckInput {
  readonly files: readonly MigrationFile[];
  readonly planTables: ReadonlySet<string>;
  readonly reviewed: ReadonlyArray<readonly [string, string, string | null]>;
  /** G-10's review: tenancyForeignKeys() ∪ ACTOR_FOREIGN_KEYS. */
  readonly loginLinksReviewed: readonly LoginLinkKey[];
  readonly exceptions: Exceptions;
}

interface InboundCheckResult {
  /** In-scope, single-column, not in INBOUND_FOREIGN_KEYS. */
  readonly unreviewed: ForeignKey[];
  /** In-scope and wider than one column: G-18 blocks them whatever the review says. */
  readonly multiColumn: ForeignKey[];
  /** Everything that stops the replay being trusted, and stale or forbidden exceptions. */
  readonly problems: string[];
  /** Every in-scope FK, for the counts in the workplan. */
  readonly inScope: ForeignKey[];
  /** G-10: links to auth.users from outside `auth`, one column wide, not reviewed. */
  readonly loginUnreviewed: ForeignKey[];
  /** G-10: links to auth.users wider than one column (blocked whatever the review). */
  readonly loginMultiColumn: ForeignKey[];
  /** G-10: every link to auth.users from outside `auth`. */
  readonly loginInScope: ForeignKey[];
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

function checkInboundForeignKeys(input: InboundCheckInput): InboundCheckResult {
  const { files, planTables, reviewed, loginLinksReviewed, exceptions } = input;
  const problems: string[] = [];
  const byFile = new Map(files.map((f) => [f.file, f.sql]));

  for (const name of NEVER_EXCEPTED) {
    const named =
      exceptions.dynamic.some((d) => d.expands.some((e) => e.constraint === name)) ||
      exceptions.aliases.some((a) => a.repoName === name || a.liveName === name) ||
      exceptions.notOnProd.some((n) => n.constraint === name);
    if (named) problems.push(`${name} is on an exception list. It may never be: review it in INBOUND_FOREIGN_KEYS (SA-8).`);
  }

  const pinned = new Set<string>();
  // Listed but drifted: already reported above, so the "add the file" advice below would mislead.
  const listed = new Set<string>();
  const adjustments: ReplayAdjustment[] = [];
  for (const entry of exceptions.dynamic) {
    if (!entry.reason.trim()) problems.push(`DYNAMIC_FK_MIGRATIONS ${entry.file}: no reason.`);
    const sql = byFile.get(entry.file);
    if (sql === undefined) {
      problems.push(`DYNAMIC_FK_MIGRATIONS ${entry.file}: stale, no such migration.`);
      continue;
    }
    const actual = sha256(sql);
    if (actual !== entry.sha256) {
      problems.push(
        `DYNAMIC_FK_MIGRATIONS ${entry.file}: the file changed since its expansion was reviewed (sha256 ${actual}, pinned ${entry.sha256}). ` +
          `Re-read its dynamic SQL, update the hand-written expansion and the sha256 in ${THIS_FILE}. Entry note: ${entry.reason}`,
      );
    } else pinned.add(entry.file);
    listed.add(entry.file);
    for (const e of entry.expands) {
      adjustments.push({
        file: entry.file,
        kind: 'inject',
        fk: { childTable: e.child, childColumns: e.columns, parentTable: e.parent, parentColumns: null, constraint: e.constraint },
      });
    }
  }
  for (const alias of exceptions.aliases) {
    if (!alias.reason.trim()) problems.push(`LIVE_NAME_ALIASES ${alias.repoName}: no reason.`);
    adjustments.push({ file: alias.file, kind: 'rename', childTable: alias.child, from: alias.repoName, to: alias.liveName });
  }
  for (const entry of exceptions.notOnProd) {
    if (!entry.reason.trim()) problems.push(`NOT_ON_PROD ${entry.constraint}: no reason.`);
    adjustments.push({ file: entry.file, kind: 'remove', childTable: entry.child, constraint: entry.constraint });
  }

  const replay = replayMigrations(files, adjustments);

  for (const p of replay.problems) problems.push(`${p.file}:${p.line}: ${p.message}. The guard cannot read this file with certainty (fail closed).`);
  const dynamicFiles = new Set<string>();
  for (const d of replay.dynamic) {
    dynamicFiles.add(d.file);
    if (listed.has(d.file)) continue;
    problems.push(
      `${d.file}:${d.line}: foreign key syntax inside a string or function body (dynamic SQL): ${d.excerpt}\n` +
        `      The replay cannot evaluate it. Add the file to DYNAMIC_FK_MIGRATIONS in ${THIS_FILE} with its sha256 and the constraints it creates.`,
    );
  }
  for (const entry of exceptions.dynamic) {
    if (byFile.has(entry.file) && !dynamicFiles.has(entry.file)) {
      problems.push(`DYNAMIC_FK_MIGRATIONS ${entry.file}: stale, the file holds no dynamic foreign key SQL any more.`);
    }
  }
  for (const u of replay.unmatched) {
    if (u.kind === 'rename') problems.push(`LIVE_NAME_ALIASES ${u.file}: stale, no ${u.childTable}.${u.from} after that migration.`);
    else if (u.kind === 'remove') problems.push(`NOT_ON_PROD ${u.file}: stale, no ${u.childTable}.${u.constraint} after that migration.`);
    else problems.push(`DYNAMIC_FK_MIGRATIONS ${u.file}: stale, no such migration.`);
  }

  const reviewedKeys = new Set(reviewed.map(([child, constraint]) => `${child}\u0000${constraint}`));
  const inScope = replay.foreignKeys.filter((fk) => fk.parentSchema === 'public' && planTables.has(fk.parentTable));
  const multiColumn = inScope.filter((fk) => fk.childColumns.length !== 1);
  const unreviewed = inScope.filter(
    (fk) => fk.childColumns.length === 1 && !(fk.childSchema === 'public' && reviewedKeys.has(`${fk.childTable}\u0000${fk.constraint}`)),
  );

  // G-10, the second pass over the same replay (SA code review 3).
  const loginKey = (schema: string, table: string, column: string): string => `${schema}\u0000${table}\u0000${column}`;
  const loginReviewed = new Set(loginLinksReviewed.map((k) => loginKey(k.schema, k.table, k.column)));
  const loginInScope = replay.foreignKeys.filter((fk) => fk.parentSchema === 'auth' && fk.parentTable === 'users' && fk.childSchema !== 'auth');
  const loginMultiColumn = loginInScope.filter((fk) => fk.childColumns.length !== 1);
  const loginUnreviewed = loginInScope.filter(
    (fk) => fk.childColumns.length === 1 && !loginReviewed.has(loginKey(fk.childSchema, fk.childTable, fk.childColumns[0])),
  );
  return { unreviewed, multiColumn, problems, inScope, loginUnreviewed, loginMultiColumn, loginInScope };
}

const describeFk = (fk: ForeignKey): string =>
  `  ${fk.file}: ${fk.childSchema}.${fk.childTable}.${fk.childColumns.join(', ')}\n` +
  `    -> ${fk.parentSchema}.${fk.parentTable}  (constraint ${fk.constraint})`;

/** The failure text (FR-7): every offender, then the procedure once. Empty when clean. */
function describeFailure(result: InboundCheckResult): string {
  const sections: string[] = [];
  if (result.unreviewed.length > 0) {
    sections.push(
      [
        'Unreviewed foreign key into a cleanup-plan table — G-18 will block every',
        'check, delete and anonymise on prod once this migration is applied.',
        '',
        ...result.unreviewed.map(describeFk),
        '',
        `Fix in ${GENERATOR}:`,
        '  1. Add [child_table, constraint_name, owner_column | null] to INBOUND_FOREIGN_KEYS',
        '     (null owner -> add a PARENT_OWNED_REASONS entry with the reason).',
        '  2. Bump FUNCTION_MIGRATION as the comment block above it describes.',
        `  3. Run: npx tsx ${GENERATOR} and commit the output.`,
        '  4. Ship the regenerated function as that new migration; never edit one already applied.',
      ].join('\n'),
    );
  }
  if (result.multiColumn.length > 0) {
    sections.push(
      [
        'Multi-column foreign key into a cleanup-plan table — G-18 blocks every link',
        'whose key is wider than one column, reviewed or not, so every check, delete',
        'and anonymise on prod will be refused once this migration is applied.',
        '',
        ...result.multiColumn.map(describeFk),
        '',
        `Fix: make the link single-column, or teach G-18 (inbound_rows key_width in ${GENERATOR}) first.`,
      ].join('\n'),
    );
  }
  if (result.loginUnreviewed.length > 0) {
    sections.push(
      [
        'Unreviewed foreign key to the login (auth.users) — G-10 will block every',
        'check, delete and anonymise on prod once this migration is applied.',
        '',
        ...result.loginUnreviewed.map(describeFk),
        '',
        `Fix in ${GENERATOR}, reviewing the link one of two ways:`,
        '  a. The column is the account\'s own key: put the table in the cleanup plan',
        '     (a purge descriptor, or FULL_REMOVAL_EXTRAS), so tenancyForeignKeys() names it.',
        '  b. The column names another actor (granted_by, updated_by, ...): add',
        '     { schema, table, column, ownerColumn | null } to ACTOR_FOREIGN_KEYS.',
        'Then:',
        '  1. Bump FUNCTION_MIGRATION as the comment block above it describes.',
        `  2. Run: npx tsx ${GENERATOR} and commit the output.`,
        '  3. Ship the regenerated function as that new migration; never edit one already applied.',
      ].join('\n'),
    );
  }
  if (result.loginMultiColumn.length > 0) {
    sections.push(
      [
        'Multi-column foreign key to the login (auth.users) — G-10 blocks every link',
        'whose key is wider than one column, reviewed or not, so every check, delete',
        'and anonymise on prod will be refused once this migration is applied.',
        '',
        ...result.loginMultiColumn.map(describeFk),
        '',
        `Fix: make the link single-column, or teach G-10 (fk_rows key_width in ${GENERATOR}) first.`,
      ].join('\n'),
    );
  }
  if (result.problems.length > 0) {
    sections.push(['The inbound-FK guard cannot vouch for the migrations:', ...result.problems.map((p) => `  - ${p}`)].join('\n'));
  }
  return sections.join('\n\n');
}

// ── The repository ──────────────────────────────────────────────────────────

const REPO = join(__dirname, '..', '..');
const MIGRATIONS_DIR = join(REPO, 'supabase', 'migrations');

/** Only the .sql files directly in the folder (SA-5.1), CRLF-normalised like testAccountCleanupSql.test.ts. */
const readMigrations = (): MigrationFile[] =>
  readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort(compareFileNames)
    .map((file) => ({ file, sql: readFileSync(join(MIGRATIONS_DIR, file), 'utf8').replace(/\r\n/g, '\n') }));

const PLAN_TABLES: ReadonlySet<string> = new Set(buildCleanupPlan('hard').map((entry) => entry.table));
const REAL_EXCEPTIONS: Exceptions = { dynamic: DYNAMIC_FK_MIGRATIONS, aliases: LIVE_NAME_ALIASES, notOnProd: NOT_ON_PROD };
/** G-10's review, exactly what the generator renders into `fk_review`. */
const LOGIN_LINKS_REVIEWED: readonly LoginLinkKey[] = [...tenancyForeignKeys(), ...ACTOR_FOREIGN_KEYS];

describe('test-account cleanup: every FK into a cleanup-plan table is reviewed (G-18 at PR time)', () => {
  const files = readMigrations();
  const result = checkInboundForeignKeys({ files, planTables: PLAN_TABLES, reviewed: INBOUND_FOREIGN_KEYS, loginLinksReviewed: LOGIN_LINKS_REVIEWED, exceptions: REAL_EXCEPTIONS });

  it('reads the migrations folder', () => {
    expect(files.length).toBeGreaterThan(250);
    expect(result.inScope.length).toBeGreaterThan(100);
    expect(result.loginInScope.length).toBeGreaterThan(50);
  });

  it('finds no unreviewed, multi-column or unreadable foreign key', () => {
    expect(describeFailure(result)).toBe('');
  });

  it('every exception carries a reason, and the live-state ones cite their live check', () => {
    for (const entry of [...LIVE_NAME_ALIASES, ...NOT_ON_PROD]) expect(entry.reason).toMatch(/live check|pg_constraint/i);
    for (const entry of DYNAMIC_FK_MIGRATIONS) expect(entry.expands.length).toBeGreaterThan(0);
  });

  it('no exception names a constraint that may never be excepted (SA-8)', () => {
    const named = [
      ...DYNAMIC_FK_MIGRATIONS.flatMap((d) => d.expands.map((e) => e.constraint)),
      ...LIVE_NAME_ALIASES.flatMap((a) => [a.repoName, a.liveName]),
      ...NOT_ON_PROD.map((n) => n.constraint),
    ];
    for (const name of NEVER_EXCEPTED) expect(named).not.toContain(name);
  });
});

// ── Negative controls: the same check on synthetic migrations (FR-8, SA condition 3) ──

describe('inbound-FK guard: negative controls', () => {
  const NO_EXCEPTIONS: Exceptions = { dynamic: [], aliases: [], notOnProd: [] };
  const check = (files: MigrationFile[], exceptions: Exceptions = NO_EXCEPTIONS): InboundCheckResult =>
    checkInboundForeignKeys({ files, planTables: PLAN_TABLES, reviewed: INBOUND_FOREIGN_KEYS, loginLinksReviewed: LOGIN_LINKS_REVIEWED, exceptions });
  const names = (fks: readonly ForeignKey[]): string[] => fks.map((fk) => fk.constraint);

  const ADD_FK = 'ALTER TABLE public.crm_contacts ADD COLUMN guard_probe_id uuid REFERENCES public.crm_contacts(id);\n';

  it('the probe table is a plan table and the probe FK is not reviewed', () => {
    expect(PLAN_TABLES.has('crm_contacts')).toBe(true);
    expect(INBOUND_FOREIGN_KEYS.some(([, constraint]) => constraint === 'crm_contacts_guard_probe_id_fkey')).toBe(false);
  });

  it('AC-12: an unreviewed FK into a plan table is reported, and only that one', () => {
    const result = check([{ file: '99990001_probe.sql', sql: ADD_FK }]);
    expect(names(result.unreviewed)).toEqual(['crm_contacts_guard_probe_id_fkey']);
    expect(result.problems).toEqual([]);
    const message = describeFailure(result);
    // AC-10: file, child table.column, parent and constraint.
    expect(message).toContain('99990001_probe.sql: public.crm_contacts.guard_probe_id');
    expect(message).toContain('-> public.crm_contacts  (constraint crm_contacts_guard_probe_id_fkey)');
    // AC-11: generator path, both arrays, FUNCTION_MIGRATION, the regenerate command.
    for (const fragment of [GENERATOR, 'INBOUND_FOREIGN_KEYS', 'PARENT_OWNED_REASONS', 'FUNCTION_MIGRATION', `npx tsx ${GENERATOR}`]) {
      expect(message).toContain(fragment);
    }
  });

  it('AC-10: every offender is listed, not just the first', () => {
    const result = check([
      { file: '99990001_probe.sql', sql: ADD_FK },
      { file: '99990002_probe.sql', sql: 'ALTER TABLE public.agents ADD COLUMN guard_probe_id uuid REFERENCES public.agents(id);\n' },
    ]);
    const message = describeFailure(result);
    expect(message).toContain('crm_contacts_guard_probe_id_fkey');
    expect(message).toContain('99990002_probe.sql: public.agents.guard_probe_id');
    expect(message).toContain('agents_guard_probe_id_fkey');
  });

  it('a reviewed FK passes', () => {
    const result = checkInboundForeignKeys({
      files: [{ file: '99990001_probe.sql', sql: ADD_FK }],
      planTables: PLAN_TABLES,
      reviewed: [...INBOUND_FOREIGN_KEYS, ['crm_contacts', 'crm_contacts_guard_probe_id_fkey', 'user_id']],
      loginLinksReviewed: LOGIN_LINKS_REVIEWED,
      exceptions: NO_EXCEPTIONS,
    });
    expect(describeFailure(result)).toBe('');
  });

  it('AC-13: the same FK dropped by a later migration is not reported', () => {
    const result = check([
      { file: '99990001_probe.sql', sql: ADD_FK },
      { file: '99990002_probe.sql', sql: 'ALTER TABLE public.crm_contacts DROP CONSTRAINT IF EXISTS crm_contacts_guard_probe_id_fkey;\n' },
    ]);
    expect(describeFailure(result)).toBe('');
  });

  it('AC-14: dynamic FK SQL not on DYNAMIC_FK_MIGRATIONS fails closed', () => {
    const sql =
      "DO $$\nBEGIN\n  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.crm_contacts(id)', 'x', 'y');\nEND $$;\n";
    const result = check([{ file: '99990001_probe.sql', sql }]);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toContain('99990001_probe.sql:3: foreign key syntax inside a string or function body');
    expect(describeFailure(result)).toContain('DYNAMIC_FK_MIGRATIONS');
  });

  it('AC-14: dynamic FK SQL inside a function body fails closed too', () => {
    const sql =
      'CREATE FUNCTION public.probe() RETURNS void LANGUAGE plpgsql AS $fn1$\nBEGIN\n  ALTER TABLE public.notes ADD CONSTRAINT n FOREIGN KEY (c) REFERENCES public.crm_contacts(id);\nEND $fn1$;\n';
    expect(check([{ file: '99990001_probe.sql', sql }]).problems).toHaveLength(1);
  });

  it('AC-15: a commented-out REFERENCES produces no FK', () => {
    const sql = `-- ${ADD_FK}/* ${ADD_FK} */\n`;
    const result = check([{ file: '99990001_probe.sql', sql }]);
    expect(result.inScope).toEqual([]);
    expect(describeFailure(result)).toBe('');
  });

  it('a stale exception fails the guard', () => {
    const exceptions: Exceptions = {
      dynamic: [],
      aliases: [{ file: '99990001_probe.sql', child: 'crm_contacts', repoName: 'no_such_fk', liveName: 'x', reason: 'probe' }],
      notOnProd: [{ file: '99990001_probe.sql', child: 'crm_contacts', constraint: 'also_missing', reason: 'probe' }],
    };
    const result = check([{ file: '99990001_probe.sql', sql: 'SELECT 1;\n' }], exceptions);
    expect(result.problems).toEqual([
      'LIVE_NAME_ALIASES 99990001_probe.sql: stale, no crm_contacts.no_such_fk after that migration.',
      'NOT_ON_PROD 99990001_probe.sql: stale, no crm_contacts.also_missing after that migration.',
    ]);
  });

  it('a stale dynamic entry fails the guard (file gone, or no dynamic SQL left)', () => {
    const entry = (file: string, sql: string): DynamicFkMigration => ({ file, sha256: sha256(sql), expands: [], reason: 'probe' });
    const quiet = 'SELECT 1;\n';
    const result = check([{ file: '99990001_probe.sql', sql: quiet }], {
      dynamic: [entry('99990001_probe.sql', quiet), entry('99990009_missing.sql', quiet)],
      aliases: [],
      notOnProd: [],
    });
    expect(result.problems).toEqual([
      'DYNAMIC_FK_MIGRATIONS 99990009_missing.sql: stale, no such migration.',
      'DYNAMIC_FK_MIGRATIONS 99990001_probe.sql: stale, the file holds no dynamic foreign key SQL any more.',
    ]);
  });

  describe('a pinned dynamic file', () => {
    const dynamicSql =
      "DO $$\nBEGIN\n  EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.crm_contacts(id)', 'x', 'y');\nEND $$;\n";
    const expands = [{ child: 'probe_child', columns: ['user_id'], parent: 'crm_contacts', constraint: 'probe_child_contact_fk' }];

    it('feeds its expansion into the normal check', () => {
      const result = check([{ file: '99990001_probe.sql', sql: dynamicSql }], {
        dynamic: [{ file: '99990001_probe.sql', sha256: sha256(dynamicSql), expands, reason: 'probe' }],
        aliases: [],
        notOnProd: [],
      });
      expect(result.problems).toEqual([]);
      expect(names(result.unreviewed)).toEqual(['probe_child_contact_fk']);
    });

    it('fails when the file changes after its expansion was reviewed (sha256 drift)', () => {
      const result = check([{ file: '99990001_probe.sql', sql: `${dynamicSql}-- edited\n` }], {
        dynamic: [{ file: '99990001_probe.sql', sha256: sha256(dynamicSql), expands, reason: 'probe' }],
        aliases: [],
        notOnProd: [],
      });
      // Exactly one problem: the drift. The "add the file to DYNAMIC_FK_MIGRATIONS" advice would mislead, it is listed.
      expect(result.problems).toHaveLength(1);
      expect(result.problems[0]).toContain('the file changed since its expansion was reviewed');
      expect(result.problems[0]).toContain('Entry note: probe');
    });
  });

  it('a live-name alias and a not-on-prod entry feed the normal check', () => {
    const files = [
      { file: '99990001_probe.sql', sql: 'ALTER TABLE public.crm_tasks ADD CONSTRAINT probe_repo_name FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);\n' },
      { file: '99990002_probe.sql', sql: 'ALTER TABLE public.crm_tasks ADD CONSTRAINT probe_gone FOREIGN KEY (contact_id) REFERENCES public.crm_contacts(id);\n' },
    ];
    const result = check(files, {
      dynamic: [],
      aliases: [{ file: '99990001_probe.sql', child: 'crm_tasks', repoName: 'probe_repo_name', liveName: 'crm_tasks_contact_id_fkey', reason: 'probe' }],
      notOnProd: [{ file: '99990002_probe.sql', child: 'crm_tasks', constraint: 'probe_gone', reason: 'probe' }],
    });
    expect(describeFailure(result)).toBe('');
    expect(names(result.inScope)).toEqual(['crm_tasks_contact_id_fkey']);
  });

  it('an exception naming a never-excepted constraint fails (SA-8)', () => {
    const sql = 'ALTER TABLE scheduling_meetings ADD COLUMN IF NOT EXISTS replaces_meeting_id uuid REFERENCES scheduling_meetings(id);\n';
    const result = check([{ file: '99990001_probe.sql', sql }], {
      dynamic: [],
      aliases: [],
      notOnProd: [{ file: '99990001_probe.sql', child: 'scheduling_meetings', constraint: 'scheduling_meetings_replaces_meeting_id_fkey', reason: 'probe' }],
    });
    expect(result.problems[0]).toContain('scheduling_meetings_replaces_meeting_id_fkey is on an exception list');
  });

  it('SA-6: a multi-column FK into a plan table gets its own message, even when reviewed', () => {
    const sql = 'ALTER TABLE public.crm_tasks ADD CONSTRAINT probe_wide FOREIGN KEY (contact_id, user_id) REFERENCES public.crm_contacts(id, user_id);\n';
    const result = checkInboundForeignKeys({
      files: [{ file: '99990001_probe.sql', sql }],
      planTables: PLAN_TABLES,
      reviewed: [...INBOUND_FOREIGN_KEYS, ['crm_tasks', 'probe_wide', 'user_id']],
      loginLinksReviewed: LOGIN_LINKS_REVIEWED,
      exceptions: NO_EXCEPTIONS,
    });
    expect(names(result.multiColumn)).toEqual(['probe_wide']);
    expect(result.unreviewed).toEqual([]);
    expect(describeFailure(result)).toContain('Multi-column foreign key into a cleanup-plan table');
    expect(describeFailure(result)).toContain('public.crm_tasks.contact_id, user_id');
  });

  describe('SA-5.6: DROP TABLE ... CASCADE', () => {
    const added: MigrationFile = {
      file: '99990001_probe.sql',
      sql:
        'CREATE TABLE public.probe_child (id uuid PRIMARY KEY, contact_id uuid REFERENCES public.crm_contacts(id));\n' +
        'ALTER TABLE public.crm_tasks ADD COLUMN probe_id uuid REFERENCES public.crm_contacts(id);\n',
    };

    it('without a drop, both links are reported', () => {
      expect(names(check([added]).unreviewed)).toEqual(['crm_tasks_probe_id_fkey', 'probe_child_contact_id_fkey']);
    });

    it('dropping the child removes its own FKs', () => {
      const result = check([added, { file: '99990002_probe.sql', sql: 'DROP TABLE IF EXISTS public.probe_child CASCADE;\n' }]);
      expect(names(result.unreviewed)).toEqual(['crm_tasks_probe_id_fkey']);
    });

    it('dropping the parent removes every FK pointing at it', () => {
      const result = check([added, { file: '99990002_probe.sql', sql: 'DROP TABLE public.crm_contacts CASCADE;\n' }]);
      expect(result.inScope).toEqual([]);
      expect(describeFailure(result)).toBe('');
    });
  });

  it('unreadable text fails closed and names the file', () => {
    const result = check([{ file: '99990001_probe.sql', sql: 'SELECT 1;\n/* never closed\n' }]);
    expect(result.problems).toEqual(['99990001_probe.sql:2: unterminated block comment. The guard cannot read this file with certainty (fail closed).']);
  });
});

// ── G-10 negative controls: links to the login (SA code review 3) ───────────

describe('login-link guard (G-10): negative controls', () => {
  const check = (sql: string): InboundCheckResult =>
    checkInboundForeignKeys({
      files: [{ file: '99990001_probe.sql', sql }],
      planTables: PLAN_TABLES,
      reviewed: INBOUND_FOREIGN_KEYS,
      loginLinksReviewed: LOGIN_LINKS_REVIEWED,
      exceptions: { dynamic: [], aliases: [], notOnProd: [] },
    });
  const reviewedKey = (schema: string, table: string, column: string): boolean =>
    LOGIN_LINKS_REVIEWED.some((k) => k.schema === schema && k.table === table && k.column === column);

  it('the probes are what they claim: crm_contacts.user_id is tenancy, admin_users.granted_by is an actor, the probe table is neither', () => {
    expect(reviewedKey('public', 'crm_contacts', 'user_id')).toBe(true);
    expect(reviewedKey('public', 'admin_users', 'granted_by')).toBe(true);
    expect(reviewedKey('public', 'guard_probe_login', 'owner_id')).toBe(false);
  });

  it('an unreviewed REFERENCES auth.users is reported with the G-10 procedure', () => {
    const result = check('CREATE TABLE public.guard_probe_login (id uuid PRIMARY KEY, owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE);\n');
    expect(result.loginUnreviewed.map((fk) => fk.constraint)).toEqual(['guard_probe_login_owner_id_fkey']);
    const message = describeFailure(result);
    expect(message).toContain('Unreviewed foreign key to the login (auth.users) — G-10 will block every');
    expect(message).toContain('99990001_probe.sql: public.guard_probe_login.owner_id');
    expect(message).toContain('-> auth.users  (constraint guard_probe_login_owner_id_fkey)');
    for (const fragment of [GENERATOR, 'tenancyForeignKeys()', 'ACTOR_FOREIGN_KEYS', 'FUNCTION_MIGRATION', `npx tsx ${GENERATOR}`]) {
      expect(message).toContain(fragment);
    }
  });

  it('every unreviewed login link is listed, not just the first', () => {
    const message = describeFailure(
      check(
        'CREATE TABLE public.guard_probe_login (owner_id uuid REFERENCES auth.users(id));\n' +
          'ALTER TABLE public.guard_probe_other ADD COLUMN made_by uuid REFERENCES auth.users(id);\n',
      ),
    );
    expect(message).toContain('public.guard_probe_login.owner_id');
    expect(message).toContain('public.guard_probe_other.made_by');
  });

  it('a reviewed link passes: a tenancy key of a plan table, and an ACTOR_FOREIGN_KEYS column', () => {
    const result = check(
      'ALTER TABLE public.crm_contacts ADD CONSTRAINT probe_owner FOREIGN KEY (user_id) REFERENCES auth.users(id);\n' +
        'ALTER TABLE public.admin_users ADD COLUMN granted_by uuid REFERENCES auth.users(id);\n',
    );
    expect(result.loginInScope).toHaveLength(2);
    expect(describeFailure(result)).toBe('');
  });

  it('a child in the auth schema is ignored, as fk_catalog ignores it', () => {
    const result = check('CREATE TABLE auth.guard_probe_sessions (user_id uuid REFERENCES auth.users(id));\n');
    expect(result.loginInScope).toEqual([]);
    expect(describeFailure(result)).toBe('');
  });

  it('a multi-column link gets the width message, even when its first column is reviewed', () => {
    const result = check(
      'ALTER TABLE public.crm_contacts ADD CONSTRAINT probe_wide_login FOREIGN KEY (user_id, id) REFERENCES auth.users(id, instance_id);\n',
    );
    expect(result.loginMultiColumn.map((fk) => fk.constraint)).toEqual(['probe_wide_login']);
    expect(result.loginUnreviewed).toEqual([]);
    expect(describeFailure(result)).toContain('Multi-column foreign key to the login (auth.users) — G-10 blocks every link');
  });
});

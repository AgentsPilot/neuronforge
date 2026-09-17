// scripts/audit-deletion-coverage.ts
//
// Does account deletion actually cover everything?
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS NOT THE SAME AS `verify`
//
// `test-account-deletion.ts verify` sweeps the tables named in
// `businessOwnedTables.ts` and `accountDeletionPolicy.ts` — the SAME two lists
// the deletion route reads. So it proves the route did what those lists say,
// and it is blind to exactly one thing: a table missing from both. Such a table
// is never deleted and never checked, and the report comes back clean.
//
// That is not hypothetical. `scripts/reset-onboarding.ts` documents a
// hand-maintained list in this repo that "named 17 tables and the registry now
// names 55 — it had fallen 38 behind, and nothing failed when it drifted,
// because an out-of-date list looks exactly like a complete one."
//
// So this script never reads those lists to decide what EXISTS. It builds the
// universe of tables from two independent sources:
//
//   1. every CREATE TABLE in supabase/migrations
//   2. every .from('...') in lib, app, components and scripts
//
// then probes the live database for which of them are real and which carry a
// `user_id` column — and only THEN compares against the deletion lists.
//
// A table that exists, holds per-user rows, and appears in neither list is
// personal data that survives an account deletion. That is the finding this
// exists to surface.
//
// Run:
//   npx tsx scripts/audit-deletion-coverage.ts
//
// Exit code 1 means at least one such table was found. Read-only throughout.
// ─────────────────────────────────────────────────────────────────────────────

import { config } from 'dotenv';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { BUSINESS_OWNED_TABLES } from '../lib/business-os/businessOwnedTables';
import {
  CASCADE_ROOT_TABLE,
  accountTablesToProcess,
  keyColumnFor,
  policyFor,
} from '../lib/business-os/account/accountDeletionPolicy';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ROOT = join(__dirname, '..');

/** A uuid nobody owns, so every probe matches nothing and reads nothing real. */
const NOBODY = '00000000-0000-4000-8000-000000000000';

/**
 * Tables that legitimately have no owner and must not be reported.
 *
 * Kept deliberately tiny, and each one is here because it is platform
 * configuration rather than anybody's data. A long list here would mean the
 * audit had been argued into silence.
 */
const NOT_PERSONAL = new Set([
  'schema_migrations',
  'migrations',
]);

// ── building the universe, without reading the deletion lists ────────────────

function tablesFromMigrations(): Set<string> {
  const dir = join(ROOT, 'supabase', 'migrations');
  const found = new Set<string>();

  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, file), 'utf-8');
    const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/gi;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(sql)) !== null) found.add(match[1].toLowerCase());
  }

  return found;
}

function tablesFromCode(): Set<string> {
  // ripgrep over the source for every table name the application actually
  // touches. Catches anything created outside a migration in this repo —
  // straight in the dashboard, or by a migration that was never committed.
  const out = execSync(
    `grep -rhoE "\\.from\\('[a-z_][a-z0-9_]*'\\)" lib app components scripts ` +
      `--include="*.ts" --include="*.tsx" || true`,
    { cwd: ROOT, encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024 }
  );

  const found = new Set<string>();
  for (const line of out.split('\n')) {
    const match = line.match(/\.from\('([a-z_][a-z0-9_]*)'\)/);
    if (match) found.add(match[1]);
  }
  return found;
}

// ── probing the live database ───────────────────────────────────────────────

type Probe = { exists: boolean; hasUserId: boolean; rows: number | null };

/*
 * COUNT is the signal, not `error`.
 *
 * A HEAD request to a table that does not exist comes back with NO ERROR at
 * all — supabase-js reports `error: null` for `x`, `_sql` and `table` alike.
 * Trusting `error` marked every junk string this script's own regexes had
 * scraped as a real, uncovered table, and buried the genuine findings in
 * twenty-two false positives.
 *
 * `count` tells the truth in both directions: null when the request did not
 * describe a real table-and-column, a number when it did. One request answers
 * both questions, because a count can only come back if the table exists AND
 * carries `user_id`.
 */
async function probe(table: string): Promise<Probe> {
  const owned = await db
    .from(table)
    .select('user_id', { count: 'exact', head: true })
    .eq('user_id', NOBODY);

  if (!owned.error && owned.count !== null) {
    // Real table, real user_id column. Count its rows for the report.
    const total = await db.from(table).select('user_id', { count: 'exact', head: true });
    return { exists: true, hasUserId: true, rows: total.count ?? null };
  }

  // Either the table is absent or it has no owner column. Separate the two, so
  // an ownerless table is reported as a question rather than as a gap.
  const anyColumn = await db.from(table).select('*', { count: 'exact', head: true });
  const exists = !anyColumn.error && anyColumn.count !== null;

  return { exists, hasUserId: false, rows: exists ? anyColumn.count ?? null : null };
}

// ── the audit ───────────────────────────────────────────────────────────────

async function main() {
  const fromMigrations = tablesFromMigrations();
  const fromCode = tablesFromCode();
  const universe = [...new Set([...fromMigrations, ...fromCode])]
    .filter(t => !NOT_PERSONAL.has(t))
    .sort();

  console.log(`\nUniverse built WITHOUT reading the deletion lists:`);
  console.log(`  ${fromMigrations.size} from migrations, ${fromCode.size} from code`);
  console.log(`  ${universe.length} distinct candidate tables\n`);

  // Only now do the deletion lists enter, and only to classify.
  const covered = new Map<string, string>();
  for (const table of BUSINESS_OWNED_TABLES) covered.set(table, 'cascade');
  covered.set(CASCADE_ROOT_TABLE, 'cascade root');
  for (const table of accountTablesToProcess()) covered.set(table, policyFor(table).verdict);

  const gaps: Array<[string, number | null]> = [];
  const ownerless: string[] = [];
  const phantom: string[] = [];
  let checked = 0;

  for (const table of universe) {
    const result = await probe(table);

    if (!result.exists) {
      // Named somewhere but not in this database. Usually a renamed table or a
      // migration never applied here; not a deletion problem.
      phantom.push(table);
      continue;
    }

    checked += 1;

    if (!result.hasUserId) {
      // No owner column, so account deletion has nothing to scope on. Reported
      // separately because it is a different question, not a gap.
      if (!covered.has(table)) ownerless.push(table);
      continue;
    }

    if (!covered.has(table)) gaps.push([table, result.rows]);
  }

  // ── report ────────────────────────────────────────────────────────────────
  console.log(`${checked} tables exist in this database.`);
  console.log(`${phantom.length} named in the repo but absent here (renamed, or never applied).\n`);

  if (ownerless.length) {
    console.log(`\x1b[33m${ownerless.length} table(s) with no user_id and no policy\x1b[0m`);
    console.log('  Not necessarily wrong — shared or platform data has no owner to delete.');
    ownerless.forEach(t => console.log(`    ${t}`));
    console.log('');
  }

  if (gaps.length === 0) {
    console.log('\x1b[32mNo gaps. Every per-user table in this database is covered by a');
    console.log('cascade or a policy verdict.\x1b[0m\n');
    process.exit(0);
  }

  console.log(`\x1b[31m${gaps.length} table(s) hold per-user rows and are in NEITHER list.\x1b[0m`);
  console.log('These survive account deletion, unnoticed, and `verify` cannot see them.\n');

  for (const [table, rows] of gaps) {
    console.log(`    ${table.padEnd(36)} ${rows ?? '?'} row(s) today`);
  }

  console.log('\nEach needs a decision: business-owned (cascade), account-level');
  console.log('(a policy verdict), or genuinely ownerless.\n');
  process.exit(1);
}

// `keyColumnFor` participates only where a table is already classified; the
// discovery above deliberately assumes nothing about column names.
void keyColumnFor;

main().catch(err => {
  console.error(err);
  process.exit(1);
});

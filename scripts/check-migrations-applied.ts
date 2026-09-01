/**
 * Which migrations in supabase/migrations have not reached this database.
 *
 * There is no migration ledger reachable over the REST API, so this works from
 * evidence instead: for every migration it extracts the tables it creates and
 * the columns it adds, then asks the database whether each one is there.
 *
 * It can only see tables and columns. Functions, policies, indexes, triggers,
 * data backfills and DROPs are invisible to it — a migration reported as
 * applied may still have parts missing.
 *
 *   npx tsx -r dotenv/config scripts/check-migrations-applied.ts dotenv_config_path=.env.local
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { supabaseServer } from '../lib/supabaseServer';

const DIR = 'supabase/migrations';

type Target = { table: string; column?: string };

function targetsOf(sql: string): Target[] {
  const out: Target[] = [];
  const clean = sql.replace(/--[^\n]*/g, '');

  for (const m of clean.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?["']?([a-z0-9_]+)["']?/gi)) {
    out.push({ table: m[1] });
  }
  for (const m of clean.matchAll(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?["']?([a-z0-9_]+)["']?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["']?([a-z0-9_]+)["']?/gi)) {
    out.push({ table: m[1], column: m[2] });
  }
  return out;
}

const cache = new Map<string, boolean>();

async function exists(target: Target): Promise<boolean> {
  const key = `${target.table}.${target.column ?? '*'}`;
  if (cache.has(key)) return cache.get(key)!;

  const { error } = await supabaseServer
    .from(target.table)
    .select(target.column ?? '*')
    .limit(1);

  // 42P01 = no such table, 42703 = no such column. Anything else (RLS, etc.)
  // is not evidence of absence.
  const missing = error?.code === '42P01' || error?.code === '42703';
  cache.set(key, !missing);
  return !missing;
}

async function main() {
  const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
  const unapplied: Array<{ file: string; missing: string[] }> = [];
  let checkable = 0;

  for (const file of files) {
    const targets = targetsOf(readFileSync(join(DIR, file), 'utf-8'));
    if (targets.length === 0) continue;
    checkable++;

    const missing: string[] = [];
    for (const t of targets) {
      if (!(await exists(t))) missing.push(t.column ? `${t.table}.${t.column}` : t.table);
    }
    if (missing.length > 0) unapplied.push({ file, missing: [...new Set(missing)] });
  }

  console.log(`migrations: ${files.length} | with checkable tables/columns: ${checkable} | incomplete: ${unapplied.length}\n`);
  for (const u of unapplied) {
    console.log(`${u.file}`);
    console.log(`   missing: ${u.missing.join(', ')}\n`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

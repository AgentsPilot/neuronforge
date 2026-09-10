/**
 * schema-check — replay every Supabase `.select()` in the codebase against the
 * live schema and report the ones that cannot run.
 *
 * WHY THIS EXISTS
 *
 * `types/database.ts` does not exist and `next.config.js` sets
 * `ignoreBuildErrors: true`, so no column name in this repo is checked at build
 * time. Nothing catches a phantom column until it reaches a user — and PostgREST
 * rejects the ENTIRE select for one unknown name, so a single typo takes out the
 * whole query rather than one field.
 *
 * Worse, many of these fail *silently*. Where the error is destructured away
 * (`const { data } = await ...` with no `error` binding) the code falls through
 * to a default and reports something plausible. Three live examples found by
 * hand: a detector that reports a hardcoded $75 of "missed revenue", one that
 * reports "nothing detected" for every user, and a publish path that can never
 * reach its fallback. All three read fine.
 *
 * HOW IT WORKS — and why it is safe
 *
 * Every `.from('table').select('cols')` pair is extracted from source and
 * replayed as `.select(cols).limit(0)`. PostgREST validates each column name
 * and returns NO ROWS. This reads no data, writes nothing, and issues no DDL.
 *
 * KNOWN BLIND SPOTS — the failure count is a floor, not a ceiling:
 *   - `.select('*')`                  no column names to check
 *   - embedded joins, `a, rel(b)`     skipped to avoid false positives
 *   - template-literal / multi-line   the extractor reads single-line strings
 *   - `.insert()` / `.update()`       same risk class, not yet covered
 *
 * USAGE
 *   npm run schema:check              report and exit non-zero if anything fails
 *   npm run schema:check -- --json    machine-readable, for CI
 *   npm run schema:check -- --quiet   failures only
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * The service role is used deliberately: this must see the schema as the server
 * does, not as RLS shows it.
 *
 * @module scripts/schema-check
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: path.join(__dirname, '../.env.local') });

const ROOTS = ['lib', 'app', 'components'];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

/** `.from('x') ... .select('a, b')` — single-line quoted select within 200 chars. */
const SELECT_RE = /\.from\(\s*['"]([a-z_][a-z0-9_]*)['"]\s*\)[\s\S]{0,200}?\.select\(\s*['"]([^'"`]+?)['"]\s*\)/g;

interface Finding {
  table: string;
  columns: string;
  message: string;
  code: string;
  files: string[];
}

function gitRef(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
    let dirty = '';
    try {
      if (execSync('git status --porcelain', { encoding: 'utf8' }).trim()) dirty = ' (working tree dirty)';
    } catch { /* ignore */ }
    return `${branch} @ ${sha}${dirty}`;
  } catch {
    return 'unknown (not a git checkout)';
  }
}

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|__tests__/.test(full)) {
        out.push(full);
      }
    }
  };
  for (const root of ROOTS) if (fs.existsSync(root)) walk(root);
  return out;
}

/** Distinct table+columns pairs, each with the files that issue them. */
function extractSelects(files: string[]): Map<string, { table: string; columns: string; files: Set<string> }> {
  const pairs = new Map<string, { table: string; columns: string; files: Set<string> }>();
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    let m: RegExpExecArray | null;
    SELECT_RE.lastIndex = 0;
    while ((m = SELECT_RE.exec(src)) !== null) {
      const [, table, columns] = m;
      if (columns.trim() === '*') continue;      // nothing to validate
      if (columns.includes('(')) continue;       // embedded join — see blind spots
      const key = `${table}|${columns}`;
      if (!pairs.has(key)) pairs.set(key, { table, columns, files: new Set() });
      pairs.get(key)!.files.add(file.split(path.sep).join('/'));
    }
  }
  return pairs;
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const quiet = args.includes('--quiet');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('schema-check: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local');
    process.exit(2);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  const ref = gitRef();
  const files = sourceFiles();
  const pairs = extractSelects(files);

  if (!asJson && !quiet) {
    // Stating the ref is not decoration. Two correct audits of this repo reached
    // opposite conclusions because neither said which tree it measured.
    console.log(`schema-check`);
    console.log(`  ref     ${ref}`);
    console.log(`  target  ${new URL(url).host}`);
    console.log(`  scanned ${files.length} files, ${pairs.size} distinct selects\n`);
  }

  const findings: Finding[] = [];
  for (const { table, columns, files: fileSet } of pairs.values()) {
    const { error } = await db.from(table).select(columns).limit(0);
    if (error) {
      findings.push({
        table,
        columns,
        message: error.message.split('\n')[0],
        code: (error as { code?: string }).code ?? '',
        files: [...fileSet].sort(),
      });
    }
  }

  findings.sort((a, b) => a.files[0].localeCompare(b.files[0]));

  if (asJson) {
    console.log(JSON.stringify({ ref, scanned: files.length, selects: pairs.size, findings }, null, 2));
  } else {
    for (const f of findings) {
      console.log(`BROKEN  ${f.table}  ->  ${f.columns}`);
      console.log(`        ${f.code ? f.code + ' ' : ''}${f.message}`);
      for (const file of f.files) console.log(`        ${file}`);
      console.log('');
    }
    console.log(
      findings.length === 0
        ? `PASS — ${pairs.size} selects all resolve against the live schema`
        : `FAIL — ${findings.length} of ${pairs.size} selects cannot run`
    );
    if (findings.length > 0 && !quiet) {
      console.log('\nBlind spots: star selects, embedded joins, template literals and');
      console.log('insert/update payloads are NOT checked. This count is a floor.');
    }
  }

  process.exit(findings.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('schema-check failed:', err);
  process.exit(2);
});

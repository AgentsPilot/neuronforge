/**
 * One writer for live prices (AI model price review slice 6; MP-FR-11, user
 * decision Q9; SA SC6-2, SC6-3, SC6-4).
 *
 * After slice 6 nothing in the app writes `ai_model_pricing` or
 * `ai_model_image_pricing`: Sync and the single-row create / edit / hard delete
 * are gone. Slice 8's apply RPC will be the one writer, and it is added to the
 * allow-lists below deliberately, in a reviewed one-line edit (LW-3, LW-5).
 *
 * - LW-1 Code under `app/`, `lib/`, `scripts/` (tests and
 *   fixtures skipped) names a live table as a whole quoted literal only in an
 *   allow-listed file; outside the repository the name sits inline in
 *   `.from('…')` (an alias would dodge the chain check), and no such chain
 *   (from `.from(` to the next `;` or `.from(`) calls a write verb.
 * - LW-2 `AiModelPricingRepository` is read-only.
 * - LW-3 Each file under `lib/repositories/` holds exactly the expected
 *   `ai_price_*` / `ai_model_*` literals: no new table and no new function.
 * - LW-5 No SQL function in `supabase/migrations/` writes a live table, and
 *   top-level DML on them exists only in the historic files.
 * - LW-4 Negative controls for every matcher.
 *
 * NOT A PROOF. Accepted gaps (SA CR-4, QA E-1), which are deliberate dodges
 * rather than accidents:
 *   - a computed or concatenated table name, in code (`['ai','model','pricing'].join('_')`)
 *     or in SQL (`EXECUTE format(…, 'ai_model_' || 'pricing')`);
 *   - a query-builder alias inside one of the allow-listed files;
 *   - an `ai_price_*` function name imported from a constant outside
 *     `lib/repositories/`.
 *
 * Runtime (SA DV-1 ruling): one directory walk, each file read once and
 * prefiltered on raw bytes before any regex. It measures about 1.2 s on a loaded
 * Windows dev machine; that is accepted, and CI is the arbiter: the suite must
 * stay under 3 s in CI, and no test shard may finish later than Build. If either
 * fails, list the files with `git ls-files -- app lib scripts` instead of walking
 * (never drop `app/`, `lib/` or `scripts/`).
 * Line endings are normalised, so a Windows checkout reads the same as CI.
 */

import * as fs from 'fs';
import * as path from 'path';

import { stripComments } from '@/tests/helpers/source-scan';

const ROOT = process.cwd();
/**
 * `components/` is left out (SA O-3): the four-root walk measured 1.3–1.6 s on the
 * dev machine, over the 1 s budget, and SA allowed dropping this root only. It is
 * browser code: a repository (rule 1, server-only) or a service-role client cannot
 * be reached from it, so a live-table write there would have to go through one of
 * the scanned roots anyway.
 */
const ROOTS = ['app', 'lib', 'scripts'];
const CODE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const SKIP_DIRS = new Set(['node_modules', '__tests__', '__fixtures__', '.next']);

const REPOSITORY = 'lib/repositories/AiModelPricingRepository.ts';

/** LW-1: files that may name a live table in code, and why. All read-only. */
const LITERAL_ALLOWED: Record<string, string> = {
  [REPOSITORY]: 'the TABLE constant; read-only, pinned by LW-2',
  'app/api/admin/agent-generation-config/route.ts': 'legacy direct read of active models (flagged, CLAUDE.md rule 1)',
  'scripts/analyze-pricing-discrepancies.ts': 'operator read script',
  'scripts/calculate-gpt4o-cost.ts': 'operator read script',
};

/** LW-3: tables and functions each repository file may name. Slice 8 adds its apply and dismiss functions and `ai_price_apply_batches`. */
const REPOSITORY_TABLES: Record<string, string[]> = {
  [REPOSITORY]: ['ai_model_pricing'],
  'lib/repositories/AiPriceProposalRepository.ts': ['ai_price_proposals', 'ai_price_proposal_lines'],
};
const REPOSITORY_FUNCTIONS: Record<string, string[]> = {
  'lib/repositories/AiPriceProposalRepository.ts': ['ai_price_submit_pending'],
};

/** LW-5: SQL functions allowed to write a live table (slice 8 adds its apply function). */
const SQL_FUNCTIONS_ALLOWED: string[] = [];
/** LW-5: migrations whose top-level DML on a live table is history (immutable). */
const SQL_HISTORIC_DML = [
  '20260213_add_claude_46_pricing.sql',
  '20261052_ai_model_pricing_baseline.sql',
  '20261053_ai_model_pricing_exact_prices_and_image_table.sql',
];

const LIVE_LITERAL = /['"`]ai_model_(image_)?pricing['"`]/g;
const LIVE_INLINE_FROM = /[.]from[(]\s*['"`]ai_model_(image_)?pricing['"`]\s*[)]/g;
const WRITE_VERB = /[.](insert|update|upsert|delete)[(]/;
const REPO_LITERAL = /['"`]((?:ai_price_|ai_model_)[a-z0-9_]*)['"`]/g;
// Word edges are lookarounds, and a function body's end is found by searching for its
// dollar-quote tag (no back-reference): this file holds no backslash followed by a hex
// digit (the Tailwind escape rule, PR #180), and the TS target has no named groups.
// SA CR-3: MERGE INTO and quoted identifiers (`public."ai_model_pricing"`, `"public".ai_model_pricing`).
const SQL_LIVE_DML = /(?<![A-Za-z0-9_])(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE(\s+TABLE)?)\s+(ONLY\s+)?("?public"?[.])?"?ai_model_(image_)?pricing"?(?![A-Za-z0-9_])/i;
// A multi-table TRUNCATE (`TRUNCATE other_table, ai_model_pricing`) names the table later in the list.
// The privilege word in GRANT / REVOKE (`…, TRUNCATE, … ON TABLE`, `TRUNCATE ON …`) is not a truncate.
const SQL_TRUNCATE_ANY = /(?<![A-Za-z0-9_])TRUNCATE(?!\s*,)(?!\s+ON\s)[^;]*ai_model_(image_)?pricing/i;

/** Does this SQL text write a live price table? */
function isLiveDml(sql: string): boolean {
  return SQL_LIVE_DML.test(sql) || SQL_TRUNCATE_ANY.test(sql);
}
const SQL_FUNCTION_HEAD = /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public[.])?([a-z0-9_]+)[^$]*?AS\s+([$][a-z0-9_]*[$])/gi;

/** Every `CREATE [OR REPLACE] FUNCTION … AS $tag$ body $tag$` in a script: name, body, and the whole span. */
function sqlFunctions(sql: string): { name: string; body: string; whole: string }[] {
  const found: { name: string; body: string; whole: string }[] = [];
  for (const head of sql.matchAll(SQL_FUNCTION_HEAD)) {
    const start = head.index ?? 0;
    const bodyStart = start + head[0].length;
    const tag = head[4];
    const bodyEnd = sql.indexOf(tag, bodyStart);
    if (bodyEnd < 0) continue;
    found.push({ name: head[3], body: sql.slice(bodyStart, bodyEnd), whole: sql.slice(start, bodyEnd + tag.length) });
  }
  return found;
}

const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(`${dir}/${entry.name}`, out);
    } else if (CODE_EXT.has(path.extname(entry.name)) && !/[.]test[.]/.test(entry.name)) {
      out.push(`${dir}/${entry.name}`);
    }
  }
}

/** Every chain that starts at a live-table `.from(`, up to the next `;` or `.from(`. */
function liveChains(code: string): string[] {
  const chains: string[] = [];
  for (const match of code.matchAll(LIVE_INLINE_FROM)) {
    const start = (match.index ?? 0) + match[0].length;
    const rest = code.slice(start);
    const semicolon = rest.indexOf(';');
    const nextFrom = rest.indexOf('.from(');
    const ends = [semicolon, nextFrom].filter((at) => at >= 0);
    chains.push(rest.slice(0, ends.length ? Math.min(...ends) : rest.length));
  }
  return chains;
}

/** LW-1 for one file's code: problems, or [] when clean. */
function literalProblems(file: string, code: string): string[] {
  const hits = code.match(LIVE_LITERAL) ?? [];
  if (hits.length === 0) return [];
  if (!(file in LITERAL_ALLOWED)) return [`${file}: names a live price table and is not allow-listed`];
  if (file === REPOSITORY) return [];
  const problems: string[] = [];
  const inline = code.match(LIVE_INLINE_FROM) ?? [];
  if (inline.length !== hits.length) problems.push(`${file}: a live table name outside an inline .from('…')`);
  for (const chain of liveChains(code)) {
    if (WRITE_VERB.test(chain)) problems.push(`${file}: a write on a live price table`);
  }
  return problems;
}

/** LW-5 for one migration: problems, or [] when clean. */
function sqlProblems(file: string, sql: string): string[] {
  const problems: string[] = [];
  const noComments = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
  let topLevel = noComments;
  for (const { name, body, whole } of sqlFunctions(noComments)) {
    topLevel = topLevel.replace(whole, '');
    if (isLiveDml(body) && !SQL_FUNCTIONS_ALLOWED.includes(name)) {
      problems.push(`${file}: function ${name} writes a live price table`);
    }
  }
  if (isLiveDml(topLevel) && !SQL_HISTORIC_DML.includes(file)) {
    problems.push(`${file}: top-level DML on a live price table`);
  }
  return problems;
}

const codeFiles: string[] = [];
for (const root of ROOTS) walk(root, codeFiles);
/**
 * Candidates only. The prefilter runs on the raw bytes (no UTF-8 decode of the
 * ~40 MB scanned), so only a handful of files are decoded and comment-stripped.
 */
const candidates = codeFiles
  .filter((file) => {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    return bytes.indexOf('ai_model_') >= 0 || bytes.indexOf('ai_price_') >= 0;
  })
  .map((file) => ({ file, code: stripComments(read(file)) }));

describe('LW-1: no app path writes a live price table', () => {
  it('the scan is not empty, and every allow-listed file still exists', () => {
    expect(codeFiles.length).toBeGreaterThan(1000);
    for (const file of Object.keys(LITERAL_ALLOWED)) expect({ file, exists: fs.existsSync(path.join(ROOT, file)) }).toEqual({ file, exists: true });
  });

  it('is not vacuous: the matcher finds the known reads in the allow-listed files', () => {
    for (const file of Object.keys(LITERAL_ALLOWED).filter((name) => name !== REPOSITORY)) {
      const code = candidates.find((entry) => entry.file === file)?.code ?? '';
      expect({ file, chains: liveChains(code).length }).toEqual({ file, chains: 1 });
    }
  });

  it('a live table name appears only in allow-listed files, inline in .from(), with no write in the chain', () => {
    const problems = candidates.flatMap(({ file, code }) => literalProblems(file, code));
    expect(problems).toEqual([]);
  });
});

describe('LW-2: the pricing repository is read-only', () => {
  const code = stripComments(read(REPOSITORY));

  it('has no write call', () => {
    expect(code).not.toMatch(/[.](insert|update|upsert|delete)[(]/);
  });

  it('has exactly the three read methods', () => {
    const methods = [...code.matchAll(/^ {2}async ([A-Za-z]+)[(]/gm)].map((match) => match[1]);
    expect(methods.sort()).toEqual(['listActive', 'listActiveExact', 'listAll']);
  });
});

describe('LW-3: repositories name only the expected price tables and functions', () => {
  it('each file under lib/repositories holds exactly its expected ai_price_ / ai_model_ literals', () => {
    const repositoryFiles = candidates.filter(({ file }) => file.startsWith('lib/repositories/'));
    const files = new Set([...repositoryFiles.map(({ file }) => file), ...Object.keys(REPOSITORY_TABLES), ...Object.keys(REPOSITORY_FUNCTIONS)]);
    for (const file of files) {
      const code = repositoryFiles.find((entry) => entry.file === file)?.code ?? '';
      const found = [...new Set([...code.matchAll(REPO_LITERAL)].map((match) => match[1]))].sort();
      const expected = [...(REPOSITORY_TABLES[file] ?? []), ...(REPOSITORY_FUNCTIONS[file] ?? [])].sort();
      expect({ file, found }).toEqual({ file, found: expected });
    }
  });
});

describe('LW-5: SQL has one writer, and it does not exist yet', () => {
  it('no migration function writes a live price table; top-level DML only in the historic files', () => {
    const dir = path.join(ROOT, 'supabase/migrations');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(100);
    const problems = files.flatMap((name) => {
      const sql = fs.readFileSync(path.join(dir, name), 'utf8');
      return sql.includes('ai_model_') ? sqlProblems(name, sql) : [];
    });
    expect(problems).toEqual([]);
  });

  it('is not vacuous: the submit function body is found, and it names no live table', () => {
    const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20261066_ai_price_pending_area.sql'), 'utf8');
    const submit = sqlFunctions(sql.replace(/--.*$/gm, '')).find((fn) => fn.name === 'ai_price_submit_pending');
    expect(submit?.body).toContain('ai_price_proposal_lines');
    expect(isLiveDml(submit?.body ?? '')).toBe(false);
  });

  it('the historic files are still there (the allow-list is not stale)', () => {
    for (const name of SQL_HISTORIC_DML) expect({ name, exists: fs.existsSync(path.join(ROOT, 'supabase/migrations', name)) }).toEqual({ name, exists: true });
  });
});

describe('LW-4: negative controls', () => {
  const FILE = 'app/api/admin/agent-generation-config/route.ts';

  it.each([
    ['update', ".from('ai_model_pricing').update({ input_cost_per_token: 1 }).eq('id', id);"],
    ['insert', ".from('ai_model_image_pricing').insert(row);"],
    ['upsert, across lines', ".from(\n  'ai_model_pricing'\n)\n  .upsert(row);"],
    ['delete', '.from("ai_model_pricing").delete().eq("id", id);'],
  ])('LW-1 catches a %s chain', (_label, code) => {
    expect(literalProblems(FILE, code)).toEqual([`${FILE}: a write on a live price table`]);
  });

  it('LW-1 catches an alias and a file that is not allow-listed', () => {
    expect(literalProblems(FILE, "const t = 'ai_model_pricing';\nclient.from(t).update(x);")).toContain(
      `${FILE}: a live table name outside an inline .from('…')`
    );
    expect(literalProblems('lib/x.ts', ".from('ai_model_pricing').select('*');")).toEqual([
      'lib/x.ts: names a live price table and is not allow-listed',
    ]);
  });

  it('LW-1 passes a read, a write on another table after the chain ends, and a description string', () => {
    expect(literalProblems(FILE, ".from('ai_model_pricing').select('a').is('retired_date', null);\nawait s.from('system_settings_config').upsert(x);")).toEqual([]);
    expect(literalProblems('app/admin/system-flow/page.tsx', "pricing_source: 'lib/ai/pricing.ts (cached from ai_model_pricing table)',")).toEqual([]);
  });

  it('LW-5 catches a writing function and top-level DML in a new file; passes grants and history', () => {
    const fn = 'CREATE OR REPLACE FUNCTION public.ai_price_apply(p uuid) RETURNS void LANGUAGE plpgsql AS $fn$ BEGIN UPDATE public.ai_model_pricing SET retired_date = now(); END; $fn$;';
    expect(sqlProblems('20991231_x.sql', fn)).toEqual(['20991231_x.sql: function ai_price_apply writes a live price table']);
    expect(sqlProblems('20991231_x.sql', 'DELETE FROM public.ai_model_image_pricing;')).toEqual(['20991231_x.sql: top-level DML on a live price table']);
    expect(sqlProblems('20991231_x.sql', 'TRUNCATE TABLE ai_model_pricing;')).toHaveLength(1);
    expect(sqlProblems('20991231_x.sql', 'GRANT SELECT, INSERT, UPDATE (retired_date) ON TABLE public.ai_model_image_pricing TO service_role;')).toEqual([]);
    expect(sqlProblems('20991231_x.sql', '-- UPDATE public.ai_model_pricing in a comment')).toEqual([]);
    expect(sqlProblems('20260213_add_claude_46_pricing.sql', 'INSERT INTO ai_model_pricing (provider) VALUES (1);')).toEqual([]);
  });

  // SA CR-3 / QA Bug 2: the shapes the first matcher missed.
  it('LW-5 catches MERGE INTO in a function body, a quoted table name and a multi-table TRUNCATE', () => {
    const merge =
      'CREATE FUNCTION public.ai_price_apply_lines(p uuid) RETURNS void LANGUAGE plpgsql AS $body$ BEGIN MERGE INTO public.ai_model_pricing AS live USING src ON live.id = src.id WHEN MATCHED THEN UPDATE SET retired_date = now(); END; $body$;';
    expect(sqlProblems('20991231_x.sql', merge)).toEqual(['20991231_x.sql: function ai_price_apply_lines writes a live price table']);
    expect(sqlProblems('20991231_x.sql', 'UPDATE public."ai_model_pricing" SET retired_date = now();')).toEqual([
      '20991231_x.sql: top-level DML on a live price table',
    ]);
    expect(sqlProblems('20991231_x.sql', 'UPDATE "public".ai_model_image_pricing SET retired_date = now();')).toHaveLength(1);
    expect(sqlProblems('20991231_x.sql', 'TRUNCATE other_table, ai_model_pricing;')).toEqual([
      '20991231_x.sql: top-level DML on a live price table',
    ]);
    // The privilege word in a grant is not a truncate.
    expect(
      sqlProblems('20991231_x.sql', 'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.ai_model_pricing TO service_role;')
    ).toEqual([]);
    expect(sqlProblems('20991231_x.sql', 'REVOKE TRUNCATE ON TABLE public.ai_model_pricing FROM service_role;')).toEqual([]);
  });

  it('LW-3 reads literals, not comments', () => {
    expect([...stripComments("// 'ai_price_x'\nconst F = 'ai_price_submit_pending';").matchAll(REPO_LITERAL)].map((m) => m[1])).toEqual([
      'ai_price_submit_pending',
    ]);
  });
});

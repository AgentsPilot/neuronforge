/**
 * No PostgREST mutation may combine an `.or(...)` filter with `.select(...)`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS, AND WHY
 *
 * On production PostgREST, an UPDATE / DELETE / UPSERT that carries an `.or`
 * filter AND asks for the changed rows back (`.select(...)`, which sends
 * `Prefer: return=representation`) fails with
 *
 *     42703  column <table>.<col> does not exist
 *
 * whenever the column the `.or` names is not also in the select list. It is not
 * about the table or the column: `business_os_invites.claimed_at` and
 * `agents.status` both do it. The same UPDATE with no `.select`, or with
 * `.update(values, { count: 'exact' })`, works; so does a plain SELECT with
 * `.or`. Proven live on 2026-09-29, after Slice 1b's "Send me a code" returned
 * 503 on production.
 *
 * Jest mocks and in-memory SQL never reach PostgREST, so nothing else catches
 * it. The fix for a compare-and-swap is `{ count: 'exact' }` on the mutation
 * and no `.select` (see `casWon` in `BusinessOsInviteRepository.ts`).
 *
 * The scan is textual: comments and string contents are blanked, then for every
 * `.update(` / `.delete(` / `.upsert(` the rest of its enclosing block is read,
 * which also covers a chain assembled across statements
 * (`let query = …update(…).or(…); … await query.select('id')`). Reading to the
 * end of the block can only make this stricter, never miss a chain.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { BUSINESS_OS_INVITE_ADMIN_COLUMNS } from '../BusinessOsInviteRepository';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

const ROOTS = ['lib', 'app'];
const SKIP = new Set(['node_modules', '.next', '__tests__', 'dist', '.claude']);

/**
 * The single exemption, `file#method`. `revokeForAdmin` returns the revoked row
 * to the admin screen, and its select list (`BUSINESS_OS_INVITE_ADMIN_COLUMNS`)
 * contains `claimed_at`, the only column its `.or` names, which is exactly the
 * condition under which PostgREST accepts it (verified live, no-match id). The
 * last test below fails if that stops being true, or if the exemption goes
 * stale. Add nothing here: use `{ count: 'exact' }` instead.
 */
const EXEMPT = new Set(['lib/repositories/BusinessOsInviteRepository.ts#revokeForAdmin']);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(t|j)sx?$/.test(entry) && !/\.test\.(t|j)sx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** Blank comments and the contents of string literals, keeping every offset and newline. */
function stripCommentsAndStrings(src: string): string {
  const blank = (text: string) => text.replace(/[^\n]/g, ' ');
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      const newline = src.indexOf('\n', i);
      const end = newline < 0 ? src.length : newline;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === '/' && next === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close < 0 ? src.length : close + 2;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\') j++;
        j++;
      }
      out += c + blank(src.slice(i + 1, j)) + c;
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

interface Hit {
  line: number;
  op: string;
  method: string;
}

/** Every mutation whose enclosing block also calls both `.or(` and `.select(`. */
function mutationOrSelectHits(src: string): Hit[] {
  const code = stripCommentsAndStrings(src);
  const hits: Hit[] = [];
  const mutation = /\.(update|delete|upsert)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = mutation.exec(code))) {
    let depth = 0;
    let end = code.length;
    for (let k = match.index; k < code.length; k++) {
      if (code[k] === '{') depth++;
      else if (code[k] === '}') {
        if (depth === 0) {
          end = k;
          break;
        }
        depth--;
      }
    }
    const rest = code.slice(match.index, end);
    if (!/\.or\s*\(/.test(rest) || !/\.select\s*\(/.test(rest)) continue;

    const before = code.slice(0, match.index);
    const methods = [...before.matchAll(/async\s+(\w+)\s*\(/g)];
    hits.push({
      line: before.split('\n').length,
      op: match[1],
      method: methods.length > 0 ? methods[methods.length - 1][1] : '<unknown>',
    });
  }
  return hits;
}

function allHits(): string[] {
  const found: string[] = [];
  for (const root of ROOTS) {
    for (const file of sourceFiles(root)) {
      const rel = file.replace(/\\/g, '/');
      for (const hit of mutationOrSelectHits(readFileSync(file, 'utf8'))) {
        found.push(`${rel}#${hit.method}:${hit.line} (.${hit.op})`);
      }
    }
  }
  return found;
}

describe('PostgREST: no mutation combines .or(...) with .select(...)', () => {
  it('the scanner catches the shapes that broke production, and passes the safe ones', () => {
    // One chain, as `revokeForAdmin` is written.
    expect(mutationOrSelectHits(`async a() { await s.from('t').update({ x: 1 }).eq('id', i).or('c.is.null').select('id'); }`)).toHaveLength(1);
    // Assembled across statements, as the pre-hotfix `claimForSignup` was.
    expect(
      mutationOrSelectHits(`async b() { try { let q = s.from('t').update({ x: 1 }).or(f); q = q.is('y', null); const r = await q.select('id'); } catch (e) {} }`)
    ).toHaveLength(1);
    expect(mutationOrSelectHits(`async c() { await s.from('t').delete().or('a.is.null').select(); }`)).toHaveLength(1);
    expect(mutationOrSelectHits(`async d() { await s.from('t').upsert(r).or('a.is.null').select('id'); }`)).toHaveLength(1);

    // The hotfix shape, a plain SELECT with `.or`, and `.or` / `.select` only in text.
    expect(mutationOrSelectHits(`async e() { await s.from('t').update({ x: 1 }, { count: 'exact' }).or('c.is.null'); }`)).toHaveLength(0);
    expect(mutationOrSelectHits(`async f() { await s.from('t').select('id').or('c.is.null'); }`)).toHaveLength(0);
    expect(mutationOrSelectHits(`async g() { /* .or( .select( */ await s.from('t').update({ note: '.or( .select(' }).eq('id', i); }`)).toHaveLength(0);
  });

  it('no file in lib/ or app/ does it, beyond the one documented exemption', () => {
    const offenders = allHits().filter((hit) => !EXEMPT.has(hit.split(':')[0]));
    expect(offenders).toEqual([]);
  });

  it('the exemption is still live, and still meets the condition PostgREST needs', () => {
    const hits = allHits().map((hit) => hit.split(':')[0]);
    for (const exempt of EXEMPT) expect(hits).toContain(exempt);

    // revokeForAdmin's `.or` is `noLiveClaim`, which names `claimed_at` only.
    const source = readFileSync(join('lib', 'repositories', 'BusinessOsInviteRepository.ts'), 'utf8');
    expect(source).toMatch(/return `claimed_at\.is\.null,claimed_at\.lt\."\$\{cutoff\.toISOString\(\)\}"`;/);
    expect(source).toMatch(/\.or\(noLiveClaim\(input\.claimLeaseCutoff\)\)\s*\.select\(BUSINESS_OS_INVITE_ADMIN_COLUMNS\)/);
    expect(BUSINESS_OS_INVITE_ADMIN_COLUMNS.split(', ')).toContain('claimed_at');
  });
});

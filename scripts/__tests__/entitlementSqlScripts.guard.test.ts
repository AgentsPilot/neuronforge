/**
 * Hygiene rules for the entitlement SQL files.
 *
 * ⚠️ **THESE RULES DID NOT FIX THE PROBLEM, AND DO NOT EXPLAIN IT.** Read the
 * next section before you use this file as evidence of anything.
 *
 * ── WHAT WAS DISPROVEN, 2026-09-24 ──────────────────────────────────────────
 * The theory these rules were built on — that an apostrophe in a `--` comment
 * flips a quote-tracking splitter, after which a semicolon inside a string
 * literal reads as a statement terminator — is **WRONG**. The user pasted this
 * into the same Supabase SQL editor that had failed twice:
 *
 *     -- comment with an apostrophe: the editor's parser
 *     select 'semi ; inside a string' as a_test, 1 as n;
 *
 * It **ran and returned its row.** Both ingredients, together, in the editor
 * that fails on our files. So the editor handles them correctly and the
 * mechanism is disproven, not merely insufficient.
 *
 * **Do not re-run that experiment**, and do not repair the theory. What the
 * files actually hit is an OPEN QUESTION, recorded as such in the workplan
 * (§4.37). The failing tokens were `a` and `it` — ordinary English words from
 * our prose — so a fragment began mid-comment in both files; that is all that
 * is known.
 *
 * ── WHAT THIS FILE IS, THEN ─────────────────────────────────────────────────
 * Mechanical rules that remove constructs a naive splitter *could* mishandle.
 * They are cheap, they are checkable, and they are worth keeping as hygiene —
 * a semicolon inside a comment is a bad idea whatever the editor does with it.
 * **They are not a fix and not a proof that a file will paste.**
 *
 * The thing that was actually done about the failure is elsewhere: the three
 * PASTE scripts now carry **no `--` comments at all**, are split into several
 * small standalone statements, and use no single-letter aliases. That is not a
 * theory either — it is giving an uninspectable parser nothing to misparse.
 * Every word of explanation lives in
 * `docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md`.
 *
 * `verify-…` is exempt from the no-comments rule: it is a psql script that its
 * own header forbids pasting into the editor, and psql parses comments
 * correctly. The hygiene rules still apply to it.
 *
 * ── THE RULES ───────────────────────────────────────────────────────────────
 *   1. No semicolon in a `--` comment. 31 of these were live across the six
 *      files (QA A-2).
 *   2. No apostrophe in a `--` comment.
 *   3. No semicolon and no `--` inside a string literal.
 *   4. Nothing left unterminated, and balanced dollar-quote tags.
 *   5. No `--` comments at all in the three files the operator pastes, and each
 *      of them split into at least three statements.
 *
 * Rephrase — do not delete the punctuation — because `the backfills FK` is a
 * typo the next person corrects straight back into a bug.
 *
 * ── HOW IT PARSES ───────────────────────────────────────────────────────────
 * One stateful scan of the whole file, not a scan per line (QA A-3): a string
 * literal may span lines, and a per-line parser would read its second line as
 * code. It also understands `$tag$` dollar quoting (QA A-4) and recurses into
 * the body, which is where most of the comments in the two migrations live.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The three files the operator PASTES into the Supabase SQL editor.
 *
 * These carry the strictest rule: no `--` comments at all.
 */
const PASTE_SCRIPTS = [
  'scripts/preflight-bos-entitlements-migration.sql',
  'scripts/check-bos-entitlements-migration.sql',
  'scripts/rollback-bos-entitlements-migration.sql',
  // The privilege fix (2026-09-24) is a MIGRATION the operator pastes by hand,
  // so it is held to the paste rules as well as the hygiene ones.
  'supabase/migrations/20261009_business_os_entitlements_privilege_fix.sql',
];

/**
 * Every entitlement SQL file, including the two applied migrations.
 *
 * The migrations are here on SA's instruction (2026-09-24). They got away with
 * it — but they carried 20 and 5 comment apostrophes, 11 comment semicolons and
 * 2 string semicolons between them, which is one careless line from the same
 * failure, and the next migration will be written by copying one of them.
 *
 * `verify-…` is in this list but NOT in `PASTE_SCRIPTS`: it runs under psql,
 * never in the editor, and psql understands comments.
 */
const SQL_FILES = [
  'scripts/preflight-bos-entitlements-migration.sql',
  'scripts/check-bos-entitlements-migration.sql',
  'scripts/verify-bos-entitlements-migration.sql',
  'scripts/rollback-bos-entitlements-migration.sql',
  'supabase/migrations/20261005_business_os_entitlements.sql',
  'supabase/migrations/20261005b_business_os_entitlements_backfill.sql',
  'supabase/migrations/20261009_business_os_entitlements_privilege_fix.sql',
];

const read = (name: string) => readFileSync(join(process.cwd(), ...name.split('/')), 'utf8');

interface Token {
  kind: 'line_comment' | 'block_comment' | 'string' | 'dollar';
  text: string;
  line: number;
}

interface Scan {
  tokens: Token[];
  /** Non-null when the file ends inside something that was never closed. */
  unterminated: string | null;
}

/**
 * Scan a whole SQL file into its comments, string literals and dollar bodies.
 *
 * Deliberately written as the CORRECT parse, not as the naive one: the rules
 * then say "this comment contains a semicolon" and are right about it. The
 * naive parse is what we are defending against, not what we implement.
 */
function scan(sql: string): Scan {
  const tokens: Token[] = [];
  let line = 1;
  let i = 0;
  let depth = 0; // nested /* */, which Postgres allows

  const push = (kind: Token['kind'], text: string, at: number) => tokens.push({ kind, text, line: at });

  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (ch === '\n') {
      line += 1;
      i += 1;
      continue;
    }

    // ── /* block comment */, nestable ────────────────────────────────────
    if (ch === '/' && next === '*') {
      const startLine = line;
      let text = '';
      depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1;
          i += 2;
          continue;
        }
        if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1;
          i += 2;
          continue;
        }
        if (sql[i] === '\n') line += 1;
        text += sql[i];
        i += 1;
      }
      push('block_comment', text, startLine);
      if (depth > 0) return { tokens, unterminated: `block comment opened at line ${startLine}` };
      continue;
    }

    // ── -- line comment ──────────────────────────────────────────────────
    if (ch === '-' && next === '-') {
      const startLine = line;
      let text = '';
      while (i < sql.length && sql[i] !== '\n') {
        text += sql[i];
        i += 1;
      }
      push('line_comment', text, startLine);
      continue;
    }

    // ── $tag$ dollar-quoted body ─────────────────────────────────────────
    if (ch === '$') {
      const tag = /^\$[A-Za-z_][A-Za-z_0-9]*\$|^\$\$/.exec(sql.slice(i));
      if (tag) {
        const startLine = line;
        const close = sql.indexOf(tag[0], i + tag[0].length);
        if (close === -1) return { tokens, unterminated: `dollar quote ${tag[0]} opened at line ${startLine}` };
        const body = sql.slice(i + tag[0].length, close);
        push('dollar', body, startLine);
        // …and scan INSIDE it. A function body is where most of the comments
        // in the two migrations live, and a rule that stopped at the `$$`
        // would be blind to exactly the lines that matter most (QA A-4).
        for (const inner of scan(body).tokens) {
          push(inner.kind, inner.text, startLine + inner.line - 1);
        }
        line += (body.match(/\n/g) ?? []).length;
        i = close + tag[0].length;
        continue;
      }
    }

    // ── 'string literal', with '' as an escaped quote ─────────────────────
    if (ch === "'") {
      const startLine = line;
      let text = '';
      i += 1;
      for (;;) {
        if (i >= sql.length) return { tokens, unterminated: `string literal opened at line ${startLine}` };
        if (sql[i] === "'" && sql[i + 1] === "'") {
          text += "''";
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          i += 1;
          break;
        }
        if (sql[i] === '\n') line += 1;
        text += sql[i];
        i += 1;
      }
      push('string', text, startLine);
      continue;
    }

    i += 1;
  }

  return { tokens, unterminated: null };
}

/** Comments, wherever they are — including inside a function body. */
const commentsOf = (sql: string) =>
  scan(sql).tokens.filter((token) => token.kind === 'line_comment' || token.kind === 'block_comment');

const stringsOf = (sql: string) => scan(sql).tokens.filter((token) => token.kind === 'string');

describe.each(SQL_FILES)('%s survives a naive statement splitter', (name) => {
  const sql = read(name);

  it('has no semicolon inside a comment', () => {
    // The first ingredient, and the one that needs no theory: a splitter blind
    // to comments treats it as a terminator, and the rest of the sentence is
    // handed to the server as a statement. `-- LIMIT 20;` inside a commented-out
    // snippet counts — a comment runs nothing, so the terminator is decoration.
    const offenders = commentsOf(sql)
      .filter((token) => token.text.includes(';'))
      .map((token) => `L${token.line}: ${token.text.trim().slice(0, 80)}`);

    expect(offenders).toEqual([]);
  });

  it('has no apostrophe inside a comment', () => {
    const offenders = commentsOf(sql)
      .filter((token) => token.text.includes("'"))
      .map((token) => `L${token.line}: ${token.text.trim().slice(0, 80)}`);

    // If this fails: rephrase the sentence. "the backfill's rows" becomes
    // "the rows the backfill writes" — not "the backfills rows".
    expect(offenders).toEqual([]);
  });

  it('has no semicolon inside a string literal', () => {
    const offenders = stringsOf(sql)
      .filter((token) => token.text.includes(';'))
      .map((token) => `L${token.line}: ${token.text.slice(0, 80)}`);

    // If this fails: use a full stop, or the word "then". A semicolon inside a
    // message is never worth the risk of it being read as a terminator.
    expect(offenders).toEqual([]);
  });

  it('has no -- sequence inside a string literal', () => {
    // A splitter that strips comments with a regex would eat the rest of the
    // line, including the closing quote and whatever followed it.
    const offenders = stringsOf(sql)
      .filter((token) => token.text.includes('--'))
      .map((token) => `L${token.line}: ${token.text.slice(0, 80)}`);

    expect(offenders).toEqual([]);
  });

  it('closes everything it opens — strings, dollar quotes and block comments', () => {
    // The end state the rules above exist to guarantee. An unterminated
    // anything means every character after it is being read as something else,
    // which is how a file that looks fine produces an error about a word.
    expect(scan(sql).unterminated).toBeNull();
  });

  it('has balanced dollar-quote tags', () => {
    // Stated separately from the scan so the failure names the problem: an odd
    // number of `$$` turns a function body into an unclosed literal, and
    // everything after it into part of that literal.
    const tags = sql.match(/\$[A-Za-z_0-9]*\$/g) ?? [];
    const counts = new Map<string, number>();
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);

    expect([...counts].filter(([, count]) => count % 2 !== 0)).toEqual([]);
  });
});

describe.each(PASTE_SCRIPTS)('%s carries no inline documentation at all', (name) => {
  it('has no -- comment anywhere', () => {
    // The standard adopted on 2026-09-24 after two failed pastes. A comment is
    // the one construct a statement splitter has to understand and might not,
    // so the files the operator pastes contain none. The explanation lives in
    // docs/BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md, keyed by the `fix` column
    // of each row — which is better placed anyway, because that is the document
    // already open when something says FAIL.
    const offenders = commentsOf(read(name)).map((token) => `L${token.line}: ${token.text.trim().slice(0, 60)}`);

    expect(offenders).toEqual([]);
  });

  it('is split into several standalone statements', () => {
    // One large statement gives a splitter one large thing to cut in the middle
    // of. Several small ones mean a bad cut still produces valid SQL, and the
    // operator can see which block failed.
    const statements = read(name)
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    expect(statements.length).toBeGreaterThanOrEqual(3);
  });
});

describe('the runbook states the checker grid sizes correctly (QA-3)', () => {
  /**
   * The operator uses that table to tell whether a grid came back SHORT.
   *
   * A wrong number there is worse than no number: it turns a truncated result
   * into a normal-looking one. It WAS wrong — the table said block 2 returns
   * 10 rows besides its verdict when it returns 9 — so the numbers are derived
   * from the SQL here rather than maintained by hand.
   */
  const checker = read('scripts/check-bos-entitlements-migration.sql');
  const runbook = readFileSync(join(process.cwd(), 'docs', 'BUSINESS_OS_ENTITLEMENTS_APPLY_RUNBOOK.md'), 'utf8');

  /**
   * Every row the block returns, verdict included.
   *
   * A row is `SELECT <n>` where the number is the sort key, so it is followed
   * by a comma or by `AS sort,`. The trailing comma is what tells it apart from
   * the `SELECT 1` inside an `EXISTS`, which sits at the start of a line too and
   * is not a row.
   */
  const blocks = checker
    .split(';')
    .map((statement) => statement.trim())
    .filter((statement) => statement.startsWith('WITH'));

  const rowsPerBlock = blocks.map(
    (statement) => (statement.match(/^\s*SELECT \d+(,| AS sort,)/gm) ?? []).length
  );

  it('finds three blocks, each returning a verdict and some checks', () => {
    expect(blocks).toHaveLength(3);
    for (const rows of rowsPerBlock) expect(rows).toBeGreaterThan(2);
  });

  it('counts rows, not sub-selects', () => {
    // The non-vacuity leg: block 2 contains a line-leading `SELECT 1` inside an
    // EXISTS, and an earlier version of this counter read it as a row.
    expect(blocks[1]).toMatch(/^\s*SELECT 1$/m);
    expect(rowsPerBlock).toEqual([7, 10, 10]);
  });

  it.each([1, 2, 3])('block %s: the runbook number matches the file', (block) => {
    const opening = blocks[block - 1].split('\n')[0].trim();
    const line = runbook
      .split('\n')
      .find((text) => text.startsWith(`| ${block} | \``) && text.includes(opening));

    expect(line).toBeDefined();
    expect(line).toContain(`**${rowsPerBlock[block - 1]}**`);
  });
});

describe('the guard itself', () => {
  it('reads seven non-trivial files, four of them pasted by hand', () => {
    // A guard whose file list silently stopped matching would pass for ever.
    for (const name of SQL_FILES) expect(read(name).length).toBeGreaterThan(2000);
    expect(SQL_FILES).toHaveLength(7);
    expect(PASTE_SCRIPTS).toHaveLength(4);
    for (const name of PASTE_SCRIPTS) expect(SQL_FILES).toContain(name);
  });

  it('covers every migration, not only the scripts', () => {
    // Named explicitly: the migrations are the files most likely to be dropped
    // from the list by someone tidying it, and they are the ones a future
    // migration will be copied from.
    expect(SQL_FILES.filter((name) => name.startsWith('supabase/migrations/'))).toHaveLength(3);
  });

  it('detects the exact shapes the rules forbid', () => {
    // The negative control. These are real lines from the files as they stood
    // on 2026-09-23 and 2026-09-24 — NOT, as this test used to claim, the lines
    // that broke the paste. The probe on 2026-09-24 disproved that (see the
    // header). They are what the rules are written against, nothing more.
    const apostrophe = "-- the backfill's READ cost (this file performs the same scan)";
    expect(commentsOf(apostrophe).some((token) => token.text.includes("'"))).toBe(true);

    const commentSemicolon = '--      `authenticated` and GRANTs to `service_role`; a missing role aborts it.';
    expect(commentsOf(commentSemicolon).some((token) => token.text.includes(';'))).toBe(true);

    const stringSemicolon = "         'The editor''s execution time is the READ cost; the insert adds more'";
    expect(stringsOf(stringSemicolon).some((token) => token.text.includes(';'))).toBe(true);
  });

  it('does NOT flag punctuation that is legitimately SQL', () => {
    // The other half of the control: a guard that flagged everything would
    // satisfy every assertion above and mean nothing.
    const legitimate = "  RAISE EXCEPTION 'the tenant does not exist';";
    expect(commentsOf(legitimate)).toEqual([]);
    expect(stringsOf(legitimate).some((token) => token.text.includes(';'))).toBe(false);
  });

  it('reads a string literal that spans lines as ONE string (QA A-3)', () => {
    // A per-line parser would read the second line as code, and its `--` as the
    // start of a comment — so it would report the opposite of the truth on
    // exactly the construct most likely to hide one of these.
    const multiline = "SELECT 'first line\nsecond line -- not a comment; not a terminator' AS x;";
    const strings = stringsOf(multiline);

    expect(strings).toHaveLength(1);
    expect(commentsOf(multiline)).toEqual([]);
    expect(strings[0].text).toContain('--');
    expect(strings[0].text).toContain(';');
  });

  it('reads a $$ body as one unit, and the comments inside it (QA A-4)', () => {
    // Dollar quoting is not optional knowledge here: the rollback and both
    // migrations are mostly `DO $$ … $$`, and a parser blind to it would treat
    // every apostrophe in a body as a quote and mis-state every later line.
    const body = "DO $$\nBEGIN\n  -- a comment inside the body\n  RAISE NOTICE 'hi';\nEND $$;";
    const tokens = scan(body).tokens;

    expect(tokens.filter((token) => token.kind === 'dollar')).toHaveLength(1);
    expect(scan(body).unterminated).toBeNull();
    // The comment inside the body is still found, because a comment is a
    // comment wherever it sits — that is what makes the rules above total.
    expect(commentsOf(body).map((token) => token.text.trim())).toEqual(['-- a comment inside the body']);
  });

  it('notices an unterminated dollar quote', () => {
    expect(scan('DO $$ BEGIN RETURN; END').unterminated).toContain('dollar quote');
    expect(scan("SELECT 'never closed").unterminated).toContain('string literal');
  });
});

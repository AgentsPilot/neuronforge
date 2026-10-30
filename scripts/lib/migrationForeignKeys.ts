/**
 * Static replay of the foreign keys declared by `supabase/migrations/*.sql`.
 *
 * Pure: no file system, no database, no network. The caller reads the files,
 * normalises CRLF, and passes `{ file, sql }[]`. The replay applies them in
 * plain code-unit filename order and returns the foreign keys as they stand
 * after the last migration, plus every place it could not read with certainty
 * (fail closed: the caller decides what to excuse).
 *
 * Built for the test-account cleanup inbound-FK guard
 * (docs/requirements/TEST_ACCOUNT_CLEANUP_INBOUND_FK_GUARD_REQUIREMENT.md, SA-3
 * and SA-5). It carries its own tokenizer on purpose: the `scan` in
 * scripts/__tests__/testAccountCleanupSql.test.ts is tuned to generated output
 * and has no quoted identifiers, nested comments, E'' strings or dollar tags
 * with digits, all of which hand-written migrations use.
 *
 * What the replay understands (SA-5):
 *   - CREATE TABLE [IF NOT EXISTS]: inline column REFERENCES and table-level
 *     [CONSTRAINT n] FOREIGN KEY (...) REFERENCES ...
 *   - ALTER TABLE [IF EXISTS] [ONLY]: ADD [COLUMN] [IF NOT EXISTS] ...
 *     REFERENCES, ADD [CONSTRAINT n] FOREIGN KEY, DROP CONSTRAINT [IF EXISTS],
 *     RENAME CONSTRAINT, DROP [COLUMN], RENAME [COLUMN], RENAME TO
 *   - DROP TABLE (removes the table's FKs and every FK pointing at it)
 *   - the same statements inside DO $$ ... $$ bodies, treated as executed
 * Anything else carries no FK. FK syntax it cannot attribute to one of those
 * statements is a problem. FK syntax inside a string literal, or inside a
 * non-DO dollar body (a function body), is DYNAMIC and reported separately.
 *
 * Out of reach: SQL assembled across several assignments, or through other
 * functions (a helper that returns the DDL text, format() of a variable built
 * elsewhere). The joiner sees one statement at a time, and the EXECUTE
 * backstop needs the FK words in a string of the EXECUTE statement itself.
 * Like FKs that exist only on prod, those stay G-18's runtime job.
 */

/** One migration file, already CRLF-normalised by the caller. */
export interface MigrationFile {
  readonly file: string;
  readonly sql: string;
}

export type TokenKind = 'word' | 'ident' | 'string' | 'dollar' | 'comment' | 'punct' | 'other';

export interface Token {
  readonly kind: TokenKind;
  /**
   * word: lower-cased. ident: the quoted name as written, quotes removed.
   * string: the literal's content. dollar: the body between the tags.
   * comment / punct / other: the raw text.
   */
  readonly text: string;
  /** Offset of the token's first character in the tokenized text. */
  readonly start: number;
  /** Offset of the first character of `text` (differs from start for string, dollar, ident). */
  readonly contentStart: number;
  /**
   * string only: where each piece of `text` came from. More than one piece when
   * Postgres joined adjacent constants across a newline (`'a'` newline `'b'` is `'ab'`).
   * `at` is the index in `text`, `start` the offset in the tokenized text.
   */
  readonly pieces?: ReadonlyArray<StringPiece>;
}

export interface StringPiece {
  readonly at: number;
  readonly start: number;
}

export interface TokenizeError {
  readonly offset: number;
  readonly message: string;
}

export interface TokenizeResult {
  readonly tokens: Token[];
  /** Set when a comment, string, quoted identifier or dollar body never ends. */
  readonly error: TokenizeError | null;
}

const PUNCT = new Set(['(', ')', ',', ';', '.']);

// Character classes by code unit: the tokenizer is the hot loop of the guard (SA-7).
const isIdentStart = (c: number): boolean => (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || c === 95 || c >= 128;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isIdentPart = (c: number): boolean => isIdentStart(c) || isDigit(c) || c === 36;
const isTagPart = (c: number): boolean => isIdentStart(c) || isDigit(c);

/**
 * Reads a quoted run that starts after `open` and ends at the first `quote`
 * not doubled. With `backslash`, a backslash escapes the next character
 * (E'' strings). Returns the decoded body and the offset after the closing
 * quote, or null when it never closes.
 */
function readQuoted(sql: string, open: number, quote: string, backslash: boolean): { body: string; end: number } | null {
  let body = '';
  let from = open;
  for (;;) {
    const q = sql.indexOf(quote, from);
    // Only looks for a backslash before the next quote, so the search stays linear.
    const b = backslash ? sql.slice(from, q === -1 ? sql.length : q).indexOf('\\') : -1;
    if (b !== -1) {
      const at = from + b;
      body += sql.slice(from, at + 2);
      from = at + 2;
      continue;
    }
    if (q === -1) return null;
    body += sql.slice(from, q);
    if (sql[q + 1] === quote) {
      body += quote;
      from = q + 2;
      continue;
    }
    return { body, end: q + 1 };
  }
}

/**
 * The offset of the quote that continues a string constant ending at `from`,
 * or -1: only whitespace and `--` comments between, at least one newline.
 */
function continuedQuote(sql: string, from: number): number {
  let j = from;
  let newline = false;
  for (;;) {
    const c = sql.charCodeAt(j);
    if (c === 10) {
      newline = true;
      j++;
    } else if (c === 32 || c === 9 || c === 13 || c === 12) j++;
    else if (c === 45 && sql.charCodeAt(j + 1) === 45) {
      const end = sql.indexOf('\n', j);
      if (end === -1) return -1;
      j = end;
    } else return newline && c === 39 ? j : -1;
  }
}

/**
 * Splits SQL into tokens. Handles `--` and nested block comments, standard and
 * E'' strings, quoted identifiers ("" escape), and dollar-quoted bodies whose
 * tag may contain digits. Never throws: an unterminated construct ends the
 * token list and sets `error`.
 */
export function tokenize(sql: string): TokenizeResult {
  const tokens: Token[] = [];
  const n = sql.length;
  let i = 0;
  const fail = (offset: number, message: string): TokenizeResult => ({ tokens, error: { offset, message } });

  while (i < n) {
    const c = sql.charCodeAt(i);
    const next = sql[i + 1];
    if (c === 32 || c === 10 || c === 9 || c === 13 || c === 12) {
      i++;
      continue;
    }
    if (c === 45 && next === '-') {
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      tokens.push({ kind: 'comment', text: sql.slice(i, stop), start: i, contentStart: i });
      i = stop;
      continue;
    }
    if (c === 47 && next === '*') {
      let depth = 1;
      let j = i + 2;
      // A char loop, not indexOf('/*'): that searches to the end of the file
      // for every comment that holds no nested one, which is quadratic.
      while (depth > 0) {
        if (j >= n) return fail(i, 'unterminated block comment');
        const d = sql.charCodeAt(j);
        if (d === 47 && sql.charCodeAt(j + 1) === 42) {
          depth++;
          j += 2;
        } else if (d === 42 && sql.charCodeAt(j + 1) === 47) {
          depth--;
          j += 2;
        } else j++;
      }
      tokens.push({ kind: 'comment', text: sql.slice(i, j), start: i, contentStart: i });
      i = j;
      continue;
    }
    // E'...' (backslash escapes), N'', B'', X'' and U&''. A prefix letter is
    // only a prefix at a token start, which is where this loop always is.
    const lower = c | 32;
    const prefix =
      next === "'" && (lower === 101 || lower === 110 || lower === 98 || lower === 120)
        ? 1
        : lower === 117 && next === '&' && sql[i + 2] === "'"
          ? 2
          : 0;
    if (c === 39 || prefix > 0) {
      const open = i + prefix + 1;
      const backslash = prefix === 1 && lower === 101;
      const unterminated = backslash ? 'unterminated E string' : 'unterminated string literal';
      let read = readQuoted(sql, open, "'", backslash);
      if (!read) return fail(i, unterminated);
      let text = read.body;
      const pieces: StringPiece[] = [{ at: 0, start: open }];
      // Postgres joins two constants separated only by whitespace (and -- comments)
      // that holds a newline: the lexer's quotecontinue rule. 'a' newline 'b' is one string.
      for (;;) {
        const next = continuedQuote(sql, read.end);
        if (next === -1) break;
        const more = readQuoted(sql, next + 1, "'", backslash);
        if (!more) return fail(next, unterminated);
        pieces.push({ at: text.length, start: next + 1 });
        text += more.body;
        read = more;
      }
      tokens.push({ kind: 'string', text, start: i, contentStart: open, pieces });
      i = read.end;
      continue;
    }
    if (c === 34) {
      const read = readQuoted(sql, i + 1, '"', false);
      if (!read) return fail(i, 'unterminated quoted identifier');
      tokens.push({ kind: 'ident', text: read.body, start: i, contentStart: i + 1 });
      i = read.end;
      continue;
    }
    if (c === 36) {
      // $tag$ or $$: the tag is an identifier without `$`, digits allowed after the first character.
      let j = i + 1;
      if (j < n && isIdentStart(sql.charCodeAt(j))) {
        j++;
        while (j < n && isTagPart(sql.charCodeAt(j))) j++;
      }
      if (sql[j] === '$') {
        const tag = sql.slice(i, j + 1);
        const bodyStart = j + 1;
        const close = sql.indexOf(tag, bodyStart);
        if (close === -1) return fail(i, `unterminated dollar-quoted body ${tag}`);
        tokens.push({ kind: 'dollar', text: sql.slice(bodyStart, close), start: i, contentStart: bodyStart });
        i = close + tag.length;
        continue;
      }
      // $1 positional parameter.
      j = i + 1;
      while (j < n && isDigit(sql.charCodeAt(j))) j++;
      tokens.push({ kind: 'other', text: sql.slice(i, j), start: i, contentStart: i });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < n && isIdentPart(sql.charCodeAt(j))) j++;
      tokens.push({ kind: 'word', text: sql.slice(i, j).toLowerCase(), start: i, contentStart: i });
      i = j;
      continue;
    }
    if (isDigit(c)) {
      let j = i + 1;
      while (j < n && (isDigit(sql.charCodeAt(j)) || sql.charCodeAt(j) === 95)) j++;
      tokens.push({ kind: 'other', text: sql.slice(i, j), start: i, contentStart: i });
      i = j;
      continue;
    }
    const ch = sql[i];
    tokens.push({ kind: PUNCT.has(ch) ? 'punct' : 'other', text: ch, start: i, contentStart: i });
    i++;
  }
  return { tokens, error: null };
}

// ── Names ───────────────────────────────────────────────────────────────────

/** Postgres NAMEDATALEN - 1: the longest identifier, in bytes. */
export const MAX_IDENTIFIER_BYTES = 63;

const byteLength = (s: string): number => Buffer.byteLength(s, 'utf8');

/** Cuts `s` to at most `bytes` UTF-8 bytes without splitting a character (pg_mbcliplen). */
function clipBytes(s: string, bytes: number): string {
  let out = '';
  let used = 0;
  for (const ch of s) {
    const size = byteLength(ch);
    if (used + size > bytes) break;
    out += ch;
    used += size;
  }
  return out;
}

/**
 * Postgres `makeObjectName(name1, name2, label)`: `name1_name2_label`, the
 * longer of name1 and name2 shortened one byte at a time (name2 on a tie) until
 * the whole fits in 63 bytes.
 */
export function makeObjectName(name1: string, name2: string, label: string): string {
  const overhead = 1 + label.length + 1;
  const avail = MAX_IDENTIFIER_BYTES - overhead;
  let n1 = byteLength(name1);
  let n2 = byteLength(name2);
  while (n1 + n2 > avail) {
    if (n1 > n2) n1--;
    else n2--;
  }
  return `${clipBytes(name1, n1)}_${clipBytes(name2, n2)}_${label}`;
}

/** Postgres `ChooseForeignKeyConstraintNameAddition`: column names joined by `_`, stopped once 63 bytes are reached. */
function foreignKeyNameAddition(columns: readonly string[]): string {
  let buf = '';
  for (const column of columns) {
    if (buf.length > 0) buf += '_';
    buf += clipBytes(column, MAX_IDENTIFIER_BYTES);
    if (byteLength(buf) >= MAX_IDENTIFIER_BYTES + 1) break;
  }
  return buf;
}

/**
 * The name Postgres gives an unnamed foreign key: `<table>_<cols>_fkey`,
 * truncated to 63 bytes, with a numeric suffix (`_fkey1`, `_fkey2`, ...) while
 * the name is already taken. SA-5.5 models the collision against the names
 * the replay holds for the same table (Postgres checks the whole schema; the
 * table name is part of the name, so the two only differ for truncated names).
 */
export function defaultForeignKeyName(table: string, columns: readonly string[], taken: ReadonlySet<string> = new Set()): string {
  const addition = foreignKeyNameAddition(columns);
  for (let pass = 0; ; pass++) {
    const name = makeObjectName(table, addition, pass === 0 ? 'fkey' : `fkey${pass}`);
    if (!taken.has(name)) return name;
  }
}

// ── The replay ──────────────────────────────────────────────────────────────

export interface ForeignKey {
  /** The migration that declared it (or the dynamic file it was injected for). */
  readonly file: string;
  readonly line: number;
  readonly childSchema: string;
  readonly childTable: string;
  readonly childColumns: readonly string[];
  readonly parentSchema: string;
  readonly parentTable: string;
  /** null: `REFERENCES t` with no column list (the primary key). */
  readonly parentColumns: readonly string[] | null;
  readonly constraint: string;
  readonly origin: 'static' | 'injected';
}

/** A foreign key the caller adds by hand, e.g. the expansion of a dynamic loop (SA-4a). */
export interface ForeignKeySpec {
  readonly childSchema?: string;
  readonly childTable: string;
  readonly childColumns: readonly string[];
  readonly parentSchema?: string;
  readonly parentTable: string;
  readonly parentColumns: readonly string[] | null;
  readonly constraint: string;
}

/**
 * Hand-written changes applied right after a file's own statements (SA-4):
 * `inject` adds a foreign key, `rename` renames one, `remove` deletes one.
 * A rename or remove that finds nothing, or any adjustment whose file is not
 * in the input, comes back in `unmatched`.
 */
export type ReplayAdjustment =
  | { readonly file: string; readonly kind: 'inject'; readonly fk: ForeignKeySpec }
  | { readonly file: string; readonly kind: 'rename'; readonly childSchema?: string; readonly childTable: string; readonly from: string; readonly to: string }
  | { readonly file: string; readonly kind: 'remove'; readonly childSchema?: string; readonly childTable: string; readonly constraint: string };

export interface ReplayProblem {
  readonly file: string;
  readonly line: number;
  readonly kind: 'unterminated' | 'unattributed';
  readonly message: string;
}

/** FK syntax inside a string literal or a non-DO dollar body (SA-4). */
export interface DynamicForeignKeySql {
  readonly file: string;
  readonly line: number;
  readonly excerpt: string;
}

export interface ReplayResult {
  /** The foreign keys after the last migration, sorted by child then constraint. */
  readonly foreignKeys: ForeignKey[];
  readonly problems: ReplayProblem[];
  readonly dynamic: DynamicForeignKeySql[];
  readonly unmatched: ReplayAdjustment[];
}

/** Plain code-unit order, never localeCompare (SA-5.1). */
export const compareFileNames = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface QualifiedName {
  readonly schema: string;
  readonly name: string;
}

const tableKey = (schema: string, table: string): string => `${schema}.${table}`;

/** FK syntax in free text (strings and function bodies): `FOREIGN KEY (`/`%`, or `REFERENCES <ident>` followed by `(` or a clause that only FKs take. */
// format() specifiers include the positional form `%2$I` (SA code review 1c).
// After `REFERENCES <name>`, any column-constraint keyword ends the match too
// (`NOT NULL`, `DEFAULT`, ...): prose never puts one there, an inline FK can (SA re-review).
const NAME_PART = String.raw`(?:%(?:\d+\$)?[IiLsS]|"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const DYNAMIC_FK_PATTERNS: readonly RegExp[] = [
  /\bforeign\s+key\s*[(%]/i,
  new RegExp(
    String.raw`\breferences\s+(?!on\b)${NAME_PART}(?:\s*\.\s*${NAME_PART})?\s*(?:\(|$|,|;|\)|on\s+(?:delete|update)\b|not\s+(?:valid|null|deferrable)\b|null\b|default\b|check\b|unique\b|primary\s+key\b|constraint\b|deferrable\b|match\b|initially\b)`,
    'i',
  ),
];

/** Index in `text` where FK syntax starts, or -1. */
function dynamicFkIndex(text: string): number {
  let best = -1;
  for (const re of DYNAMIC_FK_PATTERNS) {
    const m = re.exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

const hasDynamicFkSyntax = (text: string): boolean => dynamicFkIndex(text) !== -1;

/**
 * Words that end a non-literal operand of a `||` chain at paren depth 0
 * (plpgsql and SQL clauses that can follow an expression).
 */
const OPERAND_STOPS: ReadonlySet<string> = new Set(['using', 'into', 'then', 'else', 'end', 'loop', 'as', 'when', 'from', 'and', 'or']);

/** One string constant, or a `'a' || x || 'b'` chain, read as one text: non-literal operands stand in as `%s`. */
interface StringChain {
  readonly text: string;
  /** `at`: index in `text`; `start`: offset in the file. */
  readonly pieces: StringPiece[];
}

const isConcat = (toks: readonly Token[], j: number): boolean =>
  toks[j]?.kind === 'other' &&
  toks[j].text === '|' &&
  toks[j + 1]?.kind === 'other' &&
  toks[j + 1].text === '|' &&
  toks[j + 1].start === toks[j].start + 1;

/**
 * Every string chain in a token list (comments already removed). `ats[k]` is
 * the file offset of `toks[k]`. SA code review 1a/1b: an FK split across
 * adjacent constants or `||` operands is judged as the text Postgres would run.
 * The caller leaves out COMMENT ON statements (their prose is not SQL).
 */
function stringChains(toks: readonly Token[], ats: readonly number[]): StringChain[] {
  const chains: StringChain[] = [];
  const inChain = new Set<number>();
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].kind !== 'string' || inChain.has(i)) continue;
    let text = '';
    const pieces: StringPiece[] = [];
    const addString = (k: number): void => {
      const tok = toks[k];
      for (const p of tok.pieces ?? [{ at: 0, start: tok.contentStart }]) {
        pieces.push({ at: text.length + p.at, start: ats[k] + (p.start - tok.start) });
      }
      text += tok.text;
      inChain.add(k);
    };
    addString(i);
    let j = skipCast(toks, i + 1);
    while (isConcat(toks, j)) {
      j += 2;
      if (toks[j]?.kind === 'string') {
        addString(j);
        j = skipCast(toks, j + 1);
        continue;
      }
      pieces.push({ at: text.length, start: ats[Math.min(j, toks.length - 1)] });
      text += '%s';
      let depth = 0;
      while (j < toks.length) {
        const t = toks[j];
        if (depth === 0 && (isConcat(toks, j) || isPunct(t, ',') || isPunct(t, ';') || isPunct(t, ')') || isAnyWord(t, OPERAND_STOPS))) break;
        if (isPunct(t, '(')) depth++;
        else if (isPunct(t, ')')) depth--;
        j++;
      }
    }
    chains.push({ text, pieces });
  }
  return chains;
}

/** Whole-word FK phrase in a string: only consulted for statements that run EXECUTE (R-1). */
const FK_PHRASE = /\bforeign\s+key\b|\breferences\b/i;

/** The statement runs dynamic SQL: an EXECUTE that is not EXECUTE FUNCTION / PROCEDURE (trigger syntax). */
const runsExecute = (toks: readonly Token[]): boolean =>
  toks.some((t, k) => isWord(t, 'execute') && !isWord(toks[k + 1], 'function') && !isWord(toks[k + 1], 'procedure'));

/** Past a `::type` cast after a chain operand (`'…'::text`, `::character varying(10)`), or `j` unchanged. */
function skipCast(toks: readonly Token[], j: number): number {
  while (toks[j]?.kind === 'other' && toks[j].text === ':' && toks[j + 1]?.text === ':' && toks[j + 1].start === toks[j].start + 1) {
    j += 2;
    while (isName(toks[j]) && !isAnyWord(toks[j], OPERAND_STOPS)) j++;
    if (isPunct(toks[j], '(')) {
      while (j < toks.length && !isPunct(toks[j], ')')) j++;
      j++;
    }
  }
  return j;
}

/** File offset of index `index` of a chain's text. */
function chainOffset(chain: StringChain, index: number): number {
  let piece = chain.pieces[0];
  for (const p of chain.pieces) if (p.at <= index) piece = p;
  return piece.start + (index - piece.at);
}
/** Whole words only: `user_preferences` holds "references" and is in every generated cleanup body. */
const FK_WORDS = /\breferences\b|\bforeign\b/i;

class LineIndex {
  private readonly starts: number[] = [0];
  constructor(text: string) {
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) this.starts.push(i + 1);
  }
  line(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
}

/** One statement's tokens, and each token's offset in the whole file (bodies are re-tokenized at an offset). */
interface Statement {
  readonly toks: Token[];
  readonly ats: number[];
}

const isWord = (t: Token | undefined, word: string): boolean => t !== undefined && t.kind === 'word' && t.text === word;
const isAnyWord = (t: Token | undefined, words: ReadonlySet<string>): boolean => t !== undefined && t.kind === 'word' && words.has(t.text);
const TABLE_MODIFIERS: ReadonlySet<string> = new Set(['global', 'local', 'temp', 'temporary', 'unlogged']);
const TABLE_CONSTRAINT_STARTS: ReadonlySet<string> = new Set(['constraint', 'foreign', 'primary', 'unique', 'check', 'exclude', 'like']);
const isPunct = (t: Token | undefined, p: string): boolean => t !== undefined && t.kind === 'punct' && t.text === p;
const isName = (t: Token | undefined): boolean => t !== undefined && (t.kind === 'word' || t.kind === 'ident');

class Replay {
  /** `schema.table` -> constraint -> FK. */
  private readonly fks = new Map<string, Map<string, ForeignKey>>();
  private readonly tables = new Set<string>();
  private readonly columns = new Map<string, Set<string>>();
  readonly problems: ReplayProblem[] = [];
  readonly dynamic: DynamicForeignKeySql[] = [];

  private file = '';
  private lines: LineIndex = new LineIndex('');

  run(file: string, sql: string): void {
    this.file = file;
    this.lines = new LineIndex(sql);
    this.block(sql, 0, false);
  }

  private lineOf(offset: number): number {
    return this.lines.line(offset);
  }

  /**
   * Tokenizes `text` (found at `base` in the file) and runs its statements.
   * `inDo`: the text is a DO body (plpgsql), so a statement may start after
   * IF ... THEN and the DDL is found anywhere at paren depth 0.
   */
  private block(text: string, base: number, inDo: boolean): void {
    const { tokens, error } = tokenize(text);
    if (error) {
      this.problems.push({ file: this.file, line: this.lineOf(base + error.offset), kind: 'unterminated', message: error.message });
      return;
    }
    let statement: Statement = { toks: [], ats: [] };
    for (const token of tokens) {
      if (token.kind === 'comment') continue;
      if (isPunct(token, ';')) {
        this.statement(statement, inDo);
        statement = { toks: [], ats: [] };
      } else {
        statement.toks.push(token);
        statement.ats.push(base + token.start);
      }
    }
    this.statement(statement, inDo);
  }

  private statement(stmt: Statement, inDo: boolean): void {
    if (stmt.toks.length === 0) return;
    const toks = stmt.toks;
    const isDo = !inDo && isWord(toks[0], 'do');
    const isComment = isWord(toks[0], 'comment') && isWord(toks[1], 'on');

    // Bodies and strings: DO bodies run as DDL, other bodies and strings are only scanned.
    for (let k = 0; k < toks.length; k++) {
      const token = toks[k];
      if (token.kind !== 'dollar') continue;
      const bodyAt = stmt.ats[k] + (token.contentStart - token.start);
      if (isDo) this.block(token.text, bodyAt, true);
      else this.scanDynamic(token.text, bodyAt);
    }
    if (!isComment) this.scanChains(toks, stmt.ats);
    if (isDo) return;

    const consumed = new Set<number>();
    const start = this.findDdl(toks, inDo);
    if (start !== null) this.ddl(stmt, start, consumed);

    // FK syntax in code that no recognised statement claimed (SA-5.7).
    for (let i = 0; i < toks.length; i++) {
      if (consumed.has(i)) continue;
      const fkSyntax =
        (isWord(toks[i], 'foreign') && isWord(toks[i + 1], 'key')) ||
        (isWord(toks[i], 'references') && isName(toks[i + 1]) && !isWord(toks[i + 1], 'on'));
      if (fkSyntax) {
        this.problems.push({
          file: this.file,
          line: this.lineOf(stmt.ats[i]),
          kind: 'unattributed',
          message: 'foreign key syntax outside a statement the replay understands (CREATE TABLE, ALTER TABLE)',
        });
      }
    }
  }

  /** Scans a function body (or any non-DO dollar body) for FK syntax, in its code and in its strings. */
  private scanDynamic(text: string, base: number): void {
    // Without either word there can be no FK syntax: skip the tokenize. The
    // generated cleanup functions are 300 kB bodies each (SA-7 budget).
    if (!FK_WORDS.test(text)) return;
    const { tokens, error } = tokenize(text);
    if (error) {
      // A function body need not be SQL (plv8, etc.): fall back to the raw text.
      if (hasDynamicFkSyntax(text)) this.reportDynamic(base, text);
      return;
    }
    // Code is checked a statement at a time, and only a statement holding one
    // of the two words is joined and matched.
    const code: string[] = [];
    let fkWordAt = -1;
    const flush = (): void => {
      if (fkWordAt !== -1) {
        const text = code.join(' ');
        if (hasDynamicFkSyntax(text)) this.reportDynamic(fkWordAt, text);
      }
      code.length = 0;
      fkWordAt = -1;
    };
    const live = tokens.filter((t) => t.kind !== 'comment');
    for (const token of live) {
      const at = base + token.start;
      if (token.kind === 'dollar') this.scanDynamic(token.text, base + token.contentStart);
      else if (token.kind === 'string') continue;
      else if (isPunct(token, ';')) flush();
      else {
        if (fkWordAt === -1 && (isWord(token, 'references') || isWord(token, 'foreign'))) fkWordAt = at;
        code.push(token.kind === 'ident' ? `"${token.text}"` : token.text);
      }
    }
    flush();
    this.scanChains(
      live,
      live.map((t) => base + t.start),
    );
  }

  /**
   * Per statement: reports every string chain whose text holds FK syntax, at
   * the line where the syntax starts. When no chain does, the EXECUTE backstop
   * (SA re-review R-1) still reports a statement that runs EXECUTE (not
   * EXECUTE FUNCTION / PROCEDURE) and holds a string with a whole-word
   * FOREIGN KEY or REFERENCES: casts and concat() hide the shape from the joiner.
   */
  private scanChains(toks: readonly Token[], ats: readonly number[]): void {
    let from = 0;
    for (let k = 0; k <= toks.length; k++) {
      if (k < toks.length && !isPunct(toks[k], ';')) continue;
      const stmtToks = toks.slice(from, k);
      const stmtAts = ats.slice(from, k);
      from = k + 1;
      let reported = false;
      for (const chain of stringChains(stmtToks, stmtAts)) {
        const index = dynamicFkIndex(chain.text);
        if (index === -1) continue;
        this.reportDynamic(chainOffset(chain, index), chain.text);
        reported = true;
      }
      if (reported || !runsExecute(stmtToks)) continue;
      const hit = stmtToks.findIndex((t) => t.kind === 'string' && FK_PHRASE.test(t.text));
      if (hit !== -1) this.reportDynamic(stmtAts[hit], stmtToks[hit].text);
    }
  }

  private reportDynamic(at: number, text: string): void {
    this.dynamic.push({ file: this.file, line: this.lineOf(at), excerpt: text.replace(/\s+/g, ' ').trim().slice(0, 160) });
  }

  /** Index of the first token of CREATE TABLE / ALTER TABLE / DROP TABLE, or null. */
  private findDdl(toks: Token[], inDo: boolean): number | null {
    let depth = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (isPunct(t, '(')) depth++;
      else if (isPunct(t, ')')) depth--;
      if (depth !== 0) continue;
      if (!inDo && i > 0) return null;
      if ((isWord(t, 'alter') || isWord(t, 'drop')) && isWord(toks[i + 1], 'table')) return i;
      if (isWord(t, 'create')) {
        let j = i + 1;
        while (isAnyWord(toks[j], TABLE_MODIFIERS)) j++;
        if (isWord(toks[j], 'table')) return i;
        if (!inDo) return null;
      }
      if (!inDo) return null;
    }
    return null;
  }

  private ddl(stmt: Statement, start: number, consumed: Set<number>): void {
    const toks = stmt.toks;
    if (isWord(toks[start], 'create')) this.createTable(stmt, start, consumed);
    else if (isWord(toks[start], 'alter')) this.alterTable(stmt, start + 2, consumed);
    else this.dropTable(toks, start + 2);
  }

  /** Reads `name` or `schema.name` at `i`. */
  private qualified(toks: Token[], i: number): { name: QualifiedName; next: number } | null {
    if (!isName(toks[i])) return null;
    if (isPunct(toks[i + 1], '.') && isName(toks[i + 2])) {
      return { name: { schema: toks[i].text, name: toks[i + 2].text }, next: i + 3 };
    }
    return { name: { schema: 'public', name: toks[i].text }, next: i + 1 };
  }

  /** Reads `( a, b, ... )` at `i`. */
  private nameList(toks: Token[], i: number): { names: string[]; next: number } | null {
    if (!isPunct(toks[i], '(')) return null;
    const names: string[] = [];
    let j = i + 1;
    while (j < toks.length && !isPunct(toks[j], ')')) {
      if (isName(toks[j])) names.push(toks[j].text);
      else if (!isPunct(toks[j], ',')) return null;
      j++;
    }
    return j < toks.length ? { names, next: j + 1 } : null;
  }

  /** Splits `[from, to)` at commas of paren depth 0. */
  private splitTopLevel(toks: Token[], from: number, to: number): Array<[number, number]> {
    const parts: Array<[number, number]> = [];
    let depth = 0;
    let begin = from;
    for (let i = from; i < to; i++) {
      if (isPunct(toks[i], '(')) depth++;
      else if (isPunct(toks[i], ')')) depth--;
      else if (depth === 0 && isPunct(toks[i], ',')) {
        parts.push([begin, i]);
        begin = i + 1;
      }
    }
    if (begin < to) parts.push([begin, to]);
    return parts;
  }

  private matchingParen(toks: Token[], open: number): number {
    let depth = 0;
    for (let i = open; i < toks.length; i++) {
      if (isPunct(toks[i], '(')) depth++;
      else if (isPunct(toks[i], ')')) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return toks.length;
  }

  private createTable(stmt: Statement, start: number, consumed: Set<number>): void {
    const toks = stmt.toks;
    let i = start + 1;
    while (!isWord(toks[i], 'table')) i++;
    i++;
    let ifNotExists = false;
    if (isWord(toks[i], 'if') && isWord(toks[i + 1], 'not') && isWord(toks[i + 2], 'exists')) {
      ifNotExists = true;
      i += 3;
    }
    const q = this.qualified(toks, i);
    if (!q) return;
    const key = tableKey(q.name.schema, q.name.name);
    if (!isPunct(toks[q.next], '(')) return; // AS SELECT, PARTITION OF, OF type: no FK
    const close = this.matchingParen(toks, q.next);
    const elements = this.splitTopLevel(toks, q.next + 1, close);
    if (ifNotExists && this.tables.has(key)) {
      // Postgres does nothing (SA-5.4); the FK syntax inside is still claimed.
      for (let k = q.next; k < close; k++) consumed.add(k);
      return;
    }
    this.tables.add(key);
    const cols = this.columns.get(key) ?? new Set<string>();
    this.columns.set(key, cols);
    for (const [from, to] of elements) {
      const first = toks[from];
      if (isAnyWord(first, TABLE_CONSTRAINT_STARTS)) {
        this.tableConstraint(stmt, from, to, q.name, consumed);
      } else if (isName(first)) {
        cols.add(first.text);
        this.columnConstraint(stmt, from + 1, to, q.name, first.text, consumed);
      }
    }
  }

  /** `[CONSTRAINT n] FOREIGN KEY (cols) REFERENCES t [(cols)] ...` in [from, to). */
  private tableConstraint(stmt: Statement, from: number, to: number, child: QualifiedName, consumed: Set<number>): void {
    const toks = stmt.toks;
    let i = from;
    let name: string | null = null;
    if (isWord(toks[i], 'constraint') && isName(toks[i + 1])) {
      name = toks[i + 1].text;
      i += 2;
    }
    if (!(isWord(toks[i], 'foreign') && isWord(toks[i + 1], 'key'))) return;
    const fkAt = i;
    const cols = this.nameList(toks, i + 2);
    if (!cols || cols.next >= to || !isWord(toks[cols.next], 'references')) return;
    const refAt = cols.next;
    const target = this.references(toks, refAt);
    if (!target) return;
    consumed.add(fkAt);
    consumed.add(refAt);
    this.addForeignKey(child, cols.names, target.table, target.columns, name, stmt.ats[from]);
  }

  /** Inline `... [CONSTRAINT n] REFERENCES t [(cols)]` of column `column`, in [from, to). */
  private columnConstraint(stmt: Statement, from: number, to: number, child: QualifiedName, column: string, consumed: Set<number>): void {
    const toks = stmt.toks;
    let depth = 0;
    for (let i = from; i < to; i++) {
      if (isPunct(toks[i], '(')) depth++;
      else if (isPunct(toks[i], ')')) depth--;
      if (depth !== 0 || !isWord(toks[i], 'references')) continue;
      const target = this.references(toks, i);
      if (!target) continue;
      const name = isWord(toks[i - 2], 'constraint') && isName(toks[i - 1]) && i - 2 >= from ? toks[i - 1].text : null;
      consumed.add(i);
      this.addForeignKey(child, [column], target.table, target.columns, name, stmt.ats[i]);
    }
  }

  private references(toks: Token[], i: number): { table: QualifiedName; columns: string[] | null } | null {
    const q = this.qualified(toks, i + 1);
    if (!q) return null;
    const cols = this.nameList(toks, q.next);
    return { table: q.name, columns: cols ? cols.names : null };
  }

  private addForeignKey(
    child: QualifiedName,
    childColumns: readonly string[],
    parent: QualifiedName,
    parentColumns: readonly string[] | null,
    name: string | null,
    at: number,
    origin: 'static' | 'injected' = 'static',
  ): void {
    const key = tableKey(child.schema, child.name);
    const onTable = this.fks.get(key) ?? new Map<string, ForeignKey>();
    this.fks.set(key, onTable);
    const constraint = name ?? defaultForeignKeyName(child.name, childColumns, new Set(onTable.keys()));
    onTable.set(constraint, {
      file: this.file,
      line: origin === 'injected' ? 0 : this.lineOf(at),
      childSchema: child.schema,
      childTable: child.name,
      childColumns: [...childColumns],
      parentSchema: parent.schema,
      parentTable: parent.name,
      parentColumns: parentColumns === null ? null : [...parentColumns],
      constraint,
      origin,
    });
  }

  private alterTable(stmt: Statement, i: number, consumed: Set<number>): void {
    const toks = stmt.toks;
    if (isWord(toks[i], 'if') && isWord(toks[i + 1], 'exists')) i += 2;
    if (isWord(toks[i], 'only')) i++;
    const q = this.qualified(toks, i);
    if (!q) return;
    i = q.next;
    if (toks[i]?.kind === 'other' && toks[i].text === '*') i++;
    const child = q.name;
    const key = tableKey(child.schema, child.name);

    // SET SCHEMA moves the table, and so its FKs, out of the schema G-18 reviews
    // (SA code review 2: left unfollowed it read as a reviewed public child).
    if (isWord(toks[i], 'set') && isWord(toks[i + 1], 'schema') && isName(toks[i + 2])) {
      return this.moveTable(child, { schema: toks[i + 2].text, name: child.name });
    }
    if (isWord(toks[i], 'rename')) {
      if (isWord(toks[i + 1], 'to') && isName(toks[i + 2])) return this.moveTable(child, { schema: child.schema, name: toks[i + 2].text });
      if (isWord(toks[i + 1], 'constraint') && isName(toks[i + 2]) && isWord(toks[i + 3], 'to') && isName(toks[i + 4])) {
        this.renameConstraint(key, toks[i + 2].text, toks[i + 4].text);
        return;
      }
      const c = isWord(toks[i + 1], 'column') ? i + 2 : i + 1;
      if (isName(toks[c]) && isWord(toks[c + 1], 'to') && isName(toks[c + 2])) this.renameColumn(child, toks[c].text, toks[c + 2].text);
      return;
    }

    for (const [from, to] of this.splitTopLevel(toks, i, toks.length)) {
      if (isWord(toks[from], 'add')) {
        let j = from + 1;
        if (isAnyWord(toks[j], TABLE_CONSTRAINT_STARTS) && !isWord(toks[j], 'like')) {
          this.tableConstraint(stmt, j, to, child, consumed);
          continue;
        }
        if (isWord(toks[j], 'column')) j++;
        let ifNotExists = false;
        if (isWord(toks[j], 'if') && isWord(toks[j + 1], 'not') && isWord(toks[j + 2], 'exists')) {
          ifNotExists = true;
          j += 3;
        }
        if (!isName(toks[j])) continue;
        const column = toks[j].text;
        const cols = this.columns.get(key) ?? new Set<string>();
        this.columns.set(key, cols);
        if (ifNotExists && cols.has(column)) {
          // Postgres skips the whole column definition, FK included (SA-5.4).
          for (let k = j; k < to; k++) consumed.add(k);
          continue;
        }
        cols.add(column);
        this.columnConstraint(stmt, j + 1, to, child, column, consumed);
      } else if (isWord(toks[from], 'drop')) {
        let j = from + 1;
        const isConstraint = isWord(toks[j], 'constraint');
        if (isConstraint || isWord(toks[j], 'column')) j++;
        if (isWord(toks[j], 'if') && isWord(toks[j + 1], 'exists')) j += 2;
        if (!isName(toks[j])) continue;
        const cascade = isWord(toks[j + 1], 'cascade');
        if (isConstraint) this.fks.get(key)?.delete(toks[j].text);
        else this.dropColumn(child, toks[j].text, cascade);
      }
    }
  }

  private dropTable(toks: Token[], i: number): void {
    if (isWord(toks[i], 'if') && isWord(toks[i + 1], 'exists')) i += 2;
    const names: QualifiedName[] = [];
    while (i < toks.length) {
      const q = this.qualified(toks, i);
      if (!q) break;
      names.push(q.name);
      i = q.next;
      if (!isPunct(toks[i], ',')) break;
      i++;
    }
    for (const t of names) {
      const key = tableKey(t.schema, t.name);
      this.tables.delete(key);
      this.columns.delete(key);
      this.fks.delete(key);
      // Every FK pointing at it goes too: the drop needs CASCADE to succeed (SA-5.6).
      for (const onTable of this.fks.values()) {
        for (const [name, fk] of onTable) if (fk.parentSchema === t.schema && fk.parentTable === t.name) onTable.delete(name);
      }
    }
  }

  /** RENAME TO (same schema, new name) and SET SCHEMA (new schema, same name). Constraint names never change. */
  private moveTable(from: QualifiedName, to: QualifiedName): void {
    const oldKey = tableKey(from.schema, from.name);
    const newKey = tableKey(to.schema, to.name);
    if (oldKey === newKey) return;
    if (this.tables.delete(oldKey)) this.tables.add(newKey);
    const cols = this.columns.get(oldKey);
    if (cols) {
      this.columns.delete(oldKey);
      this.columns.set(newKey, cols);
    }
    const own = this.fks.get(oldKey);
    if (own) {
      this.fks.delete(oldKey);
      const moved = new Map<string, ForeignKey>();
      for (const [name, fk] of own) {
        // A self-reference moves at both ends.
        const self = fk.parentSchema === from.schema && fk.parentTable === from.name;
        moved.set(name, { ...fk, childSchema: to.schema, childTable: to.name, ...(self ? { parentSchema: to.schema, parentTable: to.name } : {}) });
      }
      this.fks.set(newKey, moved);
    }
    // FKs point at the table, not its name: they follow it.
    for (const onTable of this.fks.values()) {
      for (const [name, fk] of onTable) {
        if (fk.parentSchema === from.schema && fk.parentTable === from.name) {
          onTable.set(name, { ...fk, parentSchema: to.schema, parentTable: to.name });
        }
      }
    }
  }

  private renameConstraint(key: string, from: string, to: string): boolean {
    const onTable = this.fks.get(key);
    const fk = onTable?.get(from);
    if (!onTable || !fk) return false;
    onTable.delete(from);
    onTable.set(to, { ...fk, constraint: to });
    return true;
  }

  private renameColumn(table: QualifiedName, from: string, to: string): void {
    const key = tableKey(table.schema, table.name);
    const cols = this.columns.get(key);
    if (cols?.delete(from)) cols.add(to);
    const swap = (list: readonly string[]): string[] => list.map((c) => (c === from ? to : c));
    for (const onTable of this.fks.values()) {
      for (const [name, fk] of onTable) {
        const isChild = fk.childSchema === table.schema && fk.childTable === table.name;
        const isParent = fk.parentSchema === table.schema && fk.parentTable === table.name;
        if (!isChild && !isParent) continue;
        onTable.set(name, {
          ...fk,
          childColumns: isChild ? swap(fk.childColumns) : fk.childColumns,
          parentColumns: isParent && fk.parentColumns ? swap(fk.parentColumns) : fk.parentColumns,
        });
      }
    }
  }

  private dropColumn(table: QualifiedName, column: string, cascade: boolean): void {
    const key = tableKey(table.schema, table.name);
    this.columns.get(key)?.delete(column);
    const own = this.fks.get(key);
    if (own) for (const [name, fk] of own) if (fk.childColumns.includes(column)) own.delete(name);
    if (!cascade) return;
    for (const onTable of this.fks.values()) {
      for (const [name, fk] of onTable) {
        if (fk.parentSchema === table.schema && fk.parentTable === table.name && fk.parentColumns?.includes(column)) onTable.delete(name);
      }
    }
  }

  /** Applies one SA-4 adjustment for the current file. False: it matched nothing. */
  adjust(adjustment: ReplayAdjustment): boolean {
    if (adjustment.kind === 'inject') {
      const fk = adjustment.fk;
      this.addForeignKey(
        { schema: fk.childSchema ?? 'public', name: fk.childTable },
        fk.childColumns,
        { schema: fk.parentSchema ?? 'public', name: fk.parentTable },
        fk.parentColumns,
        fk.constraint,
        0,
        'injected',
      );
      return true;
    }
    const key = tableKey(adjustment.childSchema ?? 'public', adjustment.childTable);
    if (adjustment.kind === 'rename') return this.renameConstraint(key, adjustment.from, adjustment.to);
    return this.fks.get(key)?.delete(adjustment.constraint) ?? false;
  }

  result(): ForeignKey[] {
    const all: ForeignKey[] = [];
    for (const onTable of this.fks.values()) all.push(...onTable.values());
    return all.sort((a, b) =>
      compareFileNames(`${a.childSchema}.${a.childTable}\u0000${a.constraint}`, `${b.childSchema}.${b.childTable}\u0000${b.constraint}`),
    );
  }
}

/**
 * Replays every migration in filename order and returns the foreign keys that
 * stand after the last one. `adjustments` run right after their file's own
 * statements (SA-4); one that matches nothing is returned in `unmatched`.
 */
export function replayMigrations(files: readonly MigrationFile[], adjustments: readonly ReplayAdjustment[] = []): ReplayResult {
  const replay = new Replay();
  const sorted = [...files].sort((a, b) => compareFileNames(a.file, b.file));
  const known = new Set(sorted.map((f) => f.file));
  const unmatched: ReplayAdjustment[] = adjustments.filter((a) => !known.has(a.file));
  for (const { file, sql } of sorted) {
    replay.run(file, sql);
    for (const adjustment of adjustments) {
      if (adjustment.file === file && !replay.adjust(adjustment)) unmatched.push(adjustment);
    }
  }
  return { foreignKeys: replay.result(), problems: replay.problems, dynamic: replay.dynamic, unmatched };
}

/**
 * The repo-wide SECURITY DEFINER surface guard (SECDEF lockdown, slice 6).
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * On 2026-10-07 production had 75 SECURITY DEFINER functions in `public`, and
 * signed-out visitors could execute 68 of them. Two grants have to be closed
 * for every new function: the built-in EXECUTE grant to PUBLIC, and the
 * explicit anon/authenticated grants that Supabase default privileges add.
 * Most of the repo closed one of the two, or neither. Slices 1 to 5 close the
 * existing functions on prod; this guard stops the set growing back.
 *
 * ── The rule (requirement FR-6, SA C-5, workplan §2.3) ─────────────────────
 * For every function a file creates or alters as SECURITY DEFINER, THE SAME
 * FILE must hold:
 *   R-a  one `REVOKE EXECUTE|ALL ON FUNCTION <schema>.<name>` statement naming
 *        PUBLIC, anon and authenticated (schema-qualified; GRANT OPTION FOR
 *        does not count);
 *   R-b  that revoke AFTER the last CREATE of the function in the file (a
 *        re-CREATE after a DROP gets fresh default grants);
 *   R-c  `SET search_path` on the last CREATE, or an `ALTER FUNCTION ... SET
 *        search_path` after it;
 *   R-d  no later `GRANT EXECUTE|ALL` on it to PUBLIC or anon (authenticated
 *        and service_role stay allowed: slices 3 and 4a keep authenticated).
 * Fail closed on anything the parser cannot account for:
 *   F-1  SECURITY DEFINER in a statement that is not a recognised CREATE /
 *        ALTER FUNCTION (CREATE PROCEDURE, ALTER ROUTINE ...), and any
 *        `BEGIN ATOMIC` function or procedure body (its semicolons are not
 *        quoted, so the statement splitter cannot be trusted on that file);
 *   F-2  SECURITY DEFINER inside a dollar-quoted body or a single-quoted
 *        string (a DO block, `AS '...'`, or dynamic DDL), which the guard
 *        cannot check. Only `COMMENT ON` text is exempt (SA C-1);
 *   F-3  an unterminated string, quoted identifier, comment or dollar body.
 *
 * ── Ratchet (precedent: lib/admin/__tests__/admin-authz-surface.guard.test.ts)
 * The 70 (file, function) pairs that were non-compliant on 2026-10-08 are a
 * FROZEN BASELINE: asserted by equality with its cap, every entry must still
 * be a measured violation (a stale entry is a pre-signed exemption), and every
 * baselined file is dated on or before the freeze. New exceptions go on the
 * typed allow-list with an SA approval date (SQ-5). It is expected to stay
 * empty. F-findings are never baselined; an allow-listed finding carries an
 * exact count per (file, kind) (SA C-3).
 *
 * ── Known limits (stated, not glossed; workplan §2.2) ──────────────────────
 *   • `SECURITY` and `DEFINER` assembled by string concatenation are missed.
 *   • Functions are matched by NAME (SA: no overloads).
 *   • The search_path VALUE is not judged; slice 7 owns that.
 *   • The guard reads the repo, not prod. The slice checkers own prod.
 *
 * Pure fs + string scanning, no database, no network: milliseconds.
 *
 * @see docs/workplans/SECDEF_LOCKDOWN_SLICE6_WORKPLAN.md
 * @see docs/requirements/SECURITY_DEFINER_FUNCTIONS_LOCKDOWN_REQUIREMENT.md (FR-6)
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..');

/** FR-6: the three directories the rule governs. */
const SCAN_DIRS = ['supabase/migrations', 'supabase/SQL Scripts', 'supabase/held'] as const;

/**
 * O-1 tripwire: every `.sql` file in the repo OUTSIDE the three directories
 * (scripts/, supabase/seeds, supabase/tests, archive/, docs/, the root ...).
 * They must define no SECURITY DEFINER function and raise no finding; if one
 * ever does, this goes red and the scope question (Q-5) is reopened instead of
 * silently missed. Listed with `git ls-files` (tracked plus untracked, ignored
 * files excluded), the precedent of app/__tests__/tailwind-css-escape.guard.
 */

const SKIP_DIRS = new Set(['node_modules', '.git', '.next', '.claude']);

// ───────────────────────────────────────────────────────────────────────────
// Lexer
// ───────────────────────────────────────────────────────────────────────────

export interface Lexed {
  /**
   * Same length as the input, newlines kept. Comments, string contents and
   * dollar-body contents are spaces; quoted identifiers are kept except for
   * any `;` inside them (W-2). Every `;` left is a real statement end.
   */
  readonly scaffold: string;
  /** Same length; only comments are blanked (strings and bodies kept). */
  readonly commentFree: string;
  /** [start, end) of each dollar-quoted body's CONTENTS. */
  readonly dollarBodies: ReadonlyArray<readonly [number, number]>;
  /** [start, end) of each top-level single-quoted string's CONTENTS (C-1). */
  readonly stringSpans: ReadonlyArray<readonly [number, number]>;
  /** What was left open at end of input (F-3), with the line it opened on. */
  readonly unterminated: ReadonlyArray<{ readonly line: number; readonly detail: string }>;
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/;

export function lexSql(input: string): Lexed {
  const src = input;
  const n = src.length;
  const scaffold = src.split('');
  const commentFree = src.split('');
  const dollarBodies: Array<readonly [number, number]> = [];
  const stringSpans: Array<readonly [number, number]> = [];
  const unterminated: Array<{ line: number; detail: string }> = [];

  const blank = (arr: string[], from: number, to: number) => {
    for (let k = from; k < to; k++) if (arr[k] !== '\n') arr[k] = ' ';
  };
  const lineOf = (at: number) => src.slice(0, at).split('\n').length;

  let i = 0;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];

    // `-- line comment`
    if (c === '-' && next === '-') {
      let end = src.indexOf('\n', i);
      if (end < 0) end = n;
      blank(scaffold, i, end);
      blank(commentFree, i, end);
      i = end;
      continue;
    }

    // `/* block comment */`, nested as Postgres allows.
    if (c === '/' && next === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === '/' && src[j + 1] === '*') {
          depth++;
          j += 2;
        } else if (src[j] === '*' && src[j + 1] === '/') {
          depth--;
          j += 2;
        } else j++;
      }
      if (depth > 0) unterminated.push({ line: lineOf(i), detail: 'unterminated block comment' });
      blank(scaffold, i, j);
      blank(commentFree, i, j);
      i = j;
      continue;
    }

    // `'string'`. W-4: backslash escapes only for an E/e prefix that is its own
    // token. U&'', B'', X'' and N'' are plain '' strings.
    if (c === "'") {
      const prefix = src[i - 1];
      const beforePrefix = src[i - 2];
      const isEscapeString =
        (prefix === 'E' || prefix === 'e') && !(beforePrefix !== undefined && IDENT_CHAR.test(beforePrefix));
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (isEscapeString && src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) unterminated.push({ line: lineOf(i), detail: 'unterminated string' });
      stringSpans.push([i + 1, Math.min(j, n)]);
      blank(scaffold, i + 1, Math.min(j, n));
      i = closed ? j + 1 : n;
      continue;
    }

    // `"quoted identifier"`: kept, it is a name. W-2: blank any `;` in it.
    if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        if (src[j] === ';') scaffold[j] = ' ';
        j++;
      }
      if (!closed) unterminated.push({ line: lineOf(i), detail: 'unterminated quoted identifier' });
      i = closed ? j + 1 : n;
      continue;
    }

    // `$tag$ body $tag$`. Not an opener after an identifier character, so `$1`
    // and `a$b` are left alone.
    if (c === '$' && !(i > 0 && IDENT_CHAR.test(src[i - 1]))) {
      const m = DOLLAR_TAG.exec(src.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const bodyStart = i + tag.length;
        const close = src.indexOf(tag, bodyStart);
        const bodyEnd = close < 0 ? n : close;
        if (close < 0) unterminated.push({ line: lineOf(i), detail: `unterminated dollar body ${tag}` });
        dollarBodies.push([bodyStart, bodyEnd]);
        blank(scaffold, bodyStart, bodyEnd);
        i = close < 0 ? n : close + tag.length;
        continue;
      }
    }

    i++;
  }

  return { scaffold: scaffold.join(''), commentFree: commentFree.join(''), dollarBodies, stringSpans, unterminated };
}

// ───────────────────────────────────────────────────────────────────────────
// Names (W-1: one canonicalisation for schema, function and role names)
// ───────────────────────────────────────────────────────────────────────────

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`(${IDENT})(?:\s*\.\s*(${IDENT}))?`;

/** Quoted: quotes stripped, `""` unescaped, case kept. Bare: lower-cased. */
export function canonicalIdent(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s.slice(1, -1).replace(/""/g, '"');
  return s.toLowerCase();
}

interface QualifiedName {
  /** null when the source did not qualify the name. */
  readonly schema: string | null;
  readonly name: string;
}

function qualifiedFrom(first: string, second: string | undefined): QualifiedName {
  return second === undefined
    ? { schema: null, name: canonicalIdent(first) }
    : { schema: canonicalIdent(first), name: canonicalIdent(second) };
}

interface Role {
  readonly name: string;
  /**
   * SA C-2: Postgres compares the DEQUOTED name with "public" (gram.y
   * RoleSpec), so bare PUBLIC and quoted lower-case "public" are both the
   * pseudo-role. A quoted "PUBLIC" is an ordinary role name.
   */
  readonly isPublicPseudoRole: boolean;
}

function parseRoles(list: string): Role[] {
  return splitTopLevel(list).map((raw) => {
    const name = canonicalIdent(raw.replace(/^GROUP\s+/i, '').trim());
    return { name, isPublicPseudoRole: name === 'public' };
  });
}

/**
 * Split on commas outside parentheses and outside quoted identifiers
 * (argument lists contain commas; a quoted name may too, SA low 5).
 */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of s) {
    if (ch === '"') quoted = !quoted; // `""` toggles twice, so it stays inside
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (ch === ',' && depth === 0 && !quoted) {
      parts.push(current.trim());
      current = '';
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Index just past the `)` that matches the `(` at `open`, or -1. */
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === '(') depth++;
    else if (s[k] === ')') {
      depth--;
      if (depth === 0) return k + 1;
    }
  }
  return -1;
}

// ───────────────────────────────────────────────────────────────────────────
// Statements
// ───────────────────────────────────────────────────────────────────────────

interface Statement {
  /** Scaffold text with whitespace collapsed. */
  readonly text: string;
  readonly line: number;
  /** [start, end) in the source. */
  readonly start: number;
  readonly end: number;
}

function splitStatements(scaffold: string): Statement[] {
  const out: Statement[] = [];
  let start = 0;
  for (let k = 0; k <= scaffold.length; k++) {
    if (k === scaffold.length || scaffold[k] === ';') {
      const raw = scaffold.slice(start, k);
      const text = raw.replace(/\s+/g, ' ').trim();
      if (text) {
        const lead = raw.length - raw.trimStart().length;
        out.push({ text, line: scaffold.slice(0, start + lead).split('\n').length, start, end: k });
      }
      start = k + 1;
    }
  }
  return out;
}

const SECDEF_CLAUSE = /\bSECURITY\s+DEFINER\b/i;
/** W-5: `=`, `TO` or `FROM CURRENT`; the value is not judged. */
const SEARCH_PATH_PIN = /\bSET\s+search_path\s*(?:=|\bTO\b|\bFROM\s+CURRENT\b)/i;
/** SA low 4: these REMOVE a pin. `TO DEFAULT` is checked before SEARCH_PATH_PIN. */
const SEARCH_PATH_UNPIN = /\bRESET\s+(?:search_path|ALL)\b|\bSET\s+search_path\s*(?:=|\bTO\b)\s*DEFAULT\b/i;
type PinEffect = 'pin' | 'unpin' | null;
const pinEffectOf = (t: string): PinEffect => (SEARCH_PATH_UNPIN.test(t) ? 'unpin' : SEARCH_PATH_PIN.test(t) ? 'pin' : null);
const CREATE_ROUTINE = new RegExp(String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(FUNCTION|PROCEDURE)\s+${QNAME}\s*\(`, 'i');
const CREATE_ROUTINE_LOOSE = /^CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\b/i;
const ALTER_FUNCTION = new RegExp(String.raw`^ALTER\s+FUNCTION\s+${QNAME}`, 'i');
const PRIVILEGE = String.raw`(?:EXECUTE|ALL(?:\s+PRIVILEGES)?)`;
/** SA C-2a: FUNCTION, ROUTINE and PROCEDURE all name the same pg_proc row. */
const ROUTINE_KIND = String.raw`(?:FUNCTION|ROUTINE|PROCEDURE)`;
const GRANT_TAIL = String.raw`(?:\s+WITH\s+GRANT\s+OPTION)?(?:\s+GRANTED\s+BY\s+.+?)?`;
const REVOKE_FUNCTION = new RegExp(
  String.raw`^REVOKE\s+(GRANT\s+OPTION\s+FOR\s+)?${PRIVILEGE}\s+ON\s+${ROUTINE_KIND}\s+(.+?)\s+FROM\s+(.+?)(?:\s+GRANTED\s+BY\s+.+?)?(?:\s+(?:CASCADE|RESTRICT))?$`,
  'i',
);
const GRANT_FUNCTION = new RegExp(
  String.raw`^GRANT\s+${PRIVILEGE}\s+ON\s+${ROUTINE_KIND}\s+(.+?)\s+TO\s+(.+?)${GRANT_TAIL}$`,
  'i',
);
/** SA C-2c/d: a schema LIST, and GRANTED BY. */
const GRANT_ALL_IN_SCHEMA = new RegExp(
  String.raw`^GRANT\s+${PRIVILEGE}\s+ON\s+ALL\s+(?:FUNCTIONS|ROUTINES|PROCEDURES)\s+IN\s+SCHEMA\s+(.+?)\s+TO\s+(.+?)${GRANT_TAIL}$`,
  'i',
);
/** SA C-2 backstop: any GRANT on a routine that matches neither form above is F-1. */
const GRANT_ON_ROUTINE_ANY = /^GRANT\b.*\bON\s+(?:ALL\s+)?(?:FUNCTIONS?|ROUTINES?|PROCEDURES?)\b/i;

function parseTargets(list: string): QualifiedName[] {
  const re = new RegExp('^' + QNAME);
  return splitTopLevel(list)
    .map((sig) => re.exec(sig.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => qualifiedFrom(m[1], m[2]));
}

// ───────────────────────────────────────────────────────────────────────────
// Analysis of one file
// ───────────────────────────────────────────────────────────────────────────

export type Rule = 'R-a' | 'R-b' | 'R-c' | 'R-d';

export interface Pair {
  /** `<schema>.<name>`, canonical; an unqualified CREATE is `public`. */
  readonly fn: string;
  readonly schema: string;
  readonly name: string;
  readonly line: number;
  readonly failed: ReadonlyArray<Rule>;
  /** For R-d: the lines of the GRANTs that gave EXECUTE back. */
  readonly reopenedAt: ReadonlyArray<number>;
  /** Argument types of the last CREATE, for the ready-to-paste fix (O-3). */
  readonly argTypes: string | null;
}

export interface Finding {
  readonly kind: 'F-1' | 'F-2' | 'F-3';
  readonly line: number;
  readonly detail: string;
  /** F-2 raised by a single-quoted string (C-1), as opposed to a dollar body. */
  readonly inString?: boolean;
}

export interface FileAnalysis {
  readonly pairs: ReadonlyArray<Pair>;
  readonly findings: ReadonlyArray<Finding>;
}

/** Words that start a multi-word type, so `double precision` is not `<name> <type>`. */
const TYPE_START_WORDS = new Set(['double', 'character', 'char', 'timestamp', 'time', 'bit', 'interval', 'national']);

/**
 * Best-effort identity argument types from a CREATE's argument list: modes,
 * parameter names and defaults removed, OUT arguments dropped. The hint says
 * to check it against the prod signature, because it is a heuristic.
 */
export function identityArgTypes(argList: string): string {
  return splitTopLevel(argList)
    .map((arg) => arg.replace(/\s+DEFAULT\s+[\s\S]*$/i, '').replace(/\s*=\s*[\s\S]*$/, '').trim())
    .filter((arg) => arg && !/^OUT\b/i.test(arg))
    .map((arg) => arg.replace(/^(?:IN|INOUT)\s+/i, ''))
    .map((arg) => {
      const variadic = /^VARIADIC\s+/i.test(arg);
      const rest = arg.replace(/^VARIADIC\s+/i, '');
      const tokens = rest.split(/\s+/);
      const first = tokens[0].toLowerCase();
      const typeText = tokens.length > 1 && !TYPE_START_WORDS.has(first) ? tokens.slice(1).join(' ') : rest;
      return (variadic ? 'VARIADIC ' : '') + typeText;
    })
    .join(', ');
}

const sameFunction = (target: QualifiedName, schema: string, name: string, requireQualified: boolean) =>
  target.name === name && (target.schema === null ? !requireQualified && schema === 'public' : target.schema === schema);

export function analyseSql(input: string): FileAnalysis {
  const src = input.replace(/\r\n/g, '\n');
  const lexed = lexSql(src);
  const statements = splitStatements(lexed.scaffold);
  const findings: Finding[] = lexed.unterminated.map((u) => ({ kind: 'F-3' as const, line: u.line, detail: u.detail }));

  // F-2: SECURITY DEFINER anywhere inside a dollar body (comments in it ignored).
  for (const [from, to] of lexed.dollarBodies) {
    const body = lexSql(src.slice(from, to)).commentFree;
    if (SECDEF_CLAUSE.test(body)) {
      findings.push({
        kind: 'F-2',
        line: src.slice(0, from).split('\n').length,
        detail: 'SECURITY DEFINER inside a dollar-quoted body (DO block or dynamic DDL) cannot be checked',
      });
    }
  }

  // F-2 (SA C-1): SECURITY DEFINER inside a top-level single-quoted string, as
  // in `DO '...'` or `AS '...'`. Only `COMMENT ON` text is exempt.
  for (const [from, to] of lexed.stringSpans) {
    if (!SECDEF_CLAUSE.test(src.slice(from, to).replace(/''/g, "'"))) continue;
    const owner = statements.find((st) => from >= st.start && from < st.end);
    if (owner && /^COMMENT\s+ON\b/i.test(owner.text)) continue;
    findings.push({
      kind: 'F-2',
      line: src.slice(0, from).split('\n').length,
      detail: 'SECURITY DEFINER inside a single-quoted string (DO block, AS body or dynamic DDL) cannot be checked',
      inString: true,
    });
  }

  interface Create { idx: number; schema: string; name: string; secdef: boolean; pinned: boolean; argTypes: string; line: number }
  interface Alter { idx: number; schema: string; name: string; secdef: boolean; pin: PinEffect; line: number }
  interface Revoke { idx: number; grantOptionOnly: boolean; targets: QualifiedName[]; roles: Role[] }
  interface Grant { idx: number; line: number; targets: QualifiedName[] | 'all'; schemasForAll: string[]; roles: Role[] }

  const creates: Create[] = [];
  const alters: Alter[] = [];
  const revokes: Revoke[] = [];
  const grants: Grant[] = [];

  statements.forEach((st, idx) => {
    const t = st.text;
    const hasSecdef = SECDEF_CLAUSE.test(t);
    let m: RegExpExecArray | null;

    if (CREATE_ROUTINE_LOOSE.test(t) && /\bBEGIN\s+ATOMIC\b/i.test(t)) {
      findings.push({ kind: 'F-1', line: st.line, detail: 'BEGIN ATOMIC body: its semicolons are unquoted, so this file cannot be split safely' });
      return;
    }

    if ((m = CREATE_ROUTINE.exec(t))) {
      if (m[1].toUpperCase() === 'PROCEDURE') {
        if (hasSecdef) findings.push({ kind: 'F-1', line: st.line, detail: 'SECURITY DEFINER on a PROCEDURE' });
        return;
      }
      const q = qualifiedFrom(m[2], m[3]);
      const open = m.index + m[0].length - 1;
      const close = matchParen(t, open);
      creates.push({
        idx,
        schema: q.schema ?? 'public',
        name: q.name,
        secdef: hasSecdef,
        pinned: pinEffectOf(t) === 'pin',
        argTypes: close > 0 ? identityArgTypes(t.slice(open + 1, close - 1)) : '',
        line: st.line,
      });
      return;
    }

    if ((m = ALTER_FUNCTION.exec(t))) {
      const q = qualifiedFrom(m[1], m[2]);
      alters.push({ idx, schema: q.schema ?? 'public', name: q.name, secdef: hasSecdef, pin: pinEffectOf(t), line: st.line });
      return;
    }

    if (hasSecdef) {
      findings.push({ kind: 'F-1', line: st.line, detail: `SECURITY DEFINER in an unrecognised statement: ${t.slice(0, 60)}` });
      return;
    }

    if ((m = REVOKE_FUNCTION.exec(t))) {
      revokes.push({ idx, grantOptionOnly: Boolean(m[1]), targets: parseTargets(m[2]), roles: parseRoles(m[3]) });
      return;
    }
    if ((m = GRANT_ALL_IN_SCHEMA.exec(t))) {
      grants.push({ idx, line: st.line, targets: 'all', schemasForAll: splitTopLevel(m[1]).map(canonicalIdent), roles: parseRoles(m[2]) });
      return;
    }
    if ((m = GRANT_FUNCTION.exec(t))) {
      grants.push({ idx, line: st.line, targets: parseTargets(m[1]), schemasForAll: [], roles: parseRoles(m[2]) });
      return;
    }
    if (GRANT_ON_ROUTINE_ANY.test(t)) {
      findings.push({ kind: 'F-1', line: st.line, detail: `GRANT on a routine in a shape the guard cannot read: ${t.slice(0, 60)}` });
    }
  });

  // Every function this file defines as SECURITY DEFINER, by canonical name.
  const defined = new Map<string, { schema: string; name: string; line: number }>();
  for (const d of [...creates, ...alters]) {
    if (!d.secdef) continue;
    const key = `${d.schema}.${d.name}`;
    if (!defined.has(key)) defined.set(key, { schema: d.schema, name: d.name, line: d.line });
  }

  const closesAllClientRoles = (r: Revoke) =>
    r.roles.some((x) => x.isPublicPseudoRole) &&
    r.roles.some((x) => x.name === 'anon') &&
    r.roles.some((x) => x.name === 'authenticated');

  const pairs: Pair[] = [...defined.entries()].map(([key, { schema, name, line }]) => {
    const ownCreates = creates.filter((c) => c.schema === schema && c.name === name);
    const lastCreate = ownCreates.length ? ownCreates[ownCreates.length - 1] : null;
    const lastCreateIdx = lastCreate ? lastCreate.idx : -1;

    const shaped = revokes.filter(
      (r) => !r.grantOptionOnly && closesAllClientRoles(r) && r.targets.some((tg) => sameFunction(tg, schema, name, true)),
    );
    const effective = shaped.filter((r) => r.idx > lastCreateIdx);
    const lastRevokeIdx = effective.length ? effective[effective.length - 1].idx : null;

    const failed: Rule[] = [];
    if (lastRevokeIdx === null) failed.push(shaped.length ? 'R-b' : 'R-a');

    // SA low 4: the LAST pin-affecting ALTER after the last CREATE decides;
    // with none, the CREATE's own clause does.
    const laterPinEffects = alters
      .filter((a) => a.schema === schema && a.name === name && a.pin !== null && a.idx > lastCreateIdx)
      .map((a) => a.pin);
    const pinned = laterPinEffects.length
      ? laterPinEffects[laterPinEffects.length - 1] === 'pin'
      : lastCreate !== null && lastCreate.pinned;
    if (!pinned) failed.push('R-c');

    const reopenedAt =
      lastRevokeIdx === null
        ? []
        : grants
            .filter(
              (g) =>
                g.idx > lastRevokeIdx &&
                (g.targets === 'all'
                  ? g.schemasForAll.includes(schema)
                  : g.targets.some((tg) => sameFunction(tg, schema, name, false))) &&
                g.roles.some((x) => x.isPublicPseudoRole || x.name === 'anon'),
            )
            .map((g) => g.line);
    if (reopenedAt.length) failed.push('R-d');

    return { fn: key, schema, name, line, failed, reopenedAt, argTypes: lastCreate ? lastCreate.argTypes : null };
  });

  return { pairs, findings };
}

// ───────────────────────────────────────────────────────────────────────────
// Messages (O-3: every failure carries the ready-to-paste fix)
// ───────────────────────────────────────────────────────────────────────────

const RULE_TEXT: Record<Rule, string> = {
  'R-a': 'no single REVOKE EXECUTE ON FUNCTION <schema>.<name> FROM PUBLIC, anon, authenticated in this file',
  'R-b': 'a later CREATE follows the REVOKE: move the REVOKE after the last CREATE of the function',
  'R-c': 'no SET search_path on the CREATE and no ALTER FUNCTION ... SET search_path after it',
  'R-d': 'a later GRANT gives EXECUTE back to PUBLIC or anon: remove that GRANT',
};

/** Re-quote a canonical name unless it reads the same bare (QA edge case 1). */
export function quoteIdent(name: string): string {
  return /^[a-z_][a-z0-9_$]*$/.test(name) ? name : `"${name.replace(/"/g, '""')}"`;
}

export function describeViolation(file: string, pair: Pair): string {
  const sig = `${quoteIdent(pair.schema)}.${quoteIdent(pair.name)}(${pair.argTypes ?? '<identity args>'})`;
  const lines = [`${file}:${pair.line} ${pair.fn} fails ${pair.failed.join(', ')}`];
  for (const r of pair.failed) lines.push(`  ${r}: ${RULE_TEXT[r]}`);
  if (pair.reopenedAt.length) lines.push(`  remove the GRANT to PUBLIC/anon on line(s) ${pair.reopenedAt.join(', ')}`);
  if (pair.failed.some((r) => r === 'R-a' || r === 'R-b')) {
    lines.push(`  paste: REVOKE EXECUTE ON FUNCTION ${sig} FROM PUBLIC, anon, authenticated;`);
    lines.push(`  paste: GRANT EXECUTE ON FUNCTION ${sig} TO service_role;`);
  }
  if (pair.failed.includes('R-c')) {
    lines.push(`  paste: ALTER FUNCTION ${sig} SET search_path = public, pg_temp;`);
    lines.push('  (read the body first: the path must resolve every unqualified name it uses)');
  }
  lines.push('  (argument types are a best guess from the CREATE: check them against the prod signature)');
  return lines.join('\n');
}

// ───────────────────────────────────────────────────────────────────────────
// Baseline and allow-list
// ───────────────────────────────────────────────────────────────────────────

interface BaselineEntry {
  /** Repo-relative, `/` separators. */
  readonly file: string;
  /** `<schema>.<name>`. */
  readonly fn: string;
}

/**
 * FROZEN 2026-10-08 at origin/main 06b77d1b (workplan Appendix A).
 *
 * Every entry is a non-compliant (file, function) pair that existed when the
 * guard landed. It does NOT shrink as slices 2 to 5 land: those revoke in new
 * files, and the rule is same-file (C-5). Prod progress is measured by the
 * slice checkers. An entry leaves only when its file is deleted, moved, or
 * edited into compliance, and then the cap below drops in the same commit.
 *
 * NEVER add an entry. A new exception goes on SECDEF_ALLOW_LIST with an SA date.
 */
const SECDEF_BASELINE: ReadonlyArray<BaselineEntry> = [
  { file: 'supabase/SQL Scripts/20251030_create_audit_log_function.sql', fn: 'public.insert_audit_log' },
  { file: 'supabase/SQL Scripts/20251117000003_add_execution_quotas.sql', fn: 'public.increment_executions_used' },
  { file: 'supabase/SQL Scripts/20251117_complete_quota_system.sql', fn: 'public.increment_executions_used' },
  { file: 'supabase/SQL Scripts/20251117_complete_quota_system.sql', fn: 'public.update_user_storage_used' },
  { file: 'supabase/SQL Scripts/20260129_add_advisory_lock_functions.sql', fn: 'public.pg_advisory_unlock' },
  { file: 'supabase/SQL Scripts/20260129_add_advisory_lock_functions.sql', fn: 'public.pg_try_advisory_lock' },
  { file: 'supabase/SQL Scripts/20260601_fix_execution_insights_schema.sql', fn: 'public.get_top_insights' },
  { file: 'supabase/held/20260916b_purge_business_data.sql', fn: 'public.purge_business_data' },
  { file: 'supabase/migrations/2026-08-14_payment_automation_executions_claim.sql', fn: 'public.claim_due_payment_automation_executions' },
  { file: 'supabase/migrations/2026-08-14_payment_automation_executions_claim.sql', fn: 'public.reap_stale_payment_automation_executions' },
  { file: 'supabase/migrations/2026-08-14_payment_reminders_claim.sql', fn: 'public.claim_due_payment_reminders' },
  { file: 'supabase/migrations/2026-08-14_payment_reminders_claim.sql', fn: 'public.reap_stale_payment_reminders' },
  { file: 'supabase/migrations/20260615_add_organizations.sql', fn: 'public.auto_set_agent_org_id' },
  { file: 'supabase/migrations/20260615_add_organizations.sql', fn: 'public.get_or_create_user_organization' },
  { file: 'supabase/migrations/20260629_enhance_behavior_rules.sql', fn: 'public.auto_disable_ineffective_behavior_rules' },
  { file: 'supabase/migrations/20260629_enhance_behavior_rules.sql', fn: 'public.match_behavior_rules' },
  { file: 'supabase/migrations/20260629_enhance_behavior_rules.sql', fn: 'public.record_behavior_rule_result' },
  { file: 'supabase/migrations/20260629_error_patterns_table.sql', fn: 'public.record_auto_fix_result' },
  { file: 'supabase/migrations/20260629_error_patterns_table.sql', fn: 'public.upsert_error_pattern' },
  { file: 'supabase/migrations/20260629_execution_optimization_tables.sql', fn: 'public.check_execution_anomaly' },
  { file: 'supabase/migrations/20260629_execution_optimization_tables.sql', fn: 'public.record_execution_anomaly' },
  { file: 'supabase/migrations/20260629_execution_optimization_tables.sql', fn: 'public.update_execution_baseline' },
  { file: 'supabase/migrations/20260629_intent_examples_table.sql', fn: 'public.find_similar_intent_examples' },
  { file: 'supabase/migrations/20260629_intent_examples_table.sql', fn: 'public.record_intent_example_usage' },
  { file: 'supabase/migrations/20260629_intent_examples_table.sql', fn: 'public.upsert_intent_example' },
  { file: 'supabase/migrations/20260629_platform_learning_tables.sql', fn: 'public.get_active_failures' },
  { file: 'supabase/migrations/20260629_platform_learning_tables.sql', fn: 'public.get_similar_patterns' },
  { file: 'supabase/migrations/20260629_platform_learning_tables.sql', fn: 'public.record_global_failure' },
  { file: 'supabase/migrations/20260629_platform_learning_tables.sql', fn: 'public.upsert_workflow_pattern' },
  { file: 'supabase/migrations/20260629_plugin_performance_table.sql', fn: 'public.upsert_plugin_performance' },
  { file: 'supabase/migrations/20260722_create_contact_documents.sql', fn: 'public.log_document_activity' },
  { file: 'supabase/migrations/20260722_crm_contact_creation_activity.sql', fn: 'public.log_crm_contact_created' },
  { file: 'supabase/migrations/20260723_enhance_payments.sql', fn: 'public.update_overdue_installments' },
  { file: 'supabase/migrations/20260726_enhance_website_tables.sql', fn: 'public.check_subdomain_available' },
  { file: 'supabase/migrations/20260726_enhance_website_tables.sql', fn: 'public.generate_subdomain' },
  { file: 'supabase/migrations/20260802_add_dismissed_setup_steps_to_business_profiles.sql', fn: 'public.dismiss_setup_step' },
  { file: 'supabase/migrations/20260824_add_conversion_layer.sql', fn: 'public.increment_smart_link_click_count' },
  { file: 'supabase/migrations/20260826_business_chat_plan_cache.sql', fn: 'public.record_business_chat_plan_outcome' },
  { file: 'supabase/migrations/20260826_business_chat_plan_cache.sql', fn: 'public.search_business_chat_plans_semantic' },
  { file: 'supabase/migrations/20260911_daily_briefing.sql', fn: 'public.claim_due_daily_briefings' },
  { file: 'supabase/migrations/20260911_daily_briefing.sql', fn: 'public.reap_stale_daily_briefings' },
  { file: 'supabase/migrations/20260914_lead_responses.sql', fn: 'public.claim_due_lead_responses' },
  { file: 'supabase/migrations/20260914_lead_responses.sql', fn: 'public.reap_stale_lead_responses' },
  { file: 'supabase/migrations/20260915a_purge_schema_introspect.sql', fn: 'public.purge_schema_introspect' },
  { file: 'supabase/migrations/20260917_insight_actions.sql', fn: 'public.claim_due_insight_actions' },
  { file: 'supabase/migrations/20260917_insight_actions.sql', fn: 'public.reap_stale_insight_actions' },
  { file: 'supabase/migrations/20260918_promote_client_on_confirmed_booking.sql', fn: 'public.promote_contact_on_confirmed_booking' },
  { file: 'supabase/migrations/20260920_pipeline_transitions.sql', fn: 'public.advance_contact_on_completed_booking' },
  { file: 'supabase/migrations/20260920_pipeline_transitions.sql', fn: 'public.advance_contact_stage' },
  { file: 'supabase/migrations/20260920_pipeline_transitions.sql', fn: 'public.promote_contact_on_payment' },
  { file: 'supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql', fn: 'public.is_platform_admin' },
  { file: 'supabase/migrations/20260922_verified_questions.sql', fn: 'public.increment_verified_question_uses' },
  { file: 'supabase/migrations/20260922_verified_questions.sql', fn: 'public.match_verified_questions' },
  { file: 'supabase/migrations/20260930_marketing_consent.sql', fn: 'public.marketing_consent_project' },
  { file: 'supabase/migrations/20260931_business_subscribers.sql', fn: 'public.link_subscriber_to_contact' },
  { file: 'supabase/migrations/20261003_codify_create_user_settings_trigger.sql', fn: 'public.create_user_settings' },
  { file: 'supabase/migrations/20261005_auth_handoff_codes.sql', fn: 'public.claim_auth_handoff_code' },
  { file: 'supabase/migrations/20261006_business_event_triggers.sql', fn: 'public.record_business_event' },
  { file: 'supabase/migrations/20261006_business_event_triggers.sql', fn: 'public.tg_booking_events' },
  { file: 'supabase/migrations/20261006_business_event_triggers.sql', fn: 'public.tg_invoice_events' },
  { file: 'supabase/migrations/20261006_business_event_triggers.sql', fn: 'public.tg_proposal_events' },
  { file: 'supabase/migrations/20261006_business_event_triggers.sql', fn: 'public.tg_transaction_events' },
  { file: 'supabase/migrations/20261006c_close_remaining_event_gaps.sql', fn: 'public.tg_activity_reply_events' },
  { file: 'supabase/migrations/20261006c_close_remaining_event_gaps.sql', fn: 'public.tg_booking_events' },
  { file: 'supabase/migrations/20261006c_close_remaining_event_gaps.sql', fn: 'public.tg_contact_events' },
  { file: 'supabase/migrations/20261006c_close_remaining_event_gaps.sql', fn: 'public.tg_invoice_events' },
  { file: 'supabase/migrations/20261006c_close_remaining_event_gaps.sql', fn: 'public.tg_page_view_events' },
  { file: 'supabase/migrations/20261006c_close_remaining_event_gaps.sql', fn: 'public.tg_proposal_events' },
  { file: 'supabase/migrations/20261006c_close_remaining_event_gaps.sql', fn: 'public.tg_service_events' },
  // Closed IN EFFECT (SA Q-2): PUBLIC, anon and authenticated are revoked in
  // three separate statements. The rule wants one statement, so it stays here.
  { file: 'supabase/migrations/20261013_business_os_invite_existing_account.sql', fn: 'public.business_os_auth_email_has_account' },
];

/** Equality, not `<=`: a slack cap is room nobody signed for. May only go down. */
const SECDEF_BASELINE_CAP = 70;

/**
 * Every baselined file must be dated on or before this (the last migration
 * number on main when the baseline froze). The date is the first 8 digits of
 * the base name after removing `-`, so `2026-08-14_x.sql` reads 20260814; a
 * baselined file with no such date fails (O-2). The author chooses the file
 * name, so this is a speed bump, not the control: the equality cap plus
 * review is (workplan K-3).
 */
const SECDEF_BASELINE_FROZEN_THROUGH = '20261044';

type FindingKind = Finding['kind'];

interface AllowListBase {
  /** Repo-relative, `/` separators. */
  readonly file: string;
  readonly reason: string;
  /** YYYY-MM-DD; the sign-off is recorded in the requirement's SA Review (SQ-5). */
  readonly saApprovedOn: string;
}
/** Allows one non-compliant (file, function) pair. */
interface PairAllowance extends AllowListBase {
  /** `<schema>.<name>`. */
  readonly fn: string;
}
/**
 * Allows EXACTLY `count` findings of one kind in one file (SA C-3). More is a
 * new finding, fewer is a stale entry: both fail. Line numbers are not used,
 * because harmless edits move them.
 */
interface FindingAllowance extends AllowListBase {
  readonly finding: FindingKind;
  readonly count: number;
}
type AllowListEntry = PairAllowance | FindingAllowance;

const isFindingAllowance = (e: AllowListEntry): e is FindingAllowance => 'finding' in e;

/** Expected to stay EMPTY (SQ-5). Every entry needs an SA approval date. */
const SECDEF_ALLOW_LIST: ReadonlyArray<AllowListEntry> = [];
const SECDEF_ALLOW_LIST_CAP = 0;
const PAIR_ALLOWANCES = SECDEF_ALLOW_LIST.filter((e): e is PairAllowance => !isFindingAllowance(e));
const FINDING_ALLOWANCES = SECDEF_ALLOW_LIST.filter(isFindingAllowance);

const RATCHET_HINT =
  'RATCHET: if a baselined pair became compliant or its file was removed, delete its entry AND lower ' +
  'SECDEF_BASELINE_CAP by the same number in the same commit. Never add to the baseline: a new exception ' +
  'goes on SECDEF_ALLOW_LIST with an SA approval date (requirement SQ-5). See ' +
  'docs/workplans/SECDEF_LOCKDOWN_SLICE6_WORKPLAN.md.';

export function freezeDateOf(file: string): string | null {
  const m = /^(\d{8})/.exec(path.posix.basename(file).replace(/-/g, ''));
  return m ? m[1] : null;
}

export interface RatchetResult {
  readonly unlisted: ReadonlyArray<string>;
  readonly stale: ReadonlyArray<string>;
  readonly inBoth: ReadonlyArray<string>;
}

/** Pure: compare the measured violations with the two lists. */
export function evaluateRatchet(
  measured: ReadonlyArray<{ file: string; fn: string }>,
  baseline: ReadonlyArray<{ file: string; fn: string }>,
  allowList: ReadonlyArray<{ file: string; fn: string }>,
): RatchetResult {
  const key = (e: { file: string; fn: string }) => `${e.file} :: ${e.fn}`;
  const measuredKeys = new Set(measured.map(key));
  const baselineKeys = new Set(baseline.map(key));
  const allowKeys = new Set(allowList.map(key));
  return {
    unlisted: [...measuredKeys].filter((k) => !baselineKeys.has(k) && !allowKeys.has(k)).sort(),
    stale: [...baselineKeys, ...allowKeys].filter((k) => !measuredKeys.has(k)).sort(),
    inBoth: [...baselineKeys].filter((k) => allowKeys.has(k)).sort(),
  };
}

/**
 * Pure (SA C-3): every (file, kind) with findings needs an allowance whose
 * count equals the measured count, and every allowance must match exactly.
 */
export function evaluateFindingAllowances(
  measured: ReadonlyArray<{ file: string; kind: FindingKind }>,
  allowances: ReadonlyArray<{ file: string; finding: FindingKind; count: number }>,
): string[] {
  const counts = new Map<string, number>();
  for (const m of measured) counts.set(`${m.file} :: ${m.kind}`, (counts.get(`${m.file} :: ${m.kind}`) ?? 0) + 1);
  const allowed = new Map<string, number>(allowances.map((a) => [`${a.file} :: ${a.finding}`, a.count]));
  const problems: string[] = [];
  for (const [key, n] of counts) {
    const ok = allowed.get(key);
    if (ok === undefined) problems.push(`${key}: ${n} finding(s), none allowed`);
    else if (ok !== n) problems.push(`${key}: ${n} finding(s), allow-list says ${ok}`);
  }
  for (const [key, ok] of allowed) if (!counts.has(key)) problems.push(`${key}: allow-list says ${ok}, 0 found (stale)`);
  return problems.sort();
}

// ───────────────────────────────────────────────────────────────────────────
// The scan
// ───────────────────────────────────────────────────────────────────────────

function listSqlFiles(relDir: string): string[] {
  const abs = path.join(REPO_ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop() as string;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
      } else if (e.name.toLowerCase().endsWith('.sql')) {
        out.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
      }
    }
  }
  return out.sort();
}

interface ScannedFile {
  readonly file: string;
  readonly analysis: FileAnalysis;
}

const analyseFile = (file: string): ScannedFile => ({
  file,
  analysis: analyseSql(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8')),
});

function scan(dirs: ReadonlyArray<string>): ScannedFile[] {
  return dirs.flatMap((d) => listSqlFiles(d).map(analyseFile));
}

/** True when the file's first statement makes the session read-only. */
export function isReadOnlyScript(input: string): boolean {
  const [first] = splitStatements(lexSql(input.replace(/\r\n/g, '\n')).scaffold);
  return first !== undefined && /^SET\s+default_transaction_read_only\s*(?:=|TO)\s*on$/i.test(first.text);
}

/** O-1: every tracked or untracked (not ignored) .sql file outside SCAN_DIRS. */
function tripwireFiles(): string[] {
  // No fallback on purpose: if git is unavailable the tripwire must fail, not
  // pass having scanned nothing.
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.sql'], {
    cwd: REPO_ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  const inScope = (f: string) => SCAN_DIRS.some((d) => f.startsWith(`${d}/`));
  return [...new Set(out.toString('utf8').split('\0').filter(Boolean))]
    .filter((f) => !inScope(f) && !f.startsWith('.claude/') && fs.existsSync(path.join(REPO_ROOT, f)))
    .sort();
}

const readRepoFile = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// ───────────────────────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────────────────────

describe('SECURITY DEFINER surface guard (SECDEF lockdown slice 6)', () => {
  const scanned = scan(SCAN_DIRS);
  const violations = scanned.flatMap(({ file, analysis }) =>
    analysis.pairs.filter((p) => p.failed.length > 0).map((pair) => ({ file, fn: pair.fn, pair })),
  );
  const measuredFindings = scanned.flatMap(({ file, analysis }) =>
    analysis.findings.map((f) => ({ file, kind: f.kind, line: f.line, detail: f.detail })),
  );

  describe('the repository', () => {
    it('adds no SECURITY DEFINER function without its REVOKE and search_path (R-a to R-d)', () => {
      const ratchet = evaluateRatchet(violations, SECDEF_BASELINE, PAIR_ALLOWANCES);
      const unlisted = new Set(ratchet.unlisted);
      const messages = violations
        .filter((v) => unlisted.has(`${v.file} :: ${v.fn}`))
        .map((v) => describeViolation(v.file, v.pair));
      expect(messages).toEqual([]);
    });

    it('has no F-finding beyond the exact allow-listed counts (unrecognised SECURITY DEFINER, dynamic DDL, BEGIN ATOMIC, unterminated text)', () => {
      const problems = evaluateFindingAllowances(measuredFindings, FINDING_ALLOWANCES);
      const detail = measuredFindings.map((f) => `${f.file}:${f.line} ${f.kind} ${f.detail}`);
      expect({ problems, detail: problems.length ? detail : [] }).toEqual({ problems: [], detail: [] });
    });
  });

  describe('the ratchet: the baseline may only shrink', () => {
    it('never baselines an F-finding', () => {
      expect(SECDEF_BASELINE.filter((e) => /^F-\d$/.test(e.fn))).toEqual([]);
      expect(PAIR_ALLOWANCES.filter((e) => /^F-\d$/.test(e.fn))).toEqual([]);
    });

    it('lists no stale entry (a compliant or vanished pair must be deleted)', () => {
      const { stale } = evaluateRatchet(violations, SECDEF_BASELINE, PAIR_ALLOWANCES);
      expect({ stale, ratchet: stale.length ? RATCHET_HINT : '' }).toEqual({ stale: [], ratchet: '' });
    });

    it('caps both lists by equality', () => {
      expect({ baseline: SECDEF_BASELINE.length, allowList: SECDEF_ALLOW_LIST.length, ratchet: RATCHET_HINT }).toEqual({
        baseline: SECDEF_BASELINE_CAP,
        allowList: SECDEF_ALLOW_LIST_CAP,
        ratchet: RATCHET_HINT,
      });
    });

    it('has no duplicate entry', () => {
      const keys = SECDEF_BASELINE.map((e) => `${e.file} :: ${e.fn}`);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it(`baselines only files dated on or before ${SECDEF_BASELINE_FROZEN_THROUGH} (frozen)`, () => {
      const late = SECDEF_BASELINE.filter((e) => {
        const date = freezeDateOf(e.file);
        return date === null || date > SECDEF_BASELINE_FROZEN_THROUGH;
      }).map((e) => `${e.file} (${freezeDateOf(e.file) ?? 'no date'})`);
      expect(late).toEqual([]);
    });

    it('keeps the allow-list well-formed and disjoint from the baseline', () => {
      for (const e of SECDEF_ALLOW_LIST) {
        expect(e.saApprovedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(e.reason.trim().length).toBeGreaterThanOrEqual(20);
      }
      for (const e of FINDING_ALLOWANCES) expect(Number.isInteger(e.count) && e.count > 0).toBe(true);
      expect(evaluateRatchet([], SECDEF_BASELINE, PAIR_ALLOWANCES).inBoth).toEqual([]);
    });
  });

  describe('anti-vacuity: the scan really ran', () => {
    const floors: Record<(typeof SCAN_DIRS)[number], number> = {
      'supabase/migrations': 200,
      'supabase/SQL Scripts': 80,
      'supabase/held': 1,
    };

    it.each(SCAN_DIRS.map((d) => [d]))('reads at least the floor of .sql files in %s', (dir) => {
      expect(listSqlFiles(dir).length).toBeGreaterThanOrEqual(floors[dir as (typeof SCAN_DIRS)[number]]);
    });

    it('finds at least the 77 SECURITY DEFINER pairs in 43 files measured on 2026-10-08', () => {
      const pairs = scanned.flatMap((s) => s.analysis.pairs);
      const files = scanned.filter((s) => s.analysis.pairs.length > 0);
      expect(pairs.length).toBeGreaterThanOrEqual(77);
      expect(files.length).toBeGreaterThanOrEqual(43);
    });
  });

  describe('O-1 tripwire: SQL outside the three directories defines no SECURITY DEFINER function', () => {
    it('finds 0 pairs and 0 findings in every other .sql file in the repo', () => {
      const files = tripwireFiles();
      // A broken listing must not look like a clean tree: scripts/ alone holds dozens.
      expect(files.length).toBeGreaterThan(20);
      const hits = files.map(analyseFile).flatMap(({ file, analysis }) => {
        // Read-only checkers (first statement `SET default_transaction_read_only
        // = on`) print report labels such as 'security definer ' || prosecdef.
        // Their session cannot run DDL, so a string mention there is a label,
        // not a definition. The exemption is tripwire-only: SCAN_DIRS get none.
        const readOnly = isReadOnlyScript(fs.readFileSync(path.join(REPO_ROOT, file), 'utf8'));
        return [
          ...analysis.pairs.map((p) => `${file}:${p.line} defines ${p.fn}: bring this directory into SCAN_DIRS (Q-5)`),
          ...analysis.findings
            .filter((f) => !(readOnly && f.inString))
            .map((f) => `${file}:${f.line} ${f.kind} ${f.detail}`),
        ];
      });
      expect(hits).toEqual([]);
    });
  });

  describe('real files', () => {
    it('slice 1 (20261044) defines nothing and finds nothing', () => {
      const a = analyseSql(readRepoFile('supabase/migrations/20261044_secdef_lockdown_slice1_drains_locks.sql'));
      expect(a).toEqual({ pairs: [], findings: [] });
    });

    it.each([
      ['supabase/migrations/20261041_operator_test_account_cleanup.sql'],
      ['supabase/migrations/20261042_operator_test_account_cleanup_billing_events.sql'],
      ['supabase/migrations/20261043_operator_test_account_cleanup_insight_links.sql'],
    ])('%s passes: one compliant pair, no finding', (file) => {
      const a = analyseSql(readRepoFile(file));
      expect(a.findings).toEqual([]);
      expect(a.pairs.map((p) => ({ fn: p.fn, failed: p.failed }))).toEqual([
        { fn: 'public.operator_test_account_cleanup', failed: [] },
      ]);
    });

    it('20260922_verified_questions fails R-a for both functions when not baselined', () => {
      const file = 'supabase/migrations/20260922_verified_questions.sql';
      const a = analyseSql(readRepoFile(file));
      expect(a.pairs.map((p) => [p.fn, p.failed]).sort()).toEqual([
        ['public.increment_verified_question_uses', ['R-a']],
        ['public.match_verified_questions', ['R-a']],
      ]);
      const withoutIt = SECDEF_BASELINE.filter((e) => e.file !== file);
      const measured = a.pairs.map((p) => ({ file, fn: p.fn }));
      expect(evaluateRatchet(measured, withoutIt, []).unlisted).toEqual([
        `${file} :: public.increment_verified_question_uses`,
        `${file} :: public.match_verified_questions`,
      ]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Fixtures (inline strings, never .sql files, so the scan never sees them)
  // ─────────────────────────────────────────────────────────────────────────

  const CREATE_F = [
    'CREATE OR REPLACE FUNCTION public.f(p_user uuid)',
    'RETURNS integer',
    'LANGUAGE plpgsql',
    'SECURITY DEFINER',
    'SET search_path = public',
    'AS $$ BEGIN RETURN 1; END; $$;',
  ].join('\n');
  const REVOKE_ALL3 = 'REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM PUBLIC, anon, authenticated;';
  const GRANT_SR = 'GRANT EXECUTE ON FUNCTION public.f(uuid) TO service_role;';

  const verdict = (sql: string) => analyseSql(sql).pairs.map((p) => ({ fn: p.fn, failed: [...p.failed] }));
  const findingKinds = (sql: string) => analyseSql(sql).findings.map((f) => f.kind);

  describe('rule fixtures', () => {
    it('S-1 compliant: CREATE with search_path, then REVOKE from all three, then GRANT to service_role', () => {
      expect(verdict([CREATE_F, REVOKE_ALL3, GRANT_SR].join('\n'))).toEqual([{ fn: 'public.f', failed: [] }]);
    });

    it.each([
      ['S-2 missing PUBLIC', 'anon, authenticated'],
      ['S-3 missing anon', 'PUBLIC, authenticated'],
      ['S-4 missing authenticated', 'PUBLIC, anon'],
    ])('%s fails R-a', (_label, roles) => {
      const sql = [CREATE_F, `REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM ${roles};`].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-a'] }]);
    });

    it('S-5 missing search_path fails R-c', () => {
      const sql = [CREATE_F.replace('SET search_path = public\n', ''), REVOKE_ALL3].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-c'] }]);
    });

    it('S-6 a pin by ALTER FUNCTION ... SET search_path after the CREATE is accepted', () => {
      const sql = [CREATE_F.replace('SET search_path = public\n', ''), 'ALTER FUNCTION public.f(uuid) SET search_path = public, pg_temp;', REVOKE_ALL3].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: [] }]);
    });

    it('S-7 an unqualified REVOKE name fails R-a', () => {
      const sql = [CREATE_F, 'REVOKE EXECUTE ON FUNCTION f(uuid) FROM PUBLIC, anon, authenticated;'].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-a'] }]);
    });

    it('S-8 a REVOKE in a different file does not count', () => {
      expect(verdict(CREATE_F)).toEqual([{ fn: 'public.f', failed: ['R-a'] }]);
      expect(verdict(REVOKE_ALL3)).toEqual([]);
    });

    it('S-9 REVOKE GRANT OPTION FOR leaves EXECUTE in place, so it fails R-a', () => {
      const sql = [CREATE_F, 'REVOKE GRANT OPTION FOR EXECUTE ON FUNCTION public.f(uuid) FROM PUBLIC, anon, authenticated;'].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-a'] }]);
    });

    it('S-10 a REVOKE before DROP and re-CREATE fails R-b', () => {
      const sql = [CREATE_F, REVOKE_ALL3, 'DROP FUNCTION public.f(uuid);', CREATE_F].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-b'] }]);
    });

    it.each([
      ['TO anon', ['R-d']],
      ['TO PUBLIC', ['R-d']],
      ['TO authenticated', []],
      ['TO service_role', []],
    ])('S-11 a later GRANT %s', (to, failed) => {
      const sql = [CREATE_F, REVOKE_ALL3, `GRANT EXECUTE ON FUNCTION public.f(uuid) ${to};`].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed }]);
    });

    it('S-11b GRANT ON ALL FUNCTIONS IN SCHEMA public TO anon after the revoke fails R-d', () => {
      const sql = [CREATE_F, REVOKE_ALL3, 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;'].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-d'] }]);
    });

    it('S-12 / W-1 case, line breaks, quoting and REVOKE ALL PRIVILEGES all canonicalise', () => {
      const quotedCreate = [
        'create   or replace\nfunction\n"public" . "f" (\n  p_user uuid\n)\nreturns int language sql',
        'security\n  definer\nset search_path\n= public as $$ select 1 $$;',
      ].join('\n');
      const bareRevoke = 'revoke all privileges on function\npublic.f(uuid)\nfrom public,\nanon , authenticated;';
      expect(verdict([quotedCreate, bareRevoke].join('\n'))).toEqual([{ fn: 'public.f', failed: [] }]);

      const quotedRevoke = 'REVOKE EXECUTE ON FUNCTION "public"."f"(uuid) FROM PUBLIC, "anon", "authenticated";';
      expect(verdict([CREATE_F, quotedRevoke].join('\n'))).toEqual([{ fn: 'public.f', failed: [] }]);

      // A quoted name keeps its case, so "F" is not f.
      const otherCase = 'REVOKE EXECUTE ON FUNCTION public."F"(uuid) FROM PUBLIC, anon, authenticated;';
      expect(verdict([CREATE_F, otherCase].join('\n'))).toEqual([{ fn: 'public.f', failed: ['R-a'] }]);

      // Quoted "PUBLIC" is a role name, not the pseudo-role.
      const quotedPublic = 'REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM "PUBLIC", anon, authenticated;';
      expect(verdict([CREATE_F, quotedPublic].join('\n'))).toEqual([{ fn: 'public.f', failed: ['R-a'] }]);
    });

    it('S-13 a REVOKE in a line comment, a nested block comment or a string is not code', () => {
      const asLine = `-- ${REVOKE_ALL3}`;
      const asNested = `/* outer /* inner */ ${REVOKE_ALL3} */`;
      const asString = `SELECT '${REVOKE_ALL3.replace(/;$/, '')}';`;
      for (const hidden of [asLine, asNested, asString]) {
        expect(verdict([CREATE_F, hidden].join('\n'))).toEqual([{ fn: 'public.f', failed: ['R-a'] }]);
      }
    });

    it('S-14 body text with ; and $$ and fake clauses stays inside the body', () => {
      const sql = [
        'CREATE FUNCTION public.g() RETURNS text LANGUAGE plpgsql SET search_path = public AS $body$',
        'BEGIN',
        "  RAISE NOTICE 'a; b $$ c';",
        '  -- REVOKE EXECUTE ON FUNCTION public.g() FROM PUBLIC, anon, authenticated;',
        "  RETURN 'SECURITY DEFINER';",
        'END;',
        '$body$;',
      ].join('\n');
      expect(verdict(sql)).toEqual([]);
      expect(findingKinds(sql)).toEqual(['F-2']);
    });

    it('S-15 SECURITY DEFINER built inside a DO block is F-2', () => {
      const sql = "DO $$ BEGIN EXECUTE 'CREATE FUNCTION public.h() RETURNS int LANGUAGE sql SECURITY DEFINER AS ''select 1'''; END $$;";
      expect(verdict(sql)).toEqual([]);
      expect(findingKinds(sql)).toEqual(['F-2']);
    });

    it('S-15b a comment inside a body that says SECURITY DEFINER is not a finding', () => {
      const sql = [CREATE_F.replace('BEGIN RETURN 1;', 'BEGIN /* runs as SECURITY DEFINER */ RETURN 1;'), REVOKE_ALL3].join('\n');
      expect(findingKinds(sql)).toEqual([]);
    });

    it('S-16 CREATE PROCEDURE ... SECURITY DEFINER is F-1', () => {
      const sql = 'CREATE PROCEDURE public.p() LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN NULL; END $$;';
      expect(findingKinds(sql)).toEqual(['F-1']);
      expect(verdict(sql)).toEqual([]);
    });

    it('S-16b ALTER ROUTINE ... SECURITY DEFINER is F-1', () => {
      expect(findingKinds('ALTER ROUTINE public.f(uuid) SECURITY DEFINER;')).toEqual(['F-1']);
    });

    it('S-17 / W-4 string prefixes: E escapes, U&, B, X and N are plain, and an identifier ending in e is not a prefix', () => {
      const prefixes = [
        "SELECT E'it\\'s; still a string';",
        "SELECT e'a\\\\';",
        "SELECT U&'d\\0061t;a';",
        "SELECT B'1010', X'1F', N'x;y';",
        "SELECT some_name'x';",
      ].join('\n');
      const sql = [prefixes, CREATE_F, REVOKE_ALL3].join('\n');
      expect(findingKinds(sql)).toEqual([]);
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: [] }]);
    });

    it('S-17b an unterminated dollar body is F-3', () => {
      expect(findingKinds('CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ select 1;')).toContain('F-3');
    });

    it('S-18 ALTER FUNCTION ... SECURITY DEFINER alone is a pair failing R-a and R-c', () => {
      expect(verdict('ALTER FUNCTION public.f(uuid) SECURITY DEFINER;')).toEqual([{ fn: 'public.f', failed: ['R-a', 'R-c'] }]);
    });

    it('S-19 one REVOKE naming two functions covers both', () => {
      const sql = [
        'CREATE FUNCTION public.a(p int) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ select 1 $$;',
        'CREATE FUNCTION public.b(p text, q int) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ select 1 $$;',
        'REVOKE EXECUTE ON FUNCTION public.a(int), public.b(text, int) FROM PUBLIC, anon, authenticated;',
      ].join('\n');
      expect(verdict(sql)).toEqual([
        { fn: 'public.a', failed: [] },
        { fn: 'public.b', failed: [] },
      ]);
    });

    it('S-20 SECURITY DEFINER in COMMENT ON text is ignored', () => {
      const sql = [CREATE_F, REVOKE_ALL3, "COMMENT ON FUNCTION public.f(uuid) IS 'SECURITY DEFINER because of RLS';"].join('\n');
      expect(findingKinds(sql)).toEqual([]);
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: [] }]);
    });

    it('W-2 a ; inside a quoted identifier does not split the statement', () => {
      const sql = [
        'CREATE FUNCTION public."odd;name"(p uuid) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ select 1 $$;',
        'REVOKE EXECUTE ON FUNCTION public."odd;name"(uuid) FROM PUBLIC, anon, authenticated;',
      ].join('\n');
      expect(findingKinds(sql)).toEqual([]);
      expect(verdict(sql)).toHaveLength(1);
      expect(verdict(sql)[0].failed).toEqual([]);
    });

    it('W-3 a BEGIN ATOMIC body is F-1, with or without SECURITY DEFINER', () => {
      const atomic = 'CREATE FUNCTION public.k() RETURNS int LANGUAGE sql SECURITY DEFINER BEGIN ATOMIC SELECT 1; SELECT 2; END;';
      expect(findingKinds(atomic)).toContain('F-1');
      expect(findingKinds('CREATE OR REPLACE PROCEDURE public.k() BEGIN ATOMIC SELECT 1; END;')).toContain('F-1');
    });

    it('W-5 clauses after the body, EXTERNAL SECURITY DEFINER and SET search_path FROM CURRENT all count', () => {
      const trailing = [
        'CREATE FUNCTION public.f(p_user uuid) RETURNS int AS $$ select 1 $$',
        'LANGUAGE sql',
        'EXTERNAL SECURITY DEFINER',
        'SET search_path FROM CURRENT;',
        REVOKE_ALL3,
      ].join('\n');
      expect(verdict(trailing)).toEqual([{ fn: 'public.f', failed: [] }]);

      const toForm = CREATE_F.replace('SET search_path = public', 'SET search_path TO public, pg_temp');
      expect(verdict([toForm, REVOKE_ALL3].join('\n'))).toEqual([{ fn: 'public.f', failed: [] }]);
    });

    it('W-5 a later ALTER ... SECURITY INVOKER keeps the pair (fail closed)', () => {
      const sql = [CREATE_F, 'ALTER FUNCTION public.f(uuid) SECURITY INVOKER;'].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-a'] }]);
    });

    it('Q-6 a function in another schema needs a REVOKE qualified with that schema', () => {
      const create = 'CREATE FUNCTION private.f(p uuid) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = private AS $$ select 1 $$;';
      expect(verdict([create, REVOKE_ALL3].join('\n'))).toEqual([{ fn: 'private.f', failed: ['R-a'] }]);
      expect(verdict([create, 'REVOKE ALL ON FUNCTION private.f(uuid) FROM PUBLIC, anon, authenticated;'].join('\n'))).toEqual([
        { fn: 'private.f', failed: [] },
      ]);
    });

    it('an unqualified CREATE is public', () => {
      const sql = [CREATE_F.replace('public.f', 'f'), REVOKE_ALL3].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: [] }]);
    });
  });

  describe('SA code-review fixes (C-1 to C-3, lows 4 to 7, QA edge cases)', () => {
    it('C-1a SECURITY DEFINER built inside a single-quoted DO body is F-2', () => {
      const sql =
        "DO 'BEGIN EXECUTE ''CREATE FUNCTION public.h() RETURNS int LANGUAGE sql SECURITY DEFINER AS $x$ select 1 $x$''; END';";
      expect(verdict(sql)).toEqual([]);
      expect(findingKinds(sql)).toEqual(['F-2']);
    });

    it('C-1b SECURITY DEFINER inside a single-quoted AS body is F-2', () => {
      const sql = [
        'CREATE FUNCTION public.mk() RETURNS void LANGUAGE plpgsql',
        "AS 'BEGIN EXECUTE ''CREATE FUNCTION public.h() RETURNS int LANGUAGE sql SECURITY DEFINER AS $x$ select 1 $x$''; END';",
      ].join('\n');
      expect(verdict(sql)).toEqual([]);
      expect(analyseSql(sql).findings).toEqual([expect.objectContaining({ kind: 'F-2', line: 2 })]);
    });

    it('C-1 tripwire exemption is for read-only scripts only', () => {
      const label = "SELECT 'security definer ' || 1;";
      expect(isReadOnlyScript(`SET default_transaction_read_only = on;\n${label}`)).toBe(true);
      expect(isReadOnlyScript(label)).toBe(false);
      expect(analyseSql(label).findings).toEqual([expect.objectContaining({ kind: 'F-2', inString: true })]);
    });

    it('C-1c COMMENT ON text stays exempt, including a multi-line COMMENT', () => {
      const sql = [CREATE_F, REVOKE_ALL3, "COMMENT ON FUNCTION public.f(uuid)\nIS 'runs as SECURITY DEFINER; see the workplan';"].join('\n');
      expect(findingKinds(sql)).toEqual([]);
    });

    it.each([
      ['ROUTINE', 'anon'],
      ['PROCEDURE', 'PUBLIC'],
    ])('C-2a a later GRANT EXECUTE ON %s ... TO %s fails R-d', (kind, role) => {
      const sql = [CREATE_F, REVOKE_ALL3, `GRANT EXECUTE ON ${kind} public.f(uuid) TO ${role};`].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-d'] }]);
    });

    it('C-2a a REVOKE ON ROUTINE counts for R-a', () => {
      const sql = [CREATE_F, 'REVOKE EXECUTE ON ROUTINE public.f(uuid) FROM PUBLIC, anon, authenticated;'].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: [] }]);
    });

    it('C-2b quoted lower-case "public" is the PUBLIC pseudo-role; quoted "PUBLIC" is not', () => {
      const grantBack = [CREATE_F, REVOKE_ALL3, 'GRANT EXECUTE ON FUNCTION public.f(uuid) TO "public";'].join('\n');
      expect(verdict(grantBack)).toEqual([{ fn: 'public.f', failed: ['R-d'] }]);
      const revokeQuoted = [CREATE_F, 'REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM "public", anon, authenticated;'].join('\n');
      expect(verdict(revokeQuoted)).toEqual([{ fn: 'public.f', failed: [] }]);
      const upper = [CREATE_F, REVOKE_ALL3, 'GRANT EXECUTE ON FUNCTION public.f(uuid) TO "PUBLIC";'].join('\n');
      expect(verdict(upper)).toEqual([{ fn: 'public.f', failed: [] }]);
    });

    it('C-2c ON ALL FUNCTIONS IN SCHEMA with a schema list', () => {
      const hit = [CREATE_F, REVOKE_ALL3, 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions, public TO anon;'].join('\n');
      expect(verdict(hit)).toEqual([{ fn: 'public.f', failed: ['R-d'] }]);
      const miss = [CREATE_F, REVOKE_ALL3, 'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA extensions, other TO anon;'].join('\n');
      expect(verdict(miss)).toEqual([{ fn: 'public.f', failed: [] }]);
    });

    it('C-2d ON ALL ROUTINES IN SCHEMA ... GRANTED BY still fails R-d', () => {
      const sql = [CREATE_F, REVOKE_ALL3, 'GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon GRANTED BY postgres;'].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-d'] }]);
    });

    it('C-2 backstop: a GRANT on a routine in an unreadable shape is F-1', () => {
      expect(findingKinds('GRANT USAGE, EXECUTE ON FUNCTION public.f(uuid) TO anon;')).toEqual(['F-1']);
      expect(findingKinds('GRANT EXECUTE ON FUNCTIONS public.f(uuid) TO anon;')).toEqual(['F-1']);
      // Grants on other objects are not the guard's business.
      expect(findingKinds('GRANT SELECT ON TABLE public.t TO anon;')).toEqual([]);
    });

    describe('C-3 finding allowances need an exact count', () => {
      const file = 'supabase/migrations/29991231_x.sql';
      const two = [
        { file, kind: 'F-2' as const },
        { file, kind: 'F-2' as const },
      ];
      const allow = (count: number) => [{ file, finding: 'F-2' as const, count }];

      it('passes when the measured count equals the allowance', () => {
        expect(evaluateFindingAllowances(two, allow(2))).toEqual([]);
      });
      it('fails on a finding with no allowance', () => {
        expect(evaluateFindingAllowances(two, [])).toEqual([`${file} :: F-2: 2 finding(s), none allowed`]);
      });
      it('fails on more findings than allowed (a new finding)', () => {
        expect(evaluateFindingAllowances(two, allow(1))).toEqual([`${file} :: F-2: 2 finding(s), allow-list says 1`]);
      });
      it('fails on fewer findings than allowed (stale)', () => {
        expect(evaluateFindingAllowances(two.slice(1), allow(2))).toEqual([`${file} :: F-2: 1 finding(s), allow-list says 2`]);
        expect(evaluateFindingAllowances([], allow(2))).toEqual([`${file} :: F-2: allow-list says 2, 0 found (stale)`]);
      });
    });

    it.each([
      ['ALTER FUNCTION public.f(uuid) RESET search_path;'],
      ['ALTER FUNCTION public.f(uuid) RESET ALL;'],
      ['ALTER FUNCTION public.f(uuid) SET search_path TO DEFAULT;'],
      ['ALTER FUNCTION public.f(uuid) SET search_path = DEFAULT;'],
    ])('low 4: %s after the CREATE removes the pin (R-c)', (unpin) => {
      expect(verdict([CREATE_F, unpin, REVOKE_ALL3].join('\n'))).toEqual([{ fn: 'public.f', failed: ['R-c'] }]);
    });

    it('low 4: the last pin-affecting statement decides', () => {
      const sql = [CREATE_F, 'ALTER FUNCTION public.f(uuid) RESET search_path;', 'ALTER FUNCTION public.f(uuid) SET search_path = public;', REVOKE_ALL3].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: [] }]);
    });

    it('low 5: a comma inside a quoted role name does not split the grantee list', () => {
      const sql = [CREATE_F, 'REVOKE EXECUTE ON FUNCTION public.f(uuid) FROM anon, authenticated, "x, PUBLIC, y";'].join('\n');
      expect(verdict(sql)).toEqual([{ fn: 'public.f', failed: ['R-a'] }]);
    });

    it('low 6: an F-3 finding carries the line it opened on', () => {
      const sql = 'SELECT 1;\nCREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ select 1;';
      expect(analyseSql(sql).findings).toEqual([expect.objectContaining({ kind: 'F-3', line: 2 })]);
    });

    it('low 7: the R-b message says to move the REVOKE after the last CREATE', () => {
      const [pair] = analyseSql([CREATE_F, REVOKE_ALL3, CREATE_F].join('\n')).pairs;
      expect(pair.failed).toEqual(['R-b']);
      expect(describeViolation('x.sql', pair)).toContain('move the REVOKE after the last CREATE');
    });

    it('QA 1: paste lines re-quote a name that is not lower-case', () => {
      const sql = 'CREATE FUNCTION public."MyFn"(p uuid) RETURNS int LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$ select 1 $$;';
      const [pair] = analyseSql(sql).pairs;
      expect(pair.fn).toBe('public.MyFn');
      expect(describeViolation('x.sql', pair)).toContain('REVOKE EXECUTE ON FUNCTION public."MyFn"(uuid) FROM PUBLIC, anon, authenticated;');
      expect(quoteIdent('my_fn')).toBe('my_fn');
      expect(quoteIdent('a"b')).toBe('"a""b"');
    });

    it('QA 2: an R-d message tells the author to remove the GRANT, with its line', () => {
      const sql = [CREATE_F, REVOKE_ALL3, 'GRANT EXECUTE ON FUNCTION public.f(uuid) TO anon;'].join('\n');
      const [pair] = analyseSql(sql).pairs;
      const message = describeViolation('x.sql', pair);
      expect(message).toContain('remove that GRANT');
      expect(message).toContain(`line(s) ${pair.reopenedAt[0]}`);
      expect(pair.reopenedAt).toEqual([8]);
      expect(message).not.toContain('paste: REVOKE');
    });
  });

  describe('lexer', () => {
    it('S-21 keeps length and line count, and blanks comments, strings and bodies', () => {
      const src = "a -- c\n/* x\ny */ 'str;ing' $t$ body; $t$ \"q;d\" b;";
      const { scaffold } = lexSql(src);
      expect(scaffold.length).toBe(src.length);
      expect(scaffold.split('\n').length).toBe(src.split('\n').length);
      expect(scaffold).not.toMatch(/str|body|-- c|x/);
      expect(scaffold).toContain('"q d"');
      expect((scaffold.match(/;/g) ?? []).length).toBe(1);
    });

    it('does not open a dollar body at $1 or inside an identifier', () => {
      const { scaffold, dollarBodies } = lexSql('SELECT $1, a$b$c FROM t;');
      expect(dollarBodies).toEqual([]);
      expect(scaffold).toBe('SELECT $1, a$b$c FROM t;');
    });
  });

  describe('messages (O-3)', () => {
    it('prints a ready-to-paste REVOKE and ALTER with the identity argument types', () => {
      const sql = 'CREATE FUNCTION public.f(p_user uuid, p_limit integer DEFAULT 10, OUT o text, p_at timestamp with time zone = now()) RETURNS text LANGUAGE sql SECURITY DEFINER AS $$ select 1 $$;';
      const [pair] = analyseSql(sql).pairs;
      const message = describeViolation('supabase/migrations/x.sql', pair);
      expect(message).toContain('REVOKE EXECUTE ON FUNCTION public.f(uuid, integer, timestamp with time zone) FROM PUBLIC, anon, authenticated;');
      expect(message).toContain('ALTER FUNCTION public.f(uuid, integer, timestamp with time zone) SET search_path = public, pg_temp;');
      expect(message).toContain('R-a');
      expect(message).toContain('R-c');
    });

    it('identityArgTypes keeps multi-word types and VARIADIC', () => {
      expect(identityArgTypes('double precision, character varying, VARIADIC p_ids uuid[]')).toBe(
        'double precision, character varying, VARIADIC uuid[]',
      );
    });
  });

  describe('ratchet logic (pure)', () => {
    const v = { file: 'supabase/migrations/29991231_x.sql', fn: 'public.x' };
    const old = { file: 'supabase/migrations/20260101_y.sql', fn: 'public.y' };

    it('a new violation is unlisted', () => {
      expect(evaluateRatchet([v, old], [old], []).unlisted).toEqual([`${v.file} :: ${v.fn}`]);
    });

    it('an allow-listed violation is not unlisted', () => {
      expect(evaluateRatchet([v], [], [v]).unlisted).toEqual([]);
    });

    it('a baselined pair that is no longer measured is stale', () => {
      expect(evaluateRatchet([], [old], []).stale).toEqual([`${old.file} :: ${old.fn}`]);
    });

    it('reads the freeze date from the first 8 digits, dashes removed, and fails closed without one', () => {
      expect(freezeDateOf('supabase/migrations/2026-08-14_payment_reminders_claim.sql')).toBe('20260814');
      expect(freezeDateOf('supabase/migrations/20260915a_purge_schema_introspect.sql')).toBe('20260915');
      expect(freezeDateOf('supabase/SQL Scripts/20251117000003_add_execution_quotas.sql')).toBe('20251117');
      expect(freezeDateOf('supabase/SQL Scripts/create_audit_trail.sql')).toBeNull();
    });
  });
});

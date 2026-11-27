/**
 * Primitives shared by the repo's source-scanning guards.
 *
 * ── Why `blankStringLiterals` lives here and not in a test file ────────────
 * It was defined inside `lib/admin/__tests__/admin-authz-surface.guard.test.ts`
 * and used there by rule R1 (D-Q1: a `requireAdmin(` occurring only inside a
 * string literal is not a gate) and by `stripComments`.
 *
 * `tests/helpers/admin-page-guard.ts` needs exactly the same primitive for
 * exactly the same reason — SA defeated the page-guard assertion twice with
 * decoys inside a **template literal**: first a component signature (round 4),
 * then the canonical import statement (round 5). Both are D-Q1 one file over.
 * Importing the one implementation is the whole point: a second copy of "what
 * counts as a string" is how the two rules drift apart.
 *
 * Its unit tests stay in the surface guard, next to the rules that depend on it.
 *
 * ── The OTHER normaliser, and why it is not folded in here ────────────────
 * `flattened()` in `tests/helpers/bos-llm-literal-rules.ts` also normalises
 * source before a scan, and the two look adjacent enough that someone will
 * eventually try to merge them. They are OPPOSITE operations:
 *
 *   `blankStringLiterals` ERASES string content, so a scan for a CODE SHAPE
 *   cannot be fooled by a decoy inside a literal (D-Q1).
 *   `flattened`           JOINS `'…' + '…'` and collapses whitespace, so a
 *   scan for a PHRASE can see a literal the author wrapped (CR-1).
 *
 * Run `flattened` first and the phrase scans below match nothing; run
 * `blankStringLiterals` first and the phrase rules lose the exact text they
 * exist to find. And they cannot share an implementation even in principle:
 * this one preserves LENGTH by contract (callers slice the original text by
 * offsets computed on the scaffold — see `literalSpanAt` and the "preserves
 * offsets" unit test), while `flattened` deletes characters on purpose.
 *
 * So: two normalisers, one each, by design. A third would be the drift.
 */

/** Characters that open a string. */
const QUOTES = new Set(["'", '"', '`']);

/**
 * Blank the CONTENTS of string and template literals, preserving length and
 * newlines.
 *
 * Length preservation is the CONTRACT every caller relies on: offsets are
 * computed on the blanked scaffold and then sliced out of the ORIGINAL text.
 * That is what lets a caller ask "is there a real import statement here?" on the
 * scaffold and then read the module specifier from the real source.
 *
 * ── Why this is a scanner and not a regex ──────────────────────────────────
 * The previous implementation was one alternation:
 *
 *     /`(?:\\[\s\S]|[^`\\])*`|'(?:\\[^\n]|[^'\\\n])*'|"(?:\\[^\n]|[^"\\\n])*"/g
 *
 * Its template branch stops at the FIRST inner backtick, so a **nested**
 * template literal mis-pairs the delimiters: the scaffold then treats real code
 * as string, or string as real code, depending where the pairing lands. SA
 * verified that this alone defeats a naive scaffold fix — `guarded: true` with
 * the guard a no-op — so the nesting is not a theoretical nicety, it is the
 * second half of the same exploit.
 *
 * A scanner also gets interpolation right, which matters for polarity:
 * everything inside `${ … }` is REAL CODE and is deliberately left visible,
 * while the literal text around it is blanked. Nested strings and templates
 * inside an interpolation are handled by the same loop, at any depth.
 *
 * Quote rules follow JavaScript: only a template literal may span newlines. An
 * unterminated `'` or `"` therefore ends at the newline, which keeps the worst
 * case for stray prose (`// don't`) to a single line.
 */
export function blankStringLiterals(code: string): string {
  const out: string[] = [];
  // Open template literals, innermost last. A `}` closes an interpolation only
  // while this stack is non-empty and we are not inside a nested brace.
  const templates: { braceDepth: number }[] = [];
  let i = 0;

  const inTemplateText = () => templates.length > 0 && templates[templates.length - 1].braceDepth === 0;

  while (i < code.length) {
    const c = code[i];

    // ── inside the literal text of a template ──────────────────────────────
    if (inTemplateText()) {
      if (c === '\\') {
        // Keep the escape pair, blanked, so lengths and newlines line up.
        out.push(' ', code[i + 1] === '\n' ? '\n' : ' ');
        i += 2;
        continue;
      }
      if (c === '`') {
        out.push('`');
        templates.pop();
        i++;
        continue;
      }
      if (c === '$' && code[i + 1] === '{') {
        // Interpolated CODE — visible on purpose.
        out.push('$', '{');
        templates[templates.length - 1].braceDepth = 1;
        i += 2;
        continue;
      }
      out.push(c === '\n' ? '\n' : ' ');
      i++;
      continue;
    }

    // ── code: either top level, or inside a `${ … }` interpolation ─────────
    if (templates.length > 0) {
      const top = templates[templates.length - 1];
      if (c === '{') {
        top.braceDepth++;
        out.push(c);
        i++;
        continue;
      }
      if (c === '}') {
        top.braceDepth--;
        out.push(c);
        i++;
        continue;
      }
    }

    if (c === '`') {
      out.push('`');
      templates.push({ braceDepth: 0 });
      i++;
      continue;
    }

    if (c === "'" || c === '"') {
      out.push(c);
      i++;
      while (i < code.length && code[i] !== c && code[i] !== '\n') {
        if (code[i] === '\\') {
          out.push(' ', code[i + 1] === '\n' ? '\n' : ' ');
          i += 2;
          continue;
        }
        out.push(' ');
        i++;
      }
      if (i < code.length) {
        out.push(code[i]); // the closing quote, or the newline that ended it
        i++;
      }
      continue;
    }

    out.push(c);
    i++;
  }

  return out.join('');
}

/** A string literal located on the scaffold: where its CONTENT starts and ends. */
export interface LiteralSpan {
  /** Index of the opening quote. */
  readonly open: number;
  /** Index of the closing quote. */
  readonly close: number;
  /** The quote character. */
  readonly quote: string;
}

/**
 * The string literal that starts at or after `from` on a blanked scaffold.
 *
 * Exists so a caller can do the one thing a regex over raw source cannot: decide
 * on the SCAFFOLD that a construct is real code, then read its string operand
 * from the ORIGINAL text by offset. `QUOTES` includes the backtick, so a
 * specifier written as a template literal is found too.
 */
export function literalSpanAt(scaffold: string, from: number): LiteralSpan | null {
  let i = from;
  while (i < scaffold.length && /\s/.test(scaffold[i])) i++;
  if (i >= scaffold.length || !QUOTES.has(scaffold[i])) return null;

  const quote = scaffold[i];
  const close = scaffold.indexOf(quote, i + 1);
  if (close === -1) return null;

  return { open: i, close, quote };
}

/**
 * Remove TypeScript comments, preserving newlines so every later line keeps its
 * number.
 *
 * ── The precedence bug this replaces (QA D1/D2, High) ──────────────────────
 * The previous implementation blanked STRINGS FIRST and then looked for
 * comments in the resulting scaffold:
 *
 *     const scaffold = blankStringLiterals(source);   // strings gone
 *     …scan `scaffold` for // and /* …                // comments second
 *
 * That order is backwards, and an apostrophe is enough to break it. In
 * `/* the admin user's list *\/` the blanker sees `'`, opens a single-quoted
 * string, finds no closing quote on the line, and blanks to the newline —
 * TAKING THE `*\/` WITH IT. The block comment therefore never closes, and the
 * comment scan deletes everything up to the next `*\/` anywhere later in the
 * file: real code, silently, in the permissive direction.
 *
 * Measured consequences, both of which QA demonstrated:
 *   * a one-line block comment containing an apostrophe, placed above an early
 *     return in `app/admin/layout.tsx`, hid the return from R6 — 106/106 green
 *     with the admin shell rendered to any caller;
 *   * the layout's own comment, reflowed onto one line, failed R6 on a correct
 *     file.
 *
 * And it was never branch-local. Measured over the 2,524 files the guard scans
 * against an oracle built from TYPESCRIPT'S OWN SCANNER — chosen after SA showed
 * that a hand-written reference can share the implementation's blind spot:
 * `origin/main`'s version truncates **36 files / 62,594 characters**, so R1-R5 have been deciding on mangled source in production CI.
 *
 * The full measured sequence, against that same oracle:
 *   * `origin/main`, committed today:         **36 files / 62,594 characters**
 *   * the precedence fix alone:               **27 files /  1,840 characters**
 *   * the precedence fix AND the regex state: ** 0 files /      0 characters**
 *
 * The middle figure independently reproduces SA's **28 files / 1,952 characters**
 * by a different method (the delta is CRLF accounting and one excluded file),
 * which is the confirmation that matters — two methods, one answer.
 *
 * Two figures reported EARLIER on this branch are SUPERSEDED, recorded because a
 * wrong zero is worse than an honest number: **"16 files / 64,700"** and the
 * first **"0 / 0"**. Both were measured against hand-written reference strippers
 * that shared the implementation's blind spot — no regex-literal state — so a
 * scanner that was still broken scored as perfect. A reference that can agree
 * with the bug is not a reference.
 *
 * NOT yet true of `main`: PR #104 merged (`d45a6cca`, 2026-09-24) WITHOUT this
 * file's `stripComments`. `main`'s copy still lives at
 * `lib/admin/__tests__/admin-authz-surface.guard.test.ts:466` and still blanks
 * strings first, so the 36 / 62,594 above is the LIVE state of the required
 * check until the follow-up branch merges.
 *
 * ── The fix is smaller, not cleverer ──────────────────────────────────────
 * One left-to-right pass with explicit state. Inside a comment a quote is just
 * a character; inside a string `//` is just two characters. Neither construct
 * is discovered by looking at a text the other one has already rewritten.
 */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  /** Open template literals, innermost last, so `${ … }` nests correctly. */
  const templates: { braceDepth: number }[] = [];
  /** The last non-whitespace character of real code, for the regex decision. */
  let lastCode = '';

  const inTemplateText = () =>
    templates.length > 0 && templates[templates.length - 1].braceDepth === 0;

  /**
   * Could a `/` here START a regex literal rather than be a division?
   *
   * The standard rule: a regex may begin where an expression may begin. After an
   * identifier, a literal, a `)` or a `]` the slash is division.
   *
   * The `<` carve-out is for TSX: `</div>` must NOT read as a regex opener, and
   * `a < /re/.source` is not a shape this repo contains.
   */
  const regexMayStartHere = () => {
    if (lastCode === '') return true;
    if (lastCode === '<') return false;
    return !/[A-Za-z0-9_$)\]'"`]/.test(lastCode);
  };

  const emit = (c: string) => {
    out += c;
    if (!/\s/.test(c)) lastCode = c;
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    // ── inside the literal text of a template ──────────────────────────────
    if (inTemplateText()) {
      if (c === '\\') {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === '`') {
        emit('`');
        templates.pop();
        i++;
        continue;
      }
      if (c === '$' && next === '{') {
        // F2: an interpolation holds real CODE, so the scanner re-enters code
        // state and a comment in there is stripped like any other.
        out += '${';
        lastCode = '{';
        templates[templates.length - 1].braceDepth = 1;
        i += 2;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    // ── code, either top level or inside `${ … }` ──────────────────────────
    // Comments FIRST — the precedence that D1 got backwards.
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      for (let j = i; j < stop; j++) if (source[j] === '\n') out += '\n';
      i = stop;
      continue;
    }

    /*
     * ── F1: the regex-literal state (SA, final re-check) ──────────────────
     * Without it `/[/*]/` opens a phantom BLOCK COMMENT and everything to the
     * next `*<slash>` is deleted. SA demonstrated a `profiles.role` decision
     * vanishing from R4's input, and `AnswerRenderer.ts:458` losing 22,686 of
     * its 40,701 non-newline characters.
     *
     * A regex cannot span a newline, so if no closing `/` is found on this line
     * the slash was division after all and is emitted as an ordinary character.
     * That is the conservative direction: code stays code.
     */
    if (c === '/' && regexMayStartHere()) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < source.length && source[j] !== '\n') {
        const d = source[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) {
          closed = true;
          break;
        }
        j++;
      }
      if (closed) {
        // Copied through verbatim: a `/*` or `//` inside it is just characters.
        out += source.slice(i, j + 1);
        lastCode = '/';
        i = j + 1;
        // Flags, so `/x/g.test(…)` leaves `g` as the last code character.
        while (i < source.length && /[a-z]/.test(source[i])) {
          emit(source[i]);
          i++;
        }
        continue;
      }
    }

    // Track `${ … }` nesting so the closing brace returns to template text.
    if (templates.length > 0) {
      const top = templates[templates.length - 1];
      if (c === '{') {
        top.braceDepth++;
        emit(c);
        i++;
        continue;
      }
      if (c === '}') {
        top.braceDepth--;
        out += c;
        lastCode = top.braceDepth === 0 ? '`' : '}';
        i++;
        continue;
      }
    }

    // Strings are copied through: a `//` inside one is not a comment.
    if (c === "'" || c === '"') {
      out += c;
      i++;
      while (i < source.length && source[i] !== c && source[i] !== '\n') {
        if (source[i] === '\\') {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        i++;
      }
      if (i < source.length) {
        out += source[i];
        i++;
      }
      lastCode = c;
      continue;
    }
    if (c === '`') {
      emit('`');
      templates.push({ braceDepth: 0 });
      i++;
      continue;
    }

    emit(c);
    i++;
  }

  return out;
}

// ── Route-handler scanning ───────────────────────────────────────────
//
// MOVED here from lib/admin/__tests__/admin-authz-surface.guard.test.ts
// (PROD-1c A-1, SA N-2), unchanged, so the test-surface guard (G-9 in
// lib/__tests__/envConfigHardening.guard.test.ts) reuses the one handler
// parser instead of writing a second. Its unit tests stay in the admin guard.
//
// LOAD-BEARING FOR A REQUIRED CHECK: the admin authz surface guard (rule R1)
// decides on this parser. After any edit here, run `npm run test:authz-guard`.

/** Next.js route-handler export names. All of them — authz is not verb-specific. */
export const HTTP_HANDLERS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

/** Index just past the `)` matching the `(` at `openParen`, or -1. */
export function matchParen(scaffold: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen; i < scaffold.length; i++) {
    if (scaffold[i] === '(') depth++;
    else if (scaffold[i] === ')') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Given the index just past a parameter list's `)`, return the index of the
 * `{` that opens the FUNCTION BODY — or -1 if what follows is not a body.
 *
 * This is the D-1/D-2 fix, and the whole point is the -1 case.
 *
 * ── D-1 (HIGH, SA review 2026-09-20) ──────────────────────────────────────
 * The old code took "the first `{` after the parameter list" as the body. For
 * a handler wrapped in a higher-order function, the parens matched are the
 * WRAPPER's, so the next `{` belongs to whatever happens to come next in the
 * file. SA reproduced:
 *
 *   export const GET = withAuth(async (req) => { return 1; });
 *   function unrelated() { const g = requireAdmin(l); return 2; }
 *
 * → `handlers: [{ name: 'GET', body: '{ const g = requireAdmin(l); return 2; }' }]`
 *   with `unparseable: []`.
 *
 * An UNRELATED function's body was attributed to `GET`; the guard saw
 * `requireAdmin(` in it and passed an ungated admin route. Both safety nets
 * failed at once — R1 said "gated" and the fail-closed rule had nothing to
 * flag. HOC-wrapped handlers are an ordinary Next.js pattern, so this is the
 * single outcome this guard exists to prevent.
 *
 * ── D-2 (MEDIUM, same review) ─────────────────────────────────────────────
 * `export async function POST(req): Promise<{ ok: boolean }> { … }` had its
 * body extracted as `{ ok: boolean }` — the RETURN TYPE — and a correctly
 * gated handler was reported ungated. Same family as the `{ params }` bug,
 * one position later: paren-matching skipped the parameter list, but nothing
 * skipped the return-type annotation.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 * After the parameter list, the only things that may legally precede a body
 * are an optional `: ReturnType` annotation and, for arrows, `=>`. So:
 *   • skip an optional `:`-introduced type annotation (which may itself
 *     contain braces, e.g. `Promise<{ ok: boolean }>`) at nesting depth 0;
 *   • then accept `{` (function form) or `=>` `{` (arrow form);
 *   • anything else — `;`, `)`, `,`, an identifier — means those parens were
 *     NOT the handler's parameter list. Return -1, and the caller records the
 *     handler as unparseable rather than guessing.
 */
export function findBodyBrace(scaffold: string, afterParams: number): number {
  let i = afterParams;
  const skipWs = () => {
    while (i < scaffold.length && /\s/.test(scaffold[i])) i++;
  };

  skipWs();

  // Optional `: ReturnType`. Walk it at depth 0 so a braced or generic type
  // (`Promise<{ ok: boolean }>`) is skipped rather than mistaken for the body.
  if (scaffold[i] === ':') {
    i++;
    let depth = 0;
    while (i < scaffold.length) {
      const c = scaffold[i];
      if (c === '<' || c === '(' || c === '[') depth++;
      else if (c === '>' || c === ')' || c === ']') depth--;
      else if (c === '{') {
        if (depth === 0) break; // the body
        depth++;
      } else if (c === '}') depth--;
      else if (depth === 0 && c === '=' && scaffold[i + 1] === '>') break;
      else if (depth === 0 && (c === ';' || c === ',')) break;
      i++;
    }
    skipWs();
  }

  if (scaffold[i] === '{') return i;

  if (scaffold[i] === '=' && scaffold[i + 1] === '>') {
    i += 2;
    skipWs();
    // An expression-bodied arrow (`=> NextResponse.json(…)`) has no braced
    // body and therefore no place a gate could live. -1 → unparseable.
    return scaffold[i] === '{' ? i : -1;
  }

  return -1;
}

/**
 * Return a handler's body, given the index of its parameter list's `(`.
 *
 * **The parameter list must be skipped before looking for the body brace.**
 * Next.js dynamic routes are declared
 * `export async function PATCH(request: NextRequest, { params }: { params: { id: string } })`
 * — so the first `{` after the handler name belongs to a DESTRUCTURING PATTERN,
 * not the body. An earlier version of this guard matched that brace and
 * "extracted" a body of `{ params }`, then reported
 * `app/api/admin/messages/[id]/route.ts#PATCH` as ungated when it was gated
 * correctly. Caught on this guard's second run against real files.
 *
 * That was a false positive — the safe direction — but a guard that cries wolf
 * on correct code is a guard someone switches off, so it is a real defect.
 * D-1 and D-2 are the same instinct applied one step further; see
 * `findBodyBrace`, which is where "what may legally precede a body" is decided.
 *
 * `null` means "could not parse", and every caller must treat it as a FAILURE,
 * never as "no violation found".
 */
export function extractBracedBody(code: string, parenIndex: number): string | null {
  const scaffold = blankStringLiterals(code);

  const afterParams = matchParen(scaffold, parenIndex);
  if (afterParams === -1) return null;

  const open = findBodyBrace(scaffold, afterParams);
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < scaffold.length; i++) {
    const ch = scaffold[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return null;
}

/**
 * For the `export const GET = …` form: find the parameter list's `(`.
 *
 * Returns -1 when the value is not a function we can trace — `export const GET
 * = someHandler` or `export const GET = { … }`. Those are FLAGGED, not skipped.
 */
export function findValueParen(scaffold: string, from: number): number {
  const paren = scaffold.indexOf('(', from);
  const brace = scaffold.indexOf('{', from);
  if (paren === -1) return -1;
  if (brace !== -1 && brace < paren) return -1;
  return paren;
}

export const HANDLER_ALTERNATION = HTTP_HANDLERS.join('|');

export interface HandlerScan {
  /** Handlers found, with their body source. */
  handlers: Array<{ name: string; body: string }>;
  /** Human-readable reasons the file could not be fully parsed. */
  unparseable: string[];
}

/**
 * Extract the HTTP handlers a route file exports.
 *
 * W-7: recognises BOTH export forms, and reports anything it cannot attribute
 * to a body rather than skipping it.
 *
 * All 44 current admin route files use `export async function GET`. A handler
 * written `export const GET = async (req) => {}` is valid Next.js and would
 * pass a scanner that only knew the first form — silently, and in the
 * permissive direction. That is the failure mode that matters.
 */
export function scanHandlers(code: string): HandlerScan {
  const handlers: Array<{ name: string; body: string }> = [];
  const unparseable: string[] = [];

  const scaffold = blankStringLiterals(code);

  // Form 1 — `export async function GET(` / `export function GET(`
  const fnRe = new RegExp(`export\\s+(?:async\\s+)?function\\s+(${HANDLER_ALTERNATION})\\s*\\(`, 'g');
  for (let m = fnRe.exec(code); m; m = fnRe.exec(code)) {
    // The `(` of the parameter list is the last character of the match.
    const body = extractBracedBody(code, m.index + m[0].length - 1);
    if (body === null) {
      unparseable.push(
        `${m[1]}: could not trace the function body. The guard will not guess ` +
          'which braces belong to this handler — see findBodyBrace (D-1/D-2).'
      );
    } else handlers.push({ name: m[1], body });
  }

  // Form 2 — `export const GET = …` (also let/var, and an optional type annotation)
  const constRe = new RegExp(
    `export\\s+(?:const|let|var)\\s+(${HANDLER_ALTERNATION})\\s*(?::[^=]+)?=`,
    'g'
  );
  for (let m = constRe.exec(code); m; m = constRe.exec(code)) {
    const paren = findValueParen(scaffold, m.index + m[0].length);
    if (paren === -1) {
      unparseable.push(
        `${m[1]}: assigned a value this guard cannot trace to a function body ` +
          '(a bare reference, or an object). Inline the handler so its gate is visible.'
      );
      continue;
    }
    const body = extractBracedBody(code, paren);
    if (body === null) {
      // The D-1 shape lands here: `export const GET = withAuth(async (req) => {…})`
      // matches a `(`, but what follows its `)` is `;`, not a body. Rather than
      // adopting the next unrelated `{` in the file, say so.
      unparseable.push(
        `${m[1]}: the parentheses after the assignment are not this handler's ` +
          'parameter list — it looks wrapped (a higher-order function) or ' +
          'expression-bodied. The guard cannot prove where its gate is, so it ' +
          'will not pass it. Inline the handler, or gate inside the wrapper and ' +
          'allow-list it with a reason.'
      );
    } else handlers.push({ name: m[1], body });
  }

  // Form 3 — anything else. We cannot attribute these to a body, so we FLAG.
  const braceRe = /export\s*\{([^}]*)\}/g;
  for (let m = braceRe.exec(code); m; m = braceRe.exec(code)) {
    for (const name of HTTP_HANDLERS) {
      if (new RegExp(`\\b${name}\\b`).test(m[1])) {
        unparseable.push(`${name}: re-exported via \`export { … }\`, which this guard cannot trace`);
      }
    }
  }
  if (/export\s*\*\s/.test(code)) {
    unparseable.push('`export *` — this guard cannot know which handlers it re-exports');
  }

  /*
   * D-Q3 (QA, 2026-09-20): catch a handler DECLARED in a shape none of the three
   * strict forms matched.
   *
   * The zero-handler safety net below only fires when a file yields NOTHING. A
   * file with one parseable handler and one unrecognised one has
   * `handlers.length > 0`, so the net never fires and the unrecognised handler
   * is invisible to R1. QA's examples:
   *
   *   export async function GET<T>(req) { … }   // generic — no form matches
   *   export let GET; GET = async () => { … };  // declared, assigned later
   *
   * Generics on a route handler are contrived; the CLASS is not. It is exactly
   * "we only recognise the shapes people currently write".
   *
   * So: re-scan with DELIBERATELY LOOSE patterns that do not require the `(` or
   * the `=`, and flag any handler name they find that the strict forms did not
   * attribute. Loose-but-flagging is the safe direction — the cost of a false
   * positive here is one allow-list line with a reason.
   */
  const attributed = new Set(handlers.map((h) => h.name));
  const alreadyFlagged = (name: string) => unparseable.some((u) => u.startsWith(`${name}:`));

  const looseRes = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+(${HANDLER_ALTERNATION})\\b`, 'g'),
    new RegExp(`export\\s+(?:const|let|var)\\s+(${HANDLER_ALTERNATION})\\b`, 'g'),
  ];
  for (const re of looseRes) {
    for (let m = re.exec(code); m; m = re.exec(code)) {
      const name = m[1];
      if (attributed.has(name) || alreadyFlagged(name)) continue;
      unparseable.push(
        `${name}: exported in a shape this guard does not recognise (a generic, a ` +
          'deferred assignment, or something else). It cannot be proven gated, so it ' +
          'is not assumed to be. Write it as `export async function NAME(req) { … }`.'
      );
      attributed.add(name); // report each name once
    }
  }

  return { handlers, unparseable };
}

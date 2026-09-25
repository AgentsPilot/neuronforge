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

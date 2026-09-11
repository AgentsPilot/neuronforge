/**
 * A numeric expression over step results.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS, GIVEN THE FILE NEXT DOOR ARGUES AGAINST IT
 *
 * `AnswerRenderer.ts` says of `{sN.percent_of.sM}`:
 *
 *   "This is deliberately a named path rather than an expression syntax: an
 *    arithmetic mini-language in a placeholder is a parser, and a parser here is
 *    a source of wrong numbers dressed as a feature."
 *
 * That is right about a general parser. It is too broad for this one, and two
 * ordinary questions show why the closed vocabulary cannot hold:
 *
 *   "how much did my revenue drop from last week"
 *      the drop needs a difference; the PERCENTAGE drop is (s2-s1)/s2, which
 *      `percent_of` cannot express at all — it only ever computes s1/s2.
 *
 *   "revenue, refunds, and the percentage of refund from revenue"
 *      works today, and only because someone added `percent_of` by hand.
 *
 * Every new phrasing costs another named path, a test and a deploy. The
 * vocabulary grows forever and never catches up.
 *
 * WHAT MAKES THIS DIFFERENT FROM THE PARSER THAT WAS REFUSED
 *
 * The grammar is numbers, four operators, parentheses, and `sN.value` /
 * `sN.count`. No identifiers, no strings, no property access, no calls, no
 * indexing. There is nothing to reach — the tokenizer rejects any character it
 * does not recognise, so an expression cannot name anything that is not a step's
 * number.
 *
 * And the concern behind the warning is honoured directly: every uncertain
 * outcome resolves to `null`, which sends the caller to the plain fallback line.
 * A missing figure is a worse ANSWER and a better OUTCOME than a plausible wrong
 * one, which is the whole point of the sentence it lands in.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/bizql/render
 */

/** Rejects anything longer, before tokenizing. A real formula is short. */
const MAX_LENGTH = 200;

/** Parenthesis depth. Guards the recursive descent against a crafted input. */
const MAX_DEPTH = 16;

type Token =
  | { kind: 'number'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'op'; value: '+' | '-' | '*' | '/' }
  | { kind: 'paren'; value: '(' | ')' };

/**
 * The allowlist IS the security boundary.
 *
 * Anchored, and consuming the whole source: a single unrecognised character
 * fails the expression rather than being skipped. `__proto__`,
 * `s1.value.constructor` and `1;doSomething()` all die here, because none of
 * them tokenize — there is no rule that can produce an identifier.
 */
const TOKEN = /^(?:(\d+(?:\.\d+)?)|(s\d+\.(?:value|count))|([+\-*/])|([()])|(\s+))/;

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let rest = source;

  while (rest.length > 0) {
    const match = TOKEN.exec(rest);
    if (!match) return null;

    const [whole, num, ref, op, paren, space] = match;

    if (num !== undefined) tokens.push({ kind: 'number', value: Number(num) });
    else if (ref !== undefined) tokens.push({ kind: 'ref', name: ref });
    else if (op !== undefined) tokens.push({ kind: 'op', value: op as '+' });
    else if (paren !== undefined) tokens.push({ kind: 'paren', value: paren as '(' });
    else if (space === undefined) return null;

    rest = rest.slice(whole.length);
  }

  return tokens;
}

/**
 * Evaluate `source`, resolving `sN.value` / `sN.count` through `lookup`.
 *
 * Returns null — never a number — when anything at all is uncertain:
 *
 *   - the source does not tokenize or does not parse
 *   - a referenced step has no value (see below)
 *   - the result is not finite
 *
 * `lookup` returning null is the case worth naming. A step that matched no rows
 * has a null value, and JavaScript coerces null to 0 without complaint, so
 * `null - 5` is `-5` — a real, wrong, unremarkable-looking number. Checking
 * explicitly is what stops "your revenue dropped by 5" being said about a period
 * that has no revenue figure at all.
 */
export function evaluateExpression(
  source: string,
  lookup: (ref: string) => number | null
): number | null {
  if (source.length > MAX_LENGTH) return null;

  const tokens = tokenize(source);
  if (!tokens || tokens.length === 0) return null;

  let position = 0;
  let failed = false;

  const peek = (): Token | undefined => tokens[position];

  const expression = (depth: number): number => {
    if (depth > MAX_DEPTH) {
      failed = true;
      return 0;
    }

    let left = term(depth);

    for (;;) {
      const token = peek();
      if (!token || token.kind !== 'op' || (token.value !== '+' && token.value !== '-')) break;
      position++;
      const right = term(depth);
      left = token.value === '+' ? left + right : left - right;
    }

    return left;
  };

  const term = (depth: number): number => {
    let left = factor(depth);

    for (;;) {
      const token = peek();
      if (!token || token.kind !== 'op' || (token.value !== '*' && token.value !== '/')) break;
      position++;
      const right = factor(depth);
      // Not guarded here: x/0 is Infinity, and the finite check at the end
      // catches it. Guarding early would hide 0/0, which is NaN, not Infinity.
      left = token.value === '*' ? left * right : left / right;
    }

    return left;
  };

  const factor = (depth: number): number => {
    const token = peek();

    if (!token) {
      failed = true;
      return 0;
    }

    // Unary minus, so "(s2.value - s1.value)" and "-5" both parse.
    if (token.kind === 'op' && token.value === '-') {
      position++;
      return -factor(depth);
    }

    if (token.kind === 'number') {
      position++;
      return token.value;
    }

    if (token.kind === 'ref') {
      position++;
      const resolved = lookup(token.name);
      if (resolved === null || !Number.isFinite(resolved)) {
        failed = true;
        return 0;
      }
      return resolved;
    }

    if (token.kind === 'paren' && token.value === '(') {
      position++;
      const inner = expression(depth + 1);
      const closing = peek();
      if (!closing || closing.kind !== 'paren' || closing.value !== ')') {
        failed = true;
        return 0;
      }
      position++;
      return inner;
    }

    failed = true;
    return 0;
  };

  const result = expression(0);

  // Trailing tokens mean the source was not one expression — "1 2" or "1)".
  if (failed || position !== tokens.length) return null;

  return Number.isFinite(result) ? result : null;
}

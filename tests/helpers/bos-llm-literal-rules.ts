/**
 * The source-scanning rules the Business OS LLM admin layer asserts against
 * itself — shared, because there are now three copies of them.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * `scripts/check-bos-llm-literals.ts` is the real gate, but it only sees files
 * that reach the call catalog through the import graph. The admin SCREEN
 * deliberately imports nothing from the catalog (FR-6), so the gate cannot see
 * it at all and a source test is the only enforcement there is. Two of those
 * tests already existed (slice 1's route tests); slice 2 adds the third, which
 * is the point at which a shared copy stops being premature (SA optimisation).
 *
 * ── The one property that matters ────────────────────────────────────────
 * Every rule carries a `mustMatch` sample and is asserted against it. Two of
 * these regexes were once DEAD — written as plain template literals, so
 * `case\s+` compiled to `/cases+/` — and nothing noticed, because a rule that
 * cannot match looks exactly like a rule that found nothing. Hence
 * `String.raw`, and hence `mustMatch`.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_WORKPLAN.md §5
 */

/**
 * Strip comments before scanning.
 *
 * The gate itself reads the AST, so prose about a model is never mistaken for
 * a model. These tests read text, so they have to do the same by hand —
 * otherwise this very file's doc block would fail the scan it defines.
 */
export function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * Flatten source to ONE logical line before scanning for a phrase or a list
 * (CR-1).
 *
 * ── Two mutations survived for this one reason ───────────────────────────
 * Every string longer than a line in this layer is authored as `'…' + '…'`,
 * and prettier wraps a long array literal the same way. A raw scan sees
 * neither. Two rules were caught out by it in the same round: the propagation
 * clause (M5) and the excluded-call reason (M7), both of which a developer
 * would re-type in exactly the wrapped form the rule could not see.
 *
 * Shared rather than copied because it is now the normalisation THREE source
 * rules depend on, in two different suites — and a second copy of it would be
 * the same defect class one level up.
 */
export function flattened(source: string): string {
  return source
    .replace(/['"]\s*\+\s*['"]/g, '') // `'…' + '…'` → one literal
    .replace(/\s+/g, ' '); // a wrapped literal, array or template → one line
}

/** The vendor families `MODEL_ID_PATTERNS` in the gate recognises. */
export const FEATURE_ROOTS =
  'gpt|chatgpt|o[1345]|text-embedding|tts|sora|omni-moderation|claude|kimi|mistral|gemini|llama|moonshot|deepseek|grok|dall-e|whisper';

export interface LiteralRule {
  name: string;
  pattern: RegExp;
  /** A sample this rule MUST match, so a broken escape cannot pass as coverage. */
  mustMatch: string;
}

export const LITERAL_RULES: readonly LiteralRule[] = [
  {
    name: 'a quoted model id of any vendor family',
    pattern: new RegExp(String.raw`['"](${FEATURE_ROOTS})-[a-z0-9._:-]*['"]`, 'i'),
    mustMatch: `const m = 'claude-3-5-sonnet-20241022';`,
  },
  {
    name: 'a z.enum allow-list of model ids',
    pattern: /z\.enum\(\s*\[\s*['"](gpt|claude|kimi|mistral)-/i,
    mustMatch: `z.enum(['gpt-4o', 'gpt-4o-mini'])`,
  },
  {
    name: 'a switch case on a model name',
    pattern: new RegExp(String.raw`case\s+['"](${FEATURE_ROOTS})-`, 'i'),
    mustMatch: `switch (m) { case 'gpt-4o': break; }`,
  },
  {
    name: 'a price-index key literal',
    pattern: new RegExp(String.raw`\[\s*['"](${FEATURE_ROOTS})-[^'"]*['"]\s*\]`, 'i'),
    mustMatch: `const p = PRICES['gpt-4o'];`,
  },
  {
    name: 'a temperature bound to a literal number',
    pattern: /temperature\s*[:=]\s*[0-9]/,
    mustMatch: `chat({ temperature: 0.7 })`,
  },
];

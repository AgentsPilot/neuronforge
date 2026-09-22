/**
 * check-bos-llm-literals — FR-15's gate: no model name and no temperature is
 * written into a Business OS call site.
 *
 * WHY THIS EXISTS
 *
 * Layer 2 moved every catalogued Business OS LLM call onto settings resolved at
 * run time (`resolveBosLlmSettings`), so an operator can change a model or
 * switch an area off without a deploy. That property is invisible: a call site
 * that quietly goes back to `model: 'gpt-4o'` still works, still tracks cost,
 * still passes every attribution test — it just stops obeying its area row, and
 * nobody finds out until an operator changes a setting and nothing happens.
 * This check makes that regression a red CI step instead of a discovery.
 *
 * WHAT IT FLAGS (in code only — the AST is walked, so comments and JSDoc are
 * never read; the settings are the truth, prose about them is not)
 *
 *   1. MODEL LITERAL     a quoted string that IS a model id, anchored end to
 *                        end: 'gpt-4o', "gpt-4o-mini", 'o1-preview',
 *                        'text-embedding-3-small', 'gpt-image-1', 'claude-…',
 *                        'kimi-…'. A sentence that merely mentions a model is
 *                        not a model literal and is not flagged.
 *   2. MODEL CONSTANT    `OPENAI_MODELS.X` / `OPENAI_MODELS['X']`, or any other
 *                        reference to that catalogue of names. It is the same
 *                        hardcode with an import in front of it (the briefing
 *                        narrator used to read `OPENAI_MODELS.GPT_4O_MINI`).
 *   3. TEMPERATURE       a numeric literal bound to a temperature-ish name:
 *                        `temperature: 0.7`, `temperature = 0`, a ternary, a
 *                        default parameter, a class property, a destructuring
 *                        default (`{ temperature: temp = 0.4 }`), and the
 *                        defaulting forms `?? 0.7`, `|| 0.3` **and their
 *                        assignment operators `??=` / `||=`** — all hardcodes
 *                        wearing a resolver's clothes. `satisfies number` does
 *                        not hide one either.
 *   4. SUPERSEDED KEY    a read of one of the single-purpose settings keys the
 *                        area rows replaced (`bizchat_planner_model`,
 *                        `image_generation_model`, …). Restoring one is silent:
 *                        the call would read a key no operator is told to edit,
 *                        while the area row it ignores keeps saying something
 *                        else (workplan FU-4).
 *   5. ENV MODEL         `process.env.OPENAI_CHAT_MODEL` — a model an operator
 *                        cannot change without a deploy, which is the thing
 *                        Layer 2 exists to stop. (chat-v2's shape, which is out
 *                        of scope today only because it does not import the
 *                        catalog.)
 *
 * WHAT IT CANNOT SEE — READ THIS BEFORE TRUSTING A GREEN RUN
 *
 * The check is SYNTACTIC. It sees a literal or a named constant written AT the
 * call site; it does not follow values. SA proved the main hole end to end
 * against the real tree, with this gate reporting `0 violations`:
 *
 *   - **A value one file away.** A helper exporting
 *     `export const PREFERRED_MODEL = 'gpt-4o'` (or a temperature), imported
 *     into a wired call site. BOTH halves are invisible: the helper is out of
 *     scope because it does not import the catalog, and the call site is clean
 *     because the value arrives as an identifier.
 *   - **Anything computed:** `['gpt', '4o'].join('-')`, a template literal with
 *     an expression in it, `Number('0.7')`, a value read from a JSON file, a
 *     dynamic `import()` of the policy module.
 *   - **A temperature reached through an unnamed variable:** `const t = 0.7;
 *     chat({ temperature: t })`. Named ones are caught (`DEFAULT_TEMP`,
 *     `defaultTemperature`), because the name is all this check has.
 *   - **A model id outside the pattern list** (below). The list is vendor
 *     naming conventions and WILL rot; it needs an owner.
 *   - **`process.env` one alias away:** `const cfg = process.env;
 *     cfg['OPENAI_CHAT_MODEL']`, a destructured `const { OPENAI_CHAT_MODEL } =
 *     process.env`, or any `getEnv('…')` helper. Rule 5 is belt-and-braces, not
 *     a general closure of that shape.
 *
 * Closing these needs type-level or data-flow analysis, which is
 * disproportionate for a check that must run in ~20 s on every PR. So the
 * honest statement is: **a green run means no call site writes a model or a
 * temperature in plain sight. It does not mean every call site obeys its area
 * row** — that is what `callParams.boundary.*.test.ts` proves, per site, at the
 * provider boundary. A reviewer who believes this gate is total stops looking,
 * which is worse than no gate.
 *
 * KNOWN FALSE POSITIVES (they will arrive with the admin screen, FU-3)
 *
 * A string literal in a TYPE position is skipped (`type M = 'gpt-4o' | …`,
 * `interface X { model: 'gpt-4o' }`) — a type cannot send anything to a
 * provider. These still FAIL and are legitimate code; the answer is a narrow
 * rule change here, never a new file exemption:
 *
 *   - `z.enum(['gpt-4o', 'gpt-4o-mini'])`      — a model allow-list
 *   - `z.string().default('gpt-4o')`           — a schema default
 *   - `['gpt-4o', 'gpt-4o-mini'] as const`     — the runtime half of one
 *   - `switch (m) { case 'gpt-4o': … }`        — a per-model branch
 *   - `PRICES['gpt-4o']`                       — a price-index key
 *   - `<ModelPicker model="gpt-4o" />`         — a default in a component
 *   - `const TEMPERATURE_MAX = 2`              — a bound, not a setting
 *     (hypothetical today: `TEMPERATURE_BOUNDS` lives in the exempt policy
 *     module, which is where a bound belongs)
 *
 * SCOPE — `scripts/lib/bos-llm-scope.ts` `literalScope()`: the call catalog and
 * every NON-TEST file that imports it, derived from the compiler's import
 * graph, not hand-listed. Tests, fixtures and mocks are excluded: they must
 * name models, because pinning "what the provider actually received" is how
 * Layer 2 is proved at all.
 *
 * INCLUSIONS are the mirror image: named files pulled INTO scope that the
 * direct-import rule would miss (today, the admin settings route, which reaches
 * the catalog one hop away through `adminSettingsView`). Scope only ever grows
 * there, one named file at a time, and `--list` marks them `included`. This is
 * the "narrow rule change, never a file exemption" this header prescribes.
 *
 * EXEMPTIONS are named files, each with its reason, and `--list` prints them.
 * Two today: the FR-3 policy module (the place defaults are meant to live) and
 * the operator script (P-5b must name the superseded keys). A third is a code
 * change with an SA review, not a config line, and that is deliberate: the
 * exemption list is the gate's blast radius, so it has to be readable. That is
 * also why `scripts/` is NOT excluded as a directory — it would buy one file
 * and blanket ~400 others for ever (SA finding 8).
 *
 * USAGE
 *
 *   npm run check:bos-llm-literals              # the gate
 *   npm run check:bos-llm-literals -- --list    # print the scoped files
 *
 * @see docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md (FR-15, AC-11)
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §8
 * @module scripts/check-bos-llm-literals
 */

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

import {
  LITERAL_SCOPE_INCLUSIONS,
  ROOT,
  buildImportGraph,
  literalScope,
  loadConfig,
  projectFiles,
} from './lib/bos-llm-scope';

/**
 * The one exempt file, with its reason. Keyed by repo-relative path so a move
 * loses the exemption rather than silently keeping it.
 */
export const EXEMPTIONS: Readonly<Record<string, string>> = {
  'lib/business-os/llm/modelSettingsPolicy.ts':
    'FR-3: this IS the code-owned policy — the single place a model name or temperature is written.',
  'scripts/bos-llm-settings.ts':
    "P-5b `verify-equivalence` must name the superseded keys and their legacy defaults to compare them with the area rows; it is an operator tool, not a call site, and it sends nothing to a provider.",
};

/**
 * A string literal is a model id only if the WHOLE literal is one.
 *
 * Anchored both ends on purpose. `'gpt-4o'` is a hardcode; "This route calls
 * gpt-4o and waits for a full page of copy" is a sentence, and flagging it
 * would push authors to write vaguer prose rather than better code (SA Step 2
 * finding 10).
 */
const MODEL_ID_PATTERNS: readonly RegExp[] = [
  /^gpt-[a-z0-9._-]*$/i, // gpt-4o, gpt-4o-mini, gpt-5, gpt-image-1
  /^chatgpt-[a-z0-9._-]*$/i, // chatgpt-4o-latest is a real, current chat model
  /^o[1345](?:[._-][a-z0-9._-]*)?$/i, // o1, o1-preview, o3-mini, o4-mini
  /^text-embedding-[a-z0-9._-]*$/i,
  /^(?:tts|sora)-[a-z0-9._-]*$/i,
  /^omni-moderation(?:-[a-z0-9._-]*)?$/i,
  /^(?:claude|kimi|mistral|gemini|llama|moonshot|deepseek|grok)-[a-z0-9._:-]*$/i,
  /^dall-e-?[0-9]*$/i,
  /^whisper-[a-z0-9._-]*$/i,
];

/** Identifiers that ARE a catalogue of model names. Referencing one is a hardcode. */
const MODEL_CONSTANT_IDENTIFIERS = new Set([
  'OPENAI_MODELS',
  'ANTHROPIC_MODELS',
  'GROQ_MODELS',
  'MISTRAL_MODELS',
  // The exempt policy module exports this. Reading `BOS_LLM_CALL_POLICY.website
  // .full_site.model` bypasses the resolver and ignores the area row, with every
  // other rule silent — the most obvious door the exemption opens (SA finding 6).
  'BOS_LLM_CALL_POLICY',
]);

/**
 * The single-purpose `system_settings_config` keys the eight area rows
 * superseded (DEC-6). A call site that reads one again is bypassing its row.
 */
const SUPERSEDED_KEYS = new Set([
  'bizchat_planner_model',
  'bizchat_analysis_model',
  'bizchat_analysis_enabled',
  'lead_reply_recommender_model',
  'lead_reply_recommender_enabled',
  'image_generation_model',
]);

export type ViolationRule =
  | 'model-literal'
  | 'model-constant'
  | 'temperature'
  | 'superseded-key'
  | 'env-model';

export interface Violation {
  file: string;
  line: number;
  column: number;
  rule: ViolationRule;
  text: string;
  hint: string;
}

const HINTS: Record<ViolationRule, string> = {
  'model-literal':
    'take the model from resolveBosLlmSettings(area, callName).model; its default belongs in modelSettingsPolicy.ts',
  'model-constant':
    'take the model from resolveBosLlmSettings(area, callName).model; its default belongs in modelSettingsPolicy.ts',
  temperature:
    'take the temperature from resolveBosLlmSettings(area, callName).temperature; its default belongs in modelSettingsPolicy.ts',
  'superseded-key':
    'this key is superseded by the area row bos_llm_area_<area>; read it through resolveBosLlmSettings',
  'env-model':
    'an environment variable is not the area row; take the model from resolveBosLlmSettings(area, callName).model',
};

function isModelId(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return false;
  return MODEL_ID_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/** `0.7` and `-1` both count; `x` does not. */
function numericLiteralOf(node: ts.Node): ts.Node | undefined {
  if (ts.isNumericLiteral(node)) return node;
  if (ts.isPrefixUnaryExpression(node) && ts.isNumericLiteral(node.operand)) return node;
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) return numericLiteralOf(node.expression);
  // `0.7 satisfies number` is still 0.7 (QA D4-3).
  if (ts.isSatisfiesExpression(node)) return numericLiteralOf(node.expression);
  // `temperature: isDraft ? 0.7 : 0.3` — either branch is a hardcode (SA finding 3).
  if (ts.isConditionalExpression(node)) {
    return numericLiteralOf(node.whenTrue) ?? numericLiteralOf(node.whenFalse);
  }
  return undefined;
}

/**
 * Does this identifier name a temperature?
 *
 * Word-aware on purpose: `DEFAULT_TEMP` and `defaultTemp` count (SA finding 3
 * — the abbreviation was the miss), `temperatureValue` counts, and `template`
 * does not, which a plain `includes('temp')` would have flagged on every
 * website file in scope.
 */
function namesATemperature(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return words.some((word) => word === 'temp' || word === 'temps' || word.includes('temperature'));
}

function mentionsTemperature(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return /temperature/i.test(node.text);
  if (ts.isPropertyAccessExpression(node)) {
    return /temperature/i.test(node.name.text) || mentionsTemperature(node.expression);
  }
  if (ts.isElementAccessExpression(node)) {
    const argument = node.argumentExpression;
    return (
      (ts.isStringLiteralLike(argument) && /temperature/i.test(argument.text)) ||
      mentionsTemperature(node.expression)
    );
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) {
    return mentionsTemperature(node.expression);
  }
  return false;
}

/** `process.env`, the one expression an operator cannot change without a deploy. */
function isProcessEnv(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'env' &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'process'
  );
}

function nameOf(node: ts.PropertyName | ts.BindingName): string | undefined {
  if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
  return undefined;
}

/** Scan one source text. Exported so the tests can drive it on a string. */
export function findViolations(rel: string, source: string): Violation[] {
  const sourceFile = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: Violation[] = [];

  const record = (node: ts.Node, rule: ViolationRule, text: string): void => {
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    violations.push({ file: rel, line: line + 1, column: character + 1, rule, text, hint: HINTS[rule] });
  };

  const visit = (node: ts.Node): void => {
    // 1 + 4. String literals: a model id, or a superseded settings key.
    if (ts.isStringLiteralLike(node)) {
      // An import/export specifier is a module path, never a model.
      const parent = node.parent;
      const isModuleSpecifier =
        (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node;
      // A TYPE cannot send anything to a provider. `type M = 'gpt-4o' | …` and
      // `interface X { model: 'gpt-4o' }` are exactly what an allow-list or the
      // admin screen will be made of, and noise is what gets a gate disabled
      // (SA finding 5).
      const isTypePosition = ts.isLiteralTypeNode(parent);
      if (!isModuleSpecifier && !isTypePosition) {
        if (isModelId(node.text)) record(node, 'model-literal', `'${node.text}'`);
        else if (SUPERSEDED_KEYS.has(node.text.trim())) record(node, 'superseded-key', `'${node.text}'`);
      }
    }

    // 2. A model-name catalogue.
    if (ts.isIdentifier(node) && MODEL_CONSTANT_IDENTIFIERS.has(node.text)) {
      const parent = node.parent;
      const isImportBinding =
        ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent);
      record(node, 'model-constant', isImportBinding ? `import ${node.text}` : node.text);
    }

    // 5. A model chosen by an environment variable, which no operator can change.
    if (ts.isPropertyAccessExpression(node) && /MODEL/i.test(node.name.text) && isProcessEnv(node.expression)) {
      record(node, 'env-model', node.getText(sourceFile));
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      /MODEL/i.test(node.argumentExpression.text) &&
      isProcessEnv(node.expression)
    ) {
      record(node, 'env-model', node.getText(sourceFile));
    }

    // 3. A number bound to a temperature.
    if (ts.isPropertyAssignment(node) && nameOf(node.name) === 'temperature') {
      if (numericLiteralOf(node.initializer)) {
        record(node, 'temperature', node.getText(sourceFile).replace(/\s+/g, ' '));
      }
    }
    // A variable, a default parameter, a class property or a DESTRUCTURING
    // DEFAULT named for a temperature, initialised to a number (SA finding 3,
    // QA D4-3). `const { temperature: temp = 0.4 } = settings` resolves the
    // settings and pins the value anyway, which is the shape §8.4 calls the one
    // worth reading twice.
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isBindingElement(node)) &&
      node.initializer
    ) {
      // For `{ temperature: temp = 0.4 }` the SOURCE key is `propertyName`; the
      // local alias may be called anything at all.
      const name =
        (ts.isBindingElement(node) && node.propertyName ? nameOf(node.propertyName) : undefined) ??
        nameOf(node.name);
      if (name && namesATemperature(name) && numericLiteralOf(node.initializer)) {
        record(node, 'temperature', node.getText(sourceFile).replace(/\s+/g, ' '));
      }
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      // `??` / `||` and their ASSIGNMENT forms `??=` / `||=`. The header
      // promised the first pair; `request.temperature ??= 0.8` is the same
      // hardcode in assignment clothing, and QA found it missing (D4-3).
      const isDefaulting =
        operator === ts.SyntaxKind.QuestionQuestionToken ||
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionEqualsToken ||
        operator === ts.SyntaxKind.BarBarEqualsToken;
      const isAssignment = operator === ts.SyntaxKind.EqualsToken;
      if ((isDefaulting || isAssignment) && mentionsTemperature(node.left) && numericLiteralOf(node.right)) {
        record(node, 'temperature', node.getText(sourceFile).replace(/\s+/g, ' '));
      }
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(sourceFile, visit);
  return violations;
}

export function scanFiles(files: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const rel of files) {
    if (EXEMPTIONS[rel]) continue;
    violations.push(...findViolations(rel, fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  }
  return violations;
}

/** The gate's scope, resolved through the compiler. Exported for the tests. */
export function scopedFiles(): string[] {
  const parsed = loadConfig();
  const files = projectFiles(parsed);
  return literalScope(buildImportGraph(files, parsed.options));
}

/**
 * Inclusions that name a file which is not in scope.
 *
 * Such an entry has silently become a no-op — and the file it was meant to
 * cover is now unchecked with a GREEN gate, which is the exact failure the
 * inclusion list exists to prevent. So it is a hard failure, not a warning:
 * rename or move the route and the gate stops, rather than quietly reverting
 * to not covering it.
 *
 * Exported for the gate's own test.
 */
export function staleInclusions(files: readonly string[]): string[] {
  const inScope = new Set(files);
  return LITERAL_SCOPE_INCLUSIONS.filter((entry) => !inScope.has(entry.file)).map((e) => e.file);
}

function main(): void {
  const started = Date.now();
  const args = new Set(process.argv.slice(2));
  const files = scopedFiles();

  const stale = staleInclusions(files);
  if (stale.length > 0) {
    console.error(
      'check-bos-llm-literals: FAILED. An entry in LITERAL_SCOPE_INCLUSIONS names a file that is not in scope:'
    );
    for (const file of stale) console.error(`  ${file}`);
    console.error('  It was moved, renamed or deleted, so the file it covered is no longer checked.');
    console.error('  Update the entry, or remove it if the file is genuinely gone.');
    process.exitCode = 1;
    return;
  }

  if (args.has('--list')) {
    // Inclusions are printed with their own marker, like exemptions: a file
    // that is in scope only because it was NAMED in should be as visible as a
    // file that is out of scope because it was named out.
    const included = new Set(LITERAL_SCOPE_INCLUSIONS.map((entry) => entry.file));
    for (const rel of files) {
      const marker = EXEMPTIONS[rel] ? 'exempt ' : included.has(rel) ? 'included' : 'checked';
      console.log(`${marker} ${rel}`);
    }
    console.log(
      `check-bos-llm-literals: ${files.length} files in scope, ${Object.keys(EXEMPTIONS).length} exempt, ${LITERAL_SCOPE_INCLUSIONS.length} included by name`
    );
    return;
  }

  const violations = scanFiles(files);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `check-bos-llm-literals: ${files.length} files in scope, ${Object.keys(EXEMPTIONS).length} exempt, ${violations.length} violations (${seconds}s)`
  );

  if (violations.length > 0) {
    console.error('check-bos-llm-literals: FAILED. A Business OS call site writes its own model or temperature:');
    for (const violation of violations) {
      console.error(`  ${violation.file}(${violation.line},${violation.column}): ${violation.rule}: ${violation.text}`);
      console.error(`    → ${violation.hint}`);
    }
    console.error(
      `  Exempt files (${Object.keys(EXEMPTIONS).length}), and why:`
    );
    for (const [file, reason] of Object.entries(EXEMPTIONS)) console.error(`    ${file} — ${reason}`);
    console.error('  Adding another exemption is a code change with an SA review, not a config line.');
    process.exit(1);
  }

  console.log('check-bos-llm-literals: passed');
}

if (require.main === module) main();

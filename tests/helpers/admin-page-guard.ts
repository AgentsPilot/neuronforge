/**
 * The ONE assertion over the server-side guard on all 22 `/admin` pages, and
 * the synthetic layouts that prove it.
 *
 * ── Why this is shared rather than written twice ───────────────────────────
 * Two suites assert this property:
 *
 *   * `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (rules R6 and R8)
 *     — the REQUIRED status check `Admin authz surface guard`, which blocks
 *     merges for the whole repository;
 *   * `app/admin/business-os-llm/__tests__/source.guard.test.ts` (S2-T1) — a
 *     screen-local suite that no CI gate runs.
 *
 * They had two different assertions over the same property, and the weaker one
 * was in the required check. That is not a coincidence, it is the mechanism:
 * **two copies of a security assertion drift, and the copy nobody watches is
 * the one that goes stale.** So the rule lives here once and both import it.
 *
 * ── The history of the rule, because the history IS the rule ───────────────
 * v1 read `app/admin/layout.tsx` RAW and looked for the substring
 * `await requireAdminPage()`. SA commented the call out: 114/114 green (F-1).
 *
 * v2 stripped comments and matched the call as a shape. QA disabled the guard
 * two more ways, still green at 115/115 (DEF-S2-1, DEF-S2-2):
 *
 *     try { await requireAdminPage(); } catch {}          // redirect swallowed
 *     if (…) return <AdminChrome>{children}</AdminChrome>; // guard bypassed
 *     await requireAdminPage();
 *
 * The first is the hazard `app/admin/layout.tsx` names in its OWN comment —
 * `requireAdminPage` redirects by THROWING, so a bare `catch` renders the admin
 * shell to a non-admin.
 *
 * v3 (slice 2) asserted the call is the **first statement of the component
 * body**, subsuming all four. SA found three more shapes that satisfied it,
 * green at 122/122: `process.env.X && (await requireAdminPage());`, the ternary
 * form, and a locally shadowed no-op.
 *
 * v4 anchored the first statement and required the canonical import. SA then
 * defeated THAT with a decoy component signature inside a **template literal**
 * above the real component, real call deleted: 92/92 green, `/admin` unguarded.
 * The cause was structural, not a missing pattern — the rule matched **one
 * signature regex against un-blanked text and took the first hit**.
 *
 * v5 — this module — parses instead of matching:
 *
 *   * strings and template literals are **blanked** first
 *     (`tests/helpers/source-scan.ts`), which is precisely what rule R1 already
 *     does for the same reason (D-Q1, `…guard.test.ts:1414`). One
 *     implementation, imported, not re-invented;
 *   * the component is found by **locating the DEFAULT EXPORT** — declaration,
 *     arrow, or `export default Name;` referring back to a declaration — rather
 *     than by matching one hand-written signature, which is what made three
 *     legitimate shapes report `null`;
 *   * the parameter list is paren-matched, so a **default-valued parameter**
 *     shadowing the guard is caught;
 *   * the statement ends at a `;` or newline **at depth 0**, so
 *     `const { userId } = await requireAdminPage();` is accepted rather than
 *     truncated at the destructuring brace.
 *
 * ── What this still is NOT ─────────────────────────────────────────────────
 * Behavioural. SA's standing ruling, recorded verbatim so a sixth round is a
 * deliberate choice and not a reflex:
 *
 *   "the property that matters is behavioural, not textual — one test that
 *    renders `AdminLayout` as a non-admin and asserts the redirect, which is
 *    immune to all five known mutations AND to these three, and does not care
 *    how the call is written."
 *
 * That remains the durable fix and is tracked with OI-20. This module exists
 * because F-2 needed the REQUIRED gate raised to the level the screen-local
 * suite had already reached, which is a far smaller change than introducing a
 * rendering test into a pure static-scan suite that gates every merge.
 *
 * ── Why the comment stripper is a PARAMETER ────────────────────────────────
 * Not a convenience. On RAW source the `//`-commented mutation PASSES: the
 * comment `// DISABLED: await requireAdminPage();` carries its own `;`, so the
 * first "statement" is the comment and it matches. A defaulted stripper would
 * let a future caller omit it and be silently wrong, so there is no default —
 * the signature makes the unsafe call unrepresentable. Each caller passes the
 * stripper its own suite already unit-tests (`stripComments` in the surface
 * guard, `codeOf` in the screen suite).
 *
 * ── Known limit, stated rather than discovered ─────────────────────────────
 * A return-type annotation is skipped by tracking ANGLE-bracket depth, so
 * `): Promise<React.ReactElement> {` and `): JSX.Element {` parse correctly. A
 * **bare object-literal return type** — `): { a: string } {` — would be
 * mis-read as the body. No React component in this repo is written that way,
 * and the consequence is a FALSE POSITIVE (a failing assertion on correct
 * code), whose message says exactly that and points here. That is the safe
 * direction, and the fix is to extend this parser, never to weaken the rule.
 *
 * ── Known limits, recorded and deliberately not chased ────────────────────
 * **An ALIASED import is rejected** (QA D8): with
 * `import { requireAdminPage as guard }` the first statement reads
 * `await guard()`, which is not the anchored shape. No admin file is written
 * that way; the failure carries the parser hatch, so it reads as a limit rather
 * than as a verdict on the author.
 *
 * ── Shapes that FAIL CLOSED, recorded and deliberately not chased ──────────
 * `export { AdminLayout as default }` and a semicolon-less
 * `export default AdminLayout` both report `parsed: false`. That is the CORRECT
 * outcome — the rule cannot prove the guard runs, so it fails, and
 * `ADMIN_LAYOUT_UNPARSEABLE` tells the reader it is probably a parser gap rather
 * than their bug. Neither shape is used in this repo. They are written down so
 * the next person recognises the failure instead of rediscovering it.
 *
 * ── 🛑 STOP HARDENING THIS PARSER. READ THIS FIRST. ────────────────────────
 * This is v6. Round 4 opened a decoy SIGNATURE in a template literal; round 5
 * opened a decoy IMPORT in a template literal. Each round closed a real hole and
 * each round created a false positive that had to be fixed in the next one.
 *
 * **SA's conclusion, as the finding of record: the durable fix is BEHAVIOURAL —
 * one test that renders `AdminLayout` as a non-admin and asserts the redirect.**
 * It is immune to every shape in `DISABLED_ADMIN_LAYOUTS`, to the eleventh, and
 * to the twelfth nobody has thought of yet, and it does not care how the call is
 * written. **That test should LEAD the parked admin-authz work — not a v7 of
 * this parser.** If you are here because you found a twelfth shape: write the
 * rendering test instead.
 *
 * @see docs/workplans/ADMIN_GUARD_HARDENING_AND_LINT_WORKPLAN.md
 * @see docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md
 */

import { blankStringLiterals, literalSpanAt } from '@/tests/helpers/source-scan';

/** Removes TypeScript comments. Supplied by the caller; see the header. */
export type CommentStripper = (source: string) => string;

/** The canonical module the real `requireAdminPage` comes from. */
export const CANONICAL_GUARD_MODULE = '@/lib/admin/requireAdminPage';

/**
 * The whole first statement, ANCHORED — the guard call and nothing else.
 *
 * Anchoring rejects SA's `&&` and ternary shapes: both CONTAIN the call, and in
 * both the call is skippable at runtime. A guard that runs only when an
 * environment variable says so is not a guard.
 *
 * The optional binding prefix is deliberate, not laxity. `requireAdminPage()`
 * RETURNS the admin's identity, so all three of these are correct code:
 *
 *     await requireAdminPage();
 *     const admin = await requireAdminPage();
 *     const { userId } = await requireAdminPage();
 *
 * This assertion sits in a required status check. Rejecting a correct change
 * would turn `main` red for everyone and is the single likeliest way to get the
 * check switched off.
 */
export const FIRST_STATEMENT_IS_THE_GUARD =
  /^(?:(?:const|let|var)\s+[A-Za-z0-9_$\s,:{}[\]]+=\s*)?await\s+requireAdminPage\s*\(\s*\)$/;

/** Constructs whose first statement is the construct, not the call inside it. */
const BLOCK_STATEMENT_HEAD = /^(?:try|if|for|while|do|switch|else|with)\b|^\{/;

/** `'use client'` as the first thing in the file, once comments are gone. */
const USE_CLIENT_DIRECTIVE = /^\s*['"]use client['"]/;

/**
 * Is this a client component?
 *
 * **Reads STRIPPED source.** Against raw source, a block comment one of whose
 * lines begins with `'use client'` — entirely plausible prose in a file that
 * explains why it is NOT a client component — makes this true and fails R6 on a
 * correct file.
 *
 * Also anchored to the START of the file rather than to any line, because that
 * is where the directive is meaningful: a `'use client'` string halfway down a
 * module is not a directive.
 */
export function isClientComponent(source: string, strip: CommentStripper): boolean {
  return USE_CLIENT_DIRECTIVE.test(strip(source));
}

/** Index of the character matching the opener at `open`, or -1. */
function matchDelimiter(scaffold: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const opener = scaffold[open];
  const closer = pairs[opener];
  if (!closer) return -1;

  let depth = 0;
  for (let i = open; i < scaffold.length; i++) {
    const c = scaffold[i];
    if (c === opener) depth++;
    else if (c === closer) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * From just after a parameter list's `)`, the index of the `{` that opens the
 * body — skipping an optional return-type annotation. See "Known limit".
 */
function bodyBraceAfterParams(scaffold: string, afterParams: number): number {
  let angle = 0;
  for (let i = afterParams; i < scaffold.length; i++) {
    const c = scaffold[i];
    if (c === '<') angle++;
    else if (c === '>' && angle > 0) angle--;
    else if (c === '{' && angle === 0) return i;
    else if (c === ';' && angle === 0) return -1; // a declaration, not a definition
  }
  return -1;
}

export interface ParsedComponent {
  /** The parameter list source, parens excluded. */
  parameters: string;
  /** The first statement of the body, comments stripped. `''` for an empty body. */
  firstStatement: string;
}

/**
 * Where the default-exported component's signature begins.
 *
 * Four shapes, all of them legitimate App Router code:
 *   export default async function Name(…)        — what the repo writes today
 *   export default async (…) => …                — anonymous arrow
 *   export default Name;  + function Name(…)     — declared, then exported
 *   export default Name;  + const Name = (…) =>  — arrow, then exported
 */
function locateComponent(scaffold: string): { from: number; isArrow: boolean } | null {
  const fnDefault = /export\s+default\s+(?:async\s+)?function\b/.exec(scaffold);
  if (fnDefault) return { from: fnDefault.index + fnDefault[0].length, isArrow: false };

  const arrowDefault = /export\s+default\s+(?:async\s*)?\(/.exec(scaffold);
  if (arrowDefault) return { from: arrowDefault.index + arrowDefault[0].length - 1, isArrow: true };

  /*
   * `export default Name;` and `export { Name as default };` are the same
   * declaration seen from two angles, and QA found the second one rejected on a
   * CORRECT self-guarding page (D4). The semicolon is optional in both, because
   * ASI makes it optional in the language.
   */
  const named =
    /export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/.exec(scaffold) ??
    /export\s*\{[^}]*?([A-Za-z_$][\w$]*)\s+as\s+default[^}]*\}/.exec(scaffold);
  if (!named) return null;
  const name = named[1];

  const declared = new RegExp(
    String.raw`(?:export\s+)?(?:async\s+)?function\s+${name}\s*\(`
  ).exec(scaffold);
  if (declared) return { from: declared.index + declared[0].length - 1, isArrow: false };

  const assigned = new RegExp(
    String.raw`(?:export\s+)?(?:const|let|var)\s+${name}\s*(?::[^=\n]*)?=\s*(?:async\s*)?(?:function\s*)?\(`
  ).exec(scaffold);
  if (assigned) {
    const isArrow = !/function\s*\($/.test(assigned[0]);
    return { from: assigned.index + assigned[0].length - 1, isArrow };
  }

  return null;
}

/**
 * The first statement of a body, given the index just after its `{`.
 *
 * A block-introducing keyword IS the first statement — which is how a guard
 * wrapped in `try/catch` is caught: the statement is `try`, not the call inside
 * it. Everything else runs to the first `;` **or newline** at depth 0, so
 * destructuring braces and multi-line calls stay inside one statement and a
 * semicolon-less call (ASI) is still read as a complete statement.
 */
function firstStatementOfBody(scaffold: string, code: string, from: number): string {
  let i = from;
  while (i < scaffold.length && /\s/.test(scaffold[i])) i++;

  const head = BLOCK_STATEMENT_HEAD.exec(code.slice(i));
  if (head) return head[0];

  let depth = 0;
  for (let j = i; j < scaffold.length; j++) {
    const c = scaffold[j];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '}') {
      // Depth 0 here is the component's own closing brace: an empty body.
      if (depth === 0) return code.slice(i, j).trim();
      depth--;
    } else if (depth === 0 && c === ';') {
      return code.slice(i, j).trim();
    } else if (depth === 0 && c === '\n' && !continuesOntoNextLine(code.slice(i, j))) {
      /*
       * A newline ends the statement only when the statement is COMPLETE (ASI).
       *
       * M2: without the completeness test this truncated hand-wrapped correct
       * code — `const { userId, email } =` / newline / `await requireAdminPage();`
       * became `const { userId, email } =` and FAILED on the real file. There is
       * no Prettier config in this repo, so line breaks are hand-chosen and a
       * rule that depends on where someone pressed Enter is exactly how a
       * required check dies.
       */
      return code.slice(i, j).trim();
    }
  }

  return code.slice(i).trim();
}

/**
 * Locate the module's DEFAULT-EXPORTED function component and return its
 * parameter list and first statement.
 *
 * `null` means "could not find a default-exported component at all", which is
 * itself a FAILURE for every caller — a silent `''` would make the assertion
 * vacuous, the exact defect class this file exists to close. It is also the one
 * outcome more likely to be a bug in THIS PARSER than in the file under test,
 * so callers must say so in their failure message.
 *
 * Name-agnostic on purpose: which identifier the component happens to use is not
 * a security property, and pinning it is what made the arrow form and the
 * `export default AdminLayout;` form report `null`.
 */
export function parseDefaultExportedComponent(
  source: string,
  strip: CommentStripper
): ParsedComponent | null {
  const code = strip(source);
  // Offsets are computed on the blanked scaffold and sliced from `code`;
  // blanking preserves length, so the two are interchangeable.
  const scaffold = blankStringLiterals(code);

  const start = locateComponent(scaffold);
  if (!start) return null;

  const paramsOpen = scaffold.indexOf('(', start.from);
  if (paramsOpen === -1) return null;
  const paramsClose = matchDelimiter(scaffold, paramsOpen);
  if (paramsClose === -1) return null;

  let cursor = paramsClose + 1;
  if (start.isArrow) {
    const arrow = scaffold.indexOf('=>', cursor);
    if (arrow === -1) return null;
    cursor = arrow + 2;
  }

  const bodyOpen = bodyBraceAfterParams(scaffold, cursor);
  if (bodyOpen === -1) return null;

  return {
    parameters: code.slice(paramsOpen + 1, paramsClose),
    firstStatement: firstStatementOfBody(scaffold, code, bodyOpen + 1),
  };
}

/**
 * Does the text so far END mid-expression, so the newline cannot terminate it?
 *
 * Deliberately narrow: a trailing operator, `await`, or an open comma list. ASI
 * itself is the default — a newline after a complete expression DOES end the
 * statement, which is what makes the semicolon-less form work.
 */
function continuesOntoNextLine(soFar: string): boolean {
  return /(?:=>|&&|\|\||\?\?|[=+\-*/%&|^!<>,.?:])\s*$|\b(?:await|new|typeof|return|in|of|instanceof)\s*$/.test(
    soFar
  );
}

/** The first statement of the default-exported component, or `null`. */
export function firstStatementOfAdminLayout(
  source: string,
  strip: CommentStripper
): string | null {
  return parseDefaultExportedComponent(source, strip)?.firstStatement ?? null;
}

/**
 * A local binding that shadows the imported guard — including a **default-valued
 * parameter** `requireAdminPage = async () => {}`, where the first statement
 * reads exactly right and calls nothing.
 */
export function declaresLocalGuard(source: string, strip: CommentStripper): boolean {
  const scaffold = blankStringLiterals(strip(source));

  if (
    /^[ \t]*(?:export\s+)?(?:const|let|var|function|async\s+function)\s+requireAdminPage\b/m.test(
      scaffold
    )
  ) {
    return true;
  }

  const parsed = parseDefaultExportedComponent(source, strip);
  if (parsed === null) return false;

  /*
   * D9: `typeof requireAdminPage` inside a parameter's TYPE is a reference, not a
   * binding — `{ guard }: { guard: typeof requireAdminPage }` shadows nothing, and
   * reading it as a shadow failed a correct file. Type-only references are removed
   * before the binding test; a real default-valued parameter survives it.
   */
  const params = blankStringLiterals(parsed.parameters).replace(/\btypeof\s+requireAdminPage\b/g, '');
  return /\brequireAdminPage\b/.test(params);
}

/**
 * The local name `requireAdminPage` is bound by EXACTLY ONE import, and that
 * import's module specifier is the canonical one.
 *
 * ── SA's eleventh shape, and why this is not a regex ────────────────────────
 * This predicate was the last one still reading UNBLANKED source. SA imported
 * the guard from `@/lib/admin/requireAdminPage.noop` and put the canonical
 * import statement inside a template literal: the regex found the decoy, and the
 * required check reported **103/103 green on the real `app/admin/layout.tsx`
 * with the guard a no-op**. That is D-Q1 for the third time.
 *
 * So it now uses the contract the parser already uses: decide on the BLANKED
 * SCAFFOLD that an `import … from` statement is real code, then read its module
 * specifier out of the ORIGINAL text by offset (`literalSpanAt`). An import
 * inside a template literal is blanked and therefore invisible; a real import of
 * a lookalike module is visible and its specifier is compared exactly.
 *
 * "Exactly one" is deliberate rather than "at least one": two imports binding the
 * same local name is a TypeScript error, so requiring uniqueness costs nothing
 * on correct code and removes the shape where a canonical import sits beside a
 * no-op one purely to satisfy this check.
 */
export function importsCanonicalGuard(source: string, strip: CommentStripper): boolean {
  const code = strip(source);
  const scaffold = blankStringLiterals(code);
  const specifiers: string[] = [];

  // `import` statements, located on the scaffold so a decoy inside a string
  // literal is not one.
  const importRe = /\bimport\s*\{([^}]*)\}\s*from\s*/g;
  let match: RegExpExecArray | null;

  while ((match = importRe.exec(scaffold)) !== null) {
    const bindings = code.slice(match.index + match[0].indexOf('{') + 1, importRe.lastIndex - (match[0].length - match[0].indexOf('}')));
    if (!bindsGuardLocally(bindings)) continue;

    const span = literalSpanAt(scaffold, importRe.lastIndex);
    if (!span) continue; // not a real `from '…'` — cannot be the canonical import
    specifiers.push(code.slice(span.open + 1, span.close));
  }

  return specifiers.length === 1 && specifiers[0] === CANONICAL_GUARD_MODULE;
}

/**
 * Does this named-binding list introduce the LOCAL name `requireAdminPage`?
 *
 * `{ requireAdminPage }` does. `{ x as requireAdminPage }` does. And
 * `{ requireAdminPage as somethingElse }` does NOT — the local name is the alias,
 * so the body's `requireAdminPage` would be unbound (or bound by something else,
 * which `declaresLocalGuard` covers).
 */
function bindsGuardLocally(bindings: string): boolean {
  return bindings.split(',').some((entry) => {
    const parts = entry.trim().split(/\s+as\s+/);
    const local = (parts.length > 1 ? parts[1] : parts[0]).trim();
    return local === 'requireAdminPage';
  });
}

export interface AdminLayoutGuardVerdict {
  /** The first statement, or `null` if no default-exported component was found. */
  firstStatement: string | null;
  /** A default-exported component was located at all. `false` implies a parser bug. */
  parsed: boolean;
  /** The first statement IS the guard call (anchored). */
  firstStatementIsTheGuard: boolean;
  /** `requireAdminPage` is imported from the canonical module. */
  importsCanonicalGuard: boolean;
  /** A local binding — declaration or default-valued parameter — shadows it. */
  shadowsTheGuard: boolean;
  /** The conjunction — the property R6 and S2-T1 both assert. */
  guarded: boolean;
}

export function adminLayoutGuardVerdict(
  source: string,
  strip: CommentStripper
): AdminLayoutGuardVerdict {
  const parsed = parseDefaultExportedComponent(source, strip);
  const firstStatement = parsed?.firstStatement ?? null;
  const firstStatementIsTheGuard =
    firstStatement !== null && FIRST_STATEMENT_IS_THE_GUARD.test(firstStatement);
  const imported = importsCanonicalGuard(source, strip);
  const shadowed = declaresLocalGuard(source, strip);

  return {
    firstStatement,
    parsed: parsed !== null,
    firstStatementIsTheGuard,
    importsCanonicalGuard: imported,
    shadowsTheGuard: shadowed,
    guarded: firstStatementIsTheGuard && imported && !shadowed,
  };
}

/**
 * Does this file guard ITSELF, first thing, in its own render?
 *
 * Used by R8 to accept the one server-rendered shape that is **immune** to the
 * OI-21 header bypass: a page whose own component awaits the guard cannot be
 * rendered past it, because nothing about the bypass skips the PAGE's render —
 * only the cached `/admin` layout segment. Forbidding it would make the rule
 * reject the safest thing an author could write.
 */
export function guardsItselfFirst(source: string, strip: CommentStripper): boolean {
  return adminLayoutGuardVerdict(source, strip).guarded;
}

// ───────────────────────────────────────────────────────────────────────────
// Failure messages. Whoever trips these is, by construction, editing a guard.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Shown when the file was parsed and is genuinely not guarded.
 *
 * It closes with the false-positive escape hatch ON PURPOSE. The previous
 * version said only *"do not relax this assertion… fix the layout"*, which is
 * the WRONG INSTRUCTION on a correct file — and SA found three correct files it
 * rejected. Telling an author with correct code that their code is broken is the
 * likeliest route to someone deleting the assertion.
 */
export const ADMIN_LAYOUT_GUARD_FAILURE =
  'app/admin/layout.tsx must open with `await requireAdminPage();` as the FIRST ' +
  'statement of its body, imported from ' +
  CANONICAL_GUARD_MODULE +
  '. IF YOU BELIEVE THE FILE IS CORRECT, this may be a FALSE POSITIVE in the ' +
  'assertion rather than a fault in your code: the parser lives in ' +
  'tests/helpers/admin-page-guard.ts, it documents its limits, and the fix is to ' +
  'extend it and add your shape to GUARDED_ADMIN_LAYOUTS — never to weaken or delete ' +
  'the rule, and never to exempt the file. ' +
  'Why it is asserted this strictly: this is the only server-side check on all 22 ' +
  '/admin pages, and a call that is commented out, wrapped in try/catch (the redirect ' +
  'is a THROW, so `catch` renders the admin shell to a non-admin), placed after an ' +
  'early return, made conditional on an env var, shadowed by a local no-op or by a ' +
  'default-valued parameter, or decoyed inside a template literal — as either the ' +
  'signature or the import — all leave the file LOOKING guarded.';

/** Shown when no default-exported component could be found at all. */
export const ADMIN_LAYOUT_UNPARSEABLE =
  'The guard assertion could not find a default-exported component in this file, so it ' +
  'CANNOT prove the page guard runs and therefore fails closed. This outcome is more ' +
  'likely to be a BUG IN THE ASSERTION than in your file: if the component is written ' +
  'in a shape the parser does not recognise (an exotic return type, a higher-order ' +
  'wrapper, a re-export), extend parseDefaultExportedComponent in ' +
  'tests/helpers/admin-page-guard.ts and add the shape to GUARDED_ADMIN_LAYOUTS. Never ' +
  'satisfy it by deleting the assertion.';

// ───────────────────────────────────────────────────────────────────────────
// Synthetic layouts. A rule is only proved by the inputs it must REJECT — and,
// just as importantly, by the correct inputs it must ACCEPT.
// ───────────────────────────────────────────────────────────────────────────

const RENDER = '  return <AdminChrome>{children}</AdminChrome>;';
const IMPORTS =
  `import { requireAdminPage } from '${CANONICAL_GUARD_MODULE}';\n` +
  `import AdminChrome from './components/AdminChrome';\n\n`;

/** A whole plausible `app/admin/layout.tsx` around a given body. */
export function adminLayoutWith(body: string): string {
  return (
    IMPORTS +
    'export default async function AdminLayout({\n' +
    '  children,\n' +
    '}: {\n' +
    '  children: React.ReactNode;\n' +
    `}) {\n${body}\n}\n`
  );
}

/**
 * Every way we know of to disable the guard while leaving the file looking
 * guarded: the five from F-1 / DEF-S2-1 / DEF-S2-2, SA's three from the slice-2
 * re-check, and SA's two from the review of this branch. Each must be REJECTED.
 */
export const DISABLED_ADMIN_LAYOUTS: ReadonlyArray<{
  readonly name: string;
  readonly source: string;
  /** Which part of the verdict catches it — asserted, so a sub-rule cannot go dead. */
  readonly caughtBy: 'firstStatementIsTheGuard' | 'shadowsTheGuard' | 'importsCanonicalGuard';
}> = [
  {
    name: 'deleted',
    source: adminLayoutWith(RENDER),
    caughtBy: 'firstStatementIsTheGuard',
  },
  {
    name: 'commented out with //',
    source: adminLayoutWith(
      '  // TEMPORARILY DISABLED FOR DEBUGGING: await requireAdminPage();\n' + RENDER
    ),
    caughtBy: 'firstStatementIsTheGuard',
  },
  {
    name: 'commented out with a block comment',
    source: adminLayoutWith('  /* await requireAdminPage(); */\n' + RENDER),
    caughtBy: 'firstStatementIsTheGuard',
  },
  {
    name: 'wrapped in try/catch, so the redirect is swallowed',
    source: adminLayoutWith('  try { await requireAdminPage(); } catch {}\n' + RENDER),
    caughtBy: 'firstStatementIsTheGuard',
  },
  {
    name: 'preceded by an early return, so the guard is unreachable',
    source: adminLayoutWith(
      "  if (process.env.NODE_ENV === 'development') return <AdminChrome>{children}</AdminChrome>;\n" +
        '  await requireAdminPage();\n' +
        RENDER
    ),
    caughtBy: 'firstStatementIsTheGuard',
  },
  {
    name: 'made conditional with && (SA, slice-2 re-check)',
    source: adminLayoutWith(
      '  process.env.SKIP_ADMIN_GUARD && (await requireAdminPage());\n' + RENDER
    ),
    caughtBy: 'firstStatementIsTheGuard',
  },
  {
    name: 'made conditional with a ternary (SA, slice-2 re-check)',
    source: adminLayoutWith(
      '  process.env.SKIP_ADMIN_GUARD ? undefined : await requireAdminPage();\n' + RENDER
    ),
    caughtBy: 'firstStatementIsTheGuard',
  },
  {
    name: 'shadowed by a local no-op (SA, slice-2 re-check)',
    source:
      `import AdminChrome from './components/AdminChrome';\n\n` +
      'const requireAdminPage = async () => {};\n\n' +
      'export default async function AdminLayout({\n' +
      '  children,\n' +
      '}: {\n' +
      '  children: React.ReactNode;\n' +
      `}) {\n  await requireAdminPage();\n${RENDER}\n}\n`,
    caughtBy: 'shadowsTheGuard',
  },
  {
    /*
     * SA's ninth shape, and the reason v5 parses a blanked scaffold. A decoy
     * signature inside a TEMPLATE LITERAL above the real component: v4 took the
     * first regex hit, read the decoy's body, and reported the guard present
     * while the real component had none. 92/92 green, /admin unguarded.
     *
     * This is rule R1's D-Q1 one file over, which is why the fix is R1's fix.
     */
    name: 'decoyed by a signature inside a template literal, real call deleted (SA, branch review)',
    source:
      IMPORTS +
      'const CODE_SAMPLE = `\n' +
      'export default async function AdminLayout({ children }: { children: React.ReactNode }) {\n' +
      '  await requireAdminPage();\n' +
      '  return <AdminChrome>{children}</AdminChrome>;\n' +
      '}\n' +
      '`;\n\n' +
      'export default async function AdminLayout({\n' +
      '  children,\n' +
      '}: {\n' +
      '  children: React.ReactNode;\n' +
      `}) {\n${RENDER}\n}\n`,
    caughtBy: 'firstStatementIsTheGuard',
  },
  {
    /* SA's tenth shape: the call is real, the callee is a no-op parameter. */
    name: 'shadowed by a default-valued parameter (SA, branch review)',
    source:
      IMPORTS +
      'export default async function AdminLayout({\n' +
      '  children,\n' +
      '}: {\n' +
      '  children: React.ReactNode;\n' +
      '}, requireAdminPage = async () => {}) {\n' +
      '  await requireAdminPage();\n' +
      `${RENDER}\n}\n`,
    caughtBy: 'shadowsTheGuard',
  },
  {
    /*
     * SA's ELEVENTH shape. `importsCanonicalGuard` was the last predicate still
     * reading unblanked source, so the guard could be imported from a no-op
     * module while a template literal carried the canonical import text:
     * 103/103 green on the real file with the guard a no-op.
     */
    name: 'imported from a look-alike module, canonical import decoyed in a template literal (SA, re-check)',
    source:
      "import { requireAdminPage } from '@/lib/admin/requireAdminPage.noop';\n" +
      `import AdminChrome from './components/AdminChrome';\n\n` +
      'const MIGRATION_NOTE = `\n' +
      "import { requireAdminPage } from '@/lib/admin/requireAdminPage';\n" +
      '`;\n\n' +
      'export default async function AdminLayout({\n' +
      '  children,\n' +
      '}: {\n' +
      '  children: React.ReactNode;\n' +
      `}) {\n  await requireAdminPage();\n${RENDER}\n}\n`,
    caughtBy: 'importsCanonicalGuard',
  },
  {
    /*
     * The second-order half of SA's re-check: a NESTED template literal, which
     * defeats a naive single-regex scaffold because the template branch stops at
     * the first inner backtick. `blankStringLiterals` is a scanner for this
     * reason.
     */
    name: 'the same decoy inside a NESTED template literal (SA, re-check, second order)',
    source:
      "import { requireAdminPage } from '@/lib/admin/requireAdminPage.noop';\n" +
      `import AdminChrome from './components/AdminChrome';\n\n` +
      'const DOC = `outer ${`inner`} ' +
      "import { requireAdminPage } from '@/lib/admin/requireAdminPage';" +
      ' `;\n\n' +
      'export default async function AdminLayout({\n' +
      '  children,\n' +
      '}: {\n' +
      '  children: React.ReactNode;\n' +
      `}) {\n  await requireAdminPage();\n${RENDER}\n}\n`,
    caughtBy: 'importsCanonicalGuard',
  },
];

/**
 * Shapes that must be ACCEPTED, every one of them correct App Router code.
 *
 * This half is not symmetry for its own sake. A rule that rejects a CORRECT
 * layout turns `main` red for every PR in the repo, and the cheapest way out is
 * to switch the check off — so a false positive is worse than the hole it
 * closes. Three of these (the return-type annotation, the arrow form and the
 * named-then-default-export form) were rejected by v4 and found by SA.
 */
export const GUARDED_ADMIN_LAYOUTS: ReadonlyArray<{
  readonly name: string;
  readonly source: string;
}> = [
  {
    name: 'the canonical call',
    source: adminLayoutWith('  await requireAdminPage();\n' + RENDER),
  },
  {
    name: 'the identity captured, which the function supports',
    source: adminLayoutWith('  const admin = await requireAdminPage();\n' + RENDER),
  },
  {
    name: 'the identity DESTRUCTURED (SA, branch review)',
    source: adminLayoutWith('  const { id } = await requireAdminPage();\n' + RENDER),
  },
  {
    name: 'a doc comment above the call, as the real file has',
    source: adminLayoutWith(
      '  // Deliberately NOT wrapped in try/catch: requireAdminPage redirects by\n' +
        '  // throwing, and swallowing that would render the shell to a non-admin.\n' +
        '  await requireAdminPage();\n' +
        RENDER
    ),
  },
  {
    name: 'no semicolon, relying on ASI',
    source: adminLayoutWith('  await requireAdminPage()\n' + RENDER),
  },
  {
    /*
     * M2. There is no Prettier config in this repo, so line breaks are hand
     * chosen — and a rule that depends on where someone pressed Enter is exactly
     * how a required check dies.
     */
    name: 'the binding hand-wrapped across a line break (SA, re-check — M2)',
    source: adminLayoutWith(
      '  const { userId, email } =\n    await requireAdminPage();\n' + RENDER
    ),
  },
  {
    name: 'a return-type annotation (SA, branch review)',
    source:
      IMPORTS +
      'export default async function AdminLayout({\n' +
      '  children,\n' +
      '}: {\n' +
      '  children: React.ReactNode;\n' +
      '}): Promise<React.ReactElement> {\n' +
      '  await requireAdminPage();\n' +
      `${RENDER}\n}\n`,
  },
  {
    name: 'an arrow component, exported below (SA, branch review)',
    source:
      IMPORTS +
      'const AdminLayout = async ({ children }: { children: React.ReactNode }) => {\n' +
      '  await requireAdminPage();\n' +
      `${RENDER}\n};\n\nexport default AdminLayout;\n`,
  },
  {
    name: 'a named function, exported below (SA, branch review)',
    source:
      IMPORTS +
      'export async function AdminLayout({ children }: { children: React.ReactNode }) {\n' +
      '  await requireAdminPage();\n' +
      `${RENDER}\n}\n\nexport default AdminLayout;\n`,
  },
];

/**
 * A block comment one of whose lines begins with `'use client'` — plausible
 * prose in a file explaining why it is NOT a client component. Against RAW
 * source this made `isClient` true and failed R6 on a correct file.
 */
export const SERVER_LAYOUT_WITH_USE_CLIENT_IN_A_COMMENT =
  '/*\n' +
  " * 'use client' must NOT be added here: this layout awaits the admin gate,\n" +
  ' * and a client component cannot await anything.\n' +
  ' */\n' +
  IMPORTS +
  'export default async function AdminLayout({\n' +
  '  children,\n' +
  '}: {\n' +
  '  children: React.ReactNode;\n' +
  `}) {\n  await requireAdminPage();\n${RENDER}\n}\n`;

/** A file with no default export at all — genuinely unparseable, must be `null`. */
export const NOT_A_COMPONENT = "export const metadata = { title: 'admin' };\n";

/**
 * A SERVER page that guards itself — the one server-rendered shape R8 must
 * ACCEPT, because it is immune to the OI-21 bypass: the header skips the cached
 * `/admin` layout segment, not the page's own render.
 */
export const SELF_GUARDING_SERVER_PAGE =
  `import { requireAdminPage } from '${CANONICAL_GUARD_MODULE}';\n\n` +
  'export default async function ProbePage() {\n' +
  '  await requireAdminPage();\n' +
  '  return <main>admin only</main>;\n' +
  '}\n';

/**
 * The corpus may only GROW. Co-locating the rule with its mutation corpus means
 * a future edit could quietly delete the fixtures that give the rule its
 * meaning, leaving a green suite that proves nothing — so the counts are
 * asserted, in the same spirit as the guard's exemption caps.
 */
export const CORPUS_FLOORS = { disabled: 12, guarded: 9 } as const;

/**
 * D10: a floor counting ENTRIES can be satisfied by pasting one fixture twice.
 * Distinctness is the property that actually matters, so the suites assert the
 * count of unique sources, not the length of the array.
 */
export function distinctSources(corpus: ReadonlyArray<{ source: string }>): number {
  return new Set(corpus.map((entry) => entry.source)).size;
}

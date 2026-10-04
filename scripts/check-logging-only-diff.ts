/**
 * check-logging-only-diff — proves that a `console.*` → Pino conversion changed
 * logging and nothing else.
 *
 * WHY THIS EXISTS
 *
 * CLAUDE.md rule 3 makes every touched file that still uses `console.*` a
 * conversion. Some of those files move money (the Stripe webhook is 2,700+
 * lines), and a reviewer reading a 300-hunk diff will not reliably spot the one
 * hunk that also dropped a `return` or moved a brace. This check makes that
 * mechanical: both versions of the file are parsed, logging is normalised away
 * on both sides, and what is left must print identically.
 *
 * WHAT IS NORMALISED (identically on both sides)
 *
 *   - every call to `console.<anything>(…)` or `<log|logger>.<info|warn|error|
 *     debug|trace|fatal>(…)` becomes the placeholder `__LOG__()`, wherever it
 *     sits (statement, arrow body, expression), its arguments dropped;
 *   - a parameter named `log` is removed, and an argument that is exactly the
 *     identifier `log` is removed from every call (the request logger threaded
 *     through handler signatures);
 *   - logger setup is removed: imports from `@/lib/logger`, variable statements
 *     that only declare `log` / `logger`, and assignments `log = …` / `logger = …`;
 *   - comments and formatting (the printer re-emits from the AST).
 *
 * WHAT IT PROVES: every token outside logging — control flow, DB calls, Stripe
 * calls, returns, status codes, response bodies — is identical.
 *
 * WHAT IT DOES NOT PROVE: that a log call's arguments are free of side effects.
 * It lists every call found inside log arguments and inside removed logger
 * setup, on both sides, and marks the ones outside a small pure allow-list
 * `REVIEW`, so a reviewer can confirm each by eye.
 *
 * SAFETY (SA condition P0-C3): if the BASE version already uses the identifiers
 * `log` or `logger` outside logging calls and logger setup, the normaliser would
 * erase real edits to them, so the check refuses to run (exit 2).
 *
 * USAGE
 *
 *   npx tsx scripts/check-logging-only-diff.ts --base origin/main --file app/api/stripe/webhook/route.ts
 *   npx tsx scripts/check-logging-only-diff.ts --base origin/main --file <path> --functions handleA,handleB
 *
 *   --base <ref>         git ref holding the version before the conversion (required)
 *   --file <path>        repo-relative file; the working-tree copy is the "after"
 *   --head <ref>         compare against a git ref instead of the working tree
 *   --functions a,b      compare only these top-level functions, one verdict each
 *                        (used to prove named functions are unchanged by a later
 *                        slice that edits the same file)
 *
 * Exit codes: 0 identical, 1 differs (or a named function is missing), 2 refused
 * or bad usage.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const LOGGER_NAMES = new Set(['log', 'logger']);
const LOG_METHODS = new Set(['info', 'warn', 'error', 'debug', 'trace', 'fatal']);
const LOGGER_MODULE = '@/lib/logger';

/**
 * Calls a reviewer can accept inside a log argument without reading further:
 * they read or format values already in hand and touch nothing else.
 */
const PURE_CALLEES = new Set([
  'String',
  'Number',
  'Boolean',
  'Object.keys',
  'keys',
  'map',
  'toFixed',
  'toLocaleString',
  'toUpperCase',
  'toLowerCase',
  'split',
  'slice',
  'join',
]);

export interface LogArgCall {
  /** Enclosing top-level function, or `<module>`. */
  scope: string;
  line: number;
  text: string;
  /** False when the callee is outside PURE_CALLEES and needs a human look. */
  isAllowListed: boolean;
}

export interface CompareResult {
  identical: boolean;
  /** Unified-style diff of the normalised text; empty when identical. */
  diff: string;
  baseLogCalls: number;
  headLogCalls: number;
  baseArgCalls: LogArgCall[];
  headArgCalls: LogArgCall[];
}

export interface FunctionVerdict {
  name: string;
  status: 'identical' | 'differs' | 'missing-in-base' | 'missing-in-head';
  diff: string;
}

/** `console.x(…)` or `log.info(…)` / `logger.error(…)` and the other levels. */
export function isLogCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false;
  const object = callee.expression.text;
  if (object === 'console') return true;
  return LOGGER_NAMES.has(object) && LOG_METHODS.has(callee.name.text);
}

function isLoggerImport(node: ts.Node): boolean {
  return (
    ts.isImportDeclaration(node) &&
    ts.isStringLiteral(node.moduleSpecifier) &&
    node.moduleSpecifier.text === LOGGER_MODULE
  );
}

/** `const logger = …`, `let log = …` — a statement declaring only logger names. */
function isLoggerDeclaration(node: ts.Node): boolean {
  if (!ts.isVariableStatement(node)) return false;
  const declarations = node.declarationList.declarations;
  return (
    declarations.length > 0 &&
    declarations.every((d) => ts.isIdentifier(d.name) && LOGGER_NAMES.has(d.name.text))
  );
}

/** `log = log.child(…)` as a statement. */
function isLoggerAssignment(node: ts.Node): boolean {
  return (
    ts.isExpressionStatement(node) &&
    ts.isBinaryExpression(node.expression) &&
    node.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.expression.left) &&
    LOGGER_NAMES.has(node.expression.left.text)
  );
}

function isLoggerSetup(node: ts.Node): boolean {
  return isLoggerImport(node) || isLoggerDeclaration(node) || isLoggerAssignment(node);
}

function parse(fileName: string, text: string): ts.SourceFile {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}

function topLevelName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isVariableStatement(node)) {
    const [d] = node.declarationList.declarations;
    if (
      d &&
      ts.isIdentifier(d.name) &&
      d.initializer &&
      (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))
    ) {
      return d.name.text;
    }
  }
  return null;
}

function enclosingScope(node: ts.Node): string {
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent)) current = current.parent;
  return topLevelName(current) ?? '<module>';
}

function calleeName(call: ts.CallExpression | ts.NewExpression): string {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) {
    if (ts.isIdentifier(e.expression) && e.expression.text === 'Object') return `Object.${e.name.text}`;
    return e.name.text;
  }
  return '<expression>';
}

/** Every call inside log arguments and inside logger setup, for human review. */
export function listCallsInLogging(sf: ts.SourceFile): LogArgCall[] {
  const out: LogArgCall[] = [];

  const collect = (root: ts.Node) => {
    const walk = (n: ts.Node) => {
      if ((ts.isCallExpression(n) || ts.isNewExpression(n)) && !isLogCall(n)) {
        const name = calleeName(n);
        out.push({
          scope: enclosingScope(n),
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          text: n.getText(sf).replace(/\s+/g, ' '),
          isAllowListed: PURE_CALLEES.has(name),
        });
      }
      ts.forEachChild(n, walk);
    };
    walk(root);
  };

  const visit = (n: ts.Node) => {
    if (isLogCall(n)) {
      n.arguments.forEach(collect);
      return;
    }
    if (isLoggerDeclaration(n) || isLoggerAssignment(n)) {
      // The setup line itself (`logger.child(…)`, `createLogger(…)`) is listed
      // too: it is removed by the normaliser, so it is only ever seen here.
      collect(n);
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * P0-C3: identifiers `log` / `logger` in the base, used as values outside
 * logging calls and logger setup. Any hit means the normaliser could hide a
 * real edit, so the check must refuse.
 */
export function findReservedIdentifierUses(sf: ts.SourceFile): Array<{ line: number; text: string }> {
  const hits: Array<{ line: number; text: string }> = [];

  const visit = (n: ts.Node) => {
    if (isLoggerSetup(n)) return;
    if (isLogCall(n)) {
      // The callee's `log`/`logger` is the logging itself; arguments are still
      // inspected, because `log.info(x, log)` would be a real use.
      n.arguments.forEach(visit);
      return;
    }
    if (ts.isIdentifier(n) && LOGGER_NAMES.has(n.text)) {
      const parent = n.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
        (ts.isPropertyAssignment(parent) && parent.name === n) ||
        (ts.isMethodDeclaration(parent) && parent.name === n) ||
        (ts.isPropertySignature(parent) && parent.name === n) ||
        (ts.isPropertyDeclaration(parent) && parent.name === n);
      if (!isPropertyName) {
        hits.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          text: parent.getText(sf).replace(/\s+/g, ' ').slice(0, 120),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

function isLogIdentifier(node: ts.Node): boolean {
  return ts.isIdentifier(node) && node.text === 'log';
}

const normaliser: ts.TransformerFactory<ts.SourceFile> = (context) => {
  const { factory } = context;

  const visit = (node: ts.Node): ts.Node | undefined => {
    if (isLoggerSetup(node)) return undefined;

    if (isLogCall(node)) {
      return factory.createCallExpression(factory.createIdentifier('__LOG__'), undefined, []);
    }

    if (ts.isParameter(node) && isLogIdentifier(node.name)) return undefined;

    const visited = ts.visitEachChild(node, visit, context);

    if (ts.isCallExpression(visited) && visited.arguments.some(isLogIdentifier)) {
      return factory.updateCallExpression(
        visited,
        visited.expression,
        visited.typeArguments,
        visited.arguments.filter((a) => !isLogIdentifier(a))
      );
    }
    if (ts.isNewExpression(visited) && visited.arguments?.some(isLogIdentifier)) {
      return factory.updateNewExpression(
        visited,
        visited.expression,
        visited.typeArguments,
        visited.arguments.filter((a) => !isLogIdentifier(a))
      );
    }
    return visited;
  };

  return (sf) => ts.visitNode(sf, visit) as ts.SourceFile;
};

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

function normalise(sf: ts.SourceFile): ts.SourceFile {
  const result = ts.transform(sf, [normaliser]);
  const out = result.transformed[0];
  return out;
}

export function normaliseSource(fileName: string, text: string): string {
  const sf = normalise(parse(fileName, text));
  return printer.printFile(sf);
}

function countLogCalls(sf: ts.SourceFile): number {
  let count = 0;
  const visit = (n: ts.Node) => {
    if (isLogCall(n)) count += 1;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return count;
}

/** Minimal line diff (LCS) so a failure shows exactly which statements moved. */
export function lineDiff(a: string, b: string): string {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  // Trim the common head and tail first; the LCS table only covers the middle.
  let start = 0;
  while (start < n && start < m && x[start] === y[start]) start += 1;
  let endX = n;
  let endY = m;
  while (endX > start && endY > start && x[endX - 1] === y[endY - 1]) {
    endX -= 1;
    endY -= 1;
  }
  const xs = x.slice(start, endX);
  const ys = y.slice(start, endY);
  if (xs.length === 0 && ys.length === 0) return '';

  const dp: number[][] = Array.from({ length: xs.length + 1 }, () => new Array(ys.length + 1).fill(0));
  for (let i = xs.length - 1; i >= 0; i -= 1) {
    for (let j = ys.length - 1; j >= 0; j -= 1) {
      dp[i][j] = xs[i] === ys[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const lines: string[] = [`@@ normalised line ${start + 1} @@`];
  let i = 0;
  let j = 0;
  while (i < xs.length && j < ys.length) {
    if (xs[i] === ys[j]) {
      lines.push(`  ${xs[i]}`);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push(`- ${xs[i]}`);
      i += 1;
    } else {
      lines.push(`+ ${ys[j]}`);
      j += 1;
    }
  }
  while (i < xs.length) lines.push(`- ${xs[i++]}`);
  while (j < ys.length) lines.push(`+ ${ys[j++]}`);
  return lines.join('\n');
}

export class RefusedError extends Error {}

function assertBaseIsSafe(baseSf: ts.SourceFile): void {
  const uses = findReservedIdentifierUses(baseSf);
  if (uses.length > 0) {
    const listing = uses.map((u) => `  line ${u.line}: ${u.text}`).join('\n');
    throw new RefusedError(
      'Refusing to compare: the base version already uses `log` / `logger` outside logging calls, ' +
        'so normalising them away could hide a real edit.\n' +
        listing
    );
  }
}

export function compareSources(fileName: string, baseText: string, headText: string): CompareResult {
  const baseSf = parse(fileName, baseText);
  const headSf = parse(fileName, headText);
  assertBaseIsSafe(baseSf);

  const base = printer.printFile(normalise(baseSf));
  const head = printer.printFile(normalise(headSf));
  return {
    identical: base === head,
    diff: base === head ? '' : lineDiff(base, head),
    baseLogCalls: countLogCalls(baseSf),
    headLogCalls: countLogCalls(headSf),
    baseArgCalls: listCallsInLogging(baseSf),
    headArgCalls: listCallsInLogging(headSf),
  };
}

function printedFunctions(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  const normalised = normalise(sf);
  for (const statement of normalised.statements) {
    const name = topLevelName(statement);
    if (name) out.set(name, printer.printNode(ts.EmitHint.Unspecified, statement, normalised));
  }
  return out;
}

/** `--functions` mode: one verdict per named top-level function. */
export function compareFunctions(
  fileName: string,
  baseText: string,
  headText: string,
  names: string[]
): FunctionVerdict[] {
  const baseSf = parse(fileName, baseText);
  assertBaseIsSafe(baseSf);
  const base = printedFunctions(baseSf);
  const head = printedFunctions(parse(fileName, headText));

  return names.map((name) => {
    const b = base.get(name);
    const h = head.get(name);
    if (b === undefined) return { name, status: 'missing-in-base', diff: '' };
    if (h === undefined) return { name, status: 'missing-in-head', diff: '' };
    return b === h
      ? { name, status: 'identical', diff: '' }
      : { name, status: 'differs', diff: lineDiff(b, h) };
  });
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function readArg(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function gitShow(ref: string, file: string): string {
  return execFileSync('git', ['show', `${ref}:${file}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function formatCalls(title: string, calls: LogArgCall[]): string {
  const review = calls.filter((c) => !c.isAllowListed).length;
  const rows = calls.map(
    (c) => `  ${c.isAllowListed ? 'ok    ' : 'REVIEW'} ${c.scope}:${c.line}  ${c.text.slice(0, 140)}`
  );
  return [`${title}: ${calls.length} call(s), ${review} marked REVIEW`, ...rows].join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const baseRef = readArg(args, '--base');
  const file = readArg(args, '--file');
  const headRef = readArg(args, '--head');
  const functions = readArg(args, '--functions');

  if (!baseRef || !file) {
    process.stderr.write('Usage: check-logging-only-diff --base <ref> --file <path> [--head <ref>] [--functions a,b]\n');
    process.exit(2);
  }

  const relFile = file.replace(/\\/g, '/');
  const baseText = gitShow(baseRef, relFile);
  const headText = headRef ? gitShow(headRef, relFile) : fs.readFileSync(path.resolve(relFile), 'utf8');
  const headLabel = headRef ?? 'working tree';

  try {
    if (functions) {
      const names = functions.split(',').map((s) => s.trim()).filter(Boolean);
      const verdicts = compareFunctions(relFile, baseText, headText, names);
      process.stdout.write(`Functions in ${relFile}, ${baseRef} vs ${headLabel} (logging normalised):\n`);
      for (const v of verdicts) {
        process.stdout.write(`  ${v.status.padEnd(16)} ${v.name}\n`);
        if (v.diff) process.stdout.write(`${v.diff}\n`);
      }
      process.exitCode = verdicts.every((v) => v.status === 'identical') ? 0 : 1;
      return;
    }

    const result = compareSources(relFile, baseText, headText);
    process.stdout.write(`File: ${relFile}\nBase: ${baseRef}   Head: ${headLabel}\n`);
    process.stdout.write(`Logging calls: base ${result.baseLogCalls}, head ${result.headLogCalls}\n`);
    process.stdout.write(
      result.identical
        ? 'RESULT: non-logging AST identical\n'
        : `RESULT: non-logging AST DIFFERS\n${result.diff}\n`
    );
    process.stdout.write(`\n${formatCalls('Calls inside logging (base)', result.baseArgCalls)}\n`);
    process.stdout.write(`\n${formatCalls('Calls inside logging (head)', result.headArgCalls)}\n`);
    process.exitCode = result.identical ? 0 : 1;
  } catch (err) {
    if (err instanceof RefusedError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
}

if (require.main === module) main();

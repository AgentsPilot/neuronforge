/**
 * typecheck-bos-llm — a type-check gate scoped to Business OS LLM attribution.
 *
 * WHY THIS EXISTS
 *
 * The call catalog (`lib/business-os/llm/callCatalog.ts`) makes a wrong area or
 * call name, or a missing account or grouping id, a TYPE error. Nothing else in
 * the pipeline enforces types: `next.config.js` sets `ignoreBuildErrors: true`,
 * Jest runs transpile-only (`isolatedModules`), and the repo carries ~2,000
 * pre-existing `tsc` errors, so a full `tsc` can never be a pass/fail gate.
 * Without this, a typo like `callName: 'ful_site'` would ship and write a wrong
 * label into the usage ledger.
 *
 * HOW IT WORKS
 *
 * 1. Builds the SAME program `tsc -p tsconfig.json` builds (every file, same
 *    options), so types resolve exactly as they do in the editor.
 * 2. Asks the checker for diagnostics of the IN-SCOPE files only. The checker
 *    is lazy: errors in other modules are never reported, which is what a small
 *    tsconfig cannot do (it still reports every transitively imported file).
 * 3. Compares those diagnostics with a committed baseline
 *    (`scripts/typecheck-bos-llm.baseline.json`) of errors that already existed
 *    on lines this work did not touch (e.g. KI-1's cast in
 *    WebsiteSectionService). Keys are (file, code, headline message) with a
 *    count, not line numbers, so unrelated edits that shift lines do not break
 *    the gate.
 * 4. Exits 1 on any diagnostic not covered by the baseline — including TS2578,
 *    an `@ts-expect-error` that no longer fires.
 *
 * SCOPE (derived from the import graph, not hand-listed)
 *
 * Imports are resolved by the TypeScript compiler (`ts.preProcessFile` +
 * `ts.resolveModuleName` with the tsconfig options), so `@/` aliases, relative
 * paths, `index.ts` barrels, type-only imports, `import()` and `require()` are
 * all followed the way `tsc` follows them.
 *
 * 1. CORE: every file under SCOPED_DIRS (the catalog and the usage mapping);
 *    every file that imports the catalog (the only way to use
 *    `buildBosCallContext`, `toEmbeddingAttribution`, `newBosGroupId`,
 *    `bosBriefingGroupId`, `bosFeature` or `BosLlmOwner`); every test file
 *    named `*attribution*.test.ts`.
 * 2. BARRELS: a file that re-exports (`export … from`) an in-scope module is
 *    in scope too, repeatedly, so barrels of barrels count.
 * 3. CALLERS: every file that directly imports a file from 1 or 2.
 *
 * Step 3 exists because attribution arguments are REQUIRED at service
 * boundaries (`runId`, `groupId`, `userId`), and a missing required argument is
 * reported in the CALLER, which usually does not import the catalog itself —
 * e.g. the insight cron reaches `InsightRepository` through its barrel.
 *
 * To extend it: import the catalog (automatic), name a test
 * `*attribution*.test.ts`, or add a directory to SCOPED_DIRS.
 *
 * USAGE
 *
 *   npm run typecheck:bos-llm                    # the gate
 *   npm run typecheck:bos-llm -- --list          # print the scoped files and why
 *   npm run typecheck:bos-llm -- --update-baseline
 *     Only when a PRE-EXISTING error comes into scope (e.g. a file that already
 *     had errors starts calling an attributed service). Never to silence a new
 *     error.
 *
 * @module scripts/typecheck-bos-llm
 */

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const TSCONFIG = path.join(ROOT, 'tsconfig.json');
const BASELINE = path.join(ROOT, 'scripts', 'typecheck-bos-llm.baseline.json');
const CATALOG = 'lib/business-os/llm/callCatalog.ts';

/**
 * Everything under these is in scope.
 *
 * `entitlements/` joined the list for the same reason the LLM catalog is here:
 * its types are the gate. A tier row is a mapped type over the capability
 * catalog, so a tier that forgets a capability — or gives one the wrong kind of
 * value — is a TYPE error and nothing else would catch it (the Next build
 * ignores type errors, and Jest transpiles without checking). The Zod schemas
 * and the invariant tests are the runtime half; this is the compile-time half.
 */
const SCOPED_DIRS = [
  'lib/business-os/llm/',
  'lib/business-os/usage/',
  'lib/business-os/entitlements/',
];

const ATTRIBUTION_TEST = /attribution[^/]*\.test\.tsx?$/;

type Baseline = Record<string, number>;
type Reason = 'core' | 'catalog-importer' | 'attribution-test' | 'barrel' | 'caller';

function toPosix(file: string): string {
  return path.relative(ROOT, path.resolve(file)).split(path.sep).join('/');
}

function loadConfig(): ts.ParsedCommandLine {
  const config = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
  if (config.error) {
    console.error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    process.exit(2);
  }
  return ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
}

/** Project source files: the tsconfig program minus declarations and dependencies. */
function projectFiles(parsed: ts.ParsedCommandLine): string[] {
  return parsed.fileNames
    .filter((file) => !file.endsWith('.d.ts') && !file.includes('/node_modules/') && fs.existsSync(file))
    .map(toPosix)
    .filter((rel) => !rel.startsWith('..'));
}

interface FileImports {
  /** Every project file this file imports, re-exports or dynamically loads. */
  imports: Set<string>;
  /** The subset reached through `export … from`. */
  reExports: Set<string>;
}

/** Resolve one file's module specifiers through the compiler. */
function readImports(
  rel: string,
  options: ts.CompilerOptions,
  cache: ts.ModuleResolutionCache,
  known: Set<string>
): FileImports {
  const absolute = path.join(ROOT, rel);
  const text = fs.readFileSync(absolute, 'utf8');
  const result: FileImports = { imports: new Set(), reExports: new Set() };

  const resolve = (specifier: string): string | undefined => {
    const resolved = ts.resolveModuleName(specifier, absolute, options, ts.sys, cache).resolvedModule;
    if (!resolved || resolved.isExternalLibraryImport) return undefined;
    const target = toPosix(resolved.resolvedFileName);
    return known.has(target) ? target : undefined;
  };

  // import / export-from / import() / require(), including type-only imports.
  for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
    const target = resolve(fileName);
    if (target) result.imports.add(target);
  }

  // Re-exports need the AST: preProcessFile does not say which imports are `export … from`.
  const source = ts.createSourceFile(absolute, text, ts.ScriptTarget.Latest, false);
  for (const statement of source.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      const target = resolve(statement.moduleSpecifier.text);
      if (target) result.reExports.add(target);
    }
  }

  return result;
}

function computeScope(parsed: ts.ParsedCommandLine): Map<string, Reason> {
  const files = projectFiles(parsed).filter((rel) => rel !== 'scripts/typecheck-bos-llm.ts');
  const known = new Set(files);
  const cache = ts.createModuleResolutionCache(ROOT, (name) => name, parsed.options);

  const graph = new Map<string, FileImports>();
  for (const rel of files) graph.set(rel, readImports(rel, parsed.options, cache, known));

  const scope = new Map<string, Reason>();

  // 1. Core.
  for (const rel of files) {
    if (SCOPED_DIRS.some((dir) => rel.startsWith(dir))) scope.set(rel, 'core');
    else if (graph.get(rel)!.imports.has(CATALOG)) scope.set(rel, 'catalog-importer');
    else if (ATTRIBUTION_TEST.test(rel)) scope.set(rel, 'attribution-test');
  }

  // 2. Barrels, to a fixed point.
  let grew = true;
  while (grew) {
    grew = false;
    for (const rel of files) {
      if (scope.has(rel)) continue;
      for (const target of graph.get(rel)!.reExports) {
        if (scope.has(target)) {
          scope.set(rel, 'barrel');
          grew = true;
          break;
        }
      }
    }
  }

  // 3. Direct callers of anything in 1 or 2 (one level only).
  const reached = new Set(scope.keys());
  for (const rel of files) {
    if (scope.has(rel)) continue;
    for (const target of graph.get(rel)!.imports) {
      if (reached.has(target)) {
        scope.set(rel, 'caller');
        break;
      }
    }
  }

  return new Map([...scope.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Sort a printed union type: string-literal unions at any depth, and the
 * top-level members. (A named union nested inside an object type is left as
 * printed; none occurs in scope today.)
 */
function sortUnion(printed: string): string {
  const type = printed.replace(/"[^"]*"(?:\s*\|\s*"[^"]*")+/g, (union) =>
    union
      .split('|')
      .map((member) => member.trim())
      .sort()
      .join(' | ')
  );
  const members: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of type) {
    if ('([{<'.includes(char)) depth += 1;
    if (')]}>'.includes(char)) depth -= 1;
    if (char === '|' && depth === 0) {
      members.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  members.push(current.trim());
  return members.length > 1 ? members.sort().join(' | ') : type;
}

/**
 * A message that is stable across runs. The checker prints union members in
 * type-creation order, which depends on what was checked first
 * ('A | B' in one run, 'B | A' in another; seen for both literal and named
 * unions), and the elaboration lines under the headline vary the same way.
 * So: headline only, every quoted type's top-level union sorted.
 */
function stableMessage(diagnostic: ts.Diagnostic): string {
  const headline = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n')[0];
  return headline.replace(/'([^']*)'/g, (_quoted, type: string) => `'${sortUnion(type)}'`);
}

function keyOf(diagnostic: ts.Diagnostic): { key: string; text: string } {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
  const file = diagnostic.file ? toPosix(diagnostic.file.fileName) : '<global>';
  let where = file;
  if (diagnostic.file && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    where = `${file}(${line + 1},${character + 1})`;
  }
  return {
    // No line number in the key: an edit elsewhere in the file must not turn
    // a known error into a "new" one.
    key: `${file} | TS${diagnostic.code} | ${stableMessage(diagnostic)}`,
    text: `${where}: error TS${diagnostic.code}: ${message}`,
  };
}

function main(): void {
  const started = Date.now();
  const args = new Set(process.argv.slice(2));
  const parsed = loadConfig();
  const scope = computeScope(parsed);

  if (args.has('--list')) {
    for (const [rel, reason] of scope) console.log(`${reason.padEnd(17)} ${rel}`);
    console.log(`typecheck-bos-llm: ${scope.size} files in scope`);
    return;
  }

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: { ...parsed.options, noEmit: true, incremental: false, tsBuildInfoFile: undefined },
  });

  const found = new Map<string, string[]>();

  for (const rel of scope.keys()) {
    const sourceFile = program.getSourceFile(path.join(ROOT, rel));
    if (!sourceFile) {
      // Fail loudly rather than silently skipping a file that was meant to be checked.
      console.error(`typecheck-bos-llm: ${rel} is in scope but not in the tsconfig program`);
      process.exit(2);
    }
    const diagnostics = [
      ...program.getSyntacticDiagnostics(sourceFile),
      ...program.getSemanticDiagnostics(sourceFile),
    ];
    for (const diagnostic of diagnostics) {
      if (diagnostic.category !== ts.DiagnosticCategory.Error) continue;
      const { key, text } = keyOf(diagnostic);
      const list = found.get(key) ?? [];
      list.push(text);
      found.set(key, list);
    }
  }

  if (args.has('--update-baseline')) {
    const baseline: Baseline = {};
    [...found.keys()].sort().forEach((key) => (baseline[key] = found.get(key)!.length));
    fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    console.log(`typecheck-bos-llm: baseline written (${Object.keys(baseline).length} keys) to ${toPosix(BASELINE)}`);
    return;
  }

  const baseline: Baseline = fs.existsSync(BASELINE)
    ? (JSON.parse(fs.readFileSync(BASELINE, 'utf8')) as Baseline)
    : {};

  const fresh: string[] = [];
  const stale: string[] = [];

  for (const [key, texts] of found) {
    const allowed = baseline[key] ?? 0;
    if (texts.length > allowed) fresh.push(...texts.slice(allowed));
  }
  for (const [key, allowed] of Object.entries(baseline)) {
    if ((found.get(key)?.length ?? 0) < allowed) stale.push(key);
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `typecheck-bos-llm: ${scope.size} files in scope, ${[...found.values()].flat().length} errors, ${fresh.length} new (${seconds}s)`
  );

  if (stale.length > 0) {
    console.log(`typecheck-bos-llm: ${stale.length} baseline entr${stale.length === 1 ? 'y is' : 'ies are'} fixed; consider --update-baseline:`);
    stale.forEach((key) => console.log(`  - ${key}`));
  }

  if (fresh.length > 0) {
    console.error('typecheck-bos-llm: FAILED. New type errors in Business OS LLM attribution scope:');
    fresh.forEach((text) => console.error(`  ${text}`));
    process.exit(1);
  }

  console.log('typecheck-bos-llm: passed');
}

main();

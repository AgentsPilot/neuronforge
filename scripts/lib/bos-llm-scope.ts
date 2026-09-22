/**
 * bos-llm-scope — the file walk and import graph shared by the two Business OS
 * LLM gates.
 *
 * WHY THIS EXISTS
 *
 * `scripts/typecheck-bos-llm.ts` (Layer 1) and `scripts/check-bos-llm-literals.ts`
 * (Layer 2, FR-15) must agree about two things: which files belong to the
 * project, and what each file imports. The literal check's scope — "non-test
 * files that import the call catalog" — is a subset of the type gate's scope,
 * so the derivation is imported, not copied (workplan §8.1). One copy means one
 * behaviour: fix the walk here and both gates change together.
 *
 * Imports are resolved by the TypeScript compiler (`ts.preProcessFile` +
 * `ts.resolveModuleName` with the tsconfig options), so `@/` aliases, relative
 * paths, `index.ts` barrels, type-only imports, `import()` and `require()` are
 * all followed the way `tsc` follows them.
 *
 * @see docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md §8
 * @module scripts/lib/bos-llm-scope
 */

import * as fs from 'fs';
import * as path from 'path';
import ts from 'typescript';

export const ROOT = path.resolve(__dirname, '..', '..');
export const TSCONFIG = path.join(ROOT, 'tsconfig.json');

/** The call catalog. Importing it is what puts a file in Business OS LLM scope. */
export const CATALOG = 'lib/business-os/llm/callCatalog.ts';

/**
 * Generated output is not source.
 *
 * `next build` writes `.next/types/**\/route.ts` shims that import every API
 * route, so they resolve as "callers" and joined the type gate's scope: the
 * SAME tree reported 158, 167 or 177 files depending on whether a build had run
 * in the checkout (workplan FU-2, QA D3-3). The verdict never moved (0 new
 * either way) but the count did, which makes it useless for comparing rounds.
 * Excluded here once, for both gates. `.claude/` holds agent worktrees — other
 * branches' copies of every file — and `jest.config.js` already ignores it for
 * the same reason.
 */
const GENERATED_DIRS = ['.next/', '.claude/', 'coverage/', 'out/'];

/** Tests, fixtures and manual mocks. Excluded from the literal check's scope (FR-15). */
const TEST_FILE = /(?:^|\/)(?:__tests__|__fixtures__|__mocks__|__preview__)\//;
const TEST_NAME = /\.(?:test|spec)\.tsx?$/;

export function toPosix(file: string): string {
  return path.relative(ROOT, path.resolve(file)).split(path.sep).join('/');
}

export function isTestFile(rel: string): boolean {
  return TEST_FILE.test(rel) || TEST_NAME.test(rel);
}

export function isGenerated(rel: string): boolean {
  return GENERATED_DIRS.some((dir) => rel.startsWith(dir));
}

export function loadConfig(): ts.ParsedCommandLine {
  const config = ts.readConfigFile(TSCONFIG, ts.sys.readFile);
  if (config.error) {
    console.error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    process.exit(2);
  }
  return ts.parseJsonConfigFileContent(config.config, ts.sys, ROOT);
}

/**
 * Project source files: the tsconfig program minus declarations, dependencies
 * and generated output.
 */
export function projectFiles(parsed: ts.ParsedCommandLine): string[] {
  return parsed.fileNames
    .filter((file) => !file.endsWith('.d.ts') && !file.includes('/node_modules/') && fs.existsSync(file))
    .map(toPosix)
    .filter((rel) => !rel.startsWith('..') && !isGenerated(rel));
}

export interface FileImports {
  /** Every project file this file imports, re-exports or dynamically loads. */
  imports: Set<string>;
  /** The subset reached through `export … from`. */
  reExports: Set<string>;
}

/** Resolve one file's module specifiers through the compiler. */
export function readImports(
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

/** The import graph of every project file, keyed by repo-relative posix path. */
export function buildImportGraph(
  files: string[],
  options: ts.CompilerOptions
): Map<string, FileImports> {
  const known = new Set(files);
  const cache = ts.createModuleResolutionCache(ROOT, (name) => name, options);
  const graph = new Map<string, FileImports>();
  for (const rel of files) graph.set(rel, readImports(rel, options, cache, known));
  return graph;
}

/**
 * The literal check's scope (FR-15): the catalog itself plus every non-test
 * file that imports it directly.
 *
 * Direct, not transitive, and deliberately so. Importing the catalog is what a
 * Business OS call site does to build its attribution context
 * (`buildBosCallContext`), so "imports the catalog" is a precise synonym for
 * "is a catalogued call site" — every one of the 22 calls is here. A file that
 * merely imports a call site (a route calling a service) sends nothing to a
 * provider and is out.
 *
 * Two live Business OS chat paths are therefore NOT in scope, by prior decision
 * and not by accident: chat-v2 (`AIDataLayerService`) and chat-v1
 * (`IntentParser`) choose their own model (requirement F-13 / V-4, DEC-11) and
 * import nothing from the catalog. Both are stopped by the chat kill switch.
 *
 * ONE CLASS OF FILE IS OUT: **tests, fixtures and mocks.** They must name
 * models - pinning what the provider actually received is how Layer 2 is proved
 * at all.
 *
 * `scripts/` is NOT excluded (SA finding 8). Exactly one script imports the
 * catalog today, and it is named in the gate's `EXEMPTIONS` with its reason, so
 * `--list` shows it. A directory exclusion would have bought that one file and
 * blanketed ~400 others for ever, including the backfill or seeding script
 * somebody writes next year - and the exemption list is the gate's blast
 * radius, so it has to be readable.
 *
 * INCLUSIONS are the mirror image of the gate's `EXEMPTIONS` — see below.
 */

/**
 * Files named INTO the literal check that the direct-import rule would miss.
 *
 * Why this exists rather than a transitive scope: the admin settings route
 * reaches the catalog one hop away (through `adminSettingsView`), so the
 * direct-import rule leaves it out — on a file that serves the model picker,
 * which is exactly where a model literal would be tempting. A TRANSITIVE scope
 * was considered and rejected: `modelSettings` has enough importers that 42
 * files would become hundreds, and a gate that goes red on unrelated code is a
 * gate that gets exempted.
 *
 * So scope only ever GROWS here, one named file at a time, each with its
 * reason — the same discipline as `EXEMPTIONS`, and printed by `--list` the
 * same way.
 *
 * A source test is NOT an acceptable substitute, for three reasons: its
 * assertions are a hand-enumerated subset of the AST rules, its file list does
 * not follow the code, and jest is not a required check on this repository.
 */
export const LITERAL_SCOPE_INCLUSIONS: ReadonlyArray<{ file: string; reason: string }> = [
  {
    file: 'app/api/admin/business-os/llm-settings/route.ts',
    reason:
      'Business OS LLM model-settings admin route: reaches the catalog through adminSettingsView, so the direct-import rule misses it, but it serves the model picker and must never write a model id.',
  },
];

export function literalScope(graph: Map<string, FileImports>): string[] {
  const included = new Set(LITERAL_SCOPE_INCLUSIONS.map((entry) => entry.file));

  return [...graph.entries()]
    .filter(
      ([rel, imports]) =>
        !isTestFile(rel) && (rel === CATALOG || imports.imports.has(CATALOG) || included.has(rel))
    )
    .map(([rel]) => rel)
    .sort((a, b) => a.localeCompare(b));
}

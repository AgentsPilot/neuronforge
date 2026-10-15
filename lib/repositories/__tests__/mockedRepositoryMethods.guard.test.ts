/**
 * CI guard G-1: every repository member a test mocks must exist on the real class.
 *
 * WHY. F-13 (PR #387) shipped because four safety nets all missed it. A merge
 * deleted `UserPreferencesRepository.findTimezone`, but `ProposalAcceptanceService`
 * still called it. `next.config.js` ignores type errors, Jest only transpiles,
 * the one `tsc` gate does not cover `lib/services/`, and the service's test
 * mocked the repository with its own `findTimezone`, so the test stayed green
 * while production crashed. A mock that invents a method hides exactly this.
 *
 * WHAT IS PINNED. For every `jest.mock` / `jest.doMock` in a file Jest collects,
 * whose spec (`@/…` or relative) resolves into `lib/repositories/`:
 *   - unknown-export: a top-level factory key the module does not export fails;
 *   - missing-method: when the key is an exported instance (`new C()`, directly,
 *     via `export { x }` or through a barrel), each literal key of its mocked
 *     object must be a member of `C` (methods, properties, accessors, constructor
 *     parameter properties, any visibility, inherited via `extends`).
 *
 * WHAT IS SKIPPED, never failed (SA ruling: literal keys only). Anything the
 * guard cannot read statically is counted by reason and shown in a test title:
 * block-bodied factories, non-literal values, computed keys, non-requireActual
 * spreads, unresolvable base classes, and exports that are not `new C()` (C-1,
 * e.g. the `rateLimitRepository = { … }` object). `...jest.requireActual(…)`
 * spreads are exempt: they supply the real members.
 *
 * BASELINE. `mockedRepositoryMethods.baseline.json` is a ratchet: an entry
 * suppresses its mismatch, a stale entry fails, so the list only shrinks. It
 * ships empty.
 *
 * HOW. TypeScript compiler API over source text on both sides (no
 * `requireActual`, so no Supabase client or env is loaded). Only test files are
 * walked, and only those matching a regex prefilter are parsed. Budget < 3 s.
 * Workplan: docs/workplans/CI_GUARDS_MOCK_METHODS_AND_SERVICE_TSC_WORKPLAN.md.
 */

import fs from 'fs';
import path from 'path';
import * as ts from 'typescript';

// ─── Source host: the real repo, or an in-memory fixture ───────────────────────

/** Repo-relative, forward-slash paths throughout. */
interface SourceHost {
  read(file: string): string | undefined;
}

function fsHost(root: string): SourceHost {
  const cache = new Map<string, string | undefined>();
  return {
    read(file) {
      if (!cache.has(file)) {
        const full = path.join(root, file);
        cache.set(file, fs.existsSync(full) && fs.statSync(full).isFile() ? fs.readFileSync(full, 'utf8') : undefined);
      }
      return cache.get(file);
    },
  };
}

function memoryHost(files: Record<string, string>): SourceHost {
  return { read: (file) => files[file] };
}

const REPOSITORIES_DIR = 'lib/repositories/';
const MAX_DEPTH = 5;
const ERROR_MEMBERS = ['message', 'name', 'stack', 'cause'];

function isTestPath(file: string): boolean {
  return /(^|\/)__tests__\//.test(file) || /\.(test|spec)\.tsx?$/.test(file);
}

/** `@/x` and relative specs only; packages are never repositories. */
function resolveSpec(spec: string, fromFile: string, host: SourceHost): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('./') || spec.startsWith('../')) base = path.posix.join(path.posix.dirname(fromFile), spec);
  else return null;
  base = path.posix.normalize(base).replace(/\/$/, '');
  const candidates = /\.tsx?$/.test(base)
    ? [base]
    : [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  return candidates.find((candidate) => host.read(candidate) !== undefined) ?? null;
}

// ─── Repository side ────────────────────────────────────────────────────────────

type Binding =
  | { kind: 'class'; decl: ts.ClassDeclaration }
  | { kind: 'new'; className: string }
  | { kind: 'other' }
  | { kind: 'import'; spec: string; imported: string };

type ExportEntry = { local: string } | { from: string; imported: string };

interface ModuleInfo {
  locals: Map<string, Binding>;
  exports: Map<string, ExportEntry>;
  hasExportStar: boolean;
}

type Resolved =
  | { kind: 'missing' }
  | { kind: 'export-star' }
  | { kind: 'class'; name: string; file: string; decl: ts.ClassDeclaration }
  | { kind: 'instance'; className: string; file: string }
  | { kind: 'other' }
  | { kind: 'unresolvable' };

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []).some((m) => m.kind === kind) : false;
}

/** Strip parentheses and type-only wrappers (`as`, `satisfies`, `<T>x`, `x!`). */
function unwrap(expr: ts.Expression): ts.Expression {
  let current = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isSatisfiesExpression(current)
      || ts.isTypeAssertionExpression(current) || ts.isNonNullExpression(current)) {
      current = current.expression;
    } else {
      return current;
    }
  }
}

function nameText(name: ts.PropertyName | ts.BindingName): string | null {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

class RepositoryIndex {
  private readonly modules = new Map<string, ModuleInfo | null>();

  constructor(private readonly host: SourceHost) {}

  resolveSpec(spec: string, fromFile: string): string | null {
    return resolveSpec(spec, fromFile, this.host);
  }

  module(file: string): ModuleInfo | null {
    if (this.modules.has(file)) return this.modules.get(file) ?? null;
    const text = this.host.read(file);
    const info = text === undefined ? null : this.analyse(parse(file, text));
    this.modules.set(file, info);
    return info;
  }

  private analyse(sf: ts.SourceFile): ModuleInfo {
    const locals = new Map<string, Binding>();
    const exports = new Map<string, ExportEntry>();
    let hasExportStar = false;
    for (const stmt of sf.statements) {
      const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      if (ts.isClassDeclaration(stmt) && stmt.name) {
        locals.set(stmt.name.text, { kind: 'class', decl: stmt });
        if (exported) exports.set(hasModifier(stmt, ts.SyntaxKind.DefaultKeyword) ? 'default' : stmt.name.text, { local: stmt.name.text });
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name)) continue;
          const init = decl.initializer ? unwrap(decl.initializer) : undefined;
          locals.set(decl.name.text, init && ts.isNewExpression(init) && ts.isIdentifier(init.expression)
            ? { kind: 'new', className: init.expression.text }
            : { kind: 'other' });
          if (exported) exports.set(decl.name.text, { local: decl.name.text });
        }
      } else if (ts.isFunctionDeclaration(stmt) || ts.isEnumDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)
        || ts.isTypeAliasDeclaration(stmt) || ts.isModuleDeclaration(stmt)) {
        const name = stmt.name && ts.isIdentifier(stmt.name) ? stmt.name.text : null;
        if (name) {
          if (!locals.has(name)) locals.set(name, { kind: 'other' });
          if (exported) exports.set(hasModifier(stmt, ts.SyntaxKind.DefaultKeyword) ? 'default' : name, { local: name });
        }
      } else if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.importClause) {
        const spec = stmt.moduleSpecifier.text;
        if (stmt.importClause.name) locals.set(stmt.importClause.name.text, { kind: 'import', spec, imported: 'default' });
        const bindings = stmt.importClause.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            locals.set(el.name.text, { kind: 'import', spec, imported: (el.propertyName ?? el.name).text });
          }
        } else if (bindings) {
          locals.set(bindings.name.text, { kind: 'other' });
        }
      } else if (ts.isExportDeclaration(stmt)) {
        const from = stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier) ? stmt.moduleSpecifier.text : null;
        if (!stmt.exportClause) {
          hasExportStar = true;
        } else if (ts.isNamespaceExport(stmt.exportClause)) {
          locals.set(`#ns:${stmt.exportClause.name.text}`, { kind: 'other' });
          exports.set(stmt.exportClause.name.text, { local: `#ns:${stmt.exportClause.name.text}` });
        } else {
          for (const el of stmt.exportClause.elements) {
            const source = (el.propertyName ?? el.name).text;
            exports.set(el.name.text, from ? { from, imported: source } : { local: source });
          }
        }
      } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
        const expr = unwrap(stmt.expression);
        locals.set('#default', ts.isNewExpression(expr) && ts.isIdentifier(expr.expression)
          ? { kind: 'new', className: expr.expression.text }
          : ts.isIdentifier(expr) ? (locals.get(expr.text) ?? { kind: 'other' }) : { kind: 'other' });
        exports.set('default', { local: '#default' });
      }
    }
    return { locals, exports, hasExportStar };
  }

  resolveExport(file: string, name: string, depth = 0): Resolved {
    const info = this.module(file);
    if (!info || depth > MAX_DEPTH) return { kind: 'unresolvable' };
    const entry = info.exports.get(name);
    if (!entry) return info.hasExportStar ? { kind: 'export-star' } : { kind: 'missing' };
    if ('from' in entry) {
      const target = this.resolveSpec(entry.from, file);
      return target ? this.resolveExport(target, entry.imported, depth + 1) : { kind: 'unresolvable' };
    }
    return this.resolveBinding(file, entry.local, depth) ?? { kind: 'other' };
  }

  /** `null` means the name has no binding in the file at all (a global such as `Error`). */
  resolveBinding(file: string, local: string, depth = 0): Resolved | null {
    const info = this.module(file);
    if (!info || depth > MAX_DEPTH) return { kind: 'unresolvable' };
    const binding = info.locals.get(local);
    if (!binding) return null;
    switch (binding.kind) {
      case 'class': return { kind: 'class', name: local, file, decl: binding.decl };
      case 'new': return { kind: 'instance', className: binding.className, file };
      case 'other': return { kind: 'other' };
      case 'import': {
        const target = this.resolveSpec(binding.spec, file);
        return target ? this.resolveExport(target, binding.imported, depth + 1) : { kind: 'unresolvable' };
      }
    }
  }

  /** Instance members of a class, following `extends`. `null` = a base could not be resolved. */
  classMembers(file: string, decl: ts.ClassDeclaration, depth = 0): Set<string> | null {
    if (depth > MAX_DEPTH) return null;
    const members = new Set<string>();
    for (const member of decl.members) {
      if (hasModifier(member, ts.SyntaxKind.StaticKeyword)) continue;
      if (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)
        || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
        const name = nameText(member.name);
        if (name !== null) members.add(name);
      } else if (ts.isConstructorDeclaration(member)) {
        for (const param of member.parameters) {
          const isParameterProperty = (ts.getModifiers(param) ?? []).some((m) =>
            [ts.SyntaxKind.PublicKeyword, ts.SyntaxKind.PrivateKeyword, ts.SyntaxKind.ProtectedKeyword,
              ts.SyntaxKind.ReadonlyKeyword].includes(m.kind));
          const name = nameText(param.name);
          if (isParameterProperty && name !== null) members.add(name);
        }
      }
    }
    const heritage = decl.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword);
    const base = heritage?.types[0]?.expression;
    if (base) {
      if (!ts.isIdentifier(base)) return null;
      const resolved = this.resolveBinding(file, base.text, depth);
      if (resolved === null && base.text === 'Error') {
        ERROR_MEMBERS.forEach((name) => members.add(name));
      } else if (resolved && resolved.kind === 'class') {
        const inherited = this.classMembers(resolved.file, resolved.decl, depth + 1);
        if (!inherited) return null;
        inherited.forEach((name) => members.add(name));
      } else {
        return null;
      }
    }
    return members;
  }
}

// ─── Test side ──────────────────────────────────────────────────────────────────

type SkipReason =
  | 'no-factory'
  | 'block-bodied-factory'
  | 'factory-not-object-literal'
  | 'spread'
  | 'computed-key'
  | 'export-star'
  | 'export-unresolvable'
  | 'instance-not-object-literal'
  | 'export-not-class-instance'
  | 'class-export-shape'
  | 'class-unresolvable';

interface Finding {
  kind: 'missing-method' | 'unknown-export';
  /** Baseline key: `<test file> | <spec> | <export>[.<method>]`. */
  key: string;
  message: string;
}

interface ScanResult {
  sites: number;
  checkedKeys: number;
  /** The subset of checkedKeys that are instance members (a method of an exported `new C()`). */
  checkedMethods: number;
  findings: Finding[];
  skips: Partial<Record<SkipReason, number>>;
}

function emptyResult(): ScanResult {
  return { sites: 0, checkedKeys: 0, checkedMethods: 0, findings: [], skips: {} };
}

function mergeInto(target: ScanResult, part: ScanResult): void {
  target.sites += part.sites;
  target.checkedKeys += part.checkedKeys;
  target.checkedMethods += part.checkedMethods;
  target.findings.push(...part.findings);
  for (const [reason, count] of Object.entries(part.skips) as Array<[SkipReason, number]>) {
    target.skips[reason] = (target.skips[reason] ?? 0) + count;
  }
}

function isJestCall(node: ts.CallExpression, methods: ReadonlyArray<string>): boolean {
  const callee = node.expression;
  return ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
    && callee.expression.text === 'jest' && methods.includes(callee.name.text);
}

/** `jest.requireActual(…)`, optionally followed by `.x`, `['x']` or type wrappers. */
function isRequireActual(expr: ts.Expression): boolean {
  const inner = unwrap(expr);
  if (ts.isCallExpression(inner)) return isJestCall(inner, ['requireActual']);
  if (ts.isPropertyAccessExpression(inner) || ts.isElementAccessExpression(inner)) return isRequireActual(inner.expression);
  return false;
}

const FIX_HINT = [
  'Fix ONE of:',
  '  - the code under test needs it  -> add the method to the repository class;',
  '  - the mock is stale or misspelt -> rename or remove the key so the mock matches the real class.',
  'Do not add it to mockedRepositoryMethods.baseline.json: the baseline only shrinks.',
].join('\n');

function missingMethodMessage(testFile: string, spec: string, exportName: string, method: string,
  className: string, classFile: string): string {
  return [
    'Mocked repository member does not exist on the real class (CI guard G-1):',
    `  ${testFile} mocks ${exportName}.${method}`,
    `  from '${spec}', but class ${className}`,
    `  (${classFile}) has no member '${method}'.`,
    FIX_HINT,
  ].join('\n');
}

function unknownExportMessage(testFile: string, spec: string, exportName: string, moduleFile: string): string {
  return [
    'Mocked repository export does not exist on the real module (CI guard G-1):',
    `  ${testFile} mocks '${exportName}' from '${spec}',`,
    `  but ${moduleFile} does not export '${exportName}'.`,
    FIX_HINT.replace('add the method to the repository class', 'add the export to the repository module'),
  ].join('\n');
}

/** Keys of a mocked object: literal names, plus skip reasons for what cannot be read. */
function objectKeys(obj: ts.ObjectLiteralExpression, skip: (reason: SkipReason) => void):
  Array<{ name: string; value: ts.Expression | null }> {
  const keys: Array<{ name: string; value: ts.Expression | null }> = [];
  for (const prop of obj.properties) {
    if (ts.isSpreadAssignment(prop)) {
      if (!isRequireActual(prop.expression)) skip('spread');
      continue;
    }
    if (ts.isComputedPropertyName(prop.name)) {
      skip('computed-key');
      continue;
    }
    const name = nameText(prop.name);
    if (name === null) {
      skip('computed-key');
      continue;
    }
    keys.push({ name, value: ts.isPropertyAssignment(prop) ? prop.initializer : null });
  }
  return keys;
}

function scanTestSource(src: string, testFile: string, index: RepositoryIndex): ScanResult {
  const result = emptyResult();
  const skip = (reason: SkipReason) => {
    result.skips[reason] = (result.skips[reason] ?? 0) + 1;
  };

  const checkSite = (call: ts.CallExpression) => {
    const specArg = call.arguments[0];
    if (!specArg || !ts.isStringLiteralLike(specArg)) return;
    const spec = specArg.text;
    const target = index.resolveSpec(spec, testFile);
    if (!target || !target.startsWith(REPOSITORIES_DIR) || isTestPath(target)) return;
    result.sites += 1;

    const factory = call.arguments[1];
    if (!factory) return skip('no-factory');
    if (!ts.isArrowFunction(factory) && !ts.isFunctionExpression(factory)) return skip('factory-not-object-literal');
    if (ts.isBlock(factory.body)) return skip('block-bodied-factory');
    const body = unwrap(factory.body);
    if (!ts.isObjectLiteralExpression(body)) return skip('factory-not-object-literal');

    for (const { name: exportName, value } of objectKeys(body, skip)) {
      if (exportName === '__esModule') continue;
      const resolved = index.resolveExport(target, exportName);
      if (resolved.kind === 'export-star') { skip('export-star'); continue; }
      if (resolved.kind === 'unresolvable') { skip('export-unresolvable'); continue; }
      result.checkedKeys += 1;
      if (resolved.kind === 'missing') {
        result.findings.push({
          kind: 'unknown-export',
          key: `${testFile} | ${spec} | ${exportName}`,
          message: unknownExportMessage(testFile, spec, exportName, target),
        });
        continue;
      }
      const mocked = value ? unwrap(value) : null;
      if (resolved.kind === 'class') {
        if (mocked && ts.isObjectLiteralExpression(mocked)) skip('class-export-shape');
        continue;
      }
      if (resolved.kind === 'other') {
        // C-1: e.g. `export const rateLimitRepository = { … }`. No class to compare with.
        if (mocked && ts.isObjectLiteralExpression(mocked)) skip('export-not-class-instance');
        continue;
      }
      // An exported `new C()` instance.
      if (!mocked || !ts.isObjectLiteralExpression(mocked)) { skip('instance-not-object-literal'); continue; }
      const cls = index.resolveBinding(resolved.file, resolved.className);
      const members = cls && cls.kind === 'class' ? index.classMembers(cls.file, cls.decl) : null;
      if (!cls || cls.kind !== 'class' || !members) { skip('class-unresolvable'); continue; }
      for (const { name: method } of objectKeys(mocked, skip)) {
        result.checkedKeys += 1;
        result.checkedMethods += 1;
        if (members.has(method)) continue;
        result.findings.push({
          kind: 'missing-method',
          key: `${testFile} | ${spec} | ${exportName}.${method}`,
          message: missingMethodMessage(testFile, spec, exportName, method, cls.name, cls.file),
        });
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isJestCall(node, ['mock', 'doMock'])) checkSite(node);
    ts.forEachChild(node, visit);
  };
  visit(parse(testFile, src));
  return result;
}

/** Ratchet: listed findings are suppressed; a listed key that no longer matches is stale. */
function applyBaseline(findings: ReadonlyArray<Finding>, baseline: ReadonlyArray<string>):
  { unbaselined: Finding[]; stale: string[] } {
  const listed = new Set(baseline);
  const found = new Set(findings.map((f) => f.key));
  return {
    unbaselined: findings.filter((f) => !listed.has(f.key)),
    stale: baseline.filter((key) => !found.has(key)),
  };
}

// ─── Real-repo scan (runs once, at collection time) ────────────────────────────

const ROOT = path.resolve(__dirname, '..', '..', '..');
const WALK_SKIP = new Set(['node_modules', '.next', '.git', '.claude', 'coverage', 'out', 'docs']);
/** Cheap prefilter: only files that mock an `@/lib/repositories…` or a relative spec are parsed. */
const PREFILTER = /jest\.(?:mock|doMock)\(\s*['"`](?:@\/lib\/repositories|\.\.?\/)/;
const BASELINE_FILE = 'lib/repositories/__tests__/mockedRepositoryMethods.baseline.json';

/** The files Jest collects (jest.config.js testMatch). */
function walkTestFiles(dir: string, relDir = ''): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (WALK_SKIP.has(entry.name)) return [];
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return walkTestFiles(path.join(dir, entry.name), rel);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && isTestPath(rel) ? [rel] : [];
  });
}

const started = Date.now();
const realHost = fsHost(ROOT);
const realIndex = new RepositoryIndex(realHost);
const testFiles = walkTestFiles(ROOT);
const walkMs = Date.now() - started;
const candidates = testFiles.filter((file) => PREFILTER.test(realHost.read(file) ?? ''));
const filterMs = Date.now() - started - walkMs;
const REAL = emptyResult();
for (const file of candidates) mergeInto(REAL, scanTestSource(realHost.read(file) ?? '', file, realIndex));
const scanMs = Date.now() - started;
const parseMs = scanMs - walkMs - filterMs;
const skipTotal = Object.values(REAL.skips).reduce((sum, n) => sum + (n ?? 0), 0);
const skipDetail = Object.entries(REAL.skips).sort(([a], [b]) => a.localeCompare(b)).map(([r, n]) => `${r} ${n}`).join(', ');
const BASELINE: string[] = JSON.parse(fs.readFileSync(path.join(ROOT, BASELINE_FILE), 'utf8'));

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('G-1: mocked repository members exist on the real class', () => {
  it(`checked ${REAL.checkedKeys} keys (${REAL.checkedMethods} instance members) in ${REAL.sites} mock sites (${candidates.length}/${testFiles.length} test files parsed; scan ${scanMs} ms = walk ${walkMs} + prefilter ${filterMs} + parse ${parseMs}); skipped ${skipTotal} (${skipDetail})`, () => {
    // Floors: a walker that finds nothing, or a parser regression that turns
    // every key into a skip, must not pass green (C-2).
    expect(testFiles.length).toBeGreaterThan(1000);
    expect(REAL.sites).toBeGreaterThanOrEqual(300);
    expect(REAL.checkedKeys).toBeGreaterThanOrEqual(350);
    // Separate floor for instance members: if every one of them silently became
    // a skip, the top-level exports alone could still clear the 350 above.
    expect(REAL.checkedMethods).toBeGreaterThanOrEqual(300);
  });

  it('no mocked repository member is missing beyond the baseline', () => {
    const { unbaselined } = applyBaseline(REAL.findings, BASELINE);
    if (unbaselined.length > 0) throw new Error(unbaselined.map((f) => f.message).join('\n\n'));
  });

  it('the baseline is sorted, unique, and has no stale entry (it only shrinks)', () => {
    expect(BASELINE).toEqual([...new Set(BASELINE)].sort());
    expect(applyBaseline(REAL.findings, BASELINE).stale).toEqual([]);
  });
});

describe('G-1 self-tests (inline fixtures)', () => {
  const TEST = 'lib/services/__tests__/packageAcceptance.test.ts';
  const PREFS = 'lib/repositories/UserPreferencesRepository.ts';
  const prefsRepo = (members: string) => `
    export class UserPreferencesRepository {
      constructor(private readonly client: unknown) {}
      async findByUserId(userId: string) { return userId; }
      ${members}
    }
    export const userPreferencesRepository = new UserPreferencesRepository(null);
  `;
  const scan = (files: Record<string, string>, testSrc: string, testFile = TEST) =>
    scanTestSource(testSrc, testFile, new RepositoryIndex(memoryHost(files)));
  const mockPrefs = (keys: string) => `
    jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
      userPreferencesRepository: { ${keys} },
    }));
  `;

  it('1. F-13 replica: a mocked method the class lacks fails with the full message (failure path)', () => {
    const r = scan({ [PREFS]: prefsRepo('') }, mockPrefs('findByUserId: jest.fn(), findTimezone: jest.fn()'));
    expect(r.findings.map((f) => f.key)).toEqual([
      `${TEST} | @/lib/repositories/UserPreferencesRepository | userPreferencesRepository.findTimezone`,
    ]);
    expect(r.findings[0].message).toBe([
      'Mocked repository member does not exist on the real class (CI guard G-1):',
      `  ${TEST} mocks userPreferencesRepository.findTimezone`,
      "  from '@/lib/repositories/UserPreferencesRepository', but class UserPreferencesRepository",
      `  (${PREFS}) has no member 'findTimezone'.`,
      'Fix ONE of:',
      '  - the code under test needs it  -> add the method to the repository class;',
      '  - the mock is stale or misspelt -> rename or remove the key so the mock matches the real class.',
      'Do not add it to mockedRepositoryMethods.baseline.json: the baseline only shrinks.',
    ].join('\n'));
  });

  it('2. the same mock against a class that has the method passes (happy path)', () => {
    const r = scan({ [PREFS]: prefsRepo('async findTimezone() { return null; }') },
      mockPrefs('findByUserId: jest.fn(), findTimezone: jest.fn()'));
    expect(r).toEqual({ sites: 1, checkedKeys: 3, checkedMethods: 2, findings: [], skips: {} });
  });

  it('3. requireActual spreads are exempt; listed keys beside them are still checked', () => {
    const r = scan({ [PREFS]: prefsRepo('') }, `
      jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
        ...jest.requireActual('@/lib/repositories/UserPreferencesRepository'),
        userPreferencesRepository: {
          ...(jest.requireActual('@/lib/repositories/UserPreferencesRepository') as Record<string, unknown>).userPreferencesRepository,
          findTimezone: jest.fn(),
        },
      }));
    `);
    expect(r.findings.map((f) => f.key)).toEqual([
      `${TEST} | @/lib/repositories/UserPreferencesRepository | userPreferencesRepository.findTimezone`,
    ]);
    expect(r.skips).toEqual({});
  });

  it('4. unreadable shapes are SKIPPED with their reason, never failed (incl. C-1 object exports)', () => {
    const files = {
      [PREFS]: prefsRepo(''),
      'lib/repositories/RateLimitRepository.ts': 'export const rateLimitRepository = { async consume() { return true; } };',
    };
    const r = scan(files, `
      jest.mock('@/lib/repositories/UserPreferencesRepository', () => { return { userPreferencesRepository: {} }; });
      jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({ userPreferencesRepository: mockPrefs }));
      jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({ ['userPreferences' + 'Repository']: {} }));
      jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({ userPreferencesRepository: { [dynamic]: jest.fn() } }));
      jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({ ...shared }));
      jest.mock('@/lib/repositories/UserPreferencesRepository', () => makeFactory());
      jest.mock('@/lib/repositories/UserPreferencesRepository');
      jest.mock('@/lib/repositories/RateLimitRepository', () => ({ rateLimitRepository: { consume: jest.fn(), invented: jest.fn() } }));
    `);
    expect(r.findings).toEqual([]);
    expect(r.sites).toBe(8);
    expect(r.skips).toEqual({
      'block-bodied-factory': 1,
      'instance-not-object-literal': 1,
      'computed-key': 2,
      'spread': 1,
      'factory-not-object-literal': 1,
      'no-factory': 1,
      'export-not-class-instance': 1,
    });
  });

  it('5. inherited members are found (same file, imported base, Error); an unresolvable base is SKIPPED', () => {
    const files = {
      'lib/repositories/BaseRepository.ts': 'export class BaseRepository { protected log() {} softDelete() {} }',
      'lib/repositories/A.ts': `
        import { BaseRepository } from './BaseRepository';
        class Middle extends BaseRepository { middle() {} }
        export class ARepository extends Middle { own() {} }
        export const aRepository = new ARepository();
        export class AError extends Error { code = 'x'; }
        export const aError = new AError();
      `,
      'lib/repositories/B.ts': `
        import { Base } from 'some-package';
        class BRepository extends Base {}
        export const bRepository = new BRepository();
      `,
    };
    const r = scan(files, `
      jest.mock('@/lib/repositories/A', () => ({
        aRepository: { own: jest.fn(), middle: jest.fn(), softDelete: jest.fn(), log: jest.fn(), ghost: jest.fn() },
        aError: { code: 'y', message: 'm', stack: '' },
      }));
      jest.mock('@/lib/repositories/B', () => ({ bRepository: { anything: jest.fn() } }));
    `);
    expect(r.findings.map((f) => f.key)).toEqual([`${TEST} | @/lib/repositories/A | aRepository.ghost`]);
    expect(r.skips).toEqual({ 'class-unresolvable': 1 });
  });

  it('6. getters, setters, arrow-function properties and constructor parameter properties count; statics do not', () => {
    const r = scan({
      'lib/repositories/C.ts': `
        export class CRepository {
          constructor(public client: unknown, readonly table: string, plain: number) {}
          get current() { return 1; }
          set current(v: number) {}
          findOne = async () => null;
          private secret() {}
          static create() { return new CRepository(null, 't', 1); }
        }
        export const cRepository = new CRepository(null, 't', 1);
      `,
    }, `jest.mock('@/lib/repositories/C', () => ({
      cRepository: { client: {}, table: 't', current: 1, findOne: jest.fn(), secret: jest.fn(), plain: 1, create: jest.fn() },
    }));`);
    expect(r.findings.map((f) => f.key.split(' | ')[2])).toEqual(['cRepository.plain', 'cRepository.create']);
  });

  it('7. a top-level key the module does not export fails as unknown-export; `export *` makes it a skip', () => {
    const r = scan({ [PREFS]: prefsRepo('') }, `
      jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({ __esModule: true, userPrefsRepo: {} }));
    `);
    expect(r.findings.map((f) => [f.kind, f.key])).toEqual([
      ['unknown-export', `${TEST} | @/lib/repositories/UserPreferencesRepository | userPrefsRepo`],
    ]);
    expect(r.findings[0].message).toContain(`but ${PREFS} does not export 'userPrefsRepo'`);

    const star = scan({ 'lib/repositories/index.ts': "export * from './X';", 'lib/repositories/X.ts': '' }, `
      jest.mock('@/lib/repositories', () => ({ whatever: {} }));
    `);
    expect(star.findings).toEqual([]);
    expect(star.skips).toEqual({ 'export-star': 1 });
  });

  it('8. relative specs, the barrel and jest.doMock are checked; non-repository specs are ignored', () => {
    const files = {
      [PREFS]: prefsRepo(''),
      'lib/repositories/index.ts': "export { UserPreferencesRepository, userPreferencesRepository } from './UserPreferencesRepository';",
      'lib/services/Other.ts': 'export const other = 1;',
    };
    const r = scan(files, `
      jest.mock('../../repositories/UserPreferencesRepository', () => ({ userPreferencesRepository: { relGhost: jest.fn() } }));
      jest.mock('@/lib/repositories', () => ({ userPreferencesRepository: { barrelGhost: jest.fn() }, UserPreferencesRepository: jest.fn() }));
      beforeEach(() => {
        jest.doMock('@/lib/repositories/UserPreferencesRepository', () => ({ userPreferencesRepository: { doMockGhost: jest.fn() } }));
      });
      jest.mock('@/lib/services/Other', () => ({ nope: 1 }));
      jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
    `);
    expect(r.sites).toBe(3);
    expect(r.findings.map((f) => f.key.split(' | ')[2])).toEqual([
      'userPreferencesRepository.relGhost',
      'userPreferencesRepository.barrelGhost',
      'userPreferencesRepository.doMockGhost',
    ]);
  });

  it('9. baseline ratchet: a listed finding is suppressed, a stale entry fails, an unlisted one fails', () => {
    const finding = (key: string): Finding => ({ kind: 'missing-method', key, message: key });
    expect(applyBaseline([finding('a')], ['a'])).toEqual({ unbaselined: [], stale: [] });
    expect(applyBaseline([], ['a'])).toEqual({ unbaselined: [], stale: ['a'] });
    expect(applyBaseline([finding('b')], ['a']).unbaselined.map((f) => f.key)).toEqual(['b']);
  });

  it('10. the live scan reaches the real repositories (and the F-13 class is resolvable)', () => {
    expect(realIndex.resolveExport(PREFS, 'userPreferencesRepository')).toMatchObject({
      kind: 'instance', className: 'UserPreferencesRepository',
    });
    expect(realIndex.resolveExport('lib/repositories/index.ts', 'agentRepository')).toMatchObject({ kind: 'instance' });
    expect(realIndex.resolveExport('lib/repositories/RateLimitRepository.ts', 'rateLimitRepository'))
      .toEqual({ kind: 'other' });
  });
});

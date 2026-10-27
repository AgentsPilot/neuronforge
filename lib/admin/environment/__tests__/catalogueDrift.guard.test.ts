/**
 * Catalogue drift guard (admin environment view EC-3; requirement §3.5 R-3 to
 * R-5; SA rulings OQ-9, Q-2, Q3-1 to Q3-8; conditions SA-C13, E3-1 to E3-3).
 *
 * Fails when:
 *   - code reads an environment variable the catalogue does not describe;
 *   - a catalogue entry is read by no code and carries no `consumedBy` marker;
 *   - an entry carries a `consumedBy` marker although code does read it;
 *   - a computed read the guard cannot resolve, or a whole-object use of
 *     `process.env`, appears that is not in PINNED_SITES, or a pinned one
 *     disappears (E3-1: pinned, never printed).
 *
 * What counts as a read: dot, bracket-literal and destructuring reads of
 * `process.env` in the deployed source roots; `${NAME}` placeholders in the
 * plugin definitions and `*EnvVar` fields in the plugin configs (the two JSON
 * read paths, kept honest by source pins on their readers); and
 * `process.env[CONST]` where CONST is a string constant declared in the same
 * file or imported through exactly one import.
 *
 * Budget (OQ-9): at most 5 s in its gate shard. A plain file read plus regex:
 * no TypeScript work on the scanned files. The scan runs once; each file is
 * read as bytes and only files whose bytes contain `process.env` (or `= process`) are decoded
 * (E3-3). Names only: this file never reads a `process.env` value or a
 * `.env*` file (SA-C14).
 *
 * The scanner is a set of pure functions so the negative controls can run it
 * on fixture text and an in-memory file map.
 */

import * as fs from 'fs';
import * as path from 'path';

import { ENVIRONMENT_CATALOGUE, type EnvCatalogueEntry } from '@/lib/admin/environment/catalogue';

// ── Scope ───────────────────────────────────────────────────────────────────

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SOURCE_ROOTS = ['app', 'lib', 'components', 'hooks'];
const ROOT_FILES = /^(?:middleware\.ts|next\.config\.js|instrumentation.*\.ts)$/;
const SOURCE_EXT = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(?:test|spec)\.[^./]+$/;
const SKIPPED_DIRS = new Set(['node_modules', '.next', '__tests__', '__mocks__']);
const PLUGIN_DEFINITIONS_DIR = 'lib/plugins/definitions';
const PLUGIN_CONFIGS_DIR = 'lib/plugins/v2/configs';

/** Is this repository-relative (posix) path a deployed source file the guard scans? */
function isScannedPath(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.some((part) => SKIPPED_DIRS.has(part))) return false;
  const base = parts[parts.length - 1];
  if (!SOURCE_EXT.test(base) || TEST_FILE.test(base)) return false;
  if (parts.length === 1) return ROOT_FILES.test(base);
  return SOURCE_ROOTS.includes(parts[0]);
}

// ── Scanner (pure) ──────────────────────────────────────────────────────────

/**
 * Removes `//` and block comments, keeps string and template text, and keeps
 * every line break so line numbers survive. A line comment ends at `\r` or
 * `\n`, so CRLF files behave as LF files do.
 */
function stripComments(src: string): string {
  let out = '';
  let quote: string | null = null;
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\' && i + 1 < n) {
        out += next;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    // QA §6.3 bug 1: outside a string, a backslash occurs only in a regex
    // literal (or JSX text) and escapes the next character, so `/\//` and
    // `/^\/*/` can no longer open a false comment that hides later reads.
    if (c === '\\' && i + 1 < n) {
      out += c + next;
      i += 2;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      out += src.slice(i, stop).replace(/[^\r\n]/g, ' ');
      i = stop;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

type SiteKind = 'computed' | 'whole-object' | 'rest';

interface UnresolvedSite {
  file: string;
  line: number;
  kind: SiteKind;
}

interface FileScan {
  /** Names read, from dot, bracket-literal, destructuring and resolved computed reads. */
  names: string[];
  unresolved: UnresolvedSite[];
}

/** Reads another repository file for the one-hop import resolution. Null when absent. */
type ReadRelated = (rel: string) => string | null;

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOT_READ = /\bprocess\.env\??\.([A-Za-z_][A-Za-z0-9_]*)/g;
const BRACKET_LITERAL = /\bprocess\.env\??\.?\[\s*(['"`])([A-Za-z_][A-Za-z0-9_]*)\1\s*\]/g;
const BRACKET_ANY = /\bprocess\.env\??\.?\[\s*(?!['"`][A-Za-z_][A-Za-z0-9_]*['"`]\s*\])([^\]]*)\]/g;
const DESTRUCTURE = /\{([^{}]*)\}\s*=\s*process\.env\b(?!\s*(?:\?\.|\.|\[))/g;
const WHOLE_OBJECT = /(?<!\}\s*=\s*)\bprocess\.env\b(?!\s*(?:\?\.|\.|\[))/g;
// QA §6.3 edge 3: `const { env } = process` (or `{ env: e }`) takes the whole object without the text `process.env`.
const ENV_FROM_PROCESS = /\{[^{}]*\benv\b[^{}]*\}\s*=\s*process\b(?!\s*(?:\?\.|\.|\[))/g;
const IMPORT_NAMED = /\bimport\s+(?:type\s+)?\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2/g;

function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function constantValue(code: string, ident: string, exportedOnly: boolean): string | null {
  const prefix = exportedOnly ? 'export\\s+' : '(?:export\\s+)?';
  const re = new RegExp(
    `(?:^|[^\\w$.])${prefix}(?:const|let|var)\\s+${escapeRegex(ident)}\\s*(?::[^=;]+)?=\\s*(['"\`])([A-Za-z_][A-Za-z0-9_]*)\\1`
  );
  const m = re.exec(code);
  return m ? m[2] : null;
}

function resolveSpecifier(fromRel: string, spec: string, readRelated: ReadRelated): { rel: string; text: string } | null {
  let base: string;
  if (spec.startsWith('@/')) base = spec.slice(2);
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}/index.ts`, `${base}/index.tsx`, `${base}/index.js`];
  for (const rel of candidates) {
    const text = readRelated(rel);
    if (text !== null) return { rel, text };
  }
  return null;
}

/** `process.env[IDENT]`: a same-file constant, else one import hop, else null. */
function resolveIdentifier(code: string, fileRel: string, ident: string, readRelated: ReadRelated): string | null {
  const local = constantValue(code, ident, false);
  if (local) return local;
  for (const m of code.matchAll(IMPORT_NAMED)) {
    for (const raw of m[1].split(',')) {
      const spec = raw.trim().replace(/^type\s+/, '');
      if (!spec) continue;
      const [orig, alias] = spec.split(/\s+as\s+/).map((s) => s.trim());
      if ((alias ?? orig) !== ident) continue;
      const target = resolveSpecifier(fileRel, m[3], readRelated);
      if (!target) return null;
      return constantValue(stripComments(target.text), orig, true);
    }
  }
  return null;
}

function scanSource(fileRel: string, text: string, readRelated: ReadRelated): FileScan {
  const code = stripComments(text);
  const names: string[] = [];
  const unresolved: UnresolvedSite[] = [];

  for (const m of code.matchAll(DOT_READ)) names.push(m[1]);
  for (const m of code.matchAll(BRACKET_LITERAL)) names.push(m[2]);
  for (const m of code.matchAll(BRACKET_ANY)) {
    const inner = m[1].trim();
    const resolved = VALID_NAME.test(inner) ? resolveIdentifier(code, fileRel, inner, readRelated) : null;
    if (resolved) names.push(resolved);
    else unresolved.push({ file: fileRel, line: lineAt(code, m.index ?? 0), kind: 'computed' });
  }
  for (const m of code.matchAll(DESTRUCTURE)) {
    for (const raw of m[1].split(',')) {
      const part = raw.trim();
      if (!part) continue;
      if (part.startsWith('...')) {
        unresolved.push({ file: fileRel, line: lineAt(code, m.index ?? 0), kind: 'rest' });
        continue;
      }
      const key = part.split(/[:=]/)[0].trim().replace(/^['"]|['"]$/g, '');
      if (VALID_NAME.test(key)) names.push(key);
    }
  }
  for (const m of code.matchAll(ENV_FROM_PROCESS)) {
    unresolved.push({ file: fileRel, line: lineAt(code, m.index ?? 0), kind: 'whole-object' });
  }
  for (const m of code.matchAll(WHOLE_OBJECT)) {
    unresolved.push({ file: fileRel, line: lineAt(code, m.index ?? 0), kind: 'whole-object' });
  }
  return { names, unresolved };
}

/** Names a plugin definition substitutes with `${NAME}`; non-name contents are skipped. */
function scanPluginDefinition(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$\{([^}]+)\}/g)) {
    const inner = m[1].trim();
    if (/^[A-Z_][A-Z0-9_]*$/.test(inner)) out.push(inner);
  }
  return out;
}

/** Names a plugin config points at through a `…EnvVar` field. */
function scanPluginConfig(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/"[A-Za-z]*EnvVar"\s*:\s*"([^"]*)"/g)) {
    if (VALID_NAME.test(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * E3-3: matches the bytes, never decodes a file that cannot contain a read.
 * The second and third needles admit `const { env } = process` (QA §6.3 edge 3).
 */
const NEEDLES = ['process.env', '= process', '=process'].map((s) => Buffer.from(s, 'utf8'));
function mayReadEnv(bytes: Buffer): boolean {
  return NEEDLES.some((needle) => bytes.indexOf(needle) >= 0);
}

// ── Comparison (pure) ───────────────────────────────────────────────────────

interface PinnedSite {
  file: string;
  kind: SiteKind;
  /** How many such sites the file holds, so a second one is not hidden behind the first. */
  count: number;
  why: string;
}

interface DriftReport {
  missing: Array<{ name: string; file: string }>;
  unreferenced: string[];
  staleMarkers: string[];
  newSites: string[];
  vanishedSites: string[];
}

function compareWithCatalogue(
  readers: ReadonlyMap<string, string>,
  unresolved: readonly UnresolvedSite[],
  catalogue: readonly Pick<EnvCatalogueEntry, 'name' | 'consumedBy'>[],
  pinned: readonly PinnedSite[]
): DriftReport {
  const catalogued = new Map(catalogue.map((entry) => [entry.name, entry]));
  const missing = [...readers.entries()]
    .filter(([name]) => !catalogued.has(name))
    .map(([name, file]) => ({ name, file }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const unreferenced = catalogue.filter((e) => !readers.has(e.name) && !e.consumedBy).map((e) => e.name);
  const staleMarkers = catalogue.filter((e) => e.consumedBy && readers.has(e.name)).map((e) => e.name);

  const found = new Map<string, number>();
  for (const site of unresolved) {
    const key = `${site.file} ${site.kind}`;
    found.set(key, (found.get(key) ?? 0) + 1);
  }
  const expected = new Map(pinned.map((p) => [`${p.file} ${p.kind}`, p.count]));
  const newSites: string[] = [];
  for (const [key, count] of found) {
    const allowed = expected.get(key) ?? 0;
    if (count > allowed) {
      const lines = unresolved.filter((s) => `${s.file} ${s.kind}` === key).map((s) => s.line);
      newSites.push(`${key} (found ${count}, pinned ${allowed}; lines ${lines.join(', ')})`);
    }
  }
  const vanishedSites: string[] = [];
  for (const [key, count] of expected) {
    const have = found.get(key) ?? 0;
    if (have < count) vanishedSites.push(`${key} (pinned ${count}, found ${have})`);
  }
  return { missing, unreferenced, staleMarkers, newSites: newSites.sort(), vanishedSites: vanishedSites.sort() };
}

// ── Pinned unresolved sites (E3-1, amends SA-C13 and R-4) ──────────────────
//
// A computed read the guard cannot resolve, or a use of the whole
// `process.env` object, is pinned here with its reason. A new one fails:
// make it resolvable (a string constant in the same file, or one import away)
// or add it here with a reason. A pinned one that disappears also fails, so
// the list cannot go slack.

const PINNED_SITES: readonly PinnedSite[] = [
  {
    file: 'app/api/admin/environment/route.ts',
    kind: 'whole-object',
    count: 1,
    why: 'Passes the whole environment to the classifier, which enumerates it by design (SA-C8).',
  },
  {
    file: 'app/api/analyze-prompt-clarity/route.ts',
    kind: 'computed',
    count: 1,
    why: 'Checks a list of names for presence; each name in that list is also read literally elsewhere.',
  },
  {
    file: 'lib/plugins/v2/core/UniversalOAuthHandler.ts',
    kind: 'computed',
    count: 2,
    why: 'Reads the client id and secret named by a plugin config; the guard reads those names from the config JSON.',
  },
  {
    file: 'lib/server/plugin-manager-v2.ts',
    kind: 'computed',
    count: 1,
    why: 'Substitutes plugin definition placeholders; the guard reads those names from the definition JSON.',
  },
  {
    file: 'lib/testing/plugin-secret-matcher.ts',
    kind: 'computed',
    count: 1,
    why: 'A test helper that writes fixture values, not a read.',
  },
];

// ── Real-tree scan (once) ───────────────────────────────────────────────────

function readRepoFile(rel: string): string | null {
  try {
    return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

interface TreeScan {
  filesScanned: number;
  literalNames: Set<string>;
  readers: Map<string, string>;
  unresolved: UnresolvedSite[];
  definitionFiles: number;
  configFiles: number;
}

function scanTree(): TreeScan {
  const files: string[] = [];
  const walk = (dirRel: string) => {
    for (const dirent of fs.readdirSync(path.join(REPO_ROOT, dirRel), { withFileTypes: true })) {
      const rel = `${dirRel}/${dirent.name}`;
      if (dirent.isDirectory()) {
        if (!SKIPPED_DIRS.has(dirent.name)) walk(rel);
      } else if (isScannedPath(rel)) {
        files.push(rel);
      }
    }
  };
  for (const root of SOURCE_ROOTS) walk(root);
  for (const name of fs.readdirSync(REPO_ROOT)) if (isScannedPath(name)) files.push(name);

  const readers = new Map<string, string>();
  const literalNames = new Set<string>();
  const unresolved: UnresolvedSite[] = [];
  const note = (name: string, file: string) => {
    if (!readers.has(name)) readers.set(name, file);
  };

  for (const rel of files.sort()) {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, rel));
    if (!mayReadEnv(bytes)) continue;
    const result = scanSource(rel, bytes.toString('utf8'), readRepoFile);
    for (const name of result.names) {
      literalNames.add(name);
      note(name, rel);
    }
    unresolved.push(...result.unresolved);
  }

  const jsonIn = (dirRel: string) =>
    fs.readdirSync(path.join(REPO_ROOT, dirRel)).filter((f) => f.endsWith('.json')).map((f) => `${dirRel}/${f}`);
  const definitions = jsonIn(PLUGIN_DEFINITIONS_DIR);
  const configs = jsonIn(PLUGIN_CONFIGS_DIR);
  for (const rel of definitions) for (const name of scanPluginDefinition(readRepoFile(rel) ?? '')) note(name, rel);
  for (const rel of configs) for (const name of scanPluginConfig(readRepoFile(rel) ?? '')) note(name, rel);

  return {
    filesScanned: files.length,
    literalNames,
    readers,
    unresolved,
    definitionFiles: definitions.length,
    configFiles: configs.length,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('environment catalogue drift guard (EC-3)', () => {
  let tree: TreeScan;
  let report: DriftReport;

  // Q3-2: a runaway stop only; the 5 s budget is measured, not asserted.
  beforeAll(() => {
    tree = scanTree();
    report = compareWithCatalogue(tree.readers, tree.unresolved, ENVIRONMENT_CATALOGUE, PINNED_SITES);
  }, 15_000);

  describe('G3-1 the real tree', () => {
    it('G3-1a every name the code reads is in the catalogue', () => {
      const lines = report.missing.map((m) => `${m.name} (read in ${m.file})`);
      expect({
        missing: lines,
        fix: lines.length
          ? "Add an entry to lib/admin/environment/catalogue.ts in this PR. See docs/FEATURE_FLAGS.md, 'Adding an environment variable'."
          : null,
      }).toEqual({ missing: [], fix: null });
    });

    it('G3-1b every catalogue entry is read by code, or carries a consumedBy marker', () => {
      expect({
        unreferenced: report.unreferenced,
        fix: report.unreferenced.length ? 'Remove the entry, or add consumedBy with its one-line note.' : null,
      }).toEqual({ unreferenced: [], fix: null });
    });

    it('G3-1c no entry carries a consumedBy marker while code reads it', () => {
      expect({
        staleMarkers: report.staleMarkers,
        fix: report.staleMarkers.length ? 'Code reads these names now: remove their consumedBy marker.' : null,
      }).toEqual({ staleMarkers: [], fix: null });
    });

    it('G3-1d floors: the scan really ran', () => {
      expect(tree.filesScanned).toBeGreaterThanOrEqual(1000);
      expect(tree.literalNames.size).toBeGreaterThanOrEqual(50);
      expect(tree.definitionFiles).toBeGreaterThanOrEqual(20);
      expect(tree.configFiles).toBeGreaterThanOrEqual(1);
    });

    it('G3-1e the two JSON read paths still read the environment as the guard assumes', () => {
      const manager = stripComments(readRepoFile('lib/server/plugin-manager-v2.ts') ?? '');
      expect(manager).toContain('/\\$\\{([^}]+)\\}/g');
      expect(manager).toMatch(/process\.env\[varName\]/);
      const oauth = stripComments(readRepoFile('lib/plugins/v2/core/UniversalOAuthHandler.ts') ?? '');
      expect(oauth).toMatch(/process\.env\[this\.config\.oauth\.clientIdEnvVar\]/);
      expect(oauth).toMatch(/process\.env\[this\.config\.oauth\.clientSecretEnvVar\]/);
    });

    it('G3-1f unresolved computed reads and whole-object uses match the pinned list (E3-1)', () => {
      expect({
        newSites: report.newSites,
        vanishedSites: report.vanishedSites,
        fix:
          report.newSites.length || report.vanishedSites.length
            ? 'Make a new read resolvable (a string constant in the file, or one import away) or pin it in PINNED_SITES with a reason; remove pins whose site is gone.'
            : null,
      }).toEqual({ newSites: [], vanishedSites: [], fix: null });
      for (const pin of PINNED_SITES) expect(pin.why.trim().length).toBeGreaterThan(10);
    });
  });

  describe('G3-2 negative controls (fixture text only)', () => {
    const noFiles: ReadRelated = () => null;
    const namesOf = (text: string, file = 'lib/fixture.ts', read: ReadRelated = noFiles) => scanSource(file, text, read).names;
    const fakeCatalogue = [{ name: 'FAKE_DRIFT_KNOWN' }] as Pick<EnvCatalogueEntry, 'name' | 'consumedBy'>[];

    it('N-1 an uncatalogued dot read is reported missing', () => {
      const scan = scanSource('lib/fixture.ts', 'const a = process.env.FAKE_DRIFT_ALPHA;', noFiles);
      const readers = new Map(scan.names.map((n) => [n, 'lib/fixture.ts']));
      const result = compareWithCatalogue(readers, [], fakeCatalogue, []);
      expect(result.missing).toEqual([{ name: 'FAKE_DRIFT_ALPHA', file: 'lib/fixture.ts' }]);
      expect(result.unreferenced).toEqual(['FAKE_DRIFT_KNOWN']);
    });

    it('N-2 bracket reads with each quote style', () => {
      expect(namesOf("process.env['FAKE_A']; process.env[\"FAKE_B\"]; process.env[`FAKE_C`]; process.env?.['FAKE_D']")).toEqual([
        'FAKE_A',
        'FAKE_B',
        'FAKE_C',
        'FAKE_D',
      ]);
    });

    it('N-3 destructuring: plain, aliased, default, multi-line CRLF, rest', () => {
      const text = 'const {\r\n  FAKE_A,\r\n  FAKE_B: b,\r\n  FAKE_C = "x",\r\n  ...others\r\n} = process.env;';
      const scan = scanSource('lib/fixture.ts', text, noFiles);
      expect(scan.names).toEqual(['FAKE_A', 'FAKE_B', 'FAKE_C']);
      expect(scan.unresolved.map((s) => s.kind)).toEqual(['rest']);
    });

    it('N-4 optional chaining', () => {
      expect(namesOf('const a = process.env?.FAKE_OPT;')).toEqual(['FAKE_OPT']);
    });

    it('N-5 names in comments are not reads', () => {
      const text = '// process.env.FAKE_LINE\n/* process.env.FAKE_BLOCK */\n/**\n * process.env.FAKE_DOC\n */\nconst x = 1;';
      expect(namesOf(text)).toEqual([]);
    });

    it('N-6 `//` inside a string is not a comment', () => {
      expect(namesOf("const u = 'https://example.test' + process.env.FAKE_AFTER_URL;")).toEqual(['FAKE_AFTER_URL']);
    });

    it('N-7 CRLF: a line comment ends at \\r\\n and the next line is read', () => {
      const text = 'const a = 1; // process.env.FAKE_COMMENTED\r\nconst b = process.env.FAKE_NEXT_LINE;\r\n';
      expect(namesOf(text)).toEqual(['FAKE_NEXT_LINE']);
      expect(scanSource('lib/fixture.ts', text, noFiles).unresolved).toEqual([]);
    });

    it('N-8 a same-file constant is resolved (export, type annotation, as const)', () => {
      expect(namesOf("const KEY = 'FAKE_CONST_A';\nprocess.env[KEY];")).toEqual(['FAKE_CONST_A']);
      expect(namesOf("export const KEY: string = 'FAKE_CONST_B';\nprocess.env[KEY];")).toEqual(['FAKE_CONST_B']);
      expect(namesOf("const KEY = 'FAKE_CONST_C' as const;\nprocess.env[ KEY ];")).toEqual(['FAKE_CONST_C']);
    });

    it('N-9 an imported constant is resolved through one hop (alias path, relative path, renamed import)', () => {
      const files: Record<string, string> = {
        'lib/consts/names.ts': "export const NAME_ENV = 'FAKE_IMPORTED_A';",
        'lib/feature/local.ts': "export const OTHER = 'FAKE_IMPORTED_B';",
      };
      const read: ReadRelated = (rel) => files[rel] ?? null;
      expect(namesOf("import { NAME_ENV } from '@/lib/consts/names';\nprocess.env[NAME_ENV];", 'lib/feature/a.ts', read)).toEqual([
        'FAKE_IMPORTED_A',
      ]);
      expect(namesOf("import { OTHER as K } from './local';\nprocess.env[K];", 'lib/feature/a.ts', read)).toEqual(['FAKE_IMPORTED_B']);
    });

    it('N-10 a two-hop re-export and a member expression stay unresolved, without a crash', () => {
      const files: Record<string, string> = { 'lib/consts/index.ts': "export { NAME_ENV } from './names';" };
      const read: ReadRelated = (rel) => files[rel] ?? null;
      const twoHop = scanSource('lib/a.ts', "import { NAME_ENV } from '@/lib/consts';\nprocess.env[NAME_ENV];", read);
      expect(twoHop.names).toEqual([]);
      expect(twoHop.unresolved).toEqual([{ file: 'lib/a.ts', line: 2, kind: 'computed' }]);
      const member = scanSource('lib/a.ts', 'process.env[this.config.idVar];', noFiles);
      expect(member.unresolved.map((s) => s.kind)).toEqual(['computed']);
    });

    it('N-11 plugin JSON: placeholders and EnvVar fields are reads; a non-name placeholder is skipped', () => {
      expect(scanPluginDefinition('{"a":"${FAKE_PLACEHOLDER}","b":"${amount/100}","c":"x ${ FAKE_SPACED } y"}')).toEqual([
        'FAKE_PLACEHOLDER',
        'FAKE_SPACED',
      ]);
      expect(scanPluginConfig('{"oauth":{"clientIdEnvVar": "FAKE_CLIENT_ID","clientSecretEnvVar":"FAKE_CLIENT_SECRET"}}')).toEqual([
        'FAKE_CLIENT_ID',
        'FAKE_CLIENT_SECRET',
      ]);
    });

    it('N-12 unreferenced entry, marked entry, and a stale marker', () => {
      const catalogue = [
        { name: 'FAKE_UNREAD' },
        { name: 'FAKE_MARKED', consumedBy: { by: 'sdk', note: 'Read by a fake library only.' } },
        { name: 'FAKE_STALE', consumedBy: { by: 'sdk', note: 'Read by a fake library only.' } },
      ] as Pick<EnvCatalogueEntry, 'name' | 'consumedBy'>[];
      const result = compareWithCatalogue(new Map([['FAKE_STALE', 'lib/x.ts']]), [], catalogue, []);
      expect(result.unreferenced).toEqual(['FAKE_UNREAD']);
      expect(result.staleMarkers).toEqual(['FAKE_STALE']);
      expect(result.missing).toEqual([]);
    });

    it('N-13 the path filter', () => {
      expect(isScannedPath('lib/x.ts')).toBe(true);
      expect(isScannedPath('hooks/useX.tsx')).toBe(true);
      expect(isScannedPath('middleware.ts')).toBe(true);
      expect(isScannedPath('next.config.js')).toBe(true);
      expect(isScannedPath('instrumentation-client.ts')).toBe(true);
      for (const rel of [
        'lib/x.test.ts',
        'app/x.spec.tsx',
        'lib/a/__tests__/b.ts',
        'lib/a/__mocks__/b.ts',
        'lib/node_modules/p/i.js',
        'scripts/x.ts',
        'tests/x.ts',
        'lib/x.json',
        'other.ts',
      ]) {
        expect({ rel, scanned: isScannedPath(rel) }).toEqual({ rel, scanned: false });
      }
    });

    it('N-14 the byte prefilter cannot hide a read', () => {
      const samples = [
        'const a = process.env.FAKE_P;',
        'const { FAKE_Q } = process.env;',
        "process.env['FAKE_R']",
        'const x = 1;',
        'const proc = process; proc.env;',
      ];
      for (const text of samples) {
        const passes = mayReadEnv(Buffer.from(text, 'utf8'));
        const found = scanSource('lib/f.ts', text, noFiles);
        if (!passes) expect({ text, names: found.names, unresolved: found.unresolved }).toEqual({ text, names: [], unresolved: [] });
      }
      expect(mayReadEnv(Buffer.from('const a = process.env.FAKE_P;'))).toBe(true);
      expect(mayReadEnv(Buffer.from('const x = 1;'))).toBe(false);
    });

    it('N-15 a read inside a template literal (E3-3)', () => {
      const text = 'const url = `${process.env.FAKE_TEMPLATE_BASE}/path`;';
      expect(mayReadEnv(Buffer.from(text, 'utf8'))).toBe(true);
      expect(namesOf(text)).toEqual(['FAKE_TEMPLATE_BASE']);
    });

    it('N-16 whole-object uses are sites; destructuring is not one', () => {
      const scan = scanSource('lib/f.ts', 'run(process.env);\nconst env = process.env;\nconst { FAKE_X } = process.env;', noFiles);
      expect(scan.unresolved).toEqual([
        { file: 'lib/f.ts', line: 1, kind: 'whole-object' },
        { file: 'lib/f.ts', line: 2, kind: 'whole-object' },
      ]);
      expect(scan.names).toEqual(['FAKE_X']);
    });

    it('N-19 regex literals cannot open a false comment (QA §6.3 bug 1)', () => {
      // `\//` used to read as a line comment, hiding the rest of the line.
      expect(namesOf("const p = s.replace(/\\//g, '-') + process.env.FAKE_AFTER_SLASH_REGEX;")).toEqual(['FAKE_AFTER_SLASH_REGEX']);
      // `\/*` used to read as a block comment, hiding the rest of the file.
      const text = "const lead = /^\\/*/;\nconst a = 1;\nconst b = process.env.FAKE_AFTER_STAR_REGEX;\n";
      expect(namesOf(text)).toEqual(['FAKE_AFTER_STAR_REGEX']);
      // And both still fail the guard when the name is uncatalogued.
      const readers = new Map(
        [...namesOf("s.replace(/\\//g, '') + process.env.FAKE_AFTER_SLASH_REGEX"), ...namesOf(text)].map((n) => [n, 'lib/fixture.ts'])
      );
      expect(compareWithCatalogue(readers, [], fakeCatalogue, []).missing.map((m) => m.name)).toEqual([
        'FAKE_AFTER_SLASH_REGEX',
        'FAKE_AFTER_STAR_REGEX',
      ]);
      // A real comment after an escaped slash is still a comment.
      expect(namesOf("const p = /\\//; // process.env.FAKE_STILL_COMMENTED\n")).toEqual([]);
    });

    it('N-20 `const { env } = process` is an unpinned whole-object site (QA §6.3 edge 3)', () => {
      for (const text of ['const { env } = process;\nenv.FAKE_X;', 'const { env: e } = process;', 'const { argv, env } =process;']) {
        expect(mayReadEnv(Buffer.from(text, 'utf8'))).toBe(true);
        const scan = scanSource('lib/f.ts', text, noFiles);
        expect(scan.unresolved).toEqual([{ file: 'lib/f.ts', line: 1, kind: 'whole-object' }]);
        expect(compareWithCatalogue(new Map(), scan.unresolved, [], PINNED_SITES).newSites).toEqual([
          'lib/f.ts whole-object (found 1, pinned 0; lines 1)',
        ]);
      }
      // `const e = process.env` was already a site (N-16); `const { argv } = process` is not one.
      expect(scanSource('lib/f.ts', 'const e = process.env;', noFiles).unresolved.map((s) => s.kind)).toEqual(['whole-object']);
      expect(scanSource('lib/f.ts', 'const { argv } = process;', noFiles).unresolved).toEqual([]);
    });

    it('N-17 a write counts as a read (Q3-3)', () => {
      expect(namesOf("process.env.FAKE_WRITTEN = 'x';")).toEqual(['FAKE_WRITTEN']);
    });

    it('N-18 the pinned list fails on a new site and on a vanished one', () => {
      const pinned: PinnedSite[] = [
        { file: 'lib/a.ts', kind: 'computed', count: 1, why: 'A fake pinned site.' },
        { file: 'lib/gone.ts', kind: 'computed', count: 1, why: 'A fake pinned site that is gone.' },
      ];
      const sites: UnresolvedSite[] = [
        { file: 'lib/a.ts', line: 3, kind: 'computed' },
        { file: 'lib/a.ts', line: 9, kind: 'computed' },
        { file: 'lib/b.ts', line: 1, kind: 'whole-object' },
      ];
      const result = compareWithCatalogue(new Map(), sites, [], pinned);
      expect(result.newSites).toEqual([
        'lib/a.ts computed (found 2, pinned 1; lines 3, 9)',
        'lib/b.ts whole-object (found 1, pinned 0; lines 1)',
      ]);
      expect(result.vanishedSites).toEqual(['lib/gone.ts computed (pinned 1, found 0)']);
    });
  });
});

/**
 * Source guards for the environment configuration hardening
 * (docs/requirements/ENV_CONFIG_HARDENING_REQUIREMENT.md, and PROD-1a for
 * G-4 and G-5). Plain file reads only.
 *
 * G-1 next.config.js passes no NANGO_* name through the build.
 * G-2 no code under lib/, app/ or components/ reads the old public-prefixed
 *     Slack secret name; V1 and V2 Slack code both use SLACK_CLIENT_SECRET.
 * G-3 the V1 Slack strategy reads SLACK_CLIENT_SECRET.
 * G-4 no code reads the retired server-only Supabase address variable. There
 *     is one Supabase address, NEXT_PUBLIC_SUPABASE_URL; two settable
 *     addresses let service-role writes land in another project (PROD-1a, A1).
 * G-5 no code or test hardcodes a Supabase project ref. A hardcoded ref is how
 *     the middleware's onboarding gate went silently off on any other project
 *     (PROD-1a, A2), and a test that hardcodes one goes vacuous when the code
 *     stops using it.
 *
 * ONE PASS (SA C-9). Every file is read once, as bytes; only a file whose
 * bytes contain a needle is decoded, and every rule runs over it in that
 * single pass. Only hits are kept, never file bodies. Budget: at most +1 s
 * for this suite on CI.
 *
 * LINE-ENDING PROOF. Content is normalised once (CR LF and lone CR to LF), so
 * line numbers agree across platforms. No pattern contains a newline, an
 * anchor or the multiline flag; boundaries are character lookarounds.
 * Relative paths are normalised to `/` before any comparison (C-8 b). The
 * self-tests run every matcher over LF and CRLF forms of the same text.
 *
 * NO COMMENT STRIPPING (C-8 a). A quoted retired name in a comment is a hit:
 * describe the variable in prose instead of quoting it.
 *
 * Names and refs are built from parts so this guard does not match itself.
 */

import * as fs from 'fs';
import * as path from 'path';

import { SUPABASE_PROJECTS } from '@/lib/admin/environment/supabaseProjects';

const ROOT = path.resolve(__dirname, '..', '..');
const OLD_SLACK_NAME = ['NEXT', 'PUBLIC', 'SLACK', 'CLIENT', 'SECRET'].join('_');
const RETIRED_NAME = ['SUPABASE', 'URL'].join('_');
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const WORKFLOW_EXT = /\.ya?ml$/;
/** Walked recursively. The walk skips dot-directories, so workflows are listed on their own. */
const WALK_DIRS = ['lib', 'app', 'components', 'hooks', 'scripts', 'tests'];
const WORKFLOW_DIR = '.github/workflows';
const ROOT_FILES = ['middleware.ts', 'next.config.js'];
/** A setup file, not a test: where a stub would hide a reintroduced import-time reader. */
const JEST_SETUP = 'tests/plugins/jest-setup.ts';

const CATALOGUE = 'lib/admin/environment/catalogue.ts';
const PROJECT_MAP = 'lib/admin/environment/supabaseProjects.ts';
const GENERATED_CATALOG = 'lib/business-os/catalog/catalog.generated.ts';

/** G-4 exemptions: they name the variable so the admin Environment page can report it. */
const G4_EXEMPT = new Set([CATALOGUE, PROJECT_MAP]);
/** G-5 exemption: the label map itself. `catalog.generated.ts` is line-confined instead (below). */
const G5_EXEMPT = new Set([PROJECT_MAP]);
/**
 * `catalog.generated.ts` is written by the catalog generator from the
 * configured address, and nothing reads its `source` at runtime (every reader
 * indexes `.tables`). A hand edit would be overwritten, so its two provenance
 * lines may carry the host; any other line may not (C-8 e).
 */
const GENERATED_PROVENANCE_LINE = /(?:Source\s*:|"source"\s*:)/;

const KNOWN_REFS = [...SUPABASE_PROJECTS.keys()];

// ── Matchers (pure) ─────────────────────────────────────────────────────────

const B = '(?<![A-Za-z0-9_])';
const E = '(?![A-Za-z0-9_])';
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every form a read (or a setter) of `name` can take. */
function retiredNamePatterns(name: string): RegExp[] {
  const n = escapeRegExp(name);
  return [
    new RegExp(`process\\.env\\??\\.${n}${E}`, 'g'),
    new RegExp(`process\\.env\\??\\.?\\[\\s*['"\`]${n}['"\`]\\s*\\]`, 'g'),
    // A quoted literal: `required` lists, `Deno.env.get(…)`, a bracket read.
    new RegExp(`(['"\`])${n}\\1`, 'g'),
    // Destructuring from process.env, across lines.
    new RegExp(`\\{[^{}]*${B}${n}${E}[^{}]*\\}\\s*=\\s*process\\.env${E}`, 'g'),
    // A key: a YAML `env:` entry, or an object key handing it to a child process.
    new RegExp(`${B}${n}\\s*:(?!:)`, 'g'),
    // Workflow expressions, or `env.NAME` off any alias of process.env.
    new RegExp(`(?<![A-Za-z0-9_$])(?:secrets|vars|env)\\.${n}${E}`, 'g'),
  ];
}

/** Hardcoded project refs: every known ref, and the two shapes a hosted ref takes. */
function refPatterns(knownRefs: readonly string[]): RegExp[] {
  return [
    ...knownRefs.map((ref) => new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(ref)}(?![A-Za-z0-9])`, 'g')),
    /(?<![A-Za-z0-9-])[a-z0-9]{20}\.supabase\.(?:co|in)(?![A-Za-z0-9])/g,
    /(?<![A-Za-z0-9])sb-[a-z0-9]{20}-auth-token/g,
  ];
}

const normalise = (text: string): string => text.replace(/\r\n?/g, '\n');

/** 1-based line numbers of every match, deduplicated. `text` must be normalised. */
function hitLines(text: string, patterns: readonly RegExp[]): number[] {
  const lines = new Set<number>();
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      let line = 1;
      for (let i = 0; i < (match.index ?? 0); i += 1) if (text.charCodeAt(i) === 10) line += 1;
      lines.add(line);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

// ── Scope ───────────────────────────────────────────────────────────────────

const toPosix = (rel: string): string => rel.split(path.sep).join('/');

function isTestFile(rel: string): boolean {
  if (rel === JEST_SETUP) return false;
  return rel.startsWith('tests/') || rel.split('/').includes('__tests__') || /\.(test|spec)\.[a-z]+$/.test(rel);
}

/** G-4 scope: deployed and operator code, root config, workflows and the Jest setup file. */
function inG4Scope(rel: string): boolean {
  return !isTestFile(rel);
}

/** G-2's original scope, unchanged. */
function inG2Scope(rel: string): boolean {
  return /^(lib|app|components)\//.test(rel) && !isTestFile(rel) && rel !== CATALOGUE;
}

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.test(entry.name)) out.push(full);
  }
}

interface Hit {
  file: string;
  line: number;
  /** The text of the hit line, kept only for the generated-catalog confinement check. */
  text?: string;
}

interface ScanResult {
  counts: { g2: number; g4: number; g5: number; workflows: number };
  g2: string[];
  g4: Hit[];
  g5: Hit[];
}

function scanRepository(): ScanResult {
  const files: string[] = [];
  for (const dir of WALK_DIRS) walk(path.join(ROOT, dir), files);
  for (const name of ROOT_FILES) files.push(path.join(ROOT, name));
  const workflowDir = path.join(ROOT, WORKFLOW_DIR);
  const workflows = fs.readdirSync(workflowDir).filter((name) => WORKFLOW_EXT.test(name));
  for (const name of workflows) files.push(path.join(workflowDir, name));

  const g4Patterns = retiredNamePatterns(RETIRED_NAME);
  const g5Patterns = refPatterns(KNOWN_REFS);
  const slackNeedle = Buffer.from(OLD_SLACK_NAME);
  const retiredNeedle = Buffer.from(RETIRED_NAME);
  const refNeedles = [Buffer.from('.supabase.'), Buffer.from('-auth-token'), ...KNOWN_REFS.map((ref) => Buffer.from(ref))];

  const result: ScanResult = { counts: { g2: 0, g4: 0, g5: 0, workflows: workflows.length }, g2: [], g4: [], g5: [] };

  for (const full of files) {
    const rel = toPosix(path.relative(ROOT, full));
    const g2 = inG2Scope(rel);
    const g4 = inG4Scope(rel);
    // G-5 covers G-4's scope plus every test file, which is every file walked.
    if (g2) result.counts.g2 += 1;
    if (g4) result.counts.g4 += 1;
    result.counts.g5 += 1;

    const bytes = fs.readFileSync(full);
    const wantG2 = g2 && bytes.includes(slackNeedle);
    const wantG4 = g4 && !G4_EXEMPT.has(rel) && bytes.includes(retiredNeedle);
    const wantG5 = !G5_EXEMPT.has(rel) && refNeedles.some((needle) => bytes.includes(needle));
    if (!wantG2 && !wantG4 && !wantG5) continue;

    const text = normalise(bytes.toString('utf8'));
    if (wantG2 && text.includes(OLD_SLACK_NAME)) result.g2.push(rel);
    if (wantG4) for (const line of hitLines(text, g4Patterns)) result.g4.push({ file: rel, line });
    if (wantG5) {
      const hits = hitLines(text, g5Patterns);
      if (hits.length > 0) {
        const lines = text.split('\n');
        for (const line of hits) result.g5.push({ file: rel, line, text: lines[line - 1] });
      }
    }
  }
  return result;
}

const describeHits = (hits: Hit[]): string[] => hits.map((hit) => `${hit.file}:${hit.line}`);

/** G-5 hits that are allowed: the generated catalog's provenance lines only. */
function isAllowedRefHit(hit: Hit): boolean {
  return hit.file === GENERATED_CATALOG && GENERATED_PROVENANCE_LINE.test(hit.text ?? '');
}

// ── The guards ──────────────────────────────────────────────────────────────

describe('environment configuration hardening guards', () => {
  let scan: ScanResult;

  beforeAll(() => {
    scan = scanRepository();
  });

  it('G-1 next.config.js names no NANGO_ variable', () => {
    const src = fs.readFileSync(path.join(ROOT, 'next.config.js'), 'utf8');
    expect(src).not.toMatch(/NANGO_/);
  });

  it('G-2 no source file reads the old public-prefixed Slack secret name', () => {
    // A broken walk would scan nothing and pass vacuously.
    expect(scan.counts.g2).toBeGreaterThan(100);
    expect(scan.g2).toEqual([]);
  });

  it('G-3 the V1 Slack strategy reads SLACK_CLIENT_SECRET', () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib', 'plugins', 'strategies', 'slackPluginStrategy.ts'), 'utf8');
    expect(src).toContain('process.env.SLACK_CLIENT_SECRET');
  });

  it('G-4 no code reads the retired Supabase address variable; read NEXT_PUBLIC_SUPABASE_URL', () => {
    // Floors, so a broken walk cannot pass vacuously.
    expect(scan.counts.g4).toBeGreaterThan(1000);
    expect(scan.counts.workflows).toBeGreaterThan(3);
    // Each offender is file:line. Fix: read process.env.NEXT_PUBLIC_SUPABASE_URL instead.
    expect(describeHits(scan.g4)).toEqual([]);
  });

  it('G-5 no code or test hardcodes a Supabase project ref; derive it from NEXT_PUBLIC_SUPABASE_URL', () => {
    expect(scan.counts.g5).toBeGreaterThan(scan.counts.g4);
    // Each offender is file:line. Fix: derive from the configured address, or build a fixture from parts.
    expect(describeHits(scan.g5.filter((hit) => !isAllowedRefHit(hit)))).toEqual([]);
  });
});

// ── Self-tests: the guard can fail ──────────────────────────────────────────

describe('G-4 and G-5 matchers (self-tests)', () => {
  const crlf = (text: string): string => text.replace(/\n/g, '\r\n');
  const g4 = retiredNamePatterns(RETIRED_NAME);
  const ref20 = 'k'.repeat(20);
  const knownFixture = `${'k'.repeat(19)}x`;
  const g5 = refPatterns([knownFixture]);

  const FORBIDDEN_G4 = [
    `const url = process.env.${RETIRED_NAME}`,
    `const url = process.env?.${RETIRED_NAME}!`,
    `const url = process.env['${RETIRED_NAME}']`,
    `const url = process.env[ "${RETIRED_NAME}" ]`,
    `const required = ['${RETIRED_NAME}', 'X']`,
    `const url = Deno.env.get("${RETIRED_NAME}")`,
    `const {\n  ${RETIRED_NAME},\n  OTHER\n} = process.env`,
    `const { ${RETIRED_NAME}: url } = process.env`,
    `        env:\n          ${RETIRED_NAME}: 'https://ci.invalid'`,
    `run: echo \${{ secrets.${RETIRED_NAME} }}`,
    `run: echo \${{ vars.${RETIRED_NAME} }}`,
    `if: env.${RETIRED_NAME} != ''`,
    `// \`${RETIRED_NAME}\` in a comment counts (no comment stripping)`,
  ];

  const ALLOWED_G4 = [
    'const url = process.env.NEXT_PUBLIC_SUPABASE_URL',
    "const required = ['NEXT_PUBLIC_SUPABASE_URL']",
    `import { ${RETIRED_NAME}_ROW_NAMES } from './supabaseProjects'`,
    `for (const name of ${RETIRED_NAME}_ROW_NAMES) {}`,
    `const ${RETIRED_NAME} = process.env.NEXT_PUBLIC_SUPABASE_URL!;`,
    `if (!${RETIRED_NAME} || !KEY) return;`,
    `createClient(${RETIRED_NAME}, KEY)`,
    `NEXT_PUBLIC_SUPABASE_URL: 'https://ci.invalid'`,
  ];

  it.each(FORBIDDEN_G4.map((text) => [text]))('G-4 catches %p in LF and CRLF, on the same line', (text) => {
    const sample = `// first line\n${text}`;
    const lf = hitLines(normalise(sample), g4);
    expect(lf.length).toBeGreaterThan(0);
    // Never the decoy first line; never past the sample's last line.
    expect(Math.min(...lf)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...lf)).toBeLessThanOrEqual(sample.split('\n').length);
    expect(hitLines(normalise(crlf(sample)), g4)).toEqual(lf);
  });

  it.each(ALLOWED_G4.map((text) => [text]))('G-4 allows the lookalike %p', (text) => {
    expect(hitLines(normalise(text), g4)).toEqual([]);
    expect(hitLines(normalise(crlf(`x\n${text}\ny`)), g4)).toEqual([]);
  });

  it('G-5 catches a known ref, a hosted host and a cookie name, in LF and CRLF', () => {
    const samples = [`const REF = '${knownFixture}'`, `https://${ref20}.supabase.co`, `https://${ref20}.supabase.in/x`, `sb-${ref20}-auth-token.0=`];
    for (const sample of samples) {
      const text = `a\nb\n${sample}`;
      expect(hitLines(normalise(text), g5)).toEqual([3]);
      expect(hitLines(normalise(crlf(text)), g5)).toEqual([3]);
    }
  });

  it('G-5 allows lookalikes that are not a 20-character ref', () => {
    const samples = [
      `https://${'k'.repeat(19)}.supabase.co`,
      `https://${'k'.repeat(21)}.supabase.co`,
      `https://${'K'.repeat(20)}.supabase.co`,
      'https://example.supabase.co',
      'sb-test-auth-token',
      'sb-${ref}-auth-token',
    ];
    for (const sample of samples) expect(hitLines(normalise(sample), g5)).toEqual([]);
  });

  it('every exemption is still needed, and exists (C-8 e)', () => {
    const read = (rel: string): string => normalise(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const rel of G4_EXEMPT) expect(hitLines(read(rel), retiredNamePatterns(RETIRED_NAME)).length).toBeGreaterThan(0);
    for (const rel of G5_EXEMPT) expect(hitLines(read(rel), refPatterns(KNOWN_REFS)).length).toBeGreaterThan(0);
  });

  it('the generated catalog may carry the host on its two provenance lines only (C-8 e)', () => {
    const text = normalise(fs.readFileSync(path.join(ROOT, GENERATED_CATALOG), 'utf8'));
    const lines = text.split('\n');
    const hits = hitLines(text, refPatterns(KNOWN_REFS));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.length).toBeLessThanOrEqual(2);
    for (const line of hits) expect(lines[line - 1]).toMatch(GENERATED_PROVENANCE_LINE);
    // The confinement rejects a ref on any other line.
    expect(isAllowedRefHit({ file: GENERATED_CATALOG, line: 99, text: '  "tables": {}' })).toBe(false);
  });

  it('relative paths compare in POSIX form on every platform (C-8 b)', () => {
    expect(toPosix(['lib', 'admin', 'environment', 'catalogue.ts'].join(path.sep))).toBe(CATALOGUE);
    expect(isTestFile('lib/__tests__/x.ts')).toBe(true);
    expect(isTestFile(JEST_SETUP)).toBe(false);
    expect(inG4Scope('.github/workflows/build.yml')).toBe(true);
  });
});

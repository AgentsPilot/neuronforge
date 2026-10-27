/**
 * Client boundary for the Environment page (admin environment view EC-2;
 * SA-C11, hardened by SA E2-3; plus E2-4).
 *
 * G2-1: every non-test file under `app/admin/environment/`, directive or not
 *   (`environmentDisplay.ts` has none but is bundled for the browser), imports
 *   from `lib/admin/` only `environment-types`, only as `import type`, and
 *   never anything under `lib/admin/environment/`, by alias or relative path.
 * G2-2: no `'use client'` file under `app/`, `components/` or `hooks/` imports
 *   anything under `lib/admin/environment/`. A file counts as client when its
 *   first statement, after a BOM and any comments, is the directive in either
 *   quote style.
 * E2-4: nothing under `app/admin/environment/` uses `dangerouslySetInnerHTML`
 *   (role, name and shown text come from the environment).
 *
 * Plain file scans, CRLF-safe; the helpers have their own negative controls.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const PAGE_DIR = path.join(ROOT, 'app', 'admin', 'environment');
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__', '__mocks__']);
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, out);
    } else if (CODE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

/** Strips block and line comments (line comments not preceded by `:` or a quote, so URLs survive). */
export function stripComments(source: string): string {
  return source
    .replace(/^﻿/, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

/** E2-3: client when the first statement, after a BOM and comments, is the directive. */
export function isClientSource(source: string): boolean {
  return /^\s*(['"])use client\1\s*;?/.test(stripComments(source));
}

export interface ImportRef {
  spec: string;
  typeOnly: boolean;
}

/** Every module specifier: static import/export-from (noting `import type`), dynamic import, require. */
export function importsOf(source: string): ImportRef[] {
  const code = stripComments(source);
  const out: ImportRef[] = [];
  for (const m of code.matchAll(/(?:^|[;\n])\s*(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*(['"])([^'"]+)\4/g)) {
    out.push({ spec: m[5], typeOnly: m[1] === 'import' && Boolean(m[2]) });
  }
  for (const m of code.matchAll(/(?:^|[;\n])\s*import\s*(['"])([^'"]+)\1/g)) out.push({ spec: m[2], typeOnly: false });
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*(['"])([^'"]+)\1\s*\)/g)) out.push({ spec: m[2], typeOnly: false });
  return out;
}

/** Resolves a specifier to a repo-relative path (no extension), or null for a package. */
export function resolveSpec(fromFile: string, spec: string): string | null {
  if (spec.startsWith('@/')) return spec.slice(2);
  if (spec.startsWith('.')) {
    const target = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
    return target;
  }
  return null;
}

const FEATURE_DIR = 'lib/admin/environment';
const TYPES_MODULE = 'lib/admin/environment-types';

const intoFeature = (target: string) => target === FEATURE_DIR || target.startsWith(`${FEATURE_DIR}/`);

/** G2-1 violations for one page file. */
export function pageFileViolations(file: string, source: string): string[] {
  const problems: string[] = [];
  for (const ref of importsOf(source)) {
    const target = resolveSpec(file, ref.spec);
    if (target === null) continue;
    const bare = target.replace(/\.(ts|tsx)$/, '');
    if (intoFeature(bare)) problems.push(`${file}: imports ${ref.spec}`);
    else if (bare === TYPES_MODULE && !ref.typeOnly) problems.push(`${file}: non-type import of ${ref.spec}`);
    else if (bare.startsWith('lib/admin/') && bare !== TYPES_MODULE) problems.push(`${file}: imports ${ref.spec}`);
  }
  return problems;
}

describe('the client-boundary helpers (negative controls)', () => {
  it('detects the directive after a BOM, comments, in either quote style', () => {
    expect(isClientSource("﻿'use client';\nexport {}")).toBe(true);
    expect(isClientSource('/** header */\n// note\n"use client"\nexport {}')).toBe(true);
    expect(isClientSource("\r\n  /* a */ 'use client';\r\n")).toBe(true);
    expect(isClientSource("import x from 'y';\n'use client';")).toBe(false);
    expect(isClientSource("// 'use client'\nexport {}")).toBe(false);
  });

  it('catches alias, relative, dynamic and require imports of the feature, and a non-type types import', () => {
    const file = 'app/admin/environment/components/X.tsx';
    expect(pageFileViolations(file, "import { ENVIRONMENT_CATALOGUE } from '@/lib/admin/environment/catalogue';")).toHaveLength(1);
    expect(pageFileViolations(file, "import { x } from '../../../../lib/admin/environment/classifyEnvironment';")).toHaveLength(1);
    expect(pageFileViolations(file, "const m = import('@/lib/admin/environment/catalogue');")).toHaveLength(1);
    expect(pageFileViolations(file, "const m = require('@/lib/admin/environment');")).toHaveLength(1);
    expect(pageFileViolations(file, "import { EnvRow } from '@/lib/admin/environment-types';")).toHaveLength(1);
    expect(pageFileViolations(file, "export { EnvRow } from '@/lib/admin/environment-types';")).toHaveLength(1);
    expect(pageFileViolations(file, "import { parseAdminEmails } from '@/lib/admin/adminEmailsEnv';")).toHaveLength(1);
    expect(pageFileViolations(file, "import type { EnvRow } from '@/lib/admin/environment-types';")).toEqual([]);
    expect(pageFileViolations(file, "import type {\r\n  EnvRow,\r\n} from \"@/lib/admin/environment-types\";")).toEqual([]);
    // A commented-out import is not an import.
    expect(pageFileViolations(file, "// import { x } from '@/lib/admin/environment/catalogue';")).toEqual([]);
  });
});

describe('Environment page client boundary (SA-C11, E2-3)', () => {
  const pageFiles = walk(PAGE_DIR);

  it('found the page files', () => {
    expect(pageFiles.map(rel).sort()).toEqual(
      expect.arrayContaining([
        'app/admin/environment/page.tsx',
        'app/admin/environment/components/EnvironmentView.tsx',
        'app/admin/environment/environmentDisplay.ts',
      ])
    );
  });

  it('G2-1 every page file imports only the types module from lib/admin, and only as import type', () => {
    const problems = pageFiles.flatMap((file) => pageFileViolations(rel(file), fs.readFileSync(file, 'utf8')));
    expect(problems).toEqual([]);
  });

  it('G2-2 no client file under app/, components/ or hooks/ imports lib/admin/environment/', () => {
    const files = ['app', 'components', 'hooks'].flatMap((dir) => walk(path.join(ROOT, dir)));
    expect(files.length).toBeGreaterThan(200);
    const problems: string[] = [];
    let clientFiles = 0;
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      if (!isClientSource(source)) continue;
      clientFiles += 1;
      for (const ref of importsOf(source)) {
        const target = resolveSpec(rel(file), ref.spec);
        if (target !== null && intoFeature(target.replace(/\.(ts|tsx)$/, ''))) problems.push(`${rel(file)}: ${ref.spec}`);
      }
    }
    expect(clientFiles).toBeGreaterThan(100);
    expect(problems).toEqual([]);
  });

  it('E2-4 nothing in the page folder renders HTML from a string', () => {
    const offenders = pageFiles.filter((file) => /dangerouslySetInnerHTML/.test(fs.readFileSync(file, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });
});

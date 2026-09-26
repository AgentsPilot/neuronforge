/**
 * What no render test can reach on the Health landing (admin reorganisation
 * slice 4): the client files import no server module, no rule config and no
 * evaluator at runtime (SA C-21); never say "OK" and never use a green class
 * (SA C-10); and never link to the legacy dashboard (U-6). Scoped to the Health
 * files only, so the moved legacy page keeps its own classes verbatim.
 */

import * as fs from 'fs';
import * as path from 'path';

const HEALTH_FILES = [
  'app/admin/page.tsx',
  'app/admin/components/health/HealthTile.tsx',
  'app/admin/components/health/HealthGrid.tsx',
];

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

/** Source with comments removed, so prose about a rule cannot satisfy or trip it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every module specifier a file imports at RUNTIME (`import type` excluded). */
function runtimeImports(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/import\s+(?!type\b)[^'"]*?from\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of code.matchAll(/import\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  return found;
}

describe('the Health client files', () => {
  it('found the files (guards the scan)', () => {
    for (const file of HEALTH_FILES) expect(fs.existsSync(path.join(process.cwd(), file))).toBe(true);
  });

  it.each(HEALTH_FILES)('%s is a client component', (file) => {
    expect(read(file).trimStart().startsWith("'use client'")).toBe(true);
  });

  it.each(HEALTH_FILES)('%s imports no server module, repository, call catalog, rule config or evaluator (C-21)', (file) => {
    const imports = runtimeImports(codeOf(read(file)));
    for (const spec of imports) {
      expect(spec).not.toMatch(/^@\/lib\/business-os/);
      expect(spec).not.toMatch(/^@\/lib\/repositories/);
      expect(spec).not.toMatch(/callCatalog|adminSettingsView|server-only/);
      expect(spec).not.toMatch(/lib\/admin\/health\/(rules|evaluateHealth|windows)/);
    }
  });

  it('the rule reader would catch a runtime import (no dead regex)', () => {
    expect(runtimeImports("import { HEALTH_RULES } from '@/lib/admin/health/rules';")).toEqual(['@/lib/admin/health/rules']);
    expect(runtimeImports("import type { HealthTile } from '@/lib/admin/health/healthTypes';")).toEqual([]);
  });

  it.each(HEALTH_FILES)('%s has no green class and never says "OK" (C-10)', (file) => {
    const code = codeOf(read(file));
    expect(code).not.toMatch(/\b(?:bg|text|border)-(?:green|emerald)-/);
    expect(code).not.toMatch(/\bOK\b/);
  });

  it.each(HEALTH_FILES)('%s has no link to the legacy dashboard (U-6)', (file) => {
    expect(codeOf(read(file))).not.toContain('platform-dashboard');
  });

  it.each(HEALTH_FILES)('%s has no console.*', (file) => {
    expect(codeOf(read(file))).not.toMatch(/console\./);
  });
});

describe('the legacy dashboard', () => {
  it('still exists as a client page, with its one console.error converted to Pino', () => {
    const code = codeOf(read('app/admin/platform-dashboard/page.tsx'));
    expect(read('app/admin/platform-dashboard/page.tsx').trimStart().startsWith("'use client'")).toBe(true);
    expect(code).toMatch(/fetch\(`\/api\/admin\/dashboard\?period=/);
    expect(code).not.toMatch(/console\./);
    expect(code).toMatch(/createLogger\(\{ module: 'AdminPlatformDashboard' \}\)/);
  });
});

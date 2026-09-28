/**
 * What no render test can reach on the Health landing (admin reorganisation
 * slices 4 and 5): the client files import no server module, no rule config and
 * no evaluator at runtime (SA C-21); never say "OK"; carry green classes in
 * EXACTLY ONE named constant, `GREEN_STYLE` in HealthTile.tsx, which
 * `STATUS_STYLES.green` references (SA C-10R, SC-7(g), re-ruled from slice 4's
 * "no green at all"); and never link to the legacy dashboard (U-6). Scoped to
 * the Health files only, so the moved legacy page keeps its own classes verbatim.
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

  it.each(HEALTH_FILES)('%s never says "OK"', (file) => {
    expect(codeOf(read(file))).not.toMatch(/\bOK\b/);
  });

  it.each(HEALTH_FILES)('%s carries green classes only inside GREEN_STYLE (C-10R, SC-7(g))', (file) => {
    expect(withoutGreenStyle(codeOf(read(file)))).not.toMatch(GREEN_CLASS);
  });

  it.each(HEALTH_FILES)('%s has no link to the legacy dashboard (U-6)', (file) => {
    expect(codeOf(read(file))).not.toContain('platform-dashboard');
  });

  it.each(HEALTH_FILES)('%s has no console.*', (file) => {
    expect(codeOf(read(file))).not.toMatch(/console\./);
  });
});

/**
 * Every Tailwind utility prefix that can paint a colour (SA-4): a green gradient
 * stop, shadow, outline, underline or divider is as green as a background.
 */
const GREEN_PREFIXES = [
  'bg', 'text', 'border', 'from', 'to', 'via', 'shadow', 'outline',
  'decoration', 'divide', 'ring', 'fill', 'stroke',
] as const;
const GREEN_CLASS = new RegExp(`(?<![\\w-])(?:${GREEN_PREFIXES.join('|')})-(?:green|emerald)-`);

/** The `const GREEN_STYLE ... = { ... };` declaration, or null. */
function greenStyleBlock(code: string): string | null {
  const start = code.indexOf('const GREEN_STYLE');
  if (start < 0) return null;
  const end = code.indexOf('};', start);
  return end < 0 ? null : code.slice(start, end + 2);
}

function withoutGreenStyle(code: string): string {
  const block = greenStyleBlock(code);
  return block ? code.replace(block, '') : code;
}

describe('the one green (C-10R, SC-7(g))', () => {
  const tileCode = codeOf(read('app/admin/components/health/HealthTile.tsx'));

  it('HealthTile.tsx declares GREEN_STYLE exactly once, and it is green', () => {
    expect(tileCode.match(/const GREEN_STYLE\b/g)).toHaveLength(1);
    expect(greenStyleBlock(tileCode)).toMatch(GREEN_CLASS);
  });

  it('STATUS_STYLES.green is GREEN_STYLE, and nothing else refers to it', () => {
    expect(tileCode).toMatch(/\bgreen:\s*GREEN_STYLE\b/);
    expect(tileCode.match(/\bGREEN_STYLE\b/g)).toHaveLength(2); // the declaration and the one reference
  });

  it('the rule chips stay red and amber only', () => {
    const start = tileCode.indexOf('const RULE_CHIP');
    const chip = tileCode.slice(start, tileCode.indexOf('};', start));
    expect(start).toBeGreaterThan(-1);
    expect(chip).not.toMatch(GREEN_CLASS);
    expect(chip).not.toMatch(/\bgreen\s*:/);
  });

  it('the page and the grid carry no green at all', () => {
    for (const file of ['app/admin/page.tsx', 'app/admin/components/health/HealthGrid.tsx']) {
      expect(codeOf(read(file))).not.toMatch(GREEN_CLASS);
    }
  });

  it.each(GREEN_PREFIXES)('the pattern catches a green %s- class, and a variant-prefixed one (SA-4)', (prefix) => {
    expect(`${prefix}-green-500`).toMatch(GREEN_CLASS);
    expect(`${prefix}-emerald-300`).toMatch(GREEN_CLASS);
    expect(`hover:${prefix}-emerald-300/40`).toMatch(GREEN_CLASS);
    expect(`${prefix}-slate-800`).not.toMatch(GREEN_CLASS);
  });

  it('the pattern does not match a longer utility that merely ends in a prefix', () => {
    // `into-`, `photo-` etc. are not colour utilities; the lookbehind keeps
    // the prefix whole.
    expect('into-green-500').not.toMatch(GREEN_CLASS);
    expect('x-bg-green-500').not.toMatch(GREEN_CLASS);
  });

  it('the guard would catch a stray green class outside GREEN_STYLE (no dead regex)', () => {
    expect(withoutGreenStyle("const GREEN_STYLE = { a: 'text-emerald-300' };\nconst x = 'bg-green-500';")).toMatch(GREEN_CLASS);
    expect(withoutGreenStyle("const GREEN_STYLE = { a: 'text-emerald-300' };\nconst x = 'bg-slate-800';")).not.toMatch(GREEN_CLASS);
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

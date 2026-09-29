/**
 * The properties of the Invites screen that no rendering test can reach
 * (modelled on `business-os-tiers/__tests__/source.guard.test.ts`):
 *
 *   1. It imports nothing from outside its own folder (packages aside): no
 *      config, no invite module, no repository, no `LanguageContext` (C-8).
 *      Every option arrives in the payload.
 *   2. It adds no guard of its own: `app/admin/layout.tsx` protects it (C-5).
 *   3. It names no plan, price or plan id, and logs nothing.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = 'app/admin/business-os-invites';

function screenFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      found.push(full.replace(process.cwd() + path.sep, '').split(path.sep).join('/'));
    }
  };
  walk(path.join(process.cwd(), ROOT));
  return found.sort();
}

const allFiles = screenFiles();
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

/** Source with comments removed, so prose about a rule cannot satisfy it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Packages this screen may use. Anything else outside the folder is refused. */
const ALLOWED_PACKAGES = ['react', 'lucide-react'];

describe('the screen holds no server module and no rule of its own', () => {
  it('finds the page and its components, so the scan cannot fall behind the code', () => {
    expect(allFiles).toEqual(
      [
        `${ROOT}/components/CreateInviteForm.tsx`,
        `${ROOT}/components/CreatedLinkPanel.tsx`,
        `${ROOT}/components/EnforcementNote.tsx`,
        `${ROOT}/components/InviteFilters.tsx`,
        `${ROOT}/components/InviteList.tsx`,
        `${ROOT}/components/RevokeDialog.tsx`,
        `${ROOT}/inviteFilter.ts`,
        `${ROOT}/page.tsx`,
        `${ROOT}/types.ts`,
      ].sort()
    );
  });

  it.each(allFiles)('%s imports nothing from outside the screen except React and lucide', (relative) => {
    const imports = [...codeOf(read(relative)).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    const escaping = imports.filter((specifier) => {
      if (specifier.startsWith('@/')) return !specifier.startsWith(`@/${ROOT}`);
      if (!specifier.startsWith('.')) return !ALLOWED_PACKAGES.includes(specifier);
      const resolved = path.normalize(path.join(path.dirname(relative), specifier)).split(path.sep).join('/');
      return !resolved.startsWith(ROOT);
    });
    expect({ file: relative, escaping }).toEqual({ file: relative, escaping: [] });
  });

  it.each(allFiles)('%s never touches LanguageContext (C-8)', (relative) => {
    expect(codeOf(read(relative))).not.toMatch(/LanguageContext|useLanguage/);
  });

  it.each(allFiles)('%s writes down no plan name, price or plan id', (relative) => {
    const code = codeOf(read(relative));
    expect(code).not.toMatch(/\bEssentials\b|\bAutopilot\b|\bTest Flight\b|\bFounding Partner\b/);
    expect(code).not.toMatch(/\$\s?\d/);
    expect(code).not.toMatch(/['"`](basic|pro|trial|champion|paid)['"`]/);
  });

  it.each(allFiles)('%s logs through nothing: no console.*', (relative) => {
    expect(read(relative)).not.toMatch(/console\.(log|warn|error|info|debug)\s*\(/);
  });

  it.each(allFiles)('%s uses no `any` and no dangerouslySetInnerHTML', (relative) => {
    const code = codeOf(read(relative));
    expect(code).not.toMatch(/:\s*any\b/);
    expect(code).not.toContain('dangerouslySetInnerHTML');
  });

  it.each(allFiles)('%s never stores the link anywhere it would survive a reload', (relative) => {
    expect(codeOf(read(relative))).not.toMatch(/localStorage|sessionStorage|document\.cookie|history\.(push|replace)State/);
  });
});

describe('Slice 1c: the filter decides no state of its own (C-11)', () => {
  const filterCode = codeOf(read(`${ROOT}/inviteFilter.ts`));

  it('compares no date and parses no timestamp', () => {
    expect(filterCode).not.toMatch(/linkExpiresAt|Date\.|new Date|getTime/);
  });

  it('sends nothing anywhere: no fetch in the filter or its controls', () => {
    expect(filterCode).not.toMatch(/fetch\(/);
    expect(codeOf(read(`${ROOT}/components/InviteFilters.tsx`))).not.toMatch(/fetch\(/);
  });
});

describe('the guard', () => {
  const pageCode = codeOf(read(`${ROOT}/page.tsx`));

  it('is a client page that does not re-implement the layout guard', () => {
    expect(read(`${ROOT}/page.tsx`).trimStart().startsWith("'use client'")).toBe(true);
    expect(pageCode).not.toMatch(/requireAdminPage|requireAdmin\b/);
  });

  it('never decides who is an admin', () => {
    for (const relative of allFiles) {
      expect(codeOf(read(relative))).not.toMatch(/AdminAccessService|profiles\.role|app_metadata|isAdmin/);
    }
  });

  it('the layout that protects it still awaits the guard as its FIRST statement', () => {
    const layout = codeOf(read('app/admin/layout.tsx'));
    const opener = /export default async function AdminLayout\s*\([\s\S]*?\)\s*\{/.exec(layout);
    expect(opener).not.toBeNull();
    const body = layout.slice((opener?.index ?? 0) + (opener?.[0].length ?? 0)).trim();
    const end = Math.min(...[body.indexOf(';'), body.indexOf('{')].filter((index) => index >= 0).concat([body.length]));
    expect(body.slice(0, end).trim()).toMatch(/await\s+requireAdminPage\s*\(\s*\)/);
  });

  it('writes only to its own two admin routes', () => {
    const targets = allFiles.flatMap((relative) =>
      [...codeOf(read(relative)).matchAll(/fetch\(\s*[`'"]([^`'"]+)[`'"]/g)].map((match) => match[1])
    );
    for (const target of targets) expect(target.startsWith('/api/admin/business-os/invites')).toBe(true);
    expect(targets.length).toBeGreaterThanOrEqual(3);
  });
});

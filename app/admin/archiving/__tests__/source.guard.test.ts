/**
 * The properties of the Archiving screen that no rendering test can reach.
 *
 *   1. It is a client component with no guard of its own: protection comes from
 *      `app/admin/layout.tsx`, which a page cannot skip (condition C-2, R8).
 *   2. It imports nothing server-side. Only React, icons, the UI primitives,
 *      the client-safe archiving constants and its own folder.
 *   3. It cannot start anything: no write method and no URL other than the
 *      overview (AC-15).
 *   4. No `console.*` (AC-18).
 *
 * Modelled on `app/admin/business-os-tiers/__tests__/source.guard.test.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = 'app/admin/archiving';

/** Every non-test source file of the screen, WALKED rather than listed. */
function screenFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === '__snapshots__') continue;
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

/** Source with comments removed, so prose about a rule cannot satisfy or break it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Where an import specifier is allowed to point. */
function isAllowedImport(fromFile: string, specifier: string): boolean {
  if (specifier === 'react' || specifier === 'lucide-react') return true;
  if (specifier.startsWith('@/components/ui/')) return true;
  if (specifier.startsWith('@/lib/archiving/')) return true;
  if (specifier.startsWith(`@/${ROOT}`)) return true;
  if (specifier.startsWith('.')) {
    const resolved = path
      .normalize(path.join(path.dirname(fromFile), specifier))
      .split(path.sep)
      .join('/');
    return resolved.startsWith(ROOT);
  }
  return false;
}

describe('the screen is a client component with no guard of its own', () => {
  it('finds the page, so the scan cannot fall behind the code', () => {
    expect(allFiles).toContain(`${ROOT}/page.tsx`);
  });

  it("page.tsx's first statement is 'use client' (R8)", () => {
    expect(read(`${ROOT}/page.tsx`).trimStart()).toMatch(/^['"]use client['"];/);
  });

  it.each(allFiles)('%s does not re-implement the layout guard or decide who is an admin', (relative) => {
    const code = codeOf(read(relative));
    expect(code).not.toMatch(/requireAdminPage|requireAdmin\b/);
    expect(code).not.toMatch(/AdminAccessService|profiles\.role|app_metadata|isAdmin/);
  });
});

describe('the screen imports nothing server-side', () => {
  it.each(allFiles)('%s imports only React, icons, UI primitives, @/lib/archiving and itself', (relative) => {
    const imports = [...codeOf(read(relative)).matchAll(/from\s+['"]([^'"]+)['"]/g)].map(
      (match) => match[1]
    );
    const escaping = imports.filter((specifier) => !isAllowedImport(relative, specifier));
    expect({ file: relative, escaping }).toEqual({ file: relative, escaping: [] });
  });

  it('the rule would catch a server import, spelled either way (negative control)', () => {
    const page = `${ROOT}/page.tsx`;
    expect(isAllowedImport(page, '@/lib/repositories/ArchiveRepository')).toBe(false);
    expect(isAllowedImport(page, '@/lib/supabaseServer')).toBe(false);
    expect(isAllowedImport(page, '@/lib/validation/archiving')).toBe(false);
    expect(isAllowedImport(page, '@/lib/services/AuditTrailService')).toBe(false);
    expect(isAllowedImport(page, '../../../lib/repositories/ArchiveRepository')).toBe(false);
    expect(isAllowedImport(page, 'next/server')).toBe(false);
    // …and allows what the page legitimately uses.
    expect(isAllowedImport(page, '@/lib/archiving/config')).toBe(true);
    expect(isAllowedImport(page, '@/components/ui/select')).toBe(true);
    expect(isAllowedImport(page, './format')).toBe(true);
  });
});

describe('nothing here can start a run (AC-15)', () => {
  it.each(allFiles)('%s sends no request that writes', (relative) => {
    const code = codeOf(read(relative));
    expect(code).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
  });

  it.each(allFiles)('%s fetches only the overview route', (relative) => {
    const code = codeOf(read(relative));
    const urls = [...code.matchAll(/fetch\(\s*(['"`])([^'"`]*)\1/g)].map((match) => match[2]);
    for (const url of urls) {
      expect(url).toBe('/api/admin/archiving');
    }
    // A fetch whose URL is not a plain literal would slip past the check above.
    expect(code.match(/fetch\(/g)?.length ?? 0).toBe(urls.length);
  });
});

describe('logging and typing', () => {
  it.each(allFiles)('%s has no console.*', (relative) => {
    expect(read(relative)).not.toMatch(/console\./);
  });

  it.each(allFiles)('%s uses no `any`', (relative) => {
    expect(codeOf(read(relative))).not.toMatch(/:\s*any\b|as\s+any\b/);
  });
});

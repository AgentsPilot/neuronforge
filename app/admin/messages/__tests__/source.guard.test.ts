/**
 * The properties of the Messages screen that no rendering test can reach
 * (Admin Layout Standard L-7, workplan §5, G-1 to G-9). Pure file reads,
 * comments stripped before matching, so prose about a rule cannot satisfy it.
 */

import * as fs from 'fs';
import * as path from 'path';

import { MESSAGES_FILTER_SPEC } from '../messagesFilters';

const ROOT = 'app/admin/messages';

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

/** Source with comments removed. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const ALLOWED_PACKAGES = ['react', 'lucide-react'];

/**
 * Does an import from `relative` leave the screen? Allowed: React, lucide, the
 * client logger, the screen's own files, and the shared admin layout folder
 * through the alias with its trailing slash (so `layoutX` cannot ride it).
 */
function escapes(relative: string, specifier: string): boolean {
  if (specifier.startsWith('@/app/admin/components/layout/')) return false;
  if (specifier === '@/lib/logger/client') return false;
  if (specifier.startsWith('@/')) return !specifier.startsWith(`@/${ROOT}/`);
  if (!specifier.startsWith('.')) return !ALLOWED_PACKAGES.includes(specifier);
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(relative), specifier));
  return !(resolved === ROOT || resolved.startsWith(`${ROOT}/`));
}

const importsOf = (code: string) => [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

describe('G-1: the exact file list', () => {
  it('finds the page, its helpers and its two components, so the scan cannot fall behind the code', () => {
    expect(allFiles).toEqual(
      [
        `${ROOT}/components/MessageDetail.tsx`,
        `${ROOT}/components/MessagesTable.tsx`,
        `${ROOT}/messagesFilters.ts`,
        `${ROOT}/messagesFormat.ts`,
        `${ROOT}/messagesTypes.ts`,
        `${ROOT}/page.tsx`,
      ].sort(),
    );
  });
});

describe('G-2: imports stay inside the screen, the shared layout folder and the client logger', () => {
  it.each(allFiles)('%s imports nothing else', (relative) => {
    const escaping = importsOf(codeOf(read(relative))).filter((specifier) => escapes(relative, specifier));
    expect({ file: relative, escaping }).toEqual({ file: relative, escaping: [] });
  });

  it('negative controls: escapes() refuses the look-alikes', () => {
    const page = `${ROOT}/page.tsx`;
    expect(escapes(page, '@/app/admin/components/layout/StatusChip')).toBe(false);
    expect(escapes(page, '@/app/admin/components/layoutX/Foo')).toBe(true);
    expect(escapes(page, '../components/layout/StatusChip')).toBe(true);
    expect(escapes(page, '@/app/admin/users/usersFormat')).toBe(true);
    expect(escapes(page, 'next/navigation')).toBe(true);
    expect(escapes(page, '@/lib/logger')).toBe(true);
    expect(escapes(page, '@/app/admin/messagesX/page')).toBe(true);
    expect(escapes(page, './components/MessagesTable')).toBe(false);
    expect(escapes(`${ROOT}/components/MessageDetail.tsx`, '../messagesFormat')).toBe(false);
    expect(escapes(page, 'react')).toBe(false);
  });
});

describe('G-3: no Reply (D-14 (b), R-15)', () => {
  it.each(allFiles)('%s names no reply path, no reply handler or state, and imports no Reply or Send icon', (relative) => {
    const code = codeOf(read(relative));
    expect(code).not.toContain('/reply');
    expect(code).not.toContain('/replay');
    expect(code).not.toMatch(/sendReply|replyContent|showReplyModal|sendingReply/);
    const lucide = /import\s*\{([^}]*)\}\s*from\s*['"]lucide-react['"]/.exec(code);
    const names = (lucide?.[1] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
    expect(names.filter((name) => name === 'Reply' || name === 'Send')).toEqual([]);
  });
});

describe('G-4: logs through clientLogger only', () => {
  it.each(allFiles)('%s has no console.', (relative) => {
    expect(read(relative)).not.toMatch(/console\./);
  });
});

describe('G-5: the same four requests, and no new one', () => {
  const targets = allFiles.flatMap((relative) =>
    [...codeOf(read(relative)).matchAll(/fetch\(\s*([`'"])([^`'"]*)/g)].map((match) => match[2]),
  );
  const fetchCount = allFiles.reduce((n, relative) => n + (codeOf(read(relative)).match(/\bfetch\(/g) ?? []).length, 0);

  it('every fetch targets /api/admin/messages, and there are exactly four call sites', () => {
    expect(fetchCount).toBe(4);
    expect(targets).toHaveLength(4);
    for (const target of targets) expect(target.startsWith('/api/admin/messages')).toBe(true);
  });

  it.each(allFiles)("%s sends no POST (the only POST was the reply path; SA S-5)", (relative) => {
    expect(codeOf(read(relative))).not.toMatch(/['"`]POST['"`]/);
  });
});

describe('G-6: the URL hook is the only writer', () => {
  it.each(allFiles)('%s writes no history and touches no search params, router or storage', (relative) => {
    expect(codeOf(read(relative))).not.toMatch(
      /history\.(push|replace)State|useSearchParams|useRouter|localStorage|sessionStorage|document\.cookie/,
    );
  });
});

describe('G-7: the URL spec holds exactly one key, status (SA-R-8, D-6 (a))', () => {
  it('has only `status`, not page-only, owning only the `status` key', () => {
    expect(Object.keys(MESSAGES_FILTER_SPEC)).toEqual(['status']);
    expect(MESSAGES_FILTER_SPEC.status.keys).toEqual(['status']);
    expect(MESSAGES_FILTER_SPEC.status.pageOnly).toBeFalsy();
  });

  it('the source names no search field in the spec', () => {
    const code = codeOf(read(`${ROOT}/messagesFilters.ts`));
    const spec = /MESSAGES_FILTER_SPEC\s*=\s*\{([\s\S]*?)\};/.exec(code);
    expect(spec).not.toBeNull();
    expect(spec?.[1]).not.toMatch(/search/i);
  });
});

describe('G-8: no any and no raw HTML (the message text is untrusted input)', () => {
  it.each(allFiles)('%s', (relative) => {
    const code = codeOf(read(relative));
    expect(code).not.toMatch(/:\s*any\b|\bas\s+any\b|<any>/);
    expect(code).not.toContain('dangerouslySetInnerHTML');
  });
});

describe('G-9: a client page that decides no admin access itself', () => {
  it("starts with 'use client'", () => {
    expect(read(`${ROOT}/page.tsx`).trimStart().startsWith("'use client'")).toBe(true);
  });

  it.each(allFiles)('%s has no admin decision of its own', (relative) => {
    expect(codeOf(read(relative))).not.toMatch(/requireAdmin|admin_users|profiles\.role|AdminAccessService|app_metadata/);
  });
});

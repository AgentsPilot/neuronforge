/**
 * Who may use `ContactMessagesRepository` (contact inbox standard; SA C-3).
 *
 * The repository runs with the service role on two tables that have no owner
 * column, so authorisation is its callers' job (see its header). This pins the
 * caller list: the three admin Messages handlers (behind `requireAdmin`) and
 * the public contact route. The barrel re-export is the only other file that
 * may name it.
 *
 * It also pins that no caller is a browser file: none contains 'use client'
 * and none imports the browser client. The RLS slice 2 guard used to check
 * that on the routes themselves; since they reach the tables only through
 * this repository, the check lives here.
 *
 * Pure fs scan; tests are excluded (they mock the module by name).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
const REPOSITORY = 'lib/repositories/ContactMessagesRepository.ts';
const BARREL = 'lib/repositories/index.ts';

const ALLOWED_CALLERS = [
  'app/api/admin/messages/[id]/route.ts',
  'app/api/admin/messages/route.ts',
  'app/api/contact/route.ts',
].sort();

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const rel = (file: string) => relative(ROOT, file).replace(/\\/g, '/');
const files = ['app', 'lib', 'components', 'hooks'].flatMap((dir) => sourceFiles(join(ROOT, dir)));

/** A direct import of the module, or a barrel import naming its class or singleton. */
const DIRECT = /from\s+['"](?:@\/lib\/repositories\/ContactMessagesRepository|\.{1,2}\/[^'"]*ContactMessagesRepository)['"]/;
const VIA_BARREL = /import\s*\{[^}]*\b(?:contactMessagesRepository|ContactMessagesRepository)\b[^}]*\}\s*from\s+['"](?:@\/lib\/repositories|@\/lib\/repositories\/index)['"]/;

const importers = files
  .map(rel)
  .filter((file) => file !== REPOSITORY && file !== BARREL)
  .filter((file) => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    return DIRECT.test(text) || VIA_BARREL.test(text);
  })
  .sort();

describe('ContactMessagesRepository callers', () => {
  it('the scan sees the source tree, so an empty result cannot pass as a clean one', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('is imported only by the admin Messages handlers and the public contact route', () => {
    expect(importers).toEqual(ALLOWED_CALLERS);
  });

  it('no caller is a browser file or uses the browser client', () => {
    for (const file of importers) {
      const text = readFileSync(join(ROOT, file), 'utf8');
      expect({ file, useClient: /['"]use client['"]/.test(text) }).toEqual({ file, useClient: false });
      expect({ file, browserClient: text.includes('@/lib/supabaseClient') }).toEqual({ file, browserClient: false });
    }
  });

  it('the admin callers gate with requireAdmin', () => {
    for (const file of importers.filter((f) => f.startsWith('app/api/admin/'))) {
      expect(readFileSync(join(ROOT, file), 'utf8')).toContain('await requireAdmin(');
    }
  });

  it('the matchers catch the import shapes they must catch', () => {
    expect(DIRECT.test("import { contactMessagesRepository } from '@/lib/repositories/ContactMessagesRepository';")).toBe(true);
    expect(DIRECT.test("import { X } from '../repositories/ContactMessagesRepository';")).toBe(true);
    expect(VIA_BARREL.test("import { contactMessagesRepository } from '@/lib/repositories';")).toBe(true);
    expect(VIA_BARREL.test("import { agentRepository } from '@/lib/repositories';")).toBe(false);
  });
});

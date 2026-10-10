/**
 * @jest-environment node
 *
 * The finance page's source guards (slice 1a, T14): no repository import (the
 * page reads only through its admin route), no `console.`, `useSearchParams`
 * inside a Suspense boundary, `router.replace` not `push`, and no `route.ts`
 * anywhere under `app/admin` (the page is gated by the admin layout).
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'app', 'admin', 'finance');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(DIR);
const read = (file: string) => fs.readFileSync(file, 'utf8');
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

describe('app/admin/finance source guards', () => {
  it('scans the page files (non-vacuity)', () => {
    expect(files.map(rel)).toEqual(
      expect.arrayContaining(['app/admin/finance/page.tsx', 'app/admin/finance/components/FinanceView.tsx'])
    );
  });

  it('imports no repository and no server-only module', () => {
    for (const file of files) {
      expect({ file: rel(file), repo: /@\/lib\/repositories/.test(read(file)) }).toEqual({ file: rel(file), repo: false });
      expect({ file: rel(file), serverOnly: /['"]server-only['"]/.test(read(file)) }).toEqual({ file: rel(file), serverOnly: false });
    }
  });

  it('imports from lib/business-os/finance only types (the wire types)', () => {
    for (const file of files) {
      for (const line of read(file).split('\n')) {
        if (/from ['"]@\/lib\/business-os\/finance\//.test(line)) {
          expect({ file: rel(file), line }).toEqual({ file: rel(file), line: expect.stringMatching(/^import type /) });
        }
      }
    }
  });

  it('never uses console', () => {
    for (const file of files) expect({ file: rel(file), console: /\bconsole\./.test(read(file)) }).toEqual({ file: rel(file), console: false });
  });

  it('the page is a client component (authz guard R8, OI-21) and wraps the view in Suspense (useSearchParams in Next 14)', () => {
    const page = read(path.join(DIR, 'page.tsx'));
    expect(page).toMatch(/^['"]use client['"];/);
    expect(page).toMatch(/<Suspense[\s\S]*<FinanceView \/>[\s\S]*<\/Suspense>/);
  });

  it('writes the URL with router.replace and scroll false, never push', () => {
    const view = read(path.join(DIR, 'components', 'FinanceView.tsx'));
    expect(view).toMatch(/router\.replace\([^)]*\{ scroll: false \}\)/);
    expect(view).not.toMatch(/router\.push\(/);
    expect(view).toMatch(/useSearchParams\(\)/);
  });

  it('has no route.ts under app/admin (the layout gates the page; data comes from app/api/admin)', () => {
    const routes: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (/^route\.(ts|tsx|js)$/.test(entry.name)) routes.push(rel(full));
      }
    };
    scan(path.join(ROOT, 'app', 'admin'));
    expect(routes).toEqual([]);
  });
});

/**
 * Every sign-out goes through `signOutUser` (slice C-c, QA S-5 gap 4, SA-CC-12).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY
 *
 * `signOutUser` is where the deadlines, the cookie clear by shape, the local
 * fallback and the audit entry live. A control that calls
 * `supabase.auth.signOut()` itself skips all of them: three controls did, until
 * `31976f13` and the UserMenu / layout fixes moved them over. This guard keeps
 * a new one from appearing, and pins that each known sign-out surface still
 * calls the shared function.
 *
 * Source scan with comments stripped (several files explain, in comments, the
 * direct call they replaced). Reads files only; no render, no added CI time.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const ROOTS = ['app', 'components', 'lib', 'hooks'];
const SHARED = path.join('lib', 'client', 'auth-actions.ts');
const SKIP_DIRS = new Set(['node_modules', '.next', '__tests__']);

/** Each sign-out surface, explicitly: a rename or removal must be a deliberate edit here. */
const SIGN_OUT_SURFACES = [
  'app/(protected)/layout.tsx',
  'components/v2/UserMenu.tsx',
  'app/admin/components/AdminHeader.tsx',
  'app/business-os/settings/page.tsx',
  'app/invite/awaiting-payment/SignOutButton.tsx',
  'app/invite/useSignedInVisitor.ts',
  'components/test-business-os/TestAuthPanel.tsx',
];

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const DIRECT_SIGN_OUT = /\.auth\s*\.\s*signOut\s*\(/;
const IMPORTS_SHARED = /import\s*\{[^}]*\bsignOutUser\b[^}]*\}\s*from\s*['"]@\/lib\/client\/auth-actions['"]/;
const CALLS_SHARED = /\bsignOutUser\s*\(/;

function directSignOutIn(source: string): boolean {
  return DIRECT_SIGN_OUT.test(stripComments(source));
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) sourceFiles(path.join(dir, entry.name), out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf8');

describe('sign-out callers guard', () => {
  it('every scanned root exists (a typo must not quietly scan nothing)', () => {
    for (const root of ROOTS) expect(fs.statSync(path.join(REPO, root)).isDirectory()).toBe(true);
  });

  it('G-1 no code outside auth-actions calls auth.signOut( directly', () => {
    const offenders: string[] = [];
    let scanned = 0;
    for (const root of ROOTS) {
      for (const file of sourceFiles(path.join(REPO, root))) {
        const rel = path.relative(REPO, file);
        if (rel === SHARED) continue;
        scanned++;
        if (directSignOutIn(fs.readFileSync(file, 'utf8'))) offenders.push(rel.replace(/\\/g, '/'));
      }
    }
    expect(scanned).toBeGreaterThan(500);
    expect(offenders).toEqual([]);
  });

  it.each(SIGN_OUT_SURFACES)('G-2 %s imports and calls signOutUser', (rel) => {
    expect(fs.existsSync(path.join(REPO, rel))).toBe(true);
    const code = stripComments(read(rel));
    expect(code).toMatch(IMPORTS_SHARED);
    expect(code).toMatch(CALLS_SHARED);
  });

  it('G-2 the settings Log out signs out globally through signOutUser', () => {
    expect(stripComments(read('app/business-os/settings/page.tsx'))).toContain("signOutUser({ scope: 'global'");
  });

  describe('G-3 negative controls', () => {
    it.each([
      'await supabase.auth.signOut();',
      "await supabase.auth.signOut({ scope: 'global' });",
      'client.auth .signOut ()',
    ])('flags %s', (line) => {
      expect(directSignOutIn(line)).toBe(true);
    });

    it.each([
      '// await supabase.auth.signOut();',
      '/* called supabase.auth.signOut() directly */',
      ' * This called `supabase.auth.signOut()` directly',
    ])('ignores it inside a comment: %s', (line) => {
      const source = line.startsWith(' *') ? `/**\n${line}\n */` : line;
      expect(directSignOutIn(source)).toBe(false);
    });

    it('the import matcher needs the shared module', () => {
      expect("import { signOutUser } from '@/lib/client/auth-actions';").toMatch(IMPORTS_SHARED);
      expect("import { signOutUser } from '@/lib/other';").not.toMatch(IMPORTS_SHARED);
    });
  });
});

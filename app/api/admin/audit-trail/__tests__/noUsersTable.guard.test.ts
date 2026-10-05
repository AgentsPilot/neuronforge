/**
 * Source guard for GET /api/admin/audit-trail (ADMIN_BOS_CLEANUP slice 4).
 *
 * The route read person names from `public.users`, which does not exist
 * (measured live 42P01), and discarded the error, so the admin audit trail never
 * showed a name (admin-authz OI-18). route.userName.test.ts proves the behaviour;
 * this pins the shape, so the phantom read cannot come back quietly:
 *
 *   S-1  no `.from('users')`, in either quote style;
 *   S-2  exactly ONE inline `.from(` — the `audit_trail` read, which stays inline
 *        (OI-9). A second inline read needs a deliberate edit here;
 *   S-3  names come through `userProfileRepository.findAdminNamesByIds(`.
 *
 * Comments are stripped first, so prose about the old read cannot trip or
 * satisfy a rule.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROUTE = path.join(process.cwd(), 'app/api/admin/audit-trail/route.ts');

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const code = codeOf(fs.readFileSync(ROUTE, 'utf8'));

describe('the audit-trail route reads no phantom `users` table', () => {
  it('S-1: has no .from("users") in either quote style', () => {
    expect(code).not.toMatch(/\.from\(\s*['"`]users['"`]\s*\)/);
  });

  it('S-2: calls the inline client exactly once, for audit_trail', () => {
    const froms = [...code.matchAll(/\.from\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map((m) => m[1]);
    expect(froms).toEqual(['audit_trail']);
    // A `.from(` with a non-literal argument would slip past the list above.
    expect(code.match(/\.from\(/g)?.length ?? 0).toBe(1);
  });

  it('S-3: gets names through the admin repository method', () => {
    expect(code).toMatch(/userProfileRepository\.findAdminNamesByIds\(/);
  });

  it('the S-1 pattern would catch the old read (negative control)', () => {
    expect(".from('users')").toMatch(/\.from\(\s*['"`]users['"`]\s*\)/);
    expect('.from("users")').toMatch(/\.from\(\s*['"`]users['"`]\s*\)/);
  });
});

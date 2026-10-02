/**
 * The one ADMIN_EMAILS parser (ADMIN_BOS_CLEANUP slice 1, condition C-2).
 *
 * E-1..E-5 pin the split rules moved verbatim from the access service. E-6 pins
 * the read time (call time, not import time), which the service's own suite
 * depends on. E-7 proves there is ONE parser: the service and the admin list
 * route both import this module and neither splits the env value itself.
 */

import fs from 'fs';
import path from 'path';

import { parseAdminEmails, readEnvAdminEmails } from '@/lib/admin/adminEmailsEnv';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/**
 * Drop line comments, then block comments, so prose cannot satisfy or break a
 * check. Line comments go first: a `//` line such as "routes under /api/admin/*"
 * would otherwise open a fake block comment and swallow real code.
 */
function stripComments(src: string): string {
  return src.replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\/\*[\s\S]*?\*\//g, '');
}

const sorted = (s: Set<string>) => [...s].sort();

describe('parseAdminEmails', () => {
  it('E-1: comma separated', () => {
    expect(sorted(parseAdminEmails('a@x.io,b@x.io'))).toEqual(['a@x.io', 'b@x.io']);
  });

  it('E-2: semicolon separated', () => {
    expect(sorted(parseAdminEmails('a@x.io;b@x.io'))).toEqual(['a@x.io', 'b@x.io']);
  });

  it('E-3: whitespace, newlines, leading/trailing and doubled separators', () => {
    expect(sorted(parseAdminEmails('  a@x.io ,, ;\n b@x.io  '))).toEqual(['a@x.io', 'b@x.io']);
    expect(sorted(parseAdminEmails('a@x.io\tb@x.io\r\nc@x.io'))).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
  });

  it('E-4: mixed case is lowercased and duplicates collapse', () => {
    expect(sorted(parseAdminEmails('A@X.io,a@x.io'))).toEqual(['a@x.io']);
    expect(sorted(parseAdminEmails('Ops@Example.com; extra@x.io'))).toEqual(['extra@x.io', 'ops@example.com']);
  });

  it('E-5: empty inputs give an empty set', () => {
    for (const raw of [undefined, null, '', ' , ; ']) {
      expect(parseAdminEmails(raw).size).toBe(0);
    }
  });
});

describe('readEnvAdminEmails', () => {
  const saved = process.env.ADMIN_EMAILS;
  afterEach(() => {
    if (saved === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = saved;
  });

  it('E-6: reads the environment at call time, not at import', () => {
    process.env.ADMIN_EMAILS = 'first@x.io';
    expect(sorted(readEnvAdminEmails())).toEqual(['first@x.io']);
    process.env.ADMIN_EMAILS = 'second@x.io, Third@x.io';
    expect(sorted(readEnvAdminEmails())).toEqual(['second@x.io', 'third@x.io']);
    delete process.env.ADMIN_EMAILS;
    expect(readEnvAdminEmails().size).toBe(0);
  });
});

describe('E-7: one parser for app code', () => {
  const read = (rel: string) => stripComments(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf-8'));

  it('the access service imports the shared reader and does not split the env value itself', () => {
    const code = read('lib/services/AdminAccessService.ts');
    expect(code).toMatch(/from '@\/lib\/admin\/adminEmailsEnv'/);
    expect(code).toContain('readEnvAdminEmails()');
    expect(code).not.toMatch(/process\.env\.ADMIN_EMAILS/);
    // The old private parser's name, as a pattern so W-9's repo grep for it stays empty.
    expect(code).not.toMatch(/parseEnv\w*Emails/);
  });

  it('the admin list route imports the same module and does not read the env value itself', () => {
    const code = read('app/api/admin/admins/route.ts');
    expect(code).toMatch(/from '@\/lib\/admin\/adminEmailsEnv'/);
    expect(code).not.toMatch(/process\.env\.ADMIN_EMAILS/);
    expect(code).not.toMatch(/\.split\(/);
  });
});

/**
 * The settings page never talks to the database from the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PINS (settings drawer D-4, SA condition C-22)
 *
 * The page used to read and write `profiles`, `user_preferences` and the data
 * export straight from the browser Supabase client, which broke CLAUDE.md
 * rule 1 (all DB access via `lib/repositories/`, server-side only). DE-0a, D-1
 * and D-2 moved each of those behind an API route, and D-4 removed the now
 * unused `@/lib/supabaseClient` import. This guard keeps it that way: the next
 * "quick" read added to the page has to go through a route.
 *
 * With comments stripped (the page's comments legitimately mention
 * `supabase-js` and `supabase.auth.signOut()`), `page.tsx` must have:
 *   - no import of the browser client (`@/lib/supabaseClient`, or a relative
 *     path to it),
 *   - no `.from(` (a table query, or a storage bucket),
 *   - no `supabase.` (any use of a client called `supabase`: auth, storage,
 *     rpc, channel).
 *
 * The avatar hook's half lives with D-3 (C-21). There is no render harness for
 * this page, so this is a source guard, with negative controls proving each
 * matcher catches the shape it forbids. It only reads one file, inside the
 * existing Jest job (no added CI time).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SETTINGS = 'app/business-os/settings/page.tsx';

// Same stripping as the other settings-page guards and greetingUsesTheEditedName.
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const BROWSER_CLIENT_IMPORT =
  /(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)(['"`])(?:@\/lib\/|(?:\.\.?\/)+(?:lib\/)?)supabaseClient(?:\.[jt]sx?)?\1/;
/** Any other way to get a Supabase client: the SDK itself or a server client (QA D-4 gap E-1). */
const OTHER_CLIENT_IMPORT =
  /(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)(['"`])(?:@supabase\/[^'"`]+|@\/lib\/supabaseServer[^'"`]*)\1/;
const FROM_CALL = /\.from\s*\(/;
const SUPABASE_MEMBER = /\bsupabase\s*\??\./;

/** Problems with a source file; empty when it has no browser DB access. */
function problemsIn(source: string): string[] {
  const code = stripComments(source);
  const problems: string[] = [];
  if (BROWSER_CLIENT_IMPORT.test(code)) problems.push('imports the browser Supabase client');
  if (OTHER_CLIENT_IMPORT.test(code)) problems.push('imports another Supabase client');
  if (FROM_CALL.test(code)) problems.push('calls .from( (table or storage bucket)');
  if (SUPABASE_MEMBER.test(code)) problems.push('uses a `supabase.` client member');
  return problems;
}

describe('settings page: no browser database access (D-4, C-22)', () => {
  it('page.tsx has no browser Supabase import, no .from( and no supabase.', () => {
    const raw = fs.readFileSync(path.join(process.cwd(), SETTINGS), 'utf8');
    expect(problemsIn(raw)).toEqual([]);
  });

  describe('negative controls: the matcher catches each forbidden shape', () => {
    it.each([
      ['the browser client import', "import { supabase } from '@/lib/supabaseClient';\n"],
      ['a relative browser client import', 'import { supabase } from "../../../lib/supabaseClient";\n'],
      ['a table query', "const { data } = await db.from('profiles').select('full_name');\n"],
      ['a spaced table query', "await client\n  .from ('user_preferences')\n  .upsert({});\n"],
      ['a storage call', "await supabase.storage.from('avatars').upload(path, file);\n"],
      ['an auth call on the client', 'await supabase.auth.signOut();\n'],
      ['an optional-chained client call', "supabase?.rpc('x');\n"],
      ['the SDK imported directly', "import { createClient } from '@supabase/supabase-js';\n"],
      ['an SDK sub-package', 'import { createBrowserClient } from "@supabase/ssr";\n'],
      ['a server client', "import { supabaseServer } from '@/lib/supabaseServer';\n"],
      ['a server auth client', "import { createClient } from '@/lib/supabaseServerAuth';\n"],
    ])('fails on %s', (_label, snippet) => {
      expect(problemsIn(snippet)).not.toEqual([]);
    });

    it('fails on each shape for its own reason', () => {
      expect(problemsIn("import { supabase } from '@/lib/supabaseClient';\n")).toEqual([
        'imports the browser Supabase client',
      ]);
      expect(problemsIn("x.from('profiles');\n")).toEqual(['calls .from( (table or storage bucket)']);
      expect(problemsIn('supabase.storage;\n')).toEqual(['uses a `supabase.` client member']);
    });
  });

  it('strips comments before matching, so the page can still explain itself', () => {
    const commented = [
      "/* `supabase-js` returns { error }; we used to call supabase.from('profiles') */",
      "// import { supabase } from '@/lib/supabaseClient';",
      '/** Three things beyond `supabase.auth.signOut()` */',
      'const ok = true;',
    ].join('\n');
    expect(problemsIn(commented)).toEqual([]);
  });

  it('does not flag a route call or another client-side import', () => {
    expect(problemsIn("await fetch('/api/business-os/account-profile');\n")).toEqual([]);
    expect(problemsIn("import { signOutUser } from '@/lib/client/auth-actions';\n")).toEqual([]);
  });
});

/**
 * Source guards for the profile picture (settings drawer D-3).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS PINNED
 *
 *   C-21     The hook talks to `/api/user/avatar` only: no browser Supabase
 *            client, no `.from(`, no `.storage`, no `console.`, no
 *            `JSON.stringify(` (the old error dump), and it logs through
 *            `createLogger({ module: 'useAvatarUpload' })` (L-1).
 *   C-19     The route reaches storage only through `AvatarService` and the
 *            table only through the repository: it imports neither Supabase
 *            client and has no `.from(`.
 *   SA-D3-4  `AvatarUpload.tsx` offers the shared type list only: its
 *            `accept` is `AVATAR_MIME_TYPES.join(',')`, and the file names no
 *            `image/*` and no `svg`.
 *   SA-D3-5  In non-test `.ts` / `.tsx` under `app/`, `components/`, `lib/`
 *            and `hooks/`, only `lib/services/AvatarService.ts` names the
 *            `avatars` bucket. Slice D-3a removes every browser policy on the
 *            bucket; a new browser writer appearing unnoticed would then
 *            simply break, or (before D-3a) reopen F-16.
 *
 * Each matcher has a negative control: it must catch the shape it forbids.
 * Comments are stripped before matching (the `greetingUsesTheEditedName`
 * precedent), so an explanation never trips a check. Pure file reads.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const HOOK = 'components/onboarding/hooks/useAvatarUpload.ts';
const ROUTE = 'app/api/user/avatar/route.ts';
const PICKER = 'components/ui/AvatarUpload.tsx';
const BUCKET_OWNER = 'lib/services/AvatarService.ts';

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * Imports (static, dynamic or require) of the browser client. The
 * anon-default guard's regex, widened to `../../lib/supabaseClient`: that
 * guard scans `lib/` (one hop away), this file guards `components/`.
 */
const BROWSER_CLIENT_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:@\/lib\/supabaseClient|(?:\.\.?\/)+(?:lib\/)?supabaseClient)['"]/;

/** Imports of the service-role client. */
const SERVER_CLIENT_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:@\/lib\/supabaseServer|(?:\.\.?\/)+(?:lib\/)?supabaseServer)['"]/;

const TABLE_CALL = /\.from\s*\(/;
const STORAGE_CALL = /\.storage\b/;
const CONSOLE_CALL = /\bconsole\s*\./;
const STRINGIFY_CALL = /JSON\.stringify\s*\(/;

/** A source naming the `avatars` bucket: `.from('avatars')`, a `= 'avatars'` constant, or `bucket: 'avatars'`. */
const NAMES_AVATARS_BUCKET =
  /\.from\s*\(\s*(['"`])avatars\1\s*\)|=\s*(['"`])avatars\2|\bbucket(?:_id)?\s*:\s*(['"`])avatars\3/;

const hook = stripComments(read(HOOK));
const route = stripComments(read(ROUTE));
const pickerRaw = read(PICKER);
const picker = stripComments(pickerRaw);

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.next' || entry === '__tests__') continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('C-21: the hook calls the route and nothing else', () => {
  it('imports no Supabase client and makes no table or storage call', () => {
    expect(hook).not.toMatch(BROWSER_CLIENT_IMPORT);
    expect(hook).not.toMatch(SERVER_CLIENT_IMPORT);
    expect(hook).not.toMatch(TABLE_CALL);
    expect(hook).not.toMatch(STORAGE_CALL);
  });

  it('L-1: no console, no JSON.stringify dump, logs through its own Pino logger', () => {
    expect(hook).not.toMatch(CONSOLE_CALL);
    expect(hook).not.toMatch(STRINGIFY_CALL);
    expect(hook).toContain("createLogger({ module: 'useAvatarUpload' })");
  });

  it('names the route', () => {
    expect(hook).toContain("'/api/user/avatar'");
  });
});

describe('C-19: the route reaches storage and the table through their owners only', () => {
  it('imports neither Supabase client and has no .from(', () => {
    expect(route).not.toMatch(BROWSER_CLIENT_IMPORT);
    expect(route).not.toMatch(SERVER_CLIENT_IMPORT);
    expect(route).not.toMatch(TABLE_CALL);
    expect(route).toContain("from '@/lib/services/AvatarService'");
    expect(route).toContain("from '@/lib/repositories/UserProfileRepository'");
  });
});

describe('SA-D3-4: the picker offers the shared type list only', () => {
  it('accept is AVATAR_MIME_TYPES.join(\',\') from the shared module', () => {
    expect(picker).toContain("accept={AVATAR_MIME_TYPES.join(',')}");
    expect(picker).toContain("import { AVATAR_MIME_TYPES } from '@/lib/validation/avatar'");
  });

  it('names no image/* and no svg anywhere in the file (M-30)', () => {
    expect(pickerRaw).not.toContain('image/*');
    expect(pickerRaw.toLowerCase()).not.toContain('svg');
  });
});

describe('SA-D3-5: only AvatarService names the avatars bucket', () => {
  it('in non-test code under app/, components/, lib/ and hooks/', () => {
    const offenders: string[] = [];
    for (const dir of ['app', 'components', 'lib', 'hooks']) {
      for (const file of walk(join(ROOT, dir))) {
        const rel = relative(ROOT, file).split(sep).join('/');
        if (NAMES_AVATARS_BUCKET.test(stripComments(readFileSync(file, 'utf8')))) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([BUCKET_OWNER]);
  });
});

describe('negative controls: each matcher catches the shape it forbids', () => {
  it.each([
    ["import { supabase } from '@/lib/supabaseClient';", BROWSER_CLIENT_IMPORT],
    ["const m = await import('@/lib/supabaseClient');", BROWSER_CLIENT_IMPORT],
    ["const m = require('../../lib/supabaseClient');", BROWSER_CLIENT_IMPORT],
    ["import { supabaseServer } from '@/lib/supabaseServer';", SERVER_CLIENT_IMPORT],
    ["await supabase.from('profiles').select('avatar_url')", TABLE_CALL],
    ["await supabase.storage.from('x').remove([p])", STORAGE_CALL],
    ["console.error('Avatar upload error:', error);", CONSOLE_CALL],
    ['JSON.stringify(error, null, 2)', STRINGIFY_CALL],
    [".from('avatars')", NAMES_AVATARS_BUCKET],
    ['.from("avatars")', NAMES_AVATARS_BUCKET],
    ['.from(`avatars`)', NAMES_AVATARS_BUCKET],
    ["const BUCKET = 'avatars';", NAMES_AVATARS_BUCKET],
    ["{ bucket: 'avatars', path }", NAMES_AVATARS_BUCKET],
  ])('%s', (snippet, matcher) => {
    expect(snippet).toMatch(matcher);
  });

  it('the bucket matcher does not fire on look-alikes', () => {
    for (const snippet of [".from('avatars-old')", "const x = 'avatars/'", "'/api/user/avatar'", 'avatarsCount = 1']) {
      expect(snippet).not.toMatch(NAMES_AVATARS_BUCKET);
    }
  });

  it('the picker check catches the old accept and an svg type', () => {
    expect('accept="image/*"').toContain('image/*');
    expect('accept="image/png,image/svg+xml"'.toLowerCase()).toContain('svg');
  });

  it('comments are stripped before matching, or the hook would fail on its own explanation', () => {
    expect(read(HOOK)).toMatch(/avatars/);
    expect(stripComments("// supabase.from('profiles')\nconst a = 1;")).not.toMatch(TABLE_CALL);
  });
});

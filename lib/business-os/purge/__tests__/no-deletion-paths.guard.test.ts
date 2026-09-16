/**
 * C-34 — the repo-wide no-deletion-paths guard.
 *
 * This replaces the two per-file tombstone tests that previously guarded
 * `/api/user/delete-account` and `/api/admin/users/[id]/terminate`. Those
 * routes are now deleted outright, so a per-file assertion has nothing left to
 * attach to — and would have been the wrong shape anyway.
 *
 * ── Why repo-wide, in one sentence ─────────────────────────────────────────
 * A per-file assertion protects a path that already exists. The fifth deletion
 * path in this codebase was found precisely because it lay OUTSIDE the oracle
 * that had been specified: it never called the retired route, it deleted four
 * tables straight from the browser. A guard scoped to files we already know
 * about is structurally incapable of finding the sixth.
 *
 * ── The four deletion paths this codebase has already shipped ──────────────
 *   1. `supabase/SQL Scripts/delete_user_by_id.sql` — a PL/pgSQL variable named
 *      `user_id` filtering a column named `user_id`, i.e. `WHERE x = x`, which
 *      under one `plpgsql.variable_conflict` setting deletes every row in the
 *      table for every tenant. (Removed, PR #39.)
 *   2. `POST /api/user/delete-account` — deleted `auth.users`, which decision D3
 *      forbids absolutely, and 500'd partway through for every onboarded user
 *      because 16 `REFERENCES auth.users` declarations carry no `ON DELETE`.
 *   3. `POST /api/admin/users/[id]/terminate` — hard-deleted an arbitrary
 *      `auth.users` row from a URL parameter with NO authentication of any kind.
 *   4. `components/settings/SecurityTab.tsx` — deleted four identity tables from
 *      the browser behind a promise of a confirmation email that is never sent,
 *      with `Promise.all` inspecting no result, so an RLS denial and a success
 *      were indistinguishable to the user.
 *
 * None of the four was found by the oracle that had found the previous one.
 * That is the argument for scanning by SHAPE rather than by path.
 *
 * ── How this guard avoids the bug that broke the tombstone tests ───────────
 * The tombstone assertions stripped comments with a regex that ran block
 * comments before line comments. A glob in a line comment (`app/admin/**`)
 * opened a block-comment match that ran to the next `*\/`, swallowing real
 * code. It failed loudly there — but the SAME bug fails SILENTLY in the
 * permissive direction if the swallowed region is what you were looking for.
 *
 * Two structural answers, both deliberate:
 *   * `stripComments` is unit-tested below, against that exact input.
 *   * A primitive found inside a STRING LITERAL still counts as a hit. A false
 *     positive costs a conversation; a false negative costs an account.
 */

import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

/** Directories worth scanning. Everything a deletion affordance can live in. */
const SCAN_ROOTS = ['app', 'components', 'lib', 'hooks'];

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage']);

/**
 * Files permitted to contain a deletion primitive, each with the reason.
 *
 * ALLOW-LIST, never a deny-list. A deny-list only forbids the shapes someone
 * already thought of; an allow-list forces every new deletion path to be
 * argued for in a diff. Adding a line here should feel like a decision.
 */
const ALLOW_LIST: ReadonlyArray<{ file: string; why: string }> = [
  /*
   * Empty, and that is the correct state.
   *
   * This list held one entry: `app/api/auth/cleanup-incomplete/route.ts`, the
   * last live `auth.admin.deleteUser` in the repo. It deleted accounts older
   * than 24h whose `user_metadata.onboarding_completed` was not true — a flag
   * the current onboarding flow never writes, so every onboarded business was
   * a deletion candidate. It was dormant only because CRON_SECRET is unset,
   * and setting that secret would have armed it along with every other cron.
   *
   * PR #42 deleted that route outright, so the exemption is removed here as
   * part of merging main: an allow-list entry for a file that no longer exists
   * is a stale exemption that would silently cover a future file re-created at
   * the same path — which is what the existence assertion below is for. The
   * hazard is resolved rather than deferred; the T32 hand-off about that cron
   * no longer has a subject.
   *
   * An empty allow-list means no file anywhere may contain a deletion
   * primitive. Adding a line back should feel like a decision.
   */
];

const ALLOWED_FILES = new Set(ALLOW_LIST.map((a) => a.file));

/**
 * Identity / account tables. A BROWSER has no business deleting any of these.
 *
 * `plugin_connections` is included here but NOT in the server list below: the
 * shape that matters is a client deleting it as part of a fake "delete my
 * account" (which is exactly what CR-1 did), whereas a properly scoped
 * disconnect endpoint on the server is an ordinary product feature.
 */
const IDENTITY_TABLES_CLIENT = [
  'profiles',
  'business_profiles',
  'user_preferences',
  'notification_settings',
  'security_settings',
  'plugin_connections',
  'admin_users',
];

/**
 * The subset no SERVER route may delete either.
 *
 * `plugin_connections` is deliberately absent: `app/api/plugin-connections/route.ts`
 * deletes with `.eq('plugin_key', …).eq('user_id', userId)` — a user
 * disconnecting their own integration, which is the feature working. Putting it
 * here would force an allow-list entry for ordinary behaviour, and an allow-list
 * padded with routine exceptions stops being read.
 */
const IDENTITY_TABLES_SERVER = [
  'profiles',
  'business_profiles',
  'user_preferences',
  'notification_settings',
  'security_settings',
  'admin_users',
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name)) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(e.name) ? [full] : [];
  });
}

/**
 * Remove comments so documentation cannot match itself.
 *
 * LINE COMMENTS FIRST — see the header. Unit-tested below, because a stripper
 * that mangles its input turns every assertion downstream into a coin flip that
 * lands on "clean".
 */
export function stripComments(source: string): string {
  return source
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

const rel = (f: string) => path.relative(REPO_ROOT, f).split(path.sep).join('/');

const FILES = SCAN_ROOTS.flatMap((r) => walk(path.join(REPO_ROOT, r)));

interface Scanned {
  file: string;
  code: string;
  isClient: boolean;
}

/**
 * This file. Excluded from its own scan by exact path.
 *
 * It must contain every forbidden primitive by construction — in the allow-list
 * reasons, in the synthetic fixture, and in the header documenting the four
 * shipped deletion paths. Excluded by PATH rather than by "skip all tests",
 * because a test file is a perfectly good place to hide a real deletion path
 * and blanket-exempting `__tests__` would be a hole big enough to drive the
 * next incident through.
 */
const SELF = 'lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts';

const SCANNED: Scanned[] = FILES.filter((f) => rel(f) !== SELF).map((f) => {
  const raw = fs.readFileSync(f, 'utf-8');
  return {
    file: rel(f),
    code: stripComments(raw),
    isClient: /^\s*['"]use client['"]/m.test(raw),
  };
});

describe('repo-wide guard: no deletion paths outside the purge engine (C-34)', () => {
  describe('the guard actually ran', () => {
    it('scanned a plausible number of files', () => {
      // CONDITION 1 — fail closed on a file-count floor.
      //
      // "Scanned 0 files, found 0 violations" is a green build that proves
      // nothing, and it is the same defect as the comment-stripper one level
      // up: the checker's INPUT silently became empty, so its OUTPUT is
      // meaningless in the permissive direction. A renamed directory, a changed
      // extension, or a path assumption broken by a move would all produce it.
      expect(SCANNED.length).toBeGreaterThan(500);
    });

    it('found the directories it expects to scan', () => {
      for (const root of SCAN_ROOTS) {
        expect(SCANNED.some((s) => s.file.startsWith(`${root}/`))).toBe(true);
      }
    });

    it('every allow-listed file still exists', () => {
      // An allow-list entry for a deleted file is a stale exemption that would
      // silently cover a future file re-created at the same path.
      for (const entry of ALLOW_LIST) {
        expect(fs.existsSync(path.join(REPO_ROOT, entry.file))).toBe(true);
      }
    });
  });

  describe('stripComments', () => {
    // CONDITION 4 — unit-test the stripper itself.
    it('removes line and block comments', () => {
      expect(stripComments('// gone\nconst a = 1;')).not.toContain('gone');
      expect(stripComments('/* gone */const a = 1;')).not.toContain('gone');
      expect(stripComments('const a = 1; // gone')).toContain('const a = 1;');
    });

    it('does NOT let a glob inside a line comment swallow the code after it', () => {
      // The exact input that broke the tombstone assertions. `app/admin/**`
      // contains `/*`; stripping block comments first matched from there to the
      // next `*/` and ate the imports.
      const source = [
        '// scope note: app/admin/** is unauthenticated',
        "import { createLogger } from '@/lib/logger';",
        '/** a real docblock */',
        'const x = 1;',
      ].join('\n');

      const code = stripComments(source);

      expect(code).toContain('createLogger');
      expect(code).toContain('const x = 1;');
      expect(code).not.toContain('a real docblock');
    });

    it('keeps string literals intact', () => {
      // CONDITION 5 — a primitive inside a string still counts. The stripper
      // must not be clever enough to remove it.
      expect(stripComments("const s = 'auth.admin.deleteUser';")).toContain('auth.admin.deleteUser');
    });
  });

  describe('assertion family 1 — auth.admin.deleteUser', () => {
    it('appears only in allow-listed files', () => {
      const offenders = SCANNED.filter(
        (s) => s.code.includes('auth.admin.deleteUser') && !ALLOWED_FILES.has(s.file)
      ).map((s) => s.file);

      expect(offenders).toEqual([]);
    });
  });

  describe('assertion family 2 — client-side deletes on identity tables (the CR-1 shape)', () => {
    it('no client component deletes from an identity table', () => {
      // `components/settings/SecurityTab.tsx` did exactly this: four
      // `supabase.from(<identity>).delete()` calls in a `'use client'` file,
      // with no result inspected. RLS is the only thing between that and data
      // loss, and supabase-js does not throw when RLS denies — it returns
      // `{ error }`, which that code ignored.
      const offenders: string[] = [];

      for (const s of SCANNED) {
        if (!s.isClient) continue;
        for (const table of IDENTITY_TABLES_CLIENT) {
          const pattern = new RegExp(`from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,120}?\\.delete\\(`);
          if (pattern.test(s.code)) offenders.push(`${s.file}: ${table}`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  describe('assertion family 3 — server routes deleting identity tables', () => {
    it('no app/api route deletes from an identity table outside the purge engine', () => {
      const offenders: string[] = [];

      for (const s of SCANNED) {
        if (!s.file.startsWith('app/api/')) continue;
        if (ALLOWED_FILES.has(s.file)) continue;
        // The purge engine and the repository layer are where deletion is
        // supposed to live; both are covered by their own guards (B-1, AC-45).
        if (s.file.includes('business-os/purge')) continue;

        for (const table of IDENTITY_TABLES_SERVER) {
          const pattern = new RegExp(`from\\(\\s*['"\`]${table}['"\`]\\s*\\)[\\s\\S]{0,120}?\\.delete\\(`);
          if (pattern.test(s.code)) offenders.push(`${s.file}: ${table}`);
        }
      }

      expect(offenders).toEqual([]);
    });
  });

  describe('the guard can actually fail', () => {
    it('detects each forbidden shape in a synthetic fixture', () => {
      // Without this, a regex typo makes every assertion above vacuous and the
      // suite reports clean forever. Same reasoning as the file-count floor,
      // applied to the patterns rather than to the inputs.
      const fixture = stripComments(
        [
          "await supabase.auth.admin.deleteUser(userId);",
          "await supabase.from('profiles').delete().eq('id', userId);",
        ].join('\n')
      );

      expect(fixture.includes('auth.admin.deleteUser')).toBe(true);
      expect(
        new RegExp(`from\\(\\s*['"\`]profiles['"\`]\\s*\\)[\\s\\S]{0,120}?\\.delete\\(`).test(fixture)
      ).toBe(true);
    });
  });
});

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
import { INITIAL_FUNCTION_MIGRATION, MIGRATION_FILE, PREVIOUS_MIGRATION_FILE } from '@/scripts/generate-test-account-cleanup-sql';

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
 * Assertion family 4 (SA-8, 2026-10-07): raw SQL that deletes the login.
 *
 * Families 1 to 3 look for supabase-js shapes, so a SQL string slipped
 * through. Its own allow-list, so the entry below cannot also excuse an
 * `auth.admin.deleteUser`.
 */
const SQL_LOGIN_DELETE = /DELETE\s+FROM\s+auth\.users/i;
/**
 * SQL roots family 4 also scans (SA re-ruling R-7): a function applied by a
 * migration is a deletion path too. `.sql` files only: the `__tests__` beside
 * them plant this exact shape as fixtures.
 */
const SQL_SCAN_ROOTS = ['supabase/migrations', 'supabase/held'];
const SQL_LOGIN_DELETE_ALLOW_LIST: ReadonlyArray<{ file: string; why: string }> = [
  {
    // From the generator, so this file does not itself name the function (R-7).
    file: MIGRATION_FILE,
    why:
      'Operator exception OX-1r: the generated, secret-gated test-account cleanup function, called only by ' +
      'the admin-only /api/admin/test-account-cleanup/* routes, behind its second-secret check (42501) and ' +
      'guards G-1 to G-19 (email contains the test tag, never an admin, no real money). EXECUTE is granted to ' +
      'service_role only. Generated by scripts/generate-test-account-cleanup-sql.ts and pinned by its drift test.',
  },
  {
    // The previous version of the same function (20261096, MX-1a, since 20261104), kept as
    // history and pinned by sha256. The 20261104 pre-check requires its stamp live.
    file: PREVIOUS_MIGRATION_FILE,
    why:
      'Operator exception OX-1r: the previous, applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // An older applied version (20261094, DL-1a, the account closures), also history and pinned by
    // sha256. Named on its own since 20261104 moved PREVIOUS_MIGRATION_FILE on to 20261096. Built
    // from the generator's constant: its name spells the cleanup function, so R-7 forbids a literal.
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261094')}_account_closures.sql`,
    why:
      'Operator exception OX-1r: an older applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // An older applied version (20261092, the meeting links), also history and pinned by sha256.
    // Named on its own since MX-1a moved PREVIOUS_MIGRATION_FILE on to 20261094 (SA M-4). Built
    // from the generator's constant: its name spells the cleanup function, so R-7 forbids a literal.
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261092')}_meeting_links.sql`,
    why:
      'Operator exception OX-1r: an older applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // An older applied version (DE-10b.1's 20261081), also history and pinned by sha256. Named
    // literally (SA W-7): it stopped being PREVIOUS_MIGRATION_FILE when DL-1a moved that on to 20261092.
    // Its name does not spell the cleanup function, so R-7 holds.
    file: 'supabase/migrations/20261081_operator_account_cleanup_anonymise.sql',
    why:
      'Operator exception OX-1r: an older applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // An older applied version (finance 4b.1's 20261077), also history and pinned by sha256
    // (20261092 moved PREVIOUS_MIGRATION_FILE on to 20261081).
    // Built from the generator's constant so the function name stays in one file (R-7).
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261077')}_boost_reversal_events.sql`,
    why:
      'Operator exception OX-1r: an older applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // An older applied version (20261075, data export DE-8a), also history and pinned by sha256
    // (DE-10b.1 moved PREVIOUS_MIGRATION_FILE on to 20261077).
    // Built from the generator's constant so the function name stays in one file (R-7).
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261075')}_data_exports.sql`,
    why:
      'Operator exception OX-1r: an older applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // An older applied version (20261047), also history and pinned by sha256 (finance 4b.1 moved
    // PREVIOUS_MIGRATION_FILE on to DE-8a's 20261075).
    // Built from the generator's constant so the function name stays in one file (R-7).
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261047')}_audit_actor.sql`,
    why:
      'Operator exception OX-1r: an older applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // An older applied version (20261046), also history and pinned by sha256 (data export DE-8a
    // moved PREVIOUS_MIGRATION_FILE on to 20261047).
    // Built from the generator's constant so the function name stays in one file (R-7).
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261046')}_notnull_order.sql`,
    why:
      'Operator exception OX-1r: an older applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // An older applied version (20261043), also history and pinned by sha256.
    // Built from the generator's constant so the function name stays in one file (R-7).
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261043')}_insight_links.sql`,
    why:
      'Operator exception OX-1r: an older applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // An older applied version (20261042), also history and pinned by sha256.
    // Built from the generator's constant so the function name stays in one file (R-7).
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261042')}_billing_events.sql`,
    why:
      'Operator exception OX-1r: an older applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // The first applied version (20261041), also history and pinned by sha256.
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION}.sql`,
    why:
      'Operator exception OX-1r: the first applied version of the same secret-gated cleanup function. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
];

/**
 * Assertion family 4, extended (DE-10b.1, SA C2-6): raw SQL that rewrites the
 * login or deletes from any other `auth` table. The anonymise mode closes a
 * login in place (UPDATE auth.users) and deletes its identities, sessions,
 * tokens, factors and auth-log rows. SA Review 2 §D approves those writes ONLY
 * inside the generated cleanup function of FUNCTION_MIGRATION, as an extension
 * of OX-1r. Its own allow-list: only FUNCTION_MIGRATION and the applied 20261081 that
 * first carried them (PREVIOUS_MIGRATION_FILE since 20261092) hold them.
 *
 * `DELETE FROM auth.<anything but users>` covers the dynamic `auth.%I` delete
 * as well as every named table; `DELETE FROM auth.users` stays family 4 above.
 */
const SQL_AUTH_WRITES: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'UPDATE auth.users', pattern: /UPDATE\s+auth\.users\b/i },
  { name: 'UPDATE auth.<table>', pattern: /UPDATE\s+auth\.\S+/i },
  { name: 'DELETE FROM auth.<table other than users>', pattern: /DELETE\s+FROM\s+auth\.(?!users\b)\S+/i },
];
type AuthWriteShape = (typeof SQL_AUTH_WRITES)[number]['name'];
const ALL_AUTH_WRITE_SHAPES: ReadonlyArray<AuthWriteShape> = SQL_AUTH_WRITES.map((w) => w.name);
/**
 * DL-1a (SA W-7): each entry lists the EXACT shapes it holds. The guard checks
 * both ways: every listed shape is still there, and no other shape is. So the
 * 20261093 session cut is pinned to the auth delete of a table other than
 * users only, and a later edit or comment adding an UPDATE of auth.users fails.
 */
const SQL_AUTH_WRITE_ALLOW_LIST: ReadonlyArray<{ file: string; shapes: ReadonlyArray<AuthWriteShape>; why: string }> = [
  {
    file: MIGRATION_FILE,
    shapes: ALL_AUTH_WRITE_SHAPES,
    why:
      'SA Review 2 §D (DE-10b.1): the generated, secret-gated cleanup function closes and anonymises a login in ' +
      'place in its anonymise mode, behind G-1, G-2a and G-4 to G-22, and EXECUTE is service_role only. Generated ' +
      'by scripts/generate-test-account-cleanup-sql.ts and pinned by its drift test.',
  },
  {
    // 20261096 (MX-1a), the previous applied version since 20261104. Never edited, pinned
    // by sha256. Its writes are the same reviewed ones (SA Review 2 §D).
    file: PREVIOUS_MIGRATION_FILE,
    shapes: ALL_AUTH_WRITE_SHAPES,
    why:
      'SA Review 2 §D (DE-10b.1): the previous, applied version of the same generated, secret-gated cleanup ' +
      'function, with the same reviewed anonymise writes. Never edited once applied; ' +
      'scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // 20261094 (DL-1a), an older applied version named on its own since 20261104. Built from the
    // generator's constant so this file does not name the cleanup function (R-7).
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261094')}_account_closures.sql`,
    shapes: ALL_AUTH_WRITE_SHAPES,
    why:
      'SA Review 2 §D (DE-10b.1): an older applied version of the same generated, secret-gated cleanup ' +
      'function, with the same reviewed anonymise writes. Never edited once applied; ' +
      'scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // 20261092 (the meeting links), an older applied version named on its own since MX-1a (SA M-4,
    // W-7). Built from the generator's constant so this file does not name the cleanup function (R-7).
    file: `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261092')}_meeting_links.sql`,
    shapes: ALL_AUTH_WRITE_SHAPES,
    why:
      'SA Review 2 §D (DE-10b.1): an older applied version of the same generated, secret-gated cleanup ' +
      'function, with the same reviewed anonymise writes. Never edited once applied; ' +
      'scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // DE-10b.1's 20261081 introduced these writes. An older applied version, named literally (SA W-7).
    file: 'supabase/migrations/20261081_operator_account_cleanup_anonymise.sql',
    shapes: ALL_AUTH_WRITE_SHAPES,
    why:
      'SA Review 2 §D (DE-10b.1): the applied version that first carried the reviewed anonymise writes. ' +
      'Never edited once applied; scripts/__tests__/testAccountCleanupSql.test.ts pins its bytes.',
  },
  {
    // DL-1a (XC-3, XC-21, SA W-3 and W-7): the session cut function. Never in the login delete list.
    file: 'supabase/migrations/20261093_business_os_account_closures.sql',
    shapes: ['DELETE FROM auth.<table other than users>'],
    why:
      'XC-21 (account deletion lifecycle): the session cut function removes auth.sessions and auth.refresh_tokens ' +
      'rows of ONE account, refusing with 42501 unless that account has a locked closure row or a grace row past ' +
      'its lock time (SA W-3). It runs with its owner rights, EXECUTE is service_role only, and it holds no other ' +
      'auth write.',
  },
];

/** Every scanned file holding `pattern` that is not on the auth-write allow-list. */
export function authWriteOffenders(scanned: ReadonlyArray<{ file: string; code: string }>, pattern: RegExp): string[] {
  const allowed = new Set(SQL_AUTH_WRITE_ALLOW_LIST.map((a) => a.file));
  return scanned.filter((s) => pattern.test(s.code) && !allowed.has(s.file)).map((s) => s.file);
}

/**
 * Assertion family 5 (DE-10b.1, SA TQ-10): who may import the repository that
 * calls the cleanup function. It is the one way into a delete or a close of a
 * real account, so a new caller must be argued for here, in a diff. Tests of an
 * allowed file may import it too.
 *
 * DE-10b.2 (SA workplan review V-2): the self-delete routes do NOT import it.
 * They reach the engine through `selfServiceDeletion.ts`, the one self-service
 * runner next to `runAccountAnonymise`, so the list grew by that runner and its
 * test, and by no route file. A customer route that imports the repository
 * directly fails here.
 */
const CLEANUP_REPOSITORY_IMPORT = /from\s+['"](?:@\/lib\/repositories\/|\.{1,2}\/(?:[\w.-]+\/)*)TestAccountCleanupRepository['"]/;
const CLEANUP_REPOSITORY_FILE = 'lib/repositories/TestAccountCleanupRepository.ts';
const CLEANUP_REPOSITORY_IMPORTERS: ReadonlyArray<{ file: string; why: string }> = [
  { file: 'app/api/admin/test-account-cleanup/check/route.ts', why: 'The admin check, requireAdmin first.' },
  { file: 'app/api/admin/test-account-cleanup/delete/route.ts', why: 'The admin delete and anonymise, requireAdmin first.' },
  { file: 'lib/business-os/test-account-cleanup/runCleanupDelete.ts', why: 'The ordered test-account delete (G-3, check, version, storage, delete).' },
  { file: 'lib/business-os/account-deletion/runAccountAnonymise.ts', why: 'The ordered anonymise (check, version, storage, anonymise), DE-10b.1.' },
  { file: 'app/api/admin/test-account-cleanup/__tests__/route.test.ts', why: 'Test of the two routes.' },
  { file: 'lib/repositories/__tests__/TestAccountCleanupRepository.test.ts', why: 'Test of the repository.' },
  { file: 'lib/business-os/test-account-cleanup/__tests__/cleanupApiTypes.wireTypes.test.ts', why: 'Type-level pin of the wire types.' },
  { file: 'lib/business-os/account-deletion/__tests__/runAccountAnonymise.test.ts', why: 'Test of runAccountAnonymise.' },
  {
    file: 'lib/business-os/account-deletion/selfServiceDeletion.ts',
    why: 'DE-10b.2 self-delete runners (pre-check and anonymise) on the SESSION user; the customer routes call these, never the repository.',
  },
  { file: 'lib/business-os/account-deletion/__tests__/selfServiceDeletion.test.ts', why: 'Test of the self-service runners.' },
];

/** Every file that imports the cleanup repository and is not on the allow-list. */
export function cleanupRepositoryImportOffenders(scanned: ReadonlyArray<{ file: string; code: string }>): string[] {
  const allowed = new Set([CLEANUP_REPOSITORY_FILE, ...CLEANUP_REPOSITORY_IMPORTERS.map((entry) => entry.file)]);
  return scanned.filter((s) => CLEANUP_REPOSITORY_IMPORT.test(s.code) && !allowed.has(s.file)).map((s) => s.file);
}

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

function walkSql(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP_DIRS.has(e.name) || e.name === '__tests__') return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walkSql(full);
    return e.name.endsWith('.sql') ? [full] : [];
  });
}

/** Raw SQL text: a primitive in a SQL comment still counts, same as a TS string. */
const SQL_SCANNED = SQL_SCAN_ROOTS.flatMap((r) => walkSql(path.join(REPO_ROOT, r))).map((f) => ({
  file: rel(f),
  code: fs.readFileSync(f, 'utf-8'),
}));

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

  describe('assertion family 4 — raw SQL deleting the login (SA-8)', () => {
    it('appears only in the generated cleanup SQL', () => {
      const allowed = new Set(SQL_LOGIN_DELETE_ALLOW_LIST.map((a) => a.file));
      const offenders = [...SCANNED, ...SQL_SCANNED]
        .filter((s) => SQL_LOGIN_DELETE.test(s.code) && !allowed.has(s.file))
        .map((s) => s.file);
      expect(offenders).toEqual([]);
    });

    it('scanned the SQL roots', () => {
      expect(SQL_SCANNED.length).toBeGreaterThan(20);
      expect(SQL_SCANNED.some((s) => s.file.startsWith('supabase/held/'))).toBe(true);
    });

    it('every allow-listed file still exists and still holds it', () => {
      // An exemption that no longer matches anything is stale and must go.
      for (const entry of SQL_LOGIN_DELETE_ALLOW_LIST) {
        const hit = [...SCANNED, ...SQL_SCANNED].find((s) => s.file === entry.file);
        expect([entry.file, Boolean(hit && SQL_LOGIN_DELETE.test(hit.code))]).toEqual([entry.file, true]);
      }
    });
  });

  describe('assertion family 4, extended — raw SQL writing auth tables (DE-10b.1, C2-6)', () => {
    it.each(SQL_AUTH_WRITES.map((w) => [w.name, w.pattern] as const))('%s appears only in the allow-listed files', (_name, pattern) => {
      expect(authWriteOffenders([...SCANNED, ...SQL_SCANNED], pattern)).toEqual([]);
    });

    it('every allow-listed file still exists and holds exactly its listed shapes, and none of the others (SA W-7)', () => {
      for (const entry of SQL_AUTH_WRITE_ALLOW_LIST) {
        const hit = [...SCANNED, ...SQL_SCANNED].find((s) => s.file === entry.file);
        expect([entry.file, Boolean(hit)]).toEqual([entry.file, true]);
        for (const write of SQL_AUTH_WRITES) {
          const expected = entry.shapes.includes(write.name);
          expect([entry.file, write.name, Boolean(hit && write.pattern.test(hit.code))]).toEqual([entry.file, write.name, expected]);
        }
      }
    });

    it('the 20261093 session cut is pinned to one shape and is never a login delete (SA W-7)', () => {
      const entry = SQL_AUTH_WRITE_ALLOW_LIST.find((e) => e.file === 'supabase/migrations/20261093_business_os_account_closures.sql');
      expect(entry?.shapes).toEqual(['DELETE FROM auth.<table other than users>']);
      expect(SQL_LOGIN_DELETE_ALLOW_LIST.map((e) => e.file)).not.toContain('supabase/migrations/20261093_business_os_account_closures.sql');
    });

    it('20261081 is a literal entry in both lists, 20261092 and 20261094 are named on their own, and 20261096 is the previous file (SA W-7, M-4)', () => {
      const literal = 'supabase/migrations/20261081_operator_account_cleanup_anonymise.sql';
      expect(SQL_LOGIN_DELETE_ALLOW_LIST.map((e) => e.file)).toContain(literal);
      expect(SQL_AUTH_WRITE_ALLOW_LIST.map((e) => e.file)).toContain(literal);
      // Built from the generator's constant so this file does not name the cleanup function (R-7).
      const meetingLinks = `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261092')}_meeting_links.sql`;
      expect(SQL_LOGIN_DELETE_ALLOW_LIST.map((e) => e.file)).toContain(meetingLinks);
      expect(SQL_AUTH_WRITE_ALLOW_LIST.find((e) => e.file === meetingLinks)?.shapes).toEqual(ALL_AUTH_WRITE_SHAPES);
      expect(PREVIOUS_MIGRATION_FILE).not.toBe(meetingLinks);
      const closures = `supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261094')}_account_closures.sql`;
      expect(SQL_LOGIN_DELETE_ALLOW_LIST.map((e) => e.file)).toContain(closures);
      expect(SQL_AUTH_WRITE_ALLOW_LIST.find((e) => e.file === closures)?.shapes).toEqual(ALL_AUTH_WRITE_SHAPES);
      expect(PREVIOUS_MIGRATION_FILE).not.toBe(closures);
      expect(PREVIOUS_MIGRATION_FILE).toBe(`supabase/migrations/${INITIAL_FUNCTION_MIGRATION.replace('20261041', '20261096')}_export_requests.sql`);
    });

    it('the older applied versions hold none of the new writes', () => {
      // Older than the versions that carry them (FUNCTION_MIGRATION, 20261096, 20261094, 20261092 and 20261081).
      const carriers = new Set(SQL_AUTH_WRITE_ALLOW_LIST.map((e) => e.file));
      const older = SQL_LOGIN_DELETE_ALLOW_LIST.filter((e) => !carriers.has(e.file));
      // 20261077, 20261075, 20261047, 20261046, 20261043, 20261042 and 20261041 (SA W-7).
      expect(older.map((e) => /\/(\d{8})_/.exec(e.file)?.[1]).sort()).toEqual([
        '20261041', '20261042', '20261043', '20261046', '20261047', '20261075', '20261077',
      ]);
      for (const entry of older) {
        const hit = SQL_SCANNED.find((s) => s.file === entry.file);
        for (const write of SQL_AUTH_WRITES) {
          expect([entry.file, write.name, Boolean(hit && write.pattern.test(hit.code))]).toEqual([entry.file, write.name, false]);
        }
      }
    });

    it('negative fixture: a DELETE FROM auth.sessions in a file that is not allow-listed fails', () => {
      const write = SQL_AUTH_WRITES.find((w) => w.name === 'DELETE FROM auth.<table other than users>');
      const planted = [{ file: 'supabase/migrations/20261099_rogue_sign_out.sql', code: 'DELETE FROM auth.sessions WHERE user_id = p_user_id;' }];
      expect(write).toBeDefined();
      expect(authWriteOffenders(planted, write!.pattern)).toEqual(['supabase/migrations/20261099_rogue_sign_out.sql']);
    });

    it.each([
      ['update in mixed case', 'const sql = `Update   AUTH.USERS set email = $1`;', 'UPDATE auth.users'],
      ['update across a newline', 'const sql = `update\n auth.users set phone = null`;', 'UPDATE auth.users'],
      ['update of another auth table', "const sql = 'UPDATE auth.identities SET x = 1';", 'UPDATE auth.<table>'],
      ['named delete', "const sql = 'delete from auth.sessions where user_id = $1';", 'DELETE FROM auth.<table other than users>'],
      ['delete across spaces and a newline', 'const sql = `DELETE   FROM\n  auth.refresh_tokens`;', 'DELETE FROM auth.<table other than users>'],
      ['dynamic delete', "EXECUTE format('DELETE FROM auth.%I WHERE %I = %L', t, c, v);", 'DELETE FROM auth.<table other than users>'],
      ['auth log delete', 'DELETE FROM auth.audit_log_entries AS log_rows WHERE true;', 'DELETE FROM auth.<table other than users>'],
    ])('negative fixture: %s is detected', (_name, fixture, shape) => {
      const write = SQL_AUTH_WRITES.find((w) => w.name === shape);
      expect(write?.pattern.test(stripComments(fixture))).toBe(true);
    });

    it('does not mistake the login delete of family 4 for the new shape', () => {
      expect(SQL_AUTH_WRITES[2].pattern.test('DELETE FROM auth.users WHERE id = $1')).toBe(false);
    });
  });

  describe('assertion family 5 — who may import the cleanup repository (DE-10b.1, TQ-10)', () => {
    it('only the allow-listed routes, runners and their tests', () => {
      expect(cleanupRepositoryImportOffenders(SCANNED)).toEqual([]);
    });

    it('every allow-listed importer exists and really imports it', () => {
      for (const entry of CLEANUP_REPOSITORY_IMPORTERS) {
        const hit = SCANNED.find((s) => s.file === entry.file);
        expect([entry.file, Boolean(hit && CLEANUP_REPOSITORY_IMPORT.test(hit.code))]).toEqual([entry.file, true]);
      }
    });

    it.each([
      ["import { TestAccountCleanupRepository } from '@/lib/repositories/TestAccountCleanupRepository';"],
      ['import type { CleanupCheckResult } from "@/lib/repositories/TestAccountCleanupRepository";'],
      ["import { TestAccountCleanupRepository } from '../../lib/repositories/TestAccountCleanupRepository';"],
    ])('negative fixture: %s in a synthetic app/api/foo/route.ts is detected', (line) => {
      expect(cleanupRepositoryImportOffenders([{ file: 'app/api/foo/route.ts', code: stripComments(line) }])).toEqual(['app/api/foo/route.ts']);
    });

    // DE-10b.2, SA V-2: the customer routes reach the engine through the self-service runner only.
    it.each(['app/api/business-os/account/delete/route.ts', 'app/api/business-os/account/deletion-check/route.ts'])(
      '%s exists, imports the self-service runner and not the repository',
      (file) => {
        const hit = SCANNED.find((s) => s.file === file);
        expect(hit).toBeDefined();
        expect(CLEANUP_REPOSITORY_IMPORT.test(hit!.code)).toBe(false);
        expect(hit!.code).toMatch(/from '@\/lib\/business-os\/account-deletion\/selfServiceDeletion'/);
        expect(CLEANUP_REPOSITORY_IMPORTERS.map((entry) => entry.file)).not.toContain(file);
      }
    );

    it('negative fixture: the self-delete route importing the repository directly is detected', () => {
      const file = 'app/api/business-os/account/delete/route.ts';
      const code = stripComments("import { TestAccountCleanupRepository } from '@/lib/repositories/TestAccountCleanupRepository';");
      expect(cleanupRepositoryImportOffenders([{ file, code }])).toEqual([file]);
    });
  });

  describe('the guard can actually fail', () => {
    it('detects raw SQL deleting the login, in any case and spacing', () => {
      const fixture = stripComments('const sql = `delete  from\n AUTH.USERS where id = $1`;');
      expect(SQL_LOGIN_DELETE.test(fixture)).toBe(true);
    });

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

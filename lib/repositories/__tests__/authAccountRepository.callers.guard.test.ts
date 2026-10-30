/**
 * Who may reach `auth.users` through `AuthAccountRepository` (Slice 1a, SA R-4).
 *
 * The lookup answers "does this email already have an account?". Asked about
 * an arbitrary email it would be an enumeration oracle, so it is asked only by
 * the invite path, and only about the email of an invite whose 256-bit token
 * already matched (requirement §8.1, workplan D-12). This guard pins the first
 * half of that: which files may name the repository at all. The second half,
 * that the argument is always the matched row's email, is pinned in
 * `lib/business-os/invites/__tests__/publicInviteView.test.ts`.
 *
 * ALLOW-LIST, not a deny-list: a new caller must be argued for in a diff.
 * Slice 1b added the redemption flow and its production wiring.
 *
 * The repository is deliberately NOT exported from the `lib/repositories`
 * barrel: an import through the barrel would name only `@/lib/repositories`,
 * and this guard could no longer see who uses it.
 *
 * SA CR-2: naming the class is not the only way in. A file could call
 * `supabase.rpc('business_os_auth_email_has_account', …)` directly and bypass
 * both the class allow-list and R-4. So the SQL function NAME is scanned too,
 * across the code directories AND `supabase/` (migrations, SQL scripts), in
 * `.ts`/`.tsx`/`.js`/`.mjs`/`.sql` files. It may appear only in the repository
 * (the one caller), its test, this guard, and the migration's own files.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SCANNED_DIRS = ['app', 'lib', 'components', 'hooks', 'scripts'];
const SKIP = new Set(['node_modules', '.next', '.git']);

const SYMBOLS = /\b(?:AuthAccountRepository|authAccountRepository)\b/;

const ALLOWED = new Set(
  [
    // The repository, its test, and this guard.
    'lib/repositories/AuthAccountRepository.ts',
    'lib/repositories/__tests__/AuthAccountRepository.test.ts',
    'lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts',
    // The public invite check: types the dependency, and wires the instance.
    'lib/business-os/invites/publicInviteView.ts',
    'app/api/public/invites/validate/route.ts',
    // Their tests (they replace the instance with a fake).
    'lib/business-os/invites/__tests__/publicInviteView.test.ts',
    'app/api/public/invites/validate/__tests__/route.test.ts',
    // Slice 1b: the redemption flow types the dependency, and the production
    // wiring hands it the instance. Its argument is always the matched invite
    // row's email and the server-generated account id (I-3), never request data.
    'lib/business-os/invites/inviteRedemption.ts',
    'lib/business-os/invites/redemptionDeps.ts',
    'lib/business-os/invites/__tests__/redemptionDeps.test.ts',
    // Plan payments P-5b.1 (SA C-10): the N-1 inviter lookups moved, verbatim,
    // into one shared builder used by the redemption and by N-2. It calls only
    // `findUserIdentity`, keyed on the ISSUER id of an invite the caller already
    // matched (a token, or the paying account's own lineage row). Its test
    // replaces the instance.
    'lib/business-os/invites/inviterNotificationDeps.ts',
    'lib/business-os/invites/__tests__/inviterNotificationDeps.test.ts',
    // Slice 5b (QA-1): the friend code route's end-to-end test replaces the
    // instance with a fake, to prove both kinds of address get one answer.
    'app/api/public/invites/signup/__tests__/code.friend.route.test.ts',
    // Admin delete AD-1b (SA D-1): the admin deletion preview reads ONE
    // account's id, email and joined date (`findUserIdentity`), for an id taken
    // from an admin-gated route path. Its test replaces the instance.
    'lib/business-os/purge/AdminDeletionPreview.ts',
    'lib/business-os/purge/__tests__/AdminDeletionPreview.test.ts',
    // Admin delete AD-2a: the commit re-reads the same ONE account's identity
    // (path id, admin-gated) for the server-side typed-name confirmation. Its
    // tests replace the instance.
    'lib/business-os/purge/AdminDeletionCommit.ts',
    'lib/business-os/purge/__tests__/AdminDeletionCommit.test.ts',
    'app/api/admin/users/[id]/deletion/commit/__tests__/route.test.ts',
    // Data export DE-10a (workplan §5.2): the admin prepare reads ONE account's
    // id, email and joined date (`findUserIdentity`) for an id taken from the
    // admin-gated route path, to build the export of that account (the email
    // goes into the zip's account section only, never a log or audit row). Its
    // test replaces the instance.
    'app/api/admin/users/[id]/data-exports/route.ts',
    'app/api/admin/users/[id]/data-exports/__tests__/route.test.ts',
    // Account deletion lifecycle D4a / SX-3 (SA S-7): the plan cancel emails
    // read the SESSION user's own live address (`findUserIdentity`, keyed on
    // the id from `getUser()`, never request data) to send them the cancel /
    // keep email. The address goes to the transport only, never a log or audit
    // row. The routes' email test replaces the instance.
    // D4b (SX-3 part 2): the same file wires the plan-ends reminder cron, which
    // reads the address of the CLAIMED billing row's own account (its `user_id`,
    // from `claim_bos_plan_cancel_reminders`, never input) to send that owner
    // their reminder. Same rule: transport only, never a log or audit row.
    'lib/business-os/billing/planCancelEmailDeps.ts',
    'app/api/business-os/billing/plan/cancel/__tests__/route.d4a.test.ts',
    // The billing router-placement guard lists planCancelEmailDeps.ts's repository
    // imports by name (its allow-list); it imports nothing.
    'app/api/stripe/webhook/__tests__/routerPlacement.guard.test.ts',
    // Data export MX-3b: the module export worker's production wiring reads ONE
    // account's login email with `findUserIdentity`, keyed on the claimed job's
    // own user_id (never request data), to send that owner their export emails.
    // The address goes to the transport only (recipient redacted in logs, C-3),
    // never a log or audit row. The worker test replaces the deps.
    'lib/business-os/data-export/moduleExportWorkerDeps.ts',
  ].map((file) => file.split('/').join(sep))
);

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [full] : [];
  });
}

/**
 * QA-2: deployed code also lives at the repo root (`middleware.ts`,
 * `i18n.ts`, the config files). Root files are scanned one level deep only;
 * the root's subdirectories are covered by the directory scans.
 */
function rootFiles(extensions: RegExp): string[] {
  return readdirSync(ROOT)
    .filter((name) => extensions.test(name))
    .map((name) => join(ROOT, name))
    .filter((full) => statSync(full).isFile());
}

const FILES = [...SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir))), ...rootFiles(/\.(ts|tsx|js|mjs)$/)];

/** CR-2: where the SQL function name may appear. */
const FUNCTION_NAME = /business_os_auth_email_has_account/;
const FUNCTION_SCANNED_DIRS = [...SCANNED_DIRS, 'supabase'];
const FUNCTION_ALLOWED = new Set(
  [
    // The one caller, its test, and this guard.
    'lib/repositories/AuthAccountRepository.ts',
    'lib/repositories/__tests__/AuthAccountRepository.test.ts',
    'lib/repositories/__tests__/authAccountRepository.callers.guard.test.ts',
    // The migration, its rollback, its read-only checker and its text test.
    'supabase/migrations/20261013_business_os_invite_existing_account.sql',
    'supabase/SQL Scripts/20261013_business_os_invite_existing_account_rollback.sql',
    'scripts/check-bos-invite-existing-account-migration.sql',
    'supabase/migrations/__tests__/business-os-invite-existing-account.migration.test.ts',
    // The SECURITY DEFINER surface guard names it in its frozen baseline
    // (20261013 revokes in three statements; SECDEF lockdown slice 6, SA Q-2).
    'supabase/__tests__/security-definer-surface.guard.test.ts',
  ].map((file) => file.split('/').join(sep))
);

function walkWithSql(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    if (SKIP.has(name)) return [];
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walkWithSql(full);
    return /\.(ts|tsx|js|mjs|sql)$/.test(name) ? [full] : [];
  });
}

const FUNCTION_FILES = [
  ...FUNCTION_SCANNED_DIRS.flatMap((dir) => walkWithSql(join(ROOT, dir))),
  ...rootFiles(/\.(ts|tsx|js|mjs|sql)$/),
];

describe('AuthAccountRepository callers (R-4)', () => {
  it('the scan actually ran', () => {
    expect(FILES.length).toBeGreaterThan(100);
    expect(FILES.map((file) => relative(ROOT, file))).toContain(join('lib', 'repositories', 'AuthAccountRepository.ts'));
  });

  it('only the allow-listed files name it', () => {
    const offenders = FILES.map((file) => relative(ROOT, file))
      .filter((file) => !ALLOWED.has(file))
      .filter((file) => SYMBOLS.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('every allow-listed file exists (a stale entry would silently cover a future file at the same path)', () => {
    const present = new Set(FILES.map((file) => relative(ROOT, file)));
    for (const file of ALLOWED) expect({ file, present: present.has(file) }).toEqual({ file, present: true });
  });

  it('CR-2: the SQL function name appears only in the repository, its test, this guard and the migration files', () => {
    const relFiles = FUNCTION_FILES.map((file) => relative(ROOT, file));
    // The scan reached SQL files, not just code.
    expect(relFiles).toContain(join('supabase', 'migrations', '20261013_business_os_invite_existing_account.sql'));
    const offenders = relFiles
      .filter((file) => !FUNCTION_ALLOWED.has(file))
      .filter((file) => FUNCTION_NAME.test(readFileSync(join(ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('CR-2: every function allow-list entry exists', () => {
    const present = new Set(FUNCTION_FILES.map((file) => relative(ROOT, file)));
    for (const file of FUNCTION_ALLOWED) expect({ file, present: present.has(file) }).toEqual({ file, present: true });
  });

  it('CR-2 negative control: a direct rpc call by name would be caught', () => {
    expect(FUNCTION_NAME.test("await supabase.rpc('business_os_auth_email_has_account', { p_email })")).toBe(true);
  });

  it('QA-2: root-level deployed files are scanned too (middleware.ts included)', () => {
    expect(FILES.map((file) => relative(ROOT, file))).toContain('middleware.ts');
    expect(FUNCTION_FILES.map((file) => relative(ROOT, file))).toContain('middleware.ts');
  });

  it('is not exported from the repositories barrel', () => {
    const barrel = readFileSync(join(ROOT, 'lib', 'repositories', 'index.ts'), 'utf8');
    expect(barrel).not.toMatch(SYMBOLS);
    expect(barrel).not.toContain('AuthAccountRepository');
  });
});

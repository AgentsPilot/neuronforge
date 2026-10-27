/**
 * Who may reach the deletion lifecycle storage and the login lock (DL-1a,
 * workplan §5.2, §5.3, T-5; SA W-10, modelled on the invite-flow auth
 * account callers guard and its SA CR-2).
 *
 * `AccountClosureRepository` writes deletion requests for any account id it is
 * given, and `AccountLockRepository` bans and unbans logins and ends their
 * sessions on a service-role path. Both check the closure state themselves,
 * but a new caller must still be argued for here, in a diff.
 *
 * ALLOW-LIST, not a deny-list. DL-1a has no production caller: only the two
 * repositories (the lock seam reads closures through the closure repository),
 * their tests and this guard. DL-1b adds the request routes, DL-3 the lifecycle
 * job, DL-4 the lock wiring and the admin Unlock route.
 *
 * CR-2: naming the class is not the only way in. A file could call either SQL
 * function by name, query the table with `.from('business_os_account_closures')`,
 * or set `ban_duration` through the auth admin API itself. So those strings
 * are scanned too, across the code directories AND `supabase/`, in
 * `.ts`/`.tsx`/`.js`/`.mjs`/`.sql` files. `updateUserById` alone is NOT scanned:
 * `lib/utils/onboarding-check.ts` calls it without a ban.
 *
 * Neither repository is exported from the `lib/repositories` barrel: an import
 * through the barrel would name only `@/lib/repositories`, and this guard could
 * no longer see who uses it.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.next', '.git']);
const SCANNED_DIRS = ['app', 'lib', 'components', 'hooks', 'scripts', 'supabase'];

const SELF = 'lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts';
const CLOSURE_REPOSITORY = 'lib/repositories/AccountClosureRepository.ts';
const LOCK_REPOSITORY = 'lib/repositories/AccountLockRepository.ts';
const CLOSURE_TEST = 'lib/repositories/__tests__/AccountClosureRepository.test.ts';
const LOCK_TEST = 'lib/repositories/__tests__/AccountLockRepository.test.ts';
const MIGRATION = 'supabase/migrations/20261093_business_os_account_closures.sql';
const ROLLBACK = 'supabase/SQL Scripts/20261093_business_os_account_closures_rollback.sql';
const MIGRATION_TEST = 'supabase/migrations/__tests__/business-os-account-closures.migration.test.ts';
const PRECHECK = 'scripts/precheck-account-closures.sql';
const CHECKER = 'scripts/check-account-closures-migration.sql';

interface Rule {
  name: string;
  pattern: RegExp;
  allowed: ReadonlyArray<string>;
}

/** Each rule: what may not appear, and the only files where it may. */
const RULES: ReadonlyArray<Rule> = [
  {
    name: 'AccountClosureRepository',
    pattern: /\bAccountClosureRepository\b/,
    // The lock seam reads the closure state through it (W-4).
    allowed: [CLOSURE_REPOSITORY, LOCK_REPOSITORY, CLOSURE_TEST, LOCK_TEST, SELF],
  },
  {
    name: 'AccountLockRepository',
    pattern: /\bAccountLockRepository\b/,
    allowed: [LOCK_REPOSITORY, LOCK_TEST, SELF],
  },
  {
    name: 'the claim function name',
    pattern: /business_os_account_closures_claim_due/,
    allowed: [CLOSURE_REPOSITORY, CLOSURE_TEST, SELF, MIGRATION, ROLLBACK, MIGRATION_TEST, PRECHECK, CHECKER],
  },
  {
    name: 'the session cut function name',
    pattern: /business_os_account_closure_cut_sessions/,
    allowed: [LOCK_REPOSITORY, LOCK_TEST, SELF, MIGRATION, ROLLBACK, MIGRATION_TEST, PRECHECK, CHECKER],
  },
  {
    name: ".from('business_os_account_closures')",
    pattern: /\.from\(\s*['"`]business_os_account_closures['"`]\s*\)/,
    allowed: [CLOSURE_REPOSITORY, SELF],
  },
  {
    name: 'ban_duration',
    pattern: /\bban_duration\b/,
    allowed: [LOCK_REPOSITORY, LOCK_TEST, SELF],
  },
];

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
    return /\.(ts|tsx|js|mjs|sql)$/.test(name) ? [full] : [];
  });
}

/** Deployed code also lives at the repo root (middleware.ts, the config files). One level only. */
function rootFiles(): string[] {
  return readdirSync(ROOT)
    .filter((name) => /\.(ts|tsx|js|mjs|sql)$/.test(name))
    .map((name) => join(ROOT, name))
    .filter((full) => statSync(full).isFile());
}

const toPosix = (file: string) => file.split(sep).join('/');
const FILES = [...SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir))), ...rootFiles()].map((file) => toPosix(relative(ROOT, file)));
const SOURCE = new Map(FILES.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')]));

/** Every file holding the rule's pattern that is not on its allow-list. */
export function offendersOf(rule: Rule, files: ReadonlyMap<string, string>): string[] {
  const allowed = new Set(rule.allowed);
  return [...files.entries()].filter(([file, code]) => !allowed.has(file) && rule.pattern.test(code)).map(([file]) => file);
}

describe('deletion lifecycle storage and the login lock: who may name them (DL-1a, SA W-10)', () => {
  it('the scan actually ran over code and SQL', () => {
    expect(FILES.length).toBeGreaterThan(500);
    expect(FILES).toContain(CLOSURE_REPOSITORY);
    expect(FILES).toContain(MIGRATION);
    expect(FILES).toContain(ROLLBACK);
    expect(FILES).toContain('middleware.ts');
  });

  it.each(RULES.map((rule) => [rule.name, rule] as const))('%s appears only in its allow-listed files', (_name, rule) => {
    expect(offendersOf(rule, SOURCE)).toEqual([]);
  });

  it.each(RULES.map((rule) => [rule.name, rule] as const))('every %s allow-list entry exists (no stale exemption)', (_name, rule) => {
    for (const file of rule.allowed) expect({ file, present: SOURCE.has(file) }).toEqual({ file, present: true });
  });

  it.each([
    ['a route importing the closure repository', "import { AccountClosureRepository } from '@/lib/repositories/AccountClosureRepository';", 0],
    ['a route importing the lock seam', "import { AccountLockRepository } from '@/lib/repositories/AccountLockRepository';", 1],
    ['a direct claim rpc', "await supabase.rpc('business_os_account_closures_claim_due', { p_runner })", 2],
    ['a direct session cut rpc', 'await supabase.rpc("business_os_account_closure_cut_sessions", { p_user_id })', 3],
    ['a direct table query', "await supabase.from('business_os_account_closures').select('id')", 4],
    ['a direct ban', "await supabase.auth.admin.updateUserById(id, { ban_duration: '87600h' })", 5],
  ])('negative fixture: %s in a synthetic app/api/foo/route.ts is caught', (_name, line, ruleIndex) => {
    const fake = new Map([['app/api/foo/route.ts', line]]);
    expect(offendersOf(RULES[ruleIndex], fake)).toEqual(['app/api/foo/route.ts']);
  });

  it('neither repository is exported from the barrel', () => {
    const barrel = readFileSync(join(ROOT, 'lib', 'repositories', 'index.ts'), 'utf8');
    expect(barrel).not.toMatch(/AccountClosureRepository|AccountLockRepository/);
  });
});

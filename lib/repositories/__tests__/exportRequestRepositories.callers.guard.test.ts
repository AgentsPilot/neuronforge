/**
 * Who may reach the module export storage (MX-1a, workplan §6 T-5; the
 * accountClosureRepositories.callers.guard.test.ts shape, SA W-10 / CR-2).
 *
 * `BusinessOsExportRequestRepository` starts an export for any account id it
 * is given, and `BusinessOsExportModuleJobRepository` claims and reaps jobs of
 * every account on a service-role path. The database holds the limits, but a
 * new caller must still be argued for here, in a diff.
 *
 * ALLOW-LIST, not a deny-list. MX-1a had no production caller: only the two
 * repositories, their tests and this guard. MX-1b added the owner route
 * (`app/api/business-os/export-requests/route.ts`, session user only) and its
 * test, to the two class rules only (it names no table and no SQL function).
 * MX-3b added the data export worker's production wiring
 * (`lib/business-os/data-export/moduleExportWorkerDeps.ts`, service role, every
 * effect keyed on the claimed row's user_id), to the two class rules only. The
 * worker itself (`moduleExportWorker.ts`) and its tests take the store as an
 * injected port and name neither class. MX-4 adds the receipt facts and MX-5
 * the admin route, each in its own diff here.
 *
 * Naming the class is not the only way in. A file could call one of the three
 * SQL functions by name, or query a table with `.from(...)`. So those strings
 * are scanned too, across the code directories AND `supabase/` and `scripts/`,
 * in `.ts`/`.tsx`/`.js`/`.mjs`/`.sql` files.
 *
 * Neither repository is exported from the `lib/repositories` barrel: an import
 * through the barrel would name only `@/lib/repositories`, and this guard
 * could no longer see who uses it.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const ROOT = process.cwd();
const SKIP = new Set(['node_modules', '.next', '.git']);
const SCANNED_DIRS = ['app', 'lib', 'components', 'hooks', 'scripts', 'supabase'];

const SELF = 'lib/repositories/__tests__/exportRequestRepositories.callers.guard.test.ts';
const REQUEST_REPOSITORY = 'lib/repositories/BusinessOsExportRequestRepository.ts';
const JOB_REPOSITORY = 'lib/repositories/BusinessOsExportModuleJobRepository.ts';
const REQUEST_TEST = 'lib/repositories/__tests__/BusinessOsExportRequestRepository.test.ts';
const JOB_TEST = 'lib/repositories/__tests__/BusinessOsExportModuleJobRepository.test.ts';
const MIGRATION = 'supabase/migrations/20261095_business_os_export_requests.sql';
const ROLLBACK = 'supabase/SQL Scripts/20261095_business_os_export_requests_rollback.sql';
const MIGRATION_TEST = 'supabase/migrations/__tests__/business-os-export-requests.migration.test.ts';
const PRECHECK = 'scripts/precheck-export-requests.sql';
const CHECKER = 'scripts/check-export-requests-migration.sql';
/** MX-1b: the owner route (POST start, GET history) and its integration test. Class rules only. */
const OWNER_ROUTE = 'app/api/business-os/export-requests/route.ts';
const OWNER_ROUTE_TEST = 'app/api/business-os/export-requests/__tests__/route.test.ts';
/** QA 2026-10-27 (MX-1b): the route + browser-seam round-trip test. It mocks the two repositories, as route.test.ts does. Class rules only. */
const OWNER_ROUTE_QA_TEST = 'app/api/business-os/export-requests/__tests__/route.qa.test.ts';
/** MX-3b: the data export worker's production wiring (cron `/api/cron/data-export-modules`). Class rules only. */
const WORKER_DEPS = 'lib/business-os/data-export/moduleExportWorkerDeps.ts';

/** The SQL files of 20261095 that name every function. */
const SQL_FILES = [MIGRATION, ROLLBACK, MIGRATION_TEST, PRECHECK, CHECKER];

interface Rule {
  name: string;
  pattern: RegExp;
  allowed: ReadonlyArray<string>;
}

/** Each rule: what may not appear, and the only files where it may. */
const RULES: ReadonlyArray<Rule> = [
  {
    name: 'BusinessOsExportRequestRepository',
    pattern: /\bBusinessOsExportRequestRepository\b/,
    allowed: [REQUEST_REPOSITORY, REQUEST_TEST, SELF, OWNER_ROUTE, OWNER_ROUTE_TEST, OWNER_ROUTE_QA_TEST, WORKER_DEPS],
  },
  {
    name: 'BusinessOsExportModuleJobRepository',
    pattern: /\bBusinessOsExportModuleJobRepository\b/,
    allowed: [JOB_REPOSITORY, JOB_TEST, SELF, OWNER_ROUTE, OWNER_ROUTE_TEST, OWNER_ROUTE_QA_TEST, WORKER_DEPS],
  },
  {
    name: 'the start function name',
    pattern: /business_os_export_request_start/,
    allowed: [REQUEST_REPOSITORY, REQUEST_TEST, SELF, ...SQL_FILES],
  },
  {
    name: 'the claim function name',
    pattern: /business_os_export_module_jobs_claim_due/,
    allowed: [JOB_REPOSITORY, JOB_TEST, SELF, ...SQL_FILES],
  },
  {
    name: 'the reap function name',
    pattern: /business_os_export_module_jobs_reap/,
    allowed: [JOB_REPOSITORY, JOB_TEST, SELF, ...SQL_FILES],
  },
  {
    name: ".from('business_os_export_requests')",
    pattern: /\.from\(\s*['"`]business_os_export_requests['"`]\s*\)/,
    allowed: [REQUEST_REPOSITORY, REQUEST_TEST, SELF],
  },
  {
    name: ".from('business_os_export_module_jobs')",
    pattern: /\.from\(\s*['"`]business_os_export_module_jobs['"`]\s*\)/,
    allowed: [JOB_REPOSITORY, JOB_TEST, SELF],
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

describe('module export storage: who may name it (MX-1a T-5)', () => {
  it('the scan actually ran over code and SQL', () => {
    expect(FILES.length).toBeGreaterThan(500);
    expect(FILES).toContain(REQUEST_REPOSITORY);
    expect(FILES).toContain(JOB_REPOSITORY);
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
    ['a route importing the request repository', "import { BusinessOsExportRequestRepository } from '@/lib/repositories/BusinessOsExportRequestRepository';", 0],
    ['a route importing the job repository', "import { BusinessOsExportModuleJobRepository } from '@/lib/repositories/BusinessOsExportModuleJobRepository';", 1],
    ['a direct start rpc', "await supabase.rpc('business_os_export_request_start', { p_user_id })", 2],
    ['a direct claim rpc', 'await supabase.rpc("business_os_export_module_jobs_claim_due", { p_runner })', 3],
    ['a direct reap rpc', 'await supabase.rpc(`business_os_export_module_jobs_reap`)', 4],
    ['a direct request table query', "await supabase.from('business_os_export_requests').insert(row)", 5],
    ['a direct job table query', "await supabase.from( 'business_os_export_module_jobs' ).select('id')", 6],
  ])('negative fixture: %s in a synthetic app/api/foo/route.ts is caught', (_name, line, ruleIndex) => {
    const fake = new Map([['app/api/foo/route.ts', line]]);
    expect(offendersOf(RULES[ruleIndex], fake)).toEqual(['app/api/foo/route.ts']);
  });

  it('neither repository is exported from the barrel', () => {
    const barrel = readFileSync(join(ROOT, 'lib', 'repositories', 'index.ts'), 'utf8');
    expect(barrel).not.toMatch(/BusinessOsExportRequestRepository|BusinessOsExportModuleJobRepository/);
  });

  it('neither repository offers an insert: only the start function creates rows (D-4)', () => {
    for (const file of [REQUEST_REPOSITORY, JOB_REPOSITORY]) expect([file, /\.insert\(|\.upsert\(/.test(SOURCE.get(file) ?? '')]).toEqual([file, false]);
  });
});

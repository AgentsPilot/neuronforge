/**
 * QA A-2 — the account seam has to be *used*, not just exist.
 *
 * R4-2 made `shadow.ts` resolve its id through `resolveAccountId`, and nothing
 * would have caught it going back: `AccountId` is `string`, so passing a raw
 * `userId` type-checks everywhere. The seam exists so that the day an account
 * stops being a user (T-2), one function changes rather than every call site —
 * which only works if every call site actually goes through it.
 *
 * So this is a source-level guard, in the same spirit as the RC-15 import guard:
 * a module that takes a user id from outside the module must name
 * `resolveAccountId`, or be on a list that says why it does not.
 *
 * ── SA P-1 (2026-09-27): the same finding came back, so the guard was wrong ─
 * The customer "Your plan" route called `getSnapshot(user.id)` directly. R4-2
 * had already been found and fixed in `shadow.ts`, and this guard was written to
 * stop it recurring — and did not, because **it only ever scanned files inside
 * `lib/business-os/entitlements/`.** A consumer in `app/` was invisible to it.
 *
 * That is the shape of a missing mechanism rather than a missing edit: the first
 * version protected the module from itself and left every external caller — the
 * ones that actually hold a `user.id` — unguarded. The second `describe` block
 * below closes it: **anywhere in the product**, a file that reaches the
 * entitlement service must resolve through the seam, and must never hand a raw
 * user id to `getSnapshot` / `getSnapshots` / `check`.
 *
 * It matters most on customer-facing reads, where the symptom of getting it
 * wrong is a user shown another account's plan.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const MODULE_DIR = join(process.cwd(), 'lib', 'business-os', 'entitlements');

/**
 * Files that receive an id from OUTSIDE the module and must convert it.
 *
 * Adding an entry point (a new hook, a new service method taking a user id)
 * means adding it here — which is the moment someone states how the id is
 * resolved.
 */
const ENTRY_POINTS = ['shadow.ts'];

/**
 * Files that mention a user id but must NOT call the seam, with the reason.
 *
 * `account.ts` defines it. `report.ts` and `EntitlementService.ts` work in
 * account ids already — they are handed ids that came from a plan row or from
 * a caller that resolved one, and re-resolving would imply the value was a user
 * id when it is not.
 */
const EXEMPT: Record<string, string> = {
  'account.ts': 'defines resolveAccountId',
  'report.ts': 'reads plan rows, which are keyed by account id already',
  'EntitlementService.ts': 'its parameter IS an AccountId; the caller resolves',
  // It works in account ids throughout (`ctx.accountId`, resolved by the route).
  // The `userId` the guard sees is the REPOSITORY's input field name — the
  // column is `user_id` — not a user id arriving from outside.
  'adminOps.ts': 'works in account ids; `userId` is the repository input field name',
};

function read(file: string): string {
  return readFileSync(join(MODULE_DIR, file), 'utf8');
}

describe('the account seam is used, not just exported', () => {
  it.each(ENTRY_POINTS)('%s resolves the id through resolveAccountId', (file) => {
    const source = read(file);

    expect(source).toMatch(/resolveAccountId\s*\(/);
    // …and the raw id does not go on to the service or into a recorded row.
    expect(source).not.toMatch(/getSnapshot\(\s*input\.userId/);
    expect(source).not.toMatch(/user_id:\s*input\.userId/);
  });

  it('every module file that handles a user id is classified', () => {
    // The guard on the guard: a NEW file taking a `userId` from outside must
    // either call the seam or say in EXEMPT why it does not. Without this, the
    // next consumer is exactly the one nobody notices.
    const files = readdirSync(MODULE_DIR).filter((name) => name.endsWith('.ts'));

    const unclassified = files.filter((file) => {
      if (ENTRY_POINTS.includes(file) || file in EXEMPT) return false;
      const source = read(file);
      // `userId` as a property or parameter — not a comment mentioning it.
      return /\buserId\s*[:,)]/.test(source);
    });

    expect(unclassified).toEqual([]);
  });

  it('scans a plausible number of files, so the sweep above is real', () => {
    expect(readdirSync(MODULE_DIR).filter((name) => name.endsWith('.ts')).length).toBeGreaterThan(8);
  });

  it('the exempt list names files that exist and really are exempt', () => {
    for (const [file, reason] of Object.entries(EXEMPT)) {
      expect(() => read(file)).not.toThrow();
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});

/**
 * The same rule, for every caller in the product (SA P-1).
 *
 * Keyed on importing the entitlement service rather than on the text
 * `getSnapshot(`, because three unrelated things in this codebase are called
 * that or `check`: a private helper in `lib/business-os/llm/modelSettings.ts`, a
 * marketing-consent gate in `lib/notifications/emailTransport.ts`, and a
 * capability checker in `CapabilityBinderV2`. A guard that shouted about those
 * would be switched off within a week.
 */
describe('the account seam is used by every caller, not only inside the module', () => {
  const SCANNED = ['app', 'lib', 'components', 'hooks'];

  /** Imports the entitlement service — i.e. can reach an account snapshot. */
  const SERVICE_IMPORT = /from\s+['"][^'"]*business-os\/entitlements(\/EntitlementService|\/index)?['"]/;
  const SERVICE_SYMBOL = /\b(getEntitlementService|EntitlementService)\b/;

  /** The calls that take an account id. */
  const ACCOUNT_CALLS = /\.(getSnapshot|getSnapshots|check)\s*\(/;

  /**
   * Callers that legitimately do not name the seam, with the reason.
   *
   * Empty on purpose right now: both external callers resolve. An entry here is
   * somebody stating, in a reviewable diff, that their id did not come from a
   * user — which is the only honest reason to skip it.
   */
  const EXTERNAL_EXEMPT: Record<string, string> = {};

  function walk(dir: string, out: string[] = []): string[] {
    let entries: string[];
    try {
      entries = readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name);
    } catch {
      return out;
    }

    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.next' || entry === '.claude') continue;
      const full = join(dir, entry);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) walk(full, out);
      else if (/\.tsx?$/.test(entry)) out.push(full);
    }
    return out;
  }

  const projectFiles = SCANNED.flatMap((dir) => walk(join(process.cwd(), dir)))
    .map((full) => relative(process.cwd(), full).split(sep).join('/'))
    // Tests describe the calls; they do not make them on a user's behalf. The
    // module's own files are covered by the first describe block above.
    .filter((file) => !/__tests__|\.test\.tsx?$/.test(file))
    .filter((file) => !file.startsWith('lib/business-os/entitlements/'));

  const callers = projectFiles.filter((file) => {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    return SERVICE_IMPORT.test(source) && SERVICE_SYMBOL.test(source) && ACCOUNT_CALLS.test(source);
  });

  it('finds the callers at all — otherwise everything below passes vacuously', () => {
    // Two today: the admin account inspector and the customer plan read. A scan
    // returning none means the regexes stopped matching, not that the product
    // stopped asking.
    expect(projectFiles.length).toBeGreaterThan(500);
    expect(callers.length).toBeGreaterThanOrEqual(2);
    expect(callers).toContain('app/api/business-os/entitlements/my-plan/route.ts');
  });

  it('every caller resolves through the seam, or says why it does not', () => {
    const unresolved = callers.filter((file) => {
      if (file in EXTERNAL_EXEMPT) return false;
      return !/resolveAccountId\s*\(/.test(readFileSync(join(process.cwd(), file), 'utf8'));
    });

    // If this fails: call `resolveAccountId` on the id before you pass it, or add
    // an EXTERNAL_EXEMPT entry saying where the id came from instead. `AccountId`
    // is `string`, so nothing else will tell you.
    expect(unresolved).toEqual([]);
  });

  it('no caller hands a RAW user id to the service', () => {
    // The direct form of the defect, and the one an exemption must not be able
    // to wave through: a file can call `resolveAccountId` somewhere else and
    // still pass `user.id` here. This is what actually shipped on the customer
    // route before P-1.
    const raw = /\.(getSnapshot|getSnapshots|check)\s*\(\s*(user\.id|userId|user_id|session\.user\.id)\b/;

    const offenders = callers.filter((file) => raw.test(readFileSync(join(process.cwd(), file), 'utf8')));

    expect(offenders).toEqual([]);
  });

  it('the raw-id rule really rejects the shape it is named after', () => {
    // A negative control, because the two assertions above pass on a codebase
    // where the regex matches nothing at all.
    const raw = /\.(getSnapshot|getSnapshots|check)\s*\(\s*(user\.id|userId|user_id|session\.user\.id)\b/;

    expect(raw.test('await getEntitlementService().getSnapshot(user.id);')).toBe(true);
    expect(raw.test('await service.check(userId, capability);')).toBe(true);
    // And accepts the fixed form.
    expect(raw.test('await getEntitlementService().getSnapshot(accountId);')).toBe(false);
  });

  it('every EXTERNAL_EXEMPT entry names a real file and gives a reason', () => {
    for (const [file, reason] of Object.entries(EXTERNAL_EXEMPT)) {
      expect(projectFiles).toContain(file);
      expect(reason.length).toBeGreaterThan(10);
    }
  });
});

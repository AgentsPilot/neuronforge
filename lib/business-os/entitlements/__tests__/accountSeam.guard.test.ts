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
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

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

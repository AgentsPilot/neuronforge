/**
 * The P2 merge gate for lead-reply retry (ADMIN_BOS_CLEANUP slice 7c; SA code
 * review CR7C-3, closes QA-1; W7C-1, Q-SA7C-1, BL-7a).
 *
 * WHAT IT GUARDS. Slice 7c lets an admin retry a failed lead reply. On that
 * queue a retry can re-arm a row whose runner is still alive, because
 * `PATCH /api/business-os/leads/[id]` drained fire-and-forget with no
 * `maxDuration`: its runner is not provably dead when the 90 s lease expires,
 * so the cron and the frozen runner could both send the same reply. P2
 * (BL-7a part 2, `fix/lead-route-awaited-drain`) closes that by giving the
 * route `export const maxDuration = 60` and an awaited drain.
 *
 * THE RULE. If `LEAD_RETRY_HELD` (lib/admin/jobs/retryHolds.ts) ships `false`,
 * lead-reply retry is offered, so the lead route MUST already be the P2 shape:
 *   - it exports `maxDuration = 60`, and
 *   - every call of `dispatchLeadResponses(` is awaited (at least one exists).
 * If the hold is `true`, lead-reply retry is refused everywhere and the rule
 * does not apply.
 *
 * EXPECTED RED when it was written. Slice 7c was built before P2, so on the
 * 7c branch alone the gate fails, by design: it is what makes the required CI
 * Jest checks block a merge of 7c ahead of P2. It turns green in one of two
 * ways, and only these:
 *   1. P2 merges to `main` and 7c is rebased on it (the intended path); or
 *   2. the hold is flipped to `true` per the procedure in the header of
 *      `lib/admin/jobs/retryHolds.ts` (CR7C-4), with SA's re-check.
 * Never "fix" it by editing the lead route from this slice, by loosening the
 * patterns below, or by skipping the test.
 *
 * Both files are READ with `fs`, never imported: importing the route would
 * load the lead service into an admin test (S-9), and the hold's value must
 * be the shipped source, not a Jest mock. Comments are stripped first, so a
 * comment that mentions `await dispatchLeadResponses(` or `= true` cannot
 * satisfy the gate.
 */

import * as fs from 'fs';
import * as path from 'path';

const HOLDS_FILE = 'lib/admin/jobs/retryHolds.ts';
const LEAD_ROUTE_FILE = 'app/api/business-os/leads/[id]/route.ts';

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** The shipped hold value. Throws when the one-line shape is not found (fail closed). */
function readLeadRetryHeld(source: string): boolean {
  const match = stripComments(source).match(/^export const LEAD_RETRY_HELD = (false|true) as boolean;\s*$/m);
  if (!match) throw new Error(`${HOLDS_FILE}: the LEAD_RETRY_HELD line was not found in its pinned shape`);
  return match[1] === 'true';
}

/** Why the lead route is not yet the P2 shape; empty when it is. */
function leadRouteP2Problems(source: string): string[] {
  const code = stripComments(source);
  const problems: string[] = [];
  if (!/^export const maxDuration\s*=\s*60\s*;?\s*$/m.test(code)) {
    problems.push('lead route does not export maxDuration = 60');
  }
  const calls = [...code.matchAll(/\bdispatchLeadResponses\s*\(/g)];
  if (calls.length === 0) {
    problems.push('lead route never calls dispatchLeadResponses(');
  }
  const unawaited = calls.filter((m) => !/\bawait\s+$/.test(code.slice(0, m.index)));
  if (unawaited.length > 0) {
    problems.push(`lead route has ${unawaited.length} un-awaited dispatchLeadResponses( call(s)`);
  }
  return problems;
}

const read = (file: string): string => fs.readFileSync(path.join(process.cwd(), file), 'utf8');

describe('lead-reply retry P2 gate: the matchers themselves', () => {
  const p2Route = [
    "import { dispatchLeadResponses } from './dispatch';", // the import line is not a call
    'export const maxDuration = 60;',
    'export async function PATCH() {',
    '  await dispatchLeadResponses({ limit: 5 });',
    '}',
  ].join('\n');

  it('accepts the P2 shape', () => {
    expect(leadRouteP2Problems(p2Route)).toEqual([]);
  });

  it('rejects the pre-P2 fire-and-forget drain with no maxDuration', () => {
    const prePatch = [
      "import { dispatchLeadResponses } from './dispatch';", // the import line is not a call
      'export async function PATCH() {',
      '  dispatchLeadResponses().catch(err => log(err));',
      '}',
    ].join('\n');
    expect(leadRouteP2Problems(prePatch)).toEqual([
      'lead route does not export maxDuration = 60',
      'lead route has 1 un-awaited dispatchLeadResponses( call(s)',
    ]);
  });

  it('rejects an awaited call next to a second, un-awaited one', () => {
    const mixed = `${p2Route}\nexport function other() { dispatchLeadResponses().catch(() => undefined); }`;
    expect(leadRouteP2Problems(mixed)).toEqual(['lead route has 1 un-awaited dispatchLeadResponses( call(s)']);
  });

  it('rejects a different maxDuration, and a route with no call at all', () => {
    expect(leadRouteP2Problems(p2Route.replace('= 60', '= 300'))).toContain('lead route does not export maxDuration = 60');
    expect(leadRouteP2Problems('export const maxDuration = 60;')).toEqual(['lead route never calls dispatchLeadResponses(']);
  });

  it('is not satisfied by comments', () => {
    const commented = [
      '// export const maxDuration = 60;',
      '/* await dispatchLeadResponses() */',
      'export async function PATCH() {',
      '  dispatchLeadResponses().catch(() => undefined);',
      '}',
    ].join('\n');
    expect(leadRouteP2Problems(commented)).toHaveLength(2);
  });

  it('reads the hold from code only, and fails closed on any other shape', () => {
    expect(readLeadRetryHeld('export const LEAD_RETRY_HELD = false as boolean;')).toBe(false);
    expect(readLeadRetryHeld('export const LEAD_RETRY_HELD = true as boolean;')).toBe(true);
    expect(readLeadRetryHeld('/** set LEAD_RETRY_HELD = true as boolean; */\nexport const LEAD_RETRY_HELD = false as boolean;')).toBe(false);
    expect(() => readLeadRetryHeld('export const LEAD_RETRY_HELD = process.env.X === "1";')).toThrow();
    expect(() => readLeadRetryHeld('// export const LEAD_RETRY_HELD = true as boolean;')).toThrow();
  });
});

describe('lead-reply retry P2 gate (RED until P2 merges, or the hold is flipped)', () => {
  it('LEAD_RETRY_HELD false requires the lead route to export maxDuration = 60 and await every dispatchLeadResponses( call', () => {
    if (readLeadRetryHeld(read(HOLDS_FILE))) return; // held: lead-reply retry is refused everywhere
    expect(leadRouteP2Problems(read(LEAD_ROUTE_FILE))).toEqual([]);
  });
});

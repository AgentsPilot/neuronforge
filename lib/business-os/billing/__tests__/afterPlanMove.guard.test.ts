/**
 * Source guard for the after-plan move (account-deletion lifecycle D3.1 /
 * SX-2b; workplan §10; SA DR-8, tenant-isolation-guard).
 *
 *   - the use case reads no Stripe `metadata`: the account id is our billing row's;
 *   - neither file names a cohort id or a tier name: the cohort is `AFTER_PLAN.cohort`;
 *   - the admin-shaped `.updatePlan(` is never used for this system write;
 *   - `applyAfterPlanMove` is called from the wiring only (the RC-15 guard pins it too);
 *   - the use case names no repository (ports only).
 *
 *   - T-8 (DR-8): the mirror calls the port once, and passes no Stripe
 *     `metadata` field into its input; the account id is our billing row's.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

import { COHORT_IDS } from '@/lib/business-os/entitlements/config/cohorts';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');
/** The code without comments, so a word in a comment never passes or fails a check. */
const code = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const USE_CASE = read('lib', 'business-os', 'billing', 'afterPlanMove.ts');
const WIRING = read('lib', 'business-os', 'billing', 'afterPlanMoveDeps.ts');
const MIRROR = read('lib', 'business-os', 'billing', 'planSubscriptionMirror.ts');

/** The text of every `deps.afterPlanMove(...)` call in the mirror, parentheses balanced. */
function portCalls(source: string): string[] {
  const calls: string[] = [];
  const pattern = /deps\.afterPlanMove\s*\(/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < source.length; end++) {
      if (source[end] === '(') depth++;
      else if (source[end] === ')' && --depth === 0) break;
    }
    calls.push(source.slice(match.index, end + 1));
  }
  return calls;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.claude') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('afterPlanMove source', () => {
  it('reads no Stripe metadata', () => {
    expect(code(USE_CASE)).not.toMatch(/metadata/i);
    expect(code(WIRING)).not.toMatch(/metadata/i);
  });

  it.each([
    ['afterPlanMove.ts', USE_CASE],
    ['afterPlanMoveDeps.ts', WIRING],
  ])('%s names no cohort id and no tier name', (_file, source) => {
    for (const id of [...COHORT_IDS, ...TIER_ORDER]) {
      expect(code(source)).not.toMatch(new RegExp(`['"\`]${id}['"\`]`));
    }
  });

  it('never uses the admin-shaped updatePlan for this system write', () => {
    expect(USE_CASE).not.toMatch(/\.updatePlan\s*\(/);
    expect(WIRING).not.toMatch(/\.updatePlan\s*\(/);
  });

  it('the use case names no repository: ports only', () => {
    expect(code(USE_CASE)).not.toMatch(/lib\/repositories|Repository\b/);
  });

  it('applyAfterPlanMove is called from the wiring only', () => {
    const callers = ['app', 'lib', 'components', 'hooks', 'scripts']
      .flatMap((dir) => walk(join(ROOT, dir)))
      .filter((file) => !file.includes(`${sep}__tests__${sep}`))
      .filter((file) => /\.applyAfterPlanMove\s*\(/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(ROOT, file).split(sep).join('/'));
    expect(callers).toEqual(['lib/business-os/billing/afterPlanMoveDeps.ts']);
  });

  it('the production port is exported for the mirror (T-8 is one wiring line)', () => {
    expect(WIRING).toMatch(/export const afterPlanMove: AfterPlanMovePort\b/);
  });
});

describe('the mirror seam (T-8; SA DR-8)', () => {
  const calls = portCalls(code(MIRROR));

  it('the mirror calls the port exactly once', () => {
    expect(calls).toHaveLength(1);
  });

  it('passes no Stripe metadata into the port input', () => {
    expect(calls[0]).not.toMatch(/metadata/i);
    expect(calls[0]).not.toMatch(/BOS_USER_ID_METADATA_KEY|\bclaim\b|\bfresh\b/);
  });

  it('the account id is our billing row\'s', () => {
    expect(calls[0]).toMatch(/accountId:\s*resolveAccountId\(\s*account\.accountId\b/);
  });

  it('the call sits after recordSubscriptionEnded, inside the .deleted && mirrored branch', () => {
    const mirrorCode = code(MIRROR).replace(/\r\n/g, '\n');
    const branch = mirrorCode.indexOf("if (event.type === 'customer.subscription.deleted' && mirrored.data.mirrored)");
    const ended = mirrorCode.indexOf('await recordSubscriptionEnded(', branch);
    const call = mirrorCode.indexOf('deps.afterPlanMove(', branch);
    expect(branch).toBeGreaterThan(-1);
    expect(ended).toBeGreaterThan(branch);
    expect(call).toBeGreaterThan(ended);
    // Still inside that block: no closing of the branch between the two.
    expect(mirrorCode.slice(ended, call)).not.toMatch(/\n  \}\n/);
  });
});

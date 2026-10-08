/**
 * The lease invariant for the five Business OS queue drains (BL-7a part 2,
 * P2; SA ruling on OP-2, L-6).
 *
 * WHAT IT GUARDS. Each queue's reaper returns or dead-letters a claimed row
 * once its 90 s lease expires. That is only safe if the runner holding the row
 * is provably dead by then, which is true only where the platform kills it:
 * inside an awaited call in a route with `maxDuration = 60`. A drain fired and
 * forgotten (the lead route before P2, B7-11) can outlive its response, and an
 * admin retry of the row it still holds then sends twice.
 *
 * THE RULE.
 *   1. The runtime callers of `processDueReminders`, `processScheduledExecutions`,
 *      `processDueBriefings`, `dispatchLeadResponses` and `drainInsightActions`
 *      under `app/` and `lib/` are exactly the five cron routes, `runQueueDrain.ts`
 *      and the lead route.
 *   2. Every ROUTE among them exports `maxDuration = 60` and awaits every call.
 *   3. `runQueueDrain.ts` is not a route, so the same rule moves one level up:
 *      every caller of `runQueueDrain(` is a route that exports
 *      `maxDuration = 60` and awaits it.
 *
 * A new caller is a review decision, not a quiet addition: add it to
 * EXPECTED_CALLERS only with SA's sign-off, and only if it meets rule 2.
 *
 * Files are READ with `fs`, never imported, and comments are stripped first, so
 * a comment cannot satisfy or trip the guard. Tests (`__tests__/`, `*.test.*`,
 * `*.spec.*`) are not runtime callers.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'lib'];

const DRAINS = [
  'processDueReminders',
  'processScheduledExecutions',
  'processDueBriefings',
  'dispatchLeadResponses',
  'drainInsightActions',
];

const CRON_ROUTES = [
  'app/api/cron/daily-briefing/route.ts',
  'app/api/cron/insight-actions/route.ts',
  'app/api/cron/lead-response/route.ts',
  'app/api/cron/payment-reminders/route.ts',
  'app/api/cron/payment-retry/route.ts',
];
const RUNNER = 'lib/admin/jobs/runQueueDrain.ts';
const LEAD_ROUTE = 'app/api/business-os/leads/[id]/route.ts';

const EXPECTED_CALLERS = [...CRON_ROUTES, RUNNER, LEAD_ROUTE].sort();
const EXPECTED_RUNNER_CALLERS = ['app/api/admin/jobs-queues/drain/route.ts'];

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function isTestPath(relative: string): boolean {
  return /(^|\/)__tests__\//.test(relative) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(relative);
}

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const relative = path.posix.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(relative);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) || isTestPath(relative)) continue;
      files.push(relative);
    }
  };
  for (const dir of SCAN_DIRS) walk(dir);
  return files;
}

interface CallSite {
  name: string;
  index: number;
  awaited: boolean;
}

/**
 * Calls of `name(`, excluding the definition (`function name(`, `async name(`).
 * Awaited means `await` directly before the call expression, member chain
 * included (`await engine.processScheduledExecutions(`).
 */
function callsOf(code: string, names: string[]): CallSite[] {
  const sites: CallSite[] = [];
  for (const name of names) {
    for (const m of code.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
      const before = code.slice(0, m.index);
      if (/\b(function|async)\s+$/.test(before)) continue;
      const beforeExpression = before.replace(/[\w$.]*$/, '');
      sites.push({ name, index: m.index ?? 0, awaited: /\bawait\s+$/.test(beforeExpression) });
    }
  }
  return sites;
}

const exportsMaxDuration60 = (code: string): boolean => /^export const maxDuration\s*=\s*60\s*;?\s*$/m.test(code);
const isRoute = (relative: string): boolean => /(^|\/)route\.[jt]s$/.test(relative);

/** Why a route caller breaks rule 2; empty when it holds. */
function routeProblems(relative: string, code: string, names: string[]): string[] {
  const problems: string[] = [];
  if (!exportsMaxDuration60(code)) problems.push(`${relative}: does not export maxDuration = 60`);
  const unawaited = callsOf(code, names).filter((c) => !c.awaited);
  for (const c of unawaited) problems.push(`${relative}: un-awaited ${c.name}(`);
  return problems;
}

describe('drain lease invariant (L-6): the matchers themselves', () => {
  it('counts a member call as awaited only with await before the whole expression', () => {
    expect(callsOf('await engine.processScheduledExecutions();', DRAINS)[0].awaited).toBe(true);
    expect(callsOf('engine.processScheduledExecutions().catch(() => 1);', DRAINS)[0].awaited).toBe(false);
    expect(callsOf('const r = await dispatchLeadResponses({ batch: 5 });', DRAINS)[0].awaited).toBe(true);
    expect(callsOf('void dispatchLeadResponses();', DRAINS)[0].awaited).toBe(false);
  });

  it('does not count a definition or an import as a call', () => {
    expect(callsOf('export async function dispatchLeadResponses(o = {}) {}', DRAINS)).toEqual([]);
    expect(callsOf('class A { async processDueReminders() {} }', DRAINS)).toEqual([]);
    expect(callsOf("import { drainInsightActions } from 'x';", DRAINS)).toEqual([]);
  });

  it('flags a route with no maxDuration, and one with an un-awaited call', () => {
    expect(routeProblems('r.ts', 'export async function GET() { await drainInsightActions(); }', DRAINS)).toEqual([
      'r.ts: does not export maxDuration = 60',
    ]);
    expect(
      routeProblems('r.ts', 'export const maxDuration = 60;\nexport function GET() { drainInsightActions(); }', DRAINS)
    ).toEqual(['r.ts: un-awaited drainInsightActions(']);
    expect(routeProblems('r.ts', 'export const maxDuration = 300;\nawait drainInsightActions();', DRAINS)).toEqual([
      'r.ts: does not export maxDuration = 60',
    ]);
  });

  it('is not satisfied by comments', () => {
    const code = codeOf('// export const maxDuration = 60;\n/* await drainInsightActions(); */\ndrainInsightActions();');
    expect(routeProblems('r.ts', code, DRAINS)).toHaveLength(2);
  });
});

describe('drain lease invariant (L-6)', () => {
  const files = sourceFiles();
  const code = new Map(files.map((f) => [f, codeOf(fs.readFileSync(path.join(ROOT, f), 'utf8'))]));

  it('the scan sees the expected files (a broken walk cannot pass silently)', () => {
    for (const f of [...EXPECTED_CALLERS, ...EXPECTED_RUNNER_CALLERS]) expect(files).toContain(f);
  });

  it('the five drains are called only by the five cron routes, runQueueDrain.ts and the lead route', () => {
    const callers = files.filter((f) => callsOf(code.get(f) as string, DRAINS).length > 0).sort();
    expect(callers).toEqual(EXPECTED_CALLERS);
  });

  it('every route that calls a drain exports maxDuration = 60 and awaits every call', () => {
    const problems = EXPECTED_CALLERS.filter(isRoute).flatMap((f) => routeProblems(f, code.get(f) as string, DRAINS));
    expect(problems).toEqual([]);
  });

  it('runQueueDrain( is called only by routes that export maxDuration = 60 and await it', () => {
    const callers = files
      .filter((f) => f !== RUNNER && callsOf(code.get(f) as string, ['runQueueDrain']).length > 0)
      .sort();
    expect(callers).toEqual(EXPECTED_RUNNER_CALLERS);
    const problems = callers.flatMap((f) =>
      isRoute(f) ? routeProblems(f, code.get(f) as string, ['runQueueDrain']) : [`${f}: not a route`]
    );
    expect(problems).toEqual([]);
  });
});

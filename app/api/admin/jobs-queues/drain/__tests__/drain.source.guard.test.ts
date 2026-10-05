/**
 * Source guard for "Drain now" (ADMIN_BOS_CLEANUP slice 7d; C7-10, C7-11,
 * W7D-5, W7D-10). What no behaviour test can reach:
 *
 *   S-1 runQueueDrain.ts imports exactly the five drain entry points, from the
 *       five service modules, and nothing else at runtime
 *   S-2 the route reaches the drains only through runQueueDrain; and (W7D-5)
 *       no other file on the admin path imports any of the five service modules
 *   S-3 neither file names the cron's other steps, its secret or its run record
 *   S-4 neither file imports a cron route
 *   S-5 maxDuration = 60 (below the 90 s reaper lease) and the Node runtime
 *   S-6 the drain is awaited or returned, never fired and forgotten
 *   S-7 no direct table or RPC access
 *   S-8 the five cron routes keep their secret, run record and time limit, and
 *       grew no admin bypass
 *   S-9 BL-7a's lead route is not imported
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const ROUTE = 'app/api/admin/jobs-queues/drain/route.ts';
const RUNNER = 'lib/admin/jobs/runQueueDrain.ts';

const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

interface ImportLine {
  spec: string;
  typeOnly: boolean;
  names: string[];
}

function importsOf(code: string): ImportLine[] {
  const found: ImportLine[] = [];
  for (const m of code.matchAll(/import\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    const names = (m[2].match(/\{([^}]*)\}/)?.[1] ?? m[2])
      .split(',')
      .map((n) => n.replace(/^\s*type\s+/, '').trim())
      .filter(Boolean);
    found.push({ spec: m[3], typeOnly: Boolean(m[1]), names });
  }
  for (const m of code.matchAll(/import\s*['"]([^'"]+)['"]/g)) found.push({ spec: m[1], typeOnly: false, names: [] });
  for (const m of code.matchAll(/(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    found.push({ spec: m[1], typeOnly: false, names: [] });
  }
  return found;
}

const SERVICE_MODULES: Record<string, string> = {
  PaymentReminderService: 'paymentReminderService',
  PaymentAutomationEngine: 'paymentAutomationEngine',
  DailyBriefingDispatchService: 'processDueBriefings',
  LeadResponseDispatchService: 'dispatchLeadResponses',
  InsightActionDispatchService: 'drainInsightActions',
};

const FORBIDDEN_NAMES = [
  'processOverdueItems',
  'billDueDatedStages',
  'markAllOverdueInvoices',
  'processDueRetries',
  'paymentRetryService',
  'CRON_SECRET',
  'withCronRunRecord',
  'cronRunRecorder',
  'bos_cron_runs',
  'verifyCronSecret',
  '/api/cron',
];

const CRON_ROUTES: Array<[string, string]> = [
  ['app/api/cron/payment-reminders/route.ts', 'payment-reminders'],
  ['app/api/cron/payment-retry/route.ts', 'payment-retry'],
  ['app/api/cron/daily-briefing/route.ts', 'daily-briefing'],
  ['app/api/cron/lead-response/route.ts', 'lead-response'],
  ['app/api/cron/insight-actions/route.ts', 'insight-actions'],
];

describe('Drain now source guard', () => {
  const route = codeOf(read(ROUTE));
  const runner = codeOf(read(RUNNER));

  it('S-1 runQueueDrain.ts: the five entry points, from the five service modules, and nothing else at runtime', () => {
    const runtime = importsOf(runner).filter((i) => !i.typeOnly);
    const services = runtime.filter((i) => i.spec.startsWith('@/lib/services/'));
    const pairs = services.map((i) => `${i.spec.replace('@/lib/services/', '')}/${i.names.join(',')}`).sort();
    expect(pairs).toEqual(
      Object.entries(SERVICE_MODULES)
        .map(([module, symbol]) => `${module}/${symbol}`)
        .sort()
    );
    const others = runtime.filter((i) => !i.spec.startsWith('@/lib/services/')).map((i) => i.spec);
    expect(others.sort()).toEqual(['@/lib/admin/jobs/drainCounts', 'server-only']);
  });

  it('S-2 the route imports no service and no repository; it reaches the drains through runQueueDrain', () => {
    const specs = importsOf(route).map((i) => i.spec);
    expect(specs.filter((s) => /^@\/lib\/(services|repositories)\//.test(s))).toEqual([]);
    expect(specs).toContain('@/lib/admin/jobs/runQueueDrain');
    expect(route).toMatch(/await runQueueDrain\(queue\)/);
  });

  it('S-2 / W7D-5 runQueueDrain.ts is the only importer of the five service modules on the admin path', () => {
    const importers: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const relative = path.posix.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(relative);
          continue;
        }
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) continue;
        for (const { spec } of importsOf(codeOf(read(relative)))) {
          const resolved = spec.startsWith('@/')
            ? spec.slice(2)
            : spec.startsWith('.')
              ? path.posix.normalize(path.posix.join(path.posix.dirname(relative), spec))
              : spec;
          const target = resolved.replace(/\.(ts|tsx|js)$/, '');
          if (Object.keys(SERVICE_MODULES).some((m) => target === `lib/services/${m}`)) importers.push(relative);
        }
      }
    };
    for (const dir of ['app/api/admin', 'lib/admin', 'app/admin']) walk(dir);
    expect([...new Set(importers)]).toEqual([RUNNER]);
  });

  it.each([
    ['route', ROUTE],
    ['runner', RUNNER],
  ])('S-3 the %s never names the cron-only steps, the cron secret or the run record', (_label, file) => {
    const code = codeOf(read(file));
    for (const name of FORBIDDEN_NAMES) expect(code).not.toContain(name);
  });

  it.each([ROUTE, RUNNER])('S-4 %s imports nothing from app/api/cron', (file) => {
    for (const { spec } of importsOf(codeOf(read(file)))) {
      expect(spec).not.toMatch(/api\/cron/);
    }
  });

  it('S-5 maxDuration = 60 and the Node runtime', () => {
    expect(route).toMatch(/export const maxDuration = 60;/);
    expect(route).toMatch(/export const runtime = 'nodejs';/);
  });

  it('S-6 no fire-and-forget', () => {
    // Each drain is the arrow's returned expression (`() => x()`), and the
    // route awaits the runner.
    for (const symbol of Object.values(SERVICE_MODULES)) {
      expect(runner).toMatch(new RegExp(`\\(\\)\\s*=>\\s*${symbol}\\b`));
    }
    expect(runner).toMatch(/return pickDrainCounts\(queue, await DRAINS\[queue\]\(\)\)/);
    for (const code of [route, runner]) {
      expect(code).not.toMatch(/void\s+runQueueDrain/);
      expect(code).not.toMatch(/runQueueDrain\([^)]*\)\s*\.(then|catch)\(/);
      expect(code).not.toMatch(/Promise\.race/);
      expect(code).not.toMatch(/setTimeout/);
    }
  });

  it('S-7 no direct table or RPC access', () => {
    for (const code of [route, runner]) {
      expect(code).not.toMatch(/\.from\(/);
      expect(code).not.toMatch(/\.rpc\(/);
    }
  });

  it.each(CRON_ROUTES)('S-8 %s keeps its secret, run record and time limit, with no admin bypass', (file, jobId) => {
    const code = read(file);
    expect(code).toContain('verifyCronSecret');
    expect(code).toContain(`withCronRunRecord('${jobId}'`);
    expect(code).toMatch(/export const maxDuration = 60;/);
    expect(code).not.toContain('requireAdmin');
    expect(code).not.toContain('jobs-queues/drain');
    expect(code.toLowerCase()).not.toMatch(/x-admin|x-drain/);
  });

  it('S-9 the lead route (BL-7a) is not imported', () => {
    for (const code of [route, runner]) {
      for (const { spec } of importsOf(code)) expect(spec).not.toMatch(/business-os\/leads/);
    }
  });
});

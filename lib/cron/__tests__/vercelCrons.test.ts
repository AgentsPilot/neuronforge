/**
 * The production cron schedule (admin reorganisation slice 5, part A).
 *
 * `vercel.json` schedules exactly the 14 Business OS jobs. The three
 * AgentsPilot schedules were retired on Offir's instruction (OQ-4, "sunset them
 * for now"): `/api/run-scheduled-agents`, `/api/cron/update-template-scores`
 * and `/api/cron/memory-consolidation`. Their CODE is kept (FR-A2), so
 * re-enabling one is a one-line `vercel.json` change:
 *
 *   { "path": "/api/run-scheduled-agents", "schedule": "*\/5 * * * *" }
 *   { "path": "/api/cron/update-template-scores", "schedule": "0 3 * * *" }
 *   { "path": "/api/cron/memory-consolidation", "schedule": "0 4 * * 0" }
 *
 * Re-enabling one must also update this test, deliberately.
 *
 * The entries below are pinned byte for byte and in order: slice 5 must not
 * change any Business OS schedule. The 13th, the credit leak check, was added
 * deliberately by credit deduction slice 4b (2026-09-29), and the 14th, the
 * Stripe settlement gap check, on 2026-10-05. The job registry (lib/cron/bosCronJobs.ts,
 * slice 5 PR-2) is checked against vercel.json separately, in
 * bosCronJobs.test.ts (FR-R9).
 */

import * as fs from 'fs';
import * as path from 'path';

interface CronEntry {
  path: string;
  schedule: string;
}

const vercel = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8')) as {
  crons?: CronEntry[];
};

const BOS_CRONS: CronEntry[] = [
  { path: '/api/cron/calendar-sync', schedule: '*/5 * * * *' },
  { path: '/api/cron/insight-metrics', schedule: '0 3 * * *' },
  { path: '/api/cron/insight-detect', schedule: '30 3 * * *' },
  { path: '/api/cron/insight-automations', schedule: '*/5 * * * *' },
  { path: '/api/cron/insight-actions', schedule: '*/15 * * * *' },
  { path: '/api/cron/channel-metrics-sync', schedule: '30 * * * *' },
  { path: '/api/cron/payment-reminders', schedule: '40 * * * *' },
  { path: '/api/cron/intake-reminders', schedule: '15 * * * *' },
  { path: '/api/cron/payment-retry', schedule: '0 * * * *' },
  { path: '/api/cron/daily-briefing', schedule: '10 * * * *' },
  { path: '/api/cron/lead-response', schedule: '*/5 * * * *' },
  { path: '/api/cron/abandoned-proposal-invoices', schedule: '20 * * * *' },
  // Credit deduction slice 4b: the nightly leak check (read-only).
  { path: '/api/cron/credit-leak-check', schedule: '45 4 * * *' },
  /*
   * The 14th: the nightly Stripe settlement gap check (read-only), added
   * 2026-10-05 after production spent ten days refusing every Stripe delivery
   * with a 400 and nothing noticed. 05:17 is after the leak check's sweep and
   * on a minute divisible by neither 5 nor 15, so it shares a tick with no
   * other job.
   */
  { path: '/api/cron/stripe-settlement-gap', schedule: '17 5 * * *' },
];

const RETIRED_AGENTSPILOT = [
  { path: '/api/run-scheduled-agents', route: 'app/api/run-scheduled-agents/route.ts' },
  { path: '/api/cron/update-template-scores', route: 'app/api/cron/update-template-scores/route.ts' },
  { path: '/api/cron/memory-consolidation', route: 'app/api/cron/memory-consolidation/route.ts' },
];

describe('vercel.json crons (slice 5, part A)', () => {
  const crons = vercel.crons ?? [];

  it('schedules exactly the 14 Business OS jobs, unchanged and in order', () => {
    expect(crons).toHaveLength(14);
    expect(crons).toEqual(BOS_CRONS);
  });

  it('every schedule is a Business OS job under /api/cron/', () => {
    for (const cron of crons) expect(cron.path.startsWith('/api/cron/')).toBe(true);
  });

  it.each(RETIRED_AGENTSPILOT)('$path is no longer scheduled, and its code is kept (FR-A2)', ({ path: cronPath, route }) => {
    expect(crons.map((c) => c.path)).not.toContain(cronPath);
    expect(fs.existsSync(path.join(process.cwd(), route))).toBe(true);
  });

  it('no path is scheduled twice', () => {
    expect(new Set(crons.map((c) => c.path)).size).toBe(crons.length);
  });
});

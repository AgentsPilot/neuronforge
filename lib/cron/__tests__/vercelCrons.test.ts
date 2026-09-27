/**
 * The production cron schedule (admin reorganisation slice 5, part A).
 *
 * `vercel.json` schedules exactly the 12 Business OS jobs. The three
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
 * The 12 entries below are pinned byte for byte and in order: slice 5 must not
 * change any Business OS schedule. PR-2 replaces this literal list with the
 * job registry (FR-R9), which the page and the Health tiles read.
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
  { path: '/api/cron/payment-reminders', schedule: '0 8 * * *' },
  { path: '/api/cron/intake-reminders', schedule: '15 * * * *' },
  { path: '/api/cron/payment-retry', schedule: '0 * * * *' },
  { path: '/api/cron/daily-briefing', schedule: '10 * * * *' },
  { path: '/api/cron/lead-response', schedule: '*/5 * * * *' },
  { path: '/api/cron/abandoned-proposal-invoices', schedule: '20 * * * *' },
];

const RETIRED_AGENTSPILOT = [
  { path: '/api/run-scheduled-agents', route: 'app/api/run-scheduled-agents/route.ts' },
  { path: '/api/cron/update-template-scores', route: 'app/api/cron/update-template-scores/route.ts' },
  { path: '/api/cron/memory-consolidation', route: 'app/api/cron/memory-consolidation/route.ts' },
];

describe('vercel.json crons (slice 5, part A)', () => {
  const crons = vercel.crons ?? [];

  it('schedules exactly the 12 Business OS jobs, unchanged and in order', () => {
    expect(crons).toHaveLength(12);
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

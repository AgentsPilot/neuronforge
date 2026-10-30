/**
 * The production cron schedule (admin reorganisation slice 5, part A).
 *
 * `vercel.json` schedules the Business OS jobs listed below (21 as of
 * 2026-10-30) plus ONE execution-layer route, `/api/run-scheduled-agents`.
 *
 * It was 22. `inbox-enquiries` was retired on 2026-10-30: the mailbox channel
 * is an agent, and it now runs on the platform scheduler like every other one.
 * Its own cron meant `lib/business-os` importing `@/lib/pilot` to run an agent
 * itself — the management layer reaching up into the execution layer, and the
 * only such import in the whole data layer. Deleting the cron deleted the
 * import.
 *
 * The three AgentsPilot schedules were retired on Offir's instruction (OQ-4,
 * "sunset them for now"): `/api/run-scheduled-agents`,
 * `/api/cron/update-template-scores` and `/api/cron/memory-consolidation`.
 * **On 2026-10-29 the first was un-retired on Offir's instruction**, because the
 * scheduler it is the route for was finally built — it was the missing piece of
 * the execution layer, not a Business OS job. The other two stay sunset.
 *
 * Their CODE is kept (FR-A2), so re-enabling one is a one-line `vercel.json`
 * change:
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
import { PERMANENTLY_UNSCHEDULED_CRONS, type PermanentlyUnscheduledCron } from '@/lib/cron/bosCronJobs';

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
  /*
   * The 15th, and the only WEEKLY job: the hypothesis generator, which asks a
   * model for findings no detector was written for. Sunday 04:30, after the
   * nightly detection and metrics runs have settled.
   *
   * It was added to `vercel.json` without a registry row or a run recorder, so
   * it ran invisibly and two registry tests failed on it. Both closed
   * 2026-10-06; the weekly schedule shape was added to `intervalOf` and to the
   * threshold table at the same time.
   */
  { path: '/api/cron/insight-hypotheses', schedule: '30 4 * * 0' },
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
  /*
   * The client who filled the form and never paid. Twice an hour, because an
   * attempt is only worth recovering while the client still remembers making
   * it.
   */
  { path: '/api/cron/abandoned-bookings', schedule: '5,35 * * * *' },
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
  /*
   * The 16th: the insight measurement sweep (2026-10-07), which re-reads the
   * metric behind each acted-on insight at 30 and 90 days. Wired only once
   * `20261006g_insight_measurements.sql` was applied — scheduling it against
   * a missing table would have bought a nightly error and nothing else.
   *
   * 04:55 shares a tick with no other job: 04:30 is the weekly hypothesis run
   * and 04:45 is the credit leak check.
   */
  { path: '/api/cron/insight-measure', schedule: '55 4 * * *' },
  /*
   * The 17th: the nightly billing reconcile (credits boost slice 4b.2,
   * 2026-10-09). One cron with pluggable passes (boost today, P-8b's plan pass
   * later) that recovers what a missed Stripe webhook left behind. 05:41 is
   * after the settlement gap check at 05:17, so two Stripe sweeps never
   * overlap, and on a minute divisible by neither 5 nor 15, so it shares a
   * tick with no other job. Added to `vercel.json` last (durable-queue-drain
   * Step 8), after migration 20261032 is applied.
   */
  { path: '/api/cron/bos-billing-reconcile', schedule: '41 5 * * *' },
  /*
   * The 18th: CLIENTS' money, as opposed to the platform's own above.
   *
   * Every quarter hour, not nightly: this repairs a client who has paid and
   * whose booking shows nothing collected, and an owner should not spend a day
   * looking at that. The pass is bounded and idempotent, so a frequent run is
   * cheap and two overlapping ones cannot corrupt each other.
   */
  { path: '/api/cron/booking-money-reconcile', schedule: '*/15 * * * *' },
  /*
   * The 19th: the data export daily sweep (DE-8b, 2026-10-17), shipped in the
   * same PR as the zip writer (SA DE-8a Q-6). 05:25 is between the settlement
   * gap check (05:17) and the billing reconcile (05:41); no hourly or daily
   * job runs at :25.
   */
  { path: '/api/cron/data-export', schedule: '25 5 * * *' },
  // The 20th: finance slice 8.2 (§11M.7): 00:07 UTC, a free minute (CF-6), appended last.
  { path: '/api/cron/finance-snapshot', schedule: '7 0 * * *' },
  /*
   * The 21st: the mailbox lead channel (2026-10-25). One agent per connected
   * mailbox reads the enquiry emails a business's own website form sends it and
   * files each sender as a lead; `lead-response` above then replies with a
   * booking link.
   *
   * Scheduled as a Business OS cron rather than by re-enabling
   * `/api/run-scheduled-agents`. That route is the generic AgentsPilot
   * scheduler, retired below on Offir's instruction, and reviving it to run one
   * Business OS channel would undo that decision for everything behind it — and
   * break the invariant the next test pins, that everything scheduled lives
   * under `/api/cron/`.
   */
  /*
   * THE AGENT SCHEDULER, UN-RETIRED (2026-10-29).
   *
   * `/api/run-scheduled-agents` is back, on the owner's instruction, because
   * the runner and scheduler are the one part of the AgentsPilot EXECUTION
   * LAYER that was never built — and this is that layer's own route. The 2026-09-27
   * "sunset them for now" decision stands for the other two below; this one is
   * reversed.
   *
   * Its body was rewritten, not merely re-enabled. The old one dispatched
   * through QStash into `runAgentWithContext` / `runAgentKit`, neither of which
   * reads `pilot_steps` — so a compiled plan could not run that way, and an
   * agent with no prompt died on `null.trim()`. It now claims each tick with a
   * compare-and-swap, queues it as a `pending` scheduled row of
   * `agent_executions`, and executes through `WorkflowPilot`.
   *
   * It is the ONE path that is scheduled outside `/api/cron/`, and the
   * assertion below names it as the single exception: the Business OS crons
   * belong to the data layer, and the execution layer's scheduler is not one of
   * them.
   *
   * Scheduled while switched off: `AGENT_SCHEDULER_ENABLED` is server-only and
   * defaults to off, so a pass reports zeros until it is set deliberately.
   */
  { path: '/api/run-scheduled-agents', schedule: '*/5 * * * *' },
];

/*
 * Still retired. `/api/run-scheduled-agents` was on this list until 2026-10-29,
 * when the scheduler it is the route for was finally built; it is now scheduled
 * above. These two remain sunset with their code kept (FR-A2).
 */
const RETIRED_AGENTSPILOT = [
  { path: '/api/cron/update-template-scores', route: 'app/api/cron/update-template-scores/route.ts' },
  { path: '/api/cron/memory-consolidation', route: 'app/api/cron/memory-consolidation/route.ts' },
];

describe('vercel.json crons (slice 5, part A)', () => {
  const crons = vercel.crons ?? [];

  it('schedules exactly the 21 Business OS jobs plus the agent scheduler, unchanged and in order', () => {
    expect(crons).toHaveLength(22);
    expect(crons).toEqual(BOS_CRONS);
  });

  /*
   * One exception, named rather than allowed by a loosened rule.
   *
   * Every Business OS job lives under `/api/cron/` and is registered in
   * `bosCronJobs.ts`, which is what gives it a run record and late/stopped
   * monitoring. The agent scheduler is not a Business OS job: it belongs to the
   * execution layer above, and `/api/run-scheduled-agents` is its own route.
   * Listing it here keeps the invariant exact — a NEW path outside
   * `/api/cron/` still fails this test.
   */
  const NOT_A_BOS_CRON = ['/api/run-scheduled-agents'];

  it('every schedule is a Business OS job under /api/cron/, bar the named exception', () => {
    for (const cron of crons) {
      if (NOT_A_BOS_CRON.includes(cron.path)) continue;
      expect(cron.path.startsWith('/api/cron/')).toBe(true);
    }
    /* Non-vacuous: the exception is really scheduled, so this is not a rule
       with nothing to exempt. */
    for (const p of NOT_A_BOS_CRON) expect(crons.map((c) => c.path)).toContain(p);
  });

  it.each(RETIRED_AGENTSPILOT)('$path is no longer scheduled, and its code is kept (FR-A2)', ({ path: cronPath, route }) => {
    expect(crons.map((c) => c.path)).not.toContain(cronPath);
    expect(fs.existsSync(path.join(process.cwd(), route))).toBe(true);
  });

  it('no path is scheduled twice', () => {
    expect(new Set(crons.map((c) => c.path)).size).toBe(crons.length);
  });
});

/**
 * Plan payments P-10 (TK-3, BQ-P8): jobs that may never be scheduled. The
 * decision is data in the registry (`PERMANENTLY_UNSCHEDULED_CRONS`), because
 * `vercel.json` cannot hold a comment; this suite is where it bites.
 */
function scheduledButForbidden(
  config: CronEntry[],
  forbidden: readonly PermanentlyUnscheduledCron[]
): Array<{ path: string; reason: string }> {
  return forbidden
    .filter((job) => config.some((c) => c.path === job.path))
    .map((job) => ({ path: job.path, reason: job.reason }));
}

describe('vercel.json never schedules a permanently unscheduled job (P-10, TK-3)', () => {
  it('lists the free-tier freeze job, with its reason and decision date', () => {
    const freeze = PERMANENTLY_UNSCHEDULED_CRONS.find((j) => j.path === '/api/cron/check-free-tier-expiration');
    expect(freeze).toBeDefined();
    expect(freeze?.reason).toMatch(/BQ-P8/);
    expect(freeze?.decidedOn).toBe('2026-10-02');
  });

  it('none of them is in vercel.json (the failure prints why)', () => {
    // Compared as data so a failure shows the path AND the reason it may not run.
    expect(scheduledButForbidden(vercel.crons ?? [], PERMANENTLY_UNSCHEDULED_CRONS)).toEqual([]);
  });

  it('none of them is a scheduled Business OS job either', () => {
    const bosPaths = new Set(BOS_CRONS.map((c) => c.path));
    for (const job of PERMANENTLY_UNSCHEDULED_CRONS) expect(bosPaths.has(job.path)).toBe(false);
  });

  it('negative control: a config that schedules the freeze job is caught, with its reason', () => {
    const tampered: CronEntry[] = [
      ...BOS_CRONS,
      { path: '/api/cron/check-free-tier-expiration', schedule: '0 2 * * *' },
    ];
    const caught = scheduledButForbidden(tampered, PERMANENTLY_UNSCHEDULED_CRONS);
    expect(caught).toHaveLength(1);
    expect(caught[0].path).toBe('/api/cron/check-free-tier-expiration');
    expect(caught[0].reason).toMatch(/freeze paying customers/);
  });
});

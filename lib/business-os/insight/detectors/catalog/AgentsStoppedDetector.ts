/**
 * Agents Stopped Detector
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN AGENT THAT HAS STOPPED WORKING IS NOT A STATUS, IT IS AN ALERT.
 *
 * The agents list shows a stopped agent in red with the reason, and that list
 * is at the BOTTOM of the dashboard. An owner whose mailbox agent has quietly
 * stopped filing enquiries does not scroll down to find out; their first clue
 * is a lead that never arrived, days later.
 *
 * Measured on a live account on 2026-10-31: the mailbox agent failed five times
 * on an expired Gmail token, was dead-lettered, and every surface still showed
 * it as running. Leads were not being filed the whole time.
 *
 * So the finding goes where findings go — the insight system, which already
 * detects a condition, ranks it, and puts it in the "needs you" cards at the
 * top of the dashboard. No new surface, no new table, no new cron: a detector
 * added to a registry built to take them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EVERY AGENT, NOT ONLY THE MAILBOX
 *
 * It reads the scheduling contract rather than a family or a tag, the same
 * predicate the scheduler itself selects on. An agent adopted from an insight,
 * the mailbox channel and one the owner wrote in the prompt flow all stop in
 * the same way and all matter for the same reason.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT DOES NOT INTERPRET THE ERROR
 *
 * The execution layer translates a terminal failure through `toUserFacing` when
 * it dead-letters the run and stores the sentences on the run itself. This
 * reads them. A detector that re-derived meaning from the raw error would be
 * the second translator in the codebase and the one furthest from the runtime.
 *
 * @see lib/repositories/ScheduledExecutionRepository.ts — where the translation happens
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/** Just enough of a stopped agent to rank it and say what happened. */
interface StoppedAgent {
  agentId: string;
  name: string;
  /** Already written for an owner by the execution layer. */
  message: string;
  whatToDo?: string;
  lastTriedAt: string;
  /** The mailbox channel is the one whose silence costs leads. */
  isLeadChannel: boolean;
}

export class AgentsStoppedDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'agents_stopped',
    name: 'An agent has stopped',
    category: 'conversion',
    description: 'Detects scheduled agents whose runs failed until the queue gave up',

    watchedMetrics: ['conversion.agents_stopped'],
    documentsEventTypes: [],

    baselineWindow: 'week',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    minSamples: 1,

    /*
     * Critical when the stopped agent is the one that files leads, high
     * otherwise.
     *
     * The distinction is what the silence COSTS. A mailbox channel that has
     * stopped means enquiries from the website are not reaching the CRM at
     * all, and every hour of that is a person who wrote in and heard nothing.
     * A chaser that has stopped means invoices are not being followed up,
     * which is money arriving later rather than a client ignored.
     *
     * Both are worth the owner's attention today; only one is worth outranking
     * everything else on the dashboard.
     */
    severityFn: (delta: number): InsightSeverity => (delta > 0 ? 'critical' : 'high'),

    /*
     * Nothing to automate. The four actions this module can take all SEND a
     * message to a client, and none of them reconnects a mailbox or restores a
     * permission. Declaring `true` would put "handle it for me" on the card and
     * the server would answer 404 on a process that does not exist — which is
     * the exact failure `CashPayoutBlockedDetector` records having shipped.
     *
     * The card shows the finding and the owner's own next step. That is the
     * honest offer.
     */
    eligibleForAutomation: false,

    /*
     * An INSTANCE claim, and it has no denominator because it is not inferring
     * anything.
     *
     * "These two named agents stopped, and here is what each said" is a fact
     * about specific rows. There is no population it is a rate of, and no
     * baseline it departed from — which is why `sampleSize` would be a number
     * invented to satisfy a field.
     *
     * The guard's own warning applies and is worth repeating: declaring
     * `instance` makes a detector LOUDER, because it may run while a vector is
     * still learning. That is correct here. An agent that has stopped is just
     * as broken on an account's first week as on its fiftieth, and waiting for
     * enough data to be confident would mean saying nothing during exactly the
     * period when a new owner is most likely to be watching for their first
     * lead.
     */
    claimType: 'instance',

    /*
     * A day, matching the other standing conditions.
     *
     * A stopped agent does not become more true by being said twice in an
     * afternoon, and an owner who has seen it and not yet reconnected does not
     * need it again at lunchtime. It re-surfaces tomorrow if still broken,
     * which is the right rhythm for something that needs a person at a
     * computer.
     */
    cooldownHours: 24,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    /*
     * The scheduling contract, matching what the scheduler selects on. Reading
     * a tag instead would have missed whichever family nobody thought of.
     */
    const { data: agents, error: agentsError } = await this.supabase
      .from('agents')
      .select('id, agent_name, agent_config')
      .eq('user_id', userId)
      .eq('mode', 'scheduled')
      .eq('status', 'active')
      .is('deleted_at', null);

    if (agentsError || !agents?.length) {
      this.logDetection(userId, null);
      return null;
    }

    const byId = new Map(agents.map(a => [a.id as string, a]));

    /*
     * The newest scheduled run per agent, in one read.
     *
     * Newest first and keyed by agent, because the question is "is it broken
     * NOW". An agent that failed on Tuesday and succeeded on Wednesday is
     * working, and surfacing Tuesday would send the owner to fix nothing.
     */
    const { data: runs, error: runsError } = await this.supabase
      .from('agent_executions')
      .select('agent_id, status, result, created_at')
      .in('agent_id', [...byId.keys()])
      .eq('execution_type', 'scheduled')
      .order('created_at', { ascending: false })
      .limit(200);

    if (runsError) {
      this.logDetection(userId, null);
      return null;
    }

    const seen = new Set<string>();
    const stopped: StoppedAgent[] = [];

    for (const run of runs ?? []) {
      const agentId = run.agent_id as string;
      if (seen.has(agentId)) continue;
      seen.add(agentId);

      if (run.status !== 'failed') continue;

      /*
       * The sentences the execution layer wrote when it gave up. Absent on a
       * run that failed before that existed — skipped rather than guessed at,
       * because a finding with no reason gives the owner nothing to do.
       */
      const failure = (run.result as { failure?: Record<string, unknown> } | null)?.failure;
      if (!failure || typeof failure.message !== 'string') continue;

      const agent = byId.get(agentId);
      if (!agent) continue;

      const config = (agent.agent_config ?? {}) as Record<string, unknown>;

      stopped.push({
        agentId,
        name: (agent.agent_name as string) ?? 'An agent',
        message: failure.message,
        whatToDo: typeof failure.what_to_do === 'string' ? failure.what_to_do : undefined,
        lastTriedAt: run.created_at as string,
        isLeadChannel: Boolean((config.inbox_channel as { provider?: string } | undefined)?.provider),
      });
    }

    if (stopped.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const leadChannelsStopped = stopped.filter(a => a.isLeadChannel).length;
    const severity = this.definition.severityFn(leadChannelsStopped, 0);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'conversion.agents_stopped',
      currentValue: stopped.length,
      baselineValue: 0,
      thresholdValue: 0,
      /*
       * A count, so nothing changed by a percentage. `CashPayoutBlockedDetector`
       * records why that matters: a hardcoded 100 reached the narrator as a
       * real measurement and produced "a 100% increase" about a base of zero.
       */
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'agent',
      affectedEntityIds: stopped.map(a => a.agentId),
      affectedCount: stopped.length,
      /*
       * No money figure. What a stopped agent costs depends entirely on what it
       * was doing and for how long, and an invented number is worse than none —
       * the same reason this detector does not invent a percentage.
       */
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        /* The reasons, already in the owner's words, so the card can say which
           agent and what to do without reaching back into the run. */
        agents: stopped.map(a => ({
          agent_id: a.agentId,
          name: a.name,
          reason: a.message,
          what_to_do: a.whatToDo,
          last_tried_at: a.lastTriedAt,
          is_lead_channel: a.isLeadChannel,
        })),
        stopped_count: stopped.length,
        lead_channels_stopped: leadChannelsStopped,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}

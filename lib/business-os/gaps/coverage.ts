/**
 * Is a robot still going to deal with this, or has it become the owner's again?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE HAND-OFF THIS EXISTS FOR
 *
 * Business OS ships agents that take work off the owner, and the Needs-you card
 * predates them. So the product offered to chase overdue invoices and then told
 * the owner to chase overdue invoices — a card about a job a robot was doing
 * that morning. An owner learns from that: the card is noise, and the next one
 * gets skipped with it.
 *
 * The answer is not "hide a gap because an agent exists". It is a hand-off, and
 * both directions matter equally:
 *
 *     days 1–7    the milestone chaser (the owner's own 1/3/7)   card quiet
 *     days 7–60   `chase_overdue_invoices`                       card quiet
 *     day 60+     nobody                                         CARD SHOWS
 *     paused / blocked / dead-lettered / switched off            CARD SHOWS
 *
 * An owner running no automations must see exactly what they see today. An
 * owner whose agent has finished its round, stalled, or been switched off must
 * be TOLD — silence there is the worst outcome this module can produce, worse
 * than a redundant card, because nobody ever discovers it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THERE ARE NO DAY COUNTS IN THIS FILE
 *
 * "Stops after" is the owner's setting. Copy 60 into the gap code and the day
 * they extend the agent to 120, days 60–120 silently lose their card while the
 * agent is still working — the exact bug this module exists to prevent,
 * reintroduced by its own fix.
 *
 * So the end of the window is read per owner, per run, from
 * `planInputs(automation, agentConfig)` — the SAME function that hands the
 * running plan its `stop_after_days`. The agent and the suppression therefore
 * cannot disagree: there is one number and both read it.
 *
 * The START of the window is not read at all, and does not need to be. An
 * invoice three days overdue sits before `chase_overdue_invoices` begins at day
 * seven — but the agent WILL reach it at day seven, so "something is going to
 * act on this again" is already true. Only the far edge can make that false.
 * That is also why no plan JSON is parsed here.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FAILS OPEN, ALWAYS
 *
 * Every unknown resolves to NOT covered, so the card shows. An unreadable agent
 * list, an automation missing from the catalogue, an age we cannot compute: all
 * of them mean the owner is told. Hiding real work is the one outcome worse
 * than showing a redundant row.
 *
 * @module lib/business-os/gaps/coverage
 */

import { createLogger } from '@/lib/logger';
import { agentRepository } from '@/lib/repositories/AgentRepository';
import type { GapId } from './types';

const logger = createLogger({ module: 'BusinessOS', service: 'GapCoverage' });

/**
 * How old an item may be and still be an agent's problem, per gap.
 *
 * Absent means no healthy agent covers that gap — which is the normal case for
 * most businesses and for every gap no agent has claimed.
 */
export type AgentCoverage = ReadonlyMap<GapId, number>;

/** Nothing is covered. The shape a failed read returns, and the honest default. */
export const NO_COVERAGE: AgentCoverage = new Map();

/**
 * What this owner's living agents are currently taking care of.
 *
 * Read ONCE per `findGaps` pass and threaded to the gaps that need it, so this
 * costs two queries for a whole dashboard rather than two per item.
 *
 * An agent counts only when it is genuinely going to run again:
 *
 *   · installed and not deleted            — `findScheduled` already filters this
 *   · `status === 'active'`                — a paused agent does nothing
 *   · `schedule_enabled`                   — nor does one with its schedule off
 *   · not dead-lettered                    — a run the queue gave up on is not work
 *
 * The last one matters most and is the easiest to forget: an agent that failed
 * five times and was abandoned looks installed and active from every column.
 * `deadLetteredRuns` is the same reader the agents list uses, imported rather
 * than reimplemented so the two can never disagree about what "stopped" means.
 */
export async function agentCoverage(userId: string): Promise<AgentCoverage> {
  try {
    const { data: agents, error } = await agentRepository.findScheduled(userId);

    if (error) {
      /* Fails OPEN. We cannot tell what is covered, so nothing is. */
      logger.warn({ err: error, userId }, 'Could not read agents; treating nothing as covered');
      return NO_COVERAGE;
    }

    const live = (agents ?? []).filter(
      agent =>
        agent.status === 'active' &&
        (agent as { schedule_enabled?: boolean | null }).schedule_enabled !== false
    );
    if (live.length === 0) return NO_COVERAGE;

    const [{ AUTOMATION_AGENTS }, { planInputs, deadLetteredRuns }] = await Promise.all([
      import('@/lib/business-os/automations/catalog'),
      import('@/lib/business-os/automations/install'),
    ]);

    /* One read for every agent, like the agents list does. */
    const stopped = await deadLetteredRuns(live.map(agent => agent.id));

    const out = new Map<GapId, number>();

    for (const agent of live) {
      if (stopped.has(agent.id)) continue;

      const config = (agent.agent_config ?? {}) as Record<string, Record<string, unknown>>;
      const automationId = config.business_os_automation?.id;
      if (!automationId) continue;

      const automation = AUTOMATION_AGENTS.find(entry => entry.id === String(automationId));
      if (!automation?.coversGap) continue;

      /*
       * THE OWNER'S OWN NUMBER, through the function the plan uses.
       *
       * `planInputs` returns the stop rule the way a PLAN spends it — negative,
       * because the plan uses it as a date offset ("anything newer than today
       * minus N"). Here it is an age, so the magnitude is what matters.
       *
       * An automation with no stop rule covers nothing by age: there is no far
       * edge to be inside of, and inventing one here would be the hardcode this
       * module refuses.
       */
      const { stop_after_days: offset } = planInputs(automation, agent.agent_config ?? null);
      if (typeof offset !== 'number' || !Number.isFinite(offset)) continue;

      const lastDay = Math.abs(offset);
      if (lastDay <= 0) continue;

      /* Two agents on one gap: the longer window wins, because either of them
         acting is enough to make the card wrong. */
      const known = out.get(automation.coversGap);
      out.set(automation.coversGap, known === undefined ? lastDay : Math.max(known, lastDay));
    }

    return out;
  } catch (err) {
    logger.error({ err, userId }, 'Coverage read failed; treating nothing as covered');
    return NO_COVERAGE;
  }
}

/**
 * Will an agent still act on something this old?
 *
 * `ageDays` is how long the item has been the kind of stuck this gap reports —
 * days overdue for an invoice, days since a quote went out. Anything younger
 * than an agent's starting point is still covered, because the agent reaches it
 * later; see the note at the top of this file.
 *
 * A negative or unreadable age is NOT covered: an item we cannot place in time
 * is one we must not hide.
 */
export function coveredByAgent(
  coverage: AgentCoverage,
  gapId: GapId,
  ageDays: number
): boolean {
  if (!Number.isFinite(ageDays)) return false;

  const lastDay = coverage.get(gapId);
  if (lastDay === undefined) return false;

  return ageDays <= lastDay;
}

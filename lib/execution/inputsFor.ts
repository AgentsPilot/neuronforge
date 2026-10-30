/**
 * Where a scheduled agent's runtime values come from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONLY PLACE THE TWO CREATION DOORWAYS DIFFER.
 *
 * An agent is an agent by the time it reaches the scheduler: an `agents` row
 * with a compiled plan, walked by `WorkflowPilot`. One was created from a
 * prompt, the other was recommended by the insight system and adopted by its
 * owner — and after creation nothing downstream can tell, or needs to. This
 * function is the single seam between them, and it exists only because the two
 * doorways stored the owner's answers in different places:
 *
 *   from a prompt       the owner filled in a form, and the answers were saved
 *                       to `agent_configurations.input_values`. That is also
 *                       where /api/run-agent reads them, so a scheduled run and
 *                       a manual run of the same agent resolve identically.
 *
 *   from an insight     the owner answered two questions on the adopt dialog —
 *                       how often, and when to give up — and those live on the
 *                       agent row itself, in
 *                       `agent_config.business_os_automation`. There is no
 *                       `agent_configurations` row at all.
 *
 * The prompt is the OTHER value that differs and needs no seam: the runner
 * passes `agent.user_prompt ?? ''`. That is safe because `userInput` reaches
 * exactly two things inside the pilot — the memory injector and one
 * serialization. It does not drive execution; the plan does.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ON THE LAYER BOUNDARY
 *
 * The execution layer reaches Business OS through the `business-os` PLUGIN —
 * that is the channel, and it is what carries tenant scoping via
 * `connection.user_id`. Nothing here goes around it: every row an agent reads
 * or writes is fetched by its plan, through the plugin.
 *
 * The catalogue import below is not a data read. `automationById` returns a
 * committed, static registry entry — which predefined agents exist, and what
 * each one's default stop rule is — and `planInputs` combines that with the
 * owner's own choice, which is already on the `agents` row. No business data is
 * touched, so no channel is bypassed.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { agentConfigurationRepository } from '@/lib/repositories/AgentConfigurationRepository';
import { automationById } from '@/lib/business-os/automations/catalog';
import { planInputs } from '@/lib/business-os/automations/install';
import type { AutomationAgent } from '@/lib/business-os/automations/types';

const logger = createLogger({ module: 'scheduledAgentInputs' });

/** Just enough of the agent row to decide where its values live. */
export interface AgentForInputs {
  id: string;
  user_id: string;
  agent_config?: Record<string, unknown> | null;
}

/**
 * The `inputValues` to hand `WorkflowPilot.execute`.
 *
 * Never throws and never returns null: a plan whose values could not be read
 * should run and fail honestly on the missing value, rather than the whole tick
 * disappearing because one read did.
 */
export async function inputsFor(agent: AgentForInputs): Promise<Record<string, unknown>> {
  const automationId = (
    agent.agent_config?.business_os_automation as { id?: string } | undefined
  )?.id;

  if (automationId) {
    const automation = automationById(automationId);

    if (!automation) {
      /*
       * A predefined agent we have stopped shipping, still installed on
       * somebody's account. The run will do nothing useful, but it must not
       * invent a stop rule: without one the plan's upper bound is missing and
       * its find is unbounded, which is the one outcome worth refusing.
       */
      logger.error(
        { agentId: agent.id, automationId },
        'Adopted agent is not in the catalogue; no inputs resolved'
      );
      return {};
    }

    /*
     * `planInputs` is the single source of the stop rule. It falls back to the
     * catalogue default when the owner never chose one, which is what makes the
     * number the plan spends and the number the owner is shown the same number.
     */
    return planInputs(automation as AutomationAgent, agent.agent_config ?? null);
  }

  /*
   * Everything else — prompt-created agents, the mailbox channel — reads the
   * configuration row, newest first, exactly as /api/run-agent does. The
   * comment on the retired `inboxChannelRunner.inputValuesFor` recorded why it
   * is this table and not `agents.config`: this is where `{{input.*}}`
   * resolves from.
   */
  const { data, error } = await agentConfigurationRepository.getInputValues(
    agent.id,
    agent.user_id
  );

  if (error) {
    logger.error({ err: error, agentId: agent.id }, 'Could not read agent input values');
    return {};
  }

  const stored = (data?.input_values as Record<string, unknown> | undefined) ?? {};

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE MAILBOX WINDOW IS COMPUTED NOW, NOT STORED.
   *
   * `mail_since` and the `after:` inside `mail_query` were written once, at
   * setup, from the date setup happened to run on. That is a FIXED point, so
   * the window widens every day the agent runs — measured on a live channel
   * four days after setup it was four days wide and growing. With
   * `max_results: 100` the search eventually stops returning the oldest mail
   * without saying so, which is the worst way for a bound to fail: it looks
   * like an empty inbox.
   *
   * An unread message from three months ago is not a live enquiry. The owner's
   * `stopAfterDays` is where that line sits, and it has to be recomputed on
   * every run or it is not a window at all — it is another fixed date.
   *
   * Overlaid on the stored values rather than replacing them: everything else
   * setup measured — the sender, the subject key, the template — is still
   * exactly what it learned from the owner's own mail.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const inbox = agent.agent_config?.inbox_channel as
    | { stopAfterDays?: number; stopAfter?: unknown }
    | undefined;

  if (inbox) {
    const { INBOX_STOP_AFTER_DEFAULT, INBOX_STOP_AFTER_RANGE } = await import(
      '@/lib/business-os/leads/inboxProviders'
    );
    const { clampInterval, intervalMinutes, parseInterval } = await import(
      '@/lib/business-os/schedule/interval'
    );

    /*
     * ───────────────────────────────────────────────────────────────────────────
     * THE WINDOW IS READ IN MINUTES, NOT DAYS.
     *
     * `stopAfter` is the owner's own answer and the only field that can hold
     * HOURS: twelve of them round to one day in `stopAfterDays`, and an owner
     * who said "anything unread from before this morning has been dealt with"
     * must not be handed a whole day of mail instead.
     *
     * `stopAfterDays` is the fallback, for every channel installed before the
     * control asked for a number — and the default behind both, because absent
     * never meant "no bound". It meant the setup date, which was worse.
     *
     * Clamped rather than checked against a list of choices. The control asks
     * for a number now, so 20 days is a real answer where the old
     * `CHOICES.includes` test silently discarded it and used the default.
     * ───────────────────────────────────────────────────────────────────────────
     */
    const chosen =
      parseInterval(inbox.stopAfter) ??
      (typeof inbox.stopAfterDays === 'number' && inbox.stopAfterDays > 0
        ? { every: inbox.stopAfterDays, unit: 'days' as const }
        : { every: INBOX_STOP_AFTER_DEFAULT, unit: 'days' as const });

    const minutes = intervalMinutes(clampInterval(chosen, INBOX_STOP_AFTER_RANGE));
    const since = new Date(Date.now() - minutes * 60_000);

    return {
      ...stored,
      /* Outlook takes the instant as its own OData filter. */
      mail_since: since.toISOString(),
      /*
         Gmail takes one string, and `after:` accepts `YYYY/MM/DD` and nothing
         else. Rewritten in place so the rest of the measured query — the
         sender, the subject phrase, `is:unread` — survives untouched.
      */
      mail_query: rollGmailWindow(stored.mail_query, since),
    };
  }

  return stored;
}

/**
 * The same Gmail query, with its `after:` moved to the start of the window.
 *
 * Returns the query unchanged when there is nothing to move: a query with no
 * `after:` was phrased by something other than `gmailQuery`, and appending a
 * bound to a string we did not write is how a search silently stops matching.
 */
function rollGmailWindow(query: unknown, since: Date): unknown {
  if (typeof query !== 'string' || !query.includes('after:')) return query;

  const stamp =
    `${since.getUTCFullYear()}/${since.getUTCMonth() + 1}/${since.getUTCDate()}`;

  return query.replace(/after:\d{4}\/\d{1,2}\/\d{1,2}/, `after:${stamp}`);
}

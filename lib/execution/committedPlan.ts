/**
 * Is the plan on this agent's row still the plan we ship?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A COPY EXISTS AT ALL, AND WHY IT MUST BE REFRESHED
 *
 * Every owner gets their own `agents` row — that is what makes an agent theirs
 * to see, pause and remove — and the runtime reads the plan OFF that row. So a
 * committed plan is COPIED there when the agent is created.
 *
 * A copy goes stale, and both committed-plan families have now proved it:
 *
 *   the automations   all six used a bare `{{stop_after_days}}` where the pilot
 *                     resolves `{{input.stop_after_days}}`, so every one failed
 *                     on its first step. Fixing the files did nothing for the
 *                     agents already installed.
 *
 *   the mailbox       its plan filed leads through the `crm` plugin. Repointing
 *                     it at `business-os.capture_enquiry_contacts` would have
 *                     left every connected mailbox calling the retired door.
 *
 * A plan fix that cannot reach an existing install is not a fix. So each family
 * stamps a fingerprint of the plan it copied, and this compares them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE DISPATCH LIVES HERE
 *
 * The execution layer is what runs an agent, so it is what must notice a stale
 * plan — one place, before the plan executes, which every run passes through.
 * The two families are data-layer modules and neither should know about the
 * other, so the question "which committed plan belongs to this agent" is asked
 * here and answered by whichever family owns the agent.
 *
 * An agent with no committed plan — one somebody wrote from a prompt — is
 * nobody's to refresh, and gets `null`. Its plan is its own.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'committedPlan' });

/** Just enough of the agent row to find its committed plan. */
export interface AgentForPlan {
  id: string;
  agent_config?: Record<string, unknown> | null;
}

export interface FresherPlan {
  /** Which family this agent belongs to, for the log line. */
  source: 'automation' | 'inbox-channel';
  /** What the family calls this agent, for the log line. */
  name: string;
  steps: unknown[];
  planVersion: string;
  pluginsRequired: string[];
  /**
   * The `agent_config` to write back, with the new stamp folded in.
   *
   * Built by the family rather than by the caller: each one keeps the stamp
   * under its own key, and a caller guessing at that is how a stamp gets
   * written to the wrong place and the row looks stale for ever.
   */
  agentConfig: Record<string, unknown>;
}

/**
 * The current plan for this agent, or null when its copy is already current.
 *
 * Never throws. A plan we cannot check should run as it is — the alternative is
 * an agent that stops working because a lookup failed.
 */
export async function currentPlanIfStale(agent: AgentForPlan): Promise<FresherPlan | null> {
  const config = agent.agent_config ?? {};

  try {
    /* ── the agents an owner adopted from an insight ───────────────────── */
    const automation = config.business_os_automation as
      | { id?: string; planVersion?: string }
      | undefined;

    if (automation?.id) {
      const { automationById } = await import('@/lib/business-os/automations/catalog');
      const { planVersion } = await import('@/lib/business-os/automations/types');

      const entry = automationById(automation.id);
      if (!entry) {
        /* Still installed, no longer shipped. Nothing to refresh it to, and
           inventing a plan is the one thing not to do. */
        logger.warn(
          { agentId: agent.id, automationId: automation.id },
          'Adopted agent is not in the catalogue; its plan cannot be refreshed'
        );
        return null;
      }

      const current = planVersion(entry.steps);
      if (automation.planVersion === current) return null;

      return {
        source: 'automation',
        name: entry.id,
        steps: entry.steps,
        planVersion: current,
        pluginsRequired: entry.pluginsRequired,
        agentConfig: {
          ...config,
          business_os_automation: { ...automation, planVersion: current },
        },
      };
    }

    /* ── the mailbox channels ──────────────────────────────────────────── */
    const inbox = config.inbox_channel as { provider?: string; planVersion?: string } | undefined;

    if (inbox?.provider) {
      const { INBOX_PLANS, inboxPlanVersion, inboxPluginsRequired } = await import(
        '@/lib/business-os/leads/inboxPlans'
      );
      const provider = inbox.provider as keyof typeof INBOX_PLANS;

      if (!INBOX_PLANS[provider]) {
        logger.warn(
          { agentId: agent.id, provider: inbox.provider },
          'Mailbox channel names a provider we do not ship; its plan cannot be refreshed'
        );
        return null;
      }

      const current = inboxPlanVersion(provider);
      if (inbox.planVersion === current) return null;

      return {
        source: 'inbox-channel',
        name: provider,
        steps: INBOX_PLANS[provider],
        planVersion: current,
        pluginsRequired: inboxPluginsRequired(provider),
        agentConfig: {
          ...config,
          inbox_channel: { ...inbox, planVersion: current },
        },
      };
    }

    /* Written from a prompt. Its plan is its own. */
    return null;
  } catch (error) {
    logger.error({ err: error, agentId: agent.id }, 'Could not check whether the plan is current');
    return null;
  }
}

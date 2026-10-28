/**
 * Run every business's inbox lead channel, once per tick.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS RATHER THAN THE GENERIC SCHEDULER
 *
 * The platform has a general scheduled-agent runner (`/api/run-scheduled-agents`).
 * It is switched off on purpose: AgentsPilot is parked, and its three schedules
 * were removed from `vercel.json` on 2026-09-27 ("sunset them for now"). Its
 * code is kept and its guard test records that decision.
 *
 * Reviving it to run one Business OS channel would undo that decision for
 * everything behind it, and would break the invariant its own test pins — that
 * everything scheduled is a Business OS job under `/api/cron/`. So this channel
 * gets what the other twenty-one Business OS jobs have: its own cron, its own
 * registry row, its own run record, and the late/stopped monitoring that comes
 * with them.
 *
 * It still executes through the V6 layer: `WorkflowPilot` walks the compiled
 * `pilot_steps` exactly as `/api/run-agent` does. Deliberately NOT `runAgentKit`
 * or `runAgentWithContext` — both are prompt-driven, and this agent has a
 * compiled plan and no prompt by design (the owner writes none). Handing it to
 * either would ask a model to improvise what the plan already states.
 * This module decides WHEN, and nothing else.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT CLAIMS BEFORE IT RUNS
 *
 * Two overlapping ticks reading one mailbox would both see the same unread
 * enquiry and both file it: `captureEnquiry` is find-or-create by address so
 * the contact would survive, but the activity and the stored first message
 * would double. The claim is `last_run`, written with a WHERE on the value we
 * read — the same pattern the generic runner uses on `next_run`. A second
 * caller updates no rows and skips.
 *
 * @module lib/business-os/leads/inboxChannelRunner
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { WorkflowPilot } from '@/lib/pilot';
import type { Agent as PilotAgent } from '@/lib/pilot/types';
import { INBOX_CHANNEL_TAG } from './inboxChannel';

const logger = createLogger({ module: 'inboxChannelRunner' });

/**
 * How long a channel waits between checks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FIFTEEN, SET HERE RATHER THAN ON THE CRON.
 *
 * This is the knob that decides how often a mailbox is actually searched. The
 * cron stays at five minutes, and the difference matters in one case: a channel
 * created a moment ago has `last_run = null` and is due immediately, so it makes
 * its first check within five minutes instead of waiting out a quarter of an
 * hour. Slowing the SCHEDULE would have cost that, and cost it on the one run
 * an owner is watching for.
 *
 * What it costs: the reply the client receives is sent fifteen minutes after
 * the enquiry is filed, so the whole journey moves from about twenty minutes to
 * at most thirty. Deliberate, and the reason the cron's own header no longer
 * argues for five.
 *
 * Still a floor rather than an assumption about the schedule, so a tick that
 * fires twice — a retry, an overlapping invocation — cannot become two runs a
 * few seconds apart.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const MIN_MINUTES_BETWEEN_RUNS = 15;

/**
 * How many channels one tick will run.
 *
 * Each is a mailbox search that normally matches nothing, so the work is
 * small; the bound exists because the route has 60 seconds. Channels are taken
 * oldest-check-first, so a backlog drains across ticks instead of starving the
 * same tail every time.
 */
const CHANNELS_PER_TICK = 25;

export interface InboxChannelRunResult {
  /** Channels that were due this tick. */
  due: number;
  /** Channels this caller claimed. Lower than `due` means another had them. */
  claimed: number;
  ran: number;
  failed: number;
}

/**
 * Everything the pilot needs, read in the listing query.
 *
 * Selected here rather than re-fetched per channel: the plan and the input
 * values are the two things that make a run this owner's own, and a second
 * round trip per agent buys nothing on a tick that normally finds nothing to
 * do.
 */
interface ChannelAgent {
  id: string;
  user_id: string;
  agent_name: string;
  last_run: string | null;
  pilot_steps: unknown;
  workflow_steps: unknown;
  plugins_required: string[] | null;
  status: string;
  created_at: string;
  updated_at: string | null;
}

/**
 * This owner's two values: which mail to look at, and what their form's emails
 * look like.
 *
 * From `agent_configurations.input_values`, because that is where the plan's
 * `{{input.*}}` references resolve from — not `agents.config`, which holds the
 * same provider name for display and is not read by the runtime.
 */
async function inputValuesFor(agentId: string, userId: string): Promise<Record<string, unknown>> {
  const { data } = await supabaseServer
    .from('agent_configurations')
    .select('input_values')
    .eq('agent_id', agentId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data?.input_values as Record<string, unknown>) ?? {};
}

/**
 * Run the channels that are due.
 *
 * Never throws for one business's failure: a mailbox whose token expired must
 * not stop every other business's enquiries being read. Each failure is logged
 * against its own agent and counted.
 */
export async function runInboxChannels(): Promise<InboxChannelRunResult> {
  const result: InboxChannelRunResult = { due: 0, claimed: 0, ran: 0, failed: 0 };

  const dueBefore = new Date(Date.now() - MIN_MINUTES_BETWEEN_RUNS * 60_000).toISOString();

  /*
   * `or` rather than a plain comparison: a channel that has never run has a
   * null `last_run`, and `lte` does not match NULL in SQL. That omission is
   * exactly the bug that left the generic runner skipping every freshly
   * created agent forever.
   */
  const { data, error } = await supabaseServer
    .from('agents')
    .select(
      'id, user_id, agent_name, last_run, pilot_steps, workflow_steps, plugins_required, status, created_at, updated_at'
    )
    .contains('tags', [INBOX_CHANNEL_TAG])
    .eq('status', 'active')
    .is('deleted_at', null)
    .or(`last_run.is.null,last_run.lte.${dueBefore}`)
    .order('last_run', { ascending: true, nullsFirst: true })
    .limit(CHANNELS_PER_TICK);

  if (error) {
    logger.error({ err: error }, 'Could not list inbox channels');
    throw error;
  }

  const channels = (data ?? []) as ChannelAgent[];
  result.due = channels.length;

  for (const channel of channels) {
    const log = logger.child({ agentId: channel.id, userId: channel.user_id });

    /* THE CLAIM. Matching on the value we read is what makes two callers
       mutually exclusive — `is` for a null, `eq` otherwise, because they are
       not the same operator in PostgREST. */
    const claim = supabaseServer
      .from('agents')
      .update({ last_run: new Date().toISOString() })
      .eq('id', channel.id);

    const { data: claimed, error: claimError } = await (channel.last_run === null
      ? claim.is('last_run', null)
      : claim.eq('last_run', channel.last_run)
    ).select('id');

    if (claimError) {
      log.error({ err: claimError }, 'Could not claim the channel');
      result.failed += 1;
      continue;
    }
    if (!claimed || claimed.length === 0) {
      log.debug('Another run has this channel');
      continue;
    }

    result.claimed += 1;

    try {
      const inputValues = await inputValuesFor(channel.id, channel.user_id);

      /* The compiled plan, walked step by step. `user_prompt` is empty on
         purpose and the pilot does not need one: every value the steps use
         comes from `inputValues`. */
      const pilot = new WorkflowPilot(supabaseServer);

      const pilotAgent: PilotAgent = {
        id: channel.id,
        user_id: channel.user_id,
        agent_name: channel.agent_name,
        user_prompt: '',
        /* The columns are JSONB, so they arrive as `unknown`. The cast is the
           same one `/api/run-agent` makes at the same seam — the shape is
           guaranteed by the compiler that wrote them, not by this read. */
        pilot_steps: channel.pilot_steps as PilotAgent['pilot_steps'],
        workflow_steps: channel.workflow_steps as PilotAgent['workflow_steps'],
        plugins_required: channel.plugins_required ?? [],
        status: channel.status,
        created_at: channel.created_at,
        updated_at: channel.updated_at ?? undefined,
      };

      await pilot.execute(pilotAgent, channel.user_id, '', inputValues);

      result.ran += 1;
      log.info('Inbox channel checked');
    } catch (err) {
      /*
       * The claim stands. Releasing `last_run` on failure would have a
       * mailbox that fails every time retried on every tick for as long as it
       * stays broken; holding it means one attempt per interval, and the
       * channel's own `never_run` / disconnected state is what tells the owner.
       */
      result.failed += 1;
      log.error({ err }, 'Inbox channel run failed');
    }
  }

  return result;
}

/**
 * One answer to "where does this business's inbox channel stand", for every
 * surface that asks.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY ONE MODULE AND NOT FOUR READINGS
 *
 * Four places need to say something about this channel, and they are not
 * allowed to disagree:
 *
 *   · the Channels card, beside Facebook and Google
 *   · the onboarding build page, where a new owner is still setting things up
 *   · My Day, where an owner meets what the platform did for them
 *   · readiness, which must say out loud when the channel is on and nobody is
 *     being answered
 *
 * Every bug this platform has written a post-mortem about is the same disease:
 * one question answered independently in several places, which then drift. So
 * the question is answered once, here, and the surfaces render it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THERE IS NO CHANNEL TABLE
 *
 * The channel IS an agent. When an owner finishes setup we copy the template
 * agent into their account with their mailbox rule and their learned template
 * under `agents.agent_config.inbox_channel`, and that row is the whole record:
 * connected or not, running or paused, what it watches, when it last ran. A
 * second table holding the same facts would be a second thing to keep in step
 * with the first.
 *
 * `agent_config`, NOT `config`: there is no `config` column, and writing to
 * one made PostgREST refuse the whole insert. See INBOX_CHANNEL_CONFIG_KEY.
 *
 * It is found by tag rather than by name, because a name is the owner's to
 * change and a tag is ours.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE AGENT PER MAILBOX, NOT PER BUSINESS
 *
 * A business that takes enquiries at two addresses gets two channels: a Gmail
 * agent and an Outlook agent, each with its own learned template, its own
 * mailbox rule and its own schedule. That is the shape of the thing — two
 * mailboxes are two independent sources of leads, and one of them being broken
 * must not be reported as the other being broken.
 *
 * It also settles a problem the single-agent shape could not: the two providers
 * need different plans (different action for marking read, different search
 * parameters, a different query language). With one agent per connection each
 * carries its own provider's plan, so there is nothing to switch at run time.
 *
 * `channels` below is therefore the truth, one row per connected mailbox, and
 * the account-level fields beside it are roll-ups computed HERE so no surface
 * computes its own.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READINESS IS PART OF THE STATE, NOT A SEPARATE SCREEN
 *
 * The dangerous state here is not "broken". It is "working, and nobody is
 * answered": the agent files leads perfectly while `lead_autosend_enabled` is
 * off, so every enquiry lands in the CRM and no client ever hears back. It
 * looks like success from every angle except the client's. `problems` carries
 * that, so a surface cannot render a healthy-looking card over it.
 *
 * @module lib/business-os/leads/inboxChannel
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import type { EnquiryTemplate } from './enquiryTemplate';
import { INBOX_CHANNEL_VIA } from './captureEnquiry';
import {
  INBOX_CHANNEL_CONFIG_KEY,
  INBOX_CHANNEL_TAG,
  SUPPORTED_PROVIDERS,
  type InboxProvider,
} from './inboxProviders';

const logger = createLogger({ module: 'inboxChannel' });

/*
 * The provider facts live in `inboxProviders.ts`, which has no imports, and are
 * re-exported here so server code can keep asking this one module everything
 * about the channel.
 *
 * They had to move: this module imports `supabaseServer`, and the card and the
 * setup dialog are `'use client'`. A type import from here is erased and
 * harmless; `PROVIDER_NAMES` is a value, so importing it would have pulled the
 * service-role Supabase client into a browser bundle.
 */
export {
  INBOX_CHANNEL_CONFIG_KEY,
  INBOX_CHANNEL_TAG,
  PROVIDER_NAMES,
  SUPPORTED_PROVIDERS,
  inboxChannelTag,
  type InboxProvider,
} from './inboxProviders';

export type InboxChannelState =
  /** No mailbox connected, or connected but never set up. The entry point. */
  | 'not_connected'
  /** Set up and running on its schedule. */
  | 'running'
  /** Set up, but the owner switched it off. Their decision, not a fault. */
  | 'paused';

/**
 * Something true that stops this channel doing its job, in the owner's terms.
 *
 * `replies_off` is the one that matters: everything works and no client is
 * answered. It is not an error anywhere — no request fails, no log line is
 * red — which is exactly why it has to be said here.
 */
export type InboxChannelProblem =
  | 'replies_off'
  | 'mailbox_disconnected'
  | 'never_run';

/** One mailbox's channel. The unit of truth — see the note at the top. */
export interface InboxChannelRow {
  provider: InboxProvider;
  /** The agent row. The channel's whole record. */
  agentId: string;
  state: Exclude<InboxChannelState, 'not_connected'>;
  /** What it watches, in the owner's own words, for the card to show. */
  watching: string | null;
  /** The layout learned from THIS mailbox during setup. */
  template: EnquiryTemplate | null;
  lastRunAt: string | null;
  /**
   * Leads this mailbox has brought in the last 30 days.
   *
   * Counted from `source_metadata.via`, not from `source`: the source must
   * stay inside FORM_SOURCES or the chase stops seeing these contacts, which
   * makes a mailbox lead and a website-form lead identical by design. The
   * marker beside it is what makes the channel countable.
   *
   * Zero is a real answer and is shown as one. Only leads filed AFTER the
   * marker shipped carry it, so an older channel reads 0 until its next.
   */
  leads: number;
  /**
   * What is wrong with this mailbox specifically. Never `replies_off`, which
   * is one account-wide setting and belongs on the status, not on a row: put
   * on both, two connected mailboxes would show the owner the same warning
   * twice and invite them to fix it twice.
   */
  problems: Exclude<InboxChannelProblem, 'replies_off'>[];
}

export interface InboxChannelStatus {
  /**
   * One row per mailbox that has a channel. Empty for a business with none.
   * THE TRUTH; everything below it is derived from this and the connections.
   */
  channels: InboxChannelRow[];
  /**
   * Connected mailboxes with NO channel yet — exactly what setup can still
   * offer. A provider already running is absent, so the wizard cannot offer
   * to set up something twice, and the Channels card stops inviting once
   * every connected mailbox is done.
   */
  connectable: InboxProvider[];
  /**
   * The whole account in one word, for a surface with one line to spend.
   * `running` if any mailbox is, `paused` if some are set up and none run,
   * `not_connected` if none are set up at all.
   */
  state: InboxChannelState;
  /**
   * Account-level problems, plus every row's, so a surface that shows one
   * warning cannot show a healthy account over a broken mailbox. Deduplicated.
   */
  problems: InboxChannelProblem[];
}

interface ChannelConfig {
  provider?: InboxProvider;
  mail_query?: string;
  watching?: string;
  enquiry_template?: EnquiryTemplate | string;
}

/** `enquiry_template` is JSON on the agent, so it may arrive as a string. */
function readTemplate(raw: ChannelConfig['enquiry_template']): EnquiryTemplate | null {
  if (!raw) return null;
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw) as EnquiryTemplate;
  } catch {
    /* A template we cannot read is not a crash: the parser copes without one,
       less certainly. Worth a log, not a failure. */
    logger.warn('Stored enquiry template could not be parsed; reading without it');
    return null;
  }
}

/**
 * Where this owner's inbox channel stands.
 *
 * Never throws. Every surface that calls this is rendering something else as
 * well, and a card that cannot answer should be absent rather than take the
 * page down with it.
 */
export async function inboxChannelStatus(userId: string): Promise<InboxChannelStatus> {
  const empty: InboxChannelStatus = {
    channels: [],
    connectable: [],
    state: 'not_connected',
    problems: [],
  };

  try {
    /* Thirty days: long enough that a quiet week does not read as broken,
       short enough to be about now rather than all time. */
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [{ data: agents }, { data: connections }, { data: profile }, { data: leadRows }] =
      await Promise.all([
      supabaseServer
        .from('agents')
        /*
         * `last_run`, not `updated_at`.
         *
         * This read `updated_at` and called it the last check, which is a
         * different fact: the row is touched by every edit, so a channel that
         * has never run once reports having run the moment its owner renames
         * it. `last_run` is what the scheduled runner stamps when it actually
         * claims the agent, and null there means it genuinely has not run.
         */
        .select('id, status, agent_config, tags, last_run')
        .eq('user_id', userId)
        .contains('tags', [INBOX_CHANNEL_TAG])
        .is('deleted_at', null)
        /* EVERY channel, not the newest one. A business with two mailboxes has
           two, and `limit(1)` would have reported the Gmail one as the whole
           account and left the Outlook one invisible — running, unmonitored,
           and offered for setup again. */
        .order('created_at', { ascending: true }),
      supabaseServer
        .from('plugin_connections')
        .select('plugin_name, status')
        .eq('user_id', userId)
        /* Only what the agent can run — see SUPPORTED_PROVIDERS. Narrowed
           here rather than at each surface, so none of them can offer a
           provider that would file nothing. */
        .in('plugin_name', SUPPORTED_PROVIDERS as unknown as string[]),
      supabaseServer
        .from('business_profiles')
        .select('lead_autosend_enabled')
        .eq('user_id', userId)
        .maybeSingle(),
      /* One read for every channel's count. Narrow: the marker, this owner,
         the window. */
      supabaseServer
        .from('crm_contacts')
        .select('source_metadata')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .gte('created_at', since)
        .contains('source_metadata', { via: INBOX_CHANNEL_VIA }),
    ]);

    /* Tallied per provider, so two mailboxes report their own numbers rather
       than sharing one. */
    const leadsByProvider = new Map<string, number>();
    for (const row of leadRows ?? []) {
      const meta = (row.source_metadata ?? {}) as { provider?: string };
      const key = meta.provider ?? '';
      leadsByProvider.set(key, (leadsByProvider.get(key) ?? 0) + 1);
    }

    const connected = (connections ?? [])
      .filter(c => c.status === 'active')
      .map(c => c.plugin_name as InboxProvider);

    /*
     * ONE ROW PER MAILBOX, and a provider seen twice keeps its FIRST agent.
     *
     * Setup is idempotent on the provider tag, so a duplicate should be
     * impossible — but if one ever exists, the oldest is the one the runner
     * and the owner have been living with, and reporting the newer would make
     * "what is it watching" change under them for no reason they did.
     */
    const seen = new Set<InboxProvider>();
    const channels: InboxChannelRow[] = [];

    for (const agent of agents ?? []) {
      /* `agent_config`, namespaced. There is no `agents.config` column — see
         the note on INBOX_CHANNEL_CONFIG_KEY — and the JSONB it does have is
         shared with creation metadata and the V6 ai_context. */
      const config = (((agent.agent_config ?? {}) as Record<string, unknown>)[
        INBOX_CHANNEL_CONFIG_KEY
      ] ?? {}) as ChannelConfig;
      const provider = config.provider;

      /* A channel with no provider recorded cannot be matched to a mailbox or
         run against one. Skipped rather than guessed. */
      if (!provider || seen.has(provider)) continue;
      seen.add(provider);

      const rowProblems: InboxChannelRow['problems'] = [];

      /* The mailbox it reads can be disconnected long after setup — and with
         two channels, one can be disconnected while the other is fine. */
      if (!connected.includes(provider)) rowProblems.push('mailbox_disconnected');

      const state = agent.status === 'active' ? 'running' : 'paused';

      /*
       * Set up, switched on, and nothing has happened: worth saying before the
       * owner concludes the product does not work.
       *
       * This asked `!agent.updated_at`, which is never true — the repository
       * stamps `updated_at` on insert — so the detector was dead and a channel
       * that never ran looked indistinguishable from one running fine.
       * `last_run` is null until the runner claims the agent, which is the
       * fact meant here.
       */
      if (state === 'running' && !agent.last_run) rowProblems.push('never_run');

      channels.push({
        provider,
        agentId: agent.id as string,
        state,
        watching: config.watching ?? config.mail_query ?? null,
        template: readTemplate(config.enquiry_template),
        lastRunAt: (agent.last_run as string) ?? null,
        /* Leads marked with this provider, plus any marked with none — a lead
           filed before the provider was recorded still belongs to the only
           channel that could have filed it. */
        leads:
          (leadsByProvider.get(provider) ?? 0) +
          (seen.size === 1 ? (leadsByProvider.get('') ?? 0) : 0),
        problems: rowProblems,
      });
    }

    /* What setup can still offer: a connected mailbox with no channel. */
    const connectable = connected.filter(p => !seen.has(p));

    /*
     * The quiet one, and the reason it is account-level: `lead_autosend_enabled`
     * is one switch for the whole business. Leads file, nothing is answered,
     * and nothing anywhere reports an error.
     */
    const problems: InboxChannelProblem[] = [];
    if (profile && profile.lead_autosend_enabled === false) problems.push('replies_off');
    for (const row of channels) {
      for (const problem of row.problems) {
        if (!problems.includes(problem)) problems.push(problem);
      }
    }

    const state: InboxChannelState = channels.some(c => c.state === 'running')
      ? 'running'
      : channels.length > 0
        ? 'paused'
        : 'not_connected';

    return { channels, connectable, state, problems };
  } catch (err) {
    logger.warn({ err, userId }, 'Could not read the inbox channels; reporting them as absent');
    return empty;
  }
}

/**
 * Installing, pausing and removing a predefined automation agent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * An automation is an agent, so all four verbs are agent verbs. There is no
 * automation table, no second permission model and no bespoke lifecycle: the
 * owner can already see, pause and delete agents, and that is the whole reason
 * this is built as one.
 *
 *   install   create the `agents` row from the catalogue entry
 *   pause     `status: 'inactive'` — the runner selects on `status = 'active'`
 *   resume    back to `active`
 *   remove    soft delete, so the run history survives the decision
 *
 * Modelled on `enableInboxChannel`, which has been doing exactly this for the
 * mailbox channel since it shipped.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { agentRepository } from '@/lib/repositories/AgentRepository';
import { agentConfigurationRepository } from '@/lib/repositories/AgentConfigurationRepository';
import { businessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';
import {
  INBOX_CADENCE_RANGE,
  INBOX_STOP_AFTER_DEFAULT,
  INBOX_STOP_AFTER_RANGE,
} from '@/lib/business-os/leads/inboxProviders';
import {
  clampInterval,
  formatInterval,
  intervalFromCron,
  intervalMinutes,
  nextTickAfter,
  storageFor,
  type IntervalRange,
  type ScheduleInterval,
} from '@/lib/business-os/schedule/interval';
import {
  cadenceRangeOf,
  stopAfterRangeOf,
  CADENCE_INTERVAL,
  SCHEDULE_RANGE,
  STOP_RANGE,
} from '@/lib/business-os/schedule/ranges';
import { scheduleIntervalOf, stopAfterOf } from '@/lib/business-os/schedule/stored';
import { supabaseServer } from '@/lib/supabaseServer';

import {
  AUTOMATION_AGENT_TAG,
  CADENCE_CRON,
  automationAgentTag,
  planVersion,
  type AutomationAgent,
  type AutomationCadence,
} from './types';

const logger = createLogger({ module: 'BusinessOS', service: 'AutomationAgents' });

/**
 * `CADENCE_CRON` keyed by expression, for reading one back into an interval.
 *
 * Built from it rather than written out again, so a cadence added to the set
 * cannot be missing here — the same reason `cadenceForCron` is built that way.
 */
const NAMED_CADENCE_CRON: Record<string, ScheduleInterval> = Object.fromEntries(
  (Object.entries(CADENCE_CRON) as [AutomationCadence, string][]).map(([name, cron]) => [
    cron,
    CADENCE_INTERVAL[name],
  ])
);

/**
 * What an agent the owner WROTE may be set to: the same as every other agent.
 *
 * It had its own pair, on the reasoning that there is no catalogue entry to ask
 * — which was true and produced a fourth different control on one screen.
 */
const OWN_SCHEDULE_RANGE = SCHEDULE_RANGE;

/** One installed automation, as the owner's list needs it. */
export interface InstalledAutomation {
  agentId: string;
  /**
   * The catalogue id, for an agent adopted from an insight. Empty for others.
   *
   * Kept because the install check and the remove path look an agent up by it.
   * It is NOT what the list displays — see `name` below, which is resolved
   * here precisely so a surface never has to turn an id into words and never
   * shows a raw key when it cannot.
   */
  automationId: string;
  /**
   * Which doorway this agent came through.
   *
   * The list used to read one tag and show only the agents adopted from an
   * insight, so the mailbox channel — an agent by every measure, scheduled and
   * running — was invisible on the one screen that answers "what is working
   * for me". There is no third kind: an agent is either one we authored and the
   * owner adopted, or one they wrote themselves.
   */
  family: 'adopted' | 'mailbox' | 'own';
  /** The agent's name, in the owner's language. Never a translation key. */
  name: string;
  /**
   * WHAT IT DOES, in a sentence, in the owner's language.
   *
   * The list is seven narrow columns of facts — every, next, last, stops after
   * — and none of them answers "what is this agent FOR". The name is three or
   * four words and the Watches column is a noun phrase, so an owner opening an
   * agent's settings to change how often it runs had nothing telling them what
   * they were changing the cadence OF. It is shown at the top of the expanded
   * settings rather than in the table, where a sentence per row would bury the
   * numbers the table exists for.
   *
   * The catalogue's words for an agent we authored, the row's own column for a
   * mailbox channel or one the owner wrote — the same chain `name` uses, so a
   * family with no catalogue entry still says something.
   */
  description: string;
  /** What it watches, in the owner's language. Empty when there is nothing true to say. */
  watches: string;
  /**
   * How often it runs, in words.
   *
   * Resolved HERE rather than in the card, because the card could only turn a
   * NAMED cadence into words and the mailbox channel has none — it runs on
   * every fifteen minutes, which is a real schedule the ledger would have
   * shown as a dash. One answer, from the row that knows.
   */
  scheduleWords: string;
  /**
   * The plugins this agent's plan actually calls.
   *
   * Read off `plugins_required`, which is the column the runtime grants the run
   * — so it is what the agent can reach, not what we hope it reaches. Shown as
   * marks on the row because it is the one fact that says what an agent TOUCHES:
   * a Gmail logo for the mailbox it reads, our own for the part that writes to
   * the business's records.
   *
   * It also shows a stale grant honestly. A mailbox channel installed before the
   * CRM plugin was retired still carries `crm` here until its plan is refreshed,
   * and the row says so rather than showing what it ought to be.
   */
  plugins: string[];
  status: string;
  lastRun: string | null;
  nextRun: string | null;
  /*
   * What the owner chose, not the cron it became.
   *
   * The list has to say "every two weeks", and reading that back out of
   * `0 9 1,15 * *` means parsing cron in a React component to recover a word
   * we already had. Null where they took the default; the catalogue's own
   * `defaultCron` names it.
   */
  cadence: AutomationCadence | null;

  /**
   * How long it keeps trying before giving up on one person, in days.
   *
   * Stored on the row and spent by `planInputs`, and never exposed here, so
   * the list could not show it. The kind of gap Jest cannot see, because it
   * transforms rather than typechecks.
   */
  stopAfterDays: number | null;

  /**
   * Installed, and unable to run.
   *
   * A third state the list had no word for: an agent whose `requires` is not
   * met is neither running nor paused. The win-back agent sits here whenever
   * marketing sending is off or the business has no postal address — switched
   * on, scheduled, and refused at the first step every time.
   *
   * Carried with its reason, because "blocked" without "why" is a dead end and
   * every one of these is something the owner can fix.
   */
  blocked: boolean;
  requires: string | null;

  /**
   * Required plugins this owner has no working connection to. Empty normally.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A SECOND REASON TO BE "CANNOT RUN", carried the same way as the first.
   *
   * `requires` is a fact about the BUSINESS — marketing sending off, no postal
   * address. This is a fact about the OWNER'S ACCOUNT: the mailbox a mail agent
   * reads has been revoked, has expired, or was never linked. Both end in an
   * agent that is switched on and refused, which is the state the list already
   * draws, so it reuses it rather than inventing a fourth word.
   *
   * Named rather than reduced to a boolean, because the owner's next action is
   * to connect a specific thing and "needs a connection" sends them hunting.
   *
   * MISSING AND REVOKED ARE THE SAME ANSWER on purpose: the connection read
   * filters on `status = 'active'`, so an expired token reads as absent, and
   * the fix is identical either way.
   * ───────────────────────────────────────────────────────────────────────────
   */
  missingPlugins: string[];

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * IT TRIED, IT FAILED EVERY TIME, AND THE QUEUE GAVE UP.
   *
   * A different kind of "cannot run" from `blocked`. That one is a requirement
   * never met — marketing sending off, no postal address — and is true before
   * the agent ever starts. This one is an agent that WAS working and stopped.
   *
   * Null unless the most recent scheduled run was dead-lettered. One failure is
   * not this: the queue retries with increasing gaps, and only once it has
   * exhausted them has something really gone wrong. That is the moment worth
   * interrupting an owner for.
   *
   * Measured on a live account: a mailbox agent failed five times on an expired
   * Gmail token, was dead-lettered, and the list went on showing a green bar
   * and tomorrow's run. The owner's first clue would have been enquiries
   * quietly not arriving.
   * ───────────────────────────────────────────────────────────────────────────
   */
  stopped: StoppedAgent | null;

  /**
   * What the last settled run did — see `lastOutcomes`. Null only when the
   * read failed; an agent that has never run carries `state: 'never'`, which
   * is a fact worth showing rather than an absence to hide.
   */
  lastOutcome: AgentOutcome | null;

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THE SCHEDULE EDITOR OPENS ON, AND WHETHER IT MAY OPEN AT ALL.
   *
   * `schedule` null means this row's schedule says something a number and a
   * unit cannot: named weekdays, two times a day, the 15th of the month. The
   * prompt flow's builder emits exactly those, from a picker that shows the
   * days, so flattening one into "every N days" would discard a choice somebody
   * made — see `intervalFromCron`. The list draws no editor there and points at
   * the full builder instead, because a control that can only lose information
   * should not be drawn.
   *
   * The ranges come from whichever family owns the agent, resolved HERE for the
   * same reason the words are: only the server knows the catalogue, and
   * `win_back_quiet_clients` must never become hourly whichever surface is
   * asking.
   * ───────────────────────────────────────────────────────────────────────────
   */
  schedule: ScheduleInterval | null;
  /**
   * The stop rule as an interval, which `stopAfterDays` cannot always hold.
   *
   * Twelve hours rounds to one day in that field, and the mailbox offers
   * twelve. A control opened on the rounded copy and handed back only a NUMBER
   * could never change the unit: pressing "hours" on thirty days produced 720,
   * which was then read as 720 DAYS and clamped. Measured on a live channel.
   */
  stopAfter: ScheduleInterval | null;
  cadenceRange: IntervalRange;
  stopRange: IntervalRange;
}

/**
 * Why an agent stopped, as the EXECUTION LAYER already described it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS LAYER DOES NOT INTERPRET THE ERROR, AND MUST NOT START.
 *
 * The runner translates a terminal failure through `toUserFacing` — the
 * platform's one boundary between a technical issue and something a
 * non-technical owner reads — and stores the result on the run. Business OS
 * reads that and renders it.
 *
 * A first attempt put the classifying here: a `classifyAgentFailure` matching
 * on phrases like "connection has expired", four hundred lines from the
 * translator that already does it. Two translators drift, and the one further
 * from the runtime drifts first. It is also the wrong direction — execution is
 * the layer above, and the management layer reading its errors to guess at
 * meaning is the arrow this architecture spent the day removing.
 *
 * THREE FIELDS, NOT THE CALIBRATION MODEL. The translator also returns a
 * severity and a category belonging to the flow it was written for, and this
 * shape deliberately drops them: `will_auto_fix` is one of its real severities
 * and nothing is going to auto-fix an expired mail token. Borrowing a
 * translator is not the same as adopting its taxonomy.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface StoppedAgent {
  /** Short clause for the row. */
  title: string;
  /** One or two plain sentences. */
  message: string;
  /** The concrete next action, where the execution layer knew one. */
  whatToDo?: string;
  /**
   * The plugin whose connection failed, where that is what went wrong.
   *
   * The key, not the name — `connectPlugin` takes a key, and this is what
   * turns "reconnect it" from a sentence into a button. Absent for every
   * failure that is not a connection, which is most of them.
   */
  plugin?: string;
  /**
   * The provider's own error code, where the run produced one.
   *
   * Carried so `failureCategoryOf` can read the STRUCTURED half rather than
   * guess the category from prose. Absent on most failures, which is why that
   * function reads the message as well.
   */
  code?: string;
  /**
   * WHICH OF THE FOUR THINGS AN OWNER CAN DO about this — see
   * `failureCategoryOf`.
   *
   * `message` above is written for a developer, in English, by whichever layer
   * broke: a plugin definition, the pilot's wrapper, a BizQL refusal. Shown to
   * a business owner on a Hebrew dashboard it was unreadable AND unactionable,
   * and translating each variant one by one would chase an open-ended set of
   * strings that still said "Scatter-gather step step2" at the end of it.
   *
   * So the row carries a category and the SENTENCE is chosen from the owner's
   * dictionary: written once per language, never assembled from whatever a
   * plugin author typed.
   */
  category: FailureCategory;
  /** When the last attempt was made. */
  lastTriedAt: string;
}


/**
 * What an owner should DO about a failure — four answers, not fifty messages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OWNER IS NOT A DEVELOPER, AND THE MESSAGE WAS WRITTEN FOR ONE.
 *
 * A failure arrives as whatever the layer that broke happened to say:
 *
 *   Your Gmail connection has expired. Please reconnect in Settings…
 *   Scatter-gather step step2: all 2 items failed. First error: Scatter item 0…
 *   Could not chase that invoice: already chased within 7 days
 *   Non-retryable execution error at step "Scan the mailbox…" (unknown)
 *
 * All four were shown verbatim to a business owner, in English, on a Hebrew
 * dashboard. Translating them one by one is the wrong fix twice over: the
 * strings are open-ended — every plugin and every step type invents its own —
 * and even translated, "Scatter-gather step step2" tells the person reading it
 * nothing they can act on.
 *
 * There are only ever FOUR things an owner can do about a broken agent:
 *
 *   reconnect   an app has stopped accepting us. They re-authorise it.
 *   busy        a provider is rate-limiting or refusing for now. They wait;
 *               the agent retries on its own.
 *   data        something the agent needed was missing or refused — an address,
 *               a record, a permission. They fix it where they manage it.
 *   unknown     it is our fault. They do nothing, and should be told that
 *               rather than left to guess.
 *
 * So the category is resolved here and the SENTENCE is chosen from the owner's
 * dictionary, which means it is written once per language and never assembled
 * from whatever a plugin author typed.
 *
 * The technical text is not thrown away — `agent_executions.error_message`
 * keeps it verbatim for whoever is debugging. It is simply not what a business
 * owner is shown.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export type FailureCategory = 'reconnect' | 'busy' | 'data' | 'unknown';

export function failureCategoryOf(code: string | undefined, message: string): FailureCategory {
  const c = (code ?? '').toLowerCase();
  const m = (message ?? '').toLowerCase();

  /* The code first — it is the only structured thing we get. */
  if (c === 'auth_failed' || c === 'insufficient_permissions') return 'reconnect';
  if (c === 'quota_exceeded' || c === 'api_rate_limit') return 'busy';
  if (c === 'not_found' || c === 'invalid_request' || c === 'invalid_recipient') return 'data';

  /*
   * Then the words, because most failures carry no usable code at all — the
   * pilot's own wrapper errors and every BizQL refusal arrive as prose. Narrow
   * phrases only: a wrong guess here sends an owner to reconnect an app that
   * was never broken, so anything unrecognised stays `unknown`, which blames
   * nobody and asks nothing of them.
   */
  if (/reconnect|connection has expired|invalid credentials|unauthorized/.test(m)) return 'reconnect';
  if (/rate limit|too many requests|quota|try again later/.test(m)) return 'busy';
  if (/no email address|has no due date|no longer exists|not found|missing/.test(m)) return 'data';

  return 'unknown';
}

/**
 * The failure as the OWNER reads it: one sentence, in their language.
 *
 * The technical text stays on the object for anyone debugging from a response
 * body, but `message` — the field every surface renders — becomes the
 * category's sentence. Falls back to the original only if a dictionary is
 * missing the key, which is visible and fixable, where silently showing
 * "Scatter-gather step step2" to a business owner was neither.
 */
function ownerFacingFailure(
  stopped: StoppedAgent | undefined,
  say: (key: string) => string
): StoppedAgent | null {
  if (!stopped) return null;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE CATEGORY IS WORKED OUT HERE, BECAUSE NOTHING EVER WROTE IT.
   *
   * `failureCategoryOf` was written for exactly this, exported, and never
   * called. So `stopped.category` was always undefined, the key below was
   * always `automation.failure.undefined`, and this function always fell
   * through to the raw message — which comes from a plugin definition and is
   * English only.
   *
   * The result: an owner on a Hebrew dashboard read "We tried to use Gmail but
   * the connection isn't working. This usually means the access has expired.
   * Reconnect the app and try again." while three languages of correct copy sat
   * unused in the dictionaries.
   *
   * Derived on READ rather than stamped on write, deliberately: every failure
   * already recorded — ten days of them on the account that found this — gets
   * its sentence too, instead of only those failing from now on.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const category = stopped.category ?? failureCategoryOf(stopped.code, stopped.message);

  const key = `automation.failure.${category}`;
  const sentence = say(key);
  const localised = sentence && sentence !== key ? sentence : null;

  return {
    ...stopped,
    category,
    title: say('automation.failure.title') || stopped.title,
    message: localised ?? stopped.message,
    /*
     * DROPPED once the sentence above is the owner's own language.
     *
     * `what_to_do` comes from `toUserFacing`, which writes English and only
     * English ("Reconnect the app and try again."). Appending it to a Hebrew
     * sentence produced exactly the two-language paragraph this whole
     * translation path exists to prevent — and it is redundant anyway: every
     * category sentence already says what to do.
     */
    whatToDo: localised ? undefined : stopped.whatToDo,
  };
}

/**
 * Every automation agent this business has installed.
 *
 * Reads the shared tag rather than the per-agent one, so a list is one query
 * however many are installed.
 */
export async function installedAutomations(userId: string): Promise<InstalledAutomation[]> {
  const { data, error } = await agentRepository.findScheduled(userId);

  if (error) {
    logger.error({ err: error, userId }, 'Could not read this owner scheduled agents');
    return [];
  }

  /*
   * The owner's language, once for the whole list.
   *
   * `resolveName` reads the business profile on every call, which is fine for
   * one agent_name at install and an N+1 for a list.
   */
  const dictionary = await ownerDictionary(userId);
  const say = (key: string | undefined): string => (key ? (dictionary[key] ?? key) : '');

  const { automationById } = await import('./catalog');
  const { automationApplies } = await import('@/lib/business-os/gaps/automationApplies');
  const cache = new Map<string, Promise<boolean>>();

  /*
   * The dead-lettered runs, in ONE read for the whole list.
   *
   * Per-row would be an N+1 against a table that already carries every run
   * this account has ever queued. The same reason `ownerDictionary` is read
   * once above.
   *
   * Newest first and keyed by agent, so each agent keeps only its most recent
   * failure: an agent that broke in March and was fixed in April must not read
   * as broken because the March row is still there. A newer SUCCESS clears it,
   * which is why the status filter is not applied in the query.
   */
  const stoppedByAgent = await deadLetteredRuns((data || []).map(a => a.id));

  /* One read for the list, like the failures above — not per row. */
  const outcomeByAgent = await lastOutcomes((data || []).map(a => a.id));

  /*
   * One connection read for the whole list, like the dictionary above. Per row
   * would be an N+1 against a table every agent asks the same question of.
   */
  const { data: connections, error: connectionsError } = await (
    await import('@/lib/repositories/PluginConnectionRepository')
  ).pluginConnectionRepository.findActiveByUser(userId);

  if (connectionsError) {
    logger.warn(
      { err: connectionsError, userId },
      'Could not read plugin connections; reporting every agent as connected'
    );
  }

  const connected = new Set((connections || []).map(c => c.plugin_key));
  /*
   * FAILS OPEN, and the direction matters more than it looks.
   *
   * An unreadable `plugin_connections` leaves `connected` empty, and treating
   * empty as "nothing is connected" would mark EVERY agent on the dashboard
   * "Cannot run · Connect gmail" the moment that table blinked — every row red
   * over a transient read, with nothing actually wrong. The honest answer to
   * "we could not tell" is to say nothing, which is what an empty list of
   * missing plugins means. Same direction `missingPluginConnections` takes, for
   * the same reason.
   */
  const missingFor = (plugins: string[]): string[] =>
    connectionsError ? [] : plugins.filter(p => p !== 'business-os' && !connected.has(p));

  const rows = await Promise.all(
    (data || []).map(async (agent): Promise<InstalledAutomation> => {
      const config = (agent.agent_config ?? {}) as Record<string, Record<string, unknown>>;
      const adopted = config.business_os_automation;
      const mailbox = config.inbox_channel;
      const cron = (agent as { schedule_cron?: string | null }).schedule_cron ?? null;
      /*
       * The owner's interval, where they set one. Read for every family from
       * one reader, because an owner's answer to "how often" is now the same
       * answer whichever dialog asked it, and null on everything installed
       * before the question had a number in it.
       */
      const interval = scheduleIntervalOf(config);
      /* The exact stop rule, for the same reason: the control needs the unit
         the owner chose, not the day count it rounds to. */
      const stopInterval = stopAfterOf(config);

      const base = {
        agentId: agent.id,
        plugins: ((agent as { plugins_required?: string[] | null }).plugins_required ?? []).filter(
          /* The runtime is granted what the plan calls; an empty entry is noise
             on a row, not information. */
          (p): p is string => typeof p === 'string' && p.length > 0
        ),
        /*
         * ───────────────────────────────────────────────────────────────────
         * A SCHEDULE SWITCHED OFF IS A PAUSED AGENT, WHATEVER `status` SAYS.
         *
         * The card was handed `status` alone, so an agent the scheduler can
         * never claim — `schedule_enabled: false` with `status: 'active'` —
         * arrived looking perfectly healthy. No badge, no warning, and a row
         * that promised a next run it would never take.
         *
         * Measured on a live account on 2026-11-10: a spreadsheet agent in
         * exactly that state had not run since 5 November and nothing on any
         * surface said so. Its owner pressed resume and Run now in turn,
         * both reported success, and the agent stayed invisible and idle.
         *
         * Reported as `inactive` because that is what it IS to an owner: off,
         * and restartable by the control that says resume. The two ways an
         * agent can be switched off are one fact to the person reading the
         * list, and splitting them would ask them to learn our column names.
         * ───────────────────────────────────────────────────────────────────
         */
        status:
          (agent as { schedule_enabled?: boolean }).schedule_enabled === false
            ? 'inactive'
            : agent.status,
        lastRun: (agent as { last_run?: string | null }).last_run ?? null,
        nextRun: (agent as { next_run?: string | null }).next_run ?? null,
      };

      /*
       * ON `base`, SO EVERY FAMILY REPORTS IT.
       *
       * A revoked mailbox is not a problem only catalogue agents can have — the
       * mailbox CHANNEL is the one it has actually happened to, and an agent the
       * owner wrote themselves can call any plugin they connected. Computing it
       * here from `plugins_required` means the answer comes from the column the
       * runtime actually grants the run from, for all three families, rather
       * than from a catalogue entry two of them do not have.
       */
      const missingPlugins = missingFor(base.plugins);

      /* ── adopted from an insight ───────────────────────────────────────── */
      if (adopted?.id) {
        /*
         * ─────────────────────────────────────────────────────────────────────
         * A READ THAT REPAIRS, AND THE ONLY PLACE THAT CAN.
         *
         * `repointToConnectedMailbox` moves a provider-variant install onto the
         * mailbox the owner actually connected. The trigger has to live here
         * because NOTHING ELSE RUNS when an owner's connections change: the
         * install seam fires once and the available list never offers an agent
         * that is already installed, so a variant agent whose mailbox went away
         * would otherwise run against a dead connection for ever, reporting
         * "Cannot run · connect <the mailbox they left>".
         *
         * Defensible as a write inside a read because it is idempotent, costs
         * nothing in the normal case (two array lookups and no query — it
         * returns before any write unless the install is genuinely mispointed
         * AND a sibling mailbox is connected), and the alternative is an agent
         * that silently does nothing. Concurrent dashboard loads converge on
         * the same answer.
         * ─────────────────────────────────────────────────────────────────────
         */
        const repointed = await repointToConnectedMailbox(
          userId,
          agent as { id: string; agent_config?: Record<string, unknown> | null },
          String(adopted.id),
          connected
        );

        const id = repointed?.id ?? String(adopted.id);
        const automation = automationById(id);

        /*
         * ─────────────────────────────────────────────────────────────────────
         * AND THE PLAN ITSELF, FOR THE SAME REASON.
         *
         * `refreshPlan` ran on the INSTALL path only, so an agent already
         * installed and running never picked up a corrected plan. Its own
         * comment names the cost — "the first version of the invoice chaser
         * would have emailed the same client every morning; an install made
         * before that fix would still be doing it" — and then left the fix
         * reachable only by re-installing, which no owner has a reason to do.
         *
         * Found on 2026-11-10 on a bounded draft check: a reply agent declined
         * to answer a client because of a draft written two months earlier,
         * and correcting the catalogue would not have reached a single
         * running install.
         *
         * Safe here for the reasons the repoint above is safe: it compares a
         * fingerprint and returns before any query when they match, so the
         * normal case costs nothing, concurrent dashboard loads converge, and
         * only `pilot_steps` moves — the cadence, the status and everything
         * else the owner chose are untouched.
         * ─────────────────────────────────────────────────────────────────────
         */
        /*
         * Not after a repoint: that IS a plan move, and it has just written
         * the variant's own steps. Refreshing on top writes the same plan a
         * second time on the same read.
         */
        if (automation && !repointed) {
          /* A repair must never break the read it rides on. `refreshPlan`
             handles its own write failures, but anything unexpected here
             would take the whole agent list down with it — and a stale plan
             is a far smaller problem than a dashboard that will not load. */
          try {
            await refreshPlan(
              userId,
              agent as { id: string; agent_config?: Record<string, unknown> | null },
              automation
            );
          } catch (err) {
            logger.warn({ err, userId, automationId: id }, 'Could not refresh the installed plan');
          }
        }

        /*
         * ─────────────────────────────────────────────────────────────────────
         * WHAT IS IN FORCE, NOT WHAT WAS TYPED.
         *
         * Cadence and stop-after are stored as the owner's EXPLICIT choice and
         * left null when they made none — and the runtime then falls back to
         * the catalogue rather than running never or for ever. `planInputs`
         * spends `defaultStopAfterDays`, and the install writes `defaultCron`
         * regardless.
         *
         * So a null here never meant "none". The live account showed both
         * halves of the cost: an agent genuinely scheduled `0 9 1,15 * *` whose
         * "Every" column read "—", and one whose plan spends a 60-day bound
         * while "Stops after" read "—". An owner reads that dash as "no limit"
         * or "nobody knows", and it was writing to their clients fortnightly
         * and giving up after two months.
         * ─────────────────────────────────────────────────────────────────────
         */
        const cadence =
          (adopted.cadence as AutomationCadence | null) ??
          cadenceForCron(cron ?? automation?.defaultCron ?? null);

        const stopAfterDays =
          (adopted.stopAfterDays as number | null) ?? automation?.defaultStopAfterDays ?? null;

        const requires = automation?.requires ?? null;

        /*
         * RE-ASKED AFTER A REPOINT, because `missingPlugins` above was computed
         * from the `plugins_required` column as it was READ — which the repoint
         * has just replaced. Reporting the stale answer would tell an owner we
         * had only now moved onto Outlook that they must connect Gmail: the
         * exact message the repair exists to stop, surviving the repair itself.
         *
         * The row reports the NEW grant too (`plugins` below), because that is
         * what the database now holds and what the next run will be given. A
         * row describing the grant it was loaded with would be describing an
         * agent that no longer exists.
         */
        const grants = repointed ? repointed.pluginsRequired : base.plugins;
        const missing = repointed ? missingFor(grants) : missingPlugins;

        /*
         * EITHER REASON BLOCKS IT. A business requirement never met, or a
         * plugin the plan calls with no live connection — both mean switched
         * on and refused at the first step, which is the one thing the owner
         * needs to know.
         */
        const blocked =
          missing.length > 0 ||
          (requires ? !(await automationApplies(userId, automation as never, cache)) : false);

        return {
          ...base,
          plugins: grants,
          automationId: id,
          family: 'adopted',
          /* The catalogue's words, or the row's own name — never the raw id,
             which is what the list showed before these were resolved here. */
          name: say(automation?.nameKey) || agent.agent_name,
          description: say(automation?.descriptionKey) || agent.description || '',
          watches: say(automation?.watchesKey),
          /* The interval first, because it is what the agent actually runs
             on. Only then the named cadence, for every install made before
             intervals existed. */
          scheduleWords: interval
            ? scheduleInWords(cron, say, interval)
            : cadence
              ? say(`automation.cadence.${cadence}`)
              : scheduleInWords(cron, say),
          cadence,
          stopAfterDays,
          blocked,
          requires,
          missingPlugins: missing,
          stopped: ownerFacingFailure(stoppedByAgent.get(agent.id), say),
          lastOutcome: outcomeByAgent.get(agent.id) ?? { state: 'never', at: null, found: null, foundAction: null, actedOn: null },
          /*
           * The stored interval, or the one its cron means.
           *
           * `allowNamedCadence` is granted here and nowhere else: an adopted
           * agent was offered the word "weekly" and never the word "Monday",
           * so reading `0 9 * * 1` back as seven days keeps the promise it was
           * installed under. An agent the owner built themselves chose that
           * expression in a builder showing the days, and may not be
           * reinterpreted.
           */
          schedule:
            interval ?? intervalFromCron(cron, { allowNamedCadence: NAMED_CADENCE_CRON }),
          /*
           * The exact interval, or the day count THIS BRANCH resolved — which
           * already falls back to the catalogue's default.
           *
           * Reading only the raw config was a regression: `stopAfterDays` is
           * written as null whenever the owner took the default, so every agent
           * installed without touching that question lost its stop control in
           * the editor. The row has said the right number since it was added;
           * the interval has to follow the same chain rather than invent a
           * second one.
           */
          stopAfter:
            stopInterval ??
            (stopAfterDays ? { every: stopAfterDays, unit: 'days' as const } : null),
          cadenceRange: SCHEDULE_RANGE,
          stopRange: STOP_RANGE,
        };
      }

      /* ── the mailbox channel ───────────────────────────────────────────── */
      if (mailbox?.provider) {
        return {
          ...base,
          automationId: '',
          family: 'mailbox',
          /* Its own name, which setup already wrote in the owner's language. */
          name: agent.agent_name,
          /* Likewise its own: there is no catalogue entry for a channel whose
             subject line was measured from this owner's own mail. */
          description: agent.description || '',
          /*
           * The mailbox and subject it watches, which setup measured from the
           * owner's own mail. Exactly the sentence the channel card shows, so
           * the two surfaces cannot describe one agent differently.
           */
          watches: String(mailbox.watching ?? say('automation.watches.mailbox')),
          scheduleWords: scheduleInWords(cron, say, interval),
          /*
           * The owner's two choices, same as an adopted agent's.
           *
           * Both read with the catalogue fallback the adopted branch uses, for
           * the same reason: absent never meant "none". A channel installed
           * before these were asked still runs every fifteen minutes and still
           * bounds its window — the defaults the floor and the setup date were
           * choosing silently — so the ledger must say so rather than show a
           * dash about an agent that is doing both.
           *
           * `cadence` stays null: the mailbox cadences are minutes, and this
           * field carries the ADOPTED agents' named set. The words are in
           * `scheduleWords`, resolved from the cron either way.
           */
          cadence: null,
          stopAfterDays:
            typeof mailbox.stopAfterDays === 'number'
              ? mailbox.stopAfterDays
              : INBOX_STOP_AFTER_DEFAULT,
          /* The mailbox channel is the family a revoked Gmail has actually
             happened to, so `false` was the wrong constant here. No business
             `requires` applies to it, but a dead connection very much does. */
          blocked: missingPlugins.length > 0,
          missingPlugins,
          requires: null,
          stopped: ownerFacingFailure(stoppedByAgent.get(agent.id), say),
          lastOutcome: outcomeByAgent.get(agent.id) ?? { state: 'never', at: null, found: null, foundAction: null, actedOn: null },
          /* No named-cadence lookup: the channel's four were all minutes or an
             hour, and every one of those is a form `intervalFromCron` reads
             exactly. */
          schedule: interval ?? intervalFromCron(cron),
          /* Same fallback as the day count above: a channel installed before
             the question was asked still bounds its window, by the default. */
          stopAfter:
            stopInterval ?? { every: INBOX_STOP_AFTER_DEFAULT, unit: 'days' as const },
          cadenceRange: SCHEDULE_RANGE,
          stopRange: STOP_RANGE,
        };
      }

      /* ── an agent the owner wrote themselves, put on a schedule ────────── */
      return {
        ...base,
        automationId: '',
        family: 'own',
        name: agent.agent_name,
        /* Whatever they wrote when they built it, which may be nothing. */
        description: agent.description || '',
        watches: '',
        scheduleWords: scheduleInWords(cron, say, interval),
        cadence: cadenceForCron(cron),
        stopAfterDays: null,
        /* An agent the owner wrote can call any plugin they connected, so it
           can lose one the same way. No catalogue `requires` to check. */
        blocked: missingPlugins.length > 0,
        missingPlugins,
        requires: null,
        stopped: ownerFacingFailure(stoppedByAgent.get(agent.id), say),
        lastOutcome: outcomeByAgent.get(agent.id) ?? { state: 'never', at: null, found: null, foundAction: null, actedOn: null },
        /*
         * No named-cadence lookup, and this is the case it exists to protect.
         * `0 9 * * 1` here is a Monday somebody picked, not the word "weekly" —
         * so it comes back null and the row offers no inline editor, pointing
         * at the builder that can express it.
         */
        schedule: interval ?? intervalFromCron(cron),
        /*
         * Null here, and not a default, because an agent the owner WROTE has no
         * end-of-life concept. The bound belongs to a committed plan's find,
         * and this family has no committed plan — a control offered here would
         * store a number nothing ever reads, which is the defect the advisor
         * card's threshold stepper already had. `stopAfterDays` on this branch
         * is null for the same reason.
         */
        stopAfter: stopInterval,
        cadenceRange: SCHEDULE_RANGE,
        stopRange: STOP_RANGE,
      };
    })
  );

  return rows;
}

/**
 * The owner's translation dictionary, read once.
 *
 * Falls back to English rather than to the key: a list is read at a glance, and
 * an English row among Hebrew ones is a visible seam the owner can report,
 * where a bare key looks like a crash.
 */
async function ownerDictionary(userId: string): Promise<Record<string, string>> {
  try {
    const { data: profile } = await businessProfileRepository.findByUserId(userId);
    const language = (profile?.language ?? 'en') as 'en' | 'he' | 'es';

    const [{ en }, { he }, { es }] = await Promise.all([
      import('@/lib/business-os/translations/en'),
      import('@/lib/business-os/translations/he'),
      import('@/lib/business-os/translations/es'),
    ]);

    return (({ en, he, es } as Record<string, Record<string, string>>)[language] ??
      en) as Record<string, string>;
  } catch (err) {
    logger.warn({ err, userId }, 'Could not read the owner language; the list will read in English');
    const { en } = await import('@/lib/business-os/translations/en');
    return en as Record<string, string>;
  }
}

/**
 * A cron expression in words, for a schedule that has no name.
 *
 * The named cadences cover what an owner CHOOSES on an install dialog. The
 * mailbox channel runs every fifteen minutes, which is a real schedule nobody
 * chose from a list — and the ledger showed it as a dash, which reads as
 * "nobody knows" about an agent that runs four times an hour.
 *
 * (Spelled out in words on purpose: a cron expression beginning with a star and
 * a slash closes a block comment, which has now broken this file once and
 * `featureFlags.ts` once.)
 *
 * Only the two shapes the platform actually writes are given words. Anything
 * else returns the expression itself: a cron on screen is obviously raw and
 * gets reported, where an invented phrase would be believed.
 */
function scheduleInWords(
  cron: string | null,
  say: (key: string) => string,
  /*
   * The owner's interval, where there is one, and it is read FIRST.
   *
   * An interval agent carries a cron that states its time of day and nothing
   * about its cadence, so describing it from the expression alone calls a
   * three-day agent "every day". The agent would be running correctly and the
   * list would be lying about it, which is the worse of the two failures: an
   * owner checks the list to find out what their business is doing.
   */
  interval?: ScheduleInterval | null
): string {
  if (interval) {
    const words = say(`automation.every_n_${interval.unit}`);
    return words.includes('{n}')
      ? words.replace('{n}', String(interval.every))
      : `${words} ${interval.every}`;
  }

  if (!cron) return '';

  const everyNMinutes = cron.match(/^\*\/(\d+) \* \* \* \*$/);
  if (everyNMinutes) {
    const words = say('automation.cadence.every_n_minutes');
    return words.includes('{n}') ? words.replace('{n}', everyNMinutes[1]) : `${words} ${everyNMinutes[1]}`;
  }

  const named = cadenceForCron(cron);
  if (named) return say(`automation.cadence.${named}`);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ASK THE READER WE ALREADY HAVE, BEFORE GIVING UP.
   *
   * This fell straight to `return cron`, and the note above justified it: a raw
   * expression on screen is obviously wrong and gets reported, where an
   * invented phrase would be believed. Sound reasoning — and it was answering
   * the wrong question, because `intervalFromCron` can read far more shapes
   * than the two named above and was never consulted.
   *
   * So an owner watching their quotes agent saw a raw three-hourly expression
   * sitting in the `Every` column, in a table of plain English, about a
   * schedule the platform itself had written. `intervalFromCron` reads that
   * shape today and returns three hours; it simply was not asked.
   *
   * (The expression is not quoted here on purpose: a cron step contains the
   * two characters that close a block comment, and writing one inside this
   * note ends it early. It cost a build.)
   *
   * The protection survives intact: this returns null for anything it cannot
   * describe EXACTLY — a 25-minute step that drifts across the hour, a named
   * weekday, a ranged minute — and those still fall through to the raw cron,
   * still obviously wrong, still reported. Nothing is invented; a reader that
   * already exists is simply used.
   * ───────────────────────────────────────────────────────────────────────────
   */
  /* The same reading the editor is given — see `schedule` above, where
     `allowNamedCadence` is granted for the same reason: an adopted agent was
     offered a cadence word, so reading its expression back as that cadence
     keeps the promise it was installed under. */
  const derived = intervalFromCron(cron, { allowNamedCadence: NAMED_CADENCE_CRON });
  if (derived) {
    const words = say(`automation.every_n_${derived.unit}`);
    return words.includes('{n}')
      ? words.replace('{n}', String(derived.every))
      : `${words} ${derived.every}`;
  }

  return cron;
}

/**
 * The named cadence a cron expression means, or null if it is not one of ours.
 *
 * `CADENCE_CRON` read backwards, built from it rather than written out again so
 * the two cannot drift. Null for anything hand-edited: inventing a name for a
 * cron nobody offered would be worse than the dash, because it would be wrong
 * rather than merely silent.
 */
function cadenceForCron(cron: string | null): AutomationCadence | null {
  if (!cron) return null;

  const match = (Object.entries(CADENCE_CRON) as [AutomationCadence, string][])
    .find(([, expression]) => expression === cron);

  return match?.[0] ?? null;
}

/**
 * What a plan needs handed to it at run time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * One value today: the owner's end of life, as the NEGATIVE day offset its
 * filters spend. Negative because every bound looks backwards — "nothing older
 * than this" is `gte today - N` — and doing the arithmetic here rather than in
 * five committed JSON files means a plan never carries a sign it could get
 * wrong.
 *
 * Falls back to the catalogue's default rather than the row's null, so an
 * install made before a default changed picks the new one up. The row records
 * a CHOICE; absence is not a choice.
 *
 * Read by the runner, which passes it as `inputValues`. `ExecutionContext`
 * resolves a whole-string `{{stop_after_days}}` to the value itself rather
 * than to its text, so the filter receives a number.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function planInputs(
  automation: AutomationAgent,
  agentConfig?: Record<string, unknown> | null
): Record<string, number> {
  const stored = (agentConfig?.business_os_automation as { stopAfterDays?: number | null } | undefined)
    ?.stopAfterDays;

  /*
   * AN AGENT MAY HAVE NO STOP RULE, and then it must not be handed one.
   *
   * `.includes` on an absent list throws, and `-Math.abs(undefined)` is NaN —
   * which a filter would spend as a date offset and silently match nothing.
   * The spreadsheet importer is the first entry with no stop rule: a row has
   * no age, so there is nothing for a cut-off to measure.
   */
  const days =
    typeof stored === 'number' && (automation.stopAfterChoices ?? []).includes(stored)
      ? stored
      : automation.defaultStopAfterDays;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * HOW FAR BACK A RUN LOOKS FOR SOMETHING NEW, IN WHOLE DAYS.
   *
   * A different question from the stop rule, and the two must not be confused.
   * `stop_after_days` is how much HISTORY to consider — the owner's choice.
   * This is how much of it is NEW since the last run, which is not a choice at
   * all: it follows from the cadence.
   *
   * IT HAS TO TRACK THE CADENCE OR REPLIES FALL BETWEEN RUNS. An agent set to
   * weekly with a two-day window never sees the five days in between, and the
   * failure is silent — the owner gets drafts for some replies and nothing for
   * others, with no way to tell which were missed.
   *
   * `+ 1` is a day of slack for a run that failed or a deploy that paused the
   * sweep. The cost is that a reply can be seen on two consecutive runs; the
   * plan's own `already_handled` outcome is what catches the second pass.
   *
   * A MINIMUM OF 2, because a provider's relative window is coarse:
   * `newer_than:1d` is answered against calendar boundaries rather than a
   * rolling 24 hours, so an agent running at 09:00 can miss what arrived at
   * 23:00 the night before.
   *
   * Positive, unlike the stop rule. This one is spent as a provider search
   * fragment (`newer_than:2d`), not as a date offset, and a minus sign there
   * makes a query no mailbox will answer.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const interval = scheduleIntervalOf(agentConfig ?? undefined) ?? NAMED_CADENCE_CRON[automation.defaultCron];

  const scanDays = interval
    ? Math.max(2, Math.ceil(intervalMinutes(interval) / (60 * 24)) + 1)
    : /* No readable schedule: two days, the same floor, rather than a guess at
         a cadence nobody declared. */
      2;

  return {
    ...(typeof days === 'number' ? { stop_after_days: -Math.abs(days) } : {}),
    scan_days: scanDays,
  };
}

/**
 * One catalogue key, in the owner's language, for a column that has no other
 * way to be read.
 *
 * Falls back to the key itself rather than to English: a key on screen is
 * obviously wrong and gets reported, whereas silently English copy on a Hebrew
 * account looks like a translation nobody got round to.
 */
async function resolveName(userId: string, key: string): Promise<string> {
  try {
    const { data: profile } = await businessProfileRepository.findByUserId(userId);
    const language = (profile?.language ?? 'en') as 'en' | 'he' | 'es';

    /* Imported here rather than at module scope: three dictionaries are a
       large import for a file the runtime loads on every tick. */
    const [{ en }, { he }, { es }] = await Promise.all([
      import('@/lib/business-os/translations/en'),
      import('@/lib/business-os/translations/he'),
      import('@/lib/business-os/translations/es'),
    ]);

    const dictionary = ({ en, he, es } as Record<string, Record<string, string>>)[language] ?? en;

    return dictionary?.[key] ?? key;
  } catch (err) {
    logger.warn({ err, userId, key }, 'Could not resolve the agent name; storing the key');
    return key;
  }
}

/**
 * The most recent scheduled run per agent, where that run was dead-lettered.
 *
 * Returns nothing for an agent whose newest run succeeded, even if an older one
 * failed — the question is "is it broken NOW", and a later success answers it.
 * A read that fails returns nothing at all rather than guessing: a list that
 * wrongly reports a working agent as stopped sends an owner to fix something
 * that is not broken.
 */
/**
 * What an agent actually DID on its last settled run.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The list could say when an agent ran and whether it was stopped, and nothing
 * about what the run was FOR. "Checked yesterday" is not news an owner can use;
 * "found 4 overdue invoices and wrote to 1 client" is.
 *
 * The pilot already records it. `workflow_executions.execution_results.items[]`
 * carries one entry per step with its `action` and `itemCount`, so the counts
 * exist for every run ever made — nothing new has to be captured and no
 * backfill is needed.
 *
 * TWO NUMBERS, NOT A TRANSCRIPT. A plan is a find followed by something done
 * per item, so the honest summary is what it found and what it acted on. Steps
 * are not listed one by one: an owner is being told whether the agent earned
 * its morning, not debugged.
 *
 * `friendlyMessage` on those items is deliberately NOT used. It is written for
 * a developer, in English only, and carries bugs an owner should never meet —
 * a live account has "Found 4 invoicess" stored on it. The noun is resolved
 * from the action in the owner's own language instead.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface AgentOutcome {
  /** `never` is its own state: an agent that has not run is not a success. */
  state: 'ok' | 'failed' | 'never';
  at: string | null;
  /** What the finding step saw, and which action did the finding. */
  found: number | null;
  foundAction: string | null;
  /** How many of those it then acted on. Null when the plan never scatters. */
  actedOn: number | null;
}

/**
 * A step that looks for things, as opposed to one that does something.
 *
 * The prefix list is the whole definition, so a missing verb silently costs an
 * agent its sentence: `read_range` was absent, so a spreadsheet import that
 * read three rows reported "ran with nothing to report" — the one outcome an
 * owner reads as a wasted morning.
 *
 * Prefixes rather than a list of actions, because plugins add verbs faster
 * than anyone updates a catalogue. Anything that only ever LOOKS belongs here;
 * anything that writes, sends or charges must not, or the row will claim the
 * agent found what it actually did.
 */
function isFindingStep(action: string): boolean {
  return /^(find|search|list|get|fetch|read|scan|query)_/.test(action);
}

export async function lastOutcomes(agentIds: string[]): Promise<Map<string, AgentOutcome>> {
  const out = new Map<string, AgentOutcome>();
  if (agentIds.length === 0) return out;

  const { data, error } = await supabaseServer
    .from('workflow_executions')
    .select('agent_id, status, created_at, execution_results')
    .in('agent_id', agentIds)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    /* The list is still worth rendering without it. */
    logger.error({ err: error }, 'Could not read what the last runs did');
    return out;
  }

  for (const run of data ?? []) {
    const id = run.agent_id as string;
    if (out.has(id)) continue;

    const status = String(run.status ?? '');
    /* Same rule as `deadLetteredRuns`: a run still in flight says nothing
       about whether the agent works, so it is skipped rather than counted. */
    if (status !== 'completed' && status !== 'failed') continue;

    const items = ((run.execution_results as { items?: unknown[] } | null)?.items ?? []) as Array<{
      action?: string;
      itemCount?: number;
      status?: string;
    }>;

    let found: number | null = null;
    let foundAction: string | null = null;
    let actedOn: number | null = null;

    for (const item of items) {
      const action = String(item.action ?? '');
      const count = typeof item.itemCount === 'number' ? item.itemCount : null;
      if (count === null) continue;

      if (action === 'scatter_gather') {
        actedOn = count;
      } else if (isFindingStep(action)) {
        /* The LARGEST find wins. A plan often looks up supporting data —
           services, contacts — beside the thing it is really about, and the
           biggest set is the one the run was for. */
        if (found === null || count > found) {
          found = count;
          foundAction = action;
        }
      }
    }

    out.set(id, {
      state: status === 'completed' ? 'ok' : 'failed',
      at: (run.created_at as string) ?? null,
      found,
      foundAction,
      actedOn,
    });
  }

  return out;
}

export async function deadLetteredRuns(
  agentIds: string[]
): Promise<Map<string, StoppedAgent>> {
  const out = new Map<string, StoppedAgent>();
  if (agentIds.length === 0) return out;

  const { data, error } = await supabaseServer
    .from('agent_executions')
    .select('agent_id, status, result, created_at')
    .in('agent_id', agentIds)
    .eq('execution_type', 'scheduled')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    logger.error({ err: error }, 'Could not read scheduled run outcomes');
    return out;
  }

  const seen = new Set<string>();

  for (const run of data ?? []) {
    const id = run.agent_id as string;
    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE NEWEST SETTLED RUN, NOT SIMPLY THE NEWEST ROW.
     *
     * This took the newest row of any kind and gave up unless it was `failed`.
     * A run in flight is `pending` or `processing` — and `markFailed(retry)`
     * puts a row BACK to `pending` for its backoff — so for the whole of every
     * retry window the newest row was not a failure, the agent reported
     * nothing at all, and the card showed a clean line.
     *
     * An owner watched a mailbox agent that had failed every run for ten days
     * go quiet in the UI the moment a retry started, and reasonably read that
     * as fixed. The failure had not gone anywhere; the row in front of it had.
     *
     * A run that has not finished says nothing about whether the agent works,
     * so it is skipped rather than treated as good news. The first row here
     * that reached an OUTCOME is the one that counts: `completed` clears the
     * failure, `failed` reports it.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (run.status !== 'failed' && run.status !== 'completed') continue;

    if (seen.has(id)) continue;
    seen.add(id);

    if (run.status !== 'failed') continue;

    /*
     * The issue the runner wrote. Absent on a run that failed before this
     * existed, and on one whose terminal write did not land — in which case
     * the row says nothing rather than inventing a reason from the raw error,
     * which is the interpreting this layer must not do.
     */
    const failure = (run.result as { failure?: Record<string, unknown> } | null)?.failure;
    if (!failure || typeof failure.message !== 'string') continue;

    out.set(id, {
      title: typeof failure.title === 'string' ? failure.title : '',
      message: failure.message,
      whatToDo: typeof failure.what_to_do === 'string' ? failure.what_to_do : undefined,
      plugin: typeof failure.plugin === 'string' ? failure.plugin : undefined,
      /* The provider's own code, where the run produced one. Read here so the
         category can be derived from the structured half rather than guessed
         from prose. */
      code: typeof failure.code === 'string' ? failure.code : undefined,
      lastTriedAt: run.created_at as string,
    });
  }

  return out;
}

/** The install of one automation, if this business has it. */
async function findInstall(userId: string, automation: AutomationAgent) {
  const { data } = await agentRepository.findByTag(userId, automationAgentTag(automation.id));
  /* First rather than single: `installAutomation` is what keeps there being
     one, and a read is the wrong place to throw over a duplicate it could
     simply report. */
  return data?.[0] ?? null;
}

/**
 * Point a variant install at the mailbox the owner actually has.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AN AGENT THAT DOES NOTHING IS THE PROBLEM, NOT A SECOND AGENT.
 *
 * Refusing the duplicate (see `findGroupInstall`) leaves one row — and one row
 * pointed at the wrong mailbox is just as useless as two. The owner installs
 * the Gmail agent, their Gmail connection later dies and they move the business
 * to Outlook, and now a healthy-looking agent runs every morning against a
 * mailbox it cannot open. The dashboard says "Cannot run · connect google-mail",
 * which is advice to go back to the mailbox they deliberately left.
 *
 * There is no ambiguity to resolve here, so nothing is asked. Exactly one mail
 * plugin is connected and exactly one agent wants a mailbox; the only sensible
 * answer is the one the owner already chose by connecting it. Asking would be
 * a question about plumbing put to somebody who wanted their replies drafted.
 *
 * ALL THREE FACTS MOVE TOGETHER, or the repair is worse than the fault:
 *
 *   · the plan        — the steps that call `outlook` rather than `google-mail`
 *   · the GRANT       — `plugins_required`, which is what the runtime hands the
 *                       run. Move the plan alone and the agent calls Outlook
 *                       actions holding a Gmail grant, which fails inside a
 *                       cron where nobody is watching
 *   · the TAG         — how the install is found again. Leave it and
 *                       `findInstall` still reports the old variant, so the next
 *                       install would try to migrate it back
 *
 * Returns the automation the row now carries, or null when nothing moved.
 * NOTHING MOVES in the two cases that look similar and are not: the installed
 * variant's own mailbox is connected (correct already), or NO mailbox in the
 * group is (genuinely blocked, and "connect one" is then the right message).
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function repointToConnectedMailbox(
  userId: string,
  agent: { id: string; agent_config?: Record<string, unknown> | null },
  installedId: string,
  connected: Set<string>
): Promise<AutomationAgent | null> {
  const { AUTOMATION_AGENTS } = await import('./catalog');

  const current = AUTOMATION_AGENTS.find(a => a.id === installedId);
  if (!current?.variantGroup || !current.variantPlugin) return null;

  /* Already pointed at a mailbox the owner has. */
  if (connected.has(current.variantPlugin)) return null;

  /*
   * An EMPTY connection set means the read failed, not that nothing is
   * connected — `installedAutomations` logs exactly that and fails open. A
   * migration decided from it would re-point every variant agent on the
   * account over a transient read, so there is nothing to find here anyway:
   * no sibling can look connected either. Stated rather than relied on.
   */
  if (connected.size === 0) return null;

  const target = AUTOMATION_AGENTS.find(
    a =>
      a.variantGroup === current.variantGroup &&
      a.id !== current.id &&
      a.variantPlugin !== undefined &&
      connected.has(a.variantPlugin)
  );
  if (!target) return null;

  const config = (agent.agent_config ?? {}) as Record<string, unknown>;
  const installedConfig = (config.business_os_automation ?? {}) as Record<string, unknown>;

  const { error: planError } = await agentRepository.updatePilotSteps(
    agent.id,
    userId,
    target.steps
  );

  if (planError) {
    /*
     * Not fatal and deliberately not partial: the grant and the tag are left
     * alone, so the agent stays exactly the mispointed-but-coherent thing it
     * already was and the next dashboard load tries again. Moving the grant
     * after a failed plan write would produce the one state worse than this.
     */
    logger.error(
      { err: planError, userId, agentId: agent.id, from: current.id, to: target.id },
      'Could not move the plan to the connected mailbox; leaving the install as it was'
    );
    return null;
  }

  const { error } = await agentRepository.update(agent.id, userId, {
    plugins_required: target.pluginsRequired,
    tags: [AUTOMATION_AGENT_TAG, automationAgentTag(target.id)],
    agent_config: {
      ...config,
      business_os_automation: {
        ...installedConfig,
        id: target.id,
        planVersion: planVersion(target.steps),
      },
    },
  });

  if (error) {
    logger.error(
      { err: error, userId, agentId: agent.id, from: current.id, to: target.id },
      'Moved the plan but could not move the grant and tag; the agent is mid-migration'
    );
    return null;
  }

  logger.info(
    { userId, agentId: agent.id, from: current.id, to: target.id, mailbox: target.variantPlugin },
    'Re-pointed the automation at the mailbox the owner has connected'
  );

  return target;
}

/**
 * The install that already answers this request, counting provider variants.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "WHAT IF THE OWNER ADDS BOTH — GMAIL AND OUTLOOK?"
 *
 * `installAutomation`'s own rule already answers it: two rows for one
 * automation "would both run on the same schedule, and the owner would have no
 * way to tell which of two identical entries to stop". The mail variants are
 * the sharpest possible case of that, because the entries are not merely
 * similar — they share all three translation keys, so BOTH appear in the
 * owner's agent list under exactly the same name and the same description.
 * Nothing on the screen distinguishes them. Stopping "the one that keeps
 * drafting replies" becomes guesswork.
 *
 * `availableAutomations` already offers one of the group, so the dashboard
 * cannot produce this. But a filtered list is a presentation, not a rule: the
 * install takes an automation id, and a stale dialog, a second tab, or a
 * hand-made request reaches it directly. The guard belongs at the seam that
 * writes the row.
 *
 * REFRESHING IS WHY THIS RETURNS THE AUTOMATION AND NOT JUST THE ROW. An
 * install carries a COPY of its plan, and `installAutomation` brings that copy
 * up to date every time it is called. Handed a sibling's row with the REQUESTED
 * automation, it would write the Outlook plan onto the Gmail agent — an agent
 * then calling `outlook` actions with a `google-mail` grant, which fails inside
 * a cron where nobody is watching. So the caller is told which automation the
 * row it found actually is, and refreshes with that one.
 *
 * A business with two genuine mailboxes is a real case and not served here. It
 * needs the owner to be able to tell the two agents apart, which means naming
 * the mailbox on the row — a feature, with a name, rather than two
 * indistinguishable entries arriving by accident.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function findGroupInstall(
  userId: string,
  automation: AutomationAgent
): Promise<{ row: NonNullable<Awaited<ReturnType<typeof findInstall>>>; automation: AutomationAgent } | null> {
  const own = await findInstall(userId, automation);
  if (own) return { row: own, automation };

  if (!automation.variantGroup) return null;

  const { AUTOMATION_AGENTS } = await import('./catalog');
  const siblings = AUTOMATION_AGENTS.filter(
    a => a.variantGroup === automation.variantGroup && a.id !== automation.id
  );

  for (const sibling of siblings) {
    const row = await findInstall(userId, sibling);
    if (row) {
      logger.info(
        { userId, requested: automation.id, running: sibling.id, group: automation.variantGroup },
        'Automation already installed through its other provider; returning that one'
      );
      return { row, automation: sibling };
    }
  }

  return null;
}

/**
 * Put the current plan on an install that is carrying an older one.
 *
 * Writes nothing when the fingerprints match, so this is cheap to call on
 * every install and safe to call on every resume. The cadence, the status and
 * everything else the owner chose are untouched — only the steps move.
 */
async function refreshPlan(
  userId: string,
  existing: { id: string; agent_config?: Record<string, unknown> | null },
  automation: AutomationAgent
): Promise<void> {
  const installed = (existing.agent_config?.business_os_automation ?? {}) as {
    planVersion?: string;
  };
  const current = planVersion(automation.steps);

  if (installed.planVersion === current) return;

  const { error } = await agentRepository.updatePilotSteps(existing.id, userId, automation.steps);

  if (error) {
    /* Not fatal: the install still works, on the plan it already had. Logged
       loudly because a fix that did not land is exactly what this exists to
       prevent. */
    logger.error(
      { err: error, userId, automationId: automation.id, from: installed.planVersion, to: current },
      'Could not bring the installed plan up to date'
    );
    return;
  }

  await agentRepository.update(existing.id, userId, {
    agent_config: {
      ...(existing.agent_config ?? {}),
      business_os_automation: {
        ...(existing.agent_config?.business_os_automation as Record<string, unknown> ?? {}),
        planVersion: current,
        plan_refreshed_at: new Date().toISOString(),
      },
    },
  } as Parameters<typeof agentRepository.update>[2]);

  logger.info(
    { userId, automationId: automation.id, from: installed.planVersion ?? null, to: current },
    'Installed plan brought up to date'
  );
}

/**
 * Which of these plugins this owner has not got a working connection to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE CHECK, SHARED BY INSTALL AND ACTIVATION, because they fail the same way
 * and an owner cannot tell them apart. Switching an agent on for the first time
 * and switching a paused one back on are the same gesture to the person doing
 * it, so a mailbox that has since been revoked has to stop both.
 *
 * MISSING AND REVOKED ARE DELIBERATELY THE SAME ANSWER. `findActiveByUser`
 * filters on `status = 'active'`, so an expired or withdrawn token does not
 * appear and reads as absent — which is correct, because the owner's next
 * action is identical either way: connect it. A token that expired six weeks
 * ago is not a different problem from one that was never there, it just feels
 * like one.
 *
 * `business-os` is excluded. It is an internal plugin with an executor like any
 * other and nothing to connect, so counting it would refuse every agent on the
 * platform.
 *
 * AN UNREADABLE CONNECTION TABLE RETURNS EMPTY — treated as connected.
 * Refusing on a failed read would lock out an owner whose Gmail is perfectly
 * well linked because a table was briefly unavailable, and tell them nothing
 * they could act on. The cost of being wrong this way is one agent whose first
 * run fails visibly; the other way, nothing can be switched on at all.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function missingPluginConnections(
  userId: string,
  pluginsRequired: string[]
): Promise<string[]> {
  const needsConnecting = pluginsRequired.filter(p => p !== 'business-os');
  if (needsConnecting.length === 0) return [];

  const { pluginConnectionRepository } = await import(
    '@/lib/repositories/PluginConnectionRepository'
  );
  const { data: connections, error } = await pluginConnectionRepository.findActiveByUser(userId);

  if (error) {
    logger.warn({ err: error, userId }, 'Could not read plugin connections; assuming connected');
    return [];
  }

  const connected = new Set((connections || []).map(c => c.plugin_key));
  return needsConnecting.filter(p => !connected.has(p));
}

export type InstallOutcome =
  | { ok: true; agentId: string; alreadyInstalled: boolean }
  | { ok: false; reason: 'create_failed' };

/**
 * Put this automation to work for this business.
 *
 * Idempotent: a second install returns the first one rather than creating a
 * twin. Two rows for one automation would both run on the same schedule, and
 * the owner would have no way to tell which of two identical entries to stop.
 *
 * That holds ACROSS PROVIDER VARIANTS too: installing the Outlook mail agent
 * when the Gmail one is already running returns the Gmail one, because they are
 * one job under one name. See `findGroupInstall`.
 */
export async function installAutomation(
  userId: string,
  automation: AutomationAgent,
  /*
   * How often the owner wants it to run. Absent means they did not choose and
   * the catalogue's default applies — but the install dialog is expected to
   * ask, because how often the platform writes to a client in the owner's name
   * is their decision.
   */
  cadence?: AutomationCadence,
  /*
   * How long to keep trying before giving up on one person, in days. The same
   * shape of decision as the cadence and asked on the same dialog: every plan
   * carried a number I wrote, and a business selling a four-thousand-pound
   * course chases for longer than one selling a forty-pound haircut.
   */
  stopAfterDays?: number,
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * HOW OFTEN, AS A NUMBER AND A UNIT, WHICH SUPERSEDES `cadence`.
   *
   * `cadence` could only say one of five words, and those five all fired at
   * 09:00 and all meant a number of days. An owner could not ask for every ten
   * days or every four hours, and the mailbox wizard — which asked the same
   * question in minutes — could not share the control.
   *
   * Passed as well as, not instead of, `cadence`: the parameter stays for every
   * caller that has not been changed, and the `agent_config` keeps writing it,
   * so nothing reading the old key breaks. When both arrive the interval wins,
   * because it is the one the owner was shown.
   *
   * Clamped to the automation's own range, which is derived from the
   * `cadenceChoices` it already declares. That is the guard the named cadence
   * got for the same reason: `win_back_quiet_clients` must not become hourly
   * because a request said so.
   * ───────────────────────────────────────────────────────────────────────────
   */
  schedule?: ScheduleInterval,
  /*
   * What the owner answered on the install dialog, for an agent that asks.
   *
   * Saved to `agent_configurations` rather than onto the agent row, because
   * that is where `{{input.*}}` resolves from for every other agent on the
   * platform and where the agent page writes when they change their mind
   * later. One home for an owner's answers, whichever screen collected them.
   */
  inputValues?: Record<string, unknown>
): Promise<InstallOutcome> {
  /*
   * The owner's interval, moved inside what this automation offers.
   *
   * Clamped rather than rejected, so a stale dialog or a hand-made request
   * cannot fail the install — but cannot set a cadence the catalogue refused
   * either. The range is derived from `cadenceChoices`, so the floor is exactly
   * the fastest the automation ever offered as a chip.
   */
  const chosen = schedule
    ? storageFor(clampInterval(schedule, cadenceRangeOf(automation)))
    : null;

  /*
   * The group, not just this id — see `findGroupInstall`. `installed` is the
   * automation the row really is, which differs from `automation` only when a
   * provider variant of it is already running.
   */
  const found = await findGroupInstall(userId, automation);
  const existing = found?.row ?? null;
  const installed = found?.automation ?? automation;

  if (existing) {
    /*
     * Bring the plan up to date before anything else.
     *
     * The row carries a COPY, because the runtime reads the plan off the row —
     * see `planVersion`. A copy made months ago is a copy of a plan we may
     * since have corrected, and the owner has no way to know. The first
     * version of the invoice chaser would have emailed the same client every
     * morning; an install made before that fix would still be doing it.
     */
    await refreshPlan(userId, existing, installed);

    /* Re-installing a paused one is the owner asking for it back. */
    if (existing.status !== 'active') {
      await agentRepository.activate(existing.id, userId);
    }
    return { ok: true, agentId: existing.id, alreadyInstalled: true };
  }

  const { data: agent, error } = await agentRepository.create({
    user_id: userId,
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE WORDS HERE, THE KEY IN `agent_config`.
     *
     * This stored the translation KEY, on the reasoning that the catalogue is
     * read server-side where no language is resolved. True, and it meant the
     * general agents list — which knows nothing about Business OS — showed the
     * literal string `automation.rebook_quiet_clients.name` as the agent's
     * name.
     *
     * So the column gets real words, resolved once in the owner's own
     * language, and the automation's id stays in `agent_config` where the
     * surfaces that DO know about the catalogue read it. The running-agents
     * card resolves from the catalogue by that id, so it keeps switching
     * language live; only this column is frozen at the language the owner had
     * when they pressed the button, which is the right trade for a column
     * whose whole job is to be legible in a list.
     * ─────────────────────────────────────────────────────────────────────────
     */
    agent_name: await resolveName(userId, automation.nameKey),
    description: await resolveName(userId, automation.descriptionKey),
    tags: [AUTOMATION_AGENT_TAG, automationAgentTag(automation.id)],
    status: 'active',
    mode: 'scheduled',
    schedule_enabled: true,
    /*
     * The owner's choice, checked against the automation's own range so a
     * cadence it does not offer cannot be set by a caller.
     *
     * An interval that compiles to an exact expression (minutes, hours) lands
     * here as that expression and carries no interval. One that cannot (days)
     * lands here as its TIME OF DAY and carries the interval alongside — see
     * `storageFor`. Without an interval this is the old path, unchanged.
     */
    schedule_cron: chosen
      ? chosen.cron
      : cadence && automation.cadenceChoices.includes(cadence)
        ? CADENCE_CRON[cadence]
        : automation.defaultCron,
    /*
     * UTC, like the channel's. A business-local hour would be a promise about
     * WHEN something sends, and nothing on this path keeps that promise yet —
     * the queue drains on its own cadence once an agent is handed over.
     */
    timezone: 'UTC',
    /*
     * Dated now, not one interval out. The owner has just said yes, and the
     * scheduler skips a null `next_run` as "not due" — an agent that is active,
     * correct, visible and permanently dormant is the failure the channel's own
     * comment records.
     */
    next_run: new Date().toISOString(),
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * PRODUCTION FROM BIRTH, BECAUSE WE WROTE THE PLAN.
     *
     * `ShadowAgent.isActive` is `!production_ready`. Left unset, every run of
     * this agent — a committed plan, reviewed and tested in this repository —
     * carries the full calibration apparatus a PROMPT-BUILT agent needs:
     *
     *   · StructuralRepairEngine, which reads the plan against the agent's
     *     input_schema and, finding references it cannot resolve, rates them
     *     `critical` and sets `will_persist: true` — it intends to REWRITE the
     *     owner's stored plan;
     *   · ResumeOrchestrator, which turns any step failure into
     *     `stop_execution` and throws with code `CALIBRATION_STOP`.
     *
     * That is the right machinery for an agent a model just invented from a
     * sentence, and the wrong machinery for one whose plan is a file in this
     * repository with tests around it. Calibration exists to find out whether a
     * generated plan does what was asked. There is nothing here to find out.
     *
     * The cost was not theoretical: a business owner's dashboard read
     * "Calibration stop: Non-retryable execution error…" about a mailbox agent,
     * and they had never calibrated anything.
     * ─────────────────────────────────────────────────────────────────────────
     */
    production_ready: true,
    plugins_required: automation.pluginsRequired,
    /*
     * What the agent page will ask the owner for. Empty for the six chasers.
     * Without this column an agent that needs a spreadsheet is installed,
     * scheduled, and has no way to ever be told which one.
     */
    input_schema: automation.inputSchema ?? [],
    /* Both, because the runtime reads `pilot_steps` and the older agent
       surfaces read `workflow_steps`. The channel writes both for the same
       reason. */
    workflow_steps: automation.steps,
    pilot_steps: automation.steps,
    agent_config: {
      business_os_automation: {
        id: automation.id,
        /* The insight this was installed in answer to, kept so the agent can
           say what it is FOR long after the card that offered it has gone. */
        answersProcess: automation.answersProcess,
        /* What they chose, so the list can show it and a change is a change
           to something visible rather than to a cron string. */
        cadence: cadence && automation.cadenceChoices.includes(cadence)
          ? cadence
          : null,
        /*
         * The owner's interval, written only when they chose one.
         *
         * Authoritative over both `cadence` and `schedule_cron` — see
         * `nextRunFor` — and absent on every install made the old way, which is
         * what keeps those running on their cron untouched.
         */
        ...(chosen?.interval ? { schedule: formatInterval(chosen.interval) } : {}),
        /*
         * Clamped to the automation's own range so a caller cannot set a bound
         * it never offered — the same guard the cadence gets, for the same
         * reason.
         *
         * A RANGE and no longer an exact list: the control asks for a number
         * now, so 45 days on an agent listing 30 and 60 is a real answer rather
         * than one to discard. The old check tested `includes`, which silently
         * turned anything between two chips into the default — the one reading
         * that loses the owner's choice without saying so.
         *
         * Absent still means the default, which the RUNTIME resolves rather
         * than this row, so an install made before a default changed picks the
         * new one up.
         */
        stopAfterDays:
          typeof stopAfterDays === 'number' && Number.isInteger(stopAfterDays) && stopAfterDays > 0
            ? clampInterval(
                { every: stopAfterDays, unit: 'days' },
                stopAfterRangeOf(automation)
              ).every
            : null,
        /* What the row's copy of the plan is, so a later fix can tell this
           install is behind. See `planVersion`. */
        planVersion: planVersion(automation.steps),
        installed_at: new Date().toISOString(),
      },
    },
  });

  if (error || !agent) {
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * LOST THE RACE? RETURN WHAT WON IT.
     *
     * `agents_one_automation_per_user` (20261099) refuses a second live row for
     * the same automation, and 23505 is that index speaking. It means another
     * request created the agent between our lookup above and this insert — four
     * such requests arrived ten milliseconds apart from one browser, and before
     * the index they produced four live agents that would each have written to
     * the same clients.
     *
     * Reported as `alreadyInstalled` rather than as a failure, because that is
     * what actually happened: the owner pressed once as far as they are
     * concerned, and the automation is on.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if ((error as { code?: string } | null)?.code === '23505') {
      const winner = await findInstall(userId, automation);

      if (winner) {
        logger.info(
          { userId, automationId: automation.id, agentId: winner.id },
          'Another request installed this first; returning it'
        );
        return { ok: true, agentId: winner.id as string, alreadyInstalled: true };
      }
    }

    logger.error({ err: error, userId, automationId: automation.id }, 'Could not install automation');
    return { ok: false, reason: 'create_failed' };
  }

  /*
   * The owner's answers, after the row exists because they hang off its id.
   *
   * NON-BLOCKING, and the direction is deliberate. The agent is created and
   * scheduled by this point; failing the whole install over a settings write
   * would leave them with nothing and no way to retry except pressing the same
   * button again. A saved agent whose answers did not land is recoverable from
   * its own page, which is the same screen they would use to change them.
   *
   * The schema goes with them so the configuration row can describe itself.
   */
  if (inputValues && Object.keys(inputValues).length > 0) {
    const { error: valuesError } = await agentConfigurationRepository.saveInputValues(
      agent.id as string,
      userId,
      inputValues,
      { inputSchema: automation.inputSchema ?? [] }
    );

    if (valuesError) {
      logger.error(
        { err: valuesError, userId, automationId: automation.id, agentId: agent.id },
        'Agent installed but its answers did not save; it will ask again on its own page'
      );
    }
  }

  logger.info({ userId, automationId: automation.id, agentId: agent.id }, 'Automation installed');

  return { ok: true, agentId: agent.id as string, alreadyInstalled: false };
}

/**
 * Is this actually one of this owner's automation agents?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Asked because the writes below cannot tell.
 *
 * `agentRepository.softDelete` and its siblings run an UPDATE with no
 * `.select()`, so an update that matched no row is indistinguishable from one
 * that matched: both come back without an error and the repository answers
 * `true`. Every query is scoped by `user_id`, so nothing leaks and nothing of
 * anybody else's is touched — the failure is purely one of honesty. The API
 * answers "done" for an id that does not exist.
 *
 * It is not theoretical. A harness here called pause with its arguments the
 * wrong way round, the repository reported success, and the only reason it was
 * caught was a second read showing the status unchanged.
 *
 * The tag check is deliberate as well as the ownership one: these controls are
 * for automation agents, and pointing them at the owner's own hand-built agent
 * — or at the Gmail channel, which is also an `agents` row — would pause
 * something this card never claimed to manage.
 * ─────────────────────────────────────────────────────────────────────────────
 */
async function isControllableAgent(userId: string, agentId: string): Promise<boolean> {
  const { data, error } = await agentRepository.findById(agentId, userId);

  if (error || !data) return false;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * IF IT IS ON THE LIST, IT CAN BE CONTROLLED.
   *
   * This required the `business-os-automation` tag, which was correct while the
   * list showed only the agents adopted from an insight. The list now selects
   * on the scheduling contract, so the mailbox channel appears on it — and with
   * the tag check still here its pause and remove buttons would have been drawn
   * and then silently refused. A control that does nothing is worse than one
   * that is absent.
   *
   * Matched to `findScheduled`'s own predicate, deliberately: the list and its
   * controls now agree by construction rather than by two rules that have to be
   * kept in step.
   *
   * Still scoped to the owner — `findById` filters on `user_id` — and still
   * refuses anything that is not scheduled, so nobody can pause another
   * business's agent or an agent this surface never offered to control.
   * ───────────────────────────────────────────────────────────────────────────
   */
  return data.mode === 'scheduled' && !(data as { deleted_at?: string | null }).deleted_at;
}

/** Stop it running, keeping it installed. */
export async function pauseAutomation(userId: string, agentId: string): Promise<boolean> {
  if (!(await isControllableAgent(userId, agentId))) {
    logger.warn({ userId, agentId }, 'Refused to pause: not one of this owner\'s scheduled agents');
    return false;
  }

  /* The repository's own verb, which records a reason alongside the status. */
  const { error } = await agentRepository.pause(agentId, userId, 'Paused by the owner');
  if (error) {
    logger.error({ err: error, userId, agentId }, 'Could not pause automation');
    return false;
  }
  logger.info({ userId, agentId }, 'Automation paused');
  return true;
}

/**
 * Put a paused one back to work, and give it a clock that is in the future.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESUMING USED TO FLIP THE STATUS AND NOTHING ELSE
 *
 * `next_run` kept whatever value it held when the agent was paused, which is by
 * definition in the past by the time anybody resumes it. Two things followed,
 * and both were visible on a live account:
 *
 *   The list showed a next run that had already been and gone — "29 באוק׳" on
 *   the thirtieth — which reads as a broken agent rather than a resumed one.
 *
 *   And the scheduler selects on `next_run <= now()`, so the agent was
 *   immediately due and fired on the very next tick instead of resuming its own
 *   rhythm. An agent paused for a month came back and ran at once.
 *
 * So the clock is recomputed from the agent's own schedule, exactly as a
 * schedule change recomputes it: counted from the LAST run, advanced past the
 * present, so it is at most one interval away and lands on the time of day the
 * agent already used.
 *
 * An agent that has NEVER run is dated now instead — the same thing install
 * does, for the same reason. Somebody switching on an agent that has never
 * worked is asking for it to work, and making them wait a week for the first
 * run of a weekly chaser is not what they pressed the button for.
 *
 * The status is written first and the clock second. If the second write fails
 * the agent is still resumed, still correct, and merely due sooner than it
 * should be — where the other order would leave a paused agent with a freshly
 * advanced clock, which is a silent skip.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/**
 * Run this agent at the next tick, rather than at its next scheduled time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * There was no way to make an agent run. A daily agent that fails can only be
 * diagnosed once a day, and the failure is gone by the time anybody reads the
 * log. One live channel took TEN DAYS to pin down for exactly that reason: six
 * failures a day, every day, and a single chance each evening to be watching
 * when it happened.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT MOVES THE CLOCK. IT DOES NOT EXECUTE.
 *
 * The temptation is to call the runner here and have the agent run inside this
 * request. That would be a SECOND execution path, and a second path is the
 * thing that made the ten-day bug so hard to see: the channel agent worked
 * under its old cron and failed under the scheduler, because the two did not
 * do the same thing. A "run now" that behaves differently from a scheduled run
 * cannot reproduce a scheduled run's failure, which is the only reason anybody
 * presses it.
 *
 * So this sets `next_run` to now and lets the scheduler claim it on its next
 * pass — within five minutes, through the same lease, the same connection
 * pre-flight, the same retries and the same recording. What the owner watches
 * is the real thing.
 *
 * NOTHING ELSE IS TOUCHED. Not `status`, not `schedule_cron`, not the cadence:
 * the next run after this one lands where the schedule always said it would,
 * because the scheduler recomputes `next_run` from the cron once it finishes.
 * Pressing this does not quietly reschedule an agent.
 *
 * A PAUSED AGENT IS REFUSED rather than silently resumed. The scheduler selects
 * on `status = 'active'`, so moving the clock on a paused agent would do
 * nothing at all and report success — the worst combination.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function runAutomationNow(userId: string, agentId: string): Promise<boolean> {
  if (!(await isControllableAgent(userId, agentId))) {
    logger.warn({ userId, agentId }, 'Refused to run: not one of this owner\'s scheduled agents');
    return false;
  }

  const { data: agent } = await agentRepository.findById(agentId, userId);

  if (!agent) return false;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * EVERY CONDITION THE SCHEDULER CLAIMS ON, NOT JUST THE FIRST.
   *
   * This checked `status` alone, with the right reason beside it — "the
   * scheduler would never pick it up, so reporting success here would promise
   * a run that cannot happen". The claim query requires THREE things:
   *
   *     mode = 'scheduled'  AND  schedule_enabled = true  AND  status = 'active'
   *
   * so testing one of them promised exactly the run it was written to refuse.
   *
   * Measured on a live account on 2026-11-10: a spreadsheet agent with
   * `schedule_enabled = false` was "run now"-ed repeatedly. Each press moved
   * `next_run`, returned success, and queued nothing — the owner watched for
   * a run that could never be claimed, and the list showed the agent as
   * healthy throughout.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const row = agent as { status?: string; schedule_enabled?: boolean; mode?: string };

  if (row.status !== 'active') {
    logger.info({ userId, agentId }, 'Refused to run: the agent is paused');
    return false;
  }

  if (row.schedule_enabled === false) {
    logger.info({ userId, agentId }, 'Refused to run: the schedule is switched off');
    return false;
  }

  if (row.mode && row.mode !== 'scheduled') {
    logger.info({ userId, agentId, mode: row.mode }, 'Refused to run: not a scheduled agent');
    return false;
  }

  const { error } = await agentRepository.update(agentId, userId, {
    next_run: new Date().toISOString(),
  } as never);

  if (error) {
    logger.error({ err: error, userId, agentId }, 'Could not bring the run forward');
    return false;
  }

  logger.info({ userId, agentId }, 'Automation brought forward; the next scheduler pass will claim it');
  return true;
}

export async function resumeAutomation(userId: string, agentId: string): Promise<boolean> {
  if (!(await isControllableAgent(userId, agentId))) {
    logger.warn({ userId, agentId }, 'Refused to resume: not one of this owner\'s scheduled agents');
    return false;
  }

  const { error } = await agentRepository.activate(agentId, userId);
  if (error) {
    logger.error({ err: error, userId, agentId }, 'Could not resume automation');
    return false;
  }

  const nextRun = await nextDueOnResume(userId, agentId);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * BOTH FLAGS, BECAUSE THE SCHEDULER READS BOTH.
   *
   * `activate` sets `status`, and the claim query requires `status = 'active'`
   * AND `schedule_enabled = true`. Resume set only the first, so an agent
   * whose schedule flag was off could not be brought back from this UI at all:
   * the button reported success, the row showed Active, and the scheduler went
   * on ignoring it for ever.
   *
   * Found on a live account on 2026-11-10. A spreadsheet agent had not run
   * since 5 November; its owner pressed resume, the control said yes, and
   * `schedule_enabled` stayed false. Nothing anywhere said why.
   *
   * Written in the same patch as the clock, and treated as part of resuming
   * rather than a courtesy: an agent that is "resumed" but unclaimable is the
   * state this function exists to leave behind.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { error: enableError } = await agentRepository.update(agentId, userId, {
    schedule_enabled: true,
  } as never);

  if (enableError) {
    logger.error({ err: enableError, userId, agentId }, 'Resumed the status but could not enable the schedule');
    return false;
  }

  if (nextRun) {
    const { error: clockError } = await agentRepository.update(agentId, userId, {
      next_run: nextRun,
    } as never);

    if (clockError) {
      /* Non-blocking: the agent IS resumed. A stale clock makes it due sooner
         than it should be, which is a wrong time rather than a wrong state. */
      logger.warn({ err: clockError, userId, agentId }, 'Resumed, but could not move the clock');
    }
  }

  logger.info({ userId, agentId, nextRun }, 'Automation resumed');
  return true;
}

/**
 * When a just-resumed agent should next run, or null if it cannot be worked out.
 *
 * Null rather than a guess: an agent whose schedule this module cannot read —
 * a weekday list from the prompt flow's builder, say — keeps the clock it had.
 * Being due immediately is a smaller wrong than being moved to a date nobody
 * chose.
 */
async function nextDueOnResume(userId: string, agentId: string): Promise<string | null> {
  const { data: agent } = await agentRepository.findById(agentId, userId);
  if (!agent) return null;

  const lastRun = (agent as { last_run?: string | null }).last_run ?? null;

  /* Never worked: date it now, like install, so switching it on starts it. */
  if (!lastRun) return new Date().toISOString();

  const config = (agent.agent_config ?? {}) as Record<string, unknown>;
  const interval =
    scheduleIntervalOf(config) ??
    intervalFromCron(agent.schedule_cron, { allowNamedCadence: NAMED_CADENCE_CRON });

  if (!interval) return null;

  return nextTickAfter(new Date(lastRun), interval).toISOString();
}

/**
 * Change how often one agent runs, and when it gives up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SAME TWO QUESTIONS THE OWNER ANSWERED TO CREATE IT
 *
 * They were asked once, on the dialog that installed it, and then there was no
 * way back: a business that got busier could not slow its own chaser down
 * without removing the agent and adopting it again, which loses its history.
 *
 * So this is the install dialog's two answers, applied to a row that already
 * exists — same ranges, same clamping, same storage. Nothing else about the
 * agent is touched: not its plan, not its name, not its status. An owner
 * editing a schedule has not asked to resume a paused agent.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `next_run` HAS TO MOVE, AND WHERE TO
 *
 * It is the scheduler's only clock. Leaving it alone after a change from
 * monthly to daily means the owner waits up to a month for the first daily run
 * and nothing explains why — the list would say "every day" over a next run
 * three weeks out.
 *
 * Counted from the LAST run where there was one, so the new cadence is measured
 * from when the agent actually last worked rather than from the moment somebody
 * opened a dropdown. An agent that ran this morning and is now daily is next
 * due tomorrow morning, which is both correct and what the words say.
 *
 * Never set to now: a schedule change is not a request to run immediately, and
 * an owner adjusting a chaser would not expect mail to leave while they are
 * still on the screen.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function updateAgentSchedule(
  userId: string,
  agentId: string,
  next: { schedule?: ScheduleInterval; stopAfterDays?: number; stopAfter?: ScheduleInterval }
): Promise<{ ok: boolean; nextRun?: string; reason?: string }> {
  const { data: agent, error: readError } = await agentRepository.findById(agentId, userId);

  if (readError || !agent) return { ok: false, reason: 'not_found' };
  if (agent.mode !== 'scheduled' || (agent as { deleted_at?: string | null }).deleted_at) {
    return { ok: false, reason: 'not_scheduled' };
  }

  const config = (agent.agent_config ?? {}) as Record<string, Record<string, unknown>>;
  const adoptedId = config.business_os_automation?.id as string | undefined;
  const isMailbox = Boolean(config.inbox_channel?.provider);

  const { automationById } = await import('./catalog');
  const automation = adoptedId ? automationById(adoptedId) : undefined;

  /*
   * The walls, from whichever family owns this agent.
   *
   * An adopted agent's come from its catalogue entry, which is the only thing
   * that knows `win_back_quiet_clients` must never become hourly. The mailbox
   * has its own. Anything else is an agent the owner wrote, and five minutes is
   * the honest floor there because the scheduler itself ticks every five.
   */
  const cadenceRange = SCHEDULE_RANGE;

  /* One pair, whichever family this is. */
  const stopRange = STOP_RANGE;

  const patch: Record<string, unknown> = {};
  const familyKey = adoptedId ? 'business_os_automation' : isMailbox ? 'inbox_channel' : null;
  const family: Record<string, unknown> = familyKey ? { ...(config[familyKey] ?? {}) } : {};
  /*
   * Whether anything in `family` actually MOVED.
   *
   * Not `Object.keys(family).length`, which is what this was: the family is
   * seeded with the config already on the row, so it is never empty and the
   * emptiness guard below could not fire. A request asking for neither answer
   * rewrote `agent_config` with its own contents and reported success — a
   * no-op write that looked like a change in the audit trail.
   */
  let familyTouched = false;

  let nextRun: Date | null = null;

  if (next.schedule) {
    const chosen = storageFor(clampInterval(next.schedule, cadenceRange));

    patch.schedule_cron = chosen.cron;

    /*
     * Written WHOLESALE, so an interval that compiles to an exact cron has to
     * DELETE the one stored before it. Without the null the agent would keep an
     * old three-day interval beside a new hourly expression, and `nextRunFor`
     * prefers the interval — the owner would have set hourly and got every
     * three days, with the list showing hourly.
     */
    family.schedule = chosen.interval ? formatInterval(chosen.interval) : null;
    familyTouched = true;

    /*
     * The new clock, from the last run. `nextRunFor` is not used here because
     * it reads the row as it is and this is the row as it will be.
     */
    const lastRun = (agent as { last_run?: string | null }).last_run ?? null;
    const from = lastRun ? new Date(lastRun) : new Date();
    nextRun = chosen.interval
      ? nextTickAfter(from, chosen.interval)
      : nextRunAfterCron(chosen.cron);

    if (nextRun) patch.next_run = nextRun.toISOString();
  }

  /*
   * The stop rule, as an interval where the caller sent one.
   *
   * `stopAfterDays` stays for callers that have not changed, converted to the
   * same shape — but it cannot express hours, and the mailbox offers them. A
   * control that could only hand back a NUMBER was unable to change the unit
   * at all: pressing "hours" on thirty days sent 720, which came back as 720
   * DAYS and clamped.
   */
  const askedStop =
    next.stopAfter ??
    (typeof next.stopAfterDays === 'number'
      ? { every: next.stopAfterDays, unit: 'days' as const }
      : null);

  if (askedStop) {
    const bounded = clampInterval(askedStop, stopRange);

    /* The rounded copy, which every older reader still uses and the plans read
       as `{{input.stop_after_days}}`. */
    family.stopAfterDays = Math.max(1, Math.round(intervalMinutes(bounded) / 1440));
    /* And the exact one beside it. The mailbox computes its search window from
       this, so an owner who said twelve hours is not handed a whole day. */
    family.stopAfter = formatInterval(bounded);
    familyTouched = true;
  }

  if (familyKey && familyTouched) {
    /* MERGED at the top level: `agent_config` also carries creation metadata
       and the V6 ai_context, and a schedule change must not drop them. */
    patch.agent_config = { ...config, [familyKey]: family };
  }

  if (Object.keys(patch).length === 0) return { ok: false, reason: 'nothing_to_change' };

  const { error } = await agentRepository.update(agentId, userId, patch as never);

  if (error) {
    logger.error({ err: error, userId, agentId }, 'Could not change the agent schedule');
    return { ok: false, reason: 'write_failed' };
  }

  logger.info(
    { userId, agentId, schedule: next.schedule, stopAfterDays: next.stopAfterDays },
    'Agent schedule changed by the owner'
  );

  return { ok: true, nextRun: nextRun?.toISOString() };
}

/**
 * The next occurrence of a cron expression, for the minutes-and-hours case.
 *
 * `cron-parser` lives in the execution layer's runner, and this module is in the
 * data layer: importing it here would point an arrow upward through the one
 * boundary this work spent effort removing.
 *
 * It is not needed either. The only expressions reaching this are ones
 * `storageFor` just compiled from an interval — minutes or hours — so reading
 * the interval back and adding it is exact. No timezone, deliberately: an
 * interval has no time of day to be wrong about, which is the whole reason cron
 * could express it in the first place.
 */
function nextRunAfterCron(cron: string): Date | null {
  const interval = intervalFromCron(cron);
  if (!interval) return null;

  return nextTickAfter(new Date(), interval);
}

/**
 * Take it away.
 *
 * Soft delete, so what it did survives the decision to stop it: the executions
 * it queued are still answerable for, and an owner asking "what sent that
 * email in March" deserves an answer after they uninstalled it in April.
 */
export async function removeAutomation(userId: string, agentId: string): Promise<boolean> {
  if (!(await isControllableAgent(userId, agentId))) {
    logger.warn({ userId, agentId }, 'Refused to remove: not one of this owner\'s automation agents');
    return false;
  }

  const { error } = await agentRepository.softDelete(agentId, userId);
  if (error) {
    logger.error({ err: error, userId, agentId }, 'Could not remove automation');
    return false;
  }
  logger.info({ userId, agentId }, 'Automation removed');
  return true;
}

/**
 * What this owner could switch on, and is not running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A LIST OF THE UNINSTALLED IS NOT AN ADVERT
 *
 * Until this existed an agent could only be found if an insight card happened
 * to fire: the advisor offered it, the owner said yes. That is fine for an
 * agent with a trend behind it and leaves the others undiscoverable —
 * `follow_up_stalled_deals` and `draft_client_replies` both carry
 * `offeredFromInsight: false` precisely because no detector reports their work,
 * so no card will ever mention them. They were shipped and unreachable.
 *
 * So this is the other doorway, and it is the general one: anything in the
 * catalogue appears, with no backfill, no row for an owner who never wants it,
 * and nothing to do when the next agent is added.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO FILTERS, AND THEY REFUSE FOR DIFFERENT REASONS
 *
 *   `automationApplies`   what the BUSINESS does. An invoicing practice that
 *                         takes no bookings must not be offered a rebooking
 *                         agent — not greyed out, absent. It is not a
 *                         capability they are missing, it is not their trade.
 *
 *   `missingPlugins`      what the OWNER has connected. This one is shown
 *                         rather than hidden, because it IS actionable: the
 *                         answer is to connect Gmail, and an agent they cannot
 *                         see is an agent they cannot work out how to get.
 *
 * `business-os` is excluded from that check. It is an internal plugin with an
 * executor like any other, but nobody connects it — treating it as missing
 * would mark every agent in the catalogue unavailable.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export interface AvailableAutomation {
  automationId: string;
  /** Already in the owner's language, like the installed rows. */
  name: string;
  description: string;
  watches: string;
  plugins: string[];
  /** Required plugins this owner has not connected. Empty means ready to run. */
  missingPlugins: string[];
  cadenceChoices: string[];

  /**
   * ANY ONE OF THESE WILL DO, so the owner is asked WHICH rather than told.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE HOLE THIS CLOSES: "WHERE IS THE OUTLOOK AGENT?"
   *
   * A variant group is offered as one row, and which variant it is follows the
   * mailbox the owner has connected. That is right whenever they have one. When
   * they have NEITHER — which is how most owners first meet this agent — there
   * was nothing to follow, so the group's default was offered and the install
   * dialog said "connect Gmail".
   *
   * For an owner who runs their business on Outlook that is the wrong
   * instruction, and the dialog gave them no way to say so: its Connect button
   * is wired to the plugin named in `missingPlugins`. They would have to leave,
   * find the plugins page, connect Outlook there and come back — the two-visit
   * flow the in-dialog repair was built to end.
   *
   * So when nothing in the group is connected, the row stops asserting a
   * mailbox and offers both. The owner connects the one they actually use, and
   * `automationId` on that entry says which variant that choice means — so the
   * answer to "which plan" is the SAME act as "connect my mailbox", asked once,
   * at the only moment it is genuinely ambiguous.
   *
   * ABSENT the rest of the time, deliberately. One mailbox connected is not a
   * question, and putting a plumbing choice in front of every owner to serve
   * the minority who have neither is the trade this avoids.
   * ───────────────────────────────────────────────────────────────────────────
   */
  connectEither?: { plugin: string; automationId: string; connected: boolean }[];

  /**
   * ABSENT WHEN THE AGENT HAS NO STOP RULE, which is not every agent.
   *
   * The rule means one thing everywhere — stop considering anything older than
   * this — and that needs something with a date on it. Every chaser has one:
   * an invoice, a quote, a booking. The spreadsheet importer does not, because
   * a row has no age, so its catalogue entry declares neither field and the
   * install dialog must not ask a question with no answer.
   *
   * Optional here rather than defaulted to a number, so a surface has to decide
   * what to do about its absence instead of rendering a stop rule the agent
   * will never spend.
   */
  defaultStopAfterDays?: number;
  stopAfterChoices?: number[];

  /**
   * The automation this one works WITH, already in the owner's language.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * BECAUSE THE ROW IS OTHERWISE INDISTINGUISHABLE FROM SOMETHING ALREADY ON.
   *
   * `follow_up_stalled_deals` reads "remind about quotes nobody answered",
   * which is word for word what the `chase_quotes` toggle does — and an owner
   * with that toggle running saw the row and reasonably asked whether the
   * platform was offering them something they already had.
   *
   * They do not overlap. The toggle fires once at 72 hours and stops; the
   * agent's find starts at day 7 and runs to 45, and its plan excludes the
   * chaser's window on purpose. But none of that was anywhere the owner could
   * see it, while the relationship was sitting in `worksAlongside` the whole
   * time.
   *
   * Null when an agent stands alone. Resolved here rather than in the card, for
   * the same reason every other label on this row is: the registry is read
   * server-side, and a surface should never have to turn an id into words.
   * ───────────────────────────────────────────────────────────────────────────
   */
  worksAlongside: string | null;

  /**
   * What the owner must answer before this can be switched on.
   *
   * Empty for an agent that needs nothing but a schedule, and the card installs
   * those with one press. A non-empty list means the press opens a dialog
   * instead: an agent that needs a spreadsheet must be ASKED before it is
   * created, not created and then left sitting unable to run while nothing on
   * screen says why.
   */
  inputs: NonNullable<AutomationAgent['inputSchema']>;
}

/**
 * Both mailboxes, or nothing — see `connectEither` on the row.
 *
 * Returns undefined for an agent with no variant group (almost all of them),
 * and for a group that is already decided: an owner with a mailbox connected is
 * being asked nothing, because the answer is the one they chose by connecting
 * it. A connection read that FAILED leaves `connected` empty, which looks
 * identical to "nothing connected" — and asking is the safe answer to that,
 * since the dialog's own check runs against the live plugin map and will say
 * "connected" the moment it disagrees.
 */
function mailboxChoiceFor(
  automation: AutomationAgent,
  connected: Set<string>,
  /* Handed in rather than imported: this module reaches the catalogue through a
     dynamic import to avoid a cycle, so a top-level import here is not
     available and module-level mutable state to work around that would be
     worse than a parameter. */
  catalogue: readonly AutomationAgent[]
): { plugin: string; automationId: string; connected: boolean }[] | undefined {
  if (!automation.variantGroup) return undefined;

  const siblings = catalogue.filter(
    a => a.variantGroup === automation.variantGroup && a.variantPlugin !== undefined
  );

  /* A group of one is not a choice. */
  if (siblings.length < 2) return undefined;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * OFFERED EVEN WHEN ONE IS ALREADY CONNECTED, which it was not at first.
   *
   * The first version returned nothing once any mailbox in the group was
   * connected, on the reasoning that the answer was then already known. It was
   * too strong, and it made the other plan UNREACHABLE: an owner with Gmail
   * connected was handed the Gmail variant and given no way to say "my client
   * correspondence goes through Outlook". The only route to the Outlook plan
   * was to disconnect Gmail first, which nobody would guess and which breaks
   * whatever else was using it.
   *
   * Found by trying to reach it: deleting the installed Gmail agent put the
   * agent back in the list, still as Gmail, with no choice anywhere.
   *
   * So the choice is always offered for a group of more than one, and
   * `connected` says which answer costs an extra step — NOT which answer is
   * right. A second version pre-selected the connected mailbox so the owner
   * "did not have to think about it", and that was wrong for a reason worth
   * keeping: PLUGIN CONNECTIONS ARE SHARED ACROSS THE PLATFORM. A business may
   * have connected Gmail for the website enquiry channel while their client
   * correspondence runs through Outlook — being connected means this agent
   * COULD read it, never that it should. The dialog asks, and nothing is
   * chosen until the owner chooses it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  return siblings.map(a => ({
    plugin: a.variantPlugin!,
    automationId: a.id,
    connected: connected.has(a.variantPlugin!),
  }));
}

export async function availableAutomations(userId: string): Promise<AvailableAutomation[]> {
  const { AUTOMATION_AGENTS } = await import('./catalog');
  const { OPERATIONAL_AUTOMATIONS } = await import('@/lib/business-os/gaps/automations');
  const { automationApplies } = await import('@/lib/business-os/gaps/automationApplies');
  const { pluginConnectionRepository } = await import(
    '@/lib/repositories/PluginConnectionRepository'
  );

  const { data: agents, error } = await agentRepository.findScheduled(userId);

  if (error) {
    /*
     * Fails CLOSED, unlike the installed list which returns [].
     *
     * An unreadable agent list means we cannot tell what is already running,
     * and offering an owner a one-click install of something they already have
     * is how a business ends up with two agents writing to the same client.
     */
    logger.error({ err: error, userId }, 'Could not read installed agents; offering nothing');
    return [];
  }

  const running = new Set<string>();
  for (const agent of agents || []) {
    const config = (agent.agent_config ?? {}) as Record<string, Record<string, unknown>>;
    const id = config.business_os_automation?.id;
    if (id) running.add(String(id));
  }

  const dictionary = await ownerDictionary(userId);
  const say = (key: string | undefined): string => (key ? (dictionary[key] ?? key) : '');

  /* One read for the whole list, for the same reason the dictionary is. */
  const { data: connections } = await pluginConnectionRepository.findActiveByUser(userId);
  /* `plugin_key`, which is the column `findByUserAndPlugin` filters on and the
     value `pluginsRequired` is written in. */
  const connected = new Set((connections || []).map(c => c.plugin_key));

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * ONE ROW PER JOB, NOT ONE PER PROVIDER.
   *
   * Some agents exist twice because the same work goes through two different
   * mailboxes — see `variantGroup` on the catalogue type for why that cannot be
   * one entry. The owner must still see one row: two rows carrying the same
   * name, the same description and the same Activate button is not a choice,
   * it is a puzzle.
   *
   * The mailbox they have connected decides it. Connected Outlook and not
   * Gmail, they are offered the Outlook plan; connected neither — which is how
   * most owners first meet this agent — they are offered the group's default,
   * and the install dialog then asks them to connect it, which is the existing
   * behaviour for any agent needing a plugin.
   *
   * CONNECTED BOTH is resolved by catalogue order rather than by asking. It is
   * a rare case, both answers are defensible, and the alternative is a question
   * about plumbing put to somebody who wanted their replies drafted.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const variantToOffer = new Map<string, string>();
  for (const automation of AUTOMATION_AGENTS) {
    const group = automation.variantGroup;
    if (!group) continue;

    /*
     * Already running one of the group → the whole group is off the list. An
     * owner running the Gmail agent who later connects Outlook must not be
     * offered the twin: they would end up with two agents reading two mailboxes
     * and drafting into both. `''` is the sentinel for "offer none", which no
     * automation id can collide with.
     */
    if (running.has(automation.id)) {
      variantToOffer.set(group, '');
      continue;
    }
    if (variantToOffer.get(group) === '') continue;

    const chosen = variantToOffer.get(group);
    const chosenIsConnected =
      chosen !== undefined &&
      AUTOMATION_AGENTS.some(
        a => a.id === chosen && a.variantPlugin !== undefined && connected.has(a.variantPlugin)
      );

    /* A connected mailbox beats the default; the first connected one wins. */
    if (automation.variantPlugin && connected.has(automation.variantPlugin)) {
      if (!chosenIsConnected) variantToOffer.set(group, automation.id);
      continue;
    }

    if (chosen === undefined && automation.variantDefault) {
      variantToOffer.set(group, automation.id);
    }
  }

  const rows: AvailableAutomation[] = [];
  /*
   * One cache for the whole list. `automationApplies` resolves a business fact
   * per requirement ("takes bookings", "sends quotes"), and several agents share
   * a requirement — without this, the same question is asked of the database
   * once per agent. `as never` matches the call in `installedAutomations`: the
   * function reads only `.requires`, which both registries spell identically,
   * but the parameter is typed to the operational shape.
   */
  const applies = new Map<string, Promise<boolean>>();

  for (const automation of AUTOMATION_AGENTS) {
    if (running.has(automation.id)) continue;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * ONLY THE AGENTS NO CARD WILL EVER OFFER.
     *
     * The first version of this listed everything uninstalled, and on a live
     * account that put five agents on the dashboard with Activate buttons, of
     * which four were not new and three were simply WAITING.
     *
     * An agent with detectors behind it is meant to arrive at a moment, with
     * evidence: "four leads have gone cold, shall I follow them up?" Listing it
     * here offers the same agent with no trigger and nothing to justify it —
     * the same button, a far weaker offer — and it pre-empts the card entirely,
     * because an agent switched on from a list never gets the card that would
     * have explained it. The owner's reaction to seeing those five was the
     * finding: it read as the platform offering things they already had.
     *
     * `offeredFromInsight: false` already marks exactly the agents with no such
     * moment — no detector reports their work, so no card will ever mention
     * them, and before this list existed they were shipped and unreachable.
     * Those are the ones a list is FOR. The rest keep their card.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (automation.offeredFromInsight !== false) continue;

    /* One of a group of provider variants, and not the one to offer here. */
    if (automation.variantGroup && variantToOffer.get(automation.variantGroup) !== automation.id) {
      continue;
    }

    if (!(await automationApplies(userId, automation as never, applies))) continue;

    rows.push({
      automationId: automation.id,
      name: say(automation.nameKey),
      description: say(automation.descriptionKey),
      watches: say(automation.watchesKey),
      plugins: automation.pluginsRequired,
      missingPlugins: automation.pluginsRequired.filter(
        p => p !== 'business-os' && !connected.has(p)
      ),
      cadenceChoices: automation.cadenceChoices,
      /*
       * Offered only while the group is undecided — see `connectEither`. Built
       * from the catalogue in its own order, so the default comes first and the
       * dialog lists the likelier mailbox at the top.
       */
      connectEither: mailboxChoiceFor(
        automation,
        connected,
        AUTOMATION_AGENTS as readonly AutomationAgent[]
      ),
      defaultStopAfterDays: automation.defaultStopAfterDays,
      stopAfterChoices: automation.stopAfterChoices,
      inputs: automation.inputSchema ?? [],
      worksAlongside: automation.worksAlongside
        ? say(
            OPERATIONAL_AUTOMATIONS.find(o => o.id === automation.worksAlongside)?.labelKey ?? ''
          ) || null
        : null,
    });
  }

  return rows;
}

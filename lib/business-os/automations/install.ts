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
        status: agent.status,
        lastRun: (agent as { last_run?: string | null }).last_run ?? null,
        nextRun: (agent as { next_run?: string | null }).next_run ?? null,
      };

      /* ── adopted from an insight ───────────────────────────────────────── */
      if (adopted?.id) {
        const id = String(adopted.id);
        const automation = automationById(id);

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
        const blocked = requires
          ? !(await automationApplies(userId, automation as never, cache))
          : false;

        return {
          ...base,
          automationId: id,
          family: 'adopted',
          /* The catalogue's words, or the row's own name — never the raw id,
             which is what the list showed before these were resolved here. */
          name: say(automation?.nameKey) || agent.agent_name,
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
          blocked: false,
          requires: null,
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
        watches: '',
        scheduleWords: scheduleInWords(cron, say, interval),
        cadence: cadenceForCron(cron),
        stopAfterDays: null,
        blocked: false,
        requires: null,
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

  const days =
    typeof stored === 'number' && automation.stopAfterChoices.includes(stored)
      ? stored
      : automation.defaultStopAfterDays;

  return { stop_after_days: -Math.abs(days) };
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

/** The install of one automation, if this business has it. */
async function findInstall(userId: string, automation: AutomationAgent) {
  const { data } = await agentRepository.findByTag(userId, automationAgentTag(automation.id));
  /* First rather than single: `installAutomation` is what keeps there being
     one, and a read is the wrong place to throw over a duplicate it could
     simply report. */
  return data?.[0] ?? null;
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

export type InstallOutcome =
  | { ok: true; agentId: string; alreadyInstalled: boolean }
  | { ok: false; reason: 'create_failed' };

/**
 * Put this automation to work for this business.
 *
 * Idempotent: a second install returns the first one rather than creating a
 * twin. Two rows for one automation would both run on the same schedule, and
 * the owner would have no way to tell which of two identical entries to stop.
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
  schedule?: ScheduleInterval
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

  const existing = await findInstall(userId, automation);

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
    await refreshPlan(userId, existing, automation);

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
    plugins_required: automation.pluginsRequired,
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

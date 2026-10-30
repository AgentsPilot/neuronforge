/**
 * What a predefined automation agent IS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * One committed DSL plan and one entry here. Nothing else.
 *
 * The Gmail/Outlook channel looks like a lot of code for one agent, and almost
 * none of it is agent machinery: it carries a setup wizard because it has to
 * LEARN a mailbox rule from the owner's own mail, and it carries its own runner
 * because the platform scheduler was parked. A predefined automation needs
 * neither — the plan is written in advance, and the platform runs it.
 *
 * So adding an automation is adding data: a steps JSON and the entry below.
 * If a new automation ever needs a new file of logic, that is a signal the
 * mechanism is missing something, not that this one is special.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { AutomationRequirement } from '@/lib/business-os/gaps/automations';

/** Stable key. Also the agent's tag, so an install can be found again. */
export type AutomationAgentId =
  | 'chase_overdue_invoices'
  | 'follow_up_new_enquiries'
  | 'follow_up_stalled_deals'
  | 'rebook_quiet_clients'
  | 'recover_abandoned_checkouts'
  | 'win_back_quiet_clients';

/**
 * How often an automation may be set to run.
 *
 * Named cadences rather than cron strings, because this is a question put to a
 * business owner. The cron each one means lives in `CADENCE_CRON` below, so the
 * vocabulary and the schedule cannot drift.
 */
export type AutomationCadence =
  | 'daily'
  | 'every_3_days'
  | 'weekly'
  | 'fortnightly'
  | 'monthly';

export const CADENCE_CRON: Record<AutomationCadence, string> = {
  /* 09:00 UTC: inside the working day for most of Europe and the Middle East,
     and deliberately not midnight, when a send looks automated. */
  daily: '0 9 * * *',
  every_3_days: '0 9 */3 * *',
  weekly: '0 9 * * 1',
  fortnightly: '0 9 1,15 * *',
  /* The slowest we offer, and the only sensible speed for writing to people
     who have not been in touch for months. */
  monthly: '0 9 1 * *',
};

export interface AutomationAgent {
  id: AutomationAgentId;

  /**
   * Owner-facing name and sentence, as translation KEYS.
   *
   * Never literals: this registry is read server-side where no language is
   * resolved, and an English agent name in a Hebrew agent list is the seam the
   * rest of the product spends its comments removing.
   */
  nameKey: string;
  descriptionKey: string;

  /**
   * The insight this answers, by the process that insight suggests.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE ADVISOR CARD IS THE SURFACE. THIS IS THE JOIN.
   *
   * An insight carries `paired_process_id`, and the advisor already uses
   * exactly that field to find the operational automation covering it:
   *
   *     automation => automation.coversProcess === insight.paired_process_id
   *
   * So this is the existing join reused, not a new idea — which is why it is
   * keyed on the process rather than on the detector. Fourteen detectors map
   * to four processes, and an automation answers the PROCESS: one
   * invoice-chasing agent serves every detector that concludes "money is owed
   * and nobody is asking for it".
   *
   * Required, because an automation nothing can offer is an automation nobody
   * installs.
   * ───────────────────────────────────────────────────────────────────────────
   */
  answersProcess: string;

  /**
   * The specific detectors this answers, where the process alone is too coarse.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * EIGHT DETECTORS SHARE ONE PROCESS, AND THEY ARE NOT ONE DECISION.
   *
   * `send_followup_nudge` is the conclusion of eight detectors carrying four
   * different intents: a new enquiry, a stalled deal, a lapsed client, a
   * follow-up after an intro. Joined on the process alone, the first agent to
   * claim it would answer all eight — so approving "follow up on my enquiries"
   * would also approve emailing someone who stopped buying two years ago.
   *
   * That is not a finer shade of the same thing. A lapsed client is reached
   * under MARKETING consent with an opt-in gate the others do not need, and
   * one press cannot stand for both.
   *
   * So an agent may narrow itself to named detectors. The card carries
   * `insight.detector_id`, so the match is exact.
   *
   * Absent means "every detector that reaches my process" — right for an agent
   * that genuinely covers the whole of it, like the invoice chaser, whose four
   * detectors all mean the same thing.
   * ───────────────────────────────────────────────────────────────────────────
   */
  answersDetectors?: string[];

  /**
   * What it watches, as a short noun phrase.
   *
   * Separate from `descriptionKey`, which is the sentence that persuades
   * somebody to switch it on. This is the line the running-agents list needs:
   * "quotes nobody answered", "clients who stopped coming". An owner looking
   * down that list is asking what each one has its eye on, not being sold it
   * again.
   *
   * A key, like the others, because the list is read in the owner's language.
   */
  watchesKey: string;

  /**
   * Shipped, but never offered from an insight card.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * For an agent whose work is real and whose TREND nothing reports.
   *
   * `follow_up_stalled_deals` is the case. It chases quotes sent and never
   * answered, which is genuine work — but no detector reports that. The three
   * named "conversion" detectors are all about CONTACTS idling in a pipeline
   * stage, and the one detector that is about quotes,
   * `conv_quote_acceptance_drop`, deliberately carries no paired process: it
   * fires on quotes that were DECLINED, and chasing somebody who has already
   * said no is the wrong answer loudly.
   *
   * Without this flag such an agent is worse than absent. An agent naming no
   * detectors becomes the fallback for its whole process, so it would be
   * offered for every unclaimed detector that reaches `send_followup_nudge` —
   * and the live account showed exactly what that looks like: a card about two
   * contacts stuck at `lead`, neither of whom has ever been sent a quote,
   * offering to chase their quotes forever.
   * ───────────────────────────────────────────────────────────────────────────
   */
  offeredFromInsight?: false;

  /**
   * How long to keep trying, before giving up on one person.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE SECOND QUESTION THE INSTALL ASKS, AND THE OWNER'S TO ANSWER.
   *
   * Every plan already carries an end of life: quotes 45 days, invoices while
   * they are overdue, enquiries older than a week. Those were MY judgements,
   * written into committed data, and they are exactly the kind of judgement
   * that belongs to the person whose name is on the email. A business selling
   * a £4,000 course chases for longer than one selling a £40 haircut.
   *
   * Uniform across every agent, because it means the same thing each time:
   * STOP CONSIDERING ANYTHING OLDER THAN THIS. The plan spends it as the upper
   * bound of its find, so a person simply stops being selected — there is no
   * counter to keep and nothing to clean up.
   *
   * It is not the only way somebody leaves. They also leave by doing the thing:
   * paying the invoice, booking the slot, answering the quote. That is the
   * find's own business and needs no setting.
   * ───────────────────────────────────────────────────────────────────────────
   */
  stopAfterChoices: number[];
  defaultStopAfterDays: number;

  /**
   * What the business must already have for this to mean anything.
   *
   * Reuses the gaps registry's own vocabulary — `takes_bookings`,
   * `sends_quotes` and the rest — so one business shape answers both lists and
   * they cannot drift into disagreeing about what a business does.
   */
  requires?: AutomationRequirement;

  /**
   * The deterministic chaser this works ALONGSIDE, not instead of.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The two have different jobs and both keep theirs.
   *
   *   the chaser   fires on its milestone days — 1, 3 and 7 past due — and
   *                then stops. Finite, per item, end of life.
   *   the agent    keeps working the tail: the items the chaser has finished
   *                with and that are still not resolved.
   *
   * So an automation must NEVER act on something its chaser can still reach,
   * or a client gets two messages about one debt on the same morning. The plan
   * carries that boundary as a filter, which is why this field names the
   * chaser rather than switching it off: it is a statement about what the plan
   * must exclude, checked by the guard beside this file.
   * ───────────────────────────────────────────────────────────────────────────
   */
  worksAlongside?: string;

  /** Plugins the plan calls. Written onto the agent row for the runtime. */
  pluginsRequired: string[];

  /**
   * How often it runs, UNLESS the owner says otherwise.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A default, not a fixed property. The owner chooses the cadence before
   * activating, because how often a platform writes to their clients in their
   * name is their call and not ours — a weekly chaser and a daily one are
   * different relationships with the same customer.
   *
   * What ships here is the sensible starting point the install dialog offers
   * first. `installAutomation` takes an override.
   * ───────────────────────────────────────────────────────────────────────────
   */
  defaultCron: string;

  /**
   * The cadences the owner may pick from.
   *
   * A closed list rather than a free cron field: an owner choosing "every
   * minute" from a text box is a mailshot, and a cron expression is not
   * something to ask a small business to write.
   */
  cadenceChoices: AutomationCadence[];

  /**
   * The committed plan. Hand-authored, reviewed, identical for every business.
   *
   * Typed as `unknown[]` for the same reason `CreateAgentInput` is: the DSL's
   * step shape belongs to the V6 compiler, and restating it here would be a
   * second definition to keep in step.
   */
  steps: unknown[];
}

/**
 * A short fingerprint of a plan, so an install can tell whether it is current.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE PLAN IS COPIED AND THEN KEPT IN STEP, RATHER THAN REFERENCED
 *
 * Every owner gets their own `agents` row — that is what makes an automation
 * theirs to see, pause and remove — and the runtime reads the plan off that
 * row. So the plan has to be ON it; a row pointing at a catalogue the executor
 * never consults would simply not run.
 *
 * But a copy goes stale. The first version of the invoice chaser would have
 * emailed the same client every morning until they paid; that was fixed by
 * editing the plan, and under a plain copy the fix would have reached new
 * installs only — the owners already being chased daily would have kept being
 * chased daily.
 *
 * So: copy, stamp the version, and refresh when it moves. The fingerprint is
 * of the plan itself rather than a number somebody remembers to raise, because
 * a version that has to be maintained by hand is a version that silently is
 * not.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function planVersion(steps: unknown[]): string {
  const json = JSON.stringify(steps);
  /* FNV-1a. Not a security hash — this answers "did these bytes change", and
     a 32-bit answer is plenty for a handful of committed plans. */
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/** The tag an installed agent carries, so its install can be found again. */
export function automationAgentTag(id: AutomationAgentId): string {
  return `business-os-automation:${id}`;
}

/**
 * The tag EVERY installed automation agent carries.
 *
 * Deliberately separate from the per-agent tag above, and the pair mirrors the
 * channel's `inbox-enquiries` / `inbox-enquiries:google-mail`: one answers "is
 * this an automation agent at all" for a list or a runner, the other answers
 * "which one" for an install check.
 */
export const AUTOMATION_AGENT_TAG = 'business-os-automation';

'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Loader2, Check, Clock, Bot } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { useLanguage, type CurrencyCode } from '@/lib/business-os/LanguageContext';
/* The registry, for the one field that joins an insight to the standing
   automation doing the same work — see `nextStep` below. */
import { OPERATIONAL_AUTOMATIONS } from '@/lib/business-os/gaps/automations';
import { automationForInsight } from '@/lib/business-os/automations/catalog';
import type { ScheduleInterval } from '@/lib/business-os/schedule/interval';
import {
  cadenceRangeOf,
  stopAfterRangeOf,
  CADENCE_INTERVAL,
} from '@/lib/business-os/schedule/ranges';
import { IntervalPicker } from '@/components/business-os/schedule/IntervalPicker';
import { BeforeAfterPanel, type ProjectionColumn } from './BeforeAfterPanel';
import type { InsightData, InsightProjection } from './InsightDetailModal';

// ===========================
// Types
// ===========================

export type { InsightData, InsightProjection };

export interface AutomationConfig {
  processId: string;
  suggestedParams: Record<string, unknown>;
}

export type InsightCardState = 'default' | 'running' | 'completed' | 'automate_offer' | 'automated';

export type CardStage = 'setup' | 'win' | 'run' | 'automate';

/**
 * A job the platform is offering to take on, shown in this same carousel.
 *
 * Operational advice is still advice: the owner sees one card that sometimes
 * reports a pattern in the numbers and sometimes asks to handle a chore. Two
 * cards would have meant an advisor that changes costume depending on which
 * kind of help it is offering, which reads as two products — and, for a while,
 * meant a card offering advice above another announcing it had none.
 */
export interface OperationalItem {
  id: string;
  /** How many are waiting on this right now. Zero is offered too, quietly. */
  waiting: number;
  labelKey: string;
  hintKey: string;
  /**
   * Whether the owner has already switched this on, and whether they have said
   * no to it before.
   *
   * Both come from `/api/business-os/gaps` and were previously absent from this
   * type, so the card could not tell a running automation from an unanswered
   * offer and asked "shall I do this?" about jobs it was already doing. An
   * owner with all three enabled saw three pages inviting them to enable them.
   *
   * Optional so an older caller that omits them still renders the ask, which is
   * the safe reading of "we do not know".
   */
  enabled?: boolean;
  declined?: boolean;
  /**
   * The settings for an automation that has any.
   *
   * Only the meeting reminder does. Absent on the other three, which are a
   * plain yes or no, and the card renders its extra controls off the presence
   * of this object rather than off the automation's id — so the next one with
   * settings needs no change here.
   */
  settings?: OperationalSettings;
  /**
   * Notifications to the OWNER that ride along on this card without being part
   * of the automation.
   *
   * Separate from `settings` on purpose. A setting belongs to the automation and
   * is held locally until the approval carries it; this is already on, is about
   * writing to the owner rather than their client, and saves the moment it moves
   * whether the automation is running, declined or unanswered. See
   * `ownerAlertColumn` in the automations registry.
   */
  notifications?: OperationalNotifications;
}

/** What the owner can choose about the meeting reminder. */
export interface OperationalSettings {
  /** Lead time, in hours before the appointment. */
  hoursBefore: number;
  notifyClient: boolean;
  notifyOwner: boolean;
  /**
   * The tightest change deadline across the business's bookable services.
   *
   * Here so the picker can say what a lead time COSTS. The reminder invites the
   * client to reschedule, and the reschedule route refuses anything inside the
   * service's notice window — so with the default 24 hours, four of the five
   * choices below produce a link the client cannot use. Optional so a payload
   * that predates it still renders.
   */
  noticeHours?: number;
}

/** Whether the platform tells the OWNER, independent of the automation. */
export interface OperationalNotifications {
  alertOwner: boolean;
}

interface PendingInsight extends Omit<InsightData, 'eligible_for_automation'> {
  /**
   * The process that can act on this, when one exists.
   *
   * Absent on an advisory insight — a website page missing a call to action, a
   * blocked Stripe payout — where what would fix it is a different kind of
   * thing from the message-sending the kernel can do. The card reads this to
   * decide whether to offer the button at all.
   */
  paired_process_id?: string;
  projection?: InsightProjection;
  eligible_for_automation?: boolean;
  process_parameters?: Record<string, unknown>;
  affected_entity_type?: string;
}

interface InsightAdvisorCardProps {
  insights: PendingInsight[];
  /**
   * What this business's money is in, from the server.
   *
   * Used for ONE thing: the fallback impact figure below, when the server sent
   * no summary line of its own. Without it that figure takes its symbol from
   * localStorage, so a business billing in dollars can be told it could recover
   * "₪5,066" — a mislabel, not a conversion.
   */
  currency?: string | null;
  /**
   * Undecided automations, carouselled AFTER the insights.
   *
   * After rather than before: an insight is something the business did not
   * know, and it earns the first slot. An approval is asked once and then
   * never again, so it can wait a page.
   */
  operational?: OperationalItem[];
  /**
   * `settings` is sent with the answer rather than saved separately, so the
   * lead time an owner picked before pressing Approve is the one that takes
   * effect. Without it the first reminder would go out at the default and the
   * choice they made on screen would apply only from the second.
   */
  onOperationalDecide?: (
    id: string,
    approve: boolean,
    settings?: OperationalSettings
  ) => Promise<void>;
  /**
   * Save an owner notification on its own, with NO decision attached.
   *
   * A separate callback rather than a third argument to `onOperationalDecide`,
   * because the two must not share a request: that one always sends an answer,
   * and on an automation nobody has answered yet, sending `false` alongside a
   * notification change would record a decline the owner never gave.
   */
  onOperationalNotify?: (id: string, next: OperationalNotifications) => Promise<void>;
  currentIndex: number;
  projection?: InsightProjection;
  automationConfig?: AutomationConfig;
  stage?: CardStage;
  onIndexChange: (index: number) => void;
  /**
   * Returns false when the action was refused, so the card can stop claiming it
   * succeeded. Void is still accepted — an older caller that reports nothing is
   * treated as "no news", not as failure.
   */
  onAction: (action: 'run' | 'snooze' | 'dismiss', insightId: string, params?: Record<string, unknown>) => Promise<void | boolean>;
  /*
   * Returns whether it was actually automated, where the host can tell.
   *
   * `Promise<void>` is what this was, and the card's refusal guard compared the
   * result to `false` — dead against a type that can only be `undefined`. The
   * host had the answer all along; see `handleInsightAutomate`. `void` stays in
   * the union so a host that cannot report one still satisfies the prop.
   */
  onAutomate: (insightId: string, params: Record<string, unknown>) => Promise<void | boolean>;
  onDeclineAutomate: () => void;

  /**
   * An agent was installed and the server has closed this insight.
   *
   * The dashboard holds the list the carousel renders, so without a re-read
   * the card the owner just dealt with stays on screen offering an agent that
   * is already running. Deliberately NOT `onAutomate`, which posts the older
   * `automate` action and would write a second standing rule for one press.
   */
  onAgentInstalled?: () => void;

  /**
   * Automation ids this business already has installed.
   *
   * Two detectors can conclude the same thing — `cash_ar_overdue` and
   * `cash_revenue_at_risk` both reach `chase_overdue_invoices` — so switching
   * an agent on from one card leaves the other still offering to install it. A
   * second press is harmless, `installAutomation` is idempotent, but being
   * asked twice to solve a problem already being handled is not.
   */
  installedAutomationIds?: string[];
}

// ===========================
// Category badge colors
// ===========================

const CATEGORY_COLORS: Record<string, string> = {
  cash_flow: '#F59E0B',
  conversion: '#6366F1',
  ops: '#0EA5E9',
  retention: '#8B5CF6',
  leads: '#EC4899',
  pricing: '#F97316',
  win: '#22C55E',
  setup: '#6366F1',
};

// ===========================
// Running steps
// ===========================

const RUNNING_STEP_KEYS: Record<string, string[]> = {
  cash_ar_overdue: ['insight.step.cash_ar_overdue.1', 'insight.step.cash_ar_overdue.2', 'insight.step.cash_ar_overdue.3'],
  sales_stalled: ['insight.step.sales_stalled.1', 'insight.step.sales_stalled.2', 'insight.step.sales_stalled.3'],
  default: ['insight.step.default.1', 'insight.step.default.2', 'insight.step.default.3'],
};

/**
 * The lead times on offer, in hours before the appointment.
 *
 * A short list rather than a free number box. Every one of these is a sentence
 * somebody would say out loud — "an hour before", "the day before" — and a
 * field that accepts 37 invites an answer nobody means. The column takes
 * anything from 1 to 168, so a value set elsewhere still displays; it simply
 * is not one of the buttons.
 */
const REMINDER_LEADS = [1, 2, 3, 24, 48];

/**
 * A lead time in the words somebody would use for it.
 *
 * Whole days are said as days. "24 hours before" and "the day before" are the
 * same instant, and only one of them is how anyone describes when they want to
 * be reminded about Tuesday's appointment.
 */
function leadLabel(hours: number, t: (key: string) => string): string {
  if (hours >= 24 && hours % 24 === 0) {
    const days = hours / 24;
    return days === 1
      ? t('automation.reminder_day')
      : t('automation.reminder_days').replace('{n}', String(days));
  }
  return hours === 1
    ? t('automation.reminder_hour')
    : t('automation.reminder_hours').replace('{n}', String(hours));
}

const labelStyle: React.CSSProperties = {
  fontSize: '12.5px',
  fontWeight: 600,
  letterSpacing: '0.02em',
  color: 'var(--v2-text-secondary)',
  marginBottom: '8px',
};

/** A choice chip, selected or not. Same shape for both rows. */
function chipStyle(selected: boolean, isRTL: boolean): React.CSSProperties {
  return {
    border: selected ? '1.5px solid var(--v2-primary)' : '1.5px solid var(--v2-border)',
    background: selected
      /* `color-mix` is safe INLINE: an unsupported declaration is dropped and
         the chip falls back to transparent. The same expression as a Tailwind
         class would emit bare `var(--v2-primary)` as its fallback and paint the
         chip solid — the note in NeedsYouCard records that. */
      ? 'color-mix(in srgb, var(--v2-primary) 12%, transparent)'
      : 'transparent',
    color: selected ? 'var(--v2-text-primary)' : 'var(--v2-text-secondary)',
    borderRadius: '999px',
    padding: '7px 14px',
    fontSize: '13.5px',
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
  };
}

// ===========================
// Component (matching mockup .adv)
// ===========================

export function InsightAdvisorCard({
  currency,
  insights,
  operational = [],
  onOperationalDecide,
  currentIndex,
  projection,
  automationConfig,
  stage = 'run',
  onIndexChange,
  onAction,
  onAutomate,
  onDeclineAutomate,
  onOperationalNotify,
  onAgentInstalled,
  installedAutomationIds,
}: InsightAdvisorCardProps) {
  const { t, isRTL, formatCurrency } = useLanguage();
  const [cardState, setCardState] = useState<InsightCardState>('default');
  const [runningStep, setRunningStep] = useState(0);

  /*
   * How often it should run, chosen BEFORE it is switched on.
   *
   * This is the owner's decision, not ours: how often the platform writes to
   * their clients in their name is a different relationship at daily than at
   * fortnightly.
   *
   * A number and a unit, where it used to be one of five words. Those five all
   * fired at 09:00 and all meant a number of days, so an owner could not ask
   * for every ten days — and the mailbox wizard, asking the same question in
   * minutes, could not share the control. Undefined until the dialog opens, so
   * the automation's own default decides where it starts.
   */
  const [cadenceInterval, setCadenceInterval] = useState<ScheduleInterval | undefined>(
    undefined
  );

  /**
   * Why the install was refused, in the owner's language.
   *
   * Held rather than thrown: a refusal is an ordinary answer here, not an
   * error. Cleared when the card turns, with every other per-page state.
   */
  const [installRefusal, setInstallRefusal] = useState<string | null>(null);

  /**
   * The owner's end of life for one person.
   *
   * Still days on this dialog, and that is the RANGE's doing rather than this
   * control's: the bound reaches BizQL as `{{input.stop_after_days}}` inside a
   * `$date` offset measured in days, so hours here would be a fractional day.
   * Every automation's range starts at days, so hours are never offered.
   */
  const [stopAfterInterval, setStopAfterInterval] = useState<ScheduleInterval | undefined>(
    undefined
  );

  /** In flight, so a double press cannot become two agents. See `handleAutomate`. */
  const installing = useRef(false);

  const [autoValue, setAutoValue] = useState(
    (automationConfig?.suggestedParams?.days_threshold as number) || 14
  );
  const [vertical, setVertical] = useState<string | null>(null);

  /*
   * The reminder settings while the owner is choosing them.
   *
   * Held locally so the controls respond immediately, and re-seeded whenever
   * the card turns to a different page — the carousel reuses one component
   * across every automation, so without the effect below a lead time chosen on
   * one page would appear as the answer on the next.
   */
  const [reminder, setReminder] = useState<OperationalSettings | null>(null);

  /*
   * The owner alert, held locally only so the switch responds at once.
   *
   * Unlike `reminder`, every change is sent immediately and reverted if the save
   * is refused: this switch is already on and is not part of any approval, so
   * there is no later press for it to ride along with.
   */
  const [notifications, setNotifications] = useState<OperationalNotifications | null>(null);

  // Fetch user's vertical for personalized advisor badge
  useEffect(() => {
    async function fetchVertical() {
      try {
        const response = await fetch('/api/business-os/business-profile');
        if (response.ok) {
          const data = await response.json();
          if (data.success) {
            setVertical(data.vertical);
          }
        }
      } catch {
        // Silent fail
      }
    }
    fetchVertical();
  }, []);

  const insight = insights[currentIndex];

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * EVERY PAGE STARTS AS ITSELF.
   *
   * `cardState` belongs to the COMPONENT, and the carousel renders one
   * component for all thirteen pages. So a state set on page one — "running",
   * "handled", "completed" — was still set on page two, and on every page
   * after it.
   *
   * Reported from a live account: one press on the invoice card put a green
   * "Done · I'll keep an eye on this for you" on all thirteen, none of which
   * had been acted on. The press had in fact failed, which is the sibling bug
   * fixed in `handleAutomate` below, but the state spreading is what made it
   * look like the whole list had been handled at once.
   *
   * Keyed on the insight's own id rather than the index, so the list
   * reordering under a refresh cannot carry one card's state onto another.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    setCardState('default');
    setRunningStep(0);
    setInstallRefusal(null);
    /* Both answers, so a new card opens on ITS automation's defaults rather
       than on the last one's. Only the stop rule was cleared before, which
       left a cadence chosen for a different agent in place. */
    setCadenceInterval(undefined);
    setStopAfterInterval(undefined);
  }, [insight?.id]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE AGENT WE SHIP FOR THIS INSIGHT, IF WE SHIP ONE.
   *
   * Joined on `paired_process_id`, the same key the covering-automation lookup
   * below already uses. An insight is a trend; an agent is a worker installed
   * once that keeps handling it. Fourteen detectors reduce to four processes,
   * so one agent answers every detector that reaches the same conclusion.
   *
   * Null for most insights, and that is honest: there is then nothing to hand
   * over, and the card says what it always said.
   *
   * MUST stay below `insight`, which it reads. It was declared among the
   * `useState` calls at the top, where it reads naturally and crashes the page:
   * `const` is hoisted but not initialised, so the browser threw "Cannot access
   * 'insight' before initialization" the moment the card mounted. The hooks are
   * where state goes; this is derived from a prop and belongs with the other
   * derivations.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const offeredAgent = insight
    ? automationForInsight({
        detector_id: insight.detector_id,
        paired_process_id: insight.paired_process_id,
      })
    : undefined;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THIS AUTOMATION MAY BE SET TO, AND WHERE THE CONTROL OPENS.
   *
   * Derived from the `cadenceChoices` and `stopAfterChoices` it already
   * declares, so the walls cannot drift from the menu they replaced — and the
   * six catalogue files did not have to change at all.
   *
   * The control opens on the automation's own defaults, not on the floor: the
   * owner is being shown what we would have chosen for them, and asked whether
   * they agree.
   */
  const cadenceRange = offeredAgent
    ? cadenceRangeOf(offeredAgent)
    : { min: { every: 1, unit: 'days' as const }, max: { every: 1, unit: 'days' as const } };

  const stopAfterRange = offeredAgent
    ? stopAfterRangeOf(offeredAgent)
    : { min: { every: 1, unit: 'days' as const }, max: { every: 1, unit: 'days' as const } };

  const cadenceValue =
    cadenceInterval ??
    (offeredAgent ? CADENCE_INTERVAL[offeredAgent.cadenceChoices[0]] : cadenceRange.min);

  const stopAfterValue =
    stopAfterInterval ??
    (offeredAgent
      ? { every: offeredAgent.defaultStopAfterDays, unit: 'days' as const }
      : stopAfterRange.min);

  /*
   * The unit, agreeing with its number.
   *
   * Separate keys for one and many rather than a count glued to a word: "1 ימים"
   * is as wrong as "1 days", and Hebrew does not form a plural by adding a
   * letter to the singular.
   */
  const unitWord = (unit: 'minutes' | 'hours' | 'days', count: number) =>
    t(`automation.unit.${unit}${count === 1 ? '_one' : ''}`) || unit;

  /*
   * Already switched on, from this card or from another one reporting the same
   * problem. `cash_ar_overdue` and `cash_revenue_at_risk` both conclude
   * "money is owed and nobody is asking for it", so the agent installed from
   * one of them is already covering the other.
   */
  const agentAlreadyWorking = Boolean(
    offeredAgent && installedAutomationIds?.includes(offeredAgent.id)
  );

  /*
   * Past the insights, the carousel is showing an automation to approve.
   *
   * Indexed rather than interleaved so `onIndexChange` and the dots below stay
   * a single running position, which is what makes this one card rather than
   * two sharing a shell.
   */
  /*
   * Already sorted itself out.
   *
   * A resolved insight rides the carousel for a day so the owner sees what
   * happened to something they were told about. It must not offer to act: the
   * invoice is paid, the lead booked, and "Handle it for me" on a settled thing
   * is exactly the card that prompted this work.
   */
  const isResolved = insight?.status === 'resolved';
  /*
   * The owner did something about this, as opposed to it merely stopping being
   * reported. `acted` is set when they press the button; `automated` when they
   * turn the standing rule on. See the badge below for why the difference has
   * to be visible.
   */
  const wasHandled = insight?.status === 'acted' || insight?.status === 'automated';

  /**
   * WHAT HAPPENED, said from what the system actually recorded.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The owner's question, three times over, was "did it do anything?" — and the
   * card could not answer it. It knew the row was closed and nothing else, so
   * it picked the kindest reading and said the situation had cleared, on a card
   * still titled "4 overdue invoices totalling ₪1,300".
   *
   * Four different things end up looking the same from the status alone, and
   * they are not the same news:
   *
   *   messages went out        the useful answer, with the count and the date
   *   messages were QUEUED
   *     and never left         `skipped` — the owner thinks it was done
   *   the owner acted, and
   *     nothing was queued     asked for, nothing to show for it
   *   nobody acted at all      it simply stopped being reported
   *
   * `skipped` is not hypothetical: of seven queued rows on the reporting
   * account, three left and three were skipped. A card that said "handled,
   * therefore sent" would have been wrong about nearly half of them, which is
   * the kind of wrong that costs a client relationship rather than a click.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const closedState = (() => {
    const outcome = insight?.outcome;

    if (outcome && outcome.sent > 0) {
      const when = outcome.lastSentAt
        ? new Date(outcome.lastSentAt).toLocaleDateString(isRTL ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' })
        : '';
      return {
        badge: t('insight.badge.sent') || 'Done',
        line: (t('insight.closed.sent') || '{count} sent on {date}.')
          .replace('{count}', String(outcome.sent))
          .replace('{date}', when)
          .trim(),
      };
    }

    if (outcome && outcome.skipped > 0) {
      /* Named rather than softened. The owner pressed the button and nothing
         reached anybody; that is the one outcome they must not have to guess. */
      return {
        badge: t('insight.badge.nothing_sent') || 'Nothing sent',
        line: (t('insight.closed.skipped') || 'Nothing was sent — {count} were queued and did not go out.')
          .replace('{count}', String(outcome.skipped)),
      };
    }

    if (wasHandled) {
      return {
        badge: t('insight.badge.handled') || 'You asked for this',
        line: t('insight.closed.handled') || 'You asked me to handle this. Nothing has gone out yet.',
      };
    }

    /*
     * NOT "it sorted itself out".
     *
     * That is what the badge said, and it is a claim about the WORLD — the
     * invoices got paid, the client replied — made from a fact about our own
     * bookkeeping: a detector stopped reporting. On a card still headed "4
     * overdue invoices totalling ₪1,300", above a line saying nothing was sent,
     * it was the only part still contradicting the rest, and it is what the
     * owner kept asking about.
     *
     * We cannot tell "the problem went away" from "we stopped looking", so the
     * badge says the one thing we know — this card is closed — and the line
     * underneath says exactly what that meant. When the cooldown sweep fix is
     * live, `resolved` will again mean a detector looked and found nothing, and
     * a truthful "sorted itself out" becomes possible to say.
     */
    return {
      badge: t('insight.badge.resolved') || 'Closed',
      line: t('insight.closed.resolved') || 'This stopped being reported. Nothing was sent.',
    };
  })();

  const closedExplanation = closedState.line;

  /**
   * WHAT HAPPENS NEXT, where a standing automation already covers this work.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The other half of the owner's question. Knowing nothing was sent is only
   * half an answer if the invoice chaser has been running all along — and on
   * the reporting account it is: `chase_invoices_enabled` is true, and it
   * chases every unpaid invoice 72 hours after it falls due. A card that said
   * "nothing was sent" and stopped there would read as neglect when the work
   * was in hand the whole time.
   *
   * Joined on the process: the insight carries `paired_process_id`, and the
   * automation now declares the process it covers. `operational` already
   * carries every automation with its answer, so nothing new is fetched.
   *
   * Silent when no automation covers the process, which is honest — there is
   * then genuinely nothing standing by, and inventing a reassurance is how the
   * rest of this card went wrong.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const nextStep = (() => {
    if (!insight?.paired_process_id || !operational?.length) return null;

    const covering = OPERATIONAL_AUTOMATIONS.find(
      automation => automation.coversProcess === insight.paired_process_id
    );
    if (!covering) return null;

    const answer = operational.find(item => item.id === covering.id);
    if (!answer) return null;

    return answer.enabled
      ? t('insight.next.covered') || 'I chase these automatically from now on.'
      : t('insight.next.not_covered') || 'Nothing is set to chase these automatically.';
  })();

  const operationalItem =
    currentIndex >= insights.length ? operational[currentIndex - insights.length] : undefined;

  const totalPages = insights.length + operational.length;

  /*
   * Follow the page.
   *
   * Keyed on the automation's id rather than on the settings object, which is
   * a fresh literal on every fetch and would reset the owner's half-made
   * choice each time the dashboard refreshed.
   */
  const settingsFor = operationalItem?.settings;
  const settingsOwnerId = settingsFor ? operationalItem!.id : null;

  useEffect(() => {
    setReminder(settingsFor ? { ...settingsFor } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsOwnerId]);

  // Same follow-the-page rule, keyed on the id for the same reason.
  const notificationsFor = operationalItem?.notifications;
  const notificationsOwnerId = notificationsFor ? operationalItem!.id : null;

  useEffect(() => {
    setNotifications(notificationsFor ? { ...notificationsFor } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationsOwnerId]);

  // Setup stage only when there is genuinely nothing to say — an automation
  // waiting to be approved is something to say.
  const effectiveStage = operationalItem ? 'run' : !insight ? 'setup' : stage;

  // Setup stage content (Day 1 - no insights yet)
  const setupContent = {
    title: t('insight.setup.title') || 'Everything is built. None of it is on.',
    description: t('insight.setup.description') || 'I can\'t tell you anything about your business until your business is reachable. One button changes that, and I\'ve done the rest.',
    category: 'setup',
    primaryAction: t('insight.setup.action.primary') || 'Publish it',
    secondaryAction: t('insight.setup.action.secondary') || 'Show me what you built',
    projection: {
      left: {
        label: t('insight.setup.projection.left.label') || 'Right now',
        value: t('insight.setup.projection.left.value') || '0 ways in',
        subtext: t('insight.setup.projection.left.subtext') || 'nobody can find you',
      },
      right: {
        label: t('insight.setup.projection.right.label') || 'Two minutes from now',
        value: t('insight.setup.projection.right.value') || 'Live',
        subtext: t('insight.setup.projection.right.subtext') || 'Google usually indexes within the hour',
      },
    },
  };

  // Use setup content if no insight available
  const displayTitle = operationalItem
    ? t(operationalItem.labelKey)
    : insight?.title || setupContent.title;
  const displayDescription = operationalItem
    ? t(operationalItem.hintKey)
    : insight?.description || setupContent.description;
  const displayCategory = operationalItem ? 'ops' : insight?.category || setupContent.category;

  const categoryColor = CATEGORY_COLORS[displayCategory] || '#F97316';
  const stepKeys = insight ? (RUNNING_STEP_KEYS[insight.detector_id] || RUNNING_STEP_KEYS.default) : RUNNING_STEP_KEYS.default;
  const steps = stepKeys.map(key => t(key));
  const canAutomate = insight?.eligible_for_automation && automationConfig;

  /*
   * Whether "handle it for me" can do anything.
   *
   * An operational page always can — it is an approval. An insight can only if
   * it carries a process; thirteen detectors describe something no process
   * implements, and offering to run one was how the card came to report success
   * for work that never started.
   */
  const canRun =
    !isResolved && (!!operationalItem || !!insight?.paired_process_id || !!offeredAgent);

  // Get eyebrow text based on stage
  const getEyebrowText = () => {
    /*
     * Still "your advisor", as on every other page.
     *
     * Only the SUB line changes — which is how `setup`, `win` and `automate`
     * already work. Replacing the main line too made the operational page read
     * as a different card, which is the thing merging them was meant to stop.
     */
    if (operationalItem) {
      return { main: t('insight.advisor') || 'Your advisor', sub: t('automation.eyebrow') };
    }
    switch (effectiveStage) {
      case 'setup':
        return { main: t('insight.advisor') || 'Your advisor', sub: t('insight.stage.setup.eyebrow') || 'Nothing to advise on yet — so here\'s the only thing that matters' };
      case 'win':
        return { main: t('insight.advisor.noticed') || 'Your advisor noticed', sub: t('insight.stage.win.eyebrow') || 'A good thing, which is still worth telling you' };
      case 'automate':
        return { main: t('insight.advisor') || 'Your advisor', sub: t('insight.stage.automate.eyebrow') || 'Third time — so I\'d like to stop asking' };
      default:
        return { main: t('insight.advisor.noticed') || 'Your advisor noticed', sub: '' };
    }
  };

  // Get category label
  const getCategoryLabel = () => {
    if (operationalItem) return t('automation.category');
    if (effectiveStage === 'setup') {
      return t('insight.category.setup') || 'Getting you switched on';
    }
    const key = `insight.category.${displayCategory}`;
    const translated = t(key);
    return translated !== key ? translated : displayCategory;
  };

  // Get "seen" text for first occurrence tracking
  const getSeenText = () => {
    // An approval is a question, not an observation — nothing was "seen".
    if (operationalItem) return null;
    /*
     * NOTHING ABOUT AN OPEN QUESTION ON A CARD THAT IS CLOSED.
     *
     * Every line below describes an insight the owner still has to deal with —
     * "you have seen this before and it is still open", and the offer to take
     * it on permanently. On a resolved or handled card they contradict the card
     * itself: "the situation that raised this has cleared" sat directly above
     * "you have seen this a few times and it is still open", which is the
     * confusion the badge rewrite was supposed to end rather than move.
     *
     * One gate rather than three: a closed card is a badge, a title and a line
     * about what happened. Nothing on it may ask for a decision.
     */
    if (isResolved || wasHandled) return null;
    // No "seen" text for setup stage
    if (effectiveStage === 'setup') {
      return null;
    }
    if (effectiveStage === 'win') {
      return t('insight.seen.win') || 'Wins are the only thing I can honestly report this early — they\'re facts, not judgements.';
    }
    if (cardState === 'default' && insight) {
      /*
       * How many times this has actually been shown, not a guess.
       *
       * This line said "First time I've seen this" unconditionally, to every
       * owner, about an insight that may have been sitting on their dashboard
       * for a week — and it was true of nothing, because `surface_count` was
       * never incremented by anything. Now that it is, the sentence can be the
       * one the number supports.
       *
       * The count is what the server held when this list was fetched, so it
       * does not include the view happening right now: 0 really is the first
       * time.
       */
      /*
       * AND IT COUNTS VIEWS, SO IT MAY ONLY TALK ABOUT VIEWS.
       *
       * `surface_count` is incremented every time the dashboard fetches the
       * list, so it measures how often the OWNER LOOKED, not how often the
       * problem happened. The line at three or more said "this keeps coming
       * back" — a claim about recurrence, made from a page-load counter.
       *
       * On the reporting account one insight about one set of four invoices had
       * been seen 24 times, and another 64. Nothing had recurred; the dashboard
       * had been opened. Worse, that sentence is the nudge toward a standing
       * automation, so the platform was recommending an always-on rule on the
       * strength of refreshes.
       *
       * Persistence is what the number really supports, and it is a good reason
       * to offer the standing rule in its own right: this has been in front of
       * you repeatedly and is still not dealt with. The copy now says that.
       *
       * The stronger signal — how many separate insights this detector has
       * raised — is real (three `cash_ar_overdue` insights in a week on that
       * account) but is not on this row, so claiming it here would be inventing
       * it again.
       */
      const shown = insight.surface_count ?? 0;

      if (shown === 0) {
        return t('insight.seen.first') || 'First time I\'ve seen this. I\'ll offer to handle it standing once it has happened a few times.';
      }
      if (shown >= 3) {
        /*
         * THE STANDING OFFER ONLY WHERE THERE IS ONE TO MAKE.
         *
         * This sentence ends "I can handle it standing", and thirteen detectors
         * are `eligibleForAutomation: false` — there is no rule to switch on and
         * no button anywhere on the card. The refund-rate card offered it while
         * its own advice was "have a conversation with the clients who asked for
         * their money back": a phone call, by a person, which the platform
         * offered to take over permanently.
         *
         * The persistence half is still true and still worth saying, so only
         * the promise goes.
         */
        if (!insight.eligible_for_automation) {
          return t('insight.seen.repeated_manual')
            || 'This has been in front of you a few times now and is still open.';
        }
        return t('insight.seen.repeated') || 'This has been in front of you a few times now and is still open. If it is going to keep happening, I can handle it standing.';
      }
      return t('insight.seen.again') || 'You have seen this one before and it is still open.';
    }
    return null;
  };

  // Handle run action
  const handleRun = useCallback(async () => {
    if (!insight) return; // Don't run for setup stage
    setCardState('running');
    setRunningStep(0);

    /*
     * The card used to announce success on a timer, whatever the server said.
     *
     * `onAction`'s result was awaited and discarded, while this interval marched
     * to "completed" on its own — so an insight whose paired process does not
     * exist (the server answers 400, `Process X not found`) still told the owner
     * the job was done. Nothing had run, the insight was never marked acted, and
     * it reappeared on the next load having apparently already been handled.
     *
     * The flag is read by the timer at fire time rather than checked before it
     * is scheduled, because the refusal usually arrives while the animation is
     * still playing and would otherwise land after the state it needs to stop.
     */
    let refused = false;

    const interval = setInterval(() => {
      setRunningStep(prev => {
        if (prev >= steps.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            if (refused) return;
            setCardState(canAutomate ? 'automate_offer' : 'completed');
          }, 500);
          return prev;
        }
        return prev + 1;
      });
    }, 800);

    const ran = await onAction('run', insight.id);

    if (ran === false) {
      refused = true;
      clearInterval(interval);
      // Back to the offer, not to a success state: the work did not happen and
      // the button should still be there.
      setCardState('default');
    }
  }, [insight, onAction, steps.length, canAutomate]);

  /**
   * Approve or decline the automation on this page.
   *
   * Deliberately NOT routed through `cardState`: the running/completed states
   * narrate a job being carried out, and this is a permission being granted for
   * jobs not yet due. The page simply leaves the carousel once answered,
   * because the parent stops sending it.
   */
  /**
   * What this operational page is: a job already running, one turned down, or a
   * question not yet answered.
   *
   * Drives both buttons. Without it the card asked "shall I do this?" about
   * automations the owner had already switched on, because the only thing it
   * knew about them was the label.
   */
  const operationalState: 'on' | 'off' | 'unanswered' | null = !operationalItem
    ? null
    : operationalItem.enabled
      ? 'on'
      : operationalItem.declined
        ? 'off'
        : 'unanswered';

  const handleDecide = useCallback(
    async (approve: boolean) => {
      if (!operationalItem || !onOperationalDecide) return;
      // Settings ride along with the approval — see the prop's doc comment.
      await onOperationalDecide(operationalItem.id, approve, reminder ?? undefined);
      onIndexChange(0);
    },
    [operationalItem, onOperationalDecide, onIndexChange, reminder]
  );

  /**
   * Change a setting on an automation that is already running.
   *
   * Saved as it is changed rather than behind a Save button: there is no other
   * screen for these, and a control that looks like it took effect and did not
   * is the worse failure. The carousel deliberately does NOT move — the owner
   * is adjusting the thing in front of them, not answering a question.
   *
   * While it is still off, the change stays local and goes with the approval.
   */
  const handleSettings = useCallback(
    (next: OperationalSettings) => {
      setReminder(next);
      if (operationalItem?.enabled && onOperationalDecide) {
        /*
         * Only the three WRITABLE fields go up. `noticeHours` is derived from the
         * services and comes down from the gaps API to explain the choice — it is
         * not the owner's to set. The save route's Zod is not strict today so an
         * extra key would be stripped silently, which is precisely why sending it
         * is worth avoiding: the day somebody adds `.strict()`, every lead-time
         * change would start failing for a reason nobody would look for here.
         */
        void onOperationalDecide(operationalItem.id, true, {
          hoursBefore: next.hoursBefore,
          notifyClient: next.notifyClient,
          notifyOwner: next.notifyOwner,
        });
      }
    },
    [operationalItem, onOperationalDecide]
  );

  /**
   * Change an owner notification. Always saved, never deferred.
   *
   * The opposite of `handleSettings` above, which holds the choice until the
   * approval carries it. There is no approval here to wait for: the alert is on
   * from the day the account exists, and somebody switching it off is not
   * answering a question about the automation. Deferring it would show a switch
   * that moved and changed nothing.
   *
   * Reverted on refusal, so the card cannot claim a save the server declined.
   */
  const handleNotifications = useCallback(
    async (next: OperationalNotifications) => {
      if (!operationalItem || !onOperationalNotify) return;
      const previous = notifications;
      setNotifications(next);
      try {
        await onOperationalNotify(operationalItem.id, next);
      } catch {
        setNotifications(previous);
      }
    },
    [operationalItem, onOperationalNotify, notifications]
  );

  // Handle automate
  const handleAutomate = useCallback(async () => {
    if (!insight) return;

    /*
     * ───────────────────────────────────────────────────────────────────────
     * ONE PRESS IS ONE PRESS.
     *
     * A browser under memory pressure fired this four times in ten
     * milliseconds and created four live agents, each scheduled, each about to
     * write to the same clients. The database now refuses the duplicates —
     * `agents_one_automation_per_user` — and this is the half that stops the
     * requests leaving at all, which is the difference between a race the
     * server has to resolve and no race.
     *
     * A ref rather than state: state updates are batched and asynchronous, so
     * a second press in the same tick would read the old value and go.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (installing.current) return;
    installing.current = true;

    try {

    /*
     * An agent, where we ship one for this insight's process.
     *
     * It creates the owner's own `agents` row — which is what makes it
     * something they can see, pause and remove — and carries the cadence they
     * chose. The older path wrote a rule with no way to stop it, and told the
     * owner to "turn it off in Operation", a screen that does not exist.
     */
    if (offeredAgent) {
      const response = await fetch('/api/business-os/automation-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          automationId: offeredAgent.id,
          /*
           * Both choices travel together: how often, and until when.
           *
           * `schedule` is the answer the owner gave; `stopAfterDays` is the
           * other one, still in days because every automation's range starts
           * there. The server clamps both to the automation's own range, so a
           * stale tab cannot set a cadence the catalogue refused.
           */
          schedule: cadenceValue,
          stopAfterDays: stopAfterValue.every,
          /*
           * So the card closes.
           *
           * The server marks this insight `automated`, which is not an open
           * status, and it leaves the carousel. Without it the install
           * succeeded and the insight stayed `new`: `cardState` showed the
           * owner it was handled until they reloaded, and then the same card
           * was back offering an agent already running. Re-pressing was
           * harmless — `installAutomation` is idempotent — but nothing said so.
           */
          insightId: insight.id,
        }),
      });

      /*
       * ───────────────────────────────────────────────────────────────────
       * A REFUSAL MUST SAY SOMETHING. RETURNING QUIETLY IS A DEAD BUTTON.
       *
       * The commonest refusal is `409 requirement_unmet`: the agent needs
       * something this business does not have yet. Today that is almost always
       * `can_send_marketing` — an automated booking invite is a solicitation,
       * and `MARKETING_SENDING_ENABLED` is false platform-wide until
       * unsubscribe support ships, so the transport would refuse every send.
       *
       * Refusing the install is right. Refusing it in silence is not: the
       * owner picks a cadence, presses, and the card does nothing at all.
       * ───────────────────────────────────────────────────────────────────
       */
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));

        setInstallRefusal(
          body?.code === 'requirement_unmet' && body?.requires
            ? t(`automation.requires.${body.requires}`) ||
                t('automation.requires.default') ||
                'This one cannot run for your business yet.'
            : t('automation.install_failed') || 'I could not switch that on. Try again in a moment.'
        );
        return;
      }

      /*
       * And NOT `onAutomate`, which is the older path: it posts the `automate`
       * action, and that writes an `insight_automations` row of its own before
       * marking the insight. One press would leave two standing rules for one
       * job — the collision this codebase has documented three times.
       *
       * So the card shows the handled state from here, and the carousel drops
       * the insight on the dashboard's next refresh, by which time the server
       * has already closed it.
       */
      /*
       * Tell the running-agents card to re-read itself.
       *
       * It loads once on mount, so without this the agent the owner just
       * switched on does not appear until the next page load — and the card
       * that was supposed to show "here is what is now working for you" sits
       * there unchanged, which reads as the install having failed.
       *
       * An event rather than shared state: the two cards are siblings under a
       * dashboard that owns neither, and threading a refresh callback through
       * it would make the advisor card depend on a list it knows nothing about.
       */
      window.dispatchEvent(new CustomEvent('business-os:automation-installed'));

      /* And the dashboard re-reads its insights, so this card goes with it. */
      onAgentInstalled?.();

      setCardState('automated');
      return;
    }

    /*
     * ───────────────────────────────────────────────────────────────────────
     * AND THE OLDER PATH MUST ALSO BE ABLE TO SAY NO.
     *
     * This announced success whatever came back, exactly as `handleRun` did
     * before its own fix — the comment there records the same lesson.
     *
     * It is not a rare branch. An insight whose `paired_process_id` is null is
     * answered `400 This insight has no process to automate`, and detectors
     * withhold that field on purpose: the revenue-at-risk card drops it on a
     * run where nothing outstanding is an INVOICE, because the chase could
     * not touch an instalment or a quote. On a live account the owner pressed
     * it on a ₪4,600 card, the server refused, and the card said "Done · I'll
     * keep an eye on this for you". Nothing was created: no agent, no standing
     * rule, and the insight was still `new` the next morning.
     * ───────────────────────────────────────────────────────────────────────
     */
      const done = await onAutomate(insight.id, { days_threshold: autoValue });

      if (done === false) return;

      setCardState('automated');
    } finally {
      installing.current = false;
    }
  }, [insight, autoValue, onAutomate, offeredAgent, cadenceValue, stopAfterValue, onAgentInstalled, t]);

  /**
   * "I got it" — the ending for a card whose work an agent already has.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Two detectors can report the same problem at different altitudes, and the
   * overlap registry keeps both cards on purpose: `cash_ar_overdue` names the
   * four invoices that are late, `cash_revenue_at_risk` names everything
   * outstanding. Switching the agent on from one leaves the other open about
   * work already being handled, and the owner's only way out was to dismiss it
   * — which records "this did not matter" against something that did.
   *
   * `acknowledgeOnly` so the server marks the insight and touches NO agent. A
   * second install would reach `installAutomation`, which reads a re-install of
   * a paused agent as the owner asking for it back and reactivates it. Pressing
   * "I got it" must never un-pause something they deliberately stopped.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const handleAgentCovers = useCallback(async () => {
    if (!insight || !offeredAgent) return;

    const response = await fetch('/api/business-os/automation-agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        automationId: offeredAgent.id,
        insightId: insight.id,
        acknowledgeOnly: true,
      }),
    });

    if (!response.ok) {
      setInstallRefusal(
        t('automation.install_failed') || 'I could not close that. Try again in a moment.'
      );
      return;
    }

    setCardState('automated');
    onAgentInstalled?.();
  }, [insight, offeredAgent, onAgentInstalled, t]);

  // Handle decline automate
  const handleDeclineAutomate = useCallback(() => {
    setCardState('completed');
    onDeclineAutomate();
  }, [onDeclineAutomate]);

  // Handle dismiss
  const handleDismiss = useCallback(async () => {
    if (!insight) return;
    await onAction('dismiss', insight.id);
  }, [insight, onAction]);

  // Step automation threshold
  const stepAutoValue = (delta: number) => {
    setAutoValue(Math.max(7, Math.min(45, autoValue + delta * 7)));
  };

  /**
   * Projection copy in the reader's language.
   *
   * The projector runs on the server with no access to the interface language,
   * so it sends a dictionary key and the numbers to fill it, alongside an
   * English rendering. Prefer the key; fall back to the English only when there
   * is no key or the dictionary has no entry — `t` returns the key itself when
   * a string is missing, which would otherwise print `insight.generic.do_nothing`
   * on the card.
   *
   * Without this the panel showed the server's English under a Hebrew heading.
   */
  const renderLine = (
    line: { text: string; key?: string; params?: Record<string, string | number> } | undefined,
    fallback: string | undefined
  ): string => {
    if (line?.key) {
      const translated = t(line.key, line.params);
      if (translated && translated !== line.key) return translated;
    }
    return line?.text || fallback || '';
  };

  // Build projection columns for BeforeAfterPanel
  const projectionColumns: { left: ProjectionColumn; right: ProjectionColumn } | null =
    effectiveStage === 'setup'
      ? setupContent.projection
      : projection
        ? {
            // These read `doNothing` / `letMeHandleIt`, the field names the
            // projection actually carries. They were snake_case here, so every
            // projection silently fell through to the generic fallback text.
            left: {
              label: t('insight.projection.do_nothing') || 'If you do nothing',
              value: renderLine(projection.doNothing?.summaryLine, projection.doNothing?.summary)
                || `${insight?.affected_count || 0} outstanding`,
              subtext: renderLine(projection.doNothing?.detailsLine, projection.doNothing?.details),
            },
            right: {
              /*
               * "IF I HANDLE IT" ONLY WHERE I CAN.
               *
               * ───────────────────────────────────────────────────────────────
               * Thirteen detectors describe something no process can act on,
               * and this column promised the platform would act on every one of
               * them. The refund-rate card is the clearest: its advice is "have
               * a conversation with the clients who asked for their money back"
               * — a phone call, by a person — printed under a heading saying
               * the platform would handle it, with no button anywhere on the
               * card because `canRun` had correctly decided there was nothing
               * to press.
               *
               * So the card contradicted itself twice over: it offered to do
               * the work, gave no way to accept, and the work was never ours to
               * do. The advice is good; the heading was the lie.
               * ───────────────────────────────────────────────────────────────
               */
              label: canRun
                ? t('insight.projection.handle_it') || 'If I handle it'
                : t('insight.projection.what_to_do') || 'What to do about it',
              /*
               * ───────────────────────────────────────────────────────────────
               * WHERE AN AGENT IS WHAT THE BUTTON INSTALLS, SAY THAT.
               *
               * The projector writes "I chase all 4 today", which described the
               * one-off: queue these items, a cron sends them within the hour.
               * The button no longer does that. It installs an agent that runs
               * on the cadence the owner is about to choose, so "today" is
               * wrong on both counts — not today, and not just these four.
               *
               * The projector cannot know this: it runs server-side off the
               * detector and has never heard of the catalogue. The card has
               * `offeredAgent` in its hand, so the override belongs here.
               *
               * Insights we ship no agent for keep the projector's line, which
               * is still exactly true for them.
               * ───────────────────────────────────────────────────────────────
               */
              value: (offeredAgent
                ? agentAlreadyWorking
                  /* Present tense, because it is already true. "I'll take
                     these over" on a card whose agent has been running since
                     Tuesday is an offer the owner already accepted. */
                  ? t('insight.projection.agent_on_it')
                  : t('insight.projection.agent_takes_over')
                : '')
                || renderLine(projection.letMeHandleIt?.summaryLine, projection.letMeHandleIt?.summary)
                || `~${formatCurrency(insight?.estimated_impact_usd || 0, {
                  showFree: false,
                  /*
                   * The FALLBACK label only — the line above is written by the
                   * server, which already formats money in the business's own
                   * currency (`formatMoney` in InsightRepository). This runs
                   * when no summary line came back, and without an override it
                   * would wear whatever symbol this browser is set to.
                   */
                  currencyOverride: (currency ?? undefined) as CurrencyCode | undefined,
                })} recovered`,
              /* The agent's own sentence underneath, so the column says what it
                 will watch as well as that somebody is now watching. */
              subtext: offeredAgent
                ? t(offeredAgent.watchesKey)
                : renderLine(projection.letMeHandleIt?.detailsLine, projection.letMeHandleIt?.details),
            },
          }
        : null;

  const eyebrow = getEyebrowText();
  const seenText = getSeenText();

  /**
   * Left and right step through the pages.
   *
   * The keys are read as screen directions, not as back and forward: in Hebrew
   * the card is laid out right-to-left, so the left key moves the way the eye
   * expects it to on that screen, which is onward. Anyone who has ever used an
   * arrow key on a carousel expects the key to follow the layout.
   *
   * Nothing is intercepted while the reader is typing. There is no text input
   * on this card today, and there is no reason for a future one to lose its
   * cursor keys to a pager.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;

      const forward = isRTL ? event.key === 'ArrowLeft' : event.key === 'ArrowRight';
      const next = forward ? currentIndex + 1 : currentIndex - 1;

      if (next < 0 || next >= totalPages) return;

      event.preventDefault();
      onIndexChange(next);
    },
    [currentIndex, totalPages, isRTL, onIndexChange]
  );

  // CSS Reference from mockup:
  // .adv{background:var(--card);border:1px solid var(--line);border-radius:22px;box-shadow:0 26px 60px -32px rgba(20,26,44,.3);overflow:hidden;margin-bottom:16px}
  // .adv-in{padding:20px 22px}
  // .adv-top{display:flex;align-items:center;gap:11px;margin-bottom:12px}
  // .adv-orb{width:30px;height:30px;border-radius:50%;background:var(--aurora);flex:none;box-shadow:0 0 0 5px rgba(249,115,22,.12)}
  // .adv-ey{font-size:12.5px;font-weight:600;color:var(--violet)}
  // .adv-ey small{display:block;font-weight:400;color:var(--muted);font-size:11.5px}
  // .adv-vt{margin-left:auto;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;background:#F1F3F8;color:var(--muted);padding:5px 11px;border-radius:20px;white-space:nowrap}
  // .adv-h{font-family:var(--display);font-size:clamp(19px,2.6vw,23px);font-weight:600;letter-spacing:-.025em;margin-bottom:7px;line-height:1.25}
  // .adv-p{font-size:14.5px;color:var(--muted);max-width:46rem}

  return (
    <div
      className="adv"
      /*
       * Arrow keys move between pages.
       *
       * `role="group"` with a name, rather than a listbox or a tablist: this is
       * a set of cards shown one at a time, not a set of options being chosen
       * between, and announcing it as a chooser would promise a screen reader
       * something the card does not do.
       *
       * `tabIndex={-1}` makes the container focusable by script and click but
       * keeps it out of the tab order, so nobody tabbing through the dashboard
       * lands on a whole card before reaching its buttons.
       */
      role={totalPages > 1 ? 'group' : undefined}
      aria-roledescription={totalPages > 1 ? t('insight.nav.carousel') || 'Carousel' : undefined}
      aria-label={totalPages > 1 ? t('insight.nav.position', { current: currentIndex + 1, total: totalPages }) : undefined}
      tabIndex={totalPages > 1 ? -1 : undefined}
      onKeyDown={totalPages > 1 ? handleKeyDown : undefined}
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: '22px',
        boxShadow: '0 26px 60px -32px rgba(20,26,44,0.3)',
        overflow: 'hidden',
        marginBottom: '16px',
      }}
    >
      {/* Main content area: .adv-in */}
      <div className="adv-in" style={{ padding: '20px 22px' }}>
        {/* Top row: .adv-top */}
        <div
          className="adv-top"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '11px',
            marginBottom: '12px',
            /*
             * Wrap rather than overflow.
             *
             * This row carries the orb, the eyebrow, the category badge and now
             * the pager with two arrows either side. On a narrow phone that is
             * more than fits, and the pager is the part that would have been
             * pushed off the edge — the control the reader is least likely to
             * already know about. Wrapping costs a line only when the
             * alternative was losing it.
             */
            flexWrap: 'wrap',
            rowGap: '8px',
          }}
        >
          {/*
            ───────────────────────────────────────────────────────────────────
            THE ADVISOR'S MARK, AND IT SAYS WHAT IT IS.

            This was a plain gradient circle. It read as a decoration or an
            avatar placeholder — a coloured dot beside "your advisor noticed",
            which told a reader nothing about where the noticing came from.

            `Bot` is the mark, and it is the same glyph the agents card and the
            bookings tab use. Those two mean "a machine did this without a
            person", and the advisor is the same machine speaking before it
            does anything — so one glyph across all three reads as one worker
            rather than three unrelated features.

            The orange stays. The accent is the advisor's identity and this is
            not a control — see the button guard for where the line falls.
            ───────────────────────────────────────────────────────────────────
          */}
          <span
            className="adv-orb"
            style={{
              width: '30px',
              height: '30px',
              borderRadius: '9px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              /* The tint rather than the solid fill: a 30px block of saturated
                 orange beside orange text is two loud things in one line. */
              background: 'rgba(249,115,22,0.14)',
              color: '#F97316',
              flexShrink: 0,
            }}
          >
            <Bot className="w-4 h-4" strokeWidth={2.25} />
          </span>

          {/* Eyebrow text: .adv-ey */}
          <span
            className="adv-ey"
            style={{
              fontSize: '12.5px',
              fontWeight: 600,
              color: '#F97316',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {eyebrow.main}
            {eyebrow.sub && (
              <small
                style={{
                  display: 'block',
                  fontWeight: 400,
                  color: 'var(--v2-text-secondary)',
                  fontSize: '11.5px',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {eyebrow.sub}
              </small>
            )}
          </span>

          {/* Category badge: .adv-vt */}
          <span
            className="adv-vt"
            style={{
              marginLeft: isRTL ? undefined : 'auto',
              marginRight: isRTL ? 'auto' : undefined,
              fontSize: '11px',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              background: 'var(--v2-bg)',
              color: 'var(--v2-text-secondary)',
              padding: '5px 11px',
              borderRadius: '20px',
              whiteSpace: 'nowrap',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {getCategoryLabel()}
          </span>

          {/* Which of several insights this is, and a way to reach the others.
              The card only ever shows one at a time, so without this the rest
              are invisible — the parent has always tracked the index and passed
              onIndexChange; nothing rendered a control for it. */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
              <span
                style={{
                  fontSize: '11.5px',
                  fontWeight: 500,
                  color: 'var(--v2-text-secondary)',
                  whiteSpace: 'nowrap',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {t('insight.nav.position', { current: currentIndex + 1, total: totalPages })}
              </span>
              {/*
                An arrow either side of the dots.

                The dots alone said how many there were without saying that
                anything could be done about it — they read as a progress
                indicator, which is what people took them for. An arrow is the
                one control everyone already knows means "there is another one
                that way", and at the first page the forward arrow is the only
                lit thing in the row, which is the signal that was missing.

                Disabled at the ends rather than wrapping, so the extent is
                legible: a dimmed back arrow on page one says this is the
                beginning, where wrapping would just move without explaining.
              */}
              <PagerArrow
                direction="back"
                isRTL={isRTL}
                disabled={currentIndex === 0}
                label={t('insight.nav.prev') || 'Previous'}
                onClick={() => onIndexChange(currentIndex - 1)}
              />

              {/* Gap lives in the buttons' padding now, so the space between
                  dots is part of a hit area rather than a dead zone. */}
              <div style={{ display: 'flex', gap: 0 }}>
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => onIndexChange(i)}
                    aria-label={t('insight.nav.goTo', { number: i + 1 })}
                    aria-current={i === currentIndex}
                    style={{
                      /*
                       * The button is the hit area; the dot inside it is the
                       * picture. They used to be the same element, which made
                       * the control for changing page a 6-pixel square — small
                       * enough that missing it reads as the card being stuck
                       * rather than as a missed tap. The dot is unchanged; what
                       * changed is how much of the space around it responds.
                       */
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: '22px',
                      padding: '0 4px',
                      border: 'none',
                      background: 'transparent',
                      cursor: i === currentIndex ? 'default' : 'pointer',
                    }}
                  >
                    <span
                      aria-hidden="true"
                      style={{
                        // The active one is a stadium rather than a bigger dot:
                        // size alone is hard to read at 6px, length is not.
                        width: i === currentIndex ? '14px' : '6px',
                        height: '6px',
                        borderRadius: i === currentIndex ? '4px' : '50%',
                        // Inactive dots ride the theme's border colour; the
                        // fixed light grey was near-white on a dark card.
                        /* The advisor's accent, deliberately. The carousel is
                           chrome rather than an action: the dots and the arrows
                           say where you are in the card, and the platform's
                           button colour belongs to things that DO something. */
                        background: i === currentIndex ? '#F97316' : 'var(--v2-border)',
                        transition: 'width 0.2s, background 0.2s',
                      }}
                    />
                  </button>
                ))}
              </div>

              <PagerArrow
                direction="forward"
                isRTL={isRTL}
                disabled={currentIndex >= totalPages - 1}
                label={t('insight.nav.next') || 'Next'}
                onClick={() => onIndexChange(currentIndex + 1)}
              />
            </div>
          )}
        </div>

        {/*
          * ALREADY SORTED, SAID WHERE IT IS READ.
          *
          * A resolved insight rides the carousel for a day so the owner sees
          * what happened to something they were told about. Until now the only
          * sign of that was the secondary button reading "Got it" instead of
          * "Not now" — the headline and the body rendered identically to a live
          * problem.
          *
          * So "1 contact stuck in your pipeline" looked exactly the same
          * whether somebody was stuck right now or had been unstuck yesterday.
          * An owner read it as current, went looking at the pipeline diagram,
          * found nothing marked, and concluded the dashboard was broken. That
          * is the report this fixes.
          *
          * A chip rather than a tense change: the stored title is written by
          * the detector in the owner's language and is not ours to rewrite
          * here.
          */}
        {/* Shown for BOTH, because the two are different facts the owner needs:
            one says they dealt with it, the other that it stopped being
            reported. Previously an `acted` insight carried no badge at all,
            so the one case where "handled" was true was the one case that did
            not say so. */}
        {(isResolved || wasHandled) && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              marginBottom: '8px',
              padding: '3px 9px',
              borderRadius: '999px',
              fontSize: '11.5px',
              fontWeight: 600,
              letterSpacing: '0.02em',
              color: 'var(--v2-success-text, #065F46)',
              background: 'var(--v2-success-bg, #ECFDF5)',
              border: '1px solid var(--v2-success-border, #BBF7D0)',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width="12"
              height="12"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {/*
              "HANDLED" AND "CLOSED" ARE NOT THE SAME CLAIM.

              ─────────────────────────────────────────────────────────────────
              This badge said "already handled" for anything `resolved`, and
              `resolved` is written by the nightly sweep when a detector stops
              reporting — not by the owner doing anything. `acted` is the status
              that means they pressed the button, and it was never read here.

              So an insight nobody had touched announced itself as handled, and
              the owner could not tell from the card whether they had acted on
              it. On the reporting account exactly that happened: a card for
              four overdue invoices read "already handled" with `acted_at` null,
              while the one they HAD acted on three days earlier — which really
              did queue and send three reminders — carried no badge at all.

              `automated` counts as handled too: a standing rule is the owner
              deciding, once, that this is taken care of from now on.
              ─────────────────────────────────────────────────────────────────
            */}
            {closedState.badge}
          </div>
        )}

        {/* Headline: .adv-h */}
        <div
          className="adv-h"
          style={{
            fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
            fontSize: 'clamp(19px, 2.6vw, 23px)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            marginBottom: '7px',
            lineHeight: 1.25,
            /*
             * Softened, not greyed out. A resolved insight is still worth
             * reading — it is the record of something that got dealt with — so
             * it must not look disabled, only settled.
             */
            color: isResolved ? 'var(--v2-text-secondary)' : 'var(--v2-text-primary)',
          }}
        >
          {displayTitle}
        </div>

        {/*
          Description — AND NOT THE PROBLEM AGAIN ONCE THE CARD IS CLOSED.

          ───────────────────────────────────────────────────────────────────
          This rendered the detector's own problem statement in every state, so
          a closed card carried a badge saying it was over directly above a
          paragraph insisting it was not: "sorted itself out" on top of "you
          have 4 unpaid invoices totalling ₪1,300". Whatever the badge was
          reworded to, the two halves went on contradicting each other, because
          only one of them had been told the card was finished.

          The title stays — it is how the owner knows WHICH card this is — and
          the body becomes a line about the state instead. Deliberately a plain
          statement and nothing more: what was actually SENT lives in the action
          queue, not on this row, and some of those rows end `skipped`, so a
          card promising delivery from here would be the next thing to be wrong.
          ───────────────────────────────────────────────────────────────────
        */}
        {isResolved || wasHandled ? (
          <div
            className="adv-p"
            style={{
              fontSize: '14.5px',
              color: 'var(--v2-text-muted)',
              maxWidth: '46rem',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              lineHeight: 1.5,
            }}
          >
            {closedExplanation}
            {/* What is already standing by, on the line below rather than
                folded into the sentence above: one is what happened, the other
                is what happens next, and running them together is how "nothing
                was sent" came to read as "nothing will be". */}
            {nextStep && (
              <div style={{ marginTop: '4px', color: 'var(--v2-text-secondary)' }}>
                {nextStep}
              </div>
            )}
          </div>
        ) : (
          <div
            className="adv-p"
            style={{
              fontSize: '14.5px',
              color: 'var(--v2-text-secondary)',
              maxWidth: '46rem',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              lineHeight: 1.5,
            }}
            dangerouslySetInnerHTML={{ __html: displayDescription }}
          />
        )}

        {/*
          What is waiting on this right now.
          
          The whole reason an approval is asked HERE and not on a settings
          screen: a count turns "enable invoice chasing" into "three invoices
          are past due, shall I chase them" — a decision somebody can make
          rather than a checkbox they skip.
        */}
        {operationalItem && operationalItem.waiting > 0 && (
          <div
            style={{
              marginTop: '14px',
              border: '1.5px solid rgba(249, 115, 22, 0.30)',
              background: 'linear-gradient(180deg, rgba(249, 115, 22, 0.10), rgba(249, 115, 22, 0.03))',
              borderRadius: '16px',
              padding: '13px 16px',
              fontSize: '14px',
              color: 'var(--v2-text-primary)',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            {t('automation.waiting_now').replace('{n}', String(operationalItem.waiting))}
          </div>
        )}

        {/*
          The settings, for the one automation that has any.

          Shown whether it is on or off. Off, they are the choice being made
          alongside the answer; on, they are the only place to change it. An
          owner who has to switch an automation off to adjust its timing loses
          every reminder due in between.
        */}
        {operationalItem && reminder && (
          <div
            style={{
              marginTop: '14px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              border: '1.5px solid var(--v2-border)',
              background: 'var(--v2-surface)',
              borderRadius: '16px',
              padding: '14px 16px',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            <div>
              <div style={labelStyle}>{t('automation.reminder_when')}</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {REMINDER_LEADS.map(hours => (
                  <button
                    key={hours}
                    type="button"
                    onClick={() => handleSettings({ ...reminder, hoursBefore: hours })}
                    style={chipStyle(reminder.hoursBefore === hours, isRTL)}
                  >
                    {leadLabel(hours, t)}
                  </button>
                ))}
              </div>

              {/*
                What the chosen lead time costs, said here rather than discovered
                by a client.

                The reminder offers a reschedule link, and the reschedule route
                refuses anything inside the service's notice window. At the
                default 24 hours, four of the five choices above land inside it —
                so this was a decision the owner made blind. The lead time itself
                is never overridden: `sendMeetingReminder` simply withholds the
                button when it cannot work, and this explains why.

                `>` and not `>=`: a reminder sent exactly on the deadline carries
                a link that is valid the instant it is sent and refused minutes
                later. That is the case worth naming, not papering over with an
                invented margin.
              */}
              {(() => {
                const notice = reminder.noticeHours;
                if (typeof notice !== 'number' || notice <= 0) return null;
                const canChange = reminder.hoursBefore > notice;

                return (
                  <div
                    style={{
                      marginTop: '8px',
                      fontSize: '12px',
                      lineHeight: 1.5,
                      color: canChange ? 'var(--v2-text-muted)' : '#B54708',
                      textAlign: isRTL ? 'right' : 'left',
                    }}
                  >
                    {canChange
                      ? t('automation.reminder_can_change').replace('{hours}', String(notice))
                      : t('automation.reminder_cannot_change').replace('{hours}', String(notice))}
                  </div>
                );
              })()}
            </div>

            <div>
              <div style={labelStyle}>{t('automation.reminder_who')}</div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {([
                  ['notifyClient', t('automation.reminder_who_client')],
                  ['notifyOwner', t('automation.reminder_who_owner')],
                ] as const).map(([key, label]) => {
                  const on = reminder[key];
                  /*
                   * The last one on cannot be switched off.
                   *
                   * With neither audience there is nobody to send to, and the
                   * card would go on saying the reminder was running. The
                   * server refuses the same combination; this stops the owner
                   * reaching for it at all.
                   */
                  const isLastOn = on && !(key === 'notifyClient' ? reminder.notifyOwner : reminder.notifyClient);

                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={isLastOn}
                      title={isLastOn ? t('automation.reminder_needs_one') : undefined}
                      onClick={() => handleSettings({ ...reminder, [key]: !on })}
                      style={{ ...chipStyle(on, isRTL), cursor: isLastOn ? 'default' : 'pointer' }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/*
          "Tell me when somebody is waiting."

          Its own block, below the automation's, because it is a different kind
          of thing: the card above asks permission to write to the owner's
          CLIENT, and this decides whether the owner hears about it at all. It is
          on from the day the account exists, so it is never phrased as an offer.

          Shown in every state — on, declined, unanswered — because it does not
          depend on the automation. An owner who says no to the auto-reply still
          needs to be told somebody is waiting, and this is now the only place
          that switch exists.
        */}
        {operationalItem && notifications && (
          <div
            style={{
              marginTop: '10px',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              border: '1.5px solid var(--v2-border)',
              background: 'var(--v2-surface)',
              borderRadius: '16px',
              padding: '14px 16px',
              fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
            }}
          >
            <label htmlFor="advisor-alert-owner" style={{ minWidth: 0, cursor: 'pointer' }}>
              <span
                style={{
                  display: 'block',
                  fontSize: '12.5px',
                  color: 'var(--v2-text-primary)',
                }}
              >
                {t('leads.alert_toggle')}
              </span>
              <span
                style={{
                  display: 'block',
                  marginTop: '2px',
                  fontSize: '11px',
                  lineHeight: 1.4,
                  color: 'var(--v2-text-muted)',
                }}
              >
                {t('leads.alert_hint')}
              </span>
            </label>

            {/*
              `dir="ltr"` on the switch itself, as on the briefing card: the
              shared Switch moves its thumb with a fixed rightward
              `translate-x-[20px]`, so inside this RTL container the thumb would
              start at the right edge and that shift would carry it out of the
              track. The row around it still mirrors.
            */}
            <div dir="ltr" style={{ flexShrink: 0 }}>
              <Switch
                id="advisor-alert-owner"
                checked={notifications.alertOwner}
                onCheckedChange={next =>
                  void handleNotifications({ ...notifications, alertOwner: next })
                }
              />
            </div>
          </div>
        )}

        {/*
          Before/After Projection (if available and in default state).

          NOT ON A CLOSED CARD. The panel poses a choice — "if you do nothing"
          against "if I handle it" — and on a resolved or already-handled
          insight there is no choice left to make: `canRun` has already removed
          the button, so the offer sat there with nothing to press. A card
          reading "sorted itself out" directly above "I chase all 4 today" asks
          the owner to decide something that is over, and reads as an offer that
          has stopped working rather than one that has been withdrawn.
        */}
        {!operationalItem && projectionColumns && cardState === 'default' && !isResolved && !wasHandled && (
          <BeforeAfterPanel left={projectionColumns.left} right={projectionColumns.right} />
        )}

        {/* Action buttons (default state): .adv-acts */}
        {/*
          ─────────────────────────────────────────────────────────────────────
          ALREADY COVERED, SAID BEFORE THE BUTTONS.

          The card still describes a real problem — this one does not stop
          being true because an agent is on it — so the finding stays and this
          line explains who has it. Named, not "an automation": the owner
          switched on something with a name, and seeing that name here is what
          connects this card to the row in the list below.
          ─────────────────────────────────────────────────────────────────────
        */}
        {cardState === 'default' && agentAlreadyWorking && offeredAgent && (
          <div
            style={{
              marginTop: '16px',
              padding: '11px 13px',
              borderRadius: '12px',
              background: 'rgba(34,197,94,0.10)',
              border: '1.5px solid rgba(34,197,94,0.30)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '9px',
            }}
          >
            <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#15803D' }} />
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: '13.5px',
                  fontWeight: 600,
                  color: 'var(--v2-text-primary)',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {(t('insight.covered_by') || '{agent} is already handling this').replace(
                  '{agent}',
                  t(offeredAgent.nameKey)
                )}
              </div>
              <div
                style={{
                  fontSize: '12.5px',
                  color: 'var(--v2-text-secondary)',
                  marginTop: '2px',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {t(offeredAgent.watchesKey)}
              </div>
            </div>
          </div>
        )}

        {cardState === 'default' && (
          <div
            className="adv-acts"
            style={{
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              marginTop: '16px',
              flexWrap: 'wrap',
            }}
          >
            {/*
              Primary button: .adv-btn

              Shown only where something can actually run. An advisory insight
              names no process, the server answers "no action available", and
              the button used to sit there anyway — an offer to handle it that
              could only ever fail.
            */}
            {canRun && (
            <button
              /*
               * A running automation has nothing to approve, so the primary
               * button stops being a button and becomes the status. Turning it
               * off lives on the secondary, where the destructive choice
               * belongs — a control labelled "Working on its own" that switches
               * it off when pressed would be a trap.
               */
              disabled={operationalState === 'on'}
              /*
               * ───────────────────────────────────────────────────────────
               * WHERE AN AGENT EXISTS, THE BUTTON INSTALLS IT. FULL STOP.
               *
               * It used to call `handleRun`, which queues THESE items into
               * `insight_actions` for a cron to send once. That is a second
               * sender doing the agent's job, and it put the owner through the
               * old path before the new one was even offered: the agent
               * question only appeared after the one-off had already gone out.
               *
               * An insight means the deterministic chaser has run its course —
               * 1, 3 and 7 days, then it stops — so what is left is not one
               * more manual send, it is somebody to take the job over. Opening
               * the offer asks how often first, which is the only question
               * that has to be answered before the platform writes to a client
               * in the owner's name.
               *
               * `handleRun` stays for insights we ship no agent for. Those
               * still have only the one-off.
               * ───────────────────────────────────────────────────────────
               */
              onClick={
                operationalItem
                  ? operationalState === 'on'
                    ? undefined
                    : () => handleDecide(true)
                  : agentAlreadyWorking
                    /* Not an offer and not a dead status: the agent has this,
                       and the press is the owner saying so and closing the
                       card. */
                    ? handleAgentCovers
                    : offeredAgent
                      ? () => setCardState('automate_offer')
                      : handleRun
              }
              /*
               * ───────────────────────────────────────────────────────────────
               * THE NEEDS-YOU ROW BUTTON, COPIED RATHER THAN APPROXIMATED.
               *
               * These are its exact classes. Setting the same numbers inline
               * was not the same button: `text-xs` also carries a 1rem
               * line-height and `font-semibold` a specific weight, and an
               * explicit `fontFamily` overrode the stack the list inherits. The
               * result measured identical and still did not look it.
               *
               * So nothing about the SHAPE is inline any more. The style prop
               * carries colour only, which is the one thing that differs
               * between the two states.
               *
               * `ap-primary-lift` is also what fixes the blur. In dark mode its
               * rule in `globals.css` darkens the fill — white on this
               * account's brand orange measures about 2.8:1, and text under
               * roughly 4.5:1 stops resolving into letters and reads as being
               * out of focus. The list had the class; this button did not, and
               * that is the whole difference the eye was picking up.
               *
               * Dropped on the settled green state, which is a chip rather than
               * an invitation — the same rule the list applies to its `done`
               * rows.
               * ───────────────────────────────────────────────────────────────
               */
              className={`adv-btn shrink-0 self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all hover:brightness-110 active:scale-[0.97] disabled:active:scale-100 disabled:hover:brightness-100${
                operationalState === 'on' || agentAlreadyWorking ? '' : ' ap-primary-lift'
              }`}
              style={
                operationalState === 'on' || agentAlreadyWorking
                  ? {
                      /* The settled chip, tinted from the success colour the
                         same way the list tints its `done` rows. */
                      background: 'color-mix(in srgb, var(--v2-success) 14%, transparent)',
                      color: 'var(--v2-success)',
                      cursor: operationalState === 'on' ? 'default' : 'pointer',
                    }
                  : { background: 'var(--v2-primary)', color: '#fff' }
              }
            >
              {operationalItem
                ? operationalState === 'on'
                  // Running. The only move left is to stop it, so the primary
                  // button stops being an invitation.
                  ? t('automation.running')
                  : operationalState === 'off'
                    ? t('automation.enable')
                    : t('automation.approve')
                : agentAlreadyWorking
                  ? t('insight.action.got_it') || 'I got it'
                  : t('insight.action.primary') || 'Handle it for me'}
            </button>
            )}
            {/* Secondary button: .adv-lite */}
            <button
              onClick={operationalItem ? () => handleDecide(false) : handleDismiss}
              /*
               * ─────────────────────────────────────────────────────────────
               * THE SAME SECONDARY AS THE NEEDS-YOU CARD: TEXT, NOT A BOX.
               *
               * This was a bordered box filled with `--v2-surface`. In dark
               * mode that is the CARD'S OWN colour, so the button rendered as a
               * faint outline around nothing and read as disabled — beside a
               * solid indigo primary, which made the pair look like one live
               * control and one dead one.
               *
               * The Needs-you card's secondary has no border and no fill: it is
               * muted text that darkens on hover. Matching it fixes dark mode
               * and makes the two cards agree, which is the same reason the
               * primary moved to `--v2-primary`.
               * ─────────────────────────────────────────────────────────────
               */
              /* The Needs-you cancel, by class: muted text that darkens on
                 hover, no border and no fill. The handlers it replaced were an
                 inline approximation of `hover:text-[...]`. */
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              {isResolved
                ? t('insight.action.acknowledge') || 'Got it'
                : !canRun && !operationalItem
                ? t('insight.action.acknowledge') || 'Got it'
                : operationalItem
                ? operationalState === 'on'
                  ? t('automation.turn_off')
                  : t('automation.decline')
                : t('insight.action.secondary') || 'Not now'}
            </button>

            {/* "Seen" note: .adv-seen */}
            {seenText && (
              <span
                className="adv-seen"
                style={{
                  fontSize: '12.5px',
                  color: 'var(--v2-text-secondary)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '7px',
                  marginLeft: isRTL ? undefined : 'auto',
                  marginRight: isRTL ? 'auto' : undefined,
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                <Clock
                  style={{
                    width: '14px',
                    height: '14px',
                    stroke: 'var(--v2-text-secondary)',
                    fill: 'none',
                    strokeWidth: 2,
                  }}
                />
                {seenText}
              </span>
            )}
          </div>
        )}

        {/* Running state */}
        {cardState === 'running' && (
          <div
            style={{
              marginTop: '16px',
              padding: '16px',
              borderRadius: '14px',
              // A neutral inset panel, one step off the card. `#F8F9FC` was a
              // light-mode wash that turned into a white slab in dark mode,
              // under text that follows the theme tokens.
              background: 'var(--v2-surface-hover)',
              border: '1px solid var(--v2-border)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <Loader2 style={{ width: '20px', height: '20px', color: '#F97316' }} className="animate-spin" strokeWidth={2.5} />
              <span
                style={{
                  fontSize: '15px',
                  fontWeight: 600,
                  color: 'var(--v2-text-primary)',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {t('insight.running') || 'Working on it...'}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '14px' }}>
                  {i < runningStep ? (
                    <span
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: '#22C58B',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <Check style={{ width: '12px', height: '12px', color: '#FFFFFF' }} strokeWidth={3} />
                    </span>
                  ) : i === runningStep ? (
                    <span
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: 'rgba(249,115,22,0.12)',
                        display: 'grid',
                        placeItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <span
                        className="animate-pulse"
                        style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#F97316' }}
                      />
                    </span>
                  ) : (
                    <span
                      style={{
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        border: '2px solid var(--v2-border)',
                        flexShrink: 0,
                      }}
                    />
                  )}
                  <span style={{ color: i <= runningStep ? 'var(--v2-text-primary)' : 'var(--v2-text-secondary)', fontWeight: i <= runningStep ? 500 : 400 }}>
                    {step}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Completed state - matches .auto-done styling */}
        {cardState === 'completed' && (
          <div
            style={{
              marginTop: '18px',
              // The success family that exists in BOTH themes. The literals
              // here were a light mint that stayed light in dark mode.
              border: '1.5px solid var(--v2-status-success-border)',
              background: 'var(--v2-status-success-bg)',
              borderRadius: '16px',
              padding: '17px 18px',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            <span
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: '#22C58B',
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 0 0 4px rgba(34,197,139,0.17)',
              }}
            >
              <Check style={{ width: '14px', height: '14px', color: '#FFFFFF' }} strokeWidth={3} />
            </span>
            <div>
              <b
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                  fontSize: '15.5px',
                  fontWeight: 600,
                  display: 'block',
                  marginBottom: '3px',
                  color: 'var(--v2-text-primary)',
                }}
              >
                {t('insight.completed.title') || 'Done'}
              </b>
              <p
                style={{
                  fontSize: '13.5px',
                  color: 'var(--v2-text-secondary)',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  margin: 0,
                }}
              >
                {t('insight.completed.subtitle') || 'I\'ll keep watching this for you.'}
              </p>
            </div>
          </div>
        )}

        {/* Automation offer state: .auto-offer */}
        {cardState === 'automate_offer' && (canAutomate || offeredAgent) && (
          <div
            className="auto-offer"
            style={{
              marginTop: '18px',
              border: '1.5px solid rgba(249, 115, 22, 0.30)',
              background: 'linear-gradient(180deg, rgba(249, 115, 22, 0.10), rgba(249, 115, 22, 0.03))',
              borderRadius: '16px',
              padding: '17px 18px',
            }}
          >
            {/* Eyebrow: .auto-ey */}
            <div
              className="auto-ey"
              style={{
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: '#F97316',
                marginBottom: '6px',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {t('insight.automate.eyebrow') || 'Standing automation'}
            </div>
            {/* Headline: .auto-h */}
            <div
              className="auto-h"
              style={{
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                fontSize: '17px',
                fontWeight: 600,
                letterSpacing: '-0.02em',
                marginBottom: '6px',
                color: 'var(--v2-text-primary)',
              }}
            >
              {t('insight.automate.title') || 'Want me to just handle this from now on?'}
            </div>
            {/* Description: .auto-p */}
            <div
              className="auto-p"
              style={{
                fontSize: '13.5px',
                color: 'var(--v2-text-secondary)',
                marginBottom: '14px',
                fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
              }}
            >
              {/*
                The agent's own sentence where we ship one. The fallback below
                describes invoice chasing in particular, which is wrong on a
                card about quiet enquiries — it was written when one agent was
                the only thing this offer could mean.
              */}
              {offeredAgent
                ? t(offeredAgent.descriptionKey)
                : t('insight.automate.description') || 'I\'ll watch every invoice and chase the ones that pass your limit. Up to three reminders, a week apart, in your voice. I stop the moment they pay, and I tell you when it works.'}
            </div>

            {/*
              ─────────────────────────────────────────────────────────────────
              HOW OFTEN, ASKED BEFORE IT IS SWITCHED ON.

              The owner's decision, and the one question that must be answered
              first: daily and fortnightly are different relationships with the
              same client, in the owner's own name.

              Named choices, never a cron field. An owner typing `* * * * *`
              into a text box is a mailshot, and the install has no way to tell
              that from a deliberate choice.

              Replaces the days stepper below for insights we ship an agent
              for. That stepper writes `days_threshold`, which NOTHING reads —
              `CashArOverdueDetector` hardcodes 7 — so it asked the owner a
              question and then ignored the answer.
              ─────────────────────────────────────────────────────────────────
            */}
            {/*
              ─────────────────────────────────────────────────────────────────
              THE TWO QUESTIONS, EACH AS ONE CONTROL.

              These were chips, and chips were right while each question had
              three or four answers. They could not carry the request: the five
              named cadences all fired at 09:00 and all meant a number of days,
              so "every ten days" was unaskable — and the mailbox wizard, asking
              the same question in minutes, could not share the control at all.

              The range comes from the automation's own `cadenceChoices` and
              `stopAfterChoices`, so an owner can reach anything between the
              ends and nothing beyond them. Those lists were never a menu:
              `win_back_quiet_clients` offers nothing faster than a fortnight
              because it writes to people quiet for a year.

              "How often" without "until when" is an agent that chases somebody
              for ever, so both stay, side by side, answered before it runs.
              Deliberately in days rather than attempts: counting sends per
              person needs somewhere to keep the count, and a date bound needs
              nothing — the person simply stops being selected.
              ─────────────────────────────────────────────────────────────────
            */}
            {offeredAgent && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '14px' }}>
                <IntervalPicker
                  id="automation-cadence"
                  label={t('automation.run_every') || 'How often should I do this?'}
                  lead={t('automation.every') || 'Every'}
                  value={cadenceValue}
                  range={cadenceRange}
                  onChange={setCadenceInterval}
                  unitLabel={unitWord}
                />

                <IntervalPicker
                  id="automation-stop-after"
                  label={t('automation.stop_after') || 'Give up on someone after'}
                  lead={t('automation.after') || 'After'}
                  value={stopAfterValue}
                  range={stopAfterRange}
                  onChange={setStopAfterInterval}
                  unitLabel={unitWord}
                />
              </div>
            )}

            {/* Threshold control: .auto-thr */}
            {!offeredAgent && (
            <div
              className="auto-thr"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                background: 'var(--v2-surface)',
                // Tinted from the accent rather than a fixed pale peach, so it
                // stays a hairline against a dark surface instead of glowing.
                border: '1px solid rgba(249, 115, 22, 0.32)',
                borderRadius: '12px',
                padding: '11px 14px',
                flexWrap: 'wrap',
              }}
            >
              {/* Label: .thr-lb */}
              <span
                className="thr-lb"
                style={{
                  fontSize: '13.5px',
                  fontWeight: 500,
                  flex: 1,
                  minWidth: '150px',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {t('insight.automate.threshold_label') || 'Chase anything unpaid after'}
              </span>
              {/* Control: .thr-ctl */}
              <div
                className="thr-ctl"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '2px',
                  border: '1.5px solid var(--v2-border)',
                  borderRadius: '10px',
                  overflow: 'hidden',
                }}
              >
                {/* Minus button: .thr-b */}
                <button
                  onClick={() => stepAutoValue(-1)}
                  className="thr-b"
                  style={{
                    width: '34px',
                    height: '34px',
                    fontSize: '17px',
                    fontWeight: 600,
                    color: 'var(--v2-primary)',
                    background: 'color-mix(in srgb, var(--v2-primary) 12%, transparent)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  −
                </button>
                {/* Value: .thr-v */}
                <span
                  className="thr-v"
                  style={{
                    minWidth: '62px',
                    textAlign: 'center',
                    fontFamily: '"Space Grotesk", system-ui, sans-serif',
                    fontSize: '15px',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {autoValue} {t('insight.automate.days') || 'days'}
                </span>
                {/* Plus button: .thr-b */}
                <button
                  onClick={() => stepAutoValue(1)}
                  className="thr-b"
                  style={{
                    width: '34px',
                    height: '34px',
                    fontSize: '17px',
                    fontWeight: 600,
                    color: 'var(--v2-primary)',
                    background: 'color-mix(in srgb, var(--v2-primary) 12%, transparent)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  +
                </button>
              </div>
            </div>
            )}

            {/*
              The refusal, where the owner is looking when it happens.

              Above the buttons rather than replacing them: the cadence they
              chose is still on screen and still theirs, and the sentence
              explains why the press did nothing rather than leaving them to
              press again.
            */}
            {installRefusal && (
              <div
                role="status"
                style={{
                  marginTop: '12px',
                  padding: '10px 12px',
                  borderRadius: '10px',
                  fontSize: '13px',
                  lineHeight: 1.5,
                  background: 'var(--v2-bg)',
                  color: 'var(--v2-text-secondary)',
                  border: '1px solid var(--v2-border)',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                }}
              >
                {installRefusal}
              </div>
            )}

            {/* Action buttons: .auto-acts */}
            <div
              className="auto-acts"
              style={{
                display: 'flex',
                gap: '10px',
                marginTop: '14px',
                flexWrap: 'wrap',
              }}
            >
              <button
                /* The Needs-you row button's own classes, like the primary
                   above. Nothing about the shape is inline — see the note
                   there for why the same numbers were not the same button. */
                className="adv-btn shrink-0 self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all hover:brightness-110 active:scale-[0.97] ap-primary-lift"
                onClick={handleAutomate}
                style={{ background: 'var(--v2-primary)', color: '#fff' }}
              >
                {t('insight.automate.yes') || 'Yes, handle it'}
              </button>
              <button
                onClick={handleDeclineAutomate}
                /* Text, not a box — see the note on the secondary above. */
                /* Same as the secondary above, and as the list's cancel. */
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
                style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
              >
                {t('insight.automate.no') || 'Keep asking me'}
              </button>
            </div>
          </div>
        )}

        {/* Automated confirmation state: .auto-done */}
        {cardState === 'automated' && (
          <div
            className="auto-done"
            style={{
              marginTop: '18px',
              // The success family that exists in BOTH themes. The literals
              // here were a light mint that stayed light in dark mode.
              border: '1.5px solid var(--v2-status-success-border)',
              background: 'var(--v2-status-success-bg)',
              borderRadius: '16px',
              padding: '17px 18px',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
            }}
          >
            {/* Icon: .auto-done-ic */}
            <span
              className="auto-done-ic"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                background: '#22C58B',
                flexShrink: 0,
                display: 'grid',
                placeItems: 'center',
                boxShadow: '0 0 0 4px rgba(34,197,139,0.17)',
              }}
            >
              <Check style={{ width: '14px', height: '14px', color: '#FFFFFF' }} strokeWidth={3} />
            </span>
            <div>
              <b
                style={{
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Space Grotesk", system-ui, sans-serif',
                  fontSize: '15.5px',
                  fontWeight: 600,
                  display: 'block',
                  marginBottom: '3px',
                  color: 'var(--v2-text-primary)',
                }}
              >
                {t('insight.automated.title') || 'Done — I\'ll chase them from now on'}
              </b>
              <p
                style={{
                  fontSize: '13.5px',
                  color: 'var(--v2-text-secondary)',
                  fontFamily: isRTL ? '"Heebo", system-ui, sans-serif' : '"Inter", system-ui, sans-serif',
                  margin: 0,
                }}
              >
                {t('insight.automated.subtitle')?.replace('{days}', String(autoValue)) || `Anything unpaid past ${autoValue} days, up to three reminders. It shows up in what I've handled, not in your inbox. Turn it off in Operation whenever you like.`}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* The vectors strip and "what I've handled" used to render here as well
          as in LiveDashboard, so both appeared twice — with different numbers —
          whenever there was a pending insight. LiveDashboard owns them now, and
          shows them whether or not an insight is pending. */}
    </div>
  );
}

/**
 * One step back or forward through the advisor's pages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `direction` is 'back' / 'forward' rather than 'left' / 'right', because which
 * side of the screen those are depends on the language. In Hebrew, back is the
 * right-hand arrow. Naming the buttons by their position would have meant the
 * Hebrew card pointing the wrong way round, which is a bug you only see if you
 * read Hebrew.
 *
 * The visible glyph flips with `isRTL`. The DOM order does not need to: the row
 * is laid out by flexbox inside an RTL document, so the browser reverses it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function PagerArrow({
  direction,
  isRTL,
  disabled,
  label,
  onClick,
}: {
  direction: 'back' | 'forward';
  isRTL: boolean;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  const pointsLeft = isRTL ? direction === 'forward' : direction === 'back';

  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        /*
         * 26px. Bigger than the 6px dots were before their hit areas were
         * widened, because this is the control most people will reach for and
         * the card is often read on a phone.
         */
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '26px',
        height: '26px',
        padding: 0,
        border: 'none',
        borderRadius: '50%',
        background: 'transparent',
        /*
         * The whole point of the arrows: at the first page the forward one is
         * the only lit thing in the row, and that is what says there is more to
         * see. So the enabled state is the card's own accent rather than the
         * muted grey the dots use — and it matches the active dot beside it,
         * which is the same carousel control.
         */
        color: disabled ? 'var(--v2-border)' : '#F97316',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'color 0.2s, background 0.2s',
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points={pointsLeft ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
      </svg>
    </button>
  );
}

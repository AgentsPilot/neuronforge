'use client';

/**
 * The agents this business has put to work, and the controls for them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE OTHER HALF OF "I'LL HANDLE THIS PERMANENTLY".
 *
 * The advisor card offers an agent, the owner switches it on, and the insight
 * closes. Until this card existed, that was the last they saw of it: the only
 * place an installed automation appeared was the general agents list, mixed in
 * with hand-built agents and showing its name as a raw translation key.
 *
 * Sits directly below the advisor on purpose. The card above says what needs
 * attention; this one says what is already being handled, so "I'll handle this"
 * has somewhere to point. An owner who cannot see what they switched on cannot
 * trust the next offer.
 *
 * Renders NOTHING when nothing is installed. A list that is permanently empty
 * is an advert for a feature, and the dashboard has enough cards.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Bot, Check, Loader2, Pause, Pencil, Play, Trash2 } from 'lucide-react';

import { PluginIcon } from '@/components/PluginIcon';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import {
  formatInterval,
  nextTickAfter,
  type IntervalRange,
  type ScheduleInterval,
} from '@/lib/business-os/schedule/interval';
import { IntervalPicker } from '@/components/business-os/schedule/IntervalPicker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AutomationCadence } from '@/lib/business-os/automations/types';

interface InstalledAgent {
  agentId: string;
  automationId: string;
  /**
   * Which doorway this agent came through.
   *
   * There is no third kind: one we authored and the owner adopted, the mailbox
   * channel, or one they wrote themselves. The card does not branch on it —
   * every family answers the same six columns — but it is what tells an owner
   * why a row has no stop rule.
   */
  family: 'adopted' | 'mailbox' | 'own';
  /**
   * Already in the owner's language, resolved server-side.
   *
   * The card used to turn `automationId` into words through the catalogue, and
   * showed the raw id for anything not in it — which is what the mailbox
   * channel is. Resolving on the server also stops the catalogue being
   * bundled into the browser to translate three strings.
   */
  name: string;
  watches: string;
  scheduleWords: string;
  /** What the plan reaches: the marks say what this agent touches. */
  plugins: string[];
  status: string;
  lastRun: string | null;
  nextRun: string | null;
  cadence: AutomationCadence | null;
  stopAfterDays: number | null;
  /** Switched on and unable to run: its `requires` is not met. */
  blocked: boolean;
  requires: string | null;

  /**
   * ───────────────────────────────────────────────────────────────────────────
   * WHAT THE INLINE EDITOR OPENS ON, AND WHETHER IT MAY OPEN.
   *
   * `schedule` null means this agent's schedule says something a number and a
   * unit cannot: named weekdays, two times a day, the 15th of the month. The
   * prompt flow's builder emits those from a picker that SHOWS the days, so
   * flattening one into "every N days" would throw away a choice somebody made.
   * The row offers no editor there and links to that builder instead.
   *
   * The ranges arrive resolved, because only the server knows the catalogue and
   * the card must not learn that `win_back_quiet_clients` may never go hourly.
   * ───────────────────────────────────────────────────────────────────────────
   */
  schedule: ScheduleInterval | null;
  /** The stop rule WITH its unit, which `stopAfterDays` rounds away. */
  stopAfter: ScheduleInterval | null;
  cadenceRange: IntervalRange;
  stopRange: IntervalRange;
}

/**
 * The three states an installed agent can be in, and the one colour each gets.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GREEN MEANS RUNNING. NOTHING ELSE MAY WEAR IT.
 *
 * Paused and blocked are not failures and are not successes: one is a decision
 * the owner made, the other is something they can fix. Giving either of them
 * green would make the only question this card answers — what is actually
 * working for me right now — unanswerable at a glance, which is the whole job
 * of the list.
 *
 * Every colour here is a token defined in BOTH theme blocks. A fixed hex looks
 * right on one ground and wrong on the other, and the status family exists
 * precisely so a state does not have to guess.
 * ─────────────────────────────────────────────────────────────────────────────
 */
type AgentState = 'running' | 'paused' | 'blocked';

const STATE_COLOUR: Record<AgentState, { fg: string; bg: string }> = {
  running: { fg: 'var(--v2-success)', bg: 'color-mix(in srgb, var(--v2-success) 14%, transparent)' },
  /* `--v2-bg` and not `--v2-surface`: the card itself IS the surface, so a chip
     filled with it is an invisible chip. The page ground reads as a quiet grey
     against it on both themes. */
  paused: { fg: 'var(--v2-text-muted)', bg: 'var(--v2-bg)' },
  blocked: { fg: 'var(--v2-status-error-text)', bg: 'var(--v2-status-error-bg)' },
};

/**
 * The agent's own column stays put while the rest scrolls under it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FIXES ON A PHONE, AND IT IS NOT COSMETIC.
 *
 * Six real facts need about 680px. A phone gives the table roughly 350 of them,
 * so an owner reading "next run" has scrolled the names off the screen — six
 * identical rows of times with nothing saying which agent each one belongs to.
 * Pausing the wrong agent is one press away from that.
 *
 * `inset-inline-start` rather than `left`, because the Hebrew ledger scrolls
 * the other way and `left: 0` would pin the names to the far end of it.
 *
 * The background is required, not decoration: a sticky cell with no fill lets
 * the scrolling columns show straight through the text.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const PINNED: CSSProperties = {
  position: 'sticky',
  insetInlineStart: 0,
  background: 'var(--v2-surface)',
  zIndex: 1,
};

/**
 * The owner's locale for a date, from the language they chose.
 *
 * `undefined` would be the BROWSER's, which on a Hebrew account reading a
 * Hebrew interface renders "Fri 30 Oct" in the middle of Hebrew text. The
 * schedule preview did exactly that until somebody looked at it.
 */
function ownerLocale(language: string): string {
  return language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-GB';
}

function stateOf(agent: InstalledAgent): AgentState {
  /* Blocked wins over paused: an owner who un-pauses a blocked agent still has
     an agent that cannot run, and the row has to keep saying so. */
  if (agent.blocked) return 'blocked';
  return agent.status === 'active' ? 'running' : 'paused';
}

/** Which row is mid-request, so two presses cannot race one agent. */
type Busy = Record<string, boolean>;

export function RunningAgentsCard() {
  const { t, isRTL, language } = useLanguage();
  const [agents, setAgents] = useState<InstalledAgent[] | null>(null);
  const [busy, setBusy] = useState<Busy>({});
  /** The row being asked to confirm a removal. One at a time. */
  const [removing, setRemoving] = useState<string | null>(null);

  /*
   * ─────────────────────────────────────────────────────────────────────────────
   * THE ROW BEING EDITED, AND THE TWO VALUES IN HAND.
   *
   * One at a time, by agent id. Two rows open at once on a seven-column table
   * is two sets of unsaved numbers and no way to tell which Save belongs to
   * which — and the question being asked is small enough that nobody needs to
   * compare two agents mid-edit.
   *
   * Held separately from `agents` so an abandoned edit changes nothing: Cancel
   * is just clearing this, and a failed save leaves the list showing what the
   * server still believes.
   * ─────────────────────────────────────────────────────────────────────────────
   */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    schedule: ScheduleInterval;
    /*
     * An INTERVAL, where this was a day count.
     *
     * A number alone cannot change its own unit: pressing "hours" on thirty
     * days converted to 720, stored the 720, and the control re-read it as 720
     * DAYS — clamped to the ceiling, with the unit never moving. The chip
     * looked dead because nothing it did could survive the round trip.
     */
    stopAfter: ScheduleInterval | null;
  } | null>(null);

  /**
   * Re-read the list, silently.
   *
   * No loading state and no spinner on purpose: the rows already on screen
   * stay exactly where they are until the new ones arrive, and a failed read
   * leaves them alone. This runs on mount and again on every install, so a
   * visible refresh would mean the card blinking each time the owner switches
   * something on — and nothing about this list is urgent enough to flicker for.
   *
   * It re-reads THIS CARD and nothing else. The dashboard is not refreshed and
   * the page is not reloaded.
   */
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/business-os/automation-agents');
      if (!response.ok) return;
      const body = await response.json();
      if (body.success) setAgents(body.data as InstalledAgent[]);
    } catch {
      /* Silent: an empty list and a failed read look the same to the owner,
         and neither is worth an error card on a dashboard. */
    }
  }, []);

  useEffect(() => {
    load();

    /*
     * And again whenever an automation is installed from the advisor card
     * above, which is the one moment this list is certainly stale. See the
     * dispatch in `InsightAdvisorCard.handleAutomate`.
     */
    const onInstalled = () => load();
    window.addEventListener('business-os:automation-installed', onInstalled);
    return () => window.removeEventListener('business-os:automation-installed', onInstalled);
  }, [load]);

  /** Open the editor on one row, with what the server says it is set to. */
  const beginEdit = useCallback((agent: InstalledAgent) => {
    if (!agent.schedule) return;

    setEditing(agent.agentId);
    setDraft({ schedule: agent.schedule, stopAfter: agent.stopAfter });
  }, []);

  const cancelEdit = useCallback(() => {
    setEditing(null);
    setDraft(null);
  }, []);

  /**
   * Send the two answers, and re-read.
   *
   * Re-read rather than patched locally for the reason pause does it: the
   * server owns the schedule, it CLAMPS what it is sent to the agent's own
   * range, and a list showing the number the owner typed over a row holding a
   * different one is worse than a slow list. If a fortnightly agent refuses to
   * go weekly, the owner should see it refuse.
   */
  const saveSchedule = useCallback(
    async (agentId: string) => {
      if (!draft) return;

      setBusy(prev => ({ ...prev, [agentId]: true }));

      try {
        const response = await fetch('/api/business-os/automation-agents', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agentId,
            action: 'schedule',
            schedule: draft.schedule,
            ...(draft.stopAfter ? { stopAfter: draft.stopAfter } : {}),
          }),
        });

        if (response.ok) {
          setEditing(null);
          setDraft(null);
          await load();
        }
      } finally {
        setBusy(prev => ({ ...prev, [agentId]: false }));
      }
    },
    [draft, load]
  );

  const control = useCallback(
    async (agentId: string, action: 'pause' | 'resume' | 'remove') => {
      setBusy(prev => ({ ...prev, [agentId]: true }));

      try {
        const response = await fetch('/api/business-os/automation-agents', {
          method: action === 'remove' ? 'DELETE' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(action === 'remove' ? { agentId } : { agentId, action }),
        });

        /* Re-read rather than patching local state: the server owns the
           status, and a list that disagrees with it is worse than a slow one. */
        if (response.ok) await load();
      } finally {
        setBusy(prev => ({ ...prev, [agentId]: false }));
        setRemoving(null);
      }
    },
    [load]
  );

  /* Before the first read, and whenever nothing is installed. */
  if (!agents?.length) return null;

  /*
   * The agent the dialog is asking about, by name rather than by id.
   *
   * The same resolved name the row shows. It used to go back through the
   * catalogue and fall through to the raw id — so the one dialog that asks
   * "stop WHICH agent?" could answer with `business-os-automation:…` for
   * anything the catalogue did not know, which is exactly a mailbox channel.
   */
  const removingName = agents.find(a => a.agentId === removing)?.name;

  const running = agents.filter(a => a.status === 'active').length;
  const pausedCount = agents.length - running;

  /**
   * A date the owner can place, in their own language.
   *
   * Short and local, because the useful question is "has it run?" rather than
   * the exact minute. `undefined` locale would be the browser's, which on a
   * Hebrew account reading an English UI disagrees with everything around it.
   */
  const when = (iso: string | null) => {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    /*
     * The TIME as well as the day.
     *
     * It was day and month alone, on the reasoning that the useful question is
     * "has it run?" rather than the exact minute. That is true of a weekly
     * agent and false of every other one on this list: a mailbox checked every
     * five minutes showed "30 באוק׳" in both columns, which says nothing at all
     * — and the next-run column is now something an owner CHANGES, so they need
     * to see what their change did.
     */
    return date.toLocaleString(ownerLocale(language), {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        background: 'var(--v2-surface)',
        border: '1px solid var(--v2-border)',
        borderRadius: '18px',
        padding: '17px 18px',
        boxShadow: '0 6px 20px -10px rgba(16,22,42,0.25)',
        marginTop: '12px',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      {/*
        ───────────────────────────────────────────────────────────────────────
        A HEADER THAT ANSWERS THE QUESTION THE CARD IS OPENED WITH.

        It was a title and a count. The count alone says nothing worth knowing:
        six agents of which four are paused is a different business from six of
        which none are, and that difference is the whole reason an owner looks
        here. So the running total leads, and the paused ones are named beside
        it rather than discovered by scrolling.
        ───────────────────────────────────────────────────────────────────────
      */}
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {t('automation.card_title') || 'Working for you'}
        </h3>

        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--v2-text-muted)' }}>
          <span style={{ color: 'var(--v2-success)', fontWeight: 600 }}>{running}</span>
          {' '}
          {t('automation.running_count') || 'running'}
          {pausedCount > 0 && (
            <>
              {' · '}
              {(t('automation.paused_count') || '{n} paused').replace('{n}', String(pausedCount))}
            </>
          )}
        </span>
      </div>

      {/*
        ───────────────────────────────────────────────────────────────────────
        A LEDGER, NOT A STACK OF CARDS.

        Each agent is one line under real column headers, so the times line up
        down the page and ten agents scan like a statement. The rows were a
        column of three paragraphs each, which read fine at one agent and became
        a wall at six.

        `overflow-x` on the card rather than squeezing: these are six genuine
        facts and dropping one on a narrow screen would mean the owner cannot
        see when something next runs on a phone.
        ───────────────────────────────────────────────────────────────────────
      */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
          <thead>
            <tr>
              {[
                t('automation.col_agent') || 'Agent',
                t('automation.col_watches') || 'Watches',
                t('automation.col_every') || 'Every',
                t('automation.col_last') || 'Last run',
                t('automation.col_next') || 'Next run',
                t('automation.col_stops') || 'Stops after',
                '',
              ].map((heading, i) => (
                <th
                  key={i}
                  className="text-[10px] font-semibold uppercase"
                  style={{
                    textAlign: 'start',
                    padding: '0 10px 7px',
                    letterSpacing: '0.07em',
                    color: 'var(--v2-text-muted)',
                    borderBottom: '1px solid var(--v2-border)',
                    whiteSpace: 'nowrap',
                    ...(i === 0 ? PINNED : null),
                  }}
                >
                  {heading}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {agents.map(agent => {
              /*
               * The catalogue, for everything the row SAYS. The row holds the
               * Every string this row shows is resolved server-side, in the
               * owner's language — see `InstalledAutomation`. The card used to
               * look the catalogue up here and fell back to printing a raw id
               * for anything absent from it, which is exactly what a mailbox
               * channel looks like to the catalogue.
               */
              const state = stateOf(agent);
              const colour = STATE_COLOUR[state];
              const working = busy[agent.agentId];

              const open = editing === agent.agentId;

              return (
                <Fragment key={agent.agentId}>
                <tr
                  style={{
                    /* The open row and its editor read as one block, so the
                       line between them would cut the question off the agent
                       it is about. */
                    borderBottom: open ? 'none' : '1px solid var(--v2-border)',
                  }}
                >
                  {/* Who */}
                  <td style={{ padding: '9px 10px', ...PINNED }}>
                    <span className="flex items-center gap-2.5">
                      <span
                        style={{
                          width: '3px',
                          height: '24px',
                          borderRadius: '2px',
                          background: colour.fg,
                          flex: 'none',
                        }}
                      />
                      {/* The agent, as it always was. */}
                      <span
                        className="inline-flex items-center justify-center rounded-lg"
                        style={{ width: '26px', height: '26px', background: colour.bg, color: colour.fg, flex: 'none' }}
                      >
                        <Bot className="w-3.5 h-3.5" strokeWidth={2.25} />
                      </span>

                      {/*
                        And what it TOUCHES, beside it.

                        `plugins_required` is the column the runtime grants the
                        run, so these are what the agent can actually reach
                        rather than what we hope it reaches: a Gmail mark for
                        the mailbox one reads, our own for the part that writes
                        to the business's records.

                        Dimmed when the agent is not running — what it touches
                        has not changed, but the row should still read as paused
                        at a glance.
                      */}
                      {agent.plugins.length > 0 && (
                        <span
                          className="inline-flex items-center"
                          style={{ gap: '3px', flex: 'none', opacity: state === 'running' ? 1 : 0.55 }}
                        >
                          {agent.plugins.slice(0, 3).map(plugin => (
                            <PluginIcon
                              key={plugin}
                              pluginId={plugin}
                              className="w-[15px] h-[15px]"
                              /* Decorative: the agent's name sits beside it, and
                                 reading "gmail business-os" after the name is
                                 noise for a screen reader. */
                              alt=""
                            />
                          ))}
                        </span>
                      )}
                      <span className="text-[13px] font-semibold text-[var(--v2-text-primary)] whitespace-nowrap">
                        {agent.name}
                      </span>
                      {state !== 'running' && (
                        <span
                          className="text-[10px] font-semibold px-1.5 py-0.5 rounded whitespace-nowrap"
                          style={{ background: colour.bg, color: colour.fg }}
                        >
                          {state === 'blocked'
                            ? t('automation.blocked') || 'Cannot run'
                            : t('automation.paused') || 'Paused'}
                        </span>
                      )}
                    </span>
                  </td>

                  {/* What it watches, or why it cannot run — the more useful of
                      the two, in the same place. */}
                  <td className="text-[12.5px]" style={{ padding: '9px 10px', color: state === 'blocked' ? colour.fg : 'var(--v2-text-secondary)' }}>
                    {state === 'blocked' && agent.requires
                      ? t(`automation.requires.${agent.requires}`) || t('automation.requires.default')
                      : agent.watches}
                  </td>

                  {/*
                    How often — AND the way to change it.

                    ────────────────────────────────────────────────────────────
                    The value is the control. An owner looking for "how often
                    does this run" is already looking at this cell, so putting
                    the edit here costs no new affordance, no icon column and no
                    menu — and it cannot be mistaken for editing a different
                    agent, which is the risk a toolbar button carries on a
                    seven-column table.

                    A plain cell when the schedule is one an interval cannot
                    say. Drawing a button that opens a control which can only
                    flatten a weekday choice would be worse than showing
                    nothing: see `schedule` on `InstalledAgent`.
                    ────────────────────────────────────────────────────────────
                  */}
                  <td className="text-[12px] tabular-nums whitespace-nowrap" style={{ padding: '9px 10px', color: 'var(--v2-text-secondary)' }}>
                    {agent.schedule ? (
                      <button
                        type="button"
                        onClick={() => (open ? cancelEdit() : beginEdit(agent))}
                        aria-expanded={open}
                        title={t('automation.change_schedule') || 'Change this schedule'}
                        className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 -mx-1.5 cursor-pointer transition-colors hover:bg-[var(--v2-surface-hover)]"
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: 'inherit',
                          font: 'inherit',
                        }}
                      >
                        {agent.scheduleWords || '—'}
                        {/*
                          ────────────────────────────────────────────────────
                          ALWAYS VISIBLE, NOT ON HOVER.

                          It was `opacity-0 group-hover:opacity-70`, on the
                          reasoning that a column of pencils is noise. That
                          reasoning was wrong about the thing that matters: an
                          affordance nobody can see is a feature nobody knows
                          exists, and this is the ONLY way to change a
                          schedule. Hiding it to keep the column tidy trades a
                          capability for an aesthetic.

                          It is also invisible to touch, where there is no
                          hover at all — so on a phone the schedule was simply
                          not editable.

                          Dimmed rather than hidden: present enough to be
                          found, quiet enough not to compete with the words it
                          sits beside. It brightens on hover and while open.
                          ────────────────────────────────────────────────────
                        */}
                        <Pencil
                          className="w-3 h-3 transition-opacity"
                          style={{ opacity: open ? 0.85 : 0.45 }}
                        />
                      </button>
                    ) : (
                      /* Words, not a cadence key: the mailbox channel runs on a
                         schedule nobody chose from a list, and this column
                         showed that as a dash. */
                      agent.scheduleWords || '—'
                    )}
                  </td>

                  {/* Last run. Said plainly when it has never run: an agent that
                      has never run looks identical to one that runs silently. */}
                  <td className="text-[12px] tabular-nums whitespace-nowrap" style={{ padding: '9px 10px', color: 'var(--v2-text-secondary)' }}>
                    {when(agent.lastRun) ?? (
                      <span style={{ color: 'var(--v2-text-muted)' }}>
                        {t('automation.never_run') || 'has not run yet'}
                      </span>
                    )}
                  </td>

                  {/* Next run — green ONLY when something is genuinely coming. */}
                  <td className="text-[12px] tabular-nums whitespace-nowrap" style={{ padding: '9px 10px' }}>
                    {state === 'running' && when(agent.nextRun) ? (
                      <span style={{ color: 'var(--v2-success)', fontWeight: 600 }}>
                        {when(agent.nextRun)}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--v2-text-muted)' }}>
                        {state === 'blocked'
                          ? t('automation.next_blocked') || 'waiting on you'
                          : t('automation.next_paused') || 'not while paused'}
                      </span>
                    )}
                  </td>

                  {/* The owner's end of life, in the unit they chose it in. */}
                  <td className="text-[12px] tabular-nums whitespace-nowrap" style={{ padding: '9px 10px', color: 'var(--v2-text-secondary)' }}>
                    {agent.stopAfterDays
                      ? agent.stopAfterDays >= 60 && agent.stopAfterDays % 30 === 0
                        ? (t('automation.stop_after_months') || '{months} months').replace('{months}', String(agent.stopAfterDays / 30))
                        : (t('automation.stop_after_days') || '{days} days').replace('{days}', String(agent.stopAfterDays))
                      : '—'}
                  </td>

                  <td style={{ padding: '9px 6px' }}>
                    <span className="flex items-center gap-1 justify-end">
                      {working ? (
                        <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--v2-text-muted)' }} />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => control(agent.agentId, agent.status === 'active' ? 'pause' : 'resume')}
                            title={agent.status === 'active' ? t('automation.pause') : t('automation.resume')}
                            aria-label={agent.status === 'active' ? t('automation.pause') : t('automation.resume')}
                            className="p-1.5 rounded-lg hover:bg-[var(--v2-bg)] transition-colors"
                            style={{ color: 'var(--v2-text-secondary)' }}
                          >
                            {agent.status === 'active'
                              ? <Pause className="w-3.5 h-3.5" />
                              : <Play className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setRemoving(agent.agentId)}
                            title={t('automation.remove') || 'Remove it'}
                            aria-label={t('automation.remove') || 'Remove it'}
                            className="p-1.5 rounded-lg hover:bg-[var(--v2-bg)] transition-colors"
                            style={{ color: 'var(--v2-text-muted)' }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </span>
                  </td>
                </tr>

                {open && draft && (
                  <ScheduleEditorRow
                    agent={agent}
                    draft={draft}
                    busy={Boolean(working)}
                    onChange={setDraft}
                    onSave={() => saveSchedule(agent.agentId)}
                    onCancel={cancelEdit}
                    t={t}
                    language={language}
                  />
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/*
        ───────────────────────────────────────────────────────────────────────
        REMOVING ASKS, IN THE PLATFORM'S OWN DIALOG.

        It was two buttons appearing inside the row. On a table that is worse
        than it sounds: the row reflows as they appear, the question sits in a
        cell with no room for it, and on a phone the confirm can land off the
        side of a horizontally scrolling table — a destructive control the
        owner has to go looking for.

        A dialog also lets the question be a question. "Stop it" in a cell
        cannot say what stopping means; here it can say that what it already
        sent stays sent, which is the thing an owner actually wants to know
        before pressing.
        ───────────────────────────────────────────────────────────────────────
      */}
      <Dialog open={removing !== null} onOpenChange={open => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-[420px]" style={{ direction: isRTL ? 'rtl' : 'ltr' }}>
          <DialogHeader>
            <DialogTitle style={{ textAlign: isRTL ? 'right' : 'left' }}>
              {(t('automation.remove_title') || 'Stop {agent}?').replace(
                '{agent}',
                removingName ?? ''
              )}
            </DialogTitle>
            <DialogDescription style={{ textAlign: isRTL ? 'right' : 'left' }}>
              {t('automation.remove_body') ||
                'It stops writing to anyone from now on. Everything it has already sent stays as it is, and you can switch it on again later.'}
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => setRemoving(null)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors"
            >
              {t('common.cancel') || 'Cancel'}
            </button>
            <button
              type="button"
              onClick={() => removing && control(removing, 'remove')}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all hover:brightness-110 active:scale-[0.97]"
              /* The status-error family, defined in BOTH theme blocks. A fixed
                 red is the dark-mode contrast problem those tokens exist for. */
              style={{
                background: 'var(--v2-status-error-bg)',
                color: 'var(--v2-status-error-text)',
                border: '1px solid var(--v2-status-error-border)',
              }}
            >
              {t('automation.confirm_remove') || 'Stop it'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The schedule editor, as a row under the agent it belongs to.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IN THE TABLE AND NOT IN A DIALOG
 *
 * The question is two numbers, and the answer is only meaningful next to the
 * row it is about: "every two weeks" means nothing without "which agent", and a
 * modal takes the row away at the moment the owner needs to see it. The remove
 * confirmation IS a dialog, deliberately — that one is destructive and deserves
 * to interrupt. This one is an adjustment.
 *
 * Spanning every column rather than sitting in two cells, because the pickers
 * are taller than a row and a cell-sized editor would reflow the table around
 * itself — the same reason the remove confirmation was taken OUT of the row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT SAYS WHAT WILL HAPPEN BEFORE IT HAPPENS
 *
 * Changing a cadence moves the next run, and an owner who sets "every day" on
 * an agent whose next run is three weeks out has no way to know the server will
 * bring it forward. So the consequence is written under the controls, computed
 * from the same function the server uses, and it updates as they type.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function ScheduleEditorRow({
  agent,
  draft,
  busy,
  onChange,
  onSave,
  onCancel,
  t,
  language,
}: {
  agent: InstalledAgent;
  draft: { schedule: ScheduleInterval; stopAfter: ScheduleInterval | null };
  busy: boolean;
  onChange: (next: { schedule: ScheduleInterval; stopAfter: ScheduleInterval | null }) => void;
  onSave: () => void;
  onCancel: () => void;
  t: (key: string) => string;
  language: string;
}) {
  const unitWord = (unit: 'minutes' | 'hours' | 'days', count: number) =>
    t(`automation.unit.${unit}${count === 1 ? '_one' : ''}`) || unit;

  /*
   * The new next run, worked out here the way the server will work it out:
   * from the LAST run where there is one, so a cadence change is measured from
   * when the agent last worked rather than from the moment a dropdown opened.
   *
   * Shown rather than promised. The server remains the authority — it clamps,
   * and the list is re-read after saving — so this is a preview that can be
   * contradicted, not a second implementation of the rule.
   */
  const preview = nextTickAfter(
    agent.lastRun ? new Date(agent.lastRun) : new Date(),
    draft.schedule
  );

  const changed =
    formatInterval(draft.schedule) !== formatInterval(agent.schedule ?? draft.schedule) ||
    formatInterval(draft.stopAfter ?? agent.stopAfter ?? draft.schedule) !==
      formatInterval(agent.stopAfter ?? draft.schedule);

  return (
    <tr style={{ borderBottom: '1px solid var(--v2-border)' }}>
      <td colSpan={7} style={{ padding: '2px 10px 14px' }}>
        <div
          /*
            ────────────────────────────────────────────────────────────────────
            ONE ROW: both questions, the consequence, and the two buttons.

            It has been three shapes. A wrapping row of stacked blocks put the
            label, number and unit on three lines apiece, so two short questions
            took six. A column of one-line questions fixed that and still used
            two rows for what is one decision.

            One row is right because the two answers are read together — "every
            five minutes, stopping after thirty days" is a single sentence about
            a single agent — and because this sits INSIDE a table row, where
            every extra line pushes the rest of the list further down.

            `flex-wrap` so a narrow screen folds rather than clips: the table
            already scrolls sideways, and an editor that scrolled with it would
            put Save off the edge.
            ────────────────────────────────────────────────────────────────────
          */
          className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg p-3.5"
          style={{
            background: 'color-mix(in srgb, var(--v2-primary) 5%, transparent)',
            border: '1px solid color-mix(in srgb, var(--v2-primary) 22%, transparent)',
          }}
        >
          <IntervalPicker
            id={`cadence-${agent.agentId}`}
            label={t('automation.col_every') || 'Every'}
            /*
              "Runs every", not "Every".
              ──────────────────────────────────────────────────────────────
              Inline, the lead is the whole question — and "כל 1 יום" on its
              own does not say what is happening every day. The stop rule
              beside it already reads as a sentence ("מפסיק אחרי 30 ימים"), so
              this is the half that was missing a verb.
            */
            lead={t('automation.runs_every') || 'Runs every'}
            value={draft.schedule}
            range={agent.cadenceRange}
            onChange={schedule => onChange({ ...draft, schedule })}
            unitLabel={unitWord}
            disabled={busy}
            inline
          />

          {/*
            The stop rule, only where the agent HAS one.

            An agent the owner wrote themselves has no end-of-life concept: the
            bound belongs to a committed plan's find, and there is nothing to
            put it in. Offering the control there would store a number nothing
            reads, which is the defect the threshold stepper on the advisor card
            already had.
          */}
          {agent.stopAfter && (
            <IntervalPicker
              id={`stop-${agent.agentId}`}
              label={t('automation.col_stops') || 'Stops after'}
              /* The column's own words, not "After": inline there is one
                 phrase, and "After 30 days" alone does not say after what. */
              lead={t('automation.col_stops') || 'Stops after'}
              /* The whole interval, both ways. Keeping only the number here is
                 what made the unit chips unpressable. */
              value={draft.stopAfter ?? agent.stopAfter}
              range={agent.stopRange}
              onChange={stopAfter => onChange({ ...draft, stopAfter })}
              unitLabel={unitWord}
              disabled={busy}
              inline
            />
          )}

          <p
            className="text-[11.5px] m-0 ms-auto"
            style={{ color: 'var(--v2-text-muted)' }}
          >
            {(t('automation.next_run_becomes') || 'Next run would be {when}').replace(
              '{when}',
              /* The owner's language, like every other date on this card. */
              preview.toLocaleString(ownerLocale(language), {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })
            )}
          </p>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors disabled:opacity-50"
              style={{ border: 'none', background: 'transparent', cursor: 'pointer' }}
            >
              {t('common.cancel') || 'Cancel'}
            </button>

            <button
              type="button"
              onClick={onSave}
              /*
                Nothing to save is not an error, so the button simply cannot be
                pressed. A Save that reports "nothing changed" teaches the owner
                to distrust the one that worked.
              */
              disabled={busy || !changed}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
              style={{ background: 'var(--v2-primary)', color: '#fff', cursor: 'pointer' }}
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {t('common.save') || 'Save'}
            </button>
          </div>

        </div>
      </td>
    </tr>
  );
}

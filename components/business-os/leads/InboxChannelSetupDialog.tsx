'use client';

/**
 * Connecting a mailbox, in four screens.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE WHOLE CONFIGURATION IS ONE CLICK
 *
 * Screen two is the setup. The owner points at one enquiry their website
 * already sent them, and everything else — which sender to watch, which
 * subject is stable, which labels the body uses — is measured from their own
 * mail rather than typed, guessed or explained. Screens three and four exist
 * to show them what we concluded and what it would have done, before anything
 * is switched on.
 *
 * Nothing writes until "Start now". Screens one to three only read.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT SHOWS WHAT IT COULD NOT READ
 *
 * `unreadable` is drawn on screen four, not swallowed. A template that works
 * on eight messages out of ten is one the owner should see before trusting
 * it — and those two are exactly the messages that will sit unread waiting
 * for them once this is running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT SAYS WHEN NOBODY WOULD BE ANSWERED
 *
 * With `lead_autosend_enabled` off, every part of this works and no client
 * ever hears back. Nothing errors. That warning belongs on the last screen,
 * next to the button, because afterwards there is nothing to see.
 */

import { useCallback, useEffect, useState } from 'react';

import {
  INBOX_CADENCE_DEFAULT,
  INBOX_CADENCE_INTERVAL,
  INBOX_CADENCE_RANGE,
  INBOX_STOP_AFTER_DEFAULT,
  INBOX_STOP_AFTER_RANGE,
} from '@/lib/business-os/leads/inboxProviders';
import { parseInterval, type ScheduleInterval } from '@/lib/business-os/schedule/interval';
import { IntervalPicker } from '@/components/business-os/schedule/IntervalPicker';
import { Loader2, Mail, Check, AlertTriangle, X } from 'lucide-react';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { PluginIcon } from '@/components/PluginIcon';
import type { InboxChannelStatus } from '@/lib/business-os/leads/inboxChannel';
/* The leaf module, by VALUE: `inboxChannel` imports `supabaseServer`, so a
   value import from it would pull the service-role client into this bundle. */
import {
  PROVIDER_NAMES,
  SUPPORTED_PROVIDERS,
  type InboxProvider,
} from '@/lib/business-os/leads/inboxProviders';

/**
 * Five rows a page, and every screen the same height.
 *
 * The picker held thirty rows while the other three screens held a paragraph
 * each, so the panel grew and shrank as the owner moved through the wizard and
 * the buttons moved under their cursor. Five is what fits the shortest screen,
 * so the dialog is one size throughout and a short last page simply leaves
 * space.
 */
const PAGE_SIZE = 5;
const ROW_HEIGHT = 58;
const LIST_HEIGHT = PAGE_SIZE * ROW_HEIGHT;
/** What the body reserves on every screen, so the panel never resizes. */
const BODY_HEIGHT = LIST_HEIGHT + 96;

interface Message {
  id: string;
  from: string;
  subject: string;
  date: string | null;
}

interface Derived {
  template: {
    subjectPrefix: string;
    nameFollowsSubject: boolean;
    labels: string[];
    learnedFrom: number;
  };
  /* The measured rule as facts. It was `mailQuery`, a Gmail query string that
     Outlook cannot read — see `MailboxRule` on the server. */
  rule: { from: string; subjectPrefix: string; since: string };
  watching: string;
  preview: { name: string | null; email: string; phone: string | null; when: string | null }[];
  unreadable: number;
}

export interface InboxChannelSetupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: InboxChannelStatus | null;
  /** Fired once the channel is live, with the fresh status. */
  onEnabled?: (status: InboxChannelStatus) => void;
  /** Where the owner goes to switch replies on. */
  onFixReplies?: () => void;
  /**
   * Fired when this dialog refreshes the status for itself — today, after the
   * owner connects a mailbox from screen one. The host holds the copy its card
   * and readiness row render, so it has to hear about it.
   */
  onStatusChanged?: (status: InboxChannelStatus) => void;
}

export function InboxChannelSetupDialog({
  open,
  onOpenChange,
  status,
  onEnabled,
  onFixReplies,
  onStatusChanged,
}: InboxChannelSetupDialogProps) {
  const { t, isRTL } = useLanguage();

  const [step, setStep] = useState(1);
  const [provider, setProvider] = useState<InboxProvider | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  /*
   * THE CHOSEN MESSAGE, by id.
   *
   * This held the SENDER, on the reasoning that the sender is the only part
   * the next step uses — which is true of the REQUEST and wrong for the UI.
   * Rows were highlighted by `chosen === m.from`, so clicking one message from
   * a sender who had written ten times lit up all ten at once: the owner
   * pressed one row and the list appeared to select itself.
   *
   * The id selects, the sender is derived from it for the request. Both facts
   * stay true and neither leaks into the other.
   */
  const [chosen, setChosen] = useState<string | null>(null);
  /** Where the list is. Five at a time — see `PAGE_SIZE`. */
  const [page, setPage] = useState(0);
  const [derived, setDerived] = useState<Derived | null>(null);
  /*
   * The owner's two choices, opening on what the channel was doing anyway.
   *
   * Intervals rather than a named cadence and a day count: one control asks
   * both questions now, and the same control asks them on the adopt dialog. The
   * named cadence could only say minutes or an hour, so "twice a day" was
   * unaskable here — and the request still carries `cadence` for the server's
   * older path, derived from this on submit.
   */
  const [schedule, setSchedule] = useState<ScheduleInterval>(
    INBOX_CADENCE_INTERVAL[INBOX_CADENCE_DEFAULT]
  );
  const [stopAfter, setStopAfter] = useState<ScheduleInterval>({
    every: INBOX_STOP_AFTER_DEFAULT,
    unit: 'days',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * The English here is the SPEC, not a runtime fallback.
   *
   * `t()` returns the key itself when a dictionary has no entry, so
   * `t('leads.inbox.title') || '…'` can never reach the literal — a missing
   * key renders `leads.inbox.title` on the screen. Every one of these lives in
   * all three dictionaries in `lib/business-os/translations/`, and the
   * literals are kept beside the keys so the next reader can see what each one
   * is meant to say without opening another file.
   */
  const copy = {
    title: t('leads.inbox.title') || 'Leads from your website',
    step: (n: number) => (t('leads.inbox.step') || 'Step {n} of 4').replace('{n}', String(n)),
    whichMailbox: t('leads.inbox.which_mailbox') || 'Which mailbox does your website send enquiries to?',
    onlyMatching:
      t('leads.inbox.only_matching') ||
      'We only read messages that match the enquiry you pick next. Nothing else is opened.',
    pick: t('leads.inbox.pick') || 'Point at one enquiry from your website',
    pickHint: t('leads.inbox.pick_hint') || 'We recognise the rest from it. That is the whole setup.',
    learned: t('leads.inbox.learned') || 'Here is what we will watch for',
    willRead: t('leads.inbox.will_read') || 'And what we will read from each one',
    from: t('leads.inbox.from') || 'Emails from',
    subjectStarts: t('leads.inbox.subject_starts') || 'with a subject starting',
    anySubject: t('leads.inbox.any_subject') || 'any subject',
    fieldName: t('leads.inbox.field_name') || 'Name',
    fieldEmail: t('leads.inbox.field_email') || 'Email',
    fieldPhone: t('leads.inbox.field_phone') || 'Phone',
    whatHappens: t('leads.inbox.what_happens') || 'From now on, every enquiry becomes a lead',
    /* The two questions every agent asks its owner before it runs. */
    howOften: t('leads.inbox.how_often') || 'How often should we check?',
    howFarBack: t('leads.inbox.how_far_back') || 'How far back should we keep looking?',
    howFarBackHint:
      t('leads.inbox.how_far_back_hint') ||
      'An unread message older than this is not a new enquiry, so we leave it alone.',
    days: (n: number) => (t('leads.inbox.n_days') || '{n} days').replace('{n}', String(n)),
    /* The word before the number. Two different ones, because "Every 30 days"
       and "After 30 days" are different sentences and the second question is
       the second one. */
    every: t('automation.every') || 'Every',
    lookBack: t('automation.look_back') || 'Up to',
    /*
     * The unit, agreeing with its number.
     *
     * Singular and plural are separate keys rather than a count glued to a
     * word: "1 דקות" is as wrong as "1 minutes", and Hebrew does not form the
     * plural by adding a letter to the end of the singular.
     */
    unit: (unit: 'minutes' | 'hours' | 'days', count: number) =>
      t(`automation.unit.${unit}${count === 1 ? '_one' : ''}`) || unit,
    whatHappensHint:
      t('leads.inbox.what_happens_hint') ||
      'We file the person who wrote in as a contact, and about fifteen minutes later they get your booking link — unless you have replied yourself by then.',
    /* Singular and plural are separate keys, not a count glued to a word.
       "1 לידים" is wrong in Hebrew and "1 leads" is wrong in English. */
    wouldAdd: (n: number) =>
      n === 1
        ? t('leads.inbox.would_add_one') || 'Their recent mail holds 1 enquiry like this:'
        : (t('leads.inbox.would_add') || 'Their recent mail holds {n} enquiries like this:').replace(
            '{n}',
            String(n)
          ),
    andMore: (n: number) =>
      (t('leads.inbox.and_more') || 'and {n} more').replace('{n}', String(n)),
    couldNotRead: (n: number) =>
      (t('leads.inbox.could_not_read') || '{n} we could not read. Those stay unread for you.')
        .replace('{n}', String(n)),
    repliesOff:
      t('leads.inbox.problem.replies_off') ||
      'Leads are being filed, but “Reply to enquiries” is off, so nobody is being answered.',
    turnOn: t('leads.inbox.problem.fix') || 'Turn it on',
    back: t('common.back') || 'Back',
    next: t('common.next') || 'Next',
    start: t('leads.inbox.start') || 'Start now',
    different: t('leads.inbox.different') || 'Pick a different email',
    noMail: t('leads.inbox.no_mail') || 'No recent messages in that mailbox.',
    reading: t('leads.inbox.reading') || 'Reading your recent mail…',
    newer: t('leads.inbox.newer') || 'Newer',
    older: t('leads.inbox.older') || 'Older',
    pageOf: (n: number, total: number) =>
      (t('leads.inbox.page_of') || '{n} of {total}')
        .replace('{n}', String(n))
        .replace('{total}', String(total)),
    connected: t('leads.inbox.tile.connected') || 'Connected',
    connect: t('leads.inbox.tile.connect') || 'Connect',
    connecting: t('leads.inbox.tile.connecting') || 'Connecting…',
    connectFailed:
      t('leads.inbox.tile.connect_failed') || 'That mailbox could not be connected. Try again.',
    connectCancelled:
      t('leads.inbox.tile.connect_cancelled') || 'The sign-in window closed before it finished.',
    alreadySetUp: t('leads.inbox.tile.already') || 'Already set up',
    setUpChange: t('leads.inbox.tile.set_up_change') || 'Set up · change',
    noMailbox:
      t('leads.inbox.no_mailbox') ||
      'Connect the mailbox your website sends enquiries to, then pick one of its emails.',
    learnedFromOne:
      t('leads.inbox.learned_from_one') ||
      'Learned from one message only, so check the rule above carefully.',
  };

  /*
   * A status this dialog refreshed for itself, after connecting a mailbox.
   *
   * The host fetched the status once and passed it down, which is right for
   * every other purpose — but connecting happens HERE, and the owner must see
   * the tile turn from "not connected" to usable without closing the dialog
   * and reopening it. The host is told as well, so its card agrees.
   */
  const [refreshed, setRefreshed] = useState<InboxChannelStatus | null>(null);
  const live = refreshed ?? status;

  /* Reopening starts over: a half-finished setup carried across opens is a
     setup nobody can see the start of. */
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setMessages(null);
    setChosen(null);
    setDerived(null);
    setError(null);
    setRefreshed(null);
    setProvider(status?.connectable.length === 1 ? status.connectable[0] : null);
  }, [open, status]);


  /*
   * ───────────────────────────────────────────────────────────────────────────
   * STEP FOUR OPENS ON WHAT THIS MAILBOX IS ACTUALLY SET TO.
   *
   * Both answers were `useState` seeded from constants, so the wizard always
   * showed fifteen minutes and thirty days whatever the channel was running on.
   *
   * That is not merely a stale display. Re-running setup on a mailbox that
   * already has a channel takes the UPDATE path in `enableInboxChannel`, so an
   * owner who opened the wizard to fix their template, or to re-point it at a
   * different sender, and pressed "Start now" silently reset a cadence they had
   * deliberately changed in the agents list. Reported after exactly that: a
   * channel set to run daily, and a wizard still offering fifteen minutes.
   *
   * Keyed on the PROVIDER rather than on `open`, because which mailbox this is
   * about is not known until step one is answered — and the answer differs per
   * mailbox: a business may run Gmail hourly and Outlook daily.
   *
   * Falls back to the defaults for a mailbox with no channel yet, and for one
   * installed before the question was asked. Absent has always meant "the
   * default", and the default is what the floor was choosing silently.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    if (!open) return;

    const existing = provider
      ? live?.channels.find(channel => channel.provider === provider)
      : undefined;

    setSchedule(
      parseInterval(existing?.schedule) ?? INBOX_CADENCE_INTERVAL[INBOX_CADENCE_DEFAULT]
    );
    setStopAfter(
      parseInterval(existing?.stopAfter) ?? {
        every: INBOX_STOP_AFTER_DEFAULT,
        unit: 'days',
      }
    );
  }, [open, provider, live]);

  const refreshStatus = useCallback(async (): Promise<InboxChannelStatus | null> => {
    const res = await fetch('/api/business-os/leads/inbox/status', { cache: 'no-store' });
    const body = await res.json().catch(() => null);
    if (!body?.success) return null;
    const next = body.data as InboxChannelStatus;
    setRefreshed(next);
    onStatusChanged?.(next);
    return next;
  }, [onStatusChanged]);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * RE-READ THE CHANNEL WHENEVER THE WIZARD OPENS.
   *
   * `status` is a prop, fetched by the host when the page loaded. An owner who
   * changes a cadence in the agents list and then opens this wizard without
   * reloading would be shown the value from before their change — and, because
   * re-running setup UPDATES rather than creates, pressing "Start now" would
   * write that stale value back over the one they had just chosen.
   *
   * So the dialog asks rather than trusting what it was handed. One GET on
   * open, against a route that already exists for exactly this and is already
   * called after a mailbox is connected.
   *
   * Deliberately not awaited: the reads below fall back to `status` until the
   * answer arrives, so the dialog opens instantly and corrects itself a moment
   * later rather than showing a spinner over a screen that is usually right.
   * ───────────────────────────────────────────────────────────────────────────
   */
  useEffect(() => {
    if (!open) return;
    void refreshStatus();
    /* `refreshStatus` is stable per `onStatusChanged`; re-running this on every
       render would be a GET per keystroke. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Fetch the recent mail for the picker.
   *
   * It moves to screen two FIRST and loads there. Waiting on screen one meant
   * pressing a mailbox tile did nothing visible for several seconds — the
   * reading of a real inbox is not instant — so the owner had no way to tell
   * whether their click had registered. The step changes on the click, which
   * is the acknowledgement, and the list fills in underneath.
   */
  const loadSamples = useCallback(async (p: InboxProvider) => {
    setBusy(true);
    setError(null);
    setMessages(null);
    setChosen(null);
    setPage(0);
    setStep(2);
    try {
      const res = await fetch(`/api/business-os/leads/inbox/samples?provider=${p}`);
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      setMessages(body.data as Message[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      /* Back where they came from: screen two with no list and no explanation
         is a dead end, and the tile they pressed is the thing to press again. */
      setStep(1);
    } finally {
      setBusy(false);
    }
  }, []);

  /**
   * Connect a mailbox from inside the wizard.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * THERE IS NOWHERE ELSE TO DO IT.
   *
   * Business OS has no plugins page: `useChannelConnect` covers Meta, GA and
   * the Google listing and nothing else, so a business whose Outlook token had
   * expired could see the mailbox named here and had no way anywhere in the
   * product to reconnect it. Telling them to "connect it under Plugins" named
   * a screen that does not exist for them.
   *
   * The mechanism already did: `POST /api/v2/plugins/connect` takes any plugin
   * key with an `auth_config`, and both mail plugins are in the business_os
   * profile. Only the button was missing, and the place it belongs is the
   * screen that is asking for the mailbox.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const connectMailbox = useCallback(
    async (p: InboxProvider) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/v2/plugins/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plugin_key: p }),
        });
        const json = await res.json();
        if (!json.success || !json.authUrl) throw new Error(json.error || copy.connectFailed);

        const popup = window.open(json.authUrl, `${p}-oauth`, 'width=600,height=760');

        await new Promise<void>((resolve, reject) => {
          const onMessage = (event: MessageEvent) => {
            if (event.data?.type !== 'plugin-connected' || event.data?.plugin !== p) return;
            cleanup();
            if (event.data.success) resolve();
            else reject(new Error(copy.connectFailed));
          };

          /* A popup closed by hand never posts back. Without this the dialog
             would sit on its spinner for as long as the owner left it open. */
          const closedCheck = window.setInterval(() => {
            if (popup?.closed) {
              cleanup();
              reject(new Error(copy.connectCancelled));
            }
          }, 500);

          function cleanup() {
            window.removeEventListener('message', onMessage);
            window.clearInterval(closedCheck);
          }

          window.addEventListener('message', onMessage);
        });

        /* Straight on into the picker once the mailbox is live: the owner
           pressed a tile meaning "use this one", and making them press the same
           tile again is a step that exists only because we changed state. */
        const next = await refreshStatus();
        if (next?.connectable.includes(p)) {
          setProvider(p);
          setBusy(false);
          await loadSamples(p);
          return;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshStatus, loadSamples]
  );

  const derive = useCallback(async () => {
    if (!provider || !chosen) return;
    /* The id selects; the sender is what the server learns from. Derived here
       so the two never drift apart in state. */
    const picked = messages?.find(m => m.id === chosen);
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/business-os/leads/inbox/derive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, from: picked.from, subject: picked.subject }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      setDerived(body.data as Derived);
      setStep(3);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [provider, chosen, messages]);

  const enable = useCallback(async () => {
    if (!provider || !derived) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/business-os/leads/inbox/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider,
          rule: derived.rule,
          watching: derived.watching,
          template: derived.template,
          schedule,
          stopAfter,
        }),
      });
      const body = await res.json();
      if (!body.success) throw new Error(body.error);
      onEnabled?.(body.data as InboxChannelStatus);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [provider, derived, schedule, stopAfter, onEnabled, onOpenChange]);

  if (!open) return null;

  const repliesOff = live?.problems.includes('replies_off');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.45)', direction: isRTL ? 'rtl' : 'ltr' }}
      onClick={() => !busy && onOpenChange(false)}
    >
      {/*
        THE PANEL SETS ITS OWN TEXT COLOUR.
        ──────────────────────────────────────────────────────────────────────
        Without this, every heading inside that carried no colour class
        inherited one from whichever page mounted the dialog — and in dark mode
        that was near-black text on the dark panel. The dialog is shared by the
        dashboard and the onboarding build page, so it cannot rely on either of
        them having set something sensible: it paints its own ground.
      */}
      <div
        className="w-full max-w-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] max-h-[90vh] overflow-y-auto flex flex-col"
        style={{
          borderRadius: 'var(--v2-radius-card)',
          boxShadow: 'var(--v2-shadow-card)',
          color: 'var(--v2-text-primary)',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 pb-0">
          <div>
            <div className="text-xs font-semibold text-[var(--v2-text-muted)]">
              {copy.step(step)}
              {/* Which mailbox, once one is chosen. A business can set up two
                  of these, and screens two to four look identical for both —
                  so the only thing telling an owner whether they are
                  configuring Gmail or Outlook is this. */}
              {provider && step > 1 && ` · ${PROVIDER_NAMES[provider]}`}
            </div>
            <div className="text-base font-semibold text-[var(--v2-text-primary)] mt-1 flex items-center gap-2">
              {/* The mailbox's own mark once one is chosen, the generic
                  envelope before that — screens two to four are identical for
                  both providers, so this is a second, glanceable answer to
                  "which one am I setting up". */}
              {provider && step > 1 ? (
                <PluginIcon pluginId={provider} className="w-4 h-4" alt="" />
              ) : (
                <Mail className="w-4 h-4" />
              )}{' '}
              {copy.title}
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busy && onOpenChange(false)}
            className="p-1 text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5" style={{ minHeight: BODY_HEIGHT }}>
          {/* ── 1. the mailbox ─────────────────────────────────────────── */}
          {step === 1 && (
            <>
              <div className="text-base font-semibold mb-1">{copy.whichMailbox}</div>

              {/* Belt and braces. Every entry point already hides itself when
                  there is nothing connected, so reaching here means one of them
                  was shown on a stale status — which is a sentence, not a blank
                  screen with a dead Next button. */}
              {(live?.connectable.length ?? 0) === 0 && (
                <p className="text-sm text-[var(--v2-text-secondary)] mt-3 mb-0">{copy.noMailbox}</p>
              )}

              {/*
                EVERY MAILBOX, NOT ONLY THE USABLE ONES.
                ──────────────────────────────────────────────────────────────
                This listed `connectable` alone, so a business with Gmail
                connected and Outlook not saw a single Gmail tile and no sign
                that the other existed. Absence is not an explanation: an owner
                who takes enquiries at an Outlook address would conclude the
                platform cannot read it.

                So all of them are drawn, and the ones that cannot be picked
                say why — already set up, or the account is not connected. Only
                the usable ones are clickable.
              */}
              <div className="flex gap-2 flex-wrap mt-4">
                {SUPPORTED_PROVIDERS.map(p => {
                  const usable = (live?.connectable ?? []).includes(p);
                  const done = (live?.channels ?? []).some(c => c.provider === p);
                  const chosen = provider === p;

                  /* An unconnected mailbox signs in, right here. A connected
                     one goes straight to the picker. Either way the tile is a
                     live control — nothing on this screen is a dead end. */
                  const connecting = busy && provider === p && !usable;

                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        /*
                         * A MAILBOX ALREADY SET UP IS STILL PRESSABLE.
                         *
                         * It was disabled, which made "Change" a dead end: the
                         * control exists to re-measure a form that was
                         * rebuilt, and the only tile worth pressing refused
                         * the click. Setup is idempotent on the provider tag,
                         * so running it again RE-POINTS the same agent — the
                         * mailbox, its history and its tags all survive.
                         */
                        if (usable || done) {
                          setProvider(p);
                          void loadSamples(p);
                          return;
                        }
                        setProvider(p);
                        void connectMailbox(p);
                      }}
                      disabled={busy}
                      className={`flex-1 min-w-[160px] p-4 text-center border transition-colors ${
                        chosen && usable
                          ? 'border-[var(--v2-success-border)] bg-[var(--v2-success-bg)]'
                          : 'border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)]'
                      }`}
                      style={{ borderRadius: 'var(--v2-radius-card)' }}
                    >
                      {/*
                        The real brand marks, from `public/plugins/` — the same
                        assets the Channels card and the plugins page use, via
                        the same component, so Gmail here and Gmail there are
                        the same image. `PluginIcon` already knows Gmail's file
                        is named differently from the rest.
                      */}
                      <PluginIcon
                        pluginId={p}
                        className="w-6 h-6 mx-auto mb-2"
                        /* Decorative: the name is directly below it. */
                        alt=""
                      />
                      <div className="text-sm font-semibold text-[var(--v2-text-primary)]">
                        {PROVIDER_NAMES[p]}
                      </div>
                      {/* What this tile will DO, not merely what it is. An
                          unconnected mailbox says "Connect", because pressing
                          it signs in — "Not connected" described a state and
                          offered nothing. */}
                      <div
                        className={`text-xs mt-1 ${
                          usable || done
                            ? 'text-[var(--v2-text-muted)]'
                            : 'text-[var(--v2-primary)] font-medium'
                        }`}
                      >
                        {connecting
                          ? copy.connecting
                          : done
                            ? /* Says what pressing it DOES, not only what the
                                 mailbox is: "already set up" described a state
                                 and offered nothing. */
                              copy.setUpChange
                            : usable
                              ? copy.connected
                              : copy.connect}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--v2-text-muted)] mt-4 mb-0">{copy.onlyMatching}</p>
            </>
          )}

          {/* ── 2. the one click that is the configuration ──────────────── */}
          {step === 2 && (
            <>
              <div className="text-base font-semibold mb-1">{copy.pick}</div>
              <p className="text-sm text-[var(--v2-text-secondary)] mb-4">{copy.pickHint}</p>

              {/* Still reading the mailbox. Shown HERE rather than on the
                  previous screen, so the click that started it has a visible
                  consequence — and drawn at the list's own height so the panel
                  does not jump when the rows arrive. */}
              {!messages && (
                <div
                  className="flex flex-col items-center justify-center gap-2 border border-[var(--v2-border)] text-[var(--v2-text-muted)]"
                  style={{ borderRadius: '8px', height: LIST_HEIGHT }}
                >
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">{copy.reading}</span>
                </div>
              )}

              {messages && messages.length === 0 && (
                <div
                  className="flex items-center justify-center border border-[var(--v2-border)] text-sm text-[var(--v2-text-muted)]"
                  style={{ borderRadius: '8px', height: LIST_HEIGHT }}
                >
                  {copy.noMail}
                </div>
              )}

              {messages && messages.length > 0 && (
                <>
                  {/*
                    FIVE AT A TIME, AND ALWAYS FIVE ROWS TALL.
                    ──────────────────────────────────────────────────────────
                    Thirty rows made this screen several times the height of
                    the other three, so the panel resized as the owner moved
                    through the wizard and the buttons moved under the cursor.
                    A fixed height means a short last page leaves empty space
                    rather than shrinking the dialog.
                  */}
                  <div
                    className="border border-[var(--v2-border)] overflow-hidden"
                    style={{ borderRadius: '8px', height: LIST_HEIGHT }}
                  >
                    {messages.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map(m => {
                      /* Selection is per MESSAGE. It used to compare senders,
                         so one click lit up every row from that sender. */
                      const picked = chosen === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setChosen(m.id)}
                          className={`w-full text-start flex gap-3 px-3.5 border-b border-[var(--v2-border)] last:border-b-0 transition-colors ${
                            picked ? 'bg-[var(--v2-surface-hover)]' : 'hover:bg-[var(--v2-surface-hover)]'
                          }`}
                          style={{ height: ROW_HEIGHT }}
                        >
                          <span
                            className="w-4 h-4 rounded-full flex-shrink-0 mt-3.5 border-2"
                            style={{
                              borderColor: picked ? 'var(--v2-primary)' : 'var(--v2-border)',
                              borderWidth: picked ? '5px' : '2px',
                            }}
                          />
                          <span className="min-w-0 flex-1 self-center">
                            <span className="flex justify-between gap-2 text-xs text-[var(--v2-text-muted)]">
                              <span className="truncate">{m.from}</span>
                              <span className="flex-shrink-0">{(m.date ?? '').slice(0, 10)}</span>
                            </span>
                            <span className="block text-sm font-medium truncate mt-0.5">
                              {m.subject}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* The pager sits outside the fixed box, so it never moves. */}
                  <div className="flex items-center justify-between gap-2 mt-2.5">
                    <button
                      type="button"
                      onClick={() => setPage(n => Math.max(0, n - 1))}
                      disabled={page === 0}
                      className="px-2.5 py-1 text-xs font-medium text-[var(--v2-text-secondary)] disabled:opacity-40"
                    >
                      {copy.newer}
                    </button>
                    <span className="text-xs text-[var(--v2-text-muted)]">
                      {copy.pageOf(page + 1, Math.ceil(messages.length / PAGE_SIZE))}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPage(n =>
                          Math.min(Math.ceil(messages.length / PAGE_SIZE) - 1, n + 1)
                        )
                      }
                      disabled={page >= Math.ceil(messages.length / PAGE_SIZE) - 1}
                      className="px-2.5 py-1 text-xs font-medium text-[var(--v2-text-secondary)] disabled:opacity-40"
                    >
                      {copy.older}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── 3. what we measured, in their words ─────────────────────── */}
          {step === 3 && derived && (
            <>
              <div className="text-base font-semibold mb-3">{copy.learned}</div>
              <div
                className="p-3.5 mb-3 border border-[var(--v2-border)]"
                style={{ background: 'var(--v2-bg)', borderRadius: '8px' }}
              >
                <div className="text-xs text-[var(--v2-text-muted)] font-medium">{copy.from}</div>
                <div className="text-sm font-semibold font-mono mt-0.5 break-all">
                  {derived.rule.from}
                </div>
                <div className="text-xs text-[var(--v2-text-muted)] font-medium mt-2.5">
                  {copy.subjectStarts}
                </div>
                <div className="text-sm font-semibold font-mono mt-0.5 break-all">
                  {derived.template.subjectPrefix || copy.anySubject}
                </div>
              </div>

              <div className="text-sm font-semibold mb-2">{copy.willRead}</div>
              <div
                className="p-3.5 border border-[var(--v2-border)]"
                style={{ background: 'var(--v2-bg)', borderRadius: '8px' }}
              >
                {/*
                  OUR labels, not the form's.
                  ──────────────────────────────────────────────────────────
                  These were `template.labels[0]` and `[1]` — the form's own
                  field names in the order the form lists them. On a real
                  Elementor form that order is שם, שם משפחה, אימייל, so the
                  EMAIL was drawn under the heading "last name".
                  What is shown here is what WE extracted, so it is named for
                  what it is. The form's label names decided where the values
                  came from; they do not describe what came out.
                */}
                {derived.preview[0] ? (
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    <span className="text-xs text-[var(--v2-text-muted)] font-medium pt-0.5">
                      {copy.fieldName}
                    </span>
                    <span>{derived.preview[0].name ?? '—'}</span>
                    <span className="text-xs text-[var(--v2-text-muted)] font-medium pt-0.5">
                      {copy.fieldEmail}
                    </span>
                    <span className="break-all">{derived.preview[0].email}</span>
                    {/* Only when the form collected one. A row reading "—"
                        would suggest we failed to read a field that was never
                        there. */}
                    {derived.preview[0].phone && (
                      <>
                        <span className="text-xs text-[var(--v2-text-muted)] font-medium pt-0.5">
                          {copy.fieldPhone}
                        </span>
                        <span className="break-all">{derived.preview[0].phone}</span>
                      </>
                    )}
                  </div>
                ) : (
                  <span className="text-sm text-[var(--v2-text-muted)]">—</span>
                )}
              </div>

              {/* One sample is a guess, and says so. */}
              {derived.template.learnedFrom < 2 && (
                <p className="text-xs text-[var(--v2-text-muted)] mt-3 mb-0">{copy.learnedFromOne}</p>
              )}
            </>
          )}

          {/* ── 4. the evidence, then the switch ────────────────────────── */}
          {step === 4 && derived && (
            <>
              {/*
                WHAT WILL HAPPEN, then the evidence for it.
                ──────────────────────────────────────────────────────────────
                This screen opened with a bare count over a list of addresses
                and explained neither. An owner pressing "Start now" could not
                tell what they were starting: that these people become contacts,
                that each is sent their booking link, or that it happens from
                now on rather than to the list in front of them.
              */}
              <div className="text-base font-semibold mb-1">{copy.whatHappens}</div>
              <p className="text-sm text-[var(--v2-text-secondary)] mb-4">{copy.whatHappensHint}</p>

              <div className="text-xs font-medium text-[var(--v2-text-muted)] mb-1.5">
                {copy.wouldAdd(derived.preview.length)}
              </div>

              <div
                className="px-3.5 border border-[var(--v2-border)]"
                style={{ background: 'var(--v2-bg)', borderRadius: '8px' }}
              >
                {derived.preview.slice(0, 5).map((p, i) => (
                  <div
                    key={`${p.email}-${i}`}
                    className="flex justify-between items-baseline gap-3 py-2.5 text-sm border-b border-[var(--v2-border)] last:border-b-0"
                  >
                    {/* The name only when there IS one. It used to fall back to
                        the address, which then appeared twice on the same row —
                        once as the name and once beside it. */}
                    {p.name ? (
                      <>
                        <span className="truncate">{p.name}</span>
                        <span className="text-xs text-[var(--v2-text-muted)] truncate">
                          {p.email}
                        </span>
                      </>
                    ) : (
                      <span className="truncate">{p.email}</span>
                    )}
                  </div>
                ))}
              </div>

              {derived.preview.length > 5 && (
                <p className="text-xs text-[var(--v2-text-muted)] mt-2 mb-0">
                  {copy.andMore(derived.preview.length - 5)}
                </p>
              )}

              {derived.unreadable > 0 && (
                <p className="text-xs text-[var(--v2-text-muted)] mt-2 mb-0">
                  {copy.couldNotRead(derived.unreadable)}
                </p>
              )}

              {/*
                THE TWO QUESTIONS EVERY AGENT ASKS ITS OWNER.
                ──────────────────────────────────────────────────────────────
                An agent adopted from an insight asks how often it should run
                and when it should give up. This channel asked neither: its
                cadence was a constant in the setup module, and its window was
                the date this wizard happened to run on — a fixed point, so it
                widened every day until `max_results` quietly cut off the oldest
                mail.

                Asked here, on the screen that already says what will happen,
                rather than on a settings page nobody opens. Both open on what
                the channel was doing anyway, so an owner who reads neither gets
                today's behaviour.
              */}
              {/*
                One control per question, the same one the adopt dialog uses.

                It was chips, and chips could not carry the request: covering
                minutes to a week is about ten rungs, which is two crowded rows
                in Hebrew and still cannot say "every four hours" until somebody
                adds that rung. A number and a unit covers the span in two taps.
              */}
              <div className="mt-5 flex flex-col gap-4">
                <IntervalPicker
                  id="inbox-cadence"
                  label={copy.howOften}
                  lead={copy.every}
                  value={schedule}
                  range={INBOX_CADENCE_RANGE}
                  onChange={setSchedule}
                  unitLabel={copy.unit}
                />

                <IntervalPicker
                  id="inbox-stop-after"
                  label={copy.howFarBack}
                  lead={copy.lookBack}
                  value={stopAfter}
                  range={INBOX_STOP_AFTER_RANGE}
                  onChange={setStopAfter}
                  unitLabel={copy.unit}
                  hint={copy.howFarBackHint}
                />
              </div>

              {repliesOff && (
                <div
                  className="flex items-center gap-3 mt-4 px-3 py-2.5"
                  style={{
                    background: 'var(--v2-status-warning-bg)',
                    border: '1px solid var(--v2-status-warning-border)',
                    borderRadius: 'var(--v2-radius-button)',
                  }}
                >
                  <AlertTriangle
                    className="w-4 h-4 flex-shrink-0"
                    style={{ color: 'var(--v2-status-warning-text)' }}
                  />
                  <span
                    className="flex-1 text-[13px] leading-snug"
                    style={{ color: 'var(--v2-status-warning-text)' }}
                  >
                    {copy.repliesOff}
                  </span>
                  {onFixReplies && (
                    <button
                      type="button"
                      onClick={onFixReplies}
                      className="px-3 py-1.5 text-[13px] font-medium bg-[var(--v2-surface)] border border-[var(--v2-border)] flex-shrink-0"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {copy.turnOn}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {error && (
            <p className="text-[13px] mt-4 mb-0" style={{ color: 'var(--v2-error-text)' }}>
              {error}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-5 py-4 border-t border-[var(--v2-border)]">
          <button
            type="button"
            onClick={() => (step === 1 ? onOpenChange(false) : setStep(step - 1))}
            disabled={busy}
            className="px-4 py-2 text-sm font-medium text-[var(--v2-text-secondary)] disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {copy.back}
          </button>

          <div className="flex items-center gap-2">
            {step === 3 && (
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium border border-[var(--v2-border)] disabled:opacity-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {copy.different}
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={() => void derive()}
                disabled={busy || !chosen}
                className="px-4 py-2 text-sm font-medium text-white disabled:opacity-50 flex items-center gap-2 ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97]"
                style={{ background: 'var(--v2-primary)', borderRadius: 'var(--v2-radius-button)' }}
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                {copy.next}
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={() => setStep(4)}
                disabled={busy}
                /*
                  `ap-primary-lift`, the same class the dashboard's Needs-you
                  buttons carry. It exists for dark mode: white on an owner's
                  brand fill can measure under 3:1, which the eye reads as a
                  blurry button rather than a low-contrast one, so the class
                  deepens the fill 22% and swaps the glow for a flat shadow.
                  Plain `var(--v2-primary)` here was that bug.
                */
                className="px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97]"
                style={{ background: 'var(--v2-primary)', borderRadius: 'var(--v2-radius-button)' }}
              >
                {copy.next}
              </button>
            )}

            {step === 4 && (
              <button
                type="button"
                onClick={() => void enable()}
                disabled={busy}
                className="px-4 py-2 text-sm font-medium text-white disabled:opacity-50 flex items-center gap-2 ap-primary-lift transition-all hover:brightness-110 active:scale-[0.97]"
                style={{ background: 'var(--v2-primary)', borderRadius: 'var(--v2-radius-button)' }}
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {copy.start}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

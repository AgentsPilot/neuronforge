'use client';

/**
 * ProposalBuilderModal
 *
 * Where the owner answers a quote request.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY IS NOT
 *
 * It is not a quoting tool. There are no line items, no unit prices, no
 * quantities and no cost breakdown — because the moment a proposal holds a
 * breakdown, this product owes the user a catalogue, a markup model and a
 * margin report, and becomes the project-management tool it is not trying to
 * be.
 *
 * What a small business actually needs to send is one number and a paragraph
 * explaining it, plus how that number is paid. So the owner types the total
 * they already worked out elsewhere, describes the work in their own words, and
 * splits the money into stages.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The split is the one place with a hard rule: percentages must sum to exactly
 * 100. A proposal that adds up to 90% is a client agreeing to pay less than the
 * total they were shown, and the difference is only discovered when the last
 * invoice is short. So sending is blocked, and the shortfall is named.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  PAYMENT_TERMS_PRESETS,
  DEFAULT_PAYMENT_TERMS_DAYS,
} from '@/lib/payments/paymentTerms';
import { FileText, Loader2, Paperclip, Plus, Send, Trash2, AlertTriangle, X, CalendarClock } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { useLanguage } from '@/lib/business-os/LanguageContext';
import { windowsForDate, type TimeOffEntry } from '@/lib/scheduling/availabilityWindows';
import { closedDayVerdict } from '@/lib/scheduling/closedDay';
import { recurringLocalInputs, MAX_OCCURRENCES, type Cadence } from '@/lib/scheduling/recurrence';
import {
  toBusinessLocalInput,
  fromBusinessLocalInput,
  shiftBusinessDateKey,
  businessDateKey,
  safeTimezone,
} from '@/lib/scheduling/businessTime';

const logger = createLogger({ module: 'ProposalBuilderModal' });

/** Mirrors `PaymentShape` in ProposalRepository. */
type ShapeKind = 'single' | 'installments' | 'milestones';

/**
 * How a PACKAGE is paid for — the only two answers that mean anything about a
 * block of meetings.
 *
 * `upfront` is today's single payment: one invoice, and the meetings are held
 * `pending` until it clears. `per_session` is a milestone plan whose stages ARE
 * the meetings: nothing due on approval, each meeting billed when it is marked
 * held. Neither is a new payment shape — see `PackageSessions.bill_per_session`.
 */
type PackagePay = 'upfront' | 'per_session';

/**
 * The scheduling teal, as the calendar and the service editor already use it.
 *
 * Borrowed deliberately rather than picked: everything in this product that
 * occupies an hour is this colour, so the package block reads as the diary half
 * of the quote at a glance. The money beside it keeps the dialog's own neutral.
 */
const MEETINGS_COLOR = '#14B8A6';

interface Stage {
  label: string;
  /** Held as a string so a half-typed "1" is not read as 1%. */
  percent: string;
}

interface ProposalBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
  /** The service they asked about, when the request named one. */
  serviceId?: string | null;
  /** The booking this quote answers. Ties it to one request, not to the service. */
  bookingId?: string | null;
  /** Pre-fills the title — usually the service name from the request. */
  defaultTitle?: string;
  currency?: string;
  /** A previous proposal this one replaces, after a decline. */
  supersedesId?: string | null;
  /**
   * That proposal's contents, to open on.
   *
   * A revision is almost never a rewrite — it is the same work at a different
   * price, or the same price paid differently. Starting from blank means
   * retyping a paragraph and a payment schedule to change one number, which is
   * how an owner decides not to re-quote at all.
   */
  basedOn?: {
    title: string;
    description: string | null;
    total: number;
    /**
     * Where this version stands, which decides whether it may be revised.
     *
     * Absent on a caller that does not know, which reads as "not revisable" —
     * the safe answer for a button that can create a second quote for one job.
     */
    status?: string;
    /*
     * Carried into a revision, like the title and the description.
     *
     * A client who negotiated 60 days does not expect them to silently reset
     * to the business default because the price changed.
     */
    payment_terms_days?: number | null;
    payment_shape: {
      kind: 'single' | 'installments' | 'milestones';
      count?: number;
      frequency?: 'weekly' | 'biweekly' | 'monthly' | 'quarterly';
      stages?: Array<{ label: string; percent: number }>;
    };
    /**
     * The meetings that version sold, for a package.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * WITHOUT IT A REVISION STOPPED BEING A PACKAGE.
     *
     * A per-session package's `payment_shape` is `milestones` with its stages
     * labelled "Meeting 1"…"Meeting 6" — so a revision inherited six WORK
     * PHASES called Meeting 1 to 6, the Package switch was off, and the six
     * dates were gone. The owner then re-quoted a block of sessions as a staged
     * job, which is a different offer.
     * ─────────────────────────────────────────────────────────────────────────
     */
    sessions?: {
      dates: string[];
      duration_minutes: number;
      bill_per_session?: boolean;
    } | null;
  } | null;
  /**
   * Show the quote as it was sent, with nothing editable.
   *
   * There was no way for an owner to READ a quote they had already sent. The
   * drawer showed the amount and the status, the version strip showed the
   * history, and the words themselves — the description, the payment shape, the
   * terms — existed only on the client's copy. An owner taking a phone call about
   * a quote had to ask the client what it said.
   *
   * Reuses this dialog rather than adding a viewer: `basedOn` already carries
   * every field, because a revision opens on the previous version. The same data,
   * the same layout, minus the ability to change it.
   */
  readOnly?: boolean;
  /** Leave read-only mode and revise this version. Absent hides the button. */
  onRevise?: () => void;
  /** Their reason for declining, so the owner can revise against it. */
  declineReason?: string | null;
  declineNote?: string | null;
  onSent: () => void;
  t: (key: string) => string;
  isRTL?: boolean;
}

/** The stage sets an owner reaches for, before they start editing. */
const PRESETS: Record<string, Array<{ labelKey: string; percent: number }>> = {
  deposit_balance: [
    { labelKey: 'proposal.stage.deposit', percent: 50 },
    { labelKey: 'proposal.stage.on_completion', percent: 50 },
  ],
  thirds: [
    { labelKey: 'proposal.stage.on_signing', percent: 30 },
    { labelKey: 'proposal.stage.midway', percent: 40 },
    { labelKey: 'proposal.stage.on_completion', percent: 30 },
  ],
};

export function ProposalBuilderModal({
  isOpen,
  onClose,
  contactId,
  contactName,
  serviceId = null,
  bookingId = null,
  defaultTitle = '',
  currency = 'USD',
  supersedesId = null,
  basedOn = null,
  readOnly = false,
  onRevise,
  declineReason = null,
  declineNote = null,
  onSent,
  t,
  isRTL = false,
}: ProposalBuilderModalProps) {
  /*
   * The business's clock, for a package's meeting times.
   *
   * `t` arrives as a prop here — this dialog is rendered by a drawer that
   * already has it — so only the zone is taken from the context. Every date
   * the owner types below is the hour the CLIENT turns up at, which is the
   * business's and not the browser's.
   */
  const { timezone } = useLanguage();

  /*
   * Which versions a revision may replace.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The same list `ProposalRepository.markSuperseded` will act on, mirrored here
   * on purpose: if the button offers a revision the data layer would refuse to
   * retire, the old quote keeps accepting alongside the new one.
   *
   * ACCEPTED IS ABSENT, and that is the whole point. Acceptance already raised
   * an invoice, created a payment plan and its stages, and froze the snapshot
   * that settles a dispute. Revising it left both quotes live, so a client who
   * accepted the second got a second invoice and a second plan for one job.
   * Changing an accepted quote is not an edit; it is cancelling a deal and
   * striking a new one, which is not this button.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const REVISABLE = ['draft', 'sent', 'viewed', 'declined'];
  const canRevise = Boolean(basedOn?.status && REVISABLE.includes(basedOn.status));

  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState('');
  const [total, setTotal] = useState('');
  const [validUntil, setValidUntil] = useState('');
  const [kind, setKind] = useState<ShapeKind>('single');
  const [stages, setStages] = useState<Stage[]>([]);
  const [installmentCount, setInstallmentCount] = useState(3);
  /*
   * How long the client gets to pay, agreed on THIS quote.
   *
   * `null` means the business default — which is what most quotes mean, and
   * what every quote meant before this existed. Applies to all three shapes:
   * a single payment, each instalment, and each milestone as it is billed.
   */
  const [termsDays, setTermsDays] = useState<number | null>(null);
  /**
   * Whether the owner has answered the terms question themselves.
   *
   * Choosing `מראש` for a package moves the terms to "due on receipt", because
   * "up front" and "pay in 60 days" are opposite instructions. That is a
   * DEFAULT, not a rule: once the owner has touched the control, nothing moves
   * it again — a figure the screen keeps overwriting is worse than a wrong one.
   */
  const [termsTouched, setTermsTouched] = useState(false);
  const [defaultTermsDays, setDefaultTermsDays] = useState(DEFAULT_PAYMENT_TERMS_DAYS);
  const [frequency, setFrequency] = useState<'weekly' | 'biweekly' | 'monthly' | 'quarterly'>(
    'monthly'
  );

  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A PACKAGE: several meetings sold as one purchase.
   *
   * Six coaching sessions, a course of four treatments, ten lessons. The dates
   * are EXPLICIT, never a repeat rule: a rule has to be expanded somewhere, and
   * expanding it needs clash detection, time off, DST-correct stepping and a
   * preview before the owner can trust what they are sending — whereas six
   * dates cost six date pickers. The dates are also what was AGREED, which is
   * what a dispute needs to read.
   *
   * Each entry is a `datetime-local` string on the BUSINESS's clock, the same
   * form the booking dialog uses, so what the owner types is the hour the
   * client turns up at wherever the owner happens to be sitting.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [isPackage, setIsPackage] = useState(false);
  const [packagePay, setPackagePay] = useState<PackagePay>('upfront');
  /*
   * THE PATTERN, which is how the owner describes a block of twelve.
   *
   * Three controls — when the first one is, how often, how many — and the list
   * below is generated from them. Typing twelve dates by hand is not a feature;
   * what the owner needs afterwards is to move the one that falls on a holiday,
   * which is why every generated date stays editable.
   */
  const [firstSession, setFirstSession] = useState('');
  const [cadence, setCadence] = useState<Cadence>('weekly');
  const [sessionCount, setSessionCount] = useState(6);
  /** The dates themselves: generated, then edited. This is what gets stored. */
  const [sessionDates, setSessionDates] = useState<string[]>([]);
  const [sessionMinutes, setSessionMinutes] = useState<number>(60);
  /**
   * Whether the length came from the version being revised.
   *
   * The service's own duration is a DEFAULT for a new package. On a revision
   * the length is part of what was agreed — 50 minutes where the service now
   * says 60 — and the service fetch below resolved a moment later and quietly
   * overwrote it.
   */
  const [minutesFromQuote, setMinutesFromQuote] = useState(false);
  /** The closed days and short days, so a bad date is named where it is shown. */
  const [timeOff, setTimeOff] = useState<TimeOffEntry[]>([]);
  /**
   * The service's weekly hours, and the hours already taken.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A quote is not the owner's own booking dialog. There, an hour outside the
   * usual pattern is unremarkable — owners see a client at 7am all the time —
   * and a clash is refused at the write with a good error.
   *
   * Here the dates go to a CLIENT, who approves them, and acceptance then
   * creates what it can and SKIPS what it cannot: a clashing date becomes a
   * meeting that quietly is not there. So all three are worth saying before the
   * quote is sent: the day is closed, the hour is outside the service's hours,
   * or something is already booked in it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const [serviceHours, setServiceHours] = useState<unknown>(null);
  const [takenSlots, setTakenSlots] = useState<Array<{ start: string; end: string }>>([]);

  /*
   * The proposal document.
   *
   * Optional by design — a ₪400 job needs a number and a sentence, not a PDF —
   * but for anything substantial the document IS the offer: scope, exclusions,
   * terms. The toggle exists so attaching one is a deliberate act rather than
   * an empty field every owner scrolls past.
   */
  const [attachDocument, setAttachDocument] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Big enough for a real proposal, small enough to survive an inbox. */
  const MAX_FILE_MB = 10;

  /*
   * A local preview of the file about to be sent.
   *
   * `URL.createObjectURL` rather than an upload-then-fetch: the point is to
   * check you attached the RIGHT document before it reaches a client, and that
   * check is worthless if it only becomes possible after sending.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * CREATED AND REVOKED IN THE SAME EFFECT, deliberately.
   *
   * The obvious shape — `useMemo` to create, an effect to revoke — is broken in
   * development. StrictMode runs effects twice: mount, cleanup, mount. The
   * cleanup revoked the URL, and the memo did not re-run because `file` had not
   * changed, so the preview pointed at a URL the browser had already released
   * and the panel rendered blank.
   *
   * Pairing them means each run creates its own URL and revokes the one it
   * created, which is correct under StrictMode and in production alike.
   * ─────────────────────────────────────────────────────────────────────────
   */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);

    // Object URLs are held by the document until revoked; a modal opened twenty
    // times would otherwise pin twenty files in memory.
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const isPdf = file?.type === 'application/pdf';
  const isImage = Boolean(file?.type?.startsWith('image/'));

  /*
   * What the form opens on.
   *
   * A REVISION opens on the quote it replaces. A new quote opens blank —
   * reopening for a different client must never inherit the last one's numbers,
   * which is what this effect originally existed to prevent.
   *
   * `validUntil` is deliberately NOT carried over: the old date is in the past
   * by the time anyone is revising, and silently reusing it would send a quote
   * that expired before it arrived.
   */
  useEffect(() => {
    if (!isOpen) return;

    if (basedOn) {
      setTitle(basedOn.title);
      setDescription(basedOn.description ?? '');
      setTotal(String(basedOn.total));

      /*
       * A REVISION OF A PACKAGE IS STILL A PACKAGE.
       *
       * Read from `sessions` and not from the payment shape: a per-session
       * package IS a milestone plan underneath, so inheriting the shape alone
       * reopened six meetings as six phases of work.
       *
       * The dates come back as the owner typed them — converted from the stored
       * instants onto the business's clock — because a revision is almost never
       * a re-plan: it is the same block at a different price. Any date now in
       * the past is marked in red and blocks sending, which is what should
       * happen to a quote being revised weeks later.
       */
      const previousSessions = basedOn.sessions;

      if (previousSessions?.dates?.length) {
        const locals = previousSessions.dates
          .map(iso => new Date(iso))
          .filter(at => !Number.isNaN(at.getTime()))
          .map(at => toBusinessLocalInput(at, packageZone));

        setIsPackage(true);
        setPackagePay(previousSessions.bill_per_session ? 'per_session' : 'upfront');
        setSessionDates(locals);
        setFirstSession(locals[0] ?? '');
        setSessionCount(locals.length || 1);
        setSessionMinutes(previousSessions.duration_minutes || 60);
        setMinutesFromQuote(Boolean(previousSessions.duration_minutes));
        /*
         * The job-shape state stays untouched: for a package it is derived from
         * `packagePay` at send, and leaving the stage rows of "Meeting 1…6"
         * behind would put them back on screen the moment the switch is turned
         * off.
         */
        setKind('single');
        setStages([]);
      } else {
        setIsPackage(false);
        setSessionDates([]);
        setFirstSession('');
        setMinutesFromQuote(false);
        setKind(basedOn.payment_shape?.kind ?? 'single');
        setStages(
          basedOn.payment_shape?.stages?.map(s => ({
            label: s.label,
            percent: String(s.percent),
          })) ?? []
        );
      }

      setInstallmentCount(basedOn.payment_shape?.count ?? 3);
      setFrequency(basedOn.payment_shape?.frequency ?? 'monthly');
    } else {
      setTitle(defaultTitle);
      setDescription('');
      setTotal('');
      setKind('single');
      setStages([]);
      setInstallmentCount(3);
      setFrequency('monthly');
      setIsPackage(false);
      setSessionDates([]);
      setFirstSession('');
      setMinutesFromQuote(false);
    }

    setValidUntil('');
    setTermsDays(basedOn?.payment_terms_days ?? null);
    /*
     * A revision inherits the terms that were negotiated, so they count as
     * ANSWERED: the package default must not pull a client's agreed 15 days
     * back to due-on-receipt behind the owner's back.
     */
    setTermsTouched(Boolean(basedOn));
    setAttachDocument(false);
    setFile(null);
    setError(null);
    setSending(false);
    /*
     * Keyed on `supersedesId`, NOT on `basedOn`.
     *
     * `basedOn` arrives from a `.find()` over the drawer's proposals, so its
     * identity changes every time that list is refetched — and the drawer
     * refetches on its own. Listing the object here would wipe whatever the
     * owner had typed the moment a background refresh landed. The id is a
     * string and only changes when a genuinely different quote is being
     * revised.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, defaultTitle, contactId, supersedesId]);

  /*
   * The route accepts four currencies. A service carrying anything else — or a
   * lowercase code — would fail Zod and come back as "Invalid proposal", which
   * tells the owner nothing about a field this form does not even show them.
   * Normalised here, and the display below uses the same value the API will.
   */
  const ACCEPTED = ['USD', 'EUR', 'ILS', 'GBP'];
  const sendCurrency = ACCEPTED.includes((currency || '').toUpperCase())
    ? currency.toUpperCase()
    : 'USD';

  /*
   * The business default, fetched so the control can NAME it.
   *
   * "Default" as a bare word tells an owner nothing — they need to see that it
   * means 30 days before deciding this job needs 60.
   */
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    fetch('/api/business-os/invoice-settings')
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d?.data) return;
        setDefaultTermsDays(d.data.invoice_payment_terms_days ?? DEFAULT_PAYMENT_TERMS_DAYS);
      })
      .catch(() => {
        // A failed read is not worth blocking the quote: the server resolves
        // the same default when the invoice is raised.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  const totalNumber = Number(total.replace(/,/g, ''));
  const totalValid = total.trim() !== '' && Number.isFinite(totalNumber) && totalNumber > 0;

  /*
   * The percentages, and whether they are allowed to be sent.
   *
   * Compared against a cent of tolerance rather than exactly, because a third
   * of a job is 33.33 + 33.33 + 33.34 and floating point will not agree that
   * those make 100 on the nose. The tolerance is far tighter than any real
   * rounding an owner would type.
   */
  const percentSum = useMemo(
    () => stages.reduce((sum, s) => sum + (Number(s.percent) || 0), 0),
    [stages]
  );
  const splitComplete = kind !== 'milestones' || Math.abs(percentSum - 100) < 0.01;
  const stagesNamed = kind !== 'milestones' || stages.every(s => s.label.trim().length > 0);

  const money = (amount: number) =>
    new Intl.NumberFormat(isRTL ? 'he-IL' : 'en-US', {
      style: 'currency',
      currency: sendCurrency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);

  /** What each stage is worth, so the owner sees money and not just percentages. */
  const stageAmount = (percent: string) =>
    totalValid ? (totalNumber * (Number(percent) || 0)) / 100 : 0;

  const applyPreset = (key: keyof typeof PRESETS) => {
    setKind('milestones');
    setStages(PRESETS[key].map(s => ({ label: t(s.labelKey), percent: String(s.percent) })));
  };

  const updateStage = (index: number, patch: Partial<Stage>) =>
    setStages(prev => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));

  /*
   * A toggle turned on with no file chosen blocks sending.
   *
   * The alternative — quietly sending without the document — is worse than an
   * error: the owner believes the client received the offer in full, and the
   * client is asked to agree to a number with nothing behind it.
   */
  const documentReady = !attachDocument || Boolean(file);

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE PACKAGE'S DATES, AND WHAT IS WRONG WITH THEM
   *
   * Checked here rather than at acceptance, because acceptance SKIPS a date it
   * cannot take — the client has agreed by then, so refusing the whole package
   * would leave them with nothing — and a skipped date is a meeting that
   * quietly is not there. The place to catch it is before the quote is sent.
   *
   * A QUOTE IS NOT THE OWNER'S OWN BOOKING DIALOG. There, an hour outside the
   * usual pattern is unremarkable and a clash is refused at the write with a
   * good error. Here the dates go to a client who approves them, so each of
   * these is worth saying first:
   *
   *   · `empty`   — not filled in yet; sending is blocked;
   *   · `past`    — a client cannot accept their way into last Tuesday; blocked;
   *   · `closed`  — a day the owner closed, named with their own reason;
   *   · `outside` — the service is not open at that hour on that day;
   *   · `taken`   — something is already booked in it, so acceptance would skip
   *                 this date entirely.
   *
   * Only the first two block sending. The rest are warnings: the owner may well
   * be opening for this client, or moving the other booking.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const packageZone = safeTimezone(timezone);

  const sessionProblems = useMemo(
    () =>
      sessionDates.map(local => {
        if (!local || local.length < 16) return 'empty' as const;

        const start = fromBusinessLocalInput(local, packageZone);
        if (start.getTime() < Date.now()) return 'past' as const;

        const end = new Date(start.getTime() + sessionMinutes * 60_000);
        const dateKey = local.slice(0, 10);
        const from = local.slice(11, 16);
        const to = toBusinessLocalInput(end, packageZone).slice(11, 16);

        /*
         * A day the owner closed, or a short day this hour falls outside of.
         * Asked first because it is the owner's own statement about that date,
         * and the most specific thing that can be said about it.
         */
        const closed = closedDayVerdict(timeOff, dateKey, { start: from, end: to });
        if (closed.closed) return { closed } as const;

        /*
         * THE SERVICE'S OWN HOURS, through the same resolver the public booking
         * page uses — so a client could never have been offered this hour
         * either. Skipped entirely when the hours have not loaded or the
         * service keeps none: an empty `availability` means "no pattern
         * recorded", not "never open".
         */
        const windows = serviceHours ? windowsForDate(serviceHours, dateKey, timeOff) : [];
        if (windows.length > 0) {
          const inside = windows.some(window => from >= window.start && to <= window.end);
          if (!inside) return { outside: windows[0] } as const;
        }

        /*
         * And whether the hour is already sold. Half-open overlap, the same test
         * the database constraint makes: a meeting ending exactly when this one
         * starts is not a clash.
         */
        const clash = takenSlots.some(
          slot => new Date(slot.start) < end && new Date(slot.end) > start
        );
        if (clash) return 'taken' as const;

        return null;
      }),
    [sessionDates, timeOff, sessionMinutes, packageZone, serviceHours, takenSlots]
  );

  /*
   * HOW LOUD EACH PROBLEM IS, and what it costs.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * RED MEANS THERE WILL BE NO MEETING. A date in the past cannot be sent at
   * all, and a date whose hour is already sold is SKIPPED by acceptance — the
   * client approves five dates and gets four meetings, which is the failure
   * this whole panel exists to prevent.
   *
   * AMBER MEANS IT WILL BE BOOKED ANYWAY, on a day the owner closed or outside
   * the service's hours. That may be exactly what they intend — a holiday
   * exception for one client — so it is a warning and not a refusal.
   *
   * The two must not look the same, which they did: one 11px amber line under
   * every kind of problem, reading as "note" where half of them mean "lost".
   * ───────────────────────────────────────────────────────────────────────────
   */
  type SessionProblem = (typeof sessionProblems)[number];

  const problemTone = (problem: SessionProblem): 'lost' | 'warn' | null => {
    if (!problem || problem === 'empty') return null;
    return problem === 'past' || problem === 'taken' ? 'lost' : 'warn';
  };

  const lostCount = sessionProblems.filter(p => problemTone(p) === 'lost').length;
  const warnCount = sessionProblems.filter(p => problemTone(p) === 'warn').length;

  /*
   * THE LIST, REGENERATED FROM THE PATTERN.
   *
   * Only the entries the pattern decides are rewritten: an owner who moved
   * session three to a Thursday and then raised the count from six to eight
   * keeps their Thursday and gains two. Without that, every change to the
   * pattern would silently undo the edits the pattern exists to allow.
   *
   * Called from the three pattern controls rather than run in an effect, so
   * nothing regenerates behind the owner's back while they are mid-edit.
   */
  const regenerate = (first: string, every: Cadence, count: number, previous: string[]) => {
    if (!first || first.length < 16) return previous;

    const generated = recurringLocalInputs(
      first.slice(0, 10),
      first.slice(11, 16),
      every,
      count
    );

    /*
     * An edited row is one that differs from what the pattern would have put
     * there — so regenerating with the SAME pattern keeps it, and changing the
     * pattern replaces it. That is the only reading under which both controls
     * mean what they say.
     */
    const previousPattern = recurringLocalInputs(
      previous[0]?.slice(0, 10) ?? '',
      previous[0]?.slice(11, 16) ?? '',
      cadence,
      previous.length
    );

    return generated.map((value, index) => {
      const wasEdited =
        previous[index] !== undefined &&
        previousPattern[index] !== undefined &&
        previous[index] !== previousPattern[index];

      return wasEdited && every === cadence ? previous[index] : value;
    });
  };

  /**
   * What one meeting costs, which is what makes "after each meeting" concrete.
   *
   * Derived, never typed: the owner names the price of the BLOCK, and a figure
   * the two could disagree about is a figure that will. Zero sessions reads as
   * nothing rather than a division by zero.
   */
  const perSessionAmount =
    sessionDates.length > 0 && totalNumber > 0 ? totalNumber / sessionDates.length : 0;

  /**
   * What the terms actually govern, which differs by arrangement.
   *
   * The label says "payment terms", which reads as a property of one invoice.
   * For a staged plan it is the deadline on every milestone once billed; for
   * instalments it also decides when the first period falls due, so it moves
   * the whole schedule. Worth one line rather than a support conversation.
   */
  const termsHintKey = isPackage
    ? packagePay === 'per_session'
      ? 'proposal.terms_hint_per_session'
      : 'proposal.terms_hint_upfront'
    : kind === 'milestones'
      ? 'proposal.terms_hint_stages'
      : kind === 'installments'
        ? 'proposal.terms_hint_installments'
        : 'proposal.terms_hint_single';

  /** Sending is blocked only by a date that is missing or already gone. */
  const packageReady =
    !isPackage ||
    (sessionDates.length > 0 &&
      sessionProblems.every(problem => problem !== 'empty' && problem !== 'past'));

  /*
   * The service's own length, as the default for each meeting.
   *
   * Taken from the service rather than asked for: a quote for six sessions of a
   * 50-minute service is six 50-minute meetings, and making the owner retype
   * that is the kind of question a form asks rather than a colleague. Editable,
   * because a package session is sometimes longer than the taster.
   */
  useEffect(() => {
    if (!serviceId) return;
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch(`/api/scheduling/services/${serviceId}`);
        const data = await response.json();
        const service = data?.service ?? data?.data;
        const minutes = Number(service?.duration_minutes);
        if (cancelled) return;
        // Never over a length inherited from the quote being revised.
        if (!minutesFromQuote && Number.isFinite(minutes) && minutes > 0) {
          setSessionMinutes(minutes);
        }
        // Its weekly hours, which is what makes "outside the hours" answerable.
        if (service?.availability) setServiceHours(service.availability);
      } catch {
        // An hour is the fallback, and the owner can change it.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [serviceId, minutesFromQuote]);

  /*
   * WHAT IS ALREADY BOOKED across the window these dates cover.
   *
   * Re-read when the series moves, because the window moves with it. Only the
   * statuses that actually hold a slot: a cancelled meeting frees its hour, and
   * warning about it would send the owner hunting for a booking that is not
   * there. Those four statuses are `SLOT_HOLDING_STATUSES` plus the booking
   * being quoted — this list is client-side, so it names them rather than
   * importing a server constant.
   */
  const seriesFrom = sessionDates[0] ?? '';
  const seriesTo = sessionDates[sessionDates.length - 1] ?? '';

  useEffect(() => {
    if (!isPackage || !seriesFrom || !seriesTo) {
      setTakenSlots([]);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const from = fromBusinessLocalInput(seriesFrom, packageZone);
        // A day past the last one, so a meeting late on that day is included.
        const to = new Date(fromBusinessLocalInput(seriesTo, packageZone).getTime() + 86_400_000);

        const params = new URLSearchParams({
          start_date: from.toISOString(),
          end_date: to.toISOString(),
          limit: '200',
        });

        const response = await fetch(`/api/scheduling/bookings?${params.toString()}`);
        const data = await response.json();

        if (cancelled || !data?.success || !Array.isArray(data.bookings)) return;

        setTakenSlots(
          (data.bookings as Array<Record<string, unknown>>)
            .filter(
              booking =>
                booking.start_time &&
                booking.end_time &&
                ['confirmed', 'pending', 'completed'].includes(String(booking.status))
            )
            .map(booking => ({ start: String(booking.start_time), end: String(booking.end_time) }))
        );
      } catch {
        /*
         * Silent: an unreadable list loses the clash warning, not the feature.
         * The slot is still protected by the database's exclusion constraint,
         * and acceptance reports a date it could not take.
         */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isPackage, seriesFrom, seriesTo, packageZone]);

  /* The closed days, read once: the warning beside each date needs them. */
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await fetch('/api/scheduling/time-off');
        const data = await response.json();
        if (!cancelled && data?.success && Array.isArray(data.data)) {
          setTimeOff(data.data as TimeOffEntry[]);
        }
      } catch {
        /*
         * Silent: an unreadable list loses the warning, not the feature. The
         * dates are still checked on the owner's calendar, where a closed day
         * is drawn, and a clash is reported at acceptance.
         */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const canSend =
    totalValid &&
    title.trim().length > 0 &&
    splitComplete &&
    stagesNamed &&
    documentReady &&
    packageReady &&
    !sending;

  /**
   * A pill segmented control, matching the services list.
   *
   * Copied in shape from `SchedulingServicesList`, which is where the payment
   * plan is chosen today — a fully-rounded track holding fully-rounded
   * segments, the active one raised onto the surface colour rather than
   * outlined. Radio cards would be a heavier answer than these questions
   * deserve; they are short, mutually exclusive labels.
   */
  const segment = (
    options: { value: string; label: string; active: boolean; onClick: () => void }[]
  ) => (
    <div
      role="group"
      className="inline-flex p-0.5 border border-[var(--v2-border)] bg-[var(--v2-bg)] self-start"
      style={{ borderRadius: '999px' }}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          onClick={option.onClick}
          aria-pressed={option.active}
          className={`px-3.5 py-1.5 text-[12.5px] transition-colors ${
            option.active
              ? 'bg-[var(--v2-surface)] text-[var(--v2-text-primary)] font-medium shadow-sm'
              : 'text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)]'
          }`}
          style={{ borderRadius: '999px' }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * A PER-SESSION PACKAGE IS A MILESTONE PLAN WHOSE STAGES ARE ITS MEETINGS.
     *
     * One stage per meeting, an equal share each, and `bill_per_session` on the
     * package itself is what tells acceptance to make every stage MANUAL and
     * bind it to its own meeting. The shape stays `milestones` so every reader
     * that already understands a staged plan — the email, the client's page,
     * the Money page, the drawer — keeps working with no change.
     *
     * The percentages are computed so they SUM TO 100 exactly: the last stage
     * takes the remainder, because 100/3 three times is not 100 and the server
     * refuses a split that does not cover the job. The money itself is split by
     * `splitTotal` at acceptance, which is where the rounding is made exact.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const sessionStages = () => {
      const n = sessionDates.length;
      const share = Math.floor((100 / n) * 10_000) / 10_000;

      return sessionDates.map((_, index) => ({
        label: t('proposal.package_session_n').replace('{n}', String(index + 1)),
        percent:
          index === n - 1
            ? Number((100 - share * (n - 1)).toFixed(4))
            : share,
      }));
    };

    const payment_shape = isPackage
      ? packagePay === 'per_session'
        ? { kind: 'milestones' as const, stages: sessionStages() }
        : { kind: 'single' as const }
      : kind === 'milestones'
        ? {
            kind: 'milestones' as const,
            stages: stages.map(s => ({ label: s.label.trim(), percent: Number(s.percent) })),
          }
        : kind === 'installments'
          ? { kind: 'installments' as const, count: installmentCount, frequency }
          : { kind: 'single' as const };

    try {
      /*
       * The document goes up FIRST.
       *
       * Ordering matters: a quote created before a failed upload would exist,
       * be sendable, and claim a document it does not have. Uploading first
       * means the worst case is a stored file with no quote against it —
       * invisible clutter rather than a client receiving an offer with the
       * substance missing.
       */
      let documentId: string | null = null;

      if (attachDocument && file) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          // `result` is a data URL; the API wants the payload alone.
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });

        const uploadRes = await fetch(`/api/crm/contacts/${contactId}/documents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: file.name,
            document_type: 'proposal',
            file_name: file.name,
            file_size: file.size,
            mime_type: file.type || 'application/octet-stream',
            file_content: base64,
          }),
        });

        const uploaded = await uploadRes.json();
        if (!uploaded.success || !uploaded.document?.id) {
          setError(uploaded.error || t('proposal.error_upload'));
          setSending(false);
          return;
        }
        documentId = uploaded.document.id;
      }

      // Two calls on purpose: the proposal exists as a draft before anything is
      // emailed, so a transport failure leaves something the owner can retry
      // rather than a lost hour of typing.
      const createRes = await fetch('/api/business-os/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contactId,
          service_id: serviceId,
          booking_id: bookingId,
          title: title.trim(),
          description: description.trim() || null,
          currency: sendCurrency,
          total: totalNumber,
          valid_until: validUntil || null,
          payment_shape,
          /*
           * The meetings, as absolute instants.
           *
           * The inputs hold the business's wall clock; the column holds
           * instants, because a meeting happens at a moment and every reader —
           * the diary, the email, the client's calendar — needs that moment
           * rather than a string whose zone has to be remembered.
           */
          sessions: isPackage
            ? {
                dates: sessionDates.map(local =>
                  fromBusinessLocalInput(local, packageZone).toISOString()
                ),
                duration_minutes: sessionMinutes,
                // What makes the stages above the MEETINGS rather than phases.
                bill_per_session: packagePay === 'per_session',
              }
            : null,
          supersedes_id: supersedesId,
          document_id: documentId,
          payment_terms_days: termsDays,
        }),
      });
      const created = await createRes.json();
      // `proposal`, not `data` — the route names it after the thing. Reading
      // the wrong key threw a TypeError inside the try, which the catch below
      // then reported as a transport failure: the quote HAD been saved, and
      // the owner was told it had not.
      if (!created.success || !created.proposal?.id) {
        setError(created.error || t('proposal.error_create'));
        setSending(false);
        return;
      }

      const sendRes = await fetch(`/api/business-os/proposals/${created.proposal.id}/send`, {
        method: 'POST',
      });
      const sent = await sendRes.json();
      if (!sent.success) {
        // The draft survived; say so, so the owner does not retype it.
        setError(sent.error || t('proposal.error_send_draft_kept'));
        setSending(false);
        return;
      }

      onSent();
      onClose();
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? { message: err.message, stack: err.stack } : err, contactId },
        'Could not send the proposal'
      );
      setError(t('proposal.error_send'));
      setSending(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      {/*
        Wide enough to hold the offer and the document that justifies it.
        ─────────────────────────────────────────────────────────────────────
        The preview sits AFTER the form in the DOM, so `dir` places it on the
        far side: left in RTL, right in LTR. It is not a decorative panel — an
        owner sending a five-figure quote wants to see that the file attached is
        the one they meant, and doing that after sending is not checking.

        It collapses on narrow screens rather than shrinking both halves into
        uselessness.
      */}
      {/*
        Built to the service editor's pattern — same shell, same sticky header
        with an accent tile, same scrolling body, same footer rule. Two dialogs
        that create the things a business sells should not look like two
        products.

        The width is still a STYLE, not a class: `DialogContent` hard-codes
        `max-w-lg` in its own class list, and this project's `cn` is a plain
        join with no tailwind-merge — so an overriding class would leave both on
        the element and let CSS source order decide. An inline style beats every
        class outright.
      */}
      <DialogContent
        className="w-full h-[100dvh] sm:h-auto sm:max-h-[90dvh] flex flex-col bg-[var(--v2-surface)] border-[var(--v2-border)] p-0 overflow-hidden transition-[max-width] duration-200"
        style={{ maxWidth: file ? '64rem' : '42rem' }}
        dir={isRTL ? 'rtl' : 'ltr'}
      >
        {/* Sticky header — `pe-14` leaves room for the close button. */}
        <div className="flex-shrink-0 border-b border-[var(--v2-border)] px-4 sm:px-6 py-4 sm:py-6 pe-12 sm:pe-14 bg-[var(--v2-surface)]">
          <div className="flex items-center gap-3 sm:gap-4">
            <div
              className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg sm:rounded-xl flex items-center justify-center flex-shrink-0 border"
              style={{
                color: 'var(--v2-primary)',
                borderColor: 'var(--v2-primary)',
                background: 'color-mix(in srgb, var(--v2-primary) 10%, transparent)',
              }}
            >
              <FileText className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogHeader>
                <DialogTitle className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)] rtl:text-right truncate">
                  {readOnly
                    ? t('proposal.view_title')
                    : supersedesId
                      ? t('proposal.revise_title')
                      : t('proposal.new_title')}
                </DialogTitle>
              </DialogHeader>
              <p className="text-xs sm:text-sm text-[var(--v2-text-secondary)] mt-1 truncate">
                {t('proposal.for')} {contactName}
              </p>
              {/*
                Why there is no Revise button on this one.

                A control that quietly disappears reads as a bug. The owner came
                here to change something, so the screen has to say that this
                quote is settled and what to do instead.
              */}
              {readOnly && basedOn?.status === 'accepted' && (
                <p className="text-xs text-[var(--v2-text-muted)] mt-1">
                  {t('proposal.accepted_locked')}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
        <div className={`overflow-y-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6 ${file ? 'w-full md:w-[420px] md:shrink-0' : 'flex-1'}`}>
          {/*
            ONE `fieldset` rather than `disabled` on twenty inputs.

            Read-only mode shows the quote exactly as it was sent, and a
            disabled fieldset disables every form control inside it natively —
            including keyboard focus, which `pointer-events-none` would not.
            Adding the attribute to each field would be the same behaviour
            spread over twenty places, and the twenty-first would be missed.

            `border-0 p-0 m-0 min-w-0` because a fieldset ships a border and
            padding, and `min-width: min-content` by default, which would stop
            the body shrinking in the flex row above.
          */}
          <fieldset
            disabled={readOnly}
            className="space-y-4 sm:space-y-6 border-0 p-0 m-0 min-w-0"
          >
          {/* Why they said no, when this is a revision. The owner is quoting
              against a stated objection, and it belongs on screen while they
              set the new number — not one drawer away. */}
          {supersedesId && declineReason && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm">
              <p className="font-medium text-amber-900">
                {t(`proposal.decline.reason.${declineReason}`)}
              </p>
              {declineNote && <p className="mt-0.5 text-amber-800">{declineNote}</p>}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
              {t('proposal.field.title')}
            </label>
            <Input value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
          </div>

          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
              {t('proposal.field.description')}
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={4}
              maxLength={5000}
              placeholder={t('proposal.field.description_placeholder')}
              className="w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)] outline-none focus:border-[var(--v2-primary)]"
            />
            <p className="mt-1 text-xs text-[var(--v2-text-secondary)]">
              {t('proposal.field.description_hint')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              {/* `htmlFor`/`id`, which this pair never had: the label was not
                  associated with the field, so a screen reader announced an
                  unnamed input and clicking the word did not focus it. */}
              <label
                htmlFor="proposal-total"
                className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2"
              >
                {t('proposal.field.total')}
              </label>
              <Input
                id="proposal-total"
                value={total}
                onChange={e => setTotal(e.target.value)}
                inputMode="decimal"
                placeholder="0"
                className="tabular-nums"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                {t('proposal.field.valid_until')}
              </label>
              {/*
                `max` is not decoration.

                A native date input accepts a five-digit year — type a 6 in
                front of 2026 and the browser submits "62026-09-10" without
                complaint. Three quotes in this database carry exactly that, and
                every screen that shows one reads "10 בספט׳ 62026". The API
                refuses it now too; this stops it a step earlier, where the
                person can still see what they typed.
              */}
              <Input
                type="date"
                value={validUntil}
                max={`${new Date().getFullYear() + 10}-12-31`}
                onChange={e => setValidUntil(e.target.value)}
              />
            </div>
          </div>

          {/*
            A PACKAGE — several meetings sold as one purchase.
            ─────────────────────────────────────────────────────────────────
            Tinted in the SCHEDULING teal, the colour the calendar and the
            service editor already use for anything that occupies an hour, so
            the block reads as the diary half of the quote rather than as one
            more field. Everything inside it is about meetings; everything
            outside is about money and words.

            The fields are sized to what they hold. A date is eleven
            characters and a count is two, and a row of full-width inputs made
            ten meetings look like a form to fill in rather than a series to
            check. The generated dates sit in two compact columns for the same
            reason: twelve of them are a block you scan, not a list you read.
          */}
          <div
            className="rounded-xl border p-3.5"
            style={{
              borderColor: `${MEETINGS_COLOR}33`,
              backgroundColor: `${MEETINGS_COLOR}0D`,
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <label htmlFor="proposal-is-package" className="min-w-0 cursor-pointer">
                <span className="flex items-center gap-2 text-sm font-semibold text-[var(--v2-text-primary)]">
                  <CalendarClock className="h-4 w-4 shrink-0" style={{ color: MEETINGS_COLOR }} />
                  {t('proposal.package')}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-[var(--v2-text-secondary)]">
                  {t('proposal.package_hint')}
                </span>
              </label>

              {/* Pinned to LTR, as in DailyBriefingCard: the shared Switch
                  shifts its thumb rightwards by a fixed amount, which inside an
                  RTL dialog would carry it out of its own track. */}
              <div dir="ltr" className="mt-0.5 shrink-0">
                <Switch
                  id="proposal-is-package"
                  checked={isPackage}
                  disabled={readOnly || !serviceId}
                  onCheckedChange={checked => {
                    setIsPackage(checked);

                    /*
                     * The same default the moment it is switched on, and undone
                     * when it is switched off: a one-off job has no reason to be
                     * due on receipt unless the owner said so.
                     */
                    if (!termsTouched) setTermsDays(checked ? 0 : null);

                    if (checked && !firstSession) {
                      /*
                       * Opens on a week today at 10:00 and generates the
                       * default six weekly meetings straight away, so the owner
                       * sees what the controls do rather than an empty panel
                       * they have to work out.
                       */
                      const nextWeek = shiftBusinessDateKey(
                        businessDateKey(new Date(), packageZone),
                        7
                      );
                      const first = `${nextWeek}T10:00`;
                      setFirstSession(first);
                      setSessionDates(recurringLocalInputs(nextWeek, '10:00', cadence, sessionCount));
                    }
                    // Turning it off drops the dates: leaving them staged would
                    // send a package the owner had just decided against.
                    if (!checked) {
                      setSessionDates([]);
                      setFirstSession('');
                    }
                  }}
                />
              </div>
            </div>

            {/*
              A package needs a service, and this quote has none. The meetings
              are bookings and `scheduling_bookings.service_id` is NOT NULL, so
              rather than let the owner fill in ten dates that acceptance would
              refuse, the switch is disabled and says why.
            */}
            {!serviceId && (
              <p className="mt-2.5 text-xs text-[var(--v2-text-secondary)]">
                {t('proposal.package_needs_service')}
              </p>
            )}

            {isPackage && (
              <div className="mt-3.5 flex flex-col gap-3.5">
                {/* The pattern: three short answers on one line where there is
                    room, each the width of what it holds. */}
                <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
                  <div>
                    <label
                      htmlFor="proposal-first-session"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--v2-text-secondary)]"
                    >
                      {t('proposal.package_first')}
                    </label>
                    <Input
                      id="proposal-first-session"
                      type="datetime-local"
                      disabled={readOnly}
                      value={firstSession}
                      onChange={e => {
                        setFirstSession(e.target.value);
                        setSessionDates(regenerate(e.target.value, cadence, sessionCount, sessionDates));
                      }}
                      className="h-9 w-[12.5rem] bg-[var(--v2-surface)] text-[13px]"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="proposal-session-count"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--v2-text-secondary)]"
                    >
                      {t('proposal.package_how_many')}
                    </label>
                    <Input
                      id="proposal-session-count"
                      type="number"
                      min={1}
                      max={MAX_OCCURRENCES}
                      disabled={readOnly}
                      value={sessionCount}
                      onChange={e => {
                        const next = Math.min(
                          Math.max(Number(e.target.value) || 1, 1),
                          MAX_OCCURRENCES
                        );
                        setSessionCount(next);
                        setSessionDates(regenerate(firstSession, cadence, next, sessionDates));
                      }}
                      className="h-9 w-16 bg-[var(--v2-surface)] text-center text-[13px] tabular-nums"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="proposal-session-minutes"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--v2-text-secondary)]"
                    >
                      {t('proposal.package_each_lasts')}
                    </label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="proposal-session-minutes"
                        type="number"
                        min={5}
                        max={1440}
                        step={5}
                        disabled={readOnly}
                        value={sessionMinutes}
                        onChange={e => setSessionMinutes(Number(e.target.value) || 60)}
                        className="h-9 w-16 bg-[var(--v2-surface)] text-center text-[13px] tabular-nums"
                      />
                      <span className="text-xs text-[var(--v2-text-secondary)]">
                        {t('proposal.package_minutes')}
                      </span>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-[var(--v2-text-secondary)]">
                    {t('proposal.package_repeats')}
                  </span>
                  {segment(
                    (['weekly', 'biweekly', 'monthly'] as Cadence[]).map(value => ({
                      value,
                      label: t(`proposal.package_cadence_${value}`),
                      active: cadence === value,
                      onClick: () => {
                        if (readOnly) return;
                        setSessionDates(regenerate(firstSession, value, sessionCount, sessionDates));
                        setCadence(value);
                      },
                    }))
                  )}
                </div>

                {/*
                  THE DATES THEMSELVES — generated, and every one editable.
                  Two columns, because a dozen of them in one column is a scroll
                  and a block the owner cannot take in at a glance. The owner's
                  real job here is the one week that is a holiday, and that is a
                  single picker rather than a re-plan.
                */}
                {sessionDates.length > 0 && (
                  <div
                    className="flex flex-col gap-2.5 border-t pt-3"
                    style={{ borderColor: `${MEETINGS_COLOR}26` }}
                  >
                    {/*
                      THE HEADLINE, so twelve dates do not have to be scanned to
                      find the one that is wrong.
                      ─────────────────────────────────────────────────────────
                      Counted, not listed: the rows themselves say which. Lost
                      wins over warned when both exist, because "two of these
                      will not be booked" is the sentence that changes what the
                      owner does next.
                    */}
                    {(lostCount > 0 || warnCount > 0) && (
                      <div
                        className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                          lostCount > 0
                            ? 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
                            : 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>
                          {lostCount > 0
                            ? t('proposal.package_dates_lost').replace('{count}', String(lostCount))
                            : t('proposal.package_dates_warned').replace(
                                '{count}',
                                String(warnCount)
                              )}
                        </span>
                      </div>
                    )}

                    <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
                      {sessionDates.map((local, index) => {
                        const problem = sessionProblems[index];
                        const tone = problemTone(problem);

                        return (
                          /*
                            The whole cell carries the problem, not a line of
                            small print under it: a tinted ground, a coloured
                            field, and the message at a size somebody reads.
                          */
                          <div
                            key={index}
                            className={`rounded-lg px-1.5 py-1 ${
                              tone === 'lost'
                                ? 'bg-red-500/10'
                                : tone === 'warn'
                                  ? 'bg-amber-500/10'
                                  : ''
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className={`w-5 shrink-0 text-[11px] font-semibold tabular-nums ${
                                  tone === 'lost'
                                    ? 'text-red-600 dark:text-red-400'
                                    : tone === 'warn'
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : 'text-[var(--v2-text-muted)]'
                                }`}
                              >
                                {index + 1}
                              </span>
                              <Input
                                type="datetime-local"
                                disabled={readOnly}
                                value={local}
                                onChange={e => {
                                  const next = [...sessionDates];
                                  next[index] = e.target.value;
                                  setSessionDates(next);
                                }}
                                className={`h-8 w-[12.5rem] bg-[var(--v2-surface)] text-[12.5px] ${
                                  tone === 'lost'
                                    ? 'border-red-500/70 focus:border-red-500'
                                    : tone === 'warn'
                                      ? 'border-amber-500/70 focus:border-amber-500'
                                      : ''
                                }`}
                              />
                              {!readOnly && sessionDates.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSessionDates(sessionDates.filter((_, i) => i !== index));
                                    setSessionCount(sessionDates.length - 1);
                                  }}
                                  /* Always visible, quietly. `opacity-0` with
                                     a `group-hover` that has no `group` parent
                                     left it invisible-but-clickable on a phone,
                                     which is worse than a grey icon. */
                                  className="shrink-0 rounded-md p-1 text-[var(--v2-text-muted)] transition-colors hover:bg-[var(--v2-surface)] hover:text-[var(--v2-text-secondary)]"
                                  aria-label={t('proposal.package_remove_date')}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>

                            {/*
                              Under its own date, inside its own cell. Each
                              kind says the specific thing: a closed day names
                              the owner's reason, a wrong hour names the hours
                              that ARE open, and a taken slot says it will not
                              be booked — because acceptance would skip it.
                            */}
                            {problem && problem !== 'empty' && (
                              <p
                                className={`mt-1 ms-[1.625rem] flex items-start gap-1.5 text-xs font-medium leading-snug ${
                                  tone === 'lost'
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-amber-700 dark:text-amber-400'
                                }`}
                              >
                                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                                {problem === 'past'
                                  ? t('proposal.package_date_past')
                                  : problem === 'taken'
                                    ? t('proposal.package_date_taken')
                                    : 'outside' in problem
                                      ? t('proposal.package_date_outside')
                                          .replace('{start}', problem.outside.start)
                                          .replace('{end}', problem.outside.end)
                                      : `${t('scheduling.closed')}${
                                          problem.closed.reason ? ` · ${problem.closed.reason}` : ''
                                        }`}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    <p className="text-xs text-[var(--v2-text-secondary)]">
                      {t('proposal.package_count')
                        .replace('{count}', String(sessionDates.length))
                        .replace('{minutes}', String(sessionMinutes))}
                    </p>
                  </div>
                )}

                {/* Nothing to show yet: the first date is what starts it. */}
                {sessionDates.length === 0 && (
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    {t('proposal.package_pick_first')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* How the money arrives. */}
          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
              {t('proposal.field.payment')}
            </label>

            {/*
              ─────────────────────────────────────────────────────────────────
              A PACKAGE IS ASKED A DIFFERENT QUESTION.
              `תשלום אחד / לפי שלבים / בתשלומים` is the right question for a
              JOB: one payment, phases of work, or periods of time. A block of
              ten meetings has no phases and no periods — it has meetings, and
              the only two answers that mean anything are the two this offers:
              the whole block before the first one, or each one as it happens.
              A quote with no meetings keeps all three, untouched.
              ─────────────────────────────────────────────────────────────────
            */}
            {isPackage ? (
              <>
                {segment(
                  (['upfront', 'per_session'] as PackagePay[]).map(option => ({
                    value: option,
                    label: t(`proposal.package_pay_${option}`),
                    active: packagePay === option,
                    onClick: () => {
                      setPackagePay(option);

                      /*
                       * A PACKAGE IS DUE ON RECEIPT, either way, unless the
                       * owner says otherwise.
                       *
                       * `מראש` means before the first meeting, and the business
                       * default — 45 days on the account this was found on —
                       * would leave the hours held and the meetings unconfirmed
                       * for six weeks.
                       *
                       * `אחרי כל פגישה` means paying for the session that just
                       * happened. The invoice goes out the moment the owner
                       * marks it held, so a 45-day term turns "after each
                       * meeting" into "six weeks after each meeting" — which is
                       * not what either side read.
                       *
                       * A DEFAULT, not a rule: once the owner has answered the
                       * terms themselves, nothing moves them again.
                       */
                      if (!termsTouched) setTermsDays(0);
                    },
                  }))
                )}

                {/*
                  The consequence, which is the part that was missing: whether
                  the client pays before the first meeting, and when the
                  meetings become confirmed. Those differ between the two
                  answers and nothing on the screen said so.
                */}
                <p className="mt-2 text-xs leading-relaxed text-[var(--v2-text-secondary)]">
                  {packagePay === 'per_session'
                    ? t('proposal.package_pay_per_session_why').replace(
                        '{each}',
                        perSessionAmount ? money(perSessionAmount) : '—'
                      )
                    : t('proposal.package_pay_upfront_why')}
                </p>
              </>
            ) : (
              segment(
                (['single', 'milestones', 'installments'] as ShapeKind[]).map(option => ({
                  value: option,
                  label: t(`proposal.shape.${option}`),
                  active: kind === option,
                  onClick: () => {
                    setKind(option);
                    if (option === 'milestones' && stages.length === 0) {
                      applyPreset('deposit_balance');
                    }
                  },
                }))
              )
            )}
          </div>

          {!isPackage && kind === 'installments' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                  {t('proposal.field.count')}
                </label>
                <Input
                  type="number"
                  min={2}
                  max={24}
                  value={installmentCount}
                  onChange={e => setInstallmentCount(Number(e.target.value))}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
                  {t('proposal.field.frequency')}
                </label>
                <select
                  value={frequency}
                  onChange={e => setFrequency(e.target.value as typeof frequency)}
                  className="w-full rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)]"
                >
                  {(['weekly', 'biweekly', 'monthly', 'quarterly'] as const).map(f => (
                    <option key={f} value={f}>
                      {t(`proposal.frequency.${f}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* A block of sessions has no phases to bill against. */}
          {!isPackage && kind === 'milestones' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('proposal.field.stages')}
                </label>
                {/*
                  The same segmented control as the two above.
                  ─────────────────────────────────────────────────────────────
                  `active` is computed from the stages rather than remembered:
                  these apply a split, and the owner can edit any percentage
                  afterwards. A segment that stayed lit after the numbers had
                  been changed would be claiming a split that is no longer
                  there, so it un-lights the moment they diverge.
                */}
                {segment(
                  (Object.keys(PRESETS) as Array<keyof typeof PRESETS>).map(key => {
                    const preset = PRESETS[key];
                    const matches =
                      stages.length === preset.length &&
                      preset.every((p, i) => Number(stages[i]?.percent) === p.percent);
                    return {
                      value: key,
                      label: preset.map(p => p.percent).join('/'),
                      active: matches,
                      onClick: () => applyPreset(key),
                    };
                  })
                )}
              </div>

              {stages.map((stage, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={stage.label}
                    onChange={e => updateStage(index, { label: e.target.value })}
                    placeholder={t('proposal.field.stage_label')}
                    maxLength={120}
                    className="flex-1"
                  />
                  <div className="relative w-20 shrink-0">
                    <Input
                      value={stage.percent}
                      onChange={e => updateStage(index, { percent: e.target.value })}
                      inputMode="decimal"
                      className="tabular-nums pe-6"
                    />
                    <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-xs text-[var(--v2-text-secondary)]">
                      %
                    </span>
                  </div>
                  {/* The money each stage is worth. A percentage is what the
                      owner types; an amount is what they are agreeing to. */}
                  <span className="w-24 shrink-0 text-end text-sm tabular-nums text-[var(--v2-text-secondary)]">
                    {totalValid ? money(stageAmount(stage.percent)) : '—'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setStages(prev => prev.filter((_, i) => i !== index))}
                    className="shrink-0 p-1.5 text-[var(--v2-text-secondary)] hover:text-red-500"
                    aria-label={t('proposal.remove_stage')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setStages(prev => [...prev, { label: '', percent: '' }])}
                className="flex items-center gap-1.5 text-sm text-[var(--v2-primary)]"
              >
                <Plus className="w-4 h-4" />
                {t('proposal.add_stage')}
              </button>

              {/* The rule, stated while it is being broken rather than at the
                  moment of sending. The shortfall is named in percent AND in
                  money — "10% missing" is abstract; "₪6,000 unaccounted for" is
                  the number the owner recognises. */}
              {!splitComplete && stages.length > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    {t('proposal.split_incomplete')} {percentSum.toFixed(2).replace(/\.?0+$/, '')}%
                    {totalValid && (
                      <> · {money(Math.abs(totalNumber - (totalNumber * percentSum) / 100))}</>
                    )}
                  </span>
                </div>
              )}
            </div>
          )}

          {/*
            When it has to be paid.
            ───────────────────────────────────────────────────────────────────
            AFTER the shape, because that is the order the question makes sense
            in: the terms mean something different for each arrangement, and
            above it they were a deadline for an invoice nobody had described
            yet.

            They are relevant to EVERY shape, which is easy to doubt and worth
            recording. A single payment: the deadline for its one invoice. A
            staged plan: the deadline for the deposit, and then for each
            milestone from the moment the owner bills it — a milestone has no
            date of its own, so `billStage` falls back to these terms. An
            instalment plan: the first period is due after them and the cadence
            steps from there, so changing them moves the whole schedule.
          */}
          <div>
            <label className="block text-sm font-medium text-[var(--v2-text-primary)] mb-2">
              {t('proposal.field.terms')}
            </label>
            {/* The same segmented control, so the two questions on this
                screen read as one form rather than two. */}
            {segment([
              {
                value: 'default',
                // Names its number, so "default" is not a word the owner has to
                // go and look up.
                label: t('proposal.terms_default').replace('{days}', String(defaultTermsDays)),
                active: termsDays === null,
                onClick: () => {
                  setTermsDays(null);
                  setTermsTouched(true);
                },
              },
              ...PAYMENT_TERMS_PRESETS.filter(preset => preset.days >= 0).map(preset => ({
                value: preset.value,
                label: t(`invoice.payment_terms_values.${preset.key}`),
                active: termsDays === preset.days,
                onClick: () => {
                  setTermsDays(preset.days);
                  setTermsTouched(true);
                },
              })),
            ])}

            {/*
              What they actually govern, which the label alone does not say:
              "payment terms" reads as a property of one invoice, and for stages
              and instalments it is the deadline applied to every bill.
            */}
            <p className="mt-2 text-xs text-[var(--v2-text-secondary)]">{t(termsHintKey)}</p>
          </div>

          {/*
            The proposal document.
            ─────────────────────────────────────────────────────────────────
            Last in the form, because it is the last thing an owner does: they
            write the price, then attach the paperwork that justifies it.
          */}
          <div className="rounded-lg border border-[var(--v2-border)] px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <label htmlFor="attach-proposal-document" className="min-w-0 cursor-pointer">
                <span className="block text-sm font-medium text-[var(--v2-text-primary)]">
                  {t('proposal.attach_document')}
                </span>
                <span className="mt-0.5 block text-xs text-[var(--v2-text-secondary)]">
                  {t('proposal.attach_document_hint')}
                </span>
              </label>

              {/*
                Pinned to LTR, as in DailyBriefingCard.
                The shared Switch moves its thumb with a fixed rightward
                `translate-x-[20px]`. Inside this RTL dialog the track itself
                lays out right-to-left, so the thumb would start at the right
                edge and that shift would carry it clean out of the track. The
                row around it still mirrors, so the control stays on the correct
                side of its label.
              */}
              <div dir="ltr" className="mt-0.5 shrink-0">
                <Switch
                  id="attach-proposal-document"
                  checked={attachDocument}
                  onCheckedChange={checked => {
                    setAttachDocument(checked);
                    // Turning it off drops the file too — leaving it staged
                    // would send a document the owner had just decided against.
                    if (!checked) {
                      setFile(null);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }
                  }}
                />
              </div>
            </div>

            {attachDocument && (
              <div className="mt-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,image/*"
                  className="hidden"
                  onChange={e => {
                    const chosen = e.target.files?.[0];
                    if (!chosen) return;
                    // Checked here rather than on send: an owner who picks a
                    // 40MB file should be told immediately, not after they have
                    // finished writing the quote.
                    if (chosen.size > MAX_FILE_MB * 1024 * 1024) {
                      setError(t('proposal.error_file_too_big').replace('{max}', String(MAX_FILE_MB)));
                      e.target.value = '';
                      return;
                    }
                    setError(null);
                    setFile(chosen);
                  }}
                />

                {file ? (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--v2-surface)] px-3 py-2">
                    <Paperclip className="h-4 w-4 shrink-0 text-[var(--v2-text-secondary)]" />
                    <span className="flex-1 truncate text-sm text-[var(--v2-text-primary)]">
                      {file.name}
                    </span>
                    <span className="shrink-0 text-xs tabular-nums text-[var(--v2-text-secondary)]">
                      {(file.size / 1024 / 1024).toFixed(1)} MB
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setFile(null);
                        if (fileInputRef.current) fileInputRef.current.value = '';
                      }}
                      className="shrink-0 p-1 text-[var(--v2-text-secondary)] hover:text-red-500"
                      aria-label={t('proposal.remove_file')}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--v2-border)] px-3 py-3 text-sm text-[var(--v2-text-secondary)] transition-colors hover:border-[var(--v2-primary)] hover:text-[var(--v2-primary)]"
                  >
                    <Paperclip className="h-4 w-4" />
                    {t('proposal.choose_file')}
                  </button>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          </fieldset>
        </div>

        {/* The document, beside the offer. Hidden below md: two columns in a
            phone-width dialog leaves neither of them usable. */}
        {file && previewUrl && (
          <div
            className="hidden min-w-0 flex-1 flex-col border-s md:flex"
            style={{ borderColor: 'var(--v2-border)', background: 'var(--v2-surface)' }}
          >
            <div
              className="flex items-center gap-2 border-b px-4 py-2.5"
              style={{ borderColor: 'var(--v2-border)' }}
            >
              <Paperclip className="h-4 w-4 shrink-0 text-[var(--v2-text-secondary)]" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--v2-text-primary)]">
                {file.name}
              </span>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 text-xs text-[var(--v2-primary)] hover:underline"
              >
                {t('proposal.open_in_tab')}
              </a>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-3">
              {isPdf ? (
                /* An iframe, not <embed>: the object URL is same-origin and
                   every browser this runs in renders a PDF inline from one. */
                <iframe
                  src={previewUrl}
                  title={file.name}
                  className="h-full w-full rounded-lg border"
                  style={{ borderColor: 'var(--v2-border)', minHeight: '420px' }}
                />
              ) : isImage ? (
                <img
                  src={previewUrl}
                  alt={file.name}
                  className="mx-auto max-h-full rounded-lg object-contain"
                />
              ) : (
                /* Word documents and the rest. No browser renders these inline,
                   and a blank frame reads as a broken upload rather than an
                   unpreviewable format — so it says which it is. */
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <FileText className="h-10 w-10 text-[var(--v2-text-muted)]" />
                  <p className="text-sm text-[var(--v2-text-secondary)]">
                    {t('proposal.preview_unavailable')}
                  </p>
                  <a
                    href={previewUrl}
                    download={file.name}
                    className="text-sm font-medium text-[var(--v2-primary)] hover:underline"
                  >
                    {t('proposal.download_to_check')}
                  </a>
                </div>
              )}
            </div>
          </div>
        )}
        </div>

        {/*
          Footer to the service editor's pattern: raised bar, outlined neutral
          cancel, outlined-and-tinted primary. Not a filled button — the same
          reasoning the configuration dialog records, that a filled action in
          one dialog reads as a different product from an outlined one in its
          neighbour.
        */}
        <div className="flex-shrink-0 flex justify-end gap-3 p-4 sm:p-6 border-t border-[var(--v2-border)] bg-[var(--v2-surface)]">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-5 py-2.5 text-sm font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] bg-[var(--v2-bg)] border border-[var(--v2-border)] hover:bg-[var(--v2-surface-hover)] transition-all disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            {t('proposal.cancel')}
          </button>
          {/*
            Read-only offers the way OUT of read-only, not a second Send.
            Revising is the only thing an owner can do to a quote already with a
            client, and it reopens this dialog on this version with
            `supersedesId` set — which is what the version strip has always done.
          */}
          {readOnly && onRevise && canRevise && (
            <button
              type="button"
              onClick={onRevise}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium border transition-all"
              style={{
                borderRadius: 'var(--v2-radius-button)',
                color: 'var(--v2-primary)',
                borderColor: 'var(--v2-primary)',
                background: 'color-mix(in srgb, var(--v2-primary) 10%, transparent)',
              }}
            >
              <FileText className="w-4 h-4" />
              {t('proposal.revise')}
            </button>
          )}
          {!readOnly && (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              borderRadius: 'var(--v2-radius-button)',
              color: 'var(--v2-primary)',
              borderColor: 'var(--v2-primary)',
              background: 'color-mix(in srgb, var(--v2-primary) 10%, transparent)',
            }}
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <Send className="w-4 h-4" />
                {t('proposal.send')}
              </>
            )}
          </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

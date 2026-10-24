'use client';

/**
 * Pick an hour, knowing what it costs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * `SchedulingBookingModal` picked a time with a bare `datetime-local` field
 * beside a banner reading "שעות פנויות: 09:00–17:00". The banner came from
 * `availability` — the weekly opening-hours TEMPLATE — so the dialog could not
 * see existing meetings, closed days or the owner's calendar. The owner typed
 * an hour and learned it clashed when the save failed.
 *
 * A client booking on the public site has had real slots all along. This gives
 * the owner the same answer, plus the part the client has no reason to see:
 * what each free hour would do to the day around it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT DECIDES NOTHING
 *
 * Every rule lives in `/api/scheduling/free-slots`, which composes
 * `computeOpenTime`, `slotsInWindows`, `busyMeetings` and `slotIntelligence`.
 * This renders the answer and reports the chosen instant upward. A second
 * opinion here about which hours exist is how the owner's dialog and the
 * client's page drifted apart in the first place.
 *
 * `datetime-local` survives behind "שעה אחרת…" — an owner booking deliberately
 * outside their hours is a real thing, and a grid that makes it impossible is
 * worse than the field it replaced.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, Loader2, ChevronRight } from 'lucide-react';

import { useLanguage } from '@/lib/business-os/LanguageContext';
import { bookingWarnings, type Consequence } from '@/lib/scheduling/slotIntelligence';

export interface FreeSlot {
  start: string;
  end: string;
  available: boolean;
  consequence: Consequence;
}

export interface FreeDay {
  date: string;
  weekday: string;
  isWorkingDay: boolean;
  freeSlots: number;
  freeMinutes: number;
  bookedMinutes: number;
  isEmpty: boolean;
  /**
   * Already taken, clipped to the day's working hours.
   *
   * `HH:MM` on the BUSINESS's clock, NOT instants: these come from
   * `computeOpenTime`, which merges and clips in wall-clock minutes, while the
   * slots in the same response are instants. Both are `string`, so reading one
   * as the other typechecked and threw out of `Intl` at runtime.
   */
  busy: Array<{ start: string; end: string }>;
  /** `HH:MM`, for the timeline's axis. */
  opensAt: string | null;
  closesAt: string | null;
}

interface SuggestionDTO {
  start: string;
  end: string;
  reason:
    | 'soonest'
    | 'closes_window'
    | 'client_usual_hour'
    | 'client_usual_hour_nearest'
    | 'next_day';
  /** How many past meetings the habit was read from. */
  meetingCount?: number;
  /** This hour falls on a day with nothing else in it. A caveat, not a reason. */
  opensDay?: boolean;
  consequence: Consequence;
}

interface FreeSlotsResponse {
  success: boolean;
  timezone: string;
  availabilityConfigured: boolean;
  durationMinutes: number;
  selectedDate: string | null;
  days: FreeDay[];
  slots: FreeSlot[];
  suggestions: SuggestionDTO[];
  nextFree: string | null;
}

interface BookingTimeStepProps {
  serviceId: string;
  /** Only to offer "the hour they usually choose". Absent for a new client. */
  contactId?: string | null;
  /** The chosen instant, or null while nothing is chosen. */
  value: string | null;
  onChange: (startIso: string | null) => void;
  /** True when this service asks the client to return a form first. */
  requiresIntake?: boolean;
  /** Whose booking this is, for the row about the hour they usually choose. */
  clientName?: string;
  /**
   * The booking being EDITED.
   *
   * Two things depend on it, and both are what makes rescheduling work at all:
   * its own meeting stops counting as busy — otherwise its current hour reads
   * as taken, by itself — and the week opens on its own day rather than on
   * today, which for an appointment next month would not contain it.
   */
  editingBookingId?: string | null;
  /**
   * How long this appointment runs, when the service cannot say.
   *
   * A package service keeps no `duration_minutes` — it is bought, not booked
   * into an hour — so its sessions' length comes from the quote that sold
   * them. Without it the strip asks for slots of zero minutes and the grid
   * reports a week with no free hours in it.
   */
  durationMinutes?: number | null;
}

/**
 * A business-clock date key, moved by whole days.
 *
 * Built from the key's own numbers at MIDDAY UTC, so adding a day cannot land
 * on a daylight-saving seam and come back as the same date or skip one.
 */
function shiftDays(dateKey: string, days: number): string {
  const at = new Date(`${dateKey}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Which part of the day an hour belongs to, on the business's clock. */
function bandFor(hour: number): 'morning' | 'afternoon' | 'evening' {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

const TONE = {
  accent: '#14B8A6',
  accentDim: '#0E7E73',
  good: '#22C58B',
  warn: '#B54708',
  danger: '#F04438',
};

export function BookingTimeStep({
  serviceId,
  contactId,
  value,
  onChange,
  requiresIntake = false,
  clientName,
  editingBookingId,
  durationMinutes,
}: BookingTimeStepProps) {
  const { t, language } = useLanguage();
  const locale = language === 'he' ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-GB';

  const [data, setData] = useState<FreeSlotsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [day, setDay] = useState<string | null>(null);

  /*
   * One request per service, week and client.
   *
   * `day` is deliberately NOT a dependency: the response carries every day in
   * the window, so moving between them is a render, not a fetch. Refetching on
   * each click would make the strip feel like a page load and would re-rank the
   * suggestions under the owner's cursor.
   */
  useEffect(() => {
    if (!serviceId) return;

    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({ service_id: serviceId, days: '7' });
    if (durationMinutes) params.set('duration_minutes', String(durationMinutes));
    if (from) params.set('from', from);
    if (contactId) params.set('contact_id', contactId);
    if (editingBookingId) params.set('exclude_booking_id', editingBookingId);
    /*
     * THE HOUR ALREADY CHOSEN, SO THE WINDOW OPENS ON IT.
     *
     * ───────────────────────────────────────────────────────────────────────
     * This asked for `editingBookingId` as well, so it only applied to a
     * booking being edited. But this panel is unmounted when its step
     * collapses and mounted again when the owner presses "change" — and on
     * that second mount it knows the chosen hour and nothing else.
     *
     * Without this the server picked the window's first day with room, so an
     * owner who chose Tuesday 13:15, collapsed the step and reopened it was
     * shown MONDAY, with their own hour nowhere on screen and no block lit on
     * the timeline.
     *
     * Only on the FIRST load — `from` is set once they page the strip, and
     * sending both would drag them back on every click. Which day the instant
     * falls on is the route's to decide: it holds the business's zone, and a
     * day computed here is off by one near midnight for an owner sitting
     * somewhere else.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (!from && value) params.set('around', value);

    fetch(`/api/scheduling/free-slots?${params.toString()}`)
      .then(r => r.json())
      .then((body: FreeSlotsResponse) => {
        if (cancelled) return;
        setData(body?.success ? body : null);
        setDay(prev => prev ?? body?.selectedDate ?? null);
      })
      .catch(() => {
        /* The owner still has "another time". A failed read must not trap them. */
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    /*
     * `value` is deliberately NOT a dependency: it changes on every pick, and
     * refetching then would re-rank the suggestions under the owner's cursor.
     * It is read here only to open the right week, which is a first-load fact.
     */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    /* `durationMinutes` too: a package session's length decides which slots
       exist at all, so changing it changes the answer. */
  }, [serviceId, contactId, from, editingBookingId, durationMinutes]);

  const timeZone = data?.timezone ?? 'UTC';

  /** Today, on the business's clock — the floor for paging back. */
  const todayKey = useMemo(
    () =>
      new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone,
      }).format(new Date()),
    [timeZone]
  );

  const isToday = useCallback((dateKey: string) => dateKey === todayKey, [todayKey]);

  /** An instant as the business's own calendar date, `YYYY-MM-DD`. */
  const businessDay = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone,
      }).format(new Date(iso)),
    [timeZone]
  );

  const hourIn = useCallback(
    (iso: string) =>
      Number(
        new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(
          new Date(iso)
        )
      ),
    [timeZone]
  );

  /**
   * An instant as minutes past midnight on the BUSINESS's clock.
   *
   * The timeline is laid out in those minutes because a day's opening hours
   * are — `09:00` is a wall clock, not an instant — and the slots are instants.
   * One of the two has to move, and moving the instants is the direction that
   * works in any zone.
   */
  const hourMinuteIn = useCallback(
    (iso: string) => {
      const [h, m] = new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
      })
        .format(new Date(iso))
        .split(':')
        .map(Number);

      return h * 60 + m;
    },
    [timeZone]
  );

  const clock = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(locale, {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone,
      }).format(new Date(iso)),
    [locale, timeZone]
  );

  /*
   * The grid for the day on screen.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * Two things were wrong here, and together they made the strip look broken.
   *
   * The response used to carry only the SELECTED day's hours, so this returned
   * them wholesale for that day and filtered for any other — and the filter
   * then found nothing, because there was nothing else in the payload. Clicking
   * any other day showed "no free hours this week" beside a strip saying that
   * day had eight.
   *
   * The filter itself matched `s.start.startsWith(day)`, a UTC prefix against a
   * business-clock date. For a business WEST of Greenwich those part company
   * every evening: 19:00 in New York is 00:00 UTC the next day, so the whole
   * evening would have been filtered off Tuesday's grid and onto Wednesday's.
   *
   * The response now carries every day in the window, so this always filters,
   * and it filters on the business's own calendar.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const daySlots = useMemo(() => {
    if (!data) return [];

    const wanted = day ?? data.selectedDate;
    if (!wanted) return [];

    return data.slots.filter(s => businessDay(s.start) === wanted);
  }, [data, day, businessDay]);

  /*
   * The window on screen, and where paging moves it to.
   *
   * Read from the response rather than from `from`, which is undefined until
   * the owner pages for the first time — the server decides where an unasked
   * window begins, and it is the one that knows the business's clock.
   */
  const windowDays = data?.days ?? [];
  const windowStart = windowDays[0]?.date ?? todayKey;
  const windowEnd = windowDays[windowDays.length - 1]?.date ?? windowStart;
  const canGoBack = windowStart > todayKey;

  const weekLabel = useMemo(() => {
    if (!data?.days.length) return '';

    const fmt = (key: string) =>
      new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(
        new Date(`${key}T12:00:00Z`)
      );

    return `${fmt(windowStart)} – ${fmt(windowEnd)}`;
  }, [data, locale, timeZone, windowStart, windowEnd]);

  const bands = useMemo(() => {
    const out: Record<'morning' | 'afternoon' | 'evening', FreeSlot[]> = {
      morning: [],
      afternoon: [],
      evening: [],
    };

    for (const slot of daySlots) out[bandFor(hourIn(slot.start))].push(slot);

    return out;
  }, [daySlots, hourIn]);

  /*
   * WARNED BEFORE PICKING, NOT AFTER.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * These were computed from the CHOSEN hour, so they appeared only once the
   * decision had been made — and since choosing also answers the step, they
   * were rendered and collapsed in the same gesture. The owner was told about
   * the reminder they would not get as the panel closed over it.
   *
   * Both are really about how far ahead the DAY is: every hour on today is
   * inside the 24-hour window, so the warning is true of all of them before a
   * single one is picked. Read from the earliest hour still on offer, which is
   * the worst case on that day and so the honest one to warn about, and from
   * the chosen hour once there is one.
   *
   * That makes a confirm button unnecessary: there is nothing left that only
   * appears after the click.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const warnings = useMemo(() => {
    const at = value ?? daySlots.find(slot => slot.available)?.start;

    return at ? bookingWarnings({ start: at, now: new Date(), requiresIntake }) : [];
  }, [value, daySlots, requiresIntake]);

  const costLabel = (slot: FreeSlot): string => {
    if (!slot.available) return t('scheduling.slots.cost.taken');
    if (value === slot.start) return t('scheduling.slots.cost.selected');

    switch (slot.consequence?.kind) {
      case 'closes_window':
        return t('scheduling.slots.cost.closes_window');
      case 'closes_day':
        return t('scheduling.slots.cost.closes_day');
      case 'strands':
        return (t('scheduling.slots.cost.strands') || '').replace(
          '{minutes}',
          String(slot.consequence.minutes)
        );
      default:
        return '';
    }
  };

  /*
   * What the strip says under each date.
   *
   * `isEmpty` used to WIN over the count, so a day with nothing booked read
   * "free day" and gave no number at all — while the day beside it said "8
   * free". The owner could not compare the two, which is the only thing a
   * strip of days is for. "Nothing booked yet" is a quality of the day, not a
   * substitute for how much of it is left, so the count always shows.
   */
  const dayLabel = (d: FreeDay): string => {
    if (!d.isWorkingDay) return t('scheduling.slots.day.closed');
    if (d.freeSlots === 0) return t('scheduling.slots.day.full');
    return (t('scheduling.slots.day.free') || '').replace('{count}', String(d.freeSlots));
  };

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-[var(--v2-text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('scheduling.slots.loading')}
      </div>
    );
  }

  if (!data || !data.availabilityConfigured) {
    /*
     * No working hours, or the read failed.
     *
     * This used to offer "another time" and a pair of typed fields. Said
     * plainly instead: with no hours configured there is nothing to pick from,
     * and a booking typed into the gap is one the client could never have
     * made — the public page would have refused it.
     */
    return (
      <div className="py-3 text-sm text-[var(--v2-text-muted)]">
        {t('scheduling.slots.no_hours_configured')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* The two or three hours worth putting in front of the owner, each
          saying WHY — ranked by what they save, not by when they are. */}
      {data.suggestions.length > 0 && (
        <div className="flex flex-col gap-[7px]">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--v2-text-muted)]">
            <Sparkles className="h-3.5 w-3.5" />
            {t('scheduling.slots.suggestions')}
          </div>

          {data.suggestions.map((s, index) => {
            /*
             * THE RECOMMENDATION STEPS BACK ONCE A CHOICE IS MADE.
             *
             * The mockup washes the first row in the accent, which is how it
             * reads as the recommendation — and the mockup never draws a
             * CHOSEN row, so its wash never has to sit beside one. Copied
             * literally, two rows ended up wearing nearly the same colour and
             * the panel showed two selections at once.
             *
             * While nothing is picked, the lead is highlighted. The moment
             * something is, only that row is.
             */
            const lead = index === 0 && !value;
            /*
             * A CLICKED SUGGESTION HAS TO LOOK CLICKED.
             *
             * The only sign of it was a highlighted hour down in the grid, and
             * the grid is usually below the fold — so pressing a suggestion
             * looked like pressing a dead button, and the owner pressed it
             * again. It IS the selection, so it carries the same mark the
             * chosen slot does.
             */
            const chosen = value === s.start;

            /*
             * The short category beside the long sentence, as the mockup has
             * it: "no waste", "their usual hour", "opens a day". Not a repeat
             * of the sentence — the sentence is specific ("closes the window
             * between 09:00 and 11:00"), this is the KIND of thing it is,
             * scannable down a column of three.
             *
             * Only the empty-day row is a warning. The other two are finds.
             */
            /*
             * EVERY ROW CARRIES A MARK, AND EVERY MARK IS TRUE.
             *
             * ─────────────────────────────────────────────────────────────
             * The mockup puts a short category beside each sentence, and it
             * is what makes a column of three scannable. Two earlier versions
             * of this were both wrong: first "ללא בזבוז" fell out as the
             * DEFAULT, so the soonest hour and the next day's first hour both
             * claimed to waste nothing when neither had been checked; then the
             * fix dropped the badge entirely on those rows and the column lost
             * its spine.
             *
             * It reads in order of what matters: a cost the owner should see
             * first, then a genuine find, then what kind of row it is.
             * ─────────────────────────────────────────────────────────────
             */
            const mark =
              s.opensDay
                ? { text: t('scheduling.slots.mark.opens_day'), tone: 'warn' as const }
                : s.consequence?.kind === 'strands'
                  ? {
                      text: (t('scheduling.slots.cost.strands') || '').replace(
                        '{minutes}',
                        String(s.consequence.minutes)
                      ),
                      tone: 'warn' as const,
                    }
                  : s.consequence?.kind === 'closes_window'
                    ? { text: t('scheduling.slots.mark.no_waste'), tone: 'good' as const }
                    : s.reason === 'client_usual_hour' ||
                        s.reason === 'client_usual_hour_nearest'
                      ? { text: t('scheduling.slots.mark.habit'), tone: 'good' as const }
                      : s.reason === 'next_day'
                        ? { text: t('scheduling.slots.mark.next_day'), tone: 'good' as const }
                        : { text: t('scheduling.slots.mark.soonest'), tone: 'good' as const };

            /*
             * The sentence, with the facts it is about written into it. A row
             * reading "closes the window" is an assertion; "closes the window
             * between 09:00 and 11:00" is the reason itself.
             */
            const why = (t(`scheduling.slots.reason.${s.reason}`) || '')
              .replace(
                '{gap}',
                s.consequence?.kind === 'closes_window'
                  ? `${clock(s.consequence.gapStart)}–${clock(s.consequence.gapEnd)}`
                  : ''
              )
              .replace('{client}', clientName || t('scheduling.slots.the_client'))
              .replace('{count}', String(s.meetingCount ?? 0));

            return (
              <button
                key={s.start}
                type="button"
                onClick={() => {
                  onChange(s.start);
                  /*
                   * The day on the BUSINESS's clock, not the first ten
                   * characters of a UTC instant.
                   *
                   * `.slice(0, 10)` read the UTC date, which parts company
                   * with the business's every evening for a business west of
                   * Greenwich: 19:00 in New York is already tomorrow in UTC.
                   * The strip's days
                   * are business dates, so a key that did not match any of
                   * them selected no day at all and emptied the grid — the
                   * suggestion appeared unclickable.
                   */
                  setDay(businessDay(s.start));
                }}
                aria-pressed={chosen}
                className="flex w-full items-center gap-3 border px-[13px] py-2.5 text-start transition-colors"
                /*
                 * ONE THING ON THIS PANEL IS FILLED IN THE ACCENT, AND IT IS
                 * THE HOUR THAT HAS BEEN CHOSEN.
                 *
                 * The first suggestion used to carry a teal border and a teal
                 * wash because it is the recommendation — which is exactly how
                 * a selected row looks, so the owner read the top one as
                 * already chosen and asked why it stayed selected. Two things
                 * wearing one colour is two things saying the same word.
                 *
                 * The recommendation now says so in TYPE, not in fill: its
                 * hour is set in the accent and the row stays plain. Only the
                 * chosen one is filled and double-bordered.
                 */
                style={{
                  borderRadius: '9px',
                  borderColor: chosen || lead ? TONE.accentDim : 'var(--v2-border)',
                  borderWidth: chosen ? 2 : 1,
                  /* The mockup washes the LEAD row, which is how it reads as
                     the recommendation. The chosen row goes a shade deeper, so
                     "recommended" and "picked" stay distinguishable. */
                  background: chosen
                    ? 'rgba(20,184,166,0.22)'
                    : lead
                      ? 'rgba(20,184,166,0.10)'
                      : 'var(--v2-surface)',
                }}
              >
                <span
                  className="whitespace-nowrap text-[14px] font-semibold tabular-nums"
                  style={{ color: chosen || lead ? TONE.accent : 'var(--v2-text-primary)' }}
                >
                  {new Intl.DateTimeFormat(locale, {
                    weekday: 'short',
                    day: 'numeric',
                    timeZone,
                  }).format(new Date(s.start))}{' '}
                  · {clock(s.start)}
                </span>

                <span className="min-w-0 text-[13px] text-[var(--v2-text-secondary)]">
                  {why}
                  {/* The caveat, after the reason rather than instead of it:
                      the hour earned its place some other way, and this is
                      what it will cost. */}
                  {s.opensDay && <> · {t('scheduling.slots.opens_day_caveat')}</>}
                </span>

                {/*
                  THE BADGE ONLY SPEAKS WHEN IT HAS SOMETHING OF ITS OWN.

                  It used to print a mark beside every row, so "but it opens a
                  new day" was followed by "opens a day" — one fact, said
                  twice, in a row three words wide. It now carries what the
                  HOUR does to the day, which the sentence never says, and
                  nothing at all when that is nothing.
                */}
                {mark && (
                  <span
                    className="ms-auto whitespace-nowrap rounded-full px-2 py-[3px] text-[11px]"
                    style={
                      mark.tone === 'warn'
                        ? { background: 'rgba(181,71,8,0.14)', color: TONE.warn }
                        : { background: 'rgba(34,197,139,0.14)', color: TONE.good }
                    }
                  >
                    {mark.text}
                  </span>
                )}

              </button>
            );
          })}
        </div>
      )}

      {/*
        THE WEEK, AND A WAY OUT OF IT.

        The strip showed seven days and had no control to move: `setFrom` had
        one caller, the "next free" link, which only appeared when the day on
        screen had nothing at all. So an owner whose week had any availability
        could not reach the week after it — and if the week was genuinely full,
        the link was absent too and there was no way forward at all.

        Paging IS a refetch, unlike moving between days inside the window: a
        different week is different data, and the response only ever carries
        the seven days it was asked for.

        Back stops at this week. There is nothing to book in the past, and the
        hours there are filtered out of the response anyway, so a page back
        would land on a strip of dead days.
      */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setFrom(shiftDays(windowStart, -7))}
          disabled={!canGoBack}
          aria-label={t('scheduling.slots.week_previous')}
          title={t('scheduling.slots.week_previous')}
          className="shrink-0 border px-2 py-1.5 text-[var(--v2-text-secondary)] disabled:opacity-30"
          style={{ borderRadius: 'var(--v2-radius-button)', borderColor: 'var(--v2-border)' }}
        >
          <ChevronRight className="h-4 w-4 rtl:hidden" style={{ transform: 'scaleX(-1)' }} />
          <ChevronRight className="hidden h-4 w-4 rtl:block" />
        </button>

        <div className="min-w-0 flex-1 text-center text-[11.5px] text-[var(--v2-text-muted)]">
          {weekLabel}
        </div>

        <button
          type="button"
          onClick={() => setFrom(shiftDays(windowStart, 7))}
          aria-label={t('scheduling.slots.week_next')}
          title={t('scheduling.slots.week_next')}
          className="shrink-0 border px-2 py-1.5 text-[var(--v2-text-secondary)]"
          style={{ borderRadius: 'var(--v2-radius-button)', borderColor: 'var(--v2-border)' }}
        >
          <ChevronRight className="h-4 w-4 rtl:hidden" />
          <ChevronRight className="hidden h-4 w-4 rtl:block" style={{ transform: 'scaleX(-1)' }} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5">
        {data.days.map(d => {
          const selected = d.date === day;
          const dead = !d.isWorkingDay || d.freeSlots === 0;
          const total = d.freeMinutes + d.bookedMinutes;

          return (
            <button
              key={d.date}
              type="button"
              disabled={dead}
              onClick={() => setDay(d.date)}
              className="border px-[5px] pb-[7px] pt-2 text-center transition-colors disabled:cursor-default"
              style={{
                borderRadius: 'var(--v2-radius-button)',
                borderColor: selected ? TONE.accent : 'var(--v2-border)',
                background: selected ? 'rgba(20,184,166,0.12)' : 'var(--v2-surface)',
                opacity: dead ? 0.4 : 1,
              }}
            >
              <div className="text-[11px] text-[var(--v2-text-muted)]">
                {new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone }).format(
                  new Date(`${d.date}T12:00:00Z`)
                )}
              </div>
              <div className="text-base font-semibold tabular-nums text-[var(--v2-text-primary)]">
                {Number(d.date.slice(8, 10))}
              </div>

              {/*
                NOTHING BOOKED YET, SAID ONCE.

                This fact used to be stamped on every hour in the day as
                "opens a day", which drowned out what each hour actually did
                to the day's shape. It belongs here, where it is about the day,
                and it carries the explanation in its tooltip rather than
                expecting "opens a day" to mean something on its own.
              */}
              {d.isWorkingDay && d.isEmpty && !isToday(d.date) && (
                <div
                  className="mt-0.5 truncate text-[9.5px]"
                  style={{ color: TONE.warn }}
                  title={t('scheduling.slots.day.untouched_hint')}
                >
                  {t('scheduling.slots.day.untouched')}
                </div>
              )}

              {/*
                THE DAY'S SHAPE, IN SIX SEGMENTS.

                Not a proportional two-tone bar: at this size a 20% sliver is
                unreadable, and the eye compares seven days by counting lit
                blocks far more easily than by judging seven bar widths. Six
                is what the mockup draws, and it divides an eight-hour day
                closely enough to be honest about which part is spoken for.
              */}
              <div className="mt-1.5 flex h-1 gap-px">
                {Array.from({ length: 6 }, (_, i) => {
                  /* Lit when that sixth of the day still has room in it. */
                  const spoken = total > 0 && (i + 0.5) / 6 < d.bookedMinutes / total;

                  return (
                    <span
                      key={i}
                      className="flex-1 rounded-sm"
                      style={
                        !d.isWorkingDay
                          ? { background: 'var(--v2-border)' }
                          : spoken
                            ? { background: 'var(--v2-text-muted)' }
                            : { background: TONE.accent, opacity: 0.55 }
                      }
                    />
                  );
                })}
              </div>

              <div
                className="mt-1 text-[10.5px] tabular-nums"
                style={{ color: dead ? 'var(--v2-text-muted)' : TONE.accent }}
              >
                {dayLabel(d)}
              </div>
            </button>
          );
        })}
      </div>

      {/*
        THE DAY AS A TIMELINE — ONE BLOCK PER HOUR, AS THE MOCKUP DRAWS IT.

        ───────────────────────────────────────────────────────────────────────
        Where the hour sits among what is already booked. A slot on its own is
        a number; beside the day's shape it is a decision — the gap being
        filled, or the one about to be split in two.

        Segmented, not a continuous bar measured in percentages. Each block is
        one bookable hour, so the strip lines up one-to-one with the grid
        underneath it and there is no positioning arithmetic to get wrong — the
        previous version mixed wall-clock strings with instants and threw
        `RangeError` out of `Intl` the moment a day had anything booked in it.

        Direction is left to the page: the blocks are in time order and a flex
        row reverses itself in Hebrew, so the day reads right to left there and
        left to right in English with no branch on the language.
        ───────────────────────────────────────────────────────────────────────
      */}
      {(() => {
        const chosenDay = data.days.find(d => d.date === (day ?? data.selectedDate));
        if (!chosenDay?.isWorkingDay || !chosenDay.opensAt || !chosenDay.closesAt) return null;

        const toMinutes = (hhmm: string) => {
          const [h, m] = hhmm.split(':').map(Number);
          return h * 60 + m;
        };

        const opens = toMinutes(chosenDay.opensAt);
        const closes = toMinutes(chosenDay.closesAt);
        const step = data.durationMinutes || 60;
        if (closes - opens < step) return null;

        /* The chosen day's hours, by their minute on the business's clock. */
        const slotAtMinute = new Map<number, FreeSlot>();

        for (const slot of daySlots) {
          slotAtMinute.set(hourMinuteIn(slot.start), slot);
        }

        const blocks: Array<{ key: string; tone: 'booked' | 'pick' | 'open' | 'gone' }> = [];

        for (let at = opens; at + step <= closes; at += step) {
          const busy = chosenDay.busy.some(
            b => at < toMinutes(b.end) && at + step > toMinutes(b.start)
          );

          const slot = slotAtMinute.get(at);

          blocks.push({
            key: String(at),
            tone: busy
              ? 'booked'
              : !slot
                ? /* Inside working hours with no slot: the hour has passed, or
                     the gap between appointments reaches into it. */
                  'gone'
                : value === slot.start
                  ? 'pick'
                  : 'open',
          });
        }

        /*
         * FOUR STATES, AND NO TWO OF THEM ARE THE SAME COLOUR TWICE OVER.
         *
         * ─────────────────────────────────────────────────────────────────
         * This drew five, three of which were the same teal at 28%, 62% and
         * 100% — opacity is not a readable difference at 26 pixels tall, and
         * "closes a gap" did not earn a third shade when the grid underneath
         * already says so in words.
         *
         * What is left is four facts a glance can separate: free, chosen,
         * taken, and neither. Free carries the accent because it is what the
         * owner is looking for; chosen is the same accent gone solid with a
         * ring, so it reads as the one picked rather than as more free time;
         * taken is solid grey, because it is a meeting and it earned money;
         * and the hours that are neither — already past, or inside the gap
         * kept between appointments — are the palest thing on the bar.
         * ─────────────────────────────────────────────────────────────────
         */
        const fill = (tone: (typeof blocks)[number]['tone']) =>
          tone === 'pick'
            ? { background: TONE.accent, boxShadow: `0 0 0 2px ${TONE.accentDim} inset` }
            : tone === 'open'
              ? { background: 'rgba(20,184,166,0.30)' }
              : tone === 'booked'
                ? { background: 'var(--v2-text-muted)' }
                : /* gone */ { background: 'var(--v2-border)', opacity: 0.4 };

        const midday = `${String(Math.floor((opens + closes) / 2 / 60)).padStart(2, '0')}:00`;

        return (
          <div
            className="border px-[13px] py-3"
            style={{ borderRadius: '9px', borderColor: 'var(--v2-border)' }}
          >
            <div className="mb-2.5 flex justify-between text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--v2-text-muted)]">
              <span>{t('scheduling.slots.selected_day')}</span>
              <span className="tabular-nums normal-case tracking-normal" dir="ltr">
                {chosenDay.opensAt}–{chosenDay.closesAt}
              </span>
            </div>

            <div className="flex h-[26px] gap-[2px]">
              {blocks.map(b => (
                <span
                  key={b.key}
                  className="flex-1 rounded-[3px]"
                  style={fill(b.tone)}
                  title={t(`scheduling.slots.legend.${b.tone}`)}
                />
              ))}
            </div>

            <div className="mt-1.5 flex justify-between text-[10.5px] tabular-nums text-[var(--v2-text-muted)]">
              <span dir="ltr">{chosenDay.opensAt}</span>
              <span dir="ltr">{midday}</span>
              <span dir="ltr">{chosenDay.closesAt}</span>
            </div>

            {/* What the colours mean, under the bar they belong to rather
                than at the far end of the panel. */}
            <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-[var(--v2-text-muted)]">
              {(['open', 'pick', 'booked', 'gone'] as const).map(tone => (
                <span key={tone} className="inline-flex items-center gap-1.5">
                  <i className="h-2 w-2 shrink-0 rounded-[2px]" style={fill(tone)} />
                  {t(`scheduling.slots.legend.${tone}`)}
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/*
        WHAT "OPENS A DAY" ACTUALLY MEANS, IN A SENTENCE.

        The phrase was a three-word badge on every hour — "opens a day" — which
        assumes the reader already knows the idea it is pointing at. Said once,
        about the day on screen, with the cost spelled out: this day has nothing
        in it, so booking here turns a free day into a working one.

        Not shown for today, where it is close to meaningless: today is already
        underway, and the owner is at their desk looking at this dialog.
      */}
      {(() => {
        const shown = data.days.find(d => d.date === (day ?? data.selectedDate));
        if (!shown?.isWorkingDay || !shown.isEmpty || isToday(shown.date)) return null;

        return (
          <div
            className="flex items-start gap-[9px] border px-[11px] py-[9px] text-[12.5px]"
            style={{
              borderRadius: '8px',
              borderColor: 'rgba(181,71,8,0.3)',
              background: 'rgba(181,71,8,0.07)',
              color: 'var(--v2-text-secondary)',
            }}
          >
            {/* The same mark the other notices carry, so the three read as
                one family rather than three one-off boxes. */}
            <span
              className="shrink-0 text-[11px] font-bold leading-[1.45]"
              style={{ color: TONE.warn }}
              aria-hidden="true"
            >
              !
            </span>
            <span>{t('scheduling.slots.day.untouched_hint')}</span>
          </div>
        );
      })()}

      {/*
        WHAT THIS DAY WILL COST, BEFORE AN HOUR IS PICKED.

        Above the grid, not below it: both of these are true of the hours on
        offer, not only of one already chosen, and an owner reads them to
        decide — not to be told afterwards.
        Both are real machinery: the reminder cron stamps `reminder_24hr_sent`,
        and a meeting booked inside that window passes the point before the row
        exists, so the client gets the two-hour reminder and nothing else.
      */}
      {warnings.length > 0 && (
        <div className="flex flex-col gap-[7px]">
          {warnings.map(w => (
            <div
              key={w.kind}
              className="flex items-start gap-[9px] border px-[11px] py-[9px] text-[12.5px]"
              style={{
                borderRadius: '8px',
                borderColor: 'rgba(181,71,8,0.3)',
                background: 'rgba(181,71,8,0.07)',
                color: 'var(--v2-text-secondary)',
              }}
            >
              {/* A typographic mark rather than a drawn icon, as the mockup
                  has it: at 12.5px a glyph sits on the text's own baseline
                  and needs no nudging to line up with the first word. */}
              <span
                className="shrink-0 text-[11px] font-bold leading-[1.45]"
                style={{ color: TONE.warn }}
                aria-hidden="true"
              >
                !
              </span>
              <span>
                {/*
                  "0 hours to fill it in" is what the ordinary sentence says
                  for a meeting in forty minutes, and it reads as a bug rather
                  than as urgency. Under an hour has its own wording, with no
                  number in it at all.
                */}
                {(t(
                  w.kind === 'intake_lead_time' && w.hoursAhead < 1
                    ? 'scheduling.slots.warn.intake_lead_time_soon'
                    : `scheduling.slots.warn.${w.kind}`
                ) || '').replace('{hours}', String(w.hoursAhead))}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* The grid, grouped by part of day. Each hour says what it costs. */}
      {daySlots.length === 0 ? (
        <div className="py-4 text-sm text-[var(--v2-text-muted)]">
          {t('scheduling.slots.none_this_week')}
          {data.nextFree && (
            <button
              type="button"
              onClick={() => setFrom(data.nextFree ?? undefined)}
              className="ms-2 font-semibold"
              style={{ color: TONE.accent }}
            >
              {(t('scheduling.slots.next_free') || '').replace(
                '{date}',
                new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(
                  new Date(`${data.nextFree}T12:00:00Z`)
                )
              )}
            </button>
          )}
        </div>
      ) : (
        (['morning', 'afternoon', 'evening'] as const).map(band =>
          bands[band].length === 0 ? null : (
            <div key={band}>
              <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--v2-text-muted)]">
                {t(`scheduling.slots.band.${band}`)}
                <span className="h-px flex-1 bg-[var(--v2-border)]" />
              </div>

              <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1.5">
                {bands[band].map(slot => {
                  const chosen = value === slot.start;
                  const closes =
                    slot.consequence?.kind === 'closes_window' ||
                    slot.consequence?.kind === 'closes_day';
                  const strands = slot.consequence?.kind === 'strands';

                  return (
                    <button
                      key={slot.start}
                      type="button"
                      disabled={!slot.available}
                      onClick={() => onChange(slot.start)}
                      className="border px-1 pb-1.5 pt-[7px] text-center transition-colors disabled:cursor-default"
                      style={{
                        borderRadius: '7px',
                        borderColor: chosen
                          ? TONE.accent
                          : closes
                            ? TONE.accentDim
                            : 'var(--v2-border)',
                        background: chosen ? TONE.accent : 'var(--v2-surface)',
                        opacity: slot.available ? 1 : 0.3,
                      }}
                    >
                      <span
                        className="block text-[13.5px] tabular-nums"
                        style={{
                          color: chosen ? '#04201D' : 'var(--v2-text-primary)',
                          fontWeight: chosen ? 700 : 500,
                          textDecoration: slot.available ? 'none' : 'line-through',
                        }}
                      >
                        {clock(slot.start)}
                      </span>

                      <span
                        className="mt-0.5 block text-[10px]"
                        style={{
                          color: chosen
                            ? 'rgba(4,32,29,0.72)'
                            : closes
                              ? TONE.accent
                              : strands
                                ? TONE.warn
                                : 'var(--v2-text-muted)',
                        }}
                      >
                        {costLabel(slot) || ' '}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )
        )
      )}

      {/*
        The legend moved UP, under the timeline whose colours it explains.
        Here it sat below the grid, a screen away from the bar it described,
        and it named three states where the bar draws five.
      */}

    </div>
  );
}

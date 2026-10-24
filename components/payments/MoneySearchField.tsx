'use client';

/**
 * The orders search: one box, two ways to add a filter, one string underneath.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TEXT IS THE ONLY STATE.
 *
 * There is no array of chips. `value` is the string the user typed, chips are
 * what `parseMoneySearch` makes of it, and everything that adds or removes one
 * edits that string. That is the whole design, and it buys three things a
 * parallel chip list does not:
 *
 *   · the chips cannot disagree with the filter, because the route parses the
 *     same string with the same function;
 *   · the search survives a reload, a URL and a CSV export as plain text;
 *   · select-all, paste and undo keep working, because this really is one
 *     `<input>` and not a div pretending to be one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO WAYS IN, BECAUSE THEY ANSWER DIFFERENT QUESTIONS.
 *
 *   ⊕ PANEL      "what can I filter by?" — browsing, for someone who does not
 *                yet know the box understands periods at all.
 *
 *   SUGGESTIONS  "what does what I just typed mean?" — resolving, and the only
 *                thing that can settle the ambiguity a bare number carries.
 *                `500` is an invoice number far more often than ₪500, so the
 *                parser deliberately reads it as text; this is where the other
 *                readings are offered instead of guessed.
 *
 * Neither invents vocabulary. Both offer tokens exported from the parser's own
 * module, and `searchVocabularyParses` walks every one of them — a suggestion
 * the reader cannot read would produce a chip that filters nothing, which is
 * the product asserting a filter it has not applied.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RIGHT-TO-LEFT
 *
 * Logical properties throughout, so the row fills from the inline start in both
 * scripts. Each chip's text is wrapped in `<bdi>`: a chip reading "500 – 900"
 * mixes two left-to-right runs into a right-to-left row, and left loose the
 * bidi algorithm reorders the neutrals between them so the range reads
 * backwards.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Plus, Search, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import {
  monthCompletions,
  parseMoneySearch,
  periodCompletions,
  relativePeriods,
  statusFilters,
  removeTerm,
  type MoneySearchTerm,
  type SearchLanguage,
  type Suggestion,
} from '@/lib/payments/moneySearchTerms';

interface MoneySearchFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** The business's own date, 'YYYY-MM-DD'. The same value the route parses with. */
  today: string;
  language: SearchLanguage;
  placeholder?: string;
  t: (key: string) => string;
  className?: string;
}

/**
 * The amounts the slider stops on, and the last one means "and above".
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Fixed, because nothing on this screen knows what a big number is HERE. The
 * field is handed the search string and nothing else; one business bills ₪133
 * a session and another ₪50,000 a project, and the rows in hand are one page
 * of ten. A ceiling derived from any of that would be wrong for most accounts
 * and would move under the thumb as the filter changed.
 *
 * So the track does not claim to span this business's money. It offers the
 * round numbers people actually filter on, and leaves the top open.
 * ───────────────────────────────────────────────────────────────────────────
 */
const AMOUNT_STOPS = [0, 100, 250, 500, 1000, 2500, 5000, 10000, Infinity] as const;

/** One row offered under the box, with the mark that says what kind it is. */
interface Offer extends Suggestion {
  /** A glyph, not an icon: these sit in a list of text and read as notation. */
  mark: string;
  note?: string;
}

/** A short, human label for one chip. */
function chipLabel(
  term: MoneySearchTerm,
  t: (key: string) => string,
  money: (n: number) => string
): string {
  if (term.kind === 'text') return term.raw;

  if (term.kind === 'amount') {
    const { min, max } = term;
    if (min !== null && max !== null) {
      return min === max ? money(min) : `${money(min)} – ${money(max)}`;
    }
    if (min !== null) return `${t('payments.search.over') || 'over'} ${money(min)}`;
    return `${t('payments.search.under') || 'under'} ${money(max ?? 0)}`;
  }

  /*
   * A period, a state or a collection method — all said back in the words they
   * were asked in. `raw`, not the resolved value: somebody who typed "last 30
   * days" recognises "last 30 days", and "15 Sep – 14 Oct" makes them check the
   * arithmetic. The dates go on the chip's title for when they do want them.
   *
   * The same holds for the words added with `status` and `method`: an owner who
   * typed "open" should read "open", not "Outstanding" — translating their own
   * word back at them reads as the search having understood something else.
   */
  return term.raw;
}

export function MoneySearchField({
  value,
  onChange,
  today,
  language,
  placeholder,
  t,
  className = '',
}: MoneySearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  /** Where the two thumbs sit, as indexes into `AMOUNT_STOPS`. */
  const [amountRange, setAmountRange] = useState<[number, number]>([0, AMOUNT_STOPS.length - 1]);

  /** Which offer the keyboard is on. -1 is "none", not "the first". */
  const [cursor, setCursor] = useState(-1);

  const isRTL = language === 'he';
  const terms = useMemo(() => parseMoneySearch(value, today), [value, today]);

  const chips = terms.filter(term => term.kind !== 'text');
  const free = terms
    .filter(term => term.kind === 'text')
    .map(term => term.raw)
    .join(' ');

  /*
   * Amounts are shown as bare numbers, never with a currency symbol. The rows
   * can be in more than one currency and there is no FX rate in this platform,
   * so ">500" means 500 of whatever a row is priced in. A "₪" on the chip would
   * claim a currency the filter does not apply.
   */
  const money = (amount: number) =>
    new Intl.NumberFormat(isRTL ? 'he-IL' : language === 'es' ? 'es-ES' : 'en-US', {
      maximumFractionDigits: 2,
    }).format(amount);

  /** Append a token, keeping what is already there. */
  const add = (token: string) => {
    onChange([value.trim(), token].filter(Boolean).join(' '));
    setCursor(-1);
    inputRef.current?.focus();
  };

  const drop = (term: MoneySearchTerm) => {
    onChange(removeTerm(value, term));
    inputRef.current?.focus();
  };

  /*
   * WHAT THE TYPED REMAINDER COULD MEAN.
   *
   * Driven by the free text only, so it goes quiet the moment a chip is made
   * rather than continuing to offer readings of a term already applied.
   */
  const offers: Offer[] = useMemo(() => {
    const typed = free.trim();
    if (!typed) return [];

    const digits = typed.replace(/[^\d]/g, '');
    const numeric = /^[\d.,]+$/.test(typed) && digits.length > 0;

    if (numeric) {
      const n = Number(digits);
      /*
       * Text comes FIRST. A bare number is an invoice number more often than an
       * amount, so the reading the parser already applies is the default and
       * the others are the alternatives — not the other way round.
       */
      return [
        { mark: '⌕', token: typed, label: `"${typed}"`, note: t('payments.search.as_text') || 'as text' },
        { mark: '≥', token: `>${digits}`, label: `${t('payments.search.over') || 'over'} ${money(n)}` },
        { mark: '≤', token: `<${digits}`, label: `${t('payments.search.under') || 'under'} ${money(n)}` },
      ];
    }

    const periods = [
      ...monthCompletions(typed, language, today),
      ...periodCompletions(typed, language),
    ];

    /* Nothing recognisable: no list. An empty popover under every keystroke of
       a client's name is noise, and the text search already works. */
    if (periods.length === 0) return [];

    return [
      { mark: '⌕', token: typed, label: `"${typed}"`, note: t('payments.search.as_text') || 'as text' },
      ...periods.map(suggestion => ({ ...suggestion, mark: '▦' })),
    ];
  }, [free, language, today, t]);

  /* A stale cursor would highlight a row that no longer exists. */
  useEffect(() => setCursor(-1), [free]);

  /* A panel that stays open after a click elsewhere is one you dismiss twice. */
  useEffect(() => {
    if (!panelOpen) return;

    const close = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;

      /*
       * A PORTALLED DROPDOWN IS STILL INSIDE THIS PANEL, even though the DOM
       * says otherwise.
       *
       * The amount operator is the platform `Select`, and Radix renders its
       * list through a portal on `document.body` — so it is not inside
       * `boxRef`, and without this, pressing "under" closed the entire filter
       * panel on mousedown before the choice could register. The control would
       * have looked broken rather than missing, which is worse.
       */
      if (target?.closest?.('[data-radix-popper-content-wrapper]')) return;

      if (boxRef.current && !boxRef.current.contains(target as Node)) setPanelOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setPanelOpen(false);
    };

    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [panelOpen]);

  /** Replace the free text, keeping every chip. */
  const setFree = (next: string) => {
    const kept = chips.map(term => term.raw).join(' ');
    onChange([kept, next].filter(Boolean).join(' '));
  };

  /** Take one offer: it replaces the text it was a reading OF. */
  const take = (offer: Offer) => {
    const kept = chips.map(term => term.raw).join(' ');
    onChange([kept, offer.token].filter(Boolean).join(' '));
    setCursor(-1);
    inputRef.current?.focus();
  };

  const [lowStop, highStop] = [AMOUNT_STOPS[amountRange[0]], AMOUNT_STOPS[amountRange[1]]];
  /** Whether each end is still parked where it started, i.e. unbounded. */
  const openLow = amountRange[0] === 0;
  const openHigh = amountRange[1] === AMOUNT_STOPS.length - 1;

  /**
   * What the span reads as, which is also what it will filter by.
   *
   * Shown beside the track so the thumbs are never the only statement of the
   * filter — "over 500" is a sentence, a thumb two-thirds along is not.
   */
  const amountRangeLabel = openLow && openHigh
    ? t('payments.search.any_amount') || 'any'
    : openHigh
      ? `${t('payments.search.over') || 'over'} ${money(lowStop)}`
      : openLow
        ? `${t('payments.search.under') || 'under'} ${money(highStop)}`
        /*
         * THE LOW END ON THE SIDE THE READER STARTS FROM.
         *
         * `<bdi>` isolates this run so the two figures cannot be reordered by
         * the bidi algorithm — which is what keeps "500 – 2,500" from coming
         * out backwards, and also what stops it following the page on its own.
         * So the order is chosen here: in Hebrew the span is read right to
         * left, which puts the smaller number on the right.
         *
         * It matches the track above it and the two end labels under it. A
         * range that reads one way while the thumbs run the other is worse
         * than either on its own.
         */
        : isRTL
          ? `${money(highStop)} – ${money(lowStop)}`
          : `${money(lowStop)} – ${money(highStop)}`;

  /**
   * The span as a token the parser already reads.
   *
   * Which END has moved says which comparison was meant, so the dropdown that
   * used to ask is gone: the LOW thumb alone is "over", the high thumb alone is
   * "under", both is a range. Low and high rather than left and right — the
   * track follows the reading direction, so the sides swap in Hebrew. The strings are the ones `readToken` has always
   * accepted — nothing new had to be taught to the parser.
   */
  const addAmount = () => {
    if (openLow && openHigh) return;

    const token = openHigh
      ? `>${lowStop}`
      : openLow
        ? `<${highStop}`
        : `${lowStop}-${highStop}`;

    add(token);
    setAmountRange([0, AMOUNT_STOPS.length - 1]);
    setPanelOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (offers.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setCursor(current => (current + step + offers.length) % offers.length);
        return;
      }
      if (event.key === 'Enter' && cursor >= 0) {
        event.preventDefault();
        take(offers[cursor]);
        return;
      }
      if (event.key === 'Escape') {
        setCursor(-1);
        return;
      }
    }

    /*
     * Backspace at the very start of the input removes the last chip, which is
     * what anybody who has used a tag field expects. Guarded on the caret being
     * at 0 with nothing selected, so it never eats a chip while the user is
     * still deleting their own typing.
     */
    if (event.key !== 'Backspace') return;

    const input = event.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    if (!atStart || chips.length === 0) return;

    event.preventDefault();
    drop(chips[chips.length - 1]);
  };

  const periodPills = relativePeriods(language);
  const statusPills = statusFilters(language);
  const listOpen = offers.length > 0;

  return (
    <div className={`relative ${className}`} ref={boxRef}>
      <div
        /* focus-WITHIN, because the thing that takes focus is the inner input
           and the ring belongs to the whole field. */
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 border border-[var(--v2-border)] bg-[var(--v2-surface)] px-2.5 py-1.5 transition-all focus-within:ring-2 focus-within:ring-[#22C58B]"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
        onClick={event => {
          if (!(event.target as HTMLElement).closest('button')) inputRef.current?.focus();
        }}
      >
        <Search className="h-4 w-4 shrink-0 text-[var(--v2-text-muted)]" aria-hidden="true" />

        {chips.map((term, index) => (
          <span
            key={`${term.kind}-${term.raw}-${index}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full bg-[var(--v2-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--v2-text-primary)]"
            title={term.kind === 'period' ? `${term.from} → ${term.to}` : undefined}
          >
            <bdi className="truncate">{chipLabel(term, t, money)}</bdi>
            <button
              type="button"
              onClick={event => {
                event.stopPropagation();
                drop(term);
              }}
              aria-label={`${t('common.remove') || 'Remove'}: ${chipLabel(term, t, money)}`}
              className="shrink-0 text-[var(--v2-text-muted)] transition-colors hover:text-[var(--v2-text-primary)]"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          type="text"
          value={free}
          /*
           * Editing REPLACES the free text and keeps the chips, by rebuilding
           * the string as "chips + what is now typed". Appending to the raw
           * value instead sent the caret to the end on every keystroke.
           */
          onChange={event => setFree(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={chips.length > 0 ? '' : placeholder}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls="money-search-offers"
          aria-autocomplete="list"
          autoComplete="off"
          className="min-w-[80px] flex-1 border-0 bg-transparent p-0 text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-0"
        />

        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            setPanelOpen(open => !open);
          }}
          aria-expanded={panelOpen}
          aria-label={t('payments.search.add_filter') || 'Add a filter'}
          title={t('payments.search.add_filter') || 'Add a filter'}
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-dashed transition-colors ${
            panelOpen
              ? 'border-solid border-[#22C58B] text-[#22C58B]'
              : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:border-[#22C58B] hover:text-[#22C58B]'
          }`}
        >
          <Plus className="h-3 w-3" />
        </button>

        {value.trim() && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onChange('');
              inputRef.current?.focus();
            }}
            aria-label={t('common.clear') || 'Clear'}
            className="shrink-0 text-[var(--v2-text-muted)] transition-colors hover:text-[var(--v2-text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/*
        THE READINGS of what was just typed.
        ────────────────────────────────────
        Shown above the panel in the stack and never at the same time: two
        popovers under one box, both offering periods, is two answers to one
        question.
      */}
      {listOpen && !panelOpen && (
        <ul
          id="money-search-offers"
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] p-1 shadow-lg scrollbar-thin"
        >
          {offers.map((offer, index) => (
            <li key={`${offer.mark}-${offer.token}`} role="option" aria-selected={index === cursor}>
              <button
                type="button"
                /* mousedown, not click: the input's blur would close this list
                   before a click ever landed. */
                onMouseDown={event => {
                  event.preventDefault();
                  take(offer);
                }}
                onMouseEnter={() => setCursor(index)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-[12px] transition-colors ${
                  index === cursor ? 'bg-[var(--v2-surface-hover)]' : ''
                }`}
              >
                <span className="min-w-[18px] shrink-0 rounded bg-[var(--v2-border)] text-center font-mono text-[10px] text-[var(--v2-text-secondary)]">
                  {offer.mark}
                </span>
                <bdi className="truncate text-[var(--v2-text-primary)]">{offer.label}</bdi>
                {offer.note && (
                  <span className="ms-auto shrink-0 text-[10px] text-[var(--v2-text-muted)]">
                    {offer.note}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* EVERYTHING AVAILABLE, for someone who does not know to type at all. */}
      {panelOpen && (
        <div
          className="absolute inset-x-0 top-full z-30 mt-1 flex flex-col gap-3 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] p-3 shadow-lg"
          onClick={event => event.stopPropagation()}
        >
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--v2-text-muted)]">
              {t('payments.search.group_amount') || 'Amount'}
            </span>

            {/*
              ONE TRACK, TWO THUMBS — replacing a dropdown and two boxes.
              ───────────────────────────────────────────────────────────────
              Over, under and between were three controls describing one idea:
              a span. The span is now the control, and which end you move says
              which of the three you meant.

              THE STOPS ARE FIXED, and the top one means "and above". A slider
              needs a maximum, and nothing here knows one: this field receives
              only the search string, amounts differ by orders of magnitude
              between businesses, and the rows in hand are one page of ten. A
              guessed ceiling would be wrong for almost everyone, so the track
              does not claim to span this business's money — it offers the
              round numbers people actually filter on.

              Positions are INDEXES, not amounts. The stops are deliberately
              non-linear (100 → 250 → 500 → 1k → 2.5k), and sliding over the
              values would bunch every useful choice into the first tenth of
              the track. Over indexes each stop gets equal width and snapping
              is free.
            */}
            <div className="flex flex-wrap items-center gap-4 pb-4">
              {/*
                THE TRACK FOLLOWS THE READING DIRECTION.
                ───────────────────────────────────────────────────────────────
                In Hebrew the span starts at the right: 0 on the right, "10,000
                and above" on the left. This was built the other way, forced to
                `dir="ltr"` on the reasoning that digits are left-to-right
                anyway — which is true of each NUMBER and false of the scale
                they sit on. A reader whose page runs right-to-left starts at
                the right-hand end, and finding zero at the far left means
                reading the control backwards before touching it.

                Nothing is forced now. A native range input honours the
                inherited direction, so the thumbs mirror on their own, and the
                fill below is positioned with LOGICAL properties so it mirrors
                with them — `inset-inline-start` is the left edge in English
                and the right edge in Hebrew, which is exactly the low end in
                both.
              */}
              {/* The figures below are visual; this says the span once, for
                  a reader who hears the control rather than sees it. */}
              <div
                role="group"
                aria-label={`${t('payments.search.group_amount') || 'Amount'}: ${amountRangeLabel}`}
                /*
                 * The labels are positioned OUT of the flow, so this box is
                 * exactly as tall as the track. The row centres on it, and a
                 * column here would centre the Add button on the track AND its
                 * figures together — leaving the button sitting low against the
                 * line it belongs to. The row carries the bottom padding the
                 * figures need.
                 */
                className="relative min-w-[150px] max-w-[240px] flex-1"
              >
                <div className="relative h-4">
                  {/* The unselected track. */}
                  <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--v2-border)]" />
                  {/* And the part between the thumbs. */}
                  <div
                    className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-[#22C58B]"
                    style={{
                      insetInlineStart: `${(amountRange[0] / (AMOUNT_STOPS.length - 1)) * 100}%`,
                      insetInlineEnd: `${100 - (amountRange[1] / (AMOUNT_STOPS.length - 1)) * 100}%`,
                    }}
                  />
                  {([0, 1] as const).map(thumb => (
                    <input
                      key={thumb}
                      type="range"
                      min={0}
                      max={AMOUNT_STOPS.length - 1}
                      step={1}
                      value={amountRange[thumb]}
                      onChange={event => {
                        const next = Number(event.target.value);
                        setAmountRange(current =>
                          thumb === 0
                            ? [Math.min(next, current[1]), current[1]]
                            : [current[0], Math.max(next, current[0])]
                        );
                      }}
                      aria-label={
                        thumb === 0
                          ? t('payments.search.over') || 'over'
                          : t('payments.search.under') || 'under'
                      }
                      /*
                       * Or it announces "4 of 8". The slider's VALUE is an
                       * index into the stops — that is what makes a non-linear
                       * scale space evenly — so the figure a person actually
                       * means has to be supplied separately.
                       */
                      aria-valuetext={
                        thumb === 1 && openHigh
                          ? `${money(AMOUNT_STOPS[AMOUNT_STOPS.length - 2])}+`
                          : money(AMOUNT_STOPS[amountRange[thumb]])
                      }
                      /*
                       * Stacked, both transparent, with pointer events only on
                       * the thumbs — otherwise the upper input's full-width
                       * track swallows every press aimed at the lower one, and
                       * that thumb cannot be grabbed at all. Named by its layer
                       * rather than by a side: which end it sits at depends on
                       * the reading direction.
                       */
                      className="ap-range absolute inset-0 w-full appearance-none bg-transparent"
                    />
                  ))}
                </div>

                {/*
                  THE TWO FIGURES, UNDER THE THUMBS THAT SET THEM.
                  ─────────────────────────────────────────────────────────────
                  These were the fixed ends of the scale — 0 and 10,000+ — with
                  the chosen span repeated in a third label beside the track. So
                  two places said the same thing, and the one that moved was not
                  the one under the handle that moved it.

                  The ends ARE the values now. Each sits under its own thumb and
                  changes with it, which is where a reader is already looking.

                  No conditional for the sides: in a row that follows the page
                  the first child sits at the inline start — left in English,
                  right in Hebrew — which is the low end either way. The same
                  rule that mirrors the track mirrors these.
                */}
                <div className="absolute inset-x-0 top-full mt-1 flex justify-between px-0.5 text-[9px] leading-none text-[var(--v2-text-muted)]">
                  <bdi>{money(lowStop)}</bdi>
                  {/* The top stop is open-ended, and "∞" is not a sum of money. */}
                  <bdi>{openHigh ? `${money(AMOUNT_STOPS[AMOUNT_STOPS.length - 2])}+` : money(highStop)}</bdi>
                </div>
              </div>

              <button
                type="button"
                onClick={addAmount}
                /* The full span is not a filter — it is the absence of one. */
                disabled={amountRange[0] === 0 && amountRange[1] === AMOUNT_STOPS.length - 1}
                className="rounded-md bg-[#22C58B] px-2.5 py-1 text-[12px] font-semibold text-[#04241A] transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('common.add') || 'Add'}
              </button>
            </div>
          </div>

          {/*
            THE STATE, offered rather than only typeable.
            ───────────────────────────────────────────────────────────────────
            The panel showed an amount box and six period pills, so the one
            question the advisor card asks out loud — "₪510 is open, where is
            it" — could be answered only by an owner who had already guessed
            the word was readable.

            Same pills, same toggle, same `aria-pressed` as the periods below:
            it is the same kind of choice and a second visual language for it
            would read as a different sort of control.
          */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--v2-text-muted)]">
              {t('payments.search.group_status') || 'State'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {statusPills.map(pill => {
                const on = value.toLowerCase().includes(pill.token.toLowerCase());

                return (
                  <button
                    key={pill.token}
                    type="button"
                    onClick={() => {
                      /*
                       * One state at a time. Two would AND to nothing — a row
                       * cannot be both paid and overdue — so picking a second
                       * replaces the first rather than emptying the list.
                       */
                      const existing = chips.find(term => term.kind === 'status');
                      if (existing) drop(existing);
                      if (!existing || existing.raw.toLowerCase() !== pill.token.toLowerCase()) {
                        add(pill.token);
                      }
                    }}
                    aria-pressed={on}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                      on
                        ? 'border-[#22C58B] bg-[#22C58B]/10 font-semibold text-[#22C58B]'
                        : 'border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[#22C58B] hover:text-[#22C58B]'
                    }`}
                  >
                    <bdi>{pill.label}</bdi>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--v2-text-muted)]">
              {t('payments.search.group_period') || 'Period'}
            </span>
            <div className="flex flex-wrap gap-1.5">
              {periodPills.map(pill => {
                /* Lit when it is already on, so the panel doubles as a reading
                   of the current filter rather than only a way to add to it. */
                const on = value.toLowerCase().includes(pill.token.toLowerCase());

                return (
                  <button
                    key={pill.token}
                    type="button"
                    onClick={() => {
                      const existing = chips.find(
                        term => term.raw.toLowerCase() === pill.token.toLowerCase()
                      );
                      if (existing) drop(existing);
                      else add(pill.token);
                    }}
                    aria-pressed={on}
                    className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                      on
                        ? 'border-[#22C58B] bg-[#22C58B]/10 font-semibold text-[#22C58B]'
                        : 'border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[#22C58B] hover:text-[#22C58B]'
                    }`}
                  >
                    <bdi>{pill.label}</bdi>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

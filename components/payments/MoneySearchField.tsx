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
import { ChevronDown, Plus, Search, X } from 'lucide-react';

import {
  monthCompletions,
  parseMoneySearch,
  periodCompletions,
  relativePeriods,
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

/** How a comparison is being built in the panel. */
type AmountOp = 'over' | 'under' | 'between';

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
   * The period said back in the words it was asked in. `raw`, not the resolved
   * dates: somebody who typed "last 30 days" recognises "last 30 days", and
   * "15 Sep – 14 Oct" makes them check the arithmetic. The dates go on the
   * chip's title for when they do want them.
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
  const [op, setOp] = useState<AmountOp>('over');
  const [low, setLow] = useState('');
  const [high, setHigh] = useState('');

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
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setPanelOpen(false);
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

  const addAmount = () => {
    const a = low.replace(/[^\d.]/g, '');
    const b = high.replace(/[^\d.]/g, '');
    if (!a) {
      return;
    }

    /* `between` with no upper bound is just "over", which is what the owner
       has actually described — better than refusing the click. */
    const token = op === 'over' ? `>${a}` : op === 'under' ? `<${a}` : b ? `${a}-${b}` : `>${a}`;

    add(token);
    setLow('');
    setHigh('');
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
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="relative">
                <select
                  value={op}
                  onChange={event => setOp(event.target.value as AmountOp)}
                  aria-label={t('payments.search.group_amount') || 'Amount'}
                  className="appearance-none rounded-md border border-[var(--v2-border)] bg-[var(--v2-surface)] py-1 pe-6 ps-2 text-[12px] text-[var(--v2-text-primary)] focus:outline-none focus:ring-1 focus:ring-[#22C58B]"
                >
                  <option value="over">{t('payments.search.over') || 'over'}</option>
                  <option value="under">{t('payments.search.under') || 'under'}</option>
                  <option value="between">{t('payments.search.between') || 'between'}</option>
                </select>
                <ChevronDown className="pointer-events-none absolute end-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--v2-text-muted)]" />
              </div>

              <input
                type="text"
                inputMode="decimal"
                value={low}
                onChange={event => setLow(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addAmount();
                  }
                }}
                placeholder="500"
                aria-label={t('payments.search.group_amount') || 'Amount'}
                className="w-20 rounded-md border border-[var(--v2-border)] bg-[var(--v2-surface)] px-2 py-1 font-mono text-[12px] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[#22C58B]"
              />

              {op === 'between' && (
                <input
                  type="text"
                  inputMode="decimal"
                  value={high}
                  onChange={event => setHigh(event.target.value)}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addAmount();
                    }
                  }}
                  placeholder="900"
                  aria-label={t('payments.search.upper_amount') || 'Upper amount'}
                  className="w-20 rounded-md border border-[var(--v2-border)] bg-[var(--v2-surface)] px-2 py-1 font-mono text-[12px] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-1 focus:ring-[#22C58B]"
                />
              )}

              <button
                type="button"
                onClick={addAmount}
                disabled={!low.replace(/[^\d.]/g, '')}
                className="rounded-md bg-[#22C58B] px-2.5 py-1 text-[12px] font-semibold text-[#04241A] transition-all hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {t('common.add') || 'Add'}
              </button>
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

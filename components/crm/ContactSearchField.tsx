'use client';

/**
 * The contact search: one box, a panel of what it filters by, one string.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The orders search, for contacts — and deliberately the same thing rather than
 * something like it, because an owner who has learned one box should not have
 * to learn a second. Same shape: chips in the field, a ⊕ that answers "what can
 * I filter by?", suggestions that answer "what does what I just typed mean?".
 *
 * THE TEXT IS THE ONLY STATE. `value` is the string; the chips are what
 * `parseContactSearch` makes of it; adding and removing one edits the string.
 * The route parses the same string with the same function, so the chips on
 * screen cannot describe a different question from the rows that come back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE VOCABULARY IS THE ACCOUNT'S, NOT A CONSTANT
 *
 * Stages are configured per account, and the sources and tags offered are the
 * ones this business has actually used. A panel offering `source:newsletter` to
 * somebody who has never run one is a filter that can only return nothing — the
 * product asserting a capability it does not have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RIGHT-TO-LEFT
 *
 * Logical properties throughout, and each chip's text in a `<bdi>`: a chip
 * reading "stage: lead" mixes a left-to-right run into a right-to-left row, and
 * left loose the bidi algorithm reorders the neutrals around it.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Plus, Search, X } from 'lucide-react';

import {
  parseContactSearch,
  removeContactTerm,
  type ContactSearchTerm,
} from '@/lib/crm/contactSearchTerms';
import {
  monthCompletions,
  periodCompletions,
  relativePeriods,
  type SearchLanguage,
  type Suggestion,
} from '@/lib/payments/moneySearchTerms';

/** One value this account can filter by, with the words to show for it. */
export interface FilterOption {
  /** What goes after the colon. */
  value: string;
  /** What the owner reads. */
  label: string;
}

interface ContactSearchFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** The business's own date, 'YYYY-MM-DD'. The same value the route parses with. */
  today: string;
  language: SearchLanguage;
  /** The account's pipeline stages, in board order. */
  stages: FilterOption[];
  /** The sources this business has actually recorded. */
  sources: FilterOption[];
  /** The tags in use on this account. */
  tags: string[];
  placeholder?: string;
  t: (key: string) => string;
  className?: string;
}

/** One row offered under the box, with the mark that says what kind it is. */
interface Offer extends Suggestion {
  /** A glyph, not an icon: these sit in a list of text and read as notation. */
  mark: string;
  note?: string;
}

/** Quoted only when it has to be — a bare token reads better in the box. */
const token = (field: string, value: string) =>
  /\s/.test(value) ? `${field}:"${value}"` : `${field}:${value}`;

export function ContactSearchField({
  value,
  onChange,
  today,
  language,
  stages,
  sources,
  tags,
  placeholder,
  t,
  className = '',
}: ContactSearchFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const [panelOpen, setPanelOpen] = useState(false);
  /** Which offer the keyboard is on. -1 is "none", not "the first". */
  const [cursor, setCursor] = useState(-1);

  const terms = useMemo(() => parseContactSearch(value, today), [value, today]);

  const chips = terms.filter(term => term.kind !== 'text');
  const free = terms
    .filter(term => term.kind === 'text')
    .map(term => term.raw)
    .join(' ');

  /** A short, human label for one chip. */
  const chipLabel = (term: ContactSearchTerm): string => {
    if (term.kind === 'stage') {
      return stages.find(option => option.value === term.value)?.label ?? term.value;
    }
    if (term.kind === 'source') {
      return sources.find(option => option.value === term.value)?.label ?? term.value;
    }
    if (term.kind === 'tag') return term.value;
    if (term.kind === 'has') {
      const what = t(`crm.search.has_${term.field}`) || term.field;
      return term.present ? what : `${t('crm.search.without') || 'no'} ${what}`;
    }
    if (term.kind === 'in_stage') {
      return (t('crm.search.in_stage_for') || 'in stage {days}d+').replace(
        '{days}',
        String(term.days)
      );
    }
    /*
     * A period said back in the words it was asked in. `raw`, not the resolved
     * dates: somebody who typed "this month" recognises "this month", and
     * "1 Oct – 31 Oct" makes them check the arithmetic. The dates go on the
     * chip's title for when they do want them.
     */
    return term.raw;
  };

  const add = (next: string) => {
    onChange([value.trim(), next].filter(Boolean).join(' '));
    setCursor(-1);
    inputRef.current?.focus();
  };

  const drop = (term: ContactSearchTerm) => {
    onChange(removeContactTerm(value, term));
    inputRef.current?.focus();
  };

  /** Editing replaces the free text and keeps the chips. */
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

  /*
   * WHAT THE TYPED REMAINDER COULD MEAN.
   *
   * Driven by the free text only, so it goes quiet the moment a chip is made
   * rather than going on offering readings of a term already applied.
   *
   * Text comes FIRST, always: what the parser already does is the default, and
   * the rest are alternatives. Typing a client's name must not need a dismissal
   * before it searches for the name.
   */
  const offers: Offer[] = useMemo(() => {
    const typed = free.trim();
    if (!typed) return [];

    const needle = typed.toLowerCase();

    const matches: Offer[] = [
      ...stages
        .filter(option => option.label.toLowerCase().includes(needle) || option.value.includes(needle))
        .map(option => ({
          mark: '◆',
          token: token('stage', option.value),
          label: option.label,
          note: t('crm.search.stage') || 'stage',
        })),
      ...sources
        .filter(option => option.label.toLowerCase().includes(needle) || option.value.includes(needle))
        .map(option => ({
          mark: '⇥',
          token: token('source', option.value),
          label: option.label,
          note: t('crm.search.source') || 'source',
        })),
      ...tags
        .filter(tag => tag.toLowerCase().includes(needle))
        .map(tag => ({
          mark: '#',
          token: token('tag', tag),
          label: tag,
          note: t('crm.search.tag') || 'tag',
        })),
      ...monthCompletions(typed, language, today).map(suggestion => ({ ...suggestion, mark: '▦' })),
      ...periodCompletions(typed, language).map(suggestion => ({ ...suggestion, mark: '▦' })),
    ];

    /* Nothing recognisable: no list. An empty popover under every keystroke of
       a client's name is noise, and the text search already works. */
    if (matches.length === 0) return [];

    return [
      {
        mark: '⌕',
        token: typed,
        label: `"${typed}"`,
        note: t('payments.search.as_text') || 'as text',
      },
      ...matches,
    ].slice(0, 8);
  }, [free, stages, sources, tags, language, today, t]);

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

    /* Backspace at an empty box removes the last chip, which is what every
       other token field does and what a finger reaches for. */
    if (event.key === 'Backspace' && !free && chips.length > 0) {
      event.preventDefault();
      drop(chips[chips.length - 1]);
    }
  };

  // A panel that stays open after you click elsewhere is one you dismiss twice.
  useEffect(() => {
    if (!panelOpen) return;

    const close = (event: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setPanelOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [panelOpen]);

  const listOpen = offers.length > 0;

  /** One group in the ⊕ panel. Absent entirely when the account has none. */
  const group = (title: string, options: FilterOption[], field: string) =>
    options.length === 0 ? null : (
      <div className="mb-2 last:mb-0">
        <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
          {title}
        </p>
        <div className="flex flex-wrap gap-1">
          {options.map(option => (
            <button
              key={`${field}-${option.value}`}
              type="button"
              onClick={() => {
                add(token(field, option.value));
                setPanelOpen(false);
              }}
              className="rounded-full border border-[var(--v2-border)] px-2 py-0.5 text-[11px] text-[var(--v2-text-secondary)] transition-colors hover:border-[#8B5CF6] hover:text-[var(--v2-text-primary)]"
            >
              <bdi>{option.label}</bdi>
            </button>
          ))}
        </div>
      </div>
    );

  return (
    <div className={`relative ${className}`} ref={boxRef}>
      <div
        /* focus-WITHIN, because the thing that takes focus is the inner input
           and the ring belongs to the whole field. */
        className="flex min-h-[38px] flex-wrap items-center gap-1.5 border border-[var(--v2-border)] bg-[var(--v2-surface)] px-2.5 py-1.5 transition-all focus-within:ring-2 focus-within:ring-[#8B5CF6]"
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
            <bdi className="truncate">{chipLabel(term)}</bdi>
            <button
              type="button"
              onClick={event => {
                event.stopPropagation();
                drop(term);
              }}
              aria-label={`${t('common.remove') || 'Remove'}: ${chipLabel(term)}`}
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
          onChange={event => setFree(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={chips.length > 0 ? '' : placeholder}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls="contact-search-offers"
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
          aria-label={t('crm.search.add_filter') || 'Add a filter'}
          title={t('crm.search.add_filter') || 'Add a filter'}
          className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border border-dashed transition-colors ${
            panelOpen
              ? 'border-solid border-[#8B5CF6] text-[#8B5CF6]'
              : 'border-[var(--v2-border)] text-[var(--v2-text-muted)] hover:border-[#8B5CF6] hover:text-[#8B5CF6]'
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
        THE READINGS of what was just typed. Never at the same time as the
        panel: two popovers under one box, both offering filters, is two
        answers to one question.
      */}
      {listOpen && !panelOpen && (
        <ul
          id="contact-search-offers"
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
                className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-[12.5px] transition-colors ${
                  index === cursor
                    ? 'bg-[var(--v2-surface-hover)] text-[var(--v2-text-primary)]'
                    : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface-hover)]'
                }`}
              >
                <span aria-hidden="true" className="w-3 shrink-0 text-center text-[var(--v2-text-muted)]">
                  {offer.mark}
                </span>
                <bdi className="min-w-0 flex-1 truncate">{offer.label}</bdi>
                {offer.note && (
                  <span className="shrink-0 text-[10px] text-[var(--v2-text-muted)]">{offer.note}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* WHAT CAN I FILTER BY — for somebody who does not yet know the box
          understands stages at all. */}
      {panelOpen && (
        <div
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface)] p-2 shadow-lg scrollbar-thin"
        >
          {group(t('crm.search.stage') || 'Stage', stages, 'stage')}
          {group(t('crm.search.source') || 'Source', sources, 'source')}
          {group(
            t('crm.search.tag') || 'Tag',
            tags.map(tag => ({ value: tag, label: tag })),
            'tag'
          )}

          <div className="mb-0">
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('crm.search.added') || 'Added'}
            </p>
            <div className="flex flex-wrap gap-1">
              {relativePeriods(language).map(period => (
                <button
                  key={period.token}
                  type="button"
                  onClick={() => {
                    add(period.token);
                    setPanelOpen(false);
                  }}
                  className="rounded-full border border-[var(--v2-border)] px-2 py-0.5 text-[11px] text-[var(--v2-text-secondary)] transition-colors hover:border-[#8B5CF6] hover:text-[var(--v2-text-primary)]"
                >
                  <bdi>{period.label}</bdi>
                </button>
              ))}
            </div>
          </div>

          {/* What they have and have not. Both halves offered, because
              "never booked" is the one an owner chases and it is not reachable
              by typing a word. */}
          <div className="mt-2">
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('crm.search.presence') || 'Has'}
            </p>
            <div className="flex flex-wrap gap-1">
              {(['email', 'phone', 'bookings', 'tasks'] as const).flatMap(field =>
                [true, false].map(present => (
                  <button
                    key={`${present ? 'has' : 'no'}-${field}`}
                    type="button"
                    onClick={() => {
                      add(`${present ? 'has' : 'no'}:${field}`);
                      setPanelOpen(false);
                    }}
                    className="rounded-full border border-[var(--v2-border)] px-2 py-0.5 text-[11px] text-[var(--v2-text-secondary)] transition-colors hover:border-[#8B5CF6] hover:text-[var(--v2-text-primary)]"
                  >
                    <bdi>
                      {present ? '' : `${t('crm.search.without') || 'no'} `}
                      {t(`crm.search.has_${field}`) || field}
                    </bdi>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* How long they have sat where they are — a different question from
              when they were added, and the one that finds the stuck. */}
          <div className="mt-2">
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--v2-text-muted)]">
              {t('crm.search.in_stage') || 'In stage'}
            </p>
            <div className="flex flex-wrap gap-1">
              {[7, 30, 90].map(days => (
                <button
                  key={days}
                  type="button"
                  onClick={() => {
                    add(`in-stage:${days}d`);
                    setPanelOpen(false);
                  }}
                  className="rounded-full border border-[var(--v2-border)] px-2 py-0.5 text-[11px] text-[var(--v2-text-secondary)] transition-colors hover:border-[#8B5CF6] hover:text-[var(--v2-text-primary)]"
                >
                  <bdi>
                    {(t('crm.search.in_stage_for') || 'in stage {days}d+').replace(
                      '{days}',
                      String(days)
                    )}
                  </bdi>
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            className="mt-2 flex w-full items-center justify-center gap-1 rounded py-1 text-[11px] text-[var(--v2-text-muted)] transition-colors hover:text-[var(--v2-text-primary)]"
          >
            <ChevronDown className="h-3 w-3" />
            {t('common.close') || 'Close'}
          </button>
        </div>
      )}
    </div>
  );
}

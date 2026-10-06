'use client';

/**
 * One searchable dropdown, built on Headless UI's Combobox.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT HAND-ROLLED
 *
 * The first version of this was: a button, a search input, a filter, a
 * click-outside listener, an Escape handler and focus management — about a
 * hundred lines reimplementing a combobox. It had no arrow-key navigation, no
 * `aria-activedescendant`, no typeahead, and nothing told the screen reader what
 * the listbox was.
 *
 * `@headlessui/react` was already a dependency of this project — used by the
 * Stripe wizard and the dynamic select — and its Combobox is exactly this
 * control, accessible and keyboard-navigable. Everything below is styling and
 * the option shape.
 *
 * NOT a replacement for `crm/SearchableCountrySelect` or
 * `website/blocks/WebsiteCountrySelect`. Those are phone-number controls whose
 * trigger shows a dialling code, and they are on live surfaces. They could fold
 * into this later; rewriting them now to serve a third caller is how working
 * things break.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useState, type ReactNode } from 'react';
import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import { ChevronDown, Search } from 'lucide-react';

export interface DropdownOption {
  /** What gets stored. */
  value: string;
  /** What the reader sees. */
  label: string;
  /** A short code shown to the right — an ISO country or subdivision code. */
  hint?: string;
  /** A flag, usually. */
  icon?: ReactNode;
  /** Text that should match a search without being displayed. */
  keywords?: string;
}

interface SearchableDropdownProps {
  value?: string | null;
  onChange: (value: string) => void;
  options: DropdownOption[];
  placeholder?: string;
  emptyLabel?: string;
  isRTL?: boolean;
  /**
   * Shown when `value` matches no option.
   *
   * A stored value can legitimately be absent from the list: free text written
   * before the picker existed, or a state left over from another country. Shown
   * rather than silently blanked, so the owner can see it and replace it.
   */
  fallbackLabel?: string;
  /**
   * What the field says once it is open and ready to be typed into.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This control has ALWAYS been searchable — it is a Headless UI Combobox, and
   * typing "Calif" narrows 62 US states to one. Nobody knew. It wears a chevron,
   * it shows the chosen value, and it is sat among `<select>`-looking fields, so
   * it reads as a picker you scroll. The report that reached us was "the state
   * dropdown has no search", from someone looking straight at a working search
   * box.
   *
   * So the search is not being ADDED here, it is being made visible: this
   * placeholder replaces the field's label while the list is open, and the
   * trailing chevron becomes a magnifier at the same moment.
   * ───────────────────────────────────────────────────────────────────────────
   */
  searchPlaceholder?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
}

export function SearchableDropdown({
  value,
  onChange,
  options,
  placeholder,
  emptyLabel,
  isRTL = false,
  fallbackLabel,
  searchPlaceholder,
  className,
  style,
  disabled,
}: SearchableDropdownProps) {
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? options.filter(option =>
        [option.label, option.value, option.hint, option.keywords]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      )
    : options;

  const selected = options.find(option => option.value === value) ?? null;

  /*
   * What the input shows when it is not being typed in.
   *
   * `fallbackLabel` covers a stored value with no matching option — the legacy
   * "Israel" typed before the picker existed, or a California left behind after
   * switching to Canada. Without it the box would read empty and look as though
   * the setting had been lost.
   */
  const displayValue = (option: DropdownOption | null) =>
    option?.label ?? (value ? fallbackLabel ?? value : '');

  return (
    <Combobox
      value={selected}
      onChange={(option: DropdownOption | null) => option && onChange(option.value)}
      disabled={disabled}
      immediate
    >
      {({ open }) => (
      <div className="relative">
        <div className="relative">
          <ComboboxInput
            /*
             * `pe-9` is appended, never overridden.
             *
             * A caller passes the form's own field styling so this control
             * matches the inputs around it — but that styling knows nothing
             * about the chevron sitting inside this one, and without room
             * reserved for it the text runs underneath.
             */
            className={`${
              className ??
              'w-full border border-[var(--v2-border)] bg-[var(--v2-surface)] px-3 py-2 text-sm text-[var(--v2-text-primary)] transition-colors placeholder:text-[var(--v2-text-muted)] hover:border-[var(--v2-primary)] focus:border-[var(--v2-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]'
            } pe-9`}
            style={style ?? { borderRadius: 'var(--v2-radius-button)' }}
            /*
             * The label when closed, the invitation to type when open.
             *
             * A placeholder only shows over an EMPTY box, and Headless UI clears
             * the input's text while the list is open, so this is visible at
             * exactly the moment it is useful and never covers a chosen value.
             */
            placeholder={open && searchPlaceholder ? searchPlaceholder : placeholder}
            displayValue={displayValue}
            onChange={event => setQuery(event.target.value)}
            // Typing filters; leaving without choosing restores the real value.
            onBlur={() => setQuery('')}
          />
          <ComboboxButton className="absolute inset-y-0 end-0 flex items-center pe-3">
            {/*
              A magnifier the moment the list opens, a chevron the rest of the
              time. Both live in the slot `pe-9` already reserves, so swapping
              them moves nothing — and the icon is what tells somebody mid-click
              that this box takes typing, before they start scrolling 62 states
              looking for Pennsylvania.
            */}
            {open ? (
              <Search className="h-3.5 w-3.5 text-[var(--v2-text-muted)]" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5 text-[var(--v2-text-muted)]" />
            )}
          </ComboboxButton>
        </div>

        <ComboboxOptions
          anchor="bottom start"
          /*
           * `dir` follows the interface, not the option text.
           *
           * Headless UI positions the panel itself, so this is not about which
           * side it opens on — it is about where the code chip sits relative to
           * the name. Each name is wrapped in `bdi` so a Hebrew option inside an
           * English list still reads correctly either way.
           */
          dir={isRTL ? 'rtl' : 'ltr'}
          className="z-[9999] max-h-[320px] w-[var(--input-width)] overflow-y-auto border border-[var(--v2-border)] bg-[var(--v2-surface)] shadow-lg [--anchor-gap:4px] empty:invisible"
          style={{ borderRadius: 'var(--v2-radius-card)' }}
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-[var(--v2-text-muted)]">
              {emptyLabel || ''}
            </div>
          ) : (
            filtered.map(option => (
              <ComboboxOption
                key={option.value}
                value={option}
                className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-start transition-colors data-[focus]:bg-[var(--v2-primary)]/10 data-[selected]:bg-[var(--v2-primary)]/15 data-[selected]:font-medium"
              >
                {option.icon && <span className="text-base leading-none">{option.icon}</span>}
                <span className="flex-1 text-sm text-[var(--v2-text-primary)]">
                  <bdi>{option.label}</bdi>
                </span>
                {option.hint && (
                  <span className="rounded bg-[var(--v2-bg)] px-2 py-0.5 font-mono text-xs text-[var(--v2-text-muted)]">
                    {option.hint}
                  </span>
                )}
              </ComboboxOption>
            ))
          )}
        </ComboboxOptions>
      </div>
      )}
    </Combobox>
  );
}

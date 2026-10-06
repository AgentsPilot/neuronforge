'use client';

/**
 * The State / Province / Prefecture field — where there is one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RENDERS NOTHING for a country whose addresses have no administrative area. An
 * Israeli or British business sees no such row at all, which is the point: a
 * "State / province" box is meaningless to them and was being shown anyway.
 *
 * WHETHER TO SHOW IT is Google's libaddressinput metadata, via `lib-address` —
 * not a judgement made here. 80 of 252 countries have the field; the rest do
 * not, and the data says which, under twelve different names.
 *
 * SAME CONTROL AS THE COUNTRY PICKER. Both render `SearchableDropdown`, which
 * is Headless UI's Combobox: searchable, keyboard-navigable, accessible. This
 * was a bare `<select>` sitting one row from a custom dropdown.
 *
 * ONE COMPONENT for the invoice address and the display address, because they
 * are two forms asking the same question. Written twice they would drift.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useState } from 'react';

import { SearchableDropdown, type DropdownOption } from '@/components/ui/SearchableDropdown';
import { addressRulesFor, type CountryAddressRules } from '@/lib/geo/addressFormat';

interface AdminAreaFieldProps {
  /** ISO country code currently chosen. */
  country: string | null | undefined;
  value: string;
  onChange: (value: string) => void;
  /** Translates the noun — 'state', 'province', 'county', 'oblast', … */
  label: (key: string) => string;
  /**
   * What the box says once it is open — "Type to search…".
   *
   * Deliberately free of the field's noun. "Search states" would have to be
   * built per language and per country word, and Hebrew does not form it by
   * prefixing anything to "state"; a noun-free sentence is correct everywhere
   * and says the one thing that was missing. Optional: omitted, the field keeps
   * its label and behaves exactly as before.
   */
  searchPlaceholder?: string;
  emptyLabel?: string;
  isRTL?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function AdminAreaField({
  country,
  value,
  onChange,
  label,
  searchPlaceholder,
  emptyLabel,
  isRTL = false,
  className,
  style,
}: AdminAreaFieldProps) {
  const [rules, setRules] = useState<CountryAddressRules | null>(null);

  useEffect(() => {
    let cancelled = false;

    addressRulesFor(country).then(next => {
      if (!cancelled) setRules(next);
    });

    return () => {
      cancelled = true;
    };
  }, [country]);

  /*
   * Nothing until the rules are known, and nothing where there is no such field.
   *
   * Both render null rather than a placeholder box: flashing a "State" input
   * for a moment on an Israeli form, then removing it, is worse than the brief
   * absence of a field that was never going to apply.
   */
  if (!rules?.adminLabel) return null;

  const text = label(rules.adminLabel);

  if (rules.regions.length === 0) {
    /*
     * The country has the field but the data carries no list for it — common
     * outside the US and Canada. A text box is the correct control then, not a
     * dropdown with nothing in it.
     */
    return (
      <input
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={text}
        className={className}
        style={style}
        aria-label={text}
      />
    );
  }

  const options: DropdownOption[] = rules.regions.map(region => ({
    value: region.code,
    label: region.name,
    hint: region.code,
  }));

  /*
   * A value carried over from another country will not match the new list.
   *
   * Switching from the United States to Canada leaves 'CA' (California) in a
   * field now offering provinces. Shown as the input's fallback, the owner can
   * see what is there and replace it, rather than a blank control quietly
   * holding a wrong value that gets saved.
   */
  const isKnown = rules.regions.some(region => region.code === value);

  return (
    <SearchableDropdown
      value={value}
      onChange={onChange}
      options={options}
      placeholder={text}
      /*
       * Shown only while the list is open. Without it this looks like a
       * `select`, and sixty-two states get scrolled by somebody who could have
       * typed three letters.
       */
      searchPlaceholder={searchPlaceholder}
      emptyLabel={emptyLabel}
      isRTL={isRTL}
      fallbackLabel={!isKnown && value ? value : undefined}
      className={className}
      style={style}
    />
  );
}

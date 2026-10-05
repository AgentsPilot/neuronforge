'use client';

/**
 * Pick a country for an ADDRESS.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The list and the names come from `lib/geo/countries.ts`, which takes them from
 * `react-phone-number-input` — the package this app already uses for phone
 * prefixes. Nothing about the list is written by hand.
 *
 * The CONTROL comes from `SearchableDropdown`, shared with the state picker that
 * sits beside it on the same form. Those two were a custom dropdown and a bare
 * `<select>` until they were made one component: different heights, different
 * behaviour, and only one of them searchable.
 *
 * NOT the same thing as `crm/SearchableCountrySelect` or
 * `website/blocks/WebsiteCountrySelect`, which are phone-number controls: their
 * trigger shows a dialling code, and for an address the country name is the
 * answer.
 *
 * STORES AN ISO CODE. Rendering it back as a name is `countryName()`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useMemo } from 'react';

import { SearchableDropdown, type DropdownOption } from '@/components/ui/SearchableDropdown';
import { countryOptions, countryName, type CountryLocale } from '@/lib/geo/countries';

interface CountrySelectProps {
  /** The stored value. An ISO code, or legacy free text, or nothing. */
  value?: string | null;
  onChange: (code: string) => void;
  locale?: CountryLocale;
  isRTL?: boolean;
  placeholder?: string;
  emptyLabel?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** The flag emoji for a code, built from regional indicator letters. */
function flagOf(code: string): string {
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
}

export function CountrySelect({
  value,
  onChange,
  locale = 'en',
  isRTL = false,
  placeholder,
  emptyLabel,
  className,
  style,
}: CountrySelectProps) {
  const options: DropdownOption[] = useMemo(
    () =>
      countryOptions(locale).map(country => ({
        value: country.code,
        label: country.name,
        hint: country.code,
        icon: flagOf(country.code),
      })),
    [locale]
  );

  /*
   * What the trigger shows when the stored value is not a code.
   *
   * `countryName` passes anything it does not recognise straight through, so a
   * business whose row still holds the typed "Israel" sees "Israel" rather than
   * an empty box that looks like their settings were lost. Picking from the list
   * is what replaces it with a code.
   */
  const fallbackLabel = countryName(value, locale);

  return (
    <SearchableDropdown
      value={value}
      onChange={onChange}
      options={options}
      placeholder={placeholder}
      emptyLabel={emptyLabel}
      isRTL={isRTL}
      fallbackLabel={fallbackLabel}
      className={className}
      style={style}
    />
  );
}

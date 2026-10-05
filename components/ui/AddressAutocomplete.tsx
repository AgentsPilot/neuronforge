'use client';

/**
 * Type the start of an address; the fields below fill themselves in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE LINE INSTEAD OF SIX. An owner types "Herzl 12", picks their address, and
 * street, city, postcode, state and country are set together — correctly spelt,
 * with the country already an ISO code and the state already matching an option
 * in its dropdown.
 *
 * ON TOP OF THE MANUAL FIELDS, NEVER INSTEAD OF THEM. The fields stay visible
 * and editable underneath: addresses Google does not know exist, a unit number
 * it omits, a business that would rather type it. This renders nothing at all
 * when no API key is configured, and the form is exactly as it was.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { useEffect, useRef, useState } from 'react';
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react';
import { Loader2, MapPin } from 'lucide-react';

import {
  fetchAddressSuggestions,
  isPlacesConfigured,
  resolveSuggestion,
  type AddressSuggestion,
} from '@/lib/geo/placesAutocomplete';
import type { StructuredAddress } from '@/lib/geo/address';

interface AddressAutocompleteProps {
  /** Applied wholesale when a suggestion is chosen. */
  onSelect: (address: StructuredAddress) => void;
  /** Biases results towards the country already chosen, when there is one. */
  country?: string | null;
  language?: string;
  isRTL?: boolean;
  placeholder?: string;
  hint?: string;
  className?: string;
  style?: React.CSSProperties;
}

export function AddressAutocomplete({
  onSelect,
  country,
  language = 'en',
  isRTL = false,
  placeholder,
  hint,
  className,
  style,
}: AddressAutocompleteProps) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [busy, setBusy] = useState(false);

  /*
   * Which request is still wanted.
   *
   * Keystrokes outrun the network, so a slow response for "Herz" can land after
   * a fast one for "Herzl 12" and replace the better list with a worse one.
   * Only the newest request is allowed to write.
   */
  const latest = useRef(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) {
      setSuggestions([]);
      return;
    }

    /*
     * Debounced, because Google bills per session and a session is only cheap
     * if the keystrokes inside it are not each a request. 250ms is below what
     * reads as lag and well above a fast typist's gap between letters.
     */
    const ticket = ++latest.current;
    setBusy(true);

    const timer = setTimeout(() => {
      fetchAddressSuggestions(text, { language, country })
        .then(results => {
          if (ticket === latest.current) setSuggestions(results);
        })
        .finally(() => {
          if (ticket === latest.current) setBusy(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [query, language, country]);

  // No key configured: the manual fields below are the whole form, as before.
  if (!isPlacesConfigured()) return null;

  return (
    <Combobox
      value={null}
      onChange={async (suggestion: AddressSuggestion | null) => {
        if (!suggestion) return;

        setBusy(true);
        const address = await resolveSuggestion(suggestion.id, language);
        setBusy(false);

        if (address) {
          onSelect(address);
          /*
           * Cleared, not left showing the chosen line.
           *
           * The answer is now spread across the fields below, which are the real
           * record. Leaving the text here would read as a seventh address field
           * that is not saved anywhere.
           */
          setQuery('');
          setSuggestions([]);
        }
      }}
      immediate
    >
      <div className="relative">
        <div className="relative">
          <MapPin
            className={`absolute ${isRTL ? 'right-3' : 'left-3'} top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--v2-text-muted)]`}
          />
          <ComboboxInput
            className={`${
              className ??
              'w-full border border-[var(--v2-border)] bg-[var(--v2-surface)] py-2 text-sm text-[var(--v2-text-primary)] transition-colors placeholder:text-[var(--v2-text-muted)] hover:border-[var(--v2-primary)] focus:border-[var(--v2-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]'
            } ${isRTL ? 'pr-10 pl-9' : 'pl-10 pr-9'}`}
            style={style ?? { borderRadius: 'var(--v2-radius-button)' }}
            placeholder={placeholder}
            value={query}
            dir="auto"
            onChange={event => setQuery(event.target.value)}
            displayValue={() => query}
          />
          {busy && (
            <Loader2
              className={`absolute ${isRTL ? 'left-3' : 'right-3'} top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-[var(--v2-text-muted)]`}
            />
          )}
        </div>

        {suggestions.length > 0 && (
          <ComboboxOptions
            anchor="bottom start"
            dir={isRTL ? 'rtl' : 'ltr'}
            className="z-[9999] max-h-[280px] w-[var(--input-width)] overflow-y-auto border border-[var(--v2-border)] bg-[var(--v2-surface)] shadow-lg [--anchor-gap:4px]"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {suggestions.map(suggestion => (
              <ComboboxOption
                key={suggestion.id}
                value={suggestion}
                className="flex w-full cursor-pointer items-start gap-2 px-3 py-2 text-start text-sm text-[var(--v2-text-primary)] transition-colors data-[focus]:bg-[var(--v2-primary)]/10"
              >
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--v2-text-muted)]" />
                <bdi>{suggestion.text}</bdi>
              </ComboboxOption>
            ))}
          </ComboboxOptions>
        )}
      </div>

      {hint && (
        <p className="mt-1 text-[11px] leading-snug text-[var(--v2-text-muted)]">{hint}</p>
      )}
    </Combobox>
  );
}

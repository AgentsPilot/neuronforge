'use client';

import { useState, useRef, useEffect } from 'react';
import { getCountries, getCountryCallingCode } from 'react-phone-number-input';
import en from 'react-phone-number-input/locale/en';
import type { Country } from 'react-phone-number-input';
import { ChevronDown, Search } from 'lucide-react';

interface SearchableCountrySelectProps {
  value?: Country;
  onChange: (country: Country) => void;
  labels: Record<Country, string>;
}

export function SearchableCountrySelect({ value, onChange, labels }: SearchableCountrySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get current document direction for RTL support
  const isRTL = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

  const countries = getCountries();

  // Filter countries by search term (name, ISO code, or calling code)
  const filteredCountries = countries.filter(country => {
    if (!search) return true;

    const searchLower = search.toLowerCase();
    const countryName = (labels[country] || en[country] || '').toLowerCase();
    const countryCode = country.toLowerCase();
    const callingCode = getCountryCallingCode(country);

    return (
      countryName.includes(searchLower) ||
      countryCode.includes(searchLower) ||
      callingCode.includes(searchLower) ||
      `+${callingCode}`.includes(searchLower)
    );
  });

  // Auto-focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isOpen]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      setSearch('');
    }
  };

  const handleCountrySelect = (country: Country) => {
    onChange(country);
    setIsOpen(false);
    setSearch('');
  };

  const selectedCallingCode = value ? getCountryCallingCode(value) : '';

  return (
    <div className="relative" ref={dropdownRef} dir="ltr">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 min-w-[100px] bg-[var(--v2-surface)] border border-[var(--v2-border)] hover:border-[#8B5CF6] transition-colors text-sm"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        {value && (
          <span className="text-lg leading-none">
            {String.fromCodePoint(...[...value.toUpperCase()].map(c => 127397 + c.charCodeAt(0)))}
          </span>
        )}
        <span className="text-[var(--v2-text-primary)] font-medium">
          {value ? `+${selectedCallingCode}` : 'Country'}
        </span>
        <ChevronDown className={`h-3 w-3 text-[var(--v2-text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className={`absolute ${isRTL ? 'end-0' : 'start-0'} top-full mt-1 w-[320px] bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg z-[9999] max-h-[400px] flex flex-col`}
          style={{ borderRadius: 'var(--v2-radius-card)' }}
          dir={isRTL ? 'rtl' : 'ltr'}
          onKeyDown={handleKeyDown}
        >
          {/* Search Input */}
          <div className="p-2 border-b border-[var(--v2-border)] sticky top-0 bg-[var(--v2-surface)]">
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--v2-text-muted)]" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search countries or codes..."
                className="w-full ps-9 pe-3 py-2 text-sm bg-[var(--v2-bg)] border border-[var(--v2-border)] text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:border-[#8B5CF6] focus:ring-1 focus:ring-[#8B5CF6]"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              />
            </div>
          </div>

          {/* Country List */}
          <div className="overflow-y-auto flex-1">
            {filteredCountries.length > 0 ? (
              filteredCountries.map(country => {
                const callingCode = getCountryCallingCode(country);
                const isSelected = value === country;

                return (
                  <button
                    key={country}
                    type="button"
                    onClick={() => handleCountrySelect(country)}
                    className={`w-full px-3 py-2 flex items-center gap-3 text-start transition-colors ${
                      isSelected
                        ? 'bg-[#8B5CF6]/20 text-[var(--v2-text-primary)] font-medium'
                        : 'hover:bg-[#8B5CF6]/10 text-[var(--v2-text-primary)]'
                    }`}
                  >
                    <span className="text-lg leading-none">
                      {String.fromCodePoint(...[...country.toUpperCase()].map(c => 127397 + c.charCodeAt(0)))}
                    </span>
                    <span className="flex-1 text-sm">{labels[country] || en[country]}</span>
                    <span className="text-xs font-mono text-[var(--v2-text-muted)] bg-[var(--v2-bg)] px-2 py-0.5 rounded">
                      {country}
                    </span>
                    <span className="text-sm text-[var(--v2-text-secondary)] min-w-[48px] text-end">
                      +{callingCode}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-8 text-center text-sm text-[var(--v2-text-muted)]">
                No countries found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

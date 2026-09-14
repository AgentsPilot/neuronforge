'use client';

import { useState, useRef, useEffect } from 'react';
import { getCountries, getCountryCallingCode } from 'react-phone-number-input';
import en from 'react-phone-number-input/locale/en';
import type { Country } from 'react-phone-number-input';
import { ChevronDown, Search } from 'lucide-react';

interface WebsiteCountrySelectProps {
  value?: Country;
  onChange: (country: Country) => void;
  isRTL?: boolean;
  hasError?: boolean;
}

export function WebsiteCountrySelect({ value, onChange, isRTL = false, hasError = false }: WebsiteCountrySelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const countries = getCountries();

  // Filter countries by search term (name, ISO code, or calling code)
  const filteredCountries = countries.filter(country => {
    if (!search) return true;

    const searchLower = search.toLowerCase();
    const countryName = (en[country] || '').toLowerCase();
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

  // Get flag emoji from country code
  const getFlagEmoji = (countryCode: string) => {
    return String.fromCodePoint(...[...countryCode.toUpperCase()].map(c => 127397 + c.charCodeAt(0)));
  };

  return (
    <div className="relative" ref={dropdownRef} dir="ltr">
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-2 px-3 py-2.5 min-w-[110px] ap-card-2 border rounded-lg transition-all text-sm ${
          hasError
            ? 'border-red-500'
            : isOpen
              ? 'border-blue-500 ring-2 ring-blue-200'
              : 'ap-line ap-hover-line'
        }`}
        style={{ minHeight: '42px' }}
      >
        {value && (
          <span className="text-xl leading-none">
            {getFlagEmoji(value)}
          </span>
        )}
        <span className="ap-ink font-medium">
          {value ? `+${selectedCallingCode}` : 'Country'}
        </span>
        <ChevronDown className={`h-4 w-4 ap-ink-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div
          className="absolute start-0 top-full mt-1 w-[300px] ap-card border ap-line shadow-xl rounded-xl z-[9999] max-h-[350px] flex flex-col overflow-hidden"
          dir="ltr"
          onKeyDown={handleKeyDown}
        >
          {/* Search Input */}
          <div className="p-3 border-b ap-line sticky top-0 ap-card">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ap-ink-3" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search countries..."
                className="w-full pl-10 pr-3 py-2 text-sm ap-card-2 border ap-line rounded-lg ap-ink ap-placeholder focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
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
                    className={`w-full px-3 py-2.5 flex items-center gap-3 text-left transition-colors ${
                      isSelected
                        ? 'bg-blue-50 ap-ink font-medium'
                        : 'ap-hover ap-ink-2'
                    }`}
                  >
                    <span className="text-xl leading-none">
                      {getFlagEmoji(country)}
                    </span>
                    <span className="flex-1 text-sm truncate">{en[country]}</span>
                    <span className="text-xs font-mono ap-ink-3 ap-card-2 px-1.5 py-0.5 rounded">
                      {country}
                    </span>
                    <span className="text-sm ap-ink-3 font-medium min-w-[50px] text-right">
                      +{callingCode}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-8 text-center text-sm ap-ink-3">
                No countries found
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

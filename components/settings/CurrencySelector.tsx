// components/settings/CurrencySelector.tsx
// Currency selector component for user preferences

'use client'

import React, { useState, useEffect } from 'react'
import { Globe, Check, Search } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { createCurrencyService, ExchangeRate } from '@/lib/services/CurrencyService'
import { getCurrenciesByRegion, getPopularCurrencies } from '@/lib/utils/currencyHelpers'

interface CurrencySelectorProps {
  userId: string
  currentCurrency?: string
  onCurrencyChange?: (currency: string) => void
}

export default function CurrencySelector({
  userId,
  currentCurrency = 'USD',
  onCurrencyChange
}: CurrencySelectorProps) {
  const [selectedCurrency, setSelectedCurrency] = useState(currentCurrency)
  const [availableRates, setAvailableRates] = useState<ExchangeRate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)

  useEffect(() => {
    loadAvailableCurrencies()
  }, [])

  // Sync selectedCurrency with currentCurrency prop when it changes (only on mount or actual prop change)
  useEffect(() => {
    if (currentCurrency && currentCurrency !== selectedCurrency) {
      console.log('🔄 Syncing currency selector to prop:', currentCurrency)
      setSelectedCurrency(currentCurrency)
    }
  }, [currentCurrency]) // Only when prop actually changes, not when selectedCurrency changes

  const loadAvailableCurrencies = async () => {
    try {
      setLoading(true)
      const currencyService = createCurrencyService(supabase)
      // Fetch all currencies since we use live rates
      const rates = await currencyService.getAllRates()
      setAvailableRates(rates)
    } catch (error) {
      console.error('Error loading currencies:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleCurrencySelect = async (currencyCode: string) => {
    try {
      setSaving(true)
      const currencyService = createCurrencyService(supabase)
      await currencyService.setUserCurrency(userId, currencyCode)

      setSelectedCurrency(currencyCode)
      setShowDropdown(false)

      // Dispatch event to notify other components (e.g., BillingSettings)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('currencyChanged', { detail: { currency: currencyCode } }))
      }

      if (onCurrencyChange) {
        onCurrencyChange(currencyCode)
      }
    } catch (error) {
      console.error('Error updating currency:', error)
      alert('Failed to update currency preference')
    } finally {
      setSaving(false)
    }
  }

  const filteredRates = availableRates.filter(rate => {
    if (!searchQuery) return true
    const query = searchQuery.toLowerCase()
    return (
      rate.currency_code.toLowerCase().includes(query) ||
      rate.currency_name.toLowerCase().includes(query)
    )
  })

  const popularCurrencies = getPopularCurrencies()
  const popularRates = filteredRates.filter(rate =>
    popularCurrencies.includes(rate.currency_code)
  )
  const currencyGroups = getCurrenciesByRegion()

  const selectedRate = availableRates.find(r => r.currency_code === selectedCurrency)

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-lg w-48"></div>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Selected Currency Display */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all duration-200 focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
      >
        <Globe className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
        <div className="flex-1 text-left">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-[var(--v2-text-primary)]">
              {selectedRate?.currency_symbol || '$'}
            </span>
            <span className="text-[var(--v2-text-primary)]">
              {selectedCurrency}
            </span>
          </div>
          <div className="text-xs text-[var(--v2-text-secondary)]">
            {selectedRate?.currency_name || 'US Dollar'}
          </div>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-[var(--v2-text-muted)] transition-transform ${showDropdown ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {showDropdown && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowDropdown(false)}
          />

          {/* Dropdown Panel */}
          <div className="absolute top-full left-0 mt-2 w-[400px] bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-[var(--v2-shadow-card)] z-20 max-h-[500px] overflow-hidden flex flex-col" style={{ borderRadius: 'var(--v2-radius-card)' }}>
            {/* Search */}
            <div className="p-3 border-b border-gray-200 dark:border-gray-700">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-[var(--v2-text-muted)]" />
                <input
                  type="text"
                  placeholder="Search currencies..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-700 bg-[var(--v2-surface)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] text-sm focus:outline-none focus:ring-1 focus:ring-[var(--v2-primary)]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                />
              </div>
            </div>

            {/* Currency List */}
            <div className="overflow-y-auto flex-1">
              {/* Popular Currencies */}
              {!searchQuery && popularRates.length > 0 && (
                <div className="p-2">
                  <div className="px-3 py-2 text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                    Popular
                  </div>
                  {popularRates.map((rate) => (
                    <CurrencyOption
                      key={rate.currency_code}
                      rate={rate}
                      isSelected={rate.currency_code === selectedCurrency}
                      onSelect={handleCurrencySelect}
                      disabled={saving}
                    />
                  ))}
                </div>
              )}

              {/* All Currencies (grouped or flat based on search) */}
              {searchQuery ? (
                <div className="p-2">
                  {filteredRates.length === 0 ? (
                    <div className="px-3 py-8 text-center text-[var(--v2-text-muted)] text-sm">
                      No currencies found matching "{searchQuery}"
                    </div>
                  ) : (
                    filteredRates.map((rate) => (
                      <CurrencyOption
                        key={rate.currency_code}
                        rate={rate}
                        isSelected={rate.currency_code === selectedCurrency}
                        onSelect={handleCurrencySelect}
                        disabled={saving}
                      />
                    ))
                  )}
                </div>
              ) : (
                <div className="p-2 space-y-3">
                  {currencyGroups.map((group) => {
                    const groupRates = filteredRates.filter(rate =>
                      group.currencies.includes(rate.currency_code)
                    )

                    if (groupRates.length === 0) return null

                    return (
                      <div key={group.region}>
                        <div className="px-3 py-2 text-xs font-semibold text-[var(--v2-text-muted)] uppercase tracking-wider">
                          {group.region}
                        </div>
                        {groupRates.map((rate) => (
                          <CurrencyOption
                            key={rate.currency_code}
                            rate={rate}
                            isSelected={rate.currency_code === selectedCurrency}
                            onSelect={handleCurrencySelect}
                            disabled={saving}
                          />
                        ))}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer Info */}
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-[var(--v2-bg)]">
              <div className="flex items-start gap-2 text-xs text-[var(--v2-text-secondary)]">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse mt-1 flex-shrink-0"></div>
                <div>
                  <div className="font-medium text-[var(--v2-text-primary)]">Currency Calculator</div>
                  <div className="mt-1">
                    All charges are in USD. This preference shows you the equivalent amount in your local currency using live exchange rates.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// Currency Option Component
interface CurrencyOptionProps {
  rate: ExchangeRate
  isSelected: boolean
  onSelect: (currencyCode: string) => void
  disabled: boolean
}

function CurrencyOption({ rate, isSelected, onSelect, disabled }: CurrencyOptionProps) {
  return (
    <button
      onClick={() => onSelect(rate.currency_code)}
      disabled={disabled}
      className={`w-full flex items-center justify-between px-3 py-2.5 transition-all duration-150 border ${
        isSelected
          ? 'bg-[var(--v2-bg)] border-[var(--v2-primary)]'
          : 'hover:bg-[var(--v2-bg)] border-transparent'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      style={{ borderRadius: 'var(--v2-radius-button)' }}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 flex items-center justify-center font-semibold text-sm ${
          isSelected ? 'bg-gradient-to-br from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white' : 'bg-[var(--v2-bg)] text-[var(--v2-text-primary)]'
        }`} style={{ borderRadius: 'var(--v2-radius-button)' }}>
          {rate.currency_symbol}
        </div>
        <div className="text-left">
          <div className="font-medium text-[var(--v2-text-primary)] text-sm">
            {rate.currency_code}
          </div>
          <div className="text-xs text-[var(--v2-text-secondary)]">
            {rate.currency_name}
          </div>
        </div>
      </div>
      {isSelected && (
        <Check className="w-5 h-5 text-[var(--v2-primary)]" />
      )}
    </button>
  )
}

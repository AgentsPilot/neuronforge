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
        <div className="h-10 bg-gray-200 rounded-lg w-48"></div>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Selected Currency Display */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-3 px-4 py-2.5 bg-white border border-gray-300 rounded-lg hover:border-indigo-500 transition-all duration-200 min-w-[200px]"
      >
        <Globe className="w-5 h-5 text-indigo-600" />
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900">
              {selectedRate?.currency_symbol || '$'}
            </span>
            <span className="text-gray-900">
              {selectedCurrency}
            </span>
          </div>
          <div className="text-xs text-gray-500">
            {selectedRate?.currency_name || 'US Dollar'}
          </div>
        </div>
        <svg
          className={`w-4 h-4 text-gray-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`}
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
          <div className="absolute top-full left-0 mt-2 w-[400px] bg-white border border-gray-200 rounded-xl shadow-2xl z-20 max-h-[500px] overflow-hidden flex flex-col">
            {/* Search */}
            <div className="p-3 border-b border-gray-200">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search currencies..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>

            {/* Currency List */}
            <div className="overflow-y-auto flex-1">
              {/* Popular Currencies */}
              {!searchQuery && popularRates.length > 0 && (
                <div className="p-2">
                  <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
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
                    <div className="px-3 py-8 text-center text-gray-500 text-sm">
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
                        <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
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
            <div className="p-3 border-t border-gray-200 bg-gradient-to-r from-amber-50 to-orange-50">
              <div className="flex items-start gap-2 text-xs text-gray-600">
                <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse mt-1 flex-shrink-0"></div>
                <div>
                  <div className="font-medium text-gray-700">Currency Calculator</div>
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
      className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-150 ${
        isSelected
          ? 'bg-indigo-50 border border-indigo-200'
          : 'hover:bg-gray-50 border border-transparent'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-sm ${
          isSelected ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700'
        }`}>
          {rate.currency_symbol}
        </div>
        <div className="text-left">
          <div className="font-medium text-gray-900 text-sm">
            {rate.currency_code}
          </div>
          <div className="text-xs text-gray-500">
            {rate.currency_name}
          </div>
        </div>
      </div>
      {isSelected && (
        <Check className="w-5 h-5 text-indigo-600" />
      )}
    </button>
  )
}

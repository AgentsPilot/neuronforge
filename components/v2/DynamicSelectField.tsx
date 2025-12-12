'use client'

import { useState, useEffect, useCallback, Fragment } from 'react'
import { Combobox, Transition } from '@headlessui/react'
import { Check, ChevronDown, Loader2, RefreshCw, AlertCircle, Hash, Mail, FileText, Table, MessageSquare, Users, Folder } from 'lucide-react'

interface OptionItem {
  value: string
  label: string
  description?: string
  icon?: string
  group?: string
}

interface DynamicSelectFieldProps {
  plugin: string
  action: string
  parameter: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  dependentValues?: Record<string, any> // Values of parameters this field depends on
}

export function DynamicSelectField({
  plugin,
  action,
  parameter,
  value,
  onChange,
  required = false,
  placeholder = 'Select an option...',
  className = '',
  style = {},
  dependentValues = {}
}: DynamicSelectFieldProps) {
  const [options, setOptions] = useState<OptionItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [cached, setCached] = useState(false)

  // Helper function to render icon based on emoji or use lucide icon
  const renderIcon = (iconEmoji: string | undefined, active: boolean) => {
    if (!iconEmoji) return null

    const iconClass = `w-4 h-4 flex-shrink-0 ${active ? 'text-white' : 'text-[var(--v2-primary)]'}`

    // Map common emojis to lucide icons
    const emojiToIcon: Record<string, React.ReactNode> = {
      '#️⃣': <Hash className={iconClass} />,
      '📧': <Mail className={iconClass} />,
      '📄': <FileText className={iconClass} />,
      '📊': <Table className={iconClass} />,
      '💬': <MessageSquare className={iconClass} />,
      '👥': <Users className={iconClass} />,
      '📁': <Folder className={iconClass} />,
    }

    // Return lucide icon if we have a mapping, otherwise return the emoji
    return emojiToIcon[iconEmoji] || <span className="text-base flex-shrink-0">{iconEmoji}</span>
  }

  // Fetch options from API
  const fetchOptions = useCallback(async (refresh: boolean = false) => {
    setLoading(true)
    setError(null)

    try {
      console.log('[DynamicSelectField] Fetching options with:', { plugin, action, parameter, refresh, dependentValues })

      const response = await fetch('/api/plugins/fetch-options', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          plugin,
          action,
          parameter,
          refresh,
          page: 1,
          limit: 100,
          dependentValues, // Pass dependent parameter values
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to fetch options')
      }

      const data = await response.json()
      setOptions(data.options || [])
      setCached(data.cached || false)
    } catch (err: any) {
      console.error('[DynamicSelectField] Error fetching options:', err)
      setError(err.message || 'Failed to load options')
      setOptions([])
    } finally {
      setLoading(false)
    }
  }, [plugin, action, parameter, dependentValues])

  // Fetch options on mount and when dependent values change
  useEffect(() => {
    console.log('[DynamicSelectField] useEffect triggered, dependentValues:', dependentValues)
    fetchOptions()
  }, [fetchOptions]) // fetchOptions already includes dependentValues in its deps

  // Filter options based on search query
  const filteredOptions = query === ''
    ? options
    : options.filter((option) =>
        option.label.toLowerCase().includes(query.toLowerCase()) ||
        option.description?.toLowerCase().includes(query.toLowerCase())
      )

  // Group options by group field
  const groupedOptions: Record<string, OptionItem[]> = {}
  filteredOptions.forEach((option) => {
    const group = option.group || 'Options'
    if (!groupedOptions[group]) {
      groupedOptions[group] = []
    }
    groupedOptions[group].push(option)
  })

  // Find selected option
  const selectedOption = options.find((opt) => opt.value === value)

  return (
    <div className="relative">
      <Combobox value={value} onChange={onChange}>
        <div className="relative">
          <div className="relative w-full">
            <Combobox.Input
              className={`w-full px-3 py-2 pr-20 border text-sm focus:outline-none focus:ring-1 bg-[var(--v2-surface)] border-[var(--v2-border)] focus:ring-[var(--v2-primary)] focus:border-[var(--v2-primary)] text-[var(--v2-text-primary)] placeholder-[var(--v2-text-muted)] ${className}`}
              style={style}
              displayValue={() => selectedOption ? selectedOption.label : ''}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
              required={required}
            />

            <div className="absolute inset-y-0 right-0 flex items-center pr-2 gap-1">
              {/* Refresh Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  fetchOptions(true)
                }}
                disabled={loading}
                className="p-1 hover:bg-[var(--v2-surface-hover)] rounded transition-colors disabled:opacity-50"
                title={cached ? 'Refresh (cached data)' : 'Refresh'}
              >
                <RefreshCw className={`w-4 h-4 text-[var(--v2-text-muted)] ${loading ? 'animate-spin' : ''}`} />
              </button>

              {/* Dropdown Button */}
              <Combobox.Button className="p-1 hover:bg-[var(--v2-surface-hover)] rounded transition-colors">
                {loading ? (
                  <Loader2 className="w-4 h-4 text-[var(--v2-text-muted)] animate-spin" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[var(--v2-text-muted)]" />
                )}
              </Combobox.Button>
            </div>
          </div>

          <Transition
            as={Fragment}
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
            afterLeave={() => setQuery('')}
          >
            <Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-lg focus:outline-none text-sm" style={{ borderRadius: 'var(--v2-radius-button)' }}>
              {error ? (
                <div className="px-3 py-2 text-[var(--v2-text-muted)] flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500" />
                  <span>{error}</span>
                </div>
              ) : filteredOptions.length === 0 && query !== '' ? (
                <div className="px-3 py-2 text-[var(--v2-text-muted)]">
                  No results found for "{query}"
                </div>
              ) : filteredOptions.length === 0 ? (
                <div className="px-3 py-2 text-[var(--v2-text-muted)]">
                  No options available
                </div>
              ) : (
                Object.entries(groupedOptions).map(([groupName, groupOptions]) => (
                  <div key={groupName}>
                    {/* Group Header */}
                    {Object.keys(groupedOptions).length > 1 && (
                      <div className="px-3 py-1.5 text-xs font-semibold text-[var(--v2-text-muted)] bg-[var(--v2-surface-hover)] sticky top-0">
                        {groupName}
                      </div>
                    )}

                    {/* Group Options */}
                    {groupOptions.map((option) => (
                      <Combobox.Option
                        key={option.value}
                        value={option.value}
                        className={({ active }) =>
                          `cursor-pointer select-none px-3 py-2 ${
                            active
                              ? 'bg-[var(--v2-primary)] text-white'
                              : 'text-[var(--v2-text-primary)]'
                          }`
                        }
                      >
                        {({ selected, active }) => (
                          <div className="flex items-center gap-2">
                            {/* Icon - Using v2 theme design */}
                            {renderIcon(option.icon, active)}

                            {/* Label and Description */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className={`block truncate ${selected ? 'font-semibold' : 'font-normal'}`}>
                                  {option.label}
                                </span>
                              </div>
                              {option.description && (
                                <p className={`text-xs truncate ${active ? 'text-white/80' : 'text-[var(--v2-text-muted)]'}`}>
                                  {option.description}
                                </p>
                              )}
                            </div>

                            {/* Checkmark */}
                            {selected && (
                              <Check className="w-4 h-4 flex-shrink-0" />
                            )}
                          </div>
                        )}
                      </Combobox.Option>
                    ))}
                  </div>
                ))
              )}
            </Combobox.Options>
          </Transition>
        </div>
      </Combobox>

      {/* Cached indicator */}
      {cached && !loading && !error && (
        <p className="text-xs text-[var(--v2-text-muted)] mt-1">
          Cached data - click refresh to update
        </p>
      )}
    </div>
  )
}

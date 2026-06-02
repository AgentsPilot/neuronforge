'use client'

import React from 'react'

interface AdvancedToggleProps {
  enabled: boolean
  onChange: (enabled: boolean) => void
}

export function AdvancedToggle({ enabled, onChange }: AdvancedToggleProps) {
  const handleToggle = () => {
    const newValue = !enabled
    onChange(newValue)
    // Persist to localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('analytics-advanced-mode', String(newValue))
    }
  }

  return (
    <button
      onClick={handleToggle}
      className="flex items-center gap-3 px-3 sm:px-4 py-2 rounded-lg bg-[var(--v2-surface)] border border-[var(--v2-border)] text-sm hover:bg-[var(--v2-surface-hover)] transition-colors"
      aria-label="Toggle advanced mode"
    >
      <span className="text-[var(--v2-text-primary)] font-medium whitespace-nowrap">
        Show Advanced Metrics
      </span>
      <div
        className={`relative w-10 h-6 rounded-full transition-colors ${
          enabled ? 'bg-[var(--v2-primary)]' : 'bg-gray-300 dark:bg-gray-600'
        }`}
      >
        <div
          className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
            enabled ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </div>
    </button>
  )
}

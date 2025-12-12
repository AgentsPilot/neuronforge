// components/v2/DarkModeToggle.tsx
// Dark mode toggle button for V2 design system

'use client'

import React, { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useV2Theme } from '@/lib/design-system-v2/theme-provider'

export function DarkModeToggle() {
  const { mode, toggleMode } = useV2Theme()
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={toggleMode}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 shadow-[var(--v2-shadow-card)]"
        style={{ borderRadius: 'var(--v2-radius-button)' }}
        aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {mode === 'dark' ? (
          <Sun className="w-4 h-4" />
        ) : (
          <Moon className="w-4 h-4" />
        )}
      </button>

      {/* Tooltip */}
      {isHovered && (
        <div
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 text-xs whitespace-nowrap pointer-events-none animate-fade-in"
          style={{
            backgroundColor: 'var(--v2-surface)',
            border: '1px solid var(--v2-border)',
            color: 'var(--v2-text-primary)',
            borderRadius: 'var(--v2-radius-button)',
            boxShadow: 'var(--v2-shadow-card)',
            zIndex: 1000
          }}
        >
          {mode === 'dark' ? 'Light Mode' : 'Dark Mode'}
          <div
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: '100%',
              width: 0,
              height: 0,
              borderLeft: '4px solid transparent',
              borderRight: '4px solid transparent',
              borderTop: '4px solid var(--v2-border)'
            }}
          ></div>
        </div>
      )}
    </div>
  )
}

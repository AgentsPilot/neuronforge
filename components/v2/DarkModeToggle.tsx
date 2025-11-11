// components/v2/DarkModeToggle.tsx
// Dark mode toggle button for V2 design system

'use client'

import React from 'react'
import { Moon, Sun } from 'lucide-react'
import { useV2Theme } from '@/lib/design-system-v2/theme-provider'

export function DarkModeToggle() {
  const { mode, toggleMode } = useV2Theme()

  return (
    <button
      onClick={toggleMode}
      className="flex items-center justify-center w-10 h-10 bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 shadow-[var(--v2-shadow-card)]"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {mode === 'dark' ? (
        <Sun className="w-4 h-4" />
      ) : (
        <Moon className="w-4 h-4" />
      )}
    </button>
  )
}

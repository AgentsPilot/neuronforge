'use client'

import React from 'react'
import { Sparkles, HelpCircle, MessageCircle, LifeBuoy, Info, Zap } from 'lucide-react'

/**
 * Help Button Design Options
 * Copy the preferred option to V2Header.tsx
 */

// OPTION 1: Segmented with divider (current)
export function HelpButton_Option1({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-3.5 py-2 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:shadow-md hover:scale-[1.02] transition-all duration-200 group border border-transparent hover:border-[var(--v2-primary)]/20"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title="Help & Support (Press ?)"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-[var(--v2-primary)] group-hover:rotate-12 transition-transform duration-200" />
        <span className="text-sm font-semibold text-[var(--v2-text-primary)]">Help</span>
      </div>
      <div className="flex items-center gap-1 ml-1 pl-2 border-l border-gray-200 dark:border-slate-700">
        <kbd className="px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded text-gray-600 dark:text-gray-400 shadow-sm">
          ?
        </kbd>
      </div>
    </button>
  )
}

// OPTION 2: Minimal with floating kbd
export function HelpButton_Option2({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:scale-105 transition-all duration-200 group"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title="Help & Support (Press ?)"
    >
      <Sparkles className="w-4 h-4 text-[var(--v2-primary)]" />
      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">Help</span>
      <kbd className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[8px] font-mono font-bold bg-[var(--v2-primary)] text-white rounded-full shadow-md">
        ?
      </kbd>
    </button>
  )
}

// OPTION 3: Gradient with inline kbd
export function HelpButton_Option3({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 bg-gradient-to-r from-[var(--v2-surface)] to-[var(--v2-surface-hover)] shadow-[var(--v2-shadow-card)] hover:shadow-lg hover:scale-105 transition-all duration-200 group border border-gray-200 dark:border-slate-700"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title="Help & Support (Press ?)"
    >
      <Sparkles className="w-4 h-4 text-[var(--v2-primary)] group-hover:scale-110 transition-transform" />
      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">Help</span>
      <kbd className="ml-1 px-1.5 py-0.5 text-[10px] font-mono bg-white/60 dark:bg-slate-800/60 border border-gray-300 dark:border-slate-600 rounded text-gray-500 dark:text-gray-400">
        ?
      </kbd>
    </button>
  )
}

// OPTION 4: Pill with icon badge
export function HelpButton_Option4({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-4 py-2 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:shadow-md hover:scale-105 transition-all duration-200 group"
      style={{ borderRadius: '999px' }}
      title="Help & Support"
    >
      <div className="relative">
        <MessageCircle className="w-4 h-4 text-[var(--v2-primary)]" />
        <div className="absolute -top-1 -right-1 w-2 h-2 bg-[var(--v2-primary)] rounded-full animate-pulse" />
      </div>
      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">Help</span>
    </button>
  )
}

// OPTION 5: Icon-only with tooltip
export function HelpButton_Option5({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="relative w-9 h-9 flex items-center justify-center bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:shadow-md hover:scale-110 transition-all duration-200 group"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title="Help & Support (Press ?)"
    >
      <LifeBuoy className="w-4 h-4 text-[var(--v2-primary)] group-hover:rotate-180 transition-transform duration-300" />
      <kbd className="absolute -bottom-1 -right-1 w-4 h-4 flex items-center justify-center text-[8px] font-mono font-bold bg-[var(--v2-primary)] text-white rounded-full shadow-md">
        ?
      </kbd>
    </button>
  )
}

// OPTION 6: Compact with stacked kbd
export function HelpButton_Option6({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-3 py-1.5 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:scale-105 transition-all duration-200 group"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title="Help & Support"
    >
      <Sparkles className="w-3.5 h-3.5 text-[var(--v2-primary)]" />
      <div className="flex items-center gap-1">
        <span className="text-[11px] font-semibold text-[var(--v2-text-primary)]">Help</span>
        <kbd className="px-1 py-0 text-[8px] font-mono bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded text-gray-500 dark:text-gray-400">
          ?
        </kbd>
      </div>
    </button>
  )
}

// OPTION 7: Bold with hover glow
export function HelpButton_Option7({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:shadow-[0_0_20px_rgba(var(--v2-primary-rgb),0.3)] hover:scale-105 transition-all duration-200 group border border-gray-200 dark:border-slate-700 hover:border-[var(--v2-primary)]"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title="Help & Support (Press ?)"
    >
      <Zap className="w-4 h-4 text-[var(--v2-primary)] group-hover:animate-pulse" />
      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">Help</span>
      <kbd className="ml-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-[var(--v2-primary)]/10 border border-[var(--v2-primary)]/30 rounded text-[var(--v2-primary)]">
        ?
      </kbd>
    </button>
  )
}

// OPTION 8: Sleek with icon rotation
export function HelpButton_Option8({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 px-3.5 py-2 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:shadow-md hover:scale-[1.02] transition-all duration-200 group"
      style={{ borderRadius: 'var(--v2-radius-button)' }}
      title="Help & Support (Press ?)"
    >
      <HelpCircle className="w-4 h-4 text-[var(--v2-primary)] group-hover:rotate-[360deg] transition-transform duration-500" />
      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">Help</span>
      <div className="flex gap-0.5 ml-1">
        <kbd className="px-1 py-0.5 text-[9px] font-mono bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded text-gray-500 dark:text-gray-400">
          ?
        </kbd>
      </div>
    </button>
  )
}

// Demo component to preview all options
export function HelpButtonPreview() {
  const handleClick = () => console.log('Help clicked')

  return (
    <div className="p-8 space-y-8 bg-gray-50 dark:bg-slate-900">
      <div className="space-y-4">
        <h3 className="text-lg font-bold">Option 1: Segmented with divider</h3>
        <HelpButton_Option1 onClick={handleClick} />
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold">Option 2: Minimal with floating kbd badge</h3>
        <HelpButton_Option2 onClick={handleClick} />
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold">Option 3: Gradient with inline kbd</h3>
        <HelpButton_Option3 onClick={handleClick} />
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold">Option 4: Pill with icon badge</h3>
        <HelpButton_Option4 onClick={handleClick} />
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold">Option 5: Icon-only with badge</h3>
        <HelpButton_Option5 onClick={handleClick} />
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold">Option 6: Compact stacked</h3>
        <HelpButton_Option6 onClick={handleClick} />
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold">Option 7: Bold with glow effect</h3>
        <HelpButton_Option7 onClick={handleClick} />
      </div>

      <div className="space-y-4">
        <h3 className="text-lg font-bold">Option 8: Sleek with rotation</h3>
        <HelpButton_Option8 onClick={handleClick} />
      </div>
    </div>
  )
}

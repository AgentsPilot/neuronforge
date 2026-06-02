'use client'

import React from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { UserMenu } from '@/components/v2/UserMenu'
import { TokenDisplay } from '@/components/v2/TokenDisplay'
import { Sparkles } from 'lucide-react'

interface V2HeaderProps {
  showTokenDisplay?: boolean
  showUserMenu?: boolean
  showLogo?: boolean
  showHelpLink?: boolean
  onHelpClick?: () => void
}

// Logo component - for first line
export function V2Logo() {
  return (
    <Link href="/v2/dashboard" className="group inline-block">
      <Image
        src="/images/AgentPilot_Logo.png"
        alt="AgentsPilots"
        width={120}
        height={120}
        className="group-hover:scale-105 transition-transform duration-200"
        priority
      />
    </Link>
  )
}

// Token and Menu component - for second line with back button
export function V2Controls({
  showTokenDisplay = true,
  showUserMenu = true,
  showHelpLink = false,
  onHelpClick
}: Pick<V2HeaderProps, 'showTokenDisplay' | 'showUserMenu' | 'showHelpLink' | 'onHelpClick'>) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {showHelpLink && onHelpClick && (
        <button
          onClick={onHelpClick}
          className="flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] hover:scale-105 transition-all duration-200 cursor-pointer"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
          title="Help & Support"
        >
          <Sparkles className="w-4 h-4 text-[var(--v2-primary)]" />
          <span className="text-sm font-semibold text-[var(--v2-text-primary)]">Help</span>
          <kbd className="ml-1 px-1.5 py-0.5 text-[10px] font-mono font-semibold bg-gray-100 dark:bg-slate-800 border border-gray-300 dark:border-slate-500 rounded text-gray-700 dark:text-gray-100 shadow-sm">
            ?
          </kbd>
        </button>
      )}
      {showTokenDisplay && <TokenDisplay />}
      {showUserMenu && <UserMenu triggerIcon="settings" />}
    </div>
  )
}

// Full header component (for backward compatibility)
export function V2Header({
  showTokenDisplay = true,
  showUserMenu = true,
  showLogo = true
}: V2HeaderProps) {
  return (
    <div className="space-y-3">
      {/* Row 1: Logo */}
      {showLogo && (
        <div className="flex justify-start">
          <V2Logo />
        </div>
      )}

      {/* Row 2: Token Display & User Menu */}
      <div className="flex items-center justify-end">
        <V2Controls showTokenDisplay={showTokenDisplay} showUserMenu={showUserMenu} />
      </div>
    </div>
  )
}

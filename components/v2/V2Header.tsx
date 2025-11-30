'use client'

import React from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { UserMenu } from '@/components/v2/UserMenu'
import { TokenDisplay } from '@/components/v2/TokenDisplay'

interface V2HeaderProps {
  showTokenDisplay?: boolean
  showUserMenu?: boolean
  showLogo?: boolean
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
  showUserMenu = true
}: Pick<V2HeaderProps, 'showTokenDisplay' | 'showUserMenu'>) {
  return (
    <div className="flex items-center gap-2 sm:gap-3">
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

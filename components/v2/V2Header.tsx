'use client'

import React from 'react'
import { UserMenu } from '@/components/v2/UserMenu'
import { TokenDisplay } from '@/components/v2/TokenDisplay'

interface V2HeaderProps {
  showTokenDisplay?: boolean
  showUserMenu?: boolean
}

export function V2Header({
  showTokenDisplay = true,
  showUserMenu = true
}: V2HeaderProps) {
  if (!showTokenDisplay && !showUserMenu) {
    return null
  }

  return (
    <div className="flex items-center gap-2 sm:gap-3">
      {showTokenDisplay && <TokenDisplay />}
      {showUserMenu && <UserMenu triggerIcon="settings" />}
    </div>
  )
}

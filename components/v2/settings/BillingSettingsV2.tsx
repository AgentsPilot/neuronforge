'use client'

// BillingSettingsV2: V2 wrapper for the existing BillingSettings component
// Reuses all V1 billing logic but with V2 theming applied at the wrapper level

import React from 'react'
import BillingSettings from '@/components/settings/BillingSettings'

export default function BillingSettingsV2() {
  return (
    <div className="billing-v2-wrapper">
      <BillingSettings />
    </div>
  )
}

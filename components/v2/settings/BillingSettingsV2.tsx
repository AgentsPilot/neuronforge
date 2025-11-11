'use client'

// BillingSettingsV2: V2 wrapper for the existing BillingSettings component
// Applies V2 design system styling while preserving all V1 billing logic and functionality

import React from 'react'
import BillingSettings from '@/components/settings/BillingSettings'
import './BillingSettingsV2.css'

export default function BillingSettingsV2() {
  return (
    <div className="billing-v2-wrapper">
      <BillingSettings />
    </div>
  )
}

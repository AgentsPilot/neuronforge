'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { UserMenu } from '@/components/v2/UserMenu'
import BillingSettingsV2 from '@/components/v2/settings/BillingSettingsV2'

export default function V2BillingPage() {
  const router = useRouter()

  return (
    <div className="relative">
      {/* User Menu with Settings Icon */}
      <div className="absolute top-0 right-0 z-10">
        <UserMenu triggerIcon="settings" />
      </div>

      <div className="space-y-4 sm:space-y-5 lg:space-y-6">
        {/* Back Button */}
        <div>
          <button
            onClick={() => router.push('/v2/dashboard')}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
        </div>

        {/* Header */}
        <div className="pr-12 sm:pr-14">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-semibold text-[var(--v2-text-primary)] mb-1 leading-tight">
            Billing
          </h1>
          <p className="text-base sm:text-lg text-[var(--v2-text-secondary)] font-normal">
            Manage your subscription, credits, and invoices
          </p>
        </div>

        {/* Main Content */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-4 sm:p-5 lg:p-6" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <BillingSettingsV2 />
        </div>
      </div>
    </div>
  )
}

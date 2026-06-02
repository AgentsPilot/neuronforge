'use client'

import React, { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { ModernHelpDialog } from '@/components/v2/ModernHelpDialog'
import { AnalyticsDashboard } from '@/components/v2/analytics/AnalyticsDashboard'

export default function V2AnalyticsPage() {
  const router = useRouter()
  const [helpOpen, setHelpOpen] = useState(false)

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Logo */}
      <div className="mb-2">
        <V2Logo />
      </div>

      {/* Top Bar: Back Button + Controls */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <V2Controls
          showHelpLink={true}
          onHelpClick={() => setHelpOpen(true)}
        />
      </div>

      {/* Page Header */}
      <div className="space-y-1">
        <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-[var(--v2-text-primary)]">
          Analytics Dashboard
        </h1>
        <p className="text-sm sm:text-base text-[var(--v2-text-secondary)]">
          Track automation performance, ROI, and business impact
        </p>
      </div>

      {/* Main Analytics Dashboard */}
      <AnalyticsDashboard initialTimeRange="30d" />

      {/* Help Dialog */}
      <ModernHelpDialog
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />
    </div>
  )
}

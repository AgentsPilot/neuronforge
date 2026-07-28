'use client'

/**
 * Business Analytics Dashboard
 *
 * Single-page scrollable dashboard (NO TABS) using V2 theme design system.
 *
 * Grid Layout:
 * - Row 1: AIRecommendations (col-span-12) - AI Business Advisor at the top
 * - Row 2: BusinessHealthScore (col-span-3) | ValueDelivered (col-span-4) | NeedsAttention (col-span-5)
 * - Row 3: ByCategory (col-span-12)
 * - Row 4: YourGoals (col-span-12)
 */

import React, { useState, useCallback } from 'react'
import type { GroupMetrics } from '@/components/v2/analytics/ByCategory'
import { useRouter } from 'next/navigation'
import { ArrowLeft, RefreshCw, ChevronDown } from 'lucide-react'
import { V2Logo, V2Controls } from '@/components/v2/V2Header'
import { ModernHelpDialog } from '@/components/v2/ModernHelpDialog'

// Dashboard components
import { BusinessHealthScore } from '@/components/v2/analytics/BusinessHealthScore'
import { ValueDelivered } from '@/components/v2/analytics/ValueDelivered'
import { NeedsAttention } from '@/components/v2/analytics/NeedsAttention'
import { AIRecommendations } from '@/components/v2/analytics/AIRecommendations'
import { ByCategory } from '@/components/v2/analytics/ByCategory'
import { YourGoals } from '@/components/v2/analytics/YourGoals'
import { CategoryDrilldownDrawer } from '@/components/v2/analytics/CategoryDrilldownDrawer'
import { ManageCategoriesDrawer } from '@/components/v2/analytics/ManageCategoriesDrawer'
import { ManageGoalsDrawer } from '@/components/v2/analytics/ManageGoalsDrawer'

type TimeRange = '7d' | '30d' | '90d' | 'all'

export default function AnalyticsDashboard() {
  const router = useRouter()
  const [helpOpen, setHelpOpen] = useState(false)
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')
  const [refreshKey, setRefreshKey] = useState(0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<GroupMetrics | null>(null)
  const [manageCategoriesOpen, setManageCategoriesOpen] = useState(false)
  const [manageGoalsOpen, setManageGoalsOpen] = useState(false)
  const [showTimeRangeDropdown, setShowTimeRangeDropdown] = useState(false)


  const handleRefresh = useCallback(() => {
    setIsRefreshing(true)
    setRefreshKey(prev => prev + 1)
    // Reset after animation
    setTimeout(() => setIsRefreshing(false), 1000)
  }, [])

  return (
    <div className="space-y-4">
      {/* Platform Header */}
      <div className="mb-2">
        <V2Logo />
      </div>

      {/* Top Bar: Back Button + Controls */}
      <div className="flex items-center justify-between gap-3">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-3 py-2 bg-[var(--v2-surface)] border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
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

      {/* Dashboard Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[var(--v2-text-primary)]">
            Business Analytics
          </h1>
          <p className="text-[var(--v2-text-secondary)] mt-1">
            Here's how your business automations are performing
          </p>
        </div>
      </div>

      {/* Dashboard Grid Layout */}
      <div className="grid grid-cols-12 gap-6" key={refreshKey}>
        {/* Row 1: AI Recommendations (Full Width) - Business Advisor at the top */}
        <AIRecommendations className="col-span-12" />

        {/* Time Range + Refresh Controls (after AI Advisor) */}
        <div className="col-span-12 flex items-center justify-end gap-4">
          {/* Time Range Dropdown */}
          <div className="relative">
            <button
              onClick={() => setShowTimeRangeDropdown(!showTimeRangeDropdown)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] border border-[var(--v2-border)] transition-all"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {timeRange === '7d' && 'Last 7 days'}
              {timeRange === '30d' && 'Last 30 days'}
              {timeRange === '90d' && 'Last 90 days'}
              {timeRange === 'all' && 'All time'}
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showTimeRangeDropdown ? 'rotate-180' : ''}`} />
            </button>

            {showTimeRangeDropdown && (
              <>
                <div
                  className="fixed inset-0 z-[100]"
                  onClick={() => setShowTimeRangeDropdown(false)}
                />
                <div
                  className="absolute right-0 mt-2 w-40 bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-xl z-[101]"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  {[
                    { value: '7d', label: 'Last 7 days' },
                    { value: '30d', label: 'Last 30 days' },
                    { value: '90d', label: 'Last 90 days' },
                    { value: 'all', label: 'All time' }
                  ].map((option) => (
                    <button
                      key={option.value}
                      onClick={() => {
                        setTimeRange(option.value as TimeRange)
                        setShowTimeRangeDropdown(false)
                      }}
                      className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                        timeRange === option.value
                          ? 'bg-[var(--v2-primary)] text-white'
                          : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-hover)]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white text-sm font-medium hover:opacity-90 transition disabled:opacity-50"
            style={{ borderRadius: 'var(--v2-radius-button)' }}
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Row 2: Health Score + Value Delivered + Needs Attention */}
        <BusinessHealthScore className="col-span-12 lg:col-span-3" />
        <ValueDelivered
          className="col-span-12 lg:col-span-4"
          timeRange={timeRange}
        />
        <NeedsAttention className="col-span-12 lg:col-span-5" />

        {/* Row 3: By Category (Full Width) */}
        <ByCategory
          className="col-span-12"
          onCategoryClick={(group) => setSelectedCategory(group)}
          onManageClick={() => setManageCategoriesOpen(true)}
        />

        {/* Row 4: Your Goals (Full Width) */}
        <YourGoals
          className="col-span-12"
          onAddGoalClick={() => setManageGoalsOpen(true)}
        />
      </div>

      {/* Footer */}
      <footer className="mt-8 text-center">
        <p className="text-xs text-[var(--v2-text-muted)]">
          Last updated: Just now • <button className="hover:text-[var(--v2-text-primary)] transition">View detailed reports</button>
        </p>
      </footer>

      {/* Help Dialog */}
      <ModernHelpDialog
        isOpen={helpOpen}
        onClose={() => setHelpOpen(false)}
      />

      {/* Category Drill-down Drawer */}
      <CategoryDrilldownDrawer
        isOpen={selectedCategory !== null}
        onClose={() => setSelectedCategory(null)}
        group={selectedCategory}
      />

      {/* Manage Categories Drawer */}
      <ManageCategoriesDrawer
        isOpen={manageCategoriesOpen}
        onClose={() => setManageCategoriesOpen(false)}
        onCategoriesChanged={() => setRefreshKey(prev => prev + 1)}
      />

      {/* Manage Goals Drawer */}
      <ManageGoalsDrawer
        isOpen={manageGoalsOpen}
        onClose={() => setManageGoalsOpen(false)}
        onGoalsChanged={() => setRefreshKey(prev => prev + 1)}
      />
    </div>
  )
}

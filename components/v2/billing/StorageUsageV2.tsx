'use client'

import React, { useState, useEffect } from 'react'
import { HardDrive, AlertTriangle, Info } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'

interface StorageQuota {
  quotaMB: number
  usedMB: number
  alertThreshold: number
  percentageUsed: number
  remainingMB: number
  isNearLimit: boolean
  isOverLimit: boolean
}

export default function StorageUsageV2() {
  const { user } = useAuth()
  const [storageQuota, setStorageQuota] = useState<StorageQuota | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    loadStorageQuota()
  }, [user])

  const loadStorageQuota = async () => {
    if (!user) return

    try {
      setLoading(true)

      const { data, error } = await supabase
        .from('user_subscriptions')
        .select('storage_quota_mb, storage_used_mb, storage_alert_threshold')
        .eq('user_id', user.id)
        .single()

      if (error || !data) {
        // Default values
        setStorageQuota({
          quotaMB: 1000,
          usedMB: 0,
          alertThreshold: 0.9,
          percentageUsed: 0,
          remainingMB: 1000,
          isNearLimit: false,
          isOverLimit: false,
        })
        return
      }

      const quotaMB = data.storage_quota_mb || 1000
      const usedMB = data.storage_used_mb || 0
      const alertThreshold = data.storage_alert_threshold || 0.9
      const percentageUsed = quotaMB > 0 ? (usedMB / quotaMB) * 100 : 0
      const remainingMB = Math.max(0, quotaMB - usedMB)

      setStorageQuota({
        quotaMB,
        usedMB,
        alertThreshold,
        percentageUsed,
        remainingMB,
        isNearLimit: percentageUsed >= alertThreshold * 100,
        isOverLimit: usedMB >= quotaMB,
      })
    } catch (err) {
      console.error('Failed to load storage quota:', err)
    } finally {
      setLoading(false)
    }
  }

  const formatStorage = (mb: number): string => {
    if (mb >= 1000000) {
      return `${(mb / 1000000).toFixed(1)} TB`
    } else if (mb >= 1000) {
      return `${(mb / 1000).toFixed(1)} GB`
    }
    return `${mb} MB`
  }

  const getProgressColor = () => {
    if (!storageQuota) return 'bg-[var(--v2-primary)]'
    if (storageQuota.isOverLimit) return 'bg-red-500'
    if (storageQuota.isNearLimit) return 'bg-orange-500'
    return 'bg-[var(--v2-primary)]'
  }

  if (loading) {
    return (
      <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-6"
        style={{ borderRadius: 'var(--v2-radius-card)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border-2 border-[var(--v2-primary)] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-[var(--v2-text-secondary)]">Loading storage information...</span>
        </div>
      </div>
    )
  }

  if (!storageQuota) return null

  return (
    <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-6"
      style={{ borderRadius: 'var(--v2-radius-card)' }}>
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 bg-[var(--v2-primary)]/10 rounded-lg">
          <HardDrive className="w-5 h-5 text-[var(--v2-primary)]" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">Storage Usage</h3>
          <p className="text-sm text-[var(--v2-text-muted)]">Monitor your file storage quota</p>
        </div>
      </div>

      {/* Alert Messages */}
      {storageQuota.isOverLimit && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-600 dark:text-red-400">Storage Limit Exceeded</p>
            <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-1">
              You've used {formatStorage(storageQuota.usedMB)} of {formatStorage(storageQuota.quotaMB)}.
              Please delete some files or upgrade your plan.
            </p>
          </div>
        </div>
      )}

      {storageQuota.isNearLimit && !storageQuota.isOverLimit && (
        <div className="mb-4 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg flex items-start gap-2">
          <Info className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-orange-600 dark:text-orange-400">Storage Almost Full</p>
            <p className="text-xs text-orange-600/80 dark:text-orange-400/80 mt-1">
              You're using {storageQuota.percentageUsed.toFixed(1)}% of your storage quota.
              Consider upgrading or cleaning up files.
            </p>
          </div>
        </div>
      )}

      {/* Storage Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <p className="text-xs text-[var(--v2-text-muted)] mb-1">Used</p>
          <p className="text-xl font-bold text-[var(--v2-text-primary)]">
            {formatStorage(storageQuota.usedMB)}
          </p>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <p className="text-xs text-[var(--v2-text-muted)] mb-1">Total Quota</p>
          <p className="text-xl font-bold text-[var(--v2-text-primary)]">
            {formatStorage(storageQuota.quotaMB)}
          </p>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-4">
          <p className="text-xs text-[var(--v2-text-muted)] mb-1">Remaining</p>
          <p className="text-xl font-bold text-[var(--v2-text-primary)]">
            {formatStorage(storageQuota.remainingMB)}
          </p>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--v2-text-secondary)]">Storage Usage</span>
          <span className="font-semibold text-[var(--v2-text-primary)]">
            {storageQuota.percentageUsed.toFixed(1)}%
          </span>
        </div>
        <div className="w-full h-3 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-500 ${getProgressColor()}`}
            style={{ width: `${Math.min(storageQuota.percentageUsed, 100)}%` }}
          />
        </div>
        <p className="text-xs text-[var(--v2-text-muted)]">
          {formatStorage(storageQuota.usedMB)} of {formatStorage(storageQuota.quotaMB)} used
        </p>
      </div>

      {/* Info Note */}
      <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-600 dark:text-blue-400">
            Storage quota is based on your subscription tier. Upgrade your plan to increase your storage limit.
          </p>
        </div>
      </div>
    </div>
  )
}

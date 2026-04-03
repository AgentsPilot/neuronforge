'use client'

import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { getPluginAPIClient } from '@/lib/client/plugin-api-client'

interface PluginRefreshModalProps {
  isOpen: boolean
  onClose: () => void
  pluginKey: string
  pluginName: string
  userId: string
  onRefreshComplete?: () => void
}

type RefreshState = 'idle' | 'loading' | 'success' | 'error'

export function PluginRefreshModal({
  isOpen,
  onClose,
  pluginKey,
  pluginName,
  userId,
  onRefreshComplete
}: PluginRefreshModalProps) {
  const [mounted, setMounted] = useState(false)
  const [refreshState, setRefreshState] = useState<RefreshState>('idle')
  const [errorMessage, setErrorMessage] = useState<string>('')

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    // Reset state when modal opens
    if (isOpen) {
      setRefreshState('idle')
      setErrorMessage('')
    }
  }, [isOpen])

  useEffect(() => {
    // Keyboard support
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return

      if (e.key === 'Escape') {
        handleClose()
      } else if (e.key === 'Enter' && refreshState === 'idle') {
        handleRefresh()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, refreshState])

  const handleClose = () => {
    if (refreshState === 'loading') return // Prevent closing during refresh
    onClose()
  }

  const handleRefresh = async () => {
    setRefreshState('loading')
    setErrorMessage('')

    try {
      const apiClient = getPluginAPIClient()
      const result = await apiClient.connectPlugin(userId, pluginKey)

      if (result.success) {
        setRefreshState('success')
        if (onRefreshComplete) {
          onRefreshComplete()
        }
        // Auto-close modal after showing success for 1.5 seconds
        setTimeout(() => {
          onClose()
        }, 1500)
      } else {
        throw new Error(result.error || 'Failed to refresh connection')
      }
    } catch (error: any) {
      console.error('Plugin refresh error:', error)
      setRefreshState('error')
      setErrorMessage(error.message || 'An unexpected error occurred. Please try again.')
    }
  }

  const getPluginIcon = (key: string) => {
    const iconSize = 48
    const brandColors: Record<string, string> = {
      gmail: '#EA4335',
      slack: '#4A154B',
      notion: '#000000',
      github: '#181717',
      linear: '#5E6AD2',
      calendly: '#006BFF',
      hubspot: '#FF7A59',
      salesforce: '#00A1E0',
      zendesk: '#03363D',
      intercom: '#0066FF',
      airtable: '#18BFFF',
      asana: '#F06A6A',
      trello: '#0079BF',
      jira: '#0052CC',
      confluence: '#172B4D',
      dropbox: '#0061FF',
      'google-drive': '#4285F4',
      'google-calendar': '#4285F4',
      'google-docs': '#4285F4',
      'google-sheets': '#0F9D58',
      'microsoft-teams': '#6264A7',
      outlook: '#0078D4',
      zoom: '#2D8CFF',
    }

    const color = brandColors[key.toLowerCase()] || '#6366F1'
    const initial = pluginName.charAt(0).toUpperCase()

    return (
      <div
        className="flex items-center justify-center font-bold text-white text-2xl"
        style={{
          width: iconSize,
          height: iconSize,
          borderRadius: '12px',
          backgroundColor: color,
        }}
      >
        {initial}
      </div>
    )
  }

  if (!mounted || !isOpen) return null

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-md transition-opacity"
        onClick={handleClose}
        style={{ animation: 'fadeIn 0.2s ease-out' }}
      />

      {/* Modal Container */}
      <div
        className="relative bg-[var(--v2-surface)] shadow-2xl border border-gray-200 dark:border-gray-700 max-w-[480px] w-full"
        style={{
          borderRadius: 'var(--v2-radius-card)',
          animation: 'scaleIn 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="flex items-center gap-4">
            {getPluginIcon(pluginKey)}
            <div>
              <h2 className="text-xl font-semibold text-[var(--v2-text-primary)]">
                {pluginName}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <div className="px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 text-xs font-medium rounded-md">
                  Token Expired
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleClose}
            disabled={refreshState === 'loading'}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Close modal"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pb-6">
          {refreshState === 'idle' && (
            <div className="space-y-4">
              <p className="text-[var(--v2-text-secondary)] text-sm leading-relaxed">
                Your authentication token for <strong>{pluginName}</strong> has expired.
                Click the button below to reconnect your account.
              </p>
              <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <p className="font-medium mb-1">What happens when you reconnect?</p>
                    <p className="text-blue-700 dark:text-blue-300">
                      A popup window will open for you to re-authorize {pluginName}.
                      Your existing configurations and agents will remain unchanged.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {refreshState === 'loading' && (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="w-12 h-12 text-[var(--v2-primary)] animate-spin mb-4" />
              <p className="text-[var(--v2-text-primary)] font-medium">Refreshing token...</p>
              <p className="text-[var(--v2-text-secondary)] text-sm mt-1">Please wait</p>
            </div>
          )}

          {refreshState === 'success' && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-10 h-10 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-[var(--v2-text-primary)] font-medium text-lg">Token Refreshed!</p>
              <p className="text-[var(--v2-text-secondary)] text-sm mt-1">
                Your {pluginName} connection is now active
              </p>
            </div>
          )}

          {refreshState === 'error' && (
            <div className="space-y-4">
              <div className="p-4 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">
                      Reconnection Failed
                    </p>
                    <p className="text-sm text-red-700 dark:text-red-300">
                      {errorMessage}
                    </p>
                  </div>
                </div>
              </div>
              <p className="text-[var(--v2-text-secondary)] text-sm">
                Please try again. If the issue persists, the authorization popup may have been blocked by your browser.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        {(refreshState === 'idle' || refreshState === 'error') && (
          <div className="flex items-center justify-end gap-3 px-6 pb-6 pt-2">
            <button
              onClick={handleClose}
              className="px-6 py-2.5 text-[var(--v2-text-secondary)] hover:bg-gray-100 dark:hover:bg-gray-800 rounded-xl font-medium transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleRefresh}
              className="px-6 py-2.5 bg-gradient-to-r from-[var(--v2-primary)] to-[#4F46E5] text-white rounded-xl font-medium shadow-[var(--v2-shadow-button)] hover:shadow-lg hover:scale-105 transition-all flex items-center gap-2"
            >
              <RefreshCw className="w-4 h-4" />
              {refreshState === 'error' ? 'Try Again' : 'Reconnect'}
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>,
    document.body
  )
}

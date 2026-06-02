'use client'

import React from 'react'
import { X, CheckCircle2, XCircle, Loader2, AlertCircle } from 'lucide-react'

interface ExecutionModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  executing: boolean
  result: any
  error: string | null
  agentName?: string
  onGoToBilling?: () => void
}

export function ExecutionModal({
  isOpen,
  onClose,
  onConfirm,
  executing,
  result,
  error,
  agentName,
  onGoToBilling
}: ExecutionModalProps) {
  if (!isOpen) return null

  const isInsufficientCredits = error?.toLowerCase().includes('insufficient credits') ||
                                 error?.toLowerCase().includes('credits')

  return (
    <>
      {/* Overlay */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200"
        onClick={onClose}
      >
        {/* Modal */}
        <div
          className="bg-[var(--v2-surface)] rounded-xl shadow-2xl max-w-sm w-full border border-[var(--v2-border)] overflow-hidden animate-in zoom-in-95 duration-200"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--v2-border)] bg-gradient-to-br from-blue-500/5 to-purple-500/5">
            <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
              Run Agent
            </h2>
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-hover)] transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="p-4">
            {/* Pre-execution */}
            {!executing && !result && !error && (
              <div className="space-y-4">
                <p className="text-[var(--v2-text-muted)] text-center text-sm">
                  Ready to run <span className="font-semibold text-[var(--v2-text-primary)]">{agentName}</span>?
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="flex-1 px-4 py-2 border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-hover)] transition-all text-[var(--v2-text-primary)] text-sm font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={onConfirm}
                    className="flex-1 px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-all text-sm font-medium shadow-md"
                  >
                    Run Now
                  </button>
                </div>
              </div>
            )}

            {/* Executing */}
            {executing && (
              <div className="text-center space-y-4">
                <div className="relative inline-block">
                  <div className="w-14 h-14 rounded-full bg-[var(--v2-primary)]/10 animate-pulse" />
                  <Loader2 className="w-10 h-10 text-[var(--v2-primary)] animate-spin absolute top-2 left-2" />
                </div>
                <div>
                  <p className="text-[var(--v2-text-primary)] font-semibold text-base mb-1">Running...</p>
                  <p className="text-xs text-[var(--v2-text-muted)]">This may take a few moments</p>
                </div>

                {/* Progress Bar */}
                <div className="space-y-1">
                  <div className="h-1.5 bg-[var(--v2-hover)] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[var(--v2-primary)] to-blue-500 rounded-full animate-progress-indeterminate" />
                  </div>
                  <p className="text-xs text-[var(--v2-text-muted)]">Processing...</p>
                </div>
              </div>
            )}

            {/* Success */}
            {result && !error && (
              <div className="text-center space-y-4">
                <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-9 h-9 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-emerald-600 dark:text-emerald-400 font-semibold text-base mb-1">Success!</p>
                  <p className="text-xs text-[var(--v2-text-muted)]">Agent executed successfully</p>
                </div>
                <button
                  onClick={onClose}
                  className="w-full px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-all shadow-md"
                >
                  Close
                </button>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="text-center space-y-4">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto ${
                  isInsufficientCredits
                    ? 'bg-yellow-500/10'
                    : 'bg-red-500/10'
                }`}>
                  {isInsufficientCredits ? (
                    <AlertCircle className="w-9 h-9 text-yellow-600 dark:text-yellow-400" />
                  ) : (
                    <XCircle className="w-9 h-9 text-red-600 dark:text-red-400" />
                  )}
                </div>
                <div>
                  <p className={`font-semibold text-base mb-1 ${
                    isInsufficientCredits
                      ? 'text-yellow-600 dark:text-yellow-400'
                      : 'text-red-600 dark:text-red-400'
                  }`}>
                    {isInsufficientCredits ? 'Insufficient Credits' : 'Execution Failed'}
                  </p>
                  <p className="text-xs text-[var(--v2-text-muted)]">{error}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="flex-1 px-4 py-2 border border-[var(--v2-border)] rounded-lg hover:bg-[var(--v2-hover)] transition-all text-[var(--v2-text-primary)] text-sm font-medium"
                  >
                    Close
                  </button>
                  {isInsufficientCredits && onGoToBilling && (
                    <button
                      onClick={onGoToBilling}
                      className="flex-1 px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-all text-sm font-medium shadow-md"
                    >
                      Add Credits
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

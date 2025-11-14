'use client'

import React from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Zap,
  DollarSign,
  XCircle,
  Loader2
} from 'lucide-react'

interface UserSubscription {
  monthly_amount_usd?: number
  monthly_credits?: number
  balance?: number
  current_period_end?: string
}

interface PricingConfig {
  pilot_credit_cost_usd: number
  tokens_per_pilot_credit: number
}

interface ModalsV2Props {
  // Checkout Modal
  showCheckoutModal: boolean
  clientSecret: string | null
  checkoutRef: React.RefObject<HTMLDivElement>
  closeCheckoutModal: () => void
  modalMounted: boolean

  // Cancel Modal
  showCancelModal: boolean
  setShowCancelModal: (show: boolean) => void
  handleCancelSubscription: () => void
  cancelLoading: boolean
  userSubscription: UserSubscription | null
  pricingConfig: PricingConfig

  // Reactivate Modal
  showReactivateModal: boolean
  setShowReactivateModal: (show: boolean) => void
  handleReactivateSubscription: () => void
  reactivateLoading: boolean

  // Success Notification
  showSuccessMessage: boolean
  setShowSuccessMessage: (show: boolean) => void
}

export default function ModalsV2({
  showCheckoutModal,
  clientSecret,
  checkoutRef,
  closeCheckoutModal,
  modalMounted,
  showCancelModal,
  setShowCancelModal,
  handleCancelSubscription,
  cancelLoading,
  userSubscription,
  pricingConfig,
  showReactivateModal,
  setShowReactivateModal,
  handleReactivateSubscription,
  reactivateLoading,
  showSuccessMessage,
  setShowSuccessMessage
}: ModalsV2Props) {
  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    })
  }

  const monthlyAmountUsd = userSubscription?.monthly_amount_usd || 0
  const monthlyPilotCredits = userSubscription?.monthly_credits || 0
  const currentBalance = userSubscription?.balance || 0
  const currentPilotCredits = Math.floor(currentBalance / pricingConfig.tokens_per_pilot_credit)

  return (
    <>
      {/* Embedded Checkout Modal */}
      {modalMounted && showCheckoutModal && clientSecret && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-md"
            onClick={closeCheckoutModal}
          />
          <div className="relative bg-[var(--v2-surface)] backdrop-blur-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {/* Close button */}
            <button
              onClick={closeCheckoutModal}
              className="absolute top-4 right-4 p-2 hover:bg-[var(--v2-bg)] transition-colors z-10"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <X className="h-5 w-5 text-[var(--v2-text-secondary)]" />
            </button>

            {/* Header */}
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-2xl font-bold text-[var(--v2-text-primary)]">Complete Your Purchase</h2>
              <p className="text-[var(--v2-text-secondary)] mt-1">Securely complete your payment with Stripe</p>
            </div>

            {/* Embedded Checkout Container */}
            <div className="p-6">
              <div ref={checkoutRef} style={{ minHeight: '500px', width: '100%' }}>
                {/* Stripe embedded checkout will render here */}
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Cancel Subscription Modal */}
      {modalMounted && showCancelModal && userSubscription && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-md" />
          <div className="relative bg-[var(--v2-surface)] backdrop-blur-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-lg w-full p-6"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {/* Icon */}
            <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>

            {/* Content */}
            <h2 className="text-xl font-bold text-[var(--v2-text-primary)] text-center mb-2">
              Cancel Subscription?
            </h2>
            <p className="text-sm text-[var(--v2-text-secondary)] text-center mb-4">
              Here's what will happen when you cancel:
            </p>

            {/* Information Cards */}
            <div className="space-y-3 mb-6">
              {/* Current Balance */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 p-3"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm font-medium text-blue-900 dark:text-blue-300">You'll Keep Your Credits</span>
                  </div>
                  <span className="text-sm font-bold text-blue-900 dark:text-blue-300">
                    {currentPilotCredits.toLocaleString()} credits
                  </span>
                </div>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-1 ml-6">
                  Your current balance remains available with no expiration
                </p>
              </div>

              {/* Access Until */}
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 p-3"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-green-600 dark:text-green-400" />
                    <span className="text-sm font-medium text-green-900 dark:text-green-300">Access Until</span>
                  </div>
                  <span className="text-sm font-bold text-green-900 dark:text-green-300">
                    {formatDate(userSubscription.current_period_end || '')}
                  </span>
                </div>
                <p className="text-xs text-green-700 dark:text-green-400 mt-1 ml-6">
                  You've already paid for this period
                </p>
              </div>

              {/* No Future Charges */}
              <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 p-3"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                    <span className="text-sm font-medium text-orange-900 dark:text-orange-300">No More Charges</span>
                  </div>
                  <span className="text-sm font-bold text-orange-900 dark:text-orange-300">
                    ${monthlyAmountUsd.toFixed(2)}/mo
                  </span>
                </div>
                <p className="text-xs text-orange-700 dark:text-orange-400 mt-1 ml-6">
                  Starting {formatDate(userSubscription.current_period_end || '')}
                </p>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelLoading}
                className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all text-sm font-medium disabled:opacity-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                Keep Subscription
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={cancelLoading}
                className="flex-1 px-4 py-2.5 bg-red-600 dark:bg-red-700 text-white hover:bg-red-700 dark:hover:bg-red-800 transition-colors text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {cancelLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Canceling...
                  </>
                ) : (
                  'Yes, Cancel'
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Reactivate Subscription Modal */}
      {modalMounted && showReactivateModal && userSubscription && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-md" />
          <div className="relative bg-[var(--v2-surface)] backdrop-blur-xl shadow-2xl border border-gray-200 dark:border-gray-700 max-w-lg w-full p-6"
            style={{ borderRadius: 'var(--v2-radius-card)' }}
          >
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold text-[var(--v2-text-primary)]">Reactivate Subscription</h2>
                <p className="text-sm text-[var(--v2-text-secondary)] mt-1">
                  Resume your subscription and continue enjoying uninterrupted access.
                </p>
              </div>
              <button
                onClick={() => setShowReactivateModal(false)}
                className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors p-1"
                disabled={reactivateLoading}
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Information Cards */}
            <div className="space-y-3 mb-6">
              {/* Monthly Credits */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 p-3 flex items-center gap-3"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Monthly Credits</p>
                  <p className="text-sm font-bold text-blue-900 dark:text-blue-300">{monthlyPilotCredits.toLocaleString()} credits</p>
                </div>
              </div>

              {/* Next Billing Date */}
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 p-3 flex items-center gap-3"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Calendar className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-green-600 dark:text-green-400 font-medium">Next Billing Date</p>
                  <p className="text-sm font-bold text-green-900 dark:text-green-300">{formatDate(userSubscription.current_period_end || '')}</p>
                </div>
              </div>

              {/* Monthly Amount */}
              <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 p-3 flex items-center gap-3"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <DollarSign className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xs text-purple-600 dark:text-purple-400 font-medium">Monthly Amount</p>
                  <p className="text-sm font-bold text-purple-900 dark:text-purple-300">${monthlyAmountUsd.toFixed(2)}/mo</p>
                </div>
              </div>
            </div>

            {/* What happens info */}
            <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 border border-green-200 dark:border-green-700 p-4 mb-6"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <CheckCircle2 className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-sm font-semibold text-green-900 dark:text-green-300 mb-1">What happens when you reactivate?</h3>
                  <ul className="text-xs text-green-800 dark:text-green-400 space-y-1">
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 dark:text-green-500 mt-0.5">•</span>
                      <span>Your subscription will continue as normal</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 dark:text-green-500 mt-0.5">•</span>
                      <span>You'll be billed ${monthlyAmountUsd.toFixed(2)} on {formatDate(userSubscription.current_period_end || '')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 dark:text-green-500 mt-0.5">•</span>
                      <span>You'll receive {monthlyPilotCredits.toLocaleString()} credits each billing cycle</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-green-600 dark:text-green-500 mt-0.5">•</span>
                      <span>You can cancel anytime</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3">
              <button
                onClick={() => setShowReactivateModal(false)}
                disabled={reactivateLoading}
                className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-600 text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-all text-sm font-medium disabled:opacity-50"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                Not Now
              </button>
              <button
                onClick={handleReactivateSubscription}
                disabled={reactivateLoading}
                className="flex-1 px-4 py-2.5 bg-green-600 dark:bg-green-700 text-white hover:bg-green-700 dark:hover:bg-green-800 transition-colors text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
                style={{ borderRadius: 'var(--v2-radius-button)' }}
              >
                {reactivateLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reactivating...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-4 w-4" />
                    Yes, Reactivate
                  </>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Success Notification Toast */}
      {showSuccessMessage && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2">
          <div className="p-2.5 border shadow-lg flex items-center gap-2 max-w-md" style={{
            backgroundColor: 'var(--v2-success-bg)',
            borderColor: 'var(--v2-success-border)',
            borderRadius: 'var(--v2-radius-card)'
          }}>
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--v2-success-icon)' }} />
            <div className="flex-1">
              <p className="text-xs font-medium" style={{ color: 'var(--v2-success-text)' }}>Payment Successful! Your credits will be added shortly.</p>
            </div>
            <button
              onClick={() => setShowSuccessMessage(false)}
              className="transition-opacity hover:opacity-70"
              style={{ color: 'var(--v2-success-icon)' }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

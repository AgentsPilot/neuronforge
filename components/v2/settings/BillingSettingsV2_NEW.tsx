'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'
import Script from 'next/script'
import {
  CreditCard,
  Coins,
  TrendingUp,
  FileText,
  Loader2,
  Info,
  Sparkles,
  ArrowRight,
  Rocket,
  Crown,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  XCircle,
  Clock
} from 'lucide-react'
import { createCurrencyService, ExchangeRate } from '@/lib/services/CurrencyService'
import { formatCurrency as formatCurrencyHelper, formatCurrencyWithRate } from '@/lib/utils/currencyHelpers'
import StatsCardsV2 from '@/components/v2/billing/StatsCardsV2'
import ModalsV2 from '@/components/v2/billing/ModalsV2'

interface UserSubscription {
  balance: number
  total_earned: number
  total_spent: number
  status: string
  stripe_customer_id?: string
  stripe_subscription_id?: string
  current_period_start?: string
  current_period_end?: string
  cancel_at_period_end?: boolean
  monthly_pilot_credits?: number
  monthly_credits?: number
  monthly_amount_usd?: number
  storage_quota_mb?: number
  storage_used_mb?: number
  executions_quota?: number | null
  executions_used?: number
  created_at?: string
  free_tier_granted_at?: string | null
  free_tier_expires_at?: string | null
  free_tier_initial_amount?: number
  account_frozen?: boolean
}

interface BoostPack {
  id: string
  pack_key: string
  pack_name: string
  display_name: string
  description: string
  credits_amount: number
  bonus_credits: number
  price_usd: number
  badge_text?: string
  is_active: boolean
}

interface PricingConfig {
  pilot_credit_cost_usd: number
  tokens_per_pilot_credit: number
}

declare global {
  interface Window {
    Stripe?: any
  }
}

export default function BillingSettingsV2() {
  const [activeTab, setActiveTab] = useState<'credits' | 'subscription' | 'invoices'>('credits')
  const [userSubscription, setUserSubscription] = useState<UserSubscription | null>(null)
  const [boostPacks, setBoostPacks] = useState<BoostPack[]>([])
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>({
    pilot_credit_cost_usd: 0.00048,
    tokens_per_pilot_credit: 10
  })
  const [loading, setLoading] = useState(true)
  const [minSubscriptionUsd, setMinSubscriptionUsd] = useState(10)
  const [customCredits, setCustomCredits] = useState(208330)
  const [subscriptionLoading, setSubscriptionLoading] = useState(false)
  const [boostPackLoading, setBoostPackLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [stripeLoaded, setStripeLoaded] = useState(false)
  const [showSuccessMessage, setShowSuccessMessage] = useState(false)
  const [rewardCredits, setRewardCredits] = useState(0)
  const [boostPackCredits, setBoostPackCredits] = useState(0)

  // Multi-currency state
  const [userCurrency, setUserCurrency] = useState<string>('USD')
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null)
  const [currencyLoading, setCurrencyLoading] = useState(true)

  // Embedded checkout state
  const [showCheckoutModal, setShowCheckoutModal] = useState(false)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [modalMounted, setModalMounted] = useState(false)
  const checkoutRef = useRef<HTMLDivElement>(null)
  const [showCancelModal, setShowCancelModal] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [showReactivateModal, setShowReactivateModal] = useState(false)
  const [reactivateLoading, setReactivateLoading] = useState(false)
  const stripeCheckoutRef = useRef<any>(null)

  // Invoices state
  const [invoices, setInvoices] = useState<any[]>([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [hasMoreInvoices, setHasMoreInvoices] = useState(false)
  const [pageHistory, setPageHistory] = useState<string[]>([])
  const [currentPageLastId, setCurrentPageLastId] = useState<string | null>(null)

  // Storage state
  const [storageQuotaMB, setStorageQuotaMB] = useState(0)
  const [storageUsedMB, setStorageUsedMB] = useState(0)

  // Executions state
  const [totalExecutions, setTotalExecutions] = useState(0)

  useEffect(() => {
    fetchBillingData()
    fetchUserCurrency()

    const handleCurrencyChange = () => {
      console.log('🔄 Currency changed, refreshing...')
      fetchUserCurrency()
    }

    window.addEventListener('currencyChanged', handleCurrencyChange)
    return () => window.removeEventListener('currencyChanged', handleCurrencyChange)
  }, [])

  useEffect(() => {
    setModalMounted(true)

    // Check if Stripe is already loaded
    if (typeof window !== 'undefined' && window.Stripe) {
      console.log('✅ Stripe already loaded on mount')
      setStripeLoaded(true)
    }

    return () => setModalMounted(false)
  }, [])

  useEffect(() => {
    console.log('[Checkout Effect] Triggered:', {
      showCheckoutModal,
      hasClientSecret: !!clientSecret,
      stripeLoaded,
      modalMounted,
      hasWindow: typeof window !== 'undefined',
      hasStripe: typeof window !== 'undefined' && !!window.Stripe
    })

    // If stripeLoaded is false but Stripe is actually available, update the state
    if (!stripeLoaded && typeof window !== 'undefined' && window.Stripe) {
      console.log('⚠️ [Checkout Effect] Stripe is loaded but state is false, updating...')
      setStripeLoaded(true)
      return
    }

    if (showCheckoutModal && clientSecret && stripeLoaded && modalMounted && typeof window !== 'undefined' && window.Stripe) {
      console.log('✅ [Checkout Effect] All conditions met, initializing in 300ms')
      setTimeout(() => initializeEmbeddedCheckout(clientSecret, 0), 300)
    } else {
      console.log('⏸️ [Checkout Effect] Waiting for conditions...')
    }
  }, [showCheckoutModal, clientSecret, stripeLoaded, modalMounted])

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search)
    const checkoutSuccess = urlParams.get('success')

    if (checkoutSuccess === 'true') {
      console.log('🎉 Checkout completed! Checking if sync needed...')

      // Check if this is a new subscription or an upgrade
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) {
          console.log('⚠️  No user found, skipping sync')
          return
        }

        // Check if subscription already exists
        supabase
          .from('user_subscriptions')
          .select('stripe_subscription_id')
          .eq('user_id', user.id)
          .single()
          .then(({ data: existingSub }) => {
            if (existingSub?.stripe_subscription_id) {
              // Subscription exists - this is an upgrade, let webhook handle it
              console.log('⏭️  Skipping sync - existing subscription detected, webhook will handle the upgrade')
              setShowSuccessMessage(true)
              setTimeout(() => setShowSuccessMessage(false), 5000)
              fetchBillingData()
              const newUrl = window.location.pathname
              window.history.replaceState({}, '', newUrl)
            } else {
              // No existing subscription - this is a new purchase, run sync
              console.log('🔄 New subscription - triggering sync...')
              fetch('/api/stripe/sync-subscription', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
              })
                .then(res => res.json())
                .then(data => {
                  console.log('✅ Sync result:', data)
                  setShowSuccessMessage(true)
                  setTimeout(() => setShowSuccessMessage(false), 5000)
                  fetchBillingData()
                  const newUrl = window.location.pathname
                  window.history.replaceState({}, '', newUrl)
                })
                .catch(error => console.error('❌ Sync failed:', error))
            }
          })
          .catch(error => {
            console.error('❌ Error checking existing subscription:', error)
            // If check fails, skip sync to be safe (webhook will handle it)
            fetchBillingData()
            const newUrl = window.location.pathname
            window.history.replaceState({}, '', newUrl)
          })
      })
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'invoices') {
      fetchInvoices()
    }
  }, [activeTab])

  const fetchInvoices = async (startingAfter?: string, direction: 'next' | 'prev' | 'initial' = 'initial') => {
    try {
      setInvoicesLoading(true)

      const url = new URL('/api/stripe/invoices', window.location.origin)
      url.searchParams.set('limit', '10')
      if (startingAfter) {
        url.searchParams.set('starting_after', startingAfter)
      }

      const response = await fetch(url.toString())
      const data = await response.json()

      if (response.ok) {
        setInvoices(data.invoices || [])
        setHasMoreInvoices(data.has_more || false)
        setCurrentPageLastId(data.last_invoice_id || null)

        if (direction === 'next' && startingAfter) {
          setPageHistory(prev => [...prev, startingAfter])
        } else if (direction === 'prev') {
          setPageHistory(prev => prev.slice(0, -1))
        }
      } else {
        console.error('Error fetching invoices:', data.error)
        setInvoices([])
      }
    } catch (error) {
      console.error('Error fetching invoices:', error)
      setInvoices([])
    } finally {
      setInvoicesLoading(false)
    }
  }

  const goToNextInvoicesPage = () => {
    if (currentPageLastId && hasMoreInvoices) {
      fetchInvoices(currentPageLastId, 'next')
    }
  }

  const goToPrevInvoicesPage = () => {
    if (pageHistory.length > 0) {
      if (pageHistory.length === 1) {
        fetchInvoices(undefined, 'prev')
      } else {
        const pageBeforePrev = pageHistory[pageHistory.length - 2]
        fetchInvoices(pageBeforePrev, 'prev')
      }
    }
  }

  const fetchUserCurrency = async () => {
    try {
      setCurrencyLoading(true)
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const currencyService = createCurrencyService(supabase)
      const currency = await currencyService.getUserCurrency(user.id)
      setUserCurrency(currency)

      let rate = await currencyService.getRate(currency)

      if (currency !== 'USD' && rate) {
        try {
          const liveRateResponse = await fetch('https://api.exchangerate-api.com/v4/latest/USD')
          if (liveRateResponse.ok) {
            const liveData = await liveRateResponse.json()
            const liveRates = liveData.rates as Record<string, number>
            if (liveRates[currency]) {
              rate = {
                ...rate,
                rate_to_usd: liveRates[currency],
                last_updated_at: new Date().toISOString()
              }
            }
          }
        } catch (apiError) {
          console.warn('⚠️ Failed to fetch live rate, using database rate:', apiError)
        }
      }

      setExchangeRate(rate)
    } catch (error) {
      console.error('Error fetching user currency:', error)
      setUserCurrency('USD')
    } finally {
      setCurrencyLoading(false)
    }
  }

  const fetchBillingData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single()

      if (subscription) {
        setUserSubscription(subscription)
        // Set storage data
        setStorageQuotaMB(subscription.storage_quota_mb || 0)
        setStorageUsedMB(subscription.storage_used_mb || 0)
      }

      // Get total executions count
      const { count: executionsCount } = await supabase
        .from('workflow_executions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

      setTotalExecutions(executionsCount || 0)

      const { data: rewardTransactions } = await supabase
        .from('credit_transactions')
        .select('credits_delta')
        .eq('user_id', user.id)
        .eq('activity_type', 'reward_credit')

      const totalRewardCredits = rewardTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0
      setRewardCredits(totalRewardCredits)

      const { data: boostTransactions } = await supabase
        .from('credit_transactions')
        .select('credits_delta')
        .eq('user_id', user.id)
        .eq('activity_type', 'boost_pack_purchase')

      const totalBoostCredits = boostTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0
      setBoostPackCredits(totalBoostCredits)

      const { data: packs } = await supabase
        .from('boost_packs')
        .select('*')
        .eq('is_active', true)
        .order('price_usd', { ascending: true })

      setBoostPacks(packs || [])

      const { data: configData } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit', 'min_subscription_usd'])

      if (configData) {
        const configMap = new Map(configData.map(c => [c.config_key, c.config_value]))
        const pilotCreditCost = parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048')
        const tokensPerCredit = parseInt(configMap.get('tokens_per_pilot_credit') || '10')
        const minSubscriptionUsd = parseFloat(configMap.get('min_subscription_usd') || '10')

        setPricingConfig({
          pilot_credit_cost_usd: pilotCreditCost,
          tokens_per_pilot_credit: tokensPerCredit
        })

        setMinSubscriptionUsd(minSubscriptionUsd)

        const minPilotCredits = Math.ceil(minSubscriptionUsd / pilotCreditCost)
        const calculatedMinTokens = minPilotCredits * tokensPerCredit

        const hasActiveSubscription = subscription?.status === 'active' || subscription?.status === 'past_due'
        if (hasActiveSubscription && subscription?.monthly_credits) {
          const currentTokens = subscription.monthly_credits * tokensPerCredit
          setCustomCredits(currentTokens)
        } else {
          setCustomCredits(prev => prev < calculatedMinTokens ? calculatedMinTokens : prev)
        }
      }
    } catch (error) {
      console.error('Error fetching billing data:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePurchaseCredits = async () => {
    try {
      setSubscriptionLoading(true)

      if (hasActiveSubscription && userSubscription?.stripe_subscription_id) {
        const pilotCreditsToSend = Math.round(customCredits / pricingConfig.tokens_per_pilot_credit)

        const response = await fetch('/api/stripe/update-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPilotCredits: pilotCreditsToSend })
        })

        if (!response.ok) {
          const error = await response.json()
          throw new Error(error.error || 'Failed to update subscription')
        }

        setShowSuccessMessage(true)
        setTimeout(() => setShowSuccessMessage(false), 7000)

        setTimeout(async () => {
          await fetchBillingData()
          setSubscriptionLoading(false)
        }, 2000)
        return
      }

      const pilotCreditsToSend = Math.round(customCredits / pricingConfig.tokens_per_pilot_credit)

      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseType: 'custom_credits',
          pilotCredits: pilotCreditsToSend
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create checkout')
      }

      const { clientSecret: secret } = await response.json()

      if (!secret) {
        throw new Error('No client secret returned')
      }

      console.log('✅ [Subscription] Received client secret, opening modal')
      console.log('  - clientSecret length:', secret.length)
      console.log('  - modalMounted:', modalMounted)
      console.log('  - stripeLoaded:', stripeLoaded)

      setClientSecret(secret)
      setShowCheckoutModal(true)
      setSubscriptionLoading(false)
    } catch (error: any) {
      console.error('❌ Error:', error)
      alert(`Error: ${error.message}. Please make sure you're logged in.`)
      setSubscriptionLoading(false)
    }
  }

  const handlePurchaseBoostPack = async (boostPackId: string) => {
    try {
      if (!userSubscription?.stripe_subscription_id) {
        alert('You must have an active subscription before purchasing boost packs. Please start a subscription first.')
        return
      }

      setBoostPackLoading(true)

      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseType: 'boost_pack',
          boostPackId
        })
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create checkout')
      }

      const { clientSecret: secret } = await response.json()

      if (!secret) {
        throw new Error('No client secret returned')
      }

      setClientSecret(secret)
      setShowCheckoutModal(true)
      setBoostPackLoading(false)
    } catch (error: any) {
      console.error('Error creating checkout:', error)
      alert(error.message || 'Failed to start checkout process')
      setBoostPackLoading(false)
    }
  }

  const initializeEmbeddedCheckout = async (secret: string, retryCount = 0) => {
    if (typeof window === 'undefined' || !window.Stripe) {
      console.error('❌ Stripe not available')
      return
    }

    if (!checkoutRef.current) {
      if (retryCount < 5) {
        setTimeout(() => initializeEmbeddedCheckout(secret, retryCount + 1), 150)
        return
      }
      console.error('❌ Checkout ref not available after retries')
      return
    }

    try {
      // Destroy existing checkout instance if present
      if (stripeCheckoutRef.current) {
        console.log('🧹 Cleaning up previous Stripe checkout instance')
        try {
          stripeCheckoutRef.current.destroy()
        } catch (destroyError) {
          console.warn('⚠️ Error destroying previous checkout:', destroyError)
        }
        stripeCheckoutRef.current = null
      }

      // Clear any residual content in the checkout container
      if (checkoutRef.current) {
        checkoutRef.current.innerHTML = ''
      }

      const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
      if (!stripeKey) {
        console.error('❌ Stripe publishable key not found')
        alert('Payment system configuration error. Please contact support.')
        closeCheckoutModal()
        return
      }

      console.log('🔵 Initializing new Stripe checkout session')
      const stripe = window.Stripe(stripeKey)

      const checkout = await stripe.initEmbeddedCheckout({
        clientSecret: secret,
        onComplete: async () => {
          console.log('✅ Payment completed successfully')
          closeCheckoutModal()
          setShowSuccessMessage(true)

          try {
            console.log('🔄 Calling manual sync endpoint...')
            const syncResponse = await fetch('/api/stripe/sync-subscription', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            })

            const syncData = await syncResponse.json()
            console.log('✅ Sync response:', syncData)

            if (!syncResponse.ok) {
              console.error('❌ Sync endpoint returned error:', syncData)
            }
          } catch (error) {
            console.error('❌ Manual sync failed:', error)
          }

          console.log('🔄 Fetching updated billing data...')
          await fetchBillingData()
          console.log('✅ Billing data refreshed')

          setTimeout(() => setShowSuccessMessage(false), 5000)
        }
      })

      stripeCheckoutRef.current = checkout
      checkout.mount(checkoutRef.current)
      console.log('✅ Stripe checkout mounted successfully')
    } catch (error) {
      console.error('❌ Error initializing embedded checkout:', error)
      alert('Failed to load checkout. Please try again.')
      closeCheckoutModal()
    }
  }

  const closeCheckoutModal = () => {
    if (stripeCheckoutRef.current) {
      try {
        stripeCheckoutRef.current.destroy()
      } catch (error) {
        console.error('Error destroying Stripe checkout:', error)
      }
      stripeCheckoutRef.current = null
    }
    setShowCheckoutModal(false)
    setClientSecret(null)
  }

  const handleManageSubscription = async () => {
    try {
      setPortalLoading(true)

      const response = await fetch('/api/stripe/create-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to open customer portal')
      }

      const { url } = await response.json()
      window.location.href = url
    } catch (error: any) {
      console.error('Error opening portal:', error)
      alert(error.message || 'Failed to open subscription management')
      setPortalLoading(false)
    }
  }

  const handleCancelSubscription = async () => {
    try {
      setCancelLoading(true)

      const response = await fetch('/api/stripe/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to cancel subscription')
      }

      await fetchBillingData()
      setShowCancelModal(false)
    } catch (error: any) {
      console.error('Error canceling subscription:', error)
      alert(error.message || 'Failed to cancel subscription')
    } finally {
      setCancelLoading(false)
    }
  }

  const handleReactivateSubscription = async () => {
    try {
      setReactivateLoading(true)

      const response = await fetch('/api/stripe/reactivate-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to reactivate subscription')
      }

      await fetchBillingData()
      setShowReactivateModal(false)
    } catch (error: any) {
      console.error('Error reactivating subscription:', error)
      alert(error.message || 'Failed to reactivate subscription')
    } finally {
      setReactivateLoading(false)
    }
  }

  const calculatePrice = (tokens: number) => {
    const pilotCredits = tokens / pricingConfig.tokens_per_pilot_credit
    return pilotCredits * pricingConfig.pilot_credit_cost_usd
  }

  const calculatePriceInUserCurrency = (priceUsd: number) => {
    if (exchangeRate && userCurrency !== 'USD') {
      return priceUsd * exchangeRate.rate_to_usd
    }
    return priceUsd
  }

  const formatCredits = (tokens: number) => {
    const pilotCredits = tokens / pricingConfig.tokens_per_pilot_credit
    return new Intl.NumberFormat().format(pilotCredits)
  }

  const formatCurrency = (amount: number) => {
    return formatCurrencyHelper(amount, 'USD')
  }

  const formatCurrencyConverted = (amount: number) => {
    if (exchangeRate && userCurrency !== 'USD') {
      return formatCurrencyWithRate(amount, exchangeRate)
    }
    return null
  }

  if (loading || currencyLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--v2-primary)]" />
      </div>
    )
  }

  const hasActiveSubscription = userSubscription?.stripe_subscription_id && userSubscription?.status === 'active'
  const estimatedPrice = calculatePrice(customCredits)
  const convertedPrice = calculatePriceInUserCurrency(estimatedPrice)
  const minCredits = Math.ceil(minSubscriptionUsd / pricingConfig.pilot_credit_cost_usd)
  const minTokens = minCredits * pricingConfig.tokens_per_pilot_credit
  const currentSubscriptionTokens = hasActiveSubscription && userSubscription?.monthly_credits
    ? userSubscription.monthly_credits * pricingConfig.tokens_per_pilot_credit
    : 0
  const hasAmountChanged = !hasActiveSubscription || Math.abs(customCredits - currentSubscriptionTokens) >= 1000
  const isCanceling = userSubscription?.cancel_at_period_end

  return (
    <>
      <Script
        src="https://js.stripe.com/v3/"
        onLoad={() => {
          console.log('✅ Stripe.js loaded')
          setStripeLoaded(true)
        }}
        onError={() => {
          console.error('❌ Failed to load Stripe.js')
        }}
      />

      <div className="space-y-4">
        {/* Stats Cards */}
        <StatsCardsV2
          userSubscription={userSubscription}
          rewardCredits={rewardCredits}
          boostPackCredits={boostPackCredits}
          formatCredits={formatCredits}
        />

        {/* Tabs */}
        <div className="bg-[var(--v2-surface)] shadow-[var(--v2-shadow-card)] p-1.5" style={{ borderRadius: 'var(--v2-radius-card)' }}>
          <div className="flex gap-1">
            {[
              { id: 'credits', label: 'Credits', icon: Coins },
              { id: 'subscription', label: 'Subscription', icon: TrendingUp },
              { id: 'invoices', label: 'Invoices', icon: FileText }
            ].map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                    activeTab === tab.id
                      ? 'bg-[var(--v2-primary)] text-white shadow-[var(--v2-shadow-button)]'
                      : 'text-[var(--v2-text-secondary)] hover:bg-[var(--v2-bg)] hover:text-[var(--v2-text-primary)]'
                  }`}
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab Content - Credits Tab */}
        {activeTab === 'credits' && (
          <div className="space-y-4 relative">
            {/* Canceling Overlay */}
            {isCanceling && (
              <div className="absolute inset-0 bg-[var(--v2-surface)]/80 backdrop-blur-sm z-10 flex items-center justify-center"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="text-center p-6 max-w-md">
                  <div className="w-16 h-16 bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center mx-auto mb-4"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <Info className="h-8 w-8 text-orange-600 dark:text-orange-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">Subscription Canceling</h3>
                  <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
                    You can't purchase or update credits while your subscription is set to cancel.
                    Reactivate your subscription to continue using this feature.
                  </p>
                  <button
                    onClick={() => setShowReactivateModal(true)}
                    className="px-4 py-2 bg-orange-600 dark:bg-orange-700 text-white hover:bg-orange-700 dark:hover:bg-orange-800 transition-colors text-sm font-semibold"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    Reactivate Subscription
                  </button>
                </div>
              </div>
            )}

            {/* Info Box */}
            <div className="bg-blue-50/50 dark:bg-blue-900/20 border border-blue-200/50 dark:border-blue-700/50 p-3 flex items-start gap-2"
              style={{ borderRadius: 'var(--v2-radius-card)' }}
            >
              <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-medium text-blue-900 dark:text-blue-300">How Pilot Credits Work</p>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                  Purchase a custom amount of Pilot Credits each month.
                </p>
              </div>
            </div>

            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Left: Purchase Custom Credits */}
              <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 shadow-[var(--v2-shadow-card)] p-4 flex flex-col"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="mb-4">
                  <h2 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
                    {hasActiveSubscription ? 'Update Subscription' : 'Start Subscription'}
                  </h2>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    {hasActiveSubscription
                      ? 'Change your monthly credit amount (takes effect next billing cycle)'
                      : 'Choose how many Pilot Credits you need each month'
                    }
                  </p>
                </div>

                <div className="space-y-4 flex-1 flex flex-col">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-[var(--v2-text-primary)]">Monthly Pilot Credits</label>
                      <div className="text-right">
                        <div className="text-lg font-bold text-[var(--v2-text-primary)]">{formatCredits(customCredits)}</div>
                        <div className="text-[10px] text-[var(--v2-text-muted)]">credits/month</div>
                      </div>
                    </div>

                    <input
                      type="range"
                      min={minTokens}
                      max="10000000"
                      step="1000"
                      value={customCredits}
                      onChange={(e) => setCustomCredits(parseInt(e.target.value))}
                      className="w-full h-2 bg-[var(--v2-bg)] appearance-none cursor-pointer"
                      style={{
                        borderRadius: 'var(--v2-radius-button)',
                        background: `linear-gradient(to right, var(--v2-primary) 0%, var(--v2-primary) ${((customCredits - minTokens) / (10000000 - minTokens)) * 100}%, var(--v2-bg) ${((customCredits - minTokens) / (10000000 - minTokens)) * 100}%, var(--v2-bg) 100%)`
                      }}
                    />

                    <div className="flex justify-between text-[10px] text-[var(--v2-text-muted)]">
                      <span>{formatCredits(minTokens)} (min)</span>
                      <span>10,000,000</span>
                    </div>
                  </div>

                  {/* Quick Select Buttons */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {[
                      minTokens,
                      Math.round(minTokens * 2.5),
                      Math.round(minTokens * 5),
                      Math.round(minTokens * 10)
                    ].map(amount => (
                      <button
                        key={amount}
                        onClick={() => setCustomCredits(amount)}
                        className={`px-2 py-1.5 text-xs font-medium transition-colors ${
                          customCredits === amount
                            ? 'bg-[var(--v2-primary)] text-white'
                            : 'bg-[var(--v2-bg)] text-[var(--v2-text-secondary)] hover:bg-[var(--v2-surface)]'
                        }`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        {formatCredits(amount)}
                      </button>
                    ))}
                  </div>

                  {/* Price Breakdown */}
                  <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-3 space-y-2"
                    style={{ borderRadius: 'var(--v2-radius-card)' }}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-[var(--v2-text-secondary)]">Pilot Credits</span>
                      <span className="text-xs font-semibold text-[var(--v2-text-primary)]">{formatCredits(customCredits)}</span>
                    </div>
                    <div className="border-t border-gray-200 dark:border-gray-700 pt-2 flex justify-between items-center">
                      <span className="text-sm font-semibold text-[var(--v2-text-primary)]">Monthly Total</span>
                      <div className="text-right">
                        <div className="text-xl font-bold text-[var(--v2-text-primary)]">
                          {formatCurrency(estimatedPrice)} USD
                        </div>
                        {formatCurrencyConverted(convertedPrice) && (
                          <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">
                            ≈ {formatCurrencyConverted(convertedPrice)}
                          </div>
                        )}
                        <div className="text-[10px] text-[var(--v2-text-muted)]">per month</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1"></div>

                  {/* Purchase Button */}
                  <div className="mt-4">
                    <button
                      onClick={handlePurchaseCredits}
                      disabled={subscriptionLoading || customCredits < 1000 || !hasAmountChanged || isCanceling}
                      className="w-full py-2.5 bg-[var(--v2-primary)] text-white hover:scale-105 transition-all shadow-[var(--v2-shadow-button)] text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      {subscriptionLoading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          {hasActiveSubscription ? 'Update Subscription' : 'Start Subscription'}
                          <ArrowRight className="h-4 w-4" />
                        </>
                      )}
                    </button>

                    <p className="text-[10px] text-center text-[var(--v2-text-muted)] mt-2">
                      {isCanceling
                        ? 'Subscription is canceling. Reactivate to make changes.'
                        : hasActiveSubscription
                        ? hasAmountChanged
                          ? 'Changes will take effect at your next billing cycle. You can cancel anytime.'
                          : 'Adjust the amount to update your subscription.'
                        : 'Credits roll over completely. Cancel anytime. No commitments.'
                      }
                    </p>
                  </div>
                </div>
              </div>

              {/* Right: Boost Packs */}
              <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-4 flex flex-col"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Need Credits Now?</h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">One-time boost packs</p>
                </div>

                <div className="flex-1 flex flex-col gap-3">
                  {boostPacks.length === 0 ? (
                    <div className="text-center text-[var(--v2-text-muted)] text-xs py-4">
                      No boost packs available
                    </div>
                  ) : (
                    boostPacks.map((pack) => {
                      const packConfig = {
                        'boost_quick': { icon: Sparkles },
                        'boost_power': { icon: Rocket },
                        'boost_mega': { icon: Crown }
                      }

                      const config = packConfig[pack.pack_key as keyof typeof packConfig] || { icon: Sparkles }
                      const Icon = config.icon
                      const hasSubscription = !!userSubscription?.stripe_subscription_id

                      return (
                        <div key={pack.id} className="relative flex-1">
                          <div className={`bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-3 hover:border-gray-300 dark:hover:border-gray-600 transition-all h-full flex items-center gap-3 ${!hasSubscription ? 'opacity-60' : ''}`}
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            <div
                              className="w-10 h-10 bg-[var(--v2-bg)] flex items-center justify-center flex-shrink-0"
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              <Icon className="h-5 w-5 text-[var(--v2-text-secondary)]" />
                            </div>

                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="text-xs font-bold text-[var(--v2-text-primary)]">{pack.display_name}</h4>
                                {pack.badge_text && (
                                  <span className="bg-[var(--v2-bg)] text-[var(--v2-text-secondary)] text-[8px] font-bold px-1.5 py-0.5 border border-gray-200 dark:border-gray-700"
                                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                                  >
                                    {pack.badge_text}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-xs flex-wrap">
                                <span className="font-bold text-[var(--v2-text-primary)]">{pack.credits_amount.toLocaleString()}</span>
                                <span className="text-[var(--v2-text-muted)]">credits</span>
                                {pack.bonus_credits > 0 && (
                                  <span className="text-[10px] font-semibold text-green-600 dark:text-green-400">+{pack.bonus_credits.toLocaleString()} bonus</span>
                                )}
                              </div>
                            </div>

                            <div className="flex-shrink-0 text-right">
                              <div className="text-sm font-bold text-[var(--v2-text-primary)] mb-1">{formatCurrency(pack.price_usd)}</div>
                              <button
                                onClick={() => handlePurchaseBoostPack(pack.id)}
                                disabled={boostPackLoading || !hasSubscription}
                                className="px-3 py-1 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white text-[10px] font-semibold hover:scale-105 transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                                style={{ borderRadius: 'var(--v2-radius-button)' }}
                                title={!hasSubscription ? 'Start a subscription first to purchase boost packs' : ''}
                              >
                                {boostPackLoading ? 'Processing...' : 'Buy Now'}
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content - Subscription Tab */}
        {activeTab === 'subscription' && (
          <div className="space-y-4">
            {/* Free Tier Status Card */}
            {userSubscription?.free_tier_expires_at && !userSubscription?.stripe_subscription_id && (
              (() => {
                const expiresAt = new Date(userSubscription.free_tier_expires_at)
                const now = new Date()
                const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
                const isExpiringSoon = daysRemaining <= 7
                const isExpired = daysRemaining <= 0
                const pilotCredits = Math.floor((userSubscription.balance || 0) / 10)

                return (
                  <div className={`border-2 p-4 ${
                    isExpired
                      ? 'bg-red-50 dark:bg-red-900/20 border-red-500 dark:border-red-600'
                      : isExpiringSoon
                      ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-500 dark:border-orange-600'
                      : 'bg-blue-50 dark:bg-blue-900/20 border-blue-500 dark:border-blue-600'
                  }`}
                    style={{ borderRadius: 'var(--v2-radius-card)' }}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 flex items-center justify-center flex-shrink-0 ${
                        isExpired
                          ? 'bg-red-500 dark:bg-red-600'
                          : isExpiringSoon
                          ? 'bg-orange-500 dark:bg-orange-600'
                          : 'bg-blue-500 dark:bg-blue-600'
                      }`}
                        style={{ borderRadius: 'var(--v2-radius-button)' }}
                      >
                        <Clock className="h-5 w-5 text-white" />
                      </div>
                      <div className="flex-1">
                        <h3 className={`text-sm font-semibold mb-1 ${
                          isExpired
                            ? 'text-red-900 dark:text-red-300'
                            : isExpiringSoon
                            ? 'text-orange-900 dark:text-orange-300'
                            : 'text-blue-900 dark:text-blue-300'
                        }`}>
                          {isExpired ? 'Free Tier Expired' : 'Free Tier Active'}
                        </h3>
                        <p className={`text-xs mb-3 ${
                          isExpired
                            ? 'text-red-800 dark:text-red-400'
                            : isExpiringSoon
                            ? 'text-orange-800 dark:text-orange-400'
                            : 'text-blue-800 dark:text-blue-400'
                        }`}>
                          {isExpired ? (
                            <>Your free tier has expired. Purchase tokens to continue using the platform.</>
                          ) : (
                            <>
                              You have <strong>{pilotCredits.toLocaleString()} Pilot Credits</strong> remaining.
                              {isExpiringSoon ? (
                                <> Your free tier expires in <strong className="text-orange-900 dark:text-orange-300">{daysRemaining} {daysRemaining === 1 ? 'day' : 'days'}</strong>. Purchase tokens to keep your credits!</>
                              ) : (
                                <> Expires in <strong>{daysRemaining} days</strong> on {expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.</>
                              )}
                            </>
                          )}
                        </p>

                        {/* Progress bar */}
                        {!isExpired && (
                          <div className="mb-3">
                            <div className="h-2 bg-white/30 dark:bg-black/30 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all ${
                                  isExpiringSoon
                                    ? 'bg-orange-600 dark:bg-orange-500'
                                    : 'bg-blue-600 dark:bg-blue-500'
                                }`}
                                style={{
                                  width: `${Math.max(0, Math.min(100, (daysRemaining / 30) * 100))}%`
                                }}
                              />
                            </div>
                            <div className="flex justify-between mt-1">
                              <span className={`text-[10px] ${
                                isExpiringSoon
                                  ? 'text-orange-700 dark:text-orange-400'
                                  : 'text-blue-700 dark:text-blue-400'
                              }`}>
                                {daysRemaining} days left
                              </span>
                              <span className={`text-[10px] ${
                                isExpiringSoon
                                  ? 'text-orange-700 dark:text-orange-400'
                                  : 'text-blue-700 dark:text-blue-400'
                              }`}>
                                30 days total
                              </span>
                            </div>
                          </div>
                        )}

                        <button
                          onClick={() => setActiveTab('credits')}
                          className={`px-3 py-1.5 text-white hover:opacity-90 transition-all text-xs font-semibold flex items-center gap-1.5 ${
                            isExpired
                              ? 'bg-red-600 dark:bg-red-700'
                              : isExpiringSoon
                              ? 'bg-orange-600 dark:bg-orange-700'
                              : 'bg-blue-600 dark:bg-blue-700'
                          }`}
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          <Rocket className="h-3.5 w-3.5" />
                          {isExpired ? 'Purchase Tokens Now' : 'Upgrade to Keep Credits'}
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })()
            )}

            {/* Subscription Details Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Started Date */}
              <div className="bg-[var(--v2-surface)] p-3"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar className="h-3.5 w-3.5 text-[var(--v2-text-secondary)]" />
                  <span className="text-[10px] font-medium text-[var(--v2-text-muted)]">
                    {(() => {
                      const isFreeTier = userSubscription?.free_tier_expires_at && !userSubscription?.stripe_subscription_id
                      return isFreeTier ? 'Free Tier Started' : 'Started'
                    })()}
                  </span>
                </div>
                <div className="text-sm font-bold text-[var(--v2-text-primary)]">
                  {(() => {
                    const isFreeTier = userSubscription?.free_tier_expires_at && !userSubscription?.stripe_subscription_id
                    const dateStr = isFreeTier
                      ? userSubscription?.free_tier_granted_at || userSubscription?.created_at
                      : userSubscription?.current_period_start || userSubscription?.created_at
                    if (!dateStr) return 'N/A'
                    return new Date(dateStr).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })
                  })()}
                </div>
              </div>

              {/* Next Billing Date / Ends On */}
              <div className={`${
                isCanceling
                  ? 'bg-[var(--v2-surface)] border-2 border-red-500 dark:border-red-600'
                  : 'bg-[var(--v2-surface)]'
              } p-3`}
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar className={`h-3.5 w-3.5 ${isCanceling ? 'text-red-600 dark:text-red-400' : 'text-[var(--v2-text-secondary)]'}`} />
                  <span className={`text-[10px] font-medium ${isCanceling ? 'text-red-600 dark:text-red-400' : 'text-[var(--v2-text-muted)]'}`}>
                    {(() => {
                      const isFreeTier = userSubscription?.free_tier_expires_at && !userSubscription?.stripe_subscription_id
                      if (isFreeTier) return 'Subscription Status'
                      return isCanceling ? 'Ends On' : 'Next Billing'
                    })()}
                  </span>
                </div>
                <div className={`text-sm font-bold ${isCanceling ? 'text-red-600 dark:text-red-400' : 'text-[var(--v2-text-primary)]'}`}>
                  {(() => {
                    const isFreeTier = userSubscription?.free_tier_expires_at && !userSubscription?.stripe_subscription_id
                    if (isFreeTier) return 'Free Tier'
                    const dateStr = userSubscription?.current_period_end
                    if (!dateStr) return 'N/A'
                    return new Date(dateStr).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })
                  })()}
                </div>
              </div>

              {/* Next Cycle Credits */}
              <div className="bg-[var(--v2-surface)] p-3"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Sparkles className={`h-3.5 w-3.5 ${isCanceling ? 'text-[var(--v2-text-muted)]' : 'text-[var(--v2-text-secondary)]'}`} />
                  <span className={`text-[10px] font-medium text-[var(--v2-text-muted)]`}>
                    Next Cycle Credits
                  </span>
                </div>
                <div className={`text-sm font-bold ${isCanceling ? 'text-[var(--v2-text-muted)] line-through' : 'text-[var(--v2-text-primary)]'}`}>
                  {(() => {
                    // Free tier users (no subscription) should see 0
                    const isFreeTier = userSubscription?.free_tier_expires_at && !userSubscription?.stripe_subscription_id
                    if (isFreeTier) return '0'

                    const monthlyAmountUsd = userSubscription?.monthly_amount_usd || 0
                    const monthlyPilotCredits = Math.round(monthlyAmountUsd / pricingConfig.pilot_credit_cost_usd)
                    return monthlyPilotCredits.toLocaleString()
                  })()}
                </div>
              </div>

              {/* Next Cycle Cost */}
              <div className="bg-[var(--v2-surface)] p-3"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <CreditCard className={`h-3.5 w-3.5 ${isCanceling ? 'text-[var(--v2-text-muted)]' : 'text-[var(--v2-text-secondary)]'}`} />
                  <span className={`text-[10px] font-medium text-[var(--v2-text-muted)]`}>
                    Next Cycle Cost
                  </span>
                </div>
                <div className={`text-sm font-bold ${isCanceling ? 'text-[var(--v2-text-muted)] line-through' : 'text-[var(--v2-text-primary)]'}`}>
                  {(() => {
                    // Free tier users (no subscription) should see $0.00
                    const isFreeTier = userSubscription?.free_tier_expires_at && !userSubscription?.stripe_subscription_id
                    if (isFreeTier) return '$0.00'

                    return `$${(userSubscription?.monthly_amount_usd || 0).toFixed(2)}`
                  })()}
                </div>
              </div>
            </div>

            {/* Cancellation Warning Banner */}
            {isCanceling && (
              <div className="bg-orange-50 dark:bg-orange-900/20 border-2 border-orange-300 dark:border-orange-700/50 p-4"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 bg-orange-500 dark:bg-orange-600 flex items-center justify-center flex-shrink-0"
                    style={{ borderRadius: 'var(--v2-radius-button)' }}
                  >
                    <AlertCircle className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-orange-900 dark:text-orange-300 mb-1">Subscription Canceling</h3>
                    <p className="text-xs text-orange-800 dark:text-orange-400 mb-2">
                      Your subscription will cancel on {(() => {
                        const dateStr = userSubscription?.current_period_end
                        if (!dateStr) return 'N/A'
                        return new Date(dateStr).toLocaleDateString('en-US', {
                          month: 'long',
                          day: 'numeric',
                          year: 'numeric'
                        })
                      })()}. You'll keep access and all your credits until then. Changed your mind?
                    </p>
                    <button
                      onClick={() => setShowReactivateModal(true)}
                      className="px-3 py-1.5 bg-orange-600 dark:bg-orange-700 text-white hover:bg-orange-700 dark:hover:bg-orange-800 transition-all text-xs font-semibold flex items-center gap-1.5"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      Reactivate Subscription
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Active Subscription Card */}
            {!isCanceling && hasActiveSubscription && (
              <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-4"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 flex items-center justify-center"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Active Subscription</h3>
                      <p className="text-xs text-[var(--v2-text-secondary)]">
                        {(() => {
                          const isFreeTier = userSubscription?.free_tier_expires_at && !userSubscription?.stripe_subscription_id
                          if (isFreeTier) return '0'

                          const monthlyAmountUsd = userSubscription?.monthly_amount_usd || 0
                          const monthlyPilotCredits = Math.round(monthlyAmountUsd / pricingConfig.pilot_credit_cost_usd)
                          return monthlyPilotCredits.toLocaleString()
                        })()} Pilot Credits/month
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleManageSubscription}
                      disabled={portalLoading}
                      className="px-3 py-2 bg-[var(--v2-primary)] text-white hover:scale-105 transition-all shadow-[var(--v2-shadow-button)] text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Update Payment
                    </button>
                    <button
                      onClick={() => setShowCancelModal(true)}
                      className="px-3 py-2 bg-red-600 dark:bg-red-700 text-white border border-red-600 dark:border-red-700 hover:bg-red-700 dark:hover:bg-red-800 transition-all text-xs font-semibold flex items-center gap-1.5"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* No Active Subscription Card */}
            {!hasActiveSubscription && (
              <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-6 text-center"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <div className="w-16 h-16 bg-gray-100 dark:bg-gray-800 flex items-center justify-center mx-auto mb-4"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  <TrendingUp className="h-8 w-8 text-gray-400 dark:text-gray-600" />
                </div>
                <h3 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-2">No Active Subscription</h3>
                <p className="text-sm text-[var(--v2-text-secondary)] mb-4">
                  Start a subscription in the Credits tab to access premium features and get monthly credits.
                </p>
                <button
                  onClick={() => setActiveTab('credits')}
                  className="px-4 py-2 bg-[var(--v2-primary)] text-white hover:scale-105 transition-all shadow-[var(--v2-shadow-button)] text-sm font-semibold"
                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                >
                  Go to Credits Tab
                </button>
              </div>
            )}

            {/* Platform Usage */}
            {hasActiveSubscription && (
              <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-4"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-3">Platform Usage</h3>

                <div className="space-y-4">
                  {/* Agents */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-[var(--v2-text-primary)]">Agents</span>
                      <span className="text-xs text-[var(--v2-text-secondary)]">
                        20 / 5 <span className="text-red-600 dark:text-red-400 font-semibold">(400.0% used)</span>
                      </span>
                    </div>
                    <div className="w-full bg-[var(--v2-bg)] h-1.5"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <div className="bg-red-500 h-1.5" style={{ width: '100%', borderRadius: 'var(--v2-radius-button)' }}></div>
                    </div>
                    <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">-15 remaining</div>
                  </div>

                  {/* Total Executions */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-[var(--v2-text-primary)]">Total Executions</span>
                      <span className="text-xs text-[var(--v2-text-secondary)]">
                        {(() => {
                          const used = userSubscription?.executions_used || 0
                          const quota = userSubscription?.executions_quota

                          if (quota === null || quota === undefined) {
                            return (
                              <>
                                {used.toLocaleString()} / ∞ <span className="text-green-600 dark:text-green-400 font-semibold">(unlimited)</span>
                              </>
                            )
                          }

                          const percentUsed = quota > 0 ? ((used / quota) * 100).toFixed(1) : '0.0'
                          const colorClass = parseFloat(percentUsed) >= 90 ? 'text-red-600 dark:text-red-400' : parseFloat(percentUsed) >= 70 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'
                          return (
                            <>
                              {used.toLocaleString()} / {quota.toLocaleString()} <span className={`${colorClass} font-semibold`}>({percentUsed}% used)</span>
                            </>
                          )
                        })()}
                      </span>
                    </div>
                    <div className="w-full bg-[var(--v2-bg)] h-1.5"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <div
                        className={(() => {
                          const used = userSubscription?.executions_used || 0
                          const quota = userSubscription?.executions_quota

                          if (quota === null || quota === undefined) {
                            return 'bg-green-500 h-1.5'
                          }

                          const percentUsed = quota > 0 ? (used / quota) * 100 : 0
                          const colorClass = percentUsed >= 90 ? 'bg-red-500' : percentUsed >= 70 ? 'bg-orange-500' : 'bg-blue-500'
                          return `${colorClass} h-1.5`
                        })()}
                        style={{
                          width: (() => {
                            const used = userSubscription?.executions_used || 0
                            const quota = userSubscription?.executions_quota

                            if (quota === null || quota === undefined) {
                              return '100%'
                            }

                            return `${quota > 0 ? Math.min((used / quota) * 100, 100) : 0}%`
                          })(),
                          borderRadius: 'var(--v2-radius-button)'
                        }}
                      ></div>
                    </div>
                    <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">
                      {(() => {
                        const used = userSubscription?.executions_used || 0
                        const quota = userSubscription?.executions_quota

                        if (quota === null || quota === undefined) {
                          return 'Unlimited executions available'
                        }

                        const remaining = Math.max(0, quota - used)
                        return `${remaining.toLocaleString()} remaining`
                      })()}
                    </div>
                  </div>

                  {/* Storage */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-[var(--v2-text-primary)]">Storage</span>
                      <span className="text-xs text-[var(--v2-text-secondary)]">
                        {(() => {
                          const used = storageUsedMB.toFixed(0)
                          const quota = storageQuotaMB
                          const percentUsed = quota > 0 ? ((storageUsedMB / quota) * 100).toFixed(1) : '0.0'
                          const colorClass = parseFloat(percentUsed) >= 90 ? 'text-red-600 dark:text-red-400' : parseFloat(percentUsed) >= 70 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600 dark:text-green-400'
                          return (
                            <>
                              {used} MB / {quota} MB <span className={`${colorClass} font-semibold`}>({percentUsed}% used)</span>
                            </>
                          )
                        })()}
                      </span>
                    </div>
                    <div className="w-full bg-[var(--v2-bg)] h-1.5"
                      style={{ borderRadius: 'var(--v2-radius-button)' }}
                    >
                      <div
                        className={(() => {
                          const percentUsed = storageQuotaMB > 0 ? (storageUsedMB / storageQuotaMB) * 100 : 0
                          const colorClass = percentUsed >= 90 ? 'bg-red-500' : percentUsed >= 70 ? 'bg-orange-500' : 'bg-green-500'
                          return `${colorClass} h-1.5`
                        })()}
                        style={{
                          width: `${storageQuotaMB > 0 ? Math.min((storageUsedMB / storageQuotaMB) * 100, 100) : 0}%`,
                          borderRadius: 'var(--v2-radius-button)'
                        }}
                      ></div>
                    </div>
                    <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">
                      {Math.max(0, storageQuotaMB - storageUsedMB).toFixed(0)} MB remaining
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'invoices' && (
          <div className="space-y-4">
            <div className="text-center mb-4">
              <h2 className="text-base font-bold text-[var(--v2-text-primary)] mb-1">Invoice History</h2>
              <p className="text-xs text-[var(--v2-text-secondary)]">View and download your past invoices</p>
            </div>

            {invoicesLoading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--v2-primary)]" />
              </div>
            ) : invoices.length === 0 ? (
              <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 p-6 text-center"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <FileText className="h-8 w-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-sm text-[var(--v2-text-secondary)]">No invoices yet</p>
                <p className="text-xs text-[var(--v2-text-muted)] mt-1">Your invoice history will appear here</p>
              </div>
            ) : (
              <div className="bg-[var(--v2-surface)] border border-gray-200 dark:border-gray-700 overflow-hidden"
                style={{ borderRadius: 'var(--v2-radius-card)' }}
              >
                <table className="w-full">
                  <thead className="bg-[var(--v2-bg)]">
                    <tr>
                      <th className="text-left py-2 px-3 text-[10px] font-semibold text-[var(--v2-text-secondary)] uppercase tracking-wider">
                        Invoice
                      </th>
                      <th className="text-left py-2 px-3 text-[10px] font-semibold text-[var(--v2-text-secondary)] uppercase tracking-wider">
                        Date
                      </th>
                      <th className="text-left py-2 px-3 text-[10px] font-semibold text-[var(--v2-text-secondary)] uppercase tracking-wider">
                        Credits
                      </th>
                      <th className="text-left py-2 px-3 text-[10px] font-semibold text-[var(--v2-text-secondary)] uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="text-left py-2 px-3 text-[10px] font-semibold text-[var(--v2-text-secondary)] uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-right py-2 px-3 text-[10px] font-semibold text-[var(--v2-text-secondary)] uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {invoices.map((invoice) => {
                      const getStatusColor = (status: string) => {
                        switch (status) {
                          case 'paid':
                            return 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          case 'open':
                            return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
                          default:
                            return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
                        }
                      }

                      const formatInvoiceDate = (timestamp: number) => {
                        return new Date(timestamp * 1000).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric'
                        })
                      }

                      return (
                        <tr key={invoice.id} className="hover:bg-[var(--v2-bg)] transition-colors">
                          <td className="py-2 px-3">
                            <div className="text-xs font-semibold text-[var(--v2-text-primary)]">
                              {invoice.number || invoice.id}
                            </div>
                            <div className="text-[10px] text-[var(--v2-text-muted)] mt-0.5">
                              {invoice.description}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="text-xs text-[var(--v2-text-primary)]">
                              {formatInvoiceDate(invoice.created)}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            {invoice.pilot_credits && (
                              <div className="text-xs text-[var(--v2-text-primary)]">
                                {new Intl.NumberFormat().format(invoice.pilot_credits)} credits
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <div className="text-xs font-semibold text-[var(--v2-text-primary)]">
                              {formatCurrency(invoice.amount_paid / 100)}
                            </div>
                          </td>
                          <td className="py-2 px-3">
                            <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-semibold ${getStatusColor(invoice.status)}`}
                              style={{ borderRadius: 'var(--v2-radius-button)' }}
                            >
                              {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {invoice.hosted_invoice_url && (
                                <a
                                  href={invoice.hosted_invoice_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  View
                                </a>
                              )}
                              {invoice.invoice_pdf && (
                                <a
                                  href={invoice.invoice_pdf}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:bg-[var(--v2-bg)] transition-colors"
                                  style={{ borderRadius: 'var(--v2-radius-button)' }}
                                >
                                  <FileText className="h-3 w-3" />
                                  PDF
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                {(hasMoreInvoices || pageHistory.length > 0) && (
                  <div className="bg-[var(--v2-surface)] p-4 border-t border-gray-200 dark:border-gray-700">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-[var(--v2-text-secondary)] font-medium">
                        Showing {invoices.length > 0 ? 1 : 0}-{invoices.length} of page {pageHistory.length + 1}
                      </p>
                      <div className="flex gap-2 items-center">
                        <button
                          onClick={goToPrevInvoicesPage}
                          disabled={invoicesLoading || pageHistory.length === 0}
                          className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-sm font-medium hover:bg-[var(--v2-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-[var(--v2-text-primary)]"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          Previous
                        </button>

                        <div className="flex gap-1">
                          <button
                            className="w-8 h-8 text-sm font-medium transition-all bg-[var(--v2-primary)] text-white shadow-md"
                            style={{ borderRadius: 'var(--v2-radius-button)' }}
                          >
                            {pageHistory.length + 1}
                          </button>
                        </div>

                        <button
                          onClick={goToNextInvoicesPage}
                          disabled={invoicesLoading || !hasMoreInvoices}
                          className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 text-sm font-medium hover:bg-[var(--v2-bg)] disabled:opacity-50 disabled:cursor-not-allowed transition-all text-[var(--v2-text-primary)]"
                          style={{ borderRadius: 'var(--v2-radius-button)' }}
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modals */}
      <ModalsV2
        showCheckoutModal={showCheckoutModal}
        clientSecret={clientSecret}
        checkoutRef={checkoutRef}
        closeCheckoutModal={closeCheckoutModal}
        modalMounted={modalMounted}
        showCancelModal={showCancelModal}
        setShowCancelModal={setShowCancelModal}
        handleCancelSubscription={handleCancelSubscription}
        cancelLoading={cancelLoading}
        userSubscription={userSubscription}
        pricingConfig={pricingConfig}
        showReactivateModal={showReactivateModal}
        setShowReactivateModal={setShowReactivateModal}
        handleReactivateSubscription={handleReactivateSubscription}
        reactivateLoading={reactivateLoading}
        showSuccessMessage={showSuccessMessage}
        setShowSuccessMessage={setShowSuccessMessage}
      />
    </>
  )
}

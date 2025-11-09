// components/settings/BillingSettings.tsx
'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import Script from 'next/script';
import {
  CreditCard,
  TrendingUp,
  TrendingDown,
  Award,
  CheckCircle2,
  Zap,
  FileText,
  AlertCircle,
  ExternalLink,
  Loader2,
  ArrowRight,
  Info,
  Calendar,
  Sparkles,
  X,
  XCircle,
  Rocket,
  Crown,
  DollarSign
} from 'lucide-react';
import { createCurrencyService, ExchangeRate } from '@/lib/services/CurrencyService';
import { formatCurrency as formatCurrencyHelper, formatCurrencyWithRate } from '@/lib/utils/currencyHelpers';
import UsageAnalytics from './UsageAnalytics';

interface UserSubscription {
  balance: number;
  total_earned: number;
  total_spent: number;
  status: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  current_period_start?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  monthly_pilot_credits?: number;
  monthly_credits?: number;
  monthly_amount_usd?: number;
}

interface BoostPack {
  id: string;
  pack_key: string;
  pack_name: string;
  display_name: string;
  description: string;
  credits_amount: number;
  bonus_credits: number;
  price_usd: number;
  badge_text?: string;
  is_active: boolean;
}

interface PricingConfig {
  pilot_credit_cost_usd: number;
  tokens_per_pilot_credit: number;
}

// Declare Stripe types for embedded checkout
declare global {
  interface Window {
    Stripe?: any;
  }
}

export default function BillingSettings() {
  const [activeTab, setActiveTab] = useState<'credits' | 'subscription' | 'invoices'>('credits');
  const [userSubscription, setUserSubscription] = useState<UserSubscription | null>(null);
  const [boostPacks, setBoostPacks] = useState<BoostPack[]>([]);
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>({
    pilot_credit_cost_usd: 0.00048,
    tokens_per_pilot_credit: 10
  });
  const [loading, setLoading] = useState(true);
  const [minSubscriptionUsd, setMinSubscriptionUsd] = useState(10); // Minimum subscription amount in USD
  const [customCredits, setCustomCredits] = useState(208330); // Start at minimum
  const [subscriptionLoading, setSubscriptionLoading] = useState(false); // For subscription purchase/update
  const [boostPackLoading, setBoostPackLoading] = useState(false); // For boost pack purchases
  const [portalLoading, setPortalLoading] = useState(false); // For managing subscription
  const [stripeLoaded, setStripeLoaded] = useState(false);
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [rewardCredits, setRewardCredits] = useState(0); // Track reward credits separately
  const [boostPackCredits, setBoostPackCredits] = useState(0); // Track boost pack credits separately

  // Multi-currency state
  const [userCurrency, setUserCurrency] = useState<string>('USD');
  const [exchangeRate, setExchangeRate] = useState<ExchangeRate | null>(null);
  const [currencyLoading, setCurrencyLoading] = useState(true);

  // Embedded checkout state
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [modalMounted, setModalMounted] = useState(false);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const stripeCheckoutRef = useRef<any>(null);

  useEffect(() => {
    fetchBillingData();
    fetchUserCurrency();

    // Listen for currency changes from other components (e.g., CurrencySelector)
    const handleCurrencyChange = () => {
      console.log('🔄 Currency changed, refreshing...');
      fetchUserCurrency();
    };

    window.addEventListener('currencyChanged', handleCurrencyChange);

    return () => {
      window.removeEventListener('currencyChanged', handleCurrencyChange);
    };
  }, []);

  // Track modal mount state for createPortal
  useEffect(() => {
    setModalMounted(true);
    return () => setModalMounted(false);
  }, []);

  // Debug log for stripeLoaded changes
  useEffect(() => {
    console.log('🔧 stripeLoaded changed to:', stripeLoaded);
  }, [stripeLoaded]);

  // Initialize embedded checkout when Stripe is loaded and modal is open with client secret
  useEffect(() => {
    console.log('🔍 Checking conditions for Stripe initialization:', {
      showCheckoutModal,
      hasClientSecret: !!clientSecret,
      stripeLoaded,
      modalMounted,
      hasWindow: typeof window !== 'undefined',
      hasStripe: typeof window !== 'undefined' && !!window.Stripe
    });

    if (showCheckoutModal && clientSecret && stripeLoaded && modalMounted && typeof window !== 'undefined' && window.Stripe) {
      console.log('✅ All conditions met, initializing embedded checkout');
      // Longer delay to ensure DOM is ready with createPortal
      setTimeout(() => initializeEmbeddedCheckout(clientSecret, 0), 300);
    }
  }, [showCheckoutModal, clientSecret, stripeLoaded, modalMounted]);

  // Detect successful checkout redirect and trigger automatic sync
  useEffect(() => {
    console.log('🔍 SUCCESS DETECTION EFFECT RUNNING');
    console.log('🔍 Current URL:', window.location.href);
    console.log('🔍 Search params:', window.location.search);

    const urlParams = new URLSearchParams(window.location.search);
    const checkoutSuccess = urlParams.get('success');

    console.log('🔍 Success param value:', checkoutSuccess);

    if (checkoutSuccess === 'true') {
      console.log('🎉 Checkout completed! Triggering automatic sync...');
      console.log('🔍 CODE VERSION: 2024-11-05-v3-SYNC-FIX');

      // Trigger sync
      fetch('/api/stripe/sync-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
        .then(res => {
          console.log('📡 Sync response status:', res.status);
          return res.json();
        })
        .then(data => {
          console.log('✅ Sync result:', data);

          // Show success message
          setShowSuccessMessage(true);
          setTimeout(() => setShowSuccessMessage(false), 5000);

          // Refresh billing data
          fetchBillingData();

          // Remove success parameter from URL
          const newUrl = window.location.pathname + '?tab=billing';
          window.history.replaceState({}, '', newUrl);
        })
        .catch(error => {
          console.error('❌ Sync failed:', error);
        });
    } else {
      console.log('ℹ️  No success parameter detected, skipping sync');
    }
  }, []);

  const fetchUserCurrency = async () => {
    try {
      setCurrencyLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.warn('⚠️ No user found, cannot fetch currency');
        return;
      }

      const currencyService = createCurrencyService(supabase);

      // Get user's preferred currency
      const currency = await currencyService.getUserCurrency(user.id);
      console.log('💱 Fetched user currency from DB:', currency);
      setUserCurrency(currency);

      // Fetch live exchange rate from API for non-USD currencies
      let rate = await currencyService.getRate(currency);
      console.log('💱 Got rate object from service:', rate);

      if (currency !== 'USD' && rate) {
        try {
          console.log('💱 Fetching live exchange rate for', currency);
          const liveRateResponse = await fetch('https://api.exchangerate-api.com/v4/latest/USD');

          if (liveRateResponse.ok) {
            const liveData = await liveRateResponse.json();
            const liveRates = liveData.rates as Record<string, number>;

            if (liveRates[currency]) {
              // Update the rate object with live data
              rate = {
                ...rate,
                rate_to_usd: liveRates[currency],
                last_updated_at: new Date().toISOString()
              };
              console.log('✅ Using live exchange rate:', currency, '=', liveRates[currency]);
            }
          }
        } catch (apiError) {
          console.warn('⚠️ Failed to fetch live rate, using database rate:', apiError);
          // Continue with database rate if API fails
        }
      }

      setExchangeRate(rate);

      console.log('💱 User currency:', { currency, rate: rate?.rate_to_usd });
    } catch (error) {
      console.error('Error fetching user currency:', error);
      // Fallback to USD
      setUserCurrency('USD');
      const currencyService = createCurrencyService(supabase);
      const usdRate = await currencyService.getRate('USD');
      setExchangeRate(usdRate);
    } finally {
      setCurrencyLoading(false);
    }
  };

  const fetchBillingData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch user subscription
      const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (subscription) {
        setUserSubscription(subscription);
      }

      // Fetch total reward credits from credit_transactions
      // Rewards have activity_type='reward_credit'
      const { data: rewardTransactions } = await supabase
        .from('credit_transactions')
        .select('credits_delta')
        .eq('user_id', user.id)
        .eq('activity_type', 'reward_credit');

      const totalRewardCredits = rewardTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0;
      setRewardCredits(totalRewardCredits);
      console.log('🎁 Total reward credits:', totalRewardCredits);

      // Fetch total boost pack credits from credit_transactions
      // Boost packs have activity_type='boost_pack_purchase'
      const { data: boostTransactions } = await supabase
        .from('credit_transactions')
        .select('credits_delta')
        .eq('user_id', user.id)
        .eq('activity_type', 'boost_pack_purchase');

      const totalBoostCredits = boostTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0;
      setBoostPackCredits(totalBoostCredits);
      console.log('⚡ Total boost pack credits:', totalBoostCredits);

      // Fetch boost packs
      const { data: packs } = await supabase
        .from('boost_packs')
        .select('*')
        .eq('is_active', true)
        .order('price_usd', { ascending: true }); // Order by price: Quick -> Power -> Mega

      setBoostPacks(packs || []);

      // Fetch pricing config including minimum subscription
      const { data: configData, error: configError } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit', 'min_subscription_usd']);

      if (configError) {
        console.error('Error fetching pricing config:', configError);
      }

      if (configData) {
        console.log('📊 Fetched pricing config:', configData);
        const configMap = new Map(configData.map(c => [c.config_key, c.config_value]));
        const pilotCreditCost = parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048');
        const tokensPerCredit = parseInt(configMap.get('tokens_per_pilot_credit') || '10');
        const minSubscriptionUsd = parseFloat(configMap.get('min_subscription_usd') || '10');

        console.log('💰 Parsed pricing:', {
          pilot_credit_cost_usd: pilotCreditCost,
          tokens_per_pilot_credit: tokensPerCredit,
          min_subscription_usd: minSubscriptionUsd
        });

        setPricingConfig({
          pilot_credit_cost_usd: pilotCreditCost,
          tokens_per_pilot_credit: tokensPerCredit
        });

        // Set minimum subscription USD (will trigger useMemo to recalculate minTokens)
        setMinSubscriptionUsd(minSubscriptionUsd);

        // Calculate for logging
        const minPilotCredits = Math.ceil(minSubscriptionUsd / pilotCreditCost);
        const calculatedMinTokens = minPilotCredits * tokensPerCredit;

        console.log(`💵 Minimum subscription: $${minSubscriptionUsd} = ${minPilotCredits} Pilot Credits = ${calculatedMinTokens} tokens`);

        // Set slider to current subscription amount, or minimum if no subscription
        // Only use monthly_credits if subscription is active (not canceled)
        const hasActiveSubscription = subscription?.status === 'active' || subscription?.status === 'past_due';
        if (hasActiveSubscription && subscription?.monthly_credits) {
          // Use monthly_credits directly (source of truth from Stripe metadata)
          const currentTokens = subscription.monthly_credits * tokensPerCredit;
          console.log(`📊 Setting slider to current subscription: ${subscription.monthly_credits} Pilot Credits = ${currentTokens} tokens`);
          setCustomCredits(currentTokens);
        } else {
          // No active subscription - set to minimum
          console.log(`📊 No active subscription (status: ${subscription?.status}), setting slider to minimum: ${calculatedMinTokens} tokens`);
          setCustomCredits(prev => prev < calculatedMinTokens ? calculatedMinTokens : prev);
        }
      } else {
        console.warn('⚠️ No pricing config data received, using defaults');
      }

    } catch (error) {
      console.error('Error fetching billing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handlePurchaseCredits = async () => {
    try {
      setSubscriptionLoading(true);

      // Check if user has active subscription - if yes, update it instead of creating new
      if (hasActiveSubscription && userSubscription?.stripe_subscription_id) {
        // Convert tokens to Pilot Credits before sending to API
        const pilotCreditsToSend = Math.round(customCredits / pricingConfig.tokens_per_pilot_credit);

        console.log('🔄 Updating existing subscription to:', pilotCreditsToSend, 'Pilot Credits (from', customCredits, 'tokens)');

        const response = await fetch('/api/stripe/update-subscription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newPilotCredits: pilotCreditsToSend
          })
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to update subscription');
        }

        const result = await response.json();
        console.log('✅ Subscription updated:', result);

        // Show success message
        setShowSuccessMessage(true);
        setTimeout(() => setShowSuccessMessage(false), 7000); // Show for 7 seconds

        // Refresh billing data with a delay to ensure webhook has processed
        setTimeout(async () => {
          await fetchBillingData();
          setSubscriptionLoading(false);
        }, 2000);
        return;
      }

      // No active subscription - create new one
      // Convert tokens to Pilot Credits before sending to API
      const pilotCreditsToSend = Math.round(customCredits / pricingConfig.tokens_per_pilot_credit);

      console.log('🛒 Starting new subscription with:', {
        purchaseType: 'custom_credits',
        pilotCredits: pilotCreditsToSend,
        tokensInState: customCredits
      });

      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseType: 'custom_credits',
          pilotCredits: pilotCreditsToSend
        })
      });

      console.log('📡 Response status:', response.status, response.statusText);

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ Checkout error:', {
          status: response.status,
          error
        });
        throw new Error(error.error || 'Failed to create checkout');
      }

      const { clientSecret: secret } = await response.json();
      console.log('✅ Got client secret, opening embedded checkout');

      if (!secret) {
        throw new Error('No client secret returned');
      }

      setClientSecret(secret);
      setShowCheckoutModal(true);
      setSubscriptionLoading(false);

      // Initialize embedded checkout will happen automatically via useEffect

    } catch (error: any) {
      console.error('❌ Error:', error);
      alert(`Error: ${error.message}. Please make sure you're logged in.`);
      setSubscriptionLoading(false);
    }
  };

  const handlePurchaseBoostPack = async (boostPackId: string) => {
    try {
      // Check if user has an active subscription
      if (!userSubscription?.stripe_subscription_id) {
        alert('You must have an active subscription before purchasing boost packs. Please start a subscription first.');
        return;
      }

      setBoostPackLoading(true);

      const response = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          purchaseType: 'boost_pack',
          boostPackId // This is now the UUID from the database
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create checkout');
      }

      const { clientSecret: secret } = await response.json();

      if (!secret) {
        throw new Error('No client secret returned');
      }

      setClientSecret(secret);
      setShowCheckoutModal(true);
      setBoostPackLoading(false);

      // Initialize embedded checkout will happen automatically via useEffect

    } catch (error: any) {
      console.error('Error creating checkout:', error);
      alert(error.message || 'Failed to start checkout process');
      setBoostPackLoading(false);
    }
  };

  const initializeEmbeddedCheckout = async (secret: string, retryCount = 0) => {
    console.log('🔧 initializeEmbeddedCheckout called', {
      retryCount,
      hasWindow: typeof window !== 'undefined',
      hasStripe: typeof window !== 'undefined' && !!window.Stripe,
      hasRef: !!checkoutRef.current,
      hasSecret: !!secret
    });

    // Safety checks - this should only be called when everything is ready
    if (typeof window === 'undefined' || !window.Stripe) {
      console.error('❌ Stripe not available');
      return;
    }

    if (!checkoutRef.current) {
      // If ref not ready, retry once after a short delay
      if (retryCount < 5) {
        console.log(`⏳ Checkout ref not ready, retry ${retryCount + 1}/5`);
        setTimeout(() => initializeEmbeddedCheckout(secret, retryCount + 1), 150);
        return;
      }
      console.error('❌ Checkout ref not available after retries');
      return;
    }

    try {
      console.log('🚀 Starting embedded checkout initialization');

      // Clear previous checkout instance
      if (stripeCheckoutRef.current) {
        console.log('🧹 Cleaning up previous checkout instance');
        stripeCheckoutRef.current.destroy();
      }

      const stripeKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!stripeKey) {
        console.error('❌ Stripe publishable key not found in environment');
        alert('Payment system configuration error. Please contact support.');
        closeCheckoutModal();
        return;
      }

      console.log('🔑 Using Stripe key:', stripeKey.substring(0, 20) + '...');
      const stripe = window.Stripe(stripeKey);
      console.log('✅ Stripe instance created');
      console.log('🔍 CODE VERSION: 2024-11-05-v2 - WITH AUTO SYNC');

      const checkout = await stripe.initEmbeddedCheckout({
        clientSecret: secret,
        onComplete: async () => {
          // Payment completed successfully - close modal and refresh data
          console.log('✅ Payment completed successfully');
          closeCheckoutModal();

          // Show success message
          setShowSuccessMessage(true);

          // Trigger manual sync via API (fallback for webhook delays)
          try {
            console.log('🔄 Triggering manual subscription sync...');
            await fetch('/api/stripe/sync-subscription', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
            console.log('✅ Manual sync triggered');
          } catch (error) {
            console.error('❌ Manual sync failed:', error);
          }

          // Refresh billing data to show updated balance
          await fetchBillingData();

          // Hide success message after 5 seconds
          setTimeout(() => setShowSuccessMessage(false), 5000);
        }
      });

      console.log('✅ Checkout instance created, mounting to ref...');

      stripeCheckoutRef.current = checkout;
      checkout.mount(checkoutRef.current);

      console.log('✅ Embedded checkout mounted successfully');
    } catch (error) {
      console.error('❌ Error initializing embedded checkout:', error);
      alert('Failed to load checkout. Please try again.');
      closeCheckoutModal();
    }
  };

  const closeCheckoutModal = () => {
    if (stripeCheckoutRef.current) {
      stripeCheckoutRef.current.destroy();
      stripeCheckoutRef.current = null;
    }
    setShowCheckoutModal(false);
    setClientSecret(null);
  };

  const handleManageSubscription = async () => {
    try {
      setPortalLoading(true);

      const response = await fetch('/api/stripe/create-portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to open customer portal');
      }

      const { url } = await response.json();
      window.location.href = url;

    } catch (error: any) {
      console.error('Error opening portal:', error);
      alert(error.message || 'Failed to open subscription management');
      setPortalLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    try {
      setCancelLoading(true);

      const response = await fetch('/api/stripe/cancel-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cancel subscription');
      }

      // Refresh billing data
      await fetchBillingData();
      setShowCancelModal(false);

    } catch (error: any) {
      console.error('Error canceling subscription:', error);
      alert(error.message || 'Failed to cancel subscription');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleReactivateSubscription = async () => {
    try {
      setReactivateLoading(true);

      const response = await fetch('/api/stripe/reactivate-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to reactivate subscription');
      }

      // Refresh billing data
      await fetchBillingData();
      setShowReactivateModal(false);

    } catch (error: any) {
      console.error('Error reactivating subscription:', error);
      alert(error.message || 'Failed to reactivate subscription');
    } finally {
      setReactivateLoading(false);
    }
  };

  const calculatePrice = (tokens: number) => {
    // Convert tokens to Pilot Credits first, then calculate price
    const pilotCredits = tokens / pricingConfig.tokens_per_pilot_credit;
    return pilotCredits * pricingConfig.pilot_credit_cost_usd;
  };

  const calculatePriceInUserCurrency = (priceUsd: number) => {
    // Calculate equivalent in user's currency for display only
    console.log('💰 Calculating price in user currency:', {
      priceUsd,
      userCurrency,
      exchangeRate: exchangeRate?.rate_to_usd,
      hasExchangeRate: !!exchangeRate
    });

    if (exchangeRate && userCurrency !== 'USD') {
      const converted = priceUsd * exchangeRate.rate_to_usd;
      console.log('💰 Converted price:', converted);
      return converted;
    }
    return priceUsd;
  };

  const formatCredits = (tokens: number) => {
    // Convert tokens to Pilot Credits (1 Pilot Credit = 10 tokens)
    const pilotCredits = tokens / pricingConfig.tokens_per_pilot_credit;
    return new Intl.NumberFormat().format(pilotCredits);
  };

  // Always format in USD since all charges are in USD
  const formatCurrency = (amount: number) => {
    return formatCurrencyHelper(amount, 'USD');
  };

  // Format in user's currency for reference calculator
  const formatCurrencyConverted = (amount: number) => {
    console.log('💵 Formatting converted currency:', {
      amount,
      userCurrency,
      exchangeRate: exchangeRate?.currency_code,
      rateValue: exchangeRate?.rate_to_usd
    });

    if (exchangeRate && userCurrency !== 'USD') {
      const formatted = formatCurrencyWithRate(amount, exchangeRate);
      console.log('💵 Formatted result:', formatted);
      return formatted;
    }
    return null; // Return null if same as USD
  };

  if (loading || currencyLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  const hasActiveSubscription = userSubscription?.stripe_subscription_id && userSubscription?.status === 'active';

  return (
    <>
      {/* Load Stripe.js */}
      <Script
        src="https://js.stripe.com/v3/"
        onLoad={() => {
          console.log('✅ Stripe.js loaded');
          setStripeLoaded(true);
        }}
        onError={() => {
          console.error('❌ Failed to load Stripe.js');
        }}
      />

      <div className="space-y-4">
        {/* Stats Cards - Compact Single Line */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* 1. Status - First card - Always show with correct status */}
          <div className={`bg-gradient-to-br border rounded-lg p-2.5 hover:shadow-md transition-all duration-300 ${
            userSubscription?.status === 'active' || userSubscription?.status === 'past_due'
              ? 'from-green-50 to-emerald-50 border-green-200/50'
              : 'from-gray-50 to-slate-50 border-gray-200/50'
          }`}>
            <div className="flex items-center gap-2">
              <div className={`w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm ${
                userSubscription?.status === 'active' || userSubscription?.status === 'past_due'
                  ? 'from-green-500 to-emerald-600'
                  : 'from-gray-500 to-slate-600'
              }`}>
                {userSubscription?.status === 'active' || userSubscription?.status === 'past_due' ? (
                  <CheckCircle2 className="h-4 w-4 text-white" />
                ) : (
                  <XCircle className="h-4 w-4 text-white" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-[10px] font-medium ${
                  userSubscription?.status === 'active' || userSubscription?.status === 'past_due'
                    ? 'text-green-700'
                    : 'text-gray-700'
                }`}>Status</p>
                <p className={`text-base font-bold ${
                  userSubscription?.status === 'active' || userSubscription?.status === 'past_due'
                    ? 'text-green-900'
                    : 'text-gray-900'
                }`}>
                  {(() => {
                    const status = userSubscription?.status || 'inactive';
                    return status.charAt(0).toUpperCase() + status.slice(1);
                  })()}
                </p>
                <p className={`text-[9px] ${
                  userSubscription?.status === 'active' || userSubscription?.status === 'past_due'
                    ? 'text-green-600/70'
                    : 'text-gray-600/70'
                }`}>
                  {userSubscription?.status === 'active' || userSubscription?.status === 'past_due'
                    ? 'Currently active'
                    : 'No active subscription'}
                </p>
              </div>
            </div>
          </div>

          {/* 2. Available Credits */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200/50 rounded-lg p-2.5 hover:shadow-md transition-all duration-300">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-blue-700 font-medium">Available</p>
                <p className="text-base font-bold text-blue-900">{formatCredits(userSubscription?.balance || 0)}</p>
                <p className="text-[9px] text-blue-600/70">Current balance</p>
              </div>
            </div>
          </div>

          {/* 3. Monthly Subscription */}
          <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200/50 rounded-lg p-2.5 hover:shadow-md transition-all duration-300">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                <CreditCard className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-green-700 font-medium">Monthly</p>
                <p className="text-base font-bold text-green-900">
                  {(() => {
                    // Only show monthly credits if subscription is active or past_due
                    const isActive = userSubscription?.status === 'active' || userSubscription?.status === 'past_due';
                    return isActive ? (userSubscription?.monthly_credits || 0).toLocaleString() : '0';
                  })()}
                </p>
                <p className="text-[9px] text-green-600/70">Per month</p>
              </div>
            </div>
          </div>

          {/* 4. Boost Packs */}
          <div className="bg-gradient-to-br from-orange-50 to-red-50 border border-orange-200/50 rounded-lg p-2.5 hover:shadow-md transition-all duration-300">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                <Rocket className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-orange-700 font-medium">Boost</p>
                <p className="text-base font-bold text-orange-900">{formatCredits(boostPackCredits)}</p>
                <p className="text-[9px] text-orange-600/70">Purchased</p>
              </div>
            </div>
          </div>

          {/* 5. Rewards */}
          <div className="bg-gradient-to-br from-yellow-50 to-amber-50 border border-yellow-200/50 rounded-lg p-2.5 hover:shadow-md transition-all duration-300">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-yellow-500 to-amber-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                <Award className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-yellow-700 font-medium">Rewards</p>
                <p className="text-base font-bold text-yellow-900">{formatCredits(rewardCredits)}</p>
                <p className="text-[9px] text-yellow-600/70">Total earned</p>
              </div>
            </div>
          </div>

          {/* 6. Spent */}
          <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200/50 rounded-lg p-2.5 hover:shadow-md transition-all duration-300">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                <TrendingDown className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-purple-700 font-medium">Used</p>
                <p className="text-base font-bold text-purple-900">{formatCredits(userSubscription?.total_spent || 0)}</p>
                <p className="text-[9px] text-purple-600/70">All-time</p>
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-gray-100/80 rounded-xl p-1">
          {[
            { id: 'credits', label: 'Credits', icon: CreditCard },
            { id: 'subscription', label: 'Subscription', icon: TrendingUp },
            { id: 'invoices', label: 'Invoices', icon: FileText }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'credits' && (
          <CreditsTab
            userSubscription={userSubscription}
            pricingConfig={pricingConfig}
            customCredits={customCredits}
            setCustomCredits={setCustomCredits}
            subscriptionLoading={subscriptionLoading}
            boostPackLoading={boostPackLoading}
            handlePurchaseCredits={handlePurchaseCredits}
            handleManageSubscription={handleManageSubscription}
            handlePurchaseBoostPack={handlePurchaseBoostPack}
            calculatePrice={calculatePrice}
            calculatePriceInUserCurrency={calculatePriceInUserCurrency}
            formatCredits={formatCredits}
            formatCurrency={formatCurrency}
            formatCurrencyConverted={formatCurrencyConverted}
            hasActiveSubscription={hasActiveSubscription}
            minSubscriptionUsd={minSubscriptionUsd}
            boostPacks={boostPacks}
            isCanceling={userSubscription?.cancel_at_period_end || false}
            setShowReactivateModal={setShowReactivateModal}
          />
        )}

        {activeTab === 'subscription' && (
          <SubscriptionInfoTab
            userSubscription={userSubscription}
            pricingConfig={pricingConfig}
            handleManageSubscription={handleManageSubscription}
            setShowCancelModal={setShowCancelModal}
            setShowReactivateModal={setShowReactivateModal}
            portalLoading={portalLoading}
          />
        )}

        {activeTab === 'invoices' && (
          <InvoicesTab />
        )}
      </div>

      {/* Embedded Checkout Modal */}
      {modalMounted && showCheckoutModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-md"
            onClick={closeCheckoutModal}
          />
          <div className="relative bg-white/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/20 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            {/* Close button */}
            <button
              onClick={closeCheckoutModal}
              className="absolute top-4 right-4 p-2 hover:bg-slate-100 rounded-full transition-colors z-10"
            >
              <X className="h-5 w-5 text-slate-600" />
            </button>

            {/* Header */}
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900">Complete Your Purchase</h2>
              <p className="text-slate-600 mt-1">Securely complete your payment with Stripe</p>
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
      {modalMounted && showCancelModal && userSubscription && createPortal((() => {
        const monthlyAmountUsd = userSubscription.monthly_amount_usd || 0;
        const monthlyPilotCredits = Math.round(monthlyAmountUsd / pricingConfig.pilot_credit_cost_usd);
        const currentBalance = userSubscription.balance || 0;
        const currentPilotCredits = Math.floor(currentBalance / pricingConfig.tokens_per_pilot_credit);

        const formatDate = (dateString: string) => {
          if (!dateString) return 'N/A';
          return new Date(dateString).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          });
        };

        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/30 backdrop-blur-md" />
            <div className="relative bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 max-w-lg w-full p-6">
              {/* Icon */}
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="h-6 w-6 text-red-600" />
              </div>

              {/* Content */}
              <h2 className="text-xl font-bold text-slate-900 text-center mb-2">
                Cancel Subscription?
              </h2>
              <p className="text-sm text-slate-600 text-center mb-4">
                Here's what will happen when you cancel:
              </p>

              {/* Information Cards */}
              <div className="space-y-3 mb-6">
                {/* Current Balance */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium text-blue-900">You'll Keep Your Credits</span>
                    </div>
                    <span className="text-sm font-bold text-blue-900">
                      {currentPilotCredits.toLocaleString()} credits
                    </span>
                  </div>
                  <p className="text-xs text-blue-700 mt-1 ml-6">
                    Your current balance remains available with no expiration
                  </p>
                </div>

                {/* Access Until */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-green-600" />
                      <span className="text-sm font-medium text-green-900">Access Until</span>
                    </div>
                    <span className="text-sm font-bold text-green-900">
                      {formatDate(userSubscription.current_period_end)}
                    </span>
                  </div>
                  <p className="text-xs text-green-700 mt-1 ml-6">
                    You've already paid for this period
                  </p>
                </div>

                {/* No Future Charges */}
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <XCircle className="h-4 w-4 text-orange-600" />
                      <span className="text-sm font-medium text-orange-900">No More Charges</span>
                    </div>
                    <span className="text-sm font-bold text-orange-900">
                      ${monthlyAmountUsd.toFixed(2)}/mo
                    </span>
                  </div>
                  <p className="text-xs text-orange-700 mt-1 ml-6">
                    Starting {formatDate(userSubscription.current_period_end)}
                  </p>
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={() => setShowCancelModal(false)}
                  disabled={cancelLoading}
                  className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-all text-sm font-medium disabled:opacity-50"
                >
                  Keep Subscription
                </button>
                <button
                  onClick={handleCancelSubscription}
                  disabled={cancelLoading}
                  style={{
                    backgroundColor: '#dc2626',
                    color: '#ffffff',
                    borderColor: '#dc2626'
                  }}
                  className="flex-1 px-4 py-2.5 rounded-lg hover:bg-red-700 transition-colors text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
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
          </div>
        );
      })(), document.body)}

      {/* Reactivate Subscription Modal */}
      {modalMounted && showReactivateModal && userSubscription && createPortal((() => {
        const monthlyAmountUsd = userSubscription.monthly_amount_usd || 0;
        const monthlyPilotCredits = userSubscription.monthly_credits || 0;

        // Format date helper
        const formatDate = (dateString: string) => {
          if (!dateString) return 'N/A';
          return new Date(dateString).toLocaleDateString('en-US', {
            month: 'long',
            day: 'numeric',
            year: 'numeric'
          });
        };

        return (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
            {/* Full-screen backdrop */}
            <div
              className="absolute inset-0 bg-black/30 backdrop-blur-md"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            />

            {/* Modal content */}
            <div className="relative bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-white/20 max-w-lg w-full p-6">
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">Reactivate Subscription</h2>
                  <p className="text-sm text-slate-600 mt-1">
                    Resume your subscription and continue enjoying uninterrupted access.
                  </p>
                </div>
                <button
                  onClick={() => setShowReactivateModal(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors p-1"
                  disabled={reactivateLoading}
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Information Cards */}
              <div className="space-y-3 mb-6">
                {/* Monthly Credits */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Zap className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-blue-600 font-medium">Monthly Credits</p>
                    <p className="text-sm font-bold text-blue-900">{monthlyPilotCredits.toLocaleString()} credits</p>
                  </div>
                </div>

                {/* Next Billing Date */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <Calendar className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-green-600 font-medium">Next Billing Date</p>
                    <p className="text-sm font-bold text-green-900">{formatDate(userSubscription.current_period_end)}</p>
                  </div>
                </div>

                {/* Monthly Amount */}
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <DollarSign className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-xs text-purple-600 font-medium">Monthly Amount</p>
                    <p className="text-sm font-bold text-purple-900">${monthlyAmountUsd.toFixed(2)}/mo</p>
                  </div>
                </div>
              </div>

              {/* What happens info */}
              <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4 mb-6">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <CheckCircle2 className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-green-900 mb-1">What happens when you reactivate?</h3>
                    <ul className="text-xs text-green-800 space-y-1">
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 mt-0.5">•</span>
                        <span>Your subscription will continue as normal</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 mt-0.5">•</span>
                        <span>You'll be billed ${monthlyAmountUsd.toFixed(2)} on {formatDate(userSubscription.current_period_end)}</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 mt-0.5">•</span>
                        <span>You'll receive {monthlyPilotCredits.toLocaleString()} credits each billing cycle</span>
                      </li>
                      <li className="flex items-start gap-2">
                        <span className="text-green-600 mt-0.5">•</span>
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
                  className="flex-1 px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-all text-sm font-medium disabled:opacity-50"
                >
                  Not Now
                </button>
                <button
                  onClick={handleReactivateSubscription}
                  disabled={reactivateLoading}
                  className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
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
          </div>
        );
      })(), document.body)}

      {/* Success Notification Toast */}
      {showSuccessMessage && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2">
          <div className="bg-green-50 border-2 border-green-500 rounded-xl shadow-2xl p-4 flex items-center gap-3 max-w-md">
            <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-green-900">Payment Successful!</h3>
              <p className="text-sm text-green-700">Your credits will be added shortly.</p>
            </div>
            <button
              onClick={() => setShowSuccessMessage(false)}
              className="text-green-700 hover:text-green-900 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// Credits Tab Component - Calculator and Purchase Interface
function CreditsTab({
  userSubscription,
  pricingConfig,
  customCredits,
  setCustomCredits,
  subscriptionLoading,
  boostPackLoading,
  handlePurchaseCredits,
  handleManageSubscription,
  handlePurchaseBoostPack,
  calculatePrice,
  calculatePriceInUserCurrency,
  formatCredits,
  formatCurrency,
  formatCurrencyConverted,
  hasActiveSubscription,
  minSubscriptionUsd,
  boostPacks,
  isCanceling,
  setShowReactivateModal
}: any) {
  const estimatedPrice = calculatePrice(customCredits);
  const convertedPrice = calculatePriceInUserCurrency(estimatedPrice);

  // Calculate minimum values from database config
  // minSubscriptionUsd is in USD (e.g., $10)
  // pilot_credit_cost_usd is cost per Pilot Credit (e.g., $0.01)
  // tokens_per_pilot_credit is tokens per Pilot Credit (e.g., 10)
  const minCredits = Math.ceil(minSubscriptionUsd / pricingConfig.pilot_credit_cost_usd); // e.g., $10 / $0.01 = 1000 Pilot Credits
  const minTokens = minCredits * pricingConfig.tokens_per_pilot_credit; // e.g., 1000 * 10 = 10,000 tokens

  // Calculate current subscription tokens for comparison
  // Use monthly_credits directly (same as slider initialization)
  const currentSubscriptionTokens = hasActiveSubscription && userSubscription?.monthly_credits
    ? userSubscription.monthly_credits * pricingConfig.tokens_per_pilot_credit
    : 0;

  // Check if amount has changed from current subscription
  // Allow small tolerance for rounding differences (slider steps are 1000, so check if difference is >= 1000)
  const hasAmountChanged = !hasActiveSubscription || Math.abs(customCredits - currentSubscriptionTokens) >= 1000;

  console.log('💵 Calculator state:', {
    minSubscriptionUsd,
    minCredits,
    minTokens,
    customCredits,
    currentSubscriptionTokens,
    difference: Math.abs(customCredits - currentSubscriptionTokens),
    hasAmountChanged,
    pricing: pricingConfig
  });

  return (
    <div className="space-y-4 relative">
      {/* Canceling Overlay */}
      {isCanceling && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 rounded-xl flex items-center justify-center">
          <div className="text-center p-6 max-w-md">
            <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-8 w-8 text-orange-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Subscription Canceling</h3>
            <p className="text-sm text-slate-600 mb-4">
              You can't purchase or update credits while your subscription is set to cancel.
              Reactivate your subscription to continue using this feature.
            </p>
            <button
              onClick={() => setShowReactivateModal(true)}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all text-sm font-semibold"
            >
              Reactivate Subscription
            </button>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div className="bg-blue-50/50 border border-blue-200/50 rounded-xl p-3 flex items-start gap-2">
        <Info className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-xs font-medium text-blue-900">How Pilot Credits Work</p>
          <p className="text-xs text-blue-700 mt-0.5">
            Purchase a custom amount of Pilot Credits each month. Credits roll over completely (no expiration).
          </p>
        </div>
      </div>

      {/* Two Column Layout - Equal Heights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:items-stretch">
        {/* Left: Purchase Custom Credits */}
        <div className="bg-white border border-slate-200/50 rounded-xl p-4 flex flex-col">
          <div className="mb-4">
            <h2 className="text-base font-semibold text-slate-900 mb-1">
              {hasActiveSubscription ? 'Update Subscription' : 'Start Subscription'}
            </h2>
            <p className="text-xs text-slate-600">
              {hasActiveSubscription
                ? 'Change your monthly credit amount (takes effect next billing cycle)'
                : 'Choose how many Pilot Credits you need each month'
              }
            </p>
          </div>

          {/* Credit Amount Slider */}
          <div className="space-y-4 flex-1 flex flex-col">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-700">Monthly Pilot Credits</label>
              <div className="text-right">
                <div className="text-lg font-bold text-slate-900">{formatCredits(customCredits)}</div>
                <div className="text-[10px] text-slate-500">credits/month</div>
              </div>
            </div>

            <input
              type="range"
              min={minTokens}
              max="10000000"
              step="1000"
              value={customCredits}
              onChange={(e) => setCustomCredits(parseInt(e.target.value))}
              className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, rgb(59 130 246) 0%, rgb(147 51 234) ${((customCredits - minTokens) / (10000000 - minTokens)) * 100}%, rgb(226 232 240) ${((customCredits - minTokens) / (10000000 - minTokens)) * 100}%, rgb(226 232 240) 100%)`
              }}
            />

            <div className="flex justify-between text-[10px] text-slate-500">
              <span>{formatCredits(minTokens)} (min)</span>
              <span>10,000,000</span>
            </div>
          </div>

          {/* Quick Select Buttons */}
          <div className="grid grid-cols-4 gap-1.5">
            {(() => {
              // Create sensible preset amounts: minimum, 2x min, 5x min, 10x min
              const presets = [
                minTokens,                    // $10 (minimum)
                Math.round(minTokens * 2.5),  // $25
                Math.round(minTokens * 5),    // $50
                Math.round(minTokens * 10)    // $100
              ];
              return presets.map(amount => (
                <button
                  key={amount}
                  onClick={() => setCustomCredits(amount)}
                  className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    customCredits === amount
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  {formatCredits(amount)}
                </button>
              ));
            })()}
          </div>

          {/* Price Breakdown */}
          <div className="bg-gradient-to-br from-blue-50/50 to-purple-50/50 rounded-xl p-3 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-700">Pilot Credits</span>
              <span className="text-xs font-semibold text-slate-900">{formatCredits(customCredits)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-700">Price per Credit</span>
              <span className="font-mono text-[10px] text-slate-900">
                {formatCurrencyHelper(pricingConfig.pilot_credit_cost_usd, 'USD', { decimalPlaces: 5 })}
              </span>
            </div>
            <div className="border-t border-blue-200/50 pt-2 flex justify-between items-center">
              <span className="text-sm font-semibold text-slate-900">Monthly Total</span>
              <div className="text-right">
                <div className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-purple-600">
                  {formatCurrency(estimatedPrice)} USD
                </div>
                {formatCurrencyConverted(convertedPrice) && (
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    ≈ {formatCurrencyConverted(convertedPrice)}
                  </div>
                )}
                <div className="text-[10px] text-slate-500">per month</div>
              </div>
            </div>
          </div>

          {/* Spacer to push button to bottom */}
          <div className="flex-1"></div>

          {/* Purchase Button */}
          <div className="mt-4">
            <button
              onClick={handlePurchaseCredits}
              disabled={subscriptionLoading || customCredits < 1000 || !hasAmountChanged || isCanceling}
              className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-md hover:shadow-lg text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
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

            <p className="text-[10px] text-center text-slate-500 mt-2">
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
        <div className="bg-gradient-to-br from-purple-50/30 to-pink-50/30 border border-purple-200/30 rounded-xl p-4 flex flex-col">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Need Credits Now?</h3>
            <p className="text-xs text-slate-600">One-time boost packs</p>
          </div>

          {/* Boost Packs - Stacked Vertically with Equal Heights */}
          <div className="flex-1 flex flex-col gap-3">
            {boostPacks.length === 0 ? (
              <div className="text-center text-slate-500 text-xs py-4">
                No boost packs available
              </div>
            ) : (
              boostPacks.map((pack, index) => {
                // Map pack_key to icon and gradient
                const packConfig = {
                  'boost_quick': { icon: 'sparkles', gradient: 'from-blue-500 to-cyan-500' },
                  'boost_power': { icon: 'rocket', gradient: 'from-purple-500 to-pink-500' },
                  'boost_mega': { icon: 'crown', gradient: 'from-orange-500 to-red-500' }
                };

                const config = packConfig[pack.pack_key as keyof typeof packConfig] || { icon: 'sparkles', gradient: 'from-blue-500 to-cyan-500' };

                // Use pre-calculated credits from database (no runtime calculation!)
                // Just read the values directly from DB
                const convertedPrice = calculatePriceInUserCurrency(pack.price_usd);
                const hasSubscription = !!userSubscription?.stripe_subscription_id;

                return (
                  <div key={pack.id} className="relative flex-1">
                    {/* Card - Full Height */}
                    <div className={`bg-white border border-slate-200 rounded-lg p-3 hover:border-purple-300 hover:shadow-sm transition-all h-full flex flex-col justify-center ${!hasSubscription ? 'opacity-60' : ''}`}>
                      <div className="flex items-center gap-3">
                        {/* Icon and Name */}
                        <div className="flex-shrink-0">
                          <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${config.gradient} flex items-center justify-center`}>
                            {config.icon === 'sparkles' && <Sparkles className="h-5 w-5 text-white" />}
                            {config.icon === 'rocket' && <Rocket className="h-5 w-5 text-white" />}
                            {config.icon === 'crown' && <Crown className="h-5 w-5 text-white" />}
                          </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h4 className="text-xs font-bold text-slate-900">{pack.display_name}</h4>
                            {pack.badge_text && (
                              <span className={`bg-gradient-to-r ${config.gradient} text-white text-[8px] font-bold px-1.5 py-0.5 rounded`}>
                                {pack.badge_text}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-xs flex-wrap">
                            <span className="font-bold text-slate-900">{pack.credits_amount.toLocaleString()}</span>
                            <span className="text-slate-500">credits</span>
                            {pack.bonus_credits > 0 && (
                              <span className="text-[10px] font-semibold text-green-600">+{pack.bonus_credits.toLocaleString()} bonus</span>
                            )}
                          </div>
                        </div>

                        {/* Price and Button */}
                        <div className="flex-shrink-0 text-right">
                          <div className="text-sm font-bold text-slate-900 mb-1">{formatCurrency(pack.price_usd)}</div>
                          <button
                            onClick={() => handlePurchaseBoostPack(pack.id)}
                            disabled={boostPackLoading || !hasSubscription}
                            className={`px-3 py-1 bg-gradient-to-r ${config.gradient} text-white text-[10px] font-semibold rounded-md hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap`}
                            title={!hasSubscription ? 'Start a subscription first to purchase boost packs' : ''}
                          >
                            {boostPackLoading ? 'Processing...' : 'Buy Now'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// Subscription Info Tab Component - Shows subscription details and platform usage
function SubscriptionInfoTab({
  userSubscription,
  pricingConfig,
  handleManageSubscription,
  setShowCancelModal,
  setShowReactivateModal,
  portalLoading
}: any) {
  // Calculate monthly Pilot Credits from monthly_amount_usd
  const monthlyAmountUsd = userSubscription?.monthly_amount_usd || 0;
  const monthlyPilotCredits = Math.round(monthlyAmountUsd / pricingConfig.pilot_credit_cost_usd);

  // Format dates
  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  return (
    <div className="space-y-4">
      {/* Subscription Details Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        {/* Started Date */}
        <div className="bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-200 rounded-xl p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className="h-3.5 w-3.5 text-blue-600" />
            <span className="text-[10px] font-medium text-blue-900">Started</span>
          </div>
          <div className="text-sm font-bold text-blue-900">
            {formatDate(userSubscription?.current_period_start || userSubscription?.created_at)}
          </div>
        </div>

        {/* Next Billing Date / Ends On */}
        <div className={`bg-gradient-to-br ${userSubscription?.cancel_at_period_end ? 'from-red-50 to-orange-50 border-red-200' : 'from-green-50 to-emerald-50 border-green-200'} border rounded-xl p-3`}>
          <div className="flex items-center gap-1.5 mb-1">
            <Calendar className={`h-3.5 w-3.5 ${userSubscription?.cancel_at_period_end ? 'text-red-600' : 'text-green-600'}`} />
            <span className={`text-[10px] font-medium ${userSubscription?.cancel_at_period_end ? 'text-red-900' : 'text-green-900'}`}>
              {userSubscription?.cancel_at_period_end ? 'Ends On' : 'Next Billing'}
            </span>
          </div>
          <div className={`text-sm font-bold ${userSubscription?.cancel_at_period_end ? 'text-red-900' : 'text-green-900'}`}>
            {formatDate(userSubscription?.current_period_end)}
          </div>
        </div>

        {/* Next Cycle Credits */}
        <div className={`bg-gradient-to-br ${userSubscription?.cancel_at_period_end ? 'from-gray-50 to-slate-50 border-gray-300' : 'from-orange-50 to-amber-50 border-orange-200'} border rounded-xl p-3`}>
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles className={`h-3.5 w-3.5 ${userSubscription?.cancel_at_period_end ? 'text-gray-400' : 'text-orange-600'}`} />
            <span className={`text-[10px] font-medium ${userSubscription?.cancel_at_period_end ? 'text-gray-500' : 'text-orange-900'}`}>Next Cycle Credits</span>
          </div>
          <div className={`text-sm font-bold ${userSubscription?.cancel_at_period_end ? 'text-gray-500 line-through' : 'text-orange-900'}`}>
            {monthlyPilotCredits.toLocaleString()}
          </div>
        </div>

        {/* Next Cycle Cost */}
        <div className={`bg-gradient-to-br ${userSubscription?.cancel_at_period_end ? 'from-gray-50 to-slate-50 border-gray-300' : 'from-purple-50 to-pink-50 border-purple-200'} border rounded-xl p-3`}>
          <div className="flex items-center gap-1.5 mb-1">
            <CreditCard className={`h-3.5 w-3.5 ${userSubscription?.cancel_at_period_end ? 'text-gray-400' : 'text-purple-600'}`} />
            <span className={`text-[10px] font-medium ${userSubscription?.cancel_at_period_end ? 'text-gray-500' : 'text-purple-900'}`}>Next Cycle Cost</span>
          </div>
          <div className={`text-sm font-bold ${userSubscription?.cancel_at_period_end ? 'text-gray-500 line-through' : 'text-purple-900'}`}>
            ${monthlyAmountUsd.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Cancellation Warning Banner */}
      {userSubscription?.cancel_at_period_end && (
        <div className="bg-gradient-to-br from-orange-50 to-red-50 border-2 border-orange-300 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 bg-orange-500 rounded-lg flex items-center justify-center flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-orange-900 mb-1">Subscription Canceling</h3>
              <p className="text-xs text-orange-800 mb-2">
                Your subscription will cancel on {formatDate(userSubscription.current_period_end)}. You'll keep access and all your credits until then. Changed your mind?
              </p>
              <button
                onClick={() => setShowReactivateModal(true)}
                className="px-3 py-1.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-all text-xs font-semibold flex items-center gap-1.5"
              >
                Reactivate Subscription
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Active Subscription Card */}
      {!userSubscription?.cancel_at_period_end && (
        <div className="bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Active Subscription</h3>
                <p className="text-xs text-slate-600">
                  {monthlyPilotCredits.toLocaleString()} Pilot Credits/month
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleManageSubscription}
                disabled={portalLoading}
                className="px-3 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-md hover:shadow-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Update Payment
              </button>
              <button
                onClick={() => setShowCancelModal(true)}
                style={{
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  border: '1px solid #dc2626'
                }}
                className="px-3 py-2 rounded-lg hover:bg-red-700 transition-all text-xs font-semibold flex items-center gap-1.5"
              >
                <XCircle className="h-3.5 w-3.5" />
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Platform Usage */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <h3 className="text-base font-semibold text-slate-900 mb-3">Platform Usage</h3>

        <div className="space-y-4">
          {/* Agents */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-700">Agents</span>
              <span className="text-xs text-slate-600">
                20 / 5 <span className="text-red-600 font-semibold">(400.0% used)</span>
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div className="bg-gradient-to-r from-red-500 to-red-600 h-1.5 rounded-full" style={{ width: '100%' }}></div>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">-15 remaining</div>
          </div>

          {/* Executions Today */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-700">Executions Today</span>
              <span className="text-xs text-slate-600">
                0 / 100 <span className="text-green-600 font-semibold">(0.0% used)</span>
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div className="bg-gradient-to-r from-green-500 to-green-600 h-1.5 rounded-full" style={{ width: '0%' }}></div>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">100 remaining</div>
          </div>

          {/* Storage */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium text-slate-700">Storage</span>
              <span className="text-xs text-slate-600">
                150 MB / 500 MB <span className="text-blue-600 font-semibold">(30.0% used)</span>
              </span>
            </div>
            <div className="w-full bg-slate-200 rounded-full h-1.5">
              <div className="bg-gradient-to-r from-blue-500 to-blue-600 h-1.5 rounded-full" style={{ width: '30%' }}></div>
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">350 MB remaining</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Invoices Tab Component
function InvoicesTab() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [pageHistory, setPageHistory] = useState<string[]>([]); // Stack of starting_after IDs
  const [currentPageLastId, setCurrentPageLastId] = useState<string | null>(null);

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async (startingAfter?: string, direction: 'next' | 'prev' | 'initial' = 'initial') => {
    try {
      setLoading(true);

      // Fetch from Stripe API endpoint with pagination
      const url = new URL('/api/stripe/invoices', window.location.origin);
      url.searchParams.set('limit', '10');
      if (startingAfter) {
        url.searchParams.set('starting_after', startingAfter);
      }

      const response = await fetch(url.toString());
      const data = await response.json();

      if (response.ok) {
        setInvoices(data.invoices || []);
        setHasMore(data.has_more || false);
        setCurrentPageLastId(data.last_invoice_id || null);

        // Update page history for prev button
        if (direction === 'next' && startingAfter) {
          setPageHistory(prev => [...prev, startingAfter]);
        } else if (direction === 'prev') {
          setPageHistory(prev => prev.slice(0, -1));
        }
      } else {
        console.error('Error fetching invoices:', data.error);
        setInvoices([]);
      }
    } catch (error) {
      console.error('Error fetching invoices:', error);
      setInvoices([]);
    } finally {
      setLoading(false);
    }
  };

  const goToNextPage = () => {
    if (currentPageLastId && hasMore) {
      fetchInvoices(currentPageLastId, 'next');
    }
  };

  const goToPrevPage = () => {
    if (pageHistory.length > 0) {
      const prevStartingAfter = pageHistory[pageHistory.length - 1];
      // Go back to previous page
      if (pageHistory.length === 1) {
        // Going back to first page
        fetchInvoices(undefined, 'prev');
      } else {
        // Going back to a middle page
        const pageBeforePrev = pageHistory[pageHistory.length - 2];
        fetchInvoices(pageBeforePrev, 'prev');
      }
    }
  };

  const formatCurrency = (amount: string | number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(typeof amount === 'string' ? parseFloat(amount) : amount);
  };

  const formatDate = (timestamp: number) => {
    // Stripe timestamps are in seconds, JavaScript Date expects milliseconds
    return new Date(timestamp * 1000).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-green-100 text-green-700';
      case 'open':
        return 'bg-yellow-100 text-yellow-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-center mb-4">
        <h2 className="text-base font-bold text-slate-900 mb-1">Invoice History</h2>
        <p className="text-xs text-slate-600">View and download your past invoices</p>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-6 text-center">
          <FileText className="h-8 w-8 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-600">No invoices yet</p>
          <p className="text-xs text-slate-500 mt-1">Your invoice history will appear here</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left py-2 px-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                  Invoice
                </th>
                <th className="text-left py-2 px-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                  Date
                </th>
                <th className="text-left py-2 px-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                  Credits
                </th>
                <th className="text-left py-2 px-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                  Amount
                </th>
                <th className="text-left py-2 px-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-right py-2 px-3 text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2 px-3">
                    <div className="text-xs font-semibold text-slate-900">{invoice.number || invoice.id}</div>
                    <div className="text-[10px] text-slate-500 mt-0.5">{invoice.description}</div>
                  </td>
                  <td className="py-2 px-3">
                    <div className="text-xs text-slate-900">{formatDate(invoice.created)}</div>
                  </td>
                  <td className="py-2 px-3">
                    {invoice.pilot_credits && (
                      <div className="text-xs text-slate-900">
                        {new Intl.NumberFormat().format(invoice.pilot_credits)} credits
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <div className="text-xs font-semibold text-slate-900">
                      {formatCurrency(invoice.amount_paid / 100)}
                    </div>
                  </td>
                  <td className="py-2 px-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusColor(invoice.status)}`}>
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
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
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
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 hover:text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                        >
                          <FileText className="h-3 w-3" />
                          PDF
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {(hasMore || pageHistory.length > 0) && (
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-sm p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-600 font-medium">
                  Showing {invoices.length > 0 ? 1 : 0}-{invoices.length} of page {pageHistory.length + 1}
                </p>
                <div className="flex gap-2 items-center">
                  <button
                    onClick={goToPrevPage}
                    disabled={loading || pageHistory.length === 0}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    Previous
                  </button>

                  <div className="flex gap-1">
                    <button
                      className="w-8 h-8 rounded-lg text-sm font-medium transition-all bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-md"
                    >
                      {pageHistory.length + 1}
                    </button>
                  </div>

                  <button
                    onClick={goToNextPage}
                    disabled={loading || !hasMore}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
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
  );
}


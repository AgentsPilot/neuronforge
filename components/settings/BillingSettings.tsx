// components/settings/BillingSettings.tsx
'use client';

// Read-only agent-platform billing view (Business OS plan payments P-10b, WS-3).
// Buying Pilot Credits is retired: the checkout, upgrade and sync routes answer
// 410, so this screen offers no purchase, upgrade or boost-pack control. What
// stays is what still serves existing subscriptions: balance and history
// figures, the subscription details with the Stripe portal, cancel and
// reactivate, and the invoice list. SA ruling Q-6 (P-10 workplan).

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '@/lib/supabaseClient';
import { createLogger } from '@/lib/logger';
import {
  CreditCard,
  TrendingDown,
  Award,
  CheckCircle2,
  Zap,
  FileText,
  AlertCircle,
  ExternalLink,
  Loader2,
  Info,
  Calendar,
  Sparkles,
  X,
  XCircle,
  Rocket,
  DollarSign
} from 'lucide-react';

const logger = createLogger({ module: 'BillingSettings' });

interface UserSubscription {
  balance: number;
  total_earned: number;
  total_spent: number;
  status: string;
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  current_period_start?: string;
  current_period_end?: string;
  created_at?: string;
  cancel_at_period_end?: boolean;
  monthly_pilot_credits?: number;
  monthly_credits?: number;
  monthly_amount_usd?: number;
}

interface PricingConfig {
  pilot_credit_cost_usd: number;
  tokens_per_pilot_credit: number;
}

type BillingTab = 'subscription' | 'invoices';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatLongDate(dateString?: string): string {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

export default function BillingSettings() {
  const [activeTab, setActiveTab] = useState<BillingTab>('subscription');
  const [userSubscription, setUserSubscription] = useState<UserSubscription | null>(null);
  const [pricingConfig, setPricingConfig] = useState<PricingConfig>({
    pilot_credit_cost_usd: 0.00048,
    tokens_per_pilot_credit: 10
  });
  const [loading, setLoading] = useState(true);
  const [portalLoading, setPortalLoading] = useState(false);
  const [rewardCredits, setRewardCredits] = useState(0);
  const [boostPackCredits, setBoostPackCredits] = useState(0);

  const [modalMounted, setModalMounted] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [showReactivateModal, setShowReactivateModal] = useState(false);
  const [reactivateLoading, setReactivateLoading] = useState(false);

  useEffect(() => {
    fetchBillingData();
  }, []);

  // Track modal mount state for createPortal
  useEffect(() => {
    setModalMounted(true);
    return () => setModalMounted(false);
  }, []);

  const fetchBillingData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (subscription) {
        setUserSubscription(subscription);
      }

      // Historical totals only: rewards and boost packs bought before the buy
      // flow was retired still show, as read-only history.
      const { data: rewardTransactions } = await supabase
        .from('credit_transactions')
        .select('credits_delta')
        .eq('user_id', user.id)
        .eq('activity_type', 'reward_credit');

      setRewardCredits(rewardTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0);

      const { data: boostTransactions } = await supabase
        .from('credit_transactions')
        .select('credits_delta')
        .eq('user_id', user.id)
        .eq('activity_type', 'boost_pack_purchase');

      setBoostPackCredits(boostTransactions?.reduce((sum, tx) => sum + tx.credits_delta, 0) || 0);

      // Needed to show balances in Pilot Credits and the monthly figures.
      const { data: configData, error: configError } = await supabase
        .from('ais_system_config')
        .select('config_key, config_value')
        .in('config_key', ['pilot_credit_cost_usd', 'tokens_per_pilot_credit']);

      if (configError) {
        logger.error({ err: configError }, 'Failed to load pricing config');
      }

      if (configData) {
        const configMap = new Map(configData.map(c => [c.config_key, c.config_value]));
        setPricingConfig({
          pilot_credit_cost_usd: parseFloat(configMap.get('pilot_credit_cost_usd') || '0.00048'),
          tokens_per_pilot_credit: parseInt(configMap.get('tokens_per_pilot_credit') || '10')
        });
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
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

    } catch (error) {
      logger.error({ err: error }, 'Failed to open the customer portal');
      alert(errorMessage(error, 'Failed to open subscription management'));
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

      await fetchBillingData();
      setShowCancelModal(false);

    } catch (error) {
      logger.error({ err: error }, 'Failed to cancel the subscription');
      alert(errorMessage(error, 'Failed to cancel subscription'));
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

      await fetchBillingData();
      setShowReactivateModal(false);

    } catch (error) {
      logger.error({ err: error }, 'Failed to reactivate the subscription');
      alert(errorMessage(error, 'Failed to reactivate subscription'));
    } finally {
      setReactivateLoading(false);
    }
  };

  const formatCredits = (tokens: number) => {
    // Convert tokens to Pilot Credits (1 Pilot Credit = 10 tokens)
    const pilotCredits = tokens / pricingConfig.tokens_per_pilot_credit;
    return new Intl.NumberFormat().format(pilotCredits);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <>
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

        {/* Purchases retired notice */}
        <div className="bg-blue-50/50 border border-blue-200/50 rounded-xl p-3 flex items-start gap-2">
          <Info className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-medium text-blue-900">Credit purchases are no longer available</p>
            <p className="text-xs text-blue-700 mt-0.5">
              Your balance, subscription and invoices are shown here. You can still update payment details, cancel or reactivate an existing subscription.
            </p>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-gray-100/80 rounded-xl p-1">
          {([
            { id: 'subscription', label: 'Subscription', icon: CreditCard },
            { id: 'invoices', label: 'Invoices', icon: FileText }
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
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

      {/* Cancel Subscription Modal */}
      {modalMounted && showCancelModal && userSubscription && createPortal((() => {
        const monthlyAmountUsd = userSubscription.monthly_amount_usd || 0;
        const currentBalance = userSubscription.balance || 0;
        const currentPilotCredits = Math.floor(currentBalance / pricingConfig.tokens_per_pilot_credit);
        const formatDate = formatLongDate;

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
        const formatDate = formatLongDate;

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
    </>
  );
}

// Subscription Info Tab Component - Shows subscription details
function SubscriptionInfoTab({
  userSubscription,
  pricingConfig,
  handleManageSubscription,
  setShowCancelModal,
  setShowReactivateModal,
  portalLoading
}: {
  userSubscription: UserSubscription | null;
  pricingConfig: PricingConfig;
  handleManageSubscription: () => void;
  setShowCancelModal: (show: boolean) => void;
  setShowReactivateModal: (show: boolean) => void;
  portalLoading: boolean;
}) {
  // Calculate monthly Pilot Credits from monthly_amount_usd
  const monthlyAmountUsd = userSubscription?.monthly_amount_usd || 0;
  const monthlyPilotCredits = Math.round(monthlyAmountUsd / pricingConfig.pilot_credit_cost_usd);
  const formatDate = formatLongDate;

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
    </div>
  );
}

// The fields of `/api/stripe/invoices` this tab renders.
interface InvoiceRow {
  id: string;
  number?: string | null;
  created: number;
  amount_paid: number;
  status: string;
  hosted_invoice_url?: string | null;
  invoice_pdf?: string | null;
  description?: string;
  pilot_credits?: number | null;
}

// Invoices Tab Component
function InvoicesTab() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
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
        logger.error({ status: response.status }, 'Failed to load invoices');
        setInvoices([]);
      }
    } catch (error) {
      logger.error({ err: error }, 'Failed to load invoices');
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

// components/settings/BillingSettings.tsx
'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import {
  CreditCard,
  TrendingUp,
  Award,
  CheckCircle2,
  Crown,
  FileText,
  Zap
} from 'lucide-react';

interface UserCredits {
  credits: number;
  total_earned: number;
  total_spent: number;
  plan_id?: string;
  subscription_status: string;
  credits_used_this_cycle: number;
  next_billing_date?: string;
  payment_method_last4?: string;
  payment_method_brand?: string;
}

interface Plan {
  id: string;
  plan_key: string;
  plan_name: string;
  display_name: string;
  description: string;
  monthly_credits: number;
  price_usd: number;
  price_annual_usd: number;
  features: string[];
  is_active: boolean;
  max_agents?: number;
  max_executions_per_day?: number;
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
}

// Helper function to generate invoice HTML for download
function generateInvoiceHtml(invoice: any): string {
  const formatCurrency = (cents: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(cents / 100);
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Invoice ${invoice.invoice_number}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 40px;
      background: white;
      color: #1e293b;
    }
    .header {
      border-bottom: 3px solid #3b82f6;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .header h1 {
      margin: 0;
      color: #3b82f6;
      font-size: 32px;
    }
    .header .company {
      color: #64748b;
      margin-top: 5px;
    }
    .invoice-details {
      display: flex;
      justify-content: space-between;
      margin-bottom: 30px;
    }
    .section {
      background: #f8fafc;
      padding: 20px;
      border-radius: 8px;
      margin-bottom: 20px;
    }
    .section-title {
      font-weight: 600;
      color: #475569;
      margin-bottom: 10px;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .line-item {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e2e8f0;
    }
    .line-item:last-child {
      border-bottom: none;
    }
    .total {
      font-size: 20px;
      font-weight: bold;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 2px solid #3b82f6;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
    }
    .status-paid {
      background: #dcfce7;
      color: #166534;
    }
    .status-open {
      background: #fef3c7;
      color: #92400e;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      color: #64748b;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>AgentPilot</h1>
    <div class="company">AI Automation Platform</div>
  </div>

  <div class="invoice-details">
    <div>
      <h2 style="margin: 0;">Invoice ${invoice.invoice_number || 'N/A'}</h2>
      <p style="color: #64748b; margin: 5px 0 0 0;">
        <span class="status-badge status-${invoice.status}">${invoice.status.toUpperCase()}</span>
      </p>
    </div>
    <div style="text-align: right;">
      <div style="color: #64748b; font-size: 14px;">Invoice Date</div>
      <div style="font-weight: 600; font-size: 16px;">${formatDate(invoice.invoice_date)}</div>
      ${invoice.paid_at ? `<div style="color: #16a34a; font-size: 12px; margin-top: 5px;">Paid on ${formatDate(invoice.paid_at)}</div>` : ''}
    </div>
  </div>

  <div class="section">
    <div class="section-title">Billing Period</div>
    <div>${formatDate(invoice.period_start)} - ${formatDate(invoice.period_end)}</div>
  </div>

  <div class="section">
    <div class="section-title">Subscription Details</div>
    <div class="line-item">
      <span>Plan</span>
      <span style="font-weight: 600;">${invoice.plan_name || 'N/A'}</span>
    </div>
    ${invoice.credits_allocated ? `
    <div class="line-item">
      <span>Pilot Credits</span>
      <span style="font-weight: 600;">${new Intl.NumberFormat().format(invoice.credits_allocated)}</span>
    </div>
    ` : ''}
  </div>

  <div class="section">
    <div class="section-title">Payment Details</div>
    <div class="line-item">
      <span>Amount Due</span>
      <span>${formatCurrency(invoice.amount_due)}</span>
    </div>
    <div class="line-item">
      <span>Amount Paid</span>
      <span>${formatCurrency(invoice.amount_paid)}</span>
    </div>
    <div class="total">
      <div class="line-item" style="border: none;">
        <span>Total</span>
        <span>${formatCurrency(invoice.amount_paid)}</span>
      </div>
    </div>
  </div>

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>AgentPilot - AI Automation Platform</p>
    <p>If you have any questions, please contact support@agentpilot.com</p>
  </div>
</body>
</html>
  `;
}

export default function BillingSettings() {
  const [activeTab, setActiveTab] = useState<'overview' | 'plans' | 'boost' | 'invoices'>('overview');
  const [userCredits, setUserCredits] = useState<UserCredits | null>(null);
  const [currentPlan, setCurrentPlan] = useState<Plan | null>(null);
  const [availablePlans, setAvailablePlans] = useState<Plan[]>([]);
  const [boostPacks, setBoostPacks] = useState<BoostPack[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBillingData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchBillingData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch user subscription and credits (renamed from user_credits per PRICING_SYSTEM_IMPLEMENTATION_PLAN.md)
      const { data: subscription } = await supabase
        .from('user_subscriptions')
        .select('*, plans(*)')
        .eq('user_id', user.id)
        .single();

      if (subscription) {
        // Map new column names to old interface for backward compatibility
        const mappedCredits = {
          ...subscription,
          credits: subscription.pilot_credits_balance,
          subscription_status: subscription.status
        };
        setUserCredits(mappedCredits);
        if (subscription.plan_id) {
          const { data: plan } = await supabase
            .from('plans')
            .select('*')
            .eq('id', subscription.plan_id)
            .single();
          setCurrentPlan(plan);
        }
      }

      // Fetch available plans
      const { data: plans } = await supabase
        .from('plans')
        .select('*')
        .eq('is_active', true)
        .order('price_usd', { ascending: true });

      setAvailablePlans(plans || []);

      // Fetch boost packs
      const { data: packs } = await supabase
        .from('boost_packs')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });

      setBoostPacks(packs || []);

    } catch (error) {
      console.error('Error fetching billing data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCredits = (credits: number) => {
    return new Intl.NumberFormat().format(credits);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Billing & Pilot Credits</h1>
          <p className="text-slate-600 mt-1">Manage your subscription, Pilot Credits, and billing</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-6 py-3 rounded-xl shadow-lg">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5" />
              <div>
                <div className="text-xs opacity-90">Available Pilot Credits</div>
                <div className="text-2xl font-bold">{formatCredits(userCredits?.credits || 0)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200">
        <div className="flex gap-6">
          {[
            { id: 'overview', label: 'Overview', icon: TrendingUp },
            { id: 'plans', label: 'Plans', icon: Crown },
            { id: 'boost', label: 'Boost Packs', icon: Zap },
            { id: 'invoices', label: 'Invoices', icon: FileText }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <OverviewTab
          userCredits={userCredits}
          currentPlan={currentPlan}
          formatCredits={formatCredits}
          formatCurrency={formatCurrency}
          setActiveTab={setActiveTab}
        />
      )}

      {activeTab === 'plans' && (
        <PlansTab
          availablePlans={availablePlans}
          currentPlan={currentPlan}
          formatCredits={formatCredits}
          formatCurrency={formatCurrency}
        />
      )}

      {activeTab === 'boost' && (
        <BoostPacksTab
          boostPacks={boostPacks}
          formatCredits={formatCredits}
          formatCurrency={formatCurrency}
        />
      )}

      {activeTab === 'invoices' && (
        <InvoicesTab />
      )}
    </div>
  );
}

// Overview Tab Component
function OverviewTab({ userCredits, currentPlan, formatCredits, formatCurrency, setActiveTab }: any) {
  const usagePercentage = currentPlan
    ? ((userCredits?.credits_used_this_cycle || 0) / currentPlan.monthly_credits) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* Current Plan Card */}
      <div className="bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
              <Crown className="h-6 w-6 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">
                {currentPlan?.display_name || 'Free Plan'}
              </h3>
              <p className="text-sm text-slate-600">
                {currentPlan ? `${formatCurrency(currentPlan.price_usd)}/month` : 'No subscription'}
              </p>
            </div>
          </div>
          {userCredits?.subscription_status !== 'free' && (
            <button
              onClick={() => setActiveTab('plans')}
              className="px-5 py-2.5 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg hover:from-blue-700 hover:to-purple-700 transition-all shadow-md hover:shadow-lg text-sm font-semibold flex items-center gap-2"
            >
              <Crown className="h-4 w-4" />
              Manage Plan
            </button>
          )}
        </div>

        {currentPlan && (
          <>
            {/* Usage Bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Pilot Credits used this month</span>
                <span className="font-medium text-slate-900">
                  {formatCredits(userCredits?.credits_used_this_cycle || 0)} / {formatCredits(currentPlan.monthly_credits)}
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min(usagePercentage, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{usagePercentage.toFixed(1)}% used</span>
                {userCredits?.next_billing_date && (
                  <span>Resets {new Date(userCredits.next_billing_date).toLocaleDateString()}</span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          icon={Zap}
          label="Available Pilot Credits"
          value={formatCredits(userCredits?.credits || 0)}
          color="blue"
        />
        <StatCard
          icon={Award}
          label="Total Earned"
          value={formatCredits(userCredits?.total_earned || 0)}
          color="green"
        />
        <StatCard
          icon={TrendingUp}
          label="Total Spent"
          value={formatCredits(userCredits?.total_spent || 0)}
          color="purple"
        />
      </div>

      {/* Payment Method */}
      {userCredits?.payment_method_last4 && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Payment Method</h3>
          <div className="flex items-center gap-3">
            <div className="w-12 h-8 bg-slate-100 rounded flex items-center justify-center">
              <CreditCard className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <div className="font-medium text-slate-900">
                {userCredits.payment_method_brand} •••• {userCredits.payment_method_last4}
              </div>
              <div className="text-sm text-slate-500">Primary payment method</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Plans Tab Component
function PlansTab({ availablePlans, currentPlan, formatCredits, formatCurrency }: any) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleSelectPlan = async (planKey: string) => {
    setLoading(planKey);
    try {
      const { createCheckoutSession } = await import('@/lib/stripe/client');
      await createCheckoutSession({
        planKey,
        billingCycle: 'monthly',
        mode: 'subscription',
      });
    } catch (error) {
      console.error('Error selecting plan:', error);
      alert('Failed to start checkout. Please try again.');
      setLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Choose Your Plan</h2>
        <p className="text-slate-600">Upgrade or downgrade your plan at any time</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {availablePlans.map((plan: Plan) => {
          const isCurrentPlan = currentPlan?.id === plan.id;
          const isFree = plan.price_usd === 0;
          const isLoading = loading === plan.plan_key;

          return (
            <div
              key={plan.id}
              className={`relative bg-white border-2 rounded-2xl p-6 transition-all hover:shadow-xl ${
                isCurrentPlan
                  ? 'border-blue-500 shadow-lg'
                  : 'border-slate-200 hover:border-blue-300'
              }`}
            >
              {isCurrentPlan && (
                <div className="absolute top-4 right-4">
                  <div className="bg-blue-500 text-white text-xs font-semibold px-3 py-1 rounded-full">
                    Current
                  </div>
                </div>
              )}

              <div className="mb-4">
                <h3 className="text-xl font-bold text-slate-900">{plan.display_name}</h3>
                <p className="text-sm text-slate-600 mt-1">{plan.description}</p>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-slate-900">
                    {isFree ? 'Free' : formatCurrency(plan.price_usd)}
                  </span>
                  {!isFree && <span className="text-slate-600">/month</span>}
                </div>
                <div className="text-sm text-slate-600 mt-1">
                  {formatCredits(plan.monthly_credits)} Pilot Credits/month
                </div>
              </div>

              <ul className="space-y-3 mb-6">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
                    <span className="text-slate-700">{feature.replace(/_/g, ' ')}</span>
                  </li>
                ))}
              </ul>

              <button
                onClick={() => !isCurrentPlan && !isFree && handleSelectPlan(plan.plan_key)}
                disabled={isCurrentPlan || isLoading}
                className={`w-full py-3 rounded-lg font-semibold transition-all ${
                  isCurrentPlan
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : isFree
                    ? 'bg-slate-900 text-white hover:bg-slate-800'
                    : 'bg-gradient-to-r from-blue-500 to-purple-600 text-white hover:shadow-lg disabled:opacity-50'
                }`}
              >
                {isLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    Processing...
                  </div>
                ) : (
                  isCurrentPlan ? 'Current Plan' : isFree ? 'Downgrade' : 'Upgrade'
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Boost Packs Tab Component
function BoostPacksTab({ boostPacks, formatCredits, formatCurrency }: any) {
  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">One-Time Pilot Credits Boost</h2>
        <p className="text-slate-600">Need more Pilot Credits? Purchase a boost pack instantly</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {boostPacks.map((pack: BoostPack) => (
          <div
            key={pack.id}
            className="relative bg-white border-2 border-slate-200 rounded-2xl p-6 hover:border-purple-300 hover:shadow-xl transition-all"
          >
            {pack.badge_text && (
              <div className="absolute -top-3 left-1/2 transform -translate-x-1/2">
                <div className="bg-gradient-to-r from-orange-500 to-red-500 text-white text-xs font-bold px-4 py-1 rounded-full shadow-lg">
                  {pack.badge_text}
                </div>
              </div>
            )}

            <div className="text-center mb-6 mt-2">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Zap className="h-8 w-8 text-white" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900">{pack.display_name}</h3>
              <p className="text-sm text-slate-600 mt-1">{pack.description}</p>
            </div>

            <div className="space-y-4 mb-6">
              <div className="bg-gradient-to-r from-purple-50 to-pink-50 rounded-xl p-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-slate-900">
                    {formatCredits(pack.credits_amount)}
                  </div>
                  <div className="text-sm text-slate-600">Pilot Credits</div>
                  {pack.bonus_credits > 0 && (
                    <div className="mt-2 text-sm font-semibold text-green-600">
                      + {formatCredits(pack.bonus_credits)} Bonus!
                    </div>
                  )}
                </div>
              </div>

              <div className="text-center">
                <div className="text-3xl font-bold text-slate-900">{formatCurrency(pack.price_usd)}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {(pack.price_usd / pack.credits_amount * 1000).toFixed(2)}¢ per 1000 Pilot Credits
                </div>
              </div>
            </div>

            <button className="w-full py-3 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-semibold rounded-lg hover:shadow-lg transition-all">
              Purchase Now
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// Invoices Tab Component
function InvoicesTab() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [showInvoiceModal, setShowInvoiceModal] = useState(false);

  useEffect(() => {
    fetchInvoices();
  }, []);

  const fetchInvoices = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log('❌ No user found');
        return;
      }

      console.log('👤 Fetching invoices for user:', user.id);

      const { data, error } = await supabase
        .from('subscription_invoices')
        .select('*')
        .eq('user_id', user.id)
        .order('invoice_date', { ascending: false });

      if (error) {
        console.error('❌ Error fetching invoices:', error);
        return;
      }

      console.log('📄 Invoices fetched:', data?.length || 0, data);
      setInvoices(data || []);
    } catch (error) {
      console.error('❌ Error fetching invoices:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
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
      case 'void':
        return 'bg-slate-100 text-slate-700';
      default:
        return 'bg-slate-100 text-slate-700';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-2">Invoice History</h2>
        <p className="text-slate-600">View and download your past invoices</p>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <FileText className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-600">No invoices yet</p>
          <p className="text-sm text-slate-500 mt-2">Your invoice history will appear here</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Invoice
                </th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Plan
                </th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Date
                </th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Amount
                </th>
                <th className="text-left py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Status
                </th>
                <th className="text-right py-4 px-6 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <FileText className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{invoice.invoice_number}</div>
                        <div className="text-xs text-slate-500">
                          {invoice.period_start && invoice.period_end && (
                            <>
                              {formatDate(invoice.period_start)} - {formatDate(invoice.period_end)}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="py-4 px-6">
                    <div className="font-medium text-slate-900">{invoice.plan_name}</div>
                    {invoice.credits_allocated && (
                      <div className="text-xs text-slate-500">
                        {new Intl.NumberFormat().format(invoice.credits_allocated)} Pilot Credits
                      </div>
                    )}
                  </td>
                  <td className="py-4 px-6">
                    <div className="text-slate-900">{formatDate(invoice.invoice_date)}</div>
                    {invoice.paid_at && (
                      <div className="text-xs text-slate-500">
                        Paid {formatDate(invoice.paid_at)}
                      </div>
                    )}
                  </td>
                  <td className="py-4 px-6">
                    <div className="font-semibold text-slate-900">
                      {formatCurrency(invoice.amount_paid)}
                    </div>
                    {invoice.amount_due !== invoice.amount_paid && (
                      <div className="text-xs text-slate-500">
                        Due: {formatCurrency(invoice.amount_due)}
                      </div>
                    )}
                  </td>
                  <td className="py-4 px-6">
                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(invoice.status)}`}>
                      {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1)}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right">
                    <button
                      onClick={() => {
                        setSelectedInvoice(invoice);
                        setShowInvoiceModal(true);
                      }}
                      className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <FileText className="h-4 w-4" />
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {showInvoiceModal && selectedInvoice && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-6 rounded-t-2xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">{selectedInvoice.invoice_number}</h2>
                  <p className="text-blue-100 text-sm mt-1">Invoice Details</p>
                </div>
                <button
                  onClick={() => setShowInvoiceModal(false)}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-6">
              {/* Status Badge */}
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold ${getStatusColor(selectedInvoice.status)}`}>
                  {selectedInvoice.status.charAt(0).toUpperCase() + selectedInvoice.status.slice(1)}
                </span>
                <div className="text-right">
                  <div className="text-sm text-slate-500">Invoice Date</div>
                  <div className="font-semibold text-slate-900">{formatDate(selectedInvoice.invoice_date)}</div>
                </div>
              </div>

              {/* Billing Period */}
              <div className="bg-slate-50 rounded-xl p-4">
                <div className="text-sm font-semibold text-slate-700 mb-2">Billing Period</div>
                <div className="text-slate-900">
                  {formatDate(selectedInvoice.period_start)} - {formatDate(selectedInvoice.period_end)}
                </div>
              </div>

              {/* Plan Details */}
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="text-sm font-semibold text-slate-700 mb-3">Subscription Details</div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-600">Plan</span>
                    <span className="font-medium text-slate-900">{selectedInvoice.plan_name}</span>
                  </div>
                  {selectedInvoice.credits_allocated && (
                    <div className="flex justify-between">
                      <span className="text-slate-600">Pilot Credits</span>
                      <span className="font-medium text-slate-900">
                        {new Intl.NumberFormat().format(selectedInvoice.credits_allocated)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Amount Details */}
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="text-sm font-semibold text-slate-700 mb-3">Payment Details</div>
                <div className="space-y-3">
                  <div className="flex justify-between text-slate-600">
                    <span>Amount Due</span>
                    <span>{formatCurrency(selectedInvoice.amount_due)}</span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>Amount Paid</span>
                    <span>{formatCurrency(selectedInvoice.amount_paid)}</span>
                  </div>
                  <div className="border-t border-slate-200 pt-3 flex justify-between">
                    <span className="font-semibold text-slate-900">Total</span>
                    <span className="font-bold text-slate-900 text-lg">{formatCurrency(selectedInvoice.amount_paid)}</span>
                  </div>
                  {selectedInvoice.paid_at && (
                    <div className="text-xs text-slate-500 text-right">
                      Paid on {formatDate(selectedInvoice.paid_at)}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => setShowInvoiceModal(false)}
                  className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors font-medium"
                >
                  Close
                </button>
                <button
                  onClick={async () => {
                    if (selectedInvoice.stripe_invoice_pdf) {
                      // Open Stripe-hosted PDF in new tab
                      window.open(selectedInvoice.stripe_invoice_pdf, '_blank');
                    } else {
                      // Generate PDF client-side
                      try {
                        const invoiceHtml = generateInvoiceHtml(selectedInvoice);
                        const blob = new Blob([invoiceHtml], { type: 'text/html' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = `${selectedInvoice.invoice_number || 'invoice'}.html`;
                        link.click();
                        URL.revokeObjectURL(url);
                      } catch (error) {
                        console.error('Error generating invoice:', error);
                        alert('Unable to download invoice. Please try again.');
                      }
                    }
                  }}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all font-medium shadow-lg"
                >
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Stat Card Component
function StatCard({ icon: Icon, label, value, color }: {
  icon: any;
  label: string;
  value: string;
  color: 'blue' | 'green' | 'purple';
}) {
  const colors: Record<'blue' | 'green' | 'purple', string> = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-green-500 to-emerald-600',
    purple: 'from-purple-500 to-pink-600'
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-10 h-10 bg-gradient-to-br ${colors[color]} rounded-lg flex items-center justify-center`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
        <div className="text-sm text-slate-600">{label}</div>
      </div>
      <div className="text-3xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

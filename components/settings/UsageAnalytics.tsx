// components/settings/UsageAnalytics.tsx
'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { formatActivityType } from '@/lib/utils/formatActivityName';
import {
  TrendingUp,
  Activity,
  Zap,
  BarChart3,
  Clock,
  Award,
  ArrowUp,
  ArrowDown,
  Database
} from 'lucide-react';

interface CreditTransaction {
  id: string;
  pilot_credits_amount: number;
  transaction_type: string;
  activity_type: string;
  description: string;
  balance_before: number;
  balance_after: number;
  created_at: string;
  metadata: any;
}

interface UsageStats {
  totalSpent: number;
  totalEarned: number;
  avgPerDay: number;
  topActivity: string;
  transactions: CreditTransaction[];
}

interface PlatformMetrics {
  agents: { used: number; limit: number };
  executions: { used: number; limit: number };
  storage: { used: number; limit: number };
}

export default function UsageAnalytics() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [platformMetrics, setPlatformMetrics] = useState<PlatformMetrics | null>(null);
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchUsageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeRange]);

  const fetchUsageData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Calculate date range
      let startDate = new Date();
      if (timeRange === '7d') startDate.setDate(startDate.getDate() - 7);
      else if (timeRange === '30d') startDate.setDate(startDate.getDate() - 30);
      else if (timeRange === '90d') startDate.setDate(startDate.getDate() - 90);
      else startDate = new Date(0); // All time

      // Fetch transactions
      let query = supabase
        .from('credit_transactions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (timeRange !== 'all') {
        query = query.gte('created_at', startDate.toISOString());
      }

      const { data: transactions } = await query.limit(50);

      if (transactions) {
        const spent = transactions
          .filter((t: CreditTransaction) => t.pilot_credits_amount < 0)
          .reduce((sum: number, t: CreditTransaction) => sum + Math.abs(t.pilot_credits_amount), 0);

        const earned = transactions
          .filter((t: CreditTransaction) => t.pilot_credits_amount > 0)
          .reduce((sum: number, t: CreditTransaction) => sum + t.pilot_credits_amount, 0);

        const daysInRange = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : timeRange === '90d' ? 90 : 365;
        const avgPerDay = spent / daysInRange;

        // Find top activity
        const activityCounts: Record<string, number> = {};
        transactions.forEach((t: CreditTransaction) => {
          if (t.activity_type) {
            activityCounts[t.activity_type] = (activityCounts[t.activity_type] || 0) + Math.abs(t.pilot_credits_amount);
          }
        });

        const topActivity = Object.entries(activityCounts)
          .sort(([, a], [, b]) => b - a)[0]?.[0] || 'agent_execution';

        setStats({
          totalSpent: spent,
          totalEarned: earned,
          avgPerDay,
          topActivity,
          transactions
        });
      }

      // Fetch platform metrics
      // Count agents
      const { count: agentCount } = await supabase
        .from('agents')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .neq('status', 'deleted');

      // Count executions today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { count: executionCount } = await supabase
        .from('agent_executions')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', today.toISOString());

      // Get user plan limits (renamed from user_credits to user_subscriptions)
      const { data: userCredits } = await supabase
        .from('user_subscriptions')
        .select('*, plans(*)')
        .eq('user_id', user.id)
        .single();

      const agentLimit = userCredits?.plans?.max_agents || 5;
      const executionLimit = userCredits?.plans?.max_executions_per_day || 100;

      setPlatformMetrics({
        agents: { used: agentCount || 0, limit: agentLimit },
        executions: { used: executionCount || 0, limit: executionLimit },
        storage: { used: 150, limit: 500 } // Placeholder
      });

    } catch (error) {
      console.error('Error fetching usage data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatCredits = (credits: number) => {
    return new Intl.NumberFormat().format(Math.abs(credits));
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'agent_creation':
        return <Zap className="h-4 w-4" />;
      case 'agent_execution':
        return <Activity className="h-4 w-4" />;
      case 'reward_credit':
        return <Award className="h-4 w-4" />;
      default:
        return <Activity className="h-4 w-4" />;
    }
  };

  const getActivityColor = (type: string) => {
    switch (type) {
      case 'agent_creation':
        return 'text-purple-600 bg-purple-100';
      case 'agent_execution':
        return 'text-blue-600 bg-blue-100';
      case 'reward_credit':
        return 'text-green-600 bg-green-100';
      case 'subscription_topup':
        return 'text-orange-600 bg-orange-100';
      default:
        return 'text-slate-600 bg-slate-100';
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
      {/* Time Range Selector */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-900">Usage Analytics</h2>
        <div className="flex gap-2 bg-slate-100 p-1 rounded-lg">
          {[
            { key: '7d', label: '7 days' },
            { key: '30d', label: '30 days' },
            { key: '90d', label: '90 days' },
            { key: 'all', label: 'All time' }
          ].map(option => (
            <button
              key={option.key}
              onClick={() => setTimeRange(option.key as any)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                timeRange === option.key
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {/* Platform Usage Metrics */}
      {platformMetrics && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-6">Platform Usage</h3>

          <div className="space-y-6">
            {/* Agents Usage */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Database className="w-5 h-5 text-purple-600" />
                  <span className="text-sm font-semibold text-slate-900">Agents</span>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {platformMetrics.agents.used} / {platformMetrics.agents.limit}
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-600 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((platformMetrics.agents.used / platformMetrics.agents.limit) * 100, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-slate-500">
                  {((platformMetrics.agents.used / platformMetrics.agents.limit) * 100).toFixed(1)}% used
                </span>
                <span className="text-xs text-slate-500">
                  {platformMetrics.agents.limit - platformMetrics.agents.used} remaining
                </span>
              </div>
            </div>

            {/* Executions Usage */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-emerald-600" />
                  <span className="text-sm font-semibold text-slate-900">Executions Today</span>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {platformMetrics.executions.used} / {platformMetrics.executions.limit}
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((platformMetrics.executions.used / platformMetrics.executions.limit) * 100, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-slate-500">
                  {((platformMetrics.executions.used / platformMetrics.executions.limit) * 100).toFixed(1)}% used
                </span>
                <span className="text-xs text-slate-500">
                  {platformMetrics.executions.limit - platformMetrics.executions.used} remaining
                </span>
              </div>
            </div>

            {/* Storage Usage */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-orange-600" />
                  <span className="text-sm font-semibold text-slate-900">Storage</span>
                </div>
                <span className="text-sm font-bold text-slate-900">
                  {platformMetrics.storage.used} MB / {platformMetrics.storage.limit} MB
                </span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-red-600 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min((platformMetrics.storage.used / platformMetrics.storage.limit) * 100, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-xs text-slate-500">
                  {((platformMetrics.storage.used / platformMetrics.storage.limit) * 100).toFixed(1)}% used
                </span>
                <span className="text-xs text-slate-500">
                  {platformMetrics.storage.limit - platformMetrics.storage.used} MB remaining
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Credit Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-gradient-to-br from-red-50 to-orange-50 border border-red-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-red-500 to-orange-500 rounded-lg flex items-center justify-center">
              <ArrowDown className="h-5 w-5 text-white" />
            </div>
            <div className="text-sm text-red-700">Pilot Credits Spent</div>
          </div>
          <div className="text-3xl font-bold text-slate-900">{formatCredits(stats?.totalSpent || 0)}</div>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-lg flex items-center justify-center">
              <ArrowUp className="h-5 w-5 text-white" />
            </div>
            <div className="text-sm text-green-700">Pilot Credits Earned</div>
          </div>
          <div className="text-3xl font-bold text-slate-900">{formatCredits(stats?.totalEarned || 0)}</div>
        </div>

        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-white" />
            </div>
            <div className="text-sm text-blue-700">Avg. Per Day</div>
          </div>
          <div className="text-3xl font-bold text-slate-900">{formatCredits(stats?.avgPerDay || 0)}</div>
        </div>

        <div className="bg-gradient-to-br from-purple-50 to-pink-50 border border-purple-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
              <BarChart3 className="h-5 w-5 text-white" />
            </div>
            <div className="text-sm text-purple-700">Top Activity</div>
          </div>
          <div className="text-lg font-bold text-slate-900 capitalize">
            {stats?.topActivity?.replace('_', ' ') || 'N/A'}
          </div>
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-6 border-b border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900">Recent Transactions</h3>
          <p className="text-sm text-slate-600 mt-1">Your credit activity history</p>
        </div>

        <div className="divide-y divide-slate-200">
          {stats?.transactions && stats.transactions.length > 0 ? (
            stats.transactions.map((transaction) => (
              <div key={transaction.id} className="p-6 hover:bg-slate-50 transition-colors">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${getActivityColor(transaction.activity_type)}`}>
                      {getActivityIcon(transaction.activity_type)}
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{transaction.description || 'Credit transaction'}</div>
                      <div className="text-sm text-slate-500 flex items-center gap-2 mt-1">
                        <Clock className="h-3 w-3" />
                        {new Date(transaction.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`text-lg font-bold ${transaction.pilot_credits_amount > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {transaction.pilot_credits_amount > 0 ? '+' : ''}{formatCredits(transaction.pilot_credits_amount)}
                    </div>
                    <div className="text-sm text-slate-500">
                      Balance: {formatCredits(transaction.balance_after)}
                    </div>
                  </div>
                </div>

                {/* Activity Details with Multiplier Breakdown */}
                {transaction.metadata && (
                  <div className="mt-3 ml-14 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      {/* Activity Type */}
                      <div>
                        <div className="text-slate-500 mb-1">Activity Type</div>
                        <div className="font-medium text-slate-900">
                          {formatActivityType(transaction.activity_type)}
                        </div>
                      </div>

                      {/* Multiplier Applied */}
                      {transaction.metadata.multiplier && (
                        <div>
                          <div className="text-slate-500 mb-1">Multiplier Applied</div>
                          <div className="font-medium text-slate-900">
                            {transaction.metadata.multiplier}x
                          </div>
                        </div>
                      )}

                      {/* Base Credits */}
                      {transaction.metadata.base_credits && (
                        <div>
                          <div className="text-slate-500 mb-1">Base Pilot Credits</div>
                          <div className="font-medium text-slate-900">
                            {formatCredits(transaction.metadata.base_credits)}
                          </div>
                        </div>
                      )}

                      {/* Pilot Credits Used */}
                      {transaction.metadata.tokens_total && (
                        <div>
                          <div className="text-slate-500 mb-1">Pilot Credits Used</div>
                          <div className="font-medium text-slate-900">
                            {new Intl.NumberFormat().format(Math.round(transaction.metadata.tokens_total / 10))}
                          </div>
                        </div>
                      )}

                      {/* Final Credits Calculation */}
                      {transaction.metadata.base_credits && transaction.metadata.multiplier && (
                        <div className="col-span-2 pt-2 border-t border-slate-200">
                          <div className="text-slate-500 mb-1">Calculation</div>
                          <div className="font-mono text-xs text-slate-700">
                            {formatCredits(transaction.metadata.base_credits)} credits × {transaction.metadata.multiplier}x = {formatCredits(Math.abs(transaction.pilot_credits_amount))} Pilot Credits
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="p-12 text-center">
              <Activity className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-600">No transactions yet</p>
              <p className="text-sm text-slate-500 mt-2">Your transaction history will appear here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  MessageSquare,
  Server,
  Users,
  Activity,
  ArrowUpRight,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Zap,
  AlertCircle,
  CheckCircle,
  Bot,
  BarChart3
} from 'lucide-react';

interface DashboardData {
  messages: {
    total: number;
    unread: number;
    today: number;
    trend: number;
    recent: number;
  };
  users: {
    total: number;
    active: number;
    today: number;
    trend: number;
    recent: number;
  };
  tokenUsage: {
    totalTokens: number;
    totalCost: number;
    totalRequests: number;
    successRate: number;
    todayTokens: number;
    todayCost: number;
    todayRequests: number;
    recent: number;
  };
  agents: {
    total: number;
    active: number;
    today: number;
  };
  overview: {
    lastUpdated: string;
  };
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/admin/dashboard', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store'
      });

      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'API returned unsuccessful response');
      }

      setData(result.data);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(cost);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const TrendBadge = ({ value }: { value: number }) => {
    if (value === 0) return null;

    const isPositive = value > 0;
    return (
      <span className={`flex items-center gap-1 text-xs ${
        isPositive ? 'text-green-400' : 'text-red-400'
      }`}>
        {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {Math.abs(value).toFixed(1)}%
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
          <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 rounded-full">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <h3 className="text-lg font-semibold text-red-800 mb-2">Failed to Load Dashboard</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={fetchDashboardData}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Admin Dashboard</h1>
          <p className="text-slate-400">Monitor your AgentPilot platform performance</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-sm text-slate-400">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
          <button
            onClick={fetchDashboardData}
            className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Primary Stats - 4 Columns */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Messages Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-blue-500/30 transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-blue-500/20 rounded-lg">
              <MessageSquare className="w-6 h-6 text-blue-400" />
            </div>
            <Link href="/admin/messages" className="text-blue-400 hover:text-blue-300 transition-colors">
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
          <div>
            <p className="text-3xl font-bold text-white mb-1">{data.messages.total}</p>
            <p className="text-sm text-slate-400 mb-3">Total Messages</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-yellow-400 flex items-center gap-1">
                <div className="w-2 h-2 bg-yellow-400 rounded-full"></div>
                {data.messages.unread} unread
              </span>
              <span className="text-green-400">{data.messages.today} today</span>
            </div>
            {data.messages.trend !== 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700">
                <TrendBadge value={data.messages.trend} />
              </div>
            )}
          </div>
        </motion.div>

        {/* Users Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-green-500/30 transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-green-500/20 rounded-lg">
              <Users className="w-6 h-6 text-green-400" />
            </div>
            <Link href="/admin/users" className="text-green-400 hover:text-green-300 transition-colors">
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
          <div>
            <p className="text-3xl font-bold text-white mb-1">{data.users.total}</p>
            <p className="text-sm text-slate-400 mb-3">Total Users</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-400 flex items-center gap-1">
                <Activity className="w-3 h-3" />
                {data.users.active} active
              </span>
              <span className="text-purple-400">{data.users.today} today</span>
            </div>
            {data.users.trend !== 0 && (
              <div className="mt-3 pt-3 border-t border-slate-700">
                <TrendBadge value={data.users.trend} />
              </div>
            )}
          </div>
        </motion.div>

        {/* Agents Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-purple-500/30 transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <Bot className="w-6 h-6 text-purple-400" />
            </div>
            <div className="text-purple-400">
              <BarChart3 className="w-5 h-5" />
            </div>
          </div>
          <div>
            <p className="text-3xl font-bold text-white mb-1">{data.agents.total}</p>
            <p className="text-sm text-slate-400 mb-3">Total Agents</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-purple-400 flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                {data.agents.active} active
              </span>
              <span className="text-blue-400">{data.agents.today} today</span>
            </div>
          </div>
        </motion.div>

        {/* Token Usage Card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-orange-500/30 transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-orange-500/20 rounded-lg">
              <Zap className="w-6 h-6 text-orange-400" />
            </div>
            <Link href="/admin/analytics" className="text-orange-400 hover:text-orange-300 transition-colors">
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
          <div>
            <p className="text-3xl font-bold text-white mb-1">{formatNumber(data.tokenUsage.totalTokens)}</p>
            <p className="text-sm text-slate-400 mb-3">Total Tokens</p>
            <div className="flex items-center gap-3 text-xs">
              <span className="text-green-400 flex items-center gap-1">
                <DollarSign className="w-3 h-3" />
                {formatCost(data.tokenUsage.totalCost)}
              </span>
              <span className="text-blue-400">{data.tokenUsage.successRate.toFixed(1)}% success</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Secondary Stats - Today's Activity */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10">
        <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-400" />
          Today's Activity
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-700/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-400">Messages Received</p>
              <MessageSquare className="w-4 h-4 text-blue-400" />
            </div>
            <p className="text-2xl font-bold text-white">{data.messages.today}</p>
            <p className="text-xs text-slate-500 mt-1">{data.messages.unread} unread</p>
          </div>

          <div className="bg-slate-700/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-400">New Users</p>
              <Users className="w-4 h-4 text-green-400" />
            </div>
            <p className="text-2xl font-bold text-white">{data.users.today}</p>
            <p className="text-xs text-slate-500 mt-1">{data.users.active} active users</p>
          </div>

          <div className="bg-slate-700/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-slate-400">Token Usage</p>
              <Zap className="w-4 h-4 text-orange-400" />
            </div>
            <p className="text-2xl font-bold text-white">{formatNumber(data.tokenUsage.todayTokens)}</p>
            <p className="text-xs text-slate-500 mt-1">{formatCost(data.tokenUsage.todayCost)} cost</p>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Recent Activity Summary */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
        >
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-purple-400" />
            Last 7 Days
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-500/20 rounded-lg">
                  <MessageSquare className="w-4 h-4 text-blue-400" />
                </div>
                <span className="text-sm text-slate-300">Messages</span>
              </div>
              <span className="text-lg font-semibold text-white">{data.messages.recent}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-green-500/20 rounded-lg">
                  <Users className="w-4 h-4 text-green-400" />
                </div>
                <span className="text-sm text-slate-300">New Users</span>
              </div>
              <span className="text-lg font-semibold text-white">{data.users.recent}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-orange-500/20 rounded-lg">
                  <Zap className="w-4 h-4 text-orange-400" />
                </div>
                <span className="text-sm text-slate-300">API Requests</span>
              </div>
              <span className="text-lg font-semibold text-white">{data.tokenUsage.recent}</span>
            </div>
          </div>
        </motion.div>

        {/* Quick Actions */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
        >
          <h2 className="text-xl font-semibold text-white mb-4">Quick Actions</h2>
          <div className="space-y-3">
            <Link
              href="/admin/messages"
              className="flex items-center justify-between p-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors group"
            >
              <div className="flex items-center gap-3">
                <MessageSquare className="w-4 h-4 text-blue-400" />
                <span className="text-sm text-slate-300">View Messages</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
            </Link>

            <Link
              href="/admin/users"
              className="flex items-center justify-between p-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Users className="w-4 h-4 text-green-400" />
                <span className="text-sm text-slate-300">Manage Users</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
            </Link>

            <Link
              href="/admin/analytics"
              className="flex items-center justify-between p-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors group"
            >
              <div className="flex items-center gap-3">
                <BarChart3 className="w-4 h-4 text-purple-400" />
                <span className="text-sm text-slate-300">View Analytics</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
            </Link>

            <Link
              href="/admin/queues"
              className="flex items-center justify-between p-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors group"
            >
              <div className="flex items-center gap-3">
                <Server className="w-4 h-4 text-orange-400" />
                <span className="text-sm text-slate-300">Queue Monitor</span>
              </div>
              <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
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
  Bot,
  Brain,
  CheckCircle
} from 'lucide-react';

interface DashboardData {
  users: {
    total: number;
    active: number;
  };
  agents: {
    total: number;
    active: number;
  };
  tokenUsage: {
    totalCost: number;
    totalTokens: number;
    successRate: number;
  };
  memory: {
    total: number;
    weeklyGrowth: number;
    roi: number;
    cost: number;
    savings: number;
  };
  queue: {
    totalProcessed: number;
    successRate: number;
    avgProcessingTime: number;
    health: string;
    pending: number;
    running: number;
    failed: number;
  };
  ais: {
    mode: string;
    totalAgents: number;
    dataPoints: number;
    creationTokens: number;
    executionTokens: number;
    totalTokens: number;
    totalCost: number;
    growthAlerts: number;
    avgGrowthRate: number;
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
      maximumFractionDigits: 4
    }).format(cost);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const getQueueHealthColor = (health: string) => {
    switch (health) {
      case 'excellent': return 'text-green-400 bg-green-500/20 border-green-500/30';
      case 'good': return 'text-blue-400 bg-blue-500/20 border-blue-500/30';
      case 'warning': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/30';
      case 'critical': return 'text-red-400 bg-red-500/20 border-red-500/30';
      default: return 'text-slate-400 bg-slate-500/20 border-slate-500/30';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center">
        <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-6 max-w-md backdrop-blur-xl">
          <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-500/20 rounded-full">
            <AlertCircle className="w-6 h-6 text-red-400" />
          </div>
          <h3 className="text-lg font-semibold text-red-300 mb-2">Failed to Load Dashboard</h3>
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={fetchDashboardData}
            className="px-4 py-2 bg-red-500/20 text-red-300 rounded-lg hover:bg-red-500/30 transition-colors border border-red-500/30"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">System Overview</h1>
          <p className="text-slate-400">Critical platform metrics at a glance</p>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-sm text-slate-400">
            Last updated: {lastUpdate.toLocaleTimeString()}
          </div>
          <button
            onClick={fetchDashboardData}
            className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors border border-white/10"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Primary Metrics - 2x2 Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Platform Users */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-green-500/30 transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-500/20 rounded-xl">
                <Users className="w-6 h-6 text-green-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Platform Users</h3>
                <p className="text-xs text-slate-400">Total & Active (30d)</p>
              </div>
            </div>
            <Link href="/admin/users" className="text-green-400 hover:text-green-300 transition-colors">
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-3xl font-bold text-white mb-1">{data.users.total}</p>
              <p className="text-sm text-slate-400">Total Users</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-green-400 mb-1">{data.users.active}</p>
              <p className="text-sm text-slate-400">Active Users</p>
            </div>
          </div>
        </motion.div>

        {/* Token Usage & Cost */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-orange-500/30 transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-orange-500/20 rounded-xl">
                <Zap className="w-6 h-6 text-orange-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Token Usage</h3>
                <p className="text-xs text-slate-400">Total Cost & Success Rate</p>
              </div>
            </div>
            <Link href="/admin/analytics" className="text-orange-400 hover:text-orange-300 transition-colors">
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-3xl font-bold text-orange-400 mb-1">{formatCost(data.tokenUsage.totalCost)}</p>
              <p className="text-sm text-slate-400">Total Cost</p>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-3xl font-bold text-white">{data.tokenUsage.successRate}%</p>
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>
              <p className="text-sm text-slate-400">Success Rate</p>
            </div>
          </div>
        </motion.div>

        {/* Memory System */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-purple-500/30 transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-purple-500/20 rounded-xl">
                <Brain className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Memory System</h3>
                <p className="text-xs text-slate-400">Memories & ROI</p>
              </div>
            </div>
            <Link href="/admin/learning-system" className="text-purple-400 hover:text-purple-300 transition-colors">
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <p className="text-3xl font-bold text-white">{formatNumber(data.memory.total)}</p>
                {data.memory.weeklyGrowth !== 0 && (
                  <span className={`flex items-center gap-0.5 text-xs ${
                    data.memory.weeklyGrowth > 0 ? 'text-green-400' : 'text-red-400'
                  }`}>
                    {data.memory.weeklyGrowth > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(data.memory.weeklyGrowth)}%
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-400">Total Memories</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-green-400 mb-1">{data.memory.roi}x</p>
              <p className="text-sm text-slate-400">Estimated ROI</p>
            </div>
          </div>
        </motion.div>

        {/* Queue Health */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10 hover:border-blue-500/30 transition-all"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-500/20 rounded-xl">
                <Server className="w-6 h-6 text-blue-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Execution Queue</h3>
                <p className="text-xs text-slate-400">Success & Health</p>
              </div>
            </div>
            <Link href="/admin/queues" className="text-blue-400 hover:text-blue-300 transition-colors">
              <ArrowUpRight className="w-5 h-5" />
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-3xl font-bold text-white mb-1">{data.queue.successRate}%</p>
              <p className="text-sm text-slate-400">Success Rate</p>
            </div>
            <div>
              <span className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold border ${getQueueHealthColor(data.queue.health)}`}>
                <Activity className="w-4 h-4" />
                {data.queue.health.charAt(0).toUpperCase() + data.queue.health.slice(1)}
              </span>
              <p className="text-sm text-slate-400 mt-2">Queue Health</p>
            </div>
          </div>
        </motion.div>
      </div>

      {/* System Details Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Agents */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-4 border border-white/10"
        >
          <div className="flex items-center gap-3 mb-3">
            <Bot className="w-5 h-5 text-indigo-400" />
            <h3 className="text-sm font-semibold text-white">Agents</h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Total</span>
              <span className="text-lg font-semibold text-white">{data.agents.total}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Active</span>
              <span className="text-lg font-semibold text-indigo-400">{data.agents.active}</span>
            </div>
          </div>
        </motion.div>

        {/* AIS System */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-4 border border-white/10"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-yellow-400" />
              <h3 className="text-sm font-semibold text-white">AIS</h3>
            </div>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
              data.ais.mode === 'dynamic' ? 'bg-green-500/20 text-green-300' : 'bg-blue-500/20 text-blue-300'
            }`}>
              {data.ais.mode === 'dynamic' ? 'Dynamic' : 'Best Practice'}
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">AI Usage</span>
              <span className="text-lg font-semibold text-white">
                {data.ais.totalTokens > 0
                  ? data.ais.totalTokens >= 1000000
                    ? `${(data.ais.totalTokens / 1000000).toFixed(2)}M`
                    : `${Math.round(data.ais.totalTokens / 1000)}K`
                  : '-'
                }
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Total Cost</span>
              <span className="text-lg font-semibold text-yellow-400">
                {data.ais.totalCost > 0 ? formatCost(data.ais.totalCost) : '-'}
              </span>
            </div>
          </div>
          {data.ais.totalTokens > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Creation: {data.ais.creationTokens}K</span>
                <span>Execution: {data.ais.executionTokens}K</span>
              </div>
            </div>
          )}
          {data.ais.growthAlerts > 0 && (
            <div className="mt-3 pt-3 border-t border-white/5">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-orange-400" />
                <div className="flex-1">
                  <div className="text-xs text-orange-400 font-semibold">{data.ais.growthAlerts} Growth Alert{data.ais.growthAlerts > 1 ? 's' : ''}</div>
                  <div className="text-xs text-slate-400">Avg: +{data.ais.avgGrowthRate}% output tokens</div>
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* Queue Status */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-4 border border-white/10"
        >
          <div className="flex items-center gap-3 mb-3">
            <Activity className="w-5 h-5 text-blue-400" />
            <h3 className="text-sm font-semibold text-white">Queue Status</h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Pending</span>
              <span className="text-lg font-semibold text-yellow-400">{data.queue.pending}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Running</span>
              <span className="text-lg font-semibold text-blue-400">{data.queue.running}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Failed</span>
              <span className="text-lg font-semibold text-red-400">{data.queue.failed}</span>
            </div>
          </div>
        </motion.div>

        {/* Performance */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.55 }}
          className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-4 border border-white/10"
        >
          <div className="flex items-center gap-3 mb-3">
            <Zap className="w-5 h-5 text-orange-400" />
            <h3 className="text-sm font-semibold text-white">Performance</h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Avg Time</span>
              <span className="text-lg font-semibold text-white">{data.queue.avgProcessingTime}s</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Processed</span>
              <span className="text-lg font-semibold text-orange-400">{formatNumber(data.queue.totalProcessed)}</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Quick Actions */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
        className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10"
      >
        <h2 className="text-xl font-semibold text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <Link
            href="/admin/users"
            className="flex items-center justify-between p-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors group border border-white/5"
          >
            <div className="flex items-center gap-3">
              <Users className="w-4 h-4 text-green-400" />
              <span className="text-sm text-slate-300">Manage Users</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
          </Link>

          <Link
            href="/admin/analytics"
            className="flex items-center justify-between p-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors group border border-white/5"
          >
            <div className="flex items-center gap-3">
              <DollarSign className="w-4 h-4 text-orange-400" />
              <span className="text-sm text-slate-300">View Analytics</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
          </Link>

          <Link
            href="/admin/learning-system"
            className="flex items-center justify-between p-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors group border border-white/5"
          >
            <div className="flex items-center gap-3">
              <Brain className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-slate-300">Memory System</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
          </Link>

          <Link
            href="/admin/ais-config"
            className="flex items-center justify-between p-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors group border border-white/5"
          >
            <div className="flex items-center gap-3">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className="text-sm text-slate-300">AIS Config</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
          </Link>

          <Link
            href="/admin/queues"
            className="flex items-center justify-between p-3 bg-slate-700/30 hover:bg-slate-700/50 rounded-lg transition-colors group border border-white/5"
          >
            <div className="flex items-center gap-3">
              <Server className="w-4 h-4 text-blue-400" />
              <span className="text-sm text-slate-300">Queue Monitor</span>
            </div>
            <ArrowUpRight className="w-4 h-4 text-slate-400 group-hover:text-white transition-colors" />
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

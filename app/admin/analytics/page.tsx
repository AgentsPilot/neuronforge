'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Search, 
  RefreshCw,
  Eye,
  Filter,
  Calendar,
  DollarSign,
  Zap,
  Clock,
  TrendingUp,
  TrendingDown,
  Activity,
  Users,
  BarChart3,
  Database,
  AlertCircle,
  CheckCircle,
  X
} from 'lucide-react';

interface TokenUsageRecord {
  id: string;
  user_id: string;
  agent_id?: string;
  session_id?: string;
  request_type: string;
  provider: string;
  model_name: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  latency_ms?: number;
  success: boolean;
  error_message?: string;
  error_code?: string;
  metadata?: any;
  created_at: string;
  category?: string;
  feature?: string;
  component?: string;
  activity_name?: string;
  activity_type?: string;
  profiles?: {
    full_name: string;
    company: string;
  };
}

interface AggregatedUserUsage {
  user_id: string;
  user_email?: string;
  user_name?: string;
  user_company?: string;
  total_cost: number;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  request_count: number;
  success_count: number;
  success_rate: number;
  avg_cost_per_request: number;
  last_activity: string;
  providers: string[];
  models: string[];
}

interface UsageStats {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
  averageLatency: number;
  successRate: number;
  byProvider: Record<string, { tokens: number; cost: number; requests: number }>;
  byOperation: Record<string, { tokens: number; cost: number; requests: number }>;
}

export default function AdminTokenAnalytics() {
  const [rawUsageData, setRawUsageData] = useState<TokenUsageRecord[]>([]);
  const [aggregatedUsage, setAggregatedUsage] = useState<AggregatedUserUsage[]>([]);
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedUsage, setSelectedUsage] = useState<AggregatedUserUsage | null>(null);
  const [selectedUserRecords, setSelectedUserRecords] = useState<TokenUsageRecord[]>([]);
  const [filter, setFilter] = useState<'all' | 'success' | 'error'>('all');
  const [providerFilter, setProviderFilter] = useState<'all' | 'openai' | 'anthropic' | 'google'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [dateRange, setDateRange] = useState({ from: '', to: '' });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  useEffect(() => {
    fetchUsageData();
  }, [filter, providerFilter]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (searchTerm !== '') {
        fetchUsageData();
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchTerm]);

  // Aggregate raw usage data by user
  const aggregateUsageByUser = (records: TokenUsageRecord[]): AggregatedUserUsage[] => {
    const userMap = new Map<string, AggregatedUserUsage>();

    records.forEach(record => {
      const userId = record.user_id;
      
      if (!userMap.has(userId)) {
        userMap.set(userId, {
          user_id: userId,
          user_email: userId, // Use user_id as fallback
          user_name: record.profiles?.full_name,
          user_company: record.profiles?.company,
          total_cost: 0,
          total_tokens: 0,
          input_tokens: 0,
          output_tokens: 0,
          request_count: 0,
          success_count: 0,
          success_rate: 0,
          avg_cost_per_request: 0,
          last_activity: record.created_at,
          providers: [],
          models: []
        });
      }

      const user = userMap.get(userId)!;
      user.total_cost += record.cost_usd || 0;
      user.total_tokens += record.total_tokens || 0;
      user.input_tokens += record.input_tokens || 0;
      user.output_tokens += record.output_tokens || 0;
      user.request_count += 1;
      
      if (record.success) {
        user.success_count += 1;
      }

      // Track latest activity
      if (new Date(record.created_at) > new Date(user.last_activity)) {
        user.last_activity = record.created_at;
      }

      // Track unique providers and models
      if (record.provider && !user.providers.includes(record.provider)) {
        user.providers.push(record.provider);
      }
      if (record.model_name && !user.models.includes(record.model_name)) {
        user.models.push(record.model_name);
      }
    });

    // Calculate success rate and average cost
    return Array.from(userMap.values()).map(user => ({
      ...user,
      success_rate: user.request_count > 0 ? (user.success_count / user.request_count) * 100 : 0,
      avg_cost_per_request: user.request_count > 0 ? user.total_cost / user.request_count : 0
    }));
  };

  const fetchUsageData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const queryParams = new URLSearchParams({
        filter,
        provider: providerFilter,
        search: searchTerm,
        ...(dateRange.from && { dateFrom: dateRange.from }),
        ...(dateRange.to && { dateTo: dateRange.to })
      });
      
      console.log('Fetching URL:', `/api/admin/token-usage?${queryParams}`);
      
      const response = await fetch(`/api/admin/token-usage?${queryParams}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        cache: 'no-store'
      });
      
      console.log('Response status:', response.status, response.ok);
      
      if (!response.ok) {
        let errorMessage = 'Failed to fetch usage data';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.message || errorMessage;
        } catch (e) {
          errorMessage = response.statusText || errorMessage;
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      console.log('Raw API response:', result);
      
      if (!result.success) {
        throw new Error(result.error || 'API returned unsuccessful response');
      }
      
      const records = result.data || [];
      setRawUsageData(records);
      
      // Aggregate the data by user
      const aggregated = aggregateUsageByUser(records);
      setAggregatedUsage(aggregated);
      
      // Set stats from API or calculate from aggregated data
      if (result.stats) {
        setStats(result.stats);
      } else {
        // Calculate stats from aggregated data
        const totalCost = aggregated.reduce((sum, user) => sum + user.total_cost, 0);
        const totalTokens = aggregated.reduce((sum, user) => sum + user.total_tokens, 0);
        const totalRequests = aggregated.reduce((sum, user) => sum + user.request_count, 0);
        const totalSuccessful = aggregated.reduce((sum, user) => sum + user.success_count, 0);
        
        setStats({
          totalCost,
          totalTokens,
          totalRequests,
          averageLatency: 0, // Calculate if needed
          successRate: totalRequests > 0 ? (totalSuccessful / totalRequests) * 100 : 0,
          byProvider: result.stats?.byProvider || {},
          byOperation: result.stats?.byOperation || {}
        });
      }
      
      console.log('Successfully processed usage data:', {
        rawRecords: records.length,
        aggregatedUsers: aggregated.length
      });
      
    } catch (error) {
      console.error('Error fetching usage data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error occurred');
      setRawUsageData([]);
      setAggregatedUsage([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredUsage = () => {
    let filtered = aggregatedUsage;

    if (filter !== 'all') {
      filtered = filtered.filter(user => {
        if (filter === 'success') return user.success_rate >= 95;
        if (filter === 'error') return user.success_rate < 95;
        return true;
      });
    }

    if (providerFilter !== 'all') {
      filtered = filtered.filter(user => 
        user.providers.includes(providerFilter)
      );
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(user => 
        user.user_email?.toLowerCase().includes(term) ||
        user.user_name?.toLowerCase().includes(term) ||
        user.user_company?.toLowerCase().includes(term) ||
        user.user_id.toLowerCase().includes(term) ||
        user.models.some(model => model.toLowerCase().includes(term)) ||
        user.providers.some(provider => provider.toLowerCase().includes(term))
      );
    }

    return filtered.sort((a, b) => new Date(b.last_activity).getTime() - new Date(a.last_activity).getTime());
  };

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4
    }).format(cost);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getProviderColor = (provider: string) => {
    const colors = {
      openai: 'bg-green-500/20 text-green-300',
      anthropic: 'bg-orange-500/20 text-orange-300',
      google: 'bg-blue-500/20 text-blue-300'
    };
    return colors[provider as keyof typeof colors] || 'bg-slate-500/20 text-slate-300';
  };

  const handleViewUserDetails = (user: AggregatedUserUsage) => {
    // Get all records for this user
    const userRecords = rawUsageData.filter(record => record.user_id === user.user_id);
    setSelectedUserRecords(userRecords);
    setSelectedUsage(user);
  };

  // Error Display Component
  const ErrorDisplay = ({ error, onRetry }: { error: string; onRetry: () => void }) => (
    <div className="flex flex-col items-center justify-center p-8 text-center">
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 max-w-md">
        <div className="flex items-center justify-center w-12 h-12 mx-auto mb-4 bg-red-100 rounded-full">
          <AlertCircle className="w-6 h-6 text-red-600" />
        </div>
        <h3 className="text-lg font-semibold text-red-800 mb-2">Failed to Load Token Usage</h3>
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-slate-400">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return <ErrorDisplay error={error} onRetry={fetchUsageData} />;
  }

  const filteredUsage = getFilteredUsage();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Token Usage Analytics</h1>
          <div className="flex items-center gap-4">
            <p className="text-slate-400">Monitor AI model usage and costs across all users</p>
            {stats && (
              <div className="flex items-center gap-3 text-sm">
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3 h-3 text-green-400" />
                  <span className="text-green-300">
                    {formatCost(stats.totalCost)} total cost
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3 text-blue-400" />
                  <span className="text-blue-300">
                    {formatNumber(stats.totalTokens)} tokens
                  </span>
                </span>
                <span className="flex items-center gap-1">
                  <Activity className="w-3 h-3 text-purple-400" />
                  <span className="text-purple-300">
                    {stats.successRate.toFixed(1)}% success rate
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="px-3 py-1 bg-slate-700/50 text-slate-300 rounded text-sm hover:bg-slate-600/50 transition-colors border border-slate-600"
          >
            <Filter className="w-4 h-4 inline mr-1" />
            {showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters'}
          </button>
          <button 
            onClick={fetchUsageData}
            className="p-2 bg-slate-800/50 hover:bg-slate-700/50 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-green-500/20 backdrop-blur-xl rounded-xl p-4 border border-green-500/20">
            <div className="text-center">
              <DollarSign className="w-6 h-6 mx-auto mb-2 text-green-300" />
              <p className="text-2xl font-bold text-green-300">{formatCost(stats.totalCost)}</p>
              <p className="text-xs text-green-400">Total Cost</p>
            </div>
          </div>
          
          <div className="bg-blue-500/20 backdrop-blur-xl rounded-xl p-4 border border-blue-500/20">
            <div className="text-center">
              <Zap className="w-6 h-6 mx-auto mb-2 text-blue-300" />
              <p className="text-2xl font-bold text-blue-300">{formatNumber(stats.totalTokens)}</p>
              <p className="text-xs text-blue-400">Total Tokens</p>
            </div>
          </div>
          
          <div className="bg-purple-500/20 backdrop-blur-xl rounded-xl p-4 border border-purple-500/20">
            <div className="text-center">
              <BarChart3 className="w-6 h-6 mx-auto mb-2 text-purple-300" />
              <p className="text-2xl font-bold text-purple-300">{formatNumber(stats.totalRequests)}</p>
              <p className="text-xs text-purple-400">Total Requests</p>
            </div>
          </div>
          
          <div className="bg-orange-500/20 backdrop-blur-xl rounded-xl p-4 border border-orange-500/20">
            <div className="text-center">
              <Users className="w-6 h-6 mx-auto mb-2 text-orange-300" />
              <p className="text-2xl font-bold text-orange-300">{formatNumber(aggregatedUsage.length)}</p>
              <p className="text-xs text-orange-400">Active Users</p>
            </div>
          </div>
        </div>
      )}

      {/* Filters & Search */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl p-6 border border-white/10">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-700/50 rounded-lg px-3 py-2 min-w-[300px]">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search users, models, providers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-transparent text-white placeholder-slate-400 text-sm focus:outline-none flex-1"
              />
            </div>
            
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as any)}
              className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
            >
              <option value="all">All Users</option>
              <option value="success">High Success Rate (95%+)</option>
              <option value="error">Low Success Rate (&lt;95%)</option>
            </select>

            <select
              value={providerFilter}
              onChange={(e) => setProviderFilter(e.target.value as any)}
              className="bg-slate-700/50 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
            >
              <option value="all">All Providers</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
            </select>
          </div>

          {/* Advanced Filters */}
          {showAdvancedFilters && (
            <div className="p-4 bg-slate-700/30 rounded-lg border border-slate-600">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Date Range</label>
                  <div className="flex gap-2">
                    <input
                      type="datetime-local"
                      value={dateRange.from}
                      onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value }))}
                      className="bg-slate-700/50 border border-slate-600 rounded text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 px-3 py-2"
                    />
                    <input
                      type="datetime-local"
                      value={dateRange.to}
                      onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value }))}
                      className="bg-slate-700/50 border border-slate-600 rounded text-sm text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 px-3 py-2"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">Quick Actions</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setDateRange({ from: '', to: '' });
                        setSearchTerm('');
                        setProviderFilter('all');
                        setFilter('all');
                      }}
                      className="px-3 py-2 bg-slate-600/50 text-slate-300 rounded text-sm hover:bg-slate-500/50 transition-colors"
                    >
                      Clear All
                    </button>
                    <button
                      onClick={() => {
                        const today = new Date();
                        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
                        setDateRange({
                          from: yesterday.toISOString().slice(0, 16),
                          to: today.toISOString().slice(0, 16)
                        });
                      }}
                      className="px-3 py-2 bg-blue-500/20 text-blue-300 rounded text-sm hover:bg-blue-500/30 transition-colors border border-blue-500/20"
                    >
                      Last 24h
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Usage List */}
      <div className="bg-slate-800/50 backdrop-blur-xl rounded-xl border border-white/10 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-slate-700/50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Requests & Providers</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Total Tokens</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Total Cost</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Success Rate</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Last Activity</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-300 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {filteredUsage.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                    <Database className="w-12 h-12 mx-auto mb-4 text-slate-600" />
                    <p className="text-lg font-medium">No usage data found</p>
                    <p className="text-sm">Try adjusting your search or filter criteria</p>
                  </td>
                </tr>
              ) : (
                filteredUsage.slice(0, 100).map((user) => (
                  <tr key={user.user_id} className="hover:bg-slate-700/30 transition-colors">
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-white">
                          {user.user_name || user.user_email || `User ${user.user_id.slice(0, 8)}`}
                        </p>
                        {user.user_email && user.user_name && (
                          <p className="text-xs text-slate-400">{user.user_email}</p>
                        )}
                        {user.user_company && (
                          <p className="text-xs text-slate-400">{user.user_company}</p>
                        )}
                        <p className="text-xs text-slate-500 font-mono">{user.user_id.slice(0, 8)}...</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-white">{user.request_count} requests</p>
                        {user.providers && user.providers.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {user.providers.slice(0, 2).map(provider => (
                              <span key={provider} className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${getProviderColor(provider)}`}>
                                {provider}
                              </span>
                            ))}
                            {user.providers.length > 2 && (
                              <span className="text-xs text-slate-400">+{user.providers.length - 2}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm">
                        <p className="text-white font-medium">{formatNumber(user.total_tokens)}</p>
                        <p className="text-xs text-slate-400">
                          {formatNumber(user.input_tokens)} in / {formatNumber(user.output_tokens)} out
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <p className="text-sm font-medium text-green-300">{formatCost(user.total_cost)}</p>
                        <p className="text-xs text-slate-400">
                          {formatCost(user.avg_cost_per_request)} avg
                        </p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                          user.success_rate >= 95 
                            ? 'bg-green-500/20 text-green-300' 
                            : user.success_rate >= 85 
                            ? 'bg-yellow-500/20 text-yellow-300'
                            : 'bg-red-500/20 text-red-300'
                        }`}>
                          {user.success_rate.toFixed(1)}%
                        </span>
                        <span className="text-xs text-slate-400">
                          {user.success_count}/{user.request_count} successful
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-400">
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {formatDate(user.last_activity)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleViewUserDetails(user)}
                        className="text-blue-400 hover:text-blue-300 p-1 rounded hover:bg-blue-500/20 transition-colors"
                        title="View details"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        
        {filteredUsage.length > 100 && (
          <div className="px-6 py-3 bg-slate-700/30 border-t border-slate-600">
            <p className="text-sm text-slate-400">
              Showing first 100 of {filteredUsage.length} users. Use filters to narrow results.
            </p>
          </div>
        )}
      </div>

      {/* User Detail Modal */}
      {selectedUsage && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-slate-800/95 backdrop-blur-xl rounded-xl border border-white/10 max-w-6xl w-full max-h-[90vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-white/10 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold text-white">User Usage Details</h2>
                <div className="flex gap-2">
                  <span className="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-300 rounded-full">
                    {selectedUsage.request_count} requests
                  </span>
                  <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                    selectedUsage.success_rate >= 95 ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'
                  }`}>
                    {selectedUsage.success_rate.toFixed(1)}% success
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedUsage(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* User Overview */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-700/30 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <Users className="w-5 h-5" />
                    User Information
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-sm">User ID:</span>
                      <p className="text-white font-mono text-sm">{selectedUsage.user_id}</p>
                    </div>
                    {selectedUsage.user_email && (
                      <div>
                        <span className="text-slate-400 text-sm">Email:</span>
                        <p className="text-white">{selectedUsage.user_email}</p>
                      </div>
                    )}
                    {selectedUsage.user_name && (
                      <div>
                        <span className="text-slate-400 text-sm">Name:</span>
                        <p className="text-white">{selectedUsage.user_name}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-slate-700/30 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    Usage Summary
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-sm">Total Tokens:</span>
                      <p className="text-white font-medium">{formatNumber(selectedUsage.total_tokens)}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-sm">Total Cost:</span>
                      <p className="text-green-300 font-bold">{formatCost(selectedUsage.total_cost)}</p>
                    </div>
                    <div>
                      <span className="text-slate-400 text-sm">Avg per Request:</span>
                      <p className="text-white">{formatCost(selectedUsage.avg_cost_per_request)}</p>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-700/30 p-4 rounded-lg">
                  <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                    <Activity className="w-5 h-5" />
                    Providers & Models
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <span className="text-slate-400 text-sm">Providers:</span>
                      <div className="flex gap-1 mt-1">
                        {selectedUsage.providers.map(provider => (
                          <span key={provider} className={`inline-flex items-center px-2 py-1 text-xs font-medium rounded-full ${getProviderColor(provider)}`}>
                            {provider}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="text-slate-400 text-sm">Models Used:</span>
                      <p className="text-white text-sm">{selectedUsage.models.length} different models</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Recent Records */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-4">Recent Usage Records</h3>
                <div className="bg-slate-900/50 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-700/50">
                        <tr>
                          <th className="px-4 py-2 text-left text-slate-300">Date</th>
                          <th className="px-4 py-2 text-left text-slate-300">Provider</th>
                          <th className="px-4 py-2 text-left text-slate-300">Model</th>
                          <th className="px-4 py-2 text-left text-slate-300">Tokens</th>
                          <th className="px-4 py-2 text-left text-slate-300">Cost</th>
                          <th className="px-4 py-2 text-left text-slate-300">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-700/50">
                        {selectedUserRecords.slice(0, 20).map((record, index) => (
                          <tr key={record.id || index} className="hover:bg-slate-700/30">
                            <td className="px-4 py-2 text-slate-300">
                              {new Date(record.created_at).toLocaleString()}
                            </td>
                            <td className="px-4 py-2">
                              <span className={`px-2 py-1 text-xs rounded-full ${getProviderColor(record.provider)}`}>
                                {record.provider}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-slate-300">{record.model_name}</td>
                            <td className="px-4 py-2 text-slate-300">{formatNumber(record.total_tokens)}</td>
                            <td className="px-4 py-2 text-green-300">{formatCost(record.cost_usd)}</td>
                            <td className="px-4 py-2">
                              {record.success ? (
                                <span className="px-2 py-1 text-xs bg-green-500/20 text-green-300 rounded-full flex items-center gap-1 w-fit">
                                  <CheckCircle className="w-3 h-3" />
                                  Success
                                </span>
                              ) : (
                                <span className="px-2 py-1 text-xs bg-red-500/20 text-red-300 rounded-full flex items-center gap-1 w-fit">
                                  <AlertCircle className="w-3 h-3" />
                                  Error
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedUserRecords.length > 20 && (
                    <div className="px-4 py-2 bg-slate-700/30 text-slate-400 text-sm">
                      Showing latest 20 of {selectedUserRecords.length} records
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
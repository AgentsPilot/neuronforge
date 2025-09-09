'use client'

import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Zap, 
  Clock, 
  Calendar,
  Download,
  Filter,
  RefreshCw,
  PieChart,
  Activity,
  Target,
  AlertTriangle,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  Minus
} from 'lucide-react';
import { useAuth } from '@/components/UserProvider';
import { supabase } from '@/lib/supabaseClient';

interface TokenUsage {
  id: string;
  user_id: string;
  model_name: string;
  provider: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  request_type: string;
  session_id?: string;
  metadata?: any;
  created_at: string;
  updated_at: string;
}

interface Analytics {
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  avgCostPerRequest: number;
  avgTokensPerRequest: number;
  avgCostPerToken: number;
  dailyData: Array<{
    date: string;
    tokens: number;
    cost: number;
    requests: number;
  }>;
  modelBreakdown: Array<{
    model: string;
    provider: string;
    tokens: number;
    cost: number;
    requests: number;
    percentage: number;
  }>;
  hourlyPattern: Array<{
    hour: number;
    tokens: number;
    cost: number;
    requests: number;
  }>;
  efficiency: Array<{
    model: string;
    costPerToken: number;
    tokensPerRequest: number;
    costPerRequest: number;
  }>;
  trend: 'up' | 'down' | 'stable';
  trendPercentage: number;
}

const TokenAnalyticsDashboard = () => {
  const { user } = useAuth();
  const [tokenData, setTokenData] = useState<TokenUsage[]>([]);
  const [timeFilter, setTimeFilter] = useState('30d');
  const [modelFilter, setModelFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);

  useEffect(() => {
    if (user) {
      loadData();
    }
  }, [user, timeFilter, modelFilter]);

  const loadData = async () => {
    if (!user?.id) return;

    setLoading(true);
    try {
      // Calculate date filter
      const now = new Date();
      const filterDate = new Date();
      
      switch (timeFilter) {
        case '7d':
          filterDate.setDate(now.getDate() - 7);
          break;
        case '30d':
          filterDate.setDate(now.getDate() - 30);
          break;
        case '90d':
          filterDate.setDate(now.getDate() - 90);
          break;
        case 'all':
        default:
          filterDate.setFullYear(2020);
          break;
      }

      // Build query
      let query = supabase
        .from('token_usage')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (timeFilter !== 'all') {
        query = query.gte('created_at', filterDate.toISOString());
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error loading token usage data:', error);
        return;
      }

      // Filter by model if selected
      let filteredData = data || [];
      if (modelFilter !== 'all') {
        filteredData = filteredData.filter(item => item.model_name === modelFilter);
      }

      setTokenData(filteredData);
      calculateAnalytics(filteredData);

    } catch (error) {
      console.error('Error in loadData:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateAnalytics = (data: TokenUsage[]) => {
    if (!data.length) {
      setAnalytics(null);
      return;
    }

    // Basic metrics
    const totalTokens = data.reduce((sum, item) => sum + item.total_tokens, 0);
    const totalCost = data.reduce((sum, item) => sum + item.cost_usd, 0);
    const totalRequests = data.length;

    // Daily breakdown
    const dailyMap = new Map<string, { tokens: number; cost: number; requests: number }>();
    data.forEach(item => {
      const date = new Date(item.created_at).toISOString().split('T')[0];
      const existing = dailyMap.get(date) || { tokens: 0, cost: 0, requests: 0 };
      dailyMap.set(date, {
        tokens: existing.tokens + item.total_tokens,
        cost: existing.cost + item.cost_usd,
        requests: existing.requests + 1
      });
    });

    const dailyData = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Model breakdown
    const modelMap = new Map<string, { tokens: number; cost: number; requests: number; provider: string }>();
    data.forEach(item => {
      const existing = modelMap.get(item.model_name) || { 
        tokens: 0, 
        cost: 0, 
        requests: 0, 
        provider: item.provider 
      };
      modelMap.set(item.model_name, {
        tokens: existing.tokens + item.total_tokens,
        cost: existing.cost + item.cost_usd,
        requests: existing.requests + 1,
        provider: item.provider
      });
    });

    const modelBreakdown = Array.from(modelMap.entries())
      .map(([model, data]) => ({ 
        model, 
        provider: data.provider,
        tokens: data.tokens,
        cost: data.cost,
        requests: data.requests,
        percentage: totalCost > 0 ? (data.cost / totalCost) * 100 : 0
      }))
      .sort((a, b) => b.cost - a.cost);

    // Hourly pattern
    const hourlyMap = new Map<number, { tokens: number; cost: number; requests: number }>();
    for (let i = 0; i < 24; i++) {
      hourlyMap.set(i, { tokens: 0, cost: 0, requests: 0 });
    }
    
    data.forEach(item => {
      const hour = new Date(item.created_at).getHours();
      const existing = hourlyMap.get(hour)!;
      hourlyMap.set(hour, {
        tokens: existing.tokens + item.total_tokens,
        cost: existing.cost + item.cost_usd,
        requests: existing.requests + 1
      });
    });

    const hourlyPattern = Array.from(hourlyMap.entries()).map(([hour, data]) => ({ hour, ...data }));

    // Cost efficiency by model
    const efficiency = modelBreakdown.map(model => ({
      model: model.model,
      costPerToken: model.tokens > 0 ? model.cost / model.tokens : 0,
      tokensPerRequest: model.requests > 0 ? model.tokens / model.requests : 0,
      costPerRequest: model.requests > 0 ? model.cost / model.requests : 0
    }));

    // Trend calculation
    const recentDays = dailyData.slice(-7);
    const previousDays = dailyData.slice(-14, -7);
    
    const recentAvg = recentDays.length > 0 ? 
      recentDays.reduce((sum, day) => sum + day.cost, 0) / recentDays.length : 0;
    const previousAvg = previousDays.length > 0 ? 
      previousDays.reduce((sum, day) => sum + day.cost, 0) / previousDays.length : 0;
    
    const trendPercentage = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;
    const trend: 'up' | 'down' | 'stable' = Math.abs(trendPercentage) < 5 ? 'stable' : trendPercentage > 0 ? 'up' : 'down';

    setAnalytics({
      totalTokens,
      totalCost,
      totalRequests,
      avgCostPerRequest: totalRequests > 0 ? totalCost / totalRequests : 0,
      avgTokensPerRequest: totalRequests > 0 ? totalTokens / totalRequests : 0,
      avgCostPerToken: totalTokens > 0 ? totalCost / totalTokens : 0,
      dailyData,
      modelBreakdown,
      hourlyPattern,
      efficiency,
      trend,
      trendPercentage: Math.abs(trendPercentage)
    });
  };

  const formatCost = (cost: number) => `$${cost.toFixed(4)}`;
  const formatNumber = (num: number) => num.toLocaleString();

  const exportData = () => {
    if (!analytics) return;
    
    const exportData = {
      summary: {
        totalTokens: analytics.totalTokens,
        totalCost: analytics.totalCost,
        totalRequests: analytics.totalRequests,
        timeframe: timeFilter,
        exportedAt: new Date().toISOString()
      },
      analytics,
      recentUsage: tokenData.slice(0, 100)
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `token-analytics-${timeFilter}-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="flex items-center justify-center py-32">
          <div className="text-center">
            <div className="animate-spin w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-600">Loading token analytics from Supabase...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="text-center py-32">
          <Zap className="w-16 h-16 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold text-gray-600 mb-2">No token usage data found</h3>
          <p className="text-gray-500">Start using AI models to see analytics here</p>
          <button
            onClick={loadData}
            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh Data
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Token Usage Analytics</h1>
          <p className="text-gray-600">Real-time analysis of your AI token consumption and costs from Supabase</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4 mt-4 lg:mt-0">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <select
              value={timeFilter}
              onChange={(e) => setTimeFilter(e.target.value)}
              className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="all">All time</option>
            </select>
          </div>
          
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">All models</option>
            {analytics.modelBreakdown.map(model => (
              <option key={model.model} value={model.model}>{model.model}</option>
            ))}
          </select>
          
          <button
            onClick={loadData}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
          
          <button
            onClick={exportData}
            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Zap className="w-6 h-6 text-blue-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{formatNumber(analytics.totalTokens)}</p>
              <p className="text-sm text-gray-600">Total Tokens</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {analytics.trend === 'up' ? <ArrowUp className="w-4 h-4 text-red-500" /> :
             analytics.trend === 'down' ? <ArrowDown className="w-4 h-4 text-green-500" /> :
             <Minus className="w-4 h-4 text-gray-500" />}
            <span className={`text-sm ${
              analytics.trend === 'up' ? 'text-red-500' : 
              analytics.trend === 'down' ? 'text-green-500' : 'text-gray-500'
            }`}>
              {analytics.trend === 'stable' ? 'Stable usage' : `${analytics.trendPercentage.toFixed(1)}% ${analytics.trend}`}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-green-100 rounded-lg">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{formatCost(analytics.totalCost)}</p>
              <p className="text-sm text-gray-600">Total Cost</p>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            {formatCost(analytics.avgCostPerRequest)} avg per request
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-purple-100 rounded-lg">
              <BarChart3 className="w-6 h-6 text-purple-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{formatNumber(analytics.totalRequests)}</p>
              <p className="text-sm text-gray-600">Total Requests</p>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            {formatNumber(Math.round(analytics.avgTokensPerRequest))} avg tokens/request
          </p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-orange-100 rounded-lg">
              <Target className="w-6 h-6 text-orange-600" />
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">{formatCost(analytics.avgCostPerToken * 1000)}</p>
              <p className="text-sm text-gray-600">Cost per 1K Tokens</p>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            Industry standard metric
          </p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Daily Usage Chart */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            Daily Token Usage & Cost
          </h3>
          <div className="space-y-4">
            {analytics.dailyData.slice(-14).map((day, index) => {
              const maxTokens = Math.max(...analytics.dailyData.map(d => d.tokens));
              const tokenWidth = maxTokens > 0 ? (day.tokens / maxTokens) * 100 : 0;
              
              return (
                <div key={day.date} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium text-gray-700">
                      {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-gray-900">{formatNumber(day.tokens)}</div>
                      <div className="text-xs text-gray-500">{formatCost(day.cost)}</div>
                    </div>
                  </div>
                  <div className="bg-gray-200 rounded-full h-3">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-purple-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(tokenWidth, 2)}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-gray-500">{day.requests} requests</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Model Distribution */}
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
            <PieChart className="w-5 h-5 text-green-600" />
            Model Usage Distribution
          </h3>
          <div className="space-y-4">
            {analytics.modelBreakdown.map((model, index) => {
              const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-red-500'];
              const color = colors[index % colors.length];
              
              return (
                <div key={model.model} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full ${color}`}></div>
                      <div>
                        <span className="font-medium text-gray-900">{model.model}</span>
                        <span className="text-xs text-gray-500 ml-2">({model.provider})</span>
                      </div>
                    </div>
                    <span className="text-sm text-gray-600">{model.percentage.toFixed(1)}%</span>
                  </div>
                  <div className="bg-gray-200 rounded-full h-2">
                    <div 
                      className={`${color} h-2 rounded-full transition-all duration-300`}
                      style={{ width: `${model.percentage}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{formatNumber(model.tokens)} tokens</span>
                    <span>{formatCost(model.cost)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hourly Pattern */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-600" />
          Hourly Usage Pattern
        </h3>
        <div className="grid grid-cols-24 gap-1">
          {analytics.hourlyPattern.map((hour) => {
            const maxTokens = Math.max(...analytics.hourlyPattern.map(h => h.tokens));
            const height = maxTokens > 0 ? (hour.tokens / maxTokens) * 100 : 0;
            
            return (
              <div key={hour.hour} className="flex flex-col items-center">
                <div className="h-32 flex items-end justify-center w-full">
                  <div 
                    className="w-full bg-indigo-500 rounded-t hover:bg-indigo-600 transition-colors cursor-pointer"
                    style={{ height: `${Math.max(height, 2)}%` }}
                    title={`${hour.hour}:00 - ${formatNumber(hour.tokens)} tokens, ${formatCost(hour.cost)}`}
                  ></div>
                </div>
                <div className="text-xs text-gray-600 mt-1">{hour.hour}</div>
              </div>
            );
          })}
        </div>
        <div className="text-center text-xs text-gray-500 mt-4">Hour of day (24h format)</div>
      </div>

      {/* Efficiency Analysis */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm mb-8">
        <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <Activity className="w-5 h-5 text-purple-600" />
          Model Efficiency Analysis
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-medium text-gray-700">Model</th>
                <th className="text-right py-3 px-4 font-medium text-gray-700">Cost per Token</th>
                <th className="text-right py-3 px-4 font-medium text-gray-700">Tokens per Request</th>
                <th className="text-right py-3 px-4 font-medium text-gray-700">Cost per Request</th>
                <th className="text-center py-3 px-4 font-medium text-gray-700">Efficiency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {analytics.efficiency.map((model, index) => {
                const avgCostPerToken = analytics.efficiency.length > 0 ? 
                  analytics.efficiency.reduce((sum, m) => sum + m.costPerToken, 0) / analytics.efficiency.length : 0;
                const isEfficient = model.costPerToken < avgCostPerToken;
                
                return (
                  <tr key={model.model} className="hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{model.model}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{formatCost(model.costPerToken)}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{formatNumber(Math.round(model.tokensPerRequest))}</td>
                    <td className="py-3 px-4 text-right text-gray-700">{formatCost(model.costPerRequest)}</td>
                    <td className="py-3 px-4 text-center">
                      {isEfficient ? (
                        <CheckCircle className="w-5 h-5 text-green-500 mx-auto" />
                      ) : (
                        <AlertTriangle className="w-5 h-5 text-yellow-500 mx-auto" />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent High-Cost Requests */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-600" />
          Recent High-Cost Requests
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 font-medium text-gray-700">Time</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Model</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Provider</th>
                <th className="text-left py-3 px-4 font-medium text-gray-700">Type</th>
                <th className="text-right py-3 px-4 font-medium text-gray-700">Input Tokens</th>
                <th className="text-right py-3 px-4 font-medium text-gray-700">Output Tokens</th>
                <th className="text-right py-3 px-4 font-medium text-gray-700">Total Tokens</th>
                <th className="text-right py-3 px-4 font-medium text-gray-700">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tokenData
                .sort((a, b) => b.cost_usd - a.cost_usd)
                .slice(0, 10)
                .map((item, index) => (
                <tr key={item.id} className="hover:bg-gray-50">
                  <td className="py-3 px-4 text-gray-700">
                    {new Date(item.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-gray-900 font-medium">{item.model_name}</td>
                  <td className="py-3 px-4 text-gray-700 capitalize">{item.provider}</td>
                  <td className="py-3 px-4 text-gray-700 capitalize">{item.request_type}</td>
                  <td className="py-3 px-4 text-right text-gray-700">{formatNumber(item.input_tokens)}</td>
                  <td className="py-3 px-4 text-right text-gray-700">{formatNumber(item.output_tokens)}</td>
                  <td className="py-3 px-4 text-right text-gray-900 font-medium">{formatNumber(item.total_tokens)}</td>
                  <td className="py-3 px-4 text-right text-gray-900 font-bold">{formatCost(item.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tokenData.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500">No token usage data available</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TokenAnalyticsDashboard;
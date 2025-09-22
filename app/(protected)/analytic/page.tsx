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
  Minus,
  Sparkles,
  Brain,
  Globe
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
    
    // Create CSV content
    const csvHeaders = [
      'Date/Time',
      'Model',
      'Provider', 
      'Request Type',
      'Input Tokens',
      'Output Tokens',
      'Total Tokens',
      'Cost (USD)',
      'Session ID'
    ];
    
    const csvRows = tokenData.map(item => [
      new Date(item.created_at).toLocaleString(),
      item.model_name,
      item.provider,
      item.request_type,
      item.input_tokens,
      item.output_tokens,
      item.total_tokens,
      item.cost_usd,
      item.session_id || ''
    ]);
    
    // Add summary row
    csvRows.unshift(['=== SUMMARY ===', '', '', '', '', '', '', '', '']);
    csvRows.push(['', '', '', '', '', '', '', '', '']);
    csvRows.push(['Summary', '', '', '', '', '', '', '', '']);
    csvRows.push(['Total Tokens', analytics.totalTokens, '', '', '', '', '', '', '']);
    csvRows.push(['Total Cost', `${analytics.totalCost.toFixed(4)}`, '', '', '', '', '', '', '']);
    csvRows.push(['Total Requests', analytics.totalRequests, '', '', '', '', '', '', '']);
    csvRows.push(['Avg Cost/Request', `${analytics.avgCostPerRequest.toFixed(4)}`, '', '', '', '', '', '', '']);
    csvRows.push(['Avg Tokens/Request', Math.round(analytics.avgTokensPerRequest), '', '', '', '', '', '', '']);
    csvRows.push(['Time Filter', timeFilter, '', '', '', '', '', '', '']);
    csvRows.push(['Generated At', new Date().toLocaleString(), '', '', '', '', '', '', '']);
    csvRows.push(['', '', '', '', '', '', '', '', '']);
    csvRows.push(['=== DETAILED DATA ===', '', '', '', '', '', '', '', '']);
    
    // Convert to CSV format
    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');
    
    // Create and download file
    const dataBlob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `token-analytics-${timeFilter}-${Date.now()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="relative mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto shadow-xl">
              <BarChart3 className="h-8 w-8 text-white" />
            </div>
          </div>
          <p className="text-gray-600 font-medium">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="space-y-6">
        {/* Header for empty state */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl shadow-xl mb-4">
            <BarChart3 className="h-8 w-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-indigo-800 to-purple-800 bg-clip-text text-transparent">
            AI Token Analytics
          </h1>
          <p className="text-gray-600 font-medium">Comprehensive analysis of your AI consumption and performance</p>
        </div>

        <div className="text-center py-16 bg-gradient-to-br from-white/80 to-indigo-50/80 backdrop-blur-sm rounded-3xl border border-gray-200/50 shadow-xl">
          <div className="w-20 h-20 bg-gradient-to-br from-gray-400 to-gray-500 rounded-3xl flex items-center justify-center mx-auto shadow-xl mb-6">
            <Brain className="h-10 w-10 text-white" />
          </div>
          <h3 className="text-2xl font-bold text-gray-900 mb-3">No AI Usage Data Found</h3>
          <p className="text-gray-600 mb-8 font-medium max-w-md mx-auto leading-relaxed">Start using AI models to see comprehensive analytics and insights here</p>
          <button
            onClick={loadData}
            className="inline-flex items-center gap-3 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold"
          >
            <RefreshCw className="w-5 h-5" />
            Refresh Data
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Modern Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 rounded-3xl shadow-xl mb-4">
          <BarChart3 className="h-8 w-8 text-white" />
        </div>
        <h1 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-indigo-800 to-purple-800 bg-clip-text text-transparent">
          AI Token Analytics
        </h1>
        <p className="text-gray-600 font-medium">Comprehensive analysis of your AI consumption and performance</p>
      </div>

      {/* Modern Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-4 flex-1 w-full lg:w-auto">
            {/* Modern Search */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-4 py-3 bg-white border border-gray-300 rounded-xl shadow-sm hover:shadow-md transition-all">
                <Filter className="w-4 h-4 text-gray-500" />
                <select
                  value={timeFilter}
                  onChange={(e) => setTimeFilter(e.target.value)}
                  className="bg-transparent border-none outline-none text-gray-700 text-sm font-medium cursor-pointer"
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
                className="px-4 py-3 bg-white border border-gray-300 rounded-xl text-gray-700 text-sm font-medium focus:ring-2 focus:ring-indigo-500 shadow-sm hover:shadow-md transition-all"
              >
                <option value="all">All models</option>
                {analytics.modelBreakdown.map(model => (
                  <option key={model.model} value={model.model}>{model.model}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Modern Action Buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={loadData}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 text-sm font-semibold"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
            
            <button
              onClick={exportData}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 transition-all duration-300 shadow-sm hover:shadow-md hover:scale-105 text-sm font-semibold"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {/* Modern Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Total Tokens</p>
              <p className="text-2xl font-bold text-purple-900">{formatNumber(analytics.totalTokens)}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {analytics.trend === 'up' ? <ArrowUp className="w-4 h-4 text-red-500" /> :
             analytics.trend === 'down' ? <ArrowDown className="w-4 h-4 text-purple-500" /> :
             <Minus className="w-4 h-4 text-slate-400" />}
            <span className={`text-xs font-medium ${
              analytics.trend === 'up' ? 'text-red-500' : 
              analytics.trend === 'down' ? 'text-purple-500' : 'text-slate-400'
            }`}>
              {analytics.trend === 'stable' ? 'Stable usage' : `${analytics.trendPercentage.toFixed(1)}% ${analytics.trend}`}
            </span>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-purple-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <DollarSign className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Total Cost</p>
              <p className="text-2xl font-bold text-indigo-900">{formatCost(analytics.totalCost)}</p>
            </div>
          </div>
          <p className="text-xs text-indigo-600 font-medium mt-3">
            {formatCost(analytics.avgCostPerRequest)} avg per request
          </p>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Total Requests</p>
              <p className="text-2xl font-bold text-purple-900">{formatNumber(analytics.totalRequests)}</p>
            </div>
          </div>
          <p className="text-xs text-purple-600 font-medium mt-3">
            {formatNumber(Math.round(analytics.avgTokensPerRequest))} avg tokens/request
          </p>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Target className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Cost per 1K Tokens</p>
              <p className="text-2xl font-bold text-indigo-900">{formatCost(analytics.avgCostPerToken * 1000)}</p>
            </div>
          </div>
          <p className="text-xs text-indigo-600 font-medium mt-3">
            Industry standard metric
          </p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Usage Chart */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-sm hover:shadow-md transition-all duration-300">
          <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500/20 to-indigo-500/20 rounded-lg">
              <TrendingUp className="w-5 h-5 text-purple-600" />
            </div>
            Daily Usage Trends
          </h3>
          <div className="space-y-4">
            {analytics.dailyData.slice(-14).map((day, index) => {
              const maxTokens = Math.max(...analytics.dailyData.map(d => d.tokens));
              const tokenWidth = maxTokens > 0 ? (day.tokens / maxTokens) * 100 : 0;
              
              return (
                <div key={day.date} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-semibold text-slate-700">
                      {new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                    <div className="text-right">
                      <div className="text-sm font-bold text-slate-900">{formatNumber(day.tokens)}</div>
                      <div className="text-xs text-slate-500 font-medium">{formatCost(day.cost)}</div>
                    </div>
                  </div>
                  <div className="bg-slate-100 rounded-full h-3 overflow-hidden">
                    <div 
                      className="bg-gradient-to-r from-purple-500 to-indigo-600 h-3 rounded-full transition-all duration-500 shadow-sm"
                      style={{ width: `${Math.max(tokenWidth, 3)}%` }}
                    ></div>
                  </div>
                  <div className="text-xs text-slate-500 font-medium">{day.requests} requests</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Model Distribution */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-sm hover:shadow-md transition-all duration-300">
          <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-lg">
              <PieChart className="w-5 h-5 text-indigo-600" />
            </div>
            Model Distribution
          </h3>
          <div className="space-y-4">
            {analytics.modelBreakdown.map((model, index) => {
              const gradients = [
                'from-purple-500 to-indigo-600',
                'from-indigo-500 to-purple-600',
                'from-purple-500 to-pink-600',
                'from-indigo-500 to-violet-600',
                'from-violet-500 to-purple-600',
                'from-pink-500 to-purple-600'
              ];
              const bgGradients = [
                'from-purple-500/20 to-indigo-600/20',
                'from-indigo-500/20 to-purple-600/20',
                'from-purple-500/20 to-pink-600/20',
                'from-indigo-500/20 to-violet-600/20',
                'from-violet-500/20 to-purple-600/20',
                'from-pink-500/20 to-purple-600/20'
              ];
              const gradient = gradients[index % gradients.length];
              const bgGradient = bgGradients[index % bgGradients.length];
              
              return (
                <div key={model.model} className="space-y-2">
                  <div className="flex justify-between items-center">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${gradient} shadow-sm`}></div>
                      <div>
                        <span className="font-semibold text-slate-900 text-sm">{model.model}</span>
                        <span className="text-xs text-slate-500 ml-2 font-medium">({model.provider})</span>
                      </div>
                    </div>
                    <span className="text-sm font-semibold text-slate-600">{model.percentage.toFixed(1)}%</span>
                  </div>
                  <div className={`bg-gradient-to-r ${bgGradient} rounded-full h-2 overflow-hidden border border-slate-200/50`}>
                    <div 
                      className={`bg-gradient-to-r ${gradient} h-2 rounded-full transition-all duration-500 shadow-sm`}
                      style={{ width: `${model.percentage}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500 font-medium">
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
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-sm hover:shadow-md transition-all duration-300">
        <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-lg">
            <Clock className="w-5 h-5 text-indigo-600" />
          </div>
          24-Hour Usage Pattern
        </h3>
        <div className="grid grid-cols-24 gap-1">
          {analytics.hourlyPattern.map((hour) => {
            const maxTokens = Math.max(...analytics.hourlyPattern.map(h => h.tokens));
            const height = maxTokens > 0 ? (hour.tokens / maxTokens) * 100 : 0;
            
            return (
              <div key={hour.hour} className="flex flex-col items-center group">
                <div className="h-24 flex items-end justify-center w-full">
                  <div 
                    className="w-full bg-gradient-to-t from-indigo-500 to-purple-500 rounded-t-md hover:from-indigo-600 hover:to-purple-600 transition-all duration-300 cursor-pointer shadow-sm group-hover:shadow-md"
                    style={{ height: `${Math.max(height, 3)}%` }}
                    title={`${hour.hour}:00 - ${formatNumber(hour.tokens)} tokens, ${formatCost(hour.cost)}`}
                  ></div>
                </div>
                <div className="text-xs text-slate-600 font-medium mt-1">{hour.hour}</div>
              </div>
            );
          })}
        </div>
        <div className="text-center text-xs text-slate-500 font-medium mt-4">Hour of day (24h format)</div>
      </div>

      {/* Efficiency Analysis */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-sm hover:shadow-md transition-all duration-300">
        <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-lg">
            <Activity className="w-5 h-5 text-purple-600" />
          </div>
          Model Efficiency Analysis
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 font-bold text-slate-700 text-sm">Model</th>
                <th className="text-right py-3 px-4 font-bold text-slate-700 text-sm">Cost/Token</th>
                <th className="text-right py-3 px-4 font-bold text-slate-700 text-sm">Tokens/Request</th>
                <th className="text-right py-3 px-4 font-bold text-slate-700 text-sm">Cost/Request</th>
                <th className="text-center py-3 px-4 font-bold text-slate-700 text-sm">Efficiency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {analytics.efficiency.map((model, index) => {
                const avgCostPerToken = analytics.efficiency.length > 0 ? 
                  analytics.efficiency.reduce((sum, m) => sum + m.costPerToken, 0) / analytics.efficiency.length : 0;
                const isEfficient = model.costPerToken < avgCostPerToken;
                
                return (
                  <tr key={model.model} className="hover:bg-slate-50/80 transition-colors duration-200">
                    <td className="py-3 px-4 font-semibold text-slate-900 text-sm">{model.model}</td>
                    <td className="py-3 px-4 text-right font-medium text-slate-700 text-sm">{formatCost(model.costPerToken)}</td>
                    <td className="py-3 px-4 text-right font-medium text-slate-700 text-sm">{formatNumber(Math.round(model.tokensPerRequest))}</td>
                    <td className="py-3 px-4 text-right font-medium text-slate-700 text-sm">{formatCost(model.costPerRequest)}</td>
                    <td className="py-3 px-4 text-center">
                      {isEfficient ? (
                        <div className="inline-flex items-center justify-center w-6 h-6 bg-purple-100 rounded-full">
                          <CheckCircle className="w-4 h-4 text-purple-600" />
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-center w-6 h-6 bg-indigo-100 rounded-full">
                          <AlertTriangle className="w-4 h-4 text-indigo-600" />
                        </div>
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
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-slate-200/50 p-6 shadow-sm hover:shadow-md transition-all duration-300">
        <h3 className="text-lg font-bold text-slate-900 mb-6 flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-lg">
            <Sparkles className="w-5 h-5 text-purple-600" />
          </div>
          Recent High-Cost Requests
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 font-bold text-slate-700 text-sm">Time</th>
                <th className="text-left py-3 px-4 font-bold text-slate-700 text-sm">Model</th>
                <th className="text-left py-3 px-4 font-bold text-slate-700 text-sm">Provider</th>
                <th className="text-left py-3 px-4 font-bold text-slate-700 text-sm">Type</th>
                <th className="text-right py-3 px-4 font-bold text-slate-700 text-sm">Input</th>
                <th className="text-right py-3 px-4 font-bold text-slate-700 text-sm">Output</th>
                <th className="text-right py-3 px-4 font-bold text-slate-700 text-sm">Total</th>
                <th className="text-right py-3 px-4 font-bold text-slate-700 text-sm">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tokenData
                .sort((a, b) => b.cost_usd - a.cost_usd)
                .slice(0, 10)
                .map((item, index) => (
                <tr key={item.id} className="hover:bg-slate-50/80 transition-colors duration-200">
                  <td className="py-3 px-4 text-slate-700 font-medium text-sm">
                    {new Date(item.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-slate-900 font-semibold text-sm">{item.model_name}</td>
                  <td className="py-3 px-4 text-slate-700 capitalize font-medium text-sm">{item.provider}</td>
                  <td className="py-3 px-4 text-slate-700 capitalize font-medium text-sm">{item.request_type}</td>
                  <td className="py-3 px-4 text-right font-medium text-slate-700 text-sm">{formatNumber(item.input_tokens)}</td>
                  <td className="py-3 px-4 text-right font-medium text-slate-700 text-sm">{formatNumber(item.output_tokens)}</td>
                  <td className="py-3 px-4 text-right font-semibold text-slate-900 text-sm">{formatNumber(item.total_tokens)}</td>
                  <td className="py-3 px-4 text-right font-bold text-slate-900 text-sm">{formatCost(item.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {tokenData.length === 0 && (
          <div className="text-center py-8">
            <Globe className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium text-sm">No token usage data available</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default TokenAnalyticsDashboard;
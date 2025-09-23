'use client'

import React, { useState, useEffect } from 'react'
import { useAuth } from '@/components/UserProvider'
import { supabase } from '@/lib/supabaseClient'
import { 
  BarChart3, 
  TrendingUp, 
  Calendar, 
  Clock, 
  DollarSign, 
  Zap,
  RefreshCw,
  Download,
  Filter,
  Brain,
  Activity,
  Target,
  Globe
} from 'lucide-react'

interface TokenUsage {
  id: string
  user_id: string
  model_name: string
  provider: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  request_type: string
  session_id?: string
  created_at: string
}

interface UsageStats {
  totalTokens: number
  totalCost: number
  totalRequests: number
  avgTokensPerRequest: number
  topModel: string
  currentMonthTokens: number
  currentMonthCost: number
  dailyUsage: Array<{
    date: string
    tokens: number
    cost: number
    requests: number
  }>
}

export default function UsageTab() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [usageData, setUsageData] = useState<TokenUsage[]>([])
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [timeFilter, setTimeFilter] = useState<'7d' | '30d' | '90d' | 'all'>('30d')
  const [modelFilter, setModelFilter] = useState<string>('all')

  useEffect(() => {
    if (user) {
      loadUsageData()
    }
  }, [user, timeFilter, modelFilter])

  const loadUsageData = async () => {
    if (!user) return
    
    try {
      setLoading(true)
      
      // Calculate date filter
      let dateFilter = new Date()
      if (timeFilter === '7d') {
        dateFilter.setDate(dateFilter.getDate() - 7)
      } else if (timeFilter === '30d') {
        dateFilter.setDate(dateFilter.getDate() - 30)
      } else if (timeFilter === '90d') {
        dateFilter.setDate(dateFilter.getDate() - 90)
      }

      // Build query
      let query = supabase
        .from('token_usage')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })

      if (timeFilter !== 'all') {
        query = query.gte('created_at', dateFilter.toISOString())
      }

      if (modelFilter !== 'all') {
        query = query.eq('model_name', modelFilter)
      }

      const { data, error } = await query

      if (error) throw error

      setUsageData(data || [])
      calculateStats(data || [])

    } catch (error) {
      console.error('Error loading usage data:', error)
    } finally {
      setLoading(false)
    }
  }

  const calculateStats = (data: TokenUsage[]) => {
    if (!data.length) {
      setStats(null)
      return
    }

    const totalTokens = data.reduce((sum, item) => sum + item.total_tokens, 0)
    const totalCost = data.reduce((sum, item) => sum + item.cost_usd, 0)
    const totalRequests = data.length
    const avgTokensPerRequest = totalTokens / totalRequests

    // Find most used model
    const modelCounts = data.reduce((acc, item) => {
      acc[item.model_name] = (acc[item.model_name] || 0) + 1
      return acc
    }, {} as Record<string, number>)
    const topModel = Object.entries(modelCounts).sort(([,a], [,b]) => b - a)[0]?.[0] || 'N/A'

    // Current month usage
    const currentMonth = new Date()
    currentMonth.setDate(1)
    const currentMonthData = data.filter(item => 
      new Date(item.created_at) >= currentMonth
    )
    const currentMonthTokens = currentMonthData.reduce((sum, item) => sum + item.total_tokens, 0)
    const currentMonthCost = currentMonthData.reduce((sum, item) => sum + item.cost_usd, 0)

    // Daily usage for chart
    const dailyUsageMap = new Map<string, { tokens: number, cost: number, requests: number }>()
    data.forEach(item => {
      const date = new Date(item.created_at).toISOString().split('T')[0]
      const existing = dailyUsageMap.get(date) || { tokens: 0, cost: 0, requests: 0 }
      dailyUsageMap.set(date, {
        tokens: existing.tokens + item.total_tokens,
        cost: existing.cost + item.cost_usd,
        requests: existing.requests + 1
      })
    })

    const dailyUsage = Array.from(dailyUsageMap.entries())
      .map(([date, usage]) => ({ date, ...usage }))
      .sort((a, b) => a.date.localeCompare(b.date))

    setStats({
      totalTokens,
      totalCost,
      totalRequests,
      avgTokensPerRequest,
      topModel,
      currentMonthTokens,
      currentMonthCost,
      dailyUsage
    })
  }

  const exportUsageData = () => {
    if (!usageData.length) return

    const csvContent = [
      ['Date', 'Model', 'Provider', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Cost (USD)', 'Type'].join(','),
      ...usageData.map(item => [
        new Date(item.created_at).toLocaleDateString(),
        item.model_name,
        item.provider,
        item.input_tokens,
        item.output_tokens,
        item.total_tokens,
        item.cost_usd.toFixed(6),
        item.request_type
      ].join(','))
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `usage-${timeFilter}-${Date.now()}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const formatCost = (cost: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 4
    }).format(cost)
  }

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num)
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-16 bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-3xl shadow-xl mb-6">
            <div className="animate-spin w-8 h-8 border-2 border-white border-t-transparent rounded-full"></div>
          </div>
          <h3 className="text-xl font-bold text-slate-700 mb-2">Loading Usage Data</h3>
          <p className="text-slate-500 font-medium">Analyzing your AI consumption patterns...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Usage Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-indigo-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-indigo-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Total Tokens</p>
              <p className="text-2xl font-bold text-purple-900">{stats ? formatNumber(stats.totalTokens) : '0'}</p>
            </div>
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
              <p className="text-2xl font-bold text-indigo-900">{stats ? formatCost(stats.totalCost) : '$0.0000'}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-purple-50 to-violet-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-violet-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-violet-500 rounded-2xl flex items-center justify-center shadow-lg">
              <TrendingUp className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-purple-700 font-semibold">Requests</p>
              <p className="text-2xl font-bold text-purple-900">{stats ? formatNumber(stats.totalRequests) : '0'}</p>
            </div>
          </div>
        </div>

        <div className="group relative overflow-hidden bg-gradient-to-br from-indigo-50 to-pink-100 p-4 rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300">
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <div className="relative flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Target className="h-6 w-6 text-white" />
            </div>
            <div>
              <p className="text-sm text-indigo-700 font-semibold">Avg/Request</p>
              <p className="text-2xl font-bold text-indigo-900">{stats ? formatNumber(Math.round(stats.avgTokensPerRequest)) : '0'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Header and Controls */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-2xl flex items-center justify-center shadow-lg">
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-800">Usage & Analytics</h3>
              <p className="text-sm text-slate-600 font-medium">Monitor your LLM token usage and costs</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={exportUsageData}
              disabled={!usageData.length}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border-2 border-gray-300 text-gray-700 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed font-semibold text-sm"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            <button 
              onClick={loadUsageData}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 pt-4 border-t border-gray-200">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-semibold text-slate-700">Filters:</span>
          </div>
          
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as any)}
            className="px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 font-medium text-sm"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>

          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="px-4 py-2.5 border-2 border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-slate-900 font-medium text-sm"
          >
            <option value="all">All models</option>
            {Array.from(new Set(usageData.map(item => item.model_name))).map(model => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Current Month Summary */}
      {stats && (
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-lg">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <h4 className="text-lg font-bold text-slate-800">Current Month Summary</h4>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-50 to-indigo-50 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-lg flex items-center justify-center shadow-sm">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm text-purple-700 font-semibold">Tokens Used</p>
                  <p className="text-xl font-bold text-purple-900">{formatNumber(stats.currentMonthTokens)}</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 rounded-2xl bg-gradient-to-r from-indigo-50 to-purple-50 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center shadow-sm">
                  <DollarSign className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm text-indigo-700 font-semibold">Cost</p>
                  <p className="text-xl font-bold text-indigo-900">{formatCost(stats.currentMonthCost)}</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 rounded-2xl bg-gradient-to-r from-purple-50 to-violet-50 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-violet-500 rounded-lg flex items-center justify-center shadow-sm">
                  <Brain className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-sm text-purple-700 font-semibold">Most Used Model</p>
                  <p className="text-xl font-bold text-purple-900">{stats.topModel}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent Usage Table */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-gray-200/50 shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200/50 bg-gradient-to-r from-slate-50 to-gray-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-br from-slate-500 to-gray-500 rounded-lg flex items-center justify-center shadow-sm">
              <Clock className="w-4 h-4 text-white" />
            </div>
            <h4 className="text-lg font-bold text-slate-800">Recent Usage</h4>
          </div>
        </div>
        
        {usageData.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-gray-50 to-slate-50">
                <tr>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Date & Time
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Provider
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Tokens
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {usageData.slice(0, 20).map((item, index) => (
                  <tr 
                    key={item.id} 
                    className="hover:bg-slate-50 transition-colors duration-200"
                    style={{ animationDelay: `${index * 50}ms` }}
                  >
                    <td className="px-6 py-4 text-sm text-slate-900 font-medium">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-900 font-semibold">
                      {item.model_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-700 font-medium capitalize">
                      {item.provider}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-slate-900 text-right">
                      {formatNumber(item.total_tokens)}
                    </td>
                    <td className="px-6 py-4 text-sm font-bold text-slate-900 text-right">
                      {formatCost(item.cost_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-16 text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-slate-400 to-slate-500 rounded-3xl flex items-center justify-center mx-auto shadow-xl mb-6">
              <Activity className="w-10 h-10 text-white" />
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">No usage data found</h3>
            <p className="text-slate-500 font-medium mb-6">No usage data found for the selected period. Start using AI models to see analytics here.</p>
            <button 
              onClick={loadUsageData}
              className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl hover:from-indigo-700 hover:to-purple-700 transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 font-semibold"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh Data
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
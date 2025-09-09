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
  Filter
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
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-300">Loading usage data...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Usage & Analytics
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">Monitor your LLM token usage and costs</p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={exportUsageData}
              disabled={!usageData.length}
              className="inline-flex items-center gap-2 px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              Export
            </button>
            <button 
              onClick={loadUsageData}
              className="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-gray-500" />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Filters:</span>
          </div>
          
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value as any)}
            className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="all">All time</option>
          </select>

          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="px-3 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-sm"
          >
            <option value="all">All models</option>
            {Array.from(new Set(usageData.map(item => item.model_name))).map(model => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Tokens</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {formatNumber(stats.totalTokens)}
                </p>
              </div>
              <Zap className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Cost</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {formatCost(stats.totalCost)}
                </p>
              </div>
              <DollarSign className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Total Requests</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {formatNumber(stats.totalRequests)}
                </p>
              </div>
              <TrendingUp className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Avg/Request</p>
                <p className="text-xl font-bold text-gray-900 dark:text-gray-100">
                  {formatNumber(Math.round(stats.avgTokensPerRequest))}
                </p>
              </div>
              <BarChart3 className="w-6 h-6 text-orange-600 dark:text-orange-400" />
            </div>
          </div>
        </div>
      )}

      {/* Current Month Summary */}
      {stats && (
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
          <h4 className="text-md font-semibold text-gray-900 dark:text-gray-100 mb-4 flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            Current Month Summary
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Tokens Used</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {formatNumber(stats.currentMonthTokens)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Cost</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {formatCost(stats.currentMonthCost)}
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-600 dark:text-gray-400">Most Used Model</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {stats.topModel}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recent Usage Table */}
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h4 className="text-md font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Recent Usage
          </h4>
        </div>
        
        {usageData.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Date & Time
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Provider
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Tokens
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
                {usageData.slice(0, 20).map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                      {item.model_name}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100">
                      <span className="capitalize">{item.provider}</span>
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100 text-right">
                      {formatNumber(item.total_tokens)}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-gray-100 text-right">
                      {formatCost(item.cost_usd)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <BarChart3 className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">No usage data found for the selected period.</p>
          </div>
        )}
      </div>
    </div>
  )
}
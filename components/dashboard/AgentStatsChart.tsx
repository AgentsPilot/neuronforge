'use client'

import React, { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Line,
  LineChart,
  Area,
  AreaChart,
  PieChart,
  Pie,
  Cell,
  Legend
} from 'recharts'
import { supabase } from '@/lib/supabaseClient'
import { useAuth } from '@/components/UserProvider'
import { 
  BarChart3, 
  TrendingUp, 
  PieChart as PieChartIcon, 
  Activity,
  Target,
  Zap,
  CheckCircle,
  XCircle
} from 'lucide-react'

type ChartMetric = 'runs' | 'success_rate' | 'activity'
type ChartType = 'bar' | 'area' | 'pie'

export default function AgentStatsChart() {
  const { user } = useAuth()
  const [chartData, setChartData] = useState([])
  const [pieData, setPieData] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedMetric, setSelectedMetric] = useState<ChartMetric>('runs')
  const [chartType, setChartType] = useState<ChartType>('bar')

  useEffect(() => {
    const fetchChartData = async () => {
      if (!user) return
      
      setLoading(true)

      const { data, error } = await supabase
        .from('agent_stats')
        .select('agent_id, run_count, success_count, agents(agent_name)')
        .eq('user_id', user.id)
        .order('run_count', { ascending: false })

      if (error) {
        console.error('Error fetching agent stats for chart:', error.message)
        setLoading(false)
        return
      }

      const formatted = data.map((row) => {
        const runCount = row.run_count ?? 0
        const successCount = row.success_count ?? 0
        const successRate = runCount > 0 ? Math.round((successCount / runCount) * 100) : 0
        const failureCount = runCount - successCount
        
        return {
          name: row.agents?.agent_name ?? 'Unknown Agent',
          shortName: (row.agents?.agent_name ?? 'Unknown').substring(0, 15) + 
                    (row.agents?.agent_name?.length > 15 ? '...' : ''),
          runs: runCount,
          successes: successCount,
          failures: failureCount,
          successRate: successRate,
          activity: runCount > 0 ? 'Active' : 'Inactive'
        }
      })

      // Prepare pie chart data for success vs failure
      const totalRuns = formatted.reduce((sum, item) => sum + item.runs, 0)
      const totalSuccesses = formatted.reduce((sum, item) => sum + item.successes, 0)
      const totalFailures = totalRuns - totalSuccesses

      const pieChartData = [
        { name: 'Successful Runs', value: totalSuccesses, color: '#10B981' },
        { name: 'Failed Runs', value: totalFailures, color: '#EF4444' }
      ]

      setChartData(formatted)
      setPieData(pieChartData)
      setLoading(false)
    }

    fetchChartData()
  }, [user])

  const getChartConfig = () => {
    switch (selectedMetric) {
      case 'runs':
        return {
          title: 'Agent Execution Volume',
          subtitle: 'Total runs per agent',
          icon: Activity,
          dataKey: 'runs',
          color: '#3B82F6',
          gradientId: 'runsGradient'
        }
      case 'success_rate':
        return {
          title: 'Agent Success Rate',
          subtitle: 'Success percentage per agent',
          icon: Target,
          dataKey: 'successRate',
          color: '#10B981',
          gradientId: 'successGradient'
        }
      case 'activity':
        return {
          title: 'Agent Activity Comparison',
          subtitle: 'Success vs failure breakdown',
          icon: Zap,
          dataKey: 'successes',
          color: '#8B5CF6',
          gradientId: 'activityGradient'
        }
      default:
        return {
          title: 'Agent Statistics',
          subtitle: 'Overview of agent performance',
          icon: BarChart3,
          dataKey: 'runs',
          color: '#3B82F6',
          gradientId: 'defaultGradient'
        }
    }
  }

  const config = getChartConfig()
  const IconComponent = config.icon

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload
      return (
        <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-900 mb-2">{data.name}</p>
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-gray-600">Total Runs:</span>
              <span className="font-medium">{data.runs}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-green-600">Successes:</span>
              <span className="font-medium text-green-700">{data.successes}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-red-600">Failures:</span>
              <span className="font-medium text-red-700">{data.failures}</span>
            </div>
            <div className="flex items-center justify-between gap-4 pt-1 border-t border-gray-100">
              <span className="text-blue-600">Success Rate:</span>
              <span className="font-medium text-blue-700">{data.successRate}%</span>
            </div>
          </div>
        </div>
      )
    }
    return null
  }

  const renderChart = () => {
    if (chartType === 'pie') {
      return (
        <ResponsiveContainer width="100%" height={350}>
          <PieChart>
            <Pie
              data={pieData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {pieData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip formatter={(value, name) => [value.toLocaleString(), name]} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      )
    }

    if (chartType === 'area') {
      return (
        <ResponsiveContainer width="100%" height={350}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id={config.gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={config.color} stopOpacity={0.8}/>
                <stop offset="95%" stopColor={config.color} stopOpacity={0.1}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="shortName" 
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis 
              allowDecimals={false}
              tick={{ fontSize: 12 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey={config.dataKey}
              stroke={config.color}
              fillOpacity={1}
              fill={`url(#${config.gradientId})`}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      )
    }

    // Default bar chart with enhanced features
    if (selectedMetric === 'activity') {
      return (
        <ResponsiveContainer width="100%" height={350}>
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis 
              dataKey="shortName" 
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={80}
            />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="successes" fill="#10B981" name="Successes" />
            <Bar dataKey="failures" fill="#EF4444" name="Failures" />
          </ComposedChart>
        </ResponsiveContainer>
      )
    }

    return (
      <ResponsiveContainer width="100%" height={350}>
        <BarChart data={chartData}>
          <defs>
            <linearGradient id={config.gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={config.color} stopOpacity={0.8}/>
              <stop offset="95%" stopColor={config.color} stopOpacity={0.6}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis 
            dataKey="shortName" 
            tick={{ fontSize: 12 }}
            angle={-45}
            textAnchor="end"
            height={80}
          />
          <YAxis 
            allowDecimals={false}
            tick={{ fontSize: 12 }}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar 
            dataKey={config.dataKey} 
            fill={`url(#${config.gradientId})`}
            radius={[4, 4, 0, 0]}
            stroke={config.color}
            strokeWidth={1}
          />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-8 text-center">
          <div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
          <p className="text-gray-500">Loading chart data...</p>
        </div>
      </div>
    )
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-white rounded-xl border shadow-sm">
        <div className="p-8 text-center">
          <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No data to display</h3>
          <p className="text-gray-600">No agent statistics available for charting.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <IconComponent className="h-5 w-5 text-blue-600" />
              {config.title}
            </h2>
            <p className="text-gray-600 text-sm mt-1">{config.subtitle}</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Metric Selection */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">Metric:</span>
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setSelectedMetric('runs')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  selectedMetric === 'runs'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Activity className="h-3 w-3 inline mr-1" />
                Runs
              </button>
              <button
                onClick={() => setSelectedMetric('success_rate')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  selectedMetric === 'success_rate'
                    ? 'bg-white text-green-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Target className="h-3 w-3 inline mr-1" />
                Success Rate
              </button>
              <button
                onClick={() => setSelectedMetric('activity')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  selectedMetric === 'activity'
                    ? 'bg-white text-purple-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Zap className="h-3 w-3 inline mr-1" />
                Activity
              </button>
            </div>
          </div>

          {/* Chart Type Selection */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">View:</span>
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setChartType('bar')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  chartType === 'bar'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <BarChart3 className="h-3 w-3 inline mr-1" />
                Bar
              </button>
              <button
                onClick={() => setChartType('area')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  chartType === 'area'
                    ? 'bg-white text-green-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <TrendingUp className="h-3 w-3 inline mr-1" />
                Area
              </button>
              <button
                onClick={() => setChartType('pie')}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  chartType === 'pie'
                    ? 'bg-white text-purple-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <PieChartIcon className="h-3 w-3 inline mr-1" />
                Pie
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="p-6">
        {renderChart()}
      </div>

      {/* Footer Stats */}
      <div className="px-6 pb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-gray-100">
          <div className="text-center">
            <div className="text-2xl font-bold text-blue-600">
              {chartData.reduce((sum, item) => sum + item.runs, 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Total Runs</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {chartData.reduce((sum, item) => sum + item.successes, 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Successes</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-red-600">
              {chartData.reduce((sum, item) => sum + item.failures, 0).toLocaleString()}
            </div>
            <div className="text-sm text-gray-600">Failures</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-purple-600">
              {chartData.length}
            </div>
            <div className="text-sm text-gray-600">Agents</div>
          </div>
        </div>
      </div>
    </div>
  )
}
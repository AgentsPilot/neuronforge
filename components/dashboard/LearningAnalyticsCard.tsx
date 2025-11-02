'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { Brain, TrendingUp, Calendar } from 'lucide-react'

interface LearningData {
  date: string
  count: number
}

interface LearningAnalyticsCardProps {
  userId: string
}

export default function LearningAnalyticsCard({ userId }: LearningAnalyticsCardProps) {
  const [learningData, setLearningData] = useState<LearningData[]>([])
  const [totalLearnings, setTotalLearnings] = useState(0)
  const [weeklyGrowth, setWeeklyGrowth] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (userId) {
      fetchLearningData()
    }
  }, [userId])

  const fetchLearningData = async () => {
    try {
      // Get learning data for last 7 days
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const { data, error } = await supabase
        .from('run_memories')
        .select('created_at')
        .eq('user_id', userId)
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: true })

      if (error) {
        console.error('Error fetching learning data:', error)
        return
      }

      // Group by date
      const groupedByDate: Record<string, number> = {}
      data?.forEach(item => {
        const date = new Date(item.created_at).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        })
        groupedByDate[date] = (groupedByDate[date] || 0) + 1
      })

      // Create array for last 7 days
      const chartData: LearningData[] = []
      for (let i = 6; i >= 0; i--) {
        const date = new Date()
        date.setDate(date.getDate() - i)
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        chartData.push({
          date: dateStr,
          count: groupedByDate[dateStr] || 0
        })
      }

      setLearningData(chartData)

      // Get total count
      const { count: totalCount } = await supabase
        .from('run_memories')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)

      setTotalLearnings(totalCount || 0)

      // Calculate weekly growth
      const thisWeekCount = chartData.reduce((sum, day) => sum + day.count, 0)
      const previousWeekStart = new Date()
      previousWeekStart.setDate(previousWeekStart.getDate() - 14)
      const previousWeekEnd = new Date()
      previousWeekEnd.setDate(previousWeekEnd.getDate() - 7)

      const { count: lastWeekCount } = await supabase
        .from('run_memories')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', previousWeekStart.toISOString())
        .lt('created_at', previousWeekEnd.toISOString())

      const growth = lastWeekCount ? ((thisWeekCount - (lastWeekCount || 0)) / (lastWeekCount || 1)) * 100 : 0
      setWeeklyGrowth(Math.round(growth))

      setLoading(false)
    } catch (error) {
      console.error('Error in fetchLearningData:', error)
      setLoading(false)
    }
  }

  const maxCount = Math.max(...learningData.map(d => d.count), 1)

  return (
    <div className="bg-white rounded-2xl shadow-lg border-2 border-purple-100 p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center">
            <Brain className="h-6 w-6 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Learning Analytics</h3>
            <p className="text-sm text-gray-500">Agent knowledge growth</p>
          </div>
        </div>

        {weeklyGrowth !== 0 && (
          <div className={`flex items-center gap-1 px-3 py-1.5 rounded-full ${
            weeklyGrowth > 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}>
            <TrendingUp className={`h-4 w-4 ${weeklyGrowth < 0 ? 'rotate-180' : ''}`} />
            <span className="text-sm font-semibold">
              {weeklyGrowth > 0 ? '+' : ''}{weeklyGrowth}%
            </span>
          </div>
        )}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-purple-50 rounded-xl p-4">
          <div className="text-2xl font-bold text-purple-900">{totalLearnings}</div>
          <div className="text-sm text-purple-600 mt-1">Total Learnings</div>
        </div>
        <div className="bg-indigo-50 rounded-xl p-4">
          <div className="text-2xl font-bold text-indigo-900">
            {learningData.reduce((sum, d) => sum + d.count, 0)}
          </div>
          <div className="text-sm text-indigo-600 mt-1">This Week</div>
        </div>
      </div>

      {/* Chart */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm text-gray-500 mb-3">
          <Calendar className="h-4 w-4" />
          <span>Last 7 Days</span>
        </div>

        <div className="flex items-end justify-between gap-2 h-32">
          {learningData.map((day, index) => (
            <div key={index} className="flex-1 flex flex-col items-center gap-2">
              <div className="w-full flex flex-col justify-end items-center h-24">
                {day.count > 0 && (
                  <div
                    className="w-full bg-gradient-to-t from-purple-500 to-indigo-500 rounded-t-lg transition-all duration-300 hover:from-purple-600 hover:to-indigo-600 relative group"
                    style={{ height: `${(day.count / maxCount) * 100}%`, minHeight: '8px' }}
                  >
                    <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white text-xs py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {day.count} learning{day.count !== 1 ? 's' : ''}
                    </div>
                  </div>
                )}
                {day.count === 0 && (
                  <div className="w-full h-2 bg-gray-200 rounded-full" />
                )}
              </div>
              <span className="text-xs text-gray-500 font-medium">
                {day.date.split(' ')[1]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Message */}
      <div className="mt-6 p-4 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
        <p className="text-sm text-purple-900">
          {totalLearnings === 0 ? (
            <span>🎯 Your agents will start learning from every execution!</span>
          ) : totalLearnings < 10 ? (
            <span>🌱 Great start! Your agents are building their knowledge base.</span>
          ) : totalLearnings < 50 ? (
            <span>📈 Excellent progress! Your agents are getting smarter every day.</span>
          ) : (
            <span>🚀 Amazing! Your agents have extensive knowledge to draw from.</span>
          )}
        </p>
      </div>
    </div>
  )
}

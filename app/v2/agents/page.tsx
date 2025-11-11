// app/v2/agents/page.tsx
// V2 Agent Command Center - Main agents overview page

'use client'

import React from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/v2/ui/card'
import { V2Header } from '@/components/v2/V2Header'
import { ArrowLeft, TrendingUp } from 'lucide-react'

export default function V2AgentsPage() {
  const router = useRouter()
  // Mock data for the page
  const agentHealth = {
    score: 4,
    maxScore: 5,
    status: 'Stable',
    runtime: '15s',
    efficiency: 'High',
    reliability: 85
  }

  const recentExecutions = [
    { id: 125, status: 'Success', duration: '12s', notes: '' },
    { id: 124, status: 'Success', duration: '', notes: 'Plugin timeout (Gmail)' },
    { id: 123, status: 'Success', duration: '10s', notes: 'Plugin timeout' },
    { id: 122, status: 'Success', duration: '10s', notes: '' }
  ]

  const executionData = [
    { x: 0, y: 45 },
    { x: 25, y: 38 },
    { x: 50, y: 42 },
    { x: 75, y: 35 },
    { x: 100, y: 30 }
  ]

  const summary = {
    totalEmails: 0,
    negative: 3,
    positive: 18,
    neutral: 4
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Top Bar: Back Button + Token Display + User Menu */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Dashboard
        </button>
        <V2Header />
      </div>

      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-[var(--v2-text-primary)] mb-2">
          Agent Command Center
        </h1>
        <p className="text-lg sm:text-xl text-[var(--v2-text-secondary)]">
          FlowOS
        </p>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
        {/* Left Column - Agent Health */}
        <Card className="!p-4 sm:!p-6">
          <h2 className="text-lg font-semibold text-[var(--v2-text-primary)] mb-4">
            Agent Health
          </h2>

          {/* Health Score Circle */}
          <div className="flex justify-center mb-6">
            <div className="relative w-32 h-32">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  className="text-gray-200 dark:text-gray-700"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="56"
                  stroke="currentColor"
                  strokeWidth="8"
                  fill="none"
                  className="text-blue-500"
                  strokeDasharray={`${(agentHealth.score / agentHealth.maxScore) * 352} 352`}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-4xl font-bold text-[var(--v2-text-primary)]">
                  {agentHealth.score}
                </div>
                <div className="text-sm text-[var(--v2-text-muted)]">
                  A – {agentHealth.maxScore}
                </div>
              </div>
            </div>
          </div>

          {/* Health Metrics */}
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-[var(--v2-text-muted)]">Health Status:</span>
              <span className="font-medium text-[var(--v2-text-primary)]">{agentHealth.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--v2-text-muted)]">Average runtime:</span>
              <span className="font-medium text-[var(--v2-text-primary)]">{agentHealth.runtime}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--v2-text-muted)]">Batch efficiency:</span>
              <span className="font-medium text-[var(--v2-text-primary)]">{agentHealth.efficiency}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--v2-text-muted)]">Plugin reliability:</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3].map((dot) => (
                  <div
                    key={dot}
                    className={`w-2 h-2 rounded-full ${
                      dot <= Math.ceil(agentHealth.reliability / 33)
                        ? 'bg-green-500'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Center Column - Recent Executions */}
        <Card className="!p-4 sm:!p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--v2-text-primary)]">
              Recent Executions
            </h2>
            <TrendingUp className="w-5 h-5 text-[var(--v2-text-muted)]" />
          </div>

          {/* Simple Line Graph */}
          <div className="h-24 mb-6">
            <svg className="w-full h-full" viewBox="0 0 100 50" preserveAspectRatio="none">
              <defs>
                <linearGradient id="execGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                  <stop offset="0%" stopColor="#6366F1" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#6366F1" stopOpacity="0.02" />
                </linearGradient>
              </defs>

              {/* Area under line */}
              <path
                d={`M ${executionData[0].x} ${executionData[0].y} ${executionData
                  .slice(1)
                  .map((p) => `L ${p.x} ${p.y}`)
                  .join(' ')} L 100 50 L 0 50 Z`}
                fill="url(#execGradient)"
              />

              {/* Line */}
              <polyline
                points={executionData.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="#6366F1"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {/* Data points */}
              {executionData.map((point, i) => (
                <circle
                  key={i}
                  cx={point.x}
                  cy={point.y}
                  r="3"
                  fill="#6366F1"
                  stroke="white"
                  strokeWidth="2"
                />
              ))}
            </svg>
          </div>

          {/* Execution List */}
          <div className="space-y-2 sm:space-y-3">
            {recentExecutions.map((exec) => (
              <div
                key={exec.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0 py-2 px-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-xs sm:text-sm"
              >
                <div className="flex items-center gap-2 sm:gap-3">
                  <span className="font-medium text-[var(--v2-text-primary)]">
                    Run #{exec.id}
                  </span>
                  <span className={`font-medium ${
                    exec.status === 'Success' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}>
                    {exec.status}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[var(--v2-text-muted)]">
                  {exec.notes && (
                    <span className="text-xs">{exec.notes}</span>
                  )}
                  {exec.duration && (
                    <span className="font-medium">{exec.duration}</span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* View Full Log Button */}
          <button className="w-full mt-4 py-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors">
            View Full Log
          </button>
        </Card>

        {/* Right Column - Results/Analytics */}
        <Card className="!p-4 sm:!p-6">
          {/* Tabs */}
          <div className="flex gap-4 mb-6 border-b border-gray-200 dark:border-gray-700">
            <button className="pb-2 px-1 text-sm font-semibold text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400">
              Results
            </button>
            <button className="pb-2 px-1 text-sm font-medium text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors">
              Analytics
            </button>
          </div>

          {/* Results Content */}
          <div>
            <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-4">
              Summary of Client Emails (Last 7 Days)
            </h3>

            <div className="space-y-2 text-sm mb-6">
              <div className="flex items-center gap-2">
                <span className="text-[var(--v2-text-muted)]">•</span>
                <span className="text-[var(--v2-text-primary)]">
                  Total emails analyzed: {summary.totalEmails}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--v2-text-muted)]">•</span>
                <span className="text-[var(--v2-text-primary)]">
                  Negative tone: {summary.negative}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--v2-text-muted)]">•</span>
                <span className="text-[var(--v2-text-primary)]">
                  Positive tone: {summary.positive}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--v2-text-muted)]">•</span>
                <span className="text-[var(--v2-text-primary)]">
                  Neutral: {summary.neutral}
                </span>
              </div>
            </div>

            <button className="w-full py-3 bg-gradient-to-r from-[var(--v2-primary)] to-[var(--v2-secondary)] text-white font-semibold rounded-lg hover:opacity-90 transition-opacity">
              Open Detailed Report
            </button>

            {/* Analytics/Issues Tabs */}
            <div className="flex gap-4 mt-8 mb-4 border-b border-gray-200 dark:border-gray-700">
              <button className="pb-2 px-1 text-sm font-semibold text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400">
                Analytics
              </button>
              <button className="pb-2 px-1 text-sm font-medium text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)] transition-colors">
                Issues
              </button>
            </div>

            {/* Recent Actions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--v2-text-primary)] font-medium">Recent</span>
                <span className="text-[var(--v2-text-muted)] italic">€jisrt</span>
              </div>
              <div className="py-2 text-sm text-[var(--v2-text-primary)]">
                Open Details
              </div>
              <div className="py-2 text-sm text-[var(--v2-text-primary)]">
                Action
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Agent Name and Integrations */}
      <Card className="!p-4 sm:!p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0">
          <div>
            <h3 className="text-base sm:text-lg font-semibold text-[var(--v2-text-primary)] mb-2">
              Weekly Client Sentiment Monitor
            </h3>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-green-500 rounded flex items-center justify-center text-white text-xs font-bold">
                +
              </div>
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center">
                <span className="text-xs">📧</span>
              </div>
              <div className="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded flex items-center justify-center">
                <span className="text-xs">G</span>
              </div>
            </div>
          </div>
          <div className="text-xs sm:text-sm text-[var(--v2-text-muted)]">
            Scheduled · 4 hours ago
          </div>
        </div>
      </Card>
    </div>
  )
}

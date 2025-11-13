// app/v2/agents/new/page.tsx
// V2 Agent Creation Page - Exact replica of agent detail page layout

'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { Suspense, useState, useEffect, useRef } from 'react'
import { useAuth } from '@/components/UserProvider'
import { Card } from '@/components/v2/ui/card'
import { V2Header } from '@/components/v2/V2Header'
import {
  ArrowLeft,
  Bot,
  Sparkles,
  MessageSquare,
  Zap,
  CheckCircle2,
  Clock,
  Settings,
  Loader2,
  Brain,
  Calendar,
  Activity,
  ArrowRight,
  ChevronRight,
  Send,
  PlayCircle,
  ChevronDown,
  X
} from 'lucide-react'

function V2AgentBuilderContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialPrompt = searchParams.get('prompt')
  const { user } = useAuth()

  // Schedule state
  const [scheduleMode, setScheduleMode] = useState<'manual' | 'scheduled'>('manual')
  const [scheduleType, setScheduleType] = useState<'hourly' | 'daily' | 'weekly' | 'monthly' | ''>('') // Main type
  const [scheduleTime, setScheduleTime] = useState<string>('09:00')
  const [selectedDays, setSelectedDays] = useState<string[]>([])
  const [selectedMonthDay, setSelectedMonthDay] = useState<string>('1')
  const [hourlyInterval, setHourlyInterval] = useState<string>('1')
  const [dailyOption, setDailyOption] = useState<'everyday' | 'weekdays' | 'weekends'>('everyday')
  const [showScheduleBuilder, setShowScheduleBuilder] = useState(false)
  const builderRef = useRef<HTMLDivElement>(null)

  // Close builder when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (builderRef.current && !builderRef.current.contains(event.target as Node)) {
        setShowScheduleBuilder(false)
      }
    }

    if (showScheduleBuilder) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showScheduleBuilder])

  // Generate schedule description
  const getScheduleDescription = () => {
    if (!scheduleType) return 'No schedule set'

    if (scheduleType === 'hourly') {
      return hourlyInterval === '1' ? 'Every hour' : `Every ${hourlyInterval} hours`
    }

    if (scheduleType === 'daily') {
      if (dailyOption === 'everyday') return `Every day at ${scheduleTime}`
      if (dailyOption === 'weekdays') return `Weekdays at ${scheduleTime}`
      if (dailyOption === 'weekends') return `Weekends at ${scheduleTime}`
    }

    if (scheduleType === 'weekly') {
      if (selectedDays.length === 0) return 'Weekly - Select days'
      const dayNames = selectedDays.map(d => d.charAt(0).toUpperCase() + d.slice(0, 3))
      return `${dayNames.join(', ')} at ${scheduleTime}`
    }

    if (scheduleType === 'monthly') {
      return `${selectedMonthDay}${getDaySuffix(parseInt(selectedMonthDay))} of month at ${scheduleTime}`
    }

    return 'Configure schedule'
  }

  // Helper function to toggle day selection
  const handleDayToggle = (day: string) => {
    setSelectedDays(prev => {
      if (prev.includes(day)) {
        // Don't allow deselecting all days
        if (prev.length === 1) return prev
        return prev.filter(d => d !== day)
      } else {
        return [...prev, day]
      }
    })
  }

  // Helper function to get day suffix (1st, 2nd, 3rd, etc.)
  const getDaySuffix = (day: number) => {
    if (day >= 11 && day <= 13) return 'th'
    switch (day % 10) {
      case 1: return 'st'
      case 2: return 'nd'
      case 3: return 'rd'
      default: return 'th'
    }
  }

  if (!user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--v2-primary)]" />
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5 lg:space-y-6">
      {/* Top Bar: Back Button + User Menu */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push('/v2/dashboard')}
          className="inline-flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-[var(--v2-surface)] text-[var(--v2-text-secondary)] hover:text-[var(--v2-text-primary)] hover:scale-105 transition-all duration-200 text-xs sm:text-sm font-medium shadow-[var(--v2-shadow-card)]"
          style={{ borderRadius: 'var(--v2-radius-button)' }}
        >
          <ArrowLeft className="w-3 h-3 sm:w-4 sm:h-4" />
          <span className="hidden xs:inline">Back to Dashboard</span>
          <span className="xs:hidden">Back</span>
        </button>
        <V2Header />
      </div>

      {/* Main Grid Layout - Three Columns with Arrows */}
      <div className="relative">
        <div className="grid grid-cols-1 lg:grid-cols-[2fr_auto_1fr_auto_1fr] gap-4 lg:gap-6 items-start">
          {/* Left Column - Conversational Chat (WIDER) */}
          <div className="space-y-4 sm:space-y-5">
            <Card className="!p-4 sm:!p-6 min-h-[800px] flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <MessageSquare className="w-6 h-6 text-[#8B5CF6]" />
                <div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    Agent Builder Chat
                  </h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    Answer questions to configure your agent
                  </p>
                </div>
              </div>

              {/* Chat Messages Area */}
              <div className="flex-1 overflow-y-auto space-y-4 mb-4">
                {/* Initial Prompt Display */}
                {initialPrompt && (
                  <div className="flex justify-end">
                    <div className="max-w-[80%] p-3 bg-[var(--v2-primary)] text-white rounded-lg rounded-br-none">
                      <p className="text-sm">{initialPrompt}</p>
                    </div>
                  </div>
                )}

                {/* AI Response */}
                <div className="flex justify-start">
                  <div className="max-w-[80%] p-3 bg-gray-100 dark:bg-gray-800 rounded-lg rounded-bl-none">
                    <p className="text-sm text-[var(--v2-text-primary)] mb-3">
                      Great! I'll help you create this agent. Let me ask a few questions to configure it properly:
                    </p>
                    <div className="space-y-2">
                      <p className="text-sm text-[var(--v2-text-primary)] font-medium">
                        1. How often should this agent run?
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button className="px-3 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-[var(--v2-primary)] transition-colors">
                          Every hour
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-[var(--v2-primary)] transition-colors">
                          Daily
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-[var(--v2-primary)] transition-colors">
                          On trigger
                        </button>
                        <button className="px-3 py-1.5 text-xs bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg hover:border-[var(--v2-primary)] transition-colors">
                          Custom schedule
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Chat Input */}
              <div className="mt-auto pt-4 border-t border-[var(--v2-border)]">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Type your answer or question..."
                    className="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-[var(--v2-border)] rounded-lg text-sm text-[var(--v2-text-primary)] placeholder:text-[var(--v2-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--v2-primary)]"
                  />
                  <button className="px-4 py-2 bg-[var(--v2-primary)] text-white rounded-lg hover:opacity-90 transition-opacity">
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          </div>

          {/* Arrow between left and middle - hidden on mobile */}
          <div className="hidden lg:flex items-center justify-center">
            <ArrowRight className="w-6 h-6 text-[var(--v2-primary)]" />
          </div>

          {/* Middle Column - Progress Steps */}
          <div className="space-y-4 sm:space-y-5">
            <Card className="!p-4 sm:!p-6 min-h-[800px] flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <Settings className="w-6 h-6 text-[#06B6D4]" />
                <div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    Setup Progress
                  </h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    Tracking conversation steps
                  </p>
                </div>
              </div>

              {/* Progress Steps from Chat */}
              <div className="flex-1 space-y-3">
                <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <CheckCircle2 className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Initial Request
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      Received your automation request
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <Clock className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5 animate-pulse" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-primary)] mb-1">
                      Scheduling Configuration
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      Waiting for schedule preference...
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-gray-200 dark:border-gray-700 opacity-60">
                  <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                      Integration Setup
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      Configure required services
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-gray-200 dark:border-gray-700 opacity-60">
                  <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                      Final Review
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      Review and confirm settings
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-gray-200 dark:border-gray-700 opacity-60">
                  <div className="w-5 h-5 border-2 border-gray-300 dark:border-gray-600 rounded-full flex-shrink-0 mt-0.5"></div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[var(--v2-text-secondary)] mb-1">
                      Agent Ready
                    </p>
                    <p className="text-xs text-[var(--v2-text-muted)]">
                      Deploy your agent
                    </p>
                  </div>
                </div>
              </div>

              {/* Bottom Info Section */}
              <div className="mt-auto pt-4 border-t border-[var(--v2-border)] space-y-3">
                <div className="flex items-center gap-3">
                  <Brain className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                  <div>
                    <p className="text-xs text-[var(--v2-text-muted)]">Builder Type</p>
                    <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                      Conversational AI Builder
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Activity className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                  <div>
                    <p className="text-xs text-[var(--v2-text-muted)]">Status</p>
                    <p className="text-sm font-medium text-blue-500">Analyzing Requirements</p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Calendar className="w-5 h-5 text-[var(--v2-text-secondary)]" />
                  <div>
                    <p className="text-xs text-[var(--v2-text-muted)]">Started</p>
                    <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                      {new Date().toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Arrow between middle and right - hidden on mobile */}
          <div className="hidden lg:flex items-center justify-center">
            <ArrowRight className="w-6 h-6 text-[var(--v2-primary)]" />
          </div>

          {/* Right Column - Generated Agent Preview */}
          <div className="space-y-4 sm:space-y-5">
            <Card className="!p-4 sm:!p-6 min-h-[800px] flex flex-col">
              <div className="flex items-center gap-3 mb-4">
                <Bot className="w-6 h-6 text-[#10B981]" />
                <div>
                  <h3 className="text-lg font-semibold text-[var(--v2-text-primary)]">
                    Agent Preview
                  </h3>
                  <p className="text-xs text-[var(--v2-text-secondary)]">
                    Configuration as it builds
                  </p>
                </div>
              </div>

              {/* Agent Configuration Preview */}
              <div className="flex-1 space-y-4">
                {/* Agent Name */}
                <div className="p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-[var(--v2-border)]">
                  <p className="text-xs text-[var(--v2-text-muted)] mb-1">Agent Name</p>
                  <p className="text-sm font-medium text-[var(--v2-text-primary)]">
                    {initialPrompt ? 'Email Automation Agent' : 'Untitled Agent'}
                  </p>
                </div>

                {/* Description */}
                <div className="p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-[var(--v2-border)]">
                  <p className="text-xs text-[var(--v2-text-muted)] mb-1">Description</p>
                  <p className="text-sm text-[var(--v2-text-primary)]">
                    {initialPrompt || 'Describe what this agent will do...'}
                  </p>
                </div>

                {/* Integrations */}
                <div className="p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-[var(--v2-border)]">
                  <p className="text-xs text-[var(--v2-text-muted)] mb-2">Integrations</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="text-xs px-2 py-1 bg-white dark:bg-gray-700 rounded-full border border-gray-200 dark:border-gray-600 text-[var(--v2-text-muted)]">
                      None configured
                    </span>
                  </div>
                </div>

                {/* Schedule - Compact V2 Design */}
                <div className="p-3 bg-gray-50 dark:bg-gray-800/30 rounded-lg border border-[var(--v2-border)] space-y-3 relative">
                  <p className="text-xs text-[var(--v2-text-muted)]">Schedule</p>

                  {/* Mode Selection */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setScheduleMode('manual')}
                      className={`flex-1 p-2.5 sm:p-2 rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1.5 transition-all ${
                        scheduleMode === 'manual'
                          ? 'bg-[var(--v2-primary)] text-white'
                          : 'bg-white dark:bg-gray-700 border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                      }`}
                    >
                      <PlayCircle className="w-3 h-3" />
                      Manual
                    </button>
                    <button
                      onClick={() => setScheduleMode('scheduled')}
                      className={`flex-1 p-2.5 sm:p-2 rounded-lg text-xs font-medium shadow-sm flex items-center justify-center gap-1.5 transition-all ${
                        scheduleMode === 'scheduled'
                          ? 'bg-[var(--v2-primary)] text-white'
                          : 'bg-white dark:bg-gray-700 border border-[var(--v2-border)] text-[var(--v2-text-secondary)] hover:border-[var(--v2-primary)]'
                      }`}
                    >
                      <Calendar className="w-3 h-3" />
                      Scheduled
                    </button>
                  </div>

                  {/* Interactive Schedule Builder */}
                  {scheduleMode === 'scheduled' && (
                    <div className="space-y-2 relative">
                      {/* Schedule Display/Trigger Button */}
                      <button
                        onClick={() => setShowScheduleBuilder(!showScheduleBuilder)}
                        className="w-full px-3 py-2.5 sm:px-2 sm:py-1.5 bg-white dark:bg-gray-700 border border-[var(--v2-border)] rounded-lg text-xs text-left flex items-center justify-between hover:border-[var(--v2-primary)] transition-colors active:scale-[0.98]"
                      >
                        <span className={scheduleType ? 'text-[var(--v2-text-primary)]' : 'text-[var(--v2-text-muted)]'}>
                          {getScheduleDescription()}
                        </span>
                        <Settings className="w-4 h-4 sm:w-3 sm:h-3 text-gray-400" />
                      </button>

                      {/* Schedule Builder Modal */}
                      {showScheduleBuilder && (
                        <div className="fixed sm:absolute z-50 left-0 right-0 sm:left-auto sm:right-auto sm:w-[340px] bottom-0 sm:bottom-auto sm:top-full sm:mt-1 bg-white dark:bg-gray-800 border-t sm:border border-[var(--v2-border)] sm:rounded-lg rounded-t-2xl sm:rounded-t-lg shadow-2xl p-4 max-h-[80vh] sm:max-h-[500px] overflow-y-auto" ref={builderRef}>
                          <div className="space-y-3">
                            {/* Header */}
                            <div className="flex items-center justify-between pb-2 border-b border-[var(--v2-border)]">
                              <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">Configure Schedule</h3>
                              <button
                                onClick={() => setShowScheduleBuilder(false)}
                                className="text-[var(--v2-text-muted)] hover:text-[var(--v2-text-primary)]"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>

                            {/* Step 1: Choose Type */}
                            <div className="space-y-1.5">
                              <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Frequency</label>
                              <div className="grid grid-cols-4 gap-2 sm:gap-1.5">
                                {[
                                  { value: 'hourly', label: 'Hourly', icon: Clock },
                                  { value: 'daily', label: 'Daily', icon: Calendar },
                                  { value: 'weekly', label: 'Weekly', icon: Calendar },
                                  { value: 'monthly', label: 'Monthly', icon: Calendar },
                                ].map((type) => (
                                  <button
                                    key={type.value}
                                    onClick={() => {
                                      setScheduleType(type.value as any)
                                      if (type.value === 'weekly' && selectedDays.length === 0) {
                                        setSelectedDays(['monday'])
                                      }
                                    }}
                                    className={`p-2 sm:p-1.5 rounded text-[11px] sm:text-[10px] font-medium flex flex-col items-center gap-1 sm:gap-0.5 transition-all active:scale-95 ${
                                      scheduleType === type.value
                                        ? 'bg-[var(--v2-primary)] text-white'
                                        : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                    }`}
                                  >
                                    <type.icon className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                                    <span className="leading-tight">{type.label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Hourly Configuration */}
                            {scheduleType === 'hourly' && (
                              <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Every</label>
                                <div className="grid grid-cols-4 gap-2 sm:gap-1.5">
                                  {['1', '2', '3', '4', '6', '8', '12'].map((interval) => (
                                    <button
                                      key={interval}
                                      onClick={() => setHourlyInterval(interval)}
                                      className={`p-2 sm:p-1.5 rounded text-xs font-medium transition-all active:scale-95 ${
                                        hourlyInterval === interval
                                          ? 'bg-[var(--v2-primary)] text-white'
                                          : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                      }`}
                                    >
                                      {interval}h
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Daily Configuration */}
                            {scheduleType === 'daily' && (
                              <div className="space-y-2">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Days</label>
                                  <div className="grid grid-cols-3 gap-2 sm:gap-1.5">
                                    {[
                                      { value: 'everyday', label: 'Every day' },
                                      { value: 'weekdays', label: 'Weekdays' },
                                      { value: 'weekends', label: 'Weekends' },
                                    ].map((option) => (
                                      <button
                                        key={option.value}
                                        onClick={() => setDailyOption(option.value as any)}
                                        className={`p-2 sm:p-1.5 rounded text-[11px] sm:text-[10px] font-medium transition-all active:scale-95 ${
                                          dailyOption === option.value
                                            ? 'bg-[var(--v2-primary)] text-white'
                                            : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                      >
                                        {option.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Time</label>
                                  <input
                                    type="time"
                                    value={scheduleTime}
                                    onChange={(e) => setScheduleTime(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-white dark:bg-gray-700 border border-[var(--v2-border)] rounded text-xs"
                                  />
                                </div>
                              </div>
                            )}

                            {/* Weekly Configuration */}
                            {scheduleType === 'weekly' && (
                              <div className="space-y-2">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Select Days</label>
                                  <div className="grid grid-cols-7 gap-1.5 sm:gap-1">
                                    {[
                                      { short: 'M', full: 'monday' },
                                      { short: 'T', full: 'tuesday' },
                                      { short: 'W', full: 'wednesday' },
                                      { short: 'T', full: 'thursday' },
                                      { short: 'F', full: 'friday' },
                                      { short: 'S', full: 'saturday' },
                                      { short: 'S', full: 'sunday' }
                                    ].map((day, index) => (
                                      <button
                                        key={index}
                                        onClick={() => handleDayToggle(day.full)}
                                        className={`p-2 sm:p-1.5 rounded text-[11px] sm:text-[10px] font-medium transition-all leading-tight active:scale-95 ${
                                          selectedDays.includes(day.full)
                                            ? 'bg-[var(--v2-primary)] text-white'
                                            : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                      >
                                        {day.short}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Time</label>
                                  <input
                                    type="time"
                                    value={scheduleTime}
                                    onChange={(e) => setScheduleTime(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-white dark:bg-gray-700 border border-[var(--v2-border)] rounded text-xs"
                                  />
                                </div>
                              </div>
                            )}

                            {/* Monthly Configuration */}
                            {scheduleType === 'monthly' && (
                              <div className="space-y-2">
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Day of Month</label>
                                  <div className="grid grid-cols-7 gap-1.5 sm:gap-1 max-h-[200px] sm:max-h-[140px] overflow-y-auto">
                                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                                      <button
                                        key={day}
                                        onClick={() => setSelectedMonthDay(day.toString())}
                                        className={`p-2 sm:p-1.5 rounded text-[11px] sm:text-[10px] font-medium transition-all leading-tight active:scale-95 ${
                                          selectedMonthDay === day.toString()
                                            ? 'bg-[var(--v2-primary)] text-white'
                                            : 'bg-gray-100 dark:bg-gray-700 text-[var(--v2-text-secondary)] hover:bg-gray-200 dark:hover:bg-gray-600'
                                        }`}
                                      >
                                        {day}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div className="space-y-1.5">
                                  <label className="text-xs font-medium text-[var(--v2-text-secondary)]">Time</label>
                                  <input
                                    type="time"
                                    value={scheduleTime}
                                    onChange={(e) => setScheduleTime(e.target.value)}
                                    className="w-full px-2 py-1.5 bg-white dark:bg-gray-700 border border-[var(--v2-border)] rounded text-xs"
                                  />
                                </div>
                              </div>
                            )}

                            {/* Preview & Apply */}
                            {scheduleType && (
                              <div className="pt-3 border-t border-[var(--v2-border)] space-y-3">
                                <div className="flex items-center gap-2 px-3 py-2 bg-[var(--v2-primary)]/10 rounded-lg">
                                  <Clock className="w-4 h-4 text-[var(--v2-primary)]" />
                                  <span className="text-xs font-medium text-[var(--v2-primary)]">
                                    {getScheduleDescription()}
                                  </span>
                                </div>
                                <button
                                  onClick={() => setShowScheduleBuilder(false)}
                                  className="w-full px-4 py-3 sm:px-3 sm:py-2 bg-[var(--v2-primary)] text-white rounded-lg text-sm sm:text-xs font-medium hover:opacity-90 active:scale-[0.98] transition-all"
                                >
                                  Apply Schedule
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-auto pt-4 border-t border-[var(--v2-border)] space-y-2">
                <button
                  disabled
                  className="w-full px-4 py-2.5 bg-gray-100 dark:bg-gray-800 text-[var(--v2-text-muted)] rounded-lg text-sm font-medium cursor-not-allowed"
                >
                  Complete setup to deploy
                </button>
                <button className="w-full px-4 py-2.5 bg-white dark:bg-gray-800 text-[var(--v2-text-secondary)] border border-[var(--v2-border)] rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  Save as Draft
                </button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function V2NewAgentPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--v2-primary)]" />
      </div>
    }>
      <V2AgentBuilderContent />
    </Suspense>
  )
}

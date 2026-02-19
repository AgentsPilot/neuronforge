/**
 * CalibrationSetup - Two-column calibration interface
 *
 * Layout:
 * - Left column: Chat-style conversation showing progress and results
 * - Right column: Issues list with action items
 * - Stays on same page throughout entire flow
 */

'use client'

import React, { useState, useEffect } from 'react'
import { Card } from '@/components/v2/ui/card'
import {
  Play,
  CheckCircle2,
  Settings,
  Lock,
  Zap,
  Bot,
  User,
  AlertCircle
} from 'lucide-react'
import { AgentInputFields } from '@/components/v2/AgentInputFields'
import { DynamicSelectField } from '@/components/v2/DynamicSelectField'
import type { IssueGroups, UserFixes } from './CalibrationDashboard'
import type { CollectedIssue } from '@/lib/pilot/types'

interface Agent {
  id: string
  agent_name: string
  description?: string
  pilot_steps?: any[]
  workflow_steps?: any[]
  production_ready?: boolean
  input_schema?: Array<{
    name: string
    label?: string
    type: string
    description?: string
    required?: boolean
    placeholder?: any
  }>
}

interface CalibrationSession {
  id: string
  agentId: string
  status: string
  executionId?: string
  totalSteps?: number
  completedSteps?: number
  failedSteps?: number
  skippedSteps?: number
  execution_summary?: {
    data_sources_accessed?: Array<{
      plugin: string
      action: string
      count: number
      description: string
    }>
    data_written?: Array<{
      plugin: string
      action: string
      count: number
      description: string
    }>
    items_processed?: number
    items_filtered?: number
    items_delivered?: number
  }
}

interface CalibrationSetupProps {
  agent: Agent
  onRun: (inputValues: Record<string, any>) => void
  isRunning: boolean
  initialInputValues?: Record<string, any>
  issues?: IssueGroups | null
  fixes?: UserFixes
  onFixesChange?: (fixes: UserFixes) => void
  onComplete?: () => void
  onApplyFixes?: () => Promise<void>
  schemaMetadata?: Record<string, any[]> | null
  onApproveForProduction?: () => void
  session?: CalibrationSession | null
}

interface ChatMessage {
  id: string
  type: 'bot' | 'user' | 'system'
  content: string
  timestamp: Date
  progress?: number
  issue?: CollectedIssue
  isFixing?: boolean
  showInputForm?: boolean
}

export function CalibrationSetup({
  agent,
  onRun,
  isRunning,
  initialInputValues = {},
  issues = null,
  fixes: externalFixes,
  onFixesChange,
  onComplete,
  onApplyFixes,
  schemaMetadata,
  onApproveForProduction,
  session
}: CalibrationSetupProps) {
  const [inputValues, setInputValues] = useState<Record<string, any>>(initialInputValues)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [progress, setProgress] = useState(0)
  const [currentStep, setCurrentStep] = useState('')
  const [hasStarted, setHasStarted] = useState(false)
  const [currentIssueIndex, setCurrentIssueIndex] = useState(0)
  const [isFixingMode, setIsFixingMode] = useState(false)
  const [fixesHaveBeenApplied, setFixesHaveBeenApplied] = useState(false)
  const [internalFixes, setInternalFixes] = useState<UserFixes>({
    parameters: {},
    parameterizations: {},
    autoRepairs: {},
    logicFixes: {}
  })
  const chatScrollRef = React.useRef<HTMLDivElement>(null)

  // Use external fixes if provided, otherwise use internal state
  const fixes = externalFixes || internalFixes

  // Wrapper to handle both callback and state setter patterns
  const updateFixes = (updater: UserFixes | ((prev: UserFixes) => UserFixes)) => {
    if (onFixesChange) {
      // External fixes: apply updater and call callback
      const newFixes = typeof updater === 'function' ? updater(externalFixes || internalFixes) : updater
      onFixesChange(newFixes)
    } else {
      // Internal fixes: use state setter directly
      setInternalFixes(updater)
    }
  }

  // Dynamic options provider for dropdown fields
  const getDynamicOptions = (fieldName: string): { plugin: string; action: string; parameter: string; depends_on?: string[] } | null => {
    console.log('[CalibrationSetup] getDynamicOptions called for field:', fieldName)
    console.log('[CalibrationSetup] schemaMetadata available:', !!schemaMetadata)
    if (schemaMetadata) {
      console.log('[CalibrationSetup] schemaMetadata keys:', Object.keys(schemaMetadata))
    }

    if (!schemaMetadata) {
      console.log('[CalibrationSetup] No schemaMetadata, returning null')
      return null
    }

    // First try exact match
    let matchingParams = schemaMetadata[fieldName]
    console.log('[CalibrationSetup] Exact match for', fieldName, ':', matchingParams)

    // If no exact match, try stripping common prefixes (including step ID prefixes)
    if (!matchingParams || matchingParams.length === 0) {
      const prefixes = [/^step\d+_/, 'source_', 'target_', 'input_', 'output_', 'from_', 'to_']
      for (const prefix of prefixes) {
        let baseFieldName: string
        if (prefix instanceof RegExp) {
          // Handle regex for step ID prefix (step8_, step9_, etc.)
          const match = fieldName.match(prefix)
          if (match) {
            baseFieldName = fieldName.substring(match[0].length)
          } else {
            continue
          }
        } else {
          // Handle string prefix
          if (fieldName.startsWith(prefix)) {
            baseFieldName = fieldName.substring(prefix.length)
          } else {
            continue
          }
        }
        matchingParams = schemaMetadata[baseFieldName]
        if (matchingParams && matchingParams.length > 0) {
          console.log('[CalibrationSetup] Matched prefixed field:', fieldName, '->', baseFieldName, matchingParams)
          break
        } else {
          console.log('[CalibrationSetup] No match for prefixed field:', baseFieldName)
        }
      }
    }

    if (matchingParams && matchingParams.length > 0) {
      const match = matchingParams[0]
      const result = {
        plugin: match.plugin,
        action: match.action,
        parameter: match.parameter,
        depends_on: match.depends_on
      }
      console.log('[CalibrationSetup] Returning dynamic options for', fieldName, ':', result)
      return result
    }

    console.log('[CalibrationSetup] No match found for', fieldName, ', returning null')
    return null
  }

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [messages])

  // Update inputValues when initialInputValues changes (e.g., after loading from API)
  useEffect(() => {
    if (initialInputValues && Object.keys(initialInputValues).length > 0) {
      console.log('[CalibrationSetup] Loading initial input values:', initialInputValues)
      setInputValues(initialInputValues)
    }
  }, [initialInputValues])

  // Auto-scroll chat to bottom when messages change
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [messages])

  // Simulate progress when running with chat messages
  useEffect(() => {
    if (isRunning && hasStarted) {
      setProgress(0)
      setCurrentStep('Starting workflow test...')

      // Add initial bot message (preserve previous messages for conversation history)
      setMessages(prev => [
        ...prev,
        {
          id: `run-${Date.now()}-1`,
          type: 'bot',
          content: 'Starting your workflow test...',
          timestamp: new Date(),
          progress: 0
        }
      ])

      const steps = [
        { progress: 20, text: 'Connecting to services...', delay: 800, message: 'Connecting to all your integrations...' },
        { progress: 40, text: 'Running workflow...', delay: 1600, message: 'Running your workflow with test data...' },
        { progress: 60, text: 'Checking connections...', delay: 2400, message: 'Verifying all connections are working...' },
        { progress: 80, text: 'Analyzing results...', delay: 3200, message: 'Analyzing the results...' },
        { progress: 100, text: 'Completing test...', delay: 4000, message: 'Finalizing test results...' }
      ]

      const runTimestamp = Date.now()
      steps.forEach(({ progress: p, text, delay, message }, index) => {
        setTimeout(() => {
          setProgress(p)
          setCurrentStep(text)
          setMessages(prev => [
            ...prev,
            {
              id: `run-${runTimestamp}-${index + 2}`,
              type: 'bot',
              content: message,
              timestamp: new Date(),
              progress: p
            }
          ])
        }, delay)
      })
    } else if (!isRunning && hasStarted && issues) {
      // Test completed - add summary message
      const totalIssues = issues.critical.length + issues.warnings.length
      setTimeout(() => {
        if (totalIssues === 0) {
          setMessages(prev => [
            ...prev,
            {
              id: `complete-${Date.now()}`,
              type: 'bot',
              content: '✓ Great news! No issues found. Your workflow is ready to use!',
              timestamp: new Date(),
              progress: 100
            }
          ])
        } else {
          setMessages(prev => [
            ...prev,
            {
              id: `complete-${Date.now()}`,
              type: 'bot',
              content: `✓ Test complete!`,
              timestamp: new Date(),
              progress: 100
            }
          ])
        }
      }, 500)
    }
  }, [isRunning, hasStarted, issues])

  const handleRun = () => {
    console.log('[CalibrationSetup] Running calibration with input values:', inputValues)
    console.log('[CalibrationSetup] Input values count:', Object.keys(inputValues).length)
    setHasStarted(true)
    onRun(inputValues)
  }

  // Separate critical issues from improvements
  const criticalIssues = React.useMemo(() => {
    if (!issues) return []
    return issues.critical.filter(issue => {
      // NEVER show data_shape_mismatch - it's auto-fixed silently
      if (issue.category === 'data_shape_mismatch') return false
      if (!issue.requiresUserInput) return false
      // Critical: parameter errors and logic errors
      return ['parameter_error', 'logic_error'].includes(issue.category)
    })
  }, [issues])

  const improvements = React.useMemo(() => {
    if (!issues) return []
    // Improvements: hardcode detections only (NOT data shape mismatches)
    return [...issues.critical, ...issues.warnings].filter(issue => {
      // NEVER show data_shape_mismatch - it's auto-fixed silently
      if (issue.category === 'data_shape_mismatch') return false
      if (!issue.requiresUserInput) return false
      return issue.category === 'hardcode_detected'
    })
  }, [issues])

  // Combined list for sequential fixing (critical first, then improvements)
  const allIssues = React.useMemo(() => {
    return [...criticalIssues, ...improvements]
  }, [criticalIssues, improvements])

  // Calculate total issues that actually need user attention (excluding auto-fixable ones)
  const totalIssues = allIssues.length
  const hasIssues = totalIssues > 0

  // Debug logging for right column state
  console.log('[CalibrationSetup] Right column state:', {
    hasStarted,
    isRunning,
    hasIssues,
    totalIssues,
    criticalCount: criticalIssues.length,
    improvementsCount: improvements.length,
    issuesObject: issues,
    hasCallback: !!onApproveForProduction,
    productionReady: agent.production_ready
  })

  // Handle bulk parameterize all hardcoded values
  const handleParameterizeAll = () => {
    const newParameterizations = { ...(fixes.parameterizations || {}) }

    improvements.forEach(issue => {
      const paramName = issue.suggestedFix?.action?.paramName || 'value'
      const defaultValue = issue.suggestedFix?.action?.defaultValue || ''
      newParameterizations[issue.id] = {
        approved: true,
        paramName,
        defaultValue
      }
    })

    updateFixes(prev => ({
      ...prev,
      parameterizations: newParameterizations
    }))

    // Add confirmation message
    setMessages(prev => [
      ...prev,
      {
        id: `bulk-parameterize-${Date.now()}`,
        type: 'user',
        content: `Make all ${improvements.length} values flexible`,
        timestamp: new Date()
      },
      {
        id: `bulk-confirm-${Date.now()}`,
        type: 'bot',
        content: `✓ Perfect! I've made all ${improvements.length} hardcoded values flexible. Users will be able to customize them when running the workflow.`,
        timestamp: new Date()
      }
    ])

    // All done since improvements are optional
    setTimeout(() => {
      setMessages(prev => [
        ...prev,
        {
          id: 'all-fixed',
          type: 'bot',
          content: `✓ All done! Your workflow is ready to use!`,
          timestamp: new Date()
        }
      ])
      setIsFixingMode(false)
    }, 1000)
  }

  // Handle skipping improvements
  const handleSkipImprovements = () => {
    setMessages(prev => [
      ...prev,
      {
        id: `skip-improvements-${Date.now()}`,
        type: 'user',
        content: 'Skip improvements',
        timestamp: new Date()
      },
      {
        id: `skip-confirm-${Date.now()}`,
        type: 'bot',
        content: `✓ No problem! Your workflow is ready to use as is.`,
        timestamp: new Date()
      }
    ])

    setTimeout(() => {
      setIsFixingMode(false)
    }, 1000)
  }

  // Start fixing mode after test completes
  useEffect(() => {
    if (!isRunning && hasStarted && issues && !isFixingMode) {
      const totalIssues = issues.critical.length + issues.warnings.length
      setTimeout(() => {
        if (totalIssues > 0 && allIssues.length > 0) {
          // Different messages based on what issues were found
          if (criticalIssues.length > 0 && improvements.length > 0) {
            // Both critical issues and improvements
            setMessages(prev => {
              // Check if we've already added these messages
              const alreadyInitialized = prev.some(msg => msg.id === 'issues-found')
              if (alreadyInitialized) {
                return prev
              }

              return [
                ...prev,
                {
                  id: 'issues-found',
                  type: 'bot',
                  content: `I found ${criticalIssues.length} critical ${criticalIssues.length === 1 ? 'issue that needs' : 'issues that need'} your attention.`,
                  timestamp: new Date()
                },
                {
                  id: 'start-fixing',
                  type: 'bot',
                  content: `Let's fix ${criticalIssues.length === 1 ? 'this' : 'these'} first.`,
                  timestamp: new Date()
                }
              ]
            })
            // Start with critical issues
            setTimeout(() => {
              setIsFixingMode(true)
              setCurrentIssueIndex(0)
            }, 800)
          } else if (criticalIssues.length > 0) {
            // Only critical issues
            setMessages(prev => {
              // Check if we've already added these messages
              const alreadyInitialized = prev.some(msg => msg.id === 'start-fixing')
              if (alreadyInitialized) {
                return prev
              }

              return [
                ...prev,
                {
                  id: 'start-fixing',
                  type: 'bot',
                  content: `I found ${criticalIssues.length} ${criticalIssues.length === 1 ? 'issue that needs' : 'issues that need'} your input.`,
                  timestamp: new Date()
                }
              ]
            })
            setTimeout(() => {
              setIsFixingMode(true)
              setCurrentIssueIndex(0)
            }, 800)
          } else if (improvements.length > 0) {
            // Only improvements (hardcoded values)
            setMessages(prev => {
              // Check if we've already added these messages
              const alreadyInitialized = prev.some(msg => msg.id === 'start-fixing')
              if (alreadyInitialized) {
                return prev
              }

              return [
                ...prev,
                {
                  id: 'start-fixing',
                  type: 'bot',
                  content: `Great news! No critical issues found.`,
                  timestamp: new Date()
                }
              ]
            })

            // Offer bulk option for improvements
            if (improvements.length > 1) {
              setTimeout(() => {
                setMessages(prev => [
                  ...prev,
                  {
                    id: 'improvements-notice',
                    type: 'bot',
                    content: `I noticed ${improvements.length} hardcoded values. Would you like to make them all flexible at once, or go through them one by one?`,
                    timestamp: new Date()
                  },
                  {
                    id: 'bulk-offer',
                    type: 'bot',
                    content: '', // This will trigger the UI to show the three-button option
                    timestamp: new Date()
                  }
                ])
              }, 500)
            } else {
              // Single improvement, just ask
              setTimeout(() => {
                setIsFixingMode(true)
                setCurrentIssueIndex(0)
              }, 800)
            }
          }
        } else if (totalIssues === 0) {
          // No issues at all
          setMessages(prev => [
            ...prev,
            {
              id: 'no-issues',
              type: 'bot',
              content: '✓ Perfect! No issues found. Your workflow is production-ready!',
              timestamp: new Date()
            }
          ])
        } else {
          // All issues were auto-fixed
          setMessages(prev => [
            ...prev,
            {
              id: 'auto-fixed',
              type: 'bot',
              content: `✓ Great! I automatically fixed ${totalIssues} ${totalIssues === 1 ? 'issue' : 'issues'}. Your workflow is ready to use!`,
              timestamp: new Date()
            }
          ])
        }
      }, 1000)
    }
  }, [isRunning, hasStarted, issues, isFixingMode, allIssues])

  // Show current issue when fixing mode starts or issue index changes
  useEffect(() => {
    console.log('[CalibrationSetup] Issue display useEffect triggered:', {
      isFixingMode,
      currentIssueIndex,
      allIssuesLength: allIssues.length,
      criticalIssuesLength: criticalIssues.length,
      improvementsLength: improvements.length
    })

    if (isFixingMode && allIssues.length > 0 && currentIssueIndex < allIssues.length) {
      // Always show the issue - the blocking logic is handled in the transition flow
      const currentIssue = allIssues[currentIssueIndex]
      console.log('[CalibrationSetup] Will show issue:', currentIssue.id, 'at index', currentIssueIndex)

      setTimeout(() => {
        setMessages(prev => {
          // Check if this issue is already being shown
          const alreadyShowing = prev.some(msg =>
            msg.isFixing && msg.issue?.id === currentIssue.id
          )

          console.log('[CalibrationSetup] Issue already showing?', alreadyShowing)

          if (alreadyShowing) {
            console.log('[CalibrationSetup] Skipping duplicate issue')
            return prev // Don't add duplicate
          }

          console.log('[CalibrationSetup] Adding issue to messages')
          return [
            ...prev,
            {
              id: `issue-${currentIssueIndex}-${Date.now()}`,
              type: 'bot',
              content: '', // Will be rendered by IssueFixingCard
              timestamp: new Date(),
              issue: currentIssue,
              isFixing: true
            }
          ]
        })
      }, 500)
    }
  }, [isFixingMode, currentIssueIndex, allIssues, criticalIssues.length, improvements.length])

  // Handle user response to fixing an issue
  const handleIssueFix = (issueId: string, fix: any, issue: CollectedIssue) => {
    // Update fixes state
    if (issue.category === 'parameter_error') {
      updateFixes(prev => ({
        ...prev,
        parameters: {
          ...prev.parameters,
          [issueId]: fix.value
        }
      }))
    } else if (issue.category === 'hardcode_detected') {
      updateFixes(prev => ({
        ...prev,
        parameterizations: {
          ...prev.parameterizations,
          [issueId]: fix
        }
      }))
    } else if (issue.category === 'logic_error') {
      updateFixes(prev => ({
        ...prev,
        logicFixes: {
          ...prev.logicFixes,
          [issueId]: fix
        }
      }))
    }

    // Add user's response to chat
    const userResponse = formatUserResponse(issue, fix)
    setMessages(prev => [
      ...prev,
      {
        id: `user-response-${issueId}`,
        type: 'user',
        content: userResponse,
        timestamp: new Date()
      }
    ])

    // Add bot confirmation
    setTimeout(() => {
      const isLastIssue = currentIssueIndex === allIssues.length - 1
      const isLastCriticalIssue = currentIssueIndex === criticalIssues.length - 1
      const hasMoreImprovements = improvements.length > 0 && currentIssueIndex < allIssues.length - 1

      console.log('[CalibrationSetup] After fix:', {
        currentIssueIndex,
        isLastIssue,
        isLastCriticalIssue,
        hasMoreImprovements,
        criticalLength: criticalIssues.length,
        improvementsLength: improvements.length,
        allIssuesLength: allIssues.length
      })

      setMessages(prev => [
        ...prev,
        {
          id: `bot-confirmation-${issueId}`,
          type: 'bot',
          content: isLastIssue
            ? '✓ Perfect! I\'ve got all the information I need. Applying your fixes now...'
            : `✓ Got it! Let's move to the next one.`,
          timestamp: new Date()
        }
      ])

      // Check if we just finished critical issues and have improvements pending
      const justFinishedCritical = isLastCriticalIssue && hasMoreImprovements

      if (justFinishedCritical) {
        console.log('[CalibrationSetup] Just finished critical issues, showing bulk offer')
        // Finished critical issues, now offer improvements
        setTimeout(() => {
          setMessages(prev => [
            ...prev,
            {
              id: 'critical-done',
              type: 'bot',
              content: `✓ Great! All critical issues are fixed. Your workflow can now run successfully.`,
              timestamp: new Date()
            }
          ])

          // Offer improvements after a pause
          setTimeout(() => {
            setMessages(prev => [
              ...prev,
              {
                id: 'improvements-offer',
                type: 'bot',
                content: `I noticed ${improvements.length} hardcoded ${improvements.length === 1 ? 'value' : 'values'}. Would you like to make ${improvements.length === 1 ? 'it' : 'them all'} flexible at once, or go through them one by one?`,
                timestamp: new Date()
              }
            ])

            // Show bulk option if multiple improvements
            if (improvements.length > 1) {
              setTimeout(() => {
                setMessages(prev => [
                  ...prev,
                  {
                    id: 'bulk-offer',
                    type: 'bot',
                    content: '', // Empty content triggers the button UI
                    timestamp: new Date()
                  }
                ])
              }, 500)
            } else {
              // Single improvement, move to it
              setTimeout(() => {
                setCurrentIssueIndex(prev => prev + 1)
              }, 800)
            }
          }, 1000)

          setIsFixingMode(false)
        }, 1000)
      } else if (isLastIssue) {
        // Truly done with everything
        setTimeout(() => {
          setMessages(prev => [
            ...prev,
            {
              id: 'fixes-applied',
              type: 'bot',
              content: `✓ All done! I've fixed ${allIssues.length} ${allIssues.length === 1 ? 'issue' : 'issues'} based on your input. Your workflow is ready to use!`,
              timestamp: new Date()
            }
          ])
          setIsFixingMode(false)
        }, 1000)
      } else {
        // Move to next issue
        setTimeout(() => {
          setCurrentIssueIndex(prev => prev + 1)
        }, 800)
      }
    }, 300)
  }

  // Format user's response for display
  const formatUserResponse = (issue: CollectedIssue, fix: any): string => {
    if (issue.category === 'parameter_error') {
      return fix.value
    } else if (issue.category === 'hardcode_detected') {
      return fix.approved ? 'Yes, make it flexible' : 'No, keep it fixed'
    } else if (issue.category === 'logic_error') {
      return fix.selectedOption === 'auto_fix' ? 'Yes, fix it' : 'No, leave it as is'
    }
    return 'Confirmed'
  }

  return (
    <div className="w-full">
      {/* Two Column Layout */}
      <div className="grid lg:grid-cols-2 gap-4 sm:gap-5 lg:gap-6">

        {/* LEFT COLUMN - Chat */}
        <div className="flex flex-col h-[680px]">
          <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] h-full flex flex-col">
            <div className="p-6 border-b border-[var(--v2-border)] flex-shrink-0">
              <h2 className="text-lg font-semibold text-[var(--v2-text-primary)] flex items-center gap-2">
                <Bot className="w-5 h-5 text-[var(--v2-primary)]" />
                Test Assistant
              </h2>
            </div>

            <div ref={chatScrollRef} className="flex-1 p-6 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
              {!hasStarted ? (
                // Initial Welcome Message
                <div className="space-y-6">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
                    </div>
                    <div className="px-4 py-3 rounded-2xl bg-[var(--v2-surface)] border border-[var(--v2-border)] shadow-sm">
                      <p className="text-sm text-[var(--v2-text-primary)] mb-3">
                        Hi! I'll help you test your workflow. Here's what I'll check:
                      </p>
                      <div className="space-y-2 mb-4">
                        <div className="flex items-center gap-2 text-xs text-[var(--v2-text-secondary)]">
                          <CheckCircle2 className="w-4 h-4 text-[var(--v2-primary)]" />
                          <span>All integrations are connected</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--v2-text-secondary)]">
                          <Settings className="w-4 h-4 text-[var(--v2-primary)]" />
                          <span>Settings are configured correctly</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[var(--v2-text-secondary)]">
                          <Zap className="w-4 h-4 text-[var(--v2-success)]" />
                          <span>Auto-fix issues I can handle</span>
                        </div>
                      </div>
                      <div className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
                        <AlertCircle className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                        <p className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">
                          Make sure you have test data ready (e.g., emails in your inbox, data in your spreadsheets) before starting.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Input Parameters - REMOVED: Don't show at startup, only after fixes applied */}
                  {/* The inline form (line 855) will handle input collection after parameterization */}

                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
                      <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
                    </div>
                    <div className="px-4 py-3 rounded-2xl bg-[var(--v2-surface)] border border-[var(--v2-border)]">
                      <p className="text-sm text-[var(--v2-text-primary)]">
                        Ready to start? Click the "Start Test Run" button above. This will take about 30 seconds.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                // Chat messages during/after test
                <div className="space-y-4">
                  {messages.map((msg, index) => (
                    <div key={msg.id}>
                      {msg.type === 'bot' && !msg.isFixing && msg.content && (
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
                          </div>
                          <div className="px-4 py-3 rounded-2xl bg-[var(--v2-surface)] border border-[var(--v2-border)] max-w-[85%] shadow-sm">
                            <p className="text-sm text-[var(--v2-text-primary)]">{msg.content}</p>
                            {msg.progress !== undefined && (
                              <div className="mt-3 space-y-1">
                                <div className="h-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-full overflow-hidden">
                                  <div
                                    className={`h-full transition-all duration-500 ease-out rounded-full ${
                                      msg.progress === 100 ? 'bg-[var(--v2-success)]' : 'bg-[var(--v2-primary)]'
                                    }`}
                                    style={{ width: `${msg.progress}%` }}
                                  />
                                </div>
                                <p className={`text-xs ${
                                  msg.progress === 100 ? 'text-[var(--v2-success)] font-semibold' : 'text-[var(--v2-text-secondary)]'
                                }`}>
                                  {msg.progress === 100 ? '✓ Complete' : `${msg.progress}%`}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {msg.type === 'user' && (
                        <div className="flex items-start gap-3 justify-end">
                          <div className="px-4 py-3 rounded-2xl bg-[var(--v2-primary)] text-white max-w-[85%] shadow-sm">
                            <p className="text-sm">{msg.content}</p>
                          </div>
                          <div className="w-8 h-8 rounded-full bg-[var(--v2-surface)] border border-[var(--v2-border)] flex items-center justify-center flex-shrink-0">
                            <User className="w-4 h-4 text-[var(--v2-text-secondary)]" />
                          </div>
                        </div>
                      )}

                      {msg.isFixing && msg.issue && (
                        <IssueFixingCard
                          issue={msg.issue}
                          issueNumber={currentIssueIndex}
                          totalIssues={allIssues.length}
                          onFix={(fix) => handleIssueFix(msg.issue!.id, fix, msg.issue!)}
                        />
                      )}

                      {/* Bulk Parameterize Option */}
                      {msg.id === 'bulk-offer' && improvements.length > 1 && (
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
                          </div>
                          <div className="flex-1 space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={handleParameterizeAll}
                                className="p-3 rounded-lg border-2 border-[var(--v2-primary)] bg-[var(--v2-primary)]/5 hover:bg-[var(--v2-primary)]/10 transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
                                    <Lock className="w-3.5 h-3.5 text-[var(--v2-primary)]" />
                                  </div>
                                  <div className="text-left flex-1">
                                    <p className="font-semibold text-xs text-[var(--v2-text-primary)]">Make all flexible</p>
                                    <p className="text-xs text-[var(--v2-text-secondary)]">Apply to all {improvements.length}</p>
                                  </div>
                                </div>
                              </button>

                              <button
                                onClick={() => {
                                  // Add user's choice to chat
                                  setMessages(prev => [
                                    ...prev,
                                    {
                                      id: `review-each-${Date.now()}`,
                                      type: 'user',
                                      content: 'Review each one',
                                      timestamp: new Date()
                                    },
                                    {
                                      id: `review-confirm-${Date.now()}`,
                                      type: 'bot',
                                      content: `✓ Okay, let's go through them one by one.`,
                                      timestamp: new Date()
                                    }
                                  ])

                                  // Start fixing improvements one by one
                                  setTimeout(() => {
                                    setCurrentIssueIndex(criticalIssues.length)
                                    setIsFixingMode(true)

                                    // Manually show first improvement issue
                                    setTimeout(() => {
                                      const firstImprovementIssue = improvements[0]
                                      setMessages(prev => {
                                        // Check if already showing
                                        const alreadyShowing = prev.some(msg =>
                                          msg.isFixing && msg.issue?.id === firstImprovementIssue.id
                                        )

                                        if (alreadyShowing) {
                                          return prev
                                        }

                                        return [
                                          ...prev,
                                          {
                                            id: `issue-${criticalIssues.length}-${Date.now()}`,
                                            type: 'bot',
                                            content: '',
                                            timestamp: new Date(),
                                            issue: firstImprovementIssue,
                                            isFixing: true
                                          }
                                        ]
                                      })
                                    }, 500)
                                  }, 1000)
                                }}
                                className="p-3 rounded-lg border-2 border-[var(--v2-border)] bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)] transition-colors"
                              >
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-full bg-[var(--v2-text-secondary)]/10 flex items-center justify-center flex-shrink-0">
                                    <Settings className="w-3.5 h-3.5 text-[var(--v2-text-secondary)]" />
                                  </div>
                                  <div className="text-left flex-1">
                                    <p className="font-semibold text-xs text-[var(--v2-text-primary)]">Review each one</p>
                                    <p className="text-xs text-[var(--v2-text-secondary)]">One by one</p>
                                  </div>
                                </div>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Input Form - Show inline after fixes applied */}
                      {/* Only show if fixes have been applied AND agent has input_schema */}
                      {msg.showInputForm && (() => {
                        console.log('[CalibrationSetup] Form visibility check:', {
                          showInputForm: msg.showInputForm,
                          fixesHaveBeenApplied,
                          hasInputSchema: !!agent.input_schema,
                          schemaLength: agent.input_schema?.length
                        })
                        return true
                      })() && fixesHaveBeenApplied && agent.input_schema && agent.input_schema.length > 0 && (
                        <div className="flex items-start gap-3 mt-4">
                          <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
                          </div>
                          <div className="flex-1">
                            <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-6">
                              <div className="space-y-4">
                                {/* Input fields */}
                                <AgentInputFields
                                  schema={agent.input_schema || []}
                                  values={inputValues}
                                  onChange={(name, value) => {
                                    setInputValues(prev => ({
                                      ...prev,
                                      [name]: value
                                    }))
                                  }}
                                  getDynamicOptions={getDynamicOptions}
                                />

                                {/* Run button - disabled until all required fields are filled */}
                                <button
                                  onClick={() => {
                                    onRun(inputValues)
                                    setHasStarted(true)
                                  }}
                                  disabled={(() => {
                                    // Check if all required parameters have values
                                    const requiredParams = (agent.input_schema || []).filter((p: any) => p.required)
                                    return requiredParams.some((p: any) => {
                                      const value = inputValues[p.name]
                                      return value === undefined || value === '' || value === null
                                    })
                                  })()}
                                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[var(--v2-primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity font-medium rounded-lg"
                                >
                                  <Play className="w-4 h-4" />
                                  Run Test
                                </button>
                              </div>
                            </Card>
                          </div>
                        </div>
                      )}

                      {/* Apply Fixes Button - Show when all fixing is done */}
                      {(msg.id === 'all-fixed' || msg.id === 'fixes-applied') && (
                        <div className="flex items-start gap-3 mt-6">
                          <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
                            <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
                          </div>
                          <div className="flex-1">
                            <button
                              onClick={async () => {
                                if (onApplyFixes) {
                                  // Show applying state
                                  setMessages(prev => [
                                    ...prev,
                                    {
                                      id: 'applying-fixes',
                                      type: 'bot',
                                      content: 'Applying fixes...',
                                      timestamp: new Date()
                                    }
                                  ])

                                  try {
                                    // Wait for fixes to be applied AND agent to be updated
                                    await onApplyFixes()

                                    // Mark that fixes have been applied
                                    setFixesHaveBeenApplied(true)

                                    // Show success message first
                                    setMessages(prev => [
                                      ...prev.filter(m => m.id !== 'applying-fixes'),
                                      {
                                        id: 'fixes-success',
                                        type: 'bot',
                                        content: '✓ Fixes applied successfully!',
                                        timestamp: new Date()
                                      }
                                    ])

                                    // Wait a bit for React to update the agent prop, then show input form
                                    // This ensures agent.input_schema has the new parameters
                                    setTimeout(() => {
                                      console.log('[CalibrationSetup] About to show input form. Current agent.input_schema:', agent.input_schema)
                                      setMessages(prev => [
                                        ...prev,
                                        {
                                          id: 'prompt-test',
                                          type: 'bot',
                                          content: 'Now let\'s test your workflow with the applied fixes.',
                                          timestamp: new Date(),
                                          showInputForm: true
                                        }
                                      ])
                                    }, 500)
                                  } catch (error) {
                                    // Show error message
                                    setMessages(prev => [
                                      ...prev.filter(m => m.id !== 'applying-fixes'),
                                      {
                                        id: 'fixes-error',
                                        type: 'bot',
                                        content: '✗ Failed to apply fixes. Please try again.',
                                        timestamp: new Date()
                                      }
                                    ])
                                  }
                                }
                              }}
                              className="w-full p-3 rounded-lg border-2 border-[var(--v2-success)] bg-[var(--v2-success)]/5 hover:bg-[var(--v2-success)]/10 transition-colors"
                            >
                              <div className="flex items-center justify-center gap-2">
                                <div className="w-8 h-8 rounded-full bg-[var(--v2-success)]/10 flex items-center justify-center">
                                  <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                                </div>
                                <div className="text-left">
                                  <p className="font-semibold text-sm text-[var(--v2-text-primary)]">Apply Fixes</p>
                                  <p className="text-xs text-[var(--v2-text-secondary)]">Save changes and continue</p>
                                </div>
                              </div>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  {isRunning && (
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
                        <div className="w-4 h-4 border-2 border-[var(--v2-primary)] border-t-transparent rounded-full animate-spin"></div>
                      </div>
                      <div className="px-4 py-3 rounded-2xl bg-[var(--v2-surface)] border border-[var(--v2-border)]">
                        <div className="flex gap-1">
                          <div className="w-2 h-2 bg-[var(--v2-text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                          <div className="w-2 h-2 bg-[var(--v2-text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                          <div className="w-2 h-2 bg-[var(--v2-text-tertiary)] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Action footer */}
            {!hasStarted && (
              <div className="p-6 border-t border-[var(--v2-border)] flex-shrink-0">
                <button
                  onClick={handleRun}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium rounded-lg"
                >
                  <Play className="w-5 h-5" fill="currentColor" />
                  <span>Start Test</span>
                </button>
              </div>
            )}
          </Card>
        </div>

        {/* RIGHT COLUMN - Issues */}
        <div className="flex flex-col h-[680px]">
          <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] h-full flex flex-col">
            <div className="p-6 border-b border-[var(--v2-border)] flex-shrink-0">
              <h2 className="text-lg font-semibold text-[var(--v2-text-primary)] flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-[var(--v2-primary)]" />
                Issues {hasIssues && `(${totalIssues})`}
              </h2>
            </div>

            <div className="flex-1 p-6 overflow-y-auto" style={{ scrollbarGutter: 'stable' }}>
              {!hasStarted ? (
                // Before test
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-16 h-16 rounded-full bg-[var(--v2-surface-hover)] flex items-center justify-center mb-4">
                    <AlertCircle className="w-8 h-8 text-[var(--v2-text-tertiary)]" />
                  </div>
                  <p className="text-sm text-[var(--v2-text-secondary)]">
                    Start the test to see issues
                  </p>
                </div>
              ) : !hasIssues && !isRunning ? (
                // No issues found - Success state
                (() => {
                  console.log('[CalibrationSetup RIGHT COLUMN] Success state render:', {
                    hasIssues,
                    isRunning,
                    hasStarted,
                    hasCallback: !!onApproveForProduction,
                    productionReady: agent.production_ready,
                    shouldShowButton: !!onApproveForProduction && !agent.production_ready
                  })
                  // Calculate summary data
                  const completedSteps = session?.completedSteps || 0
                  const failedSteps = session?.failedSteps || 0
                  const skippedSteps = session?.skippedSteps || 0
                  const totalSteps = session?.totalSteps || 0

                  // Check if actual data was processed (not just steps completed)
                  const itemsProcessed = session?.execution_summary?.items_processed || 0
                  const itemsDelivered = session?.execution_summary?.items_delivered || 0
                  const hasProcessedData = completedSteps > 0 && (itemsProcessed > 0 || itemsDelivered > 0)
                  const hadNoDataToProcess = completedSteps > 0 && itemsProcessed === 0 && itemsDelivered === 0 && failedSteps === 0

                  return (
                    <div className="flex flex-col h-full px-6 py-6 overflow-y-auto">
                      {/* Test Results */}
                      <div className="mb-4 p-4 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-lg">
                        <div className="flex items-center gap-2 mb-3">
                          <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                          <h3 className="text-base font-semibold text-[var(--v2-text-primary)]">
                            Test Complete
                          </h3>
                        </div>

                        {/* Execution Summary */}
                        {session?.execution_summary && (session.execution_summary.data_sources_accessed?.length > 0 || session.execution_summary.data_written?.length > 0) && (
                          <div className="space-y-1.5">
                            {session.execution_summary.data_sources_accessed?.map((source: any, idx: number) => (
                              <div key={idx} className="flex items-baseline gap-2 text-sm">
                                <span className="text-blue-600 dark:text-blue-400 font-semibold min-w-[24px]">{source.count}</span>
                                <span className="text-[var(--v2-text-secondary)]">{source.description}</span>
                              </div>
                            ))}
                            {session.execution_summary.data_written?.map((written: any, idx: number) => (
                              <div key={idx} className="flex items-baseline gap-2 text-sm">
                                <span className="text-green-600 dark:text-green-400 font-semibold min-w-[24px]">{written.count}</span>
                                <span className="text-[var(--v2-text-secondary)]">{written.description}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Status Messages */}
                      {hasProcessedData && (
                        <div className="mb-4">
                          <div className="p-3 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 rounded-lg">
                            <p className="text-sm text-green-900 dark:text-green-100">
                              ✓ Ready for production
                            </p>
                            {/* Show warning if some data wasn't processed */}
                            {session?.execution_summary?.data_sources_accessed?.some((s: any) => s.count > 0) &&
                             itemsDelivered > 0 && itemsDelivered < itemsProcessed && (
                              <div className="flex items-start gap-2 mt-2 p-2 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded">
                                <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                                <p className="text-sm text-yellow-900 dark:text-yellow-100">
                                  Found {itemsProcessed} items but only processed {itemsDelivered}. Some items may be empty (like emails with no attachments). Test with complete data.
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {hadNoDataToProcess && (
                        <div className="mb-4">
                          <div className="p-3 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                              <div>
                                <p className="text-sm text-yellow-900 dark:text-yellow-100 font-medium mb-1">
                                  No data found
                                </p>
                                <p className="text-sm text-yellow-900 dark:text-yellow-100">
                                  Your workflow ran successfully but found no data to process. Check your filters or data source.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Case 3: No session data available - Compact */}
                      {!hasProcessedData && !hadNoDataToProcess && (
                        <div className="mb-4 p-3 bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] rounded-lg">
                          <p className="text-xs text-[var(--v2-text-secondary)]">
                            Your workflow completed the test without any issues and is ready for production.
                          </p>
                        </div>
                      )}

                      {/* Approve for Production Button - Compact */}
                      {onApproveForProduction && !agent.production_ready && (
                        <button
                          onClick={onApproveForProduction}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-[var(--v2-success)] text-white hover:opacity-90 transition-opacity font-semibold text-sm shadow-sm rounded-lg"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          Approve for Production
                        </button>
                      )}

                      {/* Production Ready Badge - Compact */}
                      {agent.production_ready && (
                        <div className="flex items-center justify-center gap-2 px-3 py-2 bg-[var(--v2-success)]/10 border border-[var(--v2-success)]/20 rounded-lg">
                          <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                          <span className="text-xs font-semibold text-[var(--v2-text-primary)]">
                            Production Ready
                          </span>
                        </div>
                      )}
                    </div>
                  )
                })()
              ) : isRunning ? (
                // During test
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-12 h-12 border-4 border-[var(--v2-primary)] border-t-transparent rounded-full animate-spin mb-4"></div>
                  <p className="text-sm text-[var(--v2-text-secondary)]">
                    Looking for issues...
                  </p>
                </div>
              ) : (
                // Show issues separated by type
                <div className="space-y-6">
                  {/* Critical Issues Section */}
                  {criticalIssues.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-[var(--v2-border)]">
                        <AlertCircle className="w-4 h-4 text-[var(--v2-error)]" />
                        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                          Critical Issues ({criticalIssues.length})
                        </h3>
                      </div>
                      {criticalIssues.map((issue) => {
                        let isFixed = false
                        let fixDescription = ''

                        if (issue.category === 'parameter_error') {
                          const paramValue = fixes.parameters?.[issue.id]
                          isFixed = paramValue !== undefined && paramValue !== ''
                          if (isFixed) fixDescription = `Set to: ${paramValue}`
                        } else if (issue.category === 'logic_error') {
                          isFixed = fixes.logicFixes?.[issue.id]?.selectedOption !== undefined
                          if (isFixed && fixes.logicFixes) {
                            fixDescription = fixes.logicFixes[issue.id].selectedOption === 'auto_fix' ? 'Will be fixed' : 'Left as is'
                          }
                        }

                        return (
                          <Card key={issue.id} className={`border-[var(--v2-error)]/20 !p-2.5 ${
                            isFixed ? 'bg-[var(--v2-success)]/5 border-[var(--v2-success)]/20' : 'bg-[var(--v2-error)]/5'
                          }`}>
                            <div className="flex items-start gap-2">
                              {isFixed ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--v2-success)] mt-0.5 flex-shrink-0" />
                              ) : (
                                <AlertCircle className="w-3.5 h-3.5 text-[var(--v2-error)] mt-0.5 flex-shrink-0" />
                              )}
                              <div className="flex-1">
                                <h4 className={`text-xs font-semibold mb-0.5 ${
                                  isFixed ? 'text-[var(--v2-success)] line-through' : 'text-[var(--v2-text-primary)]'
                                }`}>
                                  {issue.title}
                                </h4>
                                <p className="text-xs text-[var(--v2-text-secondary)] leading-snug">
                                  {isFixed ? fixDescription : issue.message}
                                </p>
                              </div>
                            </div>
                          </Card>
                        )
                      })}
                    </div>
                  )}

                  {/* Improvements Section */}
                  {improvements.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-[var(--v2-border)]">
                        <Lock className="w-4 h-4 text-[var(--v2-warning)]" />
                        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                          Hardcoded Values ({improvements.length})
                        </h3>
                      </div>
                      {improvements.map((issue) => {
                        const isFixed = fixes.parameterizations?.[issue.id]?.approved !== undefined
                        return (
                          <Card key={issue.id} className={`border-[var(--v2-warning)]/20 !p-2.5 ${
                            isFixed ? 'bg-[var(--v2-success)]/5 border-[var(--v2-success)]/20' : 'bg-[var(--v2-warning)]/5'
                          }`}>
                            <div className="flex items-start gap-2">
                              {isFixed ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--v2-success)] mt-0.5 flex-shrink-0" />
                              ) : (
                                <Lock className="w-3.5 h-3.5 text-[var(--v2-warning)] mt-0.5 flex-shrink-0" />
                              )}
                              <div className="flex-1">
                                <h4 className={`text-xs font-semibold mb-0.5 ${
                                  isFixed ? 'text-[var(--v2-success)] line-through' : 'text-[var(--v2-text-primary)]'
                                }`}>
                                  {issue.title}
                                </h4>
                                <p className="text-xs text-[var(--v2-text-secondary)] leading-snug">
                                  {isFixed && fixes.parameterizations ? (
                                    fixes.parameterizations[issue.id].approved
                                      ? 'Made flexible'
                                      : 'Kept fixed'
                                  ) : (
                                    issue.message
                                  )}
                                </p>
                              </div>
                            </div>
                          </Card>
                        )
                      })}
                    </div>
                  )}

                  {/* Auto-fixed issues (if any) */}
                  {totalIssues > 0 && criticalIssues.length === 0 && improvements.length === 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-[var(--v2-success)]/20">
                        <CheckCircle2 className="w-4 h-4 text-[var(--v2-success)]" />
                        <h3 className="text-sm font-semibold text-[var(--v2-text-primary)]">
                          Auto-Fixed ({totalIssues})
                        </h3>
                      </div>
                      <div className="p-4 bg-[var(--v2-success)]/5 border border-[var(--v2-success)]/20 rounded-lg">
                        <p className="text-xs text-[var(--v2-text-secondary)]">
                          All issues were automatically fixed. No action needed.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

/**
 * IssueFixingCard - Interactive card for fixing an issue in chat
 */
interface IssueFixingCardProps {
  issue: CollectedIssue
  issueNumber: number
  totalIssues: number
  onFix: (fix: any) => void
}

function IssueFixingCard({ issue, issueNumber, totalIssues, onFix }: IssueFixingCardProps) {
  const [inputValue, setInputValue] = useState('')
  const [selectedChoice, setSelectedChoice] = useState<boolean | string | null>(null)

  const handleSubmit = () => {
    if (issue.category === 'parameter_error') {
      if (inputValue.trim()) {
        onFix({ value: inputValue.trim() })
      }
    } else if (issue.category === 'hardcode_detected') {
      if (selectedChoice !== null) {
        const paramName = issue.suggestedFix?.action?.paramName || 'value'
        const defaultValue = issue.suggestedFix?.action?.defaultValue || ''
        onFix({
          approved: selectedChoice === true,
          paramName,
          defaultValue
        })
      }
    } else if (issue.category === 'logic_error') {
      if (selectedChoice !== null) {
        const issueType = (issue.suggestedFix as any)?.type || 'duplicate_data_routing'
        onFix({
          selectedOption: selectedChoice,
          userInput: selectedChoice === 'auto_fix' ? { issueType } : {}
        })
      }
    }
  }

  const isComplete =
    (issue.category === 'parameter_error' && inputValue.trim() !== '') ||
    (issue.category === 'hardcode_detected' && selectedChoice !== null) ||
    (issue.category === 'logic_error' && selectedChoice !== null)

  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-[var(--v2-primary)]/10 flex items-center justify-center flex-shrink-0">
        <Bot className="w-4 h-4 text-[var(--v2-primary)]" />
      </div>
      <div className="flex-1 space-y-3">
        {/* Progress indicator */}
        <div className="px-3 py-1.5 bg-[var(--v2-surface)] border border-[var(--v2-border)] rounded-full inline-block">
          <p className="text-xs font-medium text-[var(--v2-text-primary)]">
            Issue {issueNumber + 1} of {totalIssues}
          </p>
        </div>

        {/* Issue card */}
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4">
          {issue.category === 'parameter_error' && (
            <ParameterFixCard
              issue={issue}
              value={inputValue}
              onChange={setInputValue}
            />
          )}

          {issue.category === 'hardcode_detected' && (
            <HardcodeFixCard
              issue={issue}
              selectedChoice={selectedChoice as boolean | null}
              onChange={setSelectedChoice}
            />
          )}

          {issue.category === 'logic_error' && (
            <LogicFixCard
              issue={issue}
              selectedChoice={selectedChoice as string | null}
              onChange={setSelectedChoice}
            />
          )}

          {/* Submit button */}
          <button
            onClick={handleSubmit}
            disabled={!isComplete}
            className="mt-4 w-full px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity rounded-lg font-medium text-sm"
          >
            Continue
          </button>
        </Card>
      </div>
    </div>
  )
}

/**
 * ParameterFixCard - Simple input for missing parameters with plugin dropdown support
 */
function ParameterFixCard({
  issue,
  value,
  onChange
}: {
  issue: CollectedIssue
  value: string
  onChange: (value: string) => void
}) {
  const paramName = issue.suggestedFix?.action?.parameterName || 'value'
  const stepName = issue.affectedSteps[0]?.friendlyName || 'Unknown step'
  const stepPlugin = issue.suggestedFix?.action?.stepPlugin
  const stepAction = issue.suggestedFix?.action?.stepAction
  const stepConfig = issue.suggestedFix?.action?.stepConfig

  const friendlyParamName = paramName
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l: string) => l.toUpperCase())

  // Check if we can use plugin dropdown (need plugin + action metadata)
  const canUseDropdown = stepPlugin && stepAction

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {friendlyParamName}
        </h4>
        <p className="text-xs text-[var(--v2-text-secondary)]">
          In: {stepName}
        </p>
      </div>

      <p className="text-sm text-[var(--v2-text-secondary)]">
        {issue.message}
      </p>

      {canUseDropdown ? (
        <DynamicSelectField
          plugin={stepPlugin}
          action={stepAction}
          parameter={paramName}
          value={value}
          onChange={(newValue) => {
            console.log('[ParameterFixCard] DynamicSelectField onChange:', newValue)
            onChange(newValue)
          }}
          placeholder={`Select ${friendlyParamName.toLowerCase()}...`}
          dependentValues={stepConfig || {}}
          style={{ borderRadius: '8px' }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${friendlyParamName.toLowerCase()}...`}
          className="w-full px-3 py-2.5 text-sm rounded-lg border-2 border-[var(--v2-border)] bg-[var(--v2-surface)] text-[var(--v2-text-primary)] focus:outline-none focus:border-[var(--v2-primary)] transition-colors"
          autoFocus
        />
      )}
    </div>
  )
}

/**
 * HardcodeFixCard - Yes/No choice for parameterization
 */
function HardcodeFixCard({
  issue,
  selectedChoice,
  onChange
}: {
  issue: CollectedIssue
  selectedChoice: boolean | null
  onChange: (choice: boolean) => void
}) {
  const hardcodedValue = issue.suggestedFix?.action?.hardcodedValue || issue.technicalDetails
  const stepName = issue.affectedSteps[0]?.friendlyName || 'Unknown step'

  const displayValue = hardcodedValue.length > 60
    ? hardcodedValue.substring(0, 60) + '...'
    : hardcodedValue

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-[var(--v2-text-primary)]">
          {stepName}
        </h4>
        <p className="text-xs text-[var(--v2-text-secondary)]">
          Fixed Value Setting
        </p>
      </div>

      <p className="text-sm font-medium text-[var(--v2-text-primary)]">
        Should users be able to choose their own value?
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onChange(true)}
          className={`p-4 rounded-xl border-2 transition-all shadow-sm ${
            selectedChoice === true
              ? 'border-[var(--v2-success)] bg-[var(--v2-success)]/10'
              : 'border-[var(--v2-border)] bg-[var(--v2-surface)] hover:bg-[var(--v2-success)]/5'
          }`}
        >
          <div className="text-center space-y-2">
            <div className="w-10 h-10 mx-auto rounded-full bg-[var(--v2-success)]/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-[var(--v2-success)]" />
            </div>
            <p className="font-semibold text-sm text-[var(--v2-text-primary)]">Yes, flexible</p>
            <p className="text-xs text-[var(--v2-text-secondary)]">Let users customize</p>
          </div>
        </button>

        <button
          onClick={() => onChange(false)}
          className={`p-4 rounded-xl border-2 transition-all shadow-sm ${
            selectedChoice === false
              ? 'border-[var(--v2-text-secondary)] bg-[var(--v2-surface-hover)]'
              : 'border-[var(--v2-border)] bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)]'
          }`}
        >
          <div className="text-center space-y-2">
            <div className="w-10 h-10 mx-auto rounded-full bg-[var(--v2-text-secondary)]/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-[var(--v2-text-secondary)]" />
            </div>
            <p className="font-semibold text-sm text-[var(--v2-text-primary)]">No, keep fixed</p>
            <p className="text-xs text-[var(--v2-text-secondary)]">Use this value always</p>
          </div>
        </button>
      </div>
    </div>
  )
}

/**
 * LogicFixCard - Yes/No choice for logic issues
 */
function LogicFixCard({
  issue,
  selectedChoice,
  onChange
}: {
  issue: CollectedIssue
  selectedChoice: string | null
  onChange: (choice: string) => void
}) {
  const issueType = (issue.suggestedFix as any)?.type || 'duplicate_data_routing'

  return (
    <div className="space-y-4">
      <h4 className="text-sm font-semibold text-[var(--v2-text-primary)]">
        {issue.title}
      </h4>

      <p className="text-sm text-[var(--v2-text-secondary)]">
        {issue.message}
      </p>

      <p className="text-sm font-medium text-[var(--v2-text-primary)]">
        {issueType === 'partial_data_loss' || issueType === 'missing_destination'
          ? 'Is this intentional?'
          : 'Should we fix this automatically?'}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onChange('auto_fix')}
          className={`p-4 rounded-xl border-2 transition-all ${
            selectedChoice === 'auto_fix'
              ? 'border-[var(--v2-primary)] bg-[var(--v2-primary)]/10'
              : 'border-[var(--v2-border)] hover:border-[var(--v2-primary)]'
          }`}
        >
          <div className="text-center space-y-1.5">
            <div className="text-2xl">✓</div>
            <p className="font-semibold text-sm text-[var(--v2-text-primary)]">
              {issueType === 'partial_data_loss' || issueType === 'missing_destination' ? 'No, fix it' : 'Yes, fix it'}
            </p>
          </div>
        </button>

        <button
          onClick={() => onChange('leave_as_is')}
          className={`p-4 rounded-xl border-2 transition-all ${
            selectedChoice === 'leave_as_is'
              ? 'border-[var(--v2-text-secondary)] bg-[var(--v2-surface-hover)]'
              : 'border-[var(--v2-border)] hover:border-[var(--v2-text-secondary)]'
          }`}
        >
          <div className="text-center space-y-1.5">
            <div className="text-2xl">→</div>
            <p className="font-semibold text-sm text-[var(--v2-text-primary)]">
              {issueType === 'partial_data_loss' || issueType === 'missing_destination' ? 'Yes, intentional' : 'No, leave it'}
            </p>
          </div>
        </button>
      </div>
    </div>
  )
}

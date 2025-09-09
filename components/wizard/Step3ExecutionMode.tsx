'use client'

import React, { useState, useEffect } from 'react'
import {
  MessageSquare,
  Sparkles,
  Star,
  Brain,
  X,
  Target,
  Clock,
  Zap,
  Play,
  Calendar,
  Webhook,
  Info,
  CheckCircle,
  AlertCircle,
  Lightbulb,
  Code,
  Database,
  Plus
} from 'lucide-react'

// AI Assistant Messages for each execution mode
const AI_ASSISTANCE_MESSAGES = {
  on_demand: [
    "On-Demand mode gives you complete manual control - perfect for testing and one-off tasks!",
    "This mode is ideal when you want to run your agent only when YOU decide it's needed.",
    "Great for debugging, testing new configurations, or handling unpredictable workflows.",
    "No scheduling needed - just click and run whenever you want!"
  ],
  scheduled: [
    "Scheduled mode automates your agent to run at specific times - set it and forget it!",
    "Use cron expressions to set precise timing. Think of it like setting an alarm clock for your agent.",
    "Perfect for daily reports, weekly summaries, monthly data processing, or any recurring task.",
    "Common examples: '0 9 * * *' (daily at 9 AM), '0 0 * * 1' (weekly on Monday), '0 8 * * 1-5' (weekdays at 8 AM)"
  ],
  triggered: [
    "Triggered mode makes your agent reactive - it automatically responds to real-world events!",
    "Your agent 'listens' for specific conditions and springs into action when they're met.",
    "Perfect for handling new emails, file uploads, database changes, or API notifications.",
    "Set up JSON conditions to define exactly what events should wake up your agent and get it working."
  ]
}

// Detailed explanations for each mode
const MODE_DETAILS = {
  on_demand: {
    useCases: [
      "Testing and debugging your agent",
      "One-time data analysis tasks",
      "Manual document processing",
      "Ad-hoc report generation",
      "Troubleshooting workflows"
    ],
    pros: [
      "Full control over when agent runs",
      "Perfect for testing and development",
      "No risk of unexpected executions",
      "Easy to monitor and debug"
    ],
    cons: [
      "Requires manual intervention",
      "Not suitable for regular tasks",
      "Can be forgotten or delayed"
    ],
    examples: [
      "Process this specific document now",
      "Generate a report for this quarter",
      "Analyze today's customer feedback"
    ]
  },
  scheduled: {
    useCases: [
      "Daily/weekly/monthly reports",
      "Regular data backups",
      "Recurring email summaries",
      "Periodic system health checks",
      "Automated content updates"
    ],
    pros: [
      "Fully automated - no manual work",
      "Consistent timing and execution",
      "Perfect for regular workflows",
      "Reliable and predictable"
    ],
    cons: [
      "Runs whether needed or not",
      "May process empty or stale data",
      "Fixed timing may not be optimal"
    ],
    examples: [
      "Every Monday at 9 AM: '0 9 * * 1'",
      "Daily at 6 PM: '0 18 * * *'",
      "First day of month: '0 9 1 * *'"
    ]
  },
  triggered: {
    useCases: [
      "Email processing workflows",
      "File upload handling",
      "Database change responses",
      "API event processing",
      "Real-time notifications"
    ],
    pros: [
      "Responds instantly to events",
      "Only runs when actually needed",
      "Highly efficient and responsive",
      "Perfect for event-driven workflows"
    ],
    cons: [
      "More complex to set up",
      "Requires proper event configuration",
      "May miss events if conditions are wrong"
    ],
    examples: [
      '{"source": "gmail", "subject_contains": "urgent"}',
      '{"file_type": "pdf", "folder": "invoices"}',
      '{"webhook_source": "salesforce", "event": "lead_created"}'
    ]
  }
}

// Cron expression examples
const CRON_EXAMPLES = [
  { expression: "0 9 * * *", description: "Every day at 9:00 AM", use: "Daily morning reports" },
  { expression: "0 18 * * 1-5", description: "Weekdays at 6:00 PM", use: "End-of-workday summaries" },
  { expression: "0 0 * * 1", description: "Every Monday at midnight", use: "Weekly data processing" },
  { expression: "0 9 1 * *", description: "First day of month at 9 AM", use: "Monthly reports" },
  { expression: "*/15 * * * *", description: "Every 15 minutes", use: "Frequent monitoring" },
  { expression: "0 8,12,17 * * 1-5", description: "8 AM, 12 PM, 5 PM on weekdays", use: "Three times daily updates" }
]

const Step3ExecutionMode = ({ data, onUpdate }) => {
  const { mode = "on_demand", schedule_cron = "", trigger_conditions = "" } = data

  // AI Assistant state
  const [assistantActive, setAssistantActive] = useState(false)
  const [assistantMode, setAssistantMode] = useState('idle')
  const [showOverlay, setShowOverlay] = useState(false)
  const [activeElement, setActiveElement] = useState(null)
  const [assistantMessages, setAssistantMessages] = useState([])
  const [showExplanation, setShowExplanation] = useState(false)
  const [showCronExamples, setShowCronExamples] = useState(false)
  const [showTriggerExamples, setShowTriggerExamples] = useState(false)

  const update = (field, value) => {
    onUpdate({ [field]: value })
  }

  // AI Assistant Functions
  const addAssistantMessage = (message) => {
    setAssistantMessages(prev => [...prev.slice(-2), message])
  }

  const handleModeSelection = (selectedMode) => {
    update("mode", selectedMode)
    
    // AI Assistant feedback for mode selection
    if (selectedMode && AI_ASSISTANCE_MESSAGES[selectedMode]) {
      setAssistantMode('celebrating')
      addAssistantMessage(AI_ASSISTANCE_MESSAGES[selectedMode][0])
      
      setTimeout(() => {
        if (AI_ASSISTANCE_MESSAGES[selectedMode][1]) {
          addAssistantMessage(AI_ASSISTANCE_MESSAGES[selectedMode][1])
        }
        setAssistantMode('suggesting')
      }, 2000)

      setTimeout(() => {
        if (AI_ASSISTANCE_MESSAGES[selectedMode][2]) {
          addAssistantMessage(AI_ASSISTANCE_MESSAGES[selectedMode][2])
        }
        setAssistantMode('idle')
      }, 4000)
    }
  }

  const handleModeFocus = () => {
    setActiveElement('mode')
    setAssistantActive(true)
    setAssistantMode('suggesting')
    addAssistantMessage("Choose how your agent will run! Each mode has different use cases and benefits.")
  }

  const handleConfigFocus = (configType) => {
    setActiveElement('config')
    setAssistantActive(true)
    setAssistantMode('suggesting')
    
    if (configType === 'schedule') {
      addAssistantMessage("Enter a cron expression! Format: 'minute hour day month weekday'. Try '0 9 * * *' for daily at 9 AM.")
    } else if (configType === 'trigger') {
      addAssistantMessage("Define your trigger conditions in JSON format. Be specific about what events should start your agent!")
    }
  }

  const activateOverlayMode = () => {
    setShowOverlay(true)
    setAssistantMode('thinking')
    addAssistantMessage("Focus mode activated! Let me guide you through choosing the right execution mode.")
  }

  const insertCronExample = (expression) => {
    update("schedule_cron", expression)
    setShowCronExamples(false)
    if (assistantActive) {
      addAssistantMessage(`Perfect! "${expression}" is a solid choice for scheduled execution.`)
    }
  }

  const insertTriggerExample = (condition) => {
    update("trigger_conditions", condition)
    setShowTriggerExamples(false)
    if (assistantActive) {
      addAssistantMessage("Great trigger condition! Your agent will respond to those specific events.")
    }
  }

  // AI Assistant Component
  const AIAssistant = () => {
    if (!assistantActive) return null

    return (
      <div className="fixed bottom-6 right-6 z-50">
        <div className="relative">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 cursor-pointer group ${
            assistantMode === 'celebrating' 
              ? 'bg-gradient-to-r from-green-400 via-blue-500 to-purple-600 animate-spin' 
              : assistantMode === 'thinking'
              ? 'bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 animate-pulse'
              : 'bg-gradient-to-r from-green-500 via-teal-500 to-blue-600 hover:scale-110'
          }`}
          onClick={() => activateOverlayMode()}
          >
            {assistantMode === 'celebrating' ? (
              <Star className="h-8 w-8 text-white animate-bounce" />
            ) : assistantMode === 'thinking' ? (
              <Brain className="h-8 w-8 text-white animate-pulse" />
            ) : (
              <MessageSquare className="h-8 w-8 text-white group-hover:rotate-12 transition-transform" />
            )}
          </div>

          {/* Floating particles */}
          <div className="absolute inset-0 animate-spin">
            <div className="absolute -top-2 -right-2 w-3 h-3 bg-yellow-400 rounded-full animate-ping"></div>
            <div className="absolute -bottom-2 -left-2 w-2 h-2 bg-pink-400 rounded-full animate-bounce"></div>
            <div className="absolute top-0 -left-3 w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
          </div>

          {/* Message Bubbles */}
          {assistantMessages.length > 0 && (
            <div className="fixed bottom-6 right-24 space-y-3 z-40" style={{ width: '350px' }}>
              {assistantMessages.map((message, index) => (
                <div 
                  key={index}
                  className="bg-gradient-to-r from-white to-green-50 border-2 border-green-200 rounded-2xl shadow-xl animate-in slide-in-from-right-2 duration-300"
                  style={{ 
                    animationDelay: `${index * 100}ms`,
                    width: '350px',
                    minWidth: '350px',
                    maxWidth: '350px',
                    padding: '20px 28px',
                    boxSizing: 'border-box'
                  }}
                >
                  <p 
                    className="text-base font-semibold text-gray-800 leading-relaxed"
                    style={{
                      wordWrap: 'break-word',
                      overflowWrap: 'break-word',
                      whiteSpace: 'normal',
                      width: '100%'
                    }}
                  >
                    {message}
                  </p>
                  <div 
                    className="absolute bottom-0 left-8"
                    style={{
                      width: '0',
                      height: '0',
                      borderLeft: '6px solid transparent',
                      borderRight: '6px solid transparent',
                      borderTop: '6px solid white'
                    }}
                  ></div>
                </div>
              ))}
            </div>
          )}

          {/* Dismiss button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              setAssistantActive(false)
              setShowOverlay(false)
              setAssistantMessages([])
            }}
            className="absolute -top-2 -left-2 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center text-white hover:bg-red-600 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
    )
  }

  // Overlay System
  const OverlaySystem = () => {
    if (!showOverlay) return null

    return (
      <div className="fixed inset-0 z-40 pointer-events-none">
        <div className="absolute inset-0 bg-black bg-opacity-30 backdrop-blur-sm"></div>
        
        {/* Floating help cards */}
        <div className="absolute top-20 right-20 space-y-4 pointer-events-auto">
          <div className="bg-gradient-to-r from-green-500 to-teal-500 text-white p-5 rounded-2xl shadow-2xl max-w-sm animate-float">
            <div className="flex items-center gap-2 mb-3">
              <Target className="h-6 w-6" />
              <span className="font-semibold text-lg">Execution Modes</span>
            </div>
            <p className="text-base leading-relaxed mb-3">Choose when your agent runs</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  handleModeSelection('on_demand')
                  setShowOverlay(false)
                }}
                className="block w-full text-left bg-white bg-opacity-20 hover:bg-opacity-30 px-3 py-2 rounded text-sm font-medium transition-colors"
              >
                Manual Control
              </button>
              <button
                onClick={() => {
                  handleModeSelection('scheduled')
                  setShowOverlay(false)
                }}
                className="block w-full text-left bg-white bg-opacity-20 hover:bg-opacity-30 px-3 py-2 rounded text-sm font-medium transition-colors"
              >
                Automatic Schedule
              </button>
            </div>
          </div>

          {mode !== 'on_demand' && (
            <div className="bg-gradient-to-r from-blue-500 to-purple-500 text-white p-5 rounded-2xl shadow-2xl max-w-sm animate-float" style={{ animationDelay: '0.5s' }}>
              <div className="flex items-center gap-2 mb-3">
                <Clock className="h-6 w-6" />
                <span className="font-semibold text-lg">Configuration</span>
              </div>
              <p className="text-base leading-relaxed mb-3">Set up your {mode} settings</p>
              {mode === 'scheduled' && (
                <button
                  onClick={() => {
                    document.querySelector('input[placeholder*="cron"]')?.focus()
                    setShowOverlay(false)
                  }}
                  className="block w-full text-left bg-white bg-opacity-20 hover:bg-opacity-30 px-3 py-2 rounded text-sm font-medium transition-colors"
                >
                  Configure Schedule
                </button>
              )}
            </div>
          )}
        </div>

        <button
          onClick={() => setShowOverlay(false)}
          className="absolute top-6 right-6 bg-white bg-opacity-20 backdrop-blur-sm text-white px-4 py-2 rounded-full hover:bg-opacity-30 transition-colors pointer-events-auto"
        >
          Exit Focus Mode
        </button>
      </div>
    )
  }

  const executionModes = [
    { 
      key: "on_demand", 
      label: "On-Demand", 
      description: "Run manually anytime",
      icon: Play,
      color: 'from-blue-500 to-cyan-600',
      bgColor: 'bg-blue-50',
      borderColor: 'border-blue-500'
    },
    { 
      key: "scheduled", 
      label: "Scheduled", 
      description: "Run automatically at a set time",
      icon: Clock,
      color: 'from-green-500 to-emerald-600',
      bgColor: 'bg-green-50',
      borderColor: 'border-green-500'
    },
    { 
      key: "triggered", 
      label: "Triggered", 
      description: "Run when a specific event occurs",
      icon: Zap,
      color: 'from-purple-500 to-indigo-600',
      bgColor: 'bg-purple-50',
      borderColor: 'border-purple-500'
    },
  ]

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Execution Mode</h2>
          <p className="text-gray-600 mt-1">Choose when and how your agent will run</p>
        </div>
        
        {/* AI Assistant Activation & Explanation Toggle */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowExplanation(!showExplanation)}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-4 py-2 rounded-full hover:from-purple-700 hover:to-indigo-700 transition-all transform hover:scale-105 shadow-lg text-sm"
          >
            <Info className="h-4 w-4" />
            {showExplanation ? 'Hide Details' : 'Show Details'}
          </button>
          
          {!assistantActive && (
            <button
              onClick={() => setAssistantActive(true)}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-green-600 to-blue-600 text-white px-4 py-2 rounded-full hover:from-green-700 hover:to-blue-700 transition-all transform hover:scale-105 shadow-lg text-sm"
            >
              <MessageSquare className="h-4 w-4" />
              Activate Mode Help
              <Sparkles className="h-4 w-4 animate-pulse" />
            </button>
          )}
        </div>
      </div>

      {/* Detailed Explanation Panel */}
      {showExplanation && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full flex items-center justify-center">
              <Lightbulb className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="text-xl font-semibold text-gray-900">Understanding Execution Modes</h3>
              <p className="text-gray-600">Choose the mode that best fits your workflow needs</p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {executionModes.map((execMode) => {
              const details = MODE_DETAILS[execMode.key]
              const IconComponent = execMode.icon
              
              return (
                <div key={execMode.key} className="bg-white rounded-xl border-2 border-gray-200 p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className={`p-2 rounded-lg bg-gradient-to-r ${execMode.color}`}>
                      <IconComponent className="h-5 w-5 text-white" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">{execMode.label}</h4>
                      <p className="text-sm text-gray-500">{execMode.description}</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Perfect For:</h5>
                      <ul className="space-y-1">
                        {details.useCases.slice(0, 3).map((useCase, index) => (
                          <li key={index} className="text-xs text-gray-600 flex items-center gap-2">
                            <CheckCircle className="h-3 w-3 text-green-500" />
                            {useCase}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Advantages:</h5>
                      <ul className="space-y-1">
                        {details.pros.slice(0, 2).map((pro, index) => (
                          <li key={index} className="text-xs text-gray-600 flex items-center gap-2">
                            <div className="w-2 h-2 bg-green-400 rounded-full" />
                            {pro}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <h5 className="text-sm font-semibold text-gray-700 mb-2">Consider:</h5>
                      <ul className="space-y-1">
                        {details.cons.slice(0, 2).map((con, index) => (
                          <li key={index} className="text-xs text-gray-600 flex items-center gap-2">
                            <div className="w-2 h-2 bg-orange-400 rounded-full" />
                            {con}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Mode Selection */}
      <div className="grid grid-cols-3 gap-4">
        {executionModes.map((m) => {
          const IconComponent = m.icon
          const isSelected = mode === m.key
          
          return (
            <div
              key={m.key}
              onClick={() => handleModeSelection(m.key)}
              onFocus={handleModeFocus}
              className={`p-6 rounded-xl border-2 shadow-sm cursor-pointer transition-all duration-200 hover:scale-[1.02] relative ${
                isSelected 
                  ? `${m.borderColor} ${m.bgColor} shadow-lg` 
                  : "border-gray-300 hover:border-gray-400 hover:shadow-md"
              }`}
            >
              {isSelected && (
                <div className="absolute top-3 right-3">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                </div>
              )}
              
              <div className="flex items-start space-x-4">
                <div className={`p-3 rounded-lg bg-gradient-to-r ${m.color} shadow-md`}>
                  <IconComponent className="h-6 w-6 text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-gray-900 text-lg">{m.label}</h3>
                  <p className="text-sm text-gray-500 mt-1">{m.description}</p>
                  
                  {isSelected && MODE_DETAILS[m.key] && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs text-gray-600">
                        <strong>Example use:</strong> {MODE_DETAILS[m.key].useCases[0]}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Configuration Section for Scheduled Mode */}
      {mode === "scheduled" && (
        <div className="bg-green-50 border-2 border-green-200 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Calendar className="h-6 w-6 text-green-600" />
            <h3 className="text-xl font-semibold text-gray-900">Schedule Configuration</h3>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Cron Schedule Expression</label>
                <button
                  onClick={() => setShowCronExamples(!showCronExamples)}
                  className="text-sm text-green-600 hover:text-green-800 flex items-center gap-1"
                >
                  <Code className="h-4 w-4" />
                  {showCronExamples ? 'Hide Examples' : 'Show Examples'}
                </button>
              </div>
              
              <input
                type="text"
                value={schedule_cron}
                onChange={(e) => update("schedule_cron", e.target.value)}
                onFocus={() => handleConfigFocus('schedule')}
                className="w-full p-3 border-2 border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 font-mono"
                placeholder="0 9 * * *"
              />
              
              <div className="mt-2 bg-white rounded-lg p-3 border border-green-200">
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Format:</strong> minute hour day month weekday (use * for "any")
                </p>
                <div className="grid grid-cols-5 gap-2 text-xs">
                  <div className="text-center">
                    <div className="font-semibold text-gray-700">Minute</div>
                    <div className="text-gray-500">0-59</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-gray-700">Hour</div>
                    <div className="text-gray-500">0-23</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-gray-700">Day</div>
                    <div className="text-gray-500">1-31</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-gray-700">Month</div>
                    <div className="text-gray-500">1-12</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-gray-700">Weekday</div>
                    <div className="text-gray-500">0-7</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Cron Examples */}
            {showCronExamples && (
              <div className="bg-white border-2 border-green-200 rounded-xl p-4">
                <h4 className="font-semibold text-gray-800 mb-3">Common Schedule Examples</h4>
                <div className="grid gap-3">
                  {CRON_EXAMPLES.map((example, index) => (
                    <div
                      key={index}
                      onClick={() => insertCronExample(example.expression)}
                      className="flex items-center justify-between p-3 bg-gray-50 hover:bg-green-50 rounded-lg cursor-pointer transition-colors border hover:border-green-300"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3">
                          <code className="bg-gray-200 px-2 py-1 rounded font-mono text-sm">
                            {example.expression}
                          </code>
                          <span className="text-sm text-gray-700">{example.description}</span>
                        </div>
                        <div className="text-xs text-gray-500 mt-1">{example.use}</div>
                      </div>
                      <button className="text-green-600 hover:text-green-800">
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Configuration Section for Triggered Mode */}
      {mode === "triggered" && (
        <div className="bg-purple-50 border-2 border-purple-200 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <Webhook className="h-6 w-6 text-purple-600" />
            <h3 className="text-xl font-semibold text-gray-900">Trigger Configuration</h3>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Trigger Conditions (JSON)</label>
                <button
                  onClick={() => setShowTriggerExamples(!showTriggerExamples)}
                  className="text-sm text-purple-600 hover:text-purple-800 flex items-center gap-1"
                >
                  <Database className="h-4 w-4" />
                  {showTriggerExamples ? 'Hide Examples' : 'Show Examples'}
                </button>
              </div>
              
              <textarea
                rows={4}
                value={trigger_conditions}
                onChange={(e) => update("trigger_conditions", e.target.value)}
                onFocus={() => handleConfigFocus('trigger')}
                className="w-full p-3 border-2 border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all duration-200 font-mono"
                placeholder='{"source": "gmail", "subject_contains": "urgent"}'
              />
              
              <div className="mt-2 bg-white rounded-lg p-3 border border-purple-200">
                <p className="text-sm text-gray-600">
                  <strong>Define conditions in JSON format.</strong> Your agent will automatically run when these conditions are met.
                  Common trigger sources: email, file uploads, webhooks, database changes, API events.
                </p>
              </div>
            </div>

            {/* Trigger Examples */}
            {showTriggerExamples && (
              <div className="bg-white border-2 border-purple-200 rounded-xl p-4">
                <h4 className="font-semibold text-gray-800 mb-3">Trigger Condition Examples</h4>
                <div className="grid gap-3">
                  {[
                    {
                      condition: '{"source": "gmail", "subject_contains": "urgent", "from_domain": "company.com"}',
                      description: "Trigger on urgent emails from company domain",
                      use: "Priority email processing"
                    },
                    {
                      condition: '{"source": "file_upload", "folder": "invoices", "file_type": "pdf"}',
                      description: "Trigger when PDF uploaded to invoices folder",
                      use: "Automatic invoice processing"
                    },
                    {
                      condition: '{"webhook_source": "salesforce", "event": "lead_created", "priority": "high"}',
                      description: "Trigger on high-priority lead creation",
                      use: "Immediate lead follow-up"
                    },
                    {
                      condition: '{"database": "users", "event": "new_signup", "plan": "premium"}',
                      description: "Trigger on premium user signup",
                      use: "Premium onboarding workflow"
                    }
                  ].map((example, index) => (
                    <div
                      key={index}
                      onClick={() => insertTriggerExample(example.condition)}
                      className="p-3 bg-gray-50 hover:bg-purple-50 rounded-lg cursor-pointer transition-colors border hover:border-purple-300"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <code className="text-xs bg-gray-200 px-2 py-1 rounded font-mono block mb-2 break-all">
                            {example.condition}
                          </code>
                          <div className="text-sm text-gray-700 mb-1">{example.description}</div>
                          <div className="text-xs text-gray-500">{example.use}</div>
                        </div>
                        <button className="text-purple-600 hover:text-purple-800 ml-2">
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status and Summary */}
      <div className="bg-gray-50 border-2 border-gray-200 rounded-2xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0">
              {mode && (mode === 'on_demand' || 
                (mode === 'scheduled' && schedule_cron.trim()) || 
                (mode === 'triggered' && trigger_conditions.trim())) ? (
                <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                  <CheckCircle className="h-6 w-6 text-white" />
                </div>
              ) : (
                <div className="w-12 h-12 border-2 border-gray-300 rounded-full flex items-center justify-center">
                  <AlertCircle className="h-6 w-6 text-gray-400" />
                </div>
              )}
            </div>
            <div>
              <p className="text-lg font-semibold text-gray-900">
                {mode && (mode === 'on_demand' || 
                  (mode === 'scheduled' && schedule_cron.trim()) || 
                  (mode === 'triggered' && trigger_conditions.trim()))
                  ? 'Execution mode configured!' 
                  : 'Configure execution mode'
                }
              </p>
              <p className="text-gray-600">
                {mode === 'on_demand' && 'Your agent will run manually when you trigger it'}
                {mode === 'scheduled' && schedule_cron.trim() && `Your agent will run on schedule: ${schedule_cron}`}
                {mode === 'triggered' && trigger_conditions.trim() && 'Your agent will respond to specified trigger events'}
                {!mode && 'Choose how and when your agent should execute'}
                {mode === 'scheduled' && !schedule_cron.trim() && 'Enter a cron schedule to complete configuration'}
                {mode === 'triggered' && !trigger_conditions.trim() && 'Define trigger conditions to complete configuration'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* AI Assistant */}
      <AIAssistant />

      {/* Overlay System */}
      <OverlaySystem />

      {/* Custom CSS */}
      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }
        .animate-float {
          animation: float 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  )
}

export default Step3ExecutionMode
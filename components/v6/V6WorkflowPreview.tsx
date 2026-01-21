'use client'

/**
 * V6 Workflow Preview Component
 *
 * Displays the compiled workflow steps in a visual format for user approval
 * before saving as an agent.
 */

import React, { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Database,
  Mail,
  Filter,
  GitBranch,
  Repeat,
  ArrowRight,
  CheckCircle,
  Settings,
  Zap,
  FileText,
  User,
  AlertTriangle
} from 'lucide-react'

// ============================================================================
// Types
// ============================================================================

interface WorkflowStep {
  id: string
  type: 'operation' | 'transform' | 'conditional' | 'scatter_gather' | 'control'
  plugin?: string
  action?: string
  operation?: string
  description?: string
  config?: Record<string, any>
  inputs?: Record<string, any>
  outputs?: Record<string, any>
  scatter?: {
    input: string
    itemVariable: string
    steps: WorkflowStep[]
  }
  branches?: Array<{
    condition: string
    steps: WorkflowStep[]
  }>
}

interface UserDecision {
  id: string
  label: string
  value: string
  type: 'pattern' | 'ambiguity' | 'assumption' | 'parameter'
}

interface V6WorkflowPreviewProps {
  workflowSteps: WorkflowStep[]
  userDecisions?: UserDecision[]
  agentName?: string
  onApprove?: () => void
  onGoBack?: () => void
  onCopyJSON?: () => void
  isLoading?: boolean
}

// ============================================================================
// Helper Components
// ============================================================================

const StepTypeIcon: React.FC<{ type: string; plugin?: string }> = ({ type, plugin }) => {
  const iconClass = "h-5 w-5"

  // Plugin-specific icons
  if (plugin?.includes('sheets') || plugin?.includes('spreadsheet')) {
    return <Database className={`${iconClass} text-green-600`} />
  }
  if (plugin?.includes('mail') || plugin?.includes('email')) {
    return <Mail className={`${iconClass} text-blue-600`} />
  }

  // Type-specific icons
  switch (type) {
    case 'operation':
      return <Zap className={`${iconClass} text-purple-600`} />
    case 'transform':
      return <Filter className={`${iconClass} text-orange-600`} />
    case 'conditional':
      return <GitBranch className={`${iconClass} text-yellow-600`} />
    case 'scatter_gather':
      return <Repeat className={`${iconClass} text-cyan-600`} />
    default:
      return <Settings className={`${iconClass} text-gray-600`} />
  }
}

const StepTypeBadge: React.FC<{ type: string }> = ({ type }) => {
  const colors: Record<string, string> = {
    operation: 'bg-purple-100 text-purple-700',
    transform: 'bg-orange-100 text-orange-700',
    conditional: 'bg-yellow-100 text-yellow-700',
    scatter_gather: 'bg-cyan-100 text-cyan-700',
    control: 'bg-gray-100 text-gray-700'
  }

  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded ${colors[type] || colors.control}`}>
      {type.replace('_', ' ')}
    </span>
  )
}

const PluginBadge: React.FC<{ plugin: string }> = ({ plugin }) => {
  // Format plugin name nicely: "google-sheets" → "Google Sheets"
  const displayName = plugin
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  return (
    <span className="px-2 py-0.5 text-xs bg-indigo-100 text-indigo-700 rounded font-medium">
      {displayName}
    </span>
  )
}

// Nested step card for parallel/scatter sub-steps
const NestedStepCard: React.FC<{
  step: WorkflowStep
  index: number
}> = ({ step, index }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  const getDescription = () => {
    if (step.description) {
      if (step.type === 'operation' && step.plugin) {
        const pluginName = step.plugin.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        return `${step.description} using ${pluginName}`
      }
      return step.description
    }
    if (step.type === 'operation' && step.plugin && step.action) {
      const pluginName = step.plugin.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      return `${step.action.replace(/_/g, ' ')} using ${pluginName}`
    }
    if (step.type === 'transform' && step.operation) {
      return `${step.operation.replace(/_/g, ' ')}`
    }
    return `Sub-step ${index + 1}`
  }

  return (
    <div className="bg-white rounded-lg border border-cyan-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-cyan-50/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-100 flex items-center justify-center">
            <span className="text-xs font-bold text-cyan-600">{index + 1}</span>
          </span>
          <StepTypeIcon type={step.type} plugin={step.plugin} />
          <div className="text-left">
            <span className="font-medium text-gray-800 text-sm">{getDescription()}</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <StepTypeBadge type={step.type} />
              {step.plugin && <PluginBadge plugin={step.plugin} />}
            </div>
          </div>
        </div>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 text-gray-400" />
        )}
      </button>

      {isExpanded && (
        <div className="px-3 py-2 border-t border-cyan-100 bg-cyan-50/30">
          {/* Inputs/Params */}
          {step.inputs && Object.keys(step.inputs).length > 0 && (
            <div className="mb-2">
              <h6 className="text-xs font-semibold text-gray-500 uppercase mb-1">Parameters</h6>
              <div className="space-y-0.5">
                {Object.entries(step.inputs).map(([key, value]) => (
                  <div key={key} className="flex items-start gap-2 text-xs">
                    <span className="text-gray-500 min-w-[80px]">{key}:</span>
                    <span className="text-gray-800 font-mono bg-white px-1.5 py-0.5 rounded text-xs break-all">
                      {typeof value === 'string' ? value : JSON.stringify(value, null, 1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Config */}
          {step.config && Object.keys(step.config).length > 0 && (
            <div>
              <h6 className="text-xs font-semibold text-gray-500 uppercase mb-1">Configuration</h6>
              <pre className="text-xs bg-white p-1.5 rounded border overflow-auto max-h-24">
                {JSON.stringify(step.config, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const StepCard: React.FC<{
  step: WorkflowStep
  index: number
  isLast: boolean
}> = ({ step, index, isLast }) => {
  const [isExpanded, setIsExpanded] = useState(false)

  // Generate human-readable description
  const getDescription = () => {
    // If we have a name/description from the DSL, use it
    if (step.description) {
      // For action types, optionally append "using {plugin}" if plugin exists
      if (step.type === 'operation' && step.plugin) {
        const pluginName = step.plugin.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        return `${step.description} using ${pluginName}`
      }
      return step.description
    }

    // Fallback: generate from action/operation
    if (step.type === 'operation' && step.plugin && step.action) {
      const pluginName = step.plugin.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      return `${step.action.replace(/_/g, ' ')} using ${pluginName}`
    }

    if (step.type === 'transform' && step.operation) {
      return `${step.operation.replace(/_/g, ' ')}`
    }

    if (step.type === 'scatter_gather') {
      return `Process each item in ${step.scatter?.input || 'collection'}`
    }

    return `Step ${index + 1}`
  }

  return (
    <div className="relative">
      {/* Connection line */}
      {!isLast && (
        <div
          className="absolute left-6 top-14 w-0.5 bg-gray-200"
          style={{ height: 'calc(100% - 2rem)' }}
        />
      )}

      <div className="flex items-start gap-3">
        {/* Step number circle */}
        <div className="flex-shrink-0 w-12 h-12 rounded-full bg-white border-2 border-indigo-200 flex items-center justify-center shadow-sm">
          <span className="text-sm font-bold text-indigo-600">{index + 1}</span>
        </div>

        {/* Step content */}
        <div className="flex-1 bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden mb-4">
          {/* Header */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-center gap-3">
              <StepTypeIcon type={step.type} plugin={step.plugin} />
              <div className="text-left">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{getDescription()}</span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <StepTypeBadge type={step.type} />
                  {step.plugin && <PluginBadge plugin={step.plugin} />}
                  {step.action && (
                    <span className="text-xs text-gray-500">{step.action}</span>
                  )}
                </div>
              </div>
            </div>
            {isExpanded ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-400" />
            )}
          </button>

          {/* Expanded details */}
          {isExpanded && (
            <div className="px-4 py-3 border-t border-gray-100 bg-gray-50">
              {/* Inputs */}
              {step.inputs && Object.keys(step.inputs).length > 0 && (
                <div className="mb-3">
                  <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">Inputs</h5>
                  <div className="space-y-1">
                    {Object.entries(step.inputs).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-2 text-sm">
                        <span className="text-gray-500 min-w-[100px]">{key}:</span>
                        <span className="text-gray-800 font-mono text-xs bg-white px-2 py-0.5 rounded">
                          {typeof value === 'string' ? value : JSON.stringify(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Config */}
              {step.config && Object.keys(step.config).length > 0 && (
                <div className="mb-3">
                  <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">Configuration</h5>
                  <pre className="text-xs bg-white p-2 rounded border overflow-auto max-h-32">
                    {JSON.stringify(step.config, null, 2)}
                  </pre>
                </div>
              )}

              {/* Nested steps (parallel/scatter) */}
              {step.scatter?.steps && step.scatter.steps.length > 0 && (
                <div>
                  <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                    {step.scatter.input === 'parallel execution'
                      ? `Parallel Steps (${step.scatter.steps.length} tasks):`
                      : `For each ${step.scatter.itemVariable || 'item'} in ${step.scatter.input}:`
                    }
                  </h5>
                  <div className="pl-2 border-l-2 border-cyan-200 space-y-2">
                    {step.scatter.steps.map((nestedStep, idx) => (
                      <NestedStepCard
                        key={nestedStep.id || idx}
                        step={nestedStep}
                        index={idx}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const DecisionSummary: React.FC<{ decisions: UserDecision[] }> = ({ decisions }) => {
  if (!decisions || decisions.length === 0) return null

  const MAX_LENGTH = 50

  // Truncate text and return both truncated version and whether it was truncated
  const truncateText = (text: string): { display: string; isTruncated: boolean } => {
    if (!text || text.length <= MAX_LENGTH) {
      return { display: text || '', isTruncated: false }
    }
    return { display: text.substring(0, MAX_LENGTH - 3) + '...', isTruncated: true }
  }

  const groupedDecisions = decisions.reduce((acc, d) => {
    if (!acc[d.type]) acc[d.type] = []
    acc[d.type].push(d)
    return acc
  }, {} as Record<string, UserDecision[]>)

  const typeLabels: Record<string, string> = {
    pattern: 'Confirmed Patterns',
    ambiguity: 'Resolved Ambiguities',
    assumption: 'Approved Assumptions',
    parameter: 'Input Parameters'
  }

  const typeIcons: Record<string, React.ReactNode> = {
    pattern: <CheckCircle className="h-4 w-4 text-green-500" />,
    ambiguity: <AlertTriangle className="h-4 w-4 text-yellow-500" />,
    assumption: <FileText className="h-4 w-4 text-blue-500" />,
    parameter: <User className="h-4 w-4 text-purple-500" />
  }

  return (
    <div className="bg-gray-50 rounded-lg p-4 mb-6">
      <h4 className="font-semibold text-gray-700 mb-3">Your Decisions</h4>
      <div className="space-y-3">
        {Object.entries(groupedDecisions).map(([type, items]) => (
          <div key={type}>
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
              {typeIcons[type]}
              <span className="font-medium">{typeLabels[type] || type}</span>
            </div>
            <div className="pl-6 space-y-1">
              {items.map((item) => {
                const labelInfo = truncateText(item.label)
                const valueInfo = truncateText(item.value)
                const fullText = `${item.label}: ${item.value}`

                return (
                  <div
                    key={item.id}
                    className="text-sm flex items-center gap-2 group cursor-default"
                    title={fullText}
                  >
                    <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
                    <span className={`text-gray-600 ${labelInfo.isTruncated ? 'border-b border-dotted border-gray-400' : ''}`}>
                      {labelInfo.display}:
                    </span>
                    <span className={`font-medium text-gray-800 ${valueInfo.isTruncated ? 'border-b border-dotted border-gray-400' : ''}`}>
                      {valueInfo.display}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export default function V6WorkflowPreview({
  workflowSteps,
  userDecisions,
  agentName,
  onApprove,
  onGoBack,
  onCopyJSON,
  isLoading = false
}: V6WorkflowPreviewProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-gray-900">
              {agentName || 'Workflow Preview'}
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Review the {workflowSteps.length} step{workflowSteps.length !== 1 ? 's' : ''} below before saving
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium">
              {workflowSteps.length} steps
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {/* User Decisions Summary */}
        {userDecisions && userDecisions.length > 0 && (
          <DecisionSummary decisions={userDecisions} />
        )}

        {/* Workflow Steps */}
        <div className="mb-6">
          <h4 className="font-semibold text-gray-700 mb-4">Workflow Steps</h4>
          <div className="space-y-0">
            {workflowSteps.map((step, index) => (
              <StepCard
                key={step.id || index}
                step={step}
                index={index}
                isLast={index === workflowSteps.length - 1}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {onGoBack && (
            <button
              onClick={onGoBack}
              disabled={isLoading}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Go Back
            </button>
          )}
          {onCopyJSON && (
            <button
              onClick={onCopyJSON}
              disabled={isLoading}
              className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              Copy JSON
            </button>
          )}
        </div>

        {onApprove && (
          <button
            onClick={onApprove}
            disabled={isLoading}
            className={`px-6 py-2 rounded-lg font-semibold transition-colors ${
              isLoading
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-green-600 text-white hover:bg-green-700'
            }`}
          >
            {isLoading ? 'Saving...' : 'Approve & Save Agent'}
          </button>
        )}
      </div>
    </div>
  )
}

// Export types
export type { WorkflowStep, UserDecision, V6WorkflowPreviewProps }

'use client'

import React from 'react'
import {
  GitBranch,
  RefreshCw,
  Loader2,
  Check,
  X,
  ArrowRight,
  Bot,
  Shuffle,
  Filter,
  Repeat,
  Zap,
  Cog,
  Layers,
  ArrowDownUp,
  Group,
  Hash,
  Copy,
  GitMerge,
  CheckCircle,
  Scale,
  Workflow,
  SplitSquareHorizontal,
  Timer,
} from 'lucide-react'
import { PluginIcon } from '@/components/PluginIcon'

interface PilotStep {
  id: string
  name?: string
  type: string
  action?: string
  operation?: string
  plugin?: string
  then_steps?: PilotStep[]
  else_steps?: PilotStep[]
  steps?: PilotStep[]
  scatter?: {
    steps?: PilotStep[]
    input?: string
    itemVariable?: string
  }
  gather?: {
    operation?: string
    outputKey?: string
  }
  loopSteps?: PilotStep[]
  condition?: any
}

interface PilotDiagramProps {
  steps: PilotStep[]
  getStepStatus: (stepId: string) => 'pending' | 'executing' | 'completed' | 'failed' | 'skipped'
  getStepOutput?: (stepId: string) => any
  executing?: boolean
}

const stepTypeLabels: Record<string, string> = {
  'action': 'Action',
  'conditional': 'Decision',
  'scatter_gather': 'Loop',
  'loop': 'Loop',
  'ai_processing': 'AI',
  'llm_decision': 'AI',
  'transform': 'Transform',
}

// Format plugin name for display
function formatPluginName(plugin: string): string {
  return plugin
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

// Get step name from step data
function getStepName(step: PilotStep): string {
  if (step.name) return step.name
  if (step.action) {
    // Clean up action name - capitalize and remove underscores
    return step.action
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }
  if (step.operation) {
    return step.operation
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
  }
  return stepTypeLabels[step.type] || 'Step'
}

// Get plugin label for the step
function getPluginLabel(step: PilotStep): string {
  if (step.plugin) return formatPluginName(step.plugin)
  if (step.type === 'ai_processing' || step.type === 'llm_decision') return 'AI'
  if (step.type === 'transform') return 'Transform'
  if (step.type === 'conditional') return 'Decision'
  if (step.type === 'scatter_gather' || step.type === 'loop') return 'Loop'
  return stepTypeLabels[step.type] || 'Action'
}

// Get icon component for step - returns plugin icon or operation icon
function getStepIcon(step: PilotStep, className: string = "w-4 h-4"): React.ReactNode {
  // For plugin steps, use the real plugin icon
  if (step.plugin) {
    return <PluginIcon pluginId={step.plugin} className={className} />
  }

  // For AI processing steps - use platform Bot icon
  if (step.type === 'ai_processing' || step.type === 'llm_decision') {
    return <Bot className={className} />
  }

  // For transform steps, check the specific operation
  if (step.type === 'transform') {
    switch (step.operation) {
      case 'filter':
        return <Filter className={className} />
      case 'flatten':
        return <Layers className={className} />
      case 'map':
        return <Shuffle className={className} />
      case 'reduce':
        return <GitMerge className={className} />
      case 'sort':
        return <ArrowDownUp className={className} />
      case 'group':
      case 'group_by':
        return <Group className={className} />
      case 'aggregate':
        return <Hash className={className} />
      case 'deduplicate':
        return <Copy className={className} />
      default:
        return <Shuffle className={className} />
    }
  }

  // For conditional/decision steps
  if (step.type === 'conditional') {
    return <SplitSquareHorizontal className={className} />
  }

  // For loop/scatter-gather steps
  if (step.type === 'scatter_gather' || step.type === 'loop') {
    return <Repeat className={className} />
  }

  // For validation steps
  if (step.type === 'validation') {
    return <CheckCircle className={className} />
  }

  // For comparison steps
  if (step.type === 'comparison') {
    return <Scale className={className} />
  }

  // For delay steps
  if (step.type === 'delay') {
    return <Timer className={className} />
  }

  // For enrichment/merge steps
  if (step.type === 'enrichment') {
    return <GitMerge className={className} />
  }

  // For sub-workflow steps
  if (step.type === 'sub_workflow') {
    return <Workflow className={className} />
  }

  // For parallel steps
  if (step.type === 'parallel' || step.type === 'parallel_group') {
    return <GitBranch className={className} />
  }

  // For action steps without a plugin
  if (step.type === 'action') {
    return <Zap className={className} />
  }

  // Default fallback
  return <Cog className={className} />
}

// Get result info from step output - returns meaningful summary
// Only returns info when there's something useful to show (counts, specific outputs)
// Returns null for generic completions to avoid redundant "done" badges
function getResultInfo(stepOutput: any): { count: string; label: string; duration?: string } | null {
  if (!stepOutput) return null

  let result: { count: string; label: string; duration?: string } | null = null

  // Check if this is an aggregated array (from scatter-gather multiple executions)
  // These have an _aggregated property set by the SSE handler
  if (Array.isArray(stepOutput) && (stepOutput as any)._aggregated) {
    const count = stepOutput.length
    // Get the label from what a single item would produce
    const singleItemInfo = getResultInfo(stepOutput[0])
    if (singleItemInfo) {
      // Pluralize the label if count > 1
      let label = singleItemInfo.label
      if (count > 1 && !label.endsWith('s') && label !== '') {
        label = label + 's'
      }
      return { count: String(count), label }
    }
    // Fallback
    return { count: String(count), label: count === 1 ? 'result' : 'results' }
  }

  // Check if output is a regular array - always show count
  if (Array.isArray(stepOutput)) {
    result = {
      count: String(stepOutput.length),
      label: stepOutput.length === 1 ? 'item' : 'items'
    }
  }

  // Check if output is an object with common result patterns
  if (!result && typeof stepOutput === 'object' && stepOutput !== null) {
    // Check for result property that's an array
    if (stepOutput.result !== undefined && Array.isArray(stepOutput.result)) {
      result = {
        count: String(stepOutput.result.length),
        label: stepOutput.result.length === 1 ? 'item' : 'items'
      }
    }

    // Check for common array properties
    if (!result) {
      const arrayKeys = ['items', 'results', 'data', 'rows', 'records', 'messages', 'emails', 'values', 'files', 'attachments']
      for (const key of arrayKeys) {
        if (Array.isArray(stepOutput[key])) {
          const singular = key.endsWith('s') ? key.slice(0, -1) : key
          result = {
            count: String(stepOutput[key].length),
            label: stepOutput[key].length === 1 ? singular : key
          }
          break
        }
      }
    }

    // Check for specific meaningful single values based on output type
    // Only show output box for operations that produce tangible results
    if (!result) {
      // Append/update operations - show row count
      if (stepOutput.appended_rows !== undefined || stepOutput.appendedRows !== undefined) {
        const rows = stepOutput.appended_rows ?? stepOutput.appendedRows ?? 1
        result = { count: String(rows), label: rows === 1 ? 'row appended' : 'rows appended' }
      }
      // Email sent
      else if (stepOutput.message_id || stepOutput.messageId) {
        result = { count: '1', label: 'email sent' }
      }
      // File uploaded
      else if ((stepOutput.file_id || stepOutput.fileId) && stepOutput.web_link) {
        result = { count: '1', label: 'file uploaded' }
      }
      // File shared
      else if (stepOutput.share_link || (stepOutput.web_link && stepOutput.shared)) {
        result = { count: '1', label: 'file shared' }
      }
      // For other single-item outputs, don't show anything - the "Done" badge is enough
      // This avoids redundant "✓ done returned" for every step
    }
  }

  // Don't show output box for primitive values - "Done" badge is sufficient
  // Only exception: if it's a meaningful number result
  if (!result && typeof stepOutput === 'number' && stepOutput > 0) {
    result = { count: String(stepOutput), label: '' }
  }

  // Check for duration/timing info
  if (result && typeof stepOutput === 'object' && stepOutput !== null) {
    if (stepOutput.duration) {
      result.duration = stepOutput.duration
    } else if (stepOutput.executionTime) {
      result.duration = stepOutput.executionTime
    } else if (stepOutput.elapsed) {
      result.duration = stepOutput.elapsed
    }
  }

  return result
}

// Legacy function kept for compatibility - no longer used for fallback "done" display
function _legacyGetResultInfo(stepOutput: any): { count: string; label: string; duration?: string } | null {
  // This was the old logic that showed "✓ done" for everything
  // Now we only show output info when it's meaningful
  if (!stepOutput) return null
  if (typeof stepOutput === 'object' && stepOutput !== null) {
    // File operations
    if (stepOutput.file_id || stepOutput.fileId) {
      return { count: '1', label: 'file' }
    }
    // Folder operations
    if (stepOutput.folder_id || stepOutput.folderId) {
      return { count: '1', label: 'folder' }
    }
  }
  return null
}

// Get a better description for the step
function getStepDescription(step: PilotStep): string {
  // For action steps, describe what the action does
  if (step.action) {
    const actionParts = step.action.split('_')
    const verb = actionParts[0]

    // Create more descriptive text based on action type
    switch (verb) {
      case 'search':
        return `Searching for matching ${step.plugin ? formatPluginName(step.plugin) : ''} content`
      case 'get':
      case 'fetch':
      case 'list':
        return `Retrieving data from ${step.plugin ? formatPluginName(step.plugin) : 'source'}`
      case 'create':
      case 'add':
        return `Creating new ${step.plugin ? formatPluginName(step.plugin) : ''} entry`
      case 'update':
      case 'edit':
        return `Updating ${step.plugin ? formatPluginName(step.plugin) : ''} data`
      case 'send':
        return `Sending via ${step.plugin ? formatPluginName(step.plugin) : ''}`
      case 'delete':
      case 'remove':
        return `Removing from ${step.plugin ? formatPluginName(step.plugin) : ''}`
      case 'append':
        return `Appending to ${step.plugin ? formatPluginName(step.plugin) : ''}`
      case 'extract':
        return `Extracting data from ${step.plugin ? formatPluginName(step.plugin) : 'document'}`
      case 'upload':
        return `Uploading to ${step.plugin ? formatPluginName(step.plugin) : ''}`
      case 'share':
        return `Sharing via ${step.plugin ? formatPluginName(step.plugin) : ''}`
      default:
        return step.plugin ? `Using ${formatPluginName(step.plugin)}` : 'Processing data'
    }
  }

  // For other step types - use operation if available for more specific description
  if (step.type === 'ai_processing' || step.type === 'llm_decision') {
    if (step.operation === 'generate_content' || step.operation === 'generate') {
      return 'Generating content with AI'
    }
    if (step.operation === 'summarize') {
      return 'Summarizing with AI'
    }
    if (step.operation === 'analyze') {
      return 'Analyzing with AI'
    }
    return 'Processing with AI'
  }
  if (step.type === 'transform') {
    if (step.operation === 'filter') {
      return 'Filtering results'
    }
    if (step.operation === 'flatten') {
      return 'Flattening data structure'
    }
    if (step.operation === 'map') {
      return 'Mapping data'
    }
    if (step.operation === 'sort') {
      return 'Sorting results'
    }
    if (step.operation === 'merge') {
      return 'Merging data'
    }
    return 'Transforming data'
  }
  if (step.type === 'conditional' || step.type === 'decision') {
    return 'Evaluating condition'
  }
  if (step.type === 'scatter_gather' || step.type === 'loop') {
    return 'Processing each item'
  }
  if (step.type === 'validation') {
    return 'Validating data'
  }
  if (step.type === 'comparison') {
    return 'Comparing values'
  }

  // Use operation for description if available
  if (step.operation) {
    const opFormatted = step.operation.replace(/_/g, ' ')
    // Capitalize first letter
    return opFormatted.charAt(0).toUpperCase() + opFormatted.slice(1)
  }

  return 'Processing'
}

// Stepper Item Component
function StepperItem({
  step,
  status,
  stepOutput,
  isLast,
  stepNumber
}: {
  step: PilotStep
  status: string
  stepOutput: any
  isLast: boolean
  stepNumber: number
}) {
  const resultInfo = status === 'completed' ? getResultInfo(stepOutput) : null

  return (
    <div className="stepper-item flex gap-4 relative">
      {/* Vertical connecting line */}
      {!isLast && (
        <div
          className={`stepper-line absolute left-[15px] top-[36px] bottom-0 w-[2px] transition-colors duration-300 ${
            status === 'completed' ? 'bg-[var(--v2-status-success-border)]' :
            status === 'executing' ? 'bg-gradient-to-b from-[var(--v2-primary)] to-[var(--v2-border)]' :
            'bg-[var(--v2-border)]'
          }`}
        />
      )}

      {/* Step indicator circle */}
      <div
        className={`stepper-indicator w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 z-10 text-sm font-medium transition-all duration-300 ${
          status === 'completed' ? 'bg-[var(--v2-status-success-border)] text-white' :
          status === 'executing' ? 'bg-[var(--v2-primary)] text-white shadow-[0_0_0_4px_rgba(99,102,241,0.15)]' :
          status === 'failed' ? 'bg-[var(--v2-status-error-border)] text-white' :
          'bg-[var(--v2-surface-hover)] border-2 border-[var(--v2-border)] text-[var(--v2-text-muted)]'
        }`}
      >
        {status === 'completed' ? (
          <Check className="w-4 h-4" strokeWidth={3} />
        ) : status === 'executing' ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : status === 'failed' ? (
          <X className="w-4 h-4" strokeWidth={3} />
        ) : (
          stepNumber
        )}
      </div>

      {/* Step content */}
      <div className={`stepper-content flex-1 ${isLast ? 'pb-0' : 'pb-6'}`}>
        {/* Header row */}
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            {/* Step icon */}
            <div className="w-5 h-5 flex items-center justify-center text-[var(--v2-text-muted)]">
              {getStepIcon(step, "w-5 h-5")}
            </div>
            <span className="text-sm font-semibold text-[var(--v2-text-primary)]">
              {getStepName(step)}
            </span>
            <span className="stepper-plugin px-2 py-0.5 bg-[var(--v2-surface-hover)] rounded text-[11px] text-[var(--v2-text-muted)] font-medium">
              {getPluginLabel(step)}
            </span>
          </div>

          {/* Status badge */}
          {status === 'completed' && (
            <span className="stepper-badge px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[rgba(34,197,94,0.12)] text-[#22c55e]">
              Done
            </span>
          )}
          {status === 'executing' && (
            <span className="stepper-badge px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[rgba(99,102,241,0.15)] text-[var(--v2-primary)] animate-pulse">
              Running
            </span>
          )}
          {status === 'failed' && (
            <span className="stepper-badge px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[rgba(239,68,68,0.12)] text-[#ef4444]">
              Failed
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-[13px] text-[var(--v2-text-secondary)] mb-0">
          {getStepDescription(step)}
        </p>

        {/* Output preview - only for completed steps with results */}
        {status === 'completed' && resultInfo && (
          <div className="stepper-output mt-3 px-3.5 py-2.5 bg-[var(--v2-surface-hover)] rounded-lg border border-[var(--v2-border)] text-xs text-[var(--v2-text-secondary)] flex items-center gap-2.5">
            <ArrowRight className="w-3.5 h-3.5 text-[var(--v2-text-muted)]" />
            <span className="text-[var(--v2-text-primary)] font-semibold">{resultInfo.count} {resultInfo.label}</span>
            <span className="text-[var(--v2-text-muted)]">
              {resultInfo.duration ? `found in ${resultInfo.duration}` : 'returned'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// Recursive step renderer
function StepNode({
  step,
  getStepStatus,
  getStepOutput,
  isLast,
  stepNumber,
  depth = 0
}: {
  step: PilotStep
  getStepStatus: (stepId: string) => string
  getStepOutput?: (stepId: string) => any
  isLast: boolean
  stepNumber: number
  depth?: number
}) {
  const status = getStepStatus(step.id)
  const stepOutput = getStepOutput ? getStepOutput(step.id) : null

  // For conditional steps with branches
  if (step.type === 'conditional' && (step.then_steps || step.else_steps)) {
    const hasThen = step.then_steps && step.then_steps.length > 0
    const hasElse = step.else_steps && step.else_steps.length > 0

    return (
      <>
        <StepperItem
          step={step}
          status={status}
          stepOutput={stepOutput}
          isLast={!hasThen && !hasElse && isLast}
          stepNumber={stepNumber}
        />

        {/* Then branch */}
        {hasThen && (
          <div className="ml-10 border-l-2 border-[var(--v2-status-success-border)] pl-4 mt-2 mb-4">
            <div className="text-[11px] font-semibold text-[var(--v2-status-success-text)] mb-3 uppercase tracking-wide">
              Then
            </div>
            {step.then_steps!.map((s, i) => (
              <StepNode
                key={`${step.id}-then-${i}`}
                step={s}
                getStepStatus={getStepStatus}
                getStepOutput={getStepOutput}
                isLast={i === step.then_steps!.length - 1}
                stepNumber={i + 1}
                depth={depth + 1}
              />
            ))}
          </div>
        )}

        {/* Else branch */}
        {hasElse && (
          <div className="ml-10 border-l-2 border-[var(--v2-status-error-border)] pl-4 mt-2 mb-4">
            <div className="text-[11px] font-semibold text-[var(--v2-status-error-text)] mb-3 uppercase tracking-wide">
              Else
            </div>
            {step.else_steps!.map((s, i) => (
              <StepNode
                key={`${step.id}-else-${i}`}
                step={s}
                getStepStatus={getStepStatus}
                getStepOutput={getStepOutput}
                isLast={i === step.else_steps!.length - 1}
                stepNumber={i + 1}
                depth={depth + 1}
              />
            ))}
          </div>
        )}
      </>
    )
  }

  // For loop steps (type: 'loop' with loopSteps)
  if (step.type === 'loop' && step.loopSteps && step.loopSteps.length > 0) {
    return (
      <>
        <StepperItem
          step={step}
          status={status}
          stepOutput={stepOutput}
          isLast={false}
          stepNumber={stepNumber}
        />

        {/* Loop steps */}
        <div className="ml-10 border-l-2 border-[var(--v2-secondary)] pl-4 mt-2 mb-4">
          <div className="text-[11px] font-semibold text-[var(--v2-secondary)] mb-3 uppercase tracking-wide flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3" />
            Loop
          </div>
          {step.loopSteps.map((s, i) => (
            <StepNode
              key={`${step.id}-loop-${i}`}
              step={s}
              getStepStatus={getStepStatus}
              getStepOutput={getStepOutput}
              isLast={i === step.loopSteps!.length - 1}
              stepNumber={i + 1}
              depth={depth + 1}
            />
          ))}
        </div>
      </>
    )
  }

  // For scatter-gather steps (type: 'scatter_gather' with scatter.steps)
  if (step.type === 'scatter_gather') {
    // Cast to access scatter property which contains the nested steps
    const scatterStep = step as any
    const scatterSteps: PilotStep[] = scatterStep.scatter?.steps || []

    return (
      <React.Fragment>
        <StepperItem
          step={step}
          status={status}
          stepOutput={stepOutput}
          isLast={scatterSteps.length === 0 && isLast}
          stepNumber={stepNumber}
        />

        {/* Scatter-gather nested steps */}
        {scatterSteps.length > 0 ? (
          <div className="ml-10 border-l-2 border-[var(--v2-secondary)] pl-4 mt-2 mb-4">
            <div className="text-[11px] font-semibold text-[var(--v2-secondary)] mb-3 uppercase tracking-wide flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3" />
              For Each Item ({scatterSteps.length} steps)
            </div>
            {scatterSteps.map((s, i) => (
              <StepNode
                key={`${step.id}-scatter-${i}`}
                step={s}
                getStepStatus={getStepStatus}
                getStepOutput={getStepOutput}
                isLast={i === scatterSteps.length - 1}
                stepNumber={i + 1}
                depth={depth + 1}
              />
            ))}
          </div>
        ) : null}
      </React.Fragment>
    )
  }

  // Regular step
  return (
    <StepperItem
      step={step}
      status={status}
      stepOutput={stepOutput}
      isLast={isLast}
      stepNumber={stepNumber}
    />
  )
}

export function PilotDiagram({ steps, getStepStatus, getStepOutput }: PilotDiagramProps) {
  if (!steps || steps.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--v2-text-muted)]">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--v2-surface-hover)] border border-[var(--v2-border)] mb-3">
          <GitBranch className="w-8 h-8" />
        </div>
        <p className="text-sm font-medium">No workflow steps defined</p>
      </div>
    )
  }

  return (
    <div className="stepper">
      {steps.map((step, idx) => (
        <StepNode
          key={step.id || `step-${idx}`}
          step={step}
          getStepStatus={getStepStatus}
          getStepOutput={getStepOutput}
          isLast={idx === steps.length - 1}
          stepNumber={idx + 1}
        />
      ))}
    </div>
  )
}

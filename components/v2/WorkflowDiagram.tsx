'use client'

import React, { useState } from 'react'
import {
  Settings,
  Bot,
  GitBranch,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  ChevronRight,
  ArrowRight,
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
    item_name?: string
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

const stepTypeIcons: Record<string, { icon: any, color: string, label: string }> = {
  'action': { icon: Settings, color: '#6366F1', label: 'Action' },
  'conditional': { icon: GitBranch, color: '#8B5CF6', label: 'Decision' },
  'scatter_gather': { icon: RefreshCw, color: '#EC4899', label: 'Loop' },
  'ai_processing': { icon: Bot, color: '#8B5CF6', label: 'AI' },
  'llm_decision': { icon: Bot, color: '#8B5CF6', label: 'AI' },
}

function StepCard({ step, status, stepConfig, hasPluginIcon, Icon, stepOutput }: any) {
  const getStepName = () => {
    if (step.name) return step.name
    if (step.action) {
      return step.action.replace(/_/g, ' ').replace(/^(create|get|send|update|delete|search|read|write|append)\s/i, '')
    }
    if (step.operation) return step.operation.replace(/_/g, ' ')
    return stepConfig.label
  }

  const getStepDescription = () => {
    if (step.action && step.plugin) {
      return `Using ${step.plugin}`
    }
    if (step.operation) {
      return `Operation: ${step.operation.replace(/_/g, ' ')}`
    }
    return stepConfig.label
  }

  const getStepResultCount = () => {
    if (status !== 'completed') return null

    // If no output, still show Success badge
    if (!stepOutput) {
      return 'Success'
    }

    // Debug logging - always log for completed steps
    console.log('[WorkflowDiagram] Analyzing step output:', {
      stepId: step.id,
      status,
      outputType: Array.isArray(stepOutput) ? 'array' : typeof stepOutput,
      outputKeys: typeof stepOutput === 'object' ? Object.keys(stepOutput) : [],
      output: stepOutput
    })

    // Check if output is an array
    if (Array.isArray(stepOutput)) {
      const count = `${stepOutput.length} item${stepOutput.length !== 1 ? 's' : ''}`
      console.log('[WorkflowDiagram] ✓ Found array, count:', count)
      return count
    }

    // Check if output is an object with common result patterns
    if (typeof stepOutput === 'object' && stepOutput !== null) {
      // Check for result property
      if (stepOutput.result !== undefined) {
        if (Array.isArray(stepOutput.result)) {
          const count = `${stepOutput.result.length} item${stepOutput.result.length !== 1 ? 's' : ''}`
          console.log('[WorkflowDiagram] ✓ Found result array, count:', count)
          return count
        }
      }

      // Check for common array properties
      const arrayKeys = ['items', 'results', 'data', 'rows', 'records', 'messages', 'emails', 'values']
      for (const key of arrayKeys) {
        if (Array.isArray(stepOutput[key])) {
          const count = `${stepOutput[key].length} ${key}`
          console.log('[WorkflowDiagram] ✓ Found array in key "' + key + '", count:', count)
          return count
        }
      }

      // Check for success message
      if (stepOutput.success === true) {
        console.log('[WorkflowDiagram] ✓ Found success flag')
        return 'Success'
      }

      // Check if it's a simple object with a message or value
      if (stepOutput.message || stepOutput.value || stepOutput.text) {
        console.log('[WorkflowDiagram] ✓ Found message/value/text field')
        return 'Success'
      }
    }

    console.log('[WorkflowDiagram] ✗ No count pattern matched, defaulting to Success')
    // Default to "Success" for completed steps
    return 'Success'
  }

  const getCardStyle = () => {
    switch (status) {
      case 'executing':
        return 'border-[var(--v2-status-executing-border)] bg-[var(--v2-status-executing-bg)] shadow-md'
      case 'completed':
        return 'border-[var(--v2-status-success-border)] bg-[var(--v2-status-success-bg)]'
      case 'failed':
        return 'border-[var(--v2-status-error-border)] bg-[var(--v2-status-error-bg)]'
      case 'skipped':
        return 'border-[var(--v2-border)] bg-[var(--v2-surface-hover)] opacity-60'
      default:
        return 'border-[var(--v2-border)] bg-[var(--v2-surface-hover)]'
    }
  }

  return (
    <div
      data-step-id={step.id}
      className={`flex items-center gap-3 p-2.5 border transition-all duration-300 mb-2 ${getCardStyle()}`}
      style={{ borderRadius: 'var(--v2-radius-card)' }}
    >
      {/* Icon */}
      <div className="relative flex-shrink-0">
        <div
          className="w-8 h-8 flex items-center justify-center rounded-full"
          style={{
            backgroundColor: status === 'executing' ? 'var(--v2-status-executing-border)' :
                            status === 'completed' ? 'var(--v2-status-success-border)' :
                            status === 'failed' ? 'var(--v2-status-error-border)' :
                            'var(--v2-border)'
          }}
        >
          {status === 'executing' ? (
            <Loader2 className="w-4 h-4 animate-spin text-white dark:text-white" />
          ) : status === 'completed' ? (
            <CheckCircle className="w-4 h-4 text-white dark:text-white" />
          ) : status === 'failed' ? (
            <XCircle className="w-4 h-4 text-white dark:text-white" />
          ) : hasPluginIcon ? (
            <PluginIcon pluginId={step.plugin!} className="w-4 h-4 text-[var(--v2-text-muted)]" />
          ) : (
            <Icon className="w-4 h-4" style={{ color: status === 'pending' ? 'var(--v2-text-muted)' : stepConfig.color }} />
          )}
        </div>
      </div>

      {/* Step Info */}
      <div className="flex-1 min-w-0">
        <h4 className="text-sm font-medium text-[var(--v2-text-primary)] mb-0.5">
          {getStepName()}
        </h4>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--v2-text-muted)]">
            {getStepDescription()}
          </p>
          {/* Counter on same line as description, aligned right */}
          {status === 'completed' && getStepResultCount() && getStepResultCount() !== 'Success' && (
            <p className="text-xs text-[var(--v2-text-muted)] whitespace-nowrap ml-auto">
              {getStepResultCount()}
            </p>
          )}
        </div>
      </div>

      {/* Success Badge */}
      {status === 'completed' && (
        <div className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-700">
          Success
        </div>
      )}
      {status === 'executing' && (
        <div className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-700">
          Running...
        </div>
      )}
      {status === 'failed' && (
        <div className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-700">
          Failed
        </div>
      )}
    </div>
  )
}

function StepNode({ step, getStepStatus, getStepOutput, isLast = false }: {
  step: PilotStep
  getStepStatus: (stepId: string) => string
  getStepOutput?: (stepId: string) => any
  isLast?: boolean
}) {
  const status = getStepStatus(step.id)
  const stepOutput = getStepOutput ? getStepOutput(step.id) : null
  const stepType = step.type || (step.plugin ? 'action' : 'ai_processing')
  const stepConfig = stepTypeIcons[stepType] || stepTypeIcons['action']
  const hasPluginIcon = Boolean(step.plugin)
  const Icon = stepConfig.icon

  // For conditional steps with branches - simplified for vertical layout
  if (step.type === 'conditional' && (step.then_steps || step.else_steps)) {
    const hasThen = step.then_steps && step.then_steps.length > 0
    const hasElse = step.else_steps && step.else_steps.length > 0

    return (
      <>
        {/* Decision step card */}
        <StepCard
          step={step}
          status={status}
          stepConfig={stepConfig}
          hasPluginIcon={hasPluginIcon}
          Icon={Icon}
          stepOutput={stepOutput}
        />

        {/* Then branch */}
        {hasThen && (
          <div className="ml-8 border-l-2 border-[var(--v2-status-success-border)] pl-4">
            <div className="text-xs font-semibold text-[var(--v2-status-success-text)] mb-2 uppercase">Then</div>
            {step.then_steps!.map((s, i) => (
              <StepNode
                key={`${step.id}-then-${i}`}
                step={s}
                getStepStatus={getStepStatus}
                getStepOutput={getStepOutput}
                isLast={i === step.then_steps!.length - 1}
              />
            ))}
          </div>
        )}

        {/* Else branch */}
        {hasElse && (
          <div className="ml-8 border-l-2 border-[var(--v2-status-error-border)] pl-4">
            <div className="text-xs font-semibold text-[var(--v2-status-error-text)] mb-2 uppercase">Else</div>
            {step.else_steps!.map((s, i) => (
              <StepNode
                key={`${step.id}-else-${i}`}
                step={s}
                getStepStatus={getStepStatus}
                getStepOutput={getStepOutput}
                isLast={i === step.else_steps!.length - 1}
              />
            ))}
          </div>
        )}
      </>
    )
  }

  // For loop/scatter-gather steps - simplified for vertical layout
  if (step.type === 'scatter_gather' && (step.steps || step.scatter?.steps)) {
    const loopSteps = step.steps || step.scatter?.steps || []

    return (
      <>
        {/* Loop step card */}
        <StepCard
          step={step}
          status={status}
          stepConfig={stepConfig}
          hasPluginIcon={hasPluginIcon}
          Icon={Icon}
          stepOutput={stepOutput}
        />

        {/* Loop steps */}
        <div className="ml-8 border-l-2 border-[var(--v2-secondary)] pl-4">
          <div className="text-xs font-semibold text-[var(--v2-secondary)] mb-2 uppercase flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />
            Loop
          </div>
          {loopSteps.map((s, i) => (
            <StepNode
              key={`${step.id}-loop-${i}`}
              step={s}
              getStepStatus={getStepStatus}
              getStepOutput={getStepOutput}
              isLast={i === loopSteps.length - 1}
            />
          ))}
        </div>
      </>
    )
  }

  // Regular step (action, AI, etc.)
  return (
    <StepCard
      step={step}
      status={status}
      stepConfig={stepConfig}
      hasPluginIcon={hasPluginIcon}
      Icon={Icon}
      stepOutput={stepOutput}
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
    <div className="relative">
      {/* Vertical stacked container */}
      <div className="space-y-0">
        {steps.map((step, idx) => (
          <StepNode
            key={step.id || `step-${idx}`}
            step={step}
            getStepStatus={getStepStatus}
            getStepOutput={getStepOutput}
            isLast={idx === steps.length - 1}
          />
        ))}
      </div>
    </div>
  )
}

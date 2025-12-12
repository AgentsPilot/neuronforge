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
  executing?: boolean
}

const stepTypeIcons: Record<string, { icon: any, color: string, label: string }> = {
  'action': { icon: Settings, color: 'var(--v2-primary)', label: 'Action' },
  'conditional': { icon: GitBranch, color: '#8B5CF6', label: 'Decision' },
  'scatter_gather': { icon: RefreshCw, color: '#EC4899', label: 'Loop' },
  'ai_processing': { icon: Bot, color: '#8B5CF6', label: 'AI' },
  'llm_decision': { icon: Bot, color: '#8B5CF6', label: 'AI' },
}

function StepCard({ step, status, stepConfig, hasPluginIcon, Icon }: any) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })
  const cardRef = React.useRef<HTMLDivElement>(null)

  const getStepName = () => {
    if (step.name) return step.name
    if (step.action) {
      return step.action.replace(/_/g, ' ').replace(/^(create|get|send|update|delete|search|read|write|append)\s/i, '')
    }
    if (step.operation) return step.operation.replace(/_/g, ' ')
    return stepConfig.label
  }

  const handleMouseEnter = () => {
    if (cardRef.current) {
      const rect = cardRef.current.getBoundingClientRect()
      setTooltipPos({
        x: rect.left + rect.width / 2,
        y: rect.top - 8
      })
    }
    setShowTooltip(true)
  }

  const getCardStyle = () => {
    switch (status) {
      case 'executing':
        return 'border-[var(--v2-status-executing-border)] bg-[var(--v2-status-executing-bg)] shadow-lg'
      case 'completed':
        return 'border-[var(--v2-status-success-border)] bg-[var(--v2-status-success-bg)]'
      case 'failed':
        return 'border-[var(--v2-status-error-border)] bg-[var(--v2-status-error-bg)]'
      case 'skipped':
        return 'border-[var(--v2-border)] bg-[var(--v2-surface)] opacity-60'
      default:
        return 'border-[var(--v2-border)] bg-[var(--v2-surface)] hover:bg-[var(--v2-surface-hover)]'
    }
  }

  const getTextColor = () => {
    switch (status) {
      case 'executing': return 'text-[var(--v2-status-executing-text)]'
      case 'completed': return 'text-[var(--v2-status-success-text)]'
      case 'failed': return 'text-[var(--v2-status-error-text)]'
      default: return 'text-[var(--v2-text-primary)]'
    }
  }

  return (
    <>
      <div
        ref={cardRef}
        className={`relative flex-shrink-0 w-[140px] h-[88px] p-2 border rounded-[var(--v2-radius-button)] transition-all duration-200 flex flex-col justify-between ${getCardStyle()}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {status === 'executing' && (
          <div className="absolute inset-0 rounded-[var(--v2-radius-button)] bg-[var(--v2-primary)] opacity-5 animate-pulse pointer-events-none" />
        )}

      {/* Icon */}
      <div className="relative flex items-center justify-center">
        <div
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-transform hover:scale-105"
          style={{
            backgroundColor: status === 'executing' ? 'var(--v2-primary)' :
                            status === 'completed' ? 'var(--v2-status-success-border)' :
                            status === 'failed' ? 'var(--v2-status-error-border)' :
                            `${stepConfig.color}15`
          }}
        >
          {status === 'executing' ? (
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          ) : hasPluginIcon ? (
            <PluginIcon pluginId={step.plugin!} className="w-4 h-4" />
          ) : (
            <Icon className="w-4 h-4" style={{ color: stepConfig.color }} />
          )}
        </div>

        {/* Status indicator */}
        {status === 'completed' && (
          <CheckCircle className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[var(--v2-status-success-border)] fill-[var(--v2-surface)]" />
        )}
        {status === 'failed' && (
          <XCircle className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 text-[var(--v2-status-error-border)] fill-[var(--v2-surface)]" />
        )}
      </div>

      {/* Step name */}
      <p className={`text-[10.5px] font-medium text-center line-clamp-2 leading-tight px-1.5 ${getTextColor()}`}>
        {getStepName()}
      </p>

      {/* Type badge */}
      <div className="flex justify-center">
        <span
          className="text-[7.5px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide"
          style={{
            backgroundColor: `${stepConfig.color}15`,
            color: stepConfig.color
          }}
        >
          {stepConfig.label}
        </span>
      </div>
    </div>

    {/* Fixed Tooltip - outside overflow container */}
    {showTooltip && (
      <div
        className="fixed z-[9999] px-3 py-1.5 bg-gray-900 dark:bg-gray-700 text-white text-xs rounded shadow-lg pointer-events-none max-w-xs text-center -translate-x-1/2 -translate-y-full"
        style={{
          left: `${tooltipPos.x}px`,
          top: `${tooltipPos.y}px`
        }}
      >
        {getStepName()}
        <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900 dark:border-t-gray-700"></div>
      </div>
    )}
  </>
  )
}

function StepNode({ step, getStepStatus, isLast = false }: {
  step: PilotStep
  getStepStatus: (stepId: string) => string
  isLast?: boolean
}) {
  const status = getStepStatus(step.id)
  const stepType = step.type || (step.plugin ? 'action' : 'ai_processing')
  const stepConfig = stepTypeIcons[stepType] || stepTypeIcons['action']
  const hasPluginIcon = Boolean(step.plugin)
  const Icon = stepConfig.icon

  const hasNested = Boolean(
    step.then_steps?.length ||
    step.else_steps?.length ||
    step.steps?.length ||
    step.scatter?.steps?.length ||
    step.loopSteps?.length
  )

  // For conditional steps with branches
  if (step.type === 'conditional' && (step.then_steps || step.else_steps)) {
    const hasThen = step.then_steps && step.then_steps.length > 0
    const hasElse = step.else_steps && step.else_steps.length > 0

    return (
      <div className="flex items-center gap-3">
        {/* Decision step card */}
        <StepCard
          step={step}
          status={status}
          stepConfig={stepConfig}
          hasPluginIcon={hasPluginIcon}
          Icon={Icon}
        />

        {/* Branch connector icon and branches */}
        {(hasThen || hasElse) && (() => {
          // Check if any branch is executing
          const thenStatuses = step.then_steps?.map(s => getStepStatus(s.id)) || [];
          const elseStatuses = step.else_steps?.map(s => getStepStatus(s.id)) || [];
          const isBranchExecuting = [...thenStatuses, ...elseStatuses].includes('executing');

          return (
            <>
              <div className="flex items-center justify-center">
                <GitBranch className={`w-5 h-5 transition-all ${
                  isBranchExecuting
                    ? 'text-[var(--v2-primary)] animate-pulse'
                    : 'text-[var(--v2-primary)]'
                }`} />
              </div>

              {/* Branches container */}
              <div className="flex flex-col gap-3">
              {/* Yes/Then branch */}
              {hasThen && (() => {
                // Check if any step in this branch is executing
                const branchStatuses = step.then_steps!.map(s => getStepStatus(s.id));
                const isExecuting = branchStatuses.includes('executing');
                const isCompleted = branchStatuses.every(s => s === 'completed' || s === 'skipped');

                return (
                  <div className="flex items-center gap-2">
                    {/* Branch label */}
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-all flex-shrink-0 ${
                      isExecuting
                        ? 'bg-[var(--v2-status-executing-bg)] border-[var(--v2-status-executing-border)] animate-pulse'
                        : isCompleted
                          ? 'bg-[var(--v2-status-success-bg)] border-[var(--v2-status-success-border)]'
                          : 'bg-[var(--v2-status-success-bg)] border-[var(--v2-status-success-border)] opacity-50'
                    } border`}>
                      <span className={`text-[9px] font-bold uppercase ${
                        isExecuting ? 'text-[var(--v2-status-executing-text)]' : 'text-[var(--v2-status-success-text)]'
                      }`}>Yes</span>
                      <ChevronRight className={`w-3 h-3 ${
                        isExecuting ? 'text-[var(--v2-status-executing-text)]' : 'text-[var(--v2-status-success-text)]'
                      }`} />
                    </div>

                    {/* Branch steps */}
                    {step.then_steps!.map((s, i) => (
                      <React.Fragment key={`${step.id}-then-${i}`}>
                        <StepNode
                          step={s}
                          getStepStatus={getStepStatus}
                          isLast={i === step.then_steps!.length - 1}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                );
              })()}

              {/* No/Else branch */}
              {hasElse && (() => {
                // Check if any step in this branch is executing
                const branchStatuses = step.else_steps!.map(s => getStepStatus(s.id));
                const isExecuting = branchStatuses.includes('executing');
                const isCompleted = branchStatuses.every(s => s === 'completed' || s === 'skipped');

                return (
                  <div className="flex items-center gap-2">
                    {/* Branch label */}
                    <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-all flex-shrink-0 ${
                      isExecuting
                        ? 'bg-[var(--v2-status-executing-bg)] border-[var(--v2-status-executing-border)] animate-pulse'
                        : isCompleted
                          ? 'bg-[var(--v2-status-error-bg)] border-[var(--v2-status-error-border)]'
                          : 'bg-[var(--v2-status-error-bg)] border-[var(--v2-status-error-border)] opacity-50'
                    } border`}>
                      <span className={`text-[9px] font-bold uppercase ${
                        isExecuting ? 'text-[var(--v2-status-executing-text)]' : 'text-[var(--v2-status-error-text)]'
                      }`}>No</span>
                      <ChevronRight className={`w-3 h-3 ${
                        isExecuting ? 'text-[var(--v2-status-executing-text)]' : 'text-[var(--v2-status-error-text)]'
                      }`} />
                    </div>

                    {/* Branch steps */}
                    {step.else_steps!.map((s, i) => (
                      <React.Fragment key={`${step.id}-else-${i}`}>
                        <StepNode
                          step={s}
                          getStepStatus={getStepStatus}
                          isLast={i === step.else_steps!.length - 1}
                        />
                      </React.Fragment>
                    ))}
                  </div>
                );
              })()}
            </div>
          </>
          );
        })()}

        {/* Arrow after branch (if not last) */}
        {!isLast && (
          <ArrowRight
            className={`flex-shrink-0 w-4 h-4 transition-colors ${
              status === 'completed' ? 'text-[var(--v2-status-success-border)]' :
              status === 'failed' ? 'text-[var(--v2-status-error-border)]' :
              status === 'executing' ? 'text-[var(--v2-primary)] animate-pulse' :
              'text-[var(--v2-border)]'
            }`}
          />
        )}
      </div>
    )
  }

  // For loop/scatter-gather steps
  if (step.type === 'scatter_gather' && (step.steps || step.scatter?.steps)) {
    const loopSteps = step.steps || step.scatter?.steps || []

    // Check if any loop step is executing
    const loopStatuses = loopSteps.map(s => getStepStatus(s.id));
    const isLoopExecuting = loopStatuses.includes('executing');
    const isLoopCompleted = loopStatuses.every(s => s === 'completed' || s === 'skipped');

    return (
      <div className="flex items-center gap-3">
        {/* Loop step card */}
        <StepCard
          step={step}
          status={status}
          stepConfig={stepConfig}
          hasPluginIcon={hasPluginIcon}
          Icon={Icon}
        />

        {/* Loop indicator */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full transition-all border ${
          isLoopExecuting
            ? 'bg-[var(--v2-status-executing-bg)] border-[var(--v2-status-executing-border)] animate-pulse'
            : isLoopCompleted
              ? 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700'
              : 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-700 opacity-50'
        }`}>
          <RefreshCw className={`w-3 h-3 ${
            isLoopExecuting
              ? 'text-[var(--v2-status-executing-text)] animate-spin'
              : 'text-purple-600 dark:text-purple-400'
          }`} />
          <span className={`text-[9px] font-bold uppercase ${
            isLoopExecuting ? 'text-[var(--v2-status-executing-text)]' : 'text-purple-600 dark:text-purple-400'
          }`}>Loop</span>
          <ChevronRight className={`w-3 h-3 ${
            isLoopExecuting ? 'text-[var(--v2-status-executing-text)]' : 'text-purple-600 dark:text-purple-400'
          }`} />
        </div>

        {/* Loop steps */}
        <div className="flex items-center gap-3">
          {loopSteps.map((s, i) => (
            <React.Fragment key={`${step.id}-loop-${i}`}>
              <StepNode
                step={s}
                getStepStatus={getStepStatus}
                isLast={i === loopSteps.length - 1}
              />
            </React.Fragment>
          ))}
        </div>

        {/* Arrow after loop */}
        {!isLast && (
          <ArrowRight
            className={`flex-shrink-0 w-4 h-4 transition-colors ${
              status === 'completed' ? 'text-[var(--v2-status-success-border)]' :
              status === 'failed' ? 'text-[var(--v2-status-error-border)]' :
              status === 'executing' ? 'text-[var(--v2-primary)] animate-pulse' :
              'text-[var(--v2-border)]'
            }`}
          />
        )}
      </div>
    )
  }

  // Regular step (action, AI, etc.)
  return (
    <>
      <StepCard
        step={step}
        status={status}
        stepConfig={stepConfig}
        hasPluginIcon={hasPluginIcon}
        Icon={Icon}
      />

      {/* Arrow connector */}
      {!isLast && (
        <ArrowRight
          className={`flex-shrink-0 w-4 h-4 transition-colors ${
            status === 'completed' ? 'text-[var(--v2-status-success-border)]' :
            status === 'failed' ? 'text-[var(--v2-status-error-border)]' :
            status === 'executing' ? 'text-[var(--v2-primary)] animate-pulse' :
            'text-[var(--v2-border)]'
          }`}
        />
      )}
    </>
  )
}

export function PilotDiagram({ steps, getStepStatus }: PilotDiagramProps) {
  if (!steps || steps.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--v2-text-muted)]">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--v2-surface)] border border-[var(--v2-border)] mb-3">
          <GitBranch className="w-8 h-8" />
        </div>
        <p className="text-sm font-medium">No pilot steps defined</p>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* Horizontal scrollable container */}
      <div className="overflow-x-auto pb-4 scrollbar-thin">
        <div className="flex items-center gap-3 min-w-max px-4 py-6">
          {steps.map((step, idx) => (
            <StepNode
              key={step.id || `step-${idx}`}
              step={step}
              getStepStatus={getStepStatus}
              isLast={idx === steps.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

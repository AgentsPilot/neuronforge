'use client'

import { useState, CSSProperties } from 'react'
import type { StepStatus } from '@/hooks/useDebugStream'

interface WorkflowStep {
  id: string
  name: string
  type?: string
  description?: string
  action?: string
  plugin?: string
}

interface StepVisualizerProps {
  steps: WorkflowStep[]
  stepStatuses: Map<string, StepStatus>
  currentStepId: string | null
  onStepClick?: (stepId: string) => void
  style?: CSSProperties
}

export function StepVisualizer({
  steps,
  stepStatuses,
  currentStepId,
  onStepClick,
  style
}: StepVisualizerProps) {
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null)

  const getStatusIcon = (status: StepStatus['status']) => {
    switch (status) {
      case 'pending':
        return { icon: '\u23F3', color: '#6c757d', label: 'Pending' } // hourglass
      case 'running':
        return { icon: '\u25B6\uFE0F', color: '#007bff', label: 'Running' } // play
      case 'completed':
        return { icon: '\u2705', color: '#28a745', label: 'Completed' } // check
      case 'failed':
        return { icon: '\u274C', color: '#dc3545', label: 'Failed' } // X
      case 'paused':
        return { icon: '\u23F8\uFE0F', color: '#ffc107', label: 'Paused' } // pause
      default:
        return { icon: '\u2B55', color: '#6c757d', label: 'Unknown' }
    }
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return null
    if (ms < 1000) return `${ms}ms`
    return `${(ms / 1000).toFixed(2)}s`
  }

  const formatJson = (data: any) => {
    if (!data) return null
    try {
      return JSON.stringify(data, null, 2)
    } catch {
      return String(data)
    }
  }

  const handleStepClick = (stepId: string) => {
    setExpandedStepId(expandedStepId === stepId ? null : stepId)
    onStepClick?.(stepId)
  }

  if (steps.length === 0) {
    return (
      <div style={{
        padding: '20px',
        textAlign: 'center',
        color: '#6c757d',
        backgroundColor: '#f8f9fa',
        borderRadius: '6px',
        border: '1px dashed #dee2e6',
        ...style
      }}>
        No workflow steps found. Select an agent with pilot_steps to see the step visualization.
      </div>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      ...style
    }}>
      {steps.map((step, index) => {
        const status = stepStatuses.get(step.id) || { status: 'pending' as const, stepId: step.id, stepName: step.name }
        const statusInfo = getStatusIcon(status.status)
        const isExpanded = expandedStepId === step.id
        const isCurrent = currentStepId === step.id
        const isRunning = status.status === 'running'

        return (
          <div key={step.id}>
            {/* Step Row */}
            <div
              onClick={() => handleStepClick(step.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 15px',
                backgroundColor: isCurrent ? '#e7f3ff' : isExpanded ? '#f8f9fa' : 'white',
                border: `1px solid ${isCurrent ? '#007bff' : '#dee2e6'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                position: 'relative',
                overflow: 'hidden'
              }}
            >
              {/* Running indicator animation */}
              {isRunning && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: '3px',
                  backgroundColor: '#007bff',
                  animation: 'progress 2s ease-in-out infinite',
                  width: '100%'
                }} />
              )}

              {/* Step Number */}
              <div style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: statusInfo.color,
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '12px',
                fontWeight: 'bold',
                flexShrink: 0
              }}>
                {index + 1}
              </div>

              {/* Step Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}>
                  <span style={{
                    fontWeight: 600,
                    color: '#333',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {step.name}
                  </span>
                  {step.type && (
                    <span style={{
                      fontSize: '11px',
                      padding: '2px 6px',
                      backgroundColor: '#e9ecef',
                      borderRadius: '3px',
                      color: '#495057'
                    }}>
                      {step.type}
                    </span>
                  )}
                </div>
                {step.description && (
                  <div style={{
                    fontSize: '12px',
                    color: '#6c757d',
                    marginTop: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}>
                    {step.description}
                  </div>
                )}
              </div>

              {/* Status Badge */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                flexShrink: 0
              }}>
                {status.duration && (
                  <span style={{
                    fontSize: '11px',
                    color: '#6c757d',
                    padding: '2px 6px',
                    backgroundColor: '#f8f9fa',
                    borderRadius: '3px'
                  }}>
                    {formatDuration(status.duration)}
                  </span>
                )}
                <span style={{ fontSize: '16px' }}>{statusInfo.icon}</span>
                <span style={{
                  fontSize: '12px',
                  fontWeight: 500,
                  color: statusInfo.color
                }}>
                  {statusInfo.label}
                </span>
              </div>

              {/* Expand Indicator */}
              <div style={{
                color: '#6c757d',
                transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s ease'
              }}>
                &#9660;
              </div>
            </div>

            {/* Expanded Details */}
            {isExpanded && (
              <div style={{
                marginLeft: '40px',
                marginTop: '4px',
                padding: '12px',
                backgroundColor: '#f8f9fa',
                borderRadius: '0 0 6px 6px',
                border: '1px solid #dee2e6',
                borderTop: 'none',
                fontSize: '13px'
              }}>
                {/* Step Config */}
                {(step.plugin || step.action) && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontWeight: 600, color: '#333', marginBottom: '4px' }}>
                      Configuration:
                    </div>
                    <div style={{ color: '#495057' }}>
                      {step.plugin && <span>Plugin: <code>{step.plugin}</code></span>}
                      {step.plugin && step.action && <span> | </span>}
                      {step.action && <span>Action: <code>{step.action}</code></span>}
                    </div>
                  </div>
                )}

                {/* Input Data */}
                {status.input && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontWeight: 600, color: '#333', marginBottom: '4px' }}>
                      Input:
                    </div>
                    <pre style={{
                      margin: 0,
                      padding: '8px',
                      backgroundColor: '#fff',
                      border: '1px solid #dee2e6',
                      borderRadius: '4px',
                      overflow: 'auto',
                      maxHeight: '150px',
                      fontSize: '12px'
                    }}>
                      {formatJson(status.input)}
                    </pre>
                  </div>
                )}

                {/* Output Data */}
                {status.output && (
                  <div style={{ marginBottom: '10px' }}>
                    <div style={{ fontWeight: 600, color: '#28a745', marginBottom: '4px' }}>
                      Output:
                    </div>
                    <pre style={{
                      margin: 0,
                      padding: '8px',
                      backgroundColor: '#f0fff0',
                      border: '1px solid #28a745',
                      borderRadius: '4px',
                      overflow: 'auto',
                      maxHeight: '200px',
                      fontSize: '12px'
                    }}>
                      {formatJson(status.output)}
                    </pre>
                  </div>
                )}

                {/* Error */}
                {status.error && (
                  <div>
                    <div style={{ fontWeight: 600, color: '#dc3545', marginBottom: '4px' }}>
                      Error:
                    </div>
                    <pre style={{
                      margin: 0,
                      padding: '8px',
                      backgroundColor: '#fff0f0',
                      border: '1px solid #dc3545',
                      borderRadius: '4px',
                      overflow: 'auto',
                      maxHeight: '100px',
                      fontSize: '12px',
                      color: '#dc3545'
                    }}>
                      {status.error}
                    </pre>
                  </div>
                )}

                {/* Timing */}
                {(status.startTime || status.endTime) && (
                  <div style={{
                    marginTop: '10px',
                    paddingTop: '10px',
                    borderTop: '1px solid #dee2e6',
                    fontSize: '11px',
                    color: '#6c757d'
                  }}>
                    {status.startTime && (
                      <span>Started: {new Date(status.startTime).toLocaleTimeString()}</span>
                    )}
                    {status.startTime && status.endTime && <span> | </span>}
                    {status.endTime && (
                      <span>Ended: {new Date(status.endTime).toLocaleTimeString()}</span>
                    )}
                    {status.duration && (
                      <span> | Duration: {formatDuration(status.duration)}</span>
                    )}
                  </div>
                )}

                {/* No data message */}
                {!status.input && !status.output && !status.error && status.status === 'pending' && (
                  <div style={{ color: '#6c757d', fontStyle: 'italic' }}>
                    Waiting to execute...
                  </div>
                )}
              </div>
            )}

            {/* Connector Line */}
            {index < steps.length - 1 && (
              <div style={{
                marginLeft: '27px',
                width: '2px',
                height: '8px',
                backgroundColor: '#dee2e6'
              }} />
            )}
          </div>
        )
      })}

      <style>{`
        @keyframes progress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(0%); }
          100% { transform: translateX(100%); }
        }
      `}</style>
    </div>
  )
}
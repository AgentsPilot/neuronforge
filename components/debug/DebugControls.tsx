'use client'

import { CSSProperties } from 'react'
import type { DebugState } from '@/hooks/useDebugStream'

interface DebugControlsProps {
  debugState: DebugState
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStep: () => void
  onStop: () => void
  onReset: () => void
  disabled?: boolean
  currentStepName?: string
  style?: CSSProperties
}

export function DebugControls({
  debugState,
  onStart,
  onPause,
  onResume,
  onStep,
  onStop,
  onReset,
  disabled = false,
  currentStepName,
  style
}: DebugControlsProps) {
  const isIdle = debugState === 'idle'
  const isRunning = debugState === 'running' || debugState === 'stepping'
  const isPaused = debugState === 'paused'
  const isActive = isRunning || isPaused || debugState === 'connecting'
  const isFinished = debugState === 'completed' || debugState === 'error' || debugState === 'stopped'

  const buttonStyle = (active: boolean, color: string): CSSProperties => ({
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 'bold',
    border: 'none',
    borderRadius: '4px',
    cursor: active && !disabled ? 'pointer' : 'not-allowed',
    opacity: active && !disabled ? 1 : 0.5,
    backgroundColor: color,
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    transition: 'all 0.2s ease'
  })

  const getStatusText = () => {
    switch (debugState) {
      case 'idle':
        return 'Ready to start'
      case 'connecting':
        return 'Connecting...'
      case 'running':
        return currentStepName ? `Running: ${currentStepName}` : 'Running...'
      case 'stepping':
        return currentStepName ? `Stepping: ${currentStepName}` : 'Stepping...'
      case 'paused':
        return currentStepName ? `Paused at: ${currentStepName}` : 'Paused'
      case 'stopped':
        return 'Stopped'
      case 'completed':
        return 'Completed'
      case 'error':
        return 'Error'
      default:
        return debugState
    }
  }

  const getStatusColor = () => {
    switch (debugState) {
      case 'idle':
        return '#6c757d'
      case 'connecting':
        return '#17a2b8'
      case 'running':
      case 'stepping':
        return '#007bff'
      case 'paused':
        return '#ffc107'
      case 'stopped':
        return '#6c757d'
      case 'completed':
        return '#28a745'
      case 'error':
        return '#dc3545'
      default:
        return '#6c757d'
    }
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      padding: '15px',
      backgroundColor: '#f8f9fa',
      borderRadius: '6px',
      border: '1px solid #dee2e6',
      ...style
    }}>
      {/* Status Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        paddingBottom: '10px',
        borderBottom: '1px solid #dee2e6'
      }}>
        <div style={{
          width: '12px',
          height: '12px',
          borderRadius: '50%',
          backgroundColor: getStatusColor(),
          animation: isRunning ? 'pulse 1.5s infinite' : 'none'
        }} />
        <span style={{
          fontSize: '14px',
          fontWeight: 500,
          color: '#333'
        }}>
          {getStatusText()}
        </span>
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }
        `}</style>
      </div>

      {/* Control Buttons */}
      <div style={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap'
      }}>
        {/* Start / Run Button - only when idle or finished */}
        {(isIdle || isFinished) && (
          <button
            onClick={onStart}
            disabled={disabled}
            style={buttonStyle(!disabled, '#28a745')}
            title="Start execution in debug mode"
          >
            <span>&#9654;</span> Start Debug
          </button>
        )}

        {/* Pause Button - only when running */}
        {isRunning && (
          <button
            onClick={onPause}
            disabled={disabled}
            style={buttonStyle(!disabled, '#ffc107')}
            title="Pause execution"
          >
            <span>&#10074;&#10074;</span> Pause
          </button>
        )}

        {/* Resume Button - only when paused */}
        {isPaused && (
          <button
            onClick={onResume}
            disabled={disabled}
            style={buttonStyle(!disabled, '#28a745')}
            title="Resume execution"
          >
            <span>&#9654;</span> Resume
          </button>
        )}

        {/* Step Button - only when paused */}
        {isPaused && (
          <button
            onClick={onStep}
            disabled={disabled}
            style={buttonStyle(!disabled, '#17a2b8')}
            title="Execute next step only"
          >
            <span>&#9654;|</span> Step
          </button>
        )}

        {/* Stop Button - when active */}
        {isActive && (
          <button
            onClick={onStop}
            disabled={disabled}
            style={buttonStyle(!disabled, '#dc3545')}
            title="Stop execution"
          >
            <span>&#9632;</span> Stop
          </button>
        )}

        {/* Reset Button - when finished */}
        {isFinished && (
          <button
            onClick={onReset}
            disabled={disabled}
            style={buttonStyle(!disabled, '#6c757d')}
            title="Reset and start over"
          >
            <span>&#8635;</span> Reset
          </button>
        )}
      </div>

      {/* Keyboard Shortcuts Hint */}
      <div style={{
        fontSize: '11px',
        color: '#6c757d',
        marginTop: '4px'
      }}>
        Tip: Use controls to pause between steps and inspect data
      </div>
    </div>
  )
}
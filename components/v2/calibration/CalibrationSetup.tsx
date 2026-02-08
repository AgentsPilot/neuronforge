/**
 * CalibrationSetup - Initial screen to start batch calibration
 *
 * Displays:
 * - Agent information
 * - Input parameter form (if agent has input parameters)
 * - Explanation of batch calibration process
 * - Start button
 */

'use client'

import React, { useState, useEffect } from 'react'
import { Card } from '@/components/v2/ui/card'
import {
  Play,
  Loader2,
  Sparkles,
  CheckCircle,
  AlertCircle,
  Wrench,
  Zap,
  PlayCircle,
  Search,
  Settings
} from 'lucide-react'
import { AgentInputFields } from '@/components/v2/AgentInputFields'

interface Agent {
  id: string
  agent_name: string
  description?: string
  pilot_steps?: any[]
  workflow_steps?: any[]
  input_parameters?: Array<{
    name: string
    type: string
    description?: string
    required?: boolean
    default?: any
  }>
}

interface CalibrationSetupProps {
  agent: Agent
  onRun: (inputValues: Record<string, any>) => void
  isRunning: boolean
  initialInputValues?: Record<string, any>
}

export function CalibrationSetup({ agent, onRun, isRunning, initialInputValues = {} }: CalibrationSetupProps) {
  const [inputValues, setInputValues] = useState<Record<string, any>>(initialInputValues)

  // Update inputValues when initialInputValues changes (e.g., after loading from API)
  useEffect(() => {
    if (initialInputValues && Object.keys(initialInputValues).length > 0) {
      console.log('[CalibrationSetup] Loading initial input values:', initialInputValues)
      setInputValues(initialInputValues)
    }
  }, [initialInputValues])

  const hasInputParams = agent.input_parameters && agent.input_parameters.length > 0

  const handleRun = () => {
    console.log('[CalibrationSetup] Running calibration with input values:', inputValues)
    console.log('[CalibrationSetup] Input values count:', Object.keys(inputValues).length)
    onRun(inputValues)
  }

  return (
    <div className="space-y-3 sm:space-y-4">

      {/* Header Card with Start Button */}
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg sm:text-xl font-semibold text-[var(--v2-text-primary)]">
                Test Run & Fix Issues
              </h3>
              <p className="text-sm text-[var(--v2-text-secondary)] mt-0.5">
                Run {agent.agent_name} to find and fix all issues at once
              </p>
            </div>
            <button
              onClick={handleRun}
              disabled={isRunning}
              className="flex items-center gap-2 px-4 py-2.5 bg-[var(--v2-primary)] text-white hover:opacity-90 transition-opacity font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
              style={{ borderRadius: 'var(--v2-radius-button)' }}
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  Start Test Run
                </>
              )}
            </button>
          </div>

          {/* Important Notice - Inline in header */}
          <div className="flex items-start gap-3 p-3 bg-[var(--v2-surface-hover)] border-l-4 border-l-[var(--v2-primary)] rounded-lg">
            <AlertCircle className="w-5 h-5 text-[var(--v2-primary)] flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-[var(--v2-text-primary)] mb-1">
                Important: This Runs Your Actual Workflow
              </h4>
              <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed mb-2">
                The test run will execute your workflow with real data and live connections. Please ensure:
              </p>
              <ul className="space-y-1 text-xs text-[var(--v2-text-secondary)]">
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-[var(--v2-primary)] flex-shrink-0 mt-0.5" />
                  <span>All required data sources are available and accessible</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-[var(--v2-primary)] flex-shrink-0 mt-0.5" />
                  <span>Your API connections (Google Sheets, Gmail, etc.) are properly configured</span>
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle className="w-3.5 h-3.5 text-[var(--v2-primary)] flex-shrink-0 mt-0.5" />
                  <span>You're ready to process real data (the workflow will execute fully)</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Card>

      {/* How It Works */}
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-5">
        <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-3">
          How It Works
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

          {/* Step 1 - Run */}
          <div className="flex flex-col p-3 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface-hover)]">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--v2-primary)]/10 flex items-center justify-center">
                <PlayCircle className="w-5 h-5 text-[var(--v2-primary)]" />
              </div>
              <h4 className="text-sm font-semibold text-[var(--v2-text-primary)]">Run</h4>
            </div>
            <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed">
              Execute your workflow and collect all issues
            </p>
          </div>

          {/* Step 2 - Review */}
          <div className="flex flex-col p-3 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface-hover)]">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--v2-primary)]/10 flex items-center justify-center">
                <Search className="w-5 h-5 text-[var(--v2-primary)]" />
              </div>
              <h4 className="text-sm font-semibold text-[var(--v2-text-primary)]">Review</h4>
            </div>
            <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed">
              See all issues grouped in one view
            </p>
          </div>

          {/* Step 3 - Fix */}
          <div className="flex flex-col p-3 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface-hover)]">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="w-8 h-8 rounded-lg bg-[var(--v2-primary)]/10 flex items-center justify-center">
                <Settings className="w-5 h-5 text-[var(--v2-primary)]" />
              </div>
              <h4 className="text-sm font-semibold text-[var(--v2-text-primary)]">Fix</h4>
            </div>
            <p className="text-xs text-[var(--v2-text-secondary)] leading-relaxed">
              Apply all fixes at once and you're done!
            </p>
          </div>

        </div>
      </Card>

      {/* What We'll Check */}
      <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-5">
        <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-3">
          What We'll Check
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">

          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface-hover)]">
            <AlertCircle className="w-4 h-4 text-[#EF4444] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--v2-text-primary)]">Configuration Errors</p>
              <p className="text-xs text-[var(--v2-text-secondary)] mt-0.5">
                Invalid values or missing settings
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface-hover)]">
            <Wrench className="w-4 h-4 text-[#8B5CF6] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--v2-text-primary)]">Data Mismatches</p>
              <p className="text-xs text-[var(--v2-text-secondary)] mt-0.5">
                Format issues we can auto-fix
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface-hover)]">
            <Zap className="w-4 h-4 text-[#F59E0B] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--v2-text-primary)]">Hard-coded Values</p>
              <p className="text-xs text-[var(--v2-text-secondary)] mt-0.5">
                Values that should be flexible
              </p>
            </div>
          </div>

          <div className="flex items-start gap-2 p-2.5 rounded-lg border border-[var(--v2-border)] bg-[var(--v2-surface-hover)]">
            <CheckCircle className="w-4 h-4 text-[#10B981] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-[var(--v2-text-primary)]">Logic Issues</p>
              <p className="text-xs text-[var(--v2-text-secondary)] mt-0.5">
                Missing steps or broken flow
              </p>
            </div>
          </div>

        </div>
      </Card>

      {/* Input Parameters */}
      {hasInputParams && (
        <Card className="border-[var(--v2-border)] bg-[var(--v2-surface)] !p-4 sm:!p-5">
          <h3 className="text-base font-semibold text-[var(--v2-text-primary)] mb-1">
            Input Values
          </h3>
          <p className="text-sm text-[var(--v2-text-secondary)] mb-3">
            Optional - leave empty to use default values
          </p>
          <AgentInputFields
            schema={agent.input_parameters || []}
            values={inputValues}
            onChange={(name: string, value: any) => {
              setInputValues(prev => ({ ...prev, [name]: value }))
            }}
          />
        </Card>
      )}

    </div>
  )
}

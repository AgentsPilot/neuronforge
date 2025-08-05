// components/orchestration/components/testing/WorkflowTester.tsx
import React, { useState, useCallback } from 'react'
import { Play, Square, RotateCcw, Zap, Clock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { WorkflowStep, TestResult } from '../../types/workflow'
import { simulateStepTest } from '../../../../lib/utils/testingHelpers'

interface WorkflowTesterProps {
  steps: WorkflowStep[]
  onTestComplete: (results: TestResult[]) => void
  onStepTestComplete?: (stepIndex: number, result: TestResult) => void
}

interface WorkflowTestState {
  isRunning: boolean
  currentStep: number
  results: TestResult[]
  startTime?: Date
  endTime?: Date
}

export const WorkflowTester: React.FC<WorkflowTesterProps> = ({
  steps,
  onTestComplete,
  onStepTestComplete
}) => {
  const [testState, setTestState] = useState<WorkflowTestState>({
    isRunning: false,
    currentStep: -1,
    results: []
  })

  const runFullWorkflow = useCallback(async () => {
    const stepsWithAgents = steps.filter(step => step.selectedAgent)
    if (stepsWithAgents.length === 0) return

    setTestState({
      isRunning: true,
      currentStep: 0,
      results: [],
      startTime: new Date()
    })

    const results: TestResult[] = []

    for (let i = 0; i < stepsWithAgents.length; i++) {
      const step = stepsWithAgents[i]
      const stepIndex = steps.findIndex(s => s.id === step.id)
      
      setTestState(prev => ({
        ...prev,
        currentStep: i
      }))

      try {
        // Simulate step execution
        const result = await simulateStepTest(step, stepIndex)
        results.push(result)
        
        if (onStepTestComplete) {
          onStepTestComplete(stepIndex, result)
        }

        // If step failed and not configured to continue on error, stop
        if (result.status === 'error') {
          console.warn(`Step ${stepIndex + 1} failed, stopping workflow test`)
          break
        }

        // Small delay between steps to show progress
        await new Promise(resolve => setTimeout(resolve, 500))
      } catch (error) {
        const errorResult: TestResult = {
          stepId: step.id.toString(),
          stepName: step.selectedAgent?.name || `Step ${stepIndex + 1}`,
          status: 'error',
          message: '❌ Workflow test failed',
          timestamp: new Date(),
          error: error instanceof Error ? error.message : 'Unknown error'
        }
        results.push(errorResult)
        break
      }
    }

    setTestState(prev => ({
      ...prev,
      isRunning: false,
      currentStep: -1,
      endTime: new Date(),
      results
    }))

    onTestComplete(results)
  }, [steps, onTestComplete, onStepTestComplete])

  const stopWorkflow = useCallback(() => {
    setTestState(prev => ({
      ...prev,
      isRunning: false,
      currentStep: -1,
      endTime: new Date()
    }))
  }, [])

  const resetTests = useCallback(() => {
    setTestState({
      isRunning: false,
      currentStep: -1,
      results: []
    })
  }, [])

  const stepsWithAgents = steps.filter(step => step.selectedAgent)
  const totalDuration = testState.startTime && testState.endTime 
    ? testState.endTime.getTime() - testState.startTime.getTime()
    : 0

  const successCount = testState.results.filter(r => r.status === 'success').length
  const errorCount = testState.results.filter(r => r.status === 'error').length
  const warningCount = testState.results.filter(r => r.status === 'warning').length

  return (
    <div className="border border-slate-200 rounded-lg p-6 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-lg flex items-center justify-center">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Full Workflow Test</h3>
            <p className="text-sm text-slate-600">
              Test all {stepsWithAgents.length} configured steps sequentially
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {testState.results.length > 0 && (
            <button
              onClick={resetTests}
              disabled={testState.isRunning}
              className="px-3 py-2 text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors flex items-center gap-2 text-sm disabled:opacity-50"
            >
              <RotateCcw className="h-4 w-4" />
              Reset
            </button>
          )}
          
          {!testState.isRunning ? (
            <button
              onClick={runFullWorkflow}
              disabled={stepsWithAgents.length === 0}
              className="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg hover:from-purple-700 hover:to-indigo-700 transition-all disabled:from-slate-400 disabled:to-slate-400 disabled:cursor-not-allowed flex items-center gap-2 font-medium"
            >
              <Play className="h-4 w-4" />
              Run Full Test
            </button>
          ) : (
            <button
              onClick={stopWorkflow}
              className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors flex items-center gap-2 font-medium"
            >
              <Square className="h-4 w-4" />
              Stop Test
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      {testState.isRunning && (
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm text-slate-600 mb-2">
            <span>Testing Step {testState.currentStep + 1} of {stepsWithAgents.length}</span>
            <span>{Math.round(((testState.currentStep + 1) / stepsWithAgents.length) * 100)}%</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div 
              className="bg-gradient-to-r from-purple-600 to-indigo-600 h-2 rounded-full transition-all duration-500"
              style={{ width: `${((testState.currentStep + 1) / stepsWithAgents.length) * 100}%` }}
            ></div>
          </div>
          {testState.currentStep >= 0 && testState.currentStep < stepsWithAgents.length && (
            <p className="text-sm text-slate-600 mt-2">
              Currently testing: {stepsWithAgents[testState.currentStep]?.title}
            </p>
          )}
        </div>
      )}

      {/* Results Summary */}
      {testState.results.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">Duration</span>
            </div>
            <div className="text-lg font-semibold text-slate-900">
              {totalDuration > 0 ? `${totalDuration}ms` : 'Running...'}
            </div>
          </div>

          <div className="bg-green-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium text-green-700">Success</span>
            </div>
            <div className="text-lg font-semibold text-green-900">
              {successCount}
            </div>
          </div>

          <div className="bg-amber-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium text-amber-700">Warnings</span>
            </div>
            <div className="text-lg font-semibold text-amber-900">
              {warningCount}
            </div>
          </div>

          <div className="bg-red-50 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-1">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium text-red-700">Errors</span>
            </div>
            <div className="text-lg font-semibold text-red-900">
              {errorCount}
            </div>
          </div>
        </div>
      )}

      {/* Step Results Preview */}
      {testState.results.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-700 mb-3">Test Results</h4>
          {testState.results.map((result, index) => (
            <div 
              key={result.stepId}
              className={`flex items-center justify-between p-3 rounded-lg border ${
                result.status === 'success' ? 'bg-green-50 border-green-200' :
                result.status === 'error' ? 'bg-red-50 border-red-200' :
                result.status === 'warning' ? 'bg-amber-50 border-amber-200' :
                'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="flex items-center gap-3">
                {result.status === 'success' && <CheckCircle className="h-4 w-4 text-green-600" />}
                {result.status === 'error' && <XCircle className="h-4 w-4 text-red-600" />}
                {result.status === 'warning' && <AlertTriangle className="h-4 w-4 text-amber-600" />}
                
                <div>
                  <div className="font-medium text-sm text-slate-900">
                    {result.stepName}
                  </div>
                  <div className="text-xs text-slate-600">
                    {result.message}
                  </div>
                </div>
              </div>
              
              <div className="text-xs text-slate-500">
                {result.duration ? `${result.duration}ms` : 'N/A'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* No Steps Message */}
      {stepsWithAgents.length === 0 && (
        <div className="text-center py-8 text-slate-500">
          <Zap className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <h4 className="font-medium mb-1">No Steps to Test</h4>
          <p className="text-sm">Add agents to your workflow steps to enable testing.</p>
        </div>
      )}
    </div>
  )
}
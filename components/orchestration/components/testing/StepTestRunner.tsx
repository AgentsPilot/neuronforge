import { useState } from 'react'
import { TestTube2, Play, RefreshCw, Check, X } from 'lucide-react'
import { WorkflowStep, TestResult } from '../../types/workflow'
import { simulateStepTest } from '../../../../lib/utils/testingHelpers'

interface StepTestRunnerProps {
  step: WorkflowStep
  stepIndex: number
  onTestComplete: (result: TestResult) => void
}

export const StepTestRunner = ({ step, stepIndex, onTestComplete }: StepTestRunnerProps) => {
  const [isRunning, setIsRunning] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  const runStepTest = async () => {
    if (!step.selectedAgent) return

    setIsRunning(true)
    
    try {
      const result = await simulateStepTest(step, stepIndex)
      setTestResult(result)
      onTestComplete(result)
    } catch (error) {
      const errorResult: TestResult = {
        stepId: step.id.toString(),
        stepName: step.selectedAgent?.name || `Step ${stepIndex + 1}`,
        status: 'error',
        message: '❌ Test failed with error',
        timestamp: new Date(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }
      
      setTestResult(errorResult)
      onTestComplete(errorResult)
    }
    
    setIsRunning(false)
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TestTube2 className="h-4 w-4 text-slate-600" />
          <span className="font-medium text-slate-900">Test Step {stepIndex + 1}</span>
        </div>
        <button
          onClick={runStepTest}
          disabled={isRunning || !step.selectedAgent}
          className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-400 text-white text-sm rounded-md transition-colors flex items-center gap-2"
        >
          {isRunning ? (
            <>
              <RefreshCw className="h-3 w-3 animate-spin" />
              Testing...
            </>
          ) : (
            <>
              <Play className="h-3 w-3" />
              Run Test
            </>
          )}
        </button>
      </div>

      {testResult && (
        <div className={`p-3 rounded-lg ${
          testResult.status === 'success' ? 'bg-green-50 border border-green-200' :
          testResult.status === 'error' ? 'bg-red-50 border border-red-200' :
          'bg-blue-50 border border-blue-200'
        }`}>
          <div className="flex items-center gap-2 mb-2">
            {testResult.status === 'success' && <Check className="h-4 w-4 text-green-600" />}
            {testResult.status === 'error' && <X className="h-4 w-4 text-red-600" />}
            {testResult.status === 'running' && <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />}
            <span className={`text-sm font-medium ${
              testResult.status === 'success' ? 'text-green-900' :
              testResult.status === 'error' ? 'text-red-900' :
              'text-blue-900'
            }`}>
              {testResult.message}
            </span>
          </div>
          
          {testResult.duration && (
            <p className="text-xs text-slate-600">Duration: {testResult.duration}ms</p>
          )}
          
          {testResult.output && (
            <div className="mt-2 text-xs">
              <div className="font-medium text-slate-700">Output:</div>
              <pre className="bg-white p-2 rounded border text-slate-600 mt-1">
                {JSON.stringify(testResult.output, null, 2)}
              </pre>
            </div>
          )}
          
          {testResult.error && (
            <div className="mt-2 text-xs">
              <div className="font-medium text-red-700">Error:</div>
              <p className="text-red-600 mt-1">{testResult.error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
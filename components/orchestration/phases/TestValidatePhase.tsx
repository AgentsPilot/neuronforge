import { useState } from 'react'
import { TestTube2, Play, Activity, Eye, RefreshCw, Check, X } from 'lucide-react'
import { WorkflowStep, Phase } from '../types/workflow'
import { simulateStepTest, simulateWorkflowExecution, formatDuration } from '../../../lib/utils/testingHelpers'

interface TestValidatePhaseProps {
  steps: WorkflowStep[]
  onUpdateStep: (index: number, updates: Partial<WorkflowStep>) => void
  onPhaseChange: (phase: Phase) => void
  onNext: () => void
}

export const TestValidatePhase = ({
  steps,
  onUpdateStep,
  onPhaseChange,
  onNext
}: TestValidatePhaseProps) => {
  const [runningTests, setRunningTests] = useState<Set<number>>(new Set())
  const [workflowRunning, setWorkflowRunning] = useState(false)
  const [currentExecutingStep, setCurrentExecutingStep] = useState(-1)
  const [executionLog, setExecutionLog] = useState<any[]>([])

  const configuredSteps = steps.filter(step => step.selectedAgent && step.configurationComplete)

  const runStepTest = async (stepIndex: number) => {
    const step = steps[stepIndex]
    if (!step.selectedAgent) return

    setRunningTests(prev => new Set([...prev, stepIndex]))
    
    try {
      const result = await simulateStepTest(step, stepIndex)
      
      // Update step with test result
      const updatedTestResults = [...(step.testResults || []), result]
      onUpdateStep(stepIndex, { testResults: updatedTestResults })
      
    } catch (error) {
      console.error('Test failed:', error)
    } finally {
      setRunningTests(prev => {
        const newSet = new Set(prev)
        newSet.delete(stepIndex)
        return newSet
      })
    }
  }

  const runFullWorkflowTest = async () => {
    setWorkflowRunning(true)
    setCurrentExecutingStep(0)
    setExecutionLog([])
    
    const results = await simulateWorkflowExecution(
      steps,
      (stepIndex, status, message) => {
        setCurrentExecutingStep(stepIndex)
        setExecutionLog(prev => [...prev, {
          stepIndex,
          status,
          message,
          timestamp: new Date()
        }])
      }
    )
    
    setWorkflowRunning(false)
    setCurrentExecutingStep(-1)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-gradient-to-r from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center">
            <TestTube2 className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-slate-900">
              Phase 4: Test & Validate
            </h3>
            <p className="text-slate-600">Test your workflow with sample data before going live</p>
          </div>
        </div>

        {/* Testing Interface */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div>
            <h4 className="text-lg font-semibold text-slate-900 mb-4">Individual Step Testing</h4>
            <div className="space-y-4">
              {steps.map((step, index) => {
                const isRunning = runningTests.has(index)
                const lastTestResult = step.testResults?.[step.testResults.length - 1]
                
                return (
                  <div key={step.id} className="bg-white rounded-lg border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h5 className="font-medium text-slate-900">Step {index + 1}: {step.title}</h5>
                        <p className="text-sm text-slate-600">{step.selectedAgent?.name || 'No agent assigned'}</p>
                      </div>
                      <button
                        onClick={() => runStepTest(index)}
                        disabled={isRunning || !step.selectedAgent}
                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-slate-400 transition-colors flex items-center gap-2"
                      >
                        {isRunning ? (
                          <>
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Testing...
                          </>
                        ) : (
                          <>
                            <Play className="h-4 w-4" />
                            Test Step
                          </>
                        )}
                      </button>
                    </div>
                    
                    {/* Test Result Display */}
                    {lastTestResult && (
                      <div className={`mt-3 p-3 rounded-lg border ${
                        lastTestResult.status === 'success' ? 'bg-green-50 border-green-200' :
                        lastTestResult.status === 'error' ? 'bg-red-50 border-red-200' :
                        'bg-blue-50 border-blue-200'
                      }`}>
                        <div className="flex items-center gap-2 mb-2">
                          {lastTestResult.status === 'success' && <Check className="h-4 w-4 text-green-600" />}
                          {lastTestResult.status === 'error' && <X className="h-4 w-4 text-red-600" />}
                          {lastTestResult.status === 'running' && <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />}
                          <span className={`text-sm font-medium ${
                            lastTestResult.status === 'success' ? 'text-green-900' :
                            lastTestResult.status === 'error' ? 'text-red-900' :
                            'text-blue-900'
                          }`}>
                            {lastTestResult.message}
                          </span>
                        </div>
                        
                        {lastTestResult.duration && (
                          <p className="text-xs text-slate-600">
                            Duration: {formatDuration(lastTestResult.duration)}
                          </p>
                        )}
                        
                        {lastTestResult.output && (
                          <div className="mt-2 text-xs">
                            <div className="font-medium text-slate-700">Output:</div>
                            <div className="text-slate-600 mt-1">
                              Processed: {lastTestResult.output.processed} items, 
                              Created: {lastTestResult.output.created} records
                            </div>
                          </div>
                        )}
                        
                        {lastTestResult.error && (
                          <div className="mt-2 text-xs">
                            <div className="font-medium text-red-700">Error:</div>
                            <p className="text-red-600 mt-1">{lastTestResult.error}</p>
                          </div>
                        )}
                      </div>
                    )}
                    
                    {!lastTestResult && (
                      <div className="text-xs text-slate-500">
                        Last tested: Never
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          <div>
            <h4 className="text-lg font-semibold text-slate-900 mb-4">End-to-End Testing</h4>
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Play className="h-8 w-8 text-purple-600" />
                </div>
                <h5 className="text-lg font-medium text-slate-900 mb-2">Run Full Workflow Test</h5>
                <p className="text-sm text-slate-600 mb-4">
                  Test the complete workflow from start to finish with sample data
                </p>
                <button 
                  onClick={runFullWorkflowTest}
                  disabled={workflowRunning || configuredSteps.length === 0}
                  className="px-6 py-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 disabled:bg-slate-400 transition-colors font-semibold flex items-center gap-2 mx-auto"
                >
                  {workflowRunning ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Running Test...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4" />
                      Start End-to-End Test
                    </>
                  )}
                </button>
              </div>

              {/* Live Workflow Execution */}
              {(workflowRunning || executionLog.length > 0) && (
                <div className="border-t border-slate-200 pt-4">
                  <h6 className="font-medium text-slate-900 mb-4 flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Live Execution
                  </h6>
                  
                  {/* Step Progress Indicators */}
                  <div className="grid grid-cols-1 gap-2 mb-4">
                    {configuredSteps.map((step, index) => {
                      const stepIndex = steps.findIndex(s => s.id === step.id)
                      const isCurrentStep = currentExecutingStep === stepIndex
                      const isCompleted = executionLog.some(log => 
                        log.stepIndex === stepIndex && (log.status === 'success' || log.status === 'error')
                      )
                      
                      return (
                        <div
                          key={step.id}
                          className={`p-2 rounded-lg border-2 transition-all text-sm ${
                            isCurrentStep && workflowRunning
                              ? 'border-blue-400 bg-blue-50 shadow-md'
                              : isCompleted
                              ? 'border-green-400 bg-green-50'
                              : 'border-slate-200 bg-white'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs font-semibold ${
                              isCurrentStep && workflowRunning
                                ? 'bg-blue-600 text-white'
                                : isCompleted
                                ? 'bg-green-600 text-white'
                                : 'bg-slate-300 text-slate-600'
                            }`}>
                              {isCompleted ? <Check className="h-2 w-2" /> : stepIndex + 1}
                            </div>
                            <span className="font-medium text-slate-900">
                              {step.selectedAgent?.name}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Execution Log */}
                  {executionLog.length > 0 && (
                    <div className="bg-slate-900 rounded-lg p-4 max-h-40 overflow-y-auto">
                      <h6 className="text-white font-medium mb-3 flex items-center gap-2">
                        <Eye className="h-4 w-4" />
                        Execution Log
                      </h6>
                      <div className="space-y-1 font-mono text-sm">
                        {executionLog.map((entry, index) => (
                          <div key={index} className="flex items-start gap-3">
                            <span className="text-slate-400 text-xs">
                              {entry.timestamp.toLocaleTimeString()}
                            </span>
                            <span className={`${
                              entry.status === 'success' ? 'text-green-400' :
                              entry.status === 'error' ? 'text-red-400' :
                              'text-blue-400'
                            }`}>
                              {entry.message}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Navigation */}
        <div className="flex justify-between mt-8 pt-6 border-t border-slate-200">
          <button
            onClick={() => onPhaseChange('configure')}
            className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
          >
            ← Back to Configure
          </button>
          <button
            onClick={onNext}
            className="px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all"
          >
            Deploy Workflow →
          </button>
        </div>
      </div>
    </div>
  )
}
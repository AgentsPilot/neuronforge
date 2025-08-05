// components/orchestration/phases/TestValidatePhase.tsx
import React, { useState, useCallback } from 'react'
import { TestTube, CheckCircle, AlertTriangle, Beaker } from 'lucide-react'
import { WorkflowStep, Connection, TestResult } from '../types/workflow'

// Import the modular testing components
import { StepTestRunner } from '../components/testing/StepTestRunner'
import { WorkflowTester } from '../components/testing/WorkflowTester'
import { TestResults } from '../components/testing/TestResults'

interface TestValidatePhaseProps {
  steps: WorkflowStep[]
  connections: Connection[]
  onStepsChange: (steps: WorkflowStep[]) => void
  onPhaseComplete: () => void
  onPreviousPhase: () => void
}

export const TestValidatePhase: React.FC<TestValidatePhaseProps> = ({
  steps,
  connections,
  onStepsChange,
  onPhaseComplete,
  onPreviousPhase
}) => {
  const [stepResults, setStepResults] = useState<Record<number, TestResult>>({})
  const [workflowResults, setWorkflowResults] = useState<TestResult[]>([])
  const [activeTab, setActiveTab] = useState<'individual' | 'workflow' | 'results'>('individual')

  const handleStepTestComplete = useCallback((stepIndex: number, result: TestResult) => {
    setStepResults(prev => ({
      ...prev,
      [stepIndex]: result
    }))
  }, [])

  const handleWorkflowTestComplete = useCallback((results: TestResult[]) => {
    setWorkflowResults(results)
    setActiveTab('results')
  }, [])

  const handleWorkflowStepTestComplete = useCallback((stepIndex: number, result: TestResult) => {
    // Update individual step results when running full workflow
    handleStepTestComplete(stepIndex, result)
  }, [handleStepTestComplete])

  // Calculate totals
  const stepsWithAgents = steps.filter(step => step.selectedAgent)
  const testedSteps = Object.keys(stepResults).length
  const successfulTests = Object.values(stepResults).filter(r => r.status === 'success').length
  const failedTests = Object.values(stepResults).filter(r => r.status === 'error').length

  const allStepsTested = testedSteps === stepsWithAgents.length
  const allTestsPassed = successfulTests === stepsWithAgents.length && failedTests === 0

  return (
    <div className="space-y-6">
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/60 p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-gradient-to-r from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center shadow-lg">
              <TestTube className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Test & Validate Workflow</h1>
              <p className="text-slate-600">Test individual steps and validate the complete workflow</p>
            </div>
          </div>
          
          <div className="text-right">
            <div className="text-2xl font-bold text-slate-900">{successfulTests}/{stepsWithAgents.length}</div>
            <div className="text-sm text-slate-600">Steps Passing</div>
            {allTestsPassed && stepsWithAgents.length > 0 ? (
              <div className="flex items-center gap-1 text-green-600 mt-1">
                <CheckCircle className="h-4 w-4" />
                <span className="text-xs font-medium">All tests passing!</span>
              </div>
            ) : failedTests > 0 ? (
              <div className="flex items-center gap-1 text-red-600 mt-1">
                <AlertTriangle className="h-4 w-4" />
                <span className="text-xs font-medium">{failedTests} test{failedTests !== 1 ? 's' : ''} failing</span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 mb-6 bg-slate-100 rounded-lg p-1">
          <button
            onClick={() => setActiveTab('individual')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'individual'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Individual Steps ({stepsWithAgents.length})
          </button>
          <button
            onClick={() => setActiveTab('workflow')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'workflow'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Full Workflow
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              activeTab === 'results'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Test Results {workflowResults.length > 0 && `(${workflowResults.length})`}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'individual' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Test Individual Steps</h2>
              <p className="text-sm text-slate-600">
                Test each step independently to verify configuration and functionality
              </p>
            </div>

            {stepsWithAgents.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {stepsWithAgents.map((step, index) => {
                  const stepIndex = steps.findIndex(s => s.id === step.id)
                  return (
                    <StepTestRunner
                      key={step.id}
                      step={step}
                      stepIndex={stepIndex}
                      onTestComplete={(result) => handleStepTestComplete(stepIndex, result)}
                    />
                  )
                })}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-6xl mb-4">🔬</div>
                <h3 className="text-xl font-semibold text-slate-900 mb-2">No Steps to Test</h3>
                <p className="text-slate-600 mb-6">
                  Configure agents for your workflow steps to enable testing.
                </p>
                <button 
                  onClick={onPreviousPhase}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                >
                  ← Back to Configuration
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'workflow' && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-lg font-semibold text-slate-900 mb-2">Full Workflow Test</h2>
              <p className="text-slate-600">
                Run all configured steps sequentially to test the complete workflow
              </p>
            </div>

            <WorkflowTester
              steps={steps}
              onTestComplete={handleWorkflowTestComplete}
              onStepTestComplete={handleWorkflowStepTestComplete}
            />

            {/* Workflow Visualization */}
            {stepsWithAgents.length > 0 && (
              <div className="border border-slate-200 rounded-lg p-6 bg-white">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Workflow Overview</h3>
                <div className="flex items-center justify-between">
                  {stepsWithAgents.map((step, index) => {
                    const stepIndex = steps.findIndex(s => s.id === step.id)
                    const result = stepResults[stepIndex]
                    
                    return (
                      <React.Fragment key={step.id}>
                        <div className="flex flex-col items-center">
                          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold border-2 ${
                            result?.status === 'success' ? 'bg-green-100 border-green-300 text-green-700' :
                            result?.status === 'error' ? 'bg-red-100 border-red-300 text-red-700' :
                            'bg-slate-100 border-slate-300 text-slate-700'
                          }`}>
                            {stepIndex + 1}
                          </div>
                          <div className="text-xs text-center mt-2 max-w-20">
                            <div className="font-medium text-slate-900 truncate">{step.title}</div>
                            <div className="text-slate-600 truncate">{step.selectedAgent?.name}</div>
                          </div>
                        </div>
                        
                        {index < stepsWithAgents.length - 1 && (
                          <div className="flex-1 h-0.5 bg-slate-200 mx-4"></div>
                        )}
                      </React.Fragment>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'results' && (
          <div>
            <TestResults
              results={workflowResults.length > 0 ? workflowResults : Object.values(stepResults)}
              title={workflowResults.length > 0 ? "Workflow Test Results" : "Individual Step Results"}
              showExport={true}
            />
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between items-center mt-8 pt-6 border-t border-slate-200">
          <button 
            onClick={onPreviousPhase}
            className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-medium"
          >
            ← Back to Configuration
          </button>
          
          <div className="flex items-center gap-4">
            {allTestsPassed && stepsWithAgents.length > 0 && (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                <span className="text-sm font-medium">All tests passing!</span>
              </div>
            )}
            
            <button 
              onClick={onPhaseComplete}
              className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                allTestsPassed && stepsWithAgents.length > 0
                  ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg'
                  : 'bg-slate-200 text-slate-500 cursor-not-allowed'
              }`}
              disabled={!allTestsPassed || stepsWithAgents.length === 0}
            >
              Complete Workflow →
            </button>
          </div>
        </div>
      </div>

      {/* Quick Stats Panel */}
      {Object.keys(stepResults).length > 0 && (
        <div className="bg-white/60 backdrop-blur-sm rounded-xl border border-white/40 p-6">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Testing Summary</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-slate-900">{testedSteps}</div>
              <div className="text-sm text-slate-600">Steps Tested</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{successfulTests}</div>
              <div className="text-sm text-slate-600">Successful</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{failedTests}</div>
              <div className="text-sm text-slate-600">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {Math.round((successfulTests / Math.max(testedSteps, 1)) * 100)}%
              </div>
              <div className="text-sm text-slate-600">Success Rate</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
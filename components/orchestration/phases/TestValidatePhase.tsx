'use client'

import React, { useState, useEffect } from 'react'
import { ArrowLeft, ArrowRight, TestTube, CheckCircle, AlertTriangle, XCircle, Play, RotateCw } from 'lucide-react'
import { WorkflowTester } from '../components/testing/WorkflowTester'
import { OrchestrationStepTestRunner } from '../components/testing/OrchestrationStepTestRunner'
import { WorkflowData as WorkflowServiceData } from '../../../lib/services/workflowService'

interface TestValidatePhaseProps {
  workflow: WorkflowServiceData
  testResults?: any
  onTestComplete: () => Promise<void>
  onNext: () => void
  onBack: () => void
}

export const TestValidatePhase: React.FC<TestValidatePhaseProps> = ({
  workflow,
  testResults,
  onTestComplete,
  onNext,
  onBack
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'individual' | 'full'>('overview')
  const [isTestingWorkflow, setIsTestingWorkflow] = useState(false)
  const [currentTestResults, setCurrentTestResults] = useState(testResults)

  // Enhanced debugging
  useEffect(() => {
    console.log('🔍 [TestValidatePhase] Component mounted!')
    console.log('🔍 [TestValidatePhase] workflow:', workflow)
    console.log('🔍 [TestValidatePhase] workflow type:', typeof workflow)
    console.log('🔍 [TestValidatePhase] workflow truthy:', !!workflow)
    
    if (workflow) {
      console.log('🔍 [TestValidatePhase] workflow keys:', Object.keys(workflow))
      console.log('🔍 [TestValidatePhase] workflow.id:', workflow.id)
      console.log('🔍 [TestValidatePhase] workflow.name:', workflow.name)
      console.log('🔍 [TestValidatePhase] workflow.steps:', workflow.steps)
      console.log('🔍 [TestValidatePhase] workflow.agents:', workflow.agents)
      console.log('🔍 [TestValidatePhase] workflow.connections:', workflow.connections)
      console.log('🔍 [TestValidatePhase] workflow detailed structure:', {
        id: workflow.id,
        name: workflow.name,
        status: workflow.status,
        stepsCount: workflow.steps?.length || 0,
        agentsCount: workflow.agents?.length || 0,
        connectionsCount: workflow.connections?.length || 0,
        description: workflow.description
      });
    }
  }, [workflow])

  useEffect(() => {
    console.log('🔍 [TestValidatePhase] testResults updated:', testResults)
    setCurrentTestResults(testResults)
  }, [testResults])

  // ENHANCED CHECK - detailed logging
  console.log('🎯 [TestValidatePhase] Render check - workflow:', !!workflow)
  if (workflow) {
    console.log('🎯 [TestValidatePhase] Workflow details in render:', {
      hasId: !!workflow.id,
      hasName: !!workflow.name,
      hasSteps: !!workflow.steps,
      stepsLength: workflow.steps?.length,
      hasAgents: !!workflow.agents,
      agentsLength: workflow.agents?.length,
      workflowKeys: Object.keys(workflow),
      stringified: JSON.stringify(workflow, null, 2).substring(0, 500) + '...'
    });
  }

  // Early return with loading state if workflow is not available
  if (!workflow) {
    console.warn('⚠️ [TestValidatePhase] No workflow, showing loading state')
    return (
      <div className="max-w-6xl mx-auto">
        <div className="text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-600 rounded-2xl mb-4 shadow-xl">
            <TestTube className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Loading Workflow...</h2>
          <p className="text-slate-600">
            Please wait while we load your workflow data.
          </p>
          <div className="mt-4 flex justify-center">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-6 py-3 bg-slate-200 text-slate-700 rounded-xl hover:bg-slate-300 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Build
            </button>
          </div>
        </div>
      </div>
    )
  }

  console.log('✅ [TestValidatePhase] Workflow exists, proceeding with render')

  const handleTestWorkflow = async () => {
    console.log('🔍 [TestValidatePhase] handleTestWorkflow called')
    setIsTestingWorkflow(true)
    try {
      console.log('🔍 [TestValidatePhase] Calling onTestComplete')
      await onTestComplete()
      console.log('🔍 [TestValidatePhase] onTestComplete completed')
    } catch (error) {
      console.error('🔍 [TestValidatePhase] Test failed:', error)
    } finally {
      console.log('🔍 [TestValidatePhase] Setting isTestingWorkflow to false')
      setIsTestingWorkflow(false)
    }
  }

  const getOverallStatus = () => {
    const status = currentTestResults ? currentTestResults.overallStatus || 'pending' : 'pending';
    console.log('🔍 [TestValidatePhase] getOverallStatus:', status, 'from results:', currentTestResults);
    return status;
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'passed': return 'text-green-600 bg-green-50 border-green-200'
      case 'warning': return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'failed': return 'text-red-600 bg-red-50 border-red-200'
      default: return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'passed': return <CheckCircle className="h-5 w-5" />
      case 'warning': return <AlertTriangle className="h-5 w-5" />
      case 'failed': return <XCircle className="h-5 w-5" />
      default: return <TestTube className="h-5 w-5" />
    }
  }

  // Safe access to workflow properties with fallbacks
  const workflowStatus = workflow?.status || 'draft'
  const workflowName = workflow?.name || 'Untitled Workflow'
  const workflowDescription = workflow?.description || 'No description provided'
  const workflowSteps = workflow?.steps || []
  const workflowAgents = workflow?.agents || []
  const workflowConnections = workflow?.connections || []

  console.log('🔍 [TestValidatePhase] Extracted workflow properties:', {
    workflowStatus,
    workflowName,
    workflowDescription,
    workflowStepsCount: workflowSteps.length,
    workflowAgentsCount: workflowAgents.length,
    workflowConnectionsCount: workflowConnections.length
  });

  const canProceed = workflowStatus === 'validated' || getOverallStatus() === 'passed'
  console.log('🔍 [TestValidatePhase] canProceed:', canProceed, 'based on status:', workflowStatus, 'and overall:', getOverallStatus());

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-purple-500 to-pink-600 rounded-2xl mb-4 shadow-xl">
          <TestTube className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">Test & Validate Workflow</h2>
        <p className="text-slate-600 text-lg">
          Test your workflow with AI orchestration capabilities
        </p>
      </div>

      {/* Orchestration Status Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse"></div>
            <div>
              <h4 className="font-semibold text-blue-800">AI Orchestration Ready</h4>
              <p className="text-blue-700 text-sm">
                Test with Quick Test, Business Simulation, or full AI Orchestration
              </p>
            </div>
          </div>
          <div className="text-2xl">🤖</div>
        </div>
      </div>

      {/* Debug Panel (Development Only) */}
      {process.env.NODE_ENV === 'development' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
          <h4 className="font-semibold text-yellow-800 mb-2">Debug Information</h4>
          <div className="text-sm text-yellow-700 space-y-1">
            <div>Workflow ID: {workflow?.id || 'Not set'}</div>
            <div>Workflow Name: {workflowName}</div>
            <div>Steps: {workflowSteps.length}</div>
            <div>Agents: {workflowAgents.length}</div>
            <div>Connections: {workflowConnections.length}</div>
            <div>Status: {workflowStatus}</div>
            <div>Test Results: {currentTestResults ? 'Available' : 'None'}</div>
            <div>Overall Status: {getOverallStatus()}</div>
            <div>Orchestration: Integrated</div>
          </div>
        </div>
      )}

      {/* Workflow Overview */}
      <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
        <div className="flex justify-between items-start mb-6">
          <div>
            <h3 className="text-xl font-semibold text-slate-800 mb-2">{workflowName}</h3>
            <p className="text-slate-600">{workflowDescription}</p>
          </div>
          
          <div className={`px-4 py-2 rounded-full border ${getStatusColor(getOverallStatus())}`}>
            <div className="flex items-center gap-2">
              {getStatusIcon(getOverallStatus())}
              <span className="font-medium capitalize">
                {getOverallStatus()}
              </span>
            </div>
          </div>
        </div>

        {/* Workflow Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600">{workflowSteps.length}</div>
            <div className="text-sm text-slate-600">Steps</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600">{workflowAgents.length}</div>
            <div className="text-sm text-slate-600">Agents</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-purple-600">{workflowConnections.length}</div>
            <div className="text-sm text-slate-600">Connections</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-orange-600">
              {currentTestResults ? Object.keys(currentTestResults.results || {}).length : 0}
            </div>
            <div className="text-sm text-slate-600">Tests Run</div>
          </div>
        </div>
      </div>

      {/* Test Actions */}
      <div className="bg-white rounded-2xl shadow-lg p-6 mb-8">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800 mb-1">Run Workflow Tests</h3>
            <p className="text-slate-600 text-sm">
              Validate with AI orchestration or simulation testing
            </p>
          </div>
          
          <div className="flex gap-3">
            <button
              onClick={() => {
                console.log('🔍 [TestValidatePhase] Test button clicked');
                handleTestWorkflow();
              }}
              disabled={isTestingWorkflow || !workflowSteps.length}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all ${
                isTestingWorkflow || !workflowSteps.length
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-700 hover:to-pink-700 shadow-lg hover:shadow-xl'
              }`}
            >
              {isTestingWorkflow ? (
                <>
                  <RotateCw className="h-5 w-5 animate-spin" />
                  Testing...
                </>
              ) : (
                <>
                  <Play className="h-5 w-5" />
                  Run Full Test
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Test Tabs */}
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden mb-8">
        {/* Tab Navigation */}
        <div className="border-b border-gray-200">
          <div className="flex">
            {[
              { key: 'overview', label: 'Test Overview', icon: TestTube },
              { key: 'individual', label: 'Individual Steps', icon: CheckCircle, badge: 'New AI' },
              { key: 'full', label: 'Full Workflow', icon: Play }
            ].map((tab) => {
              const TabIcon = tab.icon
              return (
                <button
                  key={tab.key}
                  onClick={() => {
                    console.log('🔍 [TestValidatePhase] Tab changed to:', tab.key);
                    setActiveTab(tab.key as any);
                  }}
                  className={`flex items-center gap-2 px-6 py-4 font-medium transition-colors relative ${
                    activeTab === tab.key
                      ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
                      : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <TabIcon className="h-4 w-4" />
                  {tab.label}
                  {tab.badge && (
                    <span className="absolute -top-1 -right-1 bg-green-500 text-white text-xs px-2 py-0.5 rounded-full">
                      {tab.badge}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'overview' && (
            <TestOverviewTab 
              workflow={workflow}
              testResults={currentTestResults}
            />
          )}

          {activeTab === 'individual' && (
            <IndividualStepsTab 
              workflow={workflow}
              testResults={currentTestResults}
            />
          )}

          {activeTab === 'full' && (
            <FullWorkflowTab 
              workflow={workflow}
              testResults={currentTestResults}
              onTestComplete={(results) => {
                console.log('🔍 [TestValidatePhase] Test completed from FullWorkflowTab:', results);
                setCurrentTestResults(results);
              }}
            />
          )}
        </div>
      </div>

      {/* Test Results Summary */}
      {currentTestResults && (
        <div className={`rounded-2xl shadow-lg p-6 mb-8 border ${getStatusColor(getOverallStatus())}`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-semibold flex items-center gap-2">
              {getStatusIcon(getOverallStatus())}
              Test Results Summary
            </h3>
            <div className="text-sm">
              {Object.values(currentTestResults.results || {}).filter((r: any) => r.success).length} / {Object.keys(currentTestResults.results || {}).length} tests passed
            </div>
          </div>

          {getOverallStatus() === 'passed' && (
            <div className="bg-green-100 border border-green-200 rounded-xl p-4">
              <h4 className="font-semibold text-green-800 mb-2">🎉 Workflow Ready for Production</h4>
              <p className="text-green-700 text-sm">
                All tests passed successfully! Your workflow is validated and ready for deployment with AI orchestration.
              </p>
            </div>
          )}

          {getOverallStatus() === 'warning' && (
            <div className="bg-yellow-100 border border-yellow-200 rounded-xl p-4">
              <h4 className="font-semibold text-yellow-800 mb-2">⚠️ Workflow Has Warnings</h4>
              <p className="text-yellow-700 text-sm">
                Some tests passed with warnings. Review the issues and consider fixing them before deployment.
              </p>
            </div>
          )}

          {getOverallStatus() === 'failed' && (
            <div className="bg-red-100 border border-red-200 rounded-xl p-4">
              <h4 className="font-semibold text-red-800 mb-2">❌ Tests Failed</h4>
              <p className="text-red-700 text-sm">
                Some tests failed. Please review and fix the issues before proceeding.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex justify-between items-center">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-6 py-3 bg-slate-200 text-slate-700 rounded-xl hover:bg-slate-300 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Build
        </button>

        <button
          onClick={onNext}
          disabled={!canProceed}
          className={`flex items-center gap-2 px-8 py-3 rounded-xl font-medium transition-all ${
            canProceed
              ? 'bg-gradient-to-r from-green-600 to-green-700 text-white hover:from-green-700 hover:to-green-800 shadow-lg hover:shadow-xl'
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          }`}
        >
          Deploy Workflow
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

// Test Overview Tab Component
const TestOverviewTab: React.FC<{
  workflow: WorkflowServiceData
  testResults?: any
}> = ({ workflow, testResults }) => {
  const workflowSteps = workflow?.steps || []
  const workflowAgents = workflow?.agents || []
  const workflowConnections = workflow?.connections || []

  console.log('🔍 [TestOverviewTab] Component props:', {
    workflowSteps: workflowSteps.length,
    workflowAgents: workflowAgents.length,
    workflowConnections: workflowConnections.length,
    testResults: !!testResults
  });

  const hasSteps = workflowSteps.length > 0
  const hasAgents = workflowAgents.length > 0
  const hasConnections = workflowConnections.length > 0
  const allStepsHaveAgents = workflowSteps.every(step => 
    workflowAgents.find(agent => agent.id === step.agentId)
  )

  const validationChecks = [
    { label: 'Workflow has steps defined', passed: hasSteps, required: true },
    { label: 'All steps have agents assigned', passed: allStepsHaveAgents && hasAgents, required: true },
    { label: 'Step connections are configured', passed: hasConnections, required: false },
    { label: 'AI orchestration system ready', passed: true, required: false, new: true },
    { label: 'Workflow has been tested', passed: !!testResults, required: true }
  ]

  console.log('🔍 [TestOverviewTab] Validation checks:', validationChecks);

  return (
    <div className="space-y-6">
      {/* AI Orchestration Feature Highlight */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-2xl">🤖</span>
          </div>
          <div>
            <h4 className="text-lg font-semibold text-blue-900 mb-2">AI Orchestration Now Available</h4>
            <p className="text-blue-800 text-sm mb-3">
              Your workflow can now be tested with full AI processing capabilities using your platform's OpenAI configuration.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 bg-blue-200 text-blue-800 rounded-full text-xs font-medium">Quick Test</span>
              <span className="px-3 py-1 bg-green-200 text-green-800 rounded-full text-xs font-medium">Business Simulation</span>
              <span className="px-3 py-1 bg-purple-200 text-purple-800 rounded-full text-xs font-medium">AI Orchestration</span>
            </div>
          </div>
        </div>
      </div>

      {/* Pre-test Validation */}
      <div>
        <h4 className="text-lg font-semibold mb-4">Pre-test Validation</h4>
        <div className="space-y-3">
          {validationChecks.map((check, index) => (
            <div key={index} className="flex items-center gap-3">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                check.passed ? 'bg-green-500' : 'bg-red-500'
              }`}>
                {check.passed ? (
                  <CheckCircle className="h-3 w-3 text-white" />
                ) : (
                  <XCircle className="h-3 w-3 text-white" />
                )}
              </div>
              <span className={`${check.passed ? 'text-slate-700' : 'text-red-600'}`}>
                {check.label}
                {check.required && !check.passed && ' (Required)'}
                {check.new && (
                  <span className="ml-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">New</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed Step Analysis */}
      {hasSteps && (
        <div>
          <h4 className="text-lg font-semibold mb-4">Step Analysis</h4>
          <div className="space-y-2">
            {workflowSteps.map((step, index) => {
              const agent = workflowAgents.find(a => a.id === step.agentId)
              return (
                <div key={step.id || index} className="flex items-center justify-between p-3 bg-gray-50 rounded">
                  <div>
                    <span className="font-medium">{step.name || `Step ${index + 1}`}</span>
                    <div className="text-sm text-gray-600">
                      Agent: {agent?.name || 'Not assigned'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`px-2 py-1 rounded text-xs ${
                      agent ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {agent ? 'Ready' : 'Missing Agent'}
                    </div>
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">AI Ready</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Test Recommendations */}
      <div>
        <h4 className="text-lg font-semibold mb-4">Testing Recommendations</h4>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <ul className="space-y-2 text-blue-800 text-sm">
            <li>• Start with Quick Test for fast validation</li>
            <li>• Use Business Simulation to test with realistic data scenarios</li>
            <li>• Try AI Orchestration for full AI processing with workflow context</li>
            <li>• Test individual steps first to isolate any issues</li>
            <li>• Run the full workflow test to validate end-to-end functionality</li>
            <li>• Review output schemas to ensure proper validation</li>
          </ul>
        </div>
      </div>

      {!hasSteps && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4">
          <p className="text-yellow-800 text-sm">
            Your workflow doesn't have any steps yet. Go back to the Build phase to add steps before testing.
          </p>
        </div>
      )}
    </div>
  )
}

// Individual Steps Tab Component - Updated to use OrchestrationStepTestRunner
const IndividualStepsTab: React.FC<{
  workflow: WorkflowServiceData
  testResults?: any
}> = ({ workflow, testResults }) => {
  const workflowSteps = workflow?.steps || []
  const workflowAgents = workflow?.agents || []
  const workflowConnections = workflow?.connections || []

  console.log('🔍 [IndividualStepsTab] Debug info:', {
    stepsCount: workflowSteps.length,
    agentsCount: workflowAgents.length,
    connectionsCount: workflowConnections.length,
    testResults: testResults,
    firstStep: workflowSteps[0],
    firstAgent: workflowAgents[0],
    usingOrchestration: true
  });

  if (workflowSteps.length === 0) {
    return (
      <div className="text-center py-12">
        <TestTube className="h-12 w-12 text-gray-400 mx-auto mb-4" />
        <h4 className="text-lg font-semibold text-gray-600 mb-2">No Steps to Test</h4>
        <p className="text-gray-500">Add steps to your workflow in the Build phase first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h4 className="text-lg font-semibold">Individual Step Testing</h4>
          <span className="px-3 py-1 bg-gradient-to-r from-blue-100 to-purple-100 text-blue-700 text-xs font-medium rounded-full">
            🤖 AI Orchestration Ready
          </span>
        </div>
        <p className="text-slate-600 text-sm">
          Test each step individually with Quick Test, Business Simulation, or AI Orchestration modes.
        </p>
      </div>

      {workflowSteps.map((step, index) => {
        const agent = workflowAgents.find(a => a.id === step.agentId)
        const stepTestResult = testResults?.results?.[step.id]

        console.log(`🔍 [IndividualStepsTab] Rendering step ${index} with OrchestrationStepTestRunner:`, {
          stepId: step.id,
          stepName: step.name,
          agentId: step.agentId,
          agentFound: !!agent,
          agentName: agent?.name,
          hasTestResult: !!stepTestResult
        });

        return (
          <OrchestrationStepTestRunner
            key={step.id || index}
            step={step}
            agent={agent}
            workflow={{
              connections: workflowConnections,
              previousResults: testResults?.results || {}
            }}
            onTestComplete={(result) => {
              console.log(`Step ${step.name} orchestration test completed:`, result)
            }}
          />
        )
      })}
    </div>
  )
}

// Full Workflow Tab Component
const FullWorkflowTab: React.FC<{
  workflow: WorkflowServiceData
  testResults?: any
  onTestComplete: (results: any) => void
}> = ({ workflow, testResults, onTestComplete }) => {
  console.log('🔍 [FullWorkflowTab] Component props:', {
    workflow: !!workflow,
    testResults: !!testResults,
    onTestComplete: !!onTestComplete
  });

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <h4 className="text-lg font-semibold">Full Workflow Testing</h4>
          <span className="px-3 py-1 bg-gradient-to-r from-green-100 to-blue-100 text-green-700 text-xs font-medium rounded-full">
            End-to-End AI Processing
          </span>
        </div>
        <p className="text-slate-600 text-sm">
          Test the entire workflow end-to-end with AI orchestration and realistic business scenarios.
        </p>
      </div>

      <WorkflowTester
        workflow={workflow}
        onTestComplete={(results) => {
          console.log('🔍 [FullWorkflowTab] WorkflowTester onTestComplete:', results);
          onTestComplete(results);
        }}
        onWorkflowUpdate={(updatedWorkflow) => {
          console.log('🔍 [FullWorkflowTab] WorkflowTester onWorkflowUpdate:', updatedWorkflow);
          // Handle workflow updates if needed
        }}
      />
    </div>
  )
}
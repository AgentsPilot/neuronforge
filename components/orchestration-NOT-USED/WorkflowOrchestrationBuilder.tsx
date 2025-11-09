'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Workflow, MessageSquare, Bot, Zap, CheckCircle, TestTube, Rocket } from 'lucide-react'
import { ProcessDescriptionPhase } from './phases/ProcessDescriptionPhase'
import AgentBuildingPhase from './phases/AgentBuildingPhase'
import { TestValidatePhase } from './phases/TestValidatePhase'
import { WorkflowData, WorkflowPhase } from './types/workflow'
import { useWorkflowBuilder, WorkflowService, WorkflowData as WorkflowServiceData } from '../../lib/services/workflowService'

// Mock workflows for initial loading (replace with real fetch as needed)
const mockWorkflows: WorkflowData[] = [
  {
    id: 'wf-1',
    title: 'Customer Data Pipeline',
    description: 'Automated pipeline for processing and enriching customer data from multiple sources',
    industry: 'Retail',
    processDescription: 'Automates customer data ETL',
    generatedSteps: [],
    finalSteps: [],
    triggerType: 'manual'
  },
  {
    id: 'wf-4',
    title: 'Email Campaign Automation',
    description: 'Personalized email campaign workflow with A/B testing and performance tracking',
    industry: 'Marketing',
    processDescription: 'Automates email campaigns',
    generatedSteps: [],
    finalSteps: [],
    triggerType: 'manual'
  }
]

// Extended phase type to include test and deploy
type ExtendedWorkflowPhase = WorkflowPhase | 'test' | 'deploy'

export default function WorkflowOrchestrationBuilder() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewId = searchParams.get('view')
  const editId = searchParams.get('edit')
  const orchestrationId = viewId || editId

  const [currentPhase, setCurrentPhase] = useState<ExtendedWorkflowPhase>('describe')
  const [testResults, setTestResults] = useState<any>(null)
  const [isDeploying, setIsDeploying] = useState(false)
  const [deployResult, setDeployResult] = useState<any>(null)
  const [initialWorkflowData, setInitialWorkflowData] = useState<Partial<WorkflowServiceData> | null>(null)
  const [isWorkflowLoaded, setIsWorkflowLoaded] = useState(false)

  // Legacy workflow data for backward compatibility with existing phases
  const [legacyWorkflowData, setLegacyWorkflowData] = useState<WorkflowData>({
    title: '',
    description: '',
    industry: '',
    processDescription: '',
    generatedSteps: [],
    finalSteps: [],
    triggerType: 'manual'
  })

  // Load existing workflow if editing
  useEffect(() => {
    const loadWorkflow = async () => {
      if (orchestrationId) {
        console.log('🔍 Loading workflow with ID:', orchestrationId)
        
        // Try to load from new service first
        const loadedWorkflow = await WorkflowService.loadDraft(orchestrationId)
        
        if (loadedWorkflow) {
          console.log('✅ Loaded workflow from service:', loadedWorkflow)
          
          // Set initial data for useWorkflowBuilder
          setInitialWorkflowData(loadedWorkflow)
          
          // Convert new format to legacy format for existing components
          setLegacyWorkflowData({
            id: loadedWorkflow.id,
            title: loadedWorkflow.name,
            description: loadedWorkflow.description,
            industry: 'General', // Default since new format doesn't have this
            processDescription: loadedWorkflow.description,
            generatedSteps: loadedWorkflow.steps.map(step => ({
              id: step.id,
              title: step.name,
              description: step.description,
              inputs: step.inputs.map(i => i.name),
              outputs: step.outputs.map(o => o.name),
              suggestedAgent: step.agentId
            })),
            finalSteps: [],
            triggerType: 'manual'
          })
        } else {
          console.log('⚠️ No workflow found in service, trying mock data')
          // Fallback to mock data
          const found = mockWorkflows.find(wf => wf.id === orchestrationId)
          if (found) {
            setLegacyWorkflowData(found)
            // Create initial workflow data from mock
            setInitialWorkflowData({
              id: found.id,
              name: found.title,
              description: found.description,
              steps: [],
              agents: [],
              connections: [],
              status: 'draft'
            })
          } else {
            console.log('❌ No workflow found in mock data either')
            // Create empty workflow
            setInitialWorkflowData({
              name: 'New Workflow',
              description: '',
              steps: [],
              agents: [],
              connections: [],
              status: 'draft'
            })
          }
        }
      } else {
        console.log('🆕 Creating new workflow')
        // Create new workflow
        setInitialWorkflowData({
          name: 'New Workflow',
          description: '',
          steps: [],
          agents: [],
          connections: [],
          status: 'draft'
        })
      }
      
      setIsWorkflowLoaded(true)
    }

    loadWorkflow()
  }, [orchestrationId])

  // Use the workflow service hook with initial data
  const { 
    workflow, 
    updateWorkflow, 
    testWorkflow, 
    deployWorkflow,
    autoSaveStatus, 
    hasUnsavedChanges,
    saveManually
  } = useWorkflowBuilder(initialWorkflowData || undefined)

  // Debug logging
  useEffect(() => {
    console.log('🔍 Parent workflow state:', {
      workflow,
      workflowExists: !!workflow,
      workflowKeys: workflow ? Object.keys(workflow) : 'none',
      isWorkflowLoaded,
      initialWorkflowData,
      initialDataExists: !!initialWorkflowData,
      currentPhase
    })
    
    if (currentPhase === 'test' && !workflow) {
      console.error('🚨 CRITICAL: About to render TestValidatePhase with undefined workflow!')
      console.error('🚨 initialWorkflowData:', initialWorkflowData)
      console.error('🚨 isWorkflowLoaded:', isWorkflowLoaded)
    }
  }, [workflow, isWorkflowLoaded, initialWorkflowData, currentPhase])

  // Auto-save indicator component
  const AutoSaveIndicator = () => (
    <div className="flex items-center gap-2 text-sm">
      {autoSaveStatus === 'saving' && (
        <>
          <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse"></div>
          <span className="text-blue-600">Auto-saving...</span>
        </>
      )}
      {autoSaveStatus === 'saved' && !hasUnsavedChanges && (
        <>
          <div className="w-2 h-2 bg-green-600 rounded-full"></div>
          <span className="text-green-600">All changes saved</span>
        </>
      )}
      {autoSaveStatus === 'error' && (
        <>
          <div className="w-2 h-2 bg-red-600 rounded-full"></div>
          <span className="text-red-600">Save failed</span>
          <button 
            onClick={saveManually}
            className="text-blue-600 hover:underline ml-2 text-xs"
          >
            Retry
          </button>
        </>
      )}
    </div>
  )

  const phases = [
    { id: 'describe' as ExtendedWorkflowPhase, title: 'Describe Process', icon: MessageSquare, color: 'from-green-500 to-emerald-600' },
    { id: 'build' as ExtendedWorkflowPhase, title: 'Build Workflow', icon: Bot, color: 'from-blue-500 to-indigo-600' },
    { id: 'test' as ExtendedWorkflowPhase, title: 'Test & Validate', icon: TestTube, color: 'from-purple-500 to-pink-600' },
    { id: 'deploy' as ExtendedWorkflowPhase, title: 'Deploy', icon: Rocket, color: 'from-orange-500 to-red-600' }
  ]

  const updateLegacyWorkflowData = (updates: Partial<WorkflowData>) => {
    setLegacyWorkflowData(prev => ({ ...prev, ...updates }))
    
    // Also update the new workflow format
    if (workflow) {
      updateWorkflow({
        name: updates.title || workflow.name,
        description: updates.description || workflow.description,
      })
    }
  }

  // Handle completion of workflow building phase
  const handleWorkflowBuildComplete = (finalWorkflowData: WorkflowData) => {
    setLegacyWorkflowData(finalWorkflowData)
    
    // Convert legacy format to new format and update
    if (finalWorkflowData.finalSteps && finalWorkflowData.finalSteps.length > 0) {
      const newSteps = finalWorkflowData.finalSteps.map((step, index) => ({
        id: step.id || `step_${index}`,
        name: step.title || `Step ${index + 1}`,
        description: step.description || '',
        agentId: step.suggestedAgent || '',
        inputs: (step.inputs || []).map((input, i) => ({
          name: typeof input === 'string' ? input : `input_${i}`,
          type: 'string',
          required: true,
          source: index === 0 ? 'user' : 'previous_step'
        })),
        outputs: (step.outputs || []).map((output, i) => ({
          name: typeof output === 'string' ? output : `output_${i}`,
          type: 'string',
          required: true
        })),
        position: { x: 100 + index * 200, y: 100 }
      }))

      updateWorkflow({
        steps: newSteps,
        status: 'draft'
      })
    }
    
    setCurrentPhase('test')
  }

  // Handle test completion
  const handleTestComplete = async () => {
    try {
      const result = await testWorkflow()
      setTestResults(result)
      
      if (result.overallStatus === 'passed') {
        setCurrentPhase('deploy')
      }
    } catch (error) {
      console.error('Test failed:', error)
    }
  }

  // Handle deployment
  const handleDeploy = async () => {
    setIsDeploying(true)
    try {
      const result = await deployWorkflow()
      setDeployResult(result)
      
      if (result.success) {
        // Redirect to workflows list or success page after delay
        setTimeout(() => {
          router.push('/workflows')
        }, 3000)
      }
    } catch (error) {
      console.error('Deployment failed:', error)
      setDeployResult({ success: false, error: error.message })
    } finally {
      setIsDeploying(false)
    }
  }

  const getPhaseStatus = (phaseId: ExtendedWorkflowPhase) => {
    const currentIndex = phases.findIndex(p => p.id === currentPhase)
    const phaseIndex = phases.findIndex(p => p.id === phaseId)
    
    if (phaseIndex < currentIndex) return 'completed'
    if (phaseIndex === currentIndex) return 'active'
    return 'pending'
  }

  // Show loading state while workflow is being initialized
  if (!isWorkflowLoaded) {
    console.log('⏳ Showing loading state: workflow not loaded yet')
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <Workflow className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-2">Loading Workflow...</h2>
          <p className="text-slate-600">Please wait while we initialize your workflow.</p>
          <div className="mt-4">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
          </div>
        </div>
      </div>
    )
  }

  if (!workflow) {
    console.error('🚨 CRITICAL ERROR: Workflow is still undefined after loading!')
    console.error('🚨 Debug info:', {
      isWorkflowLoaded,
      initialWorkflowData,
      hasInitialData: !!initialWorkflowData
    })
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-red-500 rounded-2xl mb-6 shadow-xl">
            <Workflow className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-red-800 mb-2">Workflow Loading Error</h2>
          <p className="text-red-600 mb-4">There was an issue initializing your workflow.</p>
          <button
            onClick={() => window.location.reload()}
            className="bg-red-600 text-white px-6 py-3 rounded-xl hover:bg-red-700 transition-colors"
          >
            Reload Page
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      <div className="max-w-7xl mx-auto px-4 py-12">
        {/* Header with workflow name and auto-save status */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-2xl mb-6 shadow-xl">
            <Workflow className="h-8 w-8 text-white" />
          </div>
          
          {currentPhase !== 'describe' && (
            <div className="mb-4">
              <input
                type="text"
                value={workflow.name || legacyWorkflowData.title}
                onChange={(e) => {
                  updateWorkflow({ name: e.target.value })
                  updateLegacyWorkflowData({ title: e.target.value })
                }}
                className="text-3xl font-bold bg-transparent border-none outline-none text-center focus:bg-white focus:shadow-lg focus:px-4 focus:py-2 rounded-lg transition-all"
                placeholder="Enter workflow name..."
              />
              <div className="flex justify-center mt-2">
                <AutoSaveIndicator />
              </div>
            </div>
          )}
          
          <h1 className="text-4xl font-bold bg-gradient-to-r from-slate-800 to-blue-800 bg-clip-text text-transparent mb-4">
            {currentPhase === 'describe' ? 'Business Process Orchestrator' : 'Workflow Builder'}
          </h1>
          <p className="text-lg text-slate-600 max-w-3xl mx-auto">
            {currentPhase === 'describe' 
              ? 'Transform your business processes into intelligent, automated workflows in minutes'
              : 'Build, test, and deploy your automated workflow'
            }
          </p>
          
          {workflow.status && currentPhase !== 'describe' && (
            <div className="mt-4 flex justify-center">
              <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium ${
                workflow.status === 'validated' ? 'bg-green-100 text-green-800' :
                workflow.status === 'draft' ? 'bg-yellow-100 text-yellow-800' :
                workflow.status === 'testing' ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-800'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  workflow.status === 'validated' ? 'bg-green-500' :
                  workflow.status === 'draft' ? 'bg-yellow-500' :
                  workflow.status === 'testing' ? 'bg-blue-500' : 'bg-gray-500'
                }`}></div>
                Status: {workflow.status.charAt(0).toUpperCase() + workflow.status.slice(1)}
              </div>
            </div>
          )}
        </div>

        {/* Phase Progress */}
        <div className="mb-12">
          <div className="flex items-center justify-center gap-8 mb-8">
            {phases.map((phase, index) => {
              const status = getPhaseStatus(phase.id)
              const PhaseIcon = phase.icon

              return (
                <div key={phase.id} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <button
                      onClick={() => {
                        // Allow navigation to completed phases or current phase
                        if (status === 'completed' || status === 'active') {
                          setCurrentPhase(phase.id)
                        }
                      }}
                      disabled={status === 'pending'}
                      className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                        status === 'completed' 
                          ? 'bg-green-500 shadow-lg hover:shadow-xl cursor-pointer' 
                          : status === 'active' 
                          ? `bg-gradient-to-r ${phase.color} shadow-xl scale-110` 
                          : 'bg-slate-200 cursor-not-allowed'
                      }`}
                    >
                      {status === 'completed' ? (
                        <CheckCircle className="h-8 w-8 text-white" />
                      ) : (
                        <PhaseIcon className={`h-8 w-8 ${status === 'active' ? 'text-white' : 'text-slate-500'}`} />
                      )}
                    </button>
                    <div className="mt-3 text-center">
                      <p className={`font-semibold ${
                        status === 'active' ? 'text-blue-600' : 
                        status === 'completed' ? 'text-green-600' : 'text-slate-500'
                      }`}>
                        {phase.title}
                      </p>
                    </div>
                  </div>
                  
                  {index < phases.length - 1 && (
                    <div className={`w-24 h-1 mx-4 rounded-full transition-colors ${
                      status === 'completed' ? 'bg-green-500' : 'bg-slate-200'
                    }`} />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Phase Content */}
        <div className="transition-all duration-500">
          {currentPhase === 'describe' && (
            <ProcessDescriptionPhase 
              data={legacyWorkflowData} 
              onUpdate={updateLegacyWorkflowData}
              onNext={() => setCurrentPhase('build')}
            />
          )}

          {currentPhase === 'build' && (
            <AgentBuildingPhase 
              data={legacyWorkflowData} 
              onUpdate={updateLegacyWorkflowData}
              onNext={handleWorkflowBuildComplete}
              onBack={() => setCurrentPhase('describe')}
            />
          )}

          {currentPhase === 'test' && (() => {
            // Create a guaranteed valid workflow object
            const testWorkflow = {
              id: 'test-workflow-123',
              name: 'Test Workflow',
              description: 'This is a test workflow',
              steps: [
                {
                  id: 'step-1',
                  name: 'Test Step 1',
                  description: 'First test step',
                  agentId: 'agent-1',
                  inputs: [{ name: 'input1', type: 'string', required: true }],
                  outputs: [{ name: 'output1', type: 'string', required: true }],
                  position: { x: 100, y: 100 }
                }
              ],
              agents: [
                {
                  id: 'agent-1',
                  name: 'Test Agent',
                  type: 'custom',
                  configuration: {},
                  outputSchema: { type: 'string' }
                }
              ],
              connections: [],
              status: 'draft',
              createdAt: new Date(),
              updatedAt: new Date()
            };
            
            console.log('🚀 FORCING TestValidatePhase with guaranteed valid workflow:', testWorkflow);
            
            return (
              <div>
                <div className="bg-yellow-100 border border-yellow-300 rounded-lg p-4 mb-4">
                  <p className="text-yellow-800 font-semibold">DEBUG MODE</p>
                  <p className="text-yellow-700 text-sm">Using hardcoded test workflow to isolate the issue</p>
                </div>
                <TestValidatePhase
                  workflow={testWorkflow}
                  testResults={testResults}
                  onTestComplete={handleTestComplete}
                  onNext={() => setCurrentPhase('deploy')}
                  onBack={() => setCurrentPhase('build')}
                />
              </div>
            );
          })()}

          {currentPhase === 'deploy' && (
            <DeployPhase
              workflow={workflow || initialWorkflowData || {
                id: WorkflowService.generateUUID(),
                name: 'New Workflow',
                description: '',
                steps: [],
                agents: [],
                connections: [],
                status: 'draft',
                createdAt: new Date(),
                updatedAt: new Date()
              }}
              testResults={testResults}
              isDeploying={isDeploying}
              deployResult={deployResult}
              onDeploy={handleDeploy}
              onBack={() => setCurrentPhase('test')}
            />
          )}
        </div>
      </div>
    </div>
  )
}

// Deploy Phase Component
const DeployPhase: React.FC<{
  workflow: any
  testResults: any
  isDeploying: boolean
  deployResult: any
  onDeploy: () => void
  onBack: () => void
}> = ({ workflow, testResults, isDeploying, deployResult, onDeploy, onBack }) => {
  if (workflow.status !== 'validated') {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-white rounded-3xl shadow-xl p-12">
          <div className="text-6xl mb-6">🧪</div>
          <h2 className="text-3xl font-bold text-slate-800 mb-4">Test Your Workflow First</h2>
          <p className="text-slate-600 text-lg mb-8">
            Your workflow must pass all validation tests before it can be deployed to production.
          </p>
          <button
            onClick={onBack}
            className="bg-blue-600 text-white px-8 py-4 rounded-xl hover:bg-blue-700 transition-colors font-semibold"
          >
            Go Back to Testing
          </button>
        </div>
      </div>
    )
  }

  if (deployResult?.success) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-white rounded-3xl shadow-xl p-12">
          <div className="text-6xl mb-6">🎉</div>
          <h2 className="text-3xl font-bold text-green-800 mb-4">
            Deployment Successful!
          </h2>
          <p className="text-green-700 text-lg mb-6">
            Your workflow is now live and ready to process real data.
          </p>
          
          <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-8">
            <div className="text-sm text-green-600 mb-2">Workflow ID:</div>
            <div className="font-mono text-lg font-semibold text-green-800">
              {deployResult.workflowId}
            </div>
          </div>

          <div className="flex justify-center gap-4">
            <button
              onClick={() => window.location.href = `/workflows/${deployResult.workflowId}`}
              className="bg-green-600 text-white px-6 py-3 rounded-xl hover:bg-green-700 transition-colors"
            >
              View Workflow
            </button>
            <button
              onClick={() => window.location.href = '/workflows'}
              className="bg-slate-600 text-white px-6 py-3 rounded-xl hover:bg-slate-700 transition-colors"
            >
              All Workflows
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (deployResult?.success === false) {
    return (
      <div className="max-w-2xl mx-auto text-center">
        <div className="bg-white rounded-3xl shadow-xl p-12">
          <div className="text-6xl mb-6">❌</div>
          <h2 className="text-3xl font-bold text-red-800 mb-4">
            Deployment Failed
          </h2>
          <p className="text-red-700 text-lg mb-6">
            There was an error deploying your workflow to production.
          </p>
          
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 mb-8 text-left">
            <div className="font-semibold text-red-800 mb-2">Error Details:</div>
            <div className="text-red-700 text-sm font-mono">
              {deployResult.error || 'Unknown deployment error'}
            </div>
          </div>

          <div className="flex justify-center gap-4">
            <button
              onClick={onDeploy}
              className="bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={onBack}
              className="bg-slate-600 text-white px-6 py-3 rounded-xl hover:bg-slate-700 transition-colors"
            >
              Back to Testing
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <div className="text-6xl mb-4">🚀</div>
        <h2 className="text-3xl font-bold text-slate-800 mb-2">Deploy to Production</h2>
        <p className="text-slate-600 text-lg">
          Your workflow has passed all tests and is ready for deployment.
        </p>
      </div>

      {/* Pre-deployment checklist */}
      <div className="bg-green-50 border border-green-200 rounded-xl p-6 mb-8">
        <h3 className="font-semibold text-green-800 mb-4">✅ Pre-deployment Checklist</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-green-700">
          <div className="flex items-center gap-2">
            <span>✓</span> Workflow has {workflow.steps?.length || 0} steps configured
          </div>
          <div className="flex items-center gap-2">
            <span>✓</span> All {workflow.agents?.length || 0} agents are properly configured
          </div>
          <div className="flex items-center gap-2">
            <span>✓</span> {workflow.connections?.length || 0} step connections established
          </div>
          <div className="flex items-center gap-2">
            <span>✓</span> All tests passed: {testResults?.overallStatus || 'Unknown'}
          </div>
        </div>
      </div>

      {/* Deployment options */}
      <div className="bg-white rounded-xl shadow-lg p-8 mb-8">
        <h3 className="text-xl font-semibold mb-6">Deployment Options</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-blue-50 p-6 rounded-xl text-center">
            <div className="text-3xl mb-2">⚡</div>
            <div className="font-semibold text-blue-800 mb-2">Manual Execution</div>
            <div className="text-blue-600 text-sm">Run on-demand with custom inputs</div>
          </div>
          <div className="bg-purple-50 p-6 rounded-xl text-center">
            <div className="text-3xl mb-2">⏰</div>
            <div className="font-semibold text-purple-800 mb-2">Scheduled Execution</div>
            <div className="text-purple-600 text-sm">Automated runs on schedule</div>
          </div>
          <div className="bg-green-50 p-6 rounded-xl text-center">
            <div className="text-3xl mb-2">🔗</div>
            <div className="font-semibold text-green-800 mb-2">API Integration</div>
            <div className="text-green-600 text-sm">Trigger via webhooks or API calls</div>
          </div>
        </div>

        <div className="text-center">
          <button
            onClick={onDeploy}
            disabled={isDeploying}
            className={`px-12 py-4 rounded-xl font-semibold text-lg transition-colors ${
              isDeploying
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-green-600 to-green-700 text-white hover:from-green-700 hover:to-green-800 shadow-lg hover:shadow-xl'
            }`}
          >
            {isDeploying ? (
              <div className="flex items-center gap-3">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Deploying to Production...
              </div>
            ) : (
              'Deploy to Production'
            )}
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="bg-slate-200 text-slate-700 px-6 py-3 rounded-xl hover:bg-slate-300 transition-colors"
        >
          ← Back to Testing
        </button>
      </div>
    </div>
  )
}
// components/orchestration/phases/ConfigureIntegrationsPhase.tsx
import React, { useState, useCallback } from 'react'
import { Settings, CheckCircle } from 'lucide-react'
import { WorkflowStep, Connection } from '../types/workflow'

// Import the modular components
import { PluginConnectionManager } from '../components/configuration/PluginConnectionManager'
import { IntegrationCards } from '../components/configuration/IntegrationCards'
import { ConfigurationForms } from '../components/configuration/ConfigurationForms'

interface ConfigureIntegrationsPhaseProps {
  steps: WorkflowStep[]
  connections: Connection[]
  onStepsChange: (steps: WorkflowStep[]) => void
  onStepConfiguration: (stepIndex: number, configData: any) => void
  onPhaseComplete: () => void
  onPreviousPhase: () => void
}

export const ConfigureIntegrationsPhase: React.FC<ConfigureIntegrationsPhaseProps> = ({
  steps,
  connections,
  onStepsChange,
  onStepConfiguration,
  onPhaseComplete,
  onPreviousPhase
}) => {
  const [selectedPlugins, setSelectedPlugins] = useState<Record<number, string>>({})
  const [connectedSteps, setConnectedSteps] = useState(new Set<number>())
  const [testResults, setTestResults] = useState<Record<string, { status: string; message: string }>>({})
  const [configData, setConfigData] = useState<Record<string, any>>({})

  const updateStep = useCallback((index: number, updates: Partial<WorkflowStep>) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], ...updates }
    onStepsChange(newSteps)
  }, [steps, onStepsChange])

  const handlePluginSelect = (stepIndex: number, pluginKey: string) => {
    setSelectedPlugins(prev => ({
      ...prev,
      [stepIndex]: pluginKey
    }))
  }

  const handleConnect = (stepIndex: number) => {
    const pluginKey = selectedPlugins[stepIndex]
    if (!pluginKey) return

    const key = `${stepIndex}-${pluginKey}`
    setTestResults(prev => ({
      ...prev,
      [key]: { status: 'testing', message: 'Configuring integration...' }
    }))

    setTimeout(() => {
      setConnectedSteps(prev => new Set([...prev, stepIndex]))
      setTestResults(prev => ({
        ...prev,
        [key]: { status: 'success', message: 'Integration configured successfully!' }
      }))
      
      updateStep(stepIndex, {
        configurationComplete: true,
        configurationData: {
          ...configData[key],
          connected: true,
          pluginKey: pluginKey
        }
      })

      onStepConfiguration(stepIndex, {
        ...configData[key],
        connected: true,
        pluginKey: pluginKey
      })
    }, 1500)
  }

  const handleConfigChange = (stepIndex: number, field: string, value: string) => {
    const pluginKey = selectedPlugins[stepIndex]
    if (!pluginKey) return

    const key = `${stepIndex}-${pluginKey}`
    setConfigData(prev => ({
      ...prev,
      [key]: {
        ...prev[key],
        [field]: value
      }
    }))
  }

  // Calculate totals
  const stepsWithAgents = steps.filter(step => step.selectedAgent)
  const totalRequired = stepsWithAgents.length
  const totalConfigured = connectedSteps.size

  return (
    <PluginConnectionManager>
      {({ pluginConnections, loading, currentUserId, refetch }) => {
        if (loading) {
          return (
            <div className="flex items-center justify-center py-12">
              <div className="flex items-center gap-3">
                <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-slate-600">Loading your connected integrations...</span>
              </div>
            </div>
          )
        }

        return (
          <div className="space-y-6">
            {/* Integration Cards Component */}
            <IntegrationCards 
              pluginConnections={pluginConnections}
              currentUserId={currentUserId}
            />

            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/60 p-8">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-lg">
                    <Settings className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">Configure Agent Integrations</h1>
                    <p className="text-slate-600">Choose which integration each agent should use</p>
                  </div>
                </div>
                
                <div className="text-right">
                  <div className="text-2xl font-bold text-slate-900">{totalConfigured}/{totalRequired}</div>
                  <div className="text-sm text-slate-600">Agents Configured</div>
                  <div className="w-32 h-2 bg-slate-200 rounded-full mt-2">
                    <div 
                      className="h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-500"
                      style={{ width: `${totalRequired ? (totalConfigured / totalRequired) * 100 : 0}%` }}
                    ></div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {stepsWithAgents.map((step, index) => {
                  const actualIndex = steps.findIndex(s => s.id === step.id)
                  
                  return (
                    <div key={step.id} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold text-blue-700">
                          {actualIndex + 1}
                        </div>
                        <div>
                          <h3 className="font-semibold text-slate-900">{step.title}</h3>
                          <p className="text-sm text-slate-600">Agent: {step.selectedAgent.name}</p>
                        </div>
                      </div>
                      
                      <ConfigurationForms
                        step={step}
                        stepIndex={actualIndex}
                        pluginConnections={pluginConnections}
                        selectedPlugins={selectedPlugins}
                        configData={configData}
                        testResults={testResults}
                        connectedSteps={connectedSteps}
                        onPluginSelect={handlePluginSelect}
                        onConfigChange={handleConfigChange}
                        onConnect={handleConnect}
                      />
                    </div>
                  )
                })}
                
                {stepsWithAgents.length === 0 && (
                  <div className="col-span-full text-center py-12">
                    <div className="text-6xl mb-4">🤖</div>
                    <h2 className="text-xl font-semibold text-slate-900 mb-2">No Agents Assigned</h2>
                    <p className="text-slate-600 mb-6">
                      Assign agents to your workflow steps to configure integrations.
                    </p>
                    <button 
                      onClick={onPreviousPhase}
                      className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                    >
                      ← Back to Build Phase
                    </button>
                  </div>
                )}
              </div>

              <div className="flex justify-between items-center mt-8 pt-6 border-t border-slate-200">
                <button 
                  onClick={onPreviousPhase}
                  className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-medium"
                >
                  ← Back to Connect
                </button>
                
                <div className="flex items-center gap-4">
                  {totalConfigured === totalRequired && totalRequired > 0 && (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-5 w-5" />
                      <span className="text-sm font-medium">All agents configured!</span>
                    </div>
                  )}
                  
                  <button 
                    onClick={onPhaseComplete}
                    className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                      (totalConfigured === totalRequired && totalRequired > 0) || totalRequired === 0
                        ? 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white shadow-lg'
                        : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                    }`}
                    disabled={totalRequired > 0 && totalConfigured !== totalRequired}
                  >
                    Next: Test & Validate →
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      }}
    </PluginConnectionManager>
  )
}
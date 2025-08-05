import React, { useState, useMemo, useCallback } from 'react'
import { Settings, CheckCircle, AlertCircle, Mail, Database, FileText, Users, Folder, ExternalLink, Check, Play, Package, Bot, Zap, Link } from 'lucide-react'

// Enhanced agent library with required plugins
const enhancedAgentLibrary = [
  {
    id: 'email-scanner',
    name: 'Email Scanner Agent',
    description: 'Scans email folders for specific content and attachments',
    category: 'Email Processing',
    requiredPlugins: ['gmail'],
    capabilities: ['Email scanning', 'Attachment detection', 'Content filtering'],
    suggestedFor: ['email', 'scan', 'inbox', 'attachment']
  },
  {
    id: 'invoice-extractor',
    name: 'Invoice Data Extractor',
    description: 'Extracts structured data from invoice documents using AI',
    category: 'Document Processing',
    requiredPlugins: ['google-drive'],
    capabilities: ['OCR processing', 'Data extraction', 'Field mapping'],
    suggestedFor: ['invoice', 'extract', 'document', 'data']
  },
  {
    id: 'crm-sync',
    name: 'CRM Sync Agent',
    description: 'Synchronizes data with CRM systems',
    category: 'CRM Integration',
    requiredPlugins: ['salesforce', 'hubspot'],
    capabilities: ['Record creation', 'Data mapping', 'Bulk operations'],
    suggestedFor: ['crm', 'sync', 'salesforce', 'hubspot', 'update']
  },
  {
    id: 'report-generator',
    name: 'Report Generator',
    description: 'Generates formatted reports and documentation',
    category: 'Reporting',
    requiredPlugins: ['notion'],
    capabilities: ['Report creation', 'Data visualization', 'Template formatting'],
    suggestedFor: ['report', 'document', 'summary', 'analysis']
  },
  {
    id: 'data-processor',
    name: 'Data Processor',
    description: 'Processes and transforms data using AI',
    category: 'Data Processing',
    requiredPlugins: [],
    capabilities: ['Data transformation', 'Pattern recognition', 'Validation'],
    suggestedFor: ['process', 'transform', 'analyze', 'validate']
  },
  {
    id: 'email-outlook',
    name: 'Outlook Email Agent',
    description: 'Processes Microsoft Outlook emails and calendar',
    category: 'Email Processing',
    requiredPlugins: ['outlook'],
    capabilities: ['Email processing', 'Calendar integration', 'Contact management'],
    suggestedFor: ['outlook', 'microsoft', 'email', 'calendar']
  }
]

// Available plugins configuration
const availablePlugins = [
  { id: 'gmail', name: 'Gmail', description: 'Connect to Gmail for email processing', icon: Mail },
  { id: 'outlook', name: 'Outlook', description: 'Connect to Microsoft Outlook', icon: Mail },
  { id: 'salesforce', name: 'Salesforce', description: 'Sync data with Salesforce CRM', icon: Database },
  { id: 'hubspot', name: 'HubSpot', description: 'Integrate with HubSpot CRM', icon: Users },
  { id: 'notion', name: 'Notion', description: 'Create and update Notion pages', icon: FileText },
  { id: 'google-drive', name: 'Google Drive', description: 'Access Google Drive files', icon: Folder }
]

// Mock workflow phases component
const WorkflowWithIntegrations = () => {
  // Initialize workflow steps with proper agent structure
  const [steps, setSteps] = useState([
    {
      id: 1,
      title: 'Email Processing',
      description: 'Scan emails for invoices and attachments',
      inputs: [
        { name: 'email_folder', type: 'text', displayName: 'Email Folder', required: true },
        { name: 'search_criteria', type: 'text', displayName: 'Search Criteria' }
      ],
      outputs: [
        { name: 'found_emails', type: 'json', displayName: 'Found Emails' },
        { name: 'attachment_count', type: 'number', displayName: 'Attachment Count' }
      ],
      selectedAgent: null,
      isConfigured: false,
      configurationComplete: false,
      configurationData: {},
      suggestedAgent: 'Email Scanner',
      customInputs: [],
      customOutputs: []
    },
    {
      id: 2,
      title: 'Invoice Extraction',
      description: 'Extract data from invoice documents',
      inputs: [
        { name: 'email_attachments', type: 'json', displayName: 'Email Attachments', required: true },
        { name: 'extraction_rules', type: 'text', displayName: 'Extraction Rules' }
      ],
      outputs: [
        { name: 'invoice_data', type: 'json', displayName: 'Invoice Data' },
        { name: 'confidence_score', type: 'number', displayName: 'Confidence Score' }
      ],
      selectedAgent: null,
      isConfigured: false,
      configurationComplete: false,
      configurationData: {},
      suggestedAgent: 'Invoice Data Extractor',
      customInputs: [],
      customOutputs: []
    },
    {
      id: 3,
      title: 'CRM Update',
      description: 'Update CRM with extracted invoice data',
      inputs: [
        { name: 'processed_invoices', type: 'json', displayName: 'Processed Invoices', required: true },
        { name: 'crm_settings', type: 'json', displayName: 'CRM Settings' }
      ],
      outputs: [
        { name: 'updated_records', type: 'json', displayName: 'Updated Records' },
        { name: 'success_count', type: 'number', displayName: 'Success Count' }
      ],
      selectedAgent: null,
      isConfigured: false,
      configurationComplete: false,
      configurationData: {},
      suggestedAgent: 'CRM Record Creator',
      customInputs: [],
      customOutputs: []
    }
  ])

  const [currentPhase, setCurrentPhase] = useState('build')
  const [connectedPlugins, setConnectedPlugins] = useState(new Set())
  const [testResults, setTestResults] = useState({})
  const [configData, setConfigData] = useState({})

  // Agent assignment handler
  const handleAgentAssignment = useCallback((agent, stepIndex) => {
    const newSteps = [...steps]
    newSteps[stepIndex] = {
      ...newSteps[stepIndex],
      selectedAgent: agent,
      isConfigured: false,
      configurationComplete: false
    }
    setSteps(newSteps)
  }, [steps])

  const updateStep = useCallback((index, updates) => {
    const newSteps = [...steps]
    newSteps[index] = { ...newSteps[index], ...updates }
    setSteps(newSteps)
  }, [steps])

  // Build Phase Component
  const BuildPhase = () => (
    <div className="space-y-6">
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/60 p-8">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
            <Bot className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Phase 1: Build Workflow</h1>
            <p className="text-slate-600">Design your workflow steps and assign AI agents</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Workflow Steps */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Workflow Steps</h3>
            {steps.map((step, index) => (
              <div key={step.id} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold text-blue-700">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-slate-900">{step.title}</h4>
                    <p className="text-sm text-slate-600">{step.description}</p>
                  </div>
                  {step.selectedAgent && (
                    <div className="flex items-center gap-2 text-green-600">
                      <CheckCircle className="h-5 w-5" />
                      <span className="text-sm font-medium">Agent Assigned</span>
                    </div>
                  )}
                </div>
                
                {step.selectedAgent && (
                  <div className="mt-3 p-3 bg-green-50 rounded-lg border border-green-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Zap className="h-4 w-4 text-green-600" />
                      <span className="font-medium text-green-900">{step.selectedAgent.name}</span>
                    </div>
                    <p className="text-sm text-green-700">{step.selectedAgent.description}</p>
                    {step.selectedAgent.requiredPlugins?.length > 0 && (
                      <div className="mt-2">
                        <span className="text-xs text-green-600 font-medium">Required Integrations: </span>
                        <span className="text-xs text-green-700">
                          {step.selectedAgent.requiredPlugins.map(plugin => 
                            availablePlugins.find(p => p.id === plugin)?.name
                          ).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Agent Library */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Available Agents</h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {enhancedAgentLibrary.map((agent) => (
                <div key={agent.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm hover:shadow-md transition-all cursor-pointer">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <h4 className="font-semibold text-slate-900">{agent.name}</h4>
                      <p className="text-sm text-slate-600 mb-2">{agent.description}</p>
                      <span className="inline-block px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                        {agent.category}
                      </span>
                    </div>
                  </div>
                  
                  {agent.requiredPlugins.length > 0 && (
                    <div className="flex items-center gap-2 mb-3">
                      <Link className="h-4 w-4 text-slate-500" />
                      <span className="text-xs text-slate-600">
                        Requires: {agent.requiredPlugins.map(plugin => 
                          availablePlugins.find(p => p.id === plugin)?.name
                        ).join(', ')}
                      </span>
                    </div>
                  )}
                  
                  <div className="flex gap-2">
                    {steps.map((step, stepIndex) => (
                      <button
                        key={stepIndex}
                        onClick={() => handleAgentAssignment(agent, stepIndex)}
                        className="px-3 py-1 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all"
                      >
                        Assign to Step {stepIndex + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-8 pt-6 border-t border-slate-200">
          <button
            onClick={() => setCurrentPhase('configure')}
            className="px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl font-semibold transition-all"
          >
            Next: Configure Integrations →
          </button>
        </div>
      </div>
    </div>
  )

  // Configure Integrations Phase
  const ConfigurePhase = () => {
    const stepsWithAgents = steps.filter(step => 
      step.selectedAgent && 
      step.selectedAgent.requiredPlugins && 
      step.selectedAgent.requiredPlugins.length > 0
    )

    const handleConnect = (pluginId, stepIndex) => {
      setTestResults(prev => ({
        ...prev,
        [`${stepIndex}-${pluginId}`]: { status: 'testing', message: 'Connecting...' }
      }))

      setTimeout(() => {
        setConnectedPlugins(prev => new Set([...prev, `${stepIndex}-${pluginId}`]))
        setTestResults(prev => ({
          ...prev,
          [`${stepIndex}-${pluginId}`]: { status: 'success', message: 'Connection successful!' }
        }))
        
        updateStep(stepIndex, {
          configurationComplete: true,
          configurationData: {
            ...configData[`${stepIndex}-${pluginId}`],
            connected: true
          }
        })
      }, 1500)
    }

    const handleConfigChange = (stepIndex, pluginId, field, value) => {
      const key = `${stepIndex}-${pluginId}`
      setConfigData(prev => ({
        ...prev,
        [key]: {
          ...prev[key],
          [field]: value
        }
      }))
    }

    const getConnectionStatus = (pluginId, stepIndex) => {
      const key = `${stepIndex}-${pluginId}`
      if (connectedPlugins.has(key)) return 'connected'
      if (testResults[key]?.status === 'testing') return 'testing'
      return 'disconnected'
    }

    const renderPluginConfig = (pluginId, plugin, stepIndex) => {
      const key = `${stepIndex}-${pluginId}`
      const status = getConnectionStatus(pluginId, stepIndex)
      const isConnected = status === 'connected'
      const isTesting = status === 'testing'
      const config = configData[key] || {}

      return (
        <div key={pluginId} className="border border-slate-200 rounded-lg p-4 transition-all hover:shadow-md">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative">
              <plugin.icon className="h-5 w-5 text-slate-600" />
              {isConnected && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
              )}
            </div>
            <div className="flex-1">
              <h6 className="font-medium text-slate-900">{plugin.name}</h6>
              <p className="text-xs text-slate-600">{plugin.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {isConnected && (
                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                  Connected
                </span>
              )}
              {isTesting && (
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full animate-pulse">
                  Testing...
                </span>
              )}
            </div>
          </div>
          
          {/* Simple configuration form */}
          <div className="space-y-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Account/Connection *
              </label>
              <input
                type="text"
                placeholder={`Connect your ${plugin.name} account`}
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                value={config.account || ''}
                onChange={(e) => handleConfigChange(stepIndex, pluginId, 'account', e.target.value)}
              />
            </div>
          </div>

          {/* Connection Status & Actions */}
          <div className="space-y-3">
            {testResults[key] && (
              <div className={`p-3 rounded-lg text-sm ${
                testResults[key].status === 'success' ? 'bg-green-50 text-green-700' :
                testResults[key].status === 'testing' ? 'bg-blue-50 text-blue-700' :
                'bg-red-50 text-red-700'
              }`}>
                <div className="flex items-center gap-2">
                  {testResults[key].status === 'success' && <Check className="h-4 w-4" />}
                  {testResults[key].status === 'testing' && <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>}
                  {testResults[key].message}
                </div>
              </div>
            )}
            
            <div className="flex gap-2">
              {!isConnected && !isTesting && (
                <button 
                  onClick={() => handleConnect(pluginId, stepIndex)}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all text-sm font-medium"
                >
                  Connect {plugin.name}
                </button>
              )}
              
              {isConnected && (
                <button className="flex-1 px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium">
                  ✓ Connected
                </button>
              )}
            </div>
          </div>
        </div>
      )
    }

    const totalPlugins = stepsWithAgents.reduce((acc, step, stepIndex) => 
      acc + (step.selectedAgent?.requiredPlugins?.length || 0), 0
    )
    const connectedCount = [...connectedPlugins].length

    return (
      <div className="space-y-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/60 p-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-red-600 rounded-xl flex items-center justify-center shadow-lg">
                <Settings className="h-6 w-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Phase 2: Configure Integrations</h1>
                <p className="text-slate-600">Connect your real accounts and set up business rules</p>
              </div>
            </div>
            
            <div className="text-right">
              <div className="text-2xl font-bold text-slate-900">{connectedCount}/{totalPlugins}</div>
              <div className="text-sm text-slate-600">Integrations Connected</div>
              <div className="w-32 h-2 bg-slate-200 rounded-full mt-2">
                <div 
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-500"
                  style={{ width: `${totalPlugins ? (connectedCount / totalPlugins) * 100 : 0}%` }}
                ></div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
            {stepsWithAgents.map((step, stepIndex) => {
              const agent = step.selectedAgent
              const actualStepIndex = steps.findIndex(s => s.id === step.id)
              
              return (
                <div key={step.id} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition-all">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold text-blue-700">
                      {actualStepIndex + 1}
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900">{agent?.name}</h3>
                      <p className="text-sm text-slate-600">{step.title}</p>
                    </div>
                  </div>
                  
                  <div>
                    <p className="text-sm text-slate-600 mb-4 font-medium">Required integrations:</p>
                    <div className="space-y-4">
                      {agent.requiredPlugins.map(pluginId => {
                        const plugin = availablePlugins.find(p => p.id === pluginId)
                        return plugin ? renderPluginConfig(pluginId, plugin, actualStepIndex) : null
                      })}
                    </div>
                  </div>
                </div>
              )
            })}
            
            {stepsWithAgents.length === 0 && (
              <div className="col-span-full text-center py-12">
                <div className="text-6xl mb-4">🤖</div>
                <h2 className="text-xl font-semibold text-slate-900 mb-2">No Integrations to Configure</h2>
                <p className="text-slate-600 mb-6">
                  Your workflow steps don't require external integrations, or no agents have been assigned yet.
                </p>
                <button 
                  onClick={() => setCurrentPhase('build')}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
                >
                  ← Back to Build Phase
                </button>
              </div>
            )}
          </div>

          <div className="flex justify-between items-center mt-8 pt-6 border-t border-slate-200">
            <button 
              onClick={() => setCurrentPhase('build')}
              className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors font-medium"
            >
              ← Back to Build
            </button>
            
            <div className="flex items-center gap-4">
              {connectedCount === totalPlugins && totalPlugins > 0 && (
                <div className="flex items-center gap-2 text-green-600">
                  <CheckCircle className="h-5 w-5" />
                  <span className="text-sm font-medium">All integrations configured!</span>
                </div>
              )}
              
              <button 
                onClick={() => setCurrentPhase('test')}
                className={`px-6 py-3 rounded-xl font-semibold transition-all ${
                  (connectedCount === totalPlugins && totalPlugins > 0) || stepsWithAgents.length === 0
                    ? 'bg-gradient-to-r from-orange-600 to-red-600 hover:from-orange-700 hover:to-red-700 text-white shadow-lg'
                    : 'bg-slate-200 text-slate-500 cursor-not-allowed'
                }`}
                disabled={stepsWithAgents.length > 0 && connectedCount !== totalPlugins}
              >
                Next: Test & Validate →
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Test Phase Placeholder
  const TestPhase = () => (
    <div className="space-y-6">
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-white/60 p-8 text-center">
        <div className="text-6xl mb-4">🧪</div>
        <h3 className="text-xl font-semibold text-slate-900 mb-2">Test & Validate Phase</h3>
        <p className="text-slate-600 mb-6">Testing phase coming soon...</p>
        <div className="flex justify-center">
          <button
            onClick={() => setCurrentPhase('configure')}
            className="px-6 py-3 border border-slate-300 text-slate-700 rounded-xl hover:bg-slate-50 transition-colors"
          >
            ← Back to Configure
          </button>
        </div>
      </div>
    </div>
  )

  const renderCurrentPhase = () => {
    switch (currentPhase) {
      case 'build':
        return <BuildPhase />
      case 'configure':
        return <ConfigurePhase />
      case 'test':
        return <TestPhase />
      default:
        return <BuildPhase />
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Phase Navigation */}
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-white/40 p-6">
          <div className="flex items-center justify-center gap-8">
            <button 
              onClick={() => setCurrentPhase('build')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                currentPhase === 'build' 
                  ? 'bg-blue-600 text-white shadow-lg' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Bot className="h-5 w-5" />
              Build Workflow
            </button>
            <div className="w-8 h-0.5 bg-slate-300"></div>
            <button 
              onClick={() => setCurrentPhase('configure')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                currentPhase === 'configure' 
                  ? 'bg-orange-600 text-white shadow-lg' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Settings className="h-5 w-5" />
              Configure Integrations
            </button>
            <div className="w-8 h-0.5 bg-slate-300"></div>
            <button 
              onClick={() => setCurrentPhase('test')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all ${
                currentPhase === 'test' 
                  ? 'bg-purple-600 text-white shadow-lg' 
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Play className="h-5 w-5" />
              Test & Validate
            </button>
          </div>
        </div>

        {/* Current Phase Content */}
        {renderCurrentPhase()}
      </div>
    </div>
  )
}

export default WorkflowWithIntegrations
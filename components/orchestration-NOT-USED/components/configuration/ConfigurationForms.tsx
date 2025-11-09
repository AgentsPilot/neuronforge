// components/orchestration/components/configuration/ConfigurationForms.tsx
import React, { useState } from 'react'
import { ChevronDown, AlertCircle, Check } from 'lucide-react'
import { PluginConnection } from './PluginConnectionManager'
import { pluginRegistry, getPluginConfig } from './IntegrationCards'
import { WorkflowStep } from '../../types/workflow'

// Define what plugin categories each agent type can use
const agentPluginCategories = {
  'email': ['Email', 'Marketing'],
  'crm': ['CRM'],
  'notification': ['Communication'],
  'data': ['Database', 'Storage'],
  'document': ['Documentation', 'Storage'],
  'automation': ['Automation'],
  'api': ['Database', 'Storage', 'Documentation']
}

interface ConfigurationFormsProps {
  step: WorkflowStep
  stepIndex: number
  pluginConnections: PluginConnection[]
  selectedPlugins: Record<number, string>
  configData: Record<string, any>
  testResults: Record<string, { status: string; message: string }>
  connectedSteps: Set<number>
  onPluginSelect: (stepIndex: number, pluginKey: string) => void
  onConfigChange: (stepIndex: number, field: string, value: string) => void
  onConnect: (stepIndex: number) => void
}

// Determine what plugin categories an agent can use
const getAgentPluginCategories = (step: WorkflowStep): string[] => {
  if (!step.selectedAgent) return []

  const agentName = step.selectedAgent.name.toLowerCase()
  const stepTitle = step.title.toLowerCase()

  // Check agent name and step title for keywords
  if (agentName.includes('email') || stepTitle.includes('email') || stepTitle.includes('mail')) {
    return agentPluginCategories.email
  }
  if (agentName.includes('crm') || stepTitle.includes('crm') || stepTitle.includes('lead') || stepTitle.includes('customer')) {
    return agentPluginCategories.crm
  }
  if (agentName.includes('notification') || agentName.includes('alert') || stepTitle.includes('notify')) {
    return agentPluginCategories.notification
  }
  if (agentName.includes('notion') || stepTitle.includes('notion') || stepTitle.includes('document')) {
    return agentPluginCategories.document
  }
  if (agentName.includes('data') || agentName.includes('extract') || stepTitle.includes('data') || stepTitle.includes('parse')) {
    return agentPluginCategories.data
  }
  if (agentName.includes('api') || agentName.includes('connector')) {
    return agentPluginCategories.api
  }

  // Default: allow most common categories
  return ['Database', 'Storage', 'Communication']
}

const getStepStatus = (
  stepIndex: number,
  selectedPlugins: Record<number, string>,
  connectedSteps: Set<number>,
  testResults: Record<string, { status: string; message: string }>
) => {
  const pluginKey = selectedPlugins[stepIndex]
  if (!pluginKey) return 'not-selected'
  
  if (connectedSteps.has(stepIndex)) return 'connected'
  
  const key = `${stepIndex}-${pluginKey}`
  if (testResults[key]?.status === 'testing') return 'testing'
  
  return 'ready'
}

export const ConfigurationForms: React.FC<ConfigurationFormsProps> = ({
  step,
  stepIndex,
  pluginConnections,
  selectedPlugins,
  configData,
  testResults,
  connectedSteps,
  onPluginSelect,
  onConfigChange,
  onConnect
}) => {
  const allowedCategories = getAgentPluginCategories(step)
  const selectedPluginKey = selectedPlugins[stepIndex]
  const selectedConnection = pluginConnections.find(conn => conn.plugin_key === selectedPluginKey)
  const status = getStepStatus(stepIndex, selectedPlugins, connectedSteps, testResults)
  
  // Get ALL relevant plugins for this agent type (both connected and not connected)
  const allRelevantPlugins = pluginRegistry.filter(plugin => 
    allowedCategories.includes(plugin.category)
  )
  
  // Get only the connected plugins for this agent type
  const connectedRelevantPlugins = pluginConnections.filter(connection => {
    const plugin = pluginRegistry.find(p => p.id === connection.plugin_key)
    return plugin && allowedCategories.includes(plugin.category)
  })

  if (allRelevantPlugins.length === 0) {
    return (
      <div className="text-center py-6 text-slate-500">
        <AlertCircle className="h-8 w-8 mx-auto mb-2 text-slate-400" />
        <p className="text-sm">This agent type doesn't need any integrations</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Plugin Selection with ALL relevant plugins */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Choose Integration ({connectedRelevantPlugins.length} of {allRelevantPlugins.length} connected)
        </label>
        <div className="relative">
          <select
            value={selectedPluginKey || ''}
            onChange={(e) => onPluginSelect(stepIndex, e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm appearance-none bg-white"
          >
            <option value="">Select an integration...</option>
            {allRelevantPlugins.map(plugin => {
              const connection = pluginConnections.find(c => c.plugin_key === plugin.id)
              const isConnected = !!connection
              return (
                <option key={plugin.id} value={plugin.id}>
                  {plugin.name} ({plugin.category}) {!isConnected ? '- Not Connected' : ''}
                </option>
              )
            })}
          </select>
          <ChevronDown className="absolute right-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Show message for selected but not connected plugin */}
      {selectedPluginKey && !selectedConnection && (
        <div className="text-center py-6 text-amber-600 bg-amber-50 rounded-lg border border-amber-200">
          <AlertCircle className="h-8 w-8 mx-auto mb-2" />
          <p className="text-sm font-medium mb-1">Plugin Not Connected</p>
          <p className="text-xs mb-3">
            You selected <strong>{pluginRegistry.find(p => p.id === selectedPluginKey)?.name}</strong> but it's not connected to your account.
          </p>
          <button 
            className="px-3 py-1 bg-amber-600 text-white text-xs rounded-lg hover:bg-amber-700 transition-colors"
            onClick={() => {
              // In real app, this would redirect to plugin connection flow
              const pluginName = pluginRegistry.find(p => p.id === selectedPluginKey)?.name
              alert(`Redirecting to connect ${pluginName}...`)
            }}
          >
            Connect {pluginRegistry.find(p => p.id === selectedPluginKey)?.name}
          </button>
        </div>
      )}

      {/* Configuration for selected AND connected plugin */}
      {selectedConnection && (
        <div className="border border-slate-200 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="relative">
              {(() => {
                const plugin = getPluginConfig(selectedConnection.plugin_key)
                return <plugin.icon className="h-6 w-6 text-slate-600" />
              })()}
              {status === 'connected' && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-white"></div>
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h6 className="font-medium text-slate-900">{selectedConnection.plugin_name}</h6>
                <span className="px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                  Connected
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Connected {new Date(selectedConnection.connected_at).toLocaleDateString('en-GB')}
                {selectedConnection.email && ` • ${selectedConnection.email}`}
                {selectedConnection.username && ` • ${selectedConnection.username}`}
                {selectedConnection.profile_data?.email && ` • ${selectedConnection.profile_data.email}`}
              </p>
            </div>
          </div>
          
          {/* Configuration Options */}
          <div className="space-y-3 mb-4">
            {/* Plugin-specific fields based on category */}
            {getPluginConfig(selectedConnection.plugin_key).category === 'Email' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Email Filter (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., from:invoices@company.com, subject:invoice, has:attachment"
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={configData[`${stepIndex}-${selectedConnection.plugin_key}`]?.filter || ''}
                    onChange={(e) => onConfigChange(stepIndex, 'filter', e.target.value)}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Use Gmail search syntax to filter emails (leave empty to process all emails)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Max Emails to Process
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={configData[`${stepIndex}-${selectedConnection.plugin_key}`]?.maxResults || '50'}
                    onChange={(e) => onConfigChange(stepIndex, 'maxResults', e.target.value)}
                  >
                    <option value="10">10 emails</option>
                    <option value="25">25 emails</option>
                    <option value="50">50 emails</option>
                    <option value="100">100 emails</option>
                    <option value="250">250 emails</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Maximum number of emails to process per run
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Processing Mode
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={configData[`${stepIndex}-${selectedConnection.plugin_key}`]?.mode || 'recent'}
                    onChange={(e) => onConfigChange(stepIndex, 'mode', e.target.value)}
                  >
                    <option value="recent">Recent emails only</option>
                    <option value="unread">Unread emails only</option>
                    <option value="all">All emails (matching filter)</option>
                    <option value="labeled">Specific label only</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    Choose which emails to process
                  </p>
                </div>

                {configData[`${stepIndex}-${selectedConnection.plugin_key}`]?.mode === 'labeled' && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Gmail Label
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., INBOX, IMPORTANT, Custom Label"
                      className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                      value={configData[`${stepIndex}-${selectedConnection.plugin_key}`]?.label || ''}
                      onChange={(e) => onConfigChange(stepIndex, 'label', e.target.value)}
                    />
                    <p className="text-xs text-slate-500 mt-1">
                      Specific Gmail label to process
                    </p>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Include Attachments
                  </label>
                  <select
                    className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                    value={configData[`${stepIndex}-${selectedConnection.plugin_key}`]?.attachments || 'metadata'}
                    onChange={(e) => onConfigChange(stepIndex, 'attachments', e.target.value)}
                  >
                    <option value="none">No attachments</option>
                    <option value="metadata">Attachment info only</option>
                    <option value="download">Download attachments</option>
                  </select>
                  <p className="text-xs text-slate-500 mt-1">
                    How to handle email attachments
                  </p>
                </div>
              </>
            )}
            
            {getPluginConfig(selectedConnection.plugin_key).category === 'Documentation' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Workspace/Database ID (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., workspace-id or database-id"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                  value={configData[`${stepIndex}-${selectedConnection.plugin_key}`]?.workspaceId || ''}
                  onChange={(e) => onConfigChange(stepIndex, 'workspaceId', e.target.value)}
                />
              </div>
            )}
            
            {getPluginConfig(selectedConnection.plugin_key).category === 'CRM' && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Object/Entity Type (optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g., Contact, Lead, Account"
                  className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-sm"
                  value={configData[`${stepIndex}-${selectedConnection.plugin_key}`]?.objectType || ''}
                  onChange={(e) => onConfigChange(stepIndex, 'objectType', e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Status and Actions */}
          <div className="space-y-3">
            {testResults[`${stepIndex}-${selectedConnection.plugin_key}`] && (
              <div className={`p-3 rounded-lg text-sm ${
                testResults[`${stepIndex}-${selectedConnection.plugin_key}`].status === 'success' ? 'bg-green-50 text-green-700' :
                testResults[`${stepIndex}-${selectedConnection.plugin_key}`].status === 'testing' ? 'bg-blue-50 text-blue-700' :
                'bg-red-50 text-red-700'
              }`}>
                <div className="flex items-center gap-2">
                  {testResults[`${stepIndex}-${selectedConnection.plugin_key}`].status === 'success' && <Check className="h-4 w-4" />}
                  {testResults[`${stepIndex}-${selectedConnection.plugin_key}`].status === 'testing' && <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>}
                  {testResults[`${stepIndex}-${selectedConnection.plugin_key}`].message}
                </div>
              </div>
            )}
            
            <div className="flex gap-2">
              {status === 'ready' && (
                <button 
                  onClick={() => onConnect(stepIndex)}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all text-sm font-medium"
                >
                  Configure Integration
                </button>
              )}
              
              {status === 'testing' && (
                <button disabled className="flex-1 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-medium">
                  Configuring...
                </button>
              )}
              
              {status === 'connected' && (
                <button className="flex-1 px-4 py-2 bg-green-100 text-green-700 rounded-lg text-sm font-medium">
                  ✓ Configured
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
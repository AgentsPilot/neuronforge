/**
 * @deprecated This entire file is deprecated and should not be used.
 * This component is part of the old orchestration system.
 */

// components/orchestration/components/configuration/IntegrationCards.tsx
import React from 'react'
import { Mail, Database, FileText, Users, Folder, Globe, Calendar, MessageSquare, BarChart3, FileSpreadsheet, Package, Zap, AlertCircle } from 'lucide-react'
import { PluginConnection } from './PluginConnectionManager'

// Plugin registry for display
/** @deprecated This component is part of the old orchestration system */
export const pluginRegistry = [
  { id: 'google-mail', name: 'Gmail', description: 'Connect to Gmail for email processing', icon: Mail, category: 'Email' },
  { id: 'outlook', name: 'Outlook', description: 'Connect to Microsoft Outlook', icon: Mail, category: 'Email' },
  { id: 'salesforce', name: 'Salesforce', description: 'Sync data with Salesforce CRM', icon: Database, category: 'CRM' },
  { id: 'hubspot', name: 'HubSpot', description: 'Integrate with HubSpot CRM', icon: Users, category: 'CRM' },
  { id: 'pipedrive', name: 'Pipedrive', description: 'Sync with Pipedrive CRM', icon: Database, category: 'CRM' },
  { id: 'notion', name: 'Notion', description: 'Create and update Notion pages', icon: FileText, category: 'Documentation' },
  { id: 'google-drive', name: 'Google Drive', description: 'Access Google Drive files', icon: Folder, category: 'Storage' },
  { id: 'slack', name: 'Slack', description: 'Send messages and notifications to Slack', icon: MessageSquare, category: 'Communication' },
  { id: 'zapier', name: 'Zapier', description: 'Connect to thousands of apps via Zapier', icon: Zap, category: 'Automation' },
  { id: 'airtable', name: 'Airtable', description: 'Manage data in Airtable databases', icon: FileSpreadsheet, category: 'Database' },
  { id: 'mailchimp', name: 'Mailchimp', description: 'Manage email marketing campaigns', icon: Mail, category: 'Marketing' },
  { id: 'trello', name: 'Trello', description: 'Manage Trello boards and cards', icon: Package, category: 'Project Management' }
]

interface IntegrationCardsProps {
  pluginConnections: PluginConnection[]
  currentUserId: string | null
}

/** @deprecated This component is part of the old orchestration system */
export const getPluginConfig = (pluginKey: string) => {
  const plugin = pluginRegistry.find(p => p.id === pluginKey)
  return plugin || {
    id: pluginKey,
    name: pluginKey.charAt(0).toUpperCase() + pluginKey.slice(1).replace(/-/g, ' '),
    description: `Connect to ${pluginKey}`,
    icon: Globe,
    category: 'External Service'
  }
}

/** @deprecated This component is part of the old orchestration system */
export const IntegrationCards: React.FC<IntegrationCardsProps> = ({
  pluginConnections,
  currentUserId
}) => {
  return (
    <div className="space-y-4">
      {/* 🔍 DEBUG PANEL - Shows exactly what's connected */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h3 className="font-bold text-blue-900 mb-2">🔍 DEBUG: What's Actually Connected</h3>
        <div className="text-sm space-y-1">
          <div><strong>Current User ID:</strong> {currentUserId || 'Not authenticated'}</div>
          <div><strong>Authentication Status:</strong> {currentUserId ? (currentUserId === 'mock-user' ? 'Mock User (Testing)' : 'Authenticated') : 'Not Authenticated'}</div>
          <div><strong>Total Plugin Connections:</strong> {pluginConnections.length}</div>
          <div><strong>Connected Plugin Keys:</strong> {pluginConnections.map(c => c.plugin_key).join(', ') || 'None'}</div>
          {currentUserId === 'mock-user' && (
            <div className="bg-amber-100 border border-amber-300 rounded p-2 mt-2">
              <strong>⚠️ Testing Mode:</strong> Using mock data since user is not authenticated. 
              <br />Set up authentication to see real plugin connections.
            </div>
          )}
          <div className="mt-2">
            <strong>Full Connection Details:</strong>
            <pre className="text-xs bg-white p-2 rounded mt-1 overflow-auto max-h-32">
              {JSON.stringify(pluginConnections, null, 2)}
            </pre>
          </div>
        </div>
      </div>

      {/* Authentication Warning */}
      {!currentUserId && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-600" />
            <h3 className="font-semibold text-amber-900">Authentication Required</h3>
          </div>
          <p className="text-amber-700 text-sm mt-1">
            Please log in to see your connected integrations. Currently using mock data for testing.
          </p>
        </div>
      )}

      {/* Testing Mode Notice */}
      {currentUserId === 'mock-user' && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-green-600" />
            <h3 className="font-semibold text-green-900">Testing Mode Active</h3>
          </div>
          <p className="text-green-700 text-sm mt-1">
            Using mock plugin connections for testing. The Gmail OAuth integration can now be tested!
          </p>
        </div>
      )}

      {/* Connected Plugins Summary */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h3 className="font-semibold text-green-900 mb-2">Your Connected Accounts ({pluginConnections.length})</h3>
        {pluginConnections.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {pluginConnections.map(connection => {
              const plugin = getPluginConfig(connection.plugin_key)
              return (
                <span key={connection.id} className="inline-flex items-center gap-1 px-2 py-1 bg-white text-green-700 rounded-full text-sm border border-green-200">
                  <plugin.icon className="h-3 w-3" />
                  {connection.plugin_name}
                </span>
              )
            })}
          </div>
        ) : (
          <p className="text-green-600 text-sm">
            {currentUserId ? 'No plugins connected yet' : 'Please log in to see connected plugins'}
          </p>
        )}
        <p className="text-xs text-green-600 mt-2">
          Choose which integration each agent should use. You can change from the original suggestion.
        </p>
      </div>
    </div>
  )
}
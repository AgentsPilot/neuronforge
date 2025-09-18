// components/dashboard/AgentDashboardWithVisualization.tsx

import React, { useState, useCallback } from 'react'
import AgentSandbox from './AgentSandBox/AgentSandbox'
import StandaloneAgentVisualizer from './StandaloneAgentVisualizer'
import { Brain, Play, BarChart3, ArrowLeft } from 'lucide-react'

interface AgentDashboardProps {
  agentId: string
  inputSchema?: any[]
  outputSchema?: any[]
  userPrompt: string
  pluginsRequired?: string[]
}

type ViewMode = 'sandbox' | 'visualizer'

const AgentDashboardWithVisualization: React.FC<AgentDashboardProps> = ({
  agentId,
  inputSchema,
  outputSchema,
  userPrompt,
  pluginsRequired
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('sandbox')
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null)

  const handleExecutionSelect = useCallback((executionId: string) => {
    setSelectedExecutionId(executionId)
    setViewMode('visualizer')
  }, [])

  const handleBackToSandbox = useCallback(() => {
    setViewMode('sandbox')
    setSelectedExecutionId(null)
  }, [])

  return (
    <div className="space-y-6">
      {/* Navigation Header */}
      <div className="flex items-center justify-between bg-white border rounded-xl p-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-gray-800">Agent Dashboard</h1>
          
          {/* View Mode Tabs */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('sandbox')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                viewMode === 'sandbox'
                  ? 'bg-white text-blue-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <Play className="h-4 w-4" />
              Sandbox
            </button>
            <button
              onClick={() => setViewMode('visualizer')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all ${
                viewMode === 'visualizer'
                  ? 'bg-white text-purple-600 shadow-sm'
                  : 'text-gray-600 hover:text-gray-800'
              }`}
            >
              <BarChart3 className="h-4 w-4" />
              Visualizer
            </button>
          </div>
        </div>

        {/* Back Button */}
        {viewMode === 'visualizer' && selectedExecutionId && (
          <button
            onClick={handleBackToSandbox}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Sandbox
          </button>
        )}
      </div>

      {/* Content Area */}
      {viewMode === 'sandbox' ? (
        <AgentSandbox
          agentId={agentId}
          inputSchema={inputSchema}
          outputSchema={outputSchema}
          userPrompt={userPrompt}
          pluginsRequired={pluginsRequired}
          onExecutionComplete={(executionId: string) => {
            // Automatically switch to visualizer when execution completes
            if (executionId) {
              setSelectedExecutionId(executionId)
              // Don't auto-switch, let user decide
              // setViewMode('visualizer')
            }
          }}
        />
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <StandaloneAgentVisualizer
            executionId={selectedExecutionId}
            agentId={agentId}
            autoRefresh={true}
            onExecutionSelect={handleExecutionSelect}
          />
        </div>
      )}
    </div>
  )
}

export default AgentDashboardWithVisualization
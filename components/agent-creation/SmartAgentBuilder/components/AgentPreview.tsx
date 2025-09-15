// components/agent-creation/SmartAgentBuilder/components/AgentPreview.tsx

import React from 'react';
import { Sparkles, User, Bot, Send, Mail, Bell, FileText, Settings } from 'lucide-react';
import { AgentPreviewProps } from '../types/agent';

export default function AgentPreview({
  agent,
  prompt,
  promptType,
  isEditing,
  onUpdate
}: AgentPreviewProps) {
  if (!agent) return null;

  const getOutputIcon = (type: string) => {
    switch (type) {
      case 'EmailDraft': return <Mail className="h-3 w-3" />;
      case 'Alert': return <Bell className="h-3 w-3" />;
      case 'SummaryBlock': return <FileText className="h-3 w-3" />;
      case 'PluginAction': return <Settings className="h-3 w-3" />;
      default: return <Send className="h-3 w-3" />;
    }
  };

  const humanFacingOutputs = agent.output_schema?.filter(o => o.category === 'human-facing') || [];
  const machineFacingOutputs = agent.output_schema?.filter(o => o.category === 'machine-facing') || [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
          <Sparkles className="h-6 w-6 text-white" />
        </div>
        <div className="flex-1">
          {isEditing ? (
            <div className="space-y-3">
              <input
                type="text"
                value={agent.agent_name}
                onChange={(e) => onUpdate({ agent_name: e.target.value })}
                className="text-lg font-semibold text-gray-900 bg-transparent border-b border-gray-300 focus:border-blue-500 outline-none w-full"
                placeholder="Agent Name"
              />
              <textarea
                value={agent.description}
                onChange={(e) => onUpdate({ description: e.target.value })}
                className="text-gray-600 leading-relaxed w-full bg-transparent border border-gray-300 rounded-lg p-3 focus:border-blue-500 outline-none resize-none"
                rows={3}
                placeholder="Agent Description"
              />
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-gray-900 mb-2">{agent.agent_name}</h2>
              <p className="text-gray-600 leading-relaxed">{agent.description}</p>
            </>
          )}
        </div>
        <div className="text-right text-sm text-gray-500 space-y-1">
          <div>Plugins: {agent.plugins_required?.length || 0}</div>
          <div>Inputs: {agent.input_schema?.length || 0}</div>
          <div>Outputs: {agent.output_schema?.length || 0}</div>
        </div>
      </div>

      {/* Enhanced Output Summary */}
      {agent.output_schema && agent.output_schema.length > 0 && (
        <div className="mt-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg">
          <h4 className="text-sm font-medium text-green-800 mb-3 flex items-center gap-2">
            <Send className="h-4 w-4" />
            Agent Output Strategy
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Human-facing outputs */}
            {humanFacingOutputs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <User className="h-4 w-4 text-blue-600" />
                  <span className="text-xs font-medium text-gray-700">For Humans ({humanFacingOutputs.length})</span>
                </div>
                <div className="space-y-1">
                  {humanFacingOutputs.map((output, index) => (
                    <div key={index} className="flex items-center gap-2 text-xs">
                      <div className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center">
                        <span className="text-blue-600">
                          {getOutputIcon(output.type)}
                        </span>
                      </div>
                      <span className="text-gray-700">{output.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Machine-facing outputs */}
            {machineFacingOutputs.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Bot className="h-4 w-4 text-purple-600" />
                  <span className="text-xs font-medium text-gray-700">System Actions ({machineFacingOutputs.length})</span>
                </div>
                <div className="space-y-1">
                  {machineFacingOutputs.map((output, index) => (
                    <div key={index} className="flex items-center gap-2 text-xs">
                      <div className="w-5 h-5 bg-purple-100 rounded flex items-center justify-center">
                        <span className="text-purple-600">
                          {getOutputIcon(output.type)}
                        </span>
                      </div>
                      <span className="text-gray-700">
                        {output.name}
                        {output.plugin && (
                          <span className="text-purple-600 ml-1">({output.plugin})</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Output confidence indicator */}
          {agent.extraction_details?.output_inference?.confidence && (
            <div className="mt-3 pt-3 border-t border-green-200">
              <div className="flex items-center justify-between text-xs">
                <span className="text-green-700">Output Detection Confidence</span>
                <span className="font-medium text-green-800">
                  {Math.round(agent.extraction_details.output_inference.confidence * 100)}%
                </span>
              </div>
              <div className="mt-1 w-full bg-green-200 rounded-full h-1.5">
                <div 
                  className="bg-green-600 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${agent.extraction_details.output_inference.confidence * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}
      
      {/* Source Prompt */}
      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <h4 className="text-sm font-medium text-gray-700 mb-2">
          Source Prompt ({promptType}):
        </h4>
        <p className="text-sm text-gray-600">{prompt}</p>
      </div>
    </div>
  );
}
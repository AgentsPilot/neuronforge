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

  const formatPromptText = (text: string) => {
    return text
      .split('•')
      .map((item, index) => {
        if (index === 0) return item;
        return `• ${item.trim()}`;
      })
      .join('\n')
      .split('**')
      .map((part, index) => {
        if (index % 2 === 1) {
          return `\n**${part}**\n`;
        }
        return part;
      })
      .join('')
      .trim();
  };

  const humanFacingOutputs = agent.output_schema?.filter(o => o.category === 'human-facing') || [];
  const machineFacingOutputs = agent.output_schema?.filter(o => o.category === 'machine-facing') || [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      {/* Header Section */}
      <div className={`flex items-start justify-between mb-6 ${isEditing ? 'flex-col lg:flex-row gap-4' : ''}`}>
        <div className={`flex items-start gap-3 ${isEditing ? 'w-full' : ''}`}>
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div className={`${isEditing ? 'flex-1' : ''}`}>
            {isEditing ? (
              <div className="space-y-4 w-full">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Agent Name</label>
                  <input
                    type="text"
                    value={agent.agent_name}
                    onChange={(e) => onUpdate({ agent_name: e.target.value })}
                    className="w-full text-lg font-bold text-gray-900 bg-white border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200"
                    placeholder="Enter agent name..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Agent Description</label>
                  <textarea
                    value={agent.description}
                    onChange={(e) => onUpdate({ description: e.target.value })}
                    className="w-full text-gray-700 bg-white border border-gray-300 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 resize-vertical"
                    rows={4}
                    placeholder="Describe what this agent does and how it helps users..."
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    Tip: Provide a clear, concise description of the agent's purpose and capabilities
                  </div>
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-bold text-gray-900">{agent.agent_name}</h2>
                <p className="text-gray-600 text-sm mt-1 leading-relaxed">{agent.description}</p>
              </>
            )}
          </div>
        </div>
        
        {/* Stats - Horizontal */}
        <div className={`flex gap-6 text-center text-xs ${isEditing ? 'w-full lg:w-auto justify-center lg:justify-end' : ''}`}>
          <div className="bg-blue-50 rounded-lg px-3 py-2">
            <div className="font-bold text-blue-600">{agent.plugins_required?.length || 0}</div>
            <div className="text-gray-500">Plugins</div>
          </div>
          <div className="bg-green-50 rounded-lg px-3 py-2">
            <div className="font-bold text-green-600">{agent.input_schema?.length || 0}</div>
            <div className="text-gray-500">Inputs</div>
          </div>
          <div className="bg-purple-50 rounded-lg px-3 py-2">
            <div className="font-bold text-purple-600">{agent.output_schema?.length || 0}</div>
            <div className="text-gray-500">Outputs</div>
          </div>
        </div>
      </div>

      {/* Two Column Layout - Source Prompt Left, Output Strategy Right */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Left Column - Source Prompt */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-blue-600 rounded-lg flex items-center justify-center">
              <Bot className="h-3 w-3 text-white" />
            </div>
            <h3 className="font-semibold text-gray-900">Source Prompt</h3>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
              {promptType}
            </span>
          </div>
          
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="bg-white rounded p-4 border border-gray-200">
              {formatPromptText(prompt).split('\n').map((line, index) => {
                if (line.startsWith('**') && line.endsWith('**')) {
                  return (
                    <h4 key={index} className="text-sm font-semibold text-gray-900 mt-3 mb-2 first:mt-0">
                      {line.replace(/\*\*/g, '')}
                    </h4>
                  );
                } else if (line.startsWith('•')) {
                  return (
                    <div key={index} className="flex items-start gap-2 mb-1 ml-3">
                      <span className="text-blue-500 mt-0.5 font-bold">•</span>
                      <span className="text-gray-700 text-sm leading-tight">{line.replace('•', '').trim()}</span>
                    </div>
                  );
                } else if (line.trim()) {
                  return (
                    <p key={index} className="text-gray-700 text-sm mb-2 leading-tight">
                      {line}
                    </p>
                  );
                }
                return null;
              })}
            </div>
          </div>
        </div>

        {/* Right Column - Output Strategy */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 bg-green-600 rounded-lg flex items-center justify-center">
              <Send className="h-3 w-3 text-white" />
            </div>
            <h3 className="font-semibold text-gray-900">Output Strategy</h3>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
              {agent.output_schema?.length || 0} outputs
            </span>
          </div>
          
          <div className="bg-gray-50 rounded-lg p-4">
            {agent.output_schema && agent.output_schema.length > 0 ? (
              <div className="space-y-4">
                {/* Human-facing outputs */}
                {humanFacingOutputs.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <User className="h-4 w-4 text-blue-600" />
                      <span className="text-sm font-medium text-gray-900">
                        For Humans ({humanFacingOutputs.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {humanFacingOutputs.slice(0, 3).map((output, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
                          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <span className="text-blue-600">
                              {getOutputIcon(output.type)}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {output.name}
                            </div>
                            <div className="text-xs text-gray-500">{output.type}</div>
                          </div>
                        </div>
                      ))}
                      {humanFacingOutputs.length > 3 && (
                        <div className="text-xs text-gray-500 text-center py-2">
                          +{humanFacingOutputs.length - 3} more outputs...
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Machine-facing outputs */}
                {machineFacingOutputs.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <Bot className="h-4 w-4 text-purple-600" />
                      <span className="text-sm font-medium text-gray-900">
                        System Actions ({machineFacingOutputs.length})
                      </span>
                    </div>
                    <div className="space-y-2">
                      {machineFacingOutputs.slice(0, 3).map((output, index) => (
                        <div key={index} className="flex items-center gap-3 p-3 bg-white rounded-lg border border-gray-200 shadow-sm">
                          <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                            <span className="text-purple-600">
                              {getOutputIcon(output.type)}
                            </span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium text-gray-900 truncate">
                              {output.name}
                              {output.plugin && (
                                <span className="text-purple-600 text-xs ml-1">
                                  ({output.plugin})
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">{output.type}</div>
                          </div>
                        </div>
                      ))}
                      {machineFacingOutputs.length > 3 && (
                        <div className="text-xs text-gray-500 text-center py-2">
                          +{machineFacingOutputs.length - 3} more actions...
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Output confidence indicator */}
                {agent.extraction_details?.output_inference?.confidence && (
                  <div className="pt-4 border-t border-gray-200">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">Detection Confidence</span>
                      <span className="text-sm font-bold text-green-600">
                        {Math.round(agent.extraction_details.output_inference.confidence * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-green-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${agent.extraction_details.output_inference.confidence * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center text-gray-500 py-12">
                <Send className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">No output strategy defined</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
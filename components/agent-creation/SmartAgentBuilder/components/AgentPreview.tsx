// components/agent-creation/SmartAgentBuilder/components/AgentPreview.tsx

import React, { useState } from 'react';
import { Sparkles, User, Bot, Send, Mail, Bell, FileText, Settings, Heart, CheckCircle, Zap, ChevronDown, ChevronRight } from 'lucide-react';
import { AgentPreviewProps } from '../types/agent';

export default function AgentPreview({
  agent,
  prompt,
  promptType,
  isEditing,
  onUpdate
}: AgentPreviewProps) {
  const [showOriginalRequest, setShowOriginalRequest] = useState(false);

  if (!agent) return null;

  const getOutputIcon = (type: string) => {
    switch (type) {
      case 'EmailDraft': return <Mail className="h-4 w-4" />;
      case 'Alert': return <Bell className="h-4 w-4" />;
      case 'SummaryBlock': return <FileText className="h-4 w-4" />;
      case 'PluginAction': return <Settings className="h-4 w-4" />;
      default: return <Send className="h-4 w-4" />;
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
    <div className="bg-gradient-to-br from-white to-blue-50/30 rounded-xl border border-blue-100/50 p-6 shadow-lg">
      {/* Header Section */}
      <div className="mb-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="w-12 h-12 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg">
            <Sparkles className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1">
            {isEditing ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                    <Heart className="h-4 w-4 text-pink-500" />
                    What should we call your assistant?
                  </label>
                  <input
                    type="text"
                    value={agent.agent_name}
                    onChange={(e) => onUpdate({ agent_name: e.target.value })}
                    className="w-full text-xl font-bold text-gray-900 bg-white/80 border-2 border-blue-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 placeholder-gray-400"
                    placeholder="Give your assistant a friendly name..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-800 mb-2 flex items-center gap-2">
                    <Bot className="h-4 w-4 text-blue-500" />
                    Tell people what your assistant does
                  </label>
                  <textarea
                    value={agent.description}
                    onChange={(e) => onUpdate({ description: e.target.value })}
                    className="w-full text-gray-700 bg-white/80 border-2 border-blue-200 rounded-lg px-4 py-3 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all duration-200 resize-vertical placeholder-gray-400"
                    rows={3}
                    placeholder="Explain how this assistant will help people in simple terms..."
                  />
                </div>
              </div>
            ) : (
              <>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">{agent.agent_name}</h2>
                <p className="text-gray-600 leading-relaxed">{agent.description}</p>
              </>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        <div className="flex items-center gap-4 text-sm text-gray-500">
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            {agent.plugins_required?.length || 0} integrations
          </span>
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            {agent.input_schema?.length || 0} questions
          </span>
          <span className="flex items-center gap-1">
            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
            {agent.output_schema?.length || 0} actions
          </span>
        </div>
      </div>

      {/* Collapsible Original Request */}
      <div className="mb-6">
        <button
          onClick={() => setShowOriginalRequest(!showOriginalRequest)}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
        >
          {showOriginalRequest ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          Show original request
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
            {promptType === 'task' ? '📋 Task' : 
             promptType === 'workflow' ? '🔄 Workflow' : 
             promptType === 'agent' ? '🤖 Assistant' : promptType}
          </span>
        </button>
        
        {showOriginalRequest && (
          <div className="mt-3 bg-gray-50 rounded-lg p-4 border border-gray-200">
            {formatPromptText(prompt).split('\n').map((line, index) => {
              if (line.startsWith('**') && line.endsWith('**')) {
                return (
                  <h4 key={index} className="text-sm font-semibold text-gray-900 mt-3 mb-2 first:mt-0">
                    {line.replace(/\*\*/g, '')}
                  </h4>
                );
              } else if (line.startsWith('•')) {
                return (
                  <div key={index} className="flex items-start gap-2 mb-1 ml-2">
                    <div className="w-1 h-1 bg-gray-400 rounded-full mt-2 flex-shrink-0"></div>
                    <span className="text-gray-700 text-sm">{line.replace('•', '').trim()}</span>
                  </div>
                );
              } else if (line.trim()) {
                return (
                  <p key={index} className="text-gray-700 text-sm mb-2">
                    {line}
                  </p>
                );
              }
              return null;
            })}
          </div>
        )}
      </div>

      {/* Main Content - What It Will Do */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-gradient-to-br from-green-500 to-green-600 rounded-lg flex items-center justify-center">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <h3 className="text-xl font-bold text-gray-900">What Your Assistant Will Do</h3>
        </div>
        
        {agent.output_schema && agent.output_schema.length > 0 ? (
          <div className="space-y-6">
            {/* Human-facing outputs */}
            {humanFacingOutputs.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <User className="h-4 w-4 text-blue-500" />
                  Things you'll see ({humanFacingOutputs.length})
                </h4>
                <div className="space-y-2">
                  {humanFacingOutputs.map((output, index) => (
                    <div key={index} className="flex items-center gap-4 p-4 bg-white rounded-lg border border-gray-200 hover:border-blue-200 transition-colors">
                      <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-blue-600">
                          {getOutputIcon(output.type)}
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{output.name}</div>
                        <div className="text-sm text-gray-500 capitalize">{output.type.replace(/([A-Z])/g, ' $1').trim()}</div>
                      </div>
                      <CheckCircle className="h-5 w-5 text-green-500" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Machine-facing outputs */}
            {machineFacingOutputs.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                  <Settings className="h-4 w-4 text-purple-500" />
                  Behind-the-scenes actions ({machineFacingOutputs.length})
                </h4>
                <div className="space-y-2">
                  {machineFacingOutputs.map((output, index) => (
                    <div key={index} className="flex items-center gap-4 p-4 bg-white rounded-lg border border-gray-200 hover:border-purple-200 transition-colors">
                      <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-purple-600">
                          {getOutputIcon(output.type)}
                        </span>
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">
                          {output.name}
                          {output.plugin && (
                            <span className="text-purple-600 text-sm ml-2 bg-purple-50 px-2 py-1 rounded">
                              via {output.plugin}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-500 capitalize">{output.type.replace(/([A-Z])/g, ' $1').trim()}</div>
                      </div>
                      <Settings className="h-5 w-5 text-purple-500" />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confidence indicator */}
            {agent.extraction_details?.output_inference?.confidence && (
              <div className="bg-green-50 rounded-lg p-4 border border-green-200">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    Confidence Level
                  </span>
                  <span className="text-sm font-bold text-green-600">
                    {Math.round(agent.extraction_details.output_inference.confidence * 100)}% confident
                  </span>
                </div>
                <div className="w-full bg-green-200 rounded-full h-2">
                  <div 
                    className="bg-green-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: `${agent.extraction_details.output_inference.confidence * 100}%` }}
                  />
                </div>
                <p className="text-xs text-green-700 mt-2">
                  The higher the confidence, the better your assistant will work
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-gray-500 py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-xl flex items-center justify-center mx-auto mb-4">
              <Send className="h-8 w-8 opacity-50" />
            </div>
            <p className="font-medium">No actions defined yet</p>
            <p className="text-sm mt-1">Your assistant needs some actions to be helpful</p>
          </div>
        )}
      </div>
    </div>
  );
}
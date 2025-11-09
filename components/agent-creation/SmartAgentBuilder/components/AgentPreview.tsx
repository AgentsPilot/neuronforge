// components/agent-creation/SmartAgentBuilder/components/AgentPreview.tsx

import React, { useState } from 'react';
import { Sparkles, User, Bot, Mail, FileText, Settings, CheckCircle, Zap, ChevronDown, Play, Clock, Target, TrendingUp, Bell, List, MessageSquare, Database, FileBarChart } from 'lucide-react';
import { AgentPreviewProps } from '../types/agent';

export default function AgentPreview({
  agent,
  prompt,
  promptType,
  isEditing,
  onUpdate
}: AgentPreviewProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  if (!agent) return null;

  const getPluginIcon = (plugin: string | undefined) => {
    if (!plugin) return <Settings className="h-3.5 w-3.5" />;
    if (plugin.includes('mail')) return <Mail className="h-3.5 w-3.5" />;
    if (plugin.includes('drive') || plugin.includes('file')) return <FileText className="h-3.5 w-3.5" />;
    if (plugin.includes('chat') || plugin.includes('ai')) return <Bot className="h-3.5 w-3.5" />;
    return <Settings className="h-3.5 w-3.5" />;
  };

  const formatSchedule = (cron: string) => {
    const parts = cron.split(' ');
    
    if (parts.length >= 5) {
      const min = parts[0];
      const hr = parts[1];
      const dayOfMonth = parts[2];
      const month = parts[3];
      const dayOfWeek = parts[4];
      
      // Only format if we have specific minute and hour (not wildcards)
      if (min !== '*' && hr !== '*') {
        const minute = parseInt(min);
        const hour = parseInt(hr);
        
        // Format time in 12-hour format
        let timeStr;
        if (hour === 0) {
          timeStr = `12:${minute.toString().padStart(2, '0')} AM`;
        } else if (hour < 12) {
          timeStr = `${hour}:${minute.toString().padStart(2, '0')} AM`;
        } else if (hour === 12) {
          timeStr = `12:${minute.toString().padStart(2, '0')} PM`;
        } else {
          timeStr = `${hour - 12}:${minute.toString().padStart(2, '0')} PM`;
        }
        
        // Add frequency/day information
        if (dayOfWeek !== '*') {
          // Specific day of week
          const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
          const dayName = days[parseInt(dayOfWeek)] || days[parseInt(dayOfWeek) === 7 ? 0 : parseInt(dayOfWeek)];
          return `${dayName} ${timeStr}`;
        } else if (dayOfMonth !== '*') {
          // Specific day of month
          return `${dayOfMonth}th ${timeStr}`;
        } else if (month !== '*') {
          // Monthly
          return `Monthly ${timeStr}`;
        } else {
          // Daily
          return `Daily ${timeStr}`;
        }
      }
    }
    
    // Fallback to showing the raw cron if we can't parse it
    return cron;
  };

  // Define the missing variables
  const steps = agent.workflow_steps || [];
  const humanOutputs = [...(agent.output_schema?.filter(o => !o.category || o.category === 'human-facing') || [])];
  const systemOutputs = [...(agent.output_schema?.filter(o => o.category === 'machine-facing') || [])];

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

  return (
    <div className="relative space-y-5">
          {/* Header with Avatar */}
          <div className="flex items-start gap-4">
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg">
                <Sparkles className="h-7 w-7 text-white" />
              </div>
              {agent.ai_confidence && (
                <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white shadow-md">
                  {agent.ai_confidence}
                </div>
              )}
            </div>
            
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={agent.agent_name}
                    onChange={(e) => onUpdate({ agent_name: e.target.value })}
                    className="w-full text-xl font-bold bg-white/50 backdrop-blur border-0 border-b-2 border-gray-200 focus:border-blue-500 outline-none px-0 py-1 transition-colors"
                  />
                  <textarea
                    value={agent.description}
                    onChange={(e) => onUpdate({ description: e.target.value })}
                    className="w-full text-sm bg-white/50 backdrop-blur rounded-lg border border-gray-200 focus:border-blue-500 outline-none px-3 py-2 resize-none transition-colors"
                    rows={2}
                  />
                </div>
              ) : (
                <>
                  <h3 className="text-xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent mb-2">
                    {agent.agent_name}
                  </h3>
                  <p className="text-sm text-gray-600 leading-relaxed">{agent.description}</p>
                </>
              )}
            </div>
          </div>

          {/* Stats Pills */}
          <div className="flex flex-wrap gap-2">
            <div className="px-3 py-1.5 bg-gradient-to-br from-blue-50 to-blue-100 rounded-full flex items-center gap-2 border border-blue-200/50">
              <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              <span className="text-xs font-semibold text-blue-700">{agent.plugins_required?.length || 0} Plugins/services</span>
            </div>
            <div className="px-3 py-1.5 bg-gradient-to-br from-purple-50 to-purple-100 rounded-full flex items-center gap-2 border border-purple-200/50">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              <span className="text-xs font-semibold text-purple-700">{steps.length} Steps</span>
            </div>
            <div className="px-3 py-1.5 bg-gradient-to-br from-green-50 to-green-100 rounded-full flex items-center gap-2 border border-green-200/50">
              <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
              <span className="text-xs font-semibold text-green-700">{humanOutputs.length + systemOutputs.length} Outputs</span>
            </div>
            {agent.schedule_cron && (
              <div className="px-3 py-1.5 bg-gradient-to-br from-orange-50 to-orange-100 rounded-full flex items-center gap-2 border border-orange-200/50">
                <Clock className="h-3 w-3 text-orange-600" />
                <span className="text-xs font-semibold text-orange-700">{formatSchedule(agent.schedule_cron)}</span>
              </div>
            )}
          </div>

          {/* Enhanced Prompt Section - Moved to Top */}
          {prompt && (
            <div className="space-y-3">
              <button
                onClick={() => setExpandedSection(expandedSection === 'prompt' ? null : 'prompt')}
                className="w-full flex items-center justify-between p-3 bg-gradient-to-r from-violet-50 to-purple-50 rounded-xl hover:from-violet-100 hover:to-purple-100 transition-all duration-200 group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-violet-500 to-purple-600 rounded-lg flex items-center justify-center">
                    <FileText className="h-4 w-4 text-white" />
                  </div>
                  <span className="font-semibold text-gray-900">Original Request</span>
                  <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">
                    {promptType === 'enhanced' ? '✨ Enhanced' : '📋 Original'}
                  </span>
                </div>
                <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${expandedSection === 'prompt' ? 'rotate-180' : ''}`} />
              </button>

              {expandedSection === 'prompt' && (
                <div className="p-4 animate-in slide-in-from-top-2 duration-200">
                  <div className="prose prose-sm max-w-none text-gray-700">
                    {formatPromptText(prompt).split('\n').map((line, index) => {
                      if (line.startsWith('**') && line.endsWith('**')) {
                        return (
                          <h4 key={index} className="text-sm font-semibold text-gray-900 mt-3 mb-2 first:mt-0">
                            {line.replace(/\*\*/g, '')}
                          </h4>
                        );
                      } else if (line.startsWith('•')) {
                        return (
                          <div key={index} className="flex items-start gap-2 mb-1.5 ml-2">
                            <div className="w-1 h-1 bg-violet-400 rounded-full mt-2 flex-shrink-0"></div>
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
                </div>
              )}
            </div>
          )}

          {/* Workflow Visualization */}
          {steps.length > 0 && (
            <div className="space-y-3">
              <button
                onClick={() => setExpandedSection(expandedSection === 'workflow' ? null : 'workflow')}
                className="w-full flex items-center justify-between p-3 bg-gradient-to-r from-orange-50 to-pink-50 rounded-xl hover:from-orange-100 hover:to-pink-100 transition-all duration-200 group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-orange-400 to-pink-500 rounded-lg flex items-center justify-center">
                    <Play className="h-4 w-4 text-white" />
                  </div>
                  <span className="font-semibold text-gray-900">Workflow Steps</span>
                </div>
                <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${expandedSection === 'workflow' ? 'rotate-180' : ''}`} />
              </button>

              {expandedSection === 'workflow' && (
                <div className="relative animate-in slide-in-from-top-2 duration-200">
                  {/* Vertical Flow Line */}
                  <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gradient-to-b from-orange-200 via-pink-200 to-purple-200" />

                  <div className="space-y-3">
                    {steps.map((step, idx) => (
                      <div key={idx} className="relative flex items-start gap-4 group">
                        {/* Step Number Badge with glow effect */}
                        <div className="relative flex-shrink-0 z-10">
                          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-400 to-pink-500 flex items-center justify-center text-white text-sm font-bold shadow-lg ring-4 ring-white">
                            {idx + 1}
                          </div>
                          {step.validated && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-green-500 rounded-full flex items-center justify-center shadow-sm border-2 border-white">
                              <CheckCircle className="h-3 w-3 text-white fill-current" />
                            </div>
                          )}
                        </div>

                        {/* Flow Card */}
                        <div className="flex-1 min-w-0">
                          <div className="relative p-4 bg-white/90 backdrop-blur rounded-xl border border-gray-200/50 shadow-sm group-hover:shadow-md group-hover:border-orange-300 transition-all duration-200">
                            {/* Arrow pointer to step number */}
                            <div className="absolute left-0 top-5 -ml-2 w-0 h-0 border-t-[6px] border-t-transparent border-b-[6px] border-b-transparent border-r-[8px] border-r-white/90" />

                            <div className="space-y-3">
                              {/* Step Label and Main Action */}
                              <div>
                                <div className="text-xs font-medium text-orange-600 mb-1">Step {idx + 1}</div>
                                <div className="text-sm font-semibold text-gray-900 leading-snug">
                                  {step.action || step.operation}
                                </div>
                              </div>

                              {/* Plugin and Action in flow format */}
                              <div className="flex items-center gap-2 flex-wrap">
                                {step.plugin && step.plugin_action ? (
                                  <>
                                    {/* Plugin Badge */}
                                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-orange-50 to-pink-50 rounded-lg border border-orange-200/50 shadow-sm">
                                      {getPluginIcon(step.plugin)}
                                      <span className="text-xs font-medium text-gray-700">{step.plugin}</span>
                                    </div>

                                    {/* Flow Arrow */}
                                    <div className="flex items-center gap-1 text-gray-400">
                                      <div className="w-6 h-[1px] bg-gray-300" />
                                      <div className="w-0 h-0 border-t-[4px] border-t-transparent border-b-[4px] border-b-transparent border-l-[6px] border-l-gray-300" />
                                    </div>

                                    {/* Action Badge */}
                                    <div className="px-3 py-1.5 bg-gray-50 rounded-lg border border-gray-200">
                                      <span className="text-xs text-gray-700 font-medium">{step.plugin_action}</span>
                                    </div>
                                  </>
                                ) : (
                                  /* Conditional/AI Processing Step */
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-purple-50 to-purple-100 rounded-lg border border-purple-200/50 shadow-sm">
                                    <Bot className="h-3.5 w-3.5 text-purple-600" />
                                    <span className="text-xs font-medium text-purple-700">
                                      {step.operation && (step.operation.toLowerCase().includes('determine') || step.operation.toLowerCase().includes('decide') || step.operation.toLowerCase().includes('check if'))
                                        ? 'Condition'
                                        : 'AI Processing'}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Outputs - Combined */}
          {(humanOutputs.length > 0 || systemOutputs.length > 0) && (
            <div className="space-y-3">
              <button
                onClick={() => setExpandedSection(expandedSection === 'outputs' ? null : 'outputs')}
                className="w-full flex items-center justify-between p-3 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl hover:from-blue-100 hover:to-indigo-100 transition-all duration-200 group"
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                    <Target className="h-4 w-4 text-white" />
                  </div>
                  <span className="font-semibold text-gray-900">What You'll Get</span>
                </div>
                <ChevronDown className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${expandedSection === 'outputs' ? 'rotate-180' : ''}`} />
              </button>

              {expandedSection === 'outputs' && (
                <div className="p-3 space-y-4 animate-in slide-in-from-top-2 duration-200">
                  {/* Human Outputs */}
                  {humanOutputs.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-emerald-700 mb-2 flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5" />
                        Human-Facing Outputs
                      </div>
                      <div className="space-y-2">
                        {humanOutputs.map((output, idx) => {
                          // Convert technical types to user-friendly labels with Lucide icons
                          const getUserFriendlyType = (type: string) => {
                            const typeMap: Record<string, { label: string; Icon: any; iconColor: string; bgColor: string; badgeColor: string }> = {
                              'EmailDraft': { label: 'Email', Icon: Mail, iconColor: 'text-blue-600', bgColor: 'bg-blue-100', badgeColor: 'bg-blue-100 text-blue-700' },
                              'PluginAction': { label: 'Action', Icon: Zap, iconColor: 'text-purple-600', bgColor: 'bg-purple-100', badgeColor: 'bg-purple-100 text-purple-700' },
                              'SummaryBlock': { label: 'Report', Icon: FileBarChart, iconColor: 'text-green-600', bgColor: 'bg-green-100', badgeColor: 'bg-green-100 text-green-700' },
                              'Alert': { label: 'Notification', Icon: Bell, iconColor: 'text-orange-600', bgColor: 'bg-orange-100', badgeColor: 'bg-orange-100 text-orange-700' },
                              'string': { label: 'Text', Icon: MessageSquare, iconColor: 'text-cyan-600', bgColor: 'bg-cyan-100', badgeColor: 'bg-cyan-100 text-cyan-700' },
                              'object': { label: 'Data', Icon: Database, iconColor: 'text-indigo-600', bgColor: 'bg-indigo-100', badgeColor: 'bg-indigo-100 text-indigo-700' },
                              'array': { label: 'List', Icon: List, iconColor: 'text-teal-600', bgColor: 'bg-teal-100', badgeColor: 'bg-teal-100 text-teal-700' }
                            };
                            return typeMap[type] || { label: 'Result', Icon: Sparkles, iconColor: 'text-amber-600', bgColor: 'bg-amber-100', badgeColor: 'bg-amber-100 text-amber-700' };
                          };

                          const typeInfo = getUserFriendlyType(output.type);
                          const IconComponent = typeInfo.Icon;

                          return (
                            <div key={idx} className="flex items-center gap-3 p-3 bg-white/80 backdrop-blur rounded-xl border border-gray-200/50 hover:border-blue-300 hover:shadow-md transition-all duration-200">
                              <div className={`w-8 h-8 ${typeInfo.bgColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
                                <IconComponent className={`h-4 w-4 ${typeInfo.iconColor}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900">{output.name}</div>
                                {output.description && (
                                  <div className="text-xs text-gray-500">{output.description}</div>
                                )}
                              </div>
                              <div className={`px-2 py-1 rounded-md ${typeInfo.badgeColor}`}>
                                <span className="text-xs font-medium">{typeInfo.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* System Outputs */}
                  {systemOutputs.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                        <Settings className="h-3.5 w-3.5" />
                        System Outputs
                      </div>
                      <div className="space-y-2">
                        {systemOutputs.map((output, idx) => {
                          // Convert technical types to user-friendly labels with Lucide icons
                          const getUserFriendlyType = (type: string) => {
                            const typeMap: Record<string, { label: string; Icon: any; iconColor: string; bgColor: string; badgeColor: string }> = {
                              'EmailDraft': { label: 'Email', Icon: Mail, iconColor: 'text-blue-600', bgColor: 'bg-blue-100', badgeColor: 'bg-blue-100 text-blue-700' },
                              'PluginAction': { label: 'Action', Icon: Zap, iconColor: 'text-purple-600', bgColor: 'bg-purple-100', badgeColor: 'bg-purple-100 text-purple-700' },
                              'SummaryBlock': { label: 'Report', Icon: FileBarChart, iconColor: 'text-green-600', bgColor: 'bg-green-100', badgeColor: 'bg-green-100 text-green-700' },
                              'Alert': { label: 'Notification', Icon: Bell, iconColor: 'text-orange-600', bgColor: 'bg-orange-100', badgeColor: 'bg-orange-100 text-orange-700' },
                              'string': { label: 'Text', Icon: MessageSquare, iconColor: 'text-cyan-600', bgColor: 'bg-cyan-100', badgeColor: 'bg-cyan-100 text-cyan-700' },
                              'object': { label: 'Data', Icon: Database, iconColor: 'text-indigo-600', bgColor: 'bg-indigo-100', badgeColor: 'bg-indigo-100 text-indigo-700' },
                              'array': { label: 'List', Icon: List, iconColor: 'text-teal-600', bgColor: 'bg-teal-100', badgeColor: 'bg-teal-100 text-teal-700' }
                            };
                            return typeMap[type] || { label: 'Result', Icon: Sparkles, iconColor: 'text-amber-600', bgColor: 'bg-amber-100', badgeColor: 'bg-amber-100 text-amber-700' };
                          };

                          const typeInfo = getUserFriendlyType(output.type);
                          const IconComponent = typeInfo.Icon;

                          return (
                            <div key={idx} className="flex items-center gap-3 p-3 bg-white/80 backdrop-blur rounded-xl border border-gray-200/50 hover:border-slate-300 hover:shadow-md transition-all duration-200">
                              <div className={`w-8 h-8 ${typeInfo.bgColor} rounded-lg flex items-center justify-center flex-shrink-0`}>
                                <IconComponent className={`h-4 w-4 ${typeInfo.iconColor}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-medium text-gray-900">{output.name}</div>
                                {output.description && (
                                  <div className="text-xs text-gray-500">{output.description}</div>
                                )}
                              </div>
                              <div className={`px-2 py-1 rounded-md ${typeInfo.badgeColor}`}>
                                <span className="text-xs font-medium">{typeInfo.label}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* AI Insight */}
          {agent.ai_reasoning && (
            <div className="p-3 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-200/50">
              <div className="flex items-start gap-2">
                <TrendingUp className="h-4 w-4 text-green-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <div className="text-xs font-semibold text-green-700 mb-1">AI Analysis</div>
                  <p className="text-xs text-green-600 leading-relaxed">{agent.ai_reasoning}</p>
                </div>
              </div>
            </div>
          )}
    </div>
  );
}
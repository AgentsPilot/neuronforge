import React, { useState, useEffect } from 'react';
import { 
  Brain, 
  Loader2,
  Settings,
  Zap,
  Edit,
  Database,
  MessageSquare,
  Send,
  FileText,
  Users,
  Mail,
  Calendar,
  Globe,
  Code,
  Filter,
  BarChart3,
  Shield,
  Network,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Code2,
  Lock,
  HelpCircle,
  CheckCircle2,
  Eye
} from 'lucide-react';

// Import types
import { Agent } from './types/agent';

// LockedSystemPrompts Component
export const LockedSystemPrompts = ({ 
  systemPrompt, 
  userPrompt, 
  originalPrompts 
}: {
  systemPrompt: string;
  userPrompt: string;
  originalPrompts: any;
}) => {
  return (
    <div className="space-y-4">
      {/* Lock Explanation */}
      <div className="bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-1">
            <Shield className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-amber-800 mb-2 flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Why are prompts locked?
            </h4>
            <p className="text-amber-700 text-sm leading-relaxed">
              The AI carefully crafted these prompts to ensure your agent works correctly. 
              Modifying them could break the agent's behavior and functionality. Other agent settings can still be edited freely.
            </p>
          </div>
        </div>
      </div>

      {/* Prompts Display - Read Only */}
      <div className="space-y-4">
        {/* User Prompt Section */}
        <div className="bg-gray-50/80 border border-gray-200 rounded-xl p-4 relative">
          <div className="absolute top-3 right-3">
            <div className="bg-amber-100 text-amber-700 p-1 rounded-full">
              <Lock className="h-3 w-3" />
            </div>
          </div>
          
          <div className="pr-8">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="h-5 w-5 text-blue-600" />
              <h5 className="font-medium text-gray-800">Original User Prompt</h5>
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                <CheckCircle2 className="h-3 w-3" />
                Source
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full">
                <Lock className="h-3 w-3" />
                Protected
              </span>
            </div>
            <div className="bg-white/80 border border-gray-200 rounded-lg p-4 max-h-32 overflow-y-auto">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {userPrompt || 'No user prompt available'}
              </p>
            </div>
          </div>
        </div>

        {/* System Prompt Section */}
        <div className="bg-gray-50/80 border border-gray-200 rounded-xl p-4 relative">
          <div className="absolute top-3 right-3">
            <div className="bg-amber-100 text-amber-700 p-1 rounded-full">
              <Lock className="h-3 w-3" />
            </div>
          </div>
          
          <div className="pr-8">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="h-5 w-5 text-emerald-600" />
              <h5 className="font-medium text-gray-800">AI-Generated System Prompt</h5>
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-100 text-emerald-700 text-xs rounded-full">
                <CheckCircle2 className="h-3 w-3" />
                AI Optimized
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full">
                <Lock className="h-3 w-3" />
                Protected
              </span>
            </div>
            <div className="bg-white/80 border border-gray-200 rounded-lg p-4 max-h-40 overflow-y-auto">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                {systemPrompt || 'No system prompt available'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <HelpCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h5 className="font-medium text-blue-800 mb-1">Need different behavior?</h5>
            <p className="text-blue-700 text-sm">
              If you need your agent to behave differently, consider creating a new agent with a modified 
              original prompt that better describes your desired functionality.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export const LockedPluginRequirements = ({ 
  pluginsRequired, 
  originalPlugins, 
  onViewDetails 
}: {
  pluginsRequired: any[];
  originalPlugins: any[];
  onViewDetails?: () => void;
}) => {
  return (
    <div className="space-y-4">
      {/* Lock Explanation */}
      <div className="bg-gradient-to-r from-amber-50 via-yellow-50 to-orange-50 border border-amber-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 mt-1">
            <Shield className="h-5 w-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <h4 className="font-medium text-amber-800 mb-2 flex items-center gap-2">
              <Lock className="h-4 w-4" />
              Why are plugins locked?
            </h4>
            <p className="text-amber-700 text-sm leading-relaxed">
              The AI determined these specific plugins are essential for your agent's functionality. 
              Modifying them could break the agent's workflow. You can edit other agent settings freely.
            </p>
          </div>
        </div>
      </div>

      {/* Plugin List - Read Only */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-gray-800">Required Plugins</h4>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
            {pluginsRequired.length} plugin{pluginsRequired.length !== 1 ? 's' : ''}
          </span>
        </div>
        
        <div className="grid gap-3">
          {pluginsRequired.map((plugin, index) => {
            const pluginName = typeof plugin === 'string' ? plugin : plugin.name || plugin.key || 'Unknown Plugin';
            const pluginDescription = typeof plugin === 'object' ? plugin.description : null;
            
            return (
              <div 
                key={index}
                className="bg-gray-50/80 border border-gray-200 rounded-xl p-4 relative overflow-hidden"
              >
                {/* Lock Overlay */}
                <div className="absolute top-2 right-2">
                  <div className="bg-amber-100 text-amber-700 p-1 rounded-full">
                    <Lock className="h-3 w-3" />
                  </div>
                </div>
                
                <div className="flex items-start gap-3 pr-8">
                  <div className="flex-shrink-0 mt-1">
                    <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg flex items-center justify-center">
                      <Zap className="h-4 w-4 text-white" />
                    </div>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h5 className="font-medium text-gray-800 mb-1">{pluginName}</h5>
                    {pluginDescription && (
                      <p className="text-sm text-gray-600 leading-relaxed">
                        {pluginDescription}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 text-xs rounded-full">
                        <CheckCircle2 className="h-3 w-3" />
                        Required
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full">
                        <Lock className="h-3 w-3" />
                        Protected
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Help Section */}
      <div className="bg-blue-50/50 border border-blue-200 rounded-xl p-4">
        <div className="flex items-start gap-3">
          <HelpCircle className="h-5 w-5 text-blue-600 mt-0.5 flex-shrink-0" />
          <div>
            <h5 className="font-medium text-blue-800 mb-1">Need different plugins?</h5>
            <p className="text-blue-700 text-sm">
              If you need to use different plugins, consider creating a new agent with a modified prompt 
              that specifies your preferred tools.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Debug Panel Component
export const DebugPanel = ({ 
  agent, 
  prompt, 
  promptType, 
  clarificationAnswers, 
  isEditing, 
  editedAgent, 
  sessionId, 
  agentId, 
  editMode, 
  pluginsLocked, 
  originalPlugins, 
  promptsLocked, 
  originalPrompts 
}: {
  agent: Agent | null;
  prompt: string;
  promptType: string;
  clarificationAnswers: any;
  isEditing: boolean;
  editedAgent: Agent | null;
  sessionId: string;
  agentId: string;
  editMode: boolean;
  pluginsLocked: boolean;
  originalPlugins: any[];
  promptsLocked: boolean;
  originalPrompts: any;
}) => {
  const [showDebug, setShowDebug] = useState(false);
  const [activeTab, setActiveTab] = useState('agent');

  const debugData = {
    agent: agent,
    editedAgent: editedAgent,
    prompt: prompt,
    promptType: promptType,
    clarificationAnswers: clarificationAnswers,
    sessionId: sessionId,
    agentId: agentId,
    isEditing: isEditing,
    editMode: editMode,
    pluginsLocked: pluginsLocked,
    originalPlugins: originalPlugins,
    promptsLocked: promptsLocked,
    originalPrompts: originalPrompts,
    currentAgent: isEditing ? editedAgent : agent
  };

  const tabs = [
    { id: 'agent', label: 'Agent Data', icon: Brain },
    { id: 'config', label: 'Agent Config', icon: Database },
    { id: 'input', label: 'Input Schema', icon: Settings },
    { id: 'output', label: 'Output Schema', icon: Send },
    { id: 'plugins', label: 'Plugins', icon: Zap },
    { id: 'prompts', label: 'Prompts', icon: MessageSquare },
    { id: 'full', label: 'Full JSON', icon: Code2 }
  ];

  return (
    <div className="bg-gray-900/95 backdrop-blur-xl rounded-3xl shadow-2xl border border-gray-700/50 overflow-hidden">
      <div className="p-4 border-b border-gray-700/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center">
              <Code className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Debug Panel</h3>
              <p className="text-xs text-gray-400">
                Real-time data inspection 
                {editMode && <span className="text-yellow-400"> (Edit Mode)</span>}
                {pluginsLocked && <span className="text-amber-400"> (Plugins Locked)</span>}
                {promptsLocked && <span className="text-orange-400"> (Prompts Locked)</span>}
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowDebug(!showDebug)}
            className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800"
          >
            {showDebug ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {showDebug && (
        <div className="p-4">
          {/* Tab Navigation */}
          <div className="flex flex-wrap gap-2 mb-4 border-b border-gray-700/50 pb-4">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`
                    px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-all
                    ${activeTab === tab.id 
                      ? 'bg-blue-600 text-white' 
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    }
                  `}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Tab Content */}
          <div className="max-h-96 overflow-auto">
            {activeTab === 'agent' && (
              <div className="space-y-4">
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <h4 className="text-white font-medium mb-2 flex items-center gap-2">
                    <Database className="h-4 w-4 text-blue-400" />
                    Agent Structure (Database Fields)
                  </h4>
                  <pre className="text-xs text-green-400 whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify({
                      id: agent?.id || 'NOT_SAVED_YET',
                      user_id: agent?.user_id || 'USER_ID',
                      agent_name: agent?.agent_name || 'N/A',
                      description: agent?.description || 'N/A',
                      status: agent?.status || 'draft',
                      mode: agent?.mode || 'on_demand',
                      plugins_required: agent?.plugins_required || [],
                      input_schema: agent?.input_schema || [],
                      output_schema: agent?.output_schema || [],
                      workflow_steps: agent?.workflow_steps || [],
                      system_prompt: (agent?.system_prompt || '').substring(0, 100) + '...',
                      user_prompt: (agent?.user_prompt || '').substring(0, 100) + '...',
                      created_at: agent?.created_at || 'NOT_CREATED',
                      updated_at: agent?.updated_at || 'NOT_UPDATED',
                      _sessionId: sessionId,
                      _agentId: agentId,
                      _pluginsLocked: pluginsLocked || false,
                      _originalPlugins: originalPlugins || [],
                      _promptsLocked: promptsLocked || false
                    }, null, 2)}
                  </pre>
                </div>
                
                {isEditing && editedAgent && (
                  <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-4">
                    <h4 className="text-yellow-400 font-medium mb-2 flex items-center gap-2">
                      <Edit className="h-4 w-4" />
                      Edited Agent (Unsaved Changes)
                    </h4>
                    <pre className="text-xs text-yellow-300 whitespace-pre-wrap overflow-x-auto">
                      {JSON.stringify(editedAgent, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'plugins' && (
              <div className="space-y-4">
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <h4 className="text-white font-medium mb-2 flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-400" />
                    Required Plugins
                    {pluginsLocked && (
                      <span className="text-amber-400 text-xs bg-amber-900/30 px-2 py-1 rounded-full flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        LOCKED
                      </span>
                    )}
                  </h4>
                  <pre className="text-xs text-purple-400 whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(agent?.plugins_required || [], null, 2)}
                  </pre>

                  {pluginsLocked && originalPlugins && (
                    <div className="mt-4 pt-4 border-t border-gray-700">
                      <h5 className="text-amber-400 font-medium mb-2">Original Plugins (Protected)</h5>
                      <pre className="text-xs text-amber-300 whitespace-pre-wrap overflow-x-auto">
                        {JSON.stringify(originalPlugins, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'output' && (
              <div className="space-y-4">
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <h4 className="text-white font-medium mb-2 flex items-center gap-2">
                    <Send className="h-4 w-4 text-pink-400" />
                    Output Schema (from AgentKit SDK)
                  </h4>
                  <div className="mb-3 bg-blue-900/30 border border-blue-600/30 rounded-lg p-3">
                    <p className="text-xs text-blue-300">
                      This schema defines how the agent delivers results. The <code className="bg-blue-800/50 px-1 rounded">format</code> field (table, list, markdown, etc.) is detected from your prompt and controls output formatting.
                    </p>
                  </div>
                  <pre className="text-xs text-pink-400 whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(agent?.output_schema || [], null, 2)}
                  </pre>

                  {agent?.output_schema && agent.output_schema.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-700">
                      <h5 className="text-green-400 font-medium mb-2 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" />
                        Output Breakdown
                      </h5>
                      <div className="space-y-2">
                        {agent.output_schema.map((output: any, idx: number) => (
                          <div key={idx} className="bg-gray-900/50 rounded-lg p-3 border border-gray-700/50">
                            <div className="flex items-start justify-between mb-2">
                              <span className="text-white font-medium">{output.name}</span>
                              <span className={`text-xs px-2 py-1 rounded-full ${
                                output.type === 'EmailDraft' ? 'bg-blue-900/50 text-blue-300' :
                                output.type === 'SummaryBlock' ? 'bg-green-900/50 text-green-300' :
                                output.type === 'PluginAction' ? 'bg-purple-900/50 text-purple-300' :
                                output.type === 'Alert' ? 'bg-orange-900/50 text-orange-300' :
                                'bg-gray-700 text-gray-300'
                              }`}>
                                {output.type}
                              </span>
                            </div>
                            {output.format && (
                              <div className="mb-2">
                                <span className="text-xs text-cyan-400 bg-cyan-900/30 px-2 py-1 rounded">
                                  Format: {output.format}
                                </span>
                              </div>
                            )}
                            <p className="text-xs text-gray-400">{output.description}</p>
                            {output.plugin && (
                              <div className="mt-2">
                                <span className="text-xs text-purple-400">Plugin: {output.plugin}</span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'prompts' && (
              <div className="space-y-4">
                <div className="bg-gray-800/50 rounded-lg p-4">
                  <h4 className="text-white font-medium mb-2 flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-green-400" />
                    System and User Prompts
                    {promptsLocked && (
                      <span className="text-orange-400 text-xs bg-orange-900/30 px-2 py-1 rounded-full flex items-center gap-1">
                        <Lock className="h-3 w-3" />
                        LOCKED
                      </span>
                    )}
                  </h4>
                  <div className="space-y-3">
                    <div>
                      <h5 className="text-blue-400 font-medium mb-1">User Prompt:</h5>
                      <div className="bg-gray-900/50 rounded p-2 max-h-32 overflow-y-auto">
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap">
                          {agent?.user_prompt || 'No user prompt'}
                        </pre>
                      </div>
                    </div>
                    <div>
                      <h5 className="text-green-400 font-medium mb-1">System Prompt:</h5>
                      <div className="bg-gray-900/50 rounded p-2 max-h-32 overflow-y-auto">
                        <pre className="text-xs text-gray-300 whitespace-pre-wrap">
                          {agent?.system_prompt || 'No system prompt'}
                        </pre>
                      </div>
                    </div>
                  </div>
                  
                  {promptsLocked && originalPrompts && (
                    <div className="mt-4 pt-4 border-t border-gray-700">
                      <h5 className="text-orange-400 font-medium mb-2">Original Prompts (Protected)</h5>
                      <pre className="text-xs text-orange-300 whitespace-pre-wrap overflow-x-auto">
                        {JSON.stringify(originalPrompts, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'full' && (
              <div className="bg-gray-800/50 rounded-lg p-4">
                <h4 className="text-white font-medium mb-2 flex items-center gap-2">
                  <Code2 className="h-4 w-4 text-cyan-400" />
                  Complete Debug Data
                </h4>
                <pre className="text-xs text-cyan-400 whitespace-pre-wrap overflow-x-auto">
                  {JSON.stringify(debugData, null, 2)}
                </pre>
              </div>
            )}
          </div>

          {/* Quick Stats */}
          <div className="mt-4 pt-4 border-t border-gray-700/50">
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4 text-xs">
              <div className="bg-gray-800/30 rounded-lg p-3 text-center">
                <div className="text-cyan-400 font-medium">{agent?.input_schema?.length || 0}</div>
                <div className="text-gray-400">Input Fields</div>
              </div>
              <div className="bg-gray-800/30 rounded-lg p-3 text-center">
                <div className="text-purple-400 font-medium">{agent?.plugins_required?.length || 0}</div>
                <div className="text-gray-400">Plugins</div>
              </div>
              <div className="bg-gray-800/30 rounded-lg p-3 text-center">
                <div className="text-pink-400 font-medium">{agent?.output_schema?.length || 0}</div>
                <div className="text-gray-400">Outputs</div>
              </div>
              <div className="bg-gray-800/30 rounded-lg p-3 text-center">
                <div className={`font-medium ${agent?.id ? 'text-green-400' : 'text-yellow-400'}`}>
                  {agent?.id ? 'SAVED' : editMode ? 'EDITING' : 'DRAFT'}
                </div>
                <div className="text-gray-400">Status</div>
              </div>
              <div className="bg-gray-800/30 rounded-lg p-3 text-center">
                <div className={`font-medium ${pluginsLocked ? 'text-amber-400' : 'text-gray-400'}`}>
                  {pluginsLocked ? 'LOCKED' : 'UNLOCKED'}
                </div>
                <div className="text-gray-400">Plugins</div>
              </div>
              <div className="bg-gray-800/30 rounded-lg p-3 text-center">
                <div className={`font-medium ${promptsLocked ? 'text-orange-400' : 'text-gray-400'}`}>
                  {promptsLocked ? 'LOCKED' : 'UNLOCKED'}
                </div>
                <div className="text-gray-400">Prompts</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Enhanced Collapsible Section Component
export const CollapsibleSection = ({ 
  title, 
  description, 
  icon: Icon, 
  gradient, 
  children, 
  defaultExpanded = false,
  isEditing = false,
  headerExtra = null
}: {
  title: string;
  description: string;
  icon: any;
  gradient: string;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  isEditing?: boolean;
  headerExtra?: React.ReactNode;
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || isEditing);

  // Auto-expand when editing
  useEffect(() => {
    if (isEditing) {
      setIsExpanded(true);
    }
  }, [isEditing]);

  return (
    <div className="bg-white/70 backdrop-blur-xl rounded-3xl shadow-xl border border-white/20 overflow-hidden">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-6 flex items-center justify-between hover:bg-white/30 transition-all duration-200 group"
      >
        <div className="flex items-center gap-4">
          <div className={`w-10 h-10 ${gradient} rounded-xl flex items-center justify-center group-hover:scale-105 transition-transform duration-200`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
          <div className="text-left">
            <h3 className="text-lg font-semibold text-gray-800 group-hover:text-gray-900 flex items-center gap-2">
              {title}
              {headerExtra}
            </h3>
            <p className="text-sm text-gray-500">{description}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {isEditing && !headerExtra && (
            <span className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-full font-medium">
              Editable
            </span>
          )}
          <div className="flex items-center gap-1 text-gray-400">
            {isExpanded ? (
              <>
                <EyeOff className="h-4 w-4" />
                <ChevronDown className="h-5 w-5 group-hover:text-gray-600 transition-colors" />
              </>
            ) : (
              <>
                <Eye className="h-4 w-4" />
                <ChevronRight className="h-5 w-5 group-hover:text-gray-600 transition-colors" />
              </>
            )}
          </div>
        </div>
      </button>
      
      {isExpanded && (
        <div className="border-t border-gray-100/50 p-8 pt-6 animate-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </div>
  );
};

// Technical Details Toggle Component
export const TechnicalDetailsToggle = ({ 
  showTechnical, 
  onToggle, 
  isEditing 
}: {
  showTechnical: boolean;
  onToggle: () => void;
  isEditing: boolean;
}) => {
  return (
    <div className="flex items-center justify-center mb-8">
      <button
        onClick={onToggle}
        className={`
          px-6 py-3 rounded-2xl font-medium transition-all duration-200 
          flex items-center gap-3 shadow-lg transform hover:scale-[1.02]
          ${showTechnical 
            ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white' 
            : 'bg-white/90 text-gray-700 border border-gray-200 hover:bg-white'
          }
        `}
      >
        <Code2 className="h-5 w-5" />
        {showTechnical ? 'Hide Technical Details' : 'Show Technical Details'}
        {isEditing && (
          <span className="text-xs px-2 py-1 bg-white/20 rounded-full">
            Edit Mode
          </span>
        )}
      </button>
    </div>
  );
};
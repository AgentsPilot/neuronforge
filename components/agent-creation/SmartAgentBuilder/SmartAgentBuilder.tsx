import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/UserProvider';
import { 
  Brain, 
  Loader2, 
  AlertTriangle, 
  RefreshCw,
  ArrowLeft,
  Sparkles,
  CheckCircle,
  Settings,
  Zap,
  Clock,
  Eye,
  Edit,
  TestTube,
  Save,
  X,
  Play,
  ArrowRight,
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
  RotateCcw,
  Shield,
  Network,
  ChevronDown,
  ChevronRight,
  EyeOff,
  Code2,
  Lock,
  HelpCircle,
  CheckCircle2
} from 'lucide-react';

// Import the visual flow visualizer
import VisualAgentFlow from './components/VisualAgentFlow';

// Import sub-components (these would need similar design updates)
import AgentPreview from './components/AgentPreview';
import InputSchemaEditor from './components/InputSchemaEditor';
import PluginRequirements from './components/PluginRequirements';
import SystemPromptEditor from './components/SystemPromptEditor';
import AgentActions from './components/AgentActions';
import SimpleDynamicWorkflow from './components/VisualAgentFlow';

// Import hooks
import { useAgentGeneration } from './hooks/useAgentGeneration';

// Import types
import { Agent, SmartAgentBuilderProps } from './types/agent';

// Enhanced props for state persistence
interface SmartAgentBuilderPropsWithPersistence extends SmartAgentBuilderProps {
  restoredAgent?: Agent;
  sessionId?: string;
  editMode?: boolean;
  onStateChange?: (state: {
    agent: Agent | null;
    isEditing: boolean;
    editedAgent: Agent | null;
    sessionId: string;
  }) => void;
  // NEW: Plugin lock properties
  pluginsLocked?: boolean;
  originalPlugins?: any[];
  // NEW: Prompt lock properties
  promptsLocked?: boolean;
  originalPrompts?: {
    system_prompt?: string;
    user_prompt?: string;
  };
}

// NEW: LockedSystemPrompts Component
const LockedSystemPrompts = ({ 
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
const LockedPluginRequirements = ({ 
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

// Agent validation function
const validateAgent = (agent: Agent): string | null => {
  if (!agent.agent_name?.trim()) {
    return 'Agent name is required';
  }
  if (!agent.user_prompt?.trim()) {
    return 'User prompt is required';
  }
  if (agent.agent_name.length > 100) {
    return 'Agent name must be less than 100 characters';
  }
  if (agent.user_prompt.length > 5000) {
    return 'User prompt must be less than 5000 characters';
  }
  return null;
};

// Debug Panel Component
const DebugPanel = ({ agent, prompt, promptType, clarificationAnswers, isEditing, editedAgent, sessionId, editMode, pluginsLocked, originalPlugins, promptsLocked, originalPrompts }) => {
  const [showDebug, setShowDebug] = useState(false);
  const [activeTab, setActiveTab] = useState('agent');

  const debugData = {
    agent: agent,
    editedAgent: editedAgent,
    prompt: prompt,
    promptType: promptType,
    clarificationAnswers: clarificationAnswers,
    sessionId: sessionId,
    isEditing: isEditing,
    editMode: editMode,
    pluginsLocked: pluginsLocked,
    originalPlugins: originalPlugins,
    promptsLocked: promptsLocked, // NEW: Include prompt lock status
    originalPrompts: originalPrompts,
    currentAgent: isEditing ? editedAgent : agent
  };

  const tabs = [
    { id: 'agent', label: 'Agent Data', icon: Brain },
    { id: 'config', label: 'Agent Config', icon: Database },
    { id: 'input', label: 'Input Schema', icon: Settings },
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
                      _pluginsLocked: pluginsLocked || false,
                      _originalPlugins: originalPlugins || []
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

                <div className="bg-gray-800/50 rounded-lg p-4">
                  <h4 className="text-white font-medium mb-2 flex items-center gap-2">
                    <Network className="h-4 w-4 text-pink-400" />
                    Output Schema
                  </h4>
                  <pre className="text-xs text-pink-400 whitespace-pre-wrap overflow-x-auto">
                    {JSON.stringify(agent?.output_schema || [], null, 2)}
                  </pre>
                </div>
              </div>
            )}

            {/* ... other tab content remains the same ... */}
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
const CollapsibleSection = ({ 
  title, 
  description, 
  icon: Icon, 
  gradient, 
  children, 
  defaultExpanded = false,
  isEditing = false,
  headerExtra = null // NEW: Allow additional header content
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
const TechnicalDetailsToggle = ({ showTechnical, onToggle, isEditing }) => {
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

export default function SmartAgentBuilder({
  prompt,
  promptType,
  clarificationAnswers = {},
  onAgentCreated,
  onBack,
  onCancel,
  restoredAgent,
  sessionId: providedSessionId,
  editMode = false,
  onStateChange,
  // NEW: Plugin lock properties
  pluginsLocked = false,
  originalPlugins = [],
  // NEW: Prompt lock properties
  promptsLocked = false,
  originalPrompts = {}
}: SmartAgentBuilderPropsWithPersistence) {
  const { user } = useAuth();
  
  const sessionId = useRef(providedSessionId || `smart-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const hasInitiatedGeneration = useRef(false);
  
  const [agent, setAgent] = useState<Agent | null>(() => {
    if (restoredAgent) {
      console.log('Restoring agent from state:', restoredAgent.agent_name);
      hasInitiatedGeneration.current = true;
      return restoredAgent;
    }
    return null;
  });
  
  // Initialize edit state based on editMode
  const [isEditing, setIsEditing] = useState(editMode);
  const [editedAgent, setEditedAgent] = useState<Agent | null>(
    editMode && restoredAgent ? { ...restoredAgent } : null
  );
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(editMode);
  const [isCreating, setIsCreating] = useState(false);
  const [creationError, setCreationError] = useState<string | null>(null);
  
  const { generateAgent, isGenerating, error } = useAgentGeneration();
  
  // Mount and debug logging after state initialization
  console.log('SmartAgentBuilder mounted with props:', {
    prompt: prompt?.slice(0, 100) + '...',
    promptType,
    clarificationAnswersCount: Object.keys(clarificationAnswers).length,
    hasOnAgentCreated: !!onAgentCreated,
    hasOnBack: !!onBack,
    hasOnCancel: !!onCancel,
    userId: user?.id,
    hasRestoredAgent: !!restoredAgent,
    editMode,
    pluginsLocked,
    originalPluginsCount: originalPlugins.length,
    promptsLocked,
    hasOriginalPrompts: !!(originalPrompts.system_prompt || originalPrompts.user_prompt),
    sessionId: sessionId.current
  });
  
  // DEBUG: Log prompt locking status after state initialization
  console.log('🔒 PROMPT LOCK DEBUG:', {
    promptsLocked,
    originalPrompts,
    editMode,
    isEditing,
    willShowLockedPrompts: promptsLocked
  });

  useEffect(() => {
    if (onStateChange) {
      onStateChange({
        agent,
        isEditing,
        editedAgent,
        sessionId: sessionId.current
      });
    }
  }, [agent, isEditing, editedAgent, onStateChange]);

  // Auto-show technical details when editing
  useEffect(() => {
    if (isEditing) {
      setShowTechnicalDetails(true);
    }
  }, [isEditing]);

  // Skip generation in edit mode
  useEffect(() => {
    console.log('SmartAgentBuilder useEffect triggered:', {
      hasUser: !!user?.id,
      hasPrompt: !!prompt,
      promptLength: prompt?.length || 0,
      editMode,
      hasInitiated: hasInitiatedGeneration.current,
      hasAgent: !!agent,
      isGenerating
    });
    
    if (editMode) {
      console.log('Edit mode - skipping agent generation');
      return;
    }
    
    if (hasInitiatedGeneration.current || agent || isGenerating) {
      console.log('Skipping generation - already initiated or agent exists');
      return;
    }
    
    if (user?.id && prompt) {
      console.log('Starting agent generation...');
      hasInitiatedGeneration.current = true;
      handleGenerateAgent();
    } else {
      console.log('Missing requirements for agent generation:', {
        userId: user?.id,
        prompt: !!prompt
      });
    }
  }, [user?.id, prompt, agent, isGenerating, editMode]);

  const handleGenerateAgent = async () => {
    if (isGenerating || agent) {
      console.log('Generation already in progress or agent exists, skipping');
      return;
    }
    
    console.log('handleGenerateAgent called with prompt:', prompt?.slice(0, 100));
    
    try {
      const generatedAgent = await generateAgent(prompt, {
        sessionId: sessionId.current,
        clarificationAnswers,
        promptType
      });
      
      if (generatedAgent) {
        console.log('Agent generated successfully:', generatedAgent.agent_name);
        setAgent(generatedAgent);
      } else {
        console.log('Agent generation failed');
        hasInitiatedGeneration.current = false;
      }
    } catch (error) {
      console.error('Generation error:', error);
      hasInitiatedGeneration.current = false;
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
    setEditedAgent(agent ? { ...agent } : null);
  };

  const handleSaveEdit = async () => {
    if (!editedAgent) return;
    
    setAgent(editedAgent);
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedAgent(null);
  };

  // ENHANCED: Update function with plugin and prompt protection
  const updateEditedAgent = (updates: Partial<Agent>) => {
    setEditedAgent(prev => {
      if (!prev) return prev;
      
      const newAgent = { ...prev, ...updates };
      let blocked = false;
      let blockReason = '';
      
      // PROTECTION: Prevent plugin_required updates when locked
      if (pluginsLocked && updates.plugins_required) {
        console.warn('🔒 Attempted to modify locked plugins - change blocked');
        console.warn('Original plugins:', originalPlugins);
        console.warn('Attempted new plugins:', updates.plugins_required);
        
        // Restore original plugins
        newAgent.plugins_required = originalPlugins || prev.plugins_required;
        blocked = true;
        blockReason = 'Cannot modify required plugins - they are locked to ensure agent functionality';
      }
      
      // PROTECTION: Prevent prompt updates when locked
      if (promptsLocked && (updates.system_prompt !== undefined || updates.user_prompt !== undefined)) {
        console.warn('🔒 Attempted to modify locked prompts - change blocked');
        console.warn('Original prompts:', originalPrompts);
        console.warn('Attempted updates:', { 
          system_prompt: updates.system_prompt !== undefined ? 'ATTEMPTED_CHANGE' : 'no_change',
          user_prompt: updates.user_prompt !== undefined ? 'ATTEMPTED_CHANGE' : 'no_change'
        });
        
        // Restore original prompts
        if (updates.system_prompt !== undefined) {
          newAgent.system_prompt = originalPrompts.system_prompt || prev.system_prompt;
        }
        if (updates.user_prompt !== undefined) {
          newAgent.user_prompt = originalPrompts.user_prompt || prev.user_prompt;
        }
        blocked = true;
        blockReason = 'Cannot modify system or user prompts - they are locked to ensure agent functionality';
      }
      
      // Show user feedback if any changes were blocked
      if (blocked) {
        setCreationError(blockReason);
        setTimeout(() => setCreationError(null), 5000);
      }
      
      return newAgent;
    });
  };

  const handleCreateAgent = async () => {
    const finalAgent = isEditing ? editedAgent : agent;
    console.log('Creating agent:', finalAgent?.agent_name);
    
    if (!finalAgent) {
      console.error('No agent to create');
      setCreationError('No agent data available to create');
      return;
    }

    if (!user?.id) {
      console.error('No user logged in');
      setCreationError('You must be logged in to create an agent');
      return;
    }

    // SECURITY: Double-check plugin integrity for locked agents
    if (pluginsLocked && originalPlugins) {
      const currentPlugins = JSON.stringify(finalAgent.plugins_required || []);
      const expectedPlugins = JSON.stringify(originalPlugins);
      
      if (currentPlugins !== expectedPlugins) {
        console.error('🚨 Plugin tampering detected - reverting to original plugins');
        finalAgent.plugins_required = [...originalPlugins];
      }
    }

    // Validate agent data
    const validationError = validateAgent(finalAgent);
    if (validationError) {
      setCreationError(validationError);
      return;
    }

    try {
      setIsCreating(true);
      setCreationError(null);

      // Enhanced agent data preparation with plugin security
      const agentData = {
        user_id: user.id,
        agent_name: finalAgent.agent_name.trim(),
        description: finalAgent.description?.trim() || '',
        user_prompt: finalAgent.user_prompt.trim(),
        system_prompt: finalAgent.system_prompt || '',
        status: 'draft',
        mode: finalAgent.mode || 'on_demand',
        schedule_cron: finalAgent.schedule_cron || null,
        
        input_schema: finalAgent.input_schema || [],
        output_schema: finalAgent.output_schema || [],
        plugins_required: pluginsLocked ? originalPlugins : (finalAgent.plugins_required || []),
        connected_plugins: finalAgent.connected_plugins || [],
        workflow_steps: finalAgent.workflow_steps || [],
        trigger_conditions: finalAgent.trigger_conditions || null,
        generated_plan: finalAgent.generated_plan || null,
        detected_categories: finalAgent.detected_categories || [],
        
        ai_reasoning: finalAgent.ai_reasoning || '',
        ai_confidence: finalAgent.ai_confidence || 0,
        created_from_prompt: prompt,
        ai_generated_at: new Date().toISOString(),
        
        agent_config: {
          agent_name: finalAgent.agent_name.trim(),
          user_prompt: finalAgent.user_prompt.trim(),
          system_prompt: finalAgent.system_prompt || '',
          description: finalAgent.description?.trim() || '',
          
          workflow_steps: finalAgent.workflow_steps || [],
          input_schema: finalAgent.input_schema || [],
          output_schema: finalAgent.output_schema || [],
          plugins_required: pluginsLocked ? originalPlugins : (finalAgent.plugins_required || []),
          connected_plugins: finalAgent.connected_plugins || [],
          
          mode: finalAgent.mode || 'on_demand',
          schedule_cron: finalAgent.schedule_cron || null,
          trigger_conditions: finalAgent.trigger_conditions || null,
          
          metadata: {
            created_from_prompt: prompt,
            ai_generated_at: new Date().toISOString(),
            session_id: sessionId.current,
            prompt_type: promptType,
            clarification_answers: clarificationAnswers,
            version: '1.0',
            platform_version: 'v2.0',
            plugins_locked: pluginsLocked,
            original_plugins: pluginsLocked ? originalPlugins : null
          },
          
          ai_context: {
            reasoning: finalAgent.ai_reasoning || '',
            confidence: finalAgent.ai_confidence || 0,
            original_prompt: prompt,
            generated_plan: finalAgent.generated_plan || null,
            detected_categories: finalAgent.detected_categories || []
          }
        }
      };

      console.log('Saving agent via API:', agentData.agent_name);
      console.log('🔒 Plugins locked:', pluginsLocked);
      console.log('🔒 Original plugins preserved:', pluginsLocked ? originalPlugins.length : 'N/A');

      const apiEndpoint = editMode && finalAgent.id ? `/api/agents/${finalAgent.id}` : '/api/create-agent';
      const method = editMode && finalAgent.id ? 'PUT' : 'POST';

      const headers = {
        'Content-Type': 'application/json',
        'x-user-id': user.id,
      };

      try {
        const supabaseAuth = localStorage.getItem('supabase.auth.token');
        if (supabaseAuth) {
          const authData = JSON.parse(supabaseAuth);
          if (authData.access_token) {
            headers['authorization'] = `Bearer ${authData.access_token}`;
          }
        }
      } catch (e) {
        console.log('No auth token found for save operation, using user ID header only');
      }

      const response = await fetch(apiEndpoint, {
        method: method,
        headers: headers,
        body: JSON.stringify({ agent: agentData }),
      });

      console.log('Response status:', response.status);
      
      const responseText = await response.text();
      
      if (responseText.includes('<!DOCTYPE')) {
        throw new Error(`API endpoint ${apiEndpoint} returned HTML instead of JSON. Check if the endpoint exists and is working.`);
      }

      let result;
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error('Server returned invalid JSON. Check the API endpoint.');
      }

      if (!response.ok) {
        let errorMessage = result.error || `HTTP error! status: ${response.status}`;
        
        if (response.status === 401) {
          errorMessage += '\n\nThis appears to be an authentication issue.';
        }
        
        throw new Error(errorMessage);
      }

      const savedAgent = result.agent;
      console.log('Agent saved via API:', savedAgent.id);

      if (onAgentCreated) {
        onAgentCreated(savedAgent);
      }

    } catch (error) {
      console.error('Creation error:', error);
      setCreationError(error.message || 'Failed to create agent');
    } finally {
      setIsCreating(false);
    }
  };

  const handleRetryGeneration = () => {
    console.log('Retrying agent generation...');
    hasInitiatedGeneration.current = false;
    setAgent(null);
    
    setTimeout(() => {
      handleGenerateAgent();
    }, 100);
  };

  // Loading state (skip in edit mode)
  if (isGenerating && !agent && !editMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white/95 backdrop-blur-2xl rounded-3xl p-8 shadow-2xl border border-white/30 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 via-purple-400/10 to-indigo-400/10 animate-pulse"></div>
          
          <div className="absolute top-4 left-8 w-2 h-2 bg-blue-400/30 rounded-full animate-bounce delay-75"></div>
          <div className="absolute top-12 right-12 w-1.5 h-1.5 bg-purple-400/40 rounded-full animate-bounce delay-150"></div>
          <div className="absolute bottom-8 left-12 w-1 h-1 bg-indigo-400/30 rounded-full animate-bounce delay-300"></div>
          
          <div className="relative z-10">
            <div className="relative mb-8">
              <div className="w-20 h-20 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl animate-pulse">
                <Brain className="h-10 w-10 text-white" />
              </div>
              
              <div className="absolute inset-0 animate-spin" style={{animationDuration: '8s'}}>
                <div className="absolute -top-2 left-1/2 transform -translate-x-1/2 w-4 h-4 bg-gradient-to-r from-emerald-400 to-teal-500 rounded-full shadow-lg flex items-center justify-center">
                  <Sparkles className="h-2.5 w-2.5 text-white" />
                </div>
              </div>
              
              <div className="absolute inset-0 animate-spin" style={{animationDuration: '6s', animationDirection: 'reverse'}}>
                <div className="absolute -bottom-2 left-1/2 transform -translate-x-1/2 w-3 h-3 bg-gradient-to-r from-orange-400 to-pink-500 rounded-full shadow-lg"></div>
              </div>
            </div>
            
            <div className="mb-8">
              <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 bg-clip-text text-transparent mb-3">
                Building Your Smart Agent
              </h3>
              <p className="text-gray-600 text-base leading-relaxed">
                AI is analyzing your <span className="font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">{promptType}</span> prompt and generating the perfect automation workflow...
              </p>
            </div>
            
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-green-50 to-emerald-50 backdrop-blur-sm rounded-2xl border border-green-200/60 shadow-sm">
                <div className="w-8 h-8 bg-gradient-to-r from-green-500 to-emerald-500 rounded-xl flex items-center justify-center shadow-md">
                  <CheckCircle className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <span className="text-green-800 font-semibold text-sm">Requirements Extracted</span>
                  <div className="text-green-600 text-xs mt-0.5">Workflow structure identified</div>
                </div>
              </div>
              
              <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 backdrop-blur-sm rounded-2xl border border-blue-200/60 shadow-sm">
                <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center shadow-md">
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                </div>
                <div className="flex-1 text-left">
                  <span className="text-blue-800 font-semibold text-sm">Generating Configuration</span>
                  <div className="text-blue-600 text-xs mt-0.5">Creating optimal workflow steps...</div>
                </div>
              </div>
              
              <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-purple-50 to-violet-50 backdrop-blur-sm rounded-2xl border border-purple-200/60 shadow-sm opacity-60">
                <div className="w-8 h-8 bg-gradient-to-r from-purple-400 to-violet-400 rounded-xl flex items-center justify-center shadow-md">
                  <Settings className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 text-left">
                  <span className="text-purple-700 font-semibold text-sm">Finalizing Setup</span>
                  <div className="text-purple-600 text-xs mt-0.5">Almost ready...</div>
                </div>
              </div>
            </div>
            
            <div className="mt-8">
              <div className="w-full bg-gray-200/60 rounded-full h-1.5 shadow-inner">
                <div className="bg-gradient-to-r from-blue-500 to-indigo-500 h-1.5 rounded-full shadow-sm animate-pulse" style={{width: '75%'}}></div>
              </div>
              <p className="text-xs text-gray-500 mt-2">This may take a few moments...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state (skip in edit mode)
  if (error && !agent && !editMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-red-50 to-orange-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white/70 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20 text-center">
          <div className="w-24 h-24 bg-gradient-to-br from-red-500 to-red-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl">
            <AlertTriangle className="h-12 w-12 text-white" />
          </div>
          
          <h3 className="text-2xl font-bold text-gray-900 mb-4">Generation Failed</h3>
          <p className="text-red-600 mb-8 leading-relaxed bg-red-50/80 rounded-2xl p-4 border border-red-200">{error}</p>
          
          <div className="space-y-4">
            <button
              onClick={handleRetryGeneration}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 flex items-center justify-center gap-3 font-semibold shadow-lg transform hover:scale-[1.02]"
            >
              <div className="w-8 h-8 bg-white/20 rounded-xl flex items-center justify-center">
                <RefreshCw className="h-4 w-4" />
              </div>
              Try Again
            </button>
            {onBack && !editMode && (
              <button
                onClick={onBack}
                className="w-full bg-white/90 text-gray-700 px-6 py-4 rounded-2xl hover:bg-white transition-all duration-200 flex items-center justify-center gap-3 font-medium shadow-sm border border-gray-200"
              >
                <ArrowLeft className="h-4 w-4" />
                Go Back
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No agent state (skip in edit mode)
  if (!agent && !isGenerating && !editMode) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-blue-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white/70 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20 text-center">
          <div className="w-24 h-24 bg-gradient-to-br from-gray-300 to-gray-400 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-lg">
            <Brain className="h-12 w-12 text-white" />
          </div>
          
          <h3 className="text-2xl font-bold text-gray-900 mb-4">No Agent Generated</h3>
          <p className="text-gray-600 mb-8 leading-relaxed">
            Unable to generate agent from the provided prompt. Please try again or go back to refine your prompt.
          </p>
          
          <div className="space-y-4">
            <button
              onClick={handleRetryGeneration}
              className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-4 rounded-2xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 font-semibold shadow-lg transform hover:scale-[1.02]"
            >
              Retry Generation
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="w-full bg-white/90 text-gray-700 px-6 py-4 rounded-2xl hover:bg-white transition-all duration-200 font-medium shadow-sm border border-gray-200"
              >
                Go Back
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const currentAgent = isEditing ? editedAgent : agent;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
      {/* Enhanced Header */}
      <div className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-white/20 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-md">
                  <Brain className="h-4 w-4 text-white" />
                </div>
                <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 rounded-full border border-white"></div>
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                  Smart Agent Builder
                </h1>
                <p className="text-xs text-gray-500">
                  {editMode ? 'Agent Edit Mode' : isEditing ? 'Editing Agent Configuration' : 'Generated Agent Ready'}
                  {pluginsLocked && (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                      <Lock className="h-3 w-3" />
                      Plugins Protected
                    </span>
                  )}
                  {promptsLocked && (
                    <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full">
                      <Lock className="h-3 w-3" />
                      Prompts Protected
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {!isEditing && currentAgent && !editMode && (
                <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                  <CheckCircle className="h-4 w-4" />
                  Agent Ready
                </div>
              )}
              
              <div className="flex items-center gap-2">
                {onBack && !editMode && (
                  <button
                    onClick={onBack}
                    className="text-gray-500 hover:text-gray-700 transition-colors px-4 py-2 rounded-xl hover:bg-white/50 flex items-center gap-2"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </button>
                )}
                
                {isEditing ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveEdit}
                      className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-4 py-2 rounded-xl hover:from-green-700 hover:to-emerald-700 transition-all duration-200 flex items-center gap-2 font-medium shadow-lg"
                    >
                      <Save className="h-4 w-4" />
                      Save Changes
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="bg-gray-600 text-white px-4 py-2 rounded-xl hover:bg-gray-700 transition-all duration-200 flex items-center gap-2 font-medium"
                    >
                      <X className="h-4 w-4" />
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {editMode && onCancel && (
                      <button
                        onClick={onCancel}
                        className="bg-gray-600 text-white px-4 py-2 rounded-xl hover:bg-gray-700 transition-all duration-200 flex items-center gap-2 font-medium"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Agent
                      </button>
                    )}
                    
                    <button
                      onClick={handleEdit}
                      className="bg-white/90 text-gray-700 px-4 py-2 rounded-xl hover:bg-white transition-all duration-200 flex items-center gap-2 font-medium shadow-sm border border-gray-200"
                    >
                      <Edit className="h-4 w-4" />
                      Edit
                    </button>
                    
                    <button
                      onClick={handleCreateAgent}
                      disabled={isCreating}
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-xl hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all duration-200 flex items-center gap-2 shadow-lg font-semibold"
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {editMode ? 'Updating...' : 'Creating...'}
                        </>
                      ) : (
                        <>
                          <Zap className="h-4 w-4" />
                          {editMode ? 'Update Agent' : 'Create Agent'}
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Creation Error Display */}
      {creationError && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="bg-red-50/80 backdrop-blur-xl border border-red-200 rounded-xl p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <h4 className="font-medium text-red-800">
                Failed to {editMode ? 'Update' : 'Create'} Agent
              </h4>
              <p className="text-red-600 text-sm mt-1">{creationError}</p>
              <button
                onClick={() => setCreationError(null)}
                className="text-red-600 hover:text-red-800 text-sm mt-2 underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Agent Overview Card - Always Visible */}
        <div className="bg-white/70 backdrop-blur-xl rounded-3xl shadow-xl border border-white/20 p-8">
          <AgentPreview
            agent={currentAgent}
            prompt={prompt}
            promptType={promptType}
            isEditing={isEditing}
            onUpdate={updateEditedAgent}
          />
        </div>
 
        {/* Execution Preview Card - Full Width */}
        <CollapsibleSection
          title="Execution Preview"
          description="Visual workflow and process flow"
          icon={Play}
          gradient="bg-gradient-to-br from-orange-500 to-red-500"
          isEditing={isEditing}
          defaultExpanded={false}
        >
          <div className="bg-gradient-to-br from-orange-50 to-red-50 rounded-xl p-6 border border-orange-200/50">
            {currentAgent?.workflow_steps && currentAgent.workflow_steps.length > 0 ? (
              <VisualAgentFlow agent={currentAgent} />
            ) : (
              <div className="text-center text-gray-600">
                <Play className="h-12 w-12 mx-auto text-orange-500 mb-4" />
                <p className="font-medium">No workflow steps available</p>
                <p className="text-sm mt-2">
                  Workflow visualization will appear when agent has defined workflow steps
                </p>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Debug Panel - Always Visible for Development */}
        <DebugPanel
          agent={agent}
          prompt={prompt}
          promptType={promptType}
          clarificationAnswers={clarificationAnswers}
          isEditing={isEditing}
          editedAgent={editedAgent}
          editMode={editMode}
          pluginsLocked={pluginsLocked}
          originalPlugins={originalPlugins}
          promptsLocked={promptsLocked}
          originalPrompts={originalPrompts}
          sessionId={sessionId.current}
        />

        {/* Technical Details Toggle */}
        <TechnicalDetailsToggle 
          showTechnical={showTechnicalDetails}
          onToggle={() => setShowTechnicalDetails(!showTechnicalDetails)}
          isEditing={isEditing}
        />

        {/* Technical Sections - Collapsible */}
        {showTechnicalDetails && (
          <div className="space-y-8 animate-in fade-in-0 slide-in-from-top-4 duration-300">
            
            {/* Two Column Layout */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Input Schema Card */}
              <CollapsibleSection
                title="Input Schema"
                description="Define agent input parameters"
                icon={Settings}
                gradient="bg-gradient-to-br from-blue-500 to-cyan-500"
                isEditing={isEditing}
                defaultExpanded={false}
              >
                <InputSchemaEditor
                  inputSchema={currentAgent?.input_schema || []}
                  isEditing={isEditing}
                  onUpdate={(inputSchema) => updateEditedAgent({ input_schema: inputSchema })}
                />
              </CollapsibleSection>

              {/* Plugin Requirements Card - ENHANCED with lock support */}
              <CollapsibleSection
                title="Plugin Requirements"
                description={
                  pluginsLocked 
                    ? "Required integrations (locked for agent stability)"
                    : "Required integrations and services"
                }
                icon={pluginsLocked ? Lock : Zap}
                gradient="bg-gradient-to-br from-purple-500 to-pink-500"
                isEditing={isEditing}
                defaultExpanded={false}
                headerExtra={pluginsLocked && (
                  <div className="flex items-center gap-2 text-amber-600">
                    <Shield className="h-4 w-4" />
                    <span className="text-xs font-medium">Protected</span>
                  </div>
                )}
              >
                {pluginsLocked ? (
                  <LockedPluginRequirements
                    pluginsRequired={currentAgent?.plugins_required || []}
                    originalPlugins={originalPlugins || []}
                    onViewDetails={() => {
                      console.log('Show plugin lock explanation modal');
                    }}
                  />
                ) : (
                  <PluginRequirements
                    pluginsRequired={currentAgent?.plugins_required || []}
                    isEditing={isEditing}
                    onUpdate={(plugins) => updateEditedAgent({ plugins_required: plugins })}
                  />
                )}
              </CollapsibleSection>
            </div>
            
            {/* System Prompt Card - Full Width */}
            <CollapsibleSection
              title="System Prompts"
              description={
                promptsLocked 
                  ? "Agent behavior and instructions (locked for stability)"
                  : "Agent behavior and instructions"
              }
              icon={promptsLocked ? Lock : Brain}
              gradient="bg-gradient-to-br from-emerald-500 to-green-500"
              isEditing={isEditing}
              defaultExpanded={false}
              headerExtra={promptsLocked && (
                <div className="flex items-center gap-2 text-orange-600">
                  <Shield className="h-4 w-4" />
                  <span className="text-xs font-medium">Protected</span>
                </div>
              )}
            >
              {(() => {
                console.log('🔒 RENDERING SYSTEM PROMPTS:', {
                  promptsLocked,
                  isEditing,
                  editMode,
                  willRenderLocked: promptsLocked
                });
                
                if (promptsLocked) {
                  console.log('🔒 Rendering LOCKED system prompts component');
                  return (
                    <LockedSystemPrompts
                      systemPrompt={currentAgent?.system_prompt || ''}
                      userPrompt={currentAgent?.user_prompt || ''}
                      originalPrompts={originalPrompts || {}}
                    />
                  );
                } else {
                  console.log('✏️ Rendering EDITABLE system prompts component');
                  return (
                    <SystemPromptEditor
                      systemPrompt={currentAgent?.system_prompt || ''}
                      userPrompt={currentAgent?.user_prompt || ''}
                      isEditing={isEditing}
                      onUpdateSystem={(systemPrompt) => updateEditedAgent({ system_prompt: systemPrompt })}
                      onUpdateUser={(userPrompt) => updateEditedAgent({ user_prompt: userPrompt })}
                    />
                  );
                }
              })()}
            </CollapsibleSection>
          </div>
        )}
      </div>
    </div>
  );
}
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
  Code2
} from 'lucide-react';

// Import the visual flow visualizer
import VisualAgentFlow from './components/VisualAgentFlow';

// Import sub-components (these would need similar design updates)
import AgentPreview from './components/AgentPreview';
import InputSchemaEditor from './components/InputSchemaEditor';
import PluginRequirements from './components/PluginRequirements';
import SystemPromptEditor from './components/SystemPromptEditor';
import TestRunner from './components/TestRunner';
import AgentActions from './components/AgentActions';

// Import hooks
import { useAgentGeneration } from './hooks/useAgentGeneration';
import { useAgentTesting } from './hooks/useAgentTesting';

// Import types
import { Agent, SmartAgentBuilderProps } from './types/agent';

// Enhanced props for state persistence
interface SmartAgentBuilderPropsWithPersistence extends SmartAgentBuilderProps {
  restoredAgent?: Agent;
  sessionId?: string;
  onStateChange?: (state: {
    agent: Agent | null;
    isEditing: boolean;
    editedAgent: Agent | null;
    sessionId: string;
  }) => void;
}

// Collapsible Section Component
const CollapsibleSection = ({ 
  title, 
  description, 
  icon: Icon, 
  gradient, 
  children, 
  defaultExpanded = false,
  isEditing = false 
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
            <h3 className="text-lg font-semibold text-gray-800 group-hover:text-gray-900">
              {title}
            </h3>
            <p className="text-sm text-gray-500">{description}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {isEditing && (
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
  onStateChange
}: SmartAgentBuilderPropsWithPersistence) {
  const { user } = useAuth();
  
  const sessionId = useRef(providedSessionId || `smart-session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
  const hasInitiatedGeneration = useRef(false);
  
  console.log('🚀 SmartAgentBuilder mounted with props:', {
    prompt: prompt?.slice(0, 100) + '...',
    promptType,
    clarificationAnswersCount: Object.keys(clarificationAnswers).length,
    hasOnAgentCreated: !!onAgentCreated,
    hasOnBack: !!onBack,
    hasOnCancel: !!onCancel,
    userId: user?.id,
    hasRestoredAgent: !!restoredAgent,
    sessionId: sessionId.current
  });
  
  const [agent, setAgent] = useState<Agent | null>(() => {
    if (restoredAgent) {
      console.log('🔄 Restoring agent from state:', restoredAgent.agent_name);
      hasInitiatedGeneration.current = true;
      return restoredAgent;
    }
    return null;
  });
  
  const [isEditing, setIsEditing] = useState(false);
  const [editedAgent, setEditedAgent] = useState<Agent | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  
  const { generateAgent, isGenerating, error } = useAgentGeneration();
  const { 
    testAgent, 
    isTesting, 
    testResults, 
    clearTestResults 
  } = useAgentTesting();

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

  useEffect(() => {
    console.log('🔄 SmartAgentBuilder useEffect triggered:', {
      hasUser: !!user?.id,
      hasPrompt: !!prompt,
      promptLength: prompt?.length || 0,
      hasInitiated: hasInitiatedGeneration.current,
      hasAgent: !!agent,
      isGenerating
    });
    
    if (hasInitiatedGeneration.current || agent || isGenerating) {
      console.log('⚠️ Skipping generation - already initiated or agent exists');
      return;
    }
    
    if (user?.id && prompt) {
      console.log('✅ Starting agent generation...');
      hasInitiatedGeneration.current = true;
      handleGenerateAgent();
    } else {
      console.log('❌ Missing requirements for agent generation:', {
        userId: user?.id,
        prompt: !!prompt
      });
    }
  }, [user?.id, prompt, agent, isGenerating]);

  const handleGenerateAgent = async () => {
    if (isGenerating || agent) {
      console.log('⚠️ Generation already in progress or agent exists, skipping');
      return;
    }
    
    console.log('🎯 handleGenerateAgent called with prompt:', prompt?.slice(0, 100));
    clearTestResults();
    
    try {
      const generatedAgent = await generateAgent(prompt, {
        sessionId: sessionId.current,
        clarificationAnswers,
        promptType
      });
      
      if (generatedAgent) {
        console.log('✅ Agent generated successfully:', generatedAgent.agent_name);
        setAgent(generatedAgent);
      } else {
        console.log('❌ Agent generation failed');
        hasInitiatedGeneration.current = false;
      }
    } catch (error) {
      console.error('❌ Generation error:', error);
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
    clearTestResults();
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedAgent(null);
  };

  const handleTestAgent = async () => {
    const currentAgent = isEditing ? editedAgent : agent;
    if (currentAgent) {
      await testAgent(currentAgent);
    }
  };

  const handleCreateAgent = () => {
    const finalAgent = isEditing ? editedAgent : agent;
    console.log('🎉 Creating agent:', finalAgent?.agent_name);
    if (finalAgent && onAgentCreated) {
      onAgentCreated(finalAgent);
    } else {
      console.error('❌ Cannot create agent:', {
        hasFinalAgent: !!finalAgent,
        hasCallback: !!onAgentCreated
      });
    }
  };

  const handleRetryGeneration = () => {
    console.log('🔄 Retrying agent generation...');
    hasInitiatedGeneration.current = false;
    setAgent(null);
    clearTestResults();
    
    setTimeout(() => {
      handleGenerateAgent();
    }, 100);
  };

  const updateEditedAgent = (updates: Partial<Agent>) => {
    if (editedAgent) {
      setEditedAgent({ ...editedAgent, ...updates });
    }
  };

  // Loading state with enhanced design
  if (isGenerating && !agent) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-white/70 backdrop-blur-xl rounded-3xl p-8 shadow-2xl border border-white/20 text-center">
          <div className="relative mb-8">
            <div className="w-24 h-24 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl">
              <Brain className="h-12 w-12 text-white" />
            </div>
            <div className="absolute -top-2 -right-2 w-8 h-8 bg-gradient-to-r from-green-400 to-emerald-500 rounded-full flex items-center justify-center animate-pulse">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin absolute top-8 left-1/2 transform -translate-x-1/2" />
          </div>
          
          <h3 className="text-2xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent mb-4">
            Building Your Smart Agent
          </h3>
          <p className="text-gray-600 mb-8 leading-relaxed">
            AI is analyzing your <span className="font-semibold text-blue-600">{promptType}</span> prompt and creating the intelligent agent structure...
          </p>
          
          <div className="space-y-4">
            <div className="flex items-center gap-4 p-4 bg-green-50/80 backdrop-blur-sm rounded-2xl border border-green-200/50">
              <div className="w-8 h-8 bg-green-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <CheckCircle className="h-4 w-4 text-white" />
              </div>
              <span className="text-green-800 font-medium">Prompt analyzed and requirements extracted</span>
            </div>
            
            <div className="flex items-center gap-4 p-4 bg-green-50/80 backdrop-blur-sm rounded-2xl border border-green-200/50">
              <div className="w-8 h-8 bg-green-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <CheckCircle className="h-4 w-4 text-white" />
              </div>
              <span className="text-green-800 font-medium">Detecting required plugins and services</span>
            </div>
            
            <div className="flex items-center gap-4 p-4 bg-blue-50/80 backdrop-blur-sm rounded-2xl border border-blue-200/50">
              <div className="w-8 h-8 bg-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
                <Loader2 className="h-4 w-4 animate-spin text-white" />
              </div>
              <span className="text-blue-800 font-medium">Generating agent configuration...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state with enhanced design
  if (error && !agent) {
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
            {onBack && (
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

  // No agent state with enhanced design
  if (!agent && !isGenerating) {
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
      <div className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-white/20 shadow-lg">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 via-purple-500 to-indigo-600 rounded-2xl flex items-center justify-center shadow-lg">
                  <Brain className="h-7 w-7 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse"></div>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-gray-800 to-gray-600 bg-clip-text text-transparent">
                  Smart Agent Builder
                </h1>
                <p className="text-sm text-gray-500 font-medium">
                  {isEditing ? 'Editing Agent Configuration' : 'Generated Agent Ready'}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              {!isEditing && currentAgent && (
                <div className="hidden md:flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-full text-sm font-medium">
                  <CheckCircle className="h-4 w-4" />
                  Agent Ready
                </div>
              )}
              
              <div className="flex items-center gap-2">
                {onBack && (
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
                    <button
                      onClick={handleEdit}
                      className="bg-white/90 text-gray-700 px-4 py-2 rounded-xl hover:bg-white transition-all duration-200 flex items-center gap-2 font-medium shadow-sm border border-gray-200"
                    >
                      <Edit className="h-4 w-4" />
                      Edit
                    </button>
                    
                    <button
                      onClick={handleTestAgent}
                      disabled={isTesting}
                      className="bg-purple-600 text-white px-4 py-2 rounded-xl hover:bg-purple-700 disabled:opacity-50 transition-all duration-200 flex items-center gap-2 font-medium shadow-lg"
                    >
                      {isTesting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <TestTube className="h-4 w-4" />
                      )}
                      {isTesting ? 'Testing...' : 'Test'}
                    </button>
                    
                    <button
                      onClick={handleCreateAgent}
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-6 py-2.5 rounded-xl hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 flex items-center gap-2 shadow-lg font-semibold"
                    >
                      <Zap className="h-4 w-4" />
                      Create Agent
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

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

        {/* Visual Agent Flow Card - Always Visible */}
        <div className="bg-white/70 backdrop-blur-xl rounded-3xl shadow-xl border border-white/20 p-8">
          <VisualAgentFlow
            agent={currentAgent}
            autoPlay={!isEditing} // Only auto-play when not editing
          />
        </div>

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

              {/* Plugin Requirements Card */}
              <CollapsibleSection
                title="Plugin Requirements"
                description="Required integrations and services"
                icon={Zap}
                gradient="bg-gradient-to-br from-purple-500 to-pink-500"
                isEditing={isEditing}
                defaultExpanded={false}
              >
                <PluginRequirements
                  pluginsRequired={currentAgent?.plugins_required || []}
                  isEditing={isEditing}
                  onUpdate={(plugins) => updateEditedAgent({ plugins_required: plugins })}
                />
              </CollapsibleSection>
            </div>

            {/* System Prompt Card - Full Width */}
            <CollapsibleSection
              title="System Prompts"
              description="Agent behavior and instructions"
              icon={Brain}
              gradient="bg-gradient-to-br from-emerald-500 to-green-500"
              isEditing={isEditing}
              defaultExpanded={false}
            >
              <SystemPromptEditor
                systemPrompt={currentAgent?.system_prompt || ''}
                userPrompt={currentAgent?.user_prompt || ''}
                isEditing={isEditing}
                onUpdateSystem={(systemPrompt) => updateEditedAgent({ system_prompt: systemPrompt })}
                onUpdateUser={(userPrompt) => updateEditedAgent({ user_prompt: userPrompt })}
              />
            </CollapsibleSection>

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
                <div className="text-center text-gray-600">
                  <Play className="h-12 w-12 mx-auto text-orange-500 mb-4" />
                  <p className="font-medium">Execution flow visualization would go here</p>
                  <p className="text-sm mt-2">Shows the step-by-step process of how the agent executes</p>
                </div>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* Test Results */}
        {testResults && (
          <div className="bg-gradient-to-br from-green-50/50 to-emerald-50/50 backdrop-blur-xl rounded-3xl shadow-xl border border-emerald-200/30 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-500 rounded-xl flex items-center justify-center">
                <TestTube className="h-5 w-5 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Test Results</h3>
                <p className="text-sm text-gray-500">Agent performance validation</p>
              </div>
            </div>
            <TestRunner
              testResults={testResults}
              onClearResults={clearTestResults}
            />
          </div>
        )}
      </div>
    </div>
  );
}
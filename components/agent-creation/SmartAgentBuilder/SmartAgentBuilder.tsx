import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/components/UserProvider';
import { createClient } from '@supabase/supabase-js';
import { 
  Brain, 
  Loader2, 
  ArrowLeft,
  CheckCircle,
  Settings,
  Zap,
  Edit,
  Save,
  X,
  Play,
  AlertTriangle,
  Lock,
  Clock
} from 'lucide-react';

// Import the visual flow visualizer
import VisualAgentFlow from './components/VisualAgentFlow';

// Import sub-components
import AgentPreview from './components/AgentPreview';
import InputSchemaEditor from './components/InputSchemaEditor';
import PluginRequirements from './components/PluginRequirements';
import SystemPromptEditor from './components/SystemPromptEditor';
import ScheduleEditor from './components/ScheduleEditor';

// Import separated components
import {
  DebugPanel,
  CollapsibleSection,
  TechnicalDetailsToggle,
  LockedSystemPrompts,
  LockedPluginRequirements
} from './SmartAgentBuilderComponents';

// Import view states
import {
  LoadingView,
  ErrorView,
  EmptyView
} from './SmartAgentBuilderViews';

// Import hooks and types
import { useAgentGeneration } from './hooks/useAgentGeneration';
import { Agent, SmartAgentBuilderProps } from './types/agent';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// FIXED: Generate proper UUID format for database compatibility (matches backend)
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

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
  // Plugin lock properties
  pluginsLocked?: boolean;
  originalPlugins?: any[];
  // Prompt lock properties
  promptsLocked?: boolean;
  originalPrompts?: {
    system_prompt?: string;
    user_prompt?: string;
  };
}

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
  // Plugin lock properties
  pluginsLocked = false,
  originalPlugins = [],
  // Prompt lock properties
  promptsLocked = false,
  originalPrompts = {}
}: SmartAgentBuilderPropsWithPersistence) {
  const { user } = useAuth();
  
  console.log('🔍 SmartAgentBuilder DEBUG - clarificationAnswers:', {
    clarificationAnswers,
    hasAgentId: !!clarificationAnswers?.agentId,
    hasSessionId: !!clarificationAnswers?.sessionId,
    agentIdValue: clarificationAnswers?.agentId,
    sessionIdValue: clarificationAnswers?.sessionId,
    allKeys: Object.keys(clarificationAnswers || {})
  });

  // FIXED: Use proper UUID generation and extract IDs from clarificationAnswers (new system)
  const sessionId = useRef(
    providedSessionId || 
    clarificationAnswers?.sessionId || 
    generateUUID()
  );
  
  // FIXED: Extract agent ID from clarificationAnswers (passed from ConversationalBuilder)
  const agentId = useRef(
    clarificationAnswers?.agentId || 
    generateUUID()
  );
  
  const hasInitiatedGeneration = useRef(false);
  
  // FIXED: Log the consistent agent ID and session ID being used
  console.log('🆔 SmartAgentBuilder initialized with CONSISTENT IDs:', {
    agentId: agentId.current,
    sessionId: sessionId.current,
    providedSessionId,
    extractedFromClarificationAnswers: {
      agentId: clarificationAnswers?.agentId,
      sessionId: clarificationAnswers?.sessionId
    },
    isRestored: !!restoredAgent,
    editMode,
    pluginsLocked,
    promptsLocked
  });
  
  // User profile state for timezone
  const [userProfile, setUserProfile] = useState(null);
  
  // State management
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
    sessionId: sessionId.current,
    agentId: agentId.current
  });
  
  // DEBUG: Log prompt locking status after state initialization
  console.log('🔒 PROMPT LOCK DEBUG:', {
    promptsLocked,
    originalPrompts,
    editMode,
    isEditing,
    willShowLockedPrompts: promptsLocked
  });

  // Effects - Fetch user profile timezone
  useEffect(() => {
    const fetchUserProfile = async () => {
      if (user?.id) {
        try {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('timezone')
            .eq('id', user.id)
            .single();
          
          if (error) {
            console.warn('Could not fetch user profile timezone:', error);
          } else {
            setUserProfile(profile);
            console.log('User profile timezone loaded:', profile?.timezone);
          }
        } catch (error) {
          console.warn('Error fetching user profile:', error);
        }
      }
    };
    
    fetchUserProfile();
  }, [user?.id]);

  // Get user's preferred timezone with intelligent fallbacks
  const getUserTimezone = () => {
    // Priority: user profile > browser detection > UTC fallback
    if (userProfile?.timezone) {
      return userProfile.timezone;
    }
    
    try {
      const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      console.log('Auto-detected user timezone:', detectedTimezone);
      return detectedTimezone;
    } catch (error) {
      console.warn('Could not detect user timezone:', error);
      return 'UTC';
    }
  };

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

  // DEBUG: Log agent state changes
  useEffect(() => {
    console.log('🔍 AGENT STATE CHANGED:', {
      hasAgent: !!agent,
      mode: agent?.mode,
      schedule_cron: agent?.schedule_cron,
      timezone: agent?.timezone,
      agentName: agent?.agent_name
    });
  }, [agent]);

  // Skip generation in edit mode
  useEffect(() => {
    console.log('SmartAgentBuilder useEffect triggered:', {
      hasUser: !!user?.id,
      hasPrompt: !!prompt,
      promptLength: prompt?.length || 0,
      editMode,
      hasInitiated: hasInitiatedGeneration.current,
      hasAgent: !!agent,
      isGenerating,
      agentId: agentId.current,
      sessionId: sessionId.current
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

  // Event handlers
  const handleGenerateAgent = async () => {
    if (isGenerating || agent) {
      console.log('Generation already in progress or agent exists, skipping');
      return;
    }
    
    console.log('handleGenerateAgent called with CONSISTENT agent ID:', {
      prompt: prompt?.slice(0, 100),
      agentId: agentId.current,
      sessionId: sessionId.current
    });
    
    try {
      const generatedAgent = await generateAgent(prompt, {
        sessionId: sessionId.current,
        agentId: agentId.current,
        clarificationAnswers,
        promptType
      });
      
      if (generatedAgent) {
        console.log('Agent generated successfully with CONSISTENT ID:', {
          agentName: generatedAgent.agent_name,
          agentId: agentId.current
        });
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

  // NEW: Handle schedule updates that work outside of edit mode
  const updateAgentSchedule = (updates: Partial<Agent>) => {
    console.log('📅 updateAgentSchedule called with:', updates);
    console.log('📅 Current state:', { isEditing, hasAgent: !!agent });

    // Update the main agent if not in editing mode
    if (!isEditing && agent) {
      setAgent(prev => {
        const updated = prev ? { ...prev, ...updates } : prev;
        console.log('📅 Updated main agent:', { mode: updated?.mode, schedule_cron: updated?.schedule_cron, timezone: updated?.timezone });
        return updated;
      });
    }

    // Also update the edited agent if in editing mode
    if (isEditing) {
      console.log('📅 Updating edited agent');
      updateEditedAgent(updates);
    }
  };

  const handleCreateAgent = async () => {
    const finalAgent = isEditing ? editedAgent : agent;
    console.log('Creating agent:', finalAgent?.agent_name);
    console.log('📅 Final agent schedule config before API call:', {
      mode: finalAgent?.mode,
      schedule_cron: finalAgent?.schedule_cron,
      timezone: finalAgent?.timezone
    });

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

      console.log('📦 Preparing agentData - finalAgent values:', {
        mode: finalAgent.mode,
        schedule_cron: finalAgent.schedule_cron,
        timezone: finalAgent.timezone,
        willFallbackMode: !finalAgent.mode,
        willFallbackTimezone: !finalAgent.timezone
      });

      // Enhanced agent data preparation with plugin security and timezone support
      const agentData = {
        user_id: user.id,
        agent_name: finalAgent.agent_name.trim(),
        description: finalAgent.description?.trim() || '',
        user_prompt: finalAgent.user_prompt.trim(),
        system_prompt: finalAgent.system_prompt || '',
        status: 'draft',
        mode: finalAgent.mode || 'on_demand',
        schedule_cron: finalAgent.schedule_cron || null,
        timezone: finalAgent.timezone || getUserTimezone(), // Use smart timezone detection
        
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
          timezone: finalAgent.timezone || getUserTimezone(), // Use smart timezone detection
          trigger_conditions: finalAgent.trigger_conditions || null,
          
          metadata: {
            created_from_prompt: prompt,
            ai_generated_at: new Date().toISOString(),
            session_id: sessionId.current,
            agent_id: agentId.current,
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
      console.log('🌍 Using timezone:', agentData.timezone);
      console.log('🆔 Using consistent IDs:', { agentId: agentId.current, sessionId: sessionId.current });

      const apiEndpoint = editMode && finalAgent.id ? `/api/agents/${finalAgent.id}` : '/api/create-agent';
      const method = editMode && finalAgent.id ? 'PUT' : 'POST';

      const headers = {
        'Content-Type': 'application/json',
        'x-user-id': user.id,
        'x-session-id': sessionId.current,
        'x-agent-id': agentId.current,
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
        body: JSON.stringify({ 
          agent: agentData,
          sessionId: sessionId.current,
          agentId: agentId.current
        }),
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
      console.log('Agent saved via API with consistent ID tracking:', {
        savedAgentId: savedAgent.id,
        agentId: agentId.current,
        sessionId: sessionId.current,
        timezone: savedAgent.timezone
      });

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

  // View state renders
  if (isGenerating && !agent && !editMode) {
    return (
      <LoadingView 
        promptType={promptType}
      />
    );
  }

  if (error && !agent && !editMode) {
    return (
      <ErrorView 
        error={error}
        onRetry={handleRetryGeneration}
        onBack={onBack}
        editMode={editMode}
      />
    );
  }

  if (!agent && !isGenerating && !editMode) {
    return (
      <EmptyView 
        onRetry={handleRetryGeneration}
        onBack={onBack}
      />
    );
  }

  const currentAgent = isEditing ? editedAgent : agent;

  // Main render
  return (
    <div className="min-h-screen bg-white">
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
                      className="bg-gradient-to-r from-green-600 to-emerald-600 text-white px-3 py-1.5 rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all duration-200 flex items-center gap-1.5 text-sm font-medium shadow-lg"
                    >
                      <Save className="h-3.5 w-3.5" />
                      Save Changes
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="bg-gray-600 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-all duration-200 flex items-center gap-1.5 text-sm font-medium"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </button>
                  </div>
                ) : (
                   <div className="flex items-center gap-2">
                    {editMode && onCancel && (
                      <button
                        onClick={onCancel}
                        className="bg-gray-600 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 transition-all duration-200 flex items-center gap-1.5 text-sm font-medium"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Back to Agent
                      </button>
                    )}
                    
                    <button
                      onClick={handleEdit}
                      className="bg-white/90 text-gray-700 px-3 py-1.5 rounded-lg hover:bg-white transition-all duration-200 flex items-center gap-1.5 text-sm font-medium shadow-sm border border-gray-200"
                    >
                      <Edit className="h-3.5 w-3.5" />
                      Edit
                    </button>
                    
                    <button
                      onClick={handleCreateAgent}
                      disabled={isCreating}
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white px-4 py-1.5 rounded-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition-all duration-200 flex items-center gap-1.5 shadow-lg text-sm font-semibold"
                    >
                      {isCreating ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {editMode ? 'Updating...' : 'Creating...'}
                        </>
                      ) : (
                        <>
                          <Zap className="h-3.5 w-3.5" />
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
 
        {/* Schedule Configuration Card - UPDATED: Always editable with timezone support */}
        <CollapsibleSection
          title="Schedule Configuration"
          description="Configure when and how often your agent runs"
          icon={Clock}
          gradient="bg-gradient-to-br from-indigo-500 to-blue-500"
          isEditing={true} // Always show as editable
          defaultExpanded={true}
        >
          <ScheduleEditor
            mode={currentAgent?.mode as 'on_demand' | 'scheduled'}
            scheduleCron={currentAgent?.schedule_cron}
            timezone={currentAgent?.timezone || getUserTimezone()} // Pass detected timezone
            isEditing={true} // Always allow editing
            onUpdate={(updates) => updateAgentSchedule(updates)} // Use new handler
          />
        </CollapsibleSection>


        {/* Execution Preview Card - Full Width */}
        <CollapsibleSection
          title="Execution Preview"
          description="Visual workflow and process flow"
          icon={Play}
          gradient="bg-gradient-to-br from-orange-500 to-red-500"
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
          agentId={agentId.current}
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
                    <Lock className="h-4 w-4" />
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
                  <Lock className="h-4 w-4" />
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
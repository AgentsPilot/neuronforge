import { useState, useEffect, useRef } from 'react';
import { generateAgentPlan, type GeneratedPlan } from '../workflowAnalysis';
import { getPluginByKey } from '@/lib/plugins/pluginList';
import type { PluginStep, RequiredInput, Output } from '../types';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/components/UserProvider';

interface Props {
  data: {
    userPrompt: string;
    systemPrompt?: string;
    plugins: Record<string, any>;
    generatedPlan?: GeneratedPlan | null;
    planAccepted?: boolean;
    workflowSteps?: any[];
    inputSchema?: any[];
    outputSchema?: any[];
  };
  onUpdate: (updates: any) => void;
  onValidationChange?: (isValid: boolean, error?: string) => void;
  userId?: string;
}

interface PluginNotification {
  isGenerating: boolean;
  generated: { inputs: number; outputs: number } | null;
  showNotification: boolean;
}

// Define system plugins that don't require connection
const SYSTEM_PLUGINS = ['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'];

export function useWorkflowData({ data, onUpdate, onValidationChange, userId }: Props) {
  // Core state
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(data.generatedPlan || null);
  const [acceptedPlan, setAcceptedPlan] = useState<GeneratedPlan | null>(null); // Store the accepted plan separately
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAnalysisDetails, setShowAnalysisDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [viewMode, setViewMode] = useState<'business' | 'technical'>('business');
  
  // Track if plan has been generated to prevent auto-regeneration
  const [hasGeneratedPlan, setHasGeneratedPlan] = useState(!!data.generatedPlan);
  const lastPromptRef = useRef<string>('');
  const isAutoGeneratingRef = useRef(false);
  
  // Editable data arrays
  const [editableSteps, setEditableSteps] = useState<PluginStep[]>([]);
  const [editableInputs, setEditableInputs] = useState<RequiredInput[]>([]);
  const [editableOutputs, setEditableOutputs] = useState<Output[]>([]);
  
  // Plugin connection state
  const [connectedPlugins, setConnectedPlugins] = useState<string[]>([]);
  const [connectionDetails, setConnectionDetails] = useState<Record<string, any>>({});
  
  // Modal and interaction state
  const [showRemoveConfirmation, setShowRemoveConfirmation] = useState(false);
  const [stepToRemove, setStepToRemove] = useState<{
    step: PluginStep;
    relatedInputs: RequiredInput[];
    relatedOutputs: Output[];
  } | null>(null);
  
  // Plugin notifications state
  const [newlyAddedPlugins, setNewlyAddedPlugins] = useState<string[]>([]);
  const [pluginNotifications, setPluginNotifications] = useState<Record<string, PluginNotification>>({});
  
  const { user } = useAuth();

  // Initialize from existing plan data - check for accepted plan first
  useEffect(() => {
    if (data.planAccepted && data.workflowSteps && data.workflowSteps.length > 0) {
      // If we have an accepted plan (from navigation back), reconstruct it
      console.log('🔄 Initializing from accepted plan data');
      const reconstructedAcceptedPlan = {
        steps: data.workflowSteps,
        requiredInputs: data.inputSchema || [],
        outputs: data.outputSchema || [],
        reasoning: data.systemPrompt || '',
        confidence: 85,
        missingPlugins: [],
        unconnectedPlugins: []
      };
      setAcceptedPlan(reconstructedAcceptedPlan);
      setGeneratedPlan(reconstructedAcceptedPlan); // Show the accepted plan
      setHasGeneratedPlan(true);
      lastPromptRef.current = data.userPrompt;
    } else if (data.generatedPlan && !generatedPlan) {
      // Otherwise, initialize from the original generated plan
      console.log('🔄 Initializing from original plan data');
      setGeneratedPlan(data.generatedPlan);
      setHasGeneratedPlan(true);
      lastPromptRef.current = data.userPrompt;
    }
  }, [data.generatedPlan, data.planAccepted, data.workflowSteps, data.inputSchema, data.outputSchema]);

  // Fetch connected plugins from database
  useEffect(() => {
    const fetchConnectedPlugins = async () => {
      if (!user?.id) return;

      try {
        const { data: pluginData, error } = await supabase
          .from('plugin_connections')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'active');

        if (!error && pluginData) {
          const pluginKeys = pluginData.map(connection => connection.plugin_key);
          setConnectedPlugins(pluginKeys);
          
          console.log('Connected plugins found:', pluginKeys);
          
          const details = {};
          pluginData.forEach(connection => {
            details[connection.plugin_key] = {
              username: connection.username || connection.email,
              email: connection.email,
              connectedAt: connection.connected_at || connection.created_at,
              lastUsed: connection.last_used,
              status: connection.status,
              profileData: connection.profile_data,
              ...connection
            };
          });
          setConnectionDetails(details);
        }
      } catch (err) {
        console.error('Error fetching connected plugins:', err);
      }
    };

    fetchConnectedPlugins();
  }, [user]);

  // Generate plan when prompt changes (but only if no plan exists yet or prompt significantly changed)
  useEffect(() => {
    const shouldGenerate = data.userPrompt && 
                          data.userPrompt.trim().length > 10 && 
                          !hasGeneratedPlan && 
                          !isGenerating &&
                          !isAutoGeneratingRef.current &&
                          lastPromptRef.current !== data.userPrompt;

    console.log('🔍 Auto-generation check:', {
      hasPrompt: !!data.userPrompt,
      promptLength: data.userPrompt?.trim().length,
      hasGeneratedPlan,
      isGenerating,
      isAutoGenerating: isAutoGeneratingRef.current,
      promptChanged: lastPromptRef.current !== data.userPrompt,
      shouldGenerate,
      connectedPluginsCount: connectedPlugins.length
    });

    if (shouldGenerate) {
      console.log('🚀 Auto-generating plan for new prompt');
      lastPromptRef.current = data.userPrompt;
      isAutoGeneratingRef.current = true;
      
      generatePlan().finally(() => {
        isAutoGeneratingRef.current = false;
      });
    } else if (!data.userPrompt || data.userPrompt.trim().length <= 10) {
      // Reset state if prompt becomes invalid
      setGeneratedPlan(null);
      setAcceptedPlan(null);
      setError(null);
      setHasGeneratedPlan(false);
      lastPromptRef.current = '';
      isAutoGeneratingRef.current = false;
    }
  }, [data.userPrompt, hasGeneratedPlan, isGenerating, connectedPlugins]);

  // Update editable arrays when plan changes - use accepted plan if available
  useEffect(() => {
    const currentPlan = acceptedPlan || generatedPlan;
    if (currentPlan) {
      console.log('🔄 Updating editable arrays from:', acceptedPlan ? 'accepted plan' : 'generated plan');
      setEditableSteps([...currentPlan.steps]);
      
      // Clean inputs - remove any that reference non-existent plugins
      const validInputs = currentPlan.requiredInputs.filter(input => {
        const relatedStep = currentPlan.steps.find(step => 
          input.name?.toLowerCase().includes(step.pluginName.toLowerCase()) ||
          step.pluginName.toLowerCase().includes(input.name?.toLowerCase()?.split(' ')[0] || '')
        );
        return relatedStep || !input.name?.toLowerCase().includes('plugin');
      });
      setEditableInputs(validInputs);
      
      // Clean outputs - remove any that reference non-existent plugins
      const validOutputs = currentPlan.outputs.filter(output => {
        const relatedStep = currentPlan.steps.find(step => step.pluginKey === output.pluginKey);
        return relatedStep || output.pluginKey === 'system' || !output.pluginKey;
      });
      setEditableOutputs(validOutputs);
      
      console.log('Cleaned up data:', {
        originalInputs: currentPlan.requiredInputs.length,
        validInputs: validInputs.length,
        originalOutputs: currentPlan.outputs.length,
        validOutputs: validOutputs.length
      });
    }
  }, [generatedPlan, acceptedPlan]);

  // Auto-dismiss notifications after 10 seconds
  useEffect(() => {
    Object.keys(pluginNotifications).forEach(pluginKey => {
      const notification = pluginNotifications[pluginKey];
      if (notification.showNotification && !notification.isGenerating) {
        const timer = setTimeout(() => {
          setPluginNotifications(prev => ({
            ...prev,
            [pluginKey]: { ...prev[pluginKey], showNotification: false }
          }));
        }, 10000);
        
        return () => clearTimeout(timer);
      }
    });
  }, [pluginNotifications]);

  // Generate plan function with comprehensive debugging
  const generatePlan = async () => {
    setIsGenerating(true);
    setError(null);
    
    try {
      console.log('=== GENERATION START DEBUG ===');
      console.log('Call type:', hasGeneratedPlan ? 'REGENERATION' : 'FIRST_GENERATION');
      console.log('User prompt:', data.userPrompt);
      console.log('Prompt length:', data.userPrompt?.length);
      console.log('Connected plugins:', connectedPlugins);
      console.log('Connected plugins length:', connectedPlugins.length);
      console.log('User ID:', user?.id);
      console.log('Has generated plan flag:', hasGeneratedPlan);
      console.log('generateAgentPlan function type:', typeof generateAgentPlan);
      
      const plan = await generateAgentPlan(data.userPrompt, connectedPlugins, user?.id);
      
      console.log('=== API RESPONSE DEBUG ===');
      console.log('Raw plan response:', plan);
      console.log('Plan type:', typeof plan);
      console.log('Plan has steps:', !!plan?.steps);
      console.log('Steps array:', plan?.steps);
      console.log('Steps length:', plan?.steps?.length);
      console.log('Required inputs length:', plan?.requiredInputs?.length);
      console.log('Outputs length:', plan?.outputs?.length);
      
      // Check for empty or invalid response
      if (!plan) {
        console.error('❌ API returned null/undefined response');
        throw new Error('API returned null/undefined response');
      }
      
      if (!plan.steps || !Array.isArray(plan.steps)) {
        console.error('❌ Invalid steps array:', plan.steps);
        throw new Error('API response missing valid steps array');
      }
      
      if (plan.steps.length === 0) {
        console.error('❌ Empty steps array returned');
        throw new Error('No workflow steps generated. Try being more specific about your automation goals.');
      }
      
      // Recalculate connection status
      const requiredPlugins = plan.steps.map(step => step.pluginKey);
      
      // Correctly identify truly unconnected plugins (exclude system plugins)
      const actuallyUnconnected = requiredPlugins.filter(pluginKey => {
        const isSystemPlugin = SYSTEM_PLUGINS.includes(pluginKey);
        const isConnectedDirectly = connectedPlugins.includes(pluginKey);
        
        // Only mark as unconnected if it's NOT a system plugin AND NOT connected
        const shouldBeMarkedUnconnected = !isSystemPlugin && !isConnectedDirectly;
        
        console.log(`Plugin ${pluginKey}:`, {
          isSystemPlugin,
          isConnected: isConnectedDirectly,
          shouldBeMarkedUnconnected
        });
        
        return shouldBeMarkedUnconnected;
      });
      
      // Check for missing plugins (not available in plugin list, excluding system plugins)
      const missingPlugins = requiredPlugins.filter(pluginKey => {
        const isSystemPlugin = SYSTEM_PLUGINS.includes(pluginKey);
        if (isSystemPlugin) return false; // System plugins are never missing
        
        const plugin = getPluginByKey(pluginKey);
        return !plugin;
      });
      
      const correctedPlan = {
        ...plan,
        unconnectedPlugins: actuallyUnconnected,
        missingPlugins: missingPlugins
      };
      
      console.log('=== FINAL RESULTS ===');
      console.log('Required plugins:', requiredPlugins);
      console.log('System plugins detected:', requiredPlugins.filter(p => SYSTEM_PLUGINS.includes(p)));
      console.log('Actually unconnected:', actuallyUnconnected);
      console.log('Missing plugins:', missingPlugins);
      console.log('Final corrected plan:', correctedPlan);
      
      setGeneratedPlan(correctedPlan);
      setAcceptedPlan(null); // Clear accepted plan when generating new
      setHasGeneratedPlan(true);
      
      onUpdate({
        generatedPlan: correctedPlan,
        suggestedPlugins: correctedPlan.steps ? correctedPlan.steps.reduce((acc, step) => {
          acc[step.pluginKey] = true;
          return acc;
        }, {} as Record<string, boolean>) : {},
        suggestedInputs: correctedPlan.requiredInputs || [],
        suggestedOutputs: correctedPlan.outputs || []
      });

      if (onValidationChange) {
        const isValid = correctedPlan.steps.length > 0 && correctedPlan.missingPlugins.length === 0;
        let errorMsg: string | undefined;
        
        if (correctedPlan.missingPlugins.length > 0) {
          errorMsg = `Missing plugins not available in system: ${correctedPlan.missingPlugins.join(', ')}`;
        } else if (correctedPlan.steps.length === 0) {
          errorMsg = 'No workflow steps generated';
        }
        
        onValidationChange(isValid, errorMsg);
      }
      
    } catch (err: any) {
      console.error('=== GENERATION ERROR ===');
      console.error('Error type:', typeof err);
      console.error('Error message:', err.message);
      console.error('Error stack:', err.stack);
      console.error('Full error object:', err);
      
      const errorMessage = err.message || 'Failed to generate workflow plan';
      setError(errorMessage);
      
      if (onValidationChange) {
        onValidationChange(false, errorMessage);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  // Manual regenerate function that resets the flag and generates fresh
  const regeneratePlan = async () => {
    console.log('🔄 regeneratePlan() called - MANUAL regeneration...');
    console.log('Resetting hasGeneratedPlan flag from:', hasGeneratedPlan, 'to false');
    setHasGeneratedPlan(false);
    setGeneratedPlan(null);
    setAcceptedPlan(null); // Clear accepted plan when regenerating
    setError(null);
    isAutoGeneratingRef.current = false;
    await generatePlan();
  };

  // Store accepted plan when plan is accepted
  const markPlanAsAccepted = (plan: GeneratedPlan) => {
    console.log('🔄 Marking plan as accepted and storing it');
    setAcceptedPlan(plan);
    // Update the current displayed plan to the accepted version
    setGeneratedPlan(plan);
  };

  // Generate AI configuration for newly added plugin
  const generatePluginConfiguration = async (pluginKey: string, existingSteps: PluginStep[]) => {
    try {
      // Create context about existing workflow
      const workflowContext = {
        userPrompt: data.userPrompt,
        existingSteps: existingSteps.map(step => ({
          pluginName: step.pluginName,
          phase: step.phase,
          action: step.action
        })),
        newPluginKey: pluginKey
      };

      // Use existing generateAgentPlan function but focused on single plugin
      const singlePluginPrompt = `Given this workflow: "${data.userPrompt}". 
      The user just added ${pluginKey} plugin. 
      Existing steps: ${existingSteps.map(s => s.pluginName).join(', ')}.
      Generate only the input/output configuration needed for the ${pluginKey} plugin.`;

      const partialPlan = await generateAgentPlan(singlePluginPrompt, connectedPlugins, user?.id);
      
      // Filter only inputs/outputs related to the new plugin
      const plugin = getPluginByKey(pluginKey);
      const pluginName = plugin?.name || pluginKey;
      
      const relatedInputs = partialPlan.requiredInputs.filter(input => 
        input.name?.toLowerCase().includes(pluginName.toLowerCase()) ||
        input.name?.toLowerCase().includes(pluginKey.toLowerCase()) ||
        input.pluginKey === pluginKey
      );

      const relatedOutputs = partialPlan.outputs.filter(output => 
        output.pluginKey === pluginKey ||
        (output.type || output.name || '').toLowerCase().includes(pluginName.toLowerCase())
      );

      return {
        inputs: relatedInputs,
        outputs: relatedOutputs
      };
    } catch (err) {
      console.error('Error generating plugin configuration:', err);
      return { inputs: [], outputs: [] };
    }
  };

  // Helper functions for filtering data by phase
  const getStepsByPhase = (phase: 'input' | 'process' | 'output') => {
    const steps = isEditing ? editableSteps : (generatedPlan?.steps || []);
    return steps.filter(step => step.phase === phase);
  };

  const getInputsByPhase = (phase: 'input' | 'process' | 'output') => {
    const inputs = isEditing ? editableInputs : (generatedPlan?.requiredInputs || []);
    
    return inputs.filter(input => {
      if (input.phase) {
        return input.phase === phase;
      }
      
      const steps = isEditing ? editableSteps : (generatedPlan?.steps || []);
      const relatedStep = steps.find(step => 
        input.name.toLowerCase().includes(step.pluginName.toLowerCase()) ||
        step.pluginName.toLowerCase().includes(input.name.toLowerCase().split(' ')[0])
      );
      
      const inputKeywords = ['search', 'filter', 'query', 'time range', 'source', 'fetch', 'retrieve'];
      const processKeywords = ['analysis', 'focus', 'transform', 'calculate', 'process'];
      const outputKeywords = ['recipient', 'folder', 'phone', 'alert', 'report', 'widget', 'log', 'send', 'save', 'notify'];
      
      const inputName = input.name.toLowerCase();
      
      const isInputRelated = relatedStep?.phase === 'input' || 
                           inputKeywords.some(keyword => inputName.includes(keyword)) ||
                           inputName.includes('new input');
      
      const isProcessRelated = relatedStep?.phase === 'process' || 
                             processKeywords.some(keyword => inputName.includes(keyword)) ||
                             inputName.includes('new process');
      
      const isOutputRelated = relatedStep?.phase === 'output' || 
                            outputKeywords.some(keyword => inputName.includes(keyword)) ||
                            inputName.includes('new output');
      
      if (phase === 'input') {
        return isInputRelated;
      } else if (phase === 'process') {
        return isProcessRelated;
      } else {
        return isOutputRelated || (!isInputRelated && !isProcessRelated);
      }
    });
  };

  const getOutputsByPhase = (phase: 'input' | 'process' | 'output') => {
    const outputs = isEditing ? editableOutputs : (generatedPlan?.outputs || []);
    
    return outputs.filter(output => {
      if (output.phase) {
        return output.phase === phase;
      }
      
      const outputType = output.type?.toLowerCase() || '';
      const pluginKey = output.pluginKey?.toLowerCase() || '';
      
      const isInputRelated = pluginKey.includes('input') || outputType.includes('input');
      const isProcessRelated = pluginKey.includes('process') || outputType.includes('process');
      const isOutputRelated = pluginKey.includes('output') || outputType.includes('output') || 
                            outputType.includes('report') || outputType.includes('alert') || 
                            outputType.includes('notification') || outputType.includes('dashboard');
      
      if (phase === 'input') {
        return isInputRelated;
      } else if (phase === 'process') {
        return isProcessRelated;
      } else {
        return isOutputRelated || (!isInputRelated && !isProcessRelated);
      }
    });
  };

  // Plugin connection helpers
  const isConnected = (pluginKey: string) => {
    if (SYSTEM_PLUGINS.includes(pluginKey)) {
      return true;
    }
    return connectedPlugins.includes(pluginKey);
  };

  const getPluginConnection = (pluginKey: string) => {
    return connectionDetails[pluginKey] || null;
  };

  return {
    // State
    generatedPlan,
    acceptedPlan,
    isGenerating,
    error,
    showAnalysisDetails,
    isEditing,
    viewMode,
    editableSteps,
    editableInputs,
    editableOutputs,
    connectedPlugins,
    connectionDetails,
    showRemoveConfirmation,
    stepToRemove,
    newlyAddedPlugins,
    pluginNotifications,
    hasGeneratedPlan,
    
    // State setters
    setGeneratedPlan,
    setIsGenerating,
    setError,
    setShowAnalysisDetails,
    setIsEditing,
    setViewMode,
    setEditableSteps,
    setEditableInputs,
    setEditableOutputs,
    setConnectedPlugins,
    setConnectionDetails,
    setShowRemoveConfirmation,
    setStepToRemove,
    setNewlyAddedPlugins,
    setPluginNotifications,
    setHasGeneratedPlan,
    
    // Functions
    generatePlan,
    regeneratePlan,
    markPlanAsAccepted,
    generatePluginConfiguration,
    getStepsByPhase,
    getInputsByPhase,
    getOutputsByPhase,
    isConnected,
    getPluginConnection,
    
    // User data
    user
  };
}
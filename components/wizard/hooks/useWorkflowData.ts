import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  const [acceptedPlan, setAcceptedPlan] = useState<GeneratedPlan | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAnalysisDetails, setShowAnalysisDetails] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [viewMode, setViewMode] = useState<'business' | 'technical'>('business');
  
  // Track if plan has been generated to prevent auto-regeneration
  const [hasGeneratedPlan, setHasGeneratedPlan] = useState(!!data.generatedPlan);
  const lastPromptRef = useRef<string>('');
  const isAutoGeneratingRef = useRef(false);
  const lastProcessedPlanRef = useRef<string>('');
  
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

  // FIXED: Stable values with proper memoization
  const stableUserPrompt = useMemo(() => data.userPrompt, [data.userPrompt]);

  // Initialize from existing plan data - check for accepted plan first  
  useEffect(() => {
    if (data.planAccepted && data.workflowSteps && data.workflowSteps.length > 0) {
      console.log('Initializing from accepted plan data');
      const reconstructedAcceptedPlan = {
        steps: data.workflowSteps,
        requiredInputs: data.inputSchema || [],
        outputs: data.outputSchema || [],
        reasoning: data.systemPrompt || '',
        confidence: 85,
        missingPlugins: [],
        unconnectedPlugins: []
      };
      
      // Only update if different
      setAcceptedPlan(prev => 
        JSON.stringify(prev) !== JSON.stringify(reconstructedAcceptedPlan) 
          ? reconstructedAcceptedPlan 
          : prev
      );
      setGeneratedPlan(prev => 
        JSON.stringify(prev) !== JSON.stringify(reconstructedAcceptedPlan) 
          ? reconstructedAcceptedPlan 
          : prev
      );
      
      if (!hasGeneratedPlan) {
        setHasGeneratedPlan(true);
      }
      
      if (lastPromptRef.current !== data.userPrompt) {
        lastPromptRef.current = data.userPrompt;
      }
    } else if (data.generatedPlan && !generatedPlan) {
      console.log('Initializing from original plan data');
      setGeneratedPlan(data.generatedPlan);
      
      if (!hasGeneratedPlan) {
        setHasGeneratedPlan(true);
      }
      
      if (lastPromptRef.current !== data.userPrompt) {
        lastPromptRef.current = data.userPrompt;
      }
    }
  }, [data.generatedPlan, data.planAccepted, data.workflowSteps, data.inputSchema, data.outputSchema, data.userPrompt, data.systemPrompt]);

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
          
          // Only update if different
          setConnectedPlugins(prev => 
            JSON.stringify(prev.sort()) !== JSON.stringify(pluginKeys.sort()) 
              ? pluginKeys 
              : prev
          );
          
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
          
          // Only update if different
          setConnectionDetails(prev => 
            JSON.stringify(prev) !== JSON.stringify(details) 
              ? details 
              : prev
          );
        }
      } catch (err) {
        console.error('Error fetching connected plugins:', err);
      }
    };

    fetchConnectedPlugins();
  }, [user?.id]);

  // FIXED: Generate plan when prompt changes - simplified dependencies
  useEffect(() => {
    const shouldGenerate = stableUserPrompt && 
                          stableUserPrompt.trim().length > 10 && 
                          !hasGeneratedPlan && 
                          !isGenerating &&
                          !isAutoGeneratingRef.current &&
                          lastPromptRef.current !== stableUserPrompt;

    if (shouldGenerate) {
      console.log('Auto-generating plan for new prompt');
      lastPromptRef.current = stableUserPrompt;
      isAutoGeneratingRef.current = true;
      
      (async () => {
        setIsGenerating(true);
        setError(null);
        
        try {
          const plan = await generateAgentPlan(stableUserPrompt, connectedPlugins, user?.id);
          
          if (!plan?.steps || plan.steps.length === 0) {
            throw new Error('No workflow steps generated');
          }
          
          const requiredPlugins = plan.steps.map(step => step.pluginKey);
          const actuallyUnconnected = requiredPlugins.filter(pluginKey => 
            !SYSTEM_PLUGINS.includes(pluginKey) && !connectedPlugins.includes(pluginKey)
          );
          const missingPlugins = requiredPlugins.filter(pluginKey => 
            !SYSTEM_PLUGINS.includes(pluginKey) && !getPluginByKey(pluginKey)
          );
          
          const correctedPlan = { ...plan, unconnectedPlugins: actuallyUnconnected, missingPlugins };
          
          setGeneratedPlan(correctedPlan);
          setAcceptedPlan(null);
          setHasGeneratedPlan(true);
          
          // Use setTimeout to break out of render cycle
          setTimeout(() => {
            onUpdate({
              generatedPlan: correctedPlan,
              suggestedPlugins: correctedPlan.steps.reduce((acc, step) => ({ ...acc, [step.pluginKey]: true }), {}),
              suggestedInputs: correctedPlan.requiredInputs || [],
              suggestedOutputs: correctedPlan.outputs || []
            });
            
            if (onValidationChange) {
              const isValid = correctedPlan.steps.length > 0 && correctedPlan.missingPlugins.length === 0;
              onValidationChange(isValid, correctedPlan.missingPlugins.length > 0 ? `Missing plugins: ${correctedPlan.missingPlugins.join(', ')}` : undefined);
            }
          }, 0);
          
        } catch (err) {
          setError(err.message || 'Failed to generate workflow plan');
          setTimeout(() => onValidationChange?.(false, err.message), 0);
        } finally {
          setIsGenerating(false);
          isAutoGeneratingRef.current = false;
        }
      })();
    } else if (!stableUserPrompt || stableUserPrompt.trim().length <= 10) {
      // Reset state when prompt becomes invalid
      if (generatedPlan || acceptedPlan || error || hasGeneratedPlan) {
        setGeneratedPlan(null);
        setAcceptedPlan(null);
        setError(null);
        setHasGeneratedPlan(false);
      }
      lastPromptRef.current = '';
      isAutoGeneratingRef.current = false;
    }
  }, [stableUserPrompt, hasGeneratedPlan, isGenerating]); 
  // REMOVED connectedPlugins and user?.id to prevent circular updates

  // FIXED: Dynamic relationship establishment with better change detection
  useEffect(() => {
    const currentPlan = acceptedPlan || generatedPlan;
    if (!currentPlan?.steps?.length) return;

    // Create a stable signature for the plan
    const planSignature = JSON.stringify({
      steps: currentPlan.steps.length,
      inputs: currentPlan.requiredInputs?.length || 0,
      outputs: currentPlan.outputs?.length || 0,
      stepsIds: currentPlan.steps.map(s => s.id).sort()
    });
    
    if (lastProcessedPlanRef.current === planSignature) {
      return;
    }

    // Process inputs to establish relationships
    const correctedInputs = currentPlan.requiredInputs?.map(input => {
      if (input.pluginKey || input.relatedStepId || input.phase) {
        return input;
      }
      
      const owningStep = currentPlan.steps.find(step => {
        const plugin = getPluginByKey(step.pluginKey);
        return plugin?.inputSchema?.some(schema => 
          schema.name === input.name || schema.key === input.name
        ) || plugin?.requiredInputs?.includes(input.name);
      });
      
      return owningStep ? { ...input, pluginKey: owningStep.pluginKey, relatedStepId: owningStep.id } : input;
    }) || [];
    
    // Only update if actually different
    const needsInputUpdate = JSON.stringify(correctedInputs) !== JSON.stringify(currentPlan.requiredInputs);
    if (needsInputUpdate) {
      const correctedPlan = { ...currentPlan, requiredInputs: correctedInputs };
      
      if (acceptedPlan) {
        setAcceptedPlan(correctedPlan);
      } else {
        setGeneratedPlan(correctedPlan);
      }
    }

    // Update editable arrays only if different - use functional updates to prevent issues
    setEditableSteps(prev => {
      const newSteps = [...currentPlan.steps];
      return JSON.stringify(prev) !== JSON.stringify(newSteps) ? newSteps : prev;
    });
    
    const validInputs = correctedInputs.filter(input => 
      !input.pluginKey || currentPlan.steps.some(step => step.pluginKey === input.pluginKey)
    );
    
    setEditableInputs(prev => {
      return JSON.stringify(prev) !== JSON.stringify(validInputs) ? validInputs : prev;
    });
    
    const validOutputs = (currentPlan.outputs || []).filter(output => 
      !output.pluginKey || currentPlan.steps.some(step => step.pluginKey === output.pluginKey) || output.pluginKey === 'system'
    );
    
    setEditableOutputs(prev => {
      return JSON.stringify(prev) !== JSON.stringify(validOutputs) ? validOutputs : prev;
    });

    lastProcessedPlanRef.current = planSignature;
  }, [generatedPlan, acceptedPlan]); // Only these two dependencies

  // Auto-dismiss notifications after 10 seconds
  useEffect(() => {
    const timers: NodeJS.Timeout[] = [];
    
    Object.keys(pluginNotifications).forEach(pluginKey => {
      const notification = pluginNotifications[pluginKey];
      if (notification.showNotification && !notification.isGenerating) {
        const timer = setTimeout(() => {
          setPluginNotifications(prev => ({
            ...prev,
            [pluginKey]: { ...prev[pluginKey], showNotification: false }
          }));
        }, 10000);
        
        timers.push(timer);
      }
    });

    return () => {
      timers.forEach(timer => clearTimeout(timer));
    };
  }, [pluginNotifications]);

  // MEMOIZED functions to prevent recreation
  const regeneratePlan = useCallback(async () => {
    console.log('Regenerating plan...');
    setHasGeneratedPlan(false);
    setGeneratedPlan(null);
    setAcceptedPlan(null);
    setError(null);
    isAutoGeneratingRef.current = false;
    lastProcessedPlanRef.current = '';
    lastPromptRef.current = ''; // This will trigger the useEffect to regenerate
  }, []);

  const markPlanAsAccepted = useCallback((plan: GeneratedPlan) => {
    setAcceptedPlan(plan);
    setGeneratedPlan(plan);
  }, []);

  const generatePluginConfiguration = useCallback(async (pluginKey: string, existingSteps: PluginStep[]) => {
    try {
      const singlePluginPrompt = `Given this workflow: "${stableUserPrompt}". 
      The user just added ${pluginKey} plugin. 
      Existing steps: ${existingSteps.map(s => s.pluginName).join(', ')}.
      Generate only the input/output configuration needed for the ${pluginKey} plugin.`;

      const partialPlan = await generateAgentPlan(singlePluginPrompt, connectedPlugins, user?.id);
      
      const relatedInputs = partialPlan.requiredInputs.filter(input => 
        input.pluginKey === pluginKey ||
        input.relatedStepId === existingSteps.find(s => s.pluginKey === pluginKey)?.id
      );

      const relatedOutputs = partialPlan.outputs.filter(output => 
        output.pluginKey === pluginKey ||
        output.relatedStepId === existingSteps.find(s => s.pluginKey === pluginKey)?.id
      );

      return {
        inputs: relatedInputs,
        outputs: relatedOutputs
      };
    } catch (err) {
      console.error('Error generating plugin configuration:', err);
      return { inputs: [], outputs: [] };
    }
  }, [stableUserPrompt, connectedPlugins, user?.id]);

  // Helper functions for filtering data by phase - MEMOIZED to prevent recreation
  const getStepsByPhase = useCallback((phase: 'input' | 'process' | 'output') => {
    const steps = isEditing ? editableSteps : (generatedPlan?.steps || []);
    return steps.filter(step => step.phase === phase);
  }, [isEditing, editableSteps, generatedPlan?.steps]);

  // MEMOIZED phase-based input filtering
  const getInputsByPhase = useCallback((phase: 'input' | 'process' | 'output') => {
    const inputs = isEditing ? editableInputs : (generatedPlan?.requiredInputs || []);
    const steps = isEditing ? editableSteps : (generatedPlan?.steps || []);
    
    return inputs.filter(input => {
      // PRIORITY 1: Direct phase assignment (most reliable)
      if (input.phase === phase) {
        return true;
      }
      
      // PRIORITY 2: Check related step ID (direct relationship)
      if (input.relatedStepId) {
        const relatedStep = steps.find(step => step.id === input.relatedStepId);
        if (relatedStep) {
          return relatedStep.phase === phase;
        }
      }
      
      // PRIORITY 3: Check plugin key relationship with steps in the requested phase
      if (input.pluginKey) {
        const relatedStepsInPhase = steps.filter(step => 
          step.pluginKey === input.pluginKey && step.phase === phase
        );
        
        if (relatedStepsInPhase.length > 0) {
          const plugin = getPluginByKey(input.pluginKey);
          
          if (plugin?.inputSchema) {
            const inputSchemaDefinition = plugin.inputSchema.find(schema => 
              schema.name === input.name || 
              schema.key === input.name ||
              schema.field === input.name
            );
            
            if (inputSchemaDefinition?.phase === phase) {
              return true;
            }
            
            // Authentication/connection inputs belong to INPUT phase
            const inputPurpose = inputSchemaDefinition?.purpose || inputSchemaDefinition?.category;
            if (inputPurpose === 'authentication' || 
                inputPurpose === 'connection' || 
                inputPurpose === 'credentials' ||
                inputSchemaDefinition?.isAuthentication || 
                inputSchemaDefinition?.isConnection) {
              return phase === 'input';
            }
            
            // Output-specific configuration belongs to OUTPUT phase
            if (inputPurpose === 'output-config' ||
                inputPurpose === 'delivery' ||
                input.name.toLowerCase().includes('destination') ||
                input.name.toLowerCase().includes('format') ||
                input.name.toLowerCase().includes('output')) {
              return phase === 'output';
            }
          }
          
          return true;
        }
      }
      
      // PRIORITY 4: Semantic analysis
      const inputNameLower = (input.name || '').toLowerCase();
      const inputDescLower = (input.description || '').toLowerCase();
      
      const isOutputRelated = inputNameLower.includes('destination') ||
                             inputNameLower.includes('format') ||
                             inputNameLower.includes('output') ||
                             inputNameLower.includes('delivery') ||
                             inputDescLower.includes('output format') ||
                             inputDescLower.includes('destination');
      
      if (isOutputRelated && phase === 'output') return true;
      
      const isInputRelated = inputNameLower.includes('search') ||
                            inputNameLower.includes('query') ||
                            inputNameLower.includes('source') ||
                            inputNameLower.includes('auth') ||
                            inputDescLower.includes('search for') ||
                            inputDescLower.includes('data source');
      
      if (isInputRelated && phase === 'input') return true;
      
      // Default assignment for orphaned inputs
      if (phase === 'input' && 
          !input.phase && 
          !input.relatedStepId && 
          !input.pluginKey &&
          !isOutputRelated) {
        return true;
      }
      
      return false;
    });
  }, [isEditing, editableInputs, editableSteps, generatedPlan?.requiredInputs, generatedPlan?.steps]);

  const getOutputsByPhase = useCallback((phase: 'input' | 'process' | 'output') => {
    const outputs = isEditing ? editableOutputs : (generatedPlan?.outputs || []);
    const steps = isEditing ? editableSteps : (generatedPlan?.steps || []);
    
    return outputs.filter(output => {
      if (output.phase) return output.phase === phase;
      
      if (output.relatedStepId) {
        const relatedStep = steps.find(step => step.id === output.relatedStepId);
        if (relatedStep) return relatedStep.phase === phase;
      }
      
      if (output.pluginKey) {
        const relatedStep = steps.find(step => step.pluginKey === output.pluginKey);
        if (relatedStep) return relatedStep.phase === phase;
      }
      
      return phase === 'output'; // Default to output phase
    });
  }, [isEditing, editableOutputs, editableSteps, generatedPlan?.outputs, generatedPlan?.steps]);

  // Plugin connection helpers - MEMOIZED
  const isConnected = useCallback((pluginKey: string) => {
    if (SYSTEM_PLUGINS.includes(pluginKey)) return true;
    return connectedPlugins.includes(pluginKey);
  }, [connectedPlugins]);

  const getPluginConnection = useCallback((pluginKey: string) => {
    return connectionDetails[pluginKey] || null;
  }, [connectionDetails]);

  // Schema helper functions - MEMOIZED
  const hasInputSchema = useCallback(() => {
    const currentPlan = acceptedPlan || generatedPlan;
    const hasExplicitSchema = currentPlan?.inputSchema && currentPlan.inputSchema.length > 0;
    
    const stepsCanWorkWithPromptOnly = currentPlan?.steps?.every(step => {
      const plugin = getPluginByKey(step.pluginKey);
      return plugin?.acceptsTextInput || plugin?.inputSchema?.length === 0 || step.phase !== 'input';
    });
    
    return hasExplicitSchema || stepsCanWorkWithPromptOnly;
  }, [acceptedPlan, generatedPlan]);

  const hasInputSteps = useCallback(() => {
    return getStepsByPhase('input').length > 0;
  }, [getStepsByPhase]);

  const getInputPhaseType = useCallback(() => {
    const currentPlan = acceptedPlan || generatedPlan;
    const hasExplicitSchema = currentPlan?.inputSchema && currentPlan.inputSchema.length > 0;
    
    if (hasExplicitSchema) return 'schema';
    if (hasInputSteps()) return 'plugins';
    
    const canWorkWithPromptOnly = currentPlan?.steps?.every(step => {
      const plugin = getPluginByKey(step.pluginKey);
      return plugin?.acceptsTextInput || step.phase !== 'input';
    });
    
    if (canWorkWithPromptOnly) return 'prompt';
    return 'none';
  }, [acceptedPlan, generatedPlan, hasInputSteps]);

  const shouldShowInputPhase = useCallback(() => {
    const currentPlan = acceptedPlan || generatedPlan;
    const hasExplicitSchema = currentPlan?.inputSchema && currentPlan.inputSchema.length > 0;
    
    return hasExplicitSchema || hasInputSteps() || getInputPhaseType() === 'prompt';
  }, [acceptedPlan, generatedPlan, hasInputSteps, getInputPhaseType]);

  const getInputSchema = useCallback(() => {
    const currentPlan = acceptedPlan || generatedPlan;
    return currentPlan?.inputSchema || [];
  }, [acceptedPlan, generatedPlan]);

  const getInputPhaseDisplay = useCallback(() => {
    const inputType = getInputPhaseType();
    
    switch (inputType) {
      case 'plugins':
        return {
          title: 'Input Plugins',
          description: 'Data will be collected using connected plugins',
          showSteps: true,
          showSchema: false,
          showPromptInfo: false
        };
      
      case 'schema':
        return {
          title: 'Input Schema',
          description: 'Data will be collected using defined input fields',
          showSteps: false,
          showSchema: true,
          showPromptInfo: false
        };
      
      case 'prompt':
        return {
          title: 'Topic Research',
          description: 'Workflow will use your prompt as the research topic',
          showSteps: false,
          showSchema: false,
          showPromptInfo: true,
          promptPreview: stableUserPrompt?.substring(0, 100) + (stableUserPrompt?.length > 100 ? '...' : '')
        };
      
      default:
        return {
          title: 'Input Configuration',
          description: 'No input method configured',
          showSteps: false,
          showSchema: false,
          showPromptInfo: false
        };
    }
  }, [getInputPhaseType, stableUserPrompt]);

  // DUMMY generatePlan function for compatibility
  const generatePlan = useCallback(() => {
    console.log('generatePlan called - this is handled by useEffect');
  }, []);

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
    
    // Schema-related functions
    hasInputSchema,
    hasInputSteps,
    getInputPhaseType,
    shouldShowInputPhase,
    getInputSchema,
    getInputPhaseDisplay,
    
    // User data
    user
  };
}
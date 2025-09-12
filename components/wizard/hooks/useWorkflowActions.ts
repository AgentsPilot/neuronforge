import { getPluginByKey, pluginList } from '@/lib/plugins/pluginList';
import type { PluginStep, RequiredInput, Output } from '../types';

interface UseWorkflowActionsProps {
  // State from useWorkflowData
  generatedPlan: any;
  isEditing: boolean;
  editableSteps: PluginStep[];
  editableInputs: RequiredInput[];
  editableOutputs: Output[];
  connectedPlugins: string[];
  user: any;
  data: {
    userPrompt: string;
    systemPrompt?: string;
    plugins: Record<string, any>;
  };
  
  // State setters from useWorkflowData
  setIsEditing: (value: boolean) => void;
  setEditableSteps: (value: PluginStep[] | ((prev: PluginStep[]) => PluginStep[])) => void;
  setEditableInputs: (value: RequiredInput[] | ((prev: RequiredInput[]) => RequiredInput[])) => void;
  setEditableOutputs: (value: Output[] | ((prev: Output[]) => Output[])) => void;
  setGeneratedPlan: (value: any) => void;
  setStepToRemove: (value: any) => void;
  setShowRemoveConfirmation: (value: boolean) => void;
  setNewlyAddedPlugins: (value: string[] | ((prev: string[]) => string[])) => void;
  setPluginNotifications: (value: any | ((prev: any) => any)) => void;
  
  // Functions from useWorkflowData
  generatePlan: () => void;
  regeneratePlan: () => Promise<void>;
  markPlanAsAccepted: (plan: any) => void;
  generatePluginConfiguration: (pluginKey: string, existingSteps: PluginStep[], context?: any) => Promise<{inputs: any[], outputs: any[], confidence?: number}>;
  getInputsByPhase: (phase: 'input' | 'process' | 'output') => RequiredInput[];
  getOutputsByPhase: (phase: 'input' | 'process' | 'output') => Output[];
  
  // Schema helper function
  hasInputSchema: () => boolean;
  
  // Callbacks
  onUpdate: (updates: any) => void;
}

// WORKFLOW VALIDATION: Support workflows with or without input plugins
const validateWorkflowPhases = (steps: PluginStep[], hasInputSchema?: boolean, userPrompt?: string) => {
  const phaseGroups = steps.reduce((acc, step) => {
    if (!acc[step.phase]) acc[step.phase] = 0;
    acc[step.phase]++;
    return acc;
  }, {} as Record<string, number>);
  
  const errors: string[] = [];
  
  // INPUT PHASE VALIDATION: Flexible approach
  const hasInputSteps = phaseGroups['input'] && phaseGroups['input'] > 0;
  const hasInputSchemaData = hasInputSchema && hasInputSchema();
  const canWorkWithPromptOnly = userPrompt && userPrompt.trim().length > 0;
  
  // Determine if this is a research-type workflow that doesn't need complex input
  const isSimpleResearchWorkflow = userPrompt && (
    userPrompt.toLowerCase().includes('research') ||
    userPrompt.toLowerCase().includes('analyze') ||
    userPrompt.toLowerCase().includes('find information') ||
    userPrompt.toLowerCase().includes('topic') ||
    userPrompt.toLowerCase().includes('study') ||
    userPrompt.toLowerCase().includes('investigate')
  );
  
  // Input phase is valid if ANY of these conditions are met
  const hasValidInput = hasInputSteps || 
                       hasInputSchemaData || 
                       (isSimpleResearchWorkflow && canWorkWithPromptOnly) ||
                       (phaseGroups['process'] > 0 || phaseGroups['output'] > 0);
  
  if (!hasValidInput) {
    errors.push('Workflow must have either: input plugins, input schema, or be a research-type workflow');
  }
  
  // OUTPUT PHASE: Required for all workflows
  const hasOutputSteps = phaseGroups['output'] && phaseGroups['output'] > 0;
  
  if (!hasOutputSteps) {
    errors.push('Output phase must have at least one plugin');
  }
  
  return {
    isValid: errors.length === 0,
    errors,
    phaseGroups,
    inputType: hasInputSteps ? 'plugins' : 
               hasInputSchemaData ? 'schema' : 
               isSimpleResearchWorkflow ? 'prompt' : 'none'
  };
};

// CONTEXT BUILDER: Create phase-isolated context for LLM
const buildLLMContext = (
  pluginData: any,
  userPrompt: string,
  existingSteps: PluginStep[],
  targetPhase: string,
  stepId: number
) => {
  // Analyze workflow type from user prompt
  const workflowType = determineWorkflowType(userPrompt);
  
  // Build existing workflow context - ONLY for the target phase
  const phaseSpecificSteps = existingSteps.filter(step => step.phase === targetPhase);
  const workflowContext = {
    existingStepsInPhase: phaseSpecificSteps.map(step => ({
      phase: step.phase,
      pluginName: step.pluginName,
      pluginKey: step.pluginKey,
      action: step.action,
      order: step.order
    })),
    targetPhaseOnly: targetPhase,
    stepsInThisPhase: phaseSpecificSteps.length,
    workflowType,
    phaseIsolation: true // Flag to indicate phase-specific processing
  };

  return {
    userWorkflowPrompt: userPrompt,
    targetPhase,
    stepId,
    workflowType,
    PHASE_ISOLATION: {
      targetPhaseOnly: targetPhase,
      restrictToPhase: true,
      ignoreOtherPhases: true,
      instructions: `CRITICAL: Only generate content for the ${targetPhase.toUpperCase()} phase. Content MUST stay in the ${targetPhase} phase.`
    },
    pluginInformation: {
      key: pluginData.pluginKey,
      name: pluginData.name,
      description: pluginData.description,
      detailedDescription: pluginData.detailedDescription,
      category: pluginData.category,
      capabilities: pluginData.capabilities || [],
      tags: pluginData.tags || [],
      // Include any existing schema as reference (not replacement)
      existingSchema: {
        inputs: pluginData.inputSchema || pluginData.inputs || null,
        outputs: pluginData.outputSchema || pluginData.outputs || null,
        parameters: pluginData.parameters || null
      }
    },
    workflowContext,
    requirements: {
      // Phase-specific requirements only
      phaseSpecificInputTypes: getExpectedInputTypes(workflowType, targetPhase),
      phaseSpecificOutputTypes: getExpectedOutputTypes(workflowType, targetPhase),
      authenticationNeeded: determineAuthenticationNeeds(pluginData, targetPhase),
      dataFlowRequirements: analyzeDataFlow(existingSteps, targetPhase)
    }
  };
};

// HELPER: Determine workflow type from user prompt
const determineWorkflowType = (userPrompt: string): string => {
  const prompt = userPrompt.toLowerCase();
  
  if (prompt.includes('research') || prompt.includes('analyze') || prompt.includes('study')) {
    return 'research';
  } else if (prompt.includes('automate') || prompt.includes('process') || prompt.includes('manage')) {
    return 'automation';
  } else if (prompt.includes('report') || prompt.includes('summary') || prompt.includes('dashboard')) {
    return 'reporting';
  } else if (prompt.includes('integrate') || prompt.includes('sync') || prompt.includes('connect')) {
    return 'integration';
  } else if (prompt.includes('notification') || prompt.includes('alert') || prompt.includes('monitor')) {
    return 'monitoring';
  } else if (prompt.includes('backup') || prompt.includes('save') || prompt.includes('store')) {
    return 'data_management';
  }
  
  return 'general';
};

// HELPER: Get expected input types based on workflow and phase
const getExpectedInputTypes = (workflowType: string, phase: string): string[] => {
  const baseTypes = {
    research: ['search_query', 'topic', 'keywords', 'sources', 'filters'],
    automation: ['trigger_conditions', 'schedule', 'criteria', 'parameters'],
    reporting: ['data_source', 'time_range', 'metrics', 'format_preferences'],
    integration: ['source_system', 'destination_system', 'mapping_rules', 'sync_frequency'],
    monitoring: ['thresholds', 'conditions', 'alert_recipients', 'frequency'],
    data_management: ['source_location', 'backup_destination', 'retention_policy', 'file_types'],
    general: ['configuration', 'parameters', 'settings', 'preferences']
  };

  const phaseSpecific = {
    input: ['authentication', 'credentials', 'connection_details', 'access_tokens'],
    process: ['transformation_rules', 'processing_options', 'filters', 'conditions'],
    output: ['destination', 'format', 'delivery_method', 'recipients']
  };

  return [
    ...(baseTypes[workflowType] || baseTypes.general),
    ...(phaseSpecific[phase] || [])
  ];
};

// HELPER: Get expected output types based on workflow and phase
const getExpectedOutputTypes = (workflowType: string, phase: string): string[] => {
  const baseTypes = {
    research: ['research_results', 'data_summary', 'insights', 'recommendations'],
    automation: ['execution_status', 'results', 'logs', 'next_actions'],
    reporting: ['report_data', 'visualizations', 'metrics', 'analysis'],
    integration: ['sync_status', 'transferred_data', 'error_logs', 'mapping_results'],
    monitoring: ['alert_status', 'notifications', 'status_updates', 'metrics'],
    data_management: ['backup_status', 'stored_data', 'file_locations', 'operation_logs'],
    general: ['processed_data', 'results', 'status', 'output_data']
  };

  const phaseSpecific = {
    input: ['collected_data', 'fetched_information', 'raw_data'],
    process: ['transformed_data', 'processed_results', 'intermediate_data'],
    output: ['final_deliverable', 'formatted_output', 'delivered_content', 'completion_status']
  };

  return [
    ...(baseTypes[workflowType] || baseTypes.general),
    ...(phaseSpecific[phase] || [])
  ];
};

// HELPER: Determine if authentication is needed
const determineAuthenticationNeeds = (pluginData: any, phase: string): boolean => {
  const description = (pluginData.description || '').toLowerCase();
  const detailedDescription = (pluginData.detailedDescription || '').toLowerCase();
  const category = (pluginData.category || '').toLowerCase();
  
  // Check for authentication keywords
  const authKeywords = ['api', 'access', 'connect', 'login', 'authenticate', 'credentials', 'token'];
  const needsAuth = authKeywords.some(keyword => 
    description.includes(keyword) || 
    detailedDescription.includes(keyword) ||
    category.includes(keyword)
  );
  
  // Authentication is typically needed for input phase plugins that connect to external services
  return needsAuth && phase === 'input';
};

// HELPER: Analyze data flow requirements
const analyzeDataFlow = (existingSteps: PluginStep[], targetPhase: string) => {
  const inputSteps = existingSteps.filter(s => s.phase === 'input');
  const processSteps = existingSteps.filter(s => s.phase === 'process');
  const outputSteps = existingSteps.filter(s => s.phase === 'output');
  
  return {
    expectsInputFrom: targetPhase === 'process' ? inputSteps.map(s => s.pluginKey) : [],
    providesOutputTo: targetPhase === 'input' || targetPhase === 'process' ? 
      [...processSteps, ...outputSteps].map(s => s.pluginKey) : [],
    isDataSource: targetPhase === 'input',
    isDataProcessor: targetPhase === 'process',
    isDataDestination: targetPhase === 'output'
  };
};

// HELPER: Get phase-specific instructions for LLM (enhanced with strict isolation)
const getPhaseSpecificInstructions = (phase: string): string => {
  switch (phase) {
    case 'input':
      return `CRITICAL PHASE ISOLATION: Generate ONLY inputs for the INPUT phase. This plugin is in the INPUT phase and should ONLY collect data, handle authentication, and configure connections. DO NOT generate any outputs. Content MUST remain in the INPUT phase only.`;
    
    case 'process':
      return `CRITICAL PHASE ISOLATION: Generate inputs and outputs for the PROCESS phase only. This plugin processes data, so it needs inputs for processing parameters and outputs for transformed results. Content MUST remain in the PROCESS phase only.`;
    
    case 'output':
      return `CRITICAL PHASE ISOLATION: Generate ONLY outputs for the OUTPUT phase. This plugin is in the OUTPUT phase and should ONLY produce final deliverables, reports, and results. DO NOT generate any inputs. Content MUST remain in the OUTPUT phase only.`;
    
    default:
      return 'Generate appropriate inputs and outputs based on plugin capabilities and target phase.';
  }
};

// PRIMARY LLM GENERATION: Phase-isolated generation with strict boundaries
const generateInputsOutputsWithAI = async (
  pluginKey: string,
  existingSteps: PluginStep[],
  generatePluginConfiguration: (pluginKey: string, existingSteps: PluginStep[], context?: any) => Promise<{inputs: any[], outputs: any[], confidence?: number}>,
  stepId: number,
  targetPhase: string,
  userPrompt: string,
  pluginData: any
) => {
  // TRACK FUNCTION CALLS
  const callId = `${pluginKey}-${targetPhase}-${Date.now()}`;
  console.log(`🚀 [${callId}] generateInputsOutputsWithAI CALLED for ${pluginKey} in ${targetPhase} phase`);
  
  try {
    console.log(`🤖 [${callId}] AI generation for ${pluginKey} in ${targetPhase} phase (strict phase isolation)`);
    
    // Build phase-isolated context for LLM
    const context = buildLLMContext(pluginData, userPrompt, existingSteps, targetPhase, stepId);
    
    // Add phase-specific requirements to context
    context.phaseRequirements = {
      targetPhase,
      shouldGenerateInputs: targetPhase === 'input' || targetPhase === 'process',
      shouldGenerateOutputs: targetPhase === 'process' || targetPhase === 'output',
      phaseSpecificInstructions: getPhaseSpecificInstructions(targetPhase),
      callId, // Track this specific call
      strictPhaseEnforcement: true
    };

    console.log(`📋 [${callId}] Phase requirements:`, {
      phase: targetPhase,
      generateInputs: context.phaseRequirements.shouldGenerateInputs,
      generateOutputs: context.phaseRequirements.shouldGenerateOutputs,
      strictEnforcement: true
    });

    // Call LLM with phase-specific context
    console.log(`🔄 [${callId}] About to call LLM with context for ${targetPhase} phase...`);
    const configuration = await generatePluginConfiguration(pluginKey, existingSteps, context);
    console.log(`✅ [${callId}] LLM call completed for ${targetPhase} phase`);
    
    // DEBUG: Log what the LLM actually returned
    console.log(`🔍 [${callId}] LLM Raw Response for ${targetPhase} phase:`, {
      inputsReturned: configuration.inputs?.length || 0,
      outputsReturned: configuration.outputs?.length || 0,
      shouldGenerateInputs: context.phaseRequirements.shouldGenerateInputs,
      shouldGenerateOutputs: context.phaseRequirements.shouldGenerateOutputs
    });
    
    // STRICT VALIDATION: Ignore what shouldn't be generated
    if (!context.phaseRequirements.shouldGenerateOutputs && configuration.outputs?.length > 0) {
      console.warn(`⚠️ [${callId}] LLM incorrectly generated ${configuration.outputs.length} outputs for ${targetPhase} phase - IGNORING THEM`);
      configuration.outputs = []; // Force clear outputs
    }
    
    if (!context.phaseRequirements.shouldGenerateInputs && configuration.inputs?.length > 0) {
      console.warn(`⚠️ [${callId}] LLM incorrectly generated ${configuration.inputs.length} inputs for ${targetPhase} phase - IGNORING THEM`);
      configuration.inputs = []; // Force clear inputs
    }
    
    let processedInputs = [];
    let processedOutputs = [];
    
    // STRICT PHASE ENFORCEMENT: Force all content to stay in target phase
    if (context.phaseRequirements.shouldGenerateInputs && configuration.inputs) {
      processedInputs = configuration.inputs.map(input => ({
        ...input,
        phase: targetPhase, // STRICT: All inputs MUST stay in target phase
        pluginKey,
        relatedStepId: stepId,
        source: 'ai-generated',
        confidence: input.confidence || configuration.confidence || 85,
        callId, // Track which call generated this
        phaseEnforced: true
      }));
      console.log(`✅ [${callId}] Generated ${processedInputs.length} inputs for ${targetPhase} phase (phase-enforced)`);
    } else {
      console.log(`⏭️ [${callId}] Skipping input generation for ${targetPhase} phase`);
    }

    if (context.phaseRequirements.shouldGenerateOutputs && configuration.outputs) {
      processedOutputs = configuration.outputs.map(output => ({
        ...output,
        phase: targetPhase, // STRICT: All outputs MUST stay in target phase
        pluginKey,
        relatedStepId: stepId,
        source: 'ai-generated',
        confidence: output.confidence || configuration.confidence || 85,
        callId, // Track which call generated this
        phaseEnforced: true
      }));
      console.log(`✅ [${callId}] Generated ${processedOutputs.length} outputs for ${targetPhase} phase (phase-enforced)`);
    } else {
      console.log(`⏭️ [${callId}] Skipping output generation for ${targetPhase} phase`);
    }

    // Validate AI results
    const validation = validateAIResults(processedInputs, processedOutputs, context);
    
    console.log(`🎯 [${callId}] AI generation result: ${validation.confidence}% confidence`);
    
    if (validation.confidence < 70) {
      console.warn(`⚠️ [${callId}] AI confidence low (${validation.confidence}%), but proceeding - no hardcoded fallbacks`);
    }

    return { 
      inputs: processedInputs, 
      outputs: processedOutputs,
      confidence: validation.confidence,
      source: 'ai-generated',
      validation: validation,
      phaseEnforced: true,
      callId
    };
    
  } catch (error) {
    console.error(`❌ [${callId}] AI generation failed for ${pluginKey}:`, error);
    
    // Return empty results with error info - no hardcoded fallbacks
    return {
      inputs: [],
      outputs: [],
      confidence: 0,
      source: 'ai-failed',
      error: error.message || 'Unknown error',
      callId
    };
  }
};

// VALIDATION: Ensure AI results meet quality standards
const validateAIResults = (inputs: any[], outputs: any[], context: any) => {
  let confidence = 90; // Start high
  const issues = [];
  
  // Basic validation
  if (inputs.length === 0 && outputs.length === 0) {
    confidence -= 30;
    issues.push('No inputs or outputs generated');
  }
  
  // Validate input quality
  inputs.forEach(input => {
    if (!input.name || !input.description) {
      confidence -= 10;
      issues.push(`Input missing required fields: ${input.name || 'unnamed'}`);
    }
    
    if (!input.type || input.type === 'undefined') {
      confidence -= 5;
      issues.push(`Input has invalid type: ${input.name}`);
    }
    
    // Phase enforcement validation
    if (input.phase !== context.targetPhase) {
      confidence -= 20;
      issues.push(`Input assigned to wrong phase: ${input.phase} instead of ${context.targetPhase}`);
    }
  });
  
  // Validate output quality
  outputs.forEach(output => {
    if (!output.type && !output.name) {
      confidence -= 10;
      issues.push(`Output missing identification: ${output.type || output.name || 'unnamed'}`);
    }
    
    if (!output.description) {
      confidence -= 5;
      issues.push(`Output missing description: ${output.type || output.name}`);
    }
    
    // Phase enforcement validation
    if (output.phase !== context.targetPhase) {
      confidence -= 20;
      issues.push(`Output assigned to wrong phase: ${output.phase} instead of ${context.targetPhase}`);
    }
  });
  
  // Context-based validation
  if (context) {
    const targetPhase = context.targetPhase;
    
    // Phase-specific validation
    if (targetPhase === 'input' && inputs.length === 0) {
      confidence -= 15;
      issues.push('Input phase plugin should have inputs');
    }
    
    if (targetPhase === 'output' && outputs.length === 0) {
      confidence -= 15;
      issues.push('Output phase plugin should have outputs');
    }
    
    // Strict phase enforcement check
    if (targetPhase === 'input' && outputs.length > 0) {
      confidence -= 25;
      issues.push('Input phase plugin should not generate outputs');
    }
    
    if (targetPhase === 'output' && inputs.length > 0) {
      confidence -= 25;
      issues.push('Output phase plugin should not generate inputs');
    }
  }
  
  return {
    confidence: Math.max(confidence, 0),
    issues,
    isValid: confidence >= 50 // Lower threshold since no fallbacks
  };
};

// STEP REMOVAL HELPER: Strict phase-specific cleanup (ONLY same phase)
const removeAllRelatedInputsOutputs = (
  editableInputs: RequiredInput[],
  editableOutputs: Output[],
  oldStep: PluginStep
) => {
  console.log(`🧹 Removing inputs/outputs for ${oldStep.pluginName} from ${oldStep.phase} phase ONLY (strict phase isolation)`);
  
  const shouldRemoveInput = (input: RequiredInput) => {
    // STRICT: Only remove inputs that are:
    // 1. Directly related to this step AND
    // 2. In the SAME phase as the step being removed
    const isDirectlyRelated = (input.relatedStepId === oldStep.id || input.pluginKey === oldStep.pluginKey);
    const isSamePhase = input.phase === oldStep.phase;
    const shouldRemove = isDirectlyRelated && isSamePhase;
    
    if (shouldRemove) {
      console.log(`🗑️ Removing input: "${input.name}" (phase: ${input.phase}) - same phase as deleted step`);
    } else if (isDirectlyRelated && !isSamePhase) {
      console.log(`🛡️ PROTECTING input: "${input.name}" (phase: ${input.phase}) - different phase from deleted step (${oldStep.phase})`);
    }
    
    return shouldRemove;
  };
  
  const shouldRemoveOutput = (output: Output) => {
    // STRICT: Only remove outputs that are:
    // 1. Directly related to this step AND
    // 2. In the SAME phase as the step being removed
    const isDirectlyRelated = (output.relatedStepId === oldStep.id || output.pluginKey === oldStep.pluginKey);
    const isSamePhase = output.phase === oldStep.phase;
    const shouldRemove = isDirectlyRelated && isSamePhase;
    
    if (shouldRemove) {
      console.log(`🗑️ Removing output: "${output.type || output.name}" (phase: ${output.phase}) - same phase as deleted step`);
    } else if (isDirectlyRelated && !isSamePhase) {
      console.log(`🛡️ PROTECTING output: "${output.type || output.name}" (phase: ${output.phase}) - different phase from deleted step (${oldStep.phase})`);
    }
    
    return shouldRemove;
  };
  
  const filteredInputs = editableInputs.filter(input => !shouldRemoveInput(input));
  const filteredOutputs = editableOutputs.filter(output => !shouldRemoveOutput(output));
  
  const removedInputs = editableInputs.length - filteredInputs.length;
  const removedOutputs = editableOutputs.length - filteredOutputs.length;
  const protectedInputs = editableInputs.filter(input => {
    const isRelated = (input.relatedStepId === oldStep.id || input.pluginKey === oldStep.pluginKey);
    return isRelated && input.phase !== oldStep.phase;
  }).length;
  const protectedOutputs = editableOutputs.filter(output => {
    const isRelated = (output.relatedStepId === oldStep.id || output.pluginKey === oldStep.pluginKey);
    return isRelated && output.phase !== oldStep.phase;
  }).length;
  
  console.log(`✅ Phase-isolated removal complete for ${oldStep.phase} phase:`);
  console.log(`   - Removed: ${removedInputs} inputs, ${removedOutputs} outputs`);
  console.log(`   - Protected: ${protectedInputs} inputs, ${protectedOutputs} outputs from other phases`);
  
  return { filteredInputs, filteredOutputs };
};

export function useWorkflowActions({
  generatedPlan,
  isEditing,
  editableSteps,
  editableInputs,
  editableOutputs,
  connectedPlugins,
  user,
  data,
  setIsEditing,
  setEditableSteps,
  setEditableInputs,
  setEditableOutputs,
  setGeneratedPlan,
  setStepToRemove,
  setShowRemoveConfirmation,
  setNewlyAddedPlugins,
  setPluginNotifications,
  generatePlan,
  regeneratePlan,
  markPlanAsAccepted,
  generatePluginConfiguration,
  getInputsByPhase,
  getOutputsByPhase,
  hasInputSchema,
  onUpdate
}: UseWorkflowActionsProps) {

  // Plan management actions
  const handleRegeneratePlan = async () => {
    await regeneratePlan();
  };

  const handleAcceptPlan = async () => {
    if (!generatedPlan) return;
    
    const currentSteps = isEditing ? editableSteps : generatedPlan.steps;
    const validation = validateWorkflowPhases(currentSteps, hasInputSchema, data.userPrompt);
    
    if (!validation.isValid) {
      console.log('Accept plan validation failed:', validation.errors);
      alert(`Cannot accept plan: ${validation.errors.join(', ')}`);
      return;
    }
    
    if (isEditing) {
      alert('Please save your changes first before accepting the plan.');
      return;
    }
    
    const finalSteps = editableSteps;
    const finalInputs = editableInputs;
    const finalOutputs = editableOutputs;
    
    const acceptedPlan = {
      ...generatedPlan,
      steps: finalSteps,
      requiredInputs: finalInputs,
      outputs: finalOutputs,
      inputType: validation.inputType
    };
    
    markPlanAsAccepted(acceptedPlan);
    
    // Prepare connected plugins object
    const connectedPluginsObj = {};
    finalSteps.forEach(step => {
      connectedPluginsObj[step.pluginKey] = {
        connected: connectedPlugins.includes(step.pluginKey),
        required: true,
        pluginName: step.pluginName,
        phase: step.phase,
        order: step.order
      };
    });

    const pluginsRequired = finalSteps.map(step => step.pluginKey);
    
    // Update parent component
    onUpdate({
      plugins: connectedPluginsObj,
      inputSchema: finalInputs.map(input => ({
        name: input.name,
        type: input.type,
        required: input.required ?? true,
        description: input.description,
        placeholder: input.placeholder,
        options: input.options,
        phase: input.phase,
        defaultValue: input.defaultValue
      })),
      outputSchema: finalOutputs.map(output => ({
        type: output.type,
        name: output.name || output.type,
        description: output.description,
        format: output.format,
        destination: output.destination,
        pluginKey: output.pluginKey,
        phase: output.phase
      })),
      planAccepted: true,
      aiGenerated: true,
      finalWorkflowSteps: finalSteps,
      workflowSteps: finalSteps.map(step => ({
        id: step.id,
        order: step.order,
        phase: step.phase,
        pluginKey: step.pluginKey,
        pluginName: step.pluginName,
        action: step.action,
        description: step.description,
        confidence: step.confidence,
        icon: step.icon
      })),
      connectedPlugins: connectedPluginsObj,
      pluginsRequired: pluginsRequired,
      inputType: validation.inputType
    });

    console.log('Plan accepted and stored');
  };

  // Edit mode actions
  const handleToggleEdit = () => {
    setIsEditing(!isEditing);
    if (!isEditing && generatedPlan) {
      setEditableSteps([...generatedPlan.steps]);
      setEditableInputs([...generatedPlan.requiredInputs]);
      setEditableOutputs([...generatedPlan.outputs]);
    }
  };

  const handleEditSave = () => {
    const validation = validateWorkflowPhases(editableSteps, hasInputSchema, data.userPrompt);
    
    if (!validation.isValid) {
      alert(`Cannot save: ${validation.errors.join(', ')}`);
      return;
    }
    
    setIsEditing(false);
    if (generatedPlan) {
      const updatedPlan = {
        ...generatedPlan,
        steps: editableSteps,
        requiredInputs: editableInputs,
        outputs: editableOutputs,
        inputType: validation.inputType
      };
      setGeneratedPlan(updatedPlan);
    }
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    if (generatedPlan) {
      setEditableSteps([...generatedPlan.steps]);
      setEditableInputs([...generatedPlan.requiredInputs]);
      setEditableOutputs([...generatedPlan.outputs]);
    }
  };

  // Step management actions
  const handleUpdateStep = (stepId: number, updates: Partial<PluginStep>) => {
    setEditableSteps(prev => prev.map(step => 
      step.id === stepId ? { ...step, ...updates } : step
    ));
  };

  const handleRemoveStep = (stepId: number) => {
    const step = editableSteps.find(s => s.id === stepId);
    if (!step) return;

    // FIXED: Only find related items that are in the SAME phase (will actually be removed)
    const relatedInputs = editableInputs.filter(input => {
      const isRelated = input.relatedStepId === stepId || input.pluginKey === step.pluginKey;
      const isSamePhase = input.phase === step.phase;
      return isRelated && isSamePhase;
    });

    const relatedOutputs = editableOutputs.filter(output => {
      const isRelated = output.relatedStepId === stepId || output.pluginKey === step.pluginKey;
      const isSamePhase = output.phase === step.phase;
      return isRelated && isSamePhase;
    });

    console.log(`📋 Removal preview for ${step.pluginName} (${step.phase} phase):`);
    console.log(`   - Will remove: ${relatedInputs.length} inputs, ${relatedOutputs.length} outputs`);
    console.log(`   - All items are in ${step.phase} phase only`);

    setStepToRemove({ step, relatedInputs, relatedOutputs });
    setShowRemoveConfirmation(true);
  };

  const confirmRemoveStep = (stepToRemoveData: any) => {
    if (!stepToRemoveData) return;

    const { step } = stepToRemoveData;

    // Remove the step
    setEditableSteps(prev => prev.filter(s => s.id !== step.id));

    // Remove related inputs and outputs
    const { filteredInputs, filteredOutputs } = removeAllRelatedInputsOutputs(
      editableInputs, 
      editableOutputs, 
      step
    );
    
    setEditableInputs(filteredInputs);
    setEditableOutputs(filteredOutputs);

    // Clean up notifications
    setPluginNotifications(prev => {
      const updated = { ...prev };
      delete updated[step.pluginKey];
      return updated;
    });

    setNewlyAddedPlugins(prev => prev.filter(pluginKey => pluginKey !== step.pluginKey));

    setShowRemoveConfirmation(false);
    setStepToRemove(null);
  };

  const cancelRemoveStep = () => {
    setShowRemoveConfirmation(false);
    setStepToRemove(null);
  };

  // LLM-FIRST STEP ADDITION: Strict phase isolation
  const handleAddStep = async (pluginKey: string, targetPhase: 'input' | 'process' | 'output') => {
    const plugin = getPluginByKey(pluginKey);
    if (!plugin) {
      console.error(`Plugin not found: ${pluginKey}`);
      return;
    }

    console.log(`🔧 Adding step: ${plugin.name} to ${targetPhase} phase (strict phase isolation)`);

    const newStep: PluginStep = {
      id: Math.max(...editableSteps.map(s => s.id), 0) + 1,
      pluginKey: plugin.pluginKey,
      pluginName: plugin.name,
      action: plugin.action || plugin.defaultAction || 'Process data',
      description: plugin.description || `Use ${plugin.name} for workflow processing`,
      icon: plugin.icon,
      order: editableSteps.length + 1,
      phase: targetPhase,
      confidence: plugin.confidence || 90
    };

    // Add step immediately
    setEditableSteps(prev => [...prev, newStep]);
    setNewlyAddedPlugins(prev => [...prev, pluginKey]);

    // Show AI generation in progress
    setPluginNotifications(prev => ({
      ...prev,
      [pluginKey]: {
        isGenerating: true,
        generated: null,
        showNotification: true,
        source: 'ai-generation'
      }
    }));

    // LLM-FIRST: Generate with strict phase isolation
    const aiResult = await generateInputsOutputsWithAI(
      pluginKey,
      editableSteps,
      generatePluginConfiguration,
      newStep.id,
      targetPhase,
      data.userPrompt,
      plugin
    );

    // Apply results (even if empty)
    if (aiResult.inputs.length > 0) {
      setEditableInputs(prev => [...prev, ...aiResult.inputs]);
    }
    
    if (aiResult.outputs.length > 0) {
      setEditableOutputs(prev => [...prev, ...aiResult.outputs]);
    }

    // Check for zero results and provide user guidance
    const hasZeroResults = aiResult.inputs.length === 0 && aiResult.outputs.length === 0;
    const lowConfidence = aiResult.confidence < 50;

    // Update notification with results and guidance
    setPluginNotifications(prev => ({
      ...prev,
      [pluginKey]: {
        isGenerating: false,
        generated: {
          inputs: aiResult.inputs.length,
          outputs: aiResult.outputs.length,
          confidence: aiResult.confidence,
          source: aiResult.source,
          error: aiResult.error,
          hasZeroResults,
          lowConfidence,
          phaseEnforced: aiResult.phaseEnforced,
          userGuidance: hasZeroResults || lowConfidence ? {
            title: hasZeroResults ? 'No Configuration Generated' : 'Low Confidence Result',
            message: hasZeroResults 
              ? 'The AI could not generate inputs or outputs for this plugin. This might be due to an unclear workflow prompt or plugin incompatibility.'
              : 'The AI generated configuration with low confidence. The results may not be optimal for your workflow.',
            suggestions: [
              'Review and refine your workflow prompt to be more specific',
              'Ensure the plugin is relevant to your workflow goals',
              'Try rephrasing your prompt with clearer objectives',
              'Consider if this plugin is the right choice for your workflow phase'
            ]
          } : null
        },
        showNotification: true,
        source: aiResult.source
      }
    }));

    console.log(`✅ Step addition complete: ${aiResult.confidence}% confidence, source: ${aiResult.source}, phase enforced: ${aiResult.phaseEnforced}`);
  };

  // LLM-FIRST STEP REPLACEMENT: Strict phase isolation
  const handleReplaceStep = async (oldStep: PluginStep, newPluginKey: string) => {
    const newPlugin = getPluginByKey(newPluginKey);
    if (!newPlugin) {
      console.error(`New plugin not found: ${newPluginKey}`);
      return;
    }

    console.log(`🔄 Replacing ${oldStep.pluginName} with ${newPlugin.name} (strict phase isolation)`);

    // Update the step
    const updatedStep = {
      ...oldStep,
      pluginKey: newPluginKey,
      pluginName: newPlugin.name,
      action: newPlugin.action || newPlugin.defaultAction || oldStep.action,
      description: newPlugin.description || `Use ${newPlugin.name} for workflow processing`
    };

    setEditableSteps(prev => prev.map(step => 
      step.id === oldStep.id ? updatedStep : step
    ));

    // Remove old inputs/outputs
    const { filteredInputs, filteredOutputs } = removeAllRelatedInputsOutputs(
      editableInputs, 
      editableOutputs, 
      oldStep
    );
    
    setEditableInputs(filteredInputs);
    setEditableOutputs(filteredOutputs);

    // Generate new inputs/outputs with LLM (strict phase isolation)
    const aiResult = await generateInputsOutputsWithAI(
      newPluginKey,
      editableSteps,
      generatePluginConfiguration,
      oldStep.id,
      oldStep.phase,
      data.userPrompt,
      newPlugin
    );

    // Apply new results
    if (aiResult.inputs.length > 0) {
      setEditableInputs(prev => [...prev, ...aiResult.inputs]);
    }
    
    if (aiResult.outputs.length > 0) {
      setEditableOutputs(prev => [...prev, ...aiResult.outputs]);
    }

    console.log(`✅ Replacement complete: ${aiResult.confidence}% confidence, phase enforced: ${aiResult.phaseEnforced}`);
  };

  // Input/Output management actions (simplified)
  const handleUpdateInput = (phase: 'input' | 'process' | 'output', localIndex: number, updates: Partial<RequiredInput>) => {
    const phaseInputs = getInputsByPhase(phase);
    const targetInput = phaseInputs[localIndex];
    
    if (targetInput) {
      const globalIndex = editableInputs.findIndex(input => input === targetInput);
      if (globalIndex !== -1) {
        setEditableInputs(prev => prev.map((input, i) => 
          i === globalIndex ? { ...input, ...updates } : input
        ));
      }
    }
  };

  const handleRemoveInput = (phase: 'input' | 'process' | 'output', localIndex: number) => {
    const phaseInputs = getInputsByPhase(phase);
    const targetInput = phaseInputs[localIndex];
    
    if (targetInput) {
      const globalIndex = editableInputs.findIndex(input => input === targetInput);
      if (globalIndex !== -1) {
        setEditableInputs(prev => prev.filter((_, i) => i !== globalIndex));
      }
    }
  };

  const handleAddInput = (targetPhase: 'input' | 'process' | 'output') => {
    const stepsInPhase = editableSteps.filter(step => step.phase === targetPhase);
    const associatedStep = stepsInPhase[0];
    
    const newInput: RequiredInput = {
      name: `New ${targetPhase} Input`,
      type: 'string',
      description: `Manual input for ${targetPhase} phase`,
      required: false,
      placeholder: 'Enter value...',
      phase: targetPhase,
      pluginKey: associatedStep?.pluginKey || `phase-${targetPhase}`,
      relatedStepId: associatedStep?.id
    };
    setEditableInputs(prev => [...prev, newInput]);
  };

  const handleUpdateOutput = (phase: 'input' | 'process' | 'output', localIndex: number, updates: Partial<Output>) => {
    const phaseOutputs = getOutputsByPhase(phase);
    const targetOutput = phaseOutputs[localIndex];
    
    if (targetOutput) {
      const globalIndex = editableOutputs.findIndex(output => output === targetOutput);
      if (globalIndex !== -1) {
        setEditableOutputs(prev => prev.map((output, i) => 
          i === globalIndex ? { ...output, ...updates } : output
        ));
      }
    }
  };

  const handleRemoveOutput = (phase: 'input' | 'process' | 'output', localIndex: number) => {
    const phaseOutputs = getOutputsByPhase(phase);
    const targetOutput = phaseOutputs[localIndex];
    
    if (targetOutput) {
      const globalIndex = editableOutputs.findIndex(output => output === targetOutput);
      if (globalIndex !== -1) {
        setEditableOutputs(prev => prev.filter((_, i) => i !== globalIndex));
      }
    }
  };

  const handleAddOutput = (targetPhase: 'input' | 'process' | 'output') => {
    const stepsInPhase = editableSteps.filter(step => step.phase === targetPhase);
    const associatedStep = stepsInPhase[0];
    
    const newOutput: Output = {
      type: `Manual ${targetPhase} Output`,
      destination: 'Manual output destination',
      format: 'User-defined format',
      pluginKey: associatedStep?.pluginKey || 'manual',
      phase: targetPhase,
      relatedStepId: associatedStep?.id
    };
    setEditableOutputs(prev => [...prev, newOutput]);
  };

  // Plugin notification handlers
  const handleAcceptPluginConfiguration = (pluginKey: string) => {
    setPluginNotifications(prev => ({
      ...prev,
      [pluginKey]: { ...prev[pluginKey], showNotification: false }
    }));
    setNewlyAddedPlugins(prev => prev.filter(key => key !== pluginKey));
  };

  const handleReviewPluginConfiguration = (pluginKey: string) => {
    handleAcceptPluginConfiguration(pluginKey);
  };

  const dismissPluginNotification = (pluginKey: string) => {
    setPluginNotifications(prev => ({
      ...prev,
      [pluginKey]: { ...prev[pluginKey], showNotification: false }
    }));
  };

  // Utility functions
  const getAvailablePlugins = () => {
    return pluginList.filter(plugin => !plugin.deprecated && !plugin.disabled);
  };

  const getInputPhaseDisplay = () => {
    const validation = validateWorkflowPhases(editableSteps, hasInputSchema, data.userPrompt);
    
    switch (validation.inputType) {
      case 'plugins':
        return {
          title: 'Input Plugins',
          description: 'Data collected using connected plugins',
          showSteps: true,
          showSchema: false,
          showPromptInfo: false
        };
      
      case 'schema':
        return {
          title: 'Input Schema',
          description: 'Data collected using defined input fields',
          showSteps: false,
          showSchema: true,
          showPromptInfo: false
        };
      
      case 'prompt':
        return {
          title: 'Topic Research',
          description: 'Workflow uses your prompt as the research topic',
          showSteps: false,
          showSchema: false,
          showPromptInfo: true,
          promptPreview: data.userPrompt?.substring(0, 100) + (data.userPrompt?.length > 100 ? '...' : '')
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
  };

  return {
    // Plan actions
    handleRegeneratePlan,
    handleAcceptPlan,
    
    // Edit actions
    handleToggleEdit,
    handleEditSave,
    handleEditCancel,
    
    // Step actions
    handleUpdateStep,
    handleRemoveStep,
    handleAddStep,
    handleReplaceStep,
    confirmRemoveStep,
    cancelRemoveStep,
    
    // Input actions
    handleUpdateInput,
    handleRemoveInput,
    handleAddInput,
    
    // Output actions
    handleUpdateOutput,
    handleRemoveOutput,
    handleAddOutput,
    
    // Plugin notification actions
    handleAcceptPluginConfiguration,
    handleReviewPluginConfiguration,
    dismissPluginNotification,
    
    // Utilities
    getAvailablePlugins,
    getInputPhaseDisplay
  };
}
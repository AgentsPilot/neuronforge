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
  generatePluginConfiguration: (pluginKey: string, existingSteps: PluginStep[]) => Promise<{inputs: any[], outputs: any[]}>;
  getInputsByPhase: (phase: 'input' | 'process' | 'output') => RequiredInput[];
  getOutputsByPhase: (phase: 'input' | 'process' | 'output') => Output[];
  
  // NEW: Schema helper function
  hasInputSchema: () => boolean;
  
  // Callbacks
  onUpdate: (updates: any) => void;
}

// FLEXIBLE PHASE VALIDATION: Support workflows with or without input plugins
const validateWorkflowPhases = (steps: PluginStep[], hasInputSchema?: boolean, userPrompt?: string) => {
  const phaseGroups = steps.reduce((acc, step) => {
    if (!acc[step.phase]) acc[step.phase] = 0;
    acc[step.phase]++;
    return acc;
  }, {} as Record<string, number>);
  
  const errors: string[] = [];
  
  // INPUT PHASE VALIDATION: More flexible approach
  const hasInputSteps = phaseGroups['input'] && phaseGroups['input'] > 0;
  const hasInputSchemaData = hasInputSchema && hasInputSchema();
  
  // Check if the workflow can work with just the user prompt (e.g., topic research)
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
  
  // Input phase is valid if ANY of these conditions are met:
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

// COMPLETELY REWRITTEN: Phase determination logic with strict plugin-phase relationship
const determineInputPhase = (inputDef: any, stepPhase: string, pluginKey: string): string => {
  // Priority 1: ALWAYS respect explicit phase assignment
  if (inputDef.phase) {
    console.log(`Input "${inputDef.name}" using explicit phase: ${inputDef.phase}`);
    return inputDef.phase;
  }
  
  // Priority 2: Check for authentication/connection inputs - these ALWAYS go to INPUT phase
  // regardless of where the step is
  if (inputDef.purpose || inputDef.category) {
    const purpose = (inputDef.purpose || inputDef.category).toLowerCase();
    
    if (purpose === 'authentication' || 
        purpose === 'connection' || 
        purpose === 'credentials' ||
        purpose === 'auth' ||
        purpose === 'login') {
      console.log(`Input "${inputDef.name}" is authentication - forcing to INPUT phase`);
      return 'input';
    }
  }
  
  // Priority 3: Check input name for authentication patterns - these go to INPUT phase
  const inputNameLower = (inputDef.name || inputDef.label || inputDef.key || '').toLowerCase();
  const inputDescLower = (inputDef.description || inputDef.help || '').toLowerCase();
  
  // Authentication/connection inputs always go to INPUT phase
  const authKeywords = ['auth', 'credential', 'login', 'password', 'token', 'key', 'secret', 'username', 'connection'];
  const isAuthRelated = authKeywords.some(keyword => 
    inputNameLower.includes(keyword) || inputDescLower.includes(keyword)
  );
  
  if (isAuthRelated) {
    console.log(`Input "${inputDef.name}" contains auth keywords - assigning to INPUT phase`);
    return 'input';
  }
  
  // Priority 4: Check for OUTPUT-specific inputs based on very specific patterns
  const outputKeywords = ['destination', 'output path', 'save to', 'export to', 'file path', 'folder path', 'target directory'];
  const isOutputSpecific = outputKeywords.some(keyword => 
    inputNameLower.includes(keyword) || inputDescLower.includes(keyword)
  );
  
  if (isOutputSpecific) {
    console.log(`Input "${inputDef.name}" is output-specific - assigning to OUTPUT phase`);
    return 'output';
  }
  
  // Priority 5: For all other inputs, ALWAYS use the step's phase
  // This ensures inputs stay with their plugin
  console.log(`Input "${inputDef.name}" using step phase: ${stepPhase} (plugin: ${pluginKey})`);
  return stepPhase;
};

// COMPLETELY REWRITTEN: Schema building with proper plugin-phase relationship
const buildInputsFromPluginSchema = (plugin: any, stepId: number, stepPhase: string): RequiredInput[] => {
  const inputSources = [
    plugin.inputSchema,
    plugin.inputs,
    plugin.requiredInputs,
    plugin.schema?.inputs,
    plugin.config?.inputs,
    plugin.configuration?.inputs
  ].filter(Boolean);

  if (inputSources.length === 0) {
    console.log(`No input schema found for plugin ${plugin.name}`);
    return [];
  }

  const inputDefinitions = inputSources[0];
  if (!Array.isArray(inputDefinitions)) {
    console.log(`Input schema for ${plugin.name} is not an array:`, inputDefinitions);
    return [];
  }

  console.log(`Building ${inputDefinitions.length} inputs from ${plugin.name} schema (step phase: ${stepPhase})`);

  return inputDefinitions.map((inputDef: any, index: number) => {
    // Use the improved phase determination logic
    const inputPhase = determineInputPhase(inputDef, stepPhase, plugin.pluginKey);
    
    console.log(`✓ Input "${inputDef.name || inputDef.label}" → ${inputPhase} phase (from ${plugin.name} in ${stepPhase})`);

    const baseInput: RequiredInput = {
      name: inputDef.name || inputDef.label || inputDef.key || inputDef.field || `${plugin.name} Input ${index + 1}`,
      type: inputDef.type || inputDef.inputType || inputDef.dataType || 'text',
      description: inputDef.description || inputDef.help || inputDef.tooltip || `Input for ${plugin.name}`,
      required: inputDef.required ?? inputDef.mandatory ?? inputDef.isRequired ?? true,
      placeholder: inputDef.placeholder || inputDef.hint || inputDef.example || `Enter ${inputDef.name || 'value'}...`,
      defaultValue: inputDef.defaultValue || inputDef.default || inputDef.initialValue || '',
      options: inputDef.options || inputDef.choices || inputDef.enum || [],
      phase: inputPhase, // Use the determined phase
      pluginKey: plugin.pluginKey,
      relatedStepId: stepId
    };

    // Include any additional properties from the schema, but preserve our phase determination
    return { ...inputDef, ...baseInput, phase: inputPhase };
  });
};

// IMPROVED: Output schema building with proper phase assignment
const buildOutputsFromPluginSchema = (plugin: any, stepId: number, stepPhase: string): Output[] => {
  const outputSources = [
    plugin.outputSchema,
    plugin.outputs,
    plugin.expectedOutputs,
    plugin.schema?.outputs,
    plugin.config?.outputs,
    plugin.configuration?.outputs
  ].filter(Boolean);

  if (outputSources.length === 0) {
    console.log(`No output schema found for plugin ${plugin.name}`);
    return [];
  }

  const outputDefinitions = outputSources[0];
  if (!Array.isArray(outputDefinitions)) {
    console.log(`Output schema for ${plugin.name} is not an array:`, outputDefinitions);
    return [];
  }

  console.log(`Building ${outputDefinitions.length} outputs from ${plugin.name} schema`);

  return outputDefinitions.map((outputDef: any, index: number) => {
    // For outputs, use explicit phase if provided, otherwise use step's phase
    let outputPhase = outputDef.phase || stepPhase;
    
    // Special rule: If this is clearly a final deliverable, assign to output phase
    if ((stepPhase === 'input' || stepPhase === 'process') && 
        (outputDef.isFinal || outputDef.delivery || outputDef.destination)) {
      outputPhase = 'output';
      console.log(`Output "${outputDef.name}" is final deliverable - assigning to OUTPUT phase`);
    }

    const baseOutput: Output = {
      type: outputDef.type || outputDef.name || outputDef.key || outputDef.field || `${plugin.name} Output ${index + 1}`,
      name: outputDef.name || outputDef.label || outputDef.type || `Output ${index + 1}`,
      description: outputDef.description || outputDef.help || outputDef.tooltip || `Output from ${plugin.name}`,
      format: outputDef.format || outputDef.dataType || outputDef.mimeType || 'text',
      destination: outputDef.destination || outputDef.target || outputDef.location || 'Output destination',
      pluginKey: plugin.pluginKey,
      phase: outputPhase,
      relatedStepId: stepId
    };

    console.log(`✓ Output "${baseOutput.name}" → ${outputPhase} phase (from ${plugin.name} in ${stepPhase})`);
    
    return { ...outputDef, ...baseOutput, phase: outputPhase };
  });
};

// UPDATED: AI generation with improved phase assignment
const generateInputsOutputsWithAI = async (
  pluginKey: string, 
  existingSteps: PluginStep[], 
  generatePluginConfiguration: (pluginKey: string, existingSteps: PluginStep[]) => Promise<{inputs: any[], outputs: any[]}>,
  stepId: number,
  phase: string
) => {
  try {
    console.log(`Generating AI inputs/outputs for ${pluginKey} (step phase: ${phase})`);
    const configuration = await generatePluginConfiguration(pluginKey, existingSteps);
    
    // Add metadata to AI-generated inputs/outputs with improved phase assignment
    const aiInputs = configuration.inputs.map(input => {
      // Apply the same phase determination logic to AI-generated inputs
      const correctedPhase = determineInputPhase(input, phase, pluginKey);
      
      console.log(`✓ AI Input "${input.name}" → ${correctedPhase} phase (from ${pluginKey} in ${phase})`);
      
      return {
        ...input,
        phase: correctedPhase,
        pluginKey,
        relatedStepId: stepId,
        source: 'ai-generated'
      };
    });

    const aiOutputs = configuration.outputs.map(output => {
      const outputPhase = output.phase || phase;
      console.log(`✓ AI Output "${output.name || output.type}" → ${outputPhase} phase (from ${pluginKey} in ${phase})`);
      
      return {
        ...output,
        phase: outputPhase,
        pluginKey,
        relatedStepId: stepId,
        source: 'ai-generated'
      };
    });

    return { inputs: aiInputs, outputs: aiOutputs };
  } catch (error) {
    console.error(`Error generating AI configuration for ${pluginKey}:`, error);
    return { inputs: [], outputs: [] };
  }
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
    
    // PHASE VALIDATION: Check all phases before accepting (including schema support and userPrompt)
    const currentSteps = isEditing ? editableSteps : generatedPlan.steps;
    const validation = validateWorkflowPhases(currentSteps, hasInputSchema, data.userPrompt);
    
    if (!validation.isValid) {
      console.log('Accept plan validation failed:', {
        errors: validation.errors,
        phaseGroups: validation.phaseGroups,
        inputType: validation.inputType
      });
      alert(`Cannot accept plan: ${validation.errors.join(', ')}`);
      return;
    }
    
    console.log('Plan accepted with input type:', validation.inputType);
    
    // Check if user is in edit mode with unsaved changes
    if (isEditing) {
      alert('Please save your changes first before accepting the plan.');
      return;
    }
    
    const finalSteps = editableSteps;
    const finalInputs = editableInputs;
    const finalOutputs = editableOutputs;
    
    // Debug: Show final phase assignments
    console.log('Final input phase assignments:');
    finalInputs.forEach(input => {
      console.log(`- ${input.name} → ${input.phase} phase (plugin: ${input.pluginKey})`);
    });
    
    // Create the final accepted plan with current editable data
    const acceptedPlan = {
      ...generatedPlan,
      steps: finalSteps,
      requiredInputs: finalInputs,
      outputs: finalOutputs,
      inputType: validation.inputType
    };
    
    // Store the accepted plan for navigation back
    markPlanAsAccepted(acceptedPlan);
    
    // Prepare connected plugins object for parent component
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

    // Extract required plugins list
    const pluginsRequired = finalSteps.map(step => step.pluginKey);
    
    // Update parent component state with accepted plan data
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

    console.log('Plan accepted and stored for navigation back');
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
    // PHASE VALIDATION: Check all phases before saving (including schema support and userPrompt)
    const validation = validateWorkflowPhases(editableSteps, hasInputSchema, data.userPrompt);
    
    if (!validation.isValid) {
      console.log('Validation failed:', {
        errors: validation.errors,
        phaseGroups: validation.phaseGroups,
        inputType: validation.inputType,
        userPrompt: data.userPrompt
      });
      alert(`Cannot save: ${validation.errors.join(', ')}`);
      return;
    }
    
    console.log('Validation passed with input type:', validation.inputType);
    
    setIsEditing(false);
    if (generatedPlan) {
      // Update the current plan with saved changes
      const updatedPlan = {
        ...generatedPlan,
        steps: editableSteps,
        requiredInputs: editableInputs,
        outputs: editableOutputs,
        inputType: validation.inputType // Store how input is handled
      };
      setGeneratedPlan(updatedPlan);
    }
    
    console.log('Changes saved - plan can now be accepted');
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
    // Find the step being removed
    const step = editableSteps.find(s => s.id === stepId);
    if (!step) return;

    // Find related inputs and outputs dynamically
    const relatedInputs = editableInputs.filter(input => 
      input.relatedStepId === stepId || 
      input.pluginKey === step.pluginKey ||
      (input.name?.toLowerCase() || '').includes(step.pluginName.toLowerCase()) ||
      (input.name?.toLowerCase() || '').includes(step.pluginKey.toLowerCase())
    );

    const relatedOutputs = editableOutputs.filter(output => 
      output.relatedStepId === stepId || 
      output.pluginKey === step.pluginKey ||
      ((output.type || output.name || '').toLowerCase()).includes(step.pluginName.toLowerCase()) ||
      ((output.type || output.name || '').toLowerCase()).includes(step.pluginKey.toLowerCase())
    );

    // Store removal data and show confirmation modal
    setStepToRemove({ step, relatedInputs, relatedOutputs });
    setShowRemoveConfirmation(true);
  };

  const confirmRemoveStep = (stepToRemoveData: any) => {
    if (!stepToRemoveData) return;

    const { step, relatedInputs, relatedOutputs } = stepToRemoveData;

    // Remove the step itself
    setEditableSteps(prev => prev.filter(s => s.id !== step.id));

    // Remove related inputs
    setEditableInputs(prev => prev.filter(input => {
      const shouldRemove = input.relatedStepId === step.id || 
                          input.pluginKey === step.pluginKey ||
                          (input.name?.toLowerCase() || '').includes(step.pluginName.toLowerCase()) ||
                          (input.name?.toLowerCase() || '').includes(step.pluginKey.toLowerCase());
      
      if (shouldRemove) {
        console.log(`Removing input "${input.name}" - related to step ${step.pluginName}`);
      }
      
      return !shouldRemove;
    }));

    // Remove related outputs
    setEditableOutputs(prev => prev.filter(output => {
      const shouldRemove = output.relatedStepId === step.id || 
                          output.pluginKey === step.pluginKey ||
                          ((output.type || output.name || '').toLowerCase()).includes(step.pluginName.toLowerCase()) ||
                          ((output.type || output.name || '').toLowerCase()).includes(step.pluginKey.toLowerCase());
      
      if (shouldRemove) {
        console.log(`Removing output "${output.type || output.name}" - related to step ${step.pluginName}`);
      }
      
      return !shouldRemove;
    }));

    console.log(`Removed step ${step.id} (${step.pluginName}) with ${relatedInputs.length} inputs and ${relatedOutputs.length} outputs`);

    // Remove notification for this plugin
    setPluginNotifications(prev => {
      const updated = { ...prev };
      delete updated[step.pluginKey];
      return updated;
    });

    // Remove from newly added plugins
    setNewlyAddedPlugins(prev => prev.filter(pluginKey => pluginKey !== step.pluginKey));

    // Close modal
    setShowRemoveConfirmation(false);
    setStepToRemove(null);
  };

  const cancelRemoveStep = () => {
    setShowRemoveConfirmation(false);
    setStepToRemove(null);
  };

  // ENHANCED STEP ADDITION: Priority order - Plugin Schema → AI Generation
  const handleAddStep = async (pluginKey: string, phase: 'input' | 'process' | 'output') => {
    const plugin = getPluginByKey(pluginKey);
    if (!plugin) {
      console.error(`Plugin not found: ${pluginKey}`);
      return;
    }

    console.log(`\n🔧 Adding step for plugin: ${plugin.name} (${pluginKey}) to ${phase} phase`);

    const newStep: PluginStep = {
      id: Math.max(...editableSteps.map(s => s.id), 0) + 1,
      pluginKey: plugin.pluginKey,
      pluginName: plugin.name,
      action: plugin.action || plugin.defaultAction || 'Process data',
      description: plugin.description || `Use ${plugin.name} for workflow processing`,
      icon: plugin.icon,
      order: editableSteps.length + 1,
      phase: phase,
      confidence: plugin.confidence || 90
    };

    // Add step immediately
    setEditableSteps(prev => [...prev, newStep]);
    
    // Mark as newly added
    setNewlyAddedPlugins(prev => [...prev, pluginKey]);

    // PRIORITY 1: Try to build inputs/outputs from plugin schema definitions
    const schemaInputs = buildInputsFromPluginSchema(plugin, newStep.id, phase);
    const schemaOutputs = buildOutputsFromPluginSchema(plugin, newStep.id, phase);

    if (schemaInputs.length > 0 || schemaOutputs.length > 0) {
      // SUCCESS: Plugin has schema definitions
      console.log(`✅ Using plugin schema: ${schemaInputs.length} inputs, ${schemaOutputs.length} outputs`);
      
      if (schemaInputs.length > 0) {
        console.log('📝 Schema inputs with phases:');
        schemaInputs.forEach(i => console.log(`   - ${i.name} → ${i.phase} phase`));
        setEditableInputs(prev => [...prev, ...schemaInputs]);
      }
      
      if (schemaOutputs.length > 0) {
        console.log('📤 Schema outputs with phases:');
        schemaOutputs.forEach(o => console.log(`   - ${o.name} → ${o.phase} phase`));
        setEditableOutputs(prev => [...prev, ...schemaOutputs]);
      }

      // Show notification about schema-based population
      setPluginNotifications(prev => ({
        ...prev,
        [pluginKey]: {
          isGenerating: false,
          generated: {
            inputs: schemaInputs.length,
            outputs: schemaOutputs.length
          },
          showNotification: true,
          source: 'plugin-schema'
        }
      }));

      console.log(`✅ Schema-based population complete for ${plugin.name}\n`);
      return;
    }

    // PRIORITY 2: No schema found, use AI generation as fallback
    console.log(`❌ No schema found for ${plugin.name}, using AI generation...`);
    
    setPluginNotifications(prev => ({
      ...prev,
      [pluginKey]: {
        isGenerating: true,
        generated: null,
        showNotification: true,
        source: 'ai-generation'
      }
    }));

    const aiResult = await generateInputsOutputsWithAI(
      pluginKey, 
      editableSteps, 
      generatePluginConfiguration, 
      newStep.id, 
      phase
    );

    if (aiResult.inputs.length > 0) {
      console.log('🤖 AI inputs with phases:');
      aiResult.inputs.forEach(i => console.log(`   - ${i.name} → ${i.phase} phase`));
      setEditableInputs(prev => [...prev, ...aiResult.inputs]);
    }
    
    if (aiResult.outputs.length > 0) {
      console.log('🤖 AI outputs with phases:');
      aiResult.outputs.forEach(o => console.log(`   - ${o.name} → ${o.phase} phase`));
      setEditableOutputs(prev => [...prev, ...aiResult.outputs]);
    }

    // Update notification with AI results
    setPluginNotifications(prev => ({
      ...prev,
      [pluginKey]: {
        isGenerating: false,
        generated: {
          inputs: aiResult.inputs.length,
          outputs: aiResult.outputs.length
        },
        showNotification: true,
        source: 'ai-generation'
      }
    }));

    console.log(`✅ AI generation complete for ${plugin.name}: ${aiResult.inputs.length} inputs, ${aiResult.outputs.length} outputs\n`);
  };

  // PLUGIN REPLACEMENT: Handle replacing one plugin with another
  const handleReplaceStep = async (oldStep: PluginStep, newPluginKey: string) => {
    const newPlugin = getPluginByKey(newPluginKey);
    if (!newPlugin) {
      console.error(`New plugin not found: ${newPluginKey}`);
      return;
    }

    console.log(`🔄 Replacing ${oldStep.pluginName} with ${newPlugin.name}`);

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
    setEditableInputs(prev => prev.filter(input => 
      input.relatedStepId !== oldStep.id && input.pluginKey !== oldStep.pluginKey
    ));
    
    setEditableOutputs(prev => prev.filter(output => 
      output.relatedStepId !== oldStep.id && output.pluginKey !== oldStep.pluginKey
    ));

    // Add new inputs/outputs using the same priority system
    const schemaInputs = buildInputsFromPluginSchema(newPlugin, oldStep.id, oldStep.phase);
    const schemaOutputs = buildOutputsFromPluginSchema(newPlugin, oldStep.id, oldStep.phase);

    if (schemaInputs.length > 0 || schemaOutputs.length > 0) {
      // Use plugin schema
      if (schemaInputs.length > 0) {
        setEditableInputs(prev => [...prev, ...schemaInputs]);
      }
      
      if (schemaOutputs.length > 0) {
        setEditableOutputs(prev => [...prev, ...schemaOutputs]);
      }

      console.log(`✅ Replacement complete using schema: ${schemaInputs.length} inputs, ${schemaOutputs.length} outputs`);
    } else {
      // Use AI generation
      const aiResult = await generateInputsOutputsWithAI(
        newPluginKey, 
        editableSteps, 
        generatePluginConfiguration, 
        oldStep.id, 
        oldStep.phase
      );

      if (aiResult.inputs.length > 0) {
        setEditableInputs(prev => [...prev, ...aiResult.inputs]);
      }
      
      if (aiResult.outputs.length > 0) {
        setEditableOutputs(prev => [...prev, ...aiResult.outputs]);
      }

      console.log(`✅ Replacement complete using AI: ${aiResult.inputs.length} inputs, ${aiResult.outputs.length} outputs`);
    }
  };

  // Input management actions
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
    // Find a step in the target phase to associate this input with
    const stepsInPhase = editableSteps.filter(step => step.phase === targetPhase);
    const associatedStep = stepsInPhase[0]; // Use first step in phase
    
    const newInput: RequiredInput = {
      name: `New ${targetPhase.charAt(0).toUpperCase() + targetPhase.slice(1)} Input`,
      type: 'string',
      description: `Description for new ${targetPhase} input`,
      required: false,
      placeholder: 'Enter value...',
      phase: targetPhase,
      pluginKey: associatedStep?.pluginKey || `phase-${targetPhase}`,
      relatedStepId: associatedStep?.id
    };
    setEditableInputs(prev => [...prev, newInput]);
    console.log('Added input with relationship:', newInput.name, '-> Step:', associatedStep?.pluginName);
  };

  // Output management actions
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
    // Find a step in the target phase to associate this output with
    const stepsInPhase = editableSteps.filter(step => step.phase === targetPhase);
    const associatedStep = stepsInPhase[0]; // Use first step in phase
    
    const newOutput: Output = {
      type: `New ${targetPhase.charAt(0).toUpperCase() + targetPhase.slice(1)} Output`,
      destination: 'Output destination',
      format: 'Output format description',
      pluginKey: associatedStep?.pluginKey || 'system',
      phase: targetPhase,
      relatedStepId: associatedStep?.id
    };
    setEditableOutputs(prev => [...prev, newOutput]);
    console.log('Added output with relationship:', newOutput.type, '-> Step:', associatedStep?.pluginName);
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
    // For now, just accept - can expand to show modal later
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
    return pluginList.filter(plugin => {
      // Filter out deprecated/disabled plugins dynamically
      return !plugin.deprecated && !plugin.disabled;
    });
  };

  // HELPER FUNCTION: Get input phase display info based on validation
  const getInputPhaseDisplay = () => {
    const validation = validateWorkflowPhases(editableSteps, hasInputSchema, data.userPrompt);
    
    switch (validation.inputType) {
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
    handleReplaceStep, // NEW: Plugin replacement support
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
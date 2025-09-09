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
  markPlanAsAccepted: (plan: any) => void; // Add this new function
  generatePluginConfiguration: (pluginKey: string, existingSteps: PluginStep[]) => Promise<{inputs: any[], outputs: any[]}>;
  getInputsByPhase: (phase: 'input' | 'process' | 'output') => RequiredInput[];
  getOutputsByPhase: (phase: 'input' | 'process' | 'output') => Output[];
  
  // Callbacks
  onUpdate: (updates: any) => void;
}

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
  markPlanAsAccepted, // Add this parameter
  generatePluginConfiguration,
  getInputsByPhase,
  getOutputsByPhase,
  onUpdate
}: UseWorkflowActionsProps) {

  // Plan management actions
  const handleRegeneratePlan = async () => {
    await regeneratePlan();
  };

  const handleAcceptPlan = async () => {
    if (!generatedPlan) return;
    
    // Check if user is in edit mode with unsaved changes
    if (isEditing) {
      // User must save their changes first before accepting
      alert('Please save your changes first before accepting the plan.');
      return;
    }
    
    const finalSteps = editableSteps;
    const finalInputs = editableInputs;
    const finalOutputs = editableOutputs;
    
    // Create the final accepted plan with current editable data
    const acceptedPlan = {
      ...generatedPlan,
      steps: finalSteps,
      requiredInputs: finalInputs,
      outputs: finalOutputs
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
      pluginsRequired: pluginsRequired
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
    setIsEditing(false);
    if (generatedPlan) {
      // Update the current plan with saved changes
      const updatedPlan = {
        ...generatedPlan,
        steps: editableSteps,
        requiredInputs: editableInputs,
        outputs: editableOutputs
      };
      setGeneratedPlan(updatedPlan);
    }
    
    // After saving, the user can now accept the plan
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

    // Find related inputs and outputs
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

  // Enhanced handleAddStep with AI generation and notification
  const handleAddStep = async (pluginKey: string, phase: 'input' | 'process' | 'output') => {
    const plugin = getPluginByKey(pluginKey);
    if (!plugin) return;

    const newStep: PluginStep = {
      id: Math.max(...editableSteps.map(s => s.id), 0) + 1,
      pluginKey: plugin.pluginKey,
      pluginName: plugin.name,
      action: 'Process data',
      description: `Use ${plugin.name} for workflow processing`,
      icon: plugin.icon,
      order: editableSteps.length + 1,
      phase: phase,
      confidence: 90
    };

    // Add step immediately
    setEditableSteps(prev => [...prev, newStep]);
    
    // Mark as newly added and show generating notification
    setNewlyAddedPlugins(prev => [...prev, pluginKey]);
    setPluginNotifications(prev => ({
      ...prev,
      [pluginKey]: {
        isGenerating: true,
        generated: null,
        showNotification: true
      }
    }));

    try {
      // Generate AI configuration for this plugin
      const configuration = await generatePluginConfiguration(pluginKey, editableSteps);
      
      // Add generated inputs and outputs with proper phase association
      const newInputs = configuration.inputs.map(input => ({
        ...input,
        phase: phase,
        pluginKey: pluginKey,
        relatedStepId: newStep.id
      }));

      const newOutputs = configuration.outputs.map(output => ({
        ...output,
        phase: phase,
        pluginKey: pluginKey,
        relatedStepId: newStep.id
      }));

      setEditableInputs(prev => [...prev, ...newInputs]);
      setEditableOutputs(prev => [...prev, ...newOutputs]);

      // Update notification with results
      setPluginNotifications(prev => ({
        ...prev,
        [pluginKey]: {
          isGenerating: false,
          generated: {
            inputs: newInputs.length,
            outputs: newOutputs.length
          },
          showNotification: true
        }
      }));

      console.log(`Generated ${newInputs.length} inputs and ${newOutputs.length} outputs for ${plugin.name}`);
      
    } catch (err) {
      console.error('Error generating plugin configuration:', err);
      
      // Update notification to show error/completion
      setPluginNotifications(prev => ({
        ...prev,
        [pluginKey]: {
          isGenerating: false,
          generated: { inputs: 0, outputs: 0 },
          showNotification: true
        }
      }));
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
    return pluginList;
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
    getAvailablePlugins
  };
}
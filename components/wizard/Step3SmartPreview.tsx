// Fixed Step2SmartPreview.tsx - Added isEditing prop to WorkflowHeader

import React, { useState } from 'react';
import { 
  Brain, 
  Loader2, 
  AlertTriangle, 
  Edit3, 
  RefreshCw,
  Database,
  Sparkles,
  ExternalLink,
  Download,
  Zap,
  Clock,
  CheckCircle,
  Users,
  FileText,
  Mail,
  Calendar,
  BarChart3,
  Settings,
  Globe,
  Smartphone,
  Monitor,
  GitBranch,
  X
} from 'lucide-react';
import { getPluginByKey, pluginList } from '@/lib/plugins/pluginList';
import { EditablePhase } from './EditablePhase';
import { WorkflowViewer } from './WorkflowViewer';
import SmartBusinessWorkflowConfig from './SmartBusinessWorkflowConfig';
import { useWorkflowData } from './hooks/useWorkflowData';
import { useWorkflowActions } from './hooks/useWorkflowActions';
import { WorkflowHeader } from './components/WorkflowHeader';
import { WorkflowActions } from './components/WorkflowActions';
import { PluginNotificationBanner } from './components/PluginNotificationBanner';
import { RemoveStepModal } from './components/RemoveStepModal';
import { usePluginReplacement } from './components/PluginNotificationBanner';
import { InputSchemaCard } from './components/InputSchemaCard';
import { BusinessViewSections } from './BusinessViewSections';
import type { PluginStep, RequiredInput } from './types';

interface Props {
  data: {
    userPrompt: string;
    systemPrompt?: string;
    plugins: Record<string, any>;
  };
  onUpdate: (updates: any) => void;
  onValidationChange?: (isValid: boolean, error?: string) => void;
  userId?: string;
}

export default function Step2SmartPreview({ data, onUpdate, onValidationChange, userId }: Props) {
  // Use custom hooks for state and actions
  const workflowData = useWorkflowData({ data, onUpdate, onValidationChange, userId });
  const workflowActions = useWorkflowActions({
    ...workflowData,
    data,
    onUpdate
  });

  // Add plugin replacement hook
  const { 
    replacementState, 
    startReplacement, 
    dismissReplacement 
  } = usePluginReplacement();

  // Schema form state management
  const [schemaValues, setSchemaValues] = useState<Record<string, any>>({});
  const [schemaErrors, setSchemaErrors] = useState<Record<string, string>>({});

  const handleSchemaChange = (fieldId: string, value: any) => {
    setSchemaValues(prev => ({ ...prev, [fieldId]: value }));
    // Clear error when user starts typing
    if (schemaErrors[fieldId]) {
      setSchemaErrors(prev => ({ ...prev, [fieldId]: '' }));
    }
  };

  // Destructure values from hooks
  const {
    generatedPlan,
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
    setShowAnalysisDetails,
    setViewMode,
    getStepsByPhase,
    getInputsByPhase,
    getOutputsByPhase,
    isConnected,
    getPluginConnection,
    hasInputSchema,
    hasInputSteps,
    getInputPhaseType,
    shouldShowInputPhase,
    getInputSchema
  } = workflowData;

  const {
    handleRegeneratePlan,
    handleAcceptPlan,
    handleToggleEdit,
    handleEditSave,
    handleEditCancel,
    handleUpdateStep,
    handleRemoveStep,
    handleAddStep,
    handleReplaceStep,
    confirmRemoveStep,
    cancelRemoveStep,
    handleUpdateInput,
    handleRemoveInput,
    handleAddInput,
    handleUpdateOutput,
    handleRemoveOutput,
    handleAddOutput,
    handleAcceptPluginConfiguration,
    handleReviewPluginConfiguration,
    dismissPluginNotification,
    getAvailablePlugins
  } = workflowActions;

  // Helper function to get connection status
  const getConnectionStatus = (pluginKey: string) => {
    const systemPlugins = ['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'];
    
    if (systemPlugins.includes(pluginKey)) {
      return { 
        status: 'connected', 
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        details: null
      };
    }
    
    const isMissing = generatedPlan.missingPlugins && generatedPlan.missingPlugins.includes(pluginKey);
    if (isMissing) {
      return { 
        status: 'missing', 
        color: 'text-red-600',
        bgColor: 'bg-red-50',
        borderColor: 'border-red-200',
        details: null
      };
    }
    
    const isConnected = connectedPlugins.includes(pluginKey);
    if (isConnected) {
      const details = connectionDetails ? connectionDetails[pluginKey] : null;
      return { 
        status: 'connected', 
        color: 'text-green-600',
        bgColor: 'bg-green-50',
        borderColor: 'border-green-200',
        details: details
      };
    }
    
    return { 
      status: 'disconnected', 
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50',
      borderColor: 'border-yellow-200',
      details: null
    };
  };

  // Helper function to get phase color
  const getPhaseColor = (phase: 'input' | 'process' | 'output') => {
    switch (phase) {
      case 'input': return 'bg-blue-500';
      case 'process': return 'bg-purple-500';
      case 'output': return 'bg-emerald-500';
      default: return 'bg-gray-500';
    }
  };

  // Helper function to get appropriate icon for plugin
  const getIconForPlugin = (pluginName: string, size: string = "h-6 w-6") => {
    const plugin = getPluginByKey(pluginName) || editableSteps.find(step => step.pluginName === pluginName);
    
    if (plugin?.icon) {
      if (typeof plugin.icon === 'string') {
        const iconName = plugin.icon.toLowerCase();
        if (iconName.includes('file')) return <FileText className={size} />;
        if (iconName.includes('user') || iconName.includes('team')) return <Users className={size} />;
        if (iconName.includes('mail')) return <Mail className={size} />;
        if (iconName.includes('calendar')) return <Calendar className={size} />;
        if (iconName.includes('chart') || iconName.includes('analytics')) return <BarChart3 className={size} />;
        if (iconName.includes('spark') || iconName.includes('ai')) return <Sparkles className={size} />;
        if (iconName.includes('globe') || iconName.includes('web')) return <Globe className={size} />;
        if (iconName.includes('phone') || iconName.includes('mobile')) return <Smartphone className={size} />;
        if (iconName.includes('database') || iconName.includes('data')) return <Database className={size} />;
        if (iconName.includes('download')) return <Download className={size} />;
        if (iconName.includes('zap') || iconName.includes('process')) return <Zap className={size} />;
      }
    }
    
    if (plugin?.category) {
      const category = plugin.category.toLowerCase();
      if (category.includes('storage') || category.includes('file')) return <FileText className={size} />;
      if (category.includes('communication') || category.includes('social')) return <Users className={size} />;
      if (category.includes('email') || category.includes('messaging')) return <Mail className={size} />;
      if (category.includes('calendar') || category.includes('scheduling')) return <Calendar className={size} />;
      if (category.includes('analytics') || category.includes('reporting')) return <BarChart3 className={size} />;
      if (category.includes('ai') || category.includes('machine-learning')) return <Sparkles className={size} />;
      if (category.includes('web') || category.includes('browser')) return <Globe className={size} />;
      if (category.includes('mobile') || category.includes('device')) return <Smartphone className={size} />;
      if (category.includes('database') || category.includes('storage')) return <Database className={size} />;
      if (category.includes('output') || category.includes('delivery')) return <Download className={size} />;
      if (category.includes('processing') || category.includes('transformation')) return <Zap className={size} />;
    }
    
    return <Monitor className={size} />;
  };

  // Enhanced function to find related plugins for input
  const findRelatedPluginsForInput = (input: any) => {
    let relatedPlugins = [];

    const allSteps = [
      ...getStepsByPhase('input'),
      ...getStepsByPhase('process'),
      ...getStepsByPhase('output')
    ];

    if (input.pluginKey) {
      relatedPlugins = allSteps.filter(step => step.pluginKey === input.pluginKey);
    }

    if (relatedPlugins.length === 0 && input.relatedStepId) {
      relatedPlugins = allSteps.filter(step => step.id === input.relatedStepId);
    }

    if (relatedPlugins.length === 0 && input.phase) {
      relatedPlugins = allSteps.filter(step => step.phase === input.phase);
    }

    return relatedPlugins.filter((plugin, index, self) => 
      index === self.findIndex(p => p.pluginKey === plugin.pluginKey)
    );
  };

  // SIMPLIFIED: Plugin replacement using only LLM approach
  const handlePluginReplacement = (oldStep: PluginStep, newPluginKey: string) => {
    const availablePlugins = getAvailablePlugins();
    const newPlugin = availablePlugins.find(p => p.pluginKey === newPluginKey);
    
    if (!newPlugin) {
      console.error('New plugin not found:', newPluginKey);
      return;
    }

    console.log(`🔄 LLM-only plugin replacement: ${oldStep.pluginName} → ${newPlugin.name}`);

    // Start the replacement process with banner
    startReplacement(oldStep.id, oldStep, newPluginKey, newPlugin.name);
    
    // Use the LLM-first replacement from useWorkflowActions
    handleReplaceStep(oldStep, newPluginKey);

    // Update the main data structure
    const updatedSteps = editableSteps.map(step => 
      step.id === oldStep.id ? { 
        ...step, 
        pluginKey: newPluginKey, 
        pluginName: newPlugin.name,
        action: newPlugin.action || `Use ${newPlugin.name}`,
        description: newPlugin.description || `Execute ${newPlugin.name} plugin`
      } : step
    );

    onUpdate({
      ...data,
      plugins: {
        ...data.plugins,
        steps: updatedSteps
      }
    });
  };

  // Calculate current missing and unconnected plugins
  const getCurrentMissingPlugins = () => {
    const currentSteps = isEditing ? editableSteps : (generatedPlan?.steps || []);
    const requiredPlugins = currentSteps.map(step => step.pluginKey);
    
    return requiredPlugins.filter(pluginKey => {
      const plugin = getPluginByKey(pluginKey);
      return !plugin;
    });
  };

  const getCurrentUnconnectedPlugins = () => {
    const currentSteps = isEditing ? editableSteps : (generatedPlan?.steps || []);
    const requiredPlugins = currentSteps.map(step => step.pluginKey);
    const systemPlugins = ['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'];
    
    const uniqueRequiredPlugins = [...new Set(requiredPlugins)];
    
    return uniqueRequiredPlugins.filter(pluginKey => {
      const isSystemPlugin = systemPlugins.includes(pluginKey);
      const isConnectedDirectly = connectedPlugins.includes(pluginKey);
      return !isSystemPlugin && !isConnectedDirectly;
    });
  };

  const currentMissingPlugins = getCurrentMissingPlugins();
  const currentUnconnectedPlugins = getCurrentUnconnectedPlugins();

  // SIMPLIFIED: Step removal using only useWorkflowActions logic
  const handleConfirmRemoveStep = (stepToRemoveData: any) => {
    // Use the hook's confirmRemoveStep function (which already handles LLM-generated content)
    confirmRemoveStep(stepToRemoveData);
    
    // Update the main data structure
    if (stepToRemoveData?.step) {
      const step = stepToRemoveData.step;
      const updatedSteps = editableSteps.filter(s => s.id !== step.id);
      
      onUpdate({
        ...data,
        plugins: {
          ...data.plugins,
          steps: updatedSteps
        }
      });
    }
  };

  // Get all steps and organize them for business flow display
  const allSteps = [
    ...getStepsByPhase('input'),
    ...getStepsByPhase('process'),
    ...getStepsByPhase('output')
  ].sort((a, b) => a.order - b.order);

  // Get all inputs across phases for business view
  const allInputs = [
    ...getInputsByPhase('input'),
    ...getInputsByPhase('process'),
    ...getInputsByPhase('output')
  ];

  // Helper function to check if phase should show specific schema options
  const shouldShowInputsForPhase = (phase: 'input' | 'process' | 'output') => {
    return phase === 'input'; // Only Input phase can have input configurations
  };

  const shouldShowOutputsForPhase = (phase: 'input' | 'process' | 'output') => {
    return phase === 'output'; // Only Output phase can have output configurations
  };

  // SIMPLIFIED: Edit Mode Technical Layout Component (single notification rendering)
  const EditModeTechnicalLayout = () => {
    return (
      <div className="space-y-8">
        {/* Global replacement banners - show at top level */}
        {Object.entries(replacementState).map(([stepId, replacement]) => (
          <PluginNotificationBanner
            key={`global-replacement-${stepId}`}
            type="replacement"
            oldPlugin={replacement.oldStep}
            newPlugin={{ pluginKey: replacement.newPluginKey, name: replacement.newPluginName }}
            onDismiss={() => dismissReplacement(stepId)}
          />
        ))}

        {/* Edit Mode Controls */}
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
              <Edit3 className="h-4 w-4 text-white" />
            </div>
            <div>
              <h4 className="font-semibold text-blue-900">Edit Mode Active</h4>
              <p className="text-blue-700 text-sm">Make changes to workflow steps, inputs, and outputs</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={handleEditCancel}
              className="px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button 
              onClick={handleEditSave}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Save Changes
            </button>
          </div>
        </div>

        {/* SINGLE Plugin Notifications Rendering - only show once globally */}
        {Object.entries(pluginNotifications).map(([pluginKey, notification]) => {
          if (!notification.showNotification) return null;
          
          const plugin = editableSteps.find(step => step.pluginKey === pluginKey);
          const bannerType = notification.source === 'ai-generation' ? 'ai-generated' : 'plugin-schema';
          
          return (
            <PluginNotificationBanner
              key={`global-notification-${pluginKey}`}
              type={bannerType}
              plugin={{ pluginKey, name: plugin?.pluginName || pluginKey }}
              isGenerating={notification.isGenerating}
              generatedCount={notification.generated}
              onReview={() => handleReviewPluginConfiguration(pluginKey)}
              onAccept={() => handleAcceptPluginConfiguration(pluginKey)}
              onDismiss={() => dismissPluginNotification(pluginKey)}
            />
          );
        })}

        {/* Input Phase - Always show in edit mode */}
        <div className="space-y-4">
          <EditablePhase
            title="Input Phase"
            description="Data Collection & Authentication"
            icon={<Database className="w-6 h-6" />}
            color="blue"
            phase="input"
            steps={getStepsByPhase('input')}
            inputs={getInputsByPhase('input')}
            outputs={getOutputsByPhase('input')}
            showAddPlugin={false}
            onToggleAddPlugin={() => {}}
            onAddStep={(pluginKey) => handleAddStep(pluginKey, 'input')}
            onRemoveStep={handleRemoveStep}
            onUpdateStep={handleUpdateStep}
            onOpenReplaceModal={handlePluginReplacement}
            isConnected={isConnected}
            getPluginConnection={getPluginConnection}
            onAddInput={shouldShowInputsForPhase('input') ? () => handleAddInput('input') : undefined}
            onRemoveInput={shouldShowInputsForPhase('input') ? (index) => handleRemoveInput('input', index) : undefined}
            onUpdateInput={shouldShowInputsForPhase('input') ? (index, updates) => handleUpdateInput('input', index, updates) : undefined}
            onAddOutput={shouldShowOutputsForPhase('input') ? () => handleAddOutput('input') : undefined}
            onRemoveOutput={shouldShowOutputsForPhase('input') ? (index) => handleRemoveOutput('input', index) : undefined}
            onUpdateOutput={shouldShowOutputsForPhase('input') ? (index, updates) => handleUpdateOutput('input', index, updates) : undefined}
            getAvailablePlugins={getAvailablePlugins}
            missingPlugins={currentMissingPlugins}
            allInputs={editableInputs}
            allOutputs={editableOutputs}
            loading={false}
            onReplaceStep={handlePluginReplacement}
            // REMOVED: onGeneratePluginInputs and onClearPluginInputs - using LLM only
          />
        </div>

        {/* Process Phase */}
        <div className="space-y-4">
          <EditablePhase
            title="Process Phase"
            description="Data Processing & Analysis"
            icon={<Zap className="w-6 h-6" />}
            color="purple"
            phase="process"
            steps={getStepsByPhase('process')}
            inputs={getInputsByPhase('process')}
            outputs={getOutputsByPhase('process')}
            showAddPlugin={false}
            onToggleAddPlugin={() => {}}
            onAddStep={(pluginKey) => handleAddStep(pluginKey, 'process')}
            onRemoveStep={handleRemoveStep}
            onUpdateStep={handleUpdateStep}
            onOpenReplaceModal={handlePluginReplacement}
            isConnected={isConnected}
            getPluginConnection={getPluginConnection}
            onAddInput={undefined}
            onRemoveInput={undefined}
            onUpdateInput={undefined}
            onAddOutput={undefined}
            onRemoveOutput={undefined}
            onUpdateOutput={undefined}
            getAvailablePlugins={getAvailablePlugins}
            missingPlugins={currentMissingPlugins}
            allInputs={editableInputs}
            allOutputs={editableOutputs}
            loading={false}
            onReplaceStep={handlePluginReplacement}
          />
        </div>

        {/* Output Phase */}
        <div className="space-y-4">
          <EditablePhase
            title="Output Phase"
            description="Results & Delivery"
            icon={<Download className="w-6 h-6" />}
            color="emerald"
            phase="output"
            steps={getStepsByPhase('output')}
            inputs={getInputsByPhase('output')}
            outputs={getOutputsByPhase('output')}
            showAddPlugin={false}
            onToggleAddPlugin={() => {}}
            onAddStep={(pluginKey) => handleAddStep(pluginKey, 'output')}
            onRemoveStep={handleRemoveStep}
            onUpdateStep={handleUpdateStep}
            onOpenReplaceModal={handlePluginReplacement}
            isConnected={isConnected}
            getPluginConnection={getPluginConnection}
            onAddInput={undefined}
            onRemoveInput={undefined}
            onUpdateInput={undefined}
            onAddOutput={() => handleAddOutput('output')}
            onRemoveOutput={(index) => handleRemoveOutput('output', index)}
            onUpdateOutput={(index, updates) => handleUpdateOutput('output', index, updates)}
            getAvailablePlugins={getAvailablePlugins}
            missingPlugins={currentMissingPlugins}
            allInputs={editableInputs}
            allOutputs={editableOutputs}
            loading={false}
            onReplaceStep={handlePluginReplacement}
            hideInputSection={true}
            hideOutputSection={false}
          />
        </div>
      </div>
    );
  };

  // Loading states (keeping existing logic)
  if (!data.userPrompt || data.userPrompt.trim().length < 10) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-gradient-to-r from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <Brain className="h-10 w-10 text-white" />
        </div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-3">AI Workflow Analysis Ready</h3>
        <p className="text-gray-600 max-w-md mx-auto">
          Enter a detailed workflow description to generate an intelligent automation plan powered by ChatGPT.
        </p>
      </div>
    );
  }

  if (isGenerating) {
    return (
      <div className="text-center py-16">
        <div className="relative">
          <div className="w-20 h-20 bg-gradient-to-r from-blue-500 to-purple-600 rounded-3xl flex items-center justify-center mx-auto mb-6 animate-pulse">
            <Brain className="h-10 w-10 text-white" />
          </div>
          <Loader2 className="h-8 w-8 text-blue-500 animate-spin absolute top-3 left-1/2 transform -translate-x-1/2" />
        </div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-3">ChatGPT Analyzing Workflow</h3>
        <p className="text-gray-600 max-w-lg mx-auto mb-6">
          AI is analyzing your requirements and selecting optimal plugins from {pluginList.length} available options...
        </p>
        <div className="max-w-xs mx-auto">
          <div className="bg-gradient-to-r from-blue-200 to-purple-200 rounded-full h-2">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 h-2 rounded-full animate-pulse transition-all duration-1000" style={{ width: '75%' }}></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-red-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <AlertTriangle className="h-10 w-10 text-red-600" />
        </div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-3">Analysis Failed</h3>
        <p className="text-red-600 mb-6 max-w-md mx-auto">{error}</p>
        <button
          onClick={handleRegeneratePlan}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors font-medium"
        >
          <RefreshCw className="h-5 w-5" />
          Retry Analysis
        </button>
      </div>
    );
  }

  if (!generatedPlan || generatedPlan.steps.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center mx-auto mb-6">
          <Brain className="h-10 w-10 text-gray-400" />
        </div>
        <h3 className="text-2xl font-semibold text-gray-900 mb-3">No Workflow Generated</h3>
        <p className="text-gray-600 mb-6 max-w-md mx-auto">
          ChatGPT couldn't identify a clear workflow from your prompt. Try being more specific about your goals.
        </p>
        <button
          onClick={handleRegeneratePlan}
          className="inline-flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition-colors font-medium"
        >
          <RefreshCw className="h-5 w-5" />
          Try Again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* FIXED: Header with AI Confidence - Added isEditing prop */}
      <WorkflowHeader
        generatedPlan={generatedPlan}
        showAnalysisDetails={showAnalysisDetails}
        onToggleAnalysisDetails={() => setShowAnalysisDetails(!showAnalysisDetails)}
        userPrompt={data.userPrompt}
        isEditing={isEditing} // ADDED: This line fixes the edit mode reasoning display
      />

      {/* Workflow Content with View Mode Toggle */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="border-b bg-gray-50 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Workflow Configuration</h3>
            <div className="flex items-center gap-3">
              <div className="flex bg-gray-200 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('business')}
                  className={`px-3 py-2 text-sm rounded-md transition-colors ${
                    viewMode === 'business' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Business View
                </button>
                <button
                  onClick={() => setViewMode('technical')}
                  className={`px-3 py-2 text-sm rounded-md transition-colors ${
                    viewMode === 'technical' 
                      ? 'bg-white text-gray-900 shadow-sm' 
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  Technical View
                </button>
              </div>
              
              {viewMode === 'technical' && (
                <button 
                  onClick={handleToggleEdit} 
                  className="flex items-center gap-2 px-4 py-2 border-2 border-blue-300 text-blue-700 rounded-xl hover:bg-blue-50 transition-colors font-medium"
                >
                  <Edit3 className="h-4 w-4" />
                  {isEditing ? 'Exit Edit' : 'Edit'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="p-6">
          {viewMode === 'business' ? (
            <BusinessViewSections
              allSteps={allSteps}
              allInputs={allInputs}
              generatedPlan={generatedPlan}
              getConnectionStatus={getConnectionStatus}
              getPhaseColor={getPhaseColor}
              getIconForPlugin={getIconForPlugin}
              findRelatedPluginsForInput={findRelatedPluginsForInput}
              getStepsByPhase={getStepsByPhase}
            />
          ) : isEditing ? (
            <EditModeTechnicalLayout />
          ) : (
            <WorkflowViewer
              generatedPlan={generatedPlan}
              getStepsByPhase={getStepsByPhase}
              getInputsByPhase={getInputsByPhase}
              connectedPlugins={connectedPlugins}
              connectionDetails={connectionDetails}
            />
          )}
        </div>
      </div>

      {/* Warning Messages */}
      {currentMissingPlugins.length > 0 && (
        <div className="bg-gradient-to-r from-red-50 to-red-100 border-2 border-red-300 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-red-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-red-900 mb-2">Plugins Not Available</h4>
              <p className="text-red-800 text-sm mb-4">These plugins are not available in your system:</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {currentMissingPlugins.map(pluginKey => (
                  <span key={pluginKey} className="bg-red-200 text-red-900 px-3 py-1 rounded-full text-sm font-medium">
                    {pluginKey}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {currentUnconnectedPlugins.length > 0 && (
        <div className="bg-gradient-to-r from-yellow-50 to-orange-50 border-2 border-yellow-300 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-yellow-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-yellow-900 mb-2">Connect Required Plugins</h4>
              <p className="text-yellow-800 text-sm mb-4">These plugins need to be connected:</p>
              
              <div className="flex flex-wrap gap-2 mb-4">
                {currentUnconnectedPlugins.map(pluginKey => {
                  const plugin = getPluginByKey(pluginKey);
                  const isActuallyConnected = connectedPlugins.includes(pluginKey);
                  
                  return (
                    <span 
                      key={pluginKey} 
                      className={`px-3 py-1 rounded-full text-sm font-medium ${
                        isActuallyConnected 
                          ? 'bg-green-200 text-green-900' 
                          : 'bg-yellow-200 text-yellow-900'
                      }`}
                    >
                      {plugin?.name || pluginKey}
                      {isActuallyConnected && ' ✓'}
                    </span>
                  );
                })}
              </div>
              <a href="/settings/connections" className="inline-flex items-center gap-2 bg-yellow-600 text-white px-4 py-2 rounded-xl hover:bg-yellow-700 text-sm transition-colors font-medium">
                <ExternalLink className="h-4 w-4" />
                Connect Plugins
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <WorkflowActions
        generatedPlan={generatedPlan}
        isEditing={isEditing}
        viewMode={viewMode}
        currentMissingPlugins={currentMissingPlugins}
        currentUnconnectedPlugins={currentUnconnectedPlugins}
        onEditCancel={handleEditCancel}
        onEditSave={handleEditSave}
        onToggleEdit={handleToggleEdit}
        onRegeneratePlan={handleRegeneratePlan}
        onAcceptPlan={handleAcceptPlan}
      />

      {/* Remove Step Confirmation Modal */}
      <RemoveStepModal
        isOpen={showRemoveConfirmation}
        stepToRemove={stepToRemove}
        onConfirm={handleConfirmRemoveStep}
        onCancel={cancelRemoveStep}
      />
    </div>
  );
}
// Fixed Step2SmartPreview.tsx - Resolved React child rendering error

import React from 'react';
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
  ArrowRight,
  Users,
  FileText,
  Mail,
  Calendar,
  BarChart3,
  Settings,
  Globe,
  Smartphone,
  Monitor,
  PlayCircle,
  Shield,
  Target
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
import type { PluginStep } from './types';

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
    getPluginConnection
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

  // Helper function to get appropriate icon for plugin - Dynamic version
  const getIconForPlugin = (pluginName: string, size: string = "h-6 w-6") => {
    // First try to get the plugin data to use its defined icon
    const plugin = getPluginByKey(pluginName) || editableSteps.find(step => step.pluginName === pluginName);
    
    // If plugin has a defined icon, use it
    if (plugin?.icon) {
      // Handle different icon formats (component, string, etc.)
      if (typeof plugin.icon === 'string') {
        // If it's a string, try to match it to our available icons
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
      // If plugin.icon is already a React component, we could render it here
      // For now, fall through to category-based detection
    }
    
    // Fallback to category-based detection using plugin metadata if available
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
    
    // Final fallback - use a generic monitor icon
    return <Monitor className={size} />;
  };

  // Handle plugin replacement with AI processing banner
  const handlePluginReplacement = (oldStep: PluginStep, newPluginKey: string) => {
    const availablePlugins = getAvailablePlugins();
    const newPlugin = availablePlugins.find(p => p.pluginKey === newPluginKey);
    
    if (!newPlugin) {
      console.error('New plugin not found:', newPluginKey);
      return;
    }

    // Start the replacement process with banner
    startReplacement(oldStep.id, oldStep, newPluginKey, newPlugin.name);
    
    // Update the actual step in the workflow
    const updatedStep = {
      ...oldStep,
      pluginKey: newPluginKey,
      pluginName: newPlugin.name,
      action: newPlugin.action || `Use ${newPlugin.name}`,
      description: newPlugin.description || `Execute ${newPlugin.name} plugin`
    };

    // Call the existing update step handler
    handleUpdateStep(oldStep.id, updatedStep);

    // Update the main data structure
    const updatedSteps = editableSteps.map(step => 
      step.id === oldStep.id ? updatedStep : step
    );

    onUpdate({
      ...data,
      plugins: {
        ...data.plugins,
        steps: updatedSteps
      }
    });
  };

  // Filter replacement banners by phase
  const getReplacementBannersByPhase = (phase: 'input' | 'process' | 'output') => {
    return Object.entries(replacementState)
      .filter(([stepId, replacement]) => 
        getStepsByPhase(phase).some(step => step.id === Number(stepId))
      );
  };

  // Calculate current missing and unconnected plugins based on actual workflow state
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
    
    // Remove duplicates first, then filter
    const uniqueRequiredPlugins = [...new Set(requiredPlugins)];
    
    return uniqueRequiredPlugins.filter(pluginKey => {
      const isSystemPlugin = systemPlugins.includes(pluginKey);
      const isConnectedDirectly = connectedPlugins.includes(pluginKey);
      return !isSystemPlugin && !isConnectedDirectly;
    });
  };

  const currentMissingPlugins = getCurrentMissingPlugins();
  const currentUnconnectedPlugins = getCurrentUnconnectedPlugins();

  // Local wrapper for step removal that also updates main data
  const handleConfirmRemoveStep = (stepToRemoveData: any) => {
    // Call the hook's confirmRemoveStep function
    confirmRemoveStep(stepToRemoveData);
    
    // Also update the main data structure
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
      {/* Header with AI Confidence */}
      <WorkflowHeader
        generatedPlan={generatedPlan}
        showAnalysisDetails={showAnalysisDetails}
        onToggleAnalysisDetails={() => setShowAnalysisDetails(!showAnalysisDetails)}
        userPrompt={data.userPrompt}
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
            <div className="space-y-8">
              {/* COMPLETELY REDESIGNED Horizontal Business View */}
              <div className="bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 rounded-3xl p-8 border-2 border-blue-100 shadow-xl">
                {/* Hero Header */}
                <div className="text-center mb-10">
                  <div className="relative w-20 h-20 bg-gradient-to-br from-blue-500 via-purple-600 to-indigo-700 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                    <Sparkles className="h-10 w-10 text-white" />
                    <div className="absolute -inset-2 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full opacity-20 animate-pulse"></div>
                  </div>
                  <h3 className="text-3xl font-bold bg-gradient-to-r from-gray-900 via-blue-800 to-purple-900 bg-clip-text text-transparent mb-3">
                    Your AI Workflow Journey
                  </h3>
                  <p className="text-gray-600 text-lg font-medium max-w-2xl mx-auto">
                    {(() => {
                      const inputCount = getStepsByPhase('input').length;
                      const processCount = getStepsByPhase('process').length;
                      const outputCount = getStepsByPhase('output').length;
                      const totalSteps = inputCount + processCount + outputCount;
                      
                      let phaseCount = 0;
                      if (inputCount > 0) phaseCount++;
                      if (processCount > 0) phaseCount++;
                      if (outputCount > 0) phaseCount++;
                      
                      return `${phaseCount} phases • ${totalSteps} automated steps • Zero manual effort`;
                    })()}
                  </p>
                </div>

                {/* TRUE Horizontal Cards - Stacked Vertically */}
                <div className="max-w-6xl mx-auto space-y-8">
                  {/* Horizontal Card Layout for Each Phase */}
                  
                  {/* PHASE 1: DATA COLLECTION - Horizontal Card */}
                  {getStepsByPhase('input').length > 0 && (
                    <div className="relative">
                      {/* Phase Badge */}
                      <div className="absolute -top-4 left-8 z-20">
                        <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full border-4 border-white shadow-xl flex items-center justify-center">
                          <span className="text-white font-bold">1</span>
                        </div>
                      </div>

                      {/* Horizontal Card */}
                      <div className="bg-white rounded-2xl shadow-xl border border-blue-100 p-6 pt-10 hover:shadow-2xl transition-all duration-300">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                          
                          {/* Left: Phase Info */}
                          <div className="lg:col-span-3 text-center lg:text-left">
                            <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto lg:mx-0 mb-3">
                              <Database className="h-7 w-7 text-blue-600" />
                            </div>
                            <h4 className="text-xl font-bold text-gray-900 mb-2">Data Collection</h4>
                            <p className="text-gray-600 text-sm mb-3">Gathering from {getStepsByPhase('input').length} source{getStepsByPhase('input').length !== 1 ? 's' : ''}</p>
                            <div className="bg-gradient-to-r from-blue-100 to-blue-200 rounded-lg px-3 py-2">
                              <div className="flex items-center justify-center gap-1 text-blue-800">
                                <Clock className="h-4 w-4" />
                                <span className="text-sm font-bold">2-5 min</span>
                              </div>
                            </div>
                          </div>

                          {/* Middle: Steps */}
                          <div className="lg:col-span-6">
                            <h5 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                              <PlayCircle className="h-4 w-4 text-blue-600" />
                              Automated Steps ({getStepsByPhase('input').length})
                            </h5>
                            <div className="space-y-3">
                              {getStepsByPhase('input').map((step, index) => (
                                <div key={step.id} className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl border border-blue-100 hover:bg-blue-100 transition-colors">
                                  <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center flex-shrink-0 border border-blue-200">
                                    {getIconForPlugin(step.pluginName, "h-5 w-5")}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <h6 className="font-semibold text-gray-900 text-sm">{step.pluginName}</h6>
                                      <span className="text-xs bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full">
                                        {index + 1}
                                      </span>
                                    </div>
                                    <p className="text-gray-700 text-xs">{step.action}</p>
                                  </div>
                                  <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Right: Configuration */}
                          <div className="lg:col-span-3">
                            <h5 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                              <Settings className="h-4 w-4 text-blue-600" />
                              Configuration
                            </h5>
                            {getInputsByPhase('input').length > 0 ? (
                              <div className="space-y-2">
                                {getInputsByPhase('input').slice(0, 3).map((input, index) => (
                                  <div key={index} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                                    <div className="flex items-center justify-between mb-1">
                                      <h6 className="font-medium text-gray-900 text-xs">{input.name}</h6>
                                      {input.required && (
                                        <span className="text-xs bg-red-100 text-red-700 px-1 py-0.5 rounded">Req</span>
                                      )}
                                    </div>
                                    <p className="text-gray-600 text-xs">{input.description}</p>
                                  </div>
                                ))}
                                {getInputsByPhase('input').length > 3 && (
                                  <p className="text-xs text-gray-500 text-center">+{getInputsByPhase('input').length - 3} more</p>
                                )}
                              </div>
                            ) : (
                              <div className="bg-blue-50 rounded-lg p-4 text-center border border-blue-100">
                                <Shield className="h-6 w-6 text-blue-600 mx-auto mb-2" />
                                <p className="text-blue-800 font-medium text-xs">Fully Automated</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Flow Arrow */}
                      {(getStepsByPhase('process').length > 0 || getStepsByPhase('output').length > 0) && (
                        <div className="flex justify-center mt-6">
                          <div className="w-8 h-8 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full flex items-center justify-center shadow-lg">
                            <ArrowRight className="h-4 w-4 text-white rotate-90" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PHASE 2: AI PROCESSING - Horizontal Card */}
                  {getStepsByPhase('process').length > 0 && (
                    <div className="relative">
                      {/* Phase Badge */}
                      <div className="absolute -top-4 left-8 z-20">
                        <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-purple-600 rounded-full border-4 border-white shadow-xl flex items-center justify-center">
                          <span className="text-white font-bold">{getStepsByPhase('input').length > 0 ? '2' : '1'}</span>
                        </div>
                      </div>

                      {/* Horizontal Card */}
                      <div className="bg-white rounded-2xl shadow-xl border border-purple-100 p-6 pt-10 hover:shadow-2xl transition-all duration-300">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                          
                          {/* Left: Phase Info */}
                          <div className="lg:col-span-3 text-center lg:text-left">
                            <div className="w-14 h-14 bg-purple-50 rounded-2xl flex items-center justify-center mx-auto lg:mx-0 mb-3">
                              <Zap className="h-7 w-7 text-purple-600" />
                            </div>
                            <h4 className="text-xl font-bold text-gray-900 mb-2">AI Processing</h4>
                            <p className="text-gray-600 text-sm mb-3">Intelligent analysis & transformation</p>
                            <div className="bg-gradient-to-r from-purple-100 to-purple-200 rounded-lg px-3 py-2">
                              <div className="flex items-center justify-center gap-1 text-purple-800">
                                <Sparkles className="h-4 w-4" />
                                <span className="text-sm font-bold">Real-time</span>
                              </div>
                            </div>
                          </div>

                          {/* Middle: Steps */}
                          <div className="lg:col-span-6">
                            <h5 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-purple-600" />
                              AI Operations ({getStepsByPhase('process').length})
                            </h5>
                            <div className="space-y-3">
                              {getStepsByPhase('process').map((step, index) => (
                                <div key={step.id} className="flex items-center gap-3 p-3 bg-purple-50 rounded-xl border border-purple-100 hover:bg-purple-100 transition-colors">
                                  <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center flex-shrink-0 border border-purple-200">
                                    {getIconForPlugin(step.pluginName, "h-5 w-5")}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <h6 className="font-semibold text-gray-900 text-sm">{step.pluginName}</h6>
                                      <span className="text-xs bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">
                                        AI {index + 1}
                                      </span>
                                    </div>
                                    <p className="text-gray-700 text-xs">{step.action}</p>
                                  </div>
                                  <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Right: AI Intelligence */}
                          <div className="lg:col-span-3">
                            <h5 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-purple-600" />
                              AI Intelligence
                            </h5>
                            <div className="bg-purple-50 rounded-lg p-4 text-center border border-purple-100">
                              <Sparkles className="h-6 w-6 text-purple-600 mx-auto mb-2" />
                              <p className="text-purple-800 font-medium text-xs mb-1">Smart Processing</p>
                              <p className="text-purple-600 text-xs">AI handles analysis automatically</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Flow Arrow */}
                      {getStepsByPhase('output').length > 0 && (
                        <div className="flex justify-center mt-6">
                          <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-emerald-600 rounded-full flex items-center justify-center shadow-lg">
                            <ArrowRight className="h-4 w-4 text-white rotate-90" />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* PHASE 3: RESULTS DELIVERY - Horizontal Card */}
                  {getStepsByPhase('output').length > 0 && (
                    <div className="relative">
                      {/* Phase Badge */}
                      <div className="absolute -top-4 left-8 z-20">
                        <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-full border-4 border-white shadow-xl flex items-center justify-center">
                          <span className="text-white font-bold">
                            {getStepsByPhase('input').length > 0 && getStepsByPhase('process').length > 0 ? '3' : 
                             getStepsByPhase('input').length > 0 || getStepsByPhase('process').length > 0 ? '2' : '1'}
                          </span>
                        </div>
                      </div>

                      {/* Horizontal Card */}
                      <div className="bg-white rounded-2xl shadow-xl border border-emerald-100 p-6 pt-10 hover:shadow-2xl transition-all duration-300">
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                          
                          {/* Left: Phase Info */}
                          <div className="lg:col-span-3 text-center lg:text-left">
                            <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto lg:mx-0 mb-3">
                              <Download className="h-7 w-7 text-emerald-600" />
                            </div>
                            <h4 className="text-xl font-bold text-gray-900 mb-2">Results Delivery</h4>
                            <p className="text-gray-600 text-sm mb-3">To {getStepsByPhase('output').length} destination{getStepsByPhase('output').length !== 1 ? 's' : ''}</p>
                            <div className="bg-gradient-to-r from-emerald-100 to-emerald-200 rounded-lg px-3 py-2">
                              <div className="flex items-center justify-center gap-1 text-emerald-800">
                                <CheckCircle className="h-4 w-4" />
                                <span className="text-sm font-bold">Complete!</span>
                              </div>
                            </div>
                          </div>

                          {/* Middle: Steps */}
                          <div className="lg:col-span-5">
                            <h5 className="text-sm font-bold text-gray-900 mb-4 flex items-center gap-2">
                              <Download className="h-4 w-4 text-emerald-600" />
                              Final Steps ({getStepsByPhase('output').length})
                            </h5>
                            <div className="space-y-3">
                              {getStepsByPhase('output').map((step, index) => (
                                <div key={step.id} className="flex items-center gap-3 p-3 bg-emerald-50 rounded-xl border border-emerald-100 hover:bg-emerald-100 transition-colors">
                                  <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center flex-shrink-0 border border-emerald-200">
                                    {getIconForPlugin(step.pluginName, "h-5 w-5")}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <h6 className="font-semibold text-gray-900 text-sm">{step.pluginName}</h6>
                                      <span className="text-xs bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded-full">
                                        {index + 1}
                                      </span>
                                    </div>
                                    <p className="text-gray-700 text-xs">{step.action}</p>
                                  </div>
                                  <CheckCircle className="h-5 w-5 text-green-500 flex-shrink-0" />
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* Right: Results & Configuration */}
                          <div className="lg:col-span-4 space-y-4">
                            {/* Output Settings */}
                            {getInputsByPhase('output').length > 0 && (
                              <div>
                                <h5 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                                  <Settings className="h-4 w-4 text-emerald-600" />
                                  Settings
                                </h5>
                                <div className="space-y-2">
                                  {getInputsByPhase('output').slice(0, 2).map((input, index) => (
                                    <div key={index} className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                                      <h6 className="font-medium text-gray-900 text-xs mb-1">{input.name}</h6>
                                      <p className="text-gray-600 text-xs">{input.description}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Expected Results */}
                            <div>
                              <h5 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                                <Target className="h-4 w-4 text-emerald-600" />
                                You'll Receive
                              </h5>
                              {(getOutputsByPhase('output').length > 0 || (generatedPlan.outputs && generatedPlan.outputs.length > 0)) ? (
                                <div className="space-y-2">
                                  {(getOutputsByPhase('output').length > 0 ? getOutputsByPhase('output') : generatedPlan.outputs || []).slice(0, 2).map((output, index) => (
                                    <div key={index} className="bg-emerald-50 rounded-lg p-3 border border-emerald-100">
                                      <div className="flex items-center justify-between mb-1">
                                        <h6 className="font-medium text-gray-900 text-xs">{output.type}</h6>
                                        <span className="text-xs bg-emerald-200 text-emerald-800 px-2 py-0.5 rounded">{output.format}</span>
                                      </div>
                                      <p className="text-emerald-700 text-xs">→ {output.destination}</p>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="bg-emerald-50 rounded-lg p-4 text-center border border-emerald-100">
                                  <Target className="h-6 w-6 text-emerald-600 mx-auto mb-2" />
                                  <p className="text-emerald-800 font-medium text-xs">Auto Delivery</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Summary Section */}
                <div className="mt-8 pt-6 border-t border-gray-200">
                  <div className="bg-gradient-to-r from-gray-50 to-blue-50 rounded-2xl p-6 text-center">
                    <div className="flex items-center justify-center gap-3 mb-4">
                      <PlayCircle className="h-6 w-6 text-blue-600" />
                      <h5 className="text-lg font-bold text-gray-900">Ready to Execute</h5>
                    </div>
                    <p className="text-gray-700 mb-4">
                      Your workflow contains <span className="font-bold text-blue-600">{generatedPlan.steps.length} automated steps</span> that will run seamlessly
                    </p>
                    <div className="flex items-center justify-center gap-6 text-sm text-gray-600">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-green-500" />
                        <span>Secure</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-blue-500" />
                        <span>Automated</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <CheckCircle className="h-4 w-4 text-emerald-500" />
                        <span>Zero Effort</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : isEditing ? (
            <div className="space-y-6">
              {/* Technical editing view - keeping existing implementation */}
              {getReplacementBannersByPhase('input').map(([stepId, replacement]) => (
                <PluginNotificationBanner
                  key={`replacement-input-${stepId}`}
                  pluginKey={replacement.newPluginKey}
                  step={replacement.oldStep}
                  replacementNotification={{
                    type: 'replacement',
                    oldStep: replacement.oldStep,
                    newPluginKey: replacement.newPluginKey,
                    newPluginName: replacement.newPluginName,
                    status: replacement.status,
                    error: replacement.error
                  }}
                  onDismiss={() => dismissReplacement(Number(stepId))}
                />
              ))}

              {getStepsByPhase('input').map(step => 
                newlyAddedPlugins.includes(step.pluginKey) && (
                  <PluginNotificationBanner 
                    key={`input-${step.pluginKey}`} 
                    pluginKey={step.pluginKey} 
                    step={step}
                    notification={pluginNotifications[step.pluginKey]}
                    onReview={handleReviewPluginConfiguration}
                    onAccept={handleAcceptPluginConfiguration}
                    onDismiss={dismissPluginNotification}
                  />
                )
              )}

              <EditablePhase
                title="Input Phase"
                description="Data collection and retrieval"
                icon={<Database className="h-6 w-6" />}
                color="blue"
                phase="input"
                steps={getStepsByPhase('input')}
                inputs={getInputsByPhase('input')}
                outputs={[]}
                showAddPlugin={false}
                onToggleAddPlugin={() => {}}
                onAddStep={(pluginKey) => handleAddStep(pluginKey, 'input')}
                onRemoveStep={handleRemoveStep}
                onUpdateStep={handleUpdateStep}
                onOpenReplaceModal={() => {}}
                isConnected={isConnected}
                getPluginConnection={getPluginConnection}
                onAddInput={() => handleAddInput('input')}
                onRemoveInput={(localIndex) => handleRemoveInput('input', localIndex)}
                onUpdateInput={(localIndex, updates) => handleUpdateInput('input', localIndex, updates)}
                onAddOutput={() => {}}
                onRemoveOutput={() => {}}
                onUpdateOutput={() => {}}
                getAvailablePlugins={getAvailablePlugins}
                missingPlugins={generatedPlan.missingPlugins}
                allInputs={editableInputs}
                allOutputs={editableOutputs}
                loading={false}
                onReplaceStep={handlePluginReplacement}
              />

              {getReplacementBannersByPhase('process').map(([stepId, replacement]) => (
                <PluginNotificationBanner
                  key={`replacement-process-${stepId}`}
                  pluginKey={replacement.newPluginKey}
                  step={replacement.oldStep}
                  replacementNotification={{
                    type: 'replacement',
                    oldStep: replacement.oldStep,
                    newPluginKey: replacement.newPluginKey,
                    newPluginName: replacement.newPluginName,
                    status: replacement.status,
                    error: replacement.error
                  }}
                  onDismiss={() => dismissReplacement(Number(stepId))}
                />
              ))}

              {getStepsByPhase('process').map(step => 
                newlyAddedPlugins.includes(step.pluginKey) && (
                  <PluginNotificationBanner 
                    key={`process-${step.pluginKey}`} 
                    pluginKey={step.pluginKey} 
                    step={step}
                    notification={pluginNotifications[step.pluginKey]}
                    onReview={handleReviewPluginConfiguration}
                    onAccept={handleAcceptPluginConfiguration}
                    onDismiss={dismissPluginNotification}
                  />
                )
              )}

              <EditablePhase
                title="Process Phase"
                description="Analysis and transformation - Steps configured automatically"
                icon={<Zap className="h-6 w-6" />}
                color="purple"
                phase="process"
                steps={getStepsByPhase('process')}
                inputs={[]}
                outputs={[]}
                showAddPlugin={false}
                onToggleAddPlugin={() => {}}
                onAddStep={() => {}}
                onRemoveStep={handleRemoveStep}
                onUpdateStep={handleUpdateStep}
                onOpenReplaceModal={() => {}}
                isConnected={isConnected}
                getPluginConnection={getPluginConnection}
                onAddInput={() => {}}
                onRemoveInput={() => {}}
                onUpdateInput={() => {}}
                onAddOutput={() => {}}
                onRemoveOutput={() => {}}
                onUpdateOutput={() => {}}
                getAvailablePlugins={getAvailablePlugins}
                missingPlugins={generatedPlan.missingPlugins}
                allInputs={[]}
                allOutputs={[]}
                loading={false}
                hideInputsOutputs={true}
                onReplaceStep={handlePluginReplacement}
              />

              {getReplacementBannersByPhase('output').map(([stepId, replacement]) => (
                <PluginNotificationBanner
                  key={`replacement-output-${stepId}`}
                  pluginKey={replacement.newPluginKey}
                  step={replacement.oldStep}
                  replacementNotification={{
                    type: 'replacement',
                    oldStep: replacement.oldStep,
                    newPluginKey: replacement.newPluginKey,
                    newPluginName: replacement.newPluginName,
                    status: replacement.status,
                    error: replacement.error
                  }}
                  onDismiss={() => dismissReplacement(Number(stepId))}
                />
              ))}

              {getStepsByPhase('output').map(step => 
                newlyAddedPlugins.includes(step.pluginKey) && (
                  <PluginNotificationBanner 
                    key={`output-${step.pluginKey}`} 
                    pluginKey={step.pluginKey} 
                    step={step}
                    notification={pluginNotifications[step.pluginKey]}
                    onReview={handleReviewPluginConfiguration}
                    onAccept={handleAcceptPluginConfiguration}
                    onDismiss={dismissPluginNotification}
                  />
                )
              )}

              <EditablePhase
                title="Output Phase"
                description="Delivery and storage"
                icon={<Download className="h-6 w-6" />}
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
                onOpenReplaceModal={() => {}}
                isConnected={isConnected}
                getPluginConnection={getPluginConnection}
                onAddInput={() => handleAddInput('output')}
                onRemoveInput={(localIndex) => handleRemoveInput('output', localIndex)}
                onUpdateInput={(localIndex, updates) => handleUpdateInput('output', localIndex, updates)}
                onAddOutput={() => handleAddOutput('output')}
                onRemoveOutput={(localIndex) => handleRemoveOutput('output', localIndex)}
                onUpdateOutput={(localIndex, updates) => handleUpdateOutput('output', localIndex, updates)}
                getAvailablePlugins={getAvailablePlugins}
                missingPlugins={generatedPlan.missingPlugins}
                allInputs={editableInputs}
                allOutputs={editableOutputs}
                loading={false}
                onReplaceStep={handlePluginReplacement}
              />
            </div>
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
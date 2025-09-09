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
  Zap
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
    onUpdate,
    regeneratePlan: workflowData.regeneratePlan // ADD THIS CRITICAL LINE
  });

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
    
    return requiredPlugins.filter(pluginKey => {
      const isSystemPlugin = systemPlugins.includes(pluginKey);
      const isConnectedDirectly = connectedPlugins.includes(pluginKey);
      return !isSystemPlugin && !isConnectedDirectly;
    });
  };

  const currentMissingPlugins = getCurrentMissingPlugins();
  const currentUnconnectedPlugins = getCurrentUnconnectedPlugins();

  // Loading states
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
              {/* Workflow Visual Diagram */}
              <div className="bg-gradient-to-br from-gray-50 to-blue-50 rounded-xl p-6 border border-gray-200">
                <h4 className="text-lg font-semibold text-gray-900 mb-6 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-blue-600" />
                  How Your Workflow Works
                </h4>
                
                {/* Simple Flow */}
                <div className="flex items-center justify-between max-w-4xl mx-auto">
                  {/* Step 1 - Data Collection */}
                  <div className="flex-1 text-center">
                    <div className="w-16 h-16 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-3">
                      <Database className="h-8 w-8 text-white" />
                    </div>
                    <h5 className="font-semibold text-gray-900 mb-1">Collect Data</h5>
                    <p className="text-sm text-gray-600 mb-3">
                      Gather information from {getStepsByPhase('input').length} source{getStepsByPhase('input').length !== 1 ? 's' : ''}
                    </p>
                    <div className="space-y-1">
                      {getStepsByPhase('input').slice(0, 2).map(step => (
                        <div key={step.id} className="text-xs text-gray-500">
                          {step.pluginName}
                        </div>
                      ))}
                      {getStepsByPhase('input').length > 2 && (
                        <div className="text-xs text-gray-400">
                          +{getStepsByPhase('input').length - 2} more
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Arrow */}
                  {getStepsByPhase('input').length > 0 && (getStepsByPhase('process').length > 0 || getStepsByPhase('output').length > 0) && (
                    <div className="flex-shrink-0 mx-4">
                      <div className="w-8 h-1 bg-gray-300"></div>
                      <div className="w-0 h-0 border-l-8 border-l-gray-300 border-t-4 border-t-transparent border-b-4 border-b-transparent ml-8 -mt-2"></div>
                    </div>
                  )}

                  {/* Step 2 - Processing (if exists) */}
                  {getStepsByPhase('process').length > 0 && (
                    <>
                      <div className="flex-1 text-center">
                        <div className="w-16 h-16 bg-purple-500 rounded-full flex items-center justify-center mx-auto mb-3">
                          <Zap className="h-8 w-8 text-white" />
                        </div>
                        <h5 className="font-semibold text-gray-900 mb-1">Process</h5>
                        <p className="text-sm text-gray-600 mb-3">
                          Analyze and transform data
                        </p>
                        <div className="space-y-1">
                          {getStepsByPhase('process').slice(0, 2).map(step => (
                            <div key={step.id} className="text-xs text-gray-500">
                              {step.pluginName}
                            </div>
                          ))}
                          {getStepsByPhase('process').length > 2 && (
                            <div className="text-xs text-gray-400">
                              +{getStepsByPhase('process').length - 2} more
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Arrow */}
                      {getStepsByPhase('output').length > 0 && (
                        <div className="flex-shrink-0 mx-4">
                          <div className="w-8 h-1 bg-gray-300"></div>
                          <div className="w-0 h-0 border-l-8 border-l-gray-300 border-t-4 border-t-transparent border-b-4 border-b-transparent ml-8 -mt-2"></div>
                        </div>
                      )}
                    </>
                  )}

                  {/* Step 3 - Delivery */}
                  {getStepsByPhase('output').length > 0 && (
                    <div className="flex-1 text-center">
                      <div className="w-16 h-16 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Download className="h-8 w-8 text-white" />
                      </div>
                      <h5 className="font-semibold text-gray-900 mb-1">Deliver Results</h5>
                      <p className="text-sm text-gray-600 mb-3">
                        Send to {getStepsByPhase('output').length} destination{getStepsByPhase('output').length !== 1 ? 's' : ''}
                      </p>
                      <div className="space-y-1">
                        {getStepsByPhase('output').slice(0, 2).map(step => (
                          <div key={step.id} className="text-xs text-gray-500">
                            {step.pluginName}
                          </div>
                        ))}
                        {getStepsByPhase('output').length > 2 && (
                          <div className="text-xs text-gray-400">
                            +{getStepsByPhase('output').length - 2} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Simple Summary */}
                <div className="mt-8 pt-6 border-t border-gray-200 text-center">
                  <p className="text-sm text-gray-600">
                    Your workflow will automatically run these {generatedPlan.steps.length} steps to complete your task
                  </p>
                </div>
              </div>

              {/* Configuration Section */}
              <SmartBusinessWorkflowConfig
                editableInputs={editableInputs}
                editableOutputs={editableOutputs}
                onUpdateInput={handleUpdateInput}
                onUpdateOutput={handleUpdateOutput}
                onAddInput={() => handleAddInput('input')}
                onAddOutput={() => handleAddOutput('output')}
                onRemoveInput={(index) => handleRemoveInput('input', index)}
                onRemoveOutput={(index) => handleRemoveOutput('output', index)}
              />
            </div>
          ) : isEditing ? (
            <div className="space-y-6">
              {/* Show notifications before each phase */}
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
                outputs={getOutputsByPhase('input')}
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
                onAddOutput={() => handleAddOutput('input')}
                onRemoveOutput={(localIndex) => handleRemoveOutput('input', localIndex)}
                onUpdateOutput={(localIndex, updates) => handleUpdateOutput('input', localIndex, updates)}
                getAvailablePlugins={getAvailablePlugins}
                missingPlugins={generatedPlan.missingPlugins}
                allInputs={editableInputs}
                allOutputs={editableOutputs}
                loading={false}
              />

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
                description="Analysis and transformation - Configure processing steps only"
                icon={<Zap className="h-6 w-6" />}
                color="purple"
                phase="process"
                steps={getStepsByPhase('process')}
                inputs={[]}
                outputs={[]}
                showAddPlugin={false}
                onToggleAddPlugin={() => {}}
                onAddStep={(pluginKey) => handleAddStep(pluginKey, 'process')}
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
              />

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
        onConfirm={confirmRemoveStep}
        onCancel={cancelRemoveStep}
      />
    </div>
  );
}
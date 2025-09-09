// Enhanced EditablePhase.tsx - Added hideInputsOutputs prop support

import React, { useState } from 'react';
import {
  Plus,
  Database,
  Settings,
  FileText,
  Loader2,
  XCircle,
  ExternalLink,
  Save,
  X,
  Edit3,
  Trash2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  User,
  Clock,
  CalendarDays
} from 'lucide-react';
import { EditableInput } from './EditableInput';
import { EditableOutput } from './EditableOutput';
import { AllPluginsBrowserModal } from './AllPluginsBrowserModal';
import type { PluginStep, RequiredInput, Output, PluginConnection, PluginCategory } from './types';

interface EditablePhaseProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: 'blue' | 'purple' | 'emerald';
  phase: 'input' | 'process' | 'output';
  steps: PluginStep[];
  inputs: RequiredInput[];
  outputs: Output[];
  showAddPlugin: boolean;
  onToggleAddPlugin: () => void;
  onAddStep: (pluginKey: string) => void;
  onRemoveStep: (stepId: number) => void;
  onUpdateStep: (stepId: number, updates: Partial<PluginStep>) => void;
  onOpenReplaceModal: (step: PluginStep) => void;
  isConnected: (pluginKey: string) => boolean;
  getPluginConnection: (pluginKey: string) => PluginConnection | null;
  onAddInput: () => void;
  onRemoveInput: (index: number) => void;
  onUpdateInput: (index: number, updates: Partial<RequiredInput>) => void;
  onAddOutput: () => void;
  onRemoveOutput: (index: number) => void;
  onUpdateOutput: (index: number, updates: Partial<Output>) => void;
  getAvailablePlugins: () => any[];
  missingPlugins: string[];
  allInputs: RequiredInput[];
  allOutputs: Output[];
  loading: boolean;
  onReplaceStep?: (oldStep: PluginStep, newPluginKey: string) => void;
  hideInputsOutputs?: boolean; // NEW: Optional prop to hide inputs/outputs sections
}

// Enhanced EditableStepCard component with proper replacement handling
const EditableStepCard: React.FC<{
  step: PluginStep;
  color: 'blue' | 'purple' | 'emerald';
  onRemove: () => void;
  onUpdate: (updates: Partial<PluginStep>) => void;
  onOpenReplaceModal: () => void;
  isConnected: (pluginKey: string) => boolean;
  getPluginConnection: (pluginKey: string) => PluginConnection | null;
  isMissing: boolean;
}> = ({
  step,
  color,
  onRemove,
  onUpdate,
  onOpenReplaceModal,
  isConnected,
  getPluginConnection,
  isMissing
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localStep, setLocalStep] = useState(step);

  const colorClasses = {
    blue: { 
      bg: 'bg-blue-50', 
      border: 'border-blue-200', 
      button: 'bg-blue-600', 
      text: 'text-blue-700', 
      badge: 'bg-blue-100' 
    },
    purple: { 
      bg: 'bg-purple-50', 
      border: 'border-purple-200', 
      button: 'bg-purple-600', 
      text: 'text-purple-700', 
      badge: 'bg-purple-100' 
    },
    emerald: { 
      bg: 'bg-emerald-50', 
      border: 'border-emerald-200', 
      button: 'bg-emerald-600', 
      text: 'text-emerald-700', 
      badge: 'bg-emerald-100' 
    }
  };

  const colors = colorClasses[color];

  // Connection status logic with proper data transformation
  const getConnectionStatus = () => {
    if (['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'].includes(step.pluginKey)) {
      return { 
        status: 'connected', 
        icon: <CheckCircle2 className="h-4 w-4 text-green-600" />, 
        color: 'text-green-600',
        details: null,
        isTrulyMissing: false
      };
    }
    
    const pluginConnected = isConnected(step.pluginKey);
    const connection = getPluginConnection(step.pluginKey);
    
    if (pluginConnected && connection) {
      const connectedAtValue = connection.connected_at || connection.created_at || connection.last_used;
      const lastUsedValue = connection.last_used;
      
      const transformedDetails = {
        username: connection.username || connection.email,
        email: connection.email,
        connectedAt: connectedAtValue,
        lastUsed: lastUsedValue,
        status: connection.status,
        profileData: connection.profile_data || connection.profileData,
        ...connection
      };
      
      return { 
        status: 'connected', 
        icon: <CheckCircle2 className="h-4 w-4 text-green-600" />, 
        color: 'text-green-600',
        details: transformedDetails,
        isTrulyMissing: false
      };
    }
    
    // Check if plugin is truly missing vs just disconnected
    const isTrulyMissing = isMissing;
    
    return { 
      status: isTrulyMissing ? 'missing' : 'disconnected', 
      icon: <AlertTriangle className="h-4 w-4 text-yellow-600" />, 
      color: 'text-yellow-600',
      details: null,
      isTrulyMissing
    };
  };

  const connectionStatus = getConnectionStatus();

  const handleSave = () => {
    if (localStep.action?.trim() && localStep.description?.trim()) {
      onUpdate(localStep);
      setIsEditing(false);
    }
  };

  const handleCancel = () => {
    setLocalStep(step);
    setIsEditing(false);
  };

  // Date formatting functions with proper null checking
  const formatDate = (dateString: string) => {
    if (!dateString) return 'Unknown';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Unknown';
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return 'Unknown';
    }
  };

  const formatRelativeTime = (dateString: string) => {
    if (!dateString) return 'Never';
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Never';
      const now = new Date();
      const diffInHours = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60));
      
      if (diffInHours < 1) return 'Just now';
      if (diffInHours < 24) return `${diffInHours}h ago`;
      if (diffInHours < 168) return `${Math.floor(diffInHours / 24)}d ago`;
      return formatDate(dateString);
    } catch {
      return 'Unknown';
    }
  };

  return (
    <div className={`bg-white border rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow border-gray-200 ${connectionStatus.isTrulyMissing ? 'ring-2 ring-red-200 bg-red-50/20' : ''}`}>
      {isEditing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Action Description</label>
            <input
              value={localStep.action || ''}
              onChange={(e) => setLocalStep(prev => ({...prev, action: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Step action"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Detailed Description</label>
            <textarea
              value={localStep.description || ''}
              onChange={(e) => setLocalStep(prev => ({...prev, description: e.target.value}))}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              placeholder="Step description"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm hover:bg-emerald-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-xl text-sm hover:bg-gray-700 transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          {/* FIXED: Only show "Plugin Not Available" warning for truly missing plugins */}
          {connectionStatus.isTrulyMissing && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl">
              <div className="flex items-center gap-2 text-red-700 text-sm font-medium">
                <AlertTriangle className="h-4 w-4" />
                Plugin Not Available
              </div>
              <p className="text-red-600 text-xs mt-1">
                This plugin is not currently available in your system. Consider replacing it with an alternative.
              </p>
            </div>
          )}

          <div className="flex items-start gap-4 mb-4">
            <div className={`w-10 h-10 ${colors.button} rounded-2xl flex items-center justify-center text-white font-bold flex-shrink-0`}>
              {step.order}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="text-xl flex-shrink-0">{step.icon}</div>
                  <div className="min-w-0 flex-1">
                    <h5 className="font-bold text-gray-900 truncate">{step.pluginName}</h5>
                    <div className="flex items-center gap-1 mt-1">
                      {connectionStatus.icon}
                      <span className={`text-xs font-medium ${connectionStatus.color}`}>
                        {connectionStatus.status === 'connected' ? 'Connected' : 
                         connectionStatus.status === 'missing' ? 'Missing' : 'Not Connected'}
                      </span>
                      {/* FIXED: Only show Missing badge for truly missing plugins */}
                      {connectionStatus.isTrulyMissing && (
                        <span className="text-xs text-red-600 font-medium ml-2">• Missing</span>
                      )}
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-1 ml-2 flex-shrink-0">
                  <button
                    onClick={onOpenReplaceModal}
                    className="p-1.5 text-blue-500 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                    title="Replace plugin"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                    title="Edit step"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={onRemove}
                    className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                    title="Remove step"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              
              <div className={`${colors.text} ${colors.badge} px-4 py-2 rounded-xl mb-3 inline-block font-medium`}>
                {step.action}
              </div>
              <p className="text-gray-700 leading-relaxed">{step.description}</p>
            </div>
          </div>
          
          {/* Connection details with proper date handling */}
          {connectionStatus.status === 'connected' && connectionStatus.details && (
            <div className="bg-white rounded-lg p-3 border border-gray-200 space-y-2 mt-3">
              <div className="flex items-center gap-2 text-xs text-gray-600">
                <User className="h-3 w-3" />
                <span className="font-medium">
                  {connectionStatus.details.email || connectionStatus.details.username || 'Connected Account'}
                </span>
              </div>
              
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center gap-1">
                  <CalendarDays className="h-3 w-3" />
                  <span>Connected: {formatDate(connectionStatus.details.connectedAt)}</span>
                </div>
                
                {connectionStatus.details.lastUsed && (
                  <div className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    <span>Used: {formatRelativeTime(connectionStatus.details.lastUsed)}</span>
                  </div>
                )}
              </div>

              {/* Profile picture if available */}
              {connectionStatus.details.profileData?.picture && (
                <div className="flex items-center gap-2 pt-1">
                  <img 
                    src={connectionStatus.details.profileData.picture} 
                    alt="Profile" 
                    className="w-5 h-5 rounded-full"
                  />
                  <span className="text-xs text-gray-600">
                    {connectionStatus.details.profileData.name || 'Account Profile'}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Connection warning for unconnected plugins */}
          {connectionStatus.status === 'disconnected' && (
            <div className="bg-yellow-50 rounded-lg p-3 border border-gray-200 mt-3">
              <p className="text-xs text-yellow-800">
                This plugin needs to be connected to execute this workflow step.
              </p>
              <div className="flex items-center gap-3 mt-2">
                <a 
                  href="/settings/connections" 
                  className="text-xs text-yellow-700 hover:text-yellow-900 underline"
                >
                  Connect {step.pluginName} →
                </a>
                <button
                  onClick={onOpenReplaceModal}
                  className="text-xs text-blue-700 hover:text-blue-900 underline"
                >
                  Or replace with another plugin
                </button>
              </div>
            </div>
          )}

          {/* Missing plugin warning - only shown for truly missing plugins */}
          {connectionStatus.status === 'missing' && (
            <div className="bg-red-50 rounded-lg p-3 border border-red-200 mt-3">
              <p className="text-xs text-red-800">
                This plugin is not available in your system.
              </p>
              <button
                onClick={onOpenReplaceModal}
                className="text-xs text-red-700 hover:text-red-900 underline mt-1 inline-block"
              >
                Replace with available plugin →
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const EditablePhase: React.FC<EditablePhaseProps> = ({
  title,
  description,
  icon,
  color,
  phase,
  steps,
  inputs,
  outputs,
  showAddPlugin,
  onToggleAddPlugin,
  onAddStep,
  onRemoveStep,
  onUpdateStep,
  onOpenReplaceModal,
  isConnected,
  getPluginConnection,
  onAddInput,
  onRemoveInput,
  onUpdateInput,
  onAddOutput,
  onRemoveOutput,
  onUpdateOutput,
  getAvailablePlugins,
  missingPlugins,
  allInputs,
  allOutputs,
  loading,
  onReplaceStep,
  hideInputsOutputs = false // NEW: Default to false to maintain existing behavior
}) => {
  const [showPluginBrowser, setShowPluginBrowser] = useState(false);
  const [replacingStep, setReplacingStep] = useState<PluginStep | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<PluginCategory | 'all' | 'system'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showConnectedOnly, setShowConnectedOnly] = useState(false);

  const colorClasses = {
    blue: {
      gradient: 'from-blue-500 to-blue-600',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      stepBg: 'bg-blue-50/50',
      stepBorder: 'border-blue-200',
      buttonBg: 'bg-blue-600 hover:bg-blue-700',
      text: 'text-blue-700',
      accent: 'bg-blue-100'
    },
    purple: {
      gradient: 'from-purple-500 to-purple-600',
      bg: 'bg-purple-50',
      border: 'border-purple-200',
      stepBg: 'bg-purple-50/50',
      stepBorder: 'border-purple-200',
      buttonBg: 'bg-purple-600 hover:bg-purple-700',
      text: 'text-purple-700',
      accent: 'bg-purple-100'
    },
    emerald: {
      gradient: 'from-emerald-500 to-emerald-600',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      stepBg: 'bg-emerald-50/50',
      stepBorder: 'border-emerald-200',
      buttonBg: 'bg-emerald-600 hover:bg-emerald-700',
      text: 'text-emerald-700',
      accent: 'bg-emerald-100'
    }
  };

  const colors = colorClasses[color];
  const availablePlugins = getAvailablePlugins();

  // Enhanced replace step handler
  const handleReplaceStep = (step: PluginStep) => {
    setReplacingStep(step);
    setShowPluginBrowser(true);
    // Reset filters to show all options when replacing
    setSearchQuery('');
    setSelectedCategory('all');
    setShowConnectedOnly(false);
  };

  // Internal replacement handler - works even if parent doesn't provide onReplaceStep
  const handleInternalReplacement = (oldStep: PluginStep, newPluginKey: string) => {
    console.log('Internal replacement handler called:', oldStep.id, newPluginKey);
    
    // Find the new plugin details
    const availablePlugins = getAvailablePlugins();
    const newPlugin = availablePlugins.find(p => p.pluginKey === newPluginKey);
    if (!newPlugin) {
      console.error('New plugin not found:', newPluginKey);
      return;
    }

    // Create the updated step with new plugin info but keep same id/order
    const updatedStep = {
      ...oldStep,
      pluginKey: newPluginKey,
      pluginName: newPlugin.name,
      icon: newPlugin.icon,
      action: newPlugin.action || `Use ${newPlugin.name}`,
      description: newPlugin.description || `Execute ${newPlugin.name} plugin`
    };

    // Use the existing onUpdateStep function to replace the step
    onUpdateStep(oldStep.id, updatedStep);
  };

  // Enhanced plugin selection handler with replacement logic
  const handlePluginSelection = (pluginKey: string, selectedPhase?: 'input' | 'process' | 'output') => {
    console.log('handlePluginSelection called:', { 
      pluginKey, 
      replacingStep: replacingStep?.id, 
      isReplacement: replacingStep !== null,
      onReplaceStepExists: typeof onReplaceStep === 'function'
    });
    
    if (replacingStep !== null) {
      // We're in replacement mode
      if (typeof onReplaceStep === 'function') {
        // Use parent's replacement function if provided
        console.log('Using parent onReplaceStep for step:', replacingStep.id, 'with plugin:', pluginKey);
        onReplaceStep(replacingStep, pluginKey);
      } else {
        // Fall back to internal replacement logic
        console.log('Using internal replacement for step:', replacingStep.id, 'with plugin:', pluginKey);
        handleInternalReplacement(replacingStep, pluginKey);
      }
      
      setReplacingStep(null);
      setShowPluginBrowser(false);
      return; // Exit early to avoid calling onAddStep
    } 
    
    // We're adding a new step
    console.log('Adding new step with plugin:', pluginKey);
    onAddStep(pluginKey);
    setShowPluginBrowser(false);
  };

  // Enhanced modal close handler
  const handleCloseModal = () => {
    setShowPluginBrowser(false);
    setReplacingStep(null);
    setSearchQuery('');
    setSelectedCategory('all');
    setShowConnectedOnly(false);
  };

  const getFilteredPlugins = () => {
    let filtered = availablePlugins;

    if (showConnectedOnly) {
      filtered = filtered.filter(plugin => isConnected(plugin.pluginKey));
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter(plugin => plugin.category === selectedCategory);
    }

    if (searchQuery) {
      filtered = filtered.filter(plugin => 
        plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        plugin.description.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    return filtered;
  };

  return (
    <>
      <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-3xl overflow-hidden shadow-xl">
        <div className={`bg-gradient-to-r ${colors.gradient} px-8 py-6`}>
          <div className="flex items-center justify-between text-white">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-2xl">
                {icon}
              </div>
              <div>
                <h3 className="text-xl font-bold">{title}</h3>
                <p className="text-white/90">
                  {/* UPDATED: Conditional description based on hideInputsOutputs */}
                  {hideInputsOutputs 
                    ? `${description} • ${steps.length} steps` 
                    : `${description} • ${steps.length} steps, ${inputs.length} inputs, ${outputs.length} outputs`
                  }
                </p>
              </div>
            </div>
            <button
              onClick={() => setShowPluginBrowser(true)}
              className="bg-white/20 hover:bg-white/30 p-3 rounded-2xl transition-colors disabled:opacity-50"
              disabled={loading}
              title="Add new plugin step"
            >
              <Plus className="w-6 h-6" />
            </button>
          </div>
        </div>

        <div className="p-8 space-y-8">
          {/* Steps Section */}
          <div>
            <div className="flex items-center justify-between mb-6">
              <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-3">
                <Database className="w-5 h-5" />
                Workflow Steps ({steps.length})
              </h4>
            </div>
            
            {steps.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {steps.map((step) => (
                  <EditableStepCard
                    key={step.id}
                    step={step}
                    color={color}
                    onRemove={() => onRemoveStep(step.id)}
                    onUpdate={(updates) => onUpdateStep(step.id, updates)}
                    onOpenReplaceModal={() => handleReplaceStep(step)}
                    isConnected={isConnected}
                    getPluginConnection={getPluginConnection}
                    isMissing={missingPlugins.includes(step.pluginKey)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 border-2 border-dashed border-gray-200 rounded-2xl">
                <div className="p-4 bg-gray-50 rounded-2xl w-fit mx-auto mb-4">
                  {icon}
                </div>
                <p className="text-gray-600 mb-4">No {title.toLowerCase()} steps defined</p>
                <button
                  onClick={() => setShowPluginBrowser(true)}
                  className={`${colors.buttonBg} text-white px-6 py-3 rounded-xl transition-all font-medium`}
                  disabled={loading}
                >
                  Add First Step
                </button>
              </div>
            )}

            {showAddPlugin && (
              <div className="mt-6 p-6 bg-gray-50 rounded-2xl border-t">
                <h5 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  Add Plugin from Available Plugins
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                </h5>
                {loading ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 w-8 animate-spin text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-500">Loading plugin connections...</p>
                  </div>
                ) : availablePlugins.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {availablePlugins.slice(0, 8).map((plugin) => (
                      <button
                        key={plugin.pluginKey}
                        onClick={() => onAddStep(plugin.pluginKey)}
                        className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl hover:bg-white hover:shadow-md text-left transition-all group"
                      >
                        <div className="text-lg group-hover:scale-110 transition-transform">
                          {plugin.icon}
                        </div>
                        <span className="font-medium truncate text-sm">{plugin.name}</span>
                      </button>
                    ))}
                    
                    {availablePlugins.length > 8 && (
                      <button
                        onClick={() => setShowPluginBrowser(true)}
                        className="flex items-center gap-3 p-3 border-2 border-dashed border-gray-300 rounded-xl hover:bg-gray-50 text-left transition-all text-gray-600"
                      >
                        <Plus className="w-5 h-5" />
                        <span className="font-medium text-sm">+{availablePlugins.length - 8} more</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <XCircle className="w-8 h-8 mx-auto mb-3 text-gray-400" />
                    <p className="text-gray-600 mb-3">No connected plugins available</p>
                    <p className="text-sm text-gray-500 mb-4">
                      Connect plugins to expand your workflow capabilities
                    </p>
                    <a 
                      href="/settings/connections"
                      className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Connect plugins in settings
                    </a>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* UPDATED: Conditionally render inputs and outputs sections */}
          {!hideInputsOutputs && (
            <>
              {/* Configuration Inputs Section - FIXED with proper input handling */}
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-3">
                    <Settings className="w-5 h-5" />
                    Configuration Inputs ({inputs.length})
                  </h4>
                  <button
                    onClick={onAddInput}
                    className={`${colors.buttonBg} text-white p-2 rounded-xl transition-all`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {inputs.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {inputs.map((input, index) => (
                      <EditableInput
                        key={`${phase}-input-${index}-${input.name || input.label || 'untitled'}`}
                        input={{
                          ...input,
                          // Ensure all required properties are present with fallbacks
                          name: input.name || input.label || `input-${index}`,
                          label: input.label || input.name || `Input ${index + 1}`,
                          type: input.type || 'text',
                          description: input.description || '',
                          required: input.required ?? true,
                          placeholder: input.placeholder || '',
                          defaultValue: input.defaultValue || ''
                        }}
                        index={index}
                        onUpdate={(updates) => onUpdateInput(index, updates)}
                        onRemove={() => onRemoveInput(index)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl">
                    <Settings className="w-8 h-8 mx-auto mb-3 text-gray-400" />
                    <p className="text-gray-600 mb-3">No configuration inputs for this phase</p>
                    <button
                      onClick={onAddInput}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Add configuration input
                    </button>
                  </div>
                )}
              </div>

              {/* Expected Outputs Section - FIXED with proper output handling */}
              <div>
                <div className="flex items-center justify-between mb-6">
                  <h4 className="text-lg font-semibold text-gray-900 flex items-center gap-3">
                    <FileText className="w-5 h-5" />
                    Expected Outputs ({outputs.length})
                  </h4>
                  <button
                    onClick={onAddOutput}
                    className={`${colors.buttonBg} text-white p-2 rounded-xl transition-all`}
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {outputs.length > 0 ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {outputs.map((output, index) => (
                      <EditableOutput
                        key={`${phase}-output-${index}-${output.type || output.name || 'untitled'}`}
                        output={{
                          ...output,
                          // Ensure all required properties are present with fallbacks
                          type: output.type || output.name || `output-${index}`,
                          name: output.name || output.type || `Output ${index + 1}`,
                          description: output.description || '',
                          format: output.format || 'text'
                        }}
                        index={index}
                        onUpdate={(updates) => onUpdateOutput(index, updates)}
                        onRemove={() => onRemoveOutput(index)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 border-2 border-dashed border-gray-200 rounded-2xl">
                    <FileText className="w-8 h-8 mx-auto mb-3 text-gray-400" />
                    <p className="text-gray-600 mb-3">No outputs defined for this phase</p>
                    <button
                      onClick={onAddOutput}
                      className="text-emerald-600 hover:text-emerald-800 font-medium"
                    >
                      Add expected output
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Enhanced Plugin Browser Modal with replacement mode */}
      {showPluginBrowser && (
        <AllPluginsBrowserModal
          onClose={handleCloseModal}
          onAddStep={handlePluginSelection}
          isConnected={isConnected}
          getPluginConnection={getPluginConnection}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          selectedCategory={selectedCategory}
          setSelectedCategory={setSelectedCategory}
          viewMode={viewMode}
          setViewMode={setViewMode}
          showConnectedOnly={showConnectedOnly}
          setShowConnectedOnly={setShowConnectedOnly}
          getFilteredPlugins={getFilteredPlugins}
          loading={loading}
          // NEW: Pass replacement mode info to modal
          isReplacementMode={replacingStep !== null}
          replacingStep={replacingStep}
        />
      )}
    </>
  );
};
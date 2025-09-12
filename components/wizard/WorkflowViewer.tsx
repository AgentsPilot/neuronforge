import React from 'react';
import { 
  Database,
  FileText,
  ArrowRight,
  Settings,
  Download,
  Zap,
  AlertTriangle,
  CheckCircle,
  Clock,
  ExternalLink,
  Mail,
  BarChart3,
  Monitor,
  Sparkles,
  Target
} from 'lucide-react';
import type { GeneratedPlan } from './workflowAnalysis';

interface ConnectionDetail {
  username?: string;
  email?: string;
  connectedAt: string;
  lastUsed?: string;
  status: string;
  profileData?: any;
}

interface WorkflowViewerProps {
  generatedPlan: GeneratedPlan;
  getStepsByPhase: (phase: 'input' | 'process' | 'output') => any[];
  getInputsByPhase: (phase: 'input' | 'process' | 'output') => any[];
  connectedPlugins: string[];
  connectionDetails: Record<string, ConnectionDetail>;
}

export const WorkflowViewer: React.FC<WorkflowViewerProps> = ({ 
  generatedPlan, 
  getStepsByPhase, 
  getInputsByPhase,
  connectedPlugins,
  connectionDetails
}) => {
  const inputSteps = getStepsByPhase('input');
  const processSteps = getStepsByPhase('process');
  const outputSteps = getStepsByPhase('output');

  const inputInputs = getInputsByPhase('input');
  const processInputs = getInputsByPhase('process');
  const outputInputs = getInputsByPhase('output');

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
    const iconName = pluginName.toLowerCase();
    
    // File-related plugins
    if (iconName.includes('file') || iconName.includes('document')) return <FileText className={size} />;
    if (iconName.includes('pdf')) return <FileText className={size} />;
    
    // Communication plugins
    if (iconName.includes('mail') || iconName.includes('email')) return <Mail className={size} />;
    if (iconName.includes('slack') || iconName.includes('teams')) return <Mail className={size} />;
    
    // Data and analytics
    if (iconName.includes('chart') || iconName.includes('analytics') || iconName.includes('data')) return <BarChart3 className={size} />;
    if (iconName.includes('database') || iconName.includes('sql')) return <Database className={size} />;
    if (iconName.includes('csv') || iconName.includes('excel')) return <BarChart3 className={size} />;
    
    // Web and browser
    if (iconName.includes('web') || iconName.includes('browser') || iconName.includes('chrome')) return <Monitor className={size} />;
    if (iconName.includes('api') || iconName.includes('http')) return <Monitor className={size} />;
    
    // AI and processing
    if (iconName.includes('ai') || iconName.includes('gpt') || iconName.includes('openai')) return <Sparkles className={size} />;
    if (iconName.includes('process') || iconName.includes('transform')) return <Zap className={size} />;
    
    // Storage and cloud
    if (iconName.includes('drive') || iconName.includes('cloud') || iconName.includes('storage')) return <Database className={size} />;
    if (iconName.includes('download') || iconName.includes('export')) return <Download className={size} />;
    
    // Default fallback
    return <Monitor className={size} />;
  };

  // Helper function to get connection status
  const getConnectionStatus = (pluginKey: string) => {
    const systemPlugins = ['dashboard-alert', 'pdf-report', 'summary-block', 'agent-log'];
    
    if (systemPlugins.includes(pluginKey)) {
      return { 
        status: 'connected', 
        color: 'text-green-600',
        details: null
      };
    }
    
    const isMissing = generatedPlan.missingPlugins && generatedPlan.missingPlugins.includes(pluginKey);
    if (isMissing) {
      return { 
        status: 'missing', 
        color: 'text-red-600',
        details: null
      };
    }
    
    const isConnected = connectedPlugins.includes(pluginKey);
    if (isConnected) {
      const details = connectionDetails ? connectionDetails[pluginKey] : null;
      return { 
        status: 'connected', 
        color: 'text-green-600',
        details: details
      };
    }
    
    return { 
      status: 'disconnected', 
      color: 'text-yellow-600',
      details: null
    };
  };

  // Helper function to find related plugins for input schema
  const findRelatedPluginsForInput = (input: any) => {
    let relatedPlugins = [];

    // Get all steps for reference
    const allSteps = [
      ...inputSteps,
      ...processSteps,
      ...outputSteps
    ];

    // PRIMARY: Direct plugin key match
    if (input.pluginKey) {
      relatedPlugins = allSteps.filter(step => step.pluginKey === input.pluginKey);
    }

    // SECONDARY: Related step ID match
    if (relatedPlugins.length === 0 && input.relatedStepId) {
      relatedPlugins = allSteps.filter(step => step.id === input.relatedStepId);
    }

    // TERTIARY: Phase-based matching
    if (relatedPlugins.length === 0 && input.phase) {
      relatedPlugins = allSteps.filter(step => step.phase === input.phase);
    }

    // SMART FALLBACK: Intelligent name-based matching
    if (relatedPlugins.length === 0) {
      relatedPlugins = allSteps.filter(step => {
        const inputNameLower = input.name.toLowerCase();
        const pluginNameLower = step.pluginName.toLowerCase();
        
        if (inputNameLower.includes('gmail') && pluginNameLower.includes('gmail')) return true;
        if ((inputNameLower.includes('drive') || inputNameLower.includes('folder')) && 
            pluginNameLower.includes('drive')) return true;
        
        return false;
      });
    }

    // Remove duplicates
    return relatedPlugins.filter((plugin, index, self) => 
      index === self.findIndex(p => p.pluginKey === plugin.pluginKey)
    );
  };

  // Get all steps and inputs for consolidated views
  const allSteps = [
    ...inputSteps,
    ...processSteps,
    ...outputSteps
  ].sort((a, b) => a.order - b.order);

  const allInputs = [
    ...inputInputs,
    ...processInputs,
    ...outputInputs
  ];

  return (
    <div className="space-y-8">
      {/* Section 1: Technical Workflow Overview - Consolidated View */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-700 px-6 py-4">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold">Technical Workflow Overview</h3>
              <p className="text-indigo-100 text-sm">Complete technical breakdown of your automation ({allSteps.length} steps total)</p>
            </div>
          </div>
        </div>
        
        <div className="p-8 bg-gradient-to-br from-gray-50 to-blue-50">
          {allSteps.length > 0 ? (
            <div className="space-y-6">
              {allSteps.map((step, index) => {
                const connectionStatus = getConnectionStatus(step.pluginKey);
                const phaseColor = getPhaseColor(step.phase);
                
                return (
                  <div key={step.id} className="relative">
                    {/* Technical workflow card */}
                    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                      <div className="p-6">
                        <div className="flex items-start gap-4">
                          {/* Step number */}
                          <div className={`flex-shrink-0 w-10 h-10 ${phaseColor} rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm`}>
                            {step.order}
                          </div>
                          
                          {/* Tool icon */}
                          <div className="flex-shrink-0">
                            <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center border border-gray-200">
                              {getIconForPlugin(step.pluginName, "h-6 w-6 text-gray-600")}
                            </div>
                          </div>
                          
                          {/* Main content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between mb-3">
                              <div>
                                <h3 className="text-lg font-semibold text-gray-900 mb-1">{step.pluginName}</h3>
                                <div className="flex items-center gap-2">
                                  <div className={`inline-flex px-2 py-1 rounded-md text-xs font-medium text-white ${phaseColor}`}>
                                    {step.phase.toUpperCase()} PHASE
                                  </div>
                                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-md font-mono">
                                    {step.pluginKey}
                                  </span>
                                </div>
                              </div>
                              
                              {/* Status indicator */}
                              <div className="flex-shrink-0">
                                {connectionStatus.status === 'connected' ? (
                                  <div className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1 rounded-full border border-green-200">
                                    <CheckCircle className="h-4 w-4" />
                                    <span className="text-sm font-medium">Connected</span>
                                  </div>
                                ) : connectionStatus.status === 'missing' ? (
                                  <div className="flex items-center gap-2 bg-red-50 text-red-700 px-3 py-1 rounded-full border border-red-200">
                                    <AlertTriangle className="h-4 w-4" />
                                    <span className="text-sm font-medium">Missing</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 bg-yellow-50 text-yellow-700 px-3 py-1 rounded-full border border-yellow-200">
                                    <Clock className="h-4 w-4" />
                                    <span className="text-sm font-medium">Setup Required</span>
                                  </div>
                                )}
                              </div>
                            </div>
                            
                            {/* Technical details */}
                            <div className="space-y-2">
                              <p className="text-gray-700 text-sm leading-relaxed"><strong>Action:</strong> {step.action}</p>
                              {step.description && (
                                <p className="text-gray-600 text-xs leading-relaxed"><strong>Description:</strong> {step.description}</p>
                              )}
                            </div>
                            
                            {/* Connection details */}
                            {connectionStatus.status === 'connected' && connectionStatus.details && (
                              <div className="mt-3 p-2 bg-green-50 rounded-lg border border-green-200">
                                <p className="text-xs text-green-700">
                                  <strong>Connected as:</strong> {connectionStatus.details.email || connectionStatus.details.username}
                                </p>
                              </div>
                            )}
                            
                            {/* Setup action */}
                            {connectionStatus.status === 'disconnected' && (
                              <div className="mt-3">
                                <a 
                                  href="/settings/connections" 
                                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                                >
                                  Configure Plugin Connection
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Flow connector */}
                    {index < allSteps.length - 1 && (
                      <div className="flex justify-center py-3">
                        <div className="flex items-center gap-2 text-gray-400">
                          <div className="w-6 h-0.5 bg-gray-300"></div>
                          <ArrowRight className="h-4 w-4" />
                          <div className="w-6 h-0.5 bg-gray-300"></div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Database className="h-8 w-8 opacity-50" />
              </div>
              <h4 className="text-lg font-medium text-gray-600 mb-2">No Workflow Steps</h4>
              <p className="text-sm text-gray-500">No automation steps have been generated yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Configuration Schema - Technical Input Schema */}
      {allInputs.length > 0 && (
        <div className="bg-white border-2 border-blue-200 rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-4">
            <div className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <Settings className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-semibold">Configuration Schema</h3>
                <p className="text-blue-100 text-sm">Technical parameters and settings required for execution ({allInputs.length} items)</p>
              </div>
            </div>
          </div>
          
          <div className="p-6">
            <div className="space-y-4">
              {allInputs.map((input, index) => {
                const relatedPlugins = findRelatedPluginsForInput(input);
                
                return (
                  <div key={index} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm hover:border-blue-300 transition-all">
                    <div className="flex items-start gap-4">
                      {/* Input type icon */}
                      <div className="flex-shrink-0 w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center border border-blue-200">
                        {input.type === 'text' && <FileText className="h-5 w-5 text-blue-600" />}
                        {input.type === 'email' && <Mail className="h-5 w-5 text-blue-600" />}
                        {input.type === 'number' && <BarChart3 className="h-5 w-5 text-blue-600" />}
                        {input.type === 'select' && <Settings className="h-5 w-5 text-blue-600" />}
                        {input.type === 'boolean' && <CheckCircle className="h-5 w-5 text-blue-600" />}
                        {!['text', 'email', 'number', 'select', 'boolean'].includes(input.type) && <Database className="h-5 w-5 text-blue-600" />}
                      </div>
                      
                      {/* Main content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1">
                            <h4 className="text-lg font-semibold text-gray-900 mb-1">{input.name}</h4>
                            <p className="text-sm text-gray-600 leading-relaxed">{input.description}</p>
                          </div>
                          
                          {/* Technical badges */}
                          <div className="flex items-center gap-2 ml-4">
                            {input.required && (
                              <span className="bg-red-100 text-red-700 px-2 py-1 rounded-md text-xs font-medium">
                                Required
                              </span>
                            )}
                            <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-md text-xs font-mono">
                              {input.type}
                            </span>
                            {input.phase && (
                              <span className={`px-2 py-1 rounded-md text-xs font-medium text-white
                                ${input.phase === 'input' ? 'bg-blue-500' : 
                                  input.phase === 'process' ? 'bg-purple-500' : 'bg-emerald-500'}`}>
                                {input.phase.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {/* Example value */}
                        {input.placeholder && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                            <div className="flex items-start gap-2">
                              <Sparkles className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <span className="text-xs font-medium text-blue-800">Example Value:</span>
                                <p className="text-sm text-blue-700 mt-1 font-mono">{input.placeholder}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Plugin dependencies */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-gray-500">Used by plugins:</span>
                          <div className="flex items-center gap-2">
                            {relatedPlugins.length > 0 ? (
                              relatedPlugins.slice(0, 2).map((plugin, pluginIndex) => (
                                <div key={pluginIndex} className="flex items-center gap-1.5 bg-blue-50 text-blue-700 px-2 py-1 rounded-md border border-blue-200">
                                  <div className="w-3 h-3 flex items-center justify-center">
                                    {getIconForPlugin(plugin.pluginName, "h-3 w-3")}
                                  </div>
                                  <span className="text-xs font-medium">{plugin.pluginName}</span>
                                </div>
                              ))
                            ) : (
                              <div className="flex items-center gap-1.5 bg-purple-50 text-purple-700 px-2 py-1 rounded-md border border-purple-200">
                                <Settings className="h-3 w-3" />
                                <span className="text-xs font-medium">Global Configuration</span>
                              </div>
                            )}
                            {relatedPlugins.length > 2 && (
                              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-md">
                                +{relatedPlugins.length - 2} more
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Section 3: Output Specifications - Technical Output Schema */}
      {generatedPlan.outputs && generatedPlan.outputs.length > 0 && (
        <div className="bg-white border-2 border-emerald-200 rounded-2xl overflow-hidden">
          <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4">
            <div className="flex items-center gap-3 text-white">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-semibold">Output Specifications</h3>
                <p className="text-emerald-100 text-sm">Technical details of workflow deliverables ({generatedPlan.outputs.length} outputs)</p>
              </div>
            </div>
          </div>
          
          <div className="p-6">
            <div className="space-y-4">
              {generatedPlan.outputs.map((output, index) => (
                <div key={index} className="bg-white border border-gray-200 rounded-xl p-5 hover:shadow-sm hover:border-emerald-300 transition-all">
                  <div className="flex items-start gap-4">
                    {/* Output type icon */}
                    <div className="flex-shrink-0 w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center border border-emerald-200">
                      {output.format === 'PDF' && <FileText className="h-5 w-5 text-emerald-600" />}
                      {output.format === 'Email' && <Mail className="h-5 w-5 text-emerald-600" />}
                      {output.format === 'CSV' && <BarChart3 className="h-5 w-5 text-emerald-600" />}
                      {output.format === 'Dashboard' && <Monitor className="h-5 w-5 text-emerald-600" />}
                      {output.format === 'JSON' && <Database className="h-5 w-5 text-emerald-600" />}
                      {output.format === 'Report' && <FileText className="h-5 w-5 text-emerald-600" />}
                      {!['PDF', 'Email', 'CSV', 'Dashboard', 'JSON', 'Report'].includes(output.format) && <Download className="h-5 w-5 text-emerald-600" />}
                    </div>
                    
                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="text-lg font-semibold text-gray-900 mb-1">{output.type}</h4>
                          <p className="text-sm text-gray-600 leading-relaxed">{output.description}</p>
                        </div>
                        
                        {/* Technical badges */}
                        <div className="flex items-center gap-2 ml-4">
                          <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-md text-xs font-medium">
                            {output.format}
                          </span>
                          {output.phase && (
                            <span className={`px-2 py-1 rounded-md text-xs font-medium text-white
                              ${output.phase === 'input' ? 'bg-blue-500' : 
                                output.phase === 'process' ? 'bg-purple-500' : 'bg-emerald-500'}`}>
                              {output.phase.toUpperCase()} PHASE
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Technical details */}
                      <div className="space-y-2">
                        {output.destination && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                              <Target className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <span className="text-xs font-medium text-emerald-800">Delivery Target:</span>
                                <p className="text-sm text-emerald-700 mt-1 font-mono">{output.destination}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Creator plugin */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-gray-500">Generated by:</span>
                          <div className="flex items-center gap-2">
                            {output.pluginKey ? (
                              <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md border border-emerald-200">
                                <div className="w-3 h-3 flex items-center justify-center">
                                  {getIconForPlugin(output.pluginKey, "h-3 w-3")}
                                </div>
                                <span className="text-xs font-medium">{output.pluginKey}</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 bg-gray-50 text-gray-700 px-2 py-1 rounded-md border border-gray-200">
                                <Sparkles className="h-3 w-3" />
                                <span className="text-xs font-medium">Workflow System</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
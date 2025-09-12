// BusinessViewSections.tsx - Extracted business view sections to reduce main file size

import React from 'react';
import { 
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
  Download,
  Zap,
  Clock,
  CheckCircle,
  AlertTriangle,
  Database,
  Sparkles,
  ExternalLink,
  Target,
  GitBranch,
  Play
} from 'lucide-react';

interface BusinessViewSectionsProps {
  allSteps: any[];
  allInputs: any[];
  generatedPlan: any;
  getConnectionStatus: (pluginKey: string) => any;
  getPhaseColor: (phase: 'input' | 'process' | 'output') => string;
  getIconForPlugin: (pluginName: string, size?: string) => React.ReactNode;
  findRelatedPluginsForInput: (input: any) => any[];
  getStepsByPhase: (phase: string) => any[];
}

export const BusinessViewSections: React.FC<BusinessViewSectionsProps> = ({
  allSteps,
  allInputs,
  generatedPlan,
  getConnectionStatus,
  getPhaseColor,
  getIconForPlugin,
  findRelatedPluginsForInput,
  getStepsByPhase
}) => {
  return (
    <div className="space-y-8">
      {/* Section 1: Workflow Flow Diagram - CLEAN VERSION */}
      <div className="bg-white border-2 border-gray-200 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-purple-700 px-6 py-4">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <GitBranch className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold">Your Automation Workflow</h3>
              <p className="text-indigo-100 text-sm">Simple step-by-step process that runs automatically ({allSteps.length} steps total)</p>
            </div>
          </div>
        </div>
        
        <div className="p-8 bg-gradient-to-br from-gray-50 to-blue-50">
          {allSteps.length > 0 ? (
            <div className="space-y-6">
              {/* Clean, simplified workflow cards */}
              <div className="space-y-6">
                {allSteps.map((step, index) => {
                  const connectionStatus = getConnectionStatus(step.pluginKey);
                  const phaseColor = getPhaseColor(step.phase);
                  
                  return (
                    <div key={step.id} className="relative">
                      {/* Main workflow card */}
                      <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="p-6">
                          <div className="flex items-start gap-4">
                            {/* Step number */}
                            <div className={`flex-shrink-0 w-10 h-10 ${phaseColor} rounded-xl flex items-center justify-center text-white font-bold text-lg shadow-sm`}>
                              {step.order}
                            </div>
                            
                            {/* Tool icon and info */}
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
                                  <div className={`inline-flex px-2 py-1 rounded-md text-xs font-medium text-white ${phaseColor}`}>
                                    {step.phase === 'input' ? 'COLLECT' : 
                                     step.phase === 'process' ? 'PROCESS' : 
                                     'DELIVER'}
                                  </div>
                                </div>
                                
                                {/* Status indicator */}
                                <div className="flex-shrink-0">
                                  {connectionStatus.status === 'connected' ? (
                                    <div className="flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1 rounded-full border border-green-200">
                                      <CheckCircle className="h-4 w-4" />
                                      <span className="text-sm font-medium">Ready</span>
                                    </div>
                                  ) : connectionStatus.status === 'missing' ? (
                                    <div className="flex items-center gap-2 bg-red-50 text-red-700 px-3 py-1 rounded-full border border-red-200">
                                      <AlertTriangle className="h-4 w-4" />
                                      <span className="text-sm font-medium">Missing</span>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 bg-yellow-50 text-yellow-700 px-3 py-1 rounded-full border border-yellow-200">
                                      <Clock className="h-4 w-4" />
                                      <span className="text-sm font-medium">Setup</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              {/* Action description */}
                              <p className="text-gray-700 text-sm leading-relaxed mb-3">{step.action}</p>
                              
                              {/* Additional details if needed */}
                              {step.description && (
                                <p className="text-gray-500 text-xs leading-relaxed">{step.description}</p>
                              )}
                              
                              {/* Connection details */}
                              {connectionStatus.status === 'connected' && connectionStatus.details && (
                                <div className="mt-3 text-xs text-green-600">
                                  Connected as: {connectionStatus.details.email || connectionStatus.details.username}
                                </div>
                              )}
                              
                              {/* Setup action */}
                              {connectionStatus.status === 'disconnected' && (
                                <div className="mt-3">
                                  <a 
                                    href="/settings/connections" 
                                    className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                                  >
                                    Connect this tool
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

              {/* Execution summary - simplified */}
              <div className="bg-white rounded-xl p-6 border-2 border-gray-200 shadow-sm">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Play className="h-5 w-5 text-blue-600" />
                  </div>
                  <span className="text-lg font-bold text-gray-900">Workflow Summary</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                    <span className="block text-2xl font-bold text-blue-600">{getStepsByPhase('input').length}</span>
                    <span className="text-sm text-blue-700 font-medium">Data Collection</span>
                  </div>
                  <div className="bg-purple-50 rounded-lg p-4 border border-purple-200">
                    <span className="block text-2xl font-bold text-purple-600">{getStepsByPhase('process').length}</span>
                    <span className="text-sm text-purple-700 font-medium">Processing</span>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
                    <span className="block text-2xl font-bold text-emerald-600">{getStepsByPhase('output').length}</span>
                    <span className="text-sm text-emerald-700 font-medium">Delivery</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <GitBranch className="h-8 w-8 opacity-50" />
              </div>
              <h4 className="text-lg font-medium text-gray-600 mb-2">No Workflow Steps</h4>
              <p className="text-sm text-gray-500">No automation steps have been generated yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Section 2: Required Information - CLEAN DESIGN */}
      <div className="bg-white border-2 border-blue-200 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-4">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <Database className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-xl font-semibold">Required Information</h3>
              <p className="text-blue-100 text-sm">Settings and data needed to run your workflow ({allInputs.length} items)</p>
            </div>
          </div>
        </div>
        
        <div className="p-6">
          {allInputs.length > 0 ? (
            <div className="space-y-4">
              {allInputs.map((input, index) => {
                // Use the enhanced function to find related plugins
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
                          
                          {/* Status badges */}
                          <div className="flex items-center gap-2 ml-4">
                            {input.required && (
                              <span className="bg-red-100 text-red-700 px-2 py-1 rounded-md text-xs font-medium">
                                Required
                              </span>
                            )}
                            <span className="bg-gray-100 text-gray-700 px-2 py-1 rounded-md text-xs font-mono">
                              {input.type}
                            </span>
                          </div>
                        </div>
                        
                        {/* Example value */}
                        {input.placeholder && (
                          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
                            <div className="flex items-start gap-2">
                              <Sparkles className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <span className="text-xs font-medium text-blue-800">Example:</span>
                                <p className="text-sm text-blue-700 mt-1">{input.placeholder}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Connected tools */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-gray-500">Used by:</span>
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
                                <span className="text-xs font-medium">Workflow Setting</span>
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
          ) : (
            <div className="text-center py-12 text-gray-500">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Settings className="h-8 w-8 opacity-50" />
              </div>
              <h4 className="text-lg font-medium text-gray-600 mb-2">No Setup Required</h4>
              <p className="text-sm text-gray-500">This workflow can run with just your initial request</p>
            </div>
          )}
        </div>
      </div>

      {/* Section 3: What You'll Get - CLEAN DESIGN */}
      <div className="bg-white border-2 border-emerald-200 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4">
          <div className="flex items-center gap-3 text-white">
            <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-xl font-semibold">What You'll Get</h3>
              <p className="text-emerald-100 text-sm">Results and deliverables from your workflow ({generatedPlan.outputs?.length || 0} outputs)</p>
            </div>
          </div>
        </div>
        
        <div className="p-6">
          {generatedPlan.outputs && generatedPlan.outputs.length > 0 ? (
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
                        
                        {/* Format badge */}
                        <div className="ml-4">
                          <span className="bg-emerald-100 text-emerald-700 px-3 py-1 rounded-md text-xs font-medium">
                            {output.format}
                          </span>
                        </div>
                      </div>
                      
                      {/* Delivery details */}
                      <div className="space-y-2">
                        {output.destination && (
                          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                            <div className="flex items-start gap-2">
                              <Target className="h-4 w-4 text-emerald-600 mt-0.5 flex-shrink-0" />
                              <div>
                                <span className="text-xs font-medium text-emerald-800">Delivered to:</span>
                                <p className="text-sm text-emerald-700 mt-1">{output.destination}</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Creator tool */}
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-medium text-gray-500">Created by:</span>
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
                                <span className="text-xs font-medium">Workflow Output</span>
                              </div>
                            )}
                            
                            {/* Phase indicator */}
                            {output.phase && (
                              <span className={`px-2 py-1 rounded-md text-xs font-medium text-white
                                ${output.phase === 'input' ? 'bg-blue-500' : 
                                  output.phase === 'process' ? 'bg-purple-500' : 'bg-emerald-500'}`}>
                                {output.phase.toUpperCase()} PHASE
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <Download className="h-8 w-8 opacity-50" />
              </div>
              <h4 className="text-lg font-medium text-gray-600 mb-2">Dynamic Outputs</h4>
              <p className="text-sm text-gray-500">Outputs will be determined based on your workflow execution</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
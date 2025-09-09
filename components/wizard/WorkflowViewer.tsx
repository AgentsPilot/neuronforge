import React from 'react';
import { 
  Database,
  FileText,
  ArrowRight,
  Settings,
  Download,
  Zap,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  User,
  Clock,
  CalendarDays
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

  // Helper function to get phase styles
  const getPhaseStyles = (phase: 'input' | 'process' | 'output') => {
    switch (phase) {
      case 'input':
        return {
          bgLight: 'bg-blue-50',
          border: 'border-blue-200',
          bgDark: 'bg-blue-600',
          text: 'text-blue-700',
          bgMedium: 'bg-blue-100'
        };
      case 'process':
        return {
          bgLight: 'bg-purple-50',
          border: 'border-purple-200',
          bgDark: 'bg-purple-600',
          text: 'text-purple-700',
          bgMedium: 'bg-purple-100'
        };
      case 'output':
        return {
          bgLight: 'bg-emerald-50',
          border: 'border-emerald-200',
          bgDark: 'bg-emerald-600',
          text: 'text-emerald-700',
          bgMedium: 'bg-emerald-100'
        };
      default:
        return {
          bgLight: 'bg-gray-50',
          border: 'border-gray-200',
          bgDark: 'bg-gray-600',
          text: 'text-gray-700',
          bgMedium: 'bg-gray-100'
        };
    }
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

  // Helper function to format date
  const formatDate = (dateString: string) => {
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return 'Unknown';
    }
  };

  // Helper function to format relative time
  const formatRelativeTime = (dateString: string) => {
    if (!dateString) return 'Never';
    
    try {
      const date = new Date(dateString);
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

  // Step card component
  const StepCard = ({ step, phase }: { step: any; phase: 'input' | 'process' | 'output' }) => {
    const connectionStatus = getConnectionStatus(step.pluginKey);
    const styles = getPhaseStyles(phase);
    
    return (
      <div className={`${styles.bgLight} border ${styles.border} rounded-xl p-4 hover:shadow-md transition-shadow`}>
        <div className="flex items-start gap-3">
          <div className={`w-8 h-8 ${styles.bgDark} rounded-lg flex items-center justify-center text-white font-bold text-sm`}>
            {step.order}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h5 className="font-semibold text-gray-900">{step.pluginName}</h5>
              <div className="flex items-center gap-1">
                {connectionStatus.status === 'connected' ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-xs font-medium text-green-600">Connected</span>
                  </>
                ) : connectionStatus.status === 'missing' ? (
                  <>
                    <XCircle className="h-4 w-4 text-red-600" />
                    <span className="text-xs font-medium text-red-600">Missing</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <span className="text-xs font-medium text-yellow-600">Not Connected</span>
                  </>
                )}
              </div>
            </div>
            
            <p className={`text-sm ${styles.text} ${styles.bgMedium} px-3 py-1 rounded-full mb-2 inline-block`}>
              {step.action}
            </p>
            <p className="text-sm text-gray-700 mb-3">{step.description}</p>
            
            {connectionStatus.status === 'connected' && connectionStatus.details && (
              <div className="bg-white rounded-lg p-3 border border-gray-200 space-y-2">
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

            {connectionStatus.status === 'disconnected' && (
              <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
                <p className="text-xs text-yellow-800">
                  This plugin needs to be connected to execute this workflow step.
                </p>
                <a 
                  href="/settings/connections" 
                  className="text-xs text-yellow-700 hover:text-yellow-900 underline mt-1 inline-block"
                >
                  Connect {step.pluginName}
                </a>
              </div>
            )}

            {connectionStatus.status === 'missing' && (
              <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                <p className="text-xs text-red-800">
                  This plugin is not available in your system.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Input Phase */}
      <div className="bg-white border-2 border-blue-200 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 px-6 py-4">
          <div className="flex items-center gap-3 text-white">
            <Database className="h-6 w-6" />
            <div>
              <h4 className="text-lg font-semibold">Input Phase</h4>
              <p className="text-blue-100 text-sm">Data collection and retrieval ({inputSteps.length} steps)</p>
            </div>
          </div>
        </div>
        
        <div className="p-6 space-y-4">
          {inputSteps.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {inputSteps.map((step: any) => (
                  <StepCard key={step.id} step={step} phase="input" />
                ))}
              </div>

              {inputInputs.length > 0 && (
                <div className="border-t border-blue-200 pt-4">
                  <h5 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Configuration ({inputInputs.length} settings)
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {inputInputs.map((input: any, index: number) => (
                      <div key={index} className="bg-white border border-blue-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <h6 className="font-medium text-gray-900 text-sm">{input.name}</h6>
                          {input.required && (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Required</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mb-1">{input.description}</p>
                        <div className="text-xs text-gray-500">
                          <span className="font-mono bg-gray-100 px-1 rounded">{input.type}</span>
                          {input.placeholder && <span className="ml-2">e.g., {input.placeholder}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No input steps identified</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <div className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-full">
          <ArrowRight className="h-5 w-5 text-gray-600" />
          <span className="text-sm font-medium text-gray-600">Process</span>
        </div>
      </div>

      {/* Process Phase */}
      <div className="bg-white border-2 border-purple-200 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4">
          <div className="flex items-center gap-3 text-white">
            <Zap className="h-6 w-6" />
            <div>
              <h4 className="text-lg font-semibold">Process Phase</h4>
              <p className="text-purple-100 text-sm">Analysis and transformation ({processSteps.length} steps)</p>
            </div>
          </div>
        </div>
        
        <div className="p-6 space-y-4">
          {processSteps.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {processSteps.map((step: any) => (
                  <StepCard key={step.id} step={step} phase="process" />
                ))}
              </div>

              {processInputs.length > 0 && (
                <div className="border-t border-purple-200 pt-4">
                  <h5 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Configuration ({processInputs.length} settings)
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {processInputs.map((input: any, index: number) => (
                      <div key={index} className="bg-white border border-purple-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <h6 className="font-medium text-gray-900 text-sm">{input.name}</h6>
                          {input.required && (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Required</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mb-1">{input.description}</p>
                        <div className="text-xs text-gray-500">
                          <span className="font-mono bg-gray-100 px-1 rounded">{input.type}</span>
                          {input.placeholder && <span className="ml-2">e.g., {input.placeholder}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No processing steps identified</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-center">
        <div className="flex items-center gap-2 bg-gray-100 px-4 py-2 rounded-full">
          <ArrowRight className="h-5 w-5 text-gray-600" />
          <span className="text-sm font-medium text-gray-600">Output</span>
        </div>
      </div>

      {/* Output Phase */}
      <div className="bg-white border-2 border-emerald-200 rounded-2xl overflow-hidden">
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-4">
          <div className="flex items-center gap-3 text-white">
            <Download className="h-6 w-6" />
            <div>
              <h4 className="text-lg font-semibold">Output Phase</h4>
              <p className="text-emerald-100 text-sm">Delivery and storage ({outputSteps.length} steps)</p>
            </div>
          </div>
        </div>
        
        <div className="p-6 space-y-4">
          {outputSteps.length > 0 ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {outputSteps.map((step: any) => (
                  <StepCard key={step.id} step={step} phase="output" />
                ))}
              </div>

              {generatedPlan.outputs && generatedPlan.outputs.length > 0 && (
                <div className="border-t border-emerald-200 pt-4">
                  <h5 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Expected Outputs ({generatedPlan.outputs.length})
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {generatedPlan.outputs.map((output: any, index: number) => (
                      <div key={index} className="bg-white border border-emerald-200 rounded-lg p-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <h6 className="font-medium text-gray-900 text-sm">{output.type}</h6>
                            <p className="text-xs text-gray-600">{output.format}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-xs font-medium text-emerald-700">{output.destination}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {outputInputs.length > 0 && (
                <div className="border-t border-emerald-200 pt-4">
                  <h5 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Configuration ({outputInputs.length} settings)
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {outputInputs.map((input: any, index: number) => (
                      <div key={index} className="bg-white border border-emerald-200 rounded-lg p-3">
                        <div className="flex items-center gap-2 mb-1">
                          <h6 className="font-medium text-gray-900 text-sm">{input.name}</h6>
                          {input.required && (
                            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded">Required</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-600 mb-1">{input.description}</p>
                        <div className="text-xs text-gray-500">
                          <span className="font-mono bg-gray-100 px-1 rounded">{input.type}</span>
                          {input.placeholder && <span className="ml-2">e.g., {input.placeholder}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <Download className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No output steps identified</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
import React, { useState, useCallback, useEffect } from 'react';
import { Link2, Zap, CheckCircle, AlertTriangle, Settings, Eye, Play, ArrowRight } from 'lucide-react';
import { WorkflowStep } from '../components/workflow/WorkflowStep';
// Commented out until components are created
// import { ConnectionVisualizer } from '../components/connections/ConnectionVisualizer';
// import { ConnectionManager } from '../components/connections/ConnectionManager';
// import { useConnections } from '../hooks/useConnections';
import { Connection, ConnectionPoint, DataTransform, ValidationResult } from '../types/connections';
import { WorkflowStep as WorkflowStepType, Connection as WorkflowConnection } from '../types/workflow';

interface ConnectDataPhaseProps {
  steps: WorkflowStepType[];
  connections: WorkflowConnection[];
  onStepsChange: (steps: WorkflowStepType[]) => void;
  onConnectionsChange: (connections: WorkflowConnection[]) => void;
  onPhaseComplete: () => void;
  onPreviousPhase: () => void;
}

export const ConnectDataPhase: React.FC<ConnectDataPhaseProps> = ({
  steps,
  connections,
  onStepsChange,
  onConnectionsChange,
  onPhaseComplete,
  onPreviousPhase
}) => {
  // Helper functions
  const getFieldName = (field: any): string => {
    if (typeof field === 'string') return field;
    if (field && typeof field === 'object') {
      return field.name || field.displayName || field.label || field.id || 'unnamed';
    }
    return 'unknown';
  };

  const getFieldType = (field: any): string => {
    if (typeof field === 'string') return 'text';
    if (field && typeof field === 'object') {
      return field.type || field.fieldType || field.dataType || 'text';
    }
    return 'text';
  };

  const isFieldRequired = (field: any): boolean => {
    if (typeof field === 'string') return false;
    if (field && typeof field === 'object') {
      return field.required || false;
    }
    return false;
  };

  // Helper function to get all inputs (including custom)
  const getAllInputs = (step: any) => {
    const standardInputs = step.inputs || [];
    const customInputs = step.customInputs || [];
    return [...standardInputs, ...customInputs];
  };

  // Helper function to get all outputs (including custom)
  const getAllOutputs = (step: any) => {
    const standardOutputs = step.outputs || [];
    const customOutputs = step.customOutputs || [];
    return [...standardOutputs, ...customOutputs];
  };
  const [selectedConnection, setSelectedConnection] = useState<WorkflowConnection | null>(null);
  const [draggedField, setDraggedField] = useState<ConnectionPoint | null>(null);
  const [hoveredField, setHoveredField] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'flow'>('grid');
  const [showValidation, setShowValidation] = useState(false);

  // Clean up invalid connections when steps change
  useEffect(() => {
    const validConnections = connections.filter(conn => {
      const fromStep = steps[conn.fromStep];
      const toStep = steps[conn.toStep];
      
      if (!fromStep || !toStep) return false;
      
      // Check if the connected fields still exist
      const fromFieldExists = fromStep.outputs?.some(output => 
        getFieldName(output) === conn.fromOutput
      );
      const toFieldExists = toStep.inputs?.some(input => 
        getFieldName(input) === conn.toInput
      );
      
      return fromFieldExists && toFieldExists;
    });
    
    // Update connections if any were invalid
    if (validConnections.length !== connections.length) {
      console.log(`Cleaned up ${connections.length - validConnections.length} invalid connections`);
      onConnectionsChange(validConnections);
    }
  }, [steps, connections, onConnectionsChange]);

  // Log step changes for debugging
  useEffect(() => {
    console.log('Steps updated in Connect phase:', {
      stepCount: steps.length,
      totalInputs: steps.reduce((acc, step) => acc + (step.inputs?.length || 0), 0),
      totalOutputs: steps.reduce((acc, step) => acc + (step.outputs?.length || 0), 0),
      stepDetails: steps.map(step => ({
        title: step.title,
        inputs: step.inputs?.map(i => getFieldName(i)),
        outputs: step.outputs?.map(o => getFieldName(o))
      }))
    });
  }, [steps]);

  // Auto-connect logic
  const handleAutoConnect = useCallback(() => {
    const newConnections: WorkflowConnection[] = [];
    
    for (let fromStepIndex = 0; fromStepIndex < steps.length - 1; fromStepIndex++) {
      const fromStep = steps[fromStepIndex];
      const toStep = steps[fromStepIndex + 1];
      
      if (!fromStep.outputs || !toStep.inputs) continue;
      
      fromStep.outputs.forEach((output, outputIndex) => {
        const outputName = getFieldName(output);
        const outputType = getFieldType(output);
        
        if (!outputName || outputName === 'unknown') return;
        
        toStep.inputs.forEach((input, inputIndex) => {
          const inputName = getFieldName(input);
          const inputType = getFieldType(input);
          
          if (!inputName || inputName === 'unknown') return;
          
          // Auto-connect if names match exactly
          const namesMatch = outputName.toLowerCase().trim() === inputName.toLowerCase().trim();
          
          if (namesMatch) {
            // Check if connection already exists
            const exists = connections.some(conn => 
              conn.fromStep === fromStepIndex && 
              conn.toStep === fromStepIndex + 1 &&
              conn.fromOutput === outputName &&
              conn.toInput === inputName
            );
            
            if (!exists) {
              newConnections.push({
                id: `auto_${Date.now()}_${fromStepIndex}_${outputIndex}_${inputIndex}`,
                fromStep: fromStepIndex,
                toStep: fromStepIndex + 1,
                fromOutput: outputName,
                toInput: inputName,
                isActive: true
              });
            }
          }
        });
      });
    }
    
    if (newConnections.length > 0) {
      onConnectionsChange([...connections, ...newConnections]);
      console.log(`Auto-connected ${newConnections.length} compatible fields`);
    } else {
      console.log('No matching fields found for auto-connection.');
    }
  }, [steps, connections, onConnectionsChange, getFieldName, getFieldType]);

  // Validation
  const getUnconnectedRequiredFields = () => {
    const unconnected: Array<{stepIndex: number, fieldName: string, fieldType: string}> = [];
    
    steps.forEach((step, stepIndex) => {
      if (!step.inputs || !Array.isArray(step.inputs)) return;
      
      step.inputs.forEach(input => {
        const inputName = getFieldName(input);
        const inputType = getFieldType(input);
        const required = isFieldRequired(input);
        
        if (required && inputName && inputName !== 'unknown') {
          const isConnected = connections.some(conn => 
            conn.toStep === stepIndex && conn.toInput === inputName
          );
          
          if (!isConnected) {
            unconnected.push({
              stepIndex,
              fieldName: inputName,
              fieldType: inputType
            });
          }
        }
      });
    });
    
    return unconnected;
  };

  const unconnectedRequired = getUnconnectedRequiredFields();
  const canComplete = unconnectedRequired.length === 0;

  // Statistics
  const stats = {
    connected: connections.length,
    required: steps.reduce((acc, step) => {
      if (!step.inputs || !Array.isArray(step.inputs)) return acc;
      return acc + step.inputs.filter(input => isFieldRequired(input)).length;
    }, 0),
    compatible: connections.filter(conn => {
      const fromStep = steps[conn.fromStep];
      const toStep = steps[conn.toStep];
      if (!fromStep || !toStep || !fromStep.outputs || !toStep.inputs) return false;
      
      const fromOutput = fromStep.outputs.find(o => getFieldName(o) === conn.fromOutput);
      const toInput = toStep.inputs.find(i => getFieldName(i) === conn.toInput);
      
      return fromOutput && toInput && getFieldType(fromOutput) === getFieldType(toInput);
    }).length,
    withTransforms: 0
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, stepIndex: number, fieldIndex: number, fieldName: string, fieldType: string, isOutput: boolean) => {
    const connectionPoint: ConnectionPoint = {
      stepIndex,
      fieldIndex,
      fieldName,
      fieldType,
      isOutput
    };
    
    setDraggedField(connectionPoint);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(connectionPoint));
    
    console.log('Drag started:', connectionPoint);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, stepIndex: number, fieldIndex: number, fieldName: string, fieldType: string, isOutput: boolean) => {
    e.preventDefault();
    
    if (!draggedField) return;
    
    const targetField: ConnectionPoint = {
      stepIndex,
      fieldIndex,
      fieldName,
      fieldType,
      isOutput
    };
    
    console.log('Drop attempted:', { from: draggedField, to: targetField });
    
    // Validate connection
    if (draggedField.isOutput === targetField.isOutput) {
      alert('Cannot connect output to output or input to input');
      setDraggedField(null);
      return;
    }
    
    if (draggedField.stepIndex === targetField.stepIndex) {
      alert('Cannot connect fields within the same step');
      setDraggedField(null);
      return;
    }
    
    // Check if connection already exists
    const existingConnection = connections.find(conn => 
      (conn.fromStep === draggedField.stepIndex && conn.fromOutput === draggedField.fieldName &&
       conn.toStep === targetField.stepIndex && conn.toInput === targetField.fieldName) ||
      (conn.fromStep === targetField.stepIndex && conn.fromOutput === targetField.fieldName &&
       conn.toStep === draggedField.stepIndex && conn.toInput === draggedField.fieldName)
    );
    
    if (existingConnection) {
      alert('Connection already exists between these fields');
      setDraggedField(null);
      return;
    }
    
    // Create connection (always from output to input)
    const fromField = draggedField.isOutput ? draggedField : targetField;
    const toField = draggedField.isOutput ? targetField : draggedField;
    
    const newConnection: WorkflowConnection = {
      id: `manual_${Date.now()}`,
      fromStep: fromField.stepIndex,
      toStep: toField.stepIndex,
      fromOutput: fromField.fieldName,
      toInput: toField.fieldName,
      isActive: true
    };
    
    onConnectionsChange([...connections, newConnection]);
    setDraggedField(null);
    console.log('Connection created:', newConnection);
  };

  const handleDragEnd = () => {
    setDraggedField(null);
  };
  const handleConnectionRemove = useCallback((connectionId: string) => {
    const updatedConnections = connections.filter(conn => conn.id !== connectionId);
    onConnectionsChange(updatedConnections);
  }, [connections, onConnectionsChange]);

  const getStepConnections = useCallback((stepIndex: number) => {
    return connections.filter(conn => 
      conn.fromStep === stepIndex || conn.toStep === stepIndex
    );
  }, [connections]);

  return (
    <div className="max-w-7xl mx-auto p-6">
      {/* Phase Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
              <Link2 className="h-7 w-7 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">Connect Data Flow</h1>
              <p className="text-slate-600">Link outputs from one step to inputs of the next step</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setViewMode(viewMode === 'grid' ? 'flow' : 'grid')}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-2"
            >
              <Eye className="h-4 w-4" />
              {viewMode === 'grid' ? 'Flow View' : 'Grid View'}
            </button>

            <button
              onClick={() => {
                // Force refresh by re-triggering the effect
                console.log('Refreshing step data...');
                setShowValidation(false);
                setShowValidation(true);
                setShowValidation(false);
              }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors flex items-center gap-2"
              title="Refresh field data"
            >
              <Play className="h-4 w-4" />
              Refresh
            </button>
            
            <button
              onClick={handleAutoConnect}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              <Zap className="h-4 w-4" />
              Auto-Connect
            </button>

            <button
              onClick={() => setShowValidation(!showValidation)}
              className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                showValidation 
                  ? 'bg-amber-100 text-amber-700 border border-amber-300' 
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
              }`}
            >
              <AlertTriangle className="h-4 w-4" />
              Validate ({unconnectedRequired.length})
            </button>
          </div>
        </div>

        {/* Step Changes Notification */}
        {steps.some(step => 
          (step.inputs?.length || 0) + (step.outputs?.length || 0) > 0
        ) && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-green-900 mb-2">Workflow Updated</h3>
                <p className="text-sm text-green-800 mb-3">
                  Your workflow has been updated with the latest field changes. Any invalid connections have been automatically cleaned up.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-green-700">
                  {steps.map((step, index) => (
                    <div key={index} className="bg-green-100 p-2 rounded">
                      <div className="font-medium">{step.title}</div>
                      <div>📥 {step.inputs?.length || 0} inputs | 📤 {step.outputs?.length || 0} outputs</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Connection Statistics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              <span className="text-sm font-medium text-slate-900">Connected</span>
            </div>
            <div className="text-2xl font-bold text-green-600">{stats.connected}</div>
            <div className="text-xs text-slate-500">of {stats.required} required</div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <span className="text-sm font-medium text-slate-900">Pending</span>
            </div>
            <div className="text-2xl font-bold text-amber-600">{unconnectedRequired.length}</div>
            <div className="text-xs text-slate-500">required fields</div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Zap className="h-5 w-5 text-blue-600" />
              <span className="text-sm font-medium text-slate-900">Compatible</span>
            </div>
            <div className="text-2xl font-bold text-blue-600">{stats.compatible}</div>
            <div className="text-xs text-slate-500">type matches</div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <Settings className="h-5 w-5 text-purple-600" />
              <span className="text-sm font-medium text-slate-900">Transforms</span>
            </div>
            <div className="text-2xl font-bold text-purple-600">{stats.withTransforms}</div>
            <div className="text-xs text-slate-500">with logic</div>
          </div>
        </div>

        {/* Enhanced Debug Information */}
        <div className="bg-gray-100 border border-gray-200 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-gray-900 mb-2">Debug Information</h3>
          <div className="text-sm text-gray-700 space-y-2">
            <p><strong>Steps:</strong> {steps.length}</p>
            <p><strong>Connections:</strong> {connections.length}</p>
            <p><strong>Last Update:</strong> {new Date().toLocaleTimeString()}</p>
            
            {steps.map((step, index) => (
              <div key={index} className="ml-4 bg-white p-3 rounded border">
                <p><strong>Step {index + 1}:</strong> {step.title}</p>
                <div className="ml-2 mt-2">
                  
                  {/* Raw step data inspection */}
                  <div className="mb-3 p-2 bg-blue-50 rounded text-xs">
                    <strong>Raw Step Object Keys:</strong> {Object.keys(step).join(', ')}
                  </div>
                  
                  <p><strong>Inputs ({step.inputs?.length || 0}):</strong></p>
                  {step.inputs && step.inputs.length > 0 ? (
                    step.inputs.map((input, i) => (
                      <div key={i} className="ml-4 text-xs bg-blue-50 p-2 rounded mb-1">
                        <div><strong>Input {i}:</strong></div>
                        <div><strong>Type:</strong> {typeof input}</div>
                        <div><strong>Value:</strong> {JSON.stringify(input)}</div>
                        <div><strong>Parsed Name:</strong> "{getFieldName(input)}"</div>
                        <div><strong>Parsed Type:</strong> "{getFieldType(input)}"</div>
                        <div><strong>Is Required:</strong> {isFieldRequired(input) ? 'Yes' : 'No'}</div>
                      </div>
                    ))
                  ) : (
                    <div className="ml-4 text-xs text-gray-500">No inputs or inputs is null/undefined</div>
                  )}
                  
                  <p><strong>Outputs ({step.outputs?.length || 0}):</strong></p>
                  {step.outputs && step.outputs.length > 0 ? (
                    step.outputs.map((output, i) => (
                      <div key={i} className="ml-4 text-xs bg-green-50 p-2 rounded mb-1">
                        <div><strong>Output {i}:</strong></div>
                        <div><strong>Type:</strong> {typeof output}</div>
                        <div><strong>Value:</strong> {JSON.stringify(output)}</div>
                        <div><strong>Parsed Name:</strong> "{getFieldName(output)}"</div>
                        <div><strong>Parsed Type:</strong> "{getFieldType(output)}"</div>
                      </div>
                    ))
                  ) : (
                    <div className="ml-4 text-xs text-gray-500">No outputs or outputs is null/undefined</div>
                  )}

                  {/* Check for custom fields */}
                  <div className="mt-2 p-2 bg-purple-50 rounded text-xs">
                    <p><strong>Custom Inputs:</strong> {step.customInputs?.length || 0}</p>
                    <p><strong>Custom Outputs:</strong> {step.customOutputs?.length || 0}</p>
                    {step.customInputs && step.customInputs.length > 0 && (
                      <div>Custom Inputs: {JSON.stringify(step.customInputs)}</div>
                    )}
                    {step.customOutputs && step.customOutputs.length > 0 && (
                      <div>Custom Outputs: {JSON.stringify(step.customOutputs)}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Help Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
          <div className="flex items-start gap-3">
            <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
              <Link2 className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-blue-900 mb-2">How to Connect Data</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-blue-800">
                <div className="space-y-1">
                  <p>• <strong>Drag outputs</strong> (green dots) to inputs (blue dots) in other steps</p>
                  <p>• <strong>Auto-connect</strong> finds fields with matching names automatically</p>
                  <p>• <strong>Green highlight</strong> shows connected fields</p>
                </div>
                <div className="space-y-1">
                  <p>• <strong>Hover zones</strong> highlight when dragging compatible fields</p>
                  <p>• <strong>Required fields</strong> marked with * must be connected</p>
                  <p>• <strong>Remove connections</strong> from the connections list below</p>
                </div>
              </div>
              <div className="mt-3 p-3 bg-blue-100 rounded-lg">
                <p className="text-sm text-blue-900">
                  <strong>💡 Tip:</strong> Look for the "drag →" indicator on outputs. Drag from any green output field to any blue input field in a different step to create a connection.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Validation Panel */}
        {showValidation && (
          <div className="bg-white border border-slate-200 rounded-lg p-6 mb-6">
            <h3 className="font-semibold text-slate-900 mb-4">Connection Validation</h3>
            
            {unconnectedRequired.length > 0 && (
              <div className="mb-4">
                <h4 className="font-medium text-amber-900 mb-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Required Fields Missing Connections ({unconnectedRequired.length})
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {unconnectedRequired.map((field, index) => (
                    <div key={index} className="bg-amber-50 border border-amber-200 rounded-md p-3">
                      <p className="text-sm text-amber-800">
                        <strong>Step {field.stepIndex + 1}:</strong> {field.fieldName} ({field.fieldType})
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {unconnectedRequired.length === 0 && (
              <div className="bg-green-50 border border-green-200 rounded-md p-4">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <p className="text-green-800 font-medium">All connections are valid! Ready to proceed.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Workflow Steps with Connections */}
      <div className="relative">
        {viewMode === 'grid' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {steps.map((step, index) => (
              <div key={step.id} className="relative">
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-sm font-semibold text-blue-700">
                      {index + 1}
                    </div>
                    <div>
                      <h3 className="font-medium text-slate-900">{step.title || `Step ${index + 1}`}</h3>
                      <p className="text-sm text-slate-600">{step.description || 'No description'}</p>
                    </div>
                  </div>

                  {/* Inputs */}
                  <div className="mb-4">
                    {(() => {
                      const allInputs = getAllInputs(step);
                      return (
                        <>
                          <h4 className="text-sm font-medium text-slate-700 mb-2">
                            Inputs ({allInputs.length})
                            {step.customInputs?.length > 0 && (
                              <span className="text-xs text-purple-600 ml-1">
                                (+{step.customInputs.length} custom)
                              </span>
                            )}
                          </h4>
                          <div className="space-y-1">
                            {allInputs.map((input: any, idx: number) => {
                              const inputName = getFieldName(input);
                              const inputType = getFieldType(input);
                              const required = isFieldRequired(input);
                              const isCustom = idx >= (step.inputs?.length || 0);
                              const isConnected = connections.some(conn => 
                                conn.toStep === index && conn.toInput === inputName
                              );
                              const isBeingDraggedOver = draggedField && 
                                draggedField.isOutput && 
                                draggedField.stepIndex !== index;
                              
                              return (
                                <div 
                                  key={`${index}-input-${idx}`} 
                                  className={`flex items-center gap-2 text-sm p-2 rounded transition-all cursor-pointer border-2 border-dashed ${
                                    isConnected 
                                      ? 'bg-green-50 border-green-300' 
                                      : isBeingDraggedOver 
                                        ? 'bg-blue-50 border-blue-400' 
                                        : 'border-transparent hover:bg-blue-50 hover:border-blue-300'
                                  }`}
                                  onDragOver={handleDragOver}
                                  onDrop={(e) => handleDrop(e, index, idx, inputName, inputType, false)}
                                  title={isBeingDraggedOver ? 'Drop to connect' : 'Drop zone for outputs'}
                                >
                                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                                    isConnected ? 'bg-green-500' : 'bg-blue-500'
                                  }`}></div>
                                  <span className="flex-1">{inputName}</span>
                                  {required && <span className="text-red-500">*</span>}
                                  {isCustom && <span className="text-xs bg-purple-200 text-purple-700 px-1 rounded">custom</span>}
                                  <span className="text-xs text-slate-500">({inputType})</span>
                                  {isConnected && (
                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                  )}
                                </div>
                              );
                            })}
                            {allInputs.length === 0 && (
                              <span className="text-slate-400 text-sm">No inputs defined</span>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  {/* Outputs */}
                  <div>
                    {(() => {
                      const allOutputs = getAllOutputs(step);
                      return (
                        <>
                          <h4 className="text-sm font-medium text-slate-700 mb-2">
                            Outputs ({allOutputs.length})
                            {step.customOutputs?.length > 0 && (
                              <span className="text-xs text-purple-600 ml-1">
                                (+{step.customOutputs.length} custom)
                              </span>
                            )}
                          </h4>
                          <div className="space-y-1">
                            {allOutputs.map((output: any, idx: number) => {
                              const outputName = getFieldName(output);
                              const outputType = getFieldType(output);
                              const isCustom = idx >= (step.outputs?.length || 0);
                              const isConnected = connections.some(conn => 
                                conn.fromStep === index && conn.fromOutput === outputName
                              );
                              
                              return (
                                <div 
                                  key={`${index}-output-${idx}`} 
                                  className={`flex items-center gap-2 text-sm p-2 rounded transition-all cursor-grab active:cursor-grabbing border-2 ${
                                    isConnected 
                                      ? 'bg-green-50 border-green-300' 
                                      : 'border-transparent hover:bg-green-50 hover:border-green-300'
                                  }`}
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, index, idx, outputName, outputType, true)}
                                  onDragEnd={handleDragEnd}
                                  title="Drag to connect to an input"
                                >
                                  <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                                    isConnected ? 'bg-green-500' : 'bg-green-500'
                                  }`}></div>
                                  <span className="flex-1">{outputName}</span>
                                  {isCustom && <span className="text-xs bg-purple-200 text-purple-700 px-1 rounded">custom</span>}
                                  <span className="text-xs text-slate-500">({outputType})</span>
                                  {isConnected && (
                                    <CheckCircle className="h-3 w-3 text-green-600" />
                                  )}
                                  <div className="text-xs text-slate-400 ml-2">drag →</div>
                                </div>
                              );
                            })}
                            {allOutputs.length === 0 && (
                              <span className="text-slate-400 text-sm">No outputs defined</span>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>

                {/* Connection Arrows */}
                {index < steps.length - 1 && (
                  <div className="absolute -right-4 top-1/2 transform -translate-y-1/2 z-10">
                    <div className={`flex items-center gap-2 px-3 py-2 rounded-full border ${
                      getStepConnections(index).length > 0
                        ? 'bg-green-50 border-green-200 text-green-700'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}>
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Flow Visualization</h3>
            
            {/* Flow View Container */}
            <div className="relative w-full min-h-[600px] bg-slate-50 rounded-lg p-6 overflow-auto">
              <svg 
                className="absolute inset-0 w-full h-full pointer-events-none" 
                style={{ zIndex: 1 }}
              >
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="10"
                    markerHeight="7"
                    refX="9"
                    refY="3.5"
                    orient="auto"
                  >
                    <polygon points="0 0, 10 3.5, 0 7" fill="#10b981" />
                  </marker>
                  <marker
                    id="arrowhead-inactive"
                    markerWidth="10"
                    markerHeight="7"
                    refX="9"
                    refY="3.5"
                    orient="auto"
                  >
                    <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                  </marker>
                </defs>
                
                {/* Draw connection lines */}
                {steps.map((_, fromIndex) => {
                  if (fromIndex >= steps.length - 1) return null;
                  
                  const toIndex = fromIndex + 1;
                  const hasConnection = connections.some(conn => 
                    conn.fromStep === fromIndex && conn.toStep === toIndex
                  );
                  
                  const startX = 250 + (fromIndex * 300);
                  const startY = 200;
                  const endX = 250 + (toIndex * 300);
                  const endY = 200;
                  
                  return (
                    <g key={`connection-${fromIndex}-${toIndex}`}>
                      <line
                        x1={startX + 200}
                        y1={startY}
                        x2={endX}
                        y2={endY}
                        stroke={hasConnection ? "#10b981" : "#94a3b8"}
                        strokeWidth={hasConnection ? "3" : "2"}
                        strokeDasharray={hasConnection ? "none" : "5,5"}
                        markerEnd={hasConnection ? "url(#arrowhead)" : "url(#arrowhead-inactive)"}
                      />
                      
                      {/* Connection count badge */}
                      {hasConnection && (
                        <g>
                          <circle
                            cx={(startX + endX) / 2 + 100}
                            cy={(startY + endY) / 2}
                            r="12"
                            fill="#10b981"
                          />
                          <text
                            x={(startX + endX) / 2 + 100}
                            y={(startY + endY) / 2 + 4}
                            textAnchor="middle"
                            className="text-xs fill-white font-semibold"
                          >
                            {connections.filter(conn => 
                              conn.fromStep === fromIndex && conn.toStep === toIndex
                            ).length}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
              </svg>
              
              {/* Flow Steps */}
              <div className="relative" style={{ zIndex: 2 }}>
                {steps.map((step, index) => {
                  const allInputs = getAllInputs(step);
                  const allOutputs = getAllOutputs(step);
                  const stepConnections = getStepConnections(index);
                  
                  return (
                    <div
                      key={step.id}
                      className="absolute bg-white rounded-xl border-2 border-slate-200 shadow-lg"
                      style={{
                        left: `${50 + (index * 300)}px`,
                        top: '50px',
                        width: '200px',
                        minHeight: '300px'
                      }}
                    >
                      {/* Step Header */}
                      <div className="p-4 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-blue-100 rounded-t-xl">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                            {index + 1}
                          </div>
                          <div className="flex-1">
                            <h4 className="font-semibold text-slate-900 text-sm leading-tight">
                              {step.title}
                            </h4>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-2">
                          {step.description || 'No description'}
                        </p>
                      </div>

                      {/* Step Content */}
                      <div className="p-3">
                        {/* Connection Summary */}
                        <div className="mb-3 p-2 bg-slate-50 rounded-lg">
                          <div className="text-xs text-slate-600 space-y-1">
                            <div className="flex justify-between">
                              <span>Connections:</span>
                              <span className="font-semibold text-green-600">{stepConnections.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Inputs:</span>
                              <span className="font-semibold text-blue-600">{allInputs.length}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Outputs:</span>
                              <span className="font-semibold text-green-600">{allOutputs.length}</span>
                            </div>
                          </div>
                        </div>

                        {/* Connected Fields */}
                        <div className="space-y-2">
                          <h5 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                            Connected Fields
                          </h5>
                          
                          {/* Connected Inputs */}
                          {allInputs.filter(input => {
                            const inputName = getFieldName(input);
                            return connections.some(conn => 
                              conn.toStep === index && conn.toInput === inputName
                            );
                          }).map((input, idx) => (
                            <div key={`connected-input-${idx}`} className="flex items-center gap-2 text-xs">
                              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                              <span className="text-slate-700 truncate">{getFieldName(input)}</span>
                              <CheckCircle className="h-3 w-3 text-green-600 ml-auto" />
                            </div>
                          ))}
                          
                          {/* Connected Outputs */}
                          {allOutputs.filter(output => {
                            const outputName = getFieldName(output);
                            return connections.some(conn => 
                              conn.fromStep === index && conn.fromOutput === outputName
                            );
                          }).map((output, idx) => (
                            <div key={`connected-output-${idx}`} className="flex items-center gap-2 text-xs">
                              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              <span className="text-slate-700 truncate">{getFieldName(output)}</span>
                              <CheckCircle className="h-3 w-3 text-green-600 ml-auto" />
                            </div>
                          ))}
                          
                          {stepConnections.length === 0 && (
                            <div className="text-xs text-slate-500 italic">No connections yet</div>
                          )}
                        </div>
                      </div>

                      {/* Step Footer - Quick Actions */}
                      <div className="p-3 border-t border-slate-100 bg-slate-50 rounded-b-xl">
                        <div className="flex items-center justify-between text-xs">
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                            stepConnections.length > 0 
                              ? 'bg-green-100 text-green-700' 
                              : 'bg-amber-100 text-amber-700'
                          }`}>
                            {stepConnections.length > 0 ? 'Connected' : 'Pending'}
                          </span>
                          
                          <button
                            onClick={() => setViewMode('grid')}
                            className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs hover:bg-blue-200 transition-colors"
                          >
                            Edit
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              
              {/* Flow Legend */}
              <div className="absolute bottom-4 right-4 bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                <h6 className="text-xs font-semibold text-slate-700 mb-2">Legend</h6>
                <div className="space-y-1 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-green-500"></div>
                    <span>Connected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-slate-400" style={{ strokeDasharray: '2,2' }}></div>
                    <span>No connection</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 bg-green-500 rounded-full flex items-center justify-center text-white text-xs">2</div>
                    <span>Connection count</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Connections Display */}
      {connections.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8 mt-8">
          <h3 className="font-semibold text-slate-900 mb-4">Current Connections ({connections.length})</h3>
          <div className="space-y-2">
            {connections.map((conn: any, index: number) => (
              <div key={conn.id || index} className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
                <span className="text-sm">
                  <strong>Step {(conn.fromStep || 0) + 1}:</strong> {conn.fromOutput} 
                </span>
                <ArrowRight className="h-4 w-4 text-slate-400" />
                <span className="text-sm">
                  <strong>Step {(conn.toStep || 0) + 1}:</strong> {conn.toInput}
                </span>
                <button
                  onClick={() => handleConnectionRemove(conn.id)}
                  className="ml-auto text-red-600 hover:text-red-800 text-sm px-2 py-1 hover:bg-red-50 rounded transition-colors"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connection Management Modal */}
      {selectedConnection && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4">Connection Details</h3>
            <div className="space-y-3">
              <div>
                <span className="font-medium">From:</span> Step {selectedConnection.fromStep + 1} - {selectedConnection.fromOutput}
              </div>
              <div>
                <span className="font-medium">To:</span> Step {selectedConnection.toStep + 1} - {selectedConnection.toInput}
              </div>
              <div>
                <span className="font-medium">Status:</span> {selectedConnection.isActive ? 'Active' : 'Inactive'}
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => handleConnectionRemove(selectedConnection.id)}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
              >
                Remove
              </button>
              <button
                onClick={() => setSelectedConnection(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Phase Navigation */}
      <div className="flex justify-between items-center mt-12 pt-6 border-t border-slate-200">
        <button
          onClick={onPreviousPhase}
          className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors font-medium"
        >
          ← Previous: Build Workflow
        </button>

        <div className="flex items-center gap-4">
          <div className="text-sm text-slate-600">
            {canComplete ? (
              <span className="text-green-600 flex items-center gap-1">
                <CheckCircle className="h-4 w-4" />
                Ready to proceed
              </span>
            ) : (
              <span className="text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {unconnectedRequired.length} required connections missing
              </span>
            )}
          </div>

          <button
            onClick={onPhaseComplete}
            disabled={!canComplete}
            className={`px-6 py-3 rounded-lg font-medium transition-colors ${
              canComplete
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-slate-300 text-slate-500 cursor-not-allowed'
            }`}
          >
            Next: Configure Integrations →
          </button>
        </div>
      </div>
    </div>
  );
};
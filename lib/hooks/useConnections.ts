import { useState, useCallback, useMemo } from 'react';
import { Connection, ConnectionPoint, ValidationResult } from '../types/connections';
import { WorkflowStep } from '../types/workflow';

export const useConnections = () => {
  const [connections, setConnections] = useState<Connection[]>([]);

  // Add a new connection
  const addConnection = useCallback((connection: Connection) => {
    setConnections(prev => [...prev, connection]);
  }, []);

  // Remove a connection by ID
  const removeConnection = useCallback((connectionId: string) => {
    setConnections(prev => prev.filter(conn => conn.id !== connectionId));
  }, []);

  // Update an existing connection
  const updateConnection = useCallback((connectionId: string, updates: Partial<Connection>) => {
    setConnections(prev => prev.map(conn => 
      conn.id === connectionId ? { ...conn, ...updates } : conn
    ));
  }, []);

  // Get all connections for a specific step
  const getConnectionsForStep = useCallback((stepIndex: number) => {
    return connections.filter(conn => 
      conn.from.stepIndex === stepIndex || conn.to.stepIndex === stepIndex
    );
  }, [connections]);

  // Get connections for a specific field
  const getConnectionsForField = useCallback((stepIndex: number, fieldName: string, isOutput: boolean) => {
    return connections.filter(conn => 
      (isOutput && conn.from.stepIndex === stepIndex && conn.from.fieldName === fieldName) ||
      (!isOutput && conn.to.stepIndex === stepIndex && conn.to.fieldName === fieldName)
    );
  }, [connections]);

  // Check if a field is connected
  const isFieldConnected = useCallback((stepIndex: number, fieldName: string, isOutput: boolean) => {
    return getConnectionsForField(stepIndex, fieldName, isOutput).length > 0;
  }, [getConnectionsForField]);

  // Get unconnected required fields
  const getUnconnectedRequiredFields = useCallback((steps: WorkflowStep[], connections: Connection[]) => {
    const unconnected: ConnectionPoint[] = [];

    steps.forEach((step, stepIndex) => {
      step.inputs.forEach((input, fieldIndex) => {
        if (input.required) {
          const isConnected = connections.some(conn => 
            conn.to.stepIndex === stepIndex && conn.to.fieldName === input.name
          );
          
          if (!isConnected) {
            unconnected.push({
              stepIndex,
              fieldIndex,
              fieldName: input.name,
              fieldType: input.type,
              isOutput: false
            });
          }
        }
      });
    });

    return unconnected;
  }, []);

  // Field type compatibility matrix
  const fieldTypeCompatibility: Record<string, string[]> = {
    'text': ['text', 'textarea', 'email', 'url'],
    'textarea': ['textarea', 'text'],
    'number': ['number', 'text'],
    'email': ['email', 'text'],
    'date': ['date', 'datetime', 'text'],
    'datetime': ['datetime', 'date', 'text'],
    'select': ['select', 'text'],
    'multiselect': ['multiselect', 'json', 'text'],
    'boolean': ['boolean', 'text'],
    'file': ['file', 'url'],
    'url': ['url', 'text'],
    'json': ['json', 'text']
  };

  // Check if two field types are compatible
  const areTypesCompatible = useCallback((fromType: string, toType: string): boolean => {
    const compatibleTypes = fieldTypeCompatibility[fromType] || [];
    return compatibleTypes.includes(toType) || fromType === toType;
  }, []);

  // Auto-connect compatible fields
  const autoConnectCompatibleFields = useCallback((steps: WorkflowStep[]) => {
    const newConnections: Connection[] = [];

    for (let fromStepIndex = 0; fromStepIndex < steps.length - 1; fromStepIndex++) {
      const fromStep = steps[fromStepIndex];
      
      for (let toStepIndex = fromStepIndex + 1; toStepIndex < steps.length; toStepIndex++) {
        const toStep = steps[toStepIndex];

        // Find compatible fields
        fromStep.outputs.forEach((output, outputIndex) => {
          toStep.inputs.forEach((input, inputIndex) => {
            // Check if types are compatible
            if (!areTypesCompatible(output.type, input.type)) return;

            // Check if input is already connected
            const alreadyConnected = connections.some(conn =>
              conn.to.stepIndex === toStepIndex && conn.to.fieldName === input.name
            );
            if (alreadyConnected) return;

            // Check if output is already connected to this input
            const connectionExists = connections.some(conn =>
              conn.from.stepIndex === fromStepIndex && conn.from.fieldName === output.name &&
              conn.to.stepIndex === toStepIndex && conn.to.fieldName === input.name
            );
            if (connectionExists) return;

            // Create auto-connection for exact name matches or required fields
            const shouldAutoConnect = 
              output.name.toLowerCase() === input.name.toLowerCase() ||
              input.required ||
              (output.name.includes(input.name) || input.name.includes(output.name));

            if (shouldAutoConnect) {
              const connection: Connection = {
                id: `auto_${Date.now()}_${fromStepIndex}_${toStepIndex}_${outputIndex}_${inputIndex}`,
                from: {
                  stepIndex: fromStepIndex,
                  fieldIndex: outputIndex,
                  fieldName: output.name,
                  fieldType: output.type,
                  isOutput: true
                },
                to: {
                  stepIndex: toStepIndex,
                  fieldIndex: inputIndex,
                  fieldName: input.name,
                  fieldType: input.type,
                  isOutput: false
                },
                isActive: true,
                isAutoGenerated: true
              };

              newConnections.push(connection);
            }
          });
        });
      }
    }

    // Add new connections
    if (newConnections.length > 0) {
      setConnections(prev => [...prev, ...newConnections]);
    }

    return newConnections;
  }, [connections, areTypesCompatible]);

  // Validate all connections
  const validateConnections = useCallback((steps: WorkflowStep[], connections: Connection[]): ValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    connections.forEach(conn => {
      const fromStep = steps[conn.from.stepIndex];
      const toStep = steps[conn.to.stepIndex];

      if (!fromStep) {
        errors.push(`Connection ${conn.id}: Source step ${conn.from.stepIndex} not found`);
        return;
      }

      if (!toStep) {
        errors.push(`Connection ${conn.id}: Target step ${conn.to.stepIndex} not found`);
        return;
      }

      const fromField = fromStep.outputs.find(output => output.name === conn.from.fieldName);
      const toField = toStep.inputs.find(input => input.name === conn.to.fieldName);

      if (!fromField) {
        errors.push(`Connection ${conn.id}: Source field '${conn.from.fieldName}' not found in step ${conn.from.stepIndex + 1}`);
        return;
      }

      if (!toField) {
        errors.push(`Connection ${conn.id}: Target field '${conn.to.fieldName}' not found in step ${conn.to.stepIndex + 1}`);
        return;
      }

      // Type compatibility check
      if (!areTypesCompatible(fromField.type, toField.type)) {
        if (conn.transform) {
          warnings.push(`Connection ${conn.id}: Type mismatch (${fromField.type} → ${toField.type}) - has transform`);
        } else {
          errors.push(`Connection ${conn.id}: Incompatible types (${fromField.type} → ${toField.type}) - add transform`);
        }
      }

      // Sequential step validation
      if (conn.from.stepIndex >= conn.to.stepIndex) {
        warnings.push(`Connection ${conn.id}: Non-sequential connection (step ${conn.from.stepIndex + 1} → step ${conn.to.stepIndex + 1})`);
      }
    });

    // Check for unconnected required fields
    const unconnectedRequired = getUnconnectedRequiredFields(steps, connections);
    unconnectedRequired.forEach(field => {
      errors.push(`Required field '${field.fieldName}' in step ${field.stepIndex + 1} is not connected`);
    });

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }, [areTypesCompatible, getUnconnectedRequiredFields]);

  // Get connection suggestions
  const getConnectionSuggestions = useCallback((steps: WorkflowStep[]) => {
    const suggestions: Array<{
      from: ConnectionPoint;
      to: ConnectionPoint;
      reason: string;
      confidence: number;
    }> = [];

    for (let fromStepIndex = 0; fromStepIndex < steps.length - 1; fromStepIndex++) {
      const fromStep = steps[fromStepIndex];
      
      for (let toStepIndex = fromStepIndex + 1; toStepIndex < steps.length; toStepIndex++) {
        const toStep = steps[toStepIndex];

        fromStep.outputs.forEach((output, outputIndex) => {
          toStep.inputs.forEach((input, inputIndex) => {
            // Skip if already connected
            const alreadyConnected = connections.some(conn =>
              conn.from.stepIndex === fromStepIndex && conn.from.fieldName === output.name &&
              conn.to.stepIndex === toStepIndex && conn.to.fieldName === input.name
            );
            if (alreadyConnected) return;

            // Calculate suggestion confidence
            let confidence = 0;
            let reason = '';

            if (output.name.toLowerCase() === input.name.toLowerCase()) {
              confidence = 0.9;
              reason = 'Exact name match';
            } else if (output.name.includes(input.name) || input.name.includes(output.name)) {
              confidence = 0.7;
              reason = 'Name similarity';
            } else if (areTypesCompatible(output.type, input.type)) {
              confidence = 0.5;
              reason = 'Type compatibility';
            }

            if (input.required) {
              confidence += 0.2;
              reason += ' (required field)';
            }

            if (confidence > 0.5) {
              suggestions.push({
                from: {
                  stepIndex: fromStepIndex,
                  fieldIndex: outputIndex,
                  fieldName: output.name,
                  fieldType: output.type,
                  isOutput: true
                },
                to: {
                  stepIndex: toStepIndex,
                  fieldIndex: inputIndex,
                  fieldName: input.name,
                  fieldType: input.type,
                  isOutput: false
                },
                reason,
                confidence
              });
            }
          });
        });
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }, [connections, areTypesCompatible]);

  // Clear all connections
  const clearAllConnections = useCallback(() => {
    setConnections([]);
  }, []);

  // Remove connections for a specific step
  const removeConnectionsForStep = useCallback((stepIndex: number) => {
    setConnections(prev => prev.filter(conn => 
      conn.from.stepIndex !== stepIndex && conn.to.stepIndex !== stepIndex
    ));
  }, []);

  // Get connection path (for visualization)
  const getConnectionPath = useCallback((connection: Connection, stepPositions: Array<{x: number, y: number}>) => {
    const fromPos = stepPositions[connection.from.stepIndex];
    const toPos = stepPositions[connection.to.stepIndex];
    
    if (!fromPos || !toPos) return '';

    // Calculate control points for smooth curve
    const deltaX = toPos.x - fromPos.x;
    const controlPoint1X = fromPos.x + deltaX * 0.5;
    const controlPoint2X = toPos.x - deltaX * 0.5;

    return `M ${fromPos.x} ${fromPos.y} C ${controlPoint1X} ${fromPos.y}, ${controlPoint2X} ${toPos.y}, ${toPos.x} ${toPos.y}`;
  }, []);

  // Connection statistics
  const connectionStats = useMemo(() => {
    const totalConnections = connections.length;
    const activeConnections = connections.filter(conn => conn.isActive).length;
    const autoGeneratedConnections = connections.filter(conn => conn.isAutoGenerated).length;
    const connectionsWithTransforms = connections.filter(conn => conn.transform).length;

    return {
      total: totalConnections,
      active: activeConnections,
      autoGenerated: autoGeneratedConnections,
      withTransforms: connectionsWithTransforms,
      manual: totalConnections - autoGeneratedConnections
    };
  }, [connections]);

  return {
    connections,
    addConnection,
    removeConnection,
    updateConnection,
    getConnectionsForStep,
    getConnectionsForField,
    isFieldConnected,
    getUnconnectedRequiredFields,
    areTypesCompatible,
    autoConnectCompatibleFields,
    validateConnections,
    getConnectionSuggestions,
    clearAllConnections,
    removeConnectionsForStep,
    getConnectionPath,
    connectionStats
  };
};
import React, { useState, useEffect } from 'react';
import { X, Settings, Code, Zap, Save, Trash2, AlertTriangle, CheckCircle } from 'lucide-react';
import { Connection, DataTransform } from '../../types/connections';

interface ConnectionManagerProps {
  connection: Connection;
  onUpdate: (connectionId: string, updates: Partial<Connection>) => void;
  onClose: () => void;
}

export const ConnectionManager: React.FC<ConnectionManagerProps> = ({
  connection,
  onUpdate,
  onClose
}) => {
  const [editedConnection, setEditedConnection] = useState<Connection>(connection);
  const [activeTab, setActiveTab] = useState<'details' | 'transform' | 'validation'>('details');
  const [transformScript, setTransformScript] = useState(connection.transform?.script || '');
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  // Transform type options
  const transformTypes: Array<{
    value: DataTransform['type'];
    label: string;
    description: string;
    example: string;
  }> = [
    {
      value: 'map',
      label: 'Map/Rename',
      description: 'Change field names or structure',
      example: '{ "new_name": data.old_name }'
    },
    {
      value: 'filter',
      label: 'Filter',
      description: 'Filter array items based on criteria',
      example: 'data.filter(item => item.status === "active")'
    },
    {
      value: 'transform',
      label: 'Transform',
      description: 'Custom data transformation',
      example: 'data.map(item => ({ ...item, processed: true }))'
    },
    {
      value: 'aggregate',
      label: 'Aggregate',
      description: 'Combine multiple values',
      example: 'data.reduce((sum, item) => sum + item.value, 0)'
    },
    {
      value: 'split',
      label: 'Split',
      description: 'Split single value into multiple',
      example: 'data.split(",").map(s => s.trim())'
    },
    {
      value: 'combine',
      label: 'Combine',
      description: 'Combine multiple inputs',
      example: '[input1, input2, input3].join(" ")'
    }
  ];

  // Update connection when props change
  useEffect(() => {
    setEditedConnection(connection);
    setTransformScript(connection.transform?.script || '');
  }, [connection]);

  // Validate the transform script
  const validateTransform = (script: string, type: DataTransform['type']) => {
    const errors: string[] = [];

    if (!script.trim()) {
      errors.push('Transform script cannot be empty');
      return errors;
    }

    try {
      // Basic syntax validation
      new Function('data', `return ${script}`);
    } catch (error) {
      errors.push(`Syntax error: ${error instanceof Error ? error.message : 'Invalid syntax'}`);
    }

    // Type-specific validations
    switch (type) {
      case 'filter':
        if (!script.includes('filter')) {
          errors.push('Filter transforms should use the .filter() method');
        }
        break;
      case 'map':
        if (!script.includes('map') && !script.includes('{')) {
          errors.push('Map transforms should use .map() method or object notation');
        }
        break;
      case 'aggregate':
        if (!script.includes('reduce') && !script.includes('sum') && !script.includes('count')) {
          errors.push('Aggregate transforms should use .reduce() or aggregation functions');
        }
        break;
      case 'split':
        if (!script.includes('split')) {
          errors.push('Split transforms should use .split() method');
        }
        break;
    }

    return errors;
  };

  // Handle transform script change
  const handleTransformScriptChange = (script: string) => {
    setTransformScript(script);
    
    if (editedConnection.transform) {
      const errors = validateTransform(script, editedConnection.transform.type);
      setValidationErrors(errors);
    }
  };

  // Add or update transform
  const handleTransformUpdate = (type: DataTransform['type'], description?: string) => {
    const transform: DataTransform = {
      id: editedConnection.transform?.id || `transform_${Date.now()}`,
      type,
      config: {},
      script: transformScript,
      description
    };

    setEditedConnection({
      ...editedConnection,
      transform
    });

    const errors = validateTransform(transformScript, type);
    setValidationErrors(errors);
  };

  // Remove transform
  const handleRemoveTransform = () => {
    setEditedConnection({
      ...editedConnection,
      transform: undefined
    });
    setTransformScript('');
    setValidationErrors([]);
  };

  // Save changes
  const handleSave = () => {
    if (validationErrors.length > 0) {
      alert('Please fix validation errors before saving');
      return;
    }

    onUpdate(connection.id, editedConnection);
    onClose();
  };

  // Get field type compatibility indicator
  const getCompatibilityStatus = () => {
    const fromType = connection.from.fieldType;
    const toType = connection.to.fieldType;
    
    if (fromType === toType) {
      return { status: 'perfect', message: 'Perfect type match', color: 'green' };
    }
    
    const compatibilityMatrix: Record<string, string[]> = {
      'text': ['textarea', 'email', 'url'],
      'number': ['text'],
      'json': ['text'],
      'date': ['datetime', 'text'],
      'boolean': ['text']
    };
    
    if (compatibilityMatrix[fromType]?.includes(toType)) {
      return { status: 'compatible', message: 'Compatible types', color: 'blue' };
    }
    
    if (editedConnection.transform) {
      return { status: 'transform', message: 'Compatible with transform', color: 'purple' };
    }
    
    return { status: 'incompatible', message: 'Incompatible types', color: 'red' };
  };

  const compatibility = getCompatibilityStatus();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Connection Editor</h2>
              <p className="text-slate-600 mt-1">
                {connection.from.fieldName} → {connection.to.fieldName}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-4 mt-4">
            {[
              { id: 'details', label: 'Details', icon: Settings },
              { id: 'transform', label: 'Transform', icon: Code },
              { id: 'validation', label: 'Validation', icon: CheckCircle }
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'
                }`}
              >
                <tab.icon className="h-4 w-4" />
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[60vh]">
          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Connection Overview */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="font-medium text-blue-900 mb-3 flex items-center gap-2">
                    📤 Source Field
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-blue-800">Step:</span>
                      <span className="ml-2 text-blue-700">
                        {connection.from.stepIndex + 1}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-blue-800">Field:</span>
                      <span className="ml-2 text-blue-700">{connection.from.fieldName}</span>
                    </div>
                    <div>
                      <span className="font-medium text-blue-800">Type:</span>
                      <span className="ml-2 text-blue-700">{connection.from.fieldType}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="font-medium text-green-900 mb-3 flex items-center gap-2">
                    📥 Target Field
                  </h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-medium text-green-800">Step:</span>
                      <span className="ml-2 text-green-700">
                        {connection.to.stepIndex + 1}
                      </span>
                    </div>
                    <div>
                      <span className="font-medium text-green-800">Field:</span>
                      <span className="ml-2 text-green-700">{connection.to.fieldName}</span>
                    </div>
                    <div>
                      <span className="font-medium text-green-800">Type:</span>
                      <span className="ml-2 text-green-700">{connection.to.fieldType}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Compatibility Status */}
              <div className={`border rounded-lg p-4 ${
                compatibility.color === 'green' ? 'bg-green-50 border-green-200' :
                compatibility.color === 'blue' ? 'bg-blue-50 border-blue-200' :
                compatibility.color === 'purple' ? 'bg-purple-50 border-purple-200' :
                'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {compatibility.status === 'perfect' && <CheckCircle className="h-5 w-5 text-green-600" />}
                  {compatibility.status === 'compatible' && <CheckCircle className="h-5 w-5 text-blue-600" />}
                  {compatibility.status === 'transform' && <Zap className="h-5 w-5 text-purple-600" />}
                  {compatibility.status === 'incompatible' && <AlertTriangle className="h-5 w-5 text-red-600" />}
                  <span className={`font-medium ${
                    compatibility.color === 'green' ? 'text-green-900' :
                    compatibility.color === 'blue' ? 'text-blue-900' :
                    compatibility.color === 'purple' ? 'text-purple-900' :
                    'text-red-900'
                  }`}>
                    {compatibility.message}
                  </span>
                </div>
                <p className={`text-sm ${
                  compatibility.color === 'green' ? 'text-green-700' :
                  compatibility.color === 'blue' ? 'text-blue-700' :
                  compatibility.color === 'purple' ? 'text-purple-700' :
                  'text-red-700'
                }`}>
                  {compatibility.status === 'perfect' && 'Field types match exactly - no transformation needed.'}
                  {compatibility.status === 'compatible' && 'Field types are compatible - automatic conversion available.'}
                  {compatibility.status === 'transform' && 'Field types require transformation - custom logic defined.'}
                  {compatibility.status === 'incompatible' && 'Field types are incompatible - transformation required.'}
                </p>
              </div>

              {/* Connection Metadata */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-sm font-medium text-slate-700 mb-1">Status</div>
                  <div className={`text-sm ${editedConnection.isActive ? 'text-green-600' : 'text-slate-500'}`}>
                    {editedConnection.isActive ? 'Active' : 'Inactive'}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-sm font-medium text-slate-700 mb-1">Type</div>
                  <div className="text-sm text-slate-600">
                    {editedConnection.isAutoGenerated ? 'Auto-generated' : 'Manual'}
                  </div>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-sm font-medium text-slate-700 mb-1">Transform</div>
                  <div className="text-sm text-slate-600">
                    {editedConnection.transform ? editedConnection.transform.type : 'None'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transform' && (
            <div className="space-y-6">
              {/* Transform Type Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-3">
                  Transform Type
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {transformTypes.map(type => (
                    <button
                      key={type.value}
                      onClick={() => handleTransformUpdate(type.value)}
                      className={`p-4 text-left border rounded-lg transition-all ${
                        editedConnection.transform?.type === type.value
                          ? 'border-purple-500 bg-purple-50 text-purple-900'
                          : 'border-slate-200 hover:border-slate-300 text-slate-700'
                      }`}
                    >
                      <div className="font-medium mb-1">{type.label}</div>
                      <div className="text-xs text-slate-600 mb-2">{type.description}</div>
                      <div className="text-xs font-mono bg-slate-100 rounded p-1 truncate">
                        {type.example}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Transform Script Editor */}
              {editedConnection.transform && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Transform Script
                  </label>
                  <div className="space-y-3">
                    <textarea
                      value={transformScript}
                      onChange={(e) => handleTransformScriptChange(e.target.value)}
                      className="w-full h-32 px-3 py-2 border border-slate-300 rounded-md font-mono text-sm focus:ring-purple-500 focus:border-purple-500"
                      placeholder="Enter JavaScript transformation code..."
                    />
                    
                    {/* Validation Results */}
                    {validationErrors.length > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-md p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <AlertTriangle className="h-4 w-4 text-red-600" />
                          <span className="font-medium text-red-900">Validation Errors</span>
                        </div>
                        <ul className="text-sm text-red-800 space-y-1">
                          {validationErrors.map((error, index) => (
                            <li key={index}>• {error}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Transform Description */}
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Description (Optional)
                      </label>
                      <input
                        type="text"
                        value={editedConnection.transform.description || ''}
                        onChange={(e) => handleTransformUpdate(
                          editedConnection.transform!.type,
                          e.target.value
                        )}
                        className="w-full px-3 py-2 border border-slate-300 rounded-md focus:ring-purple-500 focus:border-purple-500"
                        placeholder="Describe what this transformation does..."
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Transform Actions */}
              <div className="flex gap-3">
                {editedConnection.transform ? (
                  <button
                    onClick={handleRemoveTransform}
                    className="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg transition-colors flex items-center gap-2"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove Transform
                  </button>
                ) : (
                  <div className="text-sm text-slate-600">
                    Select a transform type above to add data transformation logic.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'validation' && (
            <div className="space-y-6">
              {/* Overall Status */}
              <div className={`border rounded-lg p-4 ${
                validationErrors.length === 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {validationErrors.length === 0 ? (
                    <CheckCircle className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  )}
                  <span className={`font-medium ${
                    validationErrors.length === 0 ? 'text-green-900' : 'text-red-900'
                  }`}>
                    {validationErrors.length === 0 ? 'Connection Valid' : 'Validation Failed'}
                  </span>
                </div>
                <p className={`text-sm ${
                  validationErrors.length === 0 ? 'text-green-700' : 'text-red-700'
                }`}>
                  {validationErrors.length === 0 
                    ? 'This connection passes all validation checks and is ready to use.'
                    : `Found ${validationErrors.length} validation error${validationErrors.length > 1 ? 's' : ''} that need to be addressed.`
                  }
                </p>
              </div>

              {/* Validation Checklist */}
              <div className="space-y-3">
                <h3 className="font-medium text-slate-900">Validation Checklist</h3>
                
                {[
                  {
                    check: 'Field types compatible',
                    status: compatibility.status !== 'incompatible' || editedConnection.transform,
                    message: compatibility.message
                  },
                  {
                    check: 'Transform script valid',
                    status: !editedConnection.transform || validationErrors.length === 0,
                    message: editedConnection.transform ? 
                      (validationErrors.length === 0 ? 'Transform script is valid' : 'Transform script has errors') :
                      'No transform needed'
                  },
                  {
                    check: 'Connection is active',
                    status: editedConnection.isActive,
                    message: editedConnection.isActive ? 'Connection is active' : 'Connection is inactive'
                  }
                ].map((item, index) => (
                  <div key={index} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                    {item.status ? (
                      <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0" />
                    )}
                    <div>
                      <div className={`font-medium ${item.status ? 'text-slate-900' : 'text-red-900'}`}>
                        {item.check}
                      </div>
                      <div className={`text-sm ${item.status ? 'text-slate-600' : 'text-red-700'}`}>
                        {item.message}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Error Details */}
              {validationErrors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="font-medium text-red-900 mb-3">Error Details</h4>
                  <ul className="space-y-2">
                    {validationErrors.map((error, index) => (
                      <li key={index} className="text-sm text-red-800 flex items-start gap-2">
                        <span className="text-red-500 mt-0.5">•</span>
                        {error}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center p-6 border-t border-slate-200 bg-slate-50">
          <button
            onClick={onClose}
            className="px-6 py-2 text-slate-600 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
          
          <div className="flex gap-3">
            <button
              onClick={() => setEditedConnection({ ...editedConnection, isActive: !editedConnection.isActive })}
              className={`px-4 py-2 rounded-lg transition-colors ${
                editedConnection.isActive
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {editedConnection.isActive ? 'Active' : 'Inactive'}
            </button>
            
            <button
              onClick={handleSave}
              disabled={validationErrors.length > 0}
              className={`px-6 py-2 rounded-lg font-medium transition-colors flex items-center gap-2 ${
                validationErrors.length > 0
                  ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
              }`}
            >
              <Save className="h-4 w-4" />
              Save Connection
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
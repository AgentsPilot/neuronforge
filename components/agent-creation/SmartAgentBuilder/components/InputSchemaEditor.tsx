// components/agent-creation/SmartAgentBuilder/components/InputSchemaEditor.tsx

import React, { useState } from 'react';
import { 
  Settings, 
  Plus, 
  Trash2, 
  GripVertical, 
  Mail, 
  Calendar,
  Hash,
  Type,
  FileText,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  AlertCircle,
  Clock,
  Database
} from 'lucide-react';
import { InputSchemaEditorProps, InputField } from '../types/agent';

export default function InputSchemaEditor({
  inputSchema,
  isEditing,
  onUpdate
}: InputSchemaEditorProps) {
  const [expandedFields, setExpandedFields] = useState<Set<number>>(new Set());
  const [previewMode, setPreviewMode] = useState(false);

  const getFieldTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return <Mail className="h-4 w-4" />;
      case 'date': return <Calendar className="h-4 w-4" />;
      case 'time': return <Clock className="h-4 w-4" />;
      case 'number': return <Hash className="h-4 w-4" />;
      case 'select': return <Database className="h-4 w-4" />;
      case 'textarea': return <FileText className="h-4 w-4" />;
      default: return <Type className="h-4 w-4" />;
    }
  };

  const getDefaultDescription = (field: InputField) => {
    // Smart descriptions based on field name and type
    const name = field.name.toLowerCase();
    
    if (name.includes('email')) {
      if (name.includes('gmail')) return 'Enter your Gmail email address (must end with @gmail.com)';
      if (name.includes('notification') || name.includes('alert')) return 'Email address where notifications will be sent';
      return 'Enter a valid email address';
    }
    
    if (name.includes('time')) {
      if (name.includes('execution') || name.includes('start')) return 'What time should this agent run? (e.g., 09:00 for 9 AM)';
      if (name.includes('end')) return 'What time should this agent stop running? (e.g., 17:00 for 5 PM)';
      return 'Enter a time in 24-hour format (e.g., 09:00)';
    }
    
    if (name.includes('folder') || name.includes('path')) {
      if (name.includes('drive')) return 'The Google Drive folder path where files will be saved (e.g., /My Drive/Email Summaries)';
      return 'Enter the folder path where files should be stored';
    }
    
    if (name.includes('sender')) return 'Email address of the person/service you want to monitor';
    
    if (name.includes('recipient')) return 'Email address that will receive the notifications';
    
    if (field.type === 'date') return 'Select a date from the calendar';
    
    if (field.type === 'number') return 'Enter a numeric value';
    
    if (field.type === 'select' && field.enum?.length) {
      return `Choose one of the available options: ${field.enum.slice(0, 2).join(', ')}${field.enum.length > 2 ? '...' : ''}`;
    }
    
    // Default fallback
    return `Enter ${field.name.replace(/_/g, ' ').toLowerCase()}`;
  };

  const toggleFieldExpanded = (index: number) => {
    const newExpanded = new Set(expandedFields);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedFields(newExpanded);
  };

  const updateField = (index: number, updates: Partial<InputField>) => {
    const newSchema = [...inputSchema];
    newSchema[index] = { ...newSchema[index], ...updates };
    onUpdate(newSchema);
  };

  const removeField = (index: number) => {
    const newSchema = inputSchema.filter((_, i) => i !== index);
    onUpdate(newSchema);
  };

  const getHumanFriendlyLabel = (field: InputField) => {
    // Use label if provided, otherwise convert name to human-friendly format
    return field.label || field.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const addField = () => {
    const fieldTypes = [
      { type: 'string', name: 'text_field', label: 'Text Field', description: 'Enter text information' },
      { type: 'email', name: 'email_field', label: 'Email Address', description: 'Enter a valid email address' },
      { type: 'number', name: 'number_field', label: 'Number', description: 'Enter a numeric value' },
      { type: 'date', name: 'date_field', label: 'Date', description: 'Select a date' },
      { type: 'time', name: 'time_field', label: 'Time', description: 'Select a time' },
    ];
    
    const randomField = fieldTypes[Math.floor(Math.random() * fieldTypes.length)];
    
    const newField: InputField = {
      name: randomField.name,
      label: randomField.label,
      type: randomField.type as InputField['type'],
      required: true,
      placeholder: `Enter ${randomField.label.toLowerCase()}...`,
      description: randomField.description,
      value: '' // Initialize with empty value
    };
    onUpdate([...inputSchema, newField]);
    // Auto-expand the new field
    setExpandedFields(prev => new Set([...prev, inputSchema.length]));
  };

  const renderPreview = () => {
    return (
      <div className="space-y-4 p-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
        <div className="flex items-center gap-2 mb-4">
          <Eye className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Agent Input Form</span>
        </div>
        
        {inputSchema.map((field, index) => (
          <div key={index} className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              {getHumanFriendlyLabel(field)}
              {field.required && <span className="text-red-500">*</span>}
            </label>
            
            {field.type === 'select' && field.enum ? (
              <select 
                value={field.value || ''}
                onChange={(e) => updateField(index, { value: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">{field.placeholder || 'Select an option...'}</option>
                {field.enum.map((option, idx) => (
                  <option key={idx} value={option}>{option}</option>
                ))}
              </select>
            ) : field.type === 'textarea' ? (
              <textarea 
                value={field.value || ''}
                onChange={(e) => updateField(index, { value: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-20 resize-none"
                placeholder={field.placeholder}
              />
            ) : (
              <input 
                type={field.type === 'string' ? 'text' : field.type}
                value={field.value || ''}
                onChange={(e) => updateField(index, { value: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder={field.placeholder}
              />
            )}
            
            {field.description && (
              <p className="text-xs text-gray-500">{field.description}</p>
            )}
          </div>
        ))}

        {/* Show current values summary */}
        {inputSchema.some(field => field.value) && (
          <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <h4 className="text-sm font-medium text-blue-800 mb-2">Current Values:</h4>
            <div className="space-y-1">
              {inputSchema
                .filter(field => field.value)
                .map((field, index) => (
                  <div key={index} className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-blue-700">{getHumanFriendlyLabel(field)}:</span>
                    <span className="text-blue-600">{field.value}</span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center shadow-sm">
            <Settings className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Input Schema</h3>
            <p className="text-sm text-gray-500">
              {inputSchema.length} field{inputSchema.length !== 1 ? 's' : ''}
              {inputSchema.filter(f => f.required).length > 0 && (
                <span className="ml-2">• {inputSchema.filter(f => f.required).length} required</span>
              )}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {inputSchema.length > 0 && (
            <button
              onClick={() => setPreviewMode(!previewMode)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {previewMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {previewMode ? 'Edit' : 'Preview'}
            </button>
          )}
          
          {isEditing && (
            <button
              onClick={addField}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
            >
              <Plus className="h-4 w-4" />
              Add Field
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {previewMode ? (
          renderPreview()
        ) : inputSchema.length > 0 ? (
          <div className="space-y-3">
            {inputSchema.map((field, index) => {
              const isExpanded = expandedFields.has(index);
              const colors = getFieldTypeColor(field.type);
              
              return (
                <div 
                  key={index} 
                  className="border border-gray-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow"
                >
                  {/* Field Header */}
                  <div className="p-4">
                    <div className="flex items-center gap-3">
                      {isEditing && (
                        <div className="cursor-grab text-gray-400 hover:text-gray-600">
                          <GripVertical className="h-4 w-4" />
                        </div>
                      )}
                      
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors.bg} ${colors.border} border`}>
                        <span className={colors.text}>
                          {getFieldTypeIcon(field.type)}
                        </span>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="space-y-2">
                            <input
                              type="text"
                              value={field.name}
                              onChange={(e) => updateField(index, { name: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                              className="text-lg font-semibold text-gray-900 bg-transparent border-0 border-b-2 border-transparent focus:border-blue-500 outline-none w-full"
                              placeholder="field_name"
                            />
                            <input
                              type="text"
                              value={field.label || ''}
                              onChange={(e) => updateField(index, { label: e.target.value })}
                              className="text-sm text-gray-600 bg-transparent border-0 border-b border-gray-300 focus:border-blue-500 outline-none w-full"
                              placeholder="Human-friendly label (e.g., 'Email Address')"
                            />
                          </div>
                        ) : (
                          <div>
                            <h4 className="text-lg font-semibold text-gray-900 truncate">
                              {getHumanFriendlyLabel(field)}
                            </h4>
                            <p className="text-xs text-gray-500">Field name: {field.name}</p>
                          </div>
                        )}
                        
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${colors.bg} ${colors.text}`}>
                            {field.type}
                          </span>
                          
                          {isEditing ? (
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={field.required}
                                onChange={(e) => updateField(index, { required: e.target.checked })}
                                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-xs text-gray-600">Required</span>
                            </label>
                          ) : (
                            <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
                              field.required 
                                ? 'bg-red-100 text-red-700' 
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {field.required ? 'Required' : 'Optional'}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        {isEditing && (
                          <>
                            <button
                              onClick={() => toggleFieldExpanded(index)}
                              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                            >
                              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </button>
                            <button
                              onClick={() => removeField(index)}
                              className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {!isEditing && field.description && (
                          <div className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors" title="Field description">
                            <AlertCircle className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Field Description - Always Visible */}
                    {!isExpanded && (
                      <div className="mt-3 pl-13 space-y-1">
                        {field.description && (
                          <p className="text-sm text-gray-700">{field.description}</p>
                        )}
                        {field.placeholder && (
                          <p className="text-xs text-gray-500 italic">Placeholder: "{field.placeholder}"</p>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Expanded Field Configuration */}
                  {isExpanded && isEditing && (
                    <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-4">
                      {/* Field Name and Label */}
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Field Name (Internal)</label>
                          <input
                            type="text"
                            value={field.name}
                            onChange={(e) => updateField(index, { name: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="field_name"
                          />
                          <p className="text-xs text-gray-500 mt-1">Used internally (lowercase, underscores)</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Display Label</label>
                          <input
                            type="text"
                            value={field.label || ''}
                            onChange={(e) => updateField(index, { label: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Email Address"
                          />
                          <p className="text-xs text-gray-500 mt-1">What users see</p>
                        </div>
                      </div>

                      {/* Field Type */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Field Type</label>
                        <select
                          value={field.type}
                          onChange={(e) => updateField(index, { type: e.target.value as InputField['type'] })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="string">Text</option>
                          <option value="textarea">Long Text</option>
                          <option value="email">Email</option>
                          <option value="number">Number</option>
                          <option value="date">Date</option>
                          <option value="time">Time</option>
                          <option value="select">Dropdown</option>
                          <option value="file">File</option>
                        </select>
                      </div>

                      {/* Default Value */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Default Value</label>
                        {field.type === 'select' && field.enum ? (
                          <select
                            value={field.value || ''}
                            onChange={(e) => updateField(index, { value: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          >
                            <option value="">No default</option>
                            {field.enum.map((option, idx) => (
                              <option key={idx} value={option}>{option}</option>
                            ))}
                          </select>
                        ) : field.type === 'textarea' ? (
                          <textarea
                            value={field.value || ''}
                            onChange={(e) => updateField(index, { value: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-16 resize-none"
                            placeholder="Enter default value..."
                          />
                        ) : (
                          <input
                            type={field.type === 'string' ? 'text' : field.type}
                            value={field.value || ''}
                            onChange={(e) => updateField(index, { value: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            placeholder="Enter default value..."
                          />
                        )}
                      </div>

                      {/* Placeholder */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Placeholder Text</label>
                        <input
                          type="text"
                          value={field.placeholder || ''}
                          onChange={(e) => updateField(index, { placeholder: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter placeholder text..."
                        />
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
                        <textarea
                          value={field.description || ''}
                          onChange={(e) => updateField(index, { description: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-20 resize-none"
                          placeholder="Describe what this field is for..."
                        />
                      </div>

                      {/* Options for Select Field */}
                      {field.type === 'select' && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Options</label>
                          <div className="space-y-2">
                            {(field.enum || []).map((option, optionIndex) => (
                              <div key={optionIndex} className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={option}
                                  onChange={(e) => {
                                    const newEnum = [...(field.enum || [])];
                                    newEnum[optionIndex] = e.target.value;
                                    updateField(index, { enum: newEnum });
                                  }}
                                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                  placeholder="Option value"
                                />
                                <button
                                  onClick={() => {
                                    const newEnum = field.enum?.filter((_, i) => i !== optionIndex);
                                    updateField(index, { enum: newEnum });
                                  }}
                                  className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={() => {
                                const newEnum = [...(field.enum || []), 'New Option'];
                                updateField(index, { enum: newEnum });
                              }}
                              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                            >
                              <Plus className="h-4 w-4" />
                              Add Option
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Settings className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Input Fields</h3>
            <p className="text-gray-500 mb-6 max-w-sm mx-auto">
              This agent doesn't require any user input to run. It will execute automatically with the configured settings.
            </p>
            {isEditing && (
              <button
                onClick={addField}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Add First Field
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
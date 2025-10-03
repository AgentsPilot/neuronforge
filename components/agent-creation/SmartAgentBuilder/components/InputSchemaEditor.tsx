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
  Database,
  FolderOpen,
  User,
  Bell,
  HelpCircle,
  Zap,
  CheckCircle2
} from 'lucide-react';

// Enhanced type definition for better UX
interface InputField {
  name: string;
  label?: string;
  type: 'string' | 'email' | 'number' | 'date' | 'time' | 'select' | 'textarea' | 'file' | 'folder' | 'person' | 'notification';
  required: boolean;
  placeholder?: string;
  description?: string;
  value?: string;
  enum?: string[];
  helpText?: string;
  category?: 'essential' | 'optional' | 'advanced';
  icon?: React.ReactNode;
  userFriendlyType?: string;
}

interface InputSchemaEditorProps {
  inputSchema: InputField[];
  isEditing: boolean;
  onUpdate: (schema: InputField[]) => void;
}

export default function UserFriendlyInputSchemaEditor({
  inputSchema,
  isEditing,
  onUpdate
}: InputSchemaEditorProps) {
  const [expandedFields, setExpandedFields] = useState<Set<number>>(new Set());
  const [previewMode, setPreviewMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Enhanced field type definitions with user-friendly labels and icons
  const getFieldTypeInfo = (type: string) => {
    const typeMap = {
      email: {
        icon: <Mail className="h-4 w-4" />,
        label: 'Email Address',
        color: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200' },
        description: 'An email address field with validation'
      },
      folder: {
        icon: <FolderOpen className="h-4 w-4" />,
        label: 'Folder Location',
        color: { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-200' },
        description: 'Where to save files or find documents'
      },
      notification: {
        icon: <Bell className="h-4 w-4" />,
        label: 'Notification',
        color: { bg: 'bg-yellow-50', text: 'text-yellow-600', border: 'border-yellow-200' },
        description: 'Who to notify when tasks complete'
      },
      person: {
        icon: <User className="h-4 w-4" />,
        label: 'Person',
        color: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200' },
        description: 'Someone who needs access or notification'
      },
      date: {
        icon: <Calendar className="h-4 w-4" />,
        label: 'Date',
        color: { bg: 'bg-indigo-50', text: 'text-indigo-600', border: 'border-indigo-200' },
        description: 'Pick a specific date'
      },
      time: {
        icon: <Clock className="h-4 w-4" />,
        label: 'Time',
        color: { bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200' },
        description: 'Choose a time of day'
      },
      number: {
        icon: <Hash className="h-4 w-4" />,
        label: 'Number',
        color: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200' },
        description: 'A numeric value'
      },
      select: {
        icon: <Database className="h-4 w-4" />,
        label: 'Choice',
        color: { bg: 'bg-cyan-50', text: 'text-cyan-600', border: 'border-cyan-200' },
        description: 'Pick from a list of options'
      },
      textarea: {
        icon: <FileText className="h-4 w-4" />,
        label: 'Long Text',
        color: { bg: 'bg-slate-50', text: 'text-slate-600', border: 'border-slate-200' },
        description: 'Multiple lines of text'
      },
      string: {
        icon: <Type className="h-4 w-4" />,
        label: 'Text',
        color: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' },
        description: 'Simple text input'
      }
    };
    
    return typeMap[type] || typeMap.string;
  };

  // Smart placeholder generation based on field context
  const generateSmartPlaceholder = (field: InputField) => {
    const name = field.name.toLowerCase();
    
    if (field.type === 'email') {
      if (name.includes('notification') || name.includes('alert')) 
        return 'you@company.com';
      if (name.includes('sender') || name.includes('from')) 
        return 'boss@company.com';
      return 'your@email.com';
    }
    
    if (field.type === 'folder' || name.includes('folder')) {
      if (name.includes('drive')) return '/My Drive/Email Summaries';
      if (name.includes('upload')) return 'Choose where to save files';
      return '/Documents/Agent Files';
    }
    
    if (field.type === 'time') {
      if (name.includes('start') || name.includes('run')) return '09:00';
      if (name.includes('end')) return '17:00';
      return '12:00';
    }
    
    return field.placeholder || `Enter ${field.label || field.name.replace(/_/g, ' ')}...`;
  };

  // Enhanced description generation with context awareness
  const generateUserFriendlyDescription = (field: InputField) => {
    if (field.description) return field.description;
    
    const name = field.name.toLowerCase();
    
    // Email field descriptions
    if (field.type === 'email') {
      if (name.includes('notification')) 
        return "📧 Who should receive alerts when this agent completes its tasks?";
      if (name.includes('sender')) 
        return "📧 Which email address should we monitor or send from?";
      return "📧 Enter a valid email address";
    }
    
    // Folder field descriptions
    if (field.type === 'folder' || name.includes('folder')) {
      if (name.includes('drive')) 
        return "📁 Where in Google Drive should we save the files? (Example: /My Drive/Agent Reports)";
      if (name.includes('upload')) 
        return "📁 Choose the folder where files will be automatically saved";
      return "📁 Specify the folder location for file operations";
    }
    
    // Time field descriptions
    if (field.type === 'time') {
      if (name.includes('execution') || name.includes('run')) 
        return "⏰ What time should this agent run each day? (24-hour format like 09:00)";
      return "⏰ Choose a time in 24-hour format (e.g., 14:30 for 2:30 PM)";
    }
    
    return `Enter ${field.label || field.name.replace(/_/g, ' ').toLowerCase()}`;
  };

  // Smart label generation
  const generateUserFriendlyLabel = (field: InputField) => {
    if (field.label) return field.label;
    
    const name = field.name.toLowerCase();
    
    // Smart label mapping based on common patterns
    const labelMappings = {
      'notification_email': 'Who to notify?',
      'upload_folder_id': 'Where to save files?',
      'folder_path': 'Folder location',
      'sender_email': 'From email address',
      'recipient_email': 'To email address',
      'execution_time': 'Run time',
      'start_time': 'Start time',
      'end_time': 'End time',
      'summary_style': 'Summary format',
      'file_format': 'File type'
    };
    
    if (labelMappings[field.name]) {
      return labelMappings[field.name];
    }
    
    // Convert snake_case to Title Case with smart context
    return field.name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase())
      .replace(/Id$/, 'ID')
      .replace(/Email/, 'Email Address')
      .replace(/Folder/, 'Folder Location');
  };

  // Categorize fields by importance
  const categorizeField = (field: InputField) => {
    const name = field.name.toLowerCase();
    const requiredKeywords = ['notification', 'folder', 'email', 'recipient', 'sender'];
    const optionalKeywords = ['style', 'format', 'preference', 'setting'];
    const advancedKeywords = ['config', 'parameter', 'option', 'advanced'];
    
    if (field.required || requiredKeywords.some(keyword => name.includes(keyword))) {
      return 'essential';
    }
    
    if (advancedKeywords.some(keyword => name.includes(keyword))) {
      return 'advanced';
    }
    
    return 'optional';
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

  const addField = () => {
    const commonFieldTypes = [
      { 
        type: 'email', 
        name: 'notification_email', 
        label: 'Who to notify?',
        description: '📧 Enter the email address that should receive notifications when this agent completes its tasks',
        category: 'essential'
      },
      { 
        type: 'folder', 
        name: 'folder_location', 
        label: 'Where to save files?',
        description: '📁 Choose the folder where generated files should be automatically saved',
        category: 'essential'
      },
      { 
        type: 'time', 
        name: 'run_time', 
        label: 'When to run?',
        description: '⏰ What time should this agent run automatically each day?',
        category: 'optional'
      },
      { 
        type: 'string', 
        name: 'custom_field', 
        label: 'Custom Field',
        description: 'A custom field for your specific needs',
        category: 'optional'
      }
    ];
    
    const randomField = commonFieldTypes[Math.floor(Math.random() * commonFieldTypes.length)];
    
    const newField: InputField = {
      ...randomField,
      required: randomField.category === 'essential',
      placeholder: generateSmartPlaceholder(randomField as InputField),
      value: ''
    };
    
    onUpdate([...inputSchema, newField]);
    setExpandedFields(prev => new Set([...prev, inputSchema.length]));
  };

  // Group fields by category
  const groupedFields = inputSchema.reduce((groups, field, index) => {
    const category = categorizeField(field);
    if (!groups[category]) groups[category] = [];
    groups[category].push({ field, index });
    return groups;
  }, {} as Record<string, Array<{ field: InputField; index: number }>>);

  const renderFieldGroup = (title: string, fields: Array<{ field: InputField; index: number }>, categoryColor: string) => {
    if (!fields || fields.length === 0) return null;
    
    return (
      <div className="space-y-3">
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${categoryColor}`}>
          <div className="flex items-center gap-2">
            {title === 'Essential Settings' && <Zap className="h-4 w-4" />}
            {title === 'Optional Settings' && <Settings className="h-4 w-4" />}
            {title === 'Advanced Settings' && <HelpCircle className="h-4 w-4" />}
            <span className="text-sm font-medium">{title}</span>
          </div>
          <span className="text-xs opacity-70">({fields.length})</span>
        </div>
        
        {fields.map(({ field, index }) => renderField(field, index))}
      </div>
    );
  };

  const renderField = (field: InputField, index: number) => {
    const isExpanded = expandedFields.has(index);
    const typeInfo = getFieldTypeInfo(field.type);
    
    return (
      <div 
        key={index} 
        className="border border-gray-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-all duration-200"
      >
        {/* Field Header */}
        <div className="p-4">
          <div className="flex items-start gap-3">
            {isEditing && (
              <div className="cursor-grab text-gray-400 hover:text-gray-600 mt-1">
                <GripVertical className="h-4 w-4" />
              </div>
            )}
            
            {/* Field Icon */}
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${typeInfo.color.bg} ${typeInfo.color.border} border`}>
              <span className={typeInfo.color.text}>
                {typeInfo.icon}
              </span>
            </div>
            
            {/* Field Content */}
            <div className="flex-1 min-w-0">
              {isEditing ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={generateUserFriendlyLabel(field)}
                    onChange={(e) => updateField(index, { label: e.target.value })}
                    className="text-lg font-semibold text-gray-900 bg-transparent border-0 border-b-2 border-transparent focus:border-blue-500 outline-none w-full"
                    placeholder="Field label"
                  />
                  <input
                    type="text"
                    value={field.name}
                    onChange={(e) => updateField(index, { name: e.target.value.replace(/\s+/g, '_').toLowerCase() })}
                    className="text-sm text-gray-500 bg-transparent border-0 border-b border-gray-300 focus:border-blue-500 outline-none w-full"
                    placeholder="field_name (internal)"
                  />
                </div>
              ) : (
                <div>
                  <h4 className="text-lg font-semibold text-gray-900">
                    {generateUserFriendlyLabel(field)}
                  </h4>
                  <p className="text-xs text-gray-500 mt-1">{typeInfo.label}</p>
                </div>
              )}
              
              {/* Field Description */}
              <div className="mt-2">
                <p className="text-sm text-gray-700">
                  {generateUserFriendlyDescription(field)}
                </p>
              </div>
              
              {/* Field Tags */}
              <div className="flex items-center gap-2 mt-2">
                <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${typeInfo.color.bg} ${typeInfo.color.text}`}>
                  {typeInfo.label}
                </span>
                
                {field.required ? (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium bg-red-100 text-red-700">
                    <CheckCircle2 className="h-3 w-3" />
                    Required
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-600">
                    Optional
                  </span>
                )}
              </div>
            </div>
            
            {/* Field Actions */}
            <div className="flex items-center gap-2">
              {isEditing && (
                <>
                  <button
                    onClick={() => setExpandedFields(prev => {
                      const newSet = new Set(prev);
                      if (newSet.has(index)) {
                        newSet.delete(index);
                      } else {
                        newSet.add(index);
                      }
                      return newSet;
                    })}
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
            </div>
          </div>

          {/* Preview Value Input */}
          {!isEditing && (
            <div className="mt-4 pl-13">
              {field.type === 'select' && field.enum ? (
                <select 
                  value={field.value || ''}
                  onChange={(e) => updateField(index, { value: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                >
                  <option value="">{generateSmartPlaceholder(field)}</option>
                  {field.enum.map((option, idx) => (
                    <option key={idx} value={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === 'textarea' ? (
                <textarea 
                  value={field.value || ''}
                  onChange={(e) => updateField(index, { value: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm h-24 resize-none"
                  placeholder={generateSmartPlaceholder(field)}
                />
              ) : (
                <input 
                  type={field.type === 'string' ? 'text' : field.type}
                  value={field.value || ''}
                  onChange={(e) => updateField(index, { value: e.target.value })}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent shadow-sm"
                  placeholder={generateSmartPlaceholder(field)}
                />
              )}
            </div>
          )}
        </div>

        {/* Expanded Configuration */}
        {isExpanded && isEditing && (
          <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Field Type</label>
                <select
                  value={field.type}
                  onChange={(e) => updateField(index, { type: e.target.value as InputField['type'] })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="email">📧 Email Address</option>
                  <option value="folder">📁 Folder Location</option>
                  <option value="notification">🔔 Notification</option>
                  <option value="person">👤 Person</option>
                  <option value="date">📅 Date</option>
                  <option value="time">⏰ Time</option>
                  <option value="number">🔢 Number</option>
                  <option value="select">📋 Choice</option>
                  <option value="textarea">📄 Long Text</option>
                  <option value="string">💬 Text</option>
                </select>
              </div>
              <div>
                <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(index, { required: e.target.checked })}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  Required field
                </label>
                <p className="text-xs text-gray-500 mt-1">Users must fill this out</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
              <textarea
                value={field.description || ''}
                onChange={(e) => updateField(index, { description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent h-20 resize-none"
                placeholder="Help users understand what this field is for..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Placeholder Text</label>
              <input
                type="text"
                value={field.placeholder || ''}
                onChange={(e) => updateField(index, { placeholder: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Example text to show users..."
              />
            </div>

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
  };

  const renderPreview = () => {
    return (
      <div className="space-y-6">
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-xl border border-blue-200">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
              <Eye className="h-5 w-5 text-white" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Agent Setup Form</h3>
              <p className="text-sm text-gray-600">This is what users will see</p>
            </div>
          </div>
          
          {groupedFields.essential && renderFieldGroup('Essential Settings', groupedFields.essential, 'bg-red-50 text-red-800')}
          {groupedFields.optional && renderFieldGroup('Optional Settings', groupedFields.optional, 'bg-yellow-50 text-yellow-800')}
          {groupedFields.advanced && showAdvanced && renderFieldGroup('Advanced Settings', groupedFields.advanced, 'bg-gray-50 text-gray-800')}
          
          {groupedFields.advanced && groupedFields.advanced.length > 0 && (
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {showAdvanced ? 'Hide' : 'Show'} Advanced Settings ({groupedFields.advanced.length})
            </button>
          )}

          {/* Summary */}
          {inputSchema.some(field => field.value) && (
            <div className="mt-6 p-4 bg-white border border-blue-200 rounded-lg">
              <h4 className="text-sm font-medium text-blue-800 mb-2">✅ Ready to run with:</h4>
              <div className="space-y-1">
                {inputSchema
                  .filter(field => field.value)
                  .map((field, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-blue-700">{generateUserFriendlyLabel(field)}:</span>
                      <span className="text-blue-600">{field.value}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
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
            <h3 className="font-semibold text-gray-900">Agent Configuration</h3>
            <p className="text-sm text-gray-500">
              {inputSchema.length === 0 
                ? 'No configuration needed - ready to run!'
                : `${inputSchema.filter(f => f.required).length} required, ${inputSchema.filter(f => !f.required).length} optional`
              }
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {inputSchema.length > 0 && (
            <button
              onClick={() => setPreviewMode(!previewMode)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium ${
                previewMode 
                  ? 'bg-blue-600 text-white hover:bg-blue-700' 
                  : 'text-gray-600 hover:text-gray-800 hover:bg-gray-100'
              }`}
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
          <div className="space-y-6">
            {groupedFields.essential && renderFieldGroup('🚀 Essential Settings', groupedFields.essential, 'bg-red-50 text-red-800')}
            {groupedFields.optional && renderFieldGroup('⚙️ Optional Settings', groupedFields.optional, 'bg-yellow-50 text-yellow-800')}
            {groupedFields.advanced && renderFieldGroup('🔧 Advanced Settings', groupedFields.advanced, 'bg-gray-50 text-gray-800')}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-8 w-8 text-green-600" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">Ready to Run!</h3>
            <p className="text-gray-500 mb-6 max-w-sm mx-auto">
              This agent is fully configured and doesn't need any additional input from you. It can start working immediately.
            </p>
            {isEditing && (
              <button
                onClick={addField}
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                Add Configuration Field
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
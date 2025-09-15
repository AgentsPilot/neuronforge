// components/agent-creation/SmartAgentBuilder/components/OutputSchemaEditor.tsx

import React, { useState } from 'react';
import { 
  Send, 
  Plus, 
  Trash2, 
  Mail, 
  Bell,
  FileText,
  Settings,
  Database,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
  Bot,
  User,
  HardDrive,
  Cloud,
  Edit
} from 'lucide-react';

interface OutputAction {
  id: string;
  type: 'EmailDraft' | 'Alert' | 'SummaryBlock' | 'PluginAction';
  category: 'human-facing' | 'machine-facing';
  name: string;
  description: string;
  plugin?: string;
  config: {
    subject?: string;
    recipient?: string;
    format?: string;
    destination?: string;
    template?: string;
  };
  required: boolean;
}

interface OutputSchemaEditorProps {
  outputSchema: OutputAction[];
  connectedPlugins: string[];
  isEditing: boolean;
  onUpdate: (schema: OutputAction[]) => void;
}

export default function OutputSchemaEditor({
  outputSchema,
  connectedPlugins,
  isEditing,
  onUpdate
}: OutputSchemaEditorProps) {
  const [previewMode, setPreviewMode] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'human-facing' | 'machine-facing'>('all');

  const getOutputTypeIcon = (type: string) => {
    switch (type) {
      case 'EmailDraft': return <Mail className="h-4 w-4" />;
      case 'Alert': return <Bell className="h-4 w-4" />;
      case 'SummaryBlock': return <FileText className="h-4 w-4" />;
      case 'PluginAction': return <Settings className="h-4 w-4" />;
      default: return <Bot className="h-4 w-4" />;
    }
  };

  const getOutputTypeColor = (type: string) => {
    switch (type) {
      case 'EmailDraft': return { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' };
      case 'Alert': return { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' };
      case 'SummaryBlock': return { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200' };
      case 'PluginAction': return { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' };
      default: return { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200' };
    }
  };

  const getCategoryIcon = (category: string) => {
    return category === 'human-facing' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />;
  };

  const updateOutput = (index: number, updates: Partial<OutputAction>) => {
    const newSchema = [...outputSchema];
    newSchema[index] = { ...newSchema[index], ...updates };
    onUpdate(newSchema);
  };

  const removeOutput = (index: number) => {
    const newSchema = outputSchema.filter((_, i) => i !== index);
    onUpdate(newSchema);
  };

  const addOutput = (type: OutputAction['type'], category: OutputAction['category']) => {
    const outputTemplates = {
      EmailDraft: {
        name: 'Email Notification',
        description: 'Send an email with the results',
        config: { subject: 'Agent Results', recipient: '', format: 'html' }
      },
      Alert: {
        name: 'System Alert',
        description: 'Send an alert notification',
        config: { format: 'notification' }
      },
      SummaryBlock: {
        name: 'Summary Report',
        description: 'Generate a formatted summary',
        config: { format: 'markdown', template: 'standard' }
      },
      PluginAction: {
        name: 'Plugin Action',
        description: 'Perform an action using a connected plugin',
        config: { destination: '', plugin: connectedPlugins[0] || '' }
      }
    };

    const template = outputTemplates[type];
    const newOutput: OutputAction = {
      id: `output_${Date.now()}`,
      type,
      category,
      name: template.name,
      description: template.description,
      config: template.config,
      required: true,
      ...(type === 'PluginAction' && { plugin: connectedPlugins[0] || '' })
    };

    onUpdate([...outputSchema, newOutput]);
  };

  const filteredOutputs = selectedCategory === 'all' 
    ? outputSchema 
    : outputSchema.filter(output => output.category === selectedCategory);

  const renderAddOptions = () => {
    return (
      <div className="grid grid-cols-2 gap-3 mt-4">
        {/* Human-facing outputs */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <User className="h-4 w-4" />
            For Humans
          </h4>
          <div className="space-y-1">
            {['EmailDraft', 'Alert', 'SummaryBlock'].map((type) => (
              <button
                key={type}
                onClick={() => addOutput(type as OutputAction['type'], 'human-facing')}
                className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {getOutputTypeIcon(type)}
                  <span className="text-sm font-medium">
                    {type === 'EmailDraft' && '📧 Email Draft'}
                    {type === 'Alert' && '📢 Alert'}
                    {type === 'SummaryBlock' && '📋 Summary Block'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {type === 'EmailDraft' && 'Send results via email'}
                  {type === 'Alert' && 'Push notification or alert'}
                  {type === 'SummaryBlock' && 'Formatted summary report'}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Machine-facing outputs */}
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-700 flex items-center gap-2">
            <Bot className="h-4 w-4" />
            For Systems
          </h4>
          <div className="space-y-1">
            <button
              onClick={() => addOutput('PluginAction', 'machine-facing')}
              className="w-full text-left p-3 border border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                <span className="text-sm font-medium">🔌 Plugin Action</span>
              </div>
              <p className="text-xs text-gray-500 mt-1">Save, update, or store data</p>
            </button>
            {connectedPlugins.length === 0 && (
              <p className="text-xs text-gray-400 px-3 py-2">
                Connect plugins to enable system actions
              </p>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderOutputPreview = () => {
    return (
      <div className="space-y-4 p-6 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
        <div className="flex items-center gap-2 mb-4">
          <Eye className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-700">Output Preview</span>
        </div>
        
        {outputSchema.map((output, index) => (
          <div key={output.id} className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getOutputTypeColor(output.type).bg}`}>
                <span className={getOutputTypeColor(output.type).text}>
                  {getOutputTypeIcon(output.type)}
                </span>
              </div>
              <div>
                <h4 className="font-medium text-gray-900">{output.name}</h4>
                <p className="text-sm text-gray-600">{output.description}</p>
              </div>
              <div className="ml-auto">
                <span className={`px-2 py-1 rounded text-xs font-medium ${
                  output.category === 'human-facing' 
                    ? 'bg-blue-100 text-blue-700' 
                    : 'bg-purple-100 text-purple-700'
                }`}>
                  {output.category === 'human-facing' ? 'Human' : 'System'}
                </span>
              </div>
            </div>
            
            {/* Preview output format */}
            <div className="mt-3 p-3 bg-gray-50 rounded border text-sm">
              {output.type === 'EmailDraft' && (
                <div>
                  <div className="font-medium">Email Preview:</div>
                  <div className="text-gray-600 mt-1">
                    To: {output.config.recipient || '[User Email]'}<br/>
                    Subject: {output.config.subject || 'Agent Results'}<br/>
                    Content: [Generated content will appear here]
                  </div>
                </div>
              )}
              {output.type === 'Alert' && (
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-orange-500" />
                  <span>[Alert notification will be sent]</span>
                </div>
              )}
              {output.type === 'SummaryBlock' && (
                <div>
                  <div className="font-medium">Summary Format: {output.config.format}</div>
                  <div className="text-gray-600 mt-1">[Formatted summary content]</div>
                </div>
              )}
              {output.type === 'PluginAction' && (
                <div className="flex items-center gap-2">
                  <Database className="h-4 w-4 text-purple-500" />
                  <span>Action via {output.plugin || 'Connected Plugin'}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-6 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center shadow-sm">
            <Send className="h-5 w-5 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Output Schema</h3>
            <p className="text-sm text-gray-500">
              {outputSchema.length} output{outputSchema.length !== 1 ? 's' : ''}
              {outputSchema.filter(o => o.category === 'human-facing').length > 0 && (
                <span className="ml-2">
                  • {outputSchema.filter(o => o.category === 'human-facing').length} human-facing
                </span>
              )}
              {outputSchema.filter(o => o.category === 'machine-facing').length > 0 && (
                <span className="ml-2">
                  • {outputSchema.filter(o => o.category === 'machine-facing').length} system actions
                </span>
              )}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {outputSchema.length > 0 && (
            <button
              onClick={() => setPreviewMode(!previewMode)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {previewMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {previewMode ? 'Edit' : 'Preview'}
            </button>
          )}

          {isEditing && !previewMode && (
            <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
              {['all', 'human-facing', 'machine-facing'].map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category as any)}
                  className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    selectedCategory === category
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  {category === 'all' && 'All'}
                  {category === 'human-facing' && 'Human'}
                  {category === 'machine-facing' && 'System'}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-6">
        {previewMode ? (
          renderOutputPreview()
        ) : outputSchema.length > 0 ? (
          <div className="space-y-4">
            {filteredOutputs.map((output, index) => {
              const colors = getOutputTypeColor(output.type);
              const actualIndex = outputSchema.findIndex(o => o.id === output.id);
              
              return (
                <div 
                  key={output.id} 
                  className="border border-gray-200 rounded-xl bg-white shadow-sm hover:shadow-md transition-shadow"
                >
                  <div className="p-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${colors.bg} ${colors.border} border`}>
                        <span className={colors.text}>
                          {getOutputTypeIcon(output.type)}
                        </span>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <input
                            type="text"
                            value={output.name}
                            onChange={(e) => updateOutput(actualIndex, { name: e.target.value })}
                            className="text-lg font-semibold text-gray-900 bg-transparent border-0 border-b-2 border-transparent focus:border-blue-500 outline-none w-full"
                            placeholder="Output name"
                          />
                        ) : (
                          <h4 className="text-lg font-semibold text-gray-900 truncate">
                            {output.name}
                          </h4>
                        )}
                        
                        <div className="flex items-center gap-2 mt-1">
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${colors.bg} ${colors.text}`}>
                            {output.type}
                          </span>
                          
                          <span className={`inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ${
                            output.category === 'human-facing'
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-purple-100 text-purple-700'
                          }`}>
                            <span className="mr-1">
                              {getCategoryIcon(output.category)}
                            </span>
                            {output.category === 'human-facing' ? 'Human' : 'System'}
                          </span>

                          {output.plugin && (
                            <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700">
                              {output.plugin}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {isEditing && (
                        <button
                          onClick={() => removeOutput(actualIndex)}
                          className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* Description */}
                    <div className="mt-3 pl-13">
                      {isEditing ? (
                        <textarea
                          value={output.description}
                          onChange={(e) => updateOutput(actualIndex, { description: e.target.value })}
                          className="w-full text-sm text-gray-700 bg-transparent border border-gray-200 rounded-lg px-3 py-2 focus:border-blue-500 outline-none resize-none h-16"
                          placeholder="Describe what this output does..."
                        />
                      ) : (
                        <p className="text-sm text-gray-700">{output.description}</p>
                      )}
                    </div>

                    {/* Configuration Preview */}
                    {Object.keys(output.config).length > 0 && (
                      <div className="mt-3 pl-13">
                        <div className="p-3 bg-gray-50 rounded-lg border">
                          <h5 className="text-xs font-medium text-gray-600 mb-2">Configuration:</h5>
                          <div className="space-y-1">
                            {Object.entries(output.config).map(([key, value]) => (
                              value && (
                                <div key={key} className="flex items-center gap-2 text-xs">
                                  <span className="font-medium text-gray-600 capitalize">
                                    {key.replace(/([A-Z])/g, ' $1').trim()}:
                                  </span>
                                  <span className="text-gray-700">{value}</span>
                                </div>
                              )
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isEditing && (
              <div className="border-2 border-dashed border-gray-200 rounded-xl p-6">
                <div className="text-center">
                  <Plus className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                  <h4 className="text-sm font-medium text-gray-700 mb-1">Add Output</h4>
                  <p className="text-xs text-gray-500 mb-4">Choose how your agent will deliver results</p>
                </div>
                {renderAddOptions()}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <Send className="h-8 w-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Output Configured</h3>
            <p className="text-gray-500 mb-6 max-w-sm mx-auto">
              Your agent needs to know how to deliver results. Add outputs to define where and how results are sent.
            </p>
            {isEditing && (
              <div className="max-w-md mx-auto">
                {renderAddOptions()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
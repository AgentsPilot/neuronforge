import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Settings,
  FileText,
  Edit3,
  Trash2,
  Plus
} from 'lucide-react';

interface RequiredInput {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: any;
  options?: string[];
  phase?: 'input' | 'process' | 'output';
}

interface Output {
  type: string;
  destination?: string;
  format?: string;
  description?: string;
  pluginKey?: string;
  phase?: 'input' | 'process' | 'output';
}

interface SmartBusinessWorkflowConfigProps {
  editableInputs?: RequiredInput[];
  editableOutputs?: Output[];
  onUpdateInput?: (phase: 'input' | 'process' | 'output', index: number, updates: Partial<RequiredInput>) => void;
  onUpdateOutput?: (phase: 'input' | 'process' | 'output', index: number, updates: Partial<Output>) => void;
  onAddInput?: () => void;
  onAddOutput?: () => void;
  onRemoveInput?: (index: number) => void;
  onRemoveOutput?: (index: number) => void;
}

const SmartBusinessWorkflowConfig: React.FC<SmartBusinessWorkflowConfigProps> = ({
  editableInputs = [],
  editableOutputs = [],
  onUpdateInput,
  onUpdateOutput,
  onAddInput,
  onAddOutput,
  onRemoveInput,
  onRemoveOutput
}) => {
  const [activeSection, setActiveSection] = useState<'inputs' | 'outputs' | ''>('inputs');

  const convertToBusinessLabel = (input: RequiredInput) => {
    const name = input.name.toLowerCase();
    
    // Simple conversions to make technical names more user-friendly
    if (name.includes('search') || name.includes('query')) {
      return 'What to search for';
    }
    if (name.includes('email') || name.includes('recipient')) {
      return 'Email recipients';
    }
    if (name.includes('channel')) {
      return 'Channel or location';
    }
    if (name.includes('time') || name.includes('schedule')) {
      return 'When to run';
    }
    if (name.includes('folder') || name.includes('destination')) {
      return 'Where to save';
    }
    if (name.includes('format')) {
      return 'Output format';
    }
    
    // Default: clean up the technical name
    return input.name
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .replace(/^\w/, c => c.toUpperCase());
  };

  const getInputType = (input: RequiredInput) => {
    if (input.type === 'boolean') return 'toggle';
    if (input.options && input.options.length > 0) return 'dropdown';
    if (input.type === 'number') return 'number';
    return 'text';
  };

  const renderInput = (input: RequiredInput, index: number) => {
    const businessLabel = convertToBusinessLabel(input);
    const inputType = getInputType(input);
    const currentValue = input.defaultValue || '';

    return (
      <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <label className="font-medium text-gray-900">
            {businessLabel}
            {input.required && <span className="text-red-500 ml-1">*</span>}
          </label>
          {onRemoveInput && (
            <button
              onClick={() => onRemoveInput(index)}
              className="text-red-500 hover:text-red-700 p-1"
              title="Remove input"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {input.description && (
          <p className="text-sm text-gray-600">{input.description}</p>
        )}

        {inputType === 'dropdown' ? (
          <select
            value={currentValue}
            onChange={(e) => onUpdateInput?.('input', index, { defaultValue: e.target.value })}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select an option...</option>
            {input.options?.map((option, optIndex) => (
              <option key={optIndex} value={option}>{option}</option>
            ))}
          </select>
        ) : inputType === 'toggle' ? (
          <div className="flex gap-4">
            <label className="flex items-center">
              <input
                type="radio"
                name={`input-${index}`}
                checked={currentValue === true}
                onChange={() => onUpdateInput?.('input', index, { defaultValue: true })}
                className="mr-2"
              />
              Yes
            </label>
            <label className="flex items-center">
              <input
                type="radio"
                name={`input-${index}`}
                checked={currentValue === false}
                onChange={() => onUpdateInput?.('input', index, { defaultValue: false })}
                className="mr-2"
              />
              No
            </label>
          </div>
        ) : inputType === 'number' ? (
          <input
            type="number"
            value={currentValue}
            onChange={(e) => onUpdateInput?.('input', index, { defaultValue: e.target.value })}
            placeholder={input.placeholder}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
        ) : (
          <textarea
            value={currentValue}
            onChange={(e) => onUpdateInput?.('input', index, { defaultValue: e.target.value })}
            placeholder={input.placeholder || `Enter ${businessLabel.toLowerCase()}`}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 resize-none"
            rows={2}
          />
        )}
      </div>
    );
  };

  const renderOutput = (output: Output, index: number) => {
    const outputLabel = output.type
      .replace(/_/g, ' ')
      .replace(/([A-Z])/g, ' $1')
      .toLowerCase()
      .replace(/^\w/, c => c.toUpperCase());

    return (
      <div key={index} className="border border-gray-200 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-gray-900">{outputLabel}</h4>
          {onRemoveOutput && (
            <button
              onClick={() => onRemoveOutput(index)}
              className="text-red-500 hover:text-red-700 p-1"
              title="Remove output"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {output.description && (
          <p className="text-sm text-gray-600">{output.description}</p>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          {output.destination && (
            <div>
              <span className="font-medium text-gray-700">Destination:</span>
              <p className="text-gray-600">{output.destination}</p>
            </div>
          )}
          {output.format && (
            <div>
              <span className="font-medium text-gray-700">Format:</span>
              <p className="text-gray-600">{output.format}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const toggleSection = (section: 'inputs' | 'outputs') => {
    setActiveSection(activeSection === section ? '' : section);
  };

  return (
    <div className="space-y-6">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="text-lg font-semibold text-blue-900 mb-2">Workflow Configuration</h3>
        <p className="text-blue-800 text-sm">
          Configure the inputs and outputs for your workflow in simple, business-friendly terms.
        </p>
      </div>

      {/* Inputs Section */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => toggleSection('inputs')}
          className={`w-full p-4 flex items-center justify-between text-left transition-colors ${
            activeSection === 'inputs' ? 'bg-blue-50' : 'bg-white hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-blue-600" />
            <span className="font-medium text-gray-900">
              Configuration Settings ({editableInputs.length})
            </span>
          </div>
          {activeSection === 'inputs' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        
        {activeSection === 'inputs' && (
          <div className="p-6 bg-gray-50 border-t">
            <div className="space-y-4">
              {editableInputs.length > 0 ? (
                editableInputs.map((input, index) => renderInput(input, index))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <Settings className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No configuration settings required for this workflow</p>
                </div>
              )}
              
              {onAddInput && (
                <button
                  onClick={onAddInput}
                  className="w-full p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-blue-300 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Configuration Setting
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Outputs Section */}
      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <button
          onClick={() => toggleSection('outputs')}
          className={`w-full p-4 flex items-center justify-between text-left transition-colors ${
            activeSection === 'outputs' ? 'bg-green-50' : 'bg-white hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-green-600" />
            <span className="font-medium text-gray-900">
              Expected Results ({editableOutputs.length})
            </span>
          </div>
          {activeSection === 'outputs' ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        
        {activeSection === 'outputs' && (
          <div className="p-6 bg-gray-50 border-t">
            <div className="space-y-4">
              {editableOutputs.length > 0 ? (
                editableOutputs.map((output, index) => renderOutput(output, index))
              ) : (
                <div className="text-center py-8 text-gray-500">
                  <FileText className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No specific outputs defined for this workflow</p>
                </div>
              )}
              
              {onAddOutput && (
                <button
                  onClick={onAddOutput}
                  className="w-full p-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-green-300 hover:text-green-600 transition-colors flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Expected Result
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SmartBusinessWorkflowConfig;
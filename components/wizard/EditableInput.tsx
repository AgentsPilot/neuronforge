import React, { useState } from 'react';
import { Save, X, Edit3, Trash2, Tag } from 'lucide-react';
import type { RequiredInput } from './types';

interface EditableInputProps {
  input: RequiredInput;
  index: number;
  onUpdate: (updates: Partial<RequiredInput>) => void;
  onRemove: () => void;
}

export const EditableInput: React.FC<EditableInputProps> = ({ 
  input, 
  index, 
  onUpdate, 
  onRemove 
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localInput, setLocalInput] = useState(input);

  const handleSave = () => {
    onUpdate(localInput);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setLocalInput(input);
    setIsEditing(false);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
      {isEditing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Label</label>
            <input
              value={localInput.label || ''}
              onChange={(e) => setLocalInput({...localInput, label: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Input label"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Field Name</label>
            <input
              value={localInput.name}
              onChange={(e) => setLocalInput({...localInput, name: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Field name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Description</label>
            <textarea
              value={localInput.description}
              onChange={(e) => setLocalInput({...localInput, description: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={2}
              placeholder="Field description"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Type</label>
              <select
                value={localInput.type}
                onChange={(e) => setLocalInput({...localInput, type: e.target.value})}
                className="w-full p-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="string">Text</option>
                <option value="number">Number</option>
                <option value="boolean">Yes/No</option>
                <option value="enum">Select from options</option>
                <option value="date">Date</option>
                <option value="email">Email</option>
                <option value="url">URL</option>
              </select>
            </div>
            <div className="flex items-center">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={localInput.required}
                  onChange={(e) => setLocalInput({...localInput, required: e.target.checked})}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500"
                />
                <span className="text-sm font-medium text-gray-700">Required field</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Placeholder</label>
            <input
              value={localInput.placeholder || ''}
              onChange={(e) => setLocalInput({...localInput, placeholder: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="Placeholder text"
            />
          </div>
          {localInput.type === 'enum' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Options (comma-separated)</label>
              <input
                value={localInput.options?.join(', ') || ''}
                onChange={(e) => setLocalInput({
                  ...localInput, 
                  options: e.target.value.split(',').map(opt => opt.trim()).filter(Boolean)
                })}
                className="w-full p-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Option 1, Option 2, Option 3"
              />
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-xl text-sm hover:bg-emerald-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              Save
            </button>
            <button
              onClick={handleCancel}
              className="flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-xl text-sm hover:bg-gray-700 transition-colors"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Tag className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <h6 className="font-semibold text-gray-900">{input.label || input.name}</h6>
                {input.label && input.label !== input.name && (
                  <p className="text-xs text-gray-500 font-mono">{input.name}</p>
                )}
              </div>
              {input.required && (
                <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">
                  Required
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditing(true)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                title="Edit input"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                onClick={onRemove}
                className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                title="Remove input"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
          
          <p className="text-sm text-gray-600 mb-3 leading-relaxed">{input.description}</p>
          
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Type:</span>
              <span className="font-mono bg-gray-100 px-2 py-1 rounded text-gray-800">
                {input.type}
              </span>
            </div>
            {input.placeholder && (
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-700">Example:</span>
                <span className="text-gray-600 italic">{input.placeholder}</span>
              </div>
            )}
          </div>
          
          {input.options && input.options.length > 0 && (
            <div className="mt-3">
              <span className="text-xs font-medium text-gray-700 mb-2 block">Available options:</span>
              <div className="flex flex-wrap gap-1">
                {input.options.map((option, optIndex) => (
                  <span 
                    key={optIndex} 
                    className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full"
                  >
                    {option}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
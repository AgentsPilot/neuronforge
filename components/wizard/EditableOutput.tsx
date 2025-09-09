import React, { useState } from 'react';
import { Save, X, Edit3, Trash2, FileText, MapPin } from 'lucide-react';
import type { Output } from './types';

interface EditableOutputProps {
  output: Output;
  index: number;
  onUpdate: (updates: Partial<Output>) => void;
  onRemove: () => void;
}

export const EditableOutput: React.FC<EditableOutputProps> = ({ 
  output, 
  index, 
  onUpdate, 
  onRemove 
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localOutput, setLocalOutput] = useState(output);

  const handleSave = () => {
    onUpdate(localOutput);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setLocalOutput(output);
    setIsEditing(false);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
      {isEditing ? (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Label</label>
            <input
              value={localOutput.label || ''}
              onChange={(e) => setLocalOutput({...localOutput, label: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              placeholder="Output label"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Output Type</label>
            <input
              value={localOutput.type}
              onChange={(e) => setLocalOutput({...localOutput, type: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm font-medium focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              placeholder="Output type (e.g., Report, Alert, Data)"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Destination</label>
            <input
              value={localOutput.destination}
              onChange={(e) => setLocalOutput({...localOutput, destination: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              placeholder="Where the output will be sent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Format Description</label>
            <textarea
              value={localOutput.format}
              onChange={(e) => setLocalOutput({...localOutput, format: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm resize-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              rows={3}
              placeholder="Describe the format and structure of this output"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Plugin Key</label>
            <input
              value={localOutput.pluginKey}
              onChange={(e) => setLocalOutput({...localOutput, pluginKey: e.target.value})}
              className="w-full p-3 border border-gray-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              placeholder="Plugin responsible for this output"
            />
          </div>
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
              <div className="p-2 bg-emerald-100 rounded-lg">
                <FileText className="w-4 h-4 text-emerald-600" />
              </div>
              <div>
                <h6 className="font-semibold text-gray-900">{output.label || output.type}</h6>
                {output.label && output.label !== output.type && (
                  <p className="text-xs text-gray-500">{output.type}</p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setIsEditing(true)}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                title="Edit output"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                onClick={onRemove}
                className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                title="Remove output"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <MapPin className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-700">Destination</p>
                <p className="text-sm text-emerald-600 font-medium">{output.destination}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <FileText className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-700 mb-1">Format</p>
                <p className="text-sm text-gray-600 leading-relaxed">{output.format}</p>
              </div>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <span className="text-xs font-medium text-gray-700">Plugin:</span>
              <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded text-gray-800">
                {output.pluginKey}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
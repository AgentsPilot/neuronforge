// components/agent-creation/SmartAgentBuilder/components/AgentActions.tsx

import React, { useState, useRef, useEffect } from 'react';
import { 
  ArrowLeft,
  Brain,
  Edit3,
  Save,
  X,
  Play,
  ArrowRight,
  Check,
  Pencil
} from 'lucide-react';
import { AgentActionsProps } from '../types/agent';

interface EnhancedAgentActionsProps extends AgentActionsProps {
  onAgentNameChange?: (newName: string) => void;
}

export default function AgentActions({
  agent,
  isEditing,
  isTesting,
  promptType,
  onBack,
  onEdit,
  onSave,
  onCancel,
  onTest,
  onCreate,
  onAgentNameChange
}: EnhancedAgentActionsProps) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedName, setEditedName] = useState(agent?.agent_name || 'Smart Agent');
  const inputRef = useRef<HTMLInputElement>(null);

  // Update edited name when agent changes
  useEffect(() => {
    if (agent?.agent_name) {
      setEditedName(agent.agent_name);
    }
  }, [agent?.agent_name]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingName && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditingName]);

  const handleStartEditingName = () => {
    setIsEditingName(true);
  };

  const handleSaveName = () => {
    if (editedName.trim() && editedName !== agent?.agent_name) {
      onAgentNameChange?.(editedName.trim());
    }
    setIsEditingName(false);
  };

  const handleCancelEditName = () => {
    setEditedName(agent?.agent_name || 'Smart Agent');
    setIsEditingName(false);
  };

  const handleNameKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveName();
    } else if (e.key === 'Escape') {
      handleCancelEditName();
    }
  };

  const handleNameBlur = () => {
    handleSaveName();
  };

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-gray-500 hover:text-gray-700 transition-colors flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl flex items-center justify-center">
            <Brain className="h-6 w-6 text-white" />
          </div>
          <div>
            {/* Editable Agent Name */}
            <div className="flex items-center gap-2 group">
              {isEditingName ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={inputRef}
                    type="text"
                    value={editedName}
                    onChange={(e) => setEditedName(e.target.value)}
                    onKeyDown={handleNameKeyPress}
                    onBlur={handleNameBlur}
                    className="text-xl font-semibold text-gray-900 bg-white border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent min-w-0"
                    style={{ width: `${Math.max(editedName.length * 0.6, 10)}em` }}
                    maxLength={100}
                  />
                  <button
                    onClick={handleSaveName}
                    className="text-green-600 hover:text-green-700 p-1"
                    title="Save name"
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={handleCancelEditName}
                    className="text-gray-400 hover:text-gray-600 p-1"
                    title="Cancel"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-gray-900">
                    {agent?.agent_name || 'Smart Agent'}
                  </h1>
                  <button
                    onClick={handleStartEditingName}
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-gray-600 p-1 transition-all duration-200"
                    title="Edit agent name"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                </div>
              )}
            </div>
            <p className="text-sm text-gray-500">
              Smart Agent Preview • {promptType} prompt
            </p>
          </div>
        </div>
      </div>
      
      <div className="flex items-center gap-3">
        {/* Status Badge */}
        <div className="px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700 border border-blue-200">
          {agent?.status?.toUpperCase() || 'DRAFT'}
        </div>
        
        {/* Action Buttons */}
        {!isEditing ? (
          <>
            <button
              onClick={onTest}
              disabled={isTesting || !agent}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Play className="h-4 w-4" />
              {isTesting ? 'Testing...' : 'Test Agent'}
            </button>
            <button
              onClick={onEdit}
              disabled={!agent}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Edit3 className="h-4 w-4" />
              Edit
            </button>
            <button
              onClick={onCreate}
              disabled={!agent}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ArrowRight className="h-4 w-4" />
              Create Agent
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onCancel}
              className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <X className="h-4 w-4" />
              Cancel
            </button>
            <button
              onClick={onSave}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Save className="h-4 w-4" />
              Save Changes
            </button>
          </>
        )}
      </div>
    </div>
  );
}
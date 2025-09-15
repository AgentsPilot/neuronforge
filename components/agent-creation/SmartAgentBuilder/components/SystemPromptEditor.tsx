// components/agent-creation/SmartAgentBuilder/components/SystemPromptEditor.tsx

import React from 'react';
import { Code, Target } from 'lucide-react';
import { SystemPromptEditorProps } from '../types/agent';

export default function SystemPromptEditor({
  systemPrompt,
  userPrompt,
  isEditing,
  onUpdateSystem,
  onUpdateUser
}: SystemPromptEditorProps) {
  return (
    <div className="space-y-6">
      {/* System Prompt */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center">
            <Code className="h-4 w-4 text-indigo-600" />
          </div>
          <h3 className="font-semibold text-gray-900">System Prompt</h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
            AI Behavior Instructions
          </span>
        </div>
        
        <div className="bg-gray-50 rounded-lg p-4">
          {isEditing ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 block">
                System Instructions:
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => onUpdateSystem(e.target.value)}
                className="w-full h-32 text-sm text-gray-700 bg-white border border-gray-300 rounded focus:border-blue-500 outline-none p-3 font-mono"
                placeholder="Enter system instructions for the AI agent..."
              />
              <p className="text-xs text-gray-500">
                These instructions define how the AI agent should behave and respond during execution.
              </p>
            </div>
          ) : (
            <>
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed">
                {systemPrompt}
              </pre>
              {!systemPrompt && (
                <p className="text-gray-500 text-sm italic">No system prompt defined</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* User Prompt Template */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
            <Target className="h-4 w-4 text-green-600" />
          </div>
          <h3 className="font-semibold text-gray-900">User Prompt Template</h3>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
            Task Instructions
          </span>
        </div>
        
        <div className="bg-gray-50 rounded-lg p-4">
          {isEditing ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700 block">
                Task Template:
              </label>
              <textarea
                value={userPrompt}
                onChange={(e) => onUpdateUser(e.target.value)}
                className="w-full h-24 text-sm text-gray-700 bg-white border border-gray-300 rounded focus:border-blue-500 outline-none p-3"
                placeholder="Enter the task template that will be sent to the AI..."
              />
              <p className="text-xs text-gray-500">
                This template defines the specific task the agent will perform. User inputs will be inserted into this template.
              </p>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-700 leading-relaxed">
                {userPrompt}
              </p>
              {!userPrompt && (
                <p className="text-gray-500 text-sm italic">No user prompt template defined</p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Prompt Preview */}
      {(systemPrompt || userPrompt) && !isEditing && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
          <h4 className="text-sm font-semibold text-blue-900 mb-3 flex items-center gap-2">
            <Code className="h-4 w-4" />
            Execution Preview
          </h4>
          <div className="space-y-4 text-sm">
            {systemPrompt && (
              <div>
                <p className="text-blue-700 font-medium mb-1">System Context:</p>
                <p className="text-blue-600 bg-blue-100 p-2 rounded text-xs font-mono">
                  {systemPrompt.slice(0, 200)}{systemPrompt.length > 200 ? '...' : ''}
                </p>
              </div>
            )}
            {userPrompt && (
              <div>
                <p className="text-blue-700 font-medium mb-1">User Task:</p>
                <p className="text-blue-600 bg-blue-100 p-2 rounded text-xs">
                  {userPrompt.slice(0, 200)}{userPrompt.length > 200 ? '...' : ''}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
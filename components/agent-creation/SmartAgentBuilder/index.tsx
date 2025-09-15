// components/agent-creation/SmartAgentBuilder/index.tsx

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/components/UserProvider';
import { 
  Brain, 
  Loader2, 
  AlertTriangle, 
  RefreshCw,
  ArrowLeft
} from 'lucide-react';

// Import sub-components
import AgentPreview from './components/AgentPreview';
import InputSchemaEditor from './components/InputSchemaEditor';
import PluginRequirements from './components/PluginRequirements';
import SystemPromptEditor from './components/SystemPromptEditor';
import TestRunner from './components/TestRunner';
import AgentActions from './components/AgentActions';

// Import hooks
import { useAgentGeneration } from './hooks/useAgentGeneration';
import { useAgentTesting } from './hooks/useAgentTesting';

// Import types
import { Agent, SmartAgentBuilderProps } from './types/agent';

export default function SmartAgentBuilder({
  prompt,
  promptType,
  clarificationAnswers = {},
  onAgentCreated,
  onBack,
  onCancel
}: SmartAgentBuilderProps) {
  const { user } = useAuth();
  
  // DEBUG: Log props received
  console.log('🚀 SmartAgentBuilder mounted with props:', {
    prompt: prompt?.slice(0, 100) + '...',
    promptType,
    clarificationAnswersCount: Object.keys(clarificationAnswers).length,
    hasOnAgentCreated: !!onAgentCreated,
    hasOnBack: !!onBack,
    hasOnCancel: !!onCancel,
    userId: user?.id
  });
  
  // State management
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedAgent, setEditedAgent] = useState<Agent | null>(null);
  
  // Custom hooks
  const { generateAgent, isGenerating, error } = useAgentGeneration();
  const { 
    testAgent, 
    isTesting, 
    testResults, 
    clearTestResults 
  } = useAgentTesting();

  // Generate agent on mount
  useEffect(() => {
    console.log('🔄 SmartAgentBuilder useEffect triggered:', {
      hasUser: !!user?.id,
      hasPrompt: !!prompt,
      promptLength: prompt?.length || 0
    });
    
    if (user?.id && prompt) {
      console.log('✅ Starting agent generation...');
      handleGenerateAgent();
    } else {
      console.log('❌ Missing requirements for agent generation:', {
        userId: user?.id,
        prompt: !!prompt
      });
    }
  }, [user?.id, prompt]);

  const handleGenerateAgent = async () => {
    console.log('🎯 handleGenerateAgent called with prompt:', prompt?.slice(0, 100));
    clearTestResults();
    const generatedAgent = await generateAgent(prompt);
    if (generatedAgent) {
      console.log('✅ Agent generated successfully:', generatedAgent.agent_name);
      setAgent(generatedAgent);
    } else {
      console.log('❌ Agent generation failed');
    }
  };

  const handleEdit = () => {
    setIsEditing(true);
    setEditedAgent(agent ? { ...agent } : null);
  };

  const handleSaveEdit = async () => {
    if (!editedAgent) return;
    
    // Here you could add API call to save changes
    // For now, just update local state
    setAgent(editedAgent);
    setIsEditing(false);
    clearTestResults(); // Clear test results when agent is modified
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditedAgent(null);
  };

  const handleTestAgent = async () => {
    const currentAgent = isEditing ? editedAgent : agent;
    if (currentAgent) {
      await testAgent(currentAgent);
    }
  };

  const handleCreateAgent = () => {
    const finalAgent = isEditing ? editedAgent : agent;
    console.log('🎉 Creating agent:', finalAgent?.agent_name);
    if (finalAgent && onAgentCreated) {
      onAgentCreated(finalAgent);
    } else {
      console.error('❌ Cannot create agent:', {
        hasFinalAgent: !!finalAgent,
        hasCallback: !!onAgentCreated
      });
    }
  };

  const updateEditedAgent = (updates: Partial<Agent>) => {
    if (editedAgent) {
      setEditedAgent({ ...editedAgent, ...updates });
    }
  };

  // Loading state
  if (isGenerating) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-xl p-8 shadow-lg text-center">
          <div className="relative mb-6">
            <div className="w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto animate-pulse">
              <Brain className="h-8 w-8 text-white" />
            </div>
            <Loader2 className="h-6 w-6 text-blue-500 animate-spin absolute top-5 left-1/2 transform -translate-x-1/2" />
          </div>
          
          <h3 className="text-xl font-semibold text-gray-900 mb-3">Building Your Smart Agent</h3>
          <p className="text-gray-600 mb-6">
            AI is analyzing your {promptType} prompt and creating the agent structure...
          </p>
          
          <div className="space-y-3 text-sm text-gray-600">
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Prompt analyzed and requirements extracted</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>Detecting required plugins and services</span>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
              <span>Generating agent configuration...</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-xl p-8 shadow-lg text-center">
          <div className="w-16 h-16 bg-red-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="h-8 w-8 text-red-600" />
          </div>
          
          <h3 className="text-xl font-semibold text-gray-900 mb-3">Generation Failed</h3>
          <p className="text-red-600 mb-6">{error}</p>
          
          <div className="space-y-3">
            <button
              onClick={handleGenerateAgent}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="w-full bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
              >
                <ArrowLeft className="h-4 w-4" />
                Go Back
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // No agent generated
  if (!agent) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-xl p-8 shadow-lg text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-6">
            <Brain className="h-8 w-8 text-gray-400" />
          </div>
          
          <h3 className="text-xl font-semibold text-gray-900 mb-3">No Agent Generated</h3>
          <p className="text-gray-600 mb-6">
            Unable to generate agent from the provided prompt. Please try again or go back to refine your prompt.
          </p>
          
          <div className="space-y-3">
            <button
              onClick={handleGenerateAgent}
              className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              Retry Generation
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="w-full bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
              >
                Go Back
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const currentAgent = isEditing ? editedAgent : agent;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <AgentActions
            agent={currentAgent}
            isEditing={isEditing}
            isTesting={isTesting}
            promptType={promptType}
            onBack={onBack}
            onEdit={handleEdit}
            onSave={handleSaveEdit}
            onCancel={handleCancelEdit}
            onTest={handleTestAgent}
            onCreate={handleCreateAgent}
          />
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Agent Overview */}
        <AgentPreview
          agent={currentAgent}
          prompt={prompt}
          promptType={promptType}
          isEditing={isEditing}
          onUpdate={updateEditedAgent}
        />

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Schema */}
          <InputSchemaEditor
            inputSchema={currentAgent?.input_schema || []}
            isEditing={isEditing}
            onUpdate={(inputSchema) => updateEditedAgent({ input_schema: inputSchema })}
          />

          {/* Plugin Requirements */}
          <PluginRequirements
            pluginsRequired={currentAgent?.plugins_required || []}
            isEditing={isEditing}
            onUpdate={(plugins) => updateEditedAgent({ plugins_required: plugins })}
          />
        </div>

        {/* System Prompt */}
        <SystemPromptEditor
          systemPrompt={currentAgent?.system_prompt || ''}
          userPrompt={currentAgent?.user_prompt || ''}
          isEditing={isEditing}
          onUpdateSystem={(systemPrompt) => updateEditedAgent({ system_prompt: systemPrompt })}
          onUpdateUser={(userPrompt) => updateEditedAgent({ user_prompt: userPrompt })}
        />

        {/* Test Results */}
        {testResults && (
          <TestRunner
            testResults={testResults}
            onClearResults={clearTestResults}
          />
        )}
      </div>
    </div>
  );
}
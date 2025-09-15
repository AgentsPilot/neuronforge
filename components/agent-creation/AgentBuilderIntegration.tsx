// components/agent-creation/AgentBuilderIntegration.tsx
'use client';

import React, { useState } from 'react';
import ConversationalAgentBuilder from './ConversationalAgentBuilder';
import SmartAgentBuilder from './SmartAgentBuilder';

interface AgentBuilderIntegrationProps {
  initialPrompt?: string;
  onAgentCompleted: (agent: any) => void;
  onCancel: () => void;
}

type BuilderPhase = 'conversational' | 'smart';

interface ApprovedPromptData {
  prompt: string;
  promptType: 'original' | 'enhanced';
  clarificationAnswers: Record<string, string>;
}

export default function AgentBuilderIntegration({
  initialPrompt,
  onAgentCompleted,
  onCancel
}: AgentBuilderIntegrationProps) {
  const [currentPhase, setCurrentPhase] = useState<BuilderPhase>('conversational');
  const [approvedPromptData, setApprovedPromptData] = useState<ApprovedPromptData | null>(null);

  console.log('🔄 AgentBuilderIntegration render:', {
    currentPhase,
    initialPrompt: initialPrompt?.slice(0, 50) + '...',
    hasApprovedData: !!approvedPromptData
  });

  const handlePromptApproved = (data: ApprovedPromptData) => {
    console.log('✅ Prompt approved, transitioning to smart builder:', data);
    
    setApprovedPromptData(data);
    setCurrentPhase('smart');
  };

  const handleBackToConversational = () => {
    console.log('⬅️ Going back to conversational builder');
    setCurrentPhase('conversational');
    setApprovedPromptData(null);
  };

  if (currentPhase === 'conversational') {
    console.log('🎯 Rendering ConversationalAgentBuilder with onPromptApproved callback');
    return (
      <ConversationalAgentBuilder
        initialPrompt={initialPrompt}
        onPromptApproved={handlePromptApproved}
        onCancel={onCancel}
      />
    );
  }

  if (currentPhase === 'smart' && approvedPromptData) {
    console.log('🎯 Rendering SmartAgentBuilder with approved prompt data');
    return (
      <SmartAgentBuilder
        prompt={approvedPromptData.prompt}
        promptType={approvedPromptData.promptType}
        clarificationAnswers={approvedPromptData.clarificationAnswers}
        onAgentCreated={onAgentCompleted}
        onBack={handleBackToConversational}
        onCancel={onCancel}
      />
    );
  }

  // Fallback - should not reach here
  console.error('❌ AgentBuilderIntegration: Invalid state', { currentPhase, approvedPromptData });
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center">
        <p className="text-gray-600">Loading agent builder...</p>
      </div>
    </div>
  );
}
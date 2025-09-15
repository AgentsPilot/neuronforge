// components/agent-creation/SmartAgentBuilder/hooks/useAgentGeneration.ts

import { useState } from 'react';
import { Agent } from '../types/agent';

export const useAgentGeneration = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [lastClarificationAnswers, setLastClarificationAnswers] = useState<Record<string, any>>({});

  const generateAgent = async (
    prompt: string, 
    clarificationAnswers: Record<string, any> = {}
  ): Promise<Agent | null> => {
    setIsGenerating(true);
    setError(null);
    
    // Store the parameters for potential regeneration
    setLastPrompt(prompt);
    setLastClarificationAnswers(clarificationAnswers);

    try {
      console.log('🚀 Generating agent from prompt:', prompt.slice(0, 100) + '...');
      
      const response = await fetch('/api/generate-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          prompt,
          clarificationAnswers 
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      console.log('✅ Agent generation result:', {
        hasAgent: !!result.agent,
        agentName: result.agent?.agent_name,
        pluginsCount: result.agent?.plugins_required?.length || 0,
        inputFieldsCount: result.agent?.input_schema?.length || 0,
        hasSchedule: result.extraction_details?.has_schedule || false,
        workflowSteps: result.extraction_details?.workflow_step_count || 0
      });
      
      if (!result.agent) {
        throw new Error('No agent data received from API');
      }

      return result.agent;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate agent';
      console.error('❌ Agent generation error:', errorMessage);
      setError(errorMessage);
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateAgent = async (): Promise<Agent | null> => {
    if (!lastPrompt) {
      setError('No previous prompt found to regenerate from');
      return null;
    }

    console.log('🔄 Regenerating agent with last prompt and clarifications');
    return generateAgent(lastPrompt, lastClarificationAnswers);
  };

  const clearError = () => {
    setError(null);
  };

  const canRegenerate = () => {
    return lastPrompt.length > 0;
  };

  return {
    generateAgent,
    regenerateAgent,
    isGenerating,
    error,
    clearError,
    canRegenerate,
    lastPrompt: lastPrompt.slice(0, 100) + (lastPrompt.length > 100 ? '...' : '')
  };
};
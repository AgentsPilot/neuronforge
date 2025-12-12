// components/agent-creation/SmartAgentBuilder/hooks/useAgentGeneration.ts

import { useState } from 'react';
import { Agent } from '../types/agent';

interface GenerateAgentOptions {
  sessionId?: string;
  agentId?: string;
  clarificationAnswers?: Record<string, any>;
  promptType?: string;
  services_involved?: string[];  // Filtered plugins from Phase 3
}

export const useAgentGeneration = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [lastOptions, setLastOptions] = useState<GenerateAgentOptions>({});

  const generateAgent = async (
    prompt: string,
    options: GenerateAgentOptions = {}
  ): Promise<{ agent: Agent; sessionId: string; agentId: string } | null> => {
    setIsGenerating(true);
    setError(null);
    
    // Store the parameters for potential regeneration
    setLastPrompt(prompt);
    setLastOptions(options);

    try {
      console.log('🚀 Generating agent with consistent tracking IDs:', {
        prompt: prompt?.slice(0, 100) + '...',
        promptLength: prompt?.length || 0,
        promptIsNull: prompt === null,
        promptIsUndefined: prompt === undefined,
        promptIsEmpty: prompt === '',
        sessionId: options.sessionId,
        agentId: options.agentId,
        hasClairificationAnswers: !!(options.clarificationAnswers && Object.keys(options.clarificationAnswers).length > 0),
        promptType: options.promptType
      });
      
      // Validate prompt is not empty
      if (!prompt || !prompt.trim()) {
        throw new Error('Prompt cannot be empty');
      }

      // FIXED: Prepare request payload matching API expectations
      const requestPayload = {
        prompt: prompt.trim(), // FIXED: Use 'prompt' not 'enhancedPrompt' to match API
        clarificationAnswers: options.clarificationAnswers || {},

        // CRITICAL FIX: Pass IDs at top level, not nested in clarificationAnswers
        sessionId: options.sessionId,
        agentId: options.agentId,

        // Pass filtered plugins from Phase 3 (services_involved)
        services_involved: options.services_involved,

        // Additional metadata
        promptType: options.promptType
      };

      console.log('📤 Request payload structure:', {
        hasPrompt: !!requestPayload.prompt,
        promptLength: requestPayload.prompt?.length || 0,
        hasSessionId: !!requestPayload.sessionId,
        hasAgentId: !!requestPayload.agentId,
        clarificationAnswersCount: Object.keys(requestPayload.clarificationAnswers).length
      });

      // ========================================
      // 🎯 V4 ONLY - OpenAI 3-Stage Architecture
      // ========================================
      // V4: OpenAI 3-stage architecture (LLM → Deterministic DSL → Repair)
      // Stage 1: LLM outputs simple text plan (NOT JSON)
      // Stage 2: Deterministic DSL builder → PILOT_DSL_SCHEMA
      // Stage 3: Repair loop for ambiguities (if needed)

      console.log('🎯 Using V4 (OpenAI 3-Stage) generation');

      const response = await fetch('/api/generate-agent-v4', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(options.sessionId && { 'x-session-id': options.sessionId }),
          ...(options.agentId && { 'x-agent-id': options.agentId }),
        },
        body: JSON.stringify(requestPayload)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ V4 (OpenAI 3-Stage) generation failed:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData.error,
          details: errorData.details,
          stage: errorData.stage, // Which stage failed
          prompt_length: prompt.length,
          timestamp: new Date().toISOString()
        });

        throw new Error(
          errorData.error ||
          `Agent generation failed (${response.status}): ${response.statusText}. Please try again or contact support if the issue persists.`
        );
      }

      const result = await response.json();
      const usedVersion = 'v4';

      console.log('✅ V4 (OpenAI 3-Stage) generation successful!');
      console.log('✅ Agent generation result with ID tracking:', {
        hasAgent: !!result.agent,
        agentName: result.agent?.agent_name,
        pluginsCount: result.agent?.plugins_required?.length || 0,
        inputFieldsCount: result.agent?.input_schema?.length || 0,
        hasSchedule: result.extraction_details?.has_schedule || false,
        workflowSteps: result.extraction_details?.workflow_step_count || 0,
        // LOG the tracking IDs from result for verification
        resultSessionId: result.sessionId,
        resultAgentId: result.agentId,
        activityTracked: result.extraction_details?.activity_tracked,
        // VERIFY: Check if the agent ID matches what we sent
        agentIdConsistent: result.agent?.id === options.agentId || 'ID_MISMATCH',
        // SHOW which version was used
        versionUsed: usedVersion
      });

      if (!result.agent) {
        throw new Error('No agent data received from API');
      }

      // CRITICAL FIX: Return the sessionId and agentId from the API response
      // so the parent component can use the SAME IDs for creation
      return {
        agent: result.agent,
        sessionId: result.sessionId || options.sessionId,
        agentId: result.agentId || options.agentId
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to generate agent';
      console.error('❌ Agent generation error:', errorMessage);
      setError(errorMessage);
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const regenerateAgent = async (): Promise<{ agent: Agent; sessionId: string; agentId: string } | null> => {
    if (!lastPrompt) {
      setError('No previous prompt found to regenerate from');
      return null;
    }

    console.log('🔄 Regenerating agent with last prompt and options:', {
      promptLength: lastPrompt.length,
      hasSessionId: !!lastOptions.sessionId,
      hasAgentId: !!lastOptions.agentId,
      hasClarificationAnswers: !!(lastOptions.clarificationAnswers && Object.keys(lastOptions.clarificationAnswers).length > 0)
    });
    return generateAgent(lastPrompt, lastOptions);
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
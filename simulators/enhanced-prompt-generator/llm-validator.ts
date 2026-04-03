/**
 * LLM-based validator for the enhanced prompt.
 *
 * After Phase 3, this validates that the final enhanced prompt
 * faithfully captures the user's original intent using the ProviderFactory.
 */

import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { ProviderName } from '@/lib/ai/providerFactory';
import type { SimulatorLogger } from '@/simulators/shared/types';
import type { ValidationResult } from './types';

const VALIDATION_SYSTEM_PROMPT = [
  'You are a strict quality evaluator for an AI automation platform.',
  'Your job is to determine whether an "enhanced prompt" (a structured automation plan)',
  'faithfully and completely captures the user\'s original intent.',
  '',
  'Evaluate the following:',
  '1. Does the enhanced prompt cover all elements of the original prompt?',
  '2. Are there any missing elements from the original request?',
  '3. Are there any misinterpretations of the original intent?',
  '4. Are there any additions that the user did not request?',
  '',
  'Respond with ONLY a JSON object in this exact format:',
  '{',
  '  "pass": true/false,',
  '  "reasoning": "A 1-3 sentence explanation of your assessment",',
  '  "issues": ["issue1", "issue2"]  // empty array if pass is true',
  '}',
  '',
  'Be strict but fair. Minor details like specific formatting or reasonable defaults',
  'are acceptable. Missing core functionality or misinterpreted intent is a failure.',
].join('\n');

/**
 * Validate that an enhanced prompt captures the original user intent.
 */
export async function validateEnhancedPrompt(
  originalPrompt: string,
  enhancedPrompt: unknown,
  providerName: string,
  modelName: string,
  logger: SimulatorLogger,
): Promise<ValidationResult> {
  const startTime = Date.now();

  logger.info('Running LLM validation of enhanced prompt...');

  const provider = ProviderFactory.getProvider(providerName as ProviderName);
  const model = modelName || provider.defaultModel;

  const userMessage = [
    '## Original User Prompt',
    originalPrompt,
    '',
    '## Enhanced Prompt (Automation Plan)',
    JSON.stringify(enhancedPrompt, null, 2),
  ].join('\n');

  const completionParams: Record<string, unknown> = {
    model,
    messages: [
      { role: 'system', content: VALIDATION_SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,
    max_tokens: 512,
  };

  if (provider.supportsResponseFormat) {
    completionParams.response_format = { type: 'json_object' };
  }

  try {
    const completion = await provider.chatCompletion(
      completionParams,
      {
        userId: 'simulator',
        feature: 'simulator',
        component: 'llm-validator',
        category: 'simulator',
        activity_type: 'simulator',
        activity_name: 'Validate enhanced prompt',
      },
    );

    const text = completion.choices?.[0]?.message?.content || '';
    const duration = Date.now() - startTime;

    try {
      const parsed = JSON.parse(text);
      const result: ValidationResult = {
        pass: !!parsed.pass,
        reasoning: parsed.reasoning || 'No reasoning provided',
        issues: Array.isArray(parsed.issues) ? parsed.issues : [],
        duration_ms: duration,
      };

      logger.info(`Validation ${result.pass ? 'PASSED' : 'FAILED'} in ${duration}ms`, {
        pass: result.pass,
        issueCount: result.issues.length,
      });

      if (result.issues.length > 0) {
        logger.info('Validation issues:', { issues: result.issues });
      }

      return result;
    } catch {
      logger.warn('Failed to parse validator LLM response as JSON');
      return {
        pass: false,
        reasoning: `Validator response was not valid JSON: ${text.substring(0, 200)}`,
        issues: ['Validator response parsing failed'],
        duration_ms: duration,
      };
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Validation LLM call failed: ${message}`);
    return {
      pass: false,
      reasoning: `Validator LLM call failed: ${message}`,
      issues: ['LLM call error'],
      duration_ms: duration,
    };
  }
}

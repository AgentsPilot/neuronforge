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
  'You are a thorough quality evaluator for an AI automation platform.',
  'Your job is to determine whether an "enhanced prompt" (a structured automation plan)',
  'faithfully and completely captures the user\'s original intent.',
  '',
  'IMPORTANT: Before claiming something is missing, carefully check ALL sections of the',
  'enhanced prompt — including "data", "actions", "output", "delivery", "processing_steps",',
  'and any other sections. Information may be spread across multiple sections.',
  '',
  'Evaluate the following:',
  '1. Go through each distinct request in the original prompt one by one.',
  '2. For each request, search ALL sections of the enhanced prompt for coverage.',
  '3. Only flag an element as missing if it truly does not appear in ANY section.',
  '4. Reasonable defaults (e.g., specific sender addresses, formatting choices) are acceptable',
  '   and should NOT be flagged as additions the user did not request.',
  '5. Paraphrased or restructured content that preserves the original meaning is acceptable.',
  '',
  'Respond with ONLY a JSON object in this exact format:',
  '{',
  '  "pass": true/false,',
  '  "reasoning": "A 1-3 sentence explanation of your assessment",',
  '  "issues": ["issue1", "issue2"]  // empty array if pass is true',
  '}',
  '',
  'Only fail if there is a genuinely missing core element or a clear misinterpretation.',
  'Do NOT fail for rephrasing, restructuring, or reasonable elaboration of the original intent.',
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

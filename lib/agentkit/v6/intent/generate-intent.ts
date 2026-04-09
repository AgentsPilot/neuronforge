// lib/agentkit/v6/intent/generate-intent.ts
// Generate Intent Contract using vocabulary injection

import { buildCoreVocabularyInjection, type IntentContractV1 } from './core-vocabulary';
import { buildPluginVocabularyInjection, type PluginRegistry } from './plugin-vocabulary';
import { buildIntentSystemPrompt } from './intent-system-prompt';
import { buildIntentSystemPromptV2 } from './intent-system-prompt-v2';
import { buildIntentUserPrompt, type EnhancedPrompt } from './intent-user-prompt';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import { systemConfigRepository } from '@/lib/repositories/SystemConfigRepository';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'IntentGenerator', service: 'V6' });

/**
 * Call LLM to generate Intent Contract JSON.
 *
 * Model/provider resolution priority:
 *   1. Function args (provider, model) — for external override (e.g., test scripts)
 *   2. system_settings_config DB keys: agent_generation_ai_provider, agent_generation_ai_model
 *   3. Hardcoded defaults: anthropic / claude-sonnet-4-5-20250929
 */
async function callLLMJson(args: {
  system: string;
  user: string;
  provider?: string;
  model?: string;
}): Promise<string> {
  // Resolve provider and model
  let providerName = args.provider;
  let modelName = args.model;

  if (!providerName || !modelName) {
    try {
      const config = await systemConfigRepository.getAgentGenerationConfig();
      if (!providerName) providerName = config.provider;
      if (!modelName) modelName = config.model;
    } catch {
      // DB not available (e.g., test scripts) — fall back to defaults
    }
  }

  providerName = providerName || 'anthropic';
  modelName = modelName || 'claude-sonnet-4-5-20250929';

  logger.info({ provider: providerName, model: modelName }, '[IntentGen] Calling LLM for Intent Contract generation');

  const chatProvider = ProviderFactory.getProvider(providerName as 'openai' | 'anthropic' | 'kimi');
  const maxOutputTokens = chatProvider.getMaxOutputTokens(modelName);

  // Cap max_tokens at 16000 for IC generation — ICs are typically 5-10K tokens.
  // Higher values (e.g., 64K for claude-sonnet-4-6) trigger Anthropic's streaming
  // requirement for operations > 10 minutes.
  const cappedMaxTokens = Math.min(maxOutputTokens, 16000);

  const completionParams: any = {
    model: modelName,
    max_tokens: cappedMaxTokens,
    temperature: 0.0,
    messages: [
      { role: 'system', content: args.system },
      { role: 'user', content: args.user },
    ],
  };

  // Only add response_format if provider supports it (Anthropic/Kimi handle JSON via prompting)
  if (chatProvider.supportsResponseFormat) {
    completionParams.response_format = { type: 'json_object' };
  }

  const response = await chatProvider.chatCompletion(
    completionParams,
    {
      userId: 'system',
      feature: 'intent_generation',
      component: 'generate-intent',
      category: 'v6_pipeline',
      activity_type: 'intent_contract_generation',
      activity_name: 'Generate Intent Contract V1',
    }
  );

  const content = response.choices?.[0]?.message?.content || '';
  if (!content) {
    throw new Error('No content in LLM response');
  }

  return content;
}

/**
 * Validate Intent Contract V1 structure
 * Basic validation - full validation should use Zod or similar
 *
 * NOTE: This validates the LEGACY Core DSL V1 format.
 * For Generic Intent V1 format, use validateGenericIntentV1() instead.
 */
function validateIntentContractV1(data: any): { ok: true; value: IntentContractV1 } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  if (data.version !== 'core_dsl_v1') {
    errors.push('version must be "core_dsl_v1"');
  }

  if (typeof data.goal !== 'string' || !data.goal) {
    errors.push('goal is required and must be a non-empty string');
  }

  if (!Array.isArray(data.plugins_involved)) {
    errors.push('plugins_involved must be an array');
  }

  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    errors.push('steps must be a non-empty array');
  }

  if (data.unit_of_work && !['item', 'record', 'attachment', 'event', 'message', 'file', 'row', 'entity'].includes(data.unit_of_work)) {
    errors.push('unit_of_work must be one of: item, record, attachment, event, message, file, row, entity');
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: data as IntentContractV1 };
}

/**
 * Validate Generic Intent V1 structure (NEW FORMAT)
 *
 * This validates the Generic Intent V1 format as defined in intent-schema-types.ts
 * which uses symbolic RefName, CapabilityUse, and plugin-agnostic design.
 */
function validateGenericIntentV1(data: any): { ok: true; value: any } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  // Check version
  if (data.version !== 'intent.v1') {
    errors.push('version must be "intent.v1"');
  }

  // Check goal
  if (typeof data.goal !== 'string' || !data.goal) {
    errors.push('goal is required and must be a non-empty string');
  }

  // Check steps
  if (!Array.isArray(data.steps) || data.steps.length === 0) {
    errors.push('steps must be a non-empty array');
  } else {
    // Validate each step has required fields
    data.steps.forEach((step: any, index: number) => {
      if (!step.id || typeof step.id !== 'string') {
        errors.push(`step[${index}] must have an 'id' field`);
      }
      if (!step.kind || typeof step.kind !== 'string') {
        errors.push(`step[${index}] must have a 'kind' field`);
      }
      if (!step.summary || typeof step.summary !== 'string') {
        errors.push(`step[${index}] must have a 'summary' field`);
      }
    });
  }

  // Check unit_of_work if present
  if (data.unit_of_work) {
    if (typeof data.unit_of_work === 'string') {
      // Allow legacy string format - accept any semantic entity name
      if (!data.unit_of_work.trim()) {
        errors.push('unit_of_work string must be non-empty');
      }
    } else if (typeof data.unit_of_work === 'object') {
      // New object format: {entity, parent_entity?}
      if (!data.unit_of_work.entity || typeof data.unit_of_work.entity !== 'string') {
        errors.push('unit_of_work.entity is required and must be a non-empty string');
      }
    } else {
      errors.push('unit_of_work must be a string or object with entity field');
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: data };
}

/**
 * Generate Intent Contract from Enhanced Prompt
 *
 * PRODUCTION MODE (default):
 * - Loads plugin semantic operations from database table (golden source)
 * - No pluginRegistry or specLoader needed
 *
 * TESTING/LEGACY MODE:
 * - Can optionally provide pluginRegistry or specLoader for testing
 */
export async function generateIntentContract(args: {
  enhancedPrompt: EnhancedPrompt;
  pluginRegistry?: PluginRegistry; // Optional - will load from database if not provided
  specLoader?: (pluginKey: string) => Promise<any>; // Optional - legacy OpenAPI loader
}): Promise<{ intent: IntentContractV1; rawText: string }> {
  const { enhancedPrompt } = args;
  let { pluginRegistry } = args;
  const { specLoader } = args;

  logger.info('[IntentGen] Starting Intent Contract generation');

  // PRODUCTION: Load plugin registry from database if not provided
  if (!pluginRegistry) {
    if (specLoader) {
      // Legacy: Load from OpenAPI specs if specLoader provided
      const { loadPluginRegistryFromSpecs } = await import('./plugin-spec-loader');
      pluginRegistry = await loadPluginRegistryFromSpecs({
        pluginKeys: enhancedPrompt.specifics.services_involved,
        specLoader,
      });
      logger.info({ plugins: Object.keys(pluginRegistry) }, '[IntentGen] Loaded plugin registry from specs (legacy)');
    } else {
      // PRODUCTION: Load from database (golden source)
      const { loadPluginRegistryFromDatabase } = await import('./plugin-semantic-catalog');
      pluginRegistry = await loadPluginRegistryFromDatabase({
        pluginKeys: enhancedPrompt.specifics.services_involved,
      });
      logger.info({ plugins: Object.keys(pluginRegistry) }, '[IntentGen] Loaded plugin registry from database');
    }
  }

  if (!pluginRegistry || Object.keys(pluginRegistry).length === 0) {
    throw new Error('Failed to load plugin registry from database or no plugins found');
  }

  // 1. Build core vocabulary injection (always the same)
  const coreVocabulary = buildCoreVocabularyInjection();
  logger.info('[IntentGen] Core vocabulary built');

  // 2. Build plugin vocabulary injection (ONLY for plugins involved in this workflow)
  const pluginVocabulary = buildPluginVocabularyInjection({
    registry: pluginRegistry,
    plugins_involved: enhancedPrompt.specifics.services_involved,
  });
  logger.info({
    plugins: pluginVocabulary.plugins.map((p) => p.plugin_key),
  }, '[IntentGen] Plugin vocabulary built');

  // 3. Build system prompt with injected vocabularies
  const system = buildIntentSystemPrompt({ coreVocabulary, pluginVocabulary });
  logger.info('[IntentGen] System prompt built');

  // 4. Build user prompt with enhanced prompt
  const user = buildIntentUserPrompt({ enhancedPrompt });
  logger.info('[IntentGen] User prompt built');

  // 5. Call LLM
  const rawText = await callLLMJson({ system, user });
  logger.info('[IntentGen] Received LLM response, parsing JSON');

  // 6. Parse JSON
  let parsed: unknown;
  try {
    // Try to extract JSON from markdown code blocks if present
    let jsonText = rawText.trim();

    // Remove markdown code fence if present
    if (jsonText.startsWith('```')) {
      const match = jsonText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      if (match) {
        jsonText = match[1];
      } else {
        // Try without newlines
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
    }

    parsed = JSON.parse(jsonText);
  } catch (e) {
    logger.error({ error: e, rawText: rawText.substring(0, 500) }, '[IntentGen] JSON parse failed');
    throw new Error(`Intent JSON parse failed: ${(e as Error).message}`);
  }

  logger.info('[IntentGen] JSON parsed, validating');

  // 7. Validate
  const v = validateIntentContractV1(parsed);
  if (!v.ok) {
    logger.error({ errors: v.errors, parsed }, '[IntentGen] Schema validation failed');
    // Save raw output for debugging
    const fs = require('fs');
    fs.writeFileSync('/tmp/intent-contract-validation-failed.json', JSON.stringify(parsed, null, 2));
    logger.info('[IntentGen] Failed JSON saved to /tmp/intent-contract-validation-failed.json');
    throw new Error(`Intent schema validation failed:\n- ${v.errors.join('\n- ')}`);
  }

  logger.info('[IntentGen] Validation passed!');
  logger.info({ intent: v.value }, '[IntentGen] ✅ Intent Contract generated successfully');

  return { intent: v.value, rawText };
}

/**
 * Generate Generic Intent Contract V1 (NEW FORMAT)
 *
 * This generates the Generic Intent V1 format as defined in intent-schema-types.ts
 * which uses symbolic RefName, CapabilityUse, and plugin-agnostic design.
 *
 * IMPORTANT: This is the NEW format that aligns with CapabilityBinder expectations.
 * Use this instead of generateIntentContract for new workflows.
 *
 * @param vocabulary - Optional plugin vocabulary to guide domain/capability selection.
 *                     If provided, LLM will use actual available domains from connected plugins.
 */
export async function generateGenericIntentContractV1(args: {
  enhancedPrompt: EnhancedPrompt;
  vocabulary?: any; // PluginVocabulary type (avoiding circular import)
}): Promise<{ intent: any; rawText: string }> {
  const { enhancedPrompt, vocabulary } = args;

  logger.info('[IntentGenV2] Starting Generic Intent V1 generation');
  if (vocabulary) {
    logger.info(
      {
        domains: vocabulary.domains?.length,
        capabilities: vocabulary.capabilities?.length,
        plugins: vocabulary.plugins?.length,
      },
      '[IntentGenV2] Vocabulary provided - will inject into prompt'
    );
  }

  // 1. Build system prompt (Generic Intent V1 with optional vocabulary injection)
  const system = buildIntentSystemPromptV2(vocabulary);
  logger.info('[IntentGenV2] System prompt built');

  // 2. Build user prompt with enhanced prompt
  const user = buildIntentUserPrompt({ enhancedPrompt });
  logger.info('[IntentGenV2] User prompt built');

  // 3. Call LLM
  const rawText = await callLLMJson({ system, user });
  logger.info('[IntentGenV2] Received LLM response, parsing JSON');

  // 4. Parse JSON
  let parsed: unknown;
  try {
    // Try to extract JSON from markdown code blocks if present
    let jsonText = rawText.trim();

    // Remove markdown code fence if present
    if (jsonText.startsWith('```')) {
      const match = jsonText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
      if (match) {
        jsonText = match[1];
      } else {
        // Try without newlines
        jsonText = jsonText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      }
    }

    parsed = JSON.parse(jsonText);
  } catch (e) {
    logger.error({ error: e, rawText: rawText.substring(0, 500) }, '[IntentGenV2] JSON parse failed');
    throw new Error(`Intent JSON parse failed: ${(e as Error).message}`);
  }

  logger.info('[IntentGenV2] JSON parsed, validating');

  // 5. Validate Generic Intent V1
  const v = validateGenericIntentV1(parsed);
  if (!v.ok) {
    logger.error({ errors: v.errors, parsed }, '[IntentGenV2] Schema validation failed');
    // Save raw output for debugging
    const fs = require('fs');
    fs.writeFileSync('/tmp/generic-intent-v1-validation-failed.json', JSON.stringify(parsed, null, 2));
    logger.info('[IntentGenV2] Failed JSON saved to /tmp/generic-intent-v1-validation-failed.json');
    throw new Error(`Generic Intent V1 schema validation failed:\n- ${v.errors.join('\n- ')}`);
  }

  logger.info('[IntentGenV2] Validation passed!');
  logger.info({ intent: v.value }, '[IntentGenV2] ✅ Generic Intent V1 Contract generated successfully');

  return { intent: v.value, rawText };
}

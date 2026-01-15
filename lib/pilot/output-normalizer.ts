/**
 * Output Normalizer - Centralized step output normalization
 *
 * Phase 1 Architectural Redesign:
 * This module provides a single source of truth for normalizing step outputs
 * to match declared output schemas. It transforms runtime outputs into the
 * structure expected by downstream steps.
 *
 * Key responsibilities:
 * - Map runtime output keys to declared output keys
 * - Wrap primitive values in declared key objects
 * - Parse JSON strings when declared type is object
 * - Track all normalization actions in metadata
 *
 * @module lib/pilot/output-normalizer
 */

import type { NormalizationMeta, TransformType, DeclaredOutput } from './types';
import { isValidTransformType } from './types';
import { createLogger } from '@/lib/logger';
import { jsonrepair } from 'jsonrepair';

const logger = createLogger({ module: 'OutputNormalizer', service: 'workflow-pilot' });

/**
 * Result of normalizing step output
 */
export interface NormalizationResult {
  /**
   * Normalized data mapped to declared output keys
   */
  data: Record<string, any>;

  /**
   * Original raw output (only if normalization occurred)
   */
  _raw?: any;

  /**
   * Normalization metadata
   */
  _meta: NormalizationMeta;
}

/**
 * Options for output normalization
 */
export interface NormalizeOptions {
  /**
   * Step ID for logging
   */
  stepId: string;

  /**
   * Transform type (determines normalization rules)
   */
  transformType: TransformType;

  /**
   * Declared outputs from DSL step definition
   * Format: { outputKey: typeString } or { outputKey: { type: string, ... } }
   */
  declaredOutputs?: Record<string, any>;

  /**
   * Whether to preserve raw output in _raw field
   * Default: true
   */
  preserveRaw?: boolean;
}

/**
 * Known runtime output keys for each transform type
 * These are the keys that transforms typically produce
 */
const TRANSFORM_RUNTIME_KEYS: Record<TransformType, string[]> = {
  filter: ['items', 'filtered', 'count', 'total'],
  map: ['items', 'mapped', 'result'],
  sort: ['items', 'sorted'],
  group_by: ['groups', 'grouped'],
  aggregate: ['result', 'aggregated', 'counts', 'totals'],
  reduce: ['result', 'reduced'],
  deduplicate: ['items', 'unique', 'duplicates'],
  flatten: ['items', 'flattened'],
  pick_fields: ['items', 'picked'],
  format: ['result', 'formatted', 'html', 'text'],
  merge: ['result', 'merged'],
  split: ['parts', 'items', 'buckets'],
  convert: ['result', 'converted'],
  // LLM transforms
  summarize_with_llm: ['summary', 'result'],
  classify_with_llm: ['classification', 'label', 'result'],
  extract_with_llm: ['extracted', 'data', 'result'],
  analyze_with_llm: ['analysis', 'insights', 'result'],
  generate_with_llm: ['generated', 'content', 'result'],
  translate_with_llm: ['translated', 'result'],
  enrich_with_llm: ['enriched', 'result'],
  // Operation
  operation: [],
  // Unknown
  unknown: [],
};

/**
 * Normalize step output to match declared output schema
 *
 * This is the main entry point for output normalization.
 * It handles various transform types and ensures the output
 * structure matches what downstream steps expect.
 *
 * @param rawOutput - The raw output from step execution
 * @param options - Normalization options
 * @returns Normalized result with data, _raw, and _meta
 */
export function normalizeStepOutput(
  rawOutput: any,
  options: NormalizeOptions
): NormalizationResult {
  const { stepId, transformType, declaredOutputs, preserveRaw = true } = options;

  logger.debug({
    stepId,
    transformType,
    declaredOutputKeys: declaredOutputs ? Object.keys(declaredOutputs) : [],
    rawOutputType: Array.isArray(rawOutput) ? 'array' : typeof rawOutput,
  }, 'Starting output normalization');

  const meta: NormalizationMeta = {
    normalized: false,
    keyMappings: {},
    wrappedKeys: [],
    parsedKeys: [],
    warnings: [],
  };

  // If no declared outputs, return raw output as-is wrapped in data
  if (!declaredOutputs || Object.keys(declaredOutputs).length === 0) {
    logger.debug({ stepId }, 'No declared outputs - returning raw output');
    return {
      data: wrapRawOutput(rawOutput),
      _meta: meta,
    };
  }

  // Get declared output keys (excluding next_step and is_last_step which are routing, not data)
  const declaredKeys = Object.keys(declaredOutputs).filter(
    key => key !== 'next_step' && key !== 'is_last_step' &&
           key !== 'iteration_next_step' && key !== 'after_loop_next_step'
  );

  if (declaredKeys.length === 0) {
    logger.debug({ stepId }, 'No data output keys declared - returning raw output');
    return {
      data: wrapRawOutput(rawOutput),
      _meta: meta,
    };
  }

  let normalizedData: Record<string, any> = {};

  // Handle different raw output types
  if (rawOutput === null || rawOutput === undefined) {
    // Null/undefined - map to first declared key
    normalizedData[declaredKeys[0]] = rawOutput;
    meta.warnings?.push(`Raw output was ${rawOutput}, mapped to ${declaredKeys[0]}`);
  } else if (typeof rawOutput === 'string') {
    // String output - handle format transforms and JSON parsing
    normalizedData = normalizeStringOutput(rawOutput, declaredKeys, declaredOutputs, meta, stepId);
    meta.normalized = true;
  } else if (Array.isArray(rawOutput)) {
    // Array output - map to first declared key
    normalizedData = normalizeArrayOutput(rawOutput, declaredKeys, transformType, meta, stepId);
    meta.normalized = true;
  } else if (typeof rawOutput === 'object') {
    // Object output - map keys to declared keys
    normalizedData = normalizeObjectOutput(rawOutput, declaredKeys, declaredOutputs, transformType, meta, stepId);
    meta.normalized = Object.keys(meta.keyMappings || {}).length > 0;
  } else {
    // Primitive (number, boolean) - wrap in first declared key
    normalizedData[declaredKeys[0]] = rawOutput;
    meta.wrappedKeys?.push(declaredKeys[0]);
    meta.normalized = true;
  }

  const result: NormalizationResult = {
    data: normalizedData,
    _meta: meta,
  };

  // Preserve raw output if normalization occurred and preserveRaw is true
  if (meta.normalized && preserveRaw) {
    result._raw = rawOutput;
  }

  logger.info({
    stepId,
    normalized: meta.normalized,
    keyMappings: meta.keyMappings,
    wrappedKeys: meta.wrappedKeys,
    outputKeys: Object.keys(normalizedData),
  }, 'Output normalization complete');

  return result;
}

/**
 * Wrap raw output in a data object if it's not already an object
 */
function wrapRawOutput(rawOutput: any): Record<string, any> {
  if (rawOutput === null || rawOutput === undefined) {
    return {};
  }
  if (typeof rawOutput === 'object' && !Array.isArray(rawOutput)) {
    return rawOutput;
  }
  // Wrap arrays and primitives
  return { result: rawOutput };
}

/**
 * Normalize string output
 */
function normalizeStringOutput(
  rawOutput: string,
  declaredKeys: string[],
  declaredOutputs: Record<string, any>,
  meta: NormalizationMeta,
  stepId: string
): Record<string, any> {
  const result: Record<string, any> = {};
  const primaryKey = declaredKeys[0];
  const primaryDef = declaredOutputs[primaryKey];
  const declaredType = typeof primaryDef === 'string' ? primaryDef : primaryDef?.type;

  // Check if we should parse as JSON
  const isObjectType = declaredType === 'object' || declaredType?.startsWith('object');
  const looksLikeJson = rawOutput.trim().startsWith('{') || rawOutput.trim().startsWith('[');

  if (isObjectType && looksLikeJson) {
    try {
      const parsed = JSON.parse(rawOutput);
      result[primaryKey] = parsed;
      meta.parsedKeys?.push(primaryKey);
      logger.debug({ stepId, primaryKey }, 'Parsed JSON string to object');
    } catch (parseError) {
      // JSON.parse failed, try to repair the JSON (e.g., unescaped quotes in HTML)
      try {
        const repaired = jsonrepair(rawOutput);
        const parsed = JSON.parse(repaired);
        result[primaryKey] = parsed;
        meta.parsedKeys?.push(primaryKey);
        logger.info({ stepId, primaryKey }, 'Repaired and parsed malformed JSON to object');
      } catch (repairError) {
        // Even repair failed, keep as string
        result[primaryKey] = rawOutput;
        meta.wrappedKeys?.push(primaryKey);
        meta.warnings?.push(`Expected object for ${primaryKey} but JSON parse and repair both failed`);
        logger.warn({ stepId, primaryKey, parseError, repairError }, 'Format result looks like JSON but failed to parse even after repair');
      }
    }
  } else {
    // Wrap string in declared key
    result[primaryKey] = rawOutput;
    meta.wrappedKeys?.push(primaryKey);
  }

  return result;
}

/**
 * Normalize array output
 */
function normalizeArrayOutput(
  rawOutput: any[],
  declaredKeys: string[],
  transformType: TransformType,
  meta: NormalizationMeta,
  stepId: string
): Record<string, any> {
  const result: Record<string, any> = {};
  const primaryKey = declaredKeys[0];

  // Map array to first declared key
  result[primaryKey] = rawOutput;
  meta.keyMappings = meta.keyMappings || {};
  meta.keyMappings['(array)'] = primaryKey;

  logger.debug({ stepId, primaryKey, itemCount: rawOutput.length }, 'Mapped array to declared key');

  return result;
}

/**
 * Normalize object output
 */
function normalizeObjectOutput(
  rawOutput: Record<string, any>,
  declaredKeys: string[],
  declaredOutputs: Record<string, any>,
  transformType: TransformType,
  meta: NormalizationMeta,
  stepId: string
): Record<string, any> {
  const result: Record<string, any> = {};
  const runtimeKeys = Object.keys(rawOutput);

  // Get known runtime keys for this transform type
  const knownRuntimeKeys = TRANSFORM_RUNTIME_KEYS[transformType] || [];

  for (const declaredKey of declaredKeys) {
    // 1. Direct match - runtime has exact key
    if (rawOutput.hasOwnProperty(declaredKey)) {
      result[declaredKey] = rawOutput[declaredKey];
      continue;
    }

    // 2. Try to find a matching runtime key
    let matchedRuntimeKey: string | null = null;

    // 2a. Check known runtime keys for this transform type
    for (const runtimeKey of knownRuntimeKeys) {
      if (rawOutput.hasOwnProperty(runtimeKey) && !result.hasOwnProperty(runtimeKey)) {
        matchedRuntimeKey = runtimeKey;
        break;
      }
    }

    // 2b. If no known key found, use first available runtime key not yet mapped
    if (!matchedRuntimeKey) {
      for (const runtimeKey of runtimeKeys) {
        // Skip if already used or is a metadata key
        if (result.hasOwnProperty(runtimeKey) || runtimeKey.startsWith('_')) {
          continue;
        }
        // Skip if this runtime key is already a declared key (will be handled directly)
        if (declaredKeys.includes(runtimeKey)) {
          continue;
        }
        matchedRuntimeKey = runtimeKey;
        break;
      }
    }

    // 3. If found a runtime key to map, do the mapping
    if (matchedRuntimeKey) {
      result[declaredKey] = rawOutput[matchedRuntimeKey];
      meta.keyMappings = meta.keyMappings || {};
      meta.keyMappings[matchedRuntimeKey] = declaredKey;
      logger.debug({
        stepId,
        runtimeKey: matchedRuntimeKey,
        declaredKey,
      }, 'Mapped runtime key to declared key');
    } else {
      // No matching runtime key found - check if we should use entire object
      if (declaredKeys.length === 1 && runtimeKeys.length > 0) {
        // Single declared key, object has data - use entire object
        result[declaredKey] = rawOutput;
        meta.warnings?.push(`No matching runtime key for ${declaredKey}, using entire object`);
      } else {
        // Leave as undefined with warning
        meta.warnings?.push(`No matching runtime key found for declared key: ${declaredKey}`);
      }
    }
  }

  // Also copy through any runtime keys that match declared keys directly
  for (const runtimeKey of runtimeKeys) {
    if (declaredKeys.includes(runtimeKey) && !result.hasOwnProperty(runtimeKey)) {
      result[runtimeKey] = rawOutput[runtimeKey];
    }
  }

  return result;
}

/**
 * Get the transform type from a step definition
 * Uses isValidTransformType from types.ts - single source of truth
 */
export function getTransformType(step: any): TransformType {
  if (step.kind === 'operation' || step.type === 'action') {
    return 'operation';
  }

  if (step.kind === 'transform' || step.type === 'transform') {
    const type = step.type as string || step.operation as string;

    // Use the shared type guard from types.ts
    if (isValidTransformType(type)) {
      return type;
    }
  }

  // Check for ai_processing which maps to LLM transforms
  if (step.type === 'ai_processing' || step.type === 'llm_decision') {
    const intent = step.intent as string;
    if (intent) {
      const intentMap: Record<string, TransformType> = {
        'extract': 'extract_with_llm',
        'summarize': 'summarize_with_llm',
        'generate': 'generate_with_llm',
        'validate': 'analyze_with_llm',
        'transform': 'analyze_with_llm',
        'enrich': 'enrich_with_llm',
      };
      return intentMap[intent] || 'analyze_with_llm';
    }
    return 'analyze_with_llm';
  }

  return 'unknown';
}

/**
 * Extract declared outputs from step definition
 * Handles both DSL format and legacy format
 */
export function extractDeclaredOutputs(step: any): Record<string, any> | undefined {
  // DSL format: step.outputs is an object with keys
  if (step.outputs && typeof step.outputs === 'object') {
    // Filter out routing keys
    const outputs: Record<string, any> = {};
    for (const [key, value] of Object.entries(step.outputs)) {
      if (key !== 'next_step' && key !== 'is_last_step' &&
          key !== 'iteration_next_step' && key !== 'after_loop_next_step') {
        outputs[key] = value;
      }
    }
    return Object.keys(outputs).length > 0 ? outputs : undefined;
  }

  return undefined;
}

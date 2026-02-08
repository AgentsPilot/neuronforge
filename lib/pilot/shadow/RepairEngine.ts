/**
 * RepairEngine - Auto-repair data shape mismatches during calibration
 *
 * When a step fails because its input has the wrong shape (object vs array),
 * the RepairEngine analyzes the upstream step's output and proposes a fix:
 *
 * 1. Object with single array field → extract that field
 * 2. Object with multiple array fields → extract best-match using SchemaAwareDataExtractor patterns
 * 3. Single record (no array fields) → wrap in [object]
 * 4. Deeply nested or incompatible → no repair possible
 *
 * All repairs operate on IN-MEMORY data only. No client data is persisted.
 * The RepairEngine NEVER throws — all errors are caught and returned as 'not_fixable'.
 *
 * @module lib/pilot/shadow/RepairEngine
 */

import type { StepOutput } from '../types';
import type {
  FailureClassification,
  RepairActionType,
  RepairProposal,
  RepairResult,
} from './types';

/**
 * Metadata fields that should NOT be treated as primary data arrays.
 * Mirrors SchemaAwareDataExtractor's METADATA_FIELDS set.
 */
const METADATA_FIELDS = new Set([
  'count', 'total', 'total_count', 'totalCount', 'page', 'pages', 'per_page', 'perPage',
  'offset', 'limit', 'start', 'size', 'has_more', 'hasMore', 'next_page', 'nextPage',
  'next_page_token', 'nextPageToken', 'cursor', 'next_cursor', 'nextCursor',
  'previous_page', 'previousPage', 'prev_cursor', 'prevCursor',
  'pagination', 'paging', 'meta', 'metadata', '_metadata', '_meta',
  'success', 'error', 'errors', 'status', 'message', 'code',
  'removed', 'originalCount', 'original_count', 'length',
  'warnings', 'info', 'debug', 'links', '_links',
]);

/**
 * Priority patterns for identifying primary data arrays when multiple exist.
 * Order matters — first match wins. Mirrors SchemaAwareDataExtractor.
 */
const PRIMARY_ARRAY_PATTERNS = [
  /^items$/i,
  /^results?$/i,
  /^records?$/i,
  /^entries$/i,
  /^list$/i,
  /^rows?$/i,
  /^values$/i,
  /^objects?$/i,
  /^entities$/i,
  /^resources?$/i,
  /^elements$/i,
  /^content$/i,
  /^response$/i,
];

/** Shape classification for upstream data */
type DataShapeClass =
  | 'already_array'
  | 'single_array_field'
  | 'multiple_array_fields'
  | 'single_record'
  | 'deeply_nested'
  | 'incompatible';

interface DataShapeAnalysis {
  shape: DataShapeClass;
  arrayFields: Array<{ name: string; length: number }>;
  bestMatchField?: string;
}

export class RepairEngine {

  /**
   * Propose a repair for a data_shape_mismatch failure.
   *
   * @param classification - The failure classification from FailureClassifier
   * @param failedStepId - The step that failed
   * @param upstreamStepId - The upstream step whose output may need fixing
   * @param upstreamOutput - The upstream step's StepOutput (in-memory)
   * @returns RepairProposal with action type and details, or action='none'
   */
  proposeRepair(
    classification: FailureClassification,
    failedStepId: string,
    upstreamStepId: string,
    upstreamOutput: StepOutput | undefined
  ): RepairProposal {
    const noRepair: RepairProposal = {
      action: 'none',
      description: 'No repair possible',
      confidence: 0,
      targetStepId: upstreamStepId,
      risk: 'high',
    };

    // Only repair data_shape_mismatch failures
    if (classification.category !== 'data_shape_mismatch') {
      return { ...noRepair, description: `Repair not applicable for ${classification.category}` };
    }

    if (!upstreamOutput) {
      return { ...noRepair, description: 'No upstream output available' };
    }

    const data = upstreamOutput.data;
    const analysis = this.analyzeUpstreamData(data);

    switch (analysis.shape) {
      case 'already_array':
        return { ...noRepair, description: 'Upstream data is already an array' };

      case 'single_array_field':
        return {
          action: 'extract_single_array',
          description: `Extract '${analysis.bestMatchField}' array from object`,
          confidence: 0.95,
          targetStepId: upstreamStepId,
          extractField: analysis.bestMatchField,
          risk: 'low',
        };

      case 'multiple_array_fields':
        return {
          action: 'extract_named_array',
          description: `Extract '${analysis.bestMatchField}' array (best match from ${analysis.arrayFields.length} arrays)`,
          confidence: 0.8,
          targetStepId: upstreamStepId,
          extractField: analysis.bestMatchField,
          risk: 'medium',
        };

      case 'single_record':
        return {
          action: 'wrap_in_array',
          description: 'Wrap single object in array',
          confidence: 0.85,
          targetStepId: upstreamStepId,
          risk: 'low',
        };

      case 'deeply_nested':
        return { ...noRepair, description: 'Data is deeply nested (depth > 3), cannot auto-repair' };

      case 'incompatible':
        return { ...noRepair, description: `Upstream data is incompatible type: ${typeof data}` };

      default:
        return noRepair;
    }
  }

  /**
   * Apply a repair proposal by modifying the upstream step's output data in memory.
   * Returns a NEW StepOutput with modified data but same metadata.
   *
   * @param proposal - The repair proposal to apply
   * @param upstreamOutput - The upstream step's current StepOutput
   * @returns Modified StepOutput with repaired data, or null if repair fails
   */
  applyRepair(
    proposal: RepairProposal,
    upstreamOutput: StepOutput
  ): StepOutput | null {
    if (proposal.action === 'none') {
      return null;
    }

    const data = upstreamOutput.data;

    switch (proposal.action) {
      case 'extract_single_array':
      case 'extract_named_array': {
        const field = proposal.extractField;
        if (!field || !data || typeof data !== 'object' || !Array.isArray(data[field])) {
          return null;
        }
        return {
          ...upstreamOutput,
          data: data[field],
        };
      }

      case 'wrap_in_array': {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return null;
        }
        return {
          ...upstreamOutput,
          data: [data],
        };
      }

      default:
        return null;
    }
  }

  /**
   * Analyze upstream data to classify its shape and find the best array field.
   */
  analyzeUpstreamData(data: any): DataShapeAnalysis {
    // Already an array
    if (Array.isArray(data)) {
      return { shape: 'already_array', arrayFields: [] };
    }

    // Not an object → incompatible
    if (!data || typeof data !== 'object') {
      return { shape: 'incompatible', arrayFields: [] };
    }

    // Find all non-metadata array fields
    const arrayFields: Array<{ name: string; length: number }> = [];
    for (const [key, value] of Object.entries(data)) {
      if (Array.isArray(value) && !METADATA_FIELDS.has(key) && !METADATA_FIELDS.has(key.toLowerCase())) {
        arrayFields.push({ name: key, length: (value as any[]).length });
      }
    }

    // Single array field
    if (arrayFields.length === 1) {
      return {
        shape: 'single_array_field',
        arrayFields,
        bestMatchField: arrayFields[0].name,
      };
    }

    // Multiple array fields — find best match using pattern priority
    if (arrayFields.length > 1) {
      const bestMatch = this.findBestArrayField(arrayFields, data);
      return {
        shape: 'multiple_array_fields',
        arrayFields,
        bestMatchField: bestMatch,
      };
    }

    // No array fields — check if it's a single record
    const nonMetaKeys = Object.keys(data).filter(
      k => !METADATA_FIELDS.has(k) && !METADATA_FIELDS.has(k.toLowerCase()) && !k.startsWith('_')
    );

    if (nonMetaKeys.length > 0) {
      // Check nesting depth to avoid deeply nested structures
      if (this.getMaxDepth(data) > 3) {
        return { shape: 'deeply_nested', arrayFields: [] };
      }
      return { shape: 'single_record', arrayFields: [] };
    }

    return { shape: 'incompatible', arrayFields: [] };
  }

  // ─── Private helpers ─────────────────────────────────────

  /**
   * Find the best array field from multiple candidates using priority patterns.
   * Mirrors SchemaAwareDataExtractor's heuristic extraction logic.
   */
  private findBestArrayField(
    arrayFields: Array<{ name: string; length: number }>,
    _data: any
  ): string {
    // Priority 1: Pattern-based matching
    for (const pattern of PRIMARY_ARRAY_PATTERNS) {
      const match = arrayFields.find(f => pattern.test(f.name));
      if (match) return match.name;
    }

    // Priority 2: Pluralized noun (ends in 's', length > 3)
    const pluralFields = arrayFields.filter(
      f => /^[a-z_]+s$/i.test(f.name) && f.name.length > 3 && !f.name.startsWith('_')
    );
    if (pluralFields.length === 1) return pluralFields[0].name;
    if (pluralFields.length > 1) {
      // Longest plural name wins (more specific)
      pluralFields.sort((a, b) => b.name.length - a.name.length);
      return pluralFields[0].name;
    }

    // Priority 3: Largest non-empty array
    const nonEmpty = arrayFields.filter(f => f.length > 0);
    if (nonEmpty.length > 0) {
      nonEmpty.sort((a, b) => b.length - a.length);
      return nonEmpty[0].name;
    }

    // Fallback: first array field
    return arrayFields[0].name;
  }

  /**
   * Get the maximum nesting depth of an object.
   * Used to detect deeply nested structures that can't be auto-repaired.
   */
  private getMaxDepth(obj: any, currentDepth: number = 0): number {
    if (currentDepth > 5) return currentDepth; // cap recursion
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return currentDepth;
    }

    let maxDepth = currentDepth;
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const depth = this.getMaxDepth(value, currentDepth + 1);
        if (depth > maxDepth) maxDepth = depth;
      }
    }
    return maxDepth;
  }
}

/**
 * Detect the upstream step ID from a failed step's definition.
 *
 * Resolution order:
 * 1. Parse `dependencies[]` array (explicit dependency IDs)
 * 2. Parse `input` field for `{{stepX}}` or `{{stepX.data}}` references
 * 3. Parse `params` object values for `{{stepX}}` references
 * 4. Fallback: last step in completedSteps
 *
 * @returns The upstream step ID, or null if not determinable
 */
export function detectUpstreamStepId(
  stepDef: { dependencies?: string[]; input?: string; params?: Record<string, any> },
  completedSteps: string[]
): string | null {
  // 1. Explicit dependencies (last one is most likely the direct input provider)
  if (stepDef.dependencies && stepDef.dependencies.length > 0) {
    return stepDef.dependencies[stepDef.dependencies.length - 1];
  }

  // 2. Parse input field for {{stepX}} references
  if (typeof stepDef.input === 'string') {
    const match = stepDef.input.match(/\{\{(step\d+|[a-zA-Z_]\w*)\b/);
    if (match) return match[1];
  }

  // 3. Parse params values for {{stepX}} references
  if (stepDef.params) {
    for (const value of Object.values(stepDef.params)) {
      if (typeof value === 'string') {
        const match = value.match(/\{\{(step\d+|[a-zA-Z_]\w*)\b/);
        if (match) return match[1];
      }
    }
  }

  // 4. Fallback: last completed step
  if (completedSteps.length > 0) {
    return completedSteps[completedSteps.length - 1];
  }

  return null;
}
